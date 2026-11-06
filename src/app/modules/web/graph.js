/* Web → Graph: every entry and link on one canvas. Force layout (Barnes–Hut), pan & zoom, drag to pin, filters,
   search highlight, ego focus, connection finder, communities, hover cards and the shared entry menu. */
(function () {
  'use strict';
  const { h, ui } = GK, U = WB.ui;
  const P = WB.webParts;

  const KINDS = [
    ['relation', 'Relations', 'Typed relations: parent of, ally of, lives in…'],
    ['field', 'References', 'Reference fields: home, leader, owner, location…'],
    ['mention', 'Mentions', 'An entry named in another one’s text'],
    ['parent', 'Inside', 'An entry placed inside another (chapter in story, town in region)'],
  ];
  const RANK = { relation: 0, field: 1, parent: 2, mention: 3 };
  const DEFAULTS = { kinds: { relation: true, field: true, mention: true, parent: false }, cats: {}, hideTypes: [], tags: [], colorBy: 'type', labels: 'auto', orphans: true, depth: 1, asOf: false, asOfDay: {} };

  P.graph = async function mount(host, env) {
    const C = P.common, A = window.WBGraph, F = window.WBForce;
    const st = Object.assign({}, DEFAULTS, env.store.get().graph || {});
    st.kinds = Object.assign({}, DEFAULTS.kinds, st.kinds);
    const save = () => env.store.patch({ graph: { kinds: st.kinds, cats: st.cats, hideTypes: st.hideTypes, tags: st.tags, colorBy: st.colorBy, labels: st.labels, orphans: st.orphans, depth: st.depth, asOf: st.asOf, asOfDay: st.asOfDay } });
    st.asOfDay = Object.assign({}, st.asOfDay || {});
    /** the chosen date for this world (a date value; the world's today when none was picked) */
    const asOfDate = () => { const v = st.asOfDay[WB.worldId]; return v && typeof v === 'object' ? v : v != null ? { day: v, min: null, prec: 'day' } : { day: WB.now.day, min: null, prec: 'day' }; };
    const asOfDay = () => asOfDate().day;
    const pinsAll = () => Object.assign({}, env.store.get().pins || {});
    const pins = () => pinsAll()[WB.worldId] || {};
    const savePins = p => { const all = pinsAll(); all[WB.worldId] = p; env.store.patch({ pins: all }); };

    /* ---------------- transient state ---------------- */
    let entries = new Map(), allEdges = [], pairs = [], model = null, sim = null;
    let focus = null, pathQ = { a: null, b: null, list: [], at: 0 }, query = '', matches = new Set();
    let selected = null, hover = null, hoverPair = null, groups = null, highlightGroup = null;
    const pos = new Map();                     // id → node object (positions survive re-filtering)
    const view = { x: 0, y: 0, k: 1 };
    let autoFit = true, raf = 0, running = false, alive = true, colors = null;

    /* ---------------- layout ---------------- */
    const canvas = h('canvas.web-canvas', { tabindex: 0, 'aria-label': 'Graph of entries and links. Drag to pan, wheel to zoom, click an entry to peek, double-click to open.' });
    const tip = h('div.web-tip', { hidden: true });
    const status = h('div.web-status.gk-small');
    const busy = h('span.web-busy', { hidden: true, text: 'arranging…' });
    const zoomBar = h('div.web-zoombar', [
      ui.button({ icon: '−', small: true, title: 'Zoom out (−)', onClick: () => zoomBy(1 / 1.35) }),
      ui.button({ icon: '⊡', small: true, title: 'Fit everything (0)', onClick: () => fit(true) }),
      ui.button({ icon: '+', small: true, title: 'Zoom in (+)', onClick: () => zoomBy(1.35) }),
    ]);
    const banner = h('div.web-banner', { hidden: true });
    const wrap = h('div.web-canvas-wrap', [canvas, tip, banner, h('div.web-canvas-foot', [status, busy]), zoomBar]);
    const stage = ui.panel({ material: 'solid', cls: 'web-stage', body: [wrap] });
    const side = h('div.web-side');
    const sidePanel = ui.panel({ cls: 'web-side-panel', body: [side] });
    const root = h('div.web-graph', [sidePanel, stage]);
    host.appendChild(root);

    /* ---------------- data ---------------- */
    async function load() {
      const wid = WB.worldId;
      const [list, links] = await Promise.all([WB.api('entries.list', wid, {}), WB.api('links.all', wid)]);
      if (!alive || wid !== WB.worldId) return;
      entries = new Map(list.filter(e => WB.visible(e)).map(e => [e.id, e]));
      allEdges = links.filter(l => entries.has(l.src) && entries.has(l.dst) && l.src !== l.dst).map(l => {
        const r = l.kind === 'relation' ? WB.rel(l.relId) : null;
        return { id: l.id, a: l.src, b: l.dst, kind: l.kind, link: l, rel: r, cat: r ? r.category : null, color: r && r.color };
      });
      for (const e of entries.values()) if (e.parentId && entries.has(e.parentId)) allEdges.push({ id: 'in:' + e.id, a: e.parentId, b: e.id, kind: 'parent' });
      rebuild(true);
    }

    /** filters → the visible model, then the simulation */
    function rebuild(fresh) {
      const hidden = new Set(st.hideTypes);
      const tagSet = new Set(st.tags.filter(t => WB.tag(t)));
      // as of a date: only what exists then, and relations that hold then
      const day = st.asOf ? asOfDay() : null;
      const exists = e => day == null || ((!e.start || e.start.day <= day) && (!e.end || e.end.day >= day));
      const holds = l => day == null || ((l.startDay == null || l.startDay <= day) && (l.endDay == null || l.endDay >= day));
      const keepNode = e => !hidden.has((WB.typeOf(e) || {}).key) && (!tagSet.size || (e.tags || []).some(t => tagSet.has(t))) && exists(e);
      let ids = [...entries.values()].filter(keepNode).map(e => e.id);
      const idSet = new Set(ids);
      const edges = allEdges.filter(x => st.kinds[x.kind] && idSet.has(x.a) && idSet.has(x.b) && (x.kind !== 'relation' || (st.cats[x.cat] !== false && holds(x.link))));
      // one drawn line per pair of entries; the strongest kind decides its look
      const byPair = new Map();
      for (const x of edges) {
        const k = x.a < x.b ? x.a + '|' + x.b : x.b + '|' + x.a;
        let p = byPair.get(k);
        if (!p) byPair.set(k, p = { key: k, a: x.a < x.b ? x.a : x.b, b: x.a < x.b ? x.b : x.a, list: [] });
        p.list.push(x);
      }
      pairs = [...byPair.values()];
      for (const p of pairs) { p.list.sort((x, y) => RANK[x.kind] - RANK[y.kind]); p.top = p.list[0]; p.id = p.key; }
      const deg = new Map();
      for (const p of pairs) { deg.set(p.a, (deg.get(p.a) || 0) + 1); deg.set(p.b, (deg.get(p.b) || 0) + 1); }
      if (!st.orphans) ids = ids.filter(id => deg.get(id));
      // ego focus: only what lies within the chosen number of steps
      if (focus && !entries.has(focus)) focus = null;
      if (focus) {
        const adj = A.adjacency(ids, pairs);
        const near = A.around(adj, focus, st.depth);
        ids = ids.filter(id => near.has(id));
      }
      const keep = new Set(ids);
      const shown = pairs.filter(p => keep.has(p.a) && keep.has(p.b));
      // nodes keep their positions; newcomers start beside a neighbour
      const nb = new Map();
      for (const p of shown) { if (!nb.has(p.a)) nb.set(p.a, p.b); if (!nb.has(p.b)) nb.set(p.b, p.a); }
      const pin = pins();
      const nodes = ids.map(id => {
        let d = pos.get(id);
        if (!d) {
          d = { id, x: NaN, y: NaN };
          const near = nb.get(id) && pos.get(nb.get(id));
          if (near && Number.isFinite(near.x)) { const a = (hash(id) % 628) / 100; d.x = near.x + Math.cos(a) * 30; d.y = near.y + Math.sin(a) * 30; }
          pos.set(id, d);
        }
        const p = pin[id];
        if (p) { d.fx = p[0]; d.fy = p[1]; d.x = p[0]; d.y = p[1]; } else { d.fx = d.fy = null; }
        if (focus === id && !p) { d.fx = 0; d.fy = 0; }
        d.e = entries.get(id); d.deg = deg.get(id) || 0; d.r = 4.5 + Math.min(18, Math.sqrt(d.deg) * 2.3);
        return d;
      });
      // entries without links and small islands stay close around the main web instead of drifting to the edges
      const comp = A.components(ids, shown), sizes = new Map();
      for (const c of comp.values()) sizes.set(c, (sizes.get(c) || 0) + 1);
      for (const d of nodes) { const n = sizes.get(comp.get(d.id)) || 1; d.g = n === 1 ? 0.22 : n < Math.max(4, nodes.length * 0.08) ? 0.14 : null; }
      const index = new Map(nodes.map((d, i) => [d.id, i]));
      for (const p of shown) { p.s = index.get(p.a); p.t = index.get(p.b); }
      model = { nodes, pairs: shown, index, adj: A.adjacency(ids, shown) };
      groups = st.colorBy === 'group' ? A.communities(ids, shown) : null;
      if (pathQ.a && pathQ.b) findPaths(false);
      const restart = fresh || !sim;
      const unplaced = nodes.filter(d => !Number.isFinite(d.x)).length;
      sim = F.create(nodes, shown.map(p => ({ s: p.s, t: p.t, k: p.top.kind === 'mention' ? 0.55 : p.top.kind === 'parent' ? 0.8 : 1 })), { gravity: focus ? 0.09 : 0.05, charge: -70, linkDistance: 46 });
      if (!restart && unplaced < nodes.length / 2) sim.alpha = 0.45;
      // settle most of the way before the first frame so it never opens as a tangle
      if (unplaced > nodes.length / 2) sim.tick(160, 180); else if (restart) sim.tick(30, 60);
      matches = computeMatches();
      paintSide();
      if (autoFit) fit(false);
      start();
    }
    const hash = s => { let x = 2166136261; for (let i = 0; i < s.length; i++) { x ^= s.charCodeAt(i); x = Math.imul(x, 16777619); } return x >>> 0; };

    /* ---------------- animation ---------------- */
    function start() { running = true; busy.hidden = false; if (!raf) raf = requestAnimationFrame(frame); }
    function frame() {
      raf = 0;
      if (!alive) return;
      if (running && sim) {
        sim.tick(6, 10);
        if (sim.done()) { running = false; busy.hidden = true; }
        if (autoFit) fit(false);
      }
      draw();
      if (running) raf = requestAnimationFrame(frame);
    }
    const redraw = () => { if (!raf) raf = requestAnimationFrame(frame); };

    /* ---------------- view ---------------- */
    let W = 0, H = 0;
    function size() {
      const w = wrap.clientWidth, hh = wrap.clientHeight;
      if (!w || !hh) return;
      const scale = GK.zoomOf(wrap) * (devicePixelRatio || 1);
      W = w; H = hh;
      canvas.width = Math.round(w * scale); canvas.height = Math.round(hh * scale);
      canvas.style.width = w + 'px'; canvas.style.height = hh + 'px';
      colors = C.tokens(stage); memo.clear();
      redraw();
    }
    const ro = new ResizeObserver(() => { const old = [W, H]; size(); if (autoFit || !old[0]) fit(false); });
    ro.observe(wrap);
    const toWorld = (x, y) => ({ x: (x - view.x) / view.k, y: (y - view.y) / view.k });
    function fit(animate) {
      if (!model || !W) return;
      const ns = focus ? model.nodes : model.nodes;
      if (!ns.length) { view.x = W / 2; view.y = H / 2; view.k = 1; redraw(); return; }
      let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity;
      for (const d of ns) { if (d.x - d.r < x0) x0 = d.x - d.r; if (d.x + d.r > x1) x1 = d.x + d.r; if (d.y - d.r < y0) y0 = d.y - d.r; if (d.y + d.r > y1) y1 = d.y + d.r; }
      const pad = 48, k = Math.max(0.06, Math.min(2, Math.min((W - pad * 2) / Math.max(1, x1 - x0), (H - pad * 2 - 20) / Math.max(1, y1 - y0))));
      const target = { k, x: W / 2 - (x0 + x1) / 2 * k, y: (H - 20) / 2 - (y0 + y1) / 2 * k };
      if (animate) glide(target); else { Object.assign(view, target); redraw(); }
    }
    let glideT = 0;
    function glide(target, ms = 360) {
      const from = Object.assign({}, view), t0 = performance.now();
      cancelAnimationFrame(glideT);
      const step = now => {
        const t = Math.min(1, (now - t0) / ms), e = 1 - Math.pow(1 - t, 3);
        view.k = from.k + (target.k - from.k) * e; view.x = from.x + (target.x - from.x) * e; view.y = from.y + (target.y - from.y) * e;
        draw();
        if (t < 1 && alive) glideT = requestAnimationFrame(step);
      };
      glideT = requestAnimationFrame(step);
    }
    function zoomBy(f, cx = W / 2, cy = H / 2) {
      autoFit = false;
      const k = Math.max(0.04, Math.min(8, view.k * f)), p = toWorld(cx, cy);
      view.k = k; view.x = cx - p.x * k; view.y = cy - p.y * k;
      redraw();
    }
    function centerOn(id, k) {
      const d = pos.get(id); if (!d || !W) return;
      autoFit = false;
      const kk = k || Math.max(view.k, 1.1);
      glide({ k: kk, x: W / 2 - d.x * kk, y: H / 2 - d.y * kk });
    }

    /* ---------------- drawing ---------------- */
    const sx = d => d.x * view.k + view.x, sy = d => d.y * view.k + view.y;
    let rkK = -1, rkV = 1;
    const radius = d => { if (view.k !== rkK) { rkK = view.k; rkV = Math.min(1.6, Math.pow(view.k, 0.75)); } return Math.max(2.4, d.r * rkV); };
    const nodeColor = d => {
      if (groups) { const g = groups.get(d.id); return g == null || g < 0 ? colors.faint : C.GROUPS[g % C.GROUPS.length]; }
      return WB.colorOf(d.e);
    };
    function lit() {
      // what is highlighted right now: a path, a hovered/selected entry and its neighbours, search matches, a group
      if (pathQ.list.length) {
        const p = pathQ.list[pathQ.at] || pathQ.list[0];
        return { nodes: new Set(p.nodes), pairs: new Set(p.edges.map(e => e.key)), strong: true };
      }
      const c = hover || selected;
      if (c && model.index.has(c)) {
        const n = new Set([c]), e = new Set();
        for (const { to, e: p } of model.adj.get(c) || []) { n.add(to); e.add(p.key); }
        return { nodes: n, pairs: e };
      }
      if (hoverPair) return { nodes: new Set([hoverPair.a, hoverPair.b]), pairs: new Set([hoverPair.key]) };
      if (highlightGroup != null && groups) { const n = new Set(model.nodes.filter(d => groups.get(d.id) === highlightGroup).map(d => d.id)); return { nodes: n, pairs: new Set(model.pairs.filter(p => n.has(p.a) && n.has(p.b)).map(p => p.key)) }; }
      if (query) return { nodes: matches, pairs: new Set() };
      return null;
    }
    function draw() {
      if (!W || !model || !colors) return;
      const g = canvas.getContext('2d');
      const scale = canvas.width / W;
      g.setTransform(scale, 0, 0, scale, 0, 0);
      g.clearRect(0, 0, W, H);
      const L = lit();
      const nodes = model.nodes;
      const inView = d => { const x = sx(d), y = sy(d), r = radius(d) + 40; return x > -r && y > -r && x < W + r && y < H + r; };
      // edges, batched by look
      const buckets = new Map();
      const strong = [];
      for (const p of model.pairs) {
        const s = nodes[p.s], t = nodes[p.t];
        const on = L && L.pairs.has(p.key);
        if (on) { strong.push(p); continue; }
        const x = p.top, key = x.kind + '|' + (x.kind === 'relation' ? x.color || '' : '');
        let b = buckets.get(key);
        if (!b) buckets.set(key, b = { x, list: [] });
        b.list.push([s, t]);
      }
      const dim = L ? 0.08 : 0.5;
      for (const b of buckets.values()) {
        style(g, b.x, dim);
        g.beginPath();
        for (const [s, t] of b.list) { g.moveTo(sx(s), sy(s)); g.lineTo(sx(t), sy(t)); }
        g.stroke();
      }
      g.setLineDash([]);
      for (const p of strong) {
        const s = nodes[p.s], t = nodes[p.t];
        style(g, p.top, 1, L.strong ? 2.6 : 1.8);
        if (L.strong) g.strokeStyle = colors.accent;
        g.beginPath(); g.moveTo(sx(s), sy(s)); g.lineTo(sx(t), sy(t)); g.stroke();
      }
      g.setLineDash([]);
      // arrows on directed relations once there is room for them
      if (view.k > 0.55) {
        for (const p of model.pairs) {
          const x = p.top;
          if (x.kind !== 'relation' || !x.rel || x.rel.symmetric) continue;
          const on = L && L.pairs.has(p.key);
          if (L && !on) continue;
          const s = pos.get(x.a), t = pos.get(x.b);
          if (!inView(s) && !inView(t)) continue;
          arrow(g, s, t, on && L.strong ? colors.accent : C.canvasColor(x.color || colors.muted), on ? 1 : 0.7);
        }
      }
      // nodes, one path per colour (dimmed ones first)
      const small = view.k < 0.35 && nodes.length > 600, rim = cached('rim', () => C.alpha(colors.bg, 0.85));
      const batches = new Map(), visible = [];
      for (const d of nodes) {
        if (!inView(d)) continue;
        const on = !L || L.nodes.has(d.id), col = nodeColor(d), key = (on ? '1' : '0') + col;
        let b = batches.get(key);
        if (!b) batches.set(key, b = { on, col, list: [] });
        b.list.push(d); visible.push([d, on, col]);
      }
      for (const b of [...batches.values()].sort((x, y) => x.on - y.on)) {
        g.globalAlpha = b.on ? 1 : 0.14;
        g.fillStyle = b.col;
        g.beginPath();
        for (const d of b.list) { const x = sx(d), y = sy(d), r = radius(d); g.moveTo(x + r, y); g.arc(x, y, r, 0, Math.PI * 2); }
        g.fill();
        if (!small) { g.lineWidth = 1; g.strokeStyle = rim; g.stroke(); }
      }
      g.globalAlpha = 1;
      for (const [d, on, col] of visible) {
        const x = sx(d), y = sy(d), r = radius(d);
        if (r >= 8.5 && on) {
          g.fillStyle = inkOf(col);
          g.font = Math.round(r * 1.05) + 'px ' + colors.font;
          g.textAlign = 'center'; g.textBaseline = 'middle';
          g.fillText(WB.iconOf(d.e), x, y + r * 0.04);
        }
        if (d.fx != null && d.id !== focus) { g.fillStyle = colors.text; g.beginPath(); g.arc(x + r * 0.72, y - r * 0.72, Math.max(1.6, r * 0.22), 0, Math.PI * 2); g.fill(); }
      }
      g.globalAlpha = 1;
      // rings: focus, matches, selection, hover, path steps
      const ring = (id, color, w, gap = 2.5) => { const d = pos.get(id); if (!d || !model.index.has(id)) return; g.lineWidth = w; g.strokeStyle = color; g.beginPath(); g.arc(sx(d), sy(d), radius(d) + gap, 0, Math.PI * 2); g.stroke(); };
      if (query) for (const id of matches) ring(id, colors.warn, 2);
      if (focus) { ring(focus, colors.accent, 2); ring(focus, colors.accent, 1, 6); }
      if (selected && (!L || L.nodes.has(selected))) ring(selected, colors.accent, 2.6);
      if (hover && hover !== selected) ring(hover, colors.text, 1.6);
      if (pathQ.list.length) {
        const p = pathQ.list[pathQ.at] || pathQ.list[0];
        p.nodes.forEach((id, i) => { const d = pos.get(id); if (!d) return; ring(id, colors.accent, 2.4); badge(g, sx(d) + radius(d) * 0.8, sy(d) - radius(d) * 0.8, String(i + 1)); });
      }
      labels(g, L, inView);
    }
    const memo = new Map();
    const cached = (k, fn) => { let v = memo.get(k); if (v === undefined) { v = fn(); memo.set(k, v); } return v; };
    const inkOf = col => cached('ink' + col, () => C.ink(C.canvasColor(col)));
    function style(g, x, alpha, wide) {
      const c = x.kind === 'relation' ? cached('c' + x.color, () => C.canvasColor(x.color || colors.muted)) : x.kind === 'field' ? colors.muted : colors.faint;
      g.strokeStyle = alpha >= 1 ? c : cached('a' + c + alpha, () => C.alpha(c, alpha));
      g.lineWidth = (wide || (x.kind === 'relation' ? 1.5 : x.kind === 'field' ? 1.1 : 0.9)) * Math.max(0.7, Math.min(1.4, Math.sqrt(view.k)));
      g.setLineDash(x.kind === 'mention' ? [4, 4] : x.kind === 'parent' ? [1.5, 3.5] : []);
    }
    function arrow(g, s, t, color, alpha) {
      const x1 = sx(s), y1 = sy(s), x2 = sx(t), y2 = sy(t), dx = x2 - x1, dy = y2 - y1, l = Math.hypot(dx, dy);
      if (l < 30) return;
      const ux = dx / l, uy = dy / l, r = radius(t) + 3, ax = x2 - ux * r, ay = y2 - uy * r, s7 = 7;
      g.globalAlpha = alpha; g.fillStyle = color;
      g.beginPath(); g.moveTo(ax, ay); g.lineTo(ax - ux * s7 - uy * s7 * 0.5, ay - uy * s7 + ux * s7 * 0.5); g.lineTo(ax - ux * s7 + uy * s7 * 0.5, ay - uy * s7 - ux * s7 * 0.5); g.closePath(); g.fill();
      g.globalAlpha = 1;
    }
    function badge(g, x, y, text) {
      g.font = '700 ' + Math.round(colors.fs * 0.72) + 'px ' + colors.font;
      const w = Math.max(15, g.measureText(text).width + 8);
      g.fillStyle = colors.accent; g.beginPath(); g.roundRect(x - w / 2, y - 8, w, 16, 8); g.fill();
      g.fillStyle = C.ink(colors.accent); g.textAlign = 'center'; g.textBaseline = 'middle'; g.fillText(text, x, y + 0.5);
    }
    function labels(g, L, inView) {
      const fs = Math.round(colors.fs * 0.86);
      g.font = '600 ' + fs + 'px ' + colors.font;
      g.textAlign = 'center'; g.textBaseline = 'top';
      const must = new Set([selected, hover, focus].filter(Boolean));
      if (pathQ.list.length) for (const id of (pathQ.list[pathQ.at] || pathQ.list[0]).nodes) must.add(id);
      if (query) for (const id of [...matches].slice(0, 40)) must.add(id);
      if (L && !L.strong && (hover || selected)) for (const id of L.nodes) must.add(id);
      const cand = [];
      for (const d of model.nodes) {
        if (!inView(d)) continue;
        if (must.has(d.id)) { cand.push([1e9, d]); continue; }
        if (st.labels === 'none' || (L && !L.nodes.has(d.id))) continue;
        const r = radius(d);
        if (st.labels === 'all' || r >= 7 || view.k >= 1.1) cand.push([d.deg * 10 + r, d]);
        else cand.push([d.deg, d, true]);
      }
      cand.sort((a, b) => b[0] - a[0]);
      // placed labels in a coarse grid, so checking for overlaps stays cheap with hundreds of names
      const CELL = 64, grid = new Map();
      const cells = (b, fn) => { for (let gx = Math.floor(b[0] / CELL); gx <= Math.floor(b[2] / CELL); gx++) for (let gy = Math.floor(b[1] / CELL); gy <= Math.floor(b[3] / CELL); gy++) if (fn(gx + ',' + gy) === false) return false; return true; };
      const free = (...b) => cells(b, k => { const list = grid.get(k); return !list || !list.some(t => b[0] < t[2] && b[2] > t[0] && b[1] < t[3] && b[3] > t[1]); });
      const taken = { push: b => cells(b, k => { let list = grid.get(k); if (!list) grid.set(k, list = []); list.push(b); }) };
      let shown = 0;
      const budget = st.labels === 'all' ? 700 : Math.round(30 + 120 * Math.min(4, view.k * view.k));
      for (const [score, d, weak] of cand) {
        if (weak && shown > 24) continue;
        if (shown >= budget && score < 1e9) break;
        const text = d.e.title.length > 34 ? d.e.title.slice(0, 32) + '…' : d.e.title;
        const w = g.measureText(text).width, x = sx(d), y = sy(d) + radius(d) + 3;
        const box = [x - w / 2 - 3, y - 1, x + w / 2 + 3, y + fs + 2];
        if (score < 1e9 && !free(...box)) continue;
        taken.push(box);
        const dimmed = L && !L.nodes.has(d.id);
        g.globalAlpha = dimmed ? 0.35 : 1;
        g.lineJoin = 'round'; g.lineWidth = 3.2; g.strokeStyle = C.alpha(colors.bg, 0.9); g.strokeText(text, x, y);
        g.fillStyle = must.has(d.id) ? colors.text : colors.muted; g.fillText(text, x, y);
        shown++;
      }
      g.globalAlpha = 1;
    }

    /* ---------------- hit testing ---------------- */
    function nodeAt(x, y) {
      if (!model) return null;
      let best = null, bd = Infinity;
      for (const d of model.nodes) {
        const dx = sx(d) - x, dy = sy(d) - y, r = radius(d) + 4, dd = dx * dx + dy * dy;
        if (dd < r * r && dd < bd) { bd = dd; best = d; }
      }
      return best;
    }
    function pairAt(x, y) {
      let best = null, bd = 25;
      for (const p of model.pairs) {
        const s = model.nodes[p.s], t = model.nodes[p.t];
        const x1 = sx(s), y1 = sy(s), x2 = sx(t), y2 = sy(t), dx = x2 - x1, dy = y2 - y1, l2 = dx * dx + dy * dy;
        if (!l2) continue;
        const u = Math.max(0, Math.min(1, ((x - x1) * dx + (y - y1) * dy) / l2)), px = x1 + u * dx - x, py = y1 + u * dy - y, dd = px * px + py * py;
        if (dd < bd) { bd = dd; best = p; }
      }
      return best;
    }

    /* ---------------- tooltip ---------------- */
    function showTip(x, y, content) {
      GK.clear(tip); GK.append(tip, content); tip.hidden = false;
      const w = tip.offsetWidth, hh = tip.offsetHeight;
      let left = x + 14, top = y + 14;
      if (left + w > W - 6) left = x - w - 14;
      if (top + hh > H - 6) top = y - hh - 14;
      tip.style.left = Math.max(6, left) + 'px'; tip.style.top = Math.max(6, top) + 'px';
    }
    const hideTip = () => { tip.hidden = true; };
    function nodeTip(d) {
      const e = d.e, t = WB.typeOf(e), age = WB.fmt.age(e);
      return [
        h('div.gk-row.nowrap', [U.icon(e), h('b.gk-ellipsis', { text: e.title })]),
        h('div.gk-small.gk-muted', { text: [t && t.name, WB.fmt.span(e), age != null ? 'age ' + age : '', d.deg ? WB.fmt.plural(d.deg, 'connection') : 'no connections'].filter(Boolean).join(' · ') }),
        e.summary ? h('div.gk-small.web-tip-sum', { text: e.summary }) : null,
        h('div.gk-tiny.gk-faint', { text: 'Click to peek · double-click to open · drag to pin' }),
      ];
    }
    function pairTip(p) {
      const rows = p.list.slice(0, 8).map(x => {
        const from = WB.titleOf(x.a), to = WB.titleOf(x.b);
        const what = x.kind === 'relation' ? C.relLabel(x.link, x.a) : x.kind === 'field' ? (x.link.label || 'refers to') + ' →' : x.kind === 'mention' ? 'mentions' : 'contains';
        const span = x.kind === 'relation' ? C.linkSpan(x.link) : '';
        return h('div.web-tip-row', [
          h('span.web-tip-line', { class: x.kind, style: { '--c': x.color || '' } }),
          h('span', [h('b', { text: from }), ' ', h('span.web-tip-what', { text: what }), ' ', h('b', { text: to }), span ? h('span.gk-faint', { text: '  ' + span }) : null, x.link && x.link.note ? h('div.gk-tiny.gk-muted', { text: x.link.note }) : null]),
        ]);
      });
      if (p.list.length > 8) rows.push(h('div.gk-tiny.gk-muted', { text: '+ ' + (p.list.length - 8) + ' more' }));
      return rows;
    }

    /* ---------------- pointer ---------------- */
    let down = null;
    canvas.addEventListener('pointerdown', ev => {
      if (ev.button !== 0) return;
      canvas.focus({ preventScroll: true });
      const p = C.local(canvas, ev), d = nodeAt(p.x, p.y);
      down = { x: p.x, y: p.y, vx: view.x, vy: view.y, node: d, moved: false, id: ev.pointerId };
      canvas.setPointerCapture(ev.pointerId);
      hideTip();
    });
    canvas.addEventListener('pointermove', ev => {
      const p = C.local(canvas, ev);
      if (down) {
        const dx = p.x - down.x, dy = p.y - down.y;
        if (!down.moved && Math.hypot(dx, dy) < 4) return;
        down.moved = true; autoFit = false;
        if (down.node) {
          const w = toWorld(p.x, p.y), d = down.node;
          d.fx = w.x; d.fy = w.y;
          if (sim) { sim.target = 0.12; sim.reheat(0.2); start(); }
          canvas.style.cursor = 'grabbing';
        } else {
          view.x = down.vx + dx; view.y = down.vy + dy;
          canvas.style.cursor = 'grabbing';
          redraw();
        }
        return;
      }
      const d = nodeAt(p.x, p.y);
      const pr = d ? null : pairAt(p.x, p.y);
      const changed = (d ? d.id : null) !== hover || pr !== hoverPair;
      hover = d ? d.id : null; hoverPair = pr;
      canvas.style.cursor = d ? 'pointer' : pr ? 'help' : 'grab';
      if (d) showTip(p.x, p.y, nodeTip(d)); else if (pr) showTip(p.x, p.y, pairTip(pr)); else hideTip();
      if (changed) redraw();
    });
    const endDrag = ev => {
      if (!down) return;
      const d = down.node, moved = down.moved;
      down = null; canvas.style.cursor = '';
      if (d && moved) {
        const pp = pins(); pp[d.id] = [Math.round(d.fx), Math.round(d.fy)]; savePins(pp);
        if (sim) sim.target = 0;
        redraw();
      } else if (!moved && ev.type === 'pointerup') {
        if (d) { select(d.id); if (ev.ctrlKey || ev.metaKey || ev.shiftKey) return; WB.peek(d.id); }
        else { select(null); }
      }
    };
    canvas.addEventListener('pointerup', endDrag);
    canvas.addEventListener('pointercancel', endDrag);
    canvas.addEventListener('pointerleave', () => { if (!down && (hover || hoverPair)) { hover = null; hoverPair = null; hideTip(); redraw(); } });
    canvas.addEventListener('dblclick', ev => { const p = C.local(canvas, ev), d = nodeAt(p.x, p.y); if (d) { WB.closePeek && WB.closePeek(); WB.open(d.id); } else fit(true); });
    canvas.addEventListener('wheel', ev => { ev.preventDefault(); const p = C.local(canvas, ev); zoomBy(Math.exp(-ev.deltaY * (ev.ctrlKey ? 0.004 : 0.0016)), p.x, p.y); }, { passive: false });
    canvas.addEventListener('contextmenu', ev => {
      ev.preventDefault();
      const p = C.local(canvas, ev), d = nodeAt(p.x, p.y);
      if (d) return nodeMenu(d, ev);
      U.menu([
        { label: 'Fit everything', icon: '⊡', kbd: '0', onClick: () => fit(true) },
        { label: 'Arrange again', icon: '↻', hint: 'Lay out the graph from scratch (pinned entries stay)', onClick: rearrange },
        Object.keys(pins()).length ? { label: 'Unpin all', icon: '⊘', onClick: unpinAll } : null,
        focus ? { label: 'Show everything (leave focus)', icon: '◎', onClick: () => setFocus(null) } : null,
      ], ev);
    });
    function nodeMenu(d, ev) {
      const pinned = !!pins()[d.id];
      const isPerson = (WB.typeOf(d.e) || {}).key === 'character';
      U.entryMenu(d.e, ev, [
        '-',
        { label: 'Focus on this', icon: '◎', kbd: 'F', onClick: () => setFocus(d.id) },
        { label: 'How is it connected to…', icon: '⇝', kbd: 'P', onClick: async () => { const b = await U.pickEntry({ title: 'How is “' + d.e.title + '” connected to…', exclude: [d.id] }); if (b) setPath(d.id, b.id); } },
        C.editable() ? { label: 'Add a relation…', icon: '☍', onClick: () => C.addRelation({ a: d.id }) } : null,
        isPerson ? { label: 'Family tree', icon: '⚭', onClick: () => env.go('family', { entryId: d.id }) } : null,
        pinned ? { label: 'Unpin', icon: '⊘', onClick: () => unpin(d.id) } : { label: 'Pin here', icon: '⊙', onClick: () => { const pp = pins(); pp[d.id] = [Math.round(d.x), Math.round(d.y)]; savePins(pp); d.fx = d.x; d.fy = d.y; redraw(); } },
      ]);
    }
    /** the canvas as it is now, on its own background, into the Library */
    async function saveImage() {
      const out = document.createElement('canvas');
      out.width = canvas.width; out.height = canvas.height;
      const g = out.getContext('2d');
      g.fillStyle = colors.bg; g.fillRect(0, 0, out.width, out.height);
      g.drawImage(canvas, 0, 0);
      const blob = await new Promise(res => out.toBlob(res, 'image/png'));
      const bytes = new Uint8Array(await blob.arrayBuffer());
      const name = 'Web of ' + ((WB.world && WB.world.name) || 'the world') + (focus ? ' — around ' + WB.titleOf(focus) : '') + '.png';
      const m = await WB.api('media.save', WB.worldId, { name, mime: 'image/png', bytes });
      ui.toast('Saved “' + ((m && m.name) || name) + '” to the Library', '▣', 4000);
      return m;
    }
    function unpin(id) { const pp = pins(); delete pp[id]; savePins(pp); const d = pos.get(id); if (d) { d.fx = d.fy = null; } if (sim) { sim.reheat(0.3); start(); } }
    function unpinAll() {
      const old = pins();
      savePins({});
      for (const d of pos.values()) { d.fx = d.fy = null; }
      if (focus && pos.get(focus)) { pos.get(focus).fx = 0; pos.get(focus).fy = 0; }
      if (sim) { sim.reheat(0.5); start(); }
      U.undoToast(WB.fmt.plural(Object.keys(old).length, 'entry', 'entries') + ' unpinned', () => { savePins(old); rebuild(false); });
      paintSide();
    }
    function rearrange() {
      const pp = pins();
      for (const [id, d] of pos) if (!pp[id]) { d.x = NaN; d.y = NaN; d.vx = d.vy = 0; }
      autoFit = true; rebuild(true);
    }

    /* ---------------- keyboard ---------------- */
    canvas.addEventListener('keydown', ev => {
      if (ev.target !== canvas) return;
      const k = ev.key;
      if (k === '+' || k === '=') zoomBy(1.25);
      else if (k === '-' || k === '_') zoomBy(1 / 1.25);
      else if (k === '0') fit(true);
      else if (k === 'Escape') { if (pathQ.list.length) setPath(null, null); else if (focus) setFocus(null); else select(null); }
      else if (k === 'Enter' && selected) WB.open(selected);
      else if (k === ' ' && selected) WB.peek(selected);
      else if ((k === 'f' || k === 'F') && selected) setFocus(selected);
      else if ((k === 'p' || k === 'P') && selected) pathFrom(selected);
      else if (k.startsWith('Arrow')) { const s = 60; view.x += k === 'ArrowLeft' ? s : k === 'ArrowRight' ? -s : 0; view.y += k === 'ArrowUp' ? s : k === 'ArrowDown' ? -s : 0; autoFit = false; redraw(); }
      else return;
      ev.preventDefault();
    });
    async function pathFrom(id) { const b = await U.pickEntry({ title: 'How is “' + WB.titleOf(id) + '” connected to…', exclude: [id] }); if (b) setPath(id, b.id); }

    /* ---------------- selection, focus, search, paths ---------------- */
    function select(id) { selected = id; redraw(); paintSelection(); }
    function setFocus(id) {
      if (focus && pos.get(focus) && !pins()[focus]) { pos.get(focus).fx = pos.get(focus).fy = null; }
      focus = id; autoFit = true;
      if (id) { selected = id; pathQ = { a: null, b: null, list: [], at: 0 }; }
      rebuild(false);
      setTimeout(() => fit(true), 50);
    }
    function computeMatches() {
      const q = query.trim().toLowerCase();
      if (!q || !model) return new Set();
      return new Set(model.nodes.filter(d => d.e.title.toLowerCase().includes(q) || (d.e.aliases || []).some(a => a.toLowerCase().includes(q))).map(d => d.id));
    }
    function findPaths(paint = true) {
      pathQ.list = []; pathQ.at = 0;
      if (pathQ.a && pathQ.b && model && model.index.has(pathQ.a) && model.index.has(pathQ.b)) pathQ.list = A.paths(model.adj, pathQ.a, pathQ.b, 5);
      if (paint) { paintSide(); redraw(); }
    }
    function setPath(a, b) {
      pathQ = { a, b, list: [], at: 0 };
      if (a && b && focus) { focus = null; }
      if (a && b && model && (!model.index.has(a) || !model.index.has(b))) { rebuild(false); }
      findPaths();
      if (pathQ.list.length) frame0(pathQ.list[0].nodes);
    }
    function frame0(ids) {
      if (!W) return;
      const ds = ids.map(id => pos.get(id)).filter(Boolean);
      if (!ds.length) return;
      let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity;
      for (const d of ds) { x0 = Math.min(x0, d.x); x1 = Math.max(x1, d.x); y0 = Math.min(y0, d.y); y1 = Math.max(y1, d.y); }
      const k = Math.max(0.15, Math.min(1.6, Math.min((W - 220) / Math.max(1, x1 - x0), (H - 200) / Math.max(1, y1 - y0))));
      autoFit = false;
      glide({ k, x: W / 2 - (x0 + x1) / 2 * k, y: H / 2 - (y0 + y1) / 2 * k });
    }

    /* ---------------- the side panel ---------------- */
    const sec = (title, body, extra) => h('section.web-sec', [h('div.web-sec-head', [h('h4', { text: title }), extra || null]), body]);
    const selBox = h('div.web-selbox'), count = h('div.gk-tiny.gk-muted.web-count');
    const paintCount = () => { count.textContent = query ? (matches.size ? WB.fmt.plural(matches.size, 'match', 'matches') + ' · Enter jumps to the first' : 'Nothing visible matches') : ''; };
    const searchBox = U.search({ placeholder: 'Highlight entries… (Ctrl+F)', value: query, onInput: v => { query = v; matches = computeMatches(); paintCount(); redraw(); }, onEnter: () => { const first = [...matches][0]; if (first) { select(first); centerOn(first); } } });
    function paintSide() {
      const keepScroll = side.scrollTop;
      GK.clear(side);
      if (!model) return;
      paintCount();
      side.append(h('section.web-sec', [searchBox, count]), selBox);
      paintSelection();

      // focus
      const fbody = h('div.web-stack');
      if (focus) {
        fbody.append(h('div.gk-row.nowrap', [U.chip(focus, { size: 'sm' }), h('span.gk-grow'), ui.button({ icon: '✕', small: true, kind: 'ghost', title: 'Show everything (Esc)', onClick: () => setFocus(null) })]),
          h('div.gk-row.nowrap', [h('span.gk-small.gk-muted', { text: 'Steps out' }), ui.segmented({ value: st.depth, options: [[1, '1'], [2, '2'], [3, '3']].map(([v, l]) => [v, l, v === 1 ? 'Direct links only' : v + ' links away']), onChange: v => { st.depth = v; save(); rebuild(false); setTimeout(() => fit(true), 60); } })]));
      } else {
        fbody.append(h('p.gk-small.gk-muted.web-hint', { text: 'Show one entry and what surrounds it.' }), ui.button({ label: 'Focus on…', icon: '◎', small: true, onClick: async () => { const e = await U.pickEntry({ title: 'Focus on…' }); if (e) setFocus(e.id); } }));
      }
      side.append(sec('Focus', fbody));

      // connection finder
      const pbody = h('div.web-stack');
      const slotA = C.slot({ id: pathQ.a, placeholder: 'Choose…', title: 'How is…', onPick: e => setPath(e && e.id, pathQ.b) });
      const slotB = C.slot({ id: pathQ.b, placeholder: 'Choose…', title: '…connected to', onPick: e => setPath(pathQ.a, e && e.id) });
      pbody.append(C.ends(slotA, slotB, 'From', 'To', () => setPath(pathQ.b, pathQ.a)));
      if (pathQ.a && pathQ.b) {
        if (!pathQ.list.length) pbody.append(h('p.gk-small.gk-muted.web-hint', { text: 'No connection through the links shown. Turn on more kinds of link, or leave the focus.' }));
        pathQ.list.forEach((p, i) => pbody.append(pathCard(p, i)));
      }
      side.append(sec('How are they connected?', pbody, pathQ.a || pathQ.b ? ui.button({ label: 'Clear', small: true, kind: 'ghost', onClick: () => setPath(null, null) }) : null));

      // link kinds
      const counts = {};
      for (const x of allEdges) counts[x.kind] = (counts[x.kind] || 0) + 1;
      const kbody = h('div.web-toggles', KINDS.map(([k, label, tip]) => toggleRow(h('span.web-line', { class: k }), label, counts[k] || 0, st.kinds[k], v => { st.kinds[k] = v; save(); rebuild(false); }, tip)));
      side.append(sec('Links', kbody));
      // relation categories
      if (st.kinds.relation) {
        const cc = {};
        for (const x of allEdges) if (x.kind === 'relation') cc[x.cat] = (cc[x.cat] || 0) + 1;
        const cats = C.CATS.filter(([c]) => cc[c]);
        if (cats.length) side.append(sec('Kinds of relation', h('div.wb-chips', cats.map(([c, label]) => {
          const on = st.cats[c] !== false;
          return chip(label, cc[c], C.CAT_COLOR[c], on, () => { st.cats[c] = !on; save(); rebuild(false); });
        }))));
      }
      // types (also the legend)
      const tc = {};
      for (const e of entries.values()) { const t = WB.typeOf(e); if (t) tc[t.key] = (tc[t.key] || 0) + 1; }
      const types = WB.typeList({ all: true }).filter(t => tc[t.key]);
      const tbody = h('div.wb-chips', types.map(t => {
        const on = !st.hideTypes.includes(t.key);
        const c = chip(t.icon + ' ' + t.plural, tc[t.key], t.color, on, ev => {
          if (ev.altKey) st.hideTypes = types.filter(x => x.key !== t.key).map(x => x.key);
          else st.hideTypes = on ? st.hideTypes.concat(t.key) : st.hideTypes.filter(k => k !== t.key);
          save(); rebuild(false);
        });
        c.title = (on ? 'Hide ' : 'Show ') + t.plural.toLowerCase() + ' · Alt+click shows only these';
        return c;
      }));
      side.append(sec('Entries', tbody, h('div.gk-row.nowrap', [
        ui.button({ label: 'All', small: true, kind: 'ghost', onClick: () => { st.hideTypes = []; save(); rebuild(false); } }),
        ui.button({ label: 'People & places', small: true, kind: 'ghost', title: 'Characters, places, factions', onClick: () => { st.hideTypes = types.filter(t => !['character', 'place', 'faction'].includes(t.key)).map(t => t.key); save(); rebuild(false); } }),
      ])));
      // tags
      const tags = WB.tags.filter(t => t.count);
      if (tags.length) side.append(sec('Tags', h('div.wb-chips', tags.map(t => chip('#' + t.name, t.count, t.color || null, st.tags.includes(t.id), () => { st.tags = st.tags.includes(t.id) ? st.tags.filter(x => x !== t.id) : st.tags.concat(t.id); save(); rebuild(false); }, true))), st.tags.length ? ui.button({ label: 'Any tag', small: true, kind: 'ghost', onClick: () => { st.tags = []; save(); rebuild(false); } }) : null));
      // time
      const tbody2 = h('div.web-stack', [
        h('label.web-toggle-row', { title: 'Hide entries that do not exist yet (or any more) and relations that do not hold at that date' }, [h('span.gk-grow', { text: 'As of a world date' }), ui.toggle({ value: st.asOf, onChange: v => { st.asOf = v; save(); rebuild(false); } })]),
        st.asOf ? h('div.web-asof', [
          WB.ui.dateInput({ value: asOfDate(), allowEmpty: false, onChange: v => { if (!v) return; st.asOfDay = Object.assign({}, st.asOfDay, { [WB.worldId]: { day: v.day, min: null, prec: v.prec === 'time' ? 'day' : v.prec } }); save(); rebuild(false); } }),
          ui.button({ label: 'Today', small: true, kind: 'ghost', title: 'The world’s current date', onClick: () => { const o = Object.assign({}, st.asOfDay); delete o[WB.worldId]; st.asOfDay = o; save(); rebuild(false); } }),
        ]) : h('p.gk-tiny.gk-muted.web-hint', { text: 'See who was alive, allied or married at any moment of your history.' }),
      ]);
      side.append(sec('Time', tbody2));
      // display
      const dbody = h('div.web-stack', [
        ui.field({ label: 'Colour by', control: ui.segmented({ value: st.colorBy, options: [['type', 'Type', 'Each entry in its type’s colour'], ['group', 'Groups', 'Clusters of closely linked entries']], onChange: v => { st.colorBy = v; save(); rebuild(false); } }) }),
        ui.field({ label: 'Names', control: ui.segmented({ value: st.labels, options: [['auto', 'Auto', 'As many as fit, the best-connected first'], ['all', 'All'], ['none', 'Hover only']], onChange: v => { st.labels = v; save(); redraw(); } }) }),
        h('label.web-toggle-row', [h('span.gk-grow', { text: 'Entries without links' }), ui.toggle({ value: st.orphans, onChange: v => { st.orphans = v; save(); rebuild(false); } })]),
        h('div.gk-row', [
          ui.button({ label: 'Arrange again', icon: '↻', small: true, title: 'Lay the graph out from scratch (pinned entries stay)', onClick: rearrange }),
          ui.button({ label: 'Save picture', icon: '▣', small: true, title: 'Save what the canvas shows as an image in the Library', onClick: () => saveImage().catch(WB.fail) }),
          Object.keys(pins()).length ? ui.button({ label: 'Unpin ' + Object.keys(pins()).length, icon: '⊘', small: true, kind: 'ghost', onClick: unpinAll }) : null,
        ]),
      ]);
      side.append(sec('Display', dbody));
      if (groups) side.append(sec('Groups', groupLegend()));
      side.scrollTop = keepScroll;
      status.textContent = WB.fmt.plural(model.nodes.length, 'entry', 'entries') + ' · ' + WB.fmt.plural(model.pairs.length, 'connection') + (st.asOf ? ' · as of ' + WB.fmt.date(asOfDate()) : '') + (model.nodes.length < entries.size ? ' · ' + (entries.size - model.nodes.length) + ' hidden' : '');
      banner.hidden = !!model.nodes.length;
      zoomBar.hidden = !model.nodes.length;
      GK.clear(banner);
      if (!model.nodes.length) banner.append(U.empty({ icon: '☍', title: entries.size ? 'Nothing to show with these filters' : 'Nothing to connect yet', text: entries.size ? 'Turn some entry types or kinds of link back on.' : 'Create entries and link them — mention them in text, fill reference fields or add relations — and the web draws itself.', actions: entries.size ? [ui.button({ label: 'Show everything', onClick: () => { st.hideTypes = []; st.tags = []; st.kinds = Object.assign({}, DEFAULTS.kinds, { mention: true }); st.orphans = true; focus = null; save(); rebuild(false); } })] : [ui.button({ label: 'New entry', kind: 'primary', icon: '＋', onClick: () => U.createDialog({}) })] }));
    }
    function chip(label, n, color, on, onClick, tag) {
      const c = h('button.web-chip', { type: 'button', class: (on ? 'on' : '') + (tag ? ' tag' : ''), style: color ? { '--c': color } : null, 'aria-pressed': String(!!on), onclick: onClick }, [color ? h('span.web-chip-dot') : null, h('span', { text: label }), h('span.web-chip-n', { text: String(n) })]);
      return c;
    }
    function toggleRow(sample, label, n, on, onChange, tip) {
      return h('label.web-toggle-row', { title: tip || '' }, [sample, h('span.gk-grow', { text: label }), h('span.gk-tiny.gk-faint', { text: String(n) }), ui.toggle({ value: on, onChange })]);
    }
    function groupLegend() {
      const by = new Map();
      for (const d of model.nodes) { const g = groups.get(d.id); if (g == null || g < 0) continue; let x = by.get(g); if (!x) by.set(g, x = []); x.push(d); }
      const list = [...by.entries()].sort((a, b) => a[0] - b[0]).slice(0, 12);
      if (!list.length) return h('p.gk-small.gk-muted', { text: 'No groups: link some entries first.' });
      return h('div.web-groups', list.map(([g, ds]) => {
        const hub = ds.slice().sort((a, b) => b.deg - a.deg)[0];
        const row = h('button.web-group', { type: 'button', class: highlightGroup === g ? 'on' : '', style: { '--c': C.GROUPS[g % C.GROUPS.length] }, title: 'Highlight this group' }, [h('span.web-chip-dot'), h('span.gk-grow.gk-ellipsis', { text: 'Around ' + hub.e.title }), h('span.web-chip-n', { text: String(ds.length) })]);
        row.addEventListener('click', () => { highlightGroup = highlightGroup === g ? null : g; paintSide(); redraw(); });
        return row;
      }));
    }
    function pathCard(p, i) {
      const steps = h('ol.web-steps');
      p.nodes.forEach((id, j) => {
        steps.appendChild(h('li.web-step', [h('span.web-step-n', { text: String(j + 1) }), U.chip(id, { size: 'sm' })]));
        if (j < p.edges.length) {
          const pair = p.edges[j], next = p.nodes[j + 1];
          const words = pair.list.slice(0, 3).map(x => {
            if (x.kind === 'relation') return C.relLabel(x.link, id);
            if (x.kind === 'field') return x.a === id ? (x.link.label || 'refers to') + ' →' : '← ' + (x.link.label || 'refers to');
            if (x.kind === 'mention') return x.a === id ? 'mentions' : 'is mentioned in';
            return x.a === id ? 'contains' : 'is inside';
          });
          steps.appendChild(h('li.web-step-link', { class: pair.top.kind, style: { '--c': pair.top.color || '' }, title: next ? WB.titleOf(id) + ' ' + words[0] + ' ' + WB.titleOf(next) : '' }, [h('span.web-tip-line', { class: pair.top.kind }), h('span', { text: words.join(' · ') + (pair.list.length > 3 ? ' …' : '') })]));
        }
      });
      const card = h('div.web-path', { class: i === pathQ.at ? 'on' : '', tabindex: 0 }, [h('div.web-path-head.gk-small', [h('b', { text: i === 0 ? 'Shortest' : 'Another way' }), h('span.gk-faint', { text: ' · ' + WB.fmt.plural(p.edges.length, 'step') })]), steps]);
      card.addEventListener('click', ev => { if (ev.target.closest('.wb-chip')) return; pathQ.at = i; paintSide(); redraw(); frame0(p.nodes); });
      return card;
    }
    function paintSelection() {
      GK.clear(selBox);
      if (!selected || !entries.has(selected)) return;
      const e = entries.get(selected), d = pos.get(selected);
      const near = model && model.adj.get(selected) ? model.adj.get(selected).length : 0;
      selBox.append(h('section.web-sec.web-selected', [
        h('div.gk-row.nowrap', [U.icon(e), h('b.gk-grow.gk-ellipsis', { text: e.title }), ui.button({ icon: '✕', small: true, kind: 'ghost', title: 'Deselect (Esc)', onClick: () => select(null) })]),
        h('div.gk-tiny.gk-muted', { text: [(WB.typeOf(e) || {}).name, WB.fmt.plural(near, 'connection')].join(' · ') }),
        h('div.gk-row.web-sel-actions', [
          ui.button({ label: 'Open', small: true, onClick: () => WB.open(selected) }),
          ui.button({ label: 'Focus', small: true, title: 'Show only its surroundings (F)', onClick: () => setFocus(selected) }),
          ui.button({ label: 'Path to…', small: true, title: 'How is it connected to another entry? (P)', onClick: () => pathFrom(selected) }),
          d && d.fx != null && selected !== focus ? ui.button({ label: 'Unpin', small: true, kind: 'ghost', onClick: () => { unpin(selected); paintSelection(); } }) : null,
        ]),
      ]));
    }

    /* ---------------- live updates ---------------- */
    const reload = WB.debounce(() => load().catch(WB.fail), 200);
    const offs = [
      WB.onChange(['entries', 'links', 'rel_types', 'tags', 'types'], reload),
      GK.bus.on('layout', () => size()),
      GK.bus.on('applied', () => { setTimeout(() => { colors = C.tokens(stage); memo.clear(); redraw(); }, 60); }),
    ];
    const keys = ev => {
      if (!root.isConnected) return;
      if (ev.ctrlKey && !ev.shiftKey && ev.key.toLowerCase() === 'f') { ev.preventDefault(); const inp = side.querySelector('.wb-search-input'); if (inp) { inp.focus(); inp.select(); } }
    };
    document.addEventListener('keydown', keys);

    /* ---------------- start ---------------- */
    const p = env.params || {};
    if (p.focus || p.entryId) focus = p.focus || p.entryId;
    if (p.depth) st.depth = p.depth;
    if (p.path) pathQ = { a: p.path[0], b: p.path[1], list: [], at: 0 };
    size();
    await load();
    if (pathQ.a && pathQ.b && pathQ.list.length) setTimeout(() => frame0(pathQ.list[0].nodes), 300);
    if (focus) selected = focus;

    // for smoke checks and other screens
    P.graphState = () => ({ nodes: model ? model.nodes.length : 0, pairs: model ? model.pairs.length : 0, finite: model ? model.nodes.every(d => Number.isFinite(d.x) && Number.isFinite(d.y)) : false, running, focus, paths: pathQ.list.length, k: view.k, W, H });
    P.graphApi = { setFocus, setPath, select, fit, centerOn };
    return () => {
      alive = false; cancelAnimationFrame(raf); cancelAnimationFrame(glideT); ro.disconnect(); offs.forEach(f => f()); document.removeEventListener('keydown', keys);
      P.graphApi = null;
    };
  };
})();
