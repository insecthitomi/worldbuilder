/* Atlas view: draws one map — image (or parchment), grid, graticule, territories, routes, names and pins — on a
   canvas, keeps the pan/zoom transform and answers hit tests. The live map, the mini map on entry pages and the PNG
   export all draw through this, so they always look the same. Coordinates: map = image pixels; screen = CSS px of
   the canvas as measured on screen (the backing store is scaled by devicePixelRatio). */
(function (root) {
  'use strict';
  const GK = root.GK, WB = root.WB;
  const V = WB.atlasView = {};
  const Geo = () => root.WBGeo;
  const SERIF = "Georgia, 'Palatino Linotype', 'Book Antiqua', Palatino, serif";
  const PALETTE = ['#2f7fb0', '#c0503c', '#5f9f4f', '#8a6bbf', '#c9922e', '#3f8f8a', '#b5527a', '#7a8a3a', '#4a6fc4', '#a0603a', '#6a8fa0', '#9c4f9c'];
  const hash = s => { let h = 2166136261; for (let i = 0; i < s.length; i++) { h ^= s.charCodeAt(i); h = Math.imul(h, 16777619); } return h >>> 0; };
  const typeKey = it => { const t = it.entry && WB.types.get(it.entry.typeId); return t ? t.key : ''; };

  /** the colour an item draws in: its own, its nation's colours field, the entry's colour, then a stable palette pick */
  V.colorOf = function (it) {
    if (it.style && it.style.color) return it.style.color;
    const e = it.entry;
    if (e && e.colors && /^#[0-9a-f]{6}$/i.test(e.colors)) return e.colors;
    if (e && e.color) return e.color;
    if (it.kind === 'region') return PALETTE[hash(it.entryId || it.label || it.id) % PALETTE.length];
    if (it.kind === 'path') return '#9a5f2a';
    if (it.kind === 'label') return '#2b2116';
    const t = e && WB.types.get(e.typeId);
    return (t && t.color) || '#c0503c';
  };
  V.titleOf = it => it.label || (it.entry && it.entry.title) || (it.kind === 'region' ? 'Region' : it.kind === 'path' ? 'Path' : it.kind === 'label' ? 'Label' : 'Pin');
  V.iconOf = it => (it.style && it.style.icon) || WB.atlasIcons.forEntry(typeKey(it));
  /** effective dates: the item's own, else (places, factions) the entry's existence; events show from their start on */
  V.datesOf = function (it) {
    let s = it.start, e = it.end;
    if (!s && !e && it.entry) {
      const k = typeKey(it);
      if (k === 'place' || k === 'faction') { s = it.entry.start; e = it.entry.end; }
      else if (k === 'event') s = it.entry.start;
    }
    return { start: s, end: e };
  };
  const mix = (hex, to, f) => {
    const p = h => [parseInt(h.slice(1, 3), 16), parseInt(h.slice(3, 5), 16), parseInt(h.slice(5, 7), 16)];
    if (!/^#[0-9a-f]{6}$/i.test(hex)) return hex;
    const a = p(hex), b = to === 'white' ? [255, 255, 255] : to === 'black' ? [0, 0, 0] : p(to);
    return 'rgb(' + a.map((v, i) => Math.round(v + (b[i] - v) * f)).join(',') + ')';
  };
  const rgba = (hex, a) => (/^#[0-9a-f]{6}$/i.test(hex) ? 'rgba(' + [1, 3, 5].map(i => parseInt(hex.slice(i, i + 2), 16)).join(',') + ',' + a + ')' : hex);
  const lum = hex => (/^#[0-9a-f]{6}$/i.test(hex) ? (0.2126 * parseInt(hex.slice(1, 3), 16) + 0.7152 * parseInt(hex.slice(3, 5), 16) + 0.0722 * parseInt(hex.slice(5, 7), 16)) / 255 : 0.3);
  V.mix = mix; V.rgba = rgba;

  let parchment = null;
  function parchmentPattern(g) {
    if (!parchment) {
      const c = document.createElement('canvas'); c.width = c.height = 160;
      const x = c.getContext('2d');
      x.fillStyle = '#e9dcbb'; x.fillRect(0, 0, 160, 160);
      let s = 7;
      const r = () => ((s = (s * 16807) % 2147483647) / 2147483647);
      for (let i = 0; i < 900; i++) { x.fillStyle = r() < .5 ? 'rgba(120,90,40,.05)' : 'rgba(255,250,235,.08)'; x.fillRect(r() * 160, r() * 160, 1 + r() * 3, 1 + r() * 3); }
      parchment = c;
    }
    return g.createPattern(parchment, 'repeat');
  }

  V.create = function (canvas, opts = {}) {
    const g = canvas.getContext('2d');
    const v = {
      canvas, g, data: null, img: null, items: [], t: { x: 0, y: 0, k: 1 }, w: 0, h: 0, dpr: 1, ui: 1,
      opt: Object.assign({ day: null, allTimes: false, selected: null, hover: null, filter: null, handles: false, labels: true, graticule: true, background: null }, opts),
      overlay: null, onDraw: null, cache: new Map(), raf: 0,
    };

    v.measure = function () {
      const r = canvas.getBoundingClientRect(), dpr = root.devicePixelRatio || 1;
      const w = Math.max(1, Math.round(r.width)), h = Math.max(1, Math.round(r.height));
      v.ui = (parseFloat(getComputedStyle(canvas).fontSize) || 14) * GK.zoomOf(canvas) / 14;
      if (w === v.w && h === v.h && dpr === v.dpr) return false;
      // keep what was in the middle in the middle when the canvas changes size (panels opening, window resizes)
      if (v.w > 1 && v.h > 1) { v.t.x += (w - v.w) / 2; v.t.y += (h - v.h) / 2; }
      v.w = w; v.h = h; v.dpr = dpr;
      canvas.width = Math.round(w * dpr); canvas.height = Math.round(h * dpr);
      return true;
    };
    /** fixed size (export, offscreen) */
    v.size = function (w, h, dpr = 1, ui = 1) { v.w = w; v.h = h; v.dpr = dpr; v.ui = ui; canvas.width = Math.round(w * dpr); canvas.height = Math.round(h * dpr); };
    v.setMap = function (data, img) { v.data = data; v.img = img || null; v.cache.clear(); };
    v.setItems = function (items) { v.items = items || []; v.cache.clear(); };
    v.toMap = (sx, sy) => [(sx - v.t.x) / v.t.k, (sy - v.t.y) / v.t.k];
    v.toScreen = (mx, my) => [mx * v.t.k + v.t.x, my * v.t.k + v.t.y];
    v.fitK = () => (v.data ? Math.min(v.w / v.data.width, v.h / v.data.height) * 0.94 : 1);
    v.fit = function () { if (!v.data) return; const k = v.fitK(); v.t = { k, x: (v.w - v.data.width * k) / 2, y: (v.h - v.data.height * k) / 2 }; v.draw(); };
    v.centerOn = function (mx, my, k) { k = k || v.t.k; v.t = { k, x: v.w / 2 - mx * k, y: v.h / 2 - my * k }; v.clamp(); v.draw(); };
    v.limits = () => { const f = v.fitK(); return [f / 3, Math.max(f * 40, 8)]; };
    v.zoomAt = function (sx, sy, f) {
      const [lo, hi] = v.limits(), k = Math.max(lo, Math.min(hi, v.t.k * f));
      const [mx, my] = v.toMap(sx, sy);
      v.t = { k, x: sx - mx * k, y: sy - my * k };
      v.clamp(); v.draw();
    };
    v.pan = function (dx, dy) { v.t.x += dx; v.t.y += dy; v.clamp(); v.draw(); };
    /** keep at least part of the map on screen */
    v.clamp = function () {
      if (!v.data) return;
      const mw = v.data.width * v.t.k, mh = v.data.height * v.t.k, m = 80;
      v.t.x = Math.min(v.w - m, Math.max(m - mw, v.t.x));
      v.t.y = Math.min(v.h - m, Math.max(m - mh, v.t.y));
    };

    /* ---------- which items show ---------- */
    v.layerOn = id => { const L = v.data && v.data.layers.find(l => l.id === id); return !L || L.visible; };
    v.isAlive = it => { const d = V.datesOf(it); return Geo().alive(d.start, d.end, v.opt.day); };
    v.visible = function (it) {
      if (it.entry && it.entry.deletedAt) return false;
      if (!v.layerOn(it.layer)) return false;
      if (v.opt.filter && !v.opt.filter(it)) return false;
      if (v.opt.day != null && !v.opt.allTimes && !v.isAlive(it)) return false;
      return true;
    };
    v.shown = () => v.items.filter(v.visible);
    const meta = it => {
      let m = v.cache.get(it.id);
      if (!m || m.ver !== it.updatedAt + ':' + it.points.length) {
        m = { ver: it.updatedAt + ':' + it.points.length };
        if (it.points.length) { m.bbox = Geo().bbox(it.points); if (it.kind === 'region') { m.lp = Geo().labelPoint(it.points); m.area = Geo().polyArea(it.points); } }
        v.cache.set(it.id, m);
      }
      return m;
    };

    /* ---------- drawing ---------- */
    v.draw = function () { if (!v.raf) v.raf = requestAnimationFrame(() => { v.raf = 0; v.render(); }); };
    v.render = function () {
      const { g, t } = v;
      g.setTransform(v.dpr, 0, 0, v.dpr, 0, 0);
      g.clearRect(0, 0, v.w, v.h);
      if (v.opt.background) { g.fillStyle = v.opt.background; g.fillRect(0, 0, v.w, v.h); }
      if (!v.data) return;
      const D = v.data, mw = D.width * t.k, mh = D.height * t.k;
      // the sheet: a soft shadow, then the image or parchment
      g.save();
      g.shadowColor = 'rgba(0,0,0,.35)'; g.shadowBlur = 24 * v.ui; g.shadowOffsetY = 6 * v.ui;
      g.fillStyle = '#e9dcbb'; g.fillRect(t.x, t.y, mw, mh);
      g.restore();
      if (v.baseCanvas) {
        g.imageSmoothingEnabled = true; g.imageSmoothingQuality = t.k < 1.5 ? 'high' : 'medium';
        g.drawImage(v.baseCanvas, t.x, t.y, mw, mh);
      } else if (v.img && v.img.complete && v.img.naturalWidth) {
        g.imageSmoothingEnabled = true; g.imageSmoothingQuality = t.k < 1.5 ? 'high' : 'medium';
        g.drawImage(v.img, t.x, t.y, mw, mh);
      } else {
        g.save(); g.translate(t.x, t.y); g.fillStyle = parchmentPattern(g); g.fillRect(0, 0, mw, mh); g.restore();
      }
      g.save();
      g.beginPath(); g.rect(t.x, t.y, mw, mh); g.clip();
      if (v.under) v.under(g, v);
      drawGrid();
      if (Geo().isPlanet(D) && v.opt.graticule) drawGraticule();
      const shown = v.shown();
      for (const it of shown) if (it.kind === 'region') drawRegion(it);
      for (const it of shown) if (it.kind === 'path') drawPath(it);
      if (v.mid) v.mid(g, v);
      if (v.opt.regionLabels !== false) {
        const pinsS = shown.filter(it => it.kind === 'pin').map(it => { const [x, y] = v.toScreen(it.x, it.y); return [x, y, v.pinRadius(it)]; });
        for (const it of shown) if (it.kind === 'region') regionLabel(it, pinsS);
      }
      for (const it of shown) if (it.kind === 'label') drawLabel(it);
      g.restore();
      if (v.opt.pinDim != null && v.opt.pinDim < 1) g.globalAlpha = v.opt.pinDim;
      drawPins(shown.filter(it => it.kind === 'pin'));
      g.globalAlpha = 1;
      if (v.opt.multi && v.opt.multi.size) drawMulti();
      const sel = v.opt.selected && v.items.find(i => i.id === v.opt.selected);
      if (sel && v.opt.handles && (sel.kind === 'region' || sel.kind === 'path')) drawHandles(sel);
      if (v.overlay) { g.save(); v.overlay(g, v); g.restore(); }
      v.onDraw && v.onDraw();
    };
    const tracePoly = (pts, close) => {
      const { g, t } = v;
      g.beginPath();
      for (let i = 0; i < pts.length; i++) { const x = pts[i][0] * t.k + t.x, y = pts[i][1] * t.k + t.y; if (i) g.lineTo(x, y); else g.moveTo(x, y); }
      if (close) g.closePath();
    };
    v.tracePoly = tracePoly;
    const faded = it => v.opt.day != null && v.opt.allTimes && !v.isAlive(it);

    function drawGrid() {
      const G = v.data.grid;
      if (!G || G.type === 'none') return;
      const { g, t } = v, s = G.size, ss = s * t.k;
      if (ss < 7) return;
      const [x0, y0] = v.toMap(0, 0), [x1, y1] = v.toMap(v.w, v.h);
      g.save();
      g.strokeStyle = G.color || 'rgba(40,30,20,1)'; g.globalAlpha = G.opacity == null ? .35 : G.opacity; g.lineWidth = 1;
      g.beginPath();
      if (G.type === 'square') {
        for (let x = Math.max(0, Math.floor(x0 / s) * s); x <= Math.min(v.data.width, x1); x += s) { const X = Math.round(x * t.k + t.x) + .5; g.moveTo(X, Math.max(t.y, 0)); g.lineTo(X, Math.min(v.data.height * t.k + t.y, v.h)); }
        for (let y = Math.max(0, Math.floor(y0 / s) * s); y <= Math.min(v.data.height, y1); y += s) { const Y = Math.round(y * t.k + t.y) + .5; g.moveTo(Math.max(t.x, 0), Y); g.lineTo(Math.min(v.data.width * t.k + t.x, v.w), Y); }
      } else {
        // flat-topped hexes: s = width corner to corner
        const r = s / 2, hh = Math.sqrt(3) * r, dx = 1.5 * r;
        const c0 = Math.max(0, Math.floor(x0 / dx) - 1), c1 = Math.min(Math.ceil(v.data.width / dx), Math.ceil(x1 / dx) + 1);
        for (let c = c0; c <= c1; c++) {
          const cx = c * dx, off = (c % 2) * hh / 2;
          const r0 = Math.max(0, Math.floor((y0 - off) / hh) - 1), r1 = Math.min(Math.ceil(v.data.height / hh), Math.ceil((y1 - off) / hh) + 1);
          for (let q = r0; q <= r1; q++) {
            const cy = q * hh + off;
            for (let i = 0; i <= 6; i++) { const a = (Math.PI / 3) * i, x = (cx + r * Math.cos(a)) * t.k + t.x, y = (cy + r * Math.sin(a)) * t.k + t.y; if (i) g.lineTo(x, y); else g.moveTo(x, y); }
          }
        }
      }
      g.stroke();
      g.restore();
    }
    function drawGraticule() {
      const { g } = v, D = v.data, G = Geo();
      const step = v.t.k * D.width / 360 * 15 > 60 ? 15 : 30;
      g.save();
      g.lineWidth = 1; g.strokeStyle = 'rgba(255,255,255,.35)';
      g.beginPath();
      for (let lon = -180; lon <= 180; lon += step) { const [x] = G.toXY(lon, 0, D.width, D.height); const X = x * v.t.k + v.t.x; g.moveTo(X, v.t.y); g.lineTo(X, D.height * v.t.k + v.t.y); }
      for (let lat = -90 + step; lat < 90; lat += step) { const [, y] = G.toXY(0, lat, D.width, D.height); const Y = y * v.t.k + v.t.y; g.moveTo(v.t.x, Y); g.lineTo(D.width * v.t.k + v.t.x, Y); }
      g.stroke();
      g.strokeStyle = 'rgba(255,255,255,.6)'; g.setLineDash([6, 4]);
      g.beginPath(); const Y = D.height / 2 * v.t.k + v.t.y; g.moveTo(v.t.x, Y); g.lineTo(D.width * v.t.k + v.t.x, Y); g.stroke();
      g.restore();
    }
    function drawRegion(it) {
      if (it.points.length < 3) return;
      const { g } = v, c = V.colorOf(it), sel = v.opt.selected === it.id, hov = v.opt.hover === it.id, fade = faded(it);
      const fill = (it.style.fill == null ? .22 : it.style.fill) * (v.opt.regionFill == null ? 1 : v.opt.regionFill);
      g.save();
      if (fade) g.globalAlpha = .35;
      tracePoly(it.points, true);
      g.fillStyle = rgba(c, Math.min(.85, fill + (hov ? .08 : 0) + (sel ? .06 : 0)));
      g.fill();
      // a band of colour just inside the border: the classic way atlases draw country lines
      g.save(); g.clip();
      g.lineWidth = Math.max(4, Math.min(14, 9 * v.ui * Math.sqrt(v.t.k / v.fitK())));
      g.strokeStyle = rgba(c, .38 * (v.opt.regionFill == null ? 1 : Math.max(.3, v.opt.regionFill))); g.lineJoin = 'round'; g.stroke();
      g.restore();
      g.lineJoin = 'round';
      g.lineWidth = (sel ? 2.6 : 1.6) * v.ui;
      g.strokeStyle = mix(c, 'black', .25);
      if (it.style.dashed || fade) g.setLineDash([7 * v.ui, 4 * v.ui]);
      g.stroke();
      g.restore();
    }
    function regionLabel(it, pinsS = []) {
      if (it.points.length < 3 || it.style.hideLabel || faded(it)) return;
      const m = meta(it), { g, t } = v, text = V.titleOf(it).toUpperCase();
      const sw = m.bbox.w * t.k, sh = m.bbox.h * t.k;
      let size = Math.max(9, Math.min(28 * v.ui, Math.sqrt(m.area) * t.k / 12)) * (it.style.labelSize || 1);
      let x = m.lp[0] * t.k + t.x, y = m.lp[1] * t.k + t.y;
      if (x < -200 || y < -50 || x > v.w + 200 || y > v.h + 50) return;
      g.save();
      if (faded(it)) g.globalAlpha = .45;
      g.font = '600 ' + size + 'px ' + SERIF;
      try { g.letterSpacing = (size * .14) + 'px'; } catch { }
      let tw = g.measureText(text).width;
      if (tw > sw * .95) { size = size * sw * .95 / tw; if (size < 8) { g.restore(); return; } g.font = '600 ' + size + 'px ' + SERIF; try { g.letterSpacing = (size * .14) + 'px'; } catch { } tw = g.measureText(text).width; }
      if (size > sh * .6) { g.restore(); return; }
      // move the name off any pins: try spots above and below, then sideways, staying inside the territory
      const clear = (cx, cy, w, s) => !pinsS.some(([px, py, r]) => px + r > cx - w / 2 - 4 && px - r < cx + w / 2 + 4 && py + r + s * 1.3 > cy - s * .6 && py - r < cy + s * .6);
      const inside = (cx, cy, w) => {
        const mx = (cx - t.x) / t.k, my = (cy - t.y) / t.k, hw = (w / 2 + 16) / t.k, D = v.data;
        if (mx - hw < 0 || mx + hw > D.width || my - size / t.k < 0 || my + size / t.k > D.height) return false;
        return Geo().inPoly(mx, my, it.points) && Geo().inPoly(mx - hw, my, it.points) && Geo().inPoly(mx + hw, my, it.points);
      };
      if (!clear(x, y, tw, size)) {
        let found = null;
        for (const f of [1, .8, .66]) {
          const s = size * f, w = tw * f, st = s * 1.5;
          const cands = [0, 1, -1, 2, -2, 3, -3, 4, -4, 5, -5, 6, -6].map(d => [x, y + d * st]).concat([[x - w * .4, y], [x + w * .4, y], [x - w * .4, y + st * 2], [x + w * .4, y - st * 2]]);
          const ok = cands.find(([cx, cy]) => clear(cx, cy, w, s) && inside(cx, cy, w));
          if (ok) { found = [ok[0], ok[1], s]; break; }
        }
        if (found) {
          [x, y] = found;
          if (found[2] !== size) { size = found[2]; g.font = '600 ' + size + 'px ' + SERIF; try { g.letterSpacing = (size * .14) + 'px'; } catch { } tw = g.measureText(text).width; }
        }
      }
      // never past the edge of the sheet
      const left = t.x + tw / 2 + 10, right = t.x + v.data.width * t.k - tw / 2 - 10;
      if (left < right) x = Math.max(left, Math.min(right, x));
      const c = V.colorOf(it);
      g.textAlign = 'center'; g.textBaseline = 'middle';
      g.lineWidth = Math.max(2, size * .22); g.lineJoin = 'round'; g.strokeStyle = 'rgba(250,246,234,.78)';
      g.strokeText(text, x, y);
      g.fillStyle = mix(c, 'black', .45);
      g.fillText(text, x, y);
      g.restore();
    }
    const PATH = {
      road: { casing: 'rgba(250,244,226,.85)', w: 2.6 },
      street: { casing: 'rgba(250,244,226,.85)', w: 2.2 },
      track: { dash: [6, 4], w: 2 },
      river: { color: '#4d86a5', w: 3.4, casing: 'rgba(235,245,245,.7)' },
      sea: { color: '#eef6f8', dash: [8, 6], w: 2 },
      wall: { color: '#3a3128', w: 4 },
      border: { dash: [10, 4, 2, 4], w: 2 },
      route: { dash: [2, 5], w: 3, round: true },
    };
    function drawPath(it) {
      if (it.points.length < 2) return;
      const { g } = v, kind = PATH[it.style.kind] || PATH.route, sel = v.opt.selected === it.id, hov = v.opt.hover === it.id;
      const c = it.style.color || kind.color || V.colorOf(it), w = (it.style.width || kind.w) * v.ui * (hov ? 1.25 : 1);
      g.save();
      if (faded(it)) g.globalAlpha = .4;
      g.lineJoin = 'round'; g.lineCap = 'round';
      tracePoly(it.points, false);
      if (sel) { g.lineWidth = w + 7 * v.ui; g.strokeStyle = 'rgba(255,255,255,.55)'; g.stroke(); }
      if (kind.casing) { g.lineWidth = w + 3 * v.ui; g.strokeStyle = kind.casing; g.stroke(); }
      g.lineWidth = w; g.strokeStyle = c;
      const dash = it.style.dashed && !kind.dash ? [7, 5] : kind.dash;
      if (dash) g.setLineDash(dash.map(d => d * v.ui * (kind.round ? 1.2 : 1)));
      g.stroke();
      g.setLineDash([]);
      // the name along the path, upright
      if (v.opt.labels && !it.style.hideLabel && (it.label || it.entry)) {
        const text = V.titleOf(it), size = 11.5 * v.ui;
        g.font = 'italic 600 ' + size + 'px ' + SERIF;
        const tw = g.measureText(text).width;
        const len = Geo().pathLength(it.points) * v.t.k;
        if (len > tw * 1.6) {
          const a = Geo().along(it.points, .5);
          let ang = a.angle;
          if (ang > Math.PI / 2) ang -= Math.PI; else if (ang < -Math.PI / 2) ang += Math.PI;
          const [x, y] = v.toScreen(a.x, a.y);
          g.translate(x, y); g.rotate(ang);
          g.textAlign = 'center'; g.textBaseline = 'bottom';
          g.lineWidth = 3; g.strokeStyle = 'rgba(250,246,234,.85)'; g.strokeText(text, 0, -w / 2 - 2);
          g.fillStyle = mix(/^#/.test(c) && lum(c) > .8 ? '#2f5f7a' : c, 'black', .35); g.fillText(text, 0, -w / 2 - 2);
        }
      }
      g.restore();
    }
    function drawMulti() {
      const { g } = v;
      g.save(); g.lineWidth = 1.6 * v.ui; g.setLineDash([5 * v.ui, 3 * v.ui]); g.strokeStyle = '#fff'; g.fillStyle = 'rgba(80,160,255,.14)';
      for (const it of v.items) {
        if (!v.opt.multi.has(it.id) || !v.visible(it)) continue;
        const b = root.WBField.itemBox(it), p0 = v.toScreen(b.x0, b.y0), p1 = v.toScreen(b.x1, b.y1), pad = (it.kind === 'pin' ? v.pinRadius(it) + 5 : it.kind === 'label' ? 16 * v.ui : 6) * (it.kind === 'pin' ? 1 : 1);
        g.beginPath(); g.roundRect(p0[0] - pad, p0[1] - pad, p1[0] - p0[0] + pad * 2, p1[1] - p0[1] + pad * 2, 5); g.fill(); g.stroke();
      }
      g.restore();
    }
    function drawLabel(it) {
      if (it.points && it.points.length > 1 && WB.atlasLabels) return WB.atlasLabels.drawAlong(v, it, { SERIF, lum, faded: faded(it) });
      if (it.style.curve && WB.atlasLabels) return WB.atlasLabels.drawArc(v, it, { SERIF, lum, faded: faded(it) });
      const { g, t } = v, st = it.style, size = (st.size || 18) * t.k;
      if (size < 6 * v.ui) return;
      const text0 = it.label || (it.entry && it.entry.title) || '';
      if (!text0) return;
      const text = st.caps ? text0.toUpperCase() : text0;
      const [x, y] = v.toScreen(it.x, it.y);
      if (x < -600 || y < -200 || x > v.w + 600 || y > v.h + 200) return;
      const c = st.color || '#2b2116', light = lum(c) > .6, sel = v.opt.selected === it.id, hov = v.opt.hover === it.id;
      g.save();
      if (faded(it)) g.globalAlpha = .4;
      g.translate(x, y); g.rotate((st.angle || 0) * Math.PI / 180);
      g.font = (st.italic ? 'italic ' : '') + '600 ' + Math.min(size, 160 * v.ui) + 'px ' + SERIF;
      try { g.letterSpacing = st.caps ? (size * .16) + 'px' : '0px'; } catch { }
      g.textAlign = 'center'; g.textBaseline = 'middle';
      const lines = text.split('\n');
      const lh = size * 1.15;
      lines.forEach((ln, i) => {
        const yy = (i - (lines.length - 1) / 2) * lh;
        g.lineJoin = 'round'; g.lineWidth = Math.max(2, size * .16); g.strokeStyle = light ? 'rgba(20,30,40,.45)' : 'rgba(250,246,234,.7)';
        g.strokeText(ln, 0, yy);
        g.fillStyle = c; g.fillText(ln, 0, yy);
      });
      if (sel || hov) {
        const tw = Math.max(...lines.map(l => g.measureText(l).width));
        g.strokeStyle = sel ? 'rgba(255,255,255,.9)' : 'rgba(255,255,255,.5)'; g.lineWidth = 1.5; g.setLineDash([4, 3]);
        g.strokeRect(-tw / 2 - 6, -lh * lines.length / 2 - 3, tw + 12, lh * lines.length + 6);
      }
      g.restore();
    }
    v.pinRadius = it => 10.5 * v.ui * (it.style.size || 1);
    function drawPins(pins) {
      const { g } = v, placed = [];
      // big and selected pins first get their names placed
      const order = pins.slice().sort((a, b) => (b.style.size || 1) - (a.style.size || 1));
      const labels = [];
      for (const it of order) {
        const [x, y] = v.toScreen(it.x, it.y);
        if (x < -40 || y < -40 || x > v.w + 40 || y > v.h + 40) continue;
        if (!v.opt.labels || it.style.hideLabel) continue;
        const r = v.pinRadius(it), text = V.titleOf(it), size = 11.5 * v.ui * Math.max(.9, Math.min(1.25, it.style.size || 1));
        g.font = '600 ' + size + 'px ' + SERIF;
        const tw = g.measureText(text).width;
        const box = { x0: x - tw / 2 - 3, x1: x + tw / 2 + 3, y0: y + r + 2, y1: y + r + 4 + size };
        const force = v.opt.selected === it.id || v.opt.hover === it.id;
        if (!force && placed.some(b => !(box.x1 < b.x0 || box.x0 > b.x1 || box.y1 < b.y0 || box.y0 > b.y1))) continue;
        placed.push(box, { x0: x - r, x1: x + r, y0: y - r, y1: y + r });
        labels.push([it, text, x, box.y0, size]);
      }
      for (const it of pins) drawPin(it);
      g.save();
      g.textAlign = 'center'; g.textBaseline = 'top'; g.lineJoin = 'round';
      for (const [it, text, x, y, size] of labels) {
        g.globalAlpha = faded(it) ? .45 : 1;
        g.font = '600 ' + size + 'px ' + SERIF;
        g.lineWidth = 3.4; g.strokeStyle = 'rgba(250,246,234,.92)'; g.strokeText(text, x, y);
        g.fillStyle = '#20180f'; g.fillText(text, x, y);
      }
      g.restore();
    }
    function drawPin(it) {
      const { g } = v, [x, y] = v.toScreen(it.x, it.y);
      if (x < -40 || y < -40 || x > v.w + 40 || y > v.h + 40) return;
      const sel = v.opt.selected === it.id, hov = v.opt.hover === it.id;
      const r = v.pinRadius(it) * (hov ? 1.12 : 1), c = V.colorOf(it), icon = V.iconOf(it);
      g.save();
      if (faded(it)) g.globalAlpha = .45;
      if (sel) { g.beginPath(); g.arc(x, y, r + 5 * v.ui, 0, Math.PI * 2); g.fillStyle = 'rgba(255,255,255,.35)'; g.fill(); g.lineWidth = 2; g.strokeStyle = '#fff'; g.stroke(); }
      g.shadowColor = 'rgba(0,0,0,.45)'; g.shadowBlur = 5 * v.ui; g.shadowOffsetY = 1.5 * v.ui;
      g.beginPath(); g.arc(x, y, r, 0, Math.PI * 2);
      const grd = g.createRadialGradient(x - r * .35, y - r * .4, r * .1, x, y, r);
      grd.addColorStop(0, mix(c, 'white', .28)); grd.addColorStop(1, mix(c, 'black', .12));
      g.fillStyle = grd; g.fill();
      g.shadowColor = 'transparent';
      g.lineWidth = 1.6 * v.ui; g.strokeStyle = 'rgba(255,255,255,.92)'; g.stroke();
      const s = r * 1.25 / 24;
      g.translate(x - 12 * s, y - 12 * s); g.scale(s, s);
      g.fillStyle = lum(c) > .75 ? '#2a2015' : '#fff';
      g.fill(WB.atlasIcons.path(icon), WB.atlasIcons.rule(icon));
      g.setTransform(v.dpr, 0, 0, v.dpr, 0, 0);
      if (it.subMapId) {
        // a sub-map badge: a small folded-map square at the lower right
        const bx = x + r * .72, by = y + r * .72, br = 5.2 * v.ui;
        g.beginPath(); g.arc(bx, by, br, 0, Math.PI * 2); g.fillStyle = '#fff'; g.fill();
        g.lineWidth = 1.2; g.strokeStyle = mix(c, 'black', .3); g.stroke();
        g.fillStyle = mix(c, 'black', .3); g.fillRect(bx - br * .45, by - br * .45, br * .9, br * .9);
        g.fillStyle = '#fff'; g.fillRect(bx - br * .15, by - br * .45, br * .3, br * .9);
      }
      g.restore();
    }
    /** corners far enough apart on screen to grab: dense coastlines only show their handles when zoomed in */
    v.handleIdx = function (it) {
      const pts = it.points.map(p => v.toScreen(p[0], p[1])), keep = [];
      let last = null;
      for (let i = 0; i < pts.length; i++) { if (!last || Math.hypot(pts[i][0] - last[0], pts[i][1] - last[1]) >= 14 * v.ui) { keep.push(i); last = pts[i]; } }
      return { pts, keep, dense: keep.length < pts.length };
    };
    function drawHandles(it) {
      const { g } = v, closed = it.kind === 'region';
      g.save();
      const { pts, keep, dense } = v.handleIdx(it);
      // midpoints (drag to add a corner) where the edge is long enough and every corner shows
      g.fillStyle = 'rgba(255,255,255,.75)';
      if (!dense) for (let i = 0; i < pts.length - (closed ? 0 : 1); i++) {
        const a = pts[i], b = pts[(i + 1) % pts.length];
        if (Math.hypot(b[0] - a[0], b[1] - a[1]) < 26) continue;
        g.beginPath(); g.arc((a[0] + b[0]) / 2, (a[1] + b[1]) / 2, 3.2 * v.ui, 0, Math.PI * 2); g.fill();
      }
      for (const [x, y] of keep.map(i => pts[i])) {
        g.beginPath(); g.rect(x - 4.5 * v.ui, y - 4.5 * v.ui, 9 * v.ui, 9 * v.ui);
        g.fillStyle = '#fff'; g.fill(); g.lineWidth = 1.5; g.strokeStyle = '#1d4f7a'; g.stroke();
      }
      g.restore();
    }

    /* ---------- hit testing (screen px) ---------- */
    v.hit = function (sx, sy, { handles = false } = {}) {
      const shown = v.shown();
      const G = Geo();
      if (handles && v.opt.selected) {
        const it = v.items.find(i => i.id === v.opt.selected);
        if (it && (it.kind === 'region' || it.kind === 'path')) {
          const { pts, keep, dense } = v.handleIdx(it);
          for (let k = keep.length - 1; k >= 0; k--) { const i = keep[k]; if (Math.abs(pts[i][0] - sx) <= 7 * v.ui && Math.abs(pts[i][1] - sy) <= 7 * v.ui) return { item: it, part: 'vertex', index: i }; }
          const closed = it.kind === 'region';
          if (!dense) for (let i = 0; i < pts.length - (closed ? 0 : 1); i++) {
            const a = pts[i], b = pts[(i + 1) % pts.length];
            if (Math.hypot(b[0] - a[0], b[1] - a[1]) < 26) continue;
            if (Math.hypot((a[0] + b[0]) / 2 - sx, (a[1] + b[1]) / 2 - sy) <= 6 * v.ui) return { item: it, part: 'mid', index: i };
          }
        }
      }
      for (let i = shown.length - 1; i >= 0; i--) {
        const it = shown[i];
        if (it.kind !== 'pin') continue;
        const [x, y] = v.toScreen(it.x, it.y);
        if (Math.hypot(x - sx, y - sy) <= v.pinRadius(it) + 3) return { item: it, part: 'body' };
      }
      const [mx, my] = v.toMap(sx, sy);
      for (let i = shown.length - 1; i >= 0; i--) {
        const it = shown[i];
        if (it.kind !== 'label') continue;
        const size = (it.style.size || 18) * v.t.k;
        if (size < 6 * v.ui) continue;
        if (it.points && it.points.length > 1) { if (G.nearestEdge(mx, my, it.points, false).d * v.t.k <= size * .7 + 4) return { item: it, part: 'body' }; continue; }
        const text = it.label || (it.entry && it.entry.title) || '';
        v.g.font = '600 ' + size + 'px ' + SERIF;
        const tw = Math.max(...text.split('\n').map(l => v.g.measureText(it.style.caps ? l.toUpperCase() : l).width)) * (it.style.caps ? 1.15 : 1);
        const [x, y] = v.toScreen(it.x, it.y), a = -(it.style.angle || 0) * Math.PI / 180;
        const dx = sx - x, dy = sy - y, rx = dx * Math.cos(a) - dy * Math.sin(a), ry = dx * Math.sin(a) + dy * Math.cos(a);
        if (Math.abs(rx) <= tw / 2 + 4 && Math.abs(ry) <= size * .6 * text.split('\n').length + 3) return { item: it, part: 'body' };
      }
      for (let i = shown.length - 1; i >= 0; i--) {
        const it = shown[i];
        if (it.kind !== 'path') continue;
        if (G.nearestEdge(mx, my, it.points, false).d * v.t.k <= 6 * v.ui + (it.style.width || 2)) return { item: it, part: 'body' };
      }
      let best = null;
      for (const it of shown) {
        if (it.kind !== 'region' || it.points.length < 3) continue;
        const m = meta(it);
        if (mx < m.bbox.x0 || mx > m.bbox.x1 || my < m.bbox.y0 || my > m.bbox.y1) continue;
        if (G.inPoly(mx, my, it.points) && (!best || m.area < best.area)) best = { item: it, area: m.area };
      }
      return best ? { item: best.item, part: 'body' } : null;
    };
    return v;
  };

  /** loads an image for a map (null for none); resolves when decoded */
  V.loadImage = async function (mediaId) {
    if (!mediaId) return null;
    const url = await WB.mediaUrl(mediaId);
    if (!url) return null;
    const img = new Image();
    img.decoding = 'async';
    img.src = url;
    try { await img.decode(); } catch { return null; }
    return img;
  };
})(window);
