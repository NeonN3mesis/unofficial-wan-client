export type ChatInlineToken =
  | {
      type: "text";
      content: string;
    }
  | {
      type: "mention";
      content: string;
      username: string;
    }
  | {
      type: "link";
      content: string;
      href: string;
    }
  | {
      type: "styled";
      content: string;
      style: "strong" | "emphasis" | "strike";
    };

const mentionPattern = /(?:^|[^@a-z0-9_-])(@[a-z0-9_-]{4,20})(?=$|[^@a-z0-9_-])/i;
const inlineBoundaryPattern = /(^|[^@a-z0-9_-])(@[a-z0-9_-]{4,20})(?=$|[^@a-z0-9_-])/gi;
const linkPattern = /(?:https?:\/\/|www\.)[^\s<]+/gi;
const inlineMarkdownPattern = /(\*\*[^*\n]+\*\*|__[^_\n]+__|~~[^~\n]+~~|\*[^*\n]+\*|_[^_\n]+_)/g;

function normalizeLinkMatch(rawMatch: string): {
  href: string;
  content: string;
  trailingText: string;
} {
  const trimmed = rawMatch.match(/^(.*?)([),.!?;:]*)$/);
  const content = trimmed?.[1] || rawMatch;
  const trailingText = trimmed?.[2] || "";
  const href = content.startsWith("www.") ? `https://${content}` : content;

  return {
    href,
    content,
    trailingText
  };
}

function findNextMatch(input: string, fromIndex: number): {
  type: "link" | "mention";
  index: number;
  raw: string;
  prefix?: string;
  mention?: string;
} | null {
  const nextText = input.slice(fromIndex);

  linkPattern.lastIndex = 0;
  inlineBoundaryPattern.lastIndex = 0;

  const nextLink = linkPattern.exec(nextText);
  const nextMention = inlineBoundaryPattern.exec(nextText);

  const candidates = [
    nextLink
      ? {
          type: "link" as const,
          index: fromIndex + nextLink.index,
          raw: nextLink[0]
        }
      : null,
    nextMention
      ? {
          type: "mention" as const,
          index: fromIndex + nextMention.index,
          raw: nextMention[0],
          prefix: nextMention[1] ?? "",
          mention: nextMention[2] ?? ""
        }
      : null
  ].filter(Boolean);

  if (candidates.length === 0) {
    return null;
  }

  candidates.sort((left, right) => {
    return left!.index - right!.index;
  });

  return candidates[0] ?? null;
}

function tokenizeMarkdown(input: string): ChatInlineToken[] {
  if (!input) {
    return [];
  }

  const tokens: ChatInlineToken[] = [];
  let cursor = 0;
  inlineMarkdownPattern.lastIndex = 0;

  for (const match of input.matchAll(inlineMarkdownPattern)) {
    const index = match.index ?? 0;
    const value = match[0];

    if (index > cursor) {
      tokens.push({
        type: "text",
        content: input.slice(cursor, index)
      });
    }

    const innerContent = value.slice(2, -2);

    if (value.startsWith("**") || value.startsWith("__")) {
      tokens.push({
        type: "styled",
        style: "strong",
        content: innerContent
      });
    } else if (value.startsWith("~~")) {
      tokens.push({
        type: "styled",
        style: "strike",
        content: innerContent
      });
    } else {
      tokens.push({
        type: "styled",
        style: "emphasis",
        content: value.slice(1, -1)
      });
    }

    cursor = index + value.length;
  }

  if (cursor < input.length) {
    tokens.push({
      type: "text",
      content: input.slice(cursor)
    });
  }

  return tokens;
}

export function isMentionCandidate(input: string): boolean {
  return mentionPattern.test(input);
}

export function parseChatTokens(input: string): ChatInlineToken[] {
  if (!input) {
    return [];
  }

  const tokens: ChatInlineToken[] = [];
  let cursor = 0;

  while (cursor < input.length) {
    const nextMatch = findNextMatch(input, cursor);

    if (!nextMatch) {
      tokens.push(...tokenizeMarkdown(input.slice(cursor)));
      break;
    }

    if (nextMatch.index > cursor) {
      tokens.push(...tokenizeMarkdown(input.slice(cursor, nextMatch.index)));
    }

    if (nextMatch.type === "link") {
      const normalizedLink = normalizeLinkMatch(nextMatch.raw);

      tokens.push({
        type: "link",
        content: normalizedLink.content,
        href: normalizedLink.href
      });

      if (normalizedLink.trailingText) {
        tokens.push({
          type: "text",
          content: normalizedLink.trailingText
        });
      }
    } else {
      if (nextMatch.prefix) {
        tokens.push(...tokenizeMarkdown(nextMatch.prefix));
      }

      if (nextMatch.mention) {
        tokens.push({
          type: "mention",
          content: nextMatch.mention,
          username: nextMatch.mention.slice(1)
        });
      }
    }

    cursor = nextMatch.index + nextMatch.raw.length;
  }

  return tokens;
}
