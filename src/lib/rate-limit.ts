import { and, count, eq, gt } from "drizzle-orm";
import { getDb } from "../db/client";
import { messages, offers } from "../db/schema";

// Per user limits for offers and messages (CLAUDE.md, Messaging).
export const LIMITS = {
  offersPerHour: 10,
  messagesPerTenMinutes: 30,
};

export async function offerRateLimited(userId: string): Promise<boolean> {
  const since = new Date(Date.now() - 60 * 60 * 1000);
  const row = await getDb()
    .select({ n: count() })
    .from(offers)
    .where(and(eq(offers.buyerId, userId), eq(offers.madeBy, "buyer"), gt(offers.createdAt, since)))
    .get();
  return (row?.n ?? 0) >= LIMITS.offersPerHour;
}

export async function messageRateLimited(userId: string): Promise<boolean> {
  const since = new Date(Date.now() - 10 * 60 * 1000);
  const row = await getDb()
    .select({ n: count() })
    .from(messages)
    .where(and(eq(messages.senderId, userId), gt(messages.createdAt, since)))
    .get();
  return (row?.n ?? 0) >= LIMITS.messagesPerTenMinutes;
}
