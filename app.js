'use strict';
/* DynamCore – user interface. Data: exercises.js, engine.js, i18n.js. Everything is stored on this phone only. */

const VERSION = '2.3.0';
const $ = (s, r = document) => r.querySelector(s);
const esc = s => String(s ?? '').replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
const clone = o => JSON.parse(JSON.stringify(o));

/* ---------- storage ---------- */
const store = {
  get(k, d) { try { const v = localStorage.getItem('dc:' + k); return v == null ? d : JSON.parse(v); } catch (e) { return d; } },
  set(k, v) { try { localStorage.setItem('dc:' + k, JSON.stringify(v)); } catch (e) { } }
};
let P = store.get('profile', null);
let S = Object.assign({ weekOv: {}, logs: [], tests: [], suggest: null, hideInstall: false, challenges: [] }, store.get('state', {}));
/* Data migrations, run at start-up and after a restore. Each one runs once and only adds what is missing.
   v1.7: RPE scale is now 1–10: an old RPE 0 becomes 1 (nothing else changes).
   v2.0: pauses are kept as periods (P.pauses); weeks that have started are frozen (S.weekSnap, see engine.js freezeWeeks).
   v2.0.1 (every start-up, harmless when nothing is wrong): remove sessions that v2.0 saved twice, remove weeks frozen during a
   running pause, put routines in the plan week of their date, and plan the deletion in Intervals.icu of planned workouts
   whose session no longer exists.
   v2.1 (data version 4): S.engFrom = first plan week built with the new session builder (structured variation). Coach
   decision O4a: an athlete who already logged sessions switches at the start of the next block, so the current block
   keeps its arc; without logged sessions the new builder is used from week 1. Weeks before S.engFrom keep the v2.0.1
   builder, so what they show does not change. From v2.1 every completed session also stores its exercises (log.ses). */
function firstV2Week() {
  const started = (S.logs || []).some(l => l && l.type && l.type !== 'GROUP');
  const cw = planWeekOf(P, today());
  if (!started || cw < 1) return 1;
  const k = (+P.rk || 0) > 0 ? +P.rk : 4;
  return (Math.floor((cw - 1) / k) + 1) * k + 1;
}
function migrateData() {
  if (!S.rpe110) { (S.logs || []).forEach(l => { if (l.rpe === 0) l.rpe = 1; }); S.rpe110 = true; }
  if (!S.weekSnap || typeof S.weekSnap !== 'object' || Array.isArray(S.weekSnap)) S.weekSnap = {};
  if (P && !Array.isArray(P.pauses)) P.pauses = [];
  if (!S.blkSwaps || typeof S.blkSwaps !== 'object' || Array.isArray(S.blkSwaps)) S.blkSwaps = {};
  if (!P || !P.start) { S.dataV = 4; if (!Number.isFinite(S.engFrom)) S.engFrom = 1; return; }
  repairSnaps(S, isDone);
  if (P.paused != null) { const wp = planWeekOf(P, P.paused); Object.keys(S.weekSnap).forEach(k => { if (+k > wp) delete S.weekSnap[k]; }); }
  routinesByDate();
  if ((S.dataV || 0) < 3) { orphanSweep(); S.dataV = 3; }
  if ((S.dataV || 0) < 4 || !Number.isFinite(S.engFrom)) { if (!Number.isFinite(S.engFrom)) S.engFrom = firstV2Week(); S.dataV = 4; }
}
/* routines (keys R-…) belong to the plan week of their date (coach 19-11-2026: also when done during a pause) */
function routinesByDate() { (S.logs || []).forEach(l => { if (String(l.key).startsWith('R-') && Number.isFinite(l.d)) l.w = planWeekOf(P, l.d); }); }
/* planned workouts in Intervals.icu whose session is no longer in the plan (e.g. the v2.0 duplicates) → delete them */
function orphanSweep() {
  const pre = `dynamcore-${P.start}-w`; S.icuDelPending = S.icuDelPending || [];
  Object.entries(S.icuSent || {}).forEach(([ext, v]) => {
    if (!ext.startsWith(pre) || !v || v.id == null) return;
    const m = /^w(\d+)-(.+)$/.exec(ext.slice(pre.length - 1)); if (!m) return;
    const w = +m[1], key = m[2];
    if (weekPlan(P, S, w).slots.some(x => x.key === key) || S.logs.some(l => l.w === w && l.key === key)) return;
    if (!S.icuDelPending.some(x => x.ext === ext)) S.icuDelPending.push({ ext, id: v.id });
  });
}
async function icuCleanup() {
  if (!P || !S.icuDelPending || !S.icuDelPending.length || !P.icuKey || !String(P.icuKey).trim()) return;
  for (const x of [...S.icuDelPending]) {
    try { await icuFetch(`/events/${x.id}`, { method: 'DELETE' }); }
    catch (e) { if (!(e.code === 'http' && e.status === 404)) continue; }   // not reachable now: try again next time
    S.icuDelPending = S.icuDelPending.filter(y => y.ext !== x.ext); if (S.icuSent) delete S.icuSent[x.ext];
  }
  saveAll();
}
const saveAll = () => { store.set('profile', P); store.set('state', S); };
try { navigator.storage && navigator.storage.persist && navigator.storage.persist(); } catch (e) { }
/* freeze the weeks that have started; called at start-up and before every change that could move sessions */
function freezeNow() { if (!P || !P.start) return; try { if (freezeWeeks(P, S, today(), isDone)) saveAll(); } catch (e) { console.warn('freeze', e); } }

/* ---------- language ---------- */
const lang = () => (P && P.lang) || (UI.wz && UI.wz.d.lang) || UI.lockLang || 'nl';
function t(k, v) {
  let s = (I18N[lang()] && I18N[lang()][k]) ?? I18N.nl[k] ?? k;
  if (v && typeof s === 'string') for (const x in v) s = s.split(`{${x}}`).join(v[x]);
  return s;
}
/* v2.3: singular form when the count is 1 (key + '_1' in i18n.js, e.g. "1 volledige week" instead of "1 volledige weken") */
function tn(k, n, v) { const one = +n === 1 && ((I18N[lang()] && I18N[lang()][k + '_1']) ?? I18N.nl[k + '_1']) !== undefined; return t(one ? k + '_1' : k, { n, ...(v || {}) }); }
const exName = id => EXMAP[id] ? EXMAP[id].n[lang()] : id;
function fmtDose(d) {
  const side = d.side ? t('per_side') : '';
  if (d.k === 'r') return `${d.n}${side}`;
  if (d.k === 't') return (d.n >= 60 && d.n % 60 === 0 ? `${d.n / 60} ${t('min')}` : `${d.n} ${t('sec')}`) + side;
  return `${d.n} ${t('breaths')}`;
}
const dayName = (i, full) => (full ? t('daysF') : t('days'))[i];

/* ---------- UI state ---------- */
const UI = { viewWeek: null, sess: null, wz: null, libCat: 'all', libQ: '', libMine: true, testW: null, sw: null, resetArmed: false, extraType: 'CORE', settingsD: null };
const today = () => DN.today();
const curWeek = () => P ? planWeekOf(P, today()) : 1;
const RPE_TARGET = { CORE: '5–7', LEG: '5–7', MOB: '2–4', ACT: '3–5', REC: '1–3', GROUP: '' };
document.documentElement.lang = lang();

/* ---------- icons ---------- */
const IC = {
  left: '<svg viewBox="0 0 24 24"><path d="M15 6l-6 6 6 6"/></svg>',
  right: '<svg viewBox="0 0 24 24"><path d="M9 6l6 6-6 6"/></svg>',
  gear: '<svg viewBox="0 0 24 24"><circle cx="12" cy="12" r="3"/><path d="M12 2v3M12 19v3M4.2 4.2l2.1 2.1M17.7 17.7l2.1 2.1M2 12h3M19 12h3M4.2 19.8l2.1-2.1M17.7 6.3l2.1-2.1"/></svg>',
  check: '<svg viewBox="0 0 24 24"><path d="M5 12l5 5 9-10"/></svg>',
  swap: '<svg viewBox="0 0 24 24"><path d="M7 4L3 8l4 4M3 8h14M17 20l4-4-4-4M21 16H7"/></svg>',
  play: '<svg viewBox="0 0 24 24"><path d="M7 4l13 8-13 8z"/></svg>',
  plus: '<svg viewBox="0 0 24 24"><path d="M12 5v14M5 12h14"/></svg>',
  x: '<svg viewBox="0 0 24 24"><path d="M6 6l12 12M18 6L6 18"/></svg>',
  sound: '<svg viewBox="0 0 24 24"><path d="M4 9h4l5-4v14l-5-4H4z"/><path d="M16 9a4 4 0 0 1 0 6M19 6a8 8 0 0 1 0 12"/></svg>',
  mute: '<svg viewBox="0 0 24 24"><path d="M4 9h4l5-4v14l-5-4H4z"/><path d="M17 9l5 6M22 9l-5 6"/></svg>',
  watch: '<svg viewBox="0 0 24 24"><circle cx="12" cy="13" r="8"/><path d="M12 9v4l2.5 2.5M9.5 2.5h5M19 6l-1.5 1.5"/></svg>',   // v2.3: SVG instead of the ⏱ glyph
  stop: '<svg viewBox="0 0 24 24"><rect x="6.5" y="6.5" width="11" height="11" rx="2" fill="currentColor"/></svg>',
  more: '<svg viewBox="0 0 24 24"><circle cx="5" cy="12" r="1.6" fill="currentColor"/><circle cx="12" cy="12" r="1.6" fill="currentColor"/><circle cx="19" cy="12" r="1.6" fill="currentColor"/></svg>'
};
const EQIC = {
  db: '<svg viewBox="0 0 24 24"><path d="M6.5 7v10M17.5 7v10M3.5 9.5v5M20.5 9.5v5M6.5 12h11"/></svg>',
  kb: '<svg viewBox="0 0 24 24"><path d="M8.5 9a3.5 3.5 0 1 1 7 0"/><circle cx="12" cy="15" r="6"/></svg>',
  band: '<svg viewBox="0 0 24 24"><path d="M4 7c4-4 12 10 16 6M4 11c4-4 12 10 16 6"/></svg>',
  miniband: '<svg viewBox="0 0 24 24"><ellipse cx="12" cy="12" rx="8" ry="5"/><ellipse cx="12" cy="12" rx="5.5" ry="2.8"/></svg>',
  roller: '<svg viewBox="0 0 24 24"><ellipse cx="6" cy="12" rx="2.5" ry="5"/><path d="M6 7h12M6 17h12"/><ellipse cx="18" cy="12" rx="2.5" ry="5"/></svg>',
  ball: '<svg viewBox="0 0 24 24"><circle cx="12" cy="12" r="5"/><path d="M8.5 8.5c2 1.5 2 5.5 0 7M15.5 8.5c-2 1.5-2 5.5 0 7"/></svg>',
  swiss: '<svg viewBox="0 0 24 24"><circle cx="12" cy="11" r="8"/><path d="M8 20h8"/></svg>',
  bench: '<svg viewBox="0 0 24 24"><path d="M3 10h18M6 10v7M18 10v7M5 14h14"/></svg>',
  gym: '<svg viewBox="0 0 24 24"><path d="M3 21V9l9-5 9 5v12M8 21v-6h8v6"/></svg>'
};
const eqIcons = (list, labels) => list.length ? `<span class="eqi${labels ? ' lab' : ''}">${list.map(x => `<span class="eq" title="${t('eq_' + x)}">${EQIC[x] || ''}${labels ? `<small>${t('eq_' + x)}</small>` : ''}</span>`).join('')}</span>` : '';

/* ---------- small renderers ---------- */
const chip = (act, attrs, on, label) => `<button type="button" class="chip" data-act="${act}" ${attrs} aria-pressed="${!!on}">${label}</button>`;
const typeColor = ty => `var(--t-${ty})`;
const lvlDots = l => `<span class="dots" aria-label="${t('level')} ${l}">${[1, 2, 3].map(i => `<i class="${i <= l ? 'on' : ''}"></i>`).join('')}</span>`;
function topbar(title, opts = {}) {
  return `<header class="topbar">${opts.back ? `<button class="iconbtn" data-act="back" aria-label="${t('back')}">${IC.left}</button>` : `<picture class="brand"><source srcset="icons/logo-light.png" media="(prefers-color-scheme: dark)"><img src="icons/logo-dark.png" alt="DynamVic"></picture>`}
    <h1>${esc(title)}</h1>${opts.gear !== false ? `<button class="iconbtn" data-act="go" data-to="settings" aria-label="${t('settings')}">${IC.gear}</button>` : '<span class="sp"></span>'}</header>`;
}

