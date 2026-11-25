'use strict';
/* DynamFuel – user interface (Phase 2: onboarding, profile, Intervals.icu read, rides, targets, back-up, About).
   Logic lives in the pure modules: workout.js (parser), engine.js (targets), rides.js (events → rides), backup.js (checks).
   Storage: localStorage keys 'dynamfuel:*' (settings, profile, icu, athlete, meta) and IndexedDB 'dynamfuel-db' (db.js).
   Everything stays on this phone; the only network calls go to Intervals.icu with the athlete's own key. */

const APP_VERSION = '0.2.0';
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
  const prof = Object.assign({}, P, { ftpW: P.ftpW || (ATH && ATH.ftp) || null });
  const doc = RD.workoutDoc(r, ATH, prof, ctx.goalTag && ctx.goalTag !== 'trainlow' ? ctx.goalTag : ctx.goalChoice || 'endurance');
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
    <div class="fld"><label class="lbl" for="r-temp">${t('ride_temp')} (${t('optional')})</label><span class="tin"><input id="r-temp" type="text" inputmode="decimal" data-rf="tempC" value="${esc(ns(C.tempC))}"><span>°C</span></span><span class="err" role="alert">${UI.err.tempC || ''}</span></div>
    <div class="fld"><span class="lbl">${t('ride_next')}</span>${chips('next8h', [[true, t('yes')], [false, t('no')]], ctx.next8h, 'b', 'rset')}${X.found ? `<small class="muted">${t('ride_next_found')}</small>` : ''}</div>
    ${!r.structured ? `<p class="small muted">${t('ride_manual_int', { z: doc.manualZone })}</p>` : ''}
    ${r.source === 'man' ? `<button class="btn danger" data-act="rdel">${t('ride_delete')}</button>` : ''}
    ${r.description ? `<details class="inl"><summary>${t('ride_desc')}</summary><p class="small" style="white-space:pre-wrap">${esc(r.description)}</p></details>` : ''}</details>`;

  /* during */
  const c = T.cho, fl = T.fluid, na = T.sodium, bottleMl = P.bottleMl;
  const nBottles = bottleMl && fl.totalMl ? Math.ceil(fl.totalMl / bottleMl - 1e-9) : 0;
  const notes = [];
  if (c.gph === 0 && !c.optional) notes.push(t('cho_zero'));
  if (c.optional) notes.push(t('cho_opt', { lo: c.lo, hi: c.hi }));
  if (c.mtcRequired) notes.push(t('cho_mtc', { max: R.rules['CHO-MTC-01'].glucoseOnlyMaxGph }));
  if (c.gutAdvice) notes.push(t('cho_gut', { guide: c.guideline, tol: ns(P.gutCapGph) }));
  if (T.warnings.includes('notolerance')) notes.push(`${t('cho_notol')} <a href="#profile">${t('tab_profile')}</a>`);
  if (nBottles) notes.push(t('bottles_n', { n: nBottles, ml: bottleMl }) + (!ctx.indoor && P.cages != null && nBottles > P.cages ? ` – ${t('bottles_refill', { c: P.cages })}` : ''));
  if (T.warnings.includes('heat_cool_drinks')) notes.push(t('w_heat', { c: R.rules['HEAT-01'].coolC }));
  if (r.carbsPerHour) notes.push(t('ride_carbs_icu', { g: ns(r.carbsPerHour) }));
  h += `<section class="card"><h2>${t('sec_during')}</h2><div class="big3">
    <div class="tile"><span class="k">${t('cho')}</span><span class="v">${c.gph}<small> g${hpart}</small></span><span class="s">${c.gph || c.optional ? t('range', { lo: c.lo, hi: c.hi }) : ''}</span>${statusPill(c.status)}</div>
    <div class="tile"><span class="k">${t('fluid')}</span><span class="v">${fl.mlph}<small> ml${hpart}</small></span><span class="s">${t('total_ml', { ml: fl.totalMl })}</span>${statusPill(fl.status)}</div>
    <div class="tile"><span class="k">${t('sodium')}</span><span class="v">${na.none ? '–' : na.mgph}<small>${na.none ? '' : ' mg' + hpart}</small></span><span class="s">${na.none ? t('na_none') : t('na_perl', { mg: na.mgPerL })}</span>${statusPill(na.status)}</div></div>
    ${c.gph ? `<p class="small muted">${t('total_g', { g: c.totalG })}</p>` : ''}
    ${notes.length ? `<ul class="plain small">${notes.map(x => `<li>${x}</li>`).join('')}</ul>` : ''}
    <div class="fld"><span class="lbl">${t('caffeine_t')} ${T.caffeine.on || T.caffeine.optional ? statusPill(T.caffeine.status) : ''}</span>${cafText(T.caffeine)}</div>
    <p class="small muted">${t('pack_later')}</p></section>`;

  /* timing */
  const every = R.rules['TIME-02'].everyMin, drinkMl = F.roundTo(fl.mlph * every / 60, R.rules['RND-01'].fluidMl);
  h += `<section class="card"><h2>${t('sec_timing')}</h2>${T.slots.length ? `<div class="slots">${T.slots.map(s => `<div class="slotr"><b>${X.start ? F.clock(X.start, s.min) : t('slot_min', { m: s.min })}</b>
    <span>${s.sustained ? t('slot_sustained') : s.easy ? t('slot_food') : t('slot_gel')}${drinkMl ? ` · ${t('slot_drink', { ml: drinkMl })}` : ''}</span></div>`).join('')}</div>` : `<p class="muted">${t('slot_none')}</p>`}</section>`;

  /* before / after / energy */
  h += `<section class="card"><h2>${t('sec_before')}</h2>${preText(T.pre)}</section>`;
  h += `<section class="card"><h2>${t('sec_after')}</h2>${postText(T.post)}</section>`;
  if (T.energy.kJ) h += `<section class="card"><h2>${t('sec_energy')}</h2><p class="small">${t('energy', { kj: T.energy.kJ, k1: T.energy.kcal[0], k2: T.energy.kcal[1] })}</p></section>`;

  /* why */
  const ids = [];
  [c.rules, fl.rules, na.rules, T.caffeine.rules, T.pre.rules, T.post.rules, ...T.slots.map(s => s.rules), T.energy.rules, T.intensity.rules].forEach(l => (l || []).forEach(x => { if (!ids.includes(x)) ids.push(x); }));
  h += `<details class="card"><summary>${t('sec_why')}</summary><p class="small muted">${t('why_rules')}</p><div class="why">${ids.map(id => {
    const ru = R.rules[id] || {}; return `<div class="r${ru.status === 'open' ? ' open' : ''}"><span>${esc(ruleText(id))}</span><span><code>${id}</code> ${ru.status === 'open' ? `<span class="pill open">${t('open_badge')}</span>` : ru.status === 'coach' ? `<span class="pill coach">${t('coach_badge')}</span>` : ''}</span></div>`; }).join('')}</div>
    <p class="small"><a href="#about">${t('ref_t')}</a></p></details>`;
  return h;
}
function cafText(cf) {
  if (cf.optional) return `<p>${t('caf_opt')}</p>`;
  if (cf.off) return `<p class="muted">${t('caf_off_' + cf.off)}</p>`;
  const out = cf.doses.map(d => d.clock ? t('caf_on', { mg: d.mg, mgkg: ns(d.mgkg), clock: d.clock }) + (d.atMin < 0 ? ` (${t('caf_before', { n: -d.atMin })})` : '')
    : d.atMin < 0 ? `${d.mg} mg (${ns(d.mgkg)} mg/kg) – ${t('caf_before', { n: -d.atMin })}` : t('caf_at', { mg: d.mg, mgkg: ns(d.mgkg), min: d.atMin }));
  cf.dropped.forEach(d => out.push(t('caf_dropped', { mg: d.mg, clock: d.clock || '' })));
  if (!cf.doses.some(d => d.clock) && cf.doses.length && !cf.rules.includes('CAF-06')) out.push(t('caf_notime'));
  return `<ul class="plain">${out.map(x => `<li>${x}</li>`).join('')}</ul>`;
}
function preText(p) {
  if (!p.applies) return `<p>${t('pre_short')}</p>`;
  const win = p.window ? ' ' + t('pre_window', { a: p.window[0], b: p.window[1] }) : '';
  const fwin = p.fluidWindow ? t('pre_window', { a: p.fluidWindow[0], b: p.fluidWindow[1] }) : '';
  const lines = [];
  if (!p.g) lines.push(t('w_nomass'));
  else if (p.kind === 'normal') lines.push(t('pre_normal', { g: p.g[0], gkg: ns(p.gkg[0]), h1: p.hoursBefore[0], h2: p.hoursBefore[1] }) + (p.window ? ` (${t('pre_window', { a: p.window[0], b: p.window[1] })})` : ''));
  else lines.push(t('pre_fuel', { g1: p.g[0], g2: p.g[1], k1: ns(p.gkg[0]), k2: ns(p.gkg[1]) }) + win);
  if (p.fluidMl) lines.push(t('pre_fluid', { a: p.fluidMl[0], b: p.fluidMl[1], w: fwin }));
  return `<ul class="plain">${lines.map(x => `<li>${x}</li>`).join('')}</ul>`;
}
function postText(p) {
  const lines = [];
  if (p.kind === 'water') lines.push(t('post_water'));
  else if (p.kind === 'rapid') lines.push(p.choGph ? t('post_rapid', { g1: p.choGph[0], g2: p.choGph[1], h: p.hours, p: p.proteinG }) : t('w_nomass'));
  else lines.push(p.proteinG ? t('post_normal', { p1: p.proteinG[0], p2: p.proteinG[1], h: p.withinH }) : t('w_nomass'));
  lines.push(p.rehydrateMl ? t('post_rehyd_ml', { a: p.rehydrateMl[0], b: p.rehydrateMl[1] }) : t('post_rehyd'));
  return `<ul class="plain">${lines.map(x => `<li>${x}</li>`).join('')}</ul>`;
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
    <section class="card"><h2>${t('set_backup')}</h2><p class="small">${t('bk_l')}</p>
      <div class="row"><button class="btn primary" data-act="bk">${t('bk_file')}</button>${ICU.key ? `<button class="btn" data-act="bkkey">${t('bk_file_key')}</button>` : ''}</div>
      ${ICU.key ? `<p class="small muted">${t('bk_key_warn')}</p>` : ''}
      <h3>${t('rs_t')}</h3><label class="btn"><input type="file" id="restorefile" accept=".json,application/json" hidden>${t('rs_pick')}</label>
      <p class="msg" id="bmsg" role="status"></p></section>
    <section class="card"><h2>${t('set_erase')}</h2><p class="small">${t('erase_l')}</p><div class="row"><button class="btn danger" data-act="erase">${t('set_erase')}</button></div></section>
    <p class="small muted center">${t('version', { a: APP_VERSION, r: DATA.rules.version, l: DATA.library ? DATA.library.version : '–' })}</p>`;
}
function vAbout() {
  const refs = Object.entries(DATA.rules.refs).filter(([k]) => k !== 'COACH');
  return `${topbar(t('about_t'))}
    <section class="card"><picture><source srcset="icons/logo-light.png" media="(prefers-color-scheme: dark)"><img class="logo-big" src="icons/logo-dark.png" alt="DynamVic Cycling coach"></picture>
      <p>${t('about_l')}</p><p class="small">${t('disclaimer')}</p></section>
    <section class="card"><h2>${t('privacy_t')}</h2><p class="small">${t('privacy')}</p></section>
    <section class="card"><h2>${t('ref_t')}</h2><ol class="refs">${refs.map(([k, r]) => `<li id="ref-${k}">${esc(r.cite)}${r.doi ? ` <a href="https://doi.org/${esc(r.doi)}" rel="noopener" target="_blank">doi:${esc(r.doi)}</a>` : ''}</li>`).join('')}</ol></section>
    <section class="card"><h2>${t('sources_t')}</h2><p class="small">${t('sources')}</p></section>
    <p class="small muted center">${t('version', { a: APP_VERSION, r: DATA.rules.version, l: DATA.library ? DATA.library.version : '–' })}</p>`;
}

