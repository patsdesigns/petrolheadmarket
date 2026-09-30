import { and, asc, eq, inArray, isNotNull, isNull, lt, ne, or, sql } from "drizzle-orm";
import { waitUntil } from "cloudflare:workers";
import { getDb } from "../db/client";
import { jobRuns, listings, profiles, user as users, type Listing, type ListingPhoto } from "../db/schema";
import { absoluteUrl } from "./config";
import { BODY_STYLES, CONTACT_METHODS, DRIVETRAINS, TRANSMISSIONS } from "./listing-options";
import { formatMiles, formatPrice, listingTitle } from "./listing-rules";
import { getPhotos } from "./listings";
import { photoUrl } from "./paths";
import { toList, toParagraphs } from "./richtext";
import { audit, auditFor } from "./audit";
import { notifySellerLive } from "./notify";
import {
  createLiveItem,
  deleteItem,
  findItemBySlug,
  NOT_CONFIGURED_MESSAGE,
  unpublishLiveItem,
  updateLiveItem,
  webflowConfigured,
  WebflowError,
} from "./webflow";
import { errorMessage, safeError } from "./log";

const GALLERY_LIMIT = 25; // Webflow MultiImage limit

const LISTING_STATUS_IDS: Record<string, string> = {
  live: "5e06ac221c7686cd9fe03a747df40634",
  offer_accepted: "f30aec956457559c7fa0710fc30edf55",
  sold: "b2c0f9c78f4767dac05e3fd0d11327ac",
};
const SELLER_TYPE_IDS = {
  private: "b6ae57a7308ca3d8bbef3755730992a1",
  dealer: "cde1823dfbd6754b36ea2269c9f04a19",
} as const;
const TITLE_LABELS: Record<string, string> = {
  clean: "CLEAN",
  rebuilt: "REBUILT",
  salvage: "SALVAGE",
  lien: "CLEAN, LIEN",
  none: "NO TITLE",
};

const cmsId = (list: readonly { value: string; cms: string }[], value: string | null) =>
  list.find((o) => o.value === value)?.cms ?? null;

export function slugify(s: string): string {
  return s
    .toLowerCase()
    .normalize("NFKD")
    .replace(/[̀-ͯ]/g, "")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 80);
}

export function baseSlug(l: Pick<Listing, "year" | "make" | "model">): string {
  return slugify(`${l.year ?? ""} ${l.make ?? ""} ${l.model ?? ""}`) || "listing";
}

/** The full CMS field set for a listing. Only the display name and, if chosen, the phone leave the app. */
export function buildFieldData(
  listing: Listing,
  photos: ListingPhoto[],
  sellerDisplayName: string,
  status: "live" | "offer_accepted" | "sold",
): Record<string, unknown> {
  const image = (p: ListingPhoto, i: number) => ({
    url: absoluteUrl(photoUrl(p.r2Key)),
    alt: `${listingTitle(listing)}, photo ${i + 1}`,
  });
  const showPhone = listing.contactMethod === "messages_phone" && listing.contactPhone;
  const location = [listing.locationCity, listing.locationState].filter(Boolean).join(", ");
  // No title (bill of sale) has no state to show.
  const titleState = listing.titleStatus === "none" ? "" : (listing.titleState ?? "");
  const title = [TITLE_LABELS[listing.titleStatus ?? ""] ?? "", titleState].filter(Boolean).join(" - ");

  return {
    name: listingTitle(listing),
    year: listing.year,
    make: listing.make,
    model: listing.model,
    price: listing.price,
    "price-display": formatPrice(listing.price),
    mileage: listing.mileage,
    "miles-display": formatMiles(listing.mileage),
    transmission: cmsId(TRANSMISSIONS, listing.transmission),
    engine: listing.engine,
    drivetrain: cmsId(DRIVETRAINS, listing.drivetrain),
    "body-style": cmsId(BODY_STYLES, listing.bodyStyle),
    "exterior-color": listing.exteriorColor,
    "interior-color": listing.interiorColor,
    vin: listing.vin,
    "title-status": title || null,
    "owner-count-label": listing.ownerCount ? `${listing.ownerCount} Owner${listing.ownerCount === 1 ? "" : "s"}` : null,
    location: location || null,
    headline: listing.headline,
    description: toParagraphs(listing.description),
    highlights: toList(listing.highlights),
    "known-issues": toList(listing.knownIssues),
    modifications: toList(listing.modifications),
    "service-history": toParagraphs(listing.serviceHistory),
    video: listing.videoUrl,
    "main-photo": photos[0] ? image(photos[0], 0) : null,
    gallery: photos.slice(0, GALLERY_LIMIT).map(image),
    "photo-count": photos.length,
    "listed-on": (listing.publishedAt ?? new Date()).toISOString(),
    "listing-status": LISTING_STATUS_IDS[status],
    "accepts-offers": listing.acceptsOffers,
    "contact-method": cmsId(CONTACT_METHODS, listing.contactMethod),
    "seller-display-name": sellerDisplayName,
    "seller-phone": showPhone ? listing.contactPhone : null,
    "seller-type": SELLER_TYPE_IDS[listing.sellerType],
    "verified-seller": listing.verifiedSeller,
    "records-on-file": listing.recordsOnFile,
    featured: listing.featured,
    "seller-id": listing.userId,
    "app-listing-id": listing.id,
  };
}

