'use strict';
/* DynamFuel – back-up, restore and data checks. Pure: no DOM, no storage, no Date.now.
   Back-up file: { app:'dynamfuel', schema, at 'YYYY-MM-DD', settings, profile, athlete, rides[], items[], plans[], logs[], icu? }
   - The Intervals.icu key is only in the file when the athlete chooses so (as in DynamCore).
   - Restore checks every field: a damaged value is replaced by an empty/default one and counted ("fixed"), so a damaged
     file never breaks the app. Older schemas are upgraded with MIGRATIONS[n] (schema n → n+1). */
(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory(require('./off.js')); else root.DFBackup = factory(root.DFOff);
})(typeof self !== 'undefined' ? self : this, function (OFF) {
  const SCHEMA = 1;
  const EU14 = ['gluten', 'crustaceans', 'eggs', 'fish', 'peanuts', 'soy', 'milk', 'nuts', 'celery', 'mustard', 'sesame', 'sulphites', 'lupin', 'molluscs'];
  const HEALTH = ['diabetes', 'gi', 'pregnancy', 'eating'];
  // MIGRATIONS[n] upgrades a back-up of schema n to n+1. Schema 1 is the first; later versions add steps here.
  const MIGRATIONS = [];

  const isHHMM = x => typeof x === 'string' && /^([01]\d|2[0-3]):[0-5]\d$/.test(x);
  const isIso = x => typeof x === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(x) && !isNaN(Date.parse(x + 'T00:00:00Z')) && new Date(x + 'T00:00:00Z').toISOString().slice(0, 10) === x;
  const numIn = (x, lo, hi) => x !== null && x !== '' && x !== undefined && isFinite(+x) && +x >= lo && +x <= hi;

  function defaultProfile() {
    return { birthYear: null, massKg: null, ftpW: null, lt1W: null, gutCapGph: null, gutTrained: false, sweatRateLph: null, salty: 'unknown',
      caffeine: 'none', bedtime: null, bottleMl: null, cages: null, allergens: [], avoidTraces: true, healthFlags: [], healthAck: false,
      disclaimerAck: false, sweatTestPrompted: false, src: {} };
  }
  function defaultSettings() { return { lang: 'nl', usualStart: null, onboarded: false }; }

  /* check one profile; returns { p, fixed } – unknown keys are dropped, damaged values reset */
  function checkProfile(src, year) {
    const d = defaultProfile(), p = {}; let fixed = 0;
    const s = src && typeof src === 'object' && !Array.isArray(src) ? src : (fixed++, {});
    const take = (k, ok, val) => { if (s[k] === undefined || s[k] === null) { p[k] = d[k]; return; } if (ok) p[k] = val; else { p[k] = d[k]; fixed++; } };
    const y = year || 2100;
    take('birthYear', Number.isInteger(+s.birthYear) && numIn(s.birthYear, 1900, y), +s.birthYear);
    take('massKg', numIn(s.massKg, 30, 200), +s.massKg);
    take('ftpW', numIn(s.ftpW, 50, 600), +s.ftpW);
    take('lt1W', numIn(s.lt1W, 30, 600), +s.lt1W);
    take('gutCapGph', numIn(s.gutCapGph, 0, 120), +s.gutCapGph);
    take('gutTrained', typeof s.gutTrained === 'boolean', s.gutTrained);
    take('sweatRateLph', numIn(s.sweatRateLph, 0.1, 4), +s.sweatRateLph);
    take('salty', ['yes', 'no', 'unknown'].includes(s.salty), s.salty);
    take('caffeine', ['none', 'low', 'normal'].includes(s.caffeine), s.caffeine);
    take('bedtime', isHHMM(s.bedtime), s.bedtime);
    take('bottleMl', numIn(s.bottleMl, 250, 1500), Math.round(+s.bottleMl));
    take('cages', Number.isInteger(+s.cages) && numIn(s.cages, 0, 4), +s.cages);
    take('allergens', Array.isArray(s.allergens) && s.allergens.every(a => EU14.includes(a)), Array.isArray(s.allergens) ? s.allergens.slice() : []);
    take('avoidTraces', typeof s.avoidTraces === 'boolean', s.avoidTraces);
    take('healthFlags', Array.isArray(s.healthFlags) && s.healthFlags.every(a => HEALTH.includes(a)), Array.isArray(s.healthFlags) ? s.healthFlags.slice() : []);
    ['healthAck', 'disclaimerAck', 'sweatTestPrompted'].forEach(k => take(k, typeof s[k] === 'boolean', s[k]));
    take('src', s.src && typeof s.src === 'object' && !Array.isArray(s.src), Object.assign({}, s.src));
    return { p, fixed };
  }
  function checkSettings(src) {
    const d = defaultSettings(), s = src && typeof src === 'object' && !Array.isArray(src) ? src : {}; let fixed = src && typeof src === 'object' ? 0 : 1;
    const out = {};
    out.lang = ['nl', 'en'].includes(s.lang) ? s.lang : (s.lang !== undefined && fixed++, d.lang);
    out.usualStart = s.usualStart == null ? null : isHHMM(s.usualStart) ? s.usualStart : (fixed++, null);
    // back-up reminder (polish B2): dates as YYYY-MM-DD
    ['firstUse', 'lastBackup', 'backupSnooze'].forEach(k => { if (s[k] != null) { if (isIso(s[k])) out[k] = s[k]; else fixed++; } });
    out.onboarded = typeof s.onboarded === 'boolean' ? s.onboarded : d.onboarded;
    if (s.icuWrite != null) { if (typeof s.icuWrite === 'boolean') out.icuWrite = s.icuWrite; else fixed++; }   // Phase 4: off unless switched on
    // town for the forecast (P3-4): name + rounded coordinates only
    const L = s.location;
    if (L != null) {
      if (L && typeof L === 'object' && typeof L.name === 'string' && L.name.length <= 100 && numIn(L.lat, -90, 90) && numIn(L.lon, -180, 180))
        out.location = { name: L.name, region: typeof L.region === 'string' ? L.region.slice(0, 120) : '', lat: +L.lat, lon: +L.lon };
      else fixed++;
    }
    return { s: out, fixed };
  }
  function checkAthlete(a) {
    if (!a || typeof a !== 'object') return null;
    const z = Array.isArray(a.zones) && a.zones.length >= 3 && a.zones.every(x => isFinite(+x)) ? a.zones.map(Number) : null;
    return { weightKg: numIn(a.weightKg, 30, 200) ? +a.weightKg : null, ftp: numIn(a.ftp, 50, 600) ? +a.ftp : null, indoorFtp: numIn(a.indoorFtp, 50, 600) ? +a.indoorFtp : null,
      zones: z, ssMin: numIn(a.ssMin, 50, 120) ? +a.ssMin : null, ssMax: numIn(a.ssMax, 50, 120) ? +a.ssMax : null, fetchedAt: typeof a.fetchedAt === 'string' ? a.fetchedAt : null };
  }
  /* a ride record: the athlete's choices for an Intervals.icu ride (id 'icu-…') or a ride added by hand (id 'man-…') */
  function checkRide(r) {
    if (!r || typeof r !== 'object' || typeof r.id !== 'string' || !/^(icu|man)-[\w-]+$/.test(r.id)) return null;
    const o = { id: r.id };
    if (r.goal != null) { if (!['race', 'key', 'endurance', 'recovery'].includes(r.goal)) return null; o.goal = r.goal; }
    if (r.indoor != null) { if (typeof r.indoor !== 'boolean') return null; o.indoor = r.indoor; }
    if (r.start != null) { if (!isHHMM(r.start)) return null; o.start = r.start; }
    if (r.tempC != null) { if (!numIn(r.tempC, -30, 50)) return null; o.tempC = +r.tempC; }
    if (r.refillMin != null) { if (![0, 60, 90, 120].includes(+r.refillMin)) return null; o.refillMin = +r.refillMin; }
    if (r.next8h != null) { if (typeof r.next8h !== 'boolean') return null; o.next8h = r.next8h; }
    if (r.sent != null) {   // Phase 4: what DynamFuel last wrote to Intervals.icu for this ride
      if (!(r.sent && typeof r.sent.hash === 'string' && typeof r.sent.at === 'string' && (r.sent.carbs == null || Number.isInteger(r.sent.carbs)))) return null;
      o.sent = { hash: r.sent.hash, at: r.sent.at, carbs: r.sent.carbs ?? null };
    }
    if (r.used != null) {   // UX #19: what was taken off the stock for this ride (to undo it, and to keep this ride's plan)
      const u = r.used, okItem = x => x && typeof x.id === 'string' && Number.isInteger(x.from) && Number.isInteger(x.to) && x.from >= x.to && x.to >= 0;
      if (!(u && typeof u.at === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(u.at) && Array.isArray(u.items) && u.items.length <= 50 && u.items.every(okItem))) return null;
      o.used = { at: u.at, items: u.items.map(x => ({ id: x.id, from: x.from, to: x.to })) };
    }
    if (r.planKind != null) { if (!['drinkOnly', 'drinkAndFood', 'withoutDrink'].includes(r.planKind)) return null; o.planKind = r.planKind; }
    if (r.id.startsWith('man-')) {
      if (!isIso(r.date) || !numIn(r.durationS, 600, 12 * 3600) || typeof (r.name ?? '') !== 'string') return null;
      Object.assign(o, { date: r.date, durationS: Math.round(+r.durationS), name: String(r.name || '') });
    }
    return o;
  }

  /* a stock record: { id, qty 0–999, fav, hidden } for a library product (own products come later in Phase 3) */
  function checkStock(s) {
    if (!s || typeof s !== 'object' || typeof s.id !== 'string' || !/^[a-z0-9][a-z0-9-]*$/.test(s.id)) return null;
    if (!(Number.isInteger(s.qty) && s.qty >= 0 && s.qty <= 999)) return null;
    const o = { id: s.id, qty: s.qty, fav: s.fav === true, hidden: s.hidden === true };
    // own product (P3-5): id own-…, the product itself checked like the form does
    if (s.id.startsWith('own-') || s.own != null) { const own = OFF && OFF.checkOwn(s.own); if (!own || !/^own-[a-z0-9]+$/.test(s.id)) return null; o.own = own; }
    // real food: the athlete's weight per part in g (null = not entered)
    if (s.grams != null) { if (!Array.isArray(s.grams) || s.grams.length > 5 || !s.grams.every(g => g === null || (typeof g === 'number' && g > 0 && g <= 1000))) return null; o.grams = s.grams.slice(); }
    return o;
  }

  function make(data, at) {
    const o = { app: 'dynamfuel', schema: SCHEMA, at, settings: data.settings || defaultSettings(), profile: data.profile || defaultProfile(), athlete: data.athlete || null,
      rides: data.rides || [], items: data.items || [], plans: data.plans || [], logs: data.logs || [] };
    if (data.icu && data.icu.key) o.icu = { key: String(data.icu.key), athleteId: String(data.icu.athleteId || '') };
    return o;
  }

  /* check a parsed back-up; returns { ok, why } or { ok:true, data, fixed, at } */
  function check(o, year) {
    if (!o || typeof o !== 'object' || o.app !== 'dynamfuel') return { ok: false, why: 'format' };
    let schema = Number.isInteger(o.schema) ? o.schema : 0;
    if (schema > SCHEMA) return { ok: false, why: 'newer' };
    if (schema < 1) return { ok: false, why: 'format' };
    let x = JSON.parse(JSON.stringify(o));
    while (schema < SCHEMA) { x = MIGRATIONS[schema](x); schema++; }
    const pr = checkProfile(x.profile, year), se = checkSettings(x.settings);
    let fixed = pr.fixed + se.fixed;
    const list = (a, fn) => { if (!Array.isArray(a)) { if (a !== undefined) fixed++; return []; } const out = a.map(fn).filter(Boolean); fixed += a.length - out.length; return out; };
    const rides = list(x.rides, checkRide);
    const items = list(x.items, checkStock);
    const plans = list(x.plans, p => p && typeof p === 'object' && typeof p.id === 'string' ? p : null);
    const logs = list(x.logs, l => l && typeof l === 'object' ? l : null);
    const icu = x.icu && typeof x.icu.key === 'string' && x.icu.key.trim() ? { key: x.icu.key.trim(), athleteId: String(x.icu.athleteId || '').trim() } : null;
    return { ok: true, fixed, at: isIso(x.at) ? x.at : null,
      data: { settings: se.s, profile: pr.p, athlete: checkAthlete(x.athlete), rides, items, plans, logs, icu } };
  }

  return { SCHEMA, EU14, HEALTH, MIGRATIONS, defaultProfile, defaultSettings, checkProfile, checkSettings, checkAthlete, checkRide, checkStock, make, check, isHHMM, isIso };
});
