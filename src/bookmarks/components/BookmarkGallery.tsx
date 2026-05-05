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

export function BookmarkGallery() {
  const [snapshot, setSnapshot] = useState<BookmarkSnapshot | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [folderPath, setFolderPath] = useState<string[]>([]);
  const [selectedIndex, setSelectedIndex] = useState(0);
  const galleryRef = useRef<HTMLElement | null>(null);
  const cardRefs = useRef<Array<HTMLButtonElement | null>>([]);

  const rootFolder = snapshot ? getBookmarksBarFolder(snapshot) : undefined;
  const activeFolder = snapshot
    ? getFolder(snapshot, folderPath.at(-1) ?? rootFolder?.id)
    : undefined;
  const items = snapshot && activeFolder ? getFolderItems(snapshot, activeFolder) : [];

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
    setSelectedIndex(0);
    cardRefs.current = [];
  }, [activeFolder?.id]);

  useEffect(() => {
    const selectedCard = cardRefs.current[selectedIndex];
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
      activateItem(items[selectedIndex]);
      return;
    }

    const nextIndex = getNextIndex(event.key, selectedIndex, cardRefs.current);
    if (nextIndex !== selectedIndex) {
      event.preventDefault();
      setSelectedIndex(nextIndex);
    }
  }

  function activateItem(item: BookmarkGalleryItem) {
    if (item.kind === "folder") {
      setFolderPath((path) => [...path, item.id]);
      return;
    }

    window.location.assign(item.url);
  }

  function goToParentFolder() {
    setFolderPath((path) => path.slice(0, -1));
  }

  function goToFolder(index: number) {
    setFolderPath((path) => path.slice(0, index));
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

      {error ? <p className="bookmark-gallery__state">{error}</p> : null}
      {!snapshot && !error ? (
        <p className="bookmark-gallery__state">Loading bookmarks...</p>
      ) : null}
      {snapshot && items.length === 0 ? (
        <p className="bookmark-gallery__state">No bookmarks here.</p>
      ) : null}

      {items.length > 0 ? (
        <section className="bookmark-gallery__grid" aria-label="Bookmarks">
          {items.map((item, index) => (
            <GalleryCard
              key={item.id}
              item={item}
              selected={index === selectedIndex}
              refCallback={(node) => {
                cardRefs.current[index] = node;
              }}
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
  refCallback: (node: HTMLButtonElement | null) => void;
  onClick: () => void;
  onFocus: () => void;
}

function GalleryCard({
  item,
  selected,
  refCallback,
  onClick,
  onFocus,
}: GalleryCardProps) {
  return (
    <button
      ref={refCallback}
      type="button"
      className="bookmark-card"
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
  const previews = folder.previewItems.slice(0, 3);
  const showOverflow = folder.childCount >= 4;
  const showFolderTile = folder.childCount < 4;

  return (
    <span className="bookmark-card__icon bookmark-card__icon--folder">
      <span className="folder-preview">
        {previews.map((item) => (
          <FolderPreview key={item.id} faviconUrl={item.faviconUrl} />
        ))}
        {showOverflow ? (
          <span className="folder-preview__tile folder-preview__more">...</span>
        ) : null}
        {showFolderTile ? <FolderGlyph /> : null}
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
      <Shortcut keys={["↑", "↓", "←", "→"]} label="Navigate" />
      <Shortcut keys={["Enter"]} label="Open" />
      <Shortcut keys={["Esc"]} label="Back" />
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
  cards: Array<HTMLButtonElement | null>,
) {
  if (key === "ArrowRight") return Math.min(currentIndex + 1, cards.length - 1);
  if (key === "ArrowLeft") return Math.max(currentIndex - 1, 0);
  if (key !== "ArrowDown" && key !== "ArrowUp") return currentIndex;

  const current = cards[currentIndex]?.getBoundingClientRect();
  if (!current) return currentIndex;

  const candidates = cards
    .map((card, index) => ({ card, index }))
    .filter(({ card }) => {
      const rect = card?.getBoundingClientRect();
      if (!rect) return false;
      return key === "ArrowDown"
        ? rect.top > current.top + 8
        : rect.top < current.top - 8;
    });

  let nearest = currentIndex;
  let nearestDistance = Number.POSITIVE_INFINITY;

  for (const { card, index } of candidates) {
    const rect = card?.getBoundingClientRect();
    if (!rect) continue;

    const distance =
      Math.abs(rect.left - current.left) +
      Math.abs(rect.top - current.top) * 0.2;

    if (distance < nearestDistance) {
      nearest = index;
      nearestDistance = distance;
    }
  }

  return nearest;
}
