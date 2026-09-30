import { and, desc, eq, gt, lt, ne, or } from "drizzle-orm";
import { getDb } from "../db/client";
import { listings, offers, profiles, user as users, type Listing, type Offer } from "../db/schema";
import { audit } from "./audit";
import { syncListing } from "./cms";
import { absoluteUrl } from "./config";
import { sendEmail } from "./email";
import { formatPrice, listingTitle } from "./listing-rules";
import { url } from "./paths";
import { isSuspended } from "./profile";
import { scamCheck } from "./messaging";
import { safeError } from "./log";

export const OFFER_HOURS = 72;
export const MIN_OFFER_RATIO = 0.5;

export const minOffer = (price: number) => Math.ceil(price * MIN_OFFER_RATIO);
const expiry = () => new Date(Date.now() + OFFER_HOURS * 60 * 60 * 1000);

/** Offers expire after 72 hours. There is no cron, so expire lazily on read. */
export async function expireStaleOffers(): Promise<void> {
  await getDb()
    .update(offers)
    .set({ status: "expired" })
    .where(and(eq(offers.status, "pending"), lt(offers.expiresAt, new Date())));
}

export async function openOfferFor(listingId: string, buyerId: string): Promise<Offer | undefined> {
  return getDb()
    .select()
    .from(offers)
    .where(and(eq(offers.listingId, listingId), eq(offers.buyerId, buyerId), eq(offers.status, "pending")))
    .orderBy(desc(offers.createdAt))
    .get();
}

async function person(userId: string) {
  const db = getDb();
  const u = await db.select().from(users).where(eq(users.id, userId)).get();
  const p = await db.select().from(profiles).where(eq(profiles.userId, userId)).get();
  return {
    id: userId,
    email: u?.email ?? "",
    firstName: u?.name?.split(/\s+/)[0] ?? "there",
    displayName: p?.displayName ?? u?.name ?? "Member",
    notify: p?.emailNotifications ?? true,
  };
}

/** "your $20,000 offer", or "the seller's $25,000 counter offer" for a counter, as the buyer reads it. */
export function offerPhrase(o: { madeBy: string; amount: number }): string {
  return o.madeBy === "seller" ? `the seller's ${formatPrice(o.amount)} counter offer` : `your ${formatPrice(o.amount)} offer`;
}

/**
 * The note as it goes in an email. A note the scam filter flagged is left
 * out, so an off-platform pitch doesn't reach an inbox before review.
 */
function noteLines(message: string | null, flagged: boolean): string[] {
  if (!message) return [];
  if (flagged) return ["They added a note. Read it on Petrol Head Market."];
  return [`Their note: "${message}"`];
}

function notifyIfWanted(p: { email: string; notify: boolean }, email: Parameters<typeof sendEmail>[0]) {
  if (!p.notify) return Promise.resolve();
  return sendEmail(email).catch((err) => console.error("[offers] email failed", safeError(err)));
}

export type OfferResult =
  | { ok: true; offer?: Offer; syncFailed?: { listingId: string; bySeller: boolean } }
  | { ok: false; error: string };

export async function createOffer(
  listing: Listing,
  buyerId: string,
  amount: number,
  message: string | null,
): Promise<OfferResult> {
  if (listing.status !== "live") return { ok: false, error: "This car is no longer taking offers." };
  if (await isSuspended(buyerId)) return { ok: false, error: "Your account is suspended." };
  if (!listing.acceptsOffers) return { ok: false, error: "The seller is not taking offers on this car." };
  if (listing.userId === buyerId) return { ok: false, error: "You can't make an offer on your own car." };
  if (!listing.price) return { ok: false, error: "This listing has no price." };
  if (amount < minOffer(listing.price)) {
    return {
      ok: false,
      error: `Offers must be at least half the asking price (${formatPrice(minOffer(listing.price))}). Lowball offers are blocked to respect sellers.`,
    };
  }
  if (amount > listing.price * 2) return { ok: false, error: "That is more than double the asking price. Check the amount." };

  await expireStaleOffers();
  if (await openOfferFor(listing.id, buyerId)) {
    return { ok: false, error: "You already have an open offer on this car. Wait for the seller to respond, or withdraw it first." };
  }

  // Notes are delivered like messages, and flagged for review the same way.
  const flagReason = message ? scamCheck(message) : null;
  const offer = await getDb()
    .insert(offers)
    .values({
      id: crypto.randomUUID(),
      listingId: listing.id,
      buyerId,
      madeBy: "buyer",
      amount,
      message,
      flagged: Boolean(flagReason),
      flagReason,
      expiresAt: expiry(),
    })
    .returning()
    .get();

  const [seller, buyer] = await Promise.all([person(listing.userId), person(buyerId)]);
  const title = listingTitle(listing);
  await notifyIfWanted(seller, {
    to: seller.email,
    subject: `New offer on your ${title}: ${formatPrice(amount)}`,
    paragraphs: [
      `${buyer.displayName} offered ${formatPrice(amount)} for your ${title} (asking ${formatPrice(listing.price)}).`,
      ...noteLines(message, Boolean(flagReason)),
      `You have ${OFFER_HOURS} hours to accept, counter or decline.`,
    ],
    action: { label: "Respond to the offer", url: absoluteUrl(url("/offers")) },
  });
  return { ok: true, offer };
}

