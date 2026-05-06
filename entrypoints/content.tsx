import React from "react";
import ReactDOM from "react-dom/client";

import { BookmarkGallery } from "@/src/bookmarks/components/BookmarkGallery";
import { isToggleBookmarkDialogMessage } from "@/src/bookmarks/dialogMessages";

let dialogRoot: ReactDOM.Root | undefined;
let dialogHost: HTMLDivElement | undefined;

export default defineContentScript({
  matches: ["<all_urls>"],
  main() {
    browser.runtime.onMessage.addListener((message) => {
      if (isToggleBookmarkDialogMessage(message)) {
        toggleBookmarkDialog();
      }
    });
  },
});

function toggleBookmarkDialog() {
  if (dialogHost) {
    closeBookmarkDialog();
    return;
  }

  dialogHost = document.createElement("div");
  dialogHost.className = "bookmark-dialog-host";
  document.documentElement.append(dialogHost);

  dialogRoot = ReactDOM.createRoot(dialogHost);
  dialogRoot.render(
    <React.StrictMode>
      <div className="bookmark-dialog-backdrop" onMouseDown={closeBookmarkDialog}>
        <div
          className="bookmark-dialog-panel"
          role="dialog"
          aria-modal="true"
          onMouseDown={(event) => event.stopPropagation()}
        >
          <BookmarkGallery
            enableHistory={false}
            isDialog
            onRequestClose={closeBookmarkDialog}
          />
        </div>
      </div>
    </React.StrictMode>,
  );
}

function closeBookmarkDialog() {
  dialogRoot?.unmount();
  dialogRoot = undefined;
  dialogHost?.remove();
  dialogHost = undefined;
}
