import type { APIRoute } from "astro";
import { and, eq } from "drizzle-orm";
import { env } from "cloudflare:workers";
import { getDb } from "../../../../../db/client";
import { listingPhotos } from "../../../../../db/schema";
import { getOwnListing, isEditable, touchListing } from "../../../../../lib/listings";
import { json, jsonError } from "../../../../../lib/api";

export const DELETE: APIRoute = async ({ locals, params }) => {
  if (!locals.user || !params.id || !params.photoId) return jsonError("Sign in first.", 401);
  const listing = await getOwnListing(locals.user.id, params.id);
  if (!listing) return jsonError("Listing not found.", 404);
  if (!isEditable(listing)) return jsonError("This listing can't be changed right now.", 409);

  const db = getDb();
  const photo = await db
    .select()
    .from(listingPhotos)
    .where(and(eq(listingPhotos.id, params.photoId), eq(listingPhotos.listingId, listing.id)))
    .get();
  if (!photo) return jsonError("Photo not found.", 404);

  await db.delete(listingPhotos).where(eq(listingPhotos.id, photo.id));
  await env.PHOTOS.delete(photo.r2Key);
  await touchListing(listing.id);
  return json({ ok: true });
};