interface OfferContext {
  offer: Offer;
  listing: Listing;
}

async function loadOffer(offerId: string): Promise<OfferContext | null> {
  const db = getDb();
  const offer = await db.select().from(offers).where(eq(offers.id, offerId)).get();
  if (!offer) return null;
  const listing = await db.select().from(listings).where(eq(listings.id, offer.listingId)).get();
  return listing ? { offer, listing } : null;
}

/** Who may answer this offer: the seller answers buyer offers, the buyer answers counters. */
function responderId({ offer, listing }: OfferContext): string {
  return offer.madeBy === "buyer" ? listing.userId : offer.buyerId;
}

function checkOpen(ctx: OfferContext | null, actorId: string): string | null {
  if (!ctx) return "Offer not found.";
  if (ctx.offer.status !== "pending") return "This offer is no longer open.";
  if (ctx.offer.expiresAt < new Date()) return "This offer has expired.";
  if (responderId(ctx) !== actorId) return "Offer not found.";
  return null;
}

export async function counterOffer(offerId: string, sellerId: string, amount: number, message: string | null): Promise<OfferResult> {
  const ctx = await loadOffer(offerId);
  const err = checkOpen(ctx, sellerId);
  if (err) return { ok: false, error: err };
  const { offer, listing } = ctx!;
  if (offer.madeBy !== "buyer") return { ok: false, error: "You can only counter a buyer's offer." };
  if (listing.status !== "live") return { ok: false, error: "This listing is not live." };
  if (amount <= offer.amount) return { ok: false, error: "Your counter should be higher than their offer. To take their offer, accept it." };
  if (listing.price && amount > listing.price) return { ok: false, error: "Your counter can't be more than your asking price." };

  const db = getDb();
  const updated = await db
    .update(offers)
    .set({ status: "countered", respondedAt: new Date() })
    .where(and(eq(offers.id, offer.id), eq(offers.status, "pending")))
    .returning({ id: offers.id })
    .get();
  if (!updated) return { ok: false, error: "This offer is no longer open." };

  const flagReason = message ? scamCheck(message) : null;
  const counter = await db
    .insert(offers)
    .values({
      id: crypto.randomUUID(),
      listingId: listing.id,
      buyerId: offer.buyerId,
      madeBy: "seller",
      amount,
      message,
      flagged: Boolean(flagReason),
      flagReason,
      parentOfferId: offer.id,
      expiresAt: expiry(),
    })
    .returning()
    .get();

  const [buyer, seller] = await Promise.all([person(offer.buyerId), person(listing.userId)]);
  const title = listingTitle(listing);
  await notifyIfWanted(buyer, {
    to: buyer.email,
    subject: `Counter offer on the ${title}: ${formatPrice(amount)}`,
    paragraphs: [
      `${seller.displayName} countered your ${formatPrice(offer.amount)} offer on the ${title} with ${formatPrice(amount)}.`,
      ...noteLines(message, Boolean(flagReason)),
      `You have ${OFFER_HOURS} hours to accept or decline.`,
    ],
    action: { label: "See the counter offer", url: absoluteUrl(url("/offers")) },
  });
  return { ok: true, offer: counter };
}

