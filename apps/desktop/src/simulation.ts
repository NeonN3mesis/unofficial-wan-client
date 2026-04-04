import type {
  BackgroundWatchSettings,
  DesktopSimulationSettings,
  DesktopSimulationState,
  SessionState,
  WanLiveState
} from "../../../packages/shared/src/index.js";
import { evaluateWeeklyWindow } from "./watch-schedule.js";

const SIMULATION_PLAYBACK_URL = "https://test-streams.mux.dev/x36xhzz/x36xhzz.m3u8";
export type DesktopSimulationPreset = "live_launch" | "reauth_prompt";

export const DEFAULT_DESKTOP_SIMULATION_SETTINGS: DesktopSimulationSettings = {
  forceActiveWindow: false,
  sessionMode: "passthrough",
  liveMode: "passthrough"
};

function parseTimeToMinutes(localTime: string): number {
  const match = /^(\d{2}):(\d{2})$/.exec(localTime.trim());

  if (!match) {
    return 0;
  }

  const hours = Number(match[1]);
  const minutes = Number(match[2]);

  if (
    !Number.isInteger(hours) ||
    !Number.isInteger(minutes) ||
    hours < 0 ||
    hours > 23 ||
    minutes < 0 ||
    minutes > 59
  ) {
    return 0;
  }

  return hours * 60 + minutes;
}

function startOfLocalDay(baseDate: Date): Date {
  return new Date(baseDate.getFullYear(), baseDate.getMonth(), baseDate.getDate(), 0, 0, 0, 0);
}

function addDays(baseDate: Date, days: number): Date {
  return new Date(
    baseDate.getFullYear(),
    baseDate.getMonth(),
    baseDate.getDate() + days,
    baseDate.getHours(),
    baseDate.getMinutes(),
    baseDate.getSeconds(),
    baseDate.getMilliseconds()
  );
}

function atLocalTime(baseDate: Date, localMinutes: number): Date {
  return new Date(
    baseDate.getFullYear(),
    baseDate.getMonth(),
    baseDate.getDate(),
    Math.floor(localMinutes / 60),
    localMinutes % 60,
    0,
    0
  );
}

export function sanitizeDesktopSimulationSettings(
  input: Partial<DesktopSimulationSettings>,
  current: DesktopSimulationSettings = DEFAULT_DESKTOP_SIMULATION_SETTINGS
): DesktopSimulationSettings {
  const next = {
    ...current,
    ...input
  };

  return {
    forceActiveWindow: Boolean(next.forceActiveWindow),
    sessionMode:
      next.sessionMode === "authenticated" || next.sessionMode === "expired"
        ? next.sessionMode
        : "passthrough",
    liveMode:
      next.liveMode === "offline" || next.liveMode === "live"
        ? next.liveMode
        : "passthrough"
  };
}

export function desktopSimulationPresetFromArgv(
  argv: string[]
): DesktopSimulationPreset | null {
  if (argv.includes("--simulate-live-launch")) {
    return "live_launch";
  }

  if (argv.includes("--simulate-reauth")) {
    return "reauth_prompt";
  }

  return null;
}

export function simulationSettingsForPreset(
  preset: DesktopSimulationPreset
): DesktopSimulationSettings {
  if (preset === "reauth_prompt") {
    return {
      forceActiveWindow: true,
      sessionMode: "expired",
      liveMode: "offline"
    };
  }

  return {
    forceActiveWindow: true,
    sessionMode: "authenticated",
    liveMode: "live"
  };
}

export function resolveSimulationNow(
  baseNow: Date,
  weeklyWindow: BackgroundWatchSettings["weeklyWindow"],
  forceActiveWindow: boolean
): Date {
  if (!forceActiveWindow) {
    return baseNow;
  }

  const evaluation = evaluateWeeklyWindow(baseNow, weeklyWindow);

  if (evaluation.active) {
    return baseNow;
  }

  const startMinutes = parseTimeToMinutes(weeklyWindow.startLocalTime);
  const endMinutes = parseTimeToMinutes(weeklyWindow.endLocalTime);
  const wrapsPastMidnight = endMinutes <= startMinutes;
  const recentTargetDay = addDays(
    startOfLocalDay(baseNow),
    -((baseNow.getDay() - weeklyWindow.dayOfWeek + 7) % 7)
  );
  const candidateStart = atLocalTime(recentTargetDay, startMinutes);
  const windowDurationMinutes = wrapsPastMidnight
    ? 24 * 60 - startMinutes + endMinutes
    : Math.max(endMinutes - startMinutes, 1);
  const offsetMinutes = Math.min(Math.max(windowDurationMinutes - 1, 0), 60);

  return new Date(candidateStart.getTime() + offsetMinutes * 60_000);
}

