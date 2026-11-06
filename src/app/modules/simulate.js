/* Simulate: trade routes and resource gathering, driven by the rules and customs you write.
   Engine: src/shared/sim.js (pure, seeded). Pictures: simulate/draw.js. Editors: simulate/edit.js.
   Data: the chosen Map entry's data.sim = { v, config, seed, ticks, recorded, result }, or a Note entry made for a hand-built network.
   data.sim.result = { day, nodes:[{ itemId, entryId, x, y, population, wealth, surplus, shortage }], flows:[{ fromItemId, toItemId, routeItemId, resource, amount }], resources:[{ name, color }] }
   is what the Atlas "Economy" view reads. */
(function () {
  'use strict';
  const { h, ui } = GK, U = WB.ui;
  const S = WB.sim = WB.sim || {};
  const BASE = 'src/app/modules/simulate/';
  const loadAll = () => S._load || (S._load = Promise.all([WB.loadScript('src/shared/sim.js'), WB.loadScript('src/main/lib/atlas-geo.js'), WB.loadScript(BASE + 'draw.js'), WB.loadScript(BASE + 'edit.js')]));
  WB.loadStyle('src/app/modules/simulate.css');
  const W = () => window.WBSim;
  const TABS = [['run', '▶', 'Run'], ['goods', '◇', 'Goods'], ['nodes', '⌂', 'Settlements'], ['routes', '⇄', 'Routes'], ['rules', '§', 'Rules'], ['compare', '⚖', 'Compare'], ['world', '⚙', 'Settings']];
  const KIND = { raid: ['⚔', 'Raids', 'Crime'], famine: ['☠', 'Famine', 'Disaster'], shortage: ['▽', 'Shortages', 'Disaster'], embargo: ['⛔', 'Bans', 'Treaty'], price: ['△', 'Price spikes', 'Disaster'], route: ['⇄', 'Roads', 'Migration'], rule: ['§', 'Customs', 'Festival'], depleted: ['◌', 'Exhausted', 'Disaster'] };
  const LAST_KEY = 'sim.last';
  const clamp = (v, a, b) => Math.max(a, Math.min(b, v));

  GK.modules.register({
    id: 'simulate',
    title: 'Simulate',
    icon: '⇄',
    nav: true,
    order: 45,
    subtitle: 'Trade routes, gathering and rationing, run under the laws and customs you set.',
    async mount(page, ctx) {
      page.classList.add('sm-page');
      if (!WB.worldId) { page.appendChild(U.empty({ icon: '⇄', title: 'Open a world to simulate its trade', text: 'The simulation reads your maps and settlements.', actions: [ui.button({ label: 'Create a world', kind: 'primary', onClick: () => WB.newWorld() })] })); return; }
      if (WB.share) { page.appendChild(U.empty({ icon: '◑', title: 'Simulation is for the author', text: 'It works from private map pins and notes.', actions: [ui.button({ label: 'Leave Share view', kind: 'primary', onClick: () => WB.setShare(false) })] })); return; }
      await loadAll();
      const params = WB.params('simulate') || {};
      const store = await (WB.store ? WB.store(ctx, { last: {}, hand: {}, tab: 'run' }) : ctx.store({ last: {}, hand: {}, tab: 'run' }));
      const host = h('div.sm-host');
      page.appendChild(host);

      /* ---------------- state ---------------- */
      let src = null, sim = null, eng = null, mapData = null, img = null, tab = store.get().tab || 'run';
      let scrub = 0, playing = false, timer = 0, saving = false, dead = false;
      const V = { mode: 'pressure', chart: 'price', scope: '*', res: '', speed: 4, kinds: {}, sel: null };
      const uiState = {};
      let net = null, chart = null, body = null, bar = null, runRefs = null;

      const save = WB.debounce(async () => {
        if (!src || !sim || dead) return;
        saving = true;
        try {
          sim.ticks = eng ? eng.tick : 0;
          if (eng && eng.tick > 0) sim.result = W().atlasResult(eng); else delete sim.result;
          await WB.api('entries.update', src.id, { dataPatch: { sim } });
        } catch (e) { WB.fail(e); } finally { setTimeout(() => { saving = false; }, 400); }
      }, 700);

      /* ---------------- sources: a map, or a hand-built network kept in a Note ---------------- */
      async function sources() {
        const maps = await WB.api('entries.list', WB.worldId, { typeKeys: ['map'], limit: 300 }).catch(() => []);
        const hand = [];
        for (const id of (store.get().hand[WB.worldId] || [])) { const e = await WB.api('entries.lite', id).catch(() => null); if (e && !e.deletedAt) hand.push(e); }
        return { maps: maps.filter(WB.visible), hand };
      }
      async function loadSource(id, opts = {}) {
        pause();
        net && net.destroy(); chart && chart.destroy(); net = chart = null;
        const e = id ? await WB.api('entries.get', id).catch(() => null) : null;
        src = e; sim = null; eng = null; mapData = null; img = null; V.sel = null;
        if (e) {
          const last = Object.assign({}, store.get().last); last[WB.worldId] = e.id; store.patch({ last });
          const t = WB.typeOf(e);
          if (t && t.key === 'map') { mapData = window.WBGeo.mapData(e.data || {}, WB.world.settings); if (mapData.image) { WB.mediaUrl(mapData.image).then(u => { if (u && src === e) { img = new Image(); img.onload = () => net && net.redraw(); img.src = u; } }); } }
          if (e.data && e.data.sim && e.data.sim.config) { sim = e.data.sim; sim.seed = sim.seed || 'seed'; rebuild(sim.ticks || 0, true); }
          else if (opts.preset) await startPreset(opts.preset, opts.steps);
        }
        paintAll();
      }

      /* ---------------- building a simulation ---------------- */
      function worldCal() {
        const c = WB.cal; if (!c) return null;
        try {
          const day = WB.now.day, y = c.ymd(day).y, start = c.startOfYear(y), len = c.yearLength(y), seasons = []; let last = null;
          for (let d = 0; d < len; d++) { const nm = c.season(start + d); if (nm && nm !== last) { seasons.push({ name: nm, from: d }); last = nm; } }
          return { yearDays: len, offset: day - start, seasons: seasons.length ? seasons : undefined };
        } catch { return null; }
      }
      function useWorldCalendar() { const c = worldCal(); if (!c || !sim) return; sim.config.calendar = c; sim.config.startDay = WB.now.day; changed('world'); }
      function fresh(cfg, seedWord) {
        sim = { v: 1, config: cfg, seed: seedWord || Math.random().toString(36).slice(2, 7), ticks: 0, recorded: [] };
        cfg.startDay = WB.now ? WB.now.day : 0;
        if (!cfg.calendar || cfg.calendar.generic) cfg.calendar = worldCal() || cfg.calendar;
        rebuild(0);
      }
      async function startPreset(id, steps) {
        const cfg = W().presetConfig(id); if (!cfg) return;
        fresh(cfg, 'seed1');
        if (steps) { W().step(eng, steps); sim.ticks = eng.tick; scrub = eng.hist.days.length - 1; }
        save();
      }
      async function importMap(first) {
        if (!src || !mapData) return;
        const items = await WB.api('atlas.items', src.id).catch(() => []);
        const pins = items.filter(i => i.kind === 'pin' && i.entryId);
        const ents = {};
        await Promise.all(pins.slice(0, 150).map(i => WB.api('entries.get', i.entryId).then(e => { ents[i.entryId] = e; }).catch(() => null)));
        let skipped = 0;
        const input = {
          width: mapData.width, height: mapData.height, unitsPerPx: mapData.unitsPerPx, unit: mapData.unit, modes: window.WBGeo.travelModes(mapData, WB.world.settings),
          items: items.filter(i => {
            if (i.kind !== 'pin') return true;
            const e = ents[i.entryId], t = e && WB.typeOf(e);
            if (!e || !t || t.key !== 'place') { skipped++; return false; }
            return true;
          }).map(i => {
            const e = ents[i.entryId], f = (e && e.fields) || {};
            return { id: i.id, kind: i.kind, entryId: i.entryId, label: i.label, x: i.x, y: i.y, points: i.points, style: i.style, title: (i.entry && i.entry.title) || i.label, icon: i.style && i.style.icon,
              population: +f.population || 0, climate: f.climate || '', economy: f.economy || '', kind2: f.kind || '' };
          }),
        };
        const built = W().buildFromMap(input);
        if (!built.nodes.length) { ui.toast('No pins on this map link to Place entries yet. Pin places in the Atlas first, or start from a preset.', 'ℹ', 5200); return false; }
        const cfg = sim ? sim.config : { name: src.title + ' economy', step: 'week', resources: [], nodes: [], routes: [], rules: [] };
        const oldN = {}; for (const n of cfg.nodes) oldN[n.id] = n;
        const nodes = cfg.nodes.filter(n => !n.fromMap), seen = new Set();
        for (const b of built.nodes) {
          const o = oldN[b.id]; seen.add(b.id);
          if (o) { Object.assign(o, { name: b.name, x: b.x, y: b.y, entryId: b.entryId, fromMap: true }); if (!(o.terrain || []).length) o.terrain = b.terrain; if (b.pop && b.pop !== o.pop && input.items.some(i => i.id === b.id && i.population)) o.pop = b.pop; nodes.push(o); }
          else nodes.push(Object.assign(b, { fromMap: true, producers: [], consumers: [], recipes: [] }));
        }
        cfg.nodes = nodes;
        const oldR = {}; for (const r of cfg.routes) oldR[r.id] = r;
        const routes = cfg.routes.filter(r => !r.fromMap && nodes.some(n => n.id === r.a) && nodes.some(n => n.id === r.b));
        for (const b of built.routes) { const o = oldR[b.id]; if (o) { Object.assign(o, { a: b.a, b: b.b, distance: b.distance, itemId: b.itemId, fromMap: true }); routes.push(o); } else routes.push(Object.assign(b, { fromMap: true })); }
        cfg.routes = routes;
        cfg.modes = input.modes.map(m => ({ mode: m.mode, label: m.label, perDay: m.perDay }));
        cfg.unit = built.unit;
        if (!cfg.resources.length) cfg.resources = JSON.parse(JSON.stringify(W().MEDIEVAL_RES.map(r => Object.assign({ id: W().slug(r.name) }, r))));
        const filled = W().autoFill(cfg); cfg.nodes = filled.nodes;
        if (!sim) { fresh(cfg, 'seed1'); } else changed('node');
        ui.toast('Imported ' + built.nodes.length + ' settlements and ' + built.routes.length + ' routes' + (skipped ? ' (' + skipped + ' pins skipped: not Place entries)' : ''), '⌖', 4200);
        if (!mapData.unitsPerPx) ui.toast('This map has no scale yet, so distances assume it is 1000 ' + mapData.unit + ' wide. Set the scale in the Atlas for true travel times.', 'ℹ', 6000);
        if (first) paintAll(); else paintBody();
        return true;
      }

      /* ---------------- running ---------------- */
      function rebuild(keep, quiet) {
        pause();
        eng = W().createState(sim.config, sim.seed);
        try { W().step(eng, clamp(keep == null ? sim.ticks || 0 : keep, 0, 1500)); } catch (e) { WB.fail(e); }
        sim.ticks = eng.tick; scrub = eng.hist.days.length - 1;
        if (!quiet) { refresh(); save(); }
      }
      const rebuildSoon = WB.debounce(() => { rebuild(); if (tab !== 'run') paintBar(); }, 350);
      function changed(kind, light) {
        if (!sim) return;
        if (light) { net && net.redraw(); chart && chart.redraw(); save(); return; }
        pause(); rebuildSoon();
      }
      function advance(n) {
        if (!eng) return;
        W().step(eng, n); sim.ticks = eng.tick; scrub = eng.hist.days.length - 1;
        refresh(); save();
      }
      function pause() { playing = false; clearTimeout(timer); timer = 0; net && net.animate(false); syncPlay(); }
      function play() {
        if (playing || !eng) return;
        playing = true; net && net.animate(true); syncPlay();
        const loop = () => {
          if (!playing) return;
          if (eng.tick >= 1500) { pause(); return ui.toast('That is 1500 steps: reset to start over', 'ℹ'); }
          W().step(eng, Math.max(1, Math.round(V.speed / 8)));
          sim.ticks = eng.tick; scrub = eng.hist.days.length - 1;
          refresh();
          timer = setTimeout(loop, 1000 / Math.min(V.speed, 8));
        };
        loop();
      }
      function syncPlay() { if (runRefs && runRefs.play) { runRefs.play.textContent = playing ? '⏸' : '▶'; runRefs.play.title = playing ? 'Pause' : 'Run'; } if (!playing) save(); }

      /* ---------------- what a step looks like at a scrub position ---------------- */
      const cfgN = () => (eng ? eng.config : W().normalize(sim.config));
      const dateText = (day, prec) => {
        const c = eng && eng.config;
        if (WB.cal && c && c.startDay != null) { try { return WB.fmt.date({ day: c.startDay + day, prec: prec || 'day' }); } catch { /* fall through */ } }
        return 'day ' + Math.round(day);
      };
      S.dateText = dateText;
      function needRes(n) {
        const out = new Set();
        for (const c of n.consumers) { if (c.kind !== 'need') continue; if (c.res.charAt(0) === '@') { for (const r of cfgN().resources) if (r.category === c.res.slice(1)) out.add(r.id); } else out.add(c.res); }
        return [...out];
      }
      function pressure(n, i) {
        const e = eng.hist.n[n.id]; if (!e) return 0;
        let worst = 1;
        for (const id of needRes(n)) { const p = e.price[id] && e.price[id][i], r = eng.res[id]; if (p != null && r) worst = Math.max(worst, p / r.value); }
        return clamp((worst - 1) / 3, 0, 1);
      }
      function snapshot() {
        if (!eng || !sim) return null;
        const c = eng.config, i = clamp(scrub, 0, eng.hist.days.length - 1);
        const wTicks = Math.max(1, Math.round(30 / c.stepDays));
        const flows = W().flowsBetween(eng, i - wTicks + 1, i + 1);
        const maxPop = Math.max(1, ...c.nodes.map(n => (eng.hist.n[n.id] ? eng.hist.n[n.id].pop[i] : n.pop) || 1));
        const maxWealth = Math.max(1, ...c.nodes.map(n => (eng.hist.n[n.id] ? eng.hist.n[n.id].wealth[i] : 0) || 0));
        const season = W().seasonAt(c.calendar, eng.hist.days[i] || 0);
        const nodes = c.nodes.map(n => {
          const e = eng.hist.n[n.id], pop = e ? e.pop[i] : n.pop, wealth = e ? e.wealth[i] : n.wealth, p = pressure(n, i);
          const color = V.mode === 'pressure' ? S.heat(p) : V.mode === 'wealth' ? 'hsl(42 78% ' + Math.round(26 + 36 * Math.sqrt(wealth / maxWealth)) + '%)' : 'hsl(205 70% ' + Math.round(26 + 36 * Math.sqrt(pop / maxPop)) + '%)';
          return { id: n.id, name: n.name, x: n.x, y: n.y, r: 6 + 13 * Math.sqrt(pop / maxPop), color, ring: p > 0.6, label: V.mode === 'wealth' ? Math.round(wealth).toLocaleString() + ' coins' : V.mode === 'pop' ? Math.round(pop).toLocaleString() + ' people' : '' };
        });
        const bulk = f => f.amount * eng.res[f.res].bulk;
        const agg = {};
        for (const f of flows) { const k = f.route + '|' + f.from; const a = agg[k] || (agg[k] = { route: f.route, from: f.from, bulk: 0, best: null, bestV: 0 }); a.bulk += bulk(f); const v = f.amount * eng.res[f.res].value; if (v > a.bestV) { a.bestV = v; a.best = f.res; } }
        const maxB = Math.max(1e-9, ...Object.values(agg).map(a => a.bulk));
        const links = c.routes.map(r => ({ a: r.a, b: r.b, open: eng.routeOpen[r.id] !== false && !(r.closed.includes(season.name.toLowerCase()) || r.closed.includes(season.cls)),
          flows: Object.values(agg).filter(a => a.route === r.id).map(a => ({ from: a.from, width: 2 + 11 * Math.sqrt(a.bulk / maxB), color: eng.res[a.best].color })) }));
        return { nodes, links, selected: V.sel, bg: sim.config.nodes.some(n => n.fromMap) && mapData ? { img, w: mapData.width, h: mapData.height } : null };
      }

      /* ---------------- painting ---------------- */
      function paintAll() {
        GK.clear(host); net && net.destroy(); chart && chart.destroy(); net = chart = null;
        bar = h('div.sm-bar'); body = h('div.sm-body');
        host.append(bar, body);
        paintBar(); paintBody();
      }
      function paintBar() {
        GK.clear(bar);
        const srcSel = h('select.gk-input.gk-control.sm-src', { onchange: async e => { const v = e.target.value; if (v === '+hand') { await newHand(); } else if (v) await loadSource(v); } });
        sources().then(({ maps, hand }) => {
          if (dead) return;
          srcSel.append(h('option', { value: '', text: src ? '—' : 'Choose a map or a network…' }));
          if (maps.length) srcSel.append(h('optgroup', { label: 'Maps' }, maps.map(m => h('option', { value: m.id, text: m.title }))));
          if (hand.length) srcSel.append(h('optgroup', { label: 'Hand-built networks' }, hand.map(m => h('option', { value: m.id, text: m.title.replace(/^Simulation:\s*/, '') }))));
          srcSel.append(h('option', { value: '+hand', text: '＋ New hand-built network (no map)…' }));
          srcSel.value = src ? src.id : '';
        });
        bar.append(h('label.sm-src-wrap', [h('span.gk-small.gk-muted', { text: 'Map' }), srcSel]));
        if (sim) bar.append(ui.segmented({ value: tab, options: TABS.map(([id, ic, l]) => [id, ic + '  ' + l]), onChange: v => { tab = v; store.patch({ tab: v }); paintBody(); } }));
      }
      function paintBody() {
        if (!body) return;
        net && net.destroy(); chart && chart.destroy(); net = chart = null; runRefs = null;
        GK.clear(body);
        if (!src && !sim) return paintStart();
        if (!sim) return paintStart();
        const env = { cfg: () => sim.config, changed, redraw: paintBody, seed: () => sim.seed, setSeed: v => { sim.seed = v || 'seed'; changed('seed'); }, ui: uiState, hasMap: !!mapData && sim.config.nodes.some(n => n.fromMap), unit: sim.config.unit, importMap: () => importMap(), useWorldCalendar };
        const pane = h('div.sm-pane');
        if (tab === 'run') return paintRun();
        body.append(pane);
        ({ goods: S.editGoods, nodes: S.editNodes, routes: S.editRoutes, rules: S.editRules, compare: S.editCompare, world: S.editWorld }[tab] || S.editGoods)(pane, env);
      }
      function paintStart() {
        const box = h('div.sm-start');
        const mapCard = src && mapData ? ui.panel({ title: 'Use “' + src.title + '”', icon: '⌖', body: [
          h('p.gk-text', { text: 'Pins that link to Place entries become settlements; paths become routes (travel time from the map’s scale and travel modes). Goods, what each place makes and needs, and workshops are filled in from terrain and population; you can edit all of it.' }),
          h('div.gk-row', [ui.button({ label: 'Import settlements & routes', icon: '⌖', kind: 'primary', onClick: () => importMap(true) })]),
        ] }) : null;
        box.append(h('div.sm-intro', [h('h2', { text: 'Trade and resources, run by the rules of your world' }), h('p.gk-muted', { text: 'Settlements gather, make, eat and trade along routes; prices follow supply and demand. Add laws and customs (embargoes, tariffs, tithes, festivals, rationing, sacred goods) and watch what they do.' })]));
        if (!src) box.append(h('p.gk-muted', { text: 'Pick a map above to build on it, create a hand-built network, or start from one of these:' }));
        if (mapCard) box.append(mapCard);
        box.append(h('h3.sm-sub', { text: 'Start from a preset' }), h('div.sm-presets', W().PRESETS.map(p => h('button.sm-preset', { type: 'button', onclick: async () => { if (!src) await newHand(p.id); else await startPreset(p.id); paintAll(); } }, [h('b', { text: p.name }), h('span.gk-small.gk-muted', { text: p.desc })]))));
        body.append(box);
      }
      async function newHand(presetId, quietName) {
        const name = quietName || await ui.prompt('Name this network', presetId ? (W().PRESETS.find(p => p.id === presetId) || {}).name : 'My trade network', 'e.g. The Salt Road');
        if (!name) { paintBar(); return; }
        const e = await WB.api('entries.create', { worldId: WB.worldId, typeKey: 'note', title: 'Simulation: ' + name, summary: 'A hand-built trade and resource simulation. Open it in Simulate.', data: {} });
        const hand = Object.assign({}, store.get().hand); hand[WB.worldId] = (hand[WB.worldId] || []).concat([e.id]); store.patch({ hand });
        await loadSource(e.id, presetId ? { preset: presetId } : {});
        if (!presetId) { fresh({ name, step: 'week', resources: JSON.parse(JSON.stringify(W().MEDIEVAL_RES.map(r => Object.assign({ id: W().slug(r.name) }, r)))), nodes: [], routes: [], rules: [] }); tab = 'nodes'; paintAll(); }
      }

      /* ---------------- the Run tab ---------------- */
      function refresh() {
        if (!eng) return;
        if (net) net.redraw();
        if (chart) chart.redraw();
        if (runRefs) paintRunBits();
      }
      function paintRun() {
        const R = runRefs = {};
        const left = h('div.sm-col'), right = h('div.sm-col');
        const netBox = h('div.sm-net');
        R.date = h('span.sm-date'); R.range = h('input.sm-scrub', { type: 'range', min: 0, max: 0, value: 0, 'aria-label': 'Timeline' });
        R.range.addEventListener('input', () => { pause(); scrub = +R.range.value; refresh(); });
        R.play = ui.button({ icon: playing ? '⏸' : '▶', kind: 'primary', title: 'Run', onClick: () => (playing ? pause() : play()) });
        const speed = ui.segmented({ value: String(V.speed), options: [['1', '1×'], ['4', '4×'], ['8', '8×'], ['24', '24×']], onChange: v => { V.speed = +v; if (playing) { pause(); play(); } } });
        const stepSeg = ui.segmented({ value: sim.config.step || 'week', options: [['day', 'Day'], ['week', 'Week'], ['month', 'Month']], onChange: v => { sim.config.step = v; changed('world'); } });
        const modeSeg = ui.segmented({ value: V.mode, options: [['pressure', 'Prices'], ['wealth', 'Wealth'], ['pop', 'People']], onChange: v => { V.mode = v; net && net.redraw(); R.legend && paintLegend(); } });
        R.legend = h('div.sm-legend');
        left.append(ui.panel({ title: 'Network', icon: '⇄', actions: [modeSeg], cls: 'sm-netpanel', body: [netBox, R.legend,
          h('div.sm-transport', [
            ui.button({ icon: '⏮', title: 'Start over', small: true, onClick: () => { rebuild(0); } }), R.play,
            ui.button({ icon: '+1', title: 'One step', small: true, onClick: () => { pause(); advance(1); } }), ui.button({ label: '+10', small: true, title: 'Ten steps', onClick: () => { pause(); advance(10); } }), ui.button({ label: '+52', small: true, title: '52 steps', onClick: () => { pause(); advance(52); } }),
            speed, stepSeg, R.range, R.date,
          ])] }));
        net = S.netView(netBox, { snapshot, onSelect: id => { V.sel = id; net.redraw(); paintDetail(); }, tip: id => tipFor(id) });
        if (playing) net.animate(true);
        // charts
        const chartBox = h('div.sm-chart');
        R.chartCtl = h('div.sm-chartctl');
        right.append(ui.panel({ title: 'Charts', icon: '∿', body: [R.chartCtl, chartBox] }));
        chart = S.lineChart(chartBox, chartData);
        R.detail = h('div.sm-detail');
        right.append(ui.panel({ title: 'Settlement', icon: '⌂', body: R.detail }));
        R.log = h('div.sm-log');
        body.append(h('div.sm-run', [left, right]), ui.panel({ title: 'What happened', icon: '✷', cls: 'sm-logpanel', body: R.log }));
        paintRunBits(true);
      }
      function paintLegend() {
        const R = runRefs; if (!R || !R.legend) return;
        GK.clear(R.legend);
        if (V.mode === 'pressure') R.legend.append(h('span.gk-small.gk-muted', { text: 'Colour: how dear the essentials are' }), h('i.sm-ramp'), h('span.gk-small.gk-muted', { text: 'normal → scarce' }));
        else R.legend.append(h('span.gk-small.gk-muted', { text: V.mode === 'wealth' ? 'Size: people. Colour: coins held (paler = more)' : 'Size and colour: people' }));
        R.legend.append(h('span.gk-small.gk-muted', { text: 'Lines: goods carried (thicker = more, coloured by the most valuable good). Red ring: shortage. Dashed: route closed.' }));
      }
      function paintRunBits(first) {
        const R = runRefs, n = eng.hist.days.length;
        R.range.max = String(Math.max(0, n - 1)); R.range.value = String(clamp(scrub, 0, n - 1));
        const day = eng.hist.days[clamp(scrub, 0, n - 1)] || 0, se = W().seasonAt(eng.config.calendar, Math.max(0, day - (scrub > 0 ? 0 : 0)));
        R.date.textContent = (scrub === 0 && eng.tick === 0 ? 'Not run yet' : dateText(day)) + ' · ' + se.name + ' · step ' + clamp(scrub, 0, n - 1);
        if (first) { paintLegend(); paintChartCtl(); }
        paintDetail(); paintLog();
      }
      function chartData() {
        if (!eng) return { series: [], xs: [] };
        const h2 = eng.hist, c = eng.config, pal = W().PALETTE, xs = h2.days, cur = clamp(scrub, 0, xs.length - 1);
        let series = [];
        if (V.chart === 'wealth' || V.chart === 'pop') series = c.nodes.map((n, i) => ({ name: n.name, color: pal[i % pal.length], values: h2.n[n.id][V.chart] }));
        else if (V.scope === '*') { const rid = V.res || (c.resources[0] || {}).id; series = c.nodes.map((n, i) => ({ name: n.name, color: pal[i % pal.length], values: (h2.n[n.id][V.chart] || {})[rid] || [] })); }
        else {
          const e = h2.n[V.scope]; if (e) series = c.resources.filter(r => (e[V.chart][r.id] || []).some(v => v > 0.001)).map(r => ({ name: r.name, color: r.color, values: V.chart === 'price' ? e.price[r.id].map(v => v / r.value) : e.stock[r.id] }));
        }
        return { xs, series, cursor: cur, onCursor: i => { pause(); scrub = i; refresh(); }, label: d => dateText(d, 'month') };
      }
      function paintChartCtl() {
        const R = runRefs, c = eng.config; GK.clear(R.chartCtl);
        const resSel = ui.select({ value: V.res || (c.resources[0] || {}).id, options: c.resources.map(r => [r.id, r.name]), onChange: v => { V.res = v; chart.redraw(); } });
        const scopeSel = ui.select({ value: V.scope, options: [['*', 'Compare settlements']].concat(c.nodes.map(n => [n.id, n.name])), onChange: v => { V.scope = v; paintChartCtl(); chart.redraw(); } });
        R.chartCtl.append(ui.segmented({ value: V.chart, options: [['price', 'Prices'], ['stock', 'Stock'], ['wealth', 'Wealth'], ['pop', 'People']], onChange: v => { V.chart = v; paintChartCtl(); chart.redraw(); } }),
          V.chart === 'price' || V.chart === 'stock' ? h('div.gk-row.nowrap', [scopeSel, V.scope === '*' ? resSel : h('span.gk-small.gk-muted', { text: V.chart === 'price' ? 'as a multiple of base value' : 'units in stock' })]) : null);
      }
      function tipFor(id) {
        const c = eng.config, n = c.nodes.find(q => q.id === id), i = clamp(scrub, 0, eng.hist.days.length - 1), e = eng.hist.n[id];
        if (!n || !e) return [];
        let dear = null; for (const rid of needRes(n)) { const r = eng.res[rid], k = e.price[rid][i] / r.value; if (!dear || k > dear.k) dear = { k, r }; }
        return [h('b', { text: n.name }), h('div', { text: Math.round(e.pop[i]).toLocaleString() + ' people · ' + Math.round(e.wealth[i]).toLocaleString() + ' coins' }), dear ? h('div.gk-small', { text: 'Dearest need: ' + dear.r.name.toLowerCase() + ' ×' + (Math.round(dear.k * 10) / 10) }) : null];
      }
      function paintDetail() {
        const R = runRefs; if (!R || !R.detail) return; GK.clear(R.detail);
        const c = eng.config, n = c.nodes.find(q => q.id === V.sel);
        if (!n) { R.detail.append(h('p.gk-muted', { text: 'Click a settlement in the network to see its stock, prices and trade.' })); return; }
        const i = clamp(scrub, 0, eng.hist.days.length - 1), e = eng.hist.n[n.id], live = i === eng.hist.days.length - 1, ns = eng.nodes[n.id];
        const flows = W().flowsBetween(eng, i - Math.max(1, Math.round(30 / c.stepDays)) + 1, i + 1);
        const out = flows.filter(f => f.from === n.id), inn = flows.filter(f => f.to === n.id);
        const nameOf = id => (c.nodes.find(q => q.id === id) || {}).name;
        const rows = c.resources.filter(r => e.stock[r.id][i] > 0.05 || (live && ((ns.last.prod[r.id] || 0) > 0 || (ns.dem[r.id] || 0) > 0))).map(r => {
          const k = e.price[r.id][i] / r.value;
          return h('tr', [h('td', [h('i.sm-dot', { style: { background: r.color } }), r.name]), h('td.num', { text: S.fmtNum(e.stock[r.id][i]) }), h('td.num', { class: k > 2 ? 'sm-down' : k < 0.6 ? 'sm-up' : '', text: '×' + (Math.round(k * 100) / 100) }),
            h('td.num', { text: live && ns.last.prod[r.id] ? S.fmtNum(ns.last.prod[r.id] + 0) : '' }), h('td.num', { text: live && ns.last.cons[r.id] ? S.fmtNum(ns.last.cons[r.id]) : '' })]);
        });
        R.detail.append(h('div.sm-detail-head', [h('b', { text: n.name }), h('span.gk-muted', { text: Math.round(e.pop[i]).toLocaleString() + ' people · ' + Math.round(e.wealth[i]).toLocaleString() + ' coins' + (n.faction ? ' · ' + n.faction : '') }),
          n.entryId ? ui.button({ label: 'Open', icon: '↗', small: true, onClick: () => WB.open(n.entryId) }) : null]),
          h('div.sm-tbl-wrap', h('table.sm-tbl.sm-tight', [h('thead', h('tr', ['Good', 'Stock', 'Price', 'Made/day', 'Used/day'].map(t => h('th', { text: t })))), h('tbody', rows)])),
          out.length ? h('p.gk-small', { text: 'Sends: ' + out.slice(0, 5).map(f => eng.res[f.res].name.toLowerCase() + ' ' + Math.round(f.amount) + ' to ' + nameOf(f.to)).join('; ') }) : null,
          inn.length ? h('p.gk-small', { text: 'Receives: ' + inn.slice(0, 5).map(f => eng.res[f.res].name.toLowerCase() + ' ' + Math.round(f.amount) + ' from ' + nameOf(f.from)).join('; ') }) : null);
      }

      /* ---------------- the log ---------------- */
      const eventTitle = e => {
        const n = e.node && eng.byId[e.node], r = e.route && eng.routeById[e.route], rs = e.res && eng.res[e.res];
        switch (e.kind) {
          case 'famine': return 'Famine in ' + (n ? n.name : 'the settlement');
          case 'raid': return 'Raid on the ' + (r ? (r.label || eng.byId[r.a].name + ' road') : 'road');
          case 'embargo': return 'Trade ban: ' + (rs ? rs.name.toLowerCase() : 'goods') + (n ? ' towards ' + n.name : '');
          case 'shortage': return (rs ? rs.name : 'Goods') + ' shortage in ' + (n ? n.name : '?');
          case 'price': return (rs ? rs.name : 'Prices') + ' soar in ' + (n ? n.name : '?');
          case 'route': return (r ? (r.label || eng.byId[r.a].name + ' road') : 'Road') + (/reopens/.test(e.text) ? ' reopens' : ' closes');
          case 'rule': return e.text.split(' (')[0].replace(/\.$/, '');
          default: return e.text.slice(0, 60);
        }
      };
      function paintLog() {
        const R = runRefs; if (!R || !R.log) return; GK.clear(R.log);
        const all = eng.log.slice().reverse(), kinds = [...new Set(eng.log.map(e => e.kind))];
        const shown = all.filter(e => V.kinds[e.kind] !== false).slice(0, 80);
        R.log.append(h('div.sm-logbar', [h('div.gk-row.sm-chips', kinds.map(k => ui.chip({ label: (KIND[k] ? KIND[k][0] + ' ' + KIND[k][1] : k) + ' ' + eng.log.filter(e => e.kind === k).length, on: V.kinds[k] !== false, onClick: () => { V.kinds[k] = V.kinds[k] === false; paintLog(); } }))),
          ui.button({ label: 'Record this in the world’s history…', icon: '✷', small: true, onClick: () => recordDialog() })]),
        shown.length ? h('div.sm-events', shown.map(e => h('div.sm-event', { class: e.kind, onclick: () => { pause(); const idx = eng.hist.days.findIndex(d => d >= e.day); scrub = clamp(idx < 0 ? eng.hist.days.length - 1 : idx, 0, eng.hist.days.length - 1); if (e.node) V.sel = e.node; refresh(); } }, [
          h('span.sm-ev-ico', { text: (KIND[e.kind] || ['•'])[0] }), h('span.sm-ev-date', { text: dateText(e.day) }), h('span.gk-grow', { text: e.text }),
          ui.button({ icon: '✷', title: 'Record this event in the world’s history', small: true, onClick: ev => { ev.stopPropagation(); record([e]); } })]))) : h('p.gk-muted', { text: eng.tick ? 'Nothing notable yet.' : 'Run the simulation: shortages, raids, closures, bans and famines appear here.' }));
      }
      async function record(list) {
        if (WB.share) return;
        sim.recorded = sim.recorded || [];
        const fresh2 = list.filter(e => !sim.recorded.includes(e.kind + ':' + e.day + ':' + e.text.slice(0, 40)));
        if (!fresh2.length) return ui.toast('Already recorded', 'ℹ');
        const ids = [];
        for (const e of fresh2) {
          const n = e.node && eng.byId[e.node], k = KIND[e.kind] || ['', '', 'Disaster'];
          const created = await WB.api('entries.create', { worldId: WB.worldId, typeKey: 'event', title: eventTitle(e), summary: e.text, body: '<p>' + e.text.replace(/[<>&]/g, '') + '</p><p><em>From the trade simulation “' + (sim.config.name || 'Simulation').replace(/[<>&]/g, '') + '”.</em></p>',
            fields: Object.assign({ kind: k[2] }, n && n.entryId ? { location: n.entryId } : {}), start: { day: eng.config.startDay + e.day, prec: 'day' } });
          ids.push(created.id); sim.recorded.push(e.kind + ':' + e.day + ':' + e.text.slice(0, 40));
        }
        sim.recorded = sim.recorded.slice(-300); save();
        WB.ui.undoToast('Recorded ' + ids.length + (ids.length === 1 ? ' event' : ' events') + ' in the world’s history', async () => { for (const id of ids) await WB.api('entries.trash', id); sim.recorded = []; save(); }, 9000, [{ label: 'Open', onClick: () => WB.open(ids[0]) }]);
      }
      async function recordDialog() {
        if (!eng.log.length) return ui.toast('Nothing has happened yet: run the simulation first', 'ℹ');
        const important = eng.log.filter(e => ['famine', 'raid', 'embargo', 'depleted', 'route', 'rule'].includes(e.kind));
        const list = (important.length ? important : eng.log).slice(-60).reverse();
        const picked = new Set(list.slice(0, 12));
        const box = h('div.sm-recbox', list.map(e => { const cb = h('input', { type: 'checkbox', checked: picked.has(e) }); cb.addEventListener('change', () => (cb.checked ? picked.add(e) : picked.delete(e))); return h('label.sm-recrow', [cb, h('span.sm-ev-date', { text: dateText(e.day) }), h('span.gk-grow', { text: e.text })]); }));
        const ok = await ui.dialog({ title: 'Record in the world’s history', icon: '✷', body: [h('p.gk-small.gk-muted', { text: 'Each ticked line becomes an Event entry on the date it happened (counting from the start date), linked to its place. You can undo right after.' }), box], actions: [{ label: 'Cancel', value: false }, { label: 'Record', kind: 'primary', value: true }] });
        if (ok && picked.size) await record(list.filter(e => picked.has(e)).reverse());
      }

      /* ---------------- test hooks and clean-up ---------------- */
      S.current = () => ({ eng, sim, src, scrub, tab });
      S.api = { advance, play, pause, importMap, startPreset, rebuild, paintAll, select: id => { V.sel = id; net && net.redraw(); paintDetail(); }, tab: t => { tab = t; paintAll(); } };
      const offs = [WB.on('world', () => { if (!dead && (!src || src.worldId !== WB.worldId)) loadSource(null).then(paintAll); })];

      /* ---------------- open ---------------- */
      let first = params.mapId || params.entryId || (store.get().last || {})[WB.worldId];
      if (!first) { const list = await sources(); first = list.maps[0] && list.maps[0].id; }
      await loadSource(first || null, { preset: params.preset, steps: params.steps });
      if (!src && params.preset) await newHand(params.preset, (W().PRESETS.find(p => p.id === params.preset) || {}).name);
      if (!src) paintAll();
      if (params.tab) { tab = params.tab; paintAll(); }
      return () => { dead = true; pause(); save.flush(); net && net.destroy(); chart && chart.destroy(); offs.forEach(f => f()); S.current = null; S.api = null; };
    },
  });

  /* ---------------- smoke steps and checks ---------------- */
  const res = { run: 'did not run' };
  const until = async (fn, ms = 6000) => { const t0 = Date.now(); while (Date.now() - t0 < ms) { const v = fn(); if (v) return v; await WB.wait(80); } return null; };
  WB.smoke('simulate-run', async () => {
    await WB.go('simulate', { preset: 'kingdom', steps: 40 });
    const cv = await until(() => { const c = document.querySelector('.sm-net-cv'); return c && c.clientWidth > 50 ? c : null; });
    const chart = await until(() => { const c = document.querySelector('.sm-chart-cv'); return c && c.clientWidth > 50 ? c : null; });
    const cur = S.current && S.current();
    if (!cv || !chart || !cur || !cur.eng) return (res.run = 'error: no network or chart (' + !!cv + ', ' + !!chart + ')');
    const sm = window.WBSim.summarize(cur.eng);
    await WB.wait(900);
    const e = await WB.api('entries.get', cur.src.id).catch(() => null);
    const r = e && e.data && e.data.sim && e.data.sim.result;
    res.run = cur.eng.tick >= 40 && sm.flows.length > 0 && r && r.nodes.length > 3 && r.flows.length > 0 ? 'ok: ' + cur.eng.tick + ' steps, ' + sm.flows.length + ' flows, ' + sm.nodes.length + ' settlements, result saved' : 'error: ticks ' + cur.eng.tick + ', flows ' + sm.flows.length + ', result ' + !!r;
    return res.run;
  });
  WB.check('simulate: a preset runs, shows a network and a chart, and saves its result for the Atlas', () => { if (!/^ok/.test(res.run)) throw new Error(res.run); return true; });
  WB.commands && WB.commands.add({ id: 'sim-open', label: 'Simulate trade and resources', icon: '⇄', group: 'Maps', run: () => WB.go('simulate'), words: 'simulate trade routes resources economy caravan prices embargo tariff', when: () => !!WB.worldId });
})();
