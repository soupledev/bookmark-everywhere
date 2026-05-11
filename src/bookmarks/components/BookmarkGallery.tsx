import { useEffect, useRef, useState } from "react";
import type { KeyboardEvent } from "react";
import { browser } from "wxt/browser";

import { requestBookmarkSnapshot } from "../client";
import { getRemoteFaviconUrl } from "../model";
import type {
  BookmarkFolderItem,
  BookmarkGalleryItem,
  BookmarkItem,
  BookmarkSnapshot,
  FolderPreviewItem,
} from "../types";
import {
  dismissRatingPrompt,
  recordBookmarkUse,
} from "../../rating";
import "./BookmarkGallery.css";

const ROOT_TITLE = "Bookmarks";
const DEFAULT_DIALOG_TITLE = "Bookmarks";
const SHORTCUTS = [
  { keys: ["↑", "↓", "←", "→"], label: "Navigate" },
  { keys: ["Enter"], label: "Open" },
  { keys: ["Esc"], label: "Back" },
];
const LOW_QUALITY_FAVICON_SIZE = 32;
const CHROME_FAVICON_SIZE = 64;
const HISTORY_FOLDER_PATH_KEY = "bookmarkGalleryFolderPath";
type FaviconSource = "remote" | "chrome" | "initial";

interface BookmarkGalleryProps {
  allowChromeFavicons?: boolean;
  allowRemoteFavicons?: boolean;
  enableHistory?: boolean;
  isDialog?: boolean;
  onRequestClose?: () => void;
}

