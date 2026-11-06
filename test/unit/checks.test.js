'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
const { make } = require('./helpers');
const R = require('../../src/main/lib/checks-rules');
const Cal = require('../../src/shared/calendar');

/** a world with helpers for dated entries and relations */
function setup(t) {
  const w = t.call('worlds.create', { name: 'Continuity', starter: 'fantasy' });
  const cal = t.ctx.core.calendarFor(w.id);
  const d = (y, m = 0, dd = 1, prec = 'day', min = null) => ({ day: cal.fromYmd(y, m, dd), min, prec });
  t.call('worlds.update', w.id, { now: d(1203, 8, 14) });
  const add = (type, title, o = {}) => t.call('entries.create', Object.assign({ worldId: w.id, typeKey: type, title }, o));
  const rel = name => t.call('rels.list', w.id).find(r => r.name === name);
  const relate = (a, name, b, o = {}) => t.call('links.relate', Object.assign({ src: a.id, dst: b.id, relId: rel(name).id }, o));
  const issues = o => t.call('checks.run', w.id, o || {});
  const of = check => issues().filter(i => i.check === check);
  const mention = e => `<a class="wb-m" data-id="${e.id}">${e.title}</a>`;
  return { w, cal, d, add, relate, issues, of, mention };
}

test('lifespans: a character in a scene after their death, by cast (error) and by mention (note); a date fix clears it', () => {
  const t = make();
  try {
    const { add, d, of, mention, w } = setup(t);
    const oskar = add('character', 'Brother Oskar', { start: d(1150), end: d(1201, 1, 20) });
    const place = add('place', 'Lantern Rock');
    const scene = add('scene', 'Prayers at Lantern Rock', { start: d(1203, 7, 10), fields: { cast: [oskar.id], location: place.id } });
    add('scene', 'A Memory', { start: d(1203, 8, 1), body: `<p>She remembered ${mention(oskar)} singing.</p>` });
    add('event', 'His Birth Feast', { start: d(1140), fields: { participants: [oskar.id] } });
    const ls = of('lifespan');
    const after = ls.find(i => i.key === 'lifespan:' + oskar.id + ':' + scene.id + ':after');
    assert.ok(after, 'cast after death is found');
    assert.equal(after.severity, 'error');
    assert.match(after.detail, /died 20 Brine 1201|died/);
    assert.deepEqual(after.entryIds, [oskar.id, scene.id]);
    assert.equal(after.fix.kind, 'removeRef');
    assert.equal(ls.find(i => /A Memory/.test(i.title)).severity, 'info', 'a mention is only a note');
    assert.ok(ls.find(i => i.key.endsWith(':before')), 'taking part before birth is found too');
    // year-precision dates only clash when the whole year is outside the life
    add('scene', 'Same Year', { start: d(1201, 0, 1, 'year'), fields: { cast: [oskar.id] } });
    assert.ok(!of('lifespan').some(i => /Same Year/.test(i.title)));
    // the fix: move the scene before his death
    t.call('checks.fix', w.id, { kind: 'setDate', entryId: scene.id, which: 'start', value: d(1200, 3, 3) });
    assert.ok(!of('lifespan').some(i => i.key === after.key));
  } finally { t.done(); }
});

test('duplicates: near-identical names of one type get a Merge fix; families and numbered series do not', () => {
  const t = make();
  try {
    const { add, of, w } = setup(t);
    const a = add('character', 'Tamsin Reede', { body: '<p>A smuggler with a long memory and a short temper.</p>' });
    const b = add('character', 'Tamsin Reed');
    add('character', 'Corwin Vey'); add('character', 'Morwen Vey');
    add('session', 'Session 1'); add('session', 'Session 2');
    add('place', 'The Salt Road'); add('place', 'Salt Road');
    add('faction', 'Tamsin Reed');   // another type: not a duplicate
    const dup = of('duplicate');
    const near = dup.find(i => i.entryIds.includes(a.id) && i.entryIds.includes(b.id));
    assert.ok(near);
    assert.equal(near.severity, 'warn');
    assert.deepEqual(near.fix, { kind: 'merge', into: a.id, from: b.id, label: 'Merge “Tamsin Reed” into “Tamsin Reede”' }, 'the fuller entry survives');
    assert.ok(!dup.some(i => /Corwin|Morwen|Session/.test(i.title)));
    assert.ok(dup.some(i => /Salt Road/.test(i.title) && i.severity === 'warn'), 'a leading “The” makes no difference');
    assert.equal(dup.length, 2);
    t.call('checks.fix', w.id, near.fix);
    assert.ok(!of('duplicate').some(i => i.key === near.key));
    assert.ok(t.call('entries.get', a.id).aliases.includes('Tamsin Reed'));
  } finally { t.done(); }
});

