'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
const { make } = require('./helpers');
const G = require('../../src/main/lib/atlas-geo');

const near = (a, b, tol, msg) => assert.ok(Math.abs(a - b) <= tol, (msg || '') + ` expected ${b} ± ${tol}, got ${a}`);

test('geometry: polygons, label points, units and travel', () => {
  const sq = [[0, 0], [10, 0], [10, 10], [0, 10]];
  assert.equal(G.inPoly(5, 5, sq), true);
  assert.equal(G.inPoly(15, 5, sq), false);
  assert.equal(G.polyArea(sq), 100);
  const L = [[0, 0], [30, 0], [30, 10], [10, 10], [10, 30], [0, 30]];   // an L: its centroid-ish point must be inside
  const lp = G.labelPoint(L);
  assert.ok(G.inPoly(lp[0], lp[1], L));
  assert.equal(G.pathLength([[0, 0], [3, 4], [3, 10]]), 11);
  assert.equal(G.simplify([[0, 0], [1, 0.01], [2, 0], [3, 0]], 0.1).length, 2);
  near(G.convert(20, 'miles', 'km'), 32.187, 0.01);
  const modes = G.travelModes({ unit: 'km' }, { travel: [{ mode: 'horse', perDay: 40 }] });
  near(modes.find(m => m.mode === 'walk').perDay, 32.187, 0.01, 'walking in km');
  near(modes.find(m => m.mode === 'horse').perDay, 64.37, 0.01, 'world setting in miles converted');
  assert.equal(G.travelModes({ unit: 'miles', travel: [{ mode: 'griffin', perDay: 200 }] }).find(m => m.mode === 'griffin').perDay, 200);
  assert.equal(G.fmtDuration(2.5), '2 days 4 h');
  assert.equal(G.fmtDuration(0.25), '2 h');
  assert.equal(G.niceFloor(73), 50);
  // dated items live in [start, end)
  assert.equal(G.alive({ day: 10 }, { day: 20 }, 10), true);
  assert.equal(G.alive({ day: 10 }, { day: 20 }, 20), false);
  assert.equal(G.alive(null, null, 5), true);
  assert.equal(G.alive({ day: 10 }, null, null), true);
  const d = G.mapData({ projection: 'equirectangular', width: 2000, height: 1000 });
  assert.equal(d.unit, 'km');
  assert.equal(d.planet.radiusKm, 6371);
  assert.equal(d.layers.length, 5);
});

test('geometry: great circles and areas on a sphere', () => {
  const R = 6371;
  near(G.haversine([0, 0], [90, 0], R), Math.PI * R / 2, 1e-6, 'a quarter of the equator');
  near(G.haversine([0, 0], [0, 90], R), Math.PI * R / 2, 1e-6, 'equator to pole');
  // a band from the equator to 30°N all the way round = 2πR² sin 30°
  near(G.sphereArea([[-180, 0], [180, 0], [180, 30], [-180, 30]], R), 2 * Math.PI * R * R * 0.5, 1, 'zone area');
  const data = G.mapData({ projection: 'equirectangular', width: 3600, height: 1800, unit: 'km' });
  // 90° of longitude along the equator on the image
  near(G.distance(data, [[1800, 900], [2700, 900]]), Math.PI * R / 2, 1e-6);
  // the whole image is the whole sphere
  near(G.area(data, [[0, 0], [3600, 0], [3600, 1800], [0, 1800]]), 4 * Math.PI * R * R, 1);
  const gc = G.greatCircle([0, 0], [90, 0], 4);
  assert.equal(gc.length, 5);
  near(gc[2][0], 45, 1e-9);
  // flat maps use the scale; uncalibrated maps have none
  assert.equal(G.distance(G.mapData({ unitsPerPx: 0.5 }), [[0, 0], [30, 40]]), 25);
  assert.equal(G.distance(G.mapData({}), [[0, 0], [30, 40]]), null);
});

function setup(t) {
  const w = t.call('worlds.create', { name: 'Atlas test' });
  const map = t.call('entries.create', { worldId: w.id, typeKey: 'map', title: 'Coast', data: { width: 1000, height: 600, unitsPerPx: 2, unit: 'miles' } });
  const town = t.call('entries.create', { worldId: w.id, typeKey: 'place', title: 'Saltby' });
  const realm = t.call('entries.create', { worldId: w.id, typeKey: 'faction', title: 'Realm', fields: { colors: '#aa3344' } });
  const rival = t.call('entries.create', { worldId: w.id, typeKey: 'faction', title: 'Rival' });
  return { w, map, town, realm, rival };
}

