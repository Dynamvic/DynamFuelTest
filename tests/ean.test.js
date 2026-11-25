'use strict';
(function () {
  const { test, assert, req } = typeof module === 'object' && module.exports ? require('./harness.js') : DFTest;
  /* draw a barcode as one row of grey values: module width w px, white margins, a little blur and noise (like a camera) */
  function row(modules, w, opts = {}) {
    const px = []; const quiet = 12 * w;
    for (let i = 0; i < quiet; i++) px.push(235);
    for (const b of modules) for (let k = 0; k < w; k++) px.push(b === '1' ? 25 : 235);
    for (let i = 0; i < quiet; i++) px.push(235);
    let seed = 7; const rnd = () => (seed = (seed * 16807) % 2147483647) / 2147483647;
    const out = px.map((v, i) => { const a = px[Math.max(0, i - 1)], c = px[Math.min(px.length - 1, i + 1)]; return (opts.blur ? (a + 2 * v + c) / 4 : v) + (opts.noise ? (rnd() - 0.5) * opts.noise : 0); });
    return opts.reverse ? out.reverse() : out;
  }

  test('ean: reads EAN-13 codes (also upside down, blurred, with noise and at different sizes)', async () => {
    const E = req('ean.js');
    ['5410013108009', '3017620422003', '8710398527790', '4006381333931'].forEach(code => {
      assert.equal(E.decodeRow(row(E.encode13(code), 3)), code, code);
      assert.equal(E.decodeRow(row(E.encode13(code), 2, { blur: true, noise: 40 })), code, `${code} blurred`);
      assert.equal(E.decodeRow(row(E.encode13(code), 4, { reverse: true })), code, `${code} upside down`);
    });
  });

  test('ean: reads EAN-8 and UPC-A (as 13 digits with a leading 0); refuses a wrong check digit and noise only', async () => {
    const E = req('ean.js');
    assert.equal(E.decodeRow(row(E.encode8('96385074'), 3)), '96385074');
    assert.equal(E.decodeRow(row(E.encode13('0036000291452'), 3)), '0036000291452', 'UPC-A 036000291452');
    const bad = E.encode13('5410013108009').split(''); bad[60] = bad[60] === '1' ? '0' : '1'; bad[61] = bad[61] === '1' ? '0' : '1';
    assert.equal(E.decodeRow(row(bad.join(''), 3)), null, 'damaged code is not guessed');
    assert.equal(E.decodeRow(Array.from({ length: 400 }, (_, i) => 120 + (i % 7) * 10)), null);
    assert.ok(E.checkOk('5410013108009') && !E.checkOk('5410013108008'));
  });
})();
