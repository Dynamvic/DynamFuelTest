'use strict';
/* DynamFuel – formatting and rounding. Pure: no DOM, no Date.now. Works in the browser (window.DFFmt) and in Node. */
(function (root, factory) {
  const m = factory();
  if (typeof module === 'object' && module.exports) module.exports = m; else root.DFFmt = m;
})(typeof self !== 'undefined' ? self : this, function () {
  /* round to a step (5 g, 50 ml, 50 mg, 25 mg); half-way rounds up; -0 becomes 0 */
  function roundTo(x, step) {
    if (x == null || !isFinite(x)) return null;
    const r = Math.round(x / step + 1e-9) * step;
    return Object.is(r, -0) ? 0 : +r.toFixed(6);
  }
  /* number with comma decimal: num(0.65, 2) -> "0,65"; num(1234) -> "1234" (no thousands separator) */
  function num(x, dec = 0) {
    if (x == null || !isFinite(x)) return '–';
    return (+x).toFixed(dec).replace('.', ',');
  }
  /* "2026-11-24" -> "24-11-2026" */
  function date(iso) {
    const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(iso || '');
    return m ? `${m[3]}-${m[2]}-${m[1]}` : '';
  }
  /* "07:45" -> 465 (minutes after midnight) */
  function toMin(hhmm) {
    const m = /^(\d{1,2}):(\d{2})$/.exec(hhmm || '');
    return m ? (+m[1]) * 60 + (+m[2]) : null;
  }
  /* clock("07:45", 75) -> "09:00"; wraps around midnight */
  function clock(start, offsetMin) {
    const s = typeof start === 'number' ? start : toMin(start);
    if (s == null) return '';
    const t = (((s + Math.round(offsetMin)) % 1440) + 1440) % 1440;
    return `${String(Math.floor(t / 60)).padStart(2, '0')}:${String(t % 60).padStart(2, '0')}`;
  }
  /* 4530 s -> "1:15:30"; 3600 -> "1:00" */
  function dur(sec) {
    const h = Math.floor(sec / 3600), m = Math.floor((sec % 3600) / 60), s = Math.round(sec % 60);
    return s ? `${h}:${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}` : `${h}:${String(m).padStart(2, '0')}`;
  }
  return { roundTo, num, date, toMin, clock, dur };
});
