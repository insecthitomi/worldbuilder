'use strict';
/* Atlas: items on Map entries — pins, regions (territories with dates), paths (routes) and labels — plus the
   questions maps answer: where an entry appears, who held a point at a date, how large each territory is. */
const G = require('../lib/atlas-geo');
const { uid, now, J, placeholders } = require('../util');

const migrations = [{
  id: 'atlas-001',
  sql: `
  CREATE TABLE map_items (id TEXT PRIMARY KEY, world_id TEXT NOT NULL REFERENCES worlds(id) ON DELETE CASCADE,
    map_id TEXT NOT NULL REFERENCES entries(id) ON DELETE CASCADE, kind TEXT NOT NULL DEFAULT 'pin',
    entry_id TEXT REFERENCES entries(id) ON DELETE SET NULL, label TEXT DEFAULT '', note TEXT DEFAULT '',
    x REAL DEFAULT 0, y REAL DEFAULT 0, points TEXT DEFAULT '[]', style TEXT DEFAULT '{}', layer TEXT DEFAULT '',
    sub_map_id TEXT REFERENCES entries(id) ON DELETE SET NULL, start_day INTEGER, start_prec TEXT, end_day INTEGER, end_prec TEXT,
    sort REAL DEFAULT 0, created_at TEXT, updated_at TEXT);
  CREATE INDEX map_items_map ON map_items (map_id);
  CREATE INDEX map_items_entry ON map_items (entry_id);
  CREATE INDEX map_items_sub ON map_items (sub_map_id);
  CREATE INDEX map_items_world ON map_items (world_id);
  `,
}];

const KINDS = ['pin', 'region', 'path', 'label'];
const ID = /^[a-z0-9]{10}$/;
const PRECS = ['year', 'month', 'day', 'time'];
/* style keys kept, by value kind */
const STYLE = {
  color: 's', icon: 's', kind: 's', mode: 's', font: 's',
  size: 'n', fill: 'n', width: 'n', opacity: 'n', angle: 'n', labelSize: 'n',
  dashed: 'b', italic: 'b', hideLabel: 'b', caps: 'b',
};
function cleanStyle(s) {
  const out = {};
  for (const [k, v] of Object.entries(s || {})) {
    const t = STYLE[k];
    if (!t || v == null || v === '') continue;
    if (t === 's') out[k] = String(v).slice(0, 60);
    else if (t === 'n' && Number.isFinite(+v)) out[k] = Math.round(+v * 1000) / 1000;
    else if (t === 'b') out[k] = !!v;
  }
  return out;
}
function cleanPoints(p) {
  if (!Array.isArray(p)) return [];
  return p.filter(q => Array.isArray(q) && Number.isFinite(+q[0]) && Number.isFinite(+q[1])).map(q => [Math.round(+q[0] * 100) / 100, Math.round(+q[1] * 100) / 100]).slice(0, 20000);
}
const dateCol = (day, prec) => (day == null ? null : { day, min: null, prec: PRECS.includes(prec) ? prec : 'year' });

const SELECT = `SELECT i.*, e.id AS e_id, e.title AS e_title, e.type_id AS e_type, e.color AS e_color, e.icon AS e_icon,
  e.audience AS e_aud, e.reveal_day AS e_reveal, e.deleted_at AS e_del, e.start_day AS e_sd, e.start_prec AS e_sp,
  e.end_day AS e_ed, e.end_prec AS e_ep, json_extract(e.fields, '$.colors') AS e_colors,
  s.id AS s_id, s.title AS s_title, s.deleted_at AS s_del
  FROM map_items i LEFT JOIN entries e ON e.id = i.entry_id LEFT JOIN entries s ON s.id = i.sub_map_id`;
const ORDER = `ORDER BY CASE i.kind WHEN 'region' THEN 0 WHEN 'path' THEN 1 WHEN 'label' THEN 2 ELSE 3 END, i.sort, i.created_at`;

