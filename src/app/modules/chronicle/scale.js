/* Chronicle scale: positions, precision and axis ticks on a world calendar (an object from WBCal.create()).
   Times are absolute days as floats (a time of day is a fraction). Shared by the renderer and the unit tests. */
(function (root, factory) {
  const api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  else root.WBChronScale = api;
})(typeof self !== 'undefined' ? self : this, function () {
  'use strict';
  const RANK = { year: 0, month: 1, day: 2, time: 3 };
  const UNITS = ['year', 'month', 'day', 'time'];

  /** where a date begins (a time of day adds its fraction) */
  const startOf = (C, d) => d.day + (d.prec === 'time' && d.min != null ? d.min / C.minutesPerDay : 0);
  /** where a date ends: a year-precision date covers the whole year, a day the whole day, a time is an instant */
  function endOf(C, d) {
    if (d.prec === 'time') return startOf(C, d);
    const p = C.ymd(d.day);
    if (d.prec === 'year') return C.startOfYear(p.y + 1);
    if (d.prec === 'month') return C.fromYmd(p.y, p.m, 1) + C.monthLength(p.y, p.m);
    return d.day + 1;
  }
  /** start of the unit (year, month, day, hour) containing t */
  function floorTo(C, t, unit) {
    const day = Math.floor(t), p = C.ymd(day);
    if (unit === 'year') return C.startOfYear(p.y);
    if (unit === 'month') return C.fromYmd(p.y, p.m, 1);
    if (unit === 'day') return day;
    const hours = C.cal.hoursPerDay;
    return day + Math.floor((t - day) * hours) / hours;
  }
  /** start of the next unit after the one containing t */
  function nextOf(C, t, unit) {
    const day = Math.floor(t), p = C.ymd(day);
    if (unit === 'year') return C.startOfYear(p.y + 1);
    if (unit === 'month') return C.fromYmd(p.y, p.m, 1) + C.monthLength(p.y, p.m);
    if (unit === 'day') return day + 1;
    const hours = C.cal.hoursPerDay;
    return day + (Math.floor((t - day) * hours) + 1) / hours;
  }
  /** nearest unit boundary to t (drags snap to the precision of what is dragged) */
  function snap(C, t, unit) {
    const a = floorTo(C, t, unit), b = nextOf(C, t, unit);
    return t - a <= b - t ? a : b;
  }
  /** a date value at t with the given precision (floored, as a calendar reads it) */
  function dateAt(C, t, prec) {
    const day = Math.floor(t), p = C.ymd(day);
    if (prec === 'year') return { day: C.startOfYear(p.y), min: null, prec: 'year' };
    if (prec === 'month') return { day: C.fromYmd(p.y, p.m, 1), min: null, prec: 'month' };
    if (prec === 'time') {
      const mpd = C.minutesPerDay, step = Math.max(1, Math.round(C.cal.minutesPerHour / 4));
      let min = Math.round(((t - day) * mpd) / step) * step;
      if (min >= mpd) return { day: day + 1, min: 0, prec: 'time' };
      return { day, min, prec: 'time' };
    }
    return { day, min: null, prec: 'day' };
  }
  /** a date moved by n units of its own kind (years keep the day of the year, months the day of the month) */
  function moveDate(C, d, n, unit) {
    if (!d || !n) return d;
    if (unit === 'year') return C.add(d, { years: n });
    if (unit === 'month') return C.add(d, { months: n });
    if (unit === 'day') return Object.assign({}, d, { day: d.day + n });
    const mpd = C.minutesPerDay, m = d.day * mpd + (d.min || 0) + n;
    return { day: Math.floor(m / mpd), min: ((m % mpd) + mpd) % mpd, prec: 'time' };
  }
  /** the precision a click at this zoom means: hours, days, months or years */
  function precAt(C, pxPerDay) {
    if (pxPerDay / C.cal.hoursPerDay >= 30) return 'time';
    if (pxPerDay >= 12) return 'day';
    if (pxPerDay * C.avgMonth >= 22) return 'month';
    return 'year';
  }
  const finer = (a, b) => (RANK[a] >= RANK[b] ? a : b);

  /* ---------------- durations ---------------- */
  function durationParts(C, a, b) {
    if (a == null || b == null) return null;
    if (b < a) [a, b] = [b, a];
    const A = C.ymd(a), B = C.ymd(b), n = C.months.length;
    let years = B.y - A.y, months = B.m - A.m, days = B.d - A.d;
    if (days < 0) { months--; let py = B.y, pm = B.m - 1; if (pm < 0) { pm = n - 1; py--; } days += C.monthLength(py, pm); }
    if (months < 0) { years--; months += n; }
    return { years, months, days, total: b - a };
  }
  function durationText(C, a, b, { short } = {}) {
    const p = durationParts(C, a, b);
    if (!p) return '';
    const parts = [];
    const u = (v, one, many, s) => (short ? v + s : v + ' ' + (v === 1 ? one : many));
    if (p.years) parts.push(u(p.years, 'year', 'years', 'y'));
    if (p.months) parts.push(u(p.months, 'month', 'months', 'mo'));
    if (p.days && !p.years) parts.push(u(p.days, 'day', 'days', 'd'));
    if (!parts.length) return short ? '<1d' : 'less than a day';
    return parts.slice(0, 2).join(short ? ' ' : ', ');
  }

  /* ---------------- axis ticks ---------------- */
  const YEAR_STEPS = [1, 2, 5, 10, 20, 25, 50, 100, 200, 250, 500, 1000, 2000, 2500, 5000, 10000, 20000, 50000, 100000, 250000, 500000, 1000000];
  const nextYearStep = s => { const i = YEAR_STEPS.indexOf(s); for (let j = i + 1; j < YEAR_STEPS.length; j++) if (YEAR_STEPS[j] % s === 0 && YEAR_STEPS[j] >= s * 5) return YEAR_STEPS[j]; return s * 10; };
  const divisors = n => { const out = []; for (let i = 1; i <= n; i++) if (n % i === 0) out.push(i); return out; };

  /** absolute years in [y0, y1] whose display year in their era is a multiple of step (eras count from 1, "before" counts back) */
  function yearMarks(C, y0, y1, step, cap) {
    const out = [], eras = C.cal.eras;
    const push = y => { if (out.length < cap) out.push(y); };
    if (!eras.length) { for (let y = Math.ceil(y0 / step) * step; y <= y1; y += step) push(y); return out; }
    const first = eras[0].start;
    if (y0 < first) {
      const hi = Math.min(y1, first - 1), dHi = first - y0, dLo = first - hi;
      for (let d = Math.floor(dHi / step) * step; d >= Math.max(1, dLo); d -= step) push(first - d);
    }
    eras.forEach((e, i) => {
      const lo = Math.max(y0, e.start), hi = Math.min(y1, i + 1 < eras.length ? eras[i + 1].start - 1 : y1);
      if (lo > hi) return;
      const d0 = lo - e.start + 1, d1 = hi - e.start + 1;
      for (let d = Math.max(step, Math.ceil(d0 / step) * step); d <= d1; d += step) push(e.start + d - 1);
    });
    return out.sort((a, b) => a - b);
  }

  /**
   * ticks for the visible range [t0, t1] at pxPerDay
   * → { unit, step, minor: [{t, label}], major: [{t, label, era}], eras: [{t0, t1, name, abbr, index}] }
   */
  function ticks(C, t0, t1, pxPerDay, o = {}) {
    const min = Object.assign({ year: 64, month: 54, day: 24, hour: 46 }, o.min || {});
    const hpd = C.cal.hoursPerDay, mph = C.cal.minutesPerHour;
    const pxHour = pxPerDay / hpd, pxMonth = pxPerDay * C.avgMonth, pxYear = pxPerDay * C.avgYear;
    const minor = [], major = [], cap = 1500;
    const yA = C.ymd(Math.floor(t0)).y, yB = C.ymd(Math.ceil(t1)).y;
    let unit, step;

    const hourSteps = divisors(hpd).filter(s => s < hpd);
    const hs = hourSteps.find(s => pxHour * s >= min.hour);
    const maxMonth = Math.max.apply(null, C.months.map(m => m.days));
    const ds = [1, 2, 3, 5].filter(s => s < maxMonth).find(s => pxPerDay * s >= min.day);
    const monthSteps = divisors(C.months.length).filter(s => s < C.months.length);
    const ms = pxYear >= 180 && monthSteps.find(s => pxMonth * s >= min.month);

    if (hs) {
      unit = 'hour'; step = hs;
      for (let day = Math.floor(t0); day <= Math.ceil(t1) && minor.length < cap; day++) {
        major.push({ t: day, label: C.format({ day, prec: 'day' }, 'full') });
        for (let hr = step; hr < hpd; hr += step) { const t = day + hr / hpd; if (t >= t0 - 1 && t <= t1 + 1) minor.push({ t, label: C.timeText(hr * mph) }); }
      }
    } else if (ds) {
      unit = 'day'; step = ds;
      const wd = C.weekdays.length && step === 1 && pxPerDay >= 64;
      let m0 = floorTo(C, t0, 'month');
      for (let ms0 = m0; ms0 <= t1 && minor.length < cap; ms0 = nextOf(C, ms0, 'month')) {
        const p = C.ymd(ms0), len = C.monthLength(p.y, p.m);
        major.push({ t: ms0, label: C.monthName(p.m) + ' ' + C.yearText(p.y) });
        for (let d = 1 + step; d <= len; d += step) {
          if (len - d + 1 < step * .6 && step > 1) break;
          const t = ms0 + d - 1;
          if (t < t0 - 2 || t > t1 + 2) continue;
          minor.push({ t, label: wd ? C.weekdays[C.weekday(t)].slice(0, 2) + ' ' + d : String(d) });
        }
      }
    } else if (ms) {
      unit = 'month'; step = ms;
      const short = pxMonth * step < 92;
      for (let y = yA; y <= yB && minor.length < cap; y++) {
        major.push({ t: C.startOfYear(y), label: C.yearText(y) });
        for (let m = step; m < C.months.length; m += step) minor.push({ t: C.fromYmd(y, m, 1), label: C.monthName(m, short) });
      }
    } else {
      unit = 'year';
      step = YEAR_STEPS.find(s => pxYear * s >= min.year) || YEAR_STEPS[YEAR_STEPS.length - 1];
      const big = nextYearStep(step);
      const plain = step < 50;
      const eraStarts = new Set(C.cal.eras.map(e => e.start));
      for (const y of yearMarks(C, yA, yB, step, cap)) {
        const isMajor = eraStarts.has(y) || yearMarks(C, y, y, big, 1).length > 0;
        const e = C.eraOf(y);
        if (isMajor) major.push({ t: C.startOfYear(y), label: C.yearText(y), era: eraStarts.has(y) });
        else minor.push({ t: C.startOfYear(y), label: plain ? String(e.year) : C.yearText(y) });
      }
      for (const s of eraStarts) if (s >= yA && s <= yB && !major.find(m => m.t === C.startOfYear(s))) major.push({ t: C.startOfYear(s), label: C.yearText(s), era: true });
      major.sort((a, b) => a.t - b.t);
    }
    return { unit, step, minor, major, eras: erasIn(C, t0, t1) };
  }

  /** calendar eras overlapping [t0, t1] (the time before the first era is one more band) */
  function erasIn(C, t0, t1) {
    const eras = C.cal.eras, out = [];
    if (!eras.length) return out;
    const starts = eras.map(e => C.startOfYear(e.start));
    if (t0 < starts[0]) out.push({ t0: -Infinity, t1: starts[0], name: (C.cal.before && C.cal.before.name) || 'Before ' + eras[0].name, abbr: (C.cal.before && C.cal.before.abbr) || '', index: -1 });
    eras.forEach((e, i) => { const a = starts[i], b = i + 1 < eras.length ? starts[i + 1] : Infinity; if (b > t0 && a < t1) out.push({ t0: a, t1: b, name: e.name, abbr: e.abbr, index: i }); });
    return out.filter(e => e.t1 > t0 && e.t0 < t1);
  }

  return { RANK, UNITS, startOf, endOf, floorTo, nextOf, snap, dateAt, moveDate, precAt, finer, durationParts, durationText, ticks, erasIn, yearMarks };
});
