import { describe, expect, it } from "vitest";
import {
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
});