export async function declineOffer(offerId: string, actorId: string): Promise<OfferResult> {
  const ctx = await loadOffer(offerId);
  const err = checkOpen(ctx, actorId);
  if (err) return { ok: false, error: err };
  const { offer, listing } = ctx!;
  const declined = await getDb()
    .update(offers)
    .set({ status: "declined", respondedAt: new Date() })
    .where(and(eq(offers.id, offer.id), eq(offers.status, "pending")))
    .returning({ id: offers.id })
    .get();
  // Someone else answered it first (a withdraw, an accept or a double submit): no email.
  if (!declined) return { ok: false, error: "This offer is no longer open." };

  const otherId = offer.madeBy === "buyer" ? offer.buyerId : listing.userId;
  const [other, actor] = await Promise.all([person(otherId), person(actorId)]);
  const title = listingTitle(listing);
  await notifyIfWanted(other, {
    to: other.email,
    subject: `Offer declined on the ${title}`,
    paragraphs: [
      `${actor.displayName} declined the ${formatPrice(offer.amount)} offer on the ${title}.`,
      offer.madeBy === "buyer" && listing.status === "live" ? "The car is still for sale. You can send a new offer or message the seller." : "",
    ].filter(Boolean),
    action: { label: "Open offers", url: absoluteUrl(url("/offers")) },
  });
  return { ok: true };
}

export async function withdrawOffer(offerId: string, buyerId: string): Promise<OfferResult> {
  const ctx = await loadOffer(offerId);
  if (!ctx || ctx.offer.buyerId !== buyerId || ctx.offer.madeBy !== "buyer") return { ok: false, error: "Offer not found." };
  if (ctx.offer.status !== "pending") return { ok: false, error: "This offer is no longer open." };
  const withdrawn = await getDb()
    .update(offers)
    .set({ status: "withdrawn", respondedAt: new Date() })
    .where(and(eq(offers.id, offerId), eq(offers.status, "pending")))
    .returning({ id: offers.id })
    .get();
  if (!withdrawn) return { ok: false, error: "This offer is no longer open." };
  return { ok: true };
}

/**
 * Accept an offer or a counter. The listing moves to offer_accepted (and the
 * CMS is updated), every other open offer on it is declined with a notice,
 * and both people get each other's contact details.
 */
