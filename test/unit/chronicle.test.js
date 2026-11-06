'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { make } = require('./helpers');
const Cal = require('../../src/shared/calendar');
const L = require('../../src/main/lib/chronicle-history');
const S = require('../../src/app/modules/chronicle/scale');

// a small world calendar of its own: 10 months of 36 days, 6-day weeks, two eras
const CAL = {
  months: ['Thaw', 'Brine', 'Gullsong', 'Highsun', 'Saltreap', 'Ember', 'Fogmoon', 'Gale', 'Frostmere', 'Deepwinter'].map(name => ({ name, days: 36 })),
  weekdays: ['Firstday', 'Netday', 'Tideday', 'Saltday', 'Gullday', 'Restday'], leap: null,
  eras: [{ name: 'Age of Tides', abbr: 'AT', start: 1000 }], before: { name: 'Before the Flood', abbr: 'BF' },
  moons: [{ name: 'Pale Mother', cycle: 30, offset: 0 }], seasons: [{ name: 'Spring', month: 0, day: 1 }, { name: 'Winter', month: 8, day: 1 }],
};
const at = (c, disp, m = 0, d = 1) => c.fromYmd(c.absYear(disp, 0), m, d);

function world(t) {
  const w = t.call('worlds.create', { name: 'Saltland', calendar: CAL });
  const c = Cal.create(w.calendar);
  t.call('worlds.update', w.id, { now: { day: at(c, 1203, 7, 14), prec: 'day' } });
  const rel = name => t.call('rels.list', w.id).find(r => r.name === name);
  const mk = (typeKey, title, o = {}) => t.call('entries.create', Object.assign({ worldId: w.id, typeKey, title }, o));
  const d = (disp, m, dd, prec) => ({ day: at(c, disp, m || 0, dd || 1), prec: prec || (dd ? 'day' : m != null ? 'month' : 'year') });
  return { w, c, rel, mk, d };
}

test('history maths: durations, precision of relation days, succession gaps and overlaps', () => {
  const c = Cal.create(CAL);
  assert.equal(L.durationText(c, at(c, 1200), at(c, 1203, 2, 1)), '3 years, 2 months');
  assert.equal(L.durationText(c, at(c, 1203, 7, 1), at(c, 1203, 7, 15)), '14 days');
  assert.equal(L.durationText(c, at(c, 1203, 7, 30), at(c, 1203, 8, 2)), '8 days');
  assert.equal(L.precOfDay(c, at(c, 1203)), 'year');
  assert.equal(L.precOfDay(c, at(c, 1203, 4)), 'month');
  assert.equal(L.precOfDay(c, at(c, 1203, 4, 9)), 'day');
  assert.equal(L.endDay(c, { day: at(c, 1203), prec: 'year' }), at(c, 1204));
  const s = L.buildSuccession(c, [
    { id: 'b', ruler: { title: 'B' }, start: at(c, 1180), end: at(c, 1190) },
    { id: 'a', ruler: { title: 'A' }, start: at(c, 1150), end: null },
    { id: 'c', ruler: { title: 'C' }, start: at(c, 1195), end: at(c, 1210) },
    { id: 'd', ruler: { title: 'D' }, start: at(c, 1205), end: null },
    { id: 'u', ruler: { title: 'U' }, start: null, end: null },
  ], at(c, 1220));
  assert.deepEqual(s.reigns.map(r => r.id), ['a', 'b', 'c', 'd']);
  assert.equal(s.reigns[0].inferredEnd, true);
  assert.equal(s.reigns[0].length, '30 years');
  assert.equal(s.gaps.length, 1);
  assert.equal(s.gaps[0].length, '5 years');
  assert.equal(s.overlaps.length, 1);
  assert.equal(s.overlaps[0].a, 'c');
  assert.equal(s.reigns[3].ongoing, true);
  assert.equal(s.undated.length, 1);
});

