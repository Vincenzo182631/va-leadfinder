import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useState, type ReactNode } from 'react';
import { INDUSTRIES, SKILLS, type SkillCode } from '@vlf/shared';
import { Alert, Badge, Button, Card, ChipGroup, ErrorState, Field, Input, LoadingBlock, PageHeader, Select, Textarea, Toggle } from '../../components/ui';
import { api, errorMessage } from '../../lib/api';
import { cx, fmtDate, fmtDateTime, php } from '../../lib/format';

type Row = Record<string, any>;
const TABS = ['Overview', 'Sources', 'Moderation', 'Add / import', 'Ingestion', 'Users', 'Billing', 'Reports', 'Privacy', 'Settings', 'Audit log'] as const;
type Tab = (typeof TABS)[number];

export function AdminPage() {
  const [tab, setTab] = useState<Tab>('Overview');
  return (
    <>
      <PageHeader title="Admin" description="Founder-only. Every sensitive change is recorded in the audit log." />
      <div role="tablist" aria-label="Admin sections" className="mb-6 flex gap-1 overflow-x-auto border-b border-line">
        {TABS.map((t) => (
          <button key={t} role="tab" aria-selected={tab === t} onClick={() => setTab(t)}
            className={cx('whitespace-nowrap border-b-2 px-3 py-2 text-sm', tab === t ? 'border-teal-500 font-semibold text-navy-900' : 'border-transparent text-muted hover:text-navy-900')}>{t}</button>
        ))}
      </div>
      <div role="tabpanel" aria-label={tab}>
        {tab === 'Overview' && <Overview />}
        {tab === 'Sources' && <Sources />}
        {tab === 'Moderation' && <Moderation />}
        {tab === 'Add / import' && <AddImport />}
        {tab === 'Ingestion' && <Ingestion />}
        {tab === 'Users' && <SimpleTable path="/api/admin/users" cols={[['email', 'Email'], ['display_name', 'Name'], ['plan_code', 'Plan'], ['subscription_status', 'Subscription'], ['saved_count', 'Saved'], ['onboarding_completed', 'Onboarded'], ['created_at', 'Joined']]} />}
        {tab === 'Billing' && <SimpleTable path="/api/admin/billing-events" cols={[['received_at', 'Received'], ['type', 'Event'], ['status', 'Status'], ['safe_error_message', 'Note'], ['livemode', 'Live'], ['provider_event_id', 'Event ID']]} note={(d) => `Billing mode: ${d.billingMode}`} />}
        {tab === 'Reports' && <Reports />}
        {tab === 'Privacy' && <Privacy />}
        {tab === 'Settings' && <SettingsTab />}
        {tab === 'Audit log' && <SimpleTable path="/api/admin/audit-log" cols={[['created_at', 'When'], ['action', 'Action'], ['target_type', 'Target'], ['target_id', 'ID'], ['metadata', 'Details']]} />}
      </div>
    </>
  );
}

function useAdmin<T = Row>(path: string) {
  return useQuery({ queryKey: ['admin', path], queryFn: () => api<T>(path) });
}

function fmtCell(v: unknown): ReactNode {
  if (v === null || v === undefined || v === '') return <span className="text-faint">—</span>;
  if (typeof v === 'boolean') return v ? 'Yes' : 'No';
  if (typeof v === 'string' && /^\d{4}-\d{2}-\d{2}T/.test(v)) return fmtDateTime(v);
  if (typeof v === 'object') return <code className="text-xs">{JSON.stringify(v).slice(0, 120)}</code>;
  return String(v);
}

function Table({ cols, rows, actions }: { cols: [string, string][]; rows: Row[]; actions?: (r: Row) => ReactNode }) {
  if (!rows.length) return <p className="rounded-xl border border-dashed border-line bg-white p-6 text-center text-sm text-muted">Nothing here yet.</p>;
  return (
    <div className="overflow-x-auto rounded-xl border border-line bg-white">
      <table className="w-full text-left text-sm">
        <thead className="bg-page text-xs uppercase tracking-wide text-muted"><tr>{cols.map(([, l]) => <th key={l} scope="col" className="px-3 py-2 font-semibold">{l}</th>)}{actions && <th className="px-3 py-2"><span className="sr-only">Actions</span></th>}</tr></thead>
        <tbody className="divide-y divide-line">
          {rows.map((r, i) => <tr key={r.id ?? i} className="align-top">{cols.map(([k]) => <td key={k} className="max-w-[280px] px-3 py-2 break-words">{fmtCell(r[k])}</td>)}{actions && <td className="px-3 py-2 whitespace-nowrap">{actions(r)}</td>}</tr>)}
        </tbody>
      </table>
    </div>
  );
}

