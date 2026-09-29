// Per-store web app install (PWA).
//
// index.html links a generic platform manifest so non-store pages stay
// installable. On the store dashboard routes (/owner, /manage/:id) we swap
// that link for the store's own manifest (/api/store-pwa/manifest), so
// Chrome's install prompt shows the store's name and the installed app's
// home-screen icon is the store's logo.

export function manifestHref(query: string): string {
  return `/api/store-pwa/manifest?${query}`;
}

export function applyStoreManifest(query: string): void {
  if (typeof document === 'undefined') return;
  const href = manifestHref(query);
  let link = document.querySelector<HTMLLinkElement>('link[rel="manifest"]');
  if (!link) {
    link = document.createElement('link');
    link.rel = 'manifest';
    document.head.appendChild(link);
  }
  if (link.getAttribute('href') === href) return;
  link.setAttribute('href', href);
}

// Removes the generic platform manifest. Used synchronously on /owner while
// the signed-in store is being resolved, so a generic "StoYangu" app can
// never be installed by mistake on the store dashboard.
export function clearGenericManifest(): void {
  if (typeof document === 'undefined') return;
  const link = document.querySelector<HTMLLinkElement>('link[rel="manifest"]');
  if (link && !String(link.getAttribute('href') || '').includes('/api/store-pwa/')) link.remove();
}

// Splash cache: remembers each store's name + logo so the installed app can
// show the store's own logo in its loading animation from the very first
// frame (before the dashboard API responds).
export function readSplashCache(key: string): { name: string; logo_url: string } | null {
  try {
    const raw = localStorage.getItem(key);
    if (!raw) return null;
    const parsed = JSON.parse(raw);
    if (!parsed || typeof parsed.name !== 'string') return null;
    return { name: parsed.name, logo_url: typeof parsed.logo_url === 'string' ? parsed.logo_url : '' };
  } catch {
    return null;
  }
}

export function saveSplashCache(key: string, store: { id?: number; name?: string; slug?: string; logo_url?: string }): void {
  try {
    localStorage.setItem(key, JSON.stringify({ name: store.name || '', logo_url: store.logo_url || '' }));
  } catch { /* private mode etc. — the splash falls back to the platform logo */ }
}

export function splashCacheKey(storeId: string | undefined): string {
  return storeId ? `stoyangu-store-splash-${storeId}` : 'stoyangu-store-splash';
}
