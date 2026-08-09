import { describe, expect, it } from "vitest";
import { shouldTreatPauseAsUserPause } from "./playback-startup";

describe("playback startup pause classification", () => {
  it("ignores pause events while a fresh source is still starting", () => {
    expect(
      shouldTreatPauseAsUserPause({
        pauseTrackingSuspended: false,
        playbackEnded: false,
        hasPlayedSinceSourceLoad: false
      })
    ).toBe(false);
  });

  it("preserves intentional pauses after playback has actually started", () => {
    expect(
      shouldTreatPauseAsUserPause({
        pauseTrackingSuspended: false,
        playbackEnded: false,
        hasPlayedSinceSourceLoad: true
      })
    ).toBe(true);
  });

  it("ignores teardown and ended-state pauses", () => {
    expect(
      shouldTreatPauseAsUserPause({
        pauseTrackingSuspended: true,
        playbackEnded: false,
        hasPlayedSinceSourceLoad: true
      })
    ).toBe(false);

    expect(
      shouldTreatPauseAsUserPause({
        pauseTrackingSuspended: false,
        playbackEnded: true,
        hasPlayedSinceSourceLoad: true
      })
    ).toBe(false);
  });
});
