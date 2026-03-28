import fs from "node:fs/promises";
import { serverConfig } from "../apps/server/src/config.js";
import {
  readHarObservations,
  summarizeCaptureObservations
} from "../apps/server/src/services/capture-artifacts.js";

async function main() {
  const observations = await readHarObservations(serverConfig.captureHarFilePath);
  const summary = summarizeCaptureObservations(observations, {
    sourceHarPath: serverConfig.captureHarFilePath
  });

  await fs.writeFile(serverConfig.captureSummaryFilePath, JSON.stringify(summary, null, 2));

  console.log(`Saved ${serverConfig.captureSummaryFilePath}`);
  console.log(`Playback candidates: ${summary.playbackCandidates.length}`);
  console.log(`Chat candidates: ${summary.chatCandidates.length}`);
  console.log(`Auth candidates: ${summary.authCandidates.length}`);
}

void main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
