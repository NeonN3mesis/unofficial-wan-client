import { startTransition, useEffect, useRef, useState } from "react";
import type {
  BackgroundWatchSettings,
  ChatMessage,
  ChatStreamEvent,
  DesktopSimulationSettings,
  DesktopState,
  SessionState,
  WanLiveState
} from "@shared";
import { ChatPane } from "./components/ChatPane";
import { DesktopControlPanel } from "./components/DesktopControlPanel";
import { ShellHeader } from "./components/ShellHeader";
import { VideoStage } from "./components/VideoStage";
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
const FAST_DISCOVERY_REFRESH_MS = 5_000;
const LIVE_REFRESH_INTERVAL_MS = 15_000;
const HIDDEN_DISCOVERY_REFRESH_MS = 20_000;
const HIDDEN_LIVE_REFRESH_MS = 30_000;

function mergeMessages(current: ChatMessage[], next: ChatMessage[]) {
  const byId = new Map<string, ChatMessage>();

  [...current, ...next].forEach((message) => {
    byId.set(message.id, message);
  });

  return [...byId.values()].sort((left, right) => Date.parse(left.sentAt) - Date.parse(right.sentAt));
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
  const [sending, setSending] = useState(false);
  const [showAccountPanel, setShowAccountPanel] = useState(true);
  const [isDocumentVisible, setIsDocumentVisible] = useState(
    () => document.visibilityState === "visible"
  );
  const [notificationPermission, setNotificationPermission] = useState<
    NotificationPermission | "unsupported"
  >(() => ("Notification" in window ? Notification.permission : "unsupported"));
  const liveRefreshRef = useRef<Promise<void> | null>(null);
  const previousLiveKeyRef = useRef<string | null>(null);
  const previousLaunchSequenceRef = useRef<number>(0);
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
        setFlash(null);
        return;
      }

      try {
        const nextLiveState = await fetchWanLiveState();
        setLiveState(nextLiveState);
        setFlash(null);
      } catch (error) {
        const payload = error as Partial<SessionState>;

        if (payload?.status) {
          setSession(payload as SessionState);
        }

        setFlash("Live metadata is unavailable until the local Floatplane session is active.");
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
      return;
    }

    setRelayStatus("connecting");
    const stream = new EventSource("/wan/chat/stream");

    stream.onopen = () => {
      setRelayStatus("live");
    };

    stream.onmessage = (event) => {
      const payload = JSON.parse(event.data) as ChatStreamEvent;

      startTransition(() => {
        if (payload.type === "snapshot") {
          setMessages((current) => mergeMessages(current, payload.messages));
        }

        if (payload.type === "message") {
          setMessages((current) => mergeMessages(current, [payload.message]));
        }
      });
    };

    stream.onerror = () => {
      setRelayStatus("reconnecting");
    };

    return () => {
      stream.close();
      setRelayStatus("idle");
    };
  }, [session?.status]);

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

    if (notificationPermission !== "granted") {
      return;
    }

    if (document.visibilityState === "visible" && document.hasFocus()) {
      return;
    }

    const notification = new Notification("WAN Show is live", {
      body: liveState?.streamTitle ?? "Floatplane playback is ready.",
      icon: liveState?.posterUrl,
      tag: "wan-signal-live",
      renotify: false
    });

    notification.onclick = () => {
      window.focus();
      notification.close();
    };
  }, [
    activePlaybackSource?.url,
    liveState?.posterUrl,
    liveState?.status,
    liveState?.streamTitle,
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

  return (
    <main className="app-shell">
      <div className="background-orbit background-orbit-a" />
      <div className="background-orbit background-orbit-b" />

      <ShellHeader
        session={session}
        showAccountPanel={showAccountPanel}
        notificationPermission={notificationPermission}
        onEnableNotifications={() => void handleEnableNotifications()}
        onToggleAccountPanel={() => setShowAccountPanel((current) => !current)}
        onReconnect={() => {
          void refreshSessionState();
          if (session?.status === "authenticated") {
            void refreshLiveState();
          }
        }}
        onLogout={() => void handleLogout()}
      />

      <DesktopControlPanel
        desktopState={desktopState}
        showAccountPanel={showAccountPanel}
        onCancelConnect={() => void handleCancelConnect()}
        onCompleteConnect={() => void handleCompleteConnect()}
        onQuit={() => void handleQuitDesktop()}
        onResetSimulation={() => void handleResetSimulation()}
        onRunCheckNow={() => void handleRunCheckNow()}
        onStartConnect={() => void handleStartConnect()}
        onUpdateSimulation={(settings) => void handleUpdateSimulation(settings)}
        onUpdateSettings={(settings) => void handleUpdateDesktopSettings(settings)}
        session={session}
      />

      <section className="workspace">
        <VideoStage
          launchSequence={desktopState?.status.launchSequence ?? 0}
          liveState={liveState}
          sessionMessage={session?.message ?? "Connecting to the local Floatplane relay"}
        />
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
      </section>
    </main>
  );
}
