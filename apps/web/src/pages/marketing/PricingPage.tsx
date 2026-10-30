import { useQuery } from '@tanstack/react-query';
import { Check } from 'lucide-react';
import type { PlanDto } from '@vlf/shared';
import { Alert, Badge, ButtonLink, Card, ErrorState, LoadingBlock } from '../../components/ui';
import { api } from '../../lib/api';
import { cx, php } from '../../lib/format';

export function planFeatures(p: PlanDto): string[] {
  const f = [`${p.monthlyUnlockLimit} opportunity unlocks per month`];
  f.push(p.liveDataAccess ? 'Licensed live opportunities (when available)' : 'Demo opportunities only — no live leads');
  f.push('Saved prospect pipeline & notes', 'Editable outreach drafts');
  if (p.digestFrequency !== 'off') f.push(`${p.digestFrequency === 'daily' ? 'Daily' : 'Weekly'} email digest`);
  if (p.exportPermission) f.push('CSV export', 'Advanced filters');
  return f;
}

export function PricingPage() {
  const q = useQuery({ queryKey: ['plans'], queryFn: () => api<{ plans: PlanDto[]; billingMode: string }>('/api/plans') });
  return (
    <div className="mx-auto max-w-6xl px-4 py-14">
      <h1 className="text-4xl font-extrabold">Simple monthly plans</h1>
      <p className="mt-2 max-w-2xl text-muted">Prices in Philippine pesos. Cancel anytime from your account. No plan guarantees that you will win clients.</p>
      {q.data?.billingMode === 'disabled' && <Alert tone="warn" className="mt-6" title="Paid plans are not open yet">Online payments are being set up. You can explore the free demo today.</Alert>}
      {q.isLoading && <div className="mt-8"><LoadingBlock rows={2} /></div>}
      {q.isError && <div className="mt-8"><ErrorState error={q.error} onRetry={() => q.refetch()} /></div>}
      <div className="mt-8 grid gap-4 md:grid-cols-2 lg:grid-cols-4">
        {q.data?.plans.map((p) => (
          <Card key={p.code} className={cx('flex flex-col', p.code === 'pro' && 'border-teal-600 ring-2 ring-teal-500/30')}>
            <div className="flex items-center justify-between">
              <h2 className="text-lg font-bold">{p.name}</h2>
              {p.code === 'founding' && <Badge tone="teal">Limited</Badge>}
            </div>
            <p className="mt-3"><span className="font-display text-3xl font-extrabold text-navy-900">{p.phpAmount === 0 ? 'Free' : php(p.phpAmount)}</span>{p.phpAmount > 0 && <span className="text-sm text-muted"> / month</span>}</p>
            <p className="mt-2 text-sm text-muted">{p.description}</p>
            <ul className="mt-4 flex-1 space-y-2 text-sm">
              {planFeatures(p).map((f) => <li key={f} className="flex gap-2"><Check className="mt-0.5 size-4 shrink-0 text-teal-700" aria-hidden />{f}</li>)}
            </ul>
            <ButtonLink to="/signup" variant={p.code === 'pro' ? 'primary' : 'secondary'} className="mt-5 w-full">{p.phpAmount === 0 ? 'Start free' : 'Get started'}</ButtonLink>
            {!p.available && <p className="mt-2 text-xs text-warn">Currently full</p>}
          </Card>
        ))}
      </div>
      <p className="mt-6 text-xs text-muted">Payments are processed by PayMongo (cards and Maya). Plan changes apply from your next billing cycle. Quotas may be adjusted as live data sources are added; we will tell you before any change to a paid plan.</p>
    </div>
  );
}
