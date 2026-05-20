import { browser } from "wxt/browser";

import {
  API_KEY_STORAGE_KEY,
  BookmarkApiError,
  DEFAULT_BOOKMARK_API_BASE_URL,
  listRemoteBookmarks,
  listRemoteBookmarkChanges,
  SERVER_URL_STORAGE_KEY,
  syncSnapshotToRemote,
  type RemoteBookmark,
  type SyncResult,
} from "./api";
import { refreshBookmarkSnapshot } from "./cache";
import { writeBookmarkSyncStatus } from "./syncStatus";

const SYNC_DEBOUNCE_MS = 750;
const SYNC_ALARM_NAME = "bookmarkSync.everyMinute";
const SYNC_CURSOR_STORAGE_KEY = "bookmarkSync.cursor";
const SYNC_ID_MAP_STORAGE_KEY = "bookmarkSync.idMap";

interface BookmarkIdMap {
  localByRemote: Record<string, string>;
  remoteByLocal: Record<string, string>;
}

interface BookmarkSyncOptions {
  full?: boolean;
  pushFirst?: boolean;
}

let syncTimer: ReturnType<typeof setTimeout> | undefined;
let syncPromise: Promise<void> | null = null;
let pendingSync: { reason: string; options: BookmarkSyncOptions } | null = null;
let importInProgress = false;

export function initializeBookmarkSync(): void {
  scheduleBookmarkSync("startup");
  registerBookmarkSyncListeners();
}

export async function syncBookmarksNow(
  reason = "manual",
  options: BookmarkSyncOptions = {},
): Promise<void> {
  if (syncPromise) {
    pendingSync = {
      reason,
      options: {
        full: pendingSync?.options.full || options.full,
        pushFirst: pendingSync?.options.pushFirst || options.pushFirst,
      },
    };
    return syncPromise;
  }

  syncPromise = runBookmarkSync(reason, options).finally(() => {
    syncPromise = null;
    if (pendingSync) {
      const queuedSync = pendingSync;
      pendingSync = null;
      scheduleBookmarkSync(queuedSync.reason, queuedSync.options);
    }
  });

  return syncPromise;
}

function registerBookmarkSyncListeners(): void {
  [
    browser.bookmarks.onCreated,
    browser.bookmarks.onChanged,
    browser.bookmarks.onChildrenReordered,
    browser.bookmarks.onMoved,
    browser.bookmarks.onRemoved,
  ].forEach((event) =>
    event.addListener(() =>
      scheduleBookmarkSync("bookmark-change", { pushFirst: true }),
    ),
  );

  browser.bookmarks.onImportBegan.addListener(() => {
    importInProgress = true;
  });
  browser.bookmarks.onImportEnded.addListener(() => {
    importInProgress = false;
    scheduleBookmarkSync("bookmark-import");
  });

  browser.storage.onChanged.addListener((changes, areaName) => {
    if (
      areaName !== "local" ||
      (!changes[API_KEY_STORAGE_KEY]?.newValue &&
        !changes[SERVER_URL_STORAGE_KEY]?.newValue)
    ) {
      return;
    }

    scheduleBookmarkSync("settings-updated");
  });

  browser.alarms.create(SYNC_ALARM_NAME, { periodInMinutes: 1 });
  browser.alarms.onAlarm.addListener((alarm) => {
    if (alarm.name === SYNC_ALARM_NAME) {
      scheduleBookmarkSync("poll");
    }
  });
}

function scheduleBookmarkSync(
  reason: string,
  options: BookmarkSyncOptions = {},
): void {
  if (importInProgress) return;

  if (syncTimer) clearTimeout(syncTimer);

  syncTimer = setTimeout(() => {
    syncTimer = undefined;
    void syncBookmarksNow(reason, options);
  }, SYNC_DEBOUNCE_MS);
}

