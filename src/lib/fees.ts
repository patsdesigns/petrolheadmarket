// The listing fee. Sellers submit for free; once an admin approves a car it
// either takes one of the free launch spots and goes live at once, or it
// waits in `awaiting_payment` until the seller pays the fee through Stripe
// Checkout (Stripe hosts the card form, so card details never reach us).
//
// Free launch spots: the first FREE_LAUNCH_SPOTS cars published (default
// 150), at most FREE_PER_SELLER per seller (default 2). A spot is taken in
// one statement when the car is approved, so two approvals at once can't
// both take the last spot. Demo cars never use one.
import { env } from "cloudflare:workers";
import { and, count, eq, sql } from "drizzle-orm";
import { getDb } from "../db/client";
import { launchSpots, listings, payments, type Listing } from "../db/schema";
import { audit } from "./audit";
import { publishListing, sellerContact, type PublishResult } from "./cms";
import { absoluteUrl } from "./config";
import { DEMO_SELLER_ID } from "./demo-cars";
import { listingTitle } from "./listing-rules";
import { errorMessage, safeError } from "./log";
import { notifySellerPay } from "./notify";
import { url } from "./paths";

const int = (value: string | undefined, fallback: number, min = 0) => {
  const n = Number(value);
  return Number.isInteger(n) && n >= min ? n : fallback;
};

/** The listing fee in cents (LISTING_FEE_CENTS, default $100). */
export function feeCents(): number {
  return int(env.LISTING_FEE_CENTS, 10000, 100);
}

/** "$100" (or "$99.50"). */
export function feeText(cents = feeCents()): string {
  return `$${(cents / 100).toLocaleString("en-US", { minimumFractionDigits: cents % 100 ? 2 : 0 })}`;
}

export function launchTotal(): number {
  return int(env.FREE_LAUNCH_SPOTS, 150);
}

export function freePerSeller(): number {
  return int(env.FREE_PER_SELLER, 2);
}

/** Card payments are on when Stripe's secret key is set. */
export function paymentsConfigured(): boolean {
  return Boolean(env.STRIPE_SECRET_KEY);
}

export interface LaunchStatus {
  total: number;
  used: number;
  left: number;
  perSeller: number;
  /** For a seller: free spots of theirs still open (0 when the launch is over). */
  sellerLeft: number | null;
}

export async function launchStatus(userId?: string): Promise<LaunchStatus> {
  const db = getDb();
  const [all, mine] = await Promise.all([
    db.select({ n: count() }).from(launchSpots).get(),
    userId ? db.select({ n: count() }).from(launchSpots).where(eq(launchSpots.userId, userId)).get() : Promise.resolve(null),
  ]);
  const total = launchTotal();
  const used = all?.n ?? 0;
  const left = Math.max(0, total - used);
  const perSeller = freePerSeller();
  return {
    total,
    used,
    left,
    perSeller,
    sellerLeft: mine ? Math.min(left, Math.max(0, perSeller - mine.n)) : null,
  };
}

/** Does this listing already hold a free spot? */
async function hasSpot(listingId: string): Promise<boolean> {
  return Boolean(await getDb().select({ id: launchSpots.listingId }).from(launchSpots).where(eq(launchSpots.listingId, listingId)).get());
}

/** Has the fee for this listing been paid? */
export async function isPaid(listingId: string): Promise<boolean> {
  return Boolean(
    await getDb()
      .select({ id: payments.id })
      .from(payments)
      .where(and(eq(payments.listingId, listingId), eq(payments.status, "paid")))
      .get(),
  );
}

/** Take a free launch spot for this listing if one is open (one statement, so it can't oversell). */
async function claimSpot(listingId: string, userId: string): Promise<boolean> {
  const db = getDb();
  const res = await db.run(sql`
    INSERT INTO launch_spots (listing_id, user_id, created_at)
    SELECT ${listingId}, ${userId}, ${Date.now()}
    WHERE (SELECT COUNT(*) FROM launch_spots) < ${launchTotal()}
      AND (SELECT COUNT(*) FROM launch_spots WHERE user_id = ${userId}) < ${freePerSeller()}
    ON CONFLICT (listing_id) DO NOTHING`);
  return (res.meta?.changes ?? 0) > 0;
}

export type ApproveOutcome = (PublishResult & { kind: "published" }) | { kind: "awaiting_payment" };

/**
 * After an admin approved a listing (status `approved`): publish it when it
 * is free (a demo car, a launch spot, or already paid), otherwise move it to
 * `awaiting_payment` and tell the seller.
 */
