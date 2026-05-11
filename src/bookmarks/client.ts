import { browser } from "wxt/browser";

import type {
  BookmarkCacheMessage,
  BookmarkCacheResponse,
  OpenBookmarkMessage,
} from "./types";

export function requestBookmarkSnapshot() {
  return sendBookmarkMessage({ type: "bookmarkGallery.getSnapshot" });
}

export function refreshBookmarkSnapshot() {
  return sendBookmarkMessage({ type: "bookmarkGallery.refreshSnapshot" });
}

export function openBookmark(url: string, openInNewTab: boolean) {
  return browser.runtime.sendMessage({
    type: "bookmarkGallery.openBookmark",
    url,
    openInNewTab,
  } satisfies OpenBookmarkMessage);
}

function sendBookmarkMessage(message: BookmarkCacheMessage) {
  return browser.runtime.sendMessage(message) as Promise<BookmarkCacheResponse>;
}
