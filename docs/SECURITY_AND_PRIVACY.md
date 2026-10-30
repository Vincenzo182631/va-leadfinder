# Security and Privacy

> Legal documents (Terms of Service, Privacy Policy) in the web app are **placeholders requiring review by a qualified Philippine lawyer**. Nothing here is legal advice or a claim of compliance certification.

## 1. Threat model (summary)

| Threat | Control (implemented) |
|---|---|
| User reads another user's data | Postgres RLS on all tables; API queries run as `authenticated` with JWT claims; isolation test in `apps/api/test/security.test.ts` |
| Bypassing paywall via direct DB/PostgREST | Column grants hide gated fields; full detail only via `get_opportunity_full()` after unlock |
| Quota abuse / race conditions | `unlock_opportunity()` with per-user advisory lock + unique `(user, opportunity, period)`; parallel-request test |
| Forged payment success | Entitlement only from HMAC-verified PayMongo webhooks (raw body, timing-safe compare, 300 s timestamp tolerance); never from redirects |
| Webhook replay / duplicates / reordering | Unique provider event id; `last_event_at` ordering; cancelled never re-opened |
| Admin impersonation | Admin = `ADMIN_USER_IDS` on the server; client flags ignored |
| Unlicensed data reaching subscribers | Fail-closed ingestion + RLS servability + DB CHECK constraint |
| Secret leakage | Secrets only in server env / Worker secrets; config errors never echo values; log redaction of keys, tokens, emails, `sk_`/`pk_` keys |
| XSS / injection | React escaping (no raw HTML from data); parameterised SQL (postgres.js tagged templates); Zod validation on every mutation; http(s)-only URLs |
| CSV formula injection | Export cells starting with `= + - @` tab or CR are prefixed with `'` |
| Brute force / scraping | Rate limits on auth, search, detail, unlock, export, admin, webhooks (per isolate; add Cloudflare rules in prod) |
| Dev shortcuts in prod | `AUTH_MODE=local` refused in staging/production; `PAYMONGO_MODE=mock` refused in production; dev routes not mounted |
| Clickjacking / transport | `secure-headers` middleware; HSTS in production; HTTPS only via Cloudflare |

## 2. Data inventory

| Data | Source | Purpose | Where | Retention | Personal? |
|---|---|---|---|---|---|
| Email, password hash | User | Account | Supabase Auth | Until deletion | Yes |
| Display name, country, time zone | User | Personalisation | `profiles` | Until deletion | Yes (low) |
| Skills, industries, work preferences | User | Matching | `user_preferences` | Until deletion | Yes (low) |
| Saved prospects, notes, drafts | User | Pipeline | `saved_prospects`, `outreach_drafts` | Until deletion / source purge | Yes (user content) |
| Unlocks, usage, product events (no free-text payloads) | System | Quotas, product analytics | `opportunity_unlocks`, `usage_events`, `product_events` | Until deletion | Pseudonymous |
| Subscription status, PayMongo customer/subscription ids | PayMongo | Billing | `subscriptions` | Until deletion; finance records per accounting law | Yes (no card data stored) |
| Webhook event summaries | PayMongo | Audit | `billing_webhook_events` (type, ids, status only) | Review annually | Minimal |
| Opportunity records | Licensed/manual/demo source | Product content | `opportunities`, `source_records` | `retention_days` per source | **Company-level only**; personal data rejected |
| Admin actions | Admin | Accountability | `admin_audit_log` | Review annually | Admin id only |

No sensitive personal information (as defined by RA 10173) is collected. No card data touches our servers. Card details go from the browser straight to PayMongo.

## 3. Philippine Data Privacy Act (RA 10173) and NPC 2026 scraping advisory

The NPC's 2026 advisory on scraping publicly available personal data says public availability is **not** unrestricted permission. Before processing any personal data from a source:

**Lawful-basis review (per source)**
- [ ] What personal data, if any, does the source contain? (The default design rejects it.)
- [ ] Lawful basis under Sec. 12 (consent, contract, legitimate interest with balancing test, etc.) documented
- [ ] Purpose limitation: used only to show business opportunities to subscribers
- [ ] Data minimisation: only company-level fields; no individual names, personal emails or phones
- [ ] Transparency: privacy notice explains opportunity-data processing and how businesses can request removal
- [ ] Source terms permit the processing (see DATA_SOURCES_AND_LICENSING.md)

**Privacy Impact Assessment prompts**
1. What is the processing, who are the data subjects, and what volume?
2. Is each field necessary? Can it be dropped or generalised?
3. Could individuals be identified or contacted without expecting it?
4. What are the risks (unsolicited contact, inaccuracy, re-identification), and what are the mitigations?
5. Retention period and deletion method?
6. Cross-border transfer (Supabase/Cloudflare regions) — documented and covered by agreements?
7. Who has access (admin only), and is it logged?
8. Incident/breach response: NPC notification within 72 hours where required.

Also: register with the NPC if registration thresholds apply, appoint a Data Protection Officer, and keep a record of processing activities. **These need legal confirmation.**

**Recipient-country marketing law:** outreach drafts are only sent by the user, one at a time, through a published business route. The template note reminds users to follow US CAN-SPAM and to honour opt-outs. The product sends no cold outreach.

## 4. Data subject rights flows

| Right | Flow (implemented) |
|---|---|
| Access / portability | Account → "Export my data" → `POST /api/account/export-request` returns JSON of profile, preferences, pipeline, drafts, feedback, subscriptions, unlocks; logged in `data_requests` |
| Erasure | Account → "Request deletion" → `data_requests` (pending) → Admin → Privacy requests → Complete. This cancels provider subscriptions, deletes the auth user (Supabase Admin API) and cascades all user rows. Target: within 15 days. |
| Objection to digests | One-click unsubscribe link (hashed single-use token) or preferences page |
| Business removal / correction | Report → `takedown_request` → admin takedown |

## 5. Operational security checklist

- [ ] Separate Supabase projects and PayMongo keys for staging and production
- [ ] `SUPABASE_SERVICE_ROLE_KEY`, PayMongo secret and webhook secrets only as Worker secrets
- [ ] Rotate the webhook secret on any suspicion of exposure
- [ ] MFA on Supabase, Cloudflare, PayMongo, GitHub and email provider accounts
- [ ] Cloudflare WAF and rate-limiting rules on `/api/dev-auth/*` (should 404 in prod), `/api/opportunities*`, `/api/export`, `/api/admin/*`
- [ ] Review the admin audit log monthly
