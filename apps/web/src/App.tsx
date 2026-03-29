import { startTransition, useEffect, useRef, useState } from "react";
import type {
  BackgroundWatchSettings,
  ChatMessage,
  ChatStreamEvent,
  DesktopPreferences,
  DesktopSimulationSettings,
  DesktopState,
  SessionState,
  WanLiveState
} from "@shared";
import { ChatPane } from "./components/ChatPane";
import { DesktopControlPanel } from "./components/DesktopControlPanel";
import { RecoveryNoticeStrip } from "./components/RecoveryNoticeStrip";
import { ShellHeader } from "./components/ShellHeader";
import { VideoStage, type PlaybackRecoveryState } from "./components/VideoStage";
import { getChatMessageFlags } from "./lib/chat-feed";
import {
  bootstrapSession,
  cancelManagedConnect,
  completeManagedConnect,
  fetchWanLiveState,
  getSessionState,
  logoutSession,
  sendChatMessage,
  startManagedConnect
} from "./lib/api";

type RelayStatus = "idle" | "connecting" | "live" | "reconnecting";
type NoticeTone = "info" | "warning" | "error";
const FAST_DISCOVERY_REFRESH_MS = 5_000;
const LIVE_REFRESH_INTERVAL_MS = 15_000;
const HIDDEN_DISCOVERY_REFRESH_MS = 20_000;
const HIDDEN_LIVE_REFRESH_MS = 30_000;
const DEFAULT_DESKTOP_PREFERENCES: DesktopPreferences = {
  notifications: {
    live: true,
    reconnectRequired: true,
    staffReply: true,
    metadataUpdated: true
  },
  window: {
    alwaysOnTop: false,
    compactMode: false
  }
};

interface RecoveryNotice {
  id: string;
  title: string;
  message: string;
  tone: NoticeTone;
}

function mergeMessages(current: ChatMessage[], next: ChatMessage[]) {
  const byId = new Map<string, ChatMessage>();

  [...current, ...next].forEach((message) => {
    byId.set(message.id, message);
  });

  return [...byId.values()].sort((left, right) => Date.parse(left.sentAt) - Date.parse(right.sentAt));
}

function getCurrentUsername(messages: ChatMessage[]): string | null {
  return [...messages].reverse().find((message) => message.isOwn)?.authorName ?? null;
}

