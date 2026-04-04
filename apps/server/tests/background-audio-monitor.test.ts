import { describe, expect, it, vi } from "vitest";
import type { SessionState, WanLiveState } from "../../../packages/shared/src/index.js";
import { BackgroundAudioMonitor } from "../src/services/background-audio-monitor.js";

function createSessionState(overrides: Partial<SessionState> = {}): SessionState {
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

function createLiveState(playbackUrl: string, status: WanLiveState["status"] = "live"): WanLiveState {
  return {
    creatorId: "wan-show",
    creatorName: "LinusTechTips",
    streamTitle: "WAN Show",
    summary: "live",
    status,
    playbackSources: [
      {
        id: "live",
        label: "Auto",
        kind: "hls",
        url: playbackUrl,
        mimeType: "application/x-mpegURL",
        drm: false,
        latencyTarget: "low",
        preferredPlayer: "hls",
        deliveryPlatform: "generic"
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

describe("background audio monitor", () => {
  it("launches local audio playback for a live captured stream and avoids duplicate launches", async () => {
    const player = {
      pid: 1234,
      kill: vi.fn(),
      on: vi.fn()
    };
    const spawnPlayer = vi.fn(() => player);
    const adapter = {
      getSessionState: vi.fn().mockResolvedValue(createSessionState()),
      bootstrapSession: vi.fn().mockResolvedValue(createSessionState()),
      getWanLiveState: vi
        .fn()
        .mockResolvedValue(createLiveState("/wan/playback/manifest.m3u8?target=abc")),
      subscribeToChat: vi.fn(),
      getChatSnapshot: vi.fn(),
      sendChatMessage: vi.fn(),
      logout: vi.fn()
    };
    const monitor = new BackgroundAudioMonitor(adapter, {
      baseUrl: "http://127.0.0.1:4318",
      spawnPlayer,
      ensureFreshLiveProbe: async () => true
    });

    await monitor.checkNow();
    await monitor.checkNow();

    expect(spawnPlayer).toHaveBeenCalledTimes(1);
    expect(spawnPlayer).toHaveBeenCalledWith(
      "http://127.0.0.1:4318/wan/playback/manifest.m3u8?target=abc"
    );
  });

  it("does not launch background audio in fixture mode", async () => {
    const spawnPlayer = vi.fn();
    const adapter = {
      getSessionState: vi.fn().mockResolvedValue(createSessionState({ mode: "fixture", cookieCount: 0 })),
      bootstrapSession: vi.fn().mockResolvedValue(createSessionState({ mode: "fixture", cookieCount: 0 })),
      getWanLiveState: vi.fn(),
      subscribeToChat: vi.fn(),
      getChatSnapshot: vi.fn(),
      sendChatMessage: vi.fn(),
      logout: vi.fn()
    };
    const monitor = new BackgroundAudioMonitor(adapter, {
      spawnPlayer,
      ensureFreshLiveProbe: async () => false
    });

    await monitor.checkNow();

    expect(spawnPlayer).not.toHaveBeenCalled();
    expect(adapter.getWanLiveState).not.toHaveBeenCalled();
  });
});
