'use strict';
/* DynamFuel – user interface (Phase 2: onboarding, profile, Intervals.icu read, rides, targets, back-up, About).
   Logic lives in the pure modules: workout.js (parser), engine.js (targets), rides.js (events → rides), backup.js (checks).
   Storage: localStorage keys 'dynamfuel:*' (settings, profile, icu, athlete, meta) and IndexedDB 'dynamfuel-db' (db.js).
   Everything stays on this phone; the only network calls go to Intervals.icu with the athlete's own key. */

const APP_VERSION = '0.3.6';
const $ = (s, r = document) => r.querySelector(s);
const esc = s => String(s ?? '').replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
const clone = o => JSON.parse(JSON.stringify(o));
const F = DFFmt, W = DFWorkout, E = DFEngine, RD = DFRides, BK = DFBackup;

/* ---------- storage ---------- */
const store = {
  get(k, d) { try { const v = localStorage.getItem('dynamfuel:' + k); return v == null ? d : JSON.parse(v); } catch (e) { return d; } },
  set(k, v) { try { localStorage.setItem('dynamfuel:' + k, JSON.stringify(v)); } catch (e) { } },
  del(k) { try { localStorage.removeItem('dynamfuel:' + k); } catch (e) { } }
};
const pad = n => String(n).padStart(2, '0');
const todayIso = () => { const d = new Date(); return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`; };
const thisYear = () => new Date().getFullYear();

let SET = BK.checkSettings(store.get('settings', null)).s;
let P = BK.checkProfile(store.get('profile', null), thisYear()).p;
let ICU = Object.assign({ key: '', athleteId: '' }, store.get('icu', {}));
let ATH = BK.checkAthlete(store.get('athlete', null));
let META = store.get('meta', {}) || {};
const DATA = { rules: null, library: null, err: false };
let EVENTS = [];               // Intervals.icu events (cache in IndexedDB)
const RIDES = new Map();       // athlete choices per ride + rides added by hand (IndexedDB 'rides')
const STOCK = new Map();       // per product: { id, qty, fav, hidden } (IndexedDB 'items')
const UI = { wz: null, wzErr: '', err: {}, fetching: false, fetchErr: '', icuMsg: '', icuBad: false, add: null, restore: null };
const saveSet = () => store.set('settings', SET);
const saveP = () => store.set('profile', P);
const saveIcu = () => store.set('icu', ICU);

/* ---------- texts ---------- */
const lang = () => SET.lang || 'nl';
function t(k, v) {
  const D = DFI18N[lang()] || DFI18N.nl;
  const s = D[k] !== undefined ? D[k] : DFI18N.nl[k];
  if (s === undefined) return k;
  if (typeof s !== 'string' || !v) return s;
  return s.replace(/\{(\w+)\}/g, (m, n) => v[n] != null ? v[n] : m);
}
/* numbers in the UI: comma decimal, at most 2 decimals; arrays as a range */
function ns(x) {
  if (x == null || x === '') return '';
  if (Array.isArray(x)) return x.map(ns).join('–');
  if (typeof x === 'number') return String(Math.round(x * 100) / 100).replace('.', ',');
  return String(x);
}
function ruleText(id) {
  const r = DATA.rules.rules[id], k = 'r_' + id, s = t(k);
  if (s === k) return r ? r.title : id;
  return s.replace(/\{(\w+)\}/g, (m, n) => r && r[n] != null ? ns(r[n]) : m);
}
const dayLabel = iso => {
  if (iso === todayIso()) return t('today');
  if (iso === RD.addDays(todayIso(), 1)) return t('tomorrow');
  return `${t('daysF')[new Date(iso + 'T12:00:00').getDay()]} ${F.date(iso)}`;
};
const minor = D => !!(D.birthYear && DATA.rules && (thisYear() - D.birthYear) <= DATA.rules.rules['CAF-04'].minAge);

/* ---------- small UI parts ---------- */
const IC = {
  back: '<svg viewBox="0 0 24 24"><path d="M15 18l-6-6 6-6"/></svg>',
  x: '<svg viewBox="0 0 24 24"><path d="M6 6l12 12M18 6L6 18"/></svg>',
  refresh: '<svg viewBox="0 0 24 24"><path d="M20 11a8 8 0 1 0-2.3 5.7M20 4v7h-7"/></svg>',
  plus: '<svg viewBox="0 0 24 24"><path d="M12 5v14M5 12h14"/></svg>'
};
const topbar = (title, backHash) => `<header class="topbar">${backHash ? `<a class="iconbtn" href="${backHash}" aria-label="${t('back')}">${IC.back}</a>` : ''}<h1>${esc(title)}</h1></header>`;
const brandbar = () => `<header class="topbar brandline"><img src="icons/icon-192.png" alt=""><div><b>DynamFuel</b><small class="muted">${t('app_sub')}</small></div></header>`;
const statusPill = st => st === 'open' ? `<span class="pill open">${t('open_badge')}</span>` : '';
const target = () => UI.wz ? UI.wz.d : P;
const RANGES = () => ({ birthYear: [1900, thisYear()], massKg: [30, 200], ftpW: [50, 600], lt1W: [30, 600], gutCapGph: [0, 120], sweatRateLph: [0.1, 4], bottleMl: [250, 1500] });

function numField(f, label, unit, hint) {
  const v = target()[f];
  return `<div class="fld"><label class="lbl" for="f-${f}">${label}</label><span class="tin"><input id="f-${f}" type="text" inputmode="${f === 'birthYear' ? 'numeric' : 'decimal'}" data-f="${f}" value="${esc(ns(v))}" autocomplete="off"><span>${unit}</span></span>
    ${hint ? `<small class="muted">${hint}</small>` : ''}<span class="err" role="alert">${UI.err[f] || ''}</span></div>`;
}
function timeField(f, label, hint) {
  const v = target()[f];
  return `<div class="fld"><label class="lbl" for="f-${f}">${label}</label><span class="tin time"><input id="f-${f}" type="time" data-f="${f}" data-kind="time" value="${esc(v || '')}"></span>${hint ? `<small class="muted">${hint}</small>` : ''}</div>`;
}
/* chips that set one value: opts = [[value, label]]; type n (number), b (boolean), s (string) */
function chips(f, opts, cur, type, act = 'setf', label) {
  return `<div class="chips" role="group"${label ? ` aria-label="${esc(label)}"` : ''}>${opts.map(([v, l]) => `<button type="button" class="chip" data-act="${act}" data-f="${f}" data-v="${esc(String(v))}" data-t="${type}" aria-pressed="${cur === v}">${l}</button>`).join('')}</div>`;
}
const multi = (f, opts, cur) => `<div class="chips" role="group">${opts.map(([v, l]) => `<button type="button" class="chip" data-act="togf" data-f="${f}" data-v="${v}" aria-pressed="${(cur || []).includes(v)}">${l}</button>`).join('')}</div>`;
const check = (f, label) => `<label class="check"><input type="checkbox" data-f="${f}"${target()[f] ? ' checked' : ''}><span>${label}</span></label>`;
const castV = (v, ty) => ty === 'n' ? (v === 'null' ? null : +v) : ty === 'b' ? v === 'true' : v;

/* ---------- profile sections (wizard and profile screen) ---------- */
function secHealth() {
  const D = target(), flags = D.healthFlags || [], doc = flags.length || minor(D);
  return `<p>${t('disclaimer')}</p>${check('disclaimerAck', t('disclaimer_ack'))}
    ${numField('birthYear', t('birthYear'), '')}
    <div class="fld"><span class="lbl">${t('health_q')}</span>${multi('healthFlags', BK.HEALTH.map(h => [h, t('h_' + h)]), flags)}</div>
    ${doc ? `<div class="card warnc"><p>${flags.length ? t('health_doc') : ''} ${minor(D) ? t('minor_doc') : ''}</p>${check('healthAck', t('health_ack'))}</div>` : ''}`;
}
function athCard() {
  if (!ATH || !(ATH.weightKg || ATH.ftp)) return '';
  return `<div class="card notice"><p class="small">${t('icu_ath', { w: ATH.weightKg ? ns(ATH.weightKg) : '–', f: ATH.ftp || '–' })}</p>
    <div class="row"><button class="btn" data-act="useath">${t('icu_ath_use')}</button></div></div>`;
}
const secBody = () => `<p class="small muted">${t('body_why')}</p>${numField('massKg', t('massKg'), 'kg')}${numField('ftpW', t('ftpW'), 'W', t('ftp_hint'))}${numField('lt1W', t('lt1W') + ` (${t('optional')})`, 'W')}${athCard()}`;
const secGut = () => `${numField('gutCapGph', t('gutCapGph'), lang() === 'en' ? 'g/h' : 'g/u', t('gut_hint'))}${check('gutTrained', t('gutTrained'))}`;
function secSweat() {
  const D = target();
  return `${numField('sweatRateLph', t('sweatRateLph'), lang() === 'en' ? 'l/h' : 'l/u', D.sweatRateLph == null ? t('sweat_unknown') : '')}
    <details class="inl"><summary>${t('sweat_test_t')}</summary><p class="small">${t('sweat_test')}</p></details>
    <div class="fld"><span class="lbl">${t('salty')}</span>${chips('salty', [['yes', t('yes')], ['no', t('no')], ['unknown', t('unknown')]], D.salty, 's')}</div>`;
}
function secCaf() {
  const D = target();
  if (minor(D)) return `<p>${t('caf_off_minor')}</p>`;
  return `<div class="fld"><span class="lbl">${t('caffeine')}</span>${chips('caffeine', [['none', t('caf_none')], ['low', t('caf_low')], ['normal', t('caf_normal')]], D.caffeine, 's')}</div>
    ${D.caffeine !== 'none' ? timeField('bedtime', t('bedtime')) : ''}<p class="small muted">${t('caf_hint')}</p>`;
}
function secBottle() {
  const D = target();
  return `<div class="fld"><span class="lbl">${t('bottleMl')}</span>${chips('bottleMl', [[500, '500 ml'], [600, '600 ml'], [750, '750 ml'], [950, '950 ml']], D.bottleMl, 'n')}</div>
    ${numField('bottleMl', '', 'ml')}
    <div class="fld"><span class="lbl">${t('cages')}</span>${chips('cages', [[0, '0'], [1, '1'], [2, '2'], [3, '3']], D.cages, 'n')}</div>`;
}
const secAllergy = () => `<p>${t('allergy_q')}</p>${multi('allergens', BK.EU14.map(a => [a, t('a_' + a)]), target().allergens)}${check('avoidTraces', t('avoidTraces'))}`;

/* ---------- Intervals.icu ---------- */
function dynamCoreKey() {
  try { const p = JSON.parse(localStorage.getItem('dc:profile') || 'null'); const k = p && String(p.icuKey || '').trim(); return k ? { key: k, athleteId: String(p.icuId || '').trim() } : null; } catch (e) { return null; }
}
function secIcu() {
  const dc = dynamCoreKey();
  return `${dc && !ICU.key ? `<div class="card notice"><p class="small">${t('icu_dc_l')}</p><div class="row"><button class="btn primary" data-act="icudc">${t('icu_dc')}</button></div></div>` : ''}
    <div class="fld"><label class="lbl" for="icukey">${t('icu_key')}</label><input id="icukey" type="password" autocomplete="off" data-icu="key" value="${esc(ICU.key)}"><small class="muted">${t('icu_where')}</small></div>
    <div class="fld"><label class="lbl" for="icuid">${t('icu_id')} (${t('optional')})</label><input id="icuid" type="text" autocomplete="off" data-icu="athleteId" value="${esc(ICU.athleteId)}" placeholder="0"><small class="muted">${t('icu_id_hint')}</small></div>
    <div class="row"><button class="btn" data-act="icutest">${t('icu_test')}</button>${ICU.key && !UI.wz ? `<button class="btn danger" data-act="icuforget">${t('icu_forget')}</button>` : ''}</div>
    <p class="msg${UI.icuBad ? ' bad' : ''}" role="status">${esc(UI.icuMsg)}</p>`;
}
async function icuFetch(path) {
  const key = String(ICU.key || '').trim(), id = String(ICU.athleteId || '').trim() || '0';
  if (!key) throw { code: 'nokey' };
  let res;
  try { res = await fetch(`https://intervals.icu/api/v1/athlete/${encodeURIComponent(id)}${path}`, { headers: { Authorization: 'Basic ' + btoa('API_KEY:' + key) } }); }
  catch (e) { throw { code: 'blocked' }; }
  if (res.status === 401 || res.status === 403) throw { code: 'auth' };
  if (!res.ok) throw { code: 'http', status: res.status };
  return res.json();
}
const icuError = e => e.code === 'nokey' ? t('icu_err_nokey') : e.code === 'auth' ? t('icu_err_auth') : e.code === 'blocked' ? t('icu_err_blocked') : t('icu_err_http', { s: e.status || '?' });
async function icuAthlete() {
  const a = await icuFetch('');
  ATH = BK.checkAthlete(RD.athleteSummary(a, new Date().toISOString())); store.set('athlete', ATH);
  const D = target();                                                     // fill only what is still empty (editable later)
  if (D.massKg == null && ATH.weightKg) { D.massKg = ATH.weightKg; D.src = Object.assign({}, D.src, { mass: 'icu' }); }
  if (D.ftpW == null && ATH.ftp) { D.ftpW = ATH.ftp; D.src = Object.assign({}, D.src, { ftp: 'icu' }); }
  if (!UI.wz) saveP();
  return a;
}
async function icuTest() {
  UI.icuMsg = t('loading'); UI.icuBad = false; rerender();
  try { const a = await icuAthlete(); const nm = a.name || a.firstname || ''; UI.icuMsg = t('icu_ok', { n: nm ? ` – ${nm}` : '' }); saveIcu(); }
  catch (e) { UI.icuMsg = icuError(e); UI.icuBad = true; }
  rerender();
}
const slimEvent = e => ({ id: e.id, start_date_local: e.start_date_local, type: e.type, category: e.category, name: e.name, description: e.description, moving_time: e.moving_time,
  icu_training_load: e.icu_training_load, tags: e.tags, indoor: e.indoor, carbs_per_hour: e.carbs_per_hour, icu_ftp: e.icu_ftp,
  workout_doc: e.workout_doc ? { steps: e.workout_doc.steps || [], duration: e.workout_doc.duration || 0 } : null });
