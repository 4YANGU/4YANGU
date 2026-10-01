import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { AuthContext } from './authContext';
import type { AuthValue } from './authContext';
import type { Session } from '@supabase/supabase-js';
import supabase from '../lib/supabase';
import { clearOfflineData, readOfflineData, writeOfflineData } from '../lib/offlineCache';
import type { Profile } from '../types';

function profileCacheKey(userId: string) {
  return `profile:${userId}`;
}

export function AuthProvider({ children }: { children: React.ReactNode }) {
  const [session, setSession] = useState<Session | null>(null);
  const [profile, setProfile] = useState<Profile | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const generation = useRef(0);

  const loadProfile = useCallback(async (current: Session | null, isActive: () => boolean = () => true) => {
    const version = ++generation.current;
    const isCurrent = () => generation.current === version && isActive();
    setError('');
    if (!current) { setProfile(null); setLoading(false); return; }

    const key = profileCacheKey(current.user.id);
    const savedProfile = await readOfflineData<Profile>(key);
    const cachedProfile = savedProfile?.user_id === current.user.id ? savedProfile : null;
    if (!isCurrent()) return;

    if (typeof navigator !== 'undefined' && navigator.onLine === false) {
      setProfile(cachedProfile);
      setError(cachedProfile ? '' : 'No saved workspace copy is available yet. Connect once to load your workspace for offline use.');
      setLoading(false);
      return;
    }

    try {
      const res = await fetch('/api/media?action=profile', {
        headers: { Authorization: `Bearer ${current.access_token}` },
        cache: 'no-store',
      });
      const body = await res.json().catch(() => ({}));
      if (!res.ok) {
        if (res.status >= 500 && cachedProfile) {
          if (isCurrent()) { setProfile(cachedProfile); setError(''); }
          return;
        }
        if (isCurrent()) {
          setProfile(null);
          setError(typeof body.error === 'string' ? body.error : 'Your workspace could not be loaded. Please retry.');
        }
        return;
      }
      if (isCurrent()) {
        setProfile(body as Profile);
        setError('');
        await writeOfflineData(key, body);
      }
    } catch (e) {
      if (!isCurrent()) return;
      if (cachedProfile) {
        setProfile(cachedProfile);
        setError('');
      } else {
        setProfile(null);
        setError(e instanceof Error ? e.message : 'Please check your connection.');
      }
    } finally {
      if (isCurrent()) setLoading(false);
    }
  }, []);

  useEffect(() => {
    let alive = true;
    supabase.auth.getSession().then(({ data, error: sessionError }) => {
      if (!alive) return;
      if (sessionError) { setError(sessionError.message); setLoading(false); return; }
      setSession(data.session);
      void loadProfile(data.session, () => alive);
    }).catch(() => {
      if (alive) { setError('Unable to restore your session. Please retry.'); setLoading(false); }
    });
    const { data: { subscription } } = supabase.auth.onAuthStateChange((_event, next) => {
      if (!alive) return;
      setSession(next);
      window.setTimeout(() => { if (alive) void loadProfile(next, () => alive); }, 0);
    });
    const refreshWhenOnline = () => {
      if (alive) void supabase.auth.getSession().then(({ data }) => loadProfile(data.session, () => alive));
    };
    window.addEventListener('online', refreshWhenOnline);
    return () => {
      alive = false;
      subscription.unsubscribe();
      window.removeEventListener('online', refreshWhenOnline);
    };
  }, [loadProfile]);

  const value = useMemo<AuthValue>(() => ({
    user: session?.user || null, session, profile, loading, error,
    refreshProfile: async () => {
      setLoading(true);
      await loadProfile((await supabase.auth.getSession()).data.session);
    },
    signOut: async () => {
      const { error: signOutError } = await supabase.auth.signOut();
      if (signOutError) { setError(signOutError.message); return; }
      generation.current++;
      setSession(null);
      setProfile(null);
      setError('');
      void clearOfflineData();
      for (const key of Object.keys(localStorage)) if (key.startsWith('stoyangu-oauth-resume-')) localStorage.removeItem(key);
    },
  }), [session, profile, loading, error, loadProfile]);

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}
