# Petrol Head Market: Account App

This repo is the account app for Petrol Head Market, a curated classifieds marketplace for enthusiast cars. Private sellers list their own cars, every listing is reviewed by an admin before it goes live, and buyers make offers or message sellers. Fixed price plus offers. No auctions. No junk cars.

The public site (home page, browse grid, listing pages) is built in Webflow and is NOT in this repo. This app handles everything that needs an account, and publishes approved listings into the Webflow CMS so they appear on the public site.

- Public site: https://petrol-head-market.webflow.io
- This app: https://petrol-head-market.webflow.io/app (Webflow Cloud, mounted at `/app`)
- Deploys: every push to `main` deploys automatically through Webflow Cloud

## Stack (decided)

- **Framework:** Astro (server output) with the `@astrojs/cloudflare` adapter, running on Webflow Cloud (Cloudflare Workers runtime)
- **Interactive pieces:** small React islands only where needed (photo uploader, offer form, message thread). Everything else is server rendered HTML.
- **Database:** Webflow Cloud SQLite (Cloudflare D1) with Drizzle ORM and migrations
- **Photo storage:** Webflow Cloud Object Storage (Cloudflare R2)
- **Auth:** Better Auth (email and password, email verification, password reset), stored in D1
- **Email:** Resend
- **Validation:** Zod on every server input
- **Styling:** plain CSS with CSS custom properties (tokens below). No UI kit.
- **Payments:** none yet. Listing is free for now. Keep the data model ready for a listing fee later (see Lifecycle).

## Webflow Cloud rules (read before scaffolding)

Follow the official docs exactly, and check them before guessing:
- Bring your own app: https://developers.webflow.com/webflow-cloud/bring-your-own-app
- Configuration: https://developers.webflow.com/webflow-cloud/environment/configuration
- SQLite: https://developers.webflow.com/webflow-cloud/add-sqlite
- Object Storage: https://developers.webflow.com/webflow-cloud/add-object-storage

Key points:
- The app runs under the `/app` mount path. Configure Astro's base path (and asset prefix) for `/app` per the docs. Every internal link, redirect, form action, cookie, and asset URL must work under `/app`.
- Commit a `webflow.json` declaring the framework as Astro.
- Commit a `wrangler.json` with the `nodejs_compat` flag and storage bindings. Webflow Cloud provisions the resources and injects real IDs at deploy time, so placeholder IDs are fine. Binding names are what matter:
  - `DB` for D1 (with the migrations directory Drizzle writes to)
  - `PHOTOS` for R2
- Migrations in the migrations directory are applied automatically on each deploy.
- Webflow Cloud runs the framework's own build and ignores custom build scripts. It may override cache headers.
- Use `npm run preview` (Wrangler) to test locally in the same runtime, at the mount path.
- Scaffolded from Webflow's official starter (`Webflow-Examples/hello-world-astro`): `base: "/app"` is set in `astro.config.mjs`, and every internal URL goes through `src/lib/paths.ts`.
- Astro 7 removed `Astro.locals.runtime.env`. Read bindings and variables with `import { env } from "cloudflare:workers"`.
- The Cloudflare adapter adds a `SESSION` KV binding for Astro sessions automatically. We don't use Astro sessions (Better Auth keeps sessions in D1).
- Secrets are set in the Webflow Cloud dashboard (environment variables), never committed.

## Accounts (decided in phase 2)