function itemRow(r) {
  if (!r) return null;
  const it = {
    id: r.id, worldId: r.world_id, mapId: r.map_id, kind: r.kind, entryId: r.entry_id || null, label: r.label || '', note: r.note || '',
    x: r.x || 0, y: r.y || 0, points: J(r.points, []), style: J(r.style, {}), layer: r.layer || '', subMapId: r.sub_map_id || null,
    start: dateCol(r.start_day, r.start_prec), end: dateCol(r.end_day, r.end_prec), sort: r.sort || 0, createdAt: r.created_at, updatedAt: r.updated_at,
  };
  if ('e_id' in r) {
    it.entry = r.e_id ? {
      id: r.e_id, title: r.e_title, typeId: r.e_type, color: r.e_color || '', icon: r.e_icon || '', audience: r.e_aud || 'shared',
      revealDay: r.e_reveal == null ? null : r.e_reveal, deletedAt: r.e_del || null,
      start: dateCol(r.e_sd, r.e_sp), end: dateCol(r.e_ed, r.e_ep), colors: typeof r.e_colors === 'string' && r.e_colors ? r.e_colors : '',
    } : null;
    it.subMap = r.s_id ? { id: r.s_id, title: r.s_title, deletedAt: r.s_del || null } : null;
  }
  return it;
}

