// Per-store web app install (PWA).
//
// index.html links the generic StoYangu manifest so non-store pages stay
// installable. On owner dashboard routes we swap that link for the generated
// StoYangu manifest whose icon uses the current store logo. The operating-
// system app name remains exactly "StoYangu" everywhere.

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

// Removes the generic manifest while the signed-in store is being resolved,
// so installation cannot start before the store-logo icon manifest is ready.
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
  } catch { /* Private mode: no cached splash is shown until the real store logo loads. */ }
}

export function splashCacheKey(storeId: string | undefined): string {
  return storeId ? `stoyangu-store-splash-${storeId}` : 'stoyangu-store-splash';
}
