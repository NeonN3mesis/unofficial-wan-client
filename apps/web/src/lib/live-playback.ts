import type { PlaybackSource } from "@shared";

const HARD_SEEK_COOLDOWN_MS = 12_000;
const REQUIRED_OVERSHOOT_SAMPLES = 3;

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
  const softThreshold = targetLatencySeconds + (latencyTarget === "low" ? 2 : 3);
  const mediumThreshold = targetLatencySeconds + (latencyTarget === "low" ? 4.5 : 6.5);
  const hardThreshold = targetLatencySeconds + (latencyTarget === "low" ? 10 : 14);

  if (latencySeconds >= hardThreshold) {
    const overshootCount = state.overshootCount + 1;

    if (
      overshootCount >= REQUIRED_OVERSHOOT_SAMPLES &&
      nowMs - state.lastHardSeekAt >= HARD_SEEK_COOLDOWN_MS
    ) {
      return withHardSeek(state, nowMs);
    }

    return withPlaybackRate(
      state,
      latencyTarget === "low" ? 1.08 : 1.05,
      overshootCount
    );
  }

  if (latencySeconds >= mediumThreshold) {
    return withPlaybackRate(state, latencyTarget === "low" ? 1.06 : 1.04);
  }

  if (latencySeconds >= softThreshold) {
    return withPlaybackRate(state, latencyTarget === "low" ? 1.03 : 1.02);
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
      overshootCount >= REQUIRED_OVERSHOOT_SAMPLES &&
      nowMs - state.lastHardSeekAt >= HARD_SEEK_COOLDOWN_MS
    ) {
      return withHardSeek(state, nowMs);
    }

    return withPlaybackRate(state, 1.05, overshootCount);
  }

  if (latencySeconds >= 10) {
    return withPlaybackRate(state, 1.03);
  }

  if (latencySeconds >= 6) {
    return withPlaybackRate(state, 1.02);
  }

  return withPlaybackRate(state, 1);
}
