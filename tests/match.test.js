'use strict';
(function () {
  const { test, assert, load, req } = typeof module === 'object' && module.exports ? require('./harness.js') : DFTest;
  const W = req('workout.js'), E = req('engine.js'), M = req('match.js');

  /* synthetic test products (not real labels) */
  const ITEMS = [
    { id: 'bar-b', category: 'bar', choG: 40, mtc: true, sodiumMg: 100, allergens: ['gluten', 'milk'], traces: [] },
    { id: 'drink-c', category: 'drink', choG: 90, waterMl: 500, powderG: 96, mtc: true, sodiumMg: 460, allergens: [], traces: [] },
    { id: 'drink-d', category: 'drink', choG: 40, waterMl: 500, powderG: 50, mtc: true, sodiumMg: 300, allergens: [], traces: [] },
    { id: 'gel-a', category: 'gel', choG: 45, mtc: true, sodiumMg: 200, allergens: [], traces: [] },
    { id: 'gel-g', category: 'gel', choG: 22, mtc: false, sodiumMg: null, allergens: [], traces: [] },
    { id: 'gel-x', category: 'gel', choG: 30, mtc: true, sodiumMg: 50, allergens: [], traces: ['nuts'] },
    { id: 'tab-e', category: 'electrolyte', choG: 0, waterMl: 500, sodiumMg: 300, mtc: null, allergens: [], traces: [] }
  ];
  const P = { birthYear: 1990, massKg: 70, gutCapGph: 90, salty: 'no', caffeine: 'normal', bedtime: '22:30', bottleMl: 750, cages: 2, allergens: [] };
  const build = async (name, ctx, prof, stock) => {
    const rules = await load('data/rules.json');
    const profile = Object.assign({}, P, prof);
    const T = E.plan({ parsed: W.parse(await load(`tests/fixtures/${name}.json`)), ctx: Object.assign({ rideYear: 2026, start: '09:00' }, ctx), profile, rules });
    return { T, r: M.match({ targets: T, items: ITEMS, stock, profile, ctx, rules }) };
  };

  test('match: 3 h at 90 g/h → carbohydrate within ± 10 % with whole servings', async () => {
    const { T, r } = await build('Duur_3u_2026-11-28', { goalTag: 'endurance', refillMin: 90 }, {}, [{ id: 'gel-a', qty: 10 }, { id: 'drink-d', qty: 6 }, { id: 'tab-e', qty: 4 }]);
    assert.equal(T.cho.totalG, 270);
    assert.ok(r.within, JSON.stringify(r.totals));
    assert.ok(r.totals.choG >= 243 && r.totals.choG <= 297);
    assert.ok(r.mtcOk);
    r.solids.forEach(s => assert.ok(Number.isInteger(s.n)));
  });

  test('match: drink at label concentration – a 750 ml bottle gets 1,5 doses', async () => {
    const { r } = await build('Duur_3u_2026-11-28', { goalTag: 'endurance', refillMin: 90 }, {}, [{ id: 'drink-d', qty: 6 }, { id: 'gel-a', qty: 10 }]);
    const d = r.bottles.find(b => b.content === 'drink');
    assert.ok(d, 'a drink bottle is used'); assert.equal(d.doses, 1.5); assert.equal(d.powderG, 75);
  });

  test('match: sodium above the advised range is reported (review #2), the plan itself stays', async () => {
    const rules = await load('data/rules.json'), profile = Object.assign({}, P);
    const T = E.plan({ parsed: W.parse(await load('tests/fixtures/Duur_3u_2026-11-28.json')), ctx: { rideYear: 2026, start: '09:00', goalTag: 'endurance', indoor: true }, profile, rules });
    const items = ITEMS.concat([{ id: 'gel-na', category: 'gel', choG: 45, mtc: true, sodiumMg: 900, allergens: [], traces: [] }]);
    const hi = M.match({ targets: T, items, stock: [{ id: 'gel-na', qty: 10 }], profile, ctx: { indoor: true }, rules });
    assert.ok(hi.within); assert.ok(hi.notes.some(n => n.key === 'sodium_high'), '6 gels × 900 mg = 5400 mg > 3 h × 400 mg/h');
    const lo = M.match({ targets: T, items, stock: [{ id: 'gel-x', qty: 12 }], profile, ctx: { indoor: true }, rules });
    assert.ok(!lo.notes.some(n => n.key === 'sodium_high'), 'low-sodium gels: no warning');
  });

  test('match: bottles must fit the cages outdoors; refill stops add capacity; indoor has no limit', async () => {
    const st = [{ id: 'gel-a', qty: 10 }];
    const a = await build('Duur_3u_2026-11-28', { goalTag: 'endurance' }, {}, st);
    assert.ok(a.r.gaps.some(g => g.what === 'fluid'), '1,8 l needs 3 bottles, 2 cages, no refill');
    const b = await build('Duur_3u_2026-11-28', { goalTag: 'endurance', refillMin: 90 }, {}, st);
    assert.ok(!b.r.gaps.some(g => g.what === 'fluid'));
    assert.ok(b.r.pack.some(p => p.refill && p.bottles === 1));
    const c = await build('Duur_3u_2026-11-28', { goalTag: 'endurance', indoor: true }, {}, st);
    assert.ok(!c.r.gaps.some(g => g.what === 'fluid')); assert.equal(c.r.bottles.length, 3);
  });

  test('match: above 60 g/h glucose-only products are not enough (CHO-MTC-01)', async () => {
    const { r } = await build('Duur_3u_2026-11-28', { goalTag: 'endurance', indoor: true }, {}, [{ id: 'gel-g', qty: 20 }]);
    assert.ok(r.totals.glucoseOnlyGph <= 60);
    assert.ok(r.gaps.some(g => g.what === 'cho'));
    assert.ok(r.shopping.length && r.shopping[0].items.every(i => ITEMS.find(x => x.id === i.id).mtc === true));
  });

  test('match: allergies and traces exclude products', async () => {
    const st = [{ id: 'bar-b', qty: 10 }, { id: 'gel-x', qty: 10 }, { id: 'gel-a', qty: 10 }];
    const { r } = await build('Duur_3u_2026-11-28', { goalTag: 'endurance', indoor: true }, { allergens: ['gluten', 'nuts'] }, st);
    assert.ok(!r.solids.some(s => s.id === 'bar-b' || s.id === 'gel-x'));
    assert.ok(r.notes.some(n => n.p && n.p.id === 'bar-b' && n.p.why === 'allergen'));
    assert.ok(r.notes.some(n => n.p && n.p.id === 'gel-x' && n.p.why === 'traces'));
  });

  test('match: short stock → gap + what to buy', async () => {
    const { r } = await build('Duur_3u_2026-11-28', { goalTag: 'endurance', indoor: true }, {}, [{ id: 'gel-a', qty: 2 }]);
    const g = r.gaps.find(x => x.what === 'cho');
    assert.ok(g && g.shortG > 0);
    assert.ok(r.shopping.find(s => s.for === 'cho').items.length > 0);
  });

  test('match: sodium – water bottles get electrolyte tabs until the lower bound is met', async () => {
    // gel-x has only 50 mg sodium per 30 g: 9 gels = 450 mg, below the 900 mg lower bound (300 mg/h × 3 h)
    const { r } = await build('Duur_3u_2026-11-28', { goalTag: 'endurance', indoor: true }, { salty: 'yes' }, [{ id: 'gel-x', qty: 12 }, { id: 'tab-e', qty: 5 }]);
    assert.ok(r.bottles.some(b => b.content === 'electrolyte'));
    assert.ok(r.totals.naMg >= 900 || r.gaps.some(g => g.what === 'sodium'));
    const plain = await build('Duur_3u_2026-11-28', { goalTag: 'endurance', indoor: true }, {}, [{ id: 'gel-a', qty: 10 }, { id: 'tab-e', qty: 5 }]);
    assert.ok(!plain.r.bottles.some(b => b.content === 'electrolyte'), 'enough sodium from gels: plain water');
  });

  test('match: no carbohydrate target → no food, only fluid', async () => {
    const { r } = await build('Duur_Speed_Skills_2026-11-30', {}, {}, [{ id: 'gel-a', qty: 10 }]);
    assert.equal(r.solids.length, 0); assert.equal(r.totals.choG, 0);
  });

  test('match: schedule – bars only in easy slots, nothing in hard efforts, all servings placed', async () => {
    const { T, r } = await build('Endurance_Shuttle_120m_2026-12-04', { goalTag: 'key', indoor: true }, {}, [{ id: 'bar-b', qty: 2 }, { id: 'gel-a', qty: 4 }]);
    const placed = r.schedule.reduce((a, s) => a + s.eat.length, 0);
    assert.equal(placed, r.solids.reduce((a, s) => a + s.n, 0));
    r.schedule.forEach(s => s.eat.forEach(e => { if (e.solid) assert.ok(s.easy || e.beforeHard, `bar at ${s.min} min is in an easy part`); }));
    assert.ok(T.slots.length > 0);
  });

  test('match: the first serving is eaten in the first 15–20 min (TIME-01), even with few servings', async () => {
    const { r } = await build('Duur_3u_2026-11-28', { goalTag: 'endurance', indoor: true }, { gutCapGph: 30 }, [{ id: 'gel-a', qty: 4 }]);
    const first = r.schedule.find(s => s.eat.length);
    assert.ok(first && first.min <= 20, `first intake at ${first && first.min} min`);
  });

  test('match: only bars in stock → first bar at the first slot, just before the hard block (TIME-05, review R2)', async () => {
    const { r } = await build('Endurance_Shuttle_120m_2026-12-04', { goalTag: 'endurance', indoor: true }, {}, [{ id: 'bar-b', qty: 4 }]);
    assert.equal(r.solids[0].n, 1, '60 g target: 1 bar (40 g) is closest; 2 bars (80 g) would be too much');
    assert.ok(r.gaps.some(g => g.what === 'cho'), 'and the gap is shown');
    const first = r.schedule.find(s => s.eat.length);
    assert.equal(first.min, 14); assert.ok(first.eat[0].beforeHard);
  });

  test('match: bottles ≤ 80 g/l preferred; a stronger bottle is flagged (MATCH-03, review R3)', async () => {
    const a = await build('Duur_3u_2026-11-28', { goalTag: 'endurance', indoor: true }, {}, [{ id: 'drink-c', qty: 6 }, { id: 'drink-d', qty: 6 }, { id: 'gel-a', qty: 10 }]);
    assert.ok(a.r.within); assert.ok(!a.r.bottles.some(b => b.id === 'drink-c'), 'the 180 g/l drink is not chosen when a weaker plan fits');
    const b = await build('Duur_3u_2026-11-28', { goalTag: 'endurance', indoor: true }, {}, [{ id: 'drink-c', qty: 6 }]);
    const strong = b.r.bottles.find(x => x.id === 'drink-c');
    assert.ok(strong && strong.veryConcentrated); assert.equal(strong.gPerL, 180);
  });

  test('engine: a 45-min recovery ride stays at 0 g/h (not widened to "optional 0–30")', async () => {
    const W2 = req('workout.js'), E2 = req('engine.js');
    const t = E2.plan({ parsed: W2.parse(await load('tests/fixtures/Active_Recovery_4_2026-12-02.json')), ctx: { goalTag: 'recovery', rideYear: 2026 }, profile: P, rules: await load('data/rules.json') });
    assert.equal(t.cho.gph, 0); assert.ok(!t.cho.optional); assert.ok(t.cho.rules.includes('CHO-DUR-02'));
  });

  test('match: same input → same plan (fixed tie-breakers)', async () => {
    const st = [{ id: 'gel-a', qty: 10 }, { id: 'gel-x', qty: 10 }, { id: 'bar-b', qty: 4, fav: true }, { id: 'drink-d', qty: 6 }];
    const a = await build('Duur_3u_Cadence_ladder_2_2026-11-25', { goalTag: 'race', refillMin: 60 }, {}, st);
    const b = await build('Duur_3u_Cadence_ladder_2_2026-11-25', { goalTag: 'race', refillMin: 60 }, {}, st);
    assert.equal(JSON.stringify(a.r), JSON.stringify(b.r));
  });
})();
