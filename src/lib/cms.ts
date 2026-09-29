import { and, eq, ne } from "drizzle-orm";
import { getDb } from "../db/client";
import { listings, profiles, type Listing, type ListingPhoto } from "../db/schema";
import { absoluteUrl } from "./config";
import { BODY_STYLES, CONTACT_METHODS, DRIVETRAINS, TRANSMISSIONS } from "./listing-options";
import { formatMiles, formatPrice, listingTitle } from "./listing-rules";
import { getPhotos } from "./listings";
import { photoUrl } from "./paths";
import { toList, toParagraphs } from "./richtext";
import { audit } from "./audit";
import { createLiveItem, slugTaken, updateLiveItem, WebflowError } from "./webflow";

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
  const title = [TITLE_LABELS[listing.titleStatus ?? ""] ?? "", listing.titleState ?? ""].filter(Boolean).join(" - ");

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

async function pickSlug(listing: Listing): Promise<string> {
  const db = getDb();
  const base = baseSlug(listing);
  for (let i = 0; i < 6; i++) {
    const candidate = i === 0 ? base : `${base}-${crypto.randomUUID().slice(0, 4)}`;
    const localClash = await db
      .select({ id: listings.id })
      .from(listings)
      .where(and(eq(listings.slug, candidate), ne(listings.id, listing.id)))
      .get();
    if (localClash) continue;
    if (await slugTaken(candidate)) continue;
    return candidate;
  }
  return `${base}-${crypto.randomUUID().slice(0, 8)}`;
}

export type PublishResult = { ok: true; slug: string } | { ok: false; error: string };

/**
 * Publish an approved listing as a live CMS item. On failure the listing
 * stays `approved` and the error is logged so an admin can retry.
 */
export async function publishListing(listingId: string, actorId: string): Promise<PublishResult> {
  const db = getDb();
  const listing = await db.select().from(listings).where(eq(listings.id, listingId)).get();
  if (!listing || listing.status !== "approved") return { ok: false, error: "Listing is not approved." };

  try {
    const photos = await getPhotos(listing.id);
    const publishedAt = listing.publishedAt ?? new Date();
    const fieldData = {
      ...buildFieldData({ ...listing, publishedAt }, photos, await sellerName(listing.userId), "live"),
      slug: listing.slug ?? (await pickSlug(listing)),
    };

    // A previous attempt may have created the item already.
    let item;
    if (listing.cmsItemId) {
      item = await updateLiveItem(listing.cmsItemId, fieldData);
    } else {
      try {
        item = await createLiveItem(fieldData);
      } catch (err) {
        // The slug lookup can miss a clash (e.g. an archived item). Try once more with a suffix.
        if (!(err instanceof WebflowError && err.status === 400 && /slug/i.test(err.message))) throw err;
        fieldData.slug = `${baseSlug(listing)}-${crypto.randomUUID().slice(0, 4)}`;
        item = await createLiveItem(fieldData);
      }
    }
    const slug = fieldData.slug;

    await db
      .update(listings)
      .set({ status: "live", slug, cmsItemId: item.id, publishedAt, updatedAt: new Date() })
      .where(eq(listings.id, listing.id));
    await audit(actorId, "cms_publish", "listing", listing.id, { cmsItemId: item.id, slug });
    return { ok: true, slug };
  } catch (err) {
    const error = err instanceof Error ? err.message : String(err);
    console.error("[cms] publish failed", listing.id, error);
    await audit(actorId, "cms_publish_failed", "listing", listing.id, {
      error,
      status: err instanceof WebflowError ? err.status : null,
    });
    return { ok: false, error };
  }
}

/**
 * Push the current state of a listing that is already in the CMS
 * (live, offer accepted or sold). Used after quick edits and status changes.
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
    await audit(actorId, "cms_sync", "listing", listing.id, { status: listing.status });
    return { ok: true, slug: listing.slug };
  } catch (err) {
    const error = err instanceof Error ? err.message : String(err);
    console.error("[cms] sync failed", listing.id, error);
    await audit(actorId, "cms_sync_failed", "listing", listing.id, { error });
    return { ok: false, error };
  }
}