/* ---------- profile defaults & fields (shared by wizard and settings) ---------- */
function defaultProfile() {
  const td = today(), mon = DN.dow(td) === 0 ? td : DN.monday(td) + 7;
  return { lang: UI.lockLang || 'nl', accepted: false, name: '', rider: ['road'], complaints: [], eq: [], perWeek: 3, days: [0, 3, 5], group: { on: false, day: 1, focus: ['legs'] },
    hardBike: [], dur: 30, start: DN.iso(mon), rk: 4, races: [], icsTime: '19:00', level: null, adj: {}, blocked: [], voice: true, travelAlways: false, phaseOverride: 'auto', paused: null, pauses: [] };
}
const OPT = {
  rider: ['road', 'crit', 'gravel', 'mtb', 'tri'],
  complaints: ['back', 'knee', 'shoulder', 'neck', 'hip'],
  eq: ['roller', 'ball', 'miniband', 'band', 'db', 'kb', 'swiss', 'bench', 'gym'],
  focus: ['strength', 'legs', 'core', 'mobility', 'back']
};
function field(D, name) {
  const multi = (list, sel, lab) => `<div class="chips">${list.map(v => chip('fchip', `data-f="${name}" data-v="${v}"`, sel.includes(v), lab(v))).join('')}</div>`;
  const single = (list, val, lab, f = name) => `<div class="chips">${list.map(v => chip('fset', `data-f="${f}" data-v="${v}"`, String(val) === String(v), lab(v))).join('')}</div>`;
  switch (name) {
    case 'lang': return `<div class="fld"><span class="lbl">${t('wz_lang')}</span>${single(['nl', 'en'], D.lang, v => v === 'nl' ? 'Nederlands' : 'English')}</div>`;
    case 'name': return `<label class="fld"><span class="lbl">${t('wz_name')} <small>(${t('optional')})</small></span><input id="f-name" data-field="name" value="${esc(D.name)}" autocomplete="given-name"></label>`;
    case 'rider': return `<div class="fld"><span class="lbl">${t('wz_rider')}</span>${multi(OPT.rider, D.rider, v => t('rider_' + v))}</div>`;
    case 'complaints': return `<div class="fld"><span class="lbl">${t('wz_complaints')}</span>${multi(OPT.complaints, D.complaints, v => t('cmp_' + v))}<small class="muted">${t('wz_complaints_note')}</small></div>`;
    case 'eq': return `<div class="fld"><span class="lbl">${t('wz_eq')}</span>${multi(OPT.eq, D.eq, v => t('eq_' + v))}<small class="muted">${t('eq_none_note')}</small></div>`;
    case 'perWeek': return `<div class="fld"><span class="lbl">${t('wz_per_week')}</span>${single([2, 3, 4, 5], D.perWeek, v => v)}</div>`;
    case 'days': {
      const need = D.perWeek - (D.group.on ? 1 : 0), have = D.days.filter(d => !(D.group.on && +d === +D.group.day)).length;
      return `<div class="fld"><span class="lbl">${t('wz_days')}</span>${multi([0, 1, 2, 3, 4, 5, 6], D.days, v => dayName(v))}${have < need ? `<small class="warn">${t('need_days', { n: need })}</small>` : ''}</div>`;
    }
    case 'group': return `<div class="fld"><span class="lbl">${t('wz_group')}</span>${single(['yes', 'no'], D.group.on ? 'yes' : 'no', v => t(v), 'group.on')}
      ${D.group.on ? `<span class="lbl sub">${t('wz_group_day')}</span>${single([0, 1, 2, 3, 4, 5, 6], D.group.day, v => dayName(v), 'group.day')}
      <span class="lbl sub">${t('wz_group_focus')}</span><div class="chips">${OPT.focus.map(v => chip('fchip', `data-f="group.focus" data-v="${v}"`, D.group.focus.includes(v), t('focus_' + v))).join('')}</div>` : ''}</div>`;
    case 'hardBike': return `<div class="fld"><span class="lbl">${t('wz_hardbike')} <small>(${t('optional')})</small></span>${multi([0, 1, 2, 3, 4, 5, 6], D.hardBike, v => dayName(v))}<small class="muted">${t('wz_hardbike_note')}</small></div>`;
    case 'dur': return `<div class="fld"><span class="lbl">${t('wz_dur')}</span>${single([15, 20, 30, 45], D.dur, v => `${v} ${t('min')}`)}</div>`;
    case 'start': return P && D !== UI.wz?.d && startLocked() ? `<div class="fld"><span class="lbl">${t('wz_start')}</span><b>${DN.fmtY(DN.parse(P.start))}</b><small class="muted">${t('start_locked')}</small></div>`
      : `<label class="fld"><span class="lbl">${t('wz_start')}</span><input type="date" id="f-start" data-field="start" value="${D.start}"></label>`;
    case 'rk': return `<div class="fld"><span class="lbl">${t('wz_rk')}</span>${single([3, 4, 5, 0], D.rk, v => v ? t('wz_rk_every', { n: v }) : t('wz_rk_none'))}</div>`;
    case 'races': return `<div class="fld"><span class="lbl">${t('wz_races')} <small>(${t('optional')})</small></span>
      <div class="races">${D.races.map((r, i) => `<div class="race"><b>${DN.fmtY(DN.parse(r.d))}</b><span>${esc(r.n)}</span><button class="iconbtn sm" data-act="rmrace" data-i="${i}" aria-label="x">${IC.x}</button></div>`).join('')}</div>
      <div class="raceadd"><input type="date" id="race-d" aria-label="${t('wz_race_date')}"><input id="race-n" placeholder="${t('wz_race_name')}" aria-label="${t('wz_race_name')}"><button class="btn ghost" data-act="addrace">${IC.plus}<span>${t('wz_add_race')}</span></button></div>
      <small class="muted">${t('wz_races_note')}</small></div>`;
    case 'icsTime': return `<label class="fld"><span class="lbl">${t('wz_ics_time')}</span><input type="time" id="f-ics" data-field="icsTime" value="${D.icsTime}"></label>`;
  }
  return '';
}
/* v2.0: the start date anchors all history (sessions are stored per plan week), so it cannot change once sessions are logged */
const startLocked = () => !!(P && S.logs.length && today() >= startNum(P));
function setField(D, f, v, multi) {
  const path = f.split('.');
  let o = D; for (let i = 0; i < path.length - 1; i++) o = o[path[i]];
  const k = path[path.length - 1];
  const num = ['perWeek', 'dur', 'rk', 'day', 'days', 'hardBike'].includes(k);
  const val = num ? +v : (k === 'on' ? v === 'yes' : v);
  if (multi) { const a = o[k]; const i = a.map(String).indexOf(String(val)); if (i >= 0) a.splice(i, 1); else a.push(val); a.sort?.(); }
  else o[k] = val;
  if (k === 'lang') document.documentElement.lang = val;
}

/* ---------- wizard ---------- */
const WZ_STEPS = [
  { title: 'wz_title', fields: ['lang'], intro: true },
  { title: 'wz_s1', fields: ['name', 'rider', 'complaints'] },
  { title: 'wz_s2', fields: ['eq'] },
  { title: 'wz_s3', fields: ['perWeek', 'group', 'days', 'hardBike', 'dur'] },
  { title: 'wz_s4', fields: ['start', 'rk', 'races', 'icsTime'] },
  { title: 'wz_s5', level: true },
  { title: 'wz_s6', summary: true }
];
function vWizard() {
  if (!UI.wz) UI.wz = { step: 0, d: defaultProfile(), testMode: null, test: {} };
  const { step, d } = UI.wz, st = WZ_STEPS[step];
  let body = '';
  if (st.intro) body = `<picture class="logo-big"><source srcset="icons/logo-light.png" media="(prefers-color-scheme: dark)"><img src="icons/logo-dark.png" alt="DynamVic Cycling coach"></picture>
    <p class="lead">${t('wz_lead')}</p>${field(d, 'lang')}
    <div class="card notice"><h3>${t('wz_disclaimer_title')}</h3><p>${t('disclaimer')}</p>
    <label class="check"><input type="checkbox" id="f-accept" data-field="accepted" ${d.accepted ? 'checked' : ''}><span>${t('wz_accept')}</span></label></div>`;
  else if (st.level) {
    body = `<p>${t('wz_level_lead')}</p><div class="chips col">${chip('wzlevel', 'data-v="now"', UI.wz.testMode === 'now', t('wz_test_now'))}${chip('wzlevel', 'data-v="later"', UI.wz.testMode === 'later', t('wz_test_later'))}</div>`;
    if (UI.wz.testMode === 'now') {
      const l = levelFromTest(UI.wz.test);
      body += `<div class="card">${testForm(UI.wz.test)}</div>${l ? `<div class="card ok"><b>${t('wz_level_result', { l: `${l} · ${t('lvl_' + l)}` })}</b></div>` : ''}`;
    }
  } else if (st.summary) body = summaryCard(d);
  else body = st.fields.map(f => field(d, f)).join('');
  const canNext = step === 0 ? d.accepted : step === 5 ? (UI.wz.testMode === 'later' || (UI.wz.testMode === 'now' && levelFromTest(UI.wz.test))) : true;
  // v2.2: on step 1 a hint under the bar says why Next is grey; tapping it scrolls the checkbox into view (small iPhones)
  const hint = step === 0 && !d.accepted ? `<button type="button" class="wzhint" data-act="wzhint">${t('wz_accept_hint')}</button>` : '';
  return `<div class="wz"><div class="wzhead"><span class="eyebrow">${t('wz_step', { a: step + 1, b: WZ_STEPS.length })}</span><div class="wzbar"><i style="width:${(step + 1) / WZ_STEPS.length * 100}%"></i></div></div>
    <h1 class="h1">${t(st.title)}</h1>${body}
    <div class="wznav">${hint}<div class="wzbtns">${step ? `<button class="btn quiet" data-act="wzback">${t('back')}</button>` : '<span></span>'}
    <button class="btn primary" data-act="${st.summary ? 'wzfinish' : 'wznext'}" ${canNext ? '' : 'disabled'}>${st.summary ? t('wz_go') : t('next')}</button></div></div></div>`;
}
function summaryCard(d) {
  const lv = d.level || (UI.wz && UI.wz.testMode === 'now' ? levelFromTest(UI.wz.test) : 1) || 1;
  const rows = [
    [t('level'), `${lv} · ${t('lvl_' + lv)}`],
    [t('wz_per_week'), d.perWeek + (d.group.on ? ` (${t('type_GROUP')} ${dayName(d.group.day)})` : '')],
    [t('wz_days'), d.days.map(x => dayName(x)).join(', ')],
    [t('wz_dur'), `${d.dur} ${t('min')}`],
    [t('wz_start'), DN.fmtY(DN.parse(d.start))],
    [t('wz_rk'), d.rk ? t('wz_rk_every', { n: d.rk }) : t('wz_rk_none')],
    [t('equipment'), d.eq.length ? d.eq.map(e => t('eq_' + e)).join(', ') : '–'],
    [t('wz_complaints'), d.complaints.length ? d.complaints.map(c => t('cmp_' + c)).join(', ') : '–'],
    [t('wz_races'), d.races.length ? d.races.map(r => `${esc(r.n || '')} ${DN.fmt(DN.parse(r.d))}`).join(', ') : '–']
  ];
  return `<div class="card"><h3>${t('wz_summary')}</h3><dl class="kv stack">${rows.map(r => `<dt>${r[0]}</dt><dd>${r[1]}</dd>`).join('')}</dl></div>`;
}

/* ---------- test form (wizard + progress) ---------- */
const TFIELDS = [
  { k: 'T1', lr: true, unit: 's', sw: true }, { k: 'T2', lr: false, unit: 'cm' }, { k: 'T3', lr: true, unit: 'reps' },
  { k: 'T4', lr: false, unit: 's', sw: true }, { k: 'T5', lr: true, unit: 's', sw: true }
];
function testForm(vals) {
  return `<p class="small muted">${t('test_hint')}</p><div class="tform">${TFIELDS.map(f => {
    const inp = (key, lab) => `<div class="tin">${lab ? `<span>${lab}</span>` : ''}<input id="t-${key}" data-tk="${key}" inputmode="${f.unit === 'cm' ? 'text' : 'numeric'}" value="${vals[key] ?? ''}" aria-label="${t(f.k.toLowerCase())} ${lab || ''}"><span>${f.unit === 'reps' ? t('reps') : f.unit}</span>${f.sw ? `<button type="button" class="swb${UI.sw && UI.sw.f === key ? ' on' : ''}" data-act="sw" data-f="${key}" aria-label="${t('sw_label')}">${UI.sw && UI.sw.f === key ? IC.stop : IC.watch}</button>` : ''}</div>`;
    return `<div class="tf"><b>${f.k} · ${t(f.k.toLowerCase())}</b><small class="muted">${t(f.k.toLowerCase() + 's')}</small><div class="tins">${f.lr ? inp(f.k + 'L', t('left')) + inp(f.k + 'R', t('right')) : inp(f.k, '')}</div></div>`;
  }).join('')}</div>`;
}

/* ---------- week ---------- */
function isDone(w, key) { return S.logs.some(l => l.w === w && l.key === key); }
function slotTitle(s) { return s.type === 'GROUP' ? `${t('type_GROUP')}${s.focus && s.focus.length ? ' · ' + s.focus.map(f => t('focus_' + f)).join(', ') : ''}` : t('type_' + s.type); }
function vWeek() {
  if (!P) return vWizard();
  const td = today(), cw = curWeek();
  if (UI.viewWeek == null) UI.viewWeek = Math.max(1, cw);
  const w = UI.viewWeek, plan = weekPlan(P, S, w);
  let top = topbar(P.name ? `${P.name}` : 'DynamCore');
  if (P.paused) return top + `<div class="card"><p>${t('paused', { d: DN.fmtY(P.paused) })}</p><button class="btn primary" data-act="resume">${t('resume')}</button></div>`;
  const tv = !!plan.travel;
  const pills = `<span class="pill ph-${plan.phase}">${t('phase_' + plan.phase)}</span>${plan.rec ? `<span class="pill rec">${plan.phase === 'race' ? t('rec_race') : t('recovery_week')}</span>` : ''}${tv ? `<span class="pill rec">${t('travel_mode')}</span>` : ''}`;
  let html = top + `<section class="weekhead">
    <button class="iconbtn" data-act="wk" data-d="-1" aria-label="${t('wk_prev')}" ${w <= 1 ? 'disabled' : ''}>${IC.left}</button>
    <div><div class="big">${t('week_n', { n: w })}</div><div class="sub">${DN.fmt(plan.monday)} – ${DN.fmt(plan.monday + 6)} ${pills}</div></div>
    <button class="iconbtn" data-act="wk" data-d="1" aria-label="${t('wk_next')}">${IC.right}</button></section>`;
  if (w === cw) html += todayCard(plan);
  html += accExpiryWarning() + backupReminder();
  if (cw < 1 && w === 1) html += `<div class="card"><p>${t('not_started', { d: DN.fmtY(startNum(P)) })}</p></div>`;
  if (S.suggest && S.suggest !== P.level) html += `<div class="card ok"><p>${t('suggest_level', { l: S.suggest, name: t('lvl_' + S.suggest) })}</p><div class="row"><button class="btn primary" data-act="acceptlvl">${t('accept')}</button><button class="btn quiet" data-act="declinelvl">${t('decline')}</button></div></div>`;
  const testSlot = plan.slots.find(s => s.test);
  if (testSlot) html += `<div class="card"><p>${t('test_due', { d: dayName(testSlot.day, true) })} <a href="#progress" data-act="gotest" data-w="${w}">${t('go_test')}</a></p></div>`;
  if (plan.dropped) html += `<div class="card warnc"><p>${t('dropped_warn', { n: plan.dropped })}</p></div>`;
  // days
  let rows = '';
  for (let d = 0; d < 7; d++) {
    const dn = plan.monday + d, isToday = dn === td;
    const ss = plan.slots.filter(s => s.day === d);
    const items = ss.map(s => slotCard(plan, s, dn)).join('');
    rows += `<div class="day${isToday ? ' today' : ''}"><div class="dd"><b>${dayName(d)}</b><small>${DN.fmt(dn)}</small></div><div class="dslots">${items || `<span class="restd">${t('rest_day')}</span>`}</div></div>`;
  }
  const total = plan.slots.filter(s => !s.skipped).length, done = plan.slots.filter(s => isDone(w, s.key)).length;
  html += `<section class="days">${rows}</section>
    <div class="prog"><div class="lbl"><span>${t('week_progress', { a: done, b: total })}</span><span>${streakText()}</span></div><div class="bar"><i style="width:${total ? done / total * 100 : 0}%"></i></div></div>
    <div class="row wkfoot"><button class="btn ghost" data-act="grpshare">${t('share_week')}</button><button class="btn quiet" data-act="weekmenu" data-w="${w}">${t('week_opts')}</button></div>
    ${installCard()}<p class="small muted disc">${t('disclaimer')}</p>`;
  return html;
}
/* v2.2: "Vandaag" card on the current week – one tap to start today's session, one to mark it done.
   Shows today's first session that is not done, skipped or paused; a second one today is linked below it.
   Rest day / all done: a line with the next open session of this week (no Start). Group session: only "Gedaan".
   Missed sessions of earlier days are not repeated here (they stay in the day list). */
