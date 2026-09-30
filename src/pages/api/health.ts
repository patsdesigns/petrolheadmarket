import type { APIRoute } from "astro";
import { env } from "cloudflare:workers";

// Deploy check: storage bindings work and which settings are still missing.
// Only reports setting names, never values.
const REQUIRED = ["BETTER_AUTH_SECRET", "PUBLIC_SITE_URL", "ADMIN_EMAILS"] as const;
const FOR_EMAIL = ["RESEND_API_KEY", "EMAIL_FROM"] as const;
// The site and collection IDs have defaults in src/lib/webflow.ts.
const FOR_PUBLISHING = ["WEBFLOW_API_TOKEN"] as const;

export const GET: APIRoute = async () => {
  const checks: Record<string, "ok" | "missing" | "error"> = {};

  try {
    await env.DB.prepare("select 1").first();
    checks.db = "ok";
  } catch {
    checks.db = env.DB ? "error" : "missing";
  }

  try {
    await env.PHOTOS.list({ limit: 1 });
    checks.photos = "ok";
  } catch {
    checks.photos = env.PHOTOS ? "error" : "missing";
  }

  const missing = (keys: readonly string[]) => keys.filter((k) => !env[k as keyof typeof env]);
  const settings = {
    missingRequired: missing(REQUIRED),
    missingForEmail: missing(FOR_EMAIL),
    missingForPublishing: missing(FOR_PUBLISHING),
  };

  const ok = Object.values(checks).every((v) => v === "ok") && settings.missingRequired.length === 0;
  return new Response(JSON.stringify({ ok, checks, settings }, null, 2), {
    status: ok ? 200 : 503,
    headers: { "Content-Type": "application/json", "Cache-Control": "no-store" },
  });
};
