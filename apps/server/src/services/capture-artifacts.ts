import fs from "node:fs/promises";
import type { SessionBootstrapRequest, WanLiveState } from "../../../../packages/shared/src/index.js";

export interface CaptureObservation {
  kind: "request" | "response" | "websocket";
  observedAt: string;
  url: string;
  method?: string;
  status?: number;
  contentType?: string;
  resourceType?: string;
  postDataSnippet?: string;
}

export interface FloatplaneCaptureCandidate {
  observedAt: string;
  url: string;
  method?: string;
  status?: number;
  contentType?: string;
  resourceType?: string;
}

export interface FloatplaneCaptureSummary {
  generatedAt: string;
  sourceHarPath?: string;
  sourceNetworkLogPath?: string;
  authCandidates: FloatplaneCaptureCandidate[];
  liveCandidates: FloatplaneCaptureCandidate[];
  playbackCandidates: FloatplaneCaptureCandidate[];
  chatCandidates: FloatplaneCaptureCandidate[];
  selectedPlayback?: {
    url: string;
    kind: "hls" | "dash";
    mimeType?: string;
  };
  chatTransport: "sse" | "websocket" | "unknown";
  notes: string[];
}

export interface FloatplaneApiProbePayload {
  generatedAt: string;
  creatorNamed?: {
    status: number;
    ok: boolean;
    url: string;
    data: unknown;
  };
  creatorList?: {
    status: number;
    ok: boolean;
    url: string;
    data: unknown;
  };
  deliveryInfoLive?: {
    status: number;
    ok: boolean;
    url: string;
    data: unknown;
  };
  deliveryInfoLiveFallback?: {
    status: number;
    ok: boolean;
    url: string;
    data: unknown;
  };
}

interface ProbeCreatorNamedItem {
  id?: string;
  title?: string;
  urlname?: string;
  description?: string;
  liveStream?: {
    id?: string;
    title?: string;
    description?: string;
    startedAt?: string;
    streamPath?: string;
    thumbnail?: {
      path?: string;
    };
    owner?: string;
    channel?: string;
  };
}

interface ProbeDeliveryInfoVariant {
  name?: string;
  label?: string;
  url?: string;
  mimeType?: string;
  hidden?: boolean;
  enabled?: boolean;
  meta?: {
    live?: {
      lowLatencyExtension?: string;
    };
  };
}

interface ProbeDeliveryInfoGroup {
  origins?: Array<{
    url?: string;
  }>;
  variants?: ProbeDeliveryInfoVariant[];
}

interface ProbeDeliveryInfoPayload {
  groups?: ProbeDeliveryInfoGroup[];
}

function resolvePlaybackClassification(options: {
  kind: "hls" | "dash" | "mp4" | "unresolved";
  mimeType?: string;
  lowLatencyExtension?: string;
}): {
  preferredPlayer: "ivs" | "hls" | "native";
  deliveryPlatform: "ivs" | "generic";
} {
  if (options.lowLatencyExtension === "ivshls") {
    return {
      preferredPlayer: "ivs",
      deliveryPlatform: "ivs"
    };
  }

  if (options.kind === "hls") {
    return {
      preferredPlayer: "hls",
      deliveryPlatform: "generic"
    };
  }

  return {
    preferredPlayer: "native",
    deliveryPlatform: "generic"
  };
}

interface HarFile {
  log?: {
    entries?: Array<{
      startedDateTime?: string;
      request?: {
        method?: string;
        url?: string;
        postData?: {
          text?: string;
        };
      };
      response?: {
        status?: number;
        content?: {
          mimeType?: string;
        };
      };
    }>;
  };
}

function normalizeCandidate(observation: CaptureObservation): FloatplaneCaptureCandidate {
  return {
    observedAt: observation.observedAt,
    url: observation.url,
    method: observation.method,
    status: observation.status,
    contentType: observation.contentType,
    resourceType: observation.resourceType
  };
}

function dedupeCandidates(candidates: FloatplaneCaptureCandidate[]): FloatplaneCaptureCandidate[] {
  const seen = new Set<string>();
  const deduped: FloatplaneCaptureCandidate[] = [];

  for (const candidate of candidates) {
    const key = [candidate.method ?? "", candidate.url, candidate.status ?? ""].join("|");

    if (seen.has(key)) {
      continue;
    }

    seen.add(key);
    deduped.push(candidate);
  }

  return deduped;
}

