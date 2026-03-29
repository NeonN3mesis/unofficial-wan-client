import type { SessionState } from "@shared";

interface ShellHeaderProps {
  isDesktop: boolean;
  session: SessionState | null;
  showAccountPanel: boolean;
  compactMode: boolean;
  alwaysOnTop: boolean;
  notificationPermission: NotificationPermission | "unsupported";
  onEnableNotifications: () => void;
  onToggleAccountPanel: () => void;
  onToggleCompactMode: () => void;
  onToggleAlwaysOnTop: () => void;
  onReconnect: () => void;
  onLogout: () => void;
}

export function ShellHeader({
  isDesktop,
  session,
  showAccountPanel,
  compactMode,
  alwaysOnTop,
  notificationPermission,
  onEnableNotifications,
  onToggleAccountPanel,
  onToggleCompactMode,
  onToggleAlwaysOnTop,
  onReconnect,
  onLogout
}: ShellHeaderProps) {
  return (
    <header className="shell-header">
      <div className="header-actions">
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
        {session?.status === "authenticated" ? (
          <button
            className="status-pill status-pill-button is-authenticated header-account-toggle"
            aria-pressed={showAccountPanel}
            onClick={onToggleAccountPanel}
            type="button"
          >
            <span className="status-dot" aria-hidden="true" />
            Connected
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
