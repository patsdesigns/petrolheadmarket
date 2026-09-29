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
- Pages are server rendered forms with no client JS. Form handlers call Better Auth through `callAuth()` in `src/lib/auth-call.ts`, which goes through `auth.handler` so Better Auth's rate limits apply.
- Signing in does not require a verified email. Listing, offers and messages check `user.emailVerified` instead.
- `src/middleware.ts` loads the session and profile, sends signed out people to `/app/login?next=...`, returns the 404 page for non admins on `/app/admin*`, and rejects cross-origin POSTs (CSRF). Astro's own `checkOrigin` is off because the request URL behind the Webflow proxy may not match the browser origin.
- The admin role is synced from `ADMIN_EMAILS` on every sign in (added or removed).
- Without `RESEND_API_KEY`, emails are printed to the console so local flows still work.

## Environment variables

| Name | Secret | Purpose |
|---|---|---|
| `WEBFLOW_API_TOKEN` | yes | Site API token with CMS read and write |
| `WEBFLOW_SITE_ID` | no | `6a8cb05d39be95366772994d` |
| `WEBFLOW_COLLECTION_ID` | no | `6a8cb2028c898e7ed8517d9c` (Listings) |
| `BETTER_AUTH_SECRET` | yes | Auth signing secret |
| `RESEND_API_KEY` | yes | Transactional email |
| `EMAIL_FROM` | no | Sender address |
| `ADMIN_EMAILS` | no | Comma separated emails that get the admin role on sign in |
| `PUBLIC_SITE_URL` | no | `https://petrol-head-market.webflow.io` (becomes the custom domain later). Also the auth base URL, so it must match the domain people use. |

The Webflow token is server only. Never send it to the browser.

## Routes the Webflow site already links to (must exist)

- `/app/login`
- `/app/sell`
- `/app/offer?listing={slug}`
- `/app/message?listing={slug}`

`{slug}` is the Webflow CMS item slug, which is also the public URL: `/listings/{slug}`.

If a signed out user hits `/app/offer` or `/app/message`, send them to login and return them to the same URL afterward.

## Screens

**Public (signed out)**
- `/app/login`, `/app/signup`, `/app/forgot-password`, `/app/reset-password`, `/app/verify-email`

**Signed in**
- `/app` : My garage (dashboard). Listings with status, offers needing a response, unread messages.
- `/app/sell` : New listing wizard. Autosaves as a draft. Steps: The car, Condition and history, Photos, Price and contact, Review and submit.
- `/app/listings/:id` : Seller view of one listing (status, reviewer notes, quick edits, mark sold)
- `/app/listings/:id/edit` : Edit a draft or a listing with changes requested
- `/app/offer?listing={slug}` : Make an offer (shows the car summary and asking price)
- `/app/offers` : Offers sent and received
- `/app/message?listing={slug}` : Opens or creates the thread with that seller
- `/app/inbox` and `/app/inbox/:threadId` : Messages
- `/app/account` : Display name, phone, email, password, notification settings

**Admin (role admin only)**
- `/app/admin` : Review queue, oldest submitted first
- `/app/admin/listings/:id` : Full review screen with the checklist, photo grid, inline edit, notes to seller, and three actions: Approve and publish, Request changes, Reject
- `/app/admin/flags` : Messages flagged by the scam filter

**API**
- `/app/api/auth/*` : Better Auth handler (configure its base path under `/app`)
- `GET /app/api/me` : `{ signedIn, displayName, isAdmin }`. The Webflow site header will call this to swap "Sign in" for the user's account link.
- `GET /app/api/listings/{slug}/photos` : Public JSON list of every photo URL in order, for the gallery on the public listing page
- `GET /app/photos/{key}` : Public photo serving from R2
- Everything else as needed by the screens

## Listing lifecycle

Statuses in the app database:

`draft` → `submitted` → `changes_requested` (back to seller) → `submitted` → `approved` → `live` → `offer_accepted` → `sold`

Also: `rejected`, `withdrawn`. Reserve `awaiting_payment` between `draft` and `submitted` for the future listing fee, but do not use it yet.