async function fetchRides(quiet) {
  if (UI.fetching || !ICU.key) return;
  UI.fetching = true; UI.fetchErr = ''; if (!quiet) rerender();
  try {
    const from = todayIso(), to = RD.addDays(from, 14);
    const evs = await icuFetch(`/events?oldest=${from}&newest=${to}`);
    EVENTS = (Array.isArray(evs) ? evs : []).filter(e => e && e.id != null).map(slimEvent);
    await DB.replace('events', EVENTS);
    try { await icuAthlete(); } catch (e) { }
    META.fetchedAt = new Date().toISOString(); store.set('meta', META);
  } catch (e) { UI.fetchErr = e.code === 'blocked' ? t('rides_offline') : icuError(e); }
  UI.fetching = false;
  if (/^#(rides|ride\/)/.test(location.hash || '#rides')) rerender();
}

/* ---------- wizard ---------- */
const WZ = ['lang', 'health', 'body', 'gut', 'sweat', 'caf', 'bottle', 'allergy', 'icu'];
const WZT = { lang: 'wz_lang_t', health: 'wz_health_t', body: 'wz_body_t', gut: 'wz_gut_t', sweat: 'wz_sweat_t', caf: 'wz_caf_t', bottle: 'wz_bottle_t', allergy: 'wz_allergy_t', icu: 'wz_icu_t' };
function vWizard() {
  if (!UI.wz) UI.wz = { i: 0, d: clone(P) };
  const st = WZ[UI.wz.i], n = WZ.length, i = UI.wz.i;
  let body = '';
  if (st === 'lang') body = `<img class="logo-big" src="icons/icon-512.png" alt="DynamFuel" width="260" height="260"><p class="lead">${t('wz_lang_l')}</p>
    <div class="fld"><span class="lbl">${t('wz_lang_q')}</span>${chips('lang', [['nl', 'Nederlands'], ['en', 'English']], lang(), 's', 'lang')}</div>`;
  if (st === 'health') body = secHealth();
  if (st === 'body') body = secBody();
  if (st === 'gut') body = secGut();
  if (st === 'sweat') body = secSweat();
  if (st === 'caf') body = secCaf();
  if (st === 'bottle') body = secBottle();
  if (st === 'allergy') body = secAllergy();
  if (st === 'icu') body = `<p class="lead">${t('wz_icu_l')}</p>${secIcu()}`;
  return `<div class="wz"><div class="eyebrow">${t('wz_step', { i: i + 1, n })}</div><div class="wzbar"><i style="width:${Math.round((i + 1) / n * 100)}%"></i></div>
    <h1 class="h1">${t(WZT[st])}</h1>${body}${UI.wzErr ? `<p class="err" role="alert">${UI.wzErr}</p>` : ''}
    <div class="wznav">${i ? `<button class="btn" data-act="wzback">${t('back')}</button>` : '<span></span>'}
      ${i < n - 1 ? `<button class="btn primary" data-act="wznext">${t('next')}</button>` : `<button class="btn primary" data-act="wzfinish">${t('wz_finish')}</button>`}</div></div>`;
}
function wzCheck() {
  const D = UI.wz.d, st = WZ[UI.wz.i];
  if (Object.keys(UI.err).length) return t('err_req');
  if (st === 'health' && (!D.disclaimerAck || !D.birthYear || ((D.healthFlags.length || minor(D)) && !D.healthAck))) return t('err_req');
  if (st === 'body' && !D.massKg) return t('err_req');
  if (st === 'bottle' && (!D.bottleMl || D.cages == null)) return t('err_req');
  return '';
}

/* ---------- rides ---------- */
function allRides() {
  const td = todayIso();
  const icu = EVENTS.filter(RD.isRide).map(RD.eventToRide);
  const man = [...RIDES.values()].filter(r => r.id.startsWith('man-')).map(r => ({ id: r.id, source: 'man', type: 'Ride', name: r.name || t('g_' + (r.goal || 'endurance')),
    date: r.date, time: r.start || null, durationS: r.durationS, structured: false, steps: null, tags: [], goalTag: null, indoor: r.indoor ?? null }));
  return [...icu, ...man].filter(r => r.date && r.date >= td).sort((a, b) => (a.date + (a.time || '99')).localeCompare(b.date + (b.time || '99')));
}
function vRides() {
  const list = allRides(), skipped = EVENTS.filter(e => !RD.isRide(e)).length;
  const upd = META.fetchedAt ? (() => { const d = new Date(META.fetchedAt); return t('rides_updated', { d: F.date(`${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`), t: `${pad(d.getHours())}:${pad(d.getMinutes())}` }); })() : '';
  let html = brandbar() + installCard();
  html += `<section class="card"><div class="row between"><div><h2>${t('rides_t')}</h2><small class="muted">${t('rides_window')}</small></div>
    ${ICU.key ? `<button class="iconbtn" data-act="fetch" aria-label="${t('rides_refresh')}"${UI.fetching ? ' disabled' : ''}>${IC.refresh}</button>` : ''}</div>
    ${UI.fetching ? `<p class="small muted" role="status">${t('loading')}</p>` : upd ? `<small class="muted">${upd}</small>` : ''}
    ${UI.fetchErr ? `<p class="msg bad" role="alert">${esc(UI.fetchErr)}</p>` : ''}</section>`;
  if (!ICU.key) html += `<section class="card notice"><p>${t('rides_connect')}</p><div class="row"><a class="btn primary" href="#settings">${t('rides_connect_btn')}</a></div></section>`;
  if (!list.length && ICU.key && !UI.fetching) html += `<p class="muted">${t('rides_none')}</p>`;
  let day = '';
  list.forEach(r => {
    if (r.date !== day) { day = r.date; html += `<div class="dayh">${esc(dayLabel(r.date))}</div>`; }
    const C = RIDES.get(r.id) || {}, io = C.indoor != null ? C.indoor : r.indoor;
    html += `<a class="ride" href="#ride/${encodeURIComponent(r.id)}"><b>${esc(r.name || t('g_endurance'))}</b>
      <span class="meta"><span class="tabular">${esc(C.start || r.time || t('no_time'))}</span><span class="tabular">${r.durationS ? F.dur(r.durationS) : ''}</span>
      <span>${io === true ? t('indoor') : io === false ? t('outdoor') : t('io_unknown')}</span>
      ${r.goalTag ? `<span class="pill acc">${esc(r.goalTag)}</span>` : ''}${r.source === 'man' ? `<span class="pill coach">${t('by_hand')}</span>` : !r.structured ? `<span class="pill coach">${t('no_steps')}</span>` : ''}</span></a>`;
  });
  if (skipped) html += `<p class="small muted">${skipped === 1 ? t('rides_skipped_1') : t('rides_skipped', { n: skipped })}</p>`;
  html += `<a class="btn wide" href="#add">${IC.plus}${t('rides_add')}</a>`;
  return html;
}

/* add a ride by hand (no Intervals.icu, or a ride without blocks) */
function vAdd() {
  const A = UI.add || (UI.add = { name: '', date: todayIso(), h: '', m: '', goal: 'endurance', start: SET.usualStart || '' });
  return `${topbar(t('add_t'), '#rides')}<section class="card">
    <div class="fld"><label class="lbl" for="a-name">${t('add_name')}</label><input id="a-name" type="text" data-add="name" value="${esc(A.name)}"></div>
    <div class="fld"><label class="lbl" for="a-date">${t('add_date')}</label><input id="a-date" type="date" data-add="date" value="${esc(A.date)}" min="${todayIso()}"></div>
    <div class="fld"><span class="lbl">${t('add_dur')}</span><div class="row"><span class="tin"><input type="text" inputmode="numeric" data-add="h" value="${esc(A.h)}" aria-label="${t('add_dur')} ${t('add_h')}"><span>${t('add_h')}</span></span>
      <span class="tin"><input type="text" inputmode="numeric" data-add="m" value="${esc(A.m)}" aria-label="${t('add_dur')} ${t('add_m')}"><span>${t('add_m')}</span></span></div></div>
    <div class="fld"><span class="lbl">${t('add_goal')}</span>${chips('goal', E.GOALS.map(g => [g, t('g_' + g)]), A.goal, 's', 'addgoal')}</div>
    <div class="fld"><label class="lbl" for="a-start">${t('ride_start')}</label><span class="tin time"><input id="a-start" type="time" data-add="start" value="${esc(A.start)}"></span></div>
    <p class="err" role="alert">${UI.addErr || ''}</p>
    <button class="btn primary big wide" data-act="addsave">${t('add_save')}</button></section>`;
}

/* ---------- one ride: conditions + targets ---------- */
function findRide(id) {
  if (id.startsWith('man-')) { const r = RIDES.get(id); return r ? allRides().find(x => x.id === id) || { ...r, source: 'man', type: 'Ride', name: r.name || t('g_' + (r.goal || 'endurance')), time: r.start, structured: false, tags: [], goalTag: null } : null; }
  const ev = EVENTS.find(e => 'icu-' + e.id === id);
  return ev && RD.isRide(ev) ? RD.eventToRide(ev) : null;
}
function rideContext(r) {
  const C = RIDES.get(r.id) || { id: r.id };
  const indoor = C.indoor != null ? C.indoor : r.indoor;
  const start = C.start || r.time || SET.usualStart || null;
  const found = RD.nextWithin(r, start, EVENTS);
  const next8h = C.next8h != null ? C.next8h : !!found;
  const goalTag = r.goalTag && r.goalTag !== 'trainlow' ? r.goalTag : null;
  const goalChoice = goalTag ? null : (C.goal || (r.source === 'man' || !r.structured ? 'endurance' : null));
  return { C, indoor, start, found: C.next8h == null && !!found,
    ctx: { goalTag: goalTag || (r.goalTag === 'trainlow' ? 'trainlow' : null), goalChoice, indoor: indoor === true, tempC: C.tempC ?? null, start, rideYear: +r.date.slice(0, 4), next8h, refillMin: 0 } };
}
function vRide(id) {
  const r = id && findRide(id);
  if (!r) return `${topbar(t('rides_t'), '#rides')}<p class="muted">${t('rides_none')}</p>`;
  const X = rideContext(r), ctx = X.ctx, R = DATA.rules;
  const fc = forecastFor(r, X);                                           // P3-4: own value wins, else the forecast
  if (ctx.tempC == null && fc && fc.temp != null) ctx.tempC = fc.temp;
  const prof = Object.assign({}, P, { ftpW: P.ftpW || (ATH && ATH.ftp) || null });
  const doc = RD.workoutDoc(r, ATH, prof, ctx.goalTag && ctx.goalTag !== 'trainlow' ? ctx.goalTag : ctx.goalChoice || 'endurance', R.rules);
  const manSt = doc.manualRule && R.rules[doc.manualRule] ? R.rules[doc.manualRule].status : null;   // MAN-03 (key/race) is OPEN
  const parsed = W.parse(doc);
  if (!parsed.ok) return `${topbar(r.name, '#rides')}<div class="card badc"><p>${t('w_parse')}</p></div>`;
  const T = E.plan({ parsed, ctx, profile: prof, rules: R });
  const goal = T.goal.value, hpart = lang() === 'en' ? '/h' : '/u';
  let h = topbar(r.name || t('g_' + goal), '#rides');
  h += `<p class="meta"><span>${esc(dayLabel(r.date))}</span><span class="tabular">${esc(X.start || t('no_time'))}</span><span class="tabular">${F.dur(parsed.durationS)}</span>
    ${T.intensity.ifactor != null ? `<span>${t('ride_if', { v: F.num(T.intensity.ifactor, 2) })}</span>` : ''}${r.tags.map(g => `<span class="pill acc">${esc(g)}</span>`).join('')}</p>`;

  /* warnings */
  const warn = [];
  if (T.warnings.includes('trainlow_unsupported')) warn.push(t('trainlow_warn'));
  if (T.warnings.includes('nomass')) warn.push(`${t('w_nomass')} <a href="#profile">${t('tab_profile')}</a>`);
  if (X.indoor == null) warn.push(t('ride_io_ask'));
  if (!X.start) warn.push(t('ride_start_ask'));
  warn.forEach(w => { h += `<div class="card warnc"><p>${w}</p></div>`; });
  if (T.warnings.includes('ask_sweat_test_once')) h += `<div class="card notice"><p>${t('w_sweat_once')}</p><details class="inl"><summary>${t('sweat_test_t')}</summary><p class="small">${t('sweat_test')}</p></details>
    <div class="row"><button class="btn" data-act="sweatok">${t('w_sweat_ok')}</button></div></div>`;

  /* conditions */
  const C = X.C, tagged = ctx.goalTag && ctx.goalTag !== 'trainlow';
  h += `<details class="card" id="cond"${X.indoor == null || !X.start || UI.condOpen ? ' open' : ''}><summary>${t('ride_cond')}</summary>
    <div class="fld"><span class="lbl">${t('ride_goal')}</span>${tagged ? `<p>${t('g_' + goal)} <span class="small muted">· ${t('goal_tag', { g: esc(ctx.goalTag) })}</span></p>`
      : chips('goal', E.GOALS.map(g => [g, t('g_' + g)]), goal, 's', 'rset') + (T.goal.source === 'suggested' ? `<small class="muted">${t('goal_sug')}</small>` : '')}</div>
    ${r.type === 'VirtualRide' ? '' : `<div class="fld"><span class="lbl">${t('ride_io')}</span>${chips('indoor', [[true, t('indoor')], [false, t('outdoor')]], X.indoor, 'b', 'rset')}</div>`}
    <div class="fld"><label class="lbl" for="r-start">${t('ride_start')}</label><span class="tin time"><input id="r-start" type="time" data-rf="start" value="${esc(X.start || '')}"></span></div>
    <div class="fld"><label class="lbl" for="r-temp">${t('ride_temp')} (${t('optional')})</label><span class="tin"><input id="r-temp" type="text" inputmode="decimal" data-rf="tempC" value="${esc(ns(C.tempC))}" placeholder="${fc && fc.temp != null ? esc(ns(fc.temp)) : ''}"><span>°C</span></span>
      ${fc ? `<small class="muted">${fc.pending ? t('wx_loading') : fc.temp != null ? t('wx_fc', { t: ns(fc.temp), place: esc(fc.place) }) + (C.tempC != null ? ' ' + t('wx_own') : '') : t('wx_none')}</small>`
        : !SET.location && X.indoor === false ? `<small class="muted"><a href="#settings">${t('wx_set')}</a></small>` : ''}
      <span class="err" role="alert">${UI.err.tempC || ''}</span></div>
    <div class="fld"><span class="lbl">${t('ride_next')}</span>${chips('next8h', [[true, t('yes')], [false, t('no')]], ctx.next8h, 'b', 'rset')}${X.found ? `<small class="muted">${t('ride_next_found')}</small>` : ''}</div>
    ${!r.structured ? `<p class="small muted">${t('ride_manual_int', { z: doc.manualZone })} ${statusPill(manSt)}</p>` : ''}
    ${r.source === 'man' ? `<button class="btn danger" data-act="rdel">${t('ride_delete')}</button>` : ''}
    ${r.description ? `<details class="inl"><summary>${t('ride_desc')}</summary><p class="small" style="white-space:pre-wrap">${esc(r.description)}</p></details>` : ''}</details>`;

  /* during */
  const c = T.cho, fl = T.fluid, na = T.sodium, bottleMl = P.bottleMl;
  const nBottles = bottleMl && fl.totalMl ? Math.ceil(fl.totalMl / bottleMl - 1e-9) : 0;
  const needRefill = !ctx.indoor && P.cages != null && nBottles > P.cages;
  const M = DFMatch.match({ targets: T, items: libItems(), stock: stockList(), profile: P, rules: R,
    ctx: Object.assign({}, ctx, { refillMin: needRefill ? (C.refillMin || 0) : 0, planKind: C.planKind }) });
  const notes = [];
  if (c.gph === 0 && !c.optional) notes.push(t('cho_zero'));
  if (c.optional) notes.push(t('cho_opt', { lo: c.lo, hi: c.hi }));
  if (c.mtcRequired) notes.push(t('cho_mtc', { max: R.rules['CHO-MTC-01'].glucoseOnlyMaxGph }));
  if (c.gutAdvice) notes.push(t('cho_gut', { guide: c.guideline, tol: ns(P.gutCapGph) }));
  if (T.warnings.includes('notolerance')) notes.push(`${t('cho_notol')} <a href="#profile">${t('tab_profile')}</a>`);
  // HEAT-01 tip only on a hot day (HEAT-02 hotC, the coach's threshold) – with the forecast every outdoor ride has a temperature (todo T7)
  if (T.warnings.includes('heat_cool_drinks') && ctx.tempC != null && ctx.tempC >= R.rules['HEAT-02'].hotC) notes.push(t('w_heat', { c: R.rules['HEAT-01'].coolC }));
  if (r.carbsPerHour) notes.push(t('ride_carbs_icu', { g: ns(r.carbsPerHour) }));
  h += `<section class="card"><h2>${t('sec_during')}</h2><div class="big3">
    <div class="tile"><span class="k">${t('cho')}</span><span class="v">${c.gph}<small> g${hpart}</small></span><span class="s">${c.gph || c.optional ? t('range', { lo: c.lo, hi: c.hi }) : ''}</span>${statusPill(c.status)}</div>
    <div class="tile"><span class="k">${t('fluid')}</span><span class="v">${fl.mlph}<small> ml${hpart}</small></span><span class="s">${t('total_ml', { ml: fl.totalMl })}</span>${statusPill(fl.status)}</div>
    <div class="tile"><span class="k">${t('sodium')}</span><span class="v">${na.none ? '–' : na.mgph}<small>${na.none ? '' : ' mg' + hpart}</small></span><span class="s">${na.none ? t('na_none') : t('na_perl', { mg: na.mgPerL })}</span>${statusPill(na.status)}</div></div>
    ${c.gph ? `<p class="small muted">${t('total_g', { g: c.totalG })}</p>` : ''}
    ${notes.length ? `<ul class="plain small">${notes.map(x => `<li>${x}</li>`).join('')}</ul>` : ''}
    <div class="fld"><span class="lbl">${t('caffeine_t')} ${T.caffeine.on || T.caffeine.optional ? statusPill(T.caffeine.status) : ''}</span>${cafText(T.caffeine)}${cafMatchText(M)}</div></section>`;
  h += packCard(M, T, ctx, C, needRefill);

  /* timing: with stock, the products per moment (matcher schedule); without, what kind of intake fits */
  const every = R.rules['TIME-02'].everyMin, drinkMl = F.roundTo(fl.mlph * every / 60, R.rules['RND-01'].fluidMl), withStock = stockList().length > 0;
  h += `<section class="card"><h2>${t('sec_timing')} ${statusPill(manSt)}</h2>${T.slots.length ? `<div class="slots">${T.slots.map((s, i) => {
    const sc = M.schedule[i] || { eat: [], drinkMl }, eat = sc.eat.map(e => esc(itemName(e.id))).join(' + ');
    const kind = s.sustained ? t('slot_sustained') : s.easy ? t('slot_food') : t('slot_gel');
    const parts = [withStock && T.cho.gph > 0 ? (eat ? `<b>${eat}</b>` : '') : kind, sc.drinkMl ? t('slot_drink', { ml: sc.drinkMl }) : ''].filter(Boolean);
    return `<div class="slotr"><b>${X.start ? F.clock(X.start, s.min) : t('slot_min', { m: s.min })}</b><span>${parts.join(' · ')}${withStock && eat && s.sustained ? `<br><small class="muted">${t('slot_sustained')}</small>` : ''}</span></div>`; }).join('')}</div>` : `<p class="muted">${t('slot_none')}</p>`}</section>`;

  /* before / after / energy */
  h += `<section class="card"><h2>${t('sec_before')}</h2>${preText(T.pre)}</section>`;
  h += `<section class="card"><h2>${t('sec_after')}</h2>${postText(T.post)}</section>`;
  if (T.energy.kJ) h += `<section class="card"><h2>${t('sec_energy')}</h2><p class="small">${t('energy', { kj: T.energy.kJ, k1: T.energy.kcal[0], k2: T.energy.kcal[1] })}</p></section>`;

  /* fuel card (image) + top-tube sticker (P3-3): plain-text model of what this screen shows */
  const slotsPlain = T.slots.map((s, i) => {
    const sc = M.schedule[i] || { eat: [], drinkMl }, useStock = withStock && T.cho.gph > 0;
    const kind = s.sustained ? t('slot_sustained') : s.easy ? t('slot_food') : t('slot_gel');
    const shortEat = sc.eat.map(e => (itemById(e.id) || {}).name || e.id).join(' + ');
    return { time: X.start ? F.clock(X.start, s.min) : t('slot_min', { m: s.min }), what: useStock ? sc.eat.map(e => itemName(e.id)).join(' + ') : kind,
      short: (useStock ? shortEat : '') || (sc.drinkMl ? `${sc.drinkMl} ml` : ''), drink: sc.drinkMl ? t('slot_drink', { ml: sc.drinkMl }) : '' };
  });
  const cafOpen = (T.caffeine.on || T.caffeine.optional) && T.caffeine.status === 'open';
  UI.fuel = { title: r.name || t('g_' + goal), meta: [dayLabel(r.date), X.start || '', F.dur(parsed.durationS), t('g_' + goal)].filter(Boolean).join(' · '),
    metaShort: `${F.date(r.date)} ${X.start || ''}`.trim(), target: `${c.gph} g${hpart} · ${fl.mlph} ml${hpart}`,
    tiles: [{ k: t('cho'), v: String(c.gph), u: 'g' + hpart, s: c.gph || c.optional ? t('range', { lo: c.lo, hi: c.hi }) : '' },
      { k: t('fluid'), v: String(fl.mlph), u: 'ml' + hpart, s: t('total_ml', { ml: fl.totalMl }) },
      { k: t('sodium'), v: na.none ? '–' : String(na.mgph), u: na.none ? '' : 'mg' + hpart, s: '' }],
    caf: `${t('caffeine_t')}: ${cafLines(T.caffeine).join('; ')}${cafOpen ? ` (${t('open_badge')})` : ''}`, cafOpen,
    pack: withStock || T.cho.gph === 0 ? packLines(M) : [], slots: slotsPlain, pre: preLines(T.pre), post: postLines(T.post),
    hPack: t('sec_pack'), hTiming: t('sec_timing'), hBefore: t('sec_before'), hAfter: t('sec_after'), sub: t('app_sub'), foot: t('card_foot'),
    fileName: `dynamfuel-${r.date}-${String(r.name || goal).replace(/[^A-Za-z0-9]+/g, '-').slice(0, 30)}.png` };
  h += `<div class="row noprint"><button class="btn primary" data-act="card">${t('card_share')}</button><button class="btn" data-act="sticker">${t('card_sticker')}</button></div>`;

  /* why */
  const ids = [];
  [c.rules, fl.rules, na.rules, T.caffeine.rules, T.pre.rules, T.post.rules, ...T.slots.map(s => s.rules), T.energy.rules, T.intensity.rules, doc.manualRule ? [doc.manualRule] : [], stockList().length ? ['MATCH-01', 'MATCH-02', 'MATCH-03', 'MATCH-04', 'MATCH-05'] : []].forEach(l => (l || []).forEach(x => { if (!ids.includes(x)) ids.push(x); }));
  h += `<details class="card"><summary>${t('sec_why')}</summary><p class="small muted">${t('why_rules')}</p><div class="why">${ids.map(id => {
    const ru = R.rules[id] || {}; return `<div class="r${ru.status === 'open' ? ' open' : ''}"><span>${esc(ruleText(id))}</span><span><code>${id}</code> ${ru.status === 'open' ? `<span class="pill open">${t('open_badge')}</span>` : ru.status === 'coach' ? `<span class="pill coach">${t('coach_badge')}</span>` : ''}</span></div>`; }).join('')}</div>
    <p class="small"><a href="#about">${t('ref_t')}</a></p></details>`;
  return h;
}
function cafText(cf) {
  if (cf.optional) return `<p>${t('caf_opt')}</p>`;
  if (cf.off) return `<p class="muted">${t('caf_off_' + cf.off)}</p>`;
  return ul(cafLines(cf));
}
/* which caffeine product covers each dose during the ride (matcher, P3-2) */
function cafMatchText(M) {
  const L = (M.caffeine || []).map(c => c.none ? t('caf_late_none', { mg: c.doseMg })
    : t('caf_late_prod', { n: c.n, name: esc(itemName(c.id)), mg: c.mg, dose: c.doseMg }) + (c.extra ? ' ' + t('caf_late_extra') : ''));
  return L.length ? ul(L) : '';
}
function cafLines(cf) {
  if (cf.optional) return [t('caf_opt')];
  if (cf.off) return [t('caf_off_' + cf.off)];
  const R5 = DATA.rules.rules['CAF-05'];
  const why = d => d.capped ? t('caf_cap', { max: d.capped === 'single' ? R5.singleMaxMg : d.mg }) : `${ns(d.mgkg)} mg/kg`;
  const out = cf.doses.map(d => d.clock ? t('caf_on', { mg: d.mg, why: why(d), clock: d.clock }) + (d.atMin < 0 ? ` (${t('caf_before', { n: -d.atMin })}) – ${t('caf_pre_how')}` : '')
    : d.atMin < 0 ? `${d.mg} mg (${why(d)}) – ${t('caf_before', { n: -d.atMin })}` : t('caf_at', { mg: d.mg, why: why(d), min: d.atMin }));
  cf.dropped.filter(d => d.dropped === 'bedtime').forEach(d => out.push(t('caf_dropped', { mg: d.mg, clock: d.clock || '' })));
  if (!cf.doses.some(d => d.clock) && cf.doses.length && !cf.rules.includes('CAF-06')) out.push(t('caf_notime'));
  if (cf.doses.length) out.push(t('caf_daily', { mg: cf.totalMg, max: cf.dailyMaxMg }));   // CAF-05: coffee counts too
  return out;
}

/* ---------- forecast temperature (Open-Meteo, P3-4) ---------- */
const WX = store.get('wx', {}) || {};
const saveWx = () => { const keep = Object.entries(WX).sort((a, b) => b[1].at - a[1].at).slice(0, 20); Object.keys(WX).forEach(k => { if (!keep.some(e => e[0] === k)) delete WX[k]; }); store.set('wx', WX); };
UI.wxBusy = {};
function forecastFor(r, X) {
  const L = SET.location; if (!L || X.indoor !== false || !X.start || !r.date) return null;
  const diff = Math.round((Date.parse(r.date + 'T00:00:00Z') - Date.parse(todayIso() + 'T00:00:00Z')) / 86400000);
  if (!DFWeather.inRange(diff)) return null;
  const key = `${L.lat},${L.lon},${r.date}`, c = WX[key];
  if (!c || Date.now() - c.at > 3 * 3600e3) setTimeout(() => fetchWx(key, L, r.date, diff), 0);
  if (!c) return UI.wxBusy[key] === 'fail' ? { temp: null, place: L.name } : { pending: true, place: L.name };
  return { temp: DFWeather.maxDuring(c.hourly, r.date, X.start, r.durationS), place: L.name };
}
async function fetchWx(key, L, date, diff) {
  if (UI.wxBusy[key]) return;
  UI.wxBusy[key] = 'busy';
  try {
    const res = await fetch(DFWeather.forecastUrl(L.lat, L.lon, date, diff < DFWeather.DAYS - 1 ? RD.addDays(date, 1) : date));
    if (!res.ok) throw new Error(res.status);
    const j = await res.json();
    WX[key] = { hourly: { time: j.hourly.time, temperature_2m: j.hourly.temperature_2m }, at: Date.now() }; saveWx();
    delete UI.wxBusy[key];
  } catch (e) { UI.wxBusy[key] = 'fail'; setTimeout(() => { if (UI.wxBusy[key] === 'fail') delete UI.wxBusy[key]; }, 5 * 60e3); }
  if (/^#ride\//.test(location.hash)) rerender();
}
function wxCard() {
  const L = SET.location;
  return `<section class="card"><h2>${t('set_wx')}</h2><p class="small">${t('set_wx_l')}</p>
    ${L ? `<div class="row between"><p><b>${esc(L.name)}</b> <span class="small muted">${esc(L.region)}</span></p><button class="btn" data-act="wxclear">${t('wx_clear')}</button></div>` : ''}
    <div class="row nowrap"><input id="wxq" class="grow wxq" type="text" autocomplete="off" placeholder="${t('wx_town')}" aria-label="${t('wx_town')}" value="${esc(UI.wxQ || '')}"><button class="btn" data-act="wxsearch">${t('wx_search')}</button></div>
    ${UI.wxPlaces ? (UI.wxPlaces.length ? `<div class="chips">${UI.wxPlaces.map((p, i) => `<button class="chip" data-act="wxpick" data-i="${i}">${esc(p.name)} <span class="small">(${esc(p.region)})</span></button>`).join('')}</div>` : `<p class="small muted">${t('wx_noplace')}</p>`) : ''}
    <p class="msg${UI.wxBad ? ' bad' : ''}" role="status">${esc(UI.wxMsg || '')}</p><small class="muted">${t('wx_attr')}</small></section>`;
}
const ul = lines => `<ul class="plain">${lines.map(x => `<li>${x}</li>`).join('')}</ul>`;
const preText = p => ul(preLines(p)), postText = p => ul(postLines(p));
function preLines(p) {
  if (!p.applies) return [t('pre_short')];
  const win = p.window ? ' ' + t('pre_window', { a: p.window[0], b: p.window[1] }) : '';
  const fwin = p.fluidWindow ? t('pre_window', { a: p.fluidWindow[0], b: p.fluidWindow[1] }) : '';
  const lines = [];
  if (!p.g) lines.push(t('w_nomass'));
  else if (p.kind === 'normal') lines.push(t('pre_normal', { g: p.g[0], gkg: ns(p.gkg[0]), h1: p.hoursBefore[0], h2: p.hoursBefore[1] }) + (p.window ? ` (${t('pre_window', { a: p.window[0], b: p.window[1] })})` : ''));
  else lines.push(t('pre_fuel', { g1: p.g[0], g2: p.g[1], k1: ns(p.gkg[0]), k2: ns(p.gkg[1]) }) + win);
  if (p.fluidMl) lines.push(t('pre_fluid', { a: p.fluidMl[0], b: p.fluidMl[1], w: fwin }));
  return lines;
}
function postLines(p) {
  const lines = [];
  if (p.kind === 'water') lines.push(t('post_water'));
  else if (p.kind === 'rapid') lines.push(p.choGph ? t('post_rapid', { g1: p.choGph[0], g2: p.choGph[1], h: p.hours, p: p.proteinG }) : t('w_nomass'));
  else lines.push(p.proteinG ? t('post_normal', { p1: p.proteinG[0], p2: p.proteinG[1], h: p.withinH }) : t('w_nomass'));
  lines.push(p.rehydrateMl ? t('post_rehyd_ml', { a: p.rehydrateMl[0], b: p.rehydrateMl[1] }) : t('post_rehyd'));
  return lines;
}

/* ---------- stock (library + what the athlete has) ---------- */
const CATS = [['gel', 'cat_gel'], ['chew', 'cat_chew'], ['bar', 'cat_bar'], ['drink', 'cat_drink'], ['electrolyte', 'cat_el'], ['food', 'cat_food']];
/* products from the spreadsheet + real food (food.json) with the athlete's weights */
const foodById = id => DATA.food && DATA.food.items.find(f => f.id === id);
const ownItems = () => [...STOCK.values()].filter(s => s.own).map(s => Object.assign({ id: s.id, own: true }, s.own));
const libItems = () => (DATA.library ? DATA.library.items : []).concat(DATA.caffeine ? DATA.caffeine.items : [], ownItems()).concat(DATA.food ? DATA.food.items.map(f => DFFood.toItem(f, (STOCK.get(f.id) || {}).grams, lang())) : []);
const itemById = id => libItems().find(x => x.id === id);
const itemName = id => { const it = itemById(id); return it ? `${it.brand} ${it.name}`.trim() : id; };
const stockList = () => [...STOCK.values()].filter(s => s.qty > 0 && !s.hidden && itemById(s.id)).map(s => ({ id: s.id, qty: s.qty, fav: !!s.fav }));
function servingText(it) {
  if (it.food) return it.serving.amount != null ? t('food_serving', { g: ns(it.serving.amount) }) : '';
  if (it.category === 'drink' && it.waterMl) return t('serv_drink', { g: ns(it.powderG ?? '?'), ml: it.waterMl });
  if (it.category === 'electrolyte' && it.waterMl) return t('serv_tab', { ml: it.waterMl });
  const s = it.serving || {}; return [s.amount != null ? `${ns(s.amount)} ${s.unit || ''}`.trim() : '', s.format || ''].filter(Boolean).join(' · ');
}
function itemRow(it) {
  const s = STOCK.get(it.id) || { qty: 0 }, a = DFMatch.allowed(it, P), H = lang() === 'en' ? '' : '';
  const facts = [it.choG != null ? `${ns(it.choG)} g ${t('cho').toLowerCase()}` : null, it.sodiumMg != null ? `${ns(it.sodiumMg)} mg ${t('sodium').toLowerCase()}` : null].filter(Boolean).join(' · ');
  return `<div class="card item${s.qty > 0 ? ' instock' : ''}"><div class="row between nowrap"><div class="grow"><b>${esc(it.brand)} ${esc(it.name)}</b>
      <div class="meta"><span>${facts}</span><span>${esc(servingText(it))}</span>${it.mtc ? `<span class="pill coach">${t('gf')}</span>` : ''}${it.caffeineMg > 0 ? `<span class="pill open">${t('stock_caf')}</span>` : ''}</div></div>
      <button class="iconbtn star" data-act="sfav" data-id="${esc(it.id)}" aria-pressed="${!!s.fav}" aria-label="${t('stock_fav')}">${s.fav ? '★' : '☆'}</button></div>
    ${!a.ok ? `<p class="small err">${t('excl_' + a.why)}</p>` : ''}${it.food ? foodWeights(it) : ''}
    <div class="row between"><div class="row stepper"><button class="iconbtn" data-act="sqty" data-id="${esc(it.id)}" data-d="-1" aria-label="${t('stock_less')}"${s.qty > 0 ? '' : ' disabled'}>−</button>
      <input type="text" inputmode="numeric" class="qty" data-sqid="${esc(it.id)}" value="${s.qty || 0}" aria-label="${esc(it.brand + ' ' + it.name)}">
      <button class="iconbtn" data-act="sqty" data-id="${esc(it.id)}" data-d="1" aria-label="${t('stock_more')}">+</button><span class="muted small">${it.food ? esc((foodById(it.id).unit || {})[lang()] || '') : t('u_' + it.category)}</span></div>
      <span class="row">${it.own ? `<a class="linkbtn" href="#own/${encodeURIComponent(it.id)}">${t('own_edit_s')}</a>` : ''}<button class="linkbtn" data-act="shide" data-id="${esc(it.id)}">${s.hidden ? t('stock_unhide') : t('stock_hide')}</button></span></div></div>`;
}
/* real food: weight per part (the source weight is prefilled where one exists) + where the values come from */
function foodWeights(it) {
  const f = foodById(it.id); if (!f) return '';
  return `${it.missingWeight ? `<p class="small warnc-t">${t('food_need_g')}</p>` : ''}<div class="row">${f.parts.map((p, i) => `<label class="fld small"><span>${esc(p.label[lang()] || p.label.nl)}</span>
      <span class="tin"><input type="text" inputmode="decimal" data-gid="${esc(f.id)}" data-gi="${i}" value="${esc(ns(it.grams[i]))}" placeholder="?"><span>g</span></span></label>`).join('')}</div>
    <details class="inl small"><summary>${t('food_src')}</summary><ul class="plain small muted">${f.parts.map(p => `<li>${esc(p.ref)}${p.gSource ? ` · ${esc(p.gSource)}` : ''}</li>`).join('')}${f.mtcBasis ? `<li>${esc(f.mtcBasis)}</li>` : ''}</ul></details>`;
}
function vStock() {
  const f = UI.stockFilter || 'all', items = libItems();
  const st = id => STOCK.get(id) || {};
  let h = topbar(t('stock_t')) + `<p class="small muted">${t('stock_l')}</p>` + chips('stockFilter', [['all', t('stock_all')], ['in', t('stock_in')]], f, 's', 'sfilter');
  h += `<a class="btn wide" href="#own">${IC.plus}${t('own_add')}</a>`;
  const own = items.filter(it => it.own && !st(it.id).hidden && (f === 'all' || st(it.id).qty > 0));
  if (own.length) h += `<h2 class="dayh">${t('own_t')}</h2>` + own.map(itemRow).join('');
  let any = own.length > 0;
  CATS.forEach(([cat, key]) => {
    const list = items.filter(it => it.category === cat && !it.own && !st(it.id).hidden && (f === 'all' || st(it.id).qty > 0));
    if (!list.length) return; any = true;
    h += `<h2 class="dayh">${t(key)}</h2>` + list.map(itemRow).join('');
  });
  if (!any) h += `<p class="muted">${t('stock_none')}</p>`;
  const hid = items.filter(it => st(it.id).hidden);
  if (hid.length) h += `<details class="card"><summary>${t('stock_hidden', { n: hid.length })}</summary>${hid.map(itemRow).join('')}</details>`;
  return h;
}
async function saveStock(id, patch) {
  const s = Object.assign({ id, qty: 0, fav: false, hidden: false }, STOCK.get(id) || {}, patch);
  s.qty = Math.max(0, Math.min(999, Math.round(+s.qty || 0)));
  STOCK.set(id, s); await DB.put('items', s);
}

/* ---------- own products + Open Food Facts barcode lookup (P3-5) ---------- */
const OWN_NUM = { amount: [0.1, 2000], choG: [0, 200], sugarsG: [0, 200], sodiumMg: [0, 5000], saltG: [0, 12.5], caffeineMg: [0, 400], kcal: [0, 2000],
  proteinG: [0, 200], fatG: [0, 200], fibreG: [0, 100], waterMl: [50, 2000], powderG: [0, 500] };
const PER_SERVING = ['choG', 'sugarsG', 'sodiumMg', 'caffeineMg', 'kcal', 'proteinG', 'fatG', 'fibreG'];
function ownDraft(id) {
  const s = id && STOCK.get(id), o = s && s.own;
  if (o) return Object.assign({ id, unit: o.serving.unit, amount: o.serving.amount, code: o.offCode || '', per100: null, labelChecked: false }, o);
  return { id: null, brand: '', name: '', category: 'gel', unit: 'g', amount: null, choG: null, sugarsG: null, sodiumMg: null, caffeineMg: null, kcal: null, proteinG: null,
    fatG: null, fibreG: null, mtc: null, waterMl: null, powderG: null, allergens: [], traces: [], labelChecked: false, code: '', offCode: null, per100: null };
}
function vOwn(id) {
  const D = UI.own && UI.own.id === (id || null) ? UI.own : (UI.own = ownDraft(id));
  const u = D.unit, nf = (f, label, unit) => `<div class="fld"><label class="lbl" for="o-${f}">${label}</label><span class="tin"><input id="o-${f}" type="text" inputmode="decimal" data-own="${f}" value="${esc(ns(D[f]))}"><span>${unit}</span></span><span class="err">${UI.err['own_' + f] || ''}</span></div>`;
  const scan = canScan() ? `<button class="btn" data-act="offscan">${t('own_scan')}</button><button class="btn" data-act="offscanstop" hidden>${t('own_scan_stop')}</button>` : '';
  return `${topbar(id ? t('own_edit') : t('own_add'), '#stock')}
    <section class="card"><h2>${t('own_bar')}</h2><p class="small muted">${t('own_bar_l')}</p>
      <div class="row nowrap"><input id="offcode" class="grow wxq" type="text" inputmode="numeric" autocomplete="off" placeholder="${t('own_code')}" aria-label="${t('own_code')}" value="${esc(D.code || '')}">
        <button class="btn" data-act="offsearch">${t('wx_search')}</button></div>
      ${scan ? `<div class="row">${scan}</div>` : ''}
      <p class="msg${UI.offBad ? ' bad' : ''}" role="status">${esc(UI.offMsg || '')}</p><video id="offvideo" playsinline muted hidden style="width:100%;border-radius:12px"></video>
      <small class="muted">${t('own_off_attr')}</small></section>
    <section class="card">
      <div class="fld"><label class="lbl" for="o-name">${t('own_name')}</label><input id="o-name" type="text" data-own="name" value="${esc(D.name)}" maxlength="80"></div>
      <div class="fld"><label class="lbl" for="o-brand">${t('own_brand')} (${t('optional')})</label><input id="o-brand" type="text" data-own="brand" value="${esc(D.brand)}" maxlength="40"></div>
      <div class="fld"><span class="lbl">${t('own_cat')}</span>${chips('category', DFOff.CATS.map(c => [c, t({ gel: 'cat_gel', bar: 'cat_bar', chew: 'cat_chew', drink: 'cat_drink', electrolyte: 'cat_el', food: 'cat_food' }[c])]), D.category, 's', 'ownset')}</div>
      <div class="fld"><span class="lbl">${t('own_serving')}</span><div class="row"><span class="tin"><input type="text" inputmode="decimal" data-own="amount" value="${esc(ns(D.amount))}" aria-label="${t('own_serving')}"><span>${u}</span></span>${chips('unit', [['g', 'g'], ['ml', 'ml']], u, 's', 'ownset')}</div>
        ${D.per100 ? `<small class="muted">${t('own_from_off')}</small>` : ''}<span class="err">${UI.err.own_amount || ''}</span></div>
      ${['drink', 'electrolyte'].includes(D.category) ? nf('waterMl', t('own_water'), 'ml') + nf('powderG', t('own_powder') + ` (${t('optional')})`, 'g') : ''}
      <h3>${t('own_per')}</h3>
      ${nf('choG', t('cho'), 'g')}${nf('sugarsG', t('own_sugars'), 'g')}${nf('sodiumMg', t('sodium'), 'mg')}${D.sodiumMg == null ? nf('saltG', t('own_salt'), 'g') : ''}
      ${nf('caffeineMg', t('caffeine_t'), 'mg')}${nf('kcal', t('own_kcal'), 'kcal')}${nf('proteinG', t('own_protein'), 'g')}${nf('fatG', t('own_fat'), 'g')}${nf('fibreG', t('own_fibre'), 'g')}
      <div class="fld"><span class="lbl">${t('own_mtc')}</span>${chips('mtc', [[true, t('yes')], [null, t('unknown')]], D.mtc, 'm', 'ownset')}<small class="muted">${t('own_mtc_l')}</small></div>
      <div class="fld"><span class="lbl">${t('own_allerg')}</span><div class="chips" role="group">${DFBackup.EU14.map(a => `<button type="button" class="chip" data-act="owntog" data-f="allergens" data-v="${a}" aria-pressed="${D.allergens.includes(a)}">${t('a_' + a)}</button>`).join('')}</div></div>
      <div class="fld"><span class="lbl">${t('own_traces')}</span><div class="chips" role="group">${DFBackup.EU14.map(a => `<button type="button" class="chip" data-act="owntog" data-f="traces" data-v="${a}" aria-pressed="${D.traces.includes(a)}">${t('a_' + a)}</button>`).join('')}</div></div>
      <label class="check"><input type="checkbox" data-own="labelChecked"${D.labelChecked ? ' checked' : ''}><span>${t('own_check')}</span></label>
      <p class="err" role="alert">${UI.ownErr || ''}</p>
      <button class="btn primary big wide" data-act="ownsave">${t('save')}</button>
      ${id ? `<button class="btn danger wide" data-act="owndel">${t('own_del')}</button>` : ''}</section>`;
}
/* Open Food Facts values per 100 → per serving (only when the athlete has not typed that value) */
function ownApplyPer100(D) {
  if (!D.per100 || !(D.amount > 0)) return;
  const ps = DFOff.perServing(D.per100, D.amount);
  PER_SERVING.forEach(k => { if (!(D.typed || {})[k] && ps[k] != null) D[k] = ps[k]; });
}
async function offLookup(code) {
  const D = UI.own; code = String(code || '').trim(); D.code = code;
  if (!DFOff.validCode(code)) { UI.offMsg = t('own_code_bad'); UI.offBad = true; return rerender(); }
  UI.offMsg = t('loading'); UI.offBad = false; rerender();
  try {
    const res = await fetch(DFOff.url(code)); if (!res.ok) throw 0;
    const p = DFOff.parse(await res.json(), lang());
    if (!p.found) { UI.offMsg = t('own_notfound'); UI.offBad = true; return rerender(); }
    Object.assign(D, { name: D.name || p.name, brand: D.brand || p.brand, per100: p.per100, offCode: p.code || code, sodiumBasis: p.sodiumBasis,
      allergens: [...new Set(D.allergens.concat(p.allergens))], traces: [...new Set(D.traces.concat(p.traces))], typed: {} });
    if (!(D.amount > 0) && p.servingG > 0) D.amount = p.servingG;
    ownApplyPer100(D);
    UI.offMsg = t('own_found', { name: p.name || code }); UI.offBad = false;
  } catch (e) { UI.offMsg = t('own_off_err'); UI.offBad = true; }
  rerender();
}
/* camera scan: the browser's own BarcodeDetector where it exists (Android Chrome), else DynamFuel's reader (ean.js) on the
   camera picture (iPhone, desktop). The same code must be read twice in a row before it is used. Nothing leaves the phone. */
const canScan = () => !!(navigator.mediaDevices && navigator.mediaDevices.getUserMedia);
let scanStop = false;
async function offScan() {
  const v = $('#offvideo'); if (!v) return;
  let stream; scanStop = false;
  try {
    let det = null;
    if ('BarcodeDetector' in window) { try { det = new BarcodeDetector({ formats: ['ean_13', 'ean_8', 'upc_a', 'upc_e'] }); } catch (e) { det = null; } }
    stream = await navigator.mediaDevices.getUserMedia({ video: { facingMode: 'environment', width: { ideal: 1280 }, height: { ideal: 720 } }, audio: false });
    v.srcObject = stream; v.hidden = false; await v.play();
    UI.offMsg = t('own_scan_hint'); UI.offBad = false; const m = $('.msg'); if (m) m.textContent = UI.offMsg;
    const stopBtn = $('[data-act=offscanstop]'); if (stopBtn) stopBtn.hidden = false;
    const cv = document.createElement('canvas'), cx = cv.getContext('2d', { willReadFrequently: true });
    const t0 = Date.now(); let last = null;
    while (Date.now() - t0 < 30000 && !scanStop) {
      let code = null;
      if (det) { const c = await det.detect(v).catch(() => []); code = c.length ? c[0].rawValue : null; }
      else if (v.videoWidth) {
        const W = Math.min(960, v.videoWidth), H = Math.round(v.videoHeight * W / v.videoWidth); cv.width = W; cv.height = H;
        cx.drawImage(v, 0, 0, W, H);
        const img = cx.getImageData(0, 0, W, H).data, grey = (x, y) => { const i = (y * W + x) * 4; return 0.299 * img[i] + 0.587 * img[i + 1] + 0.114 * img[i + 2]; };
        for (let f = 0.3; f <= 0.7 && !code; f += 0.05) { const y = Math.round(H * f), r = new Float32Array(W); for (let x = 0; x < W; x++) r[x] = grey(x, y); code = DFEan.decodeRow(r); }
        for (let f = 0.3; f <= 0.7 && !code; f += 0.1) { const x = Math.round(W * f), c = new Float32Array(H); for (let y = 0; y < H; y++) c[y] = grey(x, y); code = DFEan.decodeRow(c); }   // barcode held upright
      }
      if (code && (det || code === last)) { stream.getTracks().forEach(x => x.stop()); v.hidden = true; return offLookup(code); }
      last = code;
      await new Promise(r => setTimeout(r, det ? 300 : 120));
    }
    if (!scanStop) { UI.offMsg = t('own_scan_none'); UI.offBad = true; }
  } catch (e) { UI.offMsg = t('own_scan_err'); UI.offBad = true; }
  if (stream) stream.getTracks().forEach(x => x.stop());
  v.hidden = true; rerender();
}
async function ownSave() {
  const D = UI.own;
  const o = DFOff.checkOwn({ brand: D.brand, name: D.name, category: D.category, serving: { amount: D.amount, unit: D.unit }, choG: D.choG, sugarsG: D.sugarsG,
    sodiumMg: D.sodiumMg, sodiumBasis: D.sodiumBasis, caffeineMg: D.caffeineMg, kcal: D.kcal, proteinG: D.proteinG, fatG: D.fatG, fibreG: D.fibreG, mtc: D.mtc,
    waterMl: D.waterMl, powderG: D.powderG, allergens: D.allergens, traces: D.traces, labelChecked: D.labelChecked, offCode: D.offCode });
  if (!o) { UI.ownErr = !D.labelChecked ? t('own_need_check') : t('own_need'); return rerender(); }
  const id = D.id || 'own-' + Date.now().toString(36);
  await saveStock(id, { own: o });
  UI.own = null; UI.ownErr = ''; UI.offMsg = ''; location.hash = '#stock';
}

/* the pack list as plain text lines (also used by the fuel card and sticker) */
function packLines(M) {
  return M.pack.map(p => {
    if (p.refill) return t(M.bottles.some(b => b.content === 'drink') ? 'pack_refill' : 'pack_refill_water', { n: p.bottles });
    if (!p.bottle) return `${p.n}× ${itemName(p.id)}`;
    if (p.content === 'drink') return t('pack_drink', { n: p.bottles, name: itemName(p.id), d: ns(p.doses), ml: M.bottleMl }) + (p.powderG ? ` (${t('pack_powder', { g: ns(p.powderG) })})` : '');
    if (p.content === 'electrolyte') return t('pack_tab', { n: p.bottles, k: p.tabs, name: itemName(p.id) });
    return t('pack_water', { n: p.bottles, ml: M.bottleMl });
  });
}
/* pack list for one ride (matcher, MATCH-01..05) */
function packCard(M, T, ctx, C, needRefill) {
  const H = lang() === 'en' ? '/h' : '/u', R = DATA.rules.rules, hasStock = stockList().length > 0;
  let h = `<section class="card"><h2>${t('sec_pack')}</h2>`;
  if (!hasStock && T.cho.gph > 0) h += `<p>${t('pack_nostock')} <a href="#stock">${t('tab_stock')}</a></p>`;
  if (M.alternatives.length > 1) h += `<div class="fld"><span class="lbl">${t('plan_choose')}</span><div class="chips" role="group">${M.alternatives.map(a =>
    `<button type="button" class="chip" data-act="rset" data-f="planKind" data-v="${a.kind}" data-t="s" aria-pressed="${a.chosen}">${t('plan_' + a.kind)} · ${a.choGph} g${H}</button>`).join('')}</div></div>`;
  if (needRefill) h += `<div class="fld"><span class="lbl">${t('ride_refill')}</span>${chips('refillMin', [[0, t('refill_0')], [60, t('refill_n', { n: 60 })], [90, t('refill_n', { n: 90 })], [120, t('refill_n', { n: 120 })]], C.refillMin || 0, 'n', 'rset')}</div>`;
  const li = packLines(M).map(esc);
  if (li.length) h += `<ul class="plain">${li.map(x => `<li>${x}</li>`).join('')}</ul>`;
  if (hasStock && T.cho.gph > 0) h += `<p class="small muted">${t('pack_total', { c: M.totals.choGph, na: M.totals.naMgph, H })}</p>`;
  const strong = M.bottles.find(b => b.veryConcentrated);
  const warn = [];
  if (strong) warn.push(t('pack_strong', { g: strong.gPerL }));
  M.gaps.forEach(g => {
    if (g.what === 'cho' && hasStock) { if (g.shortG > 0) warn.push(t('gap_cho_short', { g: g.shortG })); if (g.overG > 0) warn.push(t('gap_cho_over', { g: g.overG })); }
    if (g.what === 'mtc') warn.push(t('gap_mtc', { g: g.glucoseOnlyGph, max: g.max }));
    if (g.what === 'sodium' && hasStock) warn.push(t('gap_na', { mg: g.shortMg }));
    if (g.what === 'fluid') warn.push(t('gap_fluid', { ml: g.shortMl }));
  });
  if (warn.length) h += `<ul class="plain small warnlist">${warn.map(x => `<li>${x}</li>`).join('')}</ul>`;
  const shop = (M.shopping || []).filter(s => s.for !== 'cho' || hasStock);
  if (shop.length) h += `<details class="inl"><summary>${t('shop')}</summary><ul class="plain small">${shop.map(s => s.items.map(i => `<li>${esc(itemName(i.id))}${i.n ? ` (${i.n}×)` : ''}</li>`).join('')).join('')}</ul></details>`;
  const ex = M.notes.filter(n => n.key === 'excluded');
  if (ex.length) h += `<ul class="plain small muted">${ex.map(n => `<li>${esc(itemName(n.p.id))}: ${t('excl_' + n.p.why)}</li>`).join('')}</ul>`;
  return h + '</section>';
}

/* ---------- profile, settings, about ---------- */
function vProfile() {
  const sec = (title, body, open) => `<details class="card"${open ? ' open' : ''}><summary>${title}</summary>${body}</details>`;
  return topbar(t('profile_t')) + sec(t('prof_body'), secBody(), true) + sec(t('prof_gut'), secGut()) + sec(t('prof_sweat'), secSweat()) + sec(t('prof_caf'), secCaf())
    + sec(t('prof_bottle'), secBottle()) + sec(t('prof_allergy'), secAllergy()) + sec(t('prof_health'), secHealth());
}
let deferredInstall = null;
const isStandalone = () => (window.matchMedia && matchMedia('(display-mode: standalone)').matches) || navigator.standalone === true;
const isIOS = () => /iphone|ipad|ipod/i.test(navigator.userAgent) || (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1);
function installCard() {
  if (isStandalone() || store.get('hideInstall', false)) return '';
  return `<div class="card notice"><h3>${t('install_t')}</h3><p class="small">${isIOS() ? t('install_ios') : t('install_and')}</p>
    <div class="row">${deferredInstall ? `<button class="btn primary" data-act="install">${t('install_now')}</button>` : ''}<button class="btn" data-act="hideinstall">${t('hide')}</button></div></div>`;
}
function vSettings() {
  return `${topbar(t('settings_t'))}
    <section class="card"><h2>${t('set_lang')}</h2>${chips('lang', [['nl', 'Nederlands'], ['en', 'English']], lang(), 's', 'lang')}</section>
    <section class="card"><h2>${t('set_icu')}</h2>${secIcu()}</section>
    <section class="card"><div class="fld"><label class="lbl" for="s-start">${t('set_start')}</label><span class="tin time"><input id="s-start" type="time" data-set="usualStart" value="${esc(SET.usualStart || '')}"></span><small class="muted">${t('set_start_hint')}</small></div></section>
    ${wxCard()}
    <section class="card"><h2>${t('set_backup')}</h2><p class="small">${t('bk_l')}</p>
      <div class="row"><button class="btn primary" data-act="bk">${t('bk_file')}</button>${ICU.key ? `<button class="btn" data-act="bkkey">${t('bk_file_key')}</button>` : ''}</div>
      ${ICU.key ? `<p class="small muted">${t('bk_key_warn')}</p>` : ''}
      <h3>${t('rs_t')}</h3><label class="btn"><input type="file" id="restorefile" accept=".json,application/json" hidden>${t('rs_pick')}</label>
      <p class="msg" id="bmsg" role="status"></p></section>
    <section class="card"><h2>${t('set_erase')}</h2><p class="small">${t('erase_l')}</p><div class="row"><button class="btn danger" data-act="erase">${t('set_erase')}</button></div></section>
    <p class="small muted center">${t('version', { a: APP_VERSION, r: DATA.rules.version, l: DATA.library ? DATA.library.version : '–' })}</p>`;
}
function vAbout() {
  const refs = Object.entries(DATA.rules.refs).filter(([k]) => k !== 'COACH').concat(DATA.food ? Object.entries(DATA.food.sources).map(([k, s]) => [k, { cite: s.cite + ' ' + s.url }]) : []);
  return `${topbar(t('about_t'))}
    <section class="card"><picture><source srcset="icons/logo-light.png" media="(prefers-color-scheme: dark)"><img class="logo-big" src="icons/logo-dark.png" alt="DynamVic Cycling coach"></picture>
      <p>${t('about_l')}</p><p class="small">${t('disclaimer')}</p></section>
    <section class="card"><h2>${t('privacy_t')}</h2><p class="small">${t('privacy')}</p></section>
    <section class="card"><h2>${t('ref_t')}</h2><ol class="refs">${refs.map(([k, r]) => `<li id="ref-${k}">${esc(r.cite)}${r.doi ? ` <a href="https://doi.org/${esc(r.doi)}" rel="noopener" target="_blank">doi:${esc(r.doi)}</a>` : ''}</li>`).join('')}</ol></section>
    <section class="card"><h2>${t('sources_t')}</h2><p class="small">${t('sources')}</p></section>
    <p class="small muted center">${t('version', { a: APP_VERSION, r: DATA.rules.version, l: DATA.library ? DATA.library.version : '–' })}</p>`;
}

/* ---------- router ---------- */
const VIEWS = { welcome: vWizard, rides: vRides, ride: vRide, add: vAdd, stock: vStock, own: vOwn, profile: vProfile, settings: vSettings, about: vAbout };
function route() {
  const v = $('#view'), tabs = $('nav.tabs');
  document.documentElement.lang = lang();
  if (ACT.state !== 'ok') { v.innerHTML = ACT.state === 'checking' ? '' : vLock(); tabs.hidden = true; return; }
  if (!DATA.rules) { v.innerHTML = DATA.err ? '<div class="card badc"><p>DynamFuel kon niet laden. Controleer je verbinding en probeer opnieuw. / DynamFuel could not load. Check your connection and try again.</p></div>' : ''; tabs.hidden = true; return; }
  let h = (location.hash || '#rides').slice(1), arg = null;
  const i = h.indexOf('/'); if (i > 0) { arg = decodeURIComponent(h.slice(i + 1)); h = h.slice(0, i); }
  if (!SET.onboarded) h = 'welcome';
  else if (h === 'welcome') h = 'rides';
  v.innerHTML = (VIEWS[h] || vRides)(arg);
  tabs.hidden = !SET.onboarded; v.classList.toggle('notabs', !SET.onboarded);
  const tab = h === 'ride' || h === 'add' ? 'rides' : h === 'own' ? 'stock' : h;   // stock has its own tab
  document.querySelectorAll('nav.tabs a').forEach(a => a.toggleAttribute('aria-current', a.dataset.tab === tab));
  document.querySelectorAll('nav.tabs [data-l]').forEach(s => { s.textContent = t(s.dataset.l); });
}
function rerender() { const y = scrollY; route(); scrollTo(0, y); }
document.addEventListener('toggle', ev => { if (ev.target && ev.target.id === 'cond') UI.condOpen = ev.target.open; }, true);
addEventListener('hashchange', () => { UI.err = {}; UI.icuMsg = ''; UI.addErr = ''; UI.condOpen = false; if (!/^#own/.test(location.hash)) { UI.own = null; UI.ownErr = ''; UI.offMsg = ''; } if (location.hash !== '#add') UI.add = null; route(); scrollTo(0, 0); });

/* ---------- sheet, toast, update banner ---------- */
function sheet(html) {
  const d = $('#sheet'); $('#sheetin').innerHTML = `<button class="iconbtn sheetx" data-act="closesheet" aria-label="${t('close')}">${IC.x}</button>${html}`;
  if (d.showModal) { if (!d.open) d.showModal(); } else d.setAttribute('open', '');
}
const closeSheet = () => { const d = $('#sheet'); if (d.open) d.close(); };
$('#sheet').addEventListener('click', e => { if (e.target === e.currentTarget) closeSheet(); });
function toast(msg, bad, ms) {
  let el = $('#toast'); if (!el) { el = document.createElement('div'); el.id = 'toast'; el.setAttribute('role', 'status'); document.body.appendChild(el); }
  el.className = 'toast' + (bad ? ' bad' : ''); el.textContent = msg; el.hidden = false;
  clearTimeout(toast.tm); toast.tm = setTimeout(() => { el.hidden = true; }, ms || 2600);
}
function showUpdateBanner() {
  if ($('#updbar')) return;
  const el = document.createElement('div'); el.id = 'updbar'; el.className = 'updbar'; el.setAttribute('role', 'status');
  el.innerHTML = `<span>${t('upd_new')}</span><button class="btn" data-act="updreload">${t('upd_reload')}</button>`;
  document.body.appendChild(el);
}

/* ---------- back-up and restore ---------- */
async function doBackup(withKey) {
  const data = BK.make({ settings: SET, profile: P, athlete: ATH, rides: [...RIDES.values()], items: [...STOCK.values()], plans: await DB.all('plans'), logs: await DB.all('logs'), icu: withKey ? ICU : null }, todayIso());
  const name = `dynamfuel-backup-${todayIso()}.json`, blob = new Blob([JSON.stringify(data)], { type: 'application/json' }), m = $('#bmsg');
  try {
    const file = new File([blob], name, { type: 'application/json' });
    if (navigator.canShare && navigator.canShare({ files: [file] })) { await navigator.share({ files: [file], title: 'DynamFuel back-up' }); if (m) m.textContent = t('bk_done'); return; }
  } catch (e) { if (e && e.name === 'AbortError') return; }
  const url = URL.createObjectURL(blob), a = document.createElement('a'); a.href = url; a.download = name; document.body.appendChild(a); a.click(); a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 4000); if (m) m.textContent = t('bk_done');
}
function restoreAsk(text) {
  let o; try { o = JSON.parse(text); } catch (e) { return toast(t('rs_err_read'), true); }
  const r = BK.check(o, thisYear());
  if (!r.ok) return toast(t(r.why === 'newer' ? 'rs_err_newer' : 'rs_err_format'), true);
  UI.restore = r;
  sheet(`<h2>${t('rs_t')}</h2><p>${t('rs_ask', { d: r.at ? F.date(r.at) : '?' })}</p><button class="btn primary big wide" data-act="rsgo">${t('rs_go')}</button>`);
}
async function doRestore() {
  const r = UI.restore; if (!r) return;
  store.set('prev', { at: todayIso(), settings: SET, profile: P, athlete: ATH, rides: [...RIDES.values()] });   // previous data kept aside
  const d = r.data;
  SET = Object.assign(d.settings, { onboarded: true }); P = d.profile; ATH = d.athlete;
  if (d.icu) ICU = d.icu;                                                // a back-up without key keeps the key already on this phone
  saveSet(); saveP(); saveIcu(); store.set('athlete', ATH);
  await DB.replace('rides', d.rides); await DB.replace('items', d.items); await DB.replace('plans', d.plans); await DB.replace('logs', d.logs);
  RIDES.clear(); d.rides.forEach(x => RIDES.set(x.id, x)); STOCK.clear(); d.items.forEach(x => STOCK.set(x.id, x));
  UI.restore = null; UI.wz = null; closeSheet(); location.hash = '#rides'; route();
  toast(r.fixed ? (r.fixed === 1 ? t('rs_fixed_1') : t('rs_fixed', { n: r.fixed })) : t('rs_done'));
}
async function eraseAll() {
  Object.keys(localStorage).filter(k => k.startsWith('dynamfuel:') && k !== 'dynamfuel:device' && k !== 'dynamfuel:act').forEach(k => localStorage.removeItem(k));
  await DB.drop();
  location.hash = '#welcome'; location.reload();
}

/* ---------- events ---------- */
function parseField(f, el) {
  if (el.type === 'checkbox') return { v: el.checked };
  if (el.dataset.kind === 'time') return { v: BK.isHHMM(el.value) ? el.value : null };
  const rg = RANGES()[f]; if (!rg) return { v: el.value };
  const s = String(el.value).trim().replace(',', '.');
  if (s === '') return { v: null };
  const x = +s;
  if (!isFinite(x) || x < rg[0] || x > rg[1]) return { err: t('err_range', { lo: ns(rg[0]), hi: ns(rg[1]) }) };
  return { v: f === 'birthYear' || f === 'bottleMl' ? Math.round(x) : x };
}
function commitProfile() { if (!UI.wz) { saveP(); toast(t('prof_saved')); } UI.wzErr = ''; }
async function saveRideChoice(id, f, v) {
  const C = Object.assign({ id }, RIDES.get(id) || {}); C[f] = v;
  if (v === null || v === undefined) delete C[f];
  const ok = BK.checkRide(C); if (!ok) return;
  RIDES.set(id, Object.assign(RIDES.get(id) || {}, C)); if (v == null) delete RIDES.get(id)[f];
  await DB.put('rides', RIDES.get(id));
}
const rideIdFromHash = () => { const m = /^#ride\/(.+)$/.exec(location.hash); return m ? decodeURIComponent(m[1]) : null; };

document.addEventListener('change', async ev => {
  const el = ev.target;
  if (el.id === 'restorefile' && el.files && el.files[0]) { const rd = new FileReader(); rd.onload = () => restoreAsk(String(rd.result || '')); rd.readAsText(el.files[0]); el.value = ''; return; }
  if (el.dataset.f) {
    const f = el.dataset.f, r = parseField(f, el), D = target();
    if (r.err) UI.err[f] = r.err; else { delete UI.err[f]; D[f] = r.v; if (f === 'ftpW' || f === 'massKg') D.src = Object.assign({}, D.src, { [f === 'ftpW' ? 'ftp' : 'mass']: 'local' }); commitProfile(); }
    return rerender();
  }
  if (el.dataset.icu) { ICU[el.dataset.icu] = el.value.trim(); saveIcu(); if (!UI.wz) toast(t('icu_saved_key')); return; }
  if (el.dataset.set) { SET[el.dataset.set] = BK.isHHMM(el.value) ? el.value : null; saveSet(); toast(t('saved')); return; }
  if (el.dataset.add) { UI.add[el.dataset.add] = el.value; return; }
  if (el.dataset.own && UI.own) {
    const D = UI.own, f = el.dataset.own;
    if (f === 'labelChecked') { D.labelChecked = el.checked; return; }
    if (f === 'name' || f === 'brand') { D[f] = el.value.trim(); return; }
    const s = String(el.value).trim().replace(',', '.'), x = +s, rg = OWN_NUM[f];
    if (s === '') { D[f] = null; delete UI.err['own_' + f]; }
    else if (!isFinite(x) || x < rg[0] || x > rg[1]) { UI.err['own_' + f] = t('err_range', { lo: ns(rg[0]), hi: ns(rg[1]) }); return rerender(); }
    else { D[f] = Math.round(x * 10) / 10; delete UI.err['own_' + f]; }
    if (f === 'saltG') { D.sodiumMg = D.saltG == null ? null : Math.round(D.saltG / 2.5 * 1000); D.sodiumBasis = 'calc from salt (own label)'; }
    if (PER_SERVING.includes(f)) D.typed = Object.assign({}, D.typed, { [f]: true });
    if (f === 'amount') ownApplyPer100(D);
    return rerender();
  }
  if (el.dataset.gid) {
    const id = el.dataset.gid, i = +el.dataset.gi, f = foodById(id); if (!f) return;
    const s = String(el.value).trim().replace(',', '.'), x = +s, g = (STOCK.get(id) || {}).grams ? STOCK.get(id).grams.slice() : f.parts.map(() => null);
    if (s === '') g[i] = null; else if (isFinite(x) && x > 0 && x <= 1000) g[i] = Math.round(x * 10) / 10; else { toast(t('err_range', { lo: 1, hi: 1000 }), true); return rerender(); }
    await saveStock(id, { grams: g }); return rerender();
  }
  if (el.dataset.sqid) { const n = parseInt(el.value, 10); await saveStock(el.dataset.sqid, { qty: isFinite(n) ? n : 0 }); return rerender(); }
  if (el.dataset.rf) {
    const id = rideIdFromHash(), f = el.dataset.rf; if (!id) return;
    if (f === 'start') await saveRideChoice(id, 'start', BK.isHHMM(el.value) ? el.value : null);
    if (f === 'tempC') {
      const s = el.value.trim().replace(',', '.'), x = +s;
      if (s === '') { delete UI.err.tempC; await saveRideChoice(id, 'tempC', null); }
      else if (!isFinite(x) || x < -30 || x > 50) UI.err.tempC = t('err_range', { lo: -30, hi: 50 });
      else { delete UI.err.tempC; await saveRideChoice(id, 'tempC', x); }
    }
    rerender();
  }
});
document.addEventListener('input', ev => { const el = ev.target; if (el.dataset && el.dataset.add && UI.add) UI.add[el.dataset.add] = el.value; });

document.addEventListener('click', async ev => {
  const el = ev.target.closest('[data-act]'); if (!el) return;
  const a = el.dataset.act;
  if (a === 'closesheet') return closeSheet();
  if (a === 'updreload') return location.reload();
  if (a === 'lang') { SET.lang = el.dataset.v; saveSet(); return rerender(); }
  if (a === 'setf') { const D = target(); D[el.dataset.f] = castV(el.dataset.v, el.dataset.t); delete UI.err[el.dataset.f]; commitProfile(); return rerender(); }
  if (a === 'togf') { const D = target(), f = el.dataset.f, v = el.dataset.v; D[f] = (D[f] || []).includes(v) ? D[f].filter(x => x !== v) : [...(D[f] || []), v]; commitProfile(); return rerender(); }
  if (a === 'wzback') { UI.wz.i = Math.max(0, UI.wz.i - 1); UI.wzErr = ''; UI.err = {}; route(); return scrollTo(0, 0); }
  if (a === 'wznext' || a === 'wzfinish') {
    const e = wzCheck(); if (e) { UI.wzErr = e; return rerender(); }
    UI.wzErr = '';
    if (a === 'wznext') { UI.wz.i++; route(); return scrollTo(0, 0); }
    P = UI.wz.d; saveP(); SET.onboarded = true; saveSet(); UI.wz = null; location.hash = '#rides'; route();
    if (ICU.key) fetchRides(true);
    return;
  }
  if (a === 'icutest') return icuTest();
  if (a === 'icudc') { const dc = dynamCoreKey(); if (dc) { ICU = dc; saveIcu(); UI.icuMsg = t('icu_dc_done'); UI.icuBad = false; rerender(); icuTest(); } return; }
  if (a === 'icuforget') { ICU = { key: '', athleteId: '' }; saveIcu(); UI.icuMsg = ''; return rerender(); }
  if (a === 'useath') { const D = target(); if (ATH.weightKg) D.massKg = ATH.weightKg; if (ATH.ftp) D.ftpW = ATH.ftp; D.src = Object.assign({}, D.src, { mass: 'icu', ftp: 'icu' }); commitProfile(); return rerender(); }
  if (a === 'fetch') return fetchRides();
  if (a === 'install' && deferredInstall) { deferredInstall.prompt(); deferredInstall = null; return; }
  if (a === 'hideinstall') { store.set('hideInstall', true); return rerender(); }
  if (a === 'sweatok') { P.sweatTestPrompted = true; saveP(); return rerender(); }
  if (a === 'rset') { const id = rideIdFromHash(); if (!id) return; await saveRideChoice(id, el.dataset.f, castV(el.dataset.v, el.dataset.t)); return rerender(); }
  if (a === 'rdel') { const id = rideIdFromHash(); if (id && id.startsWith('man-')) { RIDES.delete(id); await DB.del('rides', id); location.hash = '#rides'; } return; }
  if (a === 'addgoal') { UI.add.goal = el.dataset.v; return rerender(); }
  if (a === 'addsave') {
    const A = UI.add, dur = ((+A.h || 0) * 60 + (+A.m || 0)) * 60;
    const rec = BK.checkRide({ id: 'man-' + Date.now().toString(36), name: A.name.trim(), date: A.date, durationS: dur, goal: A.goal, start: BK.isHHMM(A.start) ? A.start : undefined });
    if (!rec || A.date < todayIso()) { UI.addErr = t('add_err'); return rerender(); }
    RIDES.set(rec.id, rec); await DB.put('rides', rec); UI.add = null; location.hash = '#ride/' + encodeURIComponent(rec.id); return;
  }
  if (a === 'sqty') { const s = STOCK.get(el.dataset.id) || { qty: 0 }; await saveStock(el.dataset.id, { qty: (s.qty || 0) + (+el.dataset.d) }); return rerender(); }
  if (a === 'sfav') { const s = STOCK.get(el.dataset.id) || {}; await saveStock(el.dataset.id, { fav: !s.fav }); return rerender(); }
  if (a === 'shide') { const s = STOCK.get(el.dataset.id) || {}; await saveStock(el.dataset.id, { hidden: !s.hidden }); return rerender(); }
  if (a === 'sfilter') { UI.stockFilter = el.dataset.v; return rerender(); }
  if (a === 'wxsearch') {
    const q = ($('#wxq').value || '').trim(); UI.wxQ = q; UI.wxPlaces = null; UI.wxBad = false; if (!q) return;
    UI.wxMsg = t('loading'); rerender();
    try { const res = await fetch(DFWeather.geoUrl(q, lang())); if (!res.ok) throw 0; UI.wxPlaces = DFWeather.places(await res.json()); UI.wxMsg = ''; }
    catch (e) { UI.wxMsg = t('wx_err'); UI.wxBad = true; }
    return rerender();
  }
  if (a === 'wxpick') { const pl = UI.wxPlaces && UI.wxPlaces[+el.dataset.i]; if (pl) { SET.location = pl; saveSet(); UI.wxPlaces = null; UI.wxQ = ''; UI.wxMsg = t('saved'); UI.wxBad = false; } return rerender(); }
  if (a === 'wxclear') { delete SET.location; saveSet(); return rerender(); }
  if (a === 'card' && UI.fuel) { const r = await DFCard.share(UI.fuel); if (r === 'saved') toast(t('card_saved')); return; }
  if (a === 'sticker' && UI.fuel) return DFCard.print(UI.fuel, esc);
  if (a === 'ownset' && UI.own) { const v = el.dataset.v; UI.own[el.dataset.f] = el.dataset.t === 'm' ? (v === 'true' ? true : null) : v; return rerender(); }
  if (a === 'owntog' && UI.own) { const f = el.dataset.f, v = el.dataset.v, L = UI.own[f]; UI.own[f] = L.includes(v) ? L.filter(x => x !== v) : L.concat(v); return rerender(); }
  if (a === 'offsearch' && UI.own) return offLookup($('#offcode').value);
  if (a === 'offscan' && UI.own) return offScan();
  if (a === 'offscanstop') { scanStop = true; return; }
  if (a === 'ownsave' && UI.own) return ownSave();
  if (a === 'owndel' && UI.own && UI.own.id) return sheet(`<h2>${t('own_del')}</h2><p>${esc(UI.own.name)}</p><button class="btn danger big wide" data-act="owndelgo">${t('own_del')}</button>`);
  if (a === 'owndelgo' && UI.own && UI.own.id) { const id = UI.own.id; STOCK.delete(id); await DB.del('items', id); closeSheet(); UI.own = null; location.hash = '#stock'; return; }
  if (a === 'bk' || a === 'bkkey') return doBackup(a === 'bkkey');
  if (a === 'rsgo') return doRestore();
  if (a === 'erase') return sheet(`<h2>${t('erase_sure')}</h2><p>${t('erase_l')}</p><button class="btn danger big wide" data-act="erasego">${t('erase_go')}</button>`);
  if (a === 'erasego') return eraseAll();
});

addEventListener('beforeinstallprompt', e => { e.preventDefault(); deferredInstall = e; if ((location.hash || '#rides') === '#rides') rerender(); });
const swOk = 'serviceWorker' in navigator && (location.protocol === 'https:' || location.hostname === 'localhost');
if (swOk) {
  addEventListener('load', () => {
    navigator.serviceWorker.register('sw.js').then(() => navigator.serviceWorker.ready).then(reg => {
      // an old DynamCore may have deleted this site's cache: the worker adds every core file that is missing
      if (reg.active) reg.active.postMessage('recache');
    }).catch(() => { });
  });
  const hadController = !!navigator.serviceWorker.controller;
  navigator.serviceWorker.addEventListener('controllerchange', () => { if (hadController) showUpdateBanner(); });
  const checkUpdate = () => navigator.serviceWorker.getRegistration().then(r => r && r.update()).catch(() => { });
  document.addEventListener('visibilitychange', () => { if (document.visibilityState === 'visible') checkUpdate(); });
  setInterval(checkUpdate, 30 * 60 * 1000);
}
try { if (navigator.storage && navigator.storage.persist) navigator.storage.persist().catch(() => { }); } catch (e) { }

/* ---------- start ---------- */
(async function boot() {
  document.documentElement.lang = lang();
  await checkActivation(todayIso());
  try {
    const [r, l] = await Promise.all([fetch('data/rules.json').then(x => x.json()), fetch('data/library.json').then(x => x.json())]);
    DATA.rules = r; DATA.library = l;
    try { DATA.food = await fetch('data/food.json').then(x => x.json()); } catch (e) { DATA.food = null; }
    try { DATA.caffeine = await fetch('data/caffeine.json').then(x => x.json()); } catch (e) { DATA.caffeine = null; }
  } catch (e) { DATA.err = true; }
  try { EVENTS = await DB.all('events'); (await DB.all('rides')).forEach(x => RIDES.set(x.id, x)); (await DB.all('items')).forEach(x => STOCK.set(x.id, x)); } catch (e) { }
  route();
  // tell the athlete once that a new version is running (the banner only shows when the update arrives while the app is open)
  const seen = store.get('seenVersion', null);
  if (seen && seen !== APP_VERSION && SET.onboarded) toast(t('upd_done', { v: APP_VERSION }), false, 5000);
  store.set('seenVersion', APP_VERSION);
  if (SET.onboarded && ICU.key) fetchRides(true);
})();
