import {
  fetchPlaybackResource,
  type BrowserFetchedResource
} from "./browser-playback.js";

export type PlaybackResourceKind = "manifest" | "segment" | "key" | "binary";
export type PlaybackCacheStatus = "miss" | "hit" | "inflight";

export interface PlaybackProxyResource extends BrowserFetchedResource {
  kind: PlaybackResourceKind;
  cacheControl: string;
  cacheStatus: PlaybackCacheStatus;
}

interface CachedPlaybackResource {
  kind: PlaybackResourceKind;
  status: number;
  contentType?: string;
  finalUrl: string;
  body: Buffer;
  expiresAt: number;
}

function normalizePathname(url: string): string {
  try {
    return new URL(url).pathname.toLowerCase();
  } catch {
    return url.toLowerCase();
  }
}

export function inferPlaybackResourceKind(
  url: string,
  contentType?: string
): PlaybackResourceKind {
  const normalizedContentType = (contentType ?? "").toLowerCase();
  const pathname = normalizePathname(url);

  if (
    normalizedContentType.includes("mpegurl") ||
    pathname.endsWith(".m3u8")
  ) {
    return "manifest";
  }

  if (pathname.endsWith(".key")) {
    return "key";
  }

  if (
    [
      ".m4s",
      ".mp4",
      ".m4a",
      ".m4v",
      ".ts",
      ".aac",
      ".cmfa",
      ".cmfv",
      ".webvtt",
      ".vtt"
    ].some((extension) => pathname.endsWith(extension))
  ) {
    return "segment";
  }

  return "binary";
}

export function cacheControlForPlaybackKind(kind: PlaybackResourceKind): string {
  switch (kind) {
    case "manifest":
      return "private, no-store";
    case "segment":
    case "key":
      return "private, max-age=300, immutable";
    case "binary":
    default:
      return "private, max-age=30";
  }
}

function ttlForPlaybackResource(kind: PlaybackResourceKind, status: number): number {
  const successTtlMs =
    kind === "manifest" ? 250 : kind === "binary" ? 30_000 : 5 * 60 * 1_000;

  if (status >= 400) {
    return Math.min(successTtlMs, 1_000);
  }

  return successTtlMs;
}

export class PlaybackProxyCache {
  private readonly cache = new Map<string, CachedPlaybackResource>();
  private readonly inflight = new Map<string, Promise<CachedPlaybackResource>>();

  constructor(
    private readonly fetcher: (url: string) => Promise<BrowserFetchedResource>,
    private readonly now: () => number = () => Date.now()
  ) {}

  private buildResource(
    cached: CachedPlaybackResource,
    cacheStatus: PlaybackCacheStatus
  ): PlaybackProxyResource {
    return {
      status: cached.status,
      contentType: cached.contentType,
      finalUrl: cached.finalUrl,
      body: Buffer.from(cached.body),
      kind: cached.kind,
      cacheControl: cacheControlForPlaybackKind(cached.kind),
      cacheStatus
    };
  }

  private pruneExpiredEntries(now = this.now()): void {
    for (const [url, cached] of this.cache.entries()) {
      if (cached.expiresAt <= now) {
        this.cache.delete(url);
      }
    }

    while (this.cache.size > 256) {
      const oldestKey = this.cache.keys().next().value;

      if (!oldestKey) {
        return;
      }

      this.cache.delete(oldestKey);
    }
  }

  async fetch(url: string): Promise<PlaybackProxyResource> {
    const now = this.now();
    const cached = this.cache.get(url);

    if (cached && cached.expiresAt > now) {
      return this.buildResource(cached, "hit");
    }

    if (cached) {
      this.cache.delete(url);
    }

    const pending = this.inflight.get(url);

    if (pending) {
      return this.buildResource(await pending, "inflight");
    }

    const request = (async () => {
      const fetched = await this.fetcher(url);
      const kind = inferPlaybackResourceKind(fetched.finalUrl || url, fetched.contentType);
      const resource: CachedPlaybackResource = {
        status: fetched.status,
        contentType: fetched.contentType,
        finalUrl: fetched.finalUrl,
        body: Buffer.from(fetched.body),
        kind,
        expiresAt: this.now() + ttlForPlaybackResource(kind, fetched.status)
      };

      this.cache.set(url, resource);
      this.pruneExpiredEntries();
      return resource;
    })();

    this.inflight.set(url, request);

    try {
      return this.buildResource(await request, "miss");
    } finally {
      this.inflight.delete(url);
    }
  }
}

export const playbackProxyCache = new PlaybackProxyCache(fetchPlaybackResource);
