/* DynamFuel service worker: works offline.
   After changing any file: raise VERSION so phones fetch the new version.
   Same origin as DynamCore (and as the DynamFuel test site): the cache name holds the site folder, and on activate only
   this site's old DynamFuel caches are deleted – never DynamCore's, never the other DynamFuel site's.
   An old DynamCore (before dynamcore-v17) may delete this cache once: the page then asks this worker to re-cache (message
   'recache'), and every successful network answer is cached again anyway. */
const VERSION = 'v9';
const SITE = (new URL(self.registration.scope).pathname.replace(/[^A-Za-z0-9]+/g, '-').replace(/^-|-$/g, '') || 'root').toLowerCase();
const PREFIX = `dynamfuel-${SITE}-`;
const CACHE = PREFIX + VERSION;
const CORE = ['./', 'index.html', 'app.js', 'i18n.js', 'fmt.js', 'workout.js', 'engine.js', 'match.js', 'rides.js', 'backup.js', 'db.js', 'weather.js', 'card.js', 'food.js', 'access.js', 'key.js',
  'manifest.webmanifest', 'data/rules.json', 'data/library.json', 'data/food.json', 'data/caffeine.json',
  'icons/icon-192.png', 'icons/icon-512.png', 'icons/icon-maskable-512.png', 'icons/apple-touch-icon.png', 'icons/logo-dark.png', 'icons/logo-light.png',
  'fonts/poppins-600.woff', 'fonts/poppins-700.woff', 'fonts/poppins-800.woff', 'fonts/inter-400.woff', 'fonts/inter-500.woff', 'fonts/inter-600.woff'];

/* GitHub Pages lets browsers keep files for 10 min (max-age=600). 'no-cache' makes every fetch ask GitHub whether the file
   changed (a short 304 answer when not), so a new version is used as soon as it is online – never an old copy. */
const fresh = u => new Request(u, { cache: 'no-cache', credentials: 'same-origin' });
const fill = () => caches.open(CACHE).then(c => Promise.all(CORE.map(u => fetch(fresh(u)).then(res => { if (!res.ok) throw new Error(u); return c.put(u, res); }))));
self.addEventListener('install', e => { e.waitUntil(fill().then(() => self.skipWaiting())); });
self.addEventListener('activate', e => {
  e.waitUntil(caches.keys().then(keys => Promise.all(keys.filter(k => k.startsWith(PREFIX) && k !== CACHE).map(k => caches.delete(k)))).then(() => self.clients.claim()));
});
/* 'recache' (sent by the page at every start): add the core files that are missing – e.g. after an old DynamCore wiped this cache */
const topUp = () => caches.open(CACHE).then(c => Promise.all(CORE.map(u => c.match(u).then(hit => hit || fetch(fresh(u)).then(res => res.ok && c.put(u, res)).catch(() => { })))));
self.addEventListener('message', e => { if (e.data === 'recache') e.waitUntil(topUp()); });
self.addEventListener('fetch', e => {
  const req = e.request;
  if (req.method !== 'GET') return;
  const url = new URL(req.url);
  if (url.origin !== location.origin || !url.pathname.startsWith(new URL(self.registration.scope).pathname)) return;   // Intervals.icu etc.: never cached
  e.respondWith(
    fetch(fresh(req.url)).then(res => { if (res.ok) { const copy = res.clone(); caches.open(CACHE).then(c => c.put(req, copy)); } return res; })
      .catch(() => caches.match(req, { ignoreSearch: true }).then(hit => hit || (req.mode === 'navigate' ? caches.match('index.html') : undefined)))
  );
});
