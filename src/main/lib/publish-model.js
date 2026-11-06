'use strict';
/* The world as one reader sees it. The knowledge rule from src/shared/knowledge.js (audience + as-of world date,
   secret fields and inline secrets out) is applied here once, so the website and every export show the same thing.
   Backlinks are recomputed from the filtered text and fields, so a mention inside a secret never shows up as
   "linked from" on the other entry. */
const K = require('../../shared/knowledge');
const T = require('../../shared/richtext');
const F = require('../../shared/fields');
const Cal = require('../../shared/calendar');

const LEVELS = ['author', 'shared', 'public'];
const LINKED_KINDS = new Set(['ref', 'refs']);

/** the type keys a site shows unless the author picks others */
const SITE_TYPES = ['character', 'place', 'faction', 'species', 'item', 'event', 'lore', 'culture', 'language', 'story', 'map', 'post', 'product'];

/** a post is live when it is not a draft and either published or scheduled for a day that has come */
function postState(fields, today) {
  const f = fields || {}, st = String(f.status || '').toLowerCase(), day = /^\d{4}-\d{2}-\d{2}$/.test(f.publish || '') ? f.publish : null;
  if (st === 'draft') return { state: 'draft', live: false, date: day };
  if (st === 'published') return { state: 'published', live: true, date: day };
  if (day && day <= today) return { state: 'published', live: true, date: day, scheduled: true };
  if (day) return { state: 'scheduled', live: false, date: day };
  return { state: st === 'scheduled' ? 'scheduled' : 'draft', live: false, date: day };
}

/**
 * o: { level: 'author'|'shared'|'public', asOf: world day | null (world now), types: [type keys] | null (all),
 *      today: 'YYYY-MM-DD' (posts), keep(entryLite, type) → bool (extra filter, e.g. live posts only) }
 */
