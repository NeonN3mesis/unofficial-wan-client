export type PlaybackErrorRecoveryKind = "media" | "network" | "source" | "error";

export interface PlaybackErrorRecoveryDecision {
  kind: PlaybackErrorRecoveryKind;
  message: string;
}

const DECODE_ERROR_PATTERNS = [
  /PIPELINE_ERROR_DECODE/i,
  /failed to send (?:audio|video) packet for decoding/i,
  /\bdecode(?:r|d|s|ing)?\b/i,
  /media pipeline/i
];

export function isMediaDecodeErrorMessage(message: string | null | undefined): boolean {
  if (!message) {
    return false;
  }

  return DECODE_ERROR_PATTERNS.some((pattern) => pattern.test(message));
}

export function classifyIvsPlaybackError(options: {
  type?: string;
  message?: string;
}): PlaybackErrorRecoveryDecision {
  if (isMediaDecodeErrorMessage(options.message)) {
    return {
      kind: "media",
      message: "Playback decoder issue detected. Reloading the media pipeline."
    };
  }

  if (options.type === "ErrorNetwork" || options.type === "ErrorNetworkIO") {
    return {
      kind: "network",
      message: "The IVS player lost the live connection. Refreshing the Floatplane playback URL."
    };
  }

  if (options.type === "ErrorAuthorization" || options.type === "ErrorNotAvailable") {
    return {
      kind: "source",
      message: "The current playback URL expired or became unavailable. Refreshing it from Floatplane."
    };
  }

  return {
    kind: "error",
    message: options.message || "The IVS player encountered a fatal error."
  };
}

export function classifyHtmlMediaError(error: MediaError | null): PlaybackErrorRecoveryDecision {
  const message = error?.message ?? "";

  if (error?.code === MediaError.MEDIA_ERR_DECODE || isMediaDecodeErrorMessage(message)) {
    return {
      kind: "media",
      message: "Playback decoder issue detected. Reloading the media pipeline."
    };
  }

  if (error?.code === MediaError.MEDIA_ERR_NETWORK) {
    return {
      kind: "network",
      message: "Playback lost the live connection. Refreshing the Floatplane playback URL."
    };
  }

  if (error?.code === MediaError.MEDIA_ERR_SRC_NOT_SUPPORTED) {
    return {
      kind: "source",
      message: "The current playback source is unavailable. Refreshing it from Floatplane."
    };
  }

  return {
    kind: "error",
    message: message || "Playback hit an unexpected error. Refresh live state or reconnect if it does not recover."
  };
}
