# VA LeadFinder — Product Requirements (MVP)

**Value proposition:** "Find businesses that need your skills. Turn opportunities into clients."
**Status:** MVP running locally with synthetic demo data and an admin-approved manual source workflow. No licensed live data source is active.

## 1. Personas

| Persona | Description | Primary need |
|---|---|---|
| **Filipino independent VA** (primary) | Philippines-based, works remotely for US small businesses. Skills: general admin/EA, GoHighLevel/CRM/automation, email marketing/social media. | Find US businesses with a documented need, judge fit and eligibility quickly, prepare honest outreach. |
| **Founder / admin** | Runs the product alone. | Approve sources legally, moderate records, monitor billing and usage, handle privacy and takedown requests. |

## 2. Goals

- A subscribed user finds several relevant, sourced opportunities **in 15 minutes or less**, understands why each fits, saves prospects and prepares outreach through a legitimate business channel.
- Every opportunity shows source, timestamp, freshness and verification status.
- Licensing is fail-closed: unapproved sources cannot reach subscribers.
- Entitlements are enforced server-side from verified payment events only.

## 3. Non-goals (MVP)

No LinkedIn scraping or login automation; no CAPTCHA/anti-bot evasion or proxies; no mass email, automated DMs or browser automation against third parties; no "exclusive" or guaranteed leads; no promise of being hired; no agency seats, reseller, affiliate, AI agent swarm or CRM integrations; no personal-contact enrichment.

## 4. Features

| Area | MVP scope | Status |
|---|---|---|
| Marketing site | Home, pricing (Solo/Pro; Founding only when enabled), FAQ, Terms/Privacy **placeholders for legal review**, demo vs live labelling | Web app (in progress) |
| Auth | Email sign-up/in, confirmation, forgot/reset, sign-out, protected routes, non-enumerating errors | Supabase Auth in prod; **local dev auth** (simulated, confirmation skipped) |
| Onboarding | 4 steps: profile (PH, Asia/Manila) → skills → industries/markets/US time zones/exclusions → work types, remote, responsibilities, alert frequency | API `POST /api/onboarding` |
| Dashboard | Greeting, new since last visit, saved, unreviewed high-fit, contacted, follow-ups due, last refresh, demo/live mode. No fabricated metrics | API `GET /api/dashboard` |
| Discover | Search, skill, industry, date, score range, remote/contract, source, new/viewed filters; badges New / Likely fit / Needs review / Region restricted / Stale / Demo; save/dismiss | API done |
| Opportunity detail | Score breakdown + reasons, restrictions, source attribution + link, freshness, contact route, notes, stage, follow-up, outreach draft, report | Full detail requires an **unlock** |
| Pipeline | Saved → Researching → Contacted → Follow-up due → Replied → Qualified → Not a fit; notes; follow-up date; CSV export (Pro) | API done |
| Outreach | 3 deterministic templates (general admin, GHL/CRM, marketing/social) using only confirmed details; compliance note; never sent automatically | API done |
| Account & billing | Profile/prefs, plan, usage + reset date, payment status, upgrade, change plan (next cycle), cancel, data export, deletion request | API done; PayMongo **mock** locally |
| Admin | Overview metrics, source/licence registry + compliance gate, manual create + CSV import, moderation, ingestion runs, users, billing events, feedback/takedowns, settings/flags, plan quotas, audit log, privacy requests | API done |
| Digest | Weekly/daily per plan and user choice; only new eligible records from digest-allowed sources; unsubscribe link | API done; email via **console** locally |

## 5. Plans (proposed, editable in Admin)

| Plan | PHP/mo | Unlocks/mo | Live data | Export | Digest |
|---|---|---|---|---|---|
| Free Preview | 0 | 5 | No (demo only) | No | Off |
| Solo | 799 | 40 | Yes | No | Weekly |
| Pro | 1,499 | 120 | Yes | Yes | Daily |
| Founding Beta | 499 | 40 | Yes | No | Weekly — capped cohort, disabled by default |

Quotas are placeholders until a data-cost test is done. No volume of real prospects is promised.

## 6. User journeys

1. **First visit → demo:** landing → "Explore a demo" → sign up → onboarding → Discover shows records labelled **DEMO DATA — NOT REAL LEADS**.
2. **Find & qualify:** filter by skill → open card → read score reasons + eligibility → unlock (counts against monthly allowance once per period) → see summary, source link, contact route.
3. **Save & work pipeline:** save → add notes, stage, follow-up date → generate and edit outreach draft → copy and send manually via the business's published route.
4. **Subscribe:** pricing → checkout → (PayMongo payment) → subscription becomes active **only after a verified webhook**.
5. **Cancel:** account → cancel → no further charges; paid features until period end.
6. **Admin activates a source:** create source → complete checklist + record written approval → approve → enable → import CSV → moderate → publish.

## 7. Acceptance criteria (summary)

See `ACCEPTANCE_TESTS.md` for the pass/fail list. Key rules:
- Demo data is always visibly labelled and never presented as real leads; hidden entirely when demo mode is off.
- "Remote" never implies Philippines eligibility; US-only / work-authorization / other-country restrictions are shown and excluded (default) or penalised (user choice).
- Scores are per user, 0–100, with human-readable reasons; 75+ High fit, 50–74 Potential fit, <50 hidden by default.
- Unapproved sources cannot feed subscriber results (API, ingestion and DB constraint).
- Limits enforced in Postgres; unlock charged once per user/opportunity/period; concurrency-safe.
- Users see only their own private data (RLS isolation test).
