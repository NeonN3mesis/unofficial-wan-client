import { spawn, type ChildProcess } from "node:child_process";
import { EventEmitter } from "node:events";
import { serverConfig } from "../config.js";
import { browserLiveProbeService } from "./browser-live-probe.js";
import type { FloatplaneAdapter } from "./floatplane-adapter.js";

type PlayerHandle = Pick<ChildProcess, "kill" | "on" | "pid">;
type SpawnPlayer = (url: string) => PlayerHandle;

interface BackgroundAudioMonitorOptions {
  baseUrl?: string;
  pollMs?: number;
  spawnPlayer?: SpawnPlayer;
  ensureFreshLiveProbe?: () => Promise<boolean>;
}

function defaultSpawnPlayer(url: string): PlayerHandle {
  return spawn(
    serverConfig.backgroundAudioPlayerPath,
    ["-nodisp", "-vn", "-autoexit", "-loglevel", "warning", url],
    {
      stdio: "ignore"
    }
  );
}

export class BackgroundAudioMonitor extends EventEmitter {
  private intervalHandle?: NodeJS.Timeout;
  private activeCheck?: Promise<void>;
  private player?: PlayerHandle;
  private activePlaybackUrl?: string;

  constructor(
    private readonly adapter: FloatplaneAdapter,
    private readonly options: BackgroundAudioMonitorOptions = {}
  ) {
    super();
  }

  start(): void {
    if (this.intervalHandle) {
      return;
    }

    void this.checkNow();
    this.intervalHandle = setInterval(() => {
      void this.checkNow();
    }, this.options.pollMs ?? serverConfig.backgroundAudioPollMs);
  }

  stop(): void {
    if (this.intervalHandle) {
      clearInterval(this.intervalHandle);
      this.intervalHandle = undefined;
    }
  }

  async checkNow(): Promise<void> {
    if (this.activeCheck) {
      return this.activeCheck;
    }

    this.activeCheck = (async () => {
      let session = await this.adapter.getSessionState().catch(() => null);

      if (!session || session.status !== "authenticated") {
        session = await this.adapter.bootstrapSession().catch(() => null);
      }

      if (
        !session ||
        session.status !== "authenticated" ||
        session.mode === "fixture" ||
        session.cookieCount === 0
      ) {
        return;
      }

      if (serverConfig.enableBrowserLiveProbe) {
        const liveProbeAvailable = this.options.ensureFreshLiveProbe
          ? await this.options.ensureFreshLiveProbe()
          : Boolean(await browserLiveProbeService.probeWanLive());

        if (!liveProbeAvailable) {
          return;
        }
      }

      const liveState = await this.adapter.getWanLiveState();
      const source = liveState.playbackSources.find((candidate) => candidate.kind !== "unresolved" && candidate.url);

      if (liveState.status !== "live" || !source?.url) {
        return;
      }

      const playbackUrl = new URL(
        source.url,
        this.options.baseUrl ?? `http://127.0.0.1:${serverConfig.port}`
      ).toString();

      if (this.player?.pid && this.activePlaybackUrl === playbackUrl) {
        return;
      }

      if (this.player?.pid) {
        this.player.kill("SIGTERM");
      }

      const player = (this.options.spawnPlayer ?? defaultSpawnPlayer)(playbackUrl);
      this.player = player;
      this.activePlaybackUrl = playbackUrl;

      player.on("exit", () => {
        if (this.player === player) {
          this.player = undefined;
          this.activePlaybackUrl = undefined;
        }
      });

      this.emit("launch", {
        playbackUrl,
        streamTitle: liveState.streamTitle
      });
    })();

    try {
      await this.activeCheck;
    } finally {
      this.activeCheck = undefined;
    }
  }
}
