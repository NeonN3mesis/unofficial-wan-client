import { upstreamChatFixture } from "../fixtures/upstream-chat.fixture.js";
import { upstreamLiveFixture } from "../fixtures/upstream-live.fixture.js";
import type {
  ChatSendResult,
  ChatStreamEvent,
  SessionBootstrapRequest,
  SessionState,
  WanLiveState
} from "../../../../packages/shared/src/index.js";
import { serverConfig } from "../config.js";
import { BrowserChatRelay } from "./browser-chat-relay.js";
import { FixtureChatService } from "./fixture-chat.js";
import {
  applyProbeResponsesToLiveState,
  applyCaptureSummaryToLiveState,
  loadCaptureSummary,
  loadCapturedStorageState,
  loadProbeResponses
} from "./capture-artifacts.js";
import { createSessionState, normalizeFixtureChat, normalizeFixtureLive } from "./normalize.js";
import {
  SessionStore,
  cookieCountFromStorageState,
  deriveExpiry,
  isStoredSessionExpired
} from "./session-store.js";
import { browserLiveProbeService } from "./browser-live-probe.js";

export interface FloatplaneAdapter {
  bootstrapSession(request?: SessionBootstrapRequest): Promise<SessionState>;
  getSessionState(): Promise<SessionState>;
  getWanLiveState(forceRefresh?: boolean): Promise<WanLiveState>;
  subscribeToChat(listener: (event: ChatStreamEvent) => void): () => void;
  getChatSnapshot(): ChatStreamEvent;
  sendChatMessage(body: string): Promise<ChatSendResult>;
  logout(): Promise<SessionState>;
}

interface FixtureFloatplaneAdapterOptions {
  capturedStorageStateFilePath?: string;
  captureSummaryFilePath?: string;
  probeResponsesFilePath?: string;
  fixtureSendEnabled?: boolean;
  enableBrowserLiveProbe?: boolean;
  allowFixtureBootstrap?: boolean;
}

export class FixtureFloatplaneAdapter implements FloatplaneAdapter {
  private readonly capturedStorageStateFilePath: string;
  private readonly captureSummaryFilePath: string;
  private readonly probeResponsesFilePath: string;
  private readonly fixtureSendEnabled: boolean;
  private readonly enableBrowserLiveProbe: boolean;
  private readonly allowFixtureBootstrap: boolean;
  private readonly chatService: FixtureChatService;
  private readonly browserChatRelay = new BrowserChatRelay();
  private hasCapturedChatRelay = false;

  constructor(
    private readonly sessionStore: SessionStore,
    options: FixtureFloatplaneAdapterOptions = {}
  ) {
    this.capturedStorageStateFilePath =
      options.capturedStorageStateFilePath ?? serverConfig.storageStateFilePath;
    this.captureSummaryFilePath =
      options.captureSummaryFilePath ?? serverConfig.captureSummaryFilePath;
    this.probeResponsesFilePath =
      options.probeResponsesFilePath ?? serverConfig.probeResponsesPath;
    this.fixtureSendEnabled = options.fixtureSendEnabled ?? serverConfig.fixtureSendEnabled;
    this.enableBrowserLiveProbe =
      options.enableBrowserLiveProbe ?? serverConfig.enableBrowserLiveProbe;
    this.allowFixtureBootstrap =
      options.allowFixtureBootstrap ?? serverConfig.allowFixtureBootstrap;
    this.hasCapturedChatRelay =
      serverConfig.enableBrowserChatRelay && !this.allowFixtureBootstrap;
    this.chatService = new FixtureChatService(
      normalizeFixtureChat(upstreamChatFixture),
      serverConfig.fixtureMessageCadenceMs,
      this.fixtureSendEnabled
    );
    this.chatService.start();
  }

  async bootstrapSession(request?: SessionBootstrapRequest): Promise<SessionState> {
    if (request?.storageState?.cookies?.length) {
      const summary = await loadCaptureSummary(this.captureSummaryFilePath);
      const probes = await loadProbeResponses(this.probeResponsesFilePath);
      this.updateChatRelayMode(summary);
      const now = new Date().toISOString();
      const state = createSessionState({
        status: "authenticated",
        mode: "storage-state",
        upstreamMode: summary || probes ? "pending-capture" : "fixture",
        hasPersistedSession: true,
        cookieCount: cookieCountFromStorageState(request.storageState),
        lastValidatedAt: now,
        expiresAt: deriveExpiry(request.storageState, serverConfig.sessionTtlMs),
        message: "Imported browser session artifacts. Upstream Floatplane calls can now reuse them locally."
      });

      await this.sessionStore.save({
        state,
        storageState: request.storageState,
        savedAt: now
      });

      return state;
    }

    const existing = await this.sessionStore.load();
    const existingSummary = await loadCaptureSummary(this.captureSummaryFilePath);
    this.updateChatRelayMode(existingSummary);

    if (existing && !isStoredSessionExpired(existing, serverConfig.sessionTtlMs)) {
      return existing.state;
    }

    const capturedStorageState = await loadCapturedStorageState(this.capturedStorageStateFilePath);
    const summary = await loadCaptureSummary(this.captureSummaryFilePath);
    const probes = await loadProbeResponses(this.probeResponsesFilePath);
    this.updateChatRelayMode(summary);

    if (capturedStorageState?.cookies?.length) {
      const now = new Date().toISOString();
      const state = createSessionState({
        status: "authenticated",
        mode: "storage-state",
        upstreamMode: summary || probes ? "pending-capture" : "fixture",
        hasPersistedSession: true,
        cookieCount: cookieCountFromStorageState(capturedStorageState),
        lastValidatedAt: now,
        expiresAt: deriveExpiry(capturedStorageState, serverConfig.sessionTtlMs),
        message:
          "Loaded captured browser session artifacts from disk. Restart the capture flow after Floatplane auth expires."
      });

      await this.sessionStore.save({
        state,
        storageState: capturedStorageState,
        savedAt: now
      });

      return state;
    }

    if (!this.allowFixtureBootstrap) {
      return createSessionState({
        status: "unauthenticated",
        mode: "playwright",
        upstreamMode: summary || probes ? "pending-capture" : "fixture",
        hasPersistedSession: false,
        message: "Connect your Floatplane account to start local playback.",
        nextAction: "connect"
      });
    }

    const now = new Date().toISOString();
    const state = createSessionState({
      status: "authenticated",
      mode: request?.mode === "storage-state" ? "storage-state" : "fixture",
      upstreamMode: "fixture",
      hasPersistedSession: true,
      cookieCount: cookieCountFromStorageState(existing?.storageState),
      lastValidatedAt: now,
      expiresAt: new Date(Date.now() + serverConfig.sessionTtlMs).toISOString(),
      message:
        "Fixture session bootstrapped. Replace it with captured Floatplane storage state when the real upstream flow is ready."
    });

    await this.sessionStore.save({
      state,
      storageState: existing?.storageState,
      savedAt: now
    });

    return state;
  }

