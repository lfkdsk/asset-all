/* Service Worker — Asset Tracker PWA */

const CACHE = 'asset-tracker-v5';

// CDN assets that rarely change — cache-first
const STATIC_ASSETS = [
  'https://cdn.jsdelivr.net/npm/chart.js@4/dist/chart.umd.min.js',
];

// App shell files — pre-cached on install
const APP_SHELL = [
  './',
  './index.html',
  './style.css',
  './app.js',
  './manifest.json',
  './icon.svg',
  './icon-180.png',
  './icon-192.png',
  './icon-512.png',
];

self.addEventListener('install', e => {
  e.waitUntil(
    caches.open(CACHE)
      .then(c => c.addAll([...APP_SHELL, ...STATIC_ASSETS]))
      .then(() => self.skipWaiting())
  );
});

self.addEventListener('activate', e => {
  e.waitUntil(
    caches.keys()
      .then(keys => Promise.all(keys.filter(k => k !== CACHE).map(k => caches.delete(k))))
      .then(() => self.clients.claim())
  );
});

self.addEventListener('fetch', e => {
  const url = new URL(e.request.url);

  // Network-first: GitHub API & exchange rate API (dynamic data)
  if (url.hostname === 'api.github.com' || url.hostname === 'api.frankfurter.dev') {
    e.respondWith(fetch(e.request).catch(() => caches.match(e.request)));
    return;
  }

  // Cache-first: CDN static assets (Chart.js, icon.horse logos, etc.)
  if (url.hostname.includes('jsdelivr.net') || url.hostname === 'icon.horse') {
    e.respondWith(
      caches.match(e.request).then(cached => cached || fetch(e.request).then(res => {
        if (res.ok && e.request.method === 'GET') {
          caches.open(CACHE).then(c => c.put(e.request, res.clone()));
        }
        return res;
      }))
    );
    return;
  }

  // Stale-while-revalidate: app shell (index.html, app.js, style.css …)
  // → Return cached version immediately, fetch update in background for next open
  e.respondWith(
    caches.open(CACHE).then(cache =>
      cache.match(e.request).then(cached => {
        const networkUpdate = fetch(e.request).then(res => {
          if (res.ok && e.request.method === 'GET') {
            cache.put(e.request, res.clone());
          }
          return res;
        }).catch(() => cached);

        return cached ?? networkUpdate;
      })
    )
  );
});
