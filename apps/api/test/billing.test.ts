import { beforeAll, describe, expect, it } from 'vitest';
import { signPaymongoPayload, verifyPaymongoSignature } from '../src/services/billing/signature';
import { buildPaymongoEvent } from '../src/services/billing/webhooks';
import { makeApp, signup, WEBHOOK_SECRET } from './helpers';

const h = makeApp();
let evtN = 0;
async function deliver(type: string, resourceId: string, opts: { status?: string; createdAt?: Date; eventId?: string; secret?: string; sigTime?: Date } = {}) {
  const evt = buildPaymongoEvent({ eventId: opts.eventId ?? `evt_test_${Date.now()}_${evtN++}`, type, resourceId, status: opts.status, createdAt: opts.createdAt ?? new Date() });
  const raw = JSON.stringify(evt);
  const sig = await signPaymongoPayload(opts.secret ?? WEBHOOK_SECRET, raw, opts.sigTime ?? new Date());
  return h.call('POST', '/api/webhooks/paymongo', { raw, headers: { 'content-type': 'application/json', 'paymongo-signature': sig } });
}
async function checkout(token: string, planCode = 'solo') {
  const r = await h.call('POST', '/api/billing/checkout', { token, body: { planCode } });
  expect(r.status).toBe(201);
  const [s] = await h.deps.sql`select provider_subscription_id from subscriptions where id = ${r.json.subscriptionId}`;
  return s!.provider_subscription_id as string;
}
const plan = async (token: string) => (await h.call('GET', '/api/usage', { token })).json.planCode;

describe('PayMongo signature verification', () => {
  const now = new Date('2026-10-30T00:00:00Z');
  it('accepts te in test mode, li in live mode, rejects tampering/replay', async () => {
    const raw = '{"a":1}';
    const test = await signPaymongoPayload('s3cret', raw, now);
    expect(await verifyPaymongoSignature({ rawBody: raw, header: test, secret: 's3cret', livemode: false, now, toleranceSeconds: 300 })).toEqual({ ok: true });
    expect((await verifyPaymongoSignature({ rawBody: raw, header: test, secret: 's3cret', livemode: true, now, toleranceSeconds: 300 })).ok).toBe(false);
    const live = await signPaymongoPayload('s3cret', raw, now, true);
    expect((await verifyPaymongoSignature({ rawBody: raw, header: live, secret: 's3cret', livemode: true, now, toleranceSeconds: 300 })).ok).toBe(true);
    expect((await verifyPaymongoSignature({ rawBody: '{"a":2}', header: test, secret: 's3cret', livemode: false, now, toleranceSeconds: 300 })).ok).toBe(false);
    const later = new Date(now.getTime() + 301_000);
    expect(await verifyPaymongoSignature({ rawBody: raw, header: test, secret: 's3cret', livemode: false, now: later, toleranceSeconds: 300 })).toEqual({ ok: false, reason: 'timestamp_outside_tolerance' });
    expect((await verifyPaymongoSignature({ rawBody: raw, header: undefined, secret: 's3cret', livemode: false, now, toleranceSeconds: 300 })).ok).toBe(false);
    expect((await verifyPaymongoSignature({ rawBody: raw, header: test, secret: '', livemode: false, now, toleranceSeconds: 300 })).ok).toBe(false);
  });
});