function SimpleTable({ path, cols, note }: { path: string; cols: [string, string][]; note?: (d: Row) => string }) {
  const q = useAdmin<Row>(path);
  if (q.isLoading) return <LoadingBlock />;
  if (q.isError) return <ErrorState error={q.error} onRetry={() => q.refetch()} />;
  return <>{note && <p className="mb-2 text-sm text-muted">{note(q.data!)}</p>}<Table cols={cols} rows={q.data!.items} /></>;
}

function Overview() {
  const q = useAdmin('/api/admin/overview');
  if (q.isLoading) return <LoadingBlock />;
  if (q.isError) return <ErrorState error={q.error} />;
  const d = q.data!;
  const stat = (label: string, value: ReactNode) => <Card className="p-4"><p className="text-xs text-muted">{label}</p><p className="font-display text-2xl font-extrabold text-navy-900">{value}</p></Card>;
  return (
    <div className="space-y-6">
      <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        {stat('Users', d.users.total)}{stat('Onboarded', d.users.onboarded)}{stat('Paying users', d.payingUsers)}{stat('Est. MRR', php(d.estimatedMrrPhp))}
        {stat('Activated (3+ saved)', d.activationUsers3Saved)}{stat('Cancelled (30d)', d.churn.cancelled30)}{stat('Webhook failures (7d)', d.webhooks.failed)}{stat('Moderation queue', d.queues.moderation)}
        {stat('Open reports', d.queues.feedback_open)}{stat('Takedown requests', d.queues.takedowns_open)}{stat('Privacy requests', d.queues.data_requests_pending)}{stat('Live / demo published', `${d.queues.live_published} / ${d.queues.demo_published}`)}
      </div>
      <Alert tone="info" title="API cost per paying user">{d.cost.note}</Alert>
      <div className="grid gap-6 lg:grid-cols-2">
        <div><h2 className="mb-2 font-bold">Product events (30 days)</h2><Table cols={[['event', 'Event'], ['n', 'Count']]} rows={d.events} /></div>
        <div><h2 className="mb-2 font-bold">Subscriptions</h2><Table cols={[['name', 'Plan'], ['status', 'Status'], ['n', 'Count']]} rows={d.subscriptions} /></div>
        <div><h2 className="mb-2 font-bold">Relevance feedback (30 days)</h2><Table cols={[['reason', 'Reason'], ['n', 'Count']]} rows={d.feedbackByReason} /></div>
        <div><h2 className="mb-2 font-bold">Recent ingestion runs</h2><Table cols={[['provider_name', 'Source'], ['status', 'Status'], ['accepted_count', 'Accepted'], ['rejected_count', 'Rejected'], ['started_at', 'Started']]} rows={d.recentRuns} /></div>
      </div>
    </div>
  );
}

const CHECKLIST: [string, string][] = [
  ['termsReviewed', 'Source terms reviewed for this exact paid, signup-gated use'],
  ['commercialUseConfirmed', 'Commercial use confirmed in writing'],
  ['redistributionConfirmed', 'Redistribution to subscribers confirmed in writing'],
  ['attributionConfigured', 'Required attribution configured'],
  ['retentionConfigured', 'Retention / expiry limits configured'],
  ['personalDataReviewed', 'Personal-data / privacy (DPA, NPC) review completed'],
];

