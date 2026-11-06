/* Simulate: the two pictures. A network view (settlements and routes on the map image or a blank sheet, thickness = volume,
   colour = price pressure) and a plain-canvas line chart with a cursor that follows the scrubber. No data logic here. */
(function () {
  'use strict';
  const { h } = GK;
  const S = WB.sim = WB.sim || {};
  const clamp = (v, a, b) => Math.max(a, Math.min(b, v));
  const css = (el, name, fallback) => (getComputedStyle(el).getPropertyValue(name) || '').trim() || fallback;
  const scaleOf = cv => (window.devicePixelRatio || 1) * GK.zoomOf(cv);
  /** fit a canvas to its box at the device scale; returns the drawing context in element px */
  function sized(cv) {
    const w = Math.max(10, cv.clientWidth), hh = Math.max(10, cv.clientHeight), k = scaleOf(cv);
    if (cv.width !== Math.round(w * k) || cv.height !== Math.round(hh * k)) { cv.width = Math.round(w * k); cv.height = Math.round(hh * k); }
    const g = cv.getContext('2d');
    g.setTransform(k, 0, 0, k, 0, 0);
    return { g, w, h: hh };
  }
  /** value 0..1 -> green, amber, red */
  S.heat = v => { v = clamp(v, 0, 1); return 'hsl(' + Math.round(150 - 135 * v) + ' 62% ' + Math.round(52 - 4 * v) + '%)'; };

  /* ---------------- network ---------------- */
  /** opts.snapshot() -> { nodes:[{id,name,x,y,r,color,ring,label}], links:[{a,b,open,flows:[{from,to,width,color}]}], bg:{img,w,h}|null, selected, mode }
      returns { redraw(), fit(), destroy() } */
  S.netView = function (host, opts) {
    const cv = h('canvas.sm-net-cv', { tabindex: 0, 'aria-label': 'Trade network' });
    const tip = h('div.sm-tip', { hidden: true });
    host.append(cv, tip);
    let t = { x: 0, y: 0, k: 1 }, snap = null, raf = 0, drag = null, hover = null, animating = false, fitted = false, lastSig = '';
    const toScreen = (x, y) => [x * t.k + t.x, y * t.k + t.y];
    const bounds = s => {
      let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity;
      for (const n of s.nodes) { x0 = Math.min(x0, n.x); y0 = Math.min(y0, n.y); x1 = Math.max(x1, n.x); y1 = Math.max(y1, n.y); }
      if (!isFinite(x0)) return { x0: 0, y0: 0, x1: 1000, y1: 600 };
      return { x0, y0, x1, y1 };
    };
    function fit() {
      snap = opts.snapshot(); if (!snap) return;
      const b = bounds(snap), w = cv.clientWidth || 600, hh = cv.clientHeight || 360, pad = 56;
      const bw = Math.max(40, b.x1 - b.x0), bh = Math.max(40, b.y1 - b.y0);
      t.k = Math.min((w - pad * 2) / bw, (hh - pad * 2) / bh);
      t.x = w / 2 - ((b.x0 + b.x1) / 2) * t.k; t.y = hh / 2 - ((b.y0 + b.y1) / 2) * t.k;
      fitted = true;
    }
    function draw() {
      raf = 0;
      snap = opts.snapshot(); if (!snap) return;
      const { g, w, h: hh } = sized(cv);
      const sig = snap.nodes.map(n => n.id + ':' + Math.round(n.x) + ',' + Math.round(n.y)).join('|');
      if (!fitted || (sig !== lastSig && opts.refit !== false && lastSig === '')) fit();
      lastSig = sig;
      const text = css(cv, '--text', '#ddd'), muted = css(cv, '--muted', '#999'), line = css(cv, '--line2', 'rgba(255,255,255,.2)'), warn = css(cv, '--warn', '#e0b84c'), accent = css(cv, '--accent', '#6fd0ff'), bg = css(cv, '--bg', '#181a20');
      g.clearRect(0, 0, w, hh);
      if (snap.bg && snap.bg.img && snap.bg.img.complete && snap.bg.img.naturalWidth) {
        const [sx, sy] = toScreen(0, 0);
        g.globalAlpha = .55; g.drawImage(snap.bg.img, sx, sy, snap.bg.w * t.k, snap.bg.h * t.k); g.globalAlpha = 1;
        g.fillStyle = 'rgba(0,0,0,.28)'; g.fillRect(0, 0, w, hh);
      } else {
        g.strokeStyle = line; g.globalAlpha = .35; g.lineWidth = 1;
        const step = 48 * clamp(t.k, .4, 2);
        for (let x = ((t.x % step) + step) % step; x < w; x += step) { g.beginPath(); g.moveTo(x, 0); g.lineTo(x, hh); g.stroke(); }
        for (let y = ((t.y % step) + step) % step; y < hh; y += step) { g.beginPath(); g.moveTo(0, y); g.lineTo(w, y); g.stroke(); }
        g.globalAlpha = 1;
      }
      const by = {}; for (const n of snap.nodes) by[n.id] = n;
      const now = performance.now();
      // routes, then flows on them
      let maxW = 0; for (const l of snap.links) for (const f of l.flows) maxW = Math.max(maxW, f.width);
      for (const l of snap.links) {
        const a = by[l.a], b = by[l.b]; if (!a || !b) continue;
        const [ax, ay] = toScreen(a.x, a.y), [bx, by2] = toScreen(b.x, b.y);
        g.beginPath(); g.moveTo(ax, ay); g.lineTo(bx, by2);
        g.lineWidth = 2; g.strokeStyle = l.open ? line : warn; g.setLineDash(l.open ? [] : [5, 5]); g.stroke(); g.setLineDash([]);
        const dx = bx - ax, dy = by2 - ay, len = Math.hypot(dx, dy) || 1, nx = -dy / len, ny = dx / len;
        for (const f of l.flows) {
          const fwd = f.from === l.a, off = 3 + f.width / 2, ox = nx * off * (fwd ? 1 : -1), oy = ny * off * (fwd ? 1 : -1);
          const x0 = (fwd ? ax : bx) + ox, y0 = (fwd ? ay : by2) + oy, x1 = (fwd ? bx : ax) + ox, y1 = (fwd ? by2 : ay) + oy;
          g.beginPath(); g.moveTo(x0, y0); g.lineTo(x1, y1);
          g.lineWidth = f.width; g.strokeStyle = f.color; g.globalAlpha = .72; g.lineCap = 'round'; g.stroke(); g.globalAlpha = 1;
          // an arrowhead at 60%, and dots running along while playing
          const px = x0 + (x1 - x0) * .6, py = y0 + (y1 - y0) * .6, ux = (x1 - x0) / len, uy = (y1 - y0) / len, s = 5 + f.width * .6;
          g.beginPath(); g.moveTo(px + ux * s, py + uy * s); g.lineTo(px - ux * s * .6 + uy * s * .7, py - uy * s * .6 - ux * s * .7); g.lineTo(px - ux * s * .6 - uy * s * .7, py - uy * s * .6 + ux * s * .7); g.closePath();
          g.fillStyle = f.color; g.fill();
          if (animating) for (let k = 0; k < 3; k++) { const u = ((now / 2200) + k / 3) % 1; g.beginPath(); g.arc(x0 + (x1 - x0) * u, y0 + (y1 - y0) * u, 1.6 + f.width * .22, 0, 7); g.fillStyle = text; g.globalAlpha = .85; g.fill(); g.globalAlpha = 1; }
        }
      }
      // settlements
      g.textAlign = 'center'; g.font = '600 11px ' + css(cv, '--font-ui', 'system-ui');
      for (const n of snap.nodes) {
        const [x, y] = toScreen(n.x, n.y);
        if (n.ring) { g.beginPath(); g.arc(x, y, n.r + 5, 0, 7); g.strokeStyle = css(cv, '--bad', '#f06f86'); g.lineWidth = 2.5; g.stroke(); }
        g.beginPath(); g.arc(x, y, n.r, 0, 7); g.fillStyle = n.color; g.fill();
        g.lineWidth = n.id === snap.selected ? 3 : 1.5; g.strokeStyle = n.id === snap.selected ? accent : 'rgba(255,255,255,.7)'; g.stroke();
        if (n.id === hover) { g.beginPath(); g.arc(x, y, n.r + 3, 0, 7); g.strokeStyle = text; g.lineWidth = 1; g.stroke(); }
        g.lineWidth = 3; g.strokeStyle = bg; g.lineJoin = 'round'; g.strokeText(n.name, x, y + n.r + 13); g.fillStyle = text; g.fillText(n.name, x, y + n.r + 13);
        if (n.label) { g.fillStyle = muted; g.font = '10px ' + css(cv, '--font-ui', 'system-ui'); g.fillText(n.label, x, y + n.r + 24); g.font = '600 11px ' + css(cv, '--font-ui', 'system-ui'); }
      }
      if (animating) schedule();
    }
    function schedule() { if (!raf) raf = requestAnimationFrame(draw); }
    const pick = e => {
      const r = GK.pointIn(cv, e.clientX, e.clientY); if (!snap) return { p: r, id: null };
      let best = null, bd = 1e9;
      for (const n of snap.nodes) { const [x, y] = toScreen(n.x, n.y), d = Math.hypot(x - r.x, y - r.y); if (d < n.r + 8 && d < bd) { bd = d; best = n.id; } }
      return { p: r, id: best };
    };
    cv.addEventListener('pointerdown', e => { const { p, id } = pick(e); drag = { x: p.x, y: p.y, t0: { x: t.x, y: t.y }, moved: false, id }; try { cv.setPointerCapture(e.pointerId); } catch { /* gone */ } });
    cv.addEventListener('pointermove', e => {
      const { p, id } = pick(e);
      if (drag) { const dx = p.x - drag.x, dy = p.y - drag.y; if (Math.abs(dx) + Math.abs(dy) > 3) drag.moved = true; if (drag.moved) { t.x = drag.t0.x + dx; t.y = drag.t0.y + dy; schedule(); } return; }
      if (id !== hover) { hover = id; cv.style.cursor = id ? 'pointer' : 'grab'; schedule(); }
      const n = id && snap.nodes.find(q => q.id === id);
      if (n && opts.tip) { tip.hidden = false; tip.replaceChildren(...opts.tip(id)); tip.style.left = Math.min(p.x + 14, cv.clientWidth - 220) + 'px'; tip.style.top = Math.min(p.y + 14, cv.clientHeight - 20) + 'px'; } else tip.hidden = true;
    });
    cv.addEventListener('pointerup', e => { const d = drag; drag = null; if (d && !d.moved) opts.onSelect && opts.onSelect(d.id); try { cv.releasePointerCapture(e.pointerId); } catch { /* gone */ } });
    cv.addEventListener('pointerleave', () => { hover = null; tip.hidden = true; schedule(); });
    cv.addEventListener('dblclick', () => { fit(); schedule(); });
    cv.addEventListener('wheel', e => {
      e.preventDefault();
      const p = GK.pointIn(cv, e.clientX, e.clientY), k = clamp(t.k * (e.deltaY < 0 ? 1.15 : 1 / 1.15), .02, 40);
      t.x = p.x - (p.x - t.x) * (k / t.k); t.y = p.y - (p.y - t.y) * (k / t.k); t.k = k; schedule();
    }, { passive: false });
    const ro = new ResizeObserver(() => schedule()); ro.observe(cv);
    const off = GK.bus.on('layout', schedule);
    schedule();
    return { redraw: schedule, fit: () => { fit(); schedule(); }, animate: on => { animating = !!on; schedule(); }, destroy() { ro.disconnect(); if (typeof off === 'function') off(); cancelAnimationFrame(raf); } };
  };

  /* ---------------- line chart ---------------- */
  const nice = (max, n) => {
    if (!(max > 0)) return { max: 1, step: .25 };
    const raw = max / n, p = Math.pow(10, Math.floor(Math.log10(raw))), f = raw / p, m = f <= 1 ? 1 : f <= 2 ? 2 : f <= 5 ? 5 : 10;
    return { step: m * p, max: Math.ceil(max / (m * p)) * m * p };
  };
  const fmtNum = v => (Math.abs(v) >= 10000 ? Math.round(v / 1000) + 'k' : Math.abs(v) >= 100 ? String(Math.round(v)) : Math.abs(v) >= 10 ? (Math.round(v * 10) / 10) + '' : (Math.round(v * 100) / 100) + '');
  S.fmtNum = fmtNum;
  /** opts: { series:[{name,color,values}], xs:[day], cursor:index|null, onCursor(i), label(day) } */
  S.lineChart = function (host, getOpts) {
    const cv = h('canvas.sm-chart-cv', { 'aria-label': 'Chart' });
    const tip = h('div.sm-tip', { hidden: true });
    host.append(cv, tip);
    let o = null, raf = 0;
    const M = { l: 44, r: 10, t: 10, b: 22 };
    function draw() {
      raf = 0; o = getOpts(); const { g, w, h: hh } = sized(cv);
      g.clearRect(0, 0, w, hh);
      const text = css(cv, '--text', '#ddd'), muted = css(cv, '--muted', '#999'), line = css(cv, '--line', 'rgba(255,255,255,.15)'), accent = css(cv, '--accent', '#6fd0ff');
      const xs = o.xs || [], n = xs.length;
      if (n < 2 || !o.series.length) { g.fillStyle = muted; g.font = '12px ' + css(cv, '--font-ui', 'system-ui'); g.textAlign = 'center'; g.fillText(n < 2 ? 'Run the simulation to see this chart.' : 'Nothing to chart.', w / 2, hh / 2); return; }
      let max = 0, min = Infinity;
      for (const s of o.series) for (const v of s.values) { if (v > max) max = v; if (v < min) min = v; }
      const ax = nice(max * 1.04, 4), x0 = M.l, x1 = w - M.r, y0 = hh - M.b, y1 = M.t;
      const X = i => x0 + (x1 - x0) * (i / (n - 1)), Y = v => y0 - (y0 - y1) * (v / (ax.max || 1));
      g.font = '10px ' + css(cv, '--font-ui', 'system-ui'); g.textAlign = 'right'; g.textBaseline = 'middle';
      for (let v = 0; v <= ax.max + 1e-9; v += ax.step) { const y = Y(v); g.strokeStyle = line; g.lineWidth = 1; g.beginPath(); g.moveTo(x0, y); g.lineTo(x1, y); g.stroke(); g.fillStyle = muted; g.fillText(fmtNum(v), x0 - 5, y); }
      g.textAlign = 'center'; g.textBaseline = 'alphabetic'; g.fillStyle = muted;
      let edge = -1e9;
      for (let k = 0; k <= 4; k++) {
        const i = Math.round((n - 1) * k / 4), txt = o.label ? o.label(xs[i]) : 'day ' + xs[i], tw = g.measureText(txt).width, cx = clamp(X(i), x0 + tw / 2, x1 - tw / 2);
        if (cx - tw / 2 > edge + 10) { g.fillText(txt, cx, hh - 6); edge = cx + tw / 2; }
      }
      g.lineJoin = 'round';
      for (const s of o.series) {
        g.beginPath(); s.values.forEach((v, i) => (i ? g.lineTo(X(i), Y(v)) : g.moveTo(X(i), Y(v))));
        g.strokeStyle = s.color; g.lineWidth = s.bold ? 2.6 : 1.8; g.stroke();
      }
      if (o.cursor != null && o.cursor >= 0 && o.cursor < n) { const x = X(o.cursor); g.strokeStyle = accent; g.lineWidth = 1.5; g.beginPath(); g.moveTo(x, y1); g.lineTo(x, y0); g.stroke(); }
      void text;
    }
    const schedule = () => { if (!raf) raf = requestAnimationFrame(draw); };
    const idxAt = e => { const p = GK.pointIn(cv, e.clientX, e.clientY), n = (o && o.xs || []).length; if (n < 2) return null; return { i: clamp(Math.round((p.x - M.l) / Math.max(1, cv.clientWidth - M.l - M.r) * (n - 1)), 0, n - 1), p }; };
    cv.addEventListener('pointermove', e => {
      const r = idxAt(e); if (!r) return;
      const rows = o.series.map(s => [s.name, s.values[r.i], s.color]).filter(x => x[1] != null).sort((a, b) => b[1] - a[1]).slice(0, 9);
      tip.hidden = false;
      tip.replaceChildren(h('b', { text: o.label ? o.label(o.xs[r.i]) : 'day ' + o.xs[r.i] }), ...rows.map(([nm, v, c]) => h('div.sm-tip-row', [h('i', { style: { background: c } }), h('span.gk-grow', { text: nm }), h('b', { text: fmtNum(v) })])));
      tip.style.left = Math.min(r.p.x + 12, cv.clientWidth - 190) + 'px'; tip.style.top = Math.max(4, Math.min(r.p.y - 10, cv.clientHeight - 30 - rows.length * 16)) + 'px';
    });
    cv.addEventListener('pointerleave', () => { tip.hidden = true; });
    cv.addEventListener('click', e => { const r = idxAt(e); if (r && o.onCursor) o.onCursor(r.i); });
    const ro = new ResizeObserver(schedule); ro.observe(cv);
    schedule();
    return { redraw: schedule, destroy() { ro.disconnect(); cancelAnimationFrame(raf); } };
  };
})();
