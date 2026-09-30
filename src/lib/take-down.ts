import { and, eq, inArray } from "drizzle-orm";
import { env } from "cloudflare:workers";
import { getDb } from "../db/client";
import { listingPhotos, listings, offers, threads, user as users, type Listing, type ListingStatus } from "../db/schema";
import { audit } from "./audit";
import { absoluteUrl } from "./config";
import { questionsLine } from "./contact";
import { sendEmail } from "./email";
import { formatPrice, listingTitle } from "./listing-rules";
import { getOwnListing, getPhotos } from "./listings";
import { offerPhrase } from "./offers";
import { url } from "./paths";
import { safeError } from "./log";

/** Sellers take down their own live listing; admins any listing that is on the Lot. */
const SELLER_FROM: ListingStatus[] = ["live"];
const ADMIN_FROM: ListingStatus[] = ["live", "offer_accepted", "sold"];

export type TakeDownResult = { ok: true } | { ok: false; error: string };

async function emailOf(userId: string) {
  const u = await getDb().select().from(users).where(eq(users.id, userId)).get();
  return u ? { email: u.email, name: u.name?.split(/\s+/)[0] || "there" } : null;
}

/**
 * Close the offers on a listing that was taken off the site: pending offers
 * are declined and an accepted deal ends, with one email to each buyer.
 * Used by takeDownListing() and when an admin suspends the seller.
 */
export async function closeOffersOnTakeDown(listing: Listing, now = new Date()): Promise<void> {
  const db = getDb();
  const declined = await db
    .update(offers)
    .set({ status: "declined", respondedAt: now })
    .where(and(eq(offers.listingId, listing.id), eq(offers.status, "pending")))
    .returning()
    .all();
  const calledOff = await db
    .update(offers)
    .set({ status: "ended", respondedAt: now })
    .where(and(eq(offers.listingId, listing.id), eq(offers.status, "accepted")))
    .returning()
    .all();
  // Tell each buyer once.
  const title = listingTitle(listing);
  const told = new Set<string>();
  for (const o of [...calledOff, ...declined]) {
    if (told.has(o.buyerId) || o.buyerId === listing.userId) continue;
    told.add(o.buyerId);
    const buyer = await emailOf(o.buyerId);
    if (!buyer) continue;
    await sendEmail({
      to: buyer.email,
      subject: `The ${title} is no longer listed`,
      paragraphs: [
        o.status === "ended"
          ? `The ${title} was taken off Petrol Head Market, so the ${formatPrice(o.amount)} deal is off.`
          : `The ${title} was taken off Petrol Head Market, so ${offerPhrase(o)} was closed.`,
        "Never send money for a car you have not seen in person. There are more great cars on the site.",
      ],
    }).catch((err) => console.error("[take-down] buyer email failed", safeError(err)));
  }
}

/**
 * Take a listing off the Lot: it becomes `withdrawn` (which removes its car
 * page right away) and open offers are declined (an accepted deal is called
 * off) with an email to each buyer.
 */
export async function takeDownListing(
  listing: Listing,
  actorId: string,
  opts: { by: "seller" } | { by: "admin"; note: string },
): Promise<TakeDownResult> {
  const db = getDb();
  const now = new Date();
  const byAdmin = opts.by === "admin";
  const done = await db
    .update(listings)
    .set({
      status: "withdrawn",
      // The seller sees an admin's note on their listing page.
      reviewNotes: byAdmin ? opts.note : null,
      ...(byAdmin ? { reviewerId: actorId, reviewedAt: now } : {}),
      updatedAt: now,
    })
    .where(and(eq(listings.id, listing.id), inArray(listings.status, byAdmin ? ADMIN_FROM : SELLER_FROM)))
    .returning({ id: listings.id })
    .get();
  if (!done) {
    return {
      ok: false,
      error: byAdmin ? "Only listings on the Lot can be taken down." : "Only live listings can be taken down.",
    };
  }
  await audit(actorId, "take_down", "listing", listing.id, {
    by: opts.by,
    from: listing.status,
    ...(byAdmin ? { notes: opts.note } : {}),
  });

  await closeOffersOnTakeDown(listing, now);
  const title = listingTitle(listing);

  if (byAdmin) {
    const seller = await emailOf(listing.userId);
    if (seller) {
      await sendEmail({
        to: seller.email,
        subject: `Your ${title} was taken down`,
        paragraphs: [
          `Hi ${seller.name}, our team took your ${title} off Petrol Head Market. Open offers on it were closed.`,
          opts.note,
          questionsLine(listing.id),
        ],
        // Through sign in, so a signed-out seller lands on the listing after signing in.
        action: {
          label: "Open the listing",
          url: absoluteUrl(`${url("/login")}?next=${encodeURIComponent(url(`/listings/${listing.id}`))}`),
        },
      }).catch((err) => console.error("[take-down] seller email failed", safeError(err)));
    }
  }

  return { ok: true };
}

/** Statuses a seller can delete: drafts, and listings that are off the site for good. */
export const DELETABLE_STATUSES: ListingStatus[] = ["draft", "rejected", "withdrawn"];

export type DeleteResult = { ok: true; was: ListingStatus; kept: boolean } | { ok: false; error: string };

/**
 * Delete a listing and its photos in R2. Only by the owner, and only drafts,
 * rejected and withdrawn listings.
 *
 * A listing with offers or messages is only hidden (deleted_at) and loses its
 * photos: the rows stay so buyers keep their offer history and threads, and
 * flagged messages stay for the admins. `kept` says which happened.
 */
export async function deleteListing(userId: string, id: string): Promise<DeleteResult> {
  const listing = await getOwnListing(userId, id);
  if (!listing || !DELETABLE_STATUSES.includes(listing.status)) {
    return { ok: false, error: "Only drafts and listings that are off the site can be deleted." };
  }
  const db = getDb();
  const photos = await getPhotos(id);
  if (photos.length) await env.PHOTOS.delete(photos.map((p) => p.r2Key));

  const hasOffers = await db.select({ id: offers.id }).from(offers).where(eq(offers.listingId, id)).get();
  const hasThreads = hasOffers ? null : await db.select({ id: threads.id }).from(threads).where(eq(threads.listingId, id)).get();
  const kept = Boolean(hasOffers || hasThreads);
  const mine = and(eq(listings.id, id), eq(listings.userId, userId), inArray(listings.status, DELETABLE_STATUSES));
  if (kept) {
    await db.delete(listingPhotos).where(eq(listingPhotos.listingId, id));
    await db.update(listings).set({ deletedAt: new Date(), updatedAt: new Date() }).where(mine);
  } else {
    await db.delete(listings).where(mine);
  }
  await audit(userId, "delete_listing", "listing", id, { status: listing.status, kept });
  return { ok: true, was: listing.status, kept };
}
