import type { APIRoute } from "astro";
import { unreadCount } from "../../lib/messaging";

// Signed-in state for scripts that need it: the account link and the unread
// badge. The middleware skips the unread count for API
// routes, so it is counted here.
export const GET: APIRoute = async ({ locals }) => {
  const body = locals.user
    ? {
        signedIn: true,
        displayName: locals.profile?.displayName ?? locals.user.name,
        isAdmin: locals.profile?.role === "admin",
        unreadCount: await unreadCount(locals.user.id),
      }
    : { signedIn: false, displayName: null, isAdmin: false, unreadCount: 0 };

  return new Response(JSON.stringify(body), {
    headers: { "Content-Type": "application/json", "Cache-Control": "private, no-store", Vary: "Cookie" },
  });
};
