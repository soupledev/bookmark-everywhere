import "@/src/instrument";

import * as Sentry from "@sentry/react";
import React from "react";
import ReactDOM from "react-dom/client";

import { BookmarkGallery } from "@/src/bookmarks/components/BookmarkGallery";

ReactDOM.createRoot(document.getElementById("root")!, {
  onCaughtError: Sentry.reactErrorHandler(),
  onRecoverableError: Sentry.reactErrorHandler(),
  onUncaughtError: Sentry.reactErrorHandler(),
}).render(
  <React.StrictMode>
    <BookmarkGallery />
  </React.StrictMode>,
);
