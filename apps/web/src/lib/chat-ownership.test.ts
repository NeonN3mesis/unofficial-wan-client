import { describe, expect, it } from "vitest";
import type { ChatMessage } from "@shared";
import {
  markMessagesFromAuthor,
  mergeMessages,
  reconcileIncomingMessages
} from "./chat-ownership";

function createMessage(overrides: Partial<ChatMessage> = {}): ChatMessage {
  return {
    id: "message-1",
    body: "hello",
    authorName: "FloatplaneUser",
    authorRole: "member",
    sentAt: "2026-03-28T00:00:00.000Z",
    source: "relay",
    ...overrides
  };
}

describe("chat ownership helpers", () => {
  it("preserves own-message state when a relay snapshot repeats the same message id", () => {
    const merged = mergeMessages(
      [createMessage({ isOwn: true })],
      [createMessage({ source: "relay" })]
    );

    expect(merged).toHaveLength(1);
    expect(merged[0].isOwn).toBe(true);
  });

  it("marks messages from the backend-provided Floatplane username as own messages", () => {
    const messages = markMessagesFromAuthor(
      [
        createMessage({ id: "own", authorName: "Scott" }),
        createMessage({ id: "other", authorName: "Rina" })
      ],
      "scott"
    );

    expect(messages.find((message) => message.id === "own")?.isOwn).toBe(true);
    expect(messages.find((message) => message.id === "other")?.isOwn).toBeUndefined();
  });

  it("replaces a provisional own message when the relay echo arrives", () => {
    const reconciliation = reconcileIncomingMessages(
      [
        createMessage({
          id: "local-1",
          body: "same body",
          source: "user",
          isOwn: true
        })
      ],
      [
        createMessage({
          id: "relay-1",
          body: "same body",
          authorName: "Scott"
        })
      ],
      [{ body: "same body", createdAt: Date.parse("2026-03-28T00:00:00.000Z") }],
      Date.parse("2026-03-28T00:00:01.000Z")
    );

    expect(reconciliation.pending).toHaveLength(0);
    expect(reconciliation.messages).toHaveLength(1);
    expect(reconciliation.messages[0]).toMatchObject({
      id: "relay-1",
      source: "relay",
      isOwn: true
    });
  });
});
