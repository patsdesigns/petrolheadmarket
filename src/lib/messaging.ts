import { SITE_NAME } from "./brand";
import { and, count, desc, eq, isNull, ne, or, sql } from "drizzle-orm";
import { getDb } from "../db/client";
import { listings, messages, offers, profiles, threads, user as users, type Listing, type Thread } from "../db/schema";
import { absoluteUrl } from "./config";
import { sendEmail } from "./email";
import { listingTitle } from "./listing-rules";
import { url } from "./paths";
import { messageRateLimited } from "./rate-limit";
import { isSuspended } from "./profile";
import { safeError } from "./log";

export const MAX_MESSAGE = 2000;

// Scam patterns (CLAUDE.md, Messaging). Matches are flagged for review, never blocked.
const SCAM_PATTERNS: { reason: string; re: RegExp }[] = [
  { reason: "Wire transfer", re: /\bwire(d|s)?\b.{0,20}\b(transfer|money|funds|payment)\b|\bwire transfer\b|\bbank transfer\b/i },
  { reason: "Western Union or MoneyGram", re: /\bwestern\s*union\b|\bmoney\s*gram\b/i },
  { reason: "Gift cards", re: /\bgift\s*cards?\b|\bitunes cards?\b|\bsteam cards?\b|\bgoogle play cards?\b/i },
  { reason: "Shipping agent", re: /\bshipping\s+(agent|company)\b|\bmy (agent|shipper) will\b|\btransport(er)? will pick\b/i },
  { reason: "Escrow", re: /\bescrow\b/i },
  { reason: "Crypto payment", re: /\b(bitcoin|btc|usdt|crypto)\b/i },
  { reason: "Move off platform", re: /\b(whats\s*app|telegram|signal app|wechat|kik)\b|\b(text|call|email|contact|reach) me (at|on)\b/i },
  { reason: "Email address", re: /[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/i },
  { reason: "Phone number", re: /(\+?1[\s.-]?)?\(?\d{3}\)?[\s.-]?\d{3}[\s.-]?\d{4}\b/ },
  { reason: "Outside link", re: /\bhttps?:\/\/|\bwww\.[a-z0-9-]+\.[a-z]{2,}/i },
];

export function scamCheck(body: string): string | null {
  const hits = SCAM_PATTERNS.filter((p) => p.re.test(body)).map((p) => p.reason);
  return hits.length ? hits.join(", ") : null;
}

export async function getThreadFor(listingId: string, buyerId: string): Promise<Thread | undefined> {
  return getDb()
    .select()
    .from(threads)
    .where(and(eq(threads.listingId, listingId), eq(threads.buyerId, buyerId)))
    .get();
}

/** A thread the user is part of. Admins can read any thread. */
export async function getThreadForUser(threadId: string, userId: string, isAdmin: boolean) {
  const db = getDb();
  const thread = await db.select().from(threads).where(eq(threads.id, threadId)).get();
  if (!thread) return null;
  const participant = thread.buyerId === userId || thread.sellerId === userId;
  if (!participant && !isAdmin) return null;
  const listing = await db.select().from(listings).where(eq(listings.id, thread.listingId)).get();
  if (!listing) return null;
  return { thread, listing, participant };
}

/** Messages in a thread. Hidden messages are left out unless an admin is reading. */
export async function threadMessages(threadId: string, includeHidden = false) {
  return getDb()
    .select({
      id: messages.id,
      senderId: messages.senderId,
      body: messages.body,
      flagged: messages.flagged,
      hiddenAt: messages.hiddenAt,
      readAt: messages.readAt,
      createdAt: messages.createdAt,
    })
    .from(messages)
    .where(includeHidden ? eq(messages.threadId, threadId) : and(eq(messages.threadId, threadId), isNull(messages.hiddenAt)))
    .orderBy(messages.createdAt)
    .all();
}

export async function markRead(threadId: string, readerId: string): Promise<void> {
  await getDb()
    .update(messages)
    .set({ readAt: new Date() })
    .where(and(eq(messages.threadId, threadId), ne(messages.senderId, readerId), isNull(messages.readAt)));
}

export async function unreadCount(userId: string): Promise<number> {
  const db = getDb();
  const row = await db
    .select({ n: count() })
    .from(messages)
    .innerJoin(threads, eq(threads.id, messages.threadId))
    .where(
      and(
        or(eq(threads.buyerId, userId), eq(threads.sellerId, userId)),
        ne(messages.senderId, userId),
        isNull(messages.readAt),
        isNull(messages.hiddenAt),
      ),
    )
    .get();
  return row?.n ?? 0;
}

export type SendResult = { ok: true; threadId: string; flagged: boolean } | { ok: false; error: string };

/**
 * A seller writing to a buyer who made an offer: the offer and its listing,
 * only when the listing is the seller's own. The thread may not exist yet.
 */
export async function offerForSeller(offerId: string, sellerId: string) {
  const db = getDb();
  const offer = await db.select().from(offers).where(eq(offers.id, offerId)).get();
  if (!offer) return null;
  const listing = await db.select().from(listings).where(eq(listings.id, offer.listingId)).get();
  if (!listing || listing.userId !== sellerId || offer.buyerId === sellerId) return null;
  const buyer = await db.select().from(profiles).where(eq(profiles.userId, offer.buyerId)).get();
  return { offer, listing, buyerName: buyer?.displayName ?? "the buyer", thread: await getThreadFor(listing.id, offer.buyerId) };
}

/**
 * Send a message. Buyers start a thread from a listing (one thread per
 * listing per buyer), sellers start one from an offer they received; after
 * that either side can reply in the thread.
 */
export async function sendMessage(opts: {
  senderId: string;
  body: string;
  listing?: Listing; // when a buyer starts or continues from a listing
  threadId?: string; // when replying in an existing thread
  offerId?: string; // when a seller writes to a buyer who made an offer
}): Promise<SendResult> {
  const body = opts.body.trim();
  if (!body) return { ok: false, error: "Write a message first." };
  if (body.length > MAX_MESSAGE) return { ok: false, error: `Keep messages under ${MAX_MESSAGE} characters.` };
  if (await isSuspended(opts.senderId)) return { ok: false, error: "Your account is suspended." };
  if (await messageRateLimited(opts.senderId)) {
    return { ok: false, error: "You are sending messages very quickly. Wait a few minutes and try again." };
  }

  const db = getDb();
  let thread: Thread | undefined;
  let listing: Listing | undefined = opts.listing;

  if (opts.threadId) {
    thread = await db.select().from(threads).where(eq(threads.id, opts.threadId)).get();
    if (!thread || (thread.buyerId !== opts.senderId && thread.sellerId !== opts.senderId)) {
      return { ok: false, error: "Conversation not found." };
    }
    listing = await db.select().from(listings).where(eq(listings.id, thread.listingId)).get();
  } else if (opts.offerId) {
    const found = await offerForSeller(opts.offerId, opts.senderId);
    if (!found) return { ok: false, error: "Conversation not found." };
    listing = found.listing;
    thread = found.thread;
    if (!thread) {
      // Created with the first message, so no empty conversations appear.
      thread = await db
        .insert(threads)
        .values({ id: crypto.randomUUID(), listingId: listing.id, buyerId: found.offer.buyerId, sellerId: listing.userId })
        .onConflictDoNothing()
        .returning()
        .get();
      thread ??= await getThreadFor(listing.id, found.offer.buyerId);
    }
  } else if (listing) {
    if (listing.userId === opts.senderId) return { ok: false, error: "This is your own listing." };
    thread = await getThreadFor(listing.id, opts.senderId);
    if (!thread) {
      thread = await db
        .insert(threads)
        .values({ id: crypto.randomUUID(), listingId: listing.id, buyerId: opts.senderId, sellerId: listing.userId })
        .onConflictDoNothing()
        .returning()
        .get();
      thread ??= await getThreadFor(listing.id, opts.senderId);
    }
  }
  if (!thread || !listing) return { ok: false, error: "Conversation not found." };
  // A listing taken down (or rejected) is closed to messages, so a removed
  // scam listing can't keep talking to buyers.
  if (!["live", "offer_accepted", "sold"].includes(listing.status)) {
    return { ok: false, error: "This listing is no longer on the site, so the conversation is closed." };
  }

  const recipientId = thread.buyerId === opts.senderId ? thread.sellerId : thread.buyerId;
  // Only email for the first unread message, so a burst of messages sends one email.
  const alreadyUnread = await db
    .select({ n: count() })
    .from(messages)
    .where(and(eq(messages.threadId, thread.id), eq(messages.senderId, opts.senderId), isNull(messages.readAt)))
    .get();

  const flagReason = scamCheck(body);
  const now = new Date();
  await db.batch([
    db.insert(messages).values({
      id: crypto.randomUUID(),
      threadId: thread.id,
      senderId: opts.senderId,
      body,
      flagged: Boolean(flagReason),
      flagReason,
      createdAt: now,
    }),
    db.update(threads).set({ lastMessageAt: now }).where(eq(threads.id, thread.id)),
  ]);

  if ((alreadyUnread?.n ?? 0) === 0) {
    const [recipient, recipientProfile, senderProfile] = await Promise.all([
      db.select().from(users).where(eq(users.id, recipientId)).get(),
      db.select().from(profiles).where(eq(profiles.userId, recipientId)).get(),
      db.select().from(profiles).where(eq(profiles.userId, opts.senderId)).get(),
    ]);
    if (recipient && (recipientProfile?.emailNotifications ?? true)) {
      const preview = body.length > 140 ? `${body.slice(0, 140).trim()}…` : body;
      const name = senderProfile?.displayName ?? "Someone";
      // A flagged message is never quoted, so a scam pitch doesn't land in
      // an inbox before an admin has seen it (the same as offer notes).
      const lines = flagReason
        ? [`${name} sent you a message. Read it on ${SITE_NAME}.`]
        : [`${name} wrote:`, `"${preview}"`];
      await sendEmail({
        to: recipient.email,
        subject: `New message about the ${listingTitle(listing)}`,
        paragraphs: [...lines, `Reply on ${SITE_NAME}. Your email address stays private.`],
        action: { label: "Read and reply", url: absoluteUrl(url(`/inbox/${thread.id}`)) },
      }).catch((err) => console.error("[messages] email failed", safeError(err)));
    }
  }

  return { ok: true, threadId: thread.id, flagged: Boolean(flagReason) };
}

export interface InboxRow {
  id: string;
  listingTitle: string;
  listingId: string;
  otherName: string;
  role: "buyer" | "seller";
  lastMessageAt: Date;
  preview: string;
  unread: number;
}

export async function inboxFor(userId: string): Promise<InboxRow[]> {
  const db = getDb();
  // One statement with a few bound parameters, whatever the thread count
  // (D1 caps a statement at 100), and no full message histories.
  const otherId = sql`CASE WHEN ${threads.buyerId} = ${userId} THEN ${threads.sellerId} ELSE ${threads.buyerId} END`;
  const rows = await db
    .select({
      thread: threads,
      listing: listings,
      otherName: profiles.displayName,
      lastBody: sql<string | null>`(SELECT m.body FROM messages m WHERE m.thread_id = ${threads.id} AND m.hidden_at IS NULL ORDER BY m.created_at DESC LIMIT 1)`,
      unread: sql<number>`(SELECT count(*) FROM messages m WHERE m.thread_id = ${threads.id} AND m.sender_id <> ${userId} AND m.read_at IS NULL AND m.hidden_at IS NULL)`,
    })
    .from(threads)
    .innerJoin(listings, eq(listings.id, threads.listingId))
    .leftJoin(profiles, eq(profiles.userId, otherId))
    .where(or(eq(threads.buyerId, userId), eq(threads.sellerId, userId)))
    .orderBy(desc(threads.lastMessageAt))
    .limit(200)
    .all();

  return rows.map(({ thread, listing, otherName, lastBody, unread }) => {
    const body = lastBody ?? "";
    return {
      id: thread.id,
      listingTitle: listingTitle(listing),
      listingId: listing.id,
      otherName: otherName ?? "Member",
      role: thread.buyerId === userId ? "buyer" : "seller",
      lastMessageAt: thread.lastMessageAt,
      preview: body.length > 90 ? `${body.slice(0, 90)}…` : body,
      unread: Number(unread ?? 0),
    };
  });
}