test('timeline scale: ticks follow the world calendar at every zoom', () => {
  const c = Cal.create(CAL);
  const t0 = at(c, 1200), yearPx = 120;
  // years: era-qualified majors, plain minors
  let k = S.ticks(c, t0, t0 + 360 * 8, yearPx / 360);
  assert.equal(k.unit, 'year');
  assert.ok(k.minor.find(x => x.label === '1203'));
  // months: the world's own month names
  k = S.ticks(c, t0, t0 + 360, 3);
  assert.equal(k.unit, 'month');
  assert.ok(k.minor.some(x => /^Gale|^Gal/.test(x.label)));
  assert.ok(k.major.some(x => x.label === '1200 AT'));
  // days and hours
  k = S.ticks(c, t0, t0 + 20, 60);
  assert.equal(k.unit, 'day');
  assert.ok(k.major.some(x => /Thaw 1200 AT/.test(x.label)));
  k = S.ticks(c, t0, t0 + 1, 2000);
  assert.equal(k.unit, 'hour');
  // millennia across the era boundary count back before it
  k = S.ticks(c, c.fromYmd(-2000), c.fromYmd(3000), 600 / (5000 * 360));
  assert.ok(k.minor.some(x => /BF/.test(x.label) || /BF/.test(x.title || '')));
  assert.ok(k.eras.length >= 2);
  // snapping by precision and the visual end of a date
  assert.equal(S.snap(c, at(c, 1203, 4, 10) + .4, 'year'), at(c, 1203));
  assert.equal(S.snap(c, at(c, 1203, 4, 10) + .4, 'month'), at(c, 1203, 4, 1));
  assert.equal(S.snap(c, at(c, 1203, 4, 30) + .4, 'month'), at(c, 1203, 5, 1));
  assert.equal(S.dateAt(c, at(c, 1203, 4, 30) + .4, 'month').day, at(c, 1203, 4, 1));
  assert.equal(S.durationText(c, at(c, 1200), at(c, 1203, 2, 1)), '3 years, 2 months');
  assert.equal(S.endOf(c, { day: at(c, 1203, 4, 1), prec: 'month' }), at(c, 1203, 5, 1));
  assert.equal(S.moveDate(c, { day: at(c, 1203, 4, 1), prec: 'month' }, 3, 'month').day, at(c, 1203, 7, 1));
});

test('annals merge an entry\'s own span, events, dated relations, children and family', async () => {
  const t = make();
  try {
    const { w, c, rel, mk, d } = world(t);
    const town = mk('place', 'Gullhaven', { start: d(1, 2, 9) });
    const quay = mk('place', 'The Quay', { parentId: town.id, start: d(400), end: d(1121, 9, 1) });
    const house = mk('faction', 'House Vey', { start: d(950) });
    const aldous = mk('character', 'Aldous Vey', { start: d(1150, 2, 3), end: d(1201, 8, 20) });
    const mira = mk('character', 'Mira Vey', { start: d(1185, 4, 4) });
    const war = mk('event', 'The Salt War', { start: d(1190), end: d(1194), fields: { location: town.id, participants: [house.id] } });
    mk('event', 'Fire on the Quay', { start: d(1100, 3, 3), fields: { location: quay.id } });
    mk('event', 'An undated rumour', { fields: { location: town.id } });
    t.call('links.relate', { src: house.id, dst: town.id, relId: rel('rules').id, start: { day: at(c, 1160) }, end: null });
    t.call('links.relate', { src: aldous.id, dst: house.id, relId: rel('leader of').id, start: { day: at(c, 1170, 3, 12) }, end: { day: at(c, 1201, 8, 20) } });
    t.call('links.relate', { src: aldous.id, dst: mira.id, relId: rel('parent of').id });
    t.call('links.relate', { src: mira.id, dst: town.id, relId: rel('lives in').id });

    const a = await t.call('chronicle.annals', town.id);
    const kinds = a.records.map(r => r.kind + ':' + r.edge + ':' + r.other.title);
    assert.equal(kinds[0], 'self:start:Gullhaven');
    assert.ok(kinds.includes('child:start:The Quay'));
    assert.ok(kinds.includes('child:end:The Quay'));
    assert.ok(kinds.includes('event:start:The Salt War'));
    assert.ok(kinds.includes('event:start:Fire on the Quay'));
    assert.ok(kinds.includes('relation:start:House Vey'));
    assert.ok(!kinds.some(k => /undated rumour/.test(k)));
    const fire = a.records.find(r => r.other.title === 'Fire on the Quay');
    assert.equal(fire.at.title, 'The Quay');
    assert.equal(a.records.find(r => r.other.id === war.id).roles[0], 'location');
    assert.equal(a.ties.length, 1);   // Mira lives here (undated)
    // chronological order
    for (let i = 1; i < a.records.length; i++) assert.ok(a.records[i].date.day >= a.records[i - 1].date.day);

    const ah = await t.call('chronicle.annals', aldous.id);
    assert.ok(ah.records.some(r => r.kind === 'family' && r.role === 'child' && r.other.id === mira.id));
    assert.ok(ah.records.some(r => r.kind === 'relation' && r.edge === 'end' && r.rel.label === 'leader of'));
    assert.equal(ah.records[ah.records.length - 1].kind, 'self');   // death closes the record
    assert.equal(w.id, ah.entry.worldId);

    // a city's "Ruled by" field is not a chapter of the ruler's life (the dated relation is); an item they made is
    t.call('entries.update', town.id, { fieldsPatch: { ruler: aldous.id } });
    mk('item', 'The Harbour Chain', { start: d(1152), fields: { maker: aldous.id } });
    const ah2 = await t.call('chronicle.annals', aldous.id);
    assert.ok(!ah2.records.some(r => r.other.id === town.id));
    assert.ok(ah2.records.some(r => r.other.title === 'The Harbour Chain' && r.roles.includes('maker')));
    // in a realm's own history a faction founded with its seat there counts, a passing mention does not
    mk('faction', 'Dock Guild', { start: d(1100), fields: { seat: quay.id } });
    mk('faction', 'Far Guild', { start: d(1101), body: `<p>Once traded with <a class="wb-m" data-id="${town.id}">Gullhaven</a>.</p>` });
    const a2 = await t.call('chronicle.annals', town.id);
    assert.ok(a2.records.some(r => r.other.title === 'Dock Guild' && r.at && r.at.id === quay.id));
    assert.ok(!a2.records.some(r => r.other.title === 'Far Guild'));
  } finally { t.done(); }
});