- Better Auth lives in `src/lib/auth.ts`, mounted at `/app/api/auth/*`. `baseURL` is `PUBLIC_SITE_URL`. Cookies use the `phm` prefix, httpOnly, SameSite Lax, Secure on https.
- Better Auth tables are generated into `src/db/auth-schema.ts` by `npm run auth:schema` (config in `scripts/auth-schema.config.ts`). Never edit that file by hand.
- Pages are server rendered forms with no client JS. Form handlers call Better Auth through `callAuth()` in `src/lib/auth-call.ts`, which calls `auth.handler` in process (so Better Auth's origin checks apply) behind the app's own rate limits.
- The public route `src/pages/api/auth/[...all].ts` only serves the GET links browsers open: `/verify-email`, `/reset-password/:token` (forwards to `/app/reset-password`) and `/get-session`. Everything else, and every POST, is a 404. Sign in, sign up, reset, change email and change password only happen through our form handlers.
- Better Auth's own `rateLimit` is off, because behind Webflow's proxy the IP is often unknown (every visitor shared one bucket) and other IP headers can be spoofed. The app limiter (`src/lib/auth-limits.ts`, D1 table `auth_limits`, applied in `callAuth()`) keys by a SHA-256 of the email address: sign in 5 failed attempts per 10 minutes per email (only failures count, change password shares this bucket), sign up 3 per hour per email plus a site-wide backstop of `SIGNUP_HOURLY_MAX` (default 30) sign ups per hour in the fixed bucket `signup:global` (the IP is often unknown and, while email is off, a new account can offer and message at once, so without it one script could make endless throwaway accounts; a person who hits it sees "We are getting a lot of new accounts right now. Please try again in an hour."), and anything that emails a link (password reset, confirm email, change email) 3 per hour per email. A change of email counts against both the new address and the account's own address (`limitEmail`), so one account can't send confirmation emails to address after address. Every attempt takes its slot atomically before the call (one upsert that returns the new count, refused when over the limit), so parallel guesses can't all pass a check before any is counted; a sign in that succeeds gives its slot back, and so does a refused attempt. D1 errors fail open. A browser that signed in successfully gets a `phm_device` cookie (random id plus an HMAC of id and email with `BETTER_AUTH_SECRET`, one year, httpOnly); its sign ins for that email count in their own bucket, so strangers failing on purpose can't lock the owner out. When `cf-connecting-ip` is present it also keys by that IP, unless the address is one of Cloudflare's own ranges (a Worker proxy's egress, which would put every visitor in one bucket). The IP limits are a loose backstop until the live site confirms the header carries the visitor's own address (check the one-time `[headers] names` log plus a two-client probe): 100 failed sign ins per 10 minutes, 50 sign ups or link emails per hour. A limited password reset answers as if it worked, so it never reveals whether an account exists. `IP_HEADERS` is only `cf-connecting-ip`, which Cloudflare's edge sets and clients cannot. The middleware still logs the incoming header names (never values) once per worker.
- Names are 2 to 80 characters, checked in Better Auth's user create and update hooks too; the signup form also allows only letters, spaces, apostrophes, hyphens and periods (`NAME_PATTERN`).
- Display names are public (CMS `seller-display-name`, threads, emails), so `displayNameField` in `src/lib/profile.ts` (account page) allows 2 to 40 letters (any language), spaces, apostrophes, hyphens and periods, and refuses web addresses and whole words that sound like staff (petrol head, PHM, admin, support, staff, moderator, official, team, Webflow). `defaultDisplayName()` falls back to `Member` when the derived name fails it. Changing the display name re-syncs the seller's listings that are in the CMS (live, offer accepted, sold), one at a time; a failed sync keeps the save and the seller is told the site will update.
- The header cuts long display names short with an ellipsis (16ch, 9ch under 480px, where the action row may wrap) so 360px never scrolls sideways.
- Sessions last 30 days and refresh daily. The middleware calls `getSession` with `returnHeaders` and appends Better Auth's refreshed Set-Cookie headers to every response (unless the page set that cookie itself, like sign in or sign out), so active users stay signed in.
- Signing in does not require a verified email. Submitting a listing, making an offer, and sending a message or reply check `canTransact(user)` (in `src/lib/config.ts`) instead, never `user.emailVerified` directly.
- Email mode: `emailConfigured()` (`src/lib/config.ts`, re-exported from `email.ts`) is `Boolean(RESEND_API_KEY)`. `canTransact(user)` is `emailConfigured() ? user.emailVerified : true`, because while email is off nobody could ever confirm. With email off: signup goes straight to `next` for everyone (admin addresses too, so signing up never reveals the admin list), and verify-email, forgot-password and the Change email card on account say plainly that email is not switched on yet (no "send again" for anyone). Forgot password with email off links to our team (mailto `SUPPORT_EMAIL`, or the Contact the team form) and has a collapsed "Site owner" section ("Owner accounts can get a reset link written to the site log.") that writes a reset link to the log for `ADMIN_EMAILS` addresses only and answers the same for any address. The public page never names the variable or the Webflow Cloud log. Account shows unconfirmed members the same collapsed "Site owner" button (for their own address, same answer for everyone), because signed-in people can't open forgot-password. There is no notice on My garage or account for unconfirmed admin addresses (it would reveal the admin list). People whose role is already admin do get to-do counts (`adminCounts()` in `src/lib/admin-counts.ts`, filled into `locals.adminCounts` by the middleware for admins on page requests): listings waiting for review, open contact requests and unreviewed flags, as a badge on the account menu and its "Review queue" link, on each `AdminNav` tab, and as an "Admin to do" notice on My garage. With email off this is how the owner hears about new work. Seller, offer and admin notices only promise an email when `emailConfigured()`, and promises of message, offer, counter or decline emails also need the person's `email_notifications` ("Offer sent. Check Offers for the seller's reply." otherwise; the Live email drops its "We will email you" line for sellers who turned notifications off). Seller copy that depends on the lazy CMS retry says "shortly" ("It will be removed from the Lot shortly", "The public listing will update shortly"). The auth pages' brand panel says "Your email stays private until you agree a deal" (accepting shares emails, and Messages and phone publishes the number). No page may claim an email was sent when it was not. With email on, everything works as before and verification is required. verify-email says "We sent a link to X" only after a resend there or when signup added `sent=1`, which it does only if the confirmation email really went out (`verifySendFailures` in `auth.ts` records a failed or skipped send, since Better Auth swallows the error on sign up). Otherwise it says "Confirm your email to list a car, make offers and message sellers" with a "Send me a confirmation link" button. So when email is switched on after launch, existing unconfirmed members (who never got a link) are asked to send one, not told one was sent. Forgot password takes the same path for every address (rate limit, Better Auth, `sendEmail` decides what is logged), so response timing never shows which addresses are admins.
- `sendEmail()` returns `true` only when Resend accepted the email, `false` when email is off (it throws on a Resend error). It sets `reply_to` to `supportEmail()` when there is one. `supportEmail()` is the `SUPPORT_EMAIL` variable only, never an `ADMIN_EMAILS` address: those are sign in names, and publishing them (mailto links on public pages, reply_to) let anyone aim failed sign ins at the owner. Without `SUPPORT_EMAIL` there is no mailto and no "reply to this email" line.
- Logs never carry links, tokens, contact details or message bodies. drizzle-orm puts a failed query's bound params (session tokens, emails) in the error message, so catch blocks log `safeError(err)` from `src/lib/log.ts` (error names and messages with the params cut off and emails masked), never the error object, and the CMS audit rows use `errorMessage(err)`. Better Auth gets a `logger` in `createAuth()` that does the same. With email off, `sendEmail` logs only the recipient's domain and the subject, except for the password reset to an `ADMIN_EMAILS` address (`adminBootstrap`, set only by `sendResetPassword`), which is logged in full. Confirmation links are never logged, not even for admin addresses: a stranger may have signed up first with the owner's address, and opening that link would confirm the stranger's account (and its password) as admin. Owner bootstrap while email is off: sign up (or not, if someone else already did), then use "Site owner" on forgot-password (or on account while signed in) to get a reset link in the Webflow Cloud log, and choose a password. `emailAndPassword.onPasswordReset` in `src/lib/auth.ts` sets `emailVerified` on any finished reset (the link proves the inbox, or the log, which only gets admin links), and `revokeSessionsOnPasswordReset` signs every session out, so a squatter loses the password and every session in the same step. With email on, the confirmation email says to ignore it if you did not create the account; an owner who finds his address taken uses forgot-password the same way.
- Contact the team (`/app/contact`, public, `src/lib/contact.ts`, D1 table `contact_requests`): topic (a change to my listing, getting into my account, my suspended account, something else), name and email when signed out (the account's when signed in), a message of 20 to 2,000 characters and a hidden honeypot field. Limited to 3 per hour per email (and per IP when Cloudflare gives one) in `auth_limits` (action `contact`), plus 60 per hour for the whole site. Admins get an email (domain only in the log while email is off) and read messages on `/app/admin/contact` (Contact tab): Reply by email opens the admin's own mail app, Mark as handled is audited (`contact_handled`, entity `contact`). `contactHref()` gives a mailto to `SUPPORT_EMAIL` when set and the form otherwise, so every "contact our team" link works with no setup: forgot-password, `/app/suspended`, Quick changes and the Questions line on rejected or withdrawn listings. Email lines that invite questions use `questionsLine()` (reply to this email with `SUPPORT_EMAIL`, a link to the form without it).
- While email is off, an admin can press "Get a reset link" on `/app/admin/users` for a member who is locked out (not for admin addresses or suspended accounts). `adminResetLink()` in `src/lib/admin-users.ts` calls Better Auth in process with a one-time id in the `x-phm-reset-capture` header, and `sendResetPassword` hands that link back instead of sending or logging it (the public auth route serves no POSTs and `callAuth()` never forwards that header). The admin sees the link with an "Email it to them" mailto and sends it from his own inbox to the account's address only. Audited as `reset_link_by_admin`.
- `src/middleware.ts` loads the session and profile, sends signed out people to `/app/login?next=...`, returns the 404 page for non admins on `/app/admin*`, and rejects cross-origin POSTs (CSRF). Astro's own `checkOrigin` is off because the request URL behind the Webflow proxy may not match the browser origin. After every response it reads any request body the route left unread (an early error or redirect on an upload), because an unread body on a kept-alive connection broke the next request in the dev proxy.
- Suspension (`profiles.suspended_at`, set from `/app/admin/users` or "Suspend sender" on `/app/admin/flags`, logic in `src/lib/admin-users.ts`): suspending deletes the person's sessions, moves their submitted, approved, live and offer accepted listings to `withdrawn` and unpublishes the CMS items (`unpublishListing()` in `cms.ts`, `DELETE .../items/{itemId}/live`; failures are audited as `cms_unpublish_failed`), closes offers on those listings exactly like a take down (`closeOffersOnTakeDown()` in `take-down.ts`: pending offers are declined, an accepted deal becomes `ended`, each buyer is emailed once), sets their `review_notes` to "Taken down because the account was suspended." (so an admin-only approve note is never shown to the seller), withdraws their own pending offers, hides their flagged messages nobody has read yet (`messages.hidden_at`) and marks their flagged messages reviewed. Better Auth's `session.create.before` hook refuses sign in for a suspended account (code `ACCOUNT_SUSPENDED`), and login sends them to `/app/suspended`. If a suspended session still arrives, the middleware treats it as signed out: GETs to app pages go to `/app/suspended`, other mutations get 403, only `/logout` works. `sendMessage()` and `createOffer()` refuse suspended users too. Unsuspending only clears the flag; taken down listings stay down. Admins (role admin, which needs a confirmed `ADMIN_EMAILS` address) and the acting admin can't be suspended. An unconfirmed account on an admin address (someone who signed up first with the owner's address) is not an admin and can be suspended; the Users page marks it "Owner address, not confirmed. Not an admin." and points to the Site owner reset, which confirms the address and signs the squatter out, and `ensureProfile()` clears a suspension once an address becomes admin. Every action is audited (`user_suspended`, `user_unsuspended`, `email_confirmed_by_admin`, entity `user`).
- Admins can "Mark email as confirmed" on `/app/admin/users` (sets `user.emailVerified`), except for `ADMIN_EMAILS` addresses, which are confirmed only by a password reset (see the owner bootstrap above) because a confirmed admin address becomes an admin.
- The admin role needs a proven email: `roleFor()` in `src/lib/profile.ts` gives `admin` only when the email is in `ADMIN_EMAILS` AND `user.emailVerified` is true. The middleware syncs the stored role on every request (it writes only when the role changes), so ADMIN_EMAILS changes apply at once.

