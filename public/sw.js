// Do not cache authenticated API data in the service worker. Private, user-scoped
// GET responses are cached by the signed-in app in IndexedDB instead.
const CACHE = 'stoyangu-static-v14';
const SHELL_CACHE = 'stoyangu-shell-v2';
const APP_CACHE_PREFIXES = ['stoyangu-static-v', 'stoyangu-shell-v'];

self.addEventListener('install', event => event.waitUntil((async () => {
  const shell = await caches.open(SHELL_CACHE);
  try { await shell.add(new Request('/index.html', { cache: 'reload' })); } catch { /* A later online visit will seed the shell. */ }

  // Vite's build manifest lists the initial bundle plus lazy route chunks. Cache
  // them during SW install so the very first connected visit prepares an app
  // shell that can still open after a reload with no data connection.
  try {
    const response = await fetch('/app-assets-manifest.json', { cache: 'reload' });
    if (response.ok) {
      const manifest = await response.json();
      const paths = new Set();
      for (const entry of Object.values(manifest)) {
        if (!entry || typeof entry !== 'object') continue;
        if (typeof entry.file === 'string') paths.add(entry.file);
        for (const file of [...(entry.css || []), ...(entry.assets || [])]) if (typeof file === 'string') paths.add(file);
      }
      const assets = await caches.open(CACHE);
      await Promise.all([...paths].filter(path => /\.(js|css|png|jpg|jpeg|webp|svg|woff2)$/.test(path)).map(async path => {
        try {
          const asset = await fetch(`/${path.replace(/^\//, '')}`, { cache: 'reload' });
          if (asset.ok) await assets.put(`/${path.replace(/^\//, '')}`, asset);
        } catch { /* Other reachable assets are cached on first use. */ }
      }));
    }
  } catch { /* This is a progressive offline enhancement, never block install. */ }
  await self.skipWaiting();
})()));

self.addEventListener('activate', event => event.waitUntil((async () => {
  for (const key of await caches.keys()) {
    if (APP_CACHE_PREFIXES.some(prefix => key.startsWith(prefix)) && key !== CACHE && key !== SHELL_CACHE) await caches.delete(key);
  }
  await self.clients.claim();
})()));

self.addEventListener('fetch', event => {
  const request = event.request;
  const url = new URL(request.url);
  if (request.method !== 'GET' || url.searchParams.has('oauth_state') || url.pathname.endsWith('.zip')) return;

  // Store/product logos commonly live in public Supabase Storage. Save images
  // already viewed in the app so offline startup and cached products keep them.
  if (url.origin !== self.location.origin) {
    if (url.protocol === 'https:' && url.hostname.endsWith('.supabase.co') && url.pathname.includes('/storage/v1/object/public/') && request.destination === 'image') {
      event.respondWith((async () => {
        const cache = await caches.open(CACHE);
        const cached = await cache.match(request);
        if (cached) return cached;
        const response = await fetch(request);
        if (response.ok || response.type === 'opaque') await cache.put(request, response.clone());
        return response;
      })());
    }
    return;
  }
  if (url.pathname.startsWith('/api/')) return;

  if (request.mode === 'navigate') {
    event.respondWith((async () => {
      try {
        const response = await fetch(request);
        if (response.ok && (response.headers.get('content-type') || '').includes('text/html')) {
          const shell = await caches.open(SHELL_CACHE);
          await shell.put('/index.html', response.clone());
        }
        return response;
      } catch {
        const cachedShell = await caches.match('/index.html');
        if (cachedShell) return cachedShell;
        return new Response('<!doctype html><html><head><meta name="viewport" content="width=device-width,initial-scale=1"><title>StoYangu</title></head><body><main style="font:16px system-ui;padding:2rem"><h1>StoYangu is not saved on this device yet</h1><p>Open the app once while connected and your workspace can be available here next time.</p></main></body></html>', {
          status: 503,
          headers: { 'Content-Type': 'text/html; charset=utf-8' },
        });
      }
    })());
    return;
  }

  const isAppShell = url.pathname === '/index.html';
  const isStaticAsset = url.pathname.startsWith('/assets/') || /\.(js|css|png|jpg|jpeg|webp|svg|woff2)$/.test(url.pathname);
  if (!isAppShell && !isStaticAsset) return;

  const cacheName = isAppShell ? SHELL_CACHE : CACHE;
  event.respondWith((async () => {
    const cache = await caches.open(cacheName);
    const cached = await cache.match(request);
    if (cached) {
      // Hashed Vite assets are immutable; refreshing the shell itself happens
      // through a normal navigation, while these cached files keep it usable.
      return cached;
    }
    const response = await fetch(request);
    if (response.ok) await cache.put(request, response.clone());
    return response;
  })());
});

self.addEventListener('push', event => {
  let data = {}; try { data = event.data?.json() || {}; } catch { data = { body: event.data?.text() || '' }; }
  const options = {
    body: data.body || '',
    icon: data.icon || '/favicon-192.png',
    badge: data.badge || '/favicon-32.png',
    data: { url: data.url || '/owner' },
  };
  if (data.image) options.image = data.image;
  if (data.tag) options.tag = data.tag;
  if ('vibrate' in self.navigator) options.vibrate = [200, 100, 200];
  event.waitUntil((async () => {
    const notification = self.registration.showNotification(data.title || 'StoYangu', options);
    if (String(data.tag || '').startsWith('inbox-')) {
      const storeId = Number(data.storeId);
      if (Number.isSafeInteger(storeId) && storeId > 0) {
        try {
          const windows = await self.clients.matchAll({ type: 'window', includeUncontrolled: true });
          for (const client of windows) client.postMessage({ type: 'stoyangu-inbox-update', storeId });
        } catch { /* Keep showing the notification if refreshing an open page fails. */ }
      }
    }
    await notification;
  })());
});

self.addEventListener('notificationclick', event => {
  event.notification.close();
  const target = new URL(event.notification.data?.url || '/owner', self.location.origin);
  if (target.origin !== self.location.origin) return;
  event.waitUntil((async () => {
    const windows = await self.clients.matchAll({ type: 'window', includeUncontrolled: true });
    const existing = windows.find(client => new URL(client.url).origin === self.location.origin);
    if (existing) {
      const focused = existing.navigate ? await existing.navigate(target.href) : existing;
      return focused?.focus();
    }
    return self.clients.openWindow(target.href);
  })());
});
