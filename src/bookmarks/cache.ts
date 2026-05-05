import { browser } from "wxt/browser";

import { createBookmarkSnapshot } from "./model";
import type {
  BookmarkCacheMessage,
  BookmarkCacheResponse,
  BookmarkSnapshot,
} from "./types";

const CACHE_STORAGE_KEY = "bookmarkGallery.snapshot";
const REFRESH_DEBOUNCE_MS = 250;

let cachedSnapshot: BookmarkSnapshot | null = null;
let refreshPromise: Promise<BookmarkSnapshot> | null = null;
let refreshTimer: ReturnType<typeof setTimeout> | undefined;
let importInProgress = false;

export function initializeBookmarkCache(): void {
  void getBookmarkSnapshot();
  registerBookmarkCacheInvalidators();
}

export async function handleBookmarkCacheMessage(
  message: BookmarkCacheMessage,
): Promise<BookmarkCacheResponse> {
  const snapshot =
    message.type === "bookmarkGallery.refreshSnapshot"
      ? await refreshBookmarkSnapshot()
      : await getBookmarkSnapshot();

  return { snapshot };
}

export function isBookmarkCacheMessage(
  message: unknown,
): message is BookmarkCacheMessage {
  if (!message || typeof message !== "object") {
    return false;
  }

  const type = (message as { type?: unknown }).type;
  return (
    type === "bookmarkGallery.getSnapshot" ||
    type === "bookmarkGallery.refreshSnapshot"
  );
}

export async function getBookmarkSnapshot(): Promise<BookmarkSnapshot> {
  if (cachedSnapshot) {
    return cachedSnapshot;
  }

  const storedSnapshot = await readStoredSnapshot();
  if (storedSnapshot) {
    cachedSnapshot = storedSnapshot;
    scheduleRefresh();
    return storedSnapshot;
  }

  return refreshBookmarkSnapshot();
}

export async function refreshBookmarkSnapshot(): Promise<BookmarkSnapshot> {
  if (refreshPromise) {
    return refreshPromise;
  }

  refreshPromise = browser.bookmarks
    .getTree()
    .then((tree) => createBookmarkSnapshot(tree))
    .then(async (snapshot) => {
      cachedSnapshot = snapshot;
      await storeSnapshot(snapshot);
      return snapshot;
    })
    .finally(() => {
      refreshPromise = null;
    });

  return refreshPromise;
}

function registerBookmarkCacheInvalidators(): void {
  browser.bookmarks.onImportBegan.addListener(() => {
    importInProgress = true;
  });
  browser.bookmarks.onImportEnded.addListener(() => {
    importInProgress = false;
    scheduleRefresh();
  });

  [
    browser.bookmarks.onCreated,
    browser.bookmarks.onChanged,
    browser.bookmarks.onChildrenReordered,
    browser.bookmarks.onMoved,
    browser.bookmarks.onRemoved,
  ].forEach((event) => event.addListener(refreshAfterBookmarkChange));
}

function refreshAfterBookmarkChange(): void {
  if (!importInProgress) scheduleRefresh();
}

function scheduleRefresh(): void {
  if (refreshTimer) {
    clearTimeout(refreshTimer);
  }

  refreshTimer = setTimeout(() => {
    refreshTimer = undefined;
    void refreshBookmarkSnapshot();
  }, REFRESH_DEBOUNCE_MS);
}

async function readStoredSnapshot(): Promise<BookmarkSnapshot | null> {
  try {
    const stored = await browser.storage.local.get(CACHE_STORAGE_KEY);
    const snapshot = stored[CACHE_STORAGE_KEY];
    return isBookmarkSnapshot(snapshot) ? snapshot : null;
  } catch (error) {
    console.warn("Unable to read bookmark cache from extension storage.", error);
    return null;
  }
}

async function storeSnapshot(snapshot: BookmarkSnapshot): Promise<void> {
  try {
    await browser.storage.local.set({ [CACHE_STORAGE_KEY]: snapshot });
  } catch (error) {
    console.warn("Unable to persist bookmark cache to extension storage.", error);
  }
}

function isBookmarkSnapshot(value: unknown): value is BookmarkSnapshot {
  if (!value || typeof value !== "object") {
    return false;
  }

  const snapshot = value as Partial<BookmarkSnapshot>;
  return (
    typeof snapshot.rootId === "string" &&
    typeof snapshot.generatedAt === "number" &&
    Array.isArray(snapshot.topLevelIds) &&
    !!snapshot.nodesById &&
    typeof snapshot.nodesById === "object"
  );
}
