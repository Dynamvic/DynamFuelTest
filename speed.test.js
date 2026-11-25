'use strict';
(function () {
  const { test, assert, load, req } = typeof module === 'object' && module.exports ? require('./harness.js') : DFTest;
  /* polish B5: the fast pack-list search must give exactly the same plans as the full search */
  const sum = r => JSON.stringify({ alt: r.alternatives, solids: r.solids, bottles: r.bottles.map(b => [b.content, b.id || null]), gaps: r.gaps, caf: r.caffeine });

  test('speed: fast search = full search (same three plans) on many stock combinations and rides', async () => {
    const W = req('workout.js'), E = req('engine.js'), M = req('match.js'), rules = await load('data/rules.json');
    const L = (await load('data/library.json')).items.concat((await load('data/caffeine.json')).items);
    const usable = L.filter(i => i.choG > 0).map(i => i.id).sort();
    const rides = [['Duur_3u_2026-11-28', { goalTag: 'endurance', indoor: true, rideYear: 2026 }], ['Koers_150m', { goalTag: 'race', start: '10:00', rideYear: 2026 }],
      ['Endurance_Shuttle_120m_2026-12-04', { rideYear: 2026, indoor: false }], ['5h_endurance', { start: '08:00', rideYear: 2026, indoor: false, refillMin: 90 }]];
    const profile = { birthYear: 1990, massKg: 75, gutCapGph: 90, bottleMl: 750, cages: 2, salty: 'yes', caffeine: 'low', bedtime: '23:00', allergens: [] };
    let seed = 11; const rnd = n => (seed = (seed * 16807) % 2147483647) % n;
    let checked = 0;
    for (const [fx, ctx] of rides) {
      const T = E.plan({ parsed: W.parse(await load(`tests/fixtures/${fx}.json`)), ctx, profile, rules });
      for (let k = 0; k < (fx === '5h_endurance' ? 3 : 6); k++) {
        const ids = new Set(); while (ids.size < 3 + rnd(3)) ids.add(usable[rnd(usable.length)]);
        const stock = [...ids].map(id => ({ id, qty: 2 + rnd(5), fav: rnd(4) === 0 }));
        const a = M.match({ targets: T, items: L, stock, profile, ctx, rules }), b = M.match({ targets: T, items: L, stock, profile, ctx: Object.assign({ exhaustive: true }, ctx), rules });
        assert.equal(sum(a), sum(b), `${fx} with ${stock.map(s => s.id + 'x' + s.qty).join(', ')}`); checked++;
      }
    }
    assert.equal(checked, 21);
  });
})();
