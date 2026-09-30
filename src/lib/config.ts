import { env } from "cloudflare:workers";

/** Origin of the public site (PUBLIC_SITE_URL). */
export function publicOrigin(): string {
  return new URL(env.PUBLIC_SITE_URL || "http://localhost:8787").origin;
}

/** Absolute URL for links in emails. `path` comes from url() in paths.ts. */
export function absoluteUrl(path: string): string {
  return new URL(path, publicOrigin()).toString();
}

export function adminEmails(): Set<string> {
  return new Set(
    (env.ADMIN_EMAILS || "")
      .split(",")
      .map((e) => e.trim().toLowerCase())
      .filter(Boolean),
  );
}

export function isAdminEmail(email: string): boolean {
  return adminEmails().has(email.trim().toLowerCase());
}

/**
 * The team's public contact address (SUPPORT_EMAIL), if one is set. It is
 * shown in mailto links and used as reply_to, so it is never an ADMIN_EMAILS
 * address by default: those are sign in names, and publishing one would let
 * anyone aim failed sign ins at the owner's account.
 */
export function supportEmail(): string | undefined {
  const value = (env.SUPPORT_EMAIL || "").trim();
  return /^[^\s@<>"]+@[^\s@<>"]+\.[^\s@<>"]+$/.test(value) && value.length <= 254 ? value : undefined;
}

/**
 * Whether the app can actually send email. Without RESEND_API_KEY emails are
 * not delivered, so nothing may claim one was sent. Read env inside the
 * function, never at module scope.
 */
export function emailConfigured(): boolean {
  return Boolean(env.RESEND_API_KEY);
}

/**
 * Whether this person may submit a listing, make an offer or send a message.
 * With email switched on that needs a confirmed email. While email is off no
 * one could ever confirm, so everyone signed in may go ahead.
 */
export function canTransact(user: { emailVerified: boolean }): boolean {
  return emailConfigured() ? user.emailVerified : true;
}

/**
 * The only header trusted for the visitor IP. Cloudflare's edge sets
 * cf-connecting-ip and overwrites any value the client sends, so it cannot
 * be spoofed. Other headers (x-real-ip, x-forwarded-for and so on) can come
 * from the client and are ignored. It can be missing (local runs, some
 * proxies), so rate limits are keyed by email first (src/lib/auth-limits.ts).
 */
export const IP_HEADERS = ["cf-connecting-ip"];