function build(ctx, worldId, o = {}) {
  const C = ctx.core;
  const world = C.world(worldId);
  const level = LEVELS.includes(o.level) ? o.level : 'public';
  const asOf = o.asOf == null || o.asOf === '' || !Number.isFinite(+o.asOf) ? world.now.day : Math.round(+o.asOf);
  const cal = Cal.create(world.calendar);
  const types = C.typesOf(worldId);
  const typeById = new Map(types.map(t => [t.id, t]));
  const typeKeys = Array.isArray(o.types) ? new Set(o.types) : null;
  const stats = { total: 0, hidden: 0, waiting: 0, secretFields: 0, secretPassages: 0, unlinked: 0, droppedRefs: 0, outOfScope: 0 };

  const lites = C.listEntries(worldId, {});
  stats.total = lites.length;
  const visible = new Map();   // id → lite, everything this reader may see (any type)
  for (const e of lites) {
    if (K.visible(e, level, asOf)) visible.set(e.id, e);
    else { stats.hidden++; if (K.visible(e, level, null)) stats.waiting++; }
  }
  const included = new Set();
  for (const e of visible.values()) {
    const t = typeById.get(e.typeId);
    if (!t) continue;
    if (typeKeys && !typeKeys.has(t.key)) { stats.outOfScope++; continue; }
    if (o.keep && !o.keep(e, t)) { stats.outOfScope++; continue; }
    included.add(e.id);
  }

  // full entries with the rule applied
  const entries = [], byId = new Map();
  for (const id of included) {
    const raw = C.full(id), t = typeById.get(raw.typeId);
    const fields = K.fields(t, raw.fields, level);
    if (level !== 'author') for (const d of t.fields || []) if (d.secret && F.filled(d.kind, raw.fields[d.key])) stats.secretFields++;
    for (const d of t.fields || []) {
      if (!LINKED_KINDS.has(d.kind) || fields[d.key] == null) continue;
      const ids = d.kind === 'ref' ? [fields[d.key]].filter(Boolean) : [].concat(fields[d.key] || []);
      const keep = ids.filter(x => visible.has(x));
      stats.droppedRefs += ids.length - keep.length;
      fields[d.key] = d.kind === 'ref' ? keep[0] || '' : keep;
    }
    const body = K.body(raw.body, level);
    if (level !== 'author') stats.secretPassages += countSecrets(raw.body);
    for (const m of T.mentions(body)) if (!visible.has(m)) stats.unlinked++;
    const e = Object.assign({}, raw, { type: t, fields, body, data: t.lens === 'map' ? mapData(raw.data) : {} });
    // only visible ancestors count: the chain stops at the first one the reader may not see
    e.parentId = raw.parentId && visible.has(raw.parentId) ? raw.parentId : null;
    entries.push(e); byId.set(id, e);
  }
  entries.sort((a, b) => (a.type.sort - b.type.sort) || a.position - b.position || a.title.localeCompare(b.title));

  // backlinks from the filtered text and fields only
  const backlinks = new Map();
  const addBack = (dst, src, kind, label) => {
    if (dst === src || !included.has(dst)) return;
    const list = backlinks.get(dst) || backlinks.set(dst, []).get(dst);
    if (!list.some(x => x.src === src)) list.push({ src, kind, label });
  };
  for (const e of entries) {
    for (const m of T.mentions(e.body)) addBack(m, e.id, 'mention');
    for (const d of e.type.fields || []) {
      if (!LINKED_KINDS.has(d.kind)) continue;
      for (const x of [].concat(e.fields[d.key] || []).filter(Boolean)) addBack(x, e.id, 'field', d.label);
    }
  }
  // children (visible parents only)
  const children = new Map();
  for (const e of entries) if (e.parentId && included.has(e.parentId)) (children.get(e.parentId) || children.set(e.parentId, []).get(e.parentId)).push(e.id);

  // relations between entries the reader may see
  const relations = [];
  const rels = ctx.handlers['links.relations'] ? ctx.handlers['links.relations'](worldId) : [];
  for (const r of rels) {
    if (!visible.has(r.src) || !visible.has(r.dst)) continue;
    if (!included.has(r.src) && !included.has(r.dst)) continue;
    relations.push(r);
  }
  const tags = new Map((ctx.handlers['tags.list'] ? ctx.handlers['tags.list'](worldId) : []).map(t => [t.id, t]));

  const lite = id => visible.get(id) || null;
  const titleOf = id => { const x = visible.get(id); return x ? x.title : ''; };
  const typeOf = id => { const x = visible.get(id); return x ? typeById.get(x.typeId) : null; };
  return {
    world, cal, level, asOf, types, typeById, entries, byId, visible, included, backlinks, children, relations, tags, stats,
    lite, titleOf, typeOf,
    /** the ancestors a reader may see, root first */
    crumbs(id) {
      const out = []; let p = byId.get(id) && byId.get(id).parentId, guard = 0;
      while (p && guard++ < 60) { const x = byId.get(p); if (!x) break; out.unshift(x); p = x.parentId; }
      return out;
    },
    /** relations seen from one entry: [{ label, other, rel }] */
    relationsOf(id) {
      const out = [];
      for (const r of relations) {
        if (r.src !== id && r.dst !== id) continue;
        const other = r.src === id ? r.dst : r.src;
        out.push({ label: r.src === id ? r.name : r.inverse, other, rel: r, category: r.category || 'other', familyRole: r.familyRole || null, startDay: r.startDay, endDay: r.endDay, note: r.note || '' });
      }
      return out;
    },
    date: (d, style) => (d ? cal.format(d, style) : ''),
    span(e, style) {
      if (!e || (!e.start && !e.end)) return '';
      return e.start && e.end ? cal.formatRange(e.start, e.end, style) : e.start ? cal.format(e.start, style) : '– ' + cal.format(e.end, style);
    },
    /** age for lifespan types at the as-of date (or at death) */
    age(e) {
      const t = e && (e.type || typeById.get(e.typeId));
      if (!t || !t.lifespan || !e.start) return null;
      const at = e.end && e.end.day <= asOf ? e.end : { day: asOf, prec: 'day' };
      if (at.day < e.start.day) return null;
      return cal.age(e.start, at);
    },
  };
}

function countSecrets(html) {
  let n = 0;
  for (const tk of T.tokens(html || '')) if (tk.t === 'open' && (tk.tag === 'span' || tk.tag === 'p') && String((tk.a || {}).class || '').split(/\s+/).includes('wb-s')) n++;
  return n;
}
/** the parts of a map's data a reader needs (never notes or editor state) */
function mapData(d) {
  d = d || {};
  return { image: d.image || null, width: +d.width || 0, height: +d.height || 0, unit: d.unit || '', unitsPerPx: +d.unitsPerPx || 0, layers: Array.isArray(d.layers) ? d.layers : [] };
}

module.exports = { build, postState, LEVELS, SITE_TYPES, countSecrets };
