import { defineConfig } from "astro/config";
import cloudflare from "@astrojs/cloudflare";
import react from "@astrojs/react";

// The whole site (the Lot, car pages and every account page) is this one app,
// served from the site root on Cloudflare Workers.
// Every internal URL goes through the helpers in src/lib/paths.ts.
export default defineConfig({
  trailingSlash: "never",
  output: "server",
  compressHTML: true,
  // Our middleware checks Origin itself (against PUBLIC_SITE_URL and the
  // request's own origin), so a custom domain and workers.dev both work.
  security: { checkOrigin: false },
  adapter: cloudflare({
    // Photos are resized in the browser and served straight from R2.
    imageService: "passthrough",
  }),
  integrations: [react()],
  vite: {
    resolve: {
      // Use react-dom/server.edge instead of react-dom/server.browser for React 19.
      // Without this, MessageChannel from node:worker_threads needs to be polyfilled.
      alias: import.meta.env.PROD
        ? { "react-dom/server": "react-dom/server.edge" }
        : undefined,
    },
  },
});
