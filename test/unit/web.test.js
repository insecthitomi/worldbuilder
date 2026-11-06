'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { make } = require('./helpers');
const Kin = require('../../src/main/lib/web-kin');
const Graph = require('../../src/app/modules/web/algo');
const Force = require('../../src/app/modules/web/force');

/* a made-up family, written as parent → children */
function family() {
  const P = (id, sex) => ({ id, title: id[0].toUpperCase() + id.slice(1), sex });
  const people = [P('gran', 'f'), P('grandpa', 'm'), P('dad', 'm'), P('mum', 'f'), P('aunt', 'f'), P('me', 'm'), P('sis', 'f'), P('half', 'm'), P('step', 'f'),
    P('cousin', 'f'), P('cousinkid', 'm'), P('kid', 'f'), P('grandkid', 'm'), P('wife', 'f'), P('inlawdad', 'm'), P('niece', 'f'), P('bro2', 'm'), P('lone', null),
    P('greatgran', 'f'), P('auntshusband', 'm'), P('x1', 'm'), P('x2', 'f')];
  const parents = [['greatgran', 'gran'], ['gran', 'dad'], ['grandpa', 'dad'], ['gran', 'aunt'], ['grandpa', 'aunt'], ['dad', 'me'], ['mum', 'me'], ['dad', 'sis'], ['mum', 'sis'],
    ['dad', 'half'], ['step', 'half'], ['aunt', 'cousin'], ['cousin', 'cousinkid'], ['me', 'kid'], ['wife', 'kid'], ['kid', 'grandkid'], ['inlawdad', 'wife'], ['sis', 'niece']];
  const spouses = [['dad', 'mum'], ['dad', 'step'], ['me', 'wife'], ['aunt', 'auntshusband']];
  const siblings = [['x1', 'x2'], ['me', 'bro2']];
  return { people, parents, spouses, siblings };
}
const rel = (a, b) => Kin.relate(family(), a, b);

test('kinship: blood relations, with generations, halves and removals', () => {
  assert.equal(rel('dad', 'me').label, 'father');
  assert.equal(rel('me', 'dad').label, 'son');
  assert.equal(rel('gran', 'me').label, 'grandmother');
  assert.equal(rel('greatgran', 'me').label, 'great-grandmother');
  assert.equal(rel('me', 'greatgran').label, 'great-grandson');
  assert.equal(rel('sis', 'me').label, 'sister');
  assert.equal(rel('half', 'me').label, 'half-brother');
  assert.equal(rel('aunt', 'me').label, 'aunt');
  assert.equal(rel('me', 'aunt').label, 'nephew');
  assert.equal(rel('cousin', 'me').label, 'first cousin');
  assert.equal(rel('cousinkid', 'me').label, 'first cousin once removed');
  assert.equal(rel('greatgran', 'kid').label, 'great-great-grandmother');
  assert.equal(rel('aunt', 'kid').label, 'great-aunt');
  assert.equal(rel('kid', 'aunt').label, 'grandniece');
  assert.equal(rel('niece', 'me').label, 'niece');
  assert.equal(rel('grandkid', 'me').label, 'grandson');
  const r = rel('cousinkid', 'me');
  assert.equal(r.kind, 'blood');
  assert.deepEqual(r.common.sort(), ['gran', 'grandpa']);
  assert.equal(r.path[0].id, 'cousinkid');
  assert.equal(r.path[r.path.length - 1].id, 'me');
  assert.equal(r.path[1].as, 'mother');
  assert.match(r.text, /Cousinkid is Me’s first cousin once removed/);
});

test('kinship: words for distant relations', () => {
  const w = Kin.words;
  assert.equal(w.cousinWord(3, 4), 'second cousin once removed');
  assert.equal(w.cousinWord(4, 6), 'third cousin twice removed');
  assert.equal(w.cousinWord(3, 7), 'second cousin 4 times removed');
  assert.equal(w.ancestorWord(5, 'm'), '3rd great-grandfather');
  assert.equal(w.auncleWord(4, 'f'), 'great-great-aunt');
  assert.equal(w.niblingWord(4, null), 'great-grandniece/nephew');
  assert.equal(Kin.sexOf('she/her'), 'f');
  assert.equal(Kin.sexOf('He/Him'), 'm');
  assert.equal(Kin.sexOf('they/them'), null);
});

test('kinship: marriage, in-laws, step relatives, explicit siblings and chains', () => {
  assert.equal(rel('wife', 'me').label, 'wife');
  assert.equal(rel('inlawdad', 'me').label, 'father-in-law');
  assert.equal(rel('me', 'inlawdad').label, 'son-in-law');
  assert.equal(rel('wife', 'sis').label, 'sister-in-law');
  assert.equal(rel('step', 'me').label, 'stepmother');
  assert.equal(rel('me', 'step').label, 'stepson');
  assert.equal(rel('auntshusband', 'me').label, 'uncle by marriage');
  assert.equal(rel('x2', 'x1').label, 'sister');
  assert.equal(rel('bro2', 'me').label, 'brother');          // explicit sibling takes the shared parents
  assert.equal(rel('bro2', 'sis').label, 'brother');
  assert.equal(rel('lone', 'me').kind, 'none');
  assert.equal(rel('me', 'me').kind, 'self');
  const chain = rel('inlawdad', 'niece');
  assert.equal(chain.kind, 'chain');
  assert.ok(chain.label.split('’s ').length >= 3, chain.label);
});

