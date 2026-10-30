# Architecture

## 1. Components

```
 Browser (React + Vite, Cloudflare Pages)
   │  Supabase Auth (prod) → access token (JWT)        [local dev: /api/dev-auth issues HS256 JWT]
   │  HTTPS JSON, Authorization: Bearer <JWT>
   ▼
 Cloudflare Worker  (Hono, apps/api/src/worker.ts)       [local dev: Node, apps/api/src/node.ts]
   ├─ middleware: request id → secure headers → CORS → authenticate (JWKS/HS256) → rate limit
   ├─ routes: public · webhooks · user · billing · admin · internal jobs · dev-only (auth, billing simulator)
   ├─ services: opportunities (search + scoring) · ingestion · billing (PayMongo / mock / disabled) · digest · email · audit
   ├─ providers: SyntheticDemoProvider · ManualApprovedProvider · LicensedApiProvider (disabled skeleton)
   └─ Cron Triggers: ingest (6h) · maintenance (daily) · digest (daily)
   │  postgres.js over Hyperdrive
   ▼
 Supabase Postgres  (RLS on every table, column grants, SECURITY DEFINER functions)
        ▲                                    ▲
   PayMongo webhooks → /api/webhooks/paymongo   Resend (transactional email, optional)
```

`packages/shared` holds Zod schemas, enums, the scoring engine, CSV/privacy/dedupe helpers, outreach templates and entitlement helpers. Both web and API import it.

## 2. Request flow and RLS

1. The browser sends `Authorization: Bearer <JWT>`. The API verifies it: Supabase JWKS (`RS256`/`ES256`) or the legacy HS256 secret, issuer `<SUPABASE_URL>/auth/v1`, audience `authenticated`. Local dev uses issuer `vlf-local-dev`.
2. For user requests, `withUser()` opens a transaction, sets `request.jwt.claims` and runs `set local role authenticated`. **Every user query runs under Postgres RLS**, so even an API bug cannot read another user's rows.
3. Admin, webhook and job code uses `asService()`, which keeps the connection owner role. These paths are authorised first: `ADMIN_USER_IDS` server-side, a verified webhook signature, or `INTERNAL_JOB_TOKEN`.
4. Errors return `{ error: { code, message, requestId, details? } }`. Every response carries `X-Request-Id`. API responses are `Cache-Control: no-store`.

## 3. Database security model

**Grants.** The migration revokes all default Supabase grants from `anon`/`authenticated`, then grants precisely:

| Object | `authenticated` access |
|---|---|
| `opportunities` | SELECT on **teaser columns only** (no `original_summary`, `company_site`, `contact_route`, `outsourcing_evidence`) |
| `source_providers` | SELECT `id, name, provider_kind, attribution_text, enabled` |
| `subscriptions` | SELECT non-provider columns of own rows; no writes |
| `email_preferences` | own row; `unsubscribe_token_hash` not readable |
| own-data tables (profiles, preferences, saved_prospects, drafts, views, dismissals, feedback, data_requests) | RLS `user_id = auth.uid()` |
| `opportunity_unlocks`, `usage_events` | SELECT own only (writes only via function) |
| `source_records`, `ingestion_runs`, `billing_webhook_events`, `admin_audit_log` | **none** |

**SECURITY DEFINER functions**

| Function | Purpose |
|---|---|
| `opportunity_is_servable(id)` | Published, not expired, source enabled, and either (demo + demo mode on) or (licence approved + commercial + redistribution approved). Used by RLS policies. |
| `current_plan_code(user)` | Active → plan; past_due within `grace_days` → plan; cancelled before `current_period_end` → plan; else `free`. |
| `my_usage()` | Plan, unlocks used/limit/remaining in current period, export & live-data flags. |
| `unlock_opportunity(id)` | Per-user advisory lock; checks servable, existing access, live-data entitlement, quota; inserts unlock `on conflict do nothing`; logs usage event. |
| `get_opportunity_full(id)` | Returns gated columns + source URL only if unlocked this period or saved. |
| `saved_prospect_insert_allowed`, `i_have_detail_access` | Policy helpers (saving and drafts require an unlock). |

**Constraint:** `source_enable_requires_approval` makes the database refuse `enabled = true` on any non-demo source without approved licence status, both approvals, a reference, date, approver and checklist items.

## 4. Scoring (deterministic, per user, `packages/shared/src/scoring`)

| Component | Max | Rules |
|---|---|---|
| Skill relevance | 35 | 20 + 15 × matched/required; 0 matched → capped below 50 |
| Hiring signal | 30 | active posting 15, outsourcing language 10, multiple roles 5, growth 5, tool match 5 (deduped, capped) |
| Remote & contract fit | 20 | remote + worldwide/PH-ok 12; remote + unknown eligibility 6; unknown arrangement 3; contract/freelance/part-time 8; full-time with outsourcing evidence 4; −4 if not a preferred work type |
| Freshness | 15 | ≤7d 15 · ≤14d 11 · ≤30d 7 · ≤60d 3 · else 0 |

Exclusions are hidden by default with reasons: expired, on-site/hybrid when remote is required, and US-only / US work authorization / other-country restrictions (if the user hides restricted roles; otherwise the score is capped at 40). Bands: ≥75 High fit, 50–74 Potential fit, <50 Low fit (hidden). Scores are computed per request and never stored.

## 5. Quotas and billing

- Unlock period = **calendar month in Asia/Manila** (`current_period_key()`); resets on the 1st, 00:00 PHT.
- Saved prospects keep detail access across periods.
- Checkout creates a PayMongo customer + subscription with status `incomplete`. Entitlements change only in `processPaymongoEvent` after HMAC verification. Events are idempotent on provider event id, older events are ignored per subscription (`last_event_at`), and late events never re-open a cancelled subscription.
- Cancellation calls PayMongo cancel (immediate, no new invoices); access continues to `current_period_end`.
- Plan change: PayMongo `PUT /v1/subscriptions/{id}/plan`; stored as `pending_plan_id` and applied on the next `subscription.invoice.paid`. No prorating.

## 6. Ingestion pipeline

approval check (fail closed → run `blocked`) → configuration check → fetch (timeout + bounded retries) → normalize → Zod validate → personal-data scan → contact route must be a URL or generic mailbox → date sanity → dedupe key (external id or normalized company+title+URL, SHA-256) → insert `source_records` with licence snapshot and `retain_until` → insert opportunity (`published` for demo, `needs_review` otherwise) → run statistics. Duplicates refresh `last_verified_at`.

## 7. Tradeoffs and known limits

| Decision | Why | Consequence |
|---|---|---|
| API is the only data path; browser never queries PostgREST for app data | Column gating + quotas in one place | RLS/grants still protect against direct PostgREST use with a user JWT |
| In-memory fixed-window rate limiter | Zero-dependency | Per isolate/process only; add Cloudflare Rate Limiting rules in production |
| Score up to 500 newest matching candidates per request | Bounded cost, prevents enumeration | Very large catalogues would need pre-filtering or materialised scoring |
| Webhooks processed inline (fast DB writes) | Simplicity | PayMongo recommends async; acceptable within its 30 s window; revisit with Queues if needed |
| Retention purge deletes `source_records` (cascade) | Honour licence retention | Saved prospects/notes on purged records are deleted too |
| Local dev uses plain Postgres + `supabase/local` shim | No Docker available | Shim mimics `auth.uid()`, roles and default grants; real Supabase is not exercised by CI |
