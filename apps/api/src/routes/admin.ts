import { Hono } from 'hono';
import {
  adminOpportunityCreateSchema,
  adminOpportunityPatchSchema,
  adminSettingsPatchSchema,
  feedbackPatchSchema,
  importSchema,
  paginationSchema,
  planPatchSchema,
  sourceProviderPatchSchema,
  sourceProviderSchema,
} from '@vlf/shared';
import { z } from 'zod';
import { ApiError, notFound } from '../lib/errors';
import { jsonBody, requireAdmin, uuidParam } from '../middleware/core';
import { rateLimit } from '../middleware/rate-limit';
import { recordsFromCsv } from '../providers/manual';
import { providerFor } from '../providers/registry';
import type { SourceProviderRow } from '../providers/types';
import { audit } from '../services/audit';
import { runIngestion, runMaintenance } from '../services/ingestion';
import type { AppEnv } from '../types';

export const adminRoutes = new Hono<AppEnv>();
adminRoutes.use('*', requireAdmin);
adminRoutes.use('*', rateLimit('admin', 300, 60_000));

const page = (c: { req: { query(k: string): string | undefined } }) =>
  paginationSchema.parse({ page: c.req.query('page'), pageSize: c.req.query('pageSize') });

// ------------------------------------------------------------------ overview & metrics
adminRoutes.get('/overview', async (c) => {
  const { sql } = c.get('deps');
  const [users] = await sql`select count(*)::int as total,
      count(*) filter (where p.onboarding_completed)::int as onboarded,
      count(*) filter (where u.created_at > now() - interval '30 days')::int as new30
    from auth.users u left join profiles p on p.user_id = u.id`;
  const subs = await sql`select pl.code, pl.name, pl.php_amount, s.status, count(*)::int as n
    from subscriptions s join plans pl on pl.id = s.plan_id group by 1,2,3,4 order by 1,4`;
  const [activation] = await sql`select count(*)::int as n from (select user_id from saved_prospects group by user_id having count(*) >= 3) x`;
  const [webhooks] = await sql`select count(*) filter (where status = 'failed')::int as failed, count(*)::int as total,
      max(received_at) as last_received from billing_webhook_events where received_at > now() - interval '7 days'`;
  const [queues] = await sql`select
      (select count(*)::int from opportunities where quality_status = 'needs_review') as moderation,
      (select count(*)::int from opportunity_feedback where status = 'open') as feedback_open,
      (select count(*)::int from opportunity_feedback where status = 'open' and reason = 'takedown_request') as takedowns_open,
      (select count(*)::int from data_requests where status = 'pending') as data_requests_pending,
      (select count(*)::int from opportunities where quality_status = 'published' and is_demo) as demo_published,
      (select count(*)::int from opportunities where quality_status = 'published' and not is_demo) as live_published`;
  const events = await sql`select event, count(*)::int as n from product_events where created_at > now() - interval '30 days' group by 1 order by 1`;
  const feedbackByReason = await sql`select reason, count(*)::int as n from opportunity_feedback where created_at > now() - interval '30 days' group by 1`;
  const [churn] = await sql`select count(*)::int as cancelled30 from subscriptions where cancelled_at > now() - interval '30 days'`;
  const runs = await sql`select r.*, p.name as provider_name from ingestion_runs r join source_providers p on p.id = r.provider_id order by started_at desc limit 5`;
  const paying = subs.filter((s) => s.status === 'active').reduce((a, s) => a + s.n, 0);
  const mrrPhp = subs.filter((s) => s.status === 'active').reduce((a, s) => a + s.n * s.php_amount, 0);
  return c.json({
    users, subscriptions: subs, payingUsers: paying, estimatedMrrPhp: mrrPhp, activationUsers3Saved: activation?.n ?? 0,
    webhooks, queues, events, feedbackByReason, churn, recentRuns: runs,
    cost: { apiCostPerPayingUser: null, note: 'No paid data provider is active, so vendor API cost is ₱0. Track vendor invoices here once a licensed source is enabled.' },
  });
});

