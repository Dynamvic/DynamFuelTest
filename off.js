'use strict';
/* DynamFuel – own products and the Open Food Facts barcode lookup (decision P3-5). Pure: no DOM, no fetch.
   Open Food Facts (ODbL, attribution on the About page) checked live 25-11-2026: GET /api/v2/product/{code}.json →
   { status 1|0, product { product_name, brands, nutriments { carbohydrates_100g, sugars_100g, sodium_100g (g!), salt_100g (g),
   energy-kcal_100g, proteins_100g, fat_100g, fiber_100g, caffeine_100g (g, rare) }, allergens_tags ['en:milk', …], traces_tags } }.
   Values are per 100 g (or 100 ml): the athlete enters the serving size and must tick "I checked the label" before saving. */
(function (root, factory) {
  const m = factory();
  if (typeof module === 'object' && module.exports) module.exports = m; else root.DFOff = m;
})(typeof self !== 'undefined' ? self : this, function () {
  const FIELDS = 'code,product_name,product_name_nl,product_name_en,brands,serving_quantity,nutriments,allergens_tags,traces_tags';
  const url = code => `https://world.openfoodfacts.org/api/v2/product/${encodeURIComponent(code)}.json?fields=${FIELDS}`;
  const validCode = c => /^\d{8,14}$/.test(String(c || '').trim());
  // Open Food Facts allergen tags → the 14 EU allergen codes used in DynamFuel
  const TAGS = { 'en:gluten': 'gluten', 'en:crustaceans': 'crustaceans', 'en:eggs': 'eggs', 'en:fish': 'fish', 'en:peanuts': 'peanuts',
    'en:soybeans': 'soy', 'en:milk': 'milk', 'en:nuts': 'nuts', 'en:celery': 'celery', 'en:mustard': 'mustard', 'en:sesame-seeds': 'sesame',
    'en:sulphur-dioxide-and-sulphites': 'sulphites', 'en:lupin': 'lupin', 'en:molluscs': 'molluscs' };
  const codes = tags => [...new Set((Array.isArray(tags) ? tags : []).map(t => TAGS[t]).filter(Boolean))];
  const num = x => x === '' || x == null || !isFinite(+x) ? null : +x;
  const r1 = x => x == null ? null : Math.round(x * 10) / 10;

  /* Open Food Facts answer → { found, name, brand, per100 {…}, allergens[], traces[], servingG } (missing values = null) */
  function parse(json, lang) {
    if (!json || json.status !== 1 || !json.product) return { found: false };
    const p = json.product, n = p.nutriments || {};
    const sodiumG = num(n.sodium_100g) != null ? num(n.sodium_100g) : num(n.salt_100g) != null ? num(n.salt_100g) / 2.5 : null;
    return {
      found: true, code: String(json.code || p.code || ''),
      name: String((lang === 'en' ? p.product_name_en : p.product_name_nl) || p.product_name || '').trim(),
      brand: String(p.brands || '').split(',')[0].trim(),
      per100: { kcal: num(n['energy-kcal_100g']), choG: num(n.carbohydrates_100g), sugarsG: num(n.sugars_100g), proteinG: num(n.proteins_100g),
        fatG: num(n.fat_100g), fibreG: num(n.fiber_100g), sodiumMg: sodiumG == null ? null : r1(sodiumG * 1000),
        caffeineMg: num(n.caffeine_100g) == null ? null : r1(num(n.caffeine_100g) * 1000) },
      sodiumBasis: num(n.sodium_100g) != null ? 'Open Food Facts sodium' : num(n.salt_100g) != null ? 'calc from salt (Open Food Facts)' : null,
      allergens: codes(p.allergens_tags), traces: codes(p.traces_tags), servingG: num(p.serving_quantity)
    };
  }
  /* per-100 values × serving / 100, one decimal */
  function perServing(per100, servingG) {
    const out = {}; Object.keys(per100 || {}).forEach(k => { out[k] = per100[k] == null || !(servingG > 0) ? null : r1(per100[k] * servingG / 100); }); return out;
  }
  const CATS = ['gel', 'bar', 'chew', 'drink', 'electrolyte', 'food'];
  /* an own product as saved by the athlete; returns the checked product or null */
  function checkOwn(o) {
    if (!o || typeof o !== 'object' || typeof o.name !== 'string' || !o.name.trim() || o.name.length > 80) return null;
    if (!CATS.includes(o.category) || o.labelChecked !== true) return null;
    const rng = (x, lo, hi) => x == null || (typeof x === 'number' && x >= lo && x <= hi);
    if (!(o.serving && typeof o.serving.amount === 'number' && o.serving.amount > 0 && o.serving.amount <= 2000 && ['g', 'ml'].includes(o.serving.unit))) return null;
    if (!(typeof o.choG === 'number' && o.choG >= 0 && o.choG <= 200)) return null;
    if (!rng(o.sugarsG, 0, 200) || !rng(o.sodiumMg, 0, 5000) || !rng(o.caffeineMg, 0, 400) || !rng(o.kcal, 0, 2000) || !rng(o.proteinG, 0, 200) || !rng(o.fatG, 0, 200) || !rng(o.fibreG, 0, 100)) return null;
    if (['drink', 'electrolyte'].includes(o.category) && !(typeof o.waterMl === 'number' && o.waterMl >= 50 && o.waterMl <= 2000)) return null;
    if (!rng(o.powderG, 0, 500) || !(o.mtc === true || o.mtc === null)) return null;
    if (!Array.isArray(o.allergens) || !Array.isArray(o.traces || [])) return null;
    return { brand: String(o.brand || '').slice(0, 40), name: o.name.trim(), category: o.category, serving: { amount: o.serving.amount, unit: o.serving.unit, format: '' },
      choG: o.choG, sugarsG: o.sugarsG ?? null, sodiumMg: o.sodiumMg ?? null, sodiumBasis: o.sodiumBasis || 'own label', caffeineMg: o.caffeineMg ?? 0,
      kcal: o.kcal ?? null, proteinG: o.proteinG ?? null, fatG: o.fatG ?? null, fibreG: o.fibreG ?? null, mtc: o.mtc,
      waterMl: o.waterMl ?? null, powderG: o.powderG ?? null, allergens: o.allergens.slice(), traces: (o.traces || []).slice(), free: [], allergensComplete: true,
      labelChecked: true, offCode: o.offCode || null, source: o.offCode ? 'Open Food Facts + own label check' : 'own label' };
  }
  return { url, validCode, parse, perServing, checkOwn, codes, CATS };
});
