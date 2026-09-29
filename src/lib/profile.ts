import { eq } from "drizzle-orm";
import { getDb } from "../db/client";
import { profiles, type Profile } from "../db/schema";
import { isAdminEmail } from "./config";

/** "Dave Kowalski" -> "Dave K.", "Dave" -> "Dave". */
export function defaultDisplayName(fullName: string): string {
  const parts = fullName.trim().split(/\s+/).filter(Boolean);
  if (parts.length === 0) return "Member";
  const first = parts[0];
  const last = parts.length > 1 ? parts[parts.length - 1] : "";
  return last ? `${first} ${last[0].toUpperCase()}.` : first;
}

interface AuthUser {
  id: string;
  name: string;
  email: string;
}

/**
 * Load the user's profile, creating it on first use. The admin role follows
 * ADMIN_EMAILS: it is granted or removed whenever `syncRole` is true
 * (on every sign in).
 */
export async function ensureProfile(user: AuthUser, syncRole = false): Promise<Profile> {
  const db = getDb();
  const role = isAdminEmail(user.email) ? "admin" : "user";
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

  if (syncRole && existing.role !== role) {
    await db.update(profiles).set({ role }).where(eq(profiles.userId, user.id));
    return { ...existing, role };
  }
  return existing;
}
