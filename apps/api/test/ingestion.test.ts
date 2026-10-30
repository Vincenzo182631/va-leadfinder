import { beforeAll, describe, expect, it } from 'vitest';
import { providerFor } from '../src/providers/registry';
import type { SourceProviderRow } from '../src/providers/types';
import { runIngestion } from '../src/services/ingestion';
import { ADMIN_ID, ensureDemo, makeApp, signup } from './helpers';

const h = makeApp();
let admin: Awaited<ReturnType<typeof signup>>;
let user: Awaited<ReturnType<typeof signup>>;
const CHECKLIST = { termsReviewed: true, commercialUseConfirmed: true, redistributionConfirmed: true, attributionConfigured: true, retentionConfigured: true, personalDataReviewed: true };

const csv = (rows: string[]) => [
  'company_name,company_site,title,summary,industry,work_arrangement,remote_eligibility,engagement_type,restrictions,hiring_signals,outsourcing_evidence,skills,contact_route,source_url,external_id,posted_at,expires_at',
  ...rows,
].join('\n');
const goodRow = (ext: string, company = 'Zephyr Test Co') =>
  `${company},https://partner.example.com,Remote CRM Assistant,"Original summary written by our team about the CRM support need.",Marketing agency,remote,worldwide,contract,,active_posting:Posted on partner board;outsourcing_language:Contractors welcome,Contract,ghl_crm;automation,https://partner.example.com/careers,https://partner.example.com/jobs/${ext},${ext},${new Date().toISOString()},`;

beforeAll(async () => {
  await ensureDemo(h);
  admin = await signup(h, { id: ADMIN_ID });
  user = await signup(h, { prefs: { skills: ['ghl_crm', 'automation'] } });
});

