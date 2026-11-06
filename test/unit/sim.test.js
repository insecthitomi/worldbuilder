'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const S = require('../../src/shared/sim');

/* A tiny world: Farm (makes grain, nobody to feed) --route--> Town (eats grain, makes nothing). One resource, daily ticks. */
function tiny(over = {}) {
  const cfg = {
    name: 't', step: 'day', calendar: { yearDays: 360, seasons: [{ name: 'Spring', from: 0 }, { name: 'Summer', from: 90 }, { name: 'Autumn', from: 180 }, { name: 'Winter', from: 270 }] },
    resources: [{ name: 'Grain', category: 'food', value: 2, bulk: 1, decay: 0 }],
    nodes: [
      { id: 'farm', name: 'Farm', pop: 300, terrain: ['plains'], producers: [{ res: 'grain', perWorker: 0.5, share: 0.8 }], consumers: [{ res: 'grain', per100: 1 }] },
      { id: 'town', name: 'Town', pop: 1000, terrain: ['plains'], producers: [], consumers: [{ res: 'grain', per100: 2 }] },
    ],
    routes: [{ id: 'road', a: 'farm', b: 'town', distance: 36, mode: 'cart', risk: 0 }],
    rules: [],
  };
  return Object.assign(cfg, over);
}
const run = (cfg, n, seed = 's') => S.step(S.createState(cfg, seed), n);
const total = (st, ids) => S.flowsBetween(st, 0, st.hist.flows.length).filter(f => !ids || ids.includes(f.res)).reduce((t, f) => t + f.amount, 0);
const rule = (over) => Object.assign({ id: 'r', name: 'r', on: true, scope: { kind: 'global', target: '' }, res: '*', effect: { type: 'embargo', pct: 0, dir: 'both' }, when: {} }, over);

test('the same seed gives the same world, another seed a different one', () => {
  const cfg = S.presetConfig('silkroad');
  const a = JSON.stringify(S.summarize(run(cfg, 40, 'alpha'))), b = JSON.stringify(S.summarize(run(cfg, 40, 'alpha'))), c = JSON.stringify(S.summarize(run(cfg, 40, 'beta')));
  assert.equal(a, b);
  assert.notEqual(a, c);
});

test('goods are conserved on every preset (stock + in transit = start + made - used - lost)', () => {
  for (const p of S.PRESETS) {
    const st = run(p.make(), 80, 'c');
    for (const [id, diff] of Object.entries(S.balance(st))) assert.ok(Math.abs(diff) < 1e-6, p.id + ' ' + id + ' off by ' + diff);
    assert.ok(st.transit.length >= 0 && total(st) > 0, p.id + ' moved nothing');
  }
});

test('goods are conserved with raids, decay, tithes and workshops all switched on', () => {
  const cfg = S.presetConfig('kingdom');
  cfg.routes.forEach(r => { r.risk = 0.4; });
  cfg.resources.find(r => r.id === 'fish').decay = 0.1;
  const st = run(cfg, 60, 'x');
  assert.ok(st.ledger.fish.decayed > 0 && Object.values(st.ledger).some(l => l.lost > 0) && st.ledger.grain.taxed + st.ledger.grain.consumed > 0);
  for (const diff of Object.values(S.balance(st))) assert.ok(Math.abs(diff) < 1e-6);
});

test('a short good costs more than a plentiful one, and the price falls when supply arrives', () => {
  const noRoad = tiny({ routes: [] });
  const st0 = S.createState(noRoad, 1), p0 = st0.nodes.town.price.grain;
  S.step(st0, 25);
  const starved = st0.nodes.town.price.grain, fed = st0.nodes.farm.price.grain;
  assert.ok(starved > p0 * 2 && starved > 3 * fed, 'town price ' + starved + ' vs farm ' + fed);
  const withRoad = run(tiny(), 25);
  assert.ok(withRoad.nodes.town.price.grain < starved / 2, 'trade should ease the price: ' + withRoad.nodes.town.price.grain);
});

test('goods flow along the route and the summary names the route', () => {
  const st = run(tiny(), 30);
  const s = S.summarize(st, { window: 30 });
  const f = s.flows.find(x => x.route === 'road' && x.from === 'farm' && x.to === 'town');
  assert.ok(f && f.amount > 20, 'flow ' + (f && f.amount));
  assert.equal(S.summarize(st).flows.filter(x => x.from === 'town').length, 0);
});

