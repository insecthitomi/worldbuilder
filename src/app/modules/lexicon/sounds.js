/* Phonology tab (clickable IPA charts, weights, syllable shapes, spelling, banned clusters, live sample words) and
   Generator tab (batches of words or names from the phonology; lock the good ones, add them with a meaning). */
(function () {
  'use strict';
  const { h, ui } = GK;
  const X = WB.lexicon._;
  const N = () => WB.names;

  /* ================= Phonology ================= */
  function phonology(host, L) {
    const nm = N();
    let P = L.phon();
    const had = X.hasPhon(L.lang);
    const commit = (patch, { charts, inventory, shapes, spelling } = {}) => {
      P = nm.normPhon(Object.assign({}, P, patch));
      L.savePhon(P);
      if (charts) paintCharts();
      if (inventory !== false) paintInventory();
      if (shapes) paintShapes();
      if (spelling !== false) paintSpelling();
      paintSamples();
      paintSummary();
    };
    const inv = () => P.consonants.concat(P.vowels);
    const has = s => P.consonants.includes(s) || P.vowels.includes(s);
    const toggle = (s, on) => {
      const isV = nm.isVowel(s) && !P.consonants.includes(s);
      const key = isV ? 'vowels' : 'consonants';
      const arr = P[key].filter(x => x !== s);
      if (on) arr.push(s);
      commit({ [key]: arr });
    };
    const spellOf = s => { const r = nm.spelling(P).find(x => x[0] === s); return r ? r[1] : s; };
    const weightOf = (s, arr) => { if (P.weights[s] != null) return P.weights[s]; const i = arr.indexOf(s); return Math.round(5 / Math.pow(i + 1, { flat: 0, gentle: .55, steep: 1.1 }[P.dropoff]) * 10) / 10; };
    const info = s => (has(s) ? '\nWeight ' + weightOf(s, nm.isVowel(s) ? P.vowels : P.consonants) + (spellOf(s) !== s ? ' · spelled “' + spellOf(s) + '”' : '') : '');

    /* sound popover: weight, spelling, remove */
    function soundMenu(s, anchor) {
      const arr = P.vowels.includes(s) ? P.vowels : P.consonants;
      const auto = P.weights[s] == null;
      const val = h('span.gk-val', { text: auto ? 'auto' : String(P.weights[s]) });
      const r = h('input.gk-range', { type: 'range', min: 0, max: 10, step: .5 });
      r.value = weightOf(s, arr); r.style.setProperty('--p', (r.value / 10 * 100) + '%');
      r.addEventListener('input', () => { r.style.setProperty('--p', (r.value / 10 * 100) + '%'); val.textContent = r.value; commit({ weights: Object.assign({}, P.weights, { [s]: +r.value }) }, { spelling: false }); });
      const sp = ui.input({ value: spellOf(s), placeholder: s, onInput: v => { const rules = P.romanization.filter(x => x[0] !== s); if (v !== (nm.ROMAN[s] != null ? nm.ROMAN[s] : s)) rules.push([s, v]); commit({ romanization: rules }); } });
      const pop = WB.ui.popover(anchor, h('div.lx-sound-pop', [
        h('div.gk-row.nowrap', [h('span.lx-sound-big', { text: s }), h('div.gk-grow', [h('b', { text: X.charts.describe(s) }), h('div.gk-small.gk-muted', { text: 'How common, and how it is written' })])]),
        ui.field({ label: 'How common', control: h('div.gk-row.nowrap', [h('div.gk-grow', [r]), val, ui.button({ label: 'Auto', small: true, kind: 'ghost', title: 'Earlier sounds in the list are a little more common', onClick: () => { const w = Object.assign({}, P.weights); delete w[s]; commit({ weights: w }); pop.close(); } })]) }),
        ui.field({ label: 'Spelled', hint: 'How the sound is written in the dictionary', control: sp }),
        h('div.gk-row', [
          ui.button({ label: 'Move earlier', icon: '↑', small: true, kind: 'ghost', title: 'Earlier sounds are more common when the weight is automatic', onClick: () => { const key = P.vowels.includes(s) ? 'vowels' : 'consonants'; const a = P[key].slice(), i = a.indexOf(s); if (i > 0) { a.splice(i, 1); a.splice(i - 1, 0, s); commit({ [key]: a }); } } }),
          h('span.gk-grow'),
          ui.button({ label: 'Remove', icon: '✕', small: true, kind: 'danger', onClick: () => { pop.close(); toggle(s, false); paintCharts(); } }),
        ]),
      ]), { group: 'lx-sound', width: '19em', cls: 'lx-pop' });
    }

    /* ---------- charts ---------- */
    const cBox = h('div'), vBox = h('div');
    const chartOpts = { has, toggle: (s, on) => toggle(s, on), info, menu: soundMenu };
    function paintCharts() { GK.clear(cBox); GK.clear(vBox); cBox.appendChild(X.charts.consonants(chartOpts)); vBox.appendChild(X.charts.vowels(chartOpts)); }
    const addSounds = ui.input({ placeholder: 'Add sounds: aː ai tʃ ŋʷ …' });
    addSounds.addEventListener('keydown', e => {
      if (e.key !== 'Enter') return;
      const list = addSounds.value.split(/[\s,]+/).filter(Boolean);
      if (!list.length) return;
      const c = P.consonants.slice(), v = P.vowels.slice();
      for (const s of list) { if (has(s)) continue; (nm.isVowel(s) ? v : c).push(s); }
      addSounds.value = '';
      commit({ consonants: c, vowels: v }, { charts: true });
    });

    /* ---------- inventory ---------- */
    const invBox = h('div.lx-inv');
    function paintInventory() {
      GK.clear(invBox);
      const group = (label, arr, key) => {
        const max = Math.max(1, ...arr.map(s => weightOf(s, arr)));
        const row = h('div.lx-inv-row');
        arr.forEach(s => {
          const wgt = weightOf(s, arr), spelled = spellOf(s);
          const b = h('button.lx-snd', { type: 'button', title: X.charts.describe(s) + ' · weight ' + wgt + (P.weights[s] == null ? ' (auto)' : '') + '\nClick for weight and spelling · drag to reorder', draggable: true, dataset: { s } }, [
            h('span.lx-snd-s', { text: s }), spelled !== s ? h('span.lx-snd-sp', { text: spelled || '∅' }) : null,
            h('span.lx-snd-bar', [h('i', { style: { width: Math.round(wgt / max * 100) + '%' }, class: P.weights[s] == null ? 'auto' : '' })]),
          ]);
          b.addEventListener('click', () => soundMenu(s, b));
          b.addEventListener('dragstart', e => { e.dataTransfer.setData('text/x-lx-sound', s); e.dataTransfer.effectAllowed = 'move'; });
          b.addEventListener('dragover', e => { if ([...e.dataTransfer.types].includes('text/x-lx-sound')) { e.preventDefault(); b.classList.add('drop'); } });
          b.addEventListener('dragleave', () => b.classList.remove('drop'));
          b.addEventListener('drop', e => { b.classList.remove('drop'); const from = e.dataTransfer.getData('text/x-lx-sound'); if (!from || from === s || !arr.includes(from)) return; e.preventDefault(); const a = arr.filter(x => x !== from); a.splice(a.indexOf(s), 0, from); commit({ [key]: a }); });
          row.appendChild(b);
        });
        if (!arr.length) row.appendChild(h('span.gk-small.gk-muted', { text: 'None yet — click the chart.' }));
        return h('div.lx-inv-group', [h('div.lx-inv-label', [label, h('span.gk-faint', { text: ' ' + arr.length })]), row]);
      };
      invBox.append(group('Consonants', P.consonants, 'consonants'), group('Vowels', P.vowels, 'vowels'),
        h('div.gk-row.lx-inv-foot', [h('span.gk-small.gk-muted', { text: 'Commonness of sounds without their own weight:' }),
          ui.segmented({ value: P.dropoff, options: [['flat', 'Even', 'Every sound equally common'], ['gentle', 'Gentle', 'Earlier sounds a little more common'], ['steep', 'Steep', 'A few sounds dominate']], onChange: v => commit({ dropoff: v }) })]));
    }

    /* ---------- syllable shapes ---------- */
    const shapeBox = h('div.lx-shapes');
    function paintShapes() {
      GK.clear(shapeBox);
      const G = nm.groupsOf(P);
      const pats = h('div.lx-chipset');
      P.patterns.forEach((p, i) => {
        const pp = nm.parsePattern(p, inv());
        const c = h('span.lx-pat', { title: 'Weight ' + pp.w + ' — click to change' }, [h('code', { text: pp.src.replace(/\s*[*×]\s*[\d.]+$/, '') }), pp.w !== 1 ? h('span.lx-pat-w', { text: '×' + pp.w }) : null,
          h('button.lx-x', { type: 'button', text: '✕', title: 'Remove this shape', onclick: e => { e.stopPropagation(); commit({ patterns: P.patterns.filter((x, j) => j !== i) }, { shapes: true }); } })]);
        c.addEventListener('click', () => {
          const base = pp.src.replace(/\s*[*×]\s*[\d.]+$/, '');
          WB.ui.menu([{ header: base + ' — how often' }].concat([1, 2, 3, 4, 6, 8].map(n => ({ label: '×' + n, checked: pp.w === n, onClick: () => { const a = P.patterns.slice(); a[i] = n === 1 ? base : base + '*' + n; commit({ patterns: a }, { shapes: true }); } }))), c);
        });
        pats.appendChild(c);
      });
      const add = h('input.lx-pat-add', { placeholder: 'CVC', title: 'A syllable shape: capitals are groups (C, V, L, N…), (x) is optional, *3 makes it 3× as common. Enter adds.', spellcheck: false });
      add.addEventListener('keydown', e => { if (e.key === 'Enter' && add.value.trim()) { commit({ patterns: P.patterns.concat(add.value.trim().split(/\s+/)) }, { shapes: true }); } });
      pats.appendChild(add);
      const num = (v, onChange, min, max, title) => { const i = h('input.gk-input.gk-control.lx-num', { type: 'number', min, max, value: v, title }); i.addEventListener('change', () => onChange(Math.max(min, Math.min(max, Math.round(+i.value || min))))); return i; };
      const groups = h('div.lx-groups');
      for (const [k, v] of Object.entries(G)) {
        const custom = P.groups[k] != null;
        groups.appendChild(h('div.lx-group', { class: custom ? 'custom' : '' }, [h('code.lx-group-k', { text: k }), h('span.lx-group-v', { text: v.join(' ') || '—' }),
          custom ? h('button.lx-x', { type: 'button', text: '✕', title: 'Remove group ' + k, onclick: () => { const g = Object.assign({}, P.groups); delete g[k]; commit({ groups: g }, { shapes: true }); } }) : h('span.gk-tiny.gk-faint', { text: k === 'C' || k === 'V' ? 'all' : 'auto' })]));
      }
      const gAdd = h('input.lx-pat-add.wide', { placeholder: 'K = s l n r', title: 'Your own group: a capital letter, “=”, then its sounds. Enter adds.', spellcheck: false });
      gAdd.addEventListener('keydown', e => {
        if (e.key !== 'Enter') return;
        const m = /^\s*([A-Z])\s*=\s*(.+)$/.exec(gAdd.value);
        if (!m || m[1] === 'C' || m[1] === 'V') { ui.toast('Write a capital letter (not C or V), “=”, then sounds — e.g. K = s l n r', 'ℹ', 4200); return; }
        commit({ groups: Object.assign({}, P.groups, { [m[1]]: m[2].split(/[\s,]+/).filter(Boolean) }) }, { shapes: true });
      });
      groups.appendChild(gAdd);
      shapeBox.append(
        ui.field({ label: 'Syllable shapes', hint: 'C = consonant, V = vowel, other capitals are groups; (x) optional; *3 = three times as common.', control: pats }),
        h('div.lx-shape-row', [
          ui.field({ label: 'Syllables per word', control: h('div.gk-row.nowrap', [num(P.syllables[0], v => commit({ syllables: [v, Math.max(v, P.syllables[1])] }, { shapes: true }), 1, 8, 'Fewest'), h('span.gk-muted', { text: 'to' }), num(P.syllables[1], v => commit({ syllables: [Math.min(P.syllables[0], v), v] }, { shapes: true }), 1, 8, 'Most')]) }),
          ui.field({ label: 'Stress', control: ui.select({ value: P.stress, options: [['none', 'Not marked'], ['first', 'First syllable'], ['penult', 'Second to last'], ['last', 'Last syllable']], onChange: v => commit({ stress: v }) }) }),
          ui.field({ label: 'Consonants in a row', control: num(P.maxCluster, v => commit({ maxCluster: v }), 1, 6, 'The longest run of consonants allowed') }),
          ui.field({ label: 'Vowels in a row', control: num(P.maxVowels, v => commit({ maxVowels: v }), 1, 4, 'The longest run of vowels allowed') }),
          ui.field({ label: 'Doubled sounds', control: h('div.gk-row.nowrap', [ui.toggle({ value: P.geminates, title: 'Allow the same sound twice in a row (tt, aa)', onChange: v => commit({ geminates: v }) }), h('span.gk-small.gk-muted', { text: P.geminates ? 'allowed' : 'never' })]) }),
        ]),
        ui.field({ label: 'Groups', hint: 'Use them in shapes: CLV takes a consonant, then one of L. Automatic groups come from the chart.', control: groups }),
      );
    }

    /* ---------- spelling ---------- */
    const spellBox = h('div.lx-spell');
    function paintSpelling() {
      GK.clear(spellBox);
      const rules = nm.spelling(P);
      const own = new Map(P.romanization);
      const grid = h('div.lx-spell-grid');
      const sounds = inv().filter(s => own.has(s) || (nm.ROMAN[s] != null && nm.ROMAN[s] !== s));
      const extra = P.romanization.filter(([a]) => !inv().includes(a));
      const row = (a, b, removable) => {
        const i = h('input.lx-spell-in', { value: b, placeholder: '∅', spellcheck: false, title: 'How “' + a + '” is written' });
        i.addEventListener('input', () => { const r = P.romanization.filter(x => x[0] !== a); r.push([a, i.value]); P = nm.normPhon(Object.assign({}, P, { romanization: r })); L.savePhon(P); paintSamples(); });
        i.addEventListener('change', () => paintInventory());
        return h('div.lx-spell-row', [h('span.lx-spell-a', { text: a }), h('span.gk-faint', { text: '→' }), i,
          removable ? h('button.lx-x', { type: 'button', text: '✕', title: 'Remove this rule', onclick: () => commit({ romanization: P.romanization.filter(x => x[0] !== a) }) }) : own.has(a) ? h('button.lx-x', { type: 'button', text: '↺', title: 'Back to the usual spelling', onclick: () => commit({ romanization: P.romanization.filter(x => x[0] !== a) }) }) : h('span')]);
      };
      for (const s of sounds) grid.appendChild(row(s, (rules.find(x => x[0] === s) || [s, s])[1], false));
      for (const [a, b] of extra) grid.appendChild(row(a, b, true));
      if (!sounds.length && !extra.length) grid.appendChild(h('span.gk-small.gk-muted', { text: 'Every sound is written as itself.' }));
      const add = h('input.lx-pat-add.wide', { placeholder: 'ks = x', title: 'A spelling rule for a sequence: sounds = letters. Enter adds.', spellcheck: false });
      add.addEventListener('keydown', e => { if (e.key !== 'Enter') return; const m = /^\s*(\S+)\s*(?:=|→|>)\s*(\S*)\s*$/.exec(add.value); if (!m) { ui.toast('Write it as sounds = letters, e.g. ks = x', 'ℹ'); return; } commit({ romanization: P.romanization.filter(x => x[0] !== m[1]).concat([[m[1], m[2]]]) }); });
      spellBox.append(grid, add);
    }

    /* ---------- banned ---------- */
    const banBox = h('div.lx-chipset');
    function paintBanned() {
      GK.clear(banBox);
      P.banned.forEach((b, i) => banBox.appendChild(h('span.lx-pat.ban', { title: b.startsWith('^') ? 'Never at the start of a word' : b.endsWith('$') ? 'Never at the end of a word' : 'Never anywhere in a word' }, [h('code', { text: b }), h('button.lx-x', { type: 'button', text: '✕', title: 'Allow it again', onclick: () => { commit({ banned: P.banned.filter((x, j) => j !== i) }); paintBanned(); } })])));
      const add = h('input.lx-pat-add', { placeholder: 'tl', title: 'A sequence that never appears. ^x = not at the start, x$ = not at the end. Enter adds.', spellcheck: false });
      add.addEventListener('keydown', e => { if (e.key === 'Enter' && add.value.trim()) { commit({ banned: P.banned.concat(add.value.trim().split(/[\s,]+/)) }); paintBanned(); setTimeout(() => { const n = banBox.querySelector('input'); n && n.focus(); }, 0); } });
      banBox.appendChild(add);
    }

    /* ---------- live samples ---------- */
    const sampleBox = h('div.lx-samples');
    let seed = L.S().sampleSeed || 1;
    function paintSamples() {
      GK.clear(sampleBox);
      const avoid = L.words.map(w => w.word);
      const ws = nm.words(P, { count: 24, seed, avoid });
      if (!ws.length) { sampleBox.appendChild(h('div.gk-small.gk-muted', { text: P.vowels.length ? 'No word fits these rules — loosen a ban or add a syllable shape.' : 'Add at least one vowel.' })); return; }
      for (const w of ws) {
        const b = h('button.lx-sample-word', { type: 'button', title: '/' + w.ipa + '/ — click to add to the dictionary' }, [h('span', { text: w.word })]);
        b.addEventListener('click', () => quickAdd(L, w, b));
        sampleBox.appendChild(b);
      }
    }
    const summary = h('div.gk-small.gk-muted.lx-phon-sum');
    function paintSummary() {
      const st = L.stats;
      GK.clear(summary);
      summary.append(P.consonants.length + ' consonants · ' + P.vowels.length + ' vowels · ' + P.patterns.length + ' shapes');
      if (st && st.sounds) {
        const unknown = st.sounds.filter(x => !has(x.s) && !/^[ˈˌ.'’\-]$/.test(x.s)).slice(0, 10);
        if (unknown.length && L.words.length) summary.append(h('div.lx-warn.soft', ['The dictionary also uses ', h('b', { text: unknown.map(x => x.s).join(' ') }), ' ', ui.button({ label: 'Add them', small: true, kind: 'ghost', onClick: () => { const c = P.consonants.slice(), v = P.vowels.slice(); for (const x of unknown) (nm.isVowel(x.s) ? v : c).push(x.s); commit({ consonants: c, vowels: v }, { charts: true }); } })]));
      }
    }

    /* ---------- presets and fitting ---------- */
    function presetMenu(at) {
      WB.ui.menu([{ header: 'Replace the sounds with…' }].concat(Object.entries(nm.PRESETS).map(([k, p]) => ({ label: p.label, hint: p.desc, onClick: async () => {
        if (had && L.words.length && !(await ui.confirm('Replace the sounds?', 'The consonants, vowels, shapes, bans and spelling of ' + L.lang.title + ' are replaced by “' + p.label + '”. Words already in the dictionary stay as they are.', 'Replace'))) return;
        const before = Object.assign({}, P);
        const np = Object.assign({}, p); delete np.label; delete np.desc;
        P = nm.normPhon(np); L.savePhon(P, 0); paintAll();
        WB.ui.undoToast('Sounds replaced with “' + p.label + '”', () => { P = nm.normPhon(before); L.savePhon(P, 0); paintAll(); });
      } }))), at);
    }
    async function fit() {
      if (!L.words.length) { ui.toast('Add some words first: their sounds set the weights', 'ℹ'); return; }
      const st = L.stats || await WB.api('lexicon.stats', L.lang.id);
      L.stats = st;
      const counts = new Map(st.sounds.map(x => [x.s, x.n]));
      const all = inv().map(s => counts.get(s) || 0), max = Math.max(1, ...all);
      const w = {};
      for (const s of inv()) w[s] = Math.max(.5, Math.round((counts.get(s) || 0) / max * 20) / 2);
      const before = P.weights;
      commit({ weights: w });
      WB.ui.undoToast('Weights now follow how often each sound appears in the dictionary', () => commit({ weights: before }));
    }

    /* ---------- layout ---------- */
    const panels = h('div.lx-phon-main', [
      had ? null : h('div.lx-banner', [h('span', { text: 'ɑ' }), h('div.gk-grow', [h('b', { text: 'This language has no sounds yet.' }), h('div.gk-small.gk-muted', { text: 'Below is a plain starting set. Pick a preset, or click sounds in the charts — sample words update as you go.' })]),
        ui.button({ label: 'Start from a preset', icon: '▾', small: true, kind: 'primary', onClick: e => presetMenu(e.currentTarget) })]),
      ui.panel({ title: 'Consonants', icon: 'ʃ', cls: 'lx-chart-panel', sub: 'Click a sound to add or remove it; right-click one in use for its weight and spelling.', actions: [
        ui.button({ label: 'Preset', icon: '▾', small: true, title: 'Replace every sound with a ready-made set', onClick: e => presetMenu(e.currentTarget) }),
        ui.button({ label: 'Fit weights', small: true, kind: 'ghost', title: 'Make sounds as common as they are in the dictionary', onClick: () => fit() }),
      ], body: [cBox] }),
      h('div.lx-phon-row', [
        ui.panel({ title: 'Vowels', icon: 'ɑ', cls: 'lx-chart-panel', body: [vBox, ui.field({ label: 'Other sounds', hint: 'Long vowels, diphthongs, anything the charts lack. Enter adds.', control: addSounds })] }),
        ui.panel({ title: 'Inventory & weights', icon: '≡', body: [invBox] }),
      ]),
      ui.panel({ title: 'Word shapes', icon: '◠', body: [shapeBox] }),
      h('div.lx-phon-row', [
        ui.panel({ title: 'Spelling', icon: 'Aa', sub: 'Sounds become letters in the dictionary. The pronunciation keeps the sound.', body: [spellBox] }),
        ui.panel({ title: 'Never allowed', icon: '⊘', sub: 'Sequences that never appear in a generated word.', body: [banBox] }),
      ]),
    ]);
    const aside = h('div.lx-phon-aside', [ui.panel({ title: 'Sample words', icon: '⚄', cls: 'lx-samples-panel', actions: [ui.button({ icon: '⚄', small: true, title: 'New samples (R)', onClick: () => reroll() })], body: [
      sampleBox, summary,
      h('div.gk-row', [ui.button({ label: 'Open the generator', icon: '⚄', small: true, kind: 'ghost', onClick: () => L.select(L.lang.id, { tab: 'generator' }) })]),
    ] })]);
    const reroll = () => { seed = X.seed(); L.set({ sampleSeed: seed }); paintSamples(); };
    host.appendChild(h('div.lx-phon', [panels, aside]));
    function paintAll() { paintCharts(); paintInventory(); paintShapes(); paintSpelling(); paintBanned(); paintSamples(); paintSummary(); }
    paintAll();
    WB.api('lexicon.stats', L.lang.id).then(st => { L.stats = st; if (host.isConnected) paintSummary(); }).catch(() => {});
    const onKey = e => { if (!host.isConnected || e.target.closest('input, textarea, select, [contenteditable="true"]') || document.querySelector('.gk-scrim')) return; if (e.key === 'r' && !e.ctrlKey && !e.altKey) { e.preventDefault(); reroll(); } };
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }

  /** a word from a sample: ask for its meaning right there */
  function quickAdd(L, w, anchor, done) {
    const gloss = ui.input({ placeholder: 'What does it mean?' });
    const pos = ui.select({ value: L.lastPos || 'n', options: X.POS.map(([c, n]) => [c, c + ' · ' + n]) });
    const word = ui.input({ value: w.word });
    const go = async () => {
      try {
        const r = await L.addWord({ word: word.value.trim() || w.word, ipa: w.ipa, pos: pos.value, gloss: gloss.value.trim() });
        L.lastPos = pos.value; pop.close();
        anchor.classList.add('added'); anchor.disabled = true; anchor.title = 'Added as “' + (r.gloss || r.word) + '”';
        done && done(r);
      } catch (e) { WB.fail(e); }
    };
    for (const el of [gloss, word]) el.addEventListener('keydown', e => { if (e.key === 'Enter') { e.preventDefault(); go(); } });
    const pop = WB.ui.popover(anchor, h('div.lx-quick', [
      h('div.gk-row.nowrap', [h('div.gk-grow', [word]), h('span.lx-ipa.gk-small', { text: '/' + w.ipa + '/' })]),
      gloss, h('div.gk-row.nowrap', [pos, h('span.gk-grow'), ui.button({ label: 'Add', kind: 'primary', small: true, onClick: go })]),
    ]), { group: 'lx-quick', width: '20em', cls: 'lx-pop' });
    setTimeout(() => gloss.focus(), 30);
    return pop;
  }
  X.quickAdd = quickAdd;

  /* ================= Generator ================= */
  function generator(host, L) {
    const nm = N(), P = L.phon(), S = L.S;
    const st = () => Object.assign({ count: 24, kind: 'word', syl: null, starts: '' }, S().gen || {});
    const setSt = p => L.set({ gen: Object.assign({}, st(), p) });
    const lockedAll = () => Object.assign({}, S().locked || {});
    const locked = () => (lockedAll()[L.lang.id] || []);
    const setLocked = list => L.set({ locked: Object.assign(lockedAll(), { [L.lang.id]: list }) });
    let seed = X.seed(), added = new Set();
    if (!X.hasPhon(L.lang)) {
      host.appendChild(ui.panel({ body: [WB.ui.empty({ icon: '⚄', title: 'No sounds to build words from', text: 'Pick the sounds of ' + L.lang.title + ' on the Phonology tab — a preset takes one click.', actions: [ui.button({ label: 'Set up the sounds', icon: 'ɑ', kind: 'primary', onClick: () => L.select(L.lang.id, { tab: 'phonology' }) })] })] }));
      return null;
    }
    const grid = h('div.lx-gen-grid');
    const info = h('span.gk-small.gk-muted');
    function batch() {
      const o = st(), avoid = L.words.map(w => w.word).concat(locked().map(x => x.word));
      if (o.kind === 'compound') return compounds(o.count);
      const syl = o.syl ? [o.syl, o.syl === 4 ? Math.max(4, P.syllables[1]) : o.syl] : o.kind === 'word' ? null : [Math.max(2, P.syllables[0]), Math.max(2, Math.min(4, P.syllables[1] + 1))];
      const want = nm.norm(o.starts || '');
      const out = [];
      for (let round = 0; out.length < o.count && round < (want ? 20 : 3); round++) {
        for (const w of nm.words(P, { count: o.count * (want ? 5 : 1), seed: seed + ':' + round, avoid: avoid.concat(out.map(x => x.word)), syllables: syl })) {
          if (out.length >= o.count) break;
          if (want && !nm.norm(w.word).startsWith(want)) continue;
          if (o.syl !== 1 && [...w.plain].length < 2) continue;
          out.push(Object.assign(w, { word: o.kind === 'word' ? w.word : nm.cap(w.word) }));
        }
      }
      return out;
    }
    function compounds(count) {
      const R = nm.rng(seed);
      const pool = L.words.filter(w => ['n', 'adj', 'v'].includes(w.pos) && w.word.length <= 7 && !/\s/.test(w.word) && w.gloss);
      if (pool.length < 2) return [];
      const heads = pool.filter(w => w.pos === 'n'), out = [], seen = new Set();
      for (let i = 0; out.length < count && i < count * 20; i++) {
        const a = nm.pick(R, pool), b = nm.pick(R, heads.length ? heads : pool);
        if (a.id === b.id) continue;
        const word = nm.compound(a.word, b.word), k = nm.norm(word);
        if (seen.has(k) || L.words.some(w => nm.norm(w.word) === k)) continue;
        seen.add(k);
        const g = w => (w.gloss || '').split(/[,;]/)[0].replace(/^(to|the|a|an) /i, '').trim();
        out.push({ word, ipa: (a.ipa || a.word).replace(/^ˈ/, 'ˈ') + '.' + (b.ipa || b.word).replace(/^ˈ/, ''), meaning: g(a) + '-' + g(b), from: [a, b] });
      }
      return out;
    }
    let current = [];
    function paint(regen) {
      if (regen) current = batch();
      GK.clear(grid);
      const lk = locked(), lkSet = new Set(lk.map(x => x.word));
      const list = lk.map(x => Object.assign({ locked: true }, x)).concat(current.filter(x => !lkSet.has(x.word)));
      if (!list.length) { grid.appendChild(h('div.gk-muted.gk-small.lx-none', { text: st().kind === 'compound' ? 'Compounds need at least two nouns or adjectives with meanings in the dictionary.' : 'No word fits — loosen the filter or the phonology.' })); return; }
      list.forEach(w => grid.appendChild(card(w)));
      info.textContent = lk.length ? lk.length + ' kept — they stay when you roll again' : 'Keep the ones you like (L), then roll again (Space)';
    }
    function card(w) {
      const isAdded = added.has(nm.norm(w.word));
      const hit = X.titleHit(w.word);
      const c = h('div.lx-gen-card', { class: (w.locked ? 'locked ' : '') + (isAdded ? 'added' : ''), tabindex: 0 }, [
        h('div.lx-gen-word', { text: w.word }),
        h('div.lx-gen-ipa', { text: w.meaning ? '“' + w.meaning + '”' : '/' + w.ipa + '/' }),
        hit ? h('div.lx-gen-hit', { text: 'Already the name of “' + hit.title + '”' }) : null,
        h('div.lx-gen-acts', [
          h('button.lx-gen-btn', { type: 'button', class: w.locked ? 'on' : '', 'aria-pressed': String(!!w.locked), title: w.locked ? 'Stop keeping it' : 'Keep it when rolling again (L)', text: w.locked ? '◆ Kept' : '◇ Keep', onclick: () => lock(w) }),
          h('button.lx-gen-btn', { type: 'button', title: 'Copy', text: '⎘', onclick: () => X.copy(w.word, '“' + w.word + '”') }),
          isAdded ? h('span.lx-gen-done', { text: '✓ added' }) : h('button.lx-gen-btn.add', { type: 'button', title: 'Add to the dictionary with a meaning (Enter)', text: '＋ Add', onclick: e => add(w, e.currentTarget) }),
        ]),
      ]);
      c.addEventListener('keydown', e => {
        if (e.target !== c) return;
        if (e.key.toLowerCase() === 'l') { e.preventDefault(); lock(w); }
        else if (e.key === 'Enter') { e.preventDefault(); const b = c.querySelector('.lx-gen-btn.add'); if (b) add(w, b); }
        else if (e.key === 'ArrowRight' || e.key === 'ArrowLeft') { e.preventDefault(); const sib = e.key === 'ArrowRight' ? c.nextElementSibling : c.previousElementSibling; sib && sib.focus(); }
      });
      return c;
    }
    function lock(w) {
      const lk = locked();
      if (lk.find(x => x.word === w.word)) setLocked(lk.filter(x => x.word !== w.word));
      else setLocked(lk.concat([{ word: w.word, ipa: w.ipa, meaning: w.meaning || '' }]));
      paint(false);
      const again = [...grid.querySelectorAll('.lx-gen-card')].find(x => x.querySelector('.lx-gen-word').textContent === w.word);
      again && again.focus();
    }
    function add(w, anchor) {
      const pre = Object.assign({}, w, { word: w.word });
      const pop = quickAdd(L, pre, anchor, r => {
        added.add(nm.norm(w.word));
        if (w.locked) setLocked(locked().filter(x => x.word !== w.word));
        paint(false);
      });
      if (w.meaning) { const g = pop.el.querySelector('input:not([value])') || pop.el.querySelectorAll('input')[1]; if (g) g.value = w.meaning; }
    }
    const o = st();
    const kinds = ui.segmented({ value: o.kind, options: [['word', 'Words'], ['person', 'Given names'], ['family', 'Family names'], ['place', 'Place names'], ['compound', 'Compounds', 'Two dictionary words joined, with their meaning']], onChange: v => { setSt({ kind: v }); paint(true); } });
    const counts = ui.segmented({ value: String(o.count), options: [['12', '12'], ['24', '24'], ['48', '48']], onChange: v => { setSt({ count: +v }); paint(true); } });
    const syls = ui.select({ value: String(o.syl || ''), options: [['', 'Any length'], ['1', '1 syllable'], ['2', '2 syllables'], ['3', '3 syllables'], ['4', '4 or more']], onChange: v => { setSt({ syl: v ? +v : null }); paint(true); } });
    const starts = ui.input({ value: o.starts || '', placeholder: 'Starts with…' });
    starts.classList.add('lx-starts');
    starts.addEventListener('input', WB.debounce(() => { setSt({ starts: starts.value }); paint(true); }, 250));
    const roll = ui.button({ label: 'Roll', icon: '⚄', kind: 'primary', title: 'New batch (Space)', onClick: () => { seed = X.seed(); paint(true); } });
    const addLocked = ui.button({ label: 'Add kept words', icon: '＋', small: true, kind: 'ghost', title: 'Adds every kept word without a meaning; fill the meanings in later', onClick: async () => {
      const lk = locked();
      if (!lk.length) { ui.toast('Keep some words first (◇ or L)', 'ℹ'); return; }
      const rows = await WB.api('lexicon.addMany', L.lang.id, lk.map(x => ({ word: x.word, ipa: x.ipa, gloss: x.meaning || '', pos: st().kind === 'word' || st().kind === 'compound' ? '' : 'name' })));
      rows.forEach(L.upsert); rows.forEach(r => added.add(nm.norm(r.word)));
      setLocked([]); paint(false);
      WB.ui.undoToast(WB.fmt.plural(rows.length, 'word') + ' added — give them meanings on the Lexicon tab', async () => { await WB.api('lexicon.remove', rows.map(r => r.id)); L.drop(rows.map(r => r.id)); });
    } });
    host.appendChild(ui.panel({ cls: 'lx-gen', body: [
      h('div.lx-toolbar', [kinds, h('span.gk-grow'), roll]),
      h('div.lx-toolbar.lx-gen-info', [counts, syls, starts, info, h('span.gk-grow'), addLocked]),
      grid,
    ] }));
    paint(true);
    const onKey = e => {
      if (!host.isConnected || document.querySelector('.gk-scrim, .wb-pop')) return;
      if (e.target.closest && e.target.closest('input, textarea, select, [contenteditable="true"]')) return;
      if (e.key === ' ' && !e.target.closest('button')) { e.preventDefault(); seed = X.seed(); paint(true); }
    };
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }

  X.tabs.phonology = phonology;
  X.tabs.generator = generator;
})();
