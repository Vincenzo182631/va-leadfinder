import type { Config } from '../env';
import { standardApproval, type OpportunityProvider } from './types';

/** fetch with timeout and bounded exponential-backoff retries (no retry on 4xx). */
export async function fetchWithRetry(url: string, init: RequestInit, opts = { retries: 2, timeoutMs: 15_000 }): Promise<Response> {
  let last: unknown;
  for (let i = 0; i <= opts.retries; i++) {
    try {
      const res = await fetch(url, { ...init, signal: AbortSignal.timeout(opts.timeoutMs) });
      if (res.status < 500 && res.status !== 429) return res;
      last = new Error(`HTTP ${res.status}`);
    } catch (e) {
      last = e;
    }
    if (i < opts.retries) await new Promise((r) => setTimeout(r, 500 * 2 ** i));
  }
  throw last instanceof Error ? last : new Error(String(last));
}

/**
 * Skeleton for a future licensed data provider. Disabled unless LICENSED_PROVIDER_ENABLED=true,
 * credentials are present, AND the source row has passed the compliance gate.
 * Map the vendor's schema inside `normalize` only — never leak it into the rest of the app.
 */
export function licensedApiProvider(cfg: Config): OpportunityProvider {
  return {
    providerId: 'licensed_api',
    isDemo: false,
    checkConfiguration() {
      if (!cfg.LICENSED_PROVIDER_ENABLED) return { ok: false, reason: 'LICENSED_PROVIDER_ENABLED is false' };
      if (!cfg.APPROVED_OPPORTUNITY_PROVIDER_KEY || !cfg.APPROVED_OPPORTUNITY_PROVIDER_BASE_URL)
        return { ok: false, reason: 'Licensed provider credentials are not configured' };
      return { ok: true };
    },
    checkCommercialApproval: standardApproval,
    async fetchNewOrUpdated(cursor) {
      const u = new URL('/opportunities', cfg.APPROVED_OPPORTUNITY_PROVIDER_BASE_URL);
      if (cursor) u.searchParams.set('cursor', cursor);
      u.searchParams.set('country', 'US');
      const res = await fetchWithRetry(u.toString(), { headers: { Authorization: `Bearer ${cfg.APPROVED_OPPORTUNITY_PROVIDER_KEY}` } });
      if (!res.ok) throw new Error(`Licensed provider HTTP ${res.status}`);
      const j = (await res.json()) as { items?: { id: string }[]; next_cursor?: string | null };
      return { records: (j.items ?? []).map((it) => ({ externalId: it.id, payload: it })), nextCursor: j.next_cursor ?? null };
    },
    normalize(raw) {
      // Placeholder mapping for a hypothetical vendor schema; replace once a contract and schema exist.
      const p = raw.payload as Record<string, unknown>;
      return {
        companyName: p.company_name, companySite: p.company_url ?? '', title: p.title,
        originalSummary: p.summary, industry: p.industry ?? 'Other', workArrangement: p.work_arrangement ?? 'unknown',
        remoteEligibility: p.eligibility ?? 'unknown', engagementType: p.employment_type ?? 'unknown',
        explicitRestrictions: p.restrictions ?? [], hiringSignals: [{ type: 'active_posting', note: 'Listed by licensed provider' }],
        outsourcingEvidence: '', skills: p.skills ?? [], contactRoute: p.apply_url ?? '', sourceUrl: p.url,
        externalId: raw.externalId, sourcePostedAt: p.posted_at ?? null, expiresAt: p.expires_at ?? null, country: 'US',
      };
    },
    sourceAttribution: (row) => row.attribution_text,
    expiryPolicy: () => ({ defaultTtlDays: 30 }),
    initialQualityStatus: () => 'needs_review',
  };
}
