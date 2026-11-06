'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
const { make } = require('./helpers');
const SP = require('../../src/main/lib/write-script');
const WC = require('../../src/main/lib/write-compile');

function novel(t) {
  const w = t.call('worlds.create', { name: 'Inkwell', starter: 'novel' });
  const hero = t.call('entries.create', { worldId: w.id, typeKey: 'character', title: 'Ada Quill' });
  const made = t.call('write.newStory', w.id, { title: 'The Long Tide' });
  const ch2 = t.call('entries.create', { worldId: w.id, typeKey: 'chapter', parentId: made.story.id, title: 'The Harbour' });
  t.call('entries.update', made.scene.id, { body: `<p>When <a class="wb-m" data-id="${hero.id}">Ada</a> woke, the sea was gone.</p><p class="wb-s">She is the heir.</p>`, fields: { status: 'Final' } });
  const s2 = t.call('entries.create', { worldId: w.id, typeKey: 'scene', parentId: made.chapter.id, title: 'Second', body: '<p>Gulls, gulls everywhere.</p>', fields: { status: 'Draft' } });
  const s3 = t.call('entries.create', { worldId: w.id, typeKey: 'scene', parentId: ch2.id, title: 'Third', body: '<p>The harbour was <em>empty</em>.</p>', fields: { status: 'Idea' } });
  return { w, hero, story: made.story, ch1: made.chapter, ch2, s1: made.scene, s2, s3 };
}

test('write: the tree holds stories, chapters and scenes in order', () => {
  const t = make();
  try {
    const n = novel(t);
    const tr = t.call('write.tree', n.w.id);
    assert.ok(tr.typeIds.story && tr.typeIds.chapter && tr.typeIds.scene);
    const kinds = Object.fromEntries(tr.nodes.map(x => [x.id, x.kind]));
    assert.equal(kinds[n.story.id], 'story');
    assert.equal(kinds[n.ch2.id], 'chapter');
    assert.equal(kinds[n.s3.id], 'scene');
    const s1 = tr.nodes.find(x => x.id === n.s1.id);
    assert.equal(s1.fields.status, 'Final');
    assert.ok(s1.words > 5);
    // moving a scene to another chapter keeps the order the user chose
    t.call('entries.move', n.s2.id, { parentId: n.ch2.id, beforeId: n.s3.id });
    const kids = t.call('write.tree', n.w.id).nodes.filter(x => x.parentId === n.ch2.id).map(x => x.id);
    assert.deepEqual(kids, [n.s2.id, n.s3.id]);
    assert.equal(t.call('write.storyOf', n.s3.id), n.story.id);
  } finally { t.done(); }
});

