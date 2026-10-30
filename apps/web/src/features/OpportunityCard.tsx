import { Building2, Clock, MapPin } from 'lucide-react';
import { Link } from 'react-router-dom';
import { REMOTE_ELIGIBILITY_LABELS, RESTRICTION_LABELS, skillLabel, type OpportunityListItem } from '@vlf/shared';
import { BADGE_TONE, Badge, Card, ScoreRing } from '../components/ui';
import { relDays } from '../lib/format';

const ENGAGEMENT: Record<string, string> = { contract: 'Contract', freelance: 'Freelance', part_time: 'Part-time', full_time: 'Full-time', unknown: 'Engagement not stated' };
const ARRANGEMENT: Record<string, string> = { remote: 'Remote', hybrid: 'Hybrid', onsite: 'On-site', unknown: 'Arrangement not stated' };

export function OpportunityCard({ o, actions }: { o: OpportunityListItem; actions?: React.ReactNode }) {
  const topReason = o.components.find((c) => c.key === 'skills')?.reasons[0];
  const signal = o.hiringSignals[0];
  return (
    <Card as="article" className="flex flex-col gap-3 transition-shadow hover:shadow-md">
      <div className="flex gap-4">
        <ScoreRing score={o.score} band={o.band} />
        <div className="min-w-0 flex-1">
          <p className="flex items-center gap-1.5 text-sm text-muted"><Building2 className="size-3.5" aria-hidden />{o.companyName}</p>
          <h3 className="text-base font-bold leading-snug">
            <Link to={`/app/opportunities/${o.id}`} className="text-navy-900 no-underline hover:underline">{o.title}</Link>
          </h3>
          <p className="mt-0.5 text-xs font-medium text-muted">{o.bandLabel}</p>
        </div>
      </div>
      <div className="flex flex-wrap gap-1.5">
        {o.badges.map((b) => <Badge key={b} tone={BADGE_TONE[b]}>{b}</Badge>)}
        <Badge>{ARRANGEMENT[o.workArrangement]}</Badge>
        <Badge>{ENGAGEMENT[o.engagementType]}</Badge>
      </div>
      <dl className="grid gap-1 text-xs text-muted sm:grid-cols-2">
        <div className="flex items-center gap-1.5"><MapPin className="size-3.5" aria-hidden /><dt className="sr-only">Eligibility</dt><dd>{REMOTE_ELIGIBILITY_LABELS[o.remoteEligibility]}</dd></div>
        <div className="flex items-center gap-1.5"><Clock className="size-3.5" aria-hidden /><dt className="sr-only">Posted</dt><dd>Posted {relDays(o.publishedAt)} · verified {relDays(o.lastVerifiedAt)}</dd></div>
      </dl>
      {o.explicitRestrictions.length > 0 && (
        <p className="text-xs text-danger"><span className="font-semibold">Restrictions:</span> {o.explicitRestrictions.map((r) => RESTRICTION_LABELS[r]).join(' · ')}</p>
      )}
      {signal && <p className="text-sm"><span className="font-medium text-navy-900">Hiring signal:</span> {signal.note}</p>}
      {topReason && <p className="text-sm text-muted">{topReason}</p>}
      <div className="flex flex-wrap gap-1">{o.skills.map((s) => <span key={s} className="rounded bg-page px-2 py-0.5 text-xs text-ink">{skillLabel(s)}</span>)}</div>
      <div className="mt-auto flex flex-wrap items-center justify-between gap-2 border-t border-line pt-3">
        <p className="text-xs text-muted">Source: {o.source.providerName}</p>
        <div className="flex flex-wrap gap-2">{actions}</div>
      </div>
    </Card>
  );
}
