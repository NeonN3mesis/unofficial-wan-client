import type { ChatMessage } from "@shared";
import { parseChatTokens } from "./chat-format";

export type ChatFilterMode = "all" | "mentions" | "staff";

export interface ChatMessageFlags {
  isStaff: boolean;
  isMention: boolean;
  isHighlighted: boolean;
}

const privilegedRoles = new Set<ChatMessage["authorRole"]>([
  "host",
  "admin",
  "moderator",
  "system"
]);

export function getChatMessageFlags(
  message: ChatMessage,
  currentUsername: string | null
): ChatMessageFlags {
  const normalizedCurrentUsername = currentUsername?.trim().toLowerCase() ?? null;
  const isMention = normalizedCurrentUsername
    ? parseChatTokens(message.body).some(
        (token) =>
          token.type === "mention" &&
          token.username.trim().toLowerCase() === normalizedCurrentUsername
      )
    : false;
  const isStaff = privilegedRoles.has(message.authorRole);

  return {
    isStaff,
    isMention,
    isHighlighted: isStaff || isMention
  };
}

export function matchesChatFilter(
  message: ChatMessage,
  filterMode: ChatFilterMode,
  currentUsername: string | null
): boolean {
  if (filterMode === "all") {
    return true;
  }

  const flags = getChatMessageFlags(message, currentUsername);

  if (filterMode === "mentions") {
    return flags.isMention;
  }

  return flags.isStaff;
}
