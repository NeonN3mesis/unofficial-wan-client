import { useEffect, useRef, useState } from "react";
import type { PlaybackDiagnostics, PlaybackSource, WanLiveState } from "@shared";
import {
  ErrorType as IvsErrorType,
  LogLevel as IvsLogLevel,
  PlayerEventType as IvsPlayerEventType,
  PlayerState as IvsPlayerState,
  create as createIvsPlayer,
  isPlayerSupported as isIvsPlayerSupported
} from "amazon-ivs-player";
import ivsWasmBinaryUrl from "amazon-ivs-player/dist/assets/amazon-ivs-wasmworker.min.wasm?url";
import ivsWasmWorkerUrl from "amazon-ivs-player/dist/assets/amazon-ivs-wasmworker.min.js?url";
import {
  evaluateHlsLiveCatchUp,
  evaluateNativeLiveCatchUp,
  type LiveCatchUpState
} from "../lib/live-playback";

interface VideoStageProps {
  liveState: WanLiveState | null;
  sessionMessage: string;
  launchSequence?: number;
  compactMode?: boolean;
  relayStatus?: "idle" | "connecting" | "live" | "reconnecting";
  onRecoveryChange?: (state: PlaybackRecoveryState) => void;
  onPlaybackSourceRefresh?: () => void;
  playbackReloadSequence?: number;
}

export interface PlaybackRecoveryState {
  state:
    | "idle"
    | "buffering"
    | "recovering-network"
    | "recovering-media"
    | "refreshing-source"
    | "error";
  message: string | null;
}

type IvsHandle = ReturnType<typeof createIvsPlayer> & {
  setLiveMaxLatency?: (seconds: number) => void;
  setLiveSpeedUpRate?: (rate: number) => void;
};

type HlsHandle = {
  destroy: () => void;
  loadSource: (url: string) => void;
  attachMedia: (media: HTMLMediaElement) => void;
  startLoad: (startPosition?: number, skipSeekToStartPosition?: boolean) => void;
  recoverMediaError: () => void;
  on: (
    event: string,
    handler: (_event: string, data: { fatal?: boolean; type?: string }) => void
  ) => void;
  latency: number;
  targetLatency: number | null;
  liveSyncPosition: number | null;
  currentLevel: number;
  levels: Array<{
    width?: number;
    height?: number;
    bitrate?: number;
    name?: string;
  }>;
};

interface PlaybackTelemetry {
  resolution: string | null;
  bitrateKbps: number | null;
  droppedFrames: number | null;
  bufferAheadSeconds: number | null;
  playbackRate: number | null;
}

type PlaybackEngine = PlaybackDiagnostics["engine"];

const PLAYER_MUTED_STORAGE_KEY = "wan-signal-player-muted";
const PLAYER_VOLUME_STORAGE_KEY = "wan-signal-player-volume";
const PLAYER_AUTO_LIVE_EDGE_STORAGE_KEY = "wan-signal-player-auto-live-edge";
const AUTO_HLS_SAFE_LIVE_SYNC_OFFSET_SECONDS = 0.3;
const MANUAL_HLS_SAFE_LIVE_SYNC_OFFSET_SECONDS = 0.05;
const AUTO_FALLBACK_EDGE_PADDING_SECONDS = 0.4;
const MANUAL_FALLBACK_EDGE_PADDING_SECONDS = 0.08;
const AUTO_IVS_EDGE_PADDING_SECONDS = 0.35;
const MANUAL_IVS_EDGE_PADDING_SECONDS = 0.05;
const IVS_INITIAL_BUFFER_SECONDS = 0.35;
const IVS_TARGET_MAX_LATENCY_SECONDS = 5;
const IVS_SPEED_UP_RATE = 1.08;
const IVS_EMERGENCY_CATCH_UP_THRESHOLD_SECONDS = 8.5;
const IVS_EMERGENCY_CATCH_UP_COOLDOWN_MS = 12_000;

function clampVolume(value: number): number {
  return Math.min(Math.max(value, 0), 1);
}

function toFiniteLatency(value: number | null | undefined): number | null {
  return typeof value === "number" && Number.isFinite(value) && value >= 0 ? value : null;
}

function getSeekableEdge(media: HTMLVideoElement): number | null {
  if (media.seekable.length === 0) {
    return null;
  }

  const edge = media.seekable.end(media.seekable.length - 1);
  return Number.isFinite(edge) ? edge : null;
}

function humanizeLabel(value: string | null | undefined): string {
  return (value ?? "")
    .replace(/[-_]+/g, " ")
    .replace(/\b\w/g, (character) => character.toUpperCase())
    .trim();
}

function formatStreamTimestamp(timestamp?: string): string {
  if (!timestamp) {
    return "Unavailable";
  }

  const parsed = Date.parse(timestamp);

  if (Number.isNaN(parsed)) {
    return "Unknown";
  }

  return new Intl.DateTimeFormat(undefined, {
    month: "short",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit"
  }).format(parsed);
}

function formatRelativeFreshness(timestamp?: string): string {
  if (!timestamp) {
    return "Unavailable";
  }

  const parsed = Date.parse(timestamp);

  if (Number.isNaN(parsed)) {
    return "Unknown";
  }

  const elapsedMs = Math.max(Date.now() - parsed, 0);
  const elapsedSeconds = Math.floor(elapsedMs / 1000);

  if (elapsedSeconds < 5) {
    return "Just now";
  }

  if (elapsedSeconds < 60) {
    return `${elapsedSeconds}s ago`;
  }

  const elapsedMinutes = Math.floor(elapsedSeconds / 60);

  if (elapsedMinutes < 60) {
    return `${elapsedMinutes}m ago`;
  }

  const elapsedHours = Math.floor(elapsedMinutes / 60);
  const remainingMinutes = elapsedMinutes % 60;

  if (elapsedHours < 24) {
    return remainingMinutes > 0 ? `${elapsedHours}h ${remainingMinutes}m ago` : `${elapsedHours}h ago`;
  }

  const elapsedDays = Math.floor(elapsedHours / 24);
  return `${elapsedDays}d ago`;
}