test('an embargo rule blocks the flow, and the log says so', () => {
  const free = run(tiny(), 40), blocked = run(tiny({ rules: [rule({ effect: { type: 'embargo', dir: 'out' }, scope: { kind: 'settlement', target: 'farm' }, res: 'grain' })] }), 40);
  assert.ok(total(free) > 20);
  assert.equal(total(blocked), 0);
  assert.ok(blocked.log.some(e => e.kind === 'embargo'));
  assert.ok(blocked.nodes.town.price.grain > free.nodes.town.price.grain * 2);
  // the same rule switched off changes nothing
  const off = run(tiny({ rules: [rule({ on: false, effect: { type: 'embargo', dir: 'out' }, scope: { kind: 'settlement', target: 'farm' }, res: 'grain' })] }), 40);
  assert.ok(Math.abs(total(off) - total(free)) < 1e-9);
});

test('a route closed in winter carries nothing in winter and flows again after', () => {
  const cfg = tiny(); cfg.routes[0].closed = ['winter'];
  const st = run(cfg, 359);
  const h = st.hist;
  let winter = 0, other = 0;
  h.days.forEach((d, i) => { const sum = h.flows[i].reduce((t, f) => t + f[3], 0); if (d > 270) winter += sum; else other += sum; });
  assert.equal(winter, 0);
  assert.ok(other > 50);
  assert.ok(st.log.some(e => e.kind === 'route' && /closes/.test(e.text)));
});

test('a seasonal ban rule only bites in its season', () => {
  const st = run(tiny({ rules: [rule({ when: { seasons: ['summer'] }, effect: { type: 'embargo', dir: 'both' } })] }), 200);
  const h = st.hist; let summer = 0, spring = 0;
  h.days.forEach((d, i) => { const sum = h.flows[i].reduce((t, f) => t + f[3], 0); if (d > 90 && d <= 180) summer += sum; else if (d <= 90 && d > 5) spring += sum; });
  assert.equal(summer, 0);
  assert.ok(spring > 0);
});

test('a tariff that eats the margin stops the flow; a mild one does not (demand is fixed) but the buyer pays more', () => {
  const t = pct => run(tiny({ rules: [rule({ effect: { type: 'tariff', pct, dir: 'in' }, scope: { kind: 'settlement', target: 'town' }, res: 'grain' })] }), 40);
  const none = run(tiny(), 40), mild = t(30), harsh = t(120);
  assert.ok(total(none) > 500);
  assert.ok(Math.abs(total(mild) - total(none)) < 1e-6);
  assert.equal(total(harsh), 0);
  assert.ok(harsh.nodes.town.price.grain > none.nodes.town.price.grain * 3);
  // and the importer collects the money
  const st = S.createState(tiny({ rules: [rule({ effect: { type: 'tariff', pct: 10, dir: 'in' }, scope: { kind: 'settlement', target: 'town' }, res: 'grain' })] }), 1);
  let income = 0, free = 0; const st2 = S.createState(tiny(), 1);
  for (let i = 0; i < 30; i++) { S.step(st, 1); S.step(st2, 1); income += st.nodes.town.income; free += st2.nodes.town.income; }
  assert.ok(income > free, 'income with tariff ' + income + ' without ' + free);
});

test('free trade removes the tariff between members', () => {
  const rules = [rule({ id: 'a', effect: { type: 'tariff', pct: 120, dir: 'in' }, scope: { kind: 'settlement', target: 'town' }, res: 'grain' })];
  const taxed = total(run(tiny({ rules }), 40));
  const pact = total(run(tiny({ rules: rules.concat(rule({ id: 'b', effect: { type: 'freeTrade', pct: 0 }, scope: { kind: 'global', target: '' } })) }), 40));
  assert.ok(pact > taxed * 1.5, 'pact ' + pact + ' taxed ' + taxed);
});