test('broken mentions: trashed (restore) and deleted (unlink keeps the words)', () => {
  const t = make();
  try {
    const { add, of, mention, w } = setup(t);
    const ghost = add('character', 'Ghost');
    const gone = add('character', 'Gone');
    const text = add('lore', 'Ballad', { body: `<p>Of ${mention(ghost)} and ${mention(gone)}.</p>` });
    t.call('entries.trash', ghost.id);
    t.call('entries.trash', gone.id); t.call('entries.purge', gone.id);
    const m = of('mention');
    assert.equal(m.length, 2);
    const trashed = m.find(i => i.severity === 'warn'), missing = m.find(i => i.severity === 'error');
    assert.equal(trashed.fix.kind, 'restore');
    assert.match(missing.title, /“Gone”/, 'the old label is shown');
    t.call('checks.fix', w.id, missing.fix);
    const body = t.call('entries.get', text.id).body;
    assert.ok(body.includes('Gone') && !body.includes(gone.id));
    t.call('checks.fix', w.id, trashed.fix);
    assert.equal(of('mention').length, 0);
  } finally { t.done(); }
});

test('family: child older than parent, a very young parent, birth long after death, ancestry loops', () => {
  const t = make();
  try {
    const { add, d, of, relate, w } = setup(t);
    const elder = add('character', 'Elder', { start: d(1150), end: d(1170) });
    const kid = add('character', 'Kid', { start: d(1140) });
    relate(elder, 'parent of', kid);
    const young = add('character', 'Young', { start: d(1190) });
    const baby = add('character', 'Baby', { start: d(1199) });
    relate(young, 'parent of', baby);
    const late = add('character', 'Late', { start: d(1185) });
    relate(elder, 'parent of', late);
    const f = of('family');
    assert.ok(f.find(i => i.key.endsWith(':older') && i.severity === 'error'));
    assert.ok(f.find(i => i.key.endsWith(':young') && /only 9/.test(i.title)));
    assert.ok(f.find(i => i.key.endsWith(':posthumous') && /15 years/.test(i.title)));
    t.call('checks.settings', w.id, { minParentAge: 8 });
    assert.ok(!of('family').some(i => i.key.endsWith(':young')), 'the youngest parent age is a setting');
    const x = add('character', 'X'), y = add('character', 'Y'), z = add('character', 'Z');
    relate(x, 'parent of', y); relate(y, 'parent of', z); relate(z, 'parent of', x);
    const loop = of('ancestry');
    assert.equal(loop.length, 1);
    assert.equal(loop[0].entryIds.length, 3);
    assert.equal(loop[0].severity, 'error');
  } finally { t.done(); }
});

