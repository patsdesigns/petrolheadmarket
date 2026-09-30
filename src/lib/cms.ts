import { and, eq, ne } from "drizzle-orm";
import { getDb } from "../db/client";
import { listings, profiles, user as users, type Listing } from "../db/schema";
import { listingTitle } from "./listing-rules";
import { audit } from "./audit";
import { notifySellerLive } from "./notify";
import { errorMessage } from "./log";

// Publishing puts an approved listing on the Lot. The Lot and the car pages
// read listings straight from D1, so publishing is a status change plus a
// public slug, and every later change (quick edits, sold, take down) shows on
// the Lot as soon as it is saved. There is nothing to copy or keep in sync.

export function slugify(s: string): string {
  return s
    .toLowerCase()
    .normalize("NFKD")
    .replace(/\p{M}/gu, "")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 80);
}

export function baseSlug(l: Pick<Listing, "year" | "make" | "model">): string {
  return slugify(`${l.year ?? ""} ${l.make ?? ""} ${l.model ?? ""}`) || "listing";
}

/** True if another listing already uses this slug. */
async function slugClash(candidate: string, listing: Listing): Promise<boolean> {
  const clash = await getDb()
    .select({ id: listings.id })
    .from(listings)
    .where(and(eq(listings.slug, candidate), ne(listings.id, listing.id)))
    .get();
  return Boolean(clash);
}

async function pickSlug(listing: Listing, skipBase = false): Promise<string> {
  const base = baseSlug(listing);
  for (let i = skipBase ? 1 : 0; i < 6; i++) {
    const candidate = i === 0 ? base : `${base}-${crypto.randomUUID().slice(0, 4)}`;
    if (await slugClash(candidate, listing)) continue;
    return candidate;
  }
  return `${base}-${crypto.randomUUID().slice(0, 8)}`;
}

/** Give the listing its public slug (kept for good once set). */
async function reserveSlug(listing: Listing): Promise<string> {
  if (listing.slug) return listing.slug;
  const db = getDb();
  for (let i = 0; i < 3; i++) {
    const slug = await pickSlug(listing, i > 0);
    try {
      await db.update(listings).set({ slug }).where(eq(listings.id, listing.id));
      return slug;
    } catch (err) {
      // Another listing took it between the check and the write (UNIQUE).
      if (i === 2) throw err;
    }
  }
  throw new Error("Could not pick a slug.");
}

export type PublishResult = { ok: true; slug: string } | { ok: false; error: string; busy?: boolean };

async function sellerContact(userId: string) {
  const db = getDb();
  const u = await db.select().from(users).where(eq(users.id, userId)).get();
  if (!u) return null;
  const p = await db.select({ notify: profiles.emailNotifications }).from(profiles).where(eq(profiles.userId, userId)).get();
  return { email: u.email, name: u.name?.split(/\s+/)[0] || "there", notify: p?.notify ?? true };
}

/**
 * Put an approved listing on the Lot: give it a slug, move it to `live`
 * (conditional on it still being `approved`, so a second click or a take
 * down in between can't win twice) and email the seller.
 */
export async function publishListing(listingId: string, actorId: string | null): Promise<PublishResult> {
  const db = getDb();
  const listing = await db.select().from(listings).where(eq(listings.id, listingId)).get();
  if (!listing || listing.status !== "approved") return { ok: false, error: "Listing is not approved." };
  try {
    const slug = await reserveSlug(listing);
    const publishedAt = listing.publishedAt ?? new Date();
    const done = await db
      .update(listings)
      .set({ status: "live", slug, publishedAt, publishingAt: null, cmsSyncPending: false, updatedAt: new Date() })
      .where(and(eq(listings.id, listing.id), eq(listings.status, "approved")))
      .returning({ id: listings.id })
      .get();
    if (!done) return { ok: false, error: "The listing changed while it was being published." };
    await audit(actorId, "publish", "listing", listing.id, { slug });
    const seller = await sellerContact(listing.userId);
    if (seller) await notifySellerLive(seller, listing.id, listingTitle(listing), slug);
    return { ok: true, slug };
  } catch (err) {
    const error = errorMessage(err);
    console.error("[publish] failed", listing.id, error);
    await audit(actorId, "publish_failed", "listing", listing.id, { error });
    return { ok: false, error };
  }
}

/** Statuses whose listing is on the Lot (sold cars keep their page). */
export const IN_CMS_STATUSES = ["live", "offer_accepted", "sold"] as const;
