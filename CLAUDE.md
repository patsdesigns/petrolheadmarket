# Petrol Head Market

Petrol Head Market (a working name: the real name is not decided yet, and it lives only in `src/lib/brand.ts`) is a curated classifieds marketplace for enthusiast cars. Private sellers list their own cars, every listing is reviewed by an admin before it goes live, and buyers make offers or message sellers. Fixed price plus offers. No auctions. No junk cars.

This repo is the whole site: the Lot (home page, search and filters), the car pages, and every account, selling, buying and admin page. It is one Astro app on Cloudflare Workers, served from the site root. (Until September 2026 the public pages were a Webflow site and this app ran under `/app` on Webflow Cloud, publishing approved cars into the Webflow CMS. That setup is gone; old `/app/...` links redirect.)

- Site: the Cloudflare Workers address (`https://petrolheadmarket.<subdomain>.workers.dev`) until a custom domain is added
- Deploys: Cloudflare Workers Builds, connected to the GitHub repo (production branch `claude/new-session-y1cmbc` while testing, `main` after the switch), builds with `npm run build` and deploys with `npm run deploy` (`wrangler deploy`, then `wrangler d1 migrations apply DB --remote`) on every push to the production branch

## Stack (decided)

- **Framework:** Astro (server output) with the `@astrojs/cloudflare` adapter on Cloudflare Workers
- **Interactive pieces:** small React islands only where needed (photo uploader, offer form, message thread) and small inline scripts (wizard autosave, the Lot's live filters, the car gallery, the header's live search, the save hearts, the theme toggle). Everything else is server rendered HTML that works without JavaScript.
- **Database:** Cloudflare D1 with Drizzle ORM and migrations (`drizzle/`)
- **Photo storage:** Cloudflare R2
- **Auth:** Better Auth (email and password, email verification, password reset), stored in D1
- **Email:** Resend
- **Validation:** Zod on every server input
- **Styling:** plain CSS with CSS custom properties (tokens below). No UI kit.
- **Payments:** none yet. Listing is free for now. Keep the data model ready for a listing fee later (see Lifecycle).

## Cloudflare rules

- `wrangler.json`: worker name `petrolheadmarket` (must match the Worker name in the dashboard, or Workers Builds fails), `nodejs_compat`, bindings `DB` (D1 `petrolheadmarket-db-west`, created in Western North America next to the owner and most buyers; the first database, `petrolheadmarket-db`, was auto-provisioned in Asia Pacific and every query crossed the Pacific, so the data was copied over on 2026-10-01 and the old one is only a backup; `migrations_dir: "drizzle"`) and `PHOTOS` (R2 bucket `petrolheadmarket-photos`). The D1 binding may have no `database_id`: Wrangler's automatic provisioning creates the database on the first deploy; once it exists, put its id in `wrangler.json` so `d1 migrations apply --remote` can find it. The adapter adds a `SESSION` KV binding automatically; we don't use Astro sessions (Better Auth keeps sessions in D1).
- Astro `base` is `/`. Every internal URL still goes through `src/lib/paths.ts` (`url()`, `photoUrl()`, `carUrl()`, `GARAGE`), so moving the site again only means changing those helpers.
- Astro 7 removed `Astro.locals.runtime.env`. Read bindings and variables with `import { env } from "cloudflare:workers"`.
- Variables and secrets are set in the Cloudflare dashboard (Worker, Settings, Variables and secrets, not the Build section), never committed. `keep_vars: true` in `wrangler.json` stops each deploy from wiping the dashboard variables (secrets are always kept). Local development uses `.dev.vars` (gitignored).
- Local run: `npm run build`, `npx wrangler d1 migrations apply DB --local`, `npx wrangler dev`.
- Workers report the date as 1970 while a module loads. Never compute dates (like the current year) at module scope.
- The client scripts in `.astro` files share type checking with the worker types, where `Element` is the HTMLRewriter element: use `document.getElementById(...) as HTMLSelectElement | null` rather than `querySelector<HTMLSelectElement>` when a DOM element type is needed. `npx astro check` must report 0 errors.

## Accounts (decided in phase 2)

