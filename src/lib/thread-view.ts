import { threadMessages } from "./messaging";

/** Messages as the thread island sees them. Never includes email addresses. */
export async function threadView(threadId: string, viewerId: string) {
  const msgs = await threadMessages(threadId);
  return msgs.map((m) => ({
    id: m.id,
    mine: m.senderId === viewerId,
    body: m.body,
    createdAt: m.createdAt.toISOString(),
    read: Boolean(m.readAt),
  }));
}
