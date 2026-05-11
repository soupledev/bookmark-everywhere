import { reactRootOptions } from "@/src/instrument";

import React, { useEffect, useState } from "react";
import ReactDOM from "react-dom/client";

import {
  getWelcomeProgress,
  onWelcomeProgressChange,
  type WelcomeProgress,
} from "@/src/onboarding";
import "./style.css";

const GITHUB_URL = "https://github.com/soupledev/bookmark-everywhere";

function WelcomePage() {
  const [progress, setProgress] = useState<WelcomeProgress>({
    shortcutUsed: false,
  });
  const shortcut = getShortcutLabel();

  useEffect(() => {
    void getWelcomeProgress().then(setProgress);
    return onWelcomeProgressChange(setProgress);
  }, []);

  return (
    <main className="welcome-page">
      <section className="welcome-card" aria-labelledby="welcome-title">
        <p className="welcome-card__eyebrow">Bookmark Everywhere</p>
        <h1 id="welcome-title">Open your bookmarks everywhere.</h1>
        <p className="welcome-card__intro">
          Use <kbd>{shortcut}</kbd> anywhere in Chrome to open your bookmark
          gallery.
        </p>

        <div className="welcome-checklist" aria-label="Setup checklist">
          <div
            className="welcome-checklist__item"
            data-complete={progress.shortcutUsed}
          >
            <span className="welcome-checklist__mark" aria-hidden="true">
              {progress.shortcutUsed ? "✓" : "1"}
            </span>
            <div>
              <h2>Try the shortcut once</h2>
              <p>
                Press <kbd>{shortcut}</kbd>. This item checks itself off after
                the shortcut runs.
              </p>
            </div>
          </div>
        </div>

        <p className="welcome-card__feedback">
          Ideas, feedback, and feature requests live on{" "}
          <a href={GITHUB_URL} target="_blank" rel="noreferrer">
            GitHub
          </a>{" "}
          or at <a href="mailto:bookmark@souple.dev">bookmark@souple.dev</a>.
        </p>

        <button
          type="button"
          className="welcome-card__close"
          disabled={!progress.shortcutUsed}
          onClick={() => window.close()}
        >
          {progress.shortcutUsed ? "Close this page" : "Try the shortcut first"}
        </button>
      </section>
    </main>
  );
}

function getShortcutLabel() {
  return /Mac|iPhone|iPad|iPod/.test(navigator.platform)
    ? "Cmd Shift K"
    : "Ctrl Shift K";
}

ReactDOM.createRoot(document.getElementById("root")!, reactRootOptions).render(
  <React.StrictMode>
    <WelcomePage />
  </React.StrictMode>,
);
