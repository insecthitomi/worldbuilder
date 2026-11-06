'use strict';
/* Continuity & world-health rules. Pure functions over a snapshot of one world (see checks area → snapshot()):
   each rule returns issues { key, check, severity, title, detail, entryIds, refs, fixes }. Keys are stable, so an
   issue marked as intended stays quiet until what it is about changes. */
const T = require('../../shared/richtext');
const F = require('../../shared/fields');

const CHECKS = [
  { id: 'mention', label: 'Broken mentions', icon: '⛓', desc: 'Text that links to entries which were deleted or moved to the trash.' },
  { id: 'lifespan', label: 'Lifespans', icon: '⌛', desc: 'Someone takes part in an event or scene before they were born or after they died.' },
  { id: 'family', label: 'Parents & children', icon: '⚭', desc: 'Children born before a parent, very young parents, births long after a parent died.' },
  { id: 'place', label: 'Places & factions in time', icon: '⌂', desc: 'Events set in a place before it was founded or after it fell, or joined by a faction that no longer existed.' },
  { id: 'twoplaces', label: 'Two places at once', icon: '⇋', desc: 'The same character in two different places at the same time.' },
  { id: 'dates', label: 'Inverted dates', icon: '⇅', desc: 'An end that comes before its start, on entries and on dated relations.' },
  { id: 'ancestry', label: 'Ancestry loops', icon: '↻', desc: 'Parent links that go round in a circle: someone ends up as their own ancestor.' },
  { id: 'status', label: 'Status vs dates', icon: '☍', desc: 'A status field that disagrees with the dates (alive with a death date in the past, dead without one).' },
  { id: 'duplicate', label: 'Duplicates', icon: '⧉', desc: 'Entries of the same type with the same or nearly the same name.' },
  { id: 'required', label: 'Missing required fields', icon: '◌', desc: 'Fields the type marks as required are still empty.' },
  { id: 'stub', label: 'Stubs', icon: '▫', desc: 'Entries with nothing in them yet: no summary, text or fields.' },
  { id: 'orphan', label: 'Orphans', icon: '◦', desc: 'Entries that nothing links to and that link to nothing.' },
  { id: 'pin', label: 'Pins & cards', icon: '⌖', desc: 'Map pins and board cards that point at deleted entries.' },
  { id: 'media', label: 'Media', icon: '▣', desc: 'Missing files, pictures that no longer exist, and files nothing uses.' },
  { id: 'audience', label: 'Audience', icon: '◐', desc: 'Public entries that mention private ones: on the published site those mentions turn into plain text.' },
  { id: 'reveal', label: 'Early mentions', icon: '◔', desc: 'Public entries already name entries whose reveal date has not come yet.' },
];
const SEVERITY = { error: 0, warn: 1, info: 2 };

/* ---------------- small helpers ---------------- */
const lc = s => String(s || '').toLowerCase();
const q = s => '“' + s + '”';
/** a date as the earliest and latest day it can mean (a year-precision date covers the whole year) */
function span(cal, d) {
  if (!d || d.day == null) return null;
  if (d.prec === 'year') { const y = cal.yearOf(d.day).y; return [cal.startOfYear(y), cal.startOfYear(y + 1) - 1]; }
  if (d.prec === 'month') { const p = cal.ymd(d.day); return [cal.fromYmd(p.y, p.m, 1), cal.fromYmd(p.y, p.m, cal.monthLength(p.y, p.m))]; }
  return [d.day, d.day];
}
/** the days an entry covers: [earliest start, latest end] */
const cover = (cal, e) => { const a = span(cal, e.start), b = span(cal, e.end || e.start); return a && b ? [a[0], Math.max(a[1], b[1])] : null; };
const precise = d => d && (d.prec === 'day' || d.prec === 'time');

