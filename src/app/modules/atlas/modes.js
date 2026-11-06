/* Atlas view modes: Political, Terrain, Relief, Climate, Travel, Resources, Economy and the Parchment/Plain styles.
   Owns the terrain field of the open map (decoded from the map entry), paints it into a base canvas the view draws
   under everything, and draws what each mode adds on top: painted regions, decorative stamps, deposits, travel-time
   rings and the economy (nodes sized by population, flows as arrows along routes). */
(function (root) {
  'use strict';
  const GK = root.GK, WB = root.WB, F = root.WBField, R = root.WBAtlasRender;
  const h = GK.h;

  const MODES = [
    ['political', 'Political', '⬠', 'Territories and borders on a calm base'],
    ['terrain', 'Terrain', '⛰', 'Biome colours: forests, deserts, tundra'],
    ['relief', 'Relief', '◭', 'Hillshaded elevation'],
    ['climate', 'Climate', '☀', 'Temperature or rainfall as a heat map'],
    ['travel', 'Travel', '⏱', 'How far you get in a day, a week, a month from a point'],
    ['resources', 'Resources', '⛏', 'Deposits and resource regions'],
    ['economy', 'Economy', '⚖', 'Population, wealth, shortages and trade flows from a simulation'],
  ];
  const STYLES = [['natural', 'Natural'], ['parchment', 'Parchment'], ['plain', 'Plain']];
  const STAMPS = [['mountain', 'Mountains'], ['hills', 'Hills'], ['forest', 'Forest'], ['pine', 'Pines'], ['swamp', 'Marsh'], ['dunes', 'Dunes'], ['town', 'Town'], ['castle', 'Castle']];
  const REGION_COLORS = ['#c0503c', '#2f7fb0', '#5f9f4f', '#c9922e', '#8a6bbf', '#3f8f8a', '#b5527a', '#7a8a3a'];
  const NICE_DAYS = [1 / 24, 1 / 12, 1 / 6, .25, .5, 1, 2, 3, 5, 7, 10, 14, 20, 30, 50, 100, 200, 365];

  function create(ctx) {
    const { S, view } = ctx;
    const Geo = () => root.WBGeo;
    const M = { field: null, paint: null, mode: 'political', style: 'natural', climate: 'temp', travel: { mode: 'walk', origin: null }, base: null, baseKey: '', img: null, lastNote: '' };
    const baseScale = D => Math.min(1, 2400 / Math.max(D.width, D.height));

    /* ---------- data ↔ field ---------- */
    M.load = function (D) {
      M.field = D.terrain ? F.decode(D.terrain, D.width, D.height) : null;
      M.paint = D.paint ? F.decodePaint(D.paint, D.width, D.height) : null;
      M.base = null; M.baseKey = ''; M.img = null; M.reg = null; M.tcache = null;
    };
    M.hasField = () => !!M.field;
    /** the mode as the painter knows it */
    M.paintMode = () => (M.mode === 'climate' ? M.climate : M.mode === 'terrain' && M.style !== 'natural' ? M.style : M.mode);
    /** show or hide territory fills, dim pins, depending on the mode */
    function applyItemLook() {
      const o = view.opt;
      o.regionFill = { political: 1, terrain: .0, relief: 0, climate: 0, travel: .35, resources: .25, economy: .3 }[M.mode];
      o.pinDim = M.mode === 'economy' ? .55 : 1;
    }
    M.setMode = function (mode, style, climate) {
      if (mode) M.mode = MODES.some(m => m[0] === mode) ? mode : 'political';
      if (style) M.style = STYLES.some(s => s[0] === style) ? style : 'natural';
      if (climate) M.climate = climate === 'rain' ? 'rain' : 'temp';
      applyItemLook();
      M.rebase();
    };

    /* ---------- the base layer ---------- */
    M.rebase = function (force) {
      const D = S.data;
      if (!D) return;
      if (!M.field) { view.baseCanvas = null; view.draw(); return; }
      const key = [M.paintMode(), M.style, M.field.ver.elev, M.field.ver.biome, D.width, D.height].join('|');
      if (!force && key === M.baseKey && M.base) { view.baseCanvas = M.base; view.draw(); return; }
      const k = baseScale(D), bw = Math.max(16, Math.round(D.width * k)), bh = Math.max(16, Math.round(D.height * k));
      if (!M.base || M.base.width !== bw || M.base.height !== bh) { M.base = document.createElement('canvas'); M.base.width = bw; M.base.height = bh; M.img = null; }
      const g = M.base.getContext('2d', { willReadFrequently: true });
      M.img = g.createImageData(bw, bh);
      R.paint(M.field, M.paintMode(), bw, bh, M.img.data, 0, 0, bw, bh, M.style);
      g.putImageData(M.img, 0, 0);
      R.drawRivers(g, M.field, bw, bh, M.paintMode(), M.style);
      M.baseKey = key;
      view.baseCanvas = M.base;
      view.draw();
      if (S.globe && ctx.onBase) ctx.onBase();
    };
    /** repaint a map-pixel rectangle of the base canvas (during a brush stroke); rivers wait for the stroke to end */
    M.dirty = function (mx0, my0, mx1, my1) {
      if (!M.field || !M.base || !M.img) return;
      const D = S.data, k = M.base.width / D.width, W = M.base.width, H = M.base.height;
      const x0 = Math.max(0, Math.floor(mx0 * k) - 2), y0 = Math.max(0, Math.floor(my0 * k) - 2), x1 = Math.min(W, Math.ceil(mx1 * k) + 2), y1 = Math.min(H, Math.ceil(my1 * k) + 2);
      if (x1 <= x0 || y1 <= y0) return;
      R.paint(M.field, M.paintMode(), W, H, M.img.data, x0, y0, x1, y1, M.style, { live: true });
      M.base.getContext('2d').putImageData(M.img, 0, 0, x0, y0, x1 - x0, y1 - y0);
      M.baseKey = '';
      view.draw();
    };
    /** after a stroke: recompute drainage and repaint everything (rivers included) */
    M.settle = function () { if (M.field) { F.derive(M.field); M.rebase(true); M.tcache = null; } };

    /* ---------- hover read-out ---------- */
    M.describe = function (mx, my) {
      if (!M.field) return '';
      const p = R.probe(M.field, mx, my);
      if (!p.land) return p.name;
      return p.name + ' · ' + Math.round(p.up * 4200) + ' m · ' + Math.round(p.temp) + '°C · ' + Math.round(p.rain / 10) * 10 + ' mm';
    };

    /* ---------- painted regions ---------- */
    function regionLayer() {
      const p = M.paint;
      if (!p) return null;
      const key = p.reg.length + ':' + (p.ver || 0) + ':' + p.regs.map(r => r.id + r.color).join();
      if (M.reg && M.reg.key === key) return M.reg;
      const c = document.createElement('canvas'); c.width = p.w; c.height = p.h;
      const g = c.getContext('2d'), img = g.createImageData(p.w, p.h);
      const colors = new Map(p.regs.map(r => [r.id, r.color || '#c0503c']));
      for (let i = 0; i < p.reg.length; i++) {
        const id = p.reg[i];
        if (!id) continue;
        const col = colors.get(id) || '#c0503c';
        img.data[i * 4] = parseInt(col.slice(1, 3), 16); img.data[i * 4 + 1] = parseInt(col.slice(3, 5), 16); img.data[i * 4 + 2] = parseInt(col.slice(5, 7), 16); img.data[i * 4 + 3] = 255;
      }
      g.putImageData(img, 0, 0);
      const lines = [];
      for (const r of p.regs) {
        const grid = new Float32Array(p.w * p.h);
        let n = 0, sx = 0, sy = 0;
        for (let i = 0; i < grid.length; i++) if (p.reg[i] === r.id) { grid[i] = 1; n++; sx += i % p.w; sy += (i / p.w) | 0; }
        if (n) lines.push({ r, segs: F.contour(grid, p.w, p.h, .5), at: [(sx / n + .5) / p.w * p.mapW, (sy / n + .5) / p.h * p.mapH], n });
      }
      return (M.reg = { key, canvas: c, lines });
    }
    M.touchPaint = () => { if (M.paint) M.paint.ver = (M.paint.ver || 0) + 1; M.reg = null; view.draw(); };

    /* ---------- decorative stamps ---------- */
    function drawStamp(g, type, x, y, s, rot) {
      g.save(); g.translate(x, y); g.rotate(rot * Math.PI / 180);
      const ink = 'rgba(58,44,30,.92)', paper = 'rgba(240,231,205,.92)', dark = 'rgba(58,44,30,.28)';
      g.lineWidth = Math.max(1, s * .055); g.lineJoin = 'round'; g.lineCap = 'round'; g.strokeStyle = ink; g.fillStyle = paper;
      const name = STAMPS[type] ? STAMPS[type][0] : 'mountain';
      if (name === 'mountain') {
        g.beginPath(); g.moveTo(-s * .55, s * .38); g.lineTo(-s * .12, -s * .42); g.lineTo(s * .1, -s * .05); g.lineTo(s * .26, -s * .28); g.lineTo(s * .58, s * .38); g.closePath(); g.fill(); g.stroke();
        g.fillStyle = dark; g.beginPath(); g.moveTo(-s * .12, -s * .42); g.lineTo(s * .02, -s * .08); g.lineTo(-s * .06, s * .38); g.lineTo(-s * .2, s * .38); g.closePath(); g.fill();
        g.beginPath(); g.moveTo(s * .26, -s * .28); g.lineTo(s * .34, s * .02); g.lineTo(s * .28, s * .38); g.lineTo(s * .2, s * .38); g.closePath(); g.fill();
      } else if (name === 'hills') {
        g.beginPath(); g.arc(-s * .22, s * .2, s * .3, Math.PI, 0); g.stroke(); g.beginPath(); g.arc(s * .2, s * .24, s * .36, Math.PI, 0); g.stroke();
      } else if (name === 'forest') {
        for (const [dx, dy, r] of [[-.25, .05, .24], [.22, .0, .26], [0, -.22, .22]]) { g.beginPath(); g.moveTo(dx * s, (dy + r) * s); g.lineTo(dx * s, (dy + r + .2) * s); g.stroke(); g.beginPath(); g.arc(dx * s, dy * s, r * s, 0, Math.PI * 2); g.fillStyle = 'rgba(112,142,92,.88)'; g.fill(); g.stroke(); }
      } else if (name === 'pine') {
        for (const dx of [-.25, .25]) for (const dy of [0, .3]) { const cx = dx * s * (dy ? .5 : 1), top = (dy - .32) * s; g.beginPath(); g.moveTo(cx, top); g.lineTo(cx + s * .16, top + s * .42); g.lineTo(cx - s * .16, top + s * .42); g.closePath(); g.fillStyle = 'rgba(96,128,86,.9)'; g.fill(); g.stroke(); }
      } else if (name === 'swamp') {
        for (const dx of [-.25, 0, .25]) { g.beginPath(); g.moveTo(dx * s, s * .3); g.lineTo(dx * s, -s * .15); g.stroke(); g.beginPath(); g.moveTo(dx * s - s * .08, s * .32); g.lineTo(dx * s + s * .08, s * .32); g.stroke(); }
        g.beginPath(); g.moveTo(-s * .4, s * .36); g.lineTo(s * .4, s * .36); g.stroke();
      } else if (name === 'dunes') {
        for (const dy of [-.15, .15]) { g.beginPath(); g.moveTo(-s * .45, dy * s); g.quadraticCurveTo(-s * .2, (dy - .3) * s, 0, dy * s); g.quadraticCurveTo(s * .2, (dy + .3) * s, s * .45, dy * s); g.stroke(); }
      } else {
        const id = name === 'castle' ? 'castle' : 'town', k = s / 24 * 1.2;
        g.translate(-12 * k, -12 * k); g.scale(k, k); g.fillStyle = ink; g.fill(WB.atlasIcons.path(id), WB.atlasIcons.rule(id));
      }
      g.restore();
    }
    M.drawStamp = drawStamp;
    M.STAMPS = STAMPS;

    /* ---------- hooks the view calls ---------- */
    view.under = function (g, v) {
      const D = v.data, t = v.t;
      const rl = regionLayer();
      if (rl) {
        g.save(); g.imageSmoothingEnabled = true; g.imageSmoothingQuality = 'high';
        g.globalAlpha = M.mode === 'resources' ? .5 : .32; g.drawImage(rl.canvas, t.x, t.y, D.width * t.k, D.height * t.k); g.restore();
        g.save(); g.lineWidth = 1.6 * v.ui; g.lineJoin = 'round'; g.lineCap = 'round';
        for (const ln of rl.lines) {
          g.strokeStyle = ln.r.color || '#c0503c'; g.beginPath();
          const sx = D.width / M.paint.w * t.k, sy = D.height / M.paint.h * t.k;
          for (const s of ln.segs) { g.moveTo(s[0] * sx + t.x, s[1] * sy + t.y); g.lineTo(s[2] * sx + t.x, s[3] * sy + t.y); }
          g.stroke();
        }
        g.restore();
      }
      const st = D.stamps;
      if (st && st.length) for (const s of st) { const x = s[0] * t.k + t.x, y = s[1] * t.k + t.y, sz = (s[3] || 26) * t.k; if (x < -sz || y < -sz || x > v.w + sz || y > v.h + sz || sz < 3) continue; drawStamp(g, s[2], x, y, sz, s[4] || 0); }
    };
    view.mid = function (g, v) {
      if (rlLabels(g, v)) { /* painted region names */ }
      if (M.mode === 'resources') drawDeposits(g, v);
      else if (M.mode === 'travel') drawTravel(g, v);
      else if (M.mode === 'economy') drawEconomy(g, v);
    };
    function rlLabels(g, v) {
      const rl = M.reg; if (!rl || v.t.k < v.fitK() * .7) return false;
      g.save(); g.textAlign = 'center'; g.textBaseline = 'middle'; g.font = '700 ' + 12 * v.ui + 'px Georgia, serif';
      for (const ln of rl.lines) { if (!ln.r.name || ln.n < 6) continue; const [x, y] = v.toScreen(ln.at[0], ln.at[1]); g.lineWidth = 3; g.strokeStyle = 'rgba(250,246,234,.85)'; g.strokeText(ln.r.name.toUpperCase(), x, y); g.fillStyle = ln.r.color || '#333'; g.fillText(ln.r.name.toUpperCase(), x, y); }
      g.restore();
      return true;
    }

    /* ---------- resources ---------- */
    function drawDeposits(g, v) {
      const dep = v.data.deposits;
      if (!dep || !dep.length) return;
      g.save();
      for (const d of dep) {
        const [x, y] = v.toScreen(d[0], d[1]);
        if (x < -20 || y < -20 || x > v.w + 20 || y > v.h + 20) continue;
        const r = F.RES[d[2]] || F.RES[0], rad = (6 + (d[3] || 1) * 1.6) * v.ui * Math.min(1.8, Math.max(.7, Math.sqrt(v.t.k / v.fitK())));
        g.shadowColor = 'rgba(0,0,0,.4)'; g.shadowBlur = 4 * v.ui;
        g.beginPath(); g.arc(x, y, rad, 0, Math.PI * 2); g.fillStyle = r[2]; g.fill();
        g.shadowColor = 'transparent'; g.lineWidth = 1.6 * v.ui; g.strokeStyle = 'rgba(255,255,255,.92)'; g.stroke();
        const s = rad * 1.25 / 24; g.save(); g.translate(x - 12 * s, y - 12 * s); g.scale(s, s); g.fillStyle = '#fff'; g.fill(WB.atlasIcons.path(r[3]), WB.atlasIcons.rule(r[3])); g.restore();
        if (v.t.k > v.fitK() * 1.9) { g.font = '600 ' + 10.5 * v.ui + 'px Georgia, serif'; g.textAlign = 'center'; g.textBaseline = 'top'; g.lineWidth = 3; g.strokeStyle = 'rgba(250,246,234,.9)'; g.strokeText(r[1], x, y + rad + 2); g.fillStyle = '#20180f'; g.fillText(r[1], x, y + rad + 2); }
      }
      g.restore();
    }

    /* ---------- travel ---------- */
    const unitsAt = (D, y) => { const G = Geo(); if (!G.isPlanet(D)) return G.unitsPerPx(D) || 1; const lat = Math.max(-85, Math.min(85, G.lonLat(0, y, D.width, D.height)[1])); return G.unitsPerPx(D, lat); };
    /** days from the origin to every grid cell for the chosen way of travelling; cached until the origin, mode, terrain or roads change */
    M.travelGrid = function () {
      const o = M.travel.origin, D = S.data;
      if (!o) return null;
      const modes = Geo().travelModes(D, WB.world && WB.world.settings), tm = modes.find(m => m.mode === M.travel.mode) || modes[0];
      const roads = S.items.filter(i => i.kind === 'path' && ['road', 'street'].includes(i.style.kind)).map(i => i.points);
      const key = [o[0] | 0, o[1] | 0, tm.mode, tm.perDay, M.field ? M.field.ver.elev : 0, roads.length, D.unitsPerPx, D.width].join('|');
      if (M.tcache && M.tcache.key === key) return M.tcache;
      const f = M.field, gw = f ? f.w : 112, gh = f ? f.h : Math.max(8, Math.round(112 * D.height / D.width));
      const G = Geo(), cellRows = y => unitsAtRow(D, (y + .5) / gh * D.height);
      const res = F.isochrone(f, o, { perDay: tm.perDay, mode: tm.mode, open: !f, roads: f ? roads : null, upp: cellRows, w: gw, h: gh, mapW: D.width, mapH: D.height });
      return (M.tcache = Object.assign(res, { key, tm, scaled: !!(G.isPlanet(D) || D.unitsPerPx) }));
    };
    const unitsAtRow = unitsAt;
    function drawTravel(g, v) {
      const o = M.travel.origin, D = v.data;
      if (!o) return;
      const tg = M.travelGrid();
      if (!tg) return;
      const { days, w, h, tm } = tg;
      const fin = []; for (let i = 0; i < days.length; i++) if (isFinite(days[i]) && days[i] < 1e8) fin.push(days[i]);
      fin.sort((a, b) => a - b);
      const reach = fin[Math.floor(fin.length * .55)] || 1;
      const step = NICE_DAYS.find(n => n >= reach / 5) || NICE_DAYS[NICE_DAYS.length - 1];
      const levels = []; for (let k = 1; k <= 8; k++) levels.push(step * k);
      const sx = D.width / w * v.t.k, sy = D.height / h * v.t.k;
      // soft bands of colour
      if (!tg.canvas || tg.canvasStep !== step) {
        const c = document.createElement('canvas'); c.width = w; c.height = h;
        const cg = c.getContext('2d'), img = cg.createImageData(w, h);
        for (let i = 0; i < days.length; i++) {
          const b = days[i] / step; if (!(b < 8)) continue;
          const t = b / 8, o2 = i * 4;
          img.data[o2] = 255 * (1 - t * .2) | 0; img.data[o2 + 1] = 200 * (1 - t) + 60 | 0; img.data[o2 + 2] = 60 + 120 * t | 0; img.data[o2 + 3] = 120 * (1 - t * .75) | 0;
        }
        cg.putImageData(img, 0, 0); tg.canvas = c; tg.canvasStep = step;
        tg.lines = levels.map(L => ({ L, segs: F.contour(days, w, h, L) }));
      }
      g.save();
      g.imageSmoothingEnabled = true; g.imageSmoothingQuality = 'high';
      g.drawImage(tg.canvas, v.t.x, v.t.y, D.width * v.t.k, D.height * v.t.k);
      g.lineJoin = 'round'; g.lineCap = 'round';
      const hours = tm.hours || 8;
      tg.lines.forEach((ln, k) => {
        if (!ln.segs.length) return;
        g.beginPath(); for (const s of ln.segs) { g.moveTo(s[0] * sx + v.t.x, s[1] * sy + v.t.y); g.lineTo(s[2] * sx + v.t.x, s[3] * sy + v.t.y); }
        g.lineWidth = (k % 5 === 4 ? 2.4 : 1.6) * v.ui; g.strokeStyle = 'rgba(70,32,10,.8)'; g.stroke();
        // a label on the segment nearest the top of the screen
        let best = null; const [ox2, oy2] = v.toScreen(o[0], o[1]); for (const s of ln.segs) { const x = s[0] * sx + v.t.x, y = s[1] * sy + v.t.y; if (x > Math.max(30, ox2) && x < v.w - 70 && y > 20 && y < v.h - 20 && (!best || Math.abs(y - oy2) < Math.abs(best[1] - oy2))) best = [x, y]; }
        if (best) { const text = Geo().fmtDuration(ln.L, hours); g.font = '700 ' + 11 * v.ui + 'px sans-serif'; const tw = g.measureText(text).width; g.fillStyle = 'rgba(255,248,230,.92)'; g.fillRect(best[0] - 3, best[1] - 8 * v.ui, tw + 6, 15 * v.ui); g.fillStyle = '#4a2208'; g.textBaseline = 'middle'; g.textAlign = 'left'; g.fillText(text, best[0], best[1]); }
      });
      const [ox, oy] = v.toScreen(o[0], o[1]);
      g.beginPath(); g.arc(ox, oy, 7 * v.ui, 0, Math.PI * 2); g.fillStyle = '#fff'; g.fill(); g.lineWidth = 3 * v.ui; g.strokeStyle = '#a23b12'; g.stroke();
      g.beginPath(); g.arc(ox, oy, 2.5 * v.ui, 0, Math.PI * 2); g.fillStyle = '#a23b12'; g.fill();
      g.restore();
    }
    M.setOrigin = function (p) { M.travel.origin = p ? [p[0], p[1]] : null; M.tcache = null; view.draw(); };
    M.setTravelMode = function (m) { M.travel.mode = m; M.tcache = null; view.draw(); };
    /** time to reach a map point from the origin, in days (null when unknown) */
    M.daysTo = function (p) { const tg = M.travelGrid(); if (!tg) return null; const D = S.data, cx = Math.min(tg.w - 1, Math.max(0, Math.floor(p[0] / D.width * tg.w))), cy = Math.min(tg.h - 1, Math.max(0, Math.floor(p[1] / D.height * tg.h))); const d = tg.days[cy * tg.w + cx]; return isFinite(d) && d < 1e8 ? d : null; };

    /* ---------- economy ---------- */
    M.sim = () => { const s = S.data && S.data.sim; return s && s.result && Array.isArray(s.result.nodes) && s.result.nodes.length ? s.result : null; };
    function wealthColor(t) { const a = [150, 70, 80], b = [226, 184, 70], c = [60, 150, 120]; const m = t < .5 ? [a, b, t * 2] : [b, c, (t - .5) * 2]; return 'rgb(' + [0, 1, 2].map(i => Math.round(m[0][i] + (m[1][i] - m[0][i]) * m[2])).join(',') + ')'; }
    function drawEconomy(g, v) {
      const res = M.sim();
      if (!res) return;
      const items = new Map(S.items.map(i => [i.id, i])), byId = new Map(res.nodes.map(n => [n.itemId, n]));
      const pos = n => { const it = items.get(n.itemId); return it ? [it.x, it.y] : [n.x, n.y]; };
      const colors = new Map((res.resources || []).map(r => [r.name, r.color]));
      const palette = ['#c9792f', '#3f7a45', '#3a82a8', '#8e5cc9', '#b5453a', '#d9a21b'];
      const colorOf = name => colors.get(name) || palette[Math.abs([...String(name)].reduce((a, ch) => a + ch.charCodeAt(0), 0)) % palette.length];
      const maxAmt = Math.max(1e-9, ...((res.flows || []).map(f => +f.amount || 0)));
      const lanes = new Map();
      g.save(); g.lineJoin = 'round'; g.lineCap = 'round';
      for (const fl of res.flows || []) {
        const a = byId.get(fl.fromItemId), b = byId.get(fl.toItemId);
        if (!a || !b) continue;
        const pa = pos(a), pb = pos(b), route = items.get(fl.routeItemId);
        let pts = route && route.points && route.points.length > 1 ? route.points.map(p => p.slice()) : [pa, pb];
        const d0 = Math.hypot(pts[0][0] - pa[0], pts[0][1] - pa[1]), d1 = Math.hypot(pts[pts.length - 1][0] - pa[0], pts[pts.length - 1][1] - pa[1]);
        if (d1 < d0) pts = pts.slice().reverse();
        const key = fl.routeItemId || fl.fromItemId + '>' + fl.toItemId, lane = lanes.get(key) || 0; lanes.set(key, lane + 1);
        const wd = (1.5 + Math.sqrt((+fl.amount || 0) / maxAmt) * 9) * v.ui, off = (lane % 2 ? 1 : -1) * Math.ceil(lane / 2) * wd * .9;
        const sp = pts.map(p => v.toScreen(p[0], p[1]));
        const op = sp.map((p, i) => { const q = sp[Math.min(sp.length - 1, i + 1)], r = sp[Math.max(0, i - 1)]; const dx = q[0] - r[0], dy = q[1] - r[1], L = Math.hypot(dx, dy) || 1; return [p[0] - dy / L * off, p[1] + dx / L * off]; });
        const col = colorOf(fl.resource);
        g.beginPath(); op.forEach((p, i) => (i ? g.lineTo(p[0], p[1]) : g.moveTo(p[0], p[1]))); g.lineWidth = wd + 2; g.strokeStyle = 'rgba(255,255,255,.55)'; g.stroke();
        g.lineWidth = wd; g.strokeStyle = col; g.globalAlpha = .88; g.stroke(); g.globalAlpha = 1;
        // arrowheads along the line, the last one at the destination
        let acc = 0, next = 70 * v.ui;
        const head = (p, q) => { const ang = Math.atan2(q[1] - p[1], q[0] - p[0]), s = Math.max(6, wd * 1.3); g.save(); g.translate(q[0], q[1]); g.rotate(ang); g.beginPath(); g.moveTo(0, 0); g.lineTo(-s * 1.4, -s * .8); g.lineTo(-s * 1.4, s * .8); g.closePath(); g.fillStyle = col; g.fill(); g.lineWidth = 1.2; g.strokeStyle = 'rgba(255,255,255,.9)'; g.stroke(); g.restore(); };
        for (let i = 0; i < op.length - 1; i++) { acc += Math.hypot(op[i + 1][0] - op[i][0], op[i + 1][1] - op[i][1]); if (acc >= next) { head(op[i], [(op[i][0] + op[i + 1][0]) / 2, (op[i][1] + op[i + 1][1]) / 2]); next += 140 * v.ui; } }
        if (op.length > 1) head(op[op.length - 2], op[op.length - 1]);
      }
      const maxPop = Math.max(1, ...res.nodes.map(n => +n.population || 0)), ws = res.nodes.map(n => +n.wealth || 0), w0 = Math.min(...ws), w1 = Math.max(...ws);
      for (const n of res.nodes) {
        const [x, y] = v.toScreen(...pos(n));
        if (x < -60 || y < -60 || x > v.w + 60 || y > v.h + 60) continue;
        const r = (5 + Math.sqrt((+n.population || 0) / maxPop) * 20) * v.ui, short = Object.values(n.shortage || {}).reduce((s, q) => s + (+q || 0), 0), sur = Object.values(n.surplus || {}).reduce((s, q) => s + (+q || 0), 0);
        g.beginPath(); g.arc(x, y, r, 0, Math.PI * 2); g.fillStyle = wealthColor(w1 > w0 ? ((+n.wealth || 0) - w0) / (w1 - w0) : .5); g.fill();
        g.lineWidth = 2 * v.ui; g.strokeStyle = '#fff'; g.stroke();
        if (short > 0) { g.beginPath(); g.arc(x, y, r + 3.5 * v.ui, 0, Math.PI * 2); g.lineWidth = Math.min(5, 1.5 + Math.sqrt(short) * .15) * v.ui; g.strokeStyle = '#d6322b'; g.stroke(); }
        else if (sur > 0) { g.beginPath(); g.arc(x, y, r + 3.5 * v.ui, 0, Math.PI * 2); g.lineWidth = 2 * v.ui; g.strokeStyle = '#3aa35d'; g.stroke(); }
      }
      // a small key: resources and what the colours and rings mean
      const used = [...new Set((res.flows || []).map(f => f.resource))].slice(0, 7);
      let ky = 22 * v.ui;
      g.textAlign = 'left'; g.textBaseline = 'middle'; g.font = '600 ' + 11 * v.ui + 'px sans-serif';
      const kx = v.w - 232 * v.ui;
      g.fillStyle = 'rgba(20,28,38,.78)'; g.fillRect(kx - 8 * v.ui, ky - 12 * v.ui, 236 * v.ui, (2 + used.length) * 15 * v.ui + 10 * v.ui);
      g.fillStyle = '#fff'; g.fillText('Day ' + (res.day != null ? res.day : '?') + ' · size = population', kx, ky); ky += 15 * v.ui;
      g.fillText('colour = wealth, red ring = shortage', kx, ky); ky += 15 * v.ui;
      for (const r of used) { g.fillStyle = colorOf(r); g.fillRect(kx, ky - 4 * v.ui, 14 * v.ui, 8 * v.ui); g.fillStyle = '#fff'; g.fillText(r, kx + 20 * v.ui, ky); ky += 15 * v.ui; }
      g.restore();
    }

    applyItemLook();
    return M;
  }

  WB.atlasModes = { create, MODES, STYLES, STAMPS, REGION_COLORS };
})(window);
