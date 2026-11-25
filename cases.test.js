'use strict';
(function () {
  const { test, pending, assert, load, req } = typeof module === 'object' && module.exports ? require('./harness.js') : DFTest;
  /* Golden tests for the coach's reference cases. Cases that are not READY stay pending – their expected values are never invented.
     A READY case is compared value by value with the coach's (decided) answer in app/tests/cases.json. */
  const IDS = ['01-recovery-45min-indoor', '02-vo2-30-15-70min', '03-indoor-microbursts-60min', '04-threshold-60min', '05-endurance-2h-shuttles',
    '06-endurance-3h-z2-cool', '07-endurance-3h-z2-hot-salty', '08-long-ride-4-5h', '09-race-2h30', '10-train-low-optional'];

  test('cases.json lists the 10 reference cases', async () => {
    const c = await load('tests/cases.json');
    assert.deepEqual(c.cases.map(x => x.id), IDS);
  });

  test('reference case 06 – 3 h Z2, cool, salty sweater: engine = coach (decided 24-11-2026)', async () => {
    const W = req('workout.js'), E = req('engine.js'), M = req('match.js');
    const c = (await load('tests/cases.json')).cases.find(x => x.id.startsWith('06')), x = c.expected;
    const rules = await load('data/rules.json'), L = await load('data/library.json');
    const T = E.plan({ parsed: W.parse(await load(`tests/fixtures/${c.fixture}.json`)), ctx: c.ctx, profile: c.profile, rules });
    assert.equal(T.cho.gph, x.choGph, 'carbohydrate g/h');
    assert.equal(T.fluid.mlph, x.fluidMlph, 'fluid ml/h');
    assert.equal(T.sodium.mgph, x.sodiumMgph, 'sodium mg/h');
    assert.ok(!T.caffeine.on, 'no caffeine');
    assert.equal(T.pre.kind, x.preKind); assert.deepEqual(T.pre.g, x.preG, 'normal breakfast ~1 g/kg');
    assert.deepEqual(T.post.rehydratePerKgLost, x.postRehydratePerKgLost); assert.deepEqual(T.post.proteinG, x.postProteinG);
    assert.equal(T.slots[0].min, x.firstSlotMin); assert.equal(T.slots[1].min - T.slots[0].min, x.everyMin);
    const r = M.match({ targets: T, items: L.items, stock: c.stock, profile: c.profile, ctx: c.ctx, rules });
    assert.deepEqual(r.alternatives.map(a => a.kind), x.choice, 'athlete can choose a plan with drink or without');
    r.bottles.filter(b => b.content === 'drink').forEach(b => assert.equal(b.doses, 1.5, 'drink at label strength (1,5 doses in 750 ml)'));
  });

  test('reference case 05 – 2 h shuttles: engine = coach (decided 24-11-2026)', async () => {
    const W = req('workout.js'), E = req('engine.js'), M = req('match.js');
    const c = (await load('tests/cases.json')).cases.find(x => x.id.startsWith('05')), a = c.agreed;
    const rules = await load('data/rules.json'), L = await load('data/library.json');
    const T = E.plan({ parsed: W.parse(await load(`tests/fixtures/${c.fixture}.json`)), ctx: c.ctx, profile: c.profile, rules });
    assert.equal(T.goal.value, a.goal); assert.equal(T.cho.gph, a.choGph); assert.equal(T.fluid.mlph, a.fluidMlph);
    assert.deepEqual(T.post.proteinG, a.postProteinG); assert.ok(T.post.rehydratePerKgLost);
    const r = M.match({ targets: T, items: L.items, stock: c.stock, profile: c.profile, ctx: c.ctx, rules });
    const gels = r.alternatives.find(x => x.kind === 'withoutDrink');
    assert.equal(gels.solids[0].n, a.gels, 'about 3 gels');
    assert.equal(T.sodium.mgph, a.sodiumMgph, 'sodium (D1)');
    assert.ok(!T.caffeine.on && T.caffeine.optional, 'caffeine optional for a key session (D2)');
    assert.equal(T.pre.kind, a.preKind); assert.deepEqual(T.pre.g, a.preG, 'normal breakfast ~1 g/kg (D3)');
    assert.deepEqual(r.schedule.filter(s => s.eat.length).map(s => s.min), a.gelTimes, 'gel times (D4)');
  });

  test('reference case 07 – 3 h hot, salty: engine = coach (decided 24-11-2026)', async () => {
    const W = req('workout.js'), E = req('engine.js'), M = req('match.js');
    const c = (await load('tests/cases.json')).cases.find(x => x.id.startsWith('07')), a = c.agreed;
    const rules = await load('data/rules.json'), L = await load('data/library.json');
    const T = E.plan({ parsed: W.parse(await load(`tests/fixtures/${c.fixture}.json`)), ctx: c.ctx, profile: c.profile, rules });
    assert.equal(T.cho.gph, a.choGph); assert.equal(T.sodium.mgph, a.sodiumMgph); assert.equal(T.caffeine.off, a.caffeineOff);
    assert.equal(T.pre.kind, a.preKind); assert.deepEqual(T.post.proteinG, a.postProteinG);
    const r = M.match({ targets: T, items: L.items, stock: c.stock, profile: c.profile, ctx: c.ctx, rules });
    assert.equal(T.fluid.mlph, a.fluidMlph, 'hot day 750 ml/h (E1)');
    const every = T.slots[1].min - T.slots[0].min;
    assert.ok(every >= a.everyMinRange[0] && every <= a.everyMinRange[1], 'every 15–20 min (E2)');
    const chosen = r.alternatives.find(x => x.chosen);
    assert.equal(chosen && chosen.kind, a.mix, 'gels + drink shown first (E3)');
    assert.ok(!r.gaps.some(g => g.what === 'fluid'), 'refill stop covers the extra bottles');
  });

  test('reference case 01 – 44 min indoor recovery: engine = coach (decided 24-11-2026)', async () => {
    const W = req('workout.js'), E = req('engine.js'), M = req('match.js');
    const c = (await load('tests/cases.json')).cases.find(x => x.id.startsWith('01')), a = c.agreed;
    const rules = await load('data/rules.json'), L = await load('data/library.json');
    const T = E.plan({ parsed: W.parse(await load(`tests/fixtures/${c.fixture}.json`)), ctx: c.ctx, profile: c.profile, rules });
    assert.equal(T.cho.gph, a.choGph); assert.equal(T.sodium.mgph, a.sodiumMgph); assert.ok(!T.caffeine.on); assert.equal(T.pre.applies, a.preApplies);
    assert.equal(T.fluid.totalMl, a.fluidTotalMl, 'calculated fluid (F2)');
    assert.equal(T.post.kind, a.postKind, 'water only after a short recovery ride (F1)'); assert.equal(T.post.proteinG, undefined);
    const r = M.match({ targets: T, items: L.items, stock: c.stock, profile: c.profile, ctx: c.ctx, rules });
    assert.equal(r.solids.length, 0); assert.equal(r.bottles.length, a.waterBottles); assert.equal(r.bottles[0].content, 'water');
  });

  ['02', '03', '04'].forEach(n => {
    test(`reference case ${n} – short hard session: engine = coach (decided 24-11-2026)`, async () => {
      const W = req('workout.js'), E = req('engine.js');
      const c = (await load('tests/cases.json')).cases.find(x => x.id.startsWith(n)), a = c.agreed;
      const rules = await load('data/rules.json');
      const P = W.parse(await load(`tests/fixtures/${c.fixture}.json`));
      const T = E.plan({ parsed: P, ctx: c.ctx, profile: c.profile, rules });
      assert.equal(T.goal.value, a.goal); assert.equal(T.caffeine.optional, a.caffeineOptional); assert.equal(T.cho.rinse, a.rinse);
      assert.deepEqual(T.slots.map(s => s.min), a.slots);
      const sets = W.hardBlocks(P, T.intensity.hardPct, rules.rules['TIME-03'].mergeGapS);
      T.slots.forEach(s => assert.ok(!sets.some(b => s.min * 60 >= b.t0 && s.min * 60 < b.t1), `slot ${s.min} not inside an interval set`));
      assert.equal(T.cho.gph, a.choGph); assert.equal(T.cho.lo, a.choLo); assert.equal(T.cho.hi, a.choHi); assert.equal(T.cho.optional, a.choOptional, 'optional 30–60 g/h (H1)');
      assert.equal(T.fluid.totalMl, a.fluidTotalMl, 'calculated fluid (H2)');
    });
  });

  test('MATCH-04: the athlete picks a plan (case 06 stock) – the pack list follows that choice', async () => {
    const W = req('workout.js'), E = req('engine.js'), M = req('match.js');
    const c = (await load('tests/cases.json')).cases.find(x => x.id.startsWith('06'));
    const rules = await load('data/rules.json'), L = await load('data/library.json');
    const T = E.plan({ parsed: W.parse(await load(`tests/fixtures/${c.fixture}.json`)), ctx: c.ctx, profile: c.profile, rules });
    ['drinkOnly', 'drinkAndFood', 'withoutDrink'].forEach(kind => {
      const r = M.match({ targets: T, items: L.items, stock: c.stock, profile: c.profile, ctx: Object.assign({}, c.ctx, { planKind: kind }), rules });
      const ch = r.alternatives.find(a => a.chosen); assert.equal(ch && ch.kind, kind, kind);
      assert.equal(r.bottles.some(b => b.content === 'drink'), kind !== 'withoutDrink', `${kind}: drink bottles`);
      assert.equal(r.solids.length > 0, kind !== 'drinkOnly', `${kind}: gels`);
    });
  });

  ['08', '09'].forEach(n => {
    test(`reference case ${n} – ${n === '08' ? '5 h endurance' : 'race 2 h 30'}: engine = coach (decided 24-11-2026)`, async () => {
      const W = req('workout.js'), E = req('engine.js'), M = req('match.js');
      const c = (await load('tests/cases.json')).cases.find(x => x.id.startsWith(n)), a = c.agreed;
      const rules = await load('data/rules.json'), L = await load('data/library.json');
      const T = E.plan({ parsed: W.parse(await load(`tests/fixtures/${c.fixture}.json`)), ctx: c.ctx, profile: c.profile, rules });
      assert.equal(T.goal.value, a.goal); assert.equal(T.cho.gph, a.choGph, 'carbohydrate g/h (I2 for the race)');
      assert.equal(T.fluid.mlph, a.fluidMlph); assert.equal(T.sodium.mgph, a.sodiumMgph); assert.equal(T.pre.kind, a.preKind);
      if (a.preG) assert.deepEqual(T.pre.g, a.preG);
      if (a.caffeineMg) { assert.ok(T.caffeine.on); assert.equal(T.caffeine.doses[0].mg, a.caffeineMg); assert.equal(T.caffeine.doses[0].clock, a.caffeineClock); }
      else assert.ok(!T.caffeine.on, 'no caffeine on an endurance ride (D2)');
      if (a.slots) { assert.deepEqual(T.slots.map(s => s.min), a.slots, 'sustained effort: intake every 20 min (I3)'); assert.ok(T.slots.every(s => !s.easy)); }
      else { assert.equal(T.slots[0].min, a.firstSlotMin); assert.equal(T.slots[1].min - T.slots[0].min, a.everyMin); }
      const r = M.match({ targets: T, items: L.items, stock: c.stock, profile: c.profile, ctx: c.ctx, rules });
      assert.equal(r.bottles.filter(b => b.content === 'drink').length, a.drinkBottles, 'very concentrated bottles ≤ half (MATCH-05)');
      assert.equal(r.bottles.filter(b => b.content === 'water').length, a.waterBottles);
      assert.equal(r.solids.find(s => s.id === 'ndz-nrgy-gel-45').n, a.gels);
      assert.ok(r.within && !r.gaps.length);
      if (a.refillBottles) assert.equal(r.pack.find(p => p.refill).bottles, a.refillBottles);
    });
  });

  for (const id of IDS) if (!['01', '02', '03', '04', '05', '06', '07', '08', '09'].includes(id.slice(0, 2))) pending(`reference case ${id}`, id.startsWith('10') ? 'dropped for now (Q10)' : 'expected.md not READY (TO FILL by the coach)');
})();
