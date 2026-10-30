import { beforeAll, describe, expect, it } from 'vitest';
import { demoIds, ensureDemo, makeApp, setPlan, signup } from './helpers';

const h = makeApp();
beforeAll(async () => { await ensureDemo(h); });

describe('unlocks and quotas (server-enforced)', () => {
  it('charges an unlock only once per user/opportunity/period', async () => {
    const u = await signup(h);
    const [opp] = await demoIds(h, 1);
    const first = await h.call('POST', `/api/opportunities/${opp}/unlock`, { token: u.token });
    const second = await h.call('POST', `/api/opportunities/${opp}/unlock`, { token: u.token });
    expect(first.json.status).toBe('unlocked');
    expect(second.json.status).toBe('already_unlocked');
    expect((await h.call('GET', '/api/usage', { token: u.token })).json.unlocksUsed).toBe(1);
  });

  it('is concurrency-safe: parallel unlocks never exceed the plan limit', async () => {
    const u = await signup(h);
    const ids = await demoIds(h, 8); // free plan limit = 5
    const results = await Promise.all(ids.map((id) => h.call('POST', `/api/opportunities/${id}/unlock`, { token: u.token })));
    expect(results.filter((r) => r.status === 200)).toHaveLength(5);
    const limited = results.filter((r) => r.status === 402);
    expect(limited).toHaveLength(3);
    expect(limited[0]!.json.error.code).toBe('plan_limit_reached');
    expect(limited[0]!.json.error.details.remaining).toBe(0);
    const [n] = await h.deps.sql`select count(*)::int as n from opportunity_unlocks where user_id = ${u.id}`;
    expect(n!.n).toBe(5);
  });

  it('parallel duplicate unlocks of the same opportunity count once', async () => {
    const u = await signup(h);
    const [opp] = await demoIds(h, 1);
    await Promise.all(Array.from({ length: 6 }, () => h.call('POST', `/api/opportunities/${opp}/unlock`, { token: u.token })));
    expect((await h.call('GET', '/api/usage', { token: u.token })).json.unlocksUsed).toBe(1);
  });

  it('full detail and saving require an unlock', async () => {
    const u = await signup(h);
    const [, opp] = await demoIds(h, 2);
    const before = await h.call('GET', `/api/opportunities/${opp}`, { token: u.token });
    expect(before.json.full).toBeNull();
    expect((await h.call('POST', '/api/saved', { token: u.token, body: { opportunityId: opp } })).json.error.code).toBe('unlock_required');
    expect((await h.call('POST', '/api/outreach/draft', { token: u.token, body: { opportunityId: opp, templateCode: 'ghl_crm' } })).status).toBe(403);
    await h.call('POST', `/api/opportunities/${opp}/unlock`, { token: u.token });
    const after = await h.call('GET', `/api/opportunities/${opp}`, { token: u.token });
    expect(after.json.full.sourceUrl).toMatch(/^https:\/\/example\.com\/demo\//);
    expect(after.json.full.originalSummary).toMatch(/^\[DEMO\]/);
  });

  it('a paid plan raises the limit; free plan cannot unlock licensed live records', async () => {
    const u = await signup(h);
    await setPlan(h, u.id, 'solo');
    const usage = await h.call('GET', '/api/usage', { token: u.token });
    expect(usage.json.planCode).toBe('solo');
    expect(usage.json.unlockLimit).toBe(40);
    expect(new Date(usage.json.resetsAt).getTime()).toBeGreaterThan(Date.now());
  });

  it('CSV export is a Pro feature and escapes formula injection', async () => {
    const u = await signup(h);
    expect((await h.call('GET', '/api/export', { token: u.token })).json.error.code).toBe('plan_feature_unavailable');
    await setPlan(h, u.id, 'pro');
    const [opp] = await demoIds(h, 1);
    await h.call('POST', `/api/opportunities/${opp}/unlock`, { token: u.token });
    const s = await h.call('POST', '/api/saved', { token: u.token, body: { opportunityId: opp } });
    await h.call('PATCH', `/api/saved/${s.json.id}`, { token: u.token, body: { notes: '=HYPERLINK("http://evil")' } });
    const csv = await h.call('GET', '/api/export', { token: u.token });
    expect(csv.status).toBe(200);
    expect(csv.headers.get('content-type')).toContain('text/csv');
    expect(csv.text).toContain(`"'=HYPERLINK(""http://evil"")"`);
    expect(csv.text).toContain('DEMO — NOT A REAL LEAD');
  });
});

describe('discovery', () => {
  it('scores per user, hides restricted/expired roles, and explains scores', async () => {
    const crm = await signup(h, { prefs: { skills: ['ghl_crm', 'automation'] } });
    const ecom = await signup(h, { prefs: { skills: ['ecommerce'] } });
    const r1 = await h.call('GET', '/api/opportunities?minScore=0&pageSize=50', { token: crm.token });
    const r2 = await h.call('GET', '/api/opportunities?minScore=0&pageSize=50', { token: ecom.token });
    const coast1 = r1.json.items.find((i: any) => i.companyName === 'Demo Coastline Agency');
    const coast2 = r2.json.items.find((i: any) => i.companyName === 'Demo Coastline Agency');
    expect(coast1.score).toBeGreaterThan(coast2.score);
    expect(coast1.components).toHaveLength(4);
    expect(coast1.badges).toContain('Demo');
    expect(coast1.source.providerName).toBe('VA LeadFinder Demo Data');
    const names = r1.json.items.map((i: any) => i.companyName);
    expect(names).not.toContain('Demo Maple Realty Group'); // US residents only
    expect(names).not.toContain('Sample Expired Listing Co');
    expect(r1.json.hiddenCount).toBeGreaterThan(0);
    const withHidden = await h.call('GET', '/api/opportunities?minScore=0&pageSize=50&includeHidden=true', { token: crm.token });
    const maple = withHidden.json.items.find((i: any) => i.companyName === 'Demo Maple Realty Group');
    expect(maple.badges).toContain('Region restricted');
    expect(maple.exclusionReasons[0]).toMatch(/Philippines/);
  });

  it('filters by keyword, skill and remote eligibility, and paginates', async () => {
    const u = await signup(h);
    const q = await h.call('GET', '/api/opportunities?query=Coastline&minScore=0', { token: u.token });
    expect(q.json.items.map((i: any) => i.companyName)).toEqual(['Demo Coastline Agency']);
    const s = await h.call('GET', '/api/opportunities?skill=ecommerce&minScore=0', { token: u.token });
    expect(s.json.items.every((i: any) => i.skills.includes('ecommerce'))).toBe(true);
    const r = await h.call('GET', '/api/opportunities?remote=remote_eligible&minScore=0', { token: u.token });
    expect(r.json.items.every((i: any) => ['worldwide', 'philippines_ok'].includes(i.remoteEligibility))).toBe(true);
    const p = await h.call('GET', '/api/opportunities?minScore=0&pageSize=5&page=2', { token: u.token });
    expect(p.json.items.length).toBeLessThanOrEqual(5);
    expect((await h.call('GET', '/api/opportunities?page=999', { token: u.token })).status).toBe(400);
  });

  it('dismiss hides; feedback is recorded; demo mode off hides demo data', async () => {
    const u = await signup(h);
    const [opp] = await demoIds(h, 1);
    await h.call('POST', `/api/opportunities/${opp}/dismiss`, { token: u.token });
    const list = await h.call('GET', '/api/opportunities?minScore=0&pageSize=50', { token: u.token });
    expect(list.json.items.find((i: any) => i.id === opp)).toBeUndefined();
    expect((await h.call('POST', `/api/opportunities/${opp}/feedback`, { token: u.token, body: { reason: 'inaccurate', details: 'Wrong industry' } })).status).toBe(201);

    await h.deps.sql`update app_settings set demo_mode_enabled = false`;
    try {
      const off = await h.call('GET', '/api/opportunities?minScore=0', { token: u.token });
      expect(off.json.items).toHaveLength(0);
      expect((await h.call('GET', `/api/opportunities/${opp}`, { token: u.token })).status).toBe(404);
    } finally {
      await h.deps.sql`update app_settings set demo_mode_enabled = true`;
    }
  });

  it('dashboard returns honest counts only', async () => {
    const u = await signup(h);
    const d = await h.call('GET', '/api/dashboard', { token: u.token });
    expect(d.status).toBe(200);
    expect(d.json.savedCount).toBe(0);
    expect(d.json.topMatches.length).toBeGreaterThan(0);
    expect(Object.keys(d.json)).not.toContain('earnings');
  });
});
