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

  /* a line that Intervals.icu cannot mistake for a workout step */
  const safeLine = s => '• ' + String(s).replace(/[\r\n]+/g, ' ').replace(/\[\/?DynamFuel\]/gi, '').trim();
  function buildBlock(lines) { return [START, ...lines.filter(Boolean).map(safeLine), END].join('\n'); }
  /* description without DynamFuel's block (the rest untouched, only blank lines at the seam trimmed) */
  function stripBlock(desc) { return String(desc || '').replace(BLOCK, '\n\n').replace(/\n{3,}/g, '\n\n').replace(/^\n+|\n+$/g, ''); }
  function hasBlock(desc) { return new RegExp(esc(START)).test(String(desc || '')); }
  function withBlock(desc, block) { const base = stripBlock(desc); return (base ? base + '\n\n' : '') + block; }

  /* carbs_per_hour (decision 3): fill only when empty or when it still holds the value DynamFuel wrote before */
  function carbsToSend(current, lastSent, target) {
    if (!(target > 0)) return undefined;
    if (current == null || current === '' || (lastSent != null && +current === +lastSent)) return Math.round(target);
    return undefined;
  }
  /* what must not change when only the description is written */
  function signature(ev) {
    const d = ev && ev.workout_doc;
    const steps = d && Array.isArray(d.steps) ? JSON.stringify(d.steps.map(s => [s.duration, s.reps || 0, s.power || null, (s.steps || []).length])) : '';
    return [ev && ev.type, d ? d.duration : null, steps].join('|');
  }
  /* short stable code of the block, to show "changed since sent" */
  function hash(s) { let h = 2166136261; for (let i = 0; i < s.length; i++) { h ^= s.charCodeAt(i); h = Math.imul(h, 16777619); } return (h >>> 0).toString(36); }
  return { START, END, buildBlock, stripBlock, hasBlock, withBlock, carbsToSend, signature, hash, safeLine };
});
