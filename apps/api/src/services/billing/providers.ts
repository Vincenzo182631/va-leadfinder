import type { Config } from '../../env';
import { ApiError } from '../../lib/errors';
import { randomToken } from '../../lib/crypto';
import { verifyPaymongoSignature } from './signature';
import type { BillingProvider } from './types';

const PAYMONGO_API = 'https://api.paymongo.com/v1';

/** Billing switched off: every action fails safely with a structured error. */
export function disabledBilling(): BillingProvider {
  const off = async (): Promise<never> => {
    throw new ApiError(503, 'billing_unavailable', 'Online payments are not enabled yet.');
  };
  return {
    mode: 'disabled',
    configured: false,
    createCustomer: off,
    createSubscription: off,
    attachPaymentMethod: off,
    cancelSubscription: async () => {},
    changePlan: off,
    verifyWebhook: async () => ({ ok: false, reason: 'billing_disabled' }),
  };
}

/**
 * DEVELOPMENT ONLY mock of the PayMongo subscription lifecycle. No money moves.
 * Entitlements still change ONLY via a signed webhook (see /api/dev/billing/simulate).
 */
export function mockBilling(cfg: Config): BillingProvider {
  return {
    mode: 'mock',
    configured: true,
    async createCustomer() {
      return `mock_cus_${randomToken(8)}`;
    },
    async createSubscription() {
      const id = `mock_subs_${randomToken(8)}`;
      return {
        providerSubscriptionId: id,
        providerPaymentIntentId: `mock_pi_${randomToken(8)}`,
        status: 'incomplete',
        nextAction: { type: 'mock_checkout', url: `/app/billing/mock-checkout?subscription=${encodeURIComponent(id)}` },
      };
    },
    async attachPaymentMethod() {
      return { status: 'processing', redirectUrl: null };
    },
    async cancelSubscription() {},
    async changePlan() {},
    verifyWebhook: (rawBody, header, now) =>
      verifyPaymongoSignature({ rawBody, header, now, secret: cfg.PAYMONGO_WEBHOOK_SECRET, livemode: false, toleranceSeconds: cfg.PAYMONGO_WEBHOOK_TOLERANCE_SECONDS }),
  };
}

/**
 * Real PayMongo Subscriptions API adapter (test or live keys).
 * NOTE: not exercised against PayMongo from this repo's CI — requires your keys and
 * subscription capability enabled on your PayMongo account (contact PayMongo support).
 */
export function paymongoBilling(cfg: Config): BillingProvider {
  const mode = cfg.PAYMONGO_MODE as 'test' | 'live';
  const auth = 'Basic ' + btoa(`${cfg.PAYMONGO_SECRET_KEY}:`);

  async function call<T>(method: string, path: string, attributes?: Record<string, unknown>): Promise<T> {
    let lastErr: unknown;
    for (let attempt = 0; attempt < 2; attempt++) {
      try {
        const res = await fetch(`${PAYMONGO_API}${path}`, {
          method,
          headers: { Authorization: auth, 'Content-Type': 'application/json', Accept: 'application/json' },
          body: attributes ? JSON.stringify({ data: { attributes } }) : undefined,
          signal: AbortSignal.timeout(15_000),
        });
        const json = (await res.json().catch(() => ({}))) as { data?: unknown; errors?: { code?: string; detail?: string }[] };
        if (res.status >= 500 && attempt === 0) continue; // one bounded retry on provider 5xx
        if (!res.ok) {
          const e = json.errors?.[0];
          throw new ApiError(502, 'billing_provider_error', e?.detail ? `Payment provider: ${e.detail}` : `Payment provider error (${res.status})`);
        }
        return json.data as T;
      } catch (err) {
        lastErr = err;
        if (err instanceof ApiError) throw err;
      }
    }
    throw new ApiError(502, 'billing_provider_unreachable', 'Could not reach the payment provider. Please try again.', String(lastErr));
  }

  return {
    mode,
    configured: true,
    async createCustomer({ email, name }) {
      const [first, ...rest] = name.trim().split(/\s+/);
      const c = await call<{ id: string }>('POST', '/customers', {
        first_name: first || 'VA',
        last_name: rest.join(' ') || 'Subscriber',
        email,
        default_device: 'email',
      });
      return c.id;
    },
    async createSubscription({ customerId, providerPlanId }) {
      const s = await call<{ id: string; attributes: { status: string; latest_invoice?: { payment_intent?: { id: string } } } }>(
        'POST', '/subscriptions', { customer_id: customerId, plan_id: providerPlanId },
      );
      const pi = s.attributes.latest_invoice?.payment_intent?.id ?? null;
      return {
        providerSubscriptionId: s.id,
        providerPaymentIntentId: pi,
        status: 'incomplete',
        nextAction: pi ? { type: 'collect_payment_method', paymentIntentId: pi } : { type: 'none' },
      };
    },
    async attachPaymentMethod({ paymentIntentId, paymentMethodId, returnUrl }) {
      const pi = await call<{ attributes: { status: string; next_action?: { redirect?: { url?: string } } } }>(
        'POST', `/payment_intents/${encodeURIComponent(paymentIntentId)}/attach`, { payment_method: paymentMethodId, return_url: returnUrl },
      );
      return { status: pi.attributes.status, redirectUrl: pi.attributes.next_action?.redirect?.url ?? null };
    },
    async cancelSubscription({ providerSubscriptionId, reason }) {
      await call('POST', `/subscriptions/${encodeURIComponent(providerSubscriptionId)}/cancel`, { cancellation_reason: reason });
    },
    async changePlan({ providerSubscriptionId, providerPlanId }) {
      await call('PUT', `/subscriptions/${encodeURIComponent(providerSubscriptionId)}/plan`, { plan_id: providerPlanId });
    },
    verifyWebhook: (rawBody, header, now) =>
      verifyPaymongoSignature({ rawBody, header, now, secret: cfg.PAYMONGO_WEBHOOK_SECRET, livemode: mode === 'live', toleranceSeconds: cfg.PAYMONGO_WEBHOOK_TOLERANCE_SECONDS }),
  };
}

export function createBilling(cfg: Config): BillingProvider {
  if (cfg.PAYMONGO_MODE === 'mock') return mockBilling(cfg);
  if (cfg.PAYMONGO_MODE === 'test' || cfg.PAYMONGO_MODE === 'live') return paymongoBilling(cfg);
  return disabledBilling();
}
