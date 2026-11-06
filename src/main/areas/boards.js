'use strict';
/* Boards: infinite canvases. A board is an entry (type lens 'board'); its cards live in board_items and its
   connectors in board_links. Image cards also list their media in the board entry's data.media so the Library's
   "used by" and the unused-media check see them. */
const T = require('../../shared/richtext');
const { uid, now, J, placeholders } = require('../util');
const TPL = require('../lib/boards-templates');
const ART = require('../lib/boards-art');

const migrations = [{
  id: 'boards-001',
  sql: `
  CREATE TABLE board_items (id TEXT PRIMARY KEY, world_id TEXT NOT NULL REFERENCES worlds(id) ON DELETE CASCADE,
    board_id TEXT NOT NULL REFERENCES entries(id) ON DELETE CASCADE, kind TEXT NOT NULL DEFAULT 'note',
    entry_id TEXT REFERENCES entries(id) ON DELETE SET NULL, media_id TEXT, text TEXT DEFAULT '', data TEXT DEFAULT '{}',
    x REAL DEFAULT 0, y REAL DEFAULT 0, w REAL DEFAULT 200, h REAL DEFAULT 140, color TEXT DEFAULT '', z REAL DEFAULT 0,
    created_at TEXT, updated_at TEXT);
  CREATE INDEX board_items_board ON board_items (board_id, z);
  CREATE INDEX board_items_entry ON board_items (entry_id);
  CREATE INDEX board_items_world ON board_items (world_id);
  CREATE TABLE board_links (id TEXT PRIMARY KEY, world_id TEXT NOT NULL REFERENCES worlds(id) ON DELETE CASCADE,
    board_id TEXT NOT NULL REFERENCES entries(id) ON DELETE CASCADE,
    from_item TEXT NOT NULL REFERENCES board_items(id) ON DELETE CASCADE, to_item TEXT NOT NULL REFERENCES board_items(id) ON DELETE CASCADE,
    label TEXT DEFAULT '', style TEXT DEFAULT '{}', created_at TEXT);
  CREATE INDEX board_links_board ON board_links (board_id);
  `,
}];

const KINDS = ['note', 'entry', 'image', 'checklist', 'frame', 'text'];
const SIZE = { note: [220, 150], entry: [250, 140], image: [280, 200], checklist: [250, 180], frame: [560, 400], text: [300, 64] };
const RICH = new Set(['note', 'text']);
const ID = /^[a-z0-9]{10}$/;
const num = (v, d) => (v !== null && v !== '' && Number.isFinite(+v) ? +v : d);
const clamp = (v, a, b) => Math.max(a, Math.min(b, v));

