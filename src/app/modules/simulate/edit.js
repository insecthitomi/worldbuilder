/* Simulate: the setup editors (goods, settlements, routes, rules, world settings, compare). Compact tables with sensible
   defaults; every edit calls env.changed(). The raw config lives in env.cfg(); the engine normalises it when it runs. */
(function () {
  'use strict';
  const { h, ui } = GK;
  const S = WB.sim = WB.sim || {};
  const W = () => window.WBSim;
  const TERRAINS = ['plains', 'river', 'coast', 'forest', 'hills', 'mountain', 'desert', 'oasis', 'swamp', 'tundra', 'jungle', 'island', 'station', 'asteroid', 'moon', 'planet', 'gas'];
  const SEASON_NAMES = ['spring', 'summer', 'autumn', 'winter'];

  /* ---------------- small helpers ---------------- */
  const uniq = (list, base) => { let id = base, k = 2; while (list.some(x => x.id === id)) id = base + '-' + k++; return id; };
  const numIn = (v, on, o = {}) => { const el = ui.input({ type: 'number', value: v == null ? '' : v, onChange: x => on(x === '' ? null : +x) }); el.classList.add('sm-num'); if (o.step) el.step = o.step; if (o.min != null) el.min = o.min; if (o.max != null) el.max = o.max; if (o.title) el.title = o.title; return el; };
  const txtIn = (v, on, o = {}) => { const el = ui.input({ value: v || '', placeholder: o.ph || '', onChange: on }); el.classList.add(o.cls || 'sm-txt'); if (o.title) el.title = o.title; return el; };
  const selIn = (v, options, on) => { const el = ui.select({ value: v, options, onChange: on }); el.classList.add('sm-sel'); return el; };
  const x = (title, on) => ui.button({ icon: '✕', title, small: true, onClick: on });
  const resName = (cfg, id) => { const r = (cfg.resources || []).find(q => q.id === id); return r ? r.name : id; };
  const resOptions = (cfg, extra) => (extra ? [['*', 'All goods']].concat(W().CATEGORIES.map(c => ['@' + c, 'All ' + c + ' goods'])) : []).concat((cfg.resources || []).map(r => [r.id, (r.icon ? r.icon + ' ' : '') + r.name]));
  /** { plains: 0.14, coast: 0.04 } <-> "plains:0.14, coast:0.04" */
  const kv = o => Object.keys(o || {}).map(k => k + ':' + (Math.round(o[k] * 1000) / 1000)).join(', ');
  const parseKV = s => { const o = {}; for (const part of String(s || '').split(/[,;]/)) { const m = /^\s*([^:=]+?)\s*[:=]\s*(-?[\d.]+)\s*$/.exec(part); if (m) o[m[1].toLowerCase()] = +m[2]; } return o; };
  const kvRes = (cfg, o) => Object.keys(o || {}).map(k => resName(cfg, k) + ':' + (Math.round(o[k] * 1000) / 1000)).join(', ');
  const parseRes = (cfg, s) => {
    const o = {};
    for (const part of String(s || '').split(/[,;]/)) {
      const m = /^\s*([^:=]+?)\s*[:=]\s*([\d.]+)\s*$/.exec(part); if (!m) continue;
      const r = (cfg.resources || []).find(q => q.id === m[1].toLowerCase() || q.name.toLowerCase() === m[1].toLowerCase()); if (r) o[r.id] = +m[2];
    }
    return o;
  };
  function table(cols, rows, empty) {
    const t = h('table.sm-tbl', [h('thead', h('tr', cols.map(c => h('th', { text: c[0], title: c[1] || null })))), h('tbody', rows.length ? rows.map(r => h('tr', r.map(c => h('td', c)))) : h('tr', h('td.gk-muted', { colSpan: cols.length, text: empty || 'Nothing yet.' })))]);
    return h('div.sm-tbl-wrap', t);
  }
  const head = (title, sub, actions) => h('div.sm-head', [h('div.gk-grow', [h('h3', { text: title }), sub ? h('p.gk-small.gk-muted', { text: sub }) : null]), actions ? h('div.gk-row', actions) : null]);

  /* ---------------- goods ---------------- */
  S.editGoods = function (host, env) {
    const cfg = env.cfg();
    GK.clear(host);
    const libs = () => W().PRESETS.map(p => ({ name: p.name + ' goods', res: p.make().resources }));
    const rows = cfg.resources.map(r => [
      txtIn(r.icon, v => { r.icon = v.slice(0, 2); env.changed('res'); }, { cls: 'sm-icon', title: 'Icon (one or two characters)' }),
      txtIn(r.name, v => { r.name = v || r.name; env.changed('res'); }, { cls: 'sm-name' }),
      selIn(r.category, W().CATEGORIES.map(c => [c, c]), v => { r.category = v; env.changed('res'); }),
      numIn(r.value, v => { r.value = Math.max(0.01, v || 1); env.changed('res'); }, { step: 'any', title: 'Base value in coins per unit' }),
      numIn(r.bulk, v => { r.bulk = Math.max(0.001, v || 1); env.changed('res'); }, { step: 'any', title: 'Transport weight/bulk per unit (a sack of grain = 1)' }),
      numIn(Math.round((r.decay || 0) * 10000) / 100, v => { r.decay = Math.max(0, (v || 0) / 100); env.changed('res'); }, { step: 'any', title: 'Percent lost per day when stored or carried' }),
      ui.color({ value: /^#[0-9a-f]{6}$/i.test(r.color || '') ? r.color : '#9aa5b1', onInput: v => { r.color = v; env.changed('res', true); } }),
      txtIn(kv(r.from), v => { r.from = parseKV(v); env.changed('res'); }, { cls: 'sm-kv', ph: 'plains:0.14, coast:0.04', title: 'What it can be gathered from: terrain:units per worker per day. Used by Auto-fill.' }),
      x('Remove ' + r.name, () => { cfg.resources = cfg.resources.filter(q => q !== r); env.changed('res'); env.redraw(); }),
    ]);
    host.append(head('Goods', 'Everything that can be made, carried, eaten or traded. Value is coins per unit; bulk is transport weight (a sack of grain = 1); decay is percent lost per day.', [
      ui.button({ label: 'Add a good', icon: '＋', onClick: () => { cfg.resources.push({ id: uniq(cfg.resources, 'good'), name: 'New good', category: 'material', value: 5, bulk: 1, decay: 0, color: W().PALETTE[cfg.resources.length % 12], icon: '', from: {} }); env.changed('res'); env.redraw(); } }),
      ui.button({ label: 'Add typical goods…', icon: '✦', onClick: async () => {
        const L = libs(); let pick = 0;
        const sel = ui.select({ value: '0', options: L.map((l, i) => [String(i), l.name + ' (' + l.res.length + ')']), onChange: v => { pick = +v; } });
        if (!(await ui.dialog({ title: 'Add typical goods', icon: '✦', body: [h('p.gk-small.gk-muted', { text: 'Adds the goods this set has that you do not have yet. Nothing is replaced.' }), sel], actions: [{ label: 'Cancel', value: false }, { label: 'Add', kind: 'primary', value: true }] }))) return;
        let n = 0; for (const r of L[pick].res) if (!cfg.resources.some(q => q.id === r.id)) { cfg.resources.push(JSON.parse(JSON.stringify(r))); n++; }
        ui.toast(n ? 'Added ' + n + ' goods' : 'You already have all of them', 'ℹ'); env.changed('res'); env.redraw();
      } }),
    ]), table([['', 'Icon'], ['Name'], ['Kind'], ['Value', 'coins per unit'], ['Bulk'], ['Decay %/day'], ['', 'Colour'], ['Gathered from', 'terrain:units per worker per day'], ['']], rows, 'No goods yet: add some, or start from a preset.'));
  };

  /* ---------------- settlements ---------------- */
  S.editNodes = function (host, env) {
    const cfg = env.cfg(), st = env.ui;
    GK.clear(host);
    if (!st.node || !cfg.nodes.some(n => n.id === st.node)) st.node = cfg.nodes[0] && cfg.nodes[0].id;
    const n = cfg.nodes.find(q => q.id === st.node);
    const list = h('div.sm-nodelist', cfg.nodes.map(q => h('button.sm-nodeitem', { class: q.id === st.node ? 'on' : '', type: 'button', onclick: () => { st.node = q.id; S.editNodes(host, env); } }, [h('b.gk-ellipsis', { text: q.name }), h('span.gk-small.gk-muted', { text: Math.round(q.pop || 0).toLocaleString() })])));
    const left = h('div.sm-nodes-left', [list, h('div.gk-row', [
      ui.button({ label: 'Settlement', icon: '＋', small: true, onClick: () => { const id = uniq(cfg.nodes, 'n'); cfg.nodes.push({ id, name: 'New settlement', x: 200 + cfg.nodes.length * 40 % 600, y: 200 + cfg.nodes.length * 60 % 300, pop: 300, wealth: 1200, tech: 1, terrain: ['plains'], producers: [], consumers: [], recipes: [] }); st.node = id; env.changed('node'); S.editNodes(host, env); } }),
      ui.button({ label: 'Fill all empty', icon: '✦', small: true, title: 'Auto-fill producers, needs and workshops for every settlement that has none', onClick: () => { const f = W().autoFill(cfg); cfg.nodes = f.nodes; env.changed('node'); S.editNodes(host, env); ui.toast('Filled from terrain and population', '✦'); } }),
    ])]);
    const right = h('div.sm-nodes-right');
    host.append(head('Settlements', 'Each one has people, a stockpile and a purse. What it makes depends on its terrain, season, workers and tech; what it needs depends on its people and wealth.'), h('div.sm-nodes', [left, right]));
    if (!n) { right.append(h('p.gk-muted', { text: 'No settlements yet. Add one, or import them from a map.' })); return; }
    const redraw = () => S.editNodes(host, env);
    const chips = h('div.gk-row.sm-chips', TERRAINS.concat((n.terrain || []).filter(t => !TERRAINS.includes(t))).map(t => ui.chip({ label: t, on: (n.terrain || []).includes(t), onClick: e => { const on = !(n.terrain || []).includes(t); n.terrain = (n.terrain || []).filter(q => q !== t); if (on) n.terrain.push(t); e.currentTarget.classList.toggle('on', on); env.changed('node'); } })));
    right.append(
      h('div.sm-grid', [
        ui.field({ label: 'Name', control: txtIn(n.name, v => { n.name = v || n.name; env.changed('node', true); redrawList(); }, { cls: 'sm-wide' }) }),
        ui.field({ label: 'Population', control: numIn(n.pop, v => { n.pop = Math.max(1, v || 1); env.changed('node'); redrawList(); }) }),
        ui.field({ label: 'Wealth (coins)', control: numIn(n.wealth, v => { n.wealth = Math.max(0, v || 0); env.changed('node'); }) }),
        ui.field({ label: 'Tech level (0 to 5)', control: numIn(n.tech, v => { n.tech = Math.max(0, Math.min(9, v == null ? 1 : v)); env.changed('node'); }, { min: 0, max: 9 }) }),
        ui.field({ label: 'Faction', control: txtIn(n.faction, v => { n.faction = v; env.changed('node'); }, { ph: 'e.g. the Kingdom' }) }),
        ui.field({ label: 'Share of people who work (%)', control: numIn(Math.round((n.laborShare == null ? 0.4 : n.laborShare) * 100), v => { n.laborShare = Math.max(5, Math.min(100, v || 40)) / 100; env.changed('node'); }) }),
      ]),
      ui.field({ label: 'Terrain', hint: 'Decides what can be gathered here.', control: chips }),
      h('div.gk-row', [
        ui.button({ label: 'Auto-fill from terrain & population', icon: '✦', onClick: () => { const f = W().autoFill({ resources: cfg.resources, nodes: [n] }, { force: true }); Object.assign(n, f.nodes[0]); env.changed('node'); redraw(); ui.toast('Filled ' + n.name, '✦'); } }),
        ui.button({ label: 'Remove', icon: '✕', small: true, onClick: () => { cfg.nodes = cfg.nodes.filter(q => q !== n); cfg.routes = cfg.routes.filter(r => r.a !== n.id && r.b !== n.id); st.node = null; env.changed('node'); redraw(); } }),
        n.entryId ? ui.button({ label: 'Open its entry', icon: '↗', small: true, onClick: () => WB.open(n.entryId) }) : null,
      ]),
      h('h4', { text: 'Gathers & makes' }),
      table([['Good'], ['Per worker/day'], ['Workforce %', 'share of the working people'], ['Terrain boost', 'terrain:multiplier'], ['Season boost', 'spring:0.9, winter:0.4'], ['Tech'], ['Deposit', 'finite stock; empty = unlimited'], ['Regrows %/day'], ['']],
        (n.producers || []).map(p => [
          selIn(p.res, resOptions(cfg), v => { p.res = v; env.changed('node'); }),
          numIn(p.perWorker, v => { p.perWorker = Math.max(0, v || 0); env.changed('node'); }, { step: 'any' }),
          numIn(Math.round((p.share || 0) * 100), v => { p.share = Math.max(0, Math.min(100, v || 0)) / 100; env.changed('node'); }),
          txtIn(kv(p.terrain), v => { p.terrain = parseKV(v); env.changed('node'); }, { cls: 'sm-kv', ph: 'any' }),
          txtIn(kv(p.season), v => { p.season = parseKV(v); env.changed('node'); }, { cls: 'sm-kv', ph: 'every season equal' }),
          numIn(p.tech || 0, v => { p.tech = Math.max(0, v || 0); env.changed('node'); }),
          numIn(p.deposit ? p.deposit.cap : '', v => { p.deposit = v > 0 ? { cap: v, regrow: p.deposit ? p.deposit.regrow : 0.001 } : null; env.changed('node'); redraw(); }),
          p.deposit ? numIn(Math.round(p.deposit.regrow * 10000) / 100, v => { p.deposit.regrow = Math.max(0, (v || 0) / 100); env.changed('node'); }, { step: 'any' }) : h('span.gk-faint', { text: '-' }),
          x('Remove', () => { n.producers = n.producers.filter(q => q !== p); env.changed('node'); redraw(); }),
        ]), 'Makes nothing yet.'),
      ui.button({ label: 'Producer', icon: '＋', small: true, onClick: () => { n.producers = n.producers || []; n.producers.push({ id: uniq(n.producers, 'p'), res: (cfg.resources[0] || {}).id, perWorker: 0.1, share: 0.3, terrain: {}, season: {} }); env.changed('node'); redraw(); } }),
      h('h4', { text: 'Needs & wants' }),
      table([['Good'], ['Per 100 people/day'], ['Needs wealth/head', 'wealth per head below which the want fades'], ['Kind'], ['Season factor', 'winter:2.5'], ['']],
        (n.consumers || []).map(c => [
          selIn(c.res, resOptions(cfg).concat(W().CATEGORIES.map(k => ['@' + k, 'Any ' + k + ' (cheapest first)'])), v => { c.res = v; env.changed('node'); }),
          numIn(c.per100, v => { c.per100 = Math.max(0, v || 0); env.changed('node'); }, { step: 'any' }),
          numIn(c.minWealth || 0, v => { c.minWealth = Math.max(0, v || 0); env.changed('node'); }, { step: 'any' }),
          selIn(c.kind || 'need', [['need', 'Need'], ['want', 'Want']], v => { c.kind = v; env.changed('node'); }),
          txtIn(kv(c.season), v => { c.season = parseKV(v); env.changed('node'); }, { cls: 'sm-kv', ph: 'flat' }),
          x('Remove', () => { n.consumers = n.consumers.filter(q => q !== c); env.changed('node'); redraw(); }),
        ]), 'Needs nothing yet.'),
      ui.button({ label: 'Need', icon: '＋', small: true, onClick: () => { n.consumers = n.consumers || []; n.consumers.push({ id: uniq(n.consumers, 'c'), res: '@food', per100: 2, kind: 'need', minWealth: 0, season: {} }); env.changed('node'); redraw(); } }),
      h('h4', { text: 'Workshops' }),
      table([['Name'], ['Uses', 'Good:amount per batch'], ['Makes', 'Good:amount per batch'], ['Batches/day'], ['Workers per batch-day'], ['Workforce %'], ['']],
        (n.recipes || []).map(r => [
          txtIn(r.name, v => { r.name = v; env.changed('node'); }, { cls: 'sm-name' }),
          txtIn(kvRes(cfg, r.inputs), v => { r.inputs = parseRes(cfg, v); env.changed('node'); }, { cls: 'sm-kv', ph: 'Iron ore:2, Timber:1' }),
          txtIn(kvRes(cfg, r.outputs), v => { r.outputs = parseRes(cfg, v); env.changed('node'); }, { cls: 'sm-kv', ph: 'Iron goods:1' }),
          numIn(r.perDay, v => { r.perDay = Math.max(0, v || 0); env.changed('node'); }, { step: 'any' }),
          numIn(r.workers, v => { r.workers = Math.max(1, v || 5); env.changed('node'); }),
          numIn(Math.round((r.share || 0.08) * 100), v => { r.share = Math.max(0, Math.min(100, v || 0)) / 100; env.changed('node'); }),
          x('Remove', () => { n.recipes = n.recipes.filter(q => q !== r); env.changed('node'); redraw(); }),
        ]), 'No workshops.'),
      ui.button({ label: 'Workshop', icon: '＋', small: true, onClick: () => { n.recipes = n.recipes || []; n.recipes.push({ id: uniq(n.recipes, 'r'), name: 'Workshop', inputs: {}, outputs: {}, perDay: 1, workers: 5, share: 0.08 }); env.changed('node'); redraw(); } }),
    );
    function redrawList() { list.querySelectorAll('.sm-nodeitem').forEach((b, i) => { b.firstChild.textContent = cfg.nodes[i].name; b.lastChild.textContent = Math.round(cfg.nodes[i].pop || 0).toLocaleString(); }); }
  };

  /* ---------------- routes ---------------- */
  S.editRoutes = function (host, env) {
    const cfg = env.cfg();
    GK.clear(host);
    const nodes = cfg.nodes.map(n => [n.id, n.name]);
    const norm = W().normalize(cfg), modes = norm.modes;
    const rows = cfg.routes.map(r => {
      const m = modes.find(q => q.mode === r.mode) || modes[2], days = (+r.distance || 0) / ((+r.perDay || m.perDay) || 1);
      return [
        selIn(r.a, nodes, v => { r.a = v; env.changed('route'); }), selIn(r.b, nodes, v => { r.b = v; env.changed('route'); }),
        numIn(Math.round(r.distance * 100) / 100, v => { r.distance = Math.max(0.01, v || 1); env.changed('route'); redraw(); }, { step: 'any', title: 'In the map’s unit' }),
        selIn(r.mode, modes.map(q => [q.mode, q.label]), v => { r.mode = v; env.changed('route'); redraw(); }),
        h('span.sm-days', { text: days < 1 ? '< 1 day' : (Math.round(days * 10) / 10) + ' days', title: 'Travel time in good weather' }),
        numIn(Math.round((r.risk == null ? 0.02 : r.risk) * 1000) / 10, v => { r.risk = Math.max(0, Math.min(100, v || 0)) / 100; env.changed('route'); }, { step: 'any', title: 'Percent chance a caravan is raided on this trip' }),
        numIn(r.toll || 0, v => { r.toll = Math.max(0, v || 0); env.changed('route'); }, { step: 'any', title: 'Coins per unit carried' }),
        numIn(r.capacity || '', v => { r.capacity = v > 0 ? v : 0; env.changed('route'); }, { title: 'Bulk per day each way; empty = the mode’s default' }),
        txtIn((r.closed || []).join(', '), v => { r.closed = v.split(/[,;]/).map(s => s.trim().toLowerCase()).filter(Boolean); env.changed('route'); }, { cls: 'sm-kv', ph: 'winter', title: 'Seasons the route is shut (by name or spring/summer/autumn/winter)' }),
        ui.toggle({ value: !!r.oneWay, title: 'One way only (A to B)', onChange: v => { r.oneWay = v; env.changed('route'); } }),
        x('Remove', () => { cfg.routes = cfg.routes.filter(q => q !== r); env.changed('route'); redraw(); }),
      ];
    });
    const redraw = () => S.editRoutes(host, env);
    host.append(head('Routes', 'Roads, rivers and sea lanes between settlements. Goods travel along them where the price difference pays for the trip; closed seasons, tolls, risk and capacity all shape the flow.', [
      ui.button({ label: 'Add a route', icon: '＋', onClick: () => { if (cfg.nodes.length < 2) return ui.toast('Add two settlements first', 'ℹ'); cfg.routes.push({ id: uniq(cfg.routes, 'r'), a: cfg.nodes[0].id, b: cfg.nodes[1].id, distance: 50, mode: 'cart', risk: 0.02, toll: 0, closed: [] }); env.changed('route'); redraw(); } }),
      env.hasMap ? ui.button({ label: 'Re-import from the map', icon: '⌖', onClick: () => env.importMap() }) : null,
    ]), table([['From'], ['To'], ['Distance', env.unit || ''], ['Travel by'], ['Takes'], ['Raid risk %'], ['Toll/unit'], ['Capacity'], ['Closed in'], ['One way'], ['']], rows, 'No routes yet: settlements cannot trade without them.'));
  };

  /* ---------------- rules ---------------- */
  const EFFECT_ORDER = ['embargo', 'tariff', 'toll', 'priceCap', 'priceFloor', 'tithe', 'monopoly', 'demand', 'ration', 'forbidden', 'sacred', 'risk', 'output', 'freeTrade'];
  S.ruleDialog = async function (env, rule, isNew) {
    const cfg = env.cfg(), E = W().EFFECTS;
    const r = JSON.parse(JSON.stringify(rule));
    r.when = r.when || {}; r.when.seasons = r.when.seasons || [];
    const body = h('div.sm-ruleform'), preview = h('p.sm-rule-preview');
    const seasonNames = ((cfg.calendar && cfg.calendar.seasons) || []).map(s => s.name.toLowerCase());
    const factions = [...new Set(cfg.nodes.map(n => n.faction).filter(Boolean))];
    const describe = () => { try { preview.textContent = 'In words: ' + W().describeRule(W().normalize(cfg), W().normalize({ resources: cfg.resources, nodes: cfg.nodes, routes: cfg.routes, rules: [r] }).rules[0]) + '.'; } catch { preview.textContent = ''; } };
    const paint = () => {
      GK.clear(body);
      const e = r.effect, info = E[e.type] || {};
      const targets = r.scope.kind === 'settlement' ? cfg.nodes.map(n => [n.id, n.name]) : r.scope.kind === 'faction' ? factions.map(f => [f, f]) : r.scope.kind === 'route' ? cfg.routes.map(q => [q.id, (cfg.nodes.find(n => n.id === q.a) || {}).name + ' – ' + (cfg.nodes.find(n => n.id === q.b) || {}).name]) : r.scope.kind === 'resource' ? resOptions(cfg) : null;
      if (targets && !targets.some(t => t[0] === r.scope.target)) r.scope.target = targets[0] ? targets[0][0] : '';
      const cond = r.when.cond;
      body.append(
        ui.field({ label: 'Name', control: txtIn(r.name, v => { r.name = v; }, { cls: 'sm-wide' }) }),
        ui.field({ label: 'What it does', hint: info.hint, control: selIn(e.type, EFFECT_ORDER.map(k => [k, E[k].label]), v => { e.type = v; paint(); }) }),
        h('div.sm-grid', [
          ui.field({ label: 'Applies to', control: selIn(r.scope.kind, [['global', 'Everywhere'], ['faction', 'A faction'], ['settlement', 'A settlement'], ['route', 'A route'], ['resource', 'A good (anywhere)']], v => { r.scope.kind = v; r.scope.target = ''; paint(); }) }),
          targets ? ui.field({ label: r.scope.kind === 'faction' ? 'Which faction' : r.scope.kind === 'route' ? 'Which route' : r.scope.kind === 'resource' ? 'Which good' : 'Which settlement', control: selIn(r.scope.target, targets.length ? targets : [['', 'None available']], v => { r.scope.target = v; describe(); }) }) : null,
          r.scope.kind !== 'resource' ? ui.field({ label: 'Goods', control: selIn(r.res || '*', resOptions(cfg, true), v => { r.res = v; describe(); }) }) : null,
          info.dir ? ui.field({ label: 'Direction', control: selIn(e.dir || 'both', [['both', 'In and out'], ['in', 'Coming in'], ['out', 'Going out']], v => { e.dir = v; describe(); }) }) : null,
          info.pct ? ui.field({ label: e.type === 'priceCap' || e.type === 'priceFloor' ? 'Percent of base value' : e.type === 'ration' ? 'Percent of normal use' : e.type === 'freeTrade' ? 'Transport cheaper by %' : 'Percent', control: numIn(e.pct, v => { e.pct = v == null ? 0 : v; describe(); }, { step: 'any' }) }) : null,
          info.amount ? ui.field({ label: 'Coins per unit', control: numIn(e.amount, v => { e.amount = v || 0; describe(); }, { step: 'any' }) }) : null,
          e.type === 'tithe' ? ui.field({ label: 'Delivered to', control: selIn(e.to || '', [['', 'Used up by the state']].concat(cfg.nodes.map(n => [n.id, n.name])), v => { e.to = v; describe(); }) }) : null,
          ui.field({ label: 'Only on', control: selIn(r.mode || '', [['', 'Any route']].concat(W().normalize(cfg).modes.map(m => [m.mode, m.label])), v => { r.mode = v; describe(); }) }),
        ]),
        ui.field({ label: 'When', hint: 'Pick seasons, or leave empty for always.', control: h('div.gk-row.sm-chips', (seasonNames.length ? seasonNames : SEASON_NAMES).map(s => ui.chip({ label: s, on: r.when.seasons.includes(s), onClick: ev => { const on = !r.when.seasons.includes(s); r.when.seasons = r.when.seasons.filter(q => q !== s); if (on) r.when.seasons.push(s); ev.currentTarget.classList.toggle('on', on); describe(); } }))) }),
        h('div.sm-grid', [
          ui.field({ label: 'Only while', control: selIn(cond ? 'on' : '', [['', 'No condition'], ['on', 'A good is scarce or dear']], v => { r.when.cond = v ? { res: (cfg.resources[0] || {}).id, metric: 'cover', op: '<', value: 8 } : null; paint(); }) }),
          cond ? ui.field({ label: 'Good', control: selIn(cond.res, resOptions(cfg), v => { cond.res = v; describe(); }) }) : null,
          cond ? ui.field({ label: 'Measure', control: selIn(cond.metric, [['cover', 'Days of supply left'], ['price', 'Price vs base (x)']], v => { cond.metric = v; describe(); }) }) : null,
          cond ? ui.field({ label: 'Is', control: h('div.gk-row.nowrap', [selIn(cond.op, [['<', 'below'], ['>', 'above']], v => { cond.op = v; describe(); }), numIn(cond.value, v => { cond.value = v == null ? 1 : v; describe(); }, { step: 'any' })]) }) : null,
        ]),
        preview,
      );
      describe();
    };
    paint();
    const ok = await ui.dialog({ title: isNew ? 'New rule' : 'Edit rule', icon: '§', body, actions: [{ label: 'Cancel', value: false }, { label: isNew ? 'Add rule' : 'Save', kind: 'primary', value: true }] });
    return ok ? r : null;
  };
  S.editRules = function (host, env) {
    const cfg = env.cfg();
    GK.clear(host);
    const norm = W().normalize(cfg);
    const redraw = () => S.editRules(host, env);
    const nameOf = r => W().describeRule(norm, norm.rules.find(q => q.id === r.id) || W().normalize({ resources: cfg.resources, nodes: cfg.nodes, routes: cfg.routes, rules: [r] }).rules[0]);
    const cards = cfg.rules.map(r => h('div.sm-rule', { class: r.on === false ? 'off' : '' }, [
      ui.toggle({ value: r.on !== false, title: 'Rule in force', onChange: v => { r.on = v; env.changed('rule'); card(r, v); } }),
      h('div.gk-grow', [h('b', { text: r.name }), h('div.gk-small.gk-muted', { text: nameOf(r) })]),
      ui.button({ icon: '✎', title: 'Edit', small: true, onClick: async () => { const n = await S.ruleDialog(env, r, false); if (n) { Object.assign(r, n); env.changed('rule'); redraw(); } } }),
      ui.button({ icon: '⧉', title: 'Duplicate', small: true, onClick: () => { const c = JSON.parse(JSON.stringify(r)); c.id = uniq(cfg.rules, r.id.replace(/-\d+$/, '')); c.name += ' (copy)'; cfg.rules.push(c); env.changed('rule'); redraw(); } }),
      x('Delete', () => { cfg.rules = cfg.rules.filter(q => q !== r); env.changed('rule'); redraw(); }),
    ]));
    function card(r, on) { const i = cfg.rules.indexOf(r); if (cards[i]) cards[i].classList.toggle('off', !on); }
    host.append(head('Rules & customs', 'Laws, taxes, bans, festivals and habits. Each rule has a scope, an effect and optionally a season or a condition. They act on the same simulation, so switch one off and compare in the Compare tab.', [
      ui.button({ label: 'From the library…', icon: '✦', onClick: async () => {
        const lib = W().RULE_LIBRARY; let pick = lib[0].key;
        const list = h('div.sm-libgrid', lib.map(t => h('button.sm-libitem', { type: 'button', class: t.key === pick ? 'on' : '', onclick: e => { pick = t.key; list.querySelectorAll('.sm-libitem').forEach(b => b.classList.toggle('on', b === e.currentTarget)); } }, [h('b', { text: t.name }), h('span.gk-small.gk-muted', { text: t.desc })])));
        if (!(await ui.dialog({ title: 'Rule library', icon: '✦', body: [h('p.gk-small.gk-muted', { text: 'Pick a starting point. You choose who it applies to next.' }), list], actions: [{ label: 'Cancel', value: false }, { label: 'Next', kind: 'primary', value: true }] }))) return;
        const t = lib.find(q => q.key === pick);
        const rule = W().ruleFromLibrary(t.key, '', {});
        const made = await S.ruleDialog(env, rule, true);
        if (made) { cfg.rules.push(made); env.changed('rule'); redraw(); }
      } }),
      ui.button({ label: 'Custom rule…', icon: '＋', onClick: async () => {
        const made = await S.ruleDialog(env, { id: uniq(cfg.rules, 'rule'), name: 'My rule', on: true, scope: { kind: 'global', target: '' }, res: '*', mode: '', effect: { type: 'tariff', pct: 10, dir: 'in', amount: 0, to: '' }, when: { seasons: [] } }, true);
        if (made) { made.id = uniq(cfg.rules, made.id); cfg.rules.push(made); env.changed('rule'); redraw(); }
      } }),
    ]), cards.length ? h('div.sm-rules', cards) : h('p.gk-muted', { text: 'No rules yet. Without rules goods simply flow wherever prices pay.' }));
  };

  /* ---------------- the world: settings ---------------- */
  S.editWorld = function (host, env) {
    const cfg = env.cfg();
    GK.clear(host);
    const row = (label, hint, ctl) => ui.field({ label, hint, control: ctl });
    const cal = cfg.calendar || {};
    host.append(head('Simulation settings', 'How time runs and how strongly markets react.'), h('div.sm-grid', [
      row('One step is', 'Smaller steps are more detailed, larger ones run faster.', ui.segmented({ value: cfg.step || 'week', options: [['day', 'A day'], ['week', 'A week'], ['month', 'A month']], onChange: v => { cfg.step = v; env.changed('world'); } })),
      row('Random seed', 'The same seed replays the same raids and chances.', h('div.gk-row.nowrap', [txtIn(env.seed(), v => env.setSeed(v), { cls: 'sm-num' }), ui.button({ icon: '⚄', title: 'New seed', small: true, onClick: () => { env.setSeed(Math.random().toString(36).slice(2, 7)); S.editWorld(host, env); } })])),
      row('Stock held for (days)', 'Target cover that sets prices: below it goods get dear.', numIn(cfg.coverDays == null ? 20 : cfg.coverDays, v => { cfg.coverDays = Math.max(1, v || 20); env.changed('world'); })),
      row('Kept back before exporting (days)', 'A settlement keeps this many days of its own use (food: 2.5 times).', numIn(cfg.reserveDays == null ? 12 : cfg.reserveDays, v => { cfg.reserveDays = Math.max(0, v == null ? 12 : v); env.changed('world'); })),
      row('Price reaction', 'How strongly prices follow shortage and glut (0.9 = standard).', numIn(cfg.elasticity == null ? 0.9 : cfg.elasticity, v => { cfg.elasticity = v || 0.9; env.changed('world'); }, { step: 0.1 })),
      row('Transport cost', 'Coins per unit of bulk per travel day (carts; ships are cheaper).', numIn(cfg.costPerBulkDay == null ? 0.03 : cfg.costPerBulkDay, v => { cfg.costPerBulkDay = Math.max(0, v == null ? 0.03 : v); env.changed('world'); }, { step: 0.01 })),
      row('Chance of raids (x)', '0 turns raids off, 1 = as set on the routes, 2 = twice as likely.', numIn(cfg.randomness == null ? 1 : cfg.randomness, v => { cfg.randomness = Math.max(0, v == null ? 1 : v); env.changed('world'); }, { step: 0.5 })),
      row('Population growth (x)', '0 freezes population.', numIn(cfg.growth == null ? 1 : cfg.growth, v => { cfg.growth = Math.max(0, v == null ? 1 : v); env.changed('world'); }, { step: 0.5 })),
    ]), h('h4', { text: 'Seasons and dates' }),
    h('p.gk-small.gk-muted', { text: 'Year of ' + (cal.yearDays || 360) + ' days. Seasons: ' + ((cal.seasons || []).map(s => s.name + ' from day ' + s.from).join(', ') || 'none') + '. Starts on ' + (WB.cal && cfg.startDay != null ? WB.fmt.date({ day: cfg.startDay, prec: 'day' }) : 'day ' + (cfg.startDay || 0)) + '.' }),
    h('div.gk-row', [ui.button({ label: 'Use the world’s calendar and today’s date', icon: '▦', onClick: () => { env.useWorldCalendar(); S.editWorld(host, env); ui.toast('Seasons and dates now follow the world’s calendar', '▦'); } })]));
  };

  /* ---------------- compare ---------------- */
  S.editCompare = function (host, env) {
    const cfg = env.cfg(), st = env.ui;
    GK.clear(host);
    st.cmp = st.cmp || { toggle: [], steps: 52 };
    const out = h('div.sm-cmp-out');
    const chips = cfg.rules.map(r => ui.chip({ label: (r.on === false ? '○ ' : '● ') + r.name, on: st.cmp.toggle.includes(r.id), title: r.on === false ? 'Off now: the other run switches it on' : 'On now: the other run switches it off', onClick: e => { const on = !st.cmp.toggle.includes(r.id); st.cmp.toggle = st.cmp.toggle.filter(q => q !== r.id); if (on) st.cmp.toggle.push(r.id); e.currentTarget.classList.toggle('on', on); } }));
    const run = () => {
      const t = st.cmp.toggle; if (!t.length) return ui.toast('Pick at least one rule to flip', 'ℹ');
      const change = { off: cfg.rules.filter(r => t.includes(r.id) && r.on !== false).map(r => r.id), on: cfg.rules.filter(r => t.includes(r.id) && r.on === false).map(r => r.id) };
      const res = W().scenario(cfg, env.seed(), st.cmp.steps, change);
      paintResult(res, cfg.rules.filter(r => t.includes(r.id)));
    };
    function paintResult(res, flipped) {
      GK.clear(out);
      const A = res.baseTotals, B = res.altTotals;
      const pct = (a, b) => (a ? (b - a) / a * 100 : 0);
      const fmt = v => Math.round(v).toLocaleString();
      const rows = [['Total wealth (coins)', A.wealth, B.wealth], ['Population', A.pop, B.pop], ['Goods moved (last month)', A.flow, B.flow], ['Settlements short of something', A.shortages, B.shortages]];
      const chartHost = h('div.sm-chart-box');
      const days = res.base.days, tot = s => days.map((d, i) => Object.keys(s.wealthHistory).reduce((t, k) => t + (s.wealthHistory[k][i] || 0), 0));
      out.append(
        h('p.gk-small.gk-muted', { text: 'Run A is your rules as they are; run B flips: ' + flipped.map(r => r.name).join(', ') + '. Same seed, ' + st.cmp.steps + ' steps.' }),
        table([['', ''], ['A (as is)'], ['B (flipped)'], ['Change']], rows.map(([k, a, b]) => [k, fmt(a), fmt(b), h('b', { class: b > a ? 'sm-up' : b < a ? 'sm-down' : '', text: Math.abs(pct(a, b)) < 0.05 ? 'no change' : (b >= a ? '+' : '') + (Math.round(pct(a, b) * 10) / 10) + '%' })])),
        h('h4', { text: 'Total wealth over time' }), chartHost,
        h('h4', { text: 'By settlement' }),
        table([['Settlement'], ['Population A'], ['Population B'], ['Wealth A'], ['Wealth B']], res.base.nodes.map((n, i) => { const m = res.alt.nodes[i]; return [n.name, fmt(n.population), h('span', { class: m.population > n.population ? 'sm-up' : m.population < n.population ? 'sm-down' : '', text: fmt(m.population) }), fmt(n.wealth), h('span', { class: m.wealth > n.wealth ? 'sm-up' : m.wealth < n.wealth ? 'sm-down' : '', text: fmt(m.wealth) })]; })));
      const A1 = tot(res.base), B1 = tot(res.alt), calL = d => 'day ' + d;
      S.lineChart(chartHost, () => ({ xs: days, label: calL, series: [{ name: 'A (as is)', color: '#6fd0ff', values: A1, bold: true }, { name: 'B (flipped)', color: '#e0b84c', values: B1, bold: true }] }));
    }
    host.append(head('Compare', 'Run the same world twice with some rules flipped (on becomes off, off becomes on) and see what changes.'),
      ui.field({ label: 'Rules to flip', control: chips.length ? h('div.gk-row.sm-chips', chips) : h('span.gk-muted', { text: 'Add rules first.' }) }),
      h('div.gk-row', [ui.field({ label: 'Steps to run', control: numIn(st.cmp.steps, v => { st.cmp.steps = Math.max(4, Math.min(400, v || 52)); }) }), ui.button({ label: 'Compare', icon: '⇄', kind: 'primary', onClick: run })]), out);
  };
})();
