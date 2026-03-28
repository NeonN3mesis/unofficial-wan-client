import { describe, expect, it } from "vitest";
import { rewriteManifestBody } from "../src/routes/wan.js";

describe("rewriteManifestBody", () => {
  it("rewrites segment and key URIs through the local playback proxy", () => {
    const manifest = [
      "#EXTM3U",
      "#EXT-X-KEY:METHOD=AES-128,URI=\"keys/live.key\"",
      "segment-00001.ts",
      "https://de488bcb61af.us-east-1.playback.live-video.net/segment-00002.ts"
    ].join("\n");

    const rewritten = rewriteManifestBody(
      manifest,
      "https://de488bcb61af.us-east-1.playback.live-video.net/live/master.m3u8?token=abc123"
    );

    expect(rewritten.match(/\/wan\/playback\/[a-f0-9]{20}\/proxy/g)).toHaveLength(3);
  });
});