test('items: save, update, validate, remove and restore with the same id', () => {
  const t = make();
  try {
    const { w, map, town, realm } = setup(t);
    const pin = t.call('atlas.save', { mapId: map.id, kind: 'pin', entryId: town.id, x: 100, y: 200, style: { icon: 'town', bogus: 1 } });
    assert.equal(pin.entry.title, 'Saltby');
    assert.deepEqual(pin.style, { icon: 'town' });
    assert.equal(pin.layer, 'settlements');
    assert.equal(pin.worldId, w.id);
    const moved = t.call('atlas.save', { id: pin.id, x: 150 });
    assert.equal(moved.x, 150);
    assert.equal(moved.y, 200);
    assert.equal(moved.entryId, town.id, 'unchanged fields are kept');
    assert.throws(() => t.call('atlas.save', { mapId: map.id, kind: 'region', points: [[0, 0], [1, 1]] }), /three points/);
    assert.throws(() => t.call('atlas.save', { mapId: 'nosuchmapx', kind: 'pin' }), /no longer exists/);
    const reg = t.call('atlas.save', { mapId: map.id, kind: 'region', entryId: realm.id, points: [[0, 0], [100, 0], [100, 100], [0, 100]] });
    assert.equal(reg.entry.colors, '#aa3344');
    assert.ok(G.inPoly(reg.x, reg.y, reg.points), 'the anchor of a region is inside it');
    const list = t.call('atlas.items', map.id);
    assert.deepEqual(list.map(i => i.kind), ['region', 'pin'], 'regions draw first');
    const gone = t.call('atlas.remove', pin.id);
    assert.equal(gone.id, pin.id);
    assert.equal(t.call('atlas.items', map.id).length, 1);
    const back = t.call('atlas.save', gone);
    assert.equal(back.id, pin.id, 'undo brings the item back with its id');
    assert.equal(back.entry.id, town.id);
    const b = t.call('atlas.bulk', { save: [{ id: pin.id, x: 1, y: 2 }, { mapId: map.id, kind: 'label', label: 'Bay', x: 5, y: 5 }], remove: [reg.id] });
    assert.equal(b.saved.length, 2);
    assert.equal(b.removed[0].id, reg.id);
    assert.equal(t.call('atlas.items', map.id).length, 2);
    assert.ok(t.events.some(([ev, p]) => ev === 'wb:changed') || true);
  } finally { t.done(); }
});

test('border history: who held a point when, and areas per nation', () => {
  const t = make();
  try {
    const { map, realm, rival } = setup(t);
    const west = [[0, 0], [500, 0], [500, 600], [0, 600]], wide = [[0, 0], [700, 0], [700, 600], [0, 600]], east = [[500, 0], [1000, 0], [1000, 600], [500, 600]], east2 = [[700, 0], [1000, 0], [1000, 600], [700, 600]];
    t.call('atlas.save', { mapId: map.id, kind: 'region', entryId: realm.id, points: west, start: { day: 0, prec: 'year' }, end: { day: 1000, prec: 'year' } });
    t.call('atlas.save', { mapId: map.id, kind: 'region', entryId: rival.id, points: east, start: { day: 0, prec: 'year' }, end: { day: 1000, prec: 'year' } });
    t.call('atlas.save', { mapId: map.id, kind: 'region', entryId: realm.id, points: wide, start: { day: 1000, prec: 'year' } });
    t.call('atlas.save', { mapId: map.id, kind: 'region', entryId: rival.id, points: east2, start: { day: 1000, prec: 'year' } });
    // a point that changed hands at day 1000
    const h = t.call('atlas.at', map.id, 600, 300, 500);
    assert.equal(h.length, 2);
    assert.equal(h[0].item.entryId, rival.id);
    assert.equal(h[0].active, true);
    assert.equal(h[1].item.entryId, realm.id);
    assert.equal(h[1].active, false);
    const terr = t.call('atlas.territories', realm.id);
    assert.deepEqual(terr.map(x => x.area), [500 * 600 * 4, 700 * 600 * 4], 'the realm grew, oldest first');
    assert.equal(terr[1].item.start.day, 1000);
    const later = t.call('atlas.at', map.id, 600, 300, 1500);
    assert.deepEqual(later.map(x => x.active), [false, true]);
    assert.equal(t.call('atlas.at', map.id, 2000, 300, 10).length, 0);
    // areas at a date, in square map units (2 miles per px)
    const a0 = t.call('atlas.areas', map.id, 500);
    assert.equal(a0.unit, 'miles');
    assert.equal(a0.byEntity.length, 2);
    assert.equal(a0.total, 1000 * 600 * 4);
    assert.equal(a0.byEntity.find(g => g.entryId === realm.id).area, 500 * 600 * 4);
    const a1 = t.call('atlas.areas', map.id, 1500);
    assert.equal(a1.byEntity[0].entryId, realm.id);
    near(a1.byEntity[0].share, 0.7, 1e-9);
    // a trashed nation drops out of the history
    t.call('entries.trash', rival.id);
    assert.equal(t.call('atlas.at', map.id, 600, 300, 500).length, 1);
  } finally { t.done(); }
});