test('write: compile turns mentions into text, drops secrets and follows the options', () => {
  const t = make();
  try {
    const n = novel(t);
    const md = t.call('write.compile', n.story.id, { format: 'md', chapterHeads: 'words', author: 'Jo Pen' });
    assert.match(md.text, /^# The Long Tide/);
    assert.match(md.text, /\*by Jo Pen\*/);
    assert.match(md.text, /## Chapter One/);
    assert.match(md.text, /## Chapter Two: The Harbour/);
    assert.match(md.text, /When Ada woke/);
    assert.doesNotMatch(md.text, /heir/);
    assert.doesNotMatch(md.text, /\[\[|wb-m/);
    assert.match(md.text, /\* \* \*/);
    const secret = t.call('write.compile', n.story.id, { format: 'txt', secrets: true });
    assert.match(secret.text, /She is the heir/);
    const skip = t.call('write.compile', n.story.id, { format: 'txt', skipStatuses: ['Idea'], exclude: [n.s2.id] });
    assert.doesNotMatch(skip.text, /empty|Gulls/);
    assert.equal(skip.stats.scenes, 1);
    const html = t.call('write.compile', n.story.id, { format: 'html', style: 'manuscript', author: 'Jo Pen' });
    assert.match(html.text, /Courier New/);
    assert.match(html.text, /about \d+ words/);
    assert.match(html.text, /<p class="sep">#<\/p>/);
    const rtf = t.call('write.compile', n.story.id, { format: 'rtf', style: 'manuscript', author: 'Jo Pen' });
    assert.match(rtf.text, /^\{\\rtf1/);
    assert.match(rtf.text, /Pen \/ THE LONG TIDE \/ \\chpgn/);
    assert.match(rtf.text, /\{\\ul empty\}/);
    assert.equal(rtf.text.split('{').length, rtf.text.split('}').length);
  } finally { t.done(); }
});

test('write: export writes the file; PDF needs the desktop app', async () => {
  const t = make();
  try {
    const n = novel(t);
    const file = path.join(t.dir, 'out.md');
    const r = await t.call('write.export', n.story.id, { format: 'md', path: file });
    assert.equal(r.path, file);
    assert.match(fs.readFileSync(file, 'utf8'), /The Long Tide/);
    await assert.rejects(() => t.call('write.export', n.story.id, { format: 'pdf', path: path.join(t.dir, 'out.pdf') }), /desktop/);
  } finally { t.done(); }
});

test('write: find and replace leave mentions alone and can be undone', () => {
  const t = make();
  try {
    const n = novel(t);
    const hits = t.call('write.find', n.story.id, 'ada');
    assert.equal(hits.length, 1);
    assert.equal(hits[0].snippets[0].match, 'Ada');
    assert.equal(t.call('write.find', n.story.id, 'gull', { wholeWord: true }).length, 0);
    assert.equal(t.call('write.find', n.story.id, 'gulls', { wholeWord: true })[0].count, 2);
    const r = t.call('write.replace', n.story.id, 'gulls', 'terns', {});
    assert.equal(r.n, 2);
    assert.match(t.call('entries.get', n.s2.id).body, /terns, terns everywhere/);
    // a mention's label is never rewritten
    t.call('write.replace', n.story.id, 'Ada', 'Bea', {});
    assert.match(t.call('entries.get', n.s1.id).body, /data-id="[a-z0-9]+">Ada<\/a>/);
    t.call('write.restoreBodies', r.changed);
    assert.match(t.call('entries.get', n.s2.id).body, /Gulls, gulls/);
  } finally { t.done(); }
});

test('write: split and join scenes', () => {
  const t = make();
  try {
    const n = novel(t);
    const b = t.call('write.split', n.s2.id, { before: '<p>Gulls,</p>', after: '<p>gulls everywhere.</p>', title: 'Second, part two' });
    const kids = t.call('write.tree', n.w.id).nodes.filter(x => x.parentId === n.ch1.id).map(x => x.id);
    assert.deepEqual(kids, [n.s1.id, n.s2.id, b.id]);
    assert.equal(b.fields.status, 'Draft');
    const j = t.call('write.join', [n.s2.id, b.id]);
    assert.equal(j.trashed[0], b.id);
    assert.match(t.call('entries.get', n.s2.id).body, /Gulls,<\/p><hr><p>gulls everywhere/);
    assert.ok(t.call('entries.get', b.id).deletedAt);
  } finally { t.done(); }
});

test('write: stats roll up stories; sessions and data are kept', () => {
  const t = make();
  try {
    const n = novel(t);
    t.call('entries.update', n.story.id, { fields: { target: 1000, stage: 'Drafting' } });
    t.call('write.session', n.w.id, { storyId: n.story.id, entryId: n.s1.id, seconds: 600, words: 120 });
    t.call('write.saveData', n.story.id, { pinned: [n.hero.id] });
    t.call('write.saveData', n.story.id, { format: 'script' });
    const st = t.call('write.stats', n.w.id, { days: 30 });
    assert.equal(st.series.length, 30);
    const s = st.stories.find(x => x.id === n.story.id);
    assert.equal(s.target, 1000);
    assert.equal(s.scenes, 3);
    assert.equal(s.format, 'script');
    assert.equal(s.status.Final, 1);
    assert.ok(s.words >= 12);
    assert.equal(st.sessions.length, 1);
    assert.equal(st.sessions[0].words, 120);
    assert.deepEqual(t.call('entries.get', n.story.id).data.write.pinned, [n.hero.id]);
    const ments = t.call('write.mentions', [n.s1.id, n.s2.id]);
    assert.equal(ments[0].entry.id, n.hero.id);
    assert.equal(ments[0].mentions, 1);
  } finally { t.done(); }
});

test('write: the example world has a manuscript with beats and a writing streak', () => {
  const t = make();
  try {
    const w = t.call('worlds.sample');
    const tr = t.call('write.tree', w.id);
    const stories = tr.nodes.filter(x => x.kind === 'story');
    assert.ok(stories.length >= 1);
    assert.ok(tr.nodes.filter(x => x.kind === 'chapter').length >= 3);
    const scenes = tr.nodes.filter(x => x.kind === 'scene');
    assert.ok(scenes.length >= 6);
    assert.ok(scenes.some(x => x.fields.status && x.fields.goal));
    const st = t.call('write.stats', w.id, { days: 30 });
    assert.ok(st.streak >= 1);
    assert.ok(st.activeDays >= 10);
    assert.ok(st.sessions.length >= 1);
    const html = t.call('write.compile', stories[0].id, { format: 'html' });
    assert.match(html.text, /<section class="chapter"/);
    assert.doesNotMatch(html.text, /class="wb-s"/);
  } finally { t.done(); }
});

test('write: the story grid knows who is where', () => {
  const t = make();
  try {
    const n = novel(t);
    const place = t.call('entries.create', { worldId: n.w.id, typeKey: 'place', title: 'Quay' });
    t.call('entries.update', n.s2.id, { fields: { pov: n.hero.id, location: place.id, status: 'Draft' } });
    const g = t.call('write.grid', n.story.id);
    assert.equal(g.scenes.length, 3);
    assert.equal(g.cells[n.s1.id][n.hero.id].mention, true);
    assert.equal(g.cells[n.s2.id][n.hero.id].pov, true);
    assert.equal(g.cells[n.s2.id][place.id].location, true);
    assert.equal(g.entries.find(e => e.id === n.hero.id).scenes, 2);
  } finally { t.done(); }
});

test('screenplay elements are recognised from plain paragraphs', () => {
  assert.deepEqual(SP.classifyAll(['INT. HARBOUR – NIGHT', 'Rain on the water.', 'MIRA', '(quietly)', 'Do you hear it?', 'TAMSIN (V.O.)', 'No.', 'CUT TO:', '>THE END<']),
    ['heading', 'action', 'character', 'paren', 'dialogue', 'character', 'dialogue', 'transition', 'centered']);
  assert.equal(SP.convert('harbour, night', 'heading'), 'INT. HARBOUR, NIGHT');
  assert.equal(SP.convert('mira', 'character'), 'MIRA');
  assert.equal(SP.convert('dissolve', 'transition'), 'DISSOLVE TO:');
  const html = WC.scriptHtml('<p>EXT. FLATS – DAY</p><p>MIRA</p><p>Listen.</p>');
  assert.match(html, /sp-heading">EXT\. FLATS – DAY/);
  assert.match(html, /sp-character">MIRA/);
  assert.match(html, /sp-dialogue">Listen\./);
  assert.equal(WC.numberWords(42), 'Forty-Two');
});
