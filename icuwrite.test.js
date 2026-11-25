'use strict';
(function () {
  const { test, assert, req } = typeof module === 'object' && module.exports ? require('./harness.js') : DFTest;
  /* a coach description in Intervals.icu workout text (steps start with "- ") */
  const coach = 'Duurrit, rustig houden.\n\nWarmup\n- 15m ramp 50-65%\n\nMain set 3x\n- 10m 88-92%\n- 5m 55%\n\nCooldown\n- 10m 50%';
  const lines = ['90 g/u koolhydraten · 600 ml/u · 400 mg/u natrium', 'Mee: 4× Nrgy Gel 45; 2× bidon water', 'Eten: 08:15 Nrgy Gel 45; 09:35 Nrgy Gel 45', '- 3x 10m tricky', '3x hidden repeat'];

  test('icuwrite: the block is added at the end; the coach\'s text stays exactly the same', async () => {
    const W = req('icuwrite.js'), block = W.buildBlock(lines);
    const d1 = W.withBlock(coach, block);
    assert.ok(d1.startsWith(coach + '\n\n'), 'coach text first, unchanged');
    assert.ok(d1.endsWith(W.END)); assert.equal(W.stripBlock(d1), coach, 'removing gives back the exact coach text');
    assert.equal(W.withBlock('', block), block); assert.equal(W.withBlock(null, block), block);
  });

  test('icuwrite: sending again replaces only DynamFuel\'s own block (never two blocks); text after the block stays', async () => {
    const W = req('icuwrite.js');
    const d1 = W.withBlock(coach, W.buildBlock(lines)), d2 = W.withBlock(d1, W.buildBlock(['70 g/u']));
    assert.equal(d2.split(W.START).length - 1, 1, 'one block'); assert.ok(d2.includes('70 g/u') && !d2.includes('90 g/u'));
    const edited = d1 + '\n\nNote added later by the coach';
    assert.equal(W.stripBlock(edited), coach + '\n\nNote added later by the coach');
  });

  test('icuwrite: no DynamFuel line can be read as a workout step ("-", a digit or "3x" at the start)', async () => {
    const W = req('icuwrite.js'), b = W.buildBlock(lines).split('\n');
    assert.equal(b[0], W.START); assert.equal(b[b.length - 1], W.END);
    b.slice(1, -1).forEach(l => { assert.ok(l.startsWith('• '), l); assert.ok(!/^\s*(-|\d|\d+x)/i.test(l), l); });
    assert.ok(!W.buildBlock(['[/DynamFuel] trick']).slice(W.START.length, -W.END.length).includes(W.END), 'a marker inside a line is removed');
  });

  test('icuwrite: carbs per hour only when empty or still DynamFuel\'s own value; workout signature', async () => {
    const W = req('icuwrite.js');
    assert.equal(W.carbsToSend(null, null, 90), 90); assert.equal(W.carbsToSend(60, 60, 90), 90, 'our old value');
    assert.equal(W.carbsToSend(80, null, 90), undefined, 'coach value kept'); assert.equal(W.carbsToSend(80, 60, 90), undefined);
    assert.equal(W.carbsToSend(null, null, 0), undefined, 'no carbohydrate → not written');
    const ev = { type: 'Ride', workout_doc: { duration: 3600, steps: [{ duration: 600, power: { value: 60, units: '%ftp' } }] } };
    assert.equal(W.signature(ev), W.signature(JSON.parse(JSON.stringify(ev))));
    assert.notEqual(W.signature(ev), W.signature({ type: 'Ride', workout_doc: { duration: 3000, steps: ev.workout_doc.steps } }));
    assert.notEqual(W.hash(W.buildBlock(['a'])), W.hash(W.buildBlock(['b'])));
  });
})();
