/* Kinship: how two people are related, worked out from parent / spouse / sibling relations.
   Blood relations go through the nearest shared ancestors (siblings, aunts, cousins "once removed" …); marriages add
   in-laws and step-relatives; anything else is described as a chain ("wife's brother's son"). UMD: main and renderer. */
(function (root, factory) {
  const api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  else root.WBKin = api;
})(typeof self !== 'undefined' ? self : this, function () {
  'use strict';

  /* ---------------- words ---------------- */
  const ORD = ['zeroth', 'first', 'second', 'third', 'fourth', 'fifth', 'sixth', 'seventh', 'eighth', 'ninth', 'tenth'];
  const ordinal = n => ORD[n] || (n + (n % 10 === 1 && n % 100 !== 11 ? 'st' : n % 10 === 2 && n % 100 !== 12 ? 'nd' : n % 10 === 3 && n % 100 !== 13 ? 'rd' : 'th'));
  const short = n => n + (n % 10 === 1 && n % 100 !== 11 ? 'st' : n % 10 === 2 && n % 100 !== 12 ? 'nd' : n % 10 === 3 && n % 100 !== 13 ? 'rd' : 'th');
  const TIMES = ['', 'once', 'twice', 'thrice'];
  const W = {
    parent: ['father', 'mother', 'parent'], child: ['son', 'daughter', 'child'], sibling: ['brother', 'sister', 'sibling'],
    spouse: ['husband', 'wife', 'spouse'], auncle: ['uncle', 'aunt', 'aunt/uncle'], nibling: ['nephew', 'niece', 'niece/nephew'],
    stepparent: ['stepfather', 'stepmother', 'step-parent'], stepchild: ['stepson', 'stepdaughter', 'stepchild'], stepsibling: ['stepbrother', 'stepsister', 'step-sibling'],
  };
  const word = (kind, sex) => W[kind][sex === 'm' ? 0 : sex === 'f' ? 1 : 2];
  /** k "greats" in front of a word: 0 → word, 1 → great-word, 2 → great-great-word, 3+ → "3rd great-word" */
  const greats = (k, w) => (k <= 0 ? w : k <= 2 ? 'great-'.repeat(k) + w : short(k) + ' great-' + w);
  const ancestorWord = (n, sex) => (n === 1 ? word('parent', sex) : greats(n - 2, 'grand' + word('parent', sex)));
  const descendantWord = (n, sex) => (n === 1 ? word('child', sex) : greats(n - 2, 'grand' + word('child', sex)));
  const auncleWord = (n, sex) => greats(n - 2, word('auncle', sex));                       // n = generations from the shared ancestor to the younger one
  const niblingWord = (n, sex) => (n === 2 ? word('nibling', sex) : greats(n - 3, 'grand' + word('nibling', sex)));
  function cousinWord(da, db) {
    const deg = Math.min(da, db) - 1, rem = Math.abs(da - db);
    return ordinal(deg) + ' cousin' + (rem ? ' ' + (TIMES[rem] || rem + ' times') + ' removed' : '');
  }
  const poss = name => name + (/s$/i.test(name) ? '’' : '’s');
  const article = w => (/^[aeiou]/i.test(w) ? 'an ' : 'a ') + w;
  /** "he/him", "She", "female" … → 'm' | 'f' | null */
  function sexOf(v) {
    const s = String(v || '').trim().toLowerCase();
    if (!s) return null;
    if (/^(he|him|his)\b|^(m|male|man|boy)$/.test(s)) return 'm';
    if (/^(she|her|hers)\b|^(f|female|woman|girl)$/.test(s)) return 'f';
    return null;
  }

  /* ---------------- the family graph ---------------- */
  /** fam: { people: [{ id, title, sex }], parents: [[parentId, childId]], spouses: [[a, b]], siblings: [[a, b]] } */
  function build(fam) {
    const people = new Map((fam.people || []).map(p => [p.id, p]));
    const up = new Map(), down = new Map(), sp = new Map(), sib = new Map();
    const add = (m, a, b) => { let s = m.get(a); if (!s) m.set(a, s = new Set()); s.add(b); };
    const has = id => people.has(id);
    for (const [p, c] of fam.parents || []) if (has(p) && has(c) && p !== c) { add(up, c, p); add(down, p, c); }
    for (const [a, b] of fam.spouses || []) if (has(a) && has(b) && a !== b) { add(sp, a, b); add(sp, b, a); }
    for (const [a, b] of fam.siblings || []) if (has(a) && has(b) && a !== b) { add(sib, a, b); add(sib, b, a); }
    const G = { people, up, down, sp, sib, virtual: new Set() };
    // explicit siblings share parents: members without recorded parents take the group's; a group with none gets an unnamed one
    const seen = new Set();
    for (const id of sib.keys()) {
      if (seen.has(id)) continue;
      const group = [], stack = [id];
      while (stack.length) { const x = stack.pop(); if (seen.has(x)) continue; seen.add(x); group.push(x); for (const y of sib.get(x) || []) stack.push(y); }
      const known = new Set();
      for (const x of group) for (const p of up.get(x) || []) known.add(p);
      if (!known.size) {
        const v = '~parents:' + group.slice().sort()[0];
        G.virtual.add(v); people.set(v, { id: v, title: 'their parents', sex: null, virtual: true });
        for (const x of group) { add(up, x, v); add(down, v, x); }
      } else {
        for (const x of group) if (!(up.get(x) || new Set()).size) for (const p of known) { add(up, x, p); add(down, p, x); }
        // two explicit siblings who still share no parent: an unnamed shared one keeps them siblings
        for (const x of group) for (const y of sib.get(x) || []) {
          if (x >= y) continue;
          const px = up.get(x) || new Set(), py = up.get(y) || new Set();
          if (![...px].some(p => py.has(p))) { const v = '~parents:' + x + '+' + y; G.virtual.add(v); people.set(v, { id: v, title: 'a shared parent', sex: null, virtual: true }); add(up, x, v); add(up, y, v); add(down, v, x); add(down, v, y); }
        }
      }
    }
    return G;
  }
  const get = (m, id) => m.get(id) || new Set();
  /** id → generations above `id` (0 = itself) */
  function ancestors(G, id) {
    const d = new Map([[id, 0]]), q = [id];
    while (q.length) { const x = q.shift(); for (const p of get(G.up, x)) if (!d.has(p)) { d.set(p, d.get(x) + 1); q.push(p); } }
    return d;
  }
  /** blood relation of a to b: { label, da, db, half, common: [ids], line: [ids a … b] } or null */
  function blood(G, a, b) {
    if (a === b) return null;
    const A = ancestors(G, a), B = ancestors(G, b);
    let best = null;
    for (const [id, da] of A) {
      const db = B.get(id);
      if (db == null) continue;
      if (!best || da + db < best.da + best.db || (da + db === best.da + best.db && Math.max(da, db) < Math.max(best.da, best.db))) best = { da, db };
    }
    if (!best) return null;
    const { da, db } = best;
    const common = [...A.keys()].filter(id => A.get(id) === da && B.get(id) === db);
    const top = common.find(id => !G.virtual.has(id)) || common[0];
    // distances of every node to `top` (for walking a shortest line down to each side)
    const toTop = id => ancestors(G, id).get(top);
    const walk = id => { const out = [id]; let x = id; while (x !== top) { const n = [...get(G.up, x)].find(p => { const d = toTop(p); return d != null && d === toTop(x) - 1; }); if (!n) break; out.push(n); x = n; } return out; };
    const la = walk(a), lb = walk(b);
    const line = la.concat(lb.slice(0, -1).reverse());
    // half: one shared ancestor, and both sides' other parents at that point are known and differ
    let half = false;
    if (da > 0 && db > 0 && common.length === 1) {
      const ca = la[la.length - 2], cb = lb[lb.length - 2];
      const oa = [...get(G.up, ca)].filter(p => p !== top), ob = [...get(G.up, cb)].filter(p => p !== top);
      half = oa.length > 0 && ob.length > 0 && !oa.some(p => ob.includes(p));
    }
    const sex = (G.people.get(a) || {}).sex;
    let label;
    if (da === 0) label = ancestorWord(db, sex);
    else if (db === 0) label = descendantWord(da, sex);
    else if (da === 1 && db === 1) label = word('sibling', sex);
    else if (da === 1) label = auncleWord(db, sex);
    else if (db === 1) label = niblingWord(da, sex);
    else label = cousinWord(da, db);
    if (half) label = 'half-' + label;
    return { label, da, db, half, common, line };
  }

  /* ---------------- the answer ---------------- */
  /** step words along a line of ids: how each person is related to the one before */
  function stepAs(G, prev, id) {
    const sex = (G.people.get(id) || {}).sex;
    if (get(G.up, prev).has(id)) return word('parent', sex);
    if (get(G.down, prev).has(id)) return word('child', sex);
    if (get(G.sp, prev).has(id)) return word('spouse', sex);
    if (get(G.sib, prev).has(id)) return word('sibling', sex);
    return 'relative';
  }
  const titleOf = (G, id) => (G.people.get(id) || {}).title || 'Someone';

  /** a relation of a to b. fam as in build(); returns { kind, label, text, explain, path: [{ id, title, as }], common } */
  function relate(fam, a, b) {
    const G = fam && fam.people instanceof Map ? fam : build(fam);
    if (!G.people.has(a) || !G.people.has(b)) return { kind: 'none', label: null, text: 'Pick two people.', explain: '', path: [], common: [] };
    const nA = titleOf(G, a), nB = titleOf(G, b), sexA = (G.people.get(a) || {}).sex;
    // across an unnamed shared parent the step is a sibling
    const mkPath = line => line.filter(id => !G.virtual.has(id)).map((id, i, arr) => {
      let as = i ? stepAs(G, arr[i - 1], id) : null;
      if (as === 'relative') as = word('sibling', (G.people.get(id) || {}).sex);
      return { id, title: titleOf(G, id), as };
    });
    const out = (kind, label, explain, line, common) => ({ kind, label, text: label ? nA + ' is ' + poss(nB) + ' ' + label + '.' : 'No family connection is recorded between ' + nA + ' and ' + nB + '.', explain: explain || '', path: line ? mkPath(line) : [], common: (common || []).filter(id => !G.virtual.has(id)) });
    if (a === b) return Object.assign(out('self', 'self', 'That is the same person.', [a]), { text: 'That is the same person.' });

    // 1. blood
    const bl = blood(G, a, b);
    if (bl) {
      const named = bl.common.filter(id => !G.virtual.has(id));
      let explain;
      if (bl.da === 0) explain = nA + ' is ' + (bl.db === 1 ? 'a parent' : 'an ancestor') + ' of ' + nB + ', ' + bl.db + ' generation' + (bl.db === 1 ? '' : 's') + ' up.';
      else if (bl.db === 0) explain = nA + ' is ' + (bl.da === 1 ? 'a child' : 'a descendant') + ' of ' + nB + ', ' + bl.da + ' generation' + (bl.da === 1 ? '' : 's') + ' down.';
      else {
        const who = named.length ? named.map(id => titleOf(G, id)).join(' and ') : 'unrecorded parents';
        const gen = n => (n === 1 ? 'a child' : n === 2 ? 'a grandchild' : 'a descendant ' + n + ' generations down');
        explain = 'Both descend from ' + who + ': ' + nA + ' is ' + gen(bl.da) + ', ' + nB + ' is ' + gen(bl.db) + '.' + (bl.half ? ' They share only one of the parents at that point.' : '');
        if (bl.da >= 2 && bl.db >= 2) explain += ' Cousins are counted by the generation nearer the shared ancestor; the difference in generations makes them “removed”.';
      }
      return out('blood', bl.label, explain, bl.line, bl.common);
    }

    // 2. marriage
    if (get(G.sp, a).has(b)) return out('marriage', word('spouse', sexA), nA + ' and ' + nB + ' are married.', [a, b]);
    // a is married to a blood relative r of b
    const viaA = [];
    for (const r of get(G.sp, a)) { const x = blood(G, r, b); if (x) viaA.push([r, x]); }
    viaA.sort((p, q) => p[1].da + p[1].db - (q[1].da + q[1].db));
    for (const [r, x] of viaA) {
      const sp = word('spouse', sexA), nR = titleOf(G, r);
      let label = null;
      if (x.da === 0 && x.db === 1) label = word('stepparent', sexA);
      else if (x.da === 0 && x.db === 2) label = 'step-grand' + word('parent', sexA);
      else if (x.da === 1 && x.db === 1) label = word('sibling', sexA) + '-in-law';
      else if (x.da === 1 && x.db === 0) label = word('child', sexA) + '-in-law';
      else if (x.da === 2 && x.db === 0) label = 'grand' + word('child', sexA) + '-in-law';
      else if (x.da === 1) label = auncleWord(x.db, sexA) + ' by marriage';
      else if (x.db === 1) label = niblingWord(x.da, sexA) + ' by marriage';
      else if (x.da >= 2 && x.db >= 2 && x.da === x.db) label = 'cousin-in-law';
      return out('marriage', label || x.label + '’s ' + sp, nA + ' is married to ' + nR + ', ' + poss(nB) + ' ' + x.label + '.', [a].concat(x.line), x.common);
    }
    // b is married to a blood relative s of a
    const viaB = [];
    for (const s of get(G.sp, b)) { const x = blood(G, a, s); if (x) viaB.push([s, x]); }
    viaB.sort((p, q) => p[1].da + p[1].db - (q[1].da + q[1].db));
    for (const [s, x] of viaB) {
      const nS = titleOf(G, s), spB = word('spouse', (G.people.get(b) || {}).sex);
      let label = null;
      if (x.da === 0 && x.db === 1) label = word('parent', sexA) + '-in-law';
      else if (x.da === 0 && x.db === 2) label = 'grand' + word('parent', sexA) + '-in-law';
      else if (x.da === 1 && x.db === 1) label = word('sibling', sexA) + '-in-law';
      else if (x.da === 1 && x.db === 0) label = word('stepchild', sexA);
      else if (x.da === 2 && x.db === 0) label = 'step-grand' + word('child', sexA);
      else if (x.da === 1) label = auncleWord(x.db, sexA) + ' by marriage';
      else if (x.db === 1) label = niblingWord(x.da, sexA) + ' by marriage';
      else if (x.da >= 2 && x.db >= 2 && x.da === x.db) label = 'cousin-in-law';
      const expl = nA + ' is the ' + x.label + ' of ' + nS + ', ' + poss(nB) + ' ' + spB + '.';
      return out('marriage', label || spB + '’s ' + x.label, expl, x.line.concat([b]), x.common);
    }
    // step-siblings: a parent of a married to a parent of b
    for (const pa of get(G.up, a)) for (const pb of get(G.up, b)) if (get(G.sp, pa).has(pb)) {
      return out('step', word('stepsibling', sexA), nA + ' is the ' + word('child', sexA) + ' of ' + titleOf(G, pa) + ', who is married to ' + titleOf(G, pb) + ', ' + poss(nB) + ' ' + word('parent', (G.people.get(pb) || {}).sex) + '.', [a, pa, pb, b]);
    }

    // 3. any chain through the family: "wife's brother's son"
    const prev = new Map([[b, null]]), q = [b];
    while (q.length && !prev.has(a)) {
      const x = q.shift();
      for (const m of [G.up, G.down, G.sp, G.sib]) for (const y of get(m, x)) if (!prev.has(y)) { prev.set(y, x); q.push(y); }
    }
    if (prev.has(a)) {
      const line = [];
      for (let x = a; x != null; x = prev.get(x)) line.push(x);   // a … b
      const fromB = line.slice().reverse().filter(id => !G.virtual.has(id));
      const words = fromB.slice(1).map((id, i) => stepAs(G, fromB[i], id)).map(w => (w === 'relative' ? 'sibling' : w));
      const label = words.join('’s ');
      return out('chain', label, 'Followed through the family: ' + fromB.map(id => titleOf(G, id)).join(' → ') + '.', line);
    }
    return out('none', null, 'Add parents, spouses or siblings to connect them.', null);
  }
  return { build, relate, blood, ancestors, sexOf, words: { word, ancestorWord, descendantWord, auncleWord, niblingWord, cousinWord, ordinal, greats }, poss, article };
});