function createSimulatedSessionState(mode: DesktopSimulationSettings["sessionMode"]): SessionState | undefined {
  if (mode === "passthrough") {
    return undefined;
  }

  if (mode === "expired") {
    return {
      status: "expired",
      mode: "storage-state",
      upstreamMode: "pending-capture",
      hasPersistedSession: true,
      cookieCount: 2,
      loginUrl: "https://www.floatplane.com/login",
      message: "Desktop simulation is forcing the saved Floatplane session to appear expired.",
      nextAction: "retry-connect",
      expiresAt: new Date(Date.now() - 60_000).toISOString()
    };
  }

  return {
    status: "authenticated",
    mode: "storage-state",
    upstreamMode: "pending-capture",
    hasPersistedSession: true,
    cookieCount: 2,
    loginUrl: "https://www.floatplane.com/login",
    message: "Desktop simulation is impersonating a valid Floatplane session.",
    nextAction: "clear-session",
    lastValidatedAt: new Date().toISOString(),
    expiresAt: new Date(Date.now() + 1000 * 60 * 60).toISOString()
  };
}

function createSimulatedLiveState(
  mode: DesktopSimulationSettings["liveMode"],
  now: Date,
  toLocalPlaybackUrl?: (url: string, contentType?: string) => string
): WanLiveState | undefined {
  if (mode === "passthrough") {
    return undefined;
  }

  const playbackUrl = toLocalPlaybackUrl?.(SIMULATION_PLAYBACK_URL, "application/x-mpegURL") ??
    SIMULATION_PLAYBACK_URL;

  if (mode === "offline") {
    return {
      creatorId: "wan-show",
      creatorName: "Linus Tech Tips",
      streamTitle: "WAN Show (Simulated Offline)",
      summary: "Desktop simulation is forcing the stream to appear offline.",
      status: "offline",
      scheduleNote: "This state is local simulation only and does not query Floatplane.",
      playbackSources: [
        {
          id: "simulated-offline",
          label: "Waiting for stream",
          kind: "unresolved",
          drm: false,
          latencyTarget: "low",
          preferredPlayer: "hls",
          deliveryPlatform: "generic"
        }
      ],
      chatCapability: {
        canRead: false,
        canSend: false,
        mode: "read-only",
        transport: "unknown",
        reason: "Desktop simulation is forcing the stream offline."
      },
      upstreamMode: "fixture",
      notes: [
        "Desktop simulation is active.",
        "Use Run Auto-Watch Check to exercise the inactive -> active -> live transition without waiting for Friday."
      ]
    };
  }

  return {
    creatorId: "wan-show",
    creatorName: "Linus Tech Tips",
    streamTitle: "WAN Show (Simulated Live)",
    summary: "Desktop simulation is forcing the stream to appear live with a test HLS feed.",
    status: "live",
    startedAt: new Date(now.getTime() - 5 * 60_000).toISOString(),
    refreshedAt: now.toISOString(),
    posterUrl: "https://images.unsplash.com/photo-1493225457124-a3eb161ffa5f?auto=format&fit=crop&w=1200&q=80",
    playbackSources: [
      {
        id: "simulated-hls",
        label: "Simulated test stream",
        kind: "hls",
        url: playbackUrl,
        mimeType: "application/x-mpegURL",
        drm: false,
        latencyTarget: "low",
        preferredPlayer: "hls",
        deliveryPlatform: "generic"
      }
    ],
    chatCapability: {
      canRead: true,
      canSend: false,
      mode: "read-only",
      transport: "sse",
      reason: "Desktop simulation is using a test playback source. Floatplane chat is not part of this simulation."
    },
    upstreamMode: "fixture",
    notes: [
      "Desktop simulation is active.",
      "This is a local test stream for window restore and autoplay validation, not the real WAN Show."
    ]
  };
}

export function resolveDesktopSimulationState(options: {
  available: boolean;
  settings: DesktopSimulationSettings;
  weeklyWindow: BackgroundWatchSettings["weeklyWindow"];
  now?: Date;
  toLocalPlaybackUrl?: (url: string, contentType?: string) => string;
}): DesktopSimulationState {
  const now = options.now ?? new Date();
  const settings = sanitizeDesktopSimulationSettings(options.settings);
  const session = createSimulatedSessionState(settings.sessionMode);
  const liveState = createSimulatedLiveState(settings.liveMode, now, options.toLocalPlaybackUrl);

  return {
    available: options.available,
    active:
      options.available &&
      (settings.forceActiveWindow || settings.sessionMode !== "passthrough" || settings.liveMode !== "passthrough"),
    forceActiveWindow: settings.forceActiveWindow,
    sessionMode: settings.sessionMode,
    liveMode: settings.liveMode,
    session,
    liveState
  };
}
