import type {
  ChatSendResult,
  SessionBootstrapRequest,
  SessionState,
  WanLiveState
} from "@shared";

async function parseResponse<T>(response: Response): Promise<T> {
  const payload = (await response.json()) as T;

  if (!response.ok) {
    throw payload;
  }

  return payload;
}

export async function getSessionState(): Promise<SessionState> {
  const response = await fetch("/session/state");
  return parseResponse<SessionState>(response);
}

export async function bootstrapSession(payload?: SessionBootstrapRequest): Promise<SessionState> {
  const response = await fetch("/session/bootstrap", {
    method: "POST",
    headers: {
      "Content-Type": "application/json"
    },
    body: JSON.stringify(payload ?? {})
  });

  return parseResponse<SessionState>(response);
}

export async function startManagedConnect(): Promise<SessionState> {
  const response = await fetch("/session/connect/start", {
    method: "POST"
  });

  return parseResponse<SessionState>(response);
}

export async function completeManagedConnect(): Promise<SessionState> {
  const response = await fetch("/session/connect/complete", {
    method: "POST"
  });

  return parseResponse<SessionState>(response);
}

export async function cancelManagedConnect(): Promise<SessionState> {
  const response = await fetch("/session/connect/cancel", {
    method: "POST"
  });

  return parseResponse<SessionState>(response);
}

export async function logoutSession(): Promise<SessionState> {
  const response = await fetch("/session/logout", {
    method: "POST"
  });

  return parseResponse<SessionState>(response);
}

export async function fetchWanLiveState(): Promise<WanLiveState> {
  const response = await fetch("/wan/live");
  return parseResponse<WanLiveState>(response);
}

export async function sendChatMessage(body: string): Promise<ChatSendResult> {
  const response = await fetch("/wan/chat/send", {
    method: "POST",
    headers: {
      "Content-Type": "application/json"
    },
    body: JSON.stringify({ body })
  });

  const payload = (await response.json()) as ChatSendResult;

  if (!response.ok && payload.status !== "rate_limited") {
    throw payload;
  }

  return payload;
}
