/// <reference types="astro/client" />

// Bindings come from wrangler.json (see worker-configuration.d.ts, generated
// by `npm run cf-typegen`). Variables and secrets are set in the Cloudflare
// dashboard (Workers, Settings, Variables and Secrets), so they are declared
// here by hand.
declare namespace Cloudflare {
  interface Env {
    BETTER_AUTH_SECRET?: string;
    RESEND_API_KEY?: string;
    EMAIL_FROM?: string;
    ADMIN_EMAILS?: string;
    /** Public contact address for mailto links and reply_to. Not a sign in address. */
    SUPPORT_EMAIL?: string;
    /** Sign ups allowed per hour for the whole site (default 30). */
    SIGNUP_HOURLY_MAX?: string;
    PUBLIC_SITE_URL?: string;
    /** Local tests only: point the Resend client at a fake API. */
    RESEND_API_BASE?: string;
    /** Stripe secret key (sk_live_... or sk_test_...). Turns card payments on. */
    STRIPE_SECRET_KEY?: string;
    /** Signing secret of the Stripe webhook endpoint (whsec_...). */
    STRIPE_WEBHOOK_SECRET?: string;
    /** Listing fee in cents (default 10000, $100). */
    LISTING_FEE_CENTS?: string;
    /** Free launch spots for the whole site (default 150). */
    FREE_LAUNCH_SPOTS?: string;
    /** Free launch spots per seller (default 2). */
    FREE_PER_SELLER?: string;
    /** Local tests only: point the Stripe client at a fake API. */
    STRIPE_API_BASE?: string;
  }
}

declare namespace App {
  interface Locals {
    user: import("./lib/auth").SessionData["user"] | null;
    session: import("./lib/auth").SessionData["session"] | null;
    profile: import("./db/schema").Profile | null;
    /** Unread messages, for the header badge. */
    unread: number;
    /** What is waiting for an admin (only filled in for admins, on pages). */
    adminCounts: import("./lib/admin-counts").AdminCounts;
    /** Signed in to a suspended account (treated as signed out otherwise). */
    suspended: boolean;
  }
}
