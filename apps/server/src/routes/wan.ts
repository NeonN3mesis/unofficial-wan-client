import { Router } from "express";
import type { WanLiveState } from "../../../../packages/shared/src/index.js";
import type { FloatplaneAdapter } from "../services/floatplane-adapter.js";
import { playbackProxyCache } from "../services/playback-proxy.js";
import { playbackTargetRegistry } from "../services/playback-registry.js";

function ensureAuthenticated(status: Awaited<ReturnType<FloatplaneAdapter["getSessionState"]>>) {
  return status.status === "authenticated";
}

function toLocalPlaybackUrl(targetUrl: string, contentType?: string): string {
  return playbackTargetRegistry.buildLocalUrl(targetUrl, contentType);
}

function rewriteManifestUri(uri: string, sourceUrl: string): string {
  if (uri.startsWith("data:")) {
    return uri;
  }

  try {
    const resolved = new URL(uri, sourceUrl).toString();
    const protocol = new URL(resolved).protocol.toLowerCase();
    return protocol === "http:" || protocol === "https:" ? toLocalPlaybackUrl(resolved) : resolved;
  } catch {
    return uri;
  }
}

export function rewriteManifestBody(manifestBody: string, sourceUrl: string): string {
  return manifestBody
    .split(/\r?\n/)
    .map((line) => {
      if (!line) {
        return line;
      }

      if (line.startsWith("#")) {
        return line.replace(/URI="([^"]+)"/g, (_match, uri: string) => {
          return `URI="${rewriteManifestUri(uri, sourceUrl)}"`;
        });
      }

      return rewriteManifestUri(line, sourceUrl);
    })
    .join("\n");
}

function toClientLiveState(liveState: WanLiveState): WanLiveState {
  return {
    ...liveState,
    playbackSources: liveState.playbackSources.map((source) => {
      if (!source.url || source.url.startsWith("/wan/playback/")) {
        return source;
      }

      try {
        const protocol = new URL(source.url).protocol.toLowerCase();

        if (protocol !== "http:" && protocol !== "https:") {
          return source;
        }
      } catch {
        return source;
      }

      return {
        ...source,
        url: toLocalPlaybackUrl(source.url, source.mimeType)
      };
    })
  };
}

export function createWanRouter(adapter: FloatplaneAdapter): Router {
  const router = Router();

  router.get("/live", async (_request, response, next) => {
    try {
      const session = await adapter.getSessionState();

      if (!ensureAuthenticated(session)) {
        response.status(401).json(session);
        return;
      }

      const liveState = await adapter.getWanLiveState();
      response.json(toClientLiveState(liveState));
    } catch (error) {
      next(error);
    }
  });

  router.get("/chat/stream", async (request, response, next) => {
    try {
      const session = await adapter.getSessionState();

      if (!ensureAuthenticated(session)) {
        response.status(401).end();
        return;
      }

      response.setHeader("Content-Type", "text/event-stream");
      response.setHeader("Cache-Control", "no-cache, no-transform");
      response.setHeader("Connection", "keep-alive");
      response.flushHeaders();

      response.write(`data: ${JSON.stringify(adapter.getChatSnapshot())}\n\n`);

      const unsubscribe = adapter.subscribeToChat((event) => {
        response.write(`data: ${JSON.stringify(event)}\n\n`);
      });

      const heartbeatHandle = setInterval(() => {
        response.write(`data: ${JSON.stringify({ type: "heartbeat", sentAt: new Date().toISOString() })}\n\n`);
      }, 15000);

      request.on("close", () => {
        clearInterval(heartbeatHandle);
        unsubscribe();
      });
    } catch (error) {
      next(error);
    }
  });

  router.post("/chat/send", async (request, response, next) => {
    try {
      const session = await adapter.getSessionState();

      if (!ensureAuthenticated(session)) {
        response.status(401).json({
          status: "unauthenticated",
          message: "Bootstrap the Floatplane session before sending chat."
        });
        return;
      }

      const body =
        typeof request.body?.body === "string" ? request.body.body.trim().slice(0, 500) : "";

      if (!body) {
        response.status(400).json({
          status: "upstream_error",
          message: "Chat body is required."
        });
        return;
      }

      const result = await adapter.sendChatMessage(body);
      response.status(result.status === "sent" ? 200 : result.status === "rate_limited" ? 429 : 400).json(result);
    } catch (error) {
      next(error);
    }
  });

  router.get("/playback/:id/manifest.m3u8", async (request, response, next) => {
    try {
      const session = await adapter.getSessionState();

      if (!ensureAuthenticated(session)) {
        response.status(401).end();
        return;
      }

      const target = playbackTargetRegistry.resolve(request.params.id ?? "")?.url ?? "";

      if (!target) {
        response.status(404).send("Unknown playback target.");
        return;
      }

      const fetched = await playbackProxyCache.fetch(target);
      response.setHeader("X-Relay-Cache", fetched.cacheStatus);
      response.setHeader("Cache-Control", fetched.cacheControl);

      if (fetched.status >= 400) {
        response.status(fetched.status).send(fetched.body);
        return;
      }

      const manifestBody = fetched.body.toString("utf8");
      const rewritten = rewriteManifestBody(manifestBody, fetched.finalUrl || target);

      response.setHeader("Content-Type", "application/x-mpegURL");
      response.send(rewritten);
    } catch (error) {
      next(error);
    }
  });

  router.get("/playback/:id/proxy", async (request, response, next) => {
    try {
      const session = await adapter.getSessionState();

      if (!ensureAuthenticated(session)) {
        response.status(401).end();
        return;
      }

      const target = playbackTargetRegistry.resolve(request.params.id ?? "")?.url ?? "";

      if (!target) {
        response.status(404).send("Unknown playback target.");
        return;
      }

      const fetched = await playbackProxyCache.fetch(target);
      response.setHeader("X-Relay-Cache", fetched.cacheStatus);
      response.setHeader("Cache-Control", fetched.cacheControl);

      if (
        (fetched.contentType ?? "").toLowerCase().includes("mpegurl") ||
        (fetched.finalUrl || target).toLowerCase().includes(".m3u8")
      ) {
        const rewritten = rewriteManifestBody(fetched.body.toString("utf8"), fetched.finalUrl || target);
        response.setHeader("Content-Type", "application/x-mpegURL");
        response.send(rewritten);
        return;
      }

      if (fetched.contentType) {
        response.setHeader("Content-Type", fetched.contentType);
      }

      response.status(fetched.status).send(fetched.body);
    } catch (error) {
      next(error);
    }
  });

  return router;
}
