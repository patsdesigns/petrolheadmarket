import { getAuth } from "./auth";
import { deviceCookie, takeAuthLimit, tooManyMessage, type Limiter, type LimitAction } from "./auth-limits";
import { IP_HEADERS, publicOrigin } from "./config";
import { url } from "./paths";

export interface AuthCallResult<T = unknown> {
  ok: boolean;
  status: number;
  data: T | null;
  /** Human readable error from Better Auth, if any. */
  error: string | null;
  code: string | null;
  /** Set-Cookie headers to pass on to the browser. */
  cookies: string[];
}

const FORWARDED = ["cookie", "user-agent", ...IP_HEADERS];

/**
 * App rate limits per Better Auth path (src/lib/auth-limits.ts).
 * Every attempt takes a slot before the call. `failuresOnly` gives the slot
 * back when the attempt succeeds, so a person who signs in fine is never
 * slowed down, while parallel guesses are all counted up front. `silent` answers as if it worked, so a limited
 * password reset does not reveal whether an account exists.
 */
const LIMITED: Record<string, { action: LimitAction; failuresOnly?: boolean; silent?: boolean }> = {
  "/sign-in/email": { action: "signin", failuresOnly: true },
  "/change-password": { action: "signin", failuresOnly: true },
  "/sign-up/email": { action: "signup" },
  "/request-password-reset": { action: "email", silent: true },
  "/send-verification-email": { action: "email" },
  "/change-email": { action: "email" },
};

function tooMany<T>(waitSec: number): AuthCallResult<T> {
  return {
    ok: false,
    status: 429,
    data: null,
    error: tooManyMessage(waitSec),
    code: "TOO_MANY_REQUESTS",
    cookies: [],
  };
}

/**
 * Call a Better Auth endpoint from a server-rendered form handler.
 *
 * Goes through `auth.handler` in process, so Better Auth's origin checks
 * apply. The public /app/api/auth/* route only serves the GET links in
 * emails, so every sign in, sign up, reset and change comes through here,
 * behind the app's own rate limits. The request's own origin was already
 * checked by our middleware.
 *
 * `limitEmail` is the signed-in account's address. It names the account for
 * limits when the body has no email (change password), and is counted as
 * well as the new address for a change of email.
 */
export async function callAuth<T = unknown>(
  request: Request,
  path: string,
  body?: Record<string, unknown>,
  method: "POST" | "GET" = "POST",
  limitEmail?: string,
): Promise<AuthCallResult<T>> {
  const limit = LIMITED[path];
  // The address the action is about, or the signed-in account's own.
  const email = limit ? String(body?.email ?? body?.newEmail ?? limitEmail ?? "") || null : null;
  let limiter: Limiter | null = null;
  if (limit) {
    try {
      // A change of email counts against the new address and the account.
      limiter = await takeAuthLimit(request, limit.action, [email, limitEmail ?? null]);
    } catch (err) {
      // A missing table or D1 hiccup must not lock everyone out.
      console.error("[auth] rate limit lookup failed", err);
    }
    if (limiter && limiter.wait > 0) {
      if (limit.silent) return { ok: true, status: 200, data: null, error: null, code: null, cookies: [] };
      return tooMany<T>(limiter.wait);
    }
  }

  const origin = publicOrigin();
  const headers = new Headers({ origin, "content-type": "application/json" });
  for (const name of FORWARDED) {
    const value = request.headers.get(name);
    if (value) headers.set(name, value);
  }

  let res: Response;
  try {
    res = await getAuth().handler(
      new Request(new URL(url(`/api/auth${path}`), origin), {
        method,
        headers,
        body: method === "POST" ? JSON.stringify(body ?? {}) : undefined,
      }),
    );
  } catch (err) {
    // Usually a missing setting such as BETTER_AUTH_SECRET. See /app/api/health.
    console.error("[auth] handler failed", err);
    if (limiter && limit?.failuresOnly) await limiter.release().catch(() => undefined);
    return {
      ok: false,
      status: 503,
      data: null,
      error: "Accounts are not switched on yet. Please try again soon.",
      code: "AUTH_UNAVAILABLE",
      cookies: [],
    };
  }

  let json: any = null;
  try {
    json = await res.json();
  } catch {
    json = null;
  }

  // Only failed password checks count: give the slot back otherwise.
  // Server errors are not the person's fault either.
  if (limiter && limit?.failuresOnly && (res.ok || res.status >= 500)) {
    await limiter.release().catch(() => undefined);
  }

  const cookies = res.headers.getSetCookie();
  // A browser that signed in fine is trusted for that address, so strangers
  // failing on purpose can't lock its owner out (src/lib/auth-limits.ts).
  if (res.ok && path === "/sign-in/email" && email) {
    const device = await deviceCookie(email).catch(() => null);
    if (device) cookies.push(device);
  }

  return {
    ok: res.ok,
    status: res.status,
    data: res.ok ? (json as T) : null,
    error: res.ok ? null : (json?.message ?? "Something went wrong. Please try again."),
    code: res.ok ? null : (json?.code ?? null),
    cookies,
  };
}

/** A 303 redirect that also carries Set-Cookie headers from Better Auth. */
export function redirectWithCookies(location: string, cookies: string[]): Response {
  const headers = new Headers({ location });
  for (const c of cookies) headers.append("set-cookie", c);
  return new Response(null, { status: 303, headers });
}

/** Friendlier wording for the errors people actually hit. */
export function friendlyAuthError(result: AuthCallResult): string {
  if (result.status === 429) return result.error ?? "Too many attempts. Wait a few minutes and try again.";
  switch (result.code) {
    case "INVALID_EMAIL_OR_PASSWORD":
      return "That email and password do not match. Check them and try again.";
    case "USER_ALREADY_EXISTS":
    case "USER_ALREADY_EXISTS_USE_ANOTHER_EMAIL":
      return "There is already an account with that email. Sign in instead.";
    case "INVALID_PASSWORD":
      return "Your current password is not right.";
    case "INVALID_TOKEN":
      return "This link has expired or was already used. Ask for a new one.";
    case "ACCOUNT_SUSPENDED":
      return "This account is suspended. Contact our team if you think this is a mistake.";
    case "PASSWORD_TOO_SHORT":
      return "Use at least 8 characters.";
    default:
      return result.error ?? "Something went wrong. Please try again.";
  }
}
