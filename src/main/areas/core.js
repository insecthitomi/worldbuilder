'use strict';
/* Core: worlds, types, entries, links & relations, tags, collections, search, revisions, trash, merge, packages. */
const fs = require('fs');
const path = require('path');
const T = require('../../shared/richtext');
const F = require('../../shared/fields');
const Cal = require('../../shared/calendar');
const { uid, now, today, J, dateOf, cleanDate, placeholders, slugify } = require('../util');

const migrations = [{
  id: 'core-001',
  sql: `
  CREATE TABLE meta (key TEXT PRIMARY KEY, value TEXT);
  CREATE TABLE worlds (id TEXT PRIMARY KEY, name TEXT NOT NULL, summary TEXT DEFAULT '', icon TEXT DEFAULT '', color TEXT DEFAULT '',
    cover_id TEXT, calendar TEXT, now_day INTEGER, now_min INTEGER, settings TEXT DEFAULT '{}', starter TEXT DEFAULT 'blank',
    sort REAL DEFAULT 0, archived INTEGER DEFAULT 0, created_at TEXT, updated_at TEXT, opened_at TEXT);
  CREATE TABLE types (id TEXT PRIMARY KEY, world_id TEXT NOT NULL REFERENCES worlds(id) ON DELETE CASCADE, key TEXT NOT NULL,
    name TEXT, plural TEXT, icon TEXT, color TEXT, fields TEXT DEFAULT '[]', dated TEXT, lifespan INTEGER DEFAULT 0,
    hierarchical INTEGER DEFAULT 0, child_types TEXT DEFAULT '[]', lens TEXT, pinnable INTEGER DEFAULT 0, default_audience TEXT,
    namegen INTEGER DEFAULT 0, hidden INTEGER DEFAULT 0, builtin INTEGER DEFAULT 0, sort REAL DEFAULT 0, UNIQUE (world_id, key));
  CREATE TABLE entries (id TEXT PRIMARY KEY, world_id TEXT NOT NULL REFERENCES worlds(id) ON DELETE CASCADE,
    type_id TEXT NOT NULL REFERENCES types(id), parent_id TEXT REFERENCES entries(id) ON DELETE SET NULL, position REAL DEFAULT 0,
    title TEXT NOT NULL DEFAULT '', aliases TEXT DEFAULT '[]', summary TEXT DEFAULT '', body TEXT DEFAULT '', body_text TEXT DEFAULT '',
    fields TEXT DEFAULT '{}', data TEXT DEFAULT '{}', icon TEXT DEFAULT '', color TEXT DEFAULT '', cover_id TEXT,
    start_day INTEGER, start_min INTEGER, start_prec TEXT, end_day INTEGER, end_min INTEGER, end_prec TEXT,
    audience TEXT DEFAULT 'shared', reveal_day INTEGER, favorite INTEGER DEFAULT 0, inbox INTEGER DEFAULT 0, word_count INTEGER DEFAULT 0,
    created_at TEXT, updated_at TEXT, deleted_at TEXT, trash_root TEXT);
  CREATE INDEX entries_world ON entries (world_id, deleted_at);
  CREATE INDEX entries_parent ON entries (parent_id);
  CREATE INDEX entries_type ON entries (type_id);
  CREATE INDEX entries_updated ON entries (world_id, updated_at);
  CREATE VIRTUAL TABLE entries_fts USING fts5 (entry_id UNINDEXED, world_id UNINDEXED, title, aliases, summary, body, fields,
    tokenize = 'unicode61 remove_diacritics 2');
  CREATE TABLE tags (id TEXT PRIMARY KEY, world_id TEXT NOT NULL REFERENCES worlds(id) ON DELETE CASCADE, name TEXT NOT NULL,
    color TEXT DEFAULT '', UNIQUE (world_id, name));
  CREATE TABLE entry_tags (entry_id TEXT NOT NULL REFERENCES entries(id) ON DELETE CASCADE, tag_id TEXT NOT NULL REFERENCES tags(id) ON DELETE CASCADE,
    PRIMARY KEY (entry_id, tag_id));
  CREATE TABLE rel_types (id TEXT PRIMARY KEY, world_id TEXT NOT NULL REFERENCES worlds(id) ON DELETE CASCADE, name TEXT, inverse TEXT,
    category TEXT DEFAULT 'other', family_role TEXT, symmetric INTEGER DEFAULT 0, color TEXT DEFAULT '', builtin INTEGER DEFAULT 0, sort REAL DEFAULT 0);
  CREATE TABLE links (id TEXT PRIMARY KEY, world_id TEXT NOT NULL REFERENCES worlds(id) ON DELETE CASCADE,
    src TEXT NOT NULL REFERENCES entries(id) ON DELETE CASCADE, dst TEXT NOT NULL REFERENCES entries(id) ON DELETE CASCADE,
    kind TEXT NOT NULL, key TEXT, rel_id TEXT REFERENCES rel_types(id) ON DELETE CASCADE, label TEXT DEFAULT '', note TEXT DEFAULT '',
    start_day INTEGER, end_day INTEGER, created_at TEXT);
  CREATE INDEX links_src ON links (src, kind);
  CREATE INDEX links_dst ON links (dst, kind);
  CREATE INDEX links_world ON links (world_id, kind);
  CREATE TABLE collections (id TEXT PRIMARY KEY, world_id TEXT NOT NULL REFERENCES worlds(id) ON DELETE CASCADE, name TEXT,
    icon TEXT DEFAULT '', query TEXT DEFAULT '{}', sort REAL DEFAULT 0);
  CREATE TABLE revisions (id TEXT PRIMARY KEY, entry_id TEXT NOT NULL REFERENCES entries(id) ON DELETE CASCADE, world_id TEXT,
    title TEXT, summary TEXT, body TEXT, fields TEXT, reason TEXT, created_at TEXT);
  CREATE INDEX revisions_entry ON revisions (entry_id, created_at);
  CREATE TABLE writing_log (world_id TEXT NOT NULL REFERENCES worlds(id) ON DELETE CASCADE, day TEXT NOT NULL, entry_id TEXT NOT NULL,
    words INTEGER DEFAULT 0, seconds INTEGER DEFAULT 0, PRIMARY KEY (world_id, day, entry_id));
  `,
}, {
  // relation dates keep how precise they are ("1140" stays a year, not 1 Thaw 1140)
  id: 'core-002',
  sql: 'ALTER TABLE links ADD COLUMN start_prec TEXT; ALTER TABLE links ADD COLUMN end_prec TEXT;',
}];

/* ---------------- row mappers ---------------- */
function worldRow(r) {
  if (!r) return null;
  const calendar = Cal.normalize(J(r.calendar, null));
  return {
    id: r.id, name: r.name, summary: r.summary || '', icon: r.icon || '', color: r.color || '', coverId: r.cover_id || null,
    calendar, now: dateOf(r.now_day == null ? 0 : r.now_day, r.now_min, r.now_min != null ? 'time' : 'day'),
    settings: Object.assign({ defaultAudience: 'shared', currency: 'USD', mapUnit: 'miles', wordGoal: 500 }, J(r.settings, {})),
    starter: r.starter || 'blank', archived: !!r.archived, sort: r.sort || 0, createdAt: r.created_at, updatedAt: r.updated_at, openedAt: r.opened_at,
  };
}
function typeRow(r) {
  return {
    id: r.id, worldId: r.world_id, key: r.key, name: r.name, plural: r.plural || r.name, icon: r.icon || '◇', color: r.color || '#9aa5b1',
    fields: J(r.fields, []), dated: J(r.dated, null), lifespan: !!r.lifespan, hierarchical: !!r.hierarchical, childTypes: J(r.child_types, []),
    lens: r.lens || null, pinnable: !!r.pinnable, defaultAudience: r.default_audience || null, namegen: !!r.namegen, hidden: !!r.hidden,
    builtin: !!r.builtin, sort: r.sort || 0,
  };
}
function entryRow(r, full) {
  if (!r) return null;
  const e = {
    id: r.id, worldId: r.world_id, typeId: r.type_id, parentId: r.parent_id || null, position: r.position || 0,
    title: r.title, aliases: J(r.aliases, []), summary: r.summary || '', icon: r.icon || '', color: r.color || '', coverId: r.cover_id || null,
    start: dateOf(r.start_day, r.start_min, r.start_prec), end: dateOf(r.end_day, r.end_min, r.end_prec),
    audience: r.audience || 'shared', revealDay: r.reveal_day == null ? null : r.reveal_day, favorite: !!r.favorite, inbox: !!r.inbox,
    wordCount: r.word_count || 0, createdAt: r.created_at, updatedAt: r.updated_at, deletedAt: r.deleted_at || null,
  };
  if ('tag_ids' in r) e.tags = r.tag_ids ? String(r.tag_ids).split(',') : [];
  if ('child_count' in r) e.childCount = r.child_count || 0;
  if (full) { e.body = r.body || ''; e.fields = J(r.fields, {}); e.data = J(r.data, {}); }
  return e;
}
const relRow = r => ({ id: r.id, worldId: r.world_id, name: r.name, inverse: r.inverse || r.name, category: r.category || 'other', familyRole: r.family_role || null, symmetric: !!r.symmetric, color: r.color || '', builtin: !!r.builtin, sort: r.sort || 0 });
const linkRow = r => ({ id: r.id, worldId: r.world_id, src: r.src, dst: r.dst, kind: r.kind, key: r.key || null, relId: r.rel_id || null, label: r.label || '', note: r.note || '', startDay: r.start_day, endDay: r.end_day, startPrec: r.start_prec || null, endPrec: r.end_prec || null, createdAt: r.created_at });
const LITE = `e.id, e.world_id, e.type_id, e.parent_id, e.position, e.title, e.aliases, e.summary, e.icon, e.color, e.cover_id,
  e.start_day, e.start_min, e.start_prec, e.end_day, e.end_min, e.end_prec, e.audience, e.reveal_day, e.favorite, e.inbox, e.word_count,
  e.created_at, e.updated_at, e.deleted_at,
  (SELECT group_concat(tag_id) FROM entry_tags t WHERE t.entry_id = e.id) AS tag_ids,
  (SELECT count(*) FROM entries c WHERE c.parent_id = e.id AND c.deleted_at IS NULL) AS child_count`;

