import { browser } from "wxt/browser";

import {
  API_KEY_STORAGE_KEY,
  BookmarkApiError,
  listRemoteBookmarkChanges,
  syncSnapshotToRemote,
  type RemoteBookmark,
  type SyncResult,
} from "./api";
import { refreshBookmarkSnapshot } from "./cache";
import {
  writeBookmarkSyncStatus,
} from "./syncStatus";

const SYNC_DEBOUNCE_MS = 750;
const SYNC_ALARM_NAME = "bookmarkSync.everyMinute";
const SYNC_CURSOR_STORAGE_KEY = "bookmarkSync.cursor";
const SYNC_ID_MAP_STORAGE_KEY = "bookmarkSync.idMap";

interface BookmarkIdMap {
  localByRemote: Record<string, string>;
  remoteByLocal: Record<string, string>;
}

let syncTimer: ReturnType<typeof setTimeout> | undefined;
let syncPromise: Promise<void> | null = null;
let pendingSync = false;
let importInProgress = false;

export function initializeBookmarkSync(): void {
  scheduleBookmarkSync("startup");
  registerBookmarkSyncListeners();
}

export async function syncBookmarksNow(reason = "manual"): Promise<void> {
  if (syncPromise) {
    pendingSync = true;
    return syncPromise;
  }

  syncPromise = runBookmarkSync(reason).finally(() => {
    syncPromise = null;
    if (pendingSync) {
      pendingSync = false;
      scheduleBookmarkSync("queued");
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
    event.addListener(() => scheduleBookmarkSync("bookmark-change")),
  );

  browser.bookmarks.onImportBegan.addListener(() => {
    importInProgress = true;
  });
  browser.bookmarks.onImportEnded.addListener(() => {
    importInProgress = false;
    scheduleBookmarkSync("bookmark-import");
  });

  browser.storage.onChanged.addListener((changes, areaName) => {
    if (areaName !== "local" || !changes[API_KEY_STORAGE_KEY]?.newValue) {
      return;
    }

    scheduleBookmarkSync("api-key-updated");
  });

  browser.alarms.create(SYNC_ALARM_NAME, { periodInMinutes: 1 });
  browser.alarms.onAlarm.addListener((alarm) => {
    if (alarm.name === SYNC_ALARM_NAME) {
      scheduleBookmarkSync("poll");
    }
  });
}

function scheduleBookmarkSync(reason: string): void {
  if (importInProgress) return;

  if (syncTimer) clearTimeout(syncTimer);

  syncTimer = setTimeout(() => {
    syncTimer = undefined;
    void syncBookmarksNow(reason);
  }, SYNC_DEBOUNCE_MS);
}

async function runBookmarkSync(reason: string): Promise<void> {
  const apiKey = await readApiKey();
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
    const pulled = await pullRemoteChanges(apiKey, idMap);
    const snapshot = await refreshBookmarkSnapshot();
    const result = await syncSnapshotToRemote(
      apiKey,
      snapshot,
      idMap.remoteByLocal,
      Object.keys(idMap.localByRemote),
    );

    reconcileSnapshotIds(snapshot, idMap);
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

async function pullRemoteChanges(
  apiKey: string,
  idMap: BookmarkIdMap,
): Promise<number> {
  const cursor = await readCursor();
  const changes = await listRemoteBookmarkChanges(apiKey, cursor);
  let pulled = 0;

  const folders = changes.bookmarks.filter(
    (bookmark) => bookmark.type === "folder" && !bookmark.deletedAt,
  );
  const bookmarks = changes.bookmarks.filter(
    (bookmark) => bookmark.type === "bookmark" && !bookmark.deletedAt,
  );

  for (const remoteBookmark of [...folders, ...bookmarks]) {
    const didApply = await applyRemoteBookmark(remoteBookmark, idMap);
    if (didApply) pulled += 1;
  }

  for (const deleted of changes.deleted) {
    const localId = idMap.localByRemote[deleted.id] ?? deleted.id;
    if (await bookmarkExists(localId)) {
      await removeLocalBookmark(localId);
      pulled += 1;
    }
    delete idMap.remoteByLocal[localId];
    delete idMap.localByRemote[deleted.id];
  }

  await browser.storage.local.set({ [SYNC_CURSOR_STORAGE_KEY]: changes.cursor });
  return pulled;
}

async function applyRemoteBookmark(
  remoteBookmark: RemoteBookmark,
  idMap: BookmarkIdMap,
): Promise<boolean> {
  const existingLocalId =
    idMap.localByRemote[remoteBookmark.id] ??
    (await findDedupedLocalBookmark(remoteBookmark, idMap));

  if (existingLocalId) {
    rememberIdPair(idMap, existingLocalId, remoteBookmark.id);
    return updateLocalBookmark(existingLocalId, remoteBookmark, idMap);
  }

  const parentId = await resolveLocalParentId(remoteBookmark, idMap);
  const created = await createLocalBookmark({
    parentId,
    title: remoteBookmark.title,
    url: remoteBookmark.type === "bookmark" ? remoteBookmark.url ?? undefined : undefined,
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
  const [localBookmark] = await browser.bookmarks.get(localId).catch(() => []);
  if (!localBookmark) return false;

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
      url: remoteBookmark.type === "bookmark" ? remoteBookmark.url ?? undefined : undefined,
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
  if (await bookmarkExists(remoteBookmark.id)) return remoteBookmark.id;

  if (remoteBookmark.type === "bookmark" && remoteBookmark.url) {
    const matches = await browser.bookmarks.search({ url: remoteBookmark.url });
    const match =
      matches.find((bookmark) => bookmark.title === remoteBookmark.title) ??
      matches[0];
    return match?.id ?? null;
  }

  const parentId = await resolveLocalParentId(remoteBookmark, idMap);
  const children = await browser.bookmarks.getChildren(parentId);
  const match = children.find(
    (bookmark) => !bookmark.url && bookmark.title === remoteBookmark.title,
  );
  return match?.id ?? null;
}

async function resolveLocalParentId(
  remoteBookmark: RemoteBookmark,
  idMap: BookmarkIdMap,
): Promise<string> {
  if (remoteBookmark.parentId) {
    const mappedParentId = idMap.localByRemote[remoteBookmark.parentId];
    if (mappedParentId && (await bookmarkExists(mappedParentId))) {
      return mappedParentId;
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
      child.folderType === folderType ||
      child.title.toLowerCase() === getRootFolderTitle(folderType),
  );
}

async function getBookmarksBarId(): Promise<string> {
  const roots = await browser.bookmarks.getTree();
  return (
    roots[0]?.children?.find(
      (child) =>
        child.folderType === "bookmarks-bar" ||
        child.title.toLowerCase() === "bookmarks bar",
    )?.id ??
    roots[0]?.id ??
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
