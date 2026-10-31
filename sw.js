// Offline support: network-first for the app shell, cache as fallback.
const CACHE = 'ppt-v1';
const CORE = [
  './',
  './index.html',
  './css/styles.css',
  './js/main.js',
  './js/i18n.js',
  './js/store.js',
  './js/rhythm.js',
  './js/audio.js',
  './js/transport.js',
  './js/scoring.js',
  './js/input.js',
  './js/lessons.js',
  './js/charts.js',
  './js/chant.js',
  './js/views/draw.js',
  './js/views/piano.js',
  './js/views/orbit.js',
  './js/views/timeline.js',
  './js/views/falling.js',
  './js/views/notation.js',
  './js/views/meter.js',
  './js/views/pulse.js',
  './assets/icon.svg',
  './manifest.webmanifest',
];

self.addEventListener('install', (e) => {
  e.waitUntil(caches.open(CACHE).then((c) => c.addAll(CORE)).then(() => self.skipWaiting()));
});

self.addEventListener('activate', (e) => {
  e.waitUntil(
    caches.keys()
      .then((keys) => Promise.all(keys.filter((k) => k !== CACHE).map((k) => caches.delete(k))))
      .then(() => self.clients.claim()),
  );
});

self.addEventListener('fetch', (e) => {
  const req = e.request;
  if (req.method !== 'GET') return;
  const url = new URL(req.url);
  const isFont = url.hostname === 'fonts.googleapis.com' || url.hostname === 'fonts.gstatic.com';
  if (url.origin !== location.origin && !isFont) return;
  e.respondWith(
    fetch(req)
      .then((res) => {
        if (res && (res.ok || res.type === 'opaque')) {
          const copy = res.clone();
          caches.open(CACHE).then((c) => c.put(req, copy));
        }
        return res;
      })
      .catch(() => caches.match(req, { ignoreSearch: true }).then((r) => r || caches.match('./index.html'))),
  );
});
