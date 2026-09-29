import type { APIRoute } from "astro";

// Called by the Webflow site header to swap "Sign in" for the account link.
export const GET: APIRoute = ({ locals }) => {
  const body = locals.user
    ? {
        signedIn: true,
        displayName: locals.profile?.displayName ?? locals.user.name,
        isAdmin: locals.profile?.role === "admin",
      }
    : { signedIn: false, displayName: null, isAdmin: false };

  return new Response(JSON.stringify(body), {
    headers: { "Content-Type": "application/json", "Cache-Control": "private, no-store" },
  });
};
