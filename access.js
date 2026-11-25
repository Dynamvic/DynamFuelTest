'use strict';
/* DynamFuel – access lock, the same mechanism as DynamCore (decision Q2: open for now, lock built but parked).
   - Every phone gets a random device code (stored on the phone, key dynamfuel:device).
   - The coach signs "device code + name + end date" on DynamCore's coach.html (same token format DCA1, same coach key).
   - The app checks the signature with the public key in key.js. No key in key.js = the app stays locked when switched on.
   Activation data is kept apart from the athlete data: back-ups and "erase everything" do not touch it. */

/* ===== SWITCH: the lock is PARKED. Set to true (and put the coach's public key in key.js) to turn it on. ===== */
const ACCESS_ENABLED = false;

const ACT = { state: 'checking', info: null };
const ACCESS_KEYS = { device: 'dynamfuel:device', act: 'dynamfuel:act' };
const accStore = {
  get(k) { try { return localStorage.getItem(k); } catch (e) { return null; } },
  set(k, v) { try { localStorage.setItem(k, v); } catch (e) { } }
};
const b64uBytes = s => { const b = atob(s.replace(/-/g, '+').replace(/_/g, '/')); return Uint8Array.from(b, c => c.charCodeAt(0)); };
function deviceCode() {
  let d = accStore.get(ACCESS_KEYS.device);
  if (!d) {
    const A = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789', r = crypto.getRandomValues(new Uint8Array(12));
    const s = [...r].map(x => A[x % A.length]).join('');
    d = `${s.slice(0, 4)}-${s.slice(4, 8)}-${s.slice(8, 12)}`;
    accStore.set(ACCESS_KEYS.device, d);
  }
  return d;
}
async function verifyToken(token, todayIso) {
  if (typeof DC_KEY === 'undefined' || !window.crypto || !crypto.subtle) return { ok: false, why: 'nokey' };
  const m = /DCA1\.([A-Za-z0-9_-]+)\.([A-Za-z0-9_-]+)/.exec(token || '');
  if (!m) return { ok: false, why: 'format' };
  let pay;
  try { pay = JSON.parse(new TextDecoder().decode(b64uBytes(m[1]))); } catch (e) { return { ok: false, why: 'format' }; }
  try {
    const key = await crypto.subtle.importKey('jwk', DC_KEY, { name: 'ECDSA', namedCurve: 'P-256' }, false, ['verify']);
    const good = await crypto.subtle.verify({ name: 'ECDSA', hash: 'SHA-256' }, key, b64uBytes(m[2]), new TextEncoder().encode(m[1]));
    if (!good) return { ok: false, why: 'sig' };
  } catch (e) { return { ok: false, why: 'sig' }; }
  if (pay.d !== deviceCode()) return { ok: false, why: 'device', pay };
  if (typeof DC_REVOKED !== 'undefined' && DC_REVOKED.includes(pay.d)) return { ok: false, why: 'revoked', pay };
  if (pay.e && pay.e < todayIso) return { ok: false, why: 'expired', pay };
  return { ok: true, pay, token: `DCA1.${m[1]}.${m[2]}` };
}
async function checkActivation(todayIso) {
  if (!ACCESS_ENABLED) { ACT.state = 'ok'; return; }
  deviceCode();
  if (typeof DC_KEY === 'undefined') { ACT.state = 'nokey'; return; }
  const tok = accStore.get(ACCESS_KEYS.act);
  if (!tok) { ACT.state = 'locked'; return; }
  const r = await verifyToken(tok, todayIso);
  ACT.state = r.ok ? 'ok' : r.why === 'expired' ? 'expired' : r.why === 'revoked' ? 'revoked' : 'locked';
  ACT.info = r.pay || null;
}
/* lock screen (only shown when ACCESS_ENABLED is true): device code to send to the coach + field for the activation code */
function vLock() {
  return `<div class="wz"><h1 class="h1">${t('lock_t')}</h1><p class="lead">${t('lock_l')}</p>
    <section class="card"><div class="devcode">${deviceCode()}</div></section>
    <section class="card"><textarea id="acccode" autocomplete="off"></textarea>
      <button class="btn primary wide" data-act="accgo">OK</button><p class="msg" id="accerr"></p></section></div>`;
}
document.addEventListener('click', async ev => {
  if (!ev.target.closest('[data-act="accgo"]')) return;
  const r = await verifyToken($('#acccode').value, todayIso());
  if (r.ok) { accStore.set(ACCESS_KEYS.act, r.token); ACT.state = 'ok'; ACT.info = r.pay; route(); return; }
  const m = $('#accerr'); m.className = 'msg bad'; m.textContent = r.why;
});
