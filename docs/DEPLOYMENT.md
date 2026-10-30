# Deployment

Nothing has been deployed from this repository. Staging and production require your credentials. Keep live payments and public access off until you explicitly decide to launch.

## 0. Environments

| | Local | Staging | Production |
|---|---|---|---|
| Auth | `AUTH_MODE=local` (dev only) | Supabase (staging project) | Supabase (prod project) |
| DB | Local Postgres + shim | Supabase staging | Supabase prod |
| Billing | `mock` | `disabled` → `test` (sk_test_) once keys exist | `disabled` → `live` after sign-off |
| Email | console | Resend (test domain) | Resend (verified domain) |
| Demo mode | on | on | on until a licensed source exists (labelled) |

## 1. Supabase

1. Create **separate** projects for staging and production (region close to PH, e.g. Singapore).
2. Apply migrations from `supabase/migrations/` in order:
   - CLI: `supabase link --project-ref <ref>` then `supabase db push`, **or**
   - SQL editor: run each file in filename order.
   - **Do NOT apply `supabase/local/000_supabase_shim.sql`.** It is for local Postgres only.
3. Run `supabase/seed/seed.sql` (idempotent: settings, plans, source placeholders).
4. Load demo data (optional): set `DATABASE_URL` to the project's direct connection, then run `pnpm --filter @vlf/api seed:demo`.
5. Auth settings: enable email provider and **Confirm email**; Site URL = web origin; Redirect URLs = `https://<web>/onboarding` (email confirmation lands here) and `https://<web>/reset-password`; set custom SMTP (e.g. Resend) for auth emails.
6. Note the project URL, anon key, service-role key and JWT settings (JWKS is used automatically; set `SUPABASE_JWT_SECRET` only for legacy HS256 tokens).
7. Create your admin account by signing up, copy its user id into `ADMIN_USER_IDS`.

## Automated staging path (from a Claude Code cloud session)

Cloud sessions can't reach Postgres port 5432, so the database is set up over HTTPS through the Supabase Management API, and Hyperdrive connects to Postgres from Cloudflare's side.

**Environment variables** (add them in the cloud environment settings, then start a new session; never paste them into chat):

| Name | Where to get it | Notes |
|---|---|---|
| `SUPABASE_ACCESS_TOKEN` | supabase.com → Account → Access Tokens | Full account access; revoke after setup |
| `SUPABASE_PROJECT_REF` | Project URL `supabase.com/dashboard/project/<ref>` | Not secret |
| `SUPABASE_DB_URL` | Project → **Connect** → *Session pooler* URI, with the DB password filled in | Used only to create Hyperdrive |
| `CLOUDFLARE_API_TOKEN` | Cloudflare → My Profile → API Tokens → *Create custom token* | Account: Workers Scripts Edit, Hyperdrive Edit, Cloudflare Pages Edit, Account Settings Read; User: User Details Read |
| `CLOUDFLARE_ACCOUNT_ID` | Cloudflare dashboard → Workers & Pages (right sidebar) | Not secret |

**Runbook:**
1. `node scripts/supabase-apply-migrations.mjs`: migrations and seed, recorded in `supabase_migrations.schema_migrations`.
2. Read the project's anon (publishable) key: `GET https://api.supabase.com/v1/projects/$SUPABASE_PROJECT_REF/api-keys`.
3. `cd apps/api && npx wrangler hyperdrive create vlf-db-staging --connection-string="$SUPABASE_DB_URL"`, then put the id in `[[env.staging.hyperdrive]]`.
4. `wrangler secret put` for `SUPABASE_URL` (`https://$SUPABASE_PROJECT_REF.supabase.co`) and `INTERNAL_JOB_TOKEN` (random, 48 hex chars, never printed). Leave `ADMIN_USER_IDS` until the owner signs up.
5. `npx wrangler deploy --env staging` and note the `*.workers.dev` URL.
6. `npx wrangler pages project create va-leadfinder --production-branch main`. Build the web app with `VITE_AUTH_MODE=supabase`, `VITE_SUPABASE_URL`, `VITE_SUPABASE_ANON_KEY` and `VITE_API_BASE_URL=<workers.dev URL>`, then `npx wrangler pages deploy apps/web/dist --project-name va-leadfinder`.
7. If the Pages URL differs from `https://va-leadfinder.pages.dev`, update `APP_BASE_URL`/`CORS_ORIGINS` in `wrangler.toml` and redeploy the Worker.
8. Supabase auth config (`PATCH /v1/projects/<ref>/config/auth`): `site_url` = Pages URL; `uri_allow_list` = `<pages>/onboarding,<pages>/reset-password`; keep email confirmation on.
9. The owner signs up on the staging site. Run `wrangler secret put ADMIN_USER_IDS --env staging` with that user id.
10. Admin → Ingestion → **Run VA LeadFinder Demo Data**, then do the smoke test from §6. If logins return 401, the project issues legacy HS256 tokens: set `SUPABASE_JWT_SECRET`.
11. Afterwards, revoke `SUPABASE_ACCESS_TOKEN` and narrow or delete the Cloudflare token.

