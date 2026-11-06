'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { make } = require('./helpers');
const T = require('../../src/shared/richtext');

test('the example world builds with every area and has no broken references', () => {
  const t = make();
  try {
    const w = t.call('worlds.sample');
    assert.equal(w.name, 'The Saltmarch');
    const list = t.call('entries.list', w.id, {});
    assert.ok(list.length >= 60, 'expected a rich world, got ' + list.length);
    const ids = new Set(list.map(e => e.id));
    for (const e of list) {
      const full = t.call('entries.get', e.id);
      for (const id of T.mentions(full.body)) assert.ok(ids.has(id), `${e.title} mentions a missing entry`);
    }
    const now = w.now;
    assert.equal(t.ctx.core.calendarFor(w.id).format(now), '14 Gale 1203 AT');
    // the family is wired
    const brannoc = list.find(e => e.title === 'Brannoc Vey');
    const rel = t.call('entries.context', brannoc.id).relations;
    assert.ok(rel.filter(r => r.familyRole === 'parent').length >= 3);
    // search works on the sample text
    assert.ok(t.call('search.query', w.id, 'drowned tower').length > 0);
    // no revisions or today's words from building it
    assert.equal(t.ctx.db.value('SELECT count(*) FROM revisions WHERE world_id = ?', w.id), 0);
  } finally { t.done(); }
});
