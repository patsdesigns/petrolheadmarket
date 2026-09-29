import { getAuth } from "./auth";
import { publicOrigin } from "./config";
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

const FORWARDED = ["cookie", "user-agent", "x-forwarded-for", "cf-connecting-ip", "x-real-ip"];

/**
 * Call a Better Auth endpoint from a server-rendered form handler.
 *
 * Goes through `auth.handler` (not `auth.api`) on purpose so Better Auth's
 * rate limiting and origin checks apply exactly as they do for its HTTP API.
 * The request's own origin was already checked by our middleware.
 */
export async function callAuth<T = unknown>(
  request: Request,
  path: string,
  body?: Record<string, unknown>,
  method: "POST" | "GET" = "POST",
): Promise<AuthCallResult<T>> {
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

  return {
    ok: res.ok,
    status: res.status,
    data: res.ok ? (json as T) : null,
    error: res.ok ? null : (json?.message ?? "Something went wrong. Please try again."),
    code: res.ok ? null : (json?.code ?? null),
    cookies: res.headers.getSetCookie(),
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
  if (result.status === 429) return "Too many attempts. Wait a minute and try again.";
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
    case "PASSWORD_TOO_SHORT":
      return "Use at least 8 characters.";
    default:
      return result.error ?? "Something went wrong. Please try again.";
  }
}
