import type { DesktopPreferences } from "./contracts.js";

export const DEFAULT_DESKTOP_PREFERENCES: DesktopPreferences = {
  notifications: {
    live: true,
    reconnectRequired: true,
    staffReply: false,
    metadataUpdated: false
  },
  window: {
    alwaysOnTop: false,
    compactMode: false
  }
};

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function sanitizeBoolean(value: unknown, fallback: boolean): boolean {
  return typeof value === "boolean" ? value : fallback;
}

export function sanitizeDesktopPreferences(
  input: unknown,
  current: DesktopPreferences
): DesktopPreferences {
  const root = isRecord(input) ? input : undefined;
  const notifications = root && isRecord(root.notifications) ? root.notifications : undefined;
  const windowSettings = root && isRecord(root.window) ? root.window : undefined;

  return {
    notifications: {
      live: sanitizeBoolean(notifications?.live, current.notifications.live),
      reconnectRequired: sanitizeBoolean(
        notifications?.reconnectRequired,
        current.notifications.reconnectRequired
      ),
      staffReply: sanitizeBoolean(notifications?.staffReply, current.notifications.staffReply),
      metadataUpdated: sanitizeBoolean(
        notifications?.metadataUpdated,
        current.notifications.metadataUpdated
      )
    },
    window: {
      alwaysOnTop: sanitizeBoolean(windowSettings?.alwaysOnTop, current.window.alwaysOnTop),
      compactMode: sanitizeBoolean(windowSettings?.compactMode, current.window.compactMode)
    }
  };
}
