import { describe, expect, it } from "vitest";
import type {
  DesktopSimulationSettings,
  BackgroundWatchSettings
} from "../../../packages/shared/src/index.js";
import {
  DEFAULT_DESKTOP_SIMULATION_SETTINGS,
  desktopSimulationPresetFromArgv,
  resolveDesktopSimulationState,
  resolveSimulationNow,
  sanitizeDesktopSimulationSettings,
  simulationSettingsForPreset
} from "../src/simulation.js";

const DEFAULT_WINDOW: BackgroundWatchSettings["weeklyWindow"] = {
  dayOfWeek: 5,
  startLocalTime: "19:00",
  endLocalTime: "00:00"
};

describe("desktop simulation", () => {
  it("sanitizes invalid simulation overrides back to safe defaults", () => {
    const result = sanitizeDesktopSimulationSettings({
      forceActiveWindow: true,
      sessionMode: "bad-mode" as DesktopSimulationSettings["sessionMode"],
      liveMode: "bad-mode" as DesktopSimulationSettings["liveMode"]
    });

    expect(result).toEqual({
      forceActiveWindow: true,
      sessionMode: DEFAULT_DESKTOP_SIMULATION_SETTINGS.sessionMode,
      liveMode: DEFAULT_DESKTOP_SIMULATION_SETTINGS.liveMode
    });
  });

  it("pins the controller clock inside the configured window when forced", () => {
    const forcedNow = resolveSimulationNow(
      new Date(2026, 2, 28, 10, 0, 0),
      DEFAULT_WINDOW,
      true
    );

    expect(forcedNow.getDay()).toBe(5);
    expect(forcedNow.getHours()).toBe(20);
    expect(forcedNow.getMinutes()).toBe(0);
  });

  it("builds a simulated live payload with a local playback URL", () => {
    const state = resolveDesktopSimulationState({
      available: true,
      settings: {
        forceActiveWindow: true,
        sessionMode: "authenticated",
        liveMode: "live"
      },
      weeklyWindow: DEFAULT_WINDOW,
      now: new Date(2026, 2, 27, 20, 0, 0),
      toLocalPlaybackUrl: () => "/wan/playback/simulated/proxy"
    });

    expect(state.available).toBe(true);
    expect(state.active).toBe(true);
    expect(state.session?.status).toBe("authenticated");
    expect(state.liveState?.status).toBe("live");
    expect(state.liveState?.playbackSources[0]?.url).toBe("/wan/playback/simulated/proxy");
  });

  it("parses startup presets from argv", () => {
    expect(desktopSimulationPresetFromArgv(["electron", "--simulate-live-launch"])).toBe(
      "live_launch"
    );
    expect(desktopSimulationPresetFromArgv(["electron", "--simulate-reauth"])).toBe(
      "reauth_prompt"
    );
    expect(desktopSimulationPresetFromArgv(["electron"])).toBeNull();
  });

  it("maps presets to simulation settings", () => {
    expect(simulationSettingsForPreset("live_launch")).toEqual({
      forceActiveWindow: true,
      sessionMode: "authenticated",
      liveMode: "live"
    });

    expect(simulationSettingsForPreset("reauth_prompt")).toEqual({
      forceActiveWindow: true,
      sessionMode: "expired",
      liveMode: "offline"
    });
  });
});
