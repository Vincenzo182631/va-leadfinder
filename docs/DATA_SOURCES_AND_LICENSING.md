# Data Sources and Licensing

> **Rule:** public visibility ≠ permission to resell. A source may reach paying subscribers only after a documented, written commercial and redistribution approval for **this exact use** (a signup-gated, paid SaaS). The system fails closed in three places: ingestion (`standardApproval`), RLS (`opportunity_is_servable`) and a database CHECK constraint.

## 1. Current status

| Source | Kind | Status | Served to subscribers? |
|---|---|---|---|
| VA LeadFinder Demo Data | `synthetic_demo` | Enabled, fictional only | Only while demo mode is on, always labelled **DEMO DATA — NOT REAL LEADS** |
| Manual approved sources | `manual` | Draft, disabled | No (needs the compliance gate) |
| Licensed API (placeholder) | `licensed_api` | Draft, disabled; `LICENSED_PROVIDER_ENABLED=false` | No (no contract) |

**Paid live sourcing is blocked pending provider authorization.**

## 2. Providers evaluated and NOT approved

| Provider | Why it is not used |
|---|---|
| **Remotive public API** | Its public API terms restrict use behind signup-gated access and require attribution. Using it in a paid, login-gated product needs Remotive's explicit permission for that exact commercial use. |
| **Adzuna API** | Public API terms require a written agreement for commercial prospecting / lead-generation use. |
| **SerpApi / search-data APIs** | A paid key covers API access; it does not by itself grant rights to redistribute or resell derived search results to SaaS subscribers. The underlying source sites' terms also apply. |
| **LinkedIn** | No scraping of pages, member profiles, jobs or authenticated views; no bots, cookies or third-party scraping workarounds. |

Re-evaluate any of these only with written permission recorded in the source record below.

## 3. Source record fields (`public.source_providers`)

| Field | Meaning |
|---|---|
| `name`, `homepage_url`, `api_identifier` | Provider identity |
| `provider_kind` | `synthetic_demo` / `manual` / `licensed_api` |
| `data_type` | What the data is (e.g. "job summaries") |
| `license_status` | `draft` → `pending_review` → `approved` / `rejected` / `expired` / `revoked` |
| `commercial_use_approved`, `redistribution_approved` | Both required for subscriber use |
| `digest_allowed` | May records appear in email digests |
| `allowed_usage`, `approved_scope` | Exact permitted use, copied from the agreement |
| `attribution_text` | Shown on every opportunity from this source |
| `approval_reference`, `license_evidence_url` | Contract/permission reference and where the evidence is stored |
| `approval_date`, `approved_by` | Set when an admin approves (approver = admin user id) |
| `compliance_checklist` | JSON of the six checklist booleans below |
| `retention_days` | Source records are purged after this many days (`runMaintenance`) |
| `enabled`, `notes` | Activation flag (DB-constrained) and internal notes |

Each ingested record (`source_records`) stores the provider, external id, original URL, observed/posted dates, a dedupe key, a raw-reference hash, allowed usage and a **licence snapshot** taken at ingestion time.

## 4. Compliance checklist (all required before `license_status = approved`)

| Key | Confirm |
|---|---|
| `termsReviewed` | Provider terms read in full for a paid, signup-gated SaaS |
| `commercialUseConfirmed` | Written permission for commercial use |
| `redistributionConfirmed` | Written permission to show records/derived data to subscribers |
| `attributionConfigured` | `attribution_text` matches the provider's requirement |
| `retentionConfigured` | `retention_days` matches the agreement |
| `personalDataReviewed` | No personal data, or a completed lawful-basis review / PIA (see SECURITY_AND_PRIVACY.md) |

## 5. Activation checklist

