import { describe, expect, it } from 'vitest';
import {
  decideUnlock, dedupeKey, dedupeKeyMaterial, escapeCsvCell, findPersonalData, generateOutreachDraft, nextResetDate,
  normalizeContactRoute, opportunityInputSchema, opportunitySearchSchema, parseCsv, parseCsvObjects, periodKey,
  preferencesSchema, resolvePlanCode, toCsv, updateProspectSchema, httpUrl, checkoutSchema,
} from '../src';

describe('csv', () => {
  it('parses quoted fields, escaped quotes and CRLF', () => {
    expect(parseCsv('a,b\r\n"x, y","he said ""hi"""\n')).toEqual([['a', 'b'], ['x, y', 'he said "hi"']]);
  });
  it('parses multiline quoted cells into objects', () => {
    expect(parseCsvObjects('name,summary\nAcme,"line1\nline2"')).toEqual([{ name: 'Acme', summary: 'line1\nline2' }]);
  });
  it('throws on unterminated quotes', () => expect(() => parseCsv('"abc')).toThrow());
  it('neutralises formula injection on export', () => {
    expect(escapeCsvCell('=HYPERLINK("x")')).toBe(`"'=HYPERLINK(""x"")"`);
    expect(escapeCsvCell('+1')).toBe("'+1");
    expect(escapeCsvCell('@SUM')).toBe("'@SUM");
    expect(escapeCsvCell('-2')).toBe("'-2");
    expect(escapeCsvCell('plain')).toBe('plain');
    expect(escapeCsvCell(null)).toBe('');
  });
  it('builds csv with CRLF', () => expect(toCsv(['a'], [['1,2']])).toBe('a\r\n"1,2"\r\n'));
});

describe('dedupe', () => {
  it('prefers provider external id', () => {
    expect(dedupeKeyMaterial({ providerKey: 'p', externalId: ' 42 ', companyName: 'A', title: 'B', sourceUrl: 'https://x.com' })).toBe('p|ext|42');
  });
  it('normalises company suffixes, case, tracking params', async () => {
    const a = await dedupeKey({ providerKey: 'm', companyName: 'Acme, Inc.', title: 'Admin Assistant', sourceUrl: 'https://www.acme.com/jobs/1?utm_source=x' });
    const b = await dedupeKey({ providerKey: 'm', companyName: 'acme', title: 'admin  assistant', sourceUrl: 'https://acme.com/jobs/1/' });
    expect(a).toBe(b);
    expect(a).toMatch(/^[0-9a-f]{64}$/);
  });
  it('differs across providers', async () => {
    const x = { companyName: 'A', title: 'B', sourceUrl: 'https://a.com' };
    expect(await dedupeKey({ ...x, providerKey: '1' })).not.toBe(await dedupeKey({ ...x, providerKey: '2' }));
  });
});

describe('privacy', () => {
  it('flags personal emails and phone numbers but allows generic mailboxes', () => {
    expect(findPersonalData({ s: 'Email jane.doe@acme.com or call +1 (555) 123-4567' }).map((f) => f.kind).sort()).toEqual(['personal_email', 'phone_number']);
    expect(findPersonalData({ s: 'Apply via careers@acme.com' })).toEqual([]);
  });
  it('accepts URL or generic mailbox contact routes only', () => {
    expect(normalizeContactRoute('https://acme.com/contact')).toEqual({ ok: true, value: 'https://acme.com/contact' });
    expect(normalizeContactRoute('mailto:Hello@Acme.com')).toEqual({ ok: true, value: 'hello@acme.com' });
    expect(normalizeContactRoute('john.smith@acme.com').ok).toBe(false);
    expect(normalizeContactRoute('javascript:alert(1)').ok).toBe(false);
    expect(normalizeContactRoute('')).toEqual({ ok: true, value: '' });
  });
});

