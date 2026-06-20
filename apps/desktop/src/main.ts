import { randomBytes } from "node:crypto";
import fs from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import electron from "electron";
import type { MenuItemConstructorOptions } from "electron";
import type {
  BackgroundWatchSettings,
  DesktopPreferences,
  DesktopSimulationSettings,
  DesktopState,
  LaunchReason
} from "../../../packages/shared/src/index.js";
import {
  DEFAULT_DESKTOP_PREFERENCES,
  sanitizeDesktopPreferences
} from "../../../packages/shared/src/index.js";
import {
  BackgroundWatchController,
  type AutoWatchDiagnosticEvent
} from "./background-watch-controller.js";
import { syncLinuxAutostart } from "./linux-autostart.js";
import { classifyNavigationTarget } from "./navigation-policy.js";
import {
  resolveDesktopLaunchCommand,
  resolveDesktopWebDistDir
} from "./runtime-paths.js";
import {
  DEFAULT_DESKTOP_SIMULATION_SETTINGS,
  desktopSimulationPresetFromArgv,
  resolveDesktopSimulationState,
  resolveSimulationNow,
  sanitizeDesktopSimulationSettings,
  simulationSettingsForPreset,
  type DesktopSimulationPreset
} from "./simulation.js";
import { JsonFileStore } from "./store.js";

const {
  app,
  BrowserWindow,
  Menu,
  Tray,
  ipcMain,
  nativeImage,
  powerMonitor,
  powerSaveBlocker,
  screen,
  shell
} = electron;
type BrowserWindowInstance = InstanceType<typeof BrowserWindow>;
type TrayInstance = InstanceType<typeof Tray>;

app.commandLine.appendSwitch("autoplay-policy", "no-user-gesture-required");

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const DEFAULT_SETTINGS: BackgroundWatchSettings = {
  enabled: false,
  autostartOnLogin: false,
  weeklyWindow: {
    dayOfWeek: 5,
    startLocalTime: "19:00",
    endLocalTime: "00:00"
  }
};
const STANDARD_WINDOW_BOUNDS = {
  width: 1520,
  height: 980,
  minWidth: 1180,
  minHeight: 760
};
const COMPACT_WINDOW_BOUNDS = {
  width: 560,
  height: 420,
  minWidth: 420,
  minHeight: 320
};
const RENDERER_HEARTBEAT_STALE_MS = 12_000;
const RENDERER_HEARTBEAT_CHECK_MS = 4_000;
const WINDOW_FOCUS_SETTLE_MS = 400;
const WINDOW_ATTENTION_FLASH_MS = 15_000;

let desktopState: DesktopState = {
  settings: DEFAULT_SETTINGS,
  preferences: DEFAULT_DESKTOP_PREFERENCES,
  status: {
    state: "idle",
    enabled: false,
    activeWindow: false,
    message: "Auto-watch is disabled.",
    launchSequence: 0
  },
  simulation: {
    available: false,
    active: false,
    ...DEFAULT_DESKTOP_SIMULATION_SETTINGS
  }
};
let mainWindow: BrowserWindowInstance | null = null;
let tray: TrayInstance | null = null;
let isQuitting = false;
const simulationAvailable =
  !app.isPackaged || process.env.FLOATPLANE_ENABLE_DESKTOP_SIMULATION === "1";
let serverRuntime:
  | {
      host: string;
      port: number;
      adapter: {
        getSessionState: () => Promise<unknown>;
        getWanLiveState: (forceRefresh?: boolean) => Promise<unknown>;
      };
      authService: {
        start: () => Promise<unknown>;
        dispose: () => Promise<void>;
      };
      close: () => Promise<void>;
    }
  | undefined;
let watchController: BackgroundWatchController | undefined;
let settingsStore: JsonFileStore<BackgroundWatchSettings> | undefined;
let preferencesStore: JsonFileStore<DesktopPreferences> | undefined;
let simulationSettings: DesktopSimulationSettings = DEFAULT_DESKTOP_SIMULATION_SETTINGS;
let watchWindowPowerBlockerId: number | undefined;
let buildSimulationPlaybackUrl:
  | ((url: string, contentType?: string) => string)
  | undefined;
let requestAuthToken = "";
let standardWindowBounds:
  | {
      x: number;
      y: number;
      width: number;
      height: number;
    }
  | undefined;
let rendererHeartbeatMonitor: NodeJS.Timeout | undefined;
let lastRendererHeartbeatAt = 0;
let lastRendererHeartbeat: Record<string, unknown> | null = null;
let lastRendererIssue: Record<string, unknown> | null = null;
let lastHangDiagnosticAt = 0;
let autoWatchDiagnosticsFilePath: string | undefined;

function getAppOrigin(): string {
  if (!serverRuntime) {
    throw new Error("Desktop server runtime is not available yet.");
  }

  return `http://${serverRuntime.host}:${serverRuntime.port}`;
}

