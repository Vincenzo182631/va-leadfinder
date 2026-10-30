import { SignJWT } from 'jose';
import { beforeAll, describe, expect, it } from 'vitest';
import { loadConfig } from '../src/env';
import { withUser } from '../src/db';
import { ADMIN_ID, demoIds, ensureDemo, makeApp, makeEnv, signup } from './helpers';

const h = makeApp();
let a: Awaited<ReturnType<typeof signup>>;
let b: Awaited<ReturnType<typeof signup>>;

beforeAll(async () => {
  await ensureDemo(h);
  a = await signup(h);
  b = await signup(h);
});

describe('authentication', () => {
  it('rejects unauthenticated and forged tokens', async () => {
    expect((await h.call('GET', '/api/me')).status).toBe(401);
    expect((await h.call('GET', '/api/me', { token: 'garbage' })).status).toBe(401);
    const forged = await new SignJWT({ role: 'authenticated' }).setProtectedHeader({ alg: 'HS256' }).setSubject(a.id)
      .setIssuer('vlf-local-dev').setAudience('authenticated').setExpirationTime('1h').sign(new TextEncoder().encode('x'.repeat(40)));
    expect((await h.call('GET', '/api/me', { token: forged })).status).toBe(401);
  });
  it('does not reveal whether an account exists', async () => {
    const r1 = await h.call('POST', '/api/dev-auth/signup', { body: { email: a.email, password: 'password123' } });
    expect(r1.status).toBe(200);
    expect(r1.json.accessToken).toBeUndefined();
    const bad = await h.call('POST', '/api/dev-auth/login', { body: { email: a.email, password: 'wrongpass1' } });
    const none = await h.call('POST', '/api/dev-auth/login', { body: { email: 'nobody@test.dev', password: 'wrongpass1' } });
    expect(bad.json.error.message).toBe(none.json.error.message);
  });
  it('refuses local auth and mock billing in production config', () => {
    expect(() => loadConfig(makeEnv({ APP_ENV: 'production' }))).toThrow(/development-only/);
    expect(() => loadConfig(makeEnv({ APP_ENV: 'production', AUTH_MODE: 'supabase', SUPABASE_URL: 'https://x.supabase.co' }))).toThrow(/mock is refused/);
    expect(() => loadConfig(makeEnv({ PAYMONGO_MODE: 'test', PAYMONGO_SECRET_KEY: 'sk_live_abc', PAYMONGO_WEBHOOK_SECRET: 'whsk' }))).toThrow(/sk_test_/);
  });
  it('config errors never echo secret values', () => {
    try { loadConfig(makeEnv({ LOCAL_AUTH_JWT_SECRET: 'short-secret-value' })); } catch (e) { expect(String(e)).not.toContain('short-secret-value'); }
  });
});

describe('multi-user isolation (RLS)', () => {
  it('user B cannot see or modify user A pipeline, notes or drafts', async () => {
    const [opp] = await demoIds(h, 1);
    expect((await h.call('POST', `/api/opportunities/${opp}/unlock`, { token: a.token })).status).toBe(200);
    const saved = await h.call('POST', '/api/saved', { token: a.token, body: { opportunityId: opp } });
    expect(saved.status).toBe(201);
    await h.call('PATCH', `/api/saved/${saved.json.id}`, { token: a.token, body: { notes: 'A private note', stage: 'researching' } });
    await h.call('POST', '/api/outreach/draft', { token: a.token, body: { opportunityId: opp, templateCode: 'general_admin' } });

    expect((await h.call('GET', '/api/saved', { token: b.token })).json.items).toHaveLength(0);
    expect((await h.call('PATCH', `/api/saved/${saved.json.id}`, { token: b.token, body: { notes: 'hijack' } })).status).toBe(404);
    expect((await h.call('DELETE', `/api/saved/${saved.json.id}`, { token: b.token })).status).toBe(404);
    const detailB = await h.call('GET', `/api/opportunities/${opp}`, { token: b.token });
    expect(detailB.json.savedProspect).toBeNull();
    expect(detailB.json.draft).toBeNull();
    expect(detailB.json.full).toBeNull();

    // Direct SQL as user B (what a malicious client with B's JWT could do via PostgREST).
    await withUser(h.deps.sql, { sub: b.id, role: 'authenticated' }, async (tx) => {
      expect(await tx`select * from saved_prospects`).toHaveLength(0);
      expect(await tx`select * from outreach_drafts`).toHaveLength(0);
      expect(await tx`select * from profiles where user_id = ${a.id}`).toHaveLength(0);
      const upd = await tx`update saved_prospects set notes = 'x' where id = ${saved.json.id} returning id`;
      expect(upd).toHaveLength(0);
    });
    const [still] = await h.deps.sql`select notes from saved_prospects where id = ${saved.json.id}`;
    expect(still!.notes).toBe('A private note');
  });

  it('subscribers cannot read gated columns, raw source records, billing events or audit logs directly', async () => {
    for (const q of ['select original_summary from opportunities', 'select contact_route from opportunities', 'select * from source_records',
      'select * from billing_webhook_events', 'select * from admin_audit_log', 'select * from ingestion_runs', 'select approval_reference from source_providers',
      'select unsubscribe_token_hash from email_preferences', 'select provider_customer_id from subscriptions']) {
      await expect(withUser(h.deps.sql, { sub: b.id, role: 'authenticated' }, (tx) => tx.unsafe(q))).rejects.toThrow(/permission denied/);
    }
  });

  it('a user cannot grant themselves an unlock or subscription', async () => {
    const [opp] = (await demoIds(h, 2)) as [string];
    await expect(withUser(h.deps.sql, { sub: b.id, role: 'authenticated' }, (tx) =>
      tx`insert into opportunity_unlocks (user_id, opportunity_id, period_key, plan_code) values (${b.id}, ${opp}, '2026-10', 'pro')`)).rejects.toThrow(/permission denied/);
    await expect(withUser(h.deps.sql, { sub: b.id, role: 'authenticated' }, (tx) =>
      tx`update subscriptions set status = 'active'`)).rejects.toThrow(/permission denied/);
  });

  it('non-admins cannot reach admin routes; client admin flags are ignored', async () => {
    expect((await h.call('GET', '/api/admin/overview', { token: a.token })).status).toBe(403);
    expect((await h.call('GET', '/api/admin/overview', { token: a.token, headers: { 'x-is-admin': 'true' } })).status).toBe(403);
    const me = await h.call('GET', '/api/me', { token: a.token });
    expect(me.json.isAdmin).toBe(false);
    const admin = await signup(h, { id: ADMIN_ID });
    expect((await h.call('GET', '/api/admin/overview', { token: admin.token })).status).toBe(200);
  });

  it('validates ids and inputs', async () => {
    expect((await h.call('GET', '/api/opportunities/not-a-uuid', { token: a.token })).status).toBe(400);
    expect((await h.call('PATCH', '/api/preferences', { token: a.token, body: { skills: ['<script>'] } })).status).toBe(400);
    expect((await h.call('PATCH', '/api/preferences', { token: a.token, raw: '{bad', headers: { 'content-type': 'application/json' } })).status).toBe(400);
  });

  it('internal jobs require the job token', async () => {
    expect((await h.call('POST', '/api/internal/jobs/maintenance')).status).toBe(401);
    expect((await h.call('POST', '/api/internal/jobs/maintenance', { token: 'test-internal-job-token-0123456789abcdef' })).status).toBe(200);
  });
});
