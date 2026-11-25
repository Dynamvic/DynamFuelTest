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

  test('ui: range shown only when low and high differ; wizard defaults fill only empty values', async () => {
    const U = req('ui.js');
    assert.ok(U.isRange(30, 60)); assert.ok(!U.isRange(60, 60)); assert.ok(!U.isRange(null, 60));
    assert.deepEqual(U.withDefaults({ cages: null, caffeine: 'none', bedtime: null }), { cages: 2, caffeine: 'none', bedtime: null });
    assert.deepEqual(U.withDefaults({ cages: 0, caffeine: 'normal', bedtime: null }), { cages: 0, caffeine: 'normal', bedtime: '23:00' }, '0 cages is an answer');
    assert.equal(U.withDefaults({ caffeine: 'low', bedtime: '22:15' }).bedtime, '22:15');
    assert.deepEqual(U.GUT_CHIPS, [null, 30, 45, 60, 75, 90, 120]);
  });
})();