function getWindowBoundsForMode(compactMode: boolean) {
  return compactMode ? COMPACT_WINDOW_BOUNDS : STANDARD_WINDOW_BOUNDS;
}

function getCenteredBoundsForPrimaryDisplay(compactMode: boolean) {
  const targetBounds = getWindowBoundsForMode(compactMode);
  const workArea = screen.getPrimaryDisplay().workArea;
  const width = Math.min(targetBounds.width, workArea.width);
  const height = Math.min(targetBounds.height, workArea.height);

  return {
    x: Math.round(workArea.x + (workArea.width - width) / 2),
    y: Math.round(workArea.y + (workArea.height - height) / 2),
    width,
    height
  };
}

function ensureWindowVisibleOnScreen(window: BrowserWindowInstance) {
  if (process.env.WAN_FORCE_PRIMARY_WINDOW === "1") {
    window.setBounds(getCenteredBoundsForPrimaryDisplay(desktopState.preferences.window.compactMode));
    return;
  }

  const currentBounds = window.getBounds();
  const matchingDisplay = screen.getDisplayMatching(currentBounds);
  const workArea = matchingDisplay.workArea;
  const horizontallyVisible =
    currentBounds.x < workArea.x + workArea.width &&
    currentBounds.x + currentBounds.width > workArea.x;
  const verticallyVisible =
    currentBounds.y < workArea.y + workArea.height &&
    currentBounds.y + currentBounds.height > workArea.y;

  if (horizontallyVisible && verticallyVisible) {
    return;
  }

  window.setBounds(getCenteredBoundsForPrimaryDisplay(desktopState.preferences.window.compactMode));
}

function bringWindowToFront(window: BrowserWindowInstance) {
  ensureWindowVisibleOnScreen(window);

  if (window.isMinimized()) {
    window.restore();
  }

  window.show();
  window.moveTop();
  app.focus({ steal: true });
  window.focus();

  if (window.isFocused()) {
    return;
  }

  const preferredAlwaysOnTop = desktopState.preferences.window.alwaysOnTop;
  window.setAlwaysOnTop(true);
  window.moveTop();
  app.focus({ steal: true });
  window.focus();

  setTimeout(() => {
    if (!window.isDestroyed()) {
      window.setAlwaysOnTop(preferredAlwaysOnTop);
    }
  }, 1_500);
}

function scheduleWindowAttention(window: BrowserWindowInstance, reason: LaunchReason) {
  setTimeout(() => {
    if (window.isDestroyed()) {
      return;
    }

    const focused = window.isFocused();
    appendAutoWatchDiagnostic({
      event: "desktop-window-focus-check",
      at: new Date().toISOString(),
      details: {
        reason,
        windowVisible: window.isVisible(),
        windowFocused: focused,
        windowBounds: window.getBounds()
      }
    });

    if (focused) {
      window.flashFrame(false);
      return;
    }

    window.flashFrame(true);
    const stopFlashing = () => {
      if (!window.isDestroyed()) {
        window.flashFrame(false);
      }
    };

    window.once("focus", stopFlashing);
    setTimeout(() => {
      window.removeListener("focus", stopFlashing);
      stopFlashing();
    }, WINDOW_ATTENTION_FLASH_MS);
  }, WINDOW_FOCUS_SETTLE_MS);
}

function applyWindowPreferences(previousCompactMode = desktopState.preferences.window.compactMode) {
  if (!mainWindow || mainWindow.isDestroyed()) {
    return;
  }

  const nextCompactMode = desktopState.preferences.window.compactMode;
  const nextBounds = getWindowBoundsForMode(nextCompactMode);

  mainWindow.setAlwaysOnTop(desktopState.preferences.window.alwaysOnTop);
  mainWindow.setMinimumSize(nextBounds.minWidth, nextBounds.minHeight);

  if (nextCompactMode) {
    if (!previousCompactMode) {
      standardWindowBounds = mainWindow.getBounds();
    }

    const currentBounds = mainWindow.getBounds();
    const width = Math.min(
      Math.max(currentBounds.width, COMPACT_WINDOW_BOUNDS.minWidth),
      COMPACT_WINDOW_BOUNDS.width
    );
    const height = Math.min(
      Math.max(currentBounds.height, COMPACT_WINDOW_BOUNDS.minHeight),
      COMPACT_WINDOW_BOUNDS.height
    );

    mainWindow.setBounds({
      ...currentBounds,
      width,
      height
    });
    return;
  }

  if (previousCompactMode && standardWindowBounds) {
    mainWindow.setBounds(standardWindowBounds);
    return;
  }

  const currentBounds = mainWindow.getBounds();

  if (
    currentBounds.width < STANDARD_WINDOW_BOUNDS.minWidth ||
    currentBounds.height < STANDARD_WINDOW_BOUNDS.minHeight
  ) {
    mainWindow.setBounds({
      ...currentBounds,
      width: Math.max(currentBounds.width, STANDARD_WINDOW_BOUNDS.width),
      height: Math.max(currentBounds.height, STANDARD_WINDOW_BOUNDS.height)
    });
  }
}