async function sellerName(userId: string): Promise<string> {
  const p = await getDb().select().from(profiles).where(eq(profiles.userId, userId)).get();
  return p?.displayName ?? "Private seller";
}

/** True if a slug is used by another listing in our DB or by any CMS item that isn't this listing's. */
async function slugClash(candidate: string, listing: Listing): Promise<boolean> {
  const localClash = await getDb()
    .select({ id: listings.id })
    .from(listings)
    .where(and(eq(listings.slug, candidate), ne(listings.id, listing.id)))
    .get();
  if (localClash) return true;
  const item = await findItemBySlug(candidate);
  return item !== null && item.fieldData?.["app-listing-id"] !== listing.id;
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

/**
 * Pick a slug and save it before anything is created in the CMS, so a retry
 * reuses it (and can find the item a lost response created).
 */
async function reserveSlug(listing: Listing, skipBase = false): Promise<string> {
  const db = getDb();
  for (let i = 0; i < 3; i++) {
    const slug = await pickSlug(listing, skipBase || i > 0);
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

export type PublishResult =
  | { ok: true; slug: string }
  | { ok: false; error: string; busy?: boolean; notConfigured?: boolean };

const PUBLISH_LEASE_MS = 2 * 60_000;

async function sellerContact(userId: string) {
  const db = getDb();
  const u = await db.select().from(users).where(eq(users.id, userId)).get();
  if (!u) return null;
  const p = await db.select({ notify: profiles.emailNotifications }).from(profiles).where(eq(profiles.userId, userId)).get();
  return { email: u.email, name: u.name?.split(/\s+/)[0] || "there", notify: p?.notify ?? true };
}

/**
 * Publish an approved listing as a live CMS item and email the seller. On
 * failure the listing stays `approved` and the error is logged; the admin can
 * retry, and retryPendingCms() tries again on its own.
 *
 * Safe to call twice at once: the first call claims the listing
 * (publishing_at), the slug is saved before the create, and an item that
 * already carries this listing's id is adopted rather than created again.
 */
export async function publishListing(listingId: string, actorId: string | null): Promise<PublishResult> {
  if (!webflowConfigured()) return { ok: false, error: NOT_CONFIGURED_MESSAGE, notConfigured: true };
  const db = getDb();
  const now = new Date();
  const listing = await db
    .update(listings)
    .set({ publishingAt: now, cmsAttemptedAt: now })
    .where(
      and(
        eq(listings.id, listingId),
        eq(listings.status, "approved"),
        or(isNull(listings.publishingAt), lt(listings.publishingAt, new Date(now.getTime() - PUBLISH_LEASE_MS))),
      ),
    )
    .returning()
    .get();
  if (!listing) {
    const current = await db.select({ status: listings.status }).from(listings).where(eq(listings.id, listingId)).get();
    if (current?.status === "approved") return { ok: false, busy: true, error: "Publishing is already in progress." };
    return { ok: false, error: "Listing is not approved." };
  }

  try {
    const photos = await getPhotos(listing.id);
    const publishedAt = listing.publishedAt ?? now;
    const name = await sellerName(listing.userId);
    let slug = listing.slug ?? (await reserveSlug(listing));
    const fields = () => ({ ...buildFieldData({ ...listing, publishedAt }, photos, name, "live"), slug });

    let itemId = listing.cmsItemId;
    if (!itemId) {
      // A previous try may have created the item and lost the response.
      const existing = await findItemBySlug(slug);
      if (existing && existing.fieldData?.["app-listing-id"] === listing.id) itemId = existing.id;
      else if (existing) slug = await reserveSlug(listing, true);
    }

    if (itemId) {
      await updateLiveItem(itemId, fields());
      if (itemId !== listing.cmsItemId) {
        await db.update(listings).set({ cmsItemId: itemId }).where(eq(listings.id, listing.id));
      }
    } else {
      let item;
      try {
        item = await createLiveItem(fields());
      } catch (err) {
        // The slug lookup can miss a clash (e.g. an archived item). Try once more with a suffix.
        if (!(err instanceof WebflowError && err.status === 400 && /slug/i.test(err.message))) throw err;
        const clash = await findItemBySlug(slug);
        if (clash && clash.fieldData?.["app-listing-id"] === listing.id) {
          item = await updateLiveItem(clash.id, fields());
        } else {
          slug = await reserveSlug(listing, true);
          item = await createLiveItem(fields());
        }
      }
      itemId = item.id;
      // Record the item straight away, so any later retry updates it.
      await db.update(listings).set({ cmsItemId: itemId }).where(eq(listings.id, listing.id));
    }

    const done = await db
      .update(listings)
      .set({ status: "live", slug, cmsItemId: itemId, publishedAt, publishingAt: null, cmsSyncPending: false, updatedAt: new Date() })
      .where(and(eq(listings.id, listing.id), eq(listings.status, "approved")))
      .returning({ id: listings.id })
      .get();
    if (!done) {
      // Moved back to review or taken down while this was running: take the item off again.
      await db.update(listings).set({ publishingAt: null }).where(eq(listings.id, listing.id));
      await unpublishListing(listing.id, actorId);
      return { ok: false, error: "The listing changed while it was being published." };
    }
    await audit(actorId, "cms_publish", "listing", listing.id, { cmsItemId: itemId, slug });
    const seller = await sellerContact(listing.userId);
    if (seller) await notifySellerLive(seller, listing.id, listingTitle(listing), slug);
    return { ok: true, slug };
  } catch (err) {
    await db.update(listings).set({ publishingAt: null, cmsAttemptedAt: new Date() }).where(eq(listings.id, listing.id));
    const error = errorMessage(err);
    console.error("[cms] publish failed", listing.id, error);
    await auditFailure(actorId, "cms_publish_failed", listing.id, {
      error,
      status: err instanceof WebflowError ? err.status : null,
    });
    return { ok: false, error };
  }
}

/** Statuses whose listing is an item on the live site. */
export const IN_CMS_STATUSES = ["live", "offer_accepted", "sold"] as const;

const markPending = (listingId: string, pending: boolean) =>
  getDb()
    .update(listings)
    .set(pending ? { cmsSyncPending: true, cmsAttemptedAt: new Date() } : { cmsSyncPending: false })
    .where(eq(listings.id, listingId));

/**
 * Audit a failed publish, sync or unpublish. The lazy retry (no actor) runs
 * every minute while an admin is on the admin pages, so it only adds a row
 * when the error differs from the listing's latest entry. Otherwise one
 * listing that keeps failing would push everything else out of its History.
 */
async function auditFailure(actorId: string | null, action: string, listingId: string, data: { error: string } & Record<string, unknown>) {
  if (actorId === null) {
    const [last] = await auditFor("listing", listingId, 1);
    const lastError = (last?.data as { error?: unknown } | null)?.error;
    if (last?.action === action && lastError === data.error) return;
  }
  await audit(actorId, action, "listing", listingId, data);
}

/**
 * Push the current state of a listing that is already in the CMS
 * (live, offer accepted or sold). Used after quick edits and status changes.
 * A failure sets cms_sync_pending, which the admin pages retry.
 */
export async function syncListing(listingId: string, actorId: string | null): Promise<PublishResult> {
  const db = getDb();
  const listing = await db.select().from(listings).where(eq(listings.id, listingId)).get();
  if (!listing?.cmsItemId || !listing.slug) return { ok: false, error: "Listing is not in the CMS." };
  if (!(listing.status in LISTING_STATUS_IDS)) return { ok: false, error: `Status ${listing.status} is not synced.` };

  try {
    const photos = await getPhotos(listing.id);
    const fieldData = {
      ...buildFieldData(listing, photos, await sellerName(listing.userId), listing.status as "live"),
      slug: listing.slug,
    };
    await updateLiveItem(listing.cmsItemId, fieldData);
    // The PATCH publishes the item. If the listing was taken down while it
    // was on its way, it may have landed after the take down's unpublish and
    // put the car back on the Lot, so take it off again.
    const current = await db.select({ status: listings.status }).from(listings).where(eq(listings.id, listing.id)).get();
    if (!current || !(IN_CMS_STATUSES as readonly string[]).includes(current.status)) {
      await unpublishListing(listing.id, actorId);
      return { ok: false, error: "The listing changed while it was being updated." };
    }
    if (listing.cmsSyncPending) {
      // Only while it is still a listing that belongs on the site, so a
      // pending unpublish is never cleared by a sync that lost the race.
      await db
        .update(listings)
        .set({ cmsSyncPending: false })
        .where(and(eq(listings.id, listing.id), inArray(listings.status, [...IN_CMS_STATUSES])));
    }
    await audit(actorId, "cms_sync", "listing", listing.id, { status: listing.status });
    return { ok: true, slug: listing.slug };
  } catch (err) {
    const error = errorMessage(err);
    console.error("[cms] sync failed", listing.id, error);
    await markPending(listing.id, true);
    await auditFailure(actorId, "cms_sync_failed", listing.id, { error });
    return { ok: false, error };
  }
}

/**
 * Take a listing's item off the public site. Used when a listing is taken
 * down. The listing's own status is changed by the caller first. The item
 * id and slug are kept (the slug stays reserved, and a later delete can
 * remove the staged item). A failure sets cms_sync_pending for a retry.
 */
export async function unpublishListing(listingId: string, actorId: string | null): Promise<{ ok: boolean; error?: string }> {
  const listing = await getDb().select().from(listings).where(eq(listings.id, listingId)).get();
  if (!listing?.cmsItemId) return { ok: true };
  try {
    await unpublishLiveItem(listing.cmsItemId);
    if (listing.cmsSyncPending) await markPending(listing.id, false);
    await audit(actorId, "cms_unpublish", "listing", listing.id, { cmsItemId: listing.cmsItemId });
    return { ok: true };
  } catch (err) {
    const error = errorMessage(err);
    console.error("[cms] unpublish failed", listing.id, error);
    await markPending(listing.id, true);
    await auditFailure(actorId, "cms_unpublish_failed", listing.id, { error });
    return { ok: false, error };
  }
}

/**
 * Bring the CMS in line with the app for one listing: sync it when it should
 * be on the site, take it off when it should not.
 */
export async function resyncListing(listingId: string, actorId: string | null): Promise<{ ok: boolean; error?: string }> {
  const listing = await getDb().select().from(listings).where(eq(listings.id, listingId)).get();
  if (!listing?.cmsItemId) return { ok: false, error: "Listing is not in the CMS." };
  if ((IN_CMS_STATUSES as readonly string[]).includes(listing.status)) return syncListing(listingId, actorId);
  return unpublishListing(listingId, actorId);
}

/**
 * Remove a taken down listing's item from the CMS for good, before the
 * listing itself is deleted. Refuses while the item may still be live.
 */
export async function removeFromCms(listing: Listing): Promise<{ ok: boolean; error?: string }> {
  if (!listing.cmsItemId) return { ok: true };
  if (listing.cmsSyncPending) {
    const r = await unpublishListing(listing.id, listing.userId);
    if (!r.ok) return { ok: false, error: "It is still being taken off the site. Try again in a few minutes." };
  }
  try {
    await deleteItem(listing.cmsItemId);
  } catch (err) {
    // The item is already off the live site; a leftover staged copy is harmless.
    console.error("[cms] delete item failed", listing.id, errorMessage(err));
  }
  return { ok: true };
}

const RETRY_EVERY_MS = 60_000;
const RETRY_BATCH = 5;

/**
 * Lazy retry (there is no cron): publish approved listings and fix listings
 * with a pending CMS sync or unpublish. Runs when any admin page loads
 * (scheduleCmsRetry), at most once a minute (a job_runs row), and only when
 * publishing is configured, so no failures pile up in the audit log while
 * the token is missing. `force` skips the throttle (the Retry all button).
 */
export async function retryPendingCms(opts: { force?: boolean } = {}): Promise<{ published: number; synced: number; failed: number } | null> {
  if (!webflowConfigured()) return null;
  const db = getDb();
  const now = Date.now();
  const claimed = await db
    .insert(jobRuns)
    .values({ name: "cms_retry", ranAt: now })
    .onConflictDoUpdate({
      target: jobRuns.name,
      set: { ranAt: now },
      setWhere: opts.force ? undefined : sql`${jobRuns.ranAt} < ${now - RETRY_EVERY_MS}`,
    })
    .returning({ name: jobRuns.name })
    .get();
  if (!claimed) return null;

  const result = { published: 0, synced: 0, failed: 0 };
  const approved = await db
    .select({ id: listings.id })
    .from(listings)
    .where(eq(listings.status, "approved"))
    // Never tried first (NULL sorts first), then the ones tried longest ago,
    // so listings that keep failing rotate to the back of the line.
    .orderBy(asc(listings.cmsAttemptedAt), asc(listings.reviewedAt))
    .limit(RETRY_BATCH)
    .all();
  for (const l of approved) {
    const r = await publishListing(l.id, null);
    if (r.ok) result.published++;
    else if (!("busy" in r && r.busy)) result.failed++;
  }

  const pending = await db
    .select({ id: listings.id })
    .from(listings)
    .where(and(eq(listings.cmsSyncPending, true), isNotNull(listings.cmsItemId)))
    .orderBy(asc(listings.cmsAttemptedAt), asc(listings.updatedAt))
    .limit(RETRY_BATCH)
    .all();
  for (const l of pending) {
    const r = await resyncListing(l.id, null);
    if (r.ok) result.synced++;
    else result.failed++;
  }
  return result;
}

/**
 * Start the lazy retry after the response is sent, so the page stays fast.
 * Called by every admin page (AdminNav and the review screen) on GET.
 */
export async function scheduleCmsRetry(): Promise<void> {
  if (!webflowConfigured()) return;
  const job = retryPendingCms().then(
    () => undefined,
    (err) => console.error("[cms] lazy retry failed", safeError(err)),
  );
  try {
    waitUntil(job);
  } catch {
    await job;
  }
}

/** Listings whose CMS item is out of date, for the admin queue. */
export async function pendingCmsListings() {
  return getDb()
    .select()
    .from(listings)
    .where(and(eq(listings.cmsSyncPending, true), isNotNull(listings.cmsItemId)))
    .orderBy(asc(listings.updatedAt))
    .all();
}
