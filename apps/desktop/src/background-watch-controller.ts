import type {
  BackgroundWatchSettings,
  BackgroundWatchStatus,
  LaunchReason
} from "../../../packages/shared/src/index.js";
import type { FloatplaneAdapter } from "../../server/src/services/floatplane-adapter.js";
import { evaluateWeeklyWindow } from "./watch-schedule.js";

const ACTIVE_WINDOW_POLL_MS = 60_000;

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
      return;
    }

    const evaluation = evaluateWeeklyWindow(now, settings.weeklyWindow);
    this.activeWindowKey = evaluation.activeWindowKey;

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
      return;
    }

    this.lastPollAt = Date.now();
    const session = await this.adapter.getSessionState().catch(() => null);

    if (
      !session ||
      session.status !== "authenticated" ||
      session.mode === "fixture" ||
      session.cookieCount === 0
    ) {
      const shouldLaunchReauth = this.promptedWindowKey !== evaluation.activeWindowKey;

      this.promptedWindowKey = evaluation.activeWindowKey;
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

      if (shouldLaunchReauth) {
        await this.options.onLaunch("reauth_required");
      }

      return;
    }

    const liveState = await this.adapter.getWanLiveState().catch(() => null);
    const liveSource = liveState?.playbackSources.find(
      (candidate) => candidate.kind !== "unresolved" && candidate.url
    );

    if (liveState?.status === "live" && liveSource?.url) {
      const liveKey = `${liveState.streamTitle}|${liveSource.url}`;
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
        await this.options.onLaunch("background_live");
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
  }

  private updateStatus(partial: Partial<BackgroundWatchStatus>): void {
    this.status = {
      ...this.status,
      ...partial,
      lastCheckAt: new Date().toISOString()
    };
    this.options.onStatus(this.status);
  }
}
