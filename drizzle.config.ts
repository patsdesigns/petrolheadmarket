import { defineConfig } from "drizzle-kit";

// Migrations are written to ./drizzle, which wrangler.json lists as the
// D1 migrations_dir. Webflow Cloud applies them on every deploy.
export default defineConfig({
  dialect: "sqlite",
  schema: "./src/db/schema.ts",
  out: "./drizzle",
});