function formatUptime(timestamp?: string): string {
  if (!timestamp) {
    return "Not live";
  }

  const parsed = Date.parse(timestamp);

  if (Number.isNaN(parsed)) {
    return "Unknown";
  }

  const elapsedMs = Math.max(Date.now() - parsed, 0);
  const totalMinutes = Math.floor(elapsedMs / 60_000);
  const hours = Math.floor(totalMinutes / 60);
  const minutes = totalMinutes % 60;

  if (hours <= 0) {
    return `${Math.max(minutes, 1)}m`;
  }

  return `${hours}h ${minutes}m`;
}

function buildPlaybackIdentity(
  liveState: WanLiveState | null,
  source: PlaybackSource | null
): string | null {
  if (liveState?.status !== "live" || !source?.url) {
    return null;
  }

  return [
    liveState.creatorId,
    source.id,
    source.preferredPlayer,
    liveState.startedAt ?? "live"
  ].join("|");
}

function getPlaybackEngine(source: PlaybackSource | null): PlaybackEngine {
  if (!source?.url) {
    return "unknown";
  }

  return source.preferredPlayer;
}

function formatQualityLabel(source: PlaybackSource | null, resolution: string | null, bitrateKbps: number | null): string | null {
  if (resolution) {
    return bitrateKbps ? `${resolution} @ ${bitrateKbps} kbps` : resolution;
  }

  return source?.label ?? null;
}

