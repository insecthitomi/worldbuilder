/* Generators: seeded results made of sections that re-roll one by one, can be pinned (locked) and become entries.
   define(def) adds a generator; run(id, opts, state) → result. The same opts and seeds always give the same result.
   Also random tables: weighted rows or dice ranges, nested [[Other table]], inline {1d6} and {this|that}. */
(function (root, factory) {
  const node = typeof module === 'object' && module.exports;
  const api = factory(node ? require('./names.js') : root.WBNames, node ? require('./dice.js') : root.WBDice);
  if (node) module.exports = api;
  else root.WBGen = api;
})(typeof self !== 'undefined' ? self : this, function (N, D) {
  'use strict';
  const defs = new Map();
  const W = {};   // shared word lists; other gen-* files add theirs with words({...})
  /** splits on | outside {…} so items may hold inline choices like {two|three} */
  function split(s) {
    const out = []; let depth = 0, cur = '';
    for (const ch of String(s)) {
      if (ch === '{') depth++; else if (ch === '}') depth = Math.max(0, depth - 1);
      if (ch === '|' && !depth) { out.push(cur); cur = ''; } else cur += ch;
    }
    out.push(cur);
    return out.map(x => x.trim()).filter(Boolean);
  }
  const words = obj => { for (const [k, v] of Object.entries(obj)) W[k] = typeof v === 'string' ? split(v) : v; return W; };
  const list = a => (typeof a === 'string' ? (W[a] || split(a)) : a || []);
  /** Title Case for names, keeping small words low */
  const title = s => String(s || '').split(' ').map((w, i) => (i && /^(of|the|and|at|in|on|a|an|by|to|under)$/i.test(w) ? w.toLowerCase() : w.charAt(0).toUpperCase() + w.slice(1))).join(' ');
  const SEED_CHARS = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
  function newSeed(rand) { const R = rand || Math.random; let s = ''; for (let i = 0; i < 6; i++) s += SEED_CHARS[Math.floor(R() * SEED_CHARS.length)]; return s; }
  const cap = s => (s ? s.charAt(0).toUpperCase() + s.slice(1) : s);
  const lower = s => (s ? s.charAt(0).toLowerCase() + s.slice(1) : s);
  /** "a apple" → "an apple" (not before one-, uni-, use- …) */
  const article = s => String(s).replace(/\b([Aa]) (?=([a-z]+))/g, (m, a, w) => (/^[aeiou]/i.test(w) && !/^(one|uni|use|usu|eu|ur[aeiou]|ewe)/i.test(w) ? a + 'n ' : m));
  const num = n => String(Math.round(n)).replace(/\B(?=(\d{3})+(?!\d))/g, ',');
  const joinAnd = arr => (arr.length < 2 ? arr.join('') : arr.slice(0, -1).join(', ') + ' and ' + arr[arr.length - 1]);
  const esc = s => String(s == null ? '' : s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');

  /** random helpers bound to one rng */
  function tools(rng) {
    const t = {
      rng,
      f: () => rng(),
      int: (a, b) => a + Math.floor(rng() * (b - a + 1)),
      chance: p => rng() < p,
      pick: arr => { arr = list(arr); return arr.length ? arr[Math.floor(rng() * arr.length)] : ''; },
      weighted: items => N.weighted(rng, items),
      shuffle: arr => { const a = list(arr).slice(); for (let i = a.length - 1; i > 0; i--) { const j = Math.floor(rng() * (i + 1)); const x = a[i]; a[i] = a[j]; a[j] = x; } return a; },
      sample: (arr, n) => t.shuffle(arr).slice(0, Math.max(0, n)),
      between: r => t.int(r[0], r[1]),
      roll: expr => D.roll(expr, rng).total,
      fill: (s, vars) => fill(t, s, vars || {}),
      /** n distinct picks where each is fill()ed */
      fills: (arr, n, vars) => t.sample(arr, n).map(s => fill(t, s, vars || {})),
    };
    return t;
  }

  /** template filling: {key} from vars or a word list, {^key} capitalised, {a|b|c} a choice, {2d6} a roll.
   *  s: a template, an array of templates, or '@list' (a random item of a word list) */
  function fill(t, s, vars = {}, depth = 0) {
    if (Array.isArray(s)) s = t.pick(s);
    else if (typeof s === 'string' && s[0] === '@' && W[s.slice(1)]) s = t.pick(W[s.slice(1)]);
    const out = String(s == null ? '' : s).replace(/\{([^{}]+)\}/g, (m, k) => {
      let up = false;
      if (k[0] === '^') { up = true; k = k.slice(1); }
      let v;
      if (Object.prototype.hasOwnProperty.call(vars, k)) { v = vars[k]; if (typeof v === 'function') v = v(t); else if (Array.isArray(v)) v = t.pick(v); }
      else if (W[k]) v = t.pick(W[k]);
      else if (k.includes('|')) v = t.pick(split(k));
      else if (/^\d*d\d+([+-]\d+)?$/i.test(k)) v = String(t.roll(k));
      else return m;
      v = String(v == null ? '' : v);
      if (depth < 5 && /\{[^{}]+\}/.test(v)) v = fill(t, v, vars, depth + 1);
      return up ? cap(v) : v;
    });
    return depth ? out : article(out);
  }

  /* ---------------- names ---------------- */
  const used = o => (o.avoid instanceof Set ? o.avoid : (o.avoid = new Set(o.avoid || [])));
  /** a person's name: culture samples (Markov) first, then the world's name style */
  function personName(t, o = {}) {
    const avoid = used(o);
    let n = '';
    for (let i = 0; i < 14; i++) {
      n = N.fullName({ style: o.style || 'common', given: o.given && o.given.length >= 3 ? o.given : null, family: o.family && o.family.length >= 3 ? o.family : null, rng: t.rng, noFamily: o.noFamily });
      if (n && !avoid.has(n)) break;
    }
    avoid.add(n);
    return n;
  }
  /** a place name: lexicon suggestions, Markov over the world's own place names, the name style, or terrain compounds */
  function placeName(t, o = {}) {
    const avoid = used(o);
    const cands = [];
    if (o.suggest && o.suggest.length) cands.push(...o.suggest.filter(x => !avoid.has(x)).map(x => [x, 3]));
    if (o.samples && o.samples.length >= 5) cands.push(...N.markov(o.samples, { count: 4, rng: t.rng, avoid: [...avoid], min: 4, max: 11 }).map(x => [x, 1.2]));
    cands.push(...N.generate({ style: o.style || 'common', kind: 'place', count: 3, rng: t.rng, avoid: [...avoid] }).map(x => [x, 1]));
    if (o.prefix && o.suffix) for (let i = 0; i < 4; i++) {
      const p = t.pick(o.prefix), s = t.pick(o.suffix);
      const w = p + (/^[aeiou]/.test(s) && /[aeiou]$/i.test(p) ? s.slice(1) : s);
      if (!avoid.has(w)) cands.push([w, 1.6]);
    }
    const name = cands.length ? t.weighted(cands) : 'Newtown';
    avoid.add(name);
    return name;
  }

  /* ---------------- registry ---------------- */
  /** def: { id, name, icon, group, desc, inputs: [{ key, label, kind: choice|text|number|culture|date|count|toggle, options, def, hint }],
   *        generate(g), plan(result, env) → entry plan, text(result) → plain text } */
  function define(def) {
    if (!def || !def.id || typeof def.generate !== 'function') throw new Error('A generator needs an id and generate()');
    defs.set(def.id, Object.assign({ group: 'More', icon: '✦', inputs: [], desc: '' }, def));
    return defs.get(def.id);
  }
  const meta = d => ({ id: d.id, name: d.name, icon: d.icon, group: d.group, desc: d.desc, inputs: d.inputs, star: !!d.star, creates: d.creates || null });

  /** state: { seed, seeds: { section: pinnedSeed } } — pinned sections keep their seed when the rest re-rolls */
  function run(id, opts = {}, state = {}) {
    const def = defs.get(id);
    if (!def) throw new Error('There is no generator called ' + id + '.');
    const seed = String(state.seed || opts.seed || newSeed());
    const pins = Object.assign({}, state.seeds || {});
    const o = Object.assign({}, opts);
    for (const inp of def.inputs || []) if (o[inp.key] === undefined && inp.def !== undefined) o[inp.key] = inp.def;
    const res = { id, name: def.name, icon: def.icon, seed, seeds: {}, opts: o, sections: [], data: {}, title: '', summary: '' };
    const g = {
      opts: o, res, W, N, D, cap, lower, article, num, joinAnd,
      seedFor: key => pins[key] || seed + '·' + key,
      rng(key) { const s = g.seedFor(key); res.seeds[key] = s; return tools(N.rng(s)); },
      /** adds a section; fn(t) returns its value. extra: { secret, note, kind-specific } */
      section(key, label, kind, fn, extra) {
        const t = g.rng(key);
        const v = fn(t);
        res.sections.push(Object.assign({ key, label, kind, value: v }, extra || {}));
        return v;
      },
      person: (t, more) => personName(t, Object.assign({ style: o.nameStyle, given: o.names && o.names.given, family: o.names && o.names.family, avoid: g.names }, more || {})),
      place: (t, more) => placeName(t, Object.assign({ style: o.nameStyle, samples: o.placeSamples, suggest: o.placeNames, avoid: g.names }, more || {})),
      names: new Set(o.avoidNames || []),
      fill: (t, s, vars) => fill(t, s, vars || {}),
      /** lower-cases the first letter unless the text starts with a known name (a generated one, the cast or a place) */
      lower(s) {
        s = String(s == null ? '' : s);
        for (const n of [...g.names, ...(o.cast || []), ...(o.places || [])]) if (n && s.startsWith(n)) return s;
        return lower(s);
      },
    };
    def.generate(g);
    if (!res.title) { const s = res.sections.find(x => x.kind === 'title' || x.key === 'name'); res.title = s ? String(s.value) : def.name; }
    return res;
  }
  /** a fresh seed for one section (re-roll just that part) */
  const rerollSeed = (res, key) => res.seed + '·' + key + '·' + newSeed();
  const get = id => defs.get(id) || null;

  /** plain text of a result (copy to clipboard) */
  function text(res) {
    const def = defs.get(res.id);
    if (def && def.text) return def.text(res);
    const out = [res.title, res.summary].filter(Boolean);
    for (const s of res.sections) {
      if (s.key === 'name' || s.kind === 'title') continue;
      out.push('', s.label.toUpperCase());
      out.push(...sectionLines(s));
    }
    return out.join('\n');
  }
  function sectionLines(s) {
    const v = s.value;
    if (v == null) return [];
    if (s.kind === 'text') return [String(v)];
    if (s.kind === 'list') return v.map(x => '• ' + x);
    if (s.kind === 'kv') return v.map(([k, x]) => k + ': ' + x);
    if (s.kind === 'items') return v.map(x => '• ' + [x.title, x.sub].filter(Boolean).join(' — ') + (x.text ? ': ' + x.text : '') + (x.price ? ' (' + x.price + ')' : ''));
    if (s.kind === 'bars') return v.map(x => x.label + ' ' + x.pct + '%');
    return [typeof v === 'string' ? v : JSON.stringify(v)];
  }
  /** HTML (the stored rich-text subset) of a section; secret sections and items become inline secrets */
  function sectionHtml(s) {
    const v = s.value, sec = h => (s.secret ? '<p class="wb-s">' + h + '</p>' : h);
    if (v == null || (Array.isArray(v) && !v.length)) return '';
    const li = (x, secret) => '<li>' + (secret ? '<span class="wb-s">' + x + '</span>' : x) + '</li>';
    let body = '';
    if (s.kind === 'text') body = s.secret ? '<p class="wb-s">' + esc(v) + '</p>' : '<p>' + esc(v) + '</p>';
    else if (s.kind === 'list') body = '<ul>' + v.map(x => li(esc(x), s.secret)).join('') + '</ul>';
    else if (s.kind === 'kv') body = '<ul>' + v.map(([k, x]) => li('<strong>' + esc(k) + ':</strong> ' + esc(x), s.secret)).join('') + '</ul>';
    else if (s.kind === 'bars') body = '<p>' + v.map(x => esc(x.label) + ' ' + x.pct + '%').join(' · ') + '</p>';
    else if (s.kind === 'items') body = '<ul>' + v.map(x => li('<strong>' + esc(x.title) + '</strong>' + (x.sub ? ' — <em>' + esc(x.sub) + '</em>' : '') + (x.price ? ' (' + esc(x.price) + ')' : '') + (x.text ? ': ' + esc(x.text) : '') + (x.secret ? ' <span class="wb-s">' + esc(x.secret) + '</span>' : ''), s.secret)).join('') + '</ul>';
    else body = sec('<p>' + esc(typeof v === 'string' ? v : JSON.stringify(v)) + '</p>');
    return body;
  }
  /** HTML body of a whole result (sections under h3 headings, the name skipped) */
  function html(res, { skip = [] } = {}) {
    return res.sections.filter(s => s.key !== 'name' && s.kind !== 'title' && !skip.includes(s.key)).map(s => {
      const b = sectionHtml(s);
      return b ? '<h3>' + esc(s.label) + '</h3>' + b : '';
    }).join('');
  }
  /** the entry plan of a result: { entries: [{ ref, type, title, summary, body, fields, data, parent }], relations, media, pins } */
  function plan(res, env = {}) {
    const def = defs.get(res.id);
    if (def && def.plan) return def.plan(res, env, api);
    const c = def && def.creates || 'note';
    return { entries: [{ ref: 'main', type: c, title: res.title, summary: res.summary, body: html(res) }], relations: [], open: 'main' };
  }

  /* ---------------- random tables ---------------- */
  /** "1-3", "4", "5–6", "00" (= 100), [1, 3] → [lo, hi] or null */
  function parseRange(r) {
    if (Array.isArray(r) && r.length) { const a = +r[0], b = +(r[1] == null ? r[0] : r[1]); return Number.isFinite(a) && Number.isFinite(b) ? [Math.min(a, b), Math.max(a, b)] : null; }
    if (r == null || r === '') return null;
    const m = /^\s*(\d+)\s*(?:[-–—to]+\s*(\d+))?\s*\+?\s*$/.exec(String(r));
    if (!m) return null;
    const v = x => (x === '00' ? 100 : +x);
    const a = v(m[1]), b = m[2] != null ? v(m[2]) : a;
    return [Math.min(a, b), Math.max(a, b)];
  }
  const rangeText = r => (!r ? '' : r[0] === r[1] ? String(r[0]) : r[0] + '–' + r[1]);
  /** dice ranges for every row: their own when all have one, else spread over the dice range by weight */
  function rangesOf(rows, dice) {
    if (!dice || !D.valid(dice)) return null;
    const own = rows.map(r => parseRange(r.range));
    if (own.every(Boolean)) return own;
    return autoRanges(rows, dice);
  }
  function autoRanges(rows, dice) {
    let { min, max } = D.range(dice);
    const span = max - min + 1, n = rows.length;
    if (n === 0) return [];
    const w = rows.map(r => Math.max(0, +r.weight || 1)), tot = w.reduce((a, b) => a + b, 0) || n;
    const out = [];
    let at = min, acc = 0;
    for (let i = 0; i < n; i++) {
      acc += w[i];
      let hi = i === n - 1 ? max : Math.round(min - 1 + (acc / tot) * span);
      hi = Math.max(at, Math.min(max - (n - 1 - i) * (span >= n ? 1 : 0), hi));
      out.push([at, Math.max(at, hi)]);
      at = Math.min(max, hi + 1);
    }
    return out;
  }
  /** {1d6} → a roll, {red|green} → a pick */
  function inline(s, rng) {
    const t = tools(rng || Math.random);
    return String(s).replace(/\{([^{}]+)\}/g, (m, k) => {
      if (k.includes('|')) return t.pick(k.split('|').map(x => x.trim()));
      try { return String(D.roll(k, rng).total); } catch { return m; }
    });
  }
  /** table: { id?, title, dice, rows: [{ text, weight, range }] }; lookup(name) → table | null.
   *  → { index, total, text, raw, nested: [{ title, index, total, text }] } */
  function rollTable(table, { rng, lookup, depth = 0, seen } = {}) {
    rng = rng || Math.random;
    const rows = (table && table.rows || []).filter(r => r && String(r.text || '').trim());
    if (!rows.length) return { index: -1, total: null, text: '', raw: '', nested: [] };
    let index, total = null;
    const ranges = table.dice ? rangesOf(rows, table.dice) : null;
    if (ranges) {
      total = D.roll(table.dice, rng).total;
      index = ranges.findIndex(([a, b]) => total >= a && total <= b);
      if (index < 0) index = total < ranges[0][0] ? 0 : rows.length - 1;
    } else {
      const w = rows.map(r => Math.max(0, r.weight == null || r.weight === '' ? 1 : +r.weight || 0));
      const tot = w.reduce((a, b) => a + b, 0);
      let x = rng() * (tot || rows.length);
      index = rows.length - 1;
      for (let i = 0; i < rows.length; i++) { x -= tot ? w[i] : 1; if (x < 0) { index = i; break; } }
    }
    const raw = String(rows[index].text);
    const nested = [];
    seen = seen || new Set([String(table.title || '').toLowerCase()]);
    let text = raw.replace(/\[\[([^\]|]+)(?:\|(\d+))?\]\]/g, (m, name, times) => {
      const key = name.trim().toLowerCase();
      const sub = lookup && depth < 6 && !seen.has(key) ? lookup(name.trim()) : null;
      if (!sub) return name.trim();
      const n = Math.max(1, Math.min(12, +times || 1)), parts = [];
      for (let i = 0; i < n; i++) {
        const r = rollTable(sub, { rng, lookup, depth: depth + 1, seen: new Set([...seen, key]) });
        nested.push({ title: sub.title, index: r.index, total: r.total, text: r.text }, ...r.nested);
        parts.push(r.text);
      }
      return parts.join(', ');
    });
    text = inline(text, rng);
    return { index, total, text, raw, nested };
  }
  /** a pasted list → rows: "1-3 text", "4: text", "text x3", "text (3)", "3x text" or plain lines */
  function parseRows(textIn) {
    const lines = String(textIn || '').split(/\r?\n/).map(l => l.replace(/^\s*[-*•]\s+/, '').trim()).filter(Boolean);
    const ranged = lines.map(l => /^(\d+\s*(?:[-–—]\s*\d+)?)\s*[.:)\]|\t]?\s+(.+)$/.exec(l));
    const allRanged = lines.length > 1 && ranged.every(Boolean);
    return lines.map((l, i) => {
      if (allRanged) { const r = parseRange(ranged[i][1]); return { text: ranged[i][2].trim(), weight: r ? r[1] - r[0] + 1 : 1, range: r }; }
      let m;
      if ((m = /^(.*?)\s*(?:[x×*]\s*(\d+)|\((\d+)\))\s*$/.exec(l)) && m[1]) return { text: m[1].trim(), weight: +(m[2] || m[3]) || 1 };
      if ((m = /^(\d+)\s*[x×]\s+(.+)$/.exec(l))) return { text: m[2].trim(), weight: +m[1] || 1 };
      if ((m = /^(.*?)\s*\|\s*(\d+)\s*$/.exec(l)) && m[1]) return { text: m[1].trim(), weight: +m[2] || 1 };
      return { text: l, weight: 1 };
    });
  }
  /** chance of each row (0..1) */
  function odds(table) {
    const rows = (table.rows || []);
    const ranges = table.dice ? rangesOf(rows, table.dice) : null;
    if (ranges) {
      // exact distribution of the dice total by convolution (falls back to an even spread for exotic dice)
      const dist = distribution(table.dice);
      return ranges.map(([a, b]) => { let p = 0; for (let x = a; x <= b; x++) p += dist.get(x) || 0; return p; });
    }
    const w = rows.map(r => Math.max(0, r.weight == null || r.weight === '' ? 1 : +r.weight || 0)), tot = w.reduce((a, b) => a + b, 0) || 1;
    return w.map(x => x / tot);
  }
  function distribution(expr) {
    let dist = new Map([[0, 1]]);
    try {
      const { terms } = D.parse(expr);
      for (const t of terms) {
        if (t.flat != null) { const nd = new Map(); for (const [k, p] of dist) nd.set(k + t.sign * t.flat, p); dist = nd; continue; }
        if (t.keep || t.explode || t.sides === 'F' || t.count > 40) throw new Error('approx');
        for (let i = 0; i < t.count; i++) {
          const nd = new Map();
          for (const [k, p] of dist) for (let f = 1; f <= t.sides; f++) nd.set(k + t.sign * f, (nd.get(k + t.sign * f) || 0) + p / t.sides);
          dist = nd;
        }
      }
      return dist;
    } catch {
      const { min, max } = D.range(expr), m = new Map();
      for (let x = min; x <= max; x++) m.set(x, 1 / (max - min + 1));
      return m;
    }
  }

  const api = { define, get, run, list: () => [...defs.values()].map(meta), defs, W, words, split, title, tools, fill, newSeed, rerollSeed, cap, lower, article, num, joinAnd, esc,
    personName, placeName, text, html, sectionHtml, sectionLines, plan,
    parseRange, rangeText, rangesOf, autoRanges, rollTable, parseRows, inline, odds, distribution };
  return api;
});
