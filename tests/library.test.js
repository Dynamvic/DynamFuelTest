'use strict';
(function () {
  const { test, assert, load, req } = typeof module === 'object' && module.exports ? require('./harness.js') : DFTest;
  const CATS = ['gel', 'bar', 'chew', 'drink', 'electrolyte', 'food'];
  const NUM = ['choG', 'sugarsG', 'sodiumMg', 'caffeineMg', 'waterMl', 'powderG', 'kcal', 'proteinG', 'fatG', 'fibreG'];

  test('library.json: schema – unique IDs, known categories, numbers or null (never text)', async () => {
    const L = await load('data/library.json');
    assert.equal(L.app, 'dynamfuel'); assert.equal(L.kind, 'library'); assert.ok(L.version);
    const ids = new Set();
    for (const it of L.items) {
      assert.ok(/^[a-z0-9][a-z0-9-]*$/.test(it.id), `id ${it.id}`);
      assert.ok(!ids.has(it.id), `duplicate ${it.id}`); ids.add(it.id);
      assert.ok(CATS.includes(it.category), `${it.id}: category`);
      for (const k of NUM) assert.ok(it[k] === null || typeof it[k] === 'number', `${it.id}: ${k} must be a number or null`);
      assert.ok(it.mtc === true || it.mtc === false || it.mtc === null, `${it.id}: mtc`);
      assert.ok(it.allergens === null || Array.isArray(it.allergens), `${it.id}: allergens`);
      assert.equal(it.allergensComplete, false, `${it.id}: web text is never a complete allergen declaration`);
      if (it.sodiumMg != null) assert.ok(it.sodiumBasis, `${it.id}: sodium needs its basis`);
      if (it.category === 'drink' || it.category === 'electrolyte') assert.ok(it.waterMl > 0, `${it.id}: label water`);
      assert.ok(it.checked && /^\d{2}-\d{2}-\d{4}$/.test(it.checked), `${it.id}: date checked DD-MM-YYYY`);
    }
    assert.equal(L.items.length, 28);
  });

  test('library.json: spot checks against the spreadsheet (OPEN stays null, not 0)', async () => {
    const L = await load('data/library.json'), by = id => L.items.find(i => i.id === id);
    const g = by('ndz-nrgy-gel-45'); assert.equal(g.choG, 45); assert.equal(g.sodiumMg, 460); assert.deepEqual([g.ratio.glucose, g.ratio.fructose], [1, 0.8]);
    const d = by('6d-ultra-drink'); assert.equal(d.choG, 90); assert.equal(d.waterMl, 500); assert.equal(d.powderG, 94);
    assert.equal(by('sis-beta-fuel-gel').sodiumMg, null); assert.equal(by('sis-beta-fuel-gel').serving.amount, null);
    assert.equal(by('sis-go-isotonic-gel').mtc, false);
    assert.equal(by('6d-sports-gel').ratio.directionKnown, false);
    assert.equal(by('sis-go-electrolyte-powder').sodiumBasis, 'calc from 20 mmol/l');
    assert.deepEqual(by('pwb-energize-berry').allergens, ['gluten', 'milk', 'nuts', 'soy']);
    assert.deepEqual(by('pwb-isoactive-orange').traces, ['milk', 'soy']);
  });

  test('library + engine + matcher: 3 h ride with real products from the library', async () => {
    const W = req('workout.js'), E = req('engine.js'), M = req('match.js');
    const rules = await load('data/rules.json'), L = await load('data/library.json');
    const profile = { birthYear: 1990, massKg: 70, gutCapGph: 90, salty: 'no', caffeine: 'normal', bedtime: '22:30', bottleMl: 750, cages: 2, allergens: [] };
    const ctx = { goalTag: 'endurance', rideYear: 2026, start: '09:00', refillMin: 90 };
    const T = E.plan({ parsed: W.parse(await load('tests/fixtures/Duur_3u_2026-11-28.json')), ctx, profile, rules });
    const stock = [{ id: 'ndz-nrgy-gel-45', qty: 6 }, { id: 'ndz-nrgy-drink-90', qty: 4 }, { id: '6d-sports-bar', qty: 2 }, { id: 'amacx-hydro-tabs', qty: 10 }];
    const r = M.match({ targets: T, items: L.items, stock, profile, ctx, rules });
    assert.ok(r.within, JSON.stringify(r.totals)); assert.ok(r.mtcOk);
    const gl = M.match({ targets: T, items: L.items, stock, profile: Object.assign({}, profile, { allergens: ['gluten'] }), ctx, rules });
    assert.ok(!gl.solids.some(s => s.id === '6d-sports-bar'), 'bar contains gluten');
    assert.ok(!gl.solids.some(s => s.id === 'ndz-nrgy-gel-45'), 'gel 45 allergens unknown → not used for an allergic athlete');
  });
})();
