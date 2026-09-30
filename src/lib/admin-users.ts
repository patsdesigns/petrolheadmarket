import { and, count, desc, eq, inArray, isNotNull, isNull, or, sql } from "drizzle-orm";
import { chunks, getDb } from "../db/client";
import { listings, messages, offers, profiles, session, user as users } from "../db/schema";
import { audit } from "./audit";
import { unpublishListing } from "./cms";
import { closeOffersOnTakeDown } from "./take-down";
import { isAdminEmail, publicOrigin } from "./config";
import { getAuth, RESET_CAPTURE_HEADER, resetCaptures } from "./auth";
import { url } from "./paths";
import { roleFor } from "./profile";

/** Listings that are on the site or on their way there. Suspending takes them down. */
const TAKE_DOWN_STATUSES = ["submitted", "approved", "live", "offer_accepted"] as const;
const IN_CMS = ["live", "offer_accepted"];
const SUSPENDED_NOTE = "Taken down because the account was suspended.";

export interface AdminUserRow {
  id: string;
  name: string;
  email: string;
  emailVerified: boolean;
  createdAt: Date;
  displayName: string | null;
  role: "user" | "admin" | null;
  suspendedAt: Date | null;
  listingsTotal: number;
  listingsLive: number;
}

/** Escape LIKE wildcards so a search for "a_b" means exactly that. */
const likeTerm = (q: string) => `%${q.toLowerCase().replace(/[\\%_]/g, (c) => `\\${c}`)}%`;

/** Search people by email, name or display name. Newest first; no query lists the newest. */
export async function searchUsers(q: string, limit = 50): Promise<AdminUserRow[]> {
  const db = getDb();
  const term = q.trim().slice(0, 100);
  const pattern = likeTerm(term);
  const where = term
    ? or(
        sql`lower(${users.email}) like ${pattern} escape '\\'`,
        sql`lower(${users.name}) like ${pattern} escape '\\'`,
        sql`lower(${profiles.displayName}) like ${pattern} escape '\\'`,
      )
    : undefined;
  const rows = await db
    .select({
      id: users.id,
      name: users.name,
      email: users.email,
      emailVerified: users.emailVerified,
      createdAt: users.createdAt,
      displayName: profiles.displayName,
      role: profiles.role,
      suspendedAt: profiles.suspendedAt,
    })
    .from(users)
    .leftJoin(profiles, eq(profiles.userId, users.id))
    .where(where)
    .orderBy(desc(users.createdAt))
    .limit(limit)
    .all();
  if (rows.length === 0) return [];

  const counts: { userId: string; status: string; n: number }[] = [];
  for (const ids of chunks(rows.map((r) => r.id))) {
    counts.push(
      ...(await db
        .select({ userId: listings.userId, status: listings.status, n: count() })
        .from(listings)
        .where(inArray(listings.userId, ids))
        .groupBy(listings.userId, listings.status)
        .all()),
    );
  }
  return rows.map((r) => {
    const mine = counts.filter((c) => c.userId === r.id);
    return {
      ...r,
      listingsTotal: mine.reduce((sum, c) => sum + c.n, 0),
      listingsLive: mine.filter((c) => IN_CMS.includes(c.status)).reduce((sum, c) => sum + c.n, 0),
    };
  });
}

export type AdminResult = { ok: true; message: string } | { ok: false; error: string };

async function target(userId: string) {
  return getDb().select().from(users).where(eq(users.id, userId)).get();
}

/**
 * Suspend an account: sign it out everywhere, take down its listings, close
 * its open offers, hide its unread flagged messages and mark its flagged
 * messages reviewed. Admins can't be suspended, and nor can the acting
 * admin. The check is on the role, not the address: someone who signed up
 * first with an ADMIN_EMAILS address they can't confirm is not an admin and
 * can be suspended. When the owner later takes the address back with the
 * Site owner reset, the confirmed account becomes an admin and ensureProfile
 * clears the suspension.
 */
