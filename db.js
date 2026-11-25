'use strict';
/* DynamFuel – IndexedDB 'dynamfuel-db' (same origin as DynamCore: own name, never touches other databases).
   Stores (keyPath 'id'): events (Intervals.icu events cache), rides (athlete choices + rides added by hand),
   items (own products and stock – Phase 3), plans (saved plans – Phase 3), logs (post-ride log – later).
   If IndexedDB is not available (some private modes) the data lives in memory for this visit only. */
const DB = (() => {
  const NAME = 'dynamfuel-db', VERSION = 1, STORES = ['events', 'rides', 'items', 'plans', 'logs'];
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
    async drop() { const d = await open(); if (d) d.close(); dbp = null; mem = null; return new Promise(res => { try { const r = indexedDB.deleteDatabase(NAME); r.onsuccess = r.onerror = r.onblocked = () => res(); } catch (e) { res(); } }); }
  };
})();
