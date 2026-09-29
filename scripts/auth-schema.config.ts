// Used only by `npm run auth:schema` to generate the Better Auth tables
// in src/db/auth-schema.ts. Keep its schema-affecting options in sync
// with src/lib/auth.ts (plugins, rateLimit storage, additional fields).
import { betterAuth } from "better-auth";
import { drizzleAdapter } from "better-auth/adapters/drizzle";

export const auth = betterAuth({
  database: drizzleAdapter({}, { provider: "sqlite" }),
  emailAndPassword: { enabled: true },
  rateLimit: { enabled: true, storage: "database" },
});
