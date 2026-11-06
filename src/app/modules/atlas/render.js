/* Atlas terrain painter: turns a WBField into pixels for each view mode (biome colours, hillshaded relief, climate
   heat, muted bases for the overlay modes, parchment and plain styles). Pure buffer code: paint() fills RGBA bytes
   for a pixel rectangle, so edits repaint only what they touch and tests can read the numbers. UMD like field.js. */
(function (root, factory) {
  const api = factory(typeof module === 'object' && module.exports ? require('./field.js') : root.WBField);
  if (typeof module === 'object' && module.exports) module.exports = api;
  else root.WBAtlasRender = api;
})(typeof self !== 'undefined' ? self : this, function (F) {
  'use strict';
  const { BIOMES, B, SEA } = F;
  const rgb = F.BIOMES.map(b => b[2]), parch = F.BIOMES.map(b => b[3]);
  const PAL = {
    natural: { deep: [30, 68, 104], shallow: [78, 130, 164], shelf: [132, 180, 200], line: [214, 233, 238], lake: [92, 146, 176], coast: [62, 54, 42], rock: [150, 141, 128], snow: [245, 246, 246], sand: [230, 216, 174], bio: rgb },
    pale: { deep: [150, 186, 210], shallow: [180, 208, 224], shelf: [198, 220, 232], line: [222, 236, 242], lake: [170, 202, 222], coast: [96, 104, 112], rock: [200, 194, 182], snow: [248, 248, 248], sand: [236, 228, 200], bio: rgb.map(c => c.map((v, i) => Math.round(v * .45 + [226, 228, 214][i] * .55))) },
    parchment: { deep: [150, 174, 170], shallow: [176, 196, 186], shelf: [192, 206, 192], line: [214, 220, 200], lake: [160, 186, 180], coast: [82, 62, 38], rock: [172, 152, 118], snow: [244, 238, 220], sand: [232, 220, 180], bio: parch },
    plain: { deep: [176, 200, 222], shallow: [186, 208, 228], shelf: [196, 216, 232], line: [214, 230, 240], lake: [176, 200, 222], coast: [120, 132, 110], rock: [214, 218, 204], snow: [236, 240, 232], sand: [228, 234, 210], bio: rgb.map(() => [226, 232, 208]) },
  };
  /** which look a view mode (and style) paints with: palette, shading strength and what the colour means */
  function look(mode, style) {
    const st = style || 'natural';
    if (mode === 'terrain') return { pal: st === 'natural' ? 'natural' : st, shade: .3, kind: 'biome' };
    if (mode === 'relief') return { pal: 'natural', shade: .55, kind: 'relief' };
    if (mode === 'temp') return { pal: 'natural', shade: .18, kind: 'temp' };
    if (mode === 'rain') return { pal: 'natural', shade: .18, kind: 'rain' };
    if (mode === 'parchment') return { pal: 'parchment', shade: .22, kind: 'biome' };
    if (mode === 'plain') return { pal: 'plain', shade: 0, kind: 'biome' };
    // political, travel, resources, economy: a calm base so borders, rings and icons read first
    return { pal: st === 'parchment' ? 'parchment' : st === 'plain' ? 'plain' : 'pale', shade: st === 'plain' ? 0 : .16, kind: 'biome' };
  }
  const RAMP_RELIEF = [[0, [108, 148, 94]], [.12, [150, 172, 106]], [.3, [200, 188, 128]], [.5, [176, 146, 104]], [.72, [138, 116, 96]], [.9, [214, 210, 206]], [1, [252, 252, 252]]];
  const RAMP_TEMP = [[-18, [70, 52, 140]], [-6, [70, 120, 200]], [4, [90, 190, 210]], [12, [120, 200, 120]], [20, [240, 220, 90]], [27, [240, 140, 50]], [34, [200, 50, 40]]];
  const RAMP_RAIN = [[0, [236, 218, 170]], [250, [222, 200, 130]], [600, [168, 200, 110]], [1100, [92, 168, 100]], [1800, [50, 130, 140]], [2600, [30, 70, 150]], [3500, [40, 30, 110]]];
  const ramp = (R, v, out) => {
    if (v <= R[0][0]) { out[0] = R[0][1][0]; out[1] = R[0][1][1]; out[2] = R[0][1][2]; return; }
    for (let i = 1; i < R.length; i++) if (v <= R[i][0]) { const a = R[i - 1], b = R[i], t = (v - a[0]) / (b[0] - a[0]); out[0] = a[1][0] + (b[1][0] - a[1][0]) * t; out[1] = a[1][1] + (b[1][1] - a[1][1]) * t; out[2] = a[1][2] + (b[1][2] - a[1][2]) * t; return; }
    const l = R[R.length - 1][1]; out[0] = l[0]; out[1] = l[1]; out[2] = l[2];
  };
  const clamp = F.clamp;

  /** per-cell lake mask and the pieces paint() needs, built once per field version */
  function prep(f, live) {
    const c = F.derive(f, { flow: !live });
    if (!c.lake || c.lakeV !== (c.fl ? c.vE : -1)) { c.lake = new Uint8Array(f.w * f.h); if (c.fl) for (let i = 0; i < c.lake.length; i++) c.lake[i] = F.lakeAt(f, i) ? 1 : 0; c.lakeV = c.fl ? c.vE : -1; }
    return c;
  }
  const tmp = [0, 0, 0], tmp2 = [0, 0, 0];
  /** fill out (RGBA, W × H) for the pixel rectangle [x0, x1) × [y0, y1); mode and style pick the look */
  function paint(f, mode, W, H, out, x0, y0, x1, y1, style, opts = {}) {
    const c = prep(f, opts.live), L = look(mode, style), pal = PAL[L.pal] || PAL.natural, kind = L.kind;
    const { w, h, elev } = f, sea = f.sea, planet = f.planet, hRange = 255 - sea;
    const sc = Math.max(.5, W / 1600), cellPx = W / w;
    const ink = opts.paper ? 1 : 0;
    for (let y = y0; y < y1; y++) {
      const fy = clamp((y + .5) / H * h - .5, 0, h - 1), iy = Math.floor(fy), iy1 = Math.min(h - 1, iy + 1), ty = fy - iy;
      for (let x = x0; x < x1; x++) {
        const fx = (x + .5) / W * w - .5;
        let ix = Math.floor(fx); const tx = fx - ix;
        let ix1 = ix + 1;
        if (planet) { ix = ((ix % w) + w) % w; ix1 = ix1 % w; } else { ix = clamp(ix, 0, w - 1); ix1 = clamp(ix1, 0, w - 1); }
        const i00 = iy * w + ix, i10 = iy * w + ix1, i01 = iy1 * w + ix, i11 = iy1 * w + ix1;
        const w00 = (1 - tx) * (1 - ty), w10 = tx * (1 - ty), w01 = (1 - tx) * ty, w11 = tx * ty;
        const e = elev[i00] * w00 + elev[i10] * w10 + elev[i01] * w01 + elev[i11] * w11;
        const o = (y * W + x) * 4;
        let r, g, b;
        const shade = c.shade[i00] * w00 + c.shade[i10] * w10 + c.shade[i01] * w01 + c.shade[i11] * w11;
        const grad = (c.grad[i00] * w00 + c.grad[i10] * w10 + c.grad[i01] * w01 + c.grad[i11] * w11) * (w / W) + 1e-4;
        const dEdge = Math.abs(e - sea) / grad;   // distance to the shoreline in pixels
        if (e < sea) {
          const d = (sea - e) / sea, cd = (c.coast[i00] * w00 + c.coast[i10] * w10 + c.coast[i01] * w01 + c.coast[i11] * w11) * cellPx / sc;
          let t = Math.min(1, d * 1.6);
          r = pal.shallow[0] + (pal.deep[0] - pal.shallow[0]) * t; g = pal.shallow[1] + (pal.deep[1] - pal.shallow[1]) * t; b = pal.shallow[2] + (pal.deep[2] - pal.shallow[2]) * t;
          if (L.pal !== 'plain' && cd < 26) { const m = Math.min(1, cd / 26) * .85 + .15 * Math.min(1, d * 6); r = pal.shelf[0] + (r - pal.shelf[0]) * m; g = pal.shelf[1] + (g - pal.shelf[1]) * m; b = pal.shelf[2] + (b - pal.shelf[2]) * m; }
          if (L.pal !== 'plain' && ((cd > 4 && cd < 5.6) || (cd > 10.5 && cd < 11.8) || (cd > 18.5 && cd < 19.5))) { const m = cd < 6 ? .55 : cd < 12 ? .38 : .22; r += (pal.line[0] - r) * m; g += (pal.line[1] - g) * m; b += (pal.line[2] - b) * m; }
          if (kind === 'temp' || kind === 'rain') { r = r * .55 + 70; g = g * .55 + 78; b = b * .55 + 90; }
          else if (kind === 'relief') { const k = 1 - d * .35; r *= k; g *= k; b *= k; }
        } else {
          const up = (e - sea) / hRange, ci = (c.rain[i00] * w00 + c.rain[i10] * w10 + c.rain[i01] * w01 + c.rain[i11] * w11), ti = (c.temp[i00] * w00 + c.temp[i10] * w10 + c.temp[i01] * w01 + c.temp[i11] * w11);
          if (kind === 'relief') { ramp(RAMP_RELIEF, up, tmp); r = tmp[0]; g = tmp[1]; b = tmp[2]; }
          else if (kind === 'temp') { ramp(RAMP_TEMP, ti, tmp); r = tmp[0]; g = tmp[1]; b = tmp[2]; }
          else if (kind === 'rain') { ramp(RAMP_RAIN, ci, tmp); r = tmp[0]; g = tmp[1]; b = tmp[2]; }
          else {
            // soft biome boundaries: blend the four surrounding cells' colours (land only)
            let sr = 0, sg = 0, sb = 0, sw = 0;
            const ids = [i00, i10, i01, i11], ws = [w00, w10, w01, w11];
            for (let k = 0; k < 4; k++) { if (elev[ids[k]] < sea) continue; const col = pal.bio[c.bio[ids[k]]] || pal.bio[B.grass]; sr += col[0] * ws[k]; sg += col[1] * ws[k]; sb += col[2] * ws[k]; sw += ws[k]; }
            if (sw > 0) { r = sr / sw; g = sg / sw; b = sb / sw; } else { const col = pal.bio[B.grass]; r = col[0]; g = col[1]; b = col[2]; }
            if (L.pal !== 'plain') {
              const bio = c.bio[i00];
              if (up > .5 && bio !== B.ice) { const m = Math.min(.85, (up - .5) / .3); r += (pal.rock[0] - r) * m; g += (pal.rock[1] - g) * m; b += (pal.rock[2] - b) * m; }
              if (up > .74 && ti < 8) { const m = Math.min(1, (up - .74) / .12); r += (pal.snow[0] - r) * m; g += (pal.snow[1] - g) * m; b += (pal.snow[2] - b) * m; }
              if (up < .02 && bio !== B.ice && bio !== B.swamp && bio !== B.tundra) { const m = (1 - up / .02) * .7; r += (pal.sand[0] - r) * m; g += (pal.sand[1] - g) * m; b += (pal.sand[2] - b) * m; }
            }
          }
          if (c.lake[i00] && c.lake[i10] && c.lake[i01] && c.lake[i11]) { r = pal.lake[0]; g = pal.lake[1]; b = pal.lake[2]; }
          else {
            const k = 1 + shade * L.shade;
            r *= k; g *= k; b *= k;
          }
        }
        // the shoreline, anti-aliased
        if (dEdge < 1.1) { const a = (1.1 - dEdge) / 1.1 * (L.pal === 'plain' ? .55 : .62); r += (pal.coast[0] - r) * a; g += (pal.coast[1] - g) * a; b += (pal.coast[2] - b) * a; }
        out[o] = r; out[o + 1] = g; out[o + 2] = b; out[o + 3] = 255;
      }
    }
    return out;
  }
  /** a rainfall/temperature/elevation summary of one map point (for the hover read-out): { elev, up, temp, rain, biome, name } */
  function probe(f, mx, my) {
    const c = F.derive(f, { flow: false }), cc = F.toCell(f, mx, my);
    const x = clamp(Math.floor(cc[0]), 0, f.w - 1), y = clamp(Math.floor(cc[1]), 0, f.h - 1), i = y * f.w + x;
    const e = F.elevAt(f, cc[0], cc[1]), land = e >= f.sea;
    return { elev: e, up: land ? (e - f.sea) / (255 - f.sea) : 0, depth: land ? 0 : (f.sea - e) / f.sea, land, temp: c.temp[i], rain: c.rain[i], biome: land ? c.bio[i] : 0, name: land ? BIOMES[c.bio[i]][1] : e > f.sea - 18 ? 'Shallow sea' : 'Deep sea' };
  }
  /** rivers as smooth strokes widening downstream (cell coordinates → canvas of bw × bh) */
  function drawRivers(g, f, bw, bh, mode, style) {
    const c = f.cache;
    if (!c || !c.rivers) return;
    const L = look(mode, style), pal = PAL[L.pal] || PAL.natural;
    g.save(); g.lineCap = 'round'; g.lineJoin = 'round';
    g.strokeStyle = mode === 'temp' || mode === 'rain' ? 'rgba(255,255,255,.55)' : L.pal === 'plain' ? '#8fb3d4' : 'rgb(' + pal.lake.map(v => Math.round(v * .8)).join(',') + ')';
    const sx = bw / f.w, sy = bh / f.h, sc = Math.max(.6, bw / 1600);
    for (const line of c.rivers) {
      const pts = F.chaikin(line.map(p => [p[0] * sx, p[1] * sy, p[2]]), 2), a0 = line[0][2];
      for (let i = 0; i < pts.length - 1; i++) {
        const acc = line[Math.min(line.length - 1, Math.floor(i / 4))][2];
        g.lineWidth = Math.max(.5, Math.min(4.5, Math.sqrt(Math.max(0, acc - a0 * .6)) * .09)) * sc;
        g.beginPath(); g.moveTo(pts[i][0], pts[i][1]); g.lineTo(pts[i + 1][0], pts[i + 1][1]); g.stroke();
      }
    }
    g.restore();
  }
  return { paint, look, probe, prep, drawRivers, PAL, RAMP_TEMP, RAMP_RAIN, ramp };
});
