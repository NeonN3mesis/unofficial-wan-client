import { describe, expect, it } from "vitest";
import { isMentionCandidate, parseChatTokens } from "./chat-format";

describe("chat-format", () => {
  it("parses official-style mentions while preserving surrounding text", () => {
    expect(parseChatTokens("hello @linus and welcome")).toEqual([
      { type: "text", content: "hello " },
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

  it("preserves escaped markdown markers and ordinary special-character text", () => {
    expect(parseChatTokens(String.raw`show \*literal asterisks\* and file_name.txt`)).toEqual([
      { type: "text", content: "show *literal asterisks* and file_name.txt" }
    ]);
  });

  it("renders inline code without eating surrounding punctuation", () => {
    expect(parseChatTokens("run `npm test` -> done")).toEqual([
      { type: "text", content: "run " },
      { type: "styled", style: "code", content: "npm test" },
      { type: "text", content: " -> done" }
    ]);
  });

  it("decodes common html entities before tokenizing chat text", () => {
    expect(parseChatTokens("&lt;--- Australian &amp; chat &#128512;")).toEqual([
      { type: "text", content: "<--- Australian & chat 😀" }
    ]);
  });

  it("accepts valid Floatplane mention names and rejects emails", () => {
    expect(isMentionCandidate("@float_user")).toBe(true);
    expect(isMentionCandidate("@abc")).toBe(false);
    expect(isMentionCandidate("name@example.com")).toBe(false);
  });
});
