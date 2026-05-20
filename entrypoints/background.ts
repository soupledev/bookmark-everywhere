import {
  handleBookmarkCacheMessage,
  initializeBookmarkCache,
  isBookmarkCacheMessage,
} from "@/src/bookmarks/cache";
import {
  OPEN_BOOKMARK_GALLERY_COMMAND,
  TOGGLE_BOOKMARK_DIALOG_MESSAGE,
} from "@/src/bookmarks/dialogMessages";
import { initializeBookmarkSync, syncBookmarksNow } from "@/src/bookmarks/sync";
import { isBookmarkSyncNowMessage } from "@/src/bookmarks/syncStatus";
import type { OpenBookmarkMessage } from "@/src/bookmarks/types";
import { markShortcutUsed } from "@/src/onboarding";

export default defineBackground(() => {
  initializeBookmarkCache();
  initializeBookmarkSync();

  browser.runtime.onInstalled.addListener((details) => {
    if (details.reason !== "install") return;

    void browser.tabs.create({
      url: browser.runtime.getURL("/welcome.html"),
    });
  });

  browser.runtime.onMessage.addListener((message) => {
    if (isBookmarkCacheMessage(message)) {
      return handleBookmarkCacheMessage(message);
    }

    if (isOpenBookmarkMessage(message)) {
      return openBookmark(message);
    }

    if (isBookmarkSyncNowMessage(message)) {
      return syncBookmarksNow("manual", { full: message.full === true });
    }

    return undefined;
  });

  browser.commands.onCommand.addListener(async (command) => {
    if (command !== OPEN_BOOKMARK_GALLERY_COMMAND) return;

    const [tab] = await browser.tabs.query({
      active: true,
      currentWindow: true,
    });

    if (!tab?.id) return;

    const didOpenDialog = await browser.tabs
      .sendMessage(tab.id, { type: TOGGLE_BOOKMARK_DIALOG_MESSAGE })
      .then(() => true)
      .catch(() => false);

    if (!didOpenDialog && !isWelcomePage(tab.url)) {
      await browser.tabs.create({
        url: browser.runtime.getURL("/newtab.html"),
      });
    }

    await markShortcutUsed();
  });
});

async function openBookmark(message: OpenBookmarkMessage) {
  if (message.openInNewTab) {
    await browser.tabs.create({ url: message.url });
    return;
  }

  const [tab] = await browser.tabs.query({
    active: true,
    currentWindow: true,
  });

  if (tab?.id) {
    await browser.tabs.update(tab.id, { url: message.url });
    return;
  }

  await browser.tabs.create({ url: message.url });
}

function isOpenBookmarkMessage(
  message: unknown,
): message is OpenBookmarkMessage {
  if (!message || typeof message !== "object") {
    return false;
  }

  const openMessage = message as Partial<OpenBookmarkMessage>;
  return (
    openMessage.type === "bookmarkGallery.openBookmark" &&
    typeof openMessage.url === "string" &&
    typeof openMessage.openInNewTab === "boolean"
  );
}

function isWelcomePage(tabUrl: string | undefined) {
  if (!tabUrl) return false;

  try {
    const url = new URL(tabUrl);
    const welcomeUrl = new URL(browser.runtime.getURL("/welcome.html"));

    return (
      url.origin === welcomeUrl.origin && url.pathname === welcomeUrl.pathname
    );
  } catch {
    return false;
  }
}