describe('subscription lifecycle via verified webhooks', () => {
  let u: Awaited<ReturnType<typeof signup>>;
  let subsId: string;
  beforeAll(async () => {
    u = await signup(h);
    subsId = await checkout(u.token);
  });

  it('checkout alone grants nothing (no entitlement from browser redirects)', async () => {
    expect(await plan(u.token)).toBe('free');
    const s = await h.call('GET', '/api/subscription', { token: u.token });
    expect(s.json.subscription.status).toBe('incomplete');
  });

  it('rejects unsigned or wrongly signed webhooks and changes nothing', async () => {
    expect((await deliver('subscription.activated', subsId, { secret: 'wrong-secret-000000' })).status).toBe(401);
    const raw = JSON.stringify(buildPaymongoEvent({ eventId: 'evt_nosig', type: 'subscription.activated', resourceId: subsId, createdAt: new Date() }));
    expect((await h.call('POST', '/api/webhooks/paymongo', { raw, headers: { 'content-type': 'application/json' } })).status).toBe(401);
    expect((await deliver('subscription.activated', subsId, { sigTime: new Date(Date.now() - 3_600_000) })).status).toBe(401);
    expect(await plan(u.token)).toBe('free');
  });

  it('activates only after a verified event, idempotently', async () => {
    const r = await deliver('subscription.invoice.paid', subsId, { eventId: 'evt_dup_1' });
    expect(r.json.outcome).toBe('processed');
    expect(await plan(u.token)).toBe('solo');
    const dup = await deliver('subscription.invoice.paid', subsId, { eventId: 'evt_dup_1' });
    expect(dup.status).toBe(200);
    expect(dup.json.outcome).toBe('duplicate');
    const [n] = await h.deps.sql`select count(*)::int as n from billing_webhook_events where provider_event_id = 'evt_dup_1'`;
    expect(n!.n).toBe(1);
    const [ev] = await h.deps.sql`select count(*)::int as n from product_events where user_id = ${u.id} and event = 'subscription_started'`;
    expect(ev!.n).toBe(1);
  });

  it('ignores out-of-order (older) events', async () => {
    const older = await deliver('subscription.past_due', subsId, { status: 'past_due', createdAt: new Date(Date.now() - 86_400_000) });
    expect(older.json.outcome).toBe('ignored');
    const [s] = await h.deps.sql`select status from subscriptions where provider_subscription_id = ${subsId}`;
    expect(s!.status).toBe('active');
  });

  it('past_due keeps access during the grace period, then falls back to free', async () => {
    await deliver('subscription.invoice.payment_failed', subsId, { createdAt: new Date(Date.now() + 1000) });
    const [s] = await h.deps.sql`select status from subscriptions where provider_subscription_id = ${subsId}`;
    expect(s!.status).toBe('past_due');
    expect(await plan(u.token)).toBe('solo');
    await h.deps.sql`update subscriptions set past_due_since = now() - interval '4 days' where provider_subscription_id = ${subsId}`;
    expect(await plan(u.token)).toBe('free');
    await deliver('subscription.invoice.paid', subsId, { createdAt: new Date(Date.now() + 2000) });
    expect(await plan(u.token)).toBe('solo');
  });

  it('cancellation stops renewal but keeps access to period end; late events cannot revive it', async () => {
    const r = await h.call('POST', '/api/billing/cancel', { token: u.token, body: { reason: 'too_expensive' } });
    expect(r.status).toBe(200);
    expect(r.json.accessUntil).toBeTruthy();
    expect(await plan(u.token)).toBe('solo');
    const late = await deliver('subscription.activated', subsId, { status: 'active', createdAt: new Date(Date.now() + 60_000) });
    expect(late.json.outcome).toBe('ignored');
    await h.deps.sql`update subscriptions set current_period_end = now() - interval '1 minute' where provider_subscription_id = ${subsId}`;
    expect(await plan(u.token)).toBe('free');
  });

  it('unpaid revokes paid access', async () => {
    const v = await signup(h);
    const id = await checkout(v.token, 'pro');
    await deliver('subscription.activated', id, { status: 'active' });
    expect(await plan(v.token)).toBe('pro');
    await deliver('subscription.unpaid', id, { status: 'unpaid', createdAt: new Date(Date.now() + 1000) });
    expect(await plan(v.token)).toBe('free');
  });

  it('unknown subscriptions and unhandled events are acknowledged but ignored', async () => {
    expect((await deliver('subscription.activated', 'subs_unknown')).json.outcome).toBe('ignored');
    expect((await deliver('payment.paid', 'pay_x')).json.outcome).toBe('ignored');
  });

  it('dev simulator goes through the same signed webhook path', async () => {
    const w = await signup(h);
    const id = await checkout(w.token);
    const r = await h.call('POST', '/api/dev/billing/simulate', { token: w.token, body: { subscriptionId: id, event: 'subscription.invoice.paid' } });
    expect(r.json.delivered).toBe(200);
    expect(await plan(w.token)).toBe('solo');
    const other = await signup(h);
    expect((await h.call('POST', '/api/dev/billing/simulate', { token: other.token, body: { subscriptionId: id, event: 'subscription.invoice.paid' } })).status).toBe(404);
  });

  it('prevents double subscriptions and enforces the founding cap', async () => {
    const x = await signup(h);
    const id = await checkout(x.token);
    await deliver('subscription.activated', id, { status: 'active' });
    expect((await h.call('POST', '/api/billing/checkout', { token: x.token, body: { planCode: 'pro' } })).json.error.code).toBe('already_subscribed');
    const y = await signup(h);
    expect((await h.call('POST', '/api/billing/checkout', { token: y.token, body: { planCode: 'founding' } })).json.error.code).toBe('founding_cap_reached');
  });
});

describe('billing disabled / missing keys fail safely', () => {
  it('checkout returns 503 and webhooks are rejected', async () => {
    const off = makeApp({ PAYMONGO_MODE: 'disabled' });
    const u = await signup(off);
    const r = await off.call('POST', '/api/billing/checkout', { token: u.token, body: { planCode: 'solo' } });
    expect(r.status).toBe(503);
    expect(r.json.error.code).toBe('billing_unavailable');
    expect((await off.call('GET', '/api/subscription', { token: u.token })).json.billing.mode).toBe('disabled');
    const raw = '{}';
    expect((await off.call('POST', '/api/webhooks/paymongo', { raw, headers: { 'content-type': 'application/json', 'paymongo-signature': await signPaymongoPayload(WEBHOOK_SECRET, raw, new Date()) } })).status).toBe(401);
    expect((await off.call('POST', '/api/dev/billing/simulate', { token: u.token, body: {} })).status).toBe(404);
  });
});