/** normalised title for duplicate finding: lower case, no accents, no punctuation, no leading article */
function normTitle(s) {
  return lc(s).normalize('NFKD').replace(/[̀-ͯ]/g, '').replace(/[’'`]/g, '').replace(/[^\p{L}\p{N}]+/gu, ' ').trim().replace(/^(the|a|an) /, '');
}
/** edit distance, giving up above max */
function distance(a, b, max) {
  if (Math.abs(a.length - b.length) > max) return max + 1;
  let prev = Array.from({ length: b.length + 1 }, (_, i) => i);
  for (let i = 1; i <= a.length; i++) {
    const cur = [i];
    let best = i;
    for (let j = 1; j <= b.length; j++) {
      cur[j] = Math.min(prev[j] + 1, cur[j - 1] + 1, prev[j - 1] + (a[i - 1] === b[j - 1] ? 0 : 1));
      if (cur[j] < best) best = cur[j];
    }
    if (best > max) return max + 1;
    prev = cur;
  }
  return prev[b.length];
}
/** names with the same number of words differ only by small slips in single words ("Reede"/"Reed"), not by a
    different first name ("Corwin Vey"/"Morwen Vey") */
function wordsAlike(a, b) {
  const wa = a.split(' '), wb = b.split(' ');
  if (wa.length !== wb.length) return true;
  for (let i = 0; i < wa.length; i++) {
    if (wa[i] === wb[i]) continue;
    const d = distance(wa[i], wb[i], 2), len = Math.min(wa[i].length, wb[i].length);
    if (d > (len >= 8 ? 2 : 1)) return false;
  }
  return true;
}
const ROMAN = /\b(i{1,3}|iv|v|vi{1,3}|ix|x)$/;
/** names in a numbered series ("Session 1" / "Session 2", "Book II" / "Book III") are not duplicates */
const numbered = (a, b) => {
  const da = a.replace(/\d+/g, '#'), db = b.replace(/\d+/g, '#');
  if (da === db && a !== b) return true;
  const ra = a.replace(ROMAN, '#'), rb = b.replace(ROMAN, '#');
  return ra === rb && ra.endsWith('#') && a !== b;
};

/* verbs for the labels types give their dates (Born/Died, Founded/Fell …) */
const VERB = { born: 'was born', died: 'died', founded: 'was founded', fell: 'fell', dissolved: 'was dissolved', made: 'was made', lost: 'was lost', began: 'began', ended: 'ended', built: 'was built', destroyed: 'was destroyed', created: 'was created', opened: 'opened', closed: 'closed', formed: 'formed', starts: 'starts', ends: 'ends' };
const verb = (label, fallback) => VERB[lc(label)] || (label ? 'has “' + label + '”' : fallback);

/* ---------------- the snapshot index ---------------- */
function index(s) {
  const byId = new Map(s.entries.map(e => [e.id, e]));
  const live = s.entries.filter(e => !e.deleted);
  const typeOf = e => (e && s.types.get(e.typeId)) || null;
  const keyOf = e => (typeOf(e) || {}).key || '';
  const isPerson = e => !!(typeOf(e) || {}).lifespan;
  const HAPPEN = new Set(['event', 'scene', 'session']);
  const isHappening = e => { const t = typeOf(e); return !!t && (HAPPEN.has(t.key) || (!t.builtin && !!t.dated && !t.lifespan && !t.pinnable)); };
  const EXIST = new Set(['place', 'faction']);
  const isExisting = e => { const t = typeOf(e); return !!t && !!t.dated && !t.lifespan && (EXIST.has(t.key) || (!t.builtin && !!t.pinnable)); };
  const fieldDef = (e, key) => ((typeOf(e) || {}).fields || []).find(d => d.key === key) || null;
  const out = new Map(), inn = new Map();
  for (const l of s.links) {
    if (!out.has(l.src)) out.set(l.src, []);
    if (!inn.has(l.dst)) inn.set(l.dst, []);
    out.get(l.src).push(l); inn.get(l.dst).push(l);
  }
  const fmt = d => (d ? s.cal.format(d) : '');
  const on = d => (d ? (d.prec === 'day' || d.prec === 'time' ? 'on ' : 'in ') + s.cal.format(d) : '');
  const fmtDay = day => s.cal.format({ day, prec: 'day' });
  const typeName = e => lc((typeOf(e) || {}).name || 'entry');
  const title = e => (e ? e.title || 'Untitled' : 'a deleted entry');
  const ref = e => ({ id: e.id, title: e.title, typeId: e.typeId, deleted: !!e.deleted });
  const children = new Map();
  for (const e of live) if (e.parentId) children.set(e.parentId, (children.get(e.parentId) || 0) + 1);
  return { on, children, byId, live, typeOf, keyOf, isPerson, isHappening, isExisting, fieldDef, out, inn, fmt, fmtDay, typeName, title, ref };
}

/* ---------------- the rules ---------------- */
const RULES = {};

RULES.mention = (s, X) => {
  const issues = [];
  for (const e of X.live) {
    if (!e.body || e.body.indexOf('wb-m') < 0) continue;
    for (const id of T.mentions(e.body)) {
      if (id === e.id) continue;
      const t = X.byId.get(id);
      if (t && !t.deleted) continue;
      const label = mentionLabel(e.body, id);
      if (t) {
        issues.push({
          key: 'mention:' + e.id + ':' + id, check: 'mention', severity: 'warn', entryIds: [e.id, id], refs: [X.ref(t)],
          title: q(e.title) + ' mentions ' + q(t.title) + ', which is in the trash',
          detail: 'The ' + X.typeName(e) + ' ' + q(e.title) + ' links to ' + q(t.title) + ' in its text, but that entry is in the trash. Readers see a struck-through name. Restore the entry, or keep the words and drop the link.',
          fixes: [{ kind: 'restore', entryId: id, label: 'Restore ' + q(t.title) }, { kind: 'unmention', entryId: e.id, targetId: id, label: 'Keep the words, drop the link' }],
        });
      } else {
        issues.push({
          key: 'mention:' + e.id + ':' + id, check: 'mention', severity: 'error', entryIds: [e.id], refs: [],
          title: q(e.title) + ' links to an entry that no longer exists' + (label ? ' (' + q(label) + ')' : ''),
          detail: 'Somewhere in the text of ' + q(e.title) + (label ? ', the words ' + q(label) + ' link' : ' a mention links') + ' to an entry that was deleted for good. Turn it back into plain words, or link it to another entry.',
          fixes: [{ kind: 'unmention', entryId: e.id, targetId: id, label: 'Turn into plain words' }, { kind: 'open', entryId: e.id, label: 'Open the text' }],
        });
      }
    }
  }
  return issues;
};
function mentionLabel(html, id) {
  let label = '';
  T.mapMentions(html, (mid, l) => { if (mid === id && !label) label = l; return null; });
  return label.trim();
}

/** every link between a happening and a person, the strongest kind per pair (field > relation > mention) */
function pairs(s, X, isA, isB) {
  const best = new Map();
  const rank = { field: 3, relation: 2, mention: 1 };
  for (const l of s.links) {
    let a = X.byId.get(l.src), b = X.byId.get(l.dst);
    if (!a || !b || a.deleted || b.deleted) continue;
    if (!(isA(a) && isB(b))) { if (isA(b) && isB(a)) { const t = a; a = b; b = t; } else continue; }
    if (l.kind === 'field') { const def = X.fieldDef(X.byId.get(l.src), l.key); if (def && def.secret) continue; }
    const k = a.id + '|' + b.id, cur = best.get(k);
    if (!cur || (rank[l.kind] || 0) > (rank[cur.kind] || 0)) best.set(k, { a, b, kind: l.kind, key: l.key, link: l });
  }
  return [...best.values()];
}

RULES.lifespan = (s, X) => {
  const issues = [];
  for (const { a: h, b: p, kind, key } of pairs(s, X, X.isHappening, X.isPerson)) {
    if (!h.start || (!p.start && !p.end)) continue;
    const hc = cover(s.cal, h), born = span(s.cal, p.start), died = span(s.cal, p.end);
    const t = X.typeOf(p), dl = (t && t.dated) || { start: 'Born', end: 'Died' };
    const role = kind === 'field' ? (X.fieldDef(h, key) || {}).label || 'a field' : kind === 'relation' ? 'a relation' : 'its text';
    const how = kind === 'field' ? 'lists ' + q(p.title) + ' under ' + q(role) : kind === 'relation' ? 'is related to ' + q(p.title) : 'mentions ' + q(p.title);
    const sev = kind === 'mention' ? 'info' : 'error';
    const soft = kind === 'mention' ? ' A mention can be a memory or a prophecy; if so, mark it as intended.' : '';
    const fixes = [];
    if (kind === 'field' && key) fixes.push({ kind: 'removeRef', entryId: h.id, field: key, targetId: p.id, label: 'Remove ' + q(p.title) + ' from ' + q(role) });
    fixes.push({ kind: 'setDate', entryId: h.id, which: 'start', label: 'Change the date of ' + q(h.title) });
    if (died && hc[0] > died[1]) {
      issues.push({
        key: 'lifespan:' + p.id + ':' + h.id + ':after', check: 'lifespan', severity: sev, entryIds: [p.id, h.id], refs: [],
        title: q(p.title) + ' appears in ' + q(h.title) + ' after ' + (lc(dl.end) === 'died' ? 'dying' : 'their ' + lc(dl.end || 'end')),
        detail: q(p.title) + ' ' + verb(dl.end, 'ended') + ' ' + X.on(p.end) + ', but the ' + X.typeName(h) + ' ' + q(h.title) + ' (' + X.fmt(h.start) + ') ' + how + '.' + soft,
        fixes: fixes.concat([{ kind: 'setDate', entryId: p.id, which: 'end', label: 'Change when ' + q(p.title) + ' ' + verb(dl.end, 'ended') }]),
        at: h.start.day,
      });
    } else if (born && hc[1] < born[0]) {
      issues.push({
        key: 'lifespan:' + p.id + ':' + h.id + ':before', check: 'lifespan', severity: sev, entryIds: [p.id, h.id], refs: [],
        title: q(p.title) + ' appears in ' + q(h.title) + ' before ' + (lc(dl.start) === 'born' ? 'being born' : 'their ' + lc(dl.start || 'start')),
        detail: q(p.title) + ' ' + verb(dl.start, 'began') + ' ' + X.on(p.start) + ', but the ' + X.typeName(h) + ' ' + q(h.title) + ' (' + X.fmt(h.start) + ') ' + how + '.' + soft,
        fixes: fixes.concat([{ kind: 'setDate', entryId: p.id, which: 'start', label: 'Change when ' + q(p.title) + ' ' + verb(dl.start, 'began') }]),
        at: h.start.day,
      });
    }
  }
  // dated relations (marriages, reigns, memberships) that start after a death or end before a birth
  for (const l of s.links) {
    if (l.kind !== 'relation' || (l.startDay == null && l.endDay == null)) continue;
    const a = X.byId.get(l.src), b = X.byId.get(l.dst);
    if (!a || !b || a.deleted || b.deleted) continue;
    const r = s.rels.get(l.relId) || { name: 'related to' };
    for (const p of [a, b]) {
      if (!X.isPerson(p)) continue;
      const other = p === a ? b : a, died = span(s.cal, p.end), born = span(s.cal, p.start);
      const rel = p === a ? r.name : r.inverse || r.name;
      if (died && l.startDay != null && l.startDay > died[1]) {
        issues.push({ key: 'lifespan:rel:' + l.id + ':' + p.id + ':after', check: 'lifespan', severity: 'warn', entryIds: [p.id, other.id], refs: [],
          title: q(p.title) + ' is “' + rel + '” ' + q(other.title) + ' from after their death',
          detail: 'The relation starts on ' + X.fmtDay(l.startDay) + ', but ' + q(p.title) + ' died ' + X.on(p.end) + '.', fixes: [{ kind: 'open', entryId: p.id, label: 'Open ' + q(p.title) }], at: l.startDay });
      } else if (born && l.endDay != null && l.endDay < born[0]) {
        issues.push({ key: 'lifespan:rel:' + l.id + ':' + p.id + ':before', check: 'lifespan', severity: 'warn', entryIds: [p.id, other.id], refs: [],
          title: q(p.title) + ' is “' + rel + '” ' + q(other.title) + ' only before being born',
          detail: 'The relation ends on ' + X.fmtDay(l.endDay) + ', but ' + q(p.title) + ' was born ' + X.on(p.start) + '.', fixes: [{ kind: 'open', entryId: p.id, label: 'Open ' + q(p.title) }], at: l.endDay });
      }
    }
  }
  return issues;
};

/** parent → child pairs from family relations (src is the parent of dst) */
function parentPairs(s, X) {
  const list = [];
  for (const l of s.links) {
    if (l.kind !== 'relation') continue;
    const r = s.rels.get(l.relId);
    if (!r || r.familyRole !== 'parent') continue;
    const p = X.byId.get(l.src), c = X.byId.get(l.dst);
    if (!p || !c || p.deleted || c.deleted) continue;
    list.push({ p, c, link: l, people: X.isPerson(p) && X.isPerson(c) });
  }
  return list;
}
RULES.family = (s, X) => {
  const issues = [], minAge = +((s.settings || {}).minParentAge) || 14;
  const year = s.cal.avgYear;
  for (const { p, c, people } of parentPairs(s, X)) {
    if (!people) continue;
    const pb = span(s.cal, p.start), cb = span(s.cal, c.start), pd = span(s.cal, p.end);
    if (!cb) continue;
    const base = 'family:' + p.id + ':' + c.id;
    if (pb && cb[1] < pb[0]) {
      issues.push({ key: base + ':older', check: 'family', severity: 'error', entryIds: [c.id, p.id], refs: [],
        title: q(c.title) + ' was born before their parent ' + q(p.title),
        detail: q(c.title) + ' was born ' + X.on(c.start) + ', but their parent ' + q(p.title) + ' was born ' + X.on(p.start) + '. One of the dates, or the direction of the relation, is wrong.',
        fixes: [{ kind: 'setDate', entryId: c.id, which: 'start', label: 'Change ' + q(c.title) + '’s birth' }, { kind: 'setDate', entryId: p.id, which: 'start', label: 'Change ' + q(p.title) + '’s birth' }], at: cb[0] });
      continue;
    }
    if (pb && (cb[1] - pb[0]) / year < minAge) {
      const age = s.cal.age(p.start, c.start);
      issues.push({ key: base + ':young', check: 'family', severity: 'warn', entryIds: [p.id, c.id], refs: [],
        title: q(p.title) + ' was only ' + (age == null ? 'a child' : age) + ' when ' + q(c.title) + ' was born',
        detail: q(p.title) + ' (born ' + X.fmt(p.start) + ') is listed as a parent of ' + q(c.title) + ' (born ' + X.fmt(c.start) + '). That is younger than ' + minAge + ', the youngest parent age set for these checks.',
        fixes: [{ kind: 'setDate', entryId: p.id, which: 'start', label: 'Change ' + q(p.title) + '’s birth' }, { kind: 'setDate', entryId: c.id, which: 'start', label: 'Change ' + q(c.title) + '’s birth' }], at: cb[0] });
    }
    if (pd && cb[0] - pd[1] > year) {
      const yrs = Math.floor((cb[0] - pd[1]) / year);
      issues.push({ key: base + ':posthumous', check: 'family', severity: 'warn', entryIds: [c.id, p.id], refs: [],
        title: q(c.title) + ' was born ' + (yrs <= 1 ? 'over a year' : yrs + ' years') + ' after ' + q(p.title) + ' died',
        detail: q(p.title) + ' died ' + X.on(p.end) + ', but their child ' + q(c.title) + ' was born ' + X.on(c.start) + '.',
        fixes: [{ kind: 'setDate', entryId: p.id, which: 'end', label: 'Change ' + q(p.title) + '’s death' }, { kind: 'setDate', entryId: c.id, which: 'start', label: 'Change ' + q(c.title) + '’s birth' }], at: cb[0] });
    }
  }
  return issues;
};

RULES.place = (s, X) => {
  const issues = [];
  for (const l of s.links) {
    if (l.kind !== 'field') continue;
    const h = X.byId.get(l.src), p = X.byId.get(l.dst);
    if (!h || !p || h.deleted || p.deleted || !h.start || !X.isHappening(h) || !X.isExisting(p)) continue;
    const def = X.fieldDef(h, l.key) || { label: l.key };
    if (def.secret) continue;
    const hc = cover(s.cal, h), from = span(s.cal, p.start), until = span(s.cal, p.end);
    const t = X.typeOf(p), dl = t.dated || {};
    const isPlace = X.keyOf(p) === 'place' || lc(def.label).includes('where') || l.key === 'location';
    const how = isPlace ? 'is set in ' + q(p.title) : 'lists ' + q(p.title) + ' under ' + q(def.label);
    const fixes = [{ kind: 'setDate', entryId: h.id, which: 'start', label: 'Change the date of ' + q(h.title) }, { kind: 'removeRef', entryId: h.id, field: l.key, targetId: p.id, label: 'Remove ' + q(p.title) + ' from ' + q(def.label) }];
    if (until && hc[0] > until[1]) {
      issues.push({ key: 'place:' + h.id + ':' + p.id + ':after', check: 'place', severity: isPlace ? 'info' : 'warn', entryIds: [h.id, p.id], refs: [],
        title: q(h.title) + ' ' + (isPlace ? 'happens in' : 'involves') + ' ' + q(p.title) + ' after it ' + verb(dl.end, 'ended').replace(/^has /, 'had '),
        detail: 'The ' + X.typeName(h) + ' ' + q(h.title) + ' (' + X.fmt(h.start) + ') ' + how + ', but ' + q(p.title) + ' ' + verb(dl.end, 'ended') + ' ' + X.on(p.end) + '.' + (isPlace ? ' If it takes place in the ruins, mark it as intended.' : ''),
        fixes: fixes.concat([{ kind: 'setDate', entryId: p.id, which: 'end', label: 'Change when ' + q(p.title) + ' ' + verb(dl.end, 'ended') }]), at: h.start.day });
    } else if (from && hc[1] < from[0]) {
      issues.push({ key: 'place:' + h.id + ':' + p.id + ':before', check: 'place', severity: 'warn', entryIds: [h.id, p.id], refs: [],
        title: q(h.title) + ' ' + (isPlace ? 'happens in' : 'involves') + ' ' + q(p.title) + ' before it existed',
        detail: 'The ' + X.typeName(h) + ' ' + q(h.title) + ' (' + X.fmt(h.start) + ') ' + how + ', but ' + q(p.title) + ' ' + verb(dl.start, 'began') + ' ' + X.on(p.start) + '.',
        fixes: fixes.concat([{ kind: 'setDate', entryId: p.id, which: 'start', label: 'Change when ' + q(p.title) + ' ' + verb(dl.start, 'began') }]), at: h.start.day });
    }
  }
  return issues;
};

RULES.twoplaces = (s, X) => {
  const issues = [], mpd = s.cal.minutesPerDay;
  // happenings with a precise date, a short duration and a place
  const where = new Map(), who = new Map();
  for (const l of s.links) {
    if (l.kind !== 'field') continue;
    const h = X.byId.get(l.src), t = X.byId.get(l.dst);
    if (!h || !t || h.deleted || t.deleted || !X.isHappening(h) || !precise(h.start)) continue;
    if (X.keyOf(t) === 'place' && l.key === 'location') where.set(h.id, t);
    else if (X.isPerson(t)) { if (!who.has(t.id)) who.set(t.id, new Set()); who.get(t.id).add(h.id); }
  }
  const iv = h => {
    const timed = h.start.prec === 'time' && h.start.min != null;
    const lo = h.start.day * mpd + (timed ? h.start.min : 0);
    const e = h.end && h.end.day != null ? h.end : null;
    let hi;
    if (e) hi = e.prec === 'time' && e.min != null ? e.day * mpd + e.min : (e.day + 1) * mpd - 1;
    else hi = timed ? lo : (h.start.day + 1) * mpd - 1;
    return { lo, hi, timed: timed && (!e || e.prec === 'time'), days: [h.start.day, e ? e.day : h.start.day] };
  };
  const ancestors = id => { const set = new Set(); let p = X.byId.get(id), g = 0; while (p && g++ < 60) { set.add(p.id); p = p.parentId ? X.byId.get(p.parentId) : null; } return set; };
  const nested = (a, b) => ancestors(a.id).has(b.id) || ancestors(b.id).has(a.id);
  for (const [pid, hs] of who) {
    const p = X.byId.get(pid);
    const list = [...hs].map(id => X.byId.get(id)).filter(h => where.has(h.id)).map(h => Object.assign({ h, loc: where.get(h.id) }, iv(h)))
      .filter(x => x.days[1] - x.days[0] <= 3).sort((a, b) => a.lo - b.lo);
    for (let i = 0; i < list.length; i++) {
      for (let j = i + 1; j < list.length && list[j].lo <= list[i].hi; j++) {
        const A = list[i], B = list[j];
        if (A.loc.id === B.loc.id || nested(A.loc, B.loc)) continue;
        const bothTimed = A.timed && B.timed;
        const overlapDays = Math.min(A.days[1], B.days[1]) - Math.max(A.days[0], B.days[0]) + 1;
        if (!(bothTimed || overlapDays >= 2)) continue;
        const ids = [A.h.id, B.h.id].sort();
        issues.push({ key: 'twoplaces:' + pid + ':' + ids.join(':'), check: 'twoplaces', severity: 'warn', entryIds: [pid, A.h.id, B.h.id], refs: [],
          title: q(p.title) + ' is in ' + q(A.loc.title) + ' and ' + q(B.loc.title) + ' at the same time',
          detail: q(A.h.title) + ' (' + X.fmt(A.h.start) + ', in ' + q(A.loc.title) + ') and ' + q(B.h.title) + ' (' + X.fmt(B.h.start) + ', in ' + q(B.loc.title) + ') overlap, and ' + q(p.title) + ' takes part in both.',
          fixes: [{ kind: 'setDate', entryId: B.h.id, which: 'start', label: 'Change the date of ' + q(B.h.title) }, { kind: 'open', entryId: A.h.id, label: 'Open ' + q(A.h.title) }], at: A.h.start.day });
      }
    }
  }
  return issues;
};

RULES.dates = (s, X) => {
  const issues = [];
  for (const e of X.live) {
    if (!e.start || !e.end) continue;
    const bad = e.end.day < e.start.day || (e.end.day === e.start.day && e.start.prec === 'time' && e.end.prec === 'time' && (e.end.min || 0) < (e.start.min || 0));
    if (!bad) continue;
    const dl = (X.typeOf(e) || {}).dated || { start: 'Start', end: 'End' };
    issues.push({ key: 'dates:' + e.id, check: 'dates', severity: 'error', entryIds: [e.id], refs: [],
      title: q(e.title) + ' ends before it starts',
      detail: q(e.title) + ' has ' + (dl.start || 'Start') + ' ' + X.fmt(e.start) + ' but ' + (dl.end || 'End') + ' ' + X.fmt(e.end) + '. The two dates are probably the wrong way round.',
      fixes: [{ kind: 'swapDates', entryId: e.id, label: 'Swap the two dates' }, { kind: 'setDate', entryId: e.id, which: 'end', label: 'Change ' + (dl.end || 'the end') }], at: e.start.day });
  }
  for (const l of s.links) {
    if (l.kind !== 'relation' || l.startDay == null || l.endDay == null || l.endDay >= l.startDay) continue;
    const a = X.byId.get(l.src), b = X.byId.get(l.dst);
    if (!a || !b || a.deleted || b.deleted) continue;
    const r = s.rels.get(l.relId) || { name: 'related to' };
    issues.push({ key: 'dates:rel:' + l.id, check: 'dates', severity: 'warn', entryIds: [a.id, b.id], refs: [],
      title: 'The relation ' + q(a.title) + ' ' + r.name + ' ' + q(b.title) + ' ends before it starts',
      detail: 'It runs from ' + X.fmtDay(l.startDay) + ' to ' + X.fmtDay(l.endDay) + '.',
      fixes: [{ kind: 'swapLinkDates', linkId: l.id, label: 'Swap the two dates' }, { kind: 'open', entryId: a.id, label: 'Open ' + q(a.title) }], at: l.startDay });
  }
  return issues;
};

RULES.ancestry = (s, X) => {
  // strongly connected parts of the parent graph larger than one entry are loops
  const adj = new Map();
  for (const { p, c } of parentPairs(s, X)) { if (!adj.has(p.id)) adj.set(p.id, []); adj.get(p.id).push(c.id); }
  let n = 0;
  const idx = new Map(), low = new Map(), on = new Set(), stack = [], comps = [];
  const strong = v => {
    // iterative Tarjan
    const work = [[v, 0]];
    idx.set(v, n); low.set(v, n); n++; stack.push(v); on.add(v);
    while (work.length) {
      const top = work[work.length - 1], [u, i] = top, nb = adj.get(u) || [];
      if (i < nb.length) {
        top[1]++;
        const w = nb[i];
        if (!idx.has(w)) { idx.set(w, n); low.set(w, n); n++; stack.push(w); on.add(w); work.push([w, 0]); }
        else if (on.has(w)) low.set(u, Math.min(low.get(u), idx.get(w)));
      } else {
        work.pop();
        if (work.length) { const parent = work[work.length - 1][0]; low.set(parent, Math.min(low.get(parent), low.get(u))); }
        if (low.get(u) === idx.get(u)) {
          const comp = [];
          let w;
          do { w = stack.pop(); on.delete(w); comp.push(w); } while (w !== u);
          if (comp.length > 1) comps.push(comp);
        }
      }
    }
  };
  for (const v of adj.keys()) if (!idx.has(v)) strong(v);
  return comps.map(comp => {
    const ids = comp.slice().sort(), names = comp.map(id => q(X.byId.get(id).title));
    return { key: 'ancestry:' + ids.join(':'), check: 'ancestry', severity: 'error', entryIds: comp, refs: [],
      title: 'Ancestry loop: ' + names.slice(0, 3).join(', ') + (names.length > 3 ? ' and ' + (names.length - 3) + ' more' : ''),
      detail: 'Following “parent of” from ' + names[0] + ' leads back to ' + names[0] + ': someone is their own ancestor. One of these relations points the wrong way.',
      fixes: [{ kind: 'open', entryId: comp[0], label: 'Open ' + names[0] }] };
  });
};

RULES.status = (s, X) => {
  const issues = [], nowDay = s.now ? s.now.day : null;
  for (const e of X.live) {
    if (!X.isPerson(e)) continue;
    const def = X.fieldDef(e, 'status');
    if (!def || def.kind !== 'choice') continue;
    const v = lc(e.fields && e.fields.status);
    if (v === 'alive' && e.end && nowDay != null && span(s.cal, e.end)[1] < nowDay) {
      issues.push({ key: 'status:' + e.id + ':alive', check: 'status', severity: 'warn', entryIds: [e.id], refs: [],
        title: q(e.title) + ' is marked Alive but died ' + X.on(e.end),
        detail: 'The status field says Alive, but the death date has passed in the world’s present (' + X.fmt(s.now) + ').',
        fixes: [{ kind: 'setField', entryId: e.id, field: 'status', value: 'Dead', label: 'Set status to Dead' }, { kind: 'setDate', entryId: e.id, which: 'end', label: 'Change the death date' }] });
    } else if (v === 'dead' && !e.end) {
      issues.push({ key: 'status:' + e.id + ':dead', check: 'status', severity: 'info', entryIds: [e.id], refs: [],
        title: q(e.title) + ' is marked Dead but has no date of death',
        detail: 'Without a date, timelines, ages and the lifespan checks can’t tell when ' + q(e.title) + ' died.',
        fixes: [{ kind: 'setDate', entryId: e.id, which: 'end', label: 'Add a date of death' }] });
    } else if (v === 'alive' && e.start && nowDay != null && span(s.cal, e.start)[0] > nowDay) {
      issues.push({ key: 'status:' + e.id + ':unborn', check: 'status', severity: 'info', entryIds: [e.id], refs: [],
        title: q(e.title) + ' is marked Alive but is born in the future',
        detail: q(e.title) + ' is born ' + X.on(e.start) + ', after the world’s present (' + X.fmt(s.now) + ').',
        fixes: [{ kind: 'setDate', entryId: e.id, which: 'start', label: 'Change the birth date' }] });
    }
  }
  return issues;
};

RULES.duplicate = (s, X) => {
  const issues = [], seen = new Set();
  const byType = new Map();
  for (const e of X.live) {
    const n = normTitle(e.title);
    if (!n || /^untitled\b/.test(n)) continue;
    if (!byType.has(e.typeId)) byType.set(e.typeId, []);
    byType.get(e.typeId).push({ e, n });
  }
  const better = (a, b) => ((b.wordCount || 0) > (a.wordCount || 0) ? [b, a] : [a, b]);   // [keep, merge in]
  const add = (a, b, sev, why) => {
    const ids = [a.id, b.id].sort(), key = 'duplicate:' + ids.join(':');
    if (seen.has(key)) return;
    seen.add(key);
    const [keep, from] = better(a, b), tn = lc((X.typeOf(a) || {}).plural || 'entries');
    issues.push({ key, check: 'duplicate', severity: sev, entryIds: [keep.id, from.id], refs: [],
      title: why === 'same' ? 'Two ' + tn + ' called ' + q(a.title) : why === 'alias' ? q(a.title) + ' is also a name of ' + q(b.title) : q(a.title) + ' and ' + q(b.title) + ' are nearly the same name',
      detail: why === 'alias' ? q(b.title) + ' lists ' + q(a.title) + ' as an alias, and a separate ' + X.typeName(a) + ' has that name. If they are the same, merge them.'
        : 'If they are the same ' + X.typeName(a) + ', merge them: text, fields, tags and every link move into one, and the other name becomes an alias. If they are different, mark this as intended.',
      fixes: [{ kind: 'merge', into: keep.id, from: from.id, label: 'Merge ' + q(from.title) + ' into ' + q(keep.title) }, { kind: 'open', entryId: from.id, label: 'Open ' + q(from.title) }] });
  };
  for (const list of byType.values()) {
    const exact = new Map();
    for (const x of list) { if (!exact.has(x.n)) exact.set(x.n, []); exact.get(x.n).push(x); }
    for (const g of exact.values()) for (let i = 1; i < g.length; i++) add(g[0].e, g[i].e, 'warn', 'same');
    // nearly the same: compare within buckets sharing the first or the last three letters
    const buckets = new Map();
    for (const x of list) {
      if (x.n.length < 5) continue;
      for (const k of ['^' + x.n.slice(0, 3), '$' + x.n.slice(-3)]) { if (!buckets.has(k)) buckets.set(k, []); buckets.get(k).push(x); }
    }
    for (const b of buckets.values()) {
      if (b.length > 400) continue;
      for (let i = 0; i < b.length; i++) for (let j = i + 1; j < b.length; j++) {
        const A = b[i], B = b[j];
        if (A.n === B.n || numbered(A.n, B.n)) continue;
        const max = Math.min(A.n.length, B.n.length) >= 9 ? 2 : 1, d = distance(A.n, B.n, max);
        if (d <= max && wordsAlike(A.n, B.n)) add(A.e, B.e, d === 1 ? 'warn' : 'info', 'near');
      }
    }
    // a title that is another entry's alias
    const names = new Map(list.map(x => [x.n, x.e]));
    for (const x of list) for (const al of x.e.aliases || []) {
      const other = names.get(normTitle(al));
      if (other && other.id !== x.e.id) add(other, x.e, 'info', 'alias');
    }
  }
  return issues;
};

const NOT_CONTENT = new Set(['map', 'board', 'table', 'note', 'post', 'product', 'session', 'story', 'chapter', 'scene', 'encounter']);
const DATA_TYPES = new Set(['map', 'board', 'table', 'encounter']);
function isStub(X, e) {
  if (X.keyOf(e) && DATA_TYPES.has(X.keyOf(e))) return false;
  if ((e.summary || '').trim() || (e.wordCount || 0) >= 3 || e.coverId) return false;
  const t = X.typeOf(e);
  for (const d of (t && t.fields) || []) if (F.filled(d.kind, e.fields && e.fields[d.key])) return false;
  if ((X.inn.get(e.id) || []).some(l => l.kind === 'field' || l.kind === 'relation') || (X.out.get(e.id) || []).some(l => l.kind === 'relation')) return false;
  return !X.children.get(e.id);
}
RULES.stub = (s, X) => X.live.filter(e => !e.inbox && isStub(X, e)).map(e => ({
  key: 'stub:' + e.id, check: 'stub', severity: 'info', entryIds: [e.id], refs: [],
  title: q(e.title) + ' is still empty',
  detail: 'This ' + X.typeName(e) + ' has no summary, no text and no fields yet. Even one line helps it show up in hover cards and searches.',
  fixes: [{ kind: 'open', entryId: e.id, label: 'Write something' }],
}));

RULES.required = (s, X) => {
  const issues = [];
  for (const e of X.live) {
    const t = X.typeOf(e);
    const req = ((t && t.fields) || []).filter(d => d.required);
    if (!req.length || e.inbox || isStub(X, e)) continue;
    const missing = req.filter(d => !F.filled(d.kind, e.fields && e.fields[d.key]));
    if (!missing.length) continue;
    const names = missing.map(d => d.label);
    issues.push({ key: 'required:' + e.id + ':' + missing.map(d => d.key).sort().join(','), check: 'required', severity: 'info', entryIds: [e.id], refs: [],
      title: q(e.title) + ' is missing ' + names.map(n => q(n)).join(', '),
      detail: (t.plural || t.name) + ' should have ' + (names.length === 1 ? 'a ' + q(names[0]) : names.map(n => q(n)).join(' and ')) + '. ' + (missing[0].hint || 'Fill it in or make the field optional in the type.'),
      fixes: [{ kind: 'openField', entryId: e.id, field: missing[0].key, label: 'Fill in ' + q(names[0]) }] });
  }
  return issues;
};

RULES.orphan = (s, X) => {
  const issues = [], onCanvas = new Set();
  for (const m of (s.mapItems || []).concat(s.boardItems || [])) if (m.entryId) onCanvas.add(m.entryId);
  const parents = new Set(X.live.filter(e => e.parentId).map(e => e.parentId));
  for (const e of X.live) {
    if (e.parentId || e.inbox || parents.has(e.id) || onCanvas.has(e.id) || NOT_CONTENT.has(X.keyOf(e))) continue;
    if ((X.typeOf(e) || {}).lens) continue;
    const live = l => { const o = X.byId.get(l.src === e.id ? l.dst : l.src); return o && !o.deleted; };
    if ((X.out.get(e.id) || []).some(live) || (X.inn.get(e.id) || []).some(live)) continue;
    issues.push({ key: 'orphan:' + e.id, check: 'orphan', severity: 'info', entryIds: [e.id], refs: [],
      title: q(e.title) + ' isn’t connected to anything',
      detail: 'No other entry mentions or references this ' + X.typeName(e) + ', it has no relations, no parent and isn’t on a map or board. Link it where it belongs so it turns up in the web, family trees and the site.',
      fixes: [{ kind: 'open', entryId: e.id, label: 'Open and link it' }] });
  }
  return issues;
};

RULES.pin = (s, X) => {
  const issues = [];
  const one = (m, board) => {
    const host = X.byId.get(board ? m.boardId : m.mapId);
    if (host && host.deleted) return;   // the whole map or board is in the trash
    const sub = m.subMapId ? X.byId.get(m.subMapId) : null;
    if (sub && sub.deleted) {
      issues.push({ key: 'submap:' + m.id, check: 'pin', severity: 'warn', entryIds: host ? [host.id] : [], refs: [X.ref(sub)],
        title: 'A pin on ' + (host ? q(host.title) : 'a map') + ' opens ' + q(sub.title) + ', which is in the trash',
        detail: 'Clicking ' + (m.label ? 'the pin ' + q(m.label) : 'it') + ' should open the sub-map ' + q(sub.title) + ', but that map was moved to the trash.',
        fixes: [{ kind: 'restore', entryId: sub.id, label: 'Restore ' + q(sub.title) }].concat(host ? [{ kind: 'openMap', entryId: host.id, itemId: m.id, label: 'Open the map' }] : []), meta: { itemId: m.id } });
    }
    if (!m.entryId) return;
    const t = X.byId.get(m.entryId);
    if (t && !t.deleted) return;
    const what = board ? 'A card on the board' : 'A pin on the map', hostName = host ? ' ' + q(host.title) : '';
    const fixes = [];
    if (t) fixes.push({ kind: 'restore', entryId: t.id, label: 'Restore ' + q(t.title) });
    if (host) fixes.push({ kind: board ? 'openBoard' : 'openMap', entryId: host.id, itemId: m.id, label: board ? 'Open the board' : 'Open the map' });
    issues.push({ key: (board ? 'card:' : 'pin:') + m.id, check: 'pin', severity: 'warn', entryIds: host ? [host.id] : [], refs: t ? [X.ref(t)] : [],
      title: what + hostName + ' points at ' + (t ? q(t.title) + ', which is in the trash' : 'an entry that no longer exists'),
      detail: (m.label ? 'The ' + (board ? 'card' : 'pin') + ' ' + q(m.label) : 'It') + ' still points at ' + (t ? q(t.title) + ' (in the trash)' : 'a deleted entry') + '. Restore the entry, or point the ' + (board ? 'card' : 'pin') + ' at another one.',
      fixes, meta: { itemId: m.id } });
  };
  for (const m of s.mapItems || []) one(m, false);
  for (const m of s.boardItems || []) one(m, true);
  return issues;
};

RULES.media = (s, X) => {
  const issues = [], media = new Map((s.media || []).map(m => [m.id, m]));
  if (!s.media) return issues;
  // where each media id is used
  const used = new Set();
  const scan = str => { if (!str) return; const m = String(str).match(/\b[a-z0-9]{10}\b/g); if (m) for (const id of m) if (media.has(id)) used.add(id); };
  if (s.worldCoverId) used.add(s.worldCoverId);
  for (const e of s.entries) { if (e.deleted) continue; if (e.coverId) used.add(e.coverId); scan(e.rawFields); scan(e.rawData); for (const id of e.body ? T.media(e.body) : []) used.add(id); }
  for (const m of (s.mapItems || []).concat(s.boardItems || [])) scan(m.raw);
  for (const m of s.media) {
    if (m.deleted) continue;
    if (m.exists === false) {
      issues.push({ key: 'media-missing:' + m.id, check: 'media', severity: 'error', entryIds: [], refs: [],
        title: 'The file for ' + q(m.name) + ' is missing',
        detail: 'The library lists ' + q(m.name) + ', but its file is gone from the world’s media folder (moved or deleted outside the app). Replace it with the original file.',
        fixes: [{ kind: 'replaceMedia', mediaId: m.id, label: 'Replace the file…' }, { kind: 'openLibrary', mediaId: m.id, label: 'Open in the Library' }], meta: { mediaId: m.id } });
    } else if (!used.has(m.id)) {
      issues.push({ key: 'media-unused:' + m.id, check: 'media', severity: 'info', entryIds: [], refs: [],
        title: q(m.name) + ' isn’t used anywhere',
        detail: 'No entry, map or board uses this ' + (m.kind === 'image' ? 'image' : m.kind === 'audio' ? 'recording' : 'file') + '. Use it as a cover or in a text, or move it to the trash to tidy the library.',
        fixes: [{ kind: 'trashMedia', mediaId: m.id, label: 'Move to the trash' }, { kind: 'openLibrary', mediaId: m.id, label: 'Open in the Library' }], meta: { mediaId: m.id } });
    }
  }
  // entries pointing at media that no longer exists or is in the trash
  for (const e of X.live) {
    const ids = new Set();
    if (e.coverId) ids.add(e.coverId);
    for (const id of e.body ? T.media(e.body) : []) ids.add(id);
    const t = X.typeOf(e);
    for (const d of ((t && t.fields) || []).filter(d => d.kind === 'image')) { const v = e.fields && e.fields[d.key]; if (v) ids.add(v); }
    for (const id of ids) {
      const m = media.get(id);
      if (m && !m.deleted) continue;
      issues.push({ key: 'media-ref:' + e.id + ':' + id, check: 'media', severity: 'warn', entryIds: [e.id], refs: [],
        title: q(e.title) + ' shows a picture that ' + (m ? 'is in the trash' : 'no longer exists'),
        detail: m ? q(m.name) + ' was moved to the media trash, so ' + q(e.title) + ' shows an empty frame. Restore it or pick another picture.' : 'The cover, an image field or an image in the text of ' + q(e.title) + ' refers to a file that was deleted for good.',
        fixes: (m ? [{ kind: 'restoreMedia', mediaId: id, label: 'Restore ' + q(m.name) }] : []).concat([{ kind: 'open', entryId: e.id, label: 'Open ' + q(e.title) }]), meta: { mediaId: id } });
    }
  }
  return issues;
};

/** what a reader of the published site sees of an entry's links: mentions outside secrets, non-secret reference fields */
function publicLinks(X, e) {
  const out = [];
  if (e.body && e.body.indexOf('wb-m') >= 0) for (const id of T.mentions(T.stripSecrets(e.body))) out.push({ id, kind: 'mention' });
  for (const l of X.out.get(e.id) || []) {
    if (l.kind !== 'field') continue;
    const def = X.fieldDef(e, l.key);
    if (!def || def.secret) continue;
    out.push({ id: l.dst, kind: 'field', key: l.key, label: def.label });
  }
  return out;
}
RULES.audience = (s, X) => {
  const issues = [], nowDay = s.now ? s.now.day : null;
  for (const e of X.live) {
    if (e.audience !== 'public' || (e.revealDay != null && nowDay != null && e.revealDay > nowDay)) continue;
    const seen = new Set();
    for (const l of publicLinks(X, e)) {
      const t = X.byId.get(l.id);
      if (!t || t.deleted || t.audience !== 'private' || seen.has(t.id)) continue;
      seen.add(t.id);
      issues.push({ key: 'audience:' + e.id + ':' + t.id, check: 'audience', severity: 'warn', entryIds: [e.id, t.id], refs: [],
        title: 'Public ' + q(e.title) + ' ' + (l.kind === 'mention' ? 'mentions' : 'links to') + ' private ' + q(t.title),
        detail: q(e.title) + ' will be on your published site, but ' + q(t.title) + ' is private: ' + (l.kind === 'mention' ? 'the mention turns into plain text there' : 'its ' + q(l.label) + ' field shows an empty spot') + '. Make ' + q(t.title) + ' public, or hide the mention in a secret.',
        fixes: [{ kind: 'audience', entryId: t.id, value: 'public', label: 'Make ' + q(t.title) + ' public' }].concat(l.kind === 'mention' ? [{ kind: 'unmention', entryId: e.id, targetId: t.id, label: 'Keep the words, drop the link' }] : [{ kind: 'removeRef', entryId: e.id, field: l.key, targetId: t.id, label: 'Remove from ' + q(l.label) }]) });
    }
  }
  return issues;
};

RULES.reveal = (s, X) => {
  const issues = [], nowDay = s.now ? s.now.day : null;
  if (nowDay == null) return issues;
  const sources = new Map();
  for (const e of X.live) {
    if (e.audience !== 'public' || (e.revealDay != null && e.revealDay > nowDay)) continue;
    for (const l of publicLinks(X, e)) {
      const t = X.byId.get(l.id);
      if (!t || t.deleted || t.revealDay == null || t.revealDay <= nowDay || t.audience === 'private') continue;
      if (!sources.has(t.id)) sources.set(t.id, new Set());
      sources.get(t.id).add(e.id);
    }
  }
  for (const [id, set] of sources) {
    const t = X.byId.get(id), src = [...set].map(x => X.byId.get(x));
    issues.push({ key: 'reveal:' + id, check: 'reveal', severity: 'warn', entryIds: [id].concat(src.slice(0, 5).map(x => x.id)), refs: [],
      title: q(t.title) + ' is named before its reveal',
      detail: q(t.title) + ' stays hidden until ' + X.fmtDay(t.revealDay) + ', but ' + (src.length === 1 ? q(src[0].title) + ', which is public now, mentions' : src.length + ' public entries (' + src.slice(0, 3).map(x => q(x.title)).join(', ') + (src.length > 3 ? ' …' : '') + ') mention') + ' it. Readers see its name as plain text before the reveal.',
      fixes: [{ kind: 'clearReveal', entryId: id, label: 'Reveal it now' }, { kind: 'open', entryId: src[0].id, label: 'Open ' + q(src[0].title) }], at: t.revealDay });
  }
  return issues;
};

/** runs every rule that isn't switched off; returns issues sorted by severity, then check order */
function run(s) {
  const X = index(s);
  const off = new Set(((s.settings || {}).off) || []);
  const out = [];
  for (const c of CHECKS) {
    if (off.has(c.id) || !RULES[c.id]) continue;
    try { for (const i of RULES[c.id](s, X)) out.push(i); }
    catch (e) { out.push({ key: 'failed:' + c.id, check: c.id, severity: 'info', entryIds: [], refs: [], title: 'The ' + c.label.toLowerCase() + ' check could not run', detail: String(e && e.message || e), fixes: [] }); }
  }
  const order = new Map(CHECKS.map((c, i) => [c.id, i]));
  out.sort((a, b) => SEVERITY[a.severity] - SEVERITY[b.severity] || order.get(a.check) - order.get(b.check) || String(a.title).localeCompare(String(b.title)));
  for (const i of out) { i.fix = (i.fixes && i.fixes[0]) || null; }
  return out;
}

/** 0–100: errors weigh most, notes barely; bigger worlds carry a few issues more lightly */
function score(issues, entryCount) {
  let p = 0;
  for (const i of issues) p += i.severity === 'error' ? 6 : i.severity === 'warn' ? 2 : .12;
  const k = 10 + Math.max(0, entryCount) * .8;
  return Math.max(0, Math.min(100, Math.round(100 * k / (k + p))));
}

module.exports = { CHECKS, SEVERITY, run, score, span, normTitle, distance, numbered };