function Sources() {
  const qc = useQueryClient();
  const q = useAdmin('/api/admin/sources');
  const [editing, setEditing] = useState<string | null>(null);
  const [creating, setCreating] = useState(false);
  if (q.isLoading) return <LoadingBlock />;
  if (q.isError) return <ErrorState error={q.error} />;
  return (
    <div className="space-y-4">
      <Alert tone="warn" title="Licensing gate">A source can only feed subscriber results after its licence is approved here with written evidence. Remotive, Adzuna, SerpApi and LinkedIn are NOT approved for this product without explicit written permission for this exact use.</Alert>
      <Button variant="secondary" onClick={() => setCreating(!creating)}>{creating ? 'Close' : 'Register a manual source'}</Button>
      {creating && <NewSource onDone={() => { setCreating(false); qc.invalidateQueries({ queryKey: ['admin'] }); }} />}
      {q.data!.items.map((s: Row) => (
        <Card key={s.id}>
          <div className="flex flex-wrap items-start justify-between gap-2">
            <div>
              <h3 className="font-bold">{s.name} <span className="text-xs font-normal text-muted">({s.provider_kind})</span></h3>
              <p className="text-xs text-muted">{s.data_type} · {s.opportunity_count} opportunities · last run {fmtDateTime(s.last_run_at)}</p>
            </div>
            <div className="flex flex-wrap gap-1.5">
              <Badge tone={s.license_status === 'approved' ? 'teal' : s.license_status === 'revoked' || s.license_status === 'rejected' ? 'danger' : 'warn'}>Licence: {s.license_status}</Badge>
              <Badge tone={s.enabled ? 'teal' : 'neutral'}>{s.enabled ? 'Enabled' : 'Disabled'}</Badge>
            </div>
          </div>
          <dl className="mt-3 grid gap-x-6 gap-y-1 text-xs sm:grid-cols-2">
            <div><dt className="inline text-muted">Commercial use: </dt><dd className="inline">{s.commercial_use_approved ? 'approved' : 'not approved'}</dd></div>
            <div><dt className="inline text-muted">Redistribution: </dt><dd className="inline">{s.redistribution_approved ? 'approved' : 'not approved'}</dd></div>
            <div><dt className="inline text-muted">Approval ref: </dt><dd className="inline">{s.approval_reference || '—'}</dd></div>
            <div><dt className="inline text-muted">Approved: </dt><dd className="inline">{fmtDate(s.approval_date)}</dd></div>
            <div><dt className="inline text-muted">Retention: </dt><dd className="inline">{s.retention_days} days</dd></div>
            <div><dt className="inline text-muted">Attribution: </dt><dd className="inline">{s.attribution_text || '—'}</dd></div>
          </dl>
          {s.notes && <p className="mt-2 text-xs text-muted">{s.notes}</p>}
          {s.provider_kind !== 'synthetic_demo' && <Button size="sm" variant="secondary" className="mt-3" onClick={() => setEditing(editing === s.id ? null : s.id)}>{editing === s.id ? 'Close review' : 'Compliance review'}</Button>}
          {editing === s.id && <SourceReview s={s} onDone={() => qc.invalidateQueries({ queryKey: ['admin'] })} />}
        </Card>
      ))}
    </div>
  );
}

function NewSource({ onDone }: { onDone: () => void }) {
  const [f, setF] = useState({ name: '', homepageUrl: '', apiIdentifier: '', dataType: '' });
  const m = useMutation({ mutationFn: () => api('/api/admin/sources', { method: 'POST', body: f }), onSuccess: onDone });
  return (
    <Card>
      <form className="grid gap-3 sm:grid-cols-2" onSubmit={(e) => { e.preventDefault(); m.mutate(); }}>
        <Field label="Source name">{(id) => <Input id={id} value={f.name} onChange={(e) => setF({ ...f, name: e.target.value })} />}</Field>
        <Field label="Homepage URL">{(id) => <Input id={id} value={f.homepageUrl} onChange={(e) => setF({ ...f, homepageUrl: e.target.value })} placeholder="https://" />}</Field>
        <Field label="Identifier" hint="lowercase, e.g. partner_board">{(id, d) => <Input id={id} aria-describedby={d} value={f.apiIdentifier} onChange={(e) => setF({ ...f, apiIdentifier: e.target.value })} />}</Field>
        <Field label="Data type">{(id) => <Input id={id} value={f.dataType} onChange={(e) => setF({ ...f, dataType: e.target.value })} placeholder="e.g. Partner job summaries" />}</Field>
        {m.isError && <Alert tone="error" className="sm:col-span-2">{errorMessage(m.error)}</Alert>}
        <div className="sm:col-span-2"><Button type="submit" loading={m.isPending}>Create (starts disabled, draft)</Button></div>
      </form>
    </Card>
  );
}

