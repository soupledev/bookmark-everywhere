import { useEffect, useState } from "react";
import type { FormEvent } from "react";
import { browser } from "wxt/browser";

import {
  API_KEY_STORAGE_KEY,
  BOOKMARK_API_BASE_URL,
  BookmarkApiError,
  DEFAULT_BOOKMARK_API_KEY,
  checkBookmarkApiHealth,
  getRemoteUser,
  type RemoteUser,
} from "@/src/bookmarks/api";
import {
  isBookmarkSyncStatus,
  readBookmarkSyncStatus,
  SYNC_NOW_MESSAGE,
  SYNC_STATUS_STORAGE_KEY,
  type BookmarkSyncStatus,
} from "@/src/bookmarks/syncStatus";
import "./App.css";

function App() {
  const [apiKey, setApiKey] = useState(DEFAULT_BOOKMARK_API_KEY);
  const [savedApiKey, setSavedApiKey] = useState<string | null>(null);
  const [user, setUser] = useState<RemoteUser | null>(null);
  const [isBusy, setIsBusy] = useState(false);
  const [apiOnline, setApiOnline] = useState<boolean | null>(null);
  const [syncStatus, setSyncStatus] = useState<BookmarkSyncStatus | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let isMounted = true;

    Promise.all([
      browser.storage.local.get(API_KEY_STORAGE_KEY),
      checkBookmarkApiHealth().catch(() => false),
      readBookmarkSyncStatus(),
    ]).then(([stored, health, status]) => {
      if (!isMounted) return;

      const storedKey = stored[API_KEY_STORAGE_KEY];
      if (typeof storedKey === "string" && storedKey) {
        setApiKey(storedKey);
        setSavedApiKey(storedKey);
        void loadAccount(storedKey);
      }
      setApiOnline(health);
      setSyncStatus(status);
    });

    const onStorageChanged = (
      changes: Record<string, { newValue?: unknown }>,
      areaName: string,
    ) => {
      if (areaName !== "local" || !changes[SYNC_STATUS_STORAGE_KEY]) return;

      const nextStatus = changes[SYNC_STATUS_STORAGE_KEY].newValue;
      if (isBookmarkSyncStatus(nextStatus)) {
        setSyncStatus(nextStatus);
        if (nextStatus.state === "synced") {
          void loadAccount();
        }
      }
    };

    browser.storage.onChanged.addListener(onStorageChanged);

    return () => {
      isMounted = false;
      browser.storage.onChanged.removeListener(onStorageChanged);
    };
  }, []);

  async function connect(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const nextKey = apiKey.trim();
    if (!nextKey) {
      setError("Enter an API key.");
      return;
    }

    setIsBusy(true);
    setError(null);

    try {
      const remoteUser = await getRemoteUser(nextKey);
      await browser.storage.local.set({ [API_KEY_STORAGE_KEY]: nextKey });
      setSavedApiKey(nextKey);
      setUser(remoteUser);
      setSyncStatus({
        state: "syncing",
        message: "Automatic sync is starting.",
        lastSyncedAt: null,
        result: null,
      });
    } catch (error) {
      setError(getErrorMessage(error));
      setSavedApiKey(null);
      setUser(null);
    } finally {
      setIsBusy(false);
    }
  }

  async function loadAccount(key = savedApiKey ?? apiKey.trim()) {
    if (!key) return;

    try {
      setUser(await getRemoteUser(key));
    } catch (error) {
      setError(getErrorMessage(error));
    }
  }

  async function syncNow() {
    setIsBusy(true);
    setError(null);
    setSyncStatus({
      state: "syncing",
      message: "Manual sync is starting.",
      lastSyncedAt: syncStatus?.lastSyncedAt ?? null,
      result: syncStatus?.result ?? null,
    });

    try {
      await browser.runtime.sendMessage({ type: SYNC_NOW_MESSAGE });
      await loadAccount();
    } catch (error) {
      setError(getErrorMessage(error));
    } finally {
      setIsBusy(false);
    }
  }

  const connected = Boolean(savedApiKey && user);

  return (
    <main className="popup">
      <header className="popup__header">
        <div>
          <p className="popup__eyebrow">Bookmark Everywhere</p>
          <h1>Auto Sync</h1>
        </div>
        <span className="popup__health" data-online={apiOnline === true}>
          {apiOnline === null
            ? "Checking"
            : apiOnline
              ? "API online"
              : "API offline"}
        </span>
      </header>

      <form className="sync-card" onSubmit={connect}>
        <label>
          <span>API key</span>
          <input
            value={apiKey}
            onChange={(event) => setApiKey(event.currentTarget.value)}
            type="password"
            autoComplete="off"
            spellCheck={false}
          />
        </label>
        <button type="submit" disabled={isBusy}>
          {connected ? "Reconnect" : "Connect"}
        </button>
        <p className="popup__meta">
          {user
            ? `${user.email} · ${user.bookmarkCount} remote bookmarks`
            : BOOKMARK_API_BASE_URL}
        </p>
      </form>

      {error ? <p className="popup__error">{error}</p> : null}

      <section className="sync-panel" aria-label="Bookmark sync status">
        <div className="sync-panel__header">
          <h2>Browser bookmarks</h2>
          <span className="sync-panel__state" data-state={syncStatus?.state ?? "idle"}>
            {syncStatus?.state ?? "idle"}
          </span>
        </div>
        <p className="popup__status" aria-live="polite">
          {syncStatus?.message ?? "Connect to start automatic sync."}
        </p>
        {syncStatus?.lastSyncedAt ? (
          <p className="popup__meta">
            Last synced {new Date(syncStatus.lastSyncedAt).toLocaleString()}
          </p>
        ) : null}
        <button type="button" disabled={!connected || isBusy} onClick={syncNow}>
          Sync now
        </button>
      </section>
    </main>
  );
}

function getErrorMessage(error: unknown) {
  if (error instanceof BookmarkApiError) return error.message;
  if (error instanceof Error) return error.message;
  return "Something went wrong.";
}

export default App;