test('dates, places in time, two places at once and status', () => {
  const t = make();
  try {
    const { add, d, of, w, relate } = setup(t);
    const odd = add('event', 'Backwards', { start: d(1200), end: d(1190) });
    const inv = of('dates');
    assert.equal(inv.length, 1); assert.equal(inv[0].fix.kind, 'swapDates');
    t.call('checks.fix', w.id, inv[0].fix);
    assert.equal(t.call('entries.get', odd.id).start.day < t.call('entries.get', odd.id).end.day, true);
    assert.equal(of('dates').length, 0);
    // relations with dates the wrong way round
    const a = add('character', 'A', { start: d(1150) }), b = add('character', 'B', { start: d(1150) });
    relate(a, 'spouse of', b, { start: d(1180), end: d(1175) });
    assert.equal(of('dates')[0].fix.kind, 'swapLinkDates');
    // places
    const tower = add('place', 'Storm Spire', { start: d(900), end: d(1100) });
    const later = add('event', 'Siege', { start: d(1150), fields: { location: tower.id } });
    const early = add('event', 'Omen', { start: d(800), fields: { location: tower.id } });
    const guild = add('faction', 'Gulls', { start: d(1000), end: d(1050) });
    add('event', 'Raid', { start: d(1060), fields: { participants: [guild.id] } });
    const pl = of('place');
    assert.equal(pl.find(i => i.key === 'place:' + later.id + ':' + tower.id + ':after').severity, 'info', 'ruins are allowed');
    assert.equal(pl.find(i => i.key === 'place:' + early.id + ':' + tower.id + ':before').severity, 'warn');
    assert.ok(pl.find(i => /Gulls/.test(i.title) && i.severity === 'warn'));
    // two places at once (timed scenes overlap); a place inside another doesn't count
    const mira = add('character', 'Mira', { start: d(1180) });
    const town = add('place', 'Gullhaven'), harbour = add('place', 'Harbour', { parentId: town.id }), keep = add('place', 'Veykeep');
    add('scene', 'Docks', { start: d(1203, 7, 14, 'time', 600), end: d(1203, 7, 14, 'time', 720), fields: { cast: [mira.id], location: harbour.id } });
    add('scene', 'Market', { start: d(1203, 7, 14, 'time', 660), fields: { cast: [mira.id], location: town.id } });
    assert.equal(of('twoplaces').length, 0);
    add('scene', 'Keep', { start: d(1203, 7, 14, 'time', 700), fields: { cast: [mira.id], location: keep.id } });
    const two = of('twoplaces');
    assert.equal(two.length, 1, 'the keep overlaps the docks; the market moment does not overlap the keep moment');
    assert.ok(/Harbour/.test(two[0].title) && /Veykeep/.test(two[0].title));
    assert.equal(two[0].entryIds[0], mira.id);
    // two whole-day scenes on one day may just be travel
    add('scene', 'Morning', { start: d(1203, 8, 2), fields: { cast: [mira.id], location: town.id } });
    add('scene', 'Evening', { start: d(1203, 8, 2), fields: { cast: [mira.id], location: keep.id } });
    assert.equal(of('twoplaces').length, 1);
    // a three-day siege elsewhere overlapping a two-day council does clash
    add('event', 'Council', { start: d(1203, 9, 1), end: d(1203, 9, 2), fields: { participants: [mira.id], location: town.id } });
    add('event', 'Siege of the Keep', { start: d(1203, 9, 1), end: d(1203, 9, 3), fields: { participants: [mira.id], location: keep.id } });
    assert.equal(of('twoplaces').length, 2);
    // status vs dates
    add('character', 'Old Merrow', { start: d(1100), end: d(1180), fields: { status: 'Alive' } });
    add('character', 'Wren', { fields: { status: 'Dead' } });
    const st = of('status');
    assert.ok(st.find(i => /Old Merrow/.test(i.title) && i.fix.kind === 'setField'));
    assert.ok(st.find(i => /Wren/.test(i.title) && i.severity === 'info'));
  } finally { t.done(); }
});

test('audience and reveal: public text naming private or unrevealed entries; secrets are fine', () => {
  const t = make();
  try {
    const { add, of, mention, w, d } = setup(t);
    const heir = add('character', 'The Hidden Heir', { audience: 'private' });
    const twist = add('lore', 'The Drowned King', { audience: 'public', revealDay: d(1300).day });
    const page = add('lore', 'Saltmarch Guide', { audience: 'public', body: `<p>Ask about ${mention(heir)} and ${mention(twist)}.</p>` });
    add('lore', 'Careful Guide', { audience: 'public', body: `<p>Nothing here.</p><p class="wb-s">${mention(heir)}</p>` });
    const au = of('audience');
    assert.equal(au.length, 1);
    assert.deepEqual(au[0].entryIds, [page.id, heir.id]);
    assert.equal(au[0].fix.kind, 'audience');
    const rv = of('reveal');
    assert.equal(rv.length, 1);
    assert.equal(rv[0].entryIds[0], twist.id);
    t.call('checks.fix', w.id, au[0].fix);
    t.call('checks.fix', w.id, rv[0].fix);
    assert.equal(of('audience').length + of('reveal').length, 0);
  } finally { t.done(); }
});

