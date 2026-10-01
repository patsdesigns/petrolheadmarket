import { defineMiddleware } from "astro:middleware";
import type { APIContext, MiddlewareNext } from "astro";
import { getAuth } from "./lib/auth";
import { ensureProfile, roleFor } from "./lib/profile";
import { publicOrigin } from "./lib/config";
import { url } from "./lib/paths";
import { safeNext } from "./lib/forms";
import { unreadCount } from "./lib/messaging";
import { adminCounts, NO_ADMIN_COUNTS } from "./lib/admin-counts";
import { safeError } from "./lib/log";

// Paths anyone can open without signing in. The Lot ("/") is public too.
const PUBLIC_PREFIXES = [
  "/cars/",
  "/login",
  "/signup",
  "/forgot-password",
  "/reset-password",
  "/verify-email",
  "/api/",
  "/photos/",
  "/404",
  "/suspended",
  "/contact",
  "/how-it-works",
];
// Pages that look the listing up before asking anyone to sign in (a car that
// is no longer on the Lot gets a friendly page, not a sign-up form). Only GET
// and HEAD pass; the page itself sends signed-out visitors of a real listing to login.
const PAGE_CHECKS_AUTH = ["/offer", "/message"];
// Signed-in people are sent on from these.
const GUEST_ONLY = ["/login", "/signup", "/forgot-password"];


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

let loggedHeaderNames = false;

/**
 * Read any request body the route left unread (an early error, a redirect).
 * An unread upload left on a kept-alive connection breaks the next request
 * on it in the local dev proxy, and costs nothing to drain.
 */
async function drain(request: Request): Promise<void> {
  if (request.body && !request.bodyUsed) await request.arrayBuffer().catch(() => undefined);
}

export const onRequest = defineMiddleware(async (context, next) => {
  const response = await handle(context, next);
  await drain(context.request);
  return response;
});

