import { and, asc, eq, inArray } from "drizzle-orm";
import { getDb } from "../db/client";
import { listingPhotos, listings, profiles } from "../db/schema";
import { photoUrl } from "./paths";

export const PUBLIC_STATUSES = ["live", "offer_accepted", "sold"] as const;

/** A listing as buyers know it: by its public slug, only once published. */
export async function getPublicListing(slug: string | null) {
  if (!slug || slug.length > 120) return null;
  const db = getDb();
  const listing = await db
    .select()
    .from(listings)
    .where(and(eq(listings.slug, slug), inArray(listings.status, [...PUBLIC_STATUSES])))
    .get();
  if (!listing) return null;
  const [main, seller] = await Promise.all([
    db
      .select({ r2Key: listingPhotos.r2Key })
      .from(listingPhotos)
      .where(eq(listingPhotos.listingId, listing.id))
      .orderBy(asc(listingPhotos.position))
      .limit(1)
      .get(),
    db.select().from(profiles).where(eq(profiles.userId, listing.userId)).get(),
  ]);
  return {
    listing,
    mainPhoto: main ? photoUrl(main.r2Key) : null,
    sellerName: seller?.displayName ?? "Private seller",
  };
}

/** A slug as the Lot uses it. Anything else is never looked up or linked. */
export const SLUG_RE = /^[a-z0-9][a-z0-9-]*$/;

export function validSlug(slug: string | null): string | null {
  return slug && slug.length <= 120 && SLUG_RE.test(slug) ? slug : null;
}

/** True when the app has (or had) a listing with this slug, public or not. */
export async function isAppSlug(slug: string): Promise<boolean> {
  const row = await getDb().select({ id: listings.id }).from(listings).where(eq(listings.slug, slug)).get();
  return Boolean(row);
}

/**
 * /offer and /message without a listing, opened from a car page: the
 * same-origin Referer names the car.
 */
export function slugFromReferer(request: Request, siteOrigin: string): string | null {
  const referer = request.headers.get("referer");
  if (!referer) return null;
  try {
    const ref = new URL(referer);
    if (ref.origin !== siteOrigin && ref.origin !== new URL(request.url).origin) return null;
    const m = /^\/cars\/([a-z0-9-]+)\/?$/.exec(ref.pathname);
    return m ? validSlug(m[1]) : null;
  } catch {
    return null;
  }
}
