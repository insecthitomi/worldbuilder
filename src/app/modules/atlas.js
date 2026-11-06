/* Atlas: maps and planets. Pan/zoom maps with pins, territories that move through history, routes with travel
   times, measuring and calibrating, layers and a legend, sub-maps from region to city block, a globe for planets,
   a terrain generator and PNG export. Data: Map entries (data = image, scale, layers…) + atlas.* map items. */
(function () {
  'use strict';
  const { h, ui } = GK;
  const BASE = 'src/app/modules/atlas/';
  const load = () => Promise.all([WB.loadScript('src/main/lib/atlas-geo.js'), WB.loadScript(BASE + 'icons.js'), WB.loadScript(BASE + 'field.js')]).then(() => Promise.all([WB.loadScript(BASE + 'render.js'), WB.loadScript(BASE + 'labels.js')])).then(() => WB.loadScript(BASE + 'view.js'));
  /** the editing layer: view modes, toolbox, Map panel (loaded when a map opens) */
  const loadUI = () => load().then(() => WB.loadScript(BASE + 'modes.js')).then(() => Promise.all([WB.loadScript(BASE + 'tools.js'), WB.loadScript(BASE + 'panel.js')]));
  const loadExtra = name => load().then(() => WB.loadScript(BASE + name + '.js'));
  const Geo = () => window.WBGeo;
  const V = () => WB.atlasView;
  const typeKeyOf = e => { const t = e && WB.types.get(e.typeId); return t ? t.key : ''; };
  const capture = (el, e) => { try { el.setPointerCapture(e.pointerId); } catch { } };
  /** append children, skipping null/false (native append would print "null") */
  const addTo = (el, ...kids) => GK.append(el, kids);

  /* ---------------- shared helpers (also used by the mini map and the palette) ---------------- */
  /** a new Map entry: { title, parentId, data } → entry */
  async function createMap({ title, parentId = null, data = {}, open = true, kind } = {}) {
    const t = WB.type('map');
    if (!t) throw new Error('This world has no Map type.');
    const e = await WB.api('entries.create', { worldId: WB.worldId, typeId: t.id, title: title || 'New map', parentId, data, fields: kind ? { kind } : {} });
    if (open) WB.go('atlas', { mapId: e.id });
    return e;
  }
  /** the dialog behind "New map": from an image, generated terrain, or a blank sheet */
  async function newMapDialog({ parentId = null, title = '' } = {}) {
    let source = 'image', name = title, kind = 'Region', planet = false, size = '1600x1000', media = null;
    const nameIn = ui.input({ value: name, placeholder: 'Name of the map', onInput: v => { name = v; } });
    const imgBox = h('div.wb-at-newimg');
    const paintImg = () => {
      GK.clear(imgBox);
      addTo(imgBox, media ? h('div.gk-row.nowrap', [WB.ui.thumb(media.id, { cls: 'wb-at-newthumb', fit: 'cover' }), h('div.gk-grow', [h('b.gk-ellipsis', { text: media.name }), h('div.gk-small.gk-muted', { text: (media.width || '?') + ' × ' + (media.height || '?') + ' px' })])]) : null,
        ui.button({ label: media ? 'Choose another…' : 'Choose an image…', icon: '▣', onClick: async () => { const m = await WB.ui.pickMedia({ kind: 'image', title: 'Map image' }); if (m) { media = m; if (!name) { name = m.name; nameIn.value = m.name; } if (m.width && m.height && Math.abs(m.width / m.height - 2) < .03) { planet = true; paint(); } paintImg(); } } }));
    };
    const body = h('div.wb-at-newmap');
    const paint = () => {
      GK.clear(body);
      addTo(body, 
        ui.field({ label: 'Name', control: nameIn }),
        ui.field({ label: 'Start from', control: ui.segmented({ value: source, options: [['image', 'An image', 'A map you drew or found'], ['generate', 'Generated terrain', 'Seeded land, sea, rivers and biomes'], ['blank', 'Blank parchment', 'Draw everything with regions, paths and labels']], onChange: v => { source = v; paint(); } }) }),
        source === 'image' ? imgBox : null,
        source === 'blank' ? ui.field({ label: 'Sheet size (px)', control: ui.select({ value: size, options: [['1200x800', '1200 × 800'], ['1600x1000', '1600 × 1000'], ['2400x1600', '2400 × 1600'], ['3200x2000', '3200 × 2000'], ['2048x1024', '2048 × 1024 (planet)']], onChange: v => { size = v; if (v === '2048x1024') { planet = true; paint(); } } }) }) : null,
        source === 'generate' ? h('p.gk-small.gk-muted', { text: 'The terrain generator opens next: pick a mode (planet, continent, islands…), roll until you like it, then create.' }) : null,
        h('div.wb-at-cols2', [
          ui.field({ label: 'Kind', control: ui.select({ value: kind, options: ['World', 'Region', 'City', 'Building', 'Dungeon', 'Battle', 'Star chart'].map(k => [k, k]), onChange: v => { kind = v; } }) }),
          source !== 'generate' ? ui.field({ label: 'Projection', control: ui.segmented({ value: planet ? 'planet' : 'flat', options: [['flat', 'Flat'], ['planet', 'Planet', 'An equirectangular world map (2:1) that wraps onto a globe']], onChange: v => { planet = v === 'planet'; } }) }) : null,
        ]),
      );
    };
    paintImg(); paint();
    const go = await ui.dialog({ title: 'New map', icon: '⌖', body, actions: [{ label: 'Cancel', value: false }, { label: 'Create map', kind: 'primary', value: true }] });
    if (!go) return null;
    if (source === 'generate') return openGenerator({ parentId, title: name });
    const data = { projection: planet ? 'equirectangular' : 'flat' };
    if (source === 'image') {
      if (!media) { ui.toast('Choose an image first — or start from a blank parchment', 'ℹ'); return newMapDialog({ parentId, title: name }); }
      Object.assign(data, { image: media.id, width: media.width || 1600, height: media.height || 1000 });
    } else { const [w, hh] = size.split('x').map(Number); Object.assign(data, { width: w, height: hh }); }
    if (planet) data.planet = { radiusKm: 6371 };
    return createMap({ title: name.trim() || (media && media.name) || 'New map', parentId, data, kind: planet ? 'World' : kind });
  }
  async function openGenerator(opts = {}) {
    await loadExtra('terrain');
    return WB.atlasTerrain.open(Object.assign({ createMap }, opts));
  }

  /* ---------------- the mini map for entry pages (cheap: one canvas, drawn once) ---------------- */
  WB.atlas = {
    load, createMap, newMap: newMapDialog, generate: openGenerator,
    open: (mapId, itemId) => WB.go('atlas', { mapId, itemId }),
    /** small read-only preview centred on the entry's first pin; returns { destroy } */
    mini(container, { entryId, height = '12em' } = {}) {
      let dead = false, off = null;
      const box = h('div.wb-at-mini', { style: { height } });
      container.appendChild(box);
      (async () => {
        const list = await WB.api('atlas.appearances', entryId).catch(() => []);
        const ap = list.find(a => a.via === 'entry') || list[0];
        if (dead) return;
        if (!ap) { box.remove(); return; }
        await load();
        const [mapRes, img] = await Promise.all([WB.api('atlas.map', ap.map.id).catch(() => null), V().loadImage(ap.map.image)]);
        if (dead || !mapRes) return;
        const canvas = h('canvas.wb-at-mini-canvas');
        const cap = h('button.wb-at-mini-cap', { type: 'button', title: 'Open in the Atlas', onclick: () => WB.atlas.open(ap.map.id, ap.item.id) }, [h('span', { text: '⌖ ' }), h('span.gk-ellipsis', { text: ap.map.title }), h('span.gk-faint', { text: ' ↗' })]);
        addTo(box, canvas, cap);
        const view = V().create(canvas, { labels: true, filter: it => !it.entry || WB.visible(it.entry) });
        view.setMap(mapRes.data, img);
        view.setItems(mapRes.items);
        view.opt.selected = ap.item.id;
        const paint = () => { view.measure(); const k = Math.min(view.fitK() * 3.2, Math.max(view.fitK(), .9)); view.centerOn(ap.item.x, ap.item.y, k); view.render(); };
        paint();
        canvas.addEventListener('click', () => WB.atlas.open(ap.map.id, ap.item.id));
        off = GK.bus.on('layout', paint);
      })().catch(e => console.warn(e));
      return { el: box, destroy() { dead = true; off && off(); box.remove(); } };
    },
  };

  /* ---------------- palette commands ---------------- */
  WB.commands.add({ id: 'atlas:open', label: 'Open the Atlas', icon: '⌖', group: 'Atlas', words: 'maps map planet globe', run: () => WB.go('atlas') });
  WB.commands.add({ id: 'atlas:new', label: 'New map…', icon: '⌖', group: 'Atlas', words: 'map image create atlas', when: () => !!WB.worldId && !WB.share, run: () => newMapDialog() });
  WB.commands.add({ id: 'atlas:terrain', label: 'Generate terrain (new map)…', icon: '⛰', group: 'Atlas', words: 'planet continent island archipelago world generator random map', when: () => !!WB.worldId && !WB.share, run: () => openGenerator() });

  /* ---------------- smoke steps (run by boot after the example world exists) ---------------- */
  const smokeErr = m => 'error: ' + m;
  WB.smoke('atlas-open', async () => {
    const maps = await WB.api('atlas.maps', WB.worldId);
    const m = maps.find(x => x.data.image && x.counts.region) || maps[0];
    if (!m) return smokeErr('the example world has no maps');
    await WB.go('atlas', { mapId: m.id });
    await WB.wait(900);
    const st = WB.atlas._state && WB.atlas._state();
    if (!st || !st.view) return smokeErr('the map did not open');
    if (!st.items.length) return smokeErr('no items on ' + m.title);
    const c = document.querySelector('.wb-at-stage canvas');
    if (!c || !c.width) return smokeErr('no canvas');
    return { map: m.title, items: st.items.length, shown: st.view.shown().length };
  });
  WB.smoke('atlas-generate', async () => {
    await loadExtra('terrain');
    const r = WB.atlasTerrain.render({ mode: 'continent', seed: 7, width: 200, height: 125 });
    if (!r || r.width !== 200) return smokeErr('terrain did not render');
    const land = r.stats.land;
    if (!(land > .1 && land < .9)) return smokeErr('odd land share ' + land);
    return { land: Math.round(land * 100) + '%', rivers: r.stats.rivers };
  });
  WB.smoke('atlas-globe', async () => {
    await loadExtra('terrain');
    const r = WB.atlasTerrain.render({ mode: 'planet', seed: 11, width: 256, height: 128 });
    const blob = await new Promise(res => r.canvas.toBlob(res, 'image/png'));
    const media = await WB.api('media.save', WB.worldId, { name: 'Smoke planet.png', mime: 'image/png', bytes: new Uint8Array(await blob.arrayBuffer()) });
    const e = await createMap({ title: 'Smoke planet', data: { image: media.id, width: 256, height: 128, projection: 'equirectangular', planet: { radiusKm: 6371 } }, open: false });
    await WB.go('atlas', { mapId: e.id, mode: 'globe' });
    await WB.wait(1200);
    const st = WB.atlas._state && WB.atlas._state();
    const ok = st && st.mode === 'globe' && document.querySelector('.wb-at-globe canvas');
    await WB.api('entries.purge', e.id).catch(() => null);
    await WB.api('media.purge', media.id).catch(() => null);
    return ok ? 'ok: globe drawn' : smokeErr('the globe did not open');
  });

  /* smoke: view modes, a brush stroke with undo, and the economy view's empty state, on a generated map */
  async function smokeTerrainMap(title) {
    await load();
    const f = window.WBField.generate(window.WBField.norm({ mode: 'island', seed: 3 }), 800, 500);
    const e = await createMap({ title, data: { width: 800, height: 500, unit: 'miles', unitsPerPx: 2, terrain: window.WBField.encode(f), deposits: f.deposits }, open: false });
    await WB.go('atlas', { mapId: e.id });
    await WB.wait(900);
    return e;
  }
  /** leave the map before it is purged, so the screen does not ask for a map that is gone */
  const smokeLeave = async e => { try { await WB.atlas._state().act.showGallery(); } catch { } await WB.api('entries.purge', e.id).catch(() => null); };
  const baseSig = st => { const c = st.view.baseCanvas; if (!c) return -1; const d = c.getContext('2d').getImageData(0, 0, c.width, c.height).data; let s = 0; for (let i = 0; i < d.length; i += 61) s = (s * 31 + d[i] + d[i + 1] * 3) % 1000003; return s; };
  WB.smoke('atlas-view-modes', async () => {
    const e = await smokeTerrainMap('Smoke terrain');
    try {
      const st = WB.atlas._state();
      if (!st || !st.modes || !st.modes.hasField()) return smokeErr('the generated map has no terrain field');
      const sigs = {};
      for (const m of ['political', 'terrain', 'relief', 'climate', 'resources']) { st.panel.set(m); await WB.wait(120); sigs[m] = baseSig(st); }
      st.panel.set('climate', null, 'rain'); sigs.rain = baseSig(st);
      st.panel.set('terrain', 'parchment'); sigs.parchment = baseSig(st);
      const distinct = new Set(Object.values(sigs));
      if (distinct.size < 5) return smokeErr('view modes look the same: ' + JSON.stringify(sigs));
      st.panel.set('travel'); await WB.wait(80);
      const p = [400, 250]; st.modes.setOrigin(p);
      const near = st.modes.daysTo([p[0] + 20, p[1]]), far = st.modes.daysTo([p[0] + 120, p[1]]);
      if (near != null && far != null && !(far > near)) return smokeErr('travel time does not grow with distance');
      return { modes: distinct.size, travel: far != null ? Math.round(far * 10) / 10 + ' days' : 'sea' };
    } finally { await smokeLeave(e); }
  });
  WB.smoke('atlas-brush-undo', async () => {
    const e = await smokeTerrainMap('Smoke brush');
    try {
      const st = WB.atlas._state(), M = st.modes, T = st.tools, f = M.field;
      st.panel.set('terrain');
      st.act.setTool('raise'); T.opt.size = 60; T.opt.strength = 1;
      const sum = a => { let s = 0; for (let i = 0; i < a.length; i++) s += a[i]; return s; };
      const before = sum(f.elev), sig0 = baseSig(st), n0 = st.hist.length;
      await T.down({ altKey: false }, 0, 0, 400, 250);
      for (let k = 1; k <= 5; k++) T.move({}, 0, 0, 400 + k * 20, 250, false);
      T.up({});
      const after = sum(f.elev);
      if (!(after > before + 10)) return smokeErr('the raise brush did not change the terrain');
      if (st.hist.length !== n0 + 1) return smokeErr('the stroke is not one undo step');
      if (baseSig(st) === sig0) return smokeErr('the picture did not follow the edit');
      await st.hist[st.hist.length - 1].undo();
      if (Math.abs(sum(f.elev) - before) > 1e-3) return smokeErr('undo did not restore the terrain');
      T.flush();
      return { raised: Math.round(after - before), undone: true };
    } finally { await smokeLeave(e); }
  });
  WB.smoke('atlas-economy-empty', async () => {
    const e = await smokeTerrainMap('Smoke economy');
    try {
      const st = WB.atlas._state();
      st.panel.set('economy'); await WB.wait(120);
      const card = document.querySelector('.wb-at-empty-eco');
      if (!card || card.hidden || !/Maps & Sim/.test(card.textContent)) return smokeErr('no explanation when there is no simulation');
      st.data.sim = { result: { day: 3, nodes: [{ itemId: 'x', x: 300, y: 200, population: 500, wealth: 2, surplus: {}, shortage: { grain: 4 } }, { itemId: 'y', x: 500, y: 260, population: 900, wealth: 8, surplus: { grain: 9 }, shortage: {} }], flows: [{ fromItemId: 'y', toItemId: 'x', routeItemId: null, resource: 'grain', amount: 5 }], resources: [{ name: 'grain', color: '#d1b447' }] } };
      st.panel.set('economy'); await WB.wait(120);
      if (document.querySelector('.wb-at-empty-eco:not([hidden])')) return smokeErr('the empty state stays when a simulation exists');
      st.view.render();
      return 'ok: empty state, then nodes and flows';
    } finally { await smokeLeave(e); }
  });

  /* ---------------- the screen ---------------- */
  const TOOLS = [
    ['select', 'Select & move', '⬚', 'V', 'Click to select, drag to move, drag corners to reshape. Double-click a pin to open its sub-map.'],
    ['pin', 'Pin', '📍', 'P', 'Click where the pin goes, then pick the entry it stands for.'],
    ['region', 'Territory / area', '⬠', 'R', 'Click corners (or drag to draw freehand). Click the first corner, double-click or press Enter to finish.'],
    ['path', 'Route / path', '〰', 'L', 'Click along the route; double-click or Enter to finish. Routes show travel times.'],
    ['label', 'Label', 'T', 'T', 'Click to place a name: seas, mountains, kingdoms.'],
    ['measure', 'Measure', '📏', 'M', 'Click points to measure distance and travel time. Esc clears.'],
    ['calibrate', 'Set the scale', '⇹', 'K', 'Draw a line over something whose length you know, then type its length.'],
  ];
  const EDIT_TOOLS = new Set(['pin', 'region', 'path', 'label', 'calibrate']);
  const PATH_KINDS = [['route', 'Route'], ['road', 'Road'], ['street', 'Street'], ['track', 'Track'], ['river', 'River'], ['sea', 'Sea lane'], ['wall', 'Wall'], ['border', 'Border line']];
  const SIZES = [[.8, 'S'], [1, 'M'], [1.3, 'L'], [1.7, 'XL']];
  let live = null;   // the mounted screen's state (smoke steps read it)
  WB.atlas._state = () => live;

  async function mount(page, ctx) {
    page.classList.add('wb-atlas-page');
    const subs = [];
    const cleanup = () => { subs.splice(0).forEach(f => { try { f(); } catch (e) { console.warn(e); } }); live = null; };
    if (!WB.worldId) {
      page.appendChild(WB.ui.empty({ icon: '⌖', title: 'No world yet', text: 'Maps belong to a world. Create one — or open the example world to explore its coast and city maps.', actions: [ui.button({ label: 'Create a world', kind: 'primary', onClick: () => WB.newWorld() })] }));
      return cleanup;
    }
    await loadUI();
    const DEFAULTS = { mapId: null, views: {}, side: 'items', sideOpen: true, days: {}, allTimes: {}, timeOpen: {}, legend: true, mode: {}, recent: [], vmode: {}, tools: {}, snap: {}, mapSections: { view: true, layers: true, settings: false }, contents: 'items' };
    const store = await (WB.store ? WB.store(ctx, DEFAULTS) : ctx.store(DEFAULTS));
    const P = store.get();
    const params = WB.params('atlas') || {};
    const S = live = {
      maps: [], map: null, data: null, items: [], img: null, view: null, tool: 'select', sel: null, mode: 'flat', day: null,
      draft: null, measure: null, drag: null, hist: [], fut: [], settingsOpen: false, globe: null, gallery: false,
    };
    const ro = () => WB.share;

    /* ---------- skeleton ---------- */
    const crumbs = h('nav.wb-at-crumbs', { 'aria-label': 'Maps' });
    const findBox = h('div.wb-at-find');
    const modeBox = h('div.wb-at-modebox');
    const headActions = h('div.gk-row.nowrap.wb-at-headacts');
    const head = h('div.wb-at-head', [crumbs, h('span.gk-grow'), findBox, modeBox, headActions]);
    const side = h('section.gk-panel.wb-at-side');
    const canvas = h('canvas.wb-at-canvas', { tabindex: 0, 'aria-label': 'Map' });
    const toolsBar = h('div.wb-at-tools.wb-at-float', { role: 'toolbar', 'aria-label': 'Map tools' });
    const zoomBar = h('div.wb-at-zoom.wb-at-float');
    const scaleBar = h('div.wb-at-scale');
    const coords = h('div.wb-at-coords');
    const hint = h('div.wb-at-hint.wb-at-float');
    const tip = h('div.wb-at-tip');
    const timeBar = h('div.wb-at-time.wb-at-float');
    const legendBox = h('div.wb-at-legend.wb-at-float');
    const measureCard = h('div.wb-at-measure.wb-at-float');
    const optsBar = h('div.wb-at-opts.wb-at-float', { hidden: true });
    const banner = h('div.wb-at-banner.wb-at-float', { hidden: true });
    const stageInner = h('div.wb-at-stage-in', [canvas, toolsBar, h('div.wb-at-top', [banner, optsBar, hint]), zoomBar, h('div.wb-at-bl', [coords, scaleBar]), legendBox, measureCard, timeBar, tip]);
    const stage = ui.panel({ material: 'clear', cls: 'wb-at-stage', body: [stageInner] });
    const insp = h('section.gk-panel.wb-at-insp');
    const body = h('div.wb-at-body', [side, stage, insp]);
    const gallery = h('div.wb-at-gallery');
    addTo(page, head, body, gallery);

    const view = S.view = V().create(canvas, { filter: it => !it.entry || WB.visible(it.entry) });
    view.overlay = drawOverlay;
    view.onDraw = () => { paintScale(); };

    /* ---------- view modes, toolbox, Map panel (modes.js, tools.js, panel.js) ---------- */
    const M = S.modes = WB.atlasModes.create({ S, view, onBase: () => { if (S.globe) S.globe.refresh(); } });
    const T = S.tools = WB.atlasTools.create({
      S, view, canvas, P, store, M, ro,
      put: p => put(p), record: (u, r) => record(u, r), select: id => select(id), reloadItems: () => reloadItems(), upsert: it => upsertLocal(it), strip: it => strip(it),
      undo: () => undo(), redo: () => redo(), setTool: id => setTool(id), paintSide: () => paintSide(), paintLegend: () => paintLegend(), patchData: p => patchData(p),
      paintOptions: () => T.paintOptions(optsBar), refreshChrome: () => { paintTools(); T.paintOptions(optsBar); PN.banner(); },
      store: store,
    });
    const PN = S.panel = WB.atlasPanel.create({
      S, view, P, store, M, ro, tools: T, record: (u, r) => record(u, r), bannerEl: banner, setTool: id => setTool(id), openGenerator: o => openGenerator(o), refreshAll: () => refreshAll(),
      paintHead: () => paintHead(), paintOptions: () => T.paintOptions(optsBar), paintLegend: () => paintLegend(), paintMapPanel: () => paintSide(),
      layersInto: box => paintLayersTab(box, true), settingsInto: box => paintSettings(box),
    });
    window.addEventListener('beforeunload', T.flush);
    subs.push(() => { T.flush(); window.removeEventListener('beforeunload', T.flush); });
    /** save map data that is not an item (terrain, painted regions, stamps, deposits) without repainting the screen */
    async function patchData(patch) {
      if (!S.map) return;
      Object.assign(S.data, patch);
      S.quietUntil = Date.now() + 1800;
      await WB.api('entries.update', S.map.id, { dataPatch: patch });
    }

    /* ---------- loading ---------- */
    async function loadMaps() {
      S.maps = (await WB.api('atlas.maps', WB.worldId)).filter(m => WB.visible(m));
      return S.maps;
    }
    async function openMap(id, { itemId, keepView, mode } = {}) {
      const m = S.maps.find(x => x.id === id);
      if (!m) return showGallery();
      await T.flush();   // unsaved terrain strokes reach the map entry before it is read again
      const res = await WB.api('atlas.map', id);
      const sameMap = S.map && S.map.id === id;
      S.map = res.entry; S.data = res.data; S.items = res.items; S.gallery = false;
      if (!sameMap) { S.sel = null; S.draft = null; S.measure = null; S.hist = []; S.fut = []; }
      S.mode = (mode || (P.mode || {})[id]) === 'globe' && Geo().isPlanet(S.data) ? 'globe' : 'flat';
      if (S.mode === 'flat' && S.globe) hideGlobe();
      S.day = (P.days || {})[id] != null ? P.days[id] : WB.now.day;
      view.opt.day = S.day; view.opt.allTimes = !!(P.allTimes || {})[id]; view.opt.selected = S.sel;
      const img = await V().loadImage(S.data.image);
      if (S.data.image && !img) ui.toast('The map image could not be loaded', '⚠');
      S.img = img;
      view.setMap(S.data, img);
      view.setItems(S.items);
      if (!sameMap) { T.clearMulti(); T.draft = null; }
      M.load(S.data); view.baseCanvas = null; PN.restore();
      store.patch({ mapId: id, recent: [id].concat((P.recent || []).filter(x => x !== id)).slice(0, 8) });
      body.hidden = false; gallery.hidden = true;
      paintAll();
      view.measure();
      const saved = (P.views || {})[id];
      if (keepView && sameMap) view.draw();
      else if (saved && saved.k) { view.t = Object.assign({}, saved); view.clamp(); view.draw(); }
      else view.fit();
      if (itemId) { const it = S.items.find(i => i.id === itemId); if (it) { select(it.id); focusItem(it); } }
      if (S.mode === 'globe') showGlobe();
    }
    const saveView = WB.debounce(() => { if (!S.map) return; const v = Object.assign({}, P.views || {}); v[S.map.id] = { x: Math.round(view.t.x), y: Math.round(view.t.y), k: view.t.k }; P.views = v; store.patch({ views: v }); }, 400);
    async function reloadItems() {
      if (!S.map) return;
      const items = await WB.api('atlas.items', S.map.id).catch(() => null);
      if (!items || !S.map) return;
      const before = S.sel && S.items.find(i => i.id === S.sel);
      S.items = items;
      view.setItems(items);
      if (S.sel && !items.find(i => i.id === S.sel)) select(null);
      else if (before) { const now = items.find(i => i.id === S.sel); if (now && now.updatedAt !== before.updatedAt && !S.savingIds.has(S.sel)) paintInspector(); }
      paintSide(); paintLegend(); paintTime(); view.draw();
      if (S.globe) S.globe.refresh();
    }
    S.savingIds = new Set();

    /* ---------- saving with undo ---------- */
    const strip = it => { const o = Object.assign({}, it); delete o.entry; delete o.subMap; return o; };
    function record(undo, redo) { S.hist.push({ undo, redo }); if (S.hist.length > 80) S.hist.shift(); S.fut = []; }
    async function put(patch, { undoable = true } = {}) {
      const before = patch.id ? S.items.find(i => i.id === patch.id) : null;
      S.savingIds.add(patch.id);
      try {
        const it = await WB.api('atlas.save', patch);
        upsertLocal(it);
        if (undoable) {
          if (before) { const b = strip(before), a = strip(it); record(() => WB.api('atlas.save', b), () => WB.api('atlas.save', a)); }
          else { const a = strip(it); record(() => WB.api('atlas.remove', a.id), () => WB.api('atlas.save', a)); }
        }
        return it;
      } finally { setTimeout(() => S.savingIds.delete(patch.id), 600); }
    }
    function upsertLocal(it) {
      const i = S.items.findIndex(x => x.id === it.id);
      if (i >= 0) S.items[i] = it; else S.items.push(it);
      view.setItems(S.items);
      view.draw();
      if (S.items.length === 1 && S.tool === 'select') paintTools();
    }
    const removing = new Set();
    async function removeItem(id) {
      const it = S.items.find(i => i.id === id);
      if (!it || removing.has(id)) return;
      removing.add(id);
      let gone;
      try { gone = await WB.api('atlas.remove', id); } finally { removing.delete(id); }
      if (!gone) return reloadItems();
      S.items = S.items.filter(i => i.id !== id);
      view.setItems(S.items);
      if (S.sel === id) select(null);
      view.draw(); paintSide(); paintLegend();
      const b = strip(gone);
      record(() => WB.api('atlas.save', b), () => WB.api('atlas.remove', b.id));
      WB.ui.undoToast('Removed “' + V().titleOf(it) + '” from the map', () => WB.api('atlas.save', b).then(reloadItems));
    }
    async function undo() { const r = S.hist.pop(); if (!r) return ui.toast('Nothing to undo', '↶'); await r.undo(); S.fut.push(r); await reloadItems(); }
    async function redo() { const r = S.fut.pop(); if (!r) return ui.toast('Nothing to redo', '↷'); await r.redo(); S.hist.push(r); await reloadItems(); }

    /* ---------- selection ---------- */
    function select(id) {
      S.sel = id || null;
      view.opt.selected = S.sel;
      view.opt.handles = !!S.sel && !ro();
      paintInspector(); paintSideSel();
      view.draw();
      if (S.globe) S.globe.refresh();
    }
    function focusItem(it) {
      if (!it) return;
      const k = Math.max(view.t.k, view.fitK() * 1.6);
      if (it.kind === 'region' || it.kind === 'path') {
        const b = Geo().bbox(it.points);
        const kk = Math.min(view.limits()[1], Math.min(view.w / (b.w + 80), view.h / (b.h + 80)));
        view.centerOn((b.x0 + b.x1) / 2, (b.y0 + b.y1) / 2, Math.max(view.fitK(), kk));
      } else view.centerOn(it.x, it.y, k);
      saveView();
    }
    const selItem = () => S.items.find(i => i.id === S.sel) || null;

    /* ---------- header ---------- */
    function paintHead() {
      GK.clear(crumbs); GK.clear(modeBox); GK.clear(headActions); GK.clear(findBox);
      const chain = [];
      let m = S.map && S.maps.find(x => x.id === S.map.id), guard = 0;
      while (m && guard++ < 20) { chain.unshift(m); m = m.parentMap && S.maps.find(x => x.id === m.parentMap); }
      if (S.map && !S.gallery) addTo(crumbs, h('button.wb-at-crumb', { type: 'button', title: 'All maps', onclick: () => showGallery() }, [h('span', { text: '⌖' }), h('span', { text: ' Atlas' })]));
      chain.forEach((c, i) => {
        addTo(crumbs, h('span.wb-at-sep', { text: '›' }));
        const last = i === chain.length - 1;
        const b = h('button.wb-at-crumb', { type: 'button', class: last ? 'on' : '', title: last ? 'Switch map' : 'Back up to ' + c.title, onclick: ev => (last ? mapMenu(ev.currentTarget) : openMap(c.id)) }, [h('span.gk-ellipsis', { text: c.title }), last ? h('span.gk-faint', { text: ' ▾' }) : null]);
        addTo(crumbs, b);
      });
      if (S.gallery || !S.map) {
        addTo(headActions, ro() ? null : ui.button({ label: 'New map', icon: '＋', kind: 'primary', small: true, onClick: () => newMapDialog() }));
        return;
      }
      // find on this map
      const inp = h('input.gk-input.gk-control.wb-at-findin', { placeholder: 'Find on map…', spellcheck: false, title: 'Find a pin, territory or route on this map (Ctrl+F)' });
      inp.addEventListener('input', () => findPop(inp));
      inp.addEventListener('keydown', e => {
        if (e.key === 'Enter') { const hit = findMatches(inp.value)[0]; if (hit) { select(hit.id); focusItem(hit); inp.blur(); WB.ui.closePopovers('find'); } }
        if (e.key === 'Escape') { inp.value = ''; WB.ui.closePopovers('find'); canvas.focus(); }
      });
      addTo(findBox, h('span.wb-at-findico', { text: '⌕' }), inp);
      if (Geo().isPlanet(S.data)) addTo(modeBox, ui.segmented({ value: S.mode, options: [['flat', 'Flat', 'The whole map as an image'], ['globe', 'Globe', 'The map wrapped on a sphere: drag to spin']], onChange: v => setMode(v) }));
      PN.viewButton(modeBox);
      addTo(headActions, 
        ui.button({ label: 'Map', icon: '⚙', small: true, title: 'The Map panel: view, layers and settings (image, scale, projection, grid, travel speeds)', onClick: () => { P.side = 'map'; store.patch({ side: 'map' }); if (!P.sideOpen) toggleSide(true); else paintSide(); } }),
        ui.button({ label: 'Export', icon: '⤓', small: true, title: 'Save the map as a PNG image in the Library', onClick: e => exportMenu(e.currentTarget) }),
        ui.button({ icon: '⋯', small: true, title: 'More', onClick: e => moreMenu(e.currentTarget) }),
      );
    }
    function mapMenu(at) {
      const items = [{ header: 'Maps' }];
      const depthOf = m => { let d = 0, p = m; while (p && p.parentMap && d < 8) { p = S.maps.find(x => x.id === p.parentMap); d++; } return d; };
      for (const m of orderedMaps()) items.push({ label: ' '.repeat(depthOf(m)) + m.title, icon: Geo().isPlanet(m.data) ? '◍' : '⌖', checked: S.map && m.id === S.map.id, onClick: () => openMap(m.id) });
      if (!ro()) items.push('-', { label: 'New map…', icon: '＋', onClick: () => newMapDialog() }, { label: 'Generate terrain…', icon: '⛰', onClick: () => openGenerator() });
      WB.ui.menu(items, at);
    }
    function orderedMaps() {
      const kids = new Map(), out = [];
      for (const m of S.maps) { const p = m.parentMap || ''; if (!kids.has(p)) kids.set(p, []); kids.get(p).push(m); }
      const walk = (p, d) => { for (const m of kids.get(p) || []) { if (out.includes(m) || d > 8) continue; out.push(m); walk(m.id, d + 1); } };
      walk('', 0);
      for (const m of S.maps) if (!out.includes(m)) out.push(m);
      return out;
    }
    function findMatches(q) {
      q = String(q || '').trim().toLowerCase();
      if (!q) return [];
      return S.items.filter(i => view.visible(i) || view.opt.allTimes || true).filter(i => (!i.entry || WB.visible(i.entry)) && V().titleOf(i).toLowerCase().includes(q))
        .sort((a, b) => (V().titleOf(a).toLowerCase().startsWith(q) ? 0 : 1) - (V().titleOf(b).toLowerCase().startsWith(q) ? 0 : 1)).slice(0, 12);
    }
    async function findPop(inp) {
      const q = inp.value.trim();
      if (!q) return WB.ui.closePopovers('find');
      const hits = findMatches(q);
      const list = h('div.wb-menu');
      for (const it of hits) list.appendChild(h('button.wb-menu-item', { type: 'button', onclick: () => { WB.ui.closePopovers('find'); select(it.id); focusItem(it); } }, [itemIcon(it), h('span.wb-menu-lbl.gk-ellipsis', { text: V().titleOf(it) }), h('span.wb-menu-kbd', { text: kindName(it) + (view.visible(it) ? '' : ' · hidden now') })]));
      // entries not on this map yet
      const others = (await WB.api('search.query', WB.worldId, q, { limit: 6 }).catch(() => [])).filter(e => WB.visible(e) && !S.items.some(i => i.entryId === e.id) && e.id !== (S.map && S.map.id));
      if (inp.value.trim() !== q) return;
      if (others.length && !ro()) {
        list.appendChild(h('div.wb-menu-head', { text: 'Not on this map yet — click to place' }));
        for (const e of others) list.appendChild(h('button.wb-menu-item', { type: 'button', onclick: () => { WB.ui.closePopovers('find'); armPlace(e); } }, [WB.ui.icon(e), h('span.wb-menu-lbl.gk-ellipsis', { text: e.title }), h('span.wb-menu-kbd', { text: (WB.typeOf(e) || {}).name || '' })]));
      }
      if (!list.children.length) list.appendChild(h('div.gk-small.gk-muted.wb-at-pad', { text: 'Nothing called “' + q + '” here.' }));
      WB.ui.popover(inp, list, { group: 'find', cls: 'wb-at-findpop', keepOpen: false });
      inp.focus();
    }
    function exportMenu(at) {
      WB.ui.menu([
        { label: 'This view as PNG', icon: '▣', hint: 'Exactly what you see, at double resolution', onClick: () => exportPNG(false) },
        { label: 'The whole map as PNG', icon: '⌖', hint: 'The full image with every visible item on it', onClick: () => exportPNG(true) },
      ], at);
    }
    function moreMenu(at) {
      const planet = Geo().isPlanet(S.data);
      WB.ui.menu([
        { label: 'Fit the map', icon: '⤢', kbd: 'F', onClick: () => { view.fit(); saveView(); } },
        { label: P.legend !== false ? 'Hide the legend' : 'Show the legend', icon: '☷', onClick: () => { P.legend = P.legend === false; store.patch({ legend: P.legend }); paintLegend(); } },
        { label: (P.timeOpen || {})[S.map.id] ? 'Hide the time bar' : 'Show the time bar', icon: '⏱', onClick: () => { const t = Object.assign({}, P.timeOpen); t[S.map.id] = !t[S.map.id]; P.timeOpen = t; store.patch({ timeOpen: t }); paintTime(); } },
        planet ? { label: view.opt.graticule ? 'Hide latitude & longitude lines' : 'Show latitude & longitude lines', icon: '◍', onClick: () => { view.opt.graticule = !view.opt.graticule; view.draw(); } } : null,
        '-',
        ro() ? null : { label: 'Set the scale…', icon: '⇹', kbd: 'K', onClick: () => setTool('calibrate') },
        ro() ? null : { label: 'Generate terrain for this map…', icon: '⛰', hint: 'Replace the image with generated land and sea', onClick: () => openGenerator({ replaceMapId: S.map.id, title: S.map.title }).then(() => refreshAll()) },
        ro() ? null : { label: S.data.image ? 'Replace the image…' : 'Add an image…', icon: '▣', onClick: () => replaceImage() },
        ro() ? null : { label: 'New sub-map inside this one…', icon: '⤵', onClick: () => newMapDialog({ parentId: S.map.id }) },
        '-',
        { label: 'Open the map entry', icon: '↗', onClick: () => WB.open(S.map.id) },
        { label: 'Keyboard shortcuts', icon: '⌨', onClick: () => shortcuts() },
      ], at);
    }
    function shortcuts() {
      const rows = TOOLS.map(t => [t[3], t[1]]).concat([['F', 'Fit the map'], ['+ / −', 'Zoom'], ['Wheel', 'Zoom at the cursor'], ['Drag / Space+drag', 'Pan'], ['Enter / double-click', 'Finish a territory or route'], ['Backspace', 'Remove the last corner while drawing'], ['Delete', 'Remove the selected item'], ['Ctrl+D', 'Duplicate'], ['Arrows', 'Nudge (Shift = more)'], ['Ctrl+Z / Ctrl+Y', 'Undo / redo'], [', / .', 'Time: a year back / forward'], ['Ctrl+F', 'Find on the map'], ['Right-click', 'Pin here, found a settlement, border history…'],
        ['S', 'Symbols: stamp mountains, forests, towns'], ['1 / 2 / 3', 'Terrain: raise / lower / smooth'], ['4 / 5 / 6', 'Terrain: add water / remove water / smooth coastline'], ['7 / 8', 'Paint a biome / fill a biome'], ['9', 'Paint a region with a brush'], ['I / O', 'River (runs downhill) / road (cheapest ground)'], ['D', 'Place a resource deposit'], ['E', 'Eraser: stamps, deposits, painted regions'], ['[ / ]', 'Brush smaller / bigger'], ['{ / }', 'Brush weaker / stronger (Shift + [ ])'], ['G', 'Snap to the grid on / off'], ['Shift+click / Shift+drag', 'Add to the selection / draw a selection box'], ['Ctrl+A', 'Select everything on the map'], ['Alt', 'Rub out while painting a biome or region; straight stretch for roads']]);
      ui.dialog({ title: 'Atlas shortcuts', icon: '⌨', body: h('div.wb-shortcuts', rows.map(([k, d]) => h('div.wb-kv-row', [WB.ui.kbd(k), h('span', { text: d })]))) });
    }

    /* ---------- the gallery (no map open) ---------- */
    async function showGallery() {
      if (S.globe) { S.globe.destroy(); S.globe = null; }
      S.gallery = true; S.map = null; S.sel = null;
      body.hidden = true; gallery.hidden = false;
      store.patch({ mapId: null });
      paintHead();
      GK.clear(gallery);
      if (!S.maps.length) {
        addTo(gallery, WB.ui.empty({ icon: '⌖', title: 'No maps yet', text: 'A map can be an image you drew, generated terrain, or a blank parchment. Pin places on it, draw territories that change through history, plan routes with travel times — from a whole planet down to a city block.',
          actions: ro() ? [] : [ui.button({ label: 'New map from an image…', icon: '▣', kind: 'primary', onClick: () => newMapDialog() }), ui.button({ label: 'Generate terrain…', icon: '⛰', onClick: () => openGenerator() }), ui.button({ label: 'Blank parchment', icon: '◻', onClick: () => createMap({ title: 'New map', data: { width: 1600, height: 1000 } }) })] }));
        return;
      }
      const grid = h('div.wb-at-cards');
      for (const m of orderedMaps()) {
        const parent = m.parentMap && S.maps.find(x => x.id === m.parentMap);
        const n = m.counts.pin + m.counts.region + m.counts.path + m.counts.label;
        const card = h('button.gk-widget.wb-at-card', { type: 'button', title: 'Open ' + m.title, onclick: () => openMap(m.id) }, [
          h('div.wb-at-card-img', [m.data.image ? WB.ui.thumb(m.data.image, { fit: 'cover' }) : h('div.wb-at-card-blank', { text: '⌖' }), Geo().isPlanet(m.data) ? h('span.wb-at-card-badge', { text: '◍ Planet' }) : null]),
          h('div.wb-at-card-body', [h('b.gk-ellipsis', { text: m.title }), h('div.gk-small.gk-muted.gk-ellipsis', { text: [parent ? 'in ' + parent.title : null, n ? WB.fmt.plural(n, 'item') : 'empty'].filter(Boolean).join(' · ') })]),
        ]);
        card.addEventListener('contextmenu', ev => { ev.preventDefault(); WB.ui.entryMenu(m, ev); });
        grid.appendChild(card);
      }
      if (!ro()) grid.appendChild(h('button.gk-widget.wb-at-card.wb-at-card-new', { type: 'button', onclick: () => newMapDialog() }, [h('div.wb-at-card-img', [h('div.wb-at-card-blank', { text: '＋' })]), h('div.wb-at-card-body', [h('b', { text: 'New map' }), h('div.gk-small.gk-muted', { text: 'Image, generated terrain or blank' })])]));
      addTo(gallery, h('div.wb-at-gal-head', [h('h2', { text: 'Atlas' }), h('p.gk-muted', { text: 'Maps and planets of ' + WB.world.name + '. Open one to pin places, draw borders through history and plan journeys.' })]), grid);
    }

    /* ---------- side panel ---------- */
    function paintSide() {
      // keep the list where it was and the filter focused across repaints
      const oldBody = side.querySelector('.wb-at-sidebody'), scrollTop = oldBody ? oldBody.scrollTop : 0;
      const typing = document.activeElement && side.contains(document.activeElement) && document.activeElement.matches('input') ? document.activeElement.selectionStart : null;
      GK.clear(side);
      if (!S.map) return;
      requestAnimationFrame(() => {
        const b = side.querySelector('.wb-at-sidebody'); if (b) b.scrollTop = scrollTop;
        if (typing != null) { const i = side.querySelector('.wb-search-input'); if (i) { i.focus(); try { i.setSelectionRange(typing, typing); } catch { } } }
      });
      side.classList.toggle('closed', !P.sideOpen);
      if (P.side === 'entries') { P.side = 'items'; P.contents = 'entries'; } else if (P.side === 'layers') P.side = 'map';
      const tabs = [['items', 'On this map'], ['map', 'Map']];
      const tab = tabs.find(t => t[0] === P.side) ? P.side : 'items';
      addTo(side, h('div.wb-at-sidehead', [ui.tabs({ tabs, value: tab, onChange: v => { P.side = v; store.patch({ side: v }); paintSide(); } }),
        ui.button({ icon: '⇤', small: true, kind: 'ghost', title: 'Hide the side panel', onClick: () => toggleSide(false) })]));
      const content = h('div.wb-at-sidebody');
      addTo(side, content);
      if (tab === 'items') {
        const sub = ro() ? 'items' : (P.contents || 'items');
        if (!ro()) addTo(content, ui.segmented({ value: sub, options: [['items', 'On this map'], ['entries', 'Add from the Codex', 'Drag entries onto the map, or click one and then the map']], onChange: v => { P.contents = v; store.patch({ contents: v }); paintSide(); } }));
        if (sub === 'entries') paintEntriesTab(content); else paintItemsTab(content);
      } else PN.paintMapPanel(content);
    }
    function toggleSide(on) { P.sideOpen = on; store.patch({ sideOpen: on }); body.classList.toggle('side-closed', !on); paintSide(); requestAnimationFrame(() => { view.measure(); view.draw(); }); }
    const kindName = it => ({ pin: 'Pin', region: 'Territory', path: 'Route', label: 'Label' })[it.kind];
    function itemIcon(it) {
      const c = V().colorOf(it);
      if (it.kind === 'pin') return h('span.wb-at-ico', { style: { '--c': c } }, [WB.atlasIcons.svg(V().iconOf(it), { size: '1em', color: '#fff' })]);
      if (it.kind === 'region') return h('span.wb-at-ico.region', { style: { '--c': c } });
      if (it.kind === 'path') return h('span.wb-at-ico.path', { style: { '--c': c }, text: '〰' });
      return h('span.wb-at-ico.label', { style: { '--c': c }, text: 'T' });
    }
    let itemsFilter = '';
    function paintItemsTab(box) {
      const list = h('div.wb-at-list', { role: 'list' });
      const paint = () => {
        GK.clear(list);
        const q = itemsFilter.toLowerCase();
        const groups = [['pin', 'Pins'], ['region', 'Territories'], ['path', 'Routes'], ['label', 'Labels']];
        let any = false;
        for (const [k, name] of groups) {
          const its = S.items.filter(i => i.kind === k && (!i.entry || WB.visible(i.entry)) && !(i.entry && i.entry.deletedAt) && (!q || V().titleOf(i).toLowerCase().includes(q)))
            .sort((a, b) => V().titleOf(a).localeCompare(V().titleOf(b)));
          if (!its.length) continue;
          any = true;
          list.appendChild(h('div.wb-at-group', { text: name + ' · ' + its.length }));
          for (const it of its) {
            const d = V().datesOf(it), shown = view.visible(it);
            const row = h('div.wb-at-row', { tabindex: 0, role: 'listitem', class: (S.sel === it.id ? 'on ' : '') + (shown ? '' : 'off'), dataset: { id: it.id }, title: shown ? '' : 'Hidden now (by its dates or its layer)' }, [
              itemIcon(it),
              h('div.wb-at-row-main', [h('div.gk-ellipsis.wb-at-row-title', { text: V().titleOf(it) }), h('div.gk-ellipsis.wb-at-row-sub', { text: [it.entry ? (WB.typeOf(it.entry) || {}).name : 'no entry', d.start || d.end ? WB.fmt.range(d.start, d.end) : '', it.subMap ? 'opens ' + it.subMap.title : ''].filter(Boolean).join(' · ') })]),
            ]);
            row.addEventListener('click', () => { select(it.id); if (shown) focusItem(it); });
            row.addEventListener('dblclick', () => { if (it.entryId) WB.peek(it.entryId); });
            row.addEventListener('keydown', e => { if (e.key === 'Enter') row.click(); if (e.key === 'Delete' && !ro()) { e.stopPropagation(); removeItem(it.id); } });
            row.addEventListener('contextmenu', ev => { ev.preventDefault(); itemMenu(it, ev); });
            if (it.entryId) WB.dnd.entry(row, it.entryId);
            list.appendChild(row);
          }
        }
        if (!any) list.appendChild(WB.ui.empty({ icon: '📍', title: q ? 'Nothing matches' : 'Nothing on this map yet', text: q ? '' : ro() ? 'This map has no places you may see yet.' : 'Pick the pin tool (P) and click the map, or use Add from the Codex to drag entries onto it.' }));
      };
      addTo(box, WB.ui.search({ placeholder: 'Filter this map', value: itemsFilter, onInput: v => { itemsFilter = v; paint(); } }), list);
      WB.ui.listKeys(list, { rows: '.wb-at-row' });
      paint();
    }
    function paintSideSel() { side.querySelectorAll('.wb-at-row').forEach(r => r.classList.toggle('on', r.dataset.id === S.sel)); const on = side.querySelector('.wb-at-row.on'); if (on) on.scrollIntoView({ block: 'nearest' }); }
    let entriesQ = '', entriesType = '';
    function paintEntriesTab(box) {
      const list = h('div.wb-at-list');
      const pinnable = WB.typeList().filter(t => t.pinnable && t.key !== 'map');
      const run = WB.debounce(async () => {
        const typeIds = entriesType ? [entriesType] : pinnable.map(t => t.id);
        const res = (await WB.api('search.query', WB.worldId, entriesQ, { typeIds, limit: 80 }).catch(() => [])).filter(e => WB.visible(e));
        GK.clear(list);
        const on = new Set(S.items.map(i => i.entryId).filter(Boolean));
        const rows = res.filter(e => e.id !== S.map.id).sort((a, b) => (on.has(a.id) ? 1 : 0) - (on.has(b.id) ? 1 : 0));
        for (const e of rows) {
          const placed = on.has(e.id);
          list.appendChild(WB.ui.row(e, {
            sub: [(WB.typeOf(e) || {}).name, placed ? 'on this map' : 'drag onto the map'].join(' · '),
            onClick: () => { if (placed) { const it = S.items.find(i => i.entryId === e.id); select(it.id); focusItem(it); } else armPlace(e); },
            trailing: placed ? h('span.wb-at-placed', { text: '✓', title: 'Already on this map' }) : ui.button({ icon: '📍', small: true, kind: 'ghost', title: 'Place it: then click the map', onClick: ev => { ev.stopPropagation(); armPlace(e); } }),
          }));
        }
        if (!rows.length) list.appendChild(h('div.gk-small.gk-muted.wb-at-pad', { text: entriesQ ? 'Nothing matches “' + entriesQ + '”.' : 'No entries of these types yet.' }));
      }, 120);
      const chips = h('div.wb-chips.wb-at-typechips', [ui.chip({ label: 'All', on: !entriesType, onClick: () => { entriesType = ''; paintSide(); } })].concat(pinnable.map(t => ui.chip({ label: t.icon + ' ' + t.plural, on: entriesType === t.id, onClick: () => { entriesType = entriesType === t.id ? '' : t.id; paintSide(); } }))));
      addTo(box, h('p.gk-small.gk-muted.wb-at-tabhint', { text: 'Drag an entry onto the map to pin it there, or click it and then click the map.' }), WB.ui.search({ placeholder: 'Search entries', value: entriesQ, onInput: v => { entriesQ = v; run(); } }), chips, list);
      run();
    }
    function paintLayersTab(box) {
      const D = S.data;
      const counts = id => S.items.filter(i => (i.layer || '') === id).length;
      const list = h('div.wb-at-layers');
      for (const L of D.layers) {
        const row = h('div.wb-at-layer', [
          ui.toggle({ value: L.visible, title: L.visible ? 'Hide this layer' : 'Show this layer', onChange: v => setLayers(D.layers.map(x => (x.id === L.id ? Object.assign({}, x, { visible: v }) : x))) }),
          h('span.gk-grow.gk-ellipsis', { text: L.name, title: ro() ? '' : 'Double-click to rename' }),
          h('span.gk-small.gk-faint', { text: String(counts(L.id)) }),
          ro() ? null : ui.button({ icon: '⋯', small: true, kind: 'ghost', title: 'Layer options', onClick: e => WB.ui.menu([
            { label: 'Rename…', icon: '✎', onClick: async () => { const n = await ui.prompt('Rename layer', L.name); if (n) setLayers(D.layers.map(x => (x.id === L.id ? Object.assign({}, x, { name: n }) : x))); } },
            { label: 'Show only this layer', icon: '◉', onClick: () => setLayers(D.layers.map(x => Object.assign({}, x, { visible: x.id === L.id }))) },
            { label: 'Delete layer', icon: '🗑', danger: true, disabled: D.layers.length < 2, hint: 'Its items move to the first layer', onClick: async () => {
              const rest = D.layers.filter(x => x.id !== L.id), moved = S.items.filter(i => i.layer === L.id);
              if (moved.length) await WB.api('atlas.bulk', { save: moved.map(i => ({ id: i.id, layer: rest[0].id })) });
              await setLayers(rest); reloadItems();
            } },
          ], e.currentTarget) }),
        ]);
        row.querySelector('span.gk-grow').addEventListener('dblclick', async () => { if (ro()) return; const n = await ui.prompt('Rename layer', L.name); if (n) setLayers(D.layers.map(x => (x.id === L.id ? Object.assign({}, x, { name: n }) : x))); });
        list.appendChild(row);
      }
      addTo(box, WB.ui.sectionHead('Layers', ro() ? null : ui.button({ label: 'Add', icon: '＋', small: true, kind: 'ghost', onClick: async () => { const n = await ui.prompt('New layer', '', 'e.g. Trade routes, Secret places'); if (n) setLayers(D.layers.concat([{ id: 'l' + Date.now().toString(36), name: n, visible: true }])); } })), list);
      // grid
      if (!ro()) {
        const G = D.grid, perPx = Geo().unitsPerPx(D);
        addTo(box, WB.ui.sectionHead('Grid'), h('div.wb-at-gridctl', [
          ui.segmented({ value: G.type, options: [['none', 'None'], ['hex', 'Hex'], ['square', 'Square']], onChange: v => setData({ grid: Object.assign({}, G, { type: v }) }) }),
          G.type !== 'none' ? ui.slider({ min: 8, max: 400, step: 2, value: G.size, format: v => v + ' px' + (perPx ? ' ≈ ' + Geo().fmtNum(v * perPx) + ' ' + Geo().UNITS[D.unit].short : ''), onInput: WB.debounce(v => setData({ grid: Object.assign({}, S.data.grid, { size: v }) }), 160) }) : null,
          G.type !== 'none' ? ui.slider({ min: .1, max: 1, step: .05, value: G.opacity, format: v => Math.round(v * 100) + '%', onInput: WB.debounce(v => setData({ grid: Object.assign({}, S.data.grid, { opacity: v }) }), 160) }) : null,
          G.type !== 'none' ? ui.field({ label: 'Snap to the grid (G)', hint: 'Pins, labels, corners and stamps land on grid points', inline: true, control: ui.toggle({ value: T.snapOn(), onChange: v => T.setSnap(v) }) }) : null,
        ]));
      }
      // territory sizes at the current date
      const areaBox = h('div.wb-at-areas');
      addTo(box, WB.ui.sectionHead('Territory', null, view.opt.allTimes ? 'All times' : 'As of ' + WB.fmt.date({ day: S.day, prec: 'year' })), areaBox);
      WB.api('atlas.areas', S.map.id, view.opt.allTimes ? null : S.day).then(a => {
        if (!a.byEntity.length) { areaBox.appendChild(h('div.gk-small.gk-muted', { text: 'Draw territories with the area tool (R) and link them to a faction or place to see their size here.' })); return; }
        for (const g of a.byEntity.filter(x => !x.entryId || WB.visible(WB.liteOf(x.entryId) || { audience: 'shared' }))) {
          const it = S.items.find(i => i.kind === 'region' && (g.entryId ? i.entryId === g.entryId : V().titleOf(i) === g.label));
          const c = it ? V().colorOf(it) : '#888';
          areaBox.appendChild(h('div.wb-at-area', [h('span.wb-at-swatch', { style: { '--c': c } }), h('span.gk-grow.gk-ellipsis', { text: g.entryId ? WB.titleOf(g.entryId) || g.label : g.label, title: g.regions > 1 ? g.regions + ' territories' : '' }),
            h('span.gk-small', { text: a.scaled ? Geo().fmtArea(g.area, a.unit) : Geo().fmtNum(g.area) + ' px²' }), h('span.gk-small.gk-faint.wb-at-share', { text: Math.round(g.share * 100) + '%' })]));
        }
        if (!a.scaled) areaBox.appendChild(h('div.gk-tiny.gk-faint', { text: 'In image pixels: set the scale (K) for real areas.' }));
        else if (a.planet) areaBox.appendChild(h('div.gk-tiny.gk-faint', { text: 'Measured on the sphere.' }));
      }).catch(() => {});
    }
    async function setLayers(layers) { await setData({ layers }); }
    async function setData(patch) {
      if (!S.map) return;
      Object.assign(S.data, patch);
      view.setMap(S.data, S.img); view.draw();
      paintSide(); paintLegend();
      await WB.api('entries.update', S.map.id, { dataPatch: patch });
      const m = S.maps.find(x => x.id === S.map.id); if (m) Object.assign(m.data, patch);
    }

    /* ---------- stage chrome ---------- */
    function paintTools() {
      const first = TOOLS.filter(t => !(ro() && EDIT_TOOLS.has(t[0])) && ['select', 'pin', 'label', 'region', 'path', 'measure', 'calibrate'].includes(t[0]));
      T.paintRail(toolsBar, { first, last: [['side', (P.sideOpen ? 'Hide' : 'Show') + ' the side panel', P.sideOpen ? '⇤' : '⇥', '', () => toggleSide(!P.sideOpen)]] });
      GK.clear(zoomBar);
      addTo(zoomBar, 
        h('button.wb-at-tool', { type: 'button', title: 'Zoom in (+)', onclick: () => { zoomBy(1.4); } }, [h('span', { text: '＋' })]),
        h('button.wb-at-tool', { type: 'button', title: 'Zoom out (−)', onclick: () => { zoomBy(1 / 1.4); } }, [h('span', { text: '－' })]),
        h('button.wb-at-tool', { type: 'button', title: 'Fit the map (F)', onclick: () => { if (S.globe) S.globe.reset(); else { view.fit(); saveView(); } } }, [h('span', { text: '⤢' })]),
      );
      const t = TOOLS.find(x => x[0] === S.tool) || TOOLS[0];
      hint.textContent = T.has(S.tool) ? T.hint(S.tool) : S.tool !== 'select' ? t[4] : S.items.length || ro() ? '' : 'An empty map: P pins a place, R draws a territory, L a route, T a name — or drag entries here from Add from the Codex.';
      hint.hidden = !hint.textContent || (T.has(S.tool) && !ro());
    }
    function zoomBy(f) { if (S.globe) return S.globe.zoom(f); view.zoomAt(view.w / 2, view.h / 2, f); saveView(); }
    function setTool(id) {
      if (ro() && (EDIT_TOOLS.has(id) || T.has(id))) return;
      if (S.mode === 'globe' && id !== 'select') setMode('flat');
      if (T.draft) T.draft = null;
      S.tool = id; S.draft = null; S.place = id === 'pin' ? S.place : null;
      if (id !== 'measure') { S.measure = null; paintMeasure(); }
      canvas.dataset.tool = id;
      canvas.style.cursor = T.has(id) ? 'crosshair' : '';
      paintTools(); T.paintOptions(optsBar); view.draw();
      canvas.focus();
    }
    function armPlace(e) { S.place = e; setTool('pin'); S.place = e; hint.textContent = 'Click the map to place “' + e.title + '”. Esc cancels.'; hint.hidden = false; }
    function paintScale() {
      if (!S.data) return;
      const D = S.data, k = view.t.k;
      let lat = 0;
      if (Geo().isPlanet(D)) { const [, my] = view.toMap(view.w / 2, view.h / 2); lat = Math.max(-85, Math.min(85, Geo().lonLat(0, my, D.width, D.height)[1])); }
      const per = Geo().unitsPerPx(D, lat);
      if (!per) { scaleBar.replaceChildren(h('button.wb-at-scale-set', { type: 'button', title: 'Set the scale to measure real distances', onclick: () => setTool('calibrate'), hidden: ro() }, ['⇹ Set the scale'])); return; }
      const target = 110 * view.ui, units = Geo().niceFloor(target / k * per), px = units / per * k;
      const z = GK.zoomOf(scaleBar);
      scaleBar.replaceChildren(h('div.wb-at-scale-bar', { style: { width: (px / z) + 'px' } }), h('span', { text: Geo().fmtNum(units) + ' ' + Geo().UNITS[D.unit].short + (Geo().isPlanet(D) && Math.abs(lat) > 5 ? ' at ' + Math.round(Math.abs(lat)) + '°' + (lat > 0 ? 'N' : 'S') : '') }));
    }
    function paintCoords(mx, my) {
      if (!S.data || mx == null) { coords.textContent = ''; return; }
      const D = S.data;
      if (mx < 0 || my < 0 || mx > D.width || my > D.height) { coords.textContent = ''; return; }
      if (Geo().isPlanet(D)) { const [lon, lat] = Geo().lonLat(mx, my, D.width, D.height); coords.textContent = Math.abs(lat).toFixed(2) + '°' + (lat >= 0 ? 'N' : 'S') + '  ' + Math.abs(lon).toFixed(2) + '°' + (lon >= 0 ? 'E' : 'W'); }
      else coords.textContent = 'x ' + Math.round(mx) + '  y ' + Math.round(my);
      const extra = M.mode === 'travel' && M.travel.origin ? (() => { const d = M.daysTo([mx, my]); return d == null ? '' : '  ·  ' + Geo().fmtDuration(d, 8) + ' from the start'; })() : M.field ? '  ·  ' + M.describe(mx, my) : '';
      coords.textContent += extra;
    }

    /* ---------- legend ---------- */
    function paintLegend() {
      GK.clear(legendBox);
      legendBox.hidden = P.legend === false || !S.map || S.mode === 'globe' || M.mode === 'economy';
      if (legendBox.hidden) return;
      const shown = view.shown();
      const rows = [];
      const icons = new Map(), iconColor = new Map();
      for (const it of shown) if (it.kind === 'pin') { const ic = V().iconOf(it); icons.set(ic, (icons.get(ic) || 0) + 1); if (!iconColor.has(ic)) iconColor.set(ic, V().colorOf(it)); }
      for (const [ic, n] of [...icons].sort((a, b) => b[1] - a[1]).slice(0, 12)) rows.push(h('div.wb-at-leg', { title: n + ' on the map' }, [h('span.wb-at-ico.leg', { style: { '--c': iconColor.get(ic) || '#7a8794' } }, [WB.atlasIcons.svg(ic, { size: '.9em', color: '#fff' })]), h('span.gk-ellipsis', { text: WB.atlasIcons.label(ic) })]));
      const nations = new Map();
      for (const it of shown) if (it.kind === 'region') { const k = it.entryId || V().titleOf(it); if (!nations.has(k)) nations.set(k, it); }
      for (const it of [...nations.values()].slice(0, 8)) rows.push(h('div.wb-at-leg.wide', [h('span.wb-at-swatch', { style: { '--c': V().colorOf(it) } }), h('span.gk-ellipsis', { text: V().titleOf(it) })]));
      const kinds = new Map();
      for (const it of shown) if (it.kind === 'path') { const k = it.style.kind || 'route'; if (!kinds.has(k)) kinds.set(k, it); }
      for (const [k, it] of kinds) rows.push(h('div.wb-at-leg', [h('span.wb-at-line', { class: k, style: { '--c': it.style.color || V().colorOf(it) } }), h('span.gk-ellipsis', { text: (PATH_KINDS.find(x => x[0] === k) || [k, k])[1] })]));
      if (!rows.length) { legendBox.hidden = true; return; }
      // folds itself on a narrow stage unless the user opened it on purpose
      const narrow = stageInner.clientWidth < 52 * (parseFloat(getComputedStyle(stageInner).fontSize) || 14);
      const folded = P.legend === 'folded' || (P.legend !== 'open' && narrow);
      legendBox.classList.toggle('folded', folded);
      addTo(legendBox, h('button.wb-at-leghead', { type: 'button', title: folded ? 'Show the legend' : 'Fold the legend', 'aria-expanded': String(!folded), onclick: () => { P.legend = folded ? 'open' : 'folded'; store.patch({ legend: P.legend }); paintLegend(); } }, [h('b', { text: '☷ Legend' }), h('span.gk-faint', { text: folded ? ' ▴' : ' ▾' })]),
        folded ? null : h('div.wb-at-legrows', rows));
    }

    /* ---------- time ---------- */
    function datedBounds() {
      const days = [];
      for (const it of S.items) { const d = V().datesOf(it); if (d.start) days.push(d.start.day); if (d.end) days.push(d.end.day); }
      return days;
    }
    let playing = null;
    function paintTime() {
      GK.clear(timeBar);
      if (!S.map) { timeBar.hidden = true; return; }
      const days = datedBounds();
      const open = days.length > 0 || (P.timeOpen || {})[S.map.id];
      timeBar.hidden = !open || S.mode === 'globe' && !days.length;
      if (timeBar.hidden) return;
      const C = WB.cal, nowDay = WB.now.day, yl = C.avgYear;
      let lo = Math.min(nowDay, ...days), hi = Math.max(nowDay, ...days);
      const pad = Math.max(yl * 5, (hi - lo) * .04);
      lo = Math.floor(lo - pad); hi = Math.ceil(hi + pad);
      const allTimes = view.opt.allTimes;
      const label = h('button.wb-at-date', { type: 'button', title: 'Pick a date', text: WB.fmt.date({ day: S.day, prec: 'year' }) });
      label.addEventListener('click', () => {
        const box = h('div.wb-at-datepop');
        addTo(box, WB.ui.dateInput({ value: { day: S.day, prec: 'day' }, allowEmpty: false, onChange: d => { if (d) { setDay(d.day); WB.ui.closePopovers('timepick'); } } }));
        WB.ui.popover(label, box, { group: 'timepick' });
        setTimeout(() => { const i = box.querySelector('input'); if (i) { i.focus(); i.select(); } }, 30);
      });
      const range = h('input.gk-range.wb-at-range', { type: 'range', min: lo, max: hi, step: 1, title: 'Drag through history' });
      range.value = S.day;
      const fill = () => range.style.setProperty('--p', ((S.day - lo) / (hi - lo || 1)) * 100 + '%');
      fill();
      range.addEventListener('input', () => { setDay(+range.value, { quiet: true }); label.textContent = WB.fmt.date({ day: S.day, prec: 'year' }); fill(); });
      range.addEventListener('change', () => paintSide());
      // ticks where something changes (a border moves, a place is founded): click to jump
      const marks = h('div.wb-at-marks');
      const uniq = [...new Set(days)].sort((a, b) => a - b);
      for (const d of uniq.slice(0, 120)) {
        const m = h('button.wb-at-mark', { type: 'button', title: WB.fmt.date({ day: d, prec: 'day' }) + ' — something changes', style: { left: ((d - lo) / (hi - lo || 1)) * 100 + '%' } });
        m.addEventListener('click', () => { setDay(d); });
        marks.appendChild(m);
      }
      const nowMark = h('span.wb-at-nowmark', { title: 'World today: ' + WB.fmt.date(WB.now), style: { left: ((nowDay - lo) / (hi - lo || 1)) * 100 + '%' } });
      const play = h('button.wb-at-tool', { type: 'button', title: playing ? 'Pause' : 'Play through history', onclick: () => togglePlay(lo, hi) }, [h('span', { text: playing ? '❚❚' : '▶' })]);
      addTo(timeBar, play, label, h('div.wb-at-track', [marks, range, nowMark]),
        h('button.wb-at-tool', { type: 'button', title: 'Back to world today (' + WB.fmt.date(WB.now) + ')', onclick: () => setDay(WB.now.day) }, [h('span', { text: '⟲' })]),
        h('button.wb-at-chipbtn', { type: 'button', class: allTimes ? 'on' : '', 'aria-pressed': String(allTimes), title: 'Show items from every period at once (out-of-date ones faded)', onclick: () => { const a = Object.assign({}, P.allTimes); a[S.map.id] = !allTimes; P.allTimes = a; store.patch({ allTimes: a }); view.opt.allTimes = !allTimes; view.draw(); paintTime(); paintSide(); paintLegend(); } }, ['All times']));
      timeBar.classList.toggle('dim', allTimes);
    }
    function setDay(day, { quiet } = {}) {
      S.day = Math.round(day);
      view.opt.day = S.day; view.draw();
      const d = Object.assign({}, P.days); d[S.map.id] = S.day; P.days = d; store.patch({ days: d });
      if (S.globe) S.globe.refresh();
      paintLegend();
      if (!quiet) { paintTime(); paintSide(); }
    }
    function togglePlay(lo, hi) {
      if (playing) { cancelAnimationFrame(playing); playing = null; paintTime(); paintSide(); return; }
      if (S.day >= hi - 1) S.day = lo;
      const span = hi - lo, perMs = span / 9000;
      let last = performance.now();
      const step = now => {
        const dt = now - last; last = now;
        const next = S.day + Math.max(1, dt * perMs);
        if (next >= hi) { setDay(hi); playing = null; paintTime(); paintSide(); return; }
        setDay(next, { quiet: true });
        const r = timeBar.querySelector('.wb-at-range'); if (r) { r.value = S.day; r.style.setProperty('--p', ((S.day - lo) / (span || 1)) * 100 + '%'); }
        const l = timeBar.querySelector('.wb-at-date'); if (l) l.textContent = WB.fmt.date({ day: S.day, prec: 'year' });
        playing = requestAnimationFrame(step);
      };
      playing = requestAnimationFrame(step);
      paintTime();
    }
    subs.push(() => { if (playing) cancelAnimationFrame(playing); });

    /* ---------- inspector ---------- */
    let flushInsp = null;
    subs.push(() => { if (flushInsp) flushInsp(); });
    /** a debounce that remembers its pending patch, so switching items never loses typing */
    const later = (fn, ms) => {
      let t = 0, args = null;
      const d = (...a) => { args = a; clearTimeout(t); t = setTimeout(() => { const x = args; args = null; fn(...x); }, ms); };
      d.flush = () => { clearTimeout(t); if (args) { const x = args; args = null; fn(...x); } };
      return d;
    };
    function paintInspector() {
      if (flushInsp) { flushInsp(); flushInsp = null; }
      GK.clear(insp);
      const it = selItem();
      const show = !!S.map && !S.gallery && !!it && !ro();
      insp.hidden = !show;
      body.classList.toggle('has-insp', show);
      requestAnimationFrame(() => { if (view.measure()) view.draw(); });
      if (!show) { if (it && ro()) cardFor(it); return; }
      const scroll = h('div.wb-at-inspscroll');
      addTo(insp, h('div.wb-at-insphead', [itemIcon(it), h('div.gk-grow', [h('h3.gk-ellipsis', { text: V().titleOf(it) }), h('div.gk-small.gk-muted', { text: kindName(it) + (it.entry ? ' · ' + ((WB.typeOf(it.entry) || {}).name || '') : '') })]),
        ui.button({ icon: '✕', small: true, kind: 'ghost', title: 'Close (Esc)', onClick: () => select(null) })]), scroll);
      const save = (patch, { repaint } = {}) => put(Object.assign({ id: it.id }, patch)).then(n => { Object.assign(it, n); if (repaint) paintInspector(); paintSide(); paintLegend(); }).catch(WB.fail);
      const saveLater = later(save, 350);
      flushInsp = saveLater.flush;
      // entry link
      const entryBox = h('div.wb-at-entry');
      if (it.entry && !it.entry.deletedAt) {
        const sum = h('p.gk-small.wb-at-sum');
        WB.api('entries.lite', it.entry.id).then(e => { if (e && e.summary) sum.textContent = e.summary; }).catch(() => {});
        addTo(entryBox, h('div.gk-row.nowrap', [h('div.gk-grow', [WB.ui.chip(it.entry.id)]), ui.button({ label: 'Change', small: true, kind: 'ghost', onClick: () => relink(it) }), ui.button({ icon: '✕', small: true, kind: 'ghost', title: 'Unlink from the entry (keeps the item)', onClick: () => save({ entryId: null, label: it.label || it.entry.title }, { repaint: true }) })]), sum,
          h('div.gk-row', [ui.button({ label: 'Open', icon: '↗', small: true, onClick: () => WB.open(it.entry.id) }), ui.button({ label: 'Peek', icon: '◫', small: true, onClick: () => WB.peek(it.entry.id) }),
            it.subMapId ? ui.button({ label: 'Open sub-map', icon: '⤵', small: true, kind: 'primary', onClick: () => openMap(it.subMapId) }) : null]));
      } else {
        addTo(entryBox, h('p.gk-small.gk-muted', { text: it.entry && it.entry.deletedAt ? 'Its entry is in the trash.' : 'Not linked to an entry yet. Link it so the map, the Codex and the timeline know about each other.' }),
          h('div.gk-row', [ui.button({ label: 'Link to an entry…', icon: '↗', small: true, kind: 'primary', onClick: () => relink(it) }), ui.button({ label: 'Create entry', icon: '＋', small: true, onClick: () => createFor(it) }),
            it.subMapId ? ui.button({ label: 'Open sub-map', icon: '⤵', small: true, onClick: () => openMap(it.subMapId) }) : null]));
      }
      addTo(scroll, entryBox);
      const nameIn = ui.input({ value: it.label, placeholder: it.entry ? it.entry.title : 'Name', onInput: v => { it.label = v; view.draw(); saveLater({ label: v }); } });
      if (it.kind === 'label') {
        const ta = ui.input({ multiline: true, rows: 2, value: it.label, placeholder: 'Text on the map', onInput: v => { it.label = v; view.draw(); saveLater({ label: v }); } });
        addTo(scroll, ui.field({ label: 'Text', control: ta }));
      } else addTo(scroll, ui.field({ label: 'Name on the map', hint: it.entry ? 'Empty = the entry\'s name' : '', control: nameIn }));
      const st = Object.assign({}, it.style);
      const setStyle = (p, opts) => { Object.assign(st, p); for (const k of Object.keys(p)) if (p[k] == null) delete st[k]; it.style = Object.assign({}, st); view.draw(); return save({ style: st }, opts); };
      const colorCtl = (auto) => {
        const box = h('div.gk-row.nowrap');
        const isAuto = !st.color;
        addTo(box, ui.chip({ label: 'Auto', on: isAuto, title: auto, onClick: () => setStyle({ color: null }, { repaint: true }) }), ui.color({ value: st.color || toHex(V().colorOf(it)), onInput: WB.debounce(v => setStyle({ color: v }, { repaint: false }), 120) }));
        return box;
      };
      if (it.kind === 'pin') {
        const grid = h('div.wb-at-icongrid', WB.atlasIcons.list.map(ic => h('button.wb-at-iconbtn', { type: 'button', class: V().iconOf(it) === ic.id ? 'on' : '', title: ic.label, onclick: () => { setStyle({ icon: ic.id }); grid.querySelectorAll('button').forEach(b => b.classList.toggle('on', b.title === ic.label)); } }, [WB.atlasIcons.svg(ic.id, { size: '1.25em' })])));
        addTo(scroll, ui.field({ label: 'Symbol', control: grid }),
          ui.field({ label: 'Size', control: ui.segmented({ value: (SIZES.find(s => s[0] === (st.size || 1)) || SIZES[1])[0], options: SIZES, onChange: v => setStyle({ size: v }) }) }),
          ui.field({ label: 'Colour', control: colorCtl('From the entry\'s type') }),
          ui.field({ label: 'Name shown', inline: true, control: ui.toggle({ value: !st.hideLabel, onChange: v => setStyle({ hideLabel: v ? null : true }) }) }),
          ui.field({ label: 'Opens map', hint: 'Double-clicking the pin opens this map (region → city → building).', control: subMapCtl(it, save) }));
      } else if (it.kind === 'region') {
        const ar = h('div.gk-small.gk-muted');
        const a = Geo().area(S.data, it.points);
        ar.textContent = a == null ? Geo().fmtNum(Geo().polyArea(it.points)) + ' px² — set the scale for real areas' : Geo().fmtArea(a, S.data.unit) + (Geo().isPlanet(S.data) ? ' (on the sphere)' : '');
        addTo(scroll, h('div.wb-at-cols2', [ui.field({ label: 'Colour', control: colorCtl('The nation\'s colours field, else its own colour') }),
          ui.field({ label: 'Fill', control: ui.slider({ min: 0, max: .8, step: .02, value: st.fill == null ? .22 : st.fill, format: v => Math.round(v * 100) + '%', onInput: WB.debounce(v => setStyle({ fill: v }), 120) }) })]),
        h('div.wb-at-cols2', [ui.field({ label: 'Dashed border', inline: true, control: ui.toggle({ value: !!st.dashed, onChange: v => setStyle({ dashed: v || null }) }) }), ui.field({ label: 'Name shown', inline: true, control: ui.toggle({ value: !st.hideLabel, onChange: v => setStyle({ hideLabel: v ? null : true }) }) })]),
        ui.field({ label: 'Area', control: ar }),
        ui.button({ label: 'Who held this spot through time?', icon: '⌛', small: true, kind: 'ghost', onClick: e => historyAt(it.x, it.y, e.currentTarget) }));
      } else if (it.kind === 'path') {
        const info = h('div.wb-at-travel');
        const paintTravel = () => { GK.clear(info); addTo(info, travelTable(it.points, st.mode)); };
        addTo(scroll, h('div.wb-at-cols2', [ui.field({ label: 'Kind', control: ui.select({ value: st.kind || 'route', options: PATH_KINDS, onChange: v => setStyle({ kind: v }) }) }),
          ui.field({ label: 'Travelled by', control: ui.select({ value: st.mode || '', options: [['', 'Any']].concat(travelModes().map(m => [m.mode, m.label])), onChange: v => { setStyle({ mode: v || null }); paintTravel(); } }) })]),
        h('div.wb-at-cols2', [ui.field({ label: 'Colour', control: colorCtl('By kind') }), ui.field({ label: 'Width', control: ui.slider({ min: 1, max: 10, step: .5, value: st.width || 2.5, onInput: WB.debounce(v => setStyle({ width: v }), 120) }) })]),
        ui.field({ label: 'Dashed', inline: true, control: ui.toggle({ value: !!st.dashed, onChange: v => setStyle({ dashed: v || null }) }) }),
        ui.field({ label: 'Length & travel time', control: info }));
        paintTravel();
      } else if (it.kind === 'label') {
        addTo(scroll, h('div.wb-at-cols2', [ui.field({ label: 'Size', control: ui.slider({ min: 4, max: 200, step: 1, value: st.size || 18, format: v => v + ' px', onInput: WB.debounce(v => setStyle({ size: v }), 100) }) }),
          ui.field({ label: 'Angle', control: ui.slider({ min: -90, max: 90, step: 1, value: st.angle || 0, format: v => v + '°', onInput: WB.debounce(v => setStyle({ angle: v || null }), 100) }) })]),
        h('div.wb-at-cols2', [ui.field({ label: 'Italic', inline: true, control: ui.toggle({ value: !!st.italic, onChange: v => setStyle({ italic: v || null }) }) }), ui.field({ label: 'Capitals', inline: true, control: ui.toggle({ value: !!st.caps, onChange: v => setStyle({ caps: v || null }) }) })]),
        ui.field({ label: 'Colour', control: h('div.gk-row.nowrap', [ui.color({ value: st.color || '#2b2116', onInput: WB.debounce(v => setStyle({ color: v }), 120) }),
          ...['#2b2116', '#4a3b24', '#2f5f7a', '#e8f1f2', '#7a1f1f'].map(c => h('button.wb-at-swatchbtn', { type: 'button', style: { '--c': c }, title: c, onclick: () => setStyle({ color: c }, { repaint: true }) }))]) }));
      }
      addTo(scroll, ui.field({ label: 'Layer', control: ui.select({ value: it.layer || '', options: S.data.layers.map(l => [l.id, l.name + (l.visible ? '' : ' (hidden)')]), onChange: v => save({ layer: v }) }) }));
      // dates
      const inh = !it.start && !it.end && (it.entry && (V().datesOf(it).start || V().datesOf(it).end));
      addTo(scroll, WB.ui.sectionHead('When', null, 'Shown from the first date until (not including) the second. Empty = always.'),
        h('div.wb-at-cols2', [ui.field({ label: 'From', control: WB.ui.dateInput({ value: it.start, onChange: d => save({ start: d }, { repaint: true }) }) }), ui.field({ label: 'Until', control: WB.ui.dateInput({ value: it.end, onChange: d => save({ end: d }, { repaint: true }) }) })]),
        inh ? h('div.gk-tiny.gk-faint', { text: 'Following its entry\'s dates: ' + WB.fmt.range(V().datesOf(it).start, V().datesOf(it).end) }) : null);
      addTo(scroll, ui.field({ label: 'Note', control: (() => { const t = ui.input({ multiline: true, rows: 3, value: it.note, placeholder: 'Anything to remember about this spot', onInput: v => saveLater({ note: v }) }); return t; })() }));
      if (Geo().isPlanet(S.data) && it.kind === 'pin') { const [lon, lat] = Geo().lonLat(it.x, it.y, S.data.width, S.data.height); addTo(scroll, h('div.gk-small.gk-muted', { text: 'Position: ' + Math.abs(lat).toFixed(2) + '°' + (lat >= 0 ? 'N' : 'S') + ', ' + Math.abs(lon).toFixed(2) + '°' + (lon >= 0 ? 'E' : 'W') })); }
      addTo(insp, h('div.wb-at-inspfoot', [ui.button({ label: 'Duplicate', icon: '⧉', small: true, kind: 'ghost', onClick: () => duplicate(it) }), ui.button({ icon: '⤒', small: true, kind: 'ghost', title: 'Bring to front', onClick: () => restack(it, 1) }), ui.button({ icon: '⤓', small: true, kind: 'ghost', title: 'Send to back', onClick: () => restack(it, -1) }), h('span.gk-grow'), ui.button({ label: 'Remove', icon: '🗑', small: true, kind: 'danger', onClick: () => removeItem(it.id) })]));
    }
    const toHex = c => { if (/^#[0-9a-f]{6}$/i.test(c)) return c; const m = /rgb\((\d+),(\d+),(\d+)/.exec(c || ''); return m ? '#' + [m[1], m[2], m[3]].map(x => (+x).toString(16).padStart(2, '0')).join('') : '#c0503c'; };
    function subMapCtl(it, save) {
      const others = S.maps.filter(m => m.id !== S.map.id);
      const sel = ui.select({ value: it.subMapId || '', options: [['', '— none —']].concat(others.map(m => [m.id, m.title])), onChange: v => save({ subMapId: v || null }, { repaint: true }) });
      return h('div.gk-row.nowrap', [h('div.gk-grow', [sel]), ui.button({ label: 'New…', small: true, kind: 'ghost', title: 'Make a new map for this place and link it', onClick: async () => {
        const e = await newMapDialog({ parentId: S.map.id, title: V().titleOf(it) });
        if (e && e.id) await WB.api('atlas.save', { id: it.id, subMapId: e.id });
      } })]);
    }
    async function relink(it) {
      const kinds = it.kind === 'region' ? ['faction', 'place'] : null;
      const types = kinds ? kinds.map(k => (WB.type(k) || {}).id).filter(Boolean) : [];
      const e = await WB.ui.pickEntry({ title: 'Link “' + V().titleOf(it) + '” to…', types, allowCreate: true });
      if (!e) return;
      const patch = { id: it.id, entryId: e.id };
      if (it.kind === 'pin' && !(it.style && it.style.icon)) patch.style = Object.assign({}, it.style, { icon: await defaultIcon(e) });
      if (it.label && it.label === e.title) patch.label = '';
      await put(patch); select(it.id); paintSide();
    }
    async function createFor(it) {
      const k = it.kind === 'region' ? 'faction' : it.kind === 'path' ? 'place' : 'place';
      const e = await WB.ui.createDialog({ type: k, title: it.label || '', open: false });
      if (!e) return;
      await put({ id: it.id, entryId: e.id, label: '' }); select(it.id); paintSide();
    }
    async function defaultIcon(e) {
      const full = await WB.api('entries.get', e.id).catch(() => null);
      return WB.atlasIcons.forEntry(typeKeyOf(e), full && full.fields && full.fields.kind);
    }
    async function duplicate(it) {
      const off = 24 / view.t.k;
      const c = strip(it); delete c.id; delete c.createdAt; delete c.updatedAt;
      c.x += off; c.y += off; c.points = (c.points || []).map(p => [p[0] + off, p[1] + off]);
      const n = await put(c); select(n.id); paintSide();
    }
    async function restack(it, dir) {
      const sorts = S.items.filter(i => i.kind === it.kind).map(i => i.sort || 0);
      await put({ id: it.id, sort: dir > 0 ? Math.max(0, ...sorts) + 1 : Math.min(0, ...sorts) - 1 });
      reloadItems();
    }
    function travelModes() { return Geo().travelModes(S.data, WB.world.settings); }
    function travelTable(pts, only) {
      const D = S.data, dist = Geo().distance(D, pts);
      if (dist == null) return h('div.gk-small.gk-muted', [h('span', { text: Geo().fmtNum(Geo().pathLength(pts)) + ' px. ' }), ro() ? null : h('a', { href: '#', text: 'Set the scale', onclick: e => { e.preventDefault(); setTool('calibrate'); } }), ro() ? null : h('span', { text: ' to see real distances and travel times.' })]);
      const u = Geo().UNITS[D.unit].short;
      const modes = travelModes().filter(m => !only || m.mode === only);
      return h('div.wb-at-traveltbl', [h('div.wb-at-dist', { text: Geo().fmtNum(dist) + ' ' + u + (Geo().isPlanet(D) ? ' (great circle)' : '') }),
        ...modes.map(m => h('div.wb-at-mode', [h('span', { text: m.icon + ' ' + m.label }), h('span.gk-faint', { text: Geo().fmtNum(m.perDay) + ' ' + u + '/day' }), h('b', { text: Geo().fmtDuration(dist / m.perDay, m.hours) })]))]);
    }
    /** the map's own settings, drawn into a box of the Map panel */
    function paintSettings(scroll) {
      const D = S.data, m = S.map;
      const titleIn = ui.input({ value: m.title, onChange: v => WB.api('entries.update', m.id, { title: v.trim() || m.title }).then(() => refreshAll()) });
      addTo(scroll, ui.field({ label: 'Name', control: titleIn }));
      addTo(scroll, ui.field({ label: 'Image', control: h('div.gk-stack', [D.image ? WB.ui.thumb(D.image, { cls: 'wb-at-setthumb', fit: 'contain' }) : h('div.gk-small.gk-muted', { text: 'No image: a blank parchment of ' + D.width + ' × ' + D.height + ' px.' }),
        h('div.gk-row', [ui.button({ label: D.image ? 'Replace…' : 'Add image…', icon: '▣', small: true, onClick: () => replaceImage() }), ui.button({ label: 'Generate…', icon: '⛰', small: true, onClick: () => openGenerator({ replaceMapId: m.id, title: m.title }).then(() => refreshAll()) }),
          D.image ? ui.button({ label: 'Remove', small: true, kind: 'ghost', onClick: () => setData({ image: null }).then(() => refreshAll()) }) : null])]) }));
      addTo(scroll, ui.field({ label: 'Projection', hint: 'Planet = an equirectangular (2:1) world map: a globe view, latitude/longitude and great-circle distances.', control: ui.segmented({ value: D.projection, options: [['flat', 'Flat'], ['equirectangular', 'Planet']], onChange: v => setData(v === 'equirectangular' ? { projection: v, planet: { radiusKm: (D.planet && D.planet.radiusKm) || 6371 } } : { projection: v }).then(() => refreshAll()) }) }));
      if (Geo().isPlanet(D)) {
        addTo(scroll, ui.field({ label: 'Planet radius', hint: 'Earth is 6,371 km. The scale follows from it.', control: h('div.wb-unit', [ui.input({ type: 'number', value: D.planet.radiusKm, onChange: v => { if (+v > 0) setData({ planet: { radiusKm: +v } }).then(() => paintInspector()); } }), h('span.gk-small.gk-muted', { text: 'km' })]) }));
      }
      addTo(scroll, ui.field({ label: 'Unit of distance', control: ui.select({ value: D.unit, options: Object.entries(Geo().UNITS).map(([k, u]) => [k, u.name]), onChange: v => {
        // keep the real scale when the unit changes
        const patch = { unit: v };
        if (D.unitsPerPx) patch.unitsPerPx = Geo().convert(D.unitsPerPx, D.unit, v);
        setData(patch).then(() => paintInspector());
      } }) }));
      if (!Geo().isPlanet(D)) {
        const per = ui.input({ type: 'number', value: D.unitsPerPx || '', placeholder: 'not set', onChange: v => setData({ unitsPerPx: +v > 0 ? +v : null }).then(() => paintInspector()) });
        addTo(scroll, ui.field({ label: 'Scale', hint: D.unitsPerPx ? 'The map is ' + Geo().fmtNum(D.width * D.unitsPerPx) + ' × ' + Geo().fmtNum(D.height * D.unitsPerPx) + ' ' + Geo().UNITS[D.unit].short + '.' : 'Not set: distances show in pixels.', control: h('div.gk-row.nowrap', [h('span.gk-small.gk-muted', { text: '1 px =' }), h('div.gk-grow', [per]), h('span.gk-small.gk-muted', { text: Geo().UNITS[D.unit].short }), ui.button({ label: 'Draw it…', icon: '⇹', small: true, onClick: () => setTool('calibrate') })]) }));
      }
      // travel speeds
      const tbox = h('div.wb-at-speeds');
      const own = (D.travel || []).slice();
      for (const t of travelModes()) {
        const inp = ui.input({ type: 'number', value: Math.round(t.perDay * 10) / 10, onChange: v => {
          const list = own.filter(x => x.mode !== t.mode);
          if (+v > 0) list.push({ mode: t.mode, label: t.label, perDay: +v });
          setData({ travel: list }).then(() => paintInspector());
        } });
        tbox.appendChild(h('div.wb-at-speed', [h('span', { text: t.icon + ' ' + t.label }), inp, h('span.gk-small.gk-muted', { text: Geo().UNITS[D.unit].short + '/day' })]));
      }
      addTo(scroll, ui.field({ label: 'Travel speeds', hint: 'Distance per day of travel. Defaults: on foot 20 mi, horse 30, cart 18, ship 100.', control: tbox }),
        ui.button({ label: 'Add a way to travel…', icon: '＋', small: true, kind: 'ghost', onClick: async () => { const n = await ui.prompt('A way to travel', '', 'e.g. Griffin, Caravan, Airship'); if (n) setData({ travel: own.concat([{ mode: n.toLowerCase().replace(/\W+/g, '-'), label: n, perDay: 40 }]) }).then(() => paintInspector()); } }));
      const subs2 = S.maps.filter(x => x.parentMap === m.id);
      if (subs2.length) addTo(scroll, ui.field({ label: 'Maps inside this one', control: h('div.wb-chips', subs2.map(x => ui.chip({ label: '⤵ ' + x.title, onClick: () => openMap(x.id) }))) }));
    }
    async function replaceImage() {
      const md = await WB.ui.pickMedia({ kind: 'image', title: 'Map image' });
      if (!md) return;
      const patch = { image: md.id };
      if (md.width && md.height) {
        const sx = md.width / S.data.width, sy = md.height / S.data.height;
        Object.assign(patch, { width: md.width, height: md.height });
        // keep everything where it was relative to the picture
        if (S.items.length && (Math.abs(sx - 1) > .001 || Math.abs(sy - 1) > .001)) await WB.api('atlas.bulk', { save: S.items.map(i => ({ id: i.id, x: i.x * sx, y: i.y * sy, points: i.points.map(p => [p[0] * sx, p[1] * sy]) })) });
        if (S.data.unitsPerPx) patch.unitsPerPx = S.data.unitsPerPx / sx;
      }
      await setData(patch);
      await refreshAll();
    }

    /* ---------- read-only card (Share view) ---------- */
    function cardFor(it, at) {
      const [sx, sy] = view.toScreen(it.x, it.y);
      const r = canvas.getBoundingClientRect();
      const pos = at || { left: r.left + sx, top: r.top + sy + 14, right: r.left + sx, bottom: r.top + sy + 14 };   // check-ok: screen (body-level popover)
      const box = h('div.wb-at-card-pop');
      addTo(box, h('div.gk-row.nowrap', [itemIcon(it), h('b.gk-ellipsis.gk-grow', { text: V().titleOf(it) })]));
      if (it.entry) {
        const sum = h('p.gk-small');
        WB.api('entries.lite', it.entry.id).then(e => { if (e) sum.textContent = e.summary || ''; }).catch(() => {});
        addTo(box, h('div', [WB.ui.chip(it.entry.id)]), sum);
      }
      const d = V().datesOf(it);
      if (d.start || d.end) addTo(box, h('div.gk-small.gk-muted', { text: WB.fmt.range(d.start, d.end) }));
      if (it.kind === 'path') addTo(box, travelTable(it.points, it.style.mode));
      if (it.note && !ro()) addTo(box, h('p.gk-small.gk-muted', { text: it.note }));
      addTo(box, h('div.gk-row', [it.entry ? ui.button({ label: 'Open', icon: '↗', small: true, onClick: () => WB.open(it.entry.id) }) : null, it.entry ? ui.button({ label: 'Peek', icon: '◫', small: true, onClick: () => WB.peek(it.entry.id) }) : null,
        it.subMapId ? ui.button({ label: 'Open map', icon: '⤵', small: true, kind: 'primary', onClick: () => openMap(it.subMapId) }) : null,
        it.kind === 'region' ? ui.button({ label: 'History here', icon: '⌛', small: true, onClick: () => historyAt(it.x, it.y, pos) }) : null]));
      WB.ui.popover(pos, box, { group: 'atcard', width: '19em' });
    }

    /* ---------- border history ---------- */
    async function historyAt(mx, my, at) {
      const list = (await WB.api('atlas.at', S.map.id, mx, my, S.day)).filter(x => !x.item.entry || WB.visible(x.item.entry));
      const box = h('div.wb-at-hist');
      addTo(box, h('div.wb-at-hist-head', [h('b', { text: 'Who held this spot' }), h('span.gk-small.gk-muted', { text: Geo().isPlanet(S.data) ? coordText(mx, my) : '' })]));
      if (!list.length) addTo(box, h('p.gk-small.gk-muted', { text: 'No territory covers this spot. Draw one with the area tool (R) and give it dates to record changing borders.' }));
      for (const x of list) {
        const it = x.item, d = V().datesOf(it);
        const row = h('div.wb-at-hist-row', { class: x.active ? 'on' : '' }, [
          h('span.wb-at-swatch', { style: { '--c': V().colorOf(it) } }),
          h('div.gk-grow', [it.entry ? WB.ui.chip(it.entry.id, { size: 'sm' }) : h('b', { text: V().titleOf(it) }), h('div.gk-small.gk-muted', { text: d.start || d.end ? WB.fmt.range(d.start, d.end) : 'always' })]),
          x.active ? WB.ui.badge('now', 'accent') : ui.button({ label: 'Go', small: true, kind: 'ghost', title: 'Move the time slider there', onClick: () => { if (d.start) setDay(d.start.day); } }),
        ]);
        addTo(box, row);
      }
      WB.ui.popover(at, box, { group: 'athist', width: '21em' });
    }
    const coordText = (mx, my) => { const [lon, lat] = Geo().lonLat(mx, my, S.data.width, S.data.height); return Math.abs(lat).toFixed(1) + '°' + (lat >= 0 ? 'N' : 'S') + ' ' + Math.abs(lon).toFixed(1) + '°' + (lon >= 0 ? 'E' : 'W'); };

    /* ---------- creating items ---------- */
    /** the quick chooser after a pin or territory is placed: link an entry, create one, or just name it */
    function chooser(at, { title, types = [], allowLabel = true, createType }) {
      return new Promise(resolve => {
        let done = false, results = [], sel = 0;
        const finish = v => { if (done) return; done = true; pop.close(); resolve(v); };
        const inp = h('input.gk-input.gk-control', { placeholder: 'Search entries, or type a new name', spellcheck: false });
        const list = h('div.wb-at-chooser-list');
        const foot = h('div.wb-at-chooser-foot');
        const typeIds = types.map(k => (WB.type(k) || {}).id).filter(Boolean);
        let ct = WB.type(createType) || WB.type(types[0]) || WB.type('place');
        const paint = () => {
          GK.clear(list); GK.clear(foot);
          results.forEach((e, i) => {
            const on = S.items.some(x => x.entryId === e.id);
            const r = h('button.wb-menu-item', { type: 'button', class: i === sel ? 'sel' : '', onclick: () => finish({ entry: e }) }, [WB.ui.icon(e), h('span.wb-menu-lbl.gk-ellipsis', { text: e.title }), h('span.wb-menu-kbd', { text: on ? 'on map' : (WB.typeOf(e) || {}).name || '' })]);
            list.appendChild(r);
          });
          const q = inp.value.trim();
          if (q) {
            const tsel = ui.select({ value: ct ? ct.id : '', options: WB.typeList().filter(t => t.pinnable || types.includes(t.key)).map(t => [t.id, t.icon + ' ' + t.name]), onChange: v => { ct = WB.types.get(v); } });
            addTo(foot, h('div.gk-row.nowrap', [ui.button({ label: 'Create “' + q + '”', icon: '＋', small: true, kind: 'primary', onClick: async () => { try { const e = await WB.api('entries.create', { worldId: WB.worldId, typeId: ct.id, title: q }); finish({ entry: e, created: true }); } catch (err) { WB.fail(err); } } }), h('span.gk-small.gk-muted', { text: 'as' }), tsel]));
            if (allowLabel) addTo(foot, ui.button({ label: 'Just a name on the map', small: true, kind: 'ghost', onClick: () => finish({ label: q }) }));
          } else if (allowLabel) addTo(foot, ui.button({ label: 'No entry — plain ' + title.toLowerCase(), small: true, kind: 'ghost', onClick: () => finish({ label: '' }) }));
        };
        const run = WB.debounce(async () => {
          const q = inp.value.trim();
          results = (await WB.api('search.query', WB.worldId, q, { typeIds: typeIds.length ? typeIds : WB.typeList().filter(t => t.pinnable).map(t => t.id), limit: 8 }).catch(() => [])).filter(e => WB.visible(e) && e.id !== S.map.id);
          sel = 0; paint();
        }, 100);
        inp.addEventListener('input', run);
        inp.addEventListener('keydown', e => {
          if (e.key === 'ArrowDown') { e.preventDefault(); sel = Math.min(results.length - 1, sel + 1); paint(); }
          else if (e.key === 'ArrowUp') { e.preventDefault(); sel = Math.max(0, sel - 1); paint(); }
          else if (e.key === 'Enter') { e.preventDefault(); if (results[sel]) finish({ entry: results[sel] }); else if (inp.value.trim() && allowLabel) finish({ label: inp.value.trim() }); }
        });
        const box = h('div.wb-at-chooser', [h('div.wb-at-chooser-head', [h('b', { text: title }), h('span.gk-small.gk-faint', { text: 'Enter picks · Esc cancels' })]), inp, list, foot]);
        const pop = WB.ui.popover(at, box, { group: 'atchoose', width: '22em', onClose: () => { if (!done) { done = true; resolve(null); } } });
        setTimeout(() => inp.focus(), 20);
        run();
      });
    }
    const screenAt = (sx, sy) => { const r = canvas.getBoundingClientRect(); return { left: r.left + sx, top: r.top + sy, right: r.left + sx, bottom: r.top + sy, width: 0, height: 0 }; };   // check-ok: screen (body-level popover anchor)
    async function addPin(mx, my, sx, sy) {
      const armed = !!S.place;
      let choice = S.place ? { entry: S.place } : await chooser(screenAt(sx, sy), { title: 'Pin', types: [] });
      S.place = null;
      if (armed) setTool('select');
      if (!choice) return;
      const style = {};
      if (choice.entry) style.icon = await defaultIcon(choice.entry);
      const it = await put({ mapId: S.map.id, kind: 'pin', entryId: choice.entry ? choice.entry.id : null, label: choice.label || '', x: mx, y: my, style });
      select(it.id); paintSide(); paintLegend();
      if (S.tool === 'pin' && !ro()) paintTools();
    }
    async function finishDraft() {
      const d = S.draft;
      if (!d) return;
      S.draft = null;
      // drop corners that sit on top of the previous one (a double-click adds two)
      const pts = d.pts.filter((p, i, a) => i === 0 || Math.hypot(p[0] - a[i - 1][0], p[1] - a[i - 1][1]) * view.t.k > 2);
      if (d.kind === 'region' && pts.length < 3) { view.draw(); return ui.toast('A territory needs at least three corners', 'ℹ'); }
      if (d.kind === 'path' && pts.length < 2) { view.draw(); return; }
      view.draw();
      const [sx, sy] = view.toScreen(pts[pts.length - 1][0], pts[pts.length - 1][1]);
      const choice = await chooser(screenAt(sx, sy), d.kind === 'region' ? { title: 'Territory', types: ['faction', 'place'], createType: 'faction' } : { title: 'Route', types: ['place'], createType: 'place' });
      if (!choice) return;
      const style = d.kind === 'path' ? { kind: 'route' } : {};
      const it = await put({ mapId: S.map.id, kind: d.kind, entryId: choice.entry ? choice.entry.id : null, label: choice.label || '', points: pts, style });
      select(it.id); paintSide(); paintLegend();
    }
    async function addLabel(mx, my, sx, sy) {
      const inp = ui.input({ placeholder: 'e.g. The Sunless Sea' });
      const box = h('div.wb-at-labelpop', [h('b', { text: 'Label' }), inp, h('div.gk-small.gk-faint', { text: 'Enter to place · it scales with the map like printed names' })]);
      const pop = WB.ui.popover(screenAt(sx, sy), box, { group: 'atlabel', width: '18em' });
      setTimeout(() => inp.focus(), 20);
      inp.addEventListener('keydown', async e => {
        if (e.key !== 'Enter' || !inp.value.trim()) return;
        pop.close();
        const it = await put({ mapId: S.map.id, kind: 'label', label: inp.value.trim(), x: mx, y: my, style: { size: Math.round(20 / view.t.k * 10) / 10, italic: true } });
        select(it.id); paintSide();
      });
    }
    async function calibrate(a, b) {
      const D = S.data, px = Math.hypot(b[0] - a[0], b[1] - a[1]);
      if (px < 2) return;
      const len = ui.input({ type: 'number', placeholder: 'e.g. 12' });
      let unit = D.unit;
      const body2 = h('div.gk-stack', [h('p.gk-text', { text: Geo().isPlanet(D) ? 'How far apart are these two points in reality? The planet\'s radius is set from it.' : 'How long is the line you drew (' + Math.round(px) + ' px) in reality?' }),
        h('div.gk-row.nowrap', [h('div.gk-grow', [len]), ui.select({ value: unit, options: Object.entries(Geo().UNITS).map(([k, u]) => [k, u.name]), onChange: v => { unit = v; } })])]);
      const ok = await ui.dialog({ title: 'Set the scale', icon: '⇹', body: body2, actions: [{ label: 'Cancel', value: false }, { label: 'Set scale', kind: 'primary', value: true }] });
      const v = +len.value;
      if (!ok || !(v > 0)) return setTool('select');
      if (Geo().isPlanet(D)) {
        const ang = Geo().haversine(Geo().lonLat(a[0], a[1], D.width, D.height), Geo().lonLat(b[0], b[1], D.width, D.height), 1);
        if (ang <= 0) return;
        await setData({ unit, planet: { radiusKm: Geo().toKm(v, unit) / ang } });
      } else await setData({ unit, unitsPerPx: v / px });
      ui.toast('Scale set: the map is ' + Geo().fmtNum(D.width * (Geo().unitsPerPx(S.data) || 0)) + ' ' + Geo().UNITS[unit].short + ' wide', '⇹');
      setTool('select');
    }

    /* ---------- measuring ---------- */
    function paintMeasure() {
      GK.clear(measureCard);
      const m = S.measure;
      measureCard.hidden = !m || m.pts.length < 2;
      if (measureCard.hidden) return;
      addTo(measureCard, h('div.wb-at-mhead', [h('b', { text: 'Measure' }), h('span.gk-grow'), !ro() ? h('button.wb-at-chipbtn', { type: 'button', title: 'Keep this line as a route', onclick: async () => { const pts = m.pts.slice(); S.measure = null; paintMeasure(); const it = await put({ mapId: S.map.id, kind: 'path', points: pts, label: 'Route', style: { kind: 'route' } }); select(it.id); setTool('select'); } }, ['Save as route']) : null,
        h('button.wb-at-x', { type: 'button', title: 'Clear (Esc)', text: '✕', onclick: () => { S.measure = null; paintMeasure(); view.draw(); } })]), travelTable(m.pts, null));
    }

    /* ---------- overlay drawing (drafts, measure, calibrate) ---------- */
    function drawOverlay(g) {
      T.overlay(g);
      const pts = S.draft ? S.draft.pts : S.measure ? S.measure.pts : S.cal ? S.cal : null;
      if (!pts || !pts.length) return;
      const live2 = S.hoverMap && (S.draft || (S.measure && !S.measure.done) || (S.cal && S.cal.length === 1)) ? pts.concat([S.hoverMap]) : pts;
      const D = S.data, planet = Geo().isPlanet(D);
      const scr = [];
      for (let i = 0; i < live2.length; i++) {
        if (planet && i > 0 && (S.measure || S.cal)) {
          const a = Geo().lonLat(live2[i - 1][0], live2[i - 1][1], D.width, D.height), b = Geo().lonLat(live2[i][0], live2[i][1], D.width, D.height);
          for (const ll of Geo().greatCircle(a, b, 32).slice(1)) { const p = Geo().toXY(ll[0], ll[1], D.width, D.height); scr.push(view.toScreen(p[0], p[1])); }
        } else scr.push(view.toScreen(live2[i][0], live2[i][1]));
      }
      const accent = getComputedStyle(canvas).getPropertyValue('--accent').trim() || '#4aa3ff';
      g.lineJoin = 'round'; g.lineCap = 'round';
      if (S.draft && S.draft.kind === 'region' && scr.length > 2) { g.beginPath(); scr.forEach((p, i) => (i ? g.lineTo(p[0], p[1]) : g.moveTo(p[0], p[1]))); g.closePath(); g.fillStyle = 'rgba(255,255,255,.18)'; g.fill(); }
      g.beginPath(); scr.forEach((p, i) => (i ? g.lineTo(p[0], p[1]) : g.moveTo(p[0], p[1])));
      g.lineWidth = 5 * view.ui; g.strokeStyle = 'rgba(0,0,0,.45)'; g.stroke();
      g.lineWidth = 2.4 * view.ui; g.strokeStyle = S.cal ? '#ffd166' : accent; g.setLineDash(S.measure || S.cal ? [8, 5] : []); g.stroke(); g.setLineDash([]);
      for (const p of pts) { const [x, y] = view.toScreen(p[0], p[1]); g.beginPath(); g.arc(x, y, 4.5 * view.ui, 0, Math.PI * 2); g.fillStyle = '#fff'; g.fill(); g.lineWidth = 2; g.strokeStyle = '#1d3b5a'; g.stroke(); }
      if (S.draft && S.draft.kind === 'region' && pts.length > 2) { const [x, y] = view.toScreen(pts[0][0], pts[0][1]); g.beginPath(); g.arc(x, y, 8 * view.ui, 0, Math.PI * 2); g.strokeStyle = '#fff'; g.lineWidth = 2; g.stroke(); }
      // running distance next to the cursor
      if ((S.measure || S.cal || (S.draft && S.draft.kind === 'path')) && live2.length > 1) {
        const dist = Geo().distance(D, live2);
        const text = dist == null ? Math.round(Geo().pathLength(live2)) + ' px' : Geo().fmtNum(dist) + ' ' + Geo().UNITS[D.unit].short;
        const [x, y] = view.toScreen(live2[live2.length - 1][0], live2[live2.length - 1][1]);
        g.font = '700 ' + 12.5 * view.ui + 'px ' + getComputedStyle(canvas).fontFamily;
        const tw = g.measureText(text).width;
        g.fillStyle = 'rgba(15,22,32,.82)'; g.beginPath(); g.roundRect(x + 12, y - 26, tw + 14, 22 * view.ui, 6); g.fill();
        g.fillStyle = '#fff'; g.textBaseline = 'middle'; g.fillText(text, x + 19, y - 26 + 11 * view.ui);
      }
    }

    /* ---------- pointer & keyboard ---------- */
    const ptOf = e => { const r = canvas.getBoundingClientRect(); const ox = r.left, oy = r.top; return [e.clientX - ox, e.clientY - oy]; };   // canvas maths stay in screen px (the view's own space)
    let spaceDown = false, down = null;
    /** the nearest corner of a visible territory or route within reach (pins too when asked): snapping makes borders meet exactly. Alt turns it off. */
    function snapAt(sx, sy, { skip, pins } = {}) {
      let best = null, bd = 9 * view.ui;
      for (const it of view.shown()) {
        if (it.kind === 'region' || it.kind === 'path') {
          for (let i = 0; i < it.points.length; i++) {
            if (skip && skip(it, i)) continue;
            const p = it.points[i], [x, y] = view.toScreen(p[0], p[1]), d = Math.hypot(x - sx, y - sy);
            if (d < bd) { bd = d; best = [p[0], p[1]]; }
          }
        } else if (pins && it.kind === 'pin') { const [x, y] = view.toScreen(it.x, it.y), d = Math.hypot(x - sx, y - sy); if (d < bd) { bd = d; best = [it.x, it.y]; } }
      }
      return best;
    }
    /** corners of other visible territories and routes sitting exactly on this one: a shared border moves as one */
    function linkedCorners(it, index) {
      const p = it.points[index], out = [];
      for (const o of view.shown()) {
        if (o === it || (o.kind !== 'region' && o.kind !== 'path')) continue;
        o.points.forEach((q, i) => { if (Math.abs(q[0] - p[0]) < .6 && Math.abs(q[1] - p[1]) < .6) out.push({ item: o, index: i, orig: o.points.map(x => x.slice()) }); });
      }
      return out;
    }
    canvas.addEventListener('pointerdown', e => {
      if (S.globe) return;
      canvas.focus();
      const [sx, sy] = ptOf(e), [mx, my] = view.toMap(sx, sy);
      WB.ui.closePopovers('atcard');
      if (e.button === 1 || (e.button === 0 && spaceDown)) { down = { pan: true, sx, sy, moved: false }; capture(canvas, e); return; }
      if (e.button !== 0) return;
      const tool = S.tool;
      if (T.has(tool)) { T.down(e, sx, sy, mx, my); capture(canvas, e); return; }
      if (tool === 'select') {
        if (T.selectDown(e, sx, sy, mx, my)) { capture(canvas, e); return; }
        const hit = view.hit(sx, sy, { handles: !ro() });
        down = { sx, sy, mx, my, hit, moved: false, pan: !hit || ro() };
        if (hit && !ro()) {
          const it = hit.item;
          down.orig = { x: it.x, y: it.y, points: it.points.map(p => p.slice()) };
          if (hit.part === 'mid') { it.points.splice(hit.index + 1, 0, [mx, my]); down.hit = { item: it, part: 'vertex', index: hit.index + 1 }; down.inserted = true; }
          if (down.hit.part === 'vertex' && !down.inserted && !e.altKey) down.links = linkedCorners(it, down.hit.index);
          if (S.sel !== it.id) select(it.id);
        }
        capture(canvas, e);
      } else if (tool === 'region' || tool === 'path') {
        if (!S.draft) S.draft = { kind: tool, pts: [] };
        const pts = S.draft.pts;
        if (tool === 'region' && pts.length > 2) { const [fx, fy] = view.toScreen(pts[0][0], pts[0][1]); if (Math.hypot(fx - sx, fy - sy) < 10 * view.ui) { finishDraft(); return; } }
        pts.push((!e.altKey && snapAt(sx, sy)) || T.snap([mx, my]));
        down = { draw: true, sx, sy, last: [sx, sy] };
        capture(canvas, e);
        view.draw();
      } else if (tool === 'measure') {
        if (!S.measure || S.measure.done) S.measure = { pts: [] };
        S.measure.pts.push((!e.altKey && snapAt(sx, sy, { pins: true })) || T.snap([mx, my]));
        paintMeasure(); view.draw();
      } else if (tool === 'calibrate') {
        S.cal = S.cal && S.cal.length === 1 ? S.cal.concat([[mx, my]]) : [[mx, my]];
        view.draw();
        if (S.cal.length === 2) { const [a, b] = S.cal; S.cal = null; view.draw(); calibrate(a, b); }
      } else if (tool === 'pin') addPin(...T.snap([mx, my]), sx, sy);
      else if (tool === 'label') addLabel(...T.snap([mx, my]), sx, sy);
    });
    canvas.addEventListener('pointermove', e => {
      if (S.globe) return;
      const [sx, sy] = ptOf(e), [mx, my] = view.toMap(sx, sy);
      S.hoverMap = [mx, my];
      paintCoords(mx, my);
      if (T.move(e, sx, sy, mx, my, !!down)) return;
      if (down && down.pan) {
        if (Math.hypot(sx - down.sx, sy - down.sy) > 2) down.moved = true;
        view.pan(sx - down.sx, sy - down.sy); down.sx = sx; down.sy = sy; saveView();
        canvas.classList.add('panning');
        return;
      }
      if (down && down.draw) {
        // freehand: keep adding corners while the button is held
        if (Math.hypot(sx - down.last[0], sy - down.last[1]) > 7 * view.ui) { S.draft.pts.push([mx, my]); down.last = [sx, sy]; down.free = true; }
        view.draw();
        return;
      }
      if (down && down.hit && !ro()) {
        if (!down.moved && Math.hypot(sx - down.sx, sy - down.sy) < 3) return;
        down.moved = true;
        const it = down.hit.item, dx = mx - down.mx, dy = my - down.my;
        if (down.hit.part === 'vertex') {
          const links = down.links || [], idx = down.hit.index;
          const np = (!e.altKey && snapAt(sx, sy, { skip: (o, i) => (o === it && i === idx) || links.some(l => l.item === o && l.index === i) })) || [mx, my];
          it.points[idx] = np;
          for (const l of links) l.item.points[l.index] = np.slice();
        }
        else if ((it.kind === 'pin' || it.kind === 'label') && T.snapOn() && !e.altKey) { const sp = T.snap([down.orig.x + dx, down.orig.y + dy]); it.x = sp[0]; it.y = sp[1]; }
        else { it.x = down.orig.x + dx; it.y = down.orig.y + dy; it.points = down.orig.points.map(p => [p[0] + dx, p[1] + dy]); }
        view.setItems(S.items); view.draw();
        hideTip();
        return;
      }
      // hover
      if (S.tool === 'select' || S.tool === 'pin') {
        const hit = S.tool === 'select' ? view.hit(sx, sy, { handles: !ro() }) : null;
        const id = hit ? hit.item.id : null;
        canvas.style.cursor = hit ? (hit.part === 'vertex' || hit.part === 'mid' ? 'move' : 'pointer') : '';
        if (view.opt.hover !== id) { view.opt.hover = id; view.draw(); }
        if (hit && hit.part === 'body') showTip(hit.item, e); else hideTip();
      } else view.draw();
    });
    const endDown = async e => {
      if (T.up(e)) { down = null; return; }
      const d = down; down = null;
      canvas.classList.remove('panning');
      if (!d) return;
      if (d.draw) { if (d.free && S.draft) { S.draft.pts = Geo().simplify(S.draft.pts, 1.5 / view.t.k); view.draw(); } return; }
      if (d.pan) {
        if (!d.moved && S.tool === 'select' && e && e.button === 0) {
          if (d.hit && ro()) cardFor(d.hit.item);
          else if (!d.hit) {
            select(null);
            // the Travel view: a click (not a drag) on open ground moves the starting point
            if (M.mode === 'travel') { M.setOrigin([d.mx, d.my]); PN.save(); PN.banner(); }
          }
        }
        return;
      }
      if (d.hit) {
        const it = d.hit.item;
        if (d.moved || d.inserted) {
          const patch = d.hit.part === 'vertex' ? { id: it.id, points: it.points } : it.kind === 'region' || it.kind === 'path' ? { id: it.id, points: it.points } : { id: it.id, x: it.x, y: it.y };
          const before = { id: it.id, x: d.orig.x, y: d.orig.y, points: d.orig.points };
          const links = d.links || [];
          if (links.length) {
            // the shared border: every territory on it is saved (and undone) together
            const save = [patch].concat(links.map(l => ({ id: l.item.id, points: l.item.points.map(p => p.slice()) })));
            const back = [before].concat(links.map(l => ({ id: l.item.id, points: l.orig })));
            const seen = new Set(), uniq = list => list.filter(x => !seen.has(x.id) && seen.add(x.id));
            const saveU = uniq(save); seen.clear(); const backU = uniq(back);
            try { const r = await WB.api('atlas.bulk', { save: saveU }); r.saved.forEach(upsertLocal); record(() => WB.api('atlas.bulk', { save: backU }), () => WB.api('atlas.bulk', { save: saveU })); paintInspector(); } catch (err) { WB.fail(err); reloadItems(); }
            return;
          }
          try { const n = await WB.api('atlas.save', patch); upsertLocal(n); record(() => WB.api('atlas.save', before), () => WB.api('atlas.save', patch)); paintInspector(); } catch (err) { WB.fail(err); reloadItems(); }
        }
      }
    };
    canvas.addEventListener('pointerup', endDown);
    canvas.addEventListener('pointercancel', () => { down = null; });
    canvas.addEventListener('pointerleave', () => { S.hoverMap = null; hideTip(); paintCoords(null); if (view.opt.hover) { view.opt.hover = null; view.draw(); } });
    canvas.addEventListener('dblclick', e => {
      if (S.globe) return;
      if (T.dbl()) { e.preventDefault(); return; }
      const [sx, sy] = ptOf(e);
      if (S.draft) { e.preventDefault(); if (S.draft.pts.length > (S.draft.kind === 'region' ? 3 : 2)) S.draft.pts.pop(); finishDraft(); return; }
      if (S.tool === 'measure' && S.measure) { S.measure.done = true; paintMeasure(); view.draw(); return; }
      if (S.tool !== 'select') return;
      const hit = view.hit(sx, sy);
      if (!hit) { view.zoomAt(sx, sy, 1.8); saveView(); return; }
      const it = hit.item;
      if (it.subMapId) openMap(it.subMapId);
      else if (it.entryId) WB.peek(it.entryId);
    });
    canvas.addEventListener('wheel', e => {
      if (S.globe) return;
      e.preventDefault();
      const [sx, sy] = ptOf(e);
      const f = Math.exp(-e.deltaY * (e.ctrlKey ? 0.01 : 0.0018));
      view.zoomAt(sx, sy, f); saveView();
    }, { passive: false });
    canvas.addEventListener('contextmenu', e => {
      e.preventDefault();
      if (S.globe) return;
      const [sx, sy] = ptOf(e), [mx, my] = view.toMap(sx, sy);
      if (S.draft) { finishDraft(); return; }
      if (T.finish()) return;
      const hit = view.hit(sx, sy);
      if (hit && hit.item.kind !== 'region') return itemMenu(hit.item, e, [mx, my]);
      // on open ground or inside a territory: the map's own actions, then the territory's
      const reg = hit && hit.item;
      const inside = mx >= 0 && my >= 0 && mx <= S.data.width && my <= S.data.height;
      WB.ui.menu([
        { header: Geo().isPlanet(S.data) ? coordText(mx, my) : 'Here' },
        ro() || !inside ? null : { label: 'Pin an entry here…', icon: '📍', onClick: () => addPin(mx, my, sx, sy) },
        ro() || !inside ? null : { label: 'Found a settlement here…', icon: '⌂', hint: WB.gen && WB.gen.town ? 'Opens the town generator' : 'Creates a place and pins it', onClick: () => foundSettlement(mx, my) },
        ro() || !inside ? null : { label: 'Add a label here…', icon: 'T', onClick: () => addLabel(mx, my, sx, sy) },
        inside ? { label: 'Who held this spot?', icon: '⌛', onClick: () => historyAt(mx, my, e) } : null,
        { label: 'Measure from here', icon: '📏', onClick: () => { setTool('measure'); S.measure = { pts: [[mx, my]] }; view.draw(); } },
        '-',
        { label: 'Centre here', icon: '◎', onClick: () => { view.centerOn(mx, my); saveView(); } },
        { label: 'Copy coordinates', icon: '⎘', onClick: () => { navigator.clipboard.writeText(Geo().isPlanet(S.data) ? coordText(mx, my) : Math.round(mx) + ', ' + Math.round(my)); ui.toast('Copied', '⎘'); } },
        reg ? '-' : null,
        reg ? { label: V().titleOf(reg), icon: '⬠', sub: [
          reg.entryId ? { label: 'Open entry', icon: '↗', onClick: () => WB.open(reg.entryId) } : null,
          reg.entryId ? { label: 'Peek', icon: '◫', onClick: () => WB.peek(reg.entryId) } : null,
          ro() ? null : { label: 'Edit…', icon: '✎', onClick: () => select(reg.id) },
          { label: 'Zoom to it', icon: '⤢', onClick: () => focusItem(reg) },
          ro() ? null : { label: 'Remove from map', icon: '🗑', danger: true, onClick: () => removeItem(reg.id) },
        ].filter(Boolean) } : null,
      ], e);
    });
    function itemMenu(it, e, at) {
      WB.ui.menu([
        { header: V().titleOf(it) },
        it.entryId ? { label: 'Open entry', icon: '↗', onClick: () => WB.open(it.entryId) } : null,
        it.entryId ? { label: 'Peek', icon: '◫', onClick: () => WB.peek(it.entryId) } : null,
        it.subMapId ? { label: 'Open sub-map', icon: '⤵', onClick: () => openMap(it.subMapId) } : null,
        ro() ? null : { label: 'Edit…', icon: '✎', onClick: () => { select(it.id); } },
        it.kind === 'region' || at ? { label: 'Who held this spot?', icon: '⌛', onClick: () => historyAt(at ? at[0] : it.x, at ? at[1] : it.y, e) } : null,
        { label: 'Zoom to it', icon: '⤢', onClick: () => focusItem(it) },
        ro() ? null : '-',
        ro() ? null : { label: 'Duplicate', icon: '⧉', kbd: 'Ctrl+D', onClick: () => duplicate(it) },
        ro() ? null : { label: 'Move to layer', icon: '☰', sub: S.data.layers.map(l => ({ label: l.name, checked: it.layer === l.id, onClick: () => put({ id: it.id, layer: l.id }).then(() => paintSide()) })) },
        ro() ? null : { label: 'Remove from map', icon: '🗑', kbd: 'Del', danger: true, onClick: () => removeItem(it.id) },
      ], e);
    }
    async function foundSettlement(mx, my) {
      if (WB.gen && typeof WB.gen.town === 'function') {
        try { await WB.gen.town({ mapId: S.map.id, x: mx, y: my }); } catch (err) { WB.fail(err); }
        return reloadItems();
      }
      const e = await WB.ui.createDialog({ type: 'place', open: false });
      if (!e) return;
      const it = await put({ mapId: S.map.id, kind: 'pin', entryId: e.id, x: mx, y: my, style: { icon: 'town' } });
      select(it.id); paintSide();
      ui.toast('“' + e.title + '” founded and pinned', '⌂');
    }
    // tooltips
    let tipT = 0;
    function showTip(it, e) {
      clearTimeout(tipT);
      tipT = setTimeout(() => {
        const d = V().datesOf(it);
        tip.replaceChildren(h('b', { text: V().titleOf(it) }), h('span.gk-small.gk-muted', { text: [it.entry ? (WB.typeOf(it.entry) || {}).name : kindName(it), d.start || d.end ? WB.fmt.range(d.start, d.end) : '', it.subMapId ? 'double-click opens its map' : ''].filter(Boolean).join(' · ') }));
        const p = GK.pointIn(stageInner, e.clientX, e.clientY);
        tip.style.left = (p.x + 14) + 'px'; tip.style.top = (p.y + 16) + 'px';
        tip.hidden = false;
      }, 260);
    }
    function hideTip() { clearTimeout(tipT); tip.hidden = true; }
    tip.hidden = true;
    // drop entries from anywhere in the app onto the map
    WB.dnd.accept(canvas, async (id, ev) => {
      if (ro() || !S.map) return;
      const [sx, sy] = ptOf(ev), [mx, my] = view.toMap(sx, sy);
      const e = WB.liteOf(id) || await WB.api('entries.lite', id);
      if (!e) return;
      const it = await put({ mapId: S.map.id, kind: 'pin', entryId: id, x: mx, y: my, style: { icon: await defaultIcon(e) } });
      select(it.id); paintSide(); paintLegend();
      ui.toast('Pinned “' + e.title + '”', '📍');
    });
    WB.dropFiles(canvas, async files => {
      if (ro() || !S.map) return;
      const saved = await WB.saveFiles(files.filter(f => /^image\//.test(f.type)));
      if (!saved[0]) return;
      if (!S.data.image || await ui.confirm('Use as the map image?', 'Replace this map\'s picture with “' + saved[0].name + '”? Pins and territories keep their place relative to the picture.', 'Replace')) {
        const md = saved[0];
        const patch = { image: md.id };
        if (md.width && md.height) { const sx = md.width / S.data.width, sy = md.height / S.data.height; Object.assign(patch, { width: md.width, height: md.height }); if (S.items.length) await WB.api('atlas.bulk', { save: S.items.map(i => ({ id: i.id, x: i.x * sx, y: i.y * sy, points: i.points.map(p => [p[0] * sx, p[1] * sy]) })) }); }
        await setData(patch); refreshAll();
      }
    });

    const onKey = e => {
      if (!S.map || S.gallery || !page.isConnected) return;
      if (document.querySelector('.gk-scrim')) return;
      const typing = e.target.closest && e.target.closest('input, textarea, select, [contenteditable="true"]');
      if (e.ctrlKey && e.key.toLowerCase() === 'f') { const f = findBox.querySelector('input'); if (f) { e.preventDefault(); f.focus(); f.select(); } return; }
      if (typing) return;
      if (e.target.closest && !e.target.closest('.wb-atlas-page') && e.target !== document.body) return;
      const k = e.key, it = selItem();
      if (k === ' ') { spaceDown = true; canvas.style.cursor = 'grab'; e.preventDefault(); return; }
      if (e.ctrlKey && k.toLowerCase() === 'z' && !e.shiftKey) { e.preventDefault(); if (!ro()) undo(); return; }
      if (e.ctrlKey && (k.toLowerCase() === 'y' || (k.toLowerCase() === 'z' && e.shiftKey))) { e.preventDefault(); if (!ro()) redo(); return; }
      if (e.ctrlKey && k.toLowerCase() === 'd' && it && !ro()) { e.preventDefault(); duplicate(it); return; }
      if (k !== 'Escape' && T.key(e)) return;
      if (e.ctrlKey || e.altKey || e.metaKey) return;
      if (k === 'Escape') {
        if (T.escape()) return;
        if (S.draft) { S.draft = null; view.draw(); }
        else if (S.measure) { S.measure = null; paintMeasure(); view.draw(); }
        else if (S.cal) { S.cal = null; view.draw(); }
        else if (S.tool !== 'select') setTool('select');
        else if (S.sel) select(null);
        return;
      }
      if (k === 'Enter' && S.draft) { e.preventDefault(); finishDraft(); return; }
      if (k === 'Enter' && S.measure) { S.measure.done = true; paintMeasure(); return; }
      if (k === 'Backspace' && S.draft) { e.preventDefault(); S.draft.pts.pop(); if (!S.draft.pts.length) S.draft = null; view.draw(); return; }
      if ((k === 'Delete' || k === 'Backspace') && it && !ro()) { e.preventDefault(); removeItem(it.id); return; }
      if (k.startsWith('Arrow') && it && !ro() && S.mode === 'flat') {
        e.preventDefault();
        const step = (e.shiftKey ? 10 : 1) / view.t.k * 2, dx = k === 'ArrowLeft' ? -step : k === 'ArrowRight' ? step : 0, dy = k === 'ArrowUp' ? -step : k === 'ArrowDown' ? step : 0;
        it.x += dx; it.y += dy; it.points = it.points.map(p => [p[0] + dx, p[1] + dy]);
        view.setItems(S.items); view.draw();
        nudgeSave(it);
        return;
      }
      if (k === 'f' || k === 'F') { if (S.globe) S.globe.reset(); else { view.fit(); saveView(); } return; }
      if (k === '+' || k === '=') return zoomBy(1.3);
      if (k === '-' || k === '_') return zoomBy(1 / 1.3);
      if (k === ',' || k === '.') { if (!timeBar.hidden) setDay(S.day + (k === ',' ? -1 : 1) * WB.cal.avgYear); return; }
      const tool = TOOLS.find(t => t[3].toLowerCase() === k.toLowerCase());
      if (tool) setTool(tool[0]);
    };
    const nudgeSave = WB.debounce(it => put({ id: it.id, x: it.x, y: it.y, points: it.points }), 400);
    const onKeyUp = e => { if (e.key === ' ') { spaceDown = false; canvas.style.cursor = ''; } };
    document.addEventListener('keydown', onKey);
    document.addEventListener('keyup', onKeyUp);
    subs.push(() => { document.removeEventListener('keydown', onKey); document.removeEventListener('keyup', onKeyUp); });

    /* ---------- globe ---------- */
    async function setMode(m) {
      if (!S.map) return;
      const md = Object.assign({}, P.mode); md[S.map.id] = m; P.mode = md; store.patch({ mode: md });
      S.mode = m;
      if (m === 'globe') await showGlobe(); else hideGlobe();
      paintHead(); paintTools(); paintLegend(); paintTime();
    }
    async function showGlobe() {
      await loadExtra('globe');
      if (S.globe) S.globe.destroy();
      stageInner.classList.add('globe');
      S.globe = WB.atlasGlobe.create(stageInner, {
        data: S.data, img: S.img, base: () => view.baseCanvas, items: () => S.items, view,
        onPick: (it, ev) => { if (ro()) cardFor(it, ev); else select(it.id); },
        onOpen: it => { if (it.subMapId) openMap(it.subMapId); else if (it.entryId) WB.peek(it.entryId); },
        onCoords: t => { coords.textContent = t || ''; },
        onFlat: (mx, my) => { setMode('flat').then(() => view.centerOn(mx, my, view.fitK() * 3)); },
      });
    }
    function hideGlobe() { if (S.globe) { S.globe.destroy(); S.globe = null; } stageInner.classList.remove('globe'); requestAnimationFrame(() => { view.measure(); view.draw(); }); }

    /* ---------- export ---------- */
    async function exportPNG(whole) {
      const c = document.createElement('canvas');
      const v2 = V().create(c, { day: view.opt.day, allTimes: view.opt.allTimes, filter: view.opt.filter, graticule: view.opt.graticule });
      v2.setMap(S.data, S.img); v2.setItems(S.items);
      v2.baseCanvas = view.baseCanvas; v2.under = view.under; v2.mid = view.mid; v2.opt.regionFill = view.opt.regionFill; v2.opt.pinDim = view.opt.pinDim;
      let w, hh, scale;
      if (whole) {
        const maxSide = 6000, f = Math.min(1, maxSide / Math.max(S.data.width, S.data.height)) * Math.max(1, Math.min(2, 2400 / Math.max(S.data.width, S.data.height)));
        w = Math.round(S.data.width * f); hh = Math.round(S.data.height * f);
        v2.size(w, hh, 1, Math.max(1, w / 1400));
        v2.t = { k: f, x: 0, y: 0 };
      } else {
        scale = 2; w = view.w; hh = view.h;
        v2.size(w, hh, scale, view.ui);
        v2.t = Object.assign({}, view.t);
        v2.opt.background = '#1b2430';
      }
      v2.render();
      const blob = await new Promise(r => c.toBlob(r, 'image/png'));
      if (!blob) return ui.toast('The image could not be made', '⚠');
      const name = S.map.title + (whole ? '' : ' (view)') + ' — ' + WB.fmt.date({ day: S.day, prec: 'year' }) + '.png';
      const m = await WB.api('media.save', WB.worldId, { name, mime: 'image/png', bytes: new Uint8Array(await blob.arrayBuffer()), tags: ['map export'] });
      const host = document.querySelector('.gk-toasts') || document.body.appendChild(h('div.gk-toasts'));
      const t = host.appendChild(h('div.gk-toast.gk-widget.gk-nolens.wb-undo', [h('span', { text: '⤓' }), h('span.gk-grow', { text: 'Saved “' + m.name + '” in the Library' }),
        ui.button({ label: 'Show in folder', small: true, onClick: () => { WB.api('media.reveal', m.id); t.remove(); } }), ui.button({ label: 'Library', small: true, kind: 'ghost', onClick: () => { WB.go('library', { mediaId: m.id }); t.remove(); } })]));
      setTimeout(() => { t.classList.add('out'); setTimeout(() => t.remove(), 300); }, 9000);
      return m;
    }
    S.exportPNG = exportPNG;
    S.act = { select, openMap, showGallery, setDay, setMode, setTool, historyAt, focusItem, toggleSide, newMap: newMapDialog, refreshAll, paintSide, cardFor };

    /* ---------- painting everything ---------- */
    function paintAll() { paintHead(); paintSide(); paintTools(); paintInspector(); paintLegend(); paintTime(); paintMeasure(); PN.banner(); T.paintOptions(optsBar); body.classList.toggle('side-closed', !P.sideOpen); }
    async function refreshAll() {
      await loadMaps();
      if (S.map) {
        if (!S.maps.find(m => m.id === S.map.id)) return showGallery();
        await openMap(S.map.id, { keepView: true });
      } else showGallery();
    }

    subs.push(GK.bus.on('layout', () => { if (S.map && !S.gallery) { view.measure(); view.draw(); paintScale(); paintLegend(); } }));
    subs.push(WB.onChange(['map_items'], p => { if (!S.map) return; const mine = (p.ids || []).length && (p.ids || []).every(id => S.savingIds.has(id) || id === S.map.id); if (!mine) reloadItems(); }));
    subs.push(WB.onChange(['entries', 'media'], async p => { if (S.map && Date.now() < (S.quietUntil || 0) && (p.ids || []).length === 1 && p.ids[0] === S.map.id) return; if (!S.map) { await loadMaps(); if (S.gallery) showGallery(); return; } if ((p.ids || []).includes(S.map.id)) { const r = await WB.api('atlas.map', S.map.id).catch(() => null); if (!r || r.entry.deletedAt) return refreshAll(); } await loadMaps(); reloadItems(); paintHead(); }, 200));
    subs.push(WB.on('share', () => { select(null); refreshAll(); }));
    // another world: start over; the same world edited (its date, its settings): just refresh
    const mountedWorld = WB.worldId;
    subs.push(WB.on('world', () => { if (live !== S) return; if (WB.worldId !== mountedWorld) GK.shell.go('atlas'); else if (S.map) { paintTime(); paintInspector(); } }));
    subs.push(() => { if (S.globe) S.globe.destroy(); });
    const ro2 = new ResizeObserver(() => { if (S.map && !S.gallery && view.measure()) { view.draw(); paintLegend(); } });
    ro2.observe(canvas);
    subs.push(() => ro2.disconnect());

    /* ---------- start ---------- */
    await loadMaps();
    let start = params.mapId || null, startItem = params.itemId || null;
    if (params.entryId) {
      const e = WB.liteOf(params.entryId) || await WB.api('entries.lite', params.entryId).catch(() => null);
      if (e && typeKeyOf(e) === 'map') start = e.id;
      else if (e) { const ap = await WB.api('atlas.appearances', e.id).catch(() => []); if (ap[0]) { start = ap[0].map.id; startItem = ap[0].item.id; } else ui.toast('“' + e.title + '” is not on a map yet — open a map and drag it on', 'ℹ'); }
    }
    if (!start && !params.gallery) start = P.mapId && S.maps.find(m => m.id === P.mapId) ? P.mapId : null;
    if (start && S.maps.find(m => m.id === start)) await openMap(start, { itemId: startItem, mode: params.mode });
    else showGallery();
    return cleanup;
  }

  GK.modules.register({
    id: 'atlas',
    title: 'Atlas',
    icon: '⌖',
    order: 40,
    heading: false,
    subtitle: 'Maps and planets, borders through time, routes and settlements.',
    mount,
  });
})();
