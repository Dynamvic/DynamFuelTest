'use strict';
(function () {
  const { test, assert, load, req } = typeof module === 'object' && module.exports ? require('./harness.js') : DFTest;
  const W = req('workout.js');
  const fx = name => load(`tests/fixtures/${name}.json`);

  test('parser: every sample file – rides parse completely, DynamCore sessions are skipped', async () => {
    const names = await load('tests/fixtures/index.json');
    assert.equal(names.length, 20, '18 sample files + the case 08 and 09 workouts');
    let rides = 0, skipped = 0;
    for (const n of names) {
      const doc = await fx(n), p = W.parse(doc);
      if (n.startsWith('DynamCore')) { assert.equal(p.skip, 'nosteps', n); skipped++; continue; }
      rides++;
      assert.ok(p.ok, `${n} parsed`);
      assert.equal(p.durationS, doc.duration, `${n}: total time = duration`);
      assert.deepEqual(p.issues, [], `${n}: no issues`);
      assert.deepEqual(W.checkPower(p), [], `${n}: % FTP matches Intervals.icu watts (±1 W)`);
      assert.ok(p.steps.every(s => s.a != null), `${n}: every step has an intensity`);
    }
    assert.equal(rides, 12); assert.equal(skipped, 8);
  });

  test('parser: nested repeats are expanded (Endurance Shuttle 120m)', async () => {
    const p = W.parse(await fx('Endurance_Shuttle_120m_2026-12-04'));
    assert.equal(p.steps.length, 3 + 10 + 1 + 10 + 2);
    const at100 = p.steps.filter(s => s.a === 100);
    assert.equal(at100.length, 10);
    assert.equal(at100[5].t0, 900 + 600 + 4500, 'second shuttle block starts after 1:40');
    assert.equal(at100[0].cadence, 105); assert.equal(at100[5].cadence, 65);
  });

  test('parser: ramps up and down (Pre-load 90s warm-up and cool-down)', async () => {
    const p = W.parse(await fx('Pre_load_90s_30_15_s_3_6_with_warm_up_2026-11-24'));
    const first = p.steps[0], last = p.steps[p.steps.length - 1];
    assert.equal(first.kind, 'ramp'); assert.equal(first.a, 24.9); assert.equal(first.b, 72.5); assert.ok(first.warmup);
    assert.equal(last.kind, 'ramp'); assert.equal(last.a, 55.3); assert.equal(last.b, 24.9); assert.ok(last.cooldown);
  });

  test('parser: power_zone uses the athlete zones; zone 9 = sweet spot (Active Recovery 4)', async () => {
    const p = W.parse(await fx('Active_Recovery_4_2026-12-02'));
    const ss = p.steps.filter(s => s.kind === 'sweetspot');
    assert.equal(ss.length, 8);
    assert.equal(ss[0].lo, 84); assert.equal(ss[0].hi, 97);
    const z2 = W.parse(await fx('Duur_3u_2026-11-28')).steps[0];
    assert.equal(z2.kind, 'zone'); assert.equal(z2.lo, 55); assert.equal(z2.hi, 70); assert.equal(z2.a, 62.5);
  });

  test('metrics: constant Z2 for 3 h (Duur 3u) – hand-checked IF and kJ', async () => {
    const p = W.parse(await fx('Duur_3u_2026-11-28'));
    const m = W.metrics(p, { hardPct: 90 });
    assert.equal(+m.npPct.toFixed(3), 62.5);
    assert.equal(+m.ifactor.toFixed(3), 0.625);
    assert.equal(Math.round(m.kJ), 2430, '0,625 × 360 W × 10 800 s = 2430 kJ');
    assert.equal(m.hardS, 0);
    assert.equal(m.tiz[1], 10800, 'all time in Z2');
  });

  test('metrics: time in zone and hard time (Duur 3u Cadence ladder)', async () => {
    const p = W.parse(await fx('Duur_3u_Cadence_ladder_2_2026-11-25'));
    const m = W.metrics(p, { hardPct: 90 });
    assert.equal(m.tiz[1], 10440); assert.equal(m.tiz[3], 360);
    assert.equal(m.hardS, 360, '3 × 2 min at 100 %');
    assert.equal(W.hardBlocks(p, 90).length, 3);
  });

  test('metrics: hard time counts short bursts (microbursts) and threshold blocks (Hard Start)', async () => {
    const mb = W.parse(await fx('2_Indoor_microbursts_2_2026-12-03'));
    assert.equal(W.metrics(mb, { hardPct: 90 }).hardS, 3 * 16 * 5);
    const hs = W.parse(await fx('Hard_Start_Treshold_2x2_1_3__2026-11-27'));
    assert.equal(W.metrics(hs, { hardPct: 90 }).hardS, 3 * 80 + 4 * 240);
    assert.equal(W.hardBlocks(hs, 90).length, 3 + 4, 'each 20 s + 60 s pair merges into one block');
  });

  test('metrics: IF of an interval session is above its average', async () => {
    const m = W.metrics(W.parse(await fx('Pre_load_90s_30_15_s_3_6_with_warm_up_2026-11-24')), { hardPct: 90 });
    assert.ok(m.npPct > m.avgPct);
    assert.ok(m.ifactor > 0.6 && m.ifactor < 1.0);
  });

  test('parser: zone outside the zone list and no zones are reported, not guessed', () => {
    const doc = { duration: 60, sportSettings: { power_zones: [55, 70, 90, 105, 120, 150, 999] }, steps: [{ duration: 60, power: { value: 12, units: 'power_zone' } }] };
    const p = W.parse(doc);
    assert.equal(p.issues[0].code, 'notarget');
    assert.equal(p.steps[0].a, null);
  });

  test('parser: repeat block with wrong total is flagged', () => {
    const doc = { duration: 100, sportSettings: { power_zones: [55, 70, 90, 105, 120, 150, 999] }, steps: [{ reps: 2, duration: 100, steps: [{ duration: 30, power: { value: 50, units: '%ftp' } }] }] };
    const p = W.parse(doc);
    assert.ok(p.issues.some(i => i.code === 'repdur'));
    assert.ok(p.issues.some(i => i.code === 'totaldur'));
  });

  test('parser: absolute watts are converted with FTP', () => {
    const p = W.parse({ duration: 60, ftp: 300, sportSettings: { power_zones: [55, 70, 90, 105, 120, 150, 999] }, steps: [{ duration: 60, power: { value: 150, units: 'w' } }] });
    assert.equal(p.steps[0].a, 50);
  });
})();
