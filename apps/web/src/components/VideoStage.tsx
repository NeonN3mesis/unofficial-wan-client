import { useEffect, useRef, useState } from "react";
import type { WanLiveState } from "@shared";
import {
  evaluateHlsLiveCatchUp,
  evaluateNativeLiveCatchUp,
  type LiveCatchUpState
} from "../lib/live-playback";

interface VideoStageProps {
  liveState: WanLiveState | null;
  sessionMessage: string;
  launchSequence?: number;
}

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

const PLAYER_MUTED_STORAGE_KEY = "wan-signal-player-muted";
const PLAYER_VOLUME_STORAGE_KEY = "wan-signal-player-volume";
const PLAYER_AUTO_LIVE_EDGE_STORAGE_KEY = "wan-signal-player-auto-live-edge";

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
    return "Not published";
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

export function VideoStage({ liveState, sessionMessage, launchSequence = 0 }: VideoStageProps) {
  const videoRef = useRef<HTMLVideoElement | null>(null);
  const hlsRef = useRef<HlsHandle | null>(null);
  const playerMutedRef = useRef(true);
  const playerVolumeRef = useRef(1);
  const previousMetadataSignatureRef = useRef<string | null>(null);
  const hlsCatchUpStateRef = useRef<LiveCatchUpState>({
    overshootCount: 0,
    lastHardSeekAt: 0
  });
  const nativeCatchUpStateRef = useRef<LiveCatchUpState>({
    overshootCount: 0,
    lastHardSeekAt: 0
  });
  const source = liveState?.playbackSources.find((candidate) => candidate.kind !== "unresolved");
  const sourceUrl = source?.url;
  const sourceKind = source?.kind;
  const latencyTarget = source?.latencyTarget;
  const [latencySeconds, setLatencySeconds] = useState<number | null>(null);
  const [targetLatencySeconds, setTargetLatencySeconds] = useState<number | null>(null);
  const [canJumpToLive, setCanJumpToLive] = useState(false);
  const [telemetry, setTelemetry] = useState<PlaybackTelemetry>({
    resolution: null,
    bitrateKbps: null,
    droppedFrames: null,
    bufferAheadSeconds: null,
    playbackRate: null
  });
  const [playerMuted, setPlayerMuted] = useState(true);
  const [playerVolume, setPlayerVolume] = useState(1);
  const [autoLiveEdgeChasing, setAutoLiveEdgeChasing] = useState(true);
  const [autoplayNotice, setAutoplayNotice] = useState<string | null>(null);
  const [metadataUpdatePulse, setMetadataUpdatePulse] = useState(0);

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

  function jumpToLiveEdge() {
    const element = videoRef.current;

    if (!element) {
      return;
    }

    const liveSyncPosition = hlsRef.current?.liveSyncPosition;

    if (liveSyncPosition !== null && liveSyncPosition !== undefined && Number.isFinite(liveSyncPosition)) {
      const safeLiveTarget = Math.max(0, liveSyncPosition - 0.25);

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

    element.currentTime = Math.max(0, seekableEdge - 1);
    element.playbackRate = 1;
    tryStartPlayback();
  }

  useEffect(() => {
    if (!launchSequence || liveState?.status !== "live" || !autoLiveEdgeChasing) {
      return;
    }

    jumpToLiveEdge();
  }, [autoLiveEdgeChasing, launchSequence, liveState?.status]);

  useEffect(() => {
    const element = videoRef.current;
    let disposed = false;
    let activeHls: HlsHandle | null = null;
    let telemetryHandle: number | undefined;
    let canPlayHandler: (() => void) | undefined;

    hlsCatchUpStateRef.current = {
      overshootCount: 0,
      lastHardSeekAt: 0
    };
    nativeCatchUpStateRef.current = {
      overshootCount: 0,
      lastHardSeekAt: 0
    };

    function syncTelemetry(
      nextLatencySeconds: number | null,
      nextTargetLatencySeconds: number | null,
      nextCanJumpToLive: boolean
    ) {
      setLatencySeconds(nextLatencySeconds);
      setTargetLatencySeconds(nextTargetLatencySeconds);
      setCanJumpToLive(nextCanJumpToLive);
    }

    function updatePlaybackTelemetry() {
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
    }

    if (!element || !sourceUrl) {
      element?.removeAttribute("src");
      element?.load();
      syncTelemetry(null, null, false);
      setAutoplayNotice(null);
      setTelemetry({
        resolution: null,
        bitrateKbps: null,
        droppedFrames: null,
        bufferAheadSeconds: null,
        playbackRate: null
      });
      return;
    }

    canPlayHandler = () => {
      tryStartPlayback();
    };
    element.addEventListener("canplay", canPlayHandler);
    element.muted = playerMutedRef.current;
    element.volume = clampVolume(playerVolumeRef.current);
    setAutoplayNotice(null);

    if (sourceKind === "hls") {
      void import("hls.js").then(({ default: Hls }) => {
        if (disposed || !videoRef.current) {
          return;
        }

        if (Hls.isSupported()) {
          activeHls = new Hls({
            startPosition: -1,
            lowLatencyMode: latencyTarget === "low",
            liveSyncMode: "edge",
            liveDurationInfinity: true,
            backBufferLength: latencyTarget === "low" ? 30 : 90,
            maxBufferLength: latencyTarget === "low" ? 10 : 22,
            maxMaxBufferLength: latencyTarget === "low" ? 18 : 42,
            liveSyncDurationCount: latencyTarget === "low" ? 2 : 4,
            liveMaxLatencyDurationCount: latencyTarget === "low" ? 6 : 10,
            liveSyncOnStallIncrease: latencyTarget === "low" ? 0.5 : 1,
            maxLiveSyncPlaybackRate: latencyTarget === "low" ? 1.12 : 1.08
          });
          hlsRef.current = activeHls;

          activeHls.on(Hls.Events.ERROR, (_event, data) => {
            if (!data.fatal || !activeHls) {
              return;
            }

            if (data.type === Hls.ErrorTypes.NETWORK_ERROR) {
              activeHls.startLoad();
              return;
            }

            if (data.type === Hls.ErrorTypes.MEDIA_ERROR) {
              activeHls.recoverMediaError();
            }
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
              jumpToLiveEdge();
              return;
            }

            video.playbackRate = catchUpDecision.playbackRate;
          }, 1_500);

          activeHls.loadSource(sourceUrl);
          activeHls.attachMedia(videoRef.current);
          activeHls.startLoad(-1);
          tryStartPlayback();
          return;
        }

        videoRef.current.src = sourceUrl;
        tryStartPlayback();
      });

      return () => {
        disposed = true;
        hlsRef.current = null;
        if (canPlayHandler) {
          element.removeEventListener("canplay", canPlayHandler);
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

    element.src = sourceUrl;
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
        jumpToLiveEdge();
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
      if (telemetryHandle !== undefined) {
        window.clearInterval(telemetryHandle);
      }
      element.removeAttribute("src");
      element.load();
      syncTelemetry(null, null, false);
    };
  }, [autoLiveEdgeChasing, latencyTarget, sourceKind, sourceUrl]);

  const latencyLabel = source?.url
    ? latencySeconds !== null
      ? `${latencySeconds.toFixed(1)}s behind`
      : "Measuring live edge"
    : "Awaiting source";
  const isNearLive =
    latencySeconds !== null &&
    latencySeconds <=
      Math.max(targetLatencySeconds ?? (latencyTarget === "low" ? 3 : 5), latencyTarget === "low" ? 3 : 5);
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
      label: "Started",
      value: formatStreamTimestamp(liveState?.startedAt)
    },
    {
      label: "Uptime",
      value: liveState?.status === "live" ? formatUptime(liveState?.startedAt) : "Awaiting launch"
    },
    {
      label: "Playback",
      value: source?.label ?? "Awaiting source"
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
      label: "Audio",
      value: autoplayNotice ?? (playerMuted ? "Muted" : "Live through player")
    },
    {
      label: "Auto chase",
      value: autoLiveEdgeChasing ? "On" : "Off"
    }
  ];
  const telemetryItems = [
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
    }
  ];
  const metadataPulseClass =
    metadataUpdatePulse > 0
      ? metadataUpdatePulse % 2 === 0
        ? "metadata-refresh-a"
        : "metadata-refresh-b"
      : "";

  return (
    <section className="video-stage">
      <div className="video-frame">
        <video
          ref={videoRef}
          className={`video-player ${source?.url ? "" : "is-idle"}`.trim()}
          controls={Boolean(source?.url)}
          autoPlay
          muted={playerMuted}
          onVolumeChange={syncAudioPreferenceFromElement}
          playsInline
        />
        {!source?.url ? (
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
                onClick={jumpToLiveEdge}
                type="button"
              >
                {isNearLive ? "Live" : "Catch up"}
              </button>
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
            </div>
          </div>
        </div>

        <div className="stream-info-bar">
          {streamInfoItems.map((item) => (
            <div className="stream-info-item" key={item.label}>
              <span className="meta-label">{item.label}</span>
              <strong>{item.value}</strong>
            </div>
          ))}
        </div>

        <div className="telemetry-strip">
          {telemetryItems.map((item) => (
            <div className="telemetry-inline" key={item.label}>
              <span className="meta-label">{item.label}</span>
              <strong>{item.value}</strong>
            </div>
          ))}
        </div>
      </div>

    </section>
  );
}
