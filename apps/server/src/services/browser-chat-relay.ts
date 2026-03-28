import { EventEmitter } from "node:events";
import {
  chromium,
  type Browser,
  type BrowserContext,
  type CDPSession,
  type Page
} from "playwright-core";
import type {
  ChatMessage,
  ChatSendResult,
  ChatStreamEvent
} from "../../../../packages/shared/src/index.js";
import { serverConfig } from "../config.js";
import { resolveBrowserPath } from "./browser-runtime.js";
import {
  FLOATPLANE_BROWSER_USER_AGENT,
  loadActiveStorageState
} from "./floatplane-http.js";

type BrowserChatRelayStatus = "idle" | "connecting" | "live" | "error";
type PendingSocketAckWaiter = {
  resolve: (ack: SocketIoAckFrame) => void;
  reject: (error: Error) => void;
  timeoutHandle: NodeJS.Timeout;
};
type PendingSendFrameWaiter = {
  body: string;
  resolve: (frame: OutgoingChatSendFrame) => void;
  reject: (error: Error) => void;
  timeoutHandle: NodeJS.Timeout;
};

interface UpstreamChatPayload {
  id?: string;
  user?: string;
  userGUID?: string;
  username?: string;
  timestamp?: number;
  sentAt?: string;
  channel?: string;
  channelId?: string;
  message?: string;
  userType?: string;
  success?: boolean;
}

interface OutgoingChatSendFrame {
  ackId: string;
  body: string;
  channel: string;
  route: string;
}

interface SocketIoAckFrame {
  ackId: string;
  statusCode?: number;
  body?: {
    success?: boolean;
    message?: string;
  };
}

function normalizeStorageStateForPlaywright(
  storageState: Awaited<ReturnType<typeof loadActiveStorageState>>
) {
  return {
    cookies: (storageState?.cookies ?? []).map((cookie) => ({
      name: cookie.name,
      value: cookie.value,
      domain: cookie.domain,
      path: cookie.path ?? "/",
      expires: cookie.expires ?? -1,
      httpOnly: cookie.httpOnly ?? false,
      secure: cookie.secure ?? true,
      sameSite: cookie.sameSite ?? "Lax"
    })),
    origins: (storageState?.origins ?? []).map((origin) => ({
      origin: origin.origin,
      localStorage: (origin.localStorage ?? []).map((entry) => ({
        name: entry.name,
        value: entry.value
      }))
    }))
  };
}

function mapUserTypeToRole(userType?: string): ChatMessage["authorRole"] {
  switch ((userType ?? "").trim().toLowerCase()) {
    case "creator":
    case "host":
      return "host";
    case "admin":
      return "admin";
    case "pilot":
    case "staff":
    case "moderator":
      return "moderator";
    case "normal":
    case "member":
    case "subscriber":
      return "member";
    default:
      return "guest";
  }
}

function buildAccentColor(seed: string): string {
  let hash = 0;

  for (const character of seed) {
    hash = (hash * 31 + character.charCodeAt(0)) | 0;
  }

  const hue = Math.abs(hash) % 360;
  return `hsl(${hue} 74% 62%)`;
}

export function parseSocketIoChatFrame(payloadData: string): ChatMessage | null {
  if (!payloadData.startsWith("42")) {
    return null;
  }

  let parsed: unknown;

  try {
    parsed = JSON.parse(payloadData.slice(2));
  } catch {
    return null;
  }

  if (!Array.isArray(parsed) || parsed.length < 2) {
    return null;
  }

  const [eventName, rawPayload] = parsed;

  if (eventName !== "radioChatter" && eventName !== "message") {
    return null;
  }

  if (!rawPayload || typeof rawPayload !== "object") {
    return null;
  }

  const payload = rawPayload as UpstreamChatPayload;
  const body = payload.message?.trim();

  if (!body) {
    return null;
  }

  const authorName = payload.username?.trim() || "Floatplane user";
  const sentAt =
    payload.sentAt ??
    (typeof payload.timestamp === "number"
      ? new Date(payload.timestamp).toISOString()
      : new Date().toISOString());
  const stableId =
    payload.id?.trim() ||
    `${payload.userGUID ?? payload.user ?? authorName}-${payload.timestamp ?? sentAt}`;

  return {
    id: stableId,
    body,
    authorName,
    authorRole: mapUserTypeToRole(payload.userType),
    accentColor: buildAccentColor(authorName),
    sentAt,
    source: "relay"
  };
}