function isFloatplaneUrl(url: string): boolean {
  try {
    const parsed = new URL(url);
    return /(^|\.)floatplane\.com$/i.test(parsed.hostname);
  } catch {
    return false;
  }
}

function isPlaybackObservation(observation: CaptureObservation): boolean {
  const url = observation.url.toLowerCase();
  const contentType = observation.contentType?.toLowerCase() ?? "";

  if (url.endsWith(".webmanifest") || contentType.includes("application/manifest+json")) {
    return false;
  }

  return (
    url.includes(".m3u8") ||
    url.includes(".mpd") ||
    url.includes("playlist") ||
    url.includes("manifest") ||
    contentType.includes("mpegurl") ||
    contentType.includes("dash+xml")
  );
}

function isChatObservation(observation: CaptureObservation): boolean {
  const url = observation.url.toLowerCase();
  const contentType = observation.contentType?.toLowerCase() ?? "";

  return (
    observation.kind === "websocket" ||
    observation.resourceType === "websocket" ||
    url.includes("chat") ||
    url.includes("message") ||
    url.includes("poll") ||
    contentType.includes("text/event-stream")
  );
}

function isAuthObservation(observation: CaptureObservation): boolean {
  const url = observation.url.toLowerCase();
  return (
    url.includes("login") ||
    url.includes("auth") ||
    url.includes("oauth") ||
    url.includes("session")
  );
}

function isLiveObservation(observation: CaptureObservation): boolean {
  const url = observation.url.toLowerCase();
  return (
    url.includes("live") ||
    url.includes("stream") ||
    url.includes("creator") ||
    url.includes("video") ||
    url.includes("channel")
  );
}

export async function loadCaptureSummary(filePath: string): Promise<FloatplaneCaptureSummary | null> {
  try {
    const file = await fs.readFile(filePath, "utf8");
    return JSON.parse(file) as FloatplaneCaptureSummary;
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") {
      return null;
    }

    throw error;
  }
}

export async function loadCapturedStorageState(
  filePath: string
): Promise<SessionBootstrapRequest["storageState"] | null> {
  try {
    const file = await fs.readFile(filePath, "utf8");
    return JSON.parse(file) as SessionBootstrapRequest["storageState"];
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") {
      return null;
    }

    throw error;
  }
}

export async function loadProbeResponses(filePath: string): Promise<FloatplaneApiProbePayload | null> {
  try {
    const file = await fs.readFile(filePath, "utf8");
    return JSON.parse(file) as FloatplaneApiProbePayload;
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") {
      return null;
    }

    throw error;
  }
}

export function summarizeCaptureObservations(
  observations: CaptureObservation[],
  options?: {
    sourceHarPath?: string;
    sourceNetworkLogPath?: string;
  }
): FloatplaneCaptureSummary {
  const scoped = observations.filter((observation) => isFloatplaneUrl(observation.url));
  const authCandidates = dedupeCandidates(scoped.filter(isAuthObservation).map(normalizeCandidate));
  const liveCandidates = dedupeCandidates(scoped.filter(isLiveObservation).map(normalizeCandidate));
  const playbackCandidates = dedupeCandidates(observations.filter(isPlaybackObservation).map(normalizeCandidate));
  const chatCandidates = dedupeCandidates(scoped.filter(isChatObservation).map(normalizeCandidate));
  const selectedPlayback = playbackCandidates.find(
    (candidate) => (candidate.status === undefined || candidate.status < 400) && candidate.url.includes(".m3u8")
  ) ??
    playbackCandidates.find(
      (candidate) => candidate.status === undefined || candidate.status < 400
    );

  const notes: string[] = [];

  if (selectedPlayback) {
    notes.push(`Selected playback candidate from captured traffic: ${selectedPlayback.url}`);
  } else {
    notes.push("No playback manifest candidate was found in the captured Floatplane traffic.");
  }

  if (chatCandidates.length === 0) {
    notes.push("No chat transport candidate was found. Capture the WAN Show live page with chat visible.");
  }

  if (authCandidates.length === 0) {
    notes.push("No explicit auth endpoint candidate was found; the session may rely mostly on cookies.");
  }

  return {
    generatedAt: new Date().toISOString(),
    sourceHarPath: options?.sourceHarPath,
    sourceNetworkLogPath: options?.sourceNetworkLogPath,
    authCandidates,
    liveCandidates,
    playbackCandidates,
    chatCandidates,
    selectedPlayback: selectedPlayback
      ? {
          url: selectedPlayback.url,
          kind: selectedPlayback.url.includes(".mpd") ? "dash" : "hls",
          mimeType: selectedPlayback.contentType
        }
      : undefined,
    chatTransport: chatCandidates.some((candidate) => candidate.resourceType === "websocket")
      ? "websocket"
      : chatCandidates.some((candidate) =>
            (candidate.contentType ?? "").toLowerCase().includes("text/event-stream")
          )
        ? "sse"
        : chatCandidates.some((candidate) => candidate.url.toLowerCase().includes("chat"))
          ? "websocket"
          : "unknown",
    notes
  };
}

