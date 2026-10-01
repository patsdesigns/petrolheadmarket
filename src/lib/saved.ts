// Saved cars: the heart on Lot cards and car pages, listed on /saved.
import { and, desc, eq, inArray, isNull } from "drizzle-orm";
import { chunks, getDb } from "../db/client";
import { listings, savedCars } from "../db/schema";
import { PUBLIC_STATUSES } from "./public-listing";
import { cardsFor, type LotCard } from "./lot";

/** Most cars one member can save. */
export const MAX_SAVED = 200;

/** Which of these listings the member saved. */
export async function savedAmong(userId: string | undefined, listingIds: string[]): Promise<Set<string>> {
  if (!userId || !listingIds.length) return new Set();
  const db = getDb();
  const found = new Set<string>();
  for (const group of chunks(listingIds)) {
    const rows = await db
      .select({ listingId: savedCars.listingId })
      .from(savedCars)
      .where(and(eq(savedCars.userId, userId), inArray(savedCars.listingId, group)))
      .all();
    for (const r of rows) found.add(r.listingId);
  }
  return found;
}

export type SaveResult = { ok: true; saved: boolean } | { ok: false; error: string };

/** Save or unsave a car. Only cars with a public page can be saved. */
export async function setSaved(userId: string, listingId: string, save: boolean): Promise<SaveResult> {
  const db = getDb();
  if (!save) {
    await db.delete(savedCars).where(and(eq(savedCars.userId, userId), eq(savedCars.listingId, listingId))).run();
    return { ok: true, saved: false };
  }
  const listing = await db
    .select({ id: listings.id })
    .from(listings)
    .where(and(eq(listings.id, listingId), inArray(listings.status, [...PUBLIC_STATUSES]), isNull(listings.deletedAt)))
    .get();
  if (!listing) return { ok: false, error: "This car is no longer on the Lot." };
  const mine = await db.select({ id: savedCars.listingId }).from(savedCars).where(eq(savedCars.userId, userId)).all();
  if (mine.length >= MAX_SAVED && !mine.some((m) => m.id === listingId)) {
    return { ok: false, error: `You can save up to ${MAX_SAVED} cars. Remove some to save more.` };
  }
  await db.insert(savedCars).values({ userId, listingId }).onConflictDoNothing().run();
  return { ok: true, saved: true };
}

/** A member's saved cars that still have a public page, newest saved first. */
export async function savedCards(userId: string): Promise<LotCard[]> {
  const db = getDb();
  const rows = await db
    .select({ id: savedCars.listingId })
    .from(savedCars)
    .innerJoin(listings, eq(listings.id, savedCars.listingId))
    .where(and(eq(savedCars.userId, userId), inArray(listings.status, [...PUBLIC_STATUSES]), isNull(listings.deletedAt)))
    .orderBy(desc(savedCars.createdAt))
    .limit(MAX_SAVED)
    .all();
  const ids = rows.map((r) => r.id);
  const cards: LotCard[] = [];
  for (const group of chunks(ids)) cards.push(...(await cardsFor(group)));
  return cards;
}