function openExternalUrl(targetUrl: string) {
  void shell.openExternal(targetUrl).catch((error) => {
    console.error("Failed to open external URL", error);
  });
}

function createTrayImage() {
  const svg = `
    <svg xmlns="http://www.w3.org/2000/svg" width="64" height="64" viewBox="0 0 64 64">
      <rect width="64" height="64" rx="18" fill="#101923"/>
      <path d="M18 44l9-24h6l9 24h-6l-1.7-5h-8.7L24 44h-6zm10.4-10h5.3L31 26.2 28.4 34z" fill="#ff9d23"/>
      <circle cx="48" cy="16" r="6" fill="#56b5ea"/>
    </svg>
  `;

  return nativeImage.createFromDataURL(
    `data:image/svg+xml;base64,${Buffer.from(svg).toString("base64")}`
  );
}

function emitDesktopState() {
  if (!mainWindow || mainWindow.isDestroyed()) {
    return;
  }

  mainWindow.webContents.send("desktop:state-changed", desktopState);
}

async function writeHangDiagnosticArtifact(label: string, details: Record<string, unknown>) {
  const outputDir = path.join(process.cwd(), "tmp", "hang-diagnostics");

  await fs.mkdir(outputDir, { recursive: true });
  await fs.writeFile(
    path.join(outputDir, `${new Date().toISOString().replace(/[:.]/g, "-")}-${label}.json`),
    JSON.stringify(details, null, 2)
  );
}

function appendAutoWatchDiagnostic(event: AutoWatchDiagnosticEvent) {
  if (!autoWatchDiagnosticsFilePath) {
    return;
  }

  const payload = {
    ...event,
    pid: process.pid,
    appVersion: app.getVersion()
  };

  void fs
    .appendFile(autoWatchDiagnosticsFilePath, `${JSON.stringify(payload)}\n`, { mode: 0o600 })
    .catch((error) => {
      console.error("Failed to append auto-watch diagnostics", error);
    });
}

async function dumpHangDiagnostics(reason: string, extra: Record<string, unknown> = {}) {
  const windowRef = mainWindow;

  if (!windowRef || windowRef.isDestroyed()) {
    return;
  }

  const now = Date.now();

  if (now - lastHangDiagnosticAt < 10_000) {
    return;
  }

  lastHangDiagnosticAt = now;

  const details: Record<string, unknown> = {
    capturedAt: new Date(now).toISOString(),
    reason,
    pid: process.pid,
    appVersion: app.getVersion(),
    windowVisible: windowRef.isVisible(),
    windowFocused: windowRef.isFocused(),
    windowBounds: windowRef.getBounds(),
    webContentsUrl: windowRef.webContents.getURL(),
    webContentsLoading: windowRef.webContents.isLoading(),
    webContentsCrashed: windowRef.webContents.isCrashed(),
    webContentsDestroyed: windowRef.webContents.isDestroyed(),
    lastRendererHeartbeatAt:
      lastRendererHeartbeatAt > 0 ? new Date(lastRendererHeartbeatAt).toISOString() : null,
    millisecondsSinceHeartbeat: lastRendererHeartbeatAt > 0 ? now - lastRendererHeartbeatAt : null,
    lastRendererHeartbeat,
    lastRendererIssue,
    extra
  };

  try {
    await writeHangDiagnosticArtifact(reason, details);
    console.error("[HangDiag]", reason, details);
    void dumpRendererDebugSnapshot(`hang-${reason}`);
    void dumpPlaybackDebugSnapshot(`hang-${reason}`);
  } catch (error) {
    console.error("Failed to persist hang diagnostics", error);
  }
}

function resetRendererHeartbeatState() {
  lastRendererHeartbeatAt = 0;
  lastRendererHeartbeat = null;
  lastRendererIssue = null;
  lastHangDiagnosticAt = 0;
}

function startRendererHeartbeatMonitor() {
  if (rendererHeartbeatMonitor) {
    clearInterval(rendererHeartbeatMonitor);
  }

  rendererHeartbeatMonitor = setInterval(() => {
    const windowRef = mainWindow;

    if (!windowRef || windowRef.isDestroyed() || !lastRendererHeartbeatAt) {
      return;
    }

    const elapsed = Date.now() - lastRendererHeartbeatAt;

    if (elapsed >= RENDERER_HEARTBEAT_STALE_MS) {
      void dumpHangDiagnostics("heartbeat-stalled", {
        staleForMs: elapsed
      });
    }
  }, RENDERER_HEARTBEAT_CHECK_MS);
}