test('kinship: remarriage, half-siblings on either side, step-parents and distant cousins', () => {
  const sexes = { gerd: 'm', hilde: 'f', otto: 'm', ida: 'f', mara: 'f', sanne: 'f', kurt: 'm', jens: 'm', pia: 'f', rolf: 'm', tove: 'f', ulf: 'm', kai: 'm', nils: 'm', bo: 'm', eva: 'f', finn: 'm', arvid: 'm', sol: 'f' };
  const people = Object.entries(sexes).map(([id, sex]) => ({ id, title: id, sex }));
  const parents = [];
  const kids = (ps, cs) => { for (const p of ps) for (const c of cs) parents.push([p, c]); };
  kids(['gerd', 'hilde'], ['otto', 'ida']); kids(['otto', 'mara'], ['pia', 'rolf']); kids(['otto', 'sanne'], ['tove']); kids(['mara', 'kurt'], ['ulf']);
  kids(['ida', 'jens'], ['kai']); kids(['kai'], ['nils']); kids(['nils'], ['sol']); kids(['pia', 'bo'], ['eva', 'finn']); kids(['arvid'], ['mara']);
  const fam = { people, parents, spouses: [['gerd', 'hilde'], ['otto', 'mara'], ['otto', 'sanne'], ['mara', 'kurt'], ['ida', 'jens'], ['pia', 'bo']], siblings: [] };
  const r = (a, b) => Kin.relate(fam, a, b).label;
  assert.equal(r('kai', 'pia'), 'first cousin');
  assert.equal(r('nils', 'pia'), 'first cousin once removed');
  assert.equal(r('sol', 'eva'), 'second cousin once removed');
  assert.equal(r('tove', 'pia'), 'half-sister');
  assert.equal(r('ulf', 'rolf'), 'half-brother');
  assert.equal(r('sanne', 'pia'), 'stepmother');
  assert.equal(r('kurt', 'pia'), 'stepfather');
  assert.equal(r('bo', 'rolf'), 'brother-in-law');
  assert.equal(r('jens', 'otto'), 'brother-in-law');
  assert.equal(r('arvid', 'finn'), 'great-grandfather');
  assert.equal(r('finn', 'arvid'), 'great-grandson');
  assert.equal(r('sol', 'gerd'), 'great-great-granddaughter');
});

test('family and kinship handlers; Share view hides private people', () => {
  const t = make();
  try {
    const w = t.call('worlds.create', { name: 'W' });
    const rels = t.call('rels.list', w.id);
    const parentOf = rels.find(r => r.name === 'parent of'), spouse = rels.find(r => r.name === 'spouse of'), friend = rels.find(r => r.name === 'friend of');
    const mk = (title, pronouns, audience) => t.call('entries.create', { worldId: w.id, typeKey: 'character', title, fields: { pronouns }, audience });
    const a = mk('Aldo Vey', 'he/him'), b = mk('Bree Vey', 'she/her'), c = mk('Cato Vey', 'he/him'), d = mk('Dara Vey', 'she/her', 'private');
    t.call('links.relate', { src: a.id, dst: b.id, relId: spouse.id });
    t.call('links.relate', { src: a.id, dst: c.id, relId: parentOf.id });
    t.call('links.relate', { src: b.id, dst: c.id, relId: parentOf.id });
    t.call('links.relate', { src: c.id, dst: d.id, relId: parentOf.id });
    t.call('links.relate', { src: a.id, dst: d.id, relId: friend.id });
    const f = t.call('web.family', w.id);
    assert.equal(f.people.length, 4);
    assert.equal(f.parents.length, 3);
    assert.equal(f.spouses.length, 1);
    assert.equal(f.people.find(p => p.id === b.id).sex, 'f');
    const k = t.call('web.kinship', w.id, d.id, a.id);
    assert.equal(k.label, 'granddaughter');
    assert.equal(k.inverse, 'grandfather');
    assert.deepEqual(k.path.map(s => s.id), [d.id, c.id, a.id]);
    const shared = t.call('web.family', w.id, { audience: 'shared', asOf: 0 });
    assert.equal(shared.people.length, 3);
    assert.equal(shared.parents.length, 2);
    assert.equal(t.call('web.kinship', w.id, d.id, a.id, { audience: 'shared' }).kind, 'none');
  } finally { t.done(); }
});