const openSlot = (w, s) => !s.skipped && !s.paused && !isDone(w, s.key);
function todayCard(plan) {
  const w = plan.w, d = today() - plan.monday; if (d < 0 || d > 6 || P.paused) return '';
  const todays = plan.slots.filter(s => s.day === d), open = todays.filter(s => openSlot(w, s));
  const head = `<span class="eyebrow">${t('today_hdr')} · ${dayName(d, true)} ${DN.fmt(plan.monday + d)}</span>`;
  if (!open.length) {
    const nx = plan.slots.filter(s => s.day > d && openSlot(w, s)).sort((a, b) => a.day - b.day)[0];
    const msg = todays.length && todays.every(s => isDone(w, s.key)) ? `${IC.check} ${t('today_alldone')}` : t('today_rest');
    return `<section class="card todayc quiet">${head}<p class="tdl${todays.length ? ' ok' : ''}">${msg}</p>${nx ? `<p class="small muted">${t('today_next', { d: dayName(nx.day, true), t: esc(slotTitle(nx)) })}</p>` : ''}</section>`;
  }
  const s = open[0], also = open[1];
  const alsoL = also ? `<button class="linkbtn" ${also.type === 'GROUP' ? `data-act="grpopen" data-w="${w}"` : `data-act="open" data-w="${w}" data-k="${also.key}"`}>${t('today_also', { t: esc(slotTitle(also)) })}</button>` : '';
  if (s.type === 'GROUP')
    return `<section class="card todayc" style="--tc:${typeColor('GROUP')}">${head}<b class="tdt">${esc(slotTitle(s))}</b>
      <div class="tdb"><button class="btn big" data-act="grpopen" data-w="${w}">${IC.check}<span>${t('today_done_btn')}</span></button></div>${alsoL}</section>`;
  const ses = buildSession(P, S, plan, s);
  return `<section class="card todayc" style="--tc:${typeColor(s.type)}">${head}
    <button class="si" data-act="open" data-w="${w}" data-k="${s.key}"><b class="tdt">${t('type_' + s.type)}${s.test ? ' + TEST' : ''}</b><span class="meta">${t('est', { n: ses.est })} · ${ses.ident ? t('ident_' + ses.type + '_' + ses.ident) : t('style_' + ses.style)} · RPE ${RPE_TARGET[s.type]}</span>${eqIcons(sessionEquip(P, ses))}</button>
    <div class="tdb"><button class="btn big" data-act="todaystart" data-w="${w}" data-k="${s.key}">${IC.play}<span>${t('start')}</span></button><button class="btn quiet" data-act="todaydone" data-w="${w}" data-k="${s.key}">${IC.check}<span>${t('today_done_btn')}</span></button></div>${alsoL}</section>`;
}
function slotCard(plan, s, dn) {
  const w = plan.w, done = isDone(w, s.key), td = today();
  const missed = !done && !s.skipped && dn < td;
  let status = done ? `<span class="st ok">${IC.check} ${t('status_done')}${rpeOf(w, s.key) != null ? ` · RPE ${rpeOf(w, s.key)}` : ''}</span>` : s.paused ? `<span class="st">${t('status_paused')}</span>` : s.skipped ? `<span class="st">${t('status_skipped')}</span>` : missed ? `<span class="st bad">${t('status_missed')}</span>` : '';
  // v2.2: secondary actions (move, skip, adjust, mark done) live in one "⋯" sheet per session
  const menu = (s.type === 'GROUP' || !(done || s.paused)) ? `<button class="iconbtn more" data-act="slotmenu" data-w="${w}" data-k="${s.key}" aria-label="${t('more')} · ${esc(slotTitle(s))}">${IC.more}</button>` : '';
  if (s.type === 'GROUP') {
    return `<div class="slot" style="--tc:${typeColor('GROUP')}"><button class="si" data-act="grpopen" data-w="${w}"><span class="tk">${t('typeS_GROUP')}</span><b>${esc(slotTitle(s))}</b>${status}</button>${menu}</div>`;
  }
  const ses = buildSession(P, S, plan, s);
  return `<div class="slot" style="--tc:${typeColor(s.type)}"><button class="si" data-act="open" data-w="${w}" data-k="${s.key}">
    <span class="tk">${t('typeS_' + s.type)}${s.test ? ' + TEST' : ''}</span><b>${t('type_' + s.type)}</b><span class="meta">${t('est', { n: ses.est })} · ${ses.ident ? t('ident_' + ses.type + '_' + ses.ident) : t('style_' + ses.style)} · RPE ${RPE_TARGET[s.type]}</span>${eqIcons(sessionEquip(P, ses))}${status}</button>${menu}</div>`;
}
function slotMenu(w, k) {
  const plan = weekPlan(P, S, w), s = plan.slots.find(x => x.key === k); if (!s) return;
  const done = isDone(w, k), dn = plan.monday + s.day, b = (act, label, extra = '') => `<button class="btn quiet wide" data-act="${act}" data-w="${w}" data-k="${k}" ${extra}>${label}</button>`;
  let items = '';
  if (!done && !s.paused) {
    if (s.skipped) items += b('unskip', t('undo_skip'));
    else {
      items += s.type === 'GROUP' ? b('grpopen', t('mark_done')) : b('slotdone', t('mark_done'));
      if (moveDays(plan, s).length) items += b('movesheet', t('move'));
      items += b('skip', t('skip'));
    }
  }
  if (s.type === 'GROUP') items += b('groupedit', t('group_edit'));
  sheet(`<h3>${esc(slotTitle(s))}</h3><p class="small muted">${dayName(s.day, true)} ${DN.fmt(dn)}</p><div class="menu">${items}</div>`);
}
/* move / skip: for every session that is not done (missed, today or later). Moving stays within the same week. */
function moveDays(plan, s) { const td = today(); return [0, 1, 2, 3, 4, 5, 6].filter(d => d !== s.day && plan.monday + d >= td); }
function slotActs(plan, s, dn, done, inline) {
  if (done || s.paused) return '';
  const w = plan.w;
  const b = s.skipped ? `<button class="btn tiny quiet" data-act="unskip" data-w="${w}" data-k="${s.key}">${t('undo_skip')}</button>`
    : `${moveDays(plan, s).length ? `<button class="btn tiny quiet" data-act="movesheet" data-w="${w}" data-k="${s.key}">${t('move')}</button>` : ''}<button class="btn tiny quiet" data-act="skip" data-w="${w}" data-k="${s.key}">${t('skip')}</button>`;
  return inline ? b : `<div class="row sm">${b}</div>`;
}
const rpeOf = (w, key) => { const l = S.logs.filter(x => x.w === w && x.key === key).pop(); return l ? l.rpe : null; };
function streakText() {
  let n = 0;
  for (let w = curWeek() - 1; w >= 1; w--) {
    const pl = weekPlan(P, S, w); const need = pl.slots.filter(s => !s.skipped);
    if (!need.length && pl.slots.some(s => s.paused)) continue;   // v2.0: a fully paused week neither counts nor breaks the streak
    if (need.length && need.every(s => isDone(w, s.key))) n++; else break;
  }
  return n ? tn('streak', n) : '';
}

/* ---------- session detail ---------- */
/* v2.1: a completed session stores what was actually done (log.ses); it is shown instead of what the plan would build now */
const packSes = ses => ({ eng: ses.eng || 1, ident: ses.ident || null, wph: ses.wph || null, blocks: ses.blocks.map(b => ({ k: b.k, rounds: b.rounds, rest: b.rest || 0, roundRest: b.roundRest || 0,
  items: b.items.map(i => [i.id, i.dose.k + i.dose.n + (i.dose.side ? 's' : ''), i.cue || '']) })) });
function unpackSes(snap, ses) {
  try {
    if (!snap || !Array.isArray(snap.blocks)) return null;
    const blocks = snap.blocks.map(b => ({ k: String(b.k), rounds: Math.max(1, +b.rounds || 1), rest: +b.rest || 0, roundRest: +b.roundRest || 0,
      items: b.items.map(([id, d, cue]) => { if (!EXMAP[id] || !/^[rtb]\d+s?$/.test(d)) throw 0; return { id, orig: id, pat: EXMAP[id].pat, dose: parseDose(d), ...(cue ? { cue } : {}) }; }) }));
    return finish({ ...ses, blocks, ident: snap.ident || ses.ident, wph: snap.wph || ses.wph, eng: snap.eng || ses.eng, logged: true });
  } catch (e) { return null; }
}
function sessionSnapshot(c) {
  try {
    if (c.type === 'GROUP') return null;
    let ses = null;
    if (G.r && G.r.ses && G.r.slot && G.r.slot.key === c.key && (String(c.key).startsWith('R-') || G.r.plan.w === c.w)) ses = G.r.ses;
    else if (UI.sess && (UI.sess.routine ? 'R-' + UI.sess.routine === c.key : UI.sess.w === c.w && UI.sess.key === c.key)) { const r = resolveSession(); ses = r && r.ses; }
    else if (!String(c.key).startsWith('R-')) { const pl = weekPlan(P, S, c.w), s = pl.slots.find(x => x.key === c.key); if (s) ses = buildSession(P, S, pl, s); }
    return ses ? packSes(ses) : null;
  } catch (e) { return null; }
}
function resolveSession() {
  const c = UI.sess; if (!c) return null;
  if (c.routine) {
    const w = Math.max(1, curWeek());
    const plan = weekPlan(P, S, w);
    const type = c.routine === 'TRAVEL' ? 'CORE' : c.routine === 'EXTRA' ? c.type : c.routine;
    const slot = { type, key: 'R-' + c.routine, idx: 7 };
    const p2 = c.routine === 'EXTRA' ? plan : { ...plan, rec: false };
    const ses = buildSession(P, { weekOv: {}, engFrom: S.engFrom }, p2, slot, { dur: c.dur || (c.routine === 'TRAVEL' ? 20 : P.dur), travel: c.routine === 'TRAVEL' ? true : undefined });
    return { plan, slot, ses, routine: c.routine };
  }
  const plan = weekPlan(P, S, c.w); const slot = plan.slots.find(s => s.key === c.key);
  if (!slot) return null;
  let ses = buildSession(P, S, plan, slot);
  const log = isDone(c.w, c.key) ? S.logs.filter(l => l.w === c.w && l.key === c.key).pop() : null;
  if (log && log.ses) ses = unpackSes(log.ses, ses) || ses;
  return { plan, slot, ses, routine: null };
}
function vSession() {
  const r = resolveSession(); if (!r) { location.hash = '#week'; return ''; }
  const { plan, slot, ses } = r;
  const title = r.routine === 'TRAVEL' ? t('r_travel') : t('type_' + ses.type);
  let html = topbar(title, { back: true, gear: false });
  const durs = ses.type === 'ACT' || ses.type === 'REC' ? [] : [15, 20, 30, 45];
  html += `<section class="sesshead" style="--tc:${typeColor(ses.type)}">
    <span class="tk">${r.routine ? t('tab_routines') : `${t('week_n', { n: plan.w })} · ${dayName(slot.day, true)} ${DN.fmt(plan.monday + slot.day)}`}</span>
    ${ses.ident ? `<div class="ident"><b>${t('ident_' + ses.type + '_' + ses.ident)}</b>${ses.intent === 'A' || ses.intent === 'B' ? ` · ${t('intent_' + ses.intent)}` : ''}</div>` : ''}
    <div class="meta"><b>${t('est', { n: ses.est })}</b> · ${t('style_' + ses.style)} · ${t('level')} ${lvlDots(ses.level)} · RPE ${RPE_TARGET[ses.type]}</div>
    ${eqIcons(sessionEquip(P, ses), true)}
    ${durs.length ? `<div class="chips">${durs.map(d => chip('dur', `data-v="${d}"`, d === ses.dur, `${d} ${t('min')}`)).join('')}</div>` : ''}</section>`;
  if (ses.logged) html += `<p class="small muted">${t('logged_note')}</p>`;
  else if (ses.wph && !r.routine) html += `<div class="card wph"><p><b>${t('wph_' + ses.wph)}</b> ${t('wph_' + ses.wph + '_d')}</p></div>`;
  if (ses.test) html += `<div class="card"><p><b>${t('with_test')}</b> <a href="#progress" data-act="gotest" data-w="${plan.w}">${t('go_test')}</a></p></div>`;
  if (ses.travel) html += `<p class="small muted">${t('travel_on')}</p>`;
  html += ses.blocks.map(b => `<section class="blk"><div class="bh"><span>${t('blk_' + b.k)}</span>${b.rounds > 1 || b.rest ? `<span class="muted">${b.rounds > 1 ? t('rounds', { n: b.rounds }) : ''}${b.rest ? ' · ' + t('rest_s', { n: b.rest }) : ''}</span>` : ''}</div>
    <ol class="ex">${b.items.map(i => `<li><button class="exr" data-act="exinfo" data-id="${i.id}"><span class="n">${esc(exName(i.id))}${i.cue ? `<small class="cue">${esc(t(i.cue))}</small>` : ''}</span><span class="dose">${fmtDose(i.dose)}</span></button>${r.routine || ses.logged ? '' : `<button class="iconbtn sm" data-act="swapsheet" data-id="${i.id}" data-orig="${i.orig}" aria-label="${t('swap')}">${IC.swap}</button>`}</li>`).join('')}</ol></section>`).join('');
  const done = !r.routine && isDone(plan.w, slot.key);
  // v2.2: Start stays visible at the bottom of the screen (sticky above the tab bar); the Intervals.icu text is folded
  html += (done ? doneBlock(plan.w, slot.key, ses.type) : '') + `<div class="stickbar"><button class="btn wide big" data-act="guided">${IC.play}<span>${t('start_guided')}</span></button></div>
    <div class="stick">${done ? '' : `<button class="btn quiet wide" data-act="markdone">${t('mark_done')}</button>`}
    ${done || r.routine ? '' : `<div class="row center">${slotActs(plan, slot, plan.monday + slot.day, false, true)}</div>`}</div>
    <details class="card icuc"><summary>${t('icu_copy_sum')}</summary><p class="small muted">${P.icuKey ? t('icu_send_note') : t('intervals_note')}</p><div class="row"><button class="btn ghost" data-act="copyint">${t('copy_intervals')}</button><span class="msg" id="cmsg"></span></div><pre class="itxt" id="itxt">${esc(intervalsText(r))}</pre></details>`;
  return html;
}
function intervalsText(r) {
  const { ses, plan, slot } = r, L = [];
  L.push(`DynamCore – ${t('type_' + ses.type)}${r.routine ? '' : ` | ${t('week_n', { n: plan.w })} ${dayName(slot.day)}`} | ${t('est', { n: ses.est })} | RPE ${RPE_TARGET[ses.type]}`);
  if (ses.ident) L.push(`${t('ident_' + ses.type + '_' + ses.ident)}${ses.wph ? ' · ' + t('wph_' + ses.wph) : ''}`);
  const eqs = sessionEquip(P, ses); L.push(`${t('equipment')}: ${eqs.length ? eqs.map(x => t('eq_' + x)).join(', ') : t('eq_nothing')}`);
  ses.blocks.forEach(b => {
    L.push(`${t('blk_' + b.k)}${b.rounds > 1 ? ' – ' + t('rounds', { n: b.rounds }) : ''}${b.rest ? ', ' + t('rest_s', { n: b.rest }) : ''}:`);
    b.items.forEach(i => L.push(`• ${exName(i.id)}  ${fmtDose(i.dose)}${i.cue ? ' (' + t(i.cue) + ')' : ''}`));
  });
  L.push(lang() === 'nl' ? 'Na de sessie: RPE (1–10) + opmerking.' : 'After the session: RPE (1–10) + remark.');
  return L.join('\n');
}

