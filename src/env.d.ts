/// <reference types="astro/client" />

// Bindings come from wrangler.json (see worker-configuration.d.ts, generated
// by `npm run cf-typegen`). Variables and secrets are set in the Webflow Cloud
// dashboard, so they are declared here by hand.
declare namespace Cloudflare {
  interface Env {
    WEBFLOW_API_TOKEN?: string;
    WEBFLOW_SITE_ID?: string;
    WEBFLOW_COLLECTION_ID?: string;
    BETTER_AUTH_SECRET?: string;
    RESEND_API_KEY?: string;
    EMAIL_FROM?: string;
    ADMIN_EMAILS?: string;
    /** Public contact address for mailto links and reply_to. Not a sign in address. */
    SUPPORT_EMAIL?: string;
    /** Sign ups allowed per hour for the whole site (default 30). */
    SIGNUP_HOURLY_MAX?: string;
    PUBLIC_SITE_URL?: string;
    /** Local tests only: point the Webflow and Resend clients at fake APIs. */
    WEBFLOW_API_BASE?: string;
    RESEND_API_BASE?: string;
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