export function parseSocketIoSendFrame(payloadData: string): OutgoingChatSendFrame | null {
  const match = /^42(\d+)(\[.*\])$/.exec(payloadData);

  if (!match) {
    return null;
  }

  let parsed: unknown;

  try {
    parsed = JSON.parse(match[2]);
  } catch {
    return null;
  }

  if (!Array.isArray(parsed) || parsed.length < 2 || parsed[0] !== "post") {
    return null;
  }

  const payload = parsed[1] as {
    url?: string;
    data?: {
      channel?: string;
      message?: string;
    };
  } | null;

  if (payload?.url !== "/RadioMessage/sendLivestreamRadioChatter/") {
    return null;
  }

  const body = payload.data?.message?.trim();
  const channel = payload.data?.channel?.trim();

  if (!body || !channel) {
    return null;
  }

  return {
    ackId: match[1],
    body,
    channel,
    route: payload.url
  };
}

export function parseSocketIoAckFrame(payloadData: string): SocketIoAckFrame | null {
  const match = /^43(\d+)(\[.*\])$/.exec(payloadData);

  if (!match) {
    return null;
  }

  let parsed: unknown;

  try {
    parsed = JSON.parse(match[2]);
  } catch {
    return null;
  }

  if (!Array.isArray(parsed) || parsed.length === 0) {
    return null;
  }

  const payload = parsed[0] as {
    statusCode?: number;
    body?: {
      success?: boolean;
      message?: string;
    };
  } | null;

  if (!payload || typeof payload !== "object") {
    return null;
  }

  return {
    ackId: match[1],
    statusCode: payload.statusCode,
    body: payload.body
  };
}

export class BrowserChatRelay {
  private readonly emitter = new EventEmitter();
  private readonly messages: ChatMessage[] = [];
  private readonly seenMessageIds = new Set<string>();
  private readonly pendingAckWaiters = new Map<string, PendingSocketAckWaiter>();
  private readonly pendingSendFrameWaiters: PendingSendFrameWaiter[] = [];
  private browser?: Browser;
  private context?: BrowserContext;
  private page?: Page;
  private client?: CDPSession;
  private startPromise?: Promise<boolean>;
  private launchPromise?: Promise<BrowserContext>;
  private sendQueue: Promise<void> = Promise.resolve();
  private sendAvailable = false;
  private status: BrowserChatRelayStatus = "idle";
  private lastError?: string;

  constructor(
    private readonly options: {
      liveUrl?: string;
      maxMessages?: number;
    } = {}
  ) {}

  list(): ChatMessage[] {
    return [...this.messages];
  }

  subscribe(listener: (event: ChatStreamEvent) => void): () => void {
    const handler = (event: ChatStreamEvent) => listener(event);
    this.emitter.on("event", handler);

    return () => {
      this.emitter.off("event", handler);
    };
  }

  getStatus(): BrowserChatRelayStatus {
    return this.status;
  }

  getLastError(): string | undefined {
    return this.lastError;
  }

  canSend(): boolean {
    return this.sendAvailable;
  }

  async dispose(): Promise<void> {
    const context = this.context;
    const browser = this.browser;
    this.resetConnection();

    try {
      await context?.close();
    } catch {
      // Ignore browser shutdown errors.
    }

    try {
      await browser?.close();
    } catch {
      // Ignore browser shutdown errors.
    }

    this.context = undefined;
    this.browser = undefined;
    this.status = "idle";
    this.lastError = undefined;
  }

  async sendMessage(body: string): Promise<ChatSendResult> {
    const trimmedBody = body.trim();

    if (!trimmedBody) {
      return {
        status: "upstream_error",
        message: "Chat body is required."
      };
    }

    const runSend = async (): Promise<ChatSendResult> => {
      const started = await this.start();

      if (!started) {
        return {
          status: "upstream_error",
          message:
            this.lastError ??
            "The managed Floatplane chat relay could not connect to the official chat page."
        };
      }

      return this.sendMessageInternal(trimmedBody);
    };

    const task = this.sendQueue.then(runSend);
    this.sendQueue = task.then(
      () => undefined,
      () => undefined
    );

    return task;
  }

  async start(): Promise<boolean> {
    if (this.status === "live") {
      return true;
    }

    if (this.startPromise) {
      return this.startPromise;
    }

    this.startPromise = this.startInternal()
      .then(() => true)
      .catch((error) => {
        this.status = "error";
        this.lastError =
          error instanceof Error
            ? `Managed Floatplane chat relay failed: ${error.message}`
            : "Managed Floatplane chat relay failed.";
        return false;
      })
      .finally(() => {
        this.startPromise = undefined;
      });

    return this.startPromise;
  }

