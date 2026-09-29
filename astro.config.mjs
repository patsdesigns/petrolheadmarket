import { defineConfig } from "astro/config";
import cloudflare from "@astrojs/cloudflare";
import react from "@astrojs/react";

// Webflow Cloud mounts this app at /app on the public site.
// Every internal URL must go through the helpers in src/lib/paths.ts.
export default defineConfig({
  base: "/app",
  trailingSlash: "never",
  output: "server",
  compressHTML: true,
  // Our middleware checks Origin against PUBLIC_SITE_URL instead, because
  // behind the Webflow proxy the request URL may not match the browser origin.
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
