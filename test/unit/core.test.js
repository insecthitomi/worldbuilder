'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { make } = require('./helpers');

test('worlds start with the built-in types and relation types', () => {
  const t = make();
  try {
    const w = t.call('worlds.create', { name: 'Testland', starter: 'fantasy' });
    assert.equal(w.name, 'Testland');
    const types = t.call('types.list', w.id);
    assert.ok(types.find(x => x.key === 'character' && x.lifespan));
    assert.ok(types.length >= 20);
    assert.ok(t.call('rels.list', w.id).find(r => r.familyRole === 'parent'));
    assert.equal(t.call('worlds.list').length, 1);
  } finally { t.done(); }
});

test('entries: create, mention links, field links, search, revisions, trash and restore', () => {
  const t = make();
  try {
    const w = t.call('worlds.create', { name: 'W' });
    const mira = t.call('entries.create', { worldId: w.id, typeKey: 'character', title: 'Mira Saltborn', summary: 'A tide-witch' });
    const town = t.call('entries.create', { worldId: w.id, typeKey: 'place', title: 'Gullhaven' });
    const ev = t.call('entries.create', { worldId: w.id, typeKey: 'event', title: 'The Drowning',
      body: `<p>When <a class="wb-m" data-id="${mira.id}">Mira</a> sang, the sea rose.</p>`, fields: { location: town.id, participants: [mira.id] } });
    assert.equal(ev.wordCount, 6);
    const ctxMira = t.call('entries.context', mira.id);
    assert.equal(ctxMira.mentionedBy.length, 1);
    assert.equal(ctxMira.referencedBy.length, 1);
    assert.equal(t.call('entries.context', town.id).referencedBy[0].link.key, 'location');
    // search finds body words and titles anywhere
    assert.equal(t.call('search.query', w.id, 'sea rose')[0].id, ev.id);
    assert.equal(t.call('search.query', w.id, 'tide')[0].id, mira.id);
    assert.equal(t.call('search.query', w.id, 'haven')[0].id, town.id);
    assert.equal(t.call('search.query', w.id, 't:place')[0].id, town.id);
    // the first edit keeps the previous version
    t.call('entries.update', ev.id, { body: '<p>Changed.</p>' });
    assert.equal(t.call('revisions.list', ev.id).length, 1);
    assert.equal(t.call('entries.context', mira.id).mentionedBy.length, 0);
    // trash hides, restore brings back with its children
    const child = t.call('entries.create', { worldId: w.id, typeKey: 'place', title: 'Harbour', parentId: town.id });
    t.call('entries.trash', town.id);
    assert.equal(t.call('entries.list', w.id, {}).filter(e => e.id === child.id).length, 0);
    assert.equal(t.call('search.query', w.id, 'Harbour').length, 0);
    t.call('entries.restore', town.id);
    assert.equal(t.call('entries.get', child.id).deletedAt, null);
    assert.equal(t.call('entries.list', w.id, { parentId: town.id })[0].id, child.id);
  } finally { t.done(); }
});

test('relations read both ways, refuse cycles and duplicates', () => {
  const t = make();
  try {
    const w = t.call('worlds.create', { name: 'W' });
    const rels = t.call('rels.list', w.id), parentOf = rels.find(r => r.name === 'parent of'), spouse = rels.find(r => r.name === 'spouse of');
    const a = t.call('entries.create', { worldId: w.id, typeKey: 'character', title: 'Old Brannoc' });
    const b = t.call('entries.create', { worldId: w.id, typeKey: 'character', title: 'Young Brannoc' });
    t.call('links.relate', { src: a.id, dst: b.id, relId: parentOf.id });
    const fromB = t.call('entries.context', b.id).relations[0];
    assert.equal(fromB.label, 'child of');
    assert.equal(fromB.other.id, a.id);
    t.call('links.relate', { src: a.id, dst: b.id, relId: spouse.id });
    t.call('links.relate', { src: b.id, dst: a.id, relId: spouse.id });   // symmetric duplicate is ignored
    assert.equal(t.call('links.relations', w.id).length, 2);
    assert.throws(() => t.call('entries.update', a.id, { parentId: a.id }), /inside itself/);
    const c = t.call('entries.create', { worldId: w.id, typeKey: 'place', title: 'C', parentId: a.id });
    assert.throws(() => t.call('entries.move', a.id, { parentId: c.id }), /inside itself/);
  } finally { t.done(); }
});