  private async startInternal(): Promise<void> {
    this.status = "connecting";
    this.lastError = undefined;

    const context = await this.ensureContext();
    const page = this.page ?? (await context.newPage());
    const client = await context.newCDPSession(page);
    const liveUrl = this.options.liveUrl ?? serverConfig.wanLiveUrl;

    this.page = page;
    this.client = client;

    page.on("close", () => {
      this.page = undefined;
      this.sendAvailable = false;

      if (this.status === "live") {
        this.status = "error";
        this.lastError =
          "The managed Floatplane chat page was closed. Refresh live state to relaunch it.";
      }
    });

    await client.send("Network.enable");

    const socketUrls = new Map<string, string>();

    client.on("Network.webSocketCreated", (event) => {
      socketUrls.set(event.requestId, event.url);
    });

    client.on("Network.webSocketFrameReceived", (event) => {
      const url = socketUrls.get(event.requestId);

      if (!url?.includes("chat.floatplane.com/socket.io")) {
        return;
      }

      const ackFrame = parseSocketIoAckFrame(event.response.payloadData);

      if (ackFrame) {
        const waiter = this.pendingAckWaiters.get(ackFrame.ackId);

        if (waiter) {
          clearTimeout(waiter.timeoutHandle);
          this.pendingAckWaiters.delete(ackFrame.ackId);
          waiter.resolve(ackFrame);
        }
      }

      const message = parseSocketIoChatFrame(event.response.payloadData);

      if (!message || this.seenMessageIds.has(message.id)) {
        return;
      }

      this.seenMessageIds.add(message.id);
      this.messages.push(message);

      const maxMessages = this.options.maxMessages ?? 250;

      if (this.messages.length > maxMessages) {
        this.messages.splice(0, this.messages.length - maxMessages);
      }

      this.emitter.emit("event", { type: "message", message } satisfies ChatStreamEvent);
    });

    client.on("Network.webSocketFrameSent", (event) => {
      const url = socketUrls.get(event.requestId);

      if (!url?.includes("chat.floatplane.com/socket.io")) {
        return;
      }

      const sendFrame = parseSocketIoSendFrame(event.response.payloadData);

      if (!sendFrame) {
        return;
      }

      const waiterIndex = this.pendingSendFrameWaiters.findIndex(
        (waiter) => waiter.body === sendFrame.body
      );

      if (waiterIndex === -1) {
        return;
      }

      const [waiter] = this.pendingSendFrameWaiters.splice(waiterIndex, 1);
      clearTimeout(waiter.timeoutHandle);
      waiter.resolve(sendFrame);
    });

    await page.goto(liveUrl, {
      waitUntil: "domcontentloaded",
      timeout: 45000
    });

    this.sendAvailable = await this.detectSendAvailability(page);
    this.status = "live";
  }

  private async sendMessageInternal(body: string): Promise<ChatSendResult> {
    const page = this.page;

    if (!page || page.isClosed()) {
      this.status = "error";
      this.lastError = "The managed Floatplane chat page is unavailable.";
      return {
        status: "upstream_error",
        message: this.lastError
      };
    }

    const chatInput = page.locator('textarea[placeholder="Enter your message here..."]').first();

    try {
      await chatInput.waitFor({ state: "visible", timeout: 10000 });
    } catch {
      return {
        status: "unsupported",
        message: "The official Floatplane chat composer was not visible in the managed chat page."
      };
    }

    const inputDisabled = await chatInput.isDisabled();

    if (inputDisabled) {
      this.sendAvailable = false;
      return {
        status: "unsupported",
        message: "The official Floatplane chat composer is disabled in the managed chat page."
      };
    }

    this.sendAvailable = true;

    const sendFramePromise = this.waitForOutgoingSendFrame(body);
    const echoPromise = this.waitForEchoedMessage(body);

    try {
      await chatInput.click();
      await chatInput.fill(body);
      await chatInput.press("Enter");
    } catch (error) {
      return {
        status: "upstream_error",
        message:
          error instanceof Error
            ? `Failed to interact with the official Floatplane chat composer: ${error.message}`
            : "Failed to interact with the official Floatplane chat composer."
      };
    }

    let sendFrame: OutgoingChatSendFrame;

    try {
      sendFrame = await sendFramePromise;
    } catch (error) {
      return {
        status: "upstream_error",
        message:
          error instanceof Error
            ? error.message
            : "The official Floatplane page did not emit an upstream chat send request."
      };
    }

    const ack = await this.waitForAck(sendFrame.ackId).catch(() => undefined);

    if (ack?.statusCode === 401) {
      return {
        status: "auth_expired",
        message: ack.body?.message?.trim() || "The upstream Floatplane session expired."
      };
    }

    if (ack?.statusCode === 429) {
      return {
        status: "rate_limited",
        message: ack.body?.message?.trim() || "Floatplane chat rate-limited the last send attempt."
      };
    }

    if ((ack?.statusCode ?? 200) >= 400 || ack?.body?.success === false) {
      return {
        status: "upstream_error",
        message:
          ack?.body?.message?.trim() ||
          "Floatplane rejected the upstream chat send request from the managed chat page."
      };
    }

    try {
      const echoedMessage = await echoPromise;

      return {
        status: "sent",
        message: {
          ...echoedMessage,
          isOwn: true
        }
      };
    } catch (error) {
      return {
        status: "upstream_error",
        message:
          error instanceof Error
            ? error.message
            : "The upstream chat message did not echo back through the relay."
      };
    }
  }