function handlers(ctx) {
  const { db } = ctx;
  const rawItem = id => db.get('SELECT * FROM map_items WHERE id = ?', id);
  const fullItem = id => itemRow(db.get(`${SELECT} WHERE i.id = ?`, id));
  const mapEntry = id => db.get('SELECT id, world_id, title, data, deleted_at, parent_id FROM entries WHERE id = ?', id);
  const settingsOf = worldId => { const w = db.get('SELECT settings FROM worlds WHERE id = ?', worldId); return w ? J(w.settings, {}) : {}; };
  const dataOf = m => G.mapData(J(m.data, {}), settingsOf(m.world_id));
  const entryInWorld = (id, worldId) => !!(id && db.get('SELECT 1 FROM entries WHERE id = ? AND world_id = ?', id, worldId));

  function save(p = {}) {
    const old = p.id ? rawItem(p.id) : null;
    const map = mapEntry(old ? old.map_id : p.mapId);
    if (!map) throw new Error('That map no longer exists.');
    const has = k => Object.prototype.hasOwnProperty.call(p, k);
    const kind = has('kind') && KINDS.includes(p.kind) ? p.kind : old ? old.kind : 'pin';
    const points = has('points') ? cleanPoints(p.points) : old ? J(old.points, []) : [];
    if (kind === 'region' && points.length < 3) throw new Error('A region needs at least three points.');
    if (kind === 'path' && points.length < 2) throw new Error('A path needs at least two points.');
    let x = has('x') && Number.isFinite(+p.x) ? +p.x : old ? old.x : 0, y = has('y') && Number.isFinite(+p.y) ? +p.y : old ? old.y : 0;
    if (kind === 'region' && points.length >= 3 && (has('points') || !old)) [x, y] = G.labelPoint(points);
    if (kind === 'path' && points.length >= 2 && (has('points') || !old)) { const a = G.along(points, 0.5); x = a.x; y = a.y; }
    const entryId = has('entryId') ? (entryInWorld(p.entryId, map.world_id) ? p.entryId : null) : old ? old.entry_id : null;
    let subMapId = has('subMapId') ? (entryInWorld(p.subMapId, map.world_id) && p.subMapId !== map.id ? p.subMapId : null) : old ? old.sub_map_id : null;
    const label = has('label') ? String(p.label || '').slice(0, 300) : old ? old.label : '';
    const note = has('note') ? String(p.note || '').slice(0, 20000) : old ? old.note : '';
    const style = has('style') ? cleanStyle(p.style) : old ? J(old.style, {}) : {};
    const layer = has('layer') ? String(p.layer || '').slice(0, 60) : old ? old.layer : G.KIND_LAYER[kind];
    const st = has('start') ? (p.start && Number.isFinite(+p.start.day) ? p.start : null) : old ? dateCol(old.start_day, old.start_prec) : null;
    const en = has('end') ? (p.end && Number.isFinite(+p.end.day) ? p.end : null) : old ? dateCol(old.end_day, old.end_prec) : null;
    const sort = has('sort') && Number.isFinite(+p.sort) ? +p.sort : old ? old.sort : (db.value('SELECT max(sort) FROM map_items WHERE map_id = ?', map.id) || 0) + 1;
    const vals = [kind, entryId, label, note, Math.round(x * 100) / 100, Math.round(y * 100) / 100, points, style, layer, subMapId,
      st ? Math.round(+st.day) : null, st ? (PRECS.includes(st.prec) ? st.prec : 'day') : null, en ? Math.round(+en.day) : null, en ? (PRECS.includes(en.prec) ? en.prec : 'day') : null, sort];
    let id;
    if (old) {
      id = old.id;
      db.run(`UPDATE map_items SET kind = ?, entry_id = ?, label = ?, note = ?, x = ?, y = ?, points = ?, style = ?, layer = ?, sub_map_id = ?,
        start_day = ?, start_prec = ?, end_day = ?, end_prec = ?, sort = ?, updated_at = ? WHERE id = ?`, ...vals, now(), id);
    } else {
      id = p.id && ID.test(p.id) ? p.id : uid();
      db.run(`INSERT INTO map_items (kind, entry_id, label, note, x, y, points, style, layer, sub_map_id, start_day, start_prec, end_day, end_prec, sort,
        id, world_id, map_id, created_at, updated_at) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`, ...vals, id, map.world_id, map.id, p.createdAt || now(), now());
    }
    return id;
  }
  const touched = (ids, mapIds) => ctx.changed(['map_items'], [...ids, ...mapIds]);
  function remove(id) {
    const it = fullItem(id);
    if (!it) return null;
    db.run('DELETE FROM map_items WHERE id = ?', id);
    return it;
  }

  /** maps of a world with what the map list needs: data summary, item counts and the map each one sits in */
  function maps(worldId) {
    const list = ctx.core.listEntries(worldId, { typeKeys: ['map'], sort: 'position' });
    if (!list.length) return [];
    const data = new Map(db.all(`SELECT id, data FROM entries WHERE id IN (${placeholders(list.length)})`, ...list.map(e => e.id)).map(r => [r.id, J(r.data, {})]));
    const counts = new Map(db.all('SELECT map_id, kind, count(*) AS n FROM map_items WHERE world_id = ? GROUP BY map_id, kind', worldId).map(r => [r.map_id + ':' + r.kind, r.n]));
    const pinned = new Map();
    for (const r of db.all('SELECT i.map_id, i.sub_map_id, i.id FROM map_items i JOIN entries m ON m.id = i.map_id WHERE i.world_id = ? AND i.sub_map_id IS NOT NULL AND m.deleted_at IS NULL ORDER BY i.created_at', worldId)) {
      if (!pinned.has(r.sub_map_id)) pinned.set(r.sub_map_id, { mapId: r.map_id, itemId: r.id });
    }
    const ids = new Set(list.map(e => e.id)), settings = settingsOf(worldId);
    return list.map(e => {
      const d = G.mapData(data.get(e.id), settings), pin = pinned.get(e.id);
      const parentMap = pin && pin.mapId !== e.id ? pin.mapId : e.parentId && ids.has(e.parentId) ? e.parentId : null;
      const n = k => counts.get(e.id + ':' + k) || 0;
      return Object.assign(e, {
        data: d, parentMap, parentPin: pin && pin.mapId === parentMap ? pin.itemId : null,
        counts: { pin: n('pin'), region: n('region'), path: n('path'), label: n('label') },
      });
    });
  }

  /** the regions under a point, oldest first, with whether each holds it at `day` */
  function at(mapId, x, y, day) {
    const rows = db.all(`${SELECT} WHERE i.map_id = ? AND i.kind = 'region'`, mapId).map(itemRow);
    const hits = rows.filter(r => r.points.length >= 3 && G.inPoly(+x, +y, r.points) && !(r.entry && r.entry.deletedAt));
    const startOf = r => (r.start ? r.start.day : -Infinity);
    hits.sort((a, b) => startOf(a) - startOf(b) || (a.end ? a.end.day : Infinity) - (b.end ? b.end.day : Infinity));
    return hits.map(item => ({ item, active: G.alive(item.start, item.end, day == null ? null : +day) }));
  }

  /** area of every region alive at `day` (null = all), in the map's unit squared; grouped by the entry it belongs to */
  function areas(mapId, day) {
    const m = mapEntry(mapId);
    if (!m) throw new Error('That map no longer exists.');
    const d = dataOf(m);
    const rows = db.all(`${SELECT} WHERE i.map_id = ? AND i.kind = 'region'`, mapId).map(itemRow)
      .filter(r => r.points.length >= 3 && !(r.entry && r.entry.deletedAt) && G.alive(r.start, r.end, day == null ? null : +day));
    const scaled = G.isPlanet(d) || !!d.unitsPerPx;
    const regions = rows.map(r => ({ id: r.id, entryId: r.entryId, label: r.label || (r.entry && r.entry.title) || 'Region', area: scaled ? G.area(d, r.points) : G.polyArea(r.points) }));
    const groups = new Map();
    for (const r of regions) {
      const k = r.entryId || 'label:' + r.label;
      const g = groups.get(k) || { entryId: r.entryId, label: r.label, area: 0, regions: 0 };
      g.area += r.area; g.regions++;
      groups.set(k, g);
    }
    const total = regions.reduce((s, r) => s + r.area, 0);
    const byEntity = [...groups.values()].sort((a, b) => b.area - a.area).map(g => Object.assign(g, { share: total ? g.area / total : 0 }));
    return { unit: scaled ? d.unit : 'px', scaled, planet: G.isPlanet(d), total, regions, byEntity };
  }

  ctx.atlas = { save, remove, maps, at, areas, itemRow };

  return {
    'atlas.maps': worldId => maps(worldId),
    'atlas.map': mapId => {
      const m = mapEntry(mapId);
      if (!m) throw new Error('That map no longer exists.');
      return { entry: ctx.core.full(mapId), data: dataOf(m), items: db.all(`${SELECT} WHERE i.map_id = ? ${ORDER}`, mapId).map(itemRow) };
    },
    'atlas.items': mapId => db.all(`${SELECT} WHERE i.map_id = ? ${ORDER}`, mapId).map(itemRow),
    'atlas.all': worldId => db.all(`${SELECT} WHERE i.world_id = ? ${ORDER}`, worldId).map(itemRow),
    'atlas.item': id => fullItem(id),
    'atlas.save': item => { const id = db.tx(() => save(item)); const it = fullItem(id); touched([id], [it.mapId]); return it; },
    'atlas.remove': id => { const it = remove(id); if (it) touched([id], [it.mapId]); return it; },
    /** { save: [items], remove: [ids] } in one step (moves of several items, undo) */
    'atlas.bulk': ({ save: s = [], remove: r = [] } = {}) => {
      const out = { saved: [], removed: [] };
      db.tx(() => { for (const id of r) { const it = remove(id); if (it) out.removed.push(it); } for (const it of s) out.saved.push(save(it)); });
      out.saved = out.saved.map(fullItem);
      touched(out.saved.map(x => x.id).concat(out.removed.map(x => x.id)), out.saved.concat(out.removed).map(x => x.mapId));
      return out;
    },
    /** where an entry is on the maps: [{ map, item }] — pins first; a map also lists the pins that open it */
    'atlas.appearances': entryId => {
      const rows = db.all(`${SELECT} JOIN entries m ON m.id = i.map_id WHERE (i.entry_id = ? OR i.sub_map_id = ?) AND m.deleted_at IS NULL
        ORDER BY CASE i.kind WHEN 'pin' THEN 0 WHEN 'region' THEN 1 ELSE 2 END, i.created_at`, entryId, entryId).map(itemRow);
      const cache = new Map();
      return rows.map(item => {
        if (!cache.has(item.mapId)) {
          const m = mapEntry(item.mapId), d = dataOf(m);
          cache.set(item.mapId, { id: m.id, title: m.title, image: d.image, width: d.width, height: d.height, projection: d.projection });
        }
        return { map: cache.get(item.mapId), item, via: item.entryId === entryId ? 'entry' : 'submap' };
      });
    },
    /** every territory of an entry on every map, oldest first, with its size: the border changes of a nation or house */
    'atlas.territories': entryId => db.all(`${SELECT} JOIN entries m ON m.id = i.map_id WHERE i.entry_id = ? AND i.kind = 'region' AND m.deleted_at IS NULL
      ORDER BY coalesce(i.start_day, -2147483648), i.created_at`, entryId).map(itemRow).map(item => {
      const m = mapEntry(item.mapId), d = dataOf(m), scaled = G.isPlanet(d) || !!d.unitsPerPx;
      return { map: { id: m.id, title: m.title }, item, area: scaled ? G.area(d, item.points) : null, unit: scaled ? d.unit : null };
    }),
    'atlas.at': (mapId, x, y, day) => at(mapId, x, y, day),
    'atlas.areas': (mapId, day) => areas(mapId, day),
  };
}

function sample(ctx, S) {
  require('../lib/atlas-sample').build(ctx, S);
}

module.exports = { migrations, handlers, sample };