export function VideoStage({
  liveState,
  sessionMessage,
  launchSequence = 0,
  compactMode = false,
  relayStatus = "idle",
  onRecoveryChange,
  onPlaybackSourceRefresh,
  playbackReloadSequence = 0
}: VideoStageProps) {
  const videoRef = useRef<HTMLVideoElement | null>(null);
  const hlsRef = useRef<HlsHandle | null>(null);
  const ivsRef = useRef<IvsHandle | null>(null);
  const playerMutedRef = useRef(false);
  const playerVolumeRef = useRef(1);
  const onPlaybackSourceRefreshRef = useRef(onPlaybackSourceRefresh);
  const previousMetadataSignatureRef = useRef<string | null>(null);
  const lastLoadedPlaybackIdentityRef = useRef<string | null>(null);
  const lastAppliedReloadSequenceRef = useRef<number>(0);
  const lastSourceRefreshRequestAtRef = useRef(0);
  const lastIvsEmergencyCatchUpAtRef = useRef(0);
  const recentRebufferTimestampsRef = useRef<number[]>([]);
  const hlsCatchUpStateRef = useRef<LiveCatchUpState>({
    overshootCount: 0,
    lastHardSeekAt: 0
  });
  const nativeCatchUpStateRef = useRef<LiveCatchUpState>({
    overshootCount: 0,
    lastHardSeekAt: 0
  });
  const source = liveState?.playbackSources.find((candidate) => candidate.kind !== "unresolved");
  const playbackIdentity = buildPlaybackIdentity(liveState, source ?? null);
  const sourceUrl = source?.url;
  const resolvedSourceUrl =
    sourceUrl ? new URL(sourceUrl, window.location.href).toString() : null;
  const sourceKind = source?.kind;
  const sourceLabel = source?.label ?? null;
  const sourceMimeType = source?.mimeType;
  const latencyTarget = source?.latencyTarget;
  const playbackEngine = getPlaybackEngine(source ?? null);
  const [latencySeconds, setLatencySeconds] = useState<number | null>(null);
  const [targetLatencySeconds, setTargetLatencySeconds] = useState<number | null>(null);
  const [canJumpToLive, setCanJumpToLive] = useState(false);
  const [activeSourceUrl, setActiveSourceUrl] = useState<string | null>(sourceUrl ?? null);
  const [activeSourceLoadSequence, setActiveSourceLoadSequence] = useState(0);
  const [telemetry, setTelemetry] = useState<PlaybackTelemetry>({
    resolution: null,
    bitrateKbps: null,
    droppedFrames: null,
    bufferAheadSeconds: null,
    playbackRate: null
  });
  const [diagnostics, setDiagnostics] = useState<PlaybackDiagnostics>({
    engine: playbackEngine,
    measuredLatencySeconds: null,
    qualityLabel: null,
    rebufferCount: 0,
    sessionId: null,
    recoveryState: "idle"
  });
  const [playerMuted, setPlayerMuted] = useState(false);
  const [playerVolume, setPlayerVolume] = useState(1);
  const [autoLiveEdgeChasing, setAutoLiveEdgeChasing] = useState(true);
  const [autoplayNotice, setAutoplayNotice] = useState<string | null>(null);
  const [metadataUpdatePulse, setMetadataUpdatePulse] = useState(0);
  const [recoveryState, setRecoveryState] = useState<PlaybackRecoveryState>({
    state: "idle",
    message: null
  });

  function updateRecoveryState(nextState: PlaybackRecoveryState) {
    setRecoveryState((current) => {
      if (current.state === nextState.state && current.message === nextState.message) {
        return current;
      }

      return nextState;
    });
    setDiagnostics((current) => ({
      ...current,
      recoveryState: nextState.state
    }));
  }

  function requestPlaybackSourceRefresh() {
    const now = Date.now();

    if (now - lastSourceRefreshRequestAtRef.current < 10_000) {
      return;
    }

    lastSourceRefreshRequestAtRef.current = now;
    updateRecoveryState({
      state: "refreshing-source",
      message: "Refreshing the live playback URL from Floatplane."
    });
    onPlaybackSourceRefreshRef.current?.();
  }

  useEffect(() => {
    onPlaybackSourceRefreshRef.current = onPlaybackSourceRefresh;
  }, [onPlaybackSourceRefresh]);

  useEffect(() => {
    const metadataSignature =
      liveState?.streamTitle || liveState?.summary || liveState?.posterUrl
        ? [
            liveState?.streamTitle ?? "",
            liveState?.summary ?? "",
            liveState?.posterUrl ?? ""
          ].join("|")
        : null;

    if (!metadataSignature) {
      previousMetadataSignatureRef.current = null;
      return;
    }

    if (!previousMetadataSignatureRef.current) {
      previousMetadataSignatureRef.current = metadataSignature;
      return;
    }

    if (previousMetadataSignatureRef.current !== metadataSignature) {
      previousMetadataSignatureRef.current = metadataSignature;
      setMetadataUpdatePulse((current) => current + 1);
    }
  }, [liveState?.posterUrl, liveState?.streamTitle, liveState?.summary]);

  useEffect(() => {
    setDiagnostics((current) => ({
      ...current,
      engine: playbackEngine
    }));
  }, [playbackEngine]);

  useEffect(() => {
    if (!resolvedSourceUrl || !playbackIdentity) {
      lastLoadedPlaybackIdentityRef.current = null;
      setActiveSourceUrl(null);
      return;
    }

    if (
      playbackIdentity !== lastLoadedPlaybackIdentityRef.current ||
      playbackReloadSequence > lastAppliedReloadSequenceRef.current
    ) {
      lastLoadedPlaybackIdentityRef.current = playbackIdentity;
      lastAppliedReloadSequenceRef.current = playbackReloadSequence;
      lastIvsEmergencyCatchUpAtRef.current = 0;
      recentRebufferTimestampsRef.current = [];
      setActiveSourceUrl(resolvedSourceUrl);
      setActiveSourceLoadSequence((current) => current + 1);
    }
  }, [playbackIdentity, playbackReloadSequence, resolvedSourceUrl]);

  useEffect(() => {
    onRecoveryChange?.(recoveryState);
  }, [onRecoveryChange, recoveryState]);

  useEffect(() => {
    try {
      const storedMuted = window.localStorage.getItem(PLAYER_MUTED_STORAGE_KEY);
      const storedVolume = window.localStorage.getItem(PLAYER_VOLUME_STORAGE_KEY);
      const storedAutoLiveEdge = window.localStorage.getItem(PLAYER_AUTO_LIVE_EDGE_STORAGE_KEY);

      if (storedMuted !== null) {
        setPlayerMuted(storedMuted === "1");
      }

      if (storedVolume !== null) {
        const parsedVolume = Number(storedVolume);

        if (Number.isFinite(parsedVolume)) {
          setPlayerVolume(clampVolume(parsedVolume));
        }
      }

      if (storedAutoLiveEdge !== null) {
        setAutoLiveEdgeChasing(storedAutoLiveEdge !== "0");
      }
    } catch {
      // Storage can be unavailable in hardened browsing contexts.
    }
  }, []);

  useEffect(() => {
    playerMutedRef.current = playerMuted;
    playerVolumeRef.current = playerVolume;

    const element = videoRef.current;

    if (!element) {
      return;
    }

    element.muted = playerMuted;
    element.volume = clampVolume(playerVolume);
    ivsRef.current?.setMuted(playerMuted);
    ivsRef.current?.setVolume(clampVolume(playerVolume));
  }, [playerMuted, playerVolume]);

  function persistAudioPreferences(nextMuted: boolean, nextVolume: number) {
    try {
      window.localStorage.setItem(PLAYER_MUTED_STORAGE_KEY, nextMuted ? "1" : "0");
      window.localStorage.setItem(PLAYER_VOLUME_STORAGE_KEY, clampVolume(nextVolume).toString());
    } catch {
      // Storage can be unavailable in hardened browsing contexts.
    }
  }

  function persistAutoLiveEdgePreference(nextValue: boolean) {
    try {
      window.localStorage.setItem(PLAYER_AUTO_LIVE_EDGE_STORAGE_KEY, nextValue ? "1" : "0");
    } catch {
      // Storage can be unavailable in hardened browsing contexts.
    }
  }

  function syncAudioPreferenceFromElement() {
    const element = videoRef.current;

    if (!element) {
      return;
    }

    const nextMuted = element.muted;
    const nextVolume = clampVolume(element.volume);

    setPlayerMuted(nextMuted);
    setPlayerVolume(nextVolume);
    persistAudioPreferences(nextMuted, nextVolume);

    if (!nextMuted) {
      setAutoplayNotice(null);
    }
  }

  function tryStartPlayback() {
    const element = videoRef.current;

    if (!element) {
      return;
    }

    element.muted = playerMutedRef.current;
    element.volume = clampVolume(playerVolumeRef.current);

    void element.play().catch(() => {
      if (!element.muted) {
        setAutoplayNotice(
          "Browser autoplay rules blocked background launch with sound. The player is primed; bring this tab forward if audio does not start."
        );
      }
    });
  }

  function jumpToLiveEdge(mode: "auto" | "manual" = "manual") {
    const element = videoRef.current;
    const activeIvs = ivsRef.current;
    const isManual = mode === "manual";

    if (!element) {
      return;
    }

    if (playbackEngine === "ivs") {
      const liveLatency = activeIvs ? toFiniteLatency(activeIvs.getLiveLatency()) : null;
      const ivsPosition = activeIvs?.getPosition();
      const computedLiveTarget =
        liveLatency !== null && typeof ivsPosition === "number" && Number.isFinite(ivsPosition)
          ? Math.max(
              0,
              ivsPosition + liveLatency - (isManual ? MANUAL_IVS_EDGE_PADDING_SECONDS : AUTO_IVS_EDGE_PADDING_SECONDS)
            )
          : null;
      const seekableEdge = getSeekableEdge(element);
      const fallbackTarget =
        seekableEdge !== null
          ? Math.max(
              0,
              seekableEdge - (isManual ? MANUAL_IVS_EDGE_PADDING_SECONDS : AUTO_IVS_EDGE_PADDING_SECONDS)
            )
          : null;
      const nextTarget = computedLiveTarget ?? fallbackTarget;

      if (nextTarget !== null) {
        if (activeIvs) {
          activeIvs.seekTo(nextTarget);
        } else {
          element.currentTime = nextTarget;
        }
      }

      tryStartPlayback();
      return;
    }

    const liveSyncPosition = hlsRef.current?.liveSyncPosition;

    if (liveSyncPosition !== null && liveSyncPosition !== undefined && Number.isFinite(liveSyncPosition)) {
      const safeLiveTarget = Math.max(
        0,
        liveSyncPosition -
          (isManual ? MANUAL_HLS_SAFE_LIVE_SYNC_OFFSET_SECONDS : AUTO_HLS_SAFE_LIVE_SYNC_OFFSET_SECONDS)
      );

      if (Math.abs(element.currentTime - safeLiveTarget) > 0.2) {
        element.currentTime = safeLiveTarget;
      }

      element.playbackRate = 1;
      tryStartPlayback();
      return;
    }

    const seekableEdge = getSeekableEdge(element);

    if (seekableEdge === null) {
      return;
    }

    element.currentTime = Math.max(
      0,
      seekableEdge - (isManual ? MANUAL_FALLBACK_EDGE_PADDING_SECONDS : AUTO_FALLBACK_EDGE_PADDING_SECONDS)
    );
    element.playbackRate = 1;
    tryStartPlayback();
  }

  useEffect(() => {
    if (!launchSequence || liveState?.status !== "live" || !autoLiveEdgeChasing) {
      return;
    }

    jumpToLiveEdge("auto");
  }, [autoLiveEdgeChasing, launchSequence, liveState?.status, playbackEngine]);

  useEffect(() => {
    const element = videoRef.current;
    let disposed = false;
    let activeHls: HlsHandle | null = null;
    let activeIvs: IvsHandle | null = null;
    let telemetryHandle: number | undefined;
    let canPlayHandler: (() => void) | undefined;
    let playingHandler: (() => void) | undefined;
    let waitingHandler: (() => void) | undefined;
    let stalledHandler: (() => void) | undefined;
    let errorHandler: (() => void) | undefined;
    const removeIvsListeners: Array<() => void> = [];

    hlsCatchUpStateRef.current = {
      overshootCount: 0,
      lastHardSeekAt: 0
    };
    nativeCatchUpStateRef.current = {
      overshootCount: 0,
      lastHardSeekAt: 0
    };
    recentRebufferTimestampsRef.current = [];

    function syncTelemetry(
      nextLatencySeconds: number | null,
      nextTargetLatencySeconds: number | null,
      nextCanJumpToLive: boolean
    ) {
      setLatencySeconds(nextLatencySeconds);
      setTargetLatencySeconds(nextTargetLatencySeconds);
      setCanJumpToLive(nextCanJumpToLive);
      setDiagnostics((current) => ({
        ...current,
        measuredLatencySeconds: nextLatencySeconds
      }));
    }

    function updatePlaybackTelemetry(
      qualityLabelOverride?: string | null,
      sessionIdOverride?: string | null
    ) {
      const video = videoRef.current;
      const activeHandle = hlsRef.current;

      if (!video) {
        return;
      }

      const currentLevel =
        activeHandle && activeHandle.currentLevel >= 0
          ? activeHandle.levels[activeHandle.currentLevel]
          : undefined;
      const resolution =
        video.videoWidth > 0 && video.videoHeight > 0
          ? `${video.videoWidth}×${video.videoHeight}`
          : currentLevel?.width && currentLevel?.height
            ? `${currentLevel.width}×${currentLevel.height}`
            : null;
      const playbackQuality = video.getVideoPlaybackQuality?.();
      const droppedFrames =
        playbackQuality?.droppedVideoFrames ??
        ((video as HTMLVideoElement & { webkitDroppedFrameCount?: number }).webkitDroppedFrameCount ?? null);
      const bufferAheadSeconds =
        video.buffered.length > 0
          ? Math.max(0, video.buffered.end(video.buffered.length - 1) - video.currentTime)
          : null;

      setTelemetry({
        resolution,
        bitrateKbps: currentLevel?.bitrate ? Math.round(currentLevel.bitrate / 1000) : null,
        droppedFrames,
        bufferAheadSeconds,
        playbackRate: Number.isFinite(video.playbackRate) ? video.playbackRate : null
      });

      setDiagnostics((current) => ({
        ...current,
        qualityLabel:
          qualityLabelOverride ??
          formatQualityLabel(
            source ? { ...source, label: sourceLabel ?? source.label, mimeType: sourceMimeType } : null,
            resolution,
            currentLevel?.bitrate ? Math.round(currentLevel.bitrate / 1000) : null
          ),
        sessionId: sessionIdOverride ?? current.sessionId
      }));
    }

    function recordRebuffer() {
      const now = Date.now();
      const nextTimestamps = [
        ...recentRebufferTimestampsRef.current.filter((timestamp) => now - timestamp < 20_000),
        now
      ];
      recentRebufferTimestampsRef.current = nextTimestamps;
      setDiagnostics((current) => ({
        ...current,
        rebufferCount: current.rebufferCount + 1
      }));

      if (playbackEngine === "ivs" && nextTimestamps.length >= 3) {
        requestPlaybackSourceRefresh();
      }
    }

    function onIvsEvent<K extends Parameters<IvsHandle["addEventListener"]>[0]>(
      name: K,
      handler: Parameters<IvsHandle["addEventListener"]>[1]
    ) {
      if (!activeIvs) {
        return;
      }

      activeIvs.addEventListener(name, handler as never);
      removeIvsListeners.push(() => {
        activeIvs?.removeEventListener(name, handler as never);
      });
    }

    if (!element || !activeSourceUrl) {
      element?.removeAttribute("src");
      element?.load();
      syncTelemetry(null, null, false);
      setAutoplayNotice(null);
      updateRecoveryState({
        state: "idle",
        message: null
      });
      setTelemetry({
        resolution: null,
        bitrateKbps: null,
        droppedFrames: null,
        bufferAheadSeconds: null,
        playbackRate: null
      });
      setDiagnostics((current) => ({
        ...current,
        measuredLatencySeconds: null,
        qualityLabel: null,
        rebufferCount: 0,
        sessionId: null
      }));
      return;
    }

    canPlayHandler = () => {
      updateRecoveryState({
        state: "idle",
        message: null
      });
      tryStartPlayback();
    };
    playingHandler = () => {
      updateRecoveryState({
        state: "idle",
        message: null
      });
    };
    waitingHandler = () => {
      if (liveState?.status !== "live") {
        return;
      }

      recordRebuffer();
      updateRecoveryState({
        state: "buffering",
        message: "Playback is buffering and trying to catch back up to the live edge."
      });
    };
    stalledHandler = () => {
      updateRecoveryState({
        state: "recovering-network",
        message: "Playback stalled. Reconnecting to the live stream now."
      });
    };
    errorHandler = () => {
      updateRecoveryState({
        state: "error",
        message: "Playback hit an unexpected error. Refresh live state or reconnect if it does not recover."
      });
    };
    element.addEventListener("canplay", canPlayHandler);
    element.addEventListener("playing", playingHandler);
    element.addEventListener("waiting", waitingHandler);
    element.addEventListener("stalled", stalledHandler);
    element.addEventListener("error", errorHandler);
    element.muted = playerMutedRef.current;
    element.volume = clampVolume(playerVolumeRef.current);
    setAutoplayNotice(null);

    if (playbackEngine === "ivs" && sourceKind === "hls" && isIvsPlayerSupported) {
      activeIvs = createIvsPlayer({
        wasmWorker: ivsWasmWorkerUrl,
        wasmBinary: ivsWasmBinaryUrl,
        logLevel: IvsLogLevel.ERROR
      }) as IvsHandle;
      ivsRef.current = activeIvs;
      hlsRef.current = null;
      activeIvs.attachHTMLVideoElement(element);
      activeIvs.setAutoplay(true);
      activeIvs.setLiveLowLatencyEnabled(true);
      activeIvs.setRebufferToLive(true);
      activeIvs.setInitialBufferDuration(IVS_INITIAL_BUFFER_SECONDS);
      activeIvs.setAutoQualityMode(true);
      activeIvs.setMuted(playerMutedRef.current);
      activeIvs.setVolume(clampVolume(playerVolumeRef.current));
      activeIvs.setLiveMaxLatency?.(IVS_TARGET_MAX_LATENCY_SECONDS);
      activeIvs.setLiveSpeedUpRate?.(IVS_SPEED_UP_RATE);

      onIvsEvent(IvsPlayerState.READY, () => {
        updateRecoveryState({
          state: "idle",
          message: null
        });
        updatePlaybackTelemetry(
          formatQualityLabel(
            source ? { ...source, label: sourceLabel ?? source.label, mimeType: sourceMimeType } : null,
            element.videoWidth > 0 && element.videoHeight > 0 ? `${element.videoWidth}×${element.videoHeight}` : null,
            null
          ),
          activeIvs?.getSessionId() ?? null
        );
      });
      onIvsEvent(IvsPlayerState.PLAYING, () => {
        updateRecoveryState({
          state: "idle",
          message: null
        });
      });
      onIvsEvent(IvsPlayerState.BUFFERING, () => {
        updateRecoveryState({
          state: "buffering",
          message: "The IVS player is buffering while staying near the live edge."
        });
      });
      onIvsEvent(IvsPlayerEventType.REBUFFERING, () => {
        recordRebuffer();
        updateRecoveryState({
          state: "recovering-network",
          message: "The IVS player rebuffered and is recovering the live stream."
        });
      });
      onIvsEvent(IvsPlayerEventType.QUALITY_CHANGED, () => {
        const quality = activeIvs?.getQuality();
        const resolution =
          quality?.width && quality?.height ? `${quality.width}×${quality.height}` : null;
        const bitrateKbps = quality?.bitrate ? Math.round(quality.bitrate / 1000) : null;

        updatePlaybackTelemetry(
          formatQualityLabel(
            source ? { ...source, label: sourceLabel ?? source.label, mimeType: sourceMimeType } : null,
            resolution,
            bitrateKbps
          ),
          activeIvs?.getSessionId() ?? null
        );
      });
      onIvsEvent(IvsPlayerEventType.PLAYBACK_BLOCKED, () => {
        setAutoplayNotice(
          "Browser autoplay rules blocked background launch. Bring the app forward if playback does not start."
        );
      });
      onIvsEvent(IvsPlayerEventType.AUDIO_BLOCKED, () => {
        setAutoplayNotice(
          "Browser autoplay rules blocked background launch with sound. Bring the app forward if audio does not start."
        );
      });
      onIvsEvent(IvsPlayerEventType.ERROR, (payload) => {
        const message =
          payload.type === IvsErrorType.NETWORK || payload.type === IvsErrorType.NETWORK_IO
            ? "The IVS player lost the live connection. Refreshing the Floatplane playback URL."
            : payload.type === IvsErrorType.AUTHORIZATION || payload.type === IvsErrorType.NOT_AVAILABLE
              ? "The current playback URL expired or became unavailable. Refreshing it from Floatplane."
              : payload.message || "The IVS player encountered a fatal error.";

        updateRecoveryState({
          state:
            payload.type === IvsErrorType.NETWORK || payload.type === IvsErrorType.NETWORK_IO
              ? "recovering-network"
              : "error",
          message
        });
        requestPlaybackSourceRefresh();
      });

      telemetryHandle = window.setInterval(() => {
        const video = videoRef.current;

        if (!video || !activeIvs) {
          return;
        }

        const quality = activeIvs.getQuality();
        const qualityResolution =
          quality?.width && quality?.height ? `${quality.width}×${quality.height}` : null;
        const qualityBitrateKbps = quality?.bitrate ? Math.round(quality.bitrate / 1000) : null;
        const nextLatencySeconds = toFiniteLatency(activeIvs.getLiveLatency());
        const nextCanJumpToLive = nextLatencySeconds !== null || getSeekableEdge(video) !== null;

        syncTelemetry(nextLatencySeconds, latencyTarget === "low" ? 2 : null, nextCanJumpToLive);
        updatePlaybackTelemetry(
          formatQualityLabel(
            source ? { ...source, label: sourceLabel ?? source.label, mimeType: sourceMimeType } : null,
            qualityResolution,
            qualityBitrateKbps
          ),
          activeIvs?.getSessionId() ?? null
        );

        const now = Date.now();

        if (
          autoLiveEdgeChasing &&
          nextLatencySeconds !== null &&
          nextLatencySeconds > IVS_EMERGENCY_CATCH_UP_THRESHOLD_SECONDS &&
          now - lastIvsEmergencyCatchUpAtRef.current > IVS_EMERGENCY_CATCH_UP_COOLDOWN_MS
        ) {
          lastIvsEmergencyCatchUpAtRef.current = now;
          jumpToLiveEdge("auto");
        }
      }, 500);

      activeIvs.load(activeSourceUrl, {
        mediaType: sourceMimeType ?? "application/x-mpegURL"
      });
      tryStartPlayback();

      return () => {
        disposed = true;
        hlsRef.current = null;
        ivsRef.current = null;
        if (canPlayHandler) {
          element.removeEventListener("canplay", canPlayHandler);
        }
        if (playingHandler) {
          element.removeEventListener("playing", playingHandler);
        }
        if (waitingHandler) {
          element.removeEventListener("waiting", waitingHandler);
        }
        if (stalledHandler) {
          element.removeEventListener("stalled", stalledHandler);
        }
        if (errorHandler) {
          element.removeEventListener("error", errorHandler);
        }
        if (telemetryHandle !== undefined) {
          window.clearInterval(telemetryHandle);
        }
        removeIvsListeners.forEach((remove) => remove());
        activeIvs?.delete();
        element.removeAttribute("src");
        element.load();
        syncTelemetry(null, null, false);
      };
    }

    if (sourceKind === "hls") {
      void import("hls.js").then(({ default: Hls }) => {
        if (disposed || !videoRef.current) {
          return;
        }

        if (Hls.isSupported()) {
          const useLowLatencyProfile = latencyTarget === "low";
          activeHls = new Hls({
            startPosition: -1,
            lowLatencyMode: useLowLatencyProfile,
            liveSyncMode: useLowLatencyProfile ? "edge" : "buffered",
            liveDurationInfinity: true,
            backBufferLength: useLowLatencyProfile ? 30 : 90,
            maxBufferLength: useLowLatencyProfile ? 6 : 12,
            maxMaxBufferLength: useLowLatencyProfile ? 10 : 24,
            liveSyncDurationCount: useLowLatencyProfile ? 1 : 2,
            liveMaxLatencyDurationCount: useLowLatencyProfile ? 2 : 5,
            liveSyncOnStallIncrease: useLowLatencyProfile ? 0.2 : 1,
            maxLiveSyncPlaybackRate: useLowLatencyProfile ? 1.35 : 1.01
          });
          hlsRef.current = activeHls;

          activeHls.on(Hls.Events.ERROR, (_event, data) => {
            if (!data.fatal || !activeHls) {
              return;
            }

            if (data.type === Hls.ErrorTypes.NETWORK_ERROR) {
              updateRecoveryState({
                state: "recovering-network",
                message: "Playback lost the live connection. Reconnecting to Floatplane media now."
              });
              activeHls.startLoad();
              return;
            }

            if (data.type === Hls.ErrorTypes.MEDIA_ERROR) {
              updateRecoveryState({
                state: "recovering-media",
                message: "Playback decoder issue detected. Recovering the video pipeline."
              });
              activeHls.recoverMediaError();
              return;
            }

            updateRecoveryState({
              state: "error",
              message: "Playback encountered a fatal stream error. Refresh live state if recovery does not complete."
            });
          });

          telemetryHandle = window.setInterval(() => {
            const video = videoRef.current;

            if (!video || !activeHls) {
              return;
            }

            const nextLatencySeconds = toFiniteLatency(activeHls.latency);
            const nextTargetLatencySeconds = toFiniteLatency(activeHls.targetLatency);
            const liveSyncPosition = activeHls.liveSyncPosition;
            const canSeekToLive =
              liveSyncPosition !== null &&
              liveSyncPosition !== undefined &&
              Number.isFinite(liveSyncPosition);

            syncTelemetry(nextLatencySeconds, nextTargetLatencySeconds, canSeekToLive);
            updatePlaybackTelemetry();

            if (nextLatencySeconds === null || nextTargetLatencySeconds === null || !canSeekToLive) {
              hlsCatchUpStateRef.current = {
                ...hlsCatchUpStateRef.current,
                overshootCount: 0
              };
              return;
            }

            if (!autoLiveEdgeChasing) {
              hlsCatchUpStateRef.current = {
                ...hlsCatchUpStateRef.current,
                overshootCount: 0
              };
              video.playbackRate = 1;
              return;
            }

            const catchUpDecision = evaluateHlsLiveCatchUp({
              latencySeconds: nextLatencySeconds,
              targetLatencySeconds: nextTargetLatencySeconds,
              latencyTarget: latencyTarget ?? "standard",
              state: hlsCatchUpStateRef.current,
              nowMs: Date.now()
            });
            hlsCatchUpStateRef.current = catchUpDecision.state;

            if (catchUpDecision.hardSeek) {
              if (window.localStorage?.getItem("wan-verbose-logging") === "1") {
                console.warn(`[Player] Hard-seek jump to live edge (latency: ${nextLatencySeconds}s)`);
              }
              jumpToLiveEdge("auto");
              return;
            }

            if (useLowLatencyProfile) {
              return;
            }

            if (video.playbackRate !== catchUpDecision.playbackRate) {
              if (window.localStorage?.getItem("wan-verbose-logging") === "1" && catchUpDecision.playbackRate > 1) {
                console.warn(`[Player] Speeding up playback to ${catchUpDecision.playbackRate}x (latency: ${nextLatencySeconds}s)`);
              }
              video.playbackRate = catchUpDecision.playbackRate;
            }
          }, useLowLatencyProfile ? 750 : 1_500);

          activeHls.loadSource(activeSourceUrl);
          activeHls.attachMedia(videoRef.current);
          activeHls.startLoad(-1);
          tryStartPlayback();
          return;
        }

        videoRef.current.src = activeSourceUrl;
        tryStartPlayback();
      });

      return () => {
        disposed = true;
        hlsRef.current = null;
        if (canPlayHandler) {
          element.removeEventListener("canplay", canPlayHandler);
        }
        if (playingHandler) {
          element.removeEventListener("playing", playingHandler);
        }
        if (waitingHandler) {
          element.removeEventListener("waiting", waitingHandler);
        }
        if (stalledHandler) {
          element.removeEventListener("stalled", stalledHandler);
        }
        if (errorHandler) {
          element.removeEventListener("error", errorHandler);
        }
        if (telemetryHandle !== undefined) {
          window.clearInterval(telemetryHandle);
        }
        activeHls?.destroy();
        element.removeAttribute("src");
        element.load();
        syncTelemetry(null, null, false);
      };
    }

    element.src = activeSourceUrl;
    tryStartPlayback();

    telemetryHandle = window.setInterval(() => {
      const video = videoRef.current;

      if (!video) {
        return;
      }

      const seekableEdge = getSeekableEdge(video);
      const nextLatencySeconds =
        seekableEdge === null ? null : Math.max(0, seekableEdge - video.currentTime);

      syncTelemetry(nextLatencySeconds, null, seekableEdge !== null);
      updatePlaybackTelemetry();

      if (nextLatencySeconds === null) {
        nativeCatchUpStateRef.current = {
          ...nativeCatchUpStateRef.current,
          overshootCount: 0
        };
        return;
      }

      if (!autoLiveEdgeChasing) {
        nativeCatchUpStateRef.current = {
          ...nativeCatchUpStateRef.current,
          overshootCount: 0
        };
        video.playbackRate = 1;
        return;
      }

      const catchUpDecision = evaluateNativeLiveCatchUp({
        latencySeconds: nextLatencySeconds,
        state: nativeCatchUpStateRef.current,
        nowMs: Date.now()
      });
      nativeCatchUpStateRef.current = catchUpDecision.state;

      if (catchUpDecision.hardSeek) {
        jumpToLiveEdge("auto");
        return;
      }

      video.playbackRate = catchUpDecision.playbackRate;
    }, 1_500);

    return () => {
      disposed = true;
      hlsRef.current = null;
      if (canPlayHandler) {
        element.removeEventListener("canplay", canPlayHandler);
      }
      if (playingHandler) {
        element.removeEventListener("playing", playingHandler);
      }
      if (waitingHandler) {
        element.removeEventListener("waiting", waitingHandler);
      }
      if (stalledHandler) {
        element.removeEventListener("stalled", stalledHandler);
      }
      if (errorHandler) {
        element.removeEventListener("error", errorHandler);
      }
      if (telemetryHandle !== undefined) {
        window.clearInterval(telemetryHandle);
      }
      element.removeAttribute("src");
      element.load();
      syncTelemetry(null, null, false);
    };
  }, [activeSourceLoadSequence, activeSourceUrl, autoLiveEdgeChasing, latencyTarget, liveState?.status, playbackEngine, sourceKind, sourceLabel, sourceMimeType]);

  const latencyLabel = activeSourceUrl
    ? latencySeconds !== null
      ? `${latencySeconds.toFixed(1)}s behind`
      : "Measuring live edge"
    : "Awaiting source";
  const isNearLive =
    latencySeconds !== null &&
    latencySeconds <=
      Math.max(targetLatencySeconds ?? (latencyTarget === "low" ? 3 : 5), latencyTarget === "low" ? 3 : 5);
  const hasConfirmedStartTime = Boolean(liveState?.startedAt);
  const streamInfoItems = [
    {
      label: "Status",
      value: humanizeLabel(liveState?.status ?? "standby")
    },
    {
      label: "Creator",
      value: liveState?.creatorName ?? "WAN Show"
    },
    {
      label: hasConfirmedStartTime ? "Started" : "Last refresh",
      value: hasConfirmedStartTime
        ? formatStreamTimestamp(liveState?.startedAt)
        : formatRelativeFreshness(liveState?.refreshedAt)
    },
    {
      label: hasConfirmedStartTime ? "Uptime" : "Start time",
      value: hasConfirmedStartTime
        ? liveState?.status === "live"
          ? formatUptime(liveState?.startedAt)
          : "Awaiting launch"
        : liveState?.status === "live"
          ? "Unavailable from Floatplane"
          : "Awaiting launch"
    },
    {
      label: "Playback",
      value: sourceLabel ?? "Awaiting source"
    },
    {
      label: "Engine",
      value: diagnostics.engine === "ivs" ? "Amazon IVS" : diagnostics.engine === "hls" ? "hls.js" : diagnostics.engine === "native" ? "Native" : "Pending"
    },
    {
      label: "Chat",
      value: liveState?.chatCapability.canSend
        ? "Interactive"
        : liveState?.chatCapability.canRead
          ? "Read only"
          : "Offline"
    },
    {
      label: "Relay",
      value: humanizeLabel(relayStatus)
    },
    {
      label: "Audio",
      value: autoplayNotice ?? (playerMuted ? "Muted" : "Live through player")
    },
    {
      label: "Recovery",
      value: humanizeLabel(diagnostics.recoveryState)
    }
  ];
  const telemetryItems = [
    {
      label: "Quality",
      value: diagnostics.qualityLabel ?? "Measuring"
    },
    {
      label: "Resolution",
      value: telemetry.resolution ?? "Waiting"
    },
    {
      label: "Bitrate",
      value: telemetry.bitrateKbps ? `${telemetry.bitrateKbps} kbps` : "Adaptive"
    },
    {
      label: "Buffer ahead",
      value:
        telemetry.bufferAheadSeconds !== null ? `${telemetry.bufferAheadSeconds.toFixed(1)}s` : "Measuring"
    },
    {
      label: "Dropped frames",
      value: telemetry.droppedFrames !== null ? telemetry.droppedFrames.toString() : "n/a"
    },
    {
      label: "Playback rate",
      value: telemetry.playbackRate !== null ? `${telemetry.playbackRate.toFixed(2)}x` : "n/a"
    },
    {
      label: "Rebuffers",
      value: diagnostics.rebufferCount.toString()
    },
    {
      label: "Session ID",
      value: diagnostics.sessionId ? `${diagnostics.sessionId.slice(0, 12)}…` : "Pending"
    }
  ];
  const metadataPulseClass =
    metadataUpdatePulse > 0
      ? metadataUpdatePulse % 2 === 0
        ? "metadata-refresh-a"
        : "metadata-refresh-b"
      : "";

  return (
    <section className={`video-stage ${compactMode ? "is-compact" : ""}`.trim()}>
      <div className="video-frame">
        <video
          ref={videoRef}
          className={`video-player ${activeSourceUrl ? "" : "is-idle"}`.trim()}
          controls={Boolean(activeSourceUrl)}
          autoPlay
          muted={playerMuted}
          onVolumeChange={syncAudioPreferenceFromElement}
          playsInline
        />
        {!activeSourceUrl ? (
          <div className="video-placeholder">
            <span>Playback source pending capture</span>
            <p>
              The UI is ready for a captured Floatplane playback URL. Until then, the fixture relay
              keeps the session flow, chat handling, and layout testable.
            </p>
          </div>
        ) : null}
      </div>

      <div className="stream-info-panel">
        <div className="stream-overview">
          {!compactMode ? (
            <div className={`stream-poster-shell ${metadataPulseClass}`.trim()}>
              {liveState?.posterUrl ? (
                <img
                  alt={`${liveState.streamTitle} poster`}
                  className="stream-poster"
                  src={liveState.posterUrl}
                />
              ) : (
                <div className="stream-poster-fallback">{(liveState?.creatorName ?? "WAN").slice(0, 3)}</div>
              )}
            </div>
          ) : null}

          <div className={`stream-overview-copy ${metadataPulseClass}`.trim()}>
            <h2>{liveState?.streamTitle ?? "Bootstrapping local relay"}</h2>
            <p>{liveState?.summary ?? sessionMessage}</p>
          </div>

          <div className="stream-live-rail">
            <span className="meta-label">Live edge</span>
            <strong className="stream-live-value">{latencyLabel}</strong>
            <div className="live-edge-controls">
              <button
                className={`live-edge-button ${isNearLive ? "is-live" : ""}`.trim()}
                disabled={!canJumpToLive}
                onClick={() => jumpToLiveEdge("manual")}
                type="button"
              >
                {isNearLive ? "Live" : "Catch up"}
              </button>
              {playbackEngine !== "ivs" ? (
                <button
                  aria-pressed={autoLiveEdgeChasing}
                  className={`live-edge-button live-edge-toggle ${autoLiveEdgeChasing ? "is-enabled" : ""}`.trim()}
                  onClick={() => {
                    const nextValue = !autoLiveEdgeChasing;
                    setAutoLiveEdgeChasing(nextValue);
                    persistAutoLiveEdgePreference(nextValue);
                  }}
                  type="button"
                >
                  Auto chase {autoLiveEdgeChasing ? "on" : "off"}
                </button>
              ) : null}
            </div>
          </div>
        </div>

        {recoveryState.message ? (
          <div className={`player-recovery-banner is-${recoveryState.state}`.trim()}>
            <strong>
              {recoveryState.state === "error"
                ? "Recovery needed"
                : recoveryState.state === "refreshing-source"
                  ? "Refreshing source"
                : recoveryState.state === "recovering-network"
                  ? "Reconnecting stream"
                  : recoveryState.state === "recovering-media"
                    ? "Recovering playback"
                    : "Buffering"}
            </strong>
            <span>{recoveryState.message}</span>
          </div>
        ) : null}

        {!compactMode ? (
          <div className="stream-info-bar">
            {streamInfoItems.map((item) => (
              <div className="stream-info-item" key={item.label}>
                <span className="meta-label">{item.label}</span>
                <strong>{item.value}</strong>
              </div>
            ))}
          </div>
        ) : null}

        {!compactMode ? (
          <div className="telemetry-strip">
            {telemetryItems.map((item) => (
              <div className="telemetry-inline" key={item.label}>
                <span className="meta-label">{item.label}</span>
                <strong>{item.value}</strong>
              </div>
            ))}
          </div>
        ) : null}
      </div>

    </section>
  );
}
