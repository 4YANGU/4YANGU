import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import './index.css'
import App from './App.tsx'
import { handleGoogleRedirect } from './lib/googleAuth';
import { initBackNavigation } from './lib/backNavigation';
import { applyStoreManifest, clearGenericManifest } from './lib/pwa';
import supabase from './lib/supabase';

void handleGoogleRedirect();
initBackNavigation();

// Per-store web app install: on the store dashboard routes, swap the generic
// platform manifest for the store's own manifest BEFORE the dashboard renders,
// so Chrome's "Install app" prompt always offers the store's name + logo icon.
// (The install prompt fires on user gesture; by then the manifest link must
// already point at /api/store-pwa/manifest.)
const earlyPath = window.location.pathname;
if (earlyPath === '/owner') {
  clearGenericManifest();
  void (async () => {
    try {
      const { data: { session } } = await supabase.auth.getSession();
      if (!session?.access_token) return;
      const response = await fetch('/api/stores?pwa=store', { headers: { Authorization: `Bearer ${session.access_token}` } });
      if (!response.ok) return;
      const payload = (await response.json()) as { slug?: string };
      if (payload.slug) applyStoreManifest(`slug=${encodeURIComponent(payload.slug)}`);
    } catch { /* StoreDashboard re-applies the manifest after its data loads. */ }
  })();
} else if (/^\/manage\/\d+/.test(earlyPath)) {
  applyStoreManifest(`storeId=${encodeURIComponent(earlyPath.split('/')[2])}`);
}

if ('serviceWorker' in navigator) {
  window.addEventListener('load', () => {
    navigator.serviceWorker.register('/sw.js').catch(() => undefined);
  });
}
window.addEventListener('beforeinstallprompt', event => {
  event.preventDefault();
  window.__STOYANGU_NATIVE_INSTALL_PROMPT = event as NonNullable<typeof window.__STOYANGU_NATIVE_INSTALL_PROMPT>;
  window.dispatchEvent(new Event('stoyangu-install-ready'));
});
window.addEventListener('appinstalled', () => localStorage.setItem('stoyangu-installed', '1'));

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <App />
  </StrictMode>,
)
