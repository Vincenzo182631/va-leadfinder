import { useState, type FormEvent, type ReactNode } from 'react';
import { Link, Navigate, useLocation, useNavigate } from 'react-router-dom';
import { Alert, Button, Card, Field, Input } from '../../components/ui';
import { errorMessage } from '../../lib/api';
import { useAuth } from '../../lib/auth';

function AuthShell({ title, subtitle, children, footer }: { title: string; subtitle?: string; children: ReactNode; footer?: ReactNode }) {
  const { mode } = useAuth();
  return (
    <div className="mx-auto max-w-md px-4 py-14">
      <Card className="p-6 sm:p-8">
        <h1 className="text-2xl font-bold">{title}</h1>
        {subtitle && <p className="mt-1 text-sm text-muted">{subtitle}</p>}
        <div className="mt-6">{children}</div>
      </Card>
      {footer && <div className="mt-4 text-center text-sm">{footer}</div>}
      {mode === 'local' && <p className="mt-4 text-center text-xs text-muted">Local development auth — not for production use.</p>}
    </div>
  );
}

export function LoginPage() {
  const { signIn, user } = useAuth();
  const nav = useNavigate();
  const loc = useLocation() as { state?: { from?: string } };
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [err, setErr] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  if (user) return <Navigate to={loc.state?.from ?? '/app'} replace />;
  const submit = async (e: FormEvent) => {
    e.preventDefault();
    setErr(null);
    setBusy(true);
    try {
      await signIn(email.trim(), password);
      nav(loc.state?.from ?? '/app', { replace: true });
    } catch (e2) {
      setErr(errorMessage(e2));
    } finally {
      setBusy(false);
    }
  };
  return (
    <AuthShell title="Sign in" subtitle="Welcome back to your workspace." footer={<>New here? <Link to="/signup">Create a free account</Link></>}>
      <form onSubmit={submit} className="space-y-4" noValidate>
        {err && <Alert tone="error">{err}</Alert>}
        <Field label="Email">{(id) => <Input id={id} type="email" autoComplete="email" required value={email} onChange={(e) => setEmail(e.target.value)} />}</Field>
        <Field label="Password">{(id) => <Input id={id} type="password" autoComplete="current-password" required value={password} onChange={(e) => setPassword(e.target.value)} />}</Field>
        <Button type="submit" className="w-full" loading={busy}>Sign in</Button>
        <p className="text-center text-sm"><Link to="/forgot-password">Forgot your password?</Link></p>
      </form>
    </AuthShell>
  );
}

export function SignupPage() {
  const { signUp, user } = useAuth();
  const nav = useNavigate();
  const [name, setName] = useState('');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [agree, setAgree] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [done, setDone] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  if (user && !done) return <Navigate to="/onboarding" replace />;
  const submit = async (e: FormEvent) => {
    e.preventDefault();
    setErr(null);
    if (password.length < 8) return setErr('Use at least 8 characters for your password.');
    if (!agree) return setErr('Please accept the Terms and Privacy Policy to continue.');
    setBusy(true);
    try {
      const r = await signUp(email.trim(), password, name.trim());
      if (r.needsConfirmation) setDone(r.notice ?? 'Check your inbox for a confirmation link, then sign in.');
      else nav('/onboarding', { replace: true });
    } catch (e2) {
      setErr(errorMessage(e2));
    } finally {
      setBusy(false);
    }
  };
  if (done)
    return (
      <AuthShell title="Check your email">
        <Alert tone="success">{done}</Alert>
        <p className="mt-4 text-sm text-muted">If an account can be created for that address, you'll receive a confirmation email shortly.</p>
        <p className="mt-4 text-sm"><Link to="/login">Go to sign in</Link></p>
      </AuthShell>
    );
  return (
    <AuthShell title="Join the beta" subtitle="Free to explore. No credit card needed." footer={<>Already have an account? <Link to="/login">Sign in</Link></>}>
      <form onSubmit={submit} className="space-y-4" noValidate>
        {err && <Alert tone="error">{err}</Alert>}
        <Field label="Your name">{(id) => <Input id={id} autoComplete="name" value={name} onChange={(e) => setName(e.target.value)} maxLength={80} />}</Field>
        <Field label="Email">{(id) => <Input id={id} type="email" autoComplete="email" required value={email} onChange={(e) => setEmail(e.target.value)} />}</Field>
        <Field label="Password" hint="At least 8 characters.">{(id, d) => <Input id={id} aria-describedby={d} type="password" autoComplete="new-password" required value={password} onChange={(e) => setPassword(e.target.value)} />}</Field>
        <label className="flex items-start gap-2 text-sm">
          <input type="checkbox" className="mt-0.5 size-4 accent-teal-600" checked={agree} onChange={(e) => setAgree(e.target.checked)} />
          <span>I agree to the <Link to="/terms">Terms</Link> and <Link to="/privacy">Privacy Policy</Link>, and understand opportunities are not guaranteed clients.</span>
        </label>
        <Button type="submit" className="w-full" loading={busy}>Create account</Button>
      </form>
    </AuthShell>
  );
}

export function ForgotPasswordPage() {
  const { requestReset } = useAuth();
  const [email, setEmail] = useState('');
  const [sent, setSent] = useState(false);
  const [busy, setBusy] = useState(false);
  const submit = async (e: FormEvent) => {
    e.preventDefault();
    setBusy(true);
    try {
      await requestReset(email.trim());
    } catch {
      /* same message either way */
    } finally {
      setBusy(false);
      setSent(true);
    }
  };
  return (
    <AuthShell title="Reset your password" footer={<Link to="/login">Back to sign in</Link>}>
      {sent ? (
        <Alert tone="success">If an account exists for that email, we've sent a reset link.</Alert>
      ) : (
        <form onSubmit={submit} className="space-y-4">
          <Field label="Email">{(id) => <Input id={id} type="email" autoComplete="email" required value={email} onChange={(e) => setEmail(e.target.value)} />}</Field>
          <Button type="submit" className="w-full" loading={busy}>Send reset link</Button>
        </form>
      )}
    </AuthShell>
  );
}

export function ResetPasswordPage() {
  const { completeReset, mode } = useAuth();
  const nav = useNavigate();
  // Token travels in the URL fragment so it is never sent to servers or logs.
  const token = new URLSearchParams(location.hash.slice(1)).get('token') ?? undefined;
  const [password, setPassword] = useState('');
  const [err, setErr] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const submit = async (e: FormEvent) => {
    e.preventDefault();
    if (password.length < 8) return setErr('Use at least 8 characters.');
    setBusy(true);
    try {
      await completeReset(password, token);
      history.replaceState(null, '', location.pathname);
      nav('/login', { replace: true });
    } catch (e2) {
      setErr(errorMessage(e2));
    } finally {
      setBusy(false);
    }
  };
  if (mode === 'local' && !token) return <AuthShell title="Reset link missing"><Alert tone="error">Open the reset link from your email.</Alert></AuthShell>;
  return (
    <AuthShell title="Choose a new password">
      <form onSubmit={submit} className="space-y-4">
        {err && <Alert tone="error">{err}</Alert>}
        <Field label="New password" hint="At least 8 characters.">{(id, d) => <Input id={id} aria-describedby={d} type="password" autoComplete="new-password" value={password} onChange={(e) => setPassword(e.target.value)} />}</Field>
        <Button type="submit" className="w-full" loading={busy}>Update password</Button>
      </form>
    </AuthShell>
  );
}
