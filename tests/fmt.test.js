'use strict';
(function () {
  const { test, assert, req } = typeof module === 'object' && module.exports ? require('./harness.js') : DFTest;
  const F = req('fmt.js');

  test('fmt: rounding steps (CHO 5 g, fluid 50 ml, sodium 50 mg, caffeine 25 mg)', () => {
    assert.equal(F.roundTo(62.4, 5), 60); assert.equal(F.roundTo(62.5, 5), 65);
    assert.equal(F.roundTo(624, 50), 600); assert.equal(F.roundTo(625, 50), 650);
    assert.equal(F.roundTo(212, 25), 200); assert.equal(F.roundTo(213, 25), 225);
    assert.equal(F.roundTo(-1, 5), 0);
  });
  test('fmt: comma decimals and DD-MM-YYYY', () => {
    assert.equal(F.num(0.65, 2), '0,65'); assert.equal(F.num(1.5, 1), '1,5'); assert.equal(F.num(null), '–');
    assert.equal(F.date('2026-12-04'), '04-12-2026');
  });
  test('fmt: clock times wrap around midnight', () => {
    assert.equal(F.clock('07:45', 75), '09:00'); assert.equal(F.clock('23:30', 45), '00:15'); assert.equal(F.clock('08:00', -60), '07:00');
    assert.equal(F.toMin('6:05'), 365); assert.equal(F.dur(4530), '1:15:30'); assert.equal(F.dur(3600), '1:00');
  });
})();
