# Petrol Head Market: account app

The signed-in side of Petrol Head Market (selling, offers, messages, admin review), built with Astro on Webflow Cloud and mounted at `/app` on the public Webflow site. See `CLAUDE.md` for the full spec.

## Commands

| Command | What it does |
| :-- | :-- |
| `npm install` | Install dependencies |
| `npm run dev` | Astro dev server at `http://localhost:4321/app` |
| `npm run preview` | Build, then run in the Workers runtime with Wrangler at `http://localhost:8787/app` |
| `npm run check` | Type check |
| `npm run cf-typegen` | Regenerate binding types after editing `wrangler.json` |
| `npm run db:generate` | Write a new Drizzle migration to `./drizzle` after editing `src/db/schema.ts` |
| `npm run db:migrate:local` | Apply migrations to the local D1 database |

## Local setup

1. `npm install`
2. Copy `.dev.vars.example` to `.dev.vars` and fill in the secrets (never commit it).
3. `npm run db:migrate:local`
4. `npm run preview`, then open `http://localhost:8787/app`

`GET /app/api/health` confirms the D1 (`DB`) and R2 (`PHOTOS`) bindings are working.

## Deploys

Every push to `main` deploys through Webflow Cloud. Migrations in `./drizzle` are applied on each deploy. Secrets live in the Webflow Cloud dashboard.