test('a mine with no regrowth runs dry; a regrowing forest keeps giving', () => {
  const mine = regrow => tiny({ resources: [{ name: 'Ore', category: 'material', value: 5, bulk: 1 }], routes: [], nodes: [{ id: 'm', name: 'Mine', pop: 400, terrain: ['mountain'], consumers: [],
    producers: [{ id: 'p', res: 'ore', perWorker: 0.2, share: 1, deposit: { cap: 300, regrow } }] }] });
  const dry = S.createState(mine(0), 1), early = [], late = [];
  for (let i = 0; i < 200; i++) { S.step(dry, 1); (i < 5 ? early : i > 150 ? late : []).push(dry.nodes.m.last.prod.ore || 0); }
  assert.ok(dry.ledger.ore.produced <= 300 + 1e-6, 'took ' + dry.ledger.ore.produced);
  assert.ok(early.reduce((a, b) => a + b, 0) > 10 && late.every(v => v < 0.05), 'late output ' + late.slice(0, 3));
  const wood = run(mine(0.01), 200);
  assert.ok(wood.ledger.ore.produced > 600, 'regrowing deposit gave ' + wood.ledger.ore.produced);
  assert.ok((wood.nodes.m.last.prod.ore || 0) > 0.5);
});

test('production follows the terrain, the season and the workers', () => {
  const mk = (terrain, season) => tiny({ routes: [], nodes: [{ id: 'f', name: 'F', pop: 200, tech: 0, terrain, consumers: [], producers: [{ res: 'grain', perWorker: 0.1, share: 1, terrain: { plains: 1, hills: 0.4 }, season }] }] });
  const out = (terrain, season) => { const st = S.createState(mk(terrain, season), 1); S.step(st, 1); return st.ledger.grain.produced; };
  assert.ok(Math.abs(out(['plains'], {}) - 200 * 0.4 * 0.1) < 1e-9);
  assert.ok(Math.abs(out(['hills'], {}) - 200 * 0.4 * 0.1 * 0.4) < 1e-9);
  assert.equal(out(['desert'], {}), 0);
  assert.ok(Math.abs(out(['plains'], { spring: 0.5 }) - 200 * 0.4 * 0.1 * 0.5) < 1e-9);
});

test('custom rules: price cap, monopoly, forbidden, output and demand', () => {
  const base = run(tiny({ routes: [] }), 20);
  const capped = run(tiny({ routes: [], rules: [rule({ effect: { type: 'priceCap', pct: 120 }, scope: { kind: 'settlement', target: 'town' }, res: 'grain' })] }), 20);
  assert.ok(base.nodes.town.price.grain > 5 && capped.nodes.town.price.grain <= 2 * 1.2 + 1e-9);
  const mono = run(tiny({ routes: [], rules: [rule({ effect: { type: 'monopoly', pct: 50 }, scope: { kind: 'settlement', target: 'farm' }, res: 'grain' })] }), 5);
  assert.ok(mono.ledger.grain.produced < S.createState(tiny({ routes: [] }), 1).ledger.grain.produced + run(tiny({ routes: [] }), 5).ledger.grain.produced * 0.6);
  const forb = run(tiny({ rules: [rule({ effect: { type: 'forbidden' }, scope: { kind: 'settlement', target: 'farm' }, res: 'grain' })] }), 10);
  assert.equal(forb.ledger.grain.produced, 0);
  const blight = run(tiny({ routes: [], rules: [rule({ effect: { type: 'output', pct: -50 }, res: 'grain' })] }), 10).ledger.grain.produced;
  assert.ok(Math.abs(blight - run(tiny({ routes: [] }), 10).ledger.grain.produced / 2) < 1e-6);
  const feast = run(tiny({ routes: [], rules: [rule({ effect: { type: 'demand', pct: 100 }, scope: { kind: 'settlement', target: 'town' }, res: 'grain' })] }), 1);
  assert.ok(Math.abs(feast.nodes.town.dem.grain - 2 * run(tiny({ routes: [] }), 1).nodes.town.dem.grain) < 1e-9);
});

test('famine: a town with no food shrinks and the log records it', () => {
  const st = run(tiny({ routes: [] }), 200);
  assert.ok(st.nodes.town.pop < 1000 * 0.85, 'pop ' + st.nodes.town.pop);
  assert.ok(st.log.some(e => e.kind === 'famine') && st.log.some(e => e.kind === 'shortage'));
});

