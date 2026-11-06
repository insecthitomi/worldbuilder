/* Atlas terrain generator: seeded gradient noise → height field (planet, continent, archipelago, island or
   region), sea level by land share, rivers that drain downhill to the sea (priority-flood + flow accumulation),
   lakes, temperature from latitude and height, moisture from the coast and the knobs, biomes, hillshade and
   cartographic water lines. Renders to a canvas; the dialog saves it to the Library and opens it as a map. */
(function (root) {
  'use strict';
  const GK = root.GK, WB = root.WB, h = GK.h, ui = GK.ui;
  const addTo = (el, ...kids) => GK.append(el, kids);

  /* ---------------- noise ---------------- */
  function rng(seed) {
    let a = (seed >>> 0) || 1;
    return () => { a = (a + 0x6D2B79F5) | 0; let t = Math.imul(a ^ (a >>> 15), 1 | a); t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t; return ((t ^ (t >>> 14)) >>> 0) / 4294967296; };
  }
  function noise3(seed) {
    const r = rng(seed), p = new Uint8Array(512), perm = Array.from({ length: 256 }, (_, i) => i);
    for (let i = 255; i > 0; i--) { const j = Math.floor(r() * (i + 1)); const t = perm[i]; perm[i] = perm[j]; perm[j] = t; }
    for (let i = 0; i < 512; i++) p[i] = perm[i & 255];
    const fade = t => t * t * t * (t * (t * 6 - 15) + 10);
    const lerp = (a, b, t) => a + t * (b - a);
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

  /* ---------------- settings ---------------- */
  const MODES = [['planet', 'Planet', 'A whole world that wraps onto a globe'], ['continent', 'Continent', 'One large landmass'], ['archipelago', 'Archipelago', 'Scattered islands'], ['island', 'Island', 'A single island'], ['region', 'Region', 'A stretch of land, close up']];
  const LAND = { planet: .32, continent: .46, archipelago: .26, island: .34, region: .72 };
  const SIZES = { S: 1024, M: 1600, L: 2048, XL: 3072 };
  const SPAN_MILES = { continent: 3200, archipelago: 900, island: 320, region: 160 };
  const DEF = { mode: 'continent', seed: 1, sea: .5, land: null, rough: .5, temp: .5, moist: .5, rivers: .5, relief: .65, style: 'natural', size: 'M' };
  const norm = s => { const o = Object.assign({}, DEF, s || {}); if (o.land == null) o.land = LAND[o.mode] || .4; return o; };

  /* ---------------- palettes ---------------- */
  const PAL = {
    natural: {
      deep: [30, 68, 104], shallow: [78, 130, 164], shelf: [132, 180, 200], line: [214, 233, 238], lake: [92, 146, 176], river: [72, 126, 164],
      ice: [236, 241, 244], snow: [245, 246, 246], rock: [150, 141, 128], tundra: [172, 174, 158], taiga: [106, 130, 106], steppe: [190, 184, 134],
      grass: [164, 182, 122], forest: [116, 150, 98], wetforest: [90, 132, 92], desert: [228, 208, 162], savanna: [206, 192, 134], dryforest: [150, 162, 106],
      jungle: [76, 122, 82], swamp: [114, 136, 106], beach: [230, 216, 174], coast: [62, 54, 42],
    },
    parchment: {
      deep: [150, 174, 170], shallow: [176, 196, 186], shelf: [192, 206, 192], line: [214, 220, 200], lake: [160, 186, 180], river: [104, 132, 140],
      ice: [240, 234, 214], snow: [244, 238, 220], rock: [172, 152, 118], tundra: [214, 200, 164], taiga: [176, 170, 128], steppe: [222, 206, 158],
      grass: [212, 202, 150], forest: [186, 184, 130], wetforest: [172, 176, 126], desert: [232, 214, 168], savanna: [224, 206, 152], dryforest: [204, 194, 140],
      jungle: [168, 174, 122], swamp: [182, 182, 140], beach: [232, 220, 180], coast: [82, 62, 38],
    },
    pale: {
      deep: [150, 186, 210], shallow: [180, 208, 224], shelf: [198, 220, 232], line: [222, 236, 242], lake: [170, 202, 222], river: [120, 164, 196],
      ice: [244, 246, 248], snow: [248, 248, 248], rock: [200, 194, 182], tundra: [216, 218, 204], taiga: [196, 210, 190], steppe: [226, 224, 196],
      grass: [214, 226, 190], forest: [196, 216, 180], wetforest: [186, 210, 178], desert: [238, 226, 196], savanna: [230, 222, 186], dryforest: [208, 218, 182],
      jungle: [182, 208, 176], swamp: [196, 210, 186], beach: [236, 228, 200], coast: [96, 104, 112],
    },
  };

  /* ---------------- the generator (a generator function: it yields progress so the UI can breathe) ---------------- */
  function* generate(s0, W, H) {
    const s = norm(s0), planet = s.mode === 'planet';
    const n = noise3(s.seed * 7919 + 13), n2 = noise3(s.seed * 104729 + 7), n3 = noise3(s.seed * 1299709 + 3);
    const gain = .42 + s.rough * .2, warp = .08 + s.rough * .22;
    // heights at a base resolution, bilinear-upsampled, plus fine detail at full size
    const bw = Math.min(W, 640), bh = Math.max(2, Math.round(bw * H / W));
    const base = new Float32Array(bw * bh);
    const freq = { planet: 1.25, continent: 2.1, archipelago: 3.6, island: 2.4, region: 2.6 }[s.mode];
    const aspect = W / H;
    const P3 = new Float64Array(3);
    /** u, v in 0..1 → a 3D point in P3 (on a sphere for planets, so the map wraps and the poles join) */
    const sample = (u, v) => {
      if (planet) { const lon = u * Math.PI * 2 - Math.PI, lat = Math.PI / 2 - v * Math.PI, c = Math.cos(lat); P3[0] = c * Math.cos(lon) * freq; P3[1] = c * Math.sin(lon) * freq; P3[2] = Math.sin(lat) * freq; }
      else { P3[0] = u * freq * aspect / 1.6; P3[1] = v * freq / 1.6; P3[2] = .37; }
      return P3;
    };
    for (let y = 0; y < bh; y++) {
      for (let x = 0; x < bw; x++) {
        const u = (x + .5) / bw, v = (y + .5) / bh;
        sample(u, v);
        let px = P3[0], py = P3[1], pz = P3[2];
        const wx = fbm(n2, px + 3.1, py, pz, 2, .5), wy = fbm(n2, px, py + 7.7, pz, 2, .5), wz = fbm(n2, px, py, pz + 5.3, 2, .5);
        px += wx * warp * 2; py += wy * warp * 2; pz += wz * warp * 2;
        let e = fbm(n, px, py, pz, 6, gain);
        // planets: a slow continent field gathers land into a few large masses
        if (planet) e = e * .62 + fbm(n3, px * .45 + 4.2, py * .45, pz * .45, 3, .5) * .75;
        const mtn = ridged(n3, px * 1.6, py * 1.6, pz * 1.6, 4);
        e += (mtn - .35) * .24 * Math.max(0, e + .15) * 2.2;
        if (!planet) {
          const dx = (u - .5) * 2, dy = (v - .5) * 2, d = Math.sqrt(dx * dx * .85 + dy * dy * 1.1);
          if (s.mode === 'continent') e = e * .8 + (.62 - d) * .55;
          else if (s.mode === 'island') e = e * .55 + (.5 - d * 1.15) * .9;
          else if (s.mode === 'archipelago') e = fbm(n, px * 1.7, py * 1.7, pz + 9, 5, gain) * .9 + (.55 - d) * .25 + e * .25;
          else e = e * .9 + (Math.sin(u * 3.1 + s.seed) * .05);
        } else {
          // a little less land at the poles reads better on a globe
          e -= Math.pow(Math.abs(v - .5) * 2, 6) * .08;
        }
        base[y * bw + x] = e;
      }
      if (y % 24 === 0) yield { stage: 'Raising the land', p: .5 * y / bh };
    }
    const E = new Float32Array(W * H);
    const sx = (bw - 1) / Math.max(1, W - 1), sy = (bh - 1) / Math.max(1, H - 1);
    const detail = .045 + s.rough * .05;
    for (let y = 0; y < H; y++) {
      const fy = y * sy, y0 = Math.floor(fy), y1 = Math.min(bh - 1, y0 + 1), ty = fy - y0;
      for (let x = 0; x < W; x++) {
        const fx = x * sx, x0 = Math.floor(fx), x1 = Math.min(bw - 1, x0 + 1), tx = fx - x0;
        const a = base[y0 * bw + x0] * (1 - tx) + base[y0 * bw + x1] * tx, b = base[y1 * bw + x0] * (1 - tx) + base[y1 * bw + x1] * tx;
        sample((x + .5) / W, (y + .5) / H);
        E[y * W + x] = a * (1 - ty) + b * ty + fbm(n3, P3[0] * 9, P3[1] * 9, P3[2] * 9 + 11, 2, .5) * detail;
      }
      if (y % 48 === 0) yield { stage: 'Carving detail', p: .5 + .15 * y / H };
    }
    // sea level from the land share (a sorted sample), nudged by the sea-level knob
    const smp = [];
    for (let i = 0; i < E.length; i += 7) smp.push(E[i]);
    smp.sort((a, b) => a - b);
    const lo = smp[0], hi = smp[smp.length - 1];
    const thr = smp[Math.max(0, Math.min(smp.length - 1, Math.floor((1 - s.land) * smp.length)))] + (s.sea - .5) * .3 * (hi - lo);
    yield { stage: 'Finding the sea', p: .66 };

    /* coarse grid: drainage, rivers, lakes, coast distance */
    const step = Math.max(1, Math.round(W / 420)), gw = Math.ceil(W / step), gh = Math.ceil(H / step), G = gw * gh;
    const gE = new Float32Array(G), sea = new Uint8Array(G);
    for (let y = 0; y < gh; y++) for (let x = 0; x < gw; x++) { const v = E[Math.min(H - 1, y * step + (step >> 1)) * W + Math.min(W - 1, x * step + (step >> 1))]; gE[y * gw + x] = v; sea[y * gw + x] = v < thr ? 1 : 0; }
    // priority-flood: every land cell gets the neighbour it drains into, depressions fill (lakes)
    const filled = new Float32Array(G), recv = new Int32Array(G).fill(-1), seen = new Uint8Array(G), order = new Int32Array(G);
    const heap = new Int32Array(G + 8), key = filled;
    let hn = 0, on = 0;
    const push = i => { let c = hn++; heap[c] = i; while (c > 0) { const p = (c - 1) >> 1; if (key[heap[p]] <= key[heap[c]]) break; const t = heap[p]; heap[p] = heap[c]; heap[c] = t; c = p; } };
    const pop = () => { const top = heap[0]; heap[0] = heap[--hn]; let c = 0; for (;;) { const l = c * 2 + 1, r = l + 1; let m = c; if (l < hn && key[heap[l]] < key[heap[m]]) m = l; if (r < hn && key[heap[r]] < key[heap[m]]) m = r; if (m === c) break; const t = heap[m]; heap[m] = heap[c]; heap[c] = t; c = m; } return top; };
    for (let i = 0; i < G; i++) {
      const x = i % gw, y = (i / gw) | 0;
      const edge = !planet && (x === 0 || y === 0 || x === gw - 1 || y === gh - 1);
      if (sea[i] || edge) { filled[i] = gE[i]; seen[i] = 1; push(i); }
    }
    const NB = [[1, 0], [-1, 0], [0, 1], [0, -1], [1, 1], [-1, 1], [1, -1], [-1, -1]];
    while (hn) {
      const c = pop(); order[on++] = c;
      const cx = c % gw, cy = (c / gw) | 0;
      for (const [dx, dy] of NB) {
        let nx = cx + dx; const ny = cy + dy;
        if (ny < 0 || ny >= gh) continue;
        if (nx < 0 || nx >= gw) { if (!planet) continue; nx = (nx + gw) % gw; }
        const j = ny * gw + nx;
        if (seen[j]) continue;
        seen[j] = 1; filled[j] = Math.max(gE[j], filled[c] + 1e-6); recv[j] = c; push(j);
      }
    }
    yield { stage: 'Letting the rain run off', p: .74 };
    // distance from the sea (for moisture) by a breadth-first sweep
    const dist = new Float32Array(G).fill(1e9), q = new Int32Array(G);
    let qh = 0, qt = 0;
    for (let i = 0; i < G; i++) if (sea[i]) { dist[i] = 0; q[qt++] = i; }
    while (qh < qt) { const c = q[qh++], cx = c % gw, cy = (c / gw) | 0; for (const [dx, dy] of NB.slice(0, 4)) { let nx = cx + dx; const ny = cy + dy; if (ny < 0 || ny >= gh) continue; if (nx < 0 || nx >= gw) { if (!planet) continue; nx = (nx + gw) % gw; } const j = ny * gw + nx; if (dist[j] > dist[c] + 1) { dist[j] = dist[c] + 1; q[qt++] = j; } } }
    // flow: rain weighted by moisture, accumulated downhill
    const acc = new Float32Array(G);
    for (let i = 0; i < G; i++) acc[i] = sea[i] ? 0 : .6 + s.moist * .8 + (n2((i % gw) / gw * 6, ((i / gw) | 0) / gh * 6, 3.3) * .4);
    for (let k = on - 1; k >= 0; k--) { const c = order[k], r = recv[c]; if (r >= 0 && !sea[c]) acc[r] += acc[c]; }
    // rivers: the wettest share of land cells (more with the knob), never tiny creeks
    const landAcc = [];
    for (let i = 0; i < G; i++) if (!sea[i]) landAcc.push(acc[i]);
    landAcc.sort((a, b) => b - a);
    const share = .004 + .032 * Math.pow(s.rivers, 1.4);
    const riverMin = Math.max(25 * (gw / 420), landAcc[Math.min(landAcc.length - 1, Math.floor(landAcc.length * share))] || Infinity);
    const lake = new Uint8Array(G);
    for (let i = 0; i < G; i++) if (!sea[i] && filled[i] - gE[i] > (hi - lo) * .012 && acc[i] > riverMin * .3) lake[i] = 1;
    // trace river polylines from their sources down to the sea
    const isRiver = new Uint8Array(G), inflow = new Uint8Array(G);
    if (s.rivers > 0) for (let i = 0; i < G; i++) if (!sea[i] && acc[i] >= riverMin) isRiver[i] = 1;
    for (let i = 0; i < G; i++) if (isRiver[i] && recv[i] >= 0) inflow[recv[i]]++;
    const rivers = [], done = new Uint8Array(G);
    for (let i = 0; i < G; i++) {
      if (!isRiver[i] || inflow[i]) continue;
      const line = [];
      let c = i, guard = 0;
      while (c >= 0 && guard++ < 20000) {
        line.push([((c % gw) + .5) * step, (((c / gw) | 0) + .5) * step, acc[c]]);
        if (sea[c] || done[c]) break;
        done[c] = 1;
        const r = recv[c];
        if (r < 0) break;
        if (planet && Math.abs((r % gw) - (c % gw)) > 1) break;   // wrapped round the date line: stop the stroke
        c = r;
      }
      if (line.length > 2) rivers.push(line);
    }
    yield { stage: 'Tracing the coast', p: .78 };
    // distance from land for every sea pixel (two-pass chamfer): the shelf and engraved water lines follow the coast
    const coastD = new Float32Array(W * H);
    const BIG = 1e6, D1 = 1, D2 = 1.4142;
    for (let i = 0; i < W * H; i++) coastD[i] = E[i] >= thr ? 0 : BIG;
    for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) {
      const i = y * W + x; let d = coastD[i];
      if (!d) continue;
      if (x > 0) d = Math.min(d, coastD[i - 1] + D1);
      if (y > 0) { d = Math.min(d, coastD[i - W] + D1); if (x > 0) d = Math.min(d, coastD[i - W - 1] + D2); if (x < W - 1) d = Math.min(d, coastD[i - W + 1] + D2); }
      coastD[i] = d;
    }
    for (let y = H - 1; y >= 0; y--) for (let x = W - 1; x >= 0; x--) {
      const i = y * W + x; let d = coastD[i];
      if (!d) continue;
      if (x < W - 1) d = Math.min(d, coastD[i + 1] + D1);
      if (y < H - 1) { d = Math.min(d, coastD[i + W] + D1); if (x < W - 1) d = Math.min(d, coastD[i + W + 1] + D2); if (x > 0) d = Math.min(d, coastD[i + W - 1] + D2); }
      coastD[i] = d;
    }
    yield { stage: 'Painting', p: .8 };

    /* colour */
    const pal = PAL[s.style] || PAL.natural;
    const img = new ImageData(W, H), px = img.data;
    // temperature and moisture wobble, sampled on the coarse grid and interpolated (cheap, and smooth)
    const cT = new Float32Array(G), cM = new Float32Array(G);
    for (let i = 0; i < G; i++) { const u = ((i % gw) + .5) / gw, v = (((i / gw) | 0) + .5) / gh; cT[i] = n3(u * 5, v * 5, 1.7) * .08; cM[i] = n2(u * 7 + 2, v * 7, 4.1) * .35; }
    const bil = (arr, x, y) => {
      const fx = Math.max(0, Math.min(gw - 1.001, x / step - .5)), fy = Math.max(0, Math.min(gh - 1.001, y / step - .5)), ix = fx | 0, iy = fy | 0, tx = fx - ix, ty = fy - iy, j = iy * gw + ix;
      return (arr[j] * (1 - tx) + arr[j + 1] * tx) * (1 - ty) + (arr[j + gw] * (1 - tx) + arr[j + gw + 1] * tx) * ty;
    };
    const climate = (u, v, e, x, y) => {
      let lat;
      if (planet) lat = Math.abs(v - .5) * 2;
      else if (s.mode === 'continent') lat = .12 + v * .62;
      else lat = .3 + v * .22;
      return 1.05 - lat * 1.15 + (s.temp - .5) * .9 - Math.max(0, e) * .5 + bil(cT, x, y);
    };
    const mixc = (a, b, t) => [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t, a[2] + (b[2] - a[2]) * t];
    const sm = (x, e, w) => { const q = Math.max(0, Math.min(1, (x - e + w) / (2 * w))); return q * q * (3 - 2 * q); };
    const mband = (m, cols, edges) => { let c = cols[0]; for (let i = 0; i < edges.length; i++) { const f = sm(m, edges[i], .06); if (f <= 0) break; c = f >= 1 ? cols[i + 1] : mixc(c, cols[i + 1], f); } return c; };
    const TB = [.12, .24, .4, .68];   // ice | tundra | boreal | temperate | hot
    const biome = (k, m) => k === 0 ? pal.ice : k === 1 ? mixc(pal.tundra, pal.ice, sm(m, .5, .1) * .25) : k === 2 ? mband(m, [pal.steppe, pal.taiga], [.3])
      : k === 3 ? mband(m, [pal.steppe, pal.grass, pal.forest, pal.wetforest], [.25, .48, .72]) : mband(m, [pal.desert, pal.savanna, pal.dryforest, pal.jungle], [.2, .38, .62]);
    const relief = s.relief, lx = -.62, ly = -.78;
    const span = Math.max(1e-6, hi - thr), depthSpan = Math.max(1e-6, thr - lo), sc = Math.max(.5, W / 1600);
    let landPx = 0;
    for (let y = 0; y < H; y++) {
      const v = (y + .5) / H;
      for (let x = 0; x < W; x++) {
        const i = y * W + x, o = i * 4, ev = E[i], u = (x + .5) / W;
        const gi = Math.min(gh - 1, (y / step) | 0) * gw + Math.min(gw - 1, (x / step) | 0);
        let c;
        if (ev < thr) {
          const d = (thr - ev) / depthSpan, cd = coastD[i] / sc;
          c = mixc(pal.shallow, pal.deep, Math.min(1, d * 1.6));
          if (cd < 26) c = mixc(pal.shelf, c, Math.min(1, cd / 26) * .85 + .15 * Math.min(1, d * 6));
          // engraved water lines along the coast
          if ((cd > 4 && cd < 5.6) || (cd > 10.5 && cd < 11.8) || (cd > 18.5 && cd < 19.5)) c = mixc(c, pal.line, cd < 6 ? .55 : cd < 12 ? .38 : .22);
          const t = climate(u, v, 0, x, y);
          if (t < .02) c = mixc(c, pal.ice, .85);
        } else {
          landPx++;
          const e = (ev - thr) / span;
          const t = climate(u, v, e, x, y);
          let m = s.moist + bil(cM, x, y) + Math.max(0, .3 - dist[gi] / (gw * .05)) * .5 - e * .15;
          if (planet) m += (Math.cos(v * Math.PI * 6) * .12);   // wet tropics and temperate belts, dry horse latitudes
          // biome from temperature and moisture, blended softly across every boundary
          let tb = 0;
          while (tb < 4 && t >= TB[tb]) tb++;
          c = biome(tb, m);
          if (tb > 0 && t - TB[tb - 1] < .035) c = mixc(biome(tb - 1, m), c, .5 + (t - TB[tb - 1]) / .07);
          else if (tb < 4 && TB[tb] - t < .035) c = mixc(c, biome(tb + 1, m), .5 - (TB[tb] - t) / .07);
          if (e < .05 && m > .68 && t > .3) c = mixc(c, pal.swamp, .7);
          if (e < .012 && t > .25 && m < .7) c = mixc(c, pal.beach, .7);
          if (e > .6) c = mixc(c, pal.rock, Math.min(.85, (e - .6) / .25));
          if (e > .84 && t < .42) c = mixc(c, pal.snow, Math.min(1, (e - .84) / .08));
          if (lake[gi]) c = pal.lake;
          // hillshade from the height gradient
          const xl = x > 0 ? E[i - 1] : ev, xr = x < W - 1 ? E[i + 1] : ev, yu = y > 0 ? E[i - W] : ev, yd = y < H - 1 ? E[i + W] : ev;
          const gx = (xr - xl) * W / 6, gy = (yd - yu) * W / 6;
          const shade = Math.max(-1, Math.min(1, (gx * lx + gy * ly) * -1));
          const k = 1 + shade * .32 * relief;
          c = [c[0] * k, c[1] * k, c[2] * k];
          // the coastline
          if ((x > 0 && E[i - 1] < thr) || (x < W - 1 && E[i + 1] < thr) || (y > 0 && E[i - W] < thr) || (y < H - 1 && E[i + W] < thr)) c = mixc(c, pal.coast, .55);
        }
        px[o] = c[0]; px[o + 1] = c[1]; px[o + 2] = c[2]; px[o + 3] = 255;
      }
      if (y % 40 === 0) yield { stage: 'Painting', p: .8 + .18 * y / H };
    }
    return { img, rivers, pal, stats: { land: landPx / (W * H), rivers: rivers.length }, step };
  }
  function draw(res, W, H) {
    const c = document.createElement('canvas');
    c.width = W; c.height = H;
    const g = c.getContext('2d');
    g.putImageData(res.img, 0, 0);
    // rivers: Chaikin-smoothed, widening downstream
    const rc = 'rgb(' + res.pal.river.join(',') + ')';
    g.lineCap = 'round'; g.lineJoin = 'round';
    const scale = W / 1600;
    for (const line of res.rivers) {
      let pts = line;
      for (let k = 0; k < 2; k++) { const o = [pts[0]]; for (let i = 0; i < pts.length - 1; i++) { const a = pts[i], b = pts[i + 1]; o.push([a[0] * .75 + b[0] * .25, a[1] * .75 + b[1] * .25, a[2]], [a[0] * .25 + b[0] * .75, a[1] * .25 + b[1] * .75, b[2]]); } o.push(pts[pts.length - 1]); pts = o; }
      const a0 = line[0][2];
      for (let i = 0; i < pts.length - 1; i++) {
        const w = Math.max(.35, Math.min(4.5, Math.sqrt(Math.max(0, pts[i][2] - a0 * .6)) * .075)) * Math.max(.6, scale);
        g.beginPath(); g.moveTo(pts[i][0], pts[i][1]); g.lineTo(pts[i + 1][0], pts[i + 1][1]);
        g.lineWidth = w; g.strokeStyle = rc; g.stroke();
      }
    }
    return c;
  }
  /** synchronous render (previews, tests): { canvas, width, height, stats } */
  function render(s) {
    const W = s.width || 400, H = s.height || Math.round(W * (s.mode === 'planet' ? .5 : .625));
    const it = generate(s, W, H);
    let r = it.next();
    while (!r.done) r = it.next();
    return { canvas: draw(r.value, W, H), width: W, height: H, stats: r.value.stats };
  }
  // yields to the event loop without the frame or timer throttling of a background window
  const tick = () => new Promise(res => { const ch = new MessageChannel(); ch.port1.onmessage = () => res(); ch.port2.postMessage(0); });
  async function renderAsync(s, onProgress) {
    const W = s.width, H = s.height;
    const it = generate(s, W, H);
    let r = it.next(), t = performance.now();
    while (!r.done) {
      if (performance.now() - t > 40) { onProgress && onProgress(r.value); await tick(); t = performance.now(); }
      r = it.next();
    }
    return { canvas: draw(r.value, W, H), width: W, height: H, stats: r.value.stats };
  }
  const dims = s => { const W = SIZES[s.size] || 1600; return { width: W, height: s.mode === 'planet' ? W / 2 : Math.round(W * .625) }; };

  /* ---------------- the dialog ---------------- */
  /** opts: { title, parentId, replaceMapId, createMap } → the map entry (or null) */
  async function open(opts = {}) {
    let start = {};
    if (opts.replaceMapId) { const m = await WB.api('atlas.map', opts.replaceMapId).catch(() => null); if (m && m.data.gen) start = m.data.gen; else if (m && m.data.projection === 'equirectangular') start = { mode: 'planet' }; }
    let s = norm(Object.assign({ seed: Math.floor(Math.random() * 99999) + 1 }, start));
    let name = opts.title || '';
    return new Promise(resolve => {
      let done = false;
      const finish = v => { if (done) return; done = true; scrim.remove(); document.removeEventListener('keydown', onKey, true); resolve(v); };
      const preview = h('canvas.wb-tg-canvas');
      const stat = h('div.wb-tg-stat.gk-small');
      // a quick small render while knobs move, the full preview once they settle
      const paintPreview = (quick) => {
        const W = 480, H = s.mode === 'planet' ? 240 : 300, k = quick ? .4 : 1;
        const t0 = performance.now();
        const r = render(Object.assign({}, s, { width: Math.round(W * k), height: Math.round(H * k) }));
        if (preview.width !== W || preview.height !== H) { preview.width = W; preview.height = H; }
        const pg = preview.getContext('2d');
        pg.imageSmoothingEnabled = true; pg.imageSmoothingQuality = 'high';
        pg.drawImage(r.canvas, 0, 0, W, H);
        preview.style.aspectRatio = W + ' / ' + H;
        if (!quick) stat.textContent = Math.round(r.stats.land * 100) + '% land · ' + r.stats.rivers + ' rivers · seed ' + s.seed + ' · ' + Math.round(performance.now() - t0) + ' ms';
      };
      const full = WB.debounce(() => paintPreview(false), 260);
      const quickP = WB.debounce(() => paintPreview(true), 30);
      const later = () => { quickP(); full(); };
      const knobs = h('div.wb-tg-knobs');
      const seedIn = ui.input({ type: 'number', value: s.seed, onChange: v => { s.seed = Math.max(1, Math.round(+v) || 1); later(); } });
      const slider = (key, label, hint, fmt) => ui.field({ label, hint, control: ui.slider({ min: 0, max: 1, step: .01, value: s[key], format: fmt || (v => Math.round(v * 100) + '%'), onInput: v => { s[key] = v; later(); } }) });
      const paintKnobs = () => {
        GK.clear(knobs);
        addTo(knobs, 
          ui.field({ label: 'Mode', control: ui.segmented({ value: s.mode, options: MODES, onChange: v => { s.mode = v; s.land = LAND[v]; paintKnobs(); later(); } }) }),
          ui.field({ label: 'Seed', hint: 'The same seed and settings always make the same map.', control: h('div.gk-row.nowrap', [h('div.gk-grow', [seedIn]), ui.button({ label: 'Re-roll', icon: '🎲', onClick: () => reroll() })]) }),
          h('div.wb-tg-two', [slider('land', 'Land', 'How much of the map is land'), slider('sea', 'Sea level', 'Raise to drown coasts and make islands', v => (v < .5 ? '−' : '+') + Math.round(Math.abs(v - .5) * 200) + '%')]),
          h('div.wb-tg-two', [slider('rough', 'Roughness', 'Smooth shores ↔ ragged fjords'), slider('relief', 'Relief shading')]),
          h('div.wb-tg-two', [slider('temp', 'Temperature', 'Ice and tundra ↔ deserts and jungle', v => (v < .35 ? 'cold' : v > .65 ? 'hot' : 'temperate') + ' ' + Math.round(v * 100)), slider('moist', 'Moisture', 'Deserts and steppe ↔ forest and swamp')]),
          h('div.wb-tg-two', [slider('rivers', 'Rivers'), ui.field({ label: 'Style', control: ui.select({ value: s.style, options: [['natural', 'Natural atlas'], ['parchment', 'Old parchment'], ['pale', 'Pale (for borders)']], onChange: v => { s.style = v; later(); } }) })]),
          ui.field({ label: 'Image size', control: ui.segmented({ value: s.size, options: Object.keys(SIZES).map(k => { const d = dims(Object.assign({}, s, { size: k })); return [k, k, d.width + ' × ' + d.height + ' px']; }), onChange: v => { s.size = v; } }) }),
        );
      };
      const reroll = () => { s.seed = Math.floor(Math.random() * 99999) + 1; seedIn.value = s.seed; paintPreview(false); };
      const nameIn = ui.input({ value: name, placeholder: 'Name of the map', onInput: v => { name = v; } });
      const progress = h('div.wb-tg-progress', { hidden: true }, [h('div.wb-tg-bar', [h('i')]), h('span.gk-small')]);
      const createBtn = ui.button({ label: opts.replaceMapId ? 'Use for this map' : 'Create map', kind: 'primary', onClick: () => create() });
      const create = async () => {
        createBtn.disabled = true; progress.hidden = false;
        try {
          const d = dims(s);
          const r = await renderAsync(Object.assign({}, s, d), p => { progress.querySelector('i').style.width = Math.round(p.p * 100) + '%'; progress.querySelector('span').textContent = p.stage + '…'; });
          progress.querySelector('span').textContent = 'Saving…';
          const blob = await new Promise(res => r.canvas.toBlob(res, 'image/png'));
          const title = name.trim() || ({ planet: 'New world', continent: 'New continent', archipelago: 'The isles', island: 'The island', region: 'New region' })[s.mode];
          const media = await WB.api('media.save', WB.worldId, { name: title + '.png', mime: 'image/png', bytes: new Uint8Array(await blob.arrayBuffer()), tags: ['map', 'generated'] });
          const unit = (WB.world.settings && WB.world.settings.mapUnit) || 'miles';
          const data = { image: media.id, width: d.width, height: d.height, gen: Object.assign({}, s) };
          if (s.mode === 'planet') Object.assign(data, { projection: 'equirectangular', planet: { radiusKm: 6371 }, unit: unit === 'miles' ? 'miles' : 'km' });
          else Object.assign(data, { projection: 'flat', unit, unitsPerPx: window.WBGeo ? WBGeo.convert(SPAN_MILES[s.mode] / d.width, 'miles', unit) : SPAN_MILES[s.mode] / d.width });
          let entry;
          if (opts.replaceMapId) {
            const m = await WB.api('atlas.map', opts.replaceMapId);
            const sx = d.width / m.data.width, sy = d.height / m.data.height;
            if (m.items.length && (Math.abs(sx - 1) > .001 || Math.abs(sy - 1) > .001)) await WB.api('atlas.bulk', { save: m.items.map(i => ({ id: i.id, x: i.x * sx, y: i.y * sy, points: i.points.map(p => [p[0] * sx, p[1] * sy]) })) });
            entry = await WB.api('entries.update', opts.replaceMapId, { dataPatch: data });
          } else {
            entry = await opts.createMap({ title, parentId: opts.parentId || null, data, open: false, kind: s.mode === 'planet' ? 'World' : 'Region' });
          }
          finish(entry);
          ui.toast(opts.replaceMapId ? 'New terrain on “' + entry.title + '”' : '“' + entry.title + '” is ready', '⛰');
          WB.go('atlas', { mapId: entry.id });
        } catch (e) { WB.fail(e); createBtn.disabled = false; progress.hidden = true; }
      };
      const panel = ui.panel({ title: opts.replaceMapId ? 'Generate terrain for this map' : 'Generate terrain', icon: '⛰', cls: 'gk-dialog wb-tg', body: [
        h('div.wb-tg-main', [h('div.wb-tg-left', [h('div.wb-tg-preview', [preview, ui.button({ label: 'Re-roll', icon: '🎲', small: true, title: 'A new seed, same settings (R)', onClick: () => reroll() })]), stat,
          h('p.gk-tiny.gk-faint', { text: 'The preview is small; the map is rendered at full size when you create it. Pins, borders and routes go on top in the Atlas.' })]), knobs]),
        ui.field({ label: 'Name', control: nameIn }), progress,
      ] });
      panel.appendChild(h('div.gk-panel-foot', [h('span.gk-small.gk-muted.gk-grow', [WB.ui.kbd('R'), ' re-roll · ', WB.ui.kbd('Esc'), ' cancel']), ui.button({ label: 'Cancel', onClick: () => finish(null) }), createBtn]));
      const scrim = h('div.gk-scrim', { onclick: e => { if (e.target === scrim) finish(null); } }, [panel]);
      const onKey = e => {
        if (e.key === 'Escape') { e.stopPropagation(); finish(null); }
        else if ((e.key === 'r' || e.key === 'R') && !e.target.closest('input, textarea, select')) { e.preventDefault(); reroll(); }
      };
      document.addEventListener('keydown', onKey, true);
      document.body.appendChild(scrim);
      paintKnobs(); paintPreview(false);
    });
  }

  WB.atlasTerrain = { open, render, renderAsync, generate, noise3, MODES, DEF };
})(window);
