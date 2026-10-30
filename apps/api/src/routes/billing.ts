import { Hono } from 'hono';
import { attachPaymentSchema, cancelSchema, checkoutSchema, type PlanDto, type SubscriptionResponse } from '@vlf/shared';
import { z } from 'zod';
import { asService } from '../db';
import { ApiError, notFound } from '../lib/errors';
import { log } from '../lib/log';
import { jsonBody, requireAuth, userTx } from '../middleware/core';
import { rateLimit } from '../middleware/rate-limit';
import { signPaymongoPayload } from '../services/billing/signature';
import { buildPaymongoEvent, processPaymongoEvent } from '../services/billing/webhooks';
import type { AppEnv, Deps } from '../types';
import { randomToken } from '../lib/crypto';

const OPEN = ['incomplete', 'active', 'past_due', 'unpaid'];

function billingMessage(deps: Deps, checkoutEnabled: boolean): string {
  switch (deps.billing.mode) {
    case 'disabled':
      return 'Online payments are not enabled yet. Paid plans will open once payment processing is activated.';
    case 'mock':
      return 'Development mock billing: no real charges. Payments are simulated with signed test webhooks.';
    case 'test':
      return checkoutEnabled ? 'PayMongo TEST mode: use PayMongo test cards only. No real charges.' : 'PayMongo test mode configured; checkout is switched off in Admin.';
    case 'live':
      return checkoutEnabled ? 'Secure payments by PayMongo (cards and Maya).' : 'Checkout is temporarily unavailable.';
  }
}

async function checkoutAllowed(deps: Deps): Promise<boolean> {
  if (deps.billing.mode === 'disabled') return false;
  if (deps.billing.mode === 'mock') return true;
  const [s] = await deps.sql`select checkout_enabled from app_settings where id = 1`;
  return Boolean(s?.checkout_enabled);
}

export const billingRoutes = new Hono<AppEnv>();

// ------------------------------------------------------------------ public: plans
billingRoutes.get('/plans', async (c) => {
  const deps = c.get('deps');
  const rows = await deps.sql`select p.*, s.founding_member_enabled, s.founding_member_cap,
      (select count(*)::int from subscriptions x where x.plan_id = p.id and x.status in ('active','past_due')) as active_count
    from plans p cross join app_settings s where p.active order by p.sort_order`;
  const plans: PlanDto[] = rows
    .filter((r) => r.code !== 'founding' || r.founding_member_enabled)
    .map((r) => ({
      code: r.code,
      name: r.name,
      phpAmount: r.php_amount,
      monthlyUnlockLimit: r.monthly_unlock_limit,
      exportPermission: r.export_permission,
      digestFrequency: r.digest_frequency,
      liveDataAccess: r.live_data_access,
      description: r.description,
      available: r.code === 'free' || r.code !== 'founding' || r.active_count < r.founding_member_cap,
    }));
  return c.json({ plans, billingMode: deps.billing.mode });
});

// ------------------------------------------------------------------ authenticated
const authed = new Hono<AppEnv>();
authed.use('*', requireAuth);

authed.get('/subscription', async (c) => {
  const deps = c.get('deps');
  const enabled = await checkoutAllowed(deps);
  const body = await userTx(c, async (tx, uid) => {
    const [plan] = await tx`select my_usage() ->> 'planCode' as code`;
    const [s] = await tx`select s.id, s.status, s.provider, s.current_period_start, s.current_period_end, s.cancelled_at, s.past_due_since,
        p.code as plan_code from subscriptions s join plans p on p.id = s.plan_id
      where s.user_id = ${uid} order by s.created_at desc limit 1`;
    const [settings] = await tx`select grace_days from app_settings where id = 1`;
    const res: Omit<SubscriptionResponse, 'plans'> = {
      planCode: plan!.code,
      subscription: s
        ? {
            id: s.id, planCode: s.plan_code, status: s.status, provider: s.provider,
            currentPeriodStart: s.current_period_start, currentPeriodEnd: s.current_period_end,
            cancelledAt: s.cancelled_at, pastDueSince: s.past_due_since,
          }
        : null,
      graceDays: settings?.grace_days ?? 3,
      billing: { mode: deps.billing.mode, checkoutEnabled: enabled, message: billingMessage(deps, enabled) },
    };
    return res;
  });
  return c.json(body);
});