export async function suspendUser(adminId: string, userId: string): Promise<AdminResult> {
  const db = getDb();
  const u = await target(userId);
  if (!u) return { ok: false, error: "That account no longer exists." };
  if (u.id === adminId) return { ok: false, error: "You can't suspend your own account." };
  if (roleFor(u) === "admin") return { ok: false, error: "Admin accounts can't be suspended." };

  const now = new Date();
  const done = await db
    .update(profiles)
    .set({ suspendedAt: now })
    .where(and(eq(profiles.userId, userId), isNull(profiles.suspendedAt)))
    .returning({ userId: profiles.userId })
    .get();
  if (!done) {
    // No profile yet (never opened the app) or already suspended.
    const existing = await db.select().from(profiles).where(eq(profiles.userId, userId)).get();
    if (existing?.suspendedAt) return { ok: false, error: "That account is already suspended." };
    await db
      .insert(profiles)
      .values({ userId, displayName: "Member", suspendedAt: now })
      .onConflictDoUpdate({ target: profiles.userId, set: { suspendedAt: now } });
  }

  // Sign them out everywhere. Better Auth's cookie cache is off, so this
  // takes effect on their next request.
  await db.delete(session).where(eq(session.userId, userId));

  // Take their listings down.
  const down = await db
    .update(listings)
    // A fixed team note, so an approve note (admins only) is never shown to
    // the seller, and the listing page says our team took it down.
    .set({ status: "withdrawn", reviewNotes: SUSPENDED_NOTE, reviewerId: adminId, reviewedAt: now, updatedAt: now })
    .where(and(eq(listings.userId, userId), inArray(listings.status, [...TAKE_DOWN_STATUSES])))
    .returning()
    .all();
  let unpublishFailed = 0;
  for (const l of down) {
    await audit(adminId, "take_down", "listing", l.id, { reason: "seller_suspended", from: l.status });
    if (l.cmsItemId) {
      const r = await unpublishListing(l.id, adminId);
      if (!r.ok) unpublishFailed++;
    }
    // Close offers the same way a take down does: pending offers are
    // declined and an accepted deal ends, with an email to each buyer.
    await closeOffersOnTakeDown(l, now);
  }

  // Their own open offers (and counters made to them) end.
  await db
    .update(offers)
    .set({ status: "withdrawn", respondedAt: now })
    .where(and(eq(offers.buyerId, userId), eq(offers.status, "pending")));

  // Flagged messages they sent that nobody has read yet are hidden, so a
  // scam pitch never reaches its recipient.
  await db
    .update(messages)
    .set({ hiddenAt: now })
    .where(and(eq(messages.senderId, userId), eq(messages.flagged, true), isNull(messages.readAt), isNull(messages.hiddenAt)));
  // Their flagged messages have been dealt with.
  await db
    .update(messages)
    .set({ flagReviewedAt: now })
    .where(and(eq(messages.senderId, userId), eq(messages.flagged, true), isNull(messages.flagReviewedAt)));
  // So have their flagged offer and counter notes.
  await db
    .update(offers)
    .set({ flagReviewedAt: now })
    .where(
      and(
        eq(offers.flagged, true),
        isNull(offers.flagReviewedAt),
        or(
          and(eq(offers.madeBy, "buyer"), eq(offers.buyerId, userId)),
          and(
            eq(offers.madeBy, "seller"),
            inArray(offers.listingId, db.select({ id: listings.id }).from(listings).where(eq(listings.userId, userId))),
          ),
        ),
      ),
    );

  await audit(adminId, "user_suspended", "user", userId, { listingsTakenDown: down.length });

  const parts = ["Account suspended and signed out."];
  if (down.length) parts.push(`${down.length} listing${down.length === 1 ? " was" : "s were"} taken down.`);
  if (unpublishFailed) parts.push("Removing it from the site failed for some, see each listing's history.");
  return { ok: true, message: parts.join(" ") };
}

export async function unsuspendUser(adminId: string, userId: string): Promise<AdminResult> {
  const done = await getDb()
    .update(profiles)
    .set({ suspendedAt: null })
    .where(and(eq(profiles.userId, userId), isNotNull(profiles.suspendedAt)))
    .returning({ userId: profiles.userId })
    .get();
  if (!done) return { ok: false, error: "That account is not suspended." };
  await audit(adminId, "user_unsuspended", "user", userId);
  return { ok: true, message: "Account unsuspended. They can sign in again. Taken down listings stay down." };
}

/** For when email is off or a link never arrived. The admin vouches for the address. */
export async function confirmEmail(adminId: string, userId: string): Promise<AdminResult> {
  const u = await target(userId);
  if (!u) return { ok: false, error: "That account no longer exists." };
  // A confirmed ADMIN_EMAILS address becomes an admin, so only the owner of
  // the inbox may prove it (the link in the log while email is off).
  if (isAdminEmail(u.email)) {
    return { ok: false, error: "Admin addresses are confirmed with a password reset from the site log, not here." };
  }
  const done = await getDb()
    .update(users)
    .set({ emailVerified: true, updatedAt: new Date() })
    .where(and(eq(users.id, userId), eq(users.emailVerified, false)))
    .returning({ id: users.id })
    .get();
  if (!done) return { ok: false, error: "That email is already confirmed." };
  await audit(adminId, "email_confirmed_by_admin", "user", userId);
  return { ok: true, message: "Email marked as confirmed." };
}

/**
 * A password reset link for a member who is locked out while email is off.
 * The link is shown to the admin (never logged or emailed by the app), who
 * sends it from his own inbox to the address on the account, so opening it
 * still proves that inbox. Not for admin addresses or suspended accounts.
 */
export async function adminResetLink(adminId: string, userId: string): Promise<AdminResult & { link?: string; email?: string }> {
  const u = await target(userId);
  if (!u) return { ok: false, error: "That account no longer exists." };
  if (isAdminEmail(u.email)) return { ok: false, error: "Owner accounts use the Site owner reset on the password reset page." };
  const p = await getDb().select({ suspendedAt: profiles.suspendedAt }).from(profiles).where(eq(profiles.userId, userId)).get();
  if (p?.suspendedAt) return { ok: false, error: "Unsuspend the account first." };

  const id = crypto.randomUUID();
  resetCaptures.set(id, null);
  try {
    const origin = publicOrigin();
    const res = await getAuth().handler(
      new Request(new URL(url("/api/auth/request-password-reset"), origin), {
        method: "POST",
        headers: { origin, "content-type": "application/json", [RESET_CAPTURE_HEADER]: id },
        body: JSON.stringify({ email: u.email, redirectTo: url("/reset-password") }),
      }),
    );
    const link = resetCaptures.get(id);
    if (!res.ok || !link) return { ok: false, error: "The link could not be made. Try again." };
    await audit(adminId, "reset_link_by_admin", "user", userId);
    return { ok: true, message: "Reset link ready.", link, email: u.email };
  } finally {
    resetCaptures.delete(id);
  }
}
