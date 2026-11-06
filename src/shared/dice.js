/* Dice notation: "2d6+3", "1d20 adv", "4d6kh3", "3d6!", "d%", "2d10-1d4+2", "8d6dl2", "1d20+5 dis".
   roll(expr, rng?) → { expr, total, parts: [{ term, sign, rolls, kept, value }], text, min, max } or throws. */
(function (root, factory) {
  const api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  else root.WBDice = api;
})(typeof self !== 'undefined' ? self : this, function () {
  'use strict';
  function rand(n, rng) {
    if (rng) return 1 + Math.floor(rng() * n);
    const c = typeof crypto !== 'undefined' && crypto.getRandomValues ? crypto : null;
    if (c) { const a = new Uint32Array(1), lim = Math.floor(0xffffffff / n) * n; let x; do { c.getRandomValues(a); x = a[0]; } while (x >= lim); return 1 + (x % n); }
    return 1 + Math.floor(Math.random() * n);
  }
  const TERM = /^(\d*)d(\d+|%|F)((?:k|kh|kl|d|dh|dl)\d+)?(!)?$/i;

  function parse(expr) {
    let s = String(expr || '').trim().toLowerCase().replace(/\s+/g, ' ');
    if (!s) throw new Error('Type dice like 2d6+3');
    let mode = null;
    const am = /\s*(adv|advantage|dis|disadvantage)$/.exec(s);
    if (am) { mode = am[1].startsWith('a') ? 'adv' : 'dis'; s = s.slice(0, am.index); }
    s = s.replace(/\s+/g, '');
    if (!/^[+-]?[\dd%f!khl+-]+$/i.test(s)) throw new Error('Dice can use numbers, d, +, -, k/kh/kl/d/dh/dl and !');
    const terms = [];
    const re = /([+-]?)([^+-]+)/g;
    let m;
    while ((m = re.exec(s))) {
      const sign = m[1] === '-' ? -1 : 1, body = m[2];
      if (/^\d+$/.test(body)) { terms.push({ sign, flat: +body }); continue; }
      const t = TERM.exec(body);
      if (!t) throw new Error('I can\'t read "' + body + '"');
      const count = t[1] ? +t[1] : 1, sides = t[2] === '%' ? 100 : t[2].toUpperCase() === 'F' ? 'F' : +t[2];
      if (count < 1 || count > 1000) throw new Error('Roll between 1 and 1000 dice at once');
      if (sides !== 'F' && (sides < 2 || sides > 10000)) throw new Error('Dice need 2 to 10000 sides');
      let keep = null;
      if (t[3]) { const k = /^(k|kh|kl|d|dh|dl)(\d+)$/i.exec(t[3]); keep = { how: k[1].toLowerCase(), n: +k[2] }; }
      terms.push({ sign, count, sides, keep, explode: !!t[4] });
    }
    if (!terms.length) throw new Error('Type dice like 2d6+3');
    if (mode) {
      const d20 = terms.find(t => t.sides === 20 && t.count === 1 && !t.keep);
      if (d20) { d20.count = 2; d20.keep = { how: mode === 'adv' ? 'kh' : 'kl', n: 1 }; }
    }
    return { terms, mode };
  }

  function rollTerm(t, rng) {
    if (t.flat != null) return { term: String(t.flat), sign: t.sign, rolls: [], kept: [], value: t.flat };
    const rolls = [];
    for (let i = 0; i < t.count; i++) {
      if (t.sides === 'F') { rolls.push(rand(3, rng) - 2); continue; }
      let r = rand(t.sides, rng), guard = 0;
      rolls.push(r);
      while (t.explode && r === t.sides && guard++ < 100) { r = rand(t.sides, rng); rolls.push(r); }
    }
    let keptIdx = rolls.map((v, i) => i);
    if (t.keep) {
      const order = rolls.map((v, i) => [v, i]).sort((a, b) => a[0] - b[0]);
      const n = Math.min(t.keep.n, rolls.length);
      let keepIdx;
      if (t.keep.how === 'k' || t.keep.how === 'kh') keepIdx = order.slice(order.length - n);
      else if (t.keep.how === 'kl') keepIdx = order.slice(0, n);
      else if (t.keep.how === 'd' || t.keep.how === 'dl') keepIdx = order.slice(n);
      else keepIdx = order.slice(0, order.length - n);
      keptIdx = keepIdx.map(x => x[1]).sort((a, b) => a - b);
    }
    const kept = keptIdx.map(i => rolls[i]);
    const label = (t.count === 1 ? '' : t.count) + 'd' + (t.sides === 100 ? '%' : t.sides) + (t.keep ? t.keep.how + t.keep.n : '') + (t.explode ? '!' : '');
    return { term: label, sign: t.sign, rolls, kept, keptIdx, value: kept.reduce((a, b) => a + b, 0) };
  }

  function range(terms) {
    let min = 0, max = 0;
    for (const t of terms) {
      if (t.flat != null) { min += t.sign * t.flat; max += t.sign * t.flat; continue; }
      const k = t.keep ? (/^(k|kh|kl)$/.test(t.keep.how) ? Math.min(t.keep.n, t.count) : Math.max(0, t.count - t.keep.n)) : t.count;
      const lo = t.sides === 'F' ? -k : k, hi = t.sides === 'F' ? k : k * t.sides;
      if (t.sign > 0) { min += lo; max += hi; } else { min -= hi; max -= lo; }
    }
    return { min, max };
  }

  function roll(expr, rng) {
    const { terms, mode } = parse(expr);
    const parts = terms.map(t => rollTerm(t, rng));
    const total = parts.reduce((s, p) => s + p.sign * p.value, 0);
    const text = parts.map((p, i) => (i ? (p.sign < 0 ? ' − ' : ' + ') : p.sign < 0 ? '−' : '') + (p.rolls.length ? p.term + ' [' + p.rolls.map((r, i) => (p.keptIdx.includes(i) ? r : '~' + r + '~')).join(', ') + ']' : p.term)).join('');
    return Object.assign({ expr: String(expr).trim(), total, parts, text, mode }, range(terms));
  }
  const valid = expr => { try { parse(expr); return true; } catch { return false; } };
  /** replaces inline {2d6} in text with rolled totals */
  const inline = (s, rng) => String(s).replace(/\{([^{}]+)\}/g, (m, e) => { try { return String(roll(e, rng).total); } catch { return m; } });

  return { roll, parse, valid, inline, range: e => range(parse(e).terms) };
});
