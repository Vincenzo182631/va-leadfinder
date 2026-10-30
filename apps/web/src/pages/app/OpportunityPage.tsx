import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { ArrowLeft, Copy, ExternalLink, Flag, Lock, ShieldAlert } from 'lucide-react';
import { useEffect, useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import {
  FEEDBACK_REASONS, OUTREACH_COMPLIANCE_NOTE, PIPELINE_STAGES, REMOTE_ELIGIBILITY_LABELS, RESTRICTION_LABELS, TEMPLATE_CODES, TEMPLATE_META,
  skillLabel, type FeedbackReason, type OpportunityDetail, type PipelineStage, type TemplateCode, type UsageResponse,
} from '@vlf/shared';
import { Alert, BADGE_TONE, Badge, Button, ButtonLink, Card, ErrorState, Field, Input, LoadingBlock, ScoreRing, Select, Textarea } from '../../components/ui';
import { api, ApiError, errorMessage } from '../../lib/api';
import { fmtDate, fmtDateTime } from '../../lib/format';

const REASON_LABELS: Record<FeedbackReason, string> = {
  inaccurate: 'Information is inaccurate', expired: 'Role is closed or expired', not_outsourcing: 'Not open to contractors/VAs',
  region_restricted: 'Restricted region not shown', personal_data: 'Contains personal data', takedown_request: 'Request removal (source owner)', other: 'Other',
};

const safeHref = (u: string | null | undefined) => (u && /^https?:\/\//i.test(u) ? u : null);

export function OpportunityPage() {
  const { id = '' } = useParams();
  const qc = useQueryClient();
  const q = useQuery({ queryKey: ['opportunity', id], queryFn: () => api<OpportunityDetail>(`/api/opportunities/${id}`) });
  const refresh = () => {
    qc.invalidateQueries({ queryKey: ['opportunity', id] });
    qc.invalidateQueries({ queryKey: ['usage'] });
    qc.invalidateQueries({ queryKey: ['opportunities'] });
    qc.invalidateQueries({ queryKey: ['dashboard'] });
  };
  const [unlockErr, setUnlockErr] = useState<ApiError | null>(null);
  const unlock = useMutation({
    mutationFn: () => api<{ status: string; usage: UsageResponse }>(`/api/opportunities/${id}/unlock`, { method: 'POST' }),
    onSuccess: () => { setUnlockErr(null); refresh(); },
    onError: (e) => setUnlockErr(e instanceof ApiError ? e : new ApiError(0, 'error', errorMessage(e))),
  });
  const save = useMutation({ mutationFn: () => api('/api/saved', { method: 'POST', body: { opportunityId: id } }), onSuccess: refresh });

  if (q.isLoading) return <LoadingBlock rows={4} />;
  if (q.isError) return (
    <div className="space-y-4">
      <ErrorState error={q.error} onRetry={() => q.refetch()} />
      <ButtonLink to="/app/discover" variant="secondary">Back to Discover</ButtonLink>
    </div>
  );
  const o = q.data!;
  const sourceHref = safeHref(o.full?.sourceUrl);

  return (
    <div className="space-y-6">
      <Link to="/app/discover" className="inline-flex items-center gap-1 text-sm"><ArrowLeft className="size-4" aria-hidden /> Back to Discover</Link>
      {o.isDemo && <Alert tone="warn" title="Demo opportunity">This is a fictional example for exploring the product. It is not a real business or lead — do not contact it.</Alert>}

      <Card>
        <div className="flex flex-col gap-4 sm:flex-row sm:items-start">
          <ScoreRing score={o.score} band={o.band} />
          <div className="min-w-0 flex-1">
            <p className="text-sm text-muted">{o.companyName} · {o.industry} · {o.country}</p>
            <h1 className="text-2xl font-bold">{o.title}</h1>
            <p className="mt-1 text-sm font-medium text-muted">{o.bandLabel} · {o.score}/100 (estimate)</p>
            <div className="mt-3 flex flex-wrap gap-1.5">
              {o.badges.map((b) => <Badge key={b} tone={BADGE_TONE[b]}>{b}</Badge>)}
              <Badge>{REMOTE_ELIGIBILITY_LABELS[o.remoteEligibility]}</Badge>
              {o.skills.map((s) => <Badge key={s}>{skillLabel(s)}</Badge>)}
            </div>
          </div>
        </div>
      </Card>

      <div className="grid gap-6 lg:grid-cols-3">
        <div className="space-y-6 lg:col-span-2">
          {(o.explicitRestrictions.length > 0 || o.excluded || o.penalties.length > 0 || o.remoteEligibility === 'unknown') && (
            <Card as="section" className="border-danger/30">
              <h2 className="flex items-center gap-2 text-lg font-bold"><ShieldAlert className="size-5 text-danger" aria-hidden /> Eligibility & restrictions</h2>
              <ul className="mt-2 list-disc space-y-1 pl-5 text-sm">
                {o.explicitRestrictions.map((r) => <li key={r}>{RESTRICTION_LABELS[r]}</li>)}
                {o.remoteEligibility === 'unknown' && <li>The source does not say which countries are eligible. Verify before reaching out.</li>}
                {o.exclusionReasons.map((r) => <li key={r} className="text-danger">{r}</li>)}
                {o.penalties.map((p) => <li key={p}>{p}</li>)}
              </ul>
            </Card>
          )}

          <Card as="section">
            <h2 className="text-lg font-bold">Why it matched</h2>
            <div className="mt-4 space-y-4">
              {o.components.map((c) => (
                <div key={c.key}>
                  <div className="flex items-center justify-between text-sm">
                    <span className="font-medium text-navy-900">{c.label}</span>
                    <span className="text-muted">{c.points} / {c.max}</span>
                  </div>
                  <div className="mt-1 h-2 rounded-full bg-line" role="progressbar" aria-label={c.label} aria-valuemin={0} aria-valuemax={c.max} aria-valuenow={c.points}>
                    <div className="h-2 rounded-full bg-teal-500" style={{ width: `${(c.points / c.max) * 100}%` }} />
                  </div>
                  <ul className="mt-1.5 space-y-0.5 text-sm text-muted">{c.reasons.map((r) => <li key={r}>{r}</li>)}</ul>
                </div>
              ))}
            </div>
            <p className="mt-4 text-xs text-muted">Scores are estimates from the information available. A "Hiring signal" is evidence of need, not confirmation that the business will hire a VA.</p>
          </Card>

          {!o.full ? (
            <Card as="section" className="text-center">
              <Lock className="mx-auto size-8 text-teal-700" aria-hidden />
              <h2 className="mt-2 text-lg font-bold">Unlock full details</h2>
              <p className="mx-auto mt-1 max-w-md text-sm text-muted">See the full summary, the original source link, the company's contact route, and prepare an outreach draft. Uses 1 unlock from your monthly allowance (re-opening it this month is free).</p>
              {unlockErr && (
                <Alert tone={unlockErr.code === 'plan_limit_reached' || unlockErr.code === 'live_data_requires_paid_plan' ? 'warn' : 'error'} className="mx-auto mt-4 max-w-md text-left" title={unlockErr.code === 'plan_limit_reached' ? 'Monthly limit reached' : undefined}>
                  {unlockErr.message} <Link to="/app/account#billing">See plans</Link>
                </Alert>
              )}
              <Button className="mt-4" onClick={() => unlock.mutate()} loading={unlock.isPending}>Unlock opportunity</Button>
            </Card>
          ) : (
            <>
              <Card as="section">
                <h2 className="text-lg font-bold">Opportunity summary</h2>
                <p className="mt-2 whitespace-pre-line text-sm">{o.full.originalSummary}</p>
                {o.hiringSignals.length > 0 && (
                  <>
                    <h3 className="mt-4 text-sm font-semibold">Evidence of a current need</h3>
                    <ul className="mt-1 list-disc space-y-0.5 pl-5 text-sm">{o.hiringSignals.map((s) => <li key={s.type + s.note}>{s.note}</li>)}</ul>
                  </>
                )}
                {o.full.outsourcingEvidence && <p className="mt-3 text-sm"><span className="font-semibold">Outsourcing / contract evidence:</span> {o.full.outsourcingEvidence}</p>}
              </Card>
              <OutreachSection o={o} onSaved={refresh} />
            </>
          )}
        </div>

        <div className="space-y-6">
          <Card as="section">
            <h2 className="text-lg font-bold">Source</h2>
            <dl className="mt-2 space-y-2 text-sm">
              <div><dt className="text-muted">Provider</dt><dd className="font-medium">{o.source.providerName}</dd></div>
              {o.source.attributionText && <div><dt className="text-muted">Attribution</dt><dd>{o.source.attributionText}</dd></div>}
              <div><dt className="text-muted">Posted / observed</dt><dd>{fmtDate(o.full?.sourcePostedAt ?? o.publishedAt)}</dd></div>
              <div><dt className="text-muted">Last verified</dt><dd>{fmtDateTime(o.lastVerifiedAt)}{o.badges.includes('Stale') && <Badge tone="warn" className="ml-2">Stale</Badge>}</dd></div>
              {o.expiresAt && <div><dt className="text-muted">Expires</dt><dd>{fmtDate(o.expiresAt)}</dd></div>}
            </dl>
            {o.full && (
              <div className="mt-4 space-y-2">
                {sourceHref && (
                  <a href={sourceHref} target="_blank" rel="noopener noreferrer nofollow" onClick={() => api('/api/events', { method: 'POST', body: { event: 'source_link_clicked', relatedId: o.id } }).catch(() => {})} className="inline-flex items-center gap-1 text-sm font-medium">
                    View original source <ExternalLink className="size-3.5" aria-hidden />
                  </a>
                )}
                {safeHref(o.full.companySite) && <p className="text-sm"><a href={safeHref(o.full.companySite)!} target="_blank" rel="noopener noreferrer nofollow">Company website</a></p>}
                <div className="text-sm break-all">
                  <p className="text-muted">Business contact route</p>
                  {o.full.contactRoute ? (safeHref(o.full.contactRoute)
                    ? <a href={safeHref(o.full.contactRoute)!} target="_blank" rel="noopener noreferrer nofollow">{o.full.contactRoute}</a>
                    : <span className="font-medium">{o.full.contactRoute}</span>)
                    : <span>Not published — use the original source.</span>}
                </div>
              </div>
            )}
            <p className="mt-4 text-xs text-muted">Details may have changed since we last verified them. Confirm on the original source before reaching out.</p>
          </Card>

          {o.full && <PipelineSection o={o} onSave={() => save.mutate()} saving={save.isPending} onChange={refresh} />}
          <ReportSection id={o.id} />
        </div>
      </div>
    </div>
  );
}

function PipelineSection({ o, onSave, saving, onChange }: { o: OpportunityDetail; onSave: () => void; saving: boolean; onChange: () => void }) {
  const sp = o.savedProspect;
  const [notes, setNotes] = useState(sp?.notes ?? '');
  const [follow, setFollow] = useState(sp?.followUpAt?.slice(0, 10) ?? '');
  const [msg, setMsg] = useState<string | null>(null);
  useEffect(() => { setNotes(sp?.notes ?? ''); setFollow(sp?.followUpAt?.slice(0, 10) ?? ''); }, [sp?.id, sp?.notes, sp?.followUpAt]);
  const patch = useMutation({
    mutationFn: (body: Record<string, unknown>) => api(`/api/saved/${sp!.id}`, { method: 'PATCH', body }),
    onSuccess: () => { setMsg('Saved'); onChange(); setTimeout(() => setMsg(null), 2000); },
  });
  if (!sp) return (
    <Card as="section">
      <h2 className="text-lg font-bold">Pipeline</h2>
      <p className="mt-1 text-sm text-muted">Save this prospect to track research, outreach and follow-ups.</p>
      <Button className="mt-3 w-full" onClick={onSave} loading={saving}>Save to pipeline</Button>
    </Card>
  );
  return (
    <Card as="section">
      <h2 className="text-lg font-bold">Pipeline</h2>
      <div className="mt-3 space-y-3">
        <Field label="Stage">{(id) => (
          <Select id={id} value={sp.stage} onChange={(e) => patch.mutate({ stage: e.target.value as PipelineStage })}>
            {PIPELINE_STAGES.map((s) => <option key={s.code} value={s.code}>{s.label}</option>)}
          </Select>
        )}</Field>
        <Field label="Follow-up date">{(id) => <Input id={id} type="date" value={follow} onChange={(e) => setFollow(e.target.value)} />}</Field>
        <Field label="Notes">{(id) => <Textarea id={id} value={notes} maxLength={5000} onChange={(e) => setNotes(e.target.value)} />}</Field>
        <Button variant="secondary" className="w-full" loading={patch.isPending} onClick={() => patch.mutate({ notes, followUpAt: follow ? new Date(`${follow}T09:00:00`).toISOString() : null })}>Save notes</Button>
        <p className="text-xs text-teal-700" aria-live="polite">{msg}</p>
      </div>
    </Card>
  );
}

function OutreachSection({ o, onSaved }: { o: OpportunityDetail; onSaved: () => void }) {
  const [template, setTemplate] = useState<TemplateCode>((o.draft?.templateCode as TemplateCode) ?? 'general_admin');
  const [body, setBody] = useState(o.draft?.body ?? '');
  const [copied, setCopied] = useState(false);
  const gen = useMutation({
    mutationFn: (b: { body?: string }) => api<{ body: string }>('/api/outreach/draft', { method: 'POST', body: { opportunityId: o.id, templateCode: template, ...b } }),
    onSuccess: (r) => { setBody(r.body); onSaved(); },
  });
  const copy = async () => {
    try { await navigator.clipboard.writeText(body); } catch { /* clipboard may be blocked; text is still selectable */ }
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
    api('/api/events', { method: 'POST', body: { event: 'outreach_draft_copied', relatedId: o.id } }).catch(() => {});
  };
  return (
    <Card as="section">
      <h2 className="text-lg font-bold">Outreach draft</h2>
      <p className="mt-1 text-sm text-muted">Drafts use only confirmed details from this opportunity and your profile. Nothing is sent automatically.</p>
      <div className="mt-4 flex flex-col gap-3 sm:flex-row sm:items-end">
        <div className="flex-1">
          <Field label="Template">{(id) => (
            <Select id={id} value={template} onChange={(e) => setTemplate(e.target.value as TemplateCode)}>
              {TEMPLATE_CODES.map((t) => <option key={t} value={t}>{TEMPLATE_META[t].label}</option>)}
            </Select>
          )}</Field>
        </div>
        <Button variant="secondary" onClick={() => gen.mutate({})} loading={gen.isPending && !body}>{body ? 'Regenerate' : 'Create draft'}</Button>
      </div>
      {gen.isError && <Alert tone="error" className="mt-3">{errorMessage(gen.error)}</Alert>}
      {body && (
        <div className="mt-4 space-y-3">
          <label htmlFor="draft" className="sr-only">Draft message</label>
          <Textarea id="draft" value={body} onChange={(e) => setBody(e.target.value)} className="min-h-[300px] font-mono text-[13px]" maxLength={8000} />
          <div className="flex flex-wrap gap-2">
            <Button onClick={copy}><Copy className="size-4" aria-hidden /> {copied ? 'Copied!' : 'Copy draft'}</Button>
            <Button variant="secondary" onClick={() => gen.mutate({ body })} loading={gen.isPending}>Save edits</Button>
          </div>
          <Alert tone="info">{OUTREACH_COMPLIANCE_NOTE}</Alert>
        </div>
      )}
    </Card>
  );
}

function ReportSection({ id }: { id: string }) {
  const [open, setOpen] = useState(false);
  const [reason, setReason] = useState<FeedbackReason>('inaccurate');
  const [details, setDetails] = useState('');
  const send = useMutation({ mutationFn: () => api(`/api/opportunities/${id}/feedback`, { method: 'POST', body: { reason, details } }) });
  return (
    <Card as="section">
      {!open ? (
        <Button variant="ghost" className="w-full" onClick={() => setOpen(true)}><Flag className="size-4" aria-hidden /> Report inaccurate</Button>
      ) : send.isSuccess ? (
        <Alert tone="success">Thanks — our team will review this report.</Alert>
      ) : (
        <form className="space-y-3" onSubmit={(e) => { e.preventDefault(); send.mutate(); }}>
          <h2 className="text-base font-bold">Report a problem</h2>
          <Field label="Reason">{(fid) => (
            <Select id={fid} value={reason} onChange={(e) => setReason(e.target.value as FeedbackReason)}>
              {FEEDBACK_REASONS.map((r) => <option key={r} value={r}>{REASON_LABELS[r]}</option>)}
            </Select>
          )}</Field>
          <Field label="Details (optional)">{(fid) => <Textarea id={fid} value={details} maxLength={2000} onChange={(e) => setDetails(e.target.value)} />}</Field>
          {send.isError && <Alert tone="error">{errorMessage(send.error)}</Alert>}
          <div className="flex gap-2"><Button type="submit" loading={send.isPending}>Send report</Button><Button type="button" variant="ghost" onClick={() => setOpen(false)}>Cancel</Button></div>
        </form>
      )}
    </Card>
  );
}
