import { AlertTriangle, CheckCircle2, Info, Loader2, XCircle } from 'lucide-react';
import { forwardRef, useId, type ButtonHTMLAttributes, type InputHTMLAttributes, type ReactNode, type SelectHTMLAttributes, type TextareaHTMLAttributes } from 'react';
import { Link } from 'react-router-dom';
import { DEMO_BANNER_TEXT } from '@vlf/shared';
import { cx } from '../lib/format';

type Variant = 'primary' | 'secondary' | 'ghost' | 'danger' | 'onDark';
const variants: Record<Variant, string> = {
  primary: 'bg-teal-500 text-navy-900 hover:bg-teal-600 font-semibold shadow-sm',
  secondary: 'bg-white text-navy-900 border border-line hover:border-navy-800/40',
  ghost: 'text-ink hover:bg-navy-900/5',
  danger: 'bg-white text-danger border border-danger/40 hover:bg-danger-bg',
  onDark: 'bg-transparent text-white border border-white/40 hover:border-white hover:bg-white/10',
};
const base = 'inline-flex items-center justify-center gap-2 rounded-lg px-4 py-2.5 text-sm transition-colors disabled:opacity-50 disabled:cursor-not-allowed min-h-[40px]';

export const Button = forwardRef<HTMLButtonElement, ButtonHTMLAttributes<HTMLButtonElement> & { variant?: Variant; loading?: boolean; size?: 'sm' | 'md' }>(
  ({ variant = 'primary', loading, size = 'md', className, children, disabled, ...rest }, ref) => (
    <button ref={ref} className={cx(base, variants[variant], size === 'sm' && 'px-3 py-1.5 min-h-[34px] text-[13px]', className)} disabled={disabled || loading} {...rest}>
      {loading && <Loader2 className="size-4 animate-spin" aria-hidden />}
      {children}
    </button>
  ),
);

export function ButtonLink({ to, variant = 'primary', className, children }: { to: string; variant?: Variant; className?: string; children: ReactNode }) {
  return (
    <Link to={to} className={cx(base, variants[variant], 'no-underline hover:no-underline', className)}>
      {children}
    </Link>
  );
}

export function Card({ className, children, as: As = 'div' }: { className?: string; children: ReactNode; as?: 'div' | 'section' | 'article' | 'li' }) {
  return <As className={cx('rounded-2xl border border-line bg-white p-5 shadow-[0_1px_2px_rgba(17,30,50,0.04)]', className)}>{children}</As>;
}

const badgeTones = {
  neutral: 'bg-navy-900/5 text-ink',
  teal: 'bg-teal-500/15 text-teal-700',
  warn: 'bg-warn-bg text-warn',
  danger: 'bg-danger-bg text-danger',
  navy: 'bg-navy-900 text-white',
  demo: 'bg-warn-bg text-warn border border-warn/30',
};
export function Badge({ tone = 'neutral', children, className }: { tone?: keyof typeof badgeTones; children: ReactNode; className?: string }) {
  return <span className={cx('inline-flex items-center gap-1 rounded-full px-2.5 py-0.5 text-xs font-medium whitespace-nowrap', badgeTones[tone], className)}>{children}</span>;
}

export const BADGE_TONE: Record<string, keyof typeof badgeTones> = {
  New: 'teal',
  'Likely fit': 'teal',
  'Needs review': 'warn',
  'Region restricted': 'danger',
  Stale: 'warn',
  Demo: 'demo',
};

export function Field({ label, hint, error, children, id }: { label: string; hint?: string; error?: string; children: (id: string, describedBy?: string) => ReactNode; id?: string }) {
  const auto = useId();
  const fid = id ?? auto;
  const hintId = hint ? `${fid}-hint` : undefined;
  const errId = error ? `${fid}-err` : undefined;
  return (
    <div className="space-y-1.5">
      <label htmlFor={fid} className="block text-sm font-medium text-navy-900">{label}</label>
      {children(fid, [hintId, errId].filter(Boolean).join(' ') || undefined)}
      {hint && <p id={hintId} className="text-xs text-muted">{hint}</p>}
      {error && <p id={errId} className="text-xs text-danger" role="alert">{error}</p>}
    </div>
  );
}