## Selling (decided in phase 3)

- Listing rules live in `src/lib/listing-rules.ts`: per field Zod rules for draft saves, the five wizard steps, and `checklist()`, which the wizard shows and the server enforces on submit. Options and their Webflow option IDs are in `src/lib/listing-options.ts`.
- Drafts save leniently: valid fields are saved even when others have errors, so autosave never loses work. Required fields are only enforced at submit.
- Autosave is a small inline script on the wizard page (not a React island). It posts the step form with `X-Autosave: 1` (`redirect: "manual"`) a moment after typing stops, before following any link on the page (it waits for the save, and stays on the page if the save failed or some fields were not saved; a second click leaves), and with `keepalive` on `pagehide` and when the page is hidden. It says "Draft saved" only when the server answered JSON `{ ok: true }` with no field errors; otherwise it names the fields that did not save ("Saved, except Price, VIN") and shows each error under its field, or says why nothing was saved.
- Autosave requests always get JSON, never a redirect: 401 `signed_out` from the middleware when the session is gone, 403 `suspended`, 404 `not_found`, and 409 `not_editable` when the listing left draft (for example submitted in another tab; `saveListingFields()` returns false when no editable row matched). A normal step post with errors (Back included) shows the step again with the posted values and errors.
- `/app/sell` shows open drafts, each with Continue and Delete, and "Start a new listing" reuses the newest empty draft (no year, make, model or photos) before creating one (max 10 open drafts). The wizard is `/app/listings/:id/edit?step=car|history|photos|price|review` and has "Delete this draft" in its side column.
- A seller can move a submitted listing back to draft, and delete drafts, rejected and withdrawn listings (photos are removed from R2 too). Deletes post `intent=delete` to `/app/listings/:id` (`back=sell` returns to `/app/sell`). The notice matches what was deleted (see Review and publishing). Rejected and withdrawn listings also get a Start a new listing button.
- Year, make and model are dropdowns on the wizard's first step (`src/components/CarPicker.astro`, list in `src/lib/car-catalog.ts`): years from next model year down to 1920, a curated list of enthusiast makes, and each make's models written the way enthusiasts say them, each with the model years it was built (`"Integra|1986-2001,2023-"`, no end year means still built). Makes and models are filtered to the chosen year and models to the chosen make (a 1993 Porsche offers no Cayenne); the years are a guide for the lists, never a server rule, and a saved make or model outside its year stays offered so nothing is dropped. Each dropdown has an "Other" choice (value `__other`) that shows a text box (`year_other`, `make_other`, `model_other`, shown with CSS `:has`, so it works without JavaScript); `resolveCarPicks()` turns the posted pick back into the plain `year`, `make` and `model` fields before the listing rules run. A small script refills the makes and models when the year or make changes. A saved value that is not in the list shows as Other with the text filled in. The admin edit form keeps plain text fields.
- Title is stored as `title_status` (clean, rebuilt, salvage, lien, none) plus `title_state`, and becomes `CLEAN - CA` for the CMS. "No title (bill of sale)" (`none`) needs no state: the checklist skips it, a saved state is cleared, and the CMS gets `NO TITLE`. Location is `location_city` plus `location_state`.
- Photo API: `POST /app/api/listings/:id/photos` (raw JPEG body, `?w=&h=`), `PUT` the same path with `{ order: [ids] }`, `DELETE /app/api/listings/:id/photos/:photoId`. Only while the listing is a draft or has changes requested.
- Workers report the date as 1970 while a module loads. Never compute dates (like the current year) at module scope.
- When a listing is submitted, everyone in `ADMIN_EMAILS` gets an email.

## Review and publishing (decided in phase 4)

