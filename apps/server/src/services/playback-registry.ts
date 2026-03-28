import { createHash } from "node:crypto";
import { inferPlaybackResourceKind, type PlaybackResourceKind } from "./playback-proxy.js";

interface RegisteredPlaybackTarget {
  url: string;
  route: "manifest" | "proxy";
  createdAt: number;
}

function toRoute(url: string, contentType?: string): "manifest" | "proxy" {
  return inferPlaybackResourceKind(url, contentType) === "manifest" ? "manifest" : "proxy";
}

export class PlaybackTargetRegistry {
  private readonly targets = new Map<string, RegisteredPlaybackTarget>();

  register(url: string, contentType?: string): string {
    const id = createHash("sha256").update(url).digest("hex").slice(0, 20);
    this.targets.set(id, {
      url,
      route: toRoute(url, contentType),
      createdAt: Date.now()
    });
    this.prune();
    return id;
  }

  resolve(id: string): RegisteredPlaybackTarget | null {
    return this.targets.get(id) ?? null;
  }

  buildLocalUrl(url: string, contentType?: string): string {
    const id = this.register(url, contentType);
    const target = this.targets.get(id)!;

    return target.route === "manifest"
      ? `/wan/playback/${id}/manifest.m3u8`
      : `/wan/playback/${id}/proxy`;
  }

  private prune(): void {
    const cutoff = Date.now() - 1000 * 60 * 60 * 6;

    for (const [id, target] of this.targets.entries()) {
      if (target.createdAt < cutoff) {
        this.targets.delete(id);
      }
    }
  }
}

export const playbackTargetRegistry = new PlaybackTargetRegistry();
