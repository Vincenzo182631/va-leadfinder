import { z } from 'zod';
import type { Sql } from '../../db';
import { log } from '../../lib/log';

const eventSchema = z.object({
  data: z.object({
    id: z.string().min(3).max(128),
    attributes: z.object({
      type: z.string().max(128),
      livemode: z.boolean().default(false),
      created_at: z.number().int().optional(),
      data: z.object({
        id: z.string().max(128),
        type: z.string().max(64),
        attributes: z.record(z.string(), z.unknown()).default({}),
      }),
    }),
  }),
});

export type WebhookOutcome = { status: 'processed' | 'ignored' | 'duplicate' | 'failed'; message?: string };

const SUB_STATUS = new Set(['incomplete', 'incomplete_cancelled', 'active', 'past_due', 'unpaid', 'cancelled']);
const addMonths = (d: Date, n: number) => {
  const x = new Date(d);
  x.setUTCMonth(x.getUTCMonth() + n);
  return x;
};

/**
 * Process an ALREADY-VERIFIED PayMongo event. Idempotent by provider event id,
 * and ignores events older than the last one applied to a subscription (out-of-order safe).
 */
export async function processPaymongoEvent(sql: Sql, rawBody: string, expectLivemode: boolean, now: Date): Promise<WebhookOutcome> {
  let parsed: z.infer<typeof eventSchema>;
  try {
    parsed = eventSchema.parse(JSON.parse(rawBody));
  } catch {
    return { status: 'failed', message: 'malformed_event' };
  }
  const evt = parsed.data;
  const a = evt.attributes;
  const eventAt = a.created_at ? new Date(a.created_at * 1000) : now;
  const payloadSummary = { type: a.type, resourceId: a.data.id, resourceType: a.data.type, status: a.data.attributes.status ?? null };

  const inserted = await sql`
    insert into billing_webhook_events (provider_event_id, type, livemode, event_created_at, payload)
    values (${evt.id}, ${a.type}, ${a.livemode}, ${eventAt.toISOString()}, ${sql.json(payloadSummary)})
    on conflict (provider_event_id) do nothing
    returning id`;
  if (inserted.length === 0) return { status: 'duplicate' };
  const rowId = inserted[0]!.id as string;

  const finish = async (o: WebhookOutcome) => {
    await sql`update billing_webhook_events set status = ${o.status === 'duplicate' ? 'ignored' : o.status},
      processed_at = now(), safe_error_message = ${o.message ?? null} where id = ${rowId}`;
    return o;
  };

  if (a.livemode !== expectLivemode) return finish({ status: 'ignored', message: 'mode_mismatch' });

  try {
    if (a.type.startsWith('subscription.invoice.')) {
      const subsId = String(a.data.attributes.resource_id ?? a.data.attributes.subscription_id ?? '');
      if (!subsId) return finish({ status: 'ignored', message: 'invoice_without_subscription' });
      if (a.type === 'subscription.invoice.paid') return finish(await applySubscriptionChange(sql, subsId, 'active', eventAt, { invoicePaid: true }));
      if (a.type === 'subscription.invoice.payment_failed') return finish(await applySubscriptionChange(sql, subsId, 'past_due', eventAt, {}));
      return finish({ status: 'ignored', message: 'invoice_event_not_needed' });
    }
    if (a.type.startsWith('subscription.')) {
      const status = String(a.data.attributes.status ?? '');
      if (!SUB_STATUS.has(status)) return finish({ status: 'ignored', message: 'unknown_status' });
      const next = typeof a.data.attributes.next_billing_schedule === 'string' ? new Date(a.data.attributes.next_billing_schedule) : null;
      return finish(await applySubscriptionChange(sql, a.data.id, status, eventAt, { nextBilling: next && !Number.isNaN(next.getTime()) ? next : null }));
    }
    return finish({ status: 'ignored', message: 'event_type_not_handled' });
  } catch (err) {
    log('error', 'webhook.processing_failed', { eventType: a.type, err: String(err) });
    return finish({ status: 'failed', message: 'processing_error' });
  }
}