async function dumpRendererDebugSnapshot(label: string) {
  if (!process.env.WAN_DEBUG_RENDER || !mainWindow || mainWindow.isDestroyed()) {
    return;
  }

  try {
    const details = await mainWindow.webContents.executeJavaScript(`
      (() => {
        const read = (selector) => {
          const element = document.querySelector(selector);

          if (!element) {
            return null;
          }

          const style = getComputedStyle(element);
          const rect = element.getBoundingClientRect();

          return {
            selector,
            text: element.textContent?.slice(0, 200) ?? "",
            display: style.display,
            opacity: style.opacity,
            visibility: style.visibility,
            position: style.position,
            zIndex: style.zIndex,
            rect: {
              x: rect.x,
              y: rect.y,
              width: rect.width,
              height: rect.height
            }
          };
        };

        return {
          title: document.title,
          bodyText: document.body.innerText.slice(0, 1200),
          rootChildCount: document.getElementById("root")?.children.length ?? 0,
          nodes: [
            read(".app-shell"),
            read(".shell-header"),
            read(".desktop-control-panel"),
            read(".workspace"),
            read(".video-stage"),
            read(".chat-pane")
          ]
        };
      })();
    `);
    const image = await mainWindow.webContents.capturePage();
    const outputDir = path.join(process.cwd(), "tmp");

    await fs.mkdir(outputDir, { recursive: true });
    await fs.writeFile(path.join(outputDir, `electron-render-${label}.json`), JSON.stringify(details, null, 2));
    await fs.writeFile(path.join(outputDir, `electron-render-${label}.png`), image.toPNG());
    console.log("Saved renderer debug snapshot", label, details);
  } catch (error) {
    console.error("Failed to capture renderer debug snapshot", error);
  }
}

async function dumpPlaybackDebugSnapshot(label: string) {
  if (!process.env.WAN_DEBUG_RENDER || !serverRuntime) {
    return;
  }

  try {
    const origin = getAppOrigin();
    const headers = {
      "x-desktop-token": requestAuthToken
    };
    const liveResponse = await fetch(`${origin}/wan/live?force=1`, {
      headers
    });
    const liveState = liveResponse.ok ? ((await liveResponse.json()) as { playbackSources?: Array<{ url?: string }> }) : null;
    const firstSourceUrl = liveState?.playbackSources?.[0]?.url;
    const outputDir = path.join(process.cwd(), "tmp");

    await fs.mkdir(outputDir, { recursive: true });
    await fs.writeFile(
      path.join(outputDir, `electron-playback-${label}.json`),
      JSON.stringify(
        {
          liveStatus: liveResponse.status,
          firstSourceUrl
        },
        null,
        2
      )
    );

    if (!firstSourceUrl) {
      return;
    }

    const manifestResponse = await fetch(`${origin}${firstSourceUrl}`, {
      headers
    });
    const manifestText = await manifestResponse.text();
    const manifestLines = manifestText.split(/\r?\n/).slice(0, 40);
    const manifestInfo: Record<string, unknown> = {
      manifestStatus: manifestResponse.status,
      manifestContentType: manifestResponse.headers.get("content-type"),
      manifestLines
    };

    const childManifestPath = manifestLines.find((line) => line.startsWith("/wan/playback/") && line.endsWith("/manifest.m3u8"));

    if (childManifestPath) {
      const childManifestResponse = await fetch(`${origin}${childManifestPath}`, {
        headers
      });
      const childManifestText = await childManifestResponse.text();

      manifestInfo.childManifestStatus = childManifestResponse.status;
      manifestInfo.childManifestContentType = childManifestResponse.headers.get("content-type");
      manifestInfo.childManifestLines = childManifestText.split(/\r?\n/).slice(0, 40);
    }

    await fs.writeFile(
      path.join(outputDir, `electron-playback-${label}-manifest.json`),
      JSON.stringify(manifestInfo, null, 2)
    );
    console.log("Saved playback debug snapshot", label, manifestInfo);
  } catch (error) {
    console.error("Failed to capture playback debug snapshot", error);
  }
}

function shouldStartHidden(): boolean {
  return process.argv.includes("--background");
}

function getStartupSimulationPreset(): DesktopSimulationPreset | null {
  return desktopSimulationPresetFromArgv(process.argv);
}

function isAutoWatchRuntimeEnabled(): boolean {
  return desktopState.settings.enabled || desktopState.simulation.active;
}

function getEffectiveWatchSettings(): BackgroundWatchSettings {
  return {
    ...desktopState.settings,
    enabled: isAutoWatchRuntimeEnabled()
  };
}

function shouldHideOnClose(): boolean {
  return isAutoWatchRuntimeEnabled();
}

async function syncAutostart() {
  const launchCommand = resolveDesktopLaunchCommand({
    appImage: process.env.APPIMAGE,
    argv: process.argv,
    cwd: process.cwd(),
    execPath: process.execPath,
    isPackaged: app.isPackaged
  });

  await syncLinuxAutostart(desktopState.settings.autostartOnLogin, {
    appName: "Unofficial WAN Client",
    command: launchCommand.args,
    workingDir: launchCommand.workingDir
  });
}

