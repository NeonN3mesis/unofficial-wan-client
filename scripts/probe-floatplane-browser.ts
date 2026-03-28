import fs from "node:fs/promises";
import readline from "node:readline/promises";
import { stdin as input, stdout as output } from "node:process";
import { chromium, type BrowserContext, type Page } from "playwright-core";
import { serverConfig } from "../apps/server/src/config.js";
import {
  buildDebugEndpoint,
  launchManagedChrome,
  waitForDebugEndpoint
} from "../apps/server/src/services/browser-runtime.js";

async function ensureFloatplanePage(context: BrowserContext): Promise<Page> {
  const existing =
    [...context.pages()]
      .reverse()
      .find((page) => page.url().startsWith("https://www.floatplane.com") || page.url().startsWith("https://beta.floatplane.com")) ??
    [...context.pages()].reverse().find((page) => page.url().startsWith("http"));

  if (existing) {
    return existing;
  }

  const page = await context.newPage();
  await page.goto(serverConfig.captureStartUrl, { waitUntil: "domcontentloaded" });
  return page;
}

async function fetchJsonInPage<T>(
  page: Page,
  url: string,
  init?: {
    method?: string;
    headers?: Record<string, string>;
    body?: string;
  }
): Promise<T> {
  return page.evaluate(
    async ({ requestUrl, requestInit }) => {
      const response = await fetch(requestUrl, {
        ...requestInit,
        credentials: "include"
      });

      const text = await response.text();
      let json: unknown = null;

      try {
        json = JSON.parse(text);
      } catch {
        json = text;
      }

      return {
        status: response.status,
        ok: response.ok,
        url: response.url,
        data: json
      };
    },
    { requestUrl: url, requestInit: init }
  ) as Promise<T>;
}

function extractLiveStreamId(payload: unknown): string | undefined {
  if (!Array.isArray(payload) || payload.length === 0) {
    return undefined;
  }

  const creator = payload[0] as { liveStream?: { id?: string } } | undefined;
  return creator?.liveStream?.id;
}

async function main() {
  let spawnedChrome = null;
  const endpoint = buildDebugEndpoint();

  if (!serverConfig.captureAttachUrl) {
    spawnedChrome = await launchManagedChrome(serverConfig.captureStartUrl);
  }

  await waitForDebugEndpoint(endpoint);
  const browser = await chromium.connectOverCDP(endpoint);
  const context = browser.contexts()[0];

  if (!context) {
    throw new Error("Chrome CDP connection did not expose a browser context.");
  }

  const page = await ensureFloatplanePage(context);

  console.log("");
  console.log("Attached to browser for in-page Floatplane API probes.");
  console.log("Make sure the page is logged in and Cloudflare is satisfied.");
  console.log("If needed, complete any challenge and navigate to the Floatplane page you want to reuse.");
  console.log("Press Enter when ready to probe.");
  console.log(`Current probe tab: ${page.url() || "(blank tab)"}`);
  console.log("");

  const rl = readline.createInterface({ input, output });
  await rl.question("");
  rl.close();

  const probePage = await ensureFloatplanePage(context);
  const probeUrl = probePage.url();

  if (!probeUrl.startsWith("https://www.floatplane.com") && !probeUrl.startsWith("https://beta.floatplane.com")) {
    throw new Error(
      `Probe requires a live Floatplane tab, but the selected tab is ${probeUrl || "(blank tab)"}. Navigate a browser tab to Floatplane, then rerun the probe.`
    );
  }

  const creatorNamed = await fetchJsonInPage(probePage, "https://www.floatplane.com/api/v3/creator/named?creatorURL%5B0%5D=linustechtips");
  const creatorList = await fetchJsonInPage(probePage, "https://www.floatplane.com/api/v3/content/creator/list", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Accept: "application/json"
    },
    body: JSON.stringify({
      ids: ["59f94c0bdd241b70349eb72b"],
      limit: 20
    })
  });
  const liveStreamId = extractLiveStreamId((creatorNamed as { data?: unknown }).data);
  const deliveryInfoLive =
    liveStreamId
      ? await fetchJsonInPage(
          probePage,
          `https://www.floatplane.com/api/v3/delivery/info?scenario=live&entityId=${encodeURIComponent(
            liveStreamId
          )}&entityKind=livestream`
        )
      : undefined;
  const deliveryInfoLiveFallback =
    liveStreamId
      ? await fetchJsonInPage(
          probePage,
          `https://www.floatplane.com/api/v3/delivery/info?scenario=live&entityId=${encodeURIComponent(
            liveStreamId
          )}`
        )
      : undefined;

  const probePayload = {
    generatedAt: new Date().toISOString(),
    creatorNamed,
    creatorList,
    deliveryInfoLive,
    deliveryInfoLiveFallback
  };

  await fs.writeFile(serverConfig.probeResponsesPath, JSON.stringify(probePayload, null, 2));
  await browser.close();

  if (spawnedChrome?.pid) {
    spawnedChrome.kill("SIGTERM");
  }

  console.log(`Saved probe responses to ${serverConfig.probeResponsesPath}`);
  console.log(`creatorNamed status: ${(creatorNamed as { status: number }).status}`);
  console.log(`creatorList status: ${(creatorList as { status: number }).status}`);
  if (deliveryInfoLive) {
    console.log(`deliveryInfoLive status: ${(deliveryInfoLive as { status: number }).status}`);
  }
  if (deliveryInfoLiveFallback) {
    console.log(
      `deliveryInfoLiveFallback status: ${(deliveryInfoLiveFallback as { status: number }).status}`
    );
  }
}

void main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
