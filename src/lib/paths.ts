// The app is mounted at /app on the public Webflow site. Build every internal
// link, redirect, form action and asset URL with these helpers so nothing
// ever points at the site root by accident.

const BASE = (import.meta.env.BASE_URL || "/").replace(/\/$/, "");

/** Path inside the app, e.g. url("/sell") -> "/app/sell", url("/") -> "/app". */
export function url(path = "/"): string {
  const clean = path.startsWith("/") ? path : `/${path}`;
  if (clean === "/") return BASE || "/";
  return `${BASE}${clean}`;
}

/** Public URL of an R2 photo, served by /app/photos/{key}. */
export function photoUrl(key: string): string {
  return url(`/photos/${key.split("/").map(encodeURIComponent).join("/")}`);
}

/** Link to a page on the public Webflow site (outside the app). */
export function siteUrl(path = "/"): string {
  return path.startsWith("/") ? path : `/${path}`;
}

export const basePath = BASE;
