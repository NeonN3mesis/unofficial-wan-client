import type {
  ChatCapability,
  ChatMessage,
  PlaybackSource,
  SessionMode,
  SessionState,
  UpstreamMode,
  WanLiveState
} from "../../../../packages/shared/src/index.js";

interface RawLiveFixture {
  channel?: {
    id?: string;
    creatorName?: string;
    scheduleNote?: string;
  };
  stream?: {
    title?: string;
    summary?: string;
    status?: "live" | "offline" | "scheduled";
    startedAt?: string;
  };
  playback?: {
    hlsUrl?: string;
    mimeType?: string;
    latencyTarget?: "standard" | "low";
    drm?: boolean;
  };
  chat?: {
    transport?: "sse" | "websocket" | "unknown";
    readEnabled?: boolean;
    sendEnabled?: boolean;
    reason?: string;
  };
  notes?: string[];
}

interface RawChatFixtureItem {
  id?: string;
  authorName?: string;
  authorRole?: ChatMessage["authorRole"];
  body?: string;
  accentColor?: string;
  sentAt?: string;
}

export function normalizeFixtureChat(raw: RawChatFixtureItem[]): ChatMessage[] {
  return raw.map((item, index) => ({
    id: item.id ?? `fixture-${index + 1}`,
    authorName: item.authorName?.trim() || "Unknown",
    authorRole: item.authorRole ?? "guest",
    body: item.body?.trim() || "Fixture message missing body.",
    accentColor: item.accentColor,
    sentAt: item.sentAt ?? new Date().toISOString(),
    source: "fixture"
  }));
}

function buildPlaybackSources(raw: RawLiveFixture, fallbackUrl?: string): PlaybackSource[] {
  const playbackUrl = raw.playback?.hlsUrl || fallbackUrl;

  if (!playbackUrl) {
    return [
      {
        id: "pending-capture",
        label: "Awaiting captured Floatplane playback source",
        kind: "unresolved",
        drm: false,
        latencyTarget: "low"
      }
    ];
  }

  return [
    {
      id: "fixture-hls",
      label: "Primary stream",
      kind: "hls",
      url: playbackUrl,
      mimeType: raw.playback?.mimeType ?? "application/x-mpegURL",
      drm: raw.playback?.drm ?? false,
      latencyTarget: raw.playback?.latencyTarget ?? "standard"
    }
  ];
}

function buildChatCapability(raw: RawLiveFixture, sendEnabled: boolean): ChatCapability {
  const canRead = raw.chat?.readEnabled ?? true;
  const canSend = canRead && sendEnabled && (raw.chat?.sendEnabled ?? true);

  return {
    canRead,
    canSend,
    mode: canSend ? "full" : "read-only",
    transport: raw.chat?.transport ?? "sse",
    reason: raw.chat?.reason
  };
}

export function normalizeFixtureLive(
  raw: RawLiveFixture,
  options: {
    fallbackPlaybackUrl?: string;
    sendEnabled: boolean;
    upstreamMode?: UpstreamMode;
  }
): WanLiveState {
  const playbackSources = buildPlaybackSources(raw, options.fallbackPlaybackUrl);
  const notes = [...(raw.notes ?? [])];

  if (playbackSources[0]?.kind === "unresolved") {
    notes.unshift("Playback is waiting on a captured Floatplane HLS source or a development fixture URL.");
  }

  return {
    creatorId: "wan-show",
    creatorName: raw.channel?.creatorName?.trim() || "Linus Tech Tips",
    streamTitle: raw.stream?.title?.trim() || "WAN Show feed unavailable",
    summary:
      raw.stream?.summary?.trim() ||
      "The local BFF is up, but upstream live metadata is missing from the captured fixture.",
    status: raw.stream?.status ?? "offline",
    startedAt: raw.stream?.startedAt,
    scheduleNote: raw.channel?.scheduleNote,
    playbackSources,
    chatCapability: buildChatCapability(raw, options.sendEnabled),
    upstreamMode: options.upstreamMode ?? "fixture",
    notes
  };
}

export function createSessionState(options: {
  status: SessionState["status"];
  mode: SessionMode;
  upstreamMode?: UpstreamMode;
  hasPersistedSession: boolean;
  cookieCount?: number;
  message: string;
  nextAction?: SessionState["nextAction"];
  lastValidatedAt?: string;
  expiresAt?: string;
}): SessionState {
  return {
    status: options.status,
    mode: options.mode,
    upstreamMode: options.upstreamMode ?? "fixture",
    hasPersistedSession: options.hasPersistedSession,
    cookieCount: options.cookieCount ?? 0,
    loginUrl: "https://www.floatplane.com/login",
    message: options.message,
    nextAction: options.nextAction,
    lastValidatedAt: options.lastValidatedAt,
    expiresAt: options.expiresAt
  };
}
