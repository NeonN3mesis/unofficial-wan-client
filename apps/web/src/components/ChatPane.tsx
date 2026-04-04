import { useEffect, useLayoutEffect, useMemo, useRef, useState, type KeyboardEvent } from "react";
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
const COMPOSER_MARKDOWN_ACTIONS = [
  { label: "Bold", shortLabel: "B", type: "wrap" as const, prefix: "**", suffix: "**", placeholder: "bold text" },
  { label: "Italic", shortLabel: "I", type: "wrap" as const, prefix: "*", suffix: "*", placeholder: "italic text" },
  { label: "Strike", shortLabel: "S", type: "wrap" as const, prefix: "~~", suffix: "~~", placeholder: "struck text" },
  { label: "Code", shortLabel: "</>", type: "wrap" as const, prefix: "`", suffix: "`", placeholder: "inline code" },
  { label: "Link", shortLabel: "Link", type: "link" as const },
  { label: "Quote", shortLabel: ">", type: "line-prefix" as const, prefix: "> ", placeholder: "quoted text" },
  { label: "List", shortLabel: "•", type: "line-prefix" as const, prefix: "- ", placeholder: "list item" }
] as const;
const EMOJI_GROUPS = [
  {
    id: "faces",
    label: "Faces",
    icon: "😀",
    emojis: ["😀", "😁", "😂", "🤣", "😅", "😊", "🙂", "😉", "😍", "😘", "😎", "🤔", "😬", "😭", "😡", "🤯", "😴", "🙃", "😇", "🤩"]
  },
  {
    id: "hands",
    label: "Hands",
    icon: "👍",
    emojis: ["👍", "👎", "👏", "🙌", "👋", "🤝", "🙏", "✌️", "🤞", "🤘", "👌", "💪", "👈", "👉", "☝️", "👇", "👀", "💬"]
  },
  {
    id: "hearts",
    label: "Hearts",
    icon: "❤️",
    emojis: ["❤️", "🧡", "💛", "💚", "💙", "💜", "🖤", "🤍", "🤎", "💔", "❣️", "💕", "💖", "💯", "🔥", "✨", "⭐", "⚡"]
  },
  {
    id: "extras",
    label: "Extras",
    icon: "🎉",
    emojis: ["🎉", "🚀", "✅", "❌", "⚠️", "📌", "🔔", "🎵", "📺", "🎮", "🍿", "☕", "🍺", "🐧", "💻", "🧠", "🌙", "☀️"]
  }
] as const;
type EmojiGroupId = (typeof EMOJI_GROUPS)[number]["id"];

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

