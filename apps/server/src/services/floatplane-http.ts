import fs from "node:fs/promises";
import type { SessionBootstrapRequest } from "../../../../packages/shared/src/index.js";
import { serverConfig } from "../config.js";
import type { StoredSessionRecord } from "./session-store.js";

interface FloatplaneFetchInit {
  method?: string;
  headers?: Record<string, string>;
  body?: string;
  accept?: string;
  signal?: AbortSignal;
}

export interface FloatplaneFetchedResource {
  status: number;
  contentType?: string;
  finalUrl: string;
  body: Buffer;
}

export interface FloatplaneStreamingResource {
  status: number;
  contentType?: string;
  finalUrl: string;
  headers: Headers;
  body: ReadableStream<Uint8Array> | null;
}

export interface FloatplaneFetchedJson<T> {
  status: number;
  ok: boolean;
  url: string;
  data: T;
}

export const FLOATPLANE_BROWSER_USER_AGENT =
  "Mozilla/5.0 (X11; Linux x86_64; rv:135.0) Gecko/20100101 Firefox/135.0";

function normalizeCookieDomain(domain: string): string {
  return domain.replace(/^\./, "").toLowerCase();
}

function hostnameMatchesCookie(hostname: string, domain: string): boolean {
  const normalizedHostname = hostname.toLowerCase();
  const normalizedDomain = normalizeCookieDomain(domain);
  return (
    normalizedHostname === normalizedDomain || normalizedHostname.endsWith(`.${normalizedDomain}`)
  );
}

function pathMatchesCookie(requestPathname: string, cookiePath?: string): boolean {
  const normalizedCookiePath = cookiePath?.trim() || "/";
  return requestPathname.startsWith(normalizedCookiePath);
}

function isCookieExpired(expires?: number): boolean {
  return typeof expires === "number" && expires > 0 && expires * 1000 <= Date.now();
}

function buildCookieHeader(
  storageState: SessionBootstrapRequest["storageState"] | null,
  url: URL
): string | undefined {
  const cookies =
    storageState?.cookies?.filter((cookie) => {
      if (!hostnameMatchesCookie(url.hostname, cookie.domain)) {
        return false;
      }

      if (!pathMatchesCookie(url.pathname, cookie.path)) {
        return false;
      }

      if (cookie.secure && url.protocol !== "https:") {
        return false;
      }

      if (isCookieExpired(cookie.expires)) {
        return false;
      }

      return true;
    }) ?? [];

  if (cookies.length === 0) {
    return undefined;
  }

  return cookies.map((cookie) => `${cookie.name}=${cookie.value}`).join("; ");
}

async function loadStorageStateFromSessionFile(): Promise<SessionBootstrapRequest["storageState"] | null> {
  try {
    const file = await fs.readFile(serverConfig.sessionFilePath, "utf8");
    const record = JSON.parse(file) as StoredSessionRecord;
    return record.storageState ?? null;
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") {
      return null;
    }

    throw error;
  }
}

async function loadStorageStateFromCaptureFile(): Promise<SessionBootstrapRequest["storageState"] | null> {
  try {
    const file = await fs.readFile(serverConfig.storageStateFilePath, "utf8");
    return JSON.parse(file) as SessionBootstrapRequest["storageState"];
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") {
      return null;
    }

    throw error;
  }
}

let activeStorageCache: SessionBootstrapRequest["storageState"] | null = null;
let activeStorageCacheTime = 0;

export async function loadActiveStorageState(): Promise<SessionBootstrapRequest["storageState"] | null> {
  const now = Date.now();
  if (activeStorageCache && now - activeStorageCacheTime < 10_000) {
    return activeStorageCache;
  }

  const stored = await loadStorageStateFromSessionFile();
  let result = null;

  if (stored?.cookies?.length) {
    result = stored;
  } else {
    result = await loadStorageStateFromCaptureFile();
  }

  activeStorageCache = result;
  activeStorageCacheTime = now;
  return result;
}

function buildHeaders(url: URL, cookieHeader?: string, accept?: string): HeadersInit {
  const headers = new Headers();
  headers.set("User-Agent", FLOATPLANE_BROWSER_USER_AGENT);
  headers.set("Accept-Language", "en-US,en;q=0.9");

  if (accept) {
    headers.set("Accept", accept);
  }

  if (cookieHeader) {
    headers.set("Cookie", cookieHeader);
  }

  if (hostnameMatchesCookie(url.hostname, "floatplane.com")) {
    headers.set("Origin", "https://www.floatplane.com");
    headers.set("Referer", serverConfig.wanLiveUrl);
  } else {
    headers.set("Referer", serverConfig.wanLiveUrl);
  }

  return headers;
}

async function fetchResponse(url: string, init?: FloatplaneFetchInit): Promise<Response> {
  const requestUrl = new URL(url);
  const storageState = await loadActiveStorageState();
  const cookieHeader = buildCookieHeader(storageState, requestUrl);
  const mergedHeaders = new Headers(buildHeaders(requestUrl, cookieHeader, init?.accept));

  for (const [name, value] of Object.entries(init?.headers ?? {})) {
    mergedHeaders.set(name, value);
  }

  const response = await fetch(requestUrl, {
    method: init?.method ?? "GET",
    headers: mergedHeaders,
    body: init?.body,
    signal: init?.signal
  });

  return response;
}

async function fetchBuffer(
  url: string,
  init?: FloatplaneFetchInit
): Promise<FloatplaneFetchedResource> {
  const response = await fetchResponse(url, init);

  return {
    status: response.status,
    contentType: response.headers.get("content-type") ?? undefined,
    finalUrl: response.url,
    body: Buffer.from(await response.arrayBuffer())
  };
}

export async function fetchFloatplaneStream(
  url: string,
  init?: FloatplaneFetchInit
): Promise<FloatplaneStreamingResource> {
  const response = await fetchResponse(url, init);

  return {
    status: response.status,
    contentType: response.headers.get("content-type") ?? undefined,
    finalUrl: response.url,
    headers: response.headers,
    body: response.body
  };
}

export async function fetchFloatplaneResource(
  url: string,
  init?: FloatplaneFetchInit
): Promise<FloatplaneFetchedResource> {
  return fetchBuffer(url, init);
}

export async function fetchFloatplaneJson<T>(
  url: string,
  init?: FloatplaneFetchInit
): Promise<FloatplaneFetchedJson<T>> {
  const fetched = await fetchBuffer(url, {
    ...init,
    accept: "application/json, text/plain, */*"
  });
  const text = fetched.body.toString("utf8");

  let data: unknown = null;

  try {
    data = JSON.parse(text);
  } catch {
    data = text;
  }

  return {
    status: fetched.status,
    ok: fetched.status >= 200 && fetched.status < 300,
    url: fetched.finalUrl,
    data: data as T
  };
}
