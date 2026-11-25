'use strict';
/* DynamFuel – IndexedDB 'dynamfuel-db' (same origin as DynamCore: own name, never touches other databases).
   Stores (keyPath 'id'): events (Intervals.icu events cache), rides (athlete choices + rides added by hand),
   items (own products and stock – Phase 3), plans (saved plans – Phase 3), logs (post-ride log – later).
   If IndexedDB is not available (some private modes) the data lives in memory for this visit only.

   Live and test site (decision T3): both sites are on the same github.io origin, so they would share localStorage and
   IndexedDB. The live site (/DynamFuel/, and /dynamfuel/ locally) keeps 'dynamfuel:' keys and 'dynamfuel-db'; any other site
   folder (e.g. /DynamFuelTest/) gets its own: 'dynamfuel:<site>:' keys and 'dynamfuel-<site>-db'. The first start of such a
   site copies the shared data once (DF_MIGRATED), so beta athletes keep their profile and stock. */
const DF_SITE = (() => { const s = (location.pathname.split('/')[1] || '').toLowerCase().replace(/[^a-z0-9]/g, ''); return s && s !== 'dynamfuel' ? s : ''; })();
const DF_PFX = DF_SITE ? `dynamfuel:${DF_SITE}:` : 'dynamfuel:';
const DF_MIGRATED = (() => {
  if (!DF_SITE) return false;
  try {
    if (localStorage.getItem(DF_PFX + 'settings') != null || localStorage.getItem(DF_PFX + 'copied') != null) return false;
    const old = Object.keys(localStorage).filter(k => /^dynamfuel:[^:]+$/.test(k));   // shared keys of the old layout
    old.forEach(k => { localStorage.setItem(DF_PFX + k.slice('dynamfuel:'.length), localStorage.getItem(k)); });
    localStorage.setItem(DF_PFX + 'copied', JSON.stringify(new Date().toISOString()));
    return old.length > 0;
  } catch (e) { return false; }
})();
const DB = (() => {
  const NAME = DF_SITE ? `dynamfuel-${DF_SITE}-db` : 'dynamfuel-db', VERSION = 1, STORES = ['events', 'rides', 'items', 'plans', 'logs'];
  let dbp = null, mem = null;
  function open() {
    if (dbp) return dbp;
    dbp = new Promise(res => {
      try {
        const rq = indexedDB.open(NAME, VERSION);
        rq.onupgradeneeded = () => { const d = rq.result; STORES.forEach(s => { if (!d.objectStoreNames.contains(s)) d.createObjectStore(s, { keyPath: 'id' }); }); };
        rq.onsuccess = () => res(rq.result);
        rq.onerror = () => { mem = {}; res(null); };
        rq.onblocked = () => { mem = {}; res(null); };
      } catch (e) { mem = {}; res(null); }
    });
    return dbp;
  }
  const m = s => (mem[s] = mem[s] || new Map());
  async function tx(store, mode, fn) {
    const d = await open();
    if (!d) return fn(null);
    return new Promise((res, rej) => {
      const t = d.transaction(store, mode), os = t.objectStore(store); let out;
      const r = fn(os); if (r && 'onsuccess' in r) r.onsuccess = () => { out = r.result; };
      t.oncomplete = () => res(out); t.onerror = () => rej(t.error); t.onabort = () => rej(t.error);
    });
  }
  return {
    STORES,
    all: s => tx(s, 'readonly', os => os ? os.getAll() : null).then(r => r || (mem ? [...m(s).values()] : [])),
    get: (s, id) => tx(s, 'readonly', os => os ? os.get(id) : null).then(r => r != null ? r : (mem ? m(s).get(id) : undefined)),
    put: (s, v) => tx(s, 'readwrite', os => os ? os.put(v) : (m(s).set(v.id, v), null)),
    del: (s, id) => tx(s, 'readwrite', os => os ? os.delete(id) : (m(s).delete(id), null)),
    clear: s => tx(s, 'readwrite', os => os ? os.clear() : (m(s).clear(), null)),
    /* replace a whole store in one transaction */
    replace: (s, list) => tx(s, 'readwrite', os => { if (!os) { m(s).clear(); list.forEach(v => m(s).set(v.id, v)); return null; } os.clear(); list.forEach(v => os.put(v)); return null; }),
    /* T3: copy every store of the shared 'dynamfuel-db' into this site's database (once, test site only; nothing is deleted) */
    async copyShared() {
      if (!DF_SITE) return 0;
      const old = await new Promise(res => {
        try {
          const rq = indexedDB.open('dynamfuel-db');
          rq.onupgradeneeded = () => { rq.transaction.abort(); };          // it did not exist: do not create it
          rq.onsuccess = () => res(rq.result); rq.onerror = () => res(null); rq.onblocked = () => res(null);
        } catch (e) { res(null); }
      });
      if (!old) return 0;
      let n = 0;
      for (const s of STORES) {
        if (!old.objectStoreNames.contains(s)) continue;
        const rows = await new Promise(res => { const rq = old.transaction(s, 'readonly').objectStore(s).getAll(); rq.onsuccess = () => res(rq.result || []); rq.onerror = () => res([]); });
        if (rows.length) { await this.replace(s, rows); n += rows.length; }
      }
      old.close();
      return n;
    },
    async drop() { const d = await open(); if (d) d.close(); dbp = null; mem = null; return new Promise(res => { try { const r = indexedDB.deleteDatabase(NAME); r.onsuccess = r.onerror = r.onblocked = () => res(); } catch (e) { res(); } }); }
  };
})();
