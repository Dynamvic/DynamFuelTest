'use strict';
/* DynamFuel – barcode reader for EAN-13, EAN-8 and UPC-A (the codes on food packs), for browsers without BarcodeDetector
   (iPhone Safari, desktop Chrome on Windows). Pure: no DOM. The app passes rows of grey values (0 = black, 255 = white) from the
   camera picture; decodeRow() finds the bars, measures their widths and checks the check digit. Nothing leaves the phone. */
(function (root, factory) {
  const m = factory();
  if (typeof module === 'object' && module.exports) module.exports = m; else root.DFEan = m;
})(typeof self !== 'undefined' ? self : this, function () {
  const L = ['0001101', '0011001', '0010011', '0111101', '0100011', '0110001', '0101111', '0111011', '0110111', '0001011'];
  const R = L.map(p => p.replace(/./g, b => b === '1' ? '0' : '1'));
  const G = R.map(p => p.split('').reverse().join(''));
  const FIRST = ['LLLLLL', 'LLGLGG', 'LLGGLG', 'LLGGGL', 'LGLLGG', 'LGGLLG', 'LGGGLL', 'LGLGLG', 'LGLGGL', 'LGGLGL'];
  const runsOf = p => { const out = []; let c = p[0], n = 0; for (const b of p) { if (b === c) n++; else { out.push(n); c = b; n = 1; } } out.push(n); return out; };
  const REF = { L: L.map(runsOf), G: G.map(runsOf), R: R.map(runsOf) };

  const checkOk = d => { const s = d.slice(0, -1).split('').reverse().reduce((a, x, i) => a + (+x) * (i % 2 ? 1 : 3), 0); return (10 - s % 10) % 10 === +d[d.length - 1]; };

  /* best digit for 4 run widths against a code table: [digit, error] */
  function digit(runs, table) {
    const tot = runs[0] + runs[1] + runs[2] + runs[3], v = runs.map(r => r * 7 / tot);
    let best = -1, err = Infinity;
    table.forEach((ref, d) => { const e = Math.abs(v[0] - ref[0]) + Math.abs(v[1] - ref[1]) + Math.abs(v[2] - ref[2]) + Math.abs(v[3] - ref[3]); if (e < err) { err = e; best = d; } });
    return [best, err];
  }
  const guardOk = (rs, m) => rs.every(r => r > 0.4 * m && r < 1.9 * m);

  function try13(seg) {
    const m = seg.reduce((a, b) => a + b, 0) / 95;
    if (!guardOk(seg.slice(0, 3), m) || !guardOk(seg.slice(27, 32), m) || !guardOk(seg.slice(56, 59), m)) return null;
    let par = '', left = '', right = '';
    for (let i = 0; i < 6; i++) {
      const r = seg.slice(3 + 4 * i, 7 + 4 * i), [dl, el] = digit(r, REF.L), [dg, eg] = digit(r, REF.G);
      if (Math.min(el, eg) > 1.6) return null;
      if (el <= eg) { left += dl; par += 'L'; } else { left += dg; par += 'G'; }
    }
    for (let i = 0; i < 6; i++) { const [d, e] = digit(seg.slice(32 + 4 * i, 36 + 4 * i), REF.R); if (e > 1.6) return null; right += d; }
    const f = FIRST.indexOf(par); if (f < 0) return null;
    const code = f + left + right; return checkOk(code) ? code : null;
  }
  function try8(seg) {
    const m = seg.reduce((a, b) => a + b, 0) / 67;
    if (!guardOk(seg.slice(0, 3), m) || !guardOk(seg.slice(19, 24), m) || !guardOk(seg.slice(40, 43), m)) return null;
    let code = '';
    for (let i = 0; i < 4; i++) { const [d, e] = digit(seg.slice(3 + 4 * i, 7 + 4 * i), REF.L); if (e > 1.6) return null; code += d; }
    for (let i = 0; i < 4; i++) { const [d, e] = digit(seg.slice(24 + 4 * i, 28 + 4 * i), REF.R); if (e > 1.6) return null; code += d; }
    return checkOk(code) ? code : null;
  }
  /* widths of dark and light runs, starting with the first dark run (threshold halfway between dark and light) */
  function runs(row) {
    const s = Array.from(row).sort((a, b) => a - b), lo = s[Math.floor(s.length * 0.05)], hi = s[Math.floor(s.length * 0.95)];
    if (hi - lo < 40) return [];
    const th = (lo + hi) / 2, out = [];
    let i = 0; while (i < row.length && row[i] >= th) i++;
    let dark = true, n = 0;
    for (; i < row.length; i++) { const d = row[i] < th; if (d === dark) n++; else { out.push(n); dark = d; n = 1; } }
    if (n) out.push(n);
    return out;   // even index = dark
  }
  /* one row of grey values → barcode digits or null; also reads the code upside down */
  function decodeRow(row) {
    for (const r of [row, Array.from(row).reverse()]) {
      const w = runs(r);
      for (let i = 0; i + 59 <= w.length; i += 2) { const c = try13(w.slice(i, i + 59)); if (c) return c; }
      for (let i = 0; i + 43 <= w.length; i += 2) { const c = try8(w.slice(i, i + 43)); if (c) return c; }
    }
    return null;
  }
  /* modules ('1' = bar) of an EAN-13 code – used by the tests to draw barcodes */
  function encode13(code) {
    const p = FIRST[+code[0]];
    return '101' + code.slice(1, 7).split('').map((d, i) => (p[i] === 'L' ? L : G)[+d]).join('') + '01010' + code.slice(7).split('').map(d => R[+d]).join('') + '101';
  }
  function encode8(code) { return '101' + code.slice(0, 4).split('').map(d => L[+d]).join('') + '01010' + code.slice(4).split('').map(d => R[+d]).join('') + '101'; }
  return { decodeRow, encode13, encode8, checkOk };
});
