import { describe, expect, it } from "vitest";
import { isMentionCandidate, parseChatTokens } from "./chat-format";

describe("chat-format", () => {
  it("parses official-style mentions while preserving surrounding text", () => {
    expect(parseChatTokens("hello @linus and welcome")).toEqual([
      { type: "text", content: "hello" },
      { type: "text", content: " " },
      { type: "mention", content: "@linus", username: "linus" },
      { type: "text", content: " and welcome" }
    ]);
  });

  it("tokenizes emphasis, strong text, strikethrough, and linkified urls", () => {
    expect(parseChatTokens("use **bold** and *italics* plus ~~strike~~ https://floatplane.com.")).toEqual([
      { type: "text", content: "use " },
      { type: "styled", style: "strong", content: "bold" },
      { type: "text", content: " and " },
      { type: "styled", style: "emphasis", content: "italics" },
      { type: "text", content: " plus " },
      { type: "styled", style: "strike", content: "strike" },
      { type: "text", content: " " },
      { type: "link", content: "https://floatplane.com", href: "https://floatplane.com" },
      { type: "text", content: "." }
    ]);
  });

  it("accepts valid Floatplane mention names and rejects emails", () => {
    expect(isMentionCandidate("@float_user")).toBe(true);
    expect(isMentionCandidate("@abc")).toBe(false);
    expect(isMentionCandidate("name@example.com")).toBe(false);
  });
});