test('sample hook adds the missing House Vey relations once', () => {
  const t = make();
  try {
    const w = t.call('worlds.create', { name: 'Saltmarch' });
    const keys = {};
    for (const k of ['brannoc', 'elsabet', 'corwin', 'ysolde', 'aldous', 'wren']) keys[k] = t.call('entries.create', { worldId: w.id, typeKey: 'character', title: k }).id;
    const S = { worldId: w.id, e: k => keys[k] || null, type: () => null, media: () => null, set() {} };
    const area = require('../../src/main/areas/web');
    // one relation already there (other direction): it must not be doubled
    const spouse = t.call('rels.list', w.id).find(r => r.name === 'spouse of');
    t.call('links.relate', { src: keys.elsabet, dst: keys.brannoc, relId: spouse.id });
    area.sample(t.ctx, S);
    area.sample(t.ctx, S);
    const f = t.call('web.family', w.id);
    assert.equal(f.spouses.length, 1);
    assert.equal(f.parents.length, 6);
    assert.equal(t.call('web.kinship', w.id, keys.wren, keys.corwin).label, 'niece/nephew');
    assert.equal(t.call('web.kinship', w.id, keys.wren, keys.aldous).label, 'great-grandchild');
    // keys that do not exist are skipped
    area.sample(t.ctx, Object.assign({}, S, { e: k => (k === 'wren' ? null : keys[k]) }));
  } finally { t.done(); }
});

test('graph: neighbourhoods, every shortest path, alternatives', () => {
  const E = (id, a, b) => ({ id, a, b });
  const ids = ['a', 'b', 'c', 'd', 'e', 'f', 'z'];
  const edges = [E(1, 'a', 'b'), E(2, 'b', 'd'), E(3, 'a', 'c'), E(4, 'c', 'd'), E(5, 'd', 'e'), E(6, 'a', 'f'), E(7, 'f', 'e'), E(8, 'a', 'b')];
  const adj = Graph.adjacency(ids, edges);
  assert.deepEqual([...Graph.around(adj, 'a', 1).keys()].sort(), ['a', 'b', 'c', 'f']);
  assert.equal(Graph.around(adj, 'a', 2).get('d'), 2);
  const sp = Graph.shortest(adj, 'a', 'e');
  assert.equal(sp.length, 1);
  assert.deepEqual(sp[0].nodes, ['a', 'f', 'e']);
  const all = Graph.shortest(adj, 'a', 'd');
  assert.deepEqual(all.map(p => p.nodes.join('')).sort(), ['abd', 'acd']);
  const alt = Graph.paths(adj, 'a', 'e', 4);
  assert.deepEqual(alt.map(p => p.nodes.join('')), ['afe', 'abde', 'acde']);
  assert.equal(alt[1].edges.length, 3);
  assert.deepEqual(Graph.paths(adj, 'a', 'z'), []);
  const comp = Graph.components(ids, edges);
  assert.equal(comp.get('a'), 0);
  assert.equal(comp.get('z'), 1);
});

test('graph: communities find two cliques joined by one link', () => {
  const ids = [], edges = [];
  let n = 0;
  for (const g of ['p', 'q']) for (let i = 0; i < 6; i++) ids.push(g + i);
  for (const g of ['p', 'q']) for (let i = 0; i < 6; i++) for (let j = i + 1; j < 6; j++) edges.push({ id: n++, a: g + i, b: g + j });
  edges.push({ id: n++, a: 'p0', b: 'q0' });
  ids.push('alone');
  const c = Graph.communities(ids, edges);
  assert.equal(new Set(['p0', 'p1', 'p2', 'p3', 'p4', 'p5'].map(x => c.get(x))).size, 1);
  assert.notEqual(c.get('p1'), c.get('q1'));
  assert.equal(c.get('alone'), -1);
});

test('force layout: 2000 nodes settle quickly into finite, spread positions', () => {
  const nodes = [], links = [];
  for (let i = 0; i < 2000; i++) nodes.push({ r: 5 });
  for (let i = 1; i < 2000; i++) links.push({ s: i, t: Math.floor(i / 3) });
  for (let i = 0; i < 400; i++) links.push({ s: (i * 37) % 2000, t: (i * 101 + 7) % 2000 });
  const sim = Force.create(nodes, links);
  const t0 = Date.now();
  sim.tick(300);
  const ms = Date.now() - t0;
  assert.ok(ms < 20000, 'took ' + ms + ' ms');
  assert.ok(nodes.every(d => Number.isFinite(d.x) && Number.isFinite(d.y)));
  const b = sim.bounds();
  assert.ok(b.x1 - b.x0 > 300 && b.y1 - b.y0 > 300, JSON.stringify(b));
  // pinned nodes stay put; the same input gives the same layout
  const a1 = [{ r: 4, fx: 100, fy: -50 }, { r: 4 }, { r: 4 }], a2 = [{ r: 4, fx: 100, fy: -50 }, { r: 4 }, { r: 4 }];
  const L = [{ s: 0, t: 1 }, { s: 1, t: 2 }];
  Force.create(a1, L).tick(200); Force.create(a2, L).tick(200);
  assert.equal(a1[0].x, 100);
  assert.deepEqual(a1.map(d => Math.round(d.x * 1000)), a2.map(d => Math.round(d.x * 1000)));
});