describe('schemas', () => {
  it('rejects non-http urls', () => {
    expect(httpUrl.safeParse('javascript:alert(1)').success).toBe(false);
    expect(httpUrl.safeParse('https://ok.com').success).toBe(true);
  });
  it('preferences require at least one skill and default PH-friendly settings', () => {
    expect(preferencesSchema.safeParse({ skills: [] }).success).toBe(false);
    const p = preferencesSchema.parse({ skills: ['general_va'] });
    expect(p.requireRemote).toBe(true);
    expect(p.excludeRegionRestricted).toBe(true);
    expect(p.markets).toEqual(['US']);
  });
  it('search parses comma lists and clamps paging', () => {
    const s = opportunitySearchSchema.parse({ skill: 'ghl_crm,automation', page: '2' });
    expect(s.skill).toEqual(['ghl_crm', 'automation']);
    expect(s.page).toBe(2);
    expect(opportunitySearchSchema.safeParse({ page: '999' }).success).toBe(false);
    expect(opportunitySearchSchema.safeParse({ skill: 'hacking' }).success).toBe(false);
  });
  it('opportunity input requires an original summary and a source url', () => {
    const r = opportunityInputSchema.safeParse({ companyName: 'Demo Co', title: 'VA', originalSummary: 'short', industry: 'Other', skills: ['general_va'], sourceUrl: 'ftp://x' });
    expect(r.success).toBe(false);
  });
  it('prospect update rejects empty patches and bad stages', () => {
    expect(updateProspectSchema.safeParse({}).success).toBe(false);
    expect(updateProspectSchema.safeParse({ stage: 'hired' }).success).toBe(false);
    expect(updateProspectSchema.safeParse({ stage: 'contacted' }).success).toBe(true);
  });
  it('checkout only accepts paid plan codes', () => {
    expect(checkoutSchema.safeParse({ planCode: 'free' }).success).toBe(false);
  });
});

describe('entitlements', () => {
  const now = new Date('2026-10-30T00:00:00Z');
  const base = { planCode: 'solo', currentPeriodEnd: '2026-11-15T00:00:00Z', pastDueSince: null };
  it('active → plan', () => expect(resolvePlanCode([{ ...base, status: 'active' }], now, 3)).toBe('solo'));
  it('past_due within grace → plan; after grace → free', () => {
    expect(resolvePlanCode([{ ...base, status: 'past_due', pastDueSince: '2026-10-28T00:00:00Z' }], now, 3)).toBe('solo');
    expect(resolvePlanCode([{ ...base, status: 'past_due', pastDueSince: '2026-10-26T00:00:00Z' }], now, 3)).toBe('free');
  });
  it('cancelled keeps access until period end', () => {
    expect(resolvePlanCode([{ ...base, status: 'cancelled' }], now, 3)).toBe('solo');
    expect(resolvePlanCode([{ ...base, status: 'cancelled', currentPeriodEnd: '2026-10-29T00:00:00Z' }], now, 3)).toBe('free');
  });
  it('incomplete / unpaid → free', () => {
    expect(resolvePlanCode([{ ...base, status: 'incomplete' }], now, 3)).toBe('free');
    expect(resolvePlanCode([{ ...base, status: 'unpaid' }], now, 3)).toBe('free');
  });
  it('period key and reset use Asia/Manila months', () => {
    expect(periodKey(new Date('2026-10-31T16:30:00Z'))).toBe('2026-11');
    expect(periodKey(new Date('2026-10-31T15:59:00Z'))).toBe('2026-10');
    expect(nextResetDate(new Date('2026-10-30T00:00:00Z')).toISOString()).toBe('2026-10-31T16:00:00.000Z');
  });
  const plan = { code: 'solo', monthlyUnlockLimit: 2, exportPermission: false, liveDataAccess: true };
  it('unlock decisions', () => {
    expect(decideUnlock({ plan, usedThisPeriod: 2, alreadyUnlocked: true, opportunityIsDemo: false })).toEqual({ allowed: true, alreadyUnlocked: true });
    expect(decideUnlock({ plan, usedThisPeriod: 2, alreadyUnlocked: false, opportunityIsDemo: false })).toEqual({ allowed: false, code: 'plan_limit_reached' });
    expect(decideUnlock({ plan: { ...plan, liveDataAccess: false }, usedThisPeriod: 0, alreadyUnlocked: false, opportunityIsDemo: false })).toEqual({ allowed: false, code: 'live_data_requires_paid_plan' });
    expect(decideUnlock({ plan: { ...plan, liveDataAccess: false }, usedThisPeriod: 0, alreadyUnlocked: false, opportunityIsDemo: true })).toEqual({ allowed: true, alreadyUnlocked: false });
  });
});

describe('outreach templates', () => {
  it('uses only confirmed details and placeholders for the rest', () => {
    const d = generateOutreachDraft('ghl_crm', { companyName: 'Demo Coastline Agency', roleTitle: 'CRM Assistant', confirmedNeed: 'Needs pipeline cleanup.', userName: '', userSkills: ['ghl_crm'] });
    expect(d.body).toContain('Demo Coastline Agency');
    expect(d.body).toContain('Needs pipeline cleanup.');
    expect(d.body).toContain('[Your name]');
    expect(d.body).not.toMatch(/referred|we met|years of experience|guarantee/i);
  });
});
