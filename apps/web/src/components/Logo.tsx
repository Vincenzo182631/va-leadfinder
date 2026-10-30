import { Link } from 'react-router-dom';

export function Logo({ to = '/', light = false }: { to?: string; light?: boolean }) {
  return (
    <Link to={to} className="flex items-center gap-2 no-underline hover:no-underline" aria-label="VA LeadFinder home">
      <svg viewBox="0 0 32 32" className="size-8" aria-hidden>
        <rect width="32" height="32" rx="8" fill={light ? '#172B41' : '#111E32'} />
        <circle cx="14" cy="14" r="6.5" fill="none" stroke="#21C4AB" strokeWidth="3" />
        <path d="M19 19l6 6" stroke="#21C4AB" strokeWidth="3" strokeLinecap="round" />
      </svg>
      <span className={`font-display text-lg font-extrabold tracking-tight ${light ? 'text-white' : 'text-navy-900'}`}>
        VA <span className="text-teal-600">LeadFinder</span>
      </span>
    </Link>
  );
}
