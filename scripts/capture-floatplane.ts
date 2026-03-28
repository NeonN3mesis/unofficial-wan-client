import fs from "node:fs/promises";
import path from "node:path";
import readline from "node:readline/promises";
import { stdin as input, stdout as output } from "node:process";
import { chromium, type BrowserContext, type Page } from "playwright-core";
import type { SessionBootstrapRequest } from "../packages/shared/src/index.js";
import { serverConfig } from "../apps/server/src/config.js";
import {
  buildDebugEndpoint,
  launchManagedChrome,
  waitForDebugEndpoint
} from "../apps/server/src/services/browser-runtime.js";
import {
  summarizeCaptureObservations,
  type CaptureObservation
} from "../apps/server/src/services/capture-artifacts.js";

const dataDir = serverConfig.dataDir;

function isFloatplaneUrl(url: string): boolean {
  try {
    const parsed = new URL(url);
    return /(^|\.)floatplane\.com$/i.test(parsed.hostname);
  } catch {
    return false;
  }
}

function instrumentPage(page: Page, observations: CaptureObservation[]) {
  page.on("request", (request) => {
    if (!isFloatplaneUrl(request.url())) {
      return;
    }

    observations.push({
      kind: "request",
      observedAt: new Date().toISOString(),
      url: request.url(),
      method: request.method(),
      resourceType: request.resourceType(),
      postDataSnippet: request.postData()?.slice(0, 300)
    });
  });

  page.on("response", (response) => {
    if (!isFloatplaneUrl(response.url())) {
      return;
    }

    observations.push({
      kind: "response",
      observedAt: new Date().toISOString(),
      url: response.url(),
      method: response.request().method(),
      status: response.status(),
      contentType: response.headers()["content-type"],
      resourceType: response.request().resourceType()
    });
  });

  page.on("websocket", (websocket) => {
    if (!isFloatplaneUrl(websocket.url())) {
      return;
    }

    observations.push({
      kind: "websocket",
      observedAt: new Date().toISOString(),
      url: websocket.url(),
      resourceType: "websocket"
    });
  });
}

async function collectStorageState(context: BrowserContext): Promise<SessionBootstrapRequest["storageState"]> {
  try {
    return await context.storageState();
  } catch {
    const cookies = await context.cookies();
    const pages = context.pages().filter((page) => isFloatplaneUrl(page.url()));
    const origins = [];

    for (const page of pages) {
      try {
        const origin = new URL(page.url()).origin;
        const localStorage = await page.evaluate(() =>
          Object.entries(localStorage).map(([name, value]) => ({
            name,
            value
          }))
        );

        origins.push({ origin, localStorage });
      } catch {
        // Skip pages that no longer have a reachable execution context.
      }
    }

    return {
      cookies: cookies.map((cookie) => ({
        name: cookie.name,
        value: cookie.value,
        domain: cookie.domain,
        path: cookie.path,
        expires: cookie.expires,
        httpOnly: cookie.httpOnly,
        secure: cookie.secure,
        sameSite: cookie.sameSite
      })),
      origins
    };
  }
}

async function main() {
  await fs.mkdir(dataDir, { recursive: true });
  await fs.mkdir(serverConfig.captureProfileDir, { recursive: true });

  const observations: CaptureObservation[] = [];
  const endpoint = buildDebugEndpoint();
  const networkLogPath = serverConfig.captureNetworkLogPath;
  const storageStatePath = serverConfig.storageStateFilePath;
  const summaryPath = serverConfig.captureSummaryFilePath;
  const startUrl = serverConfig.captureStartUrl;

  let spawnedChrome = null;

  if (!serverConfig.captureAttachUrl) {
    spawnedChrome = await launchManagedChrome(startUrl);
  }

  await waitForDebugEndpoint(endpoint);

  const browser = await chromium.connectOverCDP(endpoint);
  const context = browser.contexts()[0];

  if (!context) {
    throw new Error("Chrome CDP connection did not expose a browser context.");
  }

  context.pages().forEach((page) => instrumentPage(page, observations));
  context.on("page", (page) => instrumentPage(page, observations));

  let page = context.pages().find((candidate) => candidate.url().startsWith("http"));

  if (!page) {
    page = await context.newPage();
    await page.goto(startUrl, { waitUntil: "domcontentloaded" });
  }

  console.log("");
  console.log("Floatplane capture session started.");
  console.log(
    serverConfig.captureAttachUrl
      ? `Attached to existing Chrome debug endpoint: ${endpoint}`
      : `Launched regular Chrome and attached over CDP: ${endpoint}`
  );
  console.log(`Browser path: ${serverConfig.captureBrowserPath}`);
  console.log(`Profile dir: ${serverConfig.captureProfileDir}`);
  console.log(`Storage state: ${storageStatePath}`);
  console.log(`Network log: ${networkLogPath}`);
  console.log("");
  console.log("Next steps:");
  console.log("1. Complete the Cloudflare challenge in the opened Chrome window.");
  console.log("2. Log into Floatplane if needed.");
  console.log("3. Navigate to the WAN Show live page.");
  console.log("4. Let playback and chat load.");
  console.log("5. Press Enter here to finish and save artifacts.");
  console.log("");
  console.log("If Cloudflare still blocks this session, start Chrome yourself and rerun with:");
  console.log(
    `FLOATPLANE_CAPTURE_ATTACH_URL=${endpoint} npm run capture:floatplane`
  );
  console.log("");

  const rl = readline.createInterface({ input, output });
  await rl.question("");
  rl.close();

  const storageState = await collectStorageState(context);
  await fs.writeFile(storageStatePath, JSON.stringify(storageState, null, 2));
  await fs.writeFile(networkLogPath, JSON.stringify(observations, null, 2));

  const summary = summarizeCaptureObservations(observations, {
    sourceNetworkLogPath: networkLogPath
  });

  await fs.writeFile(summaryPath, JSON.stringify(summary, null, 2));
  await browser.close();

  if (spawnedChrome && spawnedChrome.pid) {
    spawnedChrome.kill("SIGTERM");
  }

  console.log("");
  console.log(`Saved capture summary to ${summaryPath}`);
  console.log(`Playback candidates: ${summary.playbackCandidates.length}`);
  console.log(`Chat candidates: ${summary.chatCandidates.length}`);
  console.log(`Auth candidates: ${summary.authCandidates.length}`);
  console.log(
    summary.selectedPlayback
      ? `Selected playback manifest: ${summary.selectedPlayback.url}`
      : "No playback manifest candidate was detected."
  );
}

void main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
