import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Briefcase, Download, Trash2 } from 'lucide-react';
import { useState } from 'react';
import { Link } from 'react-router-dom';
import { PIPELINE_STAGES, type PipelineStage, type SavedProspect } from '@vlf/shared';
import { Alert, Badge, Button, ButtonLink, Card, EmptyState, ErrorState, Input, LoadingBlock, PageHeader, Select } from '../../components/ui';
import { useUsage } from '../../hooks/queries';
import { api, downloadFile, errorMessage } from '../../lib/api';
import { fmtDate } from '../../lib/format';

export function PipelinePage() {
  const [query, setQuery] = useState('');
  const [stageFilter, setStageFilter] = useState<'all' | PipelineStage>('all');
  const [exportErr, setExportErr] = useState<string | null>(null);
  const usage = useUsage();
  const qc = useQueryClient();
  const q = useQuery({ queryKey: ['saved', query], queryFn: () => api<{ items: SavedProspect[] }>(`/api/saved?query=${encodeURIComponent(query)}`) });
  const patch = useMutation({
    mutationFn: ({ id, stage }: { id: string; stage: PipelineStage }) => api(`/api/saved/${id}`, { method: 'PATCH', body: { stage } }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['saved'] }),
  });
  const remove = useMutation({
    mutationFn: (id: string) => api(`/api/saved/${id}`, { method: 'DELETE' }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['saved'] }),
  });
  const items = (q.data?.items ?? []).filter((i) => stageFilter === 'all' || i.stage === stageFilter);
  const now = Date.now();

  return (
    <>
      <PageHeader
        title="Prospect pipeline"
        description="Track research, outreach and follow-ups. Nothing here is sent automatically."
        actions={usage.data?.exportPermission ? (
          <Button variant="secondary" onClick={() => downloadFile('/api/export', 'va-leadfinder-prospects.csv').catch((e) => setExportErr(errorMessage(e)))}><Download className="size-4" aria-hidden /> Export CSV</Button>
        ) : (
          <ButtonLink to="/app/account#billing" variant="secondary"><Download className="size-4" aria-hidden /> CSV export (Pro)</ButtonLink>
        )}
      />
      {exportErr && <Alert tone="error" className="mb-4">{exportErr}</Alert>}
      <div className="mb-4 flex flex-col gap-2 sm:flex-row">
        <label htmlFor="pq" className="sr-only">Search saved prospects</label>
        <Input id="pq" type="search" placeholder="Search company, role or notes" value={query} onChange={(e) => setQuery(e.target.value)} />
        <label htmlFor="ps" className="sr-only">Filter by stage</label>
        <Select id="ps" value={stageFilter} onChange={(e) => setStageFilter(e.target.value as typeof stageFilter)} className="sm:w-56">
          <option value="all">All stages</option>
          {PIPELINE_STAGES.map((s) => <option key={s.code} value={s.code}>{s.label}</option>)}
        </Select>
      </div>
      <div className="mb-4 flex flex-wrap gap-2" aria-label="Stage counts">
        {PIPELINE_STAGES.map((s) => <Badge key={s.code}>{s.label}: {(q.data?.items ?? []).filter((i) => i.stage === s.code).length}</Badge>)}
      </div>
      {q.isLoading && <LoadingBlock />}
      {q.isError && <ErrorState error={q.error} onRetry={() => q.refetch()} />}
      {q.data && items.length === 0 && (
        <EmptyState icon={<Briefcase className="size-6" />} title={q.data.items.length ? 'No prospects match' : 'Your pipeline is empty'} action={<ButtonLink to="/app/discover">Find opportunities</ButtonLink>}>
          Unlock an opportunity and choose "Save to pipeline" to start tracking it here.
        </EmptyState>
      )}
      <ul className="space-y-3">
        {items.map((p) => {
          const due = p.followUpAt && new Date(p.followUpAt).getTime() <= now && !['not_a_fit', 'qualified'].includes(p.stage);
          return (
            <Card as="li" key={p.id} className="flex flex-col gap-3 sm:flex-row sm:items-center">
              <div className="min-w-0 flex-1">
                <p className="text-sm text-muted">{p.companyName} {p.isDemo && <Badge tone="demo" className="ml-1">Demo</Badge>}</p>
                <Link to={`/app/opportunities/${p.opportunityId}`} className="font-semibold text-navy-900">{p.title}</Link>
                <p className="mt-1 text-xs text-muted">Saved {fmtDate(p.savedAt)}{p.followUpAt && <> · Follow up {fmtDate(p.followUpAt)}</>} {due && <Badge tone="warn" className="ml-1">Follow-up due</Badge>}</p>
                {p.notes && <p className="mt-1 line-clamp-2 text-sm">{p.notes}</p>}
              </div>
              <div className="flex items-center gap-2">
                <label htmlFor={`st-${p.id}`} className="sr-only">Stage for {p.title}</label>
                <Select id={`st-${p.id}`} value={p.stage} onChange={(e) => patch.mutate({ id: p.id, stage: e.target.value as PipelineStage })} className="w-44">
                  {PIPELINE_STAGES.map((s) => <option key={s.code} value={s.code}>{s.label}</option>)}
                </Select>
                <Button variant="ghost" size="sm" aria-label={`Remove ${p.title} from pipeline`} onClick={() => { if (confirm('Remove this prospect and its notes from your pipeline?')) remove.mutate(p.id); }}><Trash2 className="size-4" aria-hidden /></Button>
              </div>
            </Card>
          );
        })}
      </ul>
    </>
  );
}
