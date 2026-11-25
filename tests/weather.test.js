'use strict';
(function () {
  const { test, assert, req } = typeof module === 'object' && module.exports ? require('./harness.js') : DFTest;
  /* hourly answer shaped like a real Open-Meteo forecast (checked 25-11-2026): local times, temperature_2m in °C */
  const hourly = (from, temps) => ({ time: temps.map((_, i) => { const d = new Date(Date.parse(from + 'T00:00:00Z') + i * 3600e3); return d.toISOString().slice(0, 13) + ':00'; }), temperature_2m: temps });
  const day = Array.from({ length: 48 }, (_, h) => h % 24 < 14 ? 10 + (h % 24) * 0.5 : 17 - (h % 24 - 14));   // rises to 17 °C at 14:00, then falls

  test('weather: highest forecast temperature during the ride hours (P3-4)', async () => {
    const W = req('weather.js'), H = hourly('2026-11-28', day);
    assert.equal(W.maxDuring(H, '2026-11-28', '10:00', 2.5 * 3600), 16, '10:00–12:30 → hours 10, 11, 12 → 16 °C at 12:00');
    assert.equal(W.maxDuring(H, '2026-11-28', '08:00', 8 * 3600), 17, '08:00–16:00 includes 14:00 = 17 °C');
    assert.equal(W.maxDuring(H, '2026-11-28', '09:45', 600), 14.5, '09:45–09:55: only the 09:00 hour');
    assert.equal(W.maxDuring(H, '2026-11-28', '23:00', 3 * 3600), 11, '23:00–02:00 uses the next day (02:00 = 11 °C)');
    assert.equal(W.maxDuring(H, '2026-11-28', null, 3600), null, 'no start time → no forecast');
    assert.equal(W.maxDuring(null, '2026-11-28', '10:00', 3600), null);
  });

  test('weather: only town name and rounded coordinates are kept from the geocoding answer; 16-day window', async () => {
    const W = req('weather.js');
    const p = W.places({ results: [{ id: 1, name: 'Gent', latitude: 51.05, longitude: 3.71667, admin1: 'Vlaams Gewest', country: 'België', population: 1, postcodes: ['9000'] }] });
    assert.deepEqual(p, [{ name: 'Gent', region: 'Vlaams Gewest, België', lat: 51.05, lon: 3.72 }]);
    assert.deepEqual(W.places({}), []);
    assert.ok(W.inRange(0) && W.inRange(15) && !W.inRange(16) && !W.inRange(-1));
    assert.ok(/latitude=51\.05&longitude=3\.72&hourly=temperature_2m&timezone=auto&start_date=2026-11-28&end_date=2026-11-29$/.test(W.forecastUrl(51.05, 3.7167, '2026-11-28', '2026-11-29')));
  });
})();
