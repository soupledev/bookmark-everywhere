import { reactRootOptions } from "@/src/instrument";

import React from "react";
import ReactDOM from "react-dom/client";
import type { ContentScriptContext } from "wxt/utils/content-script-context";
import type { ShadowRootContentScriptUi } from "wxt/utils/content-script-ui/shadow-root";

import bookmarkGalleryCss from "@/src/bookmarks/components/BookmarkGallery.css?inline";
import { BookmarkGallery } from "@/src/bookmarks/components/BookmarkGallery";
import { isToggleBookmarkDialogMessage } from "@/src/bookmarks/dialogMessages";

let dialogUi: ShadowRootContentScriptUi<ReactDOM.Root> | undefined;
let dialogUiPromise:
  | Promise<ShadowRootContentScriptUi<ReactDOM.Root>>
  | undefined;

export default defineContentScript({
  matches: ["<all_urls>"],
  cssInjectionMode: "manual",
  main(ctx) {
    browser.runtime.onMessage.addListener((message) => {
      if (isToggleBookmarkDialogMessage(message)) {
        void toggleBookmarkDialog(ctx);
      }
    });
  },
});

async function toggleBookmarkDialog(ctx: ContentScriptContext) {
  if (dialogUi) {
    closeBookmarkDialog();
    return;
  }

  if (dialogUiPromise) {
    const pendingUi = await dialogUiPromise;
    pendingUi.remove();
    dialogUiPromise = undefined;
    return;
  }

  dialogUiPromise = createBookmarkDialogUi(ctx);
  const nextDialogUi = await dialogUiPromise;
  dialogUiPromise = undefined;

  if (ctx.isInvalid) {
    nextDialogUi.remove();
    return;
  }

  dialogUi = nextDialogUi;
  dialogUi.mount();
}

async function createBookmarkDialogUi(ctx: ContentScriptContext) {
  return await createShadowRootUi<ReactDOM.Root>(ctx, {
    name: "bookmark-everywhere-dialog",
    position: "inline",
    anchor: document.documentElement,
    isolateEvents: true,
    css: `${bookmarkGalleryCss}
      :host {
        position: fixed !important;
        inset: 0 !important;
        z-index: 2147483647 !important;
        display: block !important;
        color-scheme: light !important;
      }
    `,
    onMount: (container) => {
      const app = document.createElement("div");
      container.append(app);

      const root = ReactDOM.createRoot(app, reactRootOptions);
      root.render(
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
                allowChromeFavicons: false,
                enableHistory: false,
                isDialog: true,
                onRequestClose: closeBookmarkDialog,
              }),
            ),
          ),
        ),
      );

      return root;
    },
    onRemove: (root) => {
      root?.unmount();
      if (dialogUi?.mounted === root) dialogUi = undefined;
    },
  });
}

function closeBookmarkDialog() {
  dialogUi?.remove();
  dialogUi = undefined;
}
