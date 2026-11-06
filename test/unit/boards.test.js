'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { make } = require('./helpers');

test('boards: templates build cards and connectors', () => {
  const t = make();
  try {
    const w = t.call('worlds.create', { name: 'W' });
    const list = t.call('boards.templates');
    assert.deepEqual(list.map(x => x.key), ['blank', 'plot', 'mindmap', 'mystery', 'mood', 'kanban']);
    for (const tpl of list.filter(x => x.key !== 'blank')) {
      const b = t.call('boards.create', w.id, { template: tpl.key, title: tpl.label });
      assert.ok(b.items.length >= 4, tpl.key + ' has cards');
      assert.equal(b.board.fields.purpose, tpl.purpose);
      for (const l of b.links) { assert.ok(b.items.find(i => i.id === l.from)); assert.ok(b.items.find(i => i.id === l.to)); }
    }
    const plot = t.call('boards.list', w.id).find(b => b.title === 'Three-act plot');
    assert.ok(plot.itemCount > 10 && plot.linkCount === 8);
    assert.equal(plot.preview.items.length, plot.itemCount);
  } finally { t.done(); }
});

test('boards: cards, connectors, undo snapshots and appearances', () => {
  const t = make();
  try {
    const w = t.call('worlds.create', { name: 'W' });
    const mira = t.call('entries.create', { worldId: w.id, typeKey: 'character', title: 'Mira' });
    const { board } = t.call('boards.create', w.id, { title: 'Plot' });
    const [a, b, c] = t.call('boards.addItems', board.id, [
      { kind: 'note', x: 10, y: 20, text: '<p>Hello <script>x</script><b>there</b></p>' },
      { kind: 'entry', entryId: mira.id, x: 300, y: 20 },
      { kind: 'checklist', x: 0, y: 300, text: 'Todo', data: { items: [{ text: 'one', done: false }] } },
    ]);
    assert.equal(a.text, '<p>Hello <strong>there</strong></p>');
    assert.equal(b.w, 250);
    assert.ok(c.z > b.z && b.z > a.z);
    // a card can only point at an entry of the same world
    const other = t.call('worlds.create', { name: 'Other' });
    const stranger = t.call('entries.create', { worldId: other.id, typeKey: 'note', title: 'x' });
    assert.equal(t.call('boards.addItem', board.id, { kind: 'entry', entryId: stranger.id }).entryId, null);

    const l = t.call('boards.addLink', board.id, { from: a.id, to: b.id, label: 'knows' });
    assert.equal(t.call('boards.addLink', board.id, { from: a.id, to: b.id }).id, l.id, 'no duplicate connectors');
    assert.throws(() => t.call('boards.addLink', board.id, { from: a.id, to: a.id }));
    t.call('boards.updateLink', l.id, { style: { dash: 'dashed' }, label: 'loves' });
    assert.equal(t.call('boards.get', board.id).links[0].style.dash, 'dashed');

    const moved = t.call('boards.updateItems', [{ id: a.id, x: 99, y: -5 }, { id: c.id, data: { items: [{ text: 'one', done: true }] } }]);
    assert.equal(moved[0].x, 99); assert.equal(moved[0].text, a.text);
    assert.equal(moved[1].data.items[0].done, true);

    assert.deepEqual(t.call('boards.appearances', mira.id).map(x => [x.title, x.count]), [['Plot', 1]]);

    // removing a card takes its connectors along; restore brings both back
    const snap = t.call('boards.removeItems', [b.id]);
    assert.equal(snap.links.length, 1);
    assert.equal(t.call('boards.get', board.id).links.length, 0);
    t.call('boards.restore', snap);
    const back = t.call('boards.get', board.id);
    assert.equal(back.items.length, 4);
    assert.equal(back.links[0].label, 'loves');
    assert.equal(back.entries[0].id, mira.id);

    // a purged entry leaves an empty card; a purged board takes its cards along
    t.call('entries.purge', mira.id);
    assert.equal(t.call('boards.get', board.id).items.find(i => i.id === b.id).entryId, null);
    t.call('entries.purge', board.id);
    assert.equal(t.ctx.db.value('SELECT count(*) FROM board_items'), 0);
    assert.equal(t.ctx.db.value('SELECT count(*) FROM board_links'), 0);
  } finally { t.done(); }
});

test('boards: images count as media use; duplicate and package round-trip keep cards', () => {
  const t = make();
  try {
    const w = t.call('worlds.create', { name: 'W' });
    const m = t.call('media.save', w.id, { name: 'p.svg', mime: 'image/svg+xml', bytes: Buffer.from('<svg width="10" height="5" xmlns="http://www.w3.org/2000/svg"></svg>') });
    const { board } = t.call('boards.create', w.id, { title: 'Mood', template: 'mood' });
    assert.equal(t.call('media.list', w.id, { unused: true }).length, 1);
    const img = t.call('boards.addItem', board.id, { kind: 'image', mediaId: m.id, x: 0, y: 0 });
    assert.equal(t.call('media.usage', m.id)[0].entryId, board.id);
    assert.equal(t.call('media.list', w.id, { unused: true }).length, 0);
    const copy = t.call('boards.duplicate', board.id);
    assert.equal(copy.items.length, t.call('boards.get', board.id).items.length);
    assert.notEqual(copy.items[0].id, t.call('boards.get', board.id).items[0].id);
    t.call('boards.removeItems', [img.id]);
    assert.equal(t.call('entries.get', board.id).data.media, undefined);
    const pk = t.call('worlds.pack', w.id);
    const w2 = t.call('worlds.unpack', pk, { name: 'Copy' });
    const boards = t.call('boards.list', w2.id);
    assert.equal(boards.length, 2);
    assert.ok(boards.every(b => b.itemCount > 5));
  } finally { t.done(); }
});

test('boards: the example world gets a plot board with cards, frames and connectors', () => {
  const t = make();
  try {
    const w = t.call('worlds.sample');
    const list = t.call('boards.list', w.id);
    const plot = list.find(b => /Salt Heir|novella/i.test(b.title));
    assert.ok(plot, 'plot board exists');
    const b = t.call('boards.get', plot.id);
    assert.ok(b.items.filter(i => i.kind === 'frame').length >= 4);
    assert.ok(b.items.filter(i => i.kind === 'entry').length >= 8);
    assert.ok(b.items.filter(i => i.kind === 'image' && i.mediaId).length >= 2);
    assert.ok(b.links.length >= 8);
    assert.ok(b.entries.every(e => !e.deletedAt));
  } finally { t.done(); }
});