test('media: missing files, unused files and pictures that were deleted', () => {
  const t = make();
  try {
    const { add, of, w } = setup(t);
    const png = Buffer.from('89504e470d0a1a0a0000000d4948445200000001000000010806000000', 'hex');
    const used = t.call('media.save', w.id, { name: 'cover.png', bytes: png });
    const spare = t.call('media.save', w.id, { name: 'spare.png', bytes: png });
    const lost = t.call('media.save', w.id, { name: 'lost.png', bytes: png });
    const binned = t.call('media.save', w.id, { name: 'binned.png', bytes: png });
    add('place', 'Gullhaven', { coverId: used.id, body: `<p><img data-media="${lost.id}" alt=""></p><p><img data-media="${binned.id}" alt=""></p>` });
    fs.rmSync(path.join(t.ctx.paths.media(w.id), lost.file));
    t.call('media.remove', binned.id);
    const m = of('media');
    assert.ok(m.find(i => i.key === 'media-missing:' + lost.id && i.severity === 'error'));
    assert.ok(m.find(i => i.key === 'media-unused:' + spare.id && i.severity === 'info'));
    assert.ok(!m.some(i => i.key === 'media-unused:' + used.id));
    const ref = m.find(i => i.key.startsWith('media-ref:') && i.key.endsWith(binned.id));
    assert.ok(ref); assert.equal(ref.fix.kind, 'restoreMedia');
    t.call('checks.fix', w.id, m.find(i => i.key === 'media-unused:' + spare.id).fix);
    assert.ok(!of('media').some(i => i.key === 'media-unused:' + spare.id));
  } finally { t.done(); }
});

test('stubs, required fields, orphans; switching a check off', () => {
  const t = make();
  try {
    const { add, of, w } = setup(t);
    const empty = add('character', 'Nobody');
    const half = add('character', 'Somebody', { summary: 'Has a summary but no wants.' });
    const linked = add('character', 'Linked', { summary: 'x', fields: { goals: 'To be linked', home: half.id } });
    assert.ok(of('stub').find(i => i.entryIds[0] === empty.id));
    assert.ok(!of('stub').some(i => i.entryIds[0] === half.id));
    const req = of('required').find(i => i.entryIds[0] === half.id);
    assert.ok(req); assert.equal(req.fix.kind, 'openField'); assert.equal(req.fix.field, 'goals');
    assert.ok(!of('required').some(i => i.entryIds[0] === empty.id), 'stubs are not also nagged about fields');
    assert.ok(!of('orphan').some(i => i.entryIds[0] === linked.id || i.entryIds[0] === half.id));
    t.call('checks.settings', w.id, { off: ['stub'] });
    assert.equal(of('stub').length, 0);
    assert.deepEqual(t.call('checks.settings', w.id).off, ['stub']);
  } finally { t.done(); }
});

test('marking as intended, the score and the summary', () => {
  const t = make();
  try {
    const { add, d, w } = setup(t);
    const s0 = t.call('checks.summary', w.id);
    assert.equal(s0.score, 100);
    assert.equal(s0.total, 0);
    const e = add('event', 'Backwards', { start: d(1200), end: d(1190), summary: 'x' });
    const s1 = t.call('checks.summary', w.id);
    assert.equal(s1.counts.error, 1);
    assert.ok(s1.score < 100);
    assert.equal(s1.top[0].check, 'dates');
    const key = s1.top[0].key;
    t.call('checks.ignore', w.id, key, 'The chronicle is written backwards on purpose.');
    const s2 = t.call('checks.summary', w.id);
    assert.equal(s2.counts.error, 0); assert.equal(s2.counts.ignored, 1);
    assert.equal(t.call('checks.run', w.id).length, s2.total);
    const all = t.call('checks.run', w.id, { all: true }).find(i => i.key === key);
    assert.equal(all.ignored, true); assert.match(all.note, /backwards/);
    const ig = t.call('checks.ignored', w.id);
    assert.equal(ig.length, 1); assert.equal(ig[0].issue.key, key);
    assert.equal(t.call('checks.entry', w.id, e.id).filter(i => i.check === 'dates').length, 0);
    t.call('checks.unignore', w.id, key);
    assert.equal(t.call('checks.summary', w.id).counts.error, 1);
    t.call('checks.ignore', w.id, key, '');
    t.call('entries.update', e.id, { end: d(1210) });
    assert.equal(t.call('checks.ignored', w.id)[0].issue, null, 'a fixed issue leaves its mark resolved');
    assert.equal(t.call('checks.forgetResolved', w.id).n, 1);
    // the score weighs errors more than notes, and big worlds more lightly
    const err = [{ severity: 'error' }], notes = Array(5).fill({ severity: 'info' });
    assert.ok(R.score(err, 20) < R.score(notes, 20));
    assert.ok(R.score(err, 20) < R.score(err, 400));
  } finally { t.done(); }
});