function handlers(ctx) {
  const { db } = ctx;

  const itemRow = r => r && ({
    id: r.id, worldId: r.world_id, boardId: r.board_id, kind: r.kind, entryId: r.entry_id || null, mediaId: r.media_id || null,
    text: r.text || '', data: J(r.data, {}), x: r.x, y: r.y, w: r.w, h: r.h, color: r.color || '', z: r.z || 0, createdAt: r.created_at, updatedAt: r.updated_at,
  });
  const linkRow = r => r && ({ id: r.id, worldId: r.world_id, boardId: r.board_id, from: r.from_item, to: r.to_item, label: r.label || '', style: J(r.style, {}), createdAt: r.created_at });
  const getItem = id => itemRow(db.get('SELECT * FROM board_items WHERE id = ?', id));
  const getLink = id => linkRow(db.get('SELECT * FROM board_links WHERE id = ?', id));
  const boardTypeIds = worldId => db.all("SELECT id FROM types WHERE world_id = ? AND lens = 'board'", worldId).map(r => r.id);

  function boardRow(id) {
    const r = db.get('SELECT id, world_id, type_id, deleted_at FROM entries WHERE id = ?', id);
    if (!r) throw new Error('That board no longer exists.');
    return r;
  }
  const entryIn = (worldId, id) => (id && db.get('SELECT 1 FROM entries WHERE id = ? AND world_id = ?', id, worldId) ? id : null);
  /** the board was edited: newest first in lists (no change event; the board screen reloads itself) */
  const touch = boardId => db.run('UPDATE entries SET updated_at = ? WHERE id = ?', now(), boardId);

  /** media used by image cards, kept in the board entry's data so media.usage finds the board */
  function syncMedia(boardId) {
    const ids = db.all("SELECT DISTINCT media_id FROM board_items WHERE board_id = ? AND media_id IS NOT NULL AND media_id != '' ORDER BY media_id", boardId).map(r => r.media_id);
    const r = db.get('SELECT data FROM entries WHERE id = ?', boardId);
    if (!r) return;
    const d = J(r.data, {});
    if (JSON.stringify(d.media || []) === JSON.stringify(ids)) return;
    if (ids.length) d.media = ids; else delete d.media;
    db.run('UPDATE entries SET data = ? WHERE id = ?', d, boardId);
  }

  /** column values for an item from a patch (and the current row when updating) */
  function columns(worldId, it, cur) {
    const kind = KINDS.includes(it.kind) ? it.kind : cur ? cur.kind : 'note';
    const size = SIZE[kind];
    const pick = (k, col, d) => (it[k] !== undefined ? it[k] : cur ? cur[col] : d);
    let text = pick('text', 'text', '');
    text = RICH.has(kind) ? T.sanitize(String(text || '')) : String(text || '').slice(0, 4000);
    const data = it.data !== undefined ? (it.data && typeof it.data === 'object' ? it.data : {}) : cur ? J(cur.data, {}) : {};
    return {
      kind,
      entry_id: it.entryId !== undefined ? entryIn(worldId, it.entryId) : cur ? cur.entry_id : null,
      media_id: it.mediaId !== undefined ? (it.mediaId ? String(it.mediaId) : null) : cur ? cur.media_id : null,
      text, data,
      x: clamp(num(pick('x', 'x', 0), 0), -1e7, 1e7), y: clamp(num(pick('y', 'y', 0), 0), -1e7, 1e7),
      w: clamp(num(pick('w', 'w', size[0]), size[0]), 24, 20000), h: clamp(num(pick('h', 'h', size[1]), size[1]), 24, 20000),
      color: String(pick('color', 'color', '') || '').slice(0, 40), z: num(pick('z', 'z', 0), 0),
    };
  }
  function insertItem(b, it, z) {
    const id = it.id && ID.test(it.id) && !db.get('SELECT 1 FROM board_items WHERE id = ?', it.id) ? it.id : uid();
    const c = columns(b.world_id, Object.assign({}, it, it.z == null ? { z } : {}), null);
    db.run(`INSERT INTO board_items (id, world_id, board_id, kind, entry_id, media_id, text, data, x, y, w, h, color, z, created_at, updated_at)
      VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`, id, b.world_id, b.id, c.kind, c.entry_id, c.media_id, c.text, c.data, c.x, c.y, c.w, c.h, c.color, c.z, it.createdAt || now(), now());
    return id;
  }
  function insertLink(b, l) {
    const a = db.get('SELECT board_id FROM board_items WHERE id = ?', l.from), c = db.get('SELECT board_id FROM board_items WHERE id = ?', l.to);
    if (!a || !c || a.board_id !== b.id || c.board_id !== b.id) throw new Error('Connect two cards on the same board.');
    if (l.from === l.to) throw new Error('A card can\'t connect to itself.');
    const dup = db.get('SELECT id FROM board_links WHERE board_id = ? AND from_item = ? AND to_item = ?', b.id, l.from, l.to);
    if (dup && !l.id) return dup.id;
    const id = l.id && ID.test(l.id) && !db.get('SELECT 1 FROM board_links WHERE id = ?', l.id) ? l.id : uid();
    db.run('INSERT INTO board_links (id, world_id, board_id, from_item, to_item, label, style, created_at) VALUES (?,?,?,?,?,?,?,?)',
      id, b.world_id, b.id, l.from, l.to, String(l.label || '').slice(0, 200), l.style && typeof l.style === 'object' ? l.style : {}, l.createdAt || now());
    return id;
  }
  const maxZ = boardId => db.value('SELECT max(z) FROM board_items WHERE board_id = ?', boardId) || 0;

  function addItems(boardId, list) {
    const b = boardRow(boardId);
    let z = maxZ(boardId);
    const ids = db.tx(() => (list || []).map(it => insertItem(b, it, ++z)));
    syncMedia(boardId); touch(boardId);
    ctx.changed(['board_items'], [boardId].concat(ids));
    return ids.map(getItem);
  }
  function updateItems(list) {
    const out = [], boards = new Set();
    db.tx(() => {
      for (const p of list || []) {
        const cur = db.get('SELECT * FROM board_items WHERE id = ?', p && p.id);
        if (!cur) continue;
        const c = columns(cur.world_id, p, cur);
        db.run('UPDATE board_items SET kind = ?, entry_id = ?, media_id = ?, text = ?, data = ?, x = ?, y = ?, w = ?, h = ?, color = ?, z = ?, updated_at = ? WHERE id = ?',
          c.kind, c.entry_id, c.media_id, c.text, c.data, c.x, c.y, c.w, c.h, c.color, c.z, now(), cur.id);
        boards.add(cur.board_id); out.push(cur.id);
      }
      for (const b of boards) { syncMedia(b); touch(b); }
    });
    ctx.changed(['board_items'], [...boards].concat(out));
    return out.map(getItem);
  }
  /** deletes cards (and their connectors); returns what was removed so it can be put back */
  function removeItems(ids) {
    ids = [...new Set(ids || [])];
    if (!ids.length) return { items: [], links: [] };
    const ph = placeholders(ids.length);
    const items = db.all(`SELECT * FROM board_items WHERE id IN (${ph})`, ...ids).map(itemRow);
    const links = db.all(`SELECT * FROM board_links WHERE from_item IN (${ph}) OR to_item IN (${ph})`, ...ids, ...ids).map(linkRow);
    const boards = new Set(items.map(i => i.boardId));
    db.tx(() => { db.run(`DELETE FROM board_items WHERE id IN (${ph})`, ...ids); for (const b of boards) { syncMedia(b); touch(b); } });
    ctx.changed(['board_items', 'board_links'], [...boards].concat(ids));
    return { items, links };
  }
  /** puts back what removeItems / removeLinks returned (undo) */
  function restore({ items = [], links = [] } = {}) {
    const boards = new Set();
    db.tx(() => {
      for (const it of items) {
        const b = db.get('SELECT id, world_id FROM entries WHERE id = ?', it.boardId);
        if (!b) continue;
        db.run('DELETE FROM board_items WHERE id = ?', it.id);
        insertItem(b, Object.assign({}, it), it.z);
        boards.add(b.id);
      }
      for (const l of links) {
        const b = db.get('SELECT id, world_id FROM entries WHERE id = ?', l.boardId);
        if (!b || db.get('SELECT 1 FROM board_links WHERE id = ?', l.id)) continue;
        try { insertLink(b, l); boards.add(b.id); } catch { /* a card it joined is gone */ }
      }
      for (const b of boards) { syncMedia(b); touch(b); }
    });
    ctx.changed(['board_items', 'board_links'], [...boards]);
    return { items: items.map(i => getItem(i.id)).filter(Boolean), links: links.map(l => getLink(l.id)).filter(Boolean) };
  }

  function getBoard(id) {
    const board = ctx.core.full(id);
    const items = db.all('SELECT * FROM board_items WHERE board_id = ? ORDER BY z, created_at', id).map(itemRow);
    const links = db.all('SELECT * FROM board_links WHERE board_id = ? ORDER BY created_at', id).map(linkRow);
    const ids = [...new Set(items.map(i => i.entryId).filter(Boolean))];
    return { board, items, links, entries: ids.map(x => ctx.core.lite(x)).filter(Boolean) };
  }

  function insertBuilt(b, built) {
    const map = new Map();
    let z = maxZ(b.id);
    for (const it of built.items || []) map.set(it.ref, insertItem(b, Object.assign({}, it, { ref: undefined }), ++z));
    for (const l of built.links || []) { const from = map.get(l.from), to = map.get(l.to); if (from && to) insertLink(b, { from, to, label: l.label, style: l.style }); }
    return map;
  }

  function createBoard(worldId, o = {}) {
    const tpl = TPL.get(o.template);
    const fields = Object.assign({}, o.fields || {});
    if (tpl.purpose && !fields.purpose) fields.purpose = tpl.purpose;
    const e = ctx.core.createEntry({ worldId, typeKey: 'board', title: o.title || (tpl.key === 'blank' ? 'New board' : tpl.label), parentId: o.parentId || null, fields, summary: o.summary || '', audience: o.audience });
    db.tx(() => insertBuilt(boardRow(e.id), tpl.build()));
    syncMedia(e.id);
    ctx.changed(['board_items', 'board_links', 'entries'], [e.id]);
    return getBoard(e.id);
  }

  function duplicateBoard(id) {
    const src = boardRow(id);
    const copy = ctx.call('entries.duplicate', id, { owned: false });   // the cards are copied below, with their links
    const b = boardRow(copy.id);
    const map = new Map();
    db.tx(() => {
      for (const it of db.all('SELECT * FROM board_items WHERE board_id = ? ORDER BY z', src.id).map(itemRow)) map.set(it.id, insertItem(b, Object.assign({}, it, { id: undefined }), it.z));
      for (const l of db.all('SELECT * FROM board_links WHERE board_id = ?', src.id).map(linkRow)) if (map.has(l.from) && map.has(l.to)) insertLink(b, { from: map.get(l.from), to: map.get(l.to), label: l.label, style: l.style });
    });
    syncMedia(b.id);
    ctx.changed(['board_items', 'board_links', 'entries'], [b.id]);
    return getBoard(b.id);
  }

  function listBoards(worldId, o = {}) {
    const typeIds = boardTypeIds(worldId);
    if (!typeIds.length) return [];
    const list = ctx.core.listEntries(worldId, { typeIds, sort: o.sort || 'updated', trashed: o.trashed || undefined });
    if (!list.length) return [];
    const ids = list.map(e => e.id), ph = placeholders(ids.length);
    const items = db.all(`SELECT bi.id, bi.board_id, bi.kind, bi.x, bi.y, bi.w, bi.h, bi.color, bi.media_id, en.type_id AS etype
      FROM board_items bi LEFT JOIN entries en ON en.id = bi.entry_id WHERE bi.board_id IN (${ph}) ORDER BY bi.z`, ...ids);
    const links = db.all(`SELECT board_id, from_item, to_item FROM board_links WHERE board_id IN (${ph})`, ...ids);
    const by = new Map(ids.map(id => [id, { items: [], links: [], images: 0 }]));
    for (const r of items) {
      const g = by.get(r.board_id);
      if (r.kind === 'image' && r.media_id) g.images++;
      if (g.items.length < 400) g.items.push({ id: r.id, kind: r.kind, x: r.x, y: r.y, w: r.w, h: r.h, color: r.color || '', typeId: r.etype || null });
    }
    for (const r of links) { const g = by.get(r.board_id); if (g.links.length < 400) g.links.push([r.from_item, r.to_item]); }
    const counts = new Map(db.all(`SELECT board_id, count(*) AS n FROM board_items WHERE board_id IN (${ph}) GROUP BY board_id`, ...ids).map(r => [r.board_id, r.n]));
    const lcounts = new Map(db.all(`SELECT board_id, count(*) AS n FROM board_links WHERE board_id IN (${ph}) GROUP BY board_id`, ...ids).map(r => [r.board_id, r.n]));
    const ents = new Map(db.all(`SELECT board_id, count(DISTINCT entry_id) AS n FROM board_items WHERE board_id IN (${ph}) AND entry_id IS NOT NULL GROUP BY board_id`, ...ids).map(r => [r.board_id, r.n]));
    return list.map(e => Object.assign(e, { itemCount: counts.get(e.id) || 0, linkCount: lcounts.get(e.id) || 0, entryCount: ents.get(e.id) || 0, imageCount: by.get(e.id).images, preview: { items: by.get(e.id).items, links: by.get(e.id).links } }));
  }

  /** the boards an entry is on (the Codex's "On boards") */
  function appearances(entryId) {
    return db.all(`SELECT bi.board_id, count(*) AS n, group_concat(bi.id) AS ids FROM board_items bi JOIN entries b ON b.id = bi.board_id
      WHERE bi.entry_id = ? AND b.deleted_at IS NULL GROUP BY bi.board_id`, entryId)
      .map(r => { const b = ctx.core.lite(r.board_id); return b && { id: r.board_id, boardId: r.board_id, title: b.title, count: r.n, itemIds: String(r.ids || '').split(',').filter(Boolean), board: b }; })
      .filter(Boolean).sort((a, b) => a.title.localeCompare(b.title));
  }

  return {
    'boards.templates': () => TPL.list(),
    'boards.list': (worldId, o) => listBoards(worldId, o),
    'boards.get': id => getBoard(id),
    'boards.create': (worldId, o) => createBoard(worldId, o),
    'boards.duplicate': id => duplicateBoard(id),
    'boards.addItem': (boardId, it) => addItems(boardId, [it])[0],
    'boards.addItems': (boardId, list) => addItems(boardId, list),
    'boards.updateItem': (id, p) => updateItems([Object.assign({}, p, { id })])[0] || null,
    'boards.updateItems': list => updateItems(list),
    'boards.removeItems': ids => removeItems(ids),
    'boards.restore': snap => restore(snap),
    'boards.addLink': (boardId, l) => {
      const b = boardRow(boardId);
      const id = db.tx(() => insertLink(b, l || {}));
      touch(boardId);
      ctx.changed(['board_links'], [boardId, id]);
      return getLink(id);
    },
    'boards.updateLink': (id, p = {}) => {
      const l = db.get('SELECT * FROM board_links WHERE id = ?', id);
      if (!l) throw new Error('That connector no longer exists.');
      if (p.label != null) db.run('UPDATE board_links SET label = ? WHERE id = ?', String(p.label).slice(0, 200), id);
      if (p.style) db.run('UPDATE board_links SET style = ? WHERE id = ?', Object.assign(J(l.style, {}), p.style), id);
      if (p.reverse) db.run('UPDATE board_links SET from_item = to_item, to_item = from_item WHERE id = ?', id);
      touch(l.board_id);
      ctx.changed(['board_links'], [l.board_id, id]);
      return getLink(id);
    },
    'boards.removeLinks': ids => {
      ids = [...new Set(ids || [])];
      if (!ids.length) return { items: [], links: [] };
      const links = db.all(`SELECT * FROM board_links WHERE id IN (${placeholders(ids.length)})`, ...ids).map(linkRow);
      db.run(`DELETE FROM board_links WHERE id IN (${placeholders(ids.length)})`, ...ids);
      const boards = [...new Set(links.map(l => l.boardId))];
      boards.forEach(touch);
      ctx.changed(['board_links'], boards.concat(ids));
      return { items: [], links };
    },
    'boards.appearances': entryId => appearances(entryId),
    'boards.counts': worldId => ({
      boards: (() => { const t = boardTypeIds(worldId); return t.length ? db.value(`SELECT count(*) FROM entries WHERE world_id = ? AND deleted_at IS NULL AND type_id IN (${placeholders(t.length)})`, worldId, ...t) || 0 : 0; })(),
      items: db.value('SELECT count(*) FROM board_items bi JOIN entries b ON b.id = bi.board_id WHERE bi.world_id = ? AND b.deleted_at IS NULL', worldId) || 0,
    }),
  };
}

