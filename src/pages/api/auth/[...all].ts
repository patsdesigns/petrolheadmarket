import type { APIRoute } from "astro";
import { getAuth } from "../../../lib/auth";
import { url } from "../../../lib/paths";

// Better Auth's HTTP API, mounted at /api/auth/*. Only the GET links a
// browser opens are public: the confirm email link, the reset password link
// (which forwards to /reset-password) and get-session. Everything else
// (sign in, sign up, resets, changes) goes through our own form handlers via
// callAuth(), which calls auth.handler in process, never this route.
function allowed(request: Request): boolean {
  if (request.method !== "GET") return false;
  const rest = new URL(request.url).pathname.slice(url("/api/auth").length);
  return rest === "/verify-email" || rest === "/get-session" || /^\/reset-password\/[^/]+$/.test(rest);
}

export const ALL: APIRoute = ({ request }) => {
  if (!allowed(request)) return new Response("Not found", { status: 404 });
  return getAuth().handler(request);
};
