/* Atlas toolbox: terrain brushes (raise, lower, smooth, water, land, coastline, biome, fill), region painting,
   rivers and auto-routed roads, deposits, decorative stamps, the eraser, snapping to the grid and multi-select with
   align/distribute. Every edit is recorded for the atlas undo history; terrain, regions, deposits and stamps are
   saved compactly in the map entry's data (see field.js for the codec). atlas.js passes in the screen's state. */
(function (root) {
  'use strict';
  const GK = root.GK, WB = root.WB, F = root.WBField, h = GK.h, ui = GK.ui;
  const addTo = (el, ...kids) => GK.append(el, kids);

  /** id, label, glyph, key, group, hint, needs ('field' = terrain, 'edit' = any editable map) */
  const DEFS = [
    ['stamp', 'Symbols', '♣', 'S', 'place', 'Click to stamp a mountain, forest or town; drag to scatter. Size and rotation in the bar above.', 'edit'],
    ['raise', 'Raise land', '▲', '1', 'terrain', 'Drag to raise the ground; keep going over water to make an island. [ ] size, { } strength.', 'field'],
    ['lower', 'Lower land', '▼', '2', 'terrain', 'Drag to lower the ground; below sea level it becomes sea.', 'field'],
    ['smooth', 'Smooth', '≈', '3', 'terrain', 'Drag to even out rough ground.', 'field'],
    ['water', 'Add water', '≋', '4', 'terrain', 'Drag to flood land into sea or lake.', 'field'],
    ['land', 'Remove water', '▩', '5', 'terrain', 'Drag to drain sea into low land.', 'field'],
    ['coast', 'Smooth coastline', '◠', '6', 'terrain', 'Drag along a shore to round off jagged coasts.', 'field'],
    ['biome', 'Paint biome', '◍', '7', 'terrain', 'Pick a biome in the bar above, then drag over land. Hold Alt to go back to automatic.', 'field'],
    ['fill', 'Fill biome', '▧', '8', 'terrain', 'Click to recolour a whole connected stretch of one biome.', 'field'],
    ['regionbrush', 'Paint a region', '◐', '9', 'regions', 'Pick or create a region in the bar above, then drag to paint it. Hold Alt to rub out.', 'edit'],
    ['river', 'River', '≀', 'I', 'draw', 'Click on land: the river runs downhill to the sea by itself. Without terrain, click along its course and press Enter.', 'edit'],
    ['road', 'Road (auto-route)', '⟿', 'O', 'draw', 'Click the start, then each stop: the road follows the cheapest ground between them. Enter finishes; hold Alt for a straight stretch.', 'edit'],
    ['deposit', 'Resource deposit', '◆', 'D', 'draw', 'Click to place a deposit of the chosen resource.', 'edit'],
    ['eraser', 'Eraser', '⌫', 'E', 'draw', 'Drag over stamps, deposits, painted regions and biome paint to remove them.', 'edit'],
  ];
  const OWNED = new Set(DEFS.map(d => d[0]));
  const BRUSH = new Set(['raise', 'lower', 'smooth', 'water', 'land', 'coast', 'biome', 'regionbrush', 'eraser']);
  const GROUP_NAMES = { place: 'Place', terrain: 'Terrain', regions: 'Regions', draw: 'Draw' };

  function create(ctx) {
    const { S, view, canvas, P, M } = ctx;
    const Geo = () => root.WBGeo;
    const T = { multi: new Set(), draft: null, stroke: null, hover: null, marquee: null, group: null };
    const opt = Object.assign({ size: 38, strength: .5, opacity: 1, biome: F.B.grass, deposit: 0, richness: 2, stamp: 0, stampSize: 30, stampRot: 0, jitter: true, region: 0, roadMode: 'auto', labelMode: 'point', curve: 0 }, (P.tools || {}));
    T.opt = opt;
    const saveOpt = () => { P.tools = Object.assign({}, opt); ctx.store.patch({ tools: P.tools }); };
    const ro = () => ctx.ro();
    const dirty = { terrain: false, paint: false, deco: false };

    T.owns = id => OWNED.has(id);
    T.def = id => DEFS.find(d => d[0] === id);
    T.defs = DEFS;
    T.isBrush = id => BRUSH.has(id);
    T.hint = id => (T.def(id) || [])[5] || '';
    const radiusMap = () => opt.size * view.ui / view.t.k;

    /* ---------- saving ---------- */
    const flush = () => {
      const patch = {};
      if (dirty.terrain && M.field) patch.terrain = F.encode(M.field);
      if (dirty.paint && M.paint) patch.paint = F.encodePaint(M.paint);
      if (dirty.deco) { patch.stamps = S.data.stamps || []; patch.deposits = S.data.deposits || []; }
      dirty.terrain = dirty.paint = dirty.deco = false;
      return Object.keys(patch).length ? ctx.patchData(patch).catch(WB.fail) : Promise.resolve();
    };
    const persistSoon = WB.debounce(flush, 700);
    T.flush = flush;
    const mark = what => { dirty[what] = true; persistSoon(); };
    T.mark = mark;

    /* ---------- making sure there is terrain to paint ---------- */
    T.ensureField = async function () {
      if (M.field) return true;
      const D = S.data;
      let fill = F.SEA - 40;
      if (D.image && !await ui.confirm('Paint terrain on this map?', 'This map uses a picture. Painted terrain is drawn instead of the picture (the picture stays in the Library). Start from open sea?', 'Start painting')) return false;
      if (!D.image) {
        const body = h('div.gk-stack', [h('p.gk-text', { text: 'This map has no terrain yet. What should the sheet start as?' })]);
        let land = false;
        body.appendChild(ui.segmented({ value: 'sea', options: [['sea', 'Open sea', 'Raise islands and continents out of the water'], ['land', 'Flat grassland', 'Carve seas, rivers and mountains into it']], onChange: v => { land = v === 'land'; } }));
        const ok = await ui.dialog({ title: 'Start painting terrain', icon: '⛰', body, actions: [{ label: 'Cancel', value: false }, { label: 'Start', kind: 'primary', value: true }] });
        if (!ok) return false;
        if (land) fill = F.SEA + 24;
      }
      const planet = Geo().isPlanet(D), [gw, gh] = F.gridFor(D.width, D.height);
      const f = F.create(gw, gh, { seed: 1, planet, mapW: D.width, mapH: D.height, fill, params: { mode: planet ? 'planet' : 'region', lat0: .3, lat1: .52, _v: 1 } });
      M.field = f; M.base = null;
      F.derive(f);
      S.data.terrain = F.encode(f);
      mark('terrain'); flush();
      M.setMode(M.mode, M.style);
      ctx.refreshChrome();
      return true;
    };
    const needField = id => (T.def(id) || [])[6] === 'field';

    /* ---------- history ---------- */
    const layers = () => ({ elev: M.field && M.field.elev, biome: M.field && M.field.biome, reg: M.paint && M.paint.reg });
    function recordPatch(patch, what) {
      const apply = dir => () => {
        F.applyPatch(layers(), patch, dir);
        if (patch.elev && M.field) F.touch(M.field, 'elev');
        if (patch.biome && M.field) F.touch(M.field, 'biome');
        if (patch.reg) M.touchPaint();
        if (M.field) M.settle();
        for (const w of what) mark(w);
        return Promise.resolve();
      };
      ctx.record(apply('old'), apply('nw'));
    }
    function recordDeco(before, after) {
      const set = (v) => () => { S.data.stamps = v.stamps.map(s => s.slice()); S.data.deposits = v.deposits.map(s => s.slice()); mark('deco'); view.draw(); return Promise.resolve(); };
      ctx.record(set(before), set(after));
    }
    const snapDeco = () => ({ stamps: (S.data.stamps || []).map(s => s.slice()), deposits: (S.data.deposits || []).map(s => s.slice()) });

    /* ---------- grid snapping ---------- */
    T.snapOn = () => !!(P.snap || {})[S.map && S.map.id] && S.data && S.data.grid && S.data.grid.type !== 'none';
    T.setSnap = on => { const s = Object.assign({}, P.snap); s[S.map.id] = on; P.snap = s; ctx.store.patch({ snap: s }); ctx.refreshChrome(); };
    T.snap = p => (T.snapOn() ? F.snapGrid(S.data.grid, p[0], p[1]) : p);

    /* ---------- pointer: owned tools ---------- */
    T.down = async function (e, sx, sy, mx, my) {
      const id = S.tool;
      if (ro()) return;
      if (needField(id) && !M.field) { if (!(await T.ensureField())) return; }
      const pt = T.snap([mx, my]);
      if (id === 'road' || id === 'river') return roadDown(id, e, pt);
      if (id === 'deposit') return depositAt(pt);
      if (id === 'fill') return fillAt(mx, my);
      if (id === 'stamp') { startDeco(); stampAt(mx, my, true); T.stroke = { tool: 'stamp', last: [mx, my], deco: T.decoBefore }; return; }
      if (id === 'regionbrush' && !activeRegion()) { ui.toast('Create a region first: use “New region” in the bar above', 'ℹ'); return; }
      if (id === 'eraser') startDeco();
      const layersNow = { elev: M.field && M.field.elev, biome: M.field && M.field.biome, reg: M.paint && M.paint.reg };
      if (id === 'regionbrush' || id === 'eraser') ensurePaint();
      if (M.paint) layersNow.reg = M.paint.reg;
      T.stroke = { tool: id, rec: new F.Rec(layersNow), last: [mx, my], alt: e.altKey, box: [mx, my, mx, my], deco: T.decoBefore };
      strokeTo(mx, my, true);
    };
    function ensurePaint() { if (!M.paint) M.paint = F.newPaint(S.data.width, S.data.height); }
    const activeRegion = () => (M.paint ? M.paint.regs.find(r => r.id === opt.region) : null);
    function strokeTo(mx, my, first) {
      const st = T.stroke;
      if (!st || st.tool === 'stamp') return;
      const r = radiusMap(), step = Math.max(r * .28, .5 / view.t.k), dx = mx - st.last[0], dy = my - st.last[1], dist = Math.hypot(dx, dy), n = first ? 1 : Math.max(1, Math.floor(dist / step));
      for (let k = 1; k <= n; k++) {
        const x = first ? mx : st.last[0] + dx * k / n, y = first ? my : st.last[1] + dy * k / n;
        dabAt(st, x, y, r);
        st.box[0] = Math.min(st.box[0], x - r); st.box[1] = Math.min(st.box[1], y - r); st.box[2] = Math.max(st.box[2], x + r); st.box[3] = Math.max(st.box[3], y + r);
      }
      st.last = [mx, my];
      if (M.field && st.tool !== 'regionbrush') M.dirty(st.box[0], st.box[1], st.box[2], st.box[3]); else view.draw();
    }
    function dabAt(st, x, y, r) {
      const id = st.tool, f = M.field;
      if (id === 'regionbrush') { F.paintRegion(M.paint, st.rec, x, y, r, st.alt ? 0 : opt.region); M.touchPaintLight(); return; }
      if (id === 'eraser') {
        F.paintRegion(M.paint, st.rec, x, y, r, 0);
        if (f) F.dab(f, st.rec, 'biome', x, y, r, 1, 1, { biome: 0, hard: true });
        eraseDeco(x, y, r);
        return;
      }
      if (id === 'biome') F.dab(f, st.rec, 'biome', x, y, r, opt.strength, opt.opacity, { biome: st.alt ? 0 : opt.biome, hard: false, salt: (x * 7 + y * 13) | 0 });
      else F.dab(f, st.rec, id, x, y, r, opt.strength, opt.opacity);
    }
    M.touchPaintLight = M.touchPaintLight || (() => { M.reg = null; });
    function eraseDeco(x, y, r) {
      const D = S.data;
      if (D.stamps) D.stamps = D.stamps.filter(s => Math.hypot(s[0] - x, s[1] - y) > r * .8);
      if (D.deposits) D.deposits = D.deposits.filter(s => Math.hypot(s[0] - x, s[1] - y) > r * .8 + 4);
    }
    T.up = function (e) {
      const st = T.stroke, mq = T.marquee, g = T.group;
      if (mq) { finishMarquee(e); return true; }
      if (g) { finishGroupMove(); return true; }
      if (!st) return false;
      T.stroke = null;
      if (st.deco) {
        const after = snapDeco();
        if (JSON.stringify(after) !== JSON.stringify(st.deco)) { recordDeco(st.deco, after); mark('deco'); }
        T.decoBefore = null;
      }
      if (st.rec && st.rec.changed) {
        const patch = st.rec.patch(), what = [];
        if (patch.elev || patch.biome) what.push('terrain');
        if (patch.reg) { what.push('paint'); M.touchPaint(); }
        if (patch.elev && M.field) F.touch(M.field, 'elev');
        if (patch.biome && M.field) F.touch(M.field, 'biome');
        recordPatch(patch, what);
        if (M.field) M.settle();
        for (const w of what) mark(w);
        ctx.paintOptions();
      }
      view.draw();
      return true;
    };
    T.move = function (e, sx, sy, mx, my, busy) {
      T.hover = [sx, sy];
      if (T.marquee) { T.marquee.to = [sx, sy]; view.draw(); return true; }
      if (T.group) { groupDrag(mx, my); return true; }
      if (T.stroke) {
        if (T.stroke.tool === 'stamp') stampAt(mx, my, false); else strokeTo(mx, my, false);
        return true;
      }
      if (busy || !OWNED.has(S.tool)) return false;
      view.draw();
      canvas.style.cursor = 'crosshair';
      return false;
    };
    T.dbl = function () { if (T.draft) { finishDraft(); return true; } return false; };
    T.escape = function () {
      if (T.draft) { T.draft = null; view.draw(); return true; }
      if (T.multi.size) { T.clearMulti(); return true; }
      return false;
    };
    T.finish = () => { if (T.draft) { finishDraft(); return true; } return false; };

    /* ---------- fill, stamps, deposits ---------- */
    function fillAt(mx, my) {
      const rec = new F.Rec({ biome: M.field.biome });
      const n = F.fillBiome(M.field, rec, mx, my, opt.biome);
      if (!n) { ui.toast('Nothing to fill there: click on land', 'ℹ'); return; }
      recordPatch(rec.patch(), ['terrain']);
      M.settle(); mark('terrain');
    }
    function startDeco() { T.decoBefore = snapDeco(); }
    function stampAt(mx, my, first) {
      const st = T.stroke, D = S.data;
      if (!first && st && Math.hypot(mx - st.last[0], my - st.last[1]) < opt.stampSize * .7 / 1) return;
      if (!first && st) st.last = [mx, my];
      D.stamps = D.stamps || [];
      const jx = first || !opt.jitter ? 0 : (Math.random() - .5) * opt.stampSize * .5, jy = first || !opt.jitter ? 0 : (Math.random() - .5) * opt.stampSize * .5;
      const p = first ? T.snap([mx, my]) : [mx + jx, my + jy];
      D.stamps.push([Math.round(p[0]), Math.round(p[1]), opt.stamp, Math.round(opt.stampSize * (first || !opt.jitter ? 1 : .8 + Math.random() * .4)), Math.round(opt.stampRot + (first || !opt.jitter ? 0 : (Math.random() - .5) * 20))]);
      view.draw();
    }
    function depositAt(pt) {
      startDeco();
      const D = S.data; D.deposits = D.deposits || [];
      D.deposits.push([Math.round(pt[0]), Math.round(pt[1]), opt.deposit, opt.richness]);
      recordDeco(T.decoBefore, snapDeco()); T.decoBefore = null;
      mark('deco'); view.draw();
      if (M.mode !== 'resources') ui.toast('Placed ' + F.RES[opt.deposit][1].toLowerCase() + ' — switch to the Resources view to see all deposits', '◆');
    }

    /* ---------- roads and rivers ---------- */
    function nearestPin(p) {
      let best = null, bd = 14 * view.ui / view.t.k;
      for (const it of view.shown()) if (it.kind === 'pin') { const d = Math.hypot(it.x - p[0], it.y - p[1]); if (d < bd) { bd = d; best = it; } }
      return best ? [best.x, best.y] : p;
    }
    function roadDown(id, e, pt) {
      const roads = S.items.filter(i => i.kind === 'path' && ['road', 'street'].includes(i.style.kind)).map(i => i.points);
      if (id === 'river') {
        if (M.field && !e.altKey && !T.draft) {
          const pts = F.riverFrom(M.field, pt[0], pt[1]);
          if (!pts) { ui.toast('Click on land: rivers run down to the sea', 'ℹ'); return; }
          commitPath(pts, 'river', 'River');
          return;
        }
        if (!T.draft) T.draft = { kind: 'river', pts: [pt] }; else T.draft.pts.push(pt);
        view.draw(); return;
      }
      const p = nearestPin(pt);
      if (!T.draft) { T.draft = { kind: 'road', pts: [p] }; view.draw(); return; }
      const last = T.draft.pts[T.draft.pts.length - 1];
      if (e.altKey || opt.roadMode === 'straight' || !M.field) T.draft.pts.push(p);
      else {
        const r = F.route(M.field, last, p, { kind: 'road', roads });
        if (!r) { ui.toast('No land route there: the sea is in the way', '⚠'); return; }
        T.draft.pts.push(...r.pts.slice(1));
      }
      view.draw();
    }
    async function finishDraft() {
      const d = T.draft; T.draft = null;
      if (!d || d.pts.length < 2) { view.draw(); return; }
      await commitPath(d.pts, d.kind, d.kind === 'road' ? 'Road' : 'River');
    }
    async function commitPath(pts, kind, label) {
      const simp = Geo().simplify(pts, .6 / Math.max(.2, view.t.k));
      const it = await ctx.put({ mapId: S.map.id, kind: 'path', points: simp.length >= 2 ? simp : pts, label: '', style: { kind } });
      ctx.select(it.id); ctx.paintSide(); ctx.paintLegend();
      ui.toast(label + ' added', kind === 'road' ? '⟿' : '≀');
    }
    /** roads between every settlement pin on the map, joined along the cheapest ground */
    T.autoRoads = async function () {
      if (ro()) return;
      const pins = S.items.filter(i => i.kind === 'pin' && ['capital', 'city', 'town', 'village', 'port', 'castle'].includes(root.WB.atlasView.iconOf(i)));
      if (pins.length < 2) return ui.toast('Pin at least two settlements first (towns, cities, villages…)', 'ℹ');
      const sites = pins.map(p => ({ x: p.x, y: p.y }));
      const links = M.field ? F.roadNetwork(M.field, sites) : [];
      if (!M.field) for (let i = 1; i < sites.length; i++) links.push({ a: i, b: 0, pts: [[sites[i].x, sites[i].y], [sites[0].x, sites[0].y]] });
      const have = S.items.filter(i => i.kind === 'path' && i.style.kind === 'road');
      const fresh = links.filter(l => l.pts.length > 1);
      if (!fresh.length) return ui.toast('No land routes between them', 'ℹ');
      const res = await WB.api('atlas.bulk', { save: fresh.map(l => ({ mapId: S.map.id, kind: 'path', points: l.pts, label: '', style: { kind: 'road' } })) });
      res.saved.forEach(ctx.upsert);
      const ids = res.saved.map(x => x.id);
      ctx.record(() => WB.api('atlas.bulk', { remove: ids }), () => WB.api('atlas.bulk', { save: res.saved.map(x => ctx.strip(x)) }));
      ctx.reloadItems();
      ui.toast(fresh.length + ' roads laid' + (have.length ? ' beside ' + have.length + ' existing' : ''), '⟿');
    };

    /* ---------- multi-select ---------- */
    const itemsOf = ids => S.items.filter(i => ids.has(i.id));
    T.clearMulti = () => { T.multi.clear(); view.opt.multi = T.multi; ctx.paintOptions(); view.draw(); };
    T.setMulti = ids => { T.multi = new Set(ids); view.opt.multi = T.multi; ctx.paintOptions(); view.draw(); };
    /** select-tool press: shift toggles/marquees, a press on a multi-selected item drags the group. Returns true when consumed. */
    T.selectDown = function (e, sx, sy, mx, my) {
      const hit = view.hit(sx, sy, { handles: false });
      if (ro()) return false;
      if (e.shiftKey) {
        if (hit) {
          if (!T.multi.size && S.sel) T.multi.add(S.sel);
          if (T.multi.has(hit.item.id)) T.multi.delete(hit.item.id); else T.multi.add(hit.item.id);
          view.opt.multi = T.multi; ctx.paintOptions(); view.draw();
          if (T.multi.size > 1) ctx.select(null);
          return true;
        }
        T.marquee = { from: [sx, sy], to: [sx, sy], add: true };
        canvas.setPointerCapture && canvas.setPointerCapture(e.pointerId);
        return true;
      }
      if (T.multi.size > 1 && hit && T.multi.has(hit.item.id)) {
        T.group = { from: [mx, my], orig: itemsOf(T.multi).map(i => ({ id: i.id, x: i.x, y: i.y, points: i.points.map(p => p.slice()) })), moved: false };
        canvas.setPointerCapture && canvas.setPointerCapture(e.pointerId);
        return true;
      }
      if (T.multi.size) T.clearMulti();
      return false;
    };
    function groupDrag(mx, my) {
      const g = T.group, dx = mx - g.from[0], dy = my - g.from[1];
      if (!g.moved && Math.hypot(dx, dy) * view.t.k < 3) return;
      g.moved = true;
      for (const o of g.orig) { const it = S.items.find(i => i.id === o.id); if (!it) continue; it.x = o.x + dx; it.y = o.y + dy; it.points = o.points.map(p => [p[0] + dx, p[1] + dy]); }
      view.setItems(S.items); view.draw();
    }
    async function finishGroupMove() {
      const g = T.group; T.group = null;
      if (!g || !g.moved) return;
      const cur = g.orig.map(o => { const it = S.items.find(i => i.id === o.id); return { id: o.id, x: it.x, y: it.y, points: it.points }; });
      await applyBulk(cur, g.orig);
    }
    async function applyBulk(save, before) {
      try {
        const r = await WB.api('atlas.bulk', { save });
        r.saved.forEach(ctx.upsert);
        ctx.record(() => WB.api('atlas.bulk', { save: before }), () => WB.api('atlas.bulk', { save }));
        view.draw();
      } catch (err) { WB.fail(err); ctx.reloadItems(); }
    }
    function finishMarquee() {
      const m = T.marquee; T.marquee = null;
      const x0 = Math.min(m.from[0], m.to[0]), x1 = Math.max(m.from[0], m.to[0]), y0 = Math.min(m.from[1], m.to[1]), y1 = Math.max(m.from[1], m.to[1]);
      if (x1 - x0 < 4 && y1 - y0 < 4) { view.draw(); return; }
      if (!T.multi.size && S.sel) T.multi.add(S.sel);
      for (const it of view.shown()) {
        const b = F.itemBox(it), p0 = view.toScreen(b.x0, b.y0), p1 = view.toScreen(b.x1, b.y1);
        if (p1[0] >= x0 && p0[0] <= x1 && p1[1] >= y0 && p0[1] <= y1 && (it.kind === 'pin' || it.kind === 'label' || (p0[0] >= x0 && p1[0] <= x1 && p0[1] >= y0 && p1[1] <= y1))) T.multi.add(it.id);
      }
      view.opt.multi = T.multi;
      if (T.multi.size > 1) ctx.select(null);
      ctx.paintOptions(); view.draw();
    }
    T.selectAll = () => { T.setMulti(view.shown().map(i => i.id)); ctx.select(null); };
    T.removeMulti = async function () {
      const items = itemsOf(T.multi).map(ctx.strip);
      if (!items.length) return;
      const ids = items.map(i => i.id);
      await WB.api('atlas.bulk', { remove: ids });
      ctx.record(() => WB.api('atlas.bulk', { save: items }), () => WB.api('atlas.bulk', { remove: ids }));
      T.clearMulti(); await ctx.reloadItems();
      WB.ui.undoToast('Removed ' + ids.length + ' items', () => WB.api('atlas.bulk', { save: items }).then(ctx.reloadItems));
    };
    T.align = async function (how) {
      const items = itemsOf(T.multi), patches = how === 'dx' || how === 'dy' ? F.distributePatches(items, how === 'dx' ? 'x' : 'y') : F.alignPatches(items, how);
      if (!patches.length) return;
      const before = patches.map(p => { const it = S.items.find(i => i.id === p.id); return { id: it.id, x: it.x, y: it.y, points: it.points.map(q => q.slice()) }; });
      for (const p of patches) { const it = S.items.find(i => i.id === p.id); it.x = p.x; it.y = p.y; it.points = p.points; }
      view.setItems(S.items); view.draw();
      await applyBulk(patches, before);
    };

    /* ---------- overlay: brush ring, stamp preview, drafts, marquee ---------- */
    T.overlay = function (g) {
      const D = S.data;
      if (T.marquee) {
        const m = T.marquee, x = Math.min(m.from[0], m.to[0]), y = Math.min(m.from[1], m.to[1]), w = Math.abs(m.to[0] - m.from[0]), hh = Math.abs(m.to[1] - m.from[1]);
        g.save(); g.fillStyle = 'rgba(80,160,255,.14)'; g.strokeStyle = 'rgba(255,255,255,.9)'; g.setLineDash([5, 3]); g.fillRect(x, y, w, hh); g.strokeRect(x, y, w, hh); g.restore();
      }
      if (T.draft) {
        const pts = T.draft.pts.slice();
        if (S.hoverMap) pts.push(S.hoverMap);
        g.save(); g.lineJoin = 'round'; g.lineCap = 'round'; g.beginPath();
        pts.forEach((p, i) => { const [x, y] = view.toScreen(p[0], p[1]); if (i) g.lineTo(x, y); else g.moveTo(x, y); });
        g.lineWidth = 5 * view.ui; g.strokeStyle = 'rgba(255,255,255,.7)'; g.stroke();
        g.lineWidth = 2.6 * view.ui; g.strokeStyle = T.draft.kind === 'river' ? '#3b7fb0' : '#8a5a2a'; g.stroke(); g.restore();
      }
      if (T.hover && OWNED.has(S.tool) && !ro() && S.hoverMap) {
        const [x, y] = T.hover, id = S.tool;
        g.save(); g.lineWidth = 1.6; g.strokeStyle = 'rgba(255,255,255,.95)'; g.fillStyle = 'rgba(255,255,255,.08)';
        if (BRUSH.has(id)) {
          const r = opt.size * view.ui;
          g.beginPath(); g.arc(x, y, r, 0, Math.PI * 2); g.fill(); g.stroke();
          g.beginPath(); g.arc(x, y, r * (1 - opt.strength * .7), 0, Math.PI * 2); g.setLineDash([3, 4]); g.strokeStyle = 'rgba(255,255,255,.6)'; g.stroke();
        } else if (id === 'stamp') {
          g.globalAlpha = .65; M.drawStamp(g, opt.stamp, x, y, opt.stampSize * view.t.k, opt.stampRot);
        } else if (id === 'deposit') {
          g.beginPath(); g.arc(x, y, (6 + opt.richness * 1.6) * view.ui, 0, Math.PI * 2); g.fillStyle = F.RES[opt.deposit][2]; g.globalAlpha = .75; g.fill(); g.stroke();
        } else if (id === 'fill' || id === 'river' || id === 'road') {
          g.beginPath(); g.arc(x, y, 5 * view.ui, 0, Math.PI * 2); g.stroke();
        }
        if (M.field && (id === 'raise' || id === 'lower' || id === 'water' || id === 'land')) {
          const info = WB.atlasView && M.describe(S.hoverMap[0], S.hoverMap[1]);
          if (info) { g.setLineDash([]); g.font = '600 ' + 11 * view.ui + 'px sans-serif'; g.fillStyle = 'rgba(15,22,32,.8)'; const tw = g.measureText(info).width; g.fillRect(x + 12, y + 14, tw + 10, 18 * view.ui); g.fillStyle = '#fff'; g.textBaseline = 'middle'; g.fillText(info, x + 17, y + 14 + 9 * view.ui); }
        }
        g.restore();
      }
    };

    /* ---------- keys ---------- */
    T.key = function (e) {
      const k = e.key;
      if (e.ctrlKey && k.toLowerCase() === 'a' && !ro()) { e.preventDefault(); T.selectAll(); return true; }
      if (e.ctrlKey || e.metaKey) return false;
      if ((k === 'Delete' || k === 'Backspace') && T.multi.size > 1 && !ro()) { e.preventDefault(); T.removeMulti(); return true; }
      if (ro()) return false;
      if (k === '[' || k === ']') { opt.size = F.clamp(Math.round(opt.size * (k === ']' ? 1.2 : 1 / 1.2)), 4, 220); saveOpt(); ctx.paintOptions(); view.draw(); return true; }
      if (k === '{' || k === '}') { opt.strength = F.clamp(Math.round((opt.strength + (k === '}' ? .1 : -.1)) * 100) / 100, .05, 1); saveOpt(); ctx.paintOptions(); return true; }
      if (k === 'Enter' && T.draft) { e.preventDefault(); finishDraft(); return true; }
      if (k === 'Backspace' && T.draft) { e.preventDefault(); T.draft.pts.pop(); if (!T.draft.pts.length) T.draft = null; view.draw(); return true; }
      if (k === 'g' || k === 'G') { if (S.data.grid.type !== 'none') { T.setSnap(!T.snapOn()); ui.toast(T.snapOn() ? 'Snapping to the grid' : 'Snapping off', '▦'); } else ui.toast('Turn a grid on in Map ▸ Layers to snap to it', 'ℹ'); return true; }
      const d = DEFS.find(x => x[3].toLowerCase() === k.toLowerCase());
      if (d) { ctx.setTool(d[0]); return true; }
      return false;
    };

    /* ---------- the rail ---------- */
    T.paintRail = function (rail, core) {
      GK.clear(rail);
      const btn = (id, label, glyph, key, on, fn, dis) => h('button.wb-at-tool', { type: 'button', class: on ? 'on' : '', 'aria-pressed': String(!!on), title: label + (key ? ' (' + key + ')' : '') + (dis ? ' — ' + dis : ''), disabled: !!dis, onclick: fn }, [h('span', { text: glyph })]);
      const sep = name => h('div.wb-at-toolsep', { title: name || '' });
      for (const c of core.first) rail.appendChild(btn(c[0], c[1], c[2], c[3], S.tool === c[0], () => ctx.setTool(c[0])));
      if (!ro()) {
        let group = '';
        for (const d of DEFS) {
          if (d[4] !== group) { group = d[4]; rail.appendChild(sep(GROUP_NAMES[group])); }
          const dis = needField(d[0]) && !M.field && S.data.image ? 'paints over the picture' : '';
          rail.appendChild(btn(d[0], d[1], d[2], d[3], S.tool === d[0], () => ctx.setTool(d[0])));
          void dis;
        }
        rail.appendChild(sep(''));
        rail.appendChild(btn('snap', T.snapOn() ? 'Snapping to the grid is on (G)' : 'Snap to the grid (G)', '▦', 'G', T.snapOn(), () => { if (S.data.grid.type === 'none') ui.toast('Turn a grid on in Map ▸ Layers first', 'ℹ'); else T.setSnap(!T.snapOn()); }));
        rail.appendChild(btn('undo', 'Undo', '↶', 'Ctrl+Z', false, () => ctx.undo()));
        rail.appendChild(btn('redo', 'Redo', '↷', 'Ctrl+Y', false, () => ctx.redo()));
      }
      rail.appendChild(sep(''));
      for (const c of core.last) rail.appendChild(btn(c[0], c[1], c[2], c[3], false, c[4]));
    };

    /* ---------- the options bar (changes with the tool) ---------- */
    const biomeButtons = () => h('div.wb-at-biomes', F.BIOMES.slice(1).map((b, i) => h('button.wb-at-biome', { type: 'button', class: opt.biome === i + 1 ? 'on' : '', title: b[1], style: { '--c': 'rgb(' + b[2].join(',') + ')' }, onclick: ev => { opt.biome = i + 1; saveOpt(); [...ev.currentTarget.parentNode.children].forEach((x, k) => x.classList.toggle('on', k === i)); } }, [h('span.wb-at-biome-sw'), h('span.wb-at-biome-nm', { text: b[1] })])));
    const slider = (label, key, min, max, step, fmt) => ui.field({ label, inline: true, control: ui.slider({ min, max, step, value: opt[key], format: fmt, onInput: v => { opt[key] = v; saveOpt(); view.draw(); } }) });
    T.paintOptions = function (bar) {
      GK.clear(bar);
      const id = S.tool;
      const rows = [];
      if (T.multi.size > 1 && id === 'select' && !ro()) {
        const ab = (how, glyph, title) => ui.button({ icon: glyph, small: true, kind: 'ghost', title, onClick: () => T.align(how) });
        rows.push(h('div.gk-row.nowrap', [h('b', { text: T.multi.size + ' selected' }), ab('left', '⇤', 'Align left edges'), ab('center', '⇔', 'Align centres horizontally'), ab('right', '⇥', 'Align right edges'), ab('top', '⤒', 'Align tops'), ab('middle', '⇕', 'Align centres vertically'), ab('bottom', '⤓', 'Align bottoms'),
          ab('dx', '⋯', 'Distribute evenly left to right'), ab('dy', '⋮', 'Distribute evenly top to bottom'), ui.button({ icon: '🗑', small: true, kind: 'danger', title: 'Remove them all (Del)', onClick: () => T.removeMulti() }), ui.button({ icon: '✕', small: true, kind: 'ghost', title: 'Clear the selection (Esc)', onClick: () => T.clearMulti() })]));
        rows.push(h('div.gk-tiny.gk-faint', { text: 'Drag any selected item to move them together. Shift+click adds or removes; Shift+drag draws a box.' }));
      } else if (OWNED.has(id) && !ro()) {
        const def = T.def(id);
        rows.push(h('div.gk-row.nowrap', [h('b', { text: def[1] }), h('span.gk-small.gk-muted.gk-grow', { text: def[5] })]));
        if (BRUSH.has(id)) {
          const r = [slider('Size', 'size', 4, 220, 1, v => v + ' px')];
          if (id !== 'eraser' && id !== 'regionbrush') r.push(slider('Strength', 'strength', .05, 1, .05, v => Math.round(v * 100) + '%'));
          if (id === 'biome') r.push(slider('Opacity', 'opacity', .2, 1, .05, v => Math.round(v * 100) + '%'));
          rows.push(h('div.wb-at-optrow', r));
        }
        if (id === 'biome' || id === 'fill') rows.push(biomeButtons());
        if (id === 'regionbrush') {
          if (!M.paint) M.paint = M.paint;
          const regs = M.paint ? M.paint.regs : [];
          if (!regs.find(r => r.id === opt.region)) opt.region = regs[0] ? regs[0].id : 0;
          rows.push(h('div.gk-row', regs.map(r => ui.chip({ label: r.name, on: opt.region === r.id, title: 'Paint ' + r.name, onClick: () => { opt.region = r.id; saveOpt(); ctx.paintOptions(); } })).concat([
            ui.button({ label: 'New region', icon: '＋', small: true, onClick: newRegion }),
            regs.find(r => r.id === opt.region) ? ui.button({ label: 'Make a territory', icon: '⬠', small: true, title: 'Turn the painted area into a territory shape you can link to a nation', onClick: toTerritory }) : null,
            regs.find(r => r.id === opt.region) ? ui.button({ label: 'Rename', small: true, kind: 'ghost', onClick: renameRegion }) : null,
            regs.find(r => r.id === opt.region) ? ui.button({ icon: '🗑', small: true, kind: 'ghost', title: 'Delete this region and its paint', onClick: deleteRegion }) : null])));
        }
        if (id === 'deposit') {
          rows.push(h('div.gk-row', F.RES.map((r, i) => h('button.wb-at-resbtn', { type: 'button', class: opt.deposit === i ? 'on' : '', title: r[1], style: { '--c': r[2] }, onclick: () => { opt.deposit = i; saveOpt(); ctx.paintOptions(); } }, [h('span.wb-at-ressw'), h('span', { text: r[1] })]))));
          rows.push(h('div.wb-at-optrow', [slider('Richness', 'richness', 1, 3, 1, v => ['', 'small', 'fair', 'rich'][v])]));
        }
        if (id === 'stamp') {
          rows.push(h('div.gk-row', M.STAMPS.map((s, i) => ui.chip({ label: s[1], on: opt.stamp === i, onClick: () => { opt.stamp = i; saveOpt(); ctx.paintOptions(); } }))));
          rows.push(h('div.wb-at-optrow', [slider('Size', 'stampSize', 8, 120, 1, v => v + ' px'), slider('Turn', 'stampRot', -180, 180, 5, v => v + '°'), ui.field({ label: 'Vary when scattering', inline: true, control: ui.toggle({ value: opt.jitter, onChange: v => { opt.jitter = v; saveOpt(); } }) })]));
        }
        if (id === 'road') {
          rows.push(h('div.gk-row', [ui.segmented({ value: opt.roadMode, options: [['auto', 'Cheapest ground', 'Follows the easiest terrain between stops'], ['straight', 'Straight', 'Straight lines between clicks']], onChange: v => { opt.roadMode = v; saveOpt(); } }),
            ui.button({ label: 'Roads between all settlements', icon: '⟿', small: true, title: 'Join every town and city pin with the cheapest roads', onClick: () => T.autoRoads() })]));
        }
        if (id === 'river' && !M.field) rows.push(h('div.gk-small.gk-muted', { text: 'No terrain on this map: draw the river by hand, Enter to finish. With terrain, a click runs the river downhill.' }));
      }
      bar.hidden = !rows.length;
      for (const r of rows) bar.appendChild(r);
    };
    async function newRegion() {
      const name = await ui.prompt('New region', '', 'e.g. The Barley Coast, Old forest, Iron hills');
      if (!name) return;
      ensurePaint();
      const id = Math.max(0, ...M.paint.regs.map(r => r.id)) + 1;
      if (id > 250) return ui.toast('That is plenty of regions', 'ℹ');
      M.paint.regs.push({ id, name: name.trim(), color: WB.atlasModes.REGION_COLORS[(id - 1) % WB.atlasModes.REGION_COLORS.length] });
      opt.region = id; saveOpt(); mark('paint'); M.touchPaint(); ctx.paintOptions();
    }
    async function renameRegion() {
      const r = activeRegion(); if (!r) return;
      const name = await ui.prompt('Rename region', r.name);
      if (name) { r.name = name.trim(); mark('paint'); M.touchPaint(); ctx.paintOptions(); }
    }
    async function deleteRegion() {
      const r = activeRegion(); if (!r) return;
      if (!await ui.confirm('Delete “' + r.name + '”?', 'The painted area is removed from the map.', 'Delete')) return;
      for (let i = 0; i < M.paint.reg.length; i++) if (M.paint.reg[i] === r.id) M.paint.reg[i] = 0;
      M.paint.regs = M.paint.regs.filter(x => x.id !== r.id); opt.region = 0; mark('paint'); M.touchPaint(); ctx.paintOptions();
    }
    async function toTerritory() {
      const r = activeRegion(); if (!r) return;
      const out = F.regionOutline(M.paint, r.id);
      if (!out) return ui.toast('Paint a larger area first', 'ℹ');
      const pts = Geo().simplify(out, 1.2 / Math.max(.2, view.t.k * .6));
      const it = await ctx.put({ mapId: S.map.id, kind: 'region', label: r.name, points: pts.length >= 3 ? pts : out, style: { color: r.color } });
      ctx.select(it.id); ctx.paintSide(); ctx.paintLegend();
      ui.toast('Territory made from the painted area — link it to a nation in the inspector', '⬠');
    }
    T.has = id => OWNED.has(id);
    return T;
  }
  WB.atlasTools = { create, DEFS };
})(window);