/* ---------------- the example world's plot board ---------------- */
function sample(ctx, S) {
  const C = ctx.core, W = S.worldId, col = TPL.COLORS;
  let boardId = S.e('boardplot');
  if (!boardId) { const e = C.createEntry({ worldId: W, typeKey: 'board', title: 'Plotting the novella', fields: { purpose: 'Plotting' } }); boardId = e.id; S.set('boardplot', boardId); }
  const pic = (key, name, svg) => {
    try { const m = ctx.call('media.save', W, { name: name + '.svg', mime: 'image/svg+xml', bytes: Buffer.from(svg, 'utf8'), tags: ['mood', 'example'] }); S.set('media:' + key, m.id); return m.id; } catch { return null; }
  };
  const spire = pic('spire', 'Storm Spire at night', ART.stormSpire());
  const palette = pic('palette', 'Gullhaven colours', ART.palette());
  pic('flats', 'The Grey Flats', ART.saltFlats());

  const items = [], links = [];
  const add = (ref, o) => { items.push(Object.assign({ ref }, o)); return ref; };
  const card = (ref, key, x, y, o = {}) => (S.e(key) ? add(ref, Object.assign({ kind: 'entry', entryId: S.e(key), x, y, w: 250, h: 140 }, o)) : null);
  const link = (a, b, label, style) => { if (a && b) links.push({ from: a, to: b, label: label || '', style: style || {} }); };
  const N = TPL.note;

  add('title', { kind: 'text', x: 0, y: -170, w: 980, h: 80, text: '<h2>The Salt Heir — plot</h2><p>Three chapters, six scenes, two secrets. Drag scenes between acts as the draft changes.</p>' });
  add('a1', { kind: 'frame', x: 0, y: 0, w: 580, h: 640, color: col.moss, text: 'Act I · Lights on Storm Spire' });
  add('a2', { kind: 'frame', x: 620, y: 0, w: 580, h: 640, color: col.amber, text: 'Act II · The Ledger of Gulls' });
  add('a3', { kind: 'frame', x: 1240, y: 0, w: 580, h: 640, color: col.coral, text: 'Act III · What the Tide Owes' });
  const s1 = card('s1', 's1', 30, 60), s2 = card('s2', 's2', 300, 230);
  const s3 = card('s3', 's3', 650, 60), s4 = card('s4', 's4', 920, 230);
  const s5 = card('s5', 's5', 1270, 60), s6 = card('s6', 's6', 1540, 230);
  add('n1', { kind: 'note', x: 30, y: 420, w: 230, h: 170, color: col.sun, text: N('Hook', 'Green lights in a tower that drowned twelve hundred years ago. Open on the harbour, not the tower.') });
  add('n2', { kind: 'note', x: 650, y: 420, w: 250, h: 180, color: col.violet, text: N('Midpoint', 'Corwin sees the ledger page. He is not Brannoc\'s son — and Halloran knew.') });
  add('n3', { kind: 'note', x: 1270, y: 420, w: 250, h: 170, color: col.rose, text: N('Climax?', 'Who puts on the Tide Crown: Mira, who refuses it, or Corwin, who has nothing left to lose?') });
  add('chk', { kind: 'checklist', x: 940, y: 420, w: 240, h: 190, color: col.teal, text: 'Draft', data: { items: [{ text: 'Chapter one revised', done: true }, { text: 'Chapter two drafted', done: false }, { text: 'Plant the ring in scene four', done: false }, { text: 'Decide the ending', done: false }] } });
  add('n4', { kind: 'note', x: 1550, y: 420, w: 240, h: 170, color: col.slate, text: N('Open question', 'Does the sea want a queen, or only a crown?') });
  // the cast and the threads, below the acts
  add('cast', { kind: 'frame', x: 0, y: 690, w: 1200, h: 230, color: col.sky, text: 'Cast' });
  const cast = ['corwin', 'mira', 'ysolde', 'tamsin', 'halloran'].map((k, i) => card('c_' + k, k, 25 + i * 235, 745, { w: 220, h: 140 }));
  add('threads', { kind: 'frame', x: 1240, y: 690, w: 580, h: 230, color: col.violet, text: 'Threads' });
  const heir = card('t_heir', 'plotheir', 1265, 745, { w: 260, h: 140 }), crown = card('t_crown', 'plotcrown', 1540, 745, { w: 260, h: 140 });
  // mood pictures to the right
  add('mood', { kind: 'frame', x: 1880, y: 0, w: 420, h: 640, color: col.slate, text: 'Mood' });
  if (spire) add('img1', { kind: 'image', mediaId: spire, x: 1905, y: 55, w: 370, h: 232, text: 'The lights, night of the storm' });
  if (palette) add('img2', { kind: 'image', mediaId: palette, x: 1905, y: 320, w: 370, h: 176, text: 'Gullhaven colours' });
  add('n5', { kind: 'text', x: 1905, y: 525, w: 370, h: 90, text: '<p><em>Salt, bells, green light, wet stone. Nobody in this book is ever quite dry.</em></p>' });

  const seq = [s1, s2, s3, s4, s5, s6].filter(Boolean);
  for (let i = 1; i < seq.length; i++) link(seq[i - 1], seq[i], '', { color: col.slate });
  link(heir, s3, 'seeded', { dash: 'dashed', color: col.violet });
  link(heir, 'n2', 'pays off', { color: col.violet });
  link(crown, s1, 'first sign', { dash: 'dashed', color: col.rose });
  link(crown, 'n3', '', { color: col.rose });
  link(cast[0], heir, 'doesn\'t know', { dash: 'dashed' });
  link(cast[4], heir, 'keeps the secret');
  link('n1', s1);

  const b = ctx.db.get('SELECT id, world_id FROM entries WHERE id = ?', boardId);
  const maxZ = ctx.db.value('SELECT max(z) FROM board_items WHERE board_id = ?', boardId) || 0;
  const map = new Map();
  let z = maxZ;
  for (const it of items) {
    const id = uid();
    const data = it.data || {}, text = ['note', 'text'].includes(it.kind) ? T.sanitize(it.text || '') : String(it.text || '');
    ctx.db.run(`INSERT INTO board_items (id, world_id, board_id, kind, entry_id, media_id, text, data, x, y, w, h, color, z, created_at, updated_at)
      VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`, id, b.world_id, b.id, it.kind, it.entryId || null, it.mediaId || null, text, data, it.x, it.y, it.w, it.h, it.color || '', ++z, now(), now());
    map.set(it.ref, id);
  }
  for (const l of links) {
    const f = map.get(l.from), t = map.get(l.to);
    if (f && t) ctx.db.run('INSERT INTO board_links (id, world_id, board_id, from_item, to_item, label, style, created_at) VALUES (?,?,?,?,?,?,?,?)', uid(), b.world_id, b.id, f, t, l.label, l.style, now());
  }
  const media = [spire, palette].filter(Boolean).sort();
  const d = J(ctx.db.value('SELECT data FROM entries WHERE id = ?', boardId), {});
  if (media.length) { d.media = media; ctx.db.run('UPDATE entries SET data = ? WHERE id = ?', d, boardId); }
}

module.exports = { migrations, handlers, sample };
