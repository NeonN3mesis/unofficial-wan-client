import { describe, expect, it } from "vitest";
import { createSessionState, normalizeFixtureLive } from "../src/services/normalize.js";

describe("normalizeFixtureLive", () => {
  it("creates an unresolved playback source when upstream playback metadata is missing", () => {
    const liveState = normalizeFixtureLive(
      {
        stream: {
          status: "live"
        }
      },
      {
        sendEnabled: false
      }
    );

    expect(liveState.playbackSources[0]?.kind).toBe("unresolved");
    expect(liveState.chatCapability.mode).toBe("read-only");
    expect(liveState.notes[0]).toContain("Playback is waiting");
  });

  it("uses supplied playback and preserves send capability when enabled", () => {
    const liveState = normalizeFixtureLive(
      {
        channel: { creatorName: "Linus Tech Tips" },
        stream: {
          title: "WAN Show",
          summary: "Live",
          status: "live"
        },
        playback: {
          hlsUrl: "https://example.com/live.m3u8"
        },
        chat: {
          sendEnabled: true
        }
      },
      {
        fallbackPlaybackUrl: "https://example.com/fallback.m3u8",
        sendEnabled: true
      }
    );

    expect(liveState.streamTitle).toBe("WAN Show");
    expect(liveState.playbackSources[0]?.url).toBe("https://example.com/live.m3u8");
    expect(liveState.chatCapability.mode).toBe("full");
  });
});

describe("createSessionState", () => {
  it("marks sessions expired when upstream artifacts have timed out", () => {
    const state = createSessionState({
      status: "expired",
      mode: "storage-state",
      hasPersistedSession: true,
      cookieCount: 2,
      message: "expired",
      expiresAt: new Date(Date.now() - 1000).toISOString()
    });

    expect(state.status).toBe("expired");
    expect(state.mode).toBe("storage-state");
  });
});

