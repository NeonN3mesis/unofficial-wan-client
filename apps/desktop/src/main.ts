import { randomBytes } from "node:crypto";
import path from "node:path";
import { fileURLToPath } from "node:url";
import {
  app,
  BrowserWindow,
  Menu,
  Tray,
  ipcMain,
  nativeImage,
  powerMonitor,
  shell
} from "electron";
import type {
  BackgroundWatchSettings,
  DesktopSimulationSettings,
  DesktopState,
  LaunchReason
} from "../../../packages/shared/src/index.js";
import { BackgroundWatchController } from "./background-watch-controller.js";
import { syncLinuxAutostart } from "./linux-autostart.js";
import { classifyNavigationTarget } from "./navigation-policy.js";
import { resolveDesktopWebDistDir } from "./runtime-paths.js";
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

let desktopState: DesktopState = {
  settings: DEFAULT_SETTINGS,
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
let mainWindow: BrowserWindow | null = null;
let tray: Tray | null = null;
let isQuitting = false;
const simulationAvailable =
  !app.isPackaged || process.env.FLOATPLANE_ENABLE_DESKTOP_SIMULATION === "1";
let serverRuntime:
  | {
      host: string;
      port: number;
      adapter: {
        getSessionState: () => Promise<unknown>;
        getWanLiveState: () => Promise<unknown>;
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
let simulationSettings: DesktopSimulationSettings = DEFAULT_DESKTOP_SIMULATION_SETTINGS;
let buildSimulationPlaybackUrl:
  | ((url: string, contentType?: string) => string)
  | undefined;
let requestAuthToken = "";

function getAppOrigin(): string {
  if (!serverRuntime) {
    throw new Error("Desktop server runtime is not available yet.");
  }

  return `http://${serverRuntime.host}:${serverRuntime.port}`;
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

function getExecutablePath(): string {
  return process.env.APPIMAGE ?? process.execPath;
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
  await syncLinuxAutostart(desktopState.settings.autostartOnLogin, {
    appName: "Unofficial WAN Client",
    execPath: getExecutablePath()
  });
}

async function ensureWindow(showWindow = true): Promise<BrowserWindow> {
  if (mainWindow && !mainWindow.isDestroyed()) {
    if (showWindow) {
      if (mainWindow.isMinimized()) {
        mainWindow.restore();
      }

      mainWindow.show();
      mainWindow.focus();
    }

    return mainWindow;
  }

  const appOrigin = getAppOrigin();
  mainWindow = new BrowserWindow({
    width: 1520,
    height: 980,
    minWidth: 1180,
    minHeight: 760,
    show: false,
    backgroundColor: "#070c13",
    autoHideMenuBar: true,
    webPreferences: {
      preload: path.join(__dirname, "preload.js"),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
      webviewTag: false
    }
  });

  // Keep all top-level navigation inside the local app origin and force
  // external destinations into the system browser.
  mainWindow.webContents.setWindowOpenHandler(({ url }) => {
    const disposition = classifyNavigationTarget(url, appOrigin);

    if (disposition === "external") {
      openExternalUrl(url);
    }

    return { action: "deny" };
  });

  mainWindow.webContents.on("will-navigate", (event, url) => {
    const disposition = classifyNavigationTarget(url, appOrigin);

    if (disposition === "app") {
      return;
    }

    event.preventDefault();

    if (disposition === "external") {
      openExternalUrl(url);
    }
  });

  mainWindow.on("close", (event) => {
    if (isQuitting || !shouldHideOnClose()) {
      return;
    }

    event.preventDefault();
    mainWindow?.hide();
  });

  mainWindow.on("closed", () => {
    mainWindow = null;
  });

  mainWindow.webContents.on("did-finish-load", () => {
    emitDesktopState();
  });

  await mainWindow.loadURL(appOrigin);

  if (showWindow) {
    mainWindow.show();
    mainWindow.focus();
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
  if (reason === "reauth_required" && desktopState.simulation.sessionMode !== "expired") {
    await serverRuntime?.authService.start();
  }

  await ensureWindow(true);
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
  const webDistDir = resolveDesktopWebDistDir(__dirname);
  process.env.FLOATPLANE_WEB_DIST_DIR = webDistDir;
  settingsStore = new JsonFileStore<BackgroundWatchSettings>(
    path.join(app.getPath("userData"), "background-watch-settings.json"),
    DEFAULT_SETTINGS
  );

  const settings = await settingsStore.read();
  desktopState = {
    ...desktopState,
    settings
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
    requestAuthToken
  });
  buildSimulationPlaybackUrl = (url, contentType) =>
    playbackTargetRegistry.buildLocalUrl(url, contentType);
  refreshSimulationState();

  watchController = new BackgroundWatchController(
    {
      getSessionState: async () =>
        desktopState.simulation.session ?? serverRuntime!.adapter.getSessionState(),
      getWanLiveState: async () =>
        desktopState.simulation.liveState ?? serverRuntime!.adapter.getWanLiveState()
    } as never,
    {
      getSettings: () => getEffectiveWatchSettings(),
      onStatus: (status) => {
        desktopState = {
          ...desktopState,
          status
        };
        emitDesktopState();
        updateTray();
      },
      onLaunch: handleBackgroundLaunch,
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

  const startupSimulationPreset = getStartupSimulationPreset();

  if (startupSimulationPreset) {
    await applySimulationPreset(startupSimulationPreset);
  }

  if (!shouldStartHidden()) {
    await ensureWindow(true);
  }

  powerMonitor.on("resume", () => {
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

app.on("will-quit", () => {
  watchController?.stop();
  void serverRuntime?.authService.dispose();
  void serverRuntime?.close();
});
