/** A normalized bookmark card with a remote favicon URL and browser fallback. */
export interface BookmarkItem {
  kind: "bookmark";
  id: string;
  parentId?: string;
  index?: number;
  title: string;
  url: string;
  domain: string;
  faviconUrl: string;
  dateAdded?: number;
  dateLastUsed?: number;
  unmodifiable?: string;
}

/**
 * A lightweight child preview used by folder cards.
 * The UI should render these first items and use childCount on the folder to
 * decide whether to add a generic folder icon or an overflow indicator.
 */
export interface FolderPreviewItem {
  id: string;
  kind: "bookmark" | "folder";
  title: string;
  url?: string;
  faviconUrl?: string;
}

/** A normalized folder card with enough child metadata for grid navigation. */
export interface BookmarkFolderItem {
  kind: "folder";
  id: string;
  parentId?: string;
  index?: number;
  title: string;
  childIds: string[];
  childCount: number;
  folderType?: string;
  dateAdded?: number;
  dateGroupModified?: number;
  previewItems: FolderPreviewItem[];
  unmodifiable?: string;
}

export type BookmarkGalleryItem = BookmarkItem | BookmarkFolderItem;

/**
 * Cached bookmark tree optimized for UI reads.
 * nodesById gives O(1) lookup, while each folder owns the ordered childIds
 * needed to render a folder view without walking Chrome's nested tree again.
 */
export interface BookmarkSnapshot {
  rootId: string;
  generatedAt: number;
  nodesById: Record<string, BookmarkGalleryItem>;
  topLevelIds: string[];
}

export type BookmarkCacheMessage =
  | { type: "bookmarkGallery.getSnapshot" }
  | { type: "bookmarkGallery.refreshSnapshot" };

export interface BookmarkCacheResponse {
  snapshot: BookmarkSnapshot;
}

export interface OpenBookmarkMessage {
  type: "bookmarkGallery.openBookmark";
  url: string;
  openInNewTab: boolean;
}