function getAuthorSwatchDataUrl(color: string | null | undefined): string {
  const normalized = /^#[0-9a-f]{6}$/i.test(color ?? "") ? color! : "#94a3b8";
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="12" height="12" viewBox="0 0 12 12"><circle cx="6" cy="6" r="6" fill="${normalized}"/></svg>`;
  return `data:image/svg+xml;utf8,${encodeURIComponent(svg)}`;
}

function getComposerRows(value: string): number {
  const estimatedRows = value
    .split("\n")
    .reduce((count, line) => count + Math.max(1, Math.ceil(line.length / 42)), 0);

  return Math.min(6, Math.max(2, estimatedRows));
}

function clampSelectionRange(value: string, start: number, end: number) {
  return {
    start: Math.max(0, Math.min(start, value.length)),
    end: Math.max(0, Math.min(end, value.length))
  };
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
  const emojiPickerPanelRef = useRef<HTMLDivElement | null>(null);
  const emojiPickerButtonRef = useRef<HTMLButtonElement | null>(null);
  const previousSendingRef = useRef(sending);
  const restoreComposerFocusRef = useRef(false);
  const stickToBottomRef = useRef(true);
  const lastMessageCountRef = useRef(0);
  const [isAutoScrolling, setIsAutoScrolling] = useState(true);
  const [unreadCount, setUnreadCount] = useState(0);
  const [showEmojiPicker, setShowEmojiPicker] = useState(false);
  const [activeEmojiGroup, setActiveEmojiGroup] = useState<EmojiGroupId>("faces");
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
    if (canSend || !showEmojiPicker) {
      return;
    }

    setShowEmojiPicker(false);
  }, [canSend, showEmojiPicker]);

  useEffect(() => {
    if (!showEmojiPicker) {
      return;
    }

    function handlePointerDown(event: PointerEvent) {
      const target = event.target as Node | null;

      if (
        (emojiPickerPanelRef.current && target && emojiPickerPanelRef.current.contains(target)) ||
        (emojiPickerButtonRef.current && target && emojiPickerButtonRef.current.contains(target))
      ) {
        return;
      }

      setShowEmojiPicker(false);
    }

    function handleKeyDown(event: globalThis.KeyboardEvent) {
      if (event.key !== "Escape") {
        return;
      }

      setShowEmojiPicker(false);
      emojiPickerButtonRef.current?.focus();
    }

    document.addEventListener("pointerdown", handlePointerDown);
    document.addEventListener("keydown", handleKeyDown);

    return () => {
      document.removeEventListener("pointerdown", handlePointerDown);
      document.removeEventListener("keydown", handleKeyDown);
    };
  }, [showEmojiPicker]);

  useEffect(() => {
    const wasSending = previousSendingRef.current;
    previousSendingRef.current = sending;

    if (!wasSending || sending || !restoreComposerFocusRef.current || !canSend) {
      return;
    }

    restoreComposerFocusRef.current = false;

    window.requestAnimationFrame(() => {
      const textarea = textareaRef.current;

      if (!textarea) {
        return;
      }

      const cursorPosition = composer.length;
      textarea.focus();
      textarea.selectionStart = cursorPosition;
      textarea.selectionEnd = cursorPosition;
    });
  }, [canSend, composer.length, sending]);

  useLayoutEffect(() => {
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

  function insertEmoji(unicode: string) {
    if (!canSend) {
      return;
    }

    const textarea = textareaRef.current;
    const start = textarea ? Math.min(textarea.selectionStart, textarea.selectionEnd) : composer.length;
    const end = textarea ? Math.max(textarea.selectionStart, textarea.selectionEnd) : composer.length;
    const nextComposer = `${composer.slice(0, start)}${unicode}${composer.slice(end)}`;
    const nextCursorPosition = start + unicode.length;

    commitComposerEdit(nextComposer, nextCursorPosition);
  }

  function commitComposerEdit(nextComposer: string, selectionStart: number, selectionEnd = selectionStart) {
    setComposer(nextComposer);

    window.requestAnimationFrame(() => {
      const nextTextarea = textareaRef.current;

      if (!nextTextarea) {
        return;
      }

      const nextRange = clampSelectionRange(nextComposer, selectionStart, selectionEnd);
      nextTextarea.focus();
      nextTextarea.selectionStart = nextRange.start;
      nextTextarea.selectionEnd = nextRange.end;
    });
  }

  function wrapComposerSelection(
    prefix: string,
    suffix: string,
    placeholder: string
  ) {
    if (!canSend) {
      return;
    }

    const textarea = textareaRef.current;
    const start = textarea ? Math.min(textarea.selectionStart, textarea.selectionEnd) : composer.length;
    const end = textarea ? Math.max(textarea.selectionStart, textarea.selectionEnd) : composer.length;
    const selectedText = composer.slice(start, end);
    const innerText = selectedText || placeholder;
    const nextComposer = `${composer.slice(0, start)}${prefix}${innerText}${suffix}${composer.slice(end)}`;
    const innerStart = start + prefix.length;
    const innerEnd = innerStart + innerText.length;

    commitComposerEdit(nextComposer, innerStart, innerEnd);
  }

  function insertComposerLinePrefix(prefix: string, placeholder: string) {
    if (!canSend) {
      return;
    }

    const textarea = textareaRef.current;
    const start = textarea ? Math.min(textarea.selectionStart, textarea.selectionEnd) : composer.length;
    const end = textarea ? Math.max(textarea.selectionStart, textarea.selectionEnd) : composer.length;
    const rawSelection = composer.slice(start, end);
    const selectedText = rawSelection || placeholder;
    const lines = selectedText.split("\n");
    const prefixedText = lines.map((line) => `${prefix}${line || placeholder}`).join("\n");
    const nextComposer = `${composer.slice(0, start)}${prefixedText}${composer.slice(end)}`;

    commitComposerEdit(nextComposer, start, start + prefixedText.length);
  }

  function insertComposerLink() {
    if (!canSend) {
      return;
    }

    const textarea = textareaRef.current;
    const start = textarea ? Math.min(textarea.selectionStart, textarea.selectionEnd) : composer.length;
    const end = textarea ? Math.max(textarea.selectionStart, textarea.selectionEnd) : composer.length;
    const selectedText = composer.slice(start, end) || "link text";
    const template = `[${selectedText}](https://)`;
    const nextComposer = `${composer.slice(0, start)}${template}${composer.slice(end)}`;
    const urlStart = start + selectedText.length + 3;
    const urlEnd = urlStart + "https://".length;

    commitComposerEdit(nextComposer, urlStart, urlEnd);
  }

  function handleComposerMarkdownAction(
    action: (typeof COMPOSER_MARKDOWN_ACTIONS)[number]
  ) {
    if (action.type === "wrap") {
      wrapComposerSelection(action.prefix, action.suffix, action.placeholder);
      return;
    }

    if (action.type === "line-prefix") {
      insertComposerLinePrefix(action.prefix, action.placeholder);
      return;
    }

    insertComposerLink();
  }

  function handleInsertMention(username: string) {
    if (!isMentionCandidate(`@${username}`)) {
      return;
    }

    insertComposerText(`@${username}`);
  }

  function handleToggleEmojiPicker() {
    if (!canSend || sending) {
      return;
    }

    setShowEmojiPicker((current) => !current);
  }

  function requestSend() {
    if (!canSend || sending) {
      return;
    }

    restoreComposerFocusRef.current = true;
    onSend();
  }

  function handleComposerKeyDown(event: KeyboardEvent<HTMLTextAreaElement>) {
    if ((event.metaKey || event.ctrlKey) && !event.altKey) {
      const key = event.key.toLowerCase();

      if (key === "b") {
        event.preventDefault();
        wrapComposerSelection("**", "**", "bold text");
        return;
      }

      if (key === "i") {
        event.preventDefault();
        wrapComposerSelection("*", "*", "italic text");
        return;
      }

      if (key === "k") {
        event.preventDefault();
        insertComposerLink();
        return;
      }

      if (event.shiftKey && key === "s") {
        event.preventDefault();
        wrapComposerSelection("~~", "~~", "struck text");
        return;
      }
    }

    if (event.key !== "Enter" || event.shiftKey || event.nativeEvent.isComposing) {
      return;
    }

    event.preventDefault();
    requestSend();
  }

  const composerRows = getComposerRows(composer);

  const activeEmojiGroupDefinition =
    EMOJI_GROUPS.find((group) => group.id === activeEmojiGroup) ?? EMOJI_GROUPS[0];

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
                <img
                  alt=""
                  aria-hidden="true"
                  className="author-swatch"
                  src={getAuthorSwatchDataUrl(message.accentColor)}
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
          requestSend();
        }}
      >
        <div className="composer-toolbar-shell">
          <div className="composer-toolbar" aria-label="Markdown formatting tools">
            <button
              aria-expanded={showEmojiPicker}
              aria-haspopup="dialog"
              className={`composer-tool-button composer-emoji-toggle ${showEmojiPicker ? "is-open" : ""}`.trim()}
              disabled={!canSend || sending}
              onClick={handleToggleEmojiPicker}
              ref={emojiPickerButtonRef}
              type="button"
            >
              <span className="composer-tool-button-label">😊</span>
              <span className="composer-tool-button-title">Emoji</span>
            </button>
            {COMPOSER_MARKDOWN_ACTIONS.map((action) => (
              <button
                className="composer-tool-button"
                disabled={!canSend || sending}
                key={action.label}
                onClick={() => handleComposerMarkdownAction(action)}
                type="button"
              >
                <span className="composer-tool-button-label">{action.shortLabel}</span>
                <span className="composer-tool-button-title">{action.label}</span>
              </button>
            ))}
          </div>
          {showEmojiPicker ? (
            <div
              className="composer-emoji-popover"
              ref={emojiPickerPanelRef}
              role="dialog"
              aria-label="Emoji picker"
            >
              <div className="composer-emoji-tabs" role="tablist" aria-label="Emoji categories">
                {EMOJI_GROUPS.map((group) => (
                  <button
                    aria-selected={group.id === activeEmojiGroup}
                    className={`composer-emoji-tab ${group.id === activeEmojiGroup ? "is-active" : ""}`.trim()}
                    key={group.id}
                    onClick={() => setActiveEmojiGroup(group.id)}
                    role="tab"
                    type="button"
                  >
                    <span className="composer-emoji-tab-icon" aria-hidden="true">
                      {group.icon}
                    </span>
                    <span>{group.label}</span>
                  </button>
                ))}
              </div>
              <div className="composer-emoji-grid" role="list" aria-label={activeEmojiGroupDefinition.label}>
                {activeEmojiGroupDefinition.emojis.map((emoji) => (
                  <button
                    className="composer-emoji-button"
                    key={`${activeEmojiGroupDefinition.id}-${emoji}`}
                    onClick={() => {
                      insertEmoji(emoji);
                      setShowEmojiPicker(false);
                    }}
                    role="listitem"
                    type="button"
                  >
                    {emoji}
                  </button>
                ))}
              </div>
            </div>
          ) : null}
        </div>
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
          rows={composerRows}
        />
        <div className="composer-meta">
          <div className="composer-hints">
            <span className="hint-chip">Enter sends</span>
            <span className="hint-chip">Shift+Enter newline</span>
            <span className="hint-chip">Click a name to mention</span>
            <span className="hint-chip">Emoji picker</span>
            <span className="hint-chip">Ctrl/Cmd+B bold</span>
            <span className="hint-chip">Ctrl/Cmd+I italics</span>
            <span className="hint-chip">Ctrl/Cmd+K link</span>
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