test('merge folds one entry into another and repoints everything', () => {
  const t = make();
  try {
    const w = t.call('worlds.create', { name: 'W' });
    const a = t.call('entries.create', { worldId: w.id, typeKey: 'character', title: 'Captain Vey', fields: { occupation: 'Captain' } });
    const b = t.call('entries.create', { worldId: w.id, typeKey: 'character', title: 'Vey', fields: { pronouns: 'she/her' }, body: '<p>Duplicate notes.</p>' });
    const s = t.call('entries.create', { worldId: w.id, typeKey: 'scene', title: 'Storm', body: `<p><a class="wb-m" data-id="${b.id}">Vey</a> took the wheel.</p>`, fields: { pov: b.id } });
    const m = t.call('entries.merge', a.id, b.id);
    assert.deepEqual(m.aliases, ['Vey']);
    assert.equal(m.fields.pronouns, 'she/her');
    assert.match(m.body, /Duplicate notes/);
    const scene = t.call('entries.get', s.id);
    assert.equal(scene.fields.pov, a.id);
    assert.match(scene.body, new RegExp(a.id));
    assert.equal(t.call('entries.context', a.id).mentionedBy.length, 1);
    assert.throws(() => t.call('entries.get', b.id));
  } finally { t.done(); }
});

test('merge keeps other areas\' rows: they follow the survivor instead of cascading away', () => {
  const t = make();
  try {
    const db = t.ctx.db;
    const w = t.call('worlds.create', { name: 'W' });
    const a = t.call('entries.create', { worldId: w.id, typeKey: 'note', title: 'Old Tide' });
    const b = t.call('entries.create', { worldId: w.id, typeKey: 'note', title: 'Old Tide copy' });
    const has = n => db.hasTable(n);
    if (has('words')) db.run("INSERT INTO words (id, world_id, language_id, word, gloss) VALUES ('wq1xxxxxxx', ?, ?, 'mar', 'sea')", w.id, b.id);
    if (has('map_items')) db.run("INSERT INTO map_items (id, world_id, map_id, kind, entry_id, note) VALUES ('mq1xxxxxxx', ?, ?, 'pin', ?, ?)", w.id, b.id, b.id, 'see ' + b.id);
    const task = t.call('tasks.save', { worldId: w.id, title: 'Tidy', entryId: b.id });
    db.run('UPDATE worlds SET settings = ? WHERE id = ?', JSON.stringify({ featured: [b.id] }), w.id);
    db.run("INSERT INTO writing_log (world_id, day, entry_id, words) VALUES (?, '2026-01-01', ?, 100), (?, '2026-01-01', ?, 50)", w.id, a.id, w.id, b.id);
    t.call('entries.merge', a.id, b.id);
    if (has('words')) assert.equal(db.value("SELECT language_id FROM words WHERE id = 'wq1xxxxxxx'"), a.id);
    if (has('map_items')) {
      const it = db.get("SELECT map_id, entry_id, note FROM map_items WHERE id = 'mq1xxxxxxx'");
      assert.deepEqual([it.map_id, it.entry_id, it.note], [a.id, a.id, 'see ' + a.id]);
    }
    assert.equal(db.value('SELECT entry_id FROM tasks WHERE id = ?', task.id), a.id);
    assert.deepEqual(JSON.parse(db.value('SELECT settings FROM worlds WHERE id = ?', w.id)).featured, [a.id]);
    assert.deepEqual(db.all('SELECT entry_id, words FROM writing_log WHERE world_id = ?', w.id).map(r => [r.entry_id, r.words]), [[a.id, 150]]);
  } finally { t.done(); }
});