/* ---------- plan ---------- */
function vPlan() {
  const cw = Math.max(1, curWeek());
  let html = topbar(t('plan_title'));
  html += `<section class="card">${field(UI.planD || (UI.planD = P), 'races')}${P.races.length ? '' : `<p class="small muted">${t('no_races')}</p>`}</section>`;
  let rows = '';
  for (let w = Math.max(1, cw - 1); w < cw + 12; w++) {
    const pl = weekPlan(P, S, w);
    rows += `<div class="pw${w === cw ? ' cur' : ''}${pl.rec ? ' rec' : ''}"><button class="pwn" data-act="gow" data-w="${w}"><b>${w}</b><small>${DN.fmt(pl.monday)}</small></button>
      <div class="pwm"><span class="pill ph-${pl.phase}">${t('phase_' + pl.phase)}</span><div class="pws">${pl.slots.map(s => `<span class="sc${isDone(w, s.key) ? ' done' : ''}${s.skipped ? ' skip' : ''}" style="--tc:${typeColor(s.type)}">${dayName(s.day)} · ${t('typeS_' + s.type)}${s.test ? ' + T' : ''}</span>`).join('')}</div></div>
      <button class="chip sm" data-act="togrec" data-w="${w}" aria-pressed="${pl.rec}" title="${t('toggle_rec')}">${t('recovery_week').split(' ')[0]}</button></div>`;
  }
  html += `<section class="plist">${rows}</section>
    <section class="card"><h3>${t('intervals_hdr')}</h3>${P.icuKey ? `<div class="row"><button class="btn primary" data-act="icusend">${t('icu_send')}</button></div><p class="msg" id="icumsg" aria-live="polite"></p><p class="small muted">${t('icu_send_note')}</p>` : `<p class="small muted">${t('icu_setup')}</p><button class="btn ghost" data-act="go" data-to="settings">${t('settings')}</button>`}</section>
    <section class="card"><h3>${t('ics_export')}</h3><div class="row">${[4, 8, 12].map(n => `<button class="btn ghost" data-act="ics" data-n="${n}">${t('ics_weeks', { n })}</button>`).join('')}</div><p class="small muted">${t('ics_note')}</p></section>`;
  return html;
}

/* ---------- routines ---------- */
function vRoutines() {
  const card = (k, title, d, extra = '') => `<div class="card rt"><div><h3>${title}</h3><p class="small muted">${d}</p>${extra}</div><button class="btn" data-act="routine" data-r="${k}">${t('start')}</button></div>`;
  return topbar(t('routines_title')) + `<section class="rts">
    ${card('ACT', t('r_act'), t('r_act_d'))}${card('REC', t('r_rec'), t('r_rec_d'))}${card('TRAVEL', t('r_travel'), t('r_travel_d'))}
    ${card('EXTRA', t('r_extra'), t('r_extra_d'), `<div class="chips">${['CORE', 'LEG', 'MOB'].map(x => chip('extratype', `data-v="${x}"`, UI.extraType === x, t('type_' + x))).join('')}</div>`)}
    <div class="card rt"><div><h3>${t('r_test')}</h3><p class="small muted">${t('r_test_d')}</p></div><button class="btn ghost" data-act="go" data-to="progress">${t('go_test')}</button></div></section>`;
}

/* ---------- progress ---------- */
function vProgress() {
  const cw = Math.max(1, curWeek());
  if (UI.testW == null) { let w = cw; while (w > 1 && !isRecovery(P, S, w)) w--; UI.testW = w; }
  const rec = S.tests.find(x => x.w === UI.testW) || { w: UI.testW };
  const lv = P.level || 1;
  let html = topbar(t('progress_title'));
  html += `<section class="card"><div class="row between"><div><span class="eyebrow">${t('cur_level')}</span><div class="lvl">${lv} · ${t('lvl_' + lv)} ${lvlDots(lv)}</div></div></div>
    <p class="small muted">${t('adj_now')}: ${['CORE', 'LEG', 'MOB'].map(x => `${t('typeS_' + x)} ${((P.adj || {})[x] || 0) > 0 ? '+' : ''}${(P.adj || {})[x] || 0}`).join(' · ')}</p></section>`;
  // v2.2: results first (weeks done, test charts, recent sessions); the test form is folded behind "Test invullen"
  // (opened directly from the "test due" link on the week); group challenges after the results.
  html += `<details class="card testd" id="testd"${UI.testOpen ? ' open' : ''}><summary>${t('test_enter', { n: UI.testW })}</summary>${testForm(rec)}<p class="msg" id="tmsg"></p></details>`;
  const bars = []; for (let w = Math.max(1, cw - 7); w <= cw; w++) { const pl = weekPlan(P, S, w); const need = pl.slots.filter(s => !s.skipped).length; const d = pl.slots.filter(s => isDone(w, s.key)).length; bars.push({ w, need, d }); }
  html += `<section class="card"><h3>${t('weeks_done')}</h3><div class="wbars">${bars.map(b => `<div class="wb"><div class="wbc"><i style="height:${b.need ? b.d / b.need * 100 : 0}%"></i></div><small>${b.w}</small><small>${b.d}/${b.need}</small></div>`).join('')}</div></section>`;
  html += `<h2 class="h2">${t('progress_title')}</h2>` + ['T1', 'T2', 'T3', 'T4', 'T5'].map(k => `<section class="card"><h3>${k} · ${t(k.toLowerCase())}</h3>${testChart(k)}</section>`).join('');
  const logs = S.logs.slice(-15).reverse();
  html += `<section class="card"><h3>${t('rpe_log')}</h3>${logs.length ? `<ul class="logs">${logs.map(l => `<li><span>${DN.fmt(l.d)}</span><span>${t('typeS_' + l.type)}</span><span>${l.rpe != null ? 'RPE ' + l.rpe : '–'}</span></li>`).join('')}</ul>` : `<p class="small muted">${t('no_logs')}</p>`}</section>`;
  html += grpSection();
  return html;
}
function testVal(rec, k, side) { const v = rec[k + (side || '')]; return v === undefined || v === '' || v === null ? null : +v; }
function testChart(k) {
  const f = TFIELDS.find(x => x.k === k);
  const recs = [...S.tests].sort((a, b) => a.w - b.w);
  const series = f.lr ? [['L', 'var(--accent)'], ['R', 'var(--t-LEG)']] : [['', 'var(--accent)']];
  const pts = series.map(([sd]) => recs.map(r => [r.w, testVal(r, k, sd)]).filter(p => p[1] != null));
  const vals = pts.flat().map(p => p[1]);
  if (!vals.length) return `<p class="small muted">${t('chart_empty')}</p>`;
  const W = 320, H = 150, Lm = 36, Rm = 12, T = 16, B = 24;
  const ws = recs.map(r => r.w); const w0 = Math.min(...ws), w1 = Math.max(...ws, w0 + 1);
  let lo = Math.min(0, ...vals), hi = Math.max(0, ...vals); if (hi === lo) hi = lo + 1; const pad = (hi - lo) * 0.18; hi += pad; if (lo < 0) lo -= pad;
  const x = w => Lm + (w - w0) / (w1 - w0) * (W - Lm - Rm), y = v => T + (1 - (v - lo) / (hi - lo)) * (H - T - B);
  let g = [lo, (lo + hi) / 2, hi].map(v => Math.round(v)).map(v => `<line x1="${Lm}" x2="${W - Rm}" y1="${y(v)}" y2="${y(v)}" stroke="var(--line)"/><text x="${Lm - 6}" y="${y(v) + 4}" text-anchor="end" font-size="11" fill="var(--muted)">${v}</text>`).join('');
  g += [...new Set(ws)].map(w => `<text x="${x(w)}" y="${H - 6}" text-anchor="middle" font-size="11" fill="var(--muted)">${lang() === 'nl' ? 'wk' : 'wk'} ${w}</text>`).join('');
  pts.forEach((ps, si) => {
    const col = series[si][1];
    if (ps.length > 1) g += `<polyline fill="none" stroke="${col}" stroke-width="2.5" points="${ps.map(p => `${x(p[0])},${y(p[1])}`).join(' ')}"/>`;
    ps.forEach(p => { const other = pts[1 - si] && pts[1 - si].find(q => q[0] === p[0]); const above = !other || p[1] > other[1] || (p[1] === other[1] && si === 0);
      g += `<circle cx="${x(p[0])}" cy="${y(p[1])}" r="4" fill="${col}"/><text x="${x(p[0])}" y="${y(p[1]) + (above ? -8 : 16)}" text-anchor="middle" font-size="11" font-weight="600" fill="${col}">${p[1]}</text>`; });
  });
  return `<svg class="chart" viewBox="0 0 ${W} ${H}" role="img" aria-label="${k}">${g}</svg>${f.lr ? `<div class="legend"><span><i style="background:var(--accent)"></i>${t('left')}</span><span><i style="background:var(--t-LEG)"></i>${t('right')}</span></div>` : ''}`;
}

/* ---------- library ---------- */
function libList() {
  const q = UI.libQ.trim().toLowerCase(), ctx = makeCtx({ ...P, complaints: [], blocked: [] }, false);
  const list = EX.filter(e => !e.hidden && (UI.libCat === 'all' || CAT_OF(e.pat) === UI.libCat) && (!UI.libMine || !e.eq.length || e.eq.some(x => ctx.eq.has(x)))
    && (!q || `${e.id} ${e.n.nl} ${e.n.en} ${e.why[lang()]}`.toLowerCase().includes(q)));
  return list.length ? list.map(e => `<div class="card">${exCard(e, true)}</div>`).join('') : `<p class="muted">${t('lib_empty')}</p>`;
}
/* v2.2: in the library the figure is a still (saves battery while scrolling); tapping it plays the movement.
   The YouTube search link is gone (coach 20-11-2026: leaves the app and needs internet). */
function exCard(e, inLib) {
  const L = lang();
  const warn = e.avoid.filter(a => (P.complaints || []).includes(a));
  const fig = inLib && ANIMV.has(e.id) ? `<button type="button" class="animbtn" data-act="animplay" aria-label="${t('anim_play')} · ${esc(e.n[L])}" aria-pressed="false">${ANIMV.svg(e.id, 'still')}<span class="playic">${IC.play}</span></button>` : ANIMV.svg(e.id, 'cue');   // v2.3: exercise sheet = option C
  return `<div class="exc">${fig}${ANIMV.isFront(e.id) ? `<small class="muted">${t('front_view')}</small>` : ''}<div class="h"><b>${esc(e.n[L])}</b>${lvlDots(e.lvl)}</div>
    <p class="why">${esc(e.why[L])}</p><ul>${e.cue[L].map(c => `<li>${esc(c)}</li>`).join('')}</ul>
    <dl class="kv sm"><dt>${t('fault')}</dt><dd>${esc(e.fault[L])}</dd><dt>${t('equipment')}</dt><dd>${e.eq.length ? e.eq.map(x => t('eq_' + x)).join(' / ') : '–'}</dd>${e.avoid.length ? `<dt>${t('not_with')}</dt><dd class="${warn.length ? 'warn' : ''}">${e.avoid.map(a => t('cmp_' + a)).join(', ')}</dd>` : ''}</dl></div>`;
}
function vLibrary() {
  const cats = ['all', 'core', 'hips', 'legs', 'upper', 'stab', 'power', 'mob', 'roll'];
  return topbar(t('lib_title')) + `<input class="search" id="libq" type="search" placeholder="${t('search')}" value="${esc(UI.libQ)}" autocomplete="off">
    <div class="chips">${cats.map(c => chip('libcat', `data-v="${c}"`, UI.libCat === c, t('cat_' + c))).join('')}</div>
    <label class="check"><input type="checkbox" id="libmine" ${UI.libMine ? 'checked' : ''}><span>${t('only_mine')}</span></label>
    <div class="lib" id="liblist">${libList()}</div>`;
}

/* v2.1: start the new session building now instead of at the start of the next block (shown only while waiting; gone once used).
   Sessions already done in this week keep what was done: their exercises are stored first, as the v2.0.1 builder made them. */
function engWaiting() { return P && P.start && Number.isFinite(S.engFrom) && S.engFrom > Math.max(1, curWeek()); }
async function startEngNow() {
  if (!engWaiting()) return;
  const cw = Math.max(1, curWeek());
  S.logs.filter(l => l.w >= cw && !l.ses && l.type !== 'GROUP' && !String(l.key).startsWith('R-')).forEach(l => {
    const pl = weekPlan(P, S, l.w), s = pl.slots.find(x => x.key === l.key); if (s) l.ses = packSes(buildSession(P, S, pl, s));
  });
  S.engFrom = cw; S.engNowAt = today(); UI.engArmed = false; saveAll(); rerender();
  toast(t('engnow_done'));
  if (P.icuKey && String(P.icuKey).trim()) { try { const r = await icuSend(4, true); if (r && !r.ok) toast(t('icu_auto_plan_err') + ' ' + r.err, true); } catch (e) { } }   // planned workouts get the new contents
}

