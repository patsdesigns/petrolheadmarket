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
    PUBLIC_SITE_URL?: string;
  }
}