async function ensureWindow(showWindow = true): Promise<BrowserWindowInstance> {
  if (mainWindow && !mainWindow.isDestroyed()) {
    if (showWindow) {
      bringWindowToFront(mainWindow);
    }

    return mainWindow;
  }

  const appOrigin = getAppOrigin();
  const preferredWindowBounds = getWindowBoundsForMode(desktopState.preferences.window.compactMode);
  const initialBounds = getCenteredBoundsForPrimaryDisplay(
    desktopState.preferences.window.compactMode
  );
  mainWindow = new BrowserWindow({
    x: initialBounds.x,
    y: initialBounds.y,
    width: initialBounds.width,
    height: initialBounds.height,
    minWidth: preferredWindowBounds.minWidth,
    minHeight: preferredWindowBounds.minHeight,
    show: false,
    backgroundColor: "#070c13",
    autoHideMenuBar: true,
        webPreferences: {
      preload: path.join(__dirname, "preload.cjs"),
          contextIsolation: true,
          nodeIntegration: false,
          sandbox: true,
          webviewTag: false
        }
  });

  mainWindow.webContents.on("console-message", (_event: any, _level: any, message: any) => {
    if (process.env.FLOATPLANE_VERBOSE_LOGGING === "1" && message.includes("[Player]")) {
      console.log(`[Frontend] ${message}`);
    }
  });

  mainWindow.webContents.on("did-finish-load", () => {
    if (process.env.FLOATPLANE_VERBOSE_LOGGING === "1") {
      mainWindow?.webContents.executeJavaScript(
        'window.localStorage.setItem("wan-verbose-logging", "1"); console.log("[Player] Frontend verbose logging auto-enabled!");'
      ).catch(() => {});
    }
  });

  // Keep all top-level navigation inside the local app origin and force
  // external destinations into the system browser.
  mainWindow.webContents.setWindowOpenHandler(({ url }: any) => {
    const disposition = classifyNavigationTarget(url, appOrigin);

    if (disposition === "external") {
      openExternalUrl(url);
    }

    return { action: "deny" };
  });

  mainWindow.webContents.on("will-navigate", (event: any, url: any) => {
    const disposition = classifyNavigationTarget(url, appOrigin);

    if (disposition === "app") {
      return;
    }

    event.preventDefault();

    if (disposition === "external") {
      openExternalUrl(url);
    }
  });

  mainWindow.on("close", (event: any) => {
    if (isQuitting || !shouldHideOnClose()) {
      return;
    }

    event.preventDefault();
    mainWindow?.hide();
  });

  mainWindow.on("closed", () => {
    resetRendererHeartbeatState();
    mainWindow = null;
  });

  mainWindow.on("unresponsive", () => {
    void dumpHangDiagnostics("window-unresponsive");
  });

  mainWindow.on("responsive", () => {
    console.warn("[HangDiag] Renderer responsive again");
  });

  mainWindow.webContents.on("render-process-gone", (_event: any, details: any) => {
    void dumpHangDiagnostics("render-process-gone", {
      details
    });
  });

  mainWindow.webContents.on("did-fail-load", (_event: any, errorCode: any, errorDescription: any, validatedURL: any) => {
    void dumpHangDiagnostics("did-fail-load", {
      errorCode,
      errorDescription,
      validatedURL
    });
  });

  mainWindow.webContents.on("did-finish-load", () => {
    resetRendererHeartbeatState();
    emitDesktopState();
    void dumpRendererDebugSnapshot("did-finish-load");
    void dumpPlaybackDebugSnapshot("did-finish-load");
    void setTimeout(() => {
      void dumpRendererDebugSnapshot("after-5s");
      void dumpPlaybackDebugSnapshot("after-5s");
    }, 5000);
  });

  mainWindow.webContents.on("context-menu", (_event: any, params: any) => {
    const template: MenuItemConstructorOptions[] = [];

    if (params.misspelledWord) {
      if (params.dictionarySuggestions.length > 0) {
        params.dictionarySuggestions.forEach((suggestion: any) => {
          template.push({
            label: suggestion,
            click: () => {
              mainWindow?.webContents.replaceMisspelling(suggestion);
            }
          });
        });
      } else {
        template.push({ label: "No spelling suggestions", enabled: false });
      }

      template.push({ type: "separator" });
      template.push({
        label: "Add to Dictionary",
        click: () => {
          mainWindow?.webContents.session.addWordToSpellCheckerDictionary(params.misspelledWord);
        }
      });
      template.push({ type: "separator" });
    }

    if (params.editFlags.canCut) template.push({ role: "cut" });
    if (params.editFlags.canCopy) template.push({ role: "copy" });
    if (params.editFlags.canPaste) template.push({ role: "paste" });
    if (params.editFlags.canSelectAll) template.push({ role: "selectAll" });

    if (template.length > 0) {
      Menu.buildFromTemplate(template).popup();
    }
  });

  applyWindowPreferences(desktopState.preferences.window.compactMode);

  await mainWindow.loadURL(appOrigin);

  if (showWindow) {
    bringWindowToFront(mainWindow);
  }

  return mainWindow;
}