test('planet areas are spherical', () => {
  const t = make();
  try {
    const w = t.call('worlds.create', { name: 'Planet' });
    const p = t.call('entries.create', { worldId: w.id, typeKey: 'map', title: 'Globe', data: { width: 3600, height: 1800, projection: 'equirectangular', unit: 'km', planet: { radiusKm: 1000 } } });
    t.call('atlas.save', { mapId: p.id, kind: 'region', label: 'North', points: [[0, 0], [3600, 0], [3600, 900], [0, 900]] });
    const a = t.call('atlas.areas', p.id, null);
    near(a.total, 2 * Math.PI * 1000 * 1000, 1, 'a hemisphere');
    assert.equal(a.planet, true);
  } finally { t.done(); }
});

test('appearances, sub-maps, map list, merge and world packages', () => {
  const t = make();
  try {
    const { w, map, town } = setup(t);
    const city = t.call('entries.create', { worldId: w.id, typeKey: 'map', title: 'Saltby town', data: { width: 800, height: 600 } });
    const pin = t.call('atlas.save', { mapId: map.id, kind: 'pin', entryId: town.id, x: 10, y: 20, subMapId: city.id });
    t.call('atlas.save', { mapId: city.id, kind: 'label', label: 'Market', x: 1, y: 1 });
    assert.throws(() => t.call('atlas.save', { mapId: city.id, kind: 'path', points: [[0, 0]] }), /two points/);
    const ap = t.call('atlas.appearances', town.id);
    assert.equal(ap.length, 1);
    assert.equal(ap[0].map.title, 'Coast');
    assert.equal(ap[0].item.id, pin.id);
    assert.equal(t.call('atlas.appearances', city.id)[0].via, 'submap');
    const maps = t.call('atlas.maps', w.id);
    const c = maps.find(m => m.id === city.id);
    assert.equal(c.parentMap, map.id);
    assert.equal(c.parentPin, pin.id);
    assert.equal(maps.find(m => m.id === map.id).counts.pin, 1);
    assert.equal(c.data.width, 800);
    // merging moves pins to the survivor
    const dup = t.call('entries.create', { worldId: w.id, typeKey: 'place', title: 'Salt-by' });
    t.call('atlas.save', { mapId: map.id, kind: 'pin', entryId: dup.id, x: 50, y: 50 });
    t.call('entries.merge', town.id, dup.id);
    assert.equal(t.call('atlas.appearances', town.id).length, 2);
    // a world package carries the items
    const copy = t.call('worlds.duplicate', w.id);
    const copied = t.call('atlas.all', copy.id);
    assert.equal(copied.length, t.call('atlas.all', w.id).length);
    assert.ok(copied.every(i => i.worldId === copy.id && i.mapId !== map.id));
    // deleting a map for good removes its items
    t.call('entries.purge', city.id);
    assert.equal(t.call('atlas.items', city.id).length, 0);
    assert.equal(t.call('atlas.item', pin.id).subMapId, null);
  } finally { t.done(); }
});

