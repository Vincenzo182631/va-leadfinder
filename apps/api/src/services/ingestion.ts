import {
  dedupeKey,
  findPersonalData,
  normalizeContactRoute,
  opportunityInputSchema,
  sha256Hex,
  type OpportunityInput,
} from '@vlf/shared';
import type { Sql, Tx } from '../db';
import { log } from '../lib/log';
import type { OpportunityProvider, SourceProviderRow } from '../providers/types';

export interface IngestionSummary {
  runId: string;
  status: 'succeeded' | 'partial' | 'failed' | 'blocked';
  fetched: number;
  accepted: number;
  rejected: number;
  duplicates: number;
  error?: string;
  rejections: { index: number; externalId?: string; reasons: string[] }[];
}

const DAY = 86_400_000;

/** Validate one normalized record. Returns reasons when it must be rejected. */
export function validateRecord(input: unknown, now: Date): { ok: true; value: OpportunityInput } | { ok: false; reasons: string[] } {
  const parsed = opportunityInputSchema.safeParse(input);
  if (!parsed.success) {
    return { ok: false, reasons: parsed.error.issues.slice(0, 6).map((i) => `${i.path.join('.') || 'record'}: ${i.message}`) };
  }
  const v = parsed.data;
  const reasons: string[] = [];

  // Data minimisation: no personal contact data in free text.
  const personal = findPersonalData({
    title: v.title,
    originalSummary: v.originalSummary,
    outsourcingEvidence: v.outsourcingEvidence,
    hiringSignals: v.hiringSignals.map((s) => s.note).join(' '),
  });
  if (personal.length) reasons.push(`Personal data not allowed (${[...new Set(personal.map((p) => `${p.kind} in ${p.field}`))].join(', ')})`);

  const route = normalizeContactRoute(v.contactRoute);
  if (!route.ok) reasons.push(`contactRoute: ${route.reason}`);
  else v.contactRoute = route.value;

  const posted = v.sourcePostedAt ? new Date(v.sourcePostedAt) : null;
  if (posted && posted.getTime() > now.getTime() + DAY) reasons.push('sourcePostedAt is in the future');
  if (posted && posted.getTime() < now.getTime() - 365 * DAY) reasons.push('sourcePostedAt is older than one year');
  if (v.expiresAt && posted && new Date(v.expiresAt).getTime() < posted.getTime()) reasons.push('expiresAt is before sourcePostedAt');

  return reasons.length ? { ok: false, reasons } : { ok: true, value: v };
}

/**
 * Run one ingestion pass for a provider. FAILS CLOSED: if the source row is not
 * approved for this exact use, nothing is fetched and the run is recorded as "blocked".
 */
export async function runIngestion(
  sql: Sql,
  row: SourceProviderRow,
  provider: OpportunityProvider,
  opts: { triggeredBy: string; now: Date; cursor?: string | null },
): Promise<IngestionSummary> {
  const [run] = await sql`insert into ingestion_runs (provider_id, triggered_by) values (${row.id}, ${opts.triggeredBy}) returning id`;
  const runId = run!.id as string;
  const summary: IngestionSummary = { runId, status: 'succeeded', fetched: 0, accepted: 0, rejected: 0, duplicates: 0, rejections: [] };

  const finish = async () => {
    await sql`update ingestion_runs set finished_at = now(), status = ${summary.status},
      fetched_count = ${summary.fetched}, accepted_count = ${summary.accepted}, rejected_count = ${summary.rejected},
      duplicate_count = ${summary.duplicates}, error_message = ${summary.error ?? null},
      rejection_samples = ${sql.json(summary.rejections.slice(0, 20) as never)}
      where id = ${runId}`;
    log('info', 'ingestion.finished', { provider: row.api_identifier, ...summary, rejections: summary.rejections.length });
    return summary;
  };

  const approval = provider.checkCommercialApproval(row);
  if (!approval.approved) {
    summary.status = 'blocked';
    summary.error = approval.reason;
    return finish();
  }
  const configured = provider.checkConfiguration();
  if (!configured.ok) {
    summary.status = 'blocked';
    summary.error = configured.reason;
    return finish();
  }

  let records;
  try {
    records = (await provider.fetchNewOrUpdated(opts.cursor ?? null)).records;
  } catch (err) {
    summary.status = 'failed';
    summary.error = `Fetch failed: ${String(err instanceof Error ? err.message : err).slice(0, 300)}`;
    return finish();
  }
  summary.fetched = records.length;

  const licenseSnapshot = {
    licenseStatus: row.license_status,
    commercialUseApproved: row.commercial_use_approved,
    redistributionApproved: row.redistribution_approved,
    approvalReference: row.approval_reference,
    approvalDate: row.approval_date,
    approvedScope: row.approved_scope,
    attribution: provider.sourceAttribution(row),
    capturedAt: opts.now.toISOString(),
  };
  const ttl = provider.expiryPolicy().defaultTtlDays;

  for (const [index, raw] of records.entries()) {
    const checked = validateRecord(provider.normalize(raw), opts.now);
    if (!checked.ok) {
      summary.rejected++;
      summary.rejections.push({ index, externalId: raw.externalId, reasons: checked.reasons });
      continue;
    }
    const v = checked.value;
    const key = await dedupeKey({ providerKey: row.api_identifier, externalId: v.externalId, companyName: v.companyName, title: v.title, sourceUrl: v.sourceUrl });
    try {
      const outcome = await sql.begin((tx) => insertRecord(tx, { row, provider, runId, v, key, licenseSnapshot, ttl, now: opts.now }));
      if (outcome === 'duplicate') summary.duplicates++;
      else summary.accepted++;
    } catch (err) {
      summary.rejected++;
      summary.rejections.push({ index, externalId: raw.externalId, reasons: [`Database rejected record: ${String(err).slice(0, 200)}`] });
    }
  }
  if (summary.rejected > 0 && summary.accepted + summary.duplicates > 0) summary.status = 'partial';
  if (summary.rejected > 0 && summary.accepted + summary.duplicates === 0) summary.status = 'failed';
  return finish();
}

