import { buildDeps, createApp } from '../src/app';
import { loadConfig } from '../src/env';
import { setLogSilent } from '../src/lib/log';
import { resetRateLimits } from '../src/middleware/rate-limit';
import { consoleEmail } from '../src/services/email';
import { providerFor } from '../src/providers/registry';
import { runIngestion } from '../src/services/ingestion';
import type { SourceProviderRow } from '../src/providers/types';

setLogSilent(true);
export const WEBHOOK_SECRET = 'test-webhook-secret-0123456789';
export const ADMIN_ID = '00000000-0000-4000-8000-00000000a0a0';

export function makeEnv(overrides: Record<string, string> = {}) {
  return {
    APP_ENV: 'test',
    DATABASE_URL: process.env.TEST_DATABASE_URL ?? 'postgres://postgres@127.0.0.1:54329/vlf_test',
    AUTH_MODE: 'local',
    LOCAL_AUTH_JWT_SECRET: 'test-local-secret-0123456789abcdef0123456789',
    PAYMONGO_MODE: 'mock',
    PAYMONGO_WEBHOOK_SECRET: WEBHOOK_SECRET,
    ADMIN_USER_IDS: ADMIN_ID,
    INTERNAL_JOB_TOKEN: 'test-internal-job-token-0123456789abcdef',
    TRANSACTIONAL_EMAIL_PROVIDER: 'console',
    ...overrides,
  };
}

export function makeApp(overrides: Record<string, string> = {}) {
  resetRateLimits();
  const email = consoleEmail();
  const deps = buildDeps(loadConfig(makeEnv(overrides)), { email });
  const app = createApp(deps);
  const call = async (method: string, path: string, opts: { token?: string; body?: unknown; headers?: Record<string, string>; raw?: string } = {}) => {
    const headers: Record<string, string> = { ...(opts.headers ?? {}) };
    if (opts.token) headers.authorization = `Bearer ${opts.token}`;
    if (opts.body !== undefined) headers['content-type'] = 'application/json';
    const res = await app.request(path, { method, headers, body: opts.raw ?? (opts.body !== undefined ? JSON.stringify(opts.body) : undefined) });
    const text = await res.text();
    let json: any = null;
    try { json = JSON.parse(text); } catch { /* csv / html */ }
    return { status: res.status, json, text, headers: res.headers };
  };
  return { app, deps, call, email };
}

let counter = 0;
export async function signup(h: ReturnType<typeof makeApp>, opts: { id?: string; prefs?: Record<string, unknown> } = {}) {
  const email = `user${Date.now()}${counter++}@test.dev`;
  let id: string;
  let token: string;
  if (opts.id) {
    await h.deps.sql`insert into auth.users (id, email, encrypted_password, email_confirmed_at) values (${opts.id}, ${email}, crypt('password123', gen_salt('bf', 4)), now()) on conflict (id) do nothing`;
    id = opts.id;
    const [u] = await h.deps.sql`select email from auth.users where id = ${id}`;
    token = await h.deps.localAuth!.issue(id, u!.email);
  } else {
    const r = await h.call('POST', '/api/dev-auth/signup', { body: { email, password: 'password123', displayName: 'Test VA' } });
    id = r.json.user.id;
    token = r.json.accessToken;
  }
  const prefs = { skills: ['general_va', 'ghl_crm', 'executive_assistant', 'customer_support', 'ecommerce'], workTypes: ['contract', 'part_time', 'freelance'], ...(opts.prefs ?? {}) };
  await h.call('POST', '/api/onboarding', { token, body: { profile: { displayName: 'Test VA', country: 'PH', timezone: 'Asia/Manila' }, preferences: prefs } });
  return { id, token, email };
}

export async function ensureDemo(h: ReturnType<typeof makeApp>) {
  const [row] = await h.deps.sql<SourceProviderRow[]>`select * from source_providers where provider_kind = 'synthetic_demo'`;
  return runIngestion(h.deps.sql, row!, providerFor(row!, h.deps), { triggeredBy: 'test', now: new Date() });
}

export async function demoIds(h: ReturnType<typeof makeApp>, n: number) {
  const rows = await h.deps.sql`select id from opportunities where is_demo and quality_status = 'published' and (expires_at is null or expires_at > now()) order by company_name limit ${n}`;
  return rows.map((r) => r.id as string);
}

export async function setPlan(h: ReturnType<typeof makeApp>, userId: string, planCode: string) {
  await h.deps.sql`delete from subscriptions where user_id = ${userId}`;
  await h.deps.sql`insert into subscriptions (user_id, plan_id, provider, provider_mode, provider_subscription_id, status, current_period_start, current_period_end)
    select ${userId}, id, 'mock', 'mock', ${'mock_subs_fixture_' + userId}, 'active', now(), now() + interval '30 days' from plans where code = ${planCode}`;
}
