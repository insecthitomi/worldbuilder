'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { make } = require('./helpers');
const G = require('../../src/shared/gen-core');
require('../../src/shared/gen-words');
require('../../src/shared/gen-town');
require('../../src/shared/gen-townmap');
require('../../src/shared/gen-more');
const Cal = require('../../src/shared/calendar');

const BAD = /\{[^}]*\}|undefined|NaN|\[object|null\b/;

test('generators: every one is deterministic from its seed and fills every template', () => {
  const ids = G.list().map(d => d.id);
  for (const id of ['town', 'npc', 'names', 'tavern', 'shop', 'landmark', 'room', 'quest', 'rumour', 'twist', 'weather', 'treasure', 'artifact', 'ship', 'deity', 'religion', 'faction']) assert.ok(ids.includes(id), id + ' is registered');
  for (const id of ids) {
    for (let i = 0; i < 12; i++) {
      const opts = { cast: ['Mira Saltborn'], places: ['Gullhaven'], months: ['Thaw', 'Brine'], magic: i % 2 ? 'common' : 'rare', size: id === 'town' ? ['thorp', 'hamlet', 'village', 'town', 'city', 'metropolis'][i % 6] : undefined };
      const a = G.run(id, opts, { seed: 'U' + i }), b = G.run(id, opts, { seed: 'U' + i });
      assert.equal(JSON.stringify(a.sections), JSON.stringify(b.sections), id + ' repeats from its seed');
      const txt = G.text(a);
      assert.ok(!BAD.test(txt), id + ' left a gap: ' + (txt.match(/.{0,30}(\{[^}]*\}|undefined|NaN|\[object|null\b).{0,30}/) || [''])[0]);
      const p = G.plan(a, {});
      assert.ok(p.entries.length >= 1 && p.entries.every(e => e.ref && e.type && e.title), id + ' plans entries');
    }
  }
});

test('town: sections re-roll alone, pinned sections survive a full re-roll, and the plan is complete', () => {
  const cal = Cal.create(null), nowDay = cal.fromYmd(1203, 5, 1);
  const a = G.run('town', { size: 'city', terrain: 'coast', cal, nowDay }, { seed: 'AAA' });
  // re-roll only the residents
  const b = G.run('town', { size: 'city', terrain: 'coast', cal, nowDay }, { seed: 'AAA', seeds: { residents: G.rerollSeed(a, 'residents') } });
  assert.equal(a.data.name, b.data.name);
  assert.deepEqual(a.data.districts, b.data.districts);
  assert.notDeepEqual(a.data.residents.map(r => r.want), b.data.residents.map(r => r.want));
  // a new base seed with the name pinned keeps the name
  const c = G.run('town', { size: 'city', terrain: 'coast', cal, nowDay }, { seed: 'BBB', seeds: { name: a.seeds.name } });
  assert.equal(c.data.name, a.data.name);
  assert.ok(a.data.population >= 8001 && a.data.population <= 60000);
  assert.ok(a.data.founded && a.data.founded.prec === 'year' && a.data.foundedYears > 0);
  assert.ok(a.data.map && /^<svg[^>]+viewBox="0 0 1600 1200"/.test(a.data.map.svg) && a.data.map.pins.length > 0);
  const plan = G.plan(a, { include: { owners: true }, cultureId: 'culture0001' });
  const town = plan.entries.find(e => e.ref === 'town');
  assert.equal(town.fields.kind, 'City');
  assert.equal(town.fields.ruler, '@ref:leader');
  assert.ok(plan.entries.filter(e => e.type === 'character').length >= a.data.residents.length + 1);
  assert.ok(plan.relations.some(r => r.rel === 'lives in') && plan.relations.some(r => r.rel === 'owns') && plan.relations.some(r => r.rel === 'rules'));
  assert.ok(plan.entries.find(e => e.ref === 'map').data.image === '@media:mapimg');
  assert.ok(/class="wb-s"/.test(town.body), 'secrets are marked secret');
});

test('random tables: weights, dice ranges, nesting, inline rolls, pasted lists and odds', () => {
  const R = () => { let s = 7; return () => ((s = (s * 16807) % 2147483647) / 2147483647); };
  const names = { title: 'Names', rows: [{ text: 'Ann', weight: 1 }, { text: 'Bo', weight: 0 }] };
  for (let i = 0; i < 20; i++) assert.equal(G.rollTable(names, { rng: R() }).text, 'Ann');
  const t = { title: 'Fights', dice: '1d6', rows: [{ text: '{2d4} rats', range: [1, 3] }, { text: 'a [[Names]] with {red|red} hair', range: [4, 6] }] };
  const lookup = n => (n.toLowerCase() === 'names' ? names : null);
  const rng = R();
  for (let i = 0; i < 30; i++) {
    const r = G.rollTable(t, { rng, lookup });
    assert.ok(r.total >= 1 && r.total <= 6);
    if (r.index === 0) assert.match(r.text, /^[2-8] rats$/);
    else { assert.equal(r.text, 'a Ann with red hair'); assert.equal(r.nested[0].title, 'Names'); }
  }
  // a table that names itself does not loop forever
  const loop = { title: 'Loop', rows: [{ text: 'again [[Loop]]' }] };
  assert.equal(G.rollTable(loop, { lookup: () => loop }).text, 'again Loop');
  // pasted lists
  assert.deepEqual(G.parseRows('1-2 Rain\n3-5 Fog\n6 Sun').map(r => r.range), [[1, 2], [3, 5], [6, 6]]);
  assert.deepEqual(G.parseRows('Gull x3\nCrab (2)\nEel').map(r => [r.text, r.weight]), [['Gull', 3], ['Crab', 2], ['Eel', 1]]);
  // odds of a 2d6 table add up and follow the bell curve
  const o = G.odds({ dice: '2d6', rows: [{ text: 'a', range: [2, 6] }, { text: 'b', range: [7, 7] }, { text: 'c', range: [8, 12] }] });
  assert.ok(Math.abs(o.reduce((s, x) => s + x, 0) - 1) < 1e-9);
  assert.ok(Math.abs(o[1] - 6 / 36) < 1e-9);
  // ranges spread over the dice when rows have none
  const auto = G.autoRanges([{ weight: 1 }, { weight: 2 }, { weight: 1 }], '1d20');
  assert.deepEqual([auto[0][0], auto[2][1]], [1, 20]);
  assert.ok(auto.every((r, i) => !i || r[0] === auto[i - 1][1] + 1));
});

test('toolkit.build creates a generated town atomically (children, residents, relations, map image, pins) and undo removes it', () => {
  const t = make();
  try {
    const w = t.call('worlds.create', { name: 'Gentest', starter: 'fantasy' });
    const region = t.call('entries.create', { worldId: w.id, typeKey: 'map', title: 'Region', data: { width: 2000, height: 1500 } });
    const res = G.run('town', { size: 'town', terrain: 'river' }, { seed: 'BUILD' });
    const plan = G.plan(res, { mapId: region.id, x: 500, y: 400, include: { owners: true } });
    const r = t.call('toolkit.build', w.id, plan);
    assert.equal(r.created.length, plan.entries.length);
    const town = t.call('entries.get', r.rootId);
    assert.equal(town.title, res.data.name);
    assert.equal(town.fields.population, res.data.population);
    assert.ok(t.call('entries.list', w.id, { parentId: town.id }).length >= 2, 'districts or locations sit inside the town');
    const ctxTown = t.call('entries.context', town.id);
    assert.ok(ctxTown.relations.filter(x => x.label === 'home of').length >= res.data.residents.length, 'residents live in the town');
    assert.ok(ctxTown.mentions.length > 5, 'the body links its people and places');
    const map = t.call('entries.get', r.ids.map);
    assert.ok(map.data.image && t.call('media.get', map.data.image).mime === 'image/svg+xml');
    assert.equal(map.parentId, region.id, 'the town map is a sub-map of the map it was founded on');
    if (t.ctx.has('atlas.items')) {
      const pins = t.call('atlas.items', region.id);
      assert.equal(pins.length, 1);
      assert.equal(pins[0].entryId, town.id);
      assert.equal(pins[0].subMapId, map.id);
      assert.ok(t.call('atlas.items', map.id).length >= 3, 'locations are pinned on the town map');
    }
    t.call('toolkit.undo', r);
    assert.equal(t.call('entries.list', w.id, { typeKeys: ['character'] }).length, 0);
    assert.equal(t.call('entries.list', w.id, { typeKeys: ['place'] }).length, 0);
    assert.equal(t.call('media.list', w.id).length, 0);
    if (t.ctx.has('atlas.items')) assert.equal(t.call('atlas.items', region.id).length, 0);
  } finally { t.done(); }
});

test('example world: Saltmarch tables roll with nesting, the wyrm encounter has combatants, the world has coins', () => {
  const t = make();
  try {
    const w = t.call('worlds.sample');
    const tables = t.call('toolkit.tables', w.id);
    const by = n => tables.find(x => x.title === n);
    for (const n of ['Saltmarch tavern names', 'Rumours on the docks', 'Weather on the flats', 'Salt-flat encounters']) assert.ok(by(n) && by(n).rows.length >= 7, n);
    const lookup = n => tables.find(x => x.title.toLowerCase() === n.toLowerCase()) || null;
    let nested = 0;
    for (let i = 0; i < 60; i++) { const r = G.rollTable(by('Salt-flat encounters'), { lookup }); assert.ok(!/\[\[|\{/.test(r.text), r.text); nested += r.nested.length; }
    assert.ok(nested > 0, 'nested tables were rolled');
    const enc = t.call('entries.find', w.id, 'Salt Wyrm on the Flats');
    if (enc) {
      const e = t.call('entries.get', enc.id);
      assert.ok(e.data.combatants.length >= 2);
      assert.ok(e.data.combatants.some(c => c.side === 'foe' && c.hp === 84 && c.attacks.length));
    }
    const world = t.call('worlds.get', w.id);
    assert.ok(world.settings.currencies.length === 3 && world.settings.units.length >= 4);
  } finally { t.done(); }
});