function SourceReview({ s, onDone }: { s: Row; onDone: () => void }) {
  const [f, setF] = useState({
    allowedUsage: s.allowed_usage, approvedScope: s.approved_scope, attributionText: s.attribution_text, approvalReference: s.approval_reference,
    licenseEvidenceUrl: s.license_evidence_url, retentionDays: s.retention_days, commercialUseApproved: s.commercial_use_approved,
    redistributionApproved: s.redistribution_approved, digestAllowed: s.digest_allowed,
  });
  const [cl, setCl] = useState<Record<string, boolean>>({ ...Object.fromEntries(CHECKLIST.map(([k]) => [k, false])), ...(s.compliance_checklist ?? {}) });
  const m = useMutation({ mutationFn: (extra: Row) => api('/api/admin/sources/' + s.id, { method: 'PATCH', body: { ...f, licenseEvidenceUrl: f.licenseEvidenceUrl || '', complianceChecklist: cl, ...extra } }), onSuccess: onDone });
  return (
    <div className="mt-4 space-y-4 border-t border-line pt-4">
      <div className="grid gap-3 sm:grid-cols-2">
        <Field label="Allowed usage (from contract)">{(id) => <Textarea id={id} value={f.allowedUsage} onChange={(e) => setF({ ...f, allowedUsage: e.target.value })} />}</Field>
        <Field label="Approved scope / access">{(id) => <Textarea id={id} value={f.approvedScope} onChange={(e) => setF({ ...f, approvedScope: e.target.value })} />}</Field>
        <Field label="Attribution text shown to users">{(id) => <Input id={id} value={f.attributionText} onChange={(e) => setF({ ...f, attributionText: e.target.value })} />}</Field>
        <Field label="Contract / permission reference">{(id) => <Input id={id} value={f.approvalReference} onChange={(e) => setF({ ...f, approvalReference: e.target.value })} />}</Field>
        <Field label="Evidence URL (private document link)">{(id) => <Input id={id} value={f.licenseEvidenceUrl} onChange={(e) => setF({ ...f, licenseEvidenceUrl: e.target.value })} />}</Field>
        <Field label="Retention (days)">{(id) => <Input id={id} type="number" min={1} max={3650} value={f.retentionDays} onChange={(e) => setF({ ...f, retentionDays: Number(e.target.value) })} />}</Field>
      </div>
      <div className="space-y-2">
        <Toggle label="Commercial use approved in writing" checked={f.commercialUseApproved} onChange={(v) => setF({ ...f, commercialUseApproved: v })} />
        <Toggle label="Redistribution to paying subscribers approved in writing" checked={f.redistributionApproved} onChange={(v) => setF({ ...f, redistributionApproved: v })} />
        <Toggle label="Source allows inclusion in email digests" checked={f.digestAllowed} onChange={(v) => setF({ ...f, digestAllowed: v })} />
      </div>
      <fieldset className="space-y-2 rounded-xl bg-page p-4">
        <legend className="text-sm font-semibold">Compliance checklist</legend>
        {CHECKLIST.map(([k, label]) => <Toggle key={k} label={label} checked={Boolean(cl[k])} onChange={(v) => setCl({ ...cl, [k]: v })} />)}
      </fieldset>
      {m.isError && <Alert tone="error">{errorMessage(m.error)}</Alert>}
      {m.isSuccess && <Alert tone="success">Saved.</Alert>}
      <div className="flex flex-wrap gap-2">
        <Button variant="secondary" onClick={() => m.mutate({})} loading={m.isPending}>Save review</Button>
        <Button onClick={() => m.mutate({ licenseStatus: 'approved' })}>Approve licence</Button>
        <Button variant="secondary" disabled={s.license_status !== 'approved'} onClick={() => m.mutate({ enabled: !s.enabled })}>{s.enabled ? 'Disable source' : 'Enable source'}</Button>
        <Button variant="danger" onClick={() => m.mutate({ licenseStatus: 'revoked' })}>Revoke</Button>
      </div>
    </div>
  );
}

