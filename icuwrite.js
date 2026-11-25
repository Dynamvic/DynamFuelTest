'use strict';
/* DynamFuel – write the fuel plan into the planned workout in Intervals.icu (Phase 4 A, coach decision 25-11-2026).
   Pure: no fetch, no DOM. The app does GET → withBlock() → PUT updateEvent (checked in the official OpenAPI spec 25-11-2026:
   PUT /api/v1/athlete/{id}/events/{eventId}, EventEx with description and carbs_per_hour).
   Safety:
   - Only DynamFuel's own block between [DynamFuel] and [/DynamFuel] is ever added, replaced or removed; the coach's text stays.
   - Intervals.icu reads the description to build workout steps (forum), so no DynamFuel line may look like a step: every line
     starts with "• " (never "-", a digit or "3x"), and the markers start with "[".
   - After writing, the app compares the workout before and after (signature()); if it changed, the old description is put back. */
(function (root, factory) {
  const m = factory();
  if (typeof module === 'object' && module.exports) module.exports = m; else root.DFIcuWrite = m;
})(typeof self !== 'undefined' ? self : this, function () {
  const START = '[DynamFuel]', END = '[/DynamFuel]';
  const esc = s => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const BLOCK = new RegExp(`\\n*${esc(START)}[\\s\\S]*?${esc(END)}\\n*`, 'g');
  const count = (s, m) => String(s || '').split(m).length - 1;

  /* a line that Intervals.icu cannot mistake for a workout step */
  const safeLine = s => '• ' + String(s).replace(/[\r\n]+/g, ' ').replace(/\[\/?DynamFuel\]/gi, '').trim();
  function buildBlock(lines) { return [START, ...lines.filter(Boolean).map(safeLine), END].join('\n'); }
  /* description without DynamFuel's block. Only the blank lines directly around the block (the seam) change; the rest of
     the coach's text stays byte for byte the same (review #5) */
  function stripBlock(desc) {
    const s = String(desc || '');
    return s.replace(BLOCK, (m, off) => { const before = s.slice(0, off), after = s.slice(off + m.length); return before && after ? '\n\n' : ''; });
  }
  /* true only for a complete block (start and end marker) */
  function hasBlock(desc) { return new RegExp(`${esc(START)}[\\s\\S]*?${esc(END)}`).test(String(desc || '')); }
  /* false when the markers do not pair up (e.g. a "[DynamFuel]" typed by the coach): then the app writes nothing (review #8) */
  function markersOk(desc) { const a = count(desc, START), b = count(desc, END); return a === b && a <= 1; }
  function withBlock(desc, block) { const base = stripBlock(desc).replace(/\n+$/, ''); return (base ? base + '\n\n' : '') + block; }

  /* carbs_per_hour (decision 3): fill only when empty or when it still holds the value DynamFuel wrote before */
  function carbsToSend(current, lastSent, target) {
    if (!(target > 0)) return undefined;
    if (current == null || current === '' || (lastSent != null && +current === +lastSent)) return Math.round(target);
    return undefined;
  }
  /* what must not change when only the description is written */
  /* the whole step tree (nested repeats, ramps, targets, cadence, text) with a stable key order (review #6) */
  const stable = v => Array.isArray(v) ? '[' + v.map(stable).join(',') + ']'
    : v && typeof v === 'object' ? '{' + Object.keys(v).sort().map(k => JSON.stringify(k) + ':' + stable(v[k])).join(',') + '}'
    : JSON.stringify(v === undefined ? null : v);
  function signature(ev) {
    const d = ev && ev.workout_doc;
    const steps = d && Array.isArray(d.steps) ? stable(d.steps) : '';
    return [ev && ev.type, d ? d.duration : null, steps].join('|');
  }
  /* short stable code of the block, to show "changed since sent" */
  function hash(s) { let h = 2166136261; for (let i = 0; i < s.length; i++) { h ^= s.charCodeAt(i); h = Math.imul(h, 16777619); } return (h >>> 0).toString(36); }
  return { START, END, buildBlock, stripBlock, hasBlock, markersOk, withBlock, carbsToSend, signature, hash, safeLine };
});