async function runBookmarkSync(
  reason: string,
  options: BookmarkSyncOptions,
): Promise<void> {
  const apiKey = await readApiKey();
  const serverUrl = await readServerUrl();
  if (!apiKey) {
    await writeBookmarkSyncStatus({
      state: "idle",
      message: "Connect to start automatic sync.",
      lastSyncedAt: null,
      result: null,
    });
    return;
  }

  await writeBookmarkSyncStatus({
    state: "syncing",
    message: `Syncing bookmarks (${reason}).`,
    lastSyncedAt: null,
    result: null,
  });

  try {
    const idMap = await readIdMap();
    const pushedFirst = options.pushFirst
      ? await pushLocalSnapshot(apiKey, serverUrl, idMap)
      : null;
    const pulled =
      !options.pushFirst || options.full
        ? options.full
          ? await pullRemoteSnapshot(apiKey, serverUrl, idMap)
          : await pullRemoteChanges(apiKey, serverUrl, idMap)
        : 0;
    const result =
      pushedFirst ?? (await pushLocalSnapshot(apiKey, serverUrl, idMap));

    await writeIdMap(idMap);

    const fullResult = { ...result, pulled };
    await writeBookmarkSyncStatus({
      state: "synced",
      message: formatSyncMessage(fullResult),
      lastSyncedAt: Date.now(),
      result: fullResult,
    });
  } catch (error) {
    await writeBookmarkSyncStatus({
      state: "error",
      message: error instanceof Error ? error.message : "Unable to sync bookmarks.",
      lastSyncedAt: null,
      result: null,
    });
    console.warn("Bookmark sync failed.", error);
  }
}

async function pushLocalSnapshot(
  apiKey: string,
  serverUrl: string,
  idMap: BookmarkIdMap,
): Promise<SyncResult> {
  const snapshot = await refreshBookmarkSnapshot();
  const result = await syncSnapshotToRemote(
    apiKey,
    serverUrl,
    snapshot,
    idMap.remoteByLocal,
    Object.keys(idMap.localByRemote),
  );
  reconcileSnapshotIds(snapshot, idMap);
  return result;
}

async function pullRemoteChanges(
  apiKey: string,
  serverUrl: string,
  idMap: BookmarkIdMap,
): Promise<number> {
  const cursor = await readCursor();
  const changes = await listRemoteBookmarkChanges(apiKey, serverUrl, cursor);
  let pulled = await applyRemoteBookmarks(changes.bookmarks, idMap);

  for (const deleted of changes.deleted) {
    const localId = idMap.localByRemote[deleted.id] ?? deleted.id;
    if (
      (await bookmarkExists(localId)) &&
      !(await isProtectedRootFolder(localId))
    ) {
      await removeLocalBookmark(localId);
      pulled += 1;
    }
    delete idMap.remoteByLocal[localId];
    delete idMap.localByRemote[deleted.id];
  }

  await browser.storage.local.set({ [SYNC_CURSOR_STORAGE_KEY]: changes.cursor });
  return pulled;
}

async function pullRemoteSnapshot(
  apiKey: string,
  serverUrl: string,
  idMap: BookmarkIdMap,
): Promise<number> {
  const remoteBookmarks = await listRemoteBookmarks(apiKey, serverUrl);
  let pulled = await applyRemoteBookmarks(remoteBookmarks, idMap);
  const remoteBookmarkIds = new Set(
    remoteBookmarks.map((bookmark) => bookmark.id),
  );

  for (const [remoteId, localId] of Object.entries(idMap.localByRemote)) {
    if (remoteBookmarkIds.has(remoteId)) continue;

    if (
      (await bookmarkExists(localId)) &&
      !(await isProtectedRootFolder(localId))
    ) {
      await removeLocalBookmark(localId);
      pulled += 1;
    }

    delete idMap.localByRemote[remoteId];
    delete idMap.remoteByLocal[localId];
  }

  await browser.storage.local.remove(SYNC_CURSOR_STORAGE_KEY);
  return pulled;
}

