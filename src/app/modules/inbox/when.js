/* Quick-add parsing for tasks: real-world due dates in plain words ("tomorrow", "fri", "in 3 days", "nov 20",
   "next week", "someday") and priority marks ("!", "!!", "!!!", "p1"). Pure functions; used by the Inbox screen
   and the unit tests. */
(function (root, factory) {
  const api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  else root.WBWhen = api;
})(typeof self !== 'undefined' ? self : this, function () {
  'use strict';
  const DAYS = ['sunday', 'monday', 'tuesday', 'wednesday', 'thursday', 'friday', 'saturday'];
  const DAY_RE = 'mon(?:day)?|tue(?:s|sday)?|wed(?:s|nesday)?|thu(?:r|rs|rsday)?|fri(?:day)?|sat(?:urday)?|sun(?:day)?';
  const MONTHS = ['january', 'february', 'march', 'april', 'may', 'june', 'july', 'august', 'september', 'october', 'november', 'december'];
  const MON_RE = 'jan(?:uary)?|feb(?:ruary)?|mar(?:ch)?|apr(?:il)?|may|june?|july?|aug(?:ust)?|sep(?:t|tember)?|oct(?:ober)?|nov(?:ember)?|dec(?:ember)?';
  const NUMS = { a: 1, an: 1, one: 1, two: 2, three: 3, four: 4, five: 5, six: 6, seven: 7, eight: 8, nine: 9, ten: 10, couple: 2, few: 3 };

  const pad = n => String(n).padStart(2, '0');
  const iso = d => d.getFullYear() + '-' + pad(d.getMonth() + 1) + '-' + pad(d.getDate());
  const day0 = d => new Date(d.getFullYear(), d.getMonth(), d.getDate(), 12);
  const addDays = (d, n) => { const x = day0(d); x.setDate(x.getDate() + n); return x; };
  const fromIso = s => { const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(s || ''); return m ? new Date(+m[1], +m[2] - 1, +m[3], 12) : null; };
  const dayIndex = s => DAYS.findIndex(d => d.startsWith(s.slice(0, 3).toLowerCase()));
  const monthIndex = s => MONTHS.findIndex(m => m.startsWith(s.slice(0, 3).toLowerCase()));
  const diffDays = (a, b) => Math.round((day0(a) - day0(b)) / 864e5);

  /** the next date (after today, or today when `orToday`) that falls on weekday `wd` */
  function nextWeekday(today, wd, orToday) { let n = (wd - today.getDay() + 7) % 7; if (n === 0 && !orToday) n = 7; return addDays(today, n); }
  function addMonths(d, n) { const x = day0(d), dd = x.getDate(); x.setDate(1); x.setMonth(x.getMonth() + n); const last = new Date(x.getFullYear(), x.getMonth() + 1, 0).getDate(); x.setDate(Math.min(dd, last)); return x; }
  function monthDay(today, mi, dd, year) {
    if (!(dd >= 1 && dd <= 31)) return null;
    let y = year || today.getFullYear(), d = new Date(y, mi, dd, 12);
    if (d.getMonth() !== mi) return null;
    if (!year && diffDays(d, today) < 0) d = new Date(y + 1, mi, dd, 12);
    return d;
  }
  const count = s => (/^\d+$/.test(s) ? +s : NUMS[String(s).toLowerCase()] || null);

  /* rules: [regex, (match, today) → Date | 'someday' | null]; the earliest-listed rule that matches wins */
  const RULES = [
    [/\b(\d{4})-(\d{2})-(\d{2})\b/, m => fromIso(m[0])],
    [/\b(?:no date|someday|some day|whenever|eventually)\b/i, () => 'someday'],
    [/\bday after tomorrow\b/i, (m, t) => addDays(t, 2)],
    [/\b(?:today|tonight|tod)\b/i, (m, t) => day0(t)],
    [/\b(?:tomorrow|tmrw?|tomorow)\b/i, (m, t) => addDays(t, 1)],
    [/\byesterday\b/i, (m, t) => addDays(t, -1)],
    [/\bin\s+(\d+|an?|one|two|three|four|five|six|seven|eight|nine|ten|a couple of|a few)\s+(day|week|month|year)s?\b/i, (m, t) => {
      const n = count(m[1].replace(/^a (couple|few) of$/i, '$1')), u = m[2].toLowerCase();
      if (!n) return null;
      return u === 'day' ? addDays(t, n) : u === 'week' ? addDays(t, n * 7) : u === 'month' ? addMonths(t, n) : addMonths(t, n * 12);
    }],
    [/(?:^|\s)\+(\d{1,3})(d|w|m)\b/i, (m, t) => { const n = +m[1], u = m[2].toLowerCase(); return u === 'd' ? addDays(t, n) : u === 'w' ? addDays(t, n * 7) : addMonths(t, n); }],
    [/\bnext\s+week\b/i, (m, t) => nextWeekday(t, 1)],
    [/\bnext\s+month\b/i, (m, t) => { const x = addMonths(t, 1); x.setDate(1); return x; }],
    [/\bnext\s+year\b/i, (m, t) => new Date(t.getFullYear() + 1, 0, 1, 12)],
    [/\b(?:this\s+)?weekend\b/i, (m, t) => nextWeekday(t, 6, true)],
    [/\b(?:end of (?:the )?week|eow)\b/i, (m, t) => nextWeekday(t, 5, true)],
    [/\b(?:end of (?:the )?month|eom)\b/i, (m, t) => new Date(t.getFullYear(), t.getMonth() + 1, 0, 12)],
    [new RegExp('\\b((?:this|next|on|coming|by|due|until)\\s+)?(' + DAY_RE + ')\\b', 'i'), (m, t, s) => {
      const wd = dayIndex(m[2]);
      if (wd < 0) return null;
      // "the sun", "I sat", "wed" are ordinary words: as bare short forms they count only at the very end
      if (/^(sun|sat|wed)$/i.test(m[2]) && !m[1] && s.slice(m.index + m[0].length).replace(/\s*(!{1,3}|![1-3]|p[1-3])?\s*$/i, '') !== '') return null;
      return nextWeekday(t, wd, false);
    }],
    [new RegExp('\\b(' + MON_RE + ')\\.?\\s+(\\d{1,2})(?:st|nd|rd|th)?(?:,?\\s+(\\d{4}))?\\b', 'i'), (m, t) => monthDay(t, monthIndex(m[1]), +m[2], m[3] ? +m[3] : null)],
    [new RegExp('\\b(\\d{1,2})(?:st|nd|rd|th)?(?:\\s+of)?\\s+(' + MON_RE + ')\\b\\.?(?:\\s+(\\d{4}))?', 'i'), (m, t) => monthDay(t, monthIndex(m[2]), +m[1], m[3] ? +m[3] : null)],
  ];
  const PRIO = [
    [/(?:^|\s)!!!(?=\s|$)/, 3], [/(?:^|\s)!!(?=\s|$)/, 2], [/(?:^|\s)!(?=\s|$)/, 1],
    [/(?:^|\s)!([1-3])(?=\s|$)/, m => +m[1]], [/(?:^|\s)p([1-3])(?=\s|$)/i, m => 4 - +m[1]],
  ];

  /**
   * parse("Map the flats by fri !!") → { title: 'Map the flats', due: '2026-11-13', priority: 2, someday: false, dateText: 'fri' }
   * today: a Date (defaults to now)
   */
  function parse(text, today) {
    today = day0(today || new Date());
    let s = ' ' + String(text || '') + ' ', due = null, someday = false, dateText = '', priority = 0;
    for (const [re, fn] of RULES) {
      const g = new RegExp(re.source, re.flags.replace('g', '') + 'g');
      let m = null, v = null;
      while ((m = g.exec(s))) { v = fn(m, today, s); if (v) break; if (!m[0]) g.lastIndex++; }
      if (!m || !v) continue;
      if (v === 'someday') someday = true; else due = iso(v);
      dateText = m[0].trim();
      // drop the phrase and a connector word right before it ("by", "on", "due", "for", "until")
      const start = m.index, end = m.index + m[0].length;
      const before = s.slice(0, start).replace(/\s(?:by|on|due|for|until|before|at)\s*$/i, ' ');
      s = before + ' ' + s.slice(end);
      break;
    }
    for (const [re, v] of PRIO) {
      const m = re.exec(s);
      if (!m) continue;
      priority = typeof v === 'function' ? v(m) : v;
      s = s.slice(0, m.index) + ' ' + s.slice(m.index + m[0].length);
      break;
    }
    const title = s.replace(/\s{2,}/g, ' ').trim().replace(/[\s,;:–—-]+$/, '').trim();
    return { title, due, priority, someday, dateText };
  }

  /** "Today", "Tomorrow", "Yesterday", "Fri", "Fri 13 Nov", "13 Nov 2027" */
  function describe(isoDay, today) {
    const d = fromIso(isoDay);
    if (!d) return '';
    today = day0(today || new Date());
    const n = diffDays(d, today);
    if (n === 0) return 'Today';
    if (n === 1) return 'Tomorrow';
    if (n === -1) return 'Yesterday';
    const wd = d.toLocaleDateString(undefined, { weekday: 'short' });
    if (n > 1 && n < 7) return wd;
    const same = d.getFullYear() === today.getFullYear();
    return wd + ' ' + d.toLocaleDateString(undefined, same ? { day: 'numeric', month: 'short' } : { day: 'numeric', month: 'short', year: 'numeric' });
  }
  /** overdue | today | upcoming | someday (no date) */
  function bucket(isoDay, today) {
    if (!isoDay) return 'someday';
    const n = diffDays(fromIso(isoDay), day0(today || new Date()));
    return n < 0 ? 'overdue' : n === 0 ? 'today' : 'upcoming';
  }

  return { parse, describe, bucket, iso, fromIso, addDays, addMonths, diffDays, nextWeekday };
});
