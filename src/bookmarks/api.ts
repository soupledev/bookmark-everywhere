import type { BookmarkGalleryItem, BookmarkSnapshot } from "./types";

export const DEFAULT_BOOKMARK_API_BASE_URL = "https://api.souple.dev";
export const API_KEY_STORAGE_KEY = "bookmarkSync.apiKey";
export const SERVER_URL_STORAGE_KEY = "bookmarkSync.serverUrl";

export interface RemoteUser {
  id: number;
  email: string;
  bookmarkCount: number;
}

export interface CreatedApiKey {
  id: number;
  name: string;
  value: string;
}

export type RemoteBookmarkType = "folder" | "bookmark";
export type RemoteFolderType =
  | "bookmarks-bar"
  | "other"
  | "mobile"
  | "managed"
  | null;

export interface RemoteBookmark {
  userId: number;
  id: string;
  parentId: string | null;
  type: RemoteBookmarkType;
  title: string;
  url: string | null;
  position: number;
  dateAdded: string | null;
  dateGroupModified: string | null;
  dateLastUsed: string | null;
  folderType: RemoteFolderType;
  syncing: boolean | null;
  unmodifiable: "managed" | null;
  createdAt: string;
  updatedAt: string;
  deletedAt: string | null;
}

export interface RemoteBookmarkInput {
  id: string;
  parentId: string | null;
  type: RemoteBookmarkType;
  title: string;
  url?: string;
  position: number;
  dateAdded?: string | null;
  dateGroupModified?: string | null;
  dateLastUsed?: string | null;
  folderType?: RemoteFolderType;
}

export interface SyncResult {
  created: number;
  updated: number;
  deleted: number;
  pulled: number;
  skipped: number;
}

export interface BookmarkChanges {
  cursor: string;
  bookmarks: RemoteBookmark[];
  deleted: Array<{
    id: string;
    deletedAt: string;
  }>;
}

export class BookmarkApiError extends Error {
  constructor(
    message: string,
    readonly status: number,
  ) {
    super(message);
    this.name = "BookmarkApiError";
  }
}

export async function checkBookmarkApiHealth(
  serverUrl = DEFAULT_BOOKMARK_API_BASE_URL,
): Promise<boolean> {
  const response = await fetch(`${normalizeServerUrl(serverUrl)}/health`);
  return response.ok;
}

export async function getRemoteUser(
  apiKey: string,
  serverUrl = DEFAULT_BOOKMARK_API_BASE_URL,
): Promise<RemoteUser> {
  const response = await request<{ user: RemoteUser }>(
    "/user",
    apiKey,
    serverUrl,
  );
  return response.user;
}

export async function createApiKey(
  serverUrl: string,
  email: string,
  password: string,
  name = "Bookmark Everywhere",
): Promise<CreatedApiKey> {
  const response = await publicRequest<{ apiKey: CreatedApiKey }>(
    "/api-keys",
    serverUrl,
    {
      method: "POST",
      body: JSON.stringify({ email, password, name }),
    },
  );
  return response.apiKey;
}

export async function listRemoteBookmarks(
  apiKey: string,
  serverUrl = DEFAULT_BOOKMARK_API_BASE_URL,
  parentId?: string | null,
): Promise<RemoteBookmark[]> {
  const query =
    parentId === undefined
      ? ""
      : `?parentId=${parentId === null ? "" : encodeURIComponent(parentId)}`;
  const response = await request<{ bookmarks: RemoteBookmark[] }>(
    `/bookmarks${query}`,
    apiKey,
    serverUrl,
  );
  return response.bookmarks;
}

export async function listRemoteBookmarkChanges(
  apiKey: string,
  serverUrl = DEFAULT_BOOKMARK_API_BASE_URL,
  since?: string | null,
): Promise<BookmarkChanges> {
  const query = since ? `?since=${encodeURIComponent(since)}` : "";
  return request<BookmarkChanges>(
    `/bookmarks/changes${query}`,
    apiKey,
    serverUrl,
  );
}

