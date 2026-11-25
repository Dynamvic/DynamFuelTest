/* DynamCore service worker: works offline.
   After changing any file: raise VERSION so phones fetch the new version. */
const VERSION = 'dynamcore-v17';
const CORE = ['./', 'index.html', 'app.js', 'done.js', 'engine.js', 'anim.js', 'group.js', 'access.js', 'key.js', 'coach.html', 'exercises.js', 'i18n.js', 'manifest.webmanifest',
  'icons/icon-192.png', 'icons/icon-512.png', 'icons/apple-touch-icon.png', 'icons/logo-dark.png', 'icons/logo-light.png',
  'fonts/poppins-600.woff', 'fonts/poppins-700.woff', 'fonts/poppins-800.woff', 'fonts/inter-400.woff', 'fonts/inter-500.woff', 'fonts/inter-600.woff'];

self.addEventListener('install', e => {
  e.waitUntil(caches.open(VERSION).then(c => c.addAll(CORE)).then(() => self.skipWaiting()));
});
self.addEventListener('activate', e => {
  /* Delete only DynamCore's own old caches: other apps on the same github.io domain (e.g. DynamFuel) keep theirs. */
  e.waitUntil(caches.keys().then(keys => Promise.all(keys.filter(k => k.startsWith('dynamcore-') && k !== VERSION).map(k => caches.delete(k)))).then(() => self.clients.claim()));
});
self.addEventListener('fetch', e => {
  const req = e.request;
  if (req.method !== 'GET') return;
  const url = new URL(req.url);
  if (url.origin !== location.origin) return;
  e.respondWith(
    fetch(req).then(res => { if (res.ok) { const copy = res.clone(); caches.open(VERSION).then(c => c.put(req, copy)); } return res; })
      .catch(() => caches.match(req).then(hit => hit || (req.mode === 'navigate' ? caches.match('index.html') : undefined)))
  );
});