function Moderation() {
  const qc = useQueryClient();
  const [status, setStatus] = useState('needs_review');
  const q = useAdmin(`/api/admin/opportunities?status=${status}&pageSize=50`);
  const m = useMutation({
    mutationFn: ({ id, body }: { id: string; body: Row }) => api(`/api/admin/opportunities/${id}`, { method: 'PATCH', body }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['admin'] }),
  });
  return (
    <div className="space-y-3">
      <div className="flex items-center gap-2">
        <label htmlFor="ms" className="text-sm">Status</label>
        <Select id="ms" value={status} onChange={(e) => setStatus(e.target.value)} className="w-48">
          {['needs_review', 'published', 'rejected', 'expired', 'taken_down'].map((s) => <option key={s}>{s}</option>)}
        </Select>
      </div>
      {m.isError && <Alert tone="error">{errorMessage(m.error)}</Alert>}
      {q.isLoading ? <LoadingBlock /> : q.isError ? <ErrorState error={q.error} /> : q.data!.items.length === 0 ? <p className="text-sm text-muted">Queue is empty.</p> : q.data!.items.map((o: Row) => (
        <Card key={o.id}>
          <div className="flex flex-wrap items-start justify-between gap-2">
            <div><p className="text-xs text-muted">{o.company_name} · {o.provider_name} {o.is_demo && <Badge tone="demo">Demo</Badge>}</p><h3 className="font-bold">{o.title}</h3></div>
            <Badge>{o.quality_status}</Badge>
          </div>
          <p className="mt-2 text-sm">{o.original_summary}</p>
          <p className="mt-2 text-xs text-muted">Source: {o.source_url} · Contact: {o.contact_route ?? '—'} · Eligibility: {o.remote_eligibility} · Verified {fmtDateTime(o.last_verified_at)} · Open reports: {o.open_reports}</p>
          <div className="mt-3 flex flex-wrap gap-2">
            {o.quality_status !== 'published' && <Button size="sm" onClick={() => m.mutate({ id: o.id, body: { qualityStatus: 'published', lastVerifiedAt: new Date().toISOString() } })}>Verify & publish</Button>}
            {o.quality_status === 'published' && <Button size="sm" variant="secondary" onClick={() => m.mutate({ id: o.id, body: { lastVerifiedAt: new Date().toISOString() } })}>Mark re-verified</Button>}
            {o.quality_status !== 'rejected' && <Button size="sm" variant="danger" onClick={() => m.mutate({ id: o.id, body: { qualityStatus: 'rejected' } })}>Reject</Button>}
          </div>
        </Card>
      ))}
    </div>
  );
}

const CSV_TEMPLATE = 'company_name,company_site,title,summary,industry,work_arrangement,remote_eligibility,engagement_type,restrictions,hiring_signals,outsourcing_evidence,skills,contact_route,source_url,external_id,posted_at,expires_at\n';