test('duplicate copies what other areas keep inside an entry, with references among the copies', () => {
  const t = make();
  try {
    const db = t.ctx.db, has = n => db.hasTable(n);
    const w = t.call('worlds.create', { name: 'W' });
    const a = t.call('entries.create', { worldId: w.id, typeKey: 'note', title: 'Container' });
    if (has('words')) {
      db.run("INSERT INTO words (id, world_id, language_id, word) VALUES ('wroot00001', ?, ?, 'mar')", w.id, a.id);
      db.run("INSERT INTO words (id, world_id, language_id, word, root_id) VALUES ('wderiv0001', ?, ?, 'marin', 'wroot00001')", w.id, a.id);
    }
    if (has('board_items')) {
      db.run("INSERT INTO board_items (id, world_id, board_id, kind) VALUES ('bcard00001', ?, ?, 'note'), ('bcard00002', ?, ?, 'note')", w.id, a.id, w.id, a.id);
      db.run("INSERT INTO board_links (id, world_id, board_id, from_item, to_item) VALUES ('blink00001', ?, ?, 'bcard00001', 'bcard00002')", w.id, a.id);
    }
    const c = t.call('entries.duplicate', a.id, {});
    if (has('words')) {
      const ws = db.all('SELECT id, word, root_id FROM words WHERE language_id = ? ORDER BY word', c.id);
      assert.equal(ws.length, 2);
      assert.equal(ws[1].root_id, ws[0].id, 'the copied word derives from the copied root');
      assert.notEqual(ws[0].id, 'wroot00001');
    }
    if (has('board_items')) {
      const cards = db.all('SELECT id FROM board_items WHERE board_id = ?', c.id).map(r => r.id);
      const l = db.get('SELECT from_item, to_item FROM board_links WHERE board_id = ?', c.id);
      assert.equal(cards.length, 2);
      assert.ok(cards.includes(l.from_item) && cards.includes(l.to_item));
      assert.equal(db.value('SELECT count(*) FROM board_items WHERE board_id = ?', a.id), 2, 'the original keeps its cards');
    }
  } finally { t.done(); }
});

test('world packages round-trip with new ids', () => {
  const t = make();
  try {
    const w = t.call('worlds.create', { name: 'Original' });
    const a = t.call('entries.create', { worldId: w.id, typeKey: 'character', title: 'Ash', tagNames: ['hero'] });
    t.call('entries.create', { worldId: w.id, typeKey: 'place', title: 'Ashford', body: `<p>Home of <a class="wb-m" data-id="${a.id}">Ash</a>.</p>`, fields: { ruler: a.id } });
    const copy = t.call('worlds.duplicate', w.id);
    assert.notEqual(copy.id, w.id);
    const list = t.call('entries.list', copy.id, {});
    assert.equal(list.length, 2);
    const ash2 = list.find(e => e.title === 'Ash');
    assert.notEqual(ash2.id, a.id);
    assert.equal(ash2.tags.length, 1);
    const ctx2 = t.call('entries.context', ash2.id);
    assert.equal(ctx2.mentionedBy.length, 1);
    assert.equal(ctx2.referencedBy.length, 1);
    assert.equal(t.call('search.query', copy.id, 'Ashford').length, 1);
  } finally { t.done(); }
});

