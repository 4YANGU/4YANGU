// WOYOYO-012: never cache API requests, authorization returns, or authenticated navigation.
const CACHE = 'stoyangu-static-v12';
self.addEventListener('install', () => self.skipWaiting());
self.addEventListener('activate', event => event.waitUntil((async () => { for (const key of await caches.keys()) if (key !== CACHE) await caches.delete(key); await self.clients.claim(); })()));
self.addEventListener('fetch', event => {
  const url = new URL(event.request.url);
  if (event.request.method !== 'GET' || url.origin !== self.location.origin || url.pathname.startsWith('/api/') || event.request.mode === 'navigate' || url.searchParams.has('oauth_state') || url.pathname.endsWith('.zip')) return;
  if (!/\.(png|jpg|jpeg|webp|svg|woff2)$/.test(url.pathname)) return;
  event.respondWith((async () => { const cached = await caches.match(event.request); if (cached) return cached; const response = await fetch(event.request); if (response.ok) { const cache = await caches.open(CACHE); await cache.put(event.request, response.clone()); } return response; })());
});
self.addEventListener('push', event => {
  let data = {}; try { data = event.data?.json() || {}; } catch { data = { body: event.data?.text() || '' }; }
  event.waitUntil(self.registration.showNotification(data.title || 'StoYangu', { body: data.body || '', icon: '/favicon-192.png', badge: '/favicon-32.png', data: { url: data.url || '/owner' } }));
});
self.addEventListener('notificationclick', event => { event.notification.close(); const target = new URL(event.notification.data?.url || '/owner', self.location.origin); if (target.origin !== self.location.origin) return; event.waitUntil(self.clients.openWindow(target.href)); });
