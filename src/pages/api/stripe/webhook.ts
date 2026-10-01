import type { APIRoute } from "astro";
import { expireSession, settleSession, verifyWebhook } from "../../../lib/fees";
import { safeError } from "../../../lib/log";

// Stripe calls this when a checkout finishes or expires. Only events with a
// valid signature (STRIPE_WEBHOOK_SECRET) are trusted; the middleware skips
// its browser origin check for this one path.
export const POST: APIRoute = async ({ request }) => {
  const body = await request.text();
  if (!(await verifyWebhook(body, request.headers.get("stripe-signature")))) {
    return new Response("Bad signature", { status: 400 });
  }
  let event: { type?: string; data?: { object?: { id?: string; payment_status?: string; metadata?: Record<string, string>; amount_total?: number } } };
  try {
    event = JSON.parse(body);
  } catch {
    return new Response("Bad body", { status: 400 });
  }
  const session = event.data?.object;
  if (!session?.id) return new Response("ok");
  try {
    if (event.type === "checkout.session.completed" || event.type === "checkout.session.async_payment_succeeded") {
      const result = await settleSession(session.id, { ...session, id: session.id });
      // An unknown session is not ours (another app on the same Stripe account): say ok so Stripe stops retrying.
      if (!result.ok && result.error !== "We don't know this payment." && session.payment_status === "paid") {
        return new Response("Not settled", { status: 500 });
      }
    } else if (event.type === "checkout.session.expired") {
      await expireSession(session.id);
    }
  } catch (err) {
    console.error("[stripe] webhook failed", safeError(err));
    return new Response("Error", { status: 500 });
  }
  return new Response("ok");
};