function AddImport() {
  const sources = useAdmin('/api/admin/sources');
  const manual = (sources.data?.items ?? []).filter((s: Row) => s.provider_kind === 'manual');
  const [providerId, setProviderId] = useState('');
  const [lawful, setLawful] = useState(false);
  const [csv, setCsv] = useState(CSV_TEMPLATE);
  const [f, setF] = useState({ companyName: '', companySite: '', title: '', originalSummary: '', industry: 'Other', workArrangement: 'remote', remoteEligibility: 'unknown', engagementType: 'contract', sourceUrl: '', contactRoute: '', signal: '' });
  const [skills, setSkills] = useState<SkillCode[]>(['general_va']);
  const imp = useMutation({ mutationFn: () => api<Row>('/api/admin/import', { method: 'POST', body: { providerId, csv, lawfulBasisConfirmed: lawful } }) });
  const one = useMutation({
    mutationFn: () => api<Row>('/api/admin/opportunities', { method: 'POST', body: {
      providerId, lawfulBasisConfirmed: lawful, companyName: f.companyName, companySite: f.companySite, title: f.title, originalSummary: f.originalSummary,
      industry: f.industry, workArrangement: f.workArrangement, remoteEligibility: f.remoteEligibility, engagementType: f.engagementType,
      sourceUrl: f.sourceUrl, contactRoute: f.contactRoute, skills, hiringSignals: f.signal ? [{ type: 'active_posting', note: f.signal }] : [],
    } }),
  });
  const result = (imp.data ?? one.data) as Row | undefined;
  return (
    <div className="space-y-4">
      <Card className="space-y-3">
        <Field label="Manual source" hint="Only approved & enabled sources accept records; others are blocked and logged.">{(id, d) => (
          <Select id={id} aria-describedby={d} value={providerId} onChange={(e) => setProviderId(e.target.value)}>
            <option value="">Choose a source…</option>
            {manual.map((s: Row) => <option key={s.id} value={s.id}>{s.name} ({s.license_status}{s.enabled ? ', enabled' : ', disabled'})</option>)}
          </Select>
        )}</Field>
        <Toggle label="I confirm these records come from this source, within its licence, with a lawful basis, and contain no personal data." checked={lawful} onChange={setLawful} />
      </Card>
      {result && (
        <Alert tone={result.status === 'succeeded' ? 'success' : result.status === 'partial' ? 'warn' : 'error'} title={`Run ${result.status}`}>
          Fetched {result.fetched} · accepted {result.accepted} · duplicates {result.duplicates} · rejected {result.rejected}{result.error && ` · ${result.error}`}
          {result.rejections?.length > 0 && <ul className="mt-2 list-disc pl-5 text-xs">{result.rejections.slice(0, 10).map((r: Row) => <li key={r.index}>Row {r.index + 1}: {r.reasons.join('; ')}</li>)}</ul>}
        </Alert>
      )}
      {(imp.isError || one.isError) && <Alert tone="error">{errorMessage(imp.error ?? one.error)}</Alert>}
      <div className="grid gap-4 lg:grid-cols-2">
        <Card className="space-y-3">
          <h2 className="font-bold">Add one opportunity</h2>
          <Field label="Company name">{(id) => <Input id={id} value={f.companyName} onChange={(e) => setF({ ...f, companyName: e.target.value })} />}</Field>
          <Field label="Role / business need">{(id) => <Input id={id} value={f.title} onChange={(e) => setF({ ...f, title: e.target.value })} />}</Field>
          <Field label="Original summary (your own words)">{(id) => <Textarea id={id} value={f.originalSummary} onChange={(e) => setF({ ...f, originalSummary: e.target.value })} />}</Field>
          <Field label="Hiring signal note">{(id) => <Input id={id} value={f.signal} onChange={(e) => setF({ ...f, signal: e.target.value })} placeholder="e.g. Posted on partner board on Oct 28" />}</Field>
          <div className="grid gap-3 sm:grid-cols-2">
            <Field label="Industry">{(id) => <Select id={id} value={f.industry} onChange={(e) => setF({ ...f, industry: e.target.value })}>{INDUSTRIES.map((i) => <option key={i}>{i}</option>)}</Select>}</Field>
            <Field label="Arrangement">{(id) => <Select id={id} value={f.workArrangement} onChange={(e) => setF({ ...f, workArrangement: e.target.value })}>{['remote', 'hybrid', 'onsite', 'unknown'].map((i) => <option key={i}>{i}</option>)}</Select>}</Field>
            <Field label="Eligibility (as stated)">{(id) => <Select id={id} value={f.remoteEligibility} onChange={(e) => setF({ ...f, remoteEligibility: e.target.value })}>{['worldwide', 'philippines_ok', 'unknown', 'us_only', 'other_restricted'].map((i) => <option key={i}>{i}</option>)}</Select>}</Field>
            <Field label="Engagement">{(id) => <Select id={id} value={f.engagementType} onChange={(e) => setF({ ...f, engagementType: e.target.value })}>{['contract', 'freelance', 'part_time', 'full_time', 'unknown'].map((i) => <option key={i}>{i}</option>)}</Select>}</Field>
          </div>
          <ChipGroup<SkillCode> legend="Skills" options={SKILLS.map((s) => ({ value: s.code, label: s.label }))} value={skills} onChange={setSkills} />
          <Field label="Source URL">{(id) => <Input id={id} value={f.sourceUrl} onChange={(e) => setF({ ...f, sourceUrl: e.target.value })} placeholder="https://" />}</Field>
          <Field label="Company website (optional)">{(id) => <Input id={id} value={f.companySite} onChange={(e) => setF({ ...f, companySite: e.target.value })} />}</Field>
          <Field label="Business contact route (URL or generic mailbox)">{(id) => <Input id={id} value={f.contactRoute} onChange={(e) => setF({ ...f, contactRoute: e.target.value })} placeholder="https://…/careers or careers@company.com" />}</Field>
          <Button disabled={!providerId || !lawful} loading={one.isPending} onClick={() => one.mutate()}>Add to moderation queue</Button>
        </Card>
        <Card className="space-y-3">
          <h2 className="font-bold">CSV import</h2>
          <p className="text-xs text-muted">Lists use ";" (e.g. skills: ghl_crm;automation). Hiring signals: type:note;type:note. Max 1,000 rows. Imported rows go to moderation.</p>
          <label htmlFor="csv" className="sr-only">CSV data</label>
          <Textarea id="csv" value={csv} onChange={(e) => setCsv(e.target.value)} className="min-h-[300px] font-mono text-xs" />
          <input type="file" accept=".csv,text/csv" aria-label="Upload CSV file" className="text-sm" onChange={async (e) => { const file = e.target.files?.[0]; if (file) setCsv(await file.text()); }} />
          <Button disabled={!providerId || !lawful} loading={imp.isPending} onClick={() => imp.mutate()}>Import CSV</Button>
        </Card>
      </div>
    </div>
  );
}

