/* Names and words: Markov chains over sample names, phonology-driven words with spelling rules, built-in sound styles,
   compounds, and an ordered sound-change engine (proto-language → daughter). Deterministic with a seed (rng(seed)),
   so a generator can be re-rolled or reproduced. Used by both processes. */
(function (root, factory) {
  const api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  else root.WBNames = api;
})(typeof self !== 'undefined' ? self : this, function () {
  'use strict';
  /** mulberry32 */
  function rng(seed) {
    let a = typeof seed === 'number' ? seed >>> 0 : hash(String(seed == null ? Math.random() : seed));
    return function () { a |= 0; a = a + 0x6d2b79f5 | 0; let t = Math.imul(a ^ a >>> 15, 1 | a); t = t + Math.imul(t ^ t >>> 7, 61 | t) ^ t; return ((t ^ t >>> 14) >>> 0) / 4294967296; };
  }
  function hash(s) { let h = 2166136261; for (let i = 0; i < s.length; i++) { h ^= s.charCodeAt(i); h = Math.imul(h, 16777619); } return h >>> 0; }
  const pick = (r, a) => a[Math.floor(r() * a.length)];
  function weighted(r, items) {   // [[value, weight], …]
    const total = items.reduce((s, x) => s + (x[1] > 0 ? x[1] : 0), 0);
    if (!(total > 0)) return items.length ? items[Math.floor(r() * items.length)][0] : undefined;
    let x = r() * total;
    for (const it of items) { x -= it[1] > 0 ? it[1] : 0; if (x <= 0 && it[1] > 0) return it[0]; }
    return items[items.length - 1][0];
  }
  const cap = s => String(s).replace(/(^|[\s'-])(\p{L})/gu, (m, a, b) => a + b.toUpperCase());
  /** a comparison key: lower case, no diacritics, no stress or syllable marks */
  const norm = s => String(s == null ? '' : s).normalize('NFKD').replace(/[̀-ͯ]/g, '').replace(/[ˈˌ.]/g, '').toLowerCase().trim();
  const list = v => (Array.isArray(v) ? v : String(v == null ? '' : v).split(/[\s,]+/)).map(x => String(x).trim()).filter(Boolean);

  /* ---------------- Markov chains over sample names ---------------- */
  function markov(samples, { count = 10, order = 2, min = 3, max = 12, rng: R, avoid = [] } = {}) {
    const src = (samples || []).map(s => String(s).trim().toLowerCase()).filter(s => s.length >= 2);
    if (src.length < 3) return [];
    R = R || rng();
    const o = Math.max(1, Math.min(3, src.length < 12 ? 1 + (order > 2 ? 1 : 0) : order));
    const table = new Map();
    for (const w of src) {
      const s = '^'.repeat(o) + w + '$';
      for (let i = 0; i + o < s.length; i++) { const k = s.slice(i, i + o), v = s[i + o]; if (!table.has(k)) table.set(k, []); table.get(k).push(v); }
    }
    const known = new Set(src.concat(avoid.map(a => String(a).toLowerCase()))), out = new Set();
    const longest = Math.max(...src.map(s => s.length)), spaced = src.filter(s => /\s/.test(s)).length > src.length / 3;
    const lim = Math.min(max, longest + 2), onsets = new Set(src.map(s => s.slice(0, 2)));
    for (let tries = 0; out.size < count && tries < count * 80; tries++) {
      let k = '^'.repeat(o), w = '';
      for (let i = 0; i < max + 2; i++) { const next = table.get(k); if (!next) break; const c = pick(R, next); if (c === '$') break; w += c; k = (k + c).slice(-o); }
      w = w.trim();
      if (w.length < min || w.length > lim || known.has(w) || /(.)\1\1/.test(w) || /^[\s'-]|[\s'-]$/.test(w)) continue;
      // keep the shape of the samples: no stray spaces, no pile-ups of consonants or vowels
      if ((!spaced && /\s/.test(w)) || /[^aeiouyäöüåæøé\s'-]{4,}/i.test(w) || /[aeiouyäöü]{3,}/i.test(w)) continue;
      if (/^[^aeiouyäöü]{2}/i.test(w) && !onsets.has(w.slice(0, 2))) continue;   // a cluster no sample starts with
      out.add(cap(w));
    }
    return [...out];
  }

  /* ---------------- sounds ---------------- */
  /** IPA classes (used for automatic pattern groups and chart labels) */
  const IPA = {
    vowels: 'i y ɨ ʉ ɯ u ɪ ʏ ʊ e ø ɘ ɵ ɤ o ə ɛ œ ɜ ɞ ʌ ɔ æ ɐ a ɶ ɑ ɒ ä'.split(' '),
    plosive: 'p b t d ʈ ɖ c ɟ k g ɡ q ɢ ʔ'.split(' '),
    nasal: 'm ɱ n ɳ ɲ ŋ ɴ'.split(' '),
    liquid: 'l ɭ ʎ ʟ r ɾ ɹ ɻ ʀ ʙ ⱱ ɽ'.split(' '),
    fricative: 'ɸ β f v θ ð s z ʃ ʒ ʂ ʐ ç ʝ x ɣ χ ʁ ħ ʕ h ɦ ɬ ɮ ɕ ʑ'.split(' '),
    glide: 'j w ɥ ʍ ɰ ʋ'.split(' '),
    sibilant: 's z ʃ ʒ ʂ ʐ ɕ ʑ ts dz tʃ dʒ tɕ dʑ'.split(' '),
    affricate: 'ts dz tʃ dʒ tɕ dʑ pf kx ʈʂ ɖʐ'.split(' '),
  };
  const MOD = /[ʰ-ˇˉ-ˋˍ-˿̀-ͯ᷀-᷿ᴬ-ᵪ]/;   // length, aspiration, diacritics (not the stress marks)
  const TIE = /[͜͡]/;
  const base = seg => String(seg).normalize('NFD').replace(/[̀-ͯʰ-˿]/g, '');
  const isVowel = seg => { const b = base(seg); return !!b && [...b].every(ch => IPA.vowels.includes(ch)); };
  /** splits a pronunciation into sounds: known multi-letter sounds first, diacritics and length stay on their sound */
  function segments(str, inv) {
    const s = String(str == null ? '' : str).replace(/[ˈˌ.]/g, '');
    const multi = [...new Set([].concat(inv || []))].filter(x => typeof x === 'string' && [...x].length > 1).sort((a, b) => b.length - a.length);
    const out = [];
    for (let i = 0; i < s.length;) {
      const m = multi.find(x => s.startsWith(x, i));
      if (m) { out.push(m); i += m.length; continue; }
      const ch = String.fromCodePoint(s.codePointAt(i)); i += ch.length;
      const prev = out.length ? out[out.length - 1] : null;
      if (prev && !/\s/.test(prev) && (MOD.test(ch) || TIE.test(prev.slice(-1)))) out[out.length - 1] += ch;
      else out.push(ch);
    }
    return out;
  }

  /** default spelling of IPA sounds (a language's own rules override these) */
  const ROMAN = {
    'ʃ': 'sh', 'ʒ': 'zh', 'θ': 'th', 'ð': 'dh', 'ŋ': 'ng', 'tʃ': 'ch', 'dʒ': 'j', 'j': 'y', 'x': 'kh', 'ɣ': 'gh', 'ɲ': 'ny', 'ʎ': 'ly',
    'ʔ': '\'', 'ɾ': 'r', 'ɹ': 'r', 'χ': 'kh', 'ħ': 'hh', 'ʕ': '\'', 'ç': 'hy', 'ɸ': 'f', 'β': 'bh', 'ʋ': 'v', 'ɡ': 'g', 'ʍ': 'wh', 'ɥ': 'yw',
    'ɬ': 'lh', 'ɮ': 'lzh', 'ʂ': 'sh', 'ʐ': 'zh', 'ɕ': 'sy', 'ʑ': 'zy', 'tɕ': 'ty', 'dʑ': 'dy', 'ɳ': 'n', 'ɭ': 'l', 'ʈ': 't', 'ɖ': 'd', 'ɽ': 'r', 'ɻ': 'r',
    'c': 'ky', 'ɟ': 'gy', 'ʝ': 'yh', 'ɰ': 'w', 'ʁ': 'rh', 'ɢ': 'gh', 'ɴ': 'n', 'ʀ': 'rr', 'ʙ': 'br', 'ⱱ': 'v', 'ɦ': 'h', 'ʟ': 'l', 'ɱ': 'm', 'q': 'q',
    'ɛ': 'è', 'ɔ': 'ò', 'ə': 'ë', 'æ': 'ae', 'ɪ': 'i', 'ʊ': 'u', 'ø': 'ö', 'y': 'ü', 'ɯ': 'ı', 'ɨ': 'ı', 'ʉ': 'ü', 'œ': 'œ', 'ɑ': 'a', 'ɒ': 'o',
    'ʌ': 'u', 'ɐ': 'a', 'ɤ': 'ë', 'ɘ': 'ë', 'ɵ': 'ö', 'ɜ': 'ë', 'ɞ': 'ö', 'ʏ': 'ü', 'ɶ': 'œ', 'ä': 'a',
    'aː': 'ā', 'eː': 'ē', 'iː': 'ī', 'oː': 'ō', 'uː': 'ū', 'ː': '',
  };
  const DEFAULT_PHON = { consonants: 'p t k b d g m n s l r v z h'.split(' '), vowels: 'a e i o u'.split(' '), patterns: ['CV', 'CVC', 'V', 'VC'], syllables: [1, 3], banned: [] };

  /** a phonology with every field present and tidy */
  function normPhon(phon) {
    const p = Object.assign({}, DEFAULT_PHON, phon || {});
    const syl = Array.isArray(p.syllables) ? p.syllables : [1, 3];
    const lo = Math.max(1, Math.min(8, Math.round(+syl[0] || 1))), hi = Math.max(lo, Math.min(8, Math.round(+syl[1] || lo)));
    const groups = {};
    for (const [k, v] of Object.entries(p.groups || {})) if (/^[A-Z]$/.test(k) && k !== 'C' && k !== 'V') groups[k] = list(v);
    const roman = (Array.isArray(p.romanization) ? p.romanization : Object.entries(p.romanization || {}))
      .filter(r => Array.isArray(r) && r[0] != null && String(r[0]) !== '').map(r => [String(r[0]), String(r[1] == null ? '' : r[1])]);
    const weights = {};
    for (const [k, v] of Object.entries(p.weights || {})) if (Number.isFinite(+v)) weights[k] = Math.max(0, Math.min(10, +v));
    const int = (v, d, a, b) => (Number.isFinite(+v) && v !== null && v !== '' ? Math.max(a, Math.min(b, Math.round(+v))) : d);
    return {
      consonants: [...new Set(list(p.consonants))], vowels: [...new Set(list(p.vowels))],
      patterns: list(p.patterns).filter(x => /\S/.test(x)), syllables: [lo, hi], banned: list(p.banned),
      weights, romanization: roman, groups, stress: ['first', 'penult', 'last', 'none'].includes(p.stress) ? p.stress : 'none',
      dropoff: ['flat', 'gentle', 'steep'].includes(p.dropoff) ? p.dropoff : 'gentle',
      maxCluster: int(p.maxCluster, 3, 1, 6), maxVowels: int(p.maxVowels, 2, 1, 4), geminates: !!p.geminates,
    };
  }
  /** the spelling rules in force: defaults for the inventory, then the language's own (longest first) */
  function spelling(phon) {
    const p = normPhon(phon), map = new Map();
    for (const s of p.consonants.concat(p.vowels)) if (ROMAN[s] != null && ROMAN[s] !== s) map.set(s, ROMAN[s]);
    if (p.vowels.some(v => /ː/.test(v))) map.set('ː', '');
    for (const [a, b] of p.romanization) map.set(a, b);
    return [...map.entries()].sort((a, b) => b[0].length - a[0].length);
  }
  function rewrite(str, rules) {
    let out = '';
    const s = String(str == null ? '' : str);
    for (let i = 0; i < s.length;) {
      const r = rules.find(x => x[0] && s.startsWith(x[0], i));
      if (r) { out += r[1]; i += r[0].length; continue; }
      out += s[i]; i++;
    }
    return out;
  }
  /** pronunciation → spelling; rules: [[ipa, spelling]] (from spelling(phon)) or a phonology */
  function romanize(ipa, rules) {
    const r = Array.isArray(rules) ? rules.slice().sort((a, b) => b[0].length - a[0].length) : spelling(rules);
    return rewrite(String(ipa == null ? '' : ipa).replace(/[ˈˌ.]/g, ''), r);
  }
  /** spelling → a best-guess pronunciation (the rules read backwards) */
  function deromanize(word, rules) {
    const r = (Array.isArray(rules) ? rules : spelling(rules)).filter(x => x[1]).map(x => [x[1], x[0]]).sort((a, b) => b[0].length - a[0].length);
    return rewrite(String(word == null ? '' : word).toLowerCase(), r);
  }

  /** pattern groups: C and V from the inventory, automatic classes (L N S P F G) from the consonants, then custom ones */
  function groupsOf(phon) {
    const p = normPhon(phon);
    const g = { C: p.consonants.slice(), V: p.vowels.slice() };
    const of = cls => p.consonants.filter(c => IPA[cls].includes(base(c)) || IPA[cls].includes(c));
    const auto = { L: of('liquid'), N: of('nasal'), S: of('sibilant'), P: of('plosive'), F: of('fricative'), G: of('glide') };
    for (const [k, v] of Object.entries(auto)) if (v.length) g[k] = v;
    Object.assign(g, p.groups);
    return g;
  }
  const DROP = { flat: 0, gentle: .55, steep: 1.1 };
  /** [[sound, weight]] for a group: a set weight wins, otherwise earlier sounds are a little more common */
  function weighOf(p, arr) {
    const k = DROP[p.dropoff];
    return arr.map((x, i) => [x, p.weights[x] != null ? p.weights[x] : 5 / Math.pow(i + 1, k)]);
  }
  /** 'C(L)V(N)*3' → { items, w } */
  function parsePattern(s, inv) {
    let src = String(s || '').trim(), w = 1;
    const m = /^(.*?)\s*[*×]\s*(\d+(?:\.\d+)?)$/.exec(src);
    if (m) { src = m[1]; w = +m[2]; }
    const items = [];
    let opt = null;
    const lits = segments(src.replace(/[A-Z()\s]/g, ' '), inv).filter(x => !/\s/.test(x));
    let li = 0;
    for (let i = 0; i < src.length; i++) {
      const ch = src[i];
      if (ch === '(') { opt = []; continue; }
      if (ch === ')') { if (opt && opt.length) items.push({ opt }); opt = null; continue; }
      if (/\s/.test(ch)) continue;
      const it = /[A-Z]/.test(ch) ? { g: ch } : null;
      if (it) { (opt || items).push(it); continue; }
      // a literal: take the next pre-split literal sound (multi-letter sounds stay whole)
      const lit = lits[li++];
      if (!lit) continue;
      (opt || items).push({ lit });
      i += lit.length - 1;
    }
    return { src: s, items, w };
  }
  function bannedTest(banned) {
    const tests = banned.map(b => {
      const a = b.startsWith('^'), z = b.endsWith('$') && b.length > 1, core = b.replace(/^\^/, '').replace(/\$$/, '');
      if (!core) return () => false;
      return s => (a && z ? s === core : a ? s.startsWith(core) : z ? s.endsWith(core) : s.includes(core));
    });
    return s => tests.some(t => t(s));
  }

  /** words from a phonology: [{ word (spelling), ipa (with stress and syllable dots), plain (ipa without marks), syllables }] */
  function words(phon, { count = 10, syllables, rng: R, seed, avoid = [] } = {}) {
    const p = normPhon(phon);
    if (!p.vowels.length) return [];
    R = R || rng(seed);
    const inv = p.consonants.concat(p.vowels);
    const G = groupsOf(p), W = {};
    for (const [k, v] of Object.entries(G)) W[k] = weighOf(p, v);
    let pats = p.patterns.map(x => parsePattern(x, inv)).filter(x => x.items.length && x.w > 0);
    if (!pats.length) pats = [parsePattern(p.consonants.length ? 'CV' : 'V')];
    const pw = pats.map(x => [x, x.w]);
    const [lo, hi] = syllables || p.syllables;
    const sw = [];
    for (let n = lo; n <= Math.max(lo, hi); n++) sw.push([n, n === lo && hi > lo + 1 ? .8 : n === hi && hi > lo ? .7 : 1]);
    const isBanned = bannedTest(p.banned), rules = spelling(p);
    const vset = new Set(p.vowels), isV = s => vset.has(s) || (!p.consonants.includes(s) && isVowel(s));
    const known = new Set(avoid.map(norm)), out = [], seen = new Set();
    const expand = (items, syl) => {
      for (const it of items) {
        if (it.opt) { if (R() < .5) expand(it.opt, syl); continue; }
        if (it.lit) { syl.push(it.lit); continue; }
        const pool = W[it.g];
        if (pool && pool.length) syl.push(weighted(R, pool));
      }
    };
    for (let tries = 0; out.length < count && tries < count * 90 + 40; tries++) {
      const n = weighted(R, sw), syls = [];
      for (let i = 0; i < n; i++) { const s = []; expand(weighted(R, pw).items, s); if (s.length) syls.push(s); }
      if (!syls.length) continue;
      const segs = syls.flat(), plain = segs.join('');
      if (!segs.some(isV)) continue;
      if (isBanned(plain) || /(.)\1\1/.test(plain)) continue;
      // shape limits: consonant clusters, vowel runs, doubled sounds
      let rc = 0, rv = 0, bad = false;
      for (let i = 0; i < segs.length && !bad; i++) {
        if (isV(segs[i])) { rv++; rc = 0; } else { rc++; rv = 0; }
        if (rc > p.maxCluster || rv > p.maxVowels || (!p.geminates && i && segs[i] === segs[i - 1])) bad = true;
      }
      if (bad) continue;
      const word = romanize(plain, rules);
      const key = norm(word);
      if (!key || seen.has(key) || known.has(key) || known.has(norm(plain))) continue;
      seen.add(key);
      const st = syls.length < 2 || p.stress === 'none' ? -1 : p.stress === 'first' ? 0 : p.stress === 'last' ? syls.length - 1 : Math.max(0, syls.length - 2);
      const ipa = syls.map((s, i) => (i === st ? 'ˈ' : i > 0 ? '.' : '') + s.join('')).join('');
      out.push({ word, ipa, plain, syllables: syls.length });
    }
    return out;
  }
  /** (kept for older callers) words from a phonology as plain spellings */
  function phonology(phon, { count = 10, syllables, rng: R, avoid = [] } = {}) {
    return words(phon, { count, syllables, rng: R, avoid }).map(x => x.word);
  }
  /** a name from two words: 'kewa' + 'hesh' → 'Kewahesh' (a doubled join letter is merged) */
  function compound(a, b, { link = '' } = {}) {
    a = String(a || '').trim().toLowerCase(); b = String(b || '').trim().toLowerCase();
    if (!a) return cap(b);
    if (!b) return cap(a);
    if (!link && a.slice(-1) === b[0]) b = b.slice(1);
    return cap(a + link + b);
  }

  /* ---------------- built-in sound styles ---------------- */
  const S = (label, desc, onset, nucleus, coda, given, place, family) => ({ label, desc, onset: onset.split(' '), nucleus: nucleus.split(' '), coda: coda.split(' '), given, place: place.split(' '), family: family ? family.split(' ') : [] });
  const STYLES = {
    common: S('Common', 'Plain, familiar, easy to say', 'b br c d dr f g gr h j k l m n p r s st t th tr w', 'a e i o u a e o', 'n r l s th m d nd rd ck n', [2, 2], 'ford ton bury ham wick field stead brook dale wood', 'son er ley wright smith ward'),
    flowing: S('Flowing', 'Soft, liquid, elegant', 'l m n r s th v l n r', 'a e i o a e ae ia', 'l n s th r l n', [2, 3], 'riel ndor lith las wen dell mir sael', 'iel arin anor'),
    harsh: S('Harsh', 'Hard stops, short and heavy', 'b d g k kr gr dr th br z', 'a o u u a e', 'k g r d rn rk g m', [1, 2], 'grim dun hold kar mund heim zak', 'son grim hammer'),
    nordic: S('Northern', 'Cold coasts and longhouses', 'b d f g h j k l m n r s sv t th v', 'a e i o u y a e', 'r n ld rn nd k f lf rk', [1, 2], 'heim vik fjord stad by gard holm', 'sson sen'),
    regal: S('Regal', 'Courts, empires, old marble', 'c m l v s t r v c d', 'a e i o u a e i', 's n r x l nt us n', [2, 3], 'ium ora antium polis esta', 'ius ian anus'),
    sea: S('Salt-coast', 'Gulls, harbours and brine', 'g s m b h w f gl sk br cr d', 'a o e u a o', 'l ll n rn sk ck s', [1, 2], 'haven mouth reach strand wick holm mere pool', 'gull tide wake mere'),
    desert: S('Sun-plains', 'Warm, open, long vowels', 'k z s q r m n h y b d', 'a i u a a i', 'r d m n z sh', [2, 3], 'abad arra un zir ah', 'ibn al el'),
    frost: S('Frost', 'Sharp, bright, wintry', 'sk kr fr h v s k t gl', 'i e a y ö e', 'r k t n lk rk', [1, 2], 'vik hold fell gard spire', 'fell frost'),
    arcane: S('Arcane', 'Strange letters, old magic', 'x z th v q ch sh y z v', 'a e i o y a e', 'x th s n l r', [2, 3], 'ix oth ara ume eth', 'ix oth'),
    rustic: S('Rustic', 'Villages, farms, hedgerows', 'b c d f g h l m n p r t w', 'a e i o u o', 'b d g p t n ck m', [1, 2], 'ton by bottom hill green well cot', 'smith miller tanner baker'),
    island: S('Island', 'Open vowels, light consonants', 'h k l m n p t w v', 'a e i o u a a o', 'n l', [2, 3], 'ua alo ike ona ari', 'ola ae'),
    steppe: S('Steppe', 'Wide skies, riders, horn calls', 'b d k q t s z ch j m n r y', 'a u i o e a u', 'n r k t sh l', [2, 3], 'tai kul dar orda tash', 'khan ar ek'),
    sylvan: S('Sylvan', 'Forests, moss and birdsong', 'f l m n r s th v w y', 'a e i ia ei o', 'l n r s th', [2, 3], 'wood leaf glen thorne vale', 'leaf briar'),
  };
  const VOWELS = /[aeiouyöä]/i;
  function styleWord(st, R, syl) {
    let w = '';
    for (let i = 0; i < syl; i++) {
      let on = pick(R, st.onset);
      if (i > 0 && !VOWELS.test(w.slice(-1)) && R() < .35) on = '';   // let syllables run together now and then
      w += on + pick(R, st.nucleus) + (i === syl - 1 ? (R() < .75 ? pick(R, st.coda) : '') : R() < .3 ? pick(R, st.coda) : '');
    }
    return w.replace(/(.)\1\1+/g, '$1$1');
  }
  /** kind: person | place | family | word; samples (from a culture) take precedence through Markov chains, then a
      phonology (a language), then a sound style */
  function generate({ style = 'common', kind = 'person', count = 10, samples, phon, seed, rng: R, avoid = [] } = {}) {
    R = R || rng(seed == null || kind === 'person' ? seed : String(seed) + ':' + kind);
    if (samples && samples.length >= 3) { const m = markov(samples, { count, rng: R, avoid }); if (m.length) return m; }
    if (phon && (list(phon.consonants).length || list(phon.vowels).length)) {
      const p = normPhon(phon);
      const syl = kind === 'word' ? null : [Math.max(p.syllables[0], 2), Math.max(p.syllables[1], kind === 'place' ? 3 : 2)];
      return words(p, { count, syllables: syl, rng: R, avoid }).map(x => cap(x.word));
    }
    const st = STYLES[style] || STYLES.common, out = new Set(), known = new Set(avoid.map(a => String(a).toLowerCase()));
    for (let tries = 0; out.size < count && tries < count * 40; tries++) {
      const syl = st.given[0] + Math.floor(R() * (st.given[1] - st.given[0] + 1));
      const suffixed = (kind === 'place' && st.place.length && R() < .7) || (kind === 'family' && st.family.length && R() < .4);
      let w = styleWord(st, R, suffixed ? 1 : syl);
      if (suffixed) w += pick(R, kind === 'place' ? st.place : st.family);
      if (w.length < 3 || w.length > (kind === 'place' ? 12 : 10) || known.has(w) || /[aeiouyö]{3}/i.test(w) || /[^aeiouyö\s]{4}/i.test(w)) continue;
      out.add(cap(w));
    }
    return [...out];
  }
  /** a full name: given (+ family) */
  function fullName(o = {}) {
    const R = o.rng || rng(o.seed);
    const g = generate(Object.assign({}, o, { kind: 'person', count: 1, rng: R, samples: o.given }))[0] || 'Ana';
    if (o.noFamily) return g;
    const f = generate(Object.assign({}, o, { kind: 'family', count: 1, rng: R, samples: o.family }))[0];
    return f ? g + ' ' + f : g;
  }

  /* ---------------- phonology presets (starting points for a new language) ---------------- */
  const P = (label, desc, consonants, vowels, patterns, extra) => Object.assign({ label, desc, consonants: consonants.split(' '), vowels: vowels.split(' '), patterns: patterns.split(' '), syllables: [1, 3], banned: [], weights: {}, romanization: [], groups: {}, stress: 'first' }, extra || {});
  const PRESETS = {
    saltcoast: P('Salt coast', 'Hissing sibilants and breaking waves', 's ʃ k t l r m n h w g d θ f b', 'a e i o u', 'CV*5 CVK*4 sPV V VK OLV',
      { weights: { s: 8, ʃ: 6, k: 5, l: 5, h: 4, a: 6, e: 5 }, groups: { K: 's ʃ l r n k t', O: 'k g b f t d', P: 'k t' }, banned: ['ʃs', 'sʃ', 'θs', 'h$', 'w$', 'sh', 'tl', 'dl'], maxCluster: 2 }),
    flowing: P('Flowing', 'Liquids and open vowels; songs and courts', 'l n r m v s θ ð w j', 'a e i o u ɛ', 'CV*5 V CVL CVN',
      { stress: 'penult', syllables: [2, 3], banned: ['ðθ', 'θð', 'jj', 'ji', 'wu'], weights: { l: 7, n: 6, r: 6, a: 6, e: 5, i: 5 }, maxCluster: 2 }),
    harsh: P('Harsh', 'Back consonants and clipped syllables', 'k g r d t x ʔ b z ʒ ʃ m n', 'a o u ɛ', 'CVC*4 OLVC CV',
      { syllables: [1, 2], groups: { O: 'k g d b t', L: 'r' }, banned: ['ʔʔ', 'xx', 'ʒʃ', 'ʃʒ', 'ʔ$'], weights: { k: 7, r: 7, g: 6, d: 5 }, maxCluster: 2 }),
    northern: P('Northern', 'Stops and long winters', 'p t k b d g f v s h m n l r j', 'a e i o u y ø', 'CV CVC*3 CVKC',
      { syllables: [1, 2], groups: { K: 'r l n s' }, banned: ['jj', 'h$', 'j$', 'hk', 'hg', 'vf', 'fv'], maxCluster: 3 }),
    desert: P('Sun-plains', 'Long vowels, open plains', 'q k t d s z ʃ h m n r l j w', 'a i u aː iː uː', 'CV*4 CVC*2',
      { stress: 'penult', syllables: [2, 3], banned: ['qq', 'hh', 'h$', 'ʃh', 'sh'], weights: { a: 7, i: 5, u: 4, 'aː': 3, 'iː': 2, 'uː': 2 }, maxCluster: 2, maxVowels: 1 }),
    island: P('Island', 'Open syllables and light consonants', 'p t k ʔ m n h l w', 'a e i o u', 'CV*6 V',
      { stress: 'penult', syllables: [2, 3], weights: { a: 8, k: 6 }, banned: ['wu', 'ʔ$'] }),
    clipped: P('Clipped', 'Short, punchy, one or two syllables', 'p t k b d g m n ŋ s h l', 'a e i o u ə', 'CVC*4 CV',
      { syllables: [1, 2], banned: ['^ŋ', 'h$', 'ŋh', 'hŋ'], maxCluster: 2 }),
    simple: P('Simple', 'A small, friendly starting set', 'p t k m n s l w j', 'a e i o u', 'CV*3 CVC',
      { syllables: [2, 3], stress: 'none', banned: ['ji', 'wu', 'w$', 'j$'], maxCluster: 1 }),
  };

  /* ---------------- sound changes ---------------- */
  /* Rules apply in order, each to the whole word at once:  from > to / environment // exception
     _ marks the sound itself, # a word edge, capitals are categories (V, C, or your own: N = m n ŋ),
     (x) is optional, {a,b} is either, … is any run of sounds, ∅ or 0 means nothing (deletion or insertion). */
  const NULL = /^(?:∅|0|Ø|-)$/;
  function parseRule(src) {
    let s = String(src || '').trim(), unless = '';
    const ui = s.indexOf('//');
    if (ui >= 0) { unless = s.slice(ui + 2).trim(); s = s.slice(0, ui).trim(); }
    const m = /^(.*?)\s*(?:>|→|=>|->)\s*([^/]*?)\s*(?:\/\s*(.*))?$/.exec(s);
    if (!m) return null;
    return { from: NULL.test(m[1].trim()) ? '' : m[1].trim(), to: NULL.test(m[2].trim()) ? '' : m[2].trim(), env: (m[3] || '').trim(), unless };
  }
  /** text → { categories: {X: [sounds]}, rules: [{from, to, env, unless, note}], errors: [{line, message}] } */
  function parseChanges(text) {
    const categories = {}, rules = [], errors = [];
    String(text || '').split(/\r?\n/).forEach((raw, i) => {
      let line = raw.trim(), off = false;
      // "# k > g / V_V" is a switched-off rule; any other line starting with # ; or -- is a comment
      const dis = /^#\s*(\S+\s*(?:>|→|=>|->).*)$/.exec(line);
      if (dis) { line = dis[1]; off = true; }
      else if (!line || /^(#|;|--)/.test(line)) return;
      let note = '';
      const ni = line.indexOf(';');
      if (ni > 0) { note = line.slice(ni + 1).trim(); line = line.slice(0, ni).trim(); }
      const cat = /^([A-Z])\s*=\s*(.*)$/.exec(line);
      if (cat) { categories[cat[1]] = list(cat[2]); return; }
      const r = parseRule(line);
      if (!r) { errors.push({ line: i + 1, message: 'Write a rule as “from > to / environment”.' }); return; }
      rules.push(Object.assign(r, { note }, off ? { off: true } : null));
    });
    return { categories, rules, errors };
  }
  /** { categories, rules } → text (round-trips through parseChanges) */
  function changesText({ categories = {}, rules = [] } = {}) {
    const lines = Object.entries(categories).filter(([, v]) => list(v).length).map(([k, v]) => k + ' = ' + list(v).join(' '));
    if (lines.length) lines.push('');
    for (const r of rules) {
      const core = (r.from || '∅') + ' > ' + (r.to || '∅') + (r.env ? ' / ' + r.env : '') + (r.unless ? ' // ' + r.unless : '');
      lines.push((r.off ? '# ' : '') + core + (r.note ? '   ; ' + r.note : ''));
    }
    return lines.join('\n');
  }
  /** compiles a rule set once; opts.inventory = the language's sounds (multi-letter sounds stay whole) */
  function compileChanges(set, opts = {}) {
    const cats = {};
    for (const [k, v] of Object.entries((set && set.categories) || {})) if (/^[A-Z]$/.test(k)) cats[k] = list(v);
    for (const [k, v] of Object.entries(opts.defaults || {})) if (!cats[k] || !cats[k].length) cats[k] = list(v);
    const inv = [...new Set([].concat(...Object.values(cats), opts.inventory || []))];
    const code = new Map(), back = new Map();
    let next = 0xE000;
    const enc = s => { let c = code.get(s); if (!c) { c = String.fromCodePoint(next++); code.set(s, c); back.set(c, s); } return c; };
    const dec = str => [...str].map(c => back.get(c) || c).join('');
    // one side of a rule → items
    function lex(str, where) {
      const items = [];
      const s = String(str || '').replace(/\s+/g, '');
      for (let i = 0; i < s.length;) {
        const ch = s[i];
        if (ch === '_') { items.push({ t: 'focus' }); i++; continue; }
        if (ch === '#') { items.push({ t: 'bound' }); i++; continue; }
        if (ch === '…' || s.startsWith('...', i)) { items.push({ t: 'any' }); i += ch === '…' ? 1 : 3; continue; }
        if (ch === '(') { const j = s.indexOf(')', i); if (j < 0) throw new Error('A “(” has no “)”.'); items.push({ t: 'opt', items: lex(s.slice(i + 1, j), where) }); i = j + 1; continue; }
        if (ch === '{' || ch === '[') {
          const close = ch === '{' ? '}' : ']', j = s.indexOf(close, i);
          if (j < 0) throw new Error('A “' + ch + '” has no “' + close + '”.');
          const inner = s.slice(i + 1, j);
          const alts = (ch === '{' || /,/.test(inner) ? inner.split(',') : segments(inner, inv)).filter(Boolean).map(a => lex(a, where));
          items.push({ t: 'alt', alts }); i = j + 1; continue;
        }
        if (/[A-Z]/.test(ch)) { if (!cats[ch]) throw new Error('The category ' + ch + ' is not defined (write “' + ch + ' = …”).'); items.push({ t: 'cat', v: ch }); i++; continue; }
        if (/[ˈˌ.,]/.test(ch)) { i++; continue; }
        const seg = segments(s.slice(i).split(/[_#({[A-Z…]/)[0], inv)[0];
        if (!seg) { i++; continue; }
        items.push({ t: 'seg', v: seg }); i += seg.length;
      }
      return items;
    }
    const reOf = items => items.map(it => {
      if (it.t === 'seg') return enc(it.v);
      if (it.t === 'cat') return '[' + cats[it.v].map(enc).join('') + ']';
      if (it.t === 'opt') return '(?:' + reOf(it.items) + ')?';
      if (it.t === 'alt') return '(?:' + it.alts.map(reOf).join('|') + ')';
      if (it.t === 'any') return '[^]*?';
      return '';
    }).join('');
    function envOf(str) {
      if (!str) return { left: '', right: '' };
      const items = lex(str);
      const f = items.findIndex(x => x.t === 'focus');
      if (f < 0) throw new Error('The environment needs a “_” where the sound sits.');
      const L = items.slice(0, f), R = items.slice(f + 1);
      if (L.slice(1).some(x => x.t === 'bound') || R.slice(0, -1).some(x => x.t === 'bound')) throw new Error('“#” only goes at the start or end of an environment.');
      const lb = L[0] && L[0].t === 'bound', rb = R.length && R[R.length - 1].t === 'bound';
      return { left: (lb ? '^' : '') + reOf(L.filter(x => x.t !== 'bound')), right: reOf(R.filter(x => x.t !== 'bound')) + (rb ? '$' : '') };
    }
    const rules = ((set && set.rules) || []).map((r, idx) => {
      const out = { idx, rule: r, off: !!r.off };
      try {
        const from = lex(r.from || ''), to = lex(r.to || '');
        if (from.some(x => x.t === 'focus' || x.t === 'bound') || to.some(x => x.t !== 'seg' && x.t !== 'cat')) throw new Error('“From” and “to” are sounds or categories.');
        const env = envOf(r.env || '');
        if (!from.length && !env.left && !env.right) throw new Error('An insertion needs an environment, e.g. “∅ > e / s_t”.');
        const fromRe = from.map(it => '(' + reOf([it]) + ')').join('');
        out.re = new RegExp((env.left ? '(?<=' + env.left + ')' : '') + fromRe + (env.right ? '(?=' + env.right + ')' : ''), 'gu');
        if (r.unless) { const ex = envOf(r.unless); out.exL = new RegExp('(?:' + (ex.left || '') + ')$', 'u'); out.exR = new RegExp('^(?:' + (ex.right || '') + ')', 'u'); }
        // each "to" item: a fixed sound, or a category mapped from the matching "from" category by position
        const fromCats = from.map((it, i) => (it.t === 'cat' ? i : -1)).filter(i => i >= 0);
        out.build = groups => to.map((it, i) => {
          if (it.t === 'seg') return enc(it.v);
          const fi = from[i] && from[i].t === 'cat' ? i : fromCats[0];
          if (fi == null || fi < 0) return enc(cats[it.v][0]);
          const got = dec(groups[fi] || ''), k = cats[from[fi].v].indexOf(got);
          return enc(k >= 0 && cats[it.v][k] != null ? cats[it.v][k] : got);
        }).join('');
        if (to.some(it => it.t === 'cat') && !fromCats.length) throw new Error('A category in “to” needs one in “from” to match it.');
      } catch (e) { out.error = e.message; }
      return out;
    });
    return { rules, cats, inv, enc, dec };
  }
  /** applies compiled (or raw) changes to a word; returns { out, steps: [{ idx, before, after }] } */
  function applyChanges(word, compiled, { trace = false } = {}) {
    const C = compiled && compiled.rules && compiled.enc ? compiled : compileChanges(compiled || {});
    const steps = [];
    const parts = String(word == null ? '' : word).split(/(\s+)/);
    const res = parts.map(part => {
      if (!part || /^\s+$/.test(part)) return part;
      let s = segments(part, C.inv).map(C.enc).join('');
      for (const r of C.rules) {
        if (r.off || r.error || !r.re) continue;
        r.re.lastIndex = 0;
        const s2 = s.replace(r.re, (...args) => {
          const m = args[0], n = args.length - 3, groups = args.slice(1, 1 + n), off = args[1 + n], str = args[2 + n];
          if (r.exL && r.exL.test(str.slice(0, off)) && r.exR.test(str.slice(off + m.length))) return m;
          return r.build(groups);
        });
        if (s2 !== s) { if (trace) steps.push({ idx: r.idx, before: C.dec(s), after: C.dec(s2) }); s = s2; }
      }
      return C.dec(s);
    });
    return { out: res.join(''), steps };
  }

  return {
    rng, hash, pick, weighted, cap, norm, markov, phonology, generate, fullName, STYLES, DEFAULT_PHON,
    IPA, ROMAN, PRESETS, isVowel, segments, normPhon, spelling, romanize, deromanize, groupsOf, parsePattern, words, compound,
    parseRule, parseChanges, changesText, compileChanges, applyChanges,
  };
});
