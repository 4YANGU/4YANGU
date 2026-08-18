const CACHE = 'stoyangu-app-v11';
const SHELL = '/';

// ---- Install: precache the app shell + core brand assets ----
self.addEventListener('install', (event) => {
  event.waitUntil(
    caches.open(CACHE)
      .then((cache) => cache.addAll([SHELL, '/manifest.webmanifest', '/stoyangu-logo.png', '/favicon-192.png', '/favicon-512.png', '/icon-maskable-512.png']))
      .catch(() => null)
  );
  self.skipWaiting();
});

// ---- Activate: clean old caches, take control ----
self.addEventListener('activate', (event) => {
  event.waitUntil(Promise.all([
    self.clients.claim(),
    caches.keys().then((keys) => Promise.all(keys.filter((key) => key !== CACHE).map((key) => caches.delete(key))))
  ]));
});

// ---- Fetch ----
self.addEventListener('fetch', (event) => {
  const request = event.request;
  if (request.method !== 'GET') return;
  const url = new URL(request.url);
  if (url.origin !== self.location.origin) return;

  // Never cache or intercept sensitive account/dashboard API calls.
  if (url.pathname.startsWith('/api/profile') || url.pathname.startsWith('/api/dashboard')) return;

  // App navigations: network-first. Each successful page is cached under its
  // OWN address, and any offline navigation falls back to that page or the
  // cached app shell — this keeps the installed app opening like a real app.
  if (request.mode === 'navigate') {
    event.respondWith(
      fetch(request)
        .then((response) => {
          if (response.ok && response.type === 'basic') {
            const copy = response.clone();
            caches.open(CACHE).then((cache) => cache.put(request, copy)).catch(() => null);
          }
          return response;
        })
        .catch(() => caches.match(request).then((cached) => cached || caches.match(SHELL)))
    );
    return;
  }

  // Live storefront data (existing behaviour).
  if (url.pathname === '/api/stores' && url.searchParams.get('storefront') === '1') {
    if (url.searchParams.get('fresh')) { event.respondWith(fetch(request)); return; }
    event.respondWith(
      fetch(request)
        .then((response) => {
          if (response.ok) { const copy = response.clone(); caches.open(CACHE).then((cache) => cache.put(request, copy)); }
          return response;
        })
        .catch(() => caches.match(request).then((cached) => cached || Promise.reject(new Error('offline'))))
    );
    return;
  }

  // Static assets (JS/CSS/images/manifest): cache-first, populate on the fly.
  if (
    url.pathname.startsWith('/images/') ||
    url.pathname.startsWith('/assets/') ||
    url.pathname.startsWith('/favicon') ||
    url.pathname === '/stoyangu-logo.png' ||
    url.pathname === '/icon-maskable-512.png' ||
    url.pathname === '/manifest.webmanifest' ||
    url.pathname.endsWith('.js') ||
    url.pathname.endsWith('.css') ||
    url.pathname.endsWith('.png') ||
    url.pathname.endsWith('.svg') ||
    url.pathname.endsWith('.webmanifest')
  ) {
    event.respondWith(
      caches.match(request).then((cached) => cached || fetch(request).then((response) => {
        if (response.ok) { const copy = response.clone(); caches.open(CACHE).then((cache) => cache.put(request, copy)); }
        return response;
      }))
    );
  }
});

// ---- Push notifications (daily update / instant order) ----
self.addEventListener('push', (event) => {
  let data = { title: 'StoYangu daily update', body: 'Your store update is ready.', url: '/owner' };
  try { data = { ...data, ...event.data.json() }; } catch {}
  const actions = [];
  if (data.winner) actions.push({ action: 'open', title: `Today's champion: ${data.winner}` });
  if (data.needs) actions.push({ action: 'open', title: `Needs a look: ${data.needs}` });
  event.waitUntil(self.registration.showNotification(data.title, {
    body: data.body,
    icon: data.icon || '/favicon-192.png',
    badge: '/favicon-32.png',
    image: data.image,
    actions,
    tag: data.tag || 'stoyangu-update',
    data: { url: data.url, product: data.product, customer_phone: data.customer_phone },
    vibrate: [120, 60, 120]
  }));
});

// ---- Notification click: focus/open the app ----
self.addEventListener('notificationclick', (event) => {
  event.notification.close();
  event.waitUntil(clients.matchAll({ type: 'window', includeUncontrolled: true }).then((list) => {
    for (const client of list) {
      if ('focus' in client) { client.navigate(event.notification.data.url || '/owner'); return client.focus(); }
    }
    return clients.openWindow(event.notification.data.url || '/owner');
  }));
});