## 2. Cloudflare Worker (API)

```bash
cd apps/api
npx wrangler hyperdrive create vlf-db-staging --connection-string="postgres://postgres.<ref>:<password>@<host>:5432/postgres"
# put the returned id in wrangler.toml [[env.staging.hyperdrive]]
npx wrangler secret put SUPABASE_URL --env staging
npx wrangler secret put SUPABASE_SERVICE_ROLE_KEY --env staging
npx wrangler secret put ADMIN_USER_IDS --env staging
npx wrangler secret put INTERNAL_JOB_TOKEN --env staging          # 32+ random chars
npx wrangler secret put PAYMONGO_SECRET_KEY --env staging         # sk_test_...
npx wrangler secret put PAYMONGO_WEBHOOK_SECRET --env staging
npx wrangler secret put TRANSACTIONAL_EMAIL_API_KEY --env staging
npx wrangler secret put TRANSACTIONAL_EMAIL_FROM --env staging
npx wrangler deploy --env staging
```

- Route the Worker on `api.<domain>` (or `<domain>/api/*`). Set `APP_BASE_URL`/`CORS_ORIGINS` vars to the web origin.
- Cron Triggers come from `wrangler.toml` (ingest every 6 h, maintenance 18:30 UTC, digest 22:00 UTC).
- If using the Supabase transaction pooler instead of Hyperdrive, set `DATABASE_PREPARE=false`.
- Config validation stops startup in staging/production if `AUTH_MODE=local`, or if mock billing is used in production, or if keys don't match the mode.

## 3. Cloudflare Pages (web)

| Setting | Value |
|---|---|
| Build command | `pnpm install --frozen-lockfile && pnpm --filter @vlf/web build` |
| Output directory | `apps/web/dist` |
| Env vars | `VITE_AUTH_MODE=supabase`, `VITE_SUPABASE_URL`, `VITE_SUPABASE_ANON_KEY`, `VITE_API_BASE_URL=https://api.<domain>`, `VITE_PAYMONGO_PUBLIC_KEY` (pk_test_/pk_live_) |

Only `VITE_` variables reach the browser. Never put service-role or secret keys there.

## 4. PayMongo

1. Ask PayMongo support to **enable Subscriptions** on the account. Recurring billing supports Visa/Mastercard (card vaulting) and Maya. **GCash is not supported for recurring subscriptions.**
2. Test mode first: create plans with `PAYMONGO_MODE=test PAYMONGO_SECRET_KEY=sk_test_... DATABASE_URL=... pnpm --filter @vlf/api paymongo:create-plans` (stores `provider_plan_id_test`).
3. Create a webhook endpoint (Dashboard → Developers → Webhooks, or `POST /v1/webhooks`) at `https://api.<domain>/api/webhooks/paymongo` subscribed to:
   `subscription.activated`, `subscription.updated`, `subscription.past_due`, `subscription.unpaid`, `subscription.invoice.paid`, `subscription.invoice.payment_failed` (and optionally the other `subscription.invoice.*` events, which are acknowledged and ignored).
   Store the endpoint secret as `PAYMONGO_WEBHOOK_SECRET`. Test and live endpoints are separate, with separate secrets.
4. In Admin → Settings, switch **Checkout enabled** on for staging only after:
   - [ ] a test card subscription becomes `active` via webhook
   - [ ] duplicate webhook delivery shows `duplicate`
   - [ ] failed payment → `past_due` → grace period → `unpaid` behaves as documented
   - [ ] cancel works and access ends at period end
5. Live: repeat with `sk_live_` keys and `CONFIRM_LIVE=yes` for plan creation, a live webhook endpoint, and `PAYMONGO_MODE=live`. **Do not enable live checkout without explicit owner sign-off.**

The real PayMongo adapter (`apps/api/src/services/billing/providers.ts`) follows PayMongo's current documentation but **has not been exercised against PayMongo from this repo**. Verify it in test mode.

## 5. Domains and DNS

- `app.<domain>` → Cloudflare Pages; `api.<domain>` → Worker route; HTTPS enforced (Cloudflare "Always Use HTTPS", HSTS is set by the API in production).
- Email sending domain: add the SPF, DKIM and DMARC records the email provider gives you.

## 6. Release checklist

- [ ] `pnpm check` passes (typecheck, lint, unit, integration, build)
- [ ] Migrations applied to staging; smoke test: sign up → onboarding → discover → unlock → save → draft → (test) checkout
- [ ] Terms/Privacy reviewed by a lawyer before public launch
- [ ] Demo banner visible; no live source enabled without a completed licence record
- [ ] Backups/PITR enabled; secrets rotated from any shared dev values
