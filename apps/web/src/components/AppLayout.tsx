import { Briefcase, Compass, LayoutDashboard, LogOut, Shield, UserCircle } from 'lucide-react';
import { NavLink, Navigate, Outlet, useLocation } from 'react-router-dom';
import { useQueryClient } from '@tanstack/react-query';
import { useMe } from '../hooks/queries';
import { useAuth } from '../lib/auth';
import { cx } from '../lib/format';
import { Logo } from './Logo';
import { DemoBanner, ErrorState, LoadingBlock } from './ui';

const nav = [
  { to: '/app', label: 'Dashboard', icon: LayoutDashboard, end: true },
  { to: '/app/discover', label: 'Discover', icon: Compass },
  { to: '/app/pipeline', label: 'Pipeline', icon: Briefcase },
  { to: '/app/account', label: 'Account', icon: UserCircle },
];

/** Requires a signed-in user; redirects to onboarding until it's complete. */
export function AppLayout() {
  const { user, ready, signOut } = useAuth();
  const me = useMe();
  const loc = useLocation();
  const qc = useQueryClient();
  if (!ready) return <div className="p-8"><LoadingBlock /></div>;
  if (!user) return <Navigate to="/login" replace state={{ from: loc.pathname }} />;
  if (me.isLoading) return <div className="p-8"><LoadingBlock /></div>;
  if (me.isError) return <div className="p-8"><ErrorState error={me.error} onRetry={() => me.refetch()} /></div>;
  if (me.data && !me.data.profile?.onboardingCompleted) return <Navigate to="/onboarding" replace />;
  const demo = me.data?.appMode.demoMode;
  const items = me.data?.isAdmin ? [...nav, { to: '/admin', label: 'Admin', icon: Shield }] : nav;

  return (
    <div className="flex min-h-screen flex-col">
      <a href="#main" className="sr-only focus:not-sr-only focus:absolute focus:left-4 focus:top-4 focus:z-50 focus:rounded focus:bg-white focus:px-3 focus:py-2">Skip to content</a>
      {demo && <DemoBanner />}
      <div className="flex flex-1">
        <aside className="hidden w-60 shrink-0 flex-col bg-navy-900 px-3 py-5 text-white md:flex">
          <div className="px-2 pb-6"><Logo to="/app" light /></div>
          <nav aria-label="Workspace" className="flex-1 space-y-1">
            {items.map((n) => (
              <NavLink key={n.to} to={n.to} end={n.end} className={({ isActive }) => cx('flex items-center gap-3 rounded-lg px-3 py-2.5 text-sm no-underline hover:no-underline', isActive ? 'bg-teal-500 font-semibold text-navy-900' : 'text-white/80 hover:bg-white/10 hover:text-white')}>
                <n.icon className="size-4" aria-hidden /> {n.label}
              </NavLink>
            ))}
          </nav>
          <button onClick={async () => { await signOut(); qc.clear(); }} className="flex items-center gap-3 rounded-lg px-3 py-2.5 text-sm text-white/80 hover:bg-white/10">
            <LogOut className="size-4" aria-hidden /> Sign out
          </button>
        </aside>
        <div className="flex min-w-0 flex-1 flex-col">
          <header className="flex h-14 items-center justify-between border-b border-line bg-white px-4 md:hidden">
            <Logo to="/app" />
            <button aria-label="Sign out" onClick={async () => { await signOut(); qc.clear(); }} className="rounded-lg p-2"><LogOut className="size-5" /></button>
          </header>
          <main id="main" className="mx-auto w-full max-w-6xl flex-1 px-4 py-6 pb-24 sm:px-6 md:pb-8">
            <Outlet />
          </main>
          <nav aria-label="Workspace mobile" className="fixed inset-x-0 bottom-0 z-30 grid border-t border-line bg-white md:hidden" style={{ gridTemplateColumns: `repeat(${items.length}, minmax(0, 1fr))` }}>
            {items.map((n) => (
              <NavLink key={n.to} to={n.to} end={n.end} className={({ isActive }) => cx('flex flex-col items-center gap-0.5 py-2 text-[11px] no-underline hover:no-underline', isActive ? 'font-semibold text-teal-700' : 'text-muted')}>
                <n.icon className="size-5" aria-hidden /> {n.label}
              </NavLink>
            ))}
          </nav>
        </div>
      </div>
    </div>
  );
}

export function AdminGate() {
  const me = useMe();
  if (me.isLoading) return <LoadingBlock />;
  // UI gate only — the API independently enforces admin access server-side.
  if (!me.data?.isAdmin) return <Navigate to="/app" replace />;
  return <Outlet />;
}

