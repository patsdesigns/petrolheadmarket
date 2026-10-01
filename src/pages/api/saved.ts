import type { APIRoute } from "astro";
import { z } from "zod";
import { json, jsonError } from "../../lib/api";
import { setSaved } from "../../lib/saved";

const Body = z.object({ listingId: z.string().min(1).max(64), save: z.boolean() });

// Save or unsave a car (the heart). Signed in only; the middleware checks the origin.
export const POST: APIRoute = async ({ request, locals }) => {
  if (!locals.user) return jsonError("signed_out", 401);
  const parsed = Body.safeParse(await request.json().catch(() => null));
  if (!parsed.success) return jsonError("bad_request", 400);
  const result = await setSaved(locals.user.id, parsed.data.listingId, parsed.data.save);
  return result.ok ? json({ saved: result.saved }) : jsonError(result.error, 409);
};