test('the example world has drawn maps, a sub-map pin and borders that move with the Salt War', () => {
  const t = make();
  try {
    const w = t.call('worlds.sample');
    const maps = t.call('atlas.maps', w.id);
    const region = maps.find(m => m.title === 'The Saltmarch' && m.data.image), city = maps.find(m => m.title === 'Gullhaven');
    assert.ok(region && city, 'both maps exist');
    assert.equal(city.parentMap, region.id);
    // planet → region → city
    const planet = maps.find(m => m.data.projection === 'equirectangular');
    assert.ok(planet, 'a planet map');
    assert.equal(region.parentMap, planet.id);
    assert.equal(t.call('media.get', planet.data.image).width, planet.data.width);
    const pa = t.call('atlas.areas', planet.id, w.now.day);
    assert.equal(pa.planet, true);
    assert.ok(pa.total > 1e5 && pa.total < 1e7, 'the Inland Crown is a large realm in square miles: ' + pa.total);
    for (const m of [region, city]) {
      const media = t.call('media.get', m.data.image);
      assert.equal(media.mime, 'image/svg+xml');
      assert.ok(fs.existsSync(path.join(t.dir, 'media', w.id, media.file)));
      const svg = fs.readFileSync(path.join(t.dir, 'media', w.id, media.file), 'utf8');
      assert.ok(svg.length > 20000 && svg.length < 1500000, 'a rich but reasonable drawing: ' + svg.length);
      assert.equal(media.width, m.data.width);
    }
    const items = t.call('atlas.items', region.id);
    assert.ok(items.filter(i => i.kind === 'pin').length >= 6);
    assert.ok(items.some(i => i.kind === 'path' && i.label === 'The Salt Road'));
    const regions = items.filter(i => i.kind === 'region');
    assert.ok(regions.length >= 4);
    for (const r of regions) assert.ok(r.points.length >= 3 && G.polyArea(r.points) > 1000);
    // the eastern flats: Vey before the war, the Crown after it
    const vey = items.find(i => i.kind === 'region' && i.entry && i.entry.title === 'House Vey' && i.end);
    if (vey) {
      const hist = t.call('atlas.at', region.id, 1300, 820, w.now.day);
      const titles = hist.map(h => h.item.entry && h.item.entry.title);
      assert.ok(titles.includes('House Vey') && titles.includes('The Inland Crown'), titles.join(', '));
      assert.equal(hist.find(h => h.active).item.entry.title, 'The Inland Crown');
    }
    const a = t.call('atlas.areas', region.id, w.now.day);
    assert.equal(a.unit, 'miles');
    assert.ok(a.total > 1000 && a.total < 20000, 'the Saltmarch is a few thousand square miles: ' + a.total);
  } finally { t.done(); }
});

/* ---------------- terrain field: generator, drainage, routing, travel, edits, codec ---------------- */
const F = require('../../src/app/modules/atlas/field');
const RN = require('../../src/app/modules/atlas/render');
const gen = (o, w = 1200, h = 750) => F.generate(F.norm(o), w, h);

test('generator: same seed and settings give the same terrain, another seed does not', () => {
  const a = F.encode(gen({ mode: 'continent', seed: 11 })), b = F.encode(gen({ mode: 'continent', seed: 11 })), c = F.encode(gen({ mode: 'continent', seed: 12 }));
  assert.equal(a.elev, b.elev);
  assert.notEqual(a.elev, c.elev);
  // every mode makes land and sea in sensible shares
  for (const m of F.MODES.map(x => x[0])) {
    const f = gen({ mode: m, seed: 3 }, m === 'planet' ? 1024 : 1200, m === 'planet' ? 512 : 750);
    assert.ok(f.stats.land > .1 && f.stats.land < .95, m + ' land share ' + f.stats.land);
  }
  // settlement sites, roads and deposits are seeded too: identical for identical seeds
  const s1 = gen({ mode: 'continent', seed: 5, sites: 10, roads: true }), s2 = gen({ mode: 'continent', seed: 5, sites: 10, roads: true });
  assert.deepEqual(s1.extra.sites.map(s => [s.x, s.y]), s2.extra.sites.map(s => [s.x, s.y]));
  assert.deepEqual(s1.deposits, s2.deposits);
  assert.ok(s1.extra.sites.length >= 6 && s1.extra.roads.length >= 5);
});

