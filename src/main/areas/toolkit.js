'use strict';
/* Toolkit: turns a generator's plan (a town with its districts, locations, residents, map and pins) into entries in one
   transaction, undoes that, lists random tables with their rows, and adds the example world's tables and encounter. */
const S = require('../lib/toolkit-sample');

function handlers(ctx) {
  const { db } = ctx;
  const C = () => ctx.core;
  const exists = (worldId, id) => !!(id && db.get('SELECT 1 FROM entries WHERE id = ? AND world_id = ? AND deleted_at IS NULL', id, worldId));
  const relByName = (worldId, name) => db.get('SELECT id FROM rel_types WHERE world_id = ? AND (lower(name) = lower(?) OR lower(inverse) = lower(?)) ORDER BY builtin DESC LIMIT 1', worldId, name, name);

  /** plan: { entries: [{ ref, type, title, aliases, summary, body, fields, data, start, end, parent (ref), parentId, tags, audience }],
   *          relations: [{ src, dst, rel }] (refs or ids), media: [{ ref, name, mime, text | base64, width, height }],
   *          pins: [{ map (ref) | mapId, entry (ref), x, y, label, icon, subMap (ref) }] }
   *  '@ref:<ref>' and '@media:<ref>' anywhere in strings become the new ids. → { ids, created, rootId, mediaIds, pinIds } */
  function build(worldId, plan = {}) {
    const core = C();
    core.world(worldId);
    const list = (plan.entries || []).filter(e => e && e.ref);
    if (!list.length) throw new Error('There is nothing to create.');
    if (list.length > 600) throw new Error('That is too much to create at once.');
    const mediaIds = {}, ids = {};
    for (const m of plan.media || []) {
      const base64 = m.base64 || Buffer.from(String(m.text || ''), 'utf8').toString('base64');
      const saved = ctx.call('media.save', worldId, { name: m.name || 'Generated', mime: m.mime || 'image/svg+xml', base64, width: m.width, height: m.height, tags: ['generated'] });
      mediaIds[m.ref] = saved.id;
    }
    for (const e of list) ids[e.ref] = ctx.uid();
    const ref = v => (typeof v === 'string' && ids[v] ? ids[v] : v);
    const swap = v => {
      if (typeof v === 'string') return v.replace(/@ref:([\w-]+)/g, (m, r) => ids[r] || '').replace(/@media:([\w-]+)/g, (m, r) => mediaIds[r] || '');
      if (Array.isArray(v)) return v.map(swap).filter(x => x !== '');
      if (v && typeof v === 'object') return Object.fromEntries(Object.entries(v).map(([k, x]) => [k, swap(x)]).filter(([, x]) => x !== '' && x != null));
      return v;
    };
    // parents before children
    const byRef = new Map(list.map(e => [e.ref, e])), done = new Set(), order = [];
    const visit = (e, depth = 0) => { if (done.has(e.ref) || depth > 50) return; if (e.parent && byRef.has(e.parent)) visit(byRef.get(e.parent), depth + 1); done.add(e.ref); order.push(e); };
    list.forEach(e => visit(e));
    const created = [];
    try {
      db.tx(() => {
        for (const e of order) {
          const t = core.typeByKey(worldId, e.type) || core.typeByKey(worldId, 'note');
          const parentId = e.parent && ids[e.parent] ? ids[e.parent] : exists(worldId, e.parentId) ? e.parentId : null;
          core.createEntry({ id: ids[e.ref], worldId, typeId: t.id, parentId, title: String(e.title || '').slice(0, 300), aliases: e.aliases || [], summary: e.summary || '',
            body: swap(e.body || ''), fields: swap(e.fields || {}), data: swap(e.data || {}), start: e.start || null, end: e.end || null, tagNames: e.tags, audience: e.audience });
          created.push(ids[e.ref]);
        }
        // mentions and reference fields to entries made later in the plan
        for (const id of created) { core.syncMentions(id); core.syncFieldLinks(id); }
        for (const r of plan.relations || []) {
          const rel = relByName(worldId, r.rel || 'related to');
          const src = ref(r.src), dst = ref(r.dst);
          if (rel && src && dst && src !== dst && exists(worldId, src) && exists(worldId, dst)) core.relate({ src, dst, relId: rel.id, note: r.note || '' });
        }
      });
    } catch (err) {
      for (const id of Object.values(mediaIds)) { try { ctx.call('media.purge', id); } catch { } }
      throw err;
    }
    // pins through the Atlas (when it is there)
    const pinIds = [];
    if (ctx.has('atlas.save')) for (const p of plan.pins || []) {
      const mapId = p.map ? ids[p.map] : p.mapId;
      if (!mapId || !exists(worldId, mapId)) continue;
      try {
        const it = ctx.call('atlas.save', { mapId, kind: 'pin', entryId: ref(p.entry) || null, x: +p.x || 0, y: +p.y || 0, label: p.label || '', style: p.icon ? { icon: p.icon } : {}, subMapId: p.subMap ? ref(p.subMap) : null });
        if (it && it.id) pinIds.push(it.id);
      } catch (e) { console.warn('toolkit pin', e && e.message); }
    }
    ctx.changed(['entries', 'links', 'media'].concat(pinIds.length ? ['map_items'] : []), created);
    return { ids, created, rootId: ids[plan.open] || created[0], mediaIds: Object.values(mediaIds), pinIds };
  }

  /** removes what build() made (the Undo of a generator's Create) */
  function undo(r = {}) {
    for (const id of r.pinIds || []) { try { if (ctx.has('atlas.remove')) ctx.call('atlas.remove', id); } catch { } }
    for (const id of (r.created || []).slice().reverse()) { try { if (db.get('SELECT 1 FROM entries WHERE id = ?', id)) ctx.call('entries.purge', id); } catch { } }
    for (const id of r.mediaIds || []) { try { ctx.call('media.purge', id); } catch { } }
    ctx.changed(['entries', 'links', 'media', 'map_items'], r.created || []);
    return true;
  }

  /** every random table of a world with its dice and rows (nested [[Table]] rolls look them up by title) */
  function tables(worldId) {
    const t = C().typeByKey(worldId, 'table');
    if (!t) return [];
    return db.all('SELECT id, title, aliases, fields, data, audience, reveal_day FROM entries WHERE world_id = ? AND type_id = ? AND deleted_at IS NULL ORDER BY title COLLATE NOCASE', worldId, t.id)
      .map(r => { const f = ctx.U.J(r.fields, {}), d = ctx.U.J(r.data, {}); return { id: r.id, title: r.title, aliases: ctx.U.J(r.aliases, []), dice: f.dice || '', creates: f.creates || '', rows: Array.isArray(d.rows) ? d.rows : [], audience: r.audience, revealDay: r.reveal_day }; });
  }

  return {
    'toolkit.build': (worldId, plan) => build(worldId, plan),
    'toolkit.undo': r => undo(r),
    'toolkit.tables': worldId => tables(worldId),
  };
}

function sample(ctx, Skeys) { S.sample(ctx, Skeys); }

module.exports = { migrations: [], handlers, sample };
