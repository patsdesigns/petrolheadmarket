import { and, count, desc, eq, gt, isNotNull, isNull } from "drizzle-orm";
import { getDb } from "../db/client";
import { contactRequests, listings, type ContactRequest } from "../db/schema";
import { absoluteUrl, adminEmails, supportEmail } from "./config";
import { sendEmail } from "./email";
import { takeAuthLimit, tooManyMessage } from "./auth-limits";
import { audit } from "./audit";
import { url } from "./paths";
import { safeError } from "./log";

export const CONTACT_TOPICS = {
  listing: "A change to my listing",
  account: "Getting into my account",
  suspended: "My suspended account",
  other: "Something else",
} as const;
export type ContactTopic = keyof typeof CONTACT_TOPICS;

export function isContactTopic(value: unknown): value is ContactTopic {
  return typeof value === "string" && value in CONTACT_TOPICS;
}

/**
 * Where "contact our team" links go. A mailto to SUPPORT_EMAIL when it is
 * set, otherwise the Contact the team form (/app/contact), which works with
 * no setup and with email off.
 */
export function contactHref(topic: ContactTopic, opts: { subject: string; listingId?: string }): string {
  const support = supportEmail();
  if (support) return `mailto:${support}?subject=${encodeURIComponent(opts.subject)}`;
  const params = new URLSearchParams({ topic });
  if (opts.listingId) params.set("listing", opts.listingId);
  return `${url("/contact")}?${params}`;
}

/**
 * The last line of an email that invites questions. Replies reach the team
 * through reply_to when SUPPORT_EMAIL is set; otherwise point to the form.
 */
export function questionsLine(listingId?: string): string {
  if (supportEmail()) return "If you have questions, reply to this email.";
  const params = new URLSearchParams({ topic: "listing" });
  if (listingId) params.set("listing", listingId);
  return `If you have questions, write to our team at ${absoluteUrl(`${url("/contact")}?${params}`)}`;
}

export interface ContactInput {
  userId: string | null;
  name: string;
  email: string;
  topic: ContactTopic;
  listingId: string | null;
  body: string;
}

/**
 * Store a message for the team and tell the admins. Limited to 3 an hour per
 * email address (and per IP when Cloudflare gives one), in the same D1
 * counters as the account limits.
 */
export async function createContactRequest(request: Request, input: ContactInput): Promise<{ ok: true } | { ok: false; error: string }> {
  try {
    const limit = await takeAuthLimit(request, "contact", [input.email]);
    if (limit.wait > 0) return { ok: false, error: tooManyMessage(limit.wait) };
  } catch (err) {
    console.error("[contact] rate limit lookup failed", safeError(err));
  }
  const db = getDb();
  // A backstop for a flood from many addresses (the IP is often unknown).
  const recent = await db
    .select({ n: count() })
    .from(contactRequests)
    .where(gt(contactRequests.createdAt, new Date(Date.now() - 60 * 60 * 1000)))
    .get();
  if ((recent?.n ?? 0) >= 60) return { ok: false, error: "The form is busy right now. Please try again in an hour." };
  // Only keep a listing that belongs to the signed-in sender.
  let listingId: string | null = null;
  if (input.userId && input.listingId) {
    const own = await db
      .select({ id: listings.id })
      .from(listings)
      .where(and(eq(listings.id, input.listingId), eq(listings.userId, input.userId)))
      .get();
    listingId = own?.id ?? null;
  }
  const id = crypto.randomUUID();
  await db.insert(contactRequests).values({ id, ...input, listingId });
  const link = absoluteUrl(url("/admin/contact"));
  await Promise.all(
    [...adminEmails()].map((to) =>
      sendEmail({
        to,
        subject: "New message for the team",
        paragraphs: [`A member wrote to the team about: ${CONTACT_TOPICS[input.topic].toLowerCase()}.`],
        action: { label: "Read it", url: link },
      }).catch((err) => console.error("[contact] admin email failed", safeError(err))),
    ),
  );
  return { ok: true };
}

export async function openContactRequests(): Promise<ContactRequest[]> {
  return getDb()
    .select()
    .from(contactRequests)
    .where(isNull(contactRequests.handledAt))
    .orderBy(contactRequests.createdAt)
    .limit(100)
    .all();
}

export async function handledContactRequests(): Promise<ContactRequest[]> {
  return getDb()
    .select()
    .from(contactRequests)
    .where(isNotNull(contactRequests.handledAt))
    .orderBy(desc(contactRequests.handledAt))
    .limit(20)
    .all();
}

export async function markContactHandled(adminId: string, id: string): Promise<boolean> {
  const done = await getDb()
    .update(contactRequests)
    .set({ handledAt: new Date(), handledBy: adminId })
    .where(and(eq(contactRequests.id, id), isNull(contactRequests.handledAt)))
    .returning({ id: contactRequests.id })
    .get();
  if (done) await audit(adminId, "contact_handled", "contact", id);
  return Boolean(done);
}
