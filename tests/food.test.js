'use strict';
(function () {
  const { test, assert, load, req } = typeof module === 'object' && module.exports ? require('./harness.js') : DFTest;

  test('food.json: every item cites NEVO per part; weights and glucose+fructose only with a source; nothing estimated', async () => {
    const F = await load('data/food.json');
    assert.equal(F.app, 'dynamfuel'); assert.ok(F.sources.NEVO2025 && F.sources['USDA-SR']);
    assert.deepEqual(F.items.map(i => i.id), ['food-banana', 'food-dates', 'food-rijsttaartje', 'food-ontbijtkoek', 'food-luikse-wafel', 'food-sandwich-jam']);
    F.items.forEach(f => {
      assert.ok(f.name.nl && f.name.en && f.unit.nl && f.unit.en, f.id);
      f.parts.forEach(p => {
        assert.ok(/^NEVO2025 \d+ /.test(p.ref), `${f.id}: NEVO reference`);
        ['kcal', 'choG', 'sugarsG', 'proteinG', 'fatG', 'fibreG', 'sodiumMg'].forEach(k => assert.ok(typeof p.per100[k] === 'number', `${f.id}.${k}`));
        assert.ok(p.per100.choG <= 100 && p.per100.sugarsG <= p.per100.choG, `${f.id}: sugars ≤ carbohydrate ≤ 100 g`);
        assert.ok(p.g == null || (p.g > 0 && /^USDA FDC \d+/.test(p.gSource)), `${f.id}: a portion weight needs a source`);
      });
      assert.ok(f.mtc === null || (f.mtc === true && /^USDA FDC \d+/.test(f.mtcBasis)), `${f.id}: glucose+fructose needs a source`);
      assert.ok(f.allergens === null ? f.allergensComplete === false : Array.isArray(f.allergens), `${f.id}: allergens`);
    });
  });

  test('food: values per serving = per 100 g × weight; no weight → no values (not used)', async () => {
    const D = req('food.js'), F = (await load('data/food.json')).items, by = id => F.find(f => f.id === id);
    const b = D.toItem(by('food-banana'), null, 'nl');
    assert.equal(b.serving.amount, 118); assert.equal(b.choG, 23.6); assert.equal(b.sugarsG, 18.3); assert.equal(b.sodiumMg, 0); assert.equal(b.mtc, true); assert.equal(b.category, 'food');
    assert.equal(D.toItem(by('food-dates'), [24], 'nl').choG, 16.9, 'Medjool 24 g');
    const s0 = D.toItem(by('food-sandwich-jam'), null, 'nl'); assert.ok(s0.missingWeight); assert.equal(s0.choG, null);
    const s1 = D.toItem(by('food-sandwich-jam'), [35, 15], 'en'); assert.equal(s1.choG, 26); assert.equal(s1.serving.amount, 50); assert.equal(s1.name, 'White bread with jam'); assert.equal(s1.mtc, null);
  });

  test('food: the matcher uses real food only when its weight is known; solid food only in easy moments', async () => {
    const D = req('food.js'), W = req('workout.js'), E = req('engine.js'), M = req('match.js');
    const F = (await load('data/food.json')).items, rules = await load('data/rules.json');
    const profile = { birthYear: 1990, massKg: 75, gutCapGph: 60, bottleMl: 750, cages: 2, salty: 'no', caffeine: 'none', allergens: [] };
    const T = E.plan({ parsed: W.parse(await load('tests/fixtures/Duur_3u_2026-11-28.json')), ctx: { goalTag: 'endurance', indoor: true, rideYear: 2026 }, profile, rules });
    const items = F.map(f => D.toItem(f, f.id === 'food-ontbijtkoek' ? null : undefined, 'nl'));
    const r0 = M.match({ targets: T, items, stock: [{ id: 'food-ontbijtkoek', qty: 10 }], profile, ctx: { indoor: true }, rules });
    assert.equal(r0.solids.length, 0, 'ontbijtkoek without a weight is not used');
    const r1 = M.match({ targets: T, items, stock: [{ id: 'food-banana', qty: 10 }], profile, ctx: { indoor: true }, rules });
    assert.ok(r1.solids.length && r1.solids[0].id === 'food-banana');
    r1.schedule.forEach(s => s.eat.forEach(e => assert.ok(s.easy || e.notEasy || e.beforeHard, 'banana only in easy moments (TIME-04)')));
  });
})();
