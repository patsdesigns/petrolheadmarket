import { and, asc, eq, inArray } from "drizzle-orm";
import { getDb } from "../db/client";
import { listingPhotos, listings, profiles } from "../db/schema";
import { photoUrl } from "./paths";

export const PUBLIC_STATUSES = ["live", "offer_accepted", "sold"] as const;

/** A listing as buyers know it: by its public (CMS) slug, only once published. */
export async function getPublicListing(slug: string | null) {
  if (!slug || slug.length > 120) return null;
  const db = getDb();
  const listing = await db
    .select()
    .from(listings)
    .where(and(eq(listings.slug, slug), inArray(listings.status, [...PUBLIC_STATUSES])))
    .get();
  if (!listing) return null;
  const main = await db
    .select({ r2Key: listingPhotos.r2Key })
    .from(listingPhotos)
    .where(eq(listingPhotos.listingId, listing.id))
    .orderBy(asc(listingPhotos.position))
    .limit(1)
    .get();
  const seller = await db.select().from(profiles).where(eq(profiles.userId, listing.userId)).get();
  return {
    listing,
    mainPhoto: main ? photoUrl(main.r2Key) : null,
    sellerName: seller?.displayName ?? "Private seller",
  };
}
