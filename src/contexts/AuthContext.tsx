import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState } from 'react';
import type { Session, User } from '@supabase/supabase-js';
import supabase from '../lib/supabase';
import type { Profile } from '../types';
type AuthValue = { user: User | null; session: Session | null; profile: Profile | null; loading: boolean; error: string; refreshProfile: () => Promise<void>; signOut: () => Promise<void> };
const AuthContext = createContext<AuthValue | null>(null);
export function AuthProvider({ children }: { children: React.ReactNode }) {
  const [session, setSession] = useState<Session | null>(null);
  const [profile, setProfile] = useState<Profile | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const generation = useRef(0);
  const loadProfile = useCallback(async (current: Session | null) => {
    const version = ++generation.current;
    setError('');
    if (!current) { setProfile(null); setLoading(false); return; }
    try {
      const res = await fetch('/api/media?action=profile', { headers: { Authorization: `Bearer ${current.access_token}` }, cache: 'no-store' });
      const body = await res.json();
      if (!res.ok) throw new Error(body.error || 'Your workspace could not be loaded. Please retry.');
      if (generation.current === version) setProfile(body);
    } catch (e) { if (generation.current === version) { setProfile(null); setError(e instanceof Error ? e.message : 'Please check your connection.'); } }
    finally { if (generation.current === version) setLoading(false); }
  }, []);
  useEffect(() => {
    let alive = true;
    supabase.auth.getSession().then(({ data, error: sessionError }) => {
      if (!alive) return;
      if (sessionError) { setError(sessionError.message); setLoading(false); return; }
      setSession(data.session); void loadProfile(data.session);
    }).catch(() => { if (alive) { setError('Unable to restore your session. Please retry.'); setLoading(false); } });
    const { data: { subscription } } = supabase.auth.onAuthStateChange((_event, next) => {
      if (!alive) return;
      setSession(next);
      window.setTimeout(() => { if (alive) void loadProfile(next); }, 0);
    });
    return () => { alive = false; generation.current++; subscription.unsubscribe(); };
  }, [loadProfile]);
  const value = useMemo<AuthValue>(() => ({
    user: session?.user || null, session, profile, loading, error,
    refreshProfile: async () => { setLoading(true); await loadProfile((await supabase.auth.getSession()).data.session); },
    signOut: async () => {
      const { error: signOutError } = await supabase.auth.signOut();
      if (signOutError) { setError(signOutError.message); return; }
      generation.current++; setSession(null); setProfile(null); setError('');
      for (const key of Object.keys(localStorage)) if (key.startsWith('stoyangu-oauth-resume-')) localStorage.removeItem(key);
    },
  }), [session, profile, loading, error, loadProfile]);
  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}
export function useAuth() { const value = useContext(AuthContext); if (!value) throw new Error('Authentication provider missing.'); return value; }
