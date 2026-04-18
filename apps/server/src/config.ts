import path from "node:path";

const dataDir = path.resolve(
  process.cwd(),
  process.env.FLOATPLANE_DATA_DIR ?? "apps/server/data"
);

export const serverConfig = {
  host: process.env.HOST ?? "127.0.0.1",
  port: Number(process.env.PORT ?? 4318),
  dataDir,
  webDistDir: process.env.FLOATPLANE_WEB_DIST_DIR
    ? path.resolve(process.cwd(), process.env.FLOATPLANE_WEB_DIST_DIR)
    : undefined,
  sessionFilePath: path.resolve(dataDir, "floatplane-session.json"),
  storageStateFilePath: path.resolve(dataDir, "floatplane-storage-state.json"),
  captureSummaryFilePath: path.resolve(dataDir, "floatplane-capture-summary.json"),
  probeResponsesPath: path.resolve(dataDir, "floatplane-api-probes.json"),
  captureHarFilePath: path.resolve(dataDir, "floatplane-capture.har"),
  captureNetworkLogPath: path.resolve(dataDir, "floatplane-network-log.json"),
  captureProfileDir: path.resolve(dataDir, "floatplane-capture-profile"),
  captureBrowserPath: process.env.FLOATPLANE_CAPTURE_BROWSER,
  captureAttachUrl: process.env.FLOATPLANE_CAPTURE_ATTACH_URL,
  captureDebugPort: Number(process.env.FLOATPLANE_CAPTURE_DEBUG_PORT ?? 9222),
  captureStartUrl: process.env.FLOATPLANE_CAPTURE_URL ?? "https://www.floatplane.com/",
  wanLiveUrl:
    process.env.FLOATPLANE_WAN_LIVE_URL ?? "https://www.floatplane.com/live/linustechtips",
  enableBrowserChatRelay:
    process.env.FLOATPLANE_ENABLE_BROWSER_CHAT_RELAY === undefined
      ? true
      : process.env.FLOATPLANE_ENABLE_BROWSER_CHAT_RELAY === "1",
  enableBrowserLiveProbe:
    process.env.FLOATPLANE_ENABLE_BROWSER_LIVE_PROBE === undefined
      ? true
      : process.env.FLOATPLANE_ENABLE_BROWSER_LIVE_PROBE === "1",
  liveProbeCacheMs: Number(process.env.FLOATPLANE_LIVE_PROBE_CACHE_MS ?? 20_000),
  backgroundAudioEnabled:
    process.env.FLOATPLANE_BACKGROUND_AUDIO === undefined
      ? false
      : process.env.FLOATPLANE_BACKGROUND_AUDIO === "1",
  backgroundAudioPollMs: Number(process.env.FLOATPLANE_BACKGROUND_AUDIO_POLL_MS ?? 20_000),
  backgroundAudioPlayerPath:
    process.env.FLOATPLANE_BACKGROUND_AUDIO_PLAYER ?? "/usr/bin/ffplay",
  fixturePlaybackUrl:
    process.env.FLOATPLANE_FIXTURE_HLS_URL ?? "https://test-streams.mux.dev/x36xhzz/x36xhzz.m3u8",
  fixtureSendEnabled:
    process.env.FLOATPLANE_FIXTURE_ALLOW_SEND === undefined
      ? true
      : process.env.FLOATPLANE_FIXTURE_ALLOW_SEND === "1",
  fixtureMessageCadenceMs: Number(process.env.FLOATPLANE_FIXTURE_MESSAGE_CADENCE_MS ?? 12000),
  allowFixtureBootstrap:
    process.env.FLOATPLANE_DISABLE_FIXTURE_BOOTSTRAP === "1" ? false : true,
  sessionTtlMs: Number(process.env.FLOATPLANE_SESSION_TTL_MS ?? 1000 * 60 * 60 * 8),
  enableVerboseLogging: process.env.FLOATPLANE_VERBOSE_LOGGING === "1"
} as const;
