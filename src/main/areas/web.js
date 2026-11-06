'use strict';
/* Web: family data for trees and the kinship calculator (relations whose type has a family role).
   A relation type with familyRole 'parent' reads "<src> is a parent of <dst>". No tables of its own. */
const Kin = require('../lib/web-kin');
const Know = require('../../shared/knowledge');
const { J, placeholders } = require('../util');

const migrations = [];

function handlers(ctx) {
  const { db } = ctx;

  /** every family relation of a world and the people they touch; opts { audience, asOf } hides what that audience may not see */
  function family(worldId, opts = {}) {
    const rows = db.all(`SELECT l.id, l.src, l.dst, l.start_day, l.end_day, l.note, l.rel_id, r.family_role AS role, r.name AS rname, r.inverse AS rinverse
      FROM links l JOIN rel_types r ON r.id = l.rel_id JOIN entries a ON a.id = l.src JOIN entries b ON b.id = l.dst
      WHERE l.world_id = ? AND l.kind = 'relation' AND r.family_role IN ('parent', 'spouse', 'sibling') AND a.deleted_at IS NULL AND b.deleted_at IS NULL`, worldId);
    const ids = [...new Set(rows.flatMap(r => [r.src, r.dst]))];
    let people = ids.length ? ctx.core.listEntries(worldId, { ids }) : [];
    const extra = new Map(ids.length ? db.all(`SELECT id, fields FROM entries WHERE id IN (${placeholders(ids.length)})`, ...ids).map(r => [r.id, J(r.fields, {})]) : []);
    people = people.map(p => {
      const f = extra.get(p.id) || {};
      return Object.assign(p, { sex: Kin.sexOf(f.pronouns || f.gender || f.sex), status: f.status || '', occupation: f.occupation || '' });
    });
    if (opts.audience && opts.audience !== 'author') {
      const asOf = opts.asOf != null ? opts.asOf : null;
      people = people.filter(p => Know.visible(p, opts.audience, asOf));
    }
    const keep = new Set(people.map(p => p.id));
    const ok = r => keep.has(r.src) && keep.has(r.dst);
    const base = r => ({ id: r.id, relId: r.rel_id, start: r.start_day, end: r.end_day, note: r.note || '' });
    return {
      people,
      parents: rows.filter(r => r.role === 'parent' && ok(r)).map(r => Object.assign(base(r), { parent: r.src, child: r.dst })),
      spouses: rows.filter(r => r.role === 'spouse' && ok(r)).map(r => Object.assign(base(r), { a: r.src, b: r.dst })),
      siblings: rows.filter(r => r.role === 'sibling' && ok(r)).map(r => Object.assign(base(r), { a: r.src, b: r.dst })),
    };
  }
  const famGraph = f => Kin.build({ people: f.people.map(p => ({ id: p.id, title: p.title, sex: p.sex })), parents: f.parents.map(x => [x.parent, x.child]), spouses: f.spouses.map(x => [x.a, x.b]), siblings: f.siblings.map(x => [x.a, x.b]) });

  /** how a is related to b, and b to a */
  function kinship(worldId, a, b, opts = {}) {
    const f = family(worldId, opts);
    const G = famGraph(f);
    const title = id => { const e = ctx.core.lite(id); return e ? e.title : 'Someone'; };
    if (!G.people.has(a) || !G.people.has(b)) {
      const missing = [a, b].filter(id => !G.people.has(id)).map(title);
      return { kind: 'none', label: null, inverse: null, text: a === b ? 'That is the same person.' : missing.join(' and ') + (missing.length > 1 ? ' have' : ' has') + ' no recorded family yet.', explain: 'Add parents, spouses or siblings in the family tree to connect them.', path: [], common: [] };
    }
    const r = Kin.relate(G, a, b);
    const back = Kin.relate(G, b, a);
    return Object.assign(r, { inverse: back.label, inverseText: back.text });
  }

  return {
    'web.family': (worldId, opts) => family(worldId, opts),
    'web.kinship': (worldId, a, b, opts) => kinship(worldId, a, b, opts),
  };
}

/* House Vey across three generations (only what is missing; keys that don't exist are skipped) */
function sample(ctx, S) {
  const rel = name => ctx.db.get('SELECT id FROM rel_types WHERE world_id = ? AND name = ?', S.worldId, name);
  const parentOf = rel('parent of'), spouseOf = rel('spouse of');
  if (!parentOf || !spouseOf) return;
  const related = (a, b) => !!ctx.db.get(`SELECT 1 FROM links l JOIN rel_types r ON r.id = l.rel_id WHERE l.kind = 'relation' AND r.family_role IS NOT NULL
    AND ((l.src = ? AND l.dst = ?) OR (l.src = ? AND l.dst = ?))`, a, b, b, a);
  const link = (ka, kb, r) => {
    const a = S.e(ka), b = S.e(kb);
    if (!a || !b || related(a, b)) return;
    try { ctx.core.relate({ src: a, dst: b, relId: r.id }); } catch (e) { console.error('web sample', ka, kb, e.message); }
  };
  link('brannoc', 'elsabet', spouseOf);
  for (const p of ['brannoc', 'elsabet']) for (const c of ['corwin', 'ysolde']) link(p, c, parentOf);
  link('aldous', 'brannoc', parentOf);
  link('ysolde', 'wren', parentOf);
}

module.exports = { migrations, handlers, sample };