// ------------------------------------------------------------------ source & license registry
adminRoutes.get('/sources', async (c) => {
  const rows = await c.get('deps').sql`select s.*,
      (select count(*)::int from opportunities o where o.provider_id = s.id) as opportunity_count,
      (select max(started_at) from ingestion_runs r where r.provider_id = s.id) as last_run_at
    from source_providers s order by s.created_at`;
  return c.json({ items: rows });
});

adminRoutes.post('/sources', async (c) => {
  const b = await jsonBody(c, sourceProviderSchema);
  const { sql } = c.get('deps');
  const admin = c.get('claims')!.sub;
  // New sources always start disabled and in draft: they must pass the compliance gate.
  const [row] = await sql`insert into source_providers (name, homepage_url, api_identifier, provider_kind, data_type, license_status,
      allowed_usage, approved_scope, attribution_text, approval_reference, license_evidence_url, retention_days, digest_allowed, notes, enabled)
    values (${b.name}, ${b.homepageUrl}, ${b.apiIdentifier}, 'manual', ${b.dataType}, 'draft', ${b.allowedUsage}, ${b.approvedScope},
      ${b.attributionText}, ${b.approvalReference}, ${b.licenseEvidenceUrl}, ${b.retentionDays}, ${b.digestAllowed}, ${b.notes}, false)
    returning *`;
  await audit(sql, admin, 'source.create', 'source_provider', row!.id, { name: b.name });
  return c.json(row, 201);
});

adminRoutes.patch('/sources/:id', async (c) => {
  const id = uuidParam(c);
  const raw = (await jsonBody(c, { parse: (v: unknown) => v as Record<string, unknown> })) ?? {};
  const parsed = sourceProviderPatchSchema.parse(raw);
  // Apply only the fields actually sent (schema defaults must never overwrite stored approvals).
  const b = Object.fromEntries(Object.entries(parsed).filter(([k]) => k in raw)) as typeof parsed;
  const { sql } = c.get('deps');
  const admin = c.get('claims')!.sub;
  const updated = await sql.begin(async (tx) => {
    const [cur] = await tx`select * from source_providers where id = ${id} for update`;
    if (!cur) throw notFound('Source');
    const next = {
      name: b.name ?? cur.name,
      homepage_url: b.homepageUrl ?? cur.homepage_url,
      data_type: b.dataType ?? cur.data_type,
      allowed_usage: b.allowedUsage ?? cur.allowed_usage,
      approved_scope: b.approvedScope ?? cur.approved_scope,
      attribution_text: b.attributionText ?? cur.attribution_text,
      approval_reference: b.approvalReference ?? cur.approval_reference,
      license_evidence_url: b.licenseEvidenceUrl ?? cur.license_evidence_url,
      retention_days: b.retentionDays ?? cur.retention_days,
      commercial_use_approved: b.commercialUseApproved ?? cur.commercial_use_approved,
      redistribution_approved: b.redistributionApproved ?? cur.redistribution_approved,
      digest_allowed: b.digestAllowed ?? cur.digest_allowed,
      notes: b.notes ?? cur.notes,
      compliance_checklist: b.complianceChecklist ?? cur.compliance_checklist,
      license_status: b.licenseStatus ?? cur.license_status,
      enabled: b.enabled ?? cur.enabled,
      approval_date: b.approvalDate === undefined ? cur.approval_date : b.approvalDate,
      approved_by: cur.approved_by as string | null,
    };
    if (cur.provider_kind === 'synthetic_demo' && (b.licenseStatus || b.commercialUseApproved || b.redistributionApproved))
      throw new ApiError(400, 'validation_error', 'The demo source cannot be licensed for live use.');

    // Compliance review gate.
    if (b.licenseStatus === 'approved' && cur.license_status !== 'approved') {
      const cl = next.compliance_checklist as Record<string, boolean>;
      const missing = ['termsReviewed', 'commercialUseConfirmed', 'redistributionConfirmed', 'attributionConfigured', 'retentionConfigured', 'personalDataReviewed'].filter((k) => !cl?.[k]);
      if (missing.length) throw new ApiError(422, 'compliance_incomplete', `Complete the compliance checklist first: ${missing.join(', ')}`);
      if (!next.commercial_use_approved || !next.redistribution_approved)
        throw new ApiError(422, 'compliance_incomplete', 'Commercial use and redistribution to subscribers must both be approved in writing.');
      if (!next.approval_reference || !next.attribution_text)
        throw new ApiError(422, 'compliance_incomplete', 'Record the contract/permission reference and the required attribution text.');
      next.approved_by = admin;
      next.approval_date = next.approval_date ?? new Date().toISOString().slice(0, 10);
    }
    if (b.licenseStatus && ['rejected', 'revoked', 'expired', 'draft', 'pending_review'].includes(b.licenseStatus) && cur.provider_kind !== 'synthetic_demo') {
      next.enabled = false; // revoking a license disables the source immediately
    }
    if (next.enabled && !cur.enabled && cur.provider_kind !== 'synthetic_demo' && next.license_status !== 'approved')
      throw new ApiError(422, 'source_not_approved', 'Only approved sources can be enabled.');

    const [row] = await tx`update source_providers set
        name = ${next.name}, homepage_url = ${next.homepage_url}, data_type = ${next.data_type}, allowed_usage = ${next.allowed_usage},
        approved_scope = ${next.approved_scope}, attribution_text = ${next.attribution_text}, approval_reference = ${next.approval_reference},
        license_evidence_url = ${next.license_evidence_url}, retention_days = ${next.retention_days},
        commercial_use_approved = ${next.commercial_use_approved}, redistribution_approved = ${next.redistribution_approved},
        digest_allowed = ${next.digest_allowed}, notes = ${next.notes}, compliance_checklist = ${tx.json(next.compliance_checklist)},
        license_status = ${next.license_status}, enabled = ${next.enabled}, approval_date = ${next.approval_date}, approved_by = ${next.approved_by}
      where id = ${id} returning *`;
    await audit(tx, admin, 'source.update', 'source_provider', id, {
      changed: Object.keys(b), licenseStatus: next.license_status, enabled: next.enabled,
    });
    return row;
  });
  return c.json(updated);
});