export async function afterApproval(listing: Listing, actorId: string): Promise<ApproveOutcome> {
  const free =
    listing.userId === DEMO_SELLER_ID ||
    (await hasSpot(listing.id)) ||
    (await isPaid(listing.id)) ||
    (await claimSpot(listing.id, listing.userId));
  if (free) return { kind: "published", ...(await publishListing(listing.id, actorId)) };
  const moved = await getDb()
    .update(listings)
    .set({ status: "awaiting_payment", updatedAt: new Date() })
    .where(and(eq(listings.id, listing.id), eq(listings.status, "approved")))
    .returning({ id: listings.id })
    .get();
  if (moved) {
    await audit(actorId, "awaiting_payment", "listing", listing.id, { fee: feeCents() });
    const seller = await sellerContact(listing.userId);
    if (seller) await notifySellerPay(seller, listing.id, listingTitle(listing), feeText());
  }
  return { kind: "awaiting_payment" };
}

/** Admin: publish a listing that is waiting for payment without charging (audited). */
export async function waiveFee(listingId: string, actorId: string): Promise<PublishResult> {
  const db = getDb();
  const moved = await db
    .update(listings)
    .set({ status: "approved", updatedAt: new Date() })
    .where(and(eq(listings.id, listingId), eq(listings.status, "awaiting_payment")))
    .returning({ id: listings.id })
    .get();
  if (!moved) return { ok: false, error: "This listing is not waiting for payment." };
  await audit(actorId, "fee_waived", "listing", listingId);
  return publishListing(listingId, actorId);
}

// ---------------------------------------------------------------- Stripe

interface StripeSession {
  id: string;
  url?: string | null;
  status?: string;
  payment_status?: string;
  amount_total?: number | null;
  currency?: string | null;
  client_reference_id?: string | null;
  metadata?: Record<string, string> | null;
}

async function stripe(path: string, init: { method?: string; form?: Record<string, string> } = {}): Promise<StripeSession> {
  // STRIPE_API_BASE is only for local tests against a fake API. Leave it unset.
  const res = await fetch(`${env.STRIPE_API_BASE || "https://api.stripe.com"}/v1/${path}`, {
    method: init.method ?? "GET",
    headers: {
      Authorization: `Bearer ${env.STRIPE_SECRET_KEY}`,
      ...(init.form ? { "Content-Type": "application/x-www-form-urlencoded" } : {}),
    },
    body: init.form ? new URLSearchParams(init.form).toString() : undefined,
  });
  const body = (await res.json().catch(() => ({}))) as StripeSession & { error?: { message?: string } };
  if (!res.ok) throw new Error(`Stripe ${res.status}: ${body.error?.message ?? "request failed"}`);
  return body;
}

export type CheckoutResult = { ok: true; url: string } | { ok: false; error: string };

/** Start Stripe Checkout for the seller's listing fee. */
export async function startCheckout(listing: Listing, email: string): Promise<CheckoutResult> {
  if (listing.status !== "awaiting_payment") return { ok: false, error: "This listing is not waiting for payment." };
  if (!paymentsConfigured()) return { ok: false, error: "Card payments are not open yet. We will let you know as soon as they are." };
  const amount = feeCents();
  const back = absoluteUrl(url(`/listings/${listing.id}`));
  try {
    const session = await stripe("checkout/sessions", {
      method: "POST",
      form: {
        mode: "payment",
        "line_items[0][quantity]": "1",
        "line_items[0][price_data][currency]": "usd",
        "line_items[0][price_data][unit_amount]": String(amount),
        "line_items[0][price_data][product_data][name]": `Listing fee: ${listingTitle(listing)}`.slice(0, 200),
        client_reference_id: listing.id,
        "metadata[listing_id]": listing.id,
        "metadata[user_id]": listing.userId,
        customer_email: email,
        success_url: `${back}?paid=1&session_id={CHECKOUT_SESSION_ID}`,
        cancel_url: `${back}?pay=cancelled`,
      },
    });
    if (!session.url) throw new Error("Stripe gave no checkout address");
    await getDb()
      .insert(payments)
      .values({ id: crypto.randomUUID(), listingId: listing.id, userId: listing.userId, stripeSessionId: session.id, amount });
    await audit(listing.userId, "checkout_started", "listing", listing.id, { amount });
    return { ok: true, url: session.url };
  } catch (err) {
    console.error("[fees] checkout failed", listing.id, safeError(err));
    return { ok: false, error: "We couldn't open the payment page. Please try again in a minute." };
  }
}

export type PaidResult = { ok: true; published: boolean; slug?: string } | { ok: false; error: string };

/**
 * A checkout session finished (the webhook, or the seller coming back from
 * Stripe). Checks the session with Stripe's own data, records the payment
 * once and publishes the listing. Safe to call more than once.
 */