- [ ] Signed agreement or written permission covering paid SaaS display, storage, retention and attribution
- [ ] Source created in Admin → Sources (starts `draft`, disabled)
- [ ] `allowed_usage`, `approved_scope`, `attribution_text`, `retention_days`, `approval_reference`, `license_evidence_url` filled
- [ ] Six checklist items ticked; both approval booleans set
- [ ] Status set to **approved** (the API records approver and date and audit-logs it)
- [ ] Source **enabled** (refused by the API and the database unless the steps above are done)
- [ ] Test import of a few rows; review in the moderation queue; publish
- [ ] Calendar reminder for contract expiry; on expiry set status `expired` (auto-disables and hides records)

## 6. Manual CSV import

Admin → Import (`POST /api/admin/import`). You must confirm lawful basis. The limit is 1,000 rows per import. Rows are validated, scanned for personal data, deduplicated and placed in the moderation queue as `needs_review`.

Columns (header row required): `company_name, company_site, title, summary, industry, work_arrangement, remote_eligibility, engagement_type, restrictions, hiring_signals, outsourcing_evidence, skills, contact_route, source_url, external_id, posted_at, expires_at`

| Column | Values |
|---|---|
| `summary` | **Your own original summary** (20–2000 chars), not copied posting text |
| `industry` | One of the industries in `packages/shared/src/constants.ts` |
| `work_arrangement` | `remote` · `hybrid` · `onsite` · `unknown` |
| `remote_eligibility` | `worldwide` · `philippines_ok` · `unknown` · `us_only` · `other_restricted` |
| `engagement_type` | `contract` · `freelance` · `part_time` · `full_time` · `unknown` |
| `restrictions` | `;`-separated: `us_residents_only`, `us_work_authorization`, `onsite_required`, `other_country_only`, `timezone_overlap_required` |
| `hiring_signals` | `;`-separated `type:note`; types `active_posting`, `outsourcing_language`, `multiple_roles`, `growth_signal`, `tool_stack_match` |
| `skills` | `;`-separated skill codes (`general_va`, `executive_assistant`, `ghl_crm`, `automation`, `email_marketing`, `social_media`, `website_seo`, `customer_support`, `ecommerce`, `other`) |
| `contact_route` | Company URL or **generic** mailbox (`careers@`, `hello@`, …). Personal emails are rejected. |
| `source_url` | http(s) link to the original source |
| `posted_at`, `expires_at` | ISO dates (default expiry 30 days) |

Example:

```csv
company_name,company_site,title,summary,industry,work_arrangement,remote_eligibility,engagement_type,restrictions,hiring_signals,outsourcing_evidence,skills,contact_route,source_url,external_id,posted_at,expires_at
Example Partner Co,https://partner.example.com,Remote CRM Assistant,"Our summary: the company is looking for help maintaining its CRM pipelines and follow-up automations.",Marketing agency,remote,worldwide,contract,,active_posting:Listed on partner board;outsourcing_language:Contractors welcome,Contract role,ghl_crm;automation,https://partner.example.com/careers,https://partner.example.com/jobs/123,PB-123,2026-10-28,2026-12-01
```

**Rejected automatically:** personal emails or phone numbers in text, personal-mailbox contact routes, non-http(s) URLs, dates in the future or older than one year, expiry before the posting date, unknown enum values.

## 7. Display and takedowns

- Every opportunity shows the source name, attribution, posted/observed date, last-verified date, and Stale/Needs review badges.
- Users can report records (`inaccurate`, `expired`, `takedown_request`, …). An admin can resolve a report and **take down** the record (`quality_status = taken_down`, hidden immediately). Takedown requests sort first in the queue.
- Revoking, expiring or rejecting a licence disables the source and hides all its records.

## 8. Adding a licensed API later

Implement mapping only inside `apps/api/src/providers/licensed-api.ts` (`normalize`), keeping the vendor schema out of the rest of the app. Then set `LICENSED_PROVIDER_ENABLED=true`, add the credentials as Worker secrets and complete the activation checklist. Ingestion runs centrally on the cron schedule, never per subscriber or page view.
