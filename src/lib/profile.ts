import { z } from "zod";
import { eq } from "drizzle-orm";
import { getDb } from "../db/client";
import { profiles, type Profile } from "../db/schema";
import { isAdminEmail } from "./config";

/** Letters (any language), spaces, apostrophes, hyphens and periods. No digits, @ or links. */
export const NAME_PATTERN = /^[\p{L}\p{M}][\p{L}\p{M} .'\-]*$/u;
/** Whole words that would make a member look like staff. */
const RESERVED_NAME = /(^|[^\p{L}])(petrol\s*head|phm|admin|administrator|support|staff|moderator|official|team|webflow)($|[^\p{L}])/iu;

/** "www.x.com" style names, which letters and periods alone would allow. */
const WEB_ADDRESS = /(^|[^\p{L}])www([^\p{L}]|$)|\.(com|net|org|io|co|us|app|me|info|biz|xyz|shop|site|online|link)($|[^\p{L}])/iu;

/**
 * The public display name: shown on listings (the CMS), in messages and in
 * emails, so it must look like a person's name, like "Dave K.".
 */
export const displayNameField = z
  .string()
  .trim()
  .min(2, "Enter a display name.")
  .max(40, "Use 40 characters or fewer.")
  .regex(NAME_PATTERN, "Use letters, spaces, apostrophes, hyphens and periods only.")
  .refine((v) => !WEB_ADDRESS.test(v), "Use your name, not a web address.")
  .refine((v) => !RESERVED_NAME.test(v), "Use your own name, like Dave K. Names that sound like our team are not allowed.");

/** "Dave Kowalski" -> "Dave K.", "Dave" -> "Dave". */
export function defaultDisplayName(fullName: string): string {
  const parts = fullName.trim().split(/\s+/).filter(Boolean);
  if (parts.length === 0) return "Member";
  // Capped to the account page's 40 character rule, however long the name.
  const first = parts[0].slice(0, 30);
  const last = parts.length > 1 ? parts[parts.length - 1] : "";
  const name = (last ? `${first} ${last[0].toUpperCase()}.` : first).slice(0, 40);
  return displayNameField.safeParse(name).success ? name : "Member";
}

interface AuthUser {
  id: string;
  name: string;
  email: string;
  emailVerified: boolean;
}

/**
 * The admin role needs a proven email: the address must be in ADMIN_EMAILS
 * and confirmed. Anyone could sign up with an admin address, and while email
 * is off nothing proves they own it.
 */
export function roleFor(user: AuthUser): "admin" | "user" {
  return user.emailVerified && isAdminEmail(user.email) ? "admin" : "user";
}

/**
 * Load the user's profile, creating it on first use. When `syncRole` is true
 * (the middleware passes it on every request) the stored role is brought in
 * line with roleFor(), so ADMIN_EMAILS changes apply at once. It only writes
 * when the role actually changes.
 */
export async function ensureProfile(user: AuthUser, syncRole = false): Promise<Profile> {
  const db = getDb();
  const role = roleFor(user);
  const existing = await db.select().from(profiles).where(eq(profiles.userId, user.id)).get();

  if (!existing) {
    const created = await db
      .insert(profiles)
      .values({ userId: user.id, displayName: defaultDisplayName(user.name), role })
      .onConflictDoNothing()
      .returning()
      .get();
    return created ?? (await db.select().from(profiles).where(eq(profiles.userId, user.id)).get())!;
  }

  // Admins can't be suspended; clear it if an address was added to ADMIN_EMAILS.
  const clearSuspension = role === "admin" && existing.suspendedAt !== null;
  if ((syncRole && existing.role !== role) || clearSuspension) {
    const next = syncRole ? { role, suspendedAt: clearSuspension ? null : existing.suspendedAt } : { suspendedAt: null };
    await db.update(profiles).set(next).where(eq(profiles.userId, user.id));
    return { ...existing, ...next };
  }
  return existing;
}

/** Suspended by an admin. Checked again in the offer and message code. */
export async function isSuspended(userId: string): Promise<boolean> {
  const p = await getDb()
    .select({ suspendedAt: profiles.suspendedAt })
    .from(profiles)
    .where(eq(profiles.userId, userId))
    .get();
  return Boolean(p?.suspendedAt);
}
