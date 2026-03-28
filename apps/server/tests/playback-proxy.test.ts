import { describe, expect, it } from "vitest";
import {
  PlaybackProxyCache,
  cacheControlForPlaybackKind,
  inferPlaybackResourceKind
} from "../src/services/playback-proxy.js";

describe("playback proxy cache", () => {
  it("classifies manifests, segments, and keys for conservative cache control", () => {
    expect(
      inferPlaybackResourceKind(
        "https://playback.live-video.net/master.m3u8?token=abc",
        "application/x-mpegURL"
      )
    ).toBe("manifest");
    expect(
      inferPlaybackResourceKind("https://playback.live-video.net/seg-0001.m4s", "video/mp4")
    ).toBe("segment");
    expect(
      inferPlaybackResourceKind("https://playback.live-video.net/enc/live.key", "application/octet-stream")
    ).toBe("key");

    expect(cacheControlForPlaybackKind("manifest")).toBe("private, no-store");
    expect(cacheControlForPlaybackKind("segment")).toBe("private, max-age=300, immutable");
  });

  it("deduplicates in-flight manifest fetches and only keeps live manifests hot briefly", async () => {
    let now = 0;
    let calls = 0;
    let resolveFirstFetch: ((value: {
      status: number;
      finalUrl: string;
      contentType: string;
      body: Buffer;
    }) => void) | undefined;

    const cache = new PlaybackProxyCache(
      async () => {
        calls += 1;

        if (calls === 1) {
          return new Promise((resolve) => {
            resolveFirstFetch = resolve;
          });
        }

        return {
          status: 200,
          finalUrl: "https://playback.live-video.net/master.m3u8",
          contentType: "application/x-mpegURL",
          body: Buffer.from("#EXTM3U")
        };
      },
      () => now
    );

    const first = cache.fetch("https://playback.live-video.net/master.m3u8");
    const second = cache.fetch("https://playback.live-video.net/master.m3u8");

    expect(calls).toBe(1);

    resolveFirstFetch?.({
      status: 200,
      finalUrl: "https://playback.live-video.net/master.m3u8",
      contentType: "application/x-mpegURL",
      body: Buffer.from("#EXTM3U")
    });

    const [firstResult, secondResult] = await Promise.all([first, second]);

    expect(firstResult.cacheStatus).toBe("miss");
    expect(secondResult.cacheStatus).toBe("inflight");

    const cachedResult = await cache.fetch("https://playback.live-video.net/master.m3u8");

    expect(cachedResult.cacheStatus).toBe("hit");
    expect(calls).toBe(1);

    now = 200;

    const stillHotResult = await cache.fetch("https://playback.live-video.net/master.m3u8");

    expect(stillHotResult.cacheStatus).toBe("hit");
    expect(calls).toBe(1);

    now = 300;

    await cache.fetch("https://playback.live-video.net/master.m3u8");
    expect(calls).toBe(2);
  });
});
