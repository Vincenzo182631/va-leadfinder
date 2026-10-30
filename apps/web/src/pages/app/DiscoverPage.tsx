import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Compass, EyeOff, SlidersHorizontal } from 'lucide-react';
import { useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import { INDUSTRIES, SKILLS, type OpportunityListResponse } from '@vlf/shared';
import { Alert, Button, ButtonLink, Card, EmptyState, ErrorState, Field, Input, LoadingBlock, PageHeader, Select } from '../../components/ui';
import { OpportunityCard } from '../../features/OpportunityCard';
import { useMe } from '../../hooks/queries';
import { api } from '../../lib/api';
import { fmtDateTime } from '../../lib/format';

const FILTER_KEYS = ['query', 'skill', 'industry', 'remote', 'date', 'minScore', 'maxScore', 'source', 'seen', 'includeHidden', 'page'] as const;

export function DiscoverPage() {
  const [params, setParams] = useSearchParams();
  const [showFilters, setShowFilters] = useState(false);
  const [draftQuery, setDraftQuery] = useState(params.get('query') ?? '');
  const me = useMe();
  const qc = useQueryClient();
  const qs = new URLSearchParams();
  for (const k of FILTER_KEYS) { const v = params.get(k); if (v) qs.set(k, v); }
  const list = useQuery({ queryKey: ['opportunities', qs.toString()], queryFn: () => api<OpportunityListResponse>(`/api/opportunities?${qs}`) });
  const sources = useQuery({ queryKey: ['sources'], queryFn: () => api<{ sources: { id: string; name: string }[] }>('/api/sources') });
  const dismiss = useMutation({
    mutationFn: (id: string) => api(`/api/opportunities/${id}/dismiss`, { method: 'POST' }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['opportunities'] }),
  });

  // Functional update: always derive from the latest URL state (avoids stale filters after rapid changes).
  const setParam = (k: string, v: string | null) =>
    setParams((prev) => {
      const next = new URLSearchParams(prev);
      if (v === null || v === '' || v === 'any' || v === 'all') next.delete(k); else next.set(k, v);
      if (k !== 'page') next.delete('page');
      return next;
    }, { replace: true });
  const page = Number(params.get('page') ?? 1);
  const d = list.data;
  const pages = d ? Math.max(1, Math.ceil(d.total / d.pageSize)) : 1;

  return (
    <>
      <PageHeader
        title="Discover opportunities"
        description={<>Sorted by your match score. Last source refresh: {fmtDateTime(d?.lastRefreshAt)}</>}
        actions={<Button variant="secondary" onClick={() => setShowFilters(!showFilters)} aria-expanded={showFilters} aria-controls="filters"><SlidersHorizontal className="size-4" aria-hidden /> Filters</Button>}
      />
      {me.data?.appMode.demoMode && me.data.appMode.liveSourcesActive === 0 && (
        <Alert tone="warn" className="mb-4" title="You are viewing demo data">All opportunities below are fictional examples. No licensed live source is active yet.</Alert>
      )}
      <form role="search" className="mb-4 flex gap-2" onSubmit={(e) => { e.preventDefault(); setParam('query', draftQuery.trim()); }}>
        <label htmlFor="q" className="sr-only">Search opportunities</label>
        <Input id="q" type="search" placeholder="Search company, role or industry" value={draftQuery} onChange={(e) => setDraftQuery(e.target.value)} maxLength={100} />
        <Button type="submit">Search</Button>
      </form>

      {showFilters && (
        <Card className="mb-4" as="section">
          <h2 id="filters" className="sr-only">Filters</h2>
          <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
            <Field label="Skill">{(id) => (
              <Select id={id} value={params.get('skill') ?? ''} onChange={(e) => setParam('skill', e.target.value)}>
                <option value="">Any skill</option>{SKILLS.map((s) => <option key={s.code} value={s.code}>{s.label}</option>)}
              </Select>
            )}</Field>
            <Field label="Industry">{(id) => (
              <Select id={id} value={params.get('industry') ?? ''} onChange={(e) => setParam('industry', e.target.value)}>
                <option value="">Any industry</option>{INDUSTRIES.map((i) => <option key={i} value={i}>{i}</option>)}
              </Select>
            )}</Field>
            <Field label="Remote / contract">{(id) => (
              <Select id={id} value={params.get('remote') ?? 'any'} onChange={(e) => setParam('remote', e.target.value)}>
                <option value="any">Any</option><option value="remote_eligible">Remote & Philippines-eligible</option><option value="contract">Contract / freelance / part-time</option>
              </Select>
            )}</Field>
            <Field label="Posted">{(id) => (
              <Select id={id} value={params.get('date') ?? 'any'} onChange={(e) => setParam('date', e.target.value)}>
                <option value="any">Any time</option><option value="7d">Last 7 days</option><option value="14d">Last 14 days</option><option value="30d">Last 30 days</option>
              </Select>
            )}</Field>
            <Field label="Minimum match score">{(id) => (
              <Select id={id} value={params.get('minScore') ?? '50'} onChange={(e) => setParam('minScore', e.target.value === '50' ? null : e.target.value)}>
                <option value="75">75+ (High fit)</option><option value="50">50+ (Potential fit)</option><option value="0">Show all, including low fit</option>
              </Select>
            )}</Field>
            <Field label="Source">{(id) => (
              <Select id={id} value={params.get('source') ?? ''} onChange={(e) => setParam('source', e.target.value)}>
                <option value="">All sources</option>{sources.data?.sources.map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}
              </Select>
            )}</Field>
            <Field label="Viewed">{(id) => (
              <Select id={id} value={params.get('seen') ?? 'all'} onChange={(e) => setParam('seen', e.target.value)}>
                <option value="all">New and viewed</option><option value="new">Not viewed yet</option><option value="viewed">Previously viewed</option>
              </Select>
            )}</Field>
            <div className="flex items-end">
              <Button variant="ghost" onClick={() => { setParams(new URLSearchParams(), { replace: true }); setDraftQuery(''); }}>Reset filters</Button>
            </div>
          </div>
        </Card>
      )}

      {list.isLoading && <LoadingBlock rows={4} />}
      {list.isError && <ErrorState error={list.error} onRetry={() => list.refetch()} />}
      {d && (
        <>
          <p className="mb-3 text-sm text-muted" aria-live="polite">
            {d.total} opportunit{d.total === 1 ? 'y' : 'ies'}
            {d.hiddenCount > 0 && params.get('includeHidden') !== 'true' && (
              <> · {d.hiddenCount} hidden by your eligibility settings, score or dismissals — <button className="font-medium text-teal-700 underline" onClick={() => setParam('includeHidden', 'true')}>show them</button></>
            )}
            {params.get('includeHidden') === 'true' && <> · <button className="font-medium text-teal-700 underline" onClick={() => setParam('includeHidden', null)}>hide restricted and dismissed</button></>}
          </p>
          {d.items.length === 0 ? (
            (sources.data && sources.data.sources.length === 0) || (me.data && !me.data.appMode.demoMode && me.data.appMode.liveSourcesActive === 0) ? (
              <EmptyState icon={<Compass className="size-6" />} title="No data sources are active">
                No approved opportunity source is currently enabled. This is expected while licensed sources are being set up.
              </EmptyState>
            ) : (
              <EmptyState icon={<Compass className="size-6" />} title="No opportunities match these filters" action={<ButtonLink to="/app/discover" variant="secondary">Clear filters</ButtonLink>}>
                Try a lower minimum score, a different skill, or a wider date range.
              </EmptyState>
            )
          ) : (
            <div className="grid gap-4 md:grid-cols-2">
              {d.items.map((o) => (
                <div key={o.id}>
                  <OpportunityCard
                    o={o}
                    actions={
                      <>
                        {!o.dismissed && !o.saved && (
                          <Button variant="ghost" size="sm" onClick={() => dismiss.mutate(o.id)} aria-label={`Dismiss ${o.title}`}><EyeOff className="size-4" aria-hidden /> Dismiss</Button>
                        )}
                        <ButtonLink to={`/app/opportunities/${o.id}`} variant={o.unlocked ? 'secondary' : 'primary'} className="min-h-[34px] px-3 py-1.5 text-[13px]">
                          {o.saved ? 'Saved · view' : o.unlocked ? 'View details' : 'View & unlock'}
                        </ButtonLink>
                      </>
                    }
                  />
                  {o.excluded && <p className="mt-1 px-1 text-xs text-danger">Hidden by default: {o.exclusionReasons.join('; ')}</p>}
                </div>
              ))}
            </div>
          )}
          {pages > 1 && (
            <nav aria-label="Pagination" className="mt-6 flex items-center justify-center gap-3">
              <Button variant="secondary" size="sm" disabled={page <= 1} onClick={() => setParam('page', String(page - 1))}>Previous</Button>
              <span className="text-sm text-muted">Page {page} of {pages}</span>
              <Button variant="secondary" size="sm" disabled={page >= pages} onClick={() => setParam('page', String(page + 1))}>Next</Button>
            </nav>
          )}
        </>
      )}
    </>
  );
}