async function applyRemoteBookmarks(
  remoteBookmarks: RemoteBookmark[],
  idMap: BookmarkIdMap,
): Promise<number> {
  let pulled = 0;
  const activeBookmarks = remoteBookmarks.filter(
    (bookmark) => !bookmark.deletedAt,
  );
  const folders = activeBookmarks
    .filter((bookmark) => bookmark.type === "folder")
    .sort(
      (first, second) =>
        getRemoteDepth(first, activeBookmarks) -
        getRemoteDepth(second, activeBookmarks),
    );
  const bookmarks = activeBookmarks.filter(
    (bookmark) => bookmark.type === "bookmark",
  );

  for (const remoteBookmark of [...folders, ...bookmarks]) {
    const didApply = await applyRemoteBookmark(remoteBookmark, idMap);
    if (didApply) pulled += 1;
  }

  return pulled;
}

async function applyRemoteBookmark(
  remoteBookmark: RemoteBookmark,
  idMap: BookmarkIdMap,
): Promise<boolean> {
  const protectedRootId = await getProtectedRootFolderId(remoteBookmark);
  if (protectedRootId) {
    rememberIdPair(idMap, protectedRootId, remoteBookmark.id);
    return false;
  }

  const mappedLocalId = idMap.localByRemote[remoteBookmark.id];
  const existingLocalId =
    idMap.localByRemote[remoteBookmark.id] ??
    (await findDedupedLocalBookmark(remoteBookmark, idMap));

  if (existingLocalId) {
    const existingBookmark = await getLocalBookmark(existingLocalId);
    if (
      !existingBookmark ||
      !localBookmarkMatchesRemoteType(existingBookmark, remoteBookmark)
    ) {
      if (mappedLocalId) {
        delete idMap.localByRemote[remoteBookmark.id];
        delete idMap.remoteByLocal[mappedLocalId];
      }
    } else {
      rememberIdPair(idMap, existingLocalId, remoteBookmark.id);
      return updateLocalBookmark(existingLocalId, remoteBookmark, idMap);
    }
  }

  const parentId = await resolveLocalParentId(remoteBookmark, idMap);
  const created = await createLocalBookmark({
    parentId,
    title: remoteBookmark.title,
    url:
      remoteBookmark.type === "bookmark"
        ? remoteBookmark.url ?? undefined
        : undefined,
    index: remoteBookmark.position,
  });
  rememberIdPair(idMap, created.id, remoteBookmark.id);
  return true;
}

async function updateLocalBookmark(
  localId: string,
  remoteBookmark: RemoteBookmark,
  idMap: BookmarkIdMap,
): Promise<boolean> {
  const localBookmark = await getLocalBookmark(localId);
  if (!localBookmark) return false;
  if (await isProtectedRootFolder(localId)) return false;
  if (!localBookmarkMatchesRemoteType(localBookmark, remoteBookmark)) return false;

  const parentId = await resolveLocalParentId(remoteBookmark, idMap);
  const titleChanged = localBookmark.title !== remoteBookmark.title;
  const urlChanged =
    remoteBookmark.type === "bookmark" &&
    localBookmark.url !== remoteBookmark.url;
  const parentChanged = !!parentId && localBookmark.parentId !== parentId;
  const indexChanged =
    typeof localBookmark.index === "number" &&
    localBookmark.index !== remoteBookmark.position;

  if (titleChanged || urlChanged) {
    await browser.bookmarks.update(localId, {
      title: remoteBookmark.title,
      url:
        remoteBookmark.type === "bookmark"
          ? remoteBookmark.url ?? undefined
          : undefined,
    });
  }

  if (parentChanged || indexChanged) {
    await moveLocalBookmark(localId, parentId, remoteBookmark.position);
  }

  return titleChanged || urlChanged || parentChanged || indexChanged;
}

async function findDedupedLocalBookmark(
  remoteBookmark: RemoteBookmark,
  idMap: BookmarkIdMap,
): Promise<string | null> {
  const protectedRootId = await getProtectedRootFolderId(remoteBookmark);
  if (protectedRootId) return protectedRootId;

  const sameIdBookmark = await getLocalBookmark(remoteBookmark.id);
  if (
    sameIdBookmark &&
    localBookmarkMatchesRemoteType(sameIdBookmark, remoteBookmark)
  ) {
    return remoteBookmark.id;
  }

  if (remoteBookmark.type === "bookmark" && remoteBookmark.url) {
    const matches = await browser.bookmarks.search({ url: remoteBookmark.url });
    const match =
      matches.find((bookmark) => bookmark.title === remoteBookmark.title) ??
      matches[0];
    return match?.id ?? null;
  }

  const parentId = await resolveLocalParentId(remoteBookmark, idMap);
  const children = await browser.bookmarks.getChildren(parentId).catch(() => []);
  const match = children.find(
    (bookmark) => !bookmark.url && bookmark.title === remoteBookmark.title,
  );
  return match?.id ?? null;
}

