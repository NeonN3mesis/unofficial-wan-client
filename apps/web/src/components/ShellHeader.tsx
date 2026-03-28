import type { SessionState } from "@shared";

interface ShellHeaderProps {
  session: SessionState | null;
  showAccountPanel: boolean;
  notificationPermission: NotificationPermission | "unsupported";
  onEnableNotifications: () => void;
  onToggleAccountPanel: () => void;
  onReconnect: () => void;
  onLogout: () => void;
}

export function ShellHeader({
  session,
  showAccountPanel,
  notificationPermission,
  onEnableNotifications,
  onToggleAccountPanel,
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