const inputCls = 'w-full rounded-lg border border-line bg-white px-3 py-2.5 text-sm text-ink placeholder:text-faint focus:border-teal-600 focus:outline-none focus:ring-2 focus:ring-teal-500/30';
export const Input = forwardRef<HTMLInputElement, InputHTMLAttributes<HTMLInputElement>>(({ className, ...p }, ref) => <input ref={ref} className={cx(inputCls, className)} {...p} />);
export const Textarea = forwardRef<HTMLTextAreaElement, TextareaHTMLAttributes<HTMLTextAreaElement>>(({ className, ...p }, ref) => <textarea ref={ref} className={cx(inputCls, 'min-h-[110px]', className)} {...p} />);
export const Select = forwardRef<HTMLSelectElement, SelectHTMLAttributes<HTMLSelectElement>>(({ className, children, ...p }, ref) => (
  <select ref={ref} className={cx(inputCls, 'pr-8', className)} {...p}>{children}</select>
));

/** Multi-select as accessible toggle chips (checkbox semantics). */
export function ChipGroup<T extends string>({ legend, options, value, onChange, hint }: { legend: string; options: { value: T; label: string }[]; value: T[]; onChange: (v: T[]) => void; hint?: string }) {
  return (
    <fieldset className="space-y-2">
      <legend className="text-sm font-medium text-navy-900">{legend}</legend>
      {hint && <p className="text-xs text-muted">{hint}</p>}
      <div className="flex flex-wrap gap-2">
        {options.map((o) => {
          const on = value.includes(o.value);
          return (
            <label key={o.value} className={cx('cursor-pointer rounded-full border px-3 py-1.5 text-sm transition-colors has-[:focus-visible]:outline has-[:focus-visible]:outline-3 has-[:focus-visible]:outline-teal-500', on ? 'border-teal-600 bg-teal-500/15 text-navy-900 font-medium' : 'border-line bg-white text-ink hover:border-navy-800/30')}>
              <input type="checkbox" className="sr-only" checked={on} onChange={() => onChange(on ? value.filter((v) => v !== o.value) : [...value, o.value])} />
              {o.label}
            </label>
          );
        })}
      </div>
    </fieldset>
  );
}

export function Toggle({ label, checked, onChange, hint }: { label: string; checked: boolean; onChange: (v: boolean) => void; hint?: string }) {
  const id = useId();
  return (
    <div className="flex items-start gap-3">
      <input id={id} type="checkbox" checked={checked} onChange={(e) => onChange(e.target.checked)} className="mt-0.5 size-5 accent-teal-600" />
      <div>
        <label htmlFor={id} className="text-sm font-medium text-navy-900">{label}</label>
        {hint && <p className="text-xs text-muted">{hint}</p>}
      </div>
    </div>
  );
}

const alertTones = {
  info: { cls: 'border-navy-800/15 bg-white', icon: Info, ic: 'text-navy-800' },
  success: { cls: 'border-teal-600/30 bg-teal-500/10', icon: CheckCircle2, ic: 'text-teal-700' },
  warn: { cls: 'border-warn/30 bg-warn-bg', icon: AlertTriangle, ic: 'text-warn' },
  error: { cls: 'border-danger/30 bg-danger-bg', icon: XCircle, ic: 'text-danger' },
};
export function Alert({ tone = 'info', title, children, className }: { tone?: keyof typeof alertTones; title?: string; children?: ReactNode; className?: string }) {
  const t = alertTones[tone];
  const Icon = t.icon;
  return (
    <div role={tone === 'error' ? 'alert' : 'status'} className={cx('flex gap-3 rounded-xl border p-4 text-sm', t.cls, className)}>
      <Icon className={cx('mt-0.5 size-5 shrink-0', t.ic)} aria-hidden />
      <div className="space-y-1">
        {title && <p className="font-semibold text-navy-900">{title}</p>}
        {children && <div className="text-ink">{children}</div>}
      </div>
    </div>
  );
}

