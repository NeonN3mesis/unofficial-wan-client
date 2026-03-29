import type {
  BackgroundWatchSettings,
  DesktopPreferences,
  DesktopSimulationSettings,
  DesktopState,
  SessionState
} from "@shared";

interface DesktopControlPanelProps {
  session: SessionState | null;
  desktopState: DesktopState | null;
  showAccountPanel: boolean;
  onStartConnect: () => void;
  onCompleteConnect: () => void;
  onCancelConnect: () => void;
  onUpdateSettings: (settings: Partial<BackgroundWatchSettings>) => void;
  onUpdatePreferences: (preferences: Partial<DesktopPreferences>) => void;
  onUpdateSimulation: (settings: Partial<DesktopSimulationSettings>) => void;
  onResetSimulation: () => void;
  onRunCheckNow: () => void;
  onQuit: () => void;
  notificationPermission: NotificationPermission | "unsupported";
}

const DAY_OPTIONS = [
  ["0", "Sunday"],
  ["1", "Monday"],
  ["2", "Tuesday"],
  ["3", "Wednesday"],
  ["4", "Thursday"],
  ["5", "Friday"],
  ["6", "Saturday"]
] as const;

const SESSION_SIMULATION_OPTIONS = [
  ["passthrough", "Use real session"],
  ["authenticated", "Force authenticated"],
  ["expired", "Force reconnect required"]
] as const;

const LIVE_SIMULATION_OPTIONS = [
  ["passthrough", "Use real live state"],
  ["offline", "Force offline"],
  ["live", "Force live test stream"]
] as const;

function humanizeSessionState(session: SessionState | null): string {
  if (!session) {
    return "Connecting";
  }

  switch (session.status) {
    case "authenticated":
      return "Connected";
    case "authenticating":
      return "Waiting For Sign-In";
    case "expired":
      return "Reconnect Required";
    case "error":
      return "Connection Error";
    default:
      return "Disconnected";
  }
}

