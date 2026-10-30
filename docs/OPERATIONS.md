# Operations Runbook

## 1. Monitoring

| What | Where | Alert when |
|---|---|---|
| API health | `GET /api/health` (db status, billing/auth mode) | Non-200 for 5 min (Cloudflare health check / uptime monitor) |
| Worker errors | Cloudflare Workers logs (JSON lines: `level`, `msg`, `requestId`) | `level:"error"` spikes; `msg:"unhandled"` |
| Webhooks | Admin → Billing events; overview `webhooks.failed` (7 days) | Any `failed`; no events for days while subscriptions exist |
| Ingestion | Admin → Ingestion runs (`blocked`/`failed`/`partial`, rejection samples) | Licensed run fails twice in a row |
| Moderation & reports | Admin overview queues (needs_review, open feedback, takedowns, privacy requests) | Takedown open > 48 h; privacy request > 10 days |
| Product health | Overview: activation (users with ≥3 saved), events (30 d), feedback by reason, churn, MRR estimate | — |

Every response carries `X-Request-Id`. Quote it when debugging a user report.

## 2. Cost controls

- Licensed sources are fetched **centrally** by cron (every 6 h), never per user or page view. Search scores at most 500 candidates per request.
- Per-route rate limits (in-memory per isolate). Add Cloudflare Rate Limiting rules for global limits.
- Quotas (`monthly_unlock_limit`) are editable per plan in Admin → Plans. Set them after a data-cost test.
- Vendor API cost per paying user: record vendor invoices against paying users (overview shows paying user count). It is currently ₱0, since no paid provider is active.
- Supabase: watch database size and egress; Cloudflare: Worker requests and CPU.

## 3. Playbooks

### Provider outage (licensed source)
1. Runs show `failed` with `Fetch failed: …`. Fetch already retries with backoff, and existing records stay served.
2. Records become **Stale** after 30 days unverified. No action is needed for short outages.
3. For a long outage, consider disabling the source; contact the vendor.

### Expired or terminated contract
1. Admin → Sources → set status `expired`/`revoked`. This disables the source immediately, and RLS hides all its records.
2. Purge data if the contract requires it: lower `retention_days`, then run maintenance (`POST /api/admin/maintenance/run`).
3. Record the change in source notes. The audit log captures it.

### Failed billing events
1. Admin → Billing events → read `safe_error_message` (`unknown_subscription`, `mode_mismatch`, `processing_error`, …).
2. Signature rejections (`401`) are logged as `webhook.rejected` with a reason. Check that `PAYMONGO_WEBHOOK_SECRET` matches the endpoint for this mode (test vs live).
3. PayMongo retries up to 12 times and disables an endpoint after 3 events exhaust their retries. Re-enable it in the PayMongo dashboard.
4. PayMongo does not resend missed events. Reconcile by retrieving the subscription in the PayMongo dashboard/API and correcting status via a re-sent event from the dashboard ("Retry a webhook event"). Do not hand-edit entitlements except as a documented last resort (audit it).
5. Failed renewals: subscription `past_due` keeps access for `grace_days` (Admin → Settings, default 3). PayMongo retries daily up to 3×; then `unpaid` removes paid access.

### Invalid opportunity report / takedown
1. Admin → Feedback (takedowns first). Verify against the source.
2. Resolve, or resolve **with takedown** (record hidden immediately; audit-logged).
3. If systemic, pause the source and fix the import.

### Privacy request
1. Export: self-service (instant JSON).
2. Deletion: Admin → Privacy requests → Complete (cancels billing, deletes auth user, cascades data). Confirm to the user by email within 15 days.
3. If the request concerns a person mentioned in an opportunity (should not happen), take the record down and check the source's personal-data review.

## 4. Backups and restore

- Production: enable **Supabase Point-in-Time Recovery** (paid plans) or daily backups.
- Weekly logical backup kept off-platform: `pg_dump --format=custom --no-owner "$DATABASE_URL" > vlf-$(date +%F).dump`, stored encrypted with limited access.
- Restore drill quarterly into a scratch project: `pg_restore --no-owner -d "$SCRATCH_URL" vlf-YYYY-MM-DD.dump`, then run `GET /api/health` and a smoke test.
- Never restore production data into local/dev environments.

## 5. Incident response

1. **Triage:** severity (S1 data exposure/payment errors · S2 outage · S3 degraded). Open an incident note with times.
2. **Contain:** rotate leaked secrets (`wrangler secret put …`, PayMongo webhook secret, Supabase keys); set `checkout_enabled=false`; disable affected sources; turn off demo mode if mislabelled data is shown.
3. **Assess:** use request ids, the audit log and billing events. Determine which personal data and users are affected.
4. **Notify:** personal data breach → NPC and affected data subjects within **72 hours** where RA 10173 requires; payment issues → affected users.
5. **Recover and review:** fix, add a regression test, and write a blameless postmortem.
