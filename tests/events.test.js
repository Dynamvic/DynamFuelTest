'use strict';
(function () {
  const { test, assert, load, req } = typeof module === 'object' && module.exports ? require('./harness.js') : DFTest;
  /* T5: a real events answer from the Intervals.icu events API (25-11-2026, resolve=true), scrubbed: only the fields DynamFuel uses,
     description "sample", no athlete id; athlete-sample.json = Ride sport settings + a sample body mass. */

  test('events (real API sample): rides become rides, DynamCore sessions are skipped, every ride parses with the athlete zones', async () => {
    const R = req('rides.js'), W = req('workout.js'), evs = await load('tests/fixtures/events-sample.json'), ath = R.athleteSummary(await load('tests/fixtures/athlete-sample.json'));
    const rides = evs.filter(R.isRide), other = evs.filter(e => !R.isRide(e));
    assert.equal(rides.length, 6); assert.equal(other.length, 9); assert.ok(other.every(e => e.type === 'WeightTraining'));
    assert.deepEqual(ath.zones, [55, 75, 90, 105, 120, 150, 999]);
    rides.forEach(e => {
      const r = R.eventToRide(e), p = W.parse(R.workoutDoc(r, ath, {}, 'endurance'));
      assert.ok(r.structured, `${e.name}: has blocks`); assert.ok(p.ok, `${e.name}: parsed`);
      assert.equal(p.durationS, e.workout_doc.duration, `${e.name}: total time`);
      assert.deepEqual(p.issues, [], `${e.name}: no issues`);
    });
  });

  test('events (real API sample): the % FTP DynamFuel calculates matches the watts Intervals.icu resolved (±1 W)', async () => {
    const R = req('rides.js'), W = req('workout.js'), evs = await load('tests/fixtures/events-sample.json'), ath = R.athleteSummary(await load('tests/fixtures/athlete-sample.json'));
    evs.filter(R.isRide).forEach(e => {
      const p = W.parse(R.workoutDoc(R.eventToRide(e), ath, { ftpW: ath.ftp }, 'endurance'));
      assert.deepEqual(W.checkPower(p), [], `${e.name}: % FTP = Intervals.icu watts`);
    });
  });

  test('events: indoor only when Intervals.icu says true or the type is VirtualRide; "false" (its default) = ask the athlete', async () => {
    const R = req('rides.js'), evs = await load('tests/fixtures/events-sample.json');
    const by = n => R.eventToRide(evs.find(e => e.name === n));
    assert.equal(by('Double Tempo Piramid').indoor, true);
    assert.equal(by('2. Indoor microbursts - 1').indoor, null, 'indoor false in Intervals.icu, but the name says indoor: ask');
    assert.equal(R.eventToRide({ id: 1, type: 'VirtualRide', start_date_local: '2026-12-01T00:00:00', indoor: false }).indoor, true);
    assert.equal(by('Koers 150m').time, null, '00:00 = no start time');
  });
})();
