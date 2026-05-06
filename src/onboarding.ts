import { browser } from "wxt/browser";

const SHORTCUT_USED_KEY = "bookmarkEverywhere.shortcutUsed";

export interface WelcomeProgress {
  shortcutUsed: boolean;
}

export async function getWelcomeProgress(): Promise<WelcomeProgress> {
  const stored = await browser.storage.local.get(SHORTCUT_USED_KEY);
  return { shortcutUsed: stored[SHORTCUT_USED_KEY] === true };
}

export function markShortcutUsed(): Promise<void> {
  return browser.storage.local.set({ [SHORTCUT_USED_KEY]: true });
}

export function onWelcomeProgressChange(
  callback: (progress: WelcomeProgress) => void,
) {
  const listener = (
    changes: Record<string, { newValue?: unknown }>,
    areaName: string,
  ) => {
    if (areaName !== "local" || !changes[SHORTCUT_USED_KEY]) return;

    callback({ shortcutUsed: changes[SHORTCUT_USED_KEY].newValue === true });
  };

  browser.storage.onChanged.addListener(listener);
  return () => browser.storage.onChanged.removeListener(listener);
}
