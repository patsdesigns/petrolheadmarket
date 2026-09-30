import type { APIRoute } from "astro";
import { z } from "zod";
import { and, eq, max } from "drizzle-orm";
import { env } from "cloudflare:workers";
import { getDb } from "../../../../../db/client";
import { listingPhotos } from "../../../../../db/schema";
import { MAX_PHOTOS } from "../../../../../lib/listing-options";
import { getOwnListing, getPhotos, isEditable, photoCount, photoView, touchListing } from "../../../../../lib/listings";
import { json, jsonError } from "../../../../../lib/api";

const MAX_BYTES = 8 * 1024 * 1024;

async function editableListing(userId: string | undefined, id: string | undefined) {
  if (!userId || !id) return { error: jsonError("Sign in to upload photos.", 401) };
  const listing = await getOwnListing(userId, id);
  if (!listing) return { error: jsonError("Listing not found.", 404) };
  if (!isEditable(listing)) return { error: jsonError("This listing can't be changed right now.", 409) };
  return { listing };
}

/** The uploader's photo list (seller, signed in). */
export const GET: APIRoute = async ({ locals, params }) => {
  const key = params.id ?? "";
  if (!locals.user) return jsonError("Sign in first.", 401);
  const listing = await getOwnListing(locals.user.id, key);
  if (!listing) return jsonError("Listing not found.", 404);
  return json({ photos: (await getPhotos(listing.id)).map(photoView) });
};

/**
 * Upload one photo. The browser has already resized it to a 2400px JPEG,
 * which also strips EXIF (including GPS). Body is the raw JPEG.
 */
export const POST: APIRoute = async ({ locals, params, request, url }) => {
  const { listing, error } = await editableListing(locals.user?.id, params.id);
  if (error) return error;

  if (request.headers.get("content-type") !== "image/jpeg") {
    return jsonError("Photos must be uploaded as JPEG.", 415);
  }
  const declared = Number(request.headers.get("content-length") ?? 0);
  if (declared > MAX_BYTES) return jsonError("That photo is too large.", 413);

  const body = new Uint8Array(await request.arrayBuffer());
  if (body.byteLength === 0 || body.byteLength > MAX_BYTES) return jsonError("That photo is too large.", 413);
  if (body[0] !== 0xff || body[1] !== 0xd8 || body[2] !== 0xff) {
    return jsonError("That file is not a JPEG photo.", 415);
  }

  if ((await photoCount(listing.id)) >= MAX_PHOTOS) {
    return jsonError(`You can add up to ${MAX_PHOTOS} photos.`, 409);
  }

  const dims = z
    .object({ w: z.coerce.number().int().min(1).max(10000), h: z.coerce.number().int().min(1).max(10000) })
    .safeParse({ w: url.searchParams.get("w"), h: url.searchParams.get("h") });

  const id = crypto.randomUUID();
  const r2Key = `listings/${listing.id}/${id}.jpg`;
  await env.PHOTOS.put(r2Key, body, { httpMetadata: { contentType: "image/jpeg" } });

  const db = getDb();
  const last = await db
    .select({ p: max(listingPhotos.position) })
    .from(listingPhotos)
    .where(eq(listingPhotos.listingId, listing.id))
    .get();
  const row = await db
    .insert(listingPhotos)
    .values({
      id,
      listingId: listing.id,
      r2Key,
      position: (last?.p ?? -1) + 1,
      width: dims.success ? dims.data.w : null,
      height: dims.success ? dims.data.h : null,
    })
    .returning()
    .get();
  await touchListing(listing.id);

  return json({ photo: photoView(row) }, 201);
};

/** Save the photo order. The first photo is the main photo. */
export const PUT: APIRoute = async ({ locals, params, request }) => {
  const { listing, error } = await editableListing(locals.user?.id, params.id);
  if (error) return error;

  const parsed = z
    .object({ order: z.array(z.uuid()).max(200) })
    .safeParse(await request.json().catch(() => null));
  if (!parsed.success) return jsonError("Invalid photo order.", 400);

  const photos = await getPhotos(listing.id);
  const known = new Set(photos.map((p) => p.id));
  const order = parsed.data.order.filter((id) => known.has(id));
  // Anything missing from the list keeps its place at the end.
  for (const p of photos) if (!order.includes(p.id)) order.push(p.id);

  const db = getDb();
  await db.batch(
    order.map((id, position) =>
      db
        .update(listingPhotos)
        .set({ position })
        .where(and(eq(listingPhotos.id, id), eq(listingPhotos.listingId, listing.id))),
    ) as [any, ...any[]],
  );
  await touchListing(listing.id);
  return json({ ok: true });
};
