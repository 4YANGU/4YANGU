import supabase from './supabase';
export function signInWithGoogle(appName = 'StoYangu'): Promise<void> {
  const clientId = import.meta.env.VITE_GOOGLE_CLIENT_ID;
  const proxy = import.meta.env.VITE_GOOGLE_AUTH_PROXY;
  const supabaseUrl = import.meta.env.VITE_SUPABASE_URL || import.meta.env.NEXT_PUBLIC_SUPABASE_URL;
  const supabaseAnonKey = import.meta.env.VITE_SUPABASE_ANON_KEY || import.meta.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
  if (!clientId || !proxy) return Promise.reject(new Error('Google sign-in is not configured. Please sign in with your WhatsApp number or email and password.'));
  const state = btoa(JSON.stringify({ origin: window.location.origin, appName, supabaseUrl, supabaseAnonKey }));
  const url = `https://accounts.google.com/o/oauth2/v2/auth?client_id=${encodeURIComponent(clientId)}&redirect_uri=${encodeURIComponent(proxy)}&response_type=code&scope=openid%20email%20profile&prompt=select_account&state=${encodeURIComponent(state)}`;
  const popup = window.open(url, 'google-auth', /iPhone|iPad|iPod|Android/i.test(navigator.userAgent) ? '' : 'width=500,height=600');
  if (!popup) return Promise.reject(new Error('Allow pop-ups for this site and try again.'));
  return new Promise((resolve, reject) => {
    const timeout = window.setTimeout(() => { cleanup(); reject(new Error('Sign-in timed out. Please try again.')); }, 300000);
    const cleanup = () => { window.clearTimeout(timeout); window.removeEventListener('message', handler); };
    const handler = async (event: MessageEvent) => {
      if (![new URL(proxy).origin, window.location.origin].includes(event.origin) || event.source !== popup) return;
      if (event.data?.type === 'google-auth-denied') { cleanup(); reject(new Error('Google sign-in was cancelled.')); return; }
      if (event.data?.type !== 'google-auth-success') return;
      cleanup();
      try {
        const { error } = event.data.access_token && event.data.refresh_token
          ? await supabase.auth.setSession({ access_token: event.data.access_token, refresh_token: event.data.refresh_token })
          : await supabase.auth.signInWithIdToken({ provider: 'google', token: event.data.id_token });
        if (error) throw error; resolve();
      } catch (e) { reject(e); }
    };
    window.addEventListener('message', handler);
  });
}
export async function handleGoogleRedirect() {
  const params = new URLSearchParams(window.location.search); const token = params.get('google_id_token'); if (!token) return;
  params.delete('google_id_token'); window.history.replaceState({}, '', `${window.location.pathname}${params.size ? `?${params}` : ''}`);
  const { error } = await supabase.auth.signInWithIdToken({ provider: 'google', token });
  if (!error) { try { window.close(); } catch { /* The session is available across tabs. */ } }
}
