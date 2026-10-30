export const fmtDate = (d: string | null | undefined) =>
  d ? new Date(d).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' }) : '—';

export const fmtDateTime = (d: string | null | undefined) =>
  d ? new Date(d).toLocaleString('en-US', { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' }) : '—';

export function relDays(d: string | null | undefined): string {
  if (!d) return 'unknown';
  const days = Math.floor((Date.now() - new Date(d).getTime()) / 86_400_000);
  if (days <= 0) return 'today';
  if (days === 1) return 'yesterday';
  return `${days} days ago`;
}

export const php = (n: number) => `₱${n.toLocaleString('en-PH')}`;

export const cx = (...c: (string | false | null | undefined)[]) => c.filter(Boolean).join(' ');
