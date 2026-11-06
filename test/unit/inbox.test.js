'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { make } = require('./helpers');
const When = require('../../src/app/modules/inbox/when');
const { seaWav } = require('../../src/main/areas/inbox');

// Friday 6 November 2026
const FRI = new Date(2026, 10, 6, 9);

test('quick add: natural due dates and priorities', () => {
  const p = s => When.parse(s, FRI);
  assert.deepEqual(p('Map the flats tomorrow !!'), { title: 'Map the flats', due: '2026-11-07', priority: 2, someday: false, dateText: 'tomorrow' });
  assert.equal(p('Call the printer today').due, '2026-11-06');
  assert.equal(p('Draft scene four by fri').due, '2026-11-13');
  assert.equal(p('Draft scene four by fri').title, 'Draft scene four');
  assert.equal(p('mon: outline').due, '2026-11-09');
  assert.equal(p('Reply in 3 days').due, '2026-11-09');
  assert.equal(p('Revise in two weeks').due, '2026-11-20');
  assert.equal(p('Plan the launch next week').due, '2026-11-09');
  assert.equal(p('Name the moons next month').due, '2026-12-01');
  assert.equal(p('Book fair on nov 20').due, '2026-11-20');
  assert.equal(p('Book fair on 3 feb').due, '2027-02-03');
  assert.equal(p('Deadline 2027-01-15').due, '2027-01-15');
  assert.equal(p('Write the epilogue this weekend').due, '2026-11-07');
  assert.equal(p('Learn the harp someday').someday, true);
  assert.equal(p('Learn the harp someday').title, 'Learn the harp');
  assert.equal(p('Paint the sun on the banner').due, null, 'an ordinary "sun" is not Sunday');
  assert.equal(p('Paint the sun on the banner on fri').due, '2026-11-13');
  assert.equal(p('Fix the map p1').priority, 3);
  assert.equal(p('Fix the map !').priority, 1);
  assert.equal(p('Plain task').due, null);
  assert.equal(When.describe('2026-11-07', FRI), 'Tomorrow');
  assert.equal(When.bucket('2026-11-05', FRI), 'overdue');
  assert.equal(When.bucket(null, FRI), 'someday');
});

test('gaps to fill: required fields that are empty, minus the ones already turned into tasks', () => {
  const t = make();
  try {
    const w = t.call('worlds.create', { name: 'W', starter: 'fantasy' });
    const a = t.call('entries.create', { worldId: w.id, typeKey: 'character', title: 'Corwin' });
    t.call('entries.create', { worldId: w.id, typeKey: 'character', title: 'Ysolde', fields: { goals: 'Command the fleet' } });
    t.call('entries.create', { worldId: w.id, typeKey: 'character', title: 'Idea', inbox: true });
    let g = t.call('inbox.gaps', w.id);
    assert.deepEqual(g.gaps.map(x => x.title), ['Corwin']);
    assert.equal(g.gaps[0].missing[0].task, 'Decide what Corwin wants');
    assert.equal(g.gaps[0].entry.id, a.id);
    t.call('tasks.save', { worldId: w.id, title: g.gaps[0].missing[0].task, entryId: a.id });
    g = t.call('inbox.gaps', w.id);
    assert.equal(g.gaps.length, 0);
    assert.equal(t.call('inbox.counts', w.id).inbox, 1);
  } finally { t.done(); }
});

test('the example voice memo is a playable WAV kept with an inbox note', () => {
  const wav = seaWav(1);
  assert.equal(wav.toString('ascii', 0, 4), 'RIFF');
  assert.equal(wav.length, 44 + 16000 * 2);
  const t = make();
  try {
    const w = t.call('worlds.sample');
    const notes = t.call('entries.list', w.id, { inbox: true });
    const memo = notes.find(e => /Voice memo/.test(e.title));
    assert.ok(memo);
    const full = t.call('entries.get', memo.id);
    const m = t.call('media.get', full.fields.audio);
    assert.equal(m.kind, 'audio');
    assert.equal(t.call('inbox.counts', w.id).voice, 1);
  } finally { t.done(); }
});