export function BookmarkGallery({
  allowChromeFavicons = true,
  allowRemoteFavicons = true,
  enableHistory = true,
  isDialog = false,
  onRequestClose,
}: BookmarkGalleryProps) {
  const [snapshot, setSnapshot] = useState<BookmarkSnapshot | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [folderPath, setFolderPath] = useState(() =>
    enableHistory ? getHistoryFolderPath() : [],
  );
  const [selectedIndex, setSelectedIndex] = useState<number | null>(
    isDialog ? 0 : null,
  );
  const [ratingUrl, setRatingUrl] = useState<string | null>(null);
  const galleryRef = useRef<HTMLElement | null>(null);
  const gridRef = useRef<HTMLElement | null>(null);

  const rootFolder = snapshot ? getBookmarksBarFolder(snapshot) : undefined;
  const activeFolder = snapshot
    ? getFolder(snapshot, folderPath.at(-1) ?? rootFolder?.id)
    : undefined;
  const items =
    snapshot && activeFolder ? getFolderItems(snapshot, activeFolder) : [];
  const isSelecting = selectedIndex !== null;
  const stateMessage =
    error ??
    (!snapshot
      ? "Loading bookmarks..."
      : items.length
        ? null
        : "No bookmarks here.");

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
    let isMounted = true;

    void recordBookmarkUse().then((url) => {
      if (isMounted) setRatingUrl(url);
    });

    return () => {
      isMounted = false;
    };
  }, []);

  useEffect(() => {
    if (!enableHistory) return;

    saveHistoryFolderPath(folderPath, true);

    const onPopState = (event: PopStateEvent) => {
      setFolderPath(getHistoryFolderPath(event.state));
    };

    window.addEventListener("popstate", onPopState);
    return () => window.removeEventListener("popstate", onPopState);
  }, [enableHistory]);

  useEffect(() => {
    setSelectedIndex((index) => (index === null ? null : 0));
  }, [activeFolder?.id]);

  useEffect(() => {
    if (selectedIndex === null) return;

    const selectedCard =
      gridRef.current?.querySelectorAll<HTMLButtonElement>(".bookmark-card")[
        selectedIndex
      ];
    (selectedCard ?? galleryRef.current)?.focus({ preventScroll: true });
    selectedCard?.scrollIntoView({ block: "nearest", inline: "nearest" });
  }, [selectedIndex, items.length]);

  function handleKeyDown(event: KeyboardEvent) {
    if (
      event.target instanceof HTMLElement &&
      event.target.closest(".rating-prompt")
    ) {
      return;
    }

    if (!isSelecting) {
      if (event.key === "Tab") {
        setSelectedIndex(0);
      }
      return;
    }

    if (event.key === "Escape") {
      event.preventDefault();
      goToParentFolder();
      return;
    }

    if (!items.length) return;

    if (event.key === "Enter" || event.key === " ") {
      event.preventDefault();
      const selectedItem = items[selectedIndex];
      if (selectedItem) {
        activateItem(
          selectedItem,
          !isDialog && (event.metaKey || event.ctrlKey),
        );
      }
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

  async function dismissRating() {
    await dismissRatingPrompt();
    setRatingUrl(null);
  }

  async function rateExtension() {
    if (!ratingUrl) return;

    window.open(ratingUrl, "_blank", "noopener,noreferrer");
    await dismissRating();
  }

  function activateItem(item: BookmarkGalleryItem, openInNewTab = false) {
    if (item.kind === "folder") {
      goToFolderPath([...folderPath, item.id]);
      return;
    }

    if (openInNewTab) {
      openBookmarkInNewTab(item.url);
      return;
    }

    window.location.assign(item.url);
  }

  function goToParentFolder() {
    if (folderPath.length === 0 && onRequestClose) {
      onRequestClose();
      return;
    }

    goToFolderPath(folderPath.slice(0, -1));
  }

  function goToFolder(index: number) {
    goToFolderPath(folderPath.slice(0, index));
  }

  function goToFolderPath(path: string[]) {
    if (path.join("/") === folderPath.join("/")) return;

    setFolderPath(path);
    if (enableHistory) saveHistoryFolderPath(path);
  }

  return (
    <main
      ref={galleryRef}
      className="bookmark-gallery"
      data-dialog={isDialog}
      tabIndex={isSelecting ? -1 : 0}
      aria-busy={!snapshot && !error}
      onKeyDown={handleKeyDown}
      onFocus={() => {
        if (!isSelecting && items.length) setSelectedIndex(0);
      }}
    >
      <header className="bookmark-gallery__header">
        <nav
          className="bookmark-gallery__breadcrumbs"
          aria-label="Bookmark path"
        >
          <button type="button" onClick={() => goToFolder(0)}>
            {rootFolder?.title ??
              (isDialog ? DEFAULT_DIALOG_TITLE : ROOT_TITLE)}
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
        {!isDialog && !isSelecting && items.length > 0 ? (
          <p className="bookmark-gallery__focus-hint">
            Press Tab to start selecting bookmarks.
          </p>
        ) : null}
      </header>

      {stateMessage ? (
        <p className="bookmark-gallery__state">{stateMessage}</p>
      ) : null}

      {ratingUrl ? (
        <RatingPrompt onDismiss={dismissRating} onRate={rateExtension} />
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
              allowChromeFavicons={allowChromeFavicons}
              allowRemoteFavicons={allowRemoteFavicons}
              selected={selectedIndex === index}
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

interface RatingPromptProps {
  onDismiss: () => void;
  onRate: () => void;
}

function RatingPrompt({ onDismiss, onRate }: RatingPromptProps) {
  return (
    <aside className="rating-prompt" aria-label="Rate Bookmark Everywhere">
      <div>
        <h2>Enjoying Bookmark Everywhere?</h2>
        <p>A quick rating helps other keyboard-first bookmark people find it.</p>
      </div>
      <div className="rating-prompt__actions">
        <button type="button" onClick={onDismiss}>
          Not now
        </button>
        <button type="button" onClick={onRate}>
          Rate it
        </button>
      </div>
    </aside>
  );
}

interface GalleryCardProps {
  item: BookmarkGalleryItem;
  allowChromeFavicons: boolean;
  allowRemoteFavicons: boolean;
  selected: boolean;
  onClick: () => void;
  onFocus: () => void;
}

function GalleryCard({
  item,
  allowChromeFavicons,
  allowRemoteFavicons,
  selected,
  onClick,
  onFocus,
}: GalleryCardProps) {
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
        <BookmarkIcon
          bookmark={item}
          allowChromeFavicons={allowChromeFavicons}
          allowRemoteFavicons={allowRemoteFavicons}
        />
      ) : (
        <FolderIcon
          folder={item}
          allowChromeFavicons={allowChromeFavicons}
          allowRemoteFavicons={allowRemoteFavicons}
        />
      )}
      <span className="bookmark-card__title">{item.title}</span>
    </button>
  );
}

function BookmarkIcon({
  bookmark,
  allowChromeFavicons,
  allowRemoteFavicons,
}: {
  bookmark: BookmarkItem;
  allowChromeFavicons: boolean;
  allowRemoteFavicons: boolean;
}) {
  const remoteFaviconUrl = allowRemoteFavicons
    ? getRemoteFaviconUrl(bookmark.url)
    : "";
  const [source, setSource] = useState<FaviconSource>(
    getInitialFaviconSource(remoteFaviconUrl, allowChromeFavicons),
  );
  const showInitial = source === "initial";
  const imageUrl =
    source === "remote"
      ? remoteFaviconUrl
      : source === "chrome"
        ? getChromeFaviconUrl(bookmark.url)
        : "";

  useEffect(() => {
    setSource(getInitialFaviconSource(remoteFaviconUrl, allowChromeFavicons));
  }, [allowChromeFavicons, remoteFaviconUrl]);

  return (
    <span
      className={`bookmark-card__icon bookmark-card__icon--bookmark ${
        source === "chrome" ? "bookmark-card__icon--chrome-favicon" : ""
      }`}
    >
      {showInitial ? (
        <span className="bookmark-card__letter">{bookmark.title[0]}</span>
      ) : (
        <img
          src={imageUrl}
          alt=""
          width="128"
          height="128"
          onError={() =>
            setSource(
              source === "remote" && allowChromeFavicons
                ? "chrome"
                : "initial",
            )
          }
          onLoad={(event) => {
            if (
              source === "remote" &&
              allowChromeFavicons &&
              isLowQualityFavicon(event.currentTarget)
            ) {
              setSource("chrome");
            }
          }}
        />
      )}
    </span>
  );
}

function FolderIcon({
  folder,
  allowChromeFavicons,
  allowRemoteFavicons,
}: {
  folder: BookmarkFolderItem;
  allowChromeFavicons: boolean;
  allowRemoteFavicons: boolean;
}) {
  return (
    <span className="bookmark-card__icon bookmark-card__icon--folder">
      <span
        className="folder-preview"
        data-count={Math.min(folder.childCount, 4)}
      >
        {folder.previewItems.slice(0, 3).map((item) => (
          <FolderPreview
            key={item.id}
            item={item}
            allowChromeFavicons={allowChromeFavicons}
            allowRemoteFavicons={allowRemoteFavicons}
          />
        ))}
        {folder.childCount >= 4 ? (
          <span className="folder-preview__tile folder-preview__more">...</span>
        ) : null}
        {folder.childCount === 0 ? <FolderGlyph /> : null}
      </span>
    </span>
  );
}

function FolderPreview({
  item,
  allowChromeFavicons,
  allowRemoteFavicons,
}: {
  item: FolderPreviewItem;
  allowChromeFavicons: boolean;
  allowRemoteFavicons: boolean;
}) {
  const remoteFaviconUrl =
    item.url && allowRemoteFavicons ? getRemoteFaviconUrl(item.url) : "";
  const canUseChromeFavicon = allowChromeFavicons && !!item.url;
  const [source, setSource] = useState<FaviconSource>(
    getInitialFaviconSource(remoteFaviconUrl, canUseChromeFavicon),
  );
  const imageUrl =
    source === "remote"
      ? remoteFaviconUrl
      : source === "chrome" && item.url
        ? getChromeFaviconUrl(item.url)
        : "";

  useEffect(() => {
    setSource(
      getInitialFaviconSource(remoteFaviconUrl, canUseChromeFavicon),
    );
  }, [canUseChromeFavicon, remoteFaviconUrl]);

  if (imageUrl && source !== "initial") {
    return (
      <span className="folder-preview__tile">
        <img
          src={imageUrl}
          alt=""
          width="42"
          height="42"
          onError={() =>
            setSource(
              source === "remote" && allowChromeFavicons && item.url
                ? "chrome"
                : "initial",
            )
          }
          onLoad={(event) => {
            if (
              source === "remote" &&
              allowChromeFavicons &&
              isLowQualityFavicon(event.currentTarget)
            ) {
              setSource(item.url ? "chrome" : "initial");
            }
          }}
        />
      </span>
    );
  }

  return <FolderGlyph />;
}

function getInitialFaviconSource(
  remoteFaviconUrl: string,
  allowChromeFavicons: boolean,
): FaviconSource {
  if (remoteFaviconUrl) return "remote";
  return allowChromeFavicons ? "chrome" : "initial";
}

function isLowQualityFavicon(image: HTMLImageElement) {
  return (
    image.naturalWidth <= LOW_QUALITY_FAVICON_SIZE ||
    image.naturalHeight <= LOW_QUALITY_FAVICON_SIZE
  );
}

function getChromeFaviconUrl(pageUrl: string) {
  const faviconPath = `/_favicon/?pageUrl=${encodeURIComponent(pageUrl)}&size=${CHROME_FAVICON_SIZE}`;
  return browser.runtime.getURL(
    faviconPath as Parameters<typeof browser.runtime.getURL>[0],
  );
}

function openBookmarkInNewTab(url: string) {
  window.open(url, "_blank", "noopener,noreferrer");
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
    topFolders.find(
      (folder) => folder.title.toLowerCase() === "bookmarks bar",
    ) ??
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
  if (key === "ArrowDown")
    return Math.min(currentIndex + columnCount, itemCount - 1);
  if (key === "ArrowUp") return Math.max(currentIndex - columnCount, 0);
  return currentIndex;
}

function getGridColumnCount(grid: HTMLElement | null) {
  return grid
    ? getComputedStyle(grid).gridTemplateColumns.split(" ").filter(Boolean)
        .length
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
