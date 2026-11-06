'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
const { make } = require('./helpers');
const { imageSize } = require('../../src/main/areas/media');

// a 3×2 PNG
const PNG = Buffer.from('89504e470d0a1a0a0000000d49484452000000030000000208060000009d74e8b30000001049444154789c63f80f04000002ff01fe0e3aa0d00000000049454e44ae426082', 'hex');

test('media: stored, sized, used-by and purged', () => {
  const t = make();
  try {
    const w = t.call('worlds.create', { name: 'W' });
    const m = t.call('media.save', w.id, { name: 'tiny.png', mime: 'image/png', bytes: new Uint8Array(PNG) });
    assert.equal(m.kind, 'image');
    assert.equal(m.width, 3); assert.equal(m.height, 2);
    assert.ok(fs.existsSync(path.join(t.dir, 'media', w.id, m.file)));
    t.call('entries.create', { worldId: w.id, typeKey: 'character', title: 'Pic', coverId: m.id });
    assert.equal(t.call('media.usage', m.id).length, 1);
    assert.equal(t.call('media.list', w.id, { unused: true }).length, 0);
    t.call('media.purge', m.id);
    assert.equal(t.call('media.list', w.id).length, 0);
    assert.equal(imageSize(Buffer.from('<svg width="640" height="480" xmlns="http://www.w3.org/2000/svg"></svg>'), 'image/svg+xml').w, 640);
    assert.equal(imageSize(Buffer.from('<svg viewBox="0 0 2000 1000"></svg>'), 'image/svg+xml').h, 1000);
  } finally { t.done(); }
});

test('tasks and writing stats', () => {
  const t = make();
  try {
    const w = t.call('worlds.create', { name: 'W' });
    const e = t.call('entries.create', { worldId: w.id, typeKey: 'scene', title: 'S', body: '<p>one two three four five</p>' });
    const task = t.call('tasks.save', { worldId: w.id, title: 'Name the harbour', entryId: e.id, due: '2000-01-01' });
    assert.equal(t.call('tasks.counts', w.id).overdue, 1);
    t.call('tasks.toggle', task.id);
    assert.equal(t.call('tasks.counts', w.id).open, 0);
    const s = t.call('writing.stats', w.id, 30);
    assert.equal(s.today, 5);
    assert.equal(s.streak, 1);
    t.call('entries.update', e.id, { body: '<p>one two</p>' });
    assert.equal(t.call('writing.stats', w.id, 30).today, 2);
  } finally { t.done(); }
});

test('backups: a consistent copy that opens as a database', () => {
  const t = make();
  try {
    const w = t.call('worlds.create', { name: 'W' });
    t.call('entries.create', { worldId: w.id, typeKey: 'note', title: 'kept' });
    const b = t.call('backup.create', 'Unit test');
    assert.equal(b.label, 'Unit test');
    const { open } = require('../../src/main/db');
    const copy = open(path.join(t.dir, 'backups', b.file));
    assert.equal(copy.value("SELECT title FROM entries WHERE title = 'kept'"), 'kept');
    copy.close();
    assert.equal(t.call('backup.list').length, 1);
  } finally { t.done(); }
});