describe('source licensing gate (fail closed)', () => {
  let sourceId: string;
  it('new sources start disabled and in draft; imports are blocked', async () => {
    const s = await h.call('POST', '/api/admin/sources', { token: admin.token, body: { name: 'Partner Board', homepageUrl: 'https://partner.example.com', apiIdentifier: 'partner_board', dataType: 'Job summaries' } });
    expect(s.status).toBe(201);
    expect(s.json.enabled).toBe(false);
    sourceId = s.json.id;
    const r = await h.call('POST', '/api/admin/import', { token: admin.token, body: { providerId: sourceId, csv: csv([goodRow('A1')]), lawfulBasisConfirmed: true } });
    expect(r.status).toBe(422);
    expect(r.json.status).toBe('blocked');
    expect(r.json.accepted).toBe(0);
    const [run] = await h.deps.sql`select status, error_message from ingestion_runs where id = ${r.json.runId}`;
    expect(run!.status).toBe('blocked');
    expect(run!.error_message).toMatch(/commercial use not approved/);
  });

  it('cannot enable or approve without the compliance checklist and written approvals', async () => {
    expect((await h.call('PATCH', `/api/admin/sources/${sourceId}`, { token: admin.token, body: { enabled: true } })).json.error.code).toBe('source_not_approved');
    const r = await h.call('PATCH', `/api/admin/sources/${sourceId}`, { token: admin.token, body: { licenseStatus: 'approved' } });
    expect(r.json.error.code).toBe('compliance_incomplete');
  });

  it('the database itself refuses enabling an unapproved source', async () => {
    await expect(h.deps.sql`update source_providers set enabled = true where id = ${sourceId}`).rejects.toThrow(/source_enable_requires_approval/);
  });

  it('after approval, imports go to moderation with provenance, and personal data is rejected', async () => {
    const ok = await h.call('PATCH', `/api/admin/sources/${sourceId}`, { token: admin.token, body: {
      complianceChecklist: CHECKLIST, commercialUseApproved: true, redistributionApproved: true,
      approvalReference: 'Partner agreement #PB-2026-01 (signed)', attributionText: 'Listing summaries via Partner Board', licenseStatus: 'approved',
    } });
    expect(ok.status).toBe(200);
    expect(ok.json.approved_by).toBe(ADMIN_ID);
    expect((await h.call('PATCH', `/api/admin/sources/${sourceId}`, { token: admin.token, body: { enabled: true } })).json.enabled).toBe(true);

    const bad = 'Bad Co,,Admin VA,"Contact jane.doe@badco.com or +1 555 123 4567 for details today.",Other,remote,worldwide,contract,,,,general_va,,https://bad.example.com/j/1,B1,,';
    const personalRoute = 'Bad Two,,Admin VA,"A long enough original summary for the role here.",Other,remote,worldwide,contract,,,,general_va,john.smith@badtwo.com,https://bad2.example.com/j/1,B2,,';
    const r = await h.call('POST', '/api/admin/import', { token: admin.token, body: { providerId: sourceId, csv: csv([goodRow('A1'), goodRow('A2', 'Zephyr Two LLC'), bad, personalRoute, 'x,,y,,,,,,,,,,,ftp://nope,,,'] ), lawfulBasisConfirmed: true } });
    expect(r.json.status).toBe('partial');
    expect(r.json.accepted).toBe(2);
    expect(r.json.rejected).toBe(3);
    expect(JSON.stringify(r.json.rejections)).toMatch(/Personal data not allowed/);
    expect(JSON.stringify(r.json.rejections)).toMatch(/generic business mailboxes/);

    const [rec] = await h.deps.sql`select r.license_snapshot, r.original_url, o.quality_status from source_records r join opportunities o on o.source_record_id = r.id where r.external_id = 'A1'`;
    expect(rec!.quality_status).toBe('needs_review');
    expect(rec!.license_snapshot.approvalReference).toMatch(/PB-2026-01/);

    // Not visible to subscribers until moderated.
    const before = await h.call('GET', '/api/opportunities?query=Zephyr&minScore=0', { token: user.token });
    expect(before.json.items).toHaveLength(0);
  });

  it('re-import counts duplicates; publishing exposes the record with attribution', async () => {
    const again = await h.call('POST', '/api/admin/import', { token: admin.token, body: { providerId: sourceId, csv: csv([goodRow('A1')]), lawfulBasisConfirmed: true } });
    expect(again.json.duplicates).toBe(1);
    const q = await h.call('GET', '/api/admin/opportunities?status=needs_review', { token: admin.token });
    const target = q.json.items.find((i: any) => i.company_name === 'Zephyr Test Co');
    expect((await h.call('PATCH', `/api/admin/opportunities/${target.id}`, { token: admin.token, body: { qualityStatus: 'published' } })).status).toBe(200);
    const list = await h.call('GET', '/api/opportunities?query=Zephyr&minScore=0', { token: user.token });
    expect(list.json.items).toHaveLength(1);
    expect(list.json.items[0].source.attributionText).toBe('Listing summaries via Partner Board');
    expect(list.json.items[0].isDemo).toBe(false);
    // Free plan cannot unlock licensed live data.
    expect((await h.call('POST', `/api/opportunities/${target.id}/unlock`, { token: user.token })).json.error.code).toBe('live_data_requires_paid_plan');
  });

  it('revoking the licence disables the source and removes its records from subscriber results', async () => {
    await h.call('PATCH', `/api/admin/sources/${sourceId}`, { token: admin.token, body: { licenseStatus: 'revoked' } });
    const list = await h.call('GET', '/api/opportunities?query=Zephyr&minScore=0', { token: user.token });
    expect(list.json.items).toHaveLength(0);
    const audit = await h.call('GET', '/api/admin/audit-log', { token: admin.token });
    expect(audit.json.items.some((a: any) => a.action === 'source.update')).toBe(true);
  });

  it('licensed API adapter stays blocked without contract approval and credentials', async () => {
    const [row] = await h.deps.sql<SourceProviderRow[]>`select * from source_providers where provider_kind = 'licensed_api'`;
    const r = await runIngestion(h.deps.sql, row!, providerFor(row!, h.deps), { triggeredBy: 'test', now: new Date() });
    expect(r.status).toBe('blocked');
    expect(r.fetched).toBe(0);
  });

  it('manual create requires lawful-basis confirmation and takedowns hide records', async () => {
    const base = { providerId: sourceId, companyName: 'X Co', title: 'VA', originalSummary: 'An original summary that is long enough.', industry: 'Other', skills: ['general_va'], sourceUrl: 'https://x.example.com/1' };
    expect((await h.call('POST', '/api/admin/opportunities', { token: admin.token, body: base })).status).toBe(400);
    const [demo] = await h.deps.sql`select id from opportunities where company_name = 'Sample Delta Web Collective'`;
    await h.call('POST', `/api/opportunities/${demo!.id}/feedback`, { token: user.token, body: { reason: 'takedown_request', details: 'Please remove' } });
    const fb = await h.call('GET', '/api/admin/feedback', { token: admin.token });
    const item = fb.json.items.find((f: any) => f.opportunity_id === demo!.id);
    await h.call('PATCH', `/api/admin/feedback/${item.id}`, { token: admin.token, body: { status: 'resolved', takeDown: true } });
    expect((await h.call('GET', `/api/opportunities/${demo!.id}`, { token: user.token })).status).toBe(404);
    await h.deps.sql`update opportunities set quality_status = 'published' where id = ${demo!.id}`;
  });
});

