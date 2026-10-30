import { useQuery } from '@tanstack/react-query';
import { ArrowRight, Bell, Bookmark, Compass, Send, Sparkles } from 'lucide-react';
import type { DashboardResponse } from '@vlf/shared';
import { Link } from 'react-router-dom';
import { Alert, ButtonLink, Card, EmptyState, ErrorState, LoadingBlock, PageHeader } from '../../components/ui';
import { OpportunityCard } from '../../features/OpportunityCard';
import { useMe, useUsage } from '../../hooks/queries';
import { api } from '../../lib/api';
import { fmtDate, fmtDateTime } from '../../lib/format';

export function DashboardPage() {
  const me = useMe();
  const usage = useUsage();
  const q = useQuery({ queryKey: ['dashboard'], queryFn: () => api<DashboardResponse>('/api/dashboard') });
  if (q.isLoading) return <LoadingBlock rows={4} />;
  if (q.isError) return <ErrorState error={q.error} onRetry={() => q.refetch()} />;
  const d = q.data!;
  const demo = me.data?.appMode.demoMode;
  const live = me.data?.appMode.liveSourcesActive ?? 0;
  const stats = [
    { label: 'New since last visit', value: d.newSinceLastVisit, icon: Sparkles },
    { label: 'Unreviewed high-fit', value: d.unreviewedHighFit, icon: Compass },
    { label: 'Saved prospects', value: d.savedCount, icon: Bookmark },
    { label: 'Contacted', value: d.contactedCount, icon: Send },
  ];
  return (
    <>
      <PageHeader
        title={`Hello, ${d.greetingName}`}
        description={<>Data mode: <strong>{demo && live === 0 ? 'Demo only (fictional data)' : demo ? `Demo + ${live} live source(s)` : `${live} live source(s)`}</strong> · Last source refresh: {fmtDateTime(d.lastRefreshAt)}</>}
        actions={<ButtonLink to="/app/discover">Discover opportunities <ArrowRight className="size-4" aria-hidden /></ButtonLink>}
      />
      {d.savedCount === 0 && (
        <Card className="mb-6 border-teal-600/40 bg-teal-500/5">
          <h2 className="text-lg font-bold">Start here</h2>
          <ol className="mt-2 list-decimal space-y-1 pl-5 text-sm">
            <li>Open <strong>Discover</strong> and review a high-fit opportunity.</li>
            <li>Read <strong>why it matched</strong> and check any eligibility restrictions.</li>
            <li><strong>Unlock</strong> it, then <strong>save</strong> it to your pipeline and prepare an outreach draft.</li>
          </ol>
        </Card>
      )}
      {d.followUpsDue > 0 && <Alert tone="warn" className="mb-6" title={`${d.followUpsDue} follow-up${d.followUpsDue === 1 ? '' : 's'} due`}><Link to="/app/pipeline">Open your pipeline</Link></Alert>}
      <div className="mb-8 grid grid-cols-2 gap-3 lg:grid-cols-4">
        {stats.map((s) => (
          <Card key={s.label} className="p-4">
            <s.icon className="size-5 text-teal-700" aria-hidden />
            <p className="mt-2 font-display text-2xl font-extrabold text-navy-900">{s.value}</p>
            <p className="text-xs text-muted">{s.label}</p>
          </Card>
        ))}
      </div>
      {usage.data && (
        <p className="mb-4 flex items-center gap-2 text-sm text-muted"><Bell className="size-4" aria-hidden />
          {usage.data.planName}: {usage.data.remaining} of {usage.data.unlockLimit} unlocks left this month · resets {fmtDate(usage.data.resetsAt)}
        </p>
      )}
      <h2 className="mb-3 text-lg font-bold">Top matches for you</h2>
      {d.topMatches.length === 0 ? (
        <EmptyState icon={<Compass className="size-6" />} title="No matches yet" action={<ButtonLink to="/app/account" variant="secondary">Adjust preferences</ButtonLink>}>
          No opportunities currently fit your skills and settings. Try adding skills or allowing more work types.
        </EmptyState>
      ) : (
        <div className="grid gap-4 md:grid-cols-2">{d.topMatches.map((o) => <OpportunityCard key={o.id} o={o} />)}</div>
      )}
    </>
  );
}
