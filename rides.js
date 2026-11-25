'use strict';
/* DynamFuel – rides: turns Intervals.icu events and the athlete record into rides the engine can use.
   Pure: no DOM, no fetch, no Date.now (today is passed in). Works in the browser (window.DFRides) and in Node.

   Field names were checked against a real events export (prep/intervals-sample/events.json, 24-11-2026):
   id, start_date_local, type, category, name, description, moving_time, icu_training_load, tags, indoor, carbs_per_hour,
   icu_ftp, external_id, workout_doc{steps, duration}. The athlete record has icu_weight and sportSettings[] (types, ftp,
   indoor_ftp, power_zones, sweet_spot_min, sweet_spot_max). The event's workout_doc has no sportSettings: the zones come
   from the athlete record. */
(function (root, factory) {
  const m = factory();
  if (typeof module === 'object' && module.exports) module.exports = m; else root.DFRides = m;
})(typeof self !== 'undefined' ? self : this, function () {
  const RIDE_TYPES = ['Ride', 'VirtualRide', 'GravelRide', 'MountainBikeRide'];
  const TAGS = ['race', 'key', 'endurance', 'recovery', 'trainlow'];
  // Intervals.icu's default power zones (upper bounds in % FTP); used only when the athlete record has none
  const DEFAULT_ZONES = [55, 75, 90, 105, 120, 150, 999];
  // ride without structured steps (brief: ask duration + session type): one step in this zone, so timing and intensity
  // follow the session type. The zones come from rules MAN-01..03 (endurance Z2 coach, recovery Z1 proposed, key/race OPEN);
  // this table is only the fallback when no rules are passed and must stay equal to them (a test checks it).
  const MANUAL_ZONE = { recovery: 1, endurance: 2, key: 4, race: 4 };

  const isRide = ev => !!ev && RIDE_TYPES.includes(ev.type) && (ev.category == null || ev.category === 'WORKOUT');

  function rideSettings(athlete) {
    const ss = athlete && Array.isArray(athlete.sportSettings) ? athlete.sportSettings : [];
    const s = ss.find(x => x && Array.isArray(x.types) && x.types.includes('Ride'));
    if (!s) return null;
    return { ftp: +s.ftp || null, indoorFtp: +s.indoor_ftp || null, zones: Array.isArray(s.power_zones) && s.power_zones.length ? s.power_zones.map(Number) : null,
      ssMin: s.sweet_spot_min != null ? +s.sweet_spot_min : null, ssMax: s.sweet_spot_max != null ? +s.sweet_spot_max : null };
  }

  /* only what DynamFuel needs from the athlete record – nothing else is stored */
  function athleteSummary(a, fetchedAt) {
    const r = rideSettings(a) || {};
    const w = +(a && (a.icu_weight || a.weight)) || null;
    return { weightKg: w, ftp: r.ftp || null, indoorFtp: r.indoorFtp || null, zones: r.zones || null, ssMin: r.ssMin ?? null, ssMax: r.ssMax ?? null, fetchedAt: fetchedAt || null };
  }

  const goalTag = tags => { const T = (Array.isArray(tags) ? tags : []).map(x => String(x).toLowerCase().trim()); return TAGS.find(g => T.includes(g)) || null; };

  function splitLocal(s) {
    const m = /^(\d{4}-\d{2}-\d{2})(?:T(\d{2}):(\d{2}))?/.exec(s || '');
    return m ? { date: m[1], time: m[2] ? `${m[2]}:${m[3]}` : null } : { date: null, time: null };
  }

  function eventToRide(ev) {
    const { date, time } = splitLocal(ev.start_date_local);
    const doc = ev.workout_doc || null, steps = doc && Array.isArray(doc.steps) ? doc.steps : [];
    const structured = steps.length > 0 && +doc.duration > 0;
    return {
      id: 'icu-' + ev.id, icuId: ev.id, source: 'icu', type: ev.type, name: String(ev.name || ''), description: String(ev.description || ''),
      date, time: time === '00:00' ? null : time,                     // planned events often have no time → ask (Q21)
      durationS: structured ? +doc.duration : (+ev.moving_time || null), load: ev.icu_training_load ?? null,
      tags: Array.isArray(ev.tags) ? ev.tags.map(String) : [], goalTag: goalTag(ev.tags),
      indoor: ev.type === 'VirtualRide' ? true : (typeof ev.indoor === 'boolean' ? ev.indoor : null),
      structured, steps: structured ? steps : null, carbsPerHour: ev.carbs_per_hour ?? null, icuFtp: ev.icu_ftp ?? null
    };
  }

  /* every event (rides and others, e.g. DynamCore sessions) as {start, end} in minutes, for the "next session < 8 h" check */
  const toMinutes = (date, time) => { const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(date || ''); if (!m) return null; const t = /^(\d{2}):(\d{2})$/.exec(time || '') || [0, 0, 0];
    return Date.UTC(+m[1], +m[2] - 1, +m[3]) / 60000 + (+t[1]) * 60 + (+t[2]); };
  function sessions(events) {
    return (events || []).map(ev => { const { date, time } = splitLocal(ev.start_date_local); const s = toMinutes(date, time);
      return s == null ? null : { id: ev.id, start: s, end: s + Math.round((+ev.moving_time || (ev.workout_doc && +ev.workout_doc.duration) || 0) / 60), untimed: !time || time === '00:00' }; }).filter(Boolean);
  }
  /* next8h: another planned session (with a start time) starts within 8 h after this ride ends (REC-01).
     Sessions without a time are ignored; the athlete can always change the answer on the ride screen. */
  function nextWithin(ride, start, events, hours = 8) {
    const s = toMinutes(ride.date, start || ride.time || '00:00'); if (s == null) return null;
    const end = s + Math.round((ride.durationS || 0) / 60);
    return sessions(events).some(x => x.id !== ride.icuId && !x.untimed && x.start > s && x.start - end <= hours * 60);
  }

  /* the workout document for DFWorkout.parse: the event's steps + the athlete's zones, or one step for a ride without steps */
  /* rules (optional): data/rules.json .rules – MAN-01..03 give the zone per session type and the rule (with its status) */
  function manualRule(goal, rules) {
    for (const id of ['MAN-01', 'MAN-02', 'MAN-03']) { const r = rules && rules[id]; if (r && r.zones && r.zones[goal] != null) return { id, zone: +r.zones[goal] }; }
    return { id: null, zone: MANUAL_ZONE[goal] || MANUAL_ZONE.endurance };
  }
  function workoutDoc(ride, ath, profile, goal, rules) {
    const zones = (ath && ath.zones) || DEFAULT_ZONES;
    const ftp = +(profile && profile.ftpW) || +ride.icuFtp || (ath && ath.ftp) || null;
    const sportSettings = { power_zones: zones, sweet_spot_min: ath && ath.ssMin != null ? ath.ssMin : 84, sweet_spot_max: ath && ath.ssMax != null ? ath.ssMax : 97, ftp };
    if (ride.structured && ride.steps) return { duration: ride.durationS, ftp, steps: ride.steps, sportSettings, manual: false };
    const m = manualRule(MANUAL_ZONE[goal] ? goal : 'endurance', rules), zone = m.zone;
    return { duration: ride.durationS, ftp, steps: [{ duration: ride.durationS, power: { value: zone, units: 'power_zone' } }], sportSettings, manual: true, manualZone: zone, manualRule: m.id };
  }

  /* ISO date helpers (local calendar dates as strings, no time zone maths) */
  function addDays(iso, n) { const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(iso); const d = new Date(Date.UTC(+m[1], +m[2] - 1, +m[3] + n)); return d.toISOString().slice(0, 10); }

  return { RIDE_TYPES, TAGS, DEFAULT_ZONES, MANUAL_ZONE, isRide, rideSettings, athleteSummary, goalTag, splitLocal, eventToRide, sessions, nextWithin, manualRule, workoutDoc, addDays, toMinutes };
});
