import type {
  BackgroundWatchSettings,
  BackgroundWatchStatus,
  LaunchReason,
  SessionState,
  WanLiveState
} from "../../../packages/shared/src/index.js";
import type { FloatplaneAdapter } from "../../server/src/services/floatplane-adapter.js";
import { evaluateWeeklyWindow } from "./watch-schedule.js";

const ACTIVE_WINDOW_POLL_MS = 60_000;

export type AutoWatchDiagnosticEvent = {
  event: string;
  at: string;
  force?: boolean;
  details?: Record<string, unknown>;
};

function buildLiveSessionKey(liveState: Awaited<ReturnType<FloatplaneAdapter["getWanLiveState"]>>): string {
  const playbackSource = liveState.playbackSources.find(
    (candidate) => candidate.kind !== "unresolved" && candidate.url
  );

  return [liveState.creatorId, liveState.startedAt ?? "", playbackSource?.id ?? ""].join("|");
}

export class BackgroundWatchController {
  private status: BackgroundWatchStatus = {
    state: "idle",
    enabled: false,
    activeWindow: false,
    message: "Auto-watch is disabled.",
    launchSequence: 0
  };
  private lastPollAt = 0;
  private lastLiveKey: string | null = null;
  private promptedWindowKey: string | null = null;
  private activeWindowKey: string | null = null;
  private runningCheck?: Promise<void>;
  private intervalHandle?: NodeJS.Timeout;

  constructor(
    private readonly adapter: FloatplaneAdapter,
    private readonly options: {
      getSettings: () => BackgroundWatchSettings;
      onStatus: (status: BackgroundWatchStatus) => void;
      onLaunch: (reason: LaunchReason) => Promise<void> | void;
      onDiagnostic?: (event: AutoWatchDiagnosticEvent) => void;
      now?: () => Date;
      setIntervalFn?: typeof setInterval;
      clearIntervalFn?: typeof clearInterval;
    }
  ) {}

  getStatus(): BackgroundWatchStatus {
    return this.status;
  }

  start(): void {
    if (this.intervalHandle) {
      return;
    }

    void this.checkNow(true);
    this.intervalHandle = (this.options.setIntervalFn ?? setInterval)(() => {
      void this.checkNow();
    }, 30_000);
  }

  stop(): void {
    if (this.intervalHandle) {
      (this.options.clearIntervalFn ?? clearInterval)(this.intervalHandle);
      this.intervalHandle = undefined;
    }
  }

  async checkNow(force = false): Promise<void> {
    if (this.runningCheck) {
      return this.runningCheck;
    }

    this.runningCheck = this.runCheck(force).finally(() => {
      this.runningCheck = undefined;
    });
    return this.runningCheck;
  }

  private async runCheck(force: boolean): Promise<void> {
    const settings = this.options.getSettings();
    const now = (this.options.now ?? (() => new Date()))();

    this.emitDiagnostic("check-start", {
      force,
      settings,
      now: now.toISOString()
    });

    if (!settings.enabled) {
      this.lastPollAt = 0;
      this.activeWindowKey = null;
      this.promptedWindowKey = null;
      this.updateStatus({
        state: "idle",
        enabled: false,
        activeWindow: false,
        message: "Auto-watch is disabled.",
        nextCheckAt: undefined
      });
      this.emitDiagnostic("check-disabled");
      return;
    }

    const evaluation = evaluateWeeklyWindow(now, settings.weeklyWindow);
    this.activeWindowKey = evaluation.activeWindowKey;

    this.emitDiagnostic("window-evaluated", {
      active: evaluation.active,
      activeWindowKey: evaluation.activeWindowKey,
      nextWindowStartAt: evaluation.nextWindowStartAt.toISOString()
    });

    if (!evaluation.active) {
      this.lastPollAt = 0;
      this.promptedWindowKey = null;
      this.updateStatus({
        state: "watching_background",
        enabled: true,
        activeWindow: false,
        message: "Watching in the background until the next scheduled window.",
        nextCheckAt: evaluation.nextWindowStartAt.toISOString()
      });
      this.emitDiagnostic("outside-window", {
        nextWindowStartAt: evaluation.nextWindowStartAt.toISOString()
      });
      return;
    }

    if (!force && Date.now() - this.lastPollAt < ACTIVE_WINDOW_POLL_MS) {
      this.updateStatus({
        enabled: true,
        activeWindow: true,
        nextCheckAt: new Date(this.lastPollAt + ACTIVE_WINDOW_POLL_MS).toISOString(),
        message:
          this.status.state === "live_launched"
            ? "The live stream has been launched."
            : this.status.state === "reauth_required"
              ? "Reconnect your Floatplane account to resume auto-watch."
            : "Inside the scheduled auto-watch window."
      });
      this.emitDiagnostic("poll-throttled", {
        lastPollAt: new Date(this.lastPollAt).toISOString(),
        nextCheckAt: new Date(this.lastPollAt + ACTIVE_WINDOW_POLL_MS).toISOString()
      });
      return;
    }

    this.lastPollAt = Date.now();
    const session = await this.adapter.getSessionState().catch((error) => {
      this.emitDiagnostic("session-error", {
        message: error instanceof Error ? error.message : String(error)
      });
      return null;
    });

    this.emitDiagnostic("session-result", {
      session: summarizeSession(session)
    });

    if (
      !session ||
      session.status !== "authenticated" ||
      session.mode === "fixture" ||
      session.cookieCount === 0
    ) {
      await this.handleReauthRequired(evaluation.activeWindowKey, now, "initial-session-check", session);
      return;
    }

    const liveState = await this.adapter.getWanLiveState(force).catch((error) => {
      this.emitDiagnostic("live-state-error", {
        message: error instanceof Error ? error.message : String(error)
      });
      return null;
    });
    const liveSource = liveState?.playbackSources.find((candidate) => candidate.kind !== "unresolved" && candidate.url);

    this.emitDiagnostic("live-state-result", {
      liveState: summarizeLiveState(liveState),
      selectedSource: liveSource
        ? {
            id: liveSource.id,
            kind: liveSource.kind,
            preferredPlayer: liveSource.preferredPlayer,
            deliveryPlatform: liveSource.deliveryPlatform,
            hasUrl: Boolean(liveSource.url)
          }
        : null
    });

    const postLiveSession = await this.adapter.getSessionState().catch((error) => {
      this.emitDiagnostic("post-live-session-error", {
        message: error instanceof Error ? error.message : String(error)
      });
      return null;
    });

    this.emitDiagnostic("post-live-session-result", {
      session: summarizeSession(postLiveSession)
    });

    if (
      !postLiveSession ||
      postLiveSession.status !== "authenticated" ||
      postLiveSession.mode === "fixture" ||
      postLiveSession.cookieCount === 0
    ) {
      await this.handleReauthRequired(
        evaluation.activeWindowKey,
        now,
        "post-live-state-check",
        postLiveSession
      );
      return;
    }

    if (liveState?.status === "live" && liveSource?.url) {
      const liveKey = buildLiveSessionKey(liveState);
      const shouldLaunch = liveKey !== this.lastLiveKey;

      this.lastLiveKey = liveKey;
      this.updateStatus({
        state: "live_launched",
        enabled: true,
        activeWindow: true,
        message: "The WAN Show is live and has been opened automatically.",
        nextCheckAt: new Date(this.lastPollAt + ACTIVE_WINDOW_POLL_MS).toISOString(),
        lastLaunchReason: shouldLaunch ? "background_live" : this.status.lastLaunchReason,
        lastLaunchAt: shouldLaunch ? now.toISOString() : this.status.lastLaunchAt,
        launchSequence: shouldLaunch ? this.status.launchSequence + 1 : this.status.launchSequence
      });

      if (shouldLaunch) {
        await this.launchWithDiagnostics("background_live");
      }

      return;
    }

    this.updateStatus({
      state: "active_window",
      enabled: true,
      activeWindow: true,
      message: "Inside the scheduled auto-watch window and waiting for the stream to start.",
      nextCheckAt: new Date(this.lastPollAt + ACTIVE_WINDOW_POLL_MS).toISOString()
    });
    this.emitDiagnostic("waiting-for-live");
  }

