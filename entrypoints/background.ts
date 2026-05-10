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
    return isBookmarkCacheMessage(message)
      ? handleBookmarkCacheMessage(message)
      : undefined;
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