function updateTray() {
  const simulationMenuItems = simulationAvailable
    ? [
        {
          label: "Run Auto-Watch Check",
          click: () => {
            void watchController?.checkNow(true);
          }
        },
        {
          label: "Simulation",
          submenu: [
            {
              label: "Trigger Live Launch",
              click: () => {
                void applySimulationPreset("live_launch");
              }
            },
            {
              label: "Trigger Reconnect Prompt",
              click: () => {
                void applySimulationPreset("reauth_prompt");
              }
            },
            {
              label: "Reset Simulation",
              click: () => {
                void resetSimulationState();
              }
            }
          ]
        },
        { type: "separator" as const }
      ]
    : [];

  if (!tray) {
    tray = new Tray(createTrayImage());
    tray.setToolTip("Unofficial WAN Client");
    tray.on("click", () => {
      void ensureWindow(true);
    });
  }

  tray.setContextMenu(
    Menu.buildFromTemplate([
      {
        label: "Open Unofficial WAN Client",
        click: () => {
          void ensureWindow(true);
        }
      },
      {
        label: desktopState.settings.enabled ? "Disable Auto-Watch" : "Enable Auto-Watch",
        click: async () => {
          desktopState = {
            ...desktopState,
            settings: {
              ...desktopState.settings,
              enabled: !desktopState.settings.enabled
            }
          };
          await settingsStore?.write(desktopState.settings);
          await syncAutostart();
          emitDesktopState();
          updateTray();
          void watchController?.checkNow(true);
        }
      },
      {
        label: desktopState.preferences.window.compactMode ? "Exit Mini-Player" : "Open Mini-Player",
        click: async () => {
          const previousCompactMode = desktopState.preferences.window.compactMode;
          desktopState = {
            ...desktopState,
            preferences: {
              ...desktopState.preferences,
              window: {
                ...desktopState.preferences.window,
                compactMode: !desktopState.preferences.window.compactMode
              }
            }
          };
          await preferencesStore?.write(desktopState.preferences);
          await ensureWindow(true);
          applyWindowPreferences(previousCompactMode);
          emitDesktopState();
          updateTray();
        }
      },
      {
        label: desktopState.preferences.window.alwaysOnTop ? "Disable Always On Top" : "Enable Always On Top",
        click: async () => {
          desktopState = {
            ...desktopState,
            preferences: {
              ...desktopState.preferences,
              window: {
                ...desktopState.preferences.window,
                alwaysOnTop: !desktopState.preferences.window.alwaysOnTop
              }
            }
          };
          await preferencesStore?.write(desktopState.preferences);
          applyWindowPreferences(desktopState.preferences.window.compactMode);
          emitDesktopState();
          updateTray();
        }
      },
      ...simulationMenuItems,
      {
        label: "Quit",
        click: () => {
          isQuitting = true;
          app.quit();
        }
      }
    ])
  );
}

async function handleBackgroundLaunch(reason: LaunchReason) {
  appendAutoWatchDiagnostic({
    event: "desktop-launch-handler-start",
    at: new Date().toISOString(),
    details: {
      reason,
      simulationSessionMode: desktopState.simulation.sessionMode
    }
  });

  if (reason === "reauth_required" && desktopState.simulation.sessionMode !== "expired") {
    await serverRuntime?.authService.start();
    appendAutoWatchDiagnostic({
      event: "desktop-reauth-browser-started",
      at: new Date().toISOString(),
      details: { reason }
    });
  }

  await ensureWindow(true);
  appendAutoWatchDiagnostic({
    event: "desktop-window-ensured",
    at: new Date().toISOString(),
    details: {
      reason,
      windowVisible: mainWindow?.isVisible() ?? false,
      windowFocused: mainWindow?.isFocused() ?? false,
      windowBounds: mainWindow?.getBounds() ?? null,
      launchSequence: desktopState.status.launchSequence
    }
  });
  if (mainWindow) {
    scheduleWindowAttention(mainWindow, reason);
  }

  if (reason === "background_live") {
    const powerBlockerId = powerSaveBlocker.start("prevent-display-sleep");
    appendAutoWatchDiagnostic({
      event: "desktop-live-sleep-blocker-started",
      at: new Date().toISOString(),
      details: {
        powerBlockerId
      }
    });
    
    setTimeout(() => {
      if (powerSaveBlocker.isStarted(powerBlockerId)) {
        powerSaveBlocker.stop(powerBlockerId);
        appendAutoWatchDiagnostic({
          event: "desktop-live-sleep-blocker-stopped",
          at: new Date().toISOString(),
          details: {
            powerBlockerId
          }
        });
      }
    }, 5000);
  }
}

