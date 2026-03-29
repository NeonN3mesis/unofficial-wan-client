import type {
  BackgroundWatchSettings,
  DesktopPreferences,
  DesktopSimulationSettings,
  DesktopState
} from "@shared";

declare global {
  interface Window {
    desktopBridge?: {
      isDesktop: boolean;
      getState: () => Promise<DesktopState>;
      getApiHeaders: () => Promise<Record<string, string>>;
      updateSettings: (settings: Partial<BackgroundWatchSettings>) => Promise<DesktopState>;
      updatePreferences: (preferences: Partial<DesktopPreferences>) => Promise<DesktopState>;
      updateSimulation: (settings: Partial<DesktopSimulationSettings>) => Promise<DesktopState>;
      resetSimulation: () => Promise<DesktopState>;
      checkNow: () => Promise<DesktopState>;
      quit: () => Promise<void>;
      onStateChange: (listener: (state: DesktopState) => void) => () => void;
    };
  }
}

export {};
