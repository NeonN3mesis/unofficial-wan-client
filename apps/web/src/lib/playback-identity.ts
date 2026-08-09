import type { PlaybackSource, WanLiveState } from "@shared";

function hasStableLivePlaybackSource(
  liveState: WanLiveState | null,
  source: PlaybackSource | null
): liveState is WanLiveState & { status: "live" } {
  return liveState?.status === "live" && Boolean(source?.url);
}

export function buildLiveStreamIdentity(
  liveState: WanLiveState | null,
  source: PlaybackSource | null
): string | null {
  if (!hasStableLivePlaybackSource(liveState, source)) {
    return null;
  }

  return [liveState.creatorId, source.id, liveState.startedAt ?? "live"].join("|");
}

export function buildLivePlaybackIdentity(
  liveState: WanLiveState | null,
  source: PlaybackSource | null
): string | null {
  const streamIdentity = buildLiveStreamIdentity(liveState, source);

  if (!streamIdentity) {
    return null;
  }

  return [streamIdentity, source.preferredPlayer].join("|");
}