function stripHtml(input?: string): string | undefined {
  if (!input) {
    return undefined;
  }

  return input.replace(/<[^>]+>/g, " ").replace(/\s+/g, " ").trim();
}

function resolveDeliveryProbe(
  probes: FloatplaneApiProbePayload | null
):
  | {
      status: number;
      ok: boolean;
      url: string;
      data: ProbeDeliveryInfoPayload;
    }
  | undefined {
  const candidates = [probes?.deliveryInfoLive, probes?.deliveryInfoLiveFallback];

  for (const candidate of candidates) {
    if (candidate?.status === 200 && candidate.data) {
      return candidate as {
        status: number;
        ok: boolean;
        url: string;
        data: ProbeDeliveryInfoPayload;
      };
    }
  }

  return undefined;
}

function resolvePlaybackSourceFromDeliveryProbe(
  probes: FloatplaneApiProbePayload | null
): WanLiveState["playbackSources"][number] | null {
  const deliveryProbe = resolveDeliveryProbe(probes);
  const groups = deliveryProbe?.data.groups ?? [];

  for (const group of groups) {
    const originUrl = group.origins?.find((origin) => origin.url)?.url;
    const variants = (group.variants ?? []).filter(
      (variant) => variant.enabled !== false && variant.hidden !== true && typeof variant.url === "string"
    );
    const variant =
      variants.find((candidate) => {
        const url = candidate.url?.toLowerCase() ?? "";
        const mimeType = candidate.mimeType?.toLowerCase() ?? "";
        return url.includes(".m3u8") || mimeType.includes("mpegurl");
      }) ?? variants[0];

    if (!variant?.url) {
      continue;
    }

    try {
      const targetUrl = new URL(variant.url, originUrl ?? "https://www.floatplane.com").toString();
      const kind =
        variant.mimeType?.toLowerCase().includes("dash") || variant.url.toLowerCase().includes(".mpd")
          ? "dash"
          : "hls";

      return {
        id: variant.name ?? "probe-delivery-variant",
        label: variant.label?.trim() || "Probed Floatplane live delivery",
        kind,
        url: targetUrl,
        mimeType:
          variant.mimeType ??
          (kind === "dash" ? "application/dash+xml" : "application/x-mpegURL"),
        drm: false,
        latencyTarget: variant.meta?.live?.lowLatencyExtension ? "low" : "standard",
        ...resolvePlaybackClassification({
          kind,
          mimeType: variant.mimeType,
          lowLatencyExtension: variant.meta?.live?.lowLatencyExtension
        })
      };
    } catch {
      continue;
    }
  }

  return null;
}