export async function createRemoteBookmark(
  apiKey: string,
  serverUrl: string,
  input: RemoteBookmarkInput,
): Promise<RemoteBookmark> {
  const response = await request<{ bookmark: RemoteBookmark }>(
    "/bookmarks",
    apiKey,
    serverUrl,
    {
      method: "POST",
      body: JSON.stringify(cleanBookmarkPayload(input)),
    },
  );
  return response.bookmark;
}

export async function updateRemoteBookmark(
  apiKey: string,
  serverUrl: string,
  id: string,
  input: Partial<RemoteBookmarkInput>,
): Promise<RemoteBookmark> {
  const response = await request<{ bookmark: RemoteBookmark }>(
    `/bookmarks/${encodeURIComponent(id)}`,
    apiKey,
    serverUrl,
    {
      method: "PATCH",
      body: JSON.stringify(cleanBookmarkPayload(input)),
    },
  );
  return response.bookmark;
}

export async function deleteRemoteBookmark(
  apiKey: string,
  serverUrl: string,
  id: string,
): Promise<void> {
  await request<void>(
    `/bookmarks/${encodeURIComponent(id)}`,
    apiKey,
    serverUrl,
    {
      method: "DELETE",
    },
  );
}

export async function syncSnapshotToRemote(
  apiKey: string,
  serverUrl: string,
  snapshot: BookmarkSnapshot,
  remoteIdsByLocalId: Record<string, string> = {},
  knownRemoteIds: string[] = Object.values(remoteIdsByLocalId),
): Promise<SyncResult> {
  const remoteIds = new Set(knownRemoteIds);
  const localInputs = getSyncInputs(snapshot, remoteIdsByLocalId);
  const localIds = new Set(localInputs.map((input) => input.id));
  const result: SyncResult = {
    created: 0,
    updated: 0,
    deleted: 0,
    pulled: 0,
    skipped: 0,
  };

  for (const input of localInputs) {
    try {
      if (remoteIds.has(input.id)) {
        const { id: _id, ...patch } = input;
        await updateRemoteBookmark(apiKey, serverUrl, input.id, patch);
        result.updated += 1;
      } else {
        await createRemoteBookmark(apiKey, serverUrl, input);
        remoteIds.add(input.id);
        result.created += 1;
      }
    } catch (error) {
      if (error instanceof BookmarkApiError && error.status === 409) {
        const { id: _id, ...patch } = input;
        await updateRemoteBookmark(apiKey, serverUrl, input.id, patch);
        result.updated += 1;
        continue;
      }

      result.skipped += 1;
      console.warn("Unable to sync bookmark.", input.id, error);
    }
  }

  const staleBookmarkIds = knownRemoteIds.filter((id) => !localIds.has(id));

  for (const id of staleBookmarkIds) {
    try {
      await deleteRemoteBookmark(apiKey, serverUrl, id);
      result.deleted += 1;
    } catch (error) {
      if (error instanceof BookmarkApiError && error.status === 404) {
        continue;
      }

      result.skipped += 1;
      console.warn("Unable to delete remote bookmark.", id, error);
    }
  }

  return result;
}

function getSyncInputs(
  snapshot: BookmarkSnapshot,
  remoteIdsByLocalId: Record<string, string>,
): RemoteBookmarkInput[] {
  return Object.values(snapshot.nodesById)
    .filter((item) => item.id !== snapshot.rootId)
    .map((item) => toRemoteBookmarkInput(snapshot, item, remoteIdsByLocalId))
    .sort((first, second) => {
      const firstDepth = getDepth(snapshot, first.parentId);
      const secondDepth = getDepth(snapshot, second.parentId);
      if (firstDepth !== secondDepth) return firstDepth - secondDepth;
      if (first.type !== second.type) return first.type === "folder" ? -1 : 1;
      return first.position - second.position;
    });
}

