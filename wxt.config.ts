import { defineConfig } from "wxt";

// See https://wxt.dev/api/config.html
export default defineConfig({
  modules: ["@wxt-dev/module-react", "@wxt-dev/auto-icons"],
  autoIcons: {
    developmentIndicator: false,
  },
  outDir: "dist",
  manifest: {
    permissions: ["activeTab", "bookmarks", "favicon", "storage"],
    commands: {
      "open-bookmark-gallery": {
        suggested_key: {
          default: "Ctrl+Shift+K",
          mac: "Command+Shift+K",
        },
        description: "Open bookmark gallery",
      },
    },
    content_security_policy: {
      extension_pages:
        "script-src 'self'; object-src 'self'; img-src 'self' https://icon.horse data:; connect-src 'self' https://o4511342694432768.ingest.de.sentry.io;",
    },
  },
});
