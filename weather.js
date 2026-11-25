'use strict';
/* DynamFuel – forecast temperature from Open-Meteo (free, no key; data CC BY 4.0 "Weather data by Open-Meteo.com").
   Pure helpers (no fetch, no Date.now): the app does the network calls. Field names checked live on 25-11-2026:
   geocoding results[] { name, admin1, country, latitude, longitude }; forecast { timezone, hourly { time 'YYYY-MM-DDTHH:MM'
   (local time with timezone=auto), temperature_2m (°C) } }. The forecast reaches 16 days (today + 15).
   Decision P3-4: outdoor rides within 16 days use the HIGHEST forecast temperature during the ride hours. */
(function (root, factory) {
  const m = factory();
  if (typeof module === 'object' && module.exports) module.exports = m; else root.DFWeather = m;
})(typeof self !== 'undefined' ? self : this, function () {
  const DAYS = 16;
  const geoUrl = (name, lang) => `https://geocoding-api.open-meteo.com/v1/search?name=${encodeURIComponent(name)}&count=5&language=${lang === 'en' ? 'en' : 'nl'}&format=json`;
  const forecastUrl = (lat, lon, fromIso, toIso) =>
    `https://api.open-meteo.com/v1/forecast?latitude=${(+lat).toFixed(2)}&longitude=${(+lon).toFixed(2)}&hourly=temperature_2m&timezone=auto&start_date=${fromIso}&end_date=${toIso}`;
  /* only name and rounded coordinates are kept (a town, not a position) */
  const places = json => (json && Array.isArray(json.results) ? json.results : []).map(r => ({
    name: String(r.name || ''), region: [r.admin1, r.country].filter(Boolean).join(', '), lat: Math.round(r.latitude * 100) / 100, lon: Math.round(r.longitude * 100) / 100 }))
    .filter(p => p.name && isFinite(p.lat) && isFinite(p.lon));
  /* within the forecast window? dayDiff = ride date − today in days */
  const inRange = dayDiff => dayDiff >= 0 && dayDiff < DAYS;
  /* highest temperature in the hours the ride covers: from the hour of the start up to and including the hour of the end */
  function maxDuring(hourly, date, start, durationS) {
    if (!hourly || !Array.isArray(hourly.time) || !Array.isArray(hourly.temperature_2m)) return null;
    const m = /^(\d{2}):(\d{2})$/.exec(start || ''); if (!m || !date) return null;
    const s = (+m[1]) * 60 + (+m[2]), e = s + Math.max(0, Math.round((durationS || 0) / 60));
    let best = null;
    hourly.time.forEach((tm, i) => {
      const x = /^(\d{4}-\d{2}-\d{2})T(\d{2}):(\d{2})/.exec(tm); if (!x) return;
      const dayOff = Math.round((Date.parse(x[1] + 'T00:00:00Z') - Date.parse(date + 'T00:00:00Z')) / 86400000);
      const at = dayOff * 1440 + (+x[2]) * 60 + (+x[3]);
      const v = hourly.temperature_2m[i];
      if (at >= Math.floor(s / 60) * 60 && at <= e && v != null && isFinite(v)) best = best == null ? +v : Math.max(best, +v);
    });
    return best == null ? null : Math.round(best * 10) / 10;
  }
  return { DAYS, geoUrl, forecastUrl, places, inRange, maxDuring };
});
