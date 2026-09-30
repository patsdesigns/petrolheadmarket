import { and, eq, inArray } from "drizzle-orm";
import { getDb } from "../db/client";
import { listings, offers, profiles, user as users, type Listing } from "../db/schema";
import { audit } from "./audit";
import { sendEmail } from "./email";
import { FIELD_RULES, formatPrice, listingTitle } from "./listing-rules";
import { expireStaleOffers, offerPhrase } from "./offers";
import { safeError } from "./log";

export type ActionResult = { ok: true } | { ok: false; error?: string; errors?: Record<string, string> };

/** Fields a seller can change on a live listing. Anything else goes through an admin. */
export async function quickEdit(listing: Listing, form: Record<string, string>): Promise<ActionResult> {
  if (!["live", "offer_accepted"].includes(listing.status)) return { ok: false, error: "This listing can't be changed right now." };

  const errors: Record<string, string> = {};
  const price = FIELD_RULES.price.safeParse(form.price ?? "");
  const phone = FIELD_RULES.contactPhone.safeParse(form.contactPhone ?? "");
  const contactMethod = FIELD_RULES.contactMethod.parse(form.contactMethod ?? "messages");
  const acceptsOffers = form.acceptsOffers === "on";
  if (!price.success) errors.price = price.error.issues[0]?.message ?? "Check the price.";
  else if (price.data === null) errors.price = "Set your price.";
  if (!phone.success) errors.contactPhone = phone.error.issues[0]?.message ?? "Check the phone number.";
  else if (contactMethod === "messages_phone" && !phone.data) errors.contactPhone = "Add the phone number buyers should call.";
  if (Object.keys(errors).length) return { ok: false, errors };

  const next = {
    price: price.data as number,
    acceptsOffers,
    contactMethod,
    contactPhone: (phone.success ? phone.data : null) as string | null,
  };
  const changed = (Object.keys(next) as (keyof typeof next)[]).filter((k) => next[k] !== listing[k]);
  if (changed.length === 0) return { ok: true };

  await getDb()
    .update(listings)
    .set({ ...next, updatedAt: new Date() })
    .where(and(eq(listings.id, listing.id), eq(listings.userId, listing.userId)));
  await audit(listing.userId, "quick_edit", "listing", listing.id, { fields: changed });
  return { ok: true };
}

type OfferRow = { buyerId: string; amount: number; madeBy: string };

/**
 * Email each buyer. With respectSetting, buyers who turned email
 * notifications off are skipped (a closed offer is a decline). An accepted
 * deal ending always goes out, like accepted deal emails.
 */
async function emailBuyers(
  offerRows: OfferRow[],
  subject: string,
  lines: (o: OfferRow) => string[],
  opts: { respectSetting: boolean },
) {
  const db = getDb();
  for (const o of offerRows) {
    const buyer = await db.select().from(users).where(eq(users.id, o.buyerId)).get();
    if (!buyer) continue;
    if (opts.respectSetting) {
      const profile = await db.select().from(profiles).where(eq(profiles.userId, o.buyerId)).get();
      if (profile?.emailNotifications === false) continue;
    }
    await sendEmail({ to: buyer.email, subject, paragraphs: lines(o) }).catch((e) =>
      console.error("[seller] email failed", safeError(e)),
    );
  }
}

export async function markSold(listing: Listing): Promise<ActionResult> {
  const db = getDb();
  const done = await db
    .update(listings)
    .set({ status: "sold", soldAt: new Date(), updatedAt: new Date() })
    .where(and(eq(listings.id, listing.id), inArray(listings.status, ["live", "offer_accepted"])))
    .returning({ id: listings.id })
    .get();
  if (!done) return { ok: false, error: "Only live listings can be marked as sold." };

  // Offers already past their 72 hours expired; they are not closed by the sale.
  await expireStaleOffers();
  const closed = await db
    .update(offers)
    .set({ status: "declined", respondedAt: new Date() })
    .where(and(eq(offers.listingId, listing.id), eq(offers.status, "pending")))
    .returning()
    .all();
  const title = listingTitle(listing);
  await emailBuyers(
    closed,
    `The ${title} has sold`,
    (o) => [
      `The seller marked the ${title} as sold, so ${offerPhrase(o)} was closed.`,
      "Thanks for using Petrol Head Market. There are more great cars on the site.",
    ],
    { respectSetting: true },
  );

  await audit(listing.userId, "mark_sold", "listing", listing.id);
  return { ok: true };
}

/** The accepted deal fell through: put the car back on sale. */
export async function relist(listing: Listing): Promise<ActionResult> {
  const db = getDb();
  const done = await db
    .update(listings)
    .set({ status: "live", updatedAt: new Date() })
    .where(and(eq(listings.id, listing.id), eq(listings.status, "offer_accepted")))
    .returning({ id: listings.id })
    .get();
  if (!done) return { ok: false, error: "Only listings with an accepted offer can be relisted." };

  // "ended", not "withdrawn": the buyer did not pull out, the seller called it off.
  const ended = await db
    .update(offers)
    .set({ status: "ended", respondedAt: new Date() })
    .where(and(eq(offers.listingId, listing.id), eq(offers.status, "accepted")))
    .returning()
    .all();
  const title = listingTitle(listing);
  await emailBuyers(
    ended,
    `The ${title} is back on sale`,
    (o) => [
      `The seller put the ${title} back on sale, so the ${formatPrice(o.amount)} deal is off.`,
      "If you are still interested, you can make a new offer or message the seller.",
    ],
    { respectSetting: false },
  );

  await audit(listing.userId, "relist", "listing", listing.id);
  return { ok: true };
}
