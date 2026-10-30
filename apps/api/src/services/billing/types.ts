export type BillingMode = 'disabled' | 'mock' | 'test' | 'live';

export interface CheckoutResult {
  providerCustomerId: string;
  providerSubscriptionId: string;
  providerPaymentIntentId: string | null;
  status: 'incomplete' | 'active';
  /** What the browser should do next. */
  nextAction:
    | { type: 'mock_checkout'; url: string }
    | { type: 'collect_payment_method'; paymentIntentId: string }
    | { type: 'none' };
}

export interface BillingProvider {
  mode: BillingMode;
  configured: boolean;
  createCustomer(input: { email: string; name: string }): Promise<string>;
  createSubscription(input: { customerId: string; providerPlanId: string }): Promise<Omit<CheckoutResult, 'providerCustomerId'>>;
  attachPaymentMethod(input: { paymentIntentId: string; paymentMethodId: string; returnUrl: string }): Promise<{ status: string; redirectUrl: string | null }>;
  cancelSubscription(input: { providerSubscriptionId: string; reason: string }): Promise<void>;
  changePlan(input: { providerSubscriptionId: string; providerPlanId: string }): Promise<void>;
  /** Verify a webhook against the raw body. Must run before any JSON parsing. */
  verifyWebhook(rawBody: string, signatureHeader: string | undefined, now: Date): Promise<{ ok: true } | { ok: false; reason: string }>;
}