test('succession, who is alive, anniversaries and advancing time', () => {
  const t = make();
  try {
    const { w, c, rel, mk, d } = world(t);
    const town = mk('place', 'Gullhaven');
    const a = mk('character', 'Old Lord', { start: d(1120, 0, 5), end: d(1180, 7, 14) });
    const b = mk('character', 'Young Lord', { start: d(1160, 7, 14) });
    const k = mk('character', 'Unborn', { start: d(1250) });
    t.call('links.relate', { src: a.id, dst: town.id, relId: rel('rules').id, start: { day: at(c, 1150) }, end: { day: at(c, 1180, 7, 14) } });
    t.call('links.relate', { src: b.id, dst: town.id, relId: rel('rules').id, start: { day: at(c, 1183) } });
    const s = t.call('chronicle.succession', town.id);
    assert.deepEqual(s.reigns.map(r => r.ruler.title), ['Old Lord', 'Young Lord']);
    assert.equal(s.gaps.length, 1);
    assert.equal(s.reigns[1].ageAtStart, 22);
    assert.ok(s.reigns[1].ongoing);
    assert.equal(t.call('chronicle.realms', w.id)[0].id, town.id);

    const alive = t.call('chronicle.alive', w.id, at(c, 1170));
    assert.deepEqual(alive.alive.map(e => [e.title, e.age]), [['Old Lord', 49], ['Young Lord', 9]]);
    assert.equal(alive.unborn, 1);
    assert.equal(t.call('chronicle.alive', w.id).alive.length, 1);

    // 14 Gale: Old Lord died on it, Young Lord was born on it
    const otd = t.call('chronicle.onThisDay', w.id, at(c, 1203, 7, 14));
    assert.deepEqual(otd.map(x => x.entry.title + ':' + x.which + ':' + x.years).sort(), ['Old Lord:end:23', 'Young Lord:start:43']);
    assert.equal(k.title, 'Unborn');

    const r = t.call('chronicle.advance', w.id, { months: 1, days: 3 }, { log: 'note', text: 'The fleet sails.' });
    assert.equal(r.to.day, at(c, 1203, 8, 17));
    assert.equal(t.call('worlds.get', w.id).now.day, at(c, 1203, 8, 17));
    assert.ok(r.log && /Time passes/.test(r.log.title));
    const log = t.call('entries.get', r.log.id);
    assert.equal(log.start.day, at(c, 1203, 7, 14));
    assert.match(log.body, /fleet sails/);
    const back = t.call('chronicle.advance', w.id, { to: r.from });
    assert.equal(back.to.day, at(c, 1203, 7, 14));
    assert.equal(t.call('chronicle.dated', w.id).length, 4);
  } finally { t.done(); }
});
