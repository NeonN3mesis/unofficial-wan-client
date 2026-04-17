import { Readable } from "node:stream";
import { pipeline } from "node:stream/promises";
import { Router } from "express";
import type { WanLiveState } from "../../../../packages/shared/src/index.js";
import type { FloatplaneAdapter } from "../services/floatplane-adapter.js";
import { playbackProxyCache } from "../services/playback-proxy.js";
import { playbackTargetRegistry } from "../services/playback-registry.js";
import {
  cacheControlForPlaybackKind,
  inferPlaybackResourceKind
} from "../services/playback-proxy.js";
import {
  fetchFloatplaneResource,
  fetchFloatplaneStream
} from "../services/floatplane-http.js";

function ensureAuthenticated(status: Awaited<ReturnType<FloatplaneAdapter["getSessionState"]>>) {
  return status.status === "authenticated";
}

function toLocalPlaybackUrl(targetUrl: string, contentType?: string): string {
  return playbackTargetRegistry.buildLocalUrl(targetUrl, contentType);
}

function toClientPlaybackUrl(targetUrl: string, localOrigin?: string, contentType?: string): string {
  const localUrl = toLocalPlaybackUrl(targetUrl, contentType);

  if (!localOrigin) {
    return localUrl;
  }

  return new URL(localUrl, localOrigin).toString();
}

function rewriteManifestUri(uri: string, sourceUrl: string, localOrigin?: string): string {
  if (uri.startsWith("data:")) {
    return uri;
  }

  try {
    const resolvedUrl = new URL(uri, sourceUrl);
    const baseUrl = new URL(sourceUrl);

    for (const [key, value] of baseUrl.searchParams.entries()) {
      if (!resolvedUrl.searchParams.has(key)) {
        resolvedUrl.searchParams.set(key, value);
      }
    }

    const resolved = resolvedUrl.toString();
    const protocol = resolvedUrl.protocol.toLowerCase();

    if (protocol !== "http:" && protocol !== "https:") {
      return resolved;
    }

    return toClientPlaybackUrl(resolved, localOrigin);
  } catch {
    return uri;
  }
}

function rewriteSessionDataValue(value: string, sourceUrl: string, localOrigin?: string): string {
  try {
    const decoded = Buffer.from(value, "base64").toString("utf8");

    if (!/^https?:\/\//i.test(decoded)) {
      return value;
    }

    return Buffer.from(rewriteManifestUri(decoded, sourceUrl, localOrigin), "utf8").toString("base64");
  } catch {
    return value;
  }
}

function preferChunkedRenditions(lines: string[]): string[] {
  const hasChunkedVariant = lines.some(
    (line) =>
      (line.startsWith("#EXT-X-MEDIA:") && /TYPE=VIDEO/.test(line) && /GROUP-ID="chunked"/.test(line)) ||
      (line.startsWith("#EXT-X-STREAM-INF:") && /\bVIDEO="chunked"/.test(line))
  );

  if (!hasChunkedVariant) {
    return lines;
  }

  const filtered: string[] = [];

  for (let index = 0; index < lines.length; index += 1) {
    const line = lines[index];

    if (line.startsWith("#EXT-X-MEDIA:") && /TYPE=VIDEO/.test(line) && !/GROUP-ID="chunked"/.test(line)) {
      continue;
    }

    if (line.startsWith("#EXT-X-STREAM-INF:") && !/\bVIDEO="chunked"/.test(line)) {
      index += 1;
      continue;
    }

    filtered.push(line);
  }

  return filtered;
}

export function rewriteManifestBody(
  manifestBody: string,
  sourceUrl: string,
  localOrigin?: string
): string {
  return preferChunkedRenditions(manifestBody.split(/\r?\n/))
    .map((line) => {
      if (!line) {
        return line;
      }

      if (line.startsWith("#EXT-X-PREFETCH:")) {
        return `#EXT-X-PREFETCH:${rewriteManifestUri(
          line.slice("#EXT-X-PREFETCH:".length),
          sourceUrl,
          localOrigin
        )}`;
      }

      if (line.startsWith("#")) {
        return line
          .replace(/URI="([^"]+)"/g, (_match, uri: string) => {
            return `URI="${rewriteManifestUri(uri, sourceUrl, localOrigin)}"`;
          })
          .replace(/VALUE="([^"]+)"/g, (_match, value: string) => {
            return `VALUE="${rewriteSessionDataValue(value, sourceUrl, localOrigin)}"`;
          });
      }

      return rewriteManifestUri(line, sourceUrl, localOrigin);
    })
    .join("\n");
}

function toClientLiveState(liveState: WanLiveState): WanLiveState {
  return {
    ...liveState,
    playbackSources: liveState.playbackSources.map((source) => {
      if (
        !source.url ||
        source.url.startsWith("/wan/playback/")
      ) {
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

  router.get("/live", async (request, response, next) => {
    try {
      const session = await adapter.getSessionState();

      if (!ensureAuthenticated(session)) {
        response.status(401).json(session);
        return;
      }

      const forceRefresh = request.query.force === "1";
      const liveState = await adapter.getWanLiveState(forceRefresh);
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
      const localOrigin = `${request.protocol}://${request.get("host")}`;
      const rewritten = rewriteManifestBody(manifestBody, fetched.finalUrl || target, localOrigin);

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

      const abortController = new AbortController();
      response.on("close", () => {
        if (!response.writableEnded) {
          abortController.abort();
        }
      });

      const streamed = await fetchFloatplaneStream(target, {
        accept: "application/x-mpegURL,application/vnd.apple.mpegurl,*/*",
        headers:
          typeof request.headers.range === "string"
            ? {
                Range: request.headers.range
              }
            : undefined,
        signal: abortController.signal
      });
      const finalUrl = streamed.finalUrl || target;
      const contentType = streamed.contentType ?? "";
      const resourceKind = inferPlaybackResourceKind(finalUrl, contentType);

      response.setHeader("X-Relay-Cache", "stream");
      response.setHeader("Cache-Control", cacheControlForPlaybackKind(resourceKind));

      if (contentType.toLowerCase().includes("mpegurl") || finalUrl.toLowerCase().includes(".m3u8")) {
        if (streamed.body) {
          await streamed.body.cancel().catch(() => {});
        }

        const fetched = await fetchFloatplaneResource(target, {
          accept: "application/x-mpegURL,application/vnd.apple.mpegurl,*/*"
        });
        const localOrigin = `${request.protocol}://${request.get("host")}`;
        const rewritten = rewriteManifestBody(
          fetched.body.toString("utf8"),
          fetched.finalUrl || target,
          localOrigin
        );
        response.setHeader("Content-Type", "application/x-mpegURL");
        response.send(rewritten);
        return;
      }

      if (streamed.contentType) {
        response.setHeader("Content-Type", streamed.contentType);
      }

      for (const headerName of [
        "accept-ranges",
        "content-length",
        "content-range",
        "etag",
        "last-modified"
      ]) {
        const headerValue = streamed.headers.get(headerName);

        if (headerValue) {
          response.setHeader(headerName, headerValue);
        }
      }

      response.status(streamed.status);

      if (!streamed.body) {
        response.end();
        return;
      }

      await pipeline(
        Readable.fromWeb(streamed.body as unknown as Parameters<typeof Readable.fromWeb>[0]),
        response
      );
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === "ERR_STREAM_PREMATURE_CLOSE" || (error instanceof Error && error.name === "AbortError")) {
        return;
      }
      next(error);
    }
  });

  return router;
}
