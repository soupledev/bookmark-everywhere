import { browser } from "wxt/browser";

import type { BookmarkCacheMessage, BookmarkCacheResponse } from "./types";

export function requestBookmarkSnapshot() {
  return sendBookmarkMessage({ type: "bookmarkGallery.getSnapshot" });
}

export function refreshBookmarkSnapshot() {
  return sendBookmarkMessage({ type: "bookmarkGallery.refreshSnapshot" });
}

function sendBookmarkMessage(message: BookmarkCacheMessage) {
  return browser.runtime.sendMessage(message) as Promise<BookmarkCacheResponse>;
}
