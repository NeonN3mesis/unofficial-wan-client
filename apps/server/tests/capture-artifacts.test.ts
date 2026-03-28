import { describe, expect, it } from "vitest";
import {
  applyProbeResponsesToLiveState,
  applyCaptureSummaryToLiveState,
  summarizeCaptureObservations,
  type CaptureObservation
} from "../src/services/capture-artifacts.js";
import { normalizeFixtureLive } from "../src/services/normalize.js";

describe("summarizeCaptureObservations", () => {
  it("extracts playback and chat candidates from observed traffic", () => {
    const observations: CaptureObservation[] = [
      {
        kind: "response",
        observedAt: "2026-03-28T00:00:00.000Z",
        url: "https://edge.floatplane.com/live/wan/playlist.m3u8",
        method: "GET",
        status: 200,
        contentType: "application/x-mpegURL",
        resourceType: "fetch"
      },
      {
        kind: "websocket",
        observedAt: "2026-03-28T00:00:03.000Z",
        url: "wss://chat.floatplane.com/socket",
        resourceType: "websocket"
      }
    ];

    const summary = summarizeCaptureObservations(observations);

    expect(summary.selectedPlayback?.url).toContain("playlist.m3u8");
    expect(summary.chatTransport).toBe("websocket");
  });

  it("ignores web app manifests when selecting playback", () => {
    const observations: CaptureObservation[] = [
      {
        kind: "response",
        observedAt: "2026-03-28T00:00:00.000Z",
        url: "https://frontend.floatplane.com/user/app/manifest.floatplane.webmanifest",
        method: "GET",
        status: 200,
        contentType: "application/manifest+json",
        resourceType: "manifest"
      },
      {
        kind: "response",
        observedAt: "2026-03-28T00:00:01.000Z",
        url: "https://edge.example.net/live/wan/playlist.m3u8",
        method: "GET",
        status: 200,
        contentType: "application/x-mpegURL",
        resourceType: "fetch"
      }
    ];

    const summary = summarizeCaptureObservations(observations);
    expect(summary.selectedPlayback?.url).toContain("playlist.m3u8");
  });
});

describe("applyCaptureSummaryToLiveState", () => {
  it("switches playback to a captured manifest and disables chat send", () => {
    const baseState = normalizeFixtureLive(
      {
        stream: {
          title: "WAN Show",
          summary: "Fixture",
          status: "live"
        }
      },
      {
        sendEnabled: true
      }
    );

    const nextState = applyCaptureSummaryToLiveState(baseState, {
      generatedAt: "2026-03-28T00:00:00.000Z",
      authCandidates: [],
      liveCandidates: [],
      playbackCandidates: [
        {
          observedAt: "2026-03-28T00:00:00.000Z",
          url: "https://edge.floatplane.com/live/wan/playlist.m3u8",
          method: "GET",
          status: 200,
          contentType: "application/x-mpegURL",
          resourceType: "fetch"
        }
      ],
      chatCandidates: [
        {
          observedAt: "2026-03-28T00:00:03.000Z",
          url: "wss://chat.floatplane.com/socket",
          resourceType: "websocket"
        }
      ],
      selectedPlayback: {
        url: "https://edge.floatplane.com/live/wan/playlist.m3u8",
        kind: "hls",
        mimeType: "application/x-mpegURL"
      },
      chatTransport: "websocket",
      notes: ["Selected playback candidate"]
    });

    expect(nextState.upstreamMode).toBe("pending-capture");
    expect(nextState.playbackSources[0]?.url).toContain("playlist.m3u8");
    expect(nextState.chatCapability.canSend).toBe(false);
  });
});

describe("applyProbeResponsesToLiveState", () => {
  it("prefers delivery-info variants over the raw live stream path", () => {
    const baseState = normalizeFixtureLive(
      {
        stream: {
          title: "Fixture title",
          summary: "Fixture summary",
          status: "offline"
        }
      },
      {
        sendEnabled: false
      }
    );

    const nextState = applyProbeResponsesToLiveState(baseState, {
      generatedAt: "2026-03-28T01:03:53.240Z",
      creatorNamed: {
        status: 200,
        ok: true,
        url: "https://www.floatplane.com/api/v3/creator/named?creatorURL%5B0%5D=linustechtips",
        data: [
          {
            id: "59f94c0bdd241b70349eb72b",
            title: "LinusTechTips",
            description: "Creator summary",
            liveStream: {
              id: "stream-1",
              title: "WAN Show Live",
              description: "<p>Real live stream</p>",
              streamPath: "/api/video/v1/live-path.m3u8",
              thumbnail: {
                path: "https://pbs.floatplane.com/thumb.jpeg"
              }
            }
          }
        ]
      },
      deliveryInfoLive: {
        status: 200,
        ok: true,
        url: "https://www.floatplane.com/api/v3/delivery/info?scenario=live&entityId=stream-1&entityKind=livestream",
        data: {
          groups: [
            {
              origins: [{ url: "https://origin.floatplane-playback.example" }],
              variants: [
                {
                  name: "live-abr",
                  label: "Auto",
                  url: "/api/video/v1/live-path.m3u8?token=abc123",
                  mimeType: "application/x-mpegURL",
                  enabled: true,
                  meta: {
                    live: {
                      lowLatencyExtension: "ivshls"
                    }
                  }
                }
              ]
            }
          ]
        }
      }
    });

    expect(nextState.streamTitle).toBe("WAN Show Live");
    expect(nextState.status).toBe("live");
    expect(nextState.playbackSources[0]?.url).toBe(
      "https://origin.floatplane-playback.example/api/video/v1/live-path.m3u8?token=abc123"
    );
    expect(nextState.playbackSources[0]?.label).toBe("Auto");
    expect(nextState.playbackSources[0]?.latencyTarget).toBe("low");
  });

  it("replaces fixture metadata with probed live stream data", () => {
    const baseState = normalizeFixtureLive(
      {
        stream: {
          title: "Fixture title",
          summary: "Fixture summary",
          status: "offline"
        }
      },
      {
        sendEnabled: false
      }
    );

    const nextState = applyProbeResponsesToLiveState(baseState, {
      generatedAt: "2026-03-28T01:03:53.240Z",
      creatorNamed: {
        status: 200,
        ok: true,
        url: "https://www.floatplane.com/api/v3/creator/named?creatorURL%5B0%5D=linustechtips",
        data: [
          {
            id: "59f94c0bdd241b70349eb72b",
            title: "LinusTechTips",
            description: "Creator summary",
            liveStream: {
              id: "stream-1",
              title: "WAN Show Live",
              description: "<p>Real live stream</p>",
              streamPath: "/api/video/v1/live-path.m3u8",
              thumbnail: {
                path: "https://pbs.floatplane.com/thumb.jpeg"
              }
            }
          }
        ]
      }
    });

    expect(nextState.creatorName).toBe("LinusTechTips");
    expect(nextState.streamTitle).toBe("WAN Show Live");
    expect(nextState.status).toBe("live");
    expect(nextState.playbackSources[0]?.url).toBe(
      "https://www.floatplane.com/api/video/v1/live-path.m3u8"
    );
    expect(nextState.posterUrl).toBe("https://pbs.floatplane.com/thumb.jpeg");
  });
});
