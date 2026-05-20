import { defineConfig } from "wxt";

// See https://wxt.dev/api/config.html
export default defineConfig({
  modules: ["@wxt-dev/module-react", "@wxt-dev/auto-icons"],
  dev: {
    server: {
      host: "127.0.0.1",
      port: 3001,
      origin: "http://127.0.0.1:3001",
    },
  },
  autoIcons: {
    developmentIndicator: false,
  },
  outDir: "dist",
  vite: () => ({
    optimizeDeps: {
      entries: ["entrypoints/**/*.html"],
    },
  }),
  manifest: {
    permissions: ["activeTab", "alarms", "bookmarks", "favicon", "storage"],
    host_permissions: [
      "https://icon.souple.dev/*",
      "http://*/*",
      "https://*/*",
    ],
    web_accessible_resources: [
      {
        resources: ["_favicon/*"],
        matches: ["<all_urls>"],
        extension_ids: ["*"],
      },
    ],
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
        "script-src 'self'; object-src 'self'; img-src 'self' https://icon.souple.dev data: blob:; connect-src 'self' http://*:* https://* ws://localhost:* ws://127.0.0.1:* https://icon.souple.dev https://o4511342694432768.ingest.de.sentry.io;",
    },
  },
});
