'use strict';
/* DynamFuel – small pure helpers for the screens (UX release 1, docs/ux-review.md). No DOM, no fetch, no Date.now.
   They only choose WHAT to show and in which order; they never change a number from the engine or the matcher. */
(function (root, factory) {
  const m = factory();
  if (typeof module === 'object' && module.exports) module.exports = m; else root.DFUi = m;
})(typeof self !== 'undefined' ? self : this, function () {
  /* stock filter chips (#1): cat = 'all' | 'own' | a category; inStock = only qty > 0. Hidden products never show here.
     Order (coach Q1): favourites first, then in stock, then the order of the list itself (stable). */
  const CATS = ['gel', 'bar', 'chew', 'drink', 'electrolyte', 'food'];
  function filterStock(items, stock, opt) {
    const o = Object.assign({ cat: 'all', inStock: false, q: '' }, opt), st = id => (stock && stock[id]) || {};
    return items.map((it, i) => ({ it, i, s: st(it.id) }))
      .filter(x => !x.s.hidden && (!o.inStock || x.s.qty > 0) && (!o.q || matches(x.it, o.q)))
      .filter(x => o.cat === 'all' || (o.cat === 'own' ? !!x.it.own : x.it.category === o.cat))   // an own gel is a gel too
      .sort((a, b) => (!!b.s.fav - !!a.s.fav) || ((b.s.qty > 0) - (a.s.qty > 0)) || a.i - b.i)
      .map(x => x.it);
  }
  /* timing list (#3): one drink line for the usual amount; rows only for moments with something to eat, or with a drink amount
     that differs from the usual one (e.g. the last, longer slot). eat = true when the moment has food/gel to show. */
  function timingRows(slots, schedule, usualMl, eatAt) {
    return slots.map((s, i) => {
      const sc = (schedule && schedule[i]) || { eat: [], drinkMl: usualMl };
      const eat = eatAt(s, sc), odd = sc.drinkMl && sc.drinkMl !== usualMl ? sc.drinkMl : null;
      return eat || odd ? { i, eat, drinkMl: odd } : null;
    }).filter(Boolean);
  }
  /* range text only when it is a real range (#11) */
  const isRange = (lo, hi) => lo != null && hi != null && lo !== hi;
  /* wizard defaults (coach Q2, Q4): 2 bottle cages; bedtime 23:00 once caffeine is used. Only fills what is still empty. */
  const DEFAULT_CAGES = 2, DEFAULT_BEDTIME = '23:00';
  function withDefaults(d) {
    const o = Object.assign({}, d);
    if (o.cages == null) o.cages = DEFAULT_CAGES;
    if (o.caffeine && o.caffeine !== 'none' && !o.bedtime) o.bedtime = DEFAULT_BEDTIME;
    return o;
  }
  /* gut tolerance quick choices (coach Q3): input shortcuts only; the engine's caps (CHO-CAP-01/02) still decide the target */
  const GUT_CHIPS = [null, 30, 45, 60, 75, 90, 120];
  /* UX #19: what a pack list takes from the stock, in stock units (gels/bars/servings, drink doses, tabs). Water and refill
     notes take nothing. Only products that are in stock; never below 0. → [{ id, from, to }] */
  function usePack(pack, qty) {
    const need = {};
    (pack || []).forEach(p => {
      if (p.refill || !p.id) return;
      const n = !p.bottle ? p.n : p.content === 'drink' ? Math.ceil(p.bottles * (p.doses || 0) - 1e-9) : p.content === 'electrolyte' ? p.bottles * (p.tabs || 0) : 0;
      if (n > 0) need[p.id] = (need[p.id] || 0) + n;
    });
    return Object.keys(need).filter(id => (qty[id] || 0) > 0).map(id => ({ id, from: qty[id], to: Math.max(0, qty[id] - need[id]) }));
  }
  /* the stock the matcher sees for one ride: what was taken off for THIS ride counts again, so its own plan does not change.
     raw = [{ id, qty, fav, hidden }] in stock order; exists(id) = the product is still known → [{ id, qty, fav }] */
  function stockForRide(raw, used, exists) {
    const back = {}; ((used && used.items) || []).forEach(x => { back[x.id] = (back[x.id] || 0) + (x.from - x.to); });
    return raw.map(s => ({ id: s.id, qty: (s.qty || 0) + (back[s.id] || 0), fav: !!s.fav, hidden: s.hidden }))
      .filter(s => s.qty > 0 && !s.hidden && exists(s.id)).map(s => ({ id: s.id, qty: s.qty, fav: s.fav }));
  }
  /* search in the stock list (UX #17): every word must appear in brand + name; accents and case do not matter */
  const fold = s => String(s || '').toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '');
  const matches = (it, q) => { const hay = fold(`${it.brand || ''} ${it.name || ''}`); return fold(q).split(/\s+/).filter(Boolean).every(w => hay.includes(w)); };
  return { CATS, filterStock, usePack, stockForRide, matches, timingRows, isRange, withDefaults, GUT_CHIPS, DEFAULT_CAGES, DEFAULT_BEDTIME };
});
