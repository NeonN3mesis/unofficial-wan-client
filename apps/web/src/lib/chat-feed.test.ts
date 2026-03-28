import { describe, expect, it } from "vitest";
import type { ChatMessage } from "@shared";
import {
  getChatMessageFlags,
  matchesChatFilter
} from "./chat-feed";

function createMessage(overrides: Partial<ChatMessage> = {}): ChatMessage {
  return {
    id: "message-1",
    body: "hello world",
    authorName: "Circuit",
    authorRole: "member",
    sentAt: "2026-03-28T00:00:00.000Z",
    source: "relay",
    ...overrides
  };
}

describe("chat feed helpers", () => {
  it("flags staff and mentions", () => {
    const staffFlags = getChatMessageFlags(createMessage({ authorRole: "admin" }), "scott");
    const mentionFlags = getChatMessageFlags(createMessage({ body: "hey @Scott check this out" }), "scott");

    expect(staffFlags.isStaff).toBe(true);
    expect(staffFlags.isHighlighted).toBe(true);
    expect(mentionFlags.isMention).toBe(true);
  });

  it("filters messages by mentions or staff", () => {
    const mentionMessage = createMessage({ body: "hey @scott" });
    const staffMessage = createMessage({ id: "staff", authorRole: "moderator" });
    const plainMessage = createMessage({ id: "plain", body: "regular message" });

    expect(matchesChatFilter(mentionMessage, "mentions", "scott")).toBe(true);
    expect(matchesChatFilter(staffMessage, "staff", "scott")).toBe(true);
    expect(matchesChatFilter(plainMessage, "staff", "scott")).toBe(false);
  });
});