function refreshSimulationState(now = new Date()) {
  desktopState = {
    ...desktopState,
    simulation: resolveDesktopSimulationState({
      available: simulationAvailable,
      settings: simulationSettings,
      weeklyWindow: desktopState.settings.weeklyWindow,
      now,
      toLocalPlaybackUrl: buildSimulationPlaybackUrl
    })
  };
}

async function applySimulationPreset(preset: DesktopSimulationPreset): Promise<void> {
  if (!simulationAvailable) {
    return;
  }

  simulationSettings = simulationSettingsForPreset(preset);
  refreshSimulationState();
  emitDesktopState();
  await watchController?.checkNow(true);
}

async function resetSimulationState(): Promise<void> {
  simulationSettings = DEFAULT_DESKTOP_SIMULATION_SETTINGS;
  refreshSimulationState();
  emitDesktopState();
}

function sanitizeSettings(input: Partial<BackgroundWatchSettings>): BackgroundWatchSettings {
  const next = {
    ...desktopState.settings,
    ...input,
    weeklyWindow: {
      ...desktopState.settings.weeklyWindow,
      ...(input.weeklyWindow ?? {})
    }
  };
  const dayOfWeek = next.weeklyWindow.dayOfWeek;

  return {
    enabled: Boolean(next.enabled),
    autostartOnLogin: Boolean(next.autostartOnLogin),
    weeklyWindow: {
      dayOfWeek:
        typeof dayOfWeek === "number" && dayOfWeek >= 0 && dayOfWeek <= 6
          ? (dayOfWeek as BackgroundWatchSettings["weeklyWindow"]["dayOfWeek"])
          : DEFAULT_SETTINGS.weeklyWindow.dayOfWeek,
      startLocalTime: /^\d{2}:\d{2}$/.test(next.weeklyWindow.startLocalTime)
        ? next.weeklyWindow.startLocalTime
        : DEFAULT_SETTINGS.weeklyWindow.startLocalTime,
      endLocalTime: /^\d{2}:\d{2}$/.test(next.weeklyWindow.endLocalTime)
        ? next.weeklyWindow.endLocalTime
        : DEFAULT_SETTINGS.weeklyWindow.endLocalTime
    }
  };
}

async function bootstrap() {
  requestAuthToken = randomBytes(32).toString("hex");
  process.env.FLOATPLANE_DATA_DIR = path.join(app.getPath("userData"), "floatplane");
  process.env.FLOATPLANE_DISABLE_FIXTURE_BOOTSTRAP = "1";
  autoWatchDiagnosticsFilePath = path.join(app.getPath("userData"), "auto-watch-diagnostics.jsonl");
  appendAutoWatchDiagnostic({
    event: "desktop-bootstrap",
    at: new Date().toISOString(),
    details: {
      argv: process.argv,
      background: shouldStartHidden(),
      userData: app.getPath("userData")
    }
  });
  const webDistDir = resolveDesktopWebDistDir(__dirname);
  process.env.FLOATPLANE_WEB_DIST_DIR = webDistDir;
  settingsStore = new JsonFileStore<BackgroundWatchSettings>(
    path.join(app.getPath("userData"), "background-watch-settings.json"),
    DEFAULT_SETTINGS
  );
  preferencesStore = new JsonFileStore<DesktopPreferences>(
    path.join(app.getPath("userData"), "desktop-preferences.json"),
    DEFAULT_DESKTOP_PREFERENCES
  );

  const [settings, preferences] = await Promise.all([settingsStore.read(), preferencesStore.read()]);
  desktopState = {
    ...desktopState,
    settings,
    preferences
  };
  refreshSimulationState();

  const [{ startServer }, { playbackTargetRegistry }] = await Promise.all([
    import("../../server/src/server.js"),
    import("../../server/src/services/playback-registry.js")
  ]);
  serverRuntime = await startServer({
    host: "127.0.0.1",
    port: 0,
    webDistDir,
    allowFixtureBootstrap: false,
    requestAuthToken,
    onSessionAuthenticated: (session) => {
      appendAutoWatchDiagnostic({
        event: "desktop-session-authenticated",
        at: new Date().toISOString(),
        details: {
          mode: session.mode,
          upstreamMode: session.upstreamMode,
          hasPersistedSession: session.hasPersistedSession,
          cookieCount: session.cookieCount,
          hasChatUsername: Boolean(session.chatUsername),
          expiresAt: session.expiresAt
        }
      });
      void watchController?.checkNow(true);
    }
  });
  buildSimulationPlaybackUrl = (url, contentType) =>
    playbackTargetRegistry.buildLocalUrl(url, contentType);
  refreshSimulationState();

  watchController = new BackgroundWatchController(
    {
      getSessionState: async () =>
        desktopState.simulation.session ?? serverRuntime!.adapter.getSessionState(),
      getWanLiveState: async (forceRefresh?: boolean) =>
        desktopState.simulation.liveState ?? serverRuntime!.adapter.getWanLiveState(forceRefresh)
    } as never,
    {
      getSettings: () => getEffectiveWatchSettings(),
      onStatus: (status) => {
        appendAutoWatchDiagnostic({
          event: "status-update",
          at: new Date().toISOString(),
          details: {
            status
          }
        });
        desktopState = {
          ...desktopState,
          status
        };

        const shouldBlock = status.enabled && status.activeWindow;
        const isBlocking = watchWindowPowerBlockerId !== undefined && powerSaveBlocker.isStarted(watchWindowPowerBlockerId);

        if (shouldBlock && !isBlocking) {
          watchWindowPowerBlockerId = powerSaveBlocker.start("prevent-app-suspension");
          console.log("[AutoWatch] Active window started — system suspend inhibitor engaged.");
        } else if (!shouldBlock && isBlocking) {
          powerSaveBlocker.stop(watchWindowPowerBlockerId!);
          watchWindowPowerBlockerId = undefined;
          console.log("[AutoWatch] Active window ended — system suspend inhibitor released.");
        }

        emitDesktopState();
        updateTray();
      },
      onLaunch: handleBackgroundLaunch,
      onDiagnostic: appendAutoWatchDiagnostic,
      now: () =>
        resolveSimulationNow(
          new Date(),
          desktopState.settings.weeklyWindow,
          desktopState.simulation.forceActiveWindow
        )
    }
  );

  await syncAutostart();
  updateTray();
  watchController.start();
  startRendererHeartbeatMonitor();

  const startupSimulationPreset = getStartupSimulationPreset();

  if (startupSimulationPreset) {
    await applySimulationPreset(startupSimulationPreset);
  }

  if (!shouldStartHidden()) {
    await ensureWindow(true);
  }

  powerMonitor.on("resume", () => {
    console.log(`[AutoWatch] System resumed from sleep at ${new Date().toISOString()} — running immediate watch check.`);
    appendAutoWatchDiagnostic({
      event: "system-resume",
      at: new Date().toISOString()
    });
    void watchController?.checkNow(true);
  });
}

