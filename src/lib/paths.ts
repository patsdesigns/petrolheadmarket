// The whole site is one app on Cloudflare, served from the site root.
// Build every internal link, redirect, form action and asset URL with these
// helpers, so moving the site again only means changing them.

const BASE = (import.meta.env.BASE_URL || "/").replace(/\/$/, "");

/** Path on the site, e.g. url("/sell") -> "/sell". */
export function url(path = "/"): string {
  const clean = path.startsWith("/") ? path : `/${path}`;
  if (clean === "/") return BASE || "/";
  return `${BASE}${clean}`;
}

/** Public URL of an R2 photo, served by /photos/{key}. */
export function photoUrl(key: string): string {
  return url(`/photos/${key.split("/").map(encodeURIComponent).join("/")}`);
}

/** The public page of a car on the Lot. */
export function carUrl(slug: string): string {
  return url(`/cars/${slug}`);
}

/** Public pages (the Lot). Same as url() now that everything is one site. */
export const siteUrl = url;

/** My garage, the signed-in dashboard. */
export const GARAGE = "/garage";

export const basePath = BASE;
