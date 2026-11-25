'use strict';
/* DynamFuel – fueling engine: targets per ride. Pure and deterministic: no DOM, no fetch, no Date.now.
   Every number carries the rule IDs it comes from (data/rules.json ⇄ docs/evidence-table.md) and a status:
   confirmed < coach < proposed < open (worst one wins). Output 'open' = the app shows "OPEN – to confirm".

   plan({ parsed, ctx, profile, rules }) -> targets
     parsed  : DFWorkout.parse(doc)
     ctx     : { goalTag, goalChoice, indoor, tempC, start 'HH:MM', rideYear, next8h, refillMin }
     profile : { birthYear, massKg, ftpW, gutCapGph, gutTrained, sweatRateLph, salty, caffeine, bedtime, bottleMl, cages } */
(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory(require('./workout.js'), require('./fmt.js'));
  else root.DFEngine = factory(root.DFWorkout, root.DFFmt);
})(typeof self !== 'undefined' ? self : this, function (W, F) {
  const VERSION = '0.1.0';
  const RANK = { confirmed: 0, coach: 1, proposed: 2, open: 3 };
  const GOALS = ['race', 'key', 'endurance', 'recovery'];

  function worst(rules, ids, extra) {
    let s = 'confirmed';
    for (const id of ids) { const st = rules[id] ? rules[id].status : 'open'; if (RANK[st] > RANK[s]) s = st; }
    if (extra && RANK[extra] > RANK[s]) s = extra;
    return s;
  }

  function plan({ parsed, ctx = {}, profile = {}, rules }) {
    const R = rules.rules, rnd = R['RND-01'];
    const zones = parsed.zones || [55, 70, 90, 105, 120, 150, 999];
    const hardPct = zones[R['INT-HARD-01'].zone - 1];
    const lowTop = zones[R['INT-LOW-01'].zone - 1];
    const m = W.metrics(parsed, { hardPct, ftpW: profile.ftpW || parsed.ftp, zones });
    const durMin = parsed.durationS / 60, hours = parsed.durationS / 3600;
    const mass = +profile.massKg || null;
    const warnings = [];
    if (!mass) warnings.push('nomass');

    /* ---- goal ---- */
    let goal, goalSrc;
    const tag = ctx.goalTag ? String(ctx.goalTag).toLowerCase() : null;
    if (tag && GOALS.includes(tag)) { goal = tag; goalSrc = 'tag'; }
    else if (ctx.goalChoice && GOALS.includes(ctx.goalChoice)) { goal = ctx.goalChoice; goalSrc = 'athlete'; }
    else { goal = m.hardS > 0 ? 'key' : 'endurance'; goalSrc = 'suggested'; }
    if (tag === 'trainlow') warnings.push('trainlow_unsupported');   // decision Q10: not used for now
    const lowInt = m.ifactor != null && m.ifactor <= lowTop / 100 + 1e-9 && m.hardS <= R['INT-LOW-01'].hardSMax;
    const intensity = { ifactor: m.ifactor, npPct: m.npPct, avgPct: m.avgPct, hardS: m.hardS, tiz: m.tiz, low: lowInt, hardPct, rules: ['METH-IF', 'INT-HARD-01', 'INT-LOW-01'] };

    /* ---- carbohydrate during ---- */
    const bandIds = ['CHO-DUR-01', 'CHO-DUR-02', 'CHO-DUR-03', 'CHO-DUR-04', 'CHO-DUR-05'];
    let bandId = bandIds.find(id => R[id].maxMin == null || durMin <= R[id].maxMin + 1e-9);
    // case 09 review I2: a race of 2 h 30 or longer gets the > 2,5 h band
    const raceFrom = R['CHO-DUR-05'].raceFromMin;
    if (goal === 'race' && raceFrom != null && durMin >= raceFrom - 1e-9) bandId = 'CHO-DUR-05';
    const band = R[bandId];
    let guide = band.byGoal ? band.byGoal[goal] : band.gph, lo = band.lo != null ? band.lo : 0, hi = band.hi != null ? band.hi : 0;
    const choRules = [bandId], why = [{ rule: bandId, key: 'cho_band', p: { min: Math.round(durMin), goal } }];
    let optional = false;
    const easy = R['CHO-EASY-01'];
    // Q7 only changes the 75 min–2 h band; up to 75 min the band itself already gives 0 g/h
    if (bandId === 'CHO-DUR-03' && durMin <= easy.maxMin && easy.goals.includes(goal) && lowInt) {
      guide = easy.gph; lo = easy.lo; hi = easy.hi; optional = true;
      choRules.push('CHO-EASY-01', 'INT-LOW-01', 'CHO-INT-01');
      why.push({ rule: 'CHO-EASY-01', key: 'cho_easy', p: { hi } });
    }
    const cs = R['CHO-SHORT-01'];                                          // cases 02–04 review H1: optional 30–60 g/h, athlete's choice
    if (cs && bandId === 'CHO-DUR-02' && cs.goals.includes(goal) && durMin >= cs.minMin - 1e-9 && durMin <= cs.maxMin + 1e-9) {
      guide = cs.gph; lo = cs.lo; hi = cs.hi; optional = true;
      choRules.push('CHO-SHORT-01');
      why.push({ rule: 'CHO-SHORT-01', key: 'cho_short_optional', p: { lo: cs.lo, hi: cs.hi } });
    }
    const capMax = profile.gutTrained ? R['CHO-CAP-02'].gutTrainedMaxGph : R['CHO-CAP-01'].guidelineMaxGph;
    const tol = profile.gutCapGph != null && profile.gutCapGph !== '' ? +profile.gutCapGph : null;
    if (band.mtcOnly && profile.gutTrained && tol != null && tol > R['CHO-CAP-01'].guidelineMaxGph) {
      guide = Math.min(tol, capMax); hi = guide; choRules.push('CHO-CAP-02');
      why.push({ rule: 'CHO-CAP-02', key: 'cho_gut_trained', p: { cap: guide } });
    }
    if (guide > R['CHO-CAP-01'].guidelineMaxGph && !choRules.includes('CHO-CAP-02')) { guide = R['CHO-CAP-01'].guidelineMaxGph; choRules.push('CHO-CAP-01'); }
    let target = guide, gutAdvice = false;
    if (tol == null) warnings.push('notolerance');
    else if (tol < guide) {
      target = tol; gutAdvice = true; choRules.push('CHO-GUT-01');
      why.push({ rule: 'CHO-GUT-01', key: 'cho_capped', p: { guide, tol } });
    }
    target = F.roundTo(target, rnd.choG);
    const capHi = tol != null ? Math.min(tol, capMax) : capMax;
    hi = Math.max(target, Math.min(F.roundTo(hi, rnd.choG), F.roundTo(capHi, rnd.choG)));
    lo = Math.min(F.roundTo(lo, rnd.choG), target);
    const mtcRequired = target > R['CHO-MTC-01'].glucoseOnlyMaxGph;
    if (mtcRequired) { choRules.push('CHO-MTC-01', 'CHO-MTC-02'); why.push({ rule: 'CHO-MTC-01', key: 'cho_mtc', p: { max: R['CHO-MTC-01'].glucoseOnlyMaxGph } }); }
    const rinse = !!band.rinse && m.hardS > 0;
    if (rinse) why.push({ rule: bandId, key: 'cho_rinse', p: {} });
    choRules.push('RND-01');
    const cho = {
      gph: target, lo, hi, guideline: F.roundTo(guide, rnd.choG), optional, mtcRequired, rinse, gutAdvice,
      totalG: F.roundTo(target * hours, rnd.choG), rules: choRules, why, status: worst(R, choRules, tol == null ? 'open' : null)
    };

    /* ---- fluid ---- */
    let fLph, fLo, fHi; const fRules = [];
    const sweat = profile.sweatRateLph != null && profile.sweatRateLph !== '' ? +profile.sweatRateLph : null;
    if (sweat != null && mass) {
      const allow = R['FLU-02'].maxLossPct / 100 * mass / Math.max(hours, 1e-9);
      fLph = Math.max(0, Math.min(sweat, sweat - allow)); fLo = fLph; fHi = sweat;
      fRules.push('FLU-04', 'FLU-02', 'FLU-03');
    } else {
      fLph = R['FLU-01'].defaultLph; fLo = R['FLU-01'].loLph; fHi = R['FLU-01'].hiLph;
      fRules.push('FLU-01', 'FLU-05');
      const h2 = R['HEAT-02'];                                             // case 07 review E1: hot day → 750 ml/h
      if (ctx.tempC != null && ctx.tempC !== '' && +ctx.tempC >= h2.hotC) { fLph = h2.lph; fRules.push('HEAT-02'); }
      // FLU-03: a known sweat rate is always the ceiling, also when FLU-04 cannot be used (no body mass) – review #1
      if (sweat != null) { fLph = Math.min(fLph, sweat); fLo = Math.min(fLo, sweat); fHi = Math.min(fHi, sweat); fRules.push('FLU-03'); }
    }
    if (ctx.indoor) fRules.push('FLU-06');
    // McCubbin 2020: with a temperature the app advises cool drinks; the sweat test is asked once (profile), not per ride (E1)
    if (ctx.tempC != null && ctx.tempC !== '') {
      if (!fRules.includes('FLU-05')) fRules.push('FLU-05');
      fRules.push('HEAT-01'); warnings.push('heat_cool_drinks');
      if (sweat == null && !profile.sweatTestPrompted) warnings.push('ask_sweat_test_once');
    }
    fRules.push('RND-01');
    const fluid = {
      mlph: F.roundTo(fLph * 1000, rnd.fluidMl), lo: F.roundTo(fLo * 1000, rnd.fluidMl), hi: F.roundTo(fHi * 1000, rnd.fluidMl),
      totalMl: F.roundTo(fLph * 1000 * hours, rnd.fluidMl), rules: fRules, status: worst(R, fRules)
    };

    /* ---- sodium ---- */
    const na1 = R['NA-01'], na2 = R['NA-02'];
    const high = profile.salty === na2.salty || (sweat != null && sweat > na2.sweatLph) || durMin > na2.minDurationMin;
    const mgPerL = high ? na1.hiMgPerL : na1.loMgPerL;
    const lph = fluid.mlph / 1000;
    let sodium;
    if (durMin <= R['NA-03'].maxMin + 1e-9) {                            // review R1: short ride, water only
      sodium = { mgph: 0, lo: 0, hi: 0, mgPerL: 0, high: false, none: true, rules: ['NA-03'], status: worst(R, ['NA-03']) };
    } else {
      const nRules = ['NA-01', 'NA-02', 'NA-03', ...fRules.filter(r => r !== 'RND-01'), 'RND-01'];
      sodium = {
        mgph: F.roundTo(lph * mgPerL, rnd.naMg), lo: F.roundTo(lph * na1.loMgPerL, rnd.naMg), hi: F.roundTo(lph * na1.hiMgPerL, rnd.naMg),
        mgPerL, high, rules: nRules, status: worst(R, nRules)
      };
    }

    /* ---- caffeine ---- */
    const cafRules = ['CAF-03', 'CAF-04', 'CAF-05'];
    let cafOff = null, cafOptional = false;
    const c3 = R['CAF-03'];
    const minor = profile.birthYear && ctx.rideYear ? (ctx.rideYear - profile.birthYear) <= R['CAF-04'].minAge : null;
    if ((profile.healthFlags || []).includes('pregnancy') && R['CAF-07']) { cafOff = 'pregnancy'; cafRules.push('CAF-07'); }   // EFSA 2015
    else if (minor == null) cafOff = 'noage';
    else if (minor) cafOff = 'minor';
    else if (profile.caffeine === 'none' || !profile.caffeine) cafOff = 'nouse';
    else if (!mass) cafOff = 'nomass';
    else if (c3.goals.includes(goal) || (goal === 'key' && c3.keyMinDurationMin != null && durMin > c3.keyMinDurationMin)) cafOff = null;
    else if (goal === 'key') cafOptional = true;                         // case 05 review D2: key session → optional
    else cafOff = 'goal';
    const doses = [];
    if (!cafOff) {
      const c1 = R['CAF-01'], c2 = R['CAF-02'];
      doses.push({ atMin: -c1.beforeMin, mg: F.roundTo(c1.mgkg * mass, rnd.cafMg), mgkg: c1.mgkg, rule: 'CAF-01' });
      cafRules.push('CAF-01');
      if (durMin > c2.minDurationMin) { doses.push({ atMin: Math.round(durMin * c2.atFraction), mg: F.roundTo(c2.mgkg * mass, rnd.cafMg), mgkg: c2.mgkg, rule: 'CAF-02' }); cafRules.push('CAF-02'); }
      const st = F.toMin(ctx.start), bed0 = F.toMin(profile.bedtime);
      // a bedtime before noon (e.g. 00:30) is after midnight: count it on the next day (review #3)
      const bed = bed0 != null && bed0 < 12 * 60 ? bed0 + 24 * 60 : bed0;
      if (st != null && bed != null) {
        cafRules.push('CAF-06');
        const cutoff = bed - R['CAF-06'].cutoffH * 60;                     // minutes after midnight of the ride day
        for (let i = doses.length - 1; i >= 0; i--) if (st + doses[i].atMin > cutoff) { doses[i].dropped = 'bedtime'; }
      } else warnings.push('caf_notime');
      // CAF-05 (EFSA 2015): every dose ≤ single maximum, the planned doses together ≤ daily maximum (rounded down to 25 mg)
      const c5 = R['CAF-05'], step = rnd.cafMg;
      let sum = 0;
      doses.filter(d => !d.dropped).forEach(d => {
        if (c5.singleMaxMg != null && d.mg > c5.singleMaxMg) { d.mg = Math.floor(c5.singleMaxMg / step) * step; d.capped = 'single'; }
        if (c5.dailyMaxMg != null && sum + d.mg > c5.dailyMaxMg) { d.mg = Math.max(0, Math.floor((c5.dailyMaxMg - sum) / step) * step); d.capped = 'daily'; }
        if (d.mg <= 0) d.dropped = 'daily';
        sum += d.mg;
      });
      doses.forEach(d => { if (st != null) d.clock = F.clock(st, d.atMin); });
    }
    cafRules.push('AGE-01', 'RND-01');
    const kept = doses.filter(d => !d.dropped);
    const caffeine = { on: !cafOff && !cafOptional, optional: cafOptional, off: cafOff, doses: kept, dropped: doses.filter(d => d.dropped),
      totalMg: kept.reduce((a, d) => a + d.mg, 0), dailyMaxMg: R['CAF-05'].dailyMaxMg, rules: cafRules, status: worst(R, cafRules) };

    /* ---- pre-ride ---- */
    const p1 = R['PRE-01'], p2 = R['PRE-02'], st = F.toMin(ctx.start);
    const normal = p1.normalGoals.includes(goal);                         // case 06 review C4: endurance/recovery = normal breakfast ~1 g/kg
    const gkg = normal ? [p1.normalGkg, p1.normalGkg] : [p1.loGkg, p1.hiGkg];
    const pre = {
      applies: durMin > p1.minDurationMin,                                 // ≤ 60 min: normal meal (Thomas 2016)
      kind: normal ? 'normal' : 'fuel',
      gkg, g: mass ? [F.roundTo(gkg[0] * mass, rnd.choG), F.roundTo(gkg[1] * mass, rnd.choG)] : null,
      hoursBefore: [p1.loH, p1.hiH], window: st != null ? [F.clock(st, -p1.hiH * 60), F.clock(st, -p1.loH * 60)] : null,
      fluidMl: mass ? [F.roundTo(p2.loMlkg * mass, rnd.fluidMl), F.roundTo(p2.hiMlkg * mass, rnd.fluidMl)] : null,
      fluidWindow: st != null ? [F.clock(st, -p2.hiH * 60), F.clock(st, -p2.loH * 60)] : null,
      rules: ['PRE-01', 'PRE-02', 'RND-01'], status: worst(R, ['PRE-01', 'PRE-02'])
    };

    /* ---- post-ride ---- */
    let post;
    if (ctx.next8h) {
      const r1 = R['REC-01'];
      post = { kind: 'rapid', choGph: mass ? [F.roundTo(r1.gkgh[0] * mass, rnd.choG), F.roundTo(r1.gkgh[1] * mass, rnd.choG)] : null, gkgh: r1.gkgh, hours: r1.hours,
        proteinG: mass ? F.roundTo(r1.proteinGkg * mass, rnd.choG) : null, proteinGkg: r1.proteinGkg, rules: ['REC-01', 'RND-01'], status: worst(R, ['REC-01']) };
    } else {
      const r2 = R['REC-02'];
      post = { kind: 'normal', proteinG: mass ? [F.roundTo(r2.proteinGkg[0] * mass, rnd.choG), F.roundTo(r2.proteinGkg[1] * mass, rnd.choG)] : null, proteinGkg: r2.proteinGkg,
        withinH: r2.withinH, rules: ['REC-02', 'RND-01'], status: worst(R, ['REC-02']) };
    }

    const r4 = R['REC-04'];                                                // case 01 review F1: short recovery ride → water only
    if (!ctx.next8h && r4.goals.includes(goal) && durMin <= r4.maxMin + 1e-9) {
      post = { kind: 'water', rules: ['REC-04'], status: worst(R, ['REC-04']) };
    }
    // REC-03 (always, case 06 review C5): 1,25–1,5 l per kg lost; exact amount only when the sweat rate is known
    const r3 = R['REC-03'];
    post.rehydratePerKgLost = [r3.lo, r3.hi];
    if (sweat != null) {
      const deficitL = Math.max(0, (sweat - fluid.mlph / 1000) * hours);
      post.rehydrateMl = [F.roundTo(deficitL * r3.lo * 1000, rnd.fluidMl), F.roundTo(deficitL * r3.hi * 1000, rnd.fluidMl)];
    }
    post.rules = post.rules.concat('REC-03');

    /* ---- energy (information only) ---- */
    const e = R['EE-01'];
    const energy = { kJ: m.kJ != null ? Math.round(m.kJ) : null,
      kcal: m.kJ != null ? [Math.round(m.kJ / (e.geHi * 4.184) / 10) * 10, Math.round(m.kJ / (e.geLo * 4.184) / 10) * 10] : null,
      rules: ['EE-01'], status: worst(R, ['EE-01']) };

    /* ---- intake slots (timing) ---- */
    const slots = makeSlots(parsed, R, zones, durMin, hardPct, cho.gph > 0 || fluid.mlph > 0);

    return { engine: VERSION, rulesVersion: rules.version, durationS: parsed.durationS, goal: { value: goal, source: goalSrc }, intensity, cho, fluid, sodium, caffeine, pre, post, energy, slots, warnings };
  }

  /* slots every TIME-02 min from TIME-01; moved out of hard blocks (TIME-03); 'easy' = solids allowed (TIME-04) */
  function makeSlots(parsed, R, zones, durMin, hardPct, any) {
    if (!any || durMin <= R['CHO-DUR-01'].maxMin) return [];
    const first = R['TIME-01'].firstMin, every = R['TIME-02'].everyMin, shift = R['TIME-03'].shiftMaxMin;
    // TIME-06 (case 09 review I3): a hard block longer than sustainedMin is a sustained effort – intake is allowed inside it
    // (gels/drink only: such slots are never 'easy', so TIME-04 keeps solids out)
    const sustainedMin = R['TIME-06'] ? R['TIME-06'].sustainedMin : Infinity;
    const all = W.hardBlocks(parsed, hardPct, R['TIME-03'].mergeGapS || 0).map(b => ({ a: b.t0 / 60, b: b.t1 / 60 }));
    const blocks = all.filter(b => b.b - b.a <= sustainedMin + 1e-9), long = all.filter(b => b.b - b.a > sustainedMin + 1e-9);
    const easyTop = zones[R['TIME-04'].zone - 1], margin = R['TIME-04'].marginMin;
    const inHard = t => blocks.find(b => t >= b.a && t < b.b);
    const out = [];
    let prev = -Infinity;
    for (let t = first; t < durMin - 5 + 1e-9; t += every) {
      let at = t, moved = false;
      const b = inHard(at);
      if (b) {
        const before = Math.floor(b.a) - 1;
        if (before > prev + 2 && at - before <= shift && !inHard(before)) at = before;
        else { at = Math.ceil(b.b) + 1; while (inHard(at)) at = Math.ceil(inHard(at).b) + 1; }
        moved = true;
      }
      if (at >= durMin) continue;
      if (out.length && at <= out[out.length - 1].min) continue;
      let easy = true;
      for (let s = Math.max(0, (at - margin) * 60); s < Math.min(parsed.durationS, (at + margin) * 60); s += 10) {
        const st = W.at(parsed, s); if (!st || st.a == null || st.a > easyTop + 1e-9) { easy = false; break; }
      }
      const now = W.at(parsed, at * 60);
      const easyNow = !!(now && now.a != null && now.a <= easyTop + 1e-9);   // the moment itself is easy (TIME-05)
      const sustained = long.some(b => at >= b.a && at < b.b);
      out.push({ min: at, moved, easy, easyNow, sustained, rules: ['TIME-01', 'TIME-02', 'TIME-03', 'TIME-04', 'TIME-05'].concat(sustained ? ['TIME-06'] : []) });
      prev = at;
    }
    return out;
  }

  return { VERSION, plan, worst, GOALS };
});
