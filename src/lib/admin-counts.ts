import { sql } from "drizzle-orm";
import { getDb } from "../db/client";

/** What is waiting for an admin. Shown only to admins (role admin), so it never reveals the admin list. */
export interface AdminCounts {
  /** Listings submitted and waiting for a decision. */
  review: number;
  /** Contact the team messages not yet marked handled. */
  contact: number;
  /** Flagged messages and offer notes not yet reviewed. */
  flags: number;
}

export const NO_ADMIN_COUNTS: AdminCounts = { review: 0, contact: 0, flags: 0 };

/**
 * One statement for all three counts. While email is off this is the only
 * way the owner hears about new submissions, contact requests and flags.
 */
export async function adminCounts(): Promise<AdminCounts> {
  const row = await getDb().get<{ review: number; contact: number; flags: number }>(sql`
    SELECT
      (SELECT count(*) FROM listings WHERE status = 'submitted') AS review,
      (SELECT count(*) FROM contact_requests WHERE handled_at IS NULL) AS contact,
      (SELECT count(*) FROM messages WHERE flagged = 1 AND flag_reviewed_at IS NULL)
        + (SELECT count(*) FROM offers WHERE flagged = 1 AND flag_reviewed_at IS NULL) AS flags
  `);
  return {
    review: Number(row?.review ?? 0),
    contact: Number(row?.contact ?? 0),
    flags: Number(row?.flags ?? 0),
  };
}
