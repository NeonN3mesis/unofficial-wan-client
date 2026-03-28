import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import request from "supertest";
import { beforeEach, describe, expect, it } from "vitest";
import { createApp } from "../src/app.js";
import { FixtureFloatplaneAdapter } from "../src/services/floatplane-adapter.js";
import { SessionStore } from "../src/services/session-store.js";

function createTestHarness() {
  const sessionPath = path.join(os.tmpdir(), `wan-floatplane-${Date.now()}-${Math.random()}.json`);
  const storageStatePath = path.join(
    os.tmpdir(),
    `wan-floatplane-storage-${Date.now()}-${Math.random()}.json`
  );
  const captureSummaryPath = path.join(
    os.tmpdir(),
    `wan-floatplane-summary-${Date.now()}-${Math.random()}.json`
  );
  const probeResponsesPath = path.join(
    os.tmpdir(),
    `wan-floatplane-probes-${Date.now()}-${Math.random()}.json`
  );
  const adapter = new FixtureFloatplaneAdapter(new SessionStore(sessionPath, 5_000), {
    capturedStorageStateFilePath: storageStatePath,
    captureSummaryFilePath: captureSummaryPath,
    probeResponsesFilePath: probeResponsesPath,
    enableBrowserLiveProbe: false
  });
  const app = createApp(adapter);
  return { app, storageStatePath, captureSummaryPath, probeResponsesPath };
}

describe("BFF API", () => {
  beforeEach(() => {
    // Intentionally blank to keep test boundaries explicit.
  });

  it("bootstraps a local fixture session and returns live state", async () => {
    const { app } = createTestHarness();

    const bootstrapResponse = await request(app).post("/session/bootstrap").send({});
    expect(bootstrapResponse.status).toBe(200);
    expect(bootstrapResponse.body.status).toBe("authenticated");

    const liveResponse = await request(app).get("/wan/live");
    expect(liveResponse.status).toBe(200);
    expect(liveResponse.body.creatorId).toBe("wan-show");
    expect(liveResponse.body.chatCapability).toBeDefined();
  });

  it("rejects chat send when the user is not authenticated", async () => {
    const { app } = createTestHarness();

    const sendResponse = await request(app).post("/wan/chat/send").send({ body: "hello" });
    expect(sendResponse.status).toBe(401);
    expect(sendResponse.body.status).toBe("unauthenticated");
  });

  it("accepts a fixture chat send after bootstrap", async () => {
    const { app } = createTestHarness();

    await request(app).post("/session/bootstrap").send({});

    const sendResponse = await request(app).post("/wan/chat/send").send({ body: "hello WAN show" });
    expect(sendResponse.status).toBe(200);
    expect(sendResponse.body.status).toBe("sent");
    expect(sendResponse.body.message.body).toBe("hello WAN show");
  });

  it("loads captured storage state and captured playback summary from disk", async () => {
    const { app, storageStatePath, captureSummaryPath } = createTestHarness();

    await fs.writeFile(
      storageStatePath,
      JSON.stringify({
        cookies: [
          {
            name: "fp_session",
            value: "abc",
            domain: ".floatplane.com"
          }
        ],
        origins: []
      })
    );

    await fs.writeFile(
      captureSummaryPath,
      JSON.stringify({
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
        chatCandidates: [],
        selectedPlayback: {
          url: "https://edge.floatplane.com/live/wan/playlist.m3u8",
          kind: "hls",
          mimeType: "application/x-mpegURL"
        },
        chatTransport: "unknown",
        notes: ["Selected playback candidate from captured traffic"]
      })
    );

    const bootstrapResponse = await request(app).post("/session/bootstrap").send({});
    expect(bootstrapResponse.status).toBe(200);
    expect(bootstrapResponse.body.mode).toBe("storage-state");
    expect(bootstrapResponse.body.upstreamMode).toBe("pending-capture");

    const liveResponse = await request(app).get("/wan/live");
    expect(liveResponse.status).toBe(200);
    expect(liveResponse.body.upstreamMode).toBe("pending-capture");
    expect(liveResponse.body.playbackSources[0].url).toMatch(
      /^\/wan\/playback\/[a-f0-9]{20}\/manifest\.m3u8$/
    );
  });

  it("prefers probed creator live metadata when probe responses exist", async () => {
    const { app, storageStatePath, probeResponsesPath } = createTestHarness();

    await fs.writeFile(
      storageStatePath,
      JSON.stringify({
        cookies: [
          {
            name: "fp_session",
            value: "abc",
            domain: ".floatplane.com"
          }
        ],
        origins: []
      })
    );

    await fs.writeFile(
      probeResponsesPath,
      JSON.stringify({
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
                description: "<p>Real stream</p>",
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
                    enabled: true
                  }
                ]
              }
            ]
          }
        }
      })
    );

    await request(app).post("/session/bootstrap").send({});
    const liveResponse = await request(app).get("/wan/live");

    expect(liveResponse.status).toBe(200);
    expect(liveResponse.body.streamTitle).toBe("WAN Show Live");
    expect(liveResponse.body.playbackSources[0].url).toMatch(
      /^\/wan\/playback\/[a-f0-9]{20}\/manifest\.m3u8$/
    );
  });
});