export function App() {
  const isDesktop = Boolean(window.desktopBridge?.isDesktop);
  const [session, setSession] = useState<SessionState | null>(null);
  const [desktopState, setDesktopState] = useState<DesktopState | null>(null);
  const [liveState, setLiveState] = useState<WanLiveState | null>(null);
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [relayStatus, setRelayStatus] = useState<RelayStatus>("idle");
  const [composer, setComposer] = useState("");
  const [flash, setFlash] = useState<string | null>(null);
  const [liveRefreshIssue, setLiveRefreshIssue] = useState<string | null>(null);
  const [playbackRecovery, setPlaybackRecovery] = useState<PlaybackRecoveryState>({
    state: "idle",
    message: null
  });
  const [sending, setSending] = useState(false);
  const [showAccountPanel, setShowAccountPanel] = useState(true);
  const [isDocumentVisible, setIsDocumentVisible] = useState(
    () => document.visibilityState === "visible"
  );
  const [notificationPermission, setNotificationPermission] = useState<
    NotificationPermission | "unsupported"
  >(() => ("Notification" in window ? Notification.permission : "unsupported"));
  const liveRefreshRef = useRef<Promise<void> | null>(null);
  const messagesRef = useRef<ChatMessage[]>([]);
  const previousLiveKeyRef = useRef<string | null>(null);
  const previousLaunchSequenceRef = useRef<number>(0);
  const previousSessionStatusRef = useRef<SessionState["status"] | null>(null);
  const previousMetadataSignatureRef = useRef<string | null>(null);
  const hasPlaybackSource = Boolean(
    liveState?.playbackSources.some((candidate) => candidate.kind !== "unresolved" && candidate.url)
  );
  const activePlaybackSource =
    liveState?.playbackSources.find((candidate) => candidate.kind !== "unresolved" && candidate.url) ??
    null;
  const visibleRefreshIntervalMs =
    liveState?.status === "live" && hasPlaybackSource
      ? LIVE_REFRESH_INTERVAL_MS
      : FAST_DISCOVERY_REFRESH_MS;
  const hiddenRefreshIntervalMs =
    liveState?.status === "live" && hasPlaybackSource
      ? HIDDEN_LIVE_REFRESH_MS
      : HIDDEN_DISCOVERY_REFRESH_MS;
  const liveRefreshIntervalMs = isDocumentVisible
    ? visibleRefreshIntervalMs
    : hiddenRefreshIntervalMs;
  const desktopPreferences = desktopState?.preferences ?? DEFAULT_DESKTOP_PREFERENCES;
  const compactPlayerMode =
    Boolean(isDesktop && desktopState?.preferences.window.compactMode && session?.status === "authenticated");

  function canShowDesktopNotification(enabled: boolean): boolean {
    if (!enabled || notificationPermission !== "granted" || !("Notification" in window)) {
      return false;
    }

    return !(document.visibilityState === "visible" && document.hasFocus());
  }

  function showDesktopNotification(title: string, options: NotificationOptions) {
    const notification = new Notification(title, options);
    notification.onclick = () => {
      window.focus();
      notification.close();
    };
  }

  async function refreshSessionState(currentDesktopState: DesktopState | null = desktopState) {
    const simulatedSession = currentDesktopState?.simulation.session;

    if (simulatedSession) {
      setSession(simulatedSession);
      return simulatedSession;
    }

    const nextSession = await getSessionState();
    setSession(nextSession);
    return nextSession;
  }

  async function refreshLiveState(currentDesktopState: DesktopState | null = desktopState) {
    if (liveRefreshRef.current) {
      return liveRefreshRef.current;
    }

    const request = (async () => {
      const simulatedLiveState = currentDesktopState?.simulation.liveState;

      if (simulatedLiveState) {
        setLiveState(simulatedLiveState);
        setLiveRefreshIssue(null);
        return;
      }

      try {
        const nextLiveState = await fetchWanLiveState();
        setLiveState(nextLiveState);
        setLiveRefreshIssue(null);
      } catch (error) {
        const payload = error as Partial<SessionState>;

        if (payload?.status) {
          setSession(payload as SessionState);
        }

        setLiveRefreshIssue(
          payload?.message ??
            "The local relay could not refresh live metadata. The app will retry automatically."
        );
      }
    })();

    liveRefreshRef.current = request;

    try {
      await request;
    } finally {
      if (liveRefreshRef.current === request) {
        liveRefreshRef.current = null;
      }
    }
  }

  useEffect(() => {
    let isActive = true;
    let unsubscribeDesktop: (() => void) | undefined;

    async function initialize() {
      try {
        let nextDesktopState: DesktopState | null = null;

        if (isDesktop && window.desktopBridge) {
          nextDesktopState = await window.desktopBridge.getState();

          if (!isActive) {
            return;
          }

          setDesktopState(nextDesktopState);
          previousLaunchSequenceRef.current = nextDesktopState.status.launchSequence;
          unsubscribeDesktop = window.desktopBridge.onStateChange((nextState) => {
            setDesktopState(nextState);
          });
        }

        let nextSession = await refreshSessionState(nextDesktopState);

        if (!isActive) {
          return;
        }

        if (!isDesktop && nextSession.status === "unauthenticated") {
          nextSession = await bootstrapSession();
        }

        if (!isActive) {
          return;
        }

        if (nextSession.status === "authenticated") {
          await refreshLiveState(nextDesktopState);
        }
      } catch {
        if (isActive) {
          setFlash("Initial bootstrap failed.");
        }
      }
    }

    void initialize();

    return () => {
      isActive = false;
      unsubscribeDesktop?.();
    };
  }, [isDesktop]);

  useEffect(() => {
    setShowAccountPanel(session?.status !== "authenticated");
  }, [session?.status]);

  useEffect(() => {
    messagesRef.current = messages;
  }, [messages]);

  useEffect(() => {
    const launchSequence = desktopState?.status.launchSequence ?? 0;

    if (launchSequence <= previousLaunchSequenceRef.current) {
      return;
    }

    previousLaunchSequenceRef.current = launchSequence;

    if (desktopState?.status.lastLaunchReason === "background_live") {
      setFlash("The WAN Show went live and the desktop app brought the player forward.");
      void refreshSessionState().then((nextSession) => {
        if (nextSession.status === "authenticated") {
          void refreshLiveState();
        }
      });
      return;
    }

    if (desktopState?.status.lastLaunchReason === "reauth_required") {
      setFlash("Floatplane sign-in needs attention to keep auto-watch running.");
      void refreshSessionState();
    }
  }, [desktopState?.status.lastLaunchReason, desktopState?.status.launchSequence]);

  useEffect(() => {
    if (session?.status !== "authenticated") {
      setMessages([]);
      setPlaybackRecovery({
        state: "idle",
        message: null
      });
      return;
    }

    setRelayStatus("connecting");
    const stream = new EventSource("/wan/chat/stream");

    stream.onopen = () => {
      setRelayStatus("live");
    };

    stream.onmessage = (event) => {
      const payload = JSON.parse(event.data) as ChatStreamEvent;
      const nextMessages =
        payload.type === "snapshot"
          ? mergeMessages(messagesRef.current, payload.messages)
          : payload.type === "message"
            ? mergeMessages(messagesRef.current, [payload.message])
            : messagesRef.current;
      messagesRef.current = nextMessages;

      if (payload.type === "message") {
        const currentUsername = getCurrentUsername(nextMessages);
        const flags = getChatMessageFlags(payload.message, currentUsername);

        if (
          flags.isStaff &&
          flags.isMention &&
          !payload.message.isOwn &&
          canShowDesktopNotification(desktopPreferences.notifications.staffReply)
        ) {
          showDesktopNotification("Staff replied in chat", {
            body: `${payload.message.authorName}: ${payload.message.body}`,
            tag: "wan-client-staff-reply",
            renotify: false
          });
        }
      }

      startTransition(() => {
        setMessages(nextMessages);
      });
    };

    stream.onerror = () => {
      setRelayStatus("reconnecting");
    };

    return () => {
      stream.close();
      setRelayStatus("idle");
    };
  }, [desktopPreferences.notifications.staffReply, notificationPermission, session?.status]);

  useEffect(() => {
    if (session?.status !== "authenticating") {
      return;
    }

    const handle = window.setInterval(() => {
      void refreshSessionState();
    }, 3_000);

    return () => {
      window.clearInterval(handle);
    };
  }, [session?.status]);

  useEffect(() => {
    if (!("Notification" in window)) {
      setNotificationPermission("unsupported");
      return;
    }

    setNotificationPermission(Notification.permission);
  }, []);

  useEffect(() => {
    function handleVisibilityChange() {
      const nextIsVisible = document.visibilityState === "visible";
      setIsDocumentVisible(nextIsVisible);

      if (nextIsVisible && session?.status === "authenticated") {
        void refreshLiveState();
      }
    }

    document.addEventListener("visibilitychange", handleVisibilityChange);
    window.addEventListener("focus", handleVisibilityChange);

    return () => {
      document.removeEventListener("visibilitychange", handleVisibilityChange);
      window.removeEventListener("focus", handleVisibilityChange);
    };
  }, [session?.status]);

  useEffect(() => {
    const currentLiveKey =
      liveState?.status === "live" && activePlaybackSource?.url
        ? `${liveState.streamTitle}|${activePlaybackSource.url}`
        : null;
    const previousLiveKey = previousLiveKeyRef.current;
    previousLiveKeyRef.current = currentLiveKey;

    if (!currentLiveKey || currentLiveKey === previousLiveKey) {
      return;
    }

    if (!canShowDesktopNotification(desktopPreferences.notifications.live)) {
      return;
    }

    showDesktopNotification("WAN Show is live", {
      body: liveState?.streamTitle ?? "Floatplane playback is ready.",
      icon: liveState?.posterUrl,
      tag: "wan-client-live",
      renotify: false
    });
  }, [
    activePlaybackSource?.url,
    desktopPreferences.notifications.live,
    liveState?.posterUrl,
    liveState?.status,
    liveState?.streamTitle,
    notificationPermission
  ]);

  useEffect(() => {
    const currentStatus = session?.status ?? null;
    const previousStatus = previousSessionStatusRef.current;
    previousSessionStatusRef.current = currentStatus;

    if (!currentStatus || currentStatus === previousStatus) {
      return;
    }

    if (
      (currentStatus === "expired" || currentStatus === "error") &&
      canShowDesktopNotification(desktopPreferences.notifications.reconnectRequired)
    ) {
      showDesktopNotification("Reconnect required", {
        body:
          session?.message ??
          "Floatplane sign-in needs attention before playback and chat can recover.",
        tag: "wan-client-reauth",
        renotify: false
      });
    }
  }, [
    desktopPreferences.notifications.reconnectRequired,
    notificationPermission,
    session?.message,
    session?.status
  ]);

  useEffect(() => {
    const metadataSignature =
      liveState?.streamTitle || liveState?.summary || liveState?.posterUrl
        ? [
            liveState?.streamTitle ?? "",
            liveState?.summary ?? "",
            liveState?.posterUrl ?? ""
          ].join("|")
        : null;
    const previousSignature = previousMetadataSignatureRef.current;
    previousMetadataSignatureRef.current = metadataSignature;

    if (!metadataSignature || !previousSignature || metadataSignature === previousSignature) {
      return;
    }

    if (!canShowDesktopNotification(desktopPreferences.notifications.metadataUpdated)) {
      return;
    }

    showDesktopNotification("WAN Show metadata updated", {
      body: liveState?.summary ?? liveState?.streamTitle ?? "The live page details changed.",
      icon: liveState?.posterUrl,
      tag: "wan-client-metadata",
      renotify: false
    });
  }, [
    desktopPreferences.notifications.metadataUpdated,
    liveState?.posterUrl,
    liveState?.streamTitle,
    liveState?.summary,
    notificationPermission
  ]);

  useEffect(() => {
    if (session?.status !== "authenticated") {
      return;
    }

    const intervalHandle = window.setInterval(() => {
      void refreshLiveState();
    }, liveRefreshIntervalMs);

    return () => {
      window.clearInterval(intervalHandle);
    };
  }, [liveRefreshIntervalMs, session?.status]);

  async function handleSend() {
    if (!composer.trim()) {
      return;
    }

    setSending(true);

    try {
      const result = await sendChatMessage(composer);

      if (result.status === "sent") {
        setMessages((current) => mergeMessages(current, [result.message]));
        setComposer("");
        setFlash("Message sent.");
      } else {
        setFlash(result.message);
      }
    } catch (error) {
      const payload = error as { message?: string };
      setFlash(payload.message ?? "Chat send failed.");
    } finally {
      setSending(false);
    }
  }

  async function handleLogout() {
    const nextSession = await logoutSession();
    setSession(nextSession);
    setLiveState(null);
    setMessages([]);
    setRelayStatus("idle");
    setFlash("Local session cleared.");
  }

  async function handleEnableNotifications() {
    if (!("Notification" in window)) {
      setNotificationPermission("unsupported");
      setFlash("Desktop notifications are not supported in this browser.");
      return;
    }

    const permission = await Notification.requestPermission();
    setNotificationPermission(permission);
    setFlash(
      permission === "granted"
        ? "Desktop go-live alerts enabled."
        : permission === "denied"
          ? "Desktop alerts were blocked by the browser."
          : "Desktop alerts remain disabled."
    );
  }

  async function handleStartConnect() {
    const nextSession = await startManagedConnect();
    setSession(nextSession);
    setFlash("Finish the Floatplane sign-in flow in the managed browser, then return here.");
  }

  async function handleCompleteConnect() {
    const nextSession = await completeManagedConnect();
    setSession(nextSession);
    setFlash("Floatplane account connected.");

    if (nextSession.status === "authenticated") {
      await refreshLiveState();
    }
  }

  async function handleCancelConnect() {
    const nextSession = await cancelManagedConnect();
    setSession(nextSession);
    setFlash("Floatplane sign-in cancelled.");
  }

  async function handleUpdateDesktopSettings(nextSettings: Partial<BackgroundWatchSettings>) {
    const nextState = await window.desktopBridge?.updateSettings(nextSettings);

    if (nextState) {
      setDesktopState(nextState);
      setFlash("Auto-watch settings updated.");
    }
  }

  async function handleUpdateDesktopPreferences(nextPreferences: Partial<DesktopPreferences>) {
    const nextState = await window.desktopBridge?.updatePreferences(nextPreferences);

    if (nextState) {
      setDesktopState(nextState);
      setFlash("Desktop preferences updated.");
    }
  }

  async function handleUpdateSimulation(nextSettings: Partial<DesktopSimulationSettings>) {
    const nextState = await window.desktopBridge?.updateSimulation(nextSettings);

    if (nextState) {
      setDesktopState(nextState);
      setFlash("Desktop simulation updated.");
      const nextSession = await refreshSessionState(nextState);

      if (nextSession.status === "authenticated") {
        await refreshLiveState(nextState);
      } else {
        setLiveState(null);
      }
    }
  }

  async function handleResetSimulation() {
    const nextState = await window.desktopBridge?.resetSimulation();

    if (nextState) {
      setDesktopState(nextState);
      setFlash("Desktop simulation cleared.");
      const nextSession = await refreshSessionState(nextState);

      if (nextSession.status === "authenticated") {
        await refreshLiveState(nextState);
      } else {
        setLiveState(null);
      }
    }
  }

  async function handleRunCheckNow() {
    const nextState = await window.desktopBridge?.checkNow();

    if (nextState) {
      setDesktopState(nextState);
      setFlash("Background watch check ran immediately.");
      const nextSession = await refreshSessionState(nextState);

      if (nextSession.status === "authenticated") {
        await refreshLiveState(nextState);
      } else {
        setLiveState(null);
      }
    }
  }

  async function handleQuitDesktop() {
    await window.desktopBridge?.quit();
  }

  const recoveryNotices: RecoveryNotice[] = [];

  if (session?.status === "authenticating") {
    recoveryNotices.push({
      id: "session-authenticating",
      title: "Waiting for Floatplane sign-in",
      message:
        session.message ??
        "Finish the managed browser sign-in flow, then return here and complete the connection.",
      tone: "info"
    });
  }

  if (session?.status === "expired") {
    recoveryNotices.push({
      id: "session-expired",
      title: "Reconnect required",
      message:
        session.message ??
        "Your saved Floatplane session expired. Reconnect to restore playback and chat.",
      tone: "warning"
    });
  }

  if (session?.status === "error") {
    recoveryNotices.push({
      id: "session-error",
      title: "Floatplane connection error",
      message: session.message ?? "The local Floatplane session needs attention.",
      tone: "error"
    });
  }

  if (relayStatus === "reconnecting") {
    recoveryNotices.push({
      id: "chat-reconnecting",
      title: "Chat reconnecting",
      message:
        liveState?.chatCapability.reason ??
        "The chat relay dropped and is retrying the live connection.",
      tone: "info"
    });
  }

  if (liveRefreshIssue && session?.status === "authenticated") {
    recoveryNotices.push({
      id: "live-refresh",
      title: "Live metadata unavailable",
      message: liveRefreshIssue,
      tone: "warning"
    });
  }

  if (playbackRecovery.message) {
    recoveryNotices.push({
      id: `playback-${playbackRecovery.state}`,
      title:
        playbackRecovery.state === "error"
          ? "Playback needs attention"
          : playbackRecovery.state === "recovering-network"
            ? "Playback reconnecting"
            : playbackRecovery.state === "recovering-media"
              ? "Playback recovering"
              : "Playback catching up",
      message: playbackRecovery.message,
      tone: playbackRecovery.state === "error" ? "error" : "warning"
    });
  }

  return (
    <main className={`app-shell ${compactPlayerMode ? "is-compact-mode" : ""}`.trim()}>
      <div className="background-orbit background-orbit-a" />
      <div className="background-orbit background-orbit-b" />

      <ShellHeader
        isDesktop={isDesktop}
        compactMode={desktopPreferences.window.compactMode}
        alwaysOnTop={desktopPreferences.window.alwaysOnTop}
        session={session}
        showAccountPanel={showAccountPanel}
        notificationPermission={notificationPermission}
        onEnableNotifications={() => void handleEnableNotifications()}
        onToggleAccountPanel={() => setShowAccountPanel((current) => !current)}
        onToggleCompactMode={() =>
          void handleUpdateDesktopPreferences({
            window: {
              ...desktopPreferences.window,
              compactMode: !desktopPreferences.window.compactMode
            }
          })
        }
        onToggleAlwaysOnTop={() =>
          void handleUpdateDesktopPreferences({
            window: {
              ...desktopPreferences.window,
              alwaysOnTop: !desktopPreferences.window.alwaysOnTop
            }
          })
        }
        onReconnect={() => {
          void refreshSessionState();
          if (session?.status === "authenticated") {
            void refreshLiveState();
          }
        }}
        onLogout={() => void handleLogout()}
      />

      {!compactPlayerMode ? (
        <DesktopControlPanel
          desktopState={desktopState}
          showAccountPanel={showAccountPanel}
          notificationPermission={notificationPermission}
          onCancelConnect={() => void handleCancelConnect()}
          onCompleteConnect={() => void handleCompleteConnect()}
          onQuit={() => void handleQuitDesktop()}
          onResetSimulation={() => void handleResetSimulation()}
          onRunCheckNow={() => void handleRunCheckNow()}
          onStartConnect={() => void handleStartConnect()}
          onUpdatePreferences={(preferences) => void handleUpdateDesktopPreferences(preferences)}
          onUpdateSimulation={(settings) => void handleUpdateSimulation(settings)}
          onUpdateSettings={(settings) => void handleUpdateDesktopSettings(settings)}
          session={session}
        />
      ) : null}

      {recoveryNotices.length > 0 ? <RecoveryNoticeStrip notices={recoveryNotices} /> : null}

      <section className={`workspace ${compactPlayerMode ? "is-compact" : ""}`.trim()}>
        <VideoStage
          compactMode={compactPlayerMode}
          launchSequence={desktopState?.status.launchSequence ?? 0}
          liveState={liveState}
          onRecoveryChange={setPlaybackRecovery}
          relayStatus={relayStatus}
          sessionMessage={session?.message ?? "Connecting to the local Floatplane relay"}
        />
        {!compactPlayerMode ? (
          <ChatPane
            liveState={liveState}
            session={session}
            messages={messages}
            composer={composer}
            setComposer={setComposer}
            onSend={() => void handleSend()}
            sending={sending}
            streamStatus={relayStatus}
            flash={flash}
          />
        ) : null}
      </section>
    </main>
  );
}