function Ingestion() {
  const qc = useQueryClient();
  const sources = useAdmin('/api/admin/sources');
  const run = useMutation({ mutationFn: (providerId: string) => api<Row>('/api/admin/ingestion/run', { method: 'POST', body: { providerId } }), onSuccess: () => qc.invalidateQueries({ queryKey: ['admin'] }) });
  const maint = useMutation({ mutationFn: () => api<Row>('/api/admin/maintenance/run', { method: 'POST' }) });
  return (
    <div className="space-y-4">
      <Card className="flex flex-wrap gap-2">
        {(sources.data?.items ?? []).filter((s: Row) => s.provider_kind !== 'manual').map((s: Row) => <Button key={s.id} variant="secondary" size="sm" loading={run.isPending && run.variables === s.id} onClick={() => run.mutate(s.id)}>Run {s.name}</Button>)}
        <Button variant="secondary" size="sm" loading={maint.isPending} onClick={() => maint.mutate()}>Run expiry & retention</Button>
      </Card>
      {run.data && <Alert tone={run.data.status === 'blocked' || run.data.status === 'failed' ? 'error' : 'success'} title={`Run ${run.data.status}`}>{run.data.error ?? `accepted ${run.data.accepted}, duplicates ${run.data.duplicates}, rejected ${run.data.rejected}`}</Alert>}
      {maint.data && <Alert tone="success">Expired {maint.data.expired}, purged {maint.data.purged} records past retention.</Alert>}
      <SimpleTable path="/api/admin/ingestion-runs" cols={[['started_at', 'Started'], ['provider_name', 'Source'], ['triggered_by', 'Trigger'], ['status', 'Status'], ['fetched_count', 'Fetched'], ['accepted_count', 'Accepted'], ['duplicate_count', 'Dupes'], ['rejected_count', 'Rejected'], ['error_message', 'Error']]} />
    </div>
  );
}

function Reports() {
  const qc = useQueryClient();
  const q = useAdmin('/api/admin/feedback?status=open');
  const m = useMutation({ mutationFn: ({ id, body }: { id: string; body: Row }) => api(`/api/admin/feedback/${id}`, { method: 'PATCH', body }), onSuccess: () => qc.invalidateQueries({ queryKey: ['admin'] }) });
  if (q.isLoading) return <LoadingBlock />;
  if (q.isError) return <ErrorState error={q.error} />;
  return <Table cols={[['created_at', 'When'], ['reason', 'Reason'], ['company_name', 'Company'], ['title', 'Opportunity'], ['details', 'Details'], ['quality_status', 'Status']]} rows={q.data!.items} actions={(r) => (
    <div className="flex gap-1">
      <Button size="sm" variant="danger" onClick={() => m.mutate({ id: r.id, body: { status: 'resolved', takeDown: true, resolutionNote: 'Taken down' } })}>Take down</Button>
      <Button size="sm" variant="secondary" onClick={() => m.mutate({ id: r.id, body: { status: 'resolved' } })}>Resolve</Button>
      <Button size="sm" variant="ghost" onClick={() => m.mutate({ id: r.id, body: { status: 'dismissed' } })}>Dismiss</Button>
    </div>
  )} />;
}

function Privacy() {
  const qc = useQueryClient();
  const q = useAdmin('/api/admin/data-requests');
  const m = useMutation({ mutationFn: (id: string) => api(`/api/admin/data-requests/${id}/complete`, { method: 'POST' }), onSuccess: () => qc.invalidateQueries({ queryKey: ['admin'] }) });
  if (q.isLoading) return <LoadingBlock />;
  if (q.isError) return <ErrorState error={q.error} />;
  return (
    <>
      {m.isError && <Alert tone="error" className="mb-3">{errorMessage(m.error)}</Alert>}
      <Table cols={[['created_at', 'Requested'], ['kind', 'Type'], ['email', 'User'], ['status', 'Status'], ['completed_at', 'Completed']]} rows={q.data!.items} actions={(r) => r.status === 'pending' && r.kind === 'delete' ? (
        <Button size="sm" variant="danger" loading={m.isPending} onClick={() => { if (confirm('Permanently delete this user and cancel their subscription?')) m.mutate(r.id); }}>Delete account</Button>
      ) : null} />
    </>
  );
}

