'use strict';
/* DynamFuel – matcher: turns the engine's targets into whole servings of in-stock products, an intake timeline and a pack list.
   Pure and deterministic (fixed tie-breakers, rule MATCH-02). No DOM, no fetch, no Date.now.

   match({ targets, items, stock, profile, ctx, rules }) -> plan
     targets : DFEngine.plan(...)
     items   : library items (data/library.json .items + the athlete's own items)
     stock   : [{ id, qty, fav }]   qty = servings in stock (gels, bars, drink doses, tabs)
   Item fields used: id, category (gel|bar|chew|drink|electrolyte|food), choG, mtc (true = glucose+fructose mix),
   sodiumMg, waterMl (drinks/electrolytes: label water per serving), powderG, allergens[], traces[], caffeineMg. */
(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory(require('./fmt.js'));
  else root.DFMatch = factory(root.DFFmt);
})(typeof self !== 'undefined' ? self : this, function (F) {
  const VERSION = '0.1.0';
  const SOLID = ['bar', 'food', 'chew'];

  function allowed(it, profile) {
    const al = profile.allergens || [];
    if (!al.length) return { ok: true };
    if (!Array.isArray(it.allergens)) return { ok: false, why: 'allergens_unknown' };
    if (it.allergens.some(a => al.includes(a))) return { ok: false, why: 'allergen' };
    if (profile.avoidTraces !== false && Array.isArray(it.traces) && it.traces.some(a => al.includes(a))) return { ok: false, why: 'traces' };
    // library text from web pages is never a complete declaration: only allergens listed as absent (free[]) are safe,
    // unless the athlete checked the pack (allergensComplete true on own/checked items)
    if (it.allergensComplete === false && al.some(a => !(it.free || []).includes(a))) return { ok: false, why: 'allergens_unknown' };
    return { ok: true };
  }

  function match({ targets: T, items, stock, profile = {}, ctx = {}, rules }) {
    const R = rules.rules, rnd = R['RND-01'], tolPct = R['MATCH-01'].choTolPct / 100, closePct = (R['MATCH-02'].closeTolPct != null ? R['MATCH-02'].closeTolPct : R['MATCH-01'].choTolPct) / 100, maxDistinct = R['MATCH-01'].maxDistinct;
    const hours = T.durationS / 3600, durMin = T.durationS / 60;
    const byId = new Map(items.map(i => [i.id, i]));
    const favs = new Set((stock || []).filter(s => s.fav).map(s => s.id));
    const notes = [];
    const avail = [];
    for (const s of stock || []) {
      const it = byId.get(s.id); if (!it || it.hidden || !(s.qty > 0)) continue;
      const a = allowed(it, profile);
      if (!a.ok) { notes.push({ key: 'excluded', p: { id: it.id, why: a.why } }); continue; }
      if (it.caffeineMg > 0) continue;                       // caffeinated products are planned with the caffeine doses (Phase 3)
      avail.push({ it, qty: Math.floor(s.qty) });
    }
    avail.sort((a, b) => a.it.id < b.it.id ? -1 : 1);

    /* ---- bottles ---- */
    const fluidTotal = T.fluid.mlph * hours;
    const bottleMl = +profile.bottleMl || null;
    if (!bottleMl && fluidTotal > 0) notes.push({ key: 'nobottle' });
    const nNeed = bottleMl && fluidTotal > 0 ? Math.ceil(fluidTotal / bottleMl - 1e-9) : 0;
    let capacity = Infinity, refills = 0;
    if (!ctx.indoor) {
      const cages = +profile.cages || 0;
      refills = ctx.refillMin ? Math.floor((durMin - 1) / ctx.refillMin) : 0;
      capacity = cages * (1 + refills);
    }
    const nBottles = Math.min(nNeed, capacity);
    const fluidGap = nNeed > capacity ? F.roundTo(fluidTotal - capacity * bottleMl, rnd.fluidMl) : 0;
    // ml actually drunk from bottle i (the last one may be partly drunk)
    const drunk = []; let left = Math.min(fluidTotal, nBottles * (bottleMl || 0));
    for (let i = 0; i < nBottles; i++) { const d = Math.min(bottleMl, left); drunk.push(d); left -= d; }

    // always the label concentration (case 06 review C6); a bottle that is not a whole number of label doses is rounded
    // down to 0,5 dose, so it is never stronger than the label
    const drinks = avail.filter(x => x.it.category === 'drink' && x.it.choG > 0 && x.it.waterMl > 0).map(a => {
      const doses = Math.floor(bottleMl / a.it.waterMl * 2 + 1e-9) / 2;
      return { ...a, doses, choPerMl: doses * a.it.choG / bottleMl, naPerMl: a.it.sodiumMg != null ? doses * a.it.sodiumMg / bottleMl : 0 };
    }).filter(d => d.doses > 0);
    const tabs = avail.filter(a => a.it.category === 'electrolyte' && a.it.sodiumMg > 0 && a.it.waterMl > 0).map(a => {
      const n = Math.floor(bottleMl / a.it.waterMl + 1e-9);
      return { ...a, perBottle: n, naPerMl: n * a.it.sodiumMg / bottleMl };
    }).filter(t => t.perBottle > 0);
    const solids = avail.filter(a => a.it.category !== 'drink' && a.it.category !== 'electrolyte' && a.it.choG > 0);

    /* ---- carbohydrate search ---- */
    const choT = T.cho.gph * hours, choLo = choT * (1 - tolPct), choHi = choT * (1 + tolPct);
    const capGph = profile.gutCapGph != null && profile.gutCapGph !== '' ? +profile.gutCapGph : R['CHO-CAP-01'].guidelineMaxGph;
    const capTotal = Math.max(choHi, Math.min(capGph, profile.gutTrained ? R['CHO-CAP-02'].gutTrainedMaxGph : R['CHO-CAP-01'].guidelineMaxGph) * hours);
    const gMax = R['CHO-MTC-01'].glucoseOnlyMaxGph * hours;
    let best = null;
    const consider = c => {
      const within = choT > 0 ? (c.cho >= choLo - 1e-9 && c.cho <= choHi + 1e-9) : c.cho === 0;
      const mtcOk = c.gOnly <= gMax + 1e-9;
      const fav = c.list.reduce((a, x) => a + (favs.has(x.id) ? x.n : 0), 0) + (c.drink && favs.has(c.drink.it.id) ? 1 : 0);
      const strong = c.drink && c.drink.choPerMl * 1000 > R['MATCH-03'].maxGperL + 1e-9 ? 1 : 0;   // review R3
      // within ± 10 %: plans within ± closeTolPct first (case 08 review I1), then fewest items (MATCH-02);
      // outside: closest to the target first, so a short stock still gives its best plan
      const dev = Math.abs(c.cho - choT);
      const close = within && dev <= choT * closePct + 1e-9 ? 0 : 1;
      // the strong-bottle preference only ranks plans that fit; outside ± 10 % the closest plan wins (else the empty plan would)
      const key = [mtcOk ? 0 : 1, within ? 0 : 1, within ? strong : 0, close, within ? c.count : dev, strong, c.list.length + (c.drink ? 1 : 0), -fav, dev, c.ids];
      c.within = within; c.mtcOk = mtcOk; c.key = key;
      if (!best || less(key, best.key)) best = c;
      if (c.drink && !c.list.length) { if (!bestDrink || less(key, bestDrink.key)) bestDrink = c; }   // MATCH-04: the athlete's choice
      else if (c.drink) { if (!bestMix || less(key, bestMix.key)) bestMix = c; }
      else if (!bestSolid || less(key, bestSolid.key)) bestSolid = c;
    };
    let bestDrink = null, bestMix = null, bestSolid = null;
    const drinkOptions = [{ drink: null, k: 0 }];
    // MATCH-05 (case 08 review I1): very concentrated bottles (> MATCH-03 g/l) at most half of the bottles (at least 1); the rest water
    const strongMax = Math.max(1, Math.floor(nBottles * (R['MATCH-05'] ? R['MATCH-05'].maxStrongShare : 1) + 1e-9));
    for (const d of drinks) {
      const isStrong = d.choPerMl * 1000 > R['MATCH-03'].maxGperL + 1e-9;
      for (let k = 1; k <= Math.min(nBottles, isStrong ? strongMax : nBottles, d.qty ? Math.floor(d.qty / d.doses) : 0); k++) drinkOptions.push({ drink: d, k });
    }
    for (const opt of drinkOptions) {
      if (choT <= 0 && opt.drink) continue;
      const ml = drunk.slice(0, opt.k).reduce((a, b) => a + b, 0);
      const dCho = opt.drink ? opt.drink.choPerMl * ml : 0;
      const dG = opt.drink && opt.drink.it.mtc !== true ? dCho : 0;
      const resHi = capTotal - dCho;   // search up to the athlete's gut tolerance; plans outside ± 10 % only win when nothing fits (closest first)
      if (choHi - dCho < -1e-9 && choT > 0) { consider({ drink: opt.drink, k: opt.k, ml, cho: dCho, gOnly: dG, list: [], count: opt.k, ids: idsKey(opt, []) }); if (resHi < -1e-9) continue; }
      // DFS over solids (sorted by id): at most maxDistinct types, total ≤ gut tolerance
      const pick = [];
      const dfs = (i, cho, gOnly, count) => {
        consider({ drink: opt.drink, k: opt.k, ml, cho: dCho + cho, gOnly: dG + gOnly, list: pick.map(p => ({ ...p })), count: opt.k + count, ids: idsKey(opt, pick) });
        if (choT <= 0 || pick.length >= maxDistinct) return;
        for (let j = i; j < solids.length; j++) {
          const s = solids[j], c = s.it.choG;
          const maxN = Math.min(s.qty, Math.floor((resHi - cho) / c + 1e-9));
          for (let n = 1; n <= maxN; n++) {
            pick.push({ id: s.it.id, n, cho: n * c });
            dfs(j + 1, cho + n * c, gOnly + (s.it.mtc === true ? 0 : n * c), count + n);
            pick.pop();
          }
        }
      };
      dfs(0, 0, 0, 0);
    }

    // case 07 review E3: show the drink + food plan first when it fits ± 10 % (and the glucose-only limit)
    if (bestMix && bestMix.within && bestMix.mtcOk) best = bestMix;
    // MATCH-04: the athlete picked one of the plans (ctx.planKind); a kind that has no plan with this stock keeps the default
    const picked = { drinkOnly: bestDrink, drinkAndFood: bestMix, withoutDrink: bestSolid }[ctx.planKind];
    if (picked) best = picked;

    /* ---- sodium: fill the other bottles with electrolyte tabs until the lower bound is met ---- */
    const bottles = [];
    let naTotal = 0, naUnknown = false;
    for (let i = 0; i < nBottles; i++) {
      if (best && best.drink && i < best.k) {
        const d = best.drink;
        bottles.push({ i, content: 'drink', id: d.it.id, doses: d.doses, gPerL: Math.round(d.choPerMl * 1000), veryConcentrated: d.choPerMl * 1000 > R['MATCH-03'].maxGperL + 1e-9, powderG: d.it.powderG != null ? +(d.doses * d.it.powderG).toFixed(1) : null, ml: bottleMl, drunkMl: drunk[i], choG: d.choPerMl * drunk[i], naMg: d.naPerMl * drunk[i] });
        if (d.it.sodiumMg == null) naUnknown = true;
      } else bottles.push({ i, content: 'water', ml: bottleMl, drunkMl: drunk[i], choG: 0, naMg: 0 });
    }
    for (const x of best ? best.list : []) { const it = byId.get(x.id); if (it.sodiumMg == null) naUnknown = true; else naTotal += x.n * it.sodiumMg; }
    naTotal += bottles.reduce((a, b) => a + b.naMg, 0);
    const naLo = T.sodium.lo * hours, naHi = T.sodium.hi * hours;
    const tabUse = {};
    if (tabs.length) {
      const tab = tabs[0];
      let tabLeft = tab.qty;
      for (const b of bottles) {
        if (naTotal >= naLo - 1e-9) break;
        if (b.content !== 'water' || tabLeft < tab.perBottle) continue;
        b.content = 'electrolyte'; b.id = tab.it.id; b.tabs = tab.perBottle; b.naMg = tab.naPerMl * b.drunkMl; b.choG = (tab.it.choG || 0) * tab.perBottle * b.drunkMl / bottleMl;
        naTotal += b.naMg; tabLeft -= tab.perBottle; tabUse[tab.it.id] = (tabUse[tab.it.id] || 0) + tab.perBottle;
      }
    }

    /* ---- totals and gaps ---- */
    const choTotal = (best ? best.cho : 0);
    const totals = {
      choG: F.roundTo(choTotal, rnd.choG), choGph: F.roundTo(choTotal / hours, rnd.choG), fluidMl: F.roundTo(drunk.reduce((a, b) => a + b, 0), rnd.fluidMl),
      naMg: F.roundTo(naTotal, rnd.naMg), naMgph: F.roundTo(naTotal / hours, rnd.naMg), naUnknown,
      glucoseOnlyGph: best ? F.roundTo(best.gOnly / hours, rnd.choG) : 0
    };
    const gaps = [];
    if (choT > 0 && (!best || !best.within)) gaps.push({ what: 'cho', shortG: F.roundTo(Math.max(0, choLo - choTotal), rnd.choG), overG: F.roundTo(Math.max(0, choTotal - choHi), rnd.choG) });
    if (best && !best.mtcOk) gaps.push({ what: 'mtc', glucoseOnlyGph: totals.glucoseOnlyGph, max: R['CHO-MTC-01'].glucoseOnlyMaxGph });
    if (naTotal < naLo - 1e-9 && nBottles > 0) gaps.push({ what: 'sodium', shortMg: F.roundTo(naLo - naTotal, rnd.naMg) });
    if (fluidGap > 0) gaps.push({ what: 'fluid', shortMl: fluidGap, refills });
    const shopping = suggest(gaps, items, avail, profile, rules, T, hours);

    /* ---- schedule ---- */
    const schedule = buildSchedule(T, best, byId, bottles, fluidTotal);

    /* ---- pack list ---- */
    const pack = [];
    for (const x of best ? best.list : []) pack.push({ id: x.id, n: x.n });
    const byContent = {};
    for (const b of bottles) { const k = `${b.content}|${b.id || ''}`; (byContent[k] = byContent[k] || { content: b.content, id: b.id || null, bottles: 0, doses: b.doses || null, tabs: b.tabs || null, powderG: b.powderG || null }).bottles++; }
    const atStart = ctx.indoor ? Infinity : (+profile.cages || 0);
    Object.values(byContent).forEach(v => pack.push({ bottle: true, ...v }));
    const refillBottles = Number.isFinite(atStart) ? Math.max(0, bottles.length - atStart) : 0;
    if (refillBottles) pack.push({ refill: true, bottles: refillBottles });

    // MATCH-04: the other options the athlete can pick (summaries; picking one re-runs the matcher with that choice)
    const summary = (c, kind) => c && choT > 0 ? { kind, within: c.within, mtcOk: c.mtcOk, choGph: F.roundTo(c.cho / hours, rnd.choG),
      drink: c.drink ? { id: c.drink.it.id, bottles: c.k, doses: c.drink.doses, gPerL: Math.round(c.drink.choPerMl * 1000) } : null,
      solids: c.list.map(x => ({ id: x.id, n: x.n })), chosen: c === best } : null;
    const alternatives = [summary(bestDrink, 'drinkOnly'), summary(bestMix, 'drinkAndFood'), summary(bestSolid, 'withoutDrink')].filter(Boolean);

    return {
      matcher: VERSION, within: !!(best && best.within), mtcOk: !best || best.mtcOk, alternatives,
      solids: best ? best.list.map(x => ({ id: x.id, n: x.n, choG: x.cho })) : [], bottles, bottleMl, totals, gaps, shopping, schedule, pack, notes,
      rules: ['MATCH-01', 'MATCH-02', 'CHO-MTC-01', 'RND-01']
    };
  }

  function idsKey(opt, pick) { return (opt.drink ? `${opt.drink.it.id}x${opt.k};` : '') + pick.map(p => `${p.id}x${p.n}`).join(';'); }
  /* lexicographic compare of score keys (numbers with a small tolerance, then the id string) */
  function less(a, b) {
    for (let i = 0; i < a.length; i++) {
      const x = a[i], y = b[i];
      if (typeof x === 'string') { if (x < y) return true; if (x > y) return false; continue; }
      if (x < y - 1e-9) return true;
      if (x > y + 1e-9) return false;
    }
    return false;
  }

  /* what to buy: library items not (enough) in stock, fewest servings first, then id */
  function suggest(gaps, items, avail, profile, rules, T, hours) {
    const out = [], have = new Set(avail.map(a => a.it.id));
    for (const g of gaps) {
      let cand = [];
      if (g.what === 'cho' && g.shortG > 0) cand = items.filter(i => !i.hidden && i.choG > 0 && i.category !== 'electrolyte' && !(i.caffeineMg > 0) && allowed(i, profile).ok && (!T.cho.mtcRequired || i.mtc === true))
        .map(i => ({ id: i.id, n: Math.ceil(g.shortG / (i.category === 'drink' ? i.choG : i.choG)), inStock: have.has(i.id) }));
      if (g.what === 'mtc') cand = items.filter(i => i.mtc === true && i.choG > 0 && !(i.caffeineMg > 0) && allowed(i, profile).ok).map(i => ({ id: i.id, n: null, inStock: have.has(i.id) }));
      if (g.what === 'sodium') cand = items.filter(i => i.category === 'electrolyte' && i.sodiumMg > 0 && allowed(i, profile).ok).map(i => ({ id: i.id, n: Math.ceil(g.shortMg / i.sodiumMg), inStock: have.has(i.id) }));
      cand.sort((a, b) => (a.n ?? 0) - (b.n ?? 0) || (a.id < b.id ? -1 : 1));
      if (cand.length) out.push({ for: g.what, items: cand.slice(0, 3) });
    }
    return out;
  }

  /* spread servings over the slots; solids only in easy slots (TIME-04); drink a share of fluid at every slot */
  function buildSchedule(T, best, byId, bottles, fluidTotal) {
    const slots = T.slots || [];
    if (!slots.length) return [];
    const sched = slots.map(s => ({ min: s.min, moved: s.moved, easy: s.easy, easyNow: s.easyNow, eat: [], drinkMl: 0 }));
    // fluid: equal share per slot, rounded to 50 ml, rest in the last slot
    const per = Math.floor(fluidTotal / slots.length / 50) * 50;
    sched.forEach(s => { s.drinkMl = per; });
    if (sched.length) sched[sched.length - 1].drinkMl += Math.max(0, Math.round((fluidTotal - per * slots.length) / 50) * 50);
    // servings: solids first in the queue, then gels/chews; deterministic order by id
    const servings = [];
    for (const x of best ? best.list : []) { const it = byId.get(x.id); for (let k = 0; k < x.n; k++) servings.push({ id: x.id, solid: SOLID.includes(it.category) && it.category !== 'chew', cho: it.choG }); }
    if (!servings.length) return sched;
    const S = servings.length, n = slots.length;
    // serving k at slot round(k·n/S): the first serving always goes in the first slot (TIME-01), the rest spread evenly (TIME-02)
    const targetIdx = servings.map((_, k) => Math.min(n - 1, Math.round(k * n / S)));
    const solidsQ = servings.filter(s => s.solid), otherQ = servings.filter(s => !s.solid);
    targetIdx.forEach((idx, k) => {
      const slot = sched[idx];
      let s = null;
      if (slot.easy && solidsQ.length) s = solidsQ.shift();
      else if (otherQ.length) s = otherQ.shift();
      else if (k === 0 && solidsQ.length && slot.easyNow) {   // TIME-05: first intake wins; only solids → last easy moment before the hard block
        s = solidsQ.shift(); slot.eat.push({ id: s.id, cho: s.cho, solid: true, beforeHard: true }); return;
      }
      else if (solidsQ.length) {               // only solids left and this slot is not easy: nearest easy slot after (else before)
        s = solidsQ.shift();
        const alt = sched.slice(idx).find(x => x.easy) || sched.slice(0, idx).reverse().find(x => x.easy);
        (alt || slot).eat.push({ id: s.id, cho: s.cho, solid: true, notEasy: !alt }); return;
      }
      if (s) slot.eat.push({ id: s.id, cho: s.cho, solid: s.solid });
    });
    return sched;
  }

  return { VERSION, match, allowed };
});