test('unlinked mentions are found and linked; find & replace skips links', () => {
  const t = make();
  try {
    const w = t.call('worlds.create', { name: 'W' });
    const g = t.call('entries.create', { worldId: w.id, typeKey: 'place', title: 'Gullhaven', aliases: ['the Haven'] });
    const s = t.call('entries.create', { worldId: w.id, typeKey: 'scene', title: 'Arrival', body: '<p>They sailed into Gullhaven at dawn. Gullhaven was quiet. Seagulls everywhere.</p>' });
    const found = t.call('links.unlinked', w.id, {});
    assert.equal(found.length, 1);
    assert.equal(found[0].target, g.id);
    assert.equal(found[0].count, 2);
    assert.equal(t.call('links.unlinked', w.id, { targetId: g.id }).length, 1);
    t.call('links.linkUnlinked', w.id, [{ src: s.id, target: g.id }]);
    const after = t.call('entries.get', s.id);
    assert.equal((after.body.match(/wb-m/g) || []).length, 1, 'first occurrence only');
    assert.equal(t.call('entries.context', g.id).mentionedBy.length, 1);
    assert.equal(t.call('links.unlinked', w.id, {}).length, 0, 'already linked targets are not reported');
    // find & replace changes plain text but never the link label
    assert.equal(t.call('text.find', w.id, 'gullhaven', {})[0].count, 1);
    const r = t.call('text.replace', w.id, 'quiet', 'restless', { wholeWord: true });
    assert.equal(r.replacements, 1);
    assert.match(t.call('entries.get', s.id).body, /restless/);
    assert.match(t.call('entries.get', s.id).body, /data-id="[a-z0-9]{10}">Gullhaven<\/a>/);
    assert.ok(t.call('entries.random', w.id));
  } finally { t.done(); }
});

test('types copy between worlds', () => {
  const t = make();
  try {
    const a = t.call('worlds.create', { name: 'A' }), b = t.call('worlds.create', { name: 'B' });
    const ship = t.call('types.save', { worldId: a.id, name: 'Ship', fields: [{ label: 'Crew', kind: 'number' }] });
    const charA = t.call('types.list', a.id).find(x => x.key === 'character');
    t.call('types.save', Object.assign({}, charA, { fields: charA.fields.concat([{ label: 'Blood type', kind: 'text' }]) }));
    const r = t.call('types.copyFrom', b.id, a.id, null);
    assert.equal(r.added, 1);
    assert.ok(r.merged >= 1);
    assert.ok(t.call('types.list', b.id).find(x => x.key === 'ship'));
    assert.ok(t.call('types.list', b.id).find(x => x.key === 'character').fields.find(f => f.key === 'blood_type'));
  } finally { t.done(); }
});

test('types: custom fields create links; built-ins cannot be deleted', () => {
  const t = make();
  try {
    const w = t.call('worlds.create', { name: 'W' });
    const ship = t.call('types.save', { worldId: w.id, name: 'Ship', plural: 'Ships', fields: [{ label: 'Captain', kind: 'ref', refTypes: ['character'] }, { label: 'Captain', kind: 'text' }] });
    assert.equal(ship.key, 'ship');
    assert.deepEqual(ship.fields.map(f => f.key), ['captain', 'captain_2']);
    const cap = t.call('entries.create', { worldId: w.id, typeKey: 'character', title: 'Cap' });
    t.call('entries.create', { worldId: w.id, typeId: ship.id, title: 'Gull', fields: { captain: cap.id } });
    assert.equal(t.call('entries.context', cap.id).referencedBy.length, 1);
    assert.throws(() => t.call('types.remove', t.call('types.list', w.id).find(x => x.key === 'character').id), /hidden/);
    assert.throws(() => t.call('types.remove', ship.id), /Move them/);
  } finally { t.done(); }
});

/* ---------------- nesting: move, reparent, order, cycles, bulk, counts ---------------- */
function nestWorld(t) {
  const w = t.call('worlds.create', { name: 'Nest' });
  const mk = (title, parentId, typeKey = 'place') => t.call('entries.create', { worldId: w.id, typeKey, title, parentId });
  const kids = pid => t.call('entries.list', w.id, { parentId: pid, sort: 'position' }).map(e => e.title);
  return { w, mk, kids };
}