test('raids lose goods, cost the ledger, and need a risky route', () => {
  const safe = run(tiny(), 60), risky = tiny(); risky.routes[0].risk = 0.9;
  const bad = run(risky, 60);
  assert.equal(safe.ledger.grain.lost, 0);
  assert.ok(bad.ledger.grain.lost > 0 && bad.log.some(e => e.kind === 'raid'));
});

test('building from a map: pins linked to places become settlements, paths become routes between the pins on them', () => {
  const items = [
    { id: 'p1', kind: 'pin', entryId: 'e1', x: 100, y: 100, title: 'Seaport', icon: 'port' }, { id: 'p2', kind: 'pin', entryId: 'e2', x: 300, y: 100, title: 'Middle Town' },
    { id: 'p3', kind: 'pin', entryId: 'e3', x: 500, y: 100, title: 'Hill Fort' }, { id: 'p4', kind: 'pin', entryId: null, x: 50, y: 400, label: 'unlinked' },
    { id: 'rd', kind: 'path', points: [[100, 100], [300, 100], [500, 100]], label: 'Old Road', style: { mode: 'cart' } },
    { id: 'rg', kind: 'region', points: [[0, 0], [250, 0], [250, 200], [0, 200]], label: 'Coastal Plains' },
  ];
  const r = S.buildFromMap({ items, width: 1000, height: 600, unitsPerPx: 0.5 });
  assert.deepEqual(r.nodes.map(n => n.id), ['p1', 'p2', 'p3']);
  assert.equal(r.routes.length, 2);
  assert.ok(Math.abs(r.routes[0].distance - 100) < 1e-6);
  assert.ok(r.routes.every(x => x.itemId === 'rd'));
  assert.ok(r.nodes[0].terrain.includes('coast') && r.nodes[0].terrain.includes('plains'));
  assert.equal(r.skippedPins, 1);
});

test('autoFill makes a working economy from terrain and population, and the result runs', () => {
  const cfg = S.autoFill({ resources: S.MEDIEVAL_RES.map(r => Object.assign({}, r, { id: S.slug(r.name) })), nodes: [{ id: 'a', name: 'A', pop: 900, terrain: ['coast'] }, { id: 'b', name: 'B', pop: 900, terrain: ['forest', 'hills'] }], routes: [{ id: 'x', a: 'a', b: 'b', distance: 60, mode: 'cart' }] });
  assert.ok(cfg.nodes[0].producers.some(p => p.res === 'fish') && cfg.nodes[1].producers.some(p => p.res === 'timber'));
  assert.ok(cfg.nodes[0].consumers.length > 3);
  const st = run(cfg, 40);
  assert.ok(total(st) > 0);
  assert.deepEqual(S.validate(cfg), []);
});

test('the atlas result has the agreed shape', () => {
  const cfg = S.presetConfig('kingdom'); cfg.nodes.forEach(n => { n.itemId = n.id; });
  const r = S.atlasResult(run(cfg, 30), { window: 30 });
  assert.ok(Number.isFinite(r.day) && r.nodes.length === cfg.nodes.length && r.flows.length > 0 && r.resources.length > 0);
  const n = r.nodes[0];
  for (const k of ['itemId', 'entryId', 'x', 'y', 'population', 'wealth', 'surplus', 'shortage']) assert.ok(k in n, k);
  const f = r.flows[0];
  for (const k of ['fromItemId', 'toItemId', 'routeItemId', 'resource', 'amount']) assert.ok(k in f, k);
  assert.ok(r.resources.every(x => x.name && /^#/.test(x.color)));
  assert.ok(JSON.stringify(r).length < 30000);
});

test('scenario compare: switching a rule off changes the outcome', () => {
  const cfg = S.presetConfig('kingdom');
  const r = S.scenario(cfg, 'k', 60, { off: ['crown-tariff', 'church-tithe'] });
  assert.notEqual(r.baseTotals.wealth, r.altTotals.wealth);
});

test('describeRule says what a rule does in words', () => {
  const cfg = S.normalize(tiny());
  const t = S.describeRule(cfg, S.normalize(tiny({ rules: [rule({ effect: { type: 'tariff', pct: 8, dir: 'in' }, scope: { kind: 'settlement', target: 'town' }, res: 'grain', when: { seasons: ['winter'] } })] })).rules[0]);
  assert.match(t, /8% tariff on grain coming in at Town in winter/);
});
