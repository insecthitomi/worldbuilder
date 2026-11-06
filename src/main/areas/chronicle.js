'use strict';
/* Chronicle: dated entries for the timeline, annals (an entry's history), succession of rulers, who lives when,
   anniversaries, advancing world time, and saving or printing a chronicle. No tables of its own. */
const fs = require('fs');
const os = require('os');
const path = require('path');
const L = require('../lib/chronicle-history');
const { placeholders } = require('../util');

const LIFESPAN_SKIP_KEYS = new Set(['home', 'allegiance', 'culture', 'species']);
const EVENTISH = new Set(['event', 'scene', 'session']);
// a place, faction or item that points at a person belongs in that person's history only for these fields
const PERSON_KEYS = new Set(['maker', 'owner', 'founder', 'origin', 'creator']);

function handlers(ctx) {
  const { db } = ctx;
  const C = () => ctx.core;

  const liteCache = () => {
    const m = new Map();
    return id => { if (!m.has(id)) m.set(id, C().lite(id)); const x = m.get(id); return x && !x.deletedAt ? x : null; };
  };
  const typeMap = worldId => new Map(C().typesOf(worldId).map(t => [t.id, t]));

  /** every live entry with a start or an end date (lite rows) */
  function dated(worldId) {
    const ids = db.all('SELECT id FROM entries WHERE world_id = ? AND deleted_at IS NULL AND (start_day IS NOT NULL OR end_day IS NOT NULL)', worldId).map(r => r.id);
    if (!ids.length) return [];
    const out = [];
    for (let i = 0; i < ids.length; i += 500) out.push(...C().listEntries(worldId, { ids: ids.slice(i, i + 500), sort: 'start' }));
    return out.sort((a, b) => ((a.start || a.end).day - (b.start || b.end).day) || a.title.localeCompare(b.title));
  }

  /** ids below an entry (children, grandchildren …) up to `depth` levels */
  function descendants(id, depth = 3) {
    const out = [];
    let level = [id];
    for (let d = 1; d <= depth && level.length; d++) {
      const rows = db.all(`SELECT id, parent_id FROM entries WHERE deleted_at IS NULL AND parent_id IN (${placeholders(level.length)})`, ...level);
      level = rows.map(r => r.id);
      for (const r of rows) out.push({ id: r.id, parentId: r.parent_id, depth: d });
      if (out.length > 2000) break;
    }
    return out;
  }
  function ancestors(id) {
    const out = new Set();
    let p = (db.get('SELECT parent_id FROM entries WHERE id = ?', id) || {}).parent_id, guard = 0;
    while (p && guard++ < 60) { out.add(p); p = (db.get('SELECT parent_id FROM entries WHERE id = ?', p) || {}).parent_id; }
    return out;
  }
  const dateLike = v => (v == null ? null : typeof v === 'number' ? { day: v, min: null, prec: 'day' } : v && Number.isFinite(+v.day) ? { day: +v.day, min: v.min == null ? null : +v.min, prec: v.prec || 'day' } : null);

  /** an entry's history: its own span, events it takes part in or hosts, dated relations, children founded and fallen,
      family births and deaths, scenes and sessions set there, and border changes on the maps */
  async function annals(entryId, o = {}) {
    const e = C().lite(entryId);
    if (!e) throw new Error('That entry no longer exists.');
    const wid = e.worldId, cal = C().calendarFor(wid), types = typeMap(wid), Lt = liteCache();
    const T = x => (x && types.get(x.typeId)) || {};
    const te = T(e), recs = [], ties = [];
    const add = r => { if (r.date && Number.isFinite(r.date.day)) recs.push(r); };
    const label = (t, edge) => (t.dated && t.dated[edge]) || (edge === 'start' ? 'Began' : 'Ended');

    // its own span
    if (e.start) add({ kind: 'self', edge: 'start', date: e.start, until: e.end, label: label(te, 'start'), other: e });
    if (e.end) add({ kind: 'self', edge: 'end', date: e.end, label: label(te, 'end'), other: e, since: e.start });

    // places, factions and other trees: what happens in their parts counts too
    const desc = o.children === false ? [] : descendants(entryId, te.hierarchical ? 3 : 1);
    const descIds = new Set(desc.map(d => d.id)), anc = ancestors(entryId);
    const targets = [entryId].concat([...descIds].filter(id => { const x = Lt(id); return x && T(x).key !== 'chapter' && T(x).key !== 'scene'; }));

    // children founded and fallen (direct children; deeper ones read "in <parent>")
    for (const d of desc) {
      const c = Lt(d.id);
      if (!c || (!c.start && !c.end)) continue;
      const tc = T(c);
      if (tc.lifespan || tc.key === 'scene' || tc.key === 'chapter') continue;
      const at = d.depth > 1 ? Lt(d.parentId) : null;
      if (c.start) add({ kind: 'child', edge: 'start', date: c.start, until: c.end, label: label(tc, 'start'), other: c, at });
      if (c.end) add({ kind: 'child', edge: 'end', date: c.end, label: label(tc, 'end'), other: c, at, since: c.start });
    }

    // events (and other dated entries) that point at it or one of its parts: fields and mentions
    const inc = db.all(`SELECT src, dst, kind, key, label FROM links WHERE kind IN ('field', 'mention') AND dst IN (${placeholders(targets.length)})`, ...targets);
    const byEvent = new Map();
    for (const l of inc) {
      if (l.src === entryId || descIds.has(l.src) || anc.has(l.src)) continue;
      const src = Lt(l.src);
      if (!src || (!src.start && !src.end)) continue;
      const ts = T(src);
      if (ts.lifespan && (l.kind === 'mention' || LIFESPAN_SKIP_KEYS.has(l.key))) continue;
      if (ts.key === 'chapter' || ts.key === 'story') continue;
      // other dated things (places, factions, items) count when a field ties them here, not for a passing mention;
      // for a person only when they made, own or founded it (a "Ruled by" field is the relation's business)
      if (!EVENTISH.has(ts.key) && !ts.lifespan && ts.builtin !== false) {
        if (l.kind !== 'field') { if (!byEvent.has(src.id)) continue; }
        else if (te.lifespan && !PERSON_KEYS.has(l.key)) continue;
        else if (/^(ruler|leader)$/.test(l.key)) continue;
      }
      const role = l.kind === 'field' ? l.key : 'mention';
      const cur = byEvent.get(src.id) || { src, roles: new Set(), labels: new Set(), at: null };
      cur.roles.add(role);
      if (l.kind === 'field' && l.label) cur.labels.add(l.label);
      if (l.dst !== entryId && !cur.at) cur.at = Lt(l.dst);
      if (l.dst === entryId) cur.direct = true;
      byEvent.set(src.id, cur);
    }
    // dated entries it links to itself (its text mentions the war it fought in)
    const out = db.all("SELECT dst, kind, key, label FROM links WHERE src = ? AND kind IN ('field', 'mention')", entryId);
    for (const l of out) {
      if (byEvent.has(l.dst) || descIds.has(l.dst) || anc.has(l.dst)) continue;
      const d = Lt(l.dst);
      if (!d || (!d.start && !d.end)) continue;
      const td = T(d);
      if (td.lifespan || td.key === 'chapter' || td.key === 'story' || (td.hierarchical && td.key !== 'event')) continue;
      byEvent.set(d.id, { src: d, roles: new Set([l.kind === 'field' ? 'ref:' + l.key : 'mentioned']), labels: new Set(l.label ? [l.label] : []), direct: true, outgoing: true });
    }
    for (const x of byEvent.values()) {
      const ts = T(x.src);
      const kind = ts.key === 'scene' ? 'scene' : ts.key === 'session' ? 'session' : ts.lifespan ? 'person' : 'event';
      const roles = [...x.roles];
      const date = x.src.start || x.src.end;
      add({ kind, edge: x.src.start ? 'start' : 'end', date, until: x.src.start ? x.src.end : null, other: x.src, roles, fieldLabels: [...x.labels], at: x.direct ? null : x.at, outgoing: !!x.outgoing });
    }

    // relations: dated ones are records, the others are listed as ties
    const rels = db.all(`SELECT l.*, r.name AS rname, r.inverse AS rinv, r.category AS rcat, r.family_role AS rrole, r.symmetric AS rsym
      FROM links l JOIN rel_types r ON r.id = l.rel_id WHERE l.kind = 'relation' AND (l.src = ? OR l.dst = ?)`, entryId, entryId);
    for (const l of rels) {
      const dir = l.src === entryId ? 'out' : 'in', other = Lt(dir === 'out' ? l.dst : l.src);
      if (!other) continue;
      const rel = { id: l.id, name: l.rname, label: dir === 'out' ? l.rname : l.rinv, category: l.rcat, familyRole: l.rrole, dir, note: l.note || '' };
      const s = L.dateOfDay(cal, l.start_day), en = L.dateOfDay(cal, l.end_day);
      if (!s && !en) { ties.push({ rel, other }); continue; }
      if (s) add({ kind: 'relation', edge: 'start', date: s, until: en, other, rel });
      if (en) add({ kind: 'relation', edge: 'end', date: en, since: s, other, rel });
    }

    // a person's family: births and deaths of parents, partners, siblings and children
    if (te.lifespan) {
      const seen = new Set();
      for (const l of rels) {
        if (!l.rrole) continue;
        const otherId = l.src === entryId ? l.dst : l.src;
        if (seen.has(otherId)) continue;
        seen.add(otherId);
        const other = Lt(otherId);
        if (!other || !T(other).lifespan) continue;
        let role = l.rrole;
        if (role === 'parent') role = l.src === entryId ? 'child' : 'parent';
        if (other.start) add({ kind: 'family', edge: 'start', date: other.start, other, role, label: T(other).dated ? T(other).dated.start : 'Born' });
        if (other.end) add({ kind: 'family', edge: 'end', date: other.end, other, role, label: T(other).dated ? T(other).dated.end : 'Died' });
      }
    }

    // border and territory changes from the Atlas (when it is there)
    if (ctx.has('atlas.items')) {
      const maps = C().listEntries(wid, { typeKeys: ['map'] });
      const want = new Set(targets);
      for (const m of maps) {
        let items = null;
        try { items = await ctx.call('atlas.items', m.id); } catch { items = null; }
        if (!Array.isArray(items)) continue;
        for (const it of items) {
          if (!it || !want.has(it.entryId)) continue;
          const s = dateLike(it.start), en = dateLike(it.end);
          const item = { id: it.id, kind: it.kind || 'pin', label: it.label || '' };
          const at = it.entryId !== entryId ? Lt(it.entryId) : null;
          if (s) add({ kind: 'border', edge: 'start', date: s, until: en, other: m, item, at });
          if (en) add({ kind: 'border', edge: 'end', date: en, since: s, other: m, item, at });
        }
      }
    }

    L.sortRecords(recs);
    const first = recs.length ? recs[0].date : null, last = recs.length ? recs[recs.length - 1].date : null;
    return { entry: e, type: te.key || null, records: recs, ties, first, last, now: C().world(wid).now };
  }

  /** rulers of a realm over time, from dated 'rules' / 'leader of' relations (and the ruler / leader fields) */
  function succession(entryId) {
    const e = C().full(entryId);
    const wid = e.worldId, cal = C().calendarFor(wid), Lt = liteCache(), types = typeMap(wid);
    const rows = db.all(`SELECT l.*, r.name AS rname, r.inverse AS rinv FROM links l JOIN rel_types r ON r.id = l.rel_id
      WHERE l.kind = 'relation' AND (l.dst = ? OR l.src = ?)`, entryId, entryId);
    const list = [];
    for (const l of rows) {
      const inbound = l.dst === entryId && L.RULE_OUT.test(l.rname);
      const outbound = l.src === entryId && L.RULE_IN.test(l.rname);
      if (!inbound && !outbound) continue;
      const ruler = Lt(inbound ? l.src : l.dst);
      if (!ruler) continue;
      list.push({ id: l.id, ruler, rel: inbound ? l.rname : l.rinv, start: l.start_day, end: l.end_day, note: l.note || '' });
    }
    // the realm's own ruler / leader field names the current holder when no relation does
    const t = types.get(e.typeId) || {};
    const fieldDefs = (t.fields || []).filter(d => d.kind === 'ref' && /^(ruler|leader|ruled_by|head|monarch)$/.test(d.key));
    const fromField = [];
    for (const d of fieldDefs) {
      const id = e.fields[d.key];
      if (!id) continue;
      const r = Lt(id);
      if (r && !list.find(x => x.ruler.id === id)) fromField.push({ id: 'field:' + d.key, ruler: r, rel: d.label, start: null, end: null, field: true });
    }
    const now = C().world(wid).now.day;
    const res = L.buildSuccession(cal, list.concat(fromField), now);
    for (const r of res.reigns) {
      const tr = types.get(r.ruler.typeId) || {};
      if (tr.lifespan && r.ruler.start && r.start != null) r.ageAtStart = cal.age(r.ruler.start, { day: r.start, prec: 'day' });
      if (tr.lifespan && r.ruler.end) r.diedDay = r.ruler.end.day;
    }
    return Object.assign(res, { realm: C().lite(entryId), now, first: res.reigns.length ? res.reigns[0].start : null });
  }

  /** realms worth a succession: entries that something rules or leads */
  function realms(worldId) {
    const rows = db.all(`SELECT l.src, l.dst, r.name AS rname FROM links l JOIN rel_types r ON r.id = l.rel_id
      JOIN entries a ON a.id = l.src JOIN entries b ON b.id = l.dst
      WHERE l.world_id = ? AND l.kind = 'relation' AND a.deleted_at IS NULL AND b.deleted_at IS NULL`, worldId);
    const n = new Map();
    for (const r of rows) {
      const id = L.RULE_OUT.test(r.rname) ? r.dst : L.RULE_IN.test(r.rname) ? r.src : null;
      if (id) n.set(id, (n.get(id) || 0) + 1);
    }
    const ids = [...n.keys()];
    return (ids.length ? C().listEntries(worldId, { ids }) : []).map(e => Object.assign(e, { rulers: n.get(e.id) })).sort((a, b) => b.rulers - a.rulers || a.title.localeCompare(b.title));
  }

  function lifespanEntries(worldId) {
    const ids = C().typesOf(worldId).filter(t => t.lifespan).map(t => t.id);
    return ids.length ? C().listEntries(worldId, { typeIds: ids, dated: true }) : [];
  }

  /** move the world's date; optionally write a log entry (note or session) about the time that passed */
  function advance(worldId, by = {}, o = {}) {
    const w = C().world(worldId), cal = C().calendarFor(worldId);
    const from = w.now;
    let to = by.to ? { day: Math.round(+by.to.day), min: by.to.min == null ? null : +by.to.min, prec: by.to.prec === 'time' ? 'time' : 'day' }
      : cal.add({ day: from.day, min: from.min, prec: from.prec === 'time' ? 'time' : 'day' }, { years: +by.years || 0, months: +by.months || 0, days: +by.days || 0 });
    if (by.hours && from.min != null) {
      const mpd = cal.minutesPerDay, m = (to.min || 0) + Math.round(+by.hours * cal.cal.minutesPerHour);
      to = { day: to.day + Math.floor(m / mpd), min: ((m % mpd) + mpd) % mpd, prec: 'time' };
    }
    if (!Number.isFinite(to.day)) throw new Error('That is not a date this calendar knows.');
    ctx.call('worlds.update', worldId, { now: to });
    let log = null;
    if (o.log) {
      const lo = Math.min(from.day, to.day), hi = Math.max(from.day, to.day);
      const happened = dated(worldId).filter(e => e.start && e.start.day > lo && e.start.day <= hi).slice(0, 60);
      const body = ['<p>Time passes from ' + esc(cal.format(from, 'full')) + ' to ' + esc(cal.format(to, 'full')) + ' (' + esc(L.durationText(cal, lo, hi) || 'no time') + ').</p>']
        .concat(o.text ? ['<p>' + esc(o.text) + '</p>'] : [])
        .concat(happened.length ? ['<p>Meanwhile:</p><ul>' + happened.map(e => '<li><a class="wb-m" data-id="' + e.id + '">' + esc(e.title) + '</a> — ' + esc(cal.format(e.start)) + '</li>').join('') + '</ul>'] : []);
      const typeKey = o.log === 'session' ? 'session' : 'note';
      const fa = cal.ymd(from.day), tb = cal.ymd(to.day);
      const fromText = fa.y === tb.y ? cal.format({ day: from.day, prec: 'day' }).replace(' ' + cal.yearText(fa.y), '') : cal.format({ day: from.day, prec: 'day' });
      const title = o.title || ('Time passes: ' + fromText + ' → ' + cal.format({ day: to.day, prec: 'day' }));
      log = C().createEntry({ worldId, typeKey, title, body: body.join(''), start: { day: lo, min: null, prec: 'day' }, end: hi > lo ? { day: hi, min: null, prec: 'day' } : null, summary: o.text || '', tagNames: ['time passes'] });
    }
    return { from, to, world: C().world(worldId), log: log ? C().lite(log.id) : null };
  }
  const esc = s => String(s == null ? '' : s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');

  /** save text (Markdown or HTML) with a save dialog */
  async function saveText(name, text, kind = 'md') {
    if (!ctx.dialog) throw new Error('Saving files needs the desktop app.');
    const filters = kind === 'html' ? [{ name: 'Web page', extensions: ['html'] }] : [{ name: 'Markdown', extensions: ['md'] }, { name: 'Text', extensions: ['txt'] }];
    const r = await ctx.dialog.showSaveDialog(ctx.win(), { defaultPath: safeFile(name) + (kind === 'html' ? '.html' : '.md'), filters });
    if (r.canceled || !r.filePath) return null;
    fs.writeFileSync(r.filePath, String(text || ''), 'utf8');
    return r.filePath;
  }
  const safeFile = s => String(s || 'Chronicle').replace(/[<>:"/\\|?*\x00-\x1f]+/g, '_').replace(/\s+/g, ' ').trim().slice(0, 100) || 'Chronicle';

  /** print an HTML document, or save it as a PDF ({ pdf: true }) — rendered in a hidden window without scripts.
      { dry: true } only loads it and returns its title; { pdf: true, temp: true } writes the PDF to the temp folder (checks) */
  async function printDoc(html, o = {}) {
    const E = ctx.electron;
    if (!E || !E.BrowserWindow) throw new Error('Printing needs the desktop app.');
    let file = null;
    if (o.pdf && o.temp) file = path.join(os.tmpdir(), 'wb-chronicle-' + ctx.uid() + '.pdf');
    else if (o.pdf) {
      const r = await ctx.dialog.showSaveDialog(ctx.win(), { defaultPath: safeFile(o.name) + '.pdf', filters: [{ name: 'PDF', extensions: ['pdf'] }] });
      if (r.canceled || !r.filePath) return null;
      file = r.filePath;
    }
    const w = new E.BrowserWindow({ show: false, width: 900, height: 1200, webPreferences: { javascript: false, sandbox: true } });
    try {
      await w.loadURL('data:text/html;charset=utf-8,' + encodeURIComponent(String(html || '')));
      if (o.dry) return w.webContents.getTitle();
      if (o.pdf) {
        const buf = await w.webContents.printToPDF({ printBackground: true, pageSize: 'A4', margins: { marginType: 'default' } });
        fs.writeFileSync(file, buf);
        return file;
      }
      return await new Promise(res => w.webContents.print({ printBackground: true }, ok => res(!!ok)));
    } finally { setTimeout(() => { try { w.destroy(); } catch { } }, 500); }
  }

  return {
    'chronicle.dated': worldId => dated(worldId),
    'chronicle.annals': (entryId, o) => annals(entryId, o),
    'chronicle.succession': entryId => succession(entryId),
    'chronicle.realms': worldId => realms(worldId),
    'chronicle.alive': (worldId, day) => {
      const cal = C().calendarFor(worldId);
      if (day == null) day = C().world(worldId).now.day;
      return Object.assign(L.aliveAt(cal, lifespanEntries(worldId), Math.round(+day)), { day });
    },
    'chronicle.onThisDay': (worldId, day) => {
      const cal = C().calendarFor(worldId);
      if (day == null) day = C().world(worldId).now.day;
      return L.anniversaries(cal, dated(worldId), Math.round(+(typeof day === 'object' ? day.day : day)));
    },
    'chronicle.advance': (worldId, by, o) => advance(worldId, by, o),
    'chronicle.duration': (worldId, a, b) => L.durationText(C().calendarFor(worldId), a, b),
    'chronicle.saveText': (name, text, kind) => saveText(name, text, kind),
    'chronicle.print': (html, o) => printDoc(html, o),
  };
}

/** a few extra dated events, periods and an older ruler for the example world (keys that are missing are skipped) */
function sample(ctx, S) {
  const C = ctx.core, w = S.worldId;
  if (!w || !S.type('event')) return;
  const cal = C.calendarFor(w);
  const MONTHS = cal.months.map(m => m.name.toLowerCase());
  // an Age-of-Tides year (negative = before the first era), a month name and a day
  const at = S.at || ((y, m, d) => {
    const abs = cal.absYear(Math.abs(y), y > 0 ? cal.cal.eras.length - 1 : -1);
    const mi = m == null ? 0 : Math.max(0, MONTHS.indexOf(String(m).toLowerCase()));
    return { day: cal.fromYmd(abs, mi, d || 1), min: null, prec: d != null ? 'day' : m != null ? 'month' : 'year' };
  });
  const has = title => !!ctx.db.get('SELECT 1 FROM entries WHERE world_id = ? AND title = ? AND deleted_at IS NULL', w, title);
  const ids = keys => (keys || []).map(k => S.e(k)).filter(Boolean);
  const mk = (key, typeKey, o) => {
    if (has(o.title)) return null;
    const fields = Object.assign({}, o.fields || {});
    if (o.where && S.e(o.where)) fields.location = S.e(o.where);
    if (o.who && ids(o.who).length) fields.participants = ids(o.who);
    if (o.kind) fields.kind = o.kind;
    const body = (o.body || []).map(p => '<p>' + p.replace(/\{(\w+)\|([^}]+)\}/g, (m0, k, label) => (S.e(k) ? '<a class="wb-m" data-id="' + S.e(k) + '">' + label + '</a>' : label)) + '</p>').join('');
    const e = C.createEntry({ worldId: w, typeKey, title: o.title, summary: o.summary || '', start: o.start || null, end: o.end || null, fields, body,
      parentId: o.parent && S.e(o.parent) ? S.e(o.parent) : null, tagNames: o.tags || [], audience: o.audience });
    S.set(key, e.id);
    return e;
  };
  mk('wadingyears', 'event', { title: 'The Wading Years', kind: 'Migration', where: 'saltmarch', start: at(1), end: at(30), tags: ['period'],
    summary: 'A generation of survivors walking the new shore, looking for ground the sea would leave alone.',
    body: ['After {flood|the Flood} the March had no roads, only tide lines. The Wading Years ended when {gullhaven|Gullhaven} raised its first mole.'] });
  mk('longbrine', 'event', { title: 'The Long Brine', kind: 'Disaster', where: 'greyflats', start: at(1121, 'deepwinter'), end: at(1124, 'gullsong'), tags: ['period'],
    summary: 'Three winters without a thaw: the salt pans froze solid and half of Mirefen moved into the city.',
    body: ['The {saltwardens|Saltwardens} still date their ledgers from the Long Brine. {mirefen|Mirefen} emptied, then filled again.'] });
  mk('harbourchain', 'event', { title: 'The Chaining of the Harbour', kind: 'Founding', where: 'harbour', who: ['aldous', 'housevey'], start: at(1152, 'highsun', 11),
    summary: 'Aldous Vey strings an iron chain across the bay; tax ships can no longer sail in uninvited.',
    body: ['{aldous|Aldous Vey} paid for the chain with the house silver and three years of credit. It has closed the bay every gale since.'] });
  mk('saltedict', 'event', { title: 'The Salt Edict', kind: 'Treaty', where: 'greyflats', who: ['crown'], start: at(1185, 'deepwinter', 10),
    summary: 'The Inland Crown claims a tenth of all salt cut on the flats. The Saltwardens tear the edict down.',
    body: ['The edict that started {saltwar|the Salt War}.'] });
  mk('treatypans', 'event', { title: 'The Treaty of the Eastern Pans', kind: 'Treaty', where: 'gullhaven', who: ['housevey', 'crown', 'brannoc'], start: at(1188, 'ember', 30),
    summary: 'Peace at a price: Gullhaven stays free, the eastern salt pans go to the Crown.', parent: 'saltwar' });
  mk('turningfeast', 'event', { title: 'Feast of the Turning Tide', kind: 'Festival', where: 'sunkenmarket', who: ['gulls', 'tamsin'], start: at(1203, 'fogmoon', 18),
    summary: 'The Gulls\' yearly feast under the market; old debts are forgiven and new ones made.' });
  mk('crownenvoy', 'event', { title: 'The Crown\'s Envoy Arrives', kind: 'Treaty', where: 'gullhaven', who: ['crown', 'housevey'], start: at(1203, 'gale', 20),
    summary: 'An envoy of the Inland Crown sails in under a white flag, with a demand for back taxes. Expected within the week.' });
  // an older Lady of Gullhaven, so the city's succession has a regency gap to show
  const morwen = mk('morwen', 'character', { title: 'Morwen Vey', summary: 'Aldous\'s mother, Lady of Gullhaven for thirty-seven years. She died in the Long Brine.',
    start: at(1072, 'thaw', 22), end: at(1135, 'frostmere', 2), fields: { pronouns: 'she/her', occupation: 'Lady of Gullhaven', status: 'Dead' } });
  if (morwen) {
    const rels = Object.fromEntries(ctx.db.all('SELECT id, name FROM rel_types WHERE world_id = ?', w).map(r => [r.name, r.id]));
    const R = (a, rel, b, o = {}) => { const s = S.e(a), d = S.e(b); if (s && d && rels[rel]) { try { C.relate(Object.assign({ src: s, dst: d, relId: rels[rel] }, o)); } catch { } } };
    R('morwen', 'rules', 'gullhaven', { start: at(1098), end: at(1135, 'frostmere', 2) });
    R('morwen', 'leader of', 'housevey', { start: at(1098), end: at(1135, 'frostmere', 2) });
    R('morwen', 'parent of', 'aldous');
    R('aldous', 'leader of', 'housevey', { start: at(1140), end: at(1170, 'frostmere', 8) });
    if (S.e('housevey')) ctx.db.run('INSERT OR IGNORE INTO entry_tags (entry_id, tag_id) SELECT ?, id FROM tags WHERE world_id = ? AND name = ?', morwen.id, w, 'house vey');
  }
}

module.exports = { handlers, sample };