async function applySubscriptionChange(
  sql: Sql,
  providerSubscriptionId: string,
  status: string,
  eventAt: Date,
  opts: { invoicePaid?: boolean; nextBilling?: Date | null },
): Promise<WebhookOutcome> {
  return sql.begin(async (tx) => {
    const [sub] = await tx`select * from subscriptions where provider_subscription_id = ${providerSubscriptionId} for update`;
    if (!sub) return { status: 'ignored', message: 'unknown_subscription' } as WebhookOutcome;
    if (sub.last_event_at && new Date(sub.last_event_at).getTime() > eventAt.getTime()) {
      return { status: 'ignored', message: 'out_of_order_older_event' } as WebhookOutcome;
    }
    // A terminal cancellation is never re-opened by a late event.
    if (sub.status === 'cancelled' && status !== 'cancelled') return { status: 'ignored', message: 'already_cancelled' } as WebhookOutcome;

    const wasActive = sub.status === 'active';
    let periodStart: Date | null = sub.current_period_start ? new Date(sub.current_period_start) : null;
    let periodEnd: Date | null = sub.current_period_end ? new Date(sub.current_period_end) : null;
    let planId: string = sub.plan_id;
    let pendingPlanId: string | null = sub.pending_plan_id;

    if (status === 'active' && (opts.invoicePaid || !periodStart)) {
      periodStart = eventAt;
      periodEnd = opts.nextBilling ?? addMonths(eventAt, 1);
      // Plan changes take effect at the next billing cycle (PayMongo behaviour).
      if (opts.invoicePaid && pendingPlanId && wasActive) {
        planId = pendingPlanId;
        pendingPlanId = null;
      }
    } else if (opts.nextBilling) {
      periodEnd = opts.nextBilling;
    }

    await tx`
      update subscriptions set
        status = ${status},
        plan_id = ${planId},
        pending_plan_id = ${pendingPlanId},
        current_period_start = ${periodStart?.toISOString() ?? null},
        current_period_end = ${periodEnd?.toISOString() ?? null},
        past_due_since = ${status === 'past_due' ? (sub.past_due_since ?? eventAt.toISOString()) : null},
        cancelled_at = ${status === 'cancelled' ? (sub.cancelled_at ?? eventAt.toISOString()) : sub.cancelled_at},
        last_event_at = ${eventAt.toISOString()}
      where id = ${sub.id}`;

    if (status === 'active' && !wasActive && !sub.current_period_start) {
      await tx`insert into product_events (user_id, event, related_id) values (${sub.user_id}, 'subscription_started', ${sub.id})`;
    }
    return { status: 'processed' } as WebhookOutcome;
  });
}

/** Build a PayMongo-shaped event (used by the dev-only billing simulator and tests). */
export function buildPaymongoEvent(p: {
  eventId: string;
  type: string;
  resourceId: string;
  status?: string;
  livemode?: boolean;
  createdAt: Date;
  nextBillingSchedule?: string;
}) {
  const isInvoice = p.type.startsWith('subscription.invoice.');
  return {
    data: {
      id: p.eventId,
      type: 'event',
      attributes: {
        type: p.type,
        livemode: p.livemode ?? false,
        created_at: Math.floor(p.createdAt.getTime() / 1000),
        updated_at: Math.floor(p.createdAt.getTime() / 1000),
        data: isInvoice
          ? { id: `inv_${p.eventId}`, type: 'invoice', attributes: { resource_id: p.resourceId, status: p.status ?? 'paid', currency: 'PHP' } }
          : { id: p.resourceId, type: 'subscription', attributes: { id: p.resourceId, status: p.status ?? 'active', next_billing_schedule: p.nextBillingSchedule } },
      },
    },
  };
}