test('nesting: moving reparents and orders siblings with fractional positions', () => {
  const t = make();
  try {
    const { mk, kids } = nestWorld(t);
    const root = mk('Root'), a = mk('A', root.id), b = mk('B', root.id), c = mk('C', root.id), other = mk('Other');
    assert.deepEqual(kids(root.id), ['A', 'B', 'C']);
    t.call('entries.move', c.id, { beforeId: a.id });
    assert.deepEqual(kids(root.id), ['C', 'A', 'B']);
    t.call('entries.move', c.id, { afterId: b.id });
    assert.deepEqual(kids(root.id), ['A', 'B', 'C']);
    // an insert between two neighbours writes only the moved entry (fractional)
    const before = t.call('entries.get', a.id).position;
    t.call('entries.move', c.id, { beforeId: b.id });
    assert.equal(t.call('entries.get', a.id).position, before);
    const pc = t.call('entries.get', c.id).position, pa = t.call('entries.get', a.id).position, pb = t.call('entries.get', b.id).position;
    assert.ok(pc > pa && pc < pb && !Number.isInteger(pc), 'C sits strictly between A and B');
    // reparent: leaves the old list, lands last in the new one
    t.call('entries.move', a.id, { parentId: other.id });
    assert.deepEqual(kids(root.id), ['C', 'B']);
    assert.deepEqual(kids(other.id), ['A']);
    t.call('entries.move', b.id, { parentId: null });
    assert.equal(t.call('entries.get', b.id).parentId, null);
    // many inserts into the same gap still keep a strict order (renumbering kicks in)
    const hub = mk('Hub'), first = mk('first', hub.id);
    mk('last', hub.id);
    for (let i = 0; i < 60; i++) { const x = mk('n' + i, hub.id); t.call('entries.move', x.id, { afterId: first.id }); }
    const order = kids(hub.id);
    assert.equal(order[0], 'first');
    assert.equal(order[order.length - 1], 'last');
    assert.equal(new Set(order).size, 62);
    assert.equal(order[1], 'n59');
  } finally { t.done(); }
});

test('nesting: cycles, trashed parents and other worlds are refused, orphans cannot appear', () => {
  const t = make();
  try {
    const { mk } = nestWorld(t);
    const a = mk('A'), b = mk('B', a.id), c = mk('C', b.id);
    assert.throws(() => t.call('entries.move', a.id, { parentId: c.id }), /inside itself/);
    assert.throws(() => t.call('entries.move', a.id, { parentId: a.id }), /inside itself/);
    assert.throws(() => t.call('entries.update', a.id, { parentId: b.id }), /inside itself/);
    assert.throws(() => t.call('entries.moveMany', [b.id, c.id, a.id], { parentId: c.id }), /inside itself/);
    assert.equal(t.call('entries.get', b.id).parentId, a.id, 'a refused move changes nothing');
    const dead = mk('Dead'); t.call('entries.trash', dead.id);
    assert.throws(() => t.call('entries.move', b.id, { parentId: dead.id }), /no longer exists/);
    assert.throws(() => mk('X', dead.id), /no longer exists/);
    const w2 = t.call('worlds.create', { name: 'Other' });
    const foreign = t.call('entries.create', { worldId: w2.id, typeKey: 'place', title: 'Elsewhere' });
    assert.throws(() => t.call('entries.move', b.id, { parentId: foreign.id }), /another world/);
    assert.throws(() => t.call('entries.move', 'nope', { parentId: null }), /no longer exists/);
  } finally { t.done(); }
});

test('nesting: indent, outdent and shift (Tab, Shift+Tab, Alt+Up/Down)', () => {
  const t = make();
  try {
    const { mk, kids } = nestWorld(t);
    const root = mk('Root'), a = mk('A', root.id), b = mk('B', root.id), c = mk('C', root.id);
    assert.throws(() => t.call('entries.indent', a.id), /nothing above/);
    t.call('entries.indent', b.id);
    assert.deepEqual(kids(a.id), ['B']);
    assert.deepEqual(kids(root.id), ['A', 'C']);
    t.call('entries.indent', c.id);
    assert.deepEqual(kids(a.id), ['B', 'C']);
    t.call('entries.outdent', b.id);
    assert.deepEqual(kids(root.id), ['A', 'B']);
    assert.deepEqual(kids(a.id), ['C']);
    assert.throws(() => t.call('entries.outdent', root.id), /top level/);
    t.call('entries.shift', b.id, -1);
    assert.deepEqual(kids(root.id), ['B', 'A']);
    t.call('entries.shift', b.id, 1);
    assert.deepEqual(kids(root.id), ['A', 'B']);
    t.call('entries.shift', b.id, 1);
    assert.deepEqual(kids(root.id), ['A', 'B'], 'already last: stays');
  } finally { t.done(); }
});