function handlers(ctx) {
  const { db } = ctx;
  const cals = new Map();   // world id → calendar, rebuilt when the world changes

  /* ---------------- helpers ---------------- */
  const world = id => { const w = worldRow(db.get('SELECT * FROM worlds WHERE id = ?', id)); if (!w) throw new Error('That world no longer exists.'); return w; };
  const calendarFor = id => { let c = cals.get(id); if (!c) { c = Cal.create(world(id).calendar); cals.set(id, c); } return c; };
  const typesOf = worldId => db.all('SELECT * FROM types WHERE world_id = ? ORDER BY sort, name', worldId).map(typeRow);
  const typeById = id => { const r = db.get('SELECT * FROM types WHERE id = ?', id); return r ? typeRow(r) : null; };
  const typeByKey = (worldId, key) => { const r = db.get('SELECT * FROM types WHERE world_id = ? AND key = ?', worldId, key); return r ? typeRow(r) : null; };
  const rawEntry = id => db.get('SELECT * FROM entries WHERE id = ?', id);
  const lite = id => entryRow(db.get(`SELECT ${LITE} FROM entries e WHERE e.id = ?`, id));
  function full(id) {
    const r = db.get(`SELECT e.*, (SELECT group_concat(tag_id) FROM entry_tags t WHERE t.entry_id = e.id) AS tag_ids,
      (SELECT count(*) FROM entries c WHERE c.parent_id = e.id AND c.deleted_at IS NULL) AS child_count FROM entries e WHERE e.id = ?`, id);
    if (!r) throw new Error('That entry no longer exists.');
    return entryRow(r, true);
  }
  const existing = (worldId, ids) => {
    ids = [...new Set(ids.filter(x => typeof x === 'string' && x))];
    if (!ids.length) return [];
    return db.all(`SELECT id FROM entries WHERE world_id = ? AND id IN (${placeholders(ids.length)})`, worldId, ...ids).map(r => r.id);
  };
  const titleOf = id => { const r = db.get('SELECT title FROM entries WHERE id = ?', id); return r ? r.title : ''; };

  /** derived data: search index, mention and field links */
  function syncFts(id) {
    const r = rawEntry(id);
    db.run('DELETE FROM entries_fts WHERE entry_id = ?', id);
    if (!r || r.deleted_at) return;
    const t = typeById(r.type_id), fields = J(r.fields, {});
    const ftext = (t ? t.fields : []).filter(d => !['ref', 'refs', 'image', 'color', 'bool'].includes(d.kind)).map(d => F.asText(d, fields[d.key])).filter(Boolean).join(' · ');
    db.run('INSERT INTO entries_fts (entry_id, world_id, title, aliases, summary, body, fields) VALUES (?,?,?,?,?,?,?)',
      id, r.world_id, r.title || '', J(r.aliases, []).join(' · '), r.summary || '', r.body_text || '', ftext);
  }
  function syncMentions(id) {
    const r = rawEntry(id);
    db.run("DELETE FROM links WHERE src = ? AND kind = 'mention'", id);
    if (!r) return;
    for (const dst of existing(r.world_id, T.mentions(r.body || '')).filter(x => x !== id)) {
      db.run("INSERT INTO links (id, world_id, src, dst, kind, created_at) VALUES (?,?,?,?, 'mention', ?)", uid(), r.world_id, id, dst, now());
    }
  }
  function syncFieldLinks(id) {
    const r = rawEntry(id);
    db.run("DELETE FROM links WHERE src = ? AND kind = 'field'", id);
    if (!r) return;
    const t = typeById(r.type_id), fields = J(r.fields, {});
    for (const d of (t ? t.fields : [])) {
      if (d.kind !== 'ref' && d.kind !== 'refs') continue;
      const v = fields[d.key], ids = d.kind === 'ref' ? (v ? [v] : []) : Array.isArray(v) ? v : [];
      for (const dst of existing(r.world_id, ids).filter(x => x !== id)) {
        db.run("INSERT INTO links (id, world_id, src, dst, kind, key, label, created_at) VALUES (?,?,?,?, 'field', ?, ?, ?)", uid(), r.world_id, id, dst, d.key, d.label, now());
      }
    }
  }
  function snapshot(id, reason) {
    if (ctx.building) return;
    const r = rawEntry(id);
    if (!r) return;
    db.run('INSERT INTO revisions (id, entry_id, world_id, title, summary, body, fields, reason, created_at) VALUES (?,?,?,?,?,?,?,?,?)',
      uid(), id, r.world_id, r.title, r.summary, r.body, r.fields, reason || 'edit', now());
    const extra = db.all('SELECT id FROM revisions WHERE entry_id = ? ORDER BY created_at DESC LIMIT -1 OFFSET 200', id);
    for (const x of extra) db.run('DELETE FROM revisions WHERE id = ?', x.id);
  }
  function setTags(id, tagIds) {
    const r = rawEntry(id);
    if (!r) return;
    db.run('DELETE FROM entry_tags WHERE entry_id = ?', id);
    const valid = (tagIds || []).length ? db.all(`SELECT id FROM tags WHERE world_id = ? AND id IN (${placeholders(tagIds.length)})`, r.world_id, ...tagIds).map(x => x.id) : [];
    for (const t of new Set(valid)) db.run('INSERT OR IGNORE INTO entry_tags (entry_id, tag_id) VALUES (?, ?)', id, t);
  }
  function ensureTag(worldId, name, color) {
    name = String(name || '').trim().replace(/^#/, '').slice(0, 60);
    if (!name) return null;
    const r = db.get('SELECT * FROM tags WHERE world_id = ? AND lower(name) = lower(?)', worldId, name);
    if (r) return r.id;
    const id = uid();
    db.run('INSERT INTO tags (id, world_id, name, color) VALUES (?,?,?,?)', id, worldId, name, color || '');
    return id;
  }
  function nextPosition(worldId, parentId) {
    const v = parentId ? db.value('SELECT max(position) FROM entries WHERE parent_id = ?', parentId)
      : db.value('SELECT max(position) FROM entries WHERE world_id = ? AND parent_id IS NULL', worldId);
    return (v || 0) + 1;
  }
  function assertNoCycle(id, parentId) {
    let p = parentId, guard = 0;
    while (p && guard++ < 10000) {
      if (p === id) throw new Error('An entry can\'t sit inside itself.');
      const r = db.get('SELECT parent_id FROM entries WHERE id = ?', p);
      p = r && r.parent_id;
    }
  }
  function logWords(worldId, entryId, delta) {
    if (!delta || ctx.building) return;
    db.run(`INSERT INTO writing_log (world_id, day, entry_id, words) VALUES (?,?,?,?)
      ON CONFLICT (world_id, day, entry_id) DO UPDATE SET words = words + excluded.words`, worldId, today(), entryId, delta);
  }
  const revisionGapMs = () => 10 * 60 * 1000;

  /* ---------------- worlds ---------------- */
  function seedWorld(worldId, starterKey) {
    const st = F.STARTERS[starterKey] || F.STARTERS.blank;
    for (const t of F.builtinTypes()) {
      const rn = st.rename && st.rename[t.key];
      db.run(`INSERT INTO types (id, world_id, key, name, plural, icon, color, fields, dated, lifespan, hierarchical, child_types, lens, pinnable,
        default_audience, namegen, hidden, builtin, sort) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,1,?)`,
        uid(), worldId, t.key, rn ? rn[0] : t.name, rn ? rn[1] : t.plural, t.icon, t.color, t.fields, t.dated, t.lifespan, t.hierarchical,
        t.childTypes, t.lens, t.pinnable, t.defaultAudience, t.namegen, (st.hide || []).includes(t.key), t.sort);
    }
    for (const r of F.builtinRels()) {
      db.run('INSERT INTO rel_types (id, world_id, name, inverse, category, family_role, symmetric, color, builtin, sort) VALUES (?,?,?,?,?,?,?,?,1,?)',
        uid(), worldId, r.name, r.inverse, r.category, r.familyRole, r.symmetric, r.color, r.sort);
    }
  }
  function createWorld({ name, starter = 'blank', summary = '', calendar = null, now: nowDate = null, settings = {} } = {}) {
    const id = uid(), st = F.STARTERS[starter] || F.STARTERS.blank;
    const cal = Cal.normalize(Object.assign({}, Cal.DEFAULT, st.calendar || {}, calendar || {}));
    const c = Cal.create(cal);
    const n = nowDate || { day: c.fromYmd(cal.eras.length ? cal.eras[cal.eras.length - 1].start + 999 : 1000, 0, 1), min: null, prec: 'day' };
    db.tx(() => {
      db.run(`INSERT INTO worlds (id, name, summary, calendar, now_day, now_min, settings, starter, sort, created_at, updated_at, opened_at)
        VALUES (?,?,?,?,?,?,?,?,?,?,?,?)`, id, String(name || 'New world').slice(0, 120), summary, cal, n.day, n.min, Object.assign({ defaultAudience: st.audience || 'shared' }, settings),
        starter, (db.value('SELECT max(sort) FROM worlds') || 0) + 1, now(), now(), now());
      seedWorld(id, starter);
    });
    ctx.changed(['worlds']);
    return world(id);
  }
  function updateWorld(id, p = {}) {
    const w = world(id);
    const sets = [], vals = [];
    const put = (col, v) => { sets.push(col + ' = ?'); vals.push(v); };
    if (p.name != null) put('name', String(p.name).slice(0, 120) || w.name);
    if (p.summary != null) put('summary', String(p.summary));
    if (p.icon != null) put('icon', String(p.icon));
    if (p.color != null) put('color', String(p.color));
    if (p.coverId !== undefined) put('cover_id', p.coverId || null);
    if (p.calendar) { put('calendar', Cal.normalize(p.calendar)); cals.delete(id); }
    if (p.now) { const d = cleanDate(p.now); if (d) { put('now_day', d.day); put('now_min', d.prec === 'time' ? d.min : null); } }
    if (p.settings) put('settings', Object.assign({}, w.settings, p.settings));
    if (p.archived != null) put('archived', !!p.archived);
    if (p.sort != null) put('sort', +p.sort);
    if (!sets.length) return w;
    put('updated_at', now());
    db.run(`UPDATE worlds SET ${sets.join(', ')} WHERE id = ?`, ...vals, id);
    ctx.changed(['worlds'], [id]);
    return world(id);
  }
  function worldStats(id) {
    const byType = db.all(`SELECT type_id AS typeId, count(*) AS n FROM entries WHERE world_id = ? AND deleted_at IS NULL GROUP BY type_id`, id);
    return {
      entries: db.value('SELECT count(*) FROM entries WHERE world_id = ? AND deleted_at IS NULL', id) || 0,
      words: db.value('SELECT coalesce(sum(word_count), 0) FROM entries WHERE world_id = ? AND deleted_at IS NULL', id) || 0,
      links: db.value("SELECT count(*) FROM links l JOIN entries a ON a.id = l.src JOIN entries b ON b.id = l.dst WHERE l.world_id = ? AND a.deleted_at IS NULL AND b.deleted_at IS NULL", id) || 0,
      relations: db.value("SELECT count(*) FROM links WHERE world_id = ? AND kind = 'relation'", id) || 0,
      trashed: db.value('SELECT count(*) FROM entries WHERE world_id = ? AND deleted_at IS NOT NULL AND trash_root = id', id) || 0,
      inbox: db.value('SELECT count(*) FROM entries WHERE world_id = ? AND inbox = 1 AND deleted_at IS NULL', id) || 0,
      tags: db.value('SELECT count(*) FROM tags WHERE world_id = ?', id) || 0,
      lastEdited: db.value('SELECT max(updated_at) FROM entries WHERE world_id = ? AND deleted_at IS NULL', id),
      byType: Object.fromEntries(byType.map(r => [r.typeId, r.n])),
    };
  }

  /* ---------------- packages (portable worlds; generic over every table with world_id) ---------------- */
  const SKIP_TABLES = new Set(['worlds', 'entries_fts', 'migrations', 'meta']);
  function worldTables() {
    return db.all("SELECT name FROM sqlite_master WHERE type = 'table' AND name NOT LIKE 'sqlite_%' AND name NOT LIKE 'entries_fts%'")
      .map(r => r.name).filter(n => !SKIP_TABLES.has(n) && db.columns(n).includes('world_id'));
  }
  function pack(worldId, { media = true } = {}) {
    const w = db.get('SELECT * FROM worlds WHERE id = ?', worldId);
    if (!w) throw new Error('That world no longer exists.');
    const tables = {};
    for (const t of worldTables()) tables[t] = db.all(`SELECT * FROM "${t}" WHERE world_id = ?`, worldId);
    tables.entry_tags = db.all('SELECT et.* FROM entry_tags et JOIN entries e ON e.id = et.entry_id WHERE e.world_id = ?', worldId);
    const files = [];
    if (media && tables.media) {
      for (const m of tables.media) {
        const p = path.join(ctx.paths.media(worldId), m.file || '');
        try { if (m.file && fs.existsSync(p)) files.push({ id: m.id, file: m.file, data: fs.readFileSync(p).toString('base64') }); } catch { }
      }
    }
    return { format: 'worldbuilder-world', version: 1, exportedAt: now(), world: w, tables, files };
  }
  function unpack(pk, { name } = {}) {
    if (!pk || pk.format !== 'worldbuilder-world' || !pk.world || !pk.tables) throw new Error('That file is not a Worldbuilder world.');
    const map = new Map();
    const newId = old => { if (!map.has(old)) map.set(old, uid()); return map.get(old); };
    newId(pk.world.id);
    for (const rows of Object.values(pk.tables)) for (const r of rows || []) if (typeof r.id === 'string') newId(r.id);
    const swap = v => (typeof v === 'string' ? v.replace(/\b[a-z0-9]{10}\b/g, m => map.get(m) || m) : v);
    const remapRow = r => Object.fromEntries(Object.entries(r).map(([k, v]) => [k, swap(v)]));
    const wid = map.get(pk.world.id);
    const known = new Set(db.all("SELECT name FROM sqlite_master WHERE type = 'table'").map(r => r.name));
    // parents before children: types before entries before the rest; entries sorted so a parent exists first
    const order = ['types', 'rel_types', 'tags', 'media', 'entries'];
    const names = Object.keys(pk.tables).sort((a, b) => ((order.indexOf(a) + 1) || 99) - ((order.indexOf(b) + 1) || 99));
    db.tx(() => {
      const w = remapRow(pk.world);
      w.name = name || w.name; w.created_at = now(); w.updated_at = now(); w.opened_at = now(); w.sort = (db.value('SELECT max(sort) FROM worlds') || 0) + 1;
      insertRow('worlds', w);
      for (const t of names) {
        if (!known.has(t)) continue;
        const cols = new Set(db.columns(t));
        let rows = (pk.tables[t] || []).map(remapRow);
        if (t === 'entries') {
          // insert without parents, then restore them (any order works)
          for (const r of rows) insertRow(t, Object.assign({}, r, { parent_id: null }), cols);
          for (const r of rows) if (r.parent_id) db.run('UPDATE entries SET parent_id = ? WHERE id = ?', r.parent_id, r.id);
          continue;
        }
        for (const r of rows) insertRow(t, r, cols);
      }
      for (const r of db.all('SELECT id FROM entries WHERE world_id = ?', wid)) syncFts(r.id);
    });
    for (const f of pk.files || []) {
      try {
        const dir = ctx.paths.media(wid); fs.mkdirSync(dir, { recursive: true });
        fs.writeFileSync(path.join(dir, swap(f.file)), Buffer.from(f.data, 'base64'));
      } catch { }
    }
    ctx.changed(['worlds', 'entries']);
    return world(wid);
  }
  function insertRow(table, r, cols) {
    cols = cols || new Set(db.columns(table));
    const keys = Object.keys(r).filter(k => cols.has(k));
    db.run(`INSERT OR IGNORE INTO "${table}" (${keys.map(k => '"' + k + '"').join(',')}) VALUES (${placeholders(keys.length)})`, ...keys.map(k => r[k]));
  }

  /* ---------------- entries ---------------- */
  function listEntries(worldId, f = {}) {
    const where = ['e.world_id = ?'], vals = [worldId];
    where.push(f.trashed ? 'e.deleted_at IS NOT NULL' : 'e.deleted_at IS NULL');
    if (f.trashed === 'roots') where.push('e.trash_root = e.id');
    let typeIds = f.typeIds || [];
    if (f.typeKeys && f.typeKeys.length) typeIds = typeIds.concat(f.typeKeys.map(k => typeByKey(worldId, k)).filter(Boolean).map(t => t.id));
    if (typeIds.length) { where.push(`e.type_id IN (${placeholders(typeIds.length)})`); vals.push(...typeIds); }
    else if (f.typeKeys && f.typeKeys.length) return [];
    if (f.parentId === null || f.parentId === 'root') where.push('e.parent_id IS NULL');
    else if (f.parentId) { where.push('e.parent_id = ?'); vals.push(f.parentId); }
    if (f.favorite) where.push('e.favorite = 1');
    if (f.inbox != null) where.push(f.inbox ? 'e.inbox = 1' : 'e.inbox = 0');
    if (f.dated) where.push('e.start_day IS NOT NULL');
    if (f.ids) { if (!f.ids.length) return []; where.push(`e.id IN (${placeholders(f.ids.length)})`); vals.push(...f.ids); }
    for (const t of f.tagIds || []) { where.push('EXISTS (SELECT 1 FROM entry_tags x WHERE x.entry_id = e.id AND x.tag_id = ?)'); vals.push(t); }
    if (f.audience) { where.push('e.audience = ?'); vals.push(f.audience); }
    if (f.since) { where.push('e.updated_at >= ?'); vals.push(f.since); }
    const sort = { title: 'e.title COLLATE NOCASE', updated: 'e.updated_at DESC', created: 'e.created_at DESC', start: 'e.start_day, e.start_min', position: 'e.position, e.title COLLATE NOCASE', words: 'e.word_count DESC', deleted: 'e.deleted_at DESC' }[f.sort] || 'e.position, e.title COLLATE NOCASE';
    const lim = f.limit ? ` LIMIT ${Math.max(1, Math.min(100000, +f.limit))}` + (f.offset ? ` OFFSET ${Math.max(0, +f.offset)}` : '') : '';
    return db.all(`SELECT ${LITE} FROM entries e WHERE ${where.join(' AND ')} ORDER BY ${sort}${lim}`, ...vals).map(r => entryRow(r));
  }

  function createEntry(d = {}) {
    const worldId = d.worldId;
    const w = world(worldId);
    const t = d.typeId ? typeById(d.typeId) : typeByKey(worldId, d.typeKey || d.type || 'note');
    if (!t || t.worldId !== worldId) throw new Error('Pick a type for the new entry.');
    if (d.parentId && !db.get('SELECT 1 FROM entries WHERE id = ? AND world_id = ?', d.parentId, worldId)) throw new Error('The parent entry no longer exists.');
    const id = d.id && T.ID.test(d.id) && !rawEntry(d.id) ? d.id : uid();
    const body = T.sanitize(d.body || ''), text = T.text(body), wc = T.words(text);
    const fields = Object.assign({}, d.fields || {});
    const st = cleanDate(d.start), en = cleanDate(d.end);
    const audience = ['private', 'shared', 'public'].includes(d.audience) ? d.audience : t.defaultAudience || w.settings.defaultAudience || 'shared';
    db.tx(() => {
      db.run(`INSERT INTO entries (id, world_id, type_id, parent_id, position, title, aliases, summary, body, body_text, fields, data, icon, color, cover_id,
        start_day, start_min, start_prec, end_day, end_min, end_prec, audience, reveal_day, favorite, inbox, word_count, created_at, updated_at)
        VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`,
        id, worldId, t.id, d.parentId || null, d.position != null ? +d.position : nextPosition(worldId, d.parentId),
        String(d.title == null || d.title === '' ? 'Untitled ' + t.name.toLowerCase() : d.title).slice(0, 300), (d.aliases || []).map(String),
        String(d.summary || ''), body, text, fields, d.data || {}, d.icon || '', d.color || '', d.coverId || null,
        st && st.day, st && st.min, st && st.prec, en && en.day, en && en.min, en && en.prec, audience,
        d.revealDay == null ? null : Math.round(+d.revealDay), !!d.favorite, !!d.inbox, wc, d.createdAt || now(), now());
      let tagIds = d.tags || [];
      if (d.tagNames) tagIds = tagIds.concat(d.tagNames.map(n => ensureTag(worldId, n)).filter(Boolean));
      if (tagIds.length) setTags(id, tagIds);
      syncFts(id); syncMentions(id); syncFieldLinks(id);
      logWords(worldId, id, wc);
    });
    ctx.changed(['entries', 'links'], [id]);
    return full(id);
  }

  function updateEntry(id, p = {}) {
    const old = rawEntry(id);
    if (!old) throw new Error('That entry no longer exists.');
    const sets = [], vals = [];
    const put = (col, v) => { sets.push(col + ' = ?'); vals.push(v); };
    let content = false, bodyChanged = false, fieldsChanged = false, delta = 0;
    if (p.title != null && p.title !== old.title) { put('title', String(p.title).slice(0, 300)); content = true; }
    if (p.aliases) put('aliases', p.aliases.map(String).map(s => s.trim()).filter(Boolean));
    if (p.summary != null && p.summary !== old.summary) { put('summary', String(p.summary)); content = true; }
    if (p.body != null) {
      const body = T.sanitize(p.body);
      if (body !== old.body) {
        const text = T.text(body), wc = T.words(text);
        put('body', body); put('body_text', text); put('word_count', wc);
        delta = wc - (old.word_count || 0); content = true; bodyChanged = true;
      }
    }
    if (p.fields || p.fieldsPatch) {
      const nf = p.fields ? Object.assign({}, p.fields) : Object.assign(J(old.fields, {}), p.fieldsPatch);
      if (JSON.stringify(nf) !== old.fields) { put('fields', nf); content = true; fieldsChanged = true; }
    }
    if (p.data || p.dataPatch) put('data', p.data ? p.data : Object.assign(J(old.data, {}), p.dataPatch));
    if (p.icon != null) put('icon', String(p.icon));
    if (p.color != null) put('color', String(p.color));
    if (p.coverId !== undefined) put('cover_id', p.coverId || null);
    if (p.start !== undefined) { const d = cleanDate(p.start); put('start_day', d && d.day); put('start_min', d && d.min); put('start_prec', d && d.prec); }
    if (p.end !== undefined) { const d = cleanDate(p.end); put('end_day', d && d.day); put('end_min', d && d.min); put('end_prec', d && d.prec); }
    if (p.audience && ['private', 'shared', 'public'].includes(p.audience)) put('audience', p.audience);
    if (p.revealDay !== undefined) put('reveal_day', p.revealDay == null ? null : Math.round(+p.revealDay));
    if (p.favorite != null) put('favorite', !!p.favorite);
    if (p.inbox != null) put('inbox', !!p.inbox);
    if (p.typeId && p.typeId !== old.type_id) {
      const t = typeById(p.typeId);
      if (!t || t.worldId !== old.world_id) throw new Error('That type belongs to another world.');
      put('type_id', t.id); fieldsChanged = true;
    }
    if (p.parentId !== undefined && (p.parentId || null) !== old.parent_id) {
      if (p.parentId) { assertNoCycle(id, p.parentId); if (!rawEntry(p.parentId)) throw new Error('The new parent no longer exists.'); }
      put('parent_id', p.parentId || null);
      if (p.position == null) put('position', nextPosition(old.world_id, p.parentId || null));
    }
    if (p.position != null) put('position', +p.position);
    if (!sets.length && !p.tags) return full(id);
    db.tx(() => {
      if (content) {
        const last = db.get('SELECT created_at FROM revisions WHERE entry_id = ? ORDER BY created_at DESC LIMIT 1', id);
        if (!last || Date.now() - Date.parse(last.created_at) > revisionGapMs() || p.snapshot) snapshot(id, p.snapshot || 'edit');
      }
      if (sets.length) { put('updated_at', now()); db.run(`UPDATE entries SET ${sets.join(', ')} WHERE id = ?`, ...vals, id); }
      if (p.tags) setTags(id, p.tags);
      if (content || fieldsChanged || p.aliases) syncFts(id);
      if (bodyChanged) syncMentions(id);
      if (fieldsChanged) syncFieldLinks(id);
      logWords(old.world_id, id, delta);
    });
    ctx.changed(['entries'].concat(bodyChanged || fieldsChanged ? ['links'] : []), [id]);
    return full(id);
  }

  const subtree = id => db.all(`WITH RECURSIVE s(id) AS (SELECT ? UNION ALL SELECT e.id FROM entries e JOIN s ON e.parent_id = s.id) SELECT id FROM s`, id).map(r => r.id);
  function trash(id) {
    const r = rawEntry(id);
    if (!r) throw new Error('That entry no longer exists.');
    if (r.deleted_at) return { ids: [] };
    const ids = subtree(id).filter(x => { const e = rawEntry(x); return e && !e.deleted_at; });
    const at = now();
    db.tx(() => { for (const x of ids) { db.run('UPDATE entries SET deleted_at = ?, trash_root = ? WHERE id = ?', at, id, x); db.run('DELETE FROM entries_fts WHERE entry_id = ?', x); } });
    ctx.changed(['entries', 'links'], ids);
    return { ids };
  }
  function restore(id) {
    const r = rawEntry(id);
    if (!r) throw new Error('That entry no longer exists.');
    const ids = db.all('SELECT id FROM entries WHERE trash_root = ? AND deleted_at IS NOT NULL', r.trash_root || id).map(x => x.id);
    db.tx(() => {
      for (const x of ids) { db.run('UPDATE entries SET deleted_at = NULL, trash_root = NULL WHERE id = ?', x); syncFts(x); }
      const root = rawEntry(id);
      if (root.parent_id) { const p = rawEntry(root.parent_id); if (!p || p.deleted_at) db.run('UPDATE entries SET parent_id = NULL WHERE id = ?', id); }
    });
    ctx.changed(['entries', 'links'], ids);
    return full(id);
  }
  function purge(id) {
    const r = rawEntry(id);
    if (!r) return { ids: [] };
    const ids = r.deleted_at ? db.all('SELECT id FROM entries WHERE trash_root = ?', r.trash_root || id).map(x => x.id) : subtree(id);
    db.tx(() => { for (const x of ids.slice().reverse()) { db.run('DELETE FROM entries_fts WHERE entry_id = ?', x); db.run('DELETE FROM entries WHERE id = ?', x); } });
    ctx.changed(['entries', 'links'], ids);
    return { ids };
  }
  function moveEntry(id, { parentId, index, beforeId, afterId } = {}) {
    const r = rawEntry(id);
    if (!r) throw new Error('That entry no longer exists.');
    const parent = parentId === undefined ? r.parent_id : parentId || null;
    if (parent) assertNoCycle(id, parent);
    const sibs = db.all(`SELECT id, position FROM entries WHERE world_id = ? AND ${parent ? 'parent_id = ?' : 'parent_id IS NULL'} AND deleted_at IS NULL AND id != ? ORDER BY position, title`,
      ...[r.world_id].concat(parent ? [parent] : []), id);
    let at = index != null ? index : beforeId ? sibs.findIndex(s => s.id === beforeId) : afterId ? sibs.findIndex(s => s.id === afterId) + 1 : sibs.length;
    if (at < 0) at = sibs.length;
    at = Math.max(0, Math.min(sibs.length, at));
    const order = sibs.map(s => s.id); order.splice(at, 0, id);
    db.tx(() => {
      db.run('UPDATE entries SET parent_id = ?, updated_at = ? WHERE id = ?', parent, now(), id);
      order.forEach((x, i) => db.run('UPDATE entries SET position = ? WHERE id = ?', i + 1, x));
    });
    ctx.changed(['entries'], [id]);
    return full(id);
  }
  /** o.owned = false skips copying other areas' owned rows (for an area that copies its own, like boards.duplicate) */
  function duplicate(id, { children = false, parentId, owned = true } = {}) {
    const src = full(id);
    const copy = createEntry({ worldId: src.worldId, typeId: src.typeId, parentId: parentId !== undefined ? parentId : src.parentId,
      title: parentId !== undefined ? src.title : src.title + ' (copy)', aliases: [], summary: src.summary, body: src.body, fields: src.fields, data: src.data,
      tags: src.tags, icon: src.icon, color: src.color, coverId: src.coverId, start: src.start, end: src.end, audience: src.audience, revealDay: src.revealDay });
    for (const l of db.all("SELECT * FROM links WHERE src = ? AND kind = 'relation'", id)) {
      db.run('INSERT INTO links (id, world_id, src, dst, kind, rel_id, note, start_day, start_prec, end_day, end_prec, created_at) VALUES (?,?,?,?,?,?,?,?,?,?,?,?)',
        uid(), l.world_id, copy.id, l.dst, 'relation', l.rel_id, l.note, l.start_day, l.start_prec, l.end_day, l.end_prec, now());
    }
    if (owned) copyOwned(id, copy.id);
    if (children) for (const c of listEntries(src.worldId, { parentId: id })) duplicate(c.id, { children: true, parentId: copy.id, owned });
    return full(copy.id);
  }
  /** rows another area keeps *inside* an entry (a map's pins and territories, a board's cards, a language's words) —
      found as foreign keys that cascade from entries — are copied with new ids; references among the copies follow */
  function copyOwned(fromId, toId) {
    const own = new Set(['entries', 'links', 'entry_tags', 'revisions', 'writing_log']);
    const jobs = [];
    for (const tb of worldTables().filter(n => !own.has(n))) {
      const fks = db.all(`PRAGMA foreign_key_list("${tb}")`);
      for (const f of fks.filter(f => f.table === 'entries' && /cascade/i.test(f.on_delete || ''))) {
        const rows = db.all(`SELECT * FROM "${tb}" WHERE "${f.from}" = ?`, fromId);
        if (rows.length) jobs.push({ tb, rows, after: new Set(fks.filter(x => x.table !== 'entries' && x.table !== 'worlds').map(x => x.table)) });
      }
    }
    if (!jobs.length) return;
    const map = new Map([[fromId, toId]]);
    for (const j of jobs) for (const r of j.rows) if (typeof r.id === 'string') map.set(r.id, uid());
    const swap = v => (typeof v === 'string' ? v.replace(/\b[a-z0-9]{10}\b/g, m => map.get(m) || m) : v);
    // tables that point at another copied table go after it (board links after board cards)
    jobs.sort((a, b) => (a.after.has(b.tb) ? 1 : 0) - (b.after.has(a.tb) ? 1 : 0));
    const stamp = now(), touched = new Set();
    db.tx(() => {
      for (const j of jobs) {
        const cols = new Set(db.columns(j.tb));
        for (const r of j.rows) {
          const row = Object.fromEntries(Object.entries(r).map(([k, v]) => [k, swap(v)]));
          if (cols.has('created_at')) row.created_at = stamp;
          if (cols.has('updated_at')) row.updated_at = stamp;
          insertRow(j.tb, row, cols);
        }
        touched.add(j.tb);
      }
    });
    ctx.changed([...touched], [toId]);
  }
  function merge(intoId, fromId) {
    if (intoId === fromId) throw new Error('Pick two different entries to merge.');
    const a = full(intoId), b = full(fromId);
    if (a.worldId !== b.worldId) throw new Error('Entries from different worlds can\'t be merged.');
    if (ctx.has('backup.create')) { try { ctx.call('backup.create', 'Before merging ' + b.title + ' into ' + a.title); } catch { } }
    const t = typeById(a.typeId), touched = new Set(['entries', 'links']);
    db.tx(() => {
      snapshot(intoId, 'before merge');
      const aliases = [...new Set(a.aliases.concat([b.title], b.aliases))].filter(x => x && x !== a.title);
      const fields = Object.assign({}, a.fields);
      for (const [k, v] of Object.entries(b.fields)) { const def = (t.fields || []).find(d => d.key === k); if (!F.filled(def ? def.kind : 'text', fields[k])) fields[k] = v; }
      const body = b.body && T.text(b.body) ? (a.body || '') + '<h3>From “' + T.esc(b.title) + '”</h3>' + b.body : a.body;
      db.run('UPDATE entries SET parent_id = ? WHERE parent_id = ?', intoId, fromId);
      // links: move ends, drop self-links and duplicates
      db.run('UPDATE links SET src = ? WHERE src = ?', intoId, fromId);
      db.run('UPDATE links SET dst = ? WHERE dst = ?', intoId, fromId);
      db.run('DELETE FROM links WHERE src = dst');
      db.run(`DELETE FROM links WHERE kind = 'relation' AND id NOT IN (SELECT min(id) FROM links WHERE kind = 'relation' GROUP BY src, dst, rel_id)`);
      // text mentions and reference fields elsewhere point at the survivor
      for (const r of db.all('SELECT id, body, fields FROM entries WHERE world_id = ? AND (body LIKE ? OR fields LIKE ?)', a.worldId, '%' + fromId + '%', '%' + fromId + '%')) {
        db.run('UPDATE entries SET body = ?, fields = ? WHERE id = ?', String(r.body || '').split(fromId).join(intoId), String(r.fields || '').split(fromId).join(intoId), r.id);
      }
      // every other area's rows follow the survivor (pins, board cards, sales, words, tasks, settings…): like packages,
      // swap the id wherever it appears in a world table, before the delete below can cascade them away
      const own = new Set(['entries', 'links', 'entry_tags', 'revisions', 'writing_log']);
      for (const tb of worldTables().filter(n => !own.has(n))) {
        for (const c of db.columns(tb).filter(c => c !== 'id' && c !== 'world_id')) {
          const r = db.run(`UPDATE OR IGNORE "${tb}" SET "${c}" = replace("${c}", ?, ?) WHERE world_id = ? AND typeof("${c}") = 'text' AND instr("${c}", ?) > 0`, fromId, intoId, a.worldId, fromId);
          if (r && r.changes) touched.add(tb);
        }
      }
      if (db.run('UPDATE worlds SET settings = replace(settings, ?, ?) WHERE id = ? AND instr(settings, ?) > 0', fromId, intoId, a.worldId, fromId).changes) touched.add('worlds');
      db.run(`INSERT INTO writing_log (world_id, day, entry_id, words, seconds) SELECT world_id, day, ?, words, seconds FROM writing_log WHERE entry_id = ?
        ON CONFLICT (world_id, day, entry_id) DO UPDATE SET words = words + excluded.words, seconds = seconds + excluded.seconds`, intoId, fromId);
      db.run('DELETE FROM writing_log WHERE entry_id = ?', fromId);
      db.run('INSERT OR IGNORE INTO entry_tags (entry_id, tag_id) SELECT ?, tag_id FROM entry_tags WHERE entry_id = ?', intoId, fromId);
      db.run(`UPDATE entries SET aliases = ?, fields = ?, summary = ?, body = ?, cover_id = coalesce(cover_id, ?),
        start_day = coalesce(start_day, ?), start_min = coalesce(start_min, ?), start_prec = coalesce(start_prec, ?),
        end_day = coalesce(end_day, ?), end_min = coalesce(end_min, ?), end_prec = coalesce(end_prec, ?), updated_at = ? WHERE id = ?`,
        aliases, fields, a.summary || b.summary, T.sanitize(body || ''), b.coverId, b.start && b.start.day, b.start && b.start.min, b.start && b.start.prec,
        b.end && b.end.day, b.end && b.end.min, b.end && b.end.prec, now(), intoId);
      db.run('DELETE FROM entries_fts WHERE entry_id = ?', fromId);
      db.run('DELETE FROM entries WHERE id = ?', fromId);
      const after = rawEntry(intoId), text = T.text(after.body || '');
      db.run('UPDATE entries SET body_text = ?, word_count = ? WHERE id = ?', text, T.words(text), intoId);
      for (const r of db.all('SELECT id FROM entries WHERE world_id = ? AND body LIKE ?', a.worldId, '%' + intoId + '%')) syncMentions(r.id);
      syncFts(intoId); syncMentions(intoId); syncFieldLinks(intoId);
    });
    ctx.changed([...touched], [intoId, fromId]);
    return full(intoId);
  }

  /** everything around an entry: breadcrumb, children, relations both ways, backlinks, outgoing references */
  function context(id) {
    const e = rawEntry(id);
    if (!e) throw new Error('That entry no longer exists.');
    const crumb = [];
    let p = e.parent_id, guard = 0;
    while (p && guard++ < 50) { const x = lite(p); if (!x) break; crumb.unshift(x); p = x.parentId; }
    const rels = db.all(`SELECT l.*, r.name AS rname, r.inverse AS rinverse, r.color AS rcolor, r.category AS rcat, r.family_role AS rrole, r.symmetric AS rsym
      FROM links l JOIN rel_types r ON r.id = l.rel_id WHERE l.kind = 'relation' AND (l.src = ? OR l.dst = ?)`, id, id);
    const other = (l) => (l.src === id ? l.dst : l.src);
    const lites = new Map();
    const L = x => { if (!lites.has(x)) lites.set(x, lite(x)); return lites.get(x); };
    const relations = rels.map(l => ({ link: linkRow(l), dir: l.src === id ? 'out' : 'in', label: l.src === id ? l.rname : l.rinverse, color: l.rcolor, category: l.rcat, familyRole: l.rrole, symmetric: !!l.rsym, other: L(other(l)) }))
      .filter(r => r.other && !r.other.deletedAt);
    const incoming = db.all("SELECT * FROM links WHERE dst = ? AND kind != 'relation'", id).map(linkRow);
    const outgoing = db.all("SELECT * FROM links WHERE src = ? AND kind != 'relation'", id).map(linkRow);
    const group = (list, end) => list.map(l => ({ link: l, entry: L(l[end]) })).filter(x => x.entry && !x.entry.deletedAt);
    return {
      breadcrumb: crumb,
      children: listEntries(e.world_id, { parentId: id }),
      relations,
      mentionedBy: group(incoming.filter(l => l.kind === 'mention'), 'src'),
      referencedBy: group(incoming.filter(l => l.kind === 'field'), 'src'),
      mentions: group(outgoing.filter(l => l.kind === 'mention'), 'dst'),
      references: group(outgoing.filter(l => l.kind === 'field'), 'dst'),
      revisions: db.value('SELECT count(*) FROM revisions WHERE entry_id = ?', id) || 0,
    };
  }

  /* ---------------- search ---------------- */
  function ftsQuery(text) {
    const toks = String(text).normalize('NFKC').split(/[^\p{L}\p{N}_'’]+/u).filter(Boolean).slice(0, 12);
    return toks.length ? toks.map(t => '"' + t.replace(/"/g, '') + '"*').join(' ') : '';
  }
  function search(worldId, q, o = {}) {
    let text = String(q || '');
    const types = [].concat(o.typeIds || []), tags = [];
    let fav = false, inbox = null, dated = false;
    text = text.replace(/(?:^|\s)(?:t|type):(\S+)/gi, (m, k) => { const t = typesOf(worldId).find(x => x.key === k.toLowerCase() || x.name.toLowerCase().startsWith(k.toLowerCase()) || x.plural.toLowerCase().startsWith(k.toLowerCase())); if (t) types.push(t.id); return ' '; });
    text = text.replace(/(?:^|\s)#([\p{L}\p{N}_-]+)/giu, (m, n) => { const t = db.get('SELECT id FROM tags WHERE world_id = ? AND lower(name) = lower(?)', worldId, n); if (t) tags.push(t.id); return ' '; });
    text = text.replace(/(?:^|\s)is:(fav|favorite|inbox)\b/gi, (m, k) => { if (/fav/i.test(k)) fav = true; else inbox = true; return ' '; });
    text = text.replace(/(?:^|\s)has:date\b/gi, () => { dated = true; return ' '; }).trim();
    const limit = Math.max(1, Math.min(500, +o.limit || 40));
    const filt = { typeIds: types, tagIds: tags, favorite: fav, inbox, dated };
    if (!text) return listEntries(worldId, Object.assign(filt, { sort: 'updated', limit })).map(e => Object.assign(e, { snippet: e.summary, score: 0 }));
    const fq = ftsQuery(text);
    const hits = new Map();
    if (fq) {
      try {
        for (const r of db.all(`SELECT entry_id, bm25(entries_fts, 0, 0, 12, 7, 3, 1, 2) AS score,
          snippet(entries_fts, 5, char(1), char(2), '…', 14) AS sb, snippet(entries_fts, 6, char(1), char(2), '…', 10) AS sf
          FROM entries_fts WHERE entries_fts MATCH ? AND world_id = ? ORDER BY score LIMIT ?`, fq, worldId, limit * 3)) {
          hits.set(r.entry_id, { score: r.score, snippet: /\u0001/.test(r.sb) ? r.sb : /\u0001/.test(r.sf) ? r.sf : '' });
        }
      } catch { }
    }
    // titles containing the text anywhere (not only at word starts)
    for (const r of db.all('SELECT id FROM entries WHERE world_id = ? AND deleted_at IS NULL AND (title LIKE ? OR aliases LIKE ?) LIMIT ?', worldId, '%' + text + '%', '%' + text + '%', limit)) {
      const h = hits.get(r.id); hits.set(r.id, { score: (h ? h.score : 0) - 50, snippet: h ? h.snippet : '' });
    }
    if (!hits.size) return [];
    const list = listEntries(worldId, Object.assign(filt, { ids: [...hits.keys()] }));
    const low = text.toLowerCase();
    for (const e of list) {
      const h = hits.get(e.id);
      e.score = h.score - (e.title.toLowerCase() === low ? 1000 : e.title.toLowerCase().startsWith(low) ? 100 : 0);
      e.snippet = h.snippet || e.summary;
    }
    return list.sort((a, b) => a.score - b.score).slice(0, limit);
  }

  /* ---------------- relations ---------------- */
  function relate({ src, dst, relId, note = '', start = null, end = null }) {
    const a = rawEntry(src), b = rawEntry(dst);
    if (!a || !b) throw new Error('Both entries must exist.');
    if (src === dst) throw new Error('An entry can\'t be related to itself.');
    const r = db.get('SELECT * FROM rel_types WHERE id = ?', relId);
    if (!r || r.world_id !== a.world_id) throw new Error('Pick a kind of relation.');
    const dup = db.get(`SELECT id FROM links WHERE kind = 'relation' AND rel_id = ? AND ((src = ? AND dst = ?)${r.symmetric ? ' OR (src = ? AND dst = ?)' : ''})`, relId, src, dst, ...(r.symmetric ? [dst, src] : []));
    if (dup) return linkRow(db.get('SELECT * FROM links WHERE id = ?', dup.id));
    const id = uid(), s = cleanDate(start), e = cleanDate(end);
    db.run("INSERT INTO links (id, world_id, src, dst, kind, rel_id, note, start_day, start_prec, end_day, end_prec, created_at) VALUES (?,?,?,?, 'relation', ?,?,?,?,?,?,?)",
      id, a.world_id, src, dst, relId, String(note || ''), s && s.day, s && s.prec, e && e.day, e && e.prec, now());
    ctx.changed(['links'], [src, dst]);
    return linkRow(db.get('SELECT * FROM links WHERE id = ?', id));
  }
  function updateLink(id, p = {}) {
    const l = db.get('SELECT * FROM links WHERE id = ?', id);
    if (!l) throw new Error('That link no longer exists.');
    if (p.note != null) db.run('UPDATE links SET note = ? WHERE id = ?', String(p.note), id);
    if (p.start !== undefined) { const d = cleanDate(p.start); db.run('UPDATE links SET start_day = ?, start_prec = ? WHERE id = ?', d && d.day, d && d.prec, id); }
    if (p.end !== undefined) { const d = cleanDate(p.end); db.run('UPDATE links SET end_day = ?, end_prec = ? WHERE id = ?', d && d.day, d && d.prec, id); }
    if (p.relId) db.run('UPDATE links SET rel_id = ? WHERE id = ?', p.relId, id);
    if (p.swap) db.run('UPDATE links SET src = dst, dst = src WHERE id = ?', id);
    ctx.changed(['links'], [l.src, l.dst]);
    return linkRow(db.get('SELECT * FROM links WHERE id = ?', id));
  }

  /* ---------------- types ---------------- */
  function saveType(t) {
    if (!t || !t.worldId) throw new Error('A type needs a world.');
    const fields = cleanFields(t.fields || []);
    if (t.id) {
      const old = typeById(t.id);
      if (!old) throw new Error('That type no longer exists.');
      db.run(`UPDATE types SET name = ?, plural = ?, icon = ?, color = ?, fields = ?, dated = ?, lifespan = ?, hierarchical = ?, child_types = ?,
        pinnable = ?, default_audience = ?, namegen = ?, hidden = ? WHERE id = ?`,
        String(t.name || old.name).slice(0, 60), String(t.plural || t.name || old.plural).slice(0, 60), t.icon || old.icon, t.color || old.color, fields,
        t.dated === undefined ? old.dated : t.dated, t.lifespan == null ? old.lifespan : !!t.lifespan, t.hierarchical == null ? old.hierarchical : !!t.hierarchical,
        t.childTypes || old.childTypes, t.pinnable == null ? old.pinnable : !!t.pinnable, t.defaultAudience === undefined ? old.defaultAudience : t.defaultAudience,
        t.namegen == null ? old.namegen : !!t.namegen, t.hidden == null ? old.hidden : !!t.hidden, t.id);
      for (const r of db.all('SELECT id FROM entries WHERE type_id = ?', t.id)) { syncFieldLinks(r.id); syncFts(r.id); }
      ctx.changed(['types', 'links'], [t.id]);
      return typeById(t.id);
    }
    let key = slugify(t.key || t.name) || 'type', n = 1;
    while (typeByKey(t.worldId, key)) key = slugify(t.key || t.name) + '_' + (++n);
    const id = uid();
    db.run(`INSERT INTO types (id, world_id, key, name, plural, icon, color, fields, dated, lifespan, hierarchical, child_types, lens, pinnable,
      default_audience, namegen, hidden, builtin, sort) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,NULL,?,?,?,0,0,?)`,
      id, t.worldId, key, String(t.name || 'New type').slice(0, 60), String(t.plural || t.name || 'New types').slice(0, 60), t.icon || '◆', t.color || '#7c8fb3',
      fields, t.dated || null, !!t.lifespan, !!t.hierarchical, t.childTypes || [], !!t.pinnable, t.defaultAudience || null, !!t.namegen,
      (db.value('SELECT max(sort) FROM types WHERE world_id = ?', t.worldId) || 0) + 10);
    ctx.changed(['types'], [id]);
    return typeById(id);
  }
  function cleanFields(list) {
    const seen = new Set();
    return list.filter(Boolean).map(d => {
      let key = slugify(d.key || d.label) || 'field';
      while (seen.has(key)) key += '_2';
      seen.add(key);
      const kind = F.KINDS[d.kind] ? d.kind : 'text';
      const out = { key, label: String(d.label || key).slice(0, 80), kind };
      if (F.KINDS[kind].options) out.options = (d.options || []).map(String).map(s => s.trim()).filter(Boolean).slice(0, 200);
      if (F.KINDS[kind].link) out.refTypes = (d.refTypes || []).map(String);
      for (const k of ['unit', 'hint', 'group']) if (d[k]) out[k] = String(d[k]).slice(0, 200);
      for (const k of ['secret', 'required', 'wide']) if (d[k]) out[k] = true;
      return out;
    });
  }
  function removeType(id, { moveTo } = {}) {
    const t = typeById(id);
    if (!t) return true;
    if (t.builtin) throw new Error('Built-in types can be hidden but not deleted.');
    const n = db.value('SELECT count(*) FROM entries WHERE type_id = ?', id);
    if (n && !moveTo) throw new Error(`${n} ${n === 1 ? 'entry uses' : 'entries use'} this type. Move them to another type first.`);
    if (ctx.has('backup.create')) { try { ctx.call('backup.create', 'Before deleting the type ' + t.name); } catch { } }
    db.tx(() => {
      if (n) { db.run('UPDATE entries SET type_id = ? WHERE type_id = ?', moveTo, id); for (const r of db.all('SELECT id FROM entries WHERE type_id = ?', moveTo)) { syncFieldLinks(r.id); syncFts(r.id); } }
      db.run('DELETE FROM types WHERE id = ?', id);
    });
    ctx.changed(['types', 'entries'], [id]);
    return true;
  }

  /* ---------------- text tools: unlinked mentions, find & replace ---------------- */
  const reEsc = s => String(s).replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const tagHtml = tk => tk.t === 'close' ? '</' + tk.tag + '>' : '<' + tk.tag + Object.entries(tk.a || {}).map(([k, v]) => ' ' + k + '="' + T.escAttr(v) + '"').join('') + '>';
  /** calls fn(text) for every text run outside links, returns rebuilt HTML (fn returns HTML for the run) */
  function mapText(html, fn) {
    const out = [];
    let inA = 0;
    for (const tk of T.tokens(html || '')) {
      if (tk.t === 'text') out.push(inA ? T.esc(tk.v) : fn(tk.v));
      else { if (tk.tag === 'a') inA += tk.t === 'open' ? 1 : -1; out.push(tagHtml(tk)); }
    }
    return out.join('');
  }
  function nameIndex(worldId, onlyId) {
    const rows = db.all('SELECT id, title, aliases FROM entries WHERE world_id = ? AND deleted_at IS NULL' + (onlyId ? ' AND id = ?' : ''), ...[worldId].concat(onlyId ? [onlyId] : []));
    const names = new Map();
    for (const r of rows) for (const n of [r.title].concat(J(r.aliases, []))) {
      const s = String(n || '').trim();
      if (s.length < 3 || /^untitled /i.test(s) || !/\p{Lu}/u.test(s)) continue;   // proper names only: they carry a capital
      if (!names.has(s)) names.set(s, r.id);
    }
    const list = [...names.keys()].sort((a, b) => b.length - a.length);
    return { names, re: list.length ? new RegExp('(?<![\\p{L}\\p{N}])(' + list.map(reEsc).join('|') + ')(?![\\p{L}\\p{N}])', 'gu') : null };
  }
  function unlinked(worldId, { targetId, limit = 500 } = {}) {
    const { names, re } = nameIndex(worldId, targetId);
    if (!re) return [];
    const out = new Map();
    const rows = db.all("SELECT id, title, body FROM entries WHERE world_id = ? AND deleted_at IS NULL AND body != ''", worldId);
    for (const r of rows) {
      const linked = new Set(T.mentions(r.body));
      mapText(r.body, txt => {
        re.lastIndex = 0;
        let m;
        while ((m = re.exec(txt))) {
          const target = names.get(m[1]);
          if (!target || target === r.id || linked.has(target)) continue;
          const k = r.id + '>' + target;
          const x = out.get(k) || { src: r.id, target, name: m[1], count: 0, snippet: '' };
          x.count++;
          if (!x.snippet) x.snippet = '…' + txt.slice(Math.max(0, m.index - 50), m.index) + '\u0001' + m[1] + '\u0002' + txt.slice(m.index + m[1].length, m.index + m[1].length + 50) + '…';
          out.set(k, x);
        }
        return '';
      });
      if (out.size >= limit) break;
    }
    return [...out.values()].map(x => Object.assign(x, { srcTitle: titleOf(x.src), targetTitle: titleOf(x.target) }));
  }
  function linkUnlinked(worldId, pairs, { all = false } = {}) {
    const bySrc = new Map();
    for (const p of pairs || []) { if (!bySrc.has(p.src)) bySrc.set(p.src, new Set()); bySrc.get(p.src).add(p.target); }
    let n = 0;
    for (const [src, targets] of bySrc) {
      const r = rawEntry(src);
      if (!r) continue;
      const wanted = new Map();
      for (const t of targets) { const { names } = nameIndex(worldId, t); for (const [name] of names) wanted.set(name, t); }
      if (!wanted.size) continue;
      const re = new RegExp('(?<![\\p{L}\\p{N}])(' + [...wanted.keys()].sort((a, b) => b.length - a.length).map(reEsc).join('|') + ')(?![\\p{L}\\p{N}])', 'gu');
      const done = new Set();
      const html = mapText(r.body, txt => {
        let last = 0, s = '';
        re.lastIndex = 0;
        let m;
        while ((m = re.exec(txt))) {
          const id = wanted.get(m[1]);
          if (!id || (!all && done.has(id))) continue;
          done.add(id); n++;
          s += T.esc(txt.slice(last, m.index)) + '<a class="wb-m" data-id="' + id + '">' + T.esc(m[1]) + '</a>';
          last = m.index + m[1].length;
        }
        return s + T.esc(txt.slice(last));
      });
      if (html !== r.body) updateEntry(src, { body: html });
    }
    return { linked: n };
  }
  function findText(worldId, find, o = {}) {
    if (!find) return [];
    const re = new RegExp((o.wholeWord ? '(?<![\\p{L}\\p{N}])' : '') + reEsc(find) + (o.wholeWord ? '(?![\\p{L}\\p{N}])' : ''), 'gu' + (o.matchCase ? '' : 'i'));
    const out = [];
    for (const r of db.all('SELECT id, title, summary, body FROM entries WHERE world_id = ? AND deleted_at IS NULL', worldId)) {
      let count = 0, snippet = '';
      const hit = (txt, where) => { re.lastIndex = 0; let m; while ((m = re.exec(txt))) { count++; if (!snippet) snippet = (where ? where + ': ' : '') + '…' + txt.slice(Math.max(0, m.index - 40), m.index) + '\u0001' + m[0] + '\u0002' + txt.slice(m.index + m[0].length, m.index + m[0].length + 40) + '…'; if (!m[0].length) re.lastIndex++; } };
      if (o.titles) hit(r.title, 'title');
      hit(r.summary || '', 'summary');
      mapText(r.body, txt => { hit(txt, ''); return ''; });
      if (count) out.push({ id: r.id, title: r.title, count, snippet });
    }
    return out;
  }
  function replaceText(worldId, find, repl, o = {}) {
    if (!find) return { entries: 0, replacements: 0 };
    const re = new RegExp((o.wholeWord ? '(?<![\\p{L}\\p{N}])' : '') + reEsc(find) + (o.wholeWord ? '(?![\\p{L}\\p{N}])' : ''), 'gu' + (o.matchCase ? '' : 'i'));
    let entries = 0, replacements = 0;
    const only = o.ids ? new Set(o.ids) : null;
    if (ctx.has('backup.create')) { try { ctx.call('backup.create', 'Before replacing “' + find + '”'); } catch { } }
    db.tx(() => {
      for (const r of db.all('SELECT id, title, summary, body FROM entries WHERE world_id = ? AND deleted_at IS NULL', worldId)) {
        if (only && !only.has(r.id)) continue;
        let c = 0;
        const sub = s => s.replace(re, () => { c++; return repl; });
        const body = mapText(r.body, txt => T.esc(sub(txt)));
        const summary = sub(r.summary || '');
        const title = o.titles ? sub(r.title) : r.title;
        if (c) { entries++; replacements += c; updateEntry(r.id, { body, summary, title, snapshot: 'before replacing “' + find + '”' }); }
      }
    });
    return { entries, replacements };
  }
  function copyTypes(worldId, fromWorldId, typeIds) {
    let added = 0, merged = 0;
    for (const src of typesOf(fromWorldId).filter(t => !typeIds || typeIds.includes(t.id))) {
      const mine = typeByKey(worldId, src.key);
      if (mine) {
        const keys = new Set(mine.fields.map(f => f.key));
        const extra = src.fields.filter(f => !keys.has(f.key));
        if (extra.length) { saveType(Object.assign({}, mine, { fields: mine.fields.concat(extra) })); merged++; }
      } else {
        saveType(Object.assign({}, src, { id: null, worldId, builtin: false })); added++;
      }
    }
    ctx.changed(['types']);
    return { added, merged };
  }

  /* ---------------- handlers ---------------- */
  ctx.core = { world, calendarFor, typesOf, typeById, typeByKey, full, lite, listEntries, createEntry, updateEntry, relate, ensureTag, syncFts, syncMentions, syncFieldLinks, snapshot, pack, unpack, search };

  return {
    'worlds.list': (o = {}) => db.all(`SELECT * FROM worlds ${o.archived ? '' : 'WHERE archived = 0'} ORDER BY coalesce(opened_at, created_at) DESC`).map(worldRow)
      .map(w => Object.assign(w, { entries: db.value('SELECT count(*) FROM entries WHERE world_id = ? AND deleted_at IS NULL', w.id) || 0 })),
    'worlds.get': id => world(id),
    'worlds.create': o => createWorld(o),
    'worlds.update': (id, p) => updateWorld(id, p),
    'worlds.open': id => { db.run('UPDATE worlds SET opened_at = ? WHERE id = ?', now(), id); return world(id); },
    'worlds.stats': id => worldStats(id),
    'worlds.remove': id => {
      const w = world(id);
      if (ctx.has('backup.create')) { try { ctx.call('backup.create', 'Before deleting the world ' + w.name); } catch { } }
      db.tx(() => { db.run('DELETE FROM entries_fts WHERE world_id = ?', id); db.run('DELETE FROM worlds WHERE id = ?', id); });
      try { fs.rmSync(ctx.paths.media(id), { recursive: true, force: true }); } catch { }
      cals.delete(id);
      ctx.changed(['worlds']);
      return true;
    },
    'worlds.pack': (id, o) => pack(id, o),
    'worlds.unpack': (pk, o) => unpack(pk, o),
    'worlds.duplicate': id => unpack(pack(id), { name: world(id).name + ' (copy)' }),
    'worlds.starters': () => Object.entries(F.STARTERS).map(([key, s]) => ({ key, label: s.label, desc: s.desc })),

    'types.list': worldId => typesOf(worldId),
    'types.save': t => saveType(t),
    'types.remove': (id, o) => removeType(id, o),
    'types.reorder': (worldId, ids) => { db.tx(() => ids.forEach((id, i) => db.run('UPDATE types SET sort = ? WHERE id = ? AND world_id = ?', (i + 1) * 10, id, worldId))); ctx.changed(['types']); return true; },

    'rels.list': worldId => db.all('SELECT * FROM rel_types WHERE world_id = ? ORDER BY sort, name', worldId).map(relRow),
    'rels.save': r => {
      const sym = !!r.symmetric;
      if (r.id) db.run('UPDATE rel_types SET name = ?, inverse = ?, category = ?, family_role = ?, symmetric = ?, color = ? WHERE id = ?',
        String(r.name).slice(0, 60), sym ? String(r.name).slice(0, 60) : String(r.inverse || r.name).slice(0, 60), r.category || 'other', r.familyRole || null, sym, r.color || '', r.id);
      else { r.id = uid(); db.run('INSERT INTO rel_types (id, world_id, name, inverse, category, family_role, symmetric, color, builtin, sort) VALUES (?,?,?,?,?,?,?,?,0,?)',
        r.id, r.worldId, String(r.name || 'related to').slice(0, 60), sym ? String(r.name).slice(0, 60) : String(r.inverse || r.name).slice(0, 60), r.category || 'other', r.familyRole || null, sym, r.color || '',
        (db.value('SELECT max(sort) FROM rel_types WHERE world_id = ?', r.worldId) || 0) + 10); }
      ctx.changed(['rel_types']);
      return relRow(db.get('SELECT * FROM rel_types WHERE id = ?', r.id));
    },
    'rels.remove': id => { db.run('DELETE FROM rel_types WHERE id = ?', id); ctx.changed(['rel_types', 'links']); return true; },
    'rels.count': id => db.value("SELECT count(*) FROM links WHERE rel_id = ?", id) || 0,

    'entries.list': (worldId, f) => listEntries(worldId, f),
    'entries.get': id => full(id),
    /** lite rows plus field values (no body): for tables and exports */
    'entries.withFields': (worldId, f) => {
      const list = listEntries(worldId, f);
      if (!list.length) return list;
      const map = new Map(db.all(`SELECT id, fields FROM entries WHERE id IN (${placeholders(list.length)})`, ...list.map(e => e.id)).map(r => [r.id, J(r.fields, {})]));
      for (const e of list) e.fields = map.get(e.id) || {};
      return list;
    },
    /** many entries at once from a list of titles (one per line) */
    'entries.createMany': (worldId, typeId, titles, o = {}) => {
      const out = [];
      db.tx(() => { for (const t of (titles || []).map(s => String(s).trim()).filter(Boolean).slice(0, 2000)) out.push(createEntry({ worldId, typeId, title: t, parentId: o.parentId || null, tagNames: o.tagNames })); });
      return out.map(e => ({ id: e.id, title: e.title }));
    },
    'entries.lite': id => lite(id),
    'entries.many': ids => (ids && ids.length ? db.all(`SELECT ${LITE} FROM entries e WHERE e.id IN (${placeholders(ids.length)})`, ...ids).map(r => entryRow(r)) : []),
    'entries.create': d => createEntry(d),
    'entries.update': (id, p) => updateEntry(id, p),
    'entries.trash': id => trash(id),
    'entries.restore': id => restore(id),
    'entries.purge': id => purge(id),
    'entries.emptyTrash': worldId => { const ids = db.all('SELECT id FROM entries WHERE world_id = ? AND deleted_at IS NOT NULL AND trash_root = id', worldId).map(r => r.id); for (const i of ids) purge(i); return { n: ids.length }; },
    'entries.move': (id, o) => moveEntry(id, o),
    'entries.reorder': (ids) => { db.tx(() => ids.forEach((id, i) => db.run('UPDATE entries SET position = ? WHERE id = ?', i + 1, id))); ctx.changed(['entries'], ids); return true; },
    'entries.duplicate': (id, o) => duplicate(id, o),
    'entries.merge': (into, from) => merge(into, from),
    'entries.context': id => context(id),
    'entries.titles': worldId => db.all('SELECT id, title, aliases, type_id, audience, reveal_day, parent_id FROM entries WHERE world_id = ? AND deleted_at IS NULL ORDER BY title COLLATE NOCASE', worldId)
      .map(r => ({ id: r.id, title: r.title, aliases: J(r.aliases, []), typeId: r.type_id, audience: r.audience, revealDay: r.reveal_day, parentId: r.parent_id })),
    'entries.setTags': (id, tagIds) => { setTags(id, tagIds); db.run('UPDATE entries SET updated_at = ? WHERE id = ?', now(), id); ctx.changed(['entries', 'tags'], [id]); return full(id); },
    'entries.addTag': (id, name) => { const e = rawEntry(id); const tid = ensureTag(e.world_id, name); if (tid) db.run('INSERT OR IGNORE INTO entry_tags (entry_id, tag_id) VALUES (?,?)', id, tid); ctx.changed(['entries', 'tags'], [id]); return full(id); },
    'entries.bulk': (ids, p) => { const out = []; db.tx(() => { for (const id of ids) { if (p.trash) out.push(trash(id)); else if (p.addTag) { const e = rawEntry(id); const tid = ensureTag(e.world_id, p.addTag); db.run('INSERT OR IGNORE INTO entry_tags (entry_id, tag_id) VALUES (?,?)', id, tid); } else out.push(updateEntry(id, p)); } }); ctx.changed(['entries', 'tags'], ids); return { n: ids.length }; },
    'entries.recentlyEdited': (worldId, n = 12) => listEntries(worldId, { sort: 'updated', limit: n }),
    /** entries missing recommended (required) fields or any text: prompts for what to write next */
    'entries.gaps': (worldId, limit = 12) => {
      const types = typesOf(worldId).filter(t => !t.hidden);
      const req = new Map(types.map(t => [t.id, (t.fields || []).filter(d => d.required)]));
      const out = [];
      for (const r of db.all(`SELECT id, type_id, title, fields, summary, body_text FROM entries WHERE world_id = ? AND deleted_at IS NULL AND inbox = 0 ORDER BY random() LIMIT 400`, worldId)) {
        const fields = J(r.fields, {});
        const missing = (req.get(r.type_id) || []).filter(d => !F.filled(d.kind, fields[d.key]));
        if (missing.length) out.push({ id: r.id, title: r.title, typeId: r.type_id, field: missing[0].key, label: missing[0].label, kind: 'field' });
        else if (!r.summary && !(r.body_text || '').trim()) out.push({ id: r.id, title: r.title, typeId: r.type_id, kind: 'empty' });
        if (out.length >= limit) break;
      }
      return out;
    },
    'entries.onDay': (worldId, month, day) => {
      // entries whose start or end falls on this month/day of any year (anniversaries)
      const cal = calendarFor(worldId), out = [];
      for (const r of db.all(`SELECT ${LITE} FROM entries e WHERE e.world_id = ? AND e.deleted_at IS NULL AND (e.start_day IS NOT NULL OR e.end_day IS NOT NULL)`, worldId)) {
        const e = entryRow(r);
        for (const [which, d] of [['start', e.start], ['end', e.end]]) {
          if (!d || d.prec === 'year' || d.prec === 'month') continue;
          const p = cal.ymd(d.day);
          if (p.m === month && p.d === day) out.push(Object.assign({ which }, e));
        }
      }
      return out;
    },
    'entries.find': (worldId, title) => { const r = db.get('SELECT id FROM entries WHERE world_id = ? AND deleted_at IS NULL AND (lower(title) = lower(?) OR aliases LIKE ?)', worldId, String(title).trim(), '%"' + String(title).trim() + '"%'); return r ? lite(r.id) : null; },

    'links.unlinked': (worldId, o) => unlinked(worldId, o),
    'links.linkUnlinked': (worldId, pairs, o) => linkUnlinked(worldId, pairs, o),
    'text.find': (worldId, find, o) => findText(worldId, find, o),
    'text.replace': (worldId, find, repl, o) => replaceText(worldId, find, repl, o),
    'types.copyFrom': (worldId, fromWorldId, typeIds) => copyTypes(worldId, fromWorldId, typeIds),
    'entries.random': (worldId, o = {}) => { const r = db.get(`SELECT id FROM entries WHERE world_id = ? AND deleted_at IS NULL AND inbox = 0 ${o.audience ? "AND audience != 'private'" : ''} ORDER BY random() LIMIT 1`, worldId); return r ? lite(r.id) : null; },
    'links.relate': o => relate(o),
    'links.update': (id, p) => updateLink(id, p),
    'links.remove': id => { const l = db.get('SELECT * FROM links WHERE id = ?', id); db.run('DELETE FROM links WHERE id = ?', id); if (l) ctx.changed(['links'], [l.src, l.dst]); return true; },
    'links.all': (worldId, o = {}) => {
      const kinds = o.kinds && o.kinds.length ? o.kinds : ['mention', 'field', 'relation'];
      return db.all(`SELECT l.* FROM links l JOIN entries a ON a.id = l.src JOIN entries b ON b.id = l.dst
        WHERE l.world_id = ? AND a.deleted_at IS NULL AND b.deleted_at IS NULL AND l.kind IN (${placeholders(kinds.length)})`, worldId, ...kinds).map(linkRow);
    },
    'links.relations': worldId => db.all(`SELECT l.*, r.name AS rname, r.inverse AS rinverse, r.category AS rcat, r.family_role AS rrole, r.color AS rcolor
      FROM links l JOIN rel_types r ON r.id = l.rel_id JOIN entries a ON a.id = l.src JOIN entries b ON b.id = l.dst
      WHERE l.world_id = ? AND l.kind = 'relation' AND a.deleted_at IS NULL AND b.deleted_at IS NULL`, worldId)
      .map(r => Object.assign(linkRow(r), { name: r.rname, inverse: r.rinverse, category: r.rcat, familyRole: r.rrole, color: r.rcolor })),

    'tags.list': worldId => db.all(`SELECT t.*, (SELECT count(*) FROM entry_tags et JOIN entries e ON e.id = et.entry_id WHERE et.tag_id = t.id AND e.deleted_at IS NULL) AS n
      FROM tags t WHERE t.world_id = ? ORDER BY t.name COLLATE NOCASE`, worldId).map(r => ({ id: r.id, worldId: r.world_id, name: r.name, color: r.color || '', count: r.n })),
    'tags.save': t => {
      const name = String(t.name || '').trim().replace(/^#/, '').slice(0, 60);
      if (!name) throw new Error('A tag needs a name.');
      if (t.id) db.run('UPDATE tags SET name = ?, color = ? WHERE id = ?', name, t.color || '', t.id);
      else t.id = ensureTag(t.worldId, name, t.color);
      ctx.changed(['tags']);
      return db.get('SELECT * FROM tags WHERE id = ?', t.id);
    },
    'tags.ensure': (worldId, name) => { const id = ensureTag(worldId, name); ctx.changed(['tags']); return db.get('SELECT * FROM tags WHERE id = ?', id); },
    'tags.remove': id => { db.run('DELETE FROM tags WHERE id = ?', id); ctx.changed(['tags', 'entries']); return true; },
    'tags.merge': (intoId, fromId) => { db.tx(() => { db.run('INSERT OR IGNORE INTO entry_tags (entry_id, tag_id) SELECT entry_id, ? FROM entry_tags WHERE tag_id = ?', intoId, fromId); db.run('DELETE FROM tags WHERE id = ?', fromId); }); ctx.changed(['tags', 'entries']); return true; },

    'collections.list': worldId => db.all('SELECT * FROM collections WHERE world_id = ? ORDER BY sort, name', worldId).map(r => ({ id: r.id, worldId: r.world_id, name: r.name, icon: r.icon || '', query: J(r.query, {}), sort: r.sort })),
    'collections.save': c => {
      if (c.id) db.run('UPDATE collections SET name = ?, icon = ?, query = ? WHERE id = ?', String(c.name || 'Collection').slice(0, 80), c.icon || '', c.query || {}, c.id);
      else { c.id = uid(); db.run('INSERT INTO collections (id, world_id, name, icon, query, sort) VALUES (?,?,?,?,?,?)', c.id, c.worldId, String(c.name || 'Collection').slice(0, 80), c.icon || '', c.query || {}, (db.value('SELECT max(sort) FROM collections WHERE world_id = ?', c.worldId) || 0) + 1); }
      ctx.changed(['collections']);
      return c;
    },
    'collections.remove': id => { db.run('DELETE FROM collections WHERE id = ?', id); ctx.changed(['collections']); return true; },

    'search.query': (worldId, q, o) => search(worldId, q, o),

    'revisions.list': entryId => db.all('SELECT id, title, summary, reason, created_at, length(body) AS size, body FROM revisions WHERE entry_id = ? ORDER BY created_at DESC', entryId)
      .map(r => ({ id: r.id, title: r.title, reason: r.reason, createdAt: r.created_at, words: T.words(T.text(r.body || '')) })),
    'revisions.get': id => { const r = db.get('SELECT * FROM revisions WHERE id = ?', id); return r && { id: r.id, entryId: r.entry_id, title: r.title, summary: r.summary || '', body: r.body || '', fields: J(r.fields, {}), reason: r.reason, createdAt: r.created_at }; },
    'revisions.restore': id => {
      const r = db.get('SELECT * FROM revisions WHERE id = ?', id);
      if (!r) throw new Error('That version no longer exists.');
      return updateEntry(r.entry_id, { title: r.title, summary: r.summary || '', body: r.body || '', fields: J(r.fields, {}), snapshot: 'before restoring a version' });
    },
    'revisions.snapshot': (entryId, reason) => { snapshot(entryId, reason || 'manual'); ctx.changed(['revisions'], [entryId]); return true; },

    'calendar.preview': (cal, days) => { const c = Cal.create(cal); return (days || []).map(d => c.format({ day: d, prec: 'day' }, 'full')); },
    'app.reindex': worldId => { const ids = db.all('SELECT id FROM entries WHERE world_id = ?', worldId).map(r => r.id); db.tx(() => { for (const id of ids) { syncFts(id); syncMentions(id); syncFieldLinks(id); } }); ctx.changed(['entries', 'links']); return { n: ids.length }; },
    'app.dbInfo': () => {
      let size = 0; try { size = fs.statSync(db.file).size + (fs.existsSync(db.file + '-wal') ? fs.statSync(db.file + '-wal').size : 0); } catch { }
      return { file: db.file, size, worlds: db.value('SELECT count(*) FROM worlds'), entries: db.value('SELECT count(*) FROM entries'), sqlite: db.value('SELECT sqlite_version()') };
    },
    'app.vacuum': () => { db.exec("INSERT INTO entries_fts(entries_fts) VALUES('optimize')"); db.exec('VACUUM'); return true; },
    'app.openData': () => { if (ctx.shell) ctx.shell.openPath(ctx.paths.data); return true; },
    'meta.get': key => { const r = db.get('SELECT value FROM meta WHERE key = ?', key); return r ? J(r.value, r.value) : null; },
    'meta.set': (key, value) => { db.run('INSERT INTO meta (key, value) VALUES (?, ?) ON CONFLICT (key) DO UPDATE SET value = excluded.value', key, JSON.stringify(value)); return true; },
  };
}

module.exports = { migrations, handlers };
