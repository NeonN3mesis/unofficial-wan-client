import { describe, expect, it } from "vitest";
import {
  DEFAULT_DESKTOP_PREFERENCES,
  sanitizeDesktopPreferences
} from "../../../packages/shared/src/desktop-preferences.js";

describe("desktop preferences", () => {
  it("uses privacy-preserving defaults for content-bearing notifications", () => {
    expect(DEFAULT_DESKTOP_PREFERENCES.notifications.live).toBe(true);
    expect(DEFAULT_DESKTOP_PREFERENCES.notifications.reconnectRequired).toBe(true);
    expect(DEFAULT_DESKTOP_PREFERENCES.notifications.staffReply).toBe(false);
    expect(DEFAULT_DESKTOP_PREFERENCES.notifications.metadataUpdated).toBe(false);
  });

  it("accepts only boolean preference values", () => {
    const current = {
      notifications: {
        live: false,
        reconnectRequired: true,
        staffReply: false,
        metadataUpdated: true
      },
      window: {
        alwaysOnTop: false,
        compactMode: true
      }
    };

    expect(
      sanitizeDesktopPreferences(
        {
          notifications: {
            live: "yes",
            reconnectRequired: false,
            staffReply: true,
            metadataUpdated: 1
          },
          window: {
            alwaysOnTop: "always",
            compactMode: false
          }
        },
        current
      )
    ).toEqual({
      notifications: {
        live: false,
        reconnectRequired: false,
        staffReply: true,
        metadataUpdated: true
      },
      window: {
        alwaysOnTop: false,
        compactMode: false
      }
    });
  });

  it("ignores malformed root and nested payloads", () => {
    expect(sanitizeDesktopPreferences(null, DEFAULT_DESKTOP_PREFERENCES)).toEqual(
      DEFAULT_DESKTOP_PREFERENCES
    );
    expect(
      sanitizeDesktopPreferences(
        {
          notifications: [],
          window: "compact"
        },
        DEFAULT_DESKTOP_PREFERENCES
      )
    ).toEqual(DEFAULT_DESKTOP_PREFERENCES);
  });
});