test('nesting: bulk move keeps order, entries ride with their parent, type rules can be overridden', () => {
  const t = make();
  try {
    const { w, mk, kids } = nestWorld(t);
    const dest = mk('Dest'), p = mk('P'), p1 = mk('P1', p.id), x = mk('X'), y = mk('Y');
    const r = t.call('entries.moveMany', [y.id, p.id, p1.id, x.id], { parentId: dest.id });
    assert.equal(r.n, 3, 'P1 rides inside P');
    assert.deepEqual(kids(dest.id), ['Y', 'P', 'X']);
    assert.equal(t.call('entries.get', p1.id).parentId, p.id);
    const z = mk('Z');
    t.call('entries.moveMany', [z.id, x.id], { parentId: dest.id, beforeId: y.id });
    assert.deepEqual(kids(dest.id), ['Z', 'X', 'Y', 'P']);
    // type rules: strict refuses a character inside a place once nesting is restricted; the override still works
    const ch = mk('Mira', null, 'character');
    t.call('worlds.update', w.id, { settings: { allowAnyNesting: false } });
    assert.throws(() => t.call('entries.move', ch.id, { parentId: dest.id, strict: true }), /type rules/);
    assert.equal(t.call('entries.get', ch.id).parentId, null);
    t.call('entries.move', ch.id, { parentId: dest.id });
    assert.equal(t.call('entries.get', ch.id).parentId, dest.id);
    t.call('entries.move', z.id, { parentId: x.id, strict: true });
    t.call('worlds.update', w.id, { settings: { allowAnyNesting: true } });
    t.call('entries.move', ch.id, { parentId: p.id, strict: true });
    // bulk tag / retype / trash on a selection
    t.call('entries.bulk', [x.id, y.id], { addTag: 'wild' });
    assert.equal(t.call('entries.get', x.id).tags.length, 1);
    const faction = t.call('types.list', w.id).find(k => k.key === 'faction');
    t.call('entries.bulk', [x.id, y.id], { typeId: faction.id });
    assert.equal(t.call('entries.get', y.id).typeId, faction.id);
    t.call('entries.bulk', [x.id, y.id], { trash: true });
    assert.ok(t.call('entries.get', y.id).deletedAt);
  } finally { t.done(); }
});

test('nesting: descendant counts, delete-and-keep-children, duplicate subtree', () => {
  const t = make();
  try {
    const { w, mk, kids } = nestWorld(t);
    const top = mk('Top'), mid = mk('Mid', top.id), leaf1 = mk('L1', mid.id), leaf2 = mk('L2', mid.id), side = mk('Side', top.id);
    let counts = t.call('entries.descendantCounts', w.id);
    assert.equal(counts[top.id], 4);
    assert.equal(counts[mid.id], 2);
    assert.equal(counts[side.id], undefined);
    t.call('entries.trash', leaf2.id);
    assert.equal(t.call('entries.descendantCounts', w.id)[top.id], 3, 'trashed entries are not counted');
    t.call('entries.restore', leaf2.id);
    const copy = t.call('entries.duplicate', top.id, { children: true });
    counts = t.call('entries.descendantCounts', w.id);
    assert.equal(counts[copy.id], 4);
    assert.equal(counts[top.id], 4);
    assert.notEqual(copy.id, top.id);
    // delete Mid but keep what is inside: L1 and L2 move up beside where Mid was
    const res = t.call('entries.removeKeepChildren', mid.id);
    assert.equal(res.promoted.length, 2);
    const order = kids(top.id);
    assert.deepEqual(new Set(order), new Set(['Side', 'L1', 'L2']));
    assert.ok(order.indexOf('L1') < order.indexOf('L2'));
    assert.ok(t.call('entries.get', mid.id).deletedAt);
    assert.equal(t.call('entries.get', leaf1.id).deletedAt, null);
    assert.deepEqual(t.call('entries.removeKeepChildren', side.id).promoted, []);
  } finally { t.done(); }
});
