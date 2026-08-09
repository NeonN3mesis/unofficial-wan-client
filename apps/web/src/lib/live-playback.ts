import type { PlaybackSource } from "@shared";

const DEFAULT_HARD_SEEK_COOLDOWN_MS = 16_000;
const LOW_LATENCY_HARD_SEEK_COOLDOWN_MS = 5_000;
const DEFAULT_REQUIRED_OVERSHOOT_SAMPLES = 4;
const LOW_LATENCY_REQUIRED_OVERSHOOT_SAMPLES = 2;
const IVS_NORMAL_INITIAL_BUFFER_SECONDS = 0.6;
const IVS_NORMAL_MAX_LATENCY_SECONDS = 6;
const IVS_GUARDED_MAX_LATENCY_SECONDS = 8;
const IVS_NORMAL_SPEED_UP_RATE = 1.06;
const IVS_GUARDED_SPEED_UP_RATE = 1.03;
const IVS_NORMAL_AUTO_EDGE_PADDING_SECONDS = 0.45;
const IVS_GUARDED_AUTO_EDGE_PADDING_SECONDS = 1.15;
const IVS_NORMAL_EMERGENCY_CATCH_UP_THRESHOLD_SECONDS = 9.5;
const IVS_GUARDED_EMERGENCY_CATCH_UP_THRESHOLD_SECONDS = 12;
const IVS_GUARDED_REBUFFER_THRESHOLD = 2;
const IVS_REFRESH_REBUFFER_THRESHOLD = 5;
const IVS_GUARDED_RECOVERY_WINDOW_MS = 45_000;
const IVS_REFRESH_WINDOW_MS = 30_000;

export interface LiveCatchUpState {
  overshootCount: number;
  lastHardSeekAt: number;
}

export interface LiveCatchUpDecision {
  playbackRate: number;
  hardSeek: boolean;
  state: LiveCatchUpState;
}

export interface IvsStabilityTuning {
  initialBufferSeconds: number;
  maxLatencySeconds: number;
  speedUpRate: number;
  autoEdgePaddingSeconds: number;
  emergencyCatchUpThresholdSeconds: number;
  shouldRefreshPlaybackSource: boolean;
}

function withHardSeek(
  state: LiveCatchUpState,
  nowMs: number
): LiveCatchUpDecision {
  return {
    playbackRate: 1,
    hardSeek: true,
    state: {
      overshootCount: 0,
      lastHardSeekAt: nowMs
    }
  };
}

function withPlaybackRate(
  state: LiveCatchUpState,
  playbackRate: number,
  overshootCount = 0
): LiveCatchUpDecision {
  return {
    playbackRate,
    hardSeek: false,
    state: {
      ...state,
      overshootCount
    }
  };
}

export function evaluateHlsLiveCatchUp(options: {
  latencySeconds: number;
  targetLatencySeconds: number;
  latencyTarget: PlaybackSource["latencyTarget"];
  state: LiveCatchUpState;
  nowMs: number;
}): LiveCatchUpDecision {
  const { latencySeconds, targetLatencySeconds, latencyTarget, state, nowMs } = options;
  const isLowLatency = latencyTarget === "low";
  const overshootSeconds = Math.max(latencySeconds - targetLatencySeconds, 0);
  const softThreshold = isLowLatency ? 1.5 : 4;
  const mediumThreshold = isLowLatency ? 3 : 8;
  const hardThreshold = isLowLatency ? 5 : 14;
  const requiredOvershootSamples = isLowLatency
    ? LOW_LATENCY_REQUIRED_OVERSHOOT_SAMPLES
    : DEFAULT_REQUIRED_OVERSHOOT_SAMPLES;
  const hardSeekCooldownMs = isLowLatency
    ? LOW_LATENCY_HARD_SEEK_COOLDOWN_MS
    : DEFAULT_HARD_SEEK_COOLDOWN_MS;

  if (overshootSeconds >= hardThreshold) {
    const overshootCount = state.overshootCount + 1;

    if (
      overshootCount >= requiredOvershootSamples &&
      nowMs - state.lastHardSeekAt >= hardSeekCooldownMs
    ) {
      return withHardSeek(state, nowMs);
    }

    return withPlaybackRate(state, isLowLatency ? 1.12 : 1.01, overshootCount);
  }

  if (overshootSeconds >= mediumThreshold) {
    return withPlaybackRate(state, isLowLatency ? 1.08 : 1.005);
  }

  if (overshootSeconds >= softThreshold) {
    return withPlaybackRate(state, isLowLatency ? 1.04 : 1.003);
  }

  return withPlaybackRate(state, 1);
}

export function evaluateNativeLiveCatchUp(options: {
  latencySeconds: number;
  state: LiveCatchUpState;
  nowMs: number;
}): LiveCatchUpDecision {
  const { latencySeconds, state, nowMs } = options;

  if (latencySeconds >= 18) {
    const overshootCount = state.overshootCount + 1;

    if (
      overshootCount >= DEFAULT_REQUIRED_OVERSHOOT_SAMPLES &&
      nowMs - state.lastHardSeekAt >= DEFAULT_HARD_SEEK_COOLDOWN_MS
    ) {
      return withHardSeek(state, nowMs);
    }

    return withPlaybackRate(state, 1.01, overshootCount);
  }

  if (latencySeconds >= 12) {
    return withPlaybackRate(state, 1.005);
  }

  if (latencySeconds >= 8) {
    return withPlaybackRate(state, 1.003);
  }

  return withPlaybackRate(state, 1);
}

export function evaluateIvsStabilityTuning(options: {
  recentRebufferCount: number;
  msSinceLastRebuffer: number | null;
}): IvsStabilityTuning {
  const { recentRebufferCount, msSinceLastRebuffer } = options;
  const rebufferRecently =
    msSinceLastRebuffer !== null && msSinceLastRebuffer < IVS_GUARDED_RECOVERY_WINDOW_MS;
  const guarded =
    recentRebufferCount >= IVS_GUARDED_REBUFFER_THRESHOLD && rebufferRecently;
  const refreshWindowOpen =
    msSinceLastRebuffer !== null && msSinceLastRebuffer < IVS_REFRESH_WINDOW_MS;

  return {
    initialBufferSeconds: IVS_NORMAL_INITIAL_BUFFER_SECONDS,
    maxLatencySeconds: guarded ? IVS_GUARDED_MAX_LATENCY_SECONDS : IVS_NORMAL_MAX_LATENCY_SECONDS,
    speedUpRate: guarded ? IVS_GUARDED_SPEED_UP_RATE : IVS_NORMAL_SPEED_UP_RATE,
    autoEdgePaddingSeconds: guarded
      ? IVS_GUARDED_AUTO_EDGE_PADDING_SECONDS
      : IVS_NORMAL_AUTO_EDGE_PADDING_SECONDS,
    emergencyCatchUpThresholdSeconds: guarded
      ? IVS_GUARDED_EMERGENCY_CATCH_UP_THRESHOLD_SECONDS
      : IVS_NORMAL_EMERGENCY_CATCH_UP_THRESHOLD_SECONDS,
    shouldRefreshPlaybackSource:
      recentRebufferCount >= IVS_REFRESH_REBUFFER_THRESHOLD && refreshWindowOpen
  };
}