function toRemoteBookmarkInput(
  snapshot: BookmarkSnapshot,
  item: BookmarkGalleryItem,
  remoteIdsByLocalId: Record<string, string>,
): RemoteBookmarkInput {
  const remoteId = remoteIdsByLocalId[item.id] ?? item.id;
  const parentId = getRemoteParentId(snapshot, item, remoteIdsByLocalId);
  const common = {
    id: remoteId,
    parentId,
    title: item.title,
    position: item.index ?? 0,
    dateAdded: toIsoDate(item.dateAdded),
  };

  if (item.kind === "bookmark") {
    return {
      ...common,
      type: "bookmark",
      url: item.url,
      dateLastUsed: toIsoDate(item.dateLastUsed),
    };
  }

  return {
    ...common,
    type: "folder",
    dateGroupModified: toIsoDate(item.dateGroupModified),
    folderType: toRemoteFolderType(item.folderType),
  };
}

function getRemoteParentId(
  snapshot: BookmarkSnapshot,
  item: BookmarkGalleryItem,
  remoteIdsByLocalId: Record<string, string>,
): string | null {
  if (!item.parentId || item.parentId === snapshot.rootId) return null;
  return remoteIdsByLocalId[item.parentId] ?? item.parentId;
}

function getDepth(snapshot: BookmarkSnapshot, parentId: string | null): number {
  let depth = 0;
  let currentId = parentId;

  while (currentId) {
    const item = snapshot.nodesById[currentId];
    if (!item || item.parentId === currentId) break;
    depth += 1;
    currentId = item.parentId ?? null;
  }

  return depth;
}

function toIsoDate(timestamp: number | undefined): string | null {
  return typeof timestamp === "number" ? new Date(timestamp).toISOString() : null;
}

function toRemoteFolderType(folderType: string | undefined): RemoteFolderType {
  if (
    folderType === "bookmarks-bar" ||
    folderType === "other" ||
    folderType === "mobile" ||
    folderType === "managed"
  ) {
    return folderType;
  }

  return null;
}

function cleanBookmarkPayload<T extends Partial<RemoteBookmarkInput>>(
  payload: T,
): Partial<RemoteBookmarkInput> {
  const cleaned: Partial<RemoteBookmarkInput> = { ...payload };

  if (cleaned.type === "folder") {
    delete cleaned.url;
  }

  if (cleaned.folderType === null || cleaned.folderType === undefined) {
    delete cleaned.folderType;
  }

  return cleaned;
}

async function request<T>(
  path: string,
  apiKey: string,
  serverUrl: string,
  init: RequestInit = {},
): Promise<T> {
  const response = await fetch(`${normalizeServerUrl(serverUrl)}${path}`, {
    ...init,
    headers: {
      Authorization: `Bearer ${apiKey}`,
      ...(init.body ? { "Content-Type": "application/json" } : {}),
      ...init.headers,
    },
  });

  if (response.status === 204) {
    return undefined as T;
  }

  const text = await response.text();
  const body = text ? parseJson(text) : null;

  if (!response.ok) {
    const message =
      body && typeof body === "object" && "error" in body
        ? String((body as { error: unknown }).error)
        : `Bookmark API request failed with status ${response.status}.`;
    throw new BookmarkApiError(message, response.status);
  }

  return body as T;
}

async function publicRequest<T>(
  path: string,
  serverUrl: string,
  init: RequestInit = {},
): Promise<T> {
  const response = await fetch(`${normalizeServerUrl(serverUrl)}${path}`, {
    ...init,
    headers: {
      ...(init.body ? { "Content-Type": "application/json" } : {}),
      ...init.headers,
    },
  });

  const text = await response.text();
  const body = text ? parseJson(text) : null;

  if (!response.ok) {
    const message =
      body && typeof body === "object" && "error" in body
        ? String((body as { error: unknown }).error)
        : `Bookmark API request failed with status ${response.status}.`;
    throw new BookmarkApiError(message, response.status);
  }

  return body as T;
}

export function normalizeServerUrl(serverUrl: string): string {
  return serverUrl.trim().replace(/\/+$/, "");
}

function parseJson(text: string): unknown {
  try {
    return JSON.parse(text);
  } catch {
    return null;
  }
}
