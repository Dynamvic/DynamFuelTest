'use strict';
/* DynamFuel – real food (data/food.json, decision P3-1). Pure: no DOM, no fetch.
   A food has one or more parts with values per 100 g (NEVO) and a weight in g (from a source, or entered by the athlete).
   toItem() turns it into a library-like item per serving that the matcher can use. A part without a weight → choG null,
   so the matcher leaves the food out until the athlete has entered the weight. Nothing is estimated. */
(function (root, factory) {
  const m = factory();
  if (typeof module === 'object' && module.exports) module.exports = m; else root.DFFood = m;
})(typeof self !== 'undefined' ? self : this, function () {
  const KEYS = ['kcal', 'choG', 'sugarsG', 'proteinG', 'fatG', 'fibreG', 'sodiumMg'];
  const r1 = x => Math.round(x * 10) / 10;
  /* weights: the athlete's grams per part (array, null = use the source weight) */
  function grams(food, weights) { return food.parts.map((p, i) => weights && weights[i] != null && +weights[i] > 0 ? +weights[i] : (p.g > 0 ? p.g : null)); }
  function toItem(food, weights, lang) {
    const g = grams(food, weights), known = g.every(x => x != null);
    const it = { id: food.id, brand: '', name: (food.name && (food.name[lang] || food.name.nl)) || food.id, category: 'food', food: true,
      serving: { amount: known ? r1(g.reduce((a, b) => a + b, 0)) : null, unit: 'g', format: '' },
      mtc: food.mtc === true ? true : null, caffeineMg: 0, waterMl: null, powderG: null,
      allergens: Array.isArray(food.allergens) ? food.allergens.slice() : null, traces: [], free: [], allergensComplete: food.allergensComplete === true,
      grams: g, missingWeight: !known };
    KEYS.forEach(k => {
      if (!known || food.parts.some(p => p.per100 == null || p.per100[k] == null)) { it[k] = null; return; }
      it[k] = r1(food.parts.reduce((a, p, i) => a + p.per100[k] * g[i] / 100, 0));
    });
    return it;
  }
  return { KEYS, grams, toItem };
});
