import { describe, expect, it } from "vitest";
import {
  evaluateIvsStabilityTuning,
  evaluateHlsLiveCatchUp,
  evaluateNativeLiveCatchUp
} from "./live-playback";

describe("live playback heuristics", () => {
  it("aggressively speeds up low-latency hls playback when it starts drifting", () => {
    const decision = evaluateHlsLiveCatchUp({
      latencySeconds: 4,
      targetLatencySeconds: 2,
      latencyTarget: "low",
      nowMs: 10_000,
      state: {
        overshootCount: 0,
        lastHardSeekAt: 0
      }
    });

    expect(decision.hardSeek).toBe(false);
    expect(decision.playbackRate).toBe(1.04);
    expect(decision.state.overshootCount).toBe(0);
  });

  it("requires sustained overshoot before hard-seeking hls streams", () => {
    const decision = evaluateHlsLiveCatchUp({
      latencySeconds: 8,
      targetLatencySeconds: 2,
      latencyTarget: "low",
      nowMs: 10_000,
      state: {
        overshootCount: 1,
        lastHardSeekAt: 0
      }
    });

    expect(decision.hardSeek).toBe(true);
    expect(decision.playbackRate).toBe(1);
    expect(decision.state.overshootCount).toBe(0);
  });

  it("keeps native live playback in rate-based catch-up until latency is persistently large", () => {
    const gentle = evaluateNativeLiveCatchUp({
      latencySeconds: 7,
      nowMs: 5_000,
      state: {
        overshootCount: 0,
        lastHardSeekAt: 0
      }
    });

    const hard = evaluateNativeLiveCatchUp({
      latencySeconds: 28,
      nowMs: 20_000,
      state: {
        overshootCount: 3,
        lastHardSeekAt: 0
      }
    });

    expect(gentle.hardSeek).toBe(false);
    expect(gentle.playbackRate).toBe(1);
    expect(hard.hardSeek).toBe(true);
  });

  it("widens the IVS live-latency envelope after repeated rebuffers", () => {
    const tuning = evaluateIvsStabilityTuning({
      recentRebufferCount: 2,
      msSinceLastRebuffer: 10_000
    });

    expect(tuning.initialBufferSeconds).toBe(0.6);
    expect(tuning.maxLatencySeconds).toBe(8);
    expect(tuning.speedUpRate).toBe(1.03);
    expect(tuning.autoEdgePaddingSeconds).toBe(1.15);
    expect(tuning.shouldRefreshPlaybackSource).toBe(false);
  });

  it("falls back to the normal IVS close-edge profile once the stream has been stable", () => {
    const tuning = evaluateIvsStabilityTuning({
      recentRebufferCount: 2,
      msSinceLastRebuffer: 50_000
    });

    expect(tuning.maxLatencySeconds).toBe(6);
    expect(tuning.speedUpRate).toBe(1.06);
    expect(tuning.autoEdgePaddingSeconds).toBe(0.45);
    expect(tuning.emergencyCatchUpThresholdSeconds).toBe(9.5);
  });

  it("only refreshes the playback source after severe IVS instability", () => {
    const tuning = evaluateIvsStabilityTuning({
      recentRebufferCount: 5,
      msSinceLastRebuffer: 5_000
    });

    expect(tuning.shouldRefreshPlaybackSource).toBe(true);
  });
});
