'use strict';
/* Chronicle history maths on a world calendar (an object from shared/calendar.js create()).
   Pure functions: no database, so they are easy to test. Days are absolute day numbers. */

const RANK = { year: 0, month: 1, day: 2, time: 3 };

/** a relation date has no precision of its own: the first day of a year reads as the year, the first of a month as the month */
function precOfDay(cal, day) {
  if (day == null) return 'day';
  const p = cal.ymd(day);
  if (p.doy === 0) return 'year';
  if (p.d === 1) return 'month';
  return 'day';
}
const dateOfDay = (cal, day) => (day == null ? null : { day, min: null, prec: precOfDay(cal, day) });

/** the day after the last day a date covers (a year-precision date covers its whole year) */
function endDay(cal, d) {
  if (!d) return null;
  const p = cal.ymd(d.day);
  if (d.prec === 'year') return cal.startOfYear(p.y + 1);
  if (d.prec === 'month') return cal.fromYmd(p.y, p.m, 1) + cal.monthLength(p.y, p.m);
  return d.day + 1;
}

/** whole years, months and days from day a to day b (b >= a) on the world calendar */
function durationParts(cal, a, b) {
  if (a == null || b == null) return null;
  const neg = b < a;
  if (neg) [a, b] = [b, a];
  const A = cal.ymd(a), B = cal.ymd(b);
  let years = B.y - A.y, months = B.m - A.m, days = B.d - A.d;
  const n = cal.months.length;
  if (days < 0) {
    months--;
    let py = B.y, pm = B.m - 1;
    if (pm < 0) { pm = n - 1; py--; }
    days += cal.monthLength(py, pm);
  }
  if (months < 0) { years--; months += n; }
  return { years, months, days, total: b - a, negative: neg };
}
/** "12 years", "3 years, 2 months", "14 days"; at most two units */
function durationText(cal, a, b, { short } = {}) {
  const p = durationParts(cal, a, b);
  if (!p) return '';
  const u = short ? [['y', 'y'], ['mo', 'mo'], ['d', 'd']] : [['year', 'years'], ['month', 'months'], ['day', 'days']];
  const parts = [];
  if (p.years) parts.push(p.years + (short ? '' : ' ') + (p.years === 1 ? u[0][0] : u[0][1]));
  if (p.months) parts.push(p.months + (short ? '' : ' ') + (p.months === 1 ? u[1][0] : u[1][1]));
  if (p.days && parts.length < 2 && !p.years) parts.push(p.days + (short ? '' : ' ') + (p.days === 1 ? u[2][0] : u[2][1]));
  if (!parts.length) return short ? '0d' : 'less than a day';
  return parts.slice(0, 2).join(short ? ' ' : ', ');
}

/**
 * reigns: [{ id, ruler, start: day|null, end: day|null, ... }] (any order)
 * → { reigns (sorted, with length, inferredEnd), gaps: [{ from, to, after, before, length }], overlaps: [...], undated: [...] }
 * A reign without an end that is followed by another one ends when the next begins (marked inferredEnd).
 */
function buildSuccession(cal, list, nowDay) {
  const dated = list.filter(r => r.start != null || r.end != null).map(r => Object.assign({}, r));
  const undated = list.filter(r => r.start == null && r.end == null);
  dated.sort((a, b) => ((a.start != null ? a.start : a.end) - (b.start != null ? b.start : b.end)) || ((a.end == null ? Infinity : a.end) - (b.end == null ? Infinity : b.end)));
  const gaps = [], overlaps = [];
  for (let i = 0; i < dated.length; i++) {
    const r = dated[i], next = dated[i + 1];
    if (r.end == null && next && next.start != null && (r.start == null || next.start > r.start)) { r.end = next.start; r.inferredEnd = true; }
    const until = r.end != null ? r.end : nowDay;
    r.ongoing = r.end == null;
    r.length = r.start != null && until != null && until >= r.start ? durationText(cal, r.start, until) : '';
    r.lengthDays = r.start != null && until != null ? Math.max(0, until - r.start) : null;
  }
  for (let i = 0; i + 1 < dated.length; i++) {
    const a = dated[i], b = dated[i + 1];
    if (a.end == null || b.start == null) continue;
    if (b.start > a.end + 1) gaps.push({ from: a.end, to: b.start, after: a.id, before: b.id, length: durationText(cal, a.end, b.start), days: b.start - a.end });
    else if (b.start < a.end) overlaps.push({ from: b.start, to: Math.min(a.end, b.end == null ? a.end : b.end), a: a.id, b: b.id, length: durationText(cal, b.start, Math.min(a.end, b.end == null ? a.end : b.end)) });
  }
  return { reigns: dated, gaps, overlaps, undated };
}

/** anniversaries of `day` (same month and day of month, any year) among entries with day-precise dates */
function anniversaries(cal, entries, day) {
  const at = cal.ymd(day), out = [];
  for (const e of entries) {
    for (const which of ['start', 'end']) {
      const d = e[which];
      if (!d || RANK[d.prec] < RANK.day) continue;
      const p = cal.ymd(d.day);
      if (p.m === at.m && p.d === at.d) out.push({ entry: e, which, date: d, years: at.y - p.y });
    }
  }
  return out.sort((a, b) => Math.abs(a.years) - Math.abs(b.years) || a.entry.title.localeCompare(b.entry.title));
}

/** entries of lifespan types alive on `day`, with their age (born on or before, not yet dead) */
function aliveAt(cal, entries, day) {
  const alive = [], born = [], died = [], unborn = [], dead = [];
  const at = { day, min: null, prec: 'day' };
  const yr = cal.ymd(day).y;
  for (const e of entries) {
    if (!e.start) continue;
    const s = e.start.day, end = e.end ? e.end.day : null;
    if (cal.ymd(s).y === yr) born.push(e);
    if (end != null && cal.ymd(end).y === yr) died.push(e);
    if (s > day) { unborn.push(e); continue; }
    if (end != null && end < day) { dead.push(Object.assign({}, e, { ageAtDeath: cal.age(e.start, e.end) })); continue; }
    alive.push(Object.assign({}, e, { age: cal.age(e.start, at) }));
  }
  alive.sort((a, b) => (b.age - a.age) || a.title.localeCompare(b.title));
  return { alive, born, died, unborn: unborn.length, dead: dead.length };
}

/** chronological order for annals records: by day, then time, then starts before ends */
const KIND_ORDER = { self: 0, child: 2, relation: 3, family: 4, event: 5, scene: 6, session: 7, border: 8 };
function sortRecords(recs) {
  return recs.sort((a, b) => (a.date.day - b.date.day)
    || ((a.date.min == null ? -1 : a.date.min) - (b.date.min == null ? -1 : b.date.min))
    || ((a.kind === 'self' && a.edge === 'end') - (b.kind === 'self' && b.edge === 'end'))
    || ((a.edge === 'end') - (b.edge === 'end'))
    || ((KIND_ORDER[a.kind] || 9) - (KIND_ORDER[b.kind] || 9))
    || String(a.other && a.other.title || '').localeCompare(String(b.other && b.other.title || '')));
}

/** regular expressions for relation names that mean "rules" (a realm's succession) */
const RULE_OUT = /^(rules|reigns over|governs|leader of|leads|heads|head of|chief of|lord of|lady of|king of|queen of|monarch of|ruler of|commands)$/i;
const RULE_IN = /^(ruled by|led by|governed by|headed by|reigned over by|commanded by)$/i;

module.exports = { precOfDay, dateOfDay, endDay, durationParts, durationText, buildSuccession, anniversaries, aliveAt, sortRecords, RULE_OUT, RULE_IN, RANK };
