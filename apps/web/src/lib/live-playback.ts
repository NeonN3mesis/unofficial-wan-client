import type { PlaybackSource } from "@shared";

const DEFAULT_HARD_SEEK_COOLDOWN_MS = 16_000;
const LOW_LATENCY_HARD_SEEK_COOLDOWN_MS = 5_000;
const DEFAULT_REQUIRED_OVERSHOOT_SAMPLES = 4;
const LOW_LATENCY_REQUIRED_OVERSHOOT_SAMPLES = 2;

export interface LiveCatchUpState {
  overshootCount: number;
  lastHardSeekAt: number;
}

export interface LiveCatchUpDecision {
  playbackRate: number;
  hardSeek: boolean;
  state: LiveCatchUpState;
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