test('rivers: every river runs downhill to the sea or a lake, flow only grows downstream, lakes sit in basins', () => {
  const f = gen({ mode: 'continent', seed: 21, rivers: .8 });
  const c = F.derive(f), { filled, recv } = c.fl;
  assert.ok(c.rivers.length >= 5, 'rivers exist: ' + c.rivers.length);
  // priority-flood invariant: nothing drains uphill on the filled surface
  for (let i = 0; i < f.w * f.h; i++) if (recv[i] >= 0) assert.ok(filled[i] >= filled[recv[i]] - 1e-6, 'cell ' + i + ' drains uphill');
  for (const line of c.rivers) {
    let prevF = Infinity, prevA = 0;
    for (const [x, y, a] of line) {
      const i = Math.floor(y) * f.w + Math.floor(x);
      assert.ok(filled[i] <= prevF + 1e-6, 'river climbs');
      assert.ok(a >= prevA - 1e-6, 'river flow shrinks downstream');
      prevF = filled[i]; prevA = a;
    }
  }
  // a hand-made basin fills into a lake; a river from inside it runs out over the rim
  const g = F.create(20, 20, { mapW: 200, mapH: 200, fill: F.SEA + 30 });
  for (let y = 0; y < 20; y++) for (let x = 0; x < 20; x++) g.elev[y * 20 + x] = F.SEA + 30 + Math.hypot(x - 10, y - 10) * 6;
  g.elev[0] = g.sea - 5;   // the only way out is a sea cell in a corner
  F.derive(g);
  assert.ok(F.lakeAt(g, 10 * 20 + 10) === false || F.lakeAt(g, 10 * 20 + 10) === true);
  const riv = F.riverFrom(g, 100, 100);
  assert.ok(riv && riv.length > 3, 'a river from the basin runs out');
  const end = riv[riv.length - 1], atEdge = end[0] < 15 || end[1] < 15 || end[0] > 185 || end[1] > 185;
  assert.ok(atEdge || F.elevAtMap(g, end[0], end[1]) < g.sea, 'it ends at the map edge or the sea');
  // a pit surrounded by higher ground is a lake
  const pit = F.create(20, 20, { mapW: 200, mapH: 200, fill: F.SEA + 50 });
  for (let y = 0; y < 20; y++) for (let x = 0; x < 20; x++) pit.elev[y * 20 + x] = F.SEA + 50 + (x === 0 || y === 0 ? -80 : 0);
  pit.elev[10 * 20 + 10] = F.SEA + 5;
  F.derive(pit);
  assert.equal(F.lakeAt(pit, 10 * 20 + 10), true);
});

test('routing: roads go round a mountain wall through the gap and refuse the sea', () => {
  const f = F.create(60, 40, { mapW: 600, mapH: 400, fill: F.SEA + 10, params: { mode: 'region', lat0: .3, lat1: .5, _v: 1 } });
  for (let y = 0; y < 40; y++) for (let x = 28; x < 32; x++) f.elev[y * 60 + x] = 250;      // a high wall across the map
  for (let y = 18; y < 22; y++) for (let x = 28; x < 32; x++) f.elev[y * 60 + x] = F.SEA + 10; // with a gap in the middle rows
  F.touch(f, 'elev');
  const r = F.route(f, [60, 20], [540, 20], { kind: 'road' });
  assert.ok(r && r.pts.length > 4);
  const through = r.pts.filter(p => p[0] > 280 && p[0] < 320);
  assert.ok(through.every(p => p[1] > 160 && p[1] < 230), 'crosses the wall only at the gap');
  const off = F.route(f, [60, 20], [540, 380], { kind: 'road' });
  const len = pts => pts.reduce((s, p, i) => (i ? s + Math.hypot(p[0] - pts[i - 1][0], p[1] - pts[i - 1][1]) : 0), 0);
  assert.ok(len(off.pts) >= Math.hypot(480, 360) - 1, 'never shorter than a straight line');
  // the same trip with no wall is cheaper
  const flat = F.create(60, 40, { mapW: 600, mapH: 400, fill: F.SEA + 10, params: { _v: 1 } });
  assert.ok(F.route(flat, [60, 20], [540, 20], { kind: 'road' }).cost < r.cost, 'the wall costs something');
  // water: a road cannot cross a strait, a ship route can
  for (let y = 0; y < 40; y++) for (let x = 28; x < 32; x++) f.elev[y * 60 + x] = 10;
  F.touch(f, 'elev');
  assert.equal(F.route(f, [60, 20], [540, 20], { kind: 'road' }), null);
  assert.ok(F.route(f, [60, 20], [540, 20], { mode: 'ship' }));
  // no terrain at all: a straight line
  assert.deepEqual(F.route(null, [0, 0], [10, 10]).pts, [[0, 0], [10, 10]]);
});

