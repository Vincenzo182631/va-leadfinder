import { parseCsvObjects } from '@vlf/shared';
import { standardApproval, type OpportunityProvider, type RawRecord } from './types';

/** Columns accepted by the admin CSV import (see docs/DATA_SOURCES_AND_LICENSING.md). */
export const MANUAL_CSV_COLUMNS = [
  'company_name', 'company_site', 'title', 'summary', 'industry', 'work_arrangement', 'remote_eligibility',
  'engagement_type', 'restrictions', 'hiring_signals', 'outsourcing_evidence', 'skills', 'contact_route',
  'source_url', 'external_id', 'posted_at', 'expires_at',
] as const;

const list = (v: string | undefined) => (v ? v.split(/[;|]/).map((s) => s.trim()).filter(Boolean) : []);

export function csvRowToPayload(r: Record<string, string>) {
  return {
    companyName: r.company_name ?? '',
    companySite: r.company_site ?? '',
    title: r.title ?? '',
    originalSummary: r.summary ?? '',
    industry: r.industry ?? '',
    workArrangement: r.work_arrangement || 'unknown',
    remoteEligibility: r.remote_eligibility || 'unknown',
    engagementType: r.engagement_type || 'unknown',
    explicitRestrictions: list(r.restrictions),
    hiringSignals: list(r.hiring_signals).map((s) => {
      const i = s.indexOf(':');
      return i > 0 ? { type: s.slice(0, i).trim(), note: s.slice(i + 1).trim() } : { type: s, note: '' };
    }),
    outsourcingEvidence: r.outsourcing_evidence ?? '',
    skills: list(r.skills),
    contactRoute: r.contact_route ?? '',
    sourceUrl: r.source_url ?? '',
    externalId: r.external_id || undefined,
    sourcePostedAt: r.posted_at || null,
    expiresAt: r.expires_at || null,
    country: 'US',
  };
}

/** Admin-entered records. Records are supplied by the admin, never fetched from third parties. */
export function manualProvider(apiIdentifier: string, supplied: RawRecord[]): OpportunityProvider {
  return {
    providerId: apiIdentifier,
    isDemo: false,
    checkConfiguration: () => ({ ok: true }),
    checkCommercialApproval: standardApproval,
    async fetchNewOrUpdated() {
      return { records: supplied, nextCursor: null };
    },
    normalize: (raw) => raw.payload,
    sourceAttribution: (row) => row.attribution_text,
    expiryPolicy: () => ({ defaultTtlDays: 30 }),
    initialQualityStatus: () => 'needs_review',
  };
}

export function recordsFromCsv(csv: string): RawRecord[] {
  return parseCsvObjects(csv).map((r) => ({ externalId: r.external_id || undefined, payload: csvRowToPayload(r) }));
}
