/* Atlas terrain field: the pure logic behind generated and painted maps. A field is a coarse grid (w × h) of
   elevation (0..255, sea level at field.sea) plus an optional biome override; climate (temperature, rainfall),
   biomes (Whittaker), drainage (rivers, lakes), coast distance and hillshade are derived from it. Also: the seeded
   generator (plates, ridges, erosion), brushes with exact undo patches, cheapest-path routing, travel-time
   isochrones, resource deposits, settlement sites, the compact base64 codec and align/distribute helpers.
   UMD: window.WBField in the renderer, module.exports in tests. No DOM, no canvas. */
(function (root, factory) {
  const api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  else root.WBField = api;
})(typeof self !== 'undefined' ? self : this, function () {
  'use strict';
  const SEA = 100;                       // elevation code of sea level
  const clamp = (v, a, b) => (v < a ? a : v > b ? b : v);
  const smooth = t => { t = clamp(t, 0, 1); return t * t * (3 - 2 * t); };

  /* ---------------- noise ---------------- */
  function rng(seed) {
    let a = (seed >>> 0) || 1;
    return () => { a = (a + 0x6D2B79F5) | 0; let t = Math.imul(a ^ (a >>> 15), 1 | a); t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t; return ((t ^ (t >>> 14)) >>> 0) / 4294967296; };
  }
  function noise3(seed) {
    const r = rng(seed), p = new Uint8Array(512), perm = Array.from({ length: 256 }, (_, i) => i);
    for (let i = 255; i > 0; i--) { const j = Math.floor(r() * (i + 1)); const t = perm[i]; perm[i] = perm[j]; perm[j] = t; }
    for (let i = 0; i < 512; i++) p[i] = perm[i & 255];
    const fade = t => t * t * t * (t * (t * 6 - 15) + 10), lerp = (a, b, t) => a + t * (b - a);
    const grad = (hh, x, y, z) => { const q = hh & 15, u = q < 8 ? x : y, v = q < 4 ? y : q === 12 || q === 14 ? x : z; return ((q & 1) ? -u : u) + ((q & 2) ? -v : v); };
    return function (x, y, z) {
      const X = Math.floor(x) & 255, Y = Math.floor(y) & 255, Z = Math.floor(z) & 255;
      x -= Math.floor(x); y -= Math.floor(y); z -= Math.floor(z);
      const u = fade(x), v = fade(y), w = fade(z);
      const A = p[X] + Y, AA = p[A] + Z, AB = p[A + 1] + Z, B = p[X + 1] + Y, BA = p[B] + Z, BB = p[B + 1] + Z;
      return lerp(lerp(lerp(grad(p[AA], x, y, z), grad(p[BA], x - 1, y, z), u), lerp(grad(p[AB], x, y - 1, z), grad(p[BB], x - 1, y - 1, z), u), v),
        lerp(lerp(grad(p[AA + 1], x, y, z - 1), grad(p[BA + 1], x - 1, y, z - 1), u), lerp(grad(p[AB + 1], x, y - 1, z - 1), grad(p[BB + 1], x - 1, y - 1, z - 1), u), v), w);
    };
  }
  function fbm(n, x, y, z, oct, gain) {
    let s = 0, a = 1, f = 1, norm = 0;
    for (let i = 0; i < oct; i++) { s += a * n(x * f, y * f, z * f); norm += a; a *= gain; f *= 2.02; }
    return s / norm;
  }
  function ridged(n, x, y, z, oct) {
    let s = 0, a = .5, f = 1, prev = 1;
    for (let i = 0; i < oct; i++) { let v = 1 - Math.abs(n(x * f, y * f, z * f)); v *= v; s += v * a * prev; prev = v; a *= .5; f *= 2.1; }
    return s;
  }

  /* ---------------- biomes ---------------- */
  /** id → [key, name, natural colour, parchment colour]; 0 = automatic (from climate) */
  const BIOMES = [
    ['auto', 'Automatic', [0, 0, 0], [0, 0, 0]],
    ['ice', 'Ice cap', [236, 241, 244], [240, 234, 214]],
    ['tundra', 'Tundra', [172, 174, 158], [214, 200, 164]],
    ['taiga', 'Taiga', [106, 130, 106], [176, 170, 128]],
    ['steppe', 'Cold steppe', [190, 184, 134], [222, 206, 158]],
    ['grass', 'Grassland', [164, 182, 122], [212, 202, 150]],
    ['forest', 'Temperate forest', [116, 150, 98], [186, 184, 130]],
    ['wetforest', 'Wet forest', [90, 132, 92], [172, 176, 126]],
    ['shrub', 'Shrubland', [150, 162, 106], [204, 194, 140]],
    ['desert', 'Desert', [228, 208, 162], [232, 214, 168]],
    ['savanna', 'Savanna', [206, 192, 134], [224, 206, 152]],
    ['dryforest', 'Seasonal forest', [128, 158, 92], [196, 190, 134]],
    ['jungle', 'Rainforest', [76, 122, 82], [168, 174, 122]],
    ['swamp', 'Swamp', [114, 136, 106], [182, 182, 140]],
    ['rock', 'Bare rock', [150, 141, 128], [172, 152, 118]],
    ['sand', 'Beach & dunes', [230, 216, 174], [232, 220, 180]],
  ];
  const B = {}; BIOMES.forEach((b, i) => { B[b[0]] = i; });
  /** Whittaker: mean temperature (°C) and yearly rainfall (mm) → land biome id */
  function biomeOf(t, r) {
    if (t < -6) return B.ice;
    if (t < 2) return r < 120 && t < -2 ? B.ice : B.tundra;
    if (t < 8) return r < 330 ? B.steppe : B.taiga;
    if (t < 18) {
      if (r < 260) return B.desert;
      if (r < 520) return t > 13 ? B.shrub : B.steppe;
      if (r < 900) return B.grass;
      if (r < 1700) return B.forest;
      return B.wetforest;
    }
    if (r < 280) return B.desert;
    if (r < 560) return B.shrub;
    if (r < 1000) return B.savanna;
    if (r < 1900) return B.dryforest;
    return B.jungle;
  }

  /* ---------------- field basics ---------------- */
  /** a field of w × h cells over a map of mapW × mapH pixels; everything starts as open sea */
  function create(w, h, o = {}) {
    const f = {
      v: 1, w, h, sea: SEA, seed: o.seed || 1, planet: !!o.planet, mapW: o.mapW || w * 6, mapH: o.mapH || h * 6,
      params: o.params || {}, elev: new Float32Array(w * h).fill(o.fill == null ? SEA - 40 : o.fill), biome: new Uint8Array(w * h),
      ver: { elev: 1, biome: 1 }, cache: null,
    };
    return f;
  }
  const touch = (f, what) => { f.ver[what || 'elev']++; };
  const toCell = (f, mx, my) => [mx / f.mapW * f.w, my / f.mapH * f.h];
  const toMap = (f, cx, cy) => [cx / f.w * f.mapW, cy / f.h * f.mapH];
  /** elevation at a cell-space point, bilinear (cell centres at +.5) */
  function elevAt(f, cx, cy, arr) {
    arr = arr || f.elev;
    const w = f.w, h = f.h;
    let fx = cx - .5, fy = clamp(cy - .5, 0, h - 1);
    let x0 = Math.floor(fx); const tx = fx - x0, y0 = Math.floor(fy), y1 = Math.min(h - 1, y0 + 1), ty = fy - y0;
    let x1 = x0 + 1;
    if (f.planet) { x0 = ((x0 % w) + w) % w; x1 = ((x1 % w) + w) % w; } else { x0 = clamp(x0, 0, w - 1); x1 = clamp(x1, 0, w - 1); }
    return (arr[y0 * w + x0] * (1 - tx) + arr[y0 * w + x1] * tx) * (1 - ty) + (arr[y1 * w + x0] * (1 - tx) + arr[y1 * w + x1] * tx) * ty;
  }
  const elevAtMap = (f, mx, my) => { const c = toCell(f, mx, my); return elevAt(f, c[0], c[1]); };
  const isLand = (f, i) => f.elev[i] >= f.sea;

  /* ---------------- derived layers: climate, biomes, coast, shade, drainage ---------------- */
  const latOf = (f, y) => {
    const v = (y + .5) / f.h, p = f.params;
    if (f.planet) return Math.abs(v - .5) * 2;
    const a = p.lat0 != null ? p.lat0 : .12, b = p.lat1 != null ? p.lat1 : .74;
    return clamp(a + v * (b - a), 0, 1);
  };
  /** temperature °C at sea level for latitude 0 (equator) … 1 (pole), before the temperature knob */
  const tempBase = lat => 30 - 48 * Math.pow(lat, 1.25);
  const rainBand = lat => 350 + 1900 * Math.exp(-Math.pow(lat / .2, 2)) + 900 * Math.exp(-Math.pow((lat - .62) / .18, 2));

  /** neighbours of cell i (4 or 8), wrapping round the date line on planets */
  function nbrs(f, i, eight, out) {
    const w = f.w, h = f.h, x = i % w, y = (i / w) | 0;
    let n = 0;
    for (let k = 0; k < (eight ? 8 : 4); k++) {
      const dx = DX[k], dy = DY[k];
      let nx = x + dx; const ny = y + dy;
      if (ny < 0 || ny >= h) continue;
      if (nx < 0 || nx >= w) { if (!f.planet) continue; nx = (nx + w) % w; }
      out[n++] = ny * w + nx;
    }
    return n;
  }
  const DX = [1, -1, 0, 0, 1, -1, 1, -1], DY = [0, 0, 1, -1, 1, 1, -1, -1];

  /** separable box blur, in place: radius r cells, a few passes (smooths the hard edges the wind sweeps leave between latitude bands) */
  function blur(arr, w, h, wrap, r, passes) {
    const tmp = new Float32Array(arr.length), n = 2 * r + 1;
    for (let k = 0; k < passes; k++) {
      for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
        let s = 0;
        for (let d = -r; d <= r; d++) { let xx = x + d; xx = wrap ? ((xx % w) + w) % w : clamp(xx, 0, w - 1); s += arr[y * w + xx]; }
        tmp[y * w + x] = s / n;
      }
      for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
        let s = 0;
        for (let d = -r; d <= r; d++) s += tmp[clamp(y + d, 0, h - 1) * w + x];
        arr[y * w + x] = s / n;
      }
    }
  }
  /** priority-flood drainage: filled surface (depressions become lakes), receiver of every cell, flow accumulation */
  function flow(f) {
    const { w, h, elev, planet } = f, N = w * h, sea = f.sea;
    const filled = new Float32Array(N), recv = new Int32Array(N).fill(-1), seen = new Uint8Array(N), order = new Int32Array(N);
    const heap = new Int32Array(N + 8);
    let hn = 0, on = 0;
    const push = i => { let c = hn++; heap[c] = i; while (c > 0) { const p = (c - 1) >> 1; if (filled[heap[p]] <= filled[heap[c]]) break; const t = heap[p]; heap[p] = heap[c]; heap[c] = t; c = p; } };
    const pop = () => { const top = heap[0]; heap[0] = heap[--hn]; let c = 0; for (;;) { const l = c * 2 + 1, r = l + 1; let m = c; if (l < hn && filled[heap[l]] < filled[heap[m]]) m = l; if (r < hn && filled[heap[r]] < filled[heap[m]]) m = r; if (m === c) break; const t = heap[m]; heap[m] = heap[c]; heap[c] = t; c = m; } return top; };
    for (let i = 0; i < N; i++) {
      const x = i % w, y = (i / w) | 0;
      const edge = !planet && (x === 0 || y === 0 || x === w - 1 || y === h - 1);
      if (elev[i] < sea || edge) { filled[i] = elev[i]; seen[i] = 1; push(i); }
    }
    const nb = new Int32Array(8);
    while (hn) {
      const c = pop(); order[on++] = c;
      const n = nbrs(f, c, true, nb);
      for (let k = 0; k < n; k++) {
        const j = nb[k];
        if (seen[j]) continue;
        seen[j] = 1; filled[j] = Math.max(elev[j], filled[c] + .002); recv[j] = c; push(j);
      }
    }
    const rain = f.cache && f.cache.rain;
    const acc = new Float32Array(N);
    for (let i = 0; i < N; i++) acc[i] = elev[i] < sea ? 0 : .35 + (rain ? rain[i] / 1400 : .8);
    for (let k = on - 1; k >= 0; k--) { const c = order[k], r = recv[c]; if (r >= 0 && elev[c] >= sea) acc[r] += acc[c]; }
    return { filled, recv, acc, order, count: on };
  }
  /** river polylines (cell coordinates, [x, y, accumulation]) from sources down to the sea or a lake; density 0..1 */
  function riversOf(f, fl, density) {
    const { w, h, elev, planet } = f, N = w * h, sea = f.sea;
    const landAcc = [];
    for (let i = 0; i < N; i++) if (elev[i] >= sea) landAcc.push(fl.acc[i]);
    if (!landAcc.length || density <= 0) return [];
    landAcc.sort((a, b) => b - a);
    const share = .004 + .032 * Math.pow(density, 1.4);
    const min = Math.max(14 * (w / 256), landAcc[Math.min(landAcc.length - 1, Math.floor(landAcc.length * share))] || Infinity);
    const isRiver = new Uint8Array(N), inflow = new Uint8Array(N), done = new Uint8Array(N);
    for (let i = 0; i < N; i++) if (elev[i] >= sea && fl.acc[i] >= min) isRiver[i] = 1;
    for (let i = 0; i < N; i++) if (isRiver[i] && fl.recv[i] >= 0) inflow[fl.recv[i]]++;
    const out = [];
    for (let i = 0; i < N; i++) {
      if (!isRiver[i] || inflow[i]) continue;
      const line = [];
      let c = i, guard = 0;
      while (c >= 0 && guard++ < N) {
        line.push([(c % w) + .5, ((c / w) | 0) + .5, fl.acc[c]]);
        if (elev[c] < sea || done[c]) break;
        done[c] = 1;
        const r = fl.recv[c];
        if (r < 0) break;
        if (planet && Math.abs((r % w) - (c % w)) > 1) break;
        c = r;
      }
      if (line.length > 2) out.push(line);
    }
    return out;
  }

  /** make sure f.cache holds everything derived from the current elevation/biome; opts.flow = false skips drainage (during strokes) */
  function derive(f, opts = {}) {
    const need = opts.flow !== false;
    let c = f.cache;
    if (c && c.vE === f.ver.elev && c.vB === f.ver.biome && c.vP === (f.params._v || 0) && (!need || c.fl)) return c;
    const sameElev = c && c.vE === f.ver.elev && c.vP === (f.params._v || 0);
    const { w, h, elev, sea } = f, N = w * h, p = f.params;
    c = c || {};
    c.vE = f.ver.elev; c.vB = f.ver.biome; c.vP = f.params._v || 0;
    if (!sameElev || !c.temp) {
      c.temp = new Float32Array(N); c.rain = new Float32Array(N); c.coast = new Float32Array(N); c.shade = new Float32Array(N); c.grad = new Float32Array(N);
      c.fl = null; c.rivers = null;
      const hRange = 255 - sea;
      // temperature
      const tShift = ((p.temp == null ? .5 : p.temp) - .5) * 24;
      for (let y = 0; y < h; y++) {
        const lat = latOf(f, y), tb = tempBase(lat) + tShift;
        for (let x = 0; x < w; x++) { const i = y * w + x, up = Math.max(0, elev[i] - sea) / hRange; c.temp[i] = tb - 22 * up; }
      }
      // rainfall: bands by latitude, moist air carried by the prevailing wind, wrung out by land and mountains
      const moist = p.moist == null ? .5 : p.moist, base = .7 + 1.4 * moist;
      for (let y = 0; y < h; y++) {
        const lat = latOf(f, y), dir = (lat < .33 || lat > .7) ? -1 : 1, band = rainBand(lat) * base;
        let q = f.planet ? .3 : .55;
        const passes = f.planet ? 2 : 1;
        for (let pass = 0; pass < passes; pass++) {
          for (let s = 0; s < w; s++) {
            const x = dir > 0 ? s : w - 1 - s, i = y * w + x;
            const px = x - dir, prev = px < 0 || px >= w ? (f.planet ? y * w + ((px + w) % w) : i) : y * w + px;
            if (elev[i] < sea) { q = Math.min(1, q + (1 - q) * .22); if (pass === passes - 1) c.rain[i] = band * .35 * (.4 + q); }
            else {
              const rise = Math.max(0, elev[i] - elev[prev]) / 255;
              const drop = q * (.02 + Math.min(.22, rise * 2.4));
              if (pass === passes - 1) c.rain[i] = band * (.3 + .95 * q) + drop * 1800 * (.4 + moist);
              q -= drop;
            }
          }
        }
      }
      blur(c.rain, w, h, f.planet, 3, 2);
      // distance to the nearest sea cell (cells), by a breadth-first sweep
      const dist = c.coast, q4 = new Int32Array(N), nb = new Int32Array(4);
      dist.fill(1e9);
      let qh = 0, qt = 0;
      for (let i = 0; i < N; i++) if (elev[i] < sea) { dist[i] = 0; q4[qt++] = i; }
      while (qh < qt) { const cc = q4[qh++], n = nbrs(f, cc, false, nb); for (let k = 0; k < n; k++) { const j = nb[k]; if (dist[j] > dist[cc] + 1) { dist[j] = dist[cc] + 1; q4[qt++] = j; } } }
      // rain falls less far from the sea on top of the sweep (continental interiors)
      for (let i = 0; i < N; i++) if (elev[i] >= sea) c.rain[i] *= 1 - .35 * smooth(dist[i] / (w * .2)) * (1 - moist * .5);
      // hillshade and gradient (cell units)
      for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
        const i = y * w + x, xl = x > 0 ? i - 1 : f.planet ? i + w - 1 : i, xr = x < w - 1 ? i + 1 : f.planet ? i - w + 1 : i, yu = y > 0 ? i - w : i, yd = y < h - 1 ? i + w : i;
        const gx = (elev[xr] - elev[xl]) / 2, gy = (elev[yd] - elev[yu]) / 2;
        c.grad[i] = Math.hypot(gx, gy);
        c.shade[i] = clamp(-(gx * -.62 + gy * -.78) / 5, -1, 1);
      }
    }
    // biomes: override, else from the climate
    if (!c.bio || c.vBi !== f.ver.biome || !sameElev) {
      c.bio = new Uint8Array(N); c.vBi = f.ver.biome;
      for (let i = 0; i < N; i++) {
        if (elev[i] < sea) continue;
        if (f.biome[i]) { c.bio[i] = f.biome[i]; continue; }
        const up = (elev[i] - sea) / (255 - sea);
        let b = biomeOf(c.temp[i], c.rain[i]);
        if (up > .6 && c.temp[i] > -8) b = B.rock;
        else if (up < .025 && c.rain[i] > 1300 && c.temp[i] > 6 && c.coast[i] < 4) b = B.swamp;
        c.bio[i] = b;
      }
    }
    if (need && !c.fl) { c.fl = flow(Object.assign({}, f, { cache: c })); c.rivers = riversOf(f, c.fl, p.rivers == null ? .5 : p.rivers); }
    f.cache = c;
    return c;
  }
  /** drainage cell → lake? (the depression fill is deeper than a rounding error) */
  const lakeAt = (f, i) => { const c = f.cache; return !!(c && c.fl && f.elev[i] >= f.sea && c.fl.filled[i] - f.elev[i] > 1.2); };

  /* ---------------- the generator ---------------- */
  const MODES = [
    ['planet', 'Planet', 'A whole world that wraps onto a globe'], ['continent', 'Continent', 'One large landmass'], ['twin', 'Two continents', 'Two landmasses with a strait between'],
    ['archipelago', 'Archipelago', 'Scattered islands'], ['island', 'Island', 'A single island'], ['inland', 'Inland sea', 'A ring of land round a great sea'],
    ['highlands', 'Highlands', 'Rugged mountain country, close up'], ['region', 'Region', 'A stretch of land, close up'],
  ];
  const LAND = { planet: .32, continent: .46, twin: .42, archipelago: .26, island: .34, inland: .55, highlands: .8, region: .72 };
  const SPAN_MILES = { continent: 3200, twin: 4200, archipelago: 900, island: 320, inland: 2400, highlands: 220, region: 160 };
  const DEF = { mode: 'continent', seed: 1, sea: .5, land: null, rough: .5, ridges: .5, erosion: .5, temp: .5, moist: .5, rivers: .5, relief: .65, deposits: .5, sites: 0, roads: false, style: 'natural', size: 'M' };
  const norm = s => { const o = Object.assign({}, DEF, s || {}); if (o.land == null) o.land = LAND[o.mode] || .4; return o; };
  const LATS = { continent: [.05, .62], twin: [.05, .6], archipelago: [.15, .5], island: [.2, .48], inland: [.1, .55], highlands: [.25, .5], region: [.2, .48] };
  /** grid size for a map: coarse enough to store compactly, fine enough to paint smooth coasts */
  function gridFor(mapW, mapH) {
    const side = Math.max(mapW, mapH) > 2400 ? 320 : 256, k = side / Math.max(mapW, mapH);
    return [Math.max(16, Math.round(mapW * k)), Math.max(16, Math.round(mapH * k))];
  }
  function generate(s0, mapW, mapH) {
    const s = norm(s0), planet = s.mode === 'planet';
    const [w, h] = s0 && s0.w ? [s0.w, s0.h] : gridFor(mapW, mapH);
    const f = create(w, h, { seed: s.seed, planet, mapW, mapH, params: Object.assign({}, s) });
    if (!planet) { const l = LATS[s.mode] || [.3, .52]; f.params.lat0 = l[0]; f.params.lat1 = l[1]; }
    f.params._v = 1;
    const n1 = noise3(s.seed * 7919 + 13), n2 = noise3(s.seed * 104729 + 7), n3 = noise3(s.seed * 1299709 + 3), rnd = rng(s.seed * 2654435761);
    const N = w * h, aspect = mapW / mapH;
    const freq = { planet: 1.25, continent: 2.1, twin: 2.1, archipelago: 3.6, island: 2.4, inland: 2.2, highlands: 3.2, region: 2.6 }[s.mode] || 2.1;
    const gain = .42 + s.rough * .2, warp = .08 + s.rough * .22;
    // tectonic plates: nearest and second-nearest seed give the distance to a boundary and how hard the plates push
    const nPl = planet ? 11 : 7, pl = [];
    for (let k = 0; k < nPl; k++) {
      const u = rnd(), v = rnd(), a = rnd() * Math.PI * 2;
      const lon = u * Math.PI * 2 - Math.PI, lat = Math.asin(rnd() * 2 - 1);
      pl.push({ u: u * aspect, v, vx: Math.cos(a), vy: Math.sin(a), x: Math.cos(lat) * Math.cos(lon), y: Math.cos(lat) * Math.sin(lon), z: Math.sin(lat), c: rnd() });
    }
    const E = new Float32Array(N), ridge = new Float32Array(N), P3 = [0, 0, 0];
    for (let y = 0; y < h; y++) {
      for (let x = 0; x < w; x++) {
        const i = y * w + x, u = (x + .5) / w, v = (y + .5) / h;
        let px, py, pz;
        if (planet) { const lon = u * Math.PI * 2 - Math.PI, lat = Math.PI / 2 - v * Math.PI, c = Math.cos(lat); px = c * Math.cos(lon); py = c * Math.sin(lon); pz = Math.sin(lat); P3[0] = px * freq; P3[1] = py * freq; P3[2] = pz * freq; }
        else { P3[0] = u * freq * aspect / 1.6; P3[1] = v * freq / 1.6; P3[2] = .37; }
        px = P3[0]; py = P3[1]; pz = P3[2];
        const wx = fbm(n2, px + 3.1, py, pz, 2, .5), wy = fbm(n2, px, py + 7.7, pz, 2, .5), wz = fbm(n2, px, py, pz + 5.3, 2, .5);
        px += wx * warp * 2; py += wy * warp * 2; pz += wz * warp * 2;
        let e = fbm(n1, px, py, pz, 6, gain);
        if (planet) e = e * .62 + fbm(n3, px * .45 + 4.2, py * .45, pz * .45, 3, .5) * .75;
        // plate boundaries: ridges where plates collide, rifts where they part
        let d1 = 9, d2 = 9, a1 = null, a2 = null;
        for (const q of pl) {
          const d = planet ? 1 - (Math.cos(0) * 0 + (P3[0] / freq) * q.x + (P3[1] / freq) * q.y + (P3[2] / freq) * q.z) : Math.hypot(u * aspect - q.u, v - q.v) * .8;
          if (d < d1) { d2 = d1; a2 = a1; d1 = d; a1 = q; } else if (d < d2) { d2 = d; a2 = q; }
        }
        const gap = (d2 - d1) / (planet ? .5 : .8), push = a1 && a2 ? ((a1.vx - a2.vx) * (a2.u - a1.u) + (a1.vy - a2.vy) * (a2.v - a1.v)) / (Math.hypot(a2.u - a1.u, a2.v - a1.v) + 1e-6) : 0;
        const rn = ridged(n3, px * 1.6, py * 1.6, pz * 1.6, 4);
        const band = Math.exp(-Math.pow(gap / .09, 2)) * clamp(push * .5, -.4, 1);
        ridge[i] = band * (.55 + .6 * fbm(n2, px * 3, py * 3, pz * 3, 3, .5));
        e += (rn - .35) * .24 * Math.max(0, e + .15) * 2.2 * (.4 + s.ridges);
        if (!planet) {
          const dx = (u - .5) * 2, dy = (v - .5) * 2, d = Math.sqrt(dx * dx * .85 + dy * dy * 1.1);
          if (s.mode === 'continent') e = e * .8 + (.62 - d) * .55;
          else if (s.mode === 'twin') { const d1b = Math.hypot((u - .28) * 2 * .9, (v - .5) * 2 * 1.1), d2b = Math.hypot((u - .74) * 2 * .9, (v - .46) * 2 * 1.1); e = e * .75 + (.6 - Math.min(d1b, d2b)) * .6; }
          else if (s.mode === 'island') e = e * .55 + (.5 - d * 1.15) * .9;
          else if (s.mode === 'archipelago') e = fbm(n1, px * 1.7, py * 1.7, pz + 9, 5, gain) * .9 + (.55 - d) * .25 + e * .25;
          else if (s.mode === 'inland') e = e * .7 + (Math.abs(d - .62) < .5 ? (.5 - Math.abs(d - .6)) * .0 : 0) + (d < .34 ? -(.34 - d) * 1.4 : (.9 - d) * .35);
          else if (s.mode === 'highlands') e = e * 1.05 + .18 + ridge[i] * .1;
          else e = e * .9 + (Math.sin(u * 3.1 + s.seed) * .05);
        } else e -= Math.pow(Math.abs(v - .5) * 2, 6) * .08;
        E[i] = e;
      }
    }
    for (let i = 0; i < N; i++) E[i] += ridge[i] * (.12 + .5 * s.ridges) * (ridge[i] > 0 ? Math.max(.35, E[i] + .55) : 1);
    // land share → rough sea level, used by the erosion passes; the final level is set after erosion
    const pct = (arr, q) => { const t = Array.from(arr).filter((_, i) => i % 3 === 0).sort((a, b) => a - b); return t[clamp(Math.floor(q * t.length), 0, t.length - 1)]; };
    const levelFor = () => pct(E, 1 - s.land) + (s.sea - .5) * .3 * (pct(E, .995) - pct(E, .005));
    // erosion: thermal slumping of steep slopes, then streams cut valleys along the drainage
    const iters = Math.round(s.erosion * 7);
    if (iters) {
      const tmp = new Float32Array(N), nb = new Int32Array(4);
      for (let it = 0; it < iters; it++) {
        const thr = levelFor(), talus = .035;
        tmp.fill(0);
        for (let i = 0; i < N; i++) {
          if (E[i] < thr) continue;
          const n = nbrs({ w, h, planet }, i, false, nb);
          let best = -1, bd = talus;
          for (let k = 0; k < n; k++) { const d = E[i] - E[nb[k]]; if (d > bd) { bd = d; best = nb[k]; } }
          if (best >= 0) { const m = (bd - talus) * .3; tmp[i] -= m; tmp[best] += m; }
        }
        for (let i = 0; i < N; i++) E[i] += tmp[i];
        if (it % 2 === 0) {
          // stream power: flow accumulation on the current surface cuts the channels it runs through
          const lv = levelFor(), tf = { w, h, planet, sea: lv, elev: E, cache: null };
          const fl = flow(tf);
          for (let i = 0; i < N; i++) {
            if (E[i] < lv) continue;
            const r = fl.recv[i];
            if (r < 0) continue;
            const slope = Math.max(0, E[i] - E[r]);
            E[i] -= Math.min(.02, Math.sqrt(Math.min(fl.acc[i], 400)) * slope * .05);
          }
        }
      }
    }
    // to elevation codes: sea floor 0..SEA, land SEA+1..255 with highlands rarer
    const thr = levelFor();
    let lo = Infinity, hi = -Infinity;
    for (let i = 0; i < N; i++) { if (E[i] < lo) lo = E[i]; if (E[i] > hi) hi = E[i]; }
    for (let i = 0; i < N; i++) {
      const e = E[i];
      f.elev[i] = e < thr ? clamp(SEA * (e - lo) / Math.max(1e-6, thr - lo), 0, SEA - .01) : SEA + 1 + (254 - SEA) * Math.pow(clamp((e - thr) / Math.max(1e-6, hi - thr), 0, 1), 1.3);
    }
    derive(f);
    let land = 0;
    for (let i = 0; i < N; i++) if (f.elev[i] >= SEA) land++;
    f.stats = { land: land / N, rivers: f.cache.rivers.length };
    f.deposits = seedDeposits(f, rnd, s.deposits);
    f.extra = { sites: [], roads: [] };
    if (s.sites > 0) {
      f.extra.sites = findSites(f, s.sites, rnd);
      if (s.roads) f.extra.roads = roadNetwork(f, f.extra.sites);
    }
    return f;
  }

  /* ---------------- resource deposits ---------------- */
  /** id → [key, name, colour, icon, where it is found] */
  const RES = [
    ['iron', 'Iron', '#8a5a44', 'mine'], ['copper', 'Copper', '#c9792f', 'mine'], ['tin', 'Tin', '#9aa7b0', 'mine'], ['gold', 'Gold', '#d9a21b', 'treasure'], ['silver', 'Silver', '#b8c2cc', 'treasure'],
    ['gems', 'Gems', '#8e5cc9', 'star'], ['coal', 'Coal', '#3b3b40', 'mine'], ['stone', 'Stone', '#8d8678', 'mountain'], ['salt', 'Salt', '#e8e2d0', 'dot'],
    ['timber', 'Timber', '#3f7a45', 'forest'], ['grain', 'Grain', '#d1b447', 'village'], ['fish', 'Fish', '#3a82a8', 'port'], ['fur', 'Fur', '#7b5a3c', 'camp'], ['spice', 'Spices', '#b5453a', 'flag'], ['clay', 'Clay', '#b06a4a', 'ruin'],
  ];
  const RESKEY = RES.map(r => r[0]);
  /** how well a spot suits each resource (0..1): hills and ridges for ore, forest for timber, plains for grain... */
  function suitability(f, i, c) {
    const up = (f.elev[i] - f.sea) / (255 - f.sea), bio = c.bio[i], coast = c.coast[i], t = c.temp[i], r = c.rain[i];
    const rock = clamp((up - .22) / .4, 0, 1), hills = clamp(up * 3, 0, 1) * (1 - clamp((up - .7) / .3, 0, 1));
    return {
      iron: rock, copper: rock * .9, tin: rock * .7, gold: rock * rock, silver: rock * .8, gems: rock * rock * rock, coal: hills * (bio === B.forest || bio === B.taiga || bio === B.wetforest ? 1 : .3),
      stone: hills, salt: (bio === B.desert || bio === B.sand ? .8 : 0) + (coast <= 2 ? .4 : 0),
      timber: bio === B.forest || bio === B.taiga || bio === B.wetforest || bio === B.jungle ? 1 : bio === B.dryforest ? .6 : 0,
      grain: (bio === B.grass || bio === B.steppe || bio === B.savanna ? 1 : bio === B.forest ? .4 : 0) * (1 - up * 1.5),
      fur: (bio === B.taiga || bio === B.tundra ? 1 : 0), spice: (bio === B.jungle || bio === B.dryforest ? 1 : 0) * clamp((t - 18) / 8, 0, 1),
      clay: (bio === B.swamp ? .8 : 0) + (r > 600 && up < .08 ? .4 : 0), fish: 0,
    };
  }
  /** seed deposits on the land by terrain suitability: [[mapX, mapY, resourceIndex, richness 1..3]]; fish on the shelf near coasts */
  function seedDeposits(f, rnd, density) {
    density = density == null ? .5 : density;
    if (density <= 0) return [];
    const c = derive(f, { flow: false }), out = [], min = Math.max(2.4, f.w / 70), cells = [];
    const N = f.w * f.h, target = Math.round(N * .00085 * (.4 + density * 1.6) * (f.params.mode === 'planet' ? 1.4 : 1));
    for (let i = 0; i < N; i++) if (f.elev[i] >= f.sea || c.coast[i] <= 0) cells.push(i);
    let tries = 0;
    while (out.length < target && tries++ < target * 40 && cells.length) {
      const i = cells[Math.floor(rnd() * cells.length)], x = i % f.w, y = (i / f.w) | 0;
      let kind, score;
      if (f.elev[i] < f.sea) {
        if (!(f.elev[i] > f.sea - 18)) continue;
        kind = RESKEY.indexOf('fish'); score = .6;
      } else {
        const su = suitability(f, i, c);
        const total = RESKEY.reduce((s, k) => s + su[k], 0);
        if (total < .25) continue;
        let r = rnd() * total;
        kind = 0;
        for (let k = 0; k < RESKEY.length; k++) { r -= su[RESKEY[k]]; if (r <= 0) { kind = k; break; } }
        score = su[RESKEY[kind]];
      }
      if (rnd() > score + .05) continue;
      if (out.some(d => Math.hypot(d[0] - x, d[1] - y) < min * (d[2] === kind ? 1.8 : 1))) continue;
      const m = toMap(f, x + .5, y + .5);
      out.push([Math.round(m[0]), Math.round(m[1]), kind, 1 + Math.floor(rnd() * 3)]);
    }
    return out.map(d => d.slice(0, 4).map((v, k) => (k < 2 ? v : v)));
  }

  /* ---------------- settlements and roads ---------------- */
  const SYL_A = ['Al', 'Bar', 'Cor', 'Dun', 'Eld', 'Fen', 'Gal', 'Hol', 'Is', 'Kel', 'Lor', 'Mar', 'Nor', 'Os', 'Pel', 'Quil', 'Ros', 'Sal', 'Tor', 'Ul', 'Val', 'Wyn', 'Yar', 'Zan'];
  const SYL_B = ['a', 'e', 'o', 'i', 'an', 'en', 'or', 'ar', 'el', 'on'];
  const SYL_C = ['by', 'dale', 'ford', 'haven', 'holm', 'mere', 'mouth', 'stead', 'ton', 'wick', 'burg', 'gate', 'fell', 'water', 'port'];
  const placeName = rnd => { const p = a => a[Math.floor(rnd() * a.length)]; return p(SYL_A) + (rnd() < .45 ? p(SYL_B) : '') + p(SYL_C); };
  /** good places for towns: fertile, near water, not too high, spread out; [{x, y, score, size: 1..3, why}] in map pixels */
  function findSites(f, count, rnd) {
    const c = derive(f), N = f.w * f.h, scored = [];
    const riverCell = new Uint8Array(N);
    for (const line of c.rivers) for (const p of line) riverCell[(p[1] | 0) * f.w + (p[0] | 0)] = 1;
    for (let i = 0; i < N; i++) {
      if (f.elev[i] < f.sea + 1) continue;
      const up = (f.elev[i] - f.sea) / (255 - f.sea);
      if (up > .45 || lakeAt(f, i)) continue;
      const bio = c.bio[i], fert = bio === B.grass ? 1 : bio === B.forest ? .8 : bio === B.savanna || bio === B.dryforest ? .6 : bio === B.shrub || bio === B.wetforest || bio === B.steppe ? .5 : bio === B.taiga ? .3 : bio === B.swamp ? .25 : .1;
      let near = 0, why = 'farmland';
      if (c.coast[i] <= 1.5) { near = .6; why = 'port'; } else if (riverCell[i]) { near = .5; why = 'river'; }
      scored.push([fert * .7 + near + (1 - up) * .2 + rnd() * .12, i, why]);
    }
    scored.sort((a, b) => b[0] - a[0]);
    const out = [], min = Math.max(6, f.w / (Math.sqrt(count) * 1.7));
    for (const [sc, i, why] of scored) {
      if (out.length >= count) break;
      const x = i % f.w, y = (i / f.w) | 0;
      if (out.some(o => Math.hypot(o.cx - x, o.cy - y) < min)) continue;
      const m = toMap(f, x + .5, y + .5);
      out.push({ x: Math.round(m[0]), y: Math.round(m[1]), cx: x, cy: y, score: sc, size: out.length < Math.max(1, count / 8) ? 3 : out.length < count / 3 ? 2 : 1, why, name: placeName(rnd) });
    }
    return out;
  }
  /** roads joining every site to its cheapest neighbours (minimum spanning tree plus a few short links); [{a, b, pts, cost}] */
  function roadNetwork(f, sites) {
    const n = sites.length, links = [];
    if (n < 2) return links;
    const d = (a, b) => Math.hypot(sites[a].x - sites[b].x, sites[a].y - sites[b].y);
    const inTree = new Set([0]), edges = [];
    while (inTree.size < n) {
      let best = null;
      for (const a of inTree) for (let b = 0; b < n; b++) { if (inTree.has(b)) continue; const w = d(a, b); if (!best || w < best.w) best = { a, b, w }; }
      inTree.add(best.b); edges.push(best);
    }
    // a few extra links between close neighbours make loops
    for (let a = 0; a < n; a++) { let nn = -1, nd = Infinity; for (let b = 0; b < n; b++) { if (b === a || edges.some(e => (e.a === a && e.b === b) || (e.a === b && e.b === a))) continue; const w = d(a, b); if (w < nd) { nd = w; nn = b; } } if (nn >= 0 && nd < f.mapW * .18 && (a + nn) % 3 === 0) edges.push({ a, b: nn }); }
    for (const e of edges) { const r = route(f, [sites[e.a].x, sites[e.a].y], [sites[e.b].x, sites[e.b].y], { kind: 'road' }); if (r) links.push({ a: e.a, b: e.b, pts: r.pts, cost: r.cost }); }
    return links;
  }

  /* ---------------- cheapest paths ---------------- */
  class Heap {
    constructor() { this.k = []; this.v = []; }
    get size() { return this.k.length; }
    push(key, val) { const k = this.k, v = this.v; let c = k.length; k.push(key); v.push(val); while (c > 0) { const p = (c - 1) >> 1; if (k[p] <= k[c]) break; [k[p], k[c]] = [k[c], k[p]]; [v[p], v[c]] = [v[c], v[p]]; c = p; } }
    pop() {
      const k = this.k, v = this.v, top = v[0], lk = k.pop(), lv = v.pop();
      if (k.length) { k[0] = lk; v[0] = lv; let c = 0; for (;;) { const l = c * 2 + 1, r = l + 1; let m = c; if (l < k.length && k[l] < k[m]) m = l; if (r < k.length && k[r] < k[m]) m = r; if (m === c) break; [k[m], k[c]] = [k[c], k[m]]; [v[m], v[c]] = [v[c], v[m]]; c = m; } }
      return top;
    }
  }
  /** per-mode movement rules: factor (1 = ideal) for a land biome, slope sensitivity, water behaviour, road bonus */
  function moveRules(mode) {
    const m = String(mode || 'walk').toLowerCase();
    const naval = /ship|boat|sail|galley|canoe/.test(m);
    const base = { ice: 2, tundra: 1.4, taiga: 1.5, steppe: 1.05, grass: 1, forest: 1.5, wetforest: 1.8, shrub: 1.2, desert: 1.5, savanna: 1.1, dryforest: 1.5, jungle: 2.2, swamp: 2.6, rock: 2.4, sand: 1.2 };
    if (naval) return { naval: true, water: 1, land: 40, slope: 0, road: 1, biome: base };
    if (/cart|wagon|carriage|caravan/.test(m)) return { water: 60, land: 1, slope: 14, road: .42, off: 1.9, biome: Object.assign({}, base, { forest: 2.6, wetforest: 3.2, swamp: 5, jungle: 4, rock: 5, ice: 3 }) };
    if (/horse|mount|rider|griffin|pegasus/.test(m) && !/griffin|pegasus/.test(m)) return { water: 60, land: 1, slope: 9, road: .55, off: 1.1, biome: Object.assign({}, base, { swamp: 3.4, rock: 3, jungle: 2.8 }) };
    if (/griffin|pegasus|air|fly|wing|drake|dragon/.test(m)) return { water: 1, land: 1, slope: 0, road: 1, biome: {} };
    return { water: 60, land: 1, slope: 6, road: .6, off: 1, biome: base };
  }
  /** movement factor of a cell for a mode: 1 = easy going, larger = slower; roadMask optional */
  function cellFactor(f, i, rules, roadMask) {
    const c = f.cache;
    if (f.elev[i] < f.sea) return rules.water;
    if (rules.naval) return rules.land;
    let k = (rules.biome[BIOMES[c.bio[i]][0]] || 1) * (1 + rules.slope * Math.min(1, c.grad[i] / 12) * .4);
    if (rules.off) k *= rules.off;
    if (roadMask && roadMask[i]) k = Math.min(k, rules.road * (rules.off || 1) * 0.9 + .05);
    return k;
  }
  /** units (map pixels) per grid step for each of the 8 moves at row y; step length scales with the cell shape */
  const stepLen = (f, k) => { const cw = f.mapW / f.w, ch = f.mapH / f.h; return Math.hypot(DX[k] * cw, DY[k] * ch); };
  /** rasterise polylines (map px) into a road mask on the grid */
  function roadMaskOf(f, paths) {
    const m = new Uint8Array(f.w * f.h);
    for (const pts of paths || []) for (let i = 0; i + 1 < pts.length; i++) {
      const a = toCell(f, pts[i][0], pts[i][1]), b = toCell(f, pts[i + 1][0], pts[i + 1][1]), n = Math.max(1, Math.ceil(Math.hypot(b[0] - a[0], b[1] - a[1]) * 2));
      for (let s = 0; s <= n; s++) { const x = Math.floor(a[0] + (b[0] - a[0]) * s / n), y = Math.floor(a[1] + (b[1] - a[1]) * s / n); if (x >= 0 && y >= 0 && x < f.w && y < f.h) m[y * f.w + x] = 1; }
    }
    return m;
  }
  /** cheapest overland route between two map points (A*): { pts: [[x, y]…] in map px, cost } or null. opts.kind 'road'|'river', mode, roads (existing paths to reuse) */
  function route(f, a, b, opts = {}) {
    if (!f) return { pts: [a.slice(), b.slice()], cost: Math.hypot(b[0] - a[0], b[1] - a[1]) };
    const c = derive(f, { flow: false }), { w, h } = f, N = w * h;
    const rules = Object.assign({}, moveRules(opts.mode || 'cart')), mask = opts.roads ? roadMaskOf(f, opts.roads) : null;
    if (opts.kind === 'road' || opts.noWater) rules.water = Infinity;
    const ca = toCell(f, a[0], a[1]), cb = toCell(f, b[0], b[1]);
    const si = clamp(Math.floor(ca[1]), 0, h - 1) * w + clamp(Math.floor(ca[0]), 0, w - 1), ti = clamp(Math.floor(cb[1]), 0, h - 1) * w + clamp(Math.floor(cb[0]), 0, w - 1);
    const g = new Float32Array(N).fill(Infinity), from = new Int32Array(N).fill(-1), closed = new Uint8Array(N);
    const cw = f.mapW / w, ch = f.mapH / h, tx = ti % w, ty = (ti / w) | 0;
    const hfun = i => Math.hypot(((i % w) - tx) * cw, (((i / w) | 0) - ty) * ch) * .8;
    const heap = new Heap(), nb = new Int32Array(8);
    g[si] = 0; heap.push(hfun(si), si);
    const lens = [0, 1, 2, 3, 4, 5, 6, 7].map(k => stepLen(f, k));
    while (heap.size) {
      const i = heap.pop();
      if (closed[i]) continue;
      closed[i] = 1;
      if (i === ti) break;
      const x = i % w, y = (i / w) | 0, fi = cellFactor(f, i, rules, mask);
      for (let k = 0; k < 8; k++) {
        let nx = x + DX[k]; const ny = y + DY[k];
        if (ny < 0 || ny >= h) continue;
        if (nx < 0 || nx >= w) { if (!f.planet) continue; nx = (nx + w) % w; }
        const j = ny * w + nx;
        if (closed[j]) continue;
        let step = (fi + cellFactor(f, j, rules, mask)) / 2 * lens[k];
        // roads prefer gentle ground: penalise climbing on top of the factor
        step += Math.abs(f.elev[j] - f.elev[i]) * 1.4;
        const ng = g[i] + step;
        if (ng < g[j]) { g[j] = ng; from[j] = i; heap.push(ng + hfun(j), j); }
      }
    }
    if (!isFinite(g[ti])) return null;
    const cells = [];
    for (let i = ti; i >= 0; i = from[i]) cells.push(i);
    cells.reverse();
    let pts = cells.map(i => toMap(f, (i % w) + .5, ((i / w) | 0) + .5));
    pts[0] = a.slice(); pts[pts.length - 1] = b.slice();
    pts = chaikin(pts, 2);
    return { pts: pts.map(p => [Math.round(p[0] * 10) / 10, Math.round(p[1] * 10) / 10]), cost: g[ti] };
  }
  function chaikin(pts, rounds) {
    for (let r = 0; r < rounds; r++) {
      if (pts.length < 3) return pts;
      const o = [pts[0]];
      for (let i = 0; i < pts.length - 1; i++) { const p = pts[i], q = pts[i + 1]; o.push([p[0] * .75 + q[0] * .25, p[1] * .75 + q[1] * .25], [p[0] * .25 + q[0] * .75, p[1] * .25 + q[1] * .75]); }
      o.push(pts[pts.length - 1]);
      pts = o;
    }
    return pts;
  }
  /** a river from a map point following the drainage downhill to the sea or the map edge: [[x, y]…] in map px, or null on open water */
  function riverFrom(f, mx, my) {
    const c = derive(f), { w, h } = f, cc = toCell(f, mx, my);
    let i = clamp(Math.floor(cc[1]), 0, h - 1) * w + clamp(Math.floor(cc[0]), 0, w - 1);
    if (f.elev[i] < f.sea) return null;
    const pts = [[mx, my]];
    let guard = 0;
    while (i >= 0 && guard++ < w * h) {
      const p = toMap(f, (i % w) + .5, ((i / w) | 0) + .5);
      pts.push(p);
      if (f.elev[i] < f.sea) break;
      const r = c.fl.recv[i];
      if (r < 0) break;
      if (f.planet && Math.abs((r % w) - (i % w)) > 1) break;
      i = r;
    }
    return pts.length > 2 ? chaikin(pts, 2).map(p => [Math.round(p[0] * 10) / 10, Math.round(p[1] * 10) / 10]) : null;
  }

  /* ---------------- travel time ---------------- */
  /** days of travel from a map point to every grid cell (Dijkstra). o: { perDay (map units/day), mode, upp (units per map px at row y → fn), roads (paths), w, h, mapW, mapH } — f may be null (open ground) */
  function isochrone(f, origin, o) {
    const fld = f || create(o.w || 96, o.h || 60, { mapW: o.mapW, mapH: o.mapH, fill: SEA + 20, planet: false });
    if (!f) { fld.cache = { bio: new Uint8Array(fld.w * fld.h).fill(B.grass), grad: new Float32Array(fld.w * fld.h), vE: fld.ver.elev, vB: fld.ver.biome, vP: 0 }; }
    else derive(fld, { flow: false });
    const { w, h } = fld, N = w * h, rules = o.open ? { water: 1, land: 1, slope: 0, road: 1, biome: {} } : Object.assign({}, moveRules(o.mode)), mask = o.roads ? roadMaskOf(fld, o.roads) : null;
    if (!rules.naval && rules.water > 1) rules.water = Infinity;
    if (rules.naval) rules.land = 25;
    const upp = o.upp || (() => 1), days = new Float32Array(N).fill(Infinity), done = new Uint8Array(N), heap = new Heap();
    const oc = toCell(fld, origin[0], origin[1]), si = clamp(Math.floor(oc[1]), 0, h - 1) * w + clamp(Math.floor(oc[0]), 0, w - 1);
    days[si] = 0; heap.push(0, si);
    const lens = [0, 1, 2, 3, 4, 5, 6, 7].map(k => stepLen(fld, k));
    while (heap.size) {
      const i = heap.pop();
      if (done[i]) continue;
      done[i] = 1;
      const x = i % w, y = (i / w) | 0, fi = cellFactor(fld, i, rules, mask), u = upp(y);
      for (let k = 0; k < 8; k++) {
        let nx = x + DX[k]; const ny = y + DY[k];
        if (ny < 0 || ny >= h) continue;
        if (nx < 0 || nx >= w) { if (!fld.planet) continue; nx = (nx + w) % w; }
        const j = ny * w + nx;
        if (done[j]) continue;
        const nd = days[i] + (fi + cellFactor(fld, j, rules, mask)) / 2 * lens[k] * u / o.perDay;
        if (nd < days[j]) { days[j] = nd; heap.push(nd, j); }
      }
    }
    return { days, w, h };
  }
  /** marching squares: line segments [x0, y0, x1, y1] (cell coordinates) where the grid crosses `level` */
  function contour(grid, w, h, level) {
    const segs = [], at = (x, y) => grid[y * w + x];
    const lerp = (a, b) => (isFinite(a) && isFinite(b) && a !== b ? clamp((level - a) / (b - a), 0, 1) : .5);
    for (let y = 0; y < h - 1; y++) for (let x = 0; x < w - 1; x++) {
      const a = at(x, y), b = at(x + 1, y), c = at(x + 1, y + 1), d = at(x, y + 1);
      const code = (a < level ? 1 : 0) | (b < level ? 2 : 0) | (c < level ? 4 : 0) | (d < level ? 8 : 0);
      if (code === 0 || code === 15) continue;
      const T = [x + .5 + lerp(a, b), y + .5], R = [x + 1.5, y + .5 + lerp(b, c)], Bm = [x + .5 + lerp(d, c), y + 1.5], L = [x + .5, y + .5 + lerp(a, d)];
      const add = (p, q) => segs.push([p[0], p[1], q[0], q[1]]);
      switch (code) {
        case 1: case 14: add(L, T); break; case 2: case 13: add(T, R); break; case 3: case 12: add(L, R); break; case 4: case 11: add(R, Bm); break;
        case 5: add(L, T); add(R, Bm); break; case 6: case 9: add(T, Bm); break; case 7: case 8: add(L, Bm); break; case 10: add(T, R); add(L, Bm); break;
      }
    }
    return segs;
  }

  /* ---------------- brushes (with undo patches) ---------------- */
  /** records the cells a stroke changes so it can be undone exactly; layers: name → typed array */
  class Rec {
    constructor(layers) { this.layers = layers; this.seen = {}; this.log = {}; }
    set(name, i, v) {
      const arr = this.layers[name];
      if (arr[i] === v) return;
      const s = this.seen[name] || (this.seen[name] = new Map());
      if (!s.has(i)) s.set(i, arr[i]);
      arr[i] = v;
    }
    get changed() { return Object.values(this.seen).some(m => m.size); }
    /** { name: { idx: Int32Array, old: typed, nw: typed } } */
    patch() {
      const out = {};
      for (const [name, m] of Object.entries(this.seen)) {
        if (!m.size) continue;
        const arr = this.layers[name], idx = new Int32Array(m.size), old = new arr.constructor(m.size), nw = new arr.constructor(m.size);
        let k = 0;
        for (const [i, o] of m) { idx[k] = i; old[k] = o; nw[k] = arr[i]; k++; }
        out[name] = { idx, old, nw };
      }
      return out;
    }
  }
  function applyPatch(layers, patch, dir) {
    for (const [name, p] of Object.entries(patch)) { const arr = layers[name], src = dir === 'old' ? p.old : p.nw; for (let k = 0; k < p.idx.length; k++) arr[p.idx[k]] = src[k]; }
  }
  const hash01 = i => { let x = Math.imul(i ^ 0x9e3779b9, 0x85ebca6b); x ^= x >>> 13; x = Math.imul(x, 0xc2b2ae35); x ^= x >>> 16; return (x >>> 0) / 4294967296; };
  /** cells under a round brush: [{ i, wt }] with a soft falloff; mx, my and radius in map px */
  function brushCells(f, mx, my, rpx, hard) {
    const c = toCell(f, mx, my), rc = Math.max(.75, rpx / f.mapW * f.w), out = [];
    const x0 = Math.floor(c[0] - rc), x1 = Math.ceil(c[0] + rc), y0 = Math.max(0, Math.floor(c[1] - rc)), y1 = Math.min(f.h - 1, Math.ceil(c[1] + rc));
    for (let y = y0; y <= y1; y++) for (let x = x0; x <= x1; x++) {
      let xx = x;
      if (x < 0 || x >= f.w) { if (!f.planet) continue; xx = ((x % f.w) + f.w) % f.w; }
      const d = Math.hypot(x + .5 - c[0], y + .5 - c[1]) / rc;
      if (d >= 1) continue;
      const wt = hard ? 1 : Math.pow(1 - d * d, 2);
      out.push({ i: y * f.w + xx, wt });
    }
    return out;
  }
  const OPS = ['raise', 'lower', 'smooth', 'biome', 'water', 'land', 'coast'];
  /** one dab of a terrain brush; strength and opacity 0..1; op in OPS; opt.biome for 'biome' (0 = back to automatic); opt.layers.biome */
  function dab(f, rec, op, mx, my, rpx, strength, opacity, opt = {}) {
    const cells = brushCells(f, mx, my, rpx, op === 'biome' && opt.hard), { w, h, elev } = f, str = clamp(strength, 0, 1) * clamp(opacity == null ? 1 : opacity, 0, 1);
    const nb = new Int32Array(8);
    const avg = (i, ring) => {
      let s = elev[i], n = 1;
      const x = i % w, y = (i / w) | 0, r = ring;
      for (let dy = -r; dy <= r; dy++) for (let dx = -r; dx <= r; dx++) {
        if (!dx && !dy) continue;
        let xx = x + dx; const yy = y + dy;
        if (yy < 0 || yy >= h) continue;
        if (xx < 0 || xx >= w) { if (!f.planet) continue; xx = (xx + w) % w; }
        s += elev[yy * w + xx]; n++;
      }
      return s / n;
    };
    const next = new Map();
    for (const { i, wt } of cells) {
      const e = elev[i];
      if (op === 'raise') next.set(i, Math.min(255, e + str * wt * 9));
      else if (op === 'lower') next.set(i, Math.max(0, e - str * wt * 9));
      else if (op === 'smooth') next.set(i, e + (avg(i, 1) - e) * clamp(str * wt * 1.1, 0, 1));
      else if (op === 'water') { const t = f.sea - 16; if (e > t) next.set(i, e + (t - e) * clamp(str * wt * 1.2, 0, 1)); }
      else if (op === 'land') { const t = f.sea + 6; if (e < t) next.set(i, e + (t - e) * clamp(str * wt * 1.2, 0, 1)); }
      else if (op === 'coast') { const near = Math.exp(-Math.pow((e - f.sea) / 16, 2)); if (near > .02) next.set(i, e + (avg(i, 2) - e) * clamp(str * wt * near * 1.4, 0, 1)); }
      else if (op === 'biome') {
        if (e >= f.sea && wt * clamp(opacity == null ? 1 : opacity, 0, 1) > .3 && hash01(i + (opt.salt || 0)) < clamp(.35 + wt, 0, 1)) rec.set('biome', i, opt.biome | 0);
      }
    }
    for (const [i, v] of next) rec.set('elev', i, v);
    if (op !== 'biome' && next.size) touch(f, 'elev'); else if (op === 'biome') touch(f, 'biome');
    return cells.length;
  }
  /** flood-fill biome from a map point over land cells of the same effective biome (cap 60k cells); returns cells changed */
  function fillBiome(f, rec, mx, my, biome) {
    const c = derive(f, { flow: false }), cc = toCell(f, mx, my), w = f.w, h = f.h;
    const s = clamp(Math.floor(cc[1]), 0, h - 1) * w + clamp(Math.floor(cc[0]), 0, w - 1);
    if (f.elev[s] < f.sea) return 0;
    const want = c.bio[s];
    if (want === biome) return 0;
    const seen = new Uint8Array(w * h), q = [s], nb = new Int32Array(4);
    seen[s] = 1;
    let n = 0;
    while (q.length && n < 60000) {
      const i = q.pop(); rec.set('biome', i, biome); n++;
      const k = nbrs(f, i, false, nb);
      for (let m = 0; m < k; m++) { const j = nb[m]; if (!seen[j] && f.elev[j] >= f.sea && c.bio[j] === want) { seen[j] = 1; q.push(j); } }
    }
    touch(f, 'biome');
    return n;
  }
  /** paint/erase a painted-region grid (separate layer: { w, h, mapW, mapH, reg: Uint8Array }) */
  function paintRegion(p, rec, mx, my, rpx, id) {
    const c = [mx / p.mapW * p.w, my / p.mapH * p.h], rc = Math.max(.7, rpx / p.mapW * p.w);
    let n = 0;
    for (let y = Math.max(0, Math.floor(c[1] - rc)); y <= Math.min(p.h - 1, Math.ceil(c[1] + rc)); y++) for (let x = Math.max(0, Math.floor(c[0] - rc)); x <= Math.min(p.w - 1, Math.ceil(c[0] + rc)); x++) {
      if (Math.hypot(x + .5 - c[0], y + .5 - c[1]) <= rc) { rec.set('reg', y * p.w + x, id); n++; }
    }
    return n;
  }
  function newPaint(mapW, mapH) { const s = 128 / Math.max(mapW, mapH); const w = Math.max(8, Math.round(mapW * s)), h = Math.max(8, Math.round(mapH * s)); return { v: 1, w, h, mapW, mapH, reg: new Uint8Array(w * h), regs: [] }; }
  /** outline of a painted region (largest blob): marching squares joined into one polygon in map px, or null */
  function regionOutline(p, id) {
    const g = new Float32Array(p.w * p.h);
    for (let i = 0; i < g.length; i++) g[i] = p.reg[i] === id ? 1 : 0;
    const segs = contour(g, p.w, p.h, .5);
    if (!segs.length) return null;
    const key = (x, y) => Math.round(x * 4) + ':' + Math.round(y * 4), ends = new Map();
    segs.forEach((s, k) => { for (const e of [key(s[0], s[1]), key(s[2], s[3])]) { if (!ends.has(e)) ends.set(e, []); ends.get(e).push(k); } });
    const used = new Uint8Array(segs.length);
    let best = [];
    for (let k = 0; k < segs.length; k++) {
      if (used[k]) continue;
      used[k] = 1;
      let pts = [[segs[k][0], segs[k][1]], [segs[k][2], segs[k][3]]], grow = true;
      while (grow) {
        grow = false;
        const tail = pts[pts.length - 1], cand = (ends.get(key(tail[0], tail[1])) || []).find(m => !used[m]);
        if (cand != null) { used[cand] = 1; const s = segs[cand]; pts.push(key(s[0], s[1]) === key(tail[0], tail[1]) ? [s[2], s[3]] : [s[0], s[1]]); grow = true; }
      }
      if (pts.length > best.length) best = pts;
    }
    if (best.length < 4) return null;
    return best.map(q => [Math.round(q[0] / p.w * p.mapW * 10) / 10, Math.round(q[1] / p.h * p.mapH * 10) / 10]);
  }

  /* ---------------- compact codec: bytes → zigzag delta → PackBits → base64 ---------------- */
  const B64 = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/';
  const B64R = new Uint8Array(128).fill(255); for (let i = 0; i < 64; i++) B64R[B64.charCodeAt(i)] = i;
  function b64enc(u) {
    let s = '';
    for (let i = 0; i < u.length; i += 3) {
      const a = u[i], b = i + 1 < u.length ? u[i + 1] : 0, c = i + 2 < u.length ? u[i + 2] : 0, n = (a << 16) | (b << 8) | c;
      s += B64[(n >> 18) & 63] + B64[(n >> 12) & 63] + (i + 1 < u.length ? B64[(n >> 6) & 63] : '=') + (i + 2 < u.length ? B64[n & 63] : '=');
    }
    return s;
  }
  function b64dec(s) {
    s = String(s || '').replace(/[^A-Za-z0-9+/=]/g, '');
    const pad = s.endsWith('==') ? 2 : s.endsWith('=') ? 1 : 0, out = new Uint8Array(Math.floor(s.length / 4) * 3 - pad);
    let o = 0;
    for (let i = 0; i < s.length; i += 4) {
      const n = (B64R[s.charCodeAt(i)] << 18) | (B64R[s.charCodeAt(i + 1)] << 12) | ((B64R[s.charCodeAt(i + 2)] & 63) << 6) | (B64R[s.charCodeAt(i + 3)] & 63);
      if (o < out.length) out[o++] = (n >> 16) & 255;
      if (o < out.length) out[o++] = (n >> 8) & 255;
      if (o < out.length) out[o++] = n & 255;
    }
    return out;
  }
  /** PackBits: control 0..127 = copy n+1 literal bytes; 129..255 = repeat the next byte (257 - control) times */
  function packBits(u) {
    const out = [];
    let i = 0;
    while (i < u.length) {
      let run = 1;
      while (i + run < u.length && u[i + run] === u[i] && run < 128) run++;
      if (run >= 3) { out.push(257 - run, u[i]); i += run; continue; }
      let j = i, lit = [];
      while (j < u.length && lit.length < 128) {
        let r = 1;
        while (j + r < u.length && u[j + r] === u[j] && r < 3) r++;
        if (r >= 3) break;
        lit.push(u[j]); j++;
      }
      out.push(lit.length - 1, ...lit); i = j;
    }
    return Uint8Array.from(out);
  }
  function unpackBits(p, n) {
    const out = new Uint8Array(n);
    let i = 0, o = 0;
    while (i < p.length && o < n) {
      const c = p[i++];
      if (c < 128) { for (let k = 0; k <= c && o < n; k++) out[o++] = p[i++]; }
      else if (c > 128) { const v = p[i++]; for (let k = 0; k < 257 - c && o < n; k++) out[o++] = v; }
    }
    return out;
  }
  /** Uint8Array → string. Smooth layers (delta = true): zigzag deltas as 4-bit nibbles (15 = escape + a full byte), then PackBits. Others: PackBits only */
  function pack(u8, delta) {
    if (!delta) return 'r' + b64enc(packBits(u8));
    const nib = [];
    let prev = 0;
    for (let i = 0; i < u8.length; i++) {
      const d = ((u8[i] - prev + 128) & 255) - 128; prev = u8[i];
      const z = d >= 0 ? d * 2 : -d * 2 - 1;
      if (z < 15) nib.push(z); else nib.push(15, z >> 4, z & 15);
    }
    const bytes = new Uint8Array((nib.length + 1) >> 1);
    for (let i = 0; i < nib.length; i++) bytes[i >> 1] |= i & 1 ? nib[i] : nib[i] << 4;
    return 'n' + u8.length + ':' + b64enc(packBits(bytes));
  }
  function unpack(str, n) {
    if (!str) return new Uint8Array(n);
    if (str[0] === 'r') return unpackBits(b64dec(str.slice(1)), n);
    const cut = str.indexOf(':'), body = unpackBits(b64dec(str.slice(cut + 1)), Math.ceil(n * 3 / 2) + 8), out = new Uint8Array(n);
    let pos = 0, prev = 0;
    const next = () => { const b = body[pos >> 1]; const v = pos & 1 ? b & 15 : b >> 4; pos++; return v; };
    for (let i = 0; i < n; i++) {
      let z = next();
      if (z === 15) { const hi = next(), lo = next(); z = (hi << 4) | lo; }
      const d = z & 1 ? -((z + 1) >> 1) : z >> 1;
      prev = (prev + d) & 255; out[i] = prev;
    }
    return out;
  }
  /** a field → plain JSON (elevation rounded to a byte; derived layers are not stored) */
  function encode(f) {
    const N = f.w * f.h, u = new Uint8Array(N);
    for (let i = 0; i < N; i++) u[i] = clamp(Math.round(f.elev[i]), 0, 255);
    const params = Object.assign({}, f.params); delete params._v;
    return { v: 1, w: f.w, h: f.h, sea: f.sea, seed: f.seed, planet: f.planet, params, elev: pack(u, true), biome: f.biome.some(Boolean) ? pack(f.biome, false) : '' };
  }
  function decode(t, mapW, mapH) {
    if (!t || !(t.w > 0) || !(t.h > 0) || !t.elev) return null;
    const f = create(t.w, t.h, { seed: t.seed, planet: !!t.planet, mapW, mapH, params: Object.assign({}, t.params || {}) });
    f.sea = t.sea || SEA; f.params._v = 1;
    const u = unpack(t.elev, t.w * t.h);
    for (let i = 0; i < u.length; i++) f.elev[i] = u[i];
    f.biome = unpack(t.biome, t.w * t.h);
    return f;
  }
  const encodePaint = p => ({ v: 1, w: p.w, h: p.h, reg: p.reg.some(Boolean) ? pack(p.reg, false) : '', regs: p.regs });
  const decodePaint = (t, mapW, mapH) => (t && t.w > 0 ? { v: 1, w: t.w, h: t.h, mapW, mapH, reg: unpack(t.reg, t.w * t.h), regs: Array.isArray(t.regs) ? t.regs : [] } : null);

  /* ---------------- multi-select layout ---------------- */
  /** bounding box of a map item: pins and labels are points, territories and routes use their corners */
  function itemBox(it) {
    if (it.points && it.points.length && (it.kind === 'region' || it.kind === 'path' || (it.kind === 'label' && it.points.length > 1))) {
      let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity;
      for (const p of it.points) { if (p[0] < x0) x0 = p[0]; if (p[0] > x1) x1 = p[0]; if (p[1] < y0) y0 = p[1]; if (p[1] > y1) y1 = p[1]; }
      return { x0, y0, x1, y1 };
    }
    return { x0: it.x, y0: it.y, x1: it.x, y1: it.y };
  }
  const shifted = (it, dx, dy) => ({ id: it.id, x: it.x + dx, y: it.y + dy, points: (it.points || []).map(p => [p[0] + dx, p[1] + dy]) });
  /** align items: 'left' | 'center' | 'right' | 'top' | 'middle' | 'bottom' → patches [{ id, x, y, points }] */
  function alignPatches(items, how) {
    if (items.length < 2) return [];
    const boxes = items.map(itemBox);
    const x0 = Math.min(...boxes.map(b => b.x0)), x1 = Math.max(...boxes.map(b => b.x1)), y0 = Math.min(...boxes.map(b => b.y0)), y1 = Math.max(...boxes.map(b => b.y1));
    return items.map((it, k) => {
      const b = boxes[k];
      let dx = 0, dy = 0;
      if (how === 'left') dx = x0 - b.x0; else if (how === 'right') dx = x1 - b.x1; else if (how === 'center') dx = (x0 + x1) / 2 - (b.x0 + b.x1) / 2;
      else if (how === 'top') dy = y0 - b.y0; else if (how === 'bottom') dy = y1 - b.y1; else if (how === 'middle') dy = (y0 + y1) / 2 - (b.y0 + b.y1) / 2;
      return shifted(it, dx, dy);
    });
  }
  /** spread items so the gaps between neighbours are equal along 'x' or 'y' (first and last stay) */
  function distributePatches(items, axis) {
    if (items.length < 3) return [];
    const boxes = items.map(itemBox), mid = b => (axis === 'x' ? (b.x0 + b.x1) / 2 : (b.y0 + b.y1) / 2);
    const order = items.map((_, k) => k).sort((a, b) => mid(boxes[a]) - mid(boxes[b]));
    const first = mid(boxes[order[0]]), last = mid(boxes[order[order.length - 1]]), out = [];
    order.forEach((k, r) => {
      const target = first + (last - first) * r / (order.length - 1), d = target - mid(boxes[k]);
      out.push(shifted(items[k], axis === 'x' ? d : 0, axis === 'y' ? d : 0));
    });
    return out;
  }
  /** snap a map point to the grid (square vertices or hex centres); size in px */
  function snapGrid(G, x, y) {
    if (!G || G.type === 'none') return [x, y];
    const s = G.size;
    if (G.type === 'square') return [Math.round(x / s) * s, Math.round(y / s) * s];
    const r = s / 2, hh = Math.sqrt(3) * r, dx = 1.5 * r;
    let best = null;
    const c0 = Math.round(x / dx);
    for (let c = c0 - 1; c <= c0 + 1; c++) {
      const off = (((c % 2) + 2) % 2) * hh / 2, q0 = Math.round((y - off) / hh);
      for (let q = q0 - 1; q <= q0 + 1; q++) { const cx = c * dx, cy = q * hh + off, d = Math.hypot(cx - x, cy - y); if (!best || d < best.d) best = { d, p: [cx, cy] }; }
    }
    return best.p;
  }

  return {
    SEA, BIOMES, B, MODES, LAND, SPAN_MILES, DEF, RES, RESKEY, OPS,
    rng, noise3, fbm, clamp, smooth,
    create, touch, toCell, toMap, elevAt, elevAtMap, isLand, derive, flow, riversOf, lakeAt, biomeOf, gridFor, norm, generate,
    seedDeposits, findSites, roadNetwork, placeName, suitability,
    moveRules, route, riverFrom, isochrone, contour, roadMaskOf, chaikin,
    Rec, applyPatch, dab, fillBiome, paintRegion, newPaint, regionOutline,
    pack, unpack, b64enc, b64dec, encode, decode, encodePaint, decodePaint,
    itemBox, alignPatches, distributePatches, snapGrid, Heap,
  };
});