describe('digest and privacy requests', () => {
  it('sends a clearly labelled demo digest with unsubscribe link outside production', async () => {
    const u = await signup(h, { prefs: { skills: ['ghl_crm'], alertFrequency: 'weekly' } });
    await h.deps.sql`update subscriptions set status = 'cancelled' where user_id = ${u.id}`;
    await h.deps.sql`insert into subscriptions (user_id, plan_id, provider, provider_mode, status) select ${u.id}, id, 'mock', 'mock', 'active' from plans where code = 'solo'`;
    const r = await h.call('POST', '/api/internal/jobs/digest', { token: 'test-internal-job-token-0123456789abcdef' });
    expect(r.json.sent).toBeGreaterThanOrEqual(1);
    const mail = h.email.outbox.find((m) => m.to === u.email)!;
    expect(mail.subject).toMatch(/^\[DEMO\]/);
    expect(mail.text).toContain('DEMO DATA — NOT REAL LEADS');
    const token = mail.text.match(/unsubscribe\?token=([0-9a-f]+)/)![1];
    const un = await h.call('GET', `/api/email/unsubscribe?token=${token}`);
    expect(un.text).toContain('unsubscribed');
    const [ep] = await h.deps.sql`select digest_frequency from email_preferences where user_id = ${u.id}`;
    expect(ep!.digest_frequency).toBe('off');
    const again = await h.call('POST', '/api/internal/jobs/digest', { token: 'test-internal-job-token-0123456789abcdef' });
    expect(h.email.outbox.filter((m) => m.to === u.email)).toHaveLength(1);
    expect(again.status).toBe(200);
  });

  it('exports and deletes account data on request', async () => {
    const u = await signup(h);
    const ex = await h.call('POST', '/api/account/export-request', { token: u.token });
    expect(ex.json.profile.display_name).toBe('Test VA');
    const del = await h.call('POST', '/api/account/delete-request', { token: u.token });
    expect(del.status).toBe(202);
    const reqs = await h.call('GET', '/api/admin/data-requests', { token: admin.token });
    const pending = reqs.json.items.find((r: any) => r.user_id === u.id && r.kind === 'delete');
    expect((await h.call('POST', `/api/admin/data-requests/${pending.id}/complete`, { token: admin.token })).status).toBe(200);
    const [gone] = await h.deps.sql`select count(*)::int as n from auth.users where id = ${u.id}`;
    expect(gone!.n).toBe(0);
  });
});
