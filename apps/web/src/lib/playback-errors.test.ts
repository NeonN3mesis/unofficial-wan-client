import { describe, expect, it } from "vitest";
import {
  classifyIvsPlaybackError,
  isMediaDecodeErrorMessage
} from "./playback-errors";

describe("playback error classification", () => {
  it("treats Chromium pipeline decode failures as recoverable media errors", () => {
    const message =
      "PipelineStatus::PIPELINE_ERROR_DECODE: Failed to send audio packet for decoding";

    expect(isMediaDecodeErrorMessage(message)).toBe(true);
    expect(classifyIvsPlaybackError({ type: "Error", message })).toEqual({
      kind: "media",
      message: "Playback decoder issue detected. Reloading the media pipeline."
    });
  });

  it("keeps IVS network failures classified as network recovery", () => {
    expect(classifyIvsPlaybackError({ type: "ErrorNetworkIO" })).toEqual({
      kind: "network",
      message: "The IVS player lost the live connection. Refreshing the Floatplane playback URL."
    });
  });
});
