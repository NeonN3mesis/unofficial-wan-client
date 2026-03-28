import { EventEmitter } from "node:events";
import type { ChatMessage, ChatSendResult, ChatStreamEvent } from "../../../../packages/shared/src/index.js";

const syntheticAuthors: Array<Pick<ChatMessage, "authorName" | "authorRole" | "accentColor">> = [
  { authorName: "Circuit", authorRole: "member", accentColor: "#f97316" },
  { authorName: "Frame Drop", authorRole: "member", accentColor: "#0ea5e9" },
  { authorName: "Latency Watch", authorRole: "moderator", accentColor: "#10b981" }
];

const syntheticBodies = [
  "Relay check: chat snapshot stayed stable after the last reconnect.",
  "Playback handoff is the last missing upstream piece before this leaves fixture mode.",
  "Status banner copy is doing the right thing here: informative, not noisy.",
  "A dedicated WAN Show surface makes the second screen feel way more intentional."
];

export class FixtureChatService {
  private readonly emitter = new EventEmitter();
  private readonly messages: ChatMessage[];
  private intervalHandle?: NodeJS.Timeout;
  private lastSendAt = 0;
  private bodyCursor = 0;
  private authorCursor = 0;

  constructor(
    initialMessages: ChatMessage[],
    private readonly cadenceMs: number,
    private readonly sendEnabled: boolean
  ) {
    this.messages = [...initialMessages];
  }

  start(): void {
    if (this.intervalHandle) {
      return;
    }

    this.intervalHandle = setInterval(() => {
      this.pushSyntheticMessage();
    }, this.cadenceMs);

    this.intervalHandle.unref?.();
  }

  stop(): void {
    if (!this.intervalHandle) {
      return;
    }

    clearInterval(this.intervalHandle);
    this.intervalHandle = undefined;
  }

  list(): ChatMessage[] {
    return [...this.messages];
  }

  subscribe(listener: (event: ChatStreamEvent) => void): () => void {
    const handler = (event: ChatStreamEvent) => listener(event);
    this.emitter.on("event", handler);

    return () => {
      this.emitter.off("event", handler);
    };
  }

  send(body: string, isAuthenticated: boolean): ChatSendResult {
    if (!isAuthenticated) {
      return {
        status: "unauthenticated",
        message: "Bootstrap the Floatplane session before sending chat."
      };
    }

    if (!this.sendEnabled) {
      return {
        status: "unsupported",
        message: "Chat send is disabled in the current adapter mode."
      };
    }

    if (Date.now() - this.lastSendAt < 3500) {
      return {
        status: "rate_limited",
        message: "Fixture relay rate limit hit. Wait a moment before sending again.",
        retryAfterMs: 3500 - (Date.now() - this.lastSendAt)
      };
    }

    this.lastSendAt = Date.now();

    const message: ChatMessage = {
      id: `local-${Date.now()}`,
      body: body.trim(),
      authorName: "You",
      authorRole: "member",
      accentColor: "#facc15",
      sentAt: new Date().toISOString(),
      source: "user",
      isOwn: true
    };

    this.messages.push(message);
    this.emitter.emit("event", { type: "message", message } satisfies ChatStreamEvent);

    return {
      status: "sent",
      message
    };
  }

  private pushSyntheticMessage(): void {
    const author = syntheticAuthors[this.authorCursor % syntheticAuthors.length];
    const body = syntheticBodies[this.bodyCursor % syntheticBodies.length];
    this.authorCursor += 1;
    this.bodyCursor += 1;

    const message: ChatMessage = {
      id: `fixture-${Date.now()}`,
      body,
      authorName: author.authorName,
      authorRole: author.authorRole,
      accentColor: author.accentColor,
      sentAt: new Date().toISOString(),
      source: "relay"
    };

    this.messages.push(message);
    this.emitter.emit("event", { type: "message", message } satisfies ChatStreamEvent);
  }
}