/* ---------- settings ---------- */
function vSettings() {
  if (!UI.settingsD) UI.settingsD = clone(P);
  const D = UI.settingsD;
  const sec = (h, body) => `<section class="card"><h3>${h}</h3>${body}</section>`;
  return topbar(t('settings'), { back: true, gear: false })
    + sec(t('s_profile'), ['lang', 'name', 'rider', 'complaints', 'eq'].map(f => field(D, f)).join(''))
    + sec(t('s_week'), ['perWeek', 'group', 'days', 'hardBike', 'dur'].map(f => field(D, f)).join(''))
    + sec(t('s_planning'), ['start', 'rk', 'icsTime'].map(f => field(D, f)).join('')
      + `<div class="fld"><span class="lbl">${t('phase_override')}</span><div class="chips">${['auto', 'base', 'inseason', 'offseason', 'taper', 'race'].map(v => chip('fset', `data-f="phaseOverride" data-v="${v}"`, D.phaseOverride === v, v === 'auto' ? t('phase_auto') : t('phase_' + v))).join('')}</div></div>
        <div class="fld"><span class="lbl">${t('level_manual')}</span><div class="chips">${[1, 2, 3].map(v => chip('fset', `data-f="level" data-v="${v}"`, +D.level === v, `${v} · ${t('lvl_' + v)}`)).join('')}</div></div>`)
    + (engWaiting() ? sec(t('engnow_hdr'), `<p class="small">${t('engnow_d', { d: DN.fmtY(mondayOfWeek(P, S.engFrom)) })}</p><button class="btn ghost" data-act="engnow">${UI.engArmed ? t('engnow_confirm') : t('engnow_btn')}</button>`) : '')
    + sec(t('s_app'), `<label class="check"><input type="checkbox" id="f-voice" data-field="voice" ${D.voice !== false ? 'checked' : ''}><span>${t('voice')}</span></label>
        ${voiceSelect(D)}
        <label class="check"><input type="checkbox" id="f-travel" data-field="travelAlways" ${D.travelAlways ? 'checked' : ''}><span>${t('travel_always')}</span></label>`)
    + `<div class="stick"><button class="btn wide primary" data-act="savesettings">${t('save')}</button><span class="msg" id="smsg"></span></div>`
    + sec(t('pause'), P.paused ? `<button class="btn" data-act="resume">${t('resume')}</button>` : `<button class="btn quiet" data-act="pause">${t('pause')}</button>`)
    + sec(t('intervals_hdr'), `<p class="small muted">${t('icu_lead')}</p>
        <label class="fld"><span class="lbl">${t('icu_key')}</span><input id="f-icukey" type="password" autocomplete="off" data-field="icuKey" value="${esc(D.icuKey || '')}"></label>
        <label class="fld"><span class="lbl">${t('icu_id')} <small>(${t('optional')})</small></span><input id="f-icuid" data-field="icuId" placeholder="0" value="${esc(D.icuId || '')}"></label>
        <label class="check"><input type="checkbox" id="f-icuplanauto" data-field="icuPlanAuto" ${D.icuPlanAuto !== false ? 'checked' : ''}><span>${t('icu_plan_auto')}</span></label>
        <label class="check"><input type="checkbox" id="f-icuauto" data-field="icuAuto" ${D.icuAuto ? 'checked' : ''}><span>${t('icu_auto')}</span></label><p class="small muted">${t('icu_auto_note')}</p>
        <div class="fld"><span class="lbl">${t('icu_load_hdr')}</span><small class="muted">${t('icu_load_expl')}</small>
          <div class="lph">${['CORE', 'LEG', 'MOB', 'ACT', 'REC', 'GROUP'].map(ty => `<label class="tin"><span>${t('typeS_' + ty)}</span><input id="lph-${ty}" data-lph="${ty}" inputmode="numeric" value="${(D.loadPerHour && D.loadPerHour[ty]) || LOAD_PER_HOUR[ty]}"><span>/${lang() === 'nl' ? 'u' : 'h'}</span></label>`).join('')}</div></div>
        <div class="row"><button class="btn ghost" data-act="icutest">${t('icu_test')}</button><button class="btn" data-act="icusend">${t('icu_send')}</button></div><p class="msg" id="icumsg" aria-live="polite"></p>
        <p class="small muted">${t('icu_privacy')}</p>`)
    + sec(t('backup'), `<p class="small muted">${t('backup_note')}</p>${S.lastBackup ? `<p class="small muted">${t('bk_last', { d: DN.fmtY(S.lastBackup) })}</p>` : ''}
        <div class="row"><button class="btn" data-act="backupfile">${t('bk_file')}</button><button class="btn ghost" data-act="backup">${t('backup')}</button><span class="msg" id="bmsg"></span></div>
        <textarea id="restore" placeholder="${t('restore_ph')}"></textarea><div class="row"><button class="btn quiet" data-act="restore">${t('restore')}</button><label class="btn quiet filebtn">${t('bk_from_file')}<input type="file" id="restorefile" accept=".json,application/json,text/plain" hidden></label></div>
        ${store.get('prevProfile', null) ? `<button class="btn quiet" data-act="restoreprev">${t('rs_prev', { d: DN.fmtY(store.get('prevAt', today())) })}</button>` : ''}`)
    + sec(t('reset'), `<button class="btn danger" data-act="reset">${UI.resetArmed ? t('reset_confirm') : t('reset')}</button>`)
    + sec(t('about'), `<picture class="logo-mid"><source srcset="icons/logo-light.png" media="(prefers-color-scheme: dark)"><img src="icons/logo-dark.png" alt="DynamVic Cycling coach"></picture><p class="small">${t('disclaimer')}</p><p class="small muted">DynamCore · ${t('version')} ${VERSION}</p>${accInfoCard()}`);
}

/* ---------- install card ---------- */
let deferredInstall = null;
const isStandalone = () => (window.matchMedia && matchMedia('(display-mode: standalone)').matches) || navigator.standalone === true;
const isIOS = () => /iphone|ipad|ipod/i.test(navigator.userAgent) || (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1);
function installCard() {
  if (isStandalone() || S.hideInstall) return '';
  return `<div class="card"><h3>${t('install_title')}</h3><p class="small">${isIOS() ? t('install_ios') : t('install_android')}</p>
    <div class="row">${deferredInstall ? `<button class="btn" data-act="install">${t('install_now')}</button>` : ''}<button class="btn quiet" data-act="hideinstall">${t('hide')}</button></div></div>`;
}

/* ---------- router ---------- */
const VIEWS = { week: vWeek, plan: vPlan, routines: vRoutines, progress: vProgress, library: vLibrary, settings: vSettings, session: vSession };
function route() {
  if (ACT.state !== 'ok') { $('#view').innerHTML = ACT.state === 'checking' ? '' : vLock(); $('nav.tabs').hidden = true; return; }
  let h = (location.hash || '#week').slice(1);
  if (!P) h = 'wizard';
  const html = h === 'wizard' ? vWizard() : (VIEWS[h] || vWeek)();
  $('#view').innerHTML = html;
  $('nav.tabs').hidden = !P;
  document.querySelectorAll('nav.tabs a').forEach(a => a.toggleAttribute('aria-current', a.dataset.tab === h));
  document.querySelectorAll('nav.tabs [data-l]').forEach(s => { s.textContent = t(s.dataset.l); });
}
function rerender() { const y = scrollY; route(); scrollTo(0, y); }
addEventListener('hashchange', () => { UI.resetArmed = false; if (location.hash !== '#settings') UI.settingsD = null; UI.planD = null; route(); scrollTo(0, 0); });

/* ---------- sheet ---------- */
function sheet(html) {
  // v2.3: one sheet pattern – close (✕, 44 px) top right; a sheet's main action sits fixed at the bottom (.sheetact); backdrop tap and Esc also close
  const d = $('#sheet'); $('#sheetin').innerHTML = `<button class="iconbtn sheetx" data-act="closesheet" aria-label="${t('close')}">${IC.x}</button>${html}`;
  if (d.showModal) { if (!d.open) d.showModal(); } else d.setAttribute('open', '');
}
const closeSheet = () => { const d = $('#sheet'); if (d.open) d.close(); };
$('#sheet').addEventListener('click', e => { if (e.target === e.currentTarget) closeSheet(); });

/* ---------- copy ---------- */
async function copyText(text, msgEl, preEl) {
  try { await navigator.clipboard.writeText(text); if (msgEl) msgEl.textContent = t('copied'); }
  catch (e) { if (preEl) { const r = document.createRange(); r.selectNodeContents(preEl); const s = getSelection(); s.removeAllRanges(); s.addRange(r); } if (msgEl) msgEl.textContent = t('copy_fail'); }
  if (msgEl) setTimeout(() => { msgEl.textContent = ''; }, 3000);
}

/* ---------- guided mode ---------- */
const G = { steps: [], i: 0, end: 0, start: 0, paused: false, left: 0, iv: null, ctx: null, lock: null, lastBeep: null, r: null };
function beep(freq, dur) {
  try { const c = G.ctx; if (!c) return; const o = c.createOscillator(), g = c.createGain(); o.frequency.value = freq;
    g.gain.setValueAtTime(0.0001, c.currentTime); g.gain.exponentialRampToValueAtTime(0.5, c.currentTime + 0.02); g.gain.exponentialRampToValueAtTime(0.0001, c.currentTime + dur);
    o.connect(g); g.connect(c.destination); o.start(); o.stop(c.currentTime + dur + 0.05); } catch (e) { }
}
const buzz = p => { try { navigator.vibrate && navigator.vibrate(p); } catch (e) { } };
function speak(text) {
  if (P.voice === false || !('speechSynthesis' in window)) return;
  try {
    speechSynthesis.cancel();
    const u = new SpeechSynthesisUtterance(text);
    const want = lang() === 'nl' ? ['nl-BE', 'nl-NL', 'nl'] : ['en-GB', 'en-US', 'en'];
    const vs = speechSynthesis.getVoices();
    const chosen = P.voiceName && vs.find(x => x.name === P.voiceName && x.lang && x.lang.toLowerCase().startsWith(lang()));
    const v = chosen || want.map(w => vs.find(x => x.lang && x.lang.replace('_', '-').startsWith(w))).find(Boolean);
    if (v) u.voice = v; u.lang = want[0]; u.rate = 1.0;
    speechSynthesis.speak(u);
  } catch (e) { }
}
async function wake() { try { if ('wakeLock' in navigator) G.lock = await navigator.wakeLock.request('screen'); } catch (e) { } }
document.addEventListener('visibilitychange', () => { if (document.visibilityState === 'visible' && !$('#guided').hidden) wake(); });

function buildSteps(ses) {
  const steps = [{ kind: 'ready', dur: 10 }];
  const all = [];
  ses.blocks.forEach(b => { for (let r = 0; r < b.rounds; r++) b.items.forEach((it, i) => all.push({ b, r, i, it })); });
  all.forEach((x, n) => {
    const { b, r, i, it } = x, d = it.dose;
    const sides = d.side ? ['L', 'R'] : [null];
    sides.forEach((sd, si) => {
      const timed = d.k === 't' || d.k === 'b';
      steps.push({ kind: 'work', id: it.id, dose: d, side: sd, timed, dur: d.k === 't' ? d.n : d.k === 'b' ? d.n * 10 : 0, blk: b.k, round: r + 1, rounds: b.rounds, cue: it.cue || null, ex: n + 1 });
      if (sd === 'L') steps.push({ kind: 'switch', dur: timed ? 5 : 3 });
    });
    const nxt = all[n + 1];
    if (!nxt) return;
    const lastInRound = i === b.items.length - 1;
    if (b.rest && nxt.b === b) steps.push({ kind: 'rest', dur: lastInRound ? b.roundRest : b.rest, next: nxt.it });
    else steps.push({ kind: 'rest', dur: nxt.b !== b ? 15 : 5, next: nxt.it, short: true });
  });
  return steps;
}
function startGuided(r) {
  try { const AC = window.AudioContext || window.webkitAudioContext; if (AC) { G.ctx = G.ctx || new AC(); G.ctx.resume && G.ctx.resume(); } } catch (e) { }
  beep(1, 0.01);
  G.r = r; G.steps = buildSteps(r.ses); G.exTotal = G.steps.reduce((m, s) => Math.max(m, s.ex || 0), 0); G.flash = false; G.i = 0; G.paused = false; G.done = false; G.lastBeep = null; G.t0 = Date.now(); G.pms = 0; G.ps = 0;
  enter(true); render();
  $('#guided').hidden = false; document.body.classList.add('noscroll');
  wake(); clearInterval(G.iv); G.iv = setInterval(tick, 200); tick();
}
function stopGuided() {
  clearInterval(G.iv); $('#guided').hidden = true; document.body.classList.remove('noscroll');
  try { G.lock && G.lock.release(); } catch (e) { } G.lock = null; try { speechSynthesis.cancel(); } catch (e) { }
}
function enter(first) {
  const s = G.steps[G.i];
  G.start = Date.now(); G.end = s.dur ? Date.now() + s.dur * 1000 : 0;
  if (!first) G.flash = true;   // v2.2: visible cue at every step change (iPhone has no vibration and the silent switch mutes beeps)
  if (s.kind === 'work') {
    const sideTxt = s.side ? ` ${s.side === 'L' ? t('g_left') : t('g_right')}.` : '';
    speak(`${exName(s.id)}.${sideTxt} ${fmtDose({ ...s.dose, side: false }).replace(t('sec'), lang() === 'nl' ? 'seconden' : 'seconds')}`);
    if (!first) { beep(1320, 0.35); buzz([250]); }
  } else if (s.kind === 'rest') {
    if (!s.short) { speak(`${t('g_rest')}. ${t('g_next')}: ${exName(s.next.id)}`); beep(660, 0.35); buzz([120, 80, 120]); }
  } else if (s.kind === 'switch') { speak(t('g_switch')); }
  else if (s.kind === 'ready') speak(`${t('g_get_ready')}. ${exName(G.steps[1].id)}`);
}
function advance() {
  G.i++;
  if (G.i >= G.steps.length) return finishGuided();
  enter(false); render();
}
function tick() {
  if (G.paused || G.done) return;
  const s = G.steps[G.i];
  if (s.dur) {
    const left = Math.ceil((G.end - Date.now()) / 1000);
    if (left <= 0) return advance();
    if (left <= 3 && G.lastBeep !== `${G.i}-${left}`) { G.lastBeep = `${G.i}-${left}`; beep(880, 0.1); }
    const b = $('#guided .big'); if (b && b.textContent !== String(left)) b.textContent = left;
  }
}
function render() {
  const s = G.steps[G.i]; if (!s) return;
  const el = $('#guided');
  const total = G.steps.length, pct = G.i / total * 100;
  const left = s.dur ? Math.max(0, Math.ceil(((G.paused ? G.left : G.end - Date.now())) / 1000)) : Math.floor((Date.now() - G.start) / 1000);
  const nextWork = G.steps.slice(G.i + 1).find(x => x.kind === 'work');
  // v2.2: dark screen in both themes; work = accent colour, rest/ready/switch = teal (only the details carry the colour)
  el.className = s.kind === 'work' ? 'work' : 'pause';
  let mid = '', act = '';
  if (s.kind === 'work') {
    const e = EXMAP[s.id];
    mid = `<div class="kind">${t('blk_' + s.blk)}${s.side ? ' · ' + (s.side === 'L' ? t('g_left') : t('g_right')) : ''}</div>
      ${ANIMV.svg(s.id, 'gfig cue cap', { tight: true, secs: !s.timed })}<div class="num"><span class="big${ANIMV.has(s.id) ? ' sm' : ''}">${s.timed ? left : s.dose.n}</span><span class="unit">${s.timed ? t('sec') : t('reps')}</span></div>
      <div class="exn">${esc(exName(s.id))}</div>${s.cue ? `<div class="cue icue">${esc(t(s.cue))}</div>` : ''}<div class="cue">${esc(e.cue[lang()][0])}</div>
      ${nextWork && nextWork.id !== s.id ? `<div class="nxt">${t('g_upnext')}: ${esc(exName(nextWork.id))}</div>` : ''}`;
    if (!s.timed) act = `<button class="gdone" data-act="gnext">${t('g_done_btn')}</button>`;   // fixed place, full width, above the bottom bar
  } else {
    const label = s.kind === 'ready' ? t('g_get_ready') : s.kind === 'switch' ? t('g_switch') : t('g_rest');
    const nx = s.kind === 'switch' ? G.steps[G.i + 1] : s.next ? { id: s.next.id } : G.steps[G.i + 1];
    mid = `<div class="kind">${label}</div><div class="num"><span class="big">${left}</span><span class="unit">${t('sec')}</span></div>${nx && nx.id ? upNext(nx.id) : ''}`;
  }
  const rd = s.kind === 'work' && s.rounds > 1 ? t('g_round', { a: s.round, b: s.rounds }) : '';
  const restAdj = s.kind === 'rest' ? `<div class="gadj"><button data-act="gadj" data-v="-15">−15 s</button><button data-act="gadj" data-v="15">+15 s</button></div>` : '';
  // exercise counter "4/9" + one segment per exercise (a plain bar when there are very many)
  const exN = s.kind === 'work' ? s.ex : nextWork ? nextWork.ex : G.exTotal, doneN = s.kind === 'work' ? s.ex - 1 : exN - 1, tot = G.exTotal;
  const bar = tot && tot <= 40 ? `<div class="gseg">${Array.from({ length: tot }, (_, k) => `<i class="${k < doneN ? 'on' : k === exN - 1 && s.kind === 'work' ? 'cur' : ''}"></i>`).join('')}</div>`
    : `<div class="gbar"><i style="width:${pct}%"></i></div>`;
  el.innerHTML = `<div class="gtop">${bar}<div class="gt"><button class="gstopt" data-act="gstop">${IC.x}<span>${t('g_stop')}</span></button><span class="gmeta">${rd ? rd + ' · ' : ''}${esc(t('type_' + G.r.ses.type))}</span><span class="gcount" aria-label="${t('g_count', { a: exN, b: tot })}">${exN}/${tot}</span>
      <button class="gicon" data-act="gvoice" aria-label="${t('g_voice')}">${P.voice === false ? IC.mute : IC.sound}</button></div></div>
    <div class="gmid ${s.kind === 'work' ? 'gm-work' : 'gm-rest'}${G.flash ? ' gin' : ''}">${mid}${restAdj}</div>
    <div class="gfoot${act ? ' two' : ''}">${act}<div class="gbtns"><button data-act="gback" ${prevWork() < 0 ? 'disabled' : ''}>${IC.left}<span>${t('g_back')}</span></button><button class="main" data-act="gpause">${G.paused ? t('g_resume') : t('g_pause')}</button><button data-act="gnext"><span>${t('g_skip')}</span>${IC.right}</button></div></div>`;
  if (G.flash) {
    G.flash = false; const f = document.createElement('div'); f.className = 'gflash'; f.setAttribute('aria-hidden', 'true'); el.appendChild(f);
    setTimeout(() => f.remove(), 700);
  }
}
/* v2.2: "Hierna" block during rest/ready/switch: still picture of the start position, name, equipment (what this athlete has) and first cue */
function upNext(id) {
  const e = EXMAP[id]; if (!e) return '';
  const mine = e.eq.filter(x => (P.eq || []).includes(x)), eq = mine.length ? mine : e.eq;
  return `<div class="upn"><span class="upl">${t('g_upnext')}</span><div class="upc">${ANIMV.svg(id, 'still thumb', { tight: true, pose: 0 })}
    <div class="upt"><div class="exn">${esc(exName(id))}</div>${eqIcons(eq, true)}<div class="cue">${esc(e.cue[lang()][0])}</div></div></div></div>`;
}
function prevWork() { let j = G.i - 1; if (G.steps[G.i] && G.steps[G.i].kind !== 'work') { while (j >= 0 && G.steps[j].kind !== 'work') j--; } else { while (j >= 0 && G.steps[j].kind !== 'work') j--; } return j; }
function finishGuided() {
  G.done = true; clearInterval(G.iv); beep(1320, 0.7); buzz([300, 100, 300]); speak(t('g_finished'));
  if (G.paused && G.ps) G.pms += Date.now() - G.ps;
  const min = Math.max(1, Math.round((Date.now() - G.t0 - G.pms) / 60000)), r = G.r;
  stopGuided(); rerender();
  // session finished: date, RPE 1–10, actual duration and remark in one sheet (edits an existing log of this slot)
  openDone({ w: r.routine ? curWeek() : r.plan.w, key: r.routine ? 'R-' + r.routine : r.slot.key, type: r.ses.type, est: r.ses.est, guidedMin: min, routine: r.routine, isNew: !!r.routine, finished: true });
}

