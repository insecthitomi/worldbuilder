/* Simulation: trade routes and resource allocation, driven by rules and customs. Pure and deterministic (seeded), no DOM.
   Model (one tick = one day, week or month, config.step):
     Resources   name, category, value (coins per unit), decay per day, bulk (transport weight), colour, terrain hints (from).
     Settlements stockpile, population, wealth, tech; Producers (gather/grow/mine, by terrain tag, season, labour, tech,
                 with finite deposits that regrow), Consumers (needs and wealth-dependent wants), Recipes (workshops).
     Routes      edges with distance, travel mode, risk, tolls, capacity, closed seasons. Goods travel as shipments
                 (they spend travel days in transit, can decay and be raided) and are carried where price differences pay.
     Prices      move with stock against a target cover of the local demand (scarce = dear, glut = cheap).
     Rules       data-driven customs: { scope, resource, when, effect }. Effects: embargo, tariff, toll, priceCap, priceFloor,
                 tithe, monopoly, demand, ration, forbidden, sacred, risk, output, freeTrade. No code is evaluated.
   Conservation: for every resource, stock + in transit = start + produced + crafted - consumed - used - decayed - lost - taxed.
   API: createState(config, seed) -> state; step(state, n) -> state (mutates and returns it); summarize(state);
        buildFromMap(input), autoFill(config), PRESETS, RULE_LIBRARY, describeRule, scenario. */
