import { describe, expect, it, vi } from "vitest";
import type {
  BackgroundWatchSettings,
  SessionState,
  WanLiveState
} from "../../../packages/shared/src/index.js";
import { BackgroundWatchController } from "../src/background-watch-controller.js";

function createSettings(enabled = true): BackgroundWatchSettings {
  return {
    enabled,
    autostartOnLogin: false,
    weeklyWindow: {
      dayOfWeek: 5,
      startLocalTime: "19:00",
      endLocalTime: "00:00"
    }
  };
}

function createSession(overrides: Partial<SessionState> = {}): SessionState {
  return {
    status: "authenticated",
    mode: "storage-state",
    upstreamMode: "pending-capture",
    hasPersistedSession: true,
    cookieCount: 2,
    loginUrl: "https://www.floatplane.com/login",
    message: "ok",
    ...overrides
  };
}

function createLiveState(
  playbackUrl: string,
  status: WanLiveState["status"] = "live",
  startedAt = "2026-04-03T23:02:00.000Z"
): WanLiveState {
  return {
    creatorId: "wan-show",
    creatorName: "LinusTechTips",
    streamTitle: "WAN Show",
    summary: "live",
    status,
    startedAt,
    playbackSources: [
      {
        id: "live",
        label: "Auto",
        kind: "hls",
        url: playbackUrl,
        mimeType: "application/x-mpegURL",
        drm: false,
        latencyTarget: "low",
        preferredPlayer: "ivs",
        deliveryPlatform: "ivs"
      }
    ],
    chatCapability: {
      canRead: true,
      canSend: false,
      mode: "read-only",
      transport: "websocket"
    },
    upstreamMode: "pending-capture",
    notes: []
  };
}

describe("background watch controller", () => {
  it("does not poll live state outside the active watch window", async () => {
    const adapter = {
      getSessionState: vi.fn().mockResolvedValue(createSession()),
      getWanLiveState: vi.fn().mockResolvedValue(createLiveState("https://example.com/live.m3u8"))
    };
    const controller = new BackgroundWatchController(adapter as never, {
      getSettings: () => createSettings(true),
      onLaunch: vi.fn(),
      onStatus: vi.fn(),
      now: () => new Date(2026, 2, 27, 12, 0, 0)
    });

    await controller.checkNow(true);

    expect(adapter.getSessionState).not.toHaveBeenCalled();
    expect(adapter.getWanLiveState).not.toHaveBeenCalled();
    expect(controller.getStatus().state).toBe("watching_background");
  });

  it("launches once for a live stream during the active window", async () => {
    const onLaunch = vi.fn();
    const adapter = {
      getSessionState: vi.fn().mockResolvedValue(createSession()),
      getWanLiveState: vi
        .fn()
        .mockResolvedValue(createLiveState("https://example.com/live.m3u8"))
    };
    const controller = new BackgroundWatchController(adapter as never, {
      getSettings: () => createSettings(true),
      onLaunch,
      onStatus: vi.fn(),
      now: () => new Date(2026, 2, 27, 20, 0, 0)
    });

    await controller.checkNow(true);
    await controller.checkNow(true);

    expect(onLaunch).toHaveBeenCalledTimes(1);
    expect(onLaunch).toHaveBeenCalledWith("background_live");
    expect(controller.getStatus().state).toBe("live_launched");
  });

  it("does not relaunch when only the signed playback URL rotates for the same stream", async () => {
    const onLaunch = vi.fn();
    const adapter = {
      getSessionState: vi.fn().mockResolvedValue(createSession()),
      getWanLiveState: vi
        .fn()
        .mockResolvedValueOnce(createLiveState("https://example.com/live.m3u8?token=one"))
        .mockResolvedValueOnce(createLiveState("https://example.com/live.m3u8?token=two"))
    };
    const controller = new BackgroundWatchController(adapter as never, {
      getSettings: () => createSettings(true),
      onLaunch,
      onStatus: vi.fn(),
      now: () => new Date(2026, 2, 27, 20, 0, 0)
    });

    await controller.checkNow(true);
    await controller.checkNow(true);

    expect(onLaunch).toHaveBeenCalledTimes(1);
  });

  it("prompts for reauth only once per active window", async () => {
    const onLaunch = vi.fn();
    const adapter = {
      getSessionState: vi.fn().mockResolvedValue(createSession({ status: "expired" })),
      getWanLiveState: vi.fn()
    };
    const controller = new BackgroundWatchController(adapter as never, {
      getSettings: () => createSettings(true),
      onLaunch,
      onStatus: vi.fn(),
      now: () => new Date(2026, 2, 27, 20, 0, 0)
    });

    await controller.checkNow(true);
    await controller.checkNow(true);

    expect(onLaunch).toHaveBeenCalledTimes(1);
    expect(onLaunch).toHaveBeenCalledWith("reauth_required");
    expect(controller.getStatus().state).toBe("reauth_required");
  });
});