export function applyProbeResponsesToLiveState(
  baseState: WanLiveState,
  probes: FloatplaneApiProbePayload | null
): WanLiveState {
  const creator = Array.isArray(probes?.creatorNamed?.data)
    ? (probes?.creatorNamed?.data[0] as ProbeCreatorNamedItem | undefined)
    : undefined;

  if (!creator || probes?.creatorNamed?.status !== 200) {
    return baseState;
  }

  const liveStream = creator.liveStream;
  const deliveryPlayback = resolvePlaybackSourceFromDeliveryProbe(probes);
  const nextState: WanLiveState = {
    ...baseState,
    creatorName: creator.title?.trim() || baseState.creatorName,
    summary: stripHtml(liveStream?.description) || creator.description?.trim() || baseState.summary,
    startedAt: liveStream?.startedAt?.trim() || undefined,
    refreshedAt: probes.generatedAt,
    posterUrl: liveStream?.thumbnail?.path || baseState.posterUrl,
    upstreamMode: "pending-capture",
    notes: [
      "Using in-browser Floatplane API probe responses for creator and live stream metadata.",
      ...baseState.notes
    ]
  };

  if (liveStream?.title?.trim()) {
    nextState.streamTitle = liveStream.title.trim();
  }

  if (deliveryPlayback) {
    nextState.status = "live";
    nextState.playbackSources = [deliveryPlayback];
    nextState.notes = [
      "Resolved playback from saved Floatplane delivery-info probe data.",
      ...nextState.notes
    ];
  } else if (liveStream?.streamPath) {
    nextState.status = "live";
    nextState.playbackSources = [
      {
        id: liveStream.id ?? "probe-stream-path",
        label: "Probed Floatplane live stream",
        kind: liveStream.streamPath.endsWith(".mpd") ? "dash" : "hls",
        url:
          liveStream.streamPath.startsWith("http")
            ? liveStream.streamPath
            : `https://www.floatplane.com${liveStream.streamPath}`,
        mimeType: liveStream.streamPath.endsWith(".mpd")
          ? "application/dash+xml"
          : "application/x-mpegURL",
        drm: false,
        latencyTarget: "low",
        ...resolvePlaybackClassification({
          kind: liveStream.streamPath.endsWith(".mpd") ? "dash" : "hls"
        })
      }
    ];
  }

  return nextState;
}

export async function readHarObservations(filePath: string): Promise<CaptureObservation[]> {
  const file = await fs.readFile(filePath, "utf8");
  const har = JSON.parse(file) as HarFile;
  const entries = har.log?.entries ?? [];

  return entries.flatMap((entry) => {
    const requestUrl = entry.request?.url;

    if (!requestUrl) {
      return [];
    }

    const observedAt = entry.startedDateTime ?? new Date().toISOString();

    return [
      {
        kind: "request" as const,
        observedAt,
        url: requestUrl,
        method: entry.request?.method,
        postDataSnippet: entry.request?.postData?.text?.slice(0, 300),
        resourceType: "fetch"
      },
      {
        kind: "response" as const,
        observedAt,
        url: requestUrl,
        method: entry.request?.method,
        status: entry.response?.status,
        contentType: entry.response?.content?.mimeType,
        resourceType: "fetch"
      }
    ];
  });
}

export function applyCaptureSummaryToLiveState(
  baseState: WanLiveState,
  summary: FloatplaneCaptureSummary | null
): WanLiveState {
  if (!summary) {
    return baseState;
  }

  const nextState: WanLiveState = {
    ...baseState,
    refreshedAt: summary.generatedAt,
    upstreamMode: "pending-capture",
    notes: [...summary.notes, ...baseState.notes]
  };

  if (summary.selectedPlayback) {
    nextState.playbackSources = [
      {
        id: "captured-playback",
        label: "Captured Floatplane playback",
        kind: summary.selectedPlayback.kind,
        url: summary.selectedPlayback.url,
        mimeType: summary.selectedPlayback.mimeType,
        drm: false,
        latencyTarget: "low",
        ...resolvePlaybackClassification({
          kind: summary.selectedPlayback.kind,
          mimeType: summary.selectedPlayback.mimeType
        })
      }
    ];
    nextState.summary =
      "Playback is using a manifest captured from the official Floatplane web client. Live-state and chat routing still need full upstream wiring.";
  }

  if (summary.chatCandidates.length > 0) {
    nextState.chatCapability = {
      ...nextState.chatCapability,
      canSend: false,
      mode: "read-only",
      transport: summary.chatTransport,
      reason:
        "Captured Floatplane chat transport is present. The managed chat relay will determine when upstream send is actually available."
    };
  }

  return nextState;
}
