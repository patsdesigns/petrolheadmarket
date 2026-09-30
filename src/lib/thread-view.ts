import { threadMessages } from "./messaging";

/**
 * Messages as the thread island sees them. Never includes email addresses.
 * Members never see hidden messages; an admin reading the thread
 * (includeHidden) sees them marked as hidden.
 */
export async function threadView(threadId: string, viewerId: string, includeHidden = false) {
  const msgs = await threadMessages(threadId, includeHidden);
  return msgs.map((m) => ({
    id: m.id,
    mine: m.senderId === viewerId,
    body: m.body,
    createdAt: m.createdAt.toISOString(),
    read: Boolean(m.readAt),
    hidden: Boolean(m.hiddenAt),
  }));
}
