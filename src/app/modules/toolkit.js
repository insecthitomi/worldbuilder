/* Toolkit: generators (the town generator first), dice, random tables, initiative, sessions and converters.
   WB.gen is defined at load so every screen can offer generators; each tool lives in src/app/modules/toolkit/. */
(function () {
  'use strict';
  const GK = window.GK, WB = window.WB, h = GK.h, ui = GK.ui;
  const TK = WB.toolkit = WB.toolkit || { tools: {} };
  const SHARED = ['src/shared/gen-core.js', 'src/shared/gen-words.js', 'src/shared/gen-town.js', 'src/shared/gen-townmap.js', 'src/shared/gen-more.js'];
  const TOOLS = ['util', 'gen', 'dice', 'tables', 'initiative', 'session', 'convert'].map(f => 'src/app/modules/toolkit/' + f + '.js');
  const seq = async list => { for (const s of list) await WB.loadScript(s); };
  TK.loadTools = () => TK._tools || (TK._tools = seq(TOOLS));

  /* ---------------- one store for every tool (app-wide, with per-world picks) ---------------- */
  TK.DEFAULTS = {
    tab: 'gen', gen: 'town', genState: {}, genHistory: {}, include: { districts: true, locations: true, residents: true, owners: false, map: true },
    rolls: [], favs: [{ label: 'Attack', expr: '1d20+5' }, { label: 'Stats', expr: '4d6kh3' }, { label: 'Fireball', expr: '8d6' }, { label: 'Percent', expr: 'd%' }],
    diceExpr: '1d20', diceMode: '', worlds: {}, tablesMany: 5, convert: { amount: 1 },
  };
  let storeP = null;
  TK.store = ctx => storeP || (storeP = WB.store ? WB.store(ctx || { store: d => GK.store('toolkit', d) }, TK.DEFAULTS) : (ctx ? ctx.store(TK.DEFAULTS) : GK.store('toolkit', TK.DEFAULTS)));
  /** this world's picks (selected table, encounter, running session) */
  TK.mine = async () => { const s = await TK.store(); return Object.assign({ tableId: null, encId: null, sessionId: null, sessionStart: null, autoLog: true }, (s.get().worlds || {})[WB.worldId]); };
  TK.setMine = async p => { const s = await TK.store(); const all = Object.assign({}, s.get().worlds); all[WB.worldId] = Object.assign({}, all[WB.worldId], p); s.patch({ worlds: all }); };

  /* ---------------- roll history: every roll in the app lands here ---------------- */
  TK.addRoll = async (r, extra) => {
    if (!r) return null;
    const s = await TK.store();
    const d20 = r.parts && r.parts.find(p => p.term && /^(2?d20(kh1|kl1)?)$/.test(p.term));
    const nat = d20 ? d20.kept[0] : null;
    const item = Object.assign({ expr: r.expr, total: r.total, text: r.text, label: r.label || '', at: r.at || new Date().toISOString(), mode: r.mode || null, min: r.min, max: r.max, crit: nat === 20 ? 'hit' : nat === 1 ? 'miss' : null }, extra || {});
    s.patch({ rolls: [item].concat(s.get().rolls || []).slice(0, 120) });
    WB.emit('toolkit-rolls', item);
    const mine = await TK.mine();
    if (mine.sessionId && mine.autoLog && TK.logToSession) TK.logToSession({ kind: 'roll', text: (item.label ? item.label + ': ' : 'Rolled ') + item.expr + ' = ' + item.total });
    return item;
  };
  WB.on('roll', r => { if (r && r.src !== 'toolkit') TK.addRoll(r); });
  /** rolls inside the toolkit: no toast, straight into the history */
  TK.roll = (expr, label, extra) => { const r = WB.dice.roll(expr); r.label = label || ''; r.src = 'toolkit'; WB.emit('roll', r); TK.addRoll(r, extra); return r; };

  /* ---------------- WB.gen: the generator registry every screen can use ---------------- */
  const BUILTIN = ['town', 'npc', 'names', 'tavern', 'shop', 'landmark', 'room', 'quest', 'rumour', 'twist', 'weather', 'treasure', 'artifact', 'ship', 'deity', 'religion', 'faction'];
  const pending = [];
  const typeKey = t => (WB.types.get(t.typeId) || {}).key;
  const SEASON = [[/summer|sun|high/i, 'summer'], [/winter|cold|frost|snow|ice|dark/i, 'winter'], [/spring|thaw|bloom|seed|green/i, 'spring'], [/autumn|fall|harvest|fog|reap|leaf/i, 'autumn']];
  /** the world's season as spring/summer/autumn/winter (by name, else by its place in the year) */
  TK.season = (day = WB.now.day) => {
    if (!WB.cal) return 'spring';
    const name = WB.cal.season(day) || '';
    for (const [re, s] of SEASON) if (re.test(name)) return s;
    const list = WB.cal.cal.seasons || [], i = list.findIndex(s => s.name === name);
    if (i >= 0 && list.length) return ['spring', 'summer', 'autumn', 'winter'][Math.min(3, Math.floor(i * 4 / list.length))];
    return ['spring', 'summer', 'autumn', 'winter'][Math.floor(WB.cal.ymd(day).m / Math.max(1, WB.cal.months.length) * 4)];
  };
  let peopleCache = null;
  WB.onChange(['entries'], () => { peopleCache = null; });
  WB.on('world', () => { peopleCache = null; });
  async function peoples() {
    if (peopleCache && peopleCache.world === WB.worldId) return peopleCache;
    const list = await WB.api('entries.list', WB.worldId, { typeKeys: ['species'], limit: 40 }).catch(() => []);
    const full = await Promise.all(list.filter(WB.visible).slice(0, 24).map(e => WB.api('entries.get', e.id).catch(() => null)));
    const ppl = full.filter(e => e && (!e.fields.kind || /people|folk|race|humanoid/i.test(e.fields.kind)));
    peopleCache = { world: WB.worldId, names: ppl.map(e => e.title), ids: Object.fromEntries(ppl.map(e => [e.title, e.id])) };
    return peopleCache;
  }
  const gen = WB.gen = Object.assign(WB.gen || {}, {
    ready: null,
    /** loads the generator libraries (started at once; resolves to window.WBGen) */
    load() { return gen.ready || (gen.ready = seq(SHARED).then(() => { for (const d of pending.splice(0)) window.WBGen.define(d); return window.WBGen; })); },
    /** [{ id, name, icon, group, desc, inputs, star, creates }] */
    list: () => (window.WBGen ? window.WBGen.list() : []),
    get: id => (window.WBGen ? window.WBGen.get(id) : null),
    /** def: { id, name, icon, group, desc, inputs, generate(g), plan?(res, env), text?(res) } — see src/shared/gen-core.js */
    register(def) {
      if (window.WBGen) window.WBGen.define(def); else pending.push(def);
      if (!gen[def.id]) gen[def.id] = opts => gen.open(def.id, opts);
      TK.commandFor && TK.commandFor(def);
      return def;
    },
    /** the options a generator sees: the world's names, calendar, coins, cast and places added to yours */
    async env(opts = {}, state = {}) {
      const o = Object.assign({}, opts), w = WB.world || { settings: {} };
      if (!o.nameStyle && w.settings.nameStyle) o.nameStyle = w.settings.nameStyle;
      const titles = (WB.titles || []).filter(t => !WB.share || WB.visible(t));
      if (o.culture) {
        const c = await WB.api('entries.get', o.culture).catch(() => null);
        if (c) {
          o.names = { given: c.fields.names_given || [], family: c.fields.names_family || [] };
          o.cultureTitle = c.title;
          if (WB.lexicon && WB.lexicon.suggest && !o.placeNames) { try { o.placeNames = (await WB.lexicon.suggest({ cultureId: c.id, kind: 'place', count: 6, seed: (state.seed || 'x') + ':place' })) || []; } catch { } }
        }
      }
      const places = titles.filter(t => typeKey(t) === 'place').map(t => t.title);
      o.placeSamples = o.placeSamples || places.filter(t => t.split(' ').length <= 2 && t.length <= 16);
      o.places = o.places || places.slice(0, 80);
      o.cast = o.cast || titles.filter(t => typeKey(t) === 'character').map(t => t.title).slice(0, 80);
      o.avoidNames = titles.map(t => t.title);
      if (!o.peoples) { const p = await peoples(); o.peoples = p.names; o.peopleIds = p.ids; }
      if (WB.cal) { o.cal = WB.cal; o.nowDay = WB.now.day; o.months = WB.cal.months.map(m => m.name); o.worldSeason = TK.season(); o.dateText = WB.fmt.date(WB.now); }
      o.currencies = o.currencies || w.settings.currencies || null;
      return o;
    },
    /** → Promise<result> (deterministic for the same opts and state { seed, seeds }) */
    async run(id, opts = {}, state = {}) { const G = await gen.load(); return G.run(id, await gen.env(opts, state), state); },
    plan: (res, env) => window.WBGen.plan(res, env || {}),
    text: res => window.WBGen.text(res),
    html: res => window.WBGen.html(res),
    /** makes the entries of a result; env: { mapId, x, y, include, parentId, open, quiet } → { ids, created, rootId } */
    async create(res, env = {}) {
      if (WB.share) throw new Error('Leave Share view to create entries.');
      const plan = gen.plan(res, Object.assign({ cultureId: res.opts.culture || '', peopleIds: res.opts.peopleIds || {}, now: WB.now }, env));
      const r = await WB.api('toolkit.build', WB.worldId, plan);
      const n = r.created.length, name = res.title || 'it';
      if (!env.quiet) TK.toast(n > 1 ? 'Created “' + name + '” and ' + (n - 1) + ' more ' + (n === 2 ? 'entry' : 'entries') : 'Created “' + name + '”', [
        { label: 'Open', onClick: () => WB.open(r.rootId) },
        { label: 'Undo', onClick: async () => { await WB.api('toolkit.undo', r); ui.toast('Removed what was created', '↶'); } },
      ], 9000);
      if (env.open) WB.open(r.rootId);
      return r;
    },
    /** opens a generator in a dialog over the current screen; resolves with what was created (or null) */
    async open(id, opts = {}) {
      if (!WB.worldId) return null;
      await Promise.all([gen.load(), TK.loadTools()]);
      return TK.genDialog(id, opts);
    },
  });
  for (const id of BUILTIN) if (!gen[id]) gen[id] = opts => gen.open(id, opts);
  gen.load();

  /** a toast with several actions (Open, Undo …) */
  TK.toast = (text, actions = [], ms = 7000) => {
    let host = document.querySelector('.gk-toasts');
    if (!host) host = document.body.appendChild(h('div.gk-toasts'));
    const t = host.appendChild(h('div.gk-toast.gk-widget.gk-nolens.wb-undo', [h('span', { text: '✓' }), h('span.gk-grow', { text })].concat(actions.map(a => ui.button({ label: a.label, small: true, onClick: async () => { t.remove(); try { await a.onClick(); } catch (e) { WB.fail(e); } } })))));
    setTimeout(() => { t.classList.add('out'); setTimeout(() => t.remove(), 300); }, ms);
    return t;
  };

  /* ---------------- palette commands ---------------- */
  const cmd = (id, label, icon, run, words) => WB.commands.add({ id, label, icon, group: 'Toolkit', run, words: words || '', when: () => !!WB.worldId });
  cmd('tl-dice', 'Roll dice…', '⚄', () => WB.go('toolkit', { tool: 'dice' }), 'dice roll d20 d6 d100 advantage');
  cmd('tl-town', 'Generate a town', '⌂', () => WB.go('toolkit', { tool: 'town' }), 'town city village settlement found create generator map');
  cmd('tl-npc', 'Generate an NPC', '☺', () => WB.go('toolkit', { tool: 'npc' }), 'person character npc generator');
  cmd('tl-tavern', 'Generate a tavern', '☕', () => WB.go('toolkit', { tool: 'tavern' }), 'inn tavern pub menu generator');
  cmd('tl-gens', 'Generators…', '✦', () => WB.go('toolkit', { tool: 'gen' }), 'random generator ideas');
  cmd('tl-tables', 'Random tables', '☷', () => WB.go('toolkit', { tool: 'tables' }), 'random table roll oracle');
  cmd('tl-init', 'Open the initiative tracker', '⚔', () => WB.go('toolkit', { tool: 'initiative' }), 'initiative combat encounter turn order hp');
  cmd('tl-session', 'Run a session', '☗', () => WB.go('toolkit', { tool: 'session' }), 'session game night log recap start');
  cmd('tl-convert', 'Currency & unit converter', '⇄', () => WB.go('toolkit', { tool: 'convert' }), 'money coins currency units convert');
  TK.commandFor = def => { if (!['town', 'npc', 'tavern'].includes(def.id)) cmd('tl-gen-' + def.id, 'Generate: ' + def.name, def.icon || '✦', () => WB.go('toolkit', { tool: def.id }), (def.desc || '') + ' generator'); };
  gen.ready.then(G => G.list().forEach(TK.commandFor)).catch(() => {});

  /* ---------------- the screen ---------------- */
  const TABS = [['gen', '✦', 'Generators', 'Towns, people, taverns, treasure… seeded and re-rollable'], ['dice', '⚄', 'Dice', 'Dice notation, quick dice, history and saved rolls'], ['tables', '☷', 'Random tables', 'Your own weighted and dice tables, nested'],
    ['initiative', '⚔', 'Initiative', 'Turn order, hit points, conditions and rounds'], ['session', '☗', 'Session', 'Run a game night: log, people met, places, loot, recap'], ['convert', '⇄', 'Converters', 'Your world\'s coins and units']];
  const LENS_TAB = { table: 'tables', encounter: 'initiative' };
  GK.modules.register({
    id: 'toolkit',
    title: 'Toolkit',
    icon: '⚄',
    order: 90,
    subtitle: 'Generators, dice, random tables, initiative, sessions and converters.',
    async mount(page, ctx) {
      const params = WB.params('toolkit') || {};
      page.classList.add('tl-page');
      if (!WB.worldId) {
        page.appendChild(WB.ui.empty({ icon: '⚄', title: 'Open a world to use the toolkit', text: 'Generators, random tables, encounters and sessions belong to a world.', actions: [ui.button({ label: 'Create a world', kind: 'primary', onClick: () => WB.newWorld() })] }));
        return;
      }
      const store = await TK.store(ctx);
      await Promise.all([gen.load(), TK.loadTools()]);
      let tab = TABS.some(t => t[0] === store.get().tab) ? store.get().tab : 'gen', sub = {};
      if (params.entryId) {
        const e = await WB.api('entries.lite', params.entryId).catch(() => null);
        const t = e && WB.typeOf(e);
        if (t && (LENS_TAB[t.lens] || t.key === 'session')) { tab = LENS_TAB[t.lens] || 'session'; sub = { entryId: e.id }; }
      }
      if (params.tool) {
        if (TABS.some(t => t[0] === params.tool)) tab = params.tool;
        else if (gen.get(params.tool)) { tab = 'gen'; sub = Object.assign({}, params, { gen: params.tool }); }
      }
      if (params.gen) { tab = 'gen'; sub = Object.assign({}, params); }
      const seg = ui.segmented({ value: tab, options: TABS.map(([id, icon, label, tip]) => [id, icon + '  ' + label, tip]), onChange: v => show(v) });
      seg.classList.add('tl-tabs');
      seg.setAttribute('role', 'tablist');
      const host = h('div.tl-host');
      page.append(h('div.tl-bar', [seg]), host);
      let cleanup = null, current = null, seq0 = 0;
      async function show(id, p) {
        const my = ++seq0;
        if (cleanup) { try { cleanup(); } catch (e) { console.error(e); } cleanup = null; }
        GK.clear(host);
        current = id;
        store.patch({ tab: id });
        seg.querySelectorAll('button').forEach((b, i) => b.classList.toggle('on', TABS[i][0] === id));
        host.dataset.tool = id;
        try {
          const c = await TK.tools[id].mount(host, { ctx, store, params: p || {} });
          if (my !== seq0) { if (typeof c === 'function') c(); return; }
          cleanup = typeof c === 'function' ? c : null;
        } catch (e) { console.error(e); host.appendChild(ui.panel({ title: 'This tool failed to load', icon: '⚠', body: h('pre.gk-small', { text: String(e && e.stack || e) }) })); }
      }
      TK.show = (id, p) => show(id, p);
      await show(tab, sub);
      let worldId = WB.worldId;
      const offs = [
        WB.on('share', () => show(current)),
        WB.on('world', () => { if (WB.worldId !== worldId) { worldId = WB.worldId; show(current); } }),
      ];
      return () => { TK.show = null; if (cleanup) { try { cleanup(); } catch (e) { console.error(e); } } offs.forEach(f => f()); };
    },
  });

  /* ---------------- smoke steps and checks ---------------- */
  const res = { dice: 'did not run', town: 'did not run', table: 'did not run', init: 'did not run' };
  const until = async (fn, ms = 4000) => { const t0 = Date.now(); while (Date.now() - t0 < ms) { const v = fn(); if (v) return v; await WB.wait(60); } return null; };
  WB.smoke('toolkit-dice', async () => {
    await WB.go('toolkit', { tool: 'dice' });
    const inp = await until(() => document.querySelector('.tl-dice-input'));
    if (!inp) return (res.dice = 'error: no dice box');
    inp.value = '2d6+3'; inp.dispatchEvent(new Event('input'));
    document.querySelector('.tl-dice-roll').click();
    const big = await until(() => { const b = document.querySelector('.tl-dice-total'); return b && /\d/.test(b.textContent) ? b : null; });
    WB.roll('1d20', 'Smoke');
    const hist = await until(() => document.querySelectorAll('.tl-hist-row').length >= 2);
    const total = big ? +big.textContent : NaN;
    res.dice = total >= 5 && total <= 15 && hist ? 'ok: ' + total : 'error: total ' + total + ', history ' + !!hist;
    return res.dice;
  });
  WB.smoke('toolkit-town', async () => {
    await WB.go('toolkit', { tool: 'town' });
    const name = await until(() => { const n = document.querySelector('.tl-town-name'); return n && n.textContent.trim() ? n.textContent.trim() : null; }, 8000);
    const img = await until(() => { const i = document.querySelector('.tl-town-map img'); return i && i.complete && i.naturalWidth ? i : null; }, 6000);
    res.town = name && img ? 'ok: ' + name : 'error: name ' + name + ', map ' + !!img;
    return res.town;
  });
  WB.smoke('toolkit-table', async () => {
    const tables = await WB.api('toolkit.tables', WB.worldId).catch(() => []);
    const t = tables.find(x => /rumour/i.test(x.title)) || tables[0];
    await WB.go('toolkit', t ? { entryId: t.id } : { tool: 'tables' });
    const btn = await until(() => document.querySelector('.tl-table-roll'));
    if (!btn) return (res.table = 'error: no table');
    btn.click();
    const out = await until(() => { const r = document.querySelector('.tl-table-result-text'); return r && r.textContent.trim() ? r.textContent : null; });
    const hl = document.querySelector('.tl-row.hit');
    res.table = out && hl && !/\[\[|\{/.test(out) ? 'ok: ' + out.slice(0, 60) : 'error: result ' + out + ', highlighted ' + !!hl;
    return res.table;
  });
  WB.smoke('toolkit-initiative', async () => {
    const enc = (await WB.api('entries.list', WB.worldId, { typeKeys: ['encounter'], limit: 5 }).catch(() => []))[0];
    await WB.go('toolkit', enc ? { entryId: enc.id } : { tool: 'initiative' });
    const rows = await until(() => document.querySelectorAll('.tl-cmb').length || null, 5000);
    res.init = enc ? (rows ? 'ok: ' + rows + ' combatants' : 'error: no combatants shown') : 'ok: no encounter in this world';
    return res.init;
  });
  const okOr = (k) => () => { if (!/^ok/.test(res[k])) throw new Error(res[k]); return true; };
  WB.check('toolkit: dice roll and the history hears every roll', okOr('dice'));
  WB.check('toolkit: the town generator shows a town with its map', okOr('town'));
  WB.check('toolkit: a random table rolls (nested and inline) and highlights the row', okOr('table'));
  WB.check('toolkit: the initiative tracker shows an encounter', okOr('init'));
  WB.check('toolkit: a town generates deterministically from a seed', () => {
    const G = window.WBGen; if (!G) throw new Error('generators not loaded');
    const a = G.run('town', { size: 'city', terrain: 'coast' }, { seed: 'SMOKE1' }), b = G.run('town', { size: 'city', terrain: 'coast' }, { seed: 'SMOKE1' });
    return a.data.name === b.data.name && JSON.stringify(a.sections) === JSON.stringify(b.sections) && a.data.map.svg === b.data.map.svg;
  });
  WB.check('toolkit: WB.gen offers every generator', () => typeof WB.gen.town === 'function' && WB.gen.list().length >= 17);
})();
