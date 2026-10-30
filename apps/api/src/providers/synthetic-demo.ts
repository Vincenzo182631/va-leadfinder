import { DEMO_ROWS } from './demo-data';
import type { OpportunityProvider, RawRecord } from './types';

const DAY = 86_400_000;

/** Always-available, clearly fictional demo source. Served only while demo mode is enabled. */
export function syntheticDemoProvider(now: () => Date): OpportunityProvider {
  return {
    providerId: 'synthetic_demo',
    isDemo: true,
    checkConfiguration: () => ({ ok: true }),
    checkCommercialApproval: (row) =>
      row.provider_kind === 'synthetic_demo' && row.enabled
        ? { approved: true }
        : { approved: false, reason: 'Demo provider is disabled' },
    async fetchNewOrUpdated() {
      const t = now().getTime();
      const records: RawRecord[] = DEMO_ROWS.map((r) => ({
        externalId: `demo-${r[0]}`,
        payload: {
          companyName: r[1],
          companySite: `https://example.com/demo/companies/${r[0]}`,
          title: r[2],
          industry: r[3],
          skills: r[4],
          workArrangement: r[5],
          remoteEligibility: r[6],
          engagementType: r[7],
          explicitRestrictions: r[8],
          hiringSignals: r[9].map(([type, note]) => ({ type, note })),
          outsourcingEvidence: r[10],
          originalSummary: `[DEMO] ${r[11]}`,
          contactRoute: `https://example.com/demo/companies/${r[0]}/contact`,
          sourceUrl: `https://example.com/demo/opportunities/${r[0]}`,
          sourcePostedAt: new Date(t - r[12] * DAY).toISOString(),
          lastVerifiedAt: new Date(t - r[13] * DAY).toISOString(),
          expiresAt: r[14] === null ? null : new Date(t + r[14] * DAY).toISOString(),
          country: 'US',
        },
      }));
      return { records, nextCursor: null };
    },
    normalize: (raw) => ({ ...(raw.payload as object), externalId: raw.externalId }),
    sourceAttribution: (row) => row.attribution_text || 'Fictional demo data',
    expiryPolicy: () => ({ defaultTtlDays: 30 }),
    initialQualityStatus: () => 'published',
  };
}
