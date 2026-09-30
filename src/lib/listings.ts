import { and, asc, count, desc, eq, inArray, isNull, notExists } from "drizzle-orm";
import { getDb } from "../db/client";
import { listingPhotos, listings, type Listing, type ListingPhoto } from "../db/schema";
import { EDITABLE_STATUSES } from "./listing-options";
import { photoUrl } from "./paths";

export const MAX_OPEN_DRAFTS = 10;

/** A listing, only if it belongs to this user. Every seller read goes through here. */
export async function getOwnListing(userId: string, id: string): Promise<Listing | undefined> {
  return getDb()
    .select()
    .from(listings)
    .where(and(eq(listings.id, id), eq(listings.userId, userId), isNull(listings.deletedAt)))
    .get();
}

export function isEditable(listing: Pick<Listing, "status">): boolean {
  return (EDITABLE_STATUSES as readonly string[]).includes(listing.status);
}

export async function getPhotos(listingId: string): Promise<ListingPhoto[]> {
  return getDb()
    .select()
    .from(listingPhotos)
    .where(eq(listingPhotos.listingId, listingId))
    .orderBy(asc(listingPhotos.position), asc(listingPhotos.createdAt))
    .all();
}

export async function photoCount(listingId: string): Promise<number> {
  const row = await getDb()
    .select({ n: count() })
    .from(listingPhotos)
    .where(eq(listingPhotos.listingId, listingId))
    .get();
  return row?.n ?? 0;
}

export function photoView(p: ListingPhoto) {
  return { id: p.id, url: photoUrl(p.r2Key), width: p.width, height: p.height };
}

export async function listForUser(userId: string) {
  const db = getDb();
  const rows = await db
    .select()
    .from(listings)
    .where(and(eq(listings.userId, userId), isNull(listings.deletedAt)))
    .orderBy(desc(listings.updatedAt))
    .all();
  if (rows.length === 0) return [];

  // Scoped by owner with a join, not an id list: D1 caps bound parameters at 100.
  const firsts = await db
    .select({
      listingId: listingPhotos.listingId,
      r2Key: listingPhotos.r2Key,
      position: listingPhotos.position,
    })
    .from(listingPhotos)
    .innerJoin(listings, eq(listings.id, listingPhotos.listingId))
    .where(eq(listings.userId, userId))
    .orderBy(asc(listingPhotos.position))
    .all();
  const counts = new Map<string, number>();
  const main = new Map<string, string>();
  for (const p of firsts) {
    counts.set(p.listingId, (counts.get(p.listingId) ?? 0) + 1);
    if (!main.has(p.listingId)) main.set(p.listingId, photoUrl(p.r2Key));
  }
  return rows.map((l) => ({ ...l, mainPhoto: main.get(l.id) ?? null, photoCount: counts.get(l.id) ?? 0 }));
}

/**
 * Start a new draft, or reuse the seller's newest empty one (no year, make,
 * model or photos) so repeated "Start a new listing" taps don't pile up
 * empty drafts. Null when the seller already has MAX_OPEN_DRAFTS drafts.
 */
export async function createDraft(userId: string): Promise<string | null> {
  const db = getDb();
  const empty = await db
    .select({ id: listings.id })
    .from(listings)
    .where(
      and(
        eq(listings.userId, userId),
        eq(listings.status, "draft"),
        isNull(listings.year),
        isNull(listings.make),
        isNull(listings.model),
        notExists(db.select({ id: listingPhotos.id }).from(listingPhotos).where(eq(listingPhotos.listingId, listings.id))),
      ),
    )
    .orderBy(desc(listings.createdAt))
    .get();
  if (empty) return empty.id;
  const open = await db
    .select({ n: count() })
    .from(listings)
    .where(and(eq(listings.userId, userId), eq(listings.status, "draft")))
    .get();
  if ((open?.n ?? 0) >= MAX_OPEN_DRAFTS) return null;
  const id = crypto.randomUUID();
  await db.insert(listings).values({ id, userId });
  return id;
}

/** Save fields on an editable listing. False when the listing is no longer editable (nothing saved). */
export async function saveListingFields(id: string, userId: string, data: Partial<Listing>): Promise<boolean> {
  const row = await getDb()
    .update(listings)
    .set({ ...data, updatedAt: new Date() })
    .where(
      and(
        eq(listings.id, id),
        eq(listings.userId, userId),
        inArray(listings.status, [...EDITABLE_STATUSES]),
      ),
    )
    .returning({ id: listings.id })
    .get();
  return Boolean(row);
}

export async function touchListing(id: string): Promise<void> {
  await getDb().update(listings).set({ updatedAt: new Date() }).where(eq(listings.id, id));
}
