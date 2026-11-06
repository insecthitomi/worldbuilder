'use strict';
/* Checks: continuity & world health. Runs the rules in lib/checks-rules.js over a world, remembers issues the author
   marked as intended, scores the world 0–100 and applies quick fixes. Results are cached until the world changes. */
const fs = require('fs');
const path = require('path');
const T = require('../../shared/richtext');
const R = require('../lib/checks-rules');
const { now, J, dateOf } = require('../util');

const migrations = [{
  id: 'checks-001',
  sql: `CREATE TABLE IF NOT EXISTS issues_ignored (world_id TEXT NOT NULL REFERENCES worlds(id) ON DELETE CASCADE, key TEXT NOT NULL,
    note TEXT DEFAULT '', at TEXT, PRIMARY KEY (world_id, key));`,
}, {
  id: 'checks-002',
  sql: db => { if (!db.columns('issues_ignored').includes('note')) db.exec("ALTER TABLE issues_ignored ADD COLUMN note TEXT DEFAULT ''"); },
}];

const DEFAULTS = { minParentAge: 14, off: [] };

function handlers(ctx) {
  const { db } = ctx;
  const C = () => ctx.core;
  const cache = new Map();   // world id → { sig, issues, at, entries }

  const settingsOf = w => Object.assign({}, DEFAULTS, (w.settings && w.settings.checks) || {});
  const cols = t => (db.hasTable(t) ? db.columns(t) : []);

  /** items on maps or boards that point at entries (whatever columns those areas chose) */
  function canvasItems(worldId, table, hostCol) {
    const c = cols(table);
    if (!c.includes('entry_id')) return [];
    const host = c.includes(hostCol) ? hostCol : null;
    const where = c.includes('world_id') ? 'i.world_id = ?' : host ? `i.${host} IN (SELECT id FROM entries WHERE world_id = ?)` : null;
    if (!where) return [];
    const label = c.includes('label') ? 'i.label' : c.includes('title') ? 'i.title' : c.includes('text') ? 'substr(i.text, 1, 80)' : "''";
    try {
      return db.all(`SELECT i.*, ${label} AS _label FROM ${table} i WHERE ${where}`, worldId).map(r => ({
        id: r.id, entryId: r.entry_id || null, mapId: host === 'map_id' ? r.map_id : null, boardId: host === 'board_id' ? r.board_id : null,
        subMapId: r.sub_map_id || null, label: r._label || '', raw: JSON.stringify(r),
      }));
    } catch { return []; }
  }

  function signature(worldId) {
    const parts = [
      db.get('SELECT count(*) AS n, max(updated_at) AS u, sum(deleted_at IS NOT NULL) AS d FROM entries WHERE world_id = ?', worldId),
      db.get('SELECT count(*) AS n, total(coalesce(start_day, 0)) + total(coalesce(end_day, 0)) AS d, max(created_at) AS c FROM links WHERE world_id = ?', worldId),
      db.get('SELECT updated_at AS u, now_day AS d FROM worlds WHERE id = ?', worldId),
      db.get('SELECT count(*) AS n, max(at) AS a FROM issues_ignored WHERE world_id = ?', worldId),
      db.hasTable('media') ? db.get('SELECT count(*) AS n, sum(deleted_at IS NOT NULL) AS d, max(created_at) AS c FROM media WHERE world_id = ?', worldId) : null,
    ];
    for (const [t, h] of [['map_items', 'map_id'], ['board_items', 'board_id']]) {
      const c = cols(t);
      if (!c.includes('entry_id')) continue;
      try {
        parts.push(c.includes('world_id') ? db.get(`SELECT count(*) AS n, group_concat(coalesce(entry_id, '-')) AS e FROM ${t} WHERE world_id = ?`, worldId)
          : c.includes(h) ? db.get(`SELECT count(*) AS n, group_concat(coalesce(entry_id, '-')) AS e FROM ${t} WHERE ${h} IN (SELECT id FROM entries WHERE world_id = ?)`, worldId) : null);
      } catch { }
    }
    return JSON.stringify(parts);
  }

  function snapshot(worldId) {
    const w = C().world(worldId);
    const types = new Map(C().typesOf(worldId).map(t => [t.id, t]));
    const entries = db.all(`SELECT id, type_id, parent_id, title, aliases, summary, body, fields, data, cover_id, start_day, start_min, start_prec, end_day, end_min, end_prec,
      audience, reveal_day, word_count, inbox, deleted_at FROM entries WHERE world_id = ?`, worldId).map(r => ({
      id: r.id, typeId: r.type_id, parentId: r.parent_id || null, title: r.title, aliases: J(r.aliases, []), summary: r.summary || '', body: r.body || '',
      fields: J(r.fields, {}), rawFields: r.fields || '', rawData: r.data || '', coverId: r.cover_id || null,
      start: dateOf(r.start_day, r.start_min, r.start_prec), end: dateOf(r.end_day, r.end_min, r.end_prec),
      audience: r.audience || 'shared', revealDay: r.reveal_day == null ? null : r.reveal_day, wordCount: r.word_count || 0, inbox: !!r.inbox, deleted: !!r.deleted_at,
    }));
    const links = db.all('SELECT id, src, dst, kind, key, rel_id, start_day, end_day FROM links WHERE world_id = ?', worldId)
      .map(l => ({ id: l.id, src: l.src, dst: l.dst, kind: l.kind, key: l.key || null, relId: l.rel_id || null, startDay: l.start_day, endDay: l.end_day }));
    const rels = new Map(db.all('SELECT id, name, inverse, family_role FROM rel_types WHERE world_id = ?', worldId).map(r => [r.id, { name: r.name, inverse: r.inverse || r.name, familyRole: r.family_role || null }]));
    const dir = ctx.paths.media(worldId);
    const media = db.hasTable('media') ? db.all('SELECT id, name, file, kind, deleted_at FROM media WHERE world_id = ?', worldId).map(m => ({
      id: m.id, name: m.name || 'Untitled file', kind: m.kind, deleted: !!m.deleted_at,
      exists: m.deleted_at ? null : !!(m.file && fs.existsSync(path.join(dir, m.file))),
    })) : null;
    return {
      worldId, cal: C().calendarFor(worldId), now: w.now, settings: settingsOf(w), types, entries, links, rels, media, worldCoverId: w.coverId,
      mapItems: canvasItems(worldId, 'map_items', 'map_id'), boardItems: canvasItems(worldId, 'board_items', 'board_id'),
    };
  }

  /** all issues (ignored ones flagged), cached until the world's data changes */
  function compute(worldId, fresh) {
    const sig = signature(worldId), hit = cache.get(worldId);
    if (hit && hit.sig === sig && !fresh) return hit;
    const s = snapshot(worldId);
    const issues = R.run(s);
    const ignored = new Map(db.all('SELECT key, note, at FROM issues_ignored WHERE world_id = ?', worldId).map(r => [r.key, r]));
    for (const i of issues) {
      const g = ignored.get(i.key);
      i.ignored = !!g;
      if (g) { i.note = g.note || ''; i.ignoredAt = g.at; }
    }
    const res = { sig, issues, at: now(), entries: s.entries.filter(e => !e.deleted).length, ignored };
    cache.set(worldId, res);
    return res;
  }
  function counts(list) {
    const c = { error: 0, warn: 0, info: 0 };
    for (const i of list) c[i.severity]++;
    return c;
  }
  function summary(worldId) {
    const r = compute(worldId), open = r.issues.filter(i => !i.ignored);
    const byCheck = {};
    for (const i of open) byCheck[i.check] = (byCheck[i.check] || 0) + 1;
    return {
      score: R.score(open, r.entries), counts: Object.assign(counts(open), { ignored: r.issues.length - open.length }), total: open.length,
      top: open.filter(i => i.severity !== 'info').slice(0, 5).concat(open.filter(i => i.severity === 'info')).slice(0, 5),
      byCheck, at: r.at, entries: r.entries,
    };
  }

  /* ---------------- quick fixes ---------------- */
  function fix(worldId, f = {}) {
    const E = id => { const e = C().full(id); if (e.worldId !== worldId) throw new Error('That entry belongs to another world.'); return e; };
    switch (f.kind) {
      case 'unmention': {
        const e = E(f.entryId);
        const body = T.mapMentions(e.body || '', id => (id === f.targetId ? { text: null } : null));
        C().updateEntry(e.id, { body, snapshot: 'before removing a broken link' });
        return { message: 'The link is gone; the words stay.' };
      }
      case 'restore': {
        const r = ctx.call('entries.restore', f.entryId);
        return { message: '“' + r.title + '” is back from the trash.' };
      }
      case 'swapDates': {
        const e = E(f.entryId);
        C().updateEntry(e.id, { start: e.end, end: e.start });
        return { message: 'Swapped the dates of “' + e.title + '”.' };
      }
      case 'swapLinkDates': {
        const l = db.get('SELECT * FROM links WHERE id = ? AND world_id = ?', f.linkId, worldId);
        if (!l) throw new Error('That relation no longer exists.');
        db.run('UPDATE links SET start_day = ?, end_day = ? WHERE id = ?', l.end_day, l.start_day, l.id);
        ctx.changed(['links'], [l.src, l.dst]);
        return { message: 'Swapped the relation’s dates.' };
      }
      case 'setDate': {
        const e = E(f.entryId);
        C().updateEntry(e.id, { [f.which === 'end' ? 'end' : 'start']: f.value || null });
        return { message: 'Date changed.' };
      }
      case 'removeRef': {
        const e = E(f.entryId), v = e.fields[f.field];
        const nv = Array.isArray(v) ? v.filter(x => x !== f.targetId) : v === f.targetId ? '' : v;
        C().updateEntry(e.id, { fieldsPatch: { [f.field]: nv } });
        return { message: 'Removed from the field.' };
      }
      case 'setField': {
        const e = E(f.entryId);
        C().updateEntry(e.id, { fieldsPatch: { [f.field]: f.value } });
        return { message: 'Updated “' + e.title + '”.' };
      }
      case 'audience': {
        const e = E(f.entryId);
        C().updateEntry(e.id, { audience: f.value });
        return { message: '“' + e.title + '” is now ' + f.value + '.' };
      }
      case 'clearReveal': {
        const e = E(f.entryId);
        C().updateEntry(e.id, { revealDay: null });
        return { message: '“' + e.title + '” is revealed now.' };
      }
      case 'trashMedia': ctx.call('media.remove', f.mediaId); return { message: 'Moved to the media trash.' };
      case 'restoreMedia': ctx.call('media.restore', f.mediaId); return { message: 'Restored from the media trash.' };
      case 'merge': {
        if (ctx.has('business.repointProduct')) ctx.call('business.repointProduct', f.from, f.into);
        const m = ctx.call('entries.merge', f.into, f.from);
        return { message: 'Merged into “' + m.title + '”.', entryId: m.id };
      }
      default: throw new Error('That fix has to be made by hand.');
    }
  }

  function ignore(worldId, key, note) {
    if (!key) throw new Error('Nothing to mark.');
    db.run(`INSERT INTO issues_ignored (world_id, key, note, at) VALUES (?,?,?,?) ON CONFLICT (world_id, key) DO UPDATE SET note = excluded.note, at = excluded.at`,
      worldId, String(key).slice(0, 400), String(note || '').slice(0, 2000), now());
    ctx.changed(['issues_ignored'], [worldId]);
    return true;
  }

  return {
    /** the catalogue of checks (id, label, icon, desc) */
    'checks.list': () => R.CHECKS,
    /** issues: o.all includes the ones marked as intended (flagged ignored), o.check / o.entryId narrow */
    'checks.run': (worldId, o = {}) => {
      let list = compute(worldId, !!o.fresh).issues;
      if (!o.all) list = list.filter(i => !i.ignored);
      if (o.check) list = list.filter(i => i.check === o.check);
      if (o.entryId) list = list.filter(i => i.entryIds.includes(o.entryId));
      return list;
    },
    'checks.summary': worldId => summary(worldId),
    /** issues about one entry (for an entry page) */
    'checks.entry': (worldId, entryId) => compute(worldId).issues.filter(i => !i.ignored && i.entryIds.includes(entryId)),
    'checks.ignore': (worldId, key, note) => ignore(worldId, key, note),
    'checks.unignore': (worldId, key) => { db.run('DELETE FROM issues_ignored WHERE world_id = ? AND key = ?', worldId, key); ctx.changed(['issues_ignored'], [worldId]); return true; },
    /** everything marked as intended, with the issue it hides (null once the issue is gone) */
    'checks.ignored': worldId => {
      const by = new Map(compute(worldId).issues.map(i => [i.key, i]));
      return db.all('SELECT key, note, at FROM issues_ignored WHERE world_id = ? ORDER BY at DESC', worldId).map(r => ({ key: r.key, note: r.note || '', at: r.at, issue: by.get(r.key) || null }));
    },
    /** forgets marks whose issue no longer exists */
    'checks.forgetResolved': worldId => {
      const live = new Set(compute(worldId).issues.map(i => i.key));
      const gone = db.all('SELECT key FROM issues_ignored WHERE world_id = ?', worldId).map(r => r.key).filter(k => !live.has(k));
      db.tx(() => { for (const k of gone) db.run('DELETE FROM issues_ignored WHERE world_id = ? AND key = ?', worldId, k); });
      if (gone.length) ctx.changed(['issues_ignored'], [worldId]);
      return { n: gone.length };
    },
    'checks.fix': (worldId, f) => { const r = fix(worldId, f); cache.delete(worldId); return r; },
    'checks.settings': (worldId, p) => {
      const w = C().world(worldId);
      if (p === undefined) return settingsOf(w);
      const cur = settingsOf(w), next = Object.assign({}, cur);
      if (p.minParentAge != null) next.minParentAge = Math.max(1, Math.min(200, Math.round(+p.minParentAge) || DEFAULTS.minParentAge));
      if (Array.isArray(p.off)) next.off = p.off.filter(id => R.CHECKS.some(c => c.id === id));
      ctx.call('worlds.update', worldId, { settings: { checks: next } });
      cache.delete(worldId);
      return next;
    },
  };
}

module.exports = { migrations, handlers };