// ------------------------------------------------------------------ opportunities & moderation
adminRoutes.get('/opportunities', async (c) => {
  const { sql } = c.get('deps');
  const p = page(c);
  const status = c.req.query('status');
  const rows = await sql`select o.id, o.company_name, o.title, o.industry, o.quality_status, o.is_demo, o.published_at, o.last_verified_at,
      o.expires_at, o.remote_eligibility, o.work_arrangement, o.contract_suitability, o.original_summary, o.contact_route, o.company_site,
      p.name as provider_name, r.original_url as source_url,
      (select count(*)::int from opportunity_feedback f where f.opportunity_id = o.id and f.status = 'open') as open_reports
    from opportunities o join source_providers p on p.id = o.provider_id join source_records r on r.id = o.source_record_id
    where ${status ? sql`o.quality_status = ${status}` : sql`true`}
    order by (o.quality_status = 'needs_review') desc, o.created_at desc
    limit ${p.pageSize} offset ${(p.page - 1) * p.pageSize}`;
  const [n] = await sql`select count(*)::int as n from opportunities where ${status ? sql`quality_status = ${status}` : sql`true`}`;
  return c.json({ items: rows, total: n?.n ?? 0, ...p });
});

async function sourceRow(c: { get: (k: 'deps') => AppEnv['Variables']['deps'] }, providerId: string) {
  const [row] = await c.get('deps').sql<SourceProviderRow[]>`select * from source_providers where id = ${providerId}`;
  if (!row) throw notFound('Source');
  return row;
}

