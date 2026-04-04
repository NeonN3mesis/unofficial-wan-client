import { describe, expect, it } from "vitest";
import { rewriteManifestBody } from "../src/routes/wan.js";

describe("rewriteManifestBody", () => {
  const localOrigin = "http://127.0.0.1:4318";

  it("rewrites manifest URIs and media resources through the local playback relay", () => {
    const manifest = [
      "#EXTM3U",
      "#EXT-X-KEY:METHOD=AES-128,URI=\"keys/live.key\"",
      "variant-720p.m3u8",
      "segment-00001.ts",
      "https://de488bcb61af.us-east-1.playback.live-video.net/segment-00002.ts"
    ].join("\n");

    const rewritten = rewriteManifestBody(
      manifest,
      "https://de488bcb61af.us-east-1.playback.live-video.net/live/master.m3u8?token=abc123",
      localOrigin
    );

    expect(
      rewritten.match(/http:\/\/127\.0\.0\.1:4318\/wan\/playback\/[a-f0-9]{20}\/manifest\.m3u8/g)
    ).toHaveLength(1);
    expect(rewritten.match(/http:\/\/127\.0\.0\.1:4318\/wan\/playback\/[a-f0-9]{20}\/proxy/g)).toHaveLength(3);
    expect(rewritten).toContain('URI="http://127.0.0.1:4318/wan/playback/');
  });

  it("prefers chunked variants when they are present in a live master manifest", () => {
    const manifest = [
      "#EXTM3U",
      "#EXT-X-MEDIA:TYPE=AUDIO,GROUP-ID=\"audio\",NAME=\"aac\",AUTOSELECT=YES,DEFAULT=YES",
      "#EXT-X-MEDIA:TYPE=VIDEO,GROUP-ID=\"480p30\",NAME=\"480p\",AUTOSELECT=YES,DEFAULT=YES",
      "#EXT-X-STREAM-INF:BANDWIDTH=1427999,RESOLUTION=852x480,CODECS=\"avc1.4D401F,mp4a.40.2\",VIDEO=\"480p30\",FRAME-RATE=30.000",
      "480p.m3u8",
      "#EXT-X-MEDIA:TYPE=VIDEO,GROUP-ID=\"chunked\",NAME=\"1080p\",AUTOSELECT=YES,DEFAULT=YES",
      "#EXT-X-STREAM-INF:BANDWIDTH=4273997,RESOLUTION=1920x1080,CODECS=\"avc1.4D402A,mp4a.40.2\",VIDEO=\"chunked\",FRAME-RATE=30.000",
      "1080p-chunked.m3u8",
      "#EXT-X-MEDIA:TYPE=VIDEO,GROUP-ID=\"720p30\",NAME=\"720p\",AUTOSELECT=YES,DEFAULT=YES",
      "#EXT-X-STREAM-INF:BANDWIDTH=2373000,RESOLUTION=1280x720,CODECS=\"avc1.4D401F,mp4a.40.2\",VIDEO=\"720p30\",FRAME-RATE=30.000",
      "720p.m3u8"
    ].join("\n");

    const rewritten = rewriteManifestBody(
      manifest,
      "https://de488bcb61af.us-east-1.playback.live-video.net/live/master.m3u8?token=abc123",
      localOrigin
    );

    expect(rewritten).toContain('GROUP-ID="chunked"');
    expect(rewritten).toContain('GROUP-ID="audio"');
    expect(rewritten).toContain('VIDEO="chunked"');
    expect(rewritten).not.toContain('GROUP-ID="480p30"');
    expect(rewritten).not.toContain('GROUP-ID="720p30"');
    expect(
      rewritten.match(/http:\/\/127\.0\.0\.1:4318\/wan\/playback\/[a-f0-9]{20}\/manifest\.m3u8/g)
    ).toHaveLength(1);
  });

  it("rewrites low-latency prefetch lines in child manifests", () => {
    const manifest = [
      "#EXTM3U",
      "#EXT-X-TARGETDURATION:6",
      "#EXTINF:4.000,live",
      "segment-00001.ts",
      "#EXT-X-PREFETCH:segment-00002.ts"
    ].join("\n");

    const rewritten = rewriteManifestBody(
      manifest,
      "https://playlist.live-video.net/v1/playlist/example.m3u8?token=abc123",
      localOrigin
    );

    expect(rewritten.match(/http:\/\/127\.0\.0\.1:4318\/wan\/playback\/[a-f0-9]{20}\/proxy/g)).toHaveLength(2);
    expect(rewritten).toContain("#EXT-X-PREFETCH:http://127.0.0.1:4318/wan/playback/");
  });

  it("rewrites base64-encoded IVS session-data segment URLs through the local relay", () => {
    const directSegmentUrl =
      "https://video-edge-47127a.sjc05.hls.live-video.net/v1/segment/example.ts";
    const manifest = [
      "#EXTM3U",
      `#EXT-X-SESSION-DATA:DATA-ID=\"C\",VALUE=\"${Buffer.from(directSegmentUrl, "utf8").toString("base64")}\"`
    ].join("\n");

    const rewritten = rewriteManifestBody(
      manifest,
      "https://de488bcb61af.us-east-1.playback.live-video.net/live/master.m3u8?token=abc123",
      localOrigin
    );
    const encodedValue = rewritten.match(/VALUE=\"([^\"]+)\"/)?.[1];

    expect(encodedValue).toBeDefined();
    expect(Buffer.from(encodedValue!, "base64").toString("utf8")).toMatch(
      /^http:\/\/127\.0\.0\.1:4318\/wan\/playback\/[a-f0-9]{20}\/proxy$/
    );
  });
});
