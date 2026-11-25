'use strict';
/* DynamFuel – Intervals.icu workout parser.
   Input: a workout document (Intervals.icu export or the event's workout_doc): { duration, ftp, steps[], sportSettings{power_zones, sweet_spot_min, sweet_spot_max} }.
   Output: a flat timeline of steps in % FTP, plus intensity metrics. Pure: no DOM, no fetch, no Date.now.

   Step targets handled (seen in the coach's samples):
   - power {value, units:'%ftp'}                 single target
   - power {start, end, units:'%ftp'} + ramp      ramp (also descending, e.g. cool-down)
   - power {value:n, units:'power_zone'}          zone n of sportSettings.power_zones (upper bounds in % FTP)
   - power {value:n, units:'power_zone'}, n = zones+2   sweet spot (sweet_spot_min–max); verified on the sample
                                                  "Active Recovery 4": zone 9 -> _power 302–349 W = 84–97 % of 360 W
   - power {value, units:'w'}                     absolute watts (converted with FTP)
   - reps + steps                                 nested repeats; the block's duration is the total of all reps
   _power (watts resolved by Intervals.icu) is NOT used as input – only as a cross-check (it may be absent in the events API).
   zoneTimes in the export is NOT used: in the samples it holds stale zones/FTP. */
(function (root, factory) {
  const m = factory();
  if (typeof module === 'object' && module.exports) module.exports = m; else root.DFWorkout = m;
})(typeof self !== 'undefined' ? self : this, function () {
  const RIDE_TYPES = ['Ride', 'VirtualRide', 'GravelRide', 'MountainBikeRide'];
  const INDOOR_TYPES = ['VirtualRide'];

  function zoneRange(n, zones, ss) {
    if (Number.isInteger(n) && n >= 1 && n <= zones.length) {
      const lo = n === 1 ? 0 : zones[n - 2];
      let hi = zones[n - 1];
      if (hi >= 999) hi = lo;                 // open top zone (e.g. Z7 "151 % +"): use its lower bound
      return { lo, hi };
    }
    if (n === zones.length + 2 && ss && isFinite(ss.min) && isFinite(ss.max)) return { lo: ss.min, hi: ss.max, sweetSpot: true };
    return null;
  }

  /* one leaf step -> {a, b, lo, hi, kind} in % FTP; a/b = intensity used at start/end (mid of a range) */
  function target(step, ftp, zones, ss) {
    const p = step.power;
    if (!p) return { kind: 'none' };
    const u = p.units;
    if (u === '%ftp' || u === 'w') {
      const k = u === 'w' ? (ftp ? 100 / ftp : NaN) : 1;
      if (p.start != null && p.end != null && (step.ramp || p.value == null)) {
        const a = p.start * k, b = p.end * k;
        return { kind: 'ramp', a, b, lo: Math.min(a, b), hi: Math.max(a, b) };
      }
      if (p.value != null) { const v = p.value * k; return { kind: 'pct', a: v, b: v, lo: v, hi: v }; }
    }
    if (u === 'power_zone' && p.value != null) {
      const r = zoneRange(+p.value, zones, ss);
      if (r) { const mid = (r.lo + r.hi) / 2; return { kind: r.sweetSpot ? 'sweetspot' : 'zone', zone: +p.value, a: mid, b: mid, lo: r.lo, hi: r.hi }; }
      return { kind: 'unknown', zone: +p.value };
    }
    return { kind: 'unknown' };
  }

  /* doc -> { ok, skip, durationS, ftp, zones, steps[], issues[] } */
  function parse(doc, opts = {}) {
    const out = { ok: false, skip: null, durationS: 0, ftp: null, zones: null, steps: [], issues: [] };
    if (!doc || typeof doc !== 'object') { out.skip = 'nodoc'; return out; }
    const st = doc.sportSettings || {};
    const ftp = +(opts.ftp || doc.ftp || st.ftp) || null;
    const zones = Array.isArray(opts.zones) ? opts.zones : Array.isArray(st.power_zones) ? st.power_zones : null;
    const ss = { min: +(st.sweet_spot_min), max: +(st.sweet_spot_max) };
    out.ftp = ftp; out.zones = zones;
    const steps = Array.isArray(doc.steps) ? doc.steps : [];
    if (!steps.length || !(doc.duration > 0)) { out.skip = 'nosteps'; out.durationS = +doc.duration || 0; return out; }
    if (!zones) out.issues.push({ code: 'nozones' });
    let t = 0;
    const walk = (list, depth) => {
      for (const s of list) {
        if (Array.isArray(s.steps) && s.steps.length) {
          const reps = Math.max(1, +s.reps || 1), t0 = t;
          for (let r = 0; r < reps; r++) walk(s.steps, depth + 1);
          if (s.duration != null && Math.abs((t - t0) - s.duration) > 0.5) out.issues.push({ code: 'repdur', at: t0, want: s.duration, got: t - t0 });
          continue;
        }
        const dur = +s.duration || 0;
        if (dur <= 0) { if (s.distance) out.issues.push({ code: 'distance', at: t }); continue; }
        const tg = target(s, ftp, zones || [], ss);
        if (tg.kind === 'unknown' || tg.kind === 'none') out.issues.push({ code: 'notarget', at: t, zone: tg.zone });
        out.steps.push({
          t0: t, dur, kind: tg.kind, a: tg.a ?? null, b: tg.b ?? null, lo: tg.lo ?? null, hi: tg.hi ?? null,
          zone: tg.zone ?? null, warmup: !!s.warmup, cooldown: !!s.cooldown,
          cadence: s.cadence && s.cadence.units === 'rpm' ? +s.cadence.value : null,
          label: typeof s.text === 'string' ? s.text : '', _power: s._power || null
        });
        t += dur;
      }
    };
    walk(steps, 0);
    out.durationS = t;
    if (Math.abs(t - doc.duration) > 0.5) out.issues.push({ code: 'totaldur', want: doc.duration, got: t });
    out.ok = true;
    return out;
  }

  /* cross-check our % FTP against Intervals.icu's resolved watts; returns the mismatches (> tolW) */
  function checkPower(parsed, tolW = 1) {
    const bad = [], f = parsed.ftp;
    if (!f) return bad;
    for (const s of parsed.steps) {
      const p = s._power; if (!p) continue;
      const w = x => x * f / 100;
      if (s.kind === 'pct' && p.value != null && Math.abs(w(s.a) - p.value) > tolW) bad.push({ t0: s.t0, want: p.value, got: w(s.a) });
      if (s.kind === 'ramp' && p.start != null && (Math.abs(w(s.a) - p.start) > tolW || Math.abs(w(s.b) - p.end) > tolW)) bad.push({ t0: s.t0, want: [p.start, p.end], got: [w(s.a), w(s.b)] });
      if ((s.kind === 'zone' || s.kind === 'sweetspot') && p.start != null) {
        // Intervals.icu starts a zone 1 W above the previous zone's top; the open top zone has no upper watt limit we use
        const loW = s.lo === 0 ? null : w(s.lo), hiW = w(s.hi);
        if ((loW != null && Math.abs(loW - p.start) > tolW + 1) || (s.hi !== s.lo && Math.abs(hiW - p.end) > tolW + 1)) bad.push({ t0: s.t0, want: [p.start, p.end], got: [loW, hiW] });
      }
    }
    return bad;
  }

  /* per-second intensity (% FTP); null where the step has no power target */
  function series(parsed) {
    const n = Math.round(parsed.durationS), arr = new Array(n).fill(null);
    for (const s of parsed.steps) {
      if (s.a == null) continue;
      for (let i = 0; i < s.dur; i++) {
        const k = Math.round(s.t0) + i; if (k >= n) break;
        arr[k] = s.dur > 1 ? s.a + (s.b - s.a) * (i / (s.dur - 1)) : s.a;
      }
    }
    return arr;
  }

  /* intensity metrics. hardPct = steps whose LOWER bound is above this % count as hard (rule TIME-03).
     NP method: 30-s rolling mean, 4th-power mean, 4th root (method choice, see evidence table METH-IF). */
  function metrics(parsed, opts = {}) {
    const zones = opts.zones || parsed.zones || [];
    const hardPct = opts.hardPct != null ? opts.hardPct : null;
    const sr = series(parsed), n = sr.length;
    let known = 0, sum = 0, max = 0;
    const tiz = new Array(zones.length).fill(0);
    for (const v of sr) {
      if (v == null) continue;
      known++; sum += v; if (v > max) max = v;
      let z = zones.findIndex(top => v <= top + 1e-9); if (z < 0) z = zones.length - 1;
      if (z >= 0) tiz[z]++;
    }
    // normalised % (30-s rolling average over known seconds)
    let acc = 0, cnt = 0; const win = []; let p4 = 0, n4 = 0;
    for (let i = 0; i < n; i++) {
      const v = sr[i] == null ? 0 : sr[i];
      win.push(v); acc += v; if (win.length > 30) acc -= win.shift();
      if (i >= 29) { const m = acc / 30; p4 += m ** 4; n4++; }
      cnt++;
    }
    const np = n4 ? Math.pow(p4 / n4, 0.25) : (known ? sum / known : null);
    let hardS = 0;
    if (hardPct != null) for (const s of parsed.steps) if (s.lo != null && s.lo > hardPct) hardS += s.dur;
    const ftp = opts.ftpW || parsed.ftp;
    const kJ = ftp && known ? sr.reduce((a, v) => a + (v == null ? 0 : v * ftp / 100), 0) / 1000 : null;
    return {
      durationS: n, knownS: known, avgPct: known ? sum / known : null, npPct: np, ifactor: np != null ? np / 100 : null,
      maxPct: max, tiz, hardS, kJ
    };
  }

  /* hard blocks as [{t0, t1}] in seconds: consecutive hard steps are merged, and so are hard steps separated by a short
     recovery (< mergeGapS, e.g. the 15 s in a 30/15 set), so a whole interval set counts as one block (rule TIME-03) */
  function hardBlocks(parsed, hardPct, mergeGapS = 0) {
    const out = [];
    for (const s of parsed.steps) {
      if (!(s.lo != null && s.lo > hardPct)) continue;
      const last = out[out.length - 1];
      if (last && s.t0 - last.t1 < Math.max(0.5, mergeGapS)) last.t1 = s.t0 + s.dur; else out.push({ t0: s.t0, t1: s.t0 + s.dur });
    }
    return out;
  }

  /* intensity (% FTP) at second t: the step's mid value */
  function at(parsed, t) {
    for (const s of parsed.steps) if (t >= s.t0 && t < s.t0 + s.dur) return { a: s.a, lo: s.lo, hi: s.hi };
    return null;
  }

  return { RIDE_TYPES, INDOOR_TYPES, parse, checkPower, series, metrics, hardBlocks, at, zoneRange };
});
