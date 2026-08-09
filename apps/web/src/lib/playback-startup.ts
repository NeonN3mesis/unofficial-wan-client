export interface PauseClassificationOptions {
  pauseTrackingSuspended: boolean;
  playbackEnded: boolean;
  hasPlayedSinceSourceLoad: boolean;
}

export function shouldTreatPauseAsUserPause(
  options: PauseClassificationOptions
): boolean {
  const {
    pauseTrackingSuspended,
    playbackEnded,
    hasPlayedSinceSourceLoad
  } = options;

  if (pauseTrackingSuspended || playbackEnded) {
    return false;
  }

  return hasPlayedSinceSourceLoad;
}