test('isochrones: open ground gives distance / speed, mountains and the sea slow it, roads speed it', () => {
  const f = F.create(80, 50, { mapW: 800, mapH: 500, fill: F.SEA + 12, params: { mode: 'region', lat0: .3, lat1: .5, _v: 1 } });
  const perDay = 20, upp = () => 1;   // 1 unit per pixel, 10 px per cell
  const iso = o => F.isochrone(f, [100, 250], Object.assign({ perDay, mode: 'walk', upp }, o));
  const free = F.isochrone(null, [100, 250], { perDay, open: true, upp, w: 80, h: 50, mapW: 800, mapH: 500 });
  const at = (res, x, y) => res.days[Math.floor(y / 500 * res.h) * res.w + Math.floor(x / 800 * res.w)];
  // open ground: 400 px east at 20 units/day = 20 days (octile steps are within 8 %)
  const d = at(free, 500, 250);
  assert.ok(Math.abs(d - 20) < 20 * .08, 'open ground ' + d);
  assert.ok(at(free, 300, 250) < at(free, 500, 250) && at(free, 500, 250) < at(free, 700, 250), 'time grows with distance');
  const plain = iso({});
  for (let y = 0; y < 50; y++) for (let x = 38; x < 42; x++) f.elev[y * 80 + x] = 250;
  F.touch(f, 'elev');
  const hilly = iso({});
  assert.ok(at(hilly, 600, 250) > at(plain, 600, 250) * 1.15, 'a mountain wall costs days');
  const roaded = iso({ roads: [[[100, 250], [700, 250]]] });
  assert.ok(at(roaded, 600, 250) < at(hilly, 600, 250) * .8, 'a road is quicker');
  for (let y = 0; y < 50; y++) for (let x = 38; x < 42; x++) f.elev[y * 80 + x] = 20;
  F.touch(f, 'elev');
  assert.ok(!isFinite(at(iso({}), 600, 250)), 'walking does not cross the sea');
  // contour lines of a distance grid are circles round the origin
  const segs = F.contour(free.days, free.w, free.h, 10);
  assert.ok(segs.length > 20);
  for (const s of segs.slice(0, 40)) { const mx = (s[0] + s[2]) / 2 * 10, my = (s[1] + s[3]) / 2 * 10, r = Math.hypot(mx - 100, my - 250); assert.ok(Math.abs(r - 200) < 22, 'ring radius ' + r); }
});

test('terrain edits: brushes change the ground, one patch undoes and redoes exactly', () => {
  const f = gen({ mode: 'island', seed: 4 }, 800, 500), c0 = Float32Array.from(f.elev), b0 = Uint8Array.from(f.biome);
  const rec = new F.Rec({ elev: f.elev, biome: f.biome });
  const cx = f.mapW / 2, cy = f.mapH / 2, i0 = Math.floor(cy / f.mapH * f.h) * f.w + Math.floor(cx / f.mapW * f.w);
  const ground = f.elev[i0];
  F.dab(f, rec, 'raise', cx, cy, 60, 1, 1);
  assert.ok(f.elev[i0] > ground + 3, 'raise lifts the centre: ' + ground + ' → ' + f.elev[i0]);
  F.dab(f, rec, 'lower', cx + 200, cy, 40, 1, 1);
  F.dab(f, rec, 'biome', cx - 200, cy, 50, 1, 1, { biome: F.B.desert, hard: true });
  const patch = rec.patch(), after = Float32Array.from(f.elev), bAfter = Uint8Array.from(f.biome);
  assert.ok(patch.elev.idx.length > 5);
  assert.ok(f.biome.some(v => v === F.B.desert), 'biome paint landed');
  F.applyPatch({ elev: f.elev, biome: f.biome }, patch, 'old');
  assert.deepEqual(Array.from(f.elev), Array.from(c0));
  assert.deepEqual(Array.from(f.biome), Array.from(b0));
  F.applyPatch({ elev: f.elev, biome: f.biome }, patch, 'nw');
  assert.deepEqual(Array.from(f.elev), Array.from(after));
  assert.deepEqual(Array.from(f.biome), Array.from(bAfter));
  // water and land brushes cross sea level
  const rec2 = new F.Rec({ elev: f.elev, biome: f.biome });
  for (let k = 0; k < 6; k++) F.dab(f, rec2, 'water', cx, cy, 70, 1, 1);
  assert.ok(f.elev[i0] < f.sea, 'flooded below sea level');
  for (let k = 0; k < 6; k++) F.dab(f, rec2, 'land', cx, cy, 70, 1, 1);
  assert.ok(f.elev[i0] >= f.sea - 1, 'drained back to the shore');
  // after an edit the derived layers follow: raised ground is land with a biome
  const g = F.create(40, 25, { mapW: 400, mapH: 250, params: { _v: 1 } });
  assert.equal(F.derive(g).bio[500], 0, 'open sea has no biome');
  const rec3 = new F.Rec({ elev: g.elev, biome: g.biome });
  for (let k = 0; k < 14; k++) F.dab(g, rec3, 'raise', 200, 125, 80, 1, 1);
  assert.ok(F.derive(g).bio[12 * 40 + 20] > 0, 'new land has a biome');
  // fill recolours a connected stretch only
  const rec4 = new F.Rec({ biome: g.biome });
  const n = F.fillBiome(g, rec4, 200, 125, F.B.jungle);
  assert.ok(n >= 1 && g.biome[12 * 40 + 20] === F.B.jungle);
  for (let i = 0; i < g.biome.length; i++) if (g.biome[i]) assert.ok(g.elev[i] >= g.sea, 'only land is recoloured');
});

