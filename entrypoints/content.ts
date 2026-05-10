import "@/src/instrument";

import * as Sentry from "@sentry/react";
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

  dialogRoot = ReactDOM.createRoot(dialogHost, {
    onCaughtError: Sentry.reactErrorHandler(),
    onRecoverableError: Sentry.reactErrorHandler(),
    onUncaughtError: Sentry.reactErrorHandler(),
  });
  dialogRoot.render(
    React.createElement(
      React.StrictMode,
      null,
      React.createElement(
        "div",
        {
          className: "bookmark-dialog-backdrop",
          onMouseDown: closeBookmarkDialog,
        },
        React.createElement(
          "div",
          {
            className: "bookmark-dialog-panel",
            role: "dialog",
            "aria-modal": true,
            onMouseDown: (event) => event.stopPropagation(),
          },
          React.createElement(BookmarkGallery, {
            allowRemoteFavicons: false,
            enableHistory: false,
            isDialog: true,
            onRequestClose: closeBookmarkDialog,
          }),
        ),
      ),
    ),
  );
}

function closeBookmarkDialog() {
  dialogRoot?.unmount();
  dialogRoot = undefined;
  dialogHost?.remove();
  dialogHost = undefined;
}
