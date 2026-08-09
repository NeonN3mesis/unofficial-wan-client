#!/usr/bin/env node

import { spawn } from "node:child_process";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const projectRoot = path.resolve(__dirname, "..");
const builderCli = path.resolve(projectRoot, "node_modules/electron-builder/cli.js");
const args = process.argv.slice(2);
const nodeMajor = Number.parseInt(process.versions.node.split(".")[0] ?? "0", 10);

function forwardExit(child) {
  child.on("exit", (code, signal) => {
    if (signal) {
      process.kill(process.pid, signal);
      return;
    }

    process.exit(code ?? 1);
  });

  child.on("error", (error) => {
    console.error(
      "[dist:linux] Failed to start electron-builder:",
      error instanceof Error ? error.message : String(error)
    );
    process.exit(1);
  });
}

if (nodeMajor >= 22) {
  forwardExit(
    spawn(process.execPath, [builderCli, ...args], {
      cwd: projectRoot,
      stdio: "inherit"
    })
  );
} else {
  console.warn(
    `[dist:linux] Node ${process.versions.node} cannot package this app reliably with electron-builder 26.15.5. ` +
      "Using a temporary Node 22 runtime via npx."
  );

  const npxCommand = process.platform === "win32" ? "npx.cmd" : "npx";

  forwardExit(
    spawn(npxCommand, ["-y", "node@22", builderCli, ...args], {
      cwd: projectRoot,
      stdio: "inherit"
    })
  );
}
