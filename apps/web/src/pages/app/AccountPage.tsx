import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useEffect, useState, type FormEvent } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import {
  ALERT_FREQUENCIES, INDUSTRIES, SKILLS, WORK_TYPE_LABELS, WORK_TYPES,
  type AlertFrequency, type PlanDto, type Preferences, type SkillCode, type SubscriptionResponse, type WorkType,
} from '@vlf/shared';
import { Alert, Badge, Button, Card, ChipGroup, Field, Input, LoadingBlock, PageHeader, Select, Toggle } from '../../components/ui';
import { useMe, useUsage } from '../../hooks/queries';
import { api, downloadFile, errorMessage } from '../../lib/api';
import { fmtDate, php } from '../../lib/format';
import { planFeatures } from '../marketing/PricingPage';

export function AccountPage() {
  const me = useMe();
  if (me.isLoading || !me.data) return <LoadingBlock />;
  return (
    <>
      <PageHeader title="Account" description={me.data.user.email ?? undefined} />
      <div className="space-y-6">
        <ProfileCard />
        <PreferencesCard />
        <BillingCard />
        <DataCard />
        <Card as="section">
          <h2 className="text-lg font-bold">Support</h2>
          <p className="mt-1 text-sm">Questions, billing issues or source concerns: <a href="mailto:support@example.com">support@example.com</a> (placeholder address).</p>
        </Card>
      </div>
    </>
  );
}

function ProfileCard() {
  const me = useMe();
  const qc = useQueryClient();
  const p = me.data!.profile;
  const [name, setName] = useState(p?.displayName ?? '');
  const [tz, setTz] = useState(p?.timezone ?? 'Asia/Manila');
  const save = useMutation({
    mutationFn: () => api('/api/profile', { method: 'PATCH', body: { displayName: name.trim(), country: p?.country ?? 'PH', timezone: tz } }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['me'] }),
  });
  return (
    <Card as="section">
      <h2 className="text-lg font-bold">Profile</h2>
      <form className="mt-4 grid gap-4 sm:grid-cols-2" onSubmit={(e) => { e.preventDefault(); save.mutate(); }}>
        <Field label="Name">{(id) => <Input id={id} value={name} maxLength={80} onChange={(e) => setName(e.target.value)} />}</Field>
        <Field label="Time zone">{(id) => (
          <Select id={id} value={tz} onChange={(e) => setTz(e.target.value)}>{['Asia/Manila', 'Asia/Singapore', 'Asia/Tokyo', 'UTC'].map((t) => <option key={t}>{t}</option>)}</Select>
        )}</Field>
        <div className="sm:col-span-2 flex items-center gap-3">
          <Button type="submit" loading={save.isPending} disabled={!name.trim()}>Save profile</Button>
          {save.isSuccess && <span className="text-sm text-teal-700" role="status">Saved</span>}
          {save.isError && <span className="text-sm text-danger" role="alert">{errorMessage(save.error)}</span>}
        </div>
      </form>
    </Card>
  );
}

function PreferencesCard() {
  const me = useMe();
  const qc = useQueryClient();
  const [prefs, setPrefs] = useState<Preferences | null>(me.data!.preferences);
  useEffect(() => setPrefs(me.data!.preferences), [me.data]);
  const save = useMutation({
    mutationFn: (p: Preferences) => api('/api/preferences', { method: 'PATCH', body: p }),
    onSuccess: () => { qc.invalidateQueries({ queryKey: ['me'] }); qc.invalidateQueries({ queryKey: ['opportunities'] }); qc.invalidateQueries({ queryKey: ['dashboard'] }); },
  });
  if (!prefs) return null;
  const set = <K extends keyof Preferences>(k: K, v: Preferences[K]) => setPrefs({ ...prefs, [k]: v });
  return (
    <Card as="section">
      <h2 className="text-lg font-bold">Matching preferences</h2>
      <form className="mt-4 space-y-5" onSubmit={(e: FormEvent) => { e.preventDefault(); save.mutate(prefs); }}>
        <ChipGroup<SkillCode> legend="Skills" options={SKILLS.map((s) => ({ value: s.code, label: s.label }))} value={prefs.skills} onChange={(v) => set('skills', v)} />
        <ChipGroup<WorkType> legend="Work types" options={WORK_TYPES.map((w) => ({ value: w, label: WORK_TYPE_LABELS[w] }))} value={prefs.workTypes} onChange={(v) => set('workTypes', v)} />
        <ChipGroup legend="Industries to exclude" options={INDUSTRIES.map((i) => ({ value: i, label: i }))} value={prefs.excludedIndustries} onChange={(v) => set('excludedIndustries', v as Preferences['excludedIndustries'])} />
        <Toggle label="Only show remote work" checked={prefs.requireRemote} onChange={(v) => set('requireRemote', v)} />
        <Toggle label="Hide roles that exclude Philippines-based contractors" checked={prefs.excludeRegionRestricted} onChange={(v) => set('excludeRegionRestricted', v)} />
        <Field label="Email digest" hint="Digests include only new, eligible opportunities. Daily digests require Pro; your plan's limit applies.">{(id, d) => (
          <Select id={id} aria-describedby={d} value={prefs.alertFrequency} onChange={(e) => set('alertFrequency', e.target.value as AlertFrequency)} className="sm:w-60">
            {ALERT_FREQUENCIES.map((f) => <option key={f} value={f}>{f[0]!.toUpperCase() + f.slice(1)}</option>)}
          </Select>
        )}</Field>
        <div className="flex items-center gap-3">
          <Button type="submit" loading={save.isPending} disabled={prefs.skills.length === 0 || prefs.workTypes.length === 0}>Save preferences</Button>
          {save.isSuccess && <span className="text-sm text-teal-700" role="status">Saved — scores updated</span>}
          {save.isError && <span className="text-sm text-danger" role="alert">{errorMessage(save.error)}</span>}
        </div>
      </form>
    </Card>
  );
}

