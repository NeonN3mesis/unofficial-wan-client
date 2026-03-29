import { spawn, type ChildProcess } from "node:child_process";
import { constants as fsConstants } from "node:fs";
import fs from "node:fs/promises";
import { createServer } from "node:net";
import path from "node:path";
import { setTimeout as delay } from "node:timers/promises";
import { serverConfig } from "../config.js";

const DEFAULT_BROWSER_CANDIDATES = [
  "google-chrome-stable",
  "google-chrome",
  "chromium-browser",
  "chromium"
];

async function isExecutable(filePath: string): Promise<boolean> {
  try {
    await fs.access(filePath, fsConstants.X_OK);
    return true;
  } catch {
    return false;
  }
}

async function resolveFromPath(command: string): Promise<string | null> {
  const searchPath = process.env.PATH?.split(path.delimiter) ?? [];

  for (const segment of searchPath) {
    const candidate = path.join(segment, command);

    if (await isExecutable(candidate)) {
      return candidate;
    }
  }

  return null;
}

export async function resolveBrowserPath(): Promise<string> {
  const candidates = [
    serverConfig.captureBrowserPath,
    ...DEFAULT_BROWSER_CANDIDATES
  ].filter((candidate): candidate is string => Boolean(candidate));

  for (const candidate of candidates) {
    if (candidate.includes(path.sep)) {
      if (await isExecutable(candidate)) {
        return candidate;
      }

      continue;
    }

    const resolved = await resolveFromPath(candidate);

    if (resolved) {
      return resolved;
    }
  }

  throw new Error(
    "Could not find a supported Chrome/Chromium executable. Set FLOATPLANE_CAPTURE_BROWSER to override."
  );
}

export function buildDebugEndpoint(port = serverConfig.captureDebugPort): string {
  return serverConfig.captureAttachUrl ?? `http://127.0.0.1:${port}`;
}

export async function reserveLoopbackPort(): Promise<number> {
  return await new Promise<number>((resolve, reject) => {
    const server = createServer();

    server.once("error", reject);
    server.listen(0, "127.0.0.1", () => {
      const address = server.address();
      const port = typeof address === "object" && address ? address.port : 0;

      server.close((error) => {
        if (error) {
          reject(error);
          return;
        }

        if (!port) {
          reject(new Error("Could not reserve a loopback debugging port."));
          return;
        }

        resolve(port);
      });
    });
  });
}

export async function resolveManagedDebugTarget(): Promise<{ endpoint: string; port: number }> {
  if (serverConfig.captureAttachUrl) {
    try {
      const parsed = new URL(serverConfig.captureAttachUrl);
      const port = Number(parsed.port || serverConfig.captureDebugPort);
      return {
        endpoint: serverConfig.captureAttachUrl,
        port
      };
    } catch {
      return {
        endpoint: serverConfig.captureAttachUrl,
        port: serverConfig.captureDebugPort
      };
    }
  }

  const port = await reserveLoopbackPort();
  return {
    endpoint: buildDebugEndpoint(port),
    port
  };
}

export async function waitForDebugEndpoint(endpoint: string, timeoutMs = 15_000): Promise<void> {
  const startedAt = Date.now();

  while (Date.now() - startedAt < timeoutMs) {
    try {
      const response = await fetch(`${endpoint}/json/version`);

      if (response.ok) {
        return;
      }
    } catch {
      // Chrome may still be starting up.
    }

    await delay(250);
  }

  throw new Error(`Timed out waiting for Chrome debug endpoint at ${endpoint}`);
}

export async function launchManagedChrome(startUrl: string, debugPort: number): Promise<ChildProcess> {
  const browserPath = await resolveBrowserPath();

  return spawn(
    browserPath,
    [
      `--remote-debugging-port=${debugPort}`,
      `--user-data-dir=${serverConfig.captureProfileDir}`,
      "--no-first-run",
      "--no-default-browser-check",
      "--new-window",
      "--disable-blink-features=AutomationControlled",
      startUrl
    ],
    {
      stdio: "ignore"
    }
  );
}