export function DesktopControlPanel({
  session,
  desktopState,
  showAccountPanel,
  onStartConnect,
  onCompleteConnect,
  onCancelConnect,
  onUpdateSettings,
  onUpdatePreferences,
  onUpdateSimulation,
  onResetSimulation,
  onRunCheckNow,
  onQuit,
  notificationPermission
}: DesktopControlPanelProps) {
  const settings = desktopState?.settings;
  const preferences = desktopState?.preferences;
  const watchStatus = desktopState?.status;
  const simulation = desktopState?.simulation;
  const canConnect =
    session?.status === "unauthenticated" ||
    session?.status === "expired" ||
    session?.status === "error" ||
    !session;
  const canFinish = session?.status === "authenticating";
  const isAuthenticated = session?.status === "authenticated";

  return (
    <section className="desktop-control-panel">
      {!isAuthenticated || showAccountPanel ? (
        <div className="control-card">
          <div className="control-card-header">
            <div>
              <p className="eyebrow">Account</p>
              <h3>{humanizeSessionState(session)}</h3>
            </div>
            <span className={`status-pill is-${session?.status ?? "unknown"}`}>
              {humanizeSessionState(session)}
            </span>
          </div>
          <p className="control-copy">
            {session?.message ?? "Connect your Floatplane account to unlock local playback and chat."}
          </p>
          <div className="control-actions">
            {canConnect ? (
              <button className="ghost-button" onClick={onStartConnect} type="button">
                Connect Floatplane
              </button>
            ) : null}
            {canFinish ? (
              <button className="ghost-button" onClick={onCompleteConnect} type="button">
                Finish Sign-In
              </button>
            ) : null}
            {canFinish ? (
              <button className="ghost-button" onClick={onCancelConnect} type="button">
                Cancel
              </button>
            ) : null}
          </div>
        </div>
      ) : null}

      {desktopState ? (
        <div className="control-card control-card-wide">
          <div className="control-card-header">
            <div>
              <p className="eyebrow">Auto-Watch</p>
              <h3>{watchStatus?.message ?? "Desktop automation is available."}</h3>
            </div>
            <span className={`status-pill is-${watchStatus?.state ?? "idle"}`}>
              {watchStatus?.state.replace(/_/g, " ") ?? "idle"}
            </span>
          </div>

          <div className="settings-grid">
            <label className="settings-toggle">
              <input
                checked={settings?.enabled ?? false}
                onChange={(event) => onUpdateSettings({ enabled: event.target.checked })}
                type="checkbox"
              />
              <span>Enable auto-watch</span>
            </label>
            <label className="settings-toggle">
              <input
                checked={settings?.autostartOnLogin ?? false}
                onChange={(event) => onUpdateSettings({ autostartOnLogin: event.target.checked })}
                type="checkbox"
              />
              <span>Start in background on login</span>
            </label>
            <label className="settings-field">
              <span>Day</span>
              <select
                onChange={(event) =>
                  onUpdateSettings({
                    weeklyWindow: {
                      ...settings?.weeklyWindow,
                      dayOfWeek: Number(event.target.value) as BackgroundWatchSettings["weeklyWindow"]["dayOfWeek"]
                    }
                  })
                }
                value={settings?.weeklyWindow.dayOfWeek ?? 5}
              >
                {DAY_OPTIONS.map(([value, label]) => (
                  <option key={value} value={value}>
                    {label}
                  </option>
                ))}
              </select>
            </label>
            <label className="settings-field">
              <span>Start time</span>
              <input
                onChange={(event) =>
                  onUpdateSettings({
                    weeklyWindow: {
                      ...settings?.weeklyWindow,
                      startLocalTime: event.target.value
                    }
                  })
                }
                type="time"
                value={settings?.weeklyWindow.startLocalTime ?? "19:00"}
              />
            </label>
            <label className="settings-field">
              <span>End time</span>
              <input
                onChange={(event) =>
                  onUpdateSettings({
                    weeklyWindow: {
                      ...settings?.weeklyWindow,
                      endLocalTime: event.target.value
                    }
                  })
                }
                type="time"
                value={settings?.weeklyWindow.endLocalTime ?? "00:00"}
              />
            </label>
          </div>

          <div className="control-actions">
            <button className="ghost-button" onClick={onRunCheckNow} type="button">
              Run Auto-Watch Check
            </button>
            <button className="ghost-button" onClick={onQuit} type="button">
              Quit Desktop App
            </button>
          </div>
        </div>
      ) : null}

      {desktopState ? (
        <div className="control-card">
          <div className="control-card-header">
            <div>
              <p className="eyebrow">Alerts & Window</p>
              <h3>Keep the stream visible and actionable</h3>
            </div>
            <span className={`status-pill is-${preferences?.window.compactMode ? "active_window" : "idle"}`}>
              {preferences?.window.compactMode ? "mini-player" : "desktop mode"}
            </span>
          </div>

          <p className="control-copy">
            {notificationPermission === "granted"
              ? "Desktop alerts are enabled when this window is hidden or unfocused."
              : notificationPermission === "default"
                ? "Allow notifications to get live, reconnect, staff reply, and metadata alerts."
                : notificationPermission === "denied"
                  ? "Desktop alerts are blocked by the browser runtime. Window controls still work."
                  : "Desktop notifications are not supported in this runtime."}
          </p>

          <div className="settings-grid">
            <label className="settings-toggle">
              <input
                checked={preferences?.window.compactMode ?? false}
                onChange={(event) =>
                  onUpdatePreferences({
                    window: {
                      ...preferences?.window,
                      compactMode: event.target.checked
                    }
                  })
                }
                type="checkbox"
              />
              <span>Compact mini-player</span>
            </label>
            <label className="settings-toggle">
              <input
                checked={preferences?.window.alwaysOnTop ?? false}
                onChange={(event) =>
                  onUpdatePreferences({
                    window: {
                      ...preferences?.window,
                      alwaysOnTop: event.target.checked
                    }
                  })
                }
                type="checkbox"
              />
              <span>Always on top</span>
            </label>
            <label className="settings-toggle">
              <input
                checked={preferences?.notifications.live ?? true}
                onChange={(event) =>
                  onUpdatePreferences({
                    notifications: {
                      ...preferences?.notifications,
                      live: event.target.checked
                    }
                  })
                }
                type="checkbox"
              />
              <span>Notify when the show goes live</span>
            </label>
            <label className="settings-toggle">
              <input
                checked={preferences?.notifications.reconnectRequired ?? true}
                onChange={(event) =>
                  onUpdatePreferences({
                    notifications: {
                      ...preferences?.notifications,
                      reconnectRequired: event.target.checked
                    }
                  })
                }
                type="checkbox"
              />
              <span>Notify when reconnect is required</span>
            </label>
            <label className="settings-toggle">
              <input
                checked={preferences?.notifications.staffReply ?? true}
                onChange={(event) =>
                  onUpdatePreferences({
                    notifications: {
                      ...preferences?.notifications,
                      staffReply: event.target.checked
                    }
                  })
                }
                type="checkbox"
              />
              <span>Notify for staff replies</span>
            </label>
            <label className="settings-toggle">
              <input
                checked={preferences?.notifications.metadataUpdated ?? true}
                onChange={(event) =>
                  onUpdatePreferences({
                    notifications: {
                      ...preferences?.notifications,
                      metadataUpdated: event.target.checked
                    }
                  })
                }
                type="checkbox"
              />
              <span>Notify when metadata changes</span>
            </label>
          </div>
        </div>
      ) : null}

      {simulation?.available ? (
        <div className="control-card">
          <div className="control-card-header">
            <div>
              <p className="eyebrow">Simulation</p>
              <h3>Force the Friday flow locally</h3>
            </div>
            <span className={`status-pill is-${simulation.active ? "active_window" : "idle"}`}>
              {simulation.active ? "simulation active" : "simulation idle"}
            </span>
          </div>

          <p className="control-copy">
            Dev-only controls for validating background launch, restore/focus, reconnect prompts,
            and autoplay without waiting for the real broadcast window.
          </p>

          <div className="settings-grid">
            <label className="settings-toggle">
              <input
                checked={simulation.forceActiveWindow}
                onChange={(event) =>
                  onUpdateSimulation({ forceActiveWindow: event.target.checked })
                }
                type="checkbox"
              />
              <span>Force active watch window</span>
            </label>
            <label className="settings-field">
              <span>Session state</span>
              <select
                onChange={(event) =>
                  onUpdateSimulation({
                    sessionMode: event.target.value as DesktopSimulationSettings["sessionMode"]
                  })
                }
                value={simulation.sessionMode}
              >
                {SESSION_SIMULATION_OPTIONS.map(([value, label]) => (
                  <option key={value} value={value}>
                    {label}
                  </option>
                ))}
              </select>
            </label>
            <label className="settings-field">
              <span>Live state</span>
              <select
                onChange={(event) =>
                  onUpdateSimulation({
                    liveMode: event.target.value as DesktopSimulationSettings["liveMode"]
                  })
                }
                value={simulation.liveMode}
              >
                {LIVE_SIMULATION_OPTIONS.map(([value, label]) => (
                  <option key={value} value={value}>
                    {label}
                  </option>
                ))}
              </select>
            </label>
          </div>

          <div className="control-actions">
            <button className="ghost-button" onClick={onRunCheckNow} type="button">
              Trigger Simulated Check
            </button>
            <button className="ghost-button" onClick={onResetSimulation} type="button">
              Reset Simulation
            </button>
          </div>
        </div>
      ) : null}
    </section>
  );
}