const STATUS_COPY: Record<string, string> = {
  incomplete: 'Waiting for your first payment', incomplete_cancelled: 'Checkout expired', active: 'Active', past_due: 'Payment failed — retrying',
  unpaid: 'Unpaid — paid features paused', cancelled: 'Cancelled',
};

function BillingCard() {
  const usage = useUsage();
  const qc = useQueryClient();
  const nav = useNavigate();
  const [params] = useSearchParams();
  const sub = useQuery({ queryKey: ['subscription'], queryFn: () => api<SubscriptionResponse>('/api/subscription'), refetchInterval: (q) => (q.state.data?.subscription?.status === 'incomplete' ? 4000 : false) });
  const plans = useQuery({ queryKey: ['plans'], queryFn: () => api<{ plans: PlanDto[] }>('/api/plans') });
  const [pendingCard, setPendingCard] = useState(false);
  const checkout = useMutation({
    mutationFn: (planCode: string) => api<{ nextAction: { type: string; url?: string } }>('/api/billing/checkout', { method: 'POST', body: { planCode } }),
    onSuccess: (r) => {
      qc.invalidateQueries({ queryKey: ['subscription'] });
      if (r.nextAction.type === 'mock_checkout' && r.nextAction.url) nav(r.nextAction.url);
      if (r.nextAction.type === 'collect_payment_method') setPendingCard(true);
    },
  });
  const cancel = useMutation({
    mutationFn: () => api<{ message: string }>('/api/billing/cancel', { method: 'POST', body: { reason: 'other' } }),
    onSuccess: () => { qc.invalidateQueries({ queryKey: ['subscription'] }); qc.invalidateQueries({ queryKey: ['usage'] }); },
  });
  const change = useMutation({ mutationFn: (planCode: string) => api<{ message: string }>('/api/billing/change-plan', { method: 'POST', body: { planCode } }) });
  const s = sub.data?.subscription;
  const open = s && ['active', 'past_due', 'unpaid', 'incomplete'].includes(s.status);
  const u = usage.data;

  return (
    <Card as="section">
      <h2 id="billing" className="text-lg font-bold">Plan, usage & billing</h2>
      {params.get('billing') === 'return' && <Alert tone="info" className="mt-3">We're confirming your payment with PayMongo. Your plan updates automatically once the payment is confirmed — this can take a minute.</Alert>}
      {u && (
        <div className="mt-4 grid gap-3 sm:grid-cols-3">
          <div className="rounded-xl bg-page p-4"><p className="text-xs text-muted">Current plan</p><p className="font-display text-lg font-bold">{u.planName}</p></div>
          <div className="rounded-xl bg-page p-4">
            <p className="text-xs text-muted">Unlocks this month</p>
            <p className="font-display text-lg font-bold">{u.unlocksUsed} / {u.unlockLimit}</p>
            <div className="mt-1 h-1.5 rounded-full bg-line" role="progressbar" aria-label="Unlocks used" aria-valuemin={0} aria-valuemax={u.unlockLimit} aria-valuenow={u.unlocksUsed}><div className="h-1.5 rounded-full bg-teal-500" style={{ width: `${Math.min(100, (u.unlocksUsed / Math.max(1, u.unlockLimit)) * 100)}%` }} /></div>
          </div>
          <div className="rounded-xl bg-page p-4"><p className="text-xs text-muted">Allowance resets</p><p className="font-display text-lg font-bold">{fmtDate(u.resetsAt)}</p></div>
        </div>
      )}
      {sub.data && <Alert tone={sub.data.billing.mode === 'live' ? 'info' : 'warn'} className="mt-4">{sub.data.billing.message}</Alert>}
      {s && (
        <div className="mt-4 rounded-xl border border-line p-4 text-sm">
          <p>Subscription: <strong>{s.planCode}</strong> · <Badge tone={s.status === 'active' ? 'teal' : s.status === 'cancelled' ? 'neutral' : 'warn'}>{STATUS_COPY[s.status] ?? s.status}</Badge></p>
          {s.currentPeriodEnd && <p className="mt-1 text-muted">{s.status === 'cancelled' ? `Paid access until ${fmtDate(s.currentPeriodEnd)}. You will not be charged again.` : `Renews on ${fmtDate(s.currentPeriodEnd)}.`}</p>}
          {s.status === 'past_due' && <p className="mt-1 text-warn">Your last payment failed. PayMongo retries automatically. Paid features stay on for a {sub.data!.graceDays}-day grace period.</p>}
        </div>
      )}
      {pendingCard && <CardPaymentForm onDone={() => { setPendingCard(false); qc.invalidateQueries({ queryKey: ['subscription'] }); }} />}
      {checkout.isError && <Alert tone="error" className="mt-4">{errorMessage(checkout.error)}</Alert>}
      {cancel.data && <Alert tone="success" className="mt-4">{cancel.data.message}</Alert>}
      {change.data && <Alert tone="success" className="mt-4">{change.data.message}</Alert>}
      {change.isError && <Alert tone="error" className="mt-4">{errorMessage(change.error)}</Alert>}

      <div className="mt-6 grid gap-3 md:grid-cols-3">
        {plans.data?.plans.filter((p) => p.code !== 'free').map((p) => {
          const current = u?.planCode === p.code && s?.status === 'active';
          return (
            <div key={p.code} className="flex flex-col rounded-xl border border-line p-4">
              <p className="font-semibold text-navy-900">{p.name}</p>
              <p className="font-display text-xl font-extrabold">{php(p.phpAmount)}<span className="text-sm font-normal text-muted"> / month</span></p>
              <ul className="mt-2 flex-1 space-y-1 text-xs text-muted">{planFeatures(p).map((f) => <li key={f}>• {f}</li>)}</ul>
              {current ? <Badge tone="teal" className="mt-3 self-start">Current plan</Badge>
                : s?.status === 'active' ? <Button variant="secondary" size="sm" className="mt-3" disabled={p.code === 'founding'} onClick={() => change.mutate(p.code)} loading={change.isPending}>Change at next cycle</Button>
                : <Button size="sm" className="mt-3" disabled={!sub.data?.billing.checkoutEnabled || !p.available} onClick={() => checkout.mutate(p.code)} loading={checkout.isPending && checkout.variables === p.code}>{sub.data?.billing.checkoutEnabled ? `Subscribe to ${p.name}` : 'Not available yet'}</Button>}
            </div>
          );
        })}
      </div>
      {open && s?.status !== 'incomplete' && (
        <div className="mt-6 border-t border-line pt-4">
          <p className="text-sm text-muted">Cancelling stops future charges immediately. You keep paid features until the end of the period you've paid for.</p>
          <Button variant="danger" className="mt-2" loading={cancel.isPending} onClick={() => { if (confirm('Cancel your subscription? You will not be charged again.')) cancel.mutate(); }}>Cancel subscription</Button>
        </div>
      )}
    </Card>
  );
}

/**
 * PayMongo test/live card step. Card details go from the browser DIRECTLY to PayMongo using the
 * public key; our server only receives the resulting payment_method id. Requires VITE_PAYMONGO_PUBLIC_KEY.
 */
function CardPaymentForm({ onDone }: { onDone: () => void }) {
  const pk = import.meta.env.VITE_PAYMONGO_PUBLIC_KEY as string | undefined;
  const [f, setF] = useState({ number: '', month: '', year: '', cvc: '', name: '' });
  const [err, setErr] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  if (!pk) return <Alert tone="error" className="mt-4">Card payments are not configured (missing PayMongo public key).</Alert>;
  const submit = async (e: FormEvent) => {
    e.preventDefault();
    setBusy(true);
    setErr(null);
    try {
      const res = await fetch('https://api.paymongo.com/v1/payment_methods', {
        method: 'POST',
        headers: { Authorization: 'Basic ' + btoa(`${pk}:`), 'Content-Type': 'application/json' },
        body: JSON.stringify({ data: { attributes: { type: 'card', details: { card_number: f.number.replace(/\s/g, ''), exp_month: Number(f.month), exp_year: Number(f.year), cvc: f.cvc }, billing: { name: f.name } } } }),
      });
      const j = (await res.json()) as { data?: { id: string }; errors?: { detail: string }[] };
      if (!res.ok || !j.data) throw new Error(j.errors?.[0]?.detail ?? 'Card was not accepted.');
      const r = await api<{ status: string; redirectUrl: string | null }>('/api/billing/attach', { method: 'POST', body: { paymentMethodId: j.data.id } });
      if (r.redirectUrl && /^https:\/\//.test(r.redirectUrl)) location.assign(r.redirectUrl);
      else onDone();
    } catch (e2) {
      setErr(errorMessage(e2));
    } finally {
      setBusy(false);
    }
  };
  return (
    <form onSubmit={submit} className="mt-4 space-y-3 rounded-xl border border-line p-4" autoComplete="on">
      <p className="text-sm font-semibold">Card details <span className="font-normal text-muted">(sent securely to PayMongo — never stored by VA LeadFinder)</span></p>
      {err && <Alert tone="error">{err}</Alert>}
      <Field label="Name on card">{(id) => <Input id={id} autoComplete="cc-name" value={f.name} onChange={(e) => setF({ ...f, name: e.target.value })} />}</Field>
      <Field label="Card number">{(id) => <Input id={id} inputMode="numeric" autoComplete="cc-number" value={f.number} onChange={(e) => setF({ ...f, number: e.target.value })} />}</Field>
      <div className="grid grid-cols-3 gap-3">
        <Field label="MM">{(id) => <Input id={id} inputMode="numeric" autoComplete="cc-exp-month" maxLength={2} value={f.month} onChange={(e) => setF({ ...f, month: e.target.value })} />}</Field>
        <Field label="YY">{(id) => <Input id={id} inputMode="numeric" autoComplete="cc-exp-year" maxLength={2} value={f.year} onChange={(e) => setF({ ...f, year: e.target.value })} />}</Field>
        <Field label="CVC">{(id) => <Input id={id} inputMode="numeric" autoComplete="cc-csc" maxLength={4} value={f.cvc} onChange={(e) => setF({ ...f, cvc: e.target.value })} />}</Field>
      </div>
      <Button type="submit" loading={busy}>Pay and subscribe</Button>
    </form>
  );
}

function DataCard() {
  const [msg, setMsg] = useState<string | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const reqs = useQuery({ queryKey: ['data-requests'], queryFn: () => api<{ items: { id: string; kind: string; status: string; created_at: string }[] }>('/api/account/requests') });
  const del = useMutation({
    mutationFn: () => api<{ message: string }>('/api/account/delete-request', { method: 'POST' }),
    onSuccess: (r) => { setMsg(r.message); reqs.refetch(); },
    onError: (e) => setErr(errorMessage(e)),
  });
  return (
    <Card as="section">
      <h2 className="text-lg font-bold">Your data</h2>
      <p className="mt-1 text-sm text-muted">Download everything we store about your account, or ask us to delete it.</p>
      <div className="mt-4 flex flex-wrap gap-2">
        <Button variant="secondary" onClick={() => downloadFile('/api/account/export-request', 'va-leadfinder-my-data.json', 'POST').then(() => reqs.refetch()).catch((e) => setErr(errorMessage(e)))}>Download my data (JSON)</Button>
        <Button variant="danger" loading={del.isPending} onClick={() => { if (confirm('Request permanent deletion of your account and data? Any subscription will be cancelled.')) del.mutate(); }}>Request account deletion</Button>
      </div>
      {msg && <Alert tone="success" className="mt-4">{msg}</Alert>}
      {err && <Alert tone="error" className="mt-4">{err}</Alert>}
      {reqs.data && reqs.data.items.length > 0 && (
        <ul className="mt-4 space-y-1 text-sm text-muted">
          {reqs.data.items.map((r) => <li key={r.id}>{r.kind === 'delete' ? 'Deletion' : 'Export'} request · {fmtDate(r.created_at)} · {r.status}</li>)}
        </ul>
      )}
    </Card>
  );
}
