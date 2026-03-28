import { serverConfig } from "./config.js";
import { BackgroundAudioMonitor } from "./services/background-audio-monitor.js";
import { startServer } from "./server.js";

void startServer().then(({ adapter, host, port }) => {
  console.log(`WAN Show Floatplane BFF listening on http://${host}:${port}`);

  void adapter.bootstrapSession().catch((error) => {
    console.error("Initial session bootstrap failed:", error);
  });

  if (serverConfig.backgroundAudioEnabled) {
    const monitor = new BackgroundAudioMonitor(adapter, {
      baseUrl: `http://${host}:${port}`
    });

    monitor.on("launch", ({ playbackUrl, streamTitle }) => {
      console.log(`Background audio launch: ${streamTitle} -> ${playbackUrl}`);
    });
    monitor.start();
  }
}).catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
