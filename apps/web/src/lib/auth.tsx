import type { SupabaseClient } from '@supabase/supabase-js';
import { createContext, useCallback, useContext, useEffect, useMemo, useState, type ReactNode } from 'react';
import { api, setTokenGetter } from './api';

export type AuthMode = 'supabase' | 'local';
export const AUTH_MODE: AuthMode = import.meta.env.VITE_AUTH_MODE === 'supabase' ? 'supabase' : 'local';

interface AuthUser { id: string; email: string | null }
interface SignUpResult { needsConfirmation: boolean; notice?: string }

interface AuthApi {
  ready: boolean;
  user: AuthUser | null;
  mode: AuthMode;
  signIn(email: string, password: string): Promise<void>;
  signUp(email: string, password: string, displayName: string): Promise<SignUpResult>;
  signOut(): Promise<void>;
  requestReset(email: string): Promise<void>;
  completeReset(password: string, token?: string): Promise<void>;
}

const Ctx = createContext<AuthApi | null>(null);
const LOCAL_KEY = 'vlf.dev.session';
const GENERIC_LOGIN_ERROR = 'Email or password is incorrect.';

let supabase: SupabaseClient | null = null;
/** Loaded on demand so local-mode builds don't ship the Supabase client in the main bundle. */
async function loadSupabase(): Promise<SupabaseClient> {
  if (!supabase) {
    const url = import.meta.env.VITE_SUPABASE_URL as string;
    const key = import.meta.env.VITE_SUPABASE_ANON_KEY as string;
    if (!url || !key) throw new Error('Supabase is not configured (VITE_SUPABASE_URL / VITE_SUPABASE_ANON_KEY).');
    const { createClient } = await import('@supabase/supabase-js');
    supabase = createClient(url, key, { auth: { persistSession: true, autoRefreshToken: true, detectSessionInUrl: true, flowType: 'pkce' } });
  }
  return supabase;
}
const sb = () => {
  if (!supabase) throw new Error('Supabase client not initialised yet');
  return supabase;
};

function decodeExp(token: string): number {
  try {
    return JSON.parse(atob(token.split('.')[1]!.replace(/-/g, '+').replace(/_/g, '/'))).exp * 1000;
  } catch {
    return 0;
  }
}

export function AuthProvider({ children }: { children: ReactNode }) {
  const [user, setUser] = useState<AuthUser | null>(null);
  const [ready, setReady] = useState(false);

  useEffect(() => {
    if (AUTH_MODE === 'supabase') {
      let unsubscribe = () => {};
      setTokenGetter(async () => (await (await loadSupabase()).auth.getSession()).data.session?.access_token ?? null);
      loadSupabase().then((client) => {
        client.auth.getSession().then(({ data }) => {
          const u = data.session?.user;
          setUser(u ? { id: u.id, email: u.email ?? null } : null);
          setReady(true);
        });
        const { data } = client.auth.onAuthStateChange((_e, session) => {
          const u = session?.user;
          setUser(u ? { id: u.id, email: u.email ?? null } : null);
        });
        unsubscribe = () => data.subscription.unsubscribe();
      }).catch(() => setReady(true));
      return () => unsubscribe();
    }
    // Local dev adapter: short-lived dev token in sessionStorage (never used in production builds).
    const read = () => {
      try {
        const s = JSON.parse(sessionStorage.getItem(LOCAL_KEY) ?? 'null') as { token: string; user: AuthUser } | null;
        if (s && decodeExp(s.token) > Date.now()) return s;
      } catch { /* ignore */ }
      sessionStorage.removeItem(LOCAL_KEY);
      return null;
    };
    setTokenGetter(async () => read()?.token ?? null);
    setUser(read()?.user ?? null);
    setReady(true);
  }, []);

  const storeLocal = (token: string, u: AuthUser) => {
    sessionStorage.setItem(LOCAL_KEY, JSON.stringify({ token, user: u }));
    setUser(u);
  };

  const signIn = useCallback(async (email: string, password: string) => {
    if (AUTH_MODE === 'supabase') {
      const { error } = await sb().auth.signInWithPassword({ email, password });
      if (error) throw new Error(error.message.toLowerCase().includes('confirm') ? 'Please confirm your email first, then sign in.' : GENERIC_LOGIN_ERROR);
      return;
    }
    const r = await api<{ accessToken: string; user: AuthUser }>('/api/dev-auth/login', { method: 'POST', body: { email, password } }).catch(() => {
      throw new Error(GENERIC_LOGIN_ERROR);
    });
    storeLocal(r.accessToken, r.user);
  }, []);

  const signUp = useCallback(async (email: string, password: string, displayName: string): Promise<SignUpResult> => {
    if (AUTH_MODE === 'supabase') {
      const { error } = await sb().auth.signUp({ email, password, options: { emailRedirectTo: `${location.origin}/onboarding`, data: { display_name: displayName } } });
      // Same response whether or not the account exists.
      if (error && !/registered|exists/i.test(error.message)) throw new Error(error.message);
      return { needsConfirmation: true };
    }
    const r = await api<{ accessToken?: string; user?: AuthUser; notice?: string; message?: string }>('/api/dev-auth/signup', { method: 'POST', body: { email, password, displayName } });
    if (r.accessToken && r.user) {
      storeLocal(r.accessToken, r.user);
      return { needsConfirmation: false, notice: r.notice };
    }
    return { needsConfirmation: true, notice: r.message };
  }, []);

  const signOut = useCallback(async () => {
    if (AUTH_MODE === 'supabase') await sb().auth.signOut();
    sessionStorage.removeItem(LOCAL_KEY);
    setUser(null);
  }, []);

  const requestReset = useCallback(async (email: string) => {
    if (AUTH_MODE === 'supabase') {
      await sb().auth.resetPasswordForEmail(email, { redirectTo: `${location.origin}/reset-password` });
      return;
    }
    await api('/api/dev-auth/forgot', { method: 'POST', body: { email } });
  }, []);

  const completeReset = useCallback(async (password: string, token?: string) => {
    if (AUTH_MODE === 'supabase') {
      const { error } = await sb().auth.updateUser({ password });
      if (error) throw new Error('This reset link is invalid or has expired.');
      return;
    }
    await api('/api/dev-auth/reset', { method: 'POST', body: { token, password } });
  }, []);

  const value = useMemo(() => ({ ready, user, mode: AUTH_MODE, signIn, signUp, signOut, requestReset, completeReset }), [ready, user, signIn, signUp, signOut, requestReset, completeReset]);
  return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
}

export function useAuth() {
  const v = useContext(Ctx);
  if (!v) throw new Error('useAuth outside AuthProvider');
  return v;
}
