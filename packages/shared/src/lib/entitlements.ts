import type { SubscriptionStatus } from '../constants';

export interface PlanLike {
  code: string;
  monthlyUnlockLimit: number;
  exportPermission: boolean;
  liveDataAccess: boolean;
}

export interface SubscriptionLike {
  planCode: string;
  status: SubscriptionStatus;
  currentPeriodEnd: string | Date | null;
  pastDueSince: string | Date | null;
}

/**
 * Pure mirror of SQL `public.current_plan_code()` — the database function is the
 * source of truth on the server; this is used for UI copy and unit tests.
 */
export function resolvePlanCode(subs: SubscriptionLike[], now: Date, graceDays: number): string {
  const t = now.getTime();
  const ok = subs.filter((s) => {
    const end = s.currentPeriodEnd ? new Date(s.currentPeriodEnd).getTime() : null;
    if (s.status === 'active') return true;
    if (s.status === 'past_due') {
      const since = s.pastDueSince ? new Date(s.pastDueSince).getTime() : t;
      return t < since + graceDays * 86_400_000;
    }
    // Cancelled: PayMongo stops future invoices immediately; access continues until the paid period ends.
    if (s.status === 'cancelled') return end !== null && t < end;
    return false;
  });
  return ok[0]?.planCode ?? 'free';
}

/** Unlock-counting period: calendar month in Asia/Manila (matches SQL `public.current_period_key()`). */
export function periodKey(now: Date): string {
  const manila = new Date(now.getTime() + 8 * 3_600_000);
  return `${manila.getUTCFullYear()}-${String(manila.getUTCMonth() + 1).padStart(2, '0')}`;
}

export function nextResetDate(now: Date): Date {
  const manila = new Date(now.getTime() + 8 * 3_600_000);
  return new Date(Date.UTC(manila.getUTCFullYear(), manila.getUTCMonth() + 1, 1) - 8 * 3_600_000);
}

export type UnlockDecision =
  | { allowed: true; alreadyUnlocked: boolean }
  | { allowed: false; code: 'plan_limit_reached' | 'live_data_requires_paid_plan' };

export function decideUnlock(p: {
  plan: PlanLike;
  usedThisPeriod: number;
  alreadyUnlocked: boolean;
  opportunityIsDemo: boolean;
}): UnlockDecision {
  if (p.alreadyUnlocked) return { allowed: true, alreadyUnlocked: true };
  if (!p.opportunityIsDemo && !p.plan.liveDataAccess) return { allowed: false, code: 'live_data_requires_paid_plan' };
  if (p.usedThisPeriod >= p.plan.monthlyUnlockLimit) return { allowed: false, code: 'plan_limit_reached' };
  return { allowed: true, alreadyUnlocked: false };
}
