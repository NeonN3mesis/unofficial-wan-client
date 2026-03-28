export const upstreamLiveFixture = {
  channel: {
    id: "wan-show",
    creatorName: "Linus Tech Tips",
    scheduleNote: "Expected Fridays at 5:00 PM ET, but Floatplane live metadata capture is still pending."
  },
  stream: {
    title: "WAN Show Live Control Room",
    summary:
      "Fixture-backed live state for the custom WAN Show client. Replace with captured Floatplane payloads when the real playback and chat flows are mapped.",
    status: "live" as const,
    startedAt: "2026-03-27T23:30:00.000Z"
  },
  playback: {
    hlsUrl: "",
    mimeType: "application/x-mpegURL",
    latencyTarget: "low" as const,
    drm: false
  },
  chat: {
    transport: "sse" as const,
    readEnabled: true,
    sendEnabled: true,
    reason: "Fixture mode echoes local messages until the upstream send flow is captured."
  },
  notes: [
    "Observed public bundle flags show live-stream support and persisted chat settings.",
    "The official playback source request and live chat send request still need a browser-network capture before real Floatplane traffic can replace the fixtures.",
    "Set FLOATPLANE_FIXTURE_HLS_URL to a captured Floatplane HLS URL or any test stream during development."
  ]
};

