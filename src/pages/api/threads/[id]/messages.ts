import type { APIRoute } from "astro";
import { z } from "zod";
import { getThreadForUser, markRead, sendMessage, MAX_MESSAGE } from "../../../../lib/messaging";
import { threadView } from "../../../../lib/thread-view";
import { json, jsonError } from "../../../../lib/api";

export const GET: APIRoute = async ({ locals, params }) => {
  if (!locals.user) return jsonError("Sign in first.", 401);
  const found = await getThreadForUser(params.id ?? "", locals.user.id, locals.profile?.role === "admin");
  if (!found) return jsonError("Conversation not found.", 404);
  if (found.participant) await markRead(found.thread.id, locals.user.id);
  const viewer = found.participant ? locals.user.id : found.thread.buyerId;
  return json({ messages: await threadView(found.thread.id, viewer) });
};

export const POST: APIRoute = async ({ locals, params, request }) => {
  if (!locals.user) return jsonError("Sign in first.", 401);
  if (!locals.user.emailVerified) return jsonError("Confirm your email before you send messages.", 403);
  const parsed = z
    .object({ body: z.string().max(MAX_MESSAGE + 10) })
    .safeParse(await request.json().catch(() => null));
  if (!parsed.success) return jsonError("Invalid message.", 400);

  const result = await sendMessage({ senderId: locals.user.id, body: parsed.data.body, threadId: params.id });
  if (!result.ok) return jsonError(result.error, result.error.includes("quickly") ? 429 : 400);
  return json({ messages: await threadView(result.threadId, locals.user.id) });
};
