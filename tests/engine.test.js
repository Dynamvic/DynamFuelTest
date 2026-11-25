'use strict';
(function () {
  const { test, assert, load, req } = typeof module === 'object' && module.exports ? require('./harness.js') : DFTest;
  const W = req('workout.js'), E = req('engine.js');
  const P70 = { birthYear: 1990, massKg: 70, ftpW: 360, gutCapGph: 90, gutTrained: false, sweatRateLph: null, salty: 'no', caffeine: 'normal', bedtime: '22:30', bottleMl: 750, cages: 2 };
  const run = async (name, ctx = {}, prof = {}) => {
    const rules = await load('data/rules.json');
    const parsed = W.parse(await load(`tests/fixtures/${name}.json`));
    return E.plan({ parsed, ctx: Object.assign({ rideYear: 2026, start: '09:00' }, ctx), profile: Object.assign({}, P70, prof), rules });
  };

  test('engine: 3 h Z2 (Duur 3u) → 90 g/h, glucose+fructose required', async () => {
    const t = await run('Duur_3u_2026-11-28', { goalTag: 'endurance' });
    assert.equal(t.cho.gph, 90); assert.ok(t.cho.mtcRequired); assert.ok(t.cho.rules.includes('CHO-DUR-05'));
    assert.equal(t.cho.totalG, 270);
  });

  test('engine: gut tolerance caps the target and triggers gut-training advice', async () => {
    const t = await run('Duur_3u_2026-11-28', { goalTag: 'endurance' }, { gutCapGph: 60 });
    assert.equal(t.cho.gph, 60); assert.ok(t.cho.gutAdvice); assert.ok(!t.cho.mtcRequired);
  });

  test('engine: > 90 g/h only for a gut-trained athlete, never above 120', async () => {
    assert.equal((await run('Duur_3u_2026-11-28', {}, { gutCapGph: 110 })).cho.gph, 90);
    const t = await run('Duur_3u_2026-11-28', {}, { gutCapGph: 110, gutTrained: true });
    assert.equal(t.cho.gph, 110); assert.ok(t.cho.rules.includes('CHO-CAP-02'));
    assert.equal((await run('Duur_3u_2026-11-28', {}, { gutCapGph: 150, gutTrained: true })).cho.gph, 120);
  });

  test('engine: 60 min Z2 (Duur Speed Skills) → 0 g/h, no mouth rinse', async () => {
    const t = await run('Duur_Speed_Skills_2026-11-30');
    assert.equal(t.cho.gph, 0); assert.ok(!t.cho.rinse); assert.equal(t.goal.value, 'endurance'); assert.equal(t.goal.source, 'suggested');
  });

  test('engine: 67 min VO2 (Pre-load 90s) → no mouth rinse advice (G1), goal suggested "key"', async () => {
    const t = await run('Pre_load_90s_30_15_s_3_6_with_warm_up_2026-11-24');
    assert.ok(!t.cho.rinse); assert.equal(t.goal.value, 'key');
  });

  test('engine: 2 h with shuttles → 1–2 h band: endurance 30, key 60 g/h', async () => {
    assert.equal((await run('Endurance_Shuttle_120m_2026-12-04', { goalTag: 'endurance' })).cho.gph, 30);
    const k = await run('Endurance_Shuttle_120m_2026-12-04', { goalTag: 'key' });
    assert.equal(k.cho.gph, 60); assert.ok(k.cho.rules.includes('CHO-DUR-03'));
  });

  test('engine: easy ride 75 min–2 h is optional 0–30 g/h (Q7, threshold INT-LOW-01 set in review R6)', async () => {
    const rules = await load('data/rules.json');
    const doc = { duration: 6000, ftp: 360, sportSettings: { power_zones: [55, 70, 90, 105, 120, 150, 999] }, steps: [{ duration: 6000, power: { value: 2, units: 'power_zone' } }] };
    const t = E.plan({ parsed: W.parse(doc), ctx: { goalTag: 'endurance', rideYear: 2026 }, profile: P70, rules });
    assert.equal(t.cho.gph, 0); assert.ok(t.cho.optional); assert.equal(t.cho.hi, 30); assert.equal(t.cho.status, 'coach');
    const k = E.plan({ parsed: W.parse(doc), ctx: { goalTag: 'key', rideYear: 2026 }, profile: P70, rules });
    assert.equal(k.cho.gph, 60); assert.ok(!k.cho.optional);
  });

  test('engine: fluid – unknown sweat rate 600 ml/h (0,4–0,8, sourced); known sweat rate keeps loss ≤ 2 % and ≤ sweat rate', async () => {
    const a = await run('Duur_3u_2026-11-28');
    assert.equal(a.fluid.mlph, 600); assert.equal(a.fluid.lo, 400); assert.equal(a.fluid.hi, 800); assert.notEqual(a.fluid.status, 'open');
    const b = await run('Duur_3u_2026-11-28', {}, { sweatRateLph: 1.0 });
    assert.equal(b.fluid.mlph, 550, '1,0 − 0,02 × 70 / 3 = 0,533 l/h → 550 ml');
    assert.ok(b.fluid.mlph <= 1000);
    const c = await run('Duur_Speed_Skills_2026-11-30', {}, { sweatRateLph: 0.8 });
    assert.equal(c.fluid.mlph, 0, '1 h: 2 % of 70 kg = 1,4 l > 0,8 l sweat → nothing required');
  });

  test('engine: a known sweat rate caps fluid also without body mass, and on a hot day (FLU-03, review #1)', async () => {
    const t = await run('Duur_3u_2026-11-28', {}, { sweatRateLph: 0.4, massKg: null });
    assert.equal(t.fluid.mlph, 400); assert.ok(t.fluid.hi <= 400); assert.ok(t.fluid.rules.includes('FLU-03'));
    const h = await run('Duur_3u_2026-11-28', { tempC: 30 }, { sweatRateLph: 0.5, massKg: null });
    assert.equal(h.fluid.mlph, 500, '750 ml/h hot-day value capped at the 0,5 l/h sweat rate');
    assert.equal((await run('Duur_3u_2026-11-28', {}, { massKg: null })).fluid.mlph, 600, 'unknown sweat rate: unchanged');
  });

  test('engine: bedtime after midnight is the next day, so caffeine is not dropped (CAF-06, review #3)', async () => {
    const t = await run('Duur_3u_2026-11-28', { goalTag: 'race', start: '09:00' }, { bedtime: '00:30' });
    assert.equal(t.caffeine.doses.length, 2); assert.equal(t.caffeine.dropped.length, 0);
    const late = await run('Duur_3u_2026-11-28', { goalTag: 'race', start: '17:00' }, { bedtime: '00:30' });
    assert.deepEqual(late.caffeine.dropped.map(d => d.rule), ['CAF-02'], 'late dose 18:59 is after the 18:30 cut-off');
  });

  test('engine: sodium = fluid × 460 mg/l, × 690 for salty sweat, sweat rate > 1,2 l/h or > 2 h (NA-01/02)', async () => {
    assert.equal((await run('Endurance_Shuttle_120m_2026-12-04')).sodium.mgph, 300, '0,6 × 460 = 276 → 300; exactly 2 h is not > 2 h');
    assert.equal((await run('Endurance_Shuttle_120m_2026-12-04', {}, { salty: 'yes' })).sodium.mgph, 400, '0,6 × 690 = 414 → 400');
    assert.equal((await run('Duur_3u_2026-11-28')).sodium.mgPerL, 690, '3 h > 2 h (Sawka 2007: 20–30 mmol/l)');
    assert.ok((await run('Endurance_Shuttle_120m_2026-12-04', {}, { sweatRateLph: 1.5 })).sodium.high, 'sweat rate > 1,2 l/h');
  });

  test('engine: pre-ride fluid 5–10 ml/kg 2–4 h before; carbohydrate meal only for rides > 60 min (PRE-01/02)', async () => {
    const t = await run('Endurance_Shuttle_120m_2026-12-04', { start: '09:00' });
    assert.deepEqual(t.pre.fluidMl, [350, 700]); assert.deepEqual(t.pre.fluidWindow, ['05:00', '07:00']); assert.ok(t.pre.applies);
    assert.ok(!(await run('Duur_Speed_Skills_2026-11-30')).pre.applies, '60 min ride: normal meal');
  });

  test('engine: rehydration 125–150 % of the expected deficit when the sweat rate is known (REC-03)', async () => {
    const t = await run('Duur_3u_2026-11-28', {}, { sweatRateLph: 1.0 });
    assert.deepEqual(t.post.rehydrateMl, [1700, 2050], 'deficit (1,0 − 0,55) × 3 = 1,35 l → 1,69–2,03 l');
    assert.equal((await run('Duur_3u_2026-11-28')).post.rehydrateMl, undefined);
  });

  test('engine: caffeine – off under 18 (and at 18 by birth year), off for "none" and for endurance goal', async () => {
    assert.equal((await run('Duur_3u_2026-11-28', { goalTag: 'race' }, { birthYear: 2010 })).caffeine.off, 'minor');
    assert.equal((await run('Duur_3u_2026-11-28', { goalTag: 'race' }, { birthYear: 2008 })).caffeine.off, 'minor');
    assert.equal((await run('Duur_3u_2026-11-28', { goalTag: 'race' }, { caffeine: 'none' })).caffeine.off, 'nouse');
    assert.equal((await run('Duur_3u_2026-11-28', { goalTag: 'endurance' })).caffeine.off, 'goal');
  });

  test('engine: caffeine doses 3 mg/kg at −60 min, 2 mg/kg at ⅔ of > 2,5 h, bedtime cut-off, always "to confirm"', async () => {
    const t = await run('Duur_3u_2026-11-28', { goalTag: 'race', start: '09:00' });
    assert.deepEqual(t.caffeine.doses.map(d => [d.atMin, d.mg, d.clock]), [[-60, 200, '08:00'], [119, 150, '10:59']]);
    assert.equal(t.caffeine.status, 'coach', 'EFSA limits read (CAF-05 confirmed); CAF-03/06 are coach rules');
    const late = await run('Duur_3u_2026-11-28', { goalTag: 'race', start: '15:30' }, { bedtime: '22:00' });
    assert.equal(late.caffeine.doses.length, 1); assert.equal(late.caffeine.dropped[0].rule, 'CAF-02');
  });

  test('engine: pre-ride 1–4 g/kg 1–4 h before, post-ride by next session', async () => {
    const t = await run('Endurance_Shuttle_120m_2026-12-04', { start: '09:00' });
    assert.equal(t.pre.kind, 'normal', 'key session: normal breakfast (D3)'); assert.deepEqual(t.pre.g, [70, 70]); assert.deepEqual(t.pre.window, ['05:00', '08:00']);
    const race = await run('Endurance_Shuttle_120m_2026-12-04', { goalTag: 'race', start: '09:00' });
    assert.equal(race.pre.kind, 'fuel'); assert.deepEqual(race.pre.g, [70, 280], 'race: 1–4 g/kg');
    assert.equal(t.post.kind, 'normal'); assert.deepEqual(t.post.proteinG, [20, 30]);
    const r = await run('Endurance_Shuttle_120m_2026-12-04', { next8h: true });
    assert.equal(r.post.kind, 'rapid'); assert.deepEqual(r.post.choGph, [70, 85]); assert.equal(r.post.proteinG, 20);
  });

  test('engine: energy expenditure ≈ kJ (information)', async () => {
    const t = await run('Duur_3u_2026-11-28');
    assert.equal(t.energy.kJ, 2430); assert.deepEqual(t.energy.kcal, [2320, 2900]);
  });

  test('engine: no intake slot inside a hard effort, first slot ≤ 20 min, slots ~every 20 min (all rides)', async () => {
    const names = (await load('tests/fixtures/index.json')).filter(n => !n.startsWith('DynamCore'));
    for (const n of names) {
      const t = await run(n, { goalTag: 'key' });
      const parsed = W.parse(await load(`tests/fixtures/${n}.json`));
      const blocks = W.hardBlocks(parsed, t.intensity.hardPct, 120).filter(b => b.t1 - b.t0 <= 20 * 60);   // interval sets (TIME-03); > 20 min = sustained (TIME-06)
      for (const s of t.slots) assert.ok(!blocks.some(b => s.min * 60 >= b.t0 && s.min * 60 < b.t1), `${n}: slot ${s.min} inside hard block`);
      if (t.slots.length) assert.ok(t.slots[0].min <= 20, `${n}: first slot`);
      for (let i = 1; i < t.slots.length; i++) assert.ok(t.slots[i].min - t.slots[i - 1].min <= 30, `${n}: gap ≤ 30 min`);
    }
  });

  test('engine: a sustained hard effort > 20 min gets intake inside it, gels/drink only (TIME-06, case 09)', async () => {
    const t = await run('Koers_150m', { goalTag: 'race' });
    assert.deepEqual(t.slots.map(s => s.min), [15, 35, 55, 75, 95, 115, 135]);
    assert.ok(t.slots.every(s => s.sustained && !s.easy), 'never easy → no solids');
  });

  test('engine: Hard Start – the 3 reps (10–15 min) form one set; the 15-min slot moves to just before it (TIME-03)', async () => {
    const t = await run('Hard_Start_Treshold_2x2_1_3__2026-11-27', { goalTag: 'key' });
    assert.equal(t.slots[0].min, 9); assert.ok(t.slots[0].moved);
  });

  test('engine: same input → same output; every number on its rounding step', async () => {
    const a = await run('Duur_3u_Cadence_ladder_2_2026-11-25', { goalTag: 'race' }, { sweatRateLph: 0.9, salty: 'yes' });
    const b = await run('Duur_3u_Cadence_ladder_2_2026-11-25', { goalTag: 'race' }, { sweatRateLph: 0.9, salty: 'yes' });
    assert.equal(JSON.stringify(a), JSON.stringify(b));
    assert.equal(a.cho.gph % 5, 0); assert.equal(a.fluid.mlph % 50, 0); assert.equal(a.sodium.mgph % 50, 0);
    a.caffeine.doses.forEach(d => assert.equal(d.mg % 25, 0));
  });

  test('engine: rides ≤ 60 min have no sodium target (NA-03, review R1)', async () => {
    const t = await run('Duur_Speed_Skills_2026-11-30');
    assert.equal(t.sodium.mgph, 0); assert.ok(t.sodium.none); assert.deepEqual(t.sodium.rules, ['NA-03']);
    assert.equal((await run('Pre_load_90s_30_15_s_3_6_with_warm_up_2026-11-24')).sodium.mgph, 300, '67 min → NA-01 applies');
  });

  test('engine: caffeine planned only for races; key sessions of any length optional (CAF-03, review D2)', async () => {
    const s = await run('Pre_load_90s_30_15_s_3_6_with_warm_up_2026-11-24', { goalTag: 'key' });
    assert.ok(!s.caffeine.on); assert.ok(s.caffeine.optional); assert.equal(s.caffeine.doses[0].mg, 200); assert.equal(s.caffeine.doses[0].atMin, -60);
    const l = await run('Endurance_Shuttle_120m_2026-12-04', { goalTag: 'key' });
    assert.ok(!l.caffeine.on); assert.ok(l.caffeine.optional, '2 h key session: optional');
    assert.ok((await run('Endurance_Shuttle_120m_2026-12-04', { goalTag: 'race' })).caffeine.on, 'race: planned');
  });

  test('engine: hot day ≥ 25 °C → 750 ml/h (HEAT-02); cool-drink advice; sweat test asked only once (E1)', async () => {
    const t = await run('Duur_3u_2026-11-28', { tempC: 28 });
    assert.equal(t.fluid.mlph, 750); assert.ok(t.fluid.rules.includes('HEAT-02'));
    assert.ok(t.warnings.includes('heat_cool_drinks') && t.warnings.includes('ask_sweat_test_once'));
    assert.ok(!(await run('Duur_3u_2026-11-28', { tempC: 28 }, { sweatTestPrompted: true })).warnings.includes('ask_sweat_test_once'), 'not asked again');
    assert.equal((await run('Duur_3u_2026-11-28', { tempC: 20 })).fluid.mlph, 600, 'below 25 °C: 600 ml/h');
  });

  test('engine: a trainlow tag is not used (Q10) and is reported', async () => {
    const t = await run('Duur_3u_2026-11-28', { goalTag: 'trainlow' });
    assert.ok(t.warnings.includes('trainlow_unsupported')); assert.equal(t.goal.source, 'suggested');
  });
})();