async function getProtectedRootFolderId(
  remoteBookmark: RemoteBookmark,
): Promise<string | null> {
  if (remoteBookmark.type !== "folder" || remoteBookmark.parentId !== null) {
    return null;
  }

  if (remoteBookmark.folderType) {
    return (await getSpecialRootFolder(remoteBookmark.folderType))?.id ?? null;
  }

  const roots = await browser.bookmarks.getTree();
  return (
    roots[0]?.children?.find(
      (child) =>
        !child.url &&
        child.title.toLowerCase() === remoteBookmark.title.toLowerCase(),
    )?.id ?? null
  );
}

async function isProtectedRootFolder(localId: string): Promise<boolean> {
  const roots = await browser.bookmarks.getTree();
  return roots[0]?.children?.some((child) => child.id === localId) ?? false;
}

async function resolveLocalParentId(
  remoteBookmark: RemoteBookmark,
  idMap: BookmarkIdMap,
): Promise<string> {
  if (remoteBookmark.parentId) {
    const mappedParentId = idMap.localByRemote[remoteBookmark.parentId];
    if (mappedParentId && (await isLocalFolder(mappedParentId))) {
      return mappedParentId;
    }
    if (mappedParentId) {
      delete idMap.localByRemote[remoteBookmark.parentId];
      delete idMap.remoteByLocal[mappedParentId];
    }
  }

  if (remoteBookmark.parentId === null && remoteBookmark.folderType) {
    const rootFolder = await getSpecialRootFolder(remoteBookmark.folderType);
    if (rootFolder) {
      rememberIdPair(idMap, rootFolder.id, remoteBookmark.id);
      return rootFolder.parentId ?? "0";
    }
  }

  return getBookmarksBarId();
}

async function getSpecialRootFolder(folderType: string) {
  const roots = await browser.bookmarks.getTree();
  return roots[0]?.children?.find(
    (child) =>
      !child.url &&
      (child.folderType === folderType ||
        child.title.toLowerCase() === getRootFolderTitle(folderType)),
  );
}

async function getBookmarksBarId(): Promise<string> {
  const roots = await browser.bookmarks.getTree();
  return (
    roots[0]?.children?.find(
      (child) =>
        !child.url &&
        (child.folderType === "bookmarks-bar" ||
          child.title.toLowerCase() === "bookmarks bar"),
    )?.id ??
    roots[0]?.children?.find((child) => !child.url)?.id ??
    "0"
  );
}

function getRootFolderTitle(folderType: string): string {
  if (folderType === "bookmarks-bar") return "bookmarks bar";
  if (folderType === "other") return "other bookmarks";
  if (folderType === "mobile") return "mobile bookmarks";
  return folderType;
}

async function bookmarkExists(id: string): Promise<boolean> {
  return browser.bookmarks
    .get(id)
    .then((bookmarks) => bookmarks.length > 0)
    .catch(() => false);
}

async function getLocalBookmark(id: string) {
  const [bookmark] = await browser.bookmarks.get(id).catch(() => []);
  return bookmark ?? null;
}

async function isLocalFolder(id: string): Promise<boolean> {
  const bookmark = await getLocalBookmark(id);
  return !!bookmark && !bookmark.url;
}

function localBookmarkMatchesRemoteType(
  localBookmark: Awaited<ReturnType<typeof getLocalBookmark>>,
  remoteBookmark: RemoteBookmark,
): boolean {
  if (!localBookmark) return false;
  return remoteBookmark.type === "folder"
    ? !localBookmark.url
    : !!localBookmark.url;
}