  private updateStatus(partial: Partial<BackgroundWatchStatus>): void {
    this.status = {
      ...this.status,
      ...partial,
      lastCheckAt: new Date().toISOString()
    };
    this.options.onStatus(this.status);
  }

  private async handleReauthRequired(
    activeWindowKey: string | null,
    now: Date,
    source: "initial-session-check" | "post-live-state-check",
    session: SessionState | null
  ): Promise<void> {
    const shouldLaunchReauth = this.promptedWindowKey !== activeWindowKey;

    this.promptedWindowKey = activeWindowKey;
    this.updateStatus({
      state: "reauth_required",
      enabled: true,
      activeWindow: true,
      message: "Floatplane sign-in needs attention before auto-watch can continue.",
      nextCheckAt: new Date(this.lastPollAt + ACTIVE_WINDOW_POLL_MS).toISOString(),
      lastLaunchReason: shouldLaunchReauth ? "reauth_required" : this.status.lastLaunchReason,
      lastLaunchAt: shouldLaunchReauth ? now.toISOString() : this.status.lastLaunchAt,
      launchSequence: shouldLaunchReauth ? this.status.launchSequence + 1 : this.status.launchSequence
    });

    this.emitDiagnostic("reauth-required", {
      source,
      session: summarizeSession(session)
    });

    if (shouldLaunchReauth) {
      await this.launchWithDiagnostics("reauth_required");
    }
  }

  private async launchWithDiagnostics(reason: LaunchReason): Promise<void> {
    this.emitDiagnostic("launch-start", { reason });

    try {
      await this.options.onLaunch(reason);
      this.emitDiagnostic("launch-complete", { reason });
    } catch (error) {
      this.emitDiagnostic("launch-error", {
        reason,
        message: error instanceof Error ? error.message : String(error)
      });
      throw error;
    }
  }

  private emitDiagnostic(event: string, details: Record<string, unknown> = {}): void {
    this.options.onDiagnostic?.({
      event,
      at: new Date().toISOString(),
      details
    });
  }
}

function summarizeSession(session: SessionState | null) {
  return session
    ? {
        status: session.status,
        mode: session.mode,
        upstreamMode: session.upstreamMode,
        hasPersistedSession: session.hasPersistedSession,
        cookieCount: session.cookieCount,
        hasChatUsername: Boolean(session.chatUsername),
        lastValidatedAt: session.lastValidatedAt,
        expiresAt: session.expiresAt,
        nextAction: session.nextAction
      }
    : null;
}

function summarizeLiveState(liveState: WanLiveState | null) {
  return liveState
    ? {
        status: liveState.status,
        streamTitle: liveState.streamTitle,
        startedAt: liveState.startedAt,
        refreshedAt: liveState.refreshedAt,
        upstreamMode: liveState.upstreamMode,
        playbackSourceCount: liveState.playbackSources.length,
        playableSourceCount: liveState.playbackSources.filter(
          (candidate) => candidate.kind !== "unresolved" && candidate.url
        ).length,
        chatMode: liveState.chatCapability.mode,
        notes: liveState.notes
      }
    : null;
}
