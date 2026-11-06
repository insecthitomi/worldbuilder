/* Force-directed layout for the Web graph: springs on links, Barnes–Hut repulsion (a quadtree in typed arrays, so
   a few thousand nodes stay fast), a gentle pull to the centre and a soft collision push. Deterministic: the same
   data gives the same picture every time. UMD: the renderer and the unit tests. */
(function (root, factory) {
  const api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  else root.WBForce = api;
})(typeof self !== 'undefined' ? self : this, function () {
  'use strict';
  const TAU = Math.PI * 2, GOLD = Math.PI * (3 - Math.sqrt(5));

  /**
   * nodes: [{ x?, y?, fx?, fy?, r, charge?, g? (own pull to the centre) }] (mutated: x, y, vx, vy)
   * links: [{ s: index, t: index, d?: rest length, k?: strength }]
   * opts: { gravity = .05, theta = .9, charge = -36, linkDistance = 34, collide = true }
   */
  function create(nodes, links, opts = {}) {
    const n = nodes.length;
    const gravity = opts.gravity == null ? 0.05 : opts.gravity, theta2 = Math.pow(opts.theta || 0.9, 2);
    const baseCharge = opts.charge == null ? -36 : opts.charge, baseDist = opts.linkDistance || 34;
    let alpha = 1, alphaMin = 0.002, alphaTarget = 0, alphaDecay = 1 - Math.pow(alphaMin, 1 / 300), velDecay = 0.6;
    // initial positions: a sunflower spiral for anything not placed yet
    let placed = 0;
    for (let i = 0; i < n; i++) {
      const d = nodes[i];
      d.vx = d.vx || 0; d.vy = d.vy || 0;
      if (d.fx != null) d.x = d.fx;
      if (d.fy != null) d.y = d.fy;
      if (!Number.isFinite(d.x) || !Number.isFinite(d.y)) { const rr = 12 * Math.sqrt(0.5 + placed), a = placed * GOLD; d.x = rr * Math.cos(a); d.y = rr * Math.sin(a); }
      placed++;
    }
    // link bookkeeping (as in the classic spring model: hubs pull less on each neighbour)
    const count = new Float64Array(n);
    for (const l of links) { count[l.s]++; count[l.t]++; }
    const L = links.filter(l => l.s !== l.t && l.s >= 0 && l.t >= 0 && l.s < n && l.t < n).map(l => ({
      s: l.s, t: l.t, d: l.d || baseDist + (nodes[l.s].r || 4) + (nodes[l.t].r || 4),
      k: (l.k == null ? 1 : l.k) / Math.max(1, Math.min(count[l.s], count[l.t])), bias: count[l.s] / ((count[l.s] + count[l.t]) || 1),
    }));
    const charge = new Float64Array(n);
    for (let i = 0; i < n; i++) charge[i] = nodes[i].charge != null ? nodes[i].charge : baseCharge * (1 + Math.min(4, (nodes[i].r || 4) / 8));

    // quadtree in flat arrays
    let cap = 0, qx, qy, qs, qm, qcx, qcy, qch, qleaf;
    const next = new Int32Array(Math.max(1, n));
    const X = new Float64Array(n), Y = new Float64Array(n);
    function alloc(c) { cap = c; qx = new Float64Array(c); qy = new Float64Array(c); qs = new Float64Array(c); qm = new Float64Array(c); qcx = new Float64Array(c); qcy = new Float64Array(c); qch = new Int32Array(c * 4); qleaf = new Int32Array(c); }
    let qn = 0;
    function quad(x, y, s) {
      if (qn >= cap) { const o = { qx, qy, qs, qm, qcx, qcy, qch, qleaf }; alloc(cap * 2); qx.set(o.qx); qy.set(o.qy); qs.set(o.qs); qm.set(o.qm); qcx.set(o.qcx); qcy.set(o.qcy); qch.set(o.qch); qleaf.set(o.qleaf); }
      const q = qn++;
      qx[q] = x; qy[q] = y; qs[q] = s; qm[q] = 0; qcx[q] = 0; qcy[q] = 0; qleaf[q] = -1;
      qch[q * 4] = qch[q * 4 + 1] = qch[q * 4 + 2] = qch[q * 4 + 3] = -1;
      return q;
    }
    const childOf = (q, x, y) => { const h = qs[q] / 2; return (x >= qx[q] + h ? 1 : 0) + (y >= qy[q] + h ? 2 : 0); };
    function child(q, k) {
      let c = qch[q * 4 + k];
      if (c < 0) { const h = qs[q] / 2; c = quad(qx[q] + (k & 1 ? h : 0), qy[q] + (k & 2 ? h : 0), h); qch[q * 4 + k] = c; }
      return c;
    }
    function build() {
      let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity;
      for (let i = 0; i < n; i++) { const x = X[i] = nodes[i].x, y = Y[i] = nodes[i].y; if (x < x0) x0 = x; if (x > x1) x1 = x; if (y < y0) y0 = y; if (y > y1) y1 = y; }
      const s = Math.max(x1 - x0, y1 - y0, 1) * 1.0001 + 1;
      if (!cap) alloc(Math.max(64, n * 3));
      qn = 0;
      const rootQ = quad(x0, y0, s);
      for (let i = 0; i < n; i++) {
        next[i] = -1;
        let q = rootQ, guard = 0;
        for (;;) {
          if (guard++ > 60) break;   // unreachable in practice: coincident points are chained below
          const hasKids = qch[q * 4] >= 0 || qch[q * 4 + 1] >= 0 || qch[q * 4 + 2] >= 0 || qch[q * 4 + 3] >= 0;
          if (!hasKids && qleaf[q] < 0) { qleaf[q] = i; break; }
          if (!hasKids) {
            const j = qleaf[q];
            if ((X[j] === X[i] && Y[j] === Y[i]) || qs[q] < 1e-6) { next[i] = next[j]; next[j] = i; break; }
            qleaf[q] = -1;
            const cj = child(q, childOf(q, X[j], Y[j]));
            qleaf[cj] = j;
          }
          q = child(q, childOf(q, X[i], Y[i]));
        }
      }
      // masses bottom-up: children are always created after their parent
      for (let q = qn - 1; q >= 0; q--) {
        let m = 0, cx = 0, cy = 0;
        if (qleaf[q] >= 0) for (let j = qleaf[q]; j >= 0; j = next[j]) { const c = charge[j]; m += c; cx += c * X[j]; cy += c * Y[j]; }
        for (let k = 0; k < 4; k++) { const c = qch[q * 4 + k]; if (c >= 0 && qm[c]) { m += qm[c]; cx += qm[c] * qcx[c]; cy += qm[c] * qcy[c]; } }
        qm[q] = m;
        if (m) { qcx[q] = cx / m; qcy[q] = cy / m; }
      }
      return rootQ;
    }
    const stack = new Int32Array(4096);
    let jig = 1;
    const jiggle = () => ((jig = (jig * 16807) % 2147483647) / 2147483647 - 0.5) * 1e-6;
    function repel(rootQ, a) {
      for (let i = 0; i < n; i++) {
        const xi = X[i], yi = Y[i];
        let vx = 0, vy = 0, sp = 0;
        stack[sp++] = rootQ;
        while (sp) {
          const q = stack[--sp];
          if (!qm[q]) continue;
          let dx = qcx[q] - xi, dy = qcy[q] - yi, l = dx * dx + dy * dy;
          const w = qs[q];
          const kids = qch[q * 4] >= 0 || qch[q * 4 + 1] >= 0 || qch[q * 4 + 2] >= 0 || qch[q * 4 + 3] >= 0;
          if (w * w / theta2 < l) {
            if (l < 1) l = Math.sqrt(l) || 1;
            const f = qm[q] * a / l; vx += dx * f; vy += dy * f;
            continue;
          }
          if (kids) { for (let k = 0; k < 4; k++) { const c = qch[q * 4 + k]; if (c >= 0 && sp < stack.length) stack[sp++] = c; } continue; }
          for (let j = qleaf[q]; j >= 0; j = next[j]) {
            if (j === i) continue;
            dx = X[j] - xi; dy = Y[j] - yi;
            if (dx === 0) dx = jiggle();
            if (dy === 0) dy = jiggle();
            l = dx * dx + dy * dy;
            if (l < 1) l = Math.sqrt(l) || 1;
            const f = charge[j] * a / l; vx += dx * f; vy += dy * f;
          }
        }
        nodes[i].vx += vx; nodes[i].vy += vy;
      }
    }
    function springs(a) {
      for (const l of L) {
        const s = nodes[l.s], t = nodes[l.t];
        let x = t.x + t.vx - s.x - s.vx, y = t.y + t.vy - s.y - s.vy;
        if (!x) x = jiggle();
        if (!y) y = jiggle();
        let d = Math.sqrt(x * x + y * y);
        d = (d - l.d) / d * a * l.k;
        x *= d; y *= d;
        t.vx -= x * l.bias; t.vy -= y * l.bias;
        s.vx += x * (1 - l.bias); s.vy += y * (1 - l.bias);
      }
    }
    // soft collision through a uniform grid (nodes never sit on top of each other)
    function collide() {
      let maxR = 1;
      for (let i = 0; i < n; i++) if ((nodes[i].r || 4) > maxR) maxR = nodes[i].r || 4;
      const cell = maxR * 2 + 4, grid = new Map();
      for (let i = 0; i < n; i++) { const k = Math.floor(nodes[i].x / cell) + ',' + Math.floor(nodes[i].y / cell); let b = grid.get(k); if (!b) grid.set(k, b = []); b.push(i); }
      for (let i = 0; i < n; i++) {
        const a = nodes[i], cx = Math.floor(a.x / cell), cy = Math.floor(a.y / cell), ra = (a.r || 4) + 3;
        for (let gx = cx - 1; gx <= cx + 1; gx++) for (let gy = cy - 1; gy <= cy + 1; gy++) {
          const b = grid.get(gx + ',' + gy); if (!b) continue;
          for (const j of b) {
            if (j <= i) continue;
            const o = nodes[j], min = ra + (o.r || 4) + 3;
            let dx = o.x - a.x, dy = o.y - a.y; const d2 = dx * dx + dy * dy;
            if (d2 >= min * min) continue;
            if (!d2) { dx = jiggle() * 1e6; dy = jiggle() * 1e6; }
            const d = Math.sqrt(dx * dx + dy * dy) || 1, push = (min - d) / d * 0.35;
            dx *= push; dy *= push;
            a.vx -= dx; a.vy -= dy; o.vx += dx; o.vy += dy;
          }
        }
      }
    }
    function tick() {
      alpha += (alphaTarget - alpha) * alphaDecay;
      if (!n) return;
      springs(alpha);
      const r = build();
      repel(r, alpha);
      for (const d of nodes) { const gr = d.g != null ? d.g : gravity; if (gr) { d.vx -= d.x * gr * alpha; d.vy -= d.y * gr * alpha; } }
      if (opts.collide !== false && alpha < 0.6) collide();
      for (const d of nodes) {
        if (d.fx != null) { d.x = d.fx; d.vx = 0; } else { d.vx *= velDecay; d.x += d.vx; }
        if (d.fy != null) { d.y = d.fy; d.vy = 0; } else { d.vy *= velDecay; d.y += d.vy; }
        if (!Number.isFinite(d.x) || !Number.isFinite(d.y)) { d.x = jiggle() * 1e8; d.y = jiggle() * 1e8; d.vx = d.vy = 0; }
      }
    }
    return {
      nodes,
      /** runs n ticks (or until the budget in ms runs out); returns the ticks run */
      tick(count = 1, budgetMs = Infinity) {
        const t0 = Date.now();
        let i = 0;
        for (; i < count; i++) { if (alpha < alphaMin && !alphaTarget) break; tick(); if (Date.now() - t0 > budgetMs) { i++; break; } }
        return i;
      },
      get alpha() { return alpha; },
      set alpha(v) { alpha = v; },
      get target() { return alphaTarget; },
      set target(v) { alphaTarget = v; },
      done: () => alpha < alphaMin && !alphaTarget,
      reheat(a = 0.3) { alpha = Math.max(alpha, a); },
      bounds() {
        let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity;
        for (const d of nodes) { const r = d.r || 4; if (d.x - r < x0) x0 = d.x - r; if (d.x + r > x1) x1 = d.x + r; if (d.y - r < y0) y0 = d.y - r; if (d.y + r > y1) y1 = d.y + r; }
        return n ? { x0, y0, x1, y1 } : { x0: -50, y0: -50, x1: 50, y1: 50 };
      },
    };
  }
  return { create, TAU };
});
