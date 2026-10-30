# VA LeadFinder

A subscription workspace for Filipino virtual assistants to find US businesses that show a documented need for remote support. Each opportunity shows why it matches, its source and eligibility restrictions, and helps the VA organise thoughtful outreach.

> **Status: working MVP running locally on demo data.** It is not deployed, it has no licensed live data source, and live payments are off. See [Status](#status).

## Architecture in one minute

```
Browser (React + Vite + Tailwind)  ──►  API (Hono · Node locally / Cloudflare Worker in prod)  ──►  Postgres (Supabase)
   Supabase Auth (prod) / local dev auth         verifies JWT, then runs queries AS the user:          RLS + column grants +
                                                 `set local role authenticated` + jwt claims            SECURITY DEFINER quota fns
                                       PayMongo webhooks ─► signature-verified, idempotent processor
```

- `packages/shared`: Zod schemas, per-user scoring engine, CSV, privacy guards, outreach templates, entitlement rules.
- `apps/api`: Hono API, source providers (synthetic demo / manual / licensed skeleton), fail-closed ingestion, billing adapters (disabled / mock / PayMongo test / live), digest, cron jobs.
- `apps/web`: marketing site, auth, 4-step onboarding, dashboard, discover, opportunity detail, pipeline, account and billing, admin console.
- `supabase/migrations`: schema, RLS, grants and functions. `supabase/seed/seed.sql`: plans, settings and source registry. `supabase/local`: a shim for local development only.
- `docs/`: [PRD](docs/PRD.md) · [Architecture](docs/ARCHITECTURE.md) · [Data sources & licensing](docs/DATA_SOURCES_AND_LICENSING.md) · [Security & privacy](docs/SECURITY_AND_PRIVACY.md) · [Operations](docs/OPERATIONS.md) · [Deployment](docs/DEPLOYMENT.md) · [Acceptance tests](docs/ACCEPTANCE_TESTS.md)

## Run locally

Requirements: Node 20+ (tested on 22), pnpm 10, and PostgreSQL 16 binaries (`initdb`, `pg_ctl`, `psql`). Docker is not needed.

```bash
pnpm install
```

```bash
cp .env.example .env
```

Edit `.env` for local development. The minimum is `APP_ENV=development`, `AUTH_MODE=local`, `VITE_AUTH_MODE=local`, `DATABASE_URL=postgres://postgres@127.0.0.1:54329/vlf`, a 32+ character `LOCAL_AUTH_JWT_SECRET`, `PAYMONGO_MODE=mock` and a 16+ character `PAYMONGO_WEBHOOK_SECRET`.

```bash
pnpm db:reset
```

```bash
pnpm --filter @vlf/api seed:dev-users
```

This prints a test VA and a test admin with **random** passwords. Put the admin id in `ADMIN_USER_IDS` in `.env`.

```bash
pnpm dev
```

The web app runs on http://localhost:5173 and the API on http://127.0.0.1:8787. Fictional demo data loads automatically on the first API start, or run `pnpm --filter @vlf/api seed:demo`.

## Test

```bash
pnpm typecheck && pnpm lint
```

```bash
pnpm test
```

That runs 55 unit tests (`packages/shared`) and 42 integration tests (`apps/api`) against a fresh `vlf_test` database.

```bash
pnpm test:e2e
```

That runs 12 Playwright flows on an isolated stack (database `vlf_e2e`, API on 8788, web on 5174).

```bash
pnpm build
```

That builds the web app and runs a dry-run bundle of the Cloudflare Worker.

## Scripts

| Command | What it does |
|---|---|
| `pnpm db:start` / `db:stop` / `db:reset [db]` | Local Postgres on port 54329: shim + migrations + seed |
| `pnpm dev` | API and web in watch mode |
| `pnpm --filter @vlf/api seed:demo` | Ingest the fictional demo dataset through the normal pipeline |
| `pnpm --filter @vlf/api seed:dev-users` | Local test VA and admin (dev only, random passwords) |
| `pnpm --filter @vlf/api paymongo:create-plans` | Create PayMongo plans for paid DB plans (test or live key) |
| `pnpm --filter @vlf/api deploy:staging` | `wrangler deploy --env staging` (needs Cloudflare credentials) |

## Status

| Area | State |
|---|---|
| Auth, onboarding, RLS isolation, discovery, scoring, unlock quotas, pipeline, drafts, feedback, admin, CSV import, licensing gate, digest, data export/deletion | **Implemented and tested locally** |
| Demo data | **Fictional only.** Every page that shows it carries "DEMO DATA — NOT REAL LEADS" |
| Billing | **Mock mode simulated end to end** with signed webhooks. The real PayMongo adapter is written but **untested against PayMongo**. It needs keys and subscription activation by PayMongo |
| Auth in production | Supabase Auth integration is written but **not exercised** without a Supabase project. Local dev auth is refused in staging/production |
| Email | Console provider in development. The Resend adapter is written; it needs an API key and a verified sender |
| Live opportunity data | **Blocked pending licensing.** No provider is approved. Remotive, Adzuna, SerpApi and LinkedIn must not be used without written permission for this exact paid use |
| Deployment | **Not deployed.** Config is ready (`apps/api/wrangler.toml`, `apps/web/public/_headers`); see [DEPLOYMENT.md](docs/DEPLOYMENT.md) |
| Legal | Terms and Privacy pages are **placeholders pending lawyer review**. A DPA/NPC privacy impact assessment is still to be completed (checklist in SECURITY_AND_PRIVACY.md) |

Secrets live only in `.env` / Worker secrets (never committed). Only `VITE_*` values reach the browser.
