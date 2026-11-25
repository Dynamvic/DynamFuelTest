'use strict';
(function () {
  const { test, assert, load, req } = typeof module === 'object' && module.exports ? require('./harness.js') : DFTest;

  test('i18n: NL and EN have the same keys and the same {placeholders}', async () => {
    const I = req('i18n.js'), nl = Object.keys(I.nl).sort(), en = Object.keys(I.en).sort();
    assert.deepEqual(nl.filter(k => !I.en[k]), [], 'missing in EN'); assert.deepEqual(en.filter(k => !I.nl[k]), [], 'missing in NL');
    const ph = s => typeof s === 'string' ? (s.match(/\{\w+\}/g) || []).sort().join() : '';
    nl.forEach(k => assert.equal(ph(I.nl[k]), ph(I.en[k]), `placeholders of ${k}`));
  });

  test('i18n: every rule has an explanation in both languages, and its {fields} exist in rules.json', async () => {
    const I = req('i18n.js'), rules = (await load('data/rules.json')).rules;
    const skip = [];
    Object.keys(rules).filter(id => !skip.includes(id)).forEach(id => { assert.ok(I.nl['r_' + id], `NL r_${id}`); assert.ok(I.en['r_' + id], `EN r_${id}`); });
    Object.keys(I.nl).filter(k => k.startsWith('r_')).forEach(k => {
      const id = k.slice(2); assert.ok(rules[id], `${id} exists`);
      (I.nl[k].match(/\{(\w+)\}/g) || []).forEach(m => assert.ok(rules[id][m.slice(1, -1)] != null, `${id}.${m.slice(1, -1)}`));
    });
  });

  test('i18n: comma decimals in all texts (no "0.5"-style numbers)', async () => {
    const I = req('i18n.js');
    ['nl', 'en'].forEach(l => Object.entries(I[l]).forEach(([k, s]) => { if (typeof s === 'string') assert.ok(!/\d\.\d/.test(s), `${l}.${k}: ${s}`); }));
  });
})();
