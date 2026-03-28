export type UpstreamMode = "fixture" | "pending-capture" | "reverse-proxy";
export type LaunchReason = "manual" | "background_live" | "reauth_required";
export type DesktopSimulationSessionMode = "passthrough" | "authenticated" | "expired";
export type DesktopSimulationLiveMode = "passthrough" | "offline" | "live";
export type BackgroundWatchState =
  | "idle"
  | "watching_background"
  | "active_window"
  | "live_launched"
  | "reauth_required";

export type SessionStatus =
  | "unauthenticated"
  | "authenticating"
  | "authenticated"
  | "expired"
  | "error";

export type SessionMode = "fixture" | "storage-state" | "playwright" | "reverse-proxy";

export interface SessionState {
  status: SessionStatus;
  mode: SessionMode;
  upstreamMode: UpstreamMode;
  hasPersistedSession: boolean;
  cookieCount: number;
  loginUrl: string;
  message: string;
  nextAction?: "connect" | "finish-connect" | "retry-connect" | "clear-session";
  lastValidatedAt?: string;
  expiresAt?: string;
}

export type PlaybackSourceKind = "hls" | "dash" | "mp4" | "unresolved";

export interface PlaybackSource {
  id: string;
  label: string;
  kind: PlaybackSourceKind;
  url?: string;
  mimeType?: string;
  drm: boolean;
  latencyTarget: "standard" | "low";
}

export interface ChatCapability {
  canRead: boolean;
  canSend: boolean;
  mode: "full" | "read-only";
  transport: "sse" | "websocket" | "unknown";
  reason?: string;
}

export type ChatAuthorRole = "host" | "admin" | "moderator" | "member" | "guest" | "system";

export interface ChatMessage {
  id: string;
  body: string;
  authorName: string;
  authorRole: ChatAuthorRole;
  accentColor?: string;
  sentAt: string;
  source: "fixture" | "user" | "relay";
  isOwn?: boolean;
}

export interface WanLiveState {
  creatorId: "wan-show";
  creatorName: string;
  streamTitle: string;
  summary: string;
  status: "live" | "offline" | "scheduled";
  startedAt?: string;
  scheduleNote?: string;
  posterUrl?: string;
  playbackSources: PlaybackSource[];
  chatCapability: ChatCapability;
  upstreamMode: UpstreamMode;
  notes: string[];
}

export interface BackgroundWatchSettings {
  enabled: boolean;
  autostartOnLogin: boolean;
  weeklyWindow: {
    dayOfWeek: 0 | 1 | 2 | 3 | 4 | 5 | 6;
    startLocalTime: string;
    endLocalTime: string;
  };
}

export interface BackgroundWatchStatus {
  state: BackgroundWatchState;
  enabled: boolean;
  activeWindow: boolean;
  message: string;
  lastCheckAt?: string;
  nextCheckAt?: string;
  lastLaunchAt?: string;
  lastLaunchReason?: LaunchReason;
  launchSequence: number;
}

export interface DesktopSimulationSettings {
  forceActiveWindow: boolean;
  sessionMode: DesktopSimulationSessionMode;
  liveMode: DesktopSimulationLiveMode;
}

export interface DesktopSimulationState extends DesktopSimulationSettings {
  available: boolean;
  active: boolean;
  session?: SessionState;
  liveState?: WanLiveState;
}

export interface DesktopState {
  settings: BackgroundWatchSettings;
  status: BackgroundWatchStatus;
  simulation: DesktopSimulationState;
}

export type ChatSendResult =
  | {
      status: "sent";
      message: ChatMessage;
    }
  | {
      status: "unsupported" | "unauthenticated" | "rate_limited" | "auth_expired" | "upstream_error";
      message: string;
      retryAfterMs?: number;
    };

export interface ChatSnapshotEvent {
  type: "snapshot";
  messages: ChatMessage[];
}

export interface ChatMessageEvent {
  type: "message";
  message: ChatMessage;
}

export interface ChatHeartbeatEvent {
  type: "heartbeat";
  sentAt: string;
}

export type ChatStreamEvent = ChatSnapshotEvent | ChatMessageEvent | ChatHeartbeatEvent;

export interface SessionBootstrapRequest {
  mode?: "fixture" | "storage-state";
  storageState?: {
    cookies?: Array<{
      name: string;
      value: string;
      domain: string;
      path?: string;
      expires?: number;
      httpOnly?: boolean;
      secure?: boolean;
      sameSite?: "Strict" | "Lax" | "None";
    }>;
    origins?: Array<{
      origin: string;
      localStorage: Array<{ name: string; value: string }>;
    }>;
  };
}