const handle = async (context: APIContext, next: MiddlewareNext): Promise<Response> => {
  const { request } = context;
  // Once per worker: record which header names arrive (names only, never
  // values) so we can confirm which one carries the visitor IP.
  if (!loggedHeaderNames) {
    loggedHeaderNames = true;
    console.log("[headers] names:", [...request.headers.keys()].sort().join(", "));
  }
  const path = context.url.pathname || "/";

  // Links from before the move off Webflow pointed into /app. Send them on.
  if (path === "/app" || path.startsWith("/app/")) {
    const rest = path === "/app" ? "/garage" : path.slice(4);
    return context.redirect(`${rest}${context.url.search}`, 301);
  }

  const isMutation = !["GET", "HEAD", "OPTIONS"].includes(request.method);

  if (isMutation && !path.startsWith("/api/auth/") && !sameOrigin(request)) {
    return new Response("Forbidden", { status: 403 });
  }

  context.locals.user = null;
  context.locals.session = null;
  context.locals.profile = null;
  context.locals.unread = 0;
  context.locals.adminCounts = NO_ADMIN_COUNTS;
  context.locals.suspended = false;

  // Better Auth refreshes the session once a day and sends a new cookie on
  // its response headers. Pass those cookies on with every response below,
  // or the browser's cookie would still expire 30 days after sign in.
  let authCookies: string[] = [];
  const cookieName = (c: string) => c.slice(0, c.indexOf("=")).trim();
  const withAuthCookies = (response: Response): Response => {
    if (authCookies.length === 0) return response;
    // A page that signed someone in or out set its own session cookies,
    // which must win over the refreshed ones.
    const own = new Set(response.headers.getSetCookie().map(cookieName));
    const add = authCookies.filter((c) => !own.has(cookieName(c)));
    if (add.length === 0) return response;
    let out = response;
    try {
      for (const c of add) out.headers.append("set-cookie", c);
    } catch {
      // Redirect and rewrite responses can have immutable headers.
      out = new Response(response.body, response);
      for (const c of add) out.headers.append("set-cookie", c);
    }
    return out;
  };

  // Better Auth's own routes and public photos don't need the session
  // lookup (so they stay cacheable and cost no D1 reads).
  if (!path.startsWith("/api/auth/") && !path.startsWith("/photos/") && path !== "/api/health") {
    // If auth can't start (for example BETTER_AUTH_SECRET is not set yet),
    // treat the visitor as signed out rather than failing every page.
    const result = await (async () =>
      getAuth().api.getSession({ headers: request.headers, returnHeaders: true }))().catch((err) => {
      console.error("[auth] session lookup failed", safeError(err));
      return null;
    });
    authCookies = result?.headers?.getSetCookie?.() ?? [];
    const data = result?.response ?? null;
    if (data) {
      // The profile, the unread badge and the admin to-do counts don't depend
      // on each other, so they go to the database together (one round trip
      // of waiting instead of three). The role comes from roleFor(), which is
      // what ensureProfile() syncs the stored role to.
      const pageRequest = !path.startsWith("/api/");
      const [profile, unread, counts] = await Promise.all([
        // Sync the admin role on every request (writes only when it changes).
        ensureProfile(data.user, true),
        pageRequest ? unreadCount(data.user.id) : Promise.resolve(0),
        pageRequest && roleFor(data.user) === "admin" ? adminCounts() : Promise.resolve(NO_ADMIN_COUNTS),
      ]);
      if (profile.suspendedAt) {
        // Suspended by an admin: treated as signed out everywhere. Their
        // sessions were deleted when suspended, so this only catches a race.
        context.locals.suspended = true;
      } else {
        context.locals.user = data.user;
        context.locals.session = data.session;
        context.locals.profile = profile;
        // Header badge (API calls don't render the header) and the admin
        // to-do counts for the header, admin tabs and My Garage. With email
        // off the counts are how the owner hears about new work.
        context.locals.unread = unread;
        if (profile.role === "admin") context.locals.adminCounts = counts;
      }
    }
  }

  // A suspended person only sees the notice (and can sign out).
  if (context.locals.suspended && path !== "/logout" && path !== "/" && !matches(path, PUBLIC_PREFIXES)) {
    if (isMutation && request.headers.get("x-autosave") === "1") {
      return withAuthCookies(
        new Response(JSON.stringify({ ok: false, reason: "suspended" }), {
          status: 403,
          headers: { "Content-Type": "application/json", "Cache-Control": "no-store" },
        }),
      );
    }
    if (isMutation) return withAuthCookies(new Response("Your account is suspended.", { status: 403 }));
    return withAuthCookies(context.redirect(url("/suspended"), 303));
  }

  const signedIn = context.locals.user !== null;

  const suspendedSignOut = context.locals.suspended && path === "/logout";
  const pageChecksAuth = PAGE_CHECKS_AUTH.includes(path) && (request.method === "GET" || request.method === "HEAD");
  if (!signedIn && path !== "/" && !matches(path, PUBLIC_PREFIXES) && !suspendedSignOut && !pageChecksAuth) {
    // The wizard's autosave is a fetch: a redirect to the login page would
    // look like a successful save, so tell it plainly instead.
    if (isMutation && request.headers.get("x-autosave") === "1") {
      return withAuthCookies(
        new Response(JSON.stringify({ ok: false, reason: "signed_out" }), {
          status: 401,
          headers: { "Content-Type": "application/json", "Cache-Control": "no-store" },
        }),
      );
    }
    const back = `${context.url.pathname}${context.url.search}`;
    return withAuthCookies(context.redirect(`${url("/login")}?next=${encodeURIComponent(back)}`, 303));
  }

  if (signedIn && matches(path, GUEST_ONLY)) {
    return withAuthCookies(context.redirect(safeNext(context.url.searchParams.get("next")), 303));
  }

  if (path === "/admin" || path.startsWith("/admin/")) {
    if (context.locals.profile?.role !== "admin") {
      // Don't reveal that admin pages exist.
      return withAuthCookies(await context.rewrite(url("/404")));
    }
  }

  const response = withAuthCookies(await next());
  // Personal pages must not be cached. A route that marked itself public
  // (it holds nothing personal) keeps its own header.
  if (signedIn && !/\bpublic\b/i.test(response.headers.get("Cache-Control") ?? "")) {
    response.headers.set("Cache-Control", "private, no-store");
  }
  return response;
};
