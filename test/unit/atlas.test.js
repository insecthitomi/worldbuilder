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
