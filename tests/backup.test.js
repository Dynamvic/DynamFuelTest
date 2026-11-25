'use strict';
(function () {
  const { test, assert, req } = typeof module === 'object' && module.exports ? require('./harness.js') : DFTest;
  const good = () => ({ birthYear: 1990, massKg: 75, ftpW: 360, lt1W: null, gutCapGph: 90, gutTrained: false, sweatRateLph: null, salty: 'yes', caffeine: 'low',
    bedtime: '23:00', bottleMl: 750, cages: 2, allergens: ['gluten'], avoidTraces: true, healthFlags: [], healthAck: false, disclaimerAck: true, sweatTestPrompted: false, src: {} });

  test('backup: make → check gives the same data back (round trip), key only when asked', async () => {
    const B = req('backup.js');
    const data = { settings: { lang: 'en', usualStart: '09:00', onboarded: true }, profile: good(), athlete: { weightKg: 75, ftp: 250, indoorFtp: null, zones: [55, 75, 90, 105, 120, 150, 999], ssMin: 84, ssMax: 97, fetchedAt: null },
      rides: [{ id: 'icu-12', goal: 'race', indoor: false, start: '10:00', tempC: 18 }, { id: 'man-ab1', goal: 'endurance', date: '2026-12-02', durationS: 5400, name: 'Club' }], items: [], plans: [], logs: [] };
    const f = B.make(data, '2026-11-25');
    assert.equal(f.app, 'dynamfuel'); assert.equal(f.schema, B.SCHEMA); assert.ok(!('icu' in f), 'no key unless asked');
    const r = B.check(JSON.parse(JSON.stringify(f)), 2026);
    assert.ok(r.ok); assert.equal(r.fixed, 0); assert.equal(r.at, '2026-11-25');
    assert.deepEqual(r.data.profile, data.profile); assert.deepEqual(r.data.settings, data.settings); assert.deepEqual(r.data.rides, data.rides); assert.deepEqual(r.data.athlete, data.athlete);
    const k = B.check(B.make(Object.assign({}, data, { icu: { key: 'abc', athleteId: '' } }), '2026-11-25'), 2026);
    assert.deepEqual(k.data.icu, { key: 'abc', athleteId: '' });
  });

  test('backup: damaged values are emptied and counted; a damaged file never breaks the app', async () => {
    const B = req('backup.js');
    const p = Object.assign(good(), { massKg: 'heavy', salty: 'maybe', allergens: ['gluten', 'chocolate'], bedtime: '25:00' });
    const r = B.check({ app: 'dynamfuel', schema: 1, at: '2026-13-40', settings: { lang: 'fr' }, profile: p, rides: [{ id: 'icu-1', goal: 'fast' }, { id: 'icu-2', tempC: 20 }, 'x'] }, 2026);
    assert.ok(r.ok); assert.equal(r.at, null, 'not a real date');
    assert.equal(r.data.profile.massKg, null); assert.equal(r.data.profile.salty, 'unknown'); assert.deepEqual(r.data.profile.allergens, []); assert.equal(r.data.profile.bedtime, null);
    assert.equal(r.data.settings.lang, 'nl'); assert.deepEqual(r.data.rides, [{ id: 'icu-2', tempC: 20 }]);
    assert.equal(r.fixed, 4 + 1 + 2, '4 profile values, the language, 2 rides');
  });

  test('backup: other files, newer schemas and DynamCore back-ups are refused', async () => {
    const B = req('backup.js');
    assert.equal(B.check({ app: 'dynamcore', v: 2 }, 2026).why, 'format');
    assert.equal(B.check({ app: 'dynamfuel', schema: B.SCHEMA + 1 }, 2026).why, 'newer');
    assert.equal(B.check(null, 2026).why, 'format');
  });

  test('backup: profile ranges (birth year not in the future, body mass 30–200 kg, gut 0–120 g/h)', async () => {
    const B = req('backup.js');
    const c = o => B.checkProfile(Object.assign(good(), o), 2026);
    assert.equal(c({ birthYear: 2030 }).p.birthYear, null); assert.equal(c({ massKg: 20 }).p.massKg, null); assert.equal(c({ gutCapGph: 130 }).p.gutCapGph, null);
    assert.equal(c({ gutCapGph: 120 }).p.gutCapGph, 120); assert.equal(c({}).fixed, 0);
  });
})();