adminRoutes.post('/opportunities', async (c) => {
  const b = await jsonBody(c, adminOpportunityCreateSchema);
  const deps = c.get('deps');
  const row = await sourceRow(c, b.providerId);
  if (row.provider_kind !== 'manual') throw new ApiError(400, 'validation_error', 'Manual opportunities must use a manual source.');
  const { providerId: _p, lawfulBasisConfirmed: _l, ...payload } = b;
  const result = await runIngestion(deps.sql, row, providerFor(row, deps, [{ externalId: payload.externalId, payload }]), { triggeredBy: `admin:${c.get('claims')!.sub}`, now: deps.now() });
  await audit(deps.sql, c.get('claims')!.sub, 'opportunity.create_manual', 'source_provider', row.id, { runId: result.runId, status: result.status });
  if (result.status === 'blocked') throw new ApiError(422, 'source_not_approved', result.error ?? 'Source not approved');
  if (result.accepted === 0 && result.duplicates === 0) throw new ApiError(422, 'record_rejected', 'Record rejected', result.rejections);
  return c.json(result, 201);
});

adminRoutes.patch('/opportunities/:id', async (c) => {
  const id = uuidParam(c);
  const b = await jsonBody(c, adminOpportunityPatchSchema);
  const { sql } = c.get('deps');
  const admin = c.get('claims')!.sub;
  const [cur] = await sql`select o.*, p.provider_kind, p.license_status, p.enabled from opportunities o join source_providers p on p.id = o.provider_id where o.id = ${id}`;
  if (!cur) throw notFound('Opportunity');
  if (b.qualityStatus === 'published' && !cur.is_demo && !(cur.license_status === 'approved' && cur.enabled))
    throw new ApiError(422, 'source_not_approved', 'Cannot publish: the source is not approved and enabled.');
  const [row] = await sql`update opportunities set
      quality_status = coalesce(${b.qualityStatus ?? null}, quality_status),
      last_verified_at = coalesce(${b.lastVerifiedAt ?? null}, last_verified_at),
      expires_at = ${b.expiresAt === undefined ? sql`expires_at` : b.expiresAt}
    where id = ${id} returning id, quality_status, last_verified_at, expires_at`;
  await audit(sql, admin, 'opportunity.update', 'opportunity', id, { qualityStatus: b.qualityStatus, reason: b.reason });
  return c.json(row);
});

adminRoutes.post('/import', rateLimit('import', 10, 60_000), async (c) => {
  const b = await jsonBody(c, importSchema);
  const deps = c.get('deps');
  const row = await sourceRow(c, b.providerId);
  if (row.provider_kind !== 'manual') throw new ApiError(400, 'validation_error', 'CSV import is only for manual sources.');
  let records;
  try {
    records = recordsFromCsv(b.csv);
  } catch (e) {
    throw new ApiError(400, 'invalid_csv', `CSV could not be parsed: ${(e as Error).message}`);
  }
  if (records.length === 0) throw new ApiError(400, 'invalid_csv', 'CSV has no data rows.');
  if (records.length > 1000) throw new ApiError(400, 'invalid_csv', 'Import at most 1,000 rows at a time.');
  const result = await runIngestion(deps.sql, row, providerFor(row, deps, records), { triggeredBy: `admin-import:${c.get('claims')!.sub}`, now: deps.now() });
  await audit(deps.sql, c.get('claims')!.sub, 'opportunity.import_csv', 'source_provider', row.id, { runId: result.runId, rows: records.length, status: result.status });
  return c.json(result, result.status === 'blocked' ? 422 : 200);
});

// ------------------------------------------------------------------ ingestion
adminRoutes.get('/ingestion-runs', async (c) => {
  const p = page(c);
  const rows = await c.get('deps').sql`select r.*, p.name as provider_name from ingestion_runs r join source_providers p on p.id = r.provider_id
    order by r.started_at desc limit ${p.pageSize} offset ${(p.page - 1) * p.pageSize}`;
  return c.json({ items: rows, ...p });
});

adminRoutes.post('/ingestion/run', rateLimit('ingest', 6, 60_000), async (c) => {
  const { providerId } = await jsonBody(c, z.object({ providerId: z.uuid() }));
  const deps = c.get('deps');
  const row = await sourceRow(c, providerId);
  if (row.provider_kind === 'manual') throw new ApiError(400, 'validation_error', 'Manual sources are imported, not fetched.');
  const result = await runIngestion(deps.sql, row, providerFor(row, deps), { triggeredBy: `admin:${c.get('claims')!.sub}`, now: deps.now() });
  await audit(deps.sql, c.get('claims')!.sub, 'ingestion.run', 'source_provider', row.id, { runId: result.runId, status: result.status });
  return c.json(result);
});