/* ---------- calendar ---------- */
function exportIcs(n) {
  const w0 = Math.max(1, curWeek());
  const ics = buildIcs(P, S, w0, n, 'DynamCore', (s) => `DynamCore · ${s.type === 'GROUP' ? t('type_GROUP') : t('type_' + s.type)}`);
  const name = 'dynamcore.ics';
  const url = URL.createObjectURL(new Blob([ics], { type: 'text/calendar' }));
  const a = document.createElement('a'); a.href = url; a.download = name; document.body.appendChild(a); a.click(); a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 4000);
}

/* ---------- Intervals.icu ---------- */
function icuCreds() {
  const D = location.hash === '#settings' && UI.settingsD ? UI.settingsD : P;
  const key = String(D.icuKey || '').trim(), id = String(D.icuId || '').trim() || '0';
  if (D !== P) { P.icuKey = key; P.icuId = D.icuId || ''; saveAll(); }
  return { key, id };
}
async function icuFetch(path, opts = {}) {
  const { key, id } = icuCreds();
  if (!key) throw { code: 'nokey' };
  let res;
  try {
    res = await fetch(`https://intervals.icu/api/v1/athlete/${encodeURIComponent(id)}${path}`, {
      ...opts, headers: { Authorization: 'Basic ' + btoa('API_KEY:' + key), 'Content-Type': 'application/json', ...(opts.headers || {}) }
    });
  } catch (e) { throw { code: 'blocked' }; }
  if (res.status === 401 || res.status === 403) throw { code: 'auth' };
  if (!res.ok) throw { code: 'http', status: res.status };
  return res.json().catch(() => ({}));
}
function icuError(e) {
  return e.code === 'nokey' ? t('icu_err_nokey') : e.code === 'auth' ? t('icu_err_auth') : e.code === 'blocked' ? t('icu_err_blocked') : t('icu_err_http', { s: e.status || '?' });
}
async function icuTest() {
  const m = $('#icumsg'); if (m) { m.className = 'msg'; m.textContent = '…'; }
  try { const a = await icuFetch(''); const nm = a.name || a.firstname || ''; if (m) m.textContent = t('icu_ok', { n: nm ? ` – ${nm}` : '' }); }
  catch (e) { if (m) { m.className = 'msg bad'; m.textContent = icuError(e); } }
}
const icuExtId = (w, key) => `dynamcore-${P.start}-w${w}-${key}`;
function icuEvents(weeks) {
  const td = today(), w0 = Math.max(1, curWeek()), out = [];
  const time = (P.icsTime || '19:00') + ':00';
  for (let w = w0; w < w0 + weeks; w++) {
    const plan = weekPlan(P, S, w);
    plan.slots.forEach(s => {
      const dn = plan.monday + s.day;
      if (s.skipped || dn < td || isDone(w, s.key)) return;
      out.push(icuEventFor(plan, s, w));
    });
  }
  return out;
}
function icuEventFor(plan, s, w) {
  const dn = plan.monday + s.day, time = (P.icsTime || '19:00') + ':00';
  let name, desc, mins;
  if (s.type === 'GROUP') { name = `DynamCore · ${slotTitle(s)}`; desc = lang() === 'nl' ? 'Groepssessie (buiten de app).' : 'Group session (outside the app).'; mins = 60; }
  else { const ses = buildSession(P, S, plan, s); name = `DynamCore · ${t('type_' + s.type)}`; desc = intervalsText({ ses, plan, slot: s, routine: null }); mins = ses.est; }
  const load = sessionLoad(P, s.type, mins);
  desc += `\nLoad: ${load} (${t('icu_load_note')})`;
  return { category: 'WORKOUT', type: 'WeightTraining', start_date_local: `${DN.iso(dn)}T${time}`, name, description: desc, moving_time: mins * 60, icu_training_load: load, external_id: icuExtId(w, s.key), _day: dn };
}
/* One session moved / skipped / un-skipped: update only that planned workout in Intervals.icu.
   Skipped → planned workout deleted. Moved or back on → upserted on its external_id (same workout, new date).
   A session that was never sent and lies outside the period sent so far is left for the next "send plan". */
async function icuSyncSlot(w, key) {
  if (!P.icuKey || !String(P.icuKey).trim()) return;
  const ext = icuExtId(w, key), sent = (S.icuSent || {})[ext];
  const plan = weekPlan(P, S, w), s = plan.slots.find(x => x.key === key); if (!s) return;
  const dn = plan.monday + s.day, td = today();
  try {
    if (s.skipped || isDone(w, key)) {
      if (!sent || sent.id == null) return;
      await icuFetch(`/events/${sent.id}`, { method: 'DELETE' }); delete S.icuSent[ext]; saveAll();
      return toast(t('mv_icu_deleted'));
    }
    if (dn < td) return;
    if (!sent && !(S.icuSentUntil && dn <= S.icuSentUntil)) return toast(t('mv_icu_later'));
    const { _day, ...ev } = icuEventFor(plan, s, w);
    const res = await icuFetch('/events/bulk?upsert=true', { method: 'POST', body: JSON.stringify([ev]) });
    const r0 = Array.isArray(res) ? res.find(x => x && x.external_id === ext) : null;
    S.icuSent = S.icuSent || {}; S.icuSent[ext] = { id: r0 ? r0.id : sent && sent.id, day: dn }; saveAll();
    toast(t('mv_icu_ok', { d: `${dayName(s.day, true)} ${DN.fmt(dn)}` }));
  } catch (e) { toast(icuError(e), true); }
}
function toast(msg, bad) {
  let el = $('#toast'); if (!el) { el = document.createElement('div'); el.id = 'toast'; el.setAttribute('role', 'status'); document.body.appendChild(el); }
  el.className = 'toast' + (bad ? ' bad' : ''); el.textContent = msg; el.hidden = false;
  clearTimeout(toast.tm); toast.tm = setTimeout(() => { el.hidden = true; }, bad ? 7000 : 3500);
}
async function icuSend(weeks, quiet) {
  const m = quiet ? null : $('#icumsg'); if (m) { m.className = 'msg'; m.textContent = '…'; }
  const evs = icuEvents(weeks);
  const td = today(), w0 = Math.max(1, curWeek()), endDay = mondayOfWeek(P, w0 + weeks) - 1;
  S.icuSent = S.icuSent || {};
  try {
    let res = [];
    if (evs.length) res = await icuFetch('/events/bulk?upsert=true', { method: 'POST', body: JSON.stringify(evs.map(({ _day, ...x }) => x)) });
    const byExt = {}; (Array.isArray(res) ? res : []).forEach(r => { if (r && r.external_id) byExt[r.external_id] = r.id; });
    evs.forEach(e => { const old = S.icuSent[e.external_id]; S.icuSent[e.external_id] = { id: byExt[e.external_id] ?? (old && old.id), day: e._day }; });
    // sessions sent earlier that are no longer in the plan for this period (skipped, removed): delete them
    const keep = new Set(evs.map(e => e.external_id)); let del = 0;
    S.logs.forEach(l => keep.add(icuExtId(l.w, l.key))); // completed sessions keep their planned workout (it is paired with the completed activity)
    for (const [ext, v] of Object.entries(S.icuSent)) {
      if (keep.has(ext) || !v || typeof v !== 'object' || v.id == null || v.day < td || v.day > endDay) continue;
      try { await icuFetch(`/events/${v.id}`, { method: 'DELETE' }); delete S.icuSent[ext]; del++; } catch (e) { }
    }
    S.icuSentUntil = Math.max(S.icuSentUntil || 0, endDay); saveAll();
    if (m) m.textContent = evs.length || del ? t('icu_sent', { n: evs.length }) + (del ? ' ' + t('icu_deleted', { n: del }) : '') : t('icu_nothing');
    if (!quiet) { S.icuAutoAt = today(); S.icuAutoWeek = curWeek(); saveAll(); }
    return { ok: true, n: evs.length, del };
  } catch (e) { if (m) { m.className = 'msg bad'; m.textContent = icuError(e); } return { ok: false, err: icuError(e) }; }
}
function voiceSelect(D) {
  if (!('speechSynthesis' in window)) return '';
  let vs = []; try { vs = speechSynthesis.getVoices().filter(v => v.lang && v.lang.toLowerCase().startsWith(D.lang || lang())); } catch (e) { }
  if (!vs.length) return `<p class="small muted">${t('voice_none')}</p>`;
  return `<label class="fld"><span class="lbl">${t('voice_pick')}</span><select id="f-voicename" data-field="voiceName"><option value="">${t('voice_auto')}</option>${vs.map(v => `<option value="${esc(v.name)}"${v.name === D.voiceName ? ' selected' : ''}>${esc(v.name)} (${esc(v.lang)})</option>`).join('')}</select></label>
    <button class="btn quiet" data-act="voicetest">${t('voice_test')}</button>`;
}

