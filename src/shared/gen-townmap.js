/* Town map: a procedural plan of a generated town as an SVG image — terrain, sea/river/lake, fields or trees, walls with
   towers and gates, roads and streets, building blocks, labelled districts, numbered landmarks with a legend, compass and
   scale. Deterministic from the town data and a seed. townMap(d, seed) → { svg, width, height, pins: [{ loc, x, y }], feetPerPx } */
(function (root, factory) {
  const node = typeof module === 'object' && module.exports;
  const G = node ? require('./gen-core.js') : root.WBGen;
  factory(G, node ? require('./names.js') : root.WBNames);
  if (node) module.exports = G;
})(typeof self !== 'undefined' ? self : this, function (G, N) {
  'use strict';
  const W = 1600, H = 1200;
  const SIZE = {
    thorp: { R: 120, roads: [1, 2], bld: 16, side: 0, ftpx: 2, plaza: 26, wall: 0.8 },
    hamlet: { R: 170, roads: [2, 3], bld: 45, side: 2, ftpx: 2.5, plaza: 30, wall: 0.8 },
    village: { R: 240, roads: [2, 3], bld: 140, side: 5, ftpx: 3, plaza: 38, wall: 0.78 },
    town: { R: 330, roads: [3, 4], bld: 430, side: 14, ftpx: 4, plaza: 48, wall: 0.72 },
    city: { R: 430, roads: [4, 5], bld: 950, side: 30, ftpx: 6, plaza: 58, wall: 0.76 },
    metropolis: { R: 520, roads: [5, 7], bld: 1650, side: 52, ftpx: 9, plaza: 70, wall: 0.5 },
  };
  /* data colours of the map (it is an image, not UI) */
  const PAL = {
    coast: { land: '#e6dfc4', field: ['#d8dcae', '#cfd6a2', '#e0d9a6', '#c9d29b', '#dcd3a0'], roof: ['#9a6a55', '#7d7f86', '#8c8f96', '#a7735a', '#6f737b'], tree: ['#7f9e6a', '#6d8e5a'] },
    river: { land: '#e3e2c4', field: ['#d3dca6', '#c8d59c', '#dfd9a0', '#bfd096', '#d9d49a'], roof: ['#a8664c', '#9a6a55', '#b07a52', '#8a6a58', '#7d7f86'], tree: ['#7a9c62', '#688c52'] },
    hills: { land: '#e0dfc0', field: ['#d0d9a4', '#c3cf97', '#d9d5a0', '#bccb92'], roof: ['#7d7f86', '#6f737b', '#8a8577', '#9a6a55'], tree: ['#77955f', '#62804f'] },
    mountains: { land: '#dcd8c8', field: ['#cfd3ad', '#c6cba3'], roof: ['#6f737b', '#7d7f86', '#5f636b', '#857a6d'], tree: ['#5f7f58', '#4f6e4a'] },
    forest: { land: '#d9dfbf', field: ['#cfd9a2', '#c4d197', '#d6d49c'], roof: ['#8a6a58', '#7a5d4a', '#9a7656', '#6e6f63'], tree: ['#6a915a', '#5a804b', '#4d7342', '#7a9d63'] },
    plains: { land: '#e6e2c2', field: ['#dcd8a0', '#d2dba6', '#e4d699', '#c9d59c', '#e6dca8', '#d5cf8f'], roof: ['#a8664c', '#b07a52', '#9a6a55', '#c08a5a'], tree: ['#7e9d64', '#6d8f58'] },
    desert: { land: '#ecdcb4', field: ['#d9d3a0', '#cfd49b'], roof: ['#e3d3b0', '#d8c49c', '#cdb88e', '#e8dcc0'], tree: ['#6f9455', '#5f844a'] },
    tundra: { land: '#eceff0', field: ['#e1e6e2', '#dde3dc'], roof: ['#5f636b', '#6f737b', '#7a6a5c', '#55595f'], tree: ['#4f6b55', '#5b7a60'] },
    swamp: { land: '#d3d8b2', field: ['#c7cf9f', '#bfc895'], roof: ['#7a6a52', '#6e6249', '#857356', '#6f737b'], tree: ['#5f7f52', '#6c8a58'] },
    island: { land: '#e8e0c0', field: ['#d4dba4', '#cad69a', '#dcd8a2'], roof: ['#b06a4c', '#c08a5a', '#a8664c', '#d8c8a8'], tree: ['#6f9a5c', '#5e8a4e'] },
  };
  const INK = '#4a3b2a', PAPER = '#f3ead2', WATER = '#9cc3d3', DEEP = '#7eaec4', SAND = '#efe2b6', ROAD = '#d9c7a1', ROAD_EDGE = '#b39d78', STONE = '#8f8a80', STONE_D = '#6d685f';
  const f1 = v => Math.round(v * 10) / 10;
  const esc = G.esc;

  G.townMap = function townMap(d, seed) {
    const rng = N.rng('townmap:' + seed), T = G.tools(rng);
    const sz = SIZE[d.size] || SIZE.town, pal = PAL[d.terrain] || PAL.plains;
    let R = sz.R;
    const cx = W / 2 + T.int(-50, 50), cy = H / 2 + T.int(-30, 40);
    const out = { sea: [], deep: [], lakes: [], rivers: [], beach: [], fields: [], trees: [], hachures: [], peaks: [], dunes: [], reeds: [], snow: [], roads: [], streets: [], bridges: [], piers: [], walls: [], towers: [], gates: [], blds: [], marks: [], labels: [], special: [] };
    const sin = Math.sin, cos = Math.cos, PI = Math.PI;
    const dist = (ax, ay, bx, by) => Math.hypot(ax - bx, ay - by);
    function segDist(px, py, ax, ay, bx, by) { const dx = bx - ax, dy = by - ay, l = dx * dx + dy * dy; let u = l ? ((px - ax) * dx + (py - ay) * dy) / l : 0; u = Math.max(0, Math.min(1, u)); return Math.hypot(px - (ax + u * dx), py - (ay + u * dy)); }
    function lineDist(px, py, pts) { let m = Infinity; for (let i = 1; i < pts.length; i++) { const v = segDist(px, py, pts[i - 1][0], pts[i - 1][1], pts[i][0], pts[i][1]); if (v < m) m = v; } return m; }
    /** a grid of line segments: distance queries look only at nearby cells */
    function segIndex(cell = 48) {
      const g = new Map();
      return {
        add(pts, half, tag) {
          for (let i = 1; i < pts.length; i++) {
            const a = pts[i - 1], b = pts[i], s = [a[0], a[1], b[0], b[1], half, tag];
            for (let x = Math.floor(Math.min(a[0], b[0]) / cell); x <= Math.floor(Math.max(a[0], b[0]) / cell); x++)
              for (let y = Math.floor(Math.min(a[1], b[1]) / cell); y <= Math.floor(Math.max(a[1], b[1]) / cell); y++) { const k = x + ',' + y; if (!g.has(k)) g.set(k, []); g.get(k).push(s); }
          }
        },
        /** → [distance to the edge, segment] within reach (Infinity when nothing is near) */
        near(px, py, reach = 96) {
          let m = Infinity, best = null;
          const r = Math.ceil(reach / cell), i0 = Math.floor(px / cell), j0 = Math.floor(py / cell);
          for (let i = i0 - r; i <= i0 + r; i++) for (let j = j0 - r; j <= j0 + r; j++) {
            const c = g.get(i + ',' + j);
            if (c) for (const s of c) { const v = segDist(px, py, s[0], s[1], s[2], s[3]) - s[4]; if (v < m) { m = v; best = s; } }
          }
          return [m, best];
        },
      };
    }
    const roadIdx = segIndex(48), riverIdx = segIndex(48);

    /* ---------------- water ---------------- */
    let seaAt = () => false, lakeAt = () => false, riverAt = () => false;
    let coast = null;   // { nx, ny, px, py, D(u) }
    const terr = d.terrain;
    if (terr === 'coast') {
      const a = T.f() * 2 * PI, nx = cos(a), ny = sin(a), px = -ny, py = nx;
      const ph = [T.f() * 6.3, T.f() * 6.3, T.f() * 6.3], dC = R * (0.5 + T.f() * 0.2), bay = R * (0.18 + T.f() * 0.14);
      const D = u => dC + 38 * sin(u / 170 + ph[0]) + 20 * sin(u / 61 + ph[1]) + 8 * sin(u / 23 + ph[2]) - bay * Math.exp(-((u / (R * 0.55)) ** 2));
      coast = { nx, ny, px, py, D };
      seaAt = (x, y) => { const dx = x - cx, dy = y - cy; return dx * nx + dy * ny > D(dx * px + dy * py); };
      const poly = off => { const pts = []; for (let u = -2400; u <= 2400; u += 14) { const t = D(u) + off; pts.push([cx + nx * t + px * u, cy + ny * t + py * u]); } pts.push([cx + nx * 3200 + px * 2400, cy + ny * 3200 + py * 2400], [cx + nx * 3200 - px * 2400, cy + ny * 3200 - py * 2400]); return pts; };
      out.sea.push(poly(0)); out.deep.push(poly(46)); out.beach.push(poly(0).slice(0, -2));
      out.waves = [poly(18).slice(0, -2), poly(32).slice(0, -2)];
    } else if (terr === 'island') {
      const Ri = Math.min(560, Math.max(R * 1.2 + 90, 300));
      R = Math.min(R, Ri * 0.8);
      const ph = [T.f() * 6.3, T.f() * 6.3, T.f() * 6.3];
      const LR = a => Ri * (1 + 0.11 * sin(3 * a + ph[0]) + 0.07 * sin(5 * a + ph[1]) + 0.035 * sin(11 * a + ph[2]));
      seaAt = (x, y) => dist(x, y, cx, cy) > LR(Math.atan2(y - cy, x - cx));
      const ring = off => { const pts = []; for (let a = 0; a < 2 * PI; a += 0.02) pts.push([cx + cos(a) * (LR(a) + off), cy + sin(a) * (LR(a) + off)]); return pts; };
      out.island = { land: ring(0), shallow: ring(34), waves: [ring(14), ring(26)] };
      coast = { radial: true, LR };
    }
    // lakes: tundra lake, desert oasis, swamp pools
    const lakes = [];
    const blob = (x, y, r, k) => { const ph = [T.f() * 6.3, T.f() * 6.3]; const pts = []; for (let a = 0; a < 2 * PI; a += 0.12) { const rr = r * (1 + 0.18 * sin(3 * a + ph[0]) + (k || 0.08) * sin(7 * a + ph[1])); pts.push([x + cos(a) * rr, y + sin(a) * rr]); } return { x, y, r, pts }; };
    if (terr === 'tundra') { const a = T.f() * 2 * PI, r = 170 + T.f() * 90; lakes.push(blob(cx + cos(a) * (R * 0.75 + r), cy + sin(a) * (R * 0.75 + r), r)); }
    if (terr === 'desert') { const a = T.f() * 2 * PI; lakes.push(blob(cx + cos(a) * R * 0.32, cy + sin(a) * R * 0.32, 26 + R * 0.06)); }
    if (terr === 'swamp') for (let i = 0; i < 22; i++) { const a = T.f() * 2 * PI, rr = R * (0.7 + T.f() * 1.6); lakes.push(blob(cx + cos(a) * rr, cy + sin(a) * rr, 18 + T.f() * 55, 0.15)); }
    out.lakes = lakes;
    const inBlob = (x, y, b) => { if (dist(x, y, b.x, b.y) > b.r * 1.35) return false; let inside = false; const p = b.pts; for (let i = 0, j = p.length - 1; i < p.length; j = i++) { if ((p[i][1] > y) !== (p[j][1] > y) && x < (p[j][0] - p[i][0]) * (y - p[i][1]) / (p[j][1] - p[i][1]) + p[i][0]) inside = !inside; } return inside; };
    lakeAt = (x, y) => lakes.some(b => inBlob(x, y, b));
    // rivers
    const hasRiver = terr === 'river' || (terr === 'coast' && T.chance(0.45)) || terr === 'swamp' || (terr === 'plains' && T.chance(0.3)) || (terr === 'forest' && T.chance(0.35)) || (terr === 'hills' && T.chance(0.3));
    if (hasRiver) {
      const wR = terr === 'river' ? { thorp: 16, hamlet: 18, village: 22, town: 28, city: 36, metropolis: 44 }[d.size] : terr === 'swamp' ? 10 : 14;
      let b;
      if (coast && !coast.radial) b = Math.atan2(coast.ny, coast.nx) + (T.f() - 0.5) * 0.7;   // flows toward the sea
      else b = T.f() * 2 * PI;
      const dx = cos(b), dy = sin(b), qx = -dy, qy = dx, off = (T.f() - 0.5) * R * 0.3, q = [T.f() * 6.3, T.f() * 6.3];
      const pts = [];
      for (let s = -1500; s <= 1500; s += 16) {
        const m = 70 * sin(s / 270 + q[0]) + 24 * sin(s / 95 + q[1]);
        const x = cx + dx * s + qx * (off + m), y = cy + dy * s + qy * (off + m);
        if (seaAt(x, y)) { pts.push([x, y]); break; }
        pts.push([x, y]);
      }
      out.rivers.push({ pts, w: wR });
      riverIdx.add(pts, wR / 2);
      riverAt = (x, y, pad = 0) => riverIdx.near(x, y, 60)[0] < pad;
    }
    const wet = (x, y, pad = 0) => seaAt(x, y) || lakeAt(x, y) || riverAt(x, y, pad);

    /* ---------------- roads ---------------- */
    const nRoads = T.between(sz.roads), a0 = T.f() * 2 * PI;
    const roadW = { thorp: 7, hamlet: 8, village: 9, town: 10, city: 12, metropolis: 13 }[d.size] || 10;
    const inside = (x, y, m = 0) => x > -m && y > -m && x < W + m && y < H + m;
    function grow(x, y, dir, { step = 34, wobble = 0.22, maxLen = 4000, stopNear = null, w }) {
      const pts = [[x, y]];
      let len = 0, crossing = false, crossStart = null;
      while (len < maxLen) {
        if (!crossing) dir += (T.f() - 0.5) * wobble;
        const nx = x + cos(dir) * step, ny = y + sin(dir) * step;
        if (!inside(nx, ny, 30)) { pts.push([nx, ny]); break; }
        if (seaAt(nx, ny) || lakeAt(nx, ny)) break;
        const inRiver = riverAt(nx, ny, 2);
        if (inRiver && !crossing) { crossing = true; crossStart = [x, y]; }
        if (!inRiver && crossing) { crossing = false; out.bridges.push({ a: crossStart, b: [nx, ny], w: w + 6 }); }
        if (stopNear && len > step * 1.5 && stopNear(nx, ny)) { pts.push([nx, ny]); break; }
        x = nx; y = ny; pts.push([x, y]); len += step;
      }
      return pts;
    }
    for (let i = 0; i < nRoads; i++) {
      let ang = a0 + i * 2 * PI / nRoads + (T.f() - 0.5) * 0.5;
      if (coast && !coast.radial) { const toSea = cos(ang - Math.atan2(coast.ny, coast.nx)); if (toSea > 0.45) ang += PI * (T.chance(0.5) ? 0.55 : -0.55); }
      // a road blocked at once by water tries a few other headings
      for (let k = 0; k < 4; k++) {
        const pts = grow(cx, cy, ang + k * 0.7 * (k % 2 ? 1 : -1), { w: roadW, maxLen: coast && coast.radial ? R * 1.3 : 4000 });
        if (pts.length > 4) { out.roads.push({ pts, w: roadW }); roadIdx.add(pts, roadW / 2); break; }
      }
    }
    // a road down to the water for ports
    if (coast && !coast.radial) {
      const pts = grow(cx, cy, Math.atan2(coast.ny, coast.nx) + (T.f() - 0.5) * 0.3, { w: roadW * 0.8, wobble: 0.1 });
      if (pts.length > 1) { out.roads.push({ pts, w: roadW * 0.8, port: true }); roadIdx.add(pts, roadW * 0.4); }
    }
    const roadDist = (x, y, reach = 96) => roadIdx.near(x, y, reach)[0];
    // side streets
    let streets = sz.side, tries = 0;
    while (streets > 0 && tries++ < sz.side * 8 && out.roads.length) {
      const r = T.pick(out.roads), k = T.int(1, Math.max(1, r.pts.length - 2)), p = r.pts[k];
      if (!p || dist(p[0], p[1], cx, cy) > R * 0.92 || dist(p[0], p[1], cx, cy) < sz.plaza) continue;
      const q = r.pts[Math.min(r.pts.length - 1, k + 1)], dir = Math.atan2(q[1] - p[1], q[0] - p[0]) + (T.chance(0.5) ? 1 : -1) * (PI / 2 + (T.f() - 0.5) * 0.6);
      const w = roadW * 0.6;
      const pts = grow(p[0], p[1], dir, { step: 24, wobble: 0.3, maxLen: 40 + T.f() * R * 0.55, w, stopNear: (x, y) => roadDist(x, y) < 6 || dist(x, y, cx, cy) > R * 1.02 });
      if (pts.length > 2) { out.streets.push({ pts, w }); roadIdx.add(pts, w / 2); streets--; }
    }

    /* ---------------- districts ---------------- */
    const dists = (d.districts || []).map((x, i) => {
      if (i === 0) return { x: cx, y: cy, n: 0, sx: 0, sy: 0 };
      const k = (d.districts.length - 1), a = a0 + PI / k + (i - 1) * 2 * PI / k + (T.f() - 0.5) * 0.4;
      let rr = R * (0.45 + T.f() * 0.25), x0 = cx + cos(a) * rr, y0 = cy + sin(a) * rr;
      while (wet(x0, y0) && rr > R * 0.15) { rr -= 12; x0 = cx + cos(a) * rr; y0 = cy + sin(a) * rr; }
      // docks districts sit by the water
      if (x.kind === 'docks' && coast && !coast.radial) { const u = (T.f() - 0.5) * R * 0.6; const t0 = coast.D(u) - 26; x0 = cx + coast.nx * t0 + coast.px * u; y0 = cy + coast.ny * t0 + coast.py * u; }
      return { x: x0, y: y0, n: 0, sx: 0, sy: 0 };
    });
    if (!dists.length) dists.push({ x: cx, y: cy, n: 0, sx: 0, sy: 0 });
    const districtOf = (x, y) => { let best = 0, bd = Infinity; dists.forEach((s, i) => { const v = dist(x, y, s.x, s.y) * (i === 0 ? 1.25 : 1); if (v < bd) { bd = v; best = i; } }); return best; };
    // each district roofs its houses in its own two colours
    const shade = (hex, k) => { const n = parseInt(hex.slice(1), 16); const ch = s => Math.max(0, Math.min(255, Math.round(((n >> s) & 255) * k))); return '#' + [16, 8, 0].map(s => ch(s).toString(16).padStart(2, '0')).join(''); };
    const roofs = dists.map(() => T.sample(pal.roof, 2));

    /* ---------------- buildings ---------------- */
    const rings = d.walls || 0, wallPlan = rings ? R * (rings === 2 ? 0.86 : sz.wall) : 0;
    const CELL = 22, grid = new Map();
    const key = (i, j) => i + ',' + j;
    const plazaR = sz.plaza;
    const dens = r => { let v = Math.max(0, Math.min(1, 1.12 - (r / R) ** 1.5)); if (rings) v = r < wallPlan ? Math.max(v, 0.9) : v * 0.5; return v; };
    function free(x, y, rad) {
      const i0 = Math.floor(x / CELL), j0 = Math.floor(y / CELL);
      for (let i = i0 - 2; i <= i0 + 2; i++) for (let j = j0 - 2; j <= j0 + 2; j++) { const c = grid.get(key(i, j)); if (c) for (const b of c) if (dist(x, y, b.x, b.y) < (rad + b.r) * 0.8) return false; }
      return true;
    }
    function place(x, y, w, h, a) {
      const rad = Math.hypot(w, h) / 2;
      if (!inside(x, y, -12) || dist(x, y, cx, cy) < plazaR + rad * 0.6) return false;
      const c = cos(a), s = sin(a), hw = w / 2, hh = h / 2;
      const corners = [[-hw, -hh], [hw, -hh], [hw, hh], [-hw, hh]].map(([u, v]) => [x + u * c - v * s, y + u * s + v * c]);
      if (wet(x, y, 3) || corners.some(p => wet(p[0], p[1], 2))) return false;
      if (roadDist(x, y, 40) < Math.min(w, h) / 2 + 1.2) return false;
      if (corners.some(p => roadDist(p[0], p[1], 30) < 0.8)) return false;
      if (!free(x, y, rad)) return false;
      const di = districtOf(x, y);
      const b = { x, y, r: rad, w, h, a, pts: corners, d: di, col: shade(T.pick(roofs[di] || pal.roof), 0.88 + T.f() * 0.22) };
      const k = key(Math.floor(x / CELL), Math.floor(y / CELL));
      if (!grid.has(k)) grid.set(k, []);
      grid.get(k).push(b);
      out.blds.push(b);
      return b;
    }
    const target = sz.bld;
    // frontage slots along every road and street, filled from the centre outward so the town grows evenly
    const slots = [];
    for (const r of out.roads.concat(out.streets)) {
      for (let i = 1; i < r.pts.length; i++) {
        const [ax, ay] = r.pts[i - 1], [bx, by] = r.pts[i];
        const L = dist(ax, ay, bx, by), a = Math.atan2(by - ay, bx - ax), nxv = -sin(a), nyv = cos(a);
        for (let s = 3; s < L; ) {
          const x = ax + cos(a) * s, y = ay + sin(a) * s, rr = dist(x, y, cx, cy);
          if (rr > R * 1.15) { s += 24; continue; }
          const core = rr < R * 0.5 || (rings && rr < wallPlan);
          const w = core ? T.int(10, 15) : T.int(11, 18);
          for (const side of [1, -1]) {
            const h = core ? T.int(11, 16) : T.int(9, 14), off = r.w / 2 + 2 + h / 2;
            slots.push({ x: x + nxv * off * side, y: y + nyv * off * side, w: w - 1.2, h, a, rr, pri: rr / R + T.f() * 0.28 });
            if (core) { const h2 = T.int(9, 14), o2 = off + h / 2 + h2 / 2 + 2; slots.push({ x: x + nxv * o2 * side, y: y + nyv * o2 * side, w: w - 2, h: h2, a: a + (T.f() - 0.5) * 0.12, rr, pri: rr / R + 0.12 + T.f() * 0.3 }); }
          }
          s += w + (core ? 0.5 : T.int(1, 7));
        }
      }
    }
    slots.sort((p, q) => p.pri - q.pri);
    for (const sl of slots) { if (out.blds.length >= target) break; if (T.f() > dens(sl.rr)) continue; place(sl.x, sl.y, sl.w, sl.h, sl.a); }
    // infill near streets
    for (let k = 0; out.blds.length < target && k < target * 6; k++) {
      const rr = R * Math.sqrt(T.f()) * 0.95, a = T.f() * 2 * PI, x = cx + cos(a) * rr, y = cy + sin(a) * rr;
      if (T.f() > dens(rr)) continue;
      const [bd, best] = roadIdx.near(x, y, 70);
      if (!best || bd > 64) continue;
      place(x, y, T.int(9, 15), T.int(9, 14), Math.atan2(best[3] - best[1], best[2] - best[0]) + (T.chance(0.15) ? PI / 2 : 0));
    }
    // a few farmsteads beyond the town
    for (let k = 0; k < 40; k++) {
      const rr = R * (1.1 + T.f() * 0.9), a = T.f() * 2 * PI, x = cx + cos(a) * rr, y = cy + sin(a) * rr;
      if (roadDist(x, y, 48) < 40 && T.chance(0.35)) place(x, y, T.int(10, 16), T.int(9, 13), T.f() * PI);
    }

    /* ---------------- walls, fitted to the built-up area ---------------- */
    const wallRad = [];
    if (rings) {
      // the wall follows the built-up area: each vertex sits just beyond the houses in its direction
      const polar = out.blds.map(b => [Math.atan2(b.y - cy, b.x - cx), dist(b.x, b.y, cx, cy)]).filter(p => p[1] < R * 1.05);
      const n = 12 + Math.round(wallPlan / 40), minR = plazaR + 44, fit = [];
      for (let i = 0; i < n; i++) {
        const a = i * 2 * PI / n, half = PI / n * 1.4;
        const ds = polar.filter(p => Math.abs(Math.atan2(sin(p[0] - a), cos(p[0] - a))) < half).map(p => p[1]).sort((x, y) => x - y);
        const q = ds.length ? ds[Math.floor(ds.length * 0.88)] : minR;
        fit.push(Math.max(minR, Math.min(wallPlan, q + 14)));
      }
      for (let k = 0; k < 2; k++) for (let i = 0; i < n; i++) fit[i] = (fit[(i + n - 1) % n] + 2 * fit[i] + fit[(i + 1) % n]) / 4;
      const shapes = rings === 2 ? [fit.map(r => Math.max(minR, r * 0.55)), fit] : [fit];
      for (const radii of shapes) {
        const verts = [];
        for (let i = 0; i < n; i++) { const a = i * 2 * PI / n + (T.f() - 0.5) * 0.12; const rr = radii[i] * (1 + (T.f() - 0.5) * 0.06); verts.push([cx + cos(a) * rr, cy + sin(a) * rr]); }
        wallRad.push(radii.reduce((s, r) => s + r, 0) / n);
        const kind = d.wallKind || 'stone';
        for (let i = 0; i < n; i++) {
          let A = verts[i], B = verts[(i + 1) % n];
          const wa = wet(A[0], A[1]), wb = wet(B[0], B[1]);
          if (wa && wb) continue;
          if (wa || wb) { // clip to the shore by bisection
            let lo = wa ? A : B, hi = wa ? B : A;
            for (let k = 0; k < 14; k++) { const m = [(lo[0] + hi[0]) / 2, (lo[1] + hi[1]) / 2]; if (wet(m[0], m[1])) lo = m; else hi = m; }
            if (wa) A = hi; else B = hi;
          }
          out.walls.push({ a: A, b: B, kind });
          if (!wet(verts[i][0], verts[i][1])) out.towers.push({ x: verts[i][0], y: verts[i][1], kind });
        }
      }
      // gates where roads cross a wall
      const cross = (p1, p2, p3, p4) => { const d1 = (p2[0] - p1[0]) * (p4[1] - p3[1]) - (p2[1] - p1[1]) * (p4[0] - p3[0]); if (!d1) return null; const ua = ((p3[0] - p1[0]) * (p4[1] - p3[1]) - (p3[1] - p1[1]) * (p4[0] - p3[0])) / d1, ub = ((p3[0] - p1[0]) * (p2[1] - p1[1]) - (p3[1] - p1[1]) * (p2[0] - p1[0])) / d1; return ua >= 0 && ua <= 1 && ub >= 0 && ub <= 1 ? [p1[0] + ua * (p2[0] - p1[0]), p1[1] + ua * (p2[1] - p1[1]), Math.atan2(p2[1] - p1[1], p2[0] - p1[0])] : null; };
      for (const r of out.roads) for (let i = 1; i < r.pts.length; i++) for (const w of out.walls) { const c = cross(r.pts[i - 1], r.pts[i], w.a, w.b); if (c) out.gates.push({ x: c[0], y: c[1], a: c[2], kind: w.kind }); }
      // nothing is built on the wall itself
      out.blds = out.blds.filter(b => !out.walls.some(w => segDist(b.x, b.y, w.a[0], w.a[1], w.b[0], w.b[1]) < b.r * 0.75 + 5));
    }
    for (const b of out.blds) { const s = dists[b.d]; if (s) { s.n++; s.sx += b.x; s.sy += b.y; } }

    /* ---------------- landmarks ---------------- */
    const pins = [];
    const locs = d.locations || [];
    const usedB = new Set();
    function nearestBuilding(x, y, pred) { let best = null, bd = Infinity; for (const b of out.blds) { if (usedB.has(b) || (pred && !pred(b))) continue; const v = dist(x, y, b.x, b.y); if (v < bd) { bd = v; best = b; } } return best; }
    const shorePoint = (u) => { if (!coast || coast.radial) return null; const t0 = coast.D(u) - 4; return [cx + coast.nx * t0 + coast.px * u, cy + coast.ny * t0 + coast.py * u]; };
    locs.forEach((l, i) => {
      let x, y;
      const s = dists[l.district] || dists[0];
      const anchor = s && s.n ? [s.sx / s.n, s.sy / s.n] : [cx, cy];
      if (l.kind === 'market') { x = cx; y = cy; out.special.push({ kind: 'market', x, y }); }
      else if (l.kind === 'docks' || l.kind === 'shipwright') {
        const sp = shorePoint((T.f() - 0.5) * R * 0.5);
        if (sp) { x = sp[0]; y = sp[1]; for (let k = 0; k < (l.kind === 'docks' ? 4 : 1); k++) { const p = shorePoint((k - 1.5) * 34 + (sp[0] - cx) * coast.px + (sp[1] - cy) * coast.py); if (p) out.piers.push({ x: p[0], y: p[1], a: Math.atan2(coast.ny, coast.nx), len: l.kind === 'docks' ? 50 + T.f() * 40 : 26 }); } }
        else if (out.rivers.length) { const r = out.rivers[0], k = Math.max(0, Math.min(r.pts.length - 2, r.pts.findIndex(p => dist(p[0], p[1], cx, cy) < R * 0.6))); const p = r.pts[k], q = r.pts[k + 1]; const a = Math.atan2(q[1] - p[1], q[0] - p[0]) + PI / 2; x = p[0] + cos(a) * (r.w / 2 + 4); y = p[1] + sin(a) * (r.w / 2 + 4); out.piers.push({ x, y, a: a + PI, len: r.w * 0.45 }); }
        else { const b = nearestBuilding(anchor[0], anchor[1]); if (b) { usedB.add(b); x = b.x; y = b.y; } }
      } else if (l.kind === 'lighthouse') {
        const sp = shorePoint((T.chance(0.5) ? 1 : -1) * R * (0.8 + T.f() * 0.3)) || (coast && coast.radial ? [cx + cos(a0) * coast.LR(a0) * 0.97, cy + sin(a0) * coast.LR(a0) * 0.97] : [cx + R, cy]);
        x = sp[0]; y = sp[1]; out.special.push({ kind: 'lighthouse', x, y });
      } else if (l.kind === 'keep') {
        const ang = coast && !coast.radial ? Math.atan2(-coast.ny, -coast.nx) + (T.f() - 0.5) : T.f() * 2 * PI;
        let rr = R * 0.32; x = cx + cos(ang) * rr; y = cy + sin(ang) * rr;
        while (wet(x, y, 20) && rr > 10) { rr -= 10; x = cx + cos(ang) * rr; y = cy + sin(ang) * rr; }
        // clear the ground for it
        out.blds = out.blds.filter(b => dist(b.x, b.y, x, y) > 34 || (usedB.has(b)));
        out.special.push({ kind: 'keep', x, y, a: ang });
      } else if (l.kind === 'graveyard') {
        const ang = T.f() * 2 * PI; let rr = (wallRad.length ? wallRad[wallRad.length - 1] : R * 0.8) + 40;
        x = cx + cos(ang) * rr; y = cy + sin(ang) * rr;
        for (let k = 0; k < 12 && (wet(x, y, 30) || roadDist(x, y) < 26); k++) { const a2 = ang + k * 0.5; x = cx + cos(a2) * rr; y = cy + sin(a2) * rr; }
        out.special.push({ kind: 'graveyard', x, y, a: T.f() * PI });
      } else {
        const b = nearestBuilding(anchor[0] + T.int(-30, 30), anchor[1] + T.int(-30, 30));
        if (b) {
          usedB.add(b); x = b.x; y = b.y;
          if (['temple', 'guildhall', 'library', 'theatre', 'bathhouse', 'tower', 'countinghouse', 'arena', 'clocktower', 'almshouse', 'inn'].includes(l.kind)) {
            b.big = l.kind; b.w *= l.kind === 'tower' || l.kind === 'clocktower' ? 1 : 1.5; b.h *= l.kind === 'tower' ? 1 : 1.4;
            const c = cos(b.a), sn = sin(b.a), hw = b.w / 2, hh = b.h / 2;
            b.pts = [[-hw, -hh], [hw, -hh], [hw, hh], [-hw, hh]].map(([u, v]) => [b.x + u * c - v * sn, b.y + u * sn + v * c]);
          }
          b.mark = true;
        } else { x = anchor[0]; y = anchor[1]; }
      }
      if (x != null) pins.push({ loc: i, x: f1(x), y: f1(y) });
    });

    /* ---------------- fields, trees and terrain marks ---------------- */
    const fieldP = { plains: 0.9, river: 0.85, hills: 0.55, coast: 0.62, island: 0.5, forest: 0.3, swamp: 0.12, desert: 0, tundra: 0, mountains: 0.25 }[terr] || 0.5;
    if (fieldP) {
      const fa = T.f() * PI, cs = 58 + T.f() * 26, ca = cos(fa), sa = sin(fa);
      for (let i = -18; i <= 18; i++) for (let j = -14; j <= 14; j++) {
        const u = i * cs, v = j * cs, x = cx + u * ca - v * sa, y = cy + u * sa + v * ca;
        if (!inside(x, y, 60)) continue;
        const rr = dist(x, y, cx, cy);
        if (rr < R * 0.86 || T.f() > fieldP * (terr === 'forest' ? Math.max(0, 1.6 - rr / R) : 1)) continue;
        if (wet(x, y, 8) || roadDist(x, y) < 12) continue;
        const w = cs * (0.86 + T.f() * 0.12), h = cs * (0.5 + T.f() * 0.45);
        const pts = [[-w / 2, -h / 2], [w / 2, -h / 2], [w / 2, h / 2], [-w / 2, h / 2]].map(([p, q]) => [x + p * ca - q * sa, y + p * sa + q * ca]);
        if (pts.some(p => wet(p[0], p[1], 4) || roadDist(p[0], p[1]) < 3)) continue;
        out.fields.push({ pts, col: T.pick(pal.field), furrow: T.chance(0.45) ? fa + (T.chance(0.5) ? 0 : PI / 2) : null, x, y, w, h });
      }
    }
    const treeN = { forest: 1700, swamp: 380, hills: 160, river: 180, plains: 90, coast: 110, island: 260, mountains: 260, tundra: 160, desert: 26 }[terr] || 100;
    const clumps = [];
    for (let i = 0; i < Math.ceil(treeN / 18); i++) { const a = T.f() * 2 * PI, rr = R * (0.95 + T.f() * 2); clumps.push([cx + cos(a) * rr, cy + sin(a) * rr, 40 + T.f() * (terr === 'forest' ? 160 : 70)]); }
    for (let i = 0; i < treeN; i++) {
      let x, y;
      if (terr === 'forest' && T.chance(0.55)) { x = T.f() * W; y = T.f() * H; }
      else if (terr === 'desert' && lakes[0]) { const a = T.f() * 2 * PI, rr = lakes[0].r * (1.1 + T.f() * 0.8); x = lakes[0].x + cos(a) * rr; y = lakes[0].y + sin(a) * rr; }
      else { const c = T.pick(clumps), a = T.f() * 2 * PI, rr = c[2] * Math.sqrt(T.f()); x = c[0] + cos(a) * rr; y = c[1] + sin(a) * rr; }
      if (!inside(x, y, 10) || dist(x, y, cx, cy) < R * (terr === 'forest' ? 0.98 : 0.9) || wet(x, y, 6) || roadDist(x, y) < 7 || out.fields.some(f => dist(x, y, f.x, f.y) < f.h * 0.42)) continue;
      out.trees.push({ x, y, r: terr === 'tundra' || terr === 'mountains' ? 5 + T.f() * 3 : 6 + T.f() * 6, col: T.pick(pal.tree), kind: terr === 'tundra' || terr === 'mountains' ? 'pine' : terr === 'desert' || terr === 'island' && T.chance(0.4) ? 'palm' : 'round' });
    }
    if (terr === 'hills' || terr === 'mountains') for (let i = 0; i < 220; i++) { const x = T.f() * W, y = T.f() * H; if (dist(x, y, cx, cy) > R * 1.05 && !wet(x, y, 6) && roadDist(x, y) > 10) out.hachures.push([x, y, 10 + T.f() * 14]); }
    if (terr === 'mountains') {
      const edges = T.sample([0, 1, 2, 3], 2);
      for (let i = 0; i < 46; i++) {
        const e = T.pick(edges), along = T.f(), depth = T.f() * 170;
        const x = e === 0 ? along * W : e === 1 ? W - depth : e === 2 ? along * W : depth, y = e === 0 ? depth : e === 1 ? along * H : e === 2 ? H - depth : along * H;
        if (dist(x, y, cx, cy) > R * 1.05) out.peaks.push([x, y, 34 + T.f() * 46]);
      }
      out.peaks.sort((a, b) => a[1] - b[1]);
    }
    if (terr === 'desert') for (let i = 0; i < 140; i++) { const x = T.f() * W, y = T.f() * H; if (dist(x, y, cx, cy) > R * 1.0 && roadDist(x, y) > 10 && !wet(x, y, 10)) out.dunes.push([x, y, 30 + T.f() * 50]); }
    if (terr === 'swamp') for (let i = 0; i < 260; i++) { const b = T.pick(lakes), a = T.f() * 2 * PI, rr = b.r * (1.05 + T.f() * 0.6), x = b.x + cos(a) * rr, y = b.y + sin(a) * rr; if (!wet(x, y, 2) && dist(x, y, cx, cy) > R * 0.85) out.reeds.push([x, y]); }
    if (terr === 'tundra') for (let i = 0; i < 70; i++) { const x = T.f() * W, y = T.f() * H; if (dist(x, y, cx, cy) > R * 0.9) out.snow.push([x, y, 30 + T.f() * 80, 12 + T.f() * 26]); }

    /* ---------------- labels ---------------- */
    (d.districts || []).forEach((x, i) => {
      if ((d.districts || []).length < 2) return;
      const s = dists[i];
      const p = s.n >= 4 ? [s.sx / s.n, s.sy / s.n] : [s.x, s.y];
      out.labels.push({ x: p[0], y: p[1] - (i === 0 ? plazaR + 16 : 0), text: x.name });
    });

    /* ---------------- render ---------------- */
    const P = pts => pts.map(p => f1(p[0]) + ',' + f1(p[1])).join(' ');
    const path = pts => 'M' + pts.map(p => f1(p[0]) + ' ' + f1(p[1])).join('L');
    const smooth = pts => { if (pts.length < 3) return path(pts); let s = 'M' + f1(pts[0][0]) + ' ' + f1(pts[0][1]); for (let i = 1; i < pts.length - 1; i++) { const mx = (pts[i][0] + pts[i + 1][0]) / 2, my = (pts[i][1] + pts[i + 1][1]) / 2; s += 'Q' + f1(pts[i][0]) + ' ' + f1(pts[i][1]) + ' ' + f1(mx) + ' ' + f1(my); } const l = pts[pts.length - 1]; return s + 'L' + f1(l[0]) + ' ' + f1(l[1]); };
    const s = [];
    s.push(`<svg xmlns="http://www.w3.org/2000/svg" width="${W}" height="${H}" viewBox="0 0 ${W} ${H}" font-family="Georgia, 'Palatino Linotype', 'Book Antiqua', serif">`);
    s.push(`<defs><filter id="sh" x="-20%" y="-20%" width="140%" height="140%"><feDropShadow dx="1.6" dy="2" stdDeviation=".7" flood-color="#2a2014" flood-opacity=".32"/></filter>`
      + `<filter id="grain"><feTurbulence type="fractalNoise" baseFrequency=".9" numOctaves="2" seed="${Math.floor(rng() * 999)}"/><feColorMatrix values="0 0 0 0 .35  0 0 0 0 .28  0 0 0 0 .18  0 0 0 .55 0"/></filter>`
      + `<radialGradient id="vig" cx="50%" cy="50%" r="72%"><stop offset="60%" stop-color="#6b5434" stop-opacity="0"/><stop offset="100%" stop-color="#6b5434" stop-opacity=".28"/></radialGradient>`
      + `<pattern id="hatch" width="7" height="7" patternUnits="userSpaceOnUse" patternTransform="rotate(35)"><line x1="0" y1="0" x2="0" y2="7" stroke="#6b8fa0" stroke-width=".7" opacity=".35"/></pattern></defs>`);
    s.push(`<rect width="${W}" height="${H}" fill="${out.island ? DEEP : pal.land}"/>`);
    if (out.island) {
      s.push(`<polygon points="${P(out.island.shallow)}" fill="${WATER}"/>`);
      out.island.waves.forEach(w => s.push(`<polygon points="${P(w)}" fill="none" stroke="#d9ecf2" stroke-width="1.3" opacity=".55"/>`));
      s.push(`<polygon points="${P(out.island.land)}" fill="${pal.land}" stroke="${SAND}" stroke-width="12" stroke-linejoin="round"/>`);
      s.push(`<polygon points="${P(out.island.land)}" fill="${pal.land}"/>`);
    }
    // fields
    if (out.fields.length) {
      s.push('<g stroke="#a9ad7d" stroke-width="1.2">' + out.fields.map(f => `<polygon points="${P(f.pts)}" fill="${f.col}"/>`).join('') + '</g>');
      s.push('<g stroke="#b8b07a" stroke-width=".7" opacity=".55">' + out.fields.filter(f => f.furrow != null).map(f => { const c = cos(f.furrow), sn = sin(f.furrow), q = []; for (let k = -2; k <= 2; k++) { const ox = -sn * k * f.h * 0.17, oy = c * k * f.h * 0.17; q.push(`<line x1="${f1(f.x + ox - c * f.w * 0.4)}" y1="${f1(f.y + oy - sn * f.w * 0.4)}" x2="${f1(f.x + ox + c * f.w * 0.4)}" y2="${f1(f.y + oy + sn * f.w * 0.4)}"/>`); } return q.join(''); }).join('') + '</g>');
    }
    out.snow.forEach(([x, y, w, h]) => s.push(`<ellipse cx="${f1(x)}" cy="${f1(y)}" rx="${f1(w)}" ry="${f1(h)}" fill="#fff" opacity=".55"/>`));
    if (out.dunes.length) s.push('<g fill="none" stroke="#d2b67e" stroke-width="2" stroke-linecap="round" opacity=".8">' + out.dunes.map(([x, y, w]) => `<path d="M${f1(x - w / 2)} ${f1(y)}q${f1(w / 2)} ${f1(-w * 0.32)} ${f1(w)} 0"/>`).join('') + '</g>');
    if (out.hachures.length) s.push('<g fill="none" stroke="#9d8f6a" stroke-width="1.3" stroke-linecap="round" opacity=".55">' + out.hachures.map(([x, y, w]) => `<path d="M${f1(x - w / 2)} ${f1(y)}q${f1(w / 2)} ${f1(-w * 0.55)} ${f1(w)} 0"/>`).join('') + '</g>');
    // sea
    if (out.sea.length) {
      s.push(`<path d="${smooth(out.beach[0])}" fill="none" stroke="${SAND}" stroke-width="16" stroke-linecap="round"/>`);
      s.push(`<polygon points="${P(out.sea[0])}" fill="${WATER}"/>`);
      s.push(`<polygon points="${P(out.deep[0])}" fill="${DEEP}"/>`);
      s.push(`<polygon points="${P(out.deep[0])}" fill="url(#hatch)"/>`);
      (out.waves || []).forEach((w, i) => s.push(`<path d="${smooth(w)}" fill="none" stroke="#e3f1f5" stroke-width="${i ? 1 : 1.6}" opacity=".6" stroke-dasharray="${i ? '14 10' : '30 8'}"/>`));
    }
    // lakes and pools
    lakes.forEach(b => { s.push(`<polygon points="${P(b.pts)}" fill="${terr === 'tundra' ? '#cfe2ea' : WATER}" stroke="${terr === 'swamp' ? '#9fb089' : SAND}" stroke-width="5" stroke-linejoin="round"/>`); if (terr === 'tundra') s.push(`<polygon points="${P(b.pts)}" fill="url(#hatch)" opacity=".7"/>`); });
    // rivers
    out.rivers.forEach(r => { s.push(`<path d="${smooth(r.pts)}" fill="none" stroke="#86a9a0" stroke-width="${r.w + 5}" stroke-linecap="round" stroke-linejoin="round"/>`); s.push(`<path d="${smooth(r.pts)}" fill="none" stroke="${WATER}" stroke-width="${r.w}" stroke-linecap="round" stroke-linejoin="round"/>`); s.push(`<path d="${smooth(r.pts)}" fill="none" stroke="#c9e2ea" stroke-width="${Math.max(1, r.w * 0.12)}" stroke-dasharray="18 22" opacity=".7"/>`); });
    // reeds
    if (out.reeds.length) s.push('<g stroke="#6f7f4f" stroke-width="1.2" stroke-linecap="round">' + out.reeds.map(([x, y]) => `<path d="M${f1(x)} ${f1(y)}l-3 -9M${f1(x)} ${f1(y)}l0 -11M${f1(x)} ${f1(y)}l3 -9"/>`).join('') + '</g>');
    // roads (edge, then surface)
    const roadsAll = out.roads.concat(out.streets);
    s.push('<g fill="none" stroke-linecap="round" stroke-linejoin="round">' + roadsAll.map(r => `<path d="${smooth(r.pts)}" stroke="${ROAD_EDGE}" stroke-width="${f1(r.w + 3)}"/>`).join('') + roadsAll.map(r => `<path d="${smooth(r.pts)}" stroke="${ROAD}" stroke-width="${f1(r.w)}"/>`).join('') + '</g>');
    // bridges
    out.bridges.forEach(b => { const a = Math.atan2(b.b[1] - b.a[1], b.b[0] - b.a[0]), L = dist(b.a[0], b.a[1], b.b[0], b.b[1]) + 10, mx = (b.a[0] + b.b[0]) / 2, my = (b.a[1] + b.b[1]) / 2; s.push(`<rect x="${f1(-L / 2)}" y="${f1(-b.w / 2)}" width="${f1(L)}" height="${f1(b.w)}" rx="2" fill="#cbbd9e" stroke="${STONE_D}" stroke-width="1.6" transform="translate(${f1(mx)} ${f1(my)}) rotate(${f1(a * 180 / PI)})"/>`); });
    // piers
    out.piers.forEach(p => s.push(`<rect x="0" y="-3.5" width="${f1(p.len)}" height="7" fill="#a8875f" stroke="#6e5638" stroke-width="1.2" transform="translate(${f1(p.x)} ${f1(p.y)}) rotate(${f1(p.a * 180 / PI)})"/>`));
    // plaza
    const plaza = []; for (let a = 0; a < 2 * PI; a += PI / 5) { const rr = plazaR * (0.85 + T.f() * 0.25); plaza.push([cx + cos(a) * rr, cy + sin(a) * rr]); }
    s.push(`<polygon points="${P(plaza)}" fill="#e2d6b8" stroke="${ROAD_EDGE}" stroke-width="2"/>`);
    if (d.size !== 'thorp') s.push(`<circle cx="${f1(cx)}" cy="${f1(cy)}" r="${f1(plazaR * 0.16)}" fill="${WATER}" stroke="${STONE_D}" stroke-width="2"/>`);
    // graveyards and other grounds
    out.special.filter(x => x.kind === 'graveyard').forEach(g => { s.push(`<g transform="translate(${f1(g.x)} ${f1(g.y)}) rotate(${f1(g.a * 180 / PI)})"><rect x="-26" y="-18" width="52" height="36" fill="#cdd3a6" stroke="${STONE_D}" stroke-width="1.5"/>` + [[-14, -6], [0, -6], [14, -6], [-14, 8], [0, 8], [14, 8]].map(([u, v]) => `<path d="M${u} ${v - 4}v8M${u - 3} ${v - 1}h6" stroke="${INK}" stroke-width="1.3"/>`).join('') + '</g>'); });
    // buildings
    const hl = '#7a3b2e';
    s.push('<g filter="url(#sh)" stroke="#5a4a3a" stroke-width=".8">' + out.blds.map(b => `<polygon points="${P(b.pts)}" fill="${b.mark ? '#b4553f' : b.col}"${b.mark ? ` stroke="${hl}" stroke-width="1.6"` : ''}/>`).join('') + '</g>');
    // roof ridges for a hint of volume
    s.push('<g stroke="#000" stroke-opacity=".16" stroke-width=".8">' + out.blds.filter(b => b.w > 9 && !b.big).map(b => { const c = cos(b.a), sn = sin(b.a), hw = b.w / 2 - 1.5; return `<line x1="${f1(b.x - c * hw)}" y1="${f1(b.y - sn * hw)}" x2="${f1(b.x + c * hw)}" y2="${f1(b.y + sn * hw)}"/>`; }).join('') + '</g>');
    // special buildings
    out.special.forEach(x => {
      if (x.kind === 'keep') s.push(`<g transform="translate(${f1(x.x)} ${f1(x.y)}) rotate(${f1(x.a * 180 / PI)})" filter="url(#sh)"><rect x="-22" y="-22" width="44" height="44" fill="#a39d90" stroke="${STONE_D}" stroke-width="2.2"/><rect x="-11" y="-11" width="22" height="22" fill="#8b857a" stroke="${STONE_D}" stroke-width="1.6"/>` + [[-22, -22], [22, -22], [22, 22], [-22, 22]].map(([u, v]) => `<circle cx="${u}" cy="${v}" r="7.5" fill="#9a958a" stroke="${STONE_D}" stroke-width="2"/>`).join('') + '</g>');
      if (x.kind === 'lighthouse') s.push(`<g transform="translate(${f1(x.x)} ${f1(x.y)})"><circle r="26" fill="#fff6c8" opacity=".55"/><circle r="9" fill="#e9e3d2" stroke="${STONE_D}" stroke-width="2"/><circle r="3.5" fill="#e0a43a"/></g>`);
    });
    // walls, towers, gates
    if (out.walls.length) {
      const pal2 = k => (k === 'palisade' ? ['#7b5b3a', '#a98458', 4.5] : [STONE_D, '#b2ad9f', 7]);
      out.walls.forEach(w => { const [c1, c2, wd] = pal2(w.kind); s.push(`<line x1="${f1(w.a[0])}" y1="${f1(w.a[1])}" x2="${f1(w.b[0])}" y2="${f1(w.b[1])}" stroke="${c1}" stroke-width="${wd + 2.5}" stroke-linecap="round"/><line x1="${f1(w.a[0])}" y1="${f1(w.a[1])}" x2="${f1(w.b[0])}" y2="${f1(w.b[1])}" stroke="${c2}" stroke-width="${wd - 1.5}" stroke-linecap="round"/>`); });
      out.gates.forEach(g => { const [c1] = pal2(g.kind); s.push(`<g transform="translate(${f1(g.x)} ${f1(g.y)}) rotate(${f1(g.a * 180 / PI)})"><rect x="-7" y="${-roadW / 2 - 9}" width="14" height="8" fill="#a39d90" stroke="${c1}" stroke-width="1.6"/><rect x="-7" y="${roadW / 2 + 1}" width="14" height="8" fill="#a39d90" stroke="${c1}" stroke-width="1.6"/><rect x="-4" y="${-roadW / 2}" width="8" height="${roadW}" fill="${ROAD}"/></g>`); });
      out.towers.forEach(t => { const [c1, c2] = pal2(t.kind); s.push(`<circle cx="${f1(t.x)}" cy="${f1(t.y)}" r="${t.kind === 'palisade' ? 5 : 8}" fill="${c2}" stroke="${c1}" stroke-width="2.2"/>`); });
    }
    // trees
    if (out.trees.length) {
      const round = out.trees.filter(t => t.kind === 'round'), pine = out.trees.filter(t => t.kind === 'pine'), palm = out.trees.filter(t => t.kind === 'palm');
      s.push('<g>' + round.map(t => `<circle cx="${f1(t.x + 1.5)}" cy="${f1(t.y + 2)}" r="${f1(t.r)}" fill="#2a2014" opacity=".18"/>`).join('') + round.map(t => `<circle cx="${f1(t.x)}" cy="${f1(t.y)}" r="${f1(t.r)}" fill="${t.col}" stroke="#4a6a3a" stroke-width=".8"/><circle cx="${f1(t.x - t.r * 0.3)}" cy="${f1(t.y - t.r * 0.3)}" r="${f1(t.r * 0.42)}" fill="#fff" opacity=".13"/>`).join('') + '</g>');
      if (pine.length) s.push('<g stroke="#2f4630" stroke-width=".8">' + pine.map(t => `<path d="M${f1(t.x)} ${f1(t.y - t.r * 1.6)}l${f1(t.r)} ${f1(t.r * 2.4)}h${f1(-t.r * 2)}z" fill="${t.col}"/>`).join('') + '</g>');
      if (palm.length) s.push('<g stroke="#4f6e3a" stroke-width="2.2" stroke-linecap="round">' + palm.map(t => `<path d="M${f1(t.x)} ${f1(t.y)}l${f1(t.r)} -3M${f1(t.x)} ${f1(t.y)}l${f1(-t.r)} -3M${f1(t.x)} ${f1(t.y)}l3 ${f1(t.r)}M${f1(t.x)} ${f1(t.y)}l-4 ${f1(-t.r)}M${f1(t.x)} ${f1(t.y)}l${f1(t.r * 0.7)} ${f1(t.r * 0.7)}"/>`).join('') + '</g>');
    }
    // mountains
    if (out.peaks.length) s.push('<g stroke="#5f584c" stroke-width="1.6" stroke-linejoin="round">' + out.peaks.map(([x, y, h]) => `<path d="M${f1(x - h * 0.7)} ${f1(y + h * 0.4)}L${f1(x)} ${f1(y - h * 0.6)}L${f1(x + h * 0.7)} ${f1(y + h * 0.4)}z" fill="#c9c2b0"/><path d="M${f1(x)} ${f1(y - h * 0.6)}L${f1(x + h * 0.7)} ${f1(y + h * 0.4)}L${f1(x + h * 0.15)} ${f1(y + h * 0.4)}z" fill="#9d9584" stroke="none"/><path d="M${f1(x - h * 0.2)} ${f1(y - h * 0.3)}L${f1(x)} ${f1(y - h * 0.6)}L${f1(x + h * 0.22)} ${f1(y - h * 0.28)}" fill="#f4f1ea" stroke="none"/>`).join('') + '</g>');
    // district labels
    s.push(`<g font-size="${d.size === 'metropolis' ? 21 : 19}" font-style="italic" letter-spacing="3" text-anchor="middle" fill="${INK}" stroke="${PAPER}" stroke-width="5" stroke-linejoin="round" paint-order="stroke">` + out.labels.map(l => `<text x="${f1(l.x)}" y="${f1(l.y)}">${esc(l.text.toUpperCase())}</text>`).join('') + '</g>');
    // numbered landmark markers
    s.push('<g font-size="13" font-weight="700" text-anchor="middle" font-family="Georgia, serif">' + pins.map((p, i) => `<g transform="translate(${p.x} ${f1(p.y - 15)})"><path d="M0 13l-5 -7h10z" fill="${INK}"/><circle r="11" fill="${PAPER}" stroke="${INK}" stroke-width="2"/><text y="4.5" fill="${INK}">${p.loc + 1}</text></g>`).join('') + '</g>');
    // paper grain and vignette
    s.push(`<rect width="${W}" height="${H}" filter="url(#grain)" opacity=".16"/><rect width="${W}" height="${H}" fill="url(#vig)"/>`);
    // title cartouche
    const sub = [d.sizeLabel + (d.population ? ' of ' + G.num(d.population) : ''), d.foundedText ? 'founded ' + d.foundedText : ''].filter(Boolean).join(' · ');
    const tw = Math.max(280, Math.min(720, 26 + Math.max(String(d.name).length * 26, sub.length * 10.5)));
    s.push(`<g transform="translate(36 34)"><rect width="${f1(tw)}" height="96" rx="6" fill="${PAPER}" stroke="${INK}" stroke-width="2.5"/><rect x="6" y="6" width="${f1(tw - 12)}" height="84" rx="3" fill="none" stroke="${INK}" stroke-width=".9"/>`
      + `<text x="22" y="54" font-size="40" fill="${INK}" letter-spacing="1">${esc(d.name)}</text><text x="23" y="78" font-size="16" font-style="italic" fill="#6b5434">${esc(sub)}</text></g>`);
    // compass rose
    s.push(`<g transform="translate(${W - 84} 90)" stroke="${INK}" stroke-width="1.4"><circle r="42" fill="${PAPER}" fill-opacity=".85"/><circle r="34" fill="none" stroke-width=".8"/><path d="M0 -40L7 0L0 40L-7 0z" fill="${PAPER}"/><path d="M0 -40L7 0L-7 0z" fill="${INK}"/><path d="M-40 0L0 -6L40 0L0 6z" fill="${PAPER}"/><text y="-48" text-anchor="middle" font-size="16" font-weight="700" fill="${INK}" stroke="none">N</text></g>`);
    // scale bar
    const ftpx = sz.ftpx, nice = [50, 100, 200, 250, 500, 1000, 2000, 2500, 5000].find(v => v / ftpx >= 110) || 5000, bl = nice / ftpx;
    s.push(`<g transform="translate(40 ${H - 46})" font-size="14" fill="${INK}"><rect x="-8" y="-28" width="${f1(bl + 96)}" height="46" rx="5" fill="${PAPER}" fill-opacity=".85" stroke="${INK}" stroke-width="1"/>` + [0, 1, 2, 3].map(k => `<rect x="${f1(k * bl / 4)}" y="-6" width="${f1(bl / 4)}" height="8" fill="${k % 2 ? PAPER : INK}" stroke="${INK}" stroke-width="1"/>`).join('') + `<text x="0" y="-11">0</text><text x="${f1(bl)}" y="-11" text-anchor="middle">${G.num(nice)}</text><text x="${f1(bl + 12)}" y="2">feet</text></g>`);
    // legend
    if (pins.length) {
      const cols = pins.length > 11 ? 2 : 1, rows = Math.ceil(pins.length / cols), cw = 300, lh = 23, lw = cols * cw + 20, lhgt = rows * lh + 50;
      const lx = W - lw - 30, ly = H - lhgt - 30;
      s.push(`<g transform="translate(${lx} ${ly})"><rect width="${lw}" height="${lhgt}" rx="6" fill="${PAPER}" fill-opacity=".93" stroke="${INK}" stroke-width="2"/><text x="16" y="28" font-size="16" font-weight="700" letter-spacing="2" fill="${INK}">LEGEND</text>`
        + pins.map((p, i) => { const c = Math.floor(i / rows), r = i % rows, l = locs[p.loc]; const label = l.name.length > 27 ? l.name.slice(0, 26) + '…' : l.name; return `<g transform="translate(${16 + c * cw} ${48 + r * lh})"><circle cx="8" cy="-5" r="9" fill="${PAPER}" stroke="${INK}" stroke-width="1.5"/><text x="8" y="-0.5" font-size="11" font-weight="700" text-anchor="middle" fill="${INK}">${p.loc + 1}</text><text x="24" y="0" font-size="14" fill="${INK}">${esc(label)}</text></g>`; }).join('') + '</g>');
    }
    // frame
    s.push(`<rect x="8" y="8" width="${W - 16}" height="${H - 16}" fill="none" stroke="${INK}" stroke-width="5"/><rect x="17" y="17" width="${W - 34}" height="${H - 34}" fill="none" stroke="${INK}" stroke-width="1.2"/>`);
    s.push('</svg>');
    return { svg: s.join(''), width: W, height: H, pins, feetPerPx: ftpx, buildings: out.blds.length };
  };
  return G;
});