adminRoutes.post('/maintenance/run', async (c) => {
  const deps = c.get('deps');
  const r = await runMaintenance(deps.sql, deps.now());
  await audit(deps.sql, c.get('claims')!.sub, 'maintenance.run', 'system', null, r);
  return c.json(r);
});

// ------------------------------------------------------------------ users, billing, feedback
adminRoutes.get('/users', async (c) => {
  const p = page(c);
  const rows = await c.get('deps').sql`select u.id, u.email, u.created_at, pr.display_name, pr.onboarding_completed, pr.last_seen_at,
      current_plan_code(u.id) as plan_code,
      (select s.status from subscriptions s where s.user_id = u.id order by s.created_at desc limit 1) as subscription_status,
      (select count(*)::int from saved_prospects sp where sp.user_id = u.id) as saved_count
    from auth.users u left join profiles pr on pr.user_id = u.id order by u.created_at desc
    limit ${p.pageSize} offset ${(p.page - 1) * p.pageSize}`;
  return c.json({ items: rows, ...p });
});

adminRoutes.get('/billing-events', async (c) => {
  const p = page(c);
  const rows = await c.get('deps').sql`select id, provider_event_id, type, livemode, event_created_at, received_at, processed_at, status, safe_error_message
    from billing_webhook_events order by received_at desc limit ${p.pageSize} offset ${(p.page - 1) * p.pageSize}`;
  return c.json({ items: rows, ...p, billingMode: c.get('deps').billing.mode });
});

adminRoutes.get('/feedback', async (c) => {
  const status = c.req.query('status') ?? 'open';
  const rows = await c.get('deps').sql`select f.id, f.reason, f.details, f.status, f.created_at, f.resolution_note, o.id as opportunity_id,
      o.company_name, o.title, o.quality_status, o.is_demo
    from opportunity_feedback f join opportunities o on o.id = f.opportunity_id
    where ${status === 'all' ? c.get('deps').sql`true` : c.get('deps').sql`f.status = ${status}`}
    order by (f.reason = 'takedown_request') desc, f.created_at desc limit 200`;
  return c.json({ items: rows });
});

adminRoutes.patch('/feedback/:id', async (c) => {
  const id = uuidParam(c);
  const b = await jsonBody(c, feedbackPatchSchema);
  const { sql } = c.get('deps');
  const admin = c.get('claims')!.sub;
  const row = await sql.begin(async (tx) => {
    const [f] = await tx`update opportunity_feedback set status = ${b.status}, resolution_note = ${b.resolutionNote ?? null},
        resolved_by = ${admin}, resolved_at = now() where id = ${id} returning *`;
    if (!f) throw notFound('Feedback');
    if (b.takeDown) await tx`update opportunities set quality_status = 'taken_down' where id = ${f.opportunity_id}`;
    await audit(tx, admin, b.takeDown ? 'opportunity.take_down' : 'feedback.resolve', 'opportunity_feedback', id, { status: b.status, opportunityId: f.opportunity_id });
    return f;
  });
  return c.json(row);
});

// ------------------------------------------------------------------ settings & plans
adminRoutes.get('/settings', async (c) => {
  const { sql, billing, email, config } = c.get('deps');
  const [s] = await sql`select * from app_settings where id = 1`;
  const plans = await sql`select * from plans order by sort_order`;
  return c.json({
    settings: s, plans,
    integrations: {
      billing: { mode: billing.mode, configured: billing.configured },
      email: { provider: email.name, configured: email.configured },
      auth: { mode: config.AUTH_MODE },
      licensedProvider: { enabledFlag: config.LICENSED_PROVIDER_ENABLED, credentialsPresent: Boolean(config.APPROVED_OPPORTUNITY_PROVIDER_KEY) },
      environment: config.APP_ENV,
    },
  });
});