authed.post('/billing/checkout', rateLimit('checkout', 5, 60_000), async (c) => {
  const deps = c.get('deps');
  const { planCode } = await jsonBody(c, checkoutSchema);
  const claims = c.get('claims')!;
  if (!(await checkoutAllowed(deps))) throw new ApiError(503, 'billing_unavailable', billingMessage(deps, false));

  // Trusted server work: subscriptions are written only by the server.
  const result = await asService(deps.sql, async (tx) => {
    await tx`select pg_advisory_xact_lock(hashtextextended(${'checkout:' + claims.sub}, 0))`;
    const [plan] = await tx`select * from plans where code = ${planCode} and active`;
    if (!plan) throw notFound('Plan');
    const providerPlanId = deps.billing.mode === 'live' ? plan.provider_plan_id_live : deps.billing.mode === 'test' ? plan.provider_plan_id_test : `mock_plan_${plan.code}`;
    if (!providerPlanId) throw new ApiError(503, 'plan_not_configured', 'This plan is not yet set up with the payment provider.');

    if (planCode === 'founding') {
      const [s] = await tx`select founding_member_enabled, founding_member_cap from app_settings where id = 1`;
      const [n] = await tx`select count(*)::int as n from subscriptions where plan_id = ${plan.id} and status in ('active','past_due','incomplete')`;
      if (!s?.founding_member_enabled || (n?.n ?? 0) >= s.founding_member_cap)
        throw new ApiError(409, 'founding_cap_reached', 'Founding Beta spots are no longer available.');
    }

    const [open] = await tx`select * from subscriptions where user_id = ${claims.sub} and status = any(${OPEN})`;
    if (open && open.status !== 'incomplete') throw new ApiError(409, 'already_subscribed', 'You already have a subscription. Use "Change plan" instead.');
    if (open) await tx`update subscriptions set status = 'incomplete_cancelled' where id = ${open.id}`;

    const [prev] = await tx`select provider_customer_id from subscriptions where user_id = ${claims.sub} and provider_customer_id is not null and provider_mode = ${deps.billing.mode} order by created_at desc limit 1`;
    const [profile] = await tx`select display_name from profiles where user_id = ${claims.sub}`;
    const customerId = prev?.provider_customer_id ?? (await deps.billing.createCustomer({ email: claims.email ?? '', name: profile?.display_name || 'VA Subscriber' }));
    const sub = await deps.billing.createSubscription({ customerId, providerPlanId });
    const promoEnds = plan.promo_months ? new Date(Date.now() + plan.promo_months * 30 * 86_400_000).toISOString() : null;
    const [row] = await tx`insert into subscriptions (user_id, plan_id, provider, provider_mode, provider_customer_id, provider_subscription_id,
        provider_payment_intent_id, status, promo_ends_at)
      values (${claims.sub}, ${plan.id}, ${deps.billing.mode === 'mock' ? 'mock' : 'paymongo'}, ${deps.billing.mode}, ${customerId},
        ${sub.providerSubscriptionId}, ${sub.providerPaymentIntentId}, 'incomplete', ${promoEnds})
      returning id`;
    return { subscriptionId: row!.id as string, nextAction: sub.nextAction };
  });
  // Status stays "incomplete" until a VERIFIED webhook says otherwise — never from a browser redirect.
  return c.json({ ...result, status: 'incomplete' }, 201);
});

authed.post('/billing/attach', rateLimit('attach', 10, 60_000), async (c) => {
  const deps = c.get('deps');
  const { paymentMethodId } = await jsonBody(c, attachPaymentSchema);
  const uid = c.get('claims')!.sub;
  const [sub] = await deps.sql`select * from subscriptions where user_id = ${uid} and status = 'incomplete' order by created_at desc limit 1`;
  if (!sub?.provider_payment_intent_id) throw notFound('Pending subscription');
  const r = await deps.billing.attachPaymentMethod({
    paymentIntentId: sub.provider_payment_intent_id,
    paymentMethodId,
    returnUrl: `${deps.config.APP_BASE_URL}/app/account?billing=return`,
  });
  return c.json(r);
});

authed.post('/billing/cancel', rateLimit('cancel', 5, 60_000), async (c) => {
  const deps = c.get('deps');
  const { reason } = await jsonBody(c, cancelSchema);
  const uid = c.get('claims')!.sub;
  const out = await asService(deps.sql, async (tx) => {
    const [sub] = await tx`select * from subscriptions where user_id = ${uid} and status = any(${OPEN}) order by created_at desc limit 1 for update`;
    if (!sub) throw notFound('Active subscription');
    if (sub.provider_subscription_id && deps.billing.mode !== 'disabled') {
      await deps.billing.cancelSubscription({ providerSubscriptionId: sub.provider_subscription_id, reason });
    }
    // PayMongo cancellation is immediate (no new invoices). Paid access continues to the end of the current period.
    const [row] = await tx`update subscriptions set status = 'cancelled', cancelled_at = now(), cancel_reason = ${reason},
      last_event_at = greatest(coalesce(last_event_at, now()), now()) where id = ${sub.id} returning current_period_end`;
    await tx`insert into product_events (user_id, event, related_id) values (${uid}, 'subscription_cancelled', ${sub.id})`;
    return { accessUntil: row!.current_period_end as string | null };
  });
  return c.json({
    ok: true,
    ...out,
    message: out.accessUntil
      ? `Cancelled. You will not be charged again. Paid features stay available until ${new Date(out.accessUntil).toDateString()}.`
      : 'Cancelled. You will not be charged.',
  });
});

