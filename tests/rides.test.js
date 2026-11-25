'use strict';
(function () {
  const { test, assert, load, req } = typeof module === 'object' && module.exports ? require('./harness.js') : DFTest;
  /* Events → rides. The events below copy the field names of a real Intervals.icu events export (24-11-2026);
     the workout steps come from the scrubbed fixtures, so no athlete data is in these tests. */
  const ev = (o) => Object.assign({ id: 1, start_date_local: '2026-12-01T09:00:00', type: 'Ride', category: 'WORKOUT', name: 'Duur', description: 'sample',
    moving_time: 18000, icu_training_load: 200, tags: null, indoor: null, carbs_per_hour: null, icu_ftp: null, workout_doc: null }, o);

  test('rides: only Ride, VirtualRide, GravelRide and MountainBikeRide workouts are rides; DynamCore WeightTraining is skipped', async () => {
    const R = req('rides.js');
    assert.ok(R.isRide(ev({}))); assert.ok(R.isRide(ev({ type: 'VirtualRide' }))); assert.ok(R.isRide(ev({ type: 'GravelRide' }))); assert.ok(R.isRide(ev({ type: 'MountainBikeRide' })));
    assert.ok(!R.isRide(ev({ type: 'WeightTraining', external_id: 'dynamcore-x' }))); assert.ok(!R.isRide(ev({ category: 'NOTE' })));
  });

  test('rides: event → ride (date, time, tags, indoor, structured steps); 00:00 = no time', async () => {
    const R = req('rides.js'), fx = await load('tests/fixtures/5h_endurance.json');
    const r = R.eventToRide(ev({ tags: ['Race'], workout_doc: { steps: fx.steps, duration: fx.duration } }));
    assert.equal(r.id, 'icu-1'); assert.equal(r.date, '2026-12-01'); assert.equal(r.time, '09:00'); assert.equal(r.goalTag, 'race');
    assert.ok(r.structured); assert.equal(r.durationS, 18000); assert.equal(r.indoor, null);
    assert.equal(R.eventToRide(ev({ type: 'VirtualRide' })).indoor, true, 'VirtualRide = indoor');
    assert.equal(R.eventToRide(ev({ indoor: false })).indoor, false);
    const u = R.eventToRide(ev({ start_date_local: '2026-12-01T00:00:00' }));
    assert.equal(u.time, null); assert.ok(!u.structured); assert.equal(u.durationS, 18000, 'no steps: moving_time');
  });

  test('rides: athlete record → FTP, zones and body mass from the Ride sport settings only', async () => {
    const R = req('rides.js');
    const a = { icu_weight: 72.5, name: 'x', sportSettings: [{ types: ['Run'], ftp: 300, power_zones: [1, 2, 3] }, { types: ['Ride', 'VirtualRide'], ftp: 250, indoor_ftp: 240, power_zones: [55, 75, 90, 105, 120, 150, 999], sweet_spot_min: 84, sweet_spot_max: 97 }] };
    const s = R.athleteSummary(a, '2026-11-25T08:00:00Z');
    assert.deepEqual(s, { weightKg: 72.5, ftp: 250, indoorFtp: 240, zones: [55, 75, 90, 105, 120, 150, 999], ssMin: 84, ssMax: 97, fetchedAt: '2026-11-25T08:00:00Z' });
    assert.ok(!('name' in s), 'nothing else is kept');
  });

  test('rides: the workout doc gets the athlete zones; it parses like the export it came from', async () => {
    const R = req('rides.js'), W = req('workout.js'), fx = await load('tests/fixtures/Duur_3u_Cadence_ladder_2_2026-11-25.json');
    const r = R.eventToRide(ev({ workout_doc: { steps: fx.steps, duration: fx.duration } }));
    const ath = { zones: fx.sportSettings.power_zones, ftp: fx.ftp, ssMin: fx.sportSettings.sweet_spot_min, ssMax: fx.sportSettings.sweet_spot_max };
    const p = W.parse(R.workoutDoc(r, ath, {}, 'endurance')), q = W.parse(fx);
    assert.ok(p.ok); assert.equal(p.durationS, q.durationS);
    assert.deepEqual(W.metrics(p, { hardPct: 90 }).tiz, W.metrics(q, { hardPct: 90 }).tiz);
  });

  test('rides: a ride without steps gets one step in the zone of its session type (recovery Z1, endurance Z2, key/race Z4)', async () => {
    const R = req('rides.js'), W = req('workout.js');
    const r = R.eventToRide(ev({ moving_time: 7200 }));
    [['recovery', 1], ['endurance', 2], ['key', 4], ['race', 4]].forEach(([g, z]) => {
      const d = R.workoutDoc(r, null, { ftpW: 300 }, g);
      assert.ok(d.manual); assert.equal(d.manualZone, z); assert.ok(W.parse(d).ok, g);
    });
  });

  test('rides: rides without blocks follow MAN-01 (endurance, coach), MAN-02 (recovery, proposed), MAN-03 (key/race, OPEN)', async () => {
    const R = req('rides.js'), rules = (await load('data/rules.json')).rules;
    const r = R.eventToRide(ev({ moving_time: 5400 }));
    [['endurance', 'MAN-01', 'coach'], ['recovery', 'MAN-02', 'proposed'], ['key', 'MAN-03', 'open'], ['race', 'MAN-03', 'open']].forEach(([g, id, st]) => {
      const d = R.workoutDoc(r, null, {}, g, rules);
      assert.equal(d.manualRule, id, g); assert.equal(rules[id].status, st, id); assert.equal(d.manualZone, rules[id].zones[g]);
      assert.equal(R.MANUAL_ZONE[g], rules[id].zones[g], `fallback table = ${id}`);
    });
  });

  test('rides: "next session within 8 h" from the calendar (REC-01); sessions without a time are ignored', async () => {
    const R = req('rides.js');
    const ride = R.eventToRide(ev({ id: 1, start_date_local: '2026-12-01T09:00:00', moving_time: 7200 }));
    const core = (id, at) => ({ id, start_date_local: at, type: 'WeightTraining', moving_time: 3600 });
    assert.equal(R.nextWithin(ride, '09:00', [core(2, '2026-12-01T18:00:00')]), true, 'ends 11:00, next 18:00 = 7 h');
    assert.equal(R.nextWithin(ride, '09:00', [core(2, '2026-12-01T19:30:00')]), false, '8,5 h later');
    assert.equal(R.nextWithin(ride, '09:00', [core(2, '2026-12-01T00:00:00')]), false, 'no time');
    assert.equal(R.nextWithin(ride, '09:00', [core(2, '2026-11-30T18:00:00')]), false, 'the day before');
  });
})();
