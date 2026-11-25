'use strict';
(function () {
  const { test, assert, req } = typeof module === 'object' && module.exports ? require('./harness.js') : DFTest;
  const items = [
    { id: 'g1', category: 'gel' }, { id: 'g2', category: 'gel' }, { id: 'g3', category: 'gel' },
    { id: 'b1', category: 'bar' }, { id: 'd1', category: 'drink' }, { id: 'own1', category: 'gel', own: true }];

  test('ui: stock filter per category, combined with "in stock"; hidden products left out', async () => {
    const U = req('ui.js'), st = { g2: { qty: 6 }, g3: { qty: 0, hidden: true }, b1: { qty: 2 }, own1: { qty: 1 } };
    assert.deepEqual(U.filterStock(items, st, { cat: 'gel' }).map(x => x.id), ['g2', 'own1', 'g1'], 'gels: in stock first, hidden g3 out, own gel included');
    assert.deepEqual(U.filterStock(items, st, { cat: 'gel', inStock: true }).map(x => x.id), ['g2', 'own1']);
    assert.deepEqual(U.filterStock(items, st, { cat: 'own' }).map(x => x.id), ['own1']);
    assert.deepEqual(U.filterStock(items, st, { inStock: true }).map(x => x.id), ['g2', 'b1', 'own1'], 'all categories, list order kept');
    assert.deepEqual(U.filterStock(items, {}, {}).map(x => x.id), items.map(x => x.id), 'no stock: the list order as it is');
  });

  test('ui: stock order = favourites first, then in stock, then list order (coach Q1)', async () => {
    const U = req('ui.js'), st = { g1: { qty: 0 }, g2: { qty: 3 }, g3: { qty: 0, fav: true } };
    assert.deepEqual(U.filterStock(items, st, { cat: 'gel' }).map(x => x.id), ['g3', 'g2', 'g1', 'own1']);
    const st2 = { g1: { qty: 1, fav: true }, g3: { qty: 2, fav: true } };
    assert.deepEqual(U.filterStock(items, st2, { cat: 'gel' }).map(x => x.id), ['g1', 'g3', 'g2', 'own1'], 'ties keep the list order');
  });

  test('ui: timing rows = eating moments + slots whose drink amount differs; nothing is changed', async () => {
    const U = req('ui.js'), slots = [{ min: 15 }, { min: 35 }, { min: 55 }, { min: 75 }];
    const sch = [{ eat: [{ id: 'bar' }], drinkMl: 200 }, { eat: [], drinkMl: 200 }, { eat: [{ id: 'gel' }], drinkMl: 200 }, { eat: [], drinkMl: 300 }];
    const rows = U.timingRows(slots, sch, 200, (s, sc) => sc.eat.length > 0);
    assert.deepEqual(rows, [{ i: 0, eat: true, drinkMl: null }, { i: 2, eat: true, drinkMl: null }, { i: 3, eat: false, drinkMl: 300 }]);
    assert.deepEqual(U.timingRows(slots, null, 200, () => false), [], 'no schedule and nothing to eat → only the drink line');
    assert.equal(U.timingRows(slots, null, 200, () => true).length, 4, 'without stock every moment shows what kind of intake fits');
  });

  test('ui: search in the stock – every word in brand + name, case and accents ignored (UX #17)', async () => {
    const U = req('ui.js'), L = [{ id: 'a', brand: '6D', name: 'Sports Gel', category: 'gel' }, { id: 'b', brand: 'Nduranz', name: 'Nrgy Gel 45', category: 'gel' }, { id: 'c', brand: '', name: 'Café crème', category: 'food' }];
    assert.deepEqual(U.filterStock(L, {}, { q: 'gel' }).map(x => x.id), ['a', 'b']);
    assert.deepEqual(U.filterStock(L, {}, { q: 'NDURANZ 45' }).map(x => x.id), ['b']);
    assert.deepEqual(U.filterStock(L, {}, { q: 'cafe' }).map(x => x.id), ['c'], 'é matches e');
    assert.deepEqual(U.filterStock(L, {}, { q: '6d nrgy' }).map(x => x.id), [], 'all words must match one product');
    assert.deepEqual(U.filterStock(L, {}, { q: '  ' }).map(x => x.id), ['a', 'b', 'c']);
  });

  test('ui: a pack list taken off the stock – stock units, never below 0, water/refill take nothing (UX #19)', async () => {
    const U = req('ui.js');
    const pack = [{ id: 'gel', n: 6 }, { id: 'bar', n: 1 }, { bottle: true, content: 'drink', id: 'mix', bottles: 2, doses: 1.5 },
      { bottle: true, content: 'electrolyte', id: 'tab', bottles: 1, tabs: 1 }, { bottle: true, content: 'water', id: null, bottles: 1 }, { refill: true, bottles: 1 }];
    const qty = { gel: 8, bar: 0, mix: 10, tab: 1, other: 5 };
    assert.deepEqual(U.usePack(pack, qty), [{ id: 'gel', from: 8, to: 2 }, { id: 'mix', from: 10, to: 7 }, { id: 'tab', from: 1, to: 0 }],
      '2 bottles × 1,5 doses = 3 doses; bar not in stock is skipped');
    assert.deepEqual(U.usePack([{ id: 'gel', n: 9 }], { gel: 4 }), [{ id: 'gel', from: 4, to: 0 }]);
    assert.deepEqual(U.usePack([], qty), []);
  });

  test('ui: the ride whose pack was taken off still plans with that stock; other rides see the lower stock', async () => {
    const U = req('ui.js'), raw = [{ id: 'gel', qty: 2, fav: true }, { id: 'tab', qty: 0 }, { id: 'old', qty: 3 }, { id: 'hid', qty: 4, hidden: true }];
    const used = { at: '2026-11-25', items: [{ id: 'gel', from: 8, to: 2 }, { id: 'tab', from: 1, to: 0 }] }, ok = id => id !== 'old';
    assert.deepEqual(U.stockForRide(raw, used, ok), [{ id: 'gel', qty: 8, fav: true }, { id: 'tab', qty: 1, fav: false }]);
    assert.deepEqual(U.stockForRide(raw, null, ok), [{ id: 'gel', qty: 2, fav: true }], 'no "used": the stock as it is (= stockList)');
    const B = req('backup.js');
    assert.deepEqual(B.checkRide({ id: 'icu-1', used }).used, used, 'kept in the ride record and in back-ups');
    assert.equal(B.checkRide({ id: 'icu-1', used: { at: '2026-11-25', items: [{ id: 'gel', from: 1, to: 3 }] } }), null, 'to above from is refused');
    assert.equal(B.checkRide({ id: 'icu-1', used: { at: 'today', items: [] } }), null);
  });

  test('ui: range shown only when low and high differ; wizard defaults fill only empty values', async () => {
    const U = req('ui.js');
    assert.ok(U.isRange(30, 60)); assert.ok(!U.isRange(60, 60)); assert.ok(!U.isRange(null, 60));
    assert.deepEqual(U.withDefaults({ cages: null, caffeine: 'none', bedtime: null }), { cages: 2, caffeine: 'none', bedtime: null });
    assert.deepEqual(U.withDefaults({ cages: 0, caffeine: 'normal', bedtime: null }), { cages: 0, caffeine: 'normal', bedtime: '23:00' }, '0 cages is an answer');
    assert.equal(U.withDefaults({ caffeine: 'low', bedtime: '22:15' }).bedtime, '22:15');
    assert.deepEqual(U.GUT_CHIPS, [null, 30, 45, 60, 75, 90, 120]);
  });
})();