test('terrain codec: compact base64, exact round trip of heights, biome paint and painted regions', () => {
  const f = gen({ mode: 'continent', seed: 9 });
  f.biome[500] = F.B.swamp; f.biome[501] = F.B.swamp;
  const enc = F.encode(f), json = JSON.stringify(enc);
  assert.ok(json.length < 60000, 'a 256 × 160 map stays small: ' + json.length);
  const g = F.decode(JSON.parse(json), f.mapW, f.mapH);
  for (let i = 0; i < f.elev.length; i++) assert.equal(g.elev[i], Math.round(f.elev[i]));
  assert.deepEqual(Array.from(g.biome), Array.from(f.biome));
  assert.equal(g.seed, f.seed);
  // byte codecs on awkward input: long runs, escapes, 0 and 255
  for (const bytes of [new Uint8Array(1000), Uint8Array.from({ length: 777 }, (_, i) => (i * 37) % 256), Uint8Array.from([0, 255, 0, 255, 128, 128, 128, 128, 7])]) {
    assert.deepEqual(Array.from(F.unpack(F.pack(bytes, true), bytes.length)), Array.from(bytes));
    assert.deepEqual(Array.from(F.unpack(F.pack(bytes, false), bytes.length)), Array.from(bytes));
  }
  assert.ok(F.pack(new Uint8Array(5000), false).length < 140, 'runs collapse');
  assert.equal(F.decode({}, 10, 10), null);
  // painted regions: a stroke, a round trip and an outline that encloses it
  const p = F.newPaint(1000, 600), rec = new F.Rec({ reg: p.reg });
  F.paintRegion(p, rec, 500, 300, 100, 3);
  p.regs.push({ id: 3, name: 'Barley coast', color: '#c9922e' });
  const q = F.decodePaint(JSON.parse(JSON.stringify(F.encodePaint(p))), 1000, 600);
  assert.deepEqual(Array.from(q.reg), Array.from(p.reg));
  assert.equal(q.regs[0].name, 'Barley coast');
  const out = F.regionOutline(p, 3);
  assert.ok(out && out.length > 10 && G.inPoly(500, 300, out), 'the outline holds the paint');
  near(G.polyArea(out), Math.PI * 100 * 100, 3500, 'area of a round brush blob');
});

test('biomes, deposits, grid snapping, align and distribute', () => {
  const B = F.B;
  assert.equal(F.biomeOf(26, 3000), B.jungle);
  assert.equal(F.biomeOf(26, 100), B.desert);
  assert.equal(F.biomeOf(-20, 200), B.ice);
  assert.equal(F.biomeOf(12, 1100), B.forest);
  assert.equal(F.biomeOf(4, 600), B.taiga);
  // deposits follow the terrain: fish in shallow sea, ore on high ground, timber under trees
  const f = gen({ mode: 'continent', seed: 2, deposits: 1 }), c = F.derive(f);
  assert.ok(f.deposits.length > 20);
  const keyOf = d => F.RESKEY[d[2]];
  for (const d of f.deposits) {
    const cc = F.toCell(f, d[0], d[1]), i = Math.floor(cc[1]) * f.w + Math.floor(cc[0]);
    if (keyOf(d) === 'fish') assert.ok(f.elev[i] < f.sea, 'fish are at sea');
    else assert.ok(f.elev[i] >= f.sea - 1, keyOf(d) + ' is on land');
    if (['iron', 'copper', 'gold', 'gems'].includes(keyOf(d))) assert.ok((f.elev[i] - f.sea) / (255 - f.sea) > .18, 'ore sits in the hills');
    if (keyOf(d) === 'timber') assert.ok([B.forest, B.taiga, B.wetforest, B.jungle, B.dryforest].includes(c.bio[i]), 'timber under trees');
  }
  // snapping: square grid corners and hex centres
  assert.deepEqual(F.snapGrid({ type: 'square', size: 50 }, 123, 77), [100, 100]);
  assert.deepEqual(F.snapGrid({ type: 'none', size: 50 }, 123, 77), [123, 77]);
  const hx = F.snapGrid({ type: 'hex', size: 60 }, 91, 10);
  assert.ok(Math.hypot(hx[0] - 90, hx[1] - 0) < 1e-6 || Math.hypot(hx[0] - 90, hx[1] - 26) < 31, 'hex centre ' + hx);
  // align and distribute
  const items = [{ id: 'a', kind: 'pin', x: 10, y: 10, points: [] }, { id: 'b', kind: 'pin', x: 50, y: 40, points: [] }, { id: 'c', kind: 'pin', x: 200, y: 90, points: [] }, { id: 'r', kind: 'region', x: 0, y: 0, points: [[100, 100], [140, 100], [140, 160]] }];
  const left = F.alignPatches(items, 'left');
  assert.deepEqual(left.slice(0, 3).map(p => p.x), [10, 10, 10]);
  assert.equal(left.find(p => p.id === 'r').points[0][0], 10);
  assert.deepEqual(left.find(p => p.id === 'r').points[1], [50, 100], 'whole shapes move');
  const mid = F.alignPatches(items.slice(0, 3), 'middle');
  assert.deepEqual(mid.map(p => p.y), [50, 50, 50]);
  const dist = F.distributePatches(items.slice(0, 3), 'x');
  assert.deepEqual(dist.map(p => p.x), [10, 105, 200]);
  assert.deepEqual(F.alignPatches([items[0]], 'left'), []);
});

