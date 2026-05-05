import type { Browser } from "wxt/browser";

import type {
  BookmarkGalleryItem,
  BookmarkSnapshot,
  FolderPreviewItem,
} from "./types";

type BookmarkTreeNode = Browser.bookmarks.BookmarkTreeNode;

const FALLBACK_ROOT_ID = "0";
const UNTITLED_BOOKMARK = "Untitled bookmark";
const UNTITLED_FOLDER = "Untitled folder";

/**
 * Converts Chrome's nested BookmarkTreeNode[] into the app model.
 *
 * Chrome gives us a tree; the UI needs fast folder navigation. The snapshot
 * keeps the original ordering through childIds while making every node
 * addressable by id.
 */
export function createBookmarkSnapshot(
  tree: BookmarkTreeNode[],
  generatedAt = Date.now(),
): BookmarkSnapshot {
  const root = tree[0];

  if (!root) {
    return {
      rootId: FALLBACK_ROOT_ID,
      generatedAt,
      nodesById: {},
      topLevelIds: [],
    };
  }

  const nodesById: Record<string, BookmarkGalleryItem> = {};
  collectNodes(root, nodesById);

  return {
    rootId: root.id,
    generatedAt,
    nodesById,
    topLevelIds: root.children?.map((child) => child.id) ?? [],
  };
}

/** Returns the high-resolution favicon URL used by every bookmark card. */
export function getIconHorseUrl(bookmarkUrl: string): string {
  const domain = getBookmarkDomain(bookmarkUrl);
  return domain ? `https://icon.horse/icon/${domain}` : "";
}

/** Extracts a stable display/cache domain from a bookmark URL. */
export function getBookmarkDomain(bookmarkUrl: string): string {
  try {
    return new URL(bookmarkUrl).hostname.toLowerCase().replace(/^www\./, "");
  } catch {
    return "";
  }
}

function collectNodes(
  node: BookmarkTreeNode,
  nodesById: Record<string, BookmarkGalleryItem>,
): void {
  nodesById[node.id] = toGalleryItem(node);
  node.children?.forEach((child) => collectNodes(child, nodesById));
}

function toGalleryItem(node: BookmarkTreeNode): BookmarkGalleryItem {
  const title = node.title.trim();
  const common = {
    id: node.id,
    parentId: node.parentId,
    index: node.index,
    dateAdded: node.dateAdded,
    unmodifiable: node.unmodifiable,
  };

  if (node.url) {
    const domain = getBookmarkDomain(node.url);
    return {
      ...common,
      kind: "bookmark",
      title: title || UNTITLED_BOOKMARK,
      url: node.url,
      domain,
      faviconUrl: getIconHorseUrl(node.url),
      dateLastUsed: node.dateLastUsed,
    };
  }

  const children = node.children ?? [];
  return {
    ...common,
    kind: "folder",
    title: title || UNTITLED_FOLDER,
    childIds: children.map((child) => child.id),
    childCount: children.length,
    folderType: node.folderType,
    dateGroupModified: node.dateGroupModified,
    previewItems: children.slice(0, 3).map(toFolderPreviewItem),
  };
}

function toFolderPreviewItem(node: BookmarkTreeNode): FolderPreviewItem {
  if (node.url) {
    return {
      id: node.id,
      kind: "bookmark",
      title: node.title.trim() || UNTITLED_BOOKMARK,
      faviconUrl: getIconHorseUrl(node.url),
    };
  }

  return {
    id: node.id,
    kind: "folder",
    title: node.title.trim() || UNTITLED_FOLDER,
  };
}
