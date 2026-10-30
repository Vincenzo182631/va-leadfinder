import { Menu, X } from 'lucide-react';
import { useState } from 'react';
import { Link, NavLink, Outlet } from 'react-router-dom';
import { useAuth } from '../lib/auth';
import { Logo } from './Logo';
import { ButtonLink } from './ui';

const links = [
  { to: '/#how-it-works', label: 'How it works' },
  { to: '/pricing', label: 'Pricing' },
  { to: '/faq', label: 'FAQ' },
];

export function MarketingLayout() {
  const { user } = useAuth();
  const [open, setOpen] = useState(false);
  return (
    <div className="flex min-h-screen flex-col">
      <a href="#main" className="sr-only focus:not-sr-only focus:absolute focus:left-4 focus:top-4 focus:z-50 focus:rounded focus:bg-white focus:px-3 focus:py-2">Skip to content</a>
      <header className="sticky top-0 z-30 border-b border-line bg-white/95 backdrop-blur">
        <div className="mx-auto flex h-16 max-w-6xl items-center justify-between px-4">
          <Logo />
          <nav aria-label="Main" className="hidden items-center gap-6 md:flex">
            {links.map((l) => <NavLink key={l.to} to={l.to} className="text-sm font-medium text-ink no-underline hover:text-teal-700">{l.label}</NavLink>)}
          </nav>
          <div className="hidden items-center gap-2 md:flex">
            {user ? <ButtonLink to="/app">Open workspace</ButtonLink> : (
              <>
                <ButtonLink to="/login" variant="ghost">Sign in</ButtonLink>
                <ButtonLink to="/signup">Join the beta</ButtonLink>
              </>
            )}
          </div>
          <button className="rounded-lg p-2 md:hidden" aria-expanded={open} aria-controls="mobile-nav" aria-label={open ? 'Close menu' : 'Open menu'} onClick={() => setOpen(!open)}>
            {open ? <X className="size-6" /> : <Menu className="size-6" />}
          </button>
        </div>
        {open && (
          <nav id="mobile-nav" aria-label="Mobile" className="space-y-1 border-t border-line px-4 py-3 md:hidden">
            {links.map((l) => <Link key={l.to} to={l.to} onClick={() => setOpen(false)} className="block rounded-lg px-3 py-2 text-ink no-underline hover:bg-page">{l.label}</Link>)}
            <div className="flex gap-2 pt-2">
              {user ? <ButtonLink to="/app" className="flex-1">Open workspace</ButtonLink> : (
                <>
                  <ButtonLink to="/login" variant="secondary" className="flex-1">Sign in</ButtonLink>
                  <ButtonLink to="/signup" className="flex-1">Join the beta</ButtonLink>
                </>
              )}
            </div>
          </nav>
        )}
      </header>
      <main id="main" className="flex-1"><Outlet /></main>
      <footer className="bg-navy-900 text-white/80">
        <div className="mx-auto grid max-w-6xl gap-8 px-4 py-10 sm:grid-cols-3">
          <div className="space-y-3">
            <Logo light />
            <p className="text-sm">Find businesses that need your skills. Turn opportunities into clients.</p>
          </div>
          <nav aria-label="Footer" className="grid grid-cols-2 gap-2 text-sm">
            <Link className="text-white/80" to="/pricing">Pricing</Link>
            <Link className="text-white/80" to="/faq">FAQ</Link>
            <Link className="text-white/80" to="/terms">Terms of Service</Link>
            <Link className="text-white/80" to="/privacy">Privacy Policy</Link>
            <a className="text-white/80" href="mailto:support@example.com">Contact support</a>
          </nav>
          <p className="text-xs text-white/60">
            Opportunities are not guaranteed clients. Match scores are estimates. Always verify requirements on the original source before reaching out.
          </p>
        </div>
      </footer>
    </div>
  );
}
