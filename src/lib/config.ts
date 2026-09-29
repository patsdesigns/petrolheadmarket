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
