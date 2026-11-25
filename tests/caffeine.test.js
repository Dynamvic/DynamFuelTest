'use strict';
(function () {
  const { test, assert, load, req } = typeof module === 'object' && module.exports ? require('./harness.js') : DFTest;

  test('caffeine.json: every product has caffeine, a source page and its own id; unknown values stay empty', async () => {
    const C = await load('data/caffeine.json'), L = await load('data/library.json');
    const ids = C.items.map(i => i.id);
    assert.equal(new Set(ids).size, ids.length, 'unique ids'); ids.forEach(id => assert.ok(!L.items.some(x => x.id === id), `${id} not also in library.json`));
    C.items.forEach(i => {
      assert.ok(i.caffeineMg > 0 && /^https:\/\//.test(i.source) && i.basis, i.id);
      assert.ok(['gel', 'chew'].includes(i.category), `${i.id}: gel or chew`);
      assert.ok(i.sodiumMg != null || /conflict/.test(i.sodiumBasis), `${i.id}: sodium or a reason why not`);
    });
    assert.equal(C.items.find(i => i.id === 'pwb-powergel-black-currant-caf').sodiumMg, null, 'label conflict → empty');
  });

  test('caffeine (P3-2): the late race dose swaps normal gels for caffeine gels near that moment; none above the dose', async () => {
    const W = req('workout.js'), E = req('engine.js'), M = req('match.js');
    const rules = await load('data/rules.json'), L = (await load('data/library.json')).items, C = (await load('data/caffeine.json')).items;
    const profile = { birthYear: 1990, massKg: 75, gutCapGph: 90, bottleMl: 750, cages: 2, salty: 'yes', caffeine: 'low', bedtime: '23:00', allergens: [], sweatTestPrompted: true };
    const ctx = { goalTag: 'race', start: '08:00', rideYear: 2026, indoor: false, refillMin: 90 };
    const T = E.plan({ parsed: W.parse(await load('tests/fixtures/5h_endurance.json')), ctx, profile, rules });
    const late = T.caffeine.doses.find(d => d.atMin > 0);
    assert.ok(T.caffeine.on && late, 'race > 2,5 h has a late dose (CAF-02)');
    const stock = [{ id: 'ndz-nrgy-gel-45', qty: 8 }, { id: 'ndz-nrgy-drink-90', qty: 10 }, { id: 'ndz-nrgy-gel-45-caf65', qty: 4 }, { id: 'ndz-nrgy-gel-45-caf130', qty: 4 }];
    const plain = M.match({ targets: T, items: L.concat(C), stock: stock.slice(0, 2), profile, ctx, rules });
    const r = M.match({ targets: T, items: L.concat(C), stock, profile, ctx, rules });
    const cf = r.caffeine[0];
    assert.ok(cf && !cf.none && cf.mg <= late.mg, 'caffeine from gels ≤ the dose');
    assert.ok(cf.mg >= 130, 'the most caffeine that fits the dose');
    assert.equal(cf.choDiffG, 0, 'same carbohydrate: Nrgy Gel 45 replaced by Nrgy Gel 45 with caffeine');
    assert.equal(r.totals.choG, plain.totals.choG, 'carbohydrate plan unchanged');
    const swapped = r.schedule.flatMap(s => s.eat.filter(e => e.caf).map(e => s.min));
    assert.equal(swapped.length, cf.n); swapped.forEach(m => assert.ok(Math.abs(m - late.atMin) <= 60, 'near the dose time'));
    assert.ok(r.pack.some(p => p.id === cf.id && p.n === cf.n), 'caffeine gels in the pack list');
    assert.ok(!r.schedule.some(s => s.min < late.atMin - 60 && s.eat.some(e => e.caf)), 'no caffeine gel early in the ride');
  });

  test('caffeine (EFSA 2015, CAF-05/07): every dose ≤ 200 mg, together ≤ 400 mg; none during pregnancy', async () => {
    const W = req('workout.js'), E = req('engine.js'), rules = await load('data/rules.json');
    const P = await load('tests/fixtures/5h_endurance.json'), parsed = W.parse(P);
    const ctx = { goalTag: 'race', start: '08:00', rideYear: 2026, indoor: false };
    const base = { birthYear: 1990, gutCapGph: 90, caffeine: 'normal', bedtime: '23:00', healthFlags: [] };
    const heavy = E.plan({ parsed, ctx, profile: Object.assign({ massKg: 95 }, base), rules }).caffeine;   // 3 mg/kg = 285 mg
    assert.equal(heavy.doses[0].mg, 200); assert.equal(heavy.doses[0].capped, 'single');
    assert.ok(heavy.doses.every(d => d.mg <= 200) && heavy.totalMg <= 400, 'together ≤ 400 mg');
    assert.equal(heavy.status, 'coach', 'no longer OPEN');
    const light = E.plan({ parsed, ctx, profile: Object.assign({ massKg: 60 }, base), rules }).caffeine;   // 3 mg/kg = 180 mg
    assert.equal(light.doses[0].mg, 175); assert.ok(!light.doses[0].capped, 'below the limit: unchanged (rounded to 25 mg)');
    const preg = E.plan({ parsed, ctx, profile: Object.assign({ massKg: 60 }, base, { healthFlags: ['pregnancy'] }), rules }).caffeine;
    assert.equal(preg.off, 'pregnancy'); assert.equal(preg.doses.length, 0); assert.ok(preg.rules.includes('CAF-07'));
  });

  test('caffeine: off (endurance ride or no caffeine use) → caffeine products are never used', async () => {
    const W = req('workout.js'), E = req('engine.js'), M = req('match.js');
    const rules = await load('data/rules.json'), L = (await load('data/library.json')).items, C = (await load('data/caffeine.json')).items;
    const profile = { birthYear: 1990, massKg: 75, gutCapGph: 90, bottleMl: 750, cages: 2, salty: 'yes', caffeine: 'none', allergens: [] };
    const ctx = { goalTag: 'race', start: '08:00', rideYear: 2026, indoor: true };
    const T = E.plan({ parsed: W.parse(await load('tests/fixtures/5h_endurance.json')), ctx, profile, rules });
    const r = M.match({ targets: T, items: L.concat(C), stock: [{ id: 'ndz-nrgy-gel-45-caf130', qty: 10 }], profile, ctx, rules });
    assert.equal(r.caffeine.length, 0); assert.ok(!r.pack.some(p => p.id === 'ndz-nrgy-gel-45-caf130'));
  });
})();