  async getSessionState(): Promise<SessionState> {
    return this.sessionStore.currentState();
  }

  async getWanLiveState(forceRefresh = false): Promise<WanLiveState> {
    const baseState = normalizeFixtureLive(upstreamLiveFixture, {
      fallbackPlaybackUrl: serverConfig.fixturePlaybackUrl,
      sendEnabled: this.fixtureSendEnabled,
      upstreamMode: "fixture"
    });

    const summary = await loadCaptureSummary(this.captureSummaryFilePath);
    this.updateChatRelayMode(summary);
    let probes = await loadProbeResponses(this.probeResponsesFilePath);
    const session = await this.getSessionState();

    if (
      this.enableBrowserLiveProbe &&
      session.status === "authenticated" &&
      session.mode !== "fixture" &&
      session.cookieCount > 0
    ) {
      const liveProbePayload = await browserLiveProbeService.probeWanLive(forceRefresh).catch(() => null);

      if (liveProbePayload) {
        probes = liveProbePayload;
      }
    }

    const withCaptureSummary = applyCaptureSummaryToLiveState(baseState, summary);
    const nextState = applyProbeResponsesToLiveState(withCaptureSummary, probes);

    if (this.hasCapturedChatRelay) {
      const relayStatus = this.browserChatRelay.getStatus();
      const canSend = relayStatus === "live" && this.browserChatRelay.canSend();
      const relayReason =
        relayStatus === "live" && canSend
          ? "Upstream Floatplane chat is streaming through a managed authenticated browser runtime. Sending is routed through the official Floatplane chat composer there without opening a visible helper window."
          : relayStatus === "live"
            ? "Upstream Floatplane chat is streaming through a managed authenticated browser runtime, but the official Floatplane composer is not available yet."
          : relayStatus === "connecting"
            ? "Connecting the managed Floatplane chat relay. Live messages and send support will unlock when the upstream websocket joins the room."
            : this.browserChatRelay.getLastError() ??
              nextState.chatCapability.reason ??
              "Captured Floatplane chat metadata is present, but the managed chat relay is not connected yet.";

      nextState.chatCapability = {
        ...nextState.chatCapability,
        canRead: true,
        canSend,
        mode: canSend ? "full" : "read-only",
        transport: "websocket",
        reason: relayReason
      };
    }

    return nextState;
  }

  subscribeToChat(listener: (event: ChatStreamEvent) => void): () => void {
    if (this.hasCapturedChatRelay) {
      this.maybeStartBrowserChatRelay();
      return this.browserChatRelay.subscribe(listener);
    }

    return this.chatService.subscribe(listener);
  }

  getChatSnapshot(): ChatStreamEvent {
    if (this.hasCapturedChatRelay) {
      this.maybeStartBrowserChatRelay();
      return {
        type: "snapshot",
        messages: this.browserChatRelay.list()
      };
    }

    return {
      type: "snapshot",
      messages: this.chatService.list()
    };
  }

  async sendChatMessage(body: string): Promise<ChatSendResult> {
    const session = await this.getSessionState();
    const isAuthenticated = session.status === "authenticated";

    const summary = await loadCaptureSummary(this.captureSummaryFilePath);
    this.updateChatRelayMode(summary);

    if (this.hasCapturedChatRelay) {
      this.maybeStartBrowserChatRelay();
      return this.browserChatRelay.sendMessage(body);
    }

    return this.chatService.send(body, isAuthenticated);
  }

  async logout(): Promise<SessionState> {
    await this.sessionStore.clear();
    this.hasCapturedChatRelay = false;
    await this.browserChatRelay.dispose();

    return createSessionState({
      status: "unauthenticated",
      mode: "fixture",
      hasPersistedSession: false,
      message: "Local Floatplane session artifacts cleared."
    });
  }

  private updateChatRelayMode(summary: Awaited<ReturnType<typeof loadCaptureSummary>>): void {
    this.hasCapturedChatRelay =
      serverConfig.enableBrowserChatRelay &&
      (!this.allowFixtureBootstrap || Boolean(summary?.chatCandidates.length));
  }

  private maybeStartBrowserChatRelay(): void {
    if (!this.hasCapturedChatRelay) {
      return;
    }

    void this.browserChatRelay.start();
  }
}
