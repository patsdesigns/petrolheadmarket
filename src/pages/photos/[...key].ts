import type { APIRoute } from "astro";
import { env } from "cloudflare:workers";

// Public photo serving from R2: /app/photos/listings/{listingId}/{photoId}.jpg
const KEY_PATTERN = /^listings\/[0-9a-f-]{36}\/[0-9a-f-]{36}\.jpg$/;

export const GET: APIRoute = async ({ params, request }) => {
  const key = params.key ?? "";
  if (!KEY_PATTERN.test(key)) return new Response("Not found", { status: 404 });

  const object = await env.PHOTOS.get(key, {
    onlyIf: request.headers,
  });
  if (!object) return new Response("Not found", { status: 404 });

  const headers = new Headers();
  object.writeHttpMetadata(headers);
  headers.set("etag", object.httpEtag);
  // Keys are never reused, so photos can be cached for a long time.
  headers.set("Cache-Control", "public, max-age=31536000, immutable");
  headers.set("X-Content-Type-Options", "nosniff");

  // onlyIf matched a conditional header: the body is absent.
  if (!("body" in object) || !object.body) return new Response(null, { status: 304, headers });
  return new Response(object.body, { headers });
};