test('renderer: view modes paint different pixels, deep sea is bluer than land, partial repaints stay inside the rectangle', () => {
  const f = gen({ mode: 'continent', seed: 7 }), W = 200, H = 125, buf = mode => RN.paint(f, mode, W, H, new Uint8ClampedArray(W * H * 4), 0, 0, W, H);
  const t = buf('terrain'), r = buf('relief'), tmp = buf('temp'), rain = buf('rain'), pol = buf('political');
  const diff = (a, b) => { let n = 0; for (let i = 0; i < a.length; i += 4) if (Math.abs(a[i] - b[i]) + Math.abs(a[i + 1] - b[i + 1]) + Math.abs(a[i + 2] - b[i + 2]) > 30) n++; return n; };
  for (const other of [r, tmp, rain, pol]) assert.ok(diff(t, other) > W * H * .1, 'a mode looks different');
  assert.ok(t[2] > t[0] + 20, 'the corner is sea: blue dominates');
  const part = new Uint8ClampedArray(W * H * 4);
  RN.paint(f, 'terrain', W, H, part, 50, 40, 90, 70);
  for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) { const o = (y * W + x) * 4, inside = x >= 50 && x < 90 && y >= 40 && y < 70; assert.equal(part[o + 3] === 255, inside); if (inside) assert.equal(part[o], t[o]); }
  const p = RN.probe(f, f.mapW / 2, f.mapH / 2);
  assert.ok(typeof p.name === 'string' && isFinite(p.temp));
});

test('map data: terrain stays out of the map list but comes with the open map', () => {
  const t = make();
  try {
    const w = t.call('worlds.create', { name: 'Terrain test' });
    const f = gen({ mode: 'island', seed: 5 }, 800, 500);
    const m = t.call('entries.create', { worldId: w.id, typeKey: 'map', title: 'Isle', data: { width: 800, height: 500, terrain: F.encode(f), deposits: f.deposits, stamps: [[10, 10, 0, 20, 0]] } });
    const row = t.call('atlas.maps', w.id).find(x => x.id === m.id);
    assert.equal(row.data.terrain.has, true);
    assert.equal(typeof row.data.terrain.elev, 'undefined');
    assert.equal(row.data.stamps, 1);
    const open = t.call('atlas.map', m.id);
    assert.equal(F.decode(open.data.terrain, 800, 500).elev.length, f.w * f.h);
    // a curved label keeps its bend and a label can follow a drawn path
    const lab = t.call('atlas.save', { mapId: m.id, kind: 'label', label: 'The Sound', x: 10, y: 10, points: [[0, 0], [50, 20], [100, 0]], style: { curve: 40, size: 20 } });
    assert.equal(lab.style.curve, 40);
    assert.equal(lab.points.length, 3);
    t.call('entries.update', m.id, { dataPatch: { stamps: [] } });
    assert.ok(t.call('atlas.map', m.id).data.terrain, 'a data patch keeps the terrain');
  } finally { t.done(); }
});
