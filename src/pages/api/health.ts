import type { APIRoute } from "astro";
import { env } from "cloudflare:workers";

// Deploy check: confirms the D1 and R2 bindings are wired up.
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

  const ok = Object.values(checks).every((v) => v === "ok");
  return new Response(JSON.stringify({ ok, checks }), {
    status: ok ? 200 : 503,
    headers: { "Content-Type": "application/json", "Cache-Control": "no-store" },
  });
};
