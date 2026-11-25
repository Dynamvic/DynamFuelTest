'use strict';
/* DynamFuel – fuel card (portrait image 1080 × 1920 to share) and top-tube sticker (printable strip ~3 cm wide), decision P3-3.
   Both are drawn from one plain-text model that the ride screen builds (no HTML inside):
   { title, meta, tiles:[{k, v, u, s}], caf, pack:[], slots:[{time, what, drink}], pre:[], post:[], sub, foot, open, fileName } */
const DFCard = (() => {
  const W = 1080, H = 1920, PAD = 60;
  const C = { bg: '#F5F5F3', surface: '#FFFFFF', fg: '#111214', muted: '#5D616B', line: '#E1E2E5', band: '#111316', amber: '#F5A524', accent: '#9C5A00', open: '#B42318' };
  const font = (w, px, fam) => `${w} ${px}px ${fam === 'd' ? 'Poppins, "Segoe UI", sans-serif' : 'Inter, system-ui, sans-serif'}`;

  /* wrap text into lines that fit maxW */
  function lines(ctx, text, maxW) {
    const out = []; let cur = '';
    String(text).split(/\s+/).forEach(w => { const tryL = cur ? cur + ' ' + w : w; if (ctx.measureText(tryL).width <= maxW || !cur) cur = tryL; else { out.push(cur); cur = w; } });
    if (cur) out.push(cur); return out;
  }
  function para(ctx, text, x, y, maxW, lh, maxLines) {
    let L = lines(ctx, text, maxW); if (maxLines && L.length > maxLines) { L = L.slice(0, maxLines); L[maxLines - 1] += ' …'; }
    L.forEach((l, i) => ctx.fillText(l, x, y + i * lh)); return y + L.length * lh;
  }
  const loadImg = src => new Promise(res => { const i = new Image(); i.onload = () => res(i); i.onerror = () => res(null); i.src = src; });

  async function image(m) {
    try { await Promise.all(['800 60px Poppins', '700 40px Poppins', '600 30px Inter', '400 30px Inter'].map(f => document.fonts.load(f))); } catch (e) { }
    const cv = document.createElement('canvas'); cv.width = W; cv.height = H;
    const x = cv.getContext('2d'); x.textBaseline = 'top';
    x.fillStyle = C.bg; x.fillRect(0, 0, W, H);
    /* band with icon and name */
    x.fillStyle = C.band; x.fillRect(0, 0, W, 170);
    const icon = await loadImg('icons/icon-192.png'); if (icon) x.drawImage(icon, PAD, 35, 100, 100);
    x.fillStyle = '#FFFFFF'; x.font = font(800, 54, 'd'); x.fillText('DynamFuel', PAD + 125, 42);
    x.fillStyle = C.amber; x.font = font(600, 28); x.fillText(m.sub, PAD + 127, 108);
    let y = 210;
    x.fillStyle = C.fg; x.font = font(800, 58, 'd'); y = para(x, m.title, PAD, y, W - 2 * PAD, 68, 2) + 6;
    x.fillStyle = C.muted; x.font = font(500, 32); x.fillText(m.meta, PAD, y); y += 64;
    /* three tiles */
    const tw = (W - 2 * PAD - 2 * 24) / 3, th = 230;
    m.tiles.forEach((tl, i) => {
      const tx = PAD + i * (tw + 24);
      x.fillStyle = C.surface; x.fillRect(tx, y, tw, th); x.strokeStyle = C.line; x.lineWidth = 2; x.strokeRect(tx + 1, y + 1, tw - 2, th - 2);
      x.fillStyle = C.muted; x.font = font(600, 28); x.fillText(tl.k, tx + 22, y + 20);
      x.fillStyle = C.fg; x.font = font(800, 84, 'd'); x.fillText(tl.v, tx + 22, y + 58);
      x.fillStyle = C.muted; x.font = font(600, 28); x.fillText(tl.u, tx + 22, y + 152);
      if (tl.s) { x.font = font(400, 24); x.fillText(tl.s, tx + 22, y + 188); }
    });
    y += th + 34;
    if (m.caf) { x.fillStyle = m.cafOpen ? C.open : C.fg; x.font = font(600, 30); y = para(x, m.caf, PAD, y, W - 2 * PAD, 40, 2) + 18; }
    /* pack list */
    const head = t => { x.fillStyle = C.accent; x.font = font(700, 36, 'd'); x.fillText(t, PAD, y); y += 52; };
    if (m.pack.length) { head(m.hPack); x.fillStyle = C.fg; x.font = font(400, 30); m.pack.forEach(p => { y = para(x, '• ' + p, PAD, y, W - 2 * PAD, 40, 2) + 4; }); y += 18; }
    /* timeline: as many rows as fit above before/after and footer */
    const reserve = 70 + (m.pre.length + m.post.length ? 190 : 0);
    if (m.slots.length) {
      head(m.hTiming);
      const rowH = 44, room = Math.max(0, Math.floor((H - reserve - y) / rowH)), show = m.slots.length > room ? Math.max(0, room - 1) : m.slots.length;
      m.slots.slice(0, show).forEach(s => {
        x.fillStyle = C.fg; x.font = font(700, 30, 'd'); x.fillText(s.time, PAD, y);
        x.font = font(400, 30); const txt = [s.what, s.drink].filter(Boolean).join(' · ');
        para(x, txt, PAD + 140, y, W - 2 * PAD - 140, 40, 1); y += rowH;
      });
      if (show < m.slots.length) { x.fillStyle = C.muted; x.font = font(400, 28); x.fillText(`… +${m.slots.length - show}`, PAD + 140, y); y += rowH; }
      y += 14;
    }
    /* before / after (short) */
    x.font = font(400, 28);
    if (m.pre.length) { x.fillStyle = C.accent; x.font = font(700, 30, 'd'); x.fillText(m.hBefore, PAD, y); x.fillStyle = C.fg; x.font = font(400, 28); y = para(x, m.pre[0], PAD + 220, y, W - 2 * PAD - 220, 36, 2) + 12; }
    if (m.post.length) { x.fillStyle = C.accent; x.font = font(700, 30, 'd'); x.fillText(m.hAfter, PAD, y); x.fillStyle = C.fg; x.font = font(400, 28); y = para(x, m.post[0], PAD + 220, y, W - 2 * PAD - 220, 36, 2) + 12; }
    /* footer */
    x.fillStyle = C.muted; x.font = font(400, 22); para(x, m.foot, PAD, H - 64, W - 2 * PAD, 28, 2);
    return new Promise(res => cv.toBlob(b => res(b), 'image/png'));
  }

  async function share(m) {
    const blob = await image(m); if (!blob) return 'fail';
    const file = new File([blob], m.fileName, { type: 'image/png' });
    try { if (navigator.canShare && navigator.canShare({ files: [file] })) { await navigator.share({ files: [file], title: m.title }); return 'shared'; } }
    catch (e) { if (e && e.name === 'AbortError') return 'cancel'; }
    const url = URL.createObjectURL(blob), a = document.createElement('a'); a.href = url; a.download = m.fileName; document.body.appendChild(a); a.click(); a.remove();
    setTimeout(() => URL.revokeObjectURL(url), 4000); return 'saved';
  }

  /* sticker: a 30 mm wide strip, one line per moment; printed with the browser's print dialog */
  function sticker(m, esc) {
    const rows = m.slots.map(s => `<tr><th>${esc(s.time)}</th><td>${esc(s.short || s.what || '')}</td></tr>`).join('');
    return `<div class="stk"><div class="stkh"><b>${esc(m.title)}</b><span>${esc(m.metaShort)}</span><span>${esc(m.target)}</span></div><table>${rows}</table><div class="stkf">DynamFuel</div></div>`;
  }
  function print(m, esc) {
    let el = document.getElementById('print'); if (!el) { el = document.createElement('div'); el.id = 'print'; document.body.appendChild(el); }
    el.innerHTML = sticker(m, esc);
    window.print();
  }
  return { image, share, sticker, print };
})();
