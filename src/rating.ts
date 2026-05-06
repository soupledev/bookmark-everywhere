import { browser } from "wxt/browser";

const USAGE_COUNT_KEY = "bookmarkEverywhere.rating.usageCount";
const DISMISSED_KEY = "bookmarkEverywhere.rating.dismissed";
const PROMPT_AFTER_USES = 2;
const CHROME_STORE_URL = "https://chrome.todo";
const FIREFOX_STORE_URL = "https://firefox.todo";

export async function recordBookmarkUse(): Promise<string | null> {
  const { usageCount, dismissed } = await getRatingStorage();
  const nextUsageCount = usageCount + 1;

  await browser.storage.local.set({ [USAGE_COUNT_KEY]: nextUsageCount });
  return nextUsageCount >= PROMPT_AFTER_USES && !dismissed
    ? getStoreUrl()
    : null;
}

export function dismissRatingPrompt(): Promise<void> {
  return browser.storage.local.set({ [DISMISSED_KEY]: true });
}

async function getRatingStorage() {
  const stored = await browser.storage.local.get([
    USAGE_COUNT_KEY,
    DISMISSED_KEY,
  ]);

  return {
    usageCount:
      typeof stored[USAGE_COUNT_KEY] === "number"
        ? stored[USAGE_COUNT_KEY]
        : 0,
    dismissed: stored[DISMISSED_KEY] === true,
  };
}

function getStoreUrl() {
  return navigator.userAgent.includes("Firefox")
    ? FIREFOX_STORE_URL
    : CHROME_STORE_URL;
}