- Only `live`, `offer_accepted`, and `sold` listings exist in the Webflow CMS.
- `approved` means the admin approved it and the CMS publish is in progress. If the Webflow API call fails, stay in `approved`, log the error, and let the admin retry from the review screen.
- Sold listings stay published with status Sold. The public grid already hides sold cars.
- Edits on a live listing: price, accepts offers, contact method, and phone sync to the CMS immediately. Any other change requires the admin to make it (keep v1 simple).

## Review checklist

The wizard enforces these before submit, and the server re-checks:
- At least 20 photos, first photo is the main photo
- Year, make, model, price, mileage, transmission, location (City, ST), title status
- VIN required for 1981 and newer (17 characters, valid format)
- Description of at least 300 characters
- Known issues is required. A seller who writes "none" gets a prompt to be honest about wear, because disclosure is what makes this marketplace trustworthy.

The admin decides the rest by judgment: is it an enthusiast car, are the photos honest, does the price make sense. Rejections and change requests always include a note to the seller.

## Offers

- Buyer must be signed in with a verified email.
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
- Flag messages containing scam patterns (wire transfer, Western Union, gift cards, shipping agent, escrow links, requests to move off platform) into `/app/admin/flags`. Do not block them.
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
- `profiles`: user_id, display_name, phone, role (user or admin), created_at
- `listings`: id, user_id, status, every listing field above, slug, cms_item_id, review_notes, reviewer_id, submitted_at, reviewed_at, published_at, sold_at, created_at, updated_at
- `listing_photos`: id, listing_id, r2_key, position, width, height, created_at
- `offers`: id, listing_id, buyer_id, amount, message, status (pending, countered, accepted, declined, expired, withdrawn), parent_offer_id, expires_at, created_at
- `threads`: id, listing_id, buyer_id, seller_id, last_message_at
- `messages`: id, thread_id, sender_id, body, flagged, read_at, created_at
- `audit_log`: id, actor_id, action, entity, entity_id, data, created_at (log every admin action and every CMS publish)

## Security

- Check ownership on every read and write. A seller only sees their own drafts, a buyer only their own offers and threads, admins everything.
- Admin routes check the role on the server, not just in the UI.
- Require verified email before submitting a listing, making an offer, or sending a message.
- Validate every input with Zod on the server. Cap text lengths.
- httpOnly, secure session cookies. CSRF protection on all mutations (Better Auth covers its routes, cover the rest).
- Store the minimum. The CMS only ever gets the seller's display name and, if chosen, their phone.

## Design (match the Webflow site exactly)

The app should feel like the same site. Copy the look, do not invent a new one.

**Colors**
- Ink `#15171B` (text, dark header, secondary button borders)
- Red `#D5001C` (primary buttons, flags, key accents)
- Paper `#F6F6F3` (page background)
- White `#FFFFFF` (cards)
- Line `#DDDDD5` (borders, dashed dividers)
- Muted `#5A5E66` (secondary text)
- OK green `#1A6B3C` on `#EAF4EE` with border `#CBE3D4` (positive badges)

**Type**
- Archivo for UI and headings (headings weight 900, uppercase for page titles)
- IBM Plex Mono for prices, specs, small labels, and badges (uppercase, letter spacing around 0.12em, 10 to 12px)
- Both load from Google Fonts

**Components**
- Header: dark `#15171B` bar, red ringed white circle logo with "PH", wordmark "Petrol Head Market" with "Enthusiast car classifieds" under it in mono, links right. Logo links to `/` (the Webflow site, not `/app`). Signed in: My garage, Inbox with unread count, account menu.
- Cards: white, 1px `#DDDDD5` border, 10 to 12px radius
- Spec rows: label left in muted mono, value right, dashed bottom border
- Primary button: red background, white bold text, 8px radius. Secondary: white with 1px ink border.
- Forms: large inputs, labels above, errors under the field in red, 44px minimum tap targets

**Principles**
- Mobile first. Most sellers will upload photos from a phone.
- Fast. Server render everything, keep client JS to the islands listed above, lazy load images.
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
