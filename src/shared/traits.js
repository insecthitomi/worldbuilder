/* People & attributes engine: axes (classifications such as Race, Class, Caste, Order…) with nested values, attribute
   systems (STR/DEX…, Body/Mind/Spirit…, any set) with derived formulas and per-value modifiers, per-value vocabulary
   and naming style, starter packs, migration and import/export. Pure: no DOM, no database. Works in node and the
   browser (WBTraits). The config lives in the world settings under `traits` and carries a version number.

   Data on an entry:
     `axis`  field value  { [axisId]: [valueId, …] }
     `attrs` field value  { [systemId]: { [attrKey]: base } }
   Formulas are parsed by a small recursive-descent parser and evaluated over a tree: no eval, no Function. */
(function (root, factory) {
  const api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  else root.WBTraits = api;
})(typeof self !== 'undefined' ? self : this, function () {
  'use strict';

  const VERSION = 1;
  const FORMAT = 'worldbuilder-traits';
  const KINDS = {
    number: { label: 'Number', icon: '#' },
    rating: { label: 'Rating dots', icon: '●' },
    die: { label: 'Die', icon: '⚄' },
    bar: { label: 'Bar / resource', icon: '▰' },
    choice: { label: 'Choice', icon: '◉' },
    text: { label: 'Text', icon: 'T' },
  };
  const DIE_FACES = ['d4', 'd6', 'd8', 'd10', 'd12', 'd20'];
  const DEFAULT_CONCEPTS = [
    { key: 'ruler', label: 'Ruler' }, { key: 'elder', label: 'Elder' }, { key: 'family', label: 'Family' },
    { key: 'young', label: 'Young' }, { key: 'warrior', label: 'Warrior' }, { key: 'priest', label: 'Priest' },
  ];

  const slug = s => String(s == null ? '' : s).toLowerCase().normalize('NFKD').replace(/[̀-ͯ]/g, '').replace(/[^a-z0-9]+/g, '_').replace(/^_+|_+$/g, '').slice(0, 40);
  const str = (v, d) => (v == null ? d || '' : String(v));
  const num = (v, d) => { if (v === '' || v == null) return d; const n = +v; return Number.isFinite(n) ? n : d; };
  const uniq = (base, taken) => { let id = base || 'item', n = 2; while (taken.has(id)) id = (base || 'item') + '_' + n++; taken.add(id); return id; };

  /* ---------------- formulas ---------------- */
  class FormulaError extends Error { constructor(msg, pos) { super(msg); this.name = 'FormulaError'; this.pos = pos == null ? -1 : pos; } }

  function tokenize(src) {
    const out = [];
    let i = 0;
    while (i < src.length) {
      const c = src[i];
      if (/\s/.test(c)) { i++; continue; }
      if (/[0-9.]/.test(c)) {
        const m = /^(\d+\.?\d*|\.\d+)/.exec(src.slice(i));
        if (!m) throw new FormulaError('Unexpected "' + c + '"', i);
        out.push({ t: 'num', v: parseFloat(m[1]), pos: i }); i += m[1].length; continue;
      }
      if (/[A-Za-z_]/.test(c)) { const m = /^[A-Za-z_][A-Za-z0-9_]*/.exec(src.slice(i)); out.push({ t: 'id', v: m[0].toLowerCase(), pos: i }); i += m[0].length; continue; }
      const two = src.slice(i, i + 2);
      if (['<=', '>=', '==', '!='].includes(two)) { out.push({ t: 'op', v: two, pos: i }); i += 2; continue; }
      if ('+-*/%^(),<>'.includes(c)) { out.push({ t: 'op', v: c, pos: i }); i++; continue; }
      throw new FormulaError('Unexpected "' + c + '"', i);
    }
    return out;
  }

  const FUNCS = {
    min: { min: 1, max: 99, fn: a => Math.min(...a) },
    max: { min: 1, max: 99, fn: a => Math.max(...a) },
    floor: { min: 1, max: 1, fn: a => Math.floor(a[0]) },
    ceil: { min: 1, max: 1, fn: a => Math.ceil(a[0]) },
    round: { min: 1, max: 1, fn: a => Math.round(a[0]) },
    abs: { min: 1, max: 1, fn: a => Math.abs(a[0]) },
    sqrt: { min: 1, max: 1, fn: a => { if (a[0] < 0) throw new FormulaError('sqrt of a negative number'); return Math.sqrt(a[0]); } },
    clamp: { min: 3, max: 3, fn: a => Math.min(Math.max(a[0], a[1]), a[2]) },
    if: { min: 3, max: 3, fn: a => (a[0] ? a[1] : a[2]) },
  };

  /** Parses a formula into a tree. Throws FormulaError (with .pos) on bad syntax. Returns { ast, names } */
  function parseFormula(src) {
    const toks = tokenize(str(src));
    if (!toks.length) throw new FormulaError('The formula is empty', 0);
    let p = 0;
    const names = new Set();
    const peek = () => toks[p], isOp = v => toks[p] && toks[p].t === 'op' && toks[p].v === v;
    const fail = (msg, tk) => { throw new FormulaError(msg, tk ? tk.pos : str(src).length); };
    function cmp() {
      let l = add();
      if (toks[p] && toks[p].t === 'op' && ['<', '>', '<=', '>=', '==', '!='].includes(toks[p].v)) { const op = toks[p++].v; l = { n: 'bin', op, l, r: add() }; }
      return l;
    }
    function add() {
      let l = mul();
      while (isOp('+') || isOp('-')) { const op = toks[p++].v; l = { n: 'bin', op, l, r: mul() }; }
      return l;
    }
    function mul() {
      let l = unary();
      while (isOp('*') || isOp('/') || isOp('%')) { const op = toks[p++].v; l = { n: 'bin', op, l, r: unary() }; }
      return l;
    }
    function unary() {
      if (isOp('-')) { p++; return { n: 'neg', v: unary() }; }
      if (isOp('+')) { p++; return unary(); }
      return pow();
    }
    function pow() {
      const base = atom();
      if (isOp('^')) { p++; return { n: 'bin', op: '^', l: base, r: unary() }; }   // right-associative: 2^3^2 = 2^9
      return base;
    }
    function atom() {
      const tk = peek();
      if (!tk) fail('The formula ends too soon');
      if (tk.t === 'num') { p++; return { n: 'num', v: tk.v }; }
      if (tk.t === 'id') {
        p++;
        if (isOp('(')) {
          const def = FUNCS[tk.v];
          if (!def) fail('Unknown function "' + tk.v + '"', tk);
          p++;
          const args = [];
          if (!isOp(')')) { args.push(cmp()); while (isOp(',')) { p++; args.push(cmp()); } }
          if (!isOp(')')) fail('Missing ")"', peek());
          p++;
          if (args.length < def.min || args.length > def.max) fail(tk.v + ' takes ' + (def.min === def.max ? def.min : def.min + ' to ' + def.max) + ' values, not ' + args.length, tk);
          return { n: 'call', name: tk.v, args };
        }
        names.add(tk.v);
        return { n: 'name', v: tk.v, pos: tk.pos };
      }
      if (tk.t === 'op' && tk.v === '(') {
        p++; const e = cmp();
        if (!isOp(')')) fail('Missing ")"', peek());
        p++; return e;
      }
      return fail('Unexpected "' + tk.v + '"', tk);
    }
    const ast = cmp();
    if (p < toks.length) fail('Unexpected "' + toks[p].v + '"', toks[p]);
    return { ast, names };
  }

  /** Evaluates a parsed tree. `lookup(name)` returns a number or throws; unknown names should throw FormulaError. */
  function evalAst(node, lookup) {
    switch (node.n) {
      case 'num': return node.v;
      case 'name': { const v = lookup(node.v); if (typeof v !== 'number' || !Number.isFinite(v)) throw new FormulaError('"' + node.v + '" is not a number', node.pos); return v; }
      case 'neg': return -evalAst(node.v, lookup);
      case 'call': return FUNCS[node.name].fn(node.args.map(a => evalAst(a, lookup)));
      case 'bin': {
        const a = evalAst(node.l, lookup), b = evalAst(node.r, lookup);
        switch (node.op) {
          case '+': return a + b;
          case '-': return a - b;
          case '*': return a * b;
          case '/': if (b === 0) throw new FormulaError('Division by zero'); return a / b;
          case '%': if (b === 0) throw new FormulaError('Division by zero'); return a % b;
          case '^': { const r = Math.pow(a, b); if (!Number.isFinite(r)) throw new FormulaError('The power is not a number'); return r; }
          case '<': return a < b ? 1 : 0;
          case '>': return a > b ? 1 : 0;
          case '<=': return a <= b ? 1 : 0;
          case '>=': return a >= b ? 1 : 0;
          case '==': return a === b ? 1 : 0;
          case '!=': return a !== b ? 1 : 0;
        }
      }
    }
    throw new FormulaError('Bad formula');
  }

  /** Evaluates formula text. `scope` is a plain object { name: number } (names are case-insensitive). */
  function evalFormula(src, scope) {
    const { ast } = parseFormula(src);
    const sc = Object.create(null);   // no inherited names such as "constructor"
    for (const k of Object.keys(scope || {})) sc[k.toLowerCase()] = scope[k];
    return evalAst(ast, n => { if (!(n in sc)) throw new FormulaError('Unknown name "' + n + '"'); return sc[n]; });
  }

  /** Checks formula text against a list of known names. Returns '' when fine, else the problem. */
  function checkFormula(src, knownNames) {
    try {
      const { names } = parseFormula(src);
      const known = new Set((knownNames || []).map(s => String(s).toLowerCase()));
      for (const n of names) if (!known.has(n)) return 'Unknown name "' + n + '"';
      return '';
    } catch (e) { return e.message; }
  }

  /* ---------------- config ---------------- */
  const emptyConfig = () => ({ version: VERSION, axes: [], systems: [], concepts: DEFAULT_CONCEPTS.map(c => Object.assign({}, c)) });

  function normMods(list, taken) {
    return (Array.isArray(list) ? list : []).map(m => ({ system: str(m && m.system), attr: str(m && m.attr), add: num(m && m.add, 0) })).filter(m => m.attr && m.add !== 0);
  }
  function normTerms(t) {
    const out = {};
    if (t && typeof t === 'object') for (const k of Object.keys(t)) { const v = str(t[k]).trim(); if (v) out[k] = v; }
    return out;
  }
  function normAttr(a, taken) {
    const kind = KINDS[a && a.kind] ? a.kind : 'number';
    const label = str(a && a.label, 'Attribute').trim() || 'Attribute';
    const out = { key: uniq(slug(a && a.key) || slug(a && a.short) || slug(label) || 'attr', taken), label, short: str(a && a.short).slice(0, 8), kind, group: str(a && a.group).trim() };
    if (kind === 'number' || kind === 'rating' || kind === 'bar') {
      out.min = num(a && a.min, kind === 'bar' ? 0 : null); out.max = num(a && a.max, kind === 'rating' ? 5 : kind === 'bar' ? 10 : null);
      if (kind === 'number' && out.min == null) delete out.min;
      if (kind === 'number' && out.max == null) delete out.max;
      const d = num(a && a.def, null); if (d != null) out.def = d;
    }
    if (kind === 'bar' && a && str(a.maxFormula).trim()) out.maxFormula = str(a.maxFormula).trim();
    if (kind === 'number' && a && str(a.formula).trim()) out.formula = str(a.formula).trim();
    if (kind === 'choice') out.options = (Array.isArray(a && a.options) ? a.options : str(a && a.options).split('\n')).map(s => str(s).trim()).filter(Boolean);
    if (kind === 'die') out.options = (Array.isArray(a && a.options) && a.options.length ? a.options : DIE_FACES).map(s => str(s).trim()).filter(Boolean);
    if (a && str(a.unit)) out.unit = str(a.unit);
    if (a && a.color) out.color = str(a.color);
    return out;
  }

  /** Cleans any config (also an older or hand-edited one) into the current shape. Never throws; never drops a known id. */
  function normalize(cfg) {
    const out = emptyConfig();
    if (!cfg || typeof cfg !== 'object') return out;
    if (Array.isArray(cfg.concepts) && cfg.concepts.length) {
      const seen = new Set();
      out.concepts = cfg.concepts.map(c => ({ key: slug(c && c.key) || slug(c && c.label), label: str(c && c.label).trim() })).filter(c => c.key && c.label && !seen.has(c.key) && seen.add(c.key));
      if (!out.concepts.length) out.concepts = emptyConfig().concepts;
    }
    const axisIds = new Set();
    const rawAxes = Array.isArray(cfg.axes) ? cfg.axes : [];
    const reserved = new Set();   // value ids are global to the config, so an entry's picks never clash across axes
    for (const ra of rawAxes) {
      if (!ra || typeof ra !== 'object') continue;
      const axis = {
        id: uniq(slug(ra.id) || slug(ra.name) || 'axis', axisIds), name: str(ra.name, 'Axis').trim() || 'Axis', color: str(ra.color) || '#8f7ad8', icon: str(ra.icon) || '◆',
        many: !!ra.many, types: (Array.isArray(ra.types) ? ra.types : []).map(str).filter(Boolean), required: !!ra.required, desc: str(ra.desc), values: [],
      };
      const local = new Map();
      for (const rv of (Array.isArray(ra.values) ? ra.values : [])) {
        if (!rv || typeof rv !== 'object') continue;
        const given = slug(rv.id);
        const id = given && !reserved.has(given) ? (reserved.add(given), given) : uniq(slug(rv.name) || 'value', reserved);
        local.set(str(rv.id), id); local.set(id, id);
        axis.values.push({ id, name: str(rv.name, 'Value').trim() || 'Value', color: str(rv.color) || axis.color, icon: str(rv.icon), desc: str(rv.desc), parent: rv.parent ? str(rv.parent) : null, terms: normTerms(rv.terms), nameStyle: str(rv.nameStyle), mods: normMods(rv.mods) });
      }
      for (const v of axis.values) {   // parents must exist in the same axis and must not loop
        if (v.parent) v.parent = local.get(v.parent) || null;
        if (v.parent === v.id) v.parent = null;
      }
      for (const v of axis.values) {
        const seen = new Set([v.id]);
        for (let p = v.parent && axis.values.find(x => x.id === v.parent); p; p = p.parent && axis.values.find(x => x.id === p.parent)) {
          if (seen.has(p.id)) { v.parent = null; break; }
          seen.add(p.id);
        }
      }
      out.axes.push(axis);
    }
    const sysIds = new Set();
    for (const rs of (Array.isArray(cfg.systems) ? cfg.systems : [])) {
      if (!rs || typeof rs !== 'object') continue;
      const taken = new Set();
      out.systems.push({
        id: uniq(slug(rs.id) || slug(rs.name) || 'system', sysIds), name: str(rs.name, 'Attributes').trim() || 'Attributes', types: (Array.isArray(rs.types) ? rs.types : []).map(str).filter(Boolean),
        desc: str(rs.desc), attrs: (Array.isArray(rs.attrs) ? rs.attrs : []).filter(a => a && typeof a === 'object').map(a => normAttr(a, taken)),
      });
    }
    out.version = VERSION;
    return out;
  }

  /** Upgrades whatever is stored in settings.traits to the current version. Missing = an empty config. Newer = error. */
  function migrate(stored) {
    if (stored == null) return emptyConfig();
    if (typeof stored !== 'object') return emptyConfig();
    const v = +stored.version || 0;
    if (v > VERSION) { const e = new Error('This configuration was made by a newer version (' + v + ').'); e.code = 'TOO_NEW'; throw e; }
    return normalize(stored);   // v0 (no version) and v1 share the shape
  }

  /** What a file holds: { format, version, config } → a normalised config, or throws a readable error */
  function importConfig(json) {
    let d = json;
    if (typeof json === 'string') { try { d = JSON.parse(json); } catch { throw new Error('That is not a configuration file (not valid JSON).'); } }
    if (!d || typeof d !== 'object') throw new Error('That is not a configuration file.');
    if (d.format && d.format !== FORMAT) throw new Error('That file is not a People & attributes configuration.');
    const cfg = d.config || d;
    if (!Array.isArray(cfg.axes) && !Array.isArray(cfg.systems)) throw new Error('That file has no axes or attribute systems.');
    return migrate(cfg);
  }
  const exportConfig = cfg => ({ format: FORMAT, version: VERSION, config: normalize(cfg) });

  /* ---------------- lookups ---------------- */
  function index(cfg) {
    const values = new Map(), axes = new Map(), systems = new Map();
    for (const a of cfg.axes || []) { axes.set(a.id, a); for (const v of a.values) values.set(v.id, { axis: a, value: v }); }
    for (const s of cfg.systems || []) systems.set(s.id, s);
    return { values, axes, systems };
  }
  /** value ids of an entry's axis field as a flat list (all axes), or for one axis */
  function pickedIds(state, axisId) {
    if (!state || typeof state !== 'object') return [];
    const out = [];
    for (const k of Object.keys(state)) {
      if (axisId && k !== axisId) continue;
      const v = state[k];
      for (const id of Array.isArray(v) ? v : v ? [v] : []) if (typeof id === 'string') out.push(id);
    }
    return out;
  }
  /** a value and its parents, innermost first */
  function chain(cfg, valueId, ix) {
    ix = ix || index(cfg);
    const out = [], seen = new Set();
    for (let id = valueId; id && !seen.has(id); ) {
      seen.add(id);
      const hit = ix.values.get(id);
      if (!hit) break;
      out.push(hit.value);
      id = hit.value.parent;
    }
    return out;
  }
  const pathName = (cfg, valueId, ix) => chain(cfg, valueId, ix).reverse().map(v => v.name).join(' › ');
  /** values of an axis in tree order with their depth: [{ value, depth }] */
  function tree(axis) {
    const out = [], by = new Map();
    for (const v of axis.values) { const k = v.parent || ''; if (!by.has(k)) by.set(k, []); by.get(k).push(v); }
    const walk = (parent, depth, seen) => { for (const v of by.get(parent) || []) { if (seen.has(v.id)) continue; out.push({ value: v, depth }); walk(v.id, depth + 1, new Set([...seen, v.id])); } };
    walk('', 0, new Set());
    return out;
  }
  const descendants = (axis, id) => { const out = []; const go = p => { for (const v of axis.values) if (v.parent === p) { out.push(v.id); go(v.id); } }; go(id); return out; };
  /** axes that apply to an entry type (key) */
  const axesFor = (cfg, typeKey) => (cfg.axes || []).filter(a => !a.types.length || a.types.includes(typeKey));
  const systemsFor = (cfg, typeKey) => (cfg.systems || []).filter(s => !s.types.length || s.types.includes(typeKey));

  /* ---------------- terminology and naming style ---------------- */
  /** the label of a concept for someone with these values: the innermost value that names it wins, else the world's default */
  function termFor(cfg, concept, state) {
    const ix = index(cfg);
    for (const id of pickedIds(state)) for (const v of chain(cfg, id, ix)) if (v.terms && v.terms[concept]) return v.terms[concept];
    const c = (cfg.concepts || []).find(x => x.key === concept);
    return c ? c.label : concept;
  }
  /** a naming style key (names.js STYLES) for these values, or '' */
  function nameStyleFor(cfg, state) {
    const ix = index(cfg);
    for (const id of pickedIds(state)) for (const v of chain(cfg, id, ix)) if (v.nameStyle) return v.nameStyle;
    return '';
  }

  /* ---------------- computing the stat block ---------------- */
  /** Modifiers from all of an entry's axis values (parents included) that hit this system: { attrKey: sum } */
  function modifiersFor(cfg, systemId, state) {
    const ix = index(cfg), sum = {};
    const seen = new Set();
    for (const id of pickedIds(state)) for (const v of chain(cfg, id, ix)) {
      if (seen.has(v.id)) continue;   // a value picked twice (or through a child) counts once
      seen.add(v.id);
      for (const m of v.mods || []) if (!m.system || m.system === systemId) sum[m.attr] = (sum[m.attr] || 0) + m.add;
    }
    return sum;
  }
  const clamp = (n, lo, hi) => { if (lo != null && n < lo) n = lo; if (hi != null && n > hi) n = hi; return n; };

  /** Rows for one system: [{ key, label, short, kind, group, base, mod, total, max, derived, error }]
      base: { attrKey: value } (what is stored); state: the entry's axis values. */
  function compute(cfg, systemId, base, state) {
    const sys = (cfg.systems || []).find(s => s.id === systemId);
    if (!sys) return [];
    base = base || {};
    const mods = modifiersFor(cfg, systemId, state);
    const byKey = new Map(sys.attrs.map(a => [a.key, a]));
    const done = new Map(), busy = [];
    function resolve(key) {
      if (done.has(key)) return done.get(key);
      const a = byKey.get(key);
      if (busy.includes(key)) throw new FormulaError('Circular formula: ' + busy.slice(busy.indexOf(key)).concat(key).join(' → '));
      busy.push(key);
      let row;
      try { row = one(a); } catch (e) {
        if (!(e instanceof FormulaError)) throw e;
        row = { key: a.key, label: a.label, short: a.short, kind: a.kind, group: a.group, base: null, mod: mods[a.key] || 0, total: null, max: null, derived: !!a.formula, error: e.message, value: null };
        if (busy.length > 1) { busy.pop(); done.set(key, row); throw e; }   // a dependant also fails
      }
      busy.pop(); done.set(key, row);
      return row;
    }
    const lookup = name => { if (!byKey.has(name)) throw new FormulaError('Unknown name "' + name + '"'); const r = resolve(name); if (r.error) throw new FormulaError('"' + name + '" has a problem'); return r.value; };
    function one(a) {
      const mod = mods[a.key] || 0;
      const row = { key: a.key, label: a.label, short: a.short, kind: a.kind, group: a.group, base: null, mod, total: null, max: null, derived: false, error: '', value: null };
      const b = base[a.key];
      switch (a.kind) {
        case 'number': {
          if (a.formula) {
            row.derived = true;
            const { ast } = parseFormula(a.formula);
            row.base = evalAst(ast, lookup);
          } else {
            row.base = num(b, num(a.def, a.min != null ? a.min : 0));
          }
          row.total = clamp(row.base + mod, a.min, a.max); row.value = row.total; row.max = a.max == null ? null : a.max;
          break;
        }
        case 'rating': {
          row.base = Math.round(num(b, num(a.def, 0))); row.max = a.max == null ? 5 : a.max;
          row.total = Math.round(clamp(row.base + mod, a.min == null ? 0 : a.min, row.max)); row.value = row.total;
          break;
        }
        case 'bar': {
          let mx = a.maxFormula ? evalAst(parseFormula(a.maxFormula).ast, lookup) : (a.max == null ? 10 : a.max);
          mx = Math.max(0, mx + mod); row.max = mx; row.mod = mod;
          const cur = b == null || b === '' ? (a.def != null ? a.def : mx) : num(b, mx);
          row.base = cur; row.total = clamp(cur, a.min == null ? 0 : a.min, mx); row.value = row.total;
          break;
        }
        case 'die': { row.base = str(b) || (a.options && a.options[0]) || 'd6'; row.total = row.base; row.mod = 0; const m = /^\D*(\d+)$/.exec(row.base); row.value = m ? +m[1] : null; break; }
        case 'choice': row.base = str(b); row.total = row.base; row.mod = 0; break;
        default: row.base = str(b); row.total = row.base; row.mod = 0;
      }
      return row;
    }
    return sys.attrs.map(a => { try { return resolve(a.key); } catch { return done.get(a.key); } });
  }

  /** every problem in a config as readable lines (used by the editor and tests) */
  function validate(cfg) {
    const out = [];
    const ix = index(cfg);
    for (const s of cfg.systems || []) {
      const keys = s.attrs.map(a => a.key);
      for (const a of s.attrs) {
        if (a.formula) { const p = checkFormula(a.formula, keys.filter(k => k !== a.key)); if (p) out.push(s.name + ' › ' + a.label + ': ' + p); }
        if (a.maxFormula) { const p = checkFormula(a.maxFormula, keys.filter(k => k !== a.key)); if (p) out.push(s.name + ' › ' + a.label + ' (max): ' + p); }
        if (a.min != null && a.max != null && a.min > a.max) out.push(s.name + ' › ' + a.label + ': the minimum is above the maximum');
      }
      for (const r of compute(cfg, s.id, {}, {})) if (r.error && /Circular/.test(r.error)) out.push(s.name + ' › ' + r.label + ': ' + r.error);
    }
    for (const a of cfg.axes || []) for (const v of a.values) for (const m of v.mods || []) {
      const s = m.system ? ix.systems.get(m.system) : null;
      if (m.system && !s) out.push(a.name + ' › ' + v.name + ': a modifier points to a missing system');
      else if (s && !s.attrs.some(x => x.key === m.attr)) out.push(a.name + ' › ' + v.name + ': a modifier points to a missing attribute "' + m.attr + '"');
    }
    return Array.from(new Set(out));
  }

  /** axes marked required that an entry of this type has no value for */
  function missingRequired(cfg, typeKey, state) {
    return axesFor(cfg, typeKey).filter(a => a.required && !pickedIds(state, a.id).some(id => a.values.some(v => v.id === id)));
  }

  /** plain text of a stat block (search, exports) */
  function statText(cfg, systemId, base, state) {
    return compute(cfg, systemId, base, state).filter(r => r.total != null && r.total !== '').map(r => (r.short || r.label) + ' ' + r.total).join(', ');
  }
  /** plain text of axis picks: "Race: Elf › High elf; Class: Mage" */
  function axisText(cfg, state) {
    const ix = index(cfg), by = new Map();
    for (const id of pickedIds(state)) { const hit = ix.values.get(id); if (!hit) continue; if (!by.has(hit.axis.name)) by.set(hit.axis.name, []); by.get(hit.axis.name).push(pathName(cfg, id, ix)); }
    return Array.from(by).map(([k, v]) => k + ': ' + v.join(', ')).join('; ');
  }

  /* ---------------- starter packs ---------------- */
  const V = (name, extra) => Object.assign({ name }, extra || {});
  const PACKS = {
    fantasy: { label: 'Fantasy RPG', desc: 'Race with subraces, class with subclasses, alignment.', axes: [
      { name: 'Race', icon: '❦', color: '#8f7ad8', types: ['character'], values: [
        V('Human', { color: '#d2a35a' }), V('Elf', { color: '#5fb38a' }), V('High elf', { parent: 'Elf', color: '#6fd0a0' }), V('Wood elf', { parent: 'Elf', color: '#4a9a6a' }),
        V('Dwarf', { color: '#c7835b' }), V('Hill dwarf', { parent: 'Dwarf' }), V('Mountain dwarf', { parent: 'Dwarf' }), V('Halfling', { color: '#c49a3c' }), V('Orc', { color: '#7a9a4a' }), V('Gnome', { color: '#6fa7d8' }), V('Tiefling', { color: '#c45a7a' })] },
      { name: 'Class', icon: '⚔', color: '#e0796b', types: ['character'], values: [
        V('Fighter', { color: '#d0574e' }), V('Champion', { parent: 'Fighter' }), V('Battle master', { parent: 'Fighter' }), V('Wizard', { color: '#6fa7d8' }), V('Evoker', { parent: 'Wizard' }), V('Necromancer', { parent: 'Wizard' }),
        V('Rogue', { color: '#6b6f7d' }), V('Cleric', { color: '#e2b33d' }), V('Ranger', { color: '#5fb38a' }), V('Bard', { color: '#e06aa8' })] },
      { name: 'Alignment', icon: '☯', color: '#9aa5b1', types: ['character'], values: [V('Lawful good'), V('Neutral good'), V('Chaotic good'), V('Lawful neutral'), V('True neutral'), V('Chaotic neutral'), V('Lawful evil'), V('Neutral evil'), V('Chaotic evil')] },
    ] },
    historical: { label: 'Historical', desc: 'Estate, profession, faith and region of origin.', axes: [
      { name: 'Estate', icon: '♛', color: '#c49a3c', types: ['character'], values: [V('Nobility', { color: '#c49a3c' }), V('Clergy', { color: '#e2e2e2' }), V('Gentry', { parent: 'Nobility' }), V('Commoner', { color: '#9aa5b1' }), V('Peasant', { parent: 'Commoner' }), V('Burgher', { parent: 'Commoner' }), V('Slave or serf', { color: '#7a8291' })] },
      { name: 'Profession', icon: '⚒', color: '#d2a35a', types: ['character'], many: true, values: [V('Farmer'), V('Merchant'), V('Soldier'), V('Craftsman'), V('Scholar'), V('Sailor'), V('Physician'), V('Priest')] },
      { name: 'Faith', icon: '✝', color: '#6fa7d8', types: ['character'], values: [V('Christian'), V('Catholic', { parent: 'Christian' }), V('Orthodox', { parent: 'Christian' }), V('Muslim'), V('Jewish'), V('Pagan'), V('Buddhist'), V('Hindu')] },
      { name: 'Region of origin', icon: '⌖', color: '#5fb38a', types: ['character'], values: [V('Europe'), V('Middle East'), V('Africa'), V('Asia'), V('Americas')] },
    ] },
    scifi: { label: 'Science fiction', desc: 'Species, origin, rank and profession.', axes: [
      { name: 'Species', icon: '❦', color: '#8f7ad8', types: ['character'], values: [V('Human'), V('Synthetic'), V('Android', { parent: 'Synthetic' }), V('AI', { parent: 'Synthetic' }), V('Alien'), V('Cyborg')] },
      { name: 'Origin', icon: '◍', color: '#4fb6b2', types: ['character'], values: [V('Earth-born'), V('Colonist'), V('Belter'), V('Spacer'), V('Station-born')] },
      { name: 'Rank', icon: '★', color: '#e2b33d', types: ['character'], values: [V('Civilian'), V('Crew'), V('Officer'), V('Commander'), V('Admiral')] },
      { name: 'Specialty', icon: '⚙', color: '#6fa7d8', types: ['character'], many: true, values: [V('Pilot'), V('Engineer'), V('Medic'), V('Scientist'), V('Marine'), V('Hacker'), V('Diplomat')] },
    ] },
    modern: { label: 'Modern', desc: 'Occupation, background and affiliation.', axes: [
      { name: 'Occupation', icon: '⚒', color: '#d2a35a', types: ['character'], many: true, values: [V('Detective'), V('Doctor'), V('Teacher'), V('Student'), V('Criminal'), V('Journalist'), V('Politician'), V('Retired')] },
      { name: 'Background', icon: '⌂', color: '#5fb38a', types: ['character'], values: [V('Working class'), V('Middle class'), V('Wealthy'), V('Immigrant'), V('Rural'), V('Urban')] },
      { name: 'Affiliation', icon: '⚑', color: '#c49a3c', types: ['character'], many: true, values: [V('Police'), V('Government'), V('Corporate'), V('Underworld'), V('Press'), V('Independent')] },
    ] },
    blank: { label: 'Blank', desc: 'One empty axis to name yourself.', axes: [{ name: 'Axis', icon: '◆', color: '#8f7ad8', types: [], values: [] }] },
  };

  const PRESET_SYSTEMS = {
    classic6: { label: 'Six abilities + HP', desc: 'STR, DEX, CON, INT, WIS, CHA, modifiers and hit points.', system: { name: 'Abilities', types: ['character', 'species'], attrs: [
      ...['STR', 'DEX', 'CON', 'INT', 'WIS', 'CHA'].map((s, i) => ({ label: ['Strength', 'Dexterity', 'Constitution', 'Intelligence', 'Wisdom', 'Charisma'][i], short: s, kind: 'number', min: 1, max: 30, def: 10, group: 'Abilities' })),
      { label: 'Constitution modifier', short: 'CON mod', kind: 'number', formula: 'floor((con - 10) / 2)', group: 'Derived' },
      { label: 'Hit points', short: 'HP', kind: 'bar', maxFormula: '10 + con_mod * 2', group: 'Derived' },
    ] } },
    trinity: { label: 'Body / Mind / Spirit', desc: 'Three ratings out of five.', system: { name: 'Nature', types: ['character'], attrs: [
      { label: 'Body', kind: 'rating', max: 5, def: 2 }, { label: 'Mind', kind: 'rating', max: 5, def: 2 }, { label: 'Spirit', kind: 'rating', max: 5, def: 2 },
      { label: 'Vigour', kind: 'bar', maxFormula: '5 + body * 2' },
    ] } },
    personality: { label: 'Personality', desc: 'Charm, cunning, courage and temper as short ratings.', system: { name: 'Personality', types: ['character'], attrs: [
      { label: 'Charm', kind: 'rating', max: 5 }, { label: 'Cunning', kind: 'rating', max: 5 }, { label: 'Courage', kind: 'rating', max: 5 },
      { label: 'Temperament', kind: 'choice', options: ['Calm', 'Warm', 'Proud', 'Hot-headed', 'Cold'] },
    ] } },
  };

  /** the config with the pack's axes added; an axis whose name already exists is left alone (values missing from it are added) */
  function mergePack(cfg, packKey) {
    const pack = PACKS[packKey];
    if (!pack) throw new Error('Unknown pack "' + packKey + '"');
    const next = normalize(cfg);
    const clone = JSON.parse(JSON.stringify(pack.axes));
    const taken = new Set(next.axes.flatMap(a => a.values.map(v => v.id)));
    for (const ax of clone) {
      const have = next.axes.find(a => a.name.toLowerCase() === ax.name.toLowerCase());
      // values get fresh unique ids; parents are given by name in the packs
      const idByName = new Map();
      const vals = ax.values.map(v => { const id = have && have.values.find(x => x.name.toLowerCase() === v.name.toLowerCase()) ? null : uniq(slug(v.name), taken); if (id) idByName.set(v.name, id); return { v, id }; });
      const mk = ({ v, id }) => Object.assign({}, v, { id, parent: v.parent ? (idByName.get(v.parent) || (have && (have.values.find(x => x.name === v.parent) || {}).id) || null) : null });
      if (have) have.values.push(...vals.filter(x => x.id).map(mk));
      else next.axes.push(Object.assign({}, ax, { values: vals.map(mk) }));
    }
    return normalize(next);
  }
  function addSystemPreset(cfg, key) {
    const p = PRESET_SYSTEMS[key];
    if (!p) throw new Error('Unknown preset "' + key + '"');
    const next = normalize(cfg);
    next.systems.push(JSON.parse(JSON.stringify(p.system)));
    return normalize(next);
  }

  /* ---------------- migration of existing data ---------------- */
  /** the fields a built-in Character/Species type gets for this feature (added to an existing type, never replacing a field) */
  const TEMPLATE_FIELDS = [
    { key: 'classes', label: 'Classification', kind: 'axis', group: 'Identity', wide: true, hint: 'Race, class, caste… set up in World settings → People & attributes.' },
    { key: 'attributes', label: 'Attributes', kind: 'attrs', group: 'Game', wide: true },
  ];
  function ensureFields(fields) {
    const have = new Set((fields || []).map(f => f.key));
    const add = TEMPLATE_FIELDS.filter(f => !have.has(f.key) && !(fields || []).some(x => x.kind === f.kind)).map(f => Object.assign({}, f));
    return (fields || []).concat(add);
  }
  /** a legacy `stats` field ([{label,value}]) as base values for a system: matched by key, short or label */
  function statsToBase(cfg, systemId, rows) {
    const sys = (cfg.systems || []).find(s => s.id === systemId), out = {};
    if (!sys) return out;
    for (const r of rows || []) {
      const k = slug(r && r.label);
      const a = sys.attrs.find(x => x.key === k || slug(x.short) === k || slug(x.label) === k);
      if (!a) continue;
      const n = parseFloat(String(r.value).replace(/[^0-9.+-]/g, ''));
      if (a.kind === 'number' || a.kind === 'rating' || a.kind === 'bar') { if (Number.isFinite(n)) out[a.key] = n; } else out[a.key] = String(r.value);
    }
    return out;
  }

  return {
    VERSION, FORMAT, KINDS, DIE_FACES, DEFAULT_CONCEPTS, PACKS, PRESET_SYSTEMS, TEMPLATE_FIELDS, FormulaError,
    slug, parseFormula, evalAst, evalFormula, checkFormula,
    emptyConfig, normalize, migrate, importConfig, exportConfig, validate,
    index, pickedIds, chain, pathName, tree, descendants, axesFor, systemsFor,
    termFor, nameStyleFor, modifiersFor, compute, missingRequired, statText, axisText,
    mergePack, addSystemPreset, ensureFields, statsToBase,
  };
});
