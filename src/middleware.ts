import { defineMiddleware } from "astro:middleware";
import { getAuth } from "./lib/auth";
import { ensureProfile } from "./lib/profile";
import { publicOrigin } from "./lib/config";
import { basePath, url } from "./lib/paths";
import { safeNext } from "./lib/forms";
import { unreadCount } from "./lib/messaging";

// Paths (relative to /app) anyone can open without signing in.
const PUBLIC_PREFIXES = [
  "/login",
  "/signup",
  "/forgot-password",
  "/reset-password",
  "/verify-email",
  "/api/",
  "/photos/",
  "/404",
];
// Signed-in people are sent on from these.
const GUEST_ONLY = ["/login", "/signup", "/forgot-password"];

function appPath(pathname: string): string {
  const rest = pathname.startsWith(basePath) ? pathname.slice(basePath.length) : pathname;
  return rest === "" ? "/" : rest;
}

function matches(path: string, prefixes: string[]): boolean {
  return prefixes.some((p) => (p.endsWith("/") ? path.startsWith(p) : path === p || path.startsWith(`${p}/`)));
}

/**
 * CSRF protection for our own form posts and API mutations. Better Auth checks
 * its own routes. Browsers always send Origin on cross-site POSTs, so a
 * mismatch (or no Origin and no matching Referer) is rejected.
 */
function sameOrigin(request: Request): boolean {
  const allowed = new Set([publicOrigin(), new URL(request.url).origin]);
  const origin = request.headers.get("origin");
  if (origin) return allowed.has(origin);
  const referer = request.headers.get("referer");
  if (referer) {
    try {
      return allowed.has(new URL(referer).origin);
    } catch {
      return false;
    }
  }
  return false;
}

export const onRequest = defineMiddleware(async (context, next) => {
  const { request } = context;
  const path = appPath(context.url.pathname);
  const isMutation = !["GET", "HEAD", "OPTIONS"].includes(request.method);

  if (isMutation && !path.startsWith("/api/auth/") && !sameOrigin(request)) {
    return new Response("Forbidden", { status: 403 });
  }

  context.locals.user = null;
  context.locals.session = null;
  context.locals.profile = null;
  context.locals.unread = 0;

  // Better Auth's own routes and public photos don't need the session lookup.
  if (!path.startsWith("/api/auth/") && !path.startsWith("/photos/")) {
    const data = await getAuth().api.getSession({ headers: request.headers });
    if (data) {
      context.locals.user = data.user;
      context.locals.session = data.session;
      context.locals.profile = await ensureProfile(data.user);
      // Header badge; API calls don't render the header.
      if (!path.startsWith("/api/")) context.locals.unread = await unreadCount(data.user.id);
    }
  }

  const signedIn = context.locals.user !== null;

  if (!signedIn && !matches(path, PUBLIC_PREFIXES)) {
    const back = `${context.url.pathname}${context.url.search}`;
    return context.redirect(`${url("/login")}?next=${encodeURIComponent(back)}`, 303);
  }

  if (signedIn && matches(path, GUEST_ONLY)) {
    return context.redirect(safeNext(context.url.searchParams.get("next")), 303);
  }

  if (path === "/admin" || path.startsWith("/admin/")) {
    if (context.locals.profile?.role !== "admin") {
      // Don't reveal that admin pages exist.
      return context.rewrite(url("/404"));
    }
  }

  const response = await next();
  if (signedIn) response.headers.set("Cache-Control", "private, no-store");
  return response;
});