test('rules on their own: pins and cards pointing at deleted entries, precision spans', () => {
  const cal = Cal.create(null);
  const types = new Map([['tc', { id: 'tc', key: 'character', name: 'Character', lifespan: true, fields: [] }], ['tm', { id: 'tm', key: 'map', name: 'Map', lens: 'map', fields: [] }]]);
  const e = (id, title, typeId, extra) => Object.assign({ id, title, typeId, aliases: [], fields: {}, body: '', start: null, end: null, deleted: false }, extra);
  const snap = {
    cal, now: { day: cal.fromYmd(2000, 0, 1) }, settings: {}, types, links: [], rels: new Map(), media: null,
    entries: [e('mapaaaaaaa', 'Region', 'tm'), e('chraaaaaaa', 'Trashed One', 'tc', { deleted: true })],
    mapItems: [{ id: 'pin1', entryId: 'chraaaaaaa', mapId: 'mapaaaaaaa', label: 'Old pin' }, { id: 'pin2', entryId: 'nosuchidxx', mapId: 'mapaaaaaaa' }, { id: 'pin3', entryId: null, mapId: 'mapaaaaaaa' }],
    boardItems: [{ id: 'card1', entryId: 'nosuchidxx', boardId: null }],
  };
  const pins = R.run(snap).filter(i => i.check === 'pin');
  assert.equal(pins.length, 3);
  assert.equal(pins.find(i => i.key === 'pin:pin1').fix.kind, 'restore');
  assert.equal(pins.find(i => i.key === 'pin:pin2').fix.kind, 'openMap');
  assert.ok(pins.find(i => i.key === 'card:card1'));
  const y = R.span(cal, { day: cal.fromYmd(1203, 4, 9), prec: 'year' });
  assert.deepEqual(y, [cal.startOfYear(1203), cal.startOfYear(1204) - 1]);
  const m = R.span(cal, { day: cal.fromYmd(1203, 1, 9), prec: 'month' });
  assert.deepEqual(m, [cal.fromYmd(1203, 1, 1), cal.fromYmd(1203, 1, 28)]);
  assert.equal(R.normTitle('The Salt-Road!'), 'salt road');
  assert.equal(R.numbered('session 1', 'session 2'), true);
  assert.equal(R.numbered('book ii', 'book iii'), true);
});

test('pins on real maps: a trashed target is reported, a trashed map is not', () => {
  const t = make();
  try {
    const { add, of, w } = setup(t);
    const db = t.ctx.db;
    const cols = db.hasTable('map_items') ? db.columns('map_items') : [];
    if (!['id', 'world_id', 'map_id', 'entry_id'].every(c => cols.includes(c))) return;   // the Atlas area is not there
    const map = add('map', 'Region'), oldMap = add('map', 'Old region'), town = add('place', 'Gullhaven', { summary: 'x' });
    const pin = (id, mapId) => db.run('INSERT INTO map_items (id, world_id, map_id, entry_id' + (cols.includes('kind') ? ", kind" : '') + ') VALUES (?,?,?,?' + (cols.includes('kind') ? ",'pin'" : '') + ')', id, w.id, mapId, town.id);
    pin('pinaaaaaa1', map.id); pin('pinaaaaaa2', oldMap.id);
    assert.equal(of('pin').length, 0);
    t.call('entries.trash', town.id);
    t.call('entries.trash', oldMap.id);
    const p = of('pin');
    assert.equal(p.length, 1);
    assert.equal(p[0].key, 'pin:pinaaaaaa1');
    assert.equal(p[0].fix.kind, 'restore');
  } finally { t.done(); }
});

test('the example world shows its deliberate continuity mistakes', () => {
  const t = make();
  try {
    let w;
    try { w = t.call('worlds.sample'); } catch { return; }
    const list = t.call('checks.run', w.id);
    const find = title => t.call('entries.find', w.id, title);
    // the example world is built by several areas; when its story parts exist, Checks finds the planted mistakes
    const oskar = find('Brother Oskar'), prayers = find('Prayers at Lantern Rock');
    if (oskar && prayers) assert.ok(list.some(i => i.key === 'lifespan:' + oskar.id + ':' + prayers.id + ':after' && i.severity === 'error'), 'Brother Oskar in a scene after his death');
    const a = find('Tamsin Reede'), b = find('Tamsin Reed');
    if (a && b && a.id !== b.id) assert.ok(list.some(i => i.check === 'duplicate' && i.entryIds.includes(a.id) && i.entryIds.includes(b.id) && i.fix.kind === 'merge'), 'Tamsin Reede / Tamsin Reed');
    const s = t.call('checks.summary', w.id);
    assert.ok(s.score > 0 && s.score <= 100);
    assert.equal(s.total, list.length);
  } finally { t.done(); }
});
