import fs from "node:fs/promises";
import path from "node:path";
import type { ChildProcess } from "node:child_process";
import { chromium, type Browser, type BrowserContext, type Page } from "playwright-core";
import type { SessionBootstrapRequest, SessionState } from "../../../../packages/shared/src/index.js";
import { serverConfig } from "../config.js";
import {
  summarizeCaptureObservations,
  type CaptureObservation,
  type FloatplaneApiProbePayload
} from "./capture-artifacts.js";
import { buildDebugEndpoint, launchManagedChrome, waitForDebugEndpoint } from "./browser-runtime.js";
import { createSessionState } from "./normalize.js";

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

async function collectStorageState(
  context: BrowserContext
): Promise<SessionBootstrapRequest["storageState"]> {
  try {
    return await context.storageState();
  } catch {
    const cookies = await context.cookies();
    const pages = context.pages().filter((page) => isFloatplaneUrl(page.url()));
    const origins = [];

    for (const page of pages) {
      try {
        const origin = new URL(page.url()).origin;
        const localStorageEntries = await page.evaluate(() =>
          Object.entries(window.localStorage).map(([name, value]) => ({
            name,
            value
          }))
        );

        origins.push({ origin, localStorage: localStorageEntries });
      } catch {
        // Ignore pages with stale execution contexts.
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

async function ensureFloatplanePage(context: BrowserContext): Promise<Page> {
  const existing =
    [...context.pages()].reverse().find((page) => isFloatplaneUrl(page.url())) ??
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
      let data: unknown = null;

      try {
        data = JSON.parse(text);
      } catch {
        data = text;
      }

      return {
        status: response.status,
        ok: response.ok,
        url: response.url,
        data
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

async function collectProbePayload(page: Page): Promise<FloatplaneApiProbePayload> {
  const creatorNamed = await fetchJsonInPage<FloatplaneApiProbePayload["creatorNamed"]>(
    page,
    "https://www.floatplane.com/api/v3/creator/named?creatorURL%5B0%5D=linustechtips"
  );
  const creatorList = await fetchJsonInPage<FloatplaneApiProbePayload["creatorList"]>(
    page,
    "https://www.floatplane.com/api/v3/content/creator/list",
    {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Accept: "application/json"
      },
      body: JSON.stringify({
        ids: ["59f94c0bdd241b70349eb72b"],
        limit: 20
      })
    }
  );
  const liveStreamId = extractLiveStreamId(creatorNamed?.data);
  const deliveryInfoLive = liveStreamId
    ? await fetchJsonInPage<FloatplaneApiProbePayload["deliveryInfoLive"]>(
        page,
        `https://www.floatplane.com/api/v3/delivery/info?scenario=live&entityId=${encodeURIComponent(
          liveStreamId
        )}&entityKind=livestream`
      )
    : undefined;
  const deliveryInfoLiveFallback = liveStreamId
    ? await fetchJsonInPage<FloatplaneApiProbePayload["deliveryInfoLiveFallback"]>(
        page,
        `https://www.floatplane.com/api/v3/delivery/info?scenario=live&entityId=${encodeURIComponent(
          liveStreamId
        )}`
      )
    : undefined;

  return {
    generatedAt: new Date().toISOString(),
    creatorNamed,
    creatorList,
    deliveryInfoLive,
    deliveryInfoLiveFallback
  };
}

async function writeSensitiveJson(filePath: string, payload: unknown): Promise<void> {
  await fs.mkdir(path.dirname(filePath), { recursive: true });
  await fs.writeFile(filePath, JSON.stringify(payload, null, 2), { mode: 0o600 });
}

export class ManagedBrowserAuthService {
  private browser?: Browser;
  private context?: BrowserContext;
  private spawnedChrome?: ChildProcess;
  private observations: CaptureObservation[] = [];
  private status: "idle" | "authenticating" | "error" = "idle";
  private message = "Connect your Floatplane account to begin watching.";
  private lastError?: string;

  getSessionState(): SessionState | null {
    if (this.status === "authenticating") {
      return createSessionState({
        status: "authenticating",
        mode: "playwright",
        upstreamMode: "pending-capture",
        hasPersistedSession: false,
        message: this.message,
        nextAction: "finish-connect"
      });
    }

    if (this.status === "error") {
      return createSessionState({
        status: "error",
        mode: "playwright",
        upstreamMode: "pending-capture",
        hasPersistedSession: false,
        message: this.lastError ?? "Floatplane sign-in failed.",
        nextAction: "retry-connect"
      });
    }

    return null;
  }

  async start(): Promise<SessionState> {
    if (this.status === "authenticating") {
      return this.getSessionState()!;
    }

    this.status = "authenticating";
    this.lastError = undefined;
    this.message = "Sign in to Floatplane in the managed browser, then return here and finish connection.";
    this.observations = [];

    try {
      await fs.mkdir(serverConfig.dataDir, { recursive: true });
      await fs.mkdir(serverConfig.captureProfileDir, { recursive: true });

      this.spawnedChrome = await launchManagedChrome(serverConfig.captureStartUrl);
      await waitForDebugEndpoint(buildDebugEndpoint());

      this.browser = await chromium.connectOverCDP(buildDebugEndpoint());
      this.browser.on("disconnected", () => {
        this.context = undefined;
        this.browser = undefined;

        if (this.status === "authenticating") {
          this.status = "error";
          this.lastError =
            "The managed Floatplane browser closed before sign-in finished. Start the connection again.";
        }
      });

      this.context = this.browser.contexts()[0];

      if (!this.context) {
        throw new Error("Managed browser did not expose an automation context.");
      }

      this.context.pages().forEach((page) => instrumentPage(page, this.observations));
      this.context.on("page", (page) => instrumentPage(page, this.observations));

      const page = await ensureFloatplanePage(this.context);

      if (!isFloatplaneUrl(page.url())) {
        await page.goto(serverConfig.captureStartUrl, { waitUntil: "domcontentloaded" });
      }

      return this.getSessionState()!;
    } catch (error) {
      await this.reset(true);
      this.status = "error";
      this.lastError =
        error instanceof Error ? error.message : "Could not launch the managed Floatplane browser.";
      return this.getSessionState()!;
    }
  }

  async complete(): Promise<SessionBootstrapRequest["storageState"]> {
    if (!this.context) {
      throw new Error("No managed Floatplane browser is active.");
    }

    const storageState = await collectStorageState(this.context);

    if (!storageState?.cookies?.length) {
      throw new Error("No authenticated Floatplane cookies were captured. Finish signing in first.");
    }

    const page = await ensureFloatplanePage(this.context);
    const probes = await collectProbePayload(page);
    const summary = summarizeCaptureObservations(this.observations, {
      sourceNetworkLogPath: serverConfig.captureNetworkLogPath
    });

    await writeSensitiveJson(serverConfig.storageStateFilePath, storageState);
    await writeSensitiveJson(serverConfig.captureNetworkLogPath, this.observations);
    await writeSensitiveJson(serverConfig.captureSummaryFilePath, summary);
    await writeSensitiveJson(serverConfig.probeResponsesPath, probes);

    await this.reset(true);
    this.status = "idle";
    this.message = "Floatplane connection complete.";
    return storageState;
  }

  async cancel(): Promise<void> {
    await this.reset(true);
    this.status = "idle";
    this.lastError = undefined;
    this.message = "Floatplane sign-in cancelled.";
  }

  async dispose(): Promise<void> {
    await this.reset(true);
    this.status = "idle";
  }

  private async reset(closeBrowser: boolean): Promise<void> {
    this.context = undefined;
    this.observations = [];

    if (closeBrowser) {
      try {
        await this.browser?.close();
      } catch {
        // Ignore browser shutdown errors.
      }
    }

    this.browser = undefined;

    if (this.spawnedChrome?.pid) {
      this.spawnedChrome.kill("SIGTERM");
    }

    this.spawnedChrome = undefined;
  }
}