function SettingsTab() {
  const qc = useQueryClient();
  const q = useAdmin('/api/admin/settings');
  const set = useMutation({ mutationFn: (body: Row) => api('/api/admin/settings', { method: 'PATCH', body }), onSuccess: () => qc.invalidateQueries() });
  const plan = useMutation({ mutationFn: ({ code, body }: { code: string; body: Row }) => api(`/api/admin/plans/${code}`, { method: 'PATCH', body }), onSuccess: () => qc.invalidateQueries({ queryKey: ['admin'] }) });
  if (q.isLoading) return <LoadingBlock />;
  if (q.isError) return <ErrorState error={q.error} />;
  const { settings: s, plans, integrations: i } = q.data!;
  return (
    <div className="space-y-6">
      <Card className="space-y-3">
        <h2 className="font-bold">Integrations</h2>
        <ul className="space-y-1 text-sm">
          <li>Environment: <Badge>{i.environment}</Badge></li>
          <li>Auth: <Badge tone={i.auth.mode === 'supabase' ? 'teal' : 'warn'}>{i.auth.mode}</Badge></li>
          <li>Billing: <Badge tone={i.billing.mode === 'live' ? 'teal' : 'warn'}>{i.billing.mode}</Badge></li>
          <li>Email: <Badge tone={i.email.provider === 'resend' && i.email.configured ? 'teal' : 'warn'}>{i.email.provider}{i.email.configured ? '' : ' (not configured)'}</Badge></li>
          <li>Licensed data provider: <Badge tone="warn">{i.licensedProvider.enabledFlag && i.licensedProvider.credentialsPresent ? 'configured' : 'not configured'}</Badge></li>
        </ul>
      </Card>
      <Card className="space-y-3">
        <h2 className="font-bold">Feature flags</h2>
        {set.isError && <Alert tone="error">{errorMessage(set.error)}</Alert>}
        <Toggle label="Demo mode (serve fictional demo opportunities)" checked={s.demo_mode_enabled} onChange={(v) => set.mutate({ demoModeEnabled: v })} />
        <Toggle label="Checkout enabled (PayMongo test/live)" hint="Mock mode in development is always available." checked={s.checkout_enabled} onChange={(v) => set.mutate({ checkoutEnabled: v })} />
        <Toggle label="Founding Beta plan visible" checked={s.founding_member_enabled} onChange={(v) => set.mutate({ foundingMemberEnabled: v })} />
        <div className="grid gap-3 sm:grid-cols-3">
          <NumberSetting label="Founding member cap" value={s.founding_member_cap} onSave={(v) => set.mutate({ foundingMemberCap: v })} />
          <NumberSetting label="Founding promo months" value={s.founding_promo_months} onSave={(v) => set.mutate({ foundingPromoMonths: v })} />
          <NumberSetting label="Failed-payment grace days" value={s.grace_days} onSave={(v) => set.mutate({ graceDays: v })} />
        </div>
      </Card>
      <Card className="space-y-3">
        <h2 className="font-bold">Plan quotas</h2>
        <p className="text-xs text-muted">Prices are set in PayMongo plans; adjust quotas after your cost test.</p>
        {plans.map((p: Row) => (
          <div key={p.code} className="flex flex-wrap items-end gap-3 border-t border-line pt-3">
            <p className="w-40 font-medium">{p.name} <span className="text-xs text-muted">{php(p.php_amount)}</span></p>
            <NumberSetting label="Monthly unlocks" value={p.monthly_unlock_limit} onSave={(v) => plan.mutate({ code: p.code, body: { monthlyUnlockLimit: v } })} />
            <Toggle label="CSV export" checked={p.export_permission} onChange={(v) => plan.mutate({ code: p.code, body: { exportPermission: v } })} />
          </div>
        ))}
      </Card>
    </div>
  );
}

function NumberSetting({ label, value, onSave }: { label: string; value: number; onSave: (v: number) => void }) {
  const [v, setV] = useState(String(value));
  return (
    <Field label={label}>{(id) => (
      <div className="flex gap-2">
        <Input id={id} type="number" min={0} value={v} onChange={(e) => setV(e.target.value)} className="w-28" />
        <Button size="sm" variant="secondary" onClick={() => onSave(Number(v))} disabled={String(value) === v}>Save</Button>
      </div>
    )}</Field>
  );
}
