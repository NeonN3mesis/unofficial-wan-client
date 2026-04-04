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
      style: "strong" | "emphasis" | "strike" | "code";
    };

const mentionPattern = /^@[a-z0-9_-]{4,20}$/i;
const linkPattern = /^(?:https?:\/\/|www\.)[^\s<]+/i;
const escapableCharacters = new Set(["\\", "*", "~", "`", "@", "[", "]", "(", ")"]);
const namedEntities: Record<string, string> = {
  amp: "&",
  lt: "<",
  gt: ">",
  quot: "\"",
  apos: "'",
  nbsp: " "
};
const inlineStyles = [
  { delimiter: "**", style: "strong" as const },
  { delimiter: "~~", style: "strike" as const },
  { delimiter: "`", style: "code" as const },
  { delimiter: "*", style: "emphasis" as const }
] as const;

function decodeHtmlEntities(input: string): string {
  return input.replace(/&(#x?[0-9a-f]+|[a-z]+);/gi, (match, entity: string) => {
    const normalized = entity.toLowerCase();

    if (normalized.startsWith("#x")) {
      const codePoint = Number.parseInt(normalized.slice(2), 16);
      return Number.isFinite(codePoint) ? String.fromCodePoint(codePoint) : match;
    }

    if (normalized.startsWith("#")) {
      const codePoint = Number.parseInt(normalized.slice(1), 10);
      return Number.isFinite(codePoint) ? String.fromCodePoint(codePoint) : match;
    }

    return namedEntities[normalized] ?? match;
  });
}

function isMentionBoundary(character?: string): boolean {
  return !character || !/[a-z0-9_@-]/i.test(character);
}

function isInlineBoundary(character?: string): boolean {
  return !character || !/[a-z0-9]/i.test(character);
}

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

function canOpenInlineStyle(input: string, index: number, delimiter: string): boolean {
  const previousCharacter = input[index - 1];
  const nextCharacter = input[index + delimiter.length];

  if (!nextCharacter || /\s/.test(nextCharacter)) {
    return false;
  }

  if (delimiter === "`") {
    return true;
  }

  return isInlineBoundary(previousCharacter);
}

function canCloseInlineStyle(
  input: string,
  index: number,
  delimiter: string,
  openingIndex: number
): boolean {
  const previousCharacter = input[index - 1];
  const nextCharacter = input[index + delimiter.length];
  const innerContent = input.slice(openingIndex + delimiter.length, index);

  if (!innerContent || /^\s|\s$/.test(innerContent) || innerContent.includes("\n")) {
    return false;
  }

  if (delimiter === "`") {
    return true;
  }

  if (!previousCharacter || /\s/.test(previousCharacter)) {
    return false;
  }

  return isInlineBoundary(nextCharacter);
}

function findClosingDelimiter(input: string, index: number, delimiter: string): number {
  let searchIndex = index + delimiter.length;

  while (searchIndex < input.length) {
    const matchIndex = input.indexOf(delimiter, searchIndex);

    if (matchIndex === -1) {
      return -1;
    }

    if (input[matchIndex - 1] === "\\") {
      searchIndex = matchIndex + delimiter.length;
      continue;
    }

    if (canCloseInlineStyle(input, matchIndex, delimiter, index)) {
      return matchIndex;
    }

    searchIndex = matchIndex + delimiter.length;
  }

  return -1;
}

function flushTextBuffer(tokens: ChatInlineToken[], buffer: string) {
  if (!buffer) {
    return "";
  }

  tokens.push({
    type: "text",
    content: buffer
  });
  return "";
}

export function isMentionCandidate(input: string): boolean {
  return mentionPattern.test(input);
}

export function parseChatTokens(input: string): ChatInlineToken[] {
  if (!input) {
    return [];
  }

  const normalizedInput = decodeHtmlEntities(input);
  const tokens: ChatInlineToken[] = [];
  let textBuffer = "";
  let cursor = 0;

  while (cursor < normalizedInput.length) {
    const currentCharacter = normalizedInput[cursor];

    if (
      currentCharacter === "\\" &&
      cursor + 1 < normalizedInput.length &&
      escapableCharacters.has(normalizedInput[cursor + 1])
    ) {
      textBuffer += normalizedInput[cursor + 1];
      cursor += 2;
      continue;
    }

    const linkMatch = normalizedInput.slice(cursor).match(linkPattern)?.[0];

    if (linkMatch) {
      textBuffer = flushTextBuffer(tokens, textBuffer);
      const normalizedLink = normalizeLinkMatch(linkMatch);

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

      cursor += linkMatch.length;
      continue;
    }

    if (currentCharacter === "@") {
      const usernameMatch = normalizedInput.slice(cursor + 1).match(/^[a-z0-9_-]{4,20}/i)?.[0];
      const previousCharacter = normalizedInput[cursor - 1];
      const nextCharacter = normalizedInput[cursor + 1 + (usernameMatch?.length ?? 0)];

      if (usernameMatch && isMentionBoundary(previousCharacter) && isMentionBoundary(nextCharacter)) {
        textBuffer = flushTextBuffer(tokens, textBuffer);
        tokens.push({
          type: "mention",
          content: `@${usernameMatch}`,
          username: usernameMatch
        });
        cursor += usernameMatch.length + 1;
        continue;
      }
    }

    const styleMatch = inlineStyles.find(({ delimiter }) => {
      return normalizedInput.startsWith(delimiter, cursor) && canOpenInlineStyle(normalizedInput, cursor, delimiter);
    });

    if (styleMatch) {
      const closingIndex = findClosingDelimiter(normalizedInput, cursor, styleMatch.delimiter);

      if (closingIndex !== -1) {
        textBuffer = flushTextBuffer(tokens, textBuffer);
        tokens.push({
          type: "styled",
          style: styleMatch.style,
          content: normalizedInput.slice(cursor + styleMatch.delimiter.length, closingIndex)
        });
        cursor = closingIndex + styleMatch.delimiter.length;
        continue;
      }
    }

    textBuffer += currentCharacter;
    cursor += 1;
  }

  flushTextBuffer(tokens, textBuffer);
  return tokens;
}
