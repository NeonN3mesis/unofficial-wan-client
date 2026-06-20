import type { ChatMessage } from "@shared";

export interface PendingOwnMessage {
  body: string;
  createdAt: number;
}

export function normalizeChatBody(body: string): string {
  return body.trim();
}

function normalizeUsername(username: string | null | undefined): string | null {
  const trimmed = username?.trim();
  return trimmed ? trimmed.toLocaleLowerCase() : null;
}

export function mergeMessages(current: ChatMessage[], next: ChatMessage[]): ChatMessage[] {
  const byId = new Map<string, ChatMessage>();

  [...current, ...next].forEach((message) => {
    const existing = byId.get(message.id);

    if (!existing) {
      byId.set(message.id, message);
      return;
    }

    byId.set(message.id, {
      ...existing,
      ...message,
      isOwn: existing.isOwn || message.isOwn ? true : undefined
    });
  });

  return [...byId.values()].sort((left, right) => Date.parse(left.sentAt) - Date.parse(right.sentAt));
}

export function markMessagesFromAuthor(
  messages: ChatMessage[],
  ownUsername: string | null
): ChatMessage[] {
  const normalizedOwnUsername = normalizeUsername(ownUsername);

  if (!normalizedOwnUsername) {
    return messages;
  }

  return messages.map((message) =>
    normalizeUsername(message.authorName) === normalizedOwnUsername
      ? { ...message, isOwn: true }
      : message
  );
}

export function matchPendingOwnMessage(
  message: ChatMessage,
  pending: PendingOwnMessage[],
  now = Date.now(),
  ttlMs = 120_000
): {
  matched: boolean;
  message: ChatMessage;
  pending: PendingOwnMessage[];
} {
  const activePending = pending.filter((candidate) => now - candidate.createdAt <= ttlMs);
  const body = normalizeChatBody(message.body);
  const matchIndex = activePending.findIndex((candidate) => candidate.body === body);

  if (matchIndex < 0) {
    return {
      matched: false,
      message,
      pending: activePending
    };
  }

  return {
    matched: true,
    message: {
      ...message,
      isOwn: true
    },
      pending: activePending.filter((_candidate, index) => index !== matchIndex)
  };
}

export function reconcileIncomingMessages(
  current: ChatMessage[],
  incoming: ChatMessage[],
  pending: PendingOwnMessage[],
  now = Date.now(),
  ttlMs = 120_000
): {
  messages: ChatMessage[];
  incomingMessages: ChatMessage[];
  pending: PendingOwnMessage[];
} {
  let nextPending = pending.filter((candidate) => now - candidate.createdAt <= ttlMs);
  const matchedBodies = new Map<string, number>();
  const nextIncoming = incoming.map((message) => {
    const matched = matchPendingOwnMessage(message, nextPending, now, ttlMs);
    nextPending = matched.pending;

    if (matched.matched) {
      const normalizedBody = normalizeChatBody(message.body);
      matchedBodies.set(normalizedBody, (matchedBodies.get(normalizedBody) ?? 0) + 1);
    }

    return matched.message;
  });

  const nextCurrent =
    matchedBodies.size === 0
      ? current
      : current.filter((message) => {
          if (message.source !== "user" || !message.isOwn) {
            return true;
          }

          const normalizedBody = normalizeChatBody(message.body);
          const remainingMatches = matchedBodies.get(normalizedBody) ?? 0;

          if (remainingMatches === 0) {
            return true;
          }

          const sentAt = Date.parse(message.sentAt);
          const isRecentLocalMessage = !Number.isFinite(sentAt) || now - sentAt <= ttlMs;

          if (!isRecentLocalMessage) {
            return true;
          }

          matchedBodies.set(normalizedBody, remainingMatches - 1);
          return false;
        });

  return {
    messages: mergeMessages(nextCurrent, nextIncoming),
    incomingMessages: nextIncoming,
    pending: nextPending
  };
}