- CMS mapping is `buildFieldData()` in `src/lib/cms.ts`, checked against the live collection schema. Empty fields are sent as `null`. `seller-phone` is `null` unless the contact method is Messages and phone. Title becomes `CLEAN - CA` (lien shows `CLEAN, LIEN - CA`). Owner count becomes `2 Owners`.
- `publishListing()` creates the item with `POST /v2/collections/{id}/items/live` and emails the seller when it goes live. `syncListing()` updates it with `PATCH .../items/{itemId}/live` for any listing already in the CMS (live, offer accepted, sold). The PATCH publishes, so after it `syncListing()` re-reads the status and unpublishes again if the listing was taken down meanwhile (otherwise a sync racing a take down could put the car back on the Lot), and it clears `cms_sync_pending` only while the status is still one that belongs in the CMS. Calls retry on 429 (Retry-After) and on 5xx, except a POST is never retried on 5xx (Webflow may have created the item; the next publish adopts it by slug).
- `WEBFLOW_SITE_ID` and `WEBFLOW_COLLECTION_ID` default in code (`src/lib/webflow.ts`) to the Petrol Head Market IDs; env values override them. `webflowConfigured()` is just `Boolean(WEBFLOW_API_TOKEN)`, the only setting publishing needs.
- Without the token, Approve still records the approval (audited `approve` plus `cms_publish_deferred`), the button reads "Approve (goes live when Webflow is connected)", and the listing stays `approved`. The seller sees "Approved. It goes on the Lot as soon as publishing is switched on. Check My garage for updates." (with the token set it is "Approved. It will appear on the Lot shortly.").
- Double publish guard: `publishListing()` first claims the listing with a conditional update of `listings.publishing_at` (a 2 minute lease, cleared on success or failure), saves the slug before creating, writes `cms_item_id` straight after the create, and before creating looks the slug up in the CMS: an item whose `app-listing-id` is this listing is adopted (PATCHed), not created again. The final move to `live` is conditional on `status = approved`; if the listing changed meanwhile the new item is unpublished again. Approve publishes only if its own `submitted` to `approved` update won. Review forms also ignore a second click.
- Pending CMS work: any failed sync or unpublish sets `listings.cms_sync_pending` (cleared on success). No cron: `retryPendingCms()` in `src/lib/cms.ts` runs (via `scheduleCmsRetry()` and `waitUntil`) whenever any admin page loads (`AdminNav` on the queue, Listings, Users, Flagged and Contact pages, plus the review screen), at most once a minute (a `job_runs` row), and only when the token is set, so nothing piles up in the audit log while it is missing. It publishes up to 5 `approved` listings and fixes up to 5 pending ones, taking the ones tried longest ago first (`listings.cms_attempted_at`, set on every failed publish, sync or unpublish and when a publish starts; never tried sorts first), so listings that keep failing can't starve the rest. A lazy retry (no actor) only audits a failure when it differs from the listing's latest History entry (same action and error are skipped); failures an admin triggers are always audited. The queue lists "Approved, not on the site yet" and "Site needs an update", with a Retry all now button; the review screen shows the error with Retry publish, Sync to site now, or Retry removing from the site. An approved listing with no failure since its approval shows "Waiting to publish" with Publish now, never "Publishing failed". Copy says approved listings publish "the next time you open an admin page", never "on their own".
- Slugs: `{year}-{make}-{model}` slugified, checked against our DB and the CMS (`?slug=`), with a 4 character suffix on a clash. If Webflow still says the slug is taken, publishing retries once with a new suffix (unless the clashing item is this listing's own, which is adopted).
- Approve requires the checklist to pass (admins can fix fields with Edit listing first). Request changes and Reject require a note of at least 10 characters. `submitted` listings can be decided, and so can `approved` listings that have no CMS item yet and are not mid publish (they also get Move back to review). The note hint says approve notes are only seen by admins. After Request changes or Reject the queue confirms it.
- Taking down (`src/lib/take-down.ts`): a seller can Take down listing on a live listing; an admin can Take down any listing on the site (live, offer accepted, sold) with a note of at least 10 characters that the seller sees and is emailed. Either way the listing becomes `withdrawn` (conditional update), pending offers are declined and an accepted deal becomes `ended`, each buyer is emailed once, `take_down` is audited, and the CMS item is unpublished with `DELETE .../items/{itemId}/live` (`cms_unpublish` or `cms_unpublish_failed`, retried as pending work). The item id and slug are kept. Messages on withdrawn and rejected listings are closed (`sendMessage` refuses and the thread page hides the reply box). Flagged messages link to the listing's review screen.
- Sellers can delete drafts, rejected and withdrawn listings (`deleteListing`, photos removed from R2). A withdrawn listing's staged CMS item is deleted first; while its unpublish is still pending the delete waits. A listing with no offers or threads is deleted. One with offers or threads is soft deleted (`listings.deleted_at`, photos and photo rows removed, the seller no longer sees it) so buyers keep their offers and threads and admins keep flagged messages as evidence; admin pages mark it "Deleted by the seller". The notice says "Draft deleted.", "Listing deleted, with its photos." or "Listing and photos deleted. Your conversations with buyers stay in your inbox." to match.
- Admin edits on a listing that is in the CMS sync right away (even when nothing changed, so saving again fixes a site that is behind). A save with field errors still keeps the valid fields and syncs them, and the notice says whether the site was updated or the sync failed (then it is pending work like any other). Admins can also delete a photo. `/app/admin/listings` finds any listing by status and by car, slug, pasted public link, seller name, email or id, 50 per page.
- Every admin action and CMS publish or sync (and failures, with the error) goes to `audit_log`, shown as History on the review screen.
- `WEBFLOW_API_BASE` exists only to point tests at a fake API. Never set it in Webflow Cloud. `RESEND_API_BASE` is the same for email (tests with email switched on).

## Buying (decided in phase 5)

- `/app/offer` and `/app/message` look the listing up by its CMS slug, and only for live, offer accepted or sold listings. They look it up before asking anyone to sign in: the middleware lets signed-out GET and HEAD requests to these two paths through (`PAGE_CHECKS_AUTH`; POSTs still go to login), and each page redirects to `/app/login?next=...` only when the listing is real. A slug the app does not have (the Lot's sample CMS items) shows `src/components/NotOnApp.astro`: "This is a sample listing, so offers and messages are switched off. Real listings from sellers take offers and messages." with Back to the Lot and Back to the car, for signed-in and signed-out visitors alike, with status 200 (a 404 could be swapped for the host's generic error page). A slug the app has but that is no longer public says the car is no longer on the Lot. With no `listing` parameter, a same-origin Referer of `/listings/{slug}` redirects to the right URL, otherwise the page says "Pick a car on the Lot first". Slugs are checked against `^[a-z0-9][a-z0-9-]*$` before lookup or linking.
- Offers (`src/lib/offers.ts`): a counter is a new row with `made_by = seller` and `parent_offer_id` pointing at the buyer's offer, which becomes `countered`. Sellers counter buyer offers, buyers accept or decline counters, buyers can withdraw their own open offer. A counter must be above the buyer's offer and at most the asking price. Offers over double the asking price are refused as a typo guard.
- Expiry has no cron: pending offers past `expires_at` are marked `expired` whenever offers are read.
- Accepting first takes the offer with a conditional update (still `pending` and not expired), then claims the listing with a conditional update (`live` to `offer_accepted`) so two accepts can't both win; if the claim fails the offer becomes `declined`, never back to pending. Decline and withdraw also check that their conditional update changed a row, and report "This offer is no longer open." without an email otherwise. Accepting declines every other open offer with an email, syncs the CMS, and emails both sides each other's contact details. The seller's phone is shared only when the listing uses Messages and phone. Contact details are also shown on `/app/offers` for accepted deals. Accept offer asks for confirmation, worded for the seller (other offers are declined) or the buyer accepting a counter.
- Emails that close an offer say "your $X offer", or "the seller's $X counter offer" when the closed row is a counter (`offerPhrase()` in `offers.ts`).
- `offers.status` also has `ended`: the seller put the car back on sale (or the listing was taken down) after accepting. `/app/offers` says the seller called off the deal and put the car back on sale (whatever happened to the car since: live, another offer accepted, or sold), and says the car was taken off the site only when the listing is withdrawn, rejected or deleted. Never that the buyer withdrew. A soft-deleted listing shows its title as plain text with a Deleted badge (the seller page is gone). No SQL migration was needed for it (text enum, no CHECK constraint).
- `/app/offers` shows Make a new offer to a buyer whose offer is over while the car is live and takes offers, Message seller to buyers, and Message buyer to sellers. Message buyer opens `/app/inbox/new?offer={id}` (seller only, 404 otherwise), which redirects to the thread if one exists and otherwise shows a compose form; the thread is created with the first message (`sendMessage({ offerId })`), never on a GET.
- Rate limits: 10 offers per buyer per hour, 30 messages per user per 10 minutes.
- Messages: the thread page is a React island that polls every 15 seconds while visible. Only the first unread message in a burst sends an email. Emails never include addresses. Admins can open any thread read only (from the flags page), and see hidden messages there marked "Hidden by an admin". The new message email never quotes a flagged message ("X sent you a message. Read it on Petrol Head Market."). On `/app/admin/flags` an admin can "Hide message" (sets `messages.hidden_at` and marks it reviewed, audited as `message_hidden`): hidden messages are left out of the thread, the inbox preview and unread counts for both members.
- Scam filter (`scamCheck` in `src/lib/messaging.ts`) flags wire transfers, Western Union or MoneyGram, gift cards, shipping agents, escrow, crypto, WhatsApp or Telegram, "text me at", email addresses, phone numbers and outside links. Flagged messages are still delivered. Offer and counter notes go through the same filter (`offers.flagged`, `flag_reason`, `flag_reviewed_at`): they are still delivered and shown, but the email leaves a flagged note out ("They added a note. Read it on Petrol Head Market.") and `/app/offers` adds a safety line under it. Flagged notes are listed on `/app/admin/flags` under Offer notes with Mark reviewed (audited as `flag_reviewed`, entity `offer`) and Suspend sender. Suspending someone marks their flagged offer notes reviewed too.
- Inbox and garage queries never bind an id per row: `inboxFor()` is one statement with a join for the other person's name and correlated subqueries for the last message and unread count, and `listForUser()` joins photos to listings by owner. D1 refuses statements with more than 100 bound parameters, so any `inArray` over a list that is not strictly bounded goes through `chunks()` in `src/db/client.ts` (groups of 90).
- Every date and time the app shows is formatted in `America/Los_Angeles` (admin Contact, Users, Listings and History included). Thread times in the message island use it too, like the inbox list, so the server render and hydration match. Opening a thread recounts the header's unread badge after marking it read.
- Email notification setting (`profiles.email_notifications`) covers new offers, counters, declines and messages. Accepted deal emails always go out.

## Finish (decided in phase 6)

- Seller actions live in `src/lib/seller-actions.ts` and on `/app/listings/:id`: quick changes (price, accepts offers, contact method, phone) for live and offer accepted listings, Mark as sold (from live or offer accepted, expires stale offers first, then closes open offers with an email that respects the buyer's notification setting), and Put back on sale (offer accepted to live, the accepted offer becomes `ended` and the buyer is always emailed, like accepted deal emails). Each one syncs the CMS. If the sync fails the change is kept, the listing is marked `cms_sync_pending`, and the seller page shows "not up to date yet" with a Retry update button (live, offer accepted and sold). Accepting an offer reports a failed sync to the seller with a link to that page. Seller copy never claims "we have been told".
- `GET /app/api/listings/{slug}/photos` is public (CORS `*`, cached 5 minutes; the middleware skips the session lookup for it and keeps any `public` Cache-Control a route sets, so only personal responses get `private, no-store`) and returns `{ slug, count, photos: [{ url, width, height }] }` with absolute URLs. A slug the app does not have (the Webflow sample listings) gets 200 with `count: 0` and no photos, not a 404, so the site's gallery script leaves the page alone without a console error. The same path with a listing UUID is the seller's uploader endpoint. Slugs are never UUIDs, which is how the route tells them apart.
- `src/pages/404.astro` and `src/pages/500.astro` are the error pages. Signed out visitors to unknown app paths are sent to login first. The 500 page never claims work was saved.
- Links into My garage from emails and error pages go to `/app/login?next=/app`, never bare `/app` (a signed-out visit to `/app` goes to the Lot). Signed-in people are forwarded from login to `next`. Other deep links already go through login with `next`.
- Sellers ask for changes beyond the quick edits (and ask about rejections) through `contactHref()` on `/app/listings/:id`: a mailto to `SUPPORT_EMAIL` when set, otherwise the Contact the team form with the listing attached. Never by "replying to an email". Without `SUPPORT_EMAIL` every page still has a working contact route (the form).
- Admin notices after Approve (without a token) and Take down only promise the seller an email when `emailConfigured()`; otherwise they say the seller sees it in My garage or on their listing page.

## Environment variables

| Name | Secret | Purpose |
|---|---|---|
| `WEBFLOW_API_TOKEN` | yes | Site API token with CMS read and write |
| `WEBFLOW_SITE_ID` | no | Optional override. Defaults in code to `6a8cb05d39be95366772994d` |
| `WEBFLOW_COLLECTION_ID` | no | Optional override. Defaults in code to `6a8cb2028c898e7ed8517d9c` (Listings) |
| `BETTER_AUTH_SECRET` | yes | Auth signing secret |
| `RESEND_API_KEY` | yes | Transactional email. Its presence switches email mode on (`emailConfigured()`): verification becomes required and email-only flows (reset, change email) appear. |
| `EMAIL_FROM` | no | Sender address |
| `ADMIN_EMAILS` | no | Comma separated emails that get the admin role once the address is confirmed (synced on every request) |
| `SUPPORT_EMAIL` | no | Public contact address for mailto links and email reply_to. Use a shared inbox, not an `ADMIN_EMAILS` sign in address. Without it, contact links go to the Contact the team form (`/app/contact`). |
| `SIGNUP_HOURLY_MAX` | no | Optional. Sign ups allowed per hour for the whole site, default 30. |
| `PUBLIC_SITE_URL` | no | `https://petrol-head-market.webflow.io` (becomes the custom domain later). Also the auth base URL, so it must match the domain people use. |

The Webflow token is server only. Never send it to the browser.

## Routes the Webflow site already links to (must exist)

- `/app/login`
- `/app/sell`
- `/app/offer?listing={slug}`
- `/app/message?listing={slug}`

`{slug}` is the Webflow CMS item slug, which is also the public URL: `/listings/{slug}`.

If a signed out user hits `/app/offer` or `/app/message` for a real listing, send them to login and return them to the same URL afterward. Sample listings and a missing listing show the NotOnApp page without asking anyone to sign in.

## Screens

**Public (signed out)**
- `/app/login`, `/app/signup`, `/app/forgot-password`, `/app/reset-password`, `/app/verify-email`, `/app/contact` (Contact the team, signed in or not)
- `/app/suspended` : "Your account is suspended" notice (sign out, and a link to our team: mailto `SUPPORT_EMAIL` or the Contact the team form)

**Signed in**
- `/app` : My garage (dashboard). Listings with status, offers needing a response, unread messages.
- `/app/sell` : New listing wizard. Autosaves as a draft. Steps: The car, Condition and history, Photos, Price and contact, Review and submit.
- `/app/listings/:id` : Seller view of one listing (status, reviewer notes, quick edits, mark sold, take down, delete when draft, rejected or withdrawn)
- `/app/listings/:id/edit` : Edit a draft or a listing with changes requested
- `/app/offer?listing={slug}` : Make an offer (shows the car summary and asking price)
- `/app/offers` : Offers sent and received
- `/app/inbox/new?offer={id}` : A seller writes to a buyer who made an offer (the thread is created with the first message)
- `/app/message?listing={slug}` : Opens or creates the thread with that seller
- `/app/inbox` and `/app/inbox/:threadId` : Messages
- `/app/account` : Display name, phone, email, password, notification settings

**Admin (role admin only)**
- `/app/admin` : Review queue, oldest submitted first
- `/app/admin/listings/:id` : Full review screen with the checklist, photo grid, inline edit, notes to seller, and three actions: Approve and publish, Request changes, Reject. Approved listings add Retry publish and Move back to review; listings on the site add Take down; out of date ones add Sync to site now
- `/app/admin/listings` : Every listing, newest change first, 50 per page, filter by status, search by car, slug, pasted public link, seller name, email or id
- `/app/admin/users` : Search accounts by email or name; shows confirmed, admin, suspended and listing counts; actions Mark email as confirmed, Suspend, Unsuspend
- `/app/admin/flags` : Messages and offer notes flagged by the scam filter, with Mark reviewed, Hide message (messages only) and Suspend sender
- `/app/admin/contact` : Messages from the Contact the team form, with Reply by email and Mark as handled
- Every admin page starts with `src/components/AdminNav.astro` (Review queue, Listings, Users, Flagged, Contact).

**API**
- `/app/api/auth/*` : Better Auth handler (configure its base path under `/app`)
- `GET /app/api/me` : `{ signedIn, displayName, isAdmin, unreadCount }` with `Cache-Control: private, no-store` and `Vary: Cookie`. The Webflow site header will call this to swap "Sign in" for the user's account link and show an unread badge. Set `displayName` with textContent only.
- `GET /app/api/listings/{slug}/photos` : Public JSON list of every photo URL in order, for the gallery on the public listing page
- `GET /app/photos/{key}` : Public photo serving from R2
- Everything else as needed by the screens

## Listing lifecycle

Statuses in the app database:

`draft` → `submitted` → `changes_requested` (back to seller) → `submitted` → `approved` → `live` → `offer_accepted` → `sold`

Also: `rejected`, `withdrawn`. Reserve `awaiting_payment` between `draft` and `submitted` for the future listing fee, but do not use it yet.

- Only `live`, `offer_accepted`, and `sold` listings exist in the Webflow CMS.
- `approved` means the admin approved it and the CMS publish is in progress (or waiting for the Webflow token). If the Webflow API call fails, stay in `approved`, log the error, and retry: automatically from the admin pages, or by the admin from the review screen.
- `withdrawn` means taken down by the seller or an admin (or the seller was suspended). Its CMS item is unpublished.
- Sold listings stay published with status Sold. The public grid already hides sold cars.
- Edits on a live listing: price, accepts offers, contact method, and phone sync to the CMS immediately. Any other change requires the admin to make it (keep v1 simple).

## Review checklist

The wizard enforces these before submit, and the server re-checks:
- At least 20 photos, first photo is the main photo
- Year, make, model, price, mileage, transmission, location (City, ST), title status (and the title state, unless there is no title)
- VIN required for 1981 and newer (17 characters, valid format)
- Description of at least 300 characters
- Known issues is required. A seller who writes "none" gets a prompt to be honest about wear, because disclosure is what makes this marketplace trustworthy.

The admin decides the rest by judgment: is it an enthusiast car, are the photos honest, does the price make sense. Rejections and change requests always include a note to the seller.

## Offers

- Buyer must be signed in with a verified email (checked with `canTransact`, which skips the check while email is off).
- Only on listings where accepts offers is on.
- Block offers under 50% of the asking price with a clear message.
- One open offer per buyer per listing. Offers expire after 72 hours.
- Seller can Accept, Counter, or Decline. Buyer can accept or decline a counter.
- On accept: listing goes to `offer_accepted` (sync to CMS), all other open offers on that listing are declined automatically with a notification, and both sides get each other's email (and phone if the seller shared it) by email and in the app.
- Seller can later mark Sold, or relist (back to `live`) if the deal falls through.

## Messaging

- One thread per listing per buyer. Messaging is always available, regardless of contact method.
- Email notification for new messages with a short preview and a link back to the thread. Never reveal email addresses in threads.
- Show a short safety note in every thread: never wire money or pay before seeing the car and title.
- Flag messages containing scam patterns (wire transfer, Western Union, gift cards, shipping agent, escrow links, requests to move off platform) into `/app/admin/flags`. Do not block them. An admin can hide a message or suspend the sender from there.
- Rate limit messages and offers per user.

## Seller contact method

Seller picks one:
- **Messages only** (default)
- **Messages and phone**: the phone number is written to the CMS and shown on the public listing page

Only write `seller-phone` to the CMS when the seller chose Messages and phone. Clear it if they switch back.

## Photos

- Resize in the browser before upload: long edge 2400px, JPEG quality around 0.85. Resizing through canvas also strips EXIF, which removes GPS location. This matters for seller privacy.
- Upload straight to R2 through the app, show progress, allow drag to reorder, and set the main photo.
- Up to 80 photos per listing.
- Keys: `listings/{listingId}/{photoId}.jpg`
- Serve publicly from `/app/photos/{key}`.
- Suggested shot list shown in the uploader: front three quarter, rear three quarter, both sides, interior front and rear, dash and odometer, engine bay, underside, wheels and tires, flaws up close, title (with personal info covered).

## Publishing to the Webflow CMS

Use the Webflow Data API v2. Create approved listings as live items, and update live items when status or quick edits change. Respect Webflow API rate limits (throttle and retry on 429). Pass image URLs (the public `/app/photos/...` URLs) and Webflow imports them.

Taken down listings (seller or admin, or a suspended seller) are removed from the live site with `DELETE /v2/collections/{id}/items/{itemId}/live`. The site and collection IDs default in code (`src/lib/webflow.ts`), so `WEBFLOW_API_TOKEN` is the only setting publishing needs.

Collection: **Listings** `6a8cb2028c898e7ed8517d9c`

| Field slug | Type | How to fill it |
|---|---|---|
| `name` | PlainText (required) | `{year} {make} {model}` |
| `slug` | Slug | `{year}-{make}-{model}` lowercased and hyphenated. Add a short suffix only if it collides. |
| `year` | Number (required) | |
| `make` | PlainText (required) | |
| `model` | PlainText (required) | |
| `price` | Number | Whole dollars, used for sorting |
| `price-display` | PlainText (required) | `$32,500` |
| `mileage` | Number | |
| `miles-display` | PlainText (required) | `88,200` |
| `transmission` | Option | See option IDs |
| `engine` | PlainText | `2.5L Turbo I4` |
| `drivetrain` | Option | See option IDs |
| `body-style` | Option | See option IDs |
| `exterior-color` | PlainText | |
| `interior-color` | PlainText | |
| `vin` | PlainText | |
| `title-status` | PlainText | `CLEAN - CA` style |
| `owner-count-label` | PlainText | `1 Owner`, `2 Owners` |
| `location` | PlainText | `City, ST` |
| `headline` | PlainText | One line hook written by the seller |
| `description` | RichText | Seller's story |
| `highlights` | RichText | Bullet list |
| `known-issues` | RichText | Bullet list |
| `modifications` | RichText | Bullet list, omit if none |
| `service-history` | RichText | Paragraphs |
| `video` | VideoLink | Optional YouTube or Vimeo URL |
| `main-photo` | Image | First photo |
| `gallery` | MultiImage | First 25 photos only (Webflow limit). The full set comes from `/app/api/listings/{slug}/photos`. |
| `photo-count` | Number | Total photos |
| `listed-on` | DateTime | Set when first published |
| `listing-status` | Option | See option IDs |
| `accepts-offers` | Switch | |
| `contact-method` | Option | See option IDs |
| `seller-display-name` | PlainText | First name and last initial, like `Dave K.` |
| `seller-phone` | Phone | Only when contact method is Messages and phone |
| `seller-type` | Option | Private Party unless the admin marks a dealer |
| `verified-seller` | Switch | Admin controlled |
| `records-on-file` | Switch | Seller checks it, admin confirms |
| `featured` | Switch | Admin controlled |
| `seller-id` | PlainText | App user id |
| `app-listing-id` | PlainText | App listing id |
| `freshness-label` | PlainText | Legacy, leave empty |

Sellers type plain text. Convert it to safe HTML for rich text fields: blank lines become paragraphs, and for list fields each line becomes a list item. Escape everything. Allow no raw HTML from users.

**Option IDs**

- `transmission`: 5-SPD MANUAL `b0355584a92f5f24e9e5267bb1e67f0f`, 6-SPD MANUAL `1717b997803538680039794389f71c38`, AUTOMATIC `5ff57da4ed58cf496487084506423a34`, DCT / PDK `6a075c32f925dba2b078b861b2d06cf4`
- `drivetrain`: RWD `3d655f503bf5f33a04dfbd7421c29631`, AWD `0d7f9e4f7e11952182d141455e09d11f`, FWD `6520ed8ff4f9edff6cf5f07203d24fc3`, 4WD `f84ded1a3fae0dc54b82c10255e2d059`
- `body-style`: Coupe `f9d87ca79b2f9c8c54f3bf10a3d78c50`, Convertible `7fa15466ab07a06a709d187d6faf9780`, Targa `0126f3babe618adc23c7f66e6d75fe46`, Hatchback `a02520d6a0a379241c7628dee386b76f`, Sedan `89458d180894b3e13d2d5f03ef8dec61`, Wagon `5bb363601c870d8c12c1c93302112477`, Truck `9bffdbd99cc85c414ed0a48196dd75fe`, SUV `ea30a73de35eb831a6fc833a94850961`
- `listing-status`: Live `5e06ac221c7686cd9fe03a747df40634`, Offer Accepted `f30aec956457559c7fa0710fc30edf55`, Sold `b2c0f9c78f4767dac05e3fd0d11327ac`
- `contact-method`: Messages only `9241b2ba438eb46eb9001ced00f2fa1d`, Messages and phone `ed8ceffa431c12d0d6e8d3da1f109765`
- `seller-type`: Private Party `b6ae57a7308ca3d8bbef3755730992a1`, Specialty Dealer `cde1823dfbd6754b36ea2269c9f04a19`

If a field or option ID ever fails, re-read the collection schema from the API instead of guessing.

## Data model (D1)

Better Auth's own tables, plus:
- `profiles`: user_id, display_name, phone, role (user or admin), email_notifications, suspended_at, created_at
- `listings`: id, user_id, status, every listing field above, slug, cms_item_id, publishing_at (publish lease), cms_sync_pending, cms_attempted_at (last CMS attempt, orders the lazy retry), deleted_at (soft delete by the seller), review_notes, reviewer_id, submitted_at, reviewed_at, published_at, sold_at, created_at, updated_at
- `job_runs`: name, ran_at (throttle for jobs with no cron, such as the CMS retry)
- `contact_requests`: id, user_id (null when signed out), name, email, topic, listing_id, body, handled_at, handled_by, created_at (Contact the team form)
- `listing_photos`: id, listing_id, r2_key, position, width, height, created_at
- `offers`: id, listing_id, buyer_id, amount, message, status (pending, countered, accepted, declined, expired, withdrawn, ended), parent_offer_id, flagged, flag_reason, flag_reviewed_at, expires_at, responded_at, created_at
- `threads`: id, listing_id, buyer_id, seller_id, last_message_at
- `messages`: id, thread_id, sender_id, body, flagged, flag_reason, flag_reviewed_at, hidden_at, read_at, created_at
- `audit_log`: id, actor_id, action, entity, entity_id, data, created_at (log every admin action and every CMS publish)
- `auth_limits`: key (action plus a SHA-256 of the email, trusted device plus email, or IP), count, window_start. Fixed window counters for the account rate limits.

## Security

- Check ownership on every read and write. A seller only sees their own drafts, a buyer only their own offers and threads, admins everything.
- Admin routes check the role on the server, not just in the UI.
- Require a verified email before submitting a listing, making an offer, or sending a message, through `canTransact(user)` (`src/lib/config.ts`). While email is off (no `RESEND_API_KEY`) nobody can verify, so `canTransact` lets everyone through; once email is on, verification is required again.
- The public `/app/api/auth/*` route serves only the GET endpoints browsers need (verify-email, the reset-password callback, get-session). Every sign in, sign up, reset and change goes through our form handlers and `callAuth()`, which applies the app rate limits.
- Suspended accounts are treated as signed out everywhere except the suspended notice.
- Validate every input with Zod on the server. Cap text lengths.
- httpOnly, secure session cookies. CSRF protection on all mutations (Better Auth covers its routes, cover the rest).
- Store the minimum. The CMS only ever gets the seller's display name and, if chosen, their phone.

## Design (glass, shared with the Webflow site)

The app and the public Webflow site use the same clean glass design (redesigned September 2026 at the owner's request). Copy the look, do not invent a new one. Tokens live in `:root` in `src/styles/global.css`; the header is `src/components/Header.astro`. If the Webflow site changes, update them to match.

**Colors**
- Ink `#15171B` (text), Muted `#5A5E66` (secondary text), Red `#D5001C` (primary buttons and key accents only), Red dark `#B00017` (hover), OK green `#1A6B3C` on `rgba(26,107,60,0.10)`.
- Page background `#EEF0F3` with a soft fixed backdrop (`--backdrop`: faint red and blue-grey radial glows over a `#F5F6F8` to `#E9ECF0` gradient). It sits on a fixed `body::before` layer, so it also works on phones where `background-attachment: fixed` is ignored.
- Hairlines inside glass (spec rows, dividers, table rows): `--hair` `rgba(21,23,27,0.08)`, solid, never dashed. Input and button borders: `--line` `rgba(21,23,27,0.12)`.

**Surfaces**
- Glass (`.card`, `.table`, `.glass`, panels, side columns, notices, the inbox): `rgba(255,255,255,0.62)`, `backdrop-filter: blur(20px) saturate(170%)`, 1px `rgba(255,255,255,0.75)` border, a soft inset highlight plus shadow (`--glass-shadow`). Fallback without backdrop-filter: `rgba(255,255,255,0.92)`.
- Strong glass (header, dropdown menus): `rgba(255,255,255,0.72)` with blur 24px. The header's blur sits on a `::before` layer so the account menu inside it can blur the page too.
- Dark glass (`.trust`, SafetyNote, the auth brand panel): `rgba(21,23,27,0.82)` with blur, white text, 16px radius.
- Radius: 16px cards and panels, 12px inputs and buttons (10px header buttons), 999px badges and pills.
- Photo placeholders: `--stripes` is now a soft neutral gradient `linear-gradient(135deg, #DDE1E7, #C9CED6)`.
- Clickable cards lift 2px on hover with a bigger shadow (off under reduced motion).

**Type**
- Archivo for UI and headings, IBM Plex Mono for prices, specs, small labels and badges (uppercase, letter spacing around 0.1em, 10 to 12px). Both load from Google Fonts.
- Page titles (`.page-title`): Archivo 800, 30px, letter-spacing -0.01em, sentence case (no longer uppercase). Section headings (`.section-title`, card h2): 18px 800, sentence case, no underline.

**Components**
- Header: sticky light strong-glass bar, 64px tall (`--header-h: 64px`), ink text, 1px bottom hairline `rgba(21,23,27,0.06)`. Roundel logo (white circle, 3px red ring, "PH"), wordmark "Petrol Head Market" in ink (900, uppercase, 17px, 0.06em) with the mono sub line "Enthusiast car classifieds" in muted. Logo links to `/` (the Webflow site). Glass secondary buttons (ink text) and the red Sell button, radius 10px; unread and to-do counts are red pills. The red promise strip under the header was removed at the owner's request.
- Buttons: primary red, white 700 text, 12px radius, 44px minimum height, shadow `0 6px 16px rgba(213,0,28,0.22)`, hover red dark. Secondary: white 0.7 glass with blur, 1px `rgba(21,23,27,0.12)` border, ink text. Link buttons stay plain.
- Inputs: `rgba(255,255,255,0.7)` with blur 12px, 1px `rgba(21,23,27,0.12)` border, 12px radius, 48px minimum height; focus is a red border plus a `0 0 0 4px rgba(213,0,28,0.15)` ring. Labels above, errors under the field in red.
- Badges: pills, `rgba(21,23,27,0.06)` background, no border, mono 10.5px uppercase 0.1em, muted text. Status badges keep their meaning as soft tints (OK green, red for changes requested and rejected).
- Spec rows: label left in muted mono, value right, solid hairline under each row. Facts grid (`.facts`): glass tiles split by hairlines.
- Admin tabs (`AdminNav`): a glass pill bar, the current tab white with a red underline.
- Frame: 1180px content, 20px gutters. Content plus side column = `.with-side` (1fr and 360px, 44px gap).

**Principles**
- Desktop first (changed from mobile first at the owner's request). Design each screen for a 1280 to 1440px desktop: use the width with multi-column layouts, side panels and tables. Write base CSS for desktop and use `max-width` media queries to adapt down. Every screen must still work at 360px with no horizontal scroll, because many sellers upload photos from a phone. The site header is sticky, so sticky side columns use `top: calc(var(--header-h) + 20px)` (the `--header-h` token in `global.css`, 64px), and a sticky column that can be taller than the screen scrolls on its own (`max-height` plus `overflow-y: auto`).
- Fast. Server render everything, keep client JS to the islands listed above, lazy load images.
- No em dashes or en dashes anywhere in user-facing text (pages, notices, emails).
- Sentence case, plain words. Buttons say exactly what happens: "Submit for review", "Send offer", "Accept offer", "Mark as sold".
- Empty states tell people what to do next.
- Visible keyboard focus. Respect reduced motion.

## Build order

Commit and push after each phase, confirm the Webflow Cloud deploy succeeds, then continue.

1. **Scaffold:** Astro on Webflow Cloud at `/app` with `webflow.json`, `wrangler.json` (DB, PHOTOS), Drizzle, base layout with the header and design tokens. Done when `/app` loads on the live site.
2. **Accounts:** Better Auth sign up, login, logout, verify email, reset password, profile, admin role from `ADMIN_EMAILS`, `/app/api/me`.
3. **Selling:** sell wizard with autosave, photo uploader, my garage, submit for review.
4. **Review:** admin queue and review screen, approve and publish to the CMS, request changes, reject, emails for each outcome, audit log.
5. **Buying:** offers, counters, accept flow with contact exchange, messaging, inbox, notifications, scam flags.
6. **Finish:** quick edits synced to the CMS, mark sold and relist, public photos API, error pages, final mobile pass.

## Working rules

- Read the linked Webflow docs before writing config. Do not guess config keys.
- Never commit secrets. Use `.dev.vars` locally (gitignored).
- Keep this file up to date when a decision changes.
- When something here is ambiguous, pick the simplest option that fits the rules above and note it in the commit message.