if (!app.requestSingleInstanceLock()) {
  app.quit();
} else {
  app.on("second-instance", () => {
    void ensureWindow(true);
  });
}

app.on("before-quit", () => {
  isQuitting = true;
});

app.whenReady().then(bootstrap).catch((error) => {
  console.error(error);
  app.quit();
});

app.on("activate", () => {
  void ensureWindow(true);
});

app.on("window-all-closed", () => {
  if (process.platform !== "darwin" && !shouldHideOnClose()) {
    app.quit();
  }
});

ipcMain.handle("desktop:get-state", async () => desktopState);
ipcMain.handle("desktop:get-api-headers", async () => ({
  "x-desktop-token": requestAuthToken
}));
ipcMain.handle(
  "desktop:update-settings",
  async (_event, updates: Partial<BackgroundWatchSettings>) => {
    desktopState = {
      ...desktopState,
      settings: sanitizeSettings(updates)
    };
    refreshSimulationState();
    await settingsStore?.write(desktopState.settings);
    await syncAutostart();
    emitDesktopState();
    updateTray();
    await watchController?.checkNow(true);
    return desktopState;
  }
);
ipcMain.handle(
  "desktop:update-preferences",
  async (_event, updates: Partial<DesktopPreferences>) => {
    const previousCompactMode = desktopState.preferences.window.compactMode;

    desktopState = {
      ...desktopState,
      preferences: sanitizeDesktopPreferences(updates, desktopState.preferences)
    };
    await preferencesStore?.write(desktopState.preferences);
    applyWindowPreferences(previousCompactMode);
    emitDesktopState();
    updateTray();
    return desktopState;
  }
);
ipcMain.handle(
  "desktop:update-simulation",
  async (_event, updates: Partial<DesktopSimulationSettings>) => {
    simulationSettings = sanitizeDesktopSimulationSettings(updates, simulationSettings);
    refreshSimulationState();
    emitDesktopState();
    return desktopState;
  }
);
ipcMain.handle("desktop:reset-simulation", async () => {
  await resetSimulationState();
  return desktopState;
});
ipcMain.handle("desktop:check-now", async () => {
  await watchController?.checkNow(true);
  emitDesktopState();
  return desktopState;
});
ipcMain.handle("desktop:quit", async () => {
  isQuitting = true;
  app.quit();
});

ipcMain.on("desktop:renderer-heartbeat", (_event, details: Record<string, unknown>) => {
  lastRendererHeartbeatAt = Date.now();
  lastRendererHeartbeat = details;
});

ipcMain.on("desktop:renderer-issue", (_event, details: Record<string, unknown>) => {
  lastRendererIssue = details;
  void dumpHangDiagnostics("renderer-issue", {
    details
  });
});

app.on("will-quit", () => {
  if (rendererHeartbeatMonitor) {
    clearInterval(rendererHeartbeatMonitor);
    rendererHeartbeatMonitor = undefined;
  }
  watchController?.stop();
  void serverRuntime?.authService.dispose();
  void serverRuntime?.close();
});
