import { defineConfig } from "wxt";

// See https://wxt.dev/api/config.html
export default defineConfig({
  modules: ["@wxt-dev/module-react"],
  outDir: "dist",
  manifest: {
    permissions: ["bookmarks", "storage"],
    content_security_policy: {
      extension_pages:
        "script-src 'self'; object-src 'self'; img-src 'self' https://icon.horse data:;",
    },
  },
});
