import {
  handleBookmarkCacheMessage,
  initializeBookmarkCache,
  isBookmarkCacheMessage,
} from "@/src/bookmarks/cache";
import {
  OPEN_BOOKMARK_GALLERY_COMMAND,
  TOGGLE_BOOKMARK_DIALOG_MESSAGE,
} from "@/src/bookmarks/dialogMessages";
import { markShortcutUsed } from "@/src/onboarding";

export default defineBackground(() => {
  initializeBookmarkCache();

  browser.runtime.onInstalled.addListener((details) => {
    if (details.reason !== "install") return;

    void browser.tabs.create({
      url: browser.runtime.getURL("/welcome.html"),
    });
  });

  browser.runtime.onMessage.addListener((message) => {
    if (!isBookmarkCacheMessage(message)) {
      return;
    }

    return handleBookmarkCacheMessage(message);
  });

  browser.commands.onCommand.addListener(async (command) => {
    if (command !== OPEN_BOOKMARK_GALLERY_COMMAND) return;

    await markShortcutUsed();

    const [tab] = await browser.tabs.query({
      active: true,
      currentWindow: true,
    });

    if (!tab?.id) return;

    await browser.tabs
      .sendMessage(tab.id, { type: TOGGLE_BOOKMARK_DIALOG_MESSAGE })
      .catch(() => undefined);
  });
});