/* ---------- events ---------- */
function weekOv(w) { return S.weekOv[w] || (S.weekOv[w] = {}); }
document.addEventListener('click', ev => {
  const el = ev.target.closest('[data-act]'); if (!el) return;
  const a = el.dataset.act, D = UI.wz ? UI.wz.d : UI.settingsD;
  switch (a) {
    case 'go': location.hash = '#' + el.dataset.to; break;
    case 'back': if (history.length > 1) history.back(); else location.hash = '#week'; break;
    case 'fchip': { const tgt = !P ? UI.wz.d : (location.hash === '#plan' ? P : UI.settingsD); setField(tgt, el.dataset.f, el.dataset.v, true); rerender(); break; }
    case 'fset': { const tgt = !P ? UI.wz.d : UI.settingsD; setField(tgt, el.dataset.f, el.dataset.v, false); rerender(); break; }
    case 'addrace': {
      const d = $('#race-d').value, n = $('#race-n').value.trim(); if (!d) return;
      const tgt = !P ? UI.wz.d : (location.hash === '#plan' ? P : UI.settingsD);
      if (tgt === P) freezeNow();
      tgt.races.push({ d, n }); tgt.races.sort((x, y) => x.d.localeCompare(y.d)); if (P && tgt === P) saveAll(); rerender(); break;
    }
    case 'rmrace': { const tgt = !P ? UI.wz.d : (location.hash === '#plan' ? P : UI.settingsD); if (tgt === P) freezeNow(); tgt.races.splice(+el.dataset.i, 1); if (P && tgt === P) saveAll(); rerender(); break; }
    case 'wznext': UI.wz.step++; rerender(); scrollTo(0, 0); break;
    case 'wzback': UI.wz.step--; rerender(); scrollTo(0, 0); break;
    case 'wzlevel': UI.wz.testMode = el.dataset.v; rerender(); break;
    case 'wzfinish': {
      const d = UI.wz.d; d.start = DN.iso(DN.monday(DN.parse(d.start)));
      if (UI.wz.testMode === 'now') { d.level = levelFromTest(UI.wz.test) || 1; S.tests = [{ w: 1, d: today(), ...UI.wz.test }]; } else d.level = 1;
      P = d; UI.wz = null; saveAll(); UI.viewWeek = null; location.hash = '#week'; route(); break;
    }
    case 'wk': UI.viewWeek = Math.max(1, UI.viewWeek + +el.dataset.d); rerender(); break;
    /* v2.2 */
    case 'wzhint': { const c = $('#f-accept'); if (c) { c.scrollIntoView({ block: 'center' }); c.focus({ preventScroll: true }); } break; }
    case 'todaystart': { UI.sess = { w: +el.dataset.w, key: el.dataset.k }; const r = resolveSession(); if (r) startGuided(r); break; }
    case 'todaydone': case 'slotdone': {
      closeSheet(); UI.sess = { w: +el.dataset.w, key: el.dataset.k }; const r = resolveSession();
      if (r) openDone({ w: r.plan.w, key: r.slot.key, type: r.ses.type, est: r.ses.est, routine: null, isNew: false }); break;
    }
    case 'slotmenu': slotMenu(+el.dataset.w, el.dataset.k); break;
    case 'weekmenu': {
      const w = +el.dataset.w, tv = !!weekPlan(P, S, w).travel;
      sheet(`<h3>${t('week_opts')} · ${t('week_n', { n: w })}</h3><div class="chips col">${chip('travel', `data-w="${w}"`, tv, t('travel_mode'))}</div><p class="small muted">${t('travel_on')}</p>`);
      break;
    }
    case 'animplay': { const sv = el.querySelector('svg.anim'); if (!sv) break; const on = sv.classList.toggle('still'); el.setAttribute('aria-pressed', String(!on)); el.classList.toggle('on', !on); ANIMV.kick(); break; }
    case 'gow': UI.viewWeek = +el.dataset.w; location.hash = '#week'; break;
    case 'open': UI.sess = { w: +el.dataset.w, key: el.dataset.k }; if (location.hash === '#session') { route(); scrollTo(0, 0); } else location.hash = '#session'; break;
    case 'routine': UI.sess = { routine: el.dataset.r, type: UI.extraType }; location.hash = '#session'; break;
    case 'extratype': UI.extraType = el.dataset.v; rerender(); break;
    case 'travel': { const w = +el.dataset.w, o = weekOv(w); o.travel = !(o.travel ?? P.travelAlways); saveAll(); closeSheet(); rerender(); break; }
    case 'togrec': { const w = +el.dataset.w, o = weekOv(w); o.rec = !isRecovery(P, S, w); saveAll(); rerender(); break; }
    case 'skip': { const w = +el.dataset.w, k = el.dataset.k, o = weekOv(w); (o.skips = o.skips || {})[k] = true; saveAll(); closeSheet(); rerender(); icuSyncSlot(w, k); break; }
    case 'unskip': { const w = +el.dataset.w, k = el.dataset.k, o = weekOv(w); if (o.skips) delete o.skips[k]; saveAll(); closeSheet(); rerender(); icuSyncSlot(w, k); break; }
    case 'movesheet': {
      const w = +el.dataset.w, k = el.dataset.k, plan = weekPlan(P, S, w), slot = plan.slots.find(x => x.key === k); if (!slot) break;
      const o = weekOv(w), moved = o.moves && o.moves[k] != null;
      let orig = null;
      if (moved) { const keep = o.moves[k]; delete o.moves[k]; const p0 = weekPlan(P, S, w).slots.find(x => x.key === k); orig = p0 ? p0.day : null; o.moves[k] = keep; }
      UI.moveCtx = { w, k };
      const others = d => plan.slots.filter(x => x.day === d && x.key !== k && !x.skipped).map(x => t('typeS_' + x.type)).join(', ');
      const opts = moveDays(plan, slot);
      sheet(`<h3>${t('move_to')}</h3><p class="small muted">${esc(slotTitle(slot))} · ${dayName(slot.day, true)} ${DN.fmt(plan.monday + slot.day)}</p>
        ${opts.length ? `<div class="chips col">${opts.map(d => chip('moveto', `data-d="${d}"`, false, `${dayName(d, true)} ${DN.fmt(plan.monday + d)}${d === orig ? ' · ' + t('mv_orig') : ''}${others(d) ? ` <small class="muted">(${t('mv_also')}: ${esc(others(d))})</small>` : ''}`)).join('')}</div>` : `<p class="muted">${t('mv_none')}</p>`}
        <p class="small muted">${t('mv_week_only')}${P.icuKey ? ' ' + t('mv_icu') : ''}</p>`);
      break;
    }
    case 'moveto': {
      const { w, k } = UI.moveCtx, o = weekOv(w), d = +el.dataset.d;
      if (k !== 'GROUP') { const plan = weekPlan(P, S, w); const keep = (o.moves || {})[k]; if (o.moves) delete o.moves[k]; const base = weekPlan(P, S, w).slots.find(x => x.key === k); if (keep != null) o.moves[k] = keep; if (base && base.day === d) { if (o.moves) delete o.moves[k]; saveAll(); closeSheet(); rerender(); icuSyncSlot(w, k); break; } }
      (o.moves = o.moves || {})[k] = d; if (k === 'GROUP' && d === +P.group.day) delete o.moves.GROUP;
      saveAll(); closeSheet(); rerender(); icuSyncSlot(w, k); break;
    }
    case 'groupedit': {
      const w = +el.dataset.w, o = weekOv(w); UI.groupW = w;
      const focus = o.groupFocus || P.group.focus;
      sheet(`<h3>${t('type_GROUP')} · ${t('week_n', { n: w })}</h3><div class="chips">${chip('groupoff', '', !!o.groupOff, t('group_off'))}</div>
        <span class="lbl">${t('group_focus_week')}</span><div class="chips">${OPT.focus.map(v => chip('groupfocus', `data-v="${v}"`, focus.includes(v), t('focus_' + v))).join('')}</div>`);
      break;
    }
    case 'groupoff': { const o = weekOv(UI.groupW); o.groupOff = !o.groupOff; saveAll(); closeSheet(); rerender(); break; }
    case 'groupfocus': { const o = weekOv(UI.groupW); const f = [...(o.groupFocus || P.group.focus)]; const i = f.indexOf(el.dataset.v); if (i >= 0) f.splice(i, 1); else f.push(el.dataset.v); o.groupFocus = f; saveAll(); el.setAttribute('aria-pressed', String(i < 0)); rerender(); break; }
    case 'gotest': ev.preventDefault(); UI.testW = +el.dataset.w || UI.testW; UI.testOpen = true; if (location.hash === '#progress') rerender(); else location.hash = '#progress'; break;
    case 'acceptlvl': P.level = S.suggest; P.adj = {}; S.suggest = null; saveAll(); rerender(); break;
    case 'declinelvl': S.suggest = null; saveAll(); rerender(); break;
    case 'dur': { const c = UI.sess; if (c.routine) c.dur = +el.dataset.v; else { const o = weekOv(c.w); (o.dur = o.dur || {})[c.key] = +el.dataset.v; saveAll(); } rerender(); break; }
    case 'exinfo': sheet(exCard(EXMAP[el.dataset.id])); break;
    case 'swapsheet': {
      const r = resolveSession(); const id = el.dataset.id; UI.swapCtx = { orig: el.dataset.orig, id };
      const inSes = new Set(r.ses.blocks.flatMap(b => b.items.map(i => i.id)));
      const wkIds = r.ses.eng === 2 ? weekMainIds(P, r.plan) : new Set();
      let opts = swapOptions(P, id, r.ses.level, r.ses.travel).filter(e => !inSes.has(e.id));
      if (opts.some(e => !wkIds.has(e.id))) opts = opts.filter(e => !wkIds.has(e.id));   // v2.1: prefer what is not done elsewhere this week
      UI.swapCtx.eng = r.ses.eng; UI.swapCtx.block = r.plan.block;
      sheet(`<h3>${t('swap_title')}</h3><p class="small muted">${esc(exName(id))}</p>${opts.length ? `<div class="swl">${opts.map(e => `<button class="swo" data-act="swapto" data-id="${e.id}"><span>${esc(e.n[lang()])}</span>${lvlDots(e.lvl)}<small>${e.eq.length ? e.eq.map(x => t('eq_' + x)).join(' / ') : ''}</small></button>`).join('')}</div>` : `<p class="muted">${t('swap_none')}</p>`}
        ${r.ses.eng === 2 && !r.routine ? `<label class="check"><input type="checkbox" id="swblock" checked><span>${t('swap_block')}</span></label>` : ''}
        <label class="check"><input type="checkbox" id="swnever"><span>${t('swap_never', { x: esc(exName(id)) })}</span></label>`);
      break;
    }
    case 'swapto': {
      const c = UI.sess, o = weekOv(c.w); o.swaps = o.swaps || {}; const m = o.swaps[c.key] = o.swaps[c.key] || {};
      m[UI.swapCtx.orig] = el.dataset.id;
      if (UI.swapCtx.eng === 2 && $('#swblock') && $('#swblock').checked) {   // v2.1: keep the swap for the rest of this block
        S.blkSwaps = S.blkSwaps || {}; const bk = `${UI.swapCtx.block}|${c.key}`; (S.blkSwaps[bk] = S.blkSwaps[bk] || {})[UI.swapCtx.orig] = { to: el.dataset.id, from: c.w };
      }
      if ($('#swnever') && $('#swnever').checked) { P.blocked = [...new Set([...(P.blocked || []), UI.swapCtx.id])]; }
      saveAll(); closeSheet(); rerender(); break;
    }
    case 'engnow': { if (!UI.engArmed) { UI.engArmed = true; rerender(); } else startEngNow(); break; }
    case 'guided': { const r = resolveSession(); if (r) startGuided(r); break; }
    case 'gback': { const j = prevWork(); if (j < 0) break; if (G.paused) { G.paused = false; if (G.ps) G.pms += Date.now() - G.ps; G.ps = 0; } G.i = j; G.lastBeep = null; enter(false); render(); break; }
    case 'gadj': {
      const d = +el.dataset.v * 1000, s = G.steps[G.i]; if (!s || !s.dur) break;
      if (G.paused) G.left = Math.max(1000, G.left + d); else G.end = Math.max(Date.now() + 1000, G.end + d);
      const left = Math.max(0, Math.ceil(((G.paused ? G.left : G.end - Date.now())) / 1000)); const b = $('#guided .big'); if (b) b.textContent = left; break;
    }
    case 'gnext': if (G.paused) { G.paused = false; if (G.ps) G.pms += Date.now() - G.ps; G.ps = 0; } advance(); break;
    case 'gpause':
      if (G.paused) { G.paused = false; if (G.ps) G.pms += Date.now() - G.ps; G.ps = 0; const s = G.steps[G.i]; if (s.dur) G.end = Date.now() + G.left; else G.start = Date.now() - G.left; }
      else { G.paused = true; G.ps = Date.now(); const s = G.steps[G.i]; G.left = s.dur ? Math.max(0, G.end - Date.now()) : Date.now() - G.start; try { speechSynthesis.cancel(); } catch (e) { } }
      render(); break;
    case 'gstop': stopGuided(); rerender(); break;
    case 'gvoice': P.voice = P.voice === false; saveAll(); if (P.voice === false) { try { speechSynthesis.cancel(); } catch (e) { } } render(); break;
    case 'markdone': { const r = resolveSession(); if (r) openDone({ w: r.routine ? curWeek() : r.plan.w, key: r.routine ? 'R-' + r.routine : r.slot.key, type: r.ses.type, est: r.ses.est, routine: r.routine, isNew: !!r.routine }); break; }
    case 'grpopen': { const w = +el.dataset.w; if (isDone(w, 'GROUP')) sheet(doneBlock(w, 'GROUP', 'GROUP')); else openDone({ w, key: 'GROUP', type: 'GROUP', est: 60 }); break; }
    case 'copyint': { const r = resolveSession(); copyText(intervalsText(r), $('#cmsg'), $('#itxt')); break; }
    case 'ics': exportIcs(+el.dataset.n); break;
    case 'icutest': icuTest(); break;
    case 'voicetest': { const keep = P.voiceName; P.voiceName = UI.settingsD.voiceName; speak(lang() === 'nl' ? 'Dead bug. Acht per kant.' : 'Dead bug. Eight per side.'); P.voiceName = keep; break; }
    case 'icusend': icuSend(4); break;
    case 'libcat': UI.libCat = el.dataset.v; rerender(); break;
    case 'sw': {
      const f = el.dataset.f;
      if (UI.sw && UI.sw.f === f) { const s = Math.round((Date.now() - UI.sw.t0) / 1000); UI.sw = null; const inp = $('#t-' + f); inp.value = s; inp.dispatchEvent(new Event('input', { bubbles: true })); rerender(); }
      else { UI.sw = { f, t0: Date.now() }; rerender(); }
      break;
    }
    case 'savesettings': {
      freezeNow();
      const D2 = UI.settingsD; if (startLocked()) D2.start = P.start; D2.start = DN.iso(DN.monday(DN.parse(D2.start)));
      if (+D2.level !== +P.level) D2.adj = {};
      P = clone(D2); saveAll(); document.documentElement.lang = lang(); UI.viewWeek = null; rerender(); const m = $('#smsg'); if (m) m.textContent = t('saved'); break;
    }
    case 'pause': freezeNow(); P.paused = today(); saveAll(); location.hash = '#week'; break;
    case 'resume': {
      freezeNow(); const from = P.paused, to = today(), wp = planWeekOf(P, from);
      P.pauses = P.pauses || []; if (to > from) P.pauses.push({ from, to }); P.paused = null;
      Object.keys(S.weekSnap || {}).forEach(k => { if (+k > wp) delete S.weekSnap[k]; });   // v2.0.1: weeks after the pause start get new dates
      routinesByDate(); freezeNow(); UI.viewWeek = null; UI.settingsD = null; saveAll(); location.hash = '#week'; rerender(); break; }
    case 'backup': case 'backupfile': {
      if (!hasIcuKey()) { doBackup(a, false); break; }
      UI.bkKind = a;
      sheet(`<h3>${t('bk_key_title')}</h3><p class="small">${t('bk_key_q')}</p><div class="chips col">${chip('bkkey', 'data-v="0"', false, t('bk_key_no'))}${chip('bkkey', 'data-v="1"', false, t('bk_key_yes'))}</div>`);
      break;
    }
    case 'bkkey': closeSheet(); doBackup(UI.bkKind, el.dataset.v === '1'); break;
    case 'bklater': S.backupSnooze = today() + 7; saveAll(); rerender(); break;
    case 'restore': {
      let o; try { o = JSON.parse($('#restore').value); } catch (e) { o = null; }
      const r = checkBackup(o);
      if (!r.ok) { $('#restore').value = ''; $('#restore').placeholder = t(r.why === 'start' ? 'rs_bad_start' : 'restore_bad'); break; }
      UI.restoreCand = r;
      if (!P) { doRestore(); break; }
      sheet(`<h3>${t('rs_q_title')}</h3><p>${t('rs_q', { d: r.at ? DN.fmtY(DN.parse(r.at)) : '?', n: r.profile.name ? ` (${esc(r.profile.name)})` : '' })}</p>
        <div class="sheetact"><div class="row"><button class="btn primary" data-act="restorego">${t('rs_yes')}</button><button class="btn quiet" data-act="closesheet">${t('rs_no')}</button></div></div>`);
      break;
    }
    case 'restorego': closeSheet(); doRestore(); break;
    case 'restoreprev': {
      const pp = store.get('prevProfile', null), ps = store.get('prevState', null); if (!pp) break;
      const curP = P, curS = S;
      P = pp; S = Object.assign({ weekOv: {}, logs: [], tests: [] }, ps || {}); saveAll();
      store.set('prevProfile', curP); store.set('prevState', curS); store.set('prevAt', today());
      UI.settingsD = null; UI.viewWeek = null; location.hash = '#week'; route(); toast(t('rs_prev_done')); break;
    }
    case 'reset':
      if (!UI.resetArmed) { UI.resetArmed = true; rerender(); setTimeout(() => { if (UI.resetArmed) { UI.resetArmed = false; if (location.hash === '#settings') rerender(); } }, 5000); }
      else { const keepLang = lang(); try { localStorage.removeItem('dc:profile'); localStorage.removeItem('dc:state'); } catch (e) { } P = null; S = { weekOv: {}, logs: [], tests: [], suggest: null }; UI.wz = null; UI.resetArmed = false; UI.settingsD = null; location.hash = '#wizard'; route(); UI.wz.d.lang = keepLang; rerender(); }
      break;
    case 'install': if (deferredInstall) { deferredInstall.prompt(); deferredInstall.userChoice.finally(() => { deferredInstall = null; rerender(); }); } break;
    case 'hideinstall': S.hideInstall = true; saveAll(); rerender(); break;
    case 'closesheet': closeSheet(); break;
  }
});
function alertCard(m) { sheet(`<p>${esc(m)}</p>`); }

