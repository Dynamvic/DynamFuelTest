'use strict';
(function () {
  const { test, assert, load, req } = typeof module === 'object' && module.exports ? require('./harness.js') : DFTest;
  /* shaped like a real Open Food Facts answer (checked live 25-11-2026); sodium is in g per 100 g */
  const answer = { code: '1234567890123', status: 1, product: { product_name: 'Test gel', product_name_nl: 'Testgel', brands: 'Brand A, Brand B',
    serving_quantity: 40, nutriments: { carbohydrates_100g: 62.5, sugars_100g: 30, sodium_100g: 0.5, 'energy-kcal_100g': 250, proteins_100g: 0, fat_100g: 0 },
    allergens_tags: ['en:milk', 'en:soybeans', 'en:something-else'], traces_tags: ['en:nuts'] } };

  test('off: Open Food Facts answer → values per 100 g, EU allergen codes, sodium in mg; not found → found false', async () => {
    const O = req('off.js'), p = O.parse(answer, 'nl');
    assert.ok(p.found); assert.equal(p.name, 'Testgel'); assert.equal(p.brand, 'Brand A'); assert.equal(p.servingG, 40);
    assert.equal(p.per100.choG, 62.5); assert.equal(p.per100.sodiumMg, 500); assert.equal(p.per100.fibreG, null, 'missing stays empty');
    assert.deepEqual(p.allergens, ['milk', 'soy']); assert.deepEqual(p.traces, ['nuts']);
    assert.equal(O.parse({ status: 0, status_verbose: 'product not found' }).found, false);
    const s = O.parse({ status: 1, product: { nutriments: { salt_100g: 1 } } }); assert.equal(s.per100.sodiumMg, 400); assert.ok(/salt/.test(s.sodiumBasis));
    assert.ok(O.validCode('5410013108009') && !O.validCode('12ab') && !O.validCode('123'));
  });

  test('off: per serving = per 100 × serving / 100; saving needs a name, a serving, carbohydrate and the label check', async () => {
    const O = req('off.js');
    const ps = O.perServing(O.parse(answer).per100, 40);
    assert.equal(ps.choG, 25); assert.equal(ps.sodiumMg, 200); assert.equal(ps.kcal, 100); assert.equal(ps.fibreG, null);
    const ok = { name: 'Testgel', category: 'gel', serving: { amount: 40, unit: 'g' }, choG: 25, sodiumMg: 200, mtc: null, allergens: ['milk'], traces: [], labelChecked: true };
    const c = O.checkOwn(ok); assert.ok(c); assert.equal(c.allergensComplete, true); assert.equal(c.caffeineMg, 0);
    assert.equal(O.checkOwn(Object.assign({}, ok, { labelChecked: false })), null, 'label not checked');
    assert.equal(O.checkOwn(Object.assign({}, ok, { choG: null })), null, 'no carbohydrate');
    assert.equal(O.checkOwn(Object.assign({}, ok, { category: 'drink' })), null, 'drink without water per dose');
    assert.ok(O.checkOwn(Object.assign({}, ok, { category: 'drink', waterMl: 500 })));
  });

  test('off: own products survive a back-up; the matcher uses them like library products', async () => {
    const B = req('backup.js'), O = req('off.js'), M = req('match.js'), W = req('workout.js'), E = req('engine.js');
    const own = O.checkOwn({ name: 'Rijstreep', category: 'bar', serving: { amount: 50, unit: 'g' }, choG: 30, sodiumMg: 100, mtc: true, allergens: [], traces: [], labelChecked: true });
    const r = B.check({ app: 'dynamfuel', schema: 1, settings: { lang: 'nl' }, profile: {}, items: [{ id: 'own-abc1', qty: 6, fav: false, hidden: false, own }, { id: 'own-bad', qty: 1, own: { name: '' } }] }, 2026);
    assert.equal(r.data.items.length, 1); assert.deepEqual(r.data.items[0].own, own); assert.equal(r.fixed, 1);
    const rules = await load('data/rules.json');
    const T = E.plan({ parsed: W.parse(await load('tests/fixtures/Duur_3u_2026-11-28.json')),
      ctx: { goalTag: 'endurance', indoor: true, rideYear: 2026 }, profile: { massKg: 75, gutCapGph: 60, bottleMl: 750, cages: 2 }, rules });
    const m = M.match({ targets: T, items: [Object.assign({ id: 'own-abc1' }, own)], stock: [{ id: 'own-abc1', qty: 6 }], profile: { bottleMl: 750, cages: 2, gutCapGph: 60 }, ctx: { indoor: true }, rules });
    assert.ok(m.solids.length && m.solids[0].id === 'own-abc1');
  });
})();
