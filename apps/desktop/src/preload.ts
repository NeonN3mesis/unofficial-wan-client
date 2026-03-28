import { contextBridge, ipcRenderer } from "electron";
import type {
  BackgroundWatchSettings,
  DesktopSimulationSettings,
  DesktopState
} from "../../../packages/shared/src/index.js";

contextBridge.exposeInMainWorld("desktopBridge", {
  isDesktop: true,
  getState: () => ipcRenderer.invoke("desktop:get-state") as Promise<DesktopState>,
  updateSettings: (settings: Partial<BackgroundWatchSettings>) =>
    ipcRenderer.invoke("desktop:update-settings", settings) as Promise<DesktopState>,
  updateSimulation: (settings: Partial<DesktopSimulationSettings>) =>
    ipcRenderer.invoke("desktop:update-simulation", settings) as Promise<DesktopState>,
  resetSimulation: () => ipcRenderer.invoke("desktop:reset-simulation") as Promise<DesktopState>,
  checkNow: () => ipcRenderer.invoke("desktop:check-now") as Promise<DesktopState>,
  quit: () => ipcRenderer.invoke("desktop:quit") as Promise<void>,
  onStateChange: (listener: (state: DesktopState) => void) => {
    const handler = (_event: Electron.IpcRendererEvent, state: DesktopState) => listener(state);
    ipcRenderer.on("desktop:state-changed", handler);
    return () => {
      ipcRenderer.removeListener("desktop:state-changed", handler);
    };
  }
});
