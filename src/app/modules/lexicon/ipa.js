/* Lexicon: clickable IPA charts (consonants by place and manner, vowels on the vowel trapezoid). */
(function () {
  'use strict';
  const { h } = GK;
  const X = WB.lexicon._;

  const PLACES = [['Bilabial', 'bilabial'], ['Labio­dental', 'labiodental'], ['Dental', 'dental'], ['Alveolar', 'alveolar'], ['Post­alveolar', 'postalveolar'], ['Retro­flex', 'retroflex'],
    ['Palatal', 'palatal'], ['Velar', 'velar'], ['Uvular', 'uvular'], ['Pharyn­geal', 'pharyngeal'], ['Glottal', 'glottal']];
  const _ = null;
  /* manner, label, cells per place: [voiceless, voiced] */
  const ROWS = [
    ['plosive', 'Plosive', [['p', 'b'], _, _, ['t', 'd'], _, ['ʈ', 'ɖ'], ['c', 'ɟ'], ['k', 'g'], ['q', 'ɢ'], _, ['ʔ', _]]],
    ['nasal', 'Nasal', [[_, 'm'], [_, 'ɱ'], _, [_, 'n'], _, [_, 'ɳ'], [_, 'ɲ'], [_, 'ŋ'], [_, 'ɴ'], _, _]],
    ['trill', 'Trill', [[_, 'ʙ'], _, _, [_, 'r'], _, _, _, _, [_, 'ʀ'], _, _]],
    ['tap', 'Tap or flap', [_, [_, 'ⱱ'], _, [_, 'ɾ'], _, [_, 'ɽ'], _, _, _, _, _]],
    ['fricative', 'Fricative', [['ɸ', 'β'], ['f', 'v'], ['θ', 'ð'], ['s', 'z'], ['ʃ', 'ʒ'], ['ʂ', 'ʐ'], ['ç', 'ʝ'], ['x', 'ɣ'], ['χ', 'ʁ'], ['ħ', 'ʕ'], ['h', 'ɦ']]],
    ['latfric', 'Lateral fricative', [_, _, _, ['ɬ', 'ɮ'], _, _, _, _, _, _, _]],
    ['approx', 'Approximant', [_, [_, 'ʋ'], _, [_, 'ɹ'], _, [_, 'ɻ'], [_, 'j'], [_, 'ɰ'], _, _, _]],
    ['latapprox', 'Lateral approximant', [_, _, _, [_, 'l'], _, [_, 'ɭ'], [_, 'ʎ'], [_, 'ʟ'], _, _, _]],
    ['affricate', 'Affricate', [_, ['pf', _], _, ['ts', 'dz'], ['tʃ', 'dʒ'], ['ʈʂ', 'ɖʐ'], ['tɕ', 'dʑ'], ['kx', _], _, _, _]],
  ];
  const OTHERS = [['w', 'voiced labial-velar approximant'], ['ʍ', 'voiceless labial-velar fricative'], ['ɥ', 'voiced labial-palatal approximant'], ['ɕ', 'voiceless alveolo-palatal fricative'], ['ʑ', 'voiced alveolo-palatal fricative'], ['ɺ', 'alveolar lateral flap'], ['ɧ', 'voiceless palatal-velar fricative']];
  const NAMES = {};
  ROWS.forEach(([m, label, cells]) => cells.forEach((c, i) => { if (!c) return; if (c[0]) NAMES[c[0]] = 'voiceless ' + PLACES[i][1] + ' ' + label.toLowerCase(); if (c[1]) NAMES[c[1]] = 'voiced ' + PLACES[i][1] + ' ' + label.toLowerCase(); }));
  OTHERS.forEach(([s, n]) => { NAMES[s] = n; });

  /* vowels: symbol, height (0 close … 1 open), column f|nf|c|nb|b, rounded */
  const VOWELS = [
    ['i', 0, 'f', 0], ['y', 0, 'f', 1], ['ɨ', 0, 'c', 0], ['ʉ', 0, 'c', 1], ['ɯ', 0, 'b', 0], ['u', 0, 'b', 1],
    ['ɪ', 1 / 6, 'nf', 0], ['ʏ', 1 / 6, 'nf', 1], ['ʊ', 1 / 6, 'nb', 1],
    ['e', 1 / 3, 'f', 0], ['ø', 1 / 3, 'f', 1], ['ɘ', 1 / 3, 'c', 0], ['ɵ', 1 / 3, 'c', 1], ['ɤ', 1 / 3, 'b', 0], ['o', 1 / 3, 'b', 1],
    ['ə', 1 / 2, 'c', -1],
    ['ɛ', 2 / 3, 'f', 0], ['œ', 2 / 3, 'f', 1], ['ɜ', 2 / 3, 'c', 0], ['ɞ', 2 / 3, 'c', 1], ['ʌ', 2 / 3, 'b', 0], ['ɔ', 2 / 3, 'b', 1],
    ['æ', 5 / 6, 'f', -1], ['ɐ', 5 / 6, 'c', -1],
    ['a', 1, 'f', 0], ['ɶ', 1, 'f', 1], ['ɑ', 1, 'b', 0], ['ɒ', 1, 'b', 1],
  ];
  const HEIGHT = ['close', 'near-close', 'close-mid', 'mid', 'open-mid', 'near-open', 'open'];
  const COLN = { f: 'front', nf: 'near-front', c: 'central', nb: 'near-back', b: 'back' };
  VOWELS.forEach(([s, y, c, r]) => { NAMES[s] = HEIGHT[Math.round(y * 6)] + ' ' + COLN[c] + (r === 1 ? ' rounded' : r === 0 ? ' unrounded' : '') + ' vowel'; });
  const describe = s => NAMES[s] || (WB.names.isVowel(s) ? 'vowel' : 'sound');

  /** opts: { has(s), toggle(s, on, btn), info(s) → extra tooltip text, menu(s, ev) } */
  function cell(s, o) {
    const b = h('button.lx-ipa-cell', { type: 'button', class: o.has(s) ? 'on' : '', 'aria-pressed': String(o.has(s)), text: s });
    const tip = () => { b.title = s + ' — ' + describe(s) + (o.info ? o.info(s) : '') + (o.has(s) ? '\nClick to remove · right-click for weight and spelling' : '\nClick to add'); };
    tip();
    b.addEventListener('mouseenter', tip);
    b.addEventListener('click', () => { const on = !b.classList.contains('on'); b.classList.toggle('on', on); b.setAttribute('aria-pressed', String(on)); o.toggle(s, on, b); });
    b.addEventListener('contextmenu', e => { if (o.menu && o.has(s)) { e.preventDefault(); o.menu(s, b); } });
    return b;
  }
  function consonants(o) {
    const grid = h('div.lx-cchart', { role: 'grid', 'aria-label': 'Consonant chart' });
    grid.appendChild(h('div.lx-cc-corner'));
    PLACES.forEach(([label]) => grid.appendChild(h('div.lx-cc-head', { text: label })));
    for (const [, label, cells] of ROWS) {
      grid.appendChild(h('div.lx-cc-row', { text: label }));
      cells.forEach(c => grid.appendChild(h('div.lx-cc-cell', { class: c ? '' : 'empty' }, c ? [c[0] ? cell(c[0], o) : h('span.lx-ipa-gap'), c[1] ? cell(c[1], o) : h('span.lx-ipa-gap')] : [])));
    }
    const others = h('div.lx-cc-others', [h('span.gk-small.gk-muted', { text: 'Other' }), ...OTHERS.map(([s]) => cell(s, o))]);
    return h('div.lx-cchart-wrap', [h('div.lx-cchart-scroll', [grid]), others]);
  }
  function vowels(o) {
    const box = h('div.lx-vchart', { role: 'group', 'aria-label': 'Vowel chart' });
    // the trapezoid: front edge slants from (0, 0) to (.5, 1), back edge is upright at 1, centre line from .5 to .75
    const xf = y => .5 * y, xc = y => .5 + .25 * y;
    const NS = 'http://www.w3.org/2000/svg';
    const svg = document.createElementNS(NS, 'svg');
    svg.setAttribute('viewBox', '0 0 100 100'); svg.setAttribute('preserveAspectRatio', 'none'); svg.classList.add('lx-vchart-lines');
    const line = (x1, y1, x2, y2) => { const l = document.createElementNS(NS, 'line'); Object.entries({ x1, y1, x2, y2 }).forEach(([k, v]) => l.setAttribute(k, v * 100)); l.setAttribute('vector-effect', 'non-scaling-stroke'); svg.appendChild(l); };
    line(0, 0, 1, 0); line(xf(1), 1, 1, 1); line(0, 0, xf(1), 1); line(1, 0, 1, 1); line(.5, 0, xc(1), 1);
    for (const y of [1 / 3, 2 / 3]) line(xf(y), y, 1, y);
    box.appendChild(svg);
    for (const [s, y, c, r] of VOWELS) {
      let x = c === 'f' ? xf(y) : c === 'c' ? xc(y) : c === 'b' ? 1 : c === 'nf' ? xf(y) + .17 : .83;
      if (r === 0) x -= .045; else if (r === 1) x += .045;
      const b = cell(s, o);
      b.classList.add('v');
      b.style.left = (x * 100) + '%'; b.style.top = (y * 100) + '%';
      box.appendChild(b);
    }
    const heads = h('div.lx-vchart-heads', ['Front', 'Central', 'Back'].map(t => h('span', { text: t })));
    return h('div.lx-vchart-wrap', [heads, h('div.lx-vchart-pad', [box])]);
  }
  X.charts = { consonants, vowels, describe, ROWS, PLACES, VOWELS, OTHERS };
})();
