import { useEffect, useRef, useState } from "react";
import type { KeyboardEvent } from "react";

import { requestBookmarkSnapshot } from "../client";
import type {
  BookmarkFolderItem,
  BookmarkGalleryItem,
  BookmarkItem,
  BookmarkSnapshot,
} from "../types";
import "./BookmarkGallery.css";

const ROOT_TITLE = "Bookmarks";
const SHORTCUTS = [
  { keys: ["↑", "↓", "←", "→"], label: "Navigate" },
  { keys: ["Enter"], label: "Open" },
  { keys: ["Esc"], label: "Back" },
];
const HISTORY_FOLDER_PATH_KEY = "bookmarkGalleryFolderPath";

export function BookmarkGallery() {
  const [snapshot, setSnapshot] = useState<BookmarkSnapshot | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [folderPath, setFolderPath] = useState(getHistoryFolderPath);
  const [selectedIndex, setSelectedIndex] = useState(0);
  const galleryRef = useRef<HTMLElement | null>(null);
  const gridRef = useRef<HTMLElement | null>(null);

  const rootFolder = snapshot ? getBookmarksBarFolder(snapshot) : undefined;
  const activeFolder = snapshot
    ? getFolder(snapshot, folderPath.at(-1) ?? rootFolder?.id)
    : undefined;
  const items = snapshot && activeFolder ? getFolderItems(snapshot, activeFolder) : [];
  const stateMessage =
    error ?? (!snapshot ? "Loading bookmarks..." : items.length ? null : "No bookmarks here.");

  useEffect(() => {
    let isMounted = true;

    requestBookmarkSnapshot()
      .then(({ snapshot }) => {
        if (isMounted) setSnapshot(snapshot);
      })
      .catch(() => {
        if (isMounted) setError("Unable to load bookmarks.");
      });

    return () => {
      isMounted = false;
    };
  }, []);

  useEffect(() => {
    saveHistoryFolderPath(folderPath, true);

    const onPopState = (event: PopStateEvent) => {
      setFolderPath(getHistoryFolderPath(event.state));
    };

    window.addEventListener("popstate", onPopState);
    return () => window.removeEventListener("popstate", onPopState);
  }, []);

  useEffect(() => {
    setSelectedIndex(0);
  }, [activeFolder?.id]);

  useEffect(() => {
    const selectedCard = gridRef.current?.querySelectorAll<HTMLButtonElement>(
      ".bookmark-card",
    )[selectedIndex];
    (selectedCard ?? galleryRef.current)?.focus({ preventScroll: true });
  }, [selectedIndex, items.length]);

  function handleKeyDown(event: KeyboardEvent) {
    if (event.key === "Escape") {
      event.preventDefault();
      goToParentFolder();
      return;
    }

    if (!items.length) return;

    if (event.key === "Enter" || event.key === " ") {
      event.preventDefault();
      const selectedItem = items[selectedIndex];
      if (selectedItem) activateItem(selectedItem);
      return;
    }

    const nextIndex = getNextIndex(
      event.key,
      selectedIndex,
      items.length,
      getGridColumnCount(gridRef.current),
    );
    if (nextIndex !== selectedIndex) {
      event.preventDefault();
      setSelectedIndex(nextIndex);
    }
  }

  function activateItem(item: BookmarkGalleryItem) {
    if (item.kind === "folder") {
      goToFolderPath([...folderPath, item.id]);
      return;
    }

    window.location.assign(item.url);
  }

  function goToParentFolder() {
    goToFolderPath(folderPath.slice(0, -1));
  }

  function goToFolder(index: number) {
    goToFolderPath(folderPath.slice(0, index));
  }

  function goToFolderPath(path: string[]) {
    if (path.join("/") === folderPath.join("/")) return;

    setFolderPath(path);
    saveHistoryFolderPath(path);
  }

  return (
    <main
      ref={galleryRef}
      className="bookmark-gallery"
      tabIndex={-1}
      aria-busy={!snapshot && !error}
      onKeyDown={handleKeyDown}
    >
      <header className="bookmark-gallery__header">
        <nav className="bookmark-gallery__breadcrumbs" aria-label="Bookmark path">
          <button type="button" onClick={() => goToFolder(0)}>
            {rootFolder?.title ?? ROOT_TITLE}
          </button>
          {folderPath.map((folderId, index) => {
            const folder = snapshot ? getFolder(snapshot, folderId) : undefined;
            return (
              <button
                key={folderId}
                type="button"
                onClick={() => goToFolder(index + 1)}
              >
                {folder?.title ?? ROOT_TITLE}
              </button>
            );
          })}
        </nav>
      </header>

      {stateMessage ? (
        <p className="bookmark-gallery__state">{stateMessage}</p>
      ) : null}

      {items.length > 0 ? (
        <section
          ref={gridRef}
          className="bookmark-gallery__grid"
          aria-label="Bookmarks"
        >
          {items.map((item, index) => (
            <GalleryCard
              key={item.id}
              item={item}
              selected={index === selectedIndex}
              onClick={() => activateItem(item)}
              onFocus={() => setSelectedIndex(index)}
            />
          ))}
        </section>
      ) : null}

      <ShortcutBar />
    </main>
  );
}