async function insertRecord(
  tx: Tx,
  p: {
    row: SourceProviderRow;
    provider: OpportunityProvider;
    runId: string;
    v: OpportunityInput;
    key: string;
    licenseSnapshot: Record<string, unknown>;
    ttl: number;
    now: Date;
  },
): Promise<'accepted' | 'duplicate'> {
  const { v, now } = p;
  const rawHash = await sha256Hex(JSON.stringify(v));
  const inserted = await tx`
    insert into source_records (provider_id, ingestion_run_id, external_id, dedupe_key, original_url, observed_at,
      source_posted_at, raw_reference_hash, allowed_usage, license_snapshot, retain_until)
    values (${p.row.id}, ${p.runId}, ${v.externalId ?? null}, ${p.key}, ${v.sourceUrl}, ${now.toISOString()},
      ${v.sourcePostedAt ?? null}, ${rawHash}, ${p.row.allowed_usage}, ${tx.json(p.licenseSnapshot as never)},
      ${new Date(now.getTime() + p.row.retention_days * DAY).toISOString()})
    on conflict do nothing
    returning id`;

  if (inserted.length === 0) {
    // Seen before: refresh verification timestamp (re-observed at source), keep everything else.
    await tx`update opportunities o set last_verified_at = ${v.lastVerifiedAt ?? now.toISOString()}
      from source_records r where r.id = o.source_record_id and r.dedupe_key = ${p.key}`;
    await tx`update source_records set observed_at = ${now.toISOString()} where dedupe_key = ${p.key}`;
    return 'duplicate';
  }
  const recordId = inserted[0]!.id as string;
  const expiresAt = v.expiresAt ?? new Date(now.getTime() + p.ttl * DAY).toISOString();
  const quality = new Date(expiresAt).getTime() <= now.getTime() ? 'expired' : p.provider.initialQualityStatus();

  const [opp] = await tx`
    insert into opportunities (source_record_id, provider_id, company_name, company_site, title, original_summary, industry,
      country, work_arrangement, remote_eligibility, contract_suitability, explicit_restrictions, hiring_signals,
      outsourcing_evidence, contact_route, published_at, last_verified_at, expires_at, quality_status, is_demo)
    values (${recordId}, ${p.row.id}, ${v.companyName}, ${v.companySite || null}, ${v.title}, ${v.originalSummary}, ${v.industry},
      ${v.country}, ${v.workArrangement}, ${v.remoteEligibility}, ${v.engagementType}, ${v.explicitRestrictions},
      ${tx.json(v.hiringSignals as never)}, ${v.outsourcingEvidence}, ${v.contactRoute || null},
      ${v.sourcePostedAt ?? now.toISOString()}, ${v.lastVerifiedAt ?? now.toISOString()}, ${expiresAt}, ${quality}, ${p.provider.isDemo})
    returning id`;
  for (const s of new Set(v.skills)) {
    await tx`insert into opportunity_skill_tags (opportunity_id, skill_code) values (${opp!.id}, ${s}) on conflict do nothing`;
  }
  return 'accepted';
}

/** Daily maintenance: expire past-date records and purge source data beyond retention. */
export async function runMaintenance(sql: Sql, now: Date) {
  const expired = await sql`update opportunities set quality_status = 'expired'
    where quality_status in ('published','needs_review') and expires_at is not null and expires_at <= ${now.toISOString()} returning id`;
  // Retention: deleting the source record cascades to the opportunity and anything derived from it.
  const purged = await sql`delete from source_records where retain_until is not null and retain_until <= ${now.toISOString()} returning id`;
  return { expired: expired.length, purged: purged.length };
}