authed.post('/billing/change-plan', rateLimit('change-plan', 5, 60_000), async (c) => {
  const deps = c.get('deps');
  const { planCode } = await jsonBody(c, checkoutSchema);
  const uid = c.get('claims')!.sub;
  const out = await asService(deps.sql, async (tx) => {
    const [sub] = await tx`select * from subscriptions where user_id = ${uid} and status = 'active' for update`;
    if (!sub) throw new ApiError(409, 'no_active_subscription', 'Start a subscription first.');
    const [plan] = await tx`select * from plans where code = ${planCode} and active and code <> 'founding'`;
    if (!plan) throw notFound('Plan');
    const providerPlanId = deps.billing.mode === 'live' ? plan.provider_plan_id_live : deps.billing.mode === 'test' ? plan.provider_plan_id_test : `mock_plan_${plan.code}`;
    if (!providerPlanId) throw new ApiError(503, 'plan_not_configured', 'This plan is not yet set up with the payment provider.');
    await deps.billing.changePlan({ providerSubscriptionId: sub.provider_subscription_id, providerPlanId });
    await tx`update subscriptions set pending_plan_id = ${plan.id} where id = ${sub.id}`;
    return { effective: sub.current_period_end };
  });
  return c.json({ ok: true, message: `Your plan will change at the start of your next billing cycle${out.effective ? ` (${new Date(out.effective).toDateString()})` : ''}. No prorated charges are applied.` });
});

billingRoutes.route('/', authed);

// ------------------------------------------------------------------ provider webhook (no user auth)
export const webhookRoutes = new Hono<AppEnv>();
webhookRoutes.post('/paymongo', rateLimit('webhook', 300, 60_000), async (c) => {
  const deps = c.get('deps');
  const raw = await c.req.text(); // RAW body: verify before any parsing
  if (raw.length > 256_000) throw new ApiError(413, 'payload_too_large', 'Payload too large');
  const verified = await deps.billing.verifyWebhook(raw, c.req.header('paymongo-signature'), deps.now());
  if (!verified.ok) {
    log('warn', 'webhook.rejected', { reason: verified.reason, requestId: c.get('requestId') });
    throw new ApiError(401, 'invalid_signature', 'Webhook signature verification failed');
  }
  const outcome = await processPaymongoEvent(deps.sql, raw, deps.billing.mode === 'live', deps.now());
  // 2xx for anything verified (including ignored/duplicate) so PayMongo does not retry needlessly.
  return c.json({ received: true, outcome: outcome.status });
});

// ------------------------------------------------------------------ DEV ONLY: billing simulator
export const devBillingRoutes = new Hono<AppEnv>();
devBillingRoutes.use('*', requireAuth);
devBillingRoutes.post('/simulate', rateLimit('simulate', 20, 60_000), async (c) => {
  const deps = c.get('deps');
  if (deps.billing.mode !== 'mock' || deps.config.isProduction) throw notFound();
  const body = await jsonBody(c, z.object({
    subscriptionId: z.string().max(100),
    event: z.enum(['subscription.activated', 'subscription.invoice.paid', 'subscription.invoice.payment_failed', 'subscription.past_due', 'subscription.unpaid', 'subscription.updated']),
  }));
  const uid = c.get('claims')!.sub;
  const [sub] = await deps.sql`select * from subscriptions where provider_subscription_id = ${body.subscriptionId} and user_id = ${uid}`;
  if (!sub) throw notFound('Subscription');
  const statusFor: Record<string, string> = {
    'subscription.activated': 'active', 'subscription.updated': 'active', 'subscription.past_due': 'past_due', 'subscription.unpaid': 'unpaid',
    'subscription.invoice.paid': 'paid', 'subscription.invoice.payment_failed': 'failed',
  };
  const evt = buildPaymongoEvent({ eventId: `evt_mock_${randomToken(10)}`, type: body.event, resourceId: body.subscriptionId, status: statusFor[body.event], createdAt: deps.now() });
  const raw = JSON.stringify(evt);
  const signature = await signPaymongoPayload(deps.config.PAYMONGO_WEBHOOK_SECRET, raw, deps.now());
  // Goes through the SAME verification + processing path as a real PayMongo delivery.
  const res = await c.get('deps').selfFetch!(new Request(`http://internal/api/webhooks/paymongo`, {
    method: 'POST', headers: { 'content-type': 'application/json', 'paymongo-signature': signature }, body: raw,
  }));
  return c.json({ delivered: res.status, outcome: await res.json() });
});
