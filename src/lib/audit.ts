import { and, desc, eq } from "drizzle-orm";
import { getDb } from "../db/client";
import { auditLog } from "../db/schema";

export async function audit(
  actorId: string | null,
  action: string,
  entity: string,
  entityId: string,
  data?: Record<string, unknown>,
): Promise<void> {
  await getDb()
    .insert(auditLog)
    .values({ id: crypto.randomUUID(), actorId, action, entity, entityId, data: data ?? null });
}

export async function auditFor(entity: string, entityId: string, limit = 50) {
  return getDb()
    .select()
    .from(auditLog)
    .where(and(eq(auditLog.entity, entity), eq(auditLog.entityId, entityId)))
    .orderBy(desc(auditLog.createdAt))
    .limit(limit)
    .all();
}