export async function settleSession(sessionId: string, given?: StripeSession, expectListing?: string): Promise<PaidResult> {
  const db = getDb();
  const row = await db.select().from(payments).where(eq(payments.stripeSessionId, sessionId)).get();
  if (!row || (expectListing && row.listingId !== expectListing)) return { ok: false, error: "We don't know this payment." };
  let session = given;
  try {
    // The webhook body is signed; a return from Stripe is only an id, so ask Stripe.
    if (!session) session = await stripe(`checkout/sessions/${encodeURIComponent(sessionId)}`);
  } catch (err) {
    console.error("[fees] session lookup failed", row.listingId, safeError(err));
    return { ok: false, error: "We couldn't confirm the payment yet. Refresh in a minute." };
  }
  if (session.payment_status !== "paid") return { ok: false, error: "The payment is not finished yet." };
  if (session.metadata?.listing_id !== row.listingId || (session.amount_total ?? 0) < row.amount) {
    console.error("[fees] session does not match its payment row", row.listingId);
    return { ok: false, error: "This payment does not match the listing." };
  }
  const first = await db
    .update(payments)
    .set({ status: "paid", paidAt: new Date() })
    .where(and(eq(payments.id, row.id), eq(payments.status, "pending")))
    .returning({ id: payments.id })
    .get();
  if (first) await audit(row.userId, "fee_paid", "listing", row.listingId, { amount: row.amount });
  const moved = await db
    .update(listings)
    .set({ status: "approved", updatedAt: new Date() })
    .where(and(eq(listings.id, row.listingId), eq(listings.status, "awaiting_payment")))
    .returning({ id: listings.id })
    .get();
  if (!moved) {
    const now = await db.select({ status: listings.status, slug: listings.slug }).from(listings).where(eq(listings.id, row.listingId)).get();
    if (now && (now.status === "live" || now.status === "offer_accepted" || now.status === "sold")) return { ok: true, published: true, slug: now.slug ?? undefined };
    // Paid, but the listing moved on (waived, deleted, taken down): flag it for a refund.
    if (first) await audit(null, "fee_paid_not_published", "listing", row.listingId, { status: now?.status ?? "deleted" });
    return { ok: true, published: false };
  }
  const published = await publishListing(row.listingId, null);
  if (!published.ok) {
    await audit(null, "publish_after_payment_failed", "listing", row.listingId, { error: errorMessage(published.error) });
    return { ok: true, published: false };
  }
  return { ok: true, published: true, slug: published.slug };
}

/** Check a Stripe webhook signature (Stripe-Signature: t=...,v1=...). */
export async function verifyWebhook(body: string, header: string | null, now = Date.now()): Promise<boolean> {
  const secret = env.STRIPE_WEBHOOK_SECRET;
  if (!secret || !header) return false;
  const parts = header.split(",").map((p) => p.trim().split("="));
  const t = parts.find(([k]) => k === "t")?.[1];
  const sigs = parts.filter(([k]) => k === "v1").map(([, v]) => v);
  if (!t || !sigs.length || Math.abs(now / 1000 - Number(t)) > 300) return false;
  const key = await crypto.subtle.importKey("raw", new TextEncoder().encode(secret), { name: "HMAC", hash: "SHA-256" }, false, ["sign"]);
  const mac = new Uint8Array(await crypto.subtle.sign("HMAC", key, new TextEncoder().encode(`${t}.${body}`)));
  const hex = [...mac].map((b) => b.toString(16).padStart(2, "0")).join("");
  // Compare every candidate in full (no early exit on the first differing byte).
  return sigs.some((s) => {
    if (s.length !== hex.length) return false;
    let diff = 0;
    for (let i = 0; i < hex.length; i++) diff |= hex.charCodeAt(i) ^ s.charCodeAt(i);
    return diff === 0;
  });
}

/** Mark a session that Stripe expired (the seller left without paying). */
export async function expireSession(sessionId: string): Promise<void> {
  await getDb()
    .update(payments)
    .set({ status: "expired" })
    .where(and(eq(payments.stripeSessionId, sessionId), eq(payments.status, "pending")));
}

/** What listing costs this seller, in one or two plain sentences. */
export function feeLine(s: LaunchStatus): string {
  if (s.sellerLeft === null ? s.left > 0 : s.sellerLeft > 0) {
    return `Launch offer: listing is free for the first ${s.total} cars (${s.left} free spots left, up to ${s.perSeller} per seller). After that it is ${feeText()}, paid only once your car is approved.`;
  }
  const why = s.left > 0 ? `You have used your ${s.perSeller} free launch listings. ` : "";
  return `${why}Listing costs ${feeText()}, paid only after your car is approved. If it is not accepted, you pay nothing.`;
}