- Better Auth lives in `src/lib/auth.ts`, mounted at `/api/auth/*`. `baseURL` is `PUBLIC_SITE_URL`. Cookies use the `phm` prefix, httpOnly, SameSite Lax, Secure on https.
- Better Auth tables are generated into `src/db/auth-schema.ts` by `npm run auth:schema` (config in `scripts/auth-schema.config.ts`). Never edit that file by hand.
- Pages are server rendered forms with no client JS. Form handlers call Better Auth through `callAuth()` in `src/lib/auth-call.ts`, which calls `auth.handler` in process (so Better Auth's origin checks apply) behind the app's own rate limits.
- The public route `src/pages/api/auth/[...all].ts` only serves the GET links browsers open: `/verify-email`, `/reset-password/:token` (forwards to `/reset-password`) and `/get-session`. Everything else, and every POST, is a 404. Sign in, sign up, reset, change email and change password only happen through our form handlers.
- Better Auth's own `rateLimit` is off, because behind a proxy the IP is often unknown (every visitor shared one bucket) and other IP headers can be spoofed. The app limiter (`src/lib/auth-limits.ts`, D1 table `auth_limits`, applied in `callAuth()`) keys by a SHA-256 of the email address: sign in 5 failed attempts per 10 minutes per email (only failures count, change password shares this bucket), sign up 3 per hour per email plus a site-wide backstop of `SIGNUP_HOURLY_MAX` (default 30) sign ups per hour in the fixed bucket `signup:global` (the IP is often unknown and, while email is off, a new account can offer and message at once, so without it one script could make endless throwaway accounts; a person who hits it sees "We are getting a lot of new accounts right now. Please try again in an hour."), and anything that emails a link (password reset, confirm email, change email) 3 per hour per email. A change of email counts against both the new address and the account's own address (`limitEmail`), so one account can't send confirmation emails to address after address. Every attempt takes its slot atomically before the call (one upsert that returns the new count, refused when over the limit), so parallel guesses can't all pass a check before any is counted; a sign in that succeeds gives its slot back, and so does a refused attempt. D1 errors fail open. A browser that signed in successfully gets a `phm_device` cookie (random id plus an HMAC of id and email with `BETTER_AUTH_SECRET`, one year, httpOnly); its sign ins for that email count in their own bucket, so strangers failing on purpose can't lock the owner out. When `cf-connecting-ip` is present it also keys by that IP, unless the address is one of Cloudflare's own ranges (a Worker proxy's egress, which would put every visitor in one bucket). The IP limits are a loose backstop until the live site confirms the header carries the visitor's own address (check the one-time `[headers] names` log plus a two-client probe): 100 failed sign ins per 10 minutes, 50 sign ups or link emails per hour. A limited password reset answers as if it worked, so it never reveals whether an account exists. `IP_HEADERS` is only `cf-connecting-ip`, which Cloudflare's edge sets and clients cannot. The middleware still logs the incoming header names (never values) once per worker.
- Names are 2 to 80 characters, checked in Better Auth's user create and update hooks too; the signup form also allows only letters, spaces, apostrophes, hyphens and periods (`NAME_PATTERN`).
- Display names are public (car pages, threads, emails), so `displayNameField` in `src/lib/profile.ts` (account page) allows 2 to 40 letters (any language), spaces, apostrophes, hyphens and periods, and refuses web addresses and whole words that sound like staff (petrol head, PHM, admin, support, staff, moderator, official, team, Webflow). `defaultDisplayName()` falls back to `Member` when the derived name fails it. Changing the display name re-syncs the seller's listings that are in the CMS (live, offer accepted, sold), one at a time; a failed sync keeps the save and the seller is told the site will update.
- The header cuts long display names short with an ellipsis (16ch, 9ch under 480px, where the action row may wrap) so 360px never scrolls sideways.
- Sessions last 30 days and refresh daily. The middleware calls `getSession` with `returnHeaders` and appends Better Auth's refreshed Set-Cookie headers to every response (unless the page set that cookie itself, like sign in or sign out), so active users stay signed in.
- Signing in does not require a verified email. Submitting a listing, making an offer, and sending a message or reply check `canTransact(user)` (in `src/lib/config.ts`) instead, never `user.emailVerified` directly.
- Email mode: `emailConfigured()` (`src/lib/config.ts`, re-exported from `email.ts`) is `Boolean(RESEND_API_KEY)`. `canTransact(user)` is `emailConfigured() ? user.emailVerified : true`, because while email is off nobody could ever confirm. With email off: signup goes straight to `next` for everyone (admin addresses too, so signing up never reveals the admin list), and verify-email, forgot-password and the Change email card on account say plainly that email is not switched on yet (no "send again" for anyone). Forgot password with email off links to our team (mailto `SUPPORT_EMAIL`, or the Contact the Team form) and has a collapsed "Site Owner" section ("Owner accounts can get a reset link written to the site log.") that writes a reset link to the log for `ADMIN_EMAILS` addresses only and answers the same for any address. The public page never names the variable or the Cloudflare Workers log. Account shows unconfirmed members the same collapsed "Site Owner" button (for their own address, same answer for everyone), because signed-in people can't open forgot-password. There is no notice on My Garage or account for unconfirmed admin addresses (it would reveal the admin list). People whose role is already admin do get to-do counts (`adminCounts()` in `src/lib/admin-counts.ts`, filled into `locals.adminCounts` by the middleware for admins on page requests): listings waiting for review, open contact requests and unreviewed flags, as a badge on the account menu and its "Review queue" link, on each `AdminNav` tab, and as an "Admin to do" notice on My Garage. With email off this is how the owner hears about new work. Seller, offer and admin notices only promise an email when `emailConfigured()`, and promises of message, offer, counter or decline emails also need the person's `email_notifications` ("Offer sent. Check Offers for the seller's reply." otherwise; the Live email drops its "We will email you" line for sellers who turned notifications off). Seller copy that depends on the lazy CMS retry says "shortly" ("It will be removed from the Lot shortly", "The public listing will update shortly"). The auth pages' brand panel says "Your email stays private until you agree a deal" (accepting shares emails, and Messages and phone publishes the number). No page may claim an email was sent when it was not. With email on, everything works as before and verification is required. verify-email says "We sent a link to X" only after a resend there or when signup added `sent=1`, which it does only if the confirmation email really went out (`verifySendFailures` in `auth.ts` records a failed or skipped send, since Better Auth swallows the error on sign up). Otherwise it says "Confirm your email to list a car, make offers and message sellers" with a "Send me a confirmation link" button. So when email is switched on after launch, existing unconfirmed members (who never got a link) are asked to send one, not told one was sent. Forgot password takes the same path for every address (rate limit, Better Auth, `sendEmail` decides what is logged), so response timing never shows which addresses are admins.
- `sendEmail()` returns `true` only when Resend accepted the email, `false` when email is off (it throws on a Resend error). It sets `reply_to` to `supportEmail()` when there is one. `supportEmail()` is the `SUPPORT_EMAIL` variable only, never an `ADMIN_EMAILS` address: those are sign in names, and publishing them (mailto links on public pages, reply_to) let anyone aim failed sign ins at the owner. Without `SUPPORT_EMAIL` there is no mailto and no "reply to this email" line.
- Logs never carry links, tokens, contact details or message bodies. drizzle-orm puts a failed query's bound params (session tokens, emails) in the error message, so catch blocks log `safeError(err)` from `src/lib/log.ts` (error names and messages with the params cut off and emails masked), never the error object, and the CMS audit rows use `errorMessage(err)`. Better Auth gets a `logger` in `createAuth()` that does the same. With email off, `sendEmail` logs only the recipient's domain and the subject, except for the password reset to an `ADMIN_EMAILS` address (`adminBootstrap`, set only by `sendResetPassword`), which is logged in full. Confirmation links are never logged, not even for admin addresses: a stranger may have signed up first with the owner's address, and opening that link would confirm the stranger's account (and its password) as admin. Owner bootstrap while email is off: sign up (or not, if someone else already did), then use "Site Owner" on forgot-password (or on account while signed in) to get a reset link in the Cloudflare Workers log, and choose a password. `emailAndPassword.onPasswordReset` in `src/lib/auth.ts` sets `emailVerified` on any finished reset (the link proves the inbox, or the log, which only gets admin links), and `revokeSessionsOnPasswordReset` signs every session out, so a squatter loses the password and every session in the same step. With email on, the confirmation email says to ignore it if you did not create the account; an owner who finds his address taken uses forgot-password the same way.
- Contact the Team (`/contact`, public, `src/lib/contact.ts`, D1 table `contact_requests`): topic (a change to my listing, getting into my account, my suspended account, something else), name and email when signed out (the account's when signed in), a message of 20 to 2,000 characters and a hidden honeypot field. Limited to 3 per hour per email (and per IP when Cloudflare gives one) in `auth_limits` (action `contact`), plus 60 per hour for the whole site. Admins get an email (domain only in the log while email is off) and read messages on `/admin/contact` (Contact tab): Reply by email opens the admin's own mail app, Mark as handled is audited (`contact_handled`, entity `contact`). `contactHref()` gives a mailto to `SUPPORT_EMAIL` when set and the form otherwise, so every "contact our team" link works with no setup: forgot-password, `/suspended`, Quick changes and the Questions line on rejected or withdrawn listings. Email lines that invite questions use `questionsLine()` (reply to this email with `SUPPORT_EMAIL`, a link to the form without it).
- While email is off, an admin can press "Get a reset link" on `/admin/users` for a member who is locked out (not for admin addresses or suspended accounts). `adminResetLink()` in `src/lib/admin-users.ts` calls Better Auth in process with a one-time id in the `x-phm-reset-capture` header, and `sendResetPassword` hands that link back instead of sending or logging it (the public auth route serves no POSTs and `callAuth()` never forwards that header). The admin sees the link with an "Email it to them" mailto and sends it from his own inbox to the account's address only. Audited as `reset_link_by_admin`.
- `src/middleware.ts` loads the session and profile, sends signed out people to `/login?next=...`, returns the 404 page for non admins on `/admin*`, and rejects cross-origin POSTs (CSRF). Astro's own `checkOrigin` is off because the middleware does its own check, which accepts both `PUBLIC_SITE_URL` and the request's own origin (so a workers.dev address and a custom domain both work). After every response it reads any request body the route left unread (an early error or redirect on an upload), because an unread body on a kept-alive connection broke the next request in the dev proxy.
- Suspension (`profiles.suspended_at`, set from `/admin/users` or "Suspend sender" on `/admin/flags`, logic in `src/lib/admin-users.ts`): suspending deletes the person's sessions, moves their submitted, approved, live and offer accepted listings to `withdrawn` and unpublishes the CMS items (`unpublishListing()` in `cms.ts`, `DELETE .../items/{itemId}/live`; failures are audited as `cms_unpublish_failed`), closes offers on those listings exactly like a take down (`closeOffersOnTakeDown()` in `take-down.ts`: pending offers are declined, an accepted deal becomes `ended`, each buyer is emailed once), sets their `review_notes` to "Taken down because the account was suspended." (so an admin-only approve note is never shown to the seller), withdraws their own pending offers, hides their flagged messages nobody has read yet (`messages.hidden_at`) and marks their flagged messages reviewed. Better Auth's `session.create.before` hook refuses sign in for a suspended account (code `ACCOUNT_SUSPENDED`), and login sends them to `/suspended`. If a suspended session still arrives, the middleware treats it as signed out: GETs to app pages go to `/suspended`, other mutations get 403, only `/logout` works. `sendMessage()` and `createOffer()` refuse suspended users too. Unsuspending only clears the flag; taken down listings stay down. Admins (role admin, which needs a confirmed `ADMIN_EMAILS` address) and the acting admin can't be suspended. An unconfirmed account on an admin address (someone who signed up first with the owner's address) is not an admin and can be suspended; the Users page marks it "Owner address, not confirmed. Not an admin." and points to the Site Owner reset, which confirms the address and signs the squatter out, and `ensureProfile()` clears a suspension once an address becomes admin. Every action is audited (`user_suspended`, `user_unsuspended`, `email_confirmed_by_admin`, entity `user`).
- Admins can "Mark email as confirmed" on `/admin/users` (sets `user.emailVerified`), except for `ADMIN_EMAILS` addresses, which are confirmed only by a password reset (see the owner bootstrap above) because a confirmed admin address becomes an admin.
- The admin role needs a proven email: `roleFor()` in `src/lib/profile.ts` gives `admin` only when the email is in `ADMIN_EMAILS` AND `user.emailVerified` is true. The middleware syncs the stored role on every request (it writes only when the role changes), so ADMIN_EMAILS changes apply at once.

## Selling (decided in phase 3)

- Listing rules live in `src/lib/listing-rules.ts`: per field Zod rules for draft saves, the five wizard steps, and `checklist()`, which the wizard shows and the server enforces on submit. Options and their labels are in `src/lib/listing-options.ts`.
- Drafts save leniently: valid fields are saved even when others have errors, so autosave never loses work. Required fields are only enforced at submit.
- Autosave is a small inline script on the wizard page (not a React island). It posts the step form with `X-Autosave: 1` (`redirect: "manual"`) a moment after typing stops, before following any link on the page (it waits for the save, and stays on the page if the save failed or some fields were not saved; a second click leaves), and with `keepalive` on `pagehide` and when the page is hidden. It says "Draft saved" only when the server answered JSON `{ ok: true }` with no field errors; otherwise it names the fields that did not save ("Saved, except Price, VIN") and shows each error under its field, or says why nothing was saved.
- Autosave requests always get JSON, never a redirect: 401 `signed_out` from the middleware when the session is gone, 403 `suspended`, 404 `not_found`, and 409 `not_editable` when the listing left draft (for example submitted in another tab; `saveListingFields()` returns false when no editable row matched). A normal step post with errors (Back included) shows the step again with the posted values and errors.
- `/sell` shows open drafts, each with Continue and Delete, and "Start a new listing" reuses the newest empty draft (no year, make, model or photos) before creating one (max 10 open drafts). The wizard is `/listings/:id/edit?step=car|history|photos|price|review` and has "Delete this draft" in its side column.
- A seller can move a submitted listing back to draft, and delete drafts, rejected and withdrawn listings (photos are removed from R2 too). Deletes post `intent=delete` to `/listings/:id` (`back=sell` returns to `/sell`). The notice matches what was deleted (see Review and publishing). Rejected and withdrawn listings also get a Start a new listing button.
- Year, make and model are dropdowns on the wizard's first step (`src/components/CarPicker.astro`, list in `src/lib/car-catalog.ts`): years from next model year down to 1920, a curated list of enthusiast makes, and each make's models written the way enthusiasts say them, each with the model years it was built (`"Integra|1986-2001,2023-"`, no end year means still built). Makes and models are filtered to the chosen year and models to the chosen make (a 1993 Porsche offers no Cayenne); the years are a guide for the lists, never a server rule, and a saved make or model outside its year stays offered so nothing is dropped. Each dropdown has an "Other" choice (value `__other`) that shows a text box (`year_other`, `make_other`, `model_other`, shown with CSS `:has`, so it works without JavaScript); `resolveCarPicks()` turns the posted pick back into the plain `year`, `make` and `model` fields before the listing rules run. A small script refills the makes and models when the year or make changes. A saved value that is not in the list shows as Other with the text filled in. The admin edit form keeps plain text fields.
- Trim (`listings.trim`, optional, up to 40 characters, migration 0011) is a text field under the car picker on the wizard's first step and in the admin edit form, and shows in the car page facts.
- Title is stored as `title_status` (clean, rebuilt, salvage, lien, none) plus `title_state`, and shows as "Clean, CA" on the car page. "No title (bill of sale)" (`none`) needs no state: the checklist skips it, a saved state is cleared, and the CMS gets `NO TITLE`. Location is `location_city` plus `location_state`.
- Photo API: `POST /api/listings/:id/photos` (raw JPEG body, `?w=&h=`), `PUT` the same path with `{ order: [ids] }`, `DELETE /api/listings/:id/photos/:photoId`. Only while the listing is a draft or has changes requested.
- Workers report the date as 1970 while a module loads. Never compute dates (like the current year) at module scope.
- When a listing is submitted, everyone in `ADMIN_EMAILS` gets an email.

## Review and publishing (decided in phase 4, changed when the site moved off Webflow)

- Publishing is in the app (`publishListing()` in `src/lib/cms.ts`): it gives an approved listing its public slug and moves it to `live` (conditional on it still being `approved`, so a second click or a take down in between can't win twice), audits `publish`, and emails the seller with a link to `/cars/{slug}`. The Lot and car pages read D1 directly, so there is nothing to copy or keep in sync. Approve on the review screen publishes at once ("Approve and publish"); an `approved` listing is only a brief in-between state (a leftover shows "Publish now" and "Move back to review").
- Slugs: `{year}-{make}-{model}` slugified, checked against the DB, with a 4 character suffix on a clash; kept for good once set.
- Approve requires the checklist to pass (admins can fix fields with Edit listing first). Request changes and Reject require a note of at least 10 characters. After Request changes or Reject the queue confirms it. The note hint says approve notes are only seen by admins.
- Taking down (`src/lib/take-down.ts`): a seller can Take down listing on a live listing; an admin can Take down any listing on the Lot (live, offer accepted, sold) with a note of at least 10 characters that the seller sees and is emailed. Either way the listing becomes `withdrawn` (conditional update), which takes it off the Lot and 404s its car page at once, pending offers are declined and an accepted deal becomes `ended`, each buyer is emailed once, and `take_down` is audited. The slug is kept. Messages on withdrawn and rejected listings are closed (`sendMessage` refuses and the thread page hides the reply box). Flagged messages link to the listing's review screen.
- Sellers can delete drafts, rejected and withdrawn listings (`deleteListing`, photos removed from R2). A listing with no offers or threads is deleted. One with offers or threads is soft deleted (`listings.deleted_at`, photos and photo rows removed, the seller no longer sees it) so buyers keep their offers and threads and admins keep flagged messages as evidence; admin pages mark it "Deleted by the seller". The notice says "Draft deleted.", "Listing deleted, with its photos." or "Listing and photos deleted. Your conversations with buyers stay in your inbox." to match.
- Admin edits show on the car page at once. A save with field errors still keeps the valid fields. Admins can also delete a photo. `/admin/listings` finds any listing by status and by car, slug, pasted public link (`/cars/{slug}`, or an old `/listings/{slug}`), seller name, email or id, 50 per page.
- Every admin action and publish (and failures, with the error) goes to `audit_log`, shown as History on the review screen.
- Legacy columns from the Webflow days stay in the schema but are unused: `cms_item_id`, `cms_sync_pending`, `cms_attempted_at`, `publishing_at`, and the `job_runs` table. Do not build on them.
- `RESEND_API_BASE` exists only to point tests at a fake Resend. Never set it in Cloudflare.

## Buying (decided in phase 5)

- `/offer` and `/message` look the listing up by its slug, and only for live, offer accepted or sold listings. They look it up before asking anyone to sign in: the middleware lets signed-out GET and HEAD requests to these two paths through (`PAGE_CHECKS_AUTH`; POSTs still go to login), and each page redirects to `/login?next=...` only when the listing is real. A slug the app does not have shows `src/components/NotOnApp.astro`: "We couldn't find that car" with Back to the Lot, for signed-in and signed-out visitors alike, with status 200 (a 404 could be swapped for the host's generic error page). A slug the app has but that is no longer public says the car is no longer on the Lot. With no `listing` parameter, a same-origin Referer of `/cars/{slug}` redirects to the right URL, otherwise the page says "Pick a car on the Lot first". Slugs are checked against `^[a-z0-9][a-z0-9-]*$` before lookup or linking.
- Offers (`src/lib/offers.ts`): a counter is a new row with `made_by = seller` and `parent_offer_id` pointing at the buyer's offer, which becomes `countered`. Sellers counter buyer offers, buyers accept or decline counters, buyers can withdraw their own open offer. A counter must be above the buyer's offer and at most the asking price. Offers over double the asking price are refused as a typo guard.
- Expiry has no cron: pending offers past `expires_at` are marked `expired` whenever offers are read.
- Accepting first takes the offer with a conditional update (still `pending` and not expired), then claims the listing with a conditional update (`live` to `offer_accepted`) so two accepts can't both win; if the claim fails the offer becomes `declined`, never back to pending. Decline and withdraw also check that their conditional update changed a row, and report "This offer is no longer open." without an email otherwise. Accepting declines every other open offer with an email, and emails both sides each other's contact details. The seller's phone is shared only when the listing uses Messages and phone. Contact details are also shown on `/offers` for accepted deals. Accept offer asks for confirmation, worded for the seller (other offers are declined) or the buyer accepting a counter.
- Emails that close an offer say "your $X offer", or "the seller's $X counter offer" when the closed row is a counter (`offerPhrase()` in `offers.ts`).
- `offers.status` also has `ended`: the seller put the car back on sale (or the listing was taken down) after accepting. `/offers` says the seller called off the deal and put the car back on sale (whatever happened to the car since: live, another offer accepted, or sold), and says the car was taken off the site only when the listing is withdrawn, rejected or deleted. Never that the buyer withdrew. A soft-deleted listing shows its title as plain text with a Deleted badge (the seller page is gone). No SQL migration was needed for it (text enum, no CHECK constraint).
- `/offers` shows Make a new offer to a buyer whose offer is over while the car is live and takes offers, Message seller to buyers, and Message buyer to sellers. Message buyer opens `/inbox/new?offer={id}` (seller only, 404 otherwise), which redirects to the thread if one exists and otherwise shows a compose form; the thread is created with the first message (`sendMessage({ offerId })`), never on a GET.
- Rate limits: 10 offers per buyer per hour, 30 messages per user per 10 minutes.
- Messages: the thread page is a React island that polls every 15 seconds while visible. Only the first unread message in a burst sends an email. Emails never include addresses. Admins can open any thread read only (from the flags page), and see hidden messages there marked "Hidden by an admin". The new message email never quotes a flagged message ("X sent you a message. Read it on Petrol Head Market."). On `/admin/flags` an admin can "Hide message" (sets `messages.hidden_at` and marks it reviewed, audited as `message_hidden`): hidden messages are left out of the thread, the inbox preview and unread counts for both members.
- Scam filter (`scamCheck` in `src/lib/messaging.ts`) flags wire transfers, Western Union or MoneyGram, gift cards, shipping agents, escrow, crypto, WhatsApp or Telegram, "text me at", email addresses, phone numbers and outside links. Flagged messages are still delivered. Offer and counter notes go through the same filter (`offers.flagged`, `flag_reason`, `flag_reviewed_at`): they are still delivered and shown, but the email leaves a flagged note out ("They added a note. Read it on Petrol Head Market.") and `/offers` adds a safety line under it. Flagged notes are listed on `/admin/flags` under Offer notes with Mark reviewed (audited as `flag_reviewed`, entity `offer`) and Suspend sender. Suspending someone marks their flagged offer notes reviewed too.
- Inbox and garage queries never bind an id per row: `inboxFor()` is one statement with a join for the other person's name and correlated subqueries for the last message and unread count, and `listForUser()` joins photos to listings by owner. D1 refuses statements with more than 100 bound parameters, so any `inArray` over a list that is not strictly bounded goes through `chunks()` in `src/db/client.ts` (groups of 90).
- Every date and time the app shows is formatted in `America/Los_Angeles` (admin Contact, Users, Listings and History included). Thread times in the message island use it too, like the inbox list, so the server render and hydration match. Opening a thread recounts the header's unread badge after marking it read.
- Email notification setting (`profiles.email_notifications`) covers new offers, counters, declines and messages. Accepted deal emails always go out.

## Finish (decided in phase 6)

- Seller actions live in `src/lib/seller-actions.ts` and on `/listings/:id`: quick changes (price, accepts offers, contact method, phone) for live and offer accepted listings, Mark as sold (from live or offer accepted, expires stale offers first, then closes open offers with an email that respects the buyer's notification setting), and Put back on sale (offer accepted to live, the accepted offer becomes `ended` and the buyer is always emailed, like accepted deal emails). Changes show on the car page and the Lot at once. Seller copy never claims "we have been told".
- `src/pages/404.astro` and `src/pages/500.astro` are the error pages. Signed out visitors to unknown account paths are sent to login first. The 500 page never claims work was saved.
- Links into My Garage from emails and error pages go to `/login?next=/garage`. Signed-in people are forwarded from login to `next`. Other deep links already go through login with `next`.
- Sellers ask for changes beyond the quick edits (and ask about rejections) through `contactHref()` on `/listings/:id`: a mailto to `SUPPORT_EMAIL` when set, otherwise the Contact the Team form with the listing attached. Never by "replying to an email". Without `SUPPORT_EMAIL` every page still has a working contact route (the form).
- Admin notices after Approve and Take down only promise the seller an email when `emailConfigured()`; otherwise they say the seller sees it in My Garage or on their listing page.

## The Lot and car pages (decided when the site moved off Webflow)

- Speed: the middleware runs its per-request queries (profile, unread count, admin counts) in parallel, and pages read what they need with `Promise.all` where the queries do not depend on each other. `Base.astro` has a `speculationrules` script that prefetches a same-site page when the pointer rests on its link (`eagerness: moderate`), never `/logout`, `/api/*`, `/photos/*` or `/inbox/*` (opening a thread marks it read); a link can opt out with `data-no-prefetch`. Page changes cross-fade with cross-document view transitions (`@view-transition` in `global.css`, off under reduced motion).
- Breadcrumbs (`src/components/Crumbs.astro`, a glass pill with slash separators) replace the old back links: car pages (The Lot / make / model / car, with schema.org `BreadcrumbList`), the offer and message pages (The Lot / car / page), the seller's listing and wizard, Inbox threads, the review screen (Admin / Listings / car), and My Garage pages (Offers, Account Settings, Inbox, Sell Your Car, Saved Cars). No arrow characters (←, →, ▾, ✕, ✓, ★) anywhere: carets, closes, checks and stars are small inline SVGs or CSS.
- The category menu (`.cats` in `Header.astro`, list in `src/lib/nav.ts`) is a slim row under the header bar that scrolls away with the page: All Cars, Manuals, Classics (to 1989), Modern Classics (1990 to 2009), Under $30K, Convertibles (convertible and targa), Wagons, Trucks and SUVs, and How It Works on the right (hidden under 720px, where the row scrolls sideways; How It Works is also in the footer). `activeShortcut()` marks the shortcut whose filters match the Lot exactly (search, sort and page aside).
- `/how-it-works` (public, indexable): selling and buying in four steps each, What We Check (the review checklist), Buy Safely, and Questions.
- Live search: typing two or more characters in the header search shows a glass dropdown (a combobox: arrow keys, Enter, Escape) with up to four make and model groups and the five newest matching cars, plus "See all N results". It reads `GET /api/search?q=` (public, `Cache-Control: public, max-age=30`, `searchLot()` in `lot.ts`, the same word-start matching as the Lot). The dropdown is built with `textContent` only.
- Search lives in the site header (`src/components/Header.astro`) on every page: a glass pill in the middle of the bar (its own row under 860px) with the placeholder "Search by make, model, year, etc.". On the Lot its input and button belong to the Lot form (`form="lot"`), so a search keeps the filters that are set; on other pages it opens the Lot with `?q=`. "/" focuses it anywhere. The header stops being sticky under 720px so it does not take up the phone screen.
- The Lot is `/` (`src/pages/index.astro`, logic in `src/lib/lot.ts`), laid out like the big auction sites (redesigned at the owner's request): a row of glass filter chips (Year From, Year To, Make, Model, Trim, More Filters), each a native select that shows its choice; a chip with a value gets an ink outline. Model is off until a make is picked and Trim until a model is picked; a new make drops the model and trim, a new model drops the trim; makes, models and trims list only what the other filters leave. Exterior color (checkboxes in More filters) groups the seller's free text color into families (`COLORS` and `colorFamily()` in `lot.ts`: "Guards Red" is Red, "Light Ivory" is White, anything unknown is Other). More filters opens a glass panel under the row (a bottom sheet on phones, where the chips scroll sideways in one row) with typed Price and Miles ranges (From and To, digits only, "$" and commas are ignored, a reversed range is swapped) and Manual only, drivetrain, body, exterior color, seller type and records on file with counts, applied with Show results. Clear filters keeps the search. The plain Lot (no search, filter or sort, at least 4 cars) leads with the newest car as a big photo with a glass panel over it ("Newest arrival"). Below: the heading and count, a removable search pill, a sort menu (newest listings, price both ways, lowest miles, year both ways) and 24 cars at first, 3 across, with "Showing X of Y cars" and a Show more button under the grid instead of pages (`?page=n` renders the first n times 24 cars, so the address always shows what was loaded and it works without JavaScript; the script fetches the next address, appends only the new cards and updates the address). Cards are open cards (photo with a glass price tag, "Just listed" for 3 days, photo count, then title, headline, miles, transmission, location and badges). Counts ignore their own group; makes also ignore the model. The Lot without reloads: with JavaScript, the filter form, the sort, Clear filters, the search pill and the category menu fetch the new address and swap the form's contents in place (inside a view transition), push the address to the history (Back and Forward reload the matching results), and keep the header search box in step. While results load the grid dims and photos shimmer; photos fade in once loaded. The filter row is sticky under the header (`top: calc(var(--header-h) + 10px)`, `top: 0` under 720px where the header is static) and gets a glass strip once it sticks (`bar-stuck`, from an IntersectionObserver on `.lot-sentinel`). Cards carry their first five photos (`LotCard.more`, `CARD_PHOTOS`): on a mouse, moving across a card's photo flips through them with thin segments at the bottom. Cards are `src/components/CarCard.astro`, shared with Saved Cars. It is a plain GET form (`q`, `ymin`, `ymax`, `make`, `model`, `trim`, `color` (repeatable), `price_min`, `price_max`, `miles_min`, `miles_max`, `manual=1`, `drive`, `body`, `seller`, `records=1`, `sort`, `page`), so it works without JavaScript (an Apply button shows) and every search is a shareable link; a small script applies chips on change, keeps the address short, and closes More filters on Escape, a click outside or the backdrop.
- Saved cars (`src/lib/saved.ts`, D1 table `saved_cars`, migration 0012): a heart (`src/components/SaveButton.astro`) on every Lot card, the newest arrival and the car page's buy box ("Save car" / "Saved"). It is a form that posts to `/saved` (`listing`, `save` 1 or 0, `next` through `safeNext()`), so it works without JavaScript; the script sends `POST /api/saved` `{ listingId, save }` instead and flips the heart at once (401 `signed_out` sends people to sign in, 409 when the car is not public). Signed-out visitors get a heart that links to sign in. Only cars with a public page can be saved (live, offer accepted, sold, not deleted), up to `MAX_SAVED` (200) per member. `/saved` (Saved Cars, in the account menu) lists them newest saved first; sold cars stay with a Sold flag, and cars that left the site drop off. Deleting a listing or an account removes its rows (cascade).
- Demo cars (`src/lib/demo-cars.ts`): the Demo cars card at the bottom of `/admin` adds 25 made-up live cars (two with an offer accepted) from a demo seller (`user.id` `demo-seller`, display name "Demo seller", no password, cannot sign in), with six drawn photos each. The drawings ship with the site in `public/demo-cars/`; the photo rows point at them with keys starting `demo-cars/`, which `photoUrl()` serves as static files (nothing is copied into R2), so adding them is one D1 batch. Every description ends "This is a demo listing for trying out the site. It is not a real car for sale." Remove demo cars (with a confirm step) deletes the demo seller, which cascades to the listings, photo rows, offers and threads. Both are audited (`demo_cars_added`, `demo_cars_removed`). Remove them before the site opens to the public.
- The Lot shows `live` and `offer_accepted` listings that are not deleted; sold cars leave the Lot but keep their page. `queryLot()` reads the Lot's filter columns in one query, filters, counts and sorts on the server, and loads photos only for the cars on the current page. Search matches word starts across year, make, model, trim, exterior color, city, state, body, drivetrain, "manual" and seller type. Empty states: "No cars on the Lot yet" (with Sell your car) and "No cars match ..." (with Clear search and filters).
- A car's page is `/cars/{slug}` (`src/pages/cars/[slug].astro`) for live, offer accepted and sold listings (404 otherwise): every photo with thumbnails, arrows, keyboard, swipe and a full screen viewer; a facts grid; the story, highlights, known issues, modifications and service history (sellers' plain text turned into escaped HTML by `src/lib/richtext.ts`); and the buy box: asking price, Open to offers, Make an offer (live and accepting offers), Message the seller (not when sold), the phone only for Messages and phone, the seller's display name, and a Buy safely note. The seller sees Manage this listing instead. Phones get a fixed price bar with the main action. Sold cars say so and have no buttons.
- `/offer` and `/message` look the car up by slug before asking anyone to sign in (see Buying). An unknown slug says "We couldn't find that car"; a car no longer on the Lot says so.
- Public pages (the Lot without a search or filter, and car pages that are not sold) are indexable with a canonical link, Open Graph tags and, on car pages, schema.org `Car` data. Every other page is `noindex`.
- The site name, the logo initials and the header tagline are `SITE_NAME`, `SITE_INITIALS` and `SITE_TAGLINE` in `src/lib/brand.ts`. Never write the name out anywhere else.

## Environment variables

Set in the Cloudflare dashboard (Worker, Settings, Variables and secrets).

| Name | Secret | Purpose |
|---|---|---|
| `BETTER_AUTH_SECRET` | yes | Auth signing secret. Changing it signs everyone out. |
| `RESEND_API_KEY` | yes | Transactional email. Its presence switches email mode on (`emailConfigured()`): verification becomes required and email-only flows (reset, change email) appear. |
| `EMAIL_FROM` | no | Sender address |
| `ADMIN_EMAILS` | no | Comma separated emails that get the admin role once the address is confirmed (synced on every request) |
| `SUPPORT_EMAIL` | no | Public contact address for mailto links and email reply_to. Use a shared inbox, not an `ADMIN_EMAILS` sign in address. Without it, contact links go to the Contact the Team form (`/contact`). |
| `SIGNUP_HOURLY_MAX` | no | Optional. Sign ups allowed per hour for the whole site, default 30. |
| `PUBLIC_SITE_URL` | no | The address people use (the workers.dev address, later the custom domain). Also the auth base URL, so it must match. |

## Screens

**Public**
- `/` : the Lot. `/cars/{slug}` : a car's page. `/how-it-works` : How It Works.
- `/login`, `/signup`, `/forgot-password`, `/reset-password`, `/verify-email`, `/contact` (Contact the Team, signed in or not)
- `/suspended` : "Your account is suspended" notice (sign out, and a link to our team: mailto `SUPPORT_EMAIL` or the Contact the Team form)
- `/offer?listing={slug}` and `/message?listing={slug}` are public until a real car needs an account: signed out visitors of a real car are sent to login and returned to the same URL afterward.

**Signed in**
- `/garage` : My Garage (dashboard). Listings with status, offers needing a response, unread messages.
- `/saved` : Saved Cars (the hearts), newest saved first
- `/sell` : New listing wizard. Autosaves as a draft. Steps: The car, Condition and history, Photos, Price and contact, Review and submit.
- `/listings/:id` : Seller view of one listing (status, reviewer notes, quick edits, mark sold, take down, delete when draft, rejected or withdrawn)
- `/listings/:id/edit` : Edit a draft or a listing with changes requested
- `/offer?listing={slug}` : Make an offer (shows the car summary and asking price)
- `/offers` : Offers sent and received
- `/inbox/new?offer={id}` : A seller writes to a buyer who made an offer (the thread is created with the first message)
- `/message?listing={slug}` : Opens or creates the thread with that seller
- `/inbox` and `/inbox/:threadId` : Messages
- `/account` : Display name, phone, email, password, notification settings

**Admin (role admin only)**
- `/admin` : Review queue, oldest submitted first, and the Demo cars card (add or remove the 25 demo cars)
- `/admin/listings/:id` : Full review screen with the checklist, photo grid, inline edit, notes to seller, and three actions: Approve and publish, Request changes, Reject. Listings on the Lot add Take down
- `/admin/listings` : Every listing, newest change first, 50 per page, filter by status, search by car, slug, pasted public link, seller name, email or id
- `/admin/users` : Search accounts by email or name; shows confirmed, admin, suspended and listing counts; actions Mark email as confirmed, Suspend, Unsuspend
- `/admin/flags` : Messages and offer notes flagged by the scam filter, with Mark reviewed, Hide message (messages only) and Suspend sender
- `/admin/contact` : Messages from the Contact the Team form, with Reply by email and Mark as handled
- Every admin page starts with `src/components/AdminNav.astro` (Review queue, Listings, Users, Flagged, Contact).

**API**
- `/api/auth/*` : Better Auth handler (only the GET links browsers open; see Accounts)
- `GET /api/me` : `{ signedIn, displayName, isAdmin, unreadCount }` with `Cache-Control: private, no-store` and `Vary: Cookie`. Set `displayName` with textContent only.
- `GET /photos/{key}` : Public photo serving from R2
- `GET /api/search?q=` : the header's live search (public)
- `POST /api/saved` : save or unsave a car (signed in)
- Everything else as needed by the screens

**Old addresses**
- Anything under `/app/...` (the Webflow Cloud days) 301 redirects to the same path without `/app`, and `/app` itself to `/garage`. `safeNext()` strips `/app` from sign in `next` links.

## Listing lifecycle

Statuses in the app database:

`draft` → `submitted` → `changes_requested` (back to seller) → `submitted` → `approved` → `live` → `offer_accepted` → `sold`

Also: `rejected`, `withdrawn`. Reserve `awaiting_payment` between `draft` and `submitted` for the future listing fee, but do not use it yet.

- Only `live` and `offer_accepted` listings are on the Lot; `live`, `offer_accepted` and `sold` have a car page.
- `approved` is a brief in-between state: Approve publishes at once (see Review and publishing).
- `withdrawn` means taken down by the seller or an admin (or the seller was suspended). It leaves the Lot and its car page 404s.
- Sold listings keep their car page, marked Sold, and leave the Lot.
- Edits on a live listing: price, accepts offers, contact method, and phone show at once. Any other change requires the admin to make it (keep v1 simple).

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
- On accept: listing goes to `offer_accepted` (the Lot card and car page say so), all other open offers on that listing are declined automatically with a notification, and both sides get each other's email (and phone if the seller shared it) by email and in the app.
- Seller can later mark Sold, or relist (back to `live`) if the deal falls through.

## Messaging

- One thread per listing per buyer. Messaging is always available, regardless of contact method.
- Email notification for new messages with a short preview and a link back to the thread. Never reveal email addresses in threads.
- Show a short safety note in every thread: never wire money or pay before seeing the car and title.
- Flag messages containing scam patterns (wire transfer, Western Union, gift cards, shipping agent, escrow links, requests to move off platform) into `/admin/flags`. Do not block them. An admin can hide a message or suspend the sender from there.
- Rate limit messages and offers per user.

## Seller contact method

Seller picks one:
- **Messages only** (default)
- **Messages and phone**: the phone number is shown on the car page

Only show the phone when the seller chose Messages and phone.

## Photos

- Resize in the browser before upload: long edge 2400px, JPEG quality around 0.85. Resizing through canvas also strips EXIF, which removes GPS location. This matters for seller privacy.
- Upload straight to R2 through the app, show progress, allow drag to reorder, and set the main photo.
- Up to 80 photos per listing.
- Keys: `listings/{listingId}/{photoId}.jpg` (the demo cars' rows use `demo-cars/car-NN.jpg`, static files, see The Lot and car pages)
- Serve publicly from `/photos/{key}`.
- Suggested shot list shown in the uploader: front three quarter, rear three quarter, both sides, interior front and rear, dash and odometer, engine bay, underside, wheels and tires, flaws up close, title (with personal info covered).

## Data model (D1)

Better Auth's own tables, plus:
- `profiles`: user_id, display_name, phone, role (user or admin), email_notifications, suspended_at, created_at
- `listings`: id, user_id, status, every listing field above, slug, cms_item_id, publishing_at, cms_sync_pending and cms_attempted_at (legacy, unused), deleted_at (soft delete by the seller), review_notes, reviewer_id, submitted_at, reviewed_at, published_at, sold_at, created_at, updated_at
- `job_runs`: name, ran_at (legacy, from the Webflow CMS retry; unused)
- `saved_cars`: user_id, listing_id, created_at (primary key user and listing)
- `contact_requests`: id, user_id (null when signed out), name, email, topic, listing_id, body, handled_at, handled_by, created_at (Contact the Team form)
- `listing_photos`: id, listing_id, r2_key, position, width, height, created_at
- `offers`: id, listing_id, buyer_id, amount, message, status (pending, countered, accepted, declined, expired, withdrawn, ended), parent_offer_id, flagged, flag_reason, flag_reviewed_at, expires_at, responded_at, created_at
- `threads`: id, listing_id, buyer_id, seller_id, last_message_at
- `messages`: id, thread_id, sender_id, body, flagged, flag_reason, flag_reviewed_at, hidden_at, read_at, created_at
- `audit_log`: id, actor_id, action, entity, entity_id, data, created_at (log every admin action and every publish)
- `auth_limits`: key (action plus a SHA-256 of the email, trusted device plus email, or IP), count, window_start. Fixed window counters for the account rate limits.

## Security

- Check ownership on every read and write. A seller only sees their own drafts, a buyer only their own offers and threads, admins everything.
- Admin routes check the role on the server, not just in the UI.
- Require a verified email before submitting a listing, making an offer, or sending a message, through `canTransact(user)` (`src/lib/config.ts`). While email is off (no `RESEND_API_KEY`) nobody can verify, so `canTransact` lets everyone through; once email is on, verification is required again.
- The public `/api/auth/*` route serves only the GET endpoints browsers need (verify-email, the reset-password callback, get-session). Every sign in, sign up, reset and change goes through our form handlers and `callAuth()`, which applies the app rate limits.
- Suspended accounts are treated as signed out everywhere except the suspended notice.
- Validate every input with Zod on the server. Cap text lengths.
- httpOnly, secure session cookies. CSRF protection on all mutations (Better Auth covers its routes, cover the rest).
- Store the minimum. Public pages only ever show the seller's display name and, if chosen, their phone.

## Design (glass)

The whole site uses one clean glass design (redesigned September 2026 at the owner's request). Copy the look, do not invent a new one. Tokens live in `:root` in `src/styles/global.css`; the header is `src/components/Header.astro`; the Lot and car pages add `src/styles/lot.css` and `src/styles/car.css`.

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
- Barlow for text (`--font-ui`), Barlow Semi Condensed for headings (`--font-head`, h1 to h3, weight 700), prices and the small uppercase labels and badges (`--font-label`, letter spacing around 0.1em, 11 to 13px). Chosen by the owner in place of Archivo and IBM Plex Mono so the site feels automotive, not templated. Both load from Google Fonts.
- Page titles (`.page-title`): 34px 700, Title Case. Section headings (`.section-title`, card h2): 20px 700, Title Case, no underline.

**Components**
- Header: sticky light strong-glass bar (static under 720px) with the site search in the middle, 64px tall (`--header-h: 64px`), ink text, 1px bottom hairline `rgba(21,23,27,0.06)`. Roundel logo (white circle, 3px red ring, `SITE_INITIALS`), wordmark `SITE_NAME` in ink (Barlow Semi Condensed 800, uppercase, 19px, 0.05em) with the mono sub line `SITE_TAGLINE` in muted. Logo links to the Lot (`/`). Glass secondary buttons (ink text) and the red Sell button, radius 10px; unread and to-do counts are red pills. A moon and sun button switches dark mode. Under the bar, the category menu (uppercase label links, a red underline on the current one) scrolls away with the page. The red promise strip under the header was removed at the owner's request.
- Buttons: primary red, white 700 text, 12px radius, 44px minimum height, shadow `0 6px 16px rgba(213,0,28,0.22)`, hover red dark. Secondary: white 0.7 glass with blur, 1px `rgba(21,23,27,0.12)` border, ink text. Link buttons stay plain.
- Inputs: `rgba(255,255,255,0.7)` with blur 12px, 1px `rgba(21,23,27,0.12)` border, 12px radius, 48px minimum height; focus is a red border plus a `0 0 0 4px rgba(213,0,28,0.15)` ring. Labels above, errors under the field in red.
- Badges: pills, `rgba(21,23,27,0.06)` background, no border, mono 10.5px uppercase 0.1em, muted text. Status badges keep their meaning as soft tints (OK green, red for changes requested and rejected).
- Spec rows: label left in muted mono, value right, solid hairline under each row. Facts grid (`.facts`): glass tiles split by hairlines.
- Admin tabs (`AdminNav`): a glass pill bar, the current tab white with a red underline.
- Frame: 1180px content, 20px gutters. Content plus side column = `.with-side` (1fr and 360px, 44px gap).

**Dark mode**
- Same glass, smoked. A head script in `Base.astro` sets `data-theme` on `<html>` before the page paints: the visitor's choice (`localStorage` `theme`) or the system setting, and follows system changes when there is no choice. The header's moon and sun button flips it and remembers it. Dark tokens live in `:root[data-theme="dark"]` in `global.css` (paper `#0E1013`, ink `#ECEEF1`, red `#E8142F`, smoked glass).
- Tints that must flip use the RGB triplets `--ink-rgb` and `--hi-rgb` (`rgba(var(--hi-rgb), 0.7)` for input and button glass, `rgba(var(--ink-rgb), 0.06)` for hover rows) and solid light surfaces use `--surface`, never `#fff` or `var(--white)` as a background. `--white` stays literal white for text on red or on photos, and dark overlays on photos keep literal `rgba(21, 23, 27, ...)`. Text on an ink background uses `var(--paper)`.

**Principles**
- Desktop first (changed from mobile first at the owner's request). Design each screen for a 1280 to 1440px desktop: use the width with multi-column layouts, side panels and tables. Write base CSS for desktop and use `max-width` media queries to adapt down. Every screen must still work at 360px with no horizontal scroll, because many sellers upload photos from a phone. The site header is sticky, so sticky side columns use `top: calc(var(--header-h) + 20px)` (the `--header-h` token in `global.css`, 64px), and a sticky column that can be taller than the screen scrolls on its own (`max-height` plus `overflow-y: auto`).
- Fast. Server render everything, keep client JS to the islands listed above, lazy load images.
- No em dashes or en dashes anywhere in user-facing text (pages, notices, emails).
- Never look AI made (the owner asked for this): no default template fonts (Inter, Poppins, Space Grotesk), no purple or blue gradients, glowing blobs or emoji in headings. Real photos do the work; glass goes where it helps (header, finder, panels over photos, price tags).
- Titles use Title Case (the owner asked for this): page titles (the h1 and the browser title), section and card headings, box titles ("Stay Safe", "Buy Safely"), the header links and account menu ("My Garage", "Inbox", "Sign In", "Sell Your Car", "Saved Cars", "Offers", "Account Settings", "Review Queue", "Sign Out"), admin tabs, wizard step names ("The Car", "Condition and History", "Price and Contact", "Review and Submit"), car page sections ("The Story", "Known Issues", "Service History"), collapsible section names ("Site Owner", "Suggested Shots") and the Lot's filter names ("Year From", "Year To", "More Filters"), the category menu ("All Cars", "Trucks and SUVs") and breadcrumbs. Small words stay lower case inside a title (a, an, the, and, or, for, of, on, to, in, with). Page names keep their Title Case when mentioned in text ("Check My Garage for updates", "the Contact the Team form").
- Everything else is sentence case, plain words: buttons, form labels, dropdown choices, notices, emails and body text. Buttons say exactly what happens: "Submit for review", "Send offer", "Accept offer", "Mark as sold".
- Empty states tell people what to do next.
- Visible keyboard focus. Respect reduced motion.

## Build order (history)

The first six phases were built on Webflow Cloud; the site then moved to Cloudflare Workers (the Lot and car pages came into the app, Webflow publishing was removed). Commit and push after each change and confirm the Cloudflare deploy succeeds.

1. **Scaffold:** Astro on Webflow Cloud at `/app` with `webflow.json`, `wrangler.json` (DB, PHOTOS), Drizzle, base layout with the header and design tokens. Done when `/app` loads on the live site.
2. **Accounts:** Better Auth sign up, login, logout, verify email, reset password, profile, admin role from `ADMIN_EMAILS`, `/api/me`.
3. **Selling:** sell wizard with autosave, photo uploader, my garage, submit for review.
4. **Review:** admin queue and review screen, approve and publish to the CMS, request changes, reject, emails for each outcome, audit log.
5. **Buying:** offers, counters, accept flow with contact exchange, messaging, inbox, notifications, scam flags.
6. **Finish:** quick edits synced to the CMS, mark sold and relist, public photos API, error pages, final mobile pass.

## Working rules

- Check the Cloudflare docs (the Cloudflare connector's documentation search) before writing config. Do not guess config keys.
- Never commit secrets. Use `.dev.vars` locally (gitignored).
- Keep this file up to date when a decision changes.
- When something here is ambiguous, pick the simplest option that fits the rules above and note it in the commit message.