(function (root, factory) {
  const api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  else root.WBSim = api;
})(typeof self !== 'undefined' ? self : this, function () {
  'use strict';
  const clamp = (v, a, b) => Math.max(a, Math.min(b, v));
  const num = (v, d) => (Number.isFinite(+v) && v !== '' && v !== null ? +v : d);
  const slug = s => String(s || '').toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '') || 'x';
  const r2 = v => Math.round(v * 100) / 100;
  const PALETTE = ['#e0b84c', '#5fb3d4', '#d9715f', '#7bc47f', '#b48be0', '#e08fb5', '#4fb6b2', '#c9a27a', '#9aa5b1', '#e39a4a', '#8fd16b', '#6f8be0'];
  const CATEGORIES = ['food', 'material', 'luxury', 'labor', 'energy', 'service'];
  const SEASON_CLS = [[/summer|sun|high|dry/i, 'summer'], [/winter|cold|frost|snow|ice|dark/i, 'winter'], [/spring|thaw|bloom|seed|green|wet/i, 'spring'], [/autumn|fall|harvest|fog|reap|leaf/i, 'autumn']];
  const seasonClass = name => { for (const [re, c] of SEASON_CLS) if (re.test(name || '')) return c; return slug(name); };

  /* ---------------- seeded random: state.rng is a plain number so a state can be saved ---------------- */
  function hashSeed(s) {
    s = String(s == null ? '' : s);
    let h = 1779033703 ^ s.length;
    for (let i = 0; i < s.length; i++) { h = Math.imul(h ^ s.charCodeAt(i), 3432918353); h = (h << 13) | (h >>> 19); }
    h = Math.imul(h ^ (h >>> 16), 2246822507); h = Math.imul(h ^ (h >>> 13), 3266489909);
    return (h ^ (h >>> 16)) >>> 0;
  }
  function rand(st) {
    const a = (st.rng = (st.rng + 0x6D2B79F5) >>> 0);
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  }

  /* ---------------- travel modes (costMult = transport cost vs a cart) ---------------- */
  const MODES = [
    { mode: 'walk', label: 'On foot', perDay: 20, costMult: 1.8, capacity: 6 }, { mode: 'horse', label: 'Horse', perDay: 30, costMult: 1.3, capacity: 14 },
    { mode: 'cart', label: 'Cart', perDay: 18, costMult: 1, capacity: 40 }, { mode: 'ship', label: 'Ship', perDay: 100, costMult: .25, capacity: 300 },
    { mode: 'camel', label: 'Camel train', perDay: 22, costMult: 1.1, capacity: 30 }, { mode: 'freighter', label: 'Freighter', perDay: 20, costMult: .5, capacity: 400 },
    { mode: 'shuttle', label: 'Shuttle', perDay: 60, costMult: 1.4, capacity: 40 },
  ];
  const STEP_DAYS = { day: 1, week: 7, month: 30 };
  const EFFECTS = {
    embargo: { label: 'Embargo / ban', pct: false, dir: true, hint: 'No shipments of the good (in, out or both) in this scope.' },
    tariff: { label: 'Tariff', pct: true, dir: true, hint: 'Percent of the goods’ price paid by the importer to the settlement.' },
    toll: { label: 'Toll', pct: false, amount: true, hint: 'Coins per unit carried over the route.' },
    priceCap: { label: 'Price cap', pct: true, hint: 'Price may not exceed this percent of base value.' },
    priceFloor: { label: 'Price floor', pct: true, hint: 'Price may not fall below this percent of base value.' },
    tithe: { label: 'Tithe / tax in kind', pct: true, hint: 'Percent of production taken in kind, sent to a settlement (or consumed by the state).' },
    monopoly: { label: 'Guild monopoly', pct: true, hint: 'Restricts output by this percent and marks the price up by the same percent.' },
    demand: { label: 'Demand change', pct: true, hint: 'Percent change in demand (+60 = festival, -50 = fashion passes).' },
    ration: { label: 'Rationing', pct: true, hint: 'Consumption held to this percent of normal; the good is not exported.' },
    forbidden: { label: 'Forbidden good', pct: false, hint: 'Not made, eaten or imported here.' },
    sacred: { label: 'Sacred good', pct: false, hint: 'Made and used, but never sold out of the scope.' },
    risk: { label: 'Raid risk change', pct: true, hint: 'Percent change in the chance a shipment is raided (-50 = escorts, +100 = pirate season).' },
    output: { label: 'Output change', pct: true, hint: 'Percent change in production (-50 = blight, +25 = good harvest).' },
    freeTrade: { label: 'Free trade', pct: true, hint: 'Between settlements both in scope: no tariffs or tolls, and transport costs cut by this percent.' },
  };
  const SCOPES = ['global', 'faction', 'settlement', 'route', 'resource'];

  /* ---------------- normalising a config (UI-edited configs go through this) ---------------- */
  const DEF_CAL = { yearDays: 360, offset: 0, seasons: [{ name: 'Spring', from: 0 }, { name: 'Summer', from: 90 }, { name: 'Autumn', from: 180 }, { name: 'Winter', from: 270 }] };
  function normCal(c) {
    c = c || {};
    const yearDays = Math.max(1, Math.round(num(c.yearDays, 360)));
    let seasons = (Array.isArray(c.seasons) && c.seasons.length ? c.seasons : DEF_CAL.seasons).map(s => ({ name: String(s.name || 'Season'), cls: s.cls || seasonClass(s.name), from: clamp(Math.round(num(s.from, 0)), 0, yearDays - 1) }));
    seasons.sort((a, b) => a.from - b.from);
    if (seasons[0].from > 0) seasons.unshift(Object.assign({}, seasons[seasons.length - 1], { from: 0 }));
    return { yearDays, offset: Math.round(num(c.offset, 0)), seasons };
  }
  function seasonAt(cal, day) {
    const doy = (((Math.floor(day) + cal.offset) % cal.yearDays) + cal.yearDays) % cal.yearDays;
    let s = cal.seasons[0];
    for (const x of cal.seasons) if (x.from <= doy) s = x;
    return { name: s.name, cls: s.cls, doy };
  }
  const normMap = (m, f) => { const o = {}; for (const k of Object.keys(m || {})) { const v = num(m[k], null); if (v != null) o[f ? f(k) : k] = v; } return o; };

  function normResource(r, i) {
    return { id: r.id || slug(r.name), name: String(r.name || 'Resource ' + (i + 1)), category: CATEGORIES.includes(r.category) ? r.category : 'material', value: Math.max(0.01, num(r.value, 1)),
      decay: clamp(num(r.decay, 0), 0, 0.9), bulk: Math.max(0.001, num(r.bulk, 1)), icon: r.icon || '', color: r.color || PALETTE[i % PALETTE.length], from: normMap(r.from) };
  }
  function normNode(n, i, resIds) {
    const prod = (Array.isArray(n.producers) ? n.producers : []).filter(p => p && resIds.has(p.res)).map((p, k) => ({
      id: p.id || 'p' + k, res: p.res, perWorker: Math.max(0, num(p.perWorker, 0.1)), share: clamp(num(p.share, 0.3), 0, 1), terrain: normMap(p.terrain), season: normMap(p.season, k2 => k2.toLowerCase()),
      tech: Math.max(0, num(p.tech, 0)), deposit: p.deposit && +p.deposit.cap > 0 ? { cap: +p.deposit.cap, regrow: Math.max(0, num(p.deposit.regrow, 0)), start: p.deposit.start == null ? null : +p.deposit.start } : null }));
    const cons = (Array.isArray(n.consumers) ? n.consumers : []).filter(c => c && (resIds.has(c.res) || /^@/.test(c.res || ''))).map((c, k) => ({
      id: c.id || 'c' + k, res: c.res, per100: Math.max(0, num(c.per100, 1)), minWealth: Math.max(0, num(c.minWealth, 0)), kind: c.kind === 'want' ? 'want' : 'need', season: normMap(c.season, k2 => k2.toLowerCase()) }));
    const rec = (Array.isArray(n.recipes) ? n.recipes : []).filter(r => r && r.inputs && r.outputs).map((r, k) => ({
      id: r.id || 'r' + k, name: String(r.name || 'Workshop'), inputs: normMap(r.inputs), outputs: normMap(r.outputs), perDay: Math.max(0, num(r.perDay, 1)), workers: Math.max(1, num(r.workers, 5)), share: clamp(num(r.share, 0.08), 0, 1), tech: Math.max(0, num(r.tech, 0)) }));
    for (const r of rec) { for (const k of Object.keys(r.inputs)) if (!resIds.has(k)) delete r.inputs[k]; for (const k of Object.keys(r.outputs)) if (!resIds.has(k)) delete r.outputs[k]; }
    const stock = normMap(n.stock); for (const k of Object.keys(stock)) if (!resIds.has(k)) delete stock[k];
    return { id: n.id || 'n' + i, name: String(n.name || 'Settlement ' + (i + 1)), entryId: n.entryId || null, x: num(n.x, 0), y: num(n.y, 0), terrain: (Array.isArray(n.terrain) ? n.terrain : []).map(t => String(t).toLowerCase()),
      pop: Math.max(1, num(n.pop, 200)), wealth: Math.max(0, num(n.wealth, num(n.pop, 200) * 4)), tech: clamp(num(n.tech, 1), 0, 9), faction: n.faction || '', laborShare: clamp(num(n.laborShare, 0.4), 0.05, 1),
      producers: prod, consumers: cons, recipes: rec.filter(r => Object.keys(r.outputs).length), stock: Object.keys(stock).length || n.stock === null ? stock : null, note: n.note || '' };
  }
  function normRoute(r, i, nodeIds, modes) {
    const m = modes.find(x => x.mode === r.mode) || modes.find(x => x.mode === 'cart') || modes[0];
    return { id: r.id || 'r' + i, itemId: r.itemId || r.id || null, a: r.a, b: r.b, label: r.label || '', distance: Math.max(0.01, num(r.distance, 50)), mode: m.mode, perDay: num(r.perDay, 0) > 0 ? +r.perDay : 0,
      risk: clamp(num(r.risk, 0.02), 0, 1), toll: Math.max(0, num(r.toll, 0)), tollTo: r.tollTo || '', capacity: num(r.capacity, 0) > 0 ? +r.capacity : 0, closed: (Array.isArray(r.closed) ? r.closed : []).map(s => String(s).toLowerCase()),
      speed: normMap(r.speed, k => k.toLowerCase()), oneWay: !!r.oneWay, owner: r.owner || '' };
  }
  function normRule(r, i) {
    const e = r.effect || {}, w = r.when || {}, s = r.scope || {};
    return { id: r.id || 'rule-' + (i + 1), name: String(r.name || 'Rule ' + (i + 1)), on: r.on !== false, desc: r.desc || '', scope: { kind: SCOPES.includes(s.kind) ? s.kind : 'global', target: s.target || '' }, res: r.res || '*', mode: r.mode || '',
      effect: { type: EFFECTS[e.type] ? e.type : 'embargo', pct: num(e.pct, 0), dir: ['in', 'out', 'both'].includes(e.dir) ? e.dir : 'both', amount: num(e.amount, 0), to: e.to || '' },
      when: { seasons: (Array.isArray(w.seasons) ? w.seasons : []).map(x => String(x).toLowerCase()), from: w.from == null || w.from === '' ? null : Math.round(+w.from), to: w.to == null || w.to === '' ? null : Math.round(+w.to),
        cond: w.cond && w.cond.res ? { res: w.cond.res, metric: w.cond.metric === 'price' ? 'price' : 'cover', op: w.cond.op === '>' ? '>' : '<', value: num(w.cond.value, 1) } : null } };
  }
  function normalize(c) {
    c = c || {};
    const modes = MODES.map(m => Object.assign({}, m));
    for (const m of c.modes || []) { if (!m || !m.mode) continue; const ex = modes.find(x => x.mode === m.mode); if (ex) Object.assign(ex, { perDay: num(m.perDay, ex.perDay), costMult: num(m.costMult, ex.costMult), capacity: num(m.capacity, ex.capacity), label: m.label || ex.label }); else modes.push({ mode: m.mode, label: m.label || m.mode, perDay: num(m.perDay, 20), costMult: num(m.costMult, 1), capacity: num(m.capacity, 40) }); }
    const resources = (Array.isArray(c.resources) ? c.resources : []).map(normResource);
    const seen = new Set(); for (const r of resources) { let id = r.id, k = 2; while (seen.has(id)) id = r.id + '-' + k++; r.id = id; seen.add(id); }
    const nodes = (Array.isArray(c.nodes) ? c.nodes : []).map((n, i) => normNode(n, i, seen));
    const nid = new Set(); for (const n of nodes) { let id = n.id, k = 2; while (nid.has(id)) id = n.id + '-' + k++; n.id = id; nid.add(id); }
    const routes = (Array.isArray(c.routes) ? c.routes : []).filter(r => r && nid.has(r.a) && nid.has(r.b) && r.a !== r.b).map((r, i) => normRoute(r, i, nid, modes));
    const rid = new Set(); for (const r of routes) { let id = r.id, k = 2; while (rid.has(id)) id = r.id + '#' + k++; r.id = id; rid.add(id); }
    const step = STEP_DAYS[c.step] ? c.step : 'week';
    return { name: String(c.name || 'Simulation'), step, stepDays: STEP_DAYS[step], calendar: normCal(c.calendar), startDay: Math.round(num(c.startDay, 0)), modes, resources, nodes, routes, rules: (Array.isArray(c.rules) ? c.rules : []).map(normRule),
      coverDays: Math.max(1, num(c.coverDays, 20)), reserveDays: Math.max(0, num(c.reserveDays, 12)), initialCoverDays: Math.max(0, num(c.initialCoverDays, 15)), elasticity: clamp(num(c.elasticity, 0.9), 0.2, 2),
      costPerBulkDay: Math.max(0, num(c.costPerBulkDay, 0.03)), randomness: clamp(num(c.randomness, 1), 0, 3), growth: num(c.growth, 1), window: Math.max(1, Math.round(num(c.window, 30))) };
  }

  /* ---------------- rules ---------------- */
  function whenTime(w, season) {
    if (w.seasons.length && !w.seasons.includes(season.name.toLowerCase()) && !w.seasons.includes(season.cls)) return false;
    if (w.from != null && w.to != null) { const d = season.doy; if (w.from <= w.to ? (d < w.from || d > w.to) : (d < w.from && d > w.to)) return false; }
    return true;
  }
  const resHit = (st, rr, id) => {
    if (!rr || rr === '*') return true;
    if (rr.charAt(0) === '@') { const r = st.res[id]; return !!r && r.category === rr.slice(1); }
    return rr === id;
  };
  const nodeIn = (r, n) => !!n && (r.scope.kind === 'settlement' ? n.id === r.scope.target : r.scope.kind === 'faction' ? n.faction === r.scope.target : true);
  function condOk(st, r, c) {
    const k = r.when.cond; if (!k) return true;
    const n = c.node || c.to || c.from; if (!n) return true;
    const ns = st.nodes[n.id], rs = st.res[k.res]; if (!ns || !rs) return false;
    const v = k.metric === 'price' ? (ns.price[k.res] || rs.value) / rs.value : Math.min(ns.cover[k.res] == null ? 999 : ns.cover[k.res], 999);
    return k.op === '>' ? v > k.value : v < k.value;
  }
  /** the active rules of one effect type that touch this context { node | from, to, route, res } */
  function fx(st, type, c) {
    const list = st.act[type]; if (!list) return [];
    const out = [];
    for (const r of list) {
      if (c.res && !resHit(st, r.res, c.res)) continue;
      const k = r.scope.kind;
      if (k === 'route') { if (!c.route || c.route.id !== r.scope.target) continue; }
      else if (k === 'resource') { if (!c.res || r.scope.target !== c.res) continue; }
      else if (k !== 'global') {
        const d = r.effect.dir;
        const list2 = c.node ? [c.node] : type === 'freeTrade' ? null : d === 'in' ? [c.to] : d === 'out' ? [c.from] : [c.from, c.to];
        if (list2 ? !list2.some(n => nodeIn(r, n)) : !(nodeIn(r, c.from) && nodeIn(r, c.to))) continue;
      }
      if (r.mode && (!c.route || c.route.mode !== r.mode)) continue;
      if (!condOk(st, r, c)) continue;
      out.push(r);
    }
    return out;
  }
  const pctSum = rules => rules.reduce((s, r) => s + r.effect.pct, 0);

  /* ---------------- state ---------------- */
  function createState(config, seed) {
    const cfg = normalize(config);
    const st = { config: cfg, seed: seed == null ? 'seed' : String(seed), rng: 0, tick: 0, day: 0, res: {}, nodes: {}, byId: {}, routeById: {}, transit: [], ledger: {}, log: [], cool: {}, deposits: {}, act: {}, prevAct: {}, routeOpen: {},
      hist: { days: [], n: {}, flows: [], names: {} }, season: null, nextId: 1, avail: {} };
    st.rng = hashSeed(st.seed);
    for (const r of cfg.resources) { st.res[r.id] = r; st.ledger[r.id] = { start: 0, produced: 0, crafted: 0, consumed: 0, used: 0, decayed: 0, lost: 0, taxed: 0 }; }
    for (const n of cfg.nodes) st.byId[n.id] = n;
    for (const r of cfg.routes) st.routeById[r.id] = r;
    for (const r of cfg.routes) st.routeOpen[r.id] = true;
    // resources that exist somewhere in the network (a '@category' need is spread over these)
    const avail = {};
    for (const n of cfg.nodes) { for (const p of n.producers) avail[p.res] = 1; for (const r of n.recipes) for (const k of Object.keys(r.outputs)) avail[k] = 1; for (const k of Object.keys(n.stock || {})) avail[k] = 1; }
    st.avail = avail;
    st.season = seasonAt(cfg.calendar, 0);
    for (const n of cfg.nodes) {
      const ns = { id: n.id, pop: n.pop, wealth: n.wealth, stock: {}, price: {}, cover: {}, dem: {}, rdem: {}, last: { prod: {}, cons: {}, unmet: {}, crafted: {} }, sat: 1, income: 0, spent: 0, famine: 0 };
      st.nodes[n.id] = ns;
      for (const r of cfg.resources) { ns.stock[r.id] = 0; ns.price[r.id] = r.value; }
      for (const p of n.producers) if (p.deposit) st.deposits[n.id + ':' + p.id] = { amt: p.deposit.start == null ? p.deposit.cap : Math.min(p.deposit.cap, p.deposit.start), cap: p.deposit.cap };
    }
    st.act = {}; // no rules active when computing the opening demand; the first tick sets them
    for (const n of cfg.nodes) {
      const ns = st.nodes[n.id];
      demand(st, n, ns);
      for (const r of cfg.resources) {
        const given = n.stock && n.stock[r.id] != null;
        ns.stock[r.id] = given ? n.stock[r.id] : cfg.initialCoverDays * ((ns.dem[r.id] || 0) + (ns.rdem[r.id] || 0)) * (n.stock ? 1 : 1);
        st.ledger[r.id].start += ns.stock[r.id];
      }
    }
    for (const n of cfg.nodes) reprice(st, n, st.nodes[n.id]);
    record(st);
    return st;
  }

  /* ---------------- demand and prices ---------------- */
  function catRes(st, cat) { return st.config.resources.filter(r => r.category === cat && st.avail[r.id]); }
  function wantOf(st, n, ns, c, season) {
    const per = c.per100 * ns.pop / 100;
    const wf = c.minWealth > 0 ? clamp((ns.wealth / Math.max(1, ns.pop)) / c.minWealth, 0, 1) : 1;
    const sm = c.season[season.name.toLowerCase()] != null ? c.season[season.name.toLowerCase()] : c.season[season.cls] != null ? c.season[season.cls] : 1;
    return per * wf * sm;
  }
  /** per-day demand of one consumer line after customs, as { resId: units/day } shares */
  function consumerDemand(st, n, ns, c) {
    const list = c.res.charAt(0) === '@' ? catRes(st, c.res.slice(1)) : [st.res[c.res]];
    const out = [];
    const base = wantOf(st, n, ns, c, st.season) / Math.max(1, list.length);
    for (const r of list) {
      if (!r) continue;
      const ctx = { node: n, res: r.id };
      if (fx(st, 'forbidden', ctx).length) continue;
      let w = base * (1 + pctSum(fx(st, 'demand', ctx)) / 100);
      const rat = fx(st, 'ration', ctx); if (rat.length) w *= Math.min(...rat.map(x => x.effect.pct || 100)) / 100;
      out.push([r.id, Math.max(0, w), base * (1 + pctSum(fx(st, 'demand', ctx)) / 100)]);
    }
    return out;
  }
  function demand(st, n, ns) {
    ns.dem = {}; ns.rdem = {};
    for (const c of n.consumers) for (const [id, w] of consumerDemand(st, n, ns, c)) ns.dem[id] = (ns.dem[id] || 0) + w;
    const wf = ns.pop * n.laborShare;
    for (const rc of n.recipes) {
      const frac = Math.min(1, wf * rc.share / rc.workers);
      for (const k of Object.keys(rc.inputs)) ns.rdem[k] = (ns.rdem[k] || 0) + rc.inputs[k] * rc.perDay * frac;
    }
  }
  function reprice(st, n, ns) {
    const cfg = st.config;
    for (const r of cfg.resources) {
      const D = (ns.dem[r.id] || 0) + (ns.rdem[r.id] || 0);
      const target = Math.max(cfg.coverDays * D, 0.5 + ns.pop * 0.0005);
      const k = 0.25 * target + 0.5;
      let mul = clamp(Math.pow((target + k) / (ns.stock[r.id] + k), cfg.elasticity), 0.2, 8);
      const ctx = { node: n, res: r.id };
      const mono = fx(st, 'monopoly', ctx); if (mono.length) mul *= 1 + pctSum(mono) / 100;
      let p = r.value * mul;
      const cap = fx(st, 'priceCap', ctx); if (cap.length) p = Math.min(p, r.value * Math.min(...cap.map(x => x.effect.pct)) / 100);
      const fl = fx(st, 'priceFloor', ctx); if (fl.length) p = Math.max(p, r.value * Math.max(...fl.map(x => x.effect.pct)) / 100);
      ns.price[r.id] = p;
      ns.cover[r.id] = D > 1e-9 ? ns.stock[r.id] / D : 999;
      ns.target = ns.target || {}; ns.target[r.id] = target;
    }
  }

  /* ---------------- the event log ---------------- */
  function log(st, kind, text, o, key, cool) {
    key = key || kind + text;
    if (st.cool[key] != null && st.day < st.cool[key]) return;
    st.cool[key] = st.day + (cool == null ? 30 : cool);
    const e = Object.assign({ id: st.nextId++, day: st.day, kind, text }, o || {});
    st.log.push(e);
    if (st.log.length > 600) st.log.splice(0, st.log.length - 600);
  }

  /* ---------------- one tick ---------------- */
  function tick(st) {
    const cfg = st.config, dt = cfg.stepDays, day = st.day;
    const season = st.season = seasonAt(cfg.calendar, day);
    const nodes = cfg.nodes;
    // rules in force this tick
    st.act = {};
    const now = {};
    for (const r of cfg.rules) { if (!r.on || !whenTime(r.when, season)) continue; (st.act[r.effect.type] = st.act[r.effect.type] || []).push(r); now[r.id] = r; }
    if (st.tick > 0) for (const r of cfg.rules) {
      if (!r.on || (!r.when.seasons.length && r.when.from == null)) continue;
      if (now[r.id] && !st.prevAct[r.id]) log(st, 'rule', r.name + ' comes into force (' + describeRule(cfg, r) + ').', { rule: r.id }, 'rs' + r.id, dt);
      else if (!now[r.id] && st.prevAct[r.id]) log(st, 'rule', r.name + ' ends for now.', { rule: r.id }, 'rend' + r.id, dt);
    }
    st.prevAct = now;
    for (const r of cfg.routes) {
      const open = !(r.closed.includes(season.name.toLowerCase()) || r.closed.includes(season.cls));
      if (st.tick > 0 && open !== st.routeOpen[r.id]) log(st, 'route', routeName(st, r) + (open ? ' reopens.' : ' closes for the ' + season.name.toLowerCase() + '.'), { route: r.id }, 'rc' + r.id, dt);
      st.routeOpen[r.id] = open;
    }
    for (const n of nodes) { const ns = st.nodes[n.id]; ns.income = 0; ns.spent = 0; }
    // shipments that have arrived
    const stay = [];
    for (const s of st.transit) {
      if (s.arrive > day) { stay.push(s); continue; }
      const to = st.nodes[s.to], from = st.nodes[s.from];
      to.stock[s.res] += s.amt;
      const pay = s.amt * s.pay;
      to.wealth = Math.max(0, to.wealth - pay); to.spent += pay;
      if (s.tariff > 0) { to.wealth += s.tariff; to.income += s.tariff; }
      if (s.toll > 0) { const t = s.tollTo && st.nodes[s.tollTo] ? st.nodes[s.tollTo] : null; if (t) { t.wealth += s.toll; t.income += s.toll; } else { from.wealth += s.toll / 2; to.wealth += s.toll / 2; from.income += s.toll / 2; to.income += s.toll / 2; } }
    }
    st.transit = stay;
    for (const n of nodes) {
      const ns = st.nodes[n.id];
      for (const k of ['prod', 'cons', 'unmet', 'crafted']) ns.last[k] = {};
    }
    // demand under today's customs, then production, workshops and consumption
    for (const n of nodes) demand(st, n, st.nodes[n.id]);
    for (const n of nodes) produce(st, n, st.nodes[n.id], dt, season);
    for (const n of nodes) consume(st, n, st.nodes[n.id], dt, season);
    // decay
    for (const n of nodes) {
      const ns = st.nodes[n.id];
      for (const r of cfg.resources) if (r.decay > 0 && ns.stock[r.id] > 0) { const loss = ns.stock[r.id] * (1 - Math.pow(1 - r.decay, dt)); ns.stock[r.id] -= loss; st.ledger[r.id].decayed += loss; }
    }
    for (const n of nodes) { demand(st, n, st.nodes[n.id]); reprice(st, n, st.nodes[n.id]); }
    trade(st, dt);
    for (const n of nodes) { const ns = st.nodes[n.id]; ns.wealth = Math.max(0, ns.wealth - ns.wealth * 0.004 * dt); }
    watch(st);
    st.tick++; st.day += dt;
    record(st);
  }

  const routeName = (st, r) => r.label || (st.byId[r.a].name + ' – ' + st.byId[r.b].name);

  function produce(st, n, ns, dt, season) {
    const cfg = st.config, work = ns.pop * n.laborShare;
    const total = n.producers.reduce((s, p) => s + p.share, 0), scale = total > 1 ? 1 / total : 1;
    const rec = st.ledger;
    for (const p of n.producers) {
      const res = st.res[p.res];
      const ctx = { node: n, res: p.res };
      if (fx(st, 'forbidden', ctx).length) continue;
      const tkeys = Object.keys(p.terrain);
      const tm = tkeys.length ? Math.max(0, ...tkeys.filter(t => n.terrain.includes(t)).map(t => p.terrain[t])) : 1;
      if (!(tm > 0) || n.tech < p.tech) continue;
      const sm = p.season[season.name.toLowerCase()] != null ? p.season[season.name.toLowerCase()] : p.season[season.cls] != null ? p.season[season.cls] : 1;
      let out = p.perWorker * work * p.share * scale * tm * sm * (1 + 0.12 * Math.max(0, n.tech - p.tech)) * dt;
      out *= Math.max(0, 1 + pctSum(fx(st, 'output', ctx)) / 100);
      const mono = fx(st, 'monopoly', ctx); if (mono.length) out *= Math.max(0, 1 - pctSum(mono) / 100);
      const dep = st.deposits[n.id + ':' + p.id];
      if (dep) {
        dep.amt = Math.min(dep.cap, dep.amt + dep.cap * p.deposit.regrow * dt);
        out *= clamp(dep.amt / (0.3 * dep.cap), 0, 1);
        out = Math.min(out, dep.amt); dep.amt -= out;
        if (dep.amt < 0.05 * dep.cap && !dep.warned) { dep.warned = 1; log(st, 'depleted', 'The ' + res.name.toLowerCase() + ' at ' + n.name + ' is nearly exhausted.', { node: n.id, res: res.id }, 'dep' + n.id + p.id, 120); }
        if (dep.amt > 0.2 * dep.cap) dep.warned = 0;
      }
      if (out <= 0) continue;
      ns.stock[p.res] += out; rec[p.res].produced += out;
      ns.last.prod[p.res] = (ns.last.prod[p.res] || 0) + out / dt;
      ns.wealth += 0.25 * out * res.value;
      for (const t of fx(st, 'tithe', ctx)) {
        const take = Math.min(ns.stock[p.res], out * t.effect.pct / 100);
        ns.stock[p.res] -= take;
        const dest = t.effect.to && st.nodes[t.effect.to];
        if (dest && dest !== ns) dest.stock[p.res] += take; else if (dest) ns.stock[p.res] += take; else rec[p.res].taxed += take;
      }
    }
    // workshops
    const need = {}; for (const c of n.consumers) for (const [id, w] of consumerDemand(st, n, ns, c)) need[id] = (need[id] || 0) + w;
    for (const rc of n.recipes) {
      if (n.tech < rc.tech) continue;
      let b = rc.perDay * dt * Math.min(1, work * rc.share / rc.workers);
      for (const k of Object.keys(rc.inputs)) { const usable = Math.max(0, ns.stock[k] - (need[k] || 0) * st.config.reserveDays * 0.5); b = Math.min(b, usable / rc.inputs[k]); }
      for (const k of Object.keys(rc.outputs)) if (fx(st, 'forbidden', { node: n, res: k }).length) b = 0;
      if (!(b > 1e-9)) continue;
      for (const k of Object.keys(rc.inputs)) { ns.stock[k] -= rc.inputs[k] * b; rec[k].used += rc.inputs[k] * b; }
      for (const k of Object.keys(rc.outputs)) { ns.stock[k] += rc.outputs[k] * b; rec[k].crafted += rc.outputs[k] * b; ns.last.crafted[k] = (ns.last.crafted[k] || 0) + rc.outputs[k] * b / dt; ns.wealth += 0.2 * rc.outputs[k] * b * st.res[k].value; }
    }
  }

  function consume(st, n, ns, dt, season) {
    let wantNeed = 0, gotNeed = 0, wantOth = 0, gotOth = 0;
    for (const c of n.consumers) {
      const lines = consumerDemand(st, n, ns, c);
      if (!lines.length) continue;
      // cheapest first for '@category' needs
      lines.sort((a, b) => ns.price[a[0]] - ns.price[b[0]]);
      const list = lines;
      const raw = wantOf(st, n, ns, c, season) * dt;
      let remain = list.reduce((s, l) => s + l[1], 0) * dt, eaten = 0;
      const fullWant = raw * (1 + pctSum(fx(st, 'demand', { node: n, res: list.length ? list[0][0] : '' })) / 100);
      for (const [id] of list) {
        if (remain <= 0) break;
        const eat = Math.min(ns.stock[id], remain);
        ns.stock[id] -= eat; remain -= eat; eaten += eat;
        st.ledger[id].consumed += eat;
        ns.last.cons[id] = (ns.last.cons[id] || 0) + eat / dt;
      }
      // cheapest-first spills over to the other goods of the category when a good runs out
      if (c.res.charAt(0) === '@' && remain > 1e-9) {
        for (const r of catRes(st, c.res.slice(1))) {
          if (remain <= 0) break;
          if (fx(st, 'forbidden', { node: n, res: r.id }).length) continue;
          const eat = Math.min(ns.stock[r.id], remain); if (eat <= 0) continue;
          ns.stock[r.id] -= eat; remain -= eat; eaten += eat; st.ledger[r.id].consumed += eat; ns.last.cons[r.id] = (ns.last.cons[r.id] || 0) + eat / dt;
        }
      }
      const wanted = Math.max(fullWant, 1e-12);
      const unmet = Math.max(0, wanted - eaten);
      if (unmet > 1e-9) { const id = c.res; ns.last.unmet[id] = (ns.last.unmet[id] || 0) + unmet / dt; }
      if (c.kind === 'need' && fullWant > 0) {
        if (c.res === '@food' || (st.res[c.res] && st.res[c.res].category === 'food')) { wantNeed += wanted; gotNeed += Math.min(eaten, wanted); } else { wantOth += wanted; gotOth += Math.min(eaten, wanted); }
      }
    }
    const sat = (wantNeed > 0 ? gotNeed / wantNeed : 1) * 0.85 + (wantOth > 0 ? gotOth / wantOth : 1) * 0.15;
    ns.sat = ns.sat * 0.5 + sat * 0.5;
    const g = st.config.growth;
    if (sat >= 0.95) ns.pop += ns.pop * 0.00012 * dt * g;
    else if (sat < 0.8) ns.pop = Math.max(1, ns.pop - ns.pop * (0.8 - sat) * 0.002 * dt * g);
    ns.famine = sat < 0.6 ? ns.famine + 1 : 0;
  }

  /* ---------------- trade: shipments along routes where prices pay ---------------- */
  function travelDays(st, r) {
    const m = st.config.modes.find(x => x.mode === r.mode);
    const sm = r.speed[st.season.name.toLowerCase()] != null ? r.speed[st.season.name.toLowerCase()] : r.speed[st.season.cls] != null ? r.speed[st.season.cls] : 1;
    return Math.max(0.05, r.distance / ((r.perDay || m.perDay) * Math.max(0.05, sm)));
  }
  /** days of own use a settlement keeps back before exporting (food is stored for the lean season) */
  const reserveOf = (st, res) => st.config.reserveDays * (res.category === 'food' ? 2.5 : 1);
  function trade(st, dt) {
    const cfg = st.config, cand = [];
    const inbound = {};
    for (const s of st.transit) { const k = s.to + '|' + s.res; inbound[k] = (inbound[k] || 0) + s.amt; }
    cfg.routes.forEach((r, ri) => {
      const open = st.routeOpen[r.id];
      const td = travelDays(st, r), m = cfg.modes.find(x => x.mode === r.mode);
      const dirs = r.oneWay ? [[r.a, r.b, 0]] : [[r.a, r.b, 0], [r.b, r.a, 1]];
      for (const [fa, tb, di] of dirs) {
        const from = st.byId[fa], to = st.byId[tb], fs = st.nodes[fa], ts = st.nodes[tb];
        for (let xi = 0; xi < cfg.resources.length; xi++) {
          const res = cfg.resources[xi], id = res.id;
          const pf = fs.price[id], pt = ts.price[id];
          const ctx = { route: r, from, to, res: id };
          if (pt <= pf * 1.04) continue;
          const Dfrom = (fs.dem[id] || 0) + (fs.rdem[id] || 0);
          const avail = fs.stock[id] - reserveOf(st, res) * Dfrom;
          if (!(avail > 1e-6)) continue;
          const a = Math.pow(1 - res.decay, td);
          const free = fx(st, 'freeTrade', ctx);
          const cut = free.length ? Math.min(100, pctSum(free)) / 100 : 0;
          const tariffRules = free.length ? [] : fx(st, 'tariff', ctx);
          const tariff = pctSum(tariffRules) / 100 * pt;
          const tollRules = free.length ? [] : fx(st, 'toll', ctx);
          const toll = r.toll + tollRules.reduce((s, x) => s + x.effect.amount, 0);
          const cost = res.bulk * td * cfg.costPerBulkDay * m.costMult * (1 - cut) + toll;
          const margin = pt * a - pf - cost - tariff;
          if (margin <= 0.04 * pf) continue;
          // customs that forbid this shipment
          const blocker = !open ? 'closed' : fx(st, 'embargo', ctx)[0] || fx(st, 'forbidden', { node: to, res: id })[0] || fx(st, 'sacred', { node: from, res: id })[0] || fx(st, 'ration', { node: from, res: id })[0];
          if (blocker) {
            if (blocker !== 'closed') log(st, 'embargo', (blocker.effect.type === 'embargo' ? 'Trade in ' : 'Customs on ') + res.name.toLowerCase() + ' blocks the flow ' + from.name + ' → ' + to.name + ' (' + blocker.name + ').', { route: r.id, res: id, node: to.id, rule: blocker.id }, 'emb' + blocker.id + r.id + di, 120);
            continue;
          }
          cand.push({ r, ri, di, from, to, fs, ts, res, xi, pf, pt, td, a, margin, cost, tariff, toll, dens: margin / res.bulk, tollTo: r.tollTo, m, tollN: toll });
        }
      }
    });
    cand.sort((x, y) => y.dens - x.dens || (x.r.id < y.r.id ? -1 : 1));
    const used = {}, raid = {};
    for (const c of cand) {
      const key = c.r.id + '|' + c.di;
      const capTotal = (c.r.capacity || c.m.capacity) * dt;
      const left = capTotal - (used[key] || 0);
      if (left <= 1e-9) continue;
      const id = c.res.id;
      const Dfrom = (c.fs.dem[id] || 0) + (c.fs.rdem[id] || 0);
      const avail = c.fs.stock[id] - reserveOf(st, c.res) * Dfrom;
      const room = Math.max(0, 2 * (c.ts.target[id] || 1) - c.ts.stock[id] - (inbound[c.to.id + '|' + id] || 0));
      let amt = Math.min(avail * 0.45 * Math.min(1, c.margin / (0.3 * c.pf + 1e-9)), room, left / c.res.bulk);
      if (!(amt > 1e-4)) continue;
      used[key] = (used[key] || 0) + amt * c.res.bulk;
      c.fs.stock[id] -= amt;
      c.fs.wealth += amt * c.pf; c.fs.income += amt * c.pf;
      let arrive = amt, lostAmt = 0;
      const ctxR = { route: c.r, from: c.from, to: c.to, res: id };
      const risk = clamp(c.r.risk * Math.max(0, 1 + pctSum(fx(st, 'risk', ctxR)) / 100) * cfg.randomness * Math.min(1.2, Math.max(0.2, c.td / 12)), 0, 0.95);
      let roll = raid[key];
      if (!roll) { roll = raid[key] = { hit: risk > 0 && rand(st) < risk, frac: 0.3 + 0.7 * rand(st), lost: 0, goods: [] }; }
      if (roll.hit) {
        lostAmt = amt * roll.frac; arrive = amt - lostAmt; st.ledger[id].lost += lostAmt; roll.lost += lostAmt * c.res.value; roll.goods.push(c.res.name.toLowerCase());
        log(st, 'raid', 'Raiders hit a caravan on ' + routeName(st, c.r) + ' and take ' + Math.round(roll.frac * 100) + '% of it (' + roll.goods.slice(0, 3).join(', ') + ').', { route: c.r.id, res: id, node: c.to.id }, 'raid' + c.r.id, Math.max(7, cfg.stepDays));
      }
      const arrived = arrive * c.a;
      st.ledger[id].decayed += arrive - arrived;
      st.transit.push({ route: c.r.id, from: c.from.id, to: c.to.id, res: id, amt: arrived, sent: st.day, arrive: st.day + c.td, pay: c.pt, tariff: arrived * c.tariff, toll: amt * c.tollN, tollTo: c.tollTo });
      inbound[c.to.id + '|' + id] = (inbound[c.to.id + '|' + id] || 0) + arrived;
      st.flowNow.push([c.ri, c.di, c.xi, amt]);
    }
    // (money: the seller is paid at departure by the merchants; the buyer pays them at arrival, see tick())
  }

  /* ---------------- watching for things worth telling ---------------- */
  function watch(st) {
    const cfg = st.config;
    for (const n of cfg.nodes) {
      const ns = st.nodes[n.id];
      if (ns.famine >= 2) log(st, 'famine', 'Famine in ' + n.name + ': the hungry outnumber the fed (' + Math.round(ns.pop) + ' people, ' + Math.round(ns.sat * 100) + '% fed).', { node: n.id }, 'fam' + n.id, 90);
      for (const c of n.consumers) {
        if (c.kind !== 'need') continue;
        const ids = c.res.charAt(0) === '@' ? [] : [c.res];
        for (const id of ids) {
          const r = st.res[id];
          if (ns.dem[id] > 1e-9 && ns.cover[id] < 3 && !(ns.famine >= 2)) log(st, 'shortage', 'Shortage of ' + r.name.toLowerCase() + ' in ' + n.name + ' (' + (Math.round(ns.cover[id] * 10) / 10) + ' days left).', { node: n.id, res: id }, 'sh' + n.id + id, 60);
        }
      }
      const needs = new Set(n.consumers.filter(c => c.kind === 'need' && c.res.charAt(0) !== '@').map(c => c.res));
      for (const r of cfg.resources) if (needs.has(r.id) && ns.price[r.id] > 3.2 * r.value && ns.dem[r.id] > 0) log(st, 'price', r.name + ' costs ' + Math.round(ns.price[r.id] / r.value * 10) / 10 + ' times its usual price in ' + n.name + '.', { node: n.id, res: r.id }, 'pr' + n.id + r.id, 90);
    }
  }

  function record(st) {
    const h = st.hist, cfg = st.config;
    h.days.push(st.day);
    for (const n of cfg.nodes) {
      const ns = st.nodes[n.id];
      const e = h.n[n.id] || (h.n[n.id] = { wealth: [], pop: [], price: {}, stock: {} });
      e.wealth.push(r2(ns.wealth)); e.pop.push(Math.round(ns.pop));
      for (const r of cfg.resources) { (e.price[r.id] = e.price[r.id] || []).push(r2(ns.price[r.id])); (e.stock[r.id] = e.stock[r.id] || []).push(r2(ns.stock[r.id])); }
    }
    h.flows.push(st.flowNow || []);
    st.flowNow = [];
    if (h.days.length > 2600) trimHistory(h, 2000);
  }
  function trimHistory(h, keep) {
    const cut = h.days.length - keep; if (cut <= 0) return;
    h.days.splice(0, cut); h.flows.splice(0, cut);
    for (const id of Object.keys(h.n)) { const e = h.n[id]; e.wealth.splice(0, cut); e.pop.splice(0, cut); for (const k of Object.keys(e.price)) e.price[k].splice(0, cut); for (const k of Object.keys(e.stock)) e.stock[k].splice(0, cut); }
    h.offset = (h.offset || 0) + cut;
  }

  /** runs n ticks (mutates and returns the state) */
  function step(st, n) {
    n = Math.max(0, Math.floor(n == null ? 1 : n));
    if (!st.flowNow) st.flowNow = [];
    // record() at creation pushed index 0 with day 0; the first tick overwrites nothing: history[i] = state after i ticks
    for (let i = 0; i < n; i++) tick(st);
    return st;
  }

  /* ---------------- reading results ---------------- */
  /** flows in a window of ticks [t0, t1) of history as [{route, from, to, res, amount}] */
  function flowsBetween(st, t0, t1) {
    const cfg = st.config, agg = {};
    for (let i = Math.max(0, t0); i < Math.min(st.hist.flows.length, t1); i++) {
      for (const f of st.hist.flows[i]) {
        const r = cfg.routes[f[0]]; if (!r) continue;
        const k = f[0] + '|' + f[1] + '|' + f[2];
        agg[k] = (agg[k] || 0) + f[3];
      }
    }
    return Object.keys(agg).map(k => {
      const [ri, di, xi] = k.split('|').map(Number), r = cfg.routes[ri];
      return { route: r.id, from: di ? r.b : r.a, to: di ? r.a : r.b, res: cfg.resources[xi].id, amount: agg[k] };
    }).sort((a, b) => b.amount - a.amount);
  }
  function summarize(st, o) {
    o = o || {};
    const cfg = st.config, h = st.hist, last = h.days.length;
    const wTicks = Math.max(1, Math.round((o.window || cfg.window) / cfg.stepDays));
    const flows = flowsBetween(st, last - wTicks, last);
    const nodes = cfg.nodes.map(n => {
      const ns = st.nodes[n.id], surplus = {}, shortage = {};
      for (const r of cfg.resources) {
        const target = ns.target ? ns.target[r.id] : 0, D = (ns.dem[r.id] || 0) + (ns.rdem[r.id] || 0);
        if (ns.stock[r.id] > target * 1.6 + 1) surplus[r.id] = ns.stock[r.id] - target * 1.6;
        if (D > 1e-9 && ns.cover[r.id] < cfg.coverDays * 0.35) shortage[r.id] = Math.max(0, (cfg.coverDays * 0.5) * D - ns.stock[r.id]);
      }
      return { id: n.id, name: n.name, entryId: n.entryId, x: n.x, y: n.y, population: Math.round(ns.pop), wealth: Math.round(ns.wealth), sat: ns.sat, stock: ns.stock, surplus, shortage, income: ns.income, spent: ns.spent };
    });
    const prices = {}; for (const n of cfg.nodes) prices[n.id] = Object.assign({}, st.nodes[n.id].price);
    const shortages = [];
    for (const nd of nodes) for (const id of Object.keys(nd.shortage)) shortages.push({ node: nd.id, res: id, deficit: nd.shortage[id], cover: st.nodes[nd.id].cover[id] });
    shortages.sort((a, b) => a.cover - b.cover);
    const wealthHistory = {}; for (const n of cfg.nodes) wealthHistory[n.id] = (h.n[n.id] || { wealth: [] }).wealth.slice();
    const rflow = {}; for (const f of flows) { rflow[f.route] = (rflow[f.route] || 0) + f.amount * st.res[f.res].bulk; }
    return { day: st.day, tick: st.tick, season: st.season, nodes, flows, prices, shortages, wealthHistory, days: h.days.slice(), routeVolume: rflow, events: st.log.slice() };
  }
  /** goods balance per resource (should be ~0 whenever the engine is right) */
  function balance(st) {
    const out = {};
    for (const r of st.config.resources) {
      let have = 0; for (const n of st.config.nodes) have += st.nodes[n.id].stock[r.id];
      for (const s of st.transit) if (s.res === r.id) have += s.amt;
      const l = st.ledger[r.id];
      out[r.id] = have - (l.start + l.produced + l.crafted - l.consumed - l.used - l.decayed - l.lost - l.taxed);
    }
    return out;
  }
  /** the pieces of the contract the Atlas reads: x,y in map pixels, resources by name */
  function atlasResult(st, o) {
    const s = summarize(st, o), cfg = st.config, name = id => st.res[id].name;
    const top = (obj, n) => { const out = {}; Object.keys(obj).sort((a, b) => obj[b] - obj[a]).slice(0, n).forEach(k => { out[name(k)] = Math.round(obj[k] * 10) / 10; }); return out; };
    const used = new Set();
    const flows = s.flows.slice(0, 120).map(f => {
      used.add(f.res); const r = st.routeById[f.route];
      return { fromItemId: f.from, toItemId: f.to, routeItemId: r.itemId || r.id, resource: name(f.res), amount: Math.round(f.amount * 10) / 10 };
    });
    for (const n of s.nodes) { for (const k of Object.keys(n.surplus)) used.add(k); for (const k of Object.keys(n.shortage)) used.add(k); }
    return { day: s.day, nodes: s.nodes.map(n => ({ itemId: n.id, entryId: n.entryId || null, x: Math.round(n.x), y: Math.round(n.y), population: n.population, wealth: n.wealth, surplus: top(n.surplus, 4), shortage: top(n.shortage, 4) })),
      flows, resources: cfg.resources.filter(r => used.has(r.id)).map(r => ({ name: r.name, color: r.color })) };
  }

  /* ---------------- describing rules in words ---------------- */
  function describeRule(cfg, r) {
    const rn = id => { if (!id || id === '*') return 'all goods'; if (id.charAt(0) === '@') return id.slice(1) + ' goods'; const x = (cfg.resources || []).find(q => q.id === id); return x ? x.name.toLowerCase() : id; };
    const e = r.effect, sc = r.scope;
    const nm = id => { const n = (cfg.nodes || []).find(q => q.id === id); return n ? n.name : id; };
    const where = sc.kind === 'global' ? 'everywhere' : sc.kind === 'faction' ? 'for ' + sc.target : sc.kind === 'settlement' ? 'at ' + nm(sc.target) : sc.kind === 'route' ? 'on ' + (((cfg.routes || []).find(q => q.id === sc.target) || {}).label || sc.target) : 'for ' + rn(sc.target);
    const dir = e.dir === 'in' ? ' coming in' : e.dir === 'out' ? ' going out' : '';
    const w = r.when || { seasons: [] }, when = (w.seasons && w.seasons.length ? ' in ' + w.seasons.join('/') : '') + (w.cond ? ', while ' + rn(w.cond.res) + ' ' + (w.cond.metric === 'price' ? 'price' : 'cover') + ' ' + w.cond.op + ' ' + w.cond.value : '');
    const g = rn(r.res), mode = r.mode ? ' (' + r.mode + ' routes)' : '';
    let t;
    switch (e.type) {
      case 'embargo': t = (g === 'all goods' ? 'all trade' : 'no trade in ' + g) + dir + ' ' + where; break;
      case 'tariff': t = e.pct + '% tariff on ' + g + dir + ' ' + where; break;
      case 'toll': t = e.amount + ' coins toll per unit of ' + g + ' ' + where; break;
      case 'priceCap': t = g + ' price capped at ' + e.pct + '% ' + where; break;
      case 'priceFloor': t = g + ' price at least ' + e.pct + '% ' + where; break;
      case 'tithe': t = e.pct + '% of ' + g + ' taken in kind ' + where + (e.to ? ', sent to ' + nm(e.to) : ''); break;
      case 'monopoly': t = 'guild monopoly on ' + g + ' ' + where + ' (' + e.pct + '% less output, dearer)'; break;
      case 'demand': t = 'demand for ' + g + ' ' + (e.pct >= 0 ? '+' : '') + e.pct + '% ' + where; break;
      case 'ration': t = g + ' rationed to ' + e.pct + '% ' + where; break;
      case 'forbidden': t = g + ' forbidden ' + where; break;
      case 'sacred': t = g + ' sacred, never sold out ' + where; break;
      case 'risk': t = 'raid risk ' + (e.pct >= 0 ? '+' : '') + e.pct + '% ' + where; break;
      case 'output': t = g + ' output ' + (e.pct >= 0 ? '+' : '') + e.pct + '% ' + where; break;
      case 'freeTrade': t = 'free trade ' + where + ', transport ' + e.pct + '% cheaper'; break;
      default: t = e.type;
    }
    return t + mode + when;
  }

  /* ---------------- rule library: templates the user picks and points at a place, a faction, a route or a good ---------------- */
  const RULE_LIBRARY = [
    { key: 'embargo-export', name: 'Export ban', ask: 'settlement', res: 'grain', effect: { type: 'embargo', dir: 'out' }, desc: 'A settlement keeps a good at home, e.g. a grain export ban in a lean year.' },
    { key: 'embargo-war', name: 'Trade embargo', ask: 'faction', res: '*', effect: { type: 'embargo', dir: 'both' }, desc: 'A faction is cut off from trade (war, sanctions).' },
    { key: 'winter-sea', name: 'Winter sailing ban', ask: null, res: '*', mode: 'ship', effect: { type: 'embargo', dir: 'both' }, when: { seasons: ['winter'] }, desc: 'No ships sail in winter.' },
    { key: 'winter-pass', name: 'Mountain pass shut in winter', ask: 'route', res: '*', effect: { type: 'embargo', dir: 'both' }, when: { seasons: ['winter'] }, desc: 'A route is closed by snow.' },
    { key: 'tariff', name: 'Crown tariff', ask: 'settlement', res: '*', effect: { type: 'tariff', pct: 8, dir: 'in' }, desc: 'A settlement taxes every import.' },
    { key: 'luxury-duty', name: 'Duty on luxuries', ask: 'faction', res: '@luxury', effect: { type: 'tariff', pct: 20, dir: 'in' }, desc: 'Heavy duty on luxury imports.' },
    { key: 'toll', name: 'Toll road', ask: 'route', res: '*', effect: { type: 'toll', amount: 0.15 }, desc: 'A coin per load on a route.' },
    { key: 'free-trade', name: 'Free trade pact', ask: 'faction', res: '*', effect: { type: 'freeTrade', pct: 25 }, desc: 'Allied settlements pay no tariffs or tolls and ship more cheaply.' },
    { key: 'price-cap', name: 'Bread price cap', ask: 'settlement', res: 'grain', effect: { type: 'priceCap', pct: 140 }, desc: 'The magistrate caps the price of a staple (and merchants stop bringing it).' },
    { key: 'price-floor', name: 'Guaranteed price', ask: 'faction', res: 'grain', effect: { type: 'priceFloor', pct: 80 }, desc: 'The state buys at a minimum price so producers do not collapse.' },
    { key: 'tithe', name: 'Church tithe', ask: 'faction', res: '@food', effect: { type: 'tithe', pct: 10, to: '' }, desc: 'A tenth of the harvest goes to the temple.' },
    { key: 'monopoly', name: 'Guild monopoly', ask: 'settlement', res: 'iron-goods', effect: { type: 'monopoly', pct: 25 }, desc: 'A guild holds back output to keep prices high.' },
    { key: 'festival', name: 'Harvest festival', ask: null, res: '@luxury', effect: { type: 'demand', pct: 80 }, when: { seasons: ['autumn'] }, desc: 'Everyone wants wine and finery after the harvest.' },
    { key: 'feast-day', name: 'Midwinter feast', ask: null, res: '@food', effect: { type: 'demand', pct: 30 }, when: { seasons: ['winter'] }, desc: 'The big meal of the year.' },
    { key: 'rationing', name: 'Famine rationing', ask: 'settlement', res: '@food', effect: { type: 'ration', pct: 75 }, when: { cond: { res: 'grain', metric: 'cover', op: '<', value: 8 } }, desc: 'Rationing begins when the granary runs low; food is not exported.' },
    { key: 'sacred', name: 'Sacred animal', ask: 'faction', res: 'meat', effect: { type: 'sacred' }, desc: 'Made and used but never sold out.' },
    { key: 'forbidden', name: 'Forbidden good', ask: 'faction', res: 'wine', effect: { type: 'forbidden' }, desc: 'Not made, eaten or imported (a faith, a law).' },
    { key: 'pirates', name: 'Pirate season', ask: null, res: '*', mode: 'ship', effect: { type: 'risk', pct: 150 }, when: { seasons: ['summer'] }, desc: 'Raiders hunt the sea lanes in summer.' },
    { key: 'escort', name: 'Royal patrols', ask: 'faction', res: '*', effect: { type: 'risk', pct: -60 }, desc: 'Soldiers escort the roads.' },
    { key: 'blight', name: 'Blight', ask: 'settlement', res: 'grain', effect: { type: 'output', pct: -50 }, when: { seasons: ['summer', 'autumn'] }, desc: 'A crop disease.' },
    { key: 'subsidy', name: 'Bumper harvest', ask: 'faction', res: '@food', effect: { type: 'output', pct: 25 }, desc: 'Good rains and new tools.' },
  ];

  /* ---------------- building from a map ---------------- */
  const TERRAIN_WORDS = [[/sea|coast|harbou?r|port\b|bay|shore|dock|wharf|fishing|salt ?marsh|beach/, 'coast'], [/river|ford|bridge|delta|lake|mill|riverside/, 'river'], [/forest|wood|grove|timber|jungle|thicket/, 'forest'],
    [/hill|down|moor|upland|highland|fell/, 'hills'], [/mountain|peak|mine|mining|quarry|pass\b|crag|range|iron/, 'mountain'], [/desert|dune|sand|waste|dry|arid/, 'desert'], [/oasis|wells?\b|spring/, 'oasis'],
    [/fen|marsh|swamp|bog|mire|salt ?flat/, 'swamp'], [/tundra|ice|snow|glacier|frozen|polar|arctic/, 'tundra'], [/jungle|tropic|rainforest/, 'jungle'], [/island|isle|atoll|cay/, 'island'],
    [/plain|field|farm|meadow|grassland|pasture|steppe|fertile|vale|village|hamlet|wheat/, 'plains'], [/asteroid|belt|rock field/, 'asteroid'], [/moon|lunar/, 'moon'], [/station|orbital|habitat|dock ring/, 'station'],
    [/gas giant|skimmer|nebula/, 'gas'], [/planet|colony|terraform/, 'planet']];
  function inferTerrain(text) {
    const t = String(text || '').toLowerCase(), out = [];
    for (const [re, tag] of TERRAIN_WORDS) if (re.test(t) && !out.includes(tag)) out.push(tag);
    return out;
  }
  const sizeOf = p => (p >= 8000 ? 'metropolis' : p >= 2500 ? 'city' : p >= 800 ? 'town' : 'village');
  /** pins -> settlements and path items -> routes. input: { items, width, height, unitsPerPx, modes, cal } (all plain data) */
  function buildFromMap(input) {
    const items = input.items || [], W = input.width || 1000, H = input.height || 700;
    const upp = input.unitsPerPx > 0 ? input.unitsPerPx : 1000 / W;
    const modes = (input.modes && input.modes.length ? input.modes : MODES).slice();
    const nodes = [];
    const regions = items.filter(i => i.kind === 'region' && i.points && i.points.length > 2);
    const inPoly = (x, y, pts) => { let inside = false; for (let i = 0, j = pts.length - 1; i < pts.length; j = i++) { const xi = pts[i][0], yi = pts[i][1], xj = pts[j][0], yj = pts[j][1]; if ((yi > y) !== (yj > y) && x < ((xj - xi) * (y - yi)) / (yj - yi) + xi) inside = !inside; } return inside; };
    for (const it of items) {
      if (it.kind !== 'pin' || !it.entryId) continue;
      const here = regions.filter(r => inPoly(it.x, it.y, r.points));
      const text = [it.title, it.label, it.kind2, it.climate, it.economy, it.icon, ...here.map(r => r.label || r.title)].filter(Boolean).join(' ');
      const pop = it.population > 0 ? it.population : /capital|city|port|metropolis/i.test(text + ' ' + (it.icon || '')) ? 3000 : /town/i.test(text) ? 1200 : 400;
      nodes.push({ id: it.id, entryId: it.entryId, name: it.title || it.label || 'Settlement', x: it.x, y: it.y, pop, terrain: inferTerrain(text), faction: it.faction || (here[0] && (here[0].title || here[0].label)) || '', tech: pop > 2500 ? 2 : 1 });
    }
    const routes = [];
    const tol = Math.max(8, 0.012 * Math.hypot(W, H));
    const segDist = (px, py, a, b) => { const dx = b[0] - a[0], dy = b[1] - a[1], l = dx * dx + dy * dy; let t = l ? ((px - a[0]) * dx + (py - a[1]) * dy) / l : 0; t = clamp(t, 0, 1); return [Math.hypot(a[0] + t * dx - px, a[1] + t * dy - py), t]; };
    for (const it of items) {
      if (it.kind !== 'path' || !it.points || it.points.length < 2) continue;
      const pts = it.points, cum = [0];
      for (let i = 1; i < pts.length; i++) cum.push(cum[i - 1] + Math.hypot(pts[i][0] - pts[i - 1][0], pts[i][1] - pts[i - 1][1]));
      const near = [];
      for (const n of nodes) {
        let best = Infinity, at = 0;
        for (let i = 0; i < pts.length - 1; i++) { const [d, t] = segDist(n.x, n.y, pts[i], pts[i + 1]); if (d < best) { best = d; at = cum[i] + t * (cum[i + 1] - cum[i]); } }
        if (best <= tol) near.push({ n, at });
      }
      near.sort((a, b) => a.at - b.at);
      const mode = (it.style && it.style.mode) || ((it.style && /sea|river|ship|lane/i.test(it.style.kind || '')) ? 'ship' : 'cart');
      const k = near.length > 2 ? near.length - 1 : 1;
      for (let i = 0; i + 1 < near.length; i++) {
        const a = near[i], b = near[i + 1]; if (a.n === b.n) continue;
        routes.push({ id: it.id + (near.length > 2 ? '#' + (i + 1) : ''), itemId: it.id, a: a.n.id, b: b.n.id, label: (it.label || '') && near.length <= 2 ? it.label : '', distance: Math.max(0.1, (b.at - a.at) * upp), mode: modes.some(m => m.mode === mode) ? mode : 'cart', risk: /wild|forest|pass|mountain/i.test(it.label || '') ? 0.06 : 0.025 });
        void k;
      }
    }
    return { nodes, routes, unit: input.unit || 'miles', skippedPins: items.filter(i => i.kind === 'pin' && !i.entryId).length };
  }

  /* ---------------- auto-fill: producers, needs and workshops from terrain and population ---------------- */
  const TECH_WORKSHOP = [{ out: 'iron-goods', in: { 'iron-ore': 2, timber: 0.5 }, minPop: 500, name: 'Smithy' }, { out: 'cloth', in: { wool: 2 }, minPop: 300, name: 'Weavers' }, { out: 'bread', in: { grain: 1.2 }, minPop: 900, name: 'Bakers' }, { out: 'alloys', in: { ore: 2, fuel: 1 }, minPop: 300, name: 'Foundry' }, { out: 'electronics', in: { alloys: 1, ore: 0.5 }, minPop: 600, name: 'Fabricators' }, { out: 'medicine', in: { food: 1, chemicals: 1 }, minPop: 400, name: 'Clinic labs' }];
  function autoFill(config, o) {
    o = o || {};
    const cfg = JSON.parse(JSON.stringify(config)), res = cfg.resources || [];
    const byId = {}; for (const r of res) byId[r.id || slug(r.name)] = r;
    for (const r of res) r.id = r.id || slug(r.name);
    const ids = new Set(res.map(r => r.id));
    for (const n of cfg.nodes || []) {
      const hasP = (n.producers || []).length, hasC = (n.consumers || []).length, hasR = (n.recipes || []).length;
      const tags = (n.terrain || []).map(t => t.toLowerCase());
      if (!hasP || o.force) {
        const opts = res.map(r => { const ks = Object.keys(r.from || {}).filter(k => tags.includes(k)); const y = ks.length ? Math.max(...ks.map(k => r.from[k])) : 0; return { r, y, ks }; }).filter(x => x.y > 0);
        const food = opts.filter(x => x.r.category === 'food').sort((a, b) => b.y - a.y).slice(0, 2);
        const nonFood = opts.filter(x => x.r.category !== 'food' && x.r.category !== 'service').sort((a, b) => b.y * b.r.value - a.y * a.r.value);
        const energy = nonFood.filter(x => x.r.category === 'energy').sort((a, b) => b.y - a.y)[0];
        const other = (energy ? [energy] : []).concat(nonFood.filter(x => x !== energy)).slice(0, 3);
        const boost = x => (x.r.category === 'food' ? 1.3 : 1);
        const mk = (x, share) => ({ id: 'p-' + x.r.id, res: x.r.id, perWorker: Math.round(x.y * boost(x) * 10000) / 10000, share, terrain: Object.fromEntries(x.ks.map(k => [k, x.r.from[k] / x.y])),
          season: x.r.category === 'food' && !tags.includes('station') && !tags.includes('asteroid') && !tags.includes('moon') ? { winter: .5, spring: .9, summer: 1.2, autumn: 1.5 } : {}, deposit: /ore|stone|gems|iron|ice|gold|silver|jade/.test(x.r.id) ? { cap: Math.round(x.y * n.pop * 40), regrow: 0.0002 } : /timber|fish/.test(x.r.id) ? { cap: Math.round(x.y * n.pop * 60), regrow: 0.004 } : null });
        n.producers = [].concat(food.map(x => mk(x, (other.length ? 0.6 : 0.85) / food.length)), other.map(x => mk(x, 0.4 / other.length)));
        if (!food.length && res.length) { const f = res.find(r => r.category === 'food'); if (f) n.producers.unshift({ id: 'p-sub-' + f.id, res: f.id, perWorker: 0.1, share: 0.5, terrain: {}, season: {} }); }
      }
      if (!hasC || o.force) {
        const c = [];
        if (res.some(r => r.category === 'food')) c.push({ id: 'c-food', res: '@food', per100: 2, kind: 'need' });
        for (const r of res) {
          if (r.id === 'salt') c.push({ id: 'c-salt', res: r.id, per100: 0.08, kind: 'need' });
          else if (r.category === 'energy') c.push({ id: 'c-' + r.id, res: r.id, per100: 0.4, kind: 'need', season: { winter: 2.5, summer: 0.4 } });
          else if (r.category === 'luxury') c.push({ id: 'c-' + r.id, res: r.id, per100: r.value > 50 ? 0.01 : 0.05, minWealth: Math.round(Math.min(18, 1.5 + Math.log10(r.value + 1) * 3) * 10) / 10, kind: 'want' });
          else if (/tools|goods|cloth|alloys|electronics|medicine|textile/.test(r.id)) c.push({ id: 'c-' + r.id, res: r.id, per100: 0.06, minWealth: 1, kind: /medicine/.test(r.id) ? 'need' : 'want' });
        }
        n.consumers = c.filter(x => ids.has(x.res) || /^@/.test(x.res));
      }
      if (!hasR || o.force) {
        n.recipes = [];
        for (const w of TECH_WORKSHOP) {
          if (n.pop < w.minPop || !ids.has(w.out) || !Object.keys(w.in).every(k => ids.has(k))) continue;
          n.recipes.push({ id: 'r-' + w.out, name: w.name, inputs: w.in, outputs: { [w.out]: 1 }, perDay: Math.max(0.2, n.pop / 400), workers: Math.max(3, n.pop / 150), share: 0.1 });
        }
      }
      if (n.tech == null) n.tech = n.pop > 3000 ? 3 : 1;
    }
    return cfg;
  }

  /* ---------------- scenarios: the same world with some rules switched ---------------- */
  function scenario(config, seed, steps, change) {
    const run = cfg => summarize(step(createState(cfg, seed), steps));
    const base = JSON.parse(JSON.stringify(config));
    const alt = JSON.parse(JSON.stringify(config));
    for (const r of alt.rules || []) { if ((change.off || []).includes(r.id)) r.on = false; if ((change.on || []).includes(r.id)) r.on = true; }
    const a = run(base), b = run(alt);
    const tot = s => ({ wealth: s.nodes.reduce((t, n) => t + n.wealth, 0), pop: s.nodes.reduce((t, n) => t + n.population, 0), flow: s.flows.reduce((t, f) => t + f.amount, 0), shortages: s.shortages.length });
    return { base: a, alt: b, baseTotals: tot(a), altTotals: tot(b) };
  }

  function validate(config) {
    const c = normalize(config), out = [];
    if (!c.nodes.length) out.push('No settlements yet.');
    if (c.nodes.length && !c.routes.length) out.push('No routes: settlements cannot trade.');
    if (!c.resources.length) out.push('No resources yet.');
    const linked = new Set(); for (const r of c.routes) { linked.add(r.a); linked.add(r.b); }
    for (const n of c.nodes) if (c.routes.length && !linked.has(n.id)) out.push(n.name + ' has no route.');
    for (const n of c.nodes) if (!n.consumers.length && !n.producers.length) out.push(n.name + ' neither produces nor needs anything (try Auto-fill).');
    return out;
  }

  /* ---------------- presets ---------------- */
  const R = (name, category, value, bulk, decay, from, icon) => ({ name, category, value, bulk, decay, from: from || {}, icon: icon || '' });
  const MEDIEVAL_RES = [
    R('Grain', 'food', 2, 1, 0.0008, { plains: .14, river: .1, hills: .05, coast: .04 }, '⚘'), R('Fish', 'food', 3, 1, 0.04, { coast: .12, river: .08, island: .1 }, '≈'), R('Meat', 'food', 5, 1, 0.02, { plains: .04, hills: .07, forest: .04 }, '♨'),
    R('Salt', 'material', 6, .8, 0, { coast: .05, desert: .03, swamp: .04 }, '◇'), R('Timber', 'material', 3, 2.5, 0, { forest: .16, hills: .02 }, '▲'), R('Stone', 'material', 4, 3, 0, { mountain: .09, hills: .05 }, '■'),
    R('Iron ore', 'material', 6, 2, 0, { mountain: .09, hills: .03 }, '◆'), R('Iron goods', 'material', 28, 1, 0, {}, '⚒'), R('Wool', 'material', 8, .6, 0, { hills: .05, plains: .03 }, '☁'),
    R('Cloth', 'material', 22, .6, 0, {}, '☖'), R('Firewood', 'energy', 1.5, 2, 0, { forest: .2, swamp: .05 }, '♨'), R('Wine', 'luxury', 14, 1, 0.001, { hills: .03, plains: .015, coast: .02 }, '☕'),
    R('Spice', 'luxury', 60, .1, 0, { jungle: .008, island: .006 }, '❀'), R('Furs', 'luxury', 30, .5, 0, { forest: .02, tundra: .04 }, '☃'), R('Gems', 'luxury', 90, .05, 0, { mountain: .004 }, '◈'),
  ];
  const withIds = list => list.map(r => Object.assign({ id: slug(r.name) }, r));
  const N = (id, name, x, y, pop, terrain, extra) => Object.assign({ id, name, x, y, pop, terrain }, extra || {});
  const Rt = (id, a, b, distance, mode, extra) => Object.assign({ id, a, b, distance, mode }, extra || {});
  const BASE_CAL = { generic: true, yearDays: 360, offset: 0, seasons: [{ name: 'Spring', from: 0 }, { name: 'Summer', from: 90 }, { name: 'Autumn', from: 180 }, { name: 'Winter', from: 270 }] };
  const ruleFrom = (key, over) => {
    const t = RULE_LIBRARY.find(x => x.key === key) || {};
    return Object.assign({ id: key + (over && over.target ? '-' + over.target : ''), name: t.name, on: true, desc: t.desc, res: t.res || '*', mode: t.mode || '', effect: Object.assign({ pct: 0, dir: 'both', amount: 0, to: '' }, t.effect), when: Object.assign({ seasons: [] }, t.when), scope: { kind: t.ask || 'global', target: '' } }, over && over.rule);
  };
  /** library template -> rule object ready to add (target = the id of the settlement / faction / route / resource it is aimed at) */
  function ruleFromLibrary(key, target, over) {
    const r = ruleFrom(key, { target }); r.scope.target = target || '';
    if (!r.scope.kind) r.scope.kind = 'global';
    r.id = key + '-' + Math.random().toString(36).slice(2, 7);
    if (over) Object.assign(r, over);
    return r;
  }
  const PRESETS = [
    { id: 'kingdom', name: 'Medieval kingdom', desc: 'A river valley realm: a capital, market towns, a port, mines in the hills and a rival league across the border. Roads close in winter, tithes and tariffs shape the flow.',
      make() {
        const cfg = { name: 'Medieval kingdom', step: 'week', calendar: BASE_CAL, resources: withIds(MEDIEVAL_RES), startDay: 0,
          nodes: [N('crown', 'Crownhold', 500, 300, 6000, ['plains', 'river'], { faction: 'Kingdom', tech: 3, wealth: 40000 }), N('mill', 'Millbrook', 330, 380, 1200, ['plains', 'river'], { faction: 'Kingdom' }), N('ash', 'Ashford', 660, 360, 1600, ['plains', 'river'], { faction: 'Kingdom' }),
            N('grey', 'Greywatch', 300, 160, 900, ['mountain', 'hills'], { faction: 'Kingdom' }), N('salt', 'Saltmere', 540, 540, 2600, ['coast'], { faction: 'Kingdom', tech: 2 }), N('pine', 'Pinewood', 680, 160, 700, ['forest', 'hills'], { faction: 'Kingdom' }),
            N('high', 'Highfell', 150, 90, 500, ['mountain'], { faction: 'Kingdom' }), N('dusk', 'Duskhaven', 820, 520, 1700, ['coast', 'hills'], { faction: 'Kingdom' }), N('east', 'Eastmarch', 880, 290, 2200, ['plains', 'hills'], { faction: 'Eastern League', tech: 2 })],
          routes: [Rt('r1', 'crown', 'mill', 95, 'cart'), Rt('r2', 'crown', 'ash', 90, 'cart'), Rt('r3', 'crown', 'grey', 120, 'cart', { risk: .04 }), Rt('r4', 'crown', 'salt', 110, 'cart'), Rt('r5', 'ash', 'pine', 110, 'cart', { risk: .06 }), Rt('r6', 'grey', 'high', 85, 'walk', { closed: ['winter'], speed: { autumn: .7 } }),
            Rt('r7', 'salt', 'dusk', 330, 'ship', { risk: .05 }), Rt('r8', 'ash', 'east', 120, 'cart', { toll: .2 }), Rt('r9', 'mill', 'grey', 90, 'cart'), Rt('r10', 'crown', 'pine', 140, 'cart', { risk: .05 }), Rt('r11', 'east', 'dusk', 230, 'cart', { risk: .05 })],
          rules: [] };
        const f = autoFill(cfg);
        f.rules = [ruleFromLibrary('tariff', 'crown', { id: 'crown-tariff', name: 'Crown tariff (8% on imports)' }), ruleFromLibrary('tithe', 'Kingdom', { id: 'church-tithe', name: 'Church tithe (10% of food)', effect: { type: 'tithe', pct: 10, dir: 'both', amount: 0, to: 'crown' } }),
          ruleFromLibrary('festival', '', { id: 'harvest-festival', name: 'Harvest festival (autumn)' }), ruleFromLibrary('winter-sea', '', { id: 'winter-sea', name: 'No sailing in winter' }),
          ruleFromLibrary('embargo-war', 'Eastern League', { id: 'league-embargo', name: 'Embargo on the Eastern League', on: false }), ruleFromLibrary('price-cap', 'crown', { id: 'bread-cap', name: 'Bread price cap in Crownhold', on: false }),
          ruleFromLibrary('monopoly', 'grey', { id: 'smith-guild', name: 'Smiths’ guild monopoly', on: false, res: 'iron-goods' })];
        const gw = f.nodes.find(n => n.id === 'grey'); if (gw) gw.recipes = (gw.recipes || []).concat([]);
        return f;
      } },
    { id: 'islands', name: 'Island archipelago', desc: 'A sea of small islands linked by ships. Fish, spice, ore and pearls; monsoon storms close lanes, pirates strike in summer, a league keeps free trade.',
      make() {
        const res = withIds(MEDIEVAL_RES.filter(r => ['Fish', 'Grain', 'Salt', 'Timber', 'Iron ore', 'Iron goods', 'Cloth', 'Wool', 'Wine', 'Spice', 'Firewood', 'Gems'].includes(r.name)).map(r => Object.assign({}, r)));
        res.push({ id: 'pearls', name: 'Pearls', category: 'luxury', value: 120, bulk: .03, decay: 0, from: { island: .003, coast: .004 }, icon: '○' }, { id: 'coconuts', name: 'Coconuts', category: 'food', value: 1.5, bulk: 1, decay: .004, from: { island: .12, jungle: .1 }, icon: '◔' });
        const cfg = { name: 'Island archipelago', step: 'week', calendar: { yearDays: 360, offset: 40, seasons: [{ name: 'Dry', cls: 'summer', from: 0 }, { name: 'Storm season', cls: 'winter', from: 180 }] }, resources: res,
          nodes: [N('vela', 'Port Vela', 480, 300, 4200, ['coast', 'island', 'plains'], { faction: 'Vela League', tech: 3 }), N('coral', 'Coral Cay', 250, 190, 900, ['island', 'coast'], { faction: 'Vela League' }), N('spice', 'Spice Isle', 760, 160, 1500, ['island', 'jungle'], { faction: 'Vela League' }),
            N('iron', 'Ironrock', 800, 430, 1100, ['island', 'mountain'], { faction: 'Free Isles' }), N('fish', 'Fishers’ Reach', 220, 430, 1300, ['island', 'coast'], { faction: 'Free Isles' }), N('pearl', 'Pearl Atoll', 520, 90, 600, ['island', 'coast'], { faction: 'Vela League' }), N('storm', 'Stormwatch', 520, 520, 700, ['island', 'hills'], { faction: 'Free Isles' })],
          routes: [Rt('s1', 'vela', 'coral', 300, 'ship', { risk: .04 }), Rt('s2', 'vela', 'spice', 360, 'ship', { risk: .05 }), Rt('s3', 'vela', 'iron', 380, 'ship', { risk: .05 }), Rt('s4', 'vela', 'fish', 300, 'ship'), Rt('s5', 'vela', 'pearl', 220, 'ship'), Rt('s6', 'vela', 'storm', 240, 'ship', { risk: .08 }),
            Rt('s7', 'coral', 'fish', 260, 'ship'), Rt('s8', 'spice', 'iron', 310, 'ship', { risk: .07 }), Rt('s9', 'storm', 'iron', 300, 'ship', { risk: .09 }), Rt('s10', 'storm', 'fish', 300, 'ship', { risk: .06 })],
          rules: [] };
        const f = autoFill(cfg);
        f.rules = [ruleFromLibrary('pirates', '', { id: 'pirates', name: 'Pirate season (dry months)', when: { seasons: ['dry'], from: null, to: null, cond: null } }), ruleFromLibrary('winter-sea', '', { id: 'storms', name: 'Storm lanes closed (storm season)', when: { seasons: ['storm season'] }, mode: 'ship', effect: { type: 'embargo', pct: 0, dir: 'both', amount: 0, to: '' }, res: '*', on: true }),
          ruleFromLibrary('free-trade', 'Vela League', { id: 'vela-free', name: 'Vela League free trade' }), ruleFromLibrary('luxury-duty', 'Free Isles', { id: 'free-duty', name: 'Free Isles duty on luxuries', on: false }), ruleFromLibrary('toll', 's1', { id: 'cay-toll', name: 'Coral Cay harbour dues', on: false })];
        return f;
      } },
    { id: 'silkroad', name: 'Silk-road caravans', desc: 'Oasis towns strung across a desert. Silk, jade, spice and glass travel by camel; bandits, wells and a winter-blocked pass decide who gets rich.',
      make() {
        const res = withIds([R('Water', 'food', 1, 2, 0, { oasis: .12, river: .1 }), R('Dates', 'food', 3, 1, .006, { oasis: .12 }), R('Grain', 'food', 2.5, 1, .001, { plains: .12, river: .08 }), R('Horses', 'material', 60, 2, 0, { plains: .004, hills: .003 }), R('Silk', 'luxury', 110, .1, 0, { plains: .004, river: .003 }), R('Jade', 'luxury', 140, .3, 0, { mountain: .003 }),
          R('Spice', 'luxury', 70, .1, 0, { jungle: .008 }), R('Tea', 'luxury', 25, .3, .0008, { hills: .02 }), R('Glass', 'material', 35, .6, 0, { desert: .02 }), R('Salt', 'material', 6, .8, 0, { desert: .04 }), R('Dung fuel', 'energy', 1, 1, 0, { desert: .08, plains: .04, oasis: .05 })]);
        const cfg = { name: 'Silk-road caravans', step: 'week', calendar: BASE_CAL, resources: res,
          nodes: [N('jade', 'Jadegate', 90, 260, 5000, ['plains', 'river'], { faction: 'Empire of Han-Lu', tech: 3 }), N('wells', 'Redsand Wells', 290, 330, 500, ['desert', 'oasis'], { faction: 'Free Tribes' }), N('kara', 'Karavan Hold', 480, 250, 2200, ['desert', 'oasis'], { faction: 'Free Tribes', tech: 2 }), N('pass', 'Skyfang Pass', 480, 90, 400, ['mountain'], { faction: 'Free Tribes' }),
            N('sam', 'Samarind', 700, 300, 4000, ['plains', 'river', 'oasis'], { faction: 'Sultanate', tech: 3 }), N('tars', 'Tarsun Bazaar', 880, 200, 3000, ['plains', 'hills'], { faction: 'Sultanate', tech: 2 }), N('mir', 'Mirage Port', 890, 470, 2500, ['coast', 'desert'], { faction: 'Sultanate' }), N('dune', 'Dune Wells', 640, 480, 300, ['desert', 'oasis'], { faction: 'Free Tribes' })],
          routes: [Rt('c1', 'jade', 'wells', 220, 'camel', { risk: .06 }), Rt('c2', 'wells', 'kara', 190, 'camel', { risk: .08, toll: .3 }), Rt('c3', 'kara', 'sam', 230, 'camel', { risk: .07 }), Rt('c4', 'sam', 'tars', 190, 'camel', { toll: .2 }), Rt('c5', 'kara', 'pass', 165, 'camel', { closed: ['winter'], risk: .1 }), Rt('c6', 'pass', 'tars', 420, 'camel', { closed: ['winter'], risk: .1 }),
            Rt('c7', 'sam', 'mir', 260, 'camel'), Rt('c8', 'kara', 'dune', 260, 'camel', { risk: .09 }), Rt('c9', 'dune', 'mir', 260, 'camel', { risk: .09 }), Rt('c10', 'jade', 'pass', 480, 'camel', { risk: .08, closed: ['winter'] })],
          rules: [] };
        const f = autoFill(cfg);
        f.rules = [ruleFromLibrary('toll', 'c2', { id: 'wells-toll', name: 'Tribal passage fee at the wells', effect: { type: 'toll', pct: 0, dir: 'both', amount: .3, to: '' } }), ruleFromLibrary('monopoly', 'jade', { id: 'silk-mono', name: 'Imperial silk monopoly', res: 'silk', effect: { type: 'monopoly', pct: 30, dir: 'both', amount: 0, to: '' } }),
          ruleFromLibrary('tariff', 'Sultanate', { id: 'sultan-tariff', name: 'Sultanate import duty 12%', effect: { type: 'tariff', pct: 12, dir: 'in', amount: 0, to: '' } }), ruleFromLibrary('escort', 'Empire of Han-Lu', { id: 'imperial-escort', name: 'Imperial caravan escorts', on: false }),
          ruleFromLibrary('embargo-war', 'Sultanate', { id: 'sultan-embargo', name: 'Sultanate closes its markets', on: false })];
        return f;
      } },
    { id: 'frontier', name: 'Space frontier', desc: 'A chain of stations, mines and a young colony. Ice, ore and fuel flow in; alloys, electronics and medicine flow out. Quarantine and fuel taxes bite.',
      make() {
        const res = withIds([R('Food', 'food', 6, 1, .004, { planet: .1, station: .03 }), R('Water ice', 'material', 3, 2, 0, { moon: .1, asteroid: .06 }), R('Ore', 'material', 8, 2, 0, { asteroid: .12, moon: .05 }), R('Fuel', 'energy', 14, 1, 0, { gas: .14, moon: .02 }), R('Alloys', 'material', 40, 1, 0, {}), R('Electronics', 'material', 90, .2, 0, {}),
          R('Medicine', 'service', 120, .1, .002, {}), R('Chemicals', 'material', 25, .5, 0, { gas: .05, moon: .03 }), R('Spirits', 'luxury', 40, .4, 0, { planet: .02, station: .01 }), R('Repairs', 'service', 30, 0, 0, { station: .02 })]);
        res.find(r => r.id === 'repairs').bulk = 0.01;
        const cfg = { name: 'Space frontier', step: 'week', calendar: { yearDays: 360, offset: 0, seasons: [{ name: 'Cycle', from: 0 }] }, resources: res,
          nodes: [N('haven', 'Haven Station', 480, 300, 8000, ['station'], { faction: 'Concord', tech: 5, wealth: 90000 }), N('belt', 'Ore Belt Alpha', 220, 170, 1200, ['asteroid', 'station'], { faction: 'Miners’ Guild', tech: 3 }), N('thule', 'Ice Moon Thule', 220, 440, 1500, ['moon', 'station'], { faction: 'Miners’ Guild', tech: 3 }),
            N('vell', 'Vell Skimmer', 760, 150, 900, ['gas', 'station'], { faction: 'Concord', tech: 4 }), N('nova', 'Terra Nova', 760, 460, 6000, ['planet'], { faction: 'Terra Nova Colony', tech: 4 }), N('relay', 'Outer Relay', 500, 540, 500, ['station'], { faction: 'Free Ports', tech: 4 })],
          routes: [Rt('f1', 'haven', 'belt', 90, 'freighter', { risk: .03 }), Rt('f2', 'haven', 'thule', 90, 'freighter'), Rt('f3', 'haven', 'vell', 120, 'freighter', { risk: .02 }), Rt('f4', 'haven', 'nova', 140, 'freighter'), Rt('f5', 'haven', 'relay', 100, 'shuttle', { risk: .08 }), Rt('f6', 'belt', 'thule', 100, 'freighter', { risk: .06 }), Rt('f7', 'nova', 'relay', 130, 'shuttle', { risk: .08 }), Rt('f8', 'vell', 'nova', 150, 'freighter')],
          rules: [] };
        const f = autoFill(cfg);
        f.rules = [ruleFromLibrary('tariff', 'haven', { id: 'fuel-tax', name: 'Haven docking tax 6%', effect: { type: 'tariff', pct: 6, dir: 'in', amount: 0, to: '' } }), ruleFromLibrary('escort', 'Concord', { id: 'patrol', name: 'Concord navy patrols' }), ruleFromLibrary('embargo-war', 'Terra Nova Colony', { id: 'quarantine', name: 'Quarantine of Terra Nova', on: false }),
          ruleFromLibrary('rationing', 'haven', { id: 'air-ration', name: 'Food rationing on Haven when low', on: true, res: 'food', when: { seasons: [], cond: { res: 'food', metric: 'cover', op: '<', value: 6 } } }), ruleFromLibrary('free-trade', 'Miners’ Guild', { id: 'guild-free', name: 'Miners’ Guild internal free trade' })];
        return f;
      } },
  ];
  const presetConfig = id => { const p = PRESETS.find(x => x.id === id); return p ? p.make() : null; };

  return { createState, step, summarize, balance, atlasResult, flowsBetween, normalize, validate, buildFromMap, autoFill, inferTerrain, scenario, describeRule, ruleFromLibrary, presetConfig, seasonAt, seasonClass, slug,
    PRESETS, RULE_LIBRARY, EFFECTS, SCOPES, CATEGORIES, MODES, PALETTE, STEP_DAYS, MEDIEVAL_RES, sizeOf, travelDays: (st, r) => travelDays(st, st.config.routes.find(x => x.id === r) || r) };
});
