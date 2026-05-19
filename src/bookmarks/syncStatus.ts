import { browser } from "wxt/browser";

import type { SyncResult } from "./api";

export const SYNC_STATUS_STORAGE_KEY = "bookmarkSync.status";
export const SYNC_NOW_MESSAGE = "bookmarkSync.syncNow";

export interface BookmarkSyncStatus {
  state: "idle" | "syncing" | "synced" | "error";
  message: string;
  lastSyncedAt: number | null;
  result: SyncResult | null;
}

export interface BookmarkSyncNowMessage {
  type: typeof SYNC_NOW_MESSAGE;
}

export function isBookmarkSyncNowMessage(
  value: unknown,
): value is BookmarkSyncNowMessage {
  return (
    !!value &&
    typeof value === "object" &&
    (value as { type?: unknown }).type === SYNC_NOW_MESSAGE
  );
}

export async function readBookmarkSyncStatus(): Promise<BookmarkSyncStatus> {
  const stored = await browser.storage.local.get(SYNC_STATUS_STORAGE_KEY);
  const status = stored[SYNC_STATUS_STORAGE_KEY];

  return isBookmarkSyncStatus(status)
    ? status
    : {
        state: "idle",
        message: "Connect to start automatic sync.",
        lastSyncedAt: null,
        result: null,
      };
}

export async function writeBookmarkSyncStatus(
  status: BookmarkSyncStatus,
): Promise<void> {
  await browser.storage.local.set({ [SYNC_STATUS_STORAGE_KEY]: status });
}

export function isBookmarkSyncStatus(
  value: unknown,
): value is BookmarkSyncStatus {
  if (!value || typeof value !== "object") return false;

  const status = value as Partial<BookmarkSyncStatus>;
  return (
    (status.state === "idle" ||
      status.state === "syncing" ||
      status.state === "synced" ||
      status.state === "error") &&
    typeof status.message === "string"
  );
}