document.addEventListener('input', ev => {
  const tg = ev.target;
  if (tg.id === 'libq') { UI.libQ = tg.value; $('#liblist').innerHTML = libList(); return; }
  if (tg.id === 'libmine') { UI.libMine = tg.checked; $('#liblist').innerHTML = libList(); return; }
  if (tg.dataset.field) {
    const D = !P ? UI.wz.d : UI.settingsD; if (!D) return;
    const k = tg.dataset.field; D[k] = tg.type === 'checkbox' ? tg.checked : tg.value;
    if (k === 'accepted') rerender();
    return;
  }
  if (tg.dataset.lph && UI.settingsD) { const v = parseInt(tg.value, 10); UI.settingsD.loadPerHour = UI.settingsD.loadPerHour || {}; if (v > 0) UI.settingsD.loadPerHour[tg.dataset.lph] = v; else delete UI.settingsD.loadPerHour[tg.dataset.lph]; return; }
  if (tg.dataset.tk) {
    const key = tg.dataset.tk; const raw = tg.value.replace(',', '.').replace(/[^0-9.\-+]/g, '');
    const val = raw === '' || isNaN(parseFloat(raw)) ? null : Math.round(parseFloat(raw) * 10) / 10;
    if (!P) { if (val == null) delete UI.wz.test[key]; else UI.wz.test[key] = val; const btn = $('[data-act="wznext"]'); if (btn) btn.disabled = !levelFromTest(UI.wz.test); return; }
    let rec = S.tests.find(x => x.w === UI.testW); if (!rec) { rec = { w: UI.testW, d: today() }; S.tests.push(rec); }
    if (val == null) delete rec[key]; else rec[key] = val;
    const l = levelFromTest(rec);
    if (l && l !== P.level) S.suggest = l; else if (l === P.level) S.suggest = null;
    saveAll();
    const m = $('#tmsg'); if (m) m.textContent = l ? t('test_saved', { l: `${l} · ${t('lvl_' + l)}` }) : t('saved');
  }
});
/* v2.2: remember whether the test form is open (a re-render keeps it as the athlete left it) */
document.addEventListener('toggle', ev => { if (ev.target && ev.target.id === 'testd') UI.testOpen = ev.target.open; }, true);
document.addEventListener('change', ev => { if (ev.target.dataset && ev.target.dataset.tk && !P) rerender(); if (ev.target.dataset && ev.target.dataset.tk && P && location.hash === '#progress') rerender(); });

addEventListener('beforeinstallprompt', e => { e.preventDefault(); deferredInstall = e; if ((location.hash || '#week') === '#week') rerender(); });
if ('serviceWorker' in navigator && location.protocol === 'https:') addEventListener('load', () => { navigator.serviceWorker.register('sw.js').catch(() => { }); });
if ('speechSynthesis' in window) { try { speechSynthesis.getVoices(); speechSynthesis.onvoiceschanged = () => { if (location.hash === '#settings') rerender(); }; } catch (e) { } }
setInterval(() => { if (UI.sw) { const s = Math.round((Date.now() - UI.sw.t0) / 1000); const i = $('#t-' + UI.sw.f); if (i) i.value = s; } }, 250);

/* ---------- 5. back-up as a file + monthly reminder ---------- */
/* v2.0: the Intervals.icu key is only in the back-up when the athlete chooses so (asked each time) */
const hasIcuKey = () => !!(P && P.icuKey && String(P.icuKey).trim());
const backupJson = withKey => { const pr = clone(P); if (!withKey) { delete pr.icuKey; } return JSON.stringify({ app: 'dynamcore', v: 2, at: DN.iso(today()), profile: pr, state: S }); };
function doBackup(kind, withKey) {
  if (kind === 'backupfile') return backupFile($('#bmsg'), withKey);
  S.lastBackup = today(); saveAll(); const data = backupJson(withKey); copyText(data, $('#bmsg'), null); const r = $('#restore'); if (r) r.value = data;
}

/* ---------- restore: check the file, fill what is missing, keep the previous data aside ---------- */
const isIso = x => typeof x === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(x) && DN.iso(DN.parse(x)) === x;   // v2.0.1: real calendar dates only
function checkBackup(o) {
  if (!o || typeof o !== 'object' || o.app !== 'dynamcore' || !o.profile || typeof o.profile !== 'object') return { ok: false, why: 'format' };
  const src = o.profile, def = defaultProfile(); let fixed = 0;
  if (!isIso(src.start)) return { ok: false, why: 'start' };
  const p = Object.assign({}, src);
  const fix = (k, good, val) => { if (!good) { p[k] = val; fixed++; } };
  const numArr = a => Array.isArray(a) && a.every(x => Number.isInteger(+x) && +x >= 0 && +x <= 6);
  fix('lang', ['nl', 'en'].includes(p.lang), def.lang);
  fix('name', typeof p.name === 'string', '');
  ['rider', 'complaints', 'eq', 'blocked'].forEach(k => fix(k, Array.isArray(p[k]) && p[k].every(x => typeof x === 'string'), def[k]));
  fix('perWeek', [2, 3, 4, 5].includes(+p.perWeek), def.perWeek);
  fix('days', numArr(p.days) && p.days.length > 0, def.days);
  fix('hardBike', numArr(p.hardBike), []);
  fix('group', p.group && typeof p.group === 'object' && Number.isInteger(+p.group.day) && Array.isArray(p.group.focus), def.group);
  fix('dur', [15, 20, 30, 45].includes(+p.dur), def.dur);
  fix('rk', [0, 3, 4, 5].includes(+p.rk), def.rk);
  fix('races', Array.isArray(p.races) && p.races.every(r => r && isIso(r.d) && typeof (r.n ?? '') === 'string'), (Array.isArray(p.races) ? p.races.filter(r => r && isIso(r.d)).map(r => ({ d: r.d, n: String(r.n ?? '') })) : []));
  fix('icsTime', typeof p.icsTime === 'string' && /^\d{2}:\d{2}$/.test(p.icsTime), def.icsTime);
  fix('level', [1, 2, 3].includes(+p.level), 1);
  fix('adj', p.adj && typeof p.adj === 'object', {});
  // v2.0.1: pauses are { from, to } (day numbers); keep the valid ones, drop only the damaged ones
  if (p.pauses !== undefined) { const ok = Array.isArray(p.pauses) ? p.pauses.filter(x => x && Number.isFinite(x.from) && Number.isFinite(x.to) && x.to > x.from).map(x => ({ from: x.from, to: x.to })) : [];
    fixed += (Array.isArray(p.pauses) ? p.pauses.length : 1) - ok.length; p.pauses = ok; }
  if (p.paused != null && !Number.isFinite(p.paused)) { p.paused = null; fixed++; }
  const st = o.state && typeof o.state === 'object' ? Object.assign({}, o.state) : (fixed++, {});
  if (!st.weekOv || typeof st.weekOv !== 'object' || Array.isArray(st.weekOv)) { st.weekOv = {}; fixed++; }
  if (!Array.isArray(st.logs)) { st.logs = []; fixed++; }
  const nl = st.logs.length; st.logs = st.logs.filter(l => l && Number.isFinite(l.w) && typeof l.key === 'string' && typeof l.type === 'string' && Number.isFinite(l.d)); fixed += nl - st.logs.length;
  if (!Array.isArray(st.tests)) { st.tests = []; fixed++; }
  // v2.1: first week of the new builder, swaps kept per block, exercises stored with a completed session
  if (st.engFrom !== undefined && !(Number.isInteger(st.engFrom) && st.engFrom >= 1)) { delete st.engFrom; fixed++; }
  if (st.blkSwaps !== undefined && !(st.blkSwaps && typeof st.blkSwaps === 'object' && !Array.isArray(st.blkSwaps))) { st.blkSwaps = {}; fixed++; }
  st.logs.forEach(l => { if (l.ses !== undefined && !(l.ses && Array.isArray(l.ses.blocks))) { delete l.ses; fixed++; } });
  // v2.0.1: frozen weeks: keep the valid ones; a damaged week is dropped and simply follows the settings again
  if (st.weekSnap !== undefined) { const ws = st.weekSnap && typeof st.weekSnap === 'object' && !Array.isArray(st.weekSnap) ? st.weekSnap : {};
    const good = {}; Object.keys(ws).forEach(k => { if (/^\d+$/.test(k) && validSnap(ws[k])) good[k] = ws[k]; else fixed++; }); st.weekSnap = good; }
  return { ok: true, profile: p, state: st, at: isIso(o.at) ? o.at : null, fixed };
}
function doRestore() {
  const r = UI.restoreCand; if (!r) return;
  if (P) { store.set('prevProfile', P); store.set('prevState', S); store.set('prevAt', today()); }
  const keepKey = P && P.icuKey && !r.profile.icuKey ? { icuKey: P.icuKey, icuId: P.icuId || '' } : {};   // back-up without key: keep the key already on this phone
  P = Object.assign(r.profile, keepKey); S = Object.assign({ weekOv: {}, logs: [], tests: [] }, r.state);
  migrateData(); saveAll(); freezeNow(); UI.restoreCand = null; UI.settingsD = null; UI.viewWeek = null; location.hash = '#week'; route();
  toast(r.fixed ? t(r.fixed === 1 ? 'rs_fixed1' : 'rs_fixed', { n: r.fixed }) : t('rs_done'));
}
async function backupFile(msgEl, withKey) {
  S.lastBackup = today(); saveAll();
  const name = `dynamcore-backup-${(P.name || 'atleet').replace(/[^A-Za-z0-9_-]+/g, '-')}-${DN.iso(today())}.json`;
  const blob = new Blob([backupJson(withKey)], { type: 'application/json' });
  try {
    const file = new File([blob], name, { type: 'application/json' });
    if (navigator.canShare && navigator.canShare({ files: [file] })) { await navigator.share({ files: [file], title: 'DynamCore back-up' }); if (msgEl) msgEl.textContent = t('bk_done'); rerenderSoon(); return; }
  } catch (e) { if (e && e.name === 'AbortError') return; }
  const url = URL.createObjectURL(blob), a = document.createElement('a'); a.href = url; a.download = name; document.body.appendChild(a); a.click(); a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 4000); if (msgEl) msgEl.textContent = t('bk_done'); rerenderSoon();
}
function rerenderSoon() { setTimeout(() => { if (!$('#sheet').open) rerender(); }, 600); }
function backupReminder() {
  if (!S.logs.length) return '';
  const td = today(), first = Math.min(...S.logs.map(l => +l.d).filter(Number.isFinite), td), last = S.lastBackup || first;   // v2.0: never backed up → count from the first logged session
  if (td - last < 30 || (S.backupSnooze && td < S.backupSnooze)) return '';
  return `<div class="card warnc"><p><b>${t('bk_rem_title')}</b> ${last ? t('bk_rem_last', { d: DN.fmtY(last) }) : t('bk_rem_never')}</p>
    <div class="row"><button class="btn" data-act="backupfile">${t('bk_file')}</button><button class="btn quiet" data-act="bklater">${t('bk_later')}</button><span class="msg" id="bmsg"></span></div></div>`;
}
document.addEventListener('change', ev => {
  if (ev.target.id !== 'restorefile' || !ev.target.files || !ev.target.files[0]) return;
  const rd = new FileReader(); rd.onload = () => { $('#restore').value = String(rd.result || ''); $('[data-act=restore]').click(); }; rd.readAsText(ev.target.files[0]);
});
try { if (navigator.storage && navigator.storage.persist) navigator.storage.persist().catch(() => { }); } catch (e) { }

/* ---------- 1. new version available → banner with reload ---------- */
function showUpdateBanner() {
  if ($('#updbar')) return;
  const el = document.createElement('div'); el.id = 'updbar'; el.className = 'updbar'; el.setAttribute('role', 'status');
  el.innerHTML = `<span>${t('upd_new')}</span><button class="btn" data-act="updreload">${t('upd_reload')}</button>`;
  document.body.appendChild(el);
}
document.addEventListener('click', ev => { if (ev.target.closest('[data-act="updreload"]')) location.reload(); });
if ('serviceWorker' in navigator && location.protocol === 'https:') {
  const hadController = !!navigator.serviceWorker.controller;
  navigator.serviceWorker.addEventListener('controllerchange', () => { if (hadController) showUpdateBanner(); });
  const checkUpdate = () => navigator.serviceWorker.getRegistration().then(r => r && r.update()).catch(() => { });
  document.addEventListener('visibilitychange', () => { if (document.visibilityState === 'visible') checkUpdate(); });
  setInterval(checkUpdate, 30 * 60 * 1000);
}

/* ---------- 3. send the plan to Intervals.icu automatically, once a week ---------- */
async function icuAutoPlan() {
  if (!P || !P.icuKey || !String(P.icuKey).trim() || P.icuPlanAuto === false || P.paused) return;
  const td = today(), cw = curWeek();
  if (S.icuAutoTry === td) return;                                   // max. one attempt per day
  if (S.icuAutoAt && td - S.icuAutoAt < 7 && S.icuAutoWeek === cw) return;
  S.icuAutoTry = td; saveAll();
  const r = await icuSend(4, true);
  if (r && r.ok) { S.icuAutoAt = td; S.icuAutoWeek = cw; saveAll(); if (r.n || r.del) toast(t('icu_auto_plan_ok', { n: r.n })); }
  else if (r) toast(t('icu_auto_plan_err') + ' ' + r.err, true);
}
document.addEventListener('visibilitychange', () => { if (document.visibilityState === 'visible' && ACT.state === 'ok') icuAutoPlan(); });

migrateData(); try { localStorage.setItem('dc:state', JSON.stringify(S)); if (P) localStorage.setItem('dc:profile', JSON.stringify(P)); } catch (e) { }
freezeNow();
checkActivation().then(() => { importChallengeFromUrl(); route(); setTimeout(() => { icuCleanup().finally(icuAutoPlan); }, 1500); });
