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

async function buildRequestHeaders(init?: HeadersInit): Promise<Headers> {
  const headers = new Headers(init);

  if (window.desktopBridge?.getApiHeaders) {
    const desktopHeaders = await window.desktopBridge.getApiHeaders();

    for (const [name, value] of Object.entries(desktopHeaders)) {
      headers.set(name, value);
    }
  }

  return headers;
}

async function authorizedFetch(input: RequestInfo | URL, init?: RequestInit): Promise<Response> {
  return fetch(input, {
    ...init,
    headers: await buildRequestHeaders(init?.headers)
  });
}

export async function getSessionState(): Promise<SessionState> {
  const response = await authorizedFetch("/session/state");
  return parseResponse<SessionState>(response);
}

export async function bootstrapSession(payload?: SessionBootstrapRequest): Promise<SessionState> {
  const response = await authorizedFetch("/session/bootstrap", {
    method: "POST",
    headers: {
      "Content-Type": "application/json"
    },
    body: JSON.stringify(payload ?? {})
  });

  return parseResponse<SessionState>(response);
}

export async function startManagedConnect(): Promise<SessionState> {
  const response = await authorizedFetch("/session/connect/start", {
    method: "POST"
  });

  return parseResponse<SessionState>(response);
}

export async function completeManagedConnect(): Promise<SessionState> {
  const response = await authorizedFetch("/session/connect/complete", {
    method: "POST"
  });

  return parseResponse<SessionState>(response);
}

export async function cancelManagedConnect(): Promise<SessionState> {
  const response = await authorizedFetch("/session/connect/cancel", {
    method: "POST"
  });

  return parseResponse<SessionState>(response);
}

export async function logoutSession(): Promise<SessionState> {
  const response = await authorizedFetch("/session/logout", {
    method: "POST"
  });

  return parseResponse<SessionState>(response);
}

export async function fetchWanLiveState(): Promise<WanLiveState> {
  const response = await authorizedFetch("/wan/live");
  return parseResponse<WanLiveState>(response);
}

export async function sendChatMessage(body: string): Promise<ChatSendResult> {
  const response = await authorizedFetch("/wan/chat/send", {
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
