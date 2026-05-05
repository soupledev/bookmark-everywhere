import {
  handleBookmarkCacheMessage,
  initializeBookmarkCache,
  isBookmarkCacheMessage,
} from "@/src/bookmarks/cache";

export default defineBackground(() => {
  initializeBookmarkCache();

  browser.runtime.onMessage.addListener((message) => {
    if (!isBookmarkCacheMessage(message)) {
      return;
    }

    return handleBookmarkCacheMessage(message);
  });
});
