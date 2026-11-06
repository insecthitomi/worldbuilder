/* Atlas terrain generator dialog. The engine lives in field.js (seeded plates and ridges, erosion, climate bands,
   Whittaker biomes, drainage with lakes and rivers, deposits, settlement sites and roads) and render.js paints it.
   This file is the dialog: knobs with a live preview, then it renders the picture, stores the compact terrain
   field in the map entry (so it can be painted on afterwards) and, if asked, pins settlements and lays roads. */
(function (root) {
  'use strict';
  const GK = root.GK, WB = root.WB, F = root.WBField, R = root.WBAtlasRender, h = GK.h, ui = GK.ui;
  const addTo = (el, ...kids) => GK.append(el, kids);
  const { MODES, LAND, SPAN_MILES, DEF } = F;
  const SIZES = { S: 1024, M: 1600, L: 2048, XL: 3072 };
  const norm = F.norm;
  const dims = s => { const W = SIZES[s.size] || 1600; return { width: W, height: s.mode === 'planet' ? W / 2 : Math.round(W * .625) }; };

  /** paint the whole field into a canvas of W × H (rows in slices so the window stays alive) */
  async function paintCanvas(f, mode, style, W, H, onProgress) {
    const c = document.createElement('canvas');
    c.width = W; c.height = H;
    const g = c.getContext('2d'), img = g.createImageData(W, H);
    const rows = Math.max(16, Math.round(400000 / W));
    for (let y = 0; y < H; y += rows) {
      R.paint(f, mode, W, H, img.data, 0, y, W, Math.min(H, y + rows), style);
      if (onProgress) { onProgress({ stage: 'Painting', p: .55 + .4 * y / H }); await tick(); }
    }
    g.putImageData(img, 0, 0);
    R.drawRivers(g, f, W, H, mode, style);
    return c;
  }
  const tick = () => new Promise(res => { const ch = new MessageChannel(); ch.port1.onmessage = () => res(); ch.port2.postMessage(0); });
  /** synchronous render (previews, smoke steps): { canvas, width, height, stats, field } */
  function render(s) {
    const W = s.width || 400, H = s.height || Math.round(W * (s.mode === 'planet' ? .5 : .625));
    const f = F.generate(Object.assign({}, s, s.w ? {} : { w: Math.min(256, Math.max(48, Math.round(W / 4))), h: Math.min(160, Math.max(24, Math.round(H / 4))) }), W, H);
    const c = document.createElement('canvas');
    c.width = W; c.height = H;
    const g = c.getContext('2d'), img = g.createImageData(W, H);
    R.paint(f, 'terrain', W, H, img.data, 0, 0, W, H, s.style === 'natural' ? 'natural' : s.style);
    g.putImageData(img, 0, 0);
    R.drawRivers(g, f, W, H, 'terrain', s.style);
    return { canvas: c, width: W, height: H, stats: f.stats, field: f };
  }
  async function renderAsync(s, onProgress) {
    const W = s.width, H = s.height;
    onProgress && onProgress({ stage: 'Raising the land', p: .1 });
    await tick();
    const f = F.generate(s, W, H);
    onProgress && onProgress({ stage: 'Letting the rain run off', p: .5 });
    await tick();
    const canvas = await paintCanvas(f, 'terrain', s.style, W, H, onProgress);
    return { canvas, width: W, height: H, stats: f.stats, field: f };
  }
  const SIZE_ICON = { 3: 'city', 2: 'town', 1: 'village' };
  /** pins for the generated settlement sites and paths for the roads between them */
  function siteItems(mapId, f) {
    const sites = (f.extra && f.extra.sites) || [], roads = (f.extra && f.extra.roads) || [];
    const save = sites.map(st => ({ mapId, kind: 'pin', label: st.name, x: st.x, y: st.y, style: { icon: st.why === 'port' && st.size > 1 ? 'port' : SIZE_ICON[st.size] || 'village', size: st.size === 3 ? 1.3 : 1 } }));
    for (const r of roads) save.push({ mapId, kind: 'path', label: '', points: r.pts, style: { kind: 'road' } });
    return save;
  }

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
        const r = render(Object.assign({}, s, { width: Math.round(W * k), height: Math.round(H * k), w: quick ? 72 : 144, h: quick ? (s.mode === 'planet' ? 36 : 45) : (s.mode === 'planet' ? 72 : 90), sites: 0, deposits: 0 }));
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
          ui.field({ label: 'Shape', control: ui.select({ value: s.mode, options: MODES.map(m => [m[0], m[1] + ' — ' + m[2]]), onChange: v => { s.mode = v; s.land = LAND[v]; paintKnobs(); later(); } }) }),
          ui.field({ label: 'Seed', hint: 'The same seed and settings always make the same map.', control: h('div.gk-row.nowrap', [h('div.gk-grow', [seedIn]), ui.button({ label: 'Re-roll', icon: '🎲', onClick: () => reroll() })]) }),
          h('div.wb-tg-two', [slider('land', 'Land', 'How much of the map is land'), slider('sea', 'Sea level', 'Raise to drown coasts and make islands', v => (v < .5 ? '−' : '+') + Math.round(Math.abs(v - .5) * 200) + '%')]),
          h('div.wb-tg-two', [slider('rough', 'Roughness', 'Smooth shores ↔ ragged fjords'), slider('ridges', 'Mountain ridges', 'Chains of mountains where plates collide')]),
          h('div.wb-tg-two', [slider('erosion', 'Erosion', 'Weathering and river valleys carved over time'), slider('relief', 'Relief shading')]),
          h('div.wb-tg-two', [slider('temp', 'Temperature', 'Ice and tundra ↔ deserts and jungle', v => (v < .35 ? 'cold' : v > .65 ? 'hot' : 'temperate') + ' ' + Math.round(v * 100)), slider('moist', 'Rainfall', 'Deserts and steppe ↔ forest and swamp')]),
          h('div.wb-tg-two', [slider('rivers', 'Rivers'), slider('deposits', 'Resource deposits', 'Ore, timber, grain and fish seeded where the ground suits them')]),
          h('div.wb-tg-two', [ui.field({ label: 'Settlement sites', hint: 'Pins placed where towns would grow: fertile, by water', control: ui.slider({ min: 0, max: 40, step: 1, value: s.sites, format: v => (v ? v + ' pins' : 'none'), onInput: v => { s.sites = v; paintKnobs(); } }) }),
            s.sites > 0 ? ui.field({ label: 'Roads between them', inline: true, control: ui.toggle({ value: !!s.roads, onChange: v => { s.roads = v; } }) }) : ui.field({ label: 'Style', control: ui.select({ value: s.style, options: [['natural', 'Natural atlas'], ['parchment', 'Old parchment'], ['pale', 'Pale (for borders)']], onChange: v => { s.style = v; later(); } }) })]),
          s.sites > 0 ? ui.field({ label: 'Style', control: ui.select({ value: s.style, options: [['natural', 'Natural atlas'], ['parchment', 'Old parchment'], ['pale', 'Pale (for borders)']], onChange: v => { s.style = v; later(); } }) }) : null,
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
          const title = name.trim() || ({ planet: 'New world', continent: 'New continent', twin: 'The two lands', archipelago: 'The isles', island: 'The island', inland: 'The inland sea', highlands: 'The highlands', region: 'New region' })[s.mode];
          const media = await WB.api('media.save', WB.worldId, { name: title + '.png', mime: 'image/png', bytes: new Uint8Array(await blob.arrayBuffer()), tags: ['map', 'generated'] });
          const unit = (WB.world.settings && WB.world.settings.mapUnit) || 'miles';
          const gen = Object.assign({}, s); delete gen.w; delete gen.h;
          const data = { image: media.id, width: d.width, height: d.height, gen, terrain: F.encode(r.field), deposits: r.field.deposits || [], paint: null, stamps: [] };
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
          const extra = siteItems(entry.id, r.field);
          if (extra.length) await WB.api('atlas.bulk', { save: extra });
          finish(entry);
          ui.toast(opts.replaceMapId ? 'New terrain on “' + entry.title + '”' : '“' + entry.title + '” is ready', '⛰');
          WB.go('atlas', { mapId: entry.id });
        } catch (e) { WB.fail(e); createBtn.disabled = false; progress.hidden = true; }
      };
      const panel = ui.panel({ title: opts.replaceMapId ? 'Generate terrain for this map' : 'Generate terrain', icon: '⛰', cls: 'gk-dialog wb-tg', body: [
        h('div.wb-tg-main', [h('div.wb-tg-left', [h('div.wb-tg-preview', [preview, ui.button({ label: 'Re-roll', icon: '🎲', small: true, title: 'A new seed, same settings (R)', onClick: () => reroll() })]), stat,
          h('p.gk-tiny.gk-faint', { text: 'The preview is small; the map is rendered at full size when you create it. The terrain stays editable: raise mountains, paint biomes and draw rivers afterwards in the Atlas toolbox.' })]), knobs]),
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

  WB.atlasTerrain = { open, render, renderAsync, generate: F.generate, noise3: F.noise3, MODES, DEF, siteItems };
})(window);
