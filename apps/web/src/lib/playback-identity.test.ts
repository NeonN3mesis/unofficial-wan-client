import { describe, expect, it } from "vitest";
import type { PlaybackSource, WanLiveState } from "@shared";
import {
  buildLivePlaybackIdentity,
  buildLiveStreamIdentity
} from "./playback-identity";

function createLiveState(source: PlaybackSource): WanLiveState {
  return {
    creatorId: "wan-show",
    creatorName: "WAN Show",
    streamTitle: "Live",
    summary: "",
    status: "live",
    startedAt: "2026-07-11T01:00:00.000Z",
    refreshedAt: "2026-07-11T01:05:00.000Z",
    posterUrl: undefined,
    playbackSources: [source],
    chatCapability: {
      canRead: true,
      canSend: true,
      mode: "full",
      transport: "websocket"
    },
    upstreamMode: "reverse-proxy",
    notes: []
  };
}

function createSource(url: string): PlaybackSource {
  return {
    id: "live-abr",
    label: "Auto",
    kind: "hls",
    url,
    mimeType: "application/vnd.apple.mpegurl",
    drm: false,
    latencyTarget: "low",
    preferredPlayer: "ivs",
    deliveryPlatform: "ivs"
  };
}

describe("playback identity", () => {
  it("keeps the live playback identity stable when only the signed url changes", () => {
    const initialState = createLiveState(
      createSource("https://example.com/live.m3u8?token=initial")
    );
    const refreshedState = createLiveState(
      createSource("https://example.com/live.m3u8?token=refreshed")
    );

    expect(
      buildLivePlaybackIdentity(initialState, initialState.playbackSources[0] ?? null)
    ).toBe(
      buildLivePlaybackIdentity(refreshedState, refreshedState.playbackSources[0] ?? null)
    );
  });

  it("changes the stream identity when a new live session starts", () => {
    const source = createSource("https://example.com/live.m3u8?token=initial");
    const initialState = createLiveState(source);
    const nextState = {
      ...createLiveState(source),
      startedAt: "2026-07-11T03:00:00.000Z"
    };

    expect(
      buildLiveStreamIdentity(initialState, initialState.playbackSources[0] ?? null)
    ).not.toBe(
      buildLiveStreamIdentity(nextState, nextState.playbackSources[0] ?? null)
    );
  });
});
