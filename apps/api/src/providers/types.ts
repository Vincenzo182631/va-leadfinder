import type { OpportunityInput } from '@vlf/shared';

/** Row from public.source_providers (server-side view). */
export interface SourceProviderRow {
  id: string;
  name: string;
  api_identifier: string;
  provider_kind: 'synthetic_demo' | 'manual' | 'licensed_api';
  license_status: string;
  commercial_use_approved: boolean;
  redistribution_approved: boolean;
  approval_reference: string;
  approval_date: string | null;
  approved_by: string | null;
  attribution_text: string;
  allowed_usage: string;
  approved_scope: string;
  retention_days: number;
  enabled: boolean;
  compliance_checklist: Record<string, boolean>;
}

export interface RawRecord {
  externalId?: string;
  payload: unknown;
}

export interface FetchResult {
  records: RawRecord[];
  nextCursor: string | null;
}

export type Approval = { approved: true } | { approved: false; reason: string };

export interface OpportunityProvider {
  providerId: string; // api_identifier
  checkConfiguration(): { ok: true } | { ok: false; reason: string };
  checkCommercialApproval(row: SourceProviderRow): Approval;
  fetchNewOrUpdated(cursor: string | null): Promise<FetchResult>;
  normalize(raw: RawRecord): unknown; // validated afterwards with opportunityInputSchema
  sourceAttribution(row: SourceProviderRow): string;
  expiryPolicy(): { defaultTtlDays: number };
  /** Whether accepted records publish immediately (demo) or go to moderation. */
  initialQualityStatus(): 'published' | 'needs_review';
  isDemo: boolean;
}

export type NormalizedOpportunity = OpportunityInput;

/** The single fail-closed approval rule for any non-demo source. */
export function standardApproval(row: SourceProviderRow): Approval {
  const missing: string[] = [];
  if (!row.enabled) missing.push('source is disabled');
  if (row.license_status !== 'approved') missing.push(`license status is "${row.license_status}"`);
  if (!row.commercial_use_approved) missing.push('commercial use not approved');
  if (!row.redistribution_approved) missing.push('redistribution to subscribers not approved');
  if (!row.approval_reference) missing.push('no contract/permission reference recorded');
  if (!row.approval_date) missing.push('no approval date');
  if (!row.approved_by) missing.push('no approving administrator');
  if (!row.compliance_checklist?.termsReviewed || !row.compliance_checklist?.personalDataReviewed) missing.push('compliance checklist incomplete');
  return missing.length ? { approved: false, reason: `Source not approved for subscriber use: ${missing.join('; ')}` } : { approved: true };
}
