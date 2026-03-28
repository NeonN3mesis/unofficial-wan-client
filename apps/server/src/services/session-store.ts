import fs from "node:fs/promises";
import path from "node:path";
import type { SessionBootstrapRequest, SessionState } from "../../../../packages/shared/src/index.js";
import { createSessionState } from "./normalize.js";

export interface StoredSessionRecord {
  state: SessionState;
  storageState?: SessionBootstrapRequest["storageState"];
  savedAt: string;
}

export class SessionStore {
  constructor(
    private readonly filePath: string,
    private readonly sessionTtlMs: number
  ) {}

  async load(): Promise<StoredSessionRecord | null> {
    try {
      const file = await fs.readFile(this.filePath, "utf8");
      return JSON.parse(file) as StoredSessionRecord;
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === "ENOENT") {
        return null;
      }

      throw error;
    }
  }

  async save(record: StoredSessionRecord): Promise<void> {
    await fs.mkdir(path.dirname(this.filePath), { recursive: true });
    await fs.writeFile(this.filePath, JSON.stringify(record, null, 2), { mode: 0o600 });
  }

  async clear(): Promise<void> {
    try {
      await fs.unlink(this.filePath);
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== "ENOENT") {
        throw error;
      }
    }
  }

  async currentState(): Promise<SessionState> {
    const record = await this.load();

    if (!record) {
      return createSessionState({
        status: "unauthenticated",
        mode: "fixture",
        hasPersistedSession: false,
        message: "No local Floatplane session artifacts are available yet."
      });
    }

    if (isStoredSessionExpired(record, this.sessionTtlMs)) {
      return createSessionState({
        status: "expired",
        mode: record.state.mode,
        upstreamMode: record.state.upstreamMode,
        hasPersistedSession: true,
        cookieCount: record.state.cookieCount,
        lastValidatedAt: record.state.lastValidatedAt,
        expiresAt: record.state.expiresAt,
        message: "The stored Floatplane session artifact expired. Bootstrap again to refresh it."
      });
    }

    return record.state;
  }
}

export function cookieCountFromStorageState(storageState?: SessionBootstrapRequest["storageState"]): number {
  return storageState?.cookies?.length ?? 0;
}

export function deriveExpiry(storageState: SessionBootstrapRequest["storageState"], sessionTtlMs: number): string {
  const maxCookieExpiry = storageState?.cookies
    ?.map(
      (
        cookie: NonNullable<NonNullable<SessionBootstrapRequest["storageState"]>["cookies"]>[number]
      ) => cookie.expires
    )
    .filter((value: number | undefined): value is number => typeof value === "number" && value > 0)
    .sort((left: number, right: number) => right - left)[0];

  if (maxCookieExpiry) {
    return new Date(maxCookieExpiry * 1000).toISOString();
  }

  return new Date(Date.now() + sessionTtlMs).toISOString();
}

export function isStoredSessionExpired(record: StoredSessionRecord, sessionTtlMs: number): boolean {
  const expiryTarget = record.state.expiresAt ?? new Date(Date.parse(record.savedAt) + sessionTtlMs).toISOString();
  return Date.parse(expiryTarget) <= Date.now();
}
