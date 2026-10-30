import { useQueryClient } from '@tanstack/react-query';
import { useEffect, useRef, useState } from 'react';
import { Navigate, useNavigate } from 'react-router-dom';
import {
  ALERT_FREQUENCIES, INDUSTRIES, SKILLS, US_TIMEZONES, WORK_TYPE_LABELS, WORK_TYPES, onboardingSchema,
  type AlertFrequency, type Preferences, type SkillCode, type WorkType,
} from '@vlf/shared';
import { Logo } from '../../components/Logo';
import { Alert, Button, Card, ChipGroup, Field, Input, LoadingBlock, Select, Textarea, Toggle } from '../../components/ui';
import { useMe } from '../../hooks/queries';
import { api, errorMessage } from '../../lib/api';
import { useAuth } from '../../lib/auth';

const STEPS = ['About you', 'Your skills', 'Markets', 'Preferences'];
const TIMEZONES = ['Asia/Manila', 'Asia/Singapore', 'Asia/Tokyo', 'UTC'];

export function OnboardingPage() {
  const { user, ready } = useAuth();
  const me = useMe();
  const nav = useNavigate();
  const qc = useQueryClient();
  const heading = useRef<HTMLHeadingElement>(null);
  const [step, setStep] = useState(0);
  const [err, setErr] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [name, setName] = useState('');
  const [country, setCountry] = useState('PH');
  const [timezone, setTimezone] = useState('Asia/Manila');
  const [prefs, setPrefs] = useState<Preferences>({
    skills: [], otherSkill: '', industries: [], excludedIndustries: [], markets: ['US'], usTimezones: [],
    workTypes: ['part_time', 'contract'], requireRemote: true, excludeRegionRestricted: true, responsibilities: '', alertFrequency: 'weekly',
  });

  useEffect(() => {
    if (me.data?.profile?.displayName) setName((n) => n || me.data!.profile!.displayName);
    if (me.data?.preferences) setPrefs(me.data.preferences);
  }, [me.data]);
  // Move focus to the step heading (screen-reader context) once it exists and on every step change.
  useEffect(() => heading.current?.focus(), [step, me.isLoading, ready]);

  if (ready && !user) return <Navigate to="/login" replace />;
  if (me.isLoading || !ready) return <div className="p-8"><LoadingBlock /></div>;

  const set = <K extends keyof Preferences>(k: K, v: Preferences[K]) => setPrefs((p) => ({ ...p, [k]: v }));

  const validateStep = (): string | null => {
    if (step === 0 && !name.trim()) return 'Please enter your name.';
    if (step === 1 && prefs.skills.length === 0) return 'Choose at least one skill.';
    if (step === 3 && prefs.workTypes.length === 0) return 'Choose at least one work type.';
    return null;
  };

  const next = async () => {
    const v = validateStep();
    if (v) return setErr(v);
    setErr(null);
    if (step < 3) return setStep(step + 1);
    const body = onboardingSchema.safeParse({ profile: { displayName: name.trim(), country, timezone }, preferences: prefs });
    if (!body.success) return setErr(body.error.issues[0]?.message ?? 'Please check your answers.');
    setBusy(true);
    try {
      await api('/api/onboarding', { method: 'POST', body: body.data });
      await qc.invalidateQueries({ queryKey: ['me'] });
      nav('/app', { replace: true });
    } catch (e) {
      setErr(errorMessage(e));
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="min-h-screen bg-page">
      <header className="border-b border-line bg-white"><div className="mx-auto flex h-16 max-w-3xl items-center px-4"><Logo to="/" /></div></header>
      <main className="mx-auto max-w-3xl px-4 py-8">
        <ol className="mb-6 grid grid-cols-4 gap-2" aria-label="Onboarding progress">
          {STEPS.map((s, i) => (
            <li key={s} aria-current={i === step ? 'step' : undefined}>
              <div className={`h-1.5 rounded-full ${i <= step ? 'bg-teal-500' : 'bg-line'}`} />
              <p className={`mt-1.5 text-xs ${i === step ? 'font-semibold text-navy-900' : 'text-muted'}`}><span className="sr-only">Step {i + 1}: </span>{s}</p>
            </li>
          ))}
        </ol>
        <Card className="p-6 sm:p-8">
          <h1 ref={heading} tabIndex={-1} className="text-2xl font-bold outline-none">
            {['Tell us about you', 'What do you offer?', 'Who do you want to work with?', 'What kind of work suits you?'][step]}
          </h1>
          <p className="mt-1 text-sm text-muted">Step {step + 1} of 4 · You can change this later in Account.</p>
          {err && <Alert tone="error" className="mt-4">{err}</Alert>}

          <div className="mt-6 space-y-6">
            {step === 0 && (
              <>
                <Field label="Your name">{(id) => <Input id={id} value={name} onChange={(e) => setName(e.target.value)} maxLength={80} autoComplete="name" />}</Field>
                <div className="grid gap-4 sm:grid-cols-2">
                  <Field label="Country">{(id) => (
                    <Select id={id} value={country} onChange={(e) => setCountry(e.target.value)}>
                      <option value="PH">Philippines</option><option value="OT">Other</option>
                    </Select>
                  )}</Field>
                  <Field label="Your time zone">{(id) => (
                    <Select id={id} value={timezone} onChange={(e) => setTimezone(e.target.value)}>
                      {TIMEZONES.map((t) => <option key={t} value={t}>{t}</option>)}
                    </Select>
                  )}</Field>
                </div>
              </>
            )}
            {step === 1 && (
              <>
                <ChipGroup<SkillCode> legend="Skills (choose all that apply)" options={SKILLS.map((s) => ({ value: s.code, label: s.label }))} value={prefs.skills} onChange={(v) => set('skills', v)} />
                {prefs.skills.includes('other') && <Field label="Other skill">{(id) => <Input id={id} value={prefs.otherSkill} onChange={(e) => set('otherSkill', e.target.value)} maxLength={80} />}</Field>}
              </>
            )}
            {step === 2 && (
              <>
                <Alert tone="info">Launch market: <strong>United States</strong> businesses.</Alert>
                <ChipGroup legend="Target industries (optional)" hint="Leave empty to see all industries." options={INDUSTRIES.map((i) => ({ value: i, label: i }))} value={prefs.industries} onChange={(v) => set('industries', v as Preferences['industries'])} />
                <ChipGroup legend="US time zones you can cover (optional)" options={US_TIMEZONES.map((t) => ({ value: t.code, label: t.label }))} value={prefs.usTimezones} onChange={(v) => set('usTimezones', v)} />
                <ChipGroup legend="Industries to exclude (optional)" options={INDUSTRIES.map((i) => ({ value: i, label: i }))} value={prefs.excludedIndustries} onChange={(v) => set('excludedIndustries', v as Preferences['excludedIndustries'])} />
              </>
            )}
            {step === 3 && (
              <>
                <ChipGroup<WorkType> legend="Work types" options={WORK_TYPES.map((w) => ({ value: w, label: WORK_TYPE_LABELS[w] }))} value={prefs.workTypes} onChange={(v) => set('workTypes', v)} />
                <Toggle label="Only show remote work" hint="Hide on-site and hybrid roles." checked={prefs.requireRemote} onChange={(v) => set('requireRemote', v)} />
                <Toggle label="Hide roles that exclude Philippines-based contractors" hint='For example "US residents only" or "US work authorization required".' checked={prefs.excludeRegionRestricted} onChange={(v) => set('excludeRegionRestricted', v)} />
                <Field label="Responsibilities you're looking for (optional)">{(id) => <Textarea id={id} value={prefs.responsibilities} maxLength={500} onChange={(e) => set('responsibilities', e.target.value)} placeholder="e.g. inbox and calendar management, CRM follow-ups" />}</Field>
                <Field label="Opportunity email digest">{(id) => (
                  <Select id={id} value={prefs.alertFrequency} onChange={(e) => set('alertFrequency', e.target.value as AlertFrequency)}>
                    {ALERT_FREQUENCIES.map((f) => <option key={f} value={f}>{f === 'off' ? 'Off' : f === 'weekly' ? 'Weekly' : 'Daily (Pro plan)'}</option>)}
                  </Select>
                )}</Field>
              </>
            )}
          </div>

          <div className="mt-8 flex justify-between gap-3">
            <Button variant="ghost" onClick={() => { setErr(null); setStep(step - 1); }} disabled={step === 0}>Back</Button>
            <Button onClick={next} loading={busy}>{step === 3 ? 'Finish and see opportunities' : 'Continue'}</Button>
          </div>
        </Card>
      </main>
    </div>
  );
}