  private waitForOutgoingSendFrame(body: string, timeoutMs = 6000): Promise<OutgoingChatSendFrame> {
    return new Promise((resolve, reject) => {
      const timeoutHandle = setTimeout(() => {
        const index = this.pendingSendFrameWaiters.findIndex((waiter) => waiter === nextWaiter);

        if (index >= 0) {
          this.pendingSendFrameWaiters.splice(index, 1);
        }

        reject(
          new Error(
            "The official Floatplane page did not emit a send request after the local relay submitted the message."
          )
        );
      }, timeoutMs);

      const nextWaiter: PendingSendFrameWaiter = {
        body,
        resolve,
        reject,
        timeoutHandle
      };

      this.pendingSendFrameWaiters.push(nextWaiter);
    });
  }

  private waitForAck(ackId: string, timeoutMs = 6000): Promise<SocketIoAckFrame> {
    return new Promise((resolve, reject) => {
      const timeoutHandle = setTimeout(() => {
        this.pendingAckWaiters.delete(ackId);
        reject(new Error(`Timed out waiting for Floatplane chat socket ack ${ackId}.`));
      }, timeoutMs);

      this.pendingAckWaiters.set(ackId, {
        resolve,
        reject,
        timeoutHandle
      });
    });
  }

  private waitForEchoedMessage(body: string, timeoutMs = 10000): Promise<ChatMessage> {
    return new Promise((resolve, reject) => {
      const timeoutHandle = setTimeout(() => {
        unsubscribe();
        reject(
          new Error(
            "Floatplane accepted the send request, but the message did not echo back through the live chat relay in time."
          )
        );
      }, timeoutMs);

      const unsubscribe = this.subscribe((event) => {
        if (event.type !== "message" || event.message.body !== body) {
          return;
        }

        clearTimeout(timeoutHandle);
        unsubscribe();
        resolve(event.message);
      });
    });
  }

  private resetConnection(): void {
    for (const waiter of this.pendingAckWaiters.values()) {
      clearTimeout(waiter.timeoutHandle);
      waiter.reject(new Error("The managed Floatplane chat relay connection was reset."));
    }

    this.pendingAckWaiters.clear();

    while (this.pendingSendFrameWaiters.length > 0) {
      const waiter = this.pendingSendFrameWaiters.shift();

      if (!waiter) {
        continue;
      }

      clearTimeout(waiter.timeoutHandle);
      waiter.reject(new Error("The managed Floatplane chat relay connection was reset."));
    }

    this.context = undefined;
    this.page = undefined;
    this.client = undefined;
    this.launchPromise = undefined;
    this.sendAvailable = false;
  }

  private async ensureContext(): Promise<BrowserContext> {
    if (this.context && this.browser?.isConnected()) {
      return this.context;
    }

    if (this.launchPromise) {
      return this.launchPromise;
    }

    this.launchPromise = (async () => {
      this.resetConnection();

      const storageState = await loadActiveStorageState();
      const browserPath = await resolveBrowserPath();

      if (!storageState?.cookies?.length) {
        throw new Error("No saved Floatplane browser session artifacts are available for chat.");
      }

      this.browser = await chromium.launch({
        executablePath: browserPath,
        headless: true,
        args: [
          "--disable-blink-features=AutomationControlled",
          "--no-first-run",
          "--no-default-browser-check"
        ]
      });
      this.browser.on("disconnected", () => {
        this.status = "error";
        this.lastError = "The managed Floatplane chat relay lost its browser runtime.";
        this.resetConnection();
        this.browser = undefined;
      });

      this.context = await this.browser.newContext({
        storageState: normalizeStorageStateForPlaywright(storageState),
        userAgent: FLOATPLANE_BROWSER_USER_AGENT,
        locale: "en-US"
      });

      return this.context;
    })();

    try {
      return await this.launchPromise;
    } finally {
      this.launchPromise = undefined;
    }
  }

  private async detectSendAvailability(page: Page): Promise<boolean> {
    const chatInput = page.locator('textarea[placeholder="Enter your message here..."]').first();

    try {
      await chatInput.waitFor({ state: "visible", timeout: 10000 });
      return !(await chatInput.isDisabled());
    } catch {
      return false;
    }
  }
}