function getRemoteDepth(
  bookmark: RemoteBookmark,
  bookmarks: RemoteBookmark[],
): number {
  const byId = new Map(bookmarks.map((item) => [item.id, item]));
  let depth = 0;
  let currentParentId = bookmark.parentId;

  while (currentParentId) {
    const parent = byId.get(currentParentId);
    if (!parent || parent.parentId === currentParentId) break;
    depth += 1;
    currentParentId = parent.parentId;
  }

  return depth;
}

async function createLocalBookmark(
  createDetails: Parameters<typeof browser.bookmarks.create>[0],
) {
  return browser.bookmarks.create(createDetails).catch(() =>
    browser.bookmarks.create({
      ...createDetails,
      index: undefined,
    }),
  );
}

async function moveLocalBookmark(
  localId: string,
  parentId: string,
  index: number,
): Promise<void> {
  await browser.bookmarks
    .move(localId, { parentId, index })
    .catch(() => browser.bookmarks.move(localId, { parentId }));
}

async function removeLocalBookmark(localId: string): Promise<void> {
  await browser.bookmarks
    .removeTree(localId)
    .catch(() => browser.bookmarks.remove(localId))
    .catch((error) => {
      console.warn("Unable to remove local bookmark.", localId, error);
    });
}

async function readApiKey(): Promise<string | null> {
  const stored = await browser.storage.local.get(API_KEY_STORAGE_KEY);
  const apiKey = stored[API_KEY_STORAGE_KEY];
  return typeof apiKey === "string" && apiKey.trim() ? apiKey.trim() : null;
}

async function readServerUrl(): Promise<string> {
  const stored = await browser.storage.local.get(SERVER_URL_STORAGE_KEY);
  const serverUrl = stored[SERVER_URL_STORAGE_KEY];
  return typeof serverUrl === "string" && serverUrl.trim()
    ? serverUrl.trim()
    : DEFAULT_BOOKMARK_API_BASE_URL;
}

async function readCursor(): Promise<string | null> {
  const stored = await browser.storage.local.get(SYNC_CURSOR_STORAGE_KEY);
  const cursor = stored[SYNC_CURSOR_STORAGE_KEY];
  return typeof cursor === "string" && cursor ? cursor : null;
}

async function readIdMap(): Promise<BookmarkIdMap> {
  const stored = await browser.storage.local.get(SYNC_ID_MAP_STORAGE_KEY);
  const idMap = stored[SYNC_ID_MAP_STORAGE_KEY];

  if (
    idMap &&
    typeof idMap === "object" &&
    "localByRemote" in idMap &&
    "remoteByLocal" in idMap
  ) {
    return idMap as BookmarkIdMap;
  }

  return { localByRemote: {}, remoteByLocal: {} };
}

async function writeIdMap(idMap: BookmarkIdMap): Promise<void> {
  await browser.storage.local.set({ [SYNC_ID_MAP_STORAGE_KEY]: idMap });
}

function reconcileSnapshotIds(
  snapshot: Awaited<ReturnType<typeof refreshBookmarkSnapshot>>,
  idMap: BookmarkIdMap,
): void {
  const activeLocalIds = new Set(Object.keys(snapshot.nodesById));

  for (const [remoteId, localId] of Object.entries(idMap.localByRemote)) {
    if (!activeLocalIds.has(localId)) {
      delete idMap.localByRemote[remoteId];
      delete idMap.remoteByLocal[localId];
    }
  }

  for (const item of Object.values(snapshot.nodesById)) {
    if (item.id === snapshot.rootId) continue;
    rememberIdPair(idMap, item.id, idMap.remoteByLocal[item.id] ?? item.id);
  }
}

function rememberIdPair(
  idMap: BookmarkIdMap,
  localId: string,
  remoteId: string,
): void {
  idMap.localByRemote[remoteId] = localId;
  idMap.remoteByLocal[localId] = remoteId;
}

function formatSyncMessage(result: SyncResult): string {
  return `Synced: ${result.created} created, ${result.updated} updated, ${result.deleted} deleted, ${result.pulled} pulled, ${result.skipped} skipped.`;
}