adminRoutes.patch('/settings', async (c) => {
  const b = await jsonBody(c, adminSettingsPatchSchema);
  const { sql, billing } = c.get('deps');
  if (b.checkoutEnabled && billing.mode === 'disabled') throw new ApiError(422, 'billing_unavailable', 'Configure PayMongo before enabling checkout.');
  const [row] = await sql`update app_settings set
      demo_mode_enabled = coalesce(${b.demoModeEnabled ?? null}, demo_mode_enabled),
      founding_member_enabled = coalesce(${b.foundingMemberEnabled ?? null}, founding_member_enabled),
      founding_member_cap = coalesce(${b.foundingMemberCap ?? null}, founding_member_cap),
      founding_promo_months = coalesce(${b.foundingPromoMonths ?? null}, founding_promo_months),
      grace_days = coalesce(${b.graceDays ?? null}, grace_days),
      checkout_enabled = coalesce(${b.checkoutEnabled ?? null}, checkout_enabled),
      updated_at = now() where id = 1 returning *`;
  await audit(sql, c.get('claims')!.sub, 'settings.update', 'app_settings', '1', b);
  return c.json(row);
});

adminRoutes.patch('/plans/:code', async (c) => {
  const code = c.req.param('code');
  const b = await jsonBody(c, planPatchSchema);
  const { sql } = c.get('deps');
  const [row] = await sql`update plans set
      monthly_unlock_limit = coalesce(${b.monthlyUnlockLimit ?? null}, monthly_unlock_limit),
      export_permission = coalesce(${b.exportPermission ?? null}, export_permission),
      active = coalesce(${b.active ?? null}, active),
      version = version + 1 where code = ${code} returning *`;
  if (!row) throw notFound('Plan');
  await audit(sql, c.get('claims')!.sub, 'plan.update', 'plan', code, b);
  return c.json(row);
});

adminRoutes.get('/audit-log', async (c) => {
  const p = page(c);
  return c.json({ items: await c.get('deps').sql`select * from admin_audit_log order by created_at desc limit ${p.pageSize} offset ${(p.page - 1) * p.pageSize}`, ...p });
});

// ------------------------------------------------------------------ privacy requests
adminRoutes.get('/data-requests', async (c) =>
  c.json({ items: await c.get('deps').sql`select d.*, u.email from data_requests d left join auth.users u on u.id = d.user_id order by (d.status = 'pending') desc, d.created_at desc limit 200` }),
);

adminRoutes.post('/data-requests/:id/complete', async (c) => {
  const id = uuidParam(c);
  const deps = c.get('deps');
  const admin = c.get('claims')!.sub;
  const [req] = await deps.sql`select * from data_requests where id = ${id} and status = 'pending'`;
  if (!req) throw notFound('Pending request');
  if (req.kind === 'delete' && req.user_id) {
    const subs = await deps.sql`select provider_subscription_id from subscriptions where user_id = ${req.user_id} and status in ('incomplete','active','past_due','unpaid')`;
    for (const s of subs) if (s.provider_subscription_id) await deps.billing.cancelSubscription({ providerSubscriptionId: s.provider_subscription_id, reason: 'other' });
    if (deps.config.AUTH_MODE === 'supabase') {
      const res = await fetch(`${deps.config.SUPABASE_URL}/auth/v1/admin/users/${req.user_id}`, {
        method: 'DELETE', headers: { apikey: deps.config.SUPABASE_SERVICE_ROLE_KEY, Authorization: `Bearer ${deps.config.SUPABASE_SERVICE_ROLE_KEY}` },
      });
      if (!res.ok) throw new ApiError(502, 'auth_delete_failed', `Auth provider refused deletion (${res.status})`);
    } else {
      await deps.sql`delete from auth.users where id = ${req.user_id}`;
    }
  }
  await deps.sql`update data_requests set status = 'completed', completed_at = now() where id = ${id}`;
  await audit(deps.sql, admin, `data_request.complete_${req.kind}`, 'data_request', id, {});
  return c.json({ ok: true });
});
