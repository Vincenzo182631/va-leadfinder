# Acceptance Tests

Status legend: **PASS** = covered by an automated test that passed at last run (55 unit tests in `packages/shared/test`, 42 integration tests in `apps/api/test` against real Postgres 16 with RLS). **PENDING** = not yet automated. **BLOCKED** = needs external credentials/approval.

Run: `pnpm db:start && pnpm test` (unit + integration), `pnpm test:e2e` (browser).

## 1. Definition of done (spec §MVP acceptance criteria)

| # | Criterion | Status | Evidence |
|---|---|---|---|
| 1 | Builds with documented setup | PENDING | Typecheck passes for shared + api; full `pnpm build` incl. web to be confirmed |
| 2 | Registration/login/onboarding with configured auth | PASS (local auth) · BLOCKED (Supabase) | `security.test.ts` (signup/login, non-enumeration); onboarding via `helpers.signup`; Supabase needs project credentials |
| 3 | Private profile and pipeline per user, isolation test | PASS | `security.test.ts` › "user B cannot see or modify user A pipeline, notes or drafts" |
| 4 | Demo data visibly fictional | PASS (API) · PENDING (UI) | Demo badge + `[DEMO]` summaries + example.com URLs (`quota.test.ts`); digest labelled (`ingestion.test.ts`) |
| 5 | Admin adds approved-source opportunity with provenance/attribution | PASS | `ingestion.test.ts` › approval → import → licence snapshot → publish with attribution |
| 6 | Search, filter, display, score, save, annotate, dismiss, report | PASS (API) · PENDING (UI) | `quota.test.ts` › discovery tests; `security.test.ts` (save/notes) |
| 7 | Human-readable score reasons and restrictions | PASS | `scoring.test.ts`; `quota.test.ts` › "explains scores" |
| 8 | Unapproved source cannot feed subscriber results | PASS | `ingestion.test.ts` › blocked import, DB constraint, revoke hides, licensed adapter blocked |
| 9 | Entitlements and quotas server-enforced | PASS | `quota.test.ts` › once-per-period, concurrency, live-data gating, export gating |
| 10 | PayMongo sandbox incl. verification + duplicate webhooks | PASS (signature/idempotency with mock + PayMongo-format signatures) · BLOCKED (real sandbox) | `billing.test.ts`; real test-mode run needs keys + subscription activation |
| 11 | Cancellation and truthful billing status | PASS | `billing.test.ts` › cancellation keeps access to period end; disabled mode returns 503 + message |
| 12 | Secrets server-side; no credentials in logs | PASS (partial) | `security.test.ts` › config errors don't echo secrets; log redaction in `lib/log.ts` (not separately unit-tested) |
| 13 | Mobile/desktop accessibility & usability | PENDING | Playwright 375 px + keyboard tests |
| 14 | Tests and deployment scripts documented and run | PASS (unit/integration) · PENDING (e2e, deploy) | README, DEPLOYMENT.md |
| 15 | Final report separates deployed / simulated / credential-gated / legal-gated | PENDING | Handoff report |

## 2. Unit tests (spec §Testing)

| Area | Status |
|---|---|
| Score rules + band/freshness/expiry/stale boundaries | PASS |
| US-only / work-authorization vs worldwide remote | PASS |
| Dedupe keys (external id, normalisation, provider scope) | PASS |
| Freshness and expiration | PASS |
| CSV parsing + export escaping (formula injection) | PASS |
| Zod request schemas | PASS |
| Entitlement decisions + quota/period calculation | PASS |
| Personal-data detection + contact-route rules | PASS |

## 3. Integration tests

| Area | Status |
|---|---|
| Ingestion rejects unapproved providers | PASS |
| Manual import with provenance; personal data rejected; duplicates counted | PASS |
| RLS between two users (API and direct SQL) | PASS |
| Unlocks never double-charge (sequential and parallel) | PASS |
| Webhook: verification, duplicates, out-of-order, cancellation, past_due/grace, unpaid | PASS |
| Unauthorized requests (401/403, admin, job token) | PASS |
| Missing vendor keys fail safely (billing disabled, licensed provider) | PASS |
| Digest + unsubscribe; account export/deletion | PASS |

## 4. Browser end-to-end flows (spec §Testing 1–12)

| # | Flow | Status |
|---|---|---|
| 1 | Sign up and complete onboarding | PENDING (parent is adding Playwright tests) |
| 2 | Search and filter demo opportunities | PENDING (parent is adding Playwright tests) |
| 3 | View source and match explanation | PENDING (parent is adding Playwright tests) |
| 4 | Save prospect, add notes, change stage | PENDING (parent is adding Playwright tests) |
| 5 | Create and copy outreach draft | PENDING (parent is adding Playwright tests) |
| 6 | Solo user sees and respects plan limits | PENDING (parent is adding Playwright tests) |
| 7 | Admin creates a properly attributed opportunity | PENDING (parent is adding Playwright tests) |
| 8 | Normal user cannot see admin or other users' data | PENDING (parent is adding Playwright tests) |
| 9 | Payment test mode updates entitlement only after verified webhook | PENDING (parent is adding Playwright tests) |
| 10 | Mobile layout usable at 375 px | PENDING (parent is adding Playwright tests) |
| 11 | Keyboard-only navigation of key controls | PENDING (parent is adding Playwright tests) |
| 12 | Empty source / provider-error states understandable | PENDING (parent is adding Playwright tests) |

## 5. Manual verification (needs credentials)

- [ ] Supabase: sign-up email confirmation, reset email, JWKS token verification against the real project
- [ ] PayMongo test mode: card subscription → `subscription.activated`/`invoice.paid` webhook → plan active; cancel via API
- [ ] Resend: digest delivered, unsubscribe link works
- [ ] Cloudflare: Worker + Hyperdrive connectivity, cron triggers fire

## 6. Known limitations

- No licensed live data source: only synthetic demo data and admin manual imports (once a source is approved).
- Real PayMongo adapter is untested against PayMongo; card collection UI depends on the PayMongo public key.
- Local auth skips email confirmation (dev only); Supabase flows not exercised by CI.
- Rate limiting is per isolate/process; production needs Cloudflare rules.
- Scoring considers at most 500 newest candidates per request.
- Webhooks are processed inline rather than queued.
- Retention purge deletes saved prospects/notes tied to purged source records.
- Unlock period is the Asia/Manila calendar month, not the subscriber's billing cycle.
- Terms of Service and Privacy Policy are placeholders pending legal review.
