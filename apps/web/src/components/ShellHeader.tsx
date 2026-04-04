import type { SessionState } from "@shared";

interface ShellHeaderProps {
  isDesktop: boolean;
  session: SessionState | null;
  showDesktopControls: boolean;
  compactMode: boolean;
  alwaysOnTop: boolean;
  notificationPermission: NotificationPermission | "unsupported";
  onEnableNotifications: () => void;
  onToggleDesktopControls: () => void;
  onToggleCompactMode: () => void;
  onToggleAlwaysOnTop: () => void;
  onReconnect: () => void;
  onLogout: () => void;
}

function getSessionChipLabel(session: SessionState | null): string {
  if (!session) {
    return "Connecting";
  }

  switch (session.status) {
    case "authenticated":
      return "Connected";
    case "authenticating":
      return "Finish Sign-In";
    case "expired":
      return "Reconnect";
    case "error":
      return "Fix Session";
    default:
      return "Connect";
  }
}

export function ShellHeader({
  isDesktop,
  session,
  showDesktopControls,
  compactMode,
  alwaysOnTop,
  notificationPermission,
  onEnableNotifications,
  onToggleDesktopControls,
  onToggleCompactMode,
  onToggleAlwaysOnTop,
  onReconnect,
  onLogout
}: ShellHeaderProps) {
  const sessionChipLabel = getSessionChipLabel(session);

  return (
    <header className="shell-header">
      <div className="header-actions">
        {isDesktop ? (
          <span className={`status-pill is-${session?.status ?? "unknown"}`.trim()}>
            <span className="status-dot" aria-hidden="true" />
            {sessionChipLabel}
          </span>
        ) : null}
        {isDesktop ? (
          <button
            className={`ghost-button header-settings-button ${showDesktopControls ? "is-open" : ""}`.trim()}
            aria-pressed={showDesktopControls}
            onClick={onToggleDesktopControls}
            type="button"
          >
            Settings
          </button>
        ) : null}
        {notificationPermission === "default" ? (
          <button className="ghost-button" onClick={onEnableNotifications} type="button">
            Enable alerts
          </button>
        ) : null}
        {isDesktop ? (
          <button className="ghost-button" onClick={onToggleCompactMode} type="button">
            {compactMode ? "Full player" : "Mini player"}
          </button>
        ) : null}
        {isDesktop ? (
          <button className="ghost-button" onClick={onToggleAlwaysOnTop} type="button">
            {alwaysOnTop ? "Unpin" : "Pin on top"}
          </button>
        ) : null}
        <button className="ghost-button" onClick={onReconnect} type="button">
          Refresh live state
        </button>
        <button className="ghost-button" onClick={onLogout} type="button">
          Clear session
        </button>
      </div>
    </header>
  );
}