/* ---------- router ---------- */
const VIEWS = { welcome: vWizard, rides: vRides, ride: vRide, add: vAdd, profile: vProfile, settings: vSettings, about: vAbout };
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
  const tab = h === 'ride' || h === 'add' ? 'rides' : h;
  document.querySelectorAll('nav.tabs a').forEach(a => a.toggleAttribute('aria-current', a.dataset.tab === tab));
  document.querySelectorAll('nav.tabs [data-l]').forEach(s => { s.textContent = t(s.dataset.l); });
}
function rerender() { const y = scrollY; route(); scrollTo(0, y); }
document.addEventListener('toggle', ev => { if (ev.target && ev.target.id === 'cond') UI.condOpen = ev.target.open; }, true);
addEventListener('hashchange', () => { UI.err = {}; UI.icuMsg = ''; UI.addErr = ''; UI.condOpen = false; if (location.hash !== '#add') UI.add = null; route(); scrollTo(0, 0); });

/* ---------- sheet, toast, update banner ---------- */
function sheet(html) {
  const d = $('#sheet'); $('#sheetin').innerHTML = `<button class="iconbtn sheetx" data-act="closesheet" aria-label="${t('close')}">${IC.x}</button>${html}`;
  if (d.showModal) { if (!d.open) d.showModal(); } else d.setAttribute('open', '');
}
const closeSheet = () => { const d = $('#sheet'); if (d.open) d.close(); };
$('#sheet').addEventListener('click', e => { if (e.target === e.currentTarget) closeSheet(); });
function toast(msg, bad) {
  let el = $('#toast'); if (!el) { el = document.createElement('div'); el.id = 'toast'; el.setAttribute('role', 'status'); document.body.appendChild(el); }
  el.className = 'toast' + (bad ? ' bad' : ''); el.textContent = msg; el.hidden = false;
  clearTimeout(toast.tm); toast.tm = setTimeout(() => { el.hidden = true; }, 2600);
}
function showUpdateBanner() {
  if ($('#updbar')) return;
  const el = document.createElement('div'); el.id = 'updbar'; el.className = 'updbar'; el.setAttribute('role', 'status');
  el.innerHTML = `<span>${t('upd_new')}</span><button class="btn" data-act="updreload">${t('upd_reload')}</button>`;
  document.body.appendChild(el);
}

/* ---------- back-up and restore ---------- */
async function doBackup(withKey) {
  const data = BK.make({ settings: SET, profile: P, athlete: ATH, rides: [...RIDES.values()], items: await DB.all('items'), plans: await DB.all('plans'), logs: await DB.all('logs'), icu: withKey ? ICU : null }, todayIso());
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
  RIDES.clear(); d.rides.forEach(x => RIDES.set(x.id, x));
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
  } catch (e) { DATA.err = true; }
  try { EVENTS = await DB.all('events'); (await DB.all('rides')).forEach(x => RIDES.set(x.id, x)); } catch (e) { }
  route();
  if (SET.onboarded && ICU.key) fetchRides(true);
})();
