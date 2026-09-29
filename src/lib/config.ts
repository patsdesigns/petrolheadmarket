import { env } from "cloudflare:workers";

/** Origin of the public site, e.g. https://petrol-head-market.webflow.io */
export function publicOrigin(): string {
  return new URL(env.PUBLIC_SITE_URL || "http://localhost:8787").origin;
}

/** Absolute URL for links in emails. `path` should already include /app. */
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
 * Headers that may carry the visitor's IP, in order of trust. Better Auth
 * keys its rate limits on the first one present. Behind Webflow Cloud the
 * exact header is not documented, so accept the common ones.
 */
export const IP_HEADERS = [
  "cf-connecting-ip",
  "true-client-ip",
  "x-real-ip",
  "x-client-ip",
  "x-forwarded-for",
];
