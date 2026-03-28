import { useEffect, useMemo, useRef, useState, type KeyboardEvent } from "react";
import type { ChatMessage, SessionState, WanLiveState } from "@shared";
import { isMentionCandidate } from "../lib/chat-format";
import { getChatMessageFlags, matchesChatFilter, type ChatFilterMode } from "../lib/chat-feed";
import { ChatMessageBody } from "./ChatMessageBody";

interface ChatPaneProps {
  liveState: WanLiveState | null;
  session: SessionState | null;
  messages: ChatMessage[];
  composer: string;
  setComposer: (value: string) => void;
  onSend: () => void;
  sending: boolean;
  streamStatus: "idle" | "connecting" | "live" | "reconnecting";
  flash: string | null;
}

const CHAT_FILTER_STORAGE_KEY = "wan-signal-chat-filter-mode";

function getRoleBadgeLabel(role: ChatMessage["authorRole"]): string | null {
  switch (role) {
    case "host":
      return "Host";
    case "admin":
      return "Admin";
    case "moderator":
      return "Mod";
    case "system":
      return "System";
    default:
      return null;
  }
}

export function ChatPane({
  liveState,
  session,
  messages,
  composer,
  setComposer,
  onSend,
  sending,
  streamStatus,
  flash
}: ChatPaneProps) {
  const scrollRef = useRef<HTMLDivElement | null>(null);
  const textareaRef = useRef<HTMLTextAreaElement | null>(null);
  const stickToBottomRef = useRef(true);
  const lastMessageCountRef = useRef(0);
  const [isAutoScrolling, setIsAutoScrolling] = useState(true);
  const [unreadCount, setUnreadCount] = useState(0);
  const [filterMode, setFilterMode] = useState<ChatFilterMode>(() => {
    try {
      const stored = window.localStorage.getItem(CHAT_FILTER_STORAGE_KEY);

      if (stored === "mentions" || stored === "staff") {
        return stored;
      }
    } catch {
      // Storage can be unavailable in hardened browsing contexts.
    }

    return "all";
  });
  const canSend =
    session?.status === "authenticated" && Boolean(liveState?.chatCapability.canSend);
  const currentUsername = useMemo(() => {
    const ownMessage = [...messages].reverse().find((message) => message.isOwn);
    return ownMessage?.authorName ?? null;
  }, [messages]);
  const decoratedMessages = useMemo(() => {
    return messages.map((message) => ({
      message,
      flags: getChatMessageFlags(message, currentUsername)
    }));
  }, [currentUsername, messages]);
  const filteredMessages = useMemo(() => {
    return decoratedMessages.filter(({ message }) => matchesChatFilter(message, filterMode, currentUsername));
  }, [currentUsername, decoratedMessages, filterMode]);
  const filterCounts = useMemo(() => {
    return {
      all: messages.length,
      mentions: decoratedMessages.filter(({ flags }) => flags.isMention).length,
      staff: decoratedMessages.filter(({ flags }) => flags.isStaff).length
    };
  }, [decoratedMessages, messages.length]);
  const remainingCharacters = 500 - composer.length;
  const relayModeLabel = canSend
    ? "Interactive"
    : liveState?.chatCapability.canRead
      ? "Read only"
      : "Offline";
  const statusCopy =
    streamStatus === "live"
      ? canSend
        ? "Chat connected and ready to send."
        : "Chat connected in read-only mode."
      : streamStatus === "connecting"
        ? "Connecting to live chat."
        : streamStatus === "reconnecting"
          ? "Reconnecting to live chat."
          : "Chat is idle.";

  useEffect(() => {
    try {
      window.localStorage.setItem(CHAT_FILTER_STORAGE_KEY, filterMode);
    } catch {
      // Storage can be unavailable in hardened browsing contexts.
    }
  }, [filterMode]);

  useEffect(() => {
    const scroller = scrollRef.current;
    const newMessageCount = Math.max(filteredMessages.length - lastMessageCountRef.current, 0);
    lastMessageCountRef.current = filteredMessages.length;

    if (!scroller) {
      return;
    }

    if (stickToBottomRef.current) {
      scroller.scrollTop = scroller.scrollHeight;
      setUnreadCount(0);
      setIsAutoScrolling(true);
      return;
    }

    if (newMessageCount > 0) {
      setUnreadCount((current) => current + newMessageCount);
    }
  }, [filteredMessages]);

  useEffect(() => {
    const textarea = textareaRef.current;

    if (!textarea) {
      return;
    }

    textarea.style.height = "0px";
    textarea.style.height = `${Math.min(textarea.scrollHeight, 220)}px`;
  }, [composer]);

  function syncAutoScrollState(nextIsAutoScrolling: boolean) {
    stickToBottomRef.current = nextIsAutoScrolling;
    setIsAutoScrolling(nextIsAutoScrolling);

    if (nextIsAutoScrolling) {
      setUnreadCount(0);
    }
  }

  function handleScroll() {
    const scroller = scrollRef.current;

    if (!scroller) {
      return;
    }

    const distanceFromBottom =
      scroller.scrollHeight - scroller.scrollTop - scroller.clientHeight;
    syncAutoScrollState(distanceFromBottom < 48);
  }

  function scrollToLatest() {
    const scroller = scrollRef.current;

    if (!scroller) {
      return;
    }

    syncAutoScrollState(true);
    scroller.scrollTo({
      top: scroller.scrollHeight,
      behavior: "smooth"
    });
  }

  function insertComposerText(
    value: string,
    options: {
      padLeft?: boolean;
      padRight?: boolean;
    } = {}
  ) {
    if (!canSend) {
      return;
    }

    const textarea = textareaRef.current;
    const start = textarea ? Math.min(textarea.selectionStart, textarea.selectionEnd) : composer.length;
    const end = textarea ? Math.max(textarea.selectionStart, textarea.selectionEnd) : composer.length;
    const left = composer.slice(0, start);
    const right = composer.slice(end);
    const padLeft = options.padLeft ?? true;
    const padRight = options.padRight ?? true;
    const prefix = padLeft && left.length > 0 && !/\s$/.test(left) ? " " : "";
    const suffix = padRight && right.length > 0 && !/^\s/.test(right) ? " " : padRight ? " " : "";
    const inserted = `${prefix}${value}${suffix}`;
    const nextComposer = `${left}${inserted}${right}`;
    const nextCursorPosition = left.length + inserted.length;

    setComposer(nextComposer);

    window.requestAnimationFrame(() => {
      const nextTextarea = textareaRef.current;

      if (!nextTextarea) {
        return;
      }

      nextTextarea.focus();
      nextTextarea.selectionStart = nextCursorPosition;
      nextTextarea.selectionEnd = nextCursorPosition;
    });
  }

  function handleInsertMention(username: string) {
    if (!isMentionCandidate(`@${username}`)) {
      return;
    }

    insertComposerText(`@${username}`);
  }

  function handleComposerKeyDown(event: KeyboardEvent<HTMLTextAreaElement>) {
    if (event.key !== "Enter" || event.shiftKey || event.nativeEvent.isComposing) {
      return;
    }

    event.preventDefault();
    onSend();
  }

  return (
    <aside className="chat-pane">
      <div className="chat-heading">
        <div className="chat-heading-copy">
          <p className="eyebrow">Live chat</p>
          <div className="chat-heading-title-row">
            <h3>Floatplane chat</h3>
          </div>
        </div>
        <div className="header-chip">
          <span>{relayModeLabel}</span>
          <strong>{messages.length}</strong>
        </div>
      </div>

      <div className="status-banner">
        <strong>{statusCopy}</strong>
        <span>{liveState?.chatCapability.transport ?? "unknown"} transport</span>
      </div>

      <div className="chat-tools">
        <div className="chat-filter-row">
          {(
            [
              ["all", "All"],
              ["mentions", "Mentions"],
              ["staff", "Staff"]
            ] as Array<[ChatFilterMode, string]>
          ).map(([mode, label]) => (
            <button
              className={`filter-pill ${filterMode === mode ? "is-active" : ""}`.trim()}
              key={mode}
              onClick={() => setFilterMode(mode)}
              type="button"
            >
              {label} <span>{filterCounts[mode]}</span>
            </button>
          ))}
        </div>
      </div>

      <div className="chat-scroll" onScroll={handleScroll} ref={scrollRef}>
        {filteredMessages.map(({ message, flags }) => {
          const roleBadgeLabel = getRoleBadgeLabel(message.authorRole);
          const rowClassName = [
            "chat-message",
            message.isOwn ? "is-own" : "",
            flags.isStaff ? "is-privileged" : "",
            flags.isMention ? "is-mention-match" : "",
            flags.isHighlighted ? "is-highlighted" : ""
          ]
            .filter(Boolean)
            .join(" ");

          return (
            <article className={rowClassName} key={message.id}>
              <div className="chat-meta">
                <span
                  className="author-swatch"
                  style={{ backgroundColor: message.accentColor ?? "#94a3b8" }}
                />
                <button
                  className="chat-author-button"
                  onClick={() => handleInsertMention(message.authorName)}
                  onMouseDown={(event) => event.preventDefault()}
                  type="button"
                >
                  {message.authorName}
                </button>
                {roleBadgeLabel ? (
                  <span className={`chat-role-badge is-${message.authorRole}`}>{roleBadgeLabel}</span>
                ) : null}
                {flags.isMention ? <span className="chat-flag-badge is-mention">Mention</span> : null}
              </div>
              <ChatMessageBody
                body={message.body}
                currentUsername={currentUsername}
                onMentionClick={canSend ? handleInsertMention : undefined}
              />
            </article>
          );
        })}

        {filteredMessages.length === 0 ? (
          <div className="chat-filter-empty">
            <strong>No messages match this filter yet.</strong>
            <span>Try switching back to `All`.</span>
          </div>
        ) : null}

        {!isAutoScrolling ? (
          <div className="chat-jump-strip">
            <button className="chat-jump-button" onClick={scrollToLatest} type="button">
              {unreadCount > 0 ? `Jump to latest · ${unreadCount} new` : "Jump to latest"}
            </button>
          </div>
        ) : null}
      </div>

      <form
        className="chat-composer"
        onSubmit={(event) => {
          event.preventDefault();
          onSend();
        }}
      >
        <textarea
          ref={textareaRef}
          value={composer}
          onChange={(event) => setComposer(event.target.value)}
          onKeyDown={handleComposerKeyDown}
          placeholder={
            canSend
              ? "Send a chat message"
              : "Composer disabled while upstream chat send is unavailable"
          }
          disabled={!canSend || sending}
          maxLength={500}
          rows={3}
        />
        <div className="composer-meta">
          <div className="composer-hints">
            <span className="hint-chip">Enter sends</span>
            <span className="hint-chip">Shift+Enter newline</span>
            <span className="hint-chip">Click a name to mention</span>
            <span className="hint-chip">Markdown: emphasis, strike, links</span>
          </div>
          <span
            className={`composer-counter ${remainingCharacters < 80 ? "is-warning" : ""}`.trim()}
          >
            {composer.length}/500
          </span>
        </div>
        <div className="composer-footer">
          <span>
            {flash ??
              (canSend
                ? "Floatplane markdown supported."
                : liveState?.chatCapability.canRead
                  ? "Live Floatplane chat is mirrored here in read-only mode."
                  : "Read-only fallback active.")}
          </span>
          <button className="accent-button" disabled={!canSend || sending} type="submit">
            {sending ? "Sending..." : "Send"}
          </button>
        </div>
      </form>
    </aside>
  );
}