export async function acceptOffer(offerId: string, actorId: string): Promise<OfferResult> {
  const ctx = await loadOffer(offerId);
  const err = checkOpen(ctx, actorId);
  if (err) return { ok: false, error: err };
  const { offer, listing } = ctx!;
  const db = getDb();

  // Take the offer first, only while it is still open, so a withdraw, a
  // decline or a counter that lands in between can't be overwritten.
  const now = new Date();
  const took = await db
    .update(offers)
    .set({ status: "accepted", respondedAt: now })
    .where(and(eq(offers.id, offer.id), eq(offers.status, "pending"), gt(offers.expiresAt, now)))
    .returning({ id: offers.id })
    .get();
  if (!took) return { ok: false, error: "This offer is no longer open." };

  // Then claim the listing so two accepts can't both win.
  const claimed = await db
    .update(listings)
    .set({ status: "offer_accepted", updatedAt: now })
    .where(and(eq(listings.id, listing.id), eq(listings.status, "live")))
    .returning({ id: listings.id })
    .get();
  if (!claimed) {
    // The car left live (another accept, or sold), so this offer is closed, not reopened.
    await db
      .update(offers)
      .set({ status: "declined", respondedAt: now })
      .where(and(eq(offers.id, offer.id), eq(offers.status, "accepted")));
    return { ok: false, error: "This car already has an accepted offer." };
  }

  const others = await db
    .update(offers)
    .set({ status: "declined", respondedAt: new Date() })
    .where(and(eq(offers.listingId, listing.id), eq(offers.status, "pending"), ne(offers.id, offer.id)))
    .returning()
    .all();

  await audit(actorId, "offer_accepted", "listing", listing.id, { offerId: offer.id, amount: offer.amount });
  const sync = await syncListing(listing.id, actorId);

  const title = listingTitle(listing);
  const [buyer, seller] = await Promise.all([person(offer.buyerId), person(listing.userId)]);
  const sellerPhone = listing.contactMethod === "messages_phone" ? listing.contactPhone : null;

  // Contact exchange always goes out, whatever the notification setting.
  await Promise.all([
    sendEmail({
      to: buyer.email,
      subject: `Offer accepted: ${title} for ${formatPrice(offer.amount)}`,
      paragraphs: [
        `Good news, ${buyer.firstName}. Your deal on the ${title} for ${formatPrice(offer.amount)} is agreed.`,
        `Contact the seller to arrange an inspection and payment: ${seller.displayName}, ${seller.email}${sellerPhone ? `, ${sellerPhone}` : ""}.`,
        "Stay safe: see the car and the title in person before you pay. Never wire money or pay a deposit to someone you have not met.",
      ],
      action: { label: "See the deal", url: absoluteUrl(url("/offers")) },
    }).catch((e) => console.error("[offers] accept email failed", safeError(e))),
    sendEmail({
      to: seller.email,
      subject: `Offer accepted: ${title} for ${formatPrice(offer.amount)}`,
      paragraphs: [
        `Your ${title} deal with ${buyer.displayName} for ${formatPrice(offer.amount)} is agreed.`,
        `Contact the buyer to arrange an inspection and payment: ${buyer.displayName}, ${buyer.email}.`,
        "When the sale is done, mark the car as sold in My garage. If the deal falls through, you can relist it.",
      ],
      // Through sign in: a signed-out visit to /app goes to the Lot instead.
      action: { label: "Open My garage", url: absoluteUrl(`${url("/login")}?next=${encodeURIComponent(url("/"))}`) },
    }).catch((e) => console.error("[offers] accept email failed", safeError(e))),
  ]);

  // Everyone else with an open offer is told the car is under offer.
  for (const o of others) {
    const who = await person(o.buyerId);
    await notifyIfWanted(who, {
      to: who.email,
      subject: `The ${title} has an accepted offer`,
      paragraphs: [
        `The seller accepted another offer on the ${title}, so ${offerPhrase(o)} was declined.`,
        "If that deal falls through and the car is relisted, you can make a new offer.",
      ],
    });
  }
  // Only the seller can retry the update (from their listing page).
  if (!sync.ok) return { ok: true, syncFailed: { listingId: listing.id, bySeller: actorId === listing.userId } };
  return { ok: true };
}

export interface OfferThread {
  key: string;
  listing: Pick<Listing, "id" | "year" | "make" | "model" | "price" | "status" | "slug" | "userId" | "contactMethod" | "contactPhone" | "acceptsOffers" | "deletedAt">;
  buyerId: string;
  role: "buyer" | "seller";
  history: Offer[];
  latest: Offer;
}

/** Offers the user sent (as buyer) and received (as seller), grouped per listing and buyer. */
export async function offersForUser(userId: string): Promise<OfferThread[]> {
  await expireStaleOffers();
  const db = getDb();
  const rows = await db
    .select({ offer: offers, listing: listings })
    .from(offers)
    .innerJoin(listings, eq(listings.id, offers.listingId))
    .where(or(eq(offers.buyerId, userId), eq(listings.userId, userId)))
    .orderBy(offers.createdAt)
    .all();

  const groups = new Map<string, OfferThread>();
  for (const { offer, listing } of rows) {
    const key = `${listing.id}:${offer.buyerId}`;
    let g = groups.get(key);
    if (!g) {
      g = {
        key,
        listing,
        buyerId: offer.buyerId,
        role: offer.buyerId === userId ? "buyer" : "seller",
        history: [],
        latest: offer,
      };
      groups.set(key, g);
    }
    g.history.push(offer);
    g.latest = offer;
  }
  return [...groups.values()].sort((a, b) => b.latest.createdAt.getTime() - a.latest.createdAt.getTime());
}

/** Offers waiting on this user: buyer offers to their cars, and counters to their offers. */
export async function offersNeedingResponse(userId: string): Promise<number> {
  const all = await offersForUser(userId);
  return all.filter(
    (t) =>
      t.latest.status === "pending" &&
      ((t.role === "seller" && t.latest.madeBy === "buyer") || (t.role === "buyer" && t.latest.madeBy === "seller")),
  ).length;
}

export async function contactFor(userId: string) {
  return person(userId);
}