interface GalleryCardProps {
  item: BookmarkGalleryItem;
  selected: boolean;
  onClick: () => void;
  onFocus: () => void;
}

function GalleryCard({ item, selected, onClick, onFocus }: GalleryCardProps) {
  return (
    <button
      type="button"
      className="bookmark-card"
      data-kind={item.kind}
      data-selected={selected}
      onClick={onClick}
      onFocus={onFocus}
    >
      {item.kind === "bookmark" ? (
        <BookmarkIcon bookmark={item} />
      ) : (
        <FolderIcon folder={item} />
      )}
      <span className="bookmark-card__title">{item.title}</span>
    </button>
  );
}

function BookmarkIcon({ bookmark }: { bookmark: BookmarkItem }) {
  return (
    <span className="bookmark-card__icon bookmark-card__icon--bookmark">
      {bookmark.faviconUrl ? (
        <img src={bookmark.faviconUrl} alt="" width="180" height="180" />
      ) : (
        <span className="bookmark-card__letter">{bookmark.title[0]}</span>
      )}
    </span>
  );
}

function FolderIcon({ folder }: { folder: BookmarkFolderItem }) {
  return (
    <span className="bookmark-card__icon bookmark-card__icon--folder">
      <span className="folder-preview" data-count={Math.min(folder.childCount, 4)}>
        {folder.previewItems.slice(0, 3).map((item) => (
          <FolderPreview key={item.id} faviconUrl={item.faviconUrl} />
        ))}
        {folder.childCount >= 4 ? (
          <span className="folder-preview__tile folder-preview__more">...</span>
        ) : null}
        {folder.childCount === 0 ? (
          <FolderGlyph />
        ) : null}
      </span>
    </span>
  );
}

function FolderPreview({ faviconUrl }: { faviconUrl?: string }) {
  if (faviconUrl) {
    return (
      <span className="folder-preview__tile">
        <img src={faviconUrl} alt="" width="72" height="72" />
      </span>
    );
  }

  return <FolderGlyph />;
}

function FolderGlyph() {
  return (
    <span className="folder-preview__tile folder-preview__folder">
      <span />
    </span>
  );
}

function ShortcutBar() {
  return (
    <footer className="shortcut-bar" aria-label="Keyboard shortcuts">
      {SHORTCUTS.map((shortcut) => (
        <Shortcut key={shortcut.label} {...shortcut} />
      ))}
    </footer>
  );
}

function Shortcut({ keys, label }: { keys: string[]; label: string }) {
  return (
    <span className="shortcut-bar__item">
      <span className="shortcut-bar__keys">
        {keys.map((key) => (
          <kbd key={key}>{key}</kbd>
        ))}
      </span>
      <span>{label}</span>
    </span>
  );
}

function getFolder(snapshot: BookmarkSnapshot, id?: string) {
  if (!id) return undefined;

  const item = snapshot.nodesById[id];
  return item?.kind === "folder" ? item : undefined;
}

function getFolderItems(
  snapshot: BookmarkSnapshot,
  folder: BookmarkFolderItem,
): BookmarkGalleryItem[] {
  return folder.childIds
    .map((id) => snapshot.nodesById[id])
    .filter((item): item is BookmarkGalleryItem => Boolean(item));
}

function getBookmarksBarFolder(snapshot: BookmarkSnapshot) {
  const topFolders = snapshot.topLevelIds
    .map((id) => getFolder(snapshot, id))
    .filter((folder): folder is BookmarkFolderItem => Boolean(folder));

  return (
    topFolders.find((folder) => folder.folderType === "bookmarks-bar") ??
    topFolders.find((folder) => folder.title.toLowerCase() === "bookmarks bar") ??
    getFolder(snapshot, snapshot.rootId)
  );
}

function getNextIndex(
  key: string,
  currentIndex: number,
  itemCount: number,
  columnCount: number,
) {
  if (key === "ArrowRight") return Math.min(currentIndex + 1, itemCount - 1);
  if (key === "ArrowLeft") return Math.max(currentIndex - 1, 0);
  if (key === "ArrowDown") return Math.min(currentIndex + columnCount, itemCount - 1);
  if (key === "ArrowUp") return Math.max(currentIndex - columnCount, 0);
  return currentIndex;
}

function getGridColumnCount(grid: HTMLElement | null) {
  return grid
    ? getComputedStyle(grid).gridTemplateColumns.split(" ").filter(Boolean).length
    : 1;
}

function getHistoryFolderPath(state = window.history.state): string[] {
  if (!state || typeof state !== "object") return [];

  const path = (state as Record<string, unknown>)[HISTORY_FOLDER_PATH_KEY];
  return Array.isArray(path) && path.every((id) => typeof id === "string")
    ? path
    : [];
}

function saveHistoryFolderPath(path: string[], replace = false) {
  const method = replace ? "replaceState" : "pushState";
  const state = {
    ...(window.history.state && typeof window.history.state === "object"
      ? window.history.state
      : {}),
    [HISTORY_FOLDER_PATH_KEY]: path,
  };

  window.history[method](state, "");
}
