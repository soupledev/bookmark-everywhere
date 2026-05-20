import { useEffect, useState } from "react";
import type { FormEvent } from "react";
import { browser } from "wxt/browser";

import {
  API_KEY_STORAGE_KEY,
  BookmarkApiError,
  DEFAULT_BOOKMARK_API_BASE_URL,
  SERVER_URL_STORAGE_KEY,
  checkBookmarkApiHealth,
  createApiKey,
  getRemoteUser,
  normalizeServerUrl,
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

const IS_DEV_BUILD = import.meta.env.DEV;

type PopupScreen = "home" | "settings" | "dev";

function App() {
  const [screen, setScreen] = useState<PopupScreen>("home");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [serverUrl, setServerUrl] = useState(DEFAULT_BOOKMARK_API_BASE_URL);
  const [savedApiKey, setSavedApiKey] = useState<string | null>(null);
  const [savedServerUrl, setSavedServerUrl] = useState(
    DEFAULT_BOOKMARK_API_BASE_URL,
  );
  const [user, setUser] = useState<RemoteUser | null>(null);
  const [isBusy, setIsBusy] = useState(false);
  const [apiOnline, setApiOnline] = useState<boolean | null>(null);
  const [syncStatus, setSyncStatus] = useState<BookmarkSyncStatus | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let isMounted = true;

    Promise.all([
      browser.storage.local.get([API_KEY_STORAGE_KEY, SERVER_URL_STORAGE_KEY]),
      readBookmarkSyncStatus(),
    ]).then(([stored, status]) => {
      if (!isMounted) return;

      const storedKey = stored[API_KEY_STORAGE_KEY];
      const storedServerUrl = getStoredServerUrl(stored[SERVER_URL_STORAGE_KEY]);
      setServerUrl(storedServerUrl);
      setSavedServerUrl(storedServerUrl);

      if (typeof storedKey === "string" && storedKey) {
        setSavedApiKey(storedKey);
        void loadAccount(storedKey, storedServerUrl);
      }
      void checkApiHealth(storedServerUrl);
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
          void loadSavedAccount();
        }
      }
    };

    browser.storage.onChanged.addListener(onStorageChanged);

    return () => {
      isMounted = false;
      browser.storage.onChanged.removeListener(onStorageChanged);
    };
  }, []);

  async function logIn(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const nextEmail = email.trim();
    const nextPassword = password;

    if (!nextEmail || !nextPassword) {
      setError("Enter your email and password.");
      return;
    }

    setIsBusy(true);
    setError(null);

    try {
      const createdKey = await createApiKey(
        savedServerUrl,
        nextEmail,
        nextPassword,
        "Bookmark Everywhere",
      );
      const remoteUser = await getRemoteUser(createdKey.value, savedServerUrl);
      await browser.storage.local.set({
        [API_KEY_STORAGE_KEY]: createdKey.value,
      });
      setSavedApiKey(createdKey.value);
      setUser(remoteUser);
      setPassword("");
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

  async function logOut() {
    setIsBusy(true);
    setError(null);

    try {
      await browser.storage.local.remove([
        API_KEY_STORAGE_KEY,
        "bookmarkSync.cursor",
        "bookmarkSync.idMap",
      ]);
      setSavedApiKey(null);
      setUser(null);
      setSyncStatus({
        state: "idle",
        message: "Log in to start automatic sync.",
        lastSyncedAt: null,
        result: null,
      });
      setScreen("home");
    } catch (error) {
      setError(getErrorMessage(error));
    } finally {
      setIsBusy(false);
    }
  }

  async function saveSettings(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const nextServerUrl = normalizeServerUrl(serverUrl);

    if (!nextServerUrl) {
      setError("Enter a server URL.");
      return;
    }

    setIsBusy(true);
    setError(null);

    try {
      const serverChanged = nextServerUrl !== savedServerUrl;
      await browser.storage.local.set({
        [SERVER_URL_STORAGE_KEY]: nextServerUrl,
      });
      if (serverChanged) {
        await browser.storage.local.remove([
          "bookmarkSync.cursor",
          "bookmarkSync.idMap",
        ]);
      }
      setServerUrl(nextServerUrl);
      setSavedServerUrl(nextServerUrl);
      await checkApiHealth(nextServerUrl);
      setScreen("home");
    } catch (error) {
      setError(getErrorMessage(error));
    } finally {
      setIsBusy(false);
    }
  }

  async function loadAccount(key: string, url = savedServerUrl) {
    try {
      setUser(await getRemoteUser(key, url));
      setError(null);
    } catch (error) {
      setError(getErrorMessage(error));
    }
  }

  async function loadSavedAccount() {
    const stored = await browser.storage.local.get([
      API_KEY_STORAGE_KEY,
      SERVER_URL_STORAGE_KEY,
    ]);
    const storedKey = stored[API_KEY_STORAGE_KEY];
    const storedServerUrl = getStoredServerUrl(stored[SERVER_URL_STORAGE_KEY]);

    if (typeof storedKey !== "string" || !storedKey) return;

    setSavedApiKey(storedKey);
    setServerUrl(storedServerUrl);
    setSavedServerUrl(storedServerUrl);
    await loadAccount(storedKey, storedServerUrl);
  }

  async function checkApiHealth(url = savedServerUrl) {
    setApiOnline(await checkBookmarkApiHealth(url).catch(() => false));
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
      await browser.runtime.sendMessage({ type: SYNC_NOW_MESSAGE, full: true });
      await loadSavedAccount();
    } catch (error) {
      setError(getErrorMessage(error));
    } finally {
      setIsBusy(false);
    }
  }

  const hasApiKey = Boolean(savedApiKey);

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

      {screen === "settings" ? (
        <form className="sync-card" onSubmit={saveSettings}>
          <div className="sync-panel__header">
            <h2>Settings</h2>
            <button
              type="button"
              className="popup__secondary"
              disabled={isBusy}
              onClick={() => {
                setServerUrl(savedServerUrl);
                setScreen("home");
                setError(null);
              }}
            >
              Done
            </button>
          </div>
          <label>
            <span>Server URL</span>
            <input
              value={serverUrl}
              onChange={(event) => setServerUrl(event.currentTarget.value)}
              type="url"
              placeholder={DEFAULT_BOOKMARK_API_BASE_URL}
              spellCheck={false}
            />
          </label>
          <button type="submit" disabled={isBusy}>
            Save settings
          </button>
        </form>
      ) : screen === "dev" && IS_DEV_BUILD ? (
        <section className="sync-card" aria-label="Developer tools">
          <div className="sync-panel__header">
            <h2>Dev</h2>
            <button
              type="button"
              className="popup__secondary"
              disabled={isBusy}
              onClick={() => {
                setScreen("home");
                setError(null);
              }}
            >
              Done
            </button>
          </div>
          <label>
            <span>API key</span>
            <textarea readOnly value={savedApiKey ?? ""} spellCheck={false} />
          </label>
        </section>
      ) : hasApiKey ? (
        <section className="sync-card" aria-label="Sync account">
          <div className="popup__account">
            <div>
              <p className="popup__meta">{savedServerUrl}</p>
              <strong>{user?.email ?? "Signed in"}</strong>
              {user ? (
                <p className="popup__meta">
                  {user.bookmarkCount} remote bookmarks
                </p>
              ) : null}
            </div>
          </div>
          <div className="popup__actions">
            <button
              type="button"
              className="popup__secondary"
              disabled={isBusy}
              onClick={() => setScreen("settings")}
            >
              Settings
            </button>
            {IS_DEV_BUILD ? (
              <button
                type="button"
                className="popup__secondary"
                disabled={isBusy}
                onClick={() => setScreen("dev")}
              >
                Dev
              </button>
            ) : null}
            <button
              type="button"
              className="popup__secondary"
              disabled={isBusy}
              onClick={logOut}
            >
              Log out
            </button>
          </div>
        </section>
      ) : (
        <form className="sync-card" onSubmit={logIn}>
          <label>
            <span>Email</span>
            <input
              value={email}
              onChange={(event) => setEmail(event.currentTarget.value)}
              type="email"
              autoComplete="email"
              spellCheck={false}
            />
          </label>
          <label>
            <span>Password</span>
            <input
              value={password}
              onChange={(event) => setPassword(event.currentTarget.value)}
              type="password"
              autoComplete="current-password"
            />
          </label>
          <button type="submit" disabled={isBusy}>
            Log in
          </button>
          <button
            type="button"
            className="popup__secondary"
            disabled={isBusy}
            onClick={() => setScreen("settings")}
          >
            Settings
          </button>
        </form>
      )}

      {error ? <p className="popup__error">{error}</p> : null}

      {hasApiKey ? (
        <section className="sync-panel" aria-label="Bookmark sync status">
          <div className="sync-panel__header">
            <h2>Browser bookmarks</h2>
            <span
              className="sync-panel__state"
              data-state={syncStatus?.state ?? "idle"}
            >
              {syncStatus?.state ?? "idle"}
            </span>
          </div>
          <p className="popup__status" aria-live="polite">
            {syncStatus?.message ?? "Automatic sync is ready."}
          </p>
          {syncStatus?.lastSyncedAt ? (
            <p className="popup__meta">
              Last synced {new Date(syncStatus.lastSyncedAt).toLocaleString()}
            </p>
          ) : null}
          <button type="button" disabled={isBusy} onClick={syncNow}>
            Sync now
          </button>
        </section>
      ) : null}
    </main>
  );
}

function getStoredServerUrl(value: unknown): string {
  return typeof value === "string" && value.trim()
    ? normalizeServerUrl(value)
    : DEFAULT_BOOKMARK_API_BASE_URL;
}

function getErrorMessage(error: unknown) {
  if (error instanceof BookmarkApiError) return error.message;
  if (error instanceof Error) return error.message;
  return "Something went wrong.";
}

export default App;