export function Skeleton({ className }: { className?: string }) {
  return <div className={cx('animate-pulse rounded-lg bg-navy-900/[0.06]', className)} aria-hidden />;
}

export function LoadingBlock({ label = 'Loading…', rows = 3 }: { label?: string; rows?: number }) {
  return (
    <div role="status" aria-live="polite" className="space-y-3">
      <span className="sr-only">{label}</span>
      {Array.from({ length: rows }).map((_, i) => <Skeleton key={i} className="h-24 w-full" />)}
    </div>
  );
}

export function EmptyState({ icon, title, children, action }: { icon?: ReactNode; title: string; children?: ReactNode; action?: ReactNode }) {
  return (
    <div className="rounded-2xl border border-dashed border-line bg-white px-6 py-12 text-center">
      {icon && <div className="mx-auto mb-3 flex size-12 items-center justify-center rounded-full bg-teal-500/10 text-teal-700">{icon}</div>}
      <h3 className="text-base font-semibold">{title}</h3>
      {children && <div className="mx-auto mt-1 max-w-md text-sm text-muted">{children}</div>}
      {action && <div className="mt-4">{action}</div>}
    </div>
  );
}

export function ErrorState({ error, onRetry }: { error: unknown; onRetry?: () => void }) {
  const msg = error instanceof Error ? error.message : 'Something went wrong.';
  return (
    <Alert tone="error" title="We couldn't load this">
      <p>{msg}</p>
      {onRetry && <Button variant="secondary" size="sm" className="mt-2" onClick={onRetry}>Try again</Button>}
    </Alert>
  );
}

/** Mandatory on every page showing demo opportunities. */
export function DemoBanner({ className }: { className?: string }) {
  return (
    <div role="note" className={cx('flex items-center justify-center gap-2 bg-warn-bg px-4 py-2 text-center text-xs font-bold tracking-wide text-warn', className)}>
      <AlertTriangle className="size-4" aria-hidden /> {DEMO_BANNER_TEXT}
      <span className="hidden font-normal sm:inline">· Fictional companies for exploring the product</span>
    </div>
  );
}

export function PageHeader({ title, description, actions }: { title: string; description?: ReactNode; actions?: ReactNode }) {
  return (
    <div className="mb-6 flex flex-col gap-3 sm:flex-row sm:items-end sm:justify-between">
      <div>
        <h1 className="text-2xl font-bold sm:text-[28px]">{title}</h1>
        {description && <p className="mt-1 text-sm text-muted">{description}</p>}
      </div>
      {actions && <div className="flex flex-wrap gap-2">{actions}</div>}
    </div>
  );
}

export function ScoreRing({ score, band }: { score: number; band: string }) {
  const color = band === 'high' ? '#16AA94' : band === 'potential' ? '#C58A00' : '#8293A5';
  const r = 18;
  const c = 2 * Math.PI * r;
  return (
    <div className="relative size-12 shrink-0" role="img" aria-label={`Match score ${score} out of 100`}>
      <svg viewBox="0 0 44 44" className="size-12 -rotate-90">
        <circle cx="22" cy="22" r={r} fill="none" stroke="#E3E8EF" strokeWidth="4" />
        <circle cx="22" cy="22" r={r} fill="none" stroke={color} strokeWidth="4" strokeDasharray={c} strokeDashoffset={c * (1 - score / 100)} strokeLinecap="round" />
      </svg>
      <span className="absolute inset-0 flex items-center justify-center font-display text-sm font-bold text-navy-900">{score}</span>
    </div>
  );
}
