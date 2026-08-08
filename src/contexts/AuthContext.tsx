import { createContext, useContext, useEffect, useMemo, useState } from 'react';
import type { Session, User } from '@supabase/supabase-js';
import supabase from '../lib/supabase';
import type { Profile } from '../types';

type AuthValue = {
  user: User | null;
  session: Session | null;
  profile: Profile | null;
  loading: boolean;
  refreshProfile: () => Promise<void>;
  signOut: () => Promise<void>;
};

const AuthContext = createContext<AuthValue | null>(null);

export function AuthProvider({ children }: { children: React.ReactNode }) {
  const [user, setUser] = useState<User | null>(null);
  const [session, setSession] = useState<Session | null>(null);
  const [profile, setProfile] = useState<Profile | null>(null);
  const [loading, setLoading] = useState(true);

  const loadProfile = async (nextSession?: Session | null) => {
    const current = nextSession ?? (await supabase.auth.getSession()).data.session;
    if (!current) {
      setProfile(null);
      return;
    }
    const response = await fetch('/api/profile', { headers: { Authorization: `Bearer ${current.access_token}` } });
    if (!response.ok) {
      setProfile(null);
      return;
    }
    setProfile(await response.json());
  };

  useEffect(() => {
    let alive = true;
    supabase.auth.getSession().then(async ({ data }) => {
      if (!alive) return;
      setSession(data.session);
      setUser(data.session?.user ?? null);
      await loadProfile(data.session);
      if (alive) setLoading(false);
    });
    const { data: { subscription } } = supabase.auth.onAuthStateChange((_event, nextSession) => {
      setSession(nextSession);
      setUser(nextSession?.user ?? null);
      window.setTimeout(async () => { await loadProfile(nextSession); setLoading(false); }, 0);
    });
    return () => { alive = false; subscription.unsubscribe(); };
  }, []);

  const value = useMemo<AuthValue>(() => ({
    user,
    session,
    profile,
    loading,
    refreshProfile: () => loadProfile(session),
    signOut: async () => {
      setUser(null); setSession(null); setProfile(null);
      await supabase.auth.signOut();
    },
  }), [user, session, profile, loading]);

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function useAuth() {
  const value = useContext(AuthContext);
  if (!value) throw new Error('useAuth must be used inside AuthProvider');
  return value;
}
