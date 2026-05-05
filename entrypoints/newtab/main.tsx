import React from "react";
import ReactDOM from "react-dom/client";

import { BookmarkGallery } from "@/src/bookmarks/components/BookmarkGallery";

ReactDOM.createRoot(document.getElementById("root")!).render(
  <React.StrictMode>
    <BookmarkGallery />
  </React.StrictMode>,
);
