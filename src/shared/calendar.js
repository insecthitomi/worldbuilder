/* World calendars: custom months, weekdays, leap rules, eras, moons and seasons.
   A date is { day, min, prec }: day = absolute day number (day 0 = first day of absolute year 1, negative before),
   min = minutes into the day (only for prec 'time'), prec = 'year' | 'month' | 'day' | 'time'. */
(function (root, factory) {
  const api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  else root.WBCal = api;
})(typeof self !== 'undefined' ? self : this, function () {
  'use strict';
  const mod = (a, n) => ((a % n) + n) % n;
  const gcd = (a, b) => (b ? gcd(b, a % b) : Math.abs(a));
  const lcm = (a, b) => (a && b ? Math.abs(a * b) / gcd(a, b) : a || b);
  const PRECS = ['year', 'month', 'day', 'time'];

  const DEFAULT = {
    name: 'Common reckoning',
    months: [['January', 31], ['February', 28], ['March', 31], ['April', 30], ['May', 31], ['June', 30], ['July', 31], ['August', 31], ['September', 30], ['October', 31], ['November', 30], ['December', 31]].map(([name, days]) => ({ name, days })),
    weekdays: ['Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday', 'Sunday'],
    weekdayOffset: 0,
    leap: { every: 4, month: 1, days: 1, skipEvery: 100, keepEvery: 400 },
    eras: [{ name: 'Common Era', abbr: 'CE', start: 1 }],
    before: { name: 'Before Common Era', abbr: 'BCE' },
    hoursPerDay: 24, minutesPerHour: 60,
    moons: [{ name: 'Moon', cycle: 29.530588, offset: 5.6 }],
    seasons: [{ name: 'Spring', month: 2, day: 20 }, { name: 'Summer', month: 5, day: 21 }, { name: 'Autumn', month: 8, day: 22 }, { name: 'Winter', month: 11, day: 21 }],
  };

  function normalize(raw) {
    const c = Object.assign({}, DEFAULT, raw || {});
    c.months = (Array.isArray(c.months) && c.months.length ? c.months : DEFAULT.months)
      .map((m, i) => ({ name: String((m && m.name) || 'Month ' + (i + 1)), short: m && m.short ? String(m.short) : '', days: Math.max(1, Math.min(400, Math.round(+((m && m.days) || 30)))) }));
    c.weekdays = (Array.isArray(c.weekdays) ? c.weekdays : []).map(String).filter(Boolean);
    c.weekdayOffset = Math.round(+c.weekdayOffset || 0);
    const L = c.leap;
    c.leap = L && +L.every > 0 && +L.days ? {
      every: Math.round(+L.every), month: Math.max(0, Math.min(c.months.length - 1, Math.round(+L.month || 0))), days: Math.round(+L.days),
      skipEvery: +L.skipEvery > 0 ? Math.round(+L.skipEvery) : 0, keepEvery: +L.keepEvery > 0 ? Math.round(+L.keepEvery) : 0,
    } : null;
    c.eras = (Array.isArray(c.eras) ? c.eras : []).filter(e => e && Number.isFinite(+e.start))
      .map(e => ({ name: String(e.name || ''), abbr: String(e.abbr || ''), start: Math.round(+e.start) })).sort((a, b) => a.start - b.start);
    c.before = c.before && (c.before.abbr || c.before.name) ? { name: String(c.before.name || ''), abbr: String(c.before.abbr || '') } : null;
    c.hoursPerDay = Math.max(1, Math.round(+c.hoursPerDay || 24));
    c.minutesPerHour = Math.max(1, Math.round(+c.minutesPerHour || 60));
    c.moons = (Array.isArray(c.moons) ? c.moons : []).filter(m => m && +m.cycle > 0).map(m => ({ name: String(m.name || 'Moon'), cycle: +m.cycle, offset: +m.offset || 0, color: m.color || '' }));
    c.seasons = (Array.isArray(c.seasons) ? c.seasons : []).filter(s => s && s.name).map(s => ({ name: String(s.name), month: Math.max(0, Math.min(c.months.length - 1, Math.round(+s.month || 0))), day: Math.max(1, Math.round(+s.day || 1)) }))
      .sort((a, b) => a.month - b.month || a.day - b.day);
    return c;
  }

  const PHASES = [['New', '●'], ['Waxing crescent', '☽'], ['First quarter', '◐'], ['Waxing gibbous', '◑'], ['Full', '○'], ['Waning gibbous', '◒'], ['Last quarter', '◑'], ['Waning crescent', '☾']];

  function create(raw) {
    const c = normalize(raw);
    const L = c.leap;
    const base = c.months.reduce((s, m) => s + m.days, 0);
    const isLeap = y => !!L && mod(y, L.every) === 0 && !(L.skipEvery && mod(y, L.skipEvery) === 0 && !(L.keepEvery && mod(y, L.keepEvery) === 0));
    const yearLength = y => base + (isLeap(y) ? L.days : 0);
    const monthLength = (y, m) => c.months[m].days + (isLeap(y) && L && m === L.month ? L.days : 0);
    // the leap pattern repeats every P years; P years hold cycleDays days
    let P = 1;
    if (L) { P = lcm(L.every, L.skipEvery || 1); P = lcm(P, L.keepEvery || 1); if (P > 20000) P = L.every; }
    let cycleDays = 0;
    for (let y = 1; y <= P; y++) cycleDays += yearLength(y);
    const prefix = [0];   // prefix[i] = days in years 1..i of a cycle
    for (let i = 1; i <= P; i++) prefix[i] = prefix[i - 1] + yearLength(i);

    /** day number of the first day of absolute year y */
    function startOfYear(y) {
      const k = y - 1, cyc = Math.floor(k / P), rem = k - cyc * P;
      return cyc * cycleDays + prefix[rem];
    }
    /** absolute year and day-of-year (0-based) of a day number */
    function yearOf(day) {
      const cyc = Math.floor(day / cycleDays);
      let d = day - cyc * cycleDays, lo = 0, hi = P;
      while (lo < hi) { const mid = (lo + hi + 1) >> 1; if (prefix[mid] <= d) lo = mid; else hi = mid - 1; }
      return { y: 1 + cyc * P + lo, doy: d - prefix[lo] };
    }
    function ymd(day) {
      const { y, doy } = yearOf(Math.floor(day));
      let d = doy, m = 0;
      while (m < c.months.length - 1 && d >= monthLength(y, m)) { d -= monthLength(y, m); m++; }
      return { y, m, d: d + 1, doy };
    }
    function fromYmd(y, m = 0, d = 1) {
      y = Math.round(y); m = Math.max(0, Math.min(c.months.length - 1, Math.round(m)));
      d = Math.max(1, Math.min(monthLength(y, m), Math.round(d)));
      let day = startOfYear(y);
      for (let i = 0; i < m; i++) day += monthLength(y, i);
      return day + d - 1;
    }
    const minutesPerDay = c.hoursPerDay * c.minutesPerHour;

    /* ---- eras ---- */
    function eraOf(y) {
      let era = -1;
      for (let i = 0; i < c.eras.length; i++) if (c.eras[i].start <= y) era = i;
      if (era >= 0) return { index: era, year: y - c.eras[era].start + 1, abbr: c.eras[era].abbr, name: c.eras[era].name };
      if (c.eras.length) return { index: -1, year: c.eras[0].start - y, abbr: c.before ? c.before.abbr : '', name: c.before ? c.before.name : '' };
      return { index: null, year: y, abbr: '', name: '' };
    }
    /** display year + era index (-1 = before the first era) → absolute year */
    function absYear(disp, eraIndex) {
      if (eraIndex == null || !c.eras.length) return Math.round(disp);
      if (eraIndex === -1) return c.eras[0].start - Math.round(disp);
      const e = c.eras[Math.max(0, Math.min(c.eras.length - 1, eraIndex))];
      return e.start + Math.round(disp) - 1;
    }
    const yearText = y => { const e = eraOf(y); return e.abbr ? e.year + ' ' + e.abbr : String(e.year); };

    const pad = n => String(n).padStart(2, '0');
    function timeText(min) {
      if (min == null) return '';
      const h = Math.floor(min / c.minutesPerHour), mi = mod(min, c.minutesPerHour);
      return pad(h) + ':' + pad(mi);
    }
    const monthName = (m, short) => { const x = c.months[m]; return short ? (x.short || x.name.slice(0, 3)) : x.name; };

    /** style: 'long' (default) | 'short' | 'full' (with weekday) | 'numeric' */
    function format(date, style) {
      if (!date || !Number.isFinite(+date.day)) return '';
      const prec = PRECS.includes(date.prec) ? date.prec : 'day';
      const p = ymd(date.day), yt = yearText(p.y);
      if (prec === 'year') return yt;
      if (style === 'numeric') return (prec === 'month' ? '' : p.d + '/') + (p.m + 1) + '/' + yt + (prec === 'time' ? ' ' + timeText(date.min) : '');
      const mn = monthName(p.m, style === 'short');
      if (prec === 'month') return mn + ' ' + yt;
      let s = p.d + ' ' + mn + ' ' + yt;
      if (style === 'full' && c.weekdays.length) s = c.weekdays[weekday(date.day)] + ', ' + s;
      if (prec === 'time') s += ', ' + timeText(date.min || 0);
      return s;
    }
    function formatRange(a, b, style) {
      if (a && !b) return format(a, style) + ' –';
      if (!a && b) return '– ' + format(b, style);
      if (!a && !b) return '';
      if (a.prec === 'year' && b.prec === 'year') {
        const ea = eraOf(ymd(a.day).y), eb = eraOf(ymd(b.day).y);
        if (ea.index === eb.index) return ea.year === eb.year ? yearText(ymd(a.day).y) : ea.year + '–' + eb.year + (eb.abbr ? ' ' + eb.abbr : '');
      }
      return format(a, style) + ' – ' + format(b, style);
    }

    /** "1203", "1203 AT", "Frostmere 1203", "12 Frostmere 1203 AT", "12/3/1203", "12 Frost 1203, 14:05" */
    function parse(text, opts = {}) {
      let s = String(text || '').trim();
      if (!s) return null;
      let min = null;
      const tm = /(?:,|\s)\s*(\d{1,2}):(\d{2})\s*$/.exec(s);
      if (tm) { min = (+tm[1]) * c.minutesPerHour + (+tm[2]); s = s.slice(0, tm.index).trim(); }
      // era abbreviation or name at the end
      let eraIndex = opts.eraIndex != null ? opts.eraIndex : (c.eras.length ? c.eras.length - 1 : null);
      const low = s.toLowerCase();
      const cands = [];
      c.eras.forEach((e, i) => { if (e.abbr) cands.push([e.abbr, i]); if (e.name) cands.push([e.name, i]); });
      if (c.before) { if (c.before.abbr) cands.push([c.before.abbr, -1]); if (c.before.name) cands.push([c.before.name, -1]); }
      cands.sort((a, b) => b[0].length - a[0].length);
      for (const [label, i] of cands) {
        const l = label.toLowerCase();
        if (low.endsWith(' ' + l) || low === l) { eraIndex = i; s = s.slice(0, s.length - l.length).trim(); break; }
      }
      let negative = false;
      if (/^-\d/.test(s)) { negative = true; s = s.slice(1); }
      let y, m = null, d = null, prec;
      let mm;
      if ((mm = /^(\d+)\s*[\/.-]\s*(\d+)\s*[\/.-]\s*(\d+)$/.exec(s))) { d = +mm[1]; m = +mm[2] - 1; y = +mm[3]; prec = 'day'; }
      else if ((mm = /^(\d+)\s*[\/.-]\s*(\d+)$/.exec(s))) { m = +mm[1] - 1; y = +mm[2]; prec = 'month'; }
      else if ((mm = /^(\d+)$/.exec(s))) { y = +mm[1]; prec = 'year'; }
      else {
        const parts = s.split(/[\s,]+/).filter(Boolean);
        const yi = parts.length - 1;
        if (!/^\d+$/.test(parts[yi] || '')) return null;
        y = +parts[yi];
        const rest = parts.slice(0, yi);
        let dayNum = null, monthWord = null;
        for (const p of rest) { if (/^\d+(st|nd|rd|th)?$/i.test(p)) dayNum = parseInt(p, 10); else monthWord = (monthWord ? monthWord + ' ' : '') + p; }
        if (!monthWord) return null;
        const w = monthWord.toLowerCase();
        m = c.months.findIndex(x => x.name.toLowerCase() === w);
        if (m < 0) m = c.months.findIndex(x => (x.short || '').toLowerCase() === w);
        if (m < 0) m = c.months.findIndex(x => x.name.toLowerCase().startsWith(w) && w.length >= 3);
        if (m < 0) return null;
        d = dayNum; prec = dayNum ? 'day' : 'month';
      }
      if (m != null && (m < 0 || m >= c.months.length)) return null;
      const ay = negative ? -y + 1 : absYear(y, eraIndex);
      const day = fromYmd(ay, m || 0, d || 1);
      if (min != null) return { day, min: Math.max(0, Math.min(minutesPerDay - 1, min)), prec: 'time' };
      return { day, min: null, prec };
    }

    function weekday(day) { return c.weekdays.length ? mod(Math.floor(day) + c.weekdayOffset, c.weekdays.length) : 0; }
    function moons(day) {
      return c.moons.map(m => {
        const f = mod(day - m.offset, m.cycle) / m.cycle;
        const [name, icon] = PHASES[Math.round(f * 8) % 8];
        return { name: m.name, phase: f, phaseName: name, icon, full: Math.round(f * 8) % 8 === 4, color: m.color };
      });
    }
    function season(day) {
      if (!c.seasons.length) return null;
      const p = ymd(day);
      let s = c.seasons[c.seasons.length - 1];
      for (const x of c.seasons) if (x.month < p.m || (x.month === p.m && x.day <= p.d)) s = x;
      return s.name;
    }
    function age(birth, at) {
      if (!birth || !at) return null;
      const a = ymd(birth.day), b = ymd(at.day);
      let years = b.y - a.y;
      if (birth.prec !== 'year' && (b.m < a.m || (b.m === a.m && b.d < a.d))) years--;
      return years;
    }
    function add(date, { years = 0, months = 0, days = 0 } = {}) {
      if (!date) return null;
      const p = ymd(date.day);
      let y = p.y + Math.round(years), m = p.m + Math.round(months);
      y += Math.floor(m / c.months.length); m = mod(m, c.months.length);
      const d = Math.min(p.d, monthLength(y, m));
      return { day: fromYmd(y, m, d) + Math.round(days), min: date.min == null ? null : date.min, prec: date.prec };
    }
    const compare = (a, b) => (a.day - b.day) || ((a.min == null ? -1 : a.min) - (b.min == null ? -1 : b.min));
    const date = (y, m, d, prec, min) => ({ day: fromYmd(y, m == null ? 0 : m, d == null ? 1 : d), min: min == null ? null : min, prec: prec || (d != null ? 'day' : m != null ? 'month' : 'year') });
    /** editor parts: { eraIndex, year (display), month, day, hour, minute, prec } and back */
    function parts(dt) {
      const p = ymd(dt ? dt.day : 0), e = eraOf(p.y), min = dt && dt.min != null ? dt.min : 0;
      return { eraIndex: e.index, year: e.year, month: p.m, day: p.d, hour: Math.floor(min / c.minutesPerHour), minute: mod(min, c.minutesPerHour), prec: dt ? dt.prec : 'year' };
    }
    function fromParts(p) {
      const y = absYear(+p.year || 0, p.eraIndex);
      const prec = PRECS.includes(p.prec) ? p.prec : 'day';
      const m = prec === 'year' ? 0 : +p.month || 0, d = prec === 'year' || prec === 'month' ? 1 : +p.day || 1;
      return { day: fromYmd(y, m, d), min: prec === 'time' ? (+p.hour || 0) * c.minutesPerHour + (+p.minute || 0) : null, prec };
    }
    /** years per tick etc. for the timeline: average lengths */
    const avgYear = cycleDays / P;

    return {
      cal: c, isLeap, yearLength, monthLength, startOfYear, yearOf, ymd, fromYmd, eraOf, absYear, yearText, monthName,
      format, formatRange, parse, weekday, moons, season, age, add, compare, date, parts, fromParts, timeText,
      minutesPerDay, avgYear, avgMonth: avgYear / c.months.length, months: c.months, weekdays: c.weekdays,
    };
  }

  return { create, normalize, DEFAULT, PRECS };
});
