import { and, count, desc, eq, inArray, isNull, ne, or } from "drizzle-orm";
import { getDb } from "../db/client";
import { listings, messages, profiles, threads, user as users, type Listing, type Thread } from "../db/schema";
import { absoluteUrl } from "./config";
import { sendEmail } from "./email";
import { listingTitle } from "./listing-rules";
import { url } from "./paths";
import { messageRateLimited } from "./rate-limit";

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

export async function threadMessages(threadId: string) {
  return getDb()
    .select({
      id: messages.id,
      senderId: messages.senderId,
      body: messages.body,
      flagged: messages.flagged,
      readAt: messages.readAt,
      createdAt: messages.createdAt,
    })
    .from(messages)
    .where(eq(messages.threadId, threadId))
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
      ),
    )
    .get();
  return row?.n ?? 0;
}

export type SendResult = { ok: true; threadId: string; flagged: boolean } | { ok: false; error: string };

/**
 * Send a message. Buyers start a thread from a listing (one thread per
 * listing per buyer); after that either side can reply in the thread.
 */
export async function sendMessage(opts: {
  senderId: string;
  body: string;
  listing?: Listing; // when a buyer starts or continues from a listing
  threadId?: string; // when replying in an existing thread
}): Promise<SendResult> {
  const body = opts.body.trim();
  if (!body) return { ok: false, error: "Write a message first." };
  if (body.length > MAX_MESSAGE) return { ok: false, error: `Keep messages under ${MAX_MESSAGE} characters.` };
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
      await sendEmail({
        to: recipient.email,
        subject: `New message about the ${listingTitle(listing)}`,
        paragraphs: [
          `${senderProfile?.displayName ?? "Someone"} wrote:`,
          `"${preview}"`,
          "Reply on Petrol Head Market. Your email address stays private.",
        ],
        action: { label: "Read and reply", url: absoluteUrl(url(`/inbox/${thread.id}`)) },
      }).catch((err) => console.error("[messages] email failed", err));
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
  const rows = await db
    .select({ thread: threads, listing: listings })
    .from(threads)
    .innerJoin(listings, eq(listings.id, threads.listingId))
    .where(or(eq(threads.buyerId, userId), eq(threads.sellerId, userId)))
    .orderBy(desc(threads.lastMessageAt))
    .limit(200)
    .all();
  if (rows.length === 0) return [];

  const ids = rows.map((r) => r.thread.id);
  const otherIds = [...new Set(rows.map((r) => (r.thread.buyerId === userId ? r.thread.sellerId : r.thread.buyerId)))];
  const names = new Map(
    (await db.select().from(profiles).where(inArray(profiles.userId, otherIds)).all()).map((p) => [p.userId, p.displayName]),
  );
  const msgs = await db
    .select({ threadId: messages.threadId, senderId: messages.senderId, body: messages.body, readAt: messages.readAt })
    .from(messages)
    .where(inArray(messages.threadId, ids))
    .orderBy(messages.createdAt)
    .all();
  const last = new Map<string, string>();
  const unread = new Map<string, number>();
  for (const m of msgs) {
    last.set(m.threadId, m.body);
    if (m.senderId !== userId && !m.readAt) unread.set(m.threadId, (unread.get(m.threadId) ?? 0) + 1);
  }

  return rows.map(({ thread, listing }) => {
    const otherId = thread.buyerId === userId ? thread.sellerId : thread.buyerId;
    const body = last.get(thread.id) ?? "";
    return {
      id: thread.id,
      listingTitle: listingTitle(listing),
      listingId: listing.id,
      otherName: names.get(otherId) ?? "Member",
      role: thread.buyerId === userId ? "buyer" : "seller",
      lastMessageAt: thread.lastMessageAt,
      preview: body.length > 90 ? `${body.slice(0, 90)}…` : body,
      unread: unread.get(thread.id) ?? 0,
    };
  });
}
