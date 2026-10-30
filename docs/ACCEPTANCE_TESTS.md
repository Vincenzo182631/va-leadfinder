# Acceptance Tests

Status legend: **PASS** = covered by an automated test that passed at last run (55 unit tests in `packages/shared/test`, 42 integration tests in `apps/api/test` against real Postgres 16 with RLS). **PENDING** = not yet automated. Browser flows: 12 Playwright tests in `tests/e2e/mvp.spec.ts` (local stack, demo data, mock billing). **BLOCKED** = needs external credentials/approval.

Run: `pnpm db:start && pnpm test` (unit + integration), `pnpm test:e2e` (browser).

## 1. Definition of done (spec §MVP acceptance criteria)

| # | Criterion | Status | Evidence |
|---|---|---|---|
| 1 | Builds with documented setup | PASS | `pnpm typecheck`, `pnpm lint`, web `vite build`, Worker `wrangler deploy --dry-run` all succeed |
| 2 | Registration/login/onboarding with configured auth | PASS (local auth) · BLOCKED (Supabase) | `security.test.ts` (signup/login, non-enumeration); onboarding via `helpers.signup`; Supabase needs project credentials |
| 3 | Private profile and pipeline per user, isolation test | PASS | `security.test.ts` › "user B cannot see or modify user A pipeline, notes or drafts" |
| 4 | Demo data visibly fictional | PASS | e2e 1–3; Demo badge + `[DEMO]` summaries + example.com URLs (`quota.test.ts`); digest labelled (`ingestion.test.ts`) |
| 5 | Admin adds approved-source opportunity with provenance/attribution | PASS | `ingestion.test.ts` › approval → import → licence snapshot → publish with attribution |
| 6 | Search, filter, display, score, save, annotate, dismiss, report | PASS | e2e 2–5, 12; `quota.test.ts` › discovery tests; `security.test.ts` (save/notes) |
| 7 | Human-readable score reasons and restrictions | PASS | `scoring.test.ts`; `quota.test.ts` › "explains scores" |
| 8 | Unapproved source cannot feed subscriber results | PASS | `ingestion.test.ts` › blocked import, DB constraint, revoke hides, licensed adapter blocked |
| 9 | Entitlements and quotas server-enforced | PASS | `quota.test.ts` › once-per-period, concurrency, live-data gating, export gating |
| 10 | PayMongo sandbox incl. verification + duplicate webhooks | PASS (signature/idempotency with mock + PayMongo-format signatures) · BLOCKED (real sandbox) | `billing.test.ts`; real test-mode run needs keys + subscription activation |
| 11 | Cancellation and truthful billing status | PASS | `billing.test.ts` › cancellation keeps access to period end; disabled mode returns 503 + message |
| 12 | Secrets server-side; no credentials in logs | PASS (partial) | `security.test.ts` › config errors don't echo secrets; log redaction in `lib/log.ts` (not separately unit-tested) |
| 13 | Mobile/desktop accessibility & usability | PASS (basic) | e2e 10 (375 px, no horizontal scroll) and 11 (keyboard, focus); a full WCAG audit with assistive tech is still recommended |
| 14 | Tests and deployment scripts documented and run | PASS (unit/integration/e2e) · BLOCKED (staging deploy needs credentials) | README, DEPLOYMENT.md |
| 15 | Final report separates deployed / simulated / credential-gated / legal-gated | PASS | README → Status |

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
| 1 | Sign up and complete onboarding | PASS (e2e) |
| 2 | Search and filter demo opportunities | PASS (e2e) |
| 3 | View source and match explanation | PASS (e2e) |
| 4 | Save prospect, add notes, change stage | PASS (e2e) |
| 5 | Create and copy outreach draft | PASS (e2e) |
| 6 | Solo user sees and respects plan limits | PASS (e2e, exercised on the Free plan; same server function enforces Solo/Pro quotas — `quota.test.ts`) |
| 7 | Admin creates a properly attributed opportunity | PASS (e2e) |
| 8 | Normal user cannot see admin or other users' data | PASS (e2e) |
| 9 | Payment test mode updates entitlement only after verified webhook | PASS (e2e) |
| 10 | Mobile layout usable at 375 px | PASS (e2e) |
| 11 | Keyboard-only navigation of key controls | PASS (e2e) |
| 12 | Empty source / provider-error states understandable | PASS (e2e) |

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
