/* Sound changes tab: ordered rules (k > g / V_V) in branches; a live before → after preview over the whole dictionary,
   a step-by-step trace for any word, and one click to create or update the daughter language. */
(function () {
  'use strict';
  const { h, ui } = GK;
  const X = WB.lexicon._;
  const N = () => WB.names;

  const EXAMPLES = [
    ['Lenition', 'k', 'g', 'V_V', 'k softens between vowels'],
    ['Voicing', 's', 'z', 'V_V', 's voices between vowels'],
    ['Palatalisation', 'k', 'tʃ', '_i', 'k before i becomes ch'],
    ['Final vowel raising', 'e', 'i', '_#', 'a final e rises'],
    ['Loss of h', 'h', '∅', '', 'h disappears'],
    ['Loss of final vowels', 'V', '∅', 'C_#', 'final vowels after a consonant vanish'],
    ['Prothetic vowel', '∅', 'e', '#_sC', 'an e grows before s + consonant at the start'],
    ['Metathesis', 'sk', 'ks', '', 'sk swaps to ks'],
    ['Vowel lowering', 'i', 'e', '_r', 'i opens before r'],
  ];
  const rid = () => 'r' + Math.random().toString(36).slice(2, 8);

  function changes(host, L) {
    const nm = N(), P = L.phon();
    let sc = JSON.parse(JSON.stringify(L.lang.data.soundChanges || { branches: [] }));
    if (!sc.branches || !sc.branches.length) sc.branches = [];
    let branch = sc.branches.find(b => b.id === sc.active) || sc.branches[0] || null;
    let onlyChanged = true, q = '', tryWord = '';
    const mode = () => (L.S().changes || {}).mode || 'rows';
    const save = () => L.saveData('soundChanges', JSON.parse(JSON.stringify(sc)), 400);
    const autoCats = () => ({ V: P.vowels.join(' '), C: P.consonants.join(' ') });
    const cats = () => { const c = Object.assign({}, (branch && branch.categories) || {}); const a = autoCats(); for (const k of ['V', 'C']) if (!c[k] || !String(c[k]).trim()) c[k] = a[k]; return c; };
    let compiled = null;
    const compile = () => { compiled = branch ? nm.compileChanges({ categories: cats(), rules: branch.rules }, { inventory: P.consonants.concat(P.vowels) }) : null; return compiled; };
    const spell = nm.spelling(P);
    const srcOf = w => (w.ipa || nm.deromanize(w.word, spell)).replace(/[ˈˌ.]/g, '');
    const run = w => {
      const r = nm.applyChanges(srcOf(w), compiled, { trace: true });
      let out = nm.romanize(r.out, spell);
      if (/^\p{Lu}/u.test(w.word)) out = nm.cap(out);
      return { w, src: srcOf(w), outIpa: r.out, out, steps: r.steps, changed: r.out !== srcOf(w) };
    };

    if (!branch) {
      host.appendChild(ui.panel({ cls: 'lx-changes-empty', body: [WB.ui.empty({ icon: '⇝', title: 'Evolve ' + L.lang.title + ' into a daughter language',
        text: 'Write ordered sound changes — “k > g / V_V” turns k into g between vowels — and watch every word of the dictionary shift. When you like the result, one click creates the daughter language with every word and its etymology.',
        actions: [ui.button({ label: 'Start a branch', icon: '＋', kind: 'primary', onClick: () => newBranch(true) }), ui.button({ label: 'Start with examples', icon: '✦', onClick: () => newBranch(true, true) })] })] }));
      return null;
    }
    function newBranch(first, examples) {
      const b = { id: rid(), name: first ? 'Later ' + L.lang.title : 'New branch', categories: {}, rules: examples ? [EXAMPLES[0], EXAMPLES[3], EXAMPLES[4]].map(e => ({ id: rid(), from: e[1], to: e[2], env: e[3], note: e[4] })) : [{ id: rid(), from: '', to: '', env: '', note: '' }], daughterId: null };
      sc.branches.push(b); sc.active = b.id; branch = b;
      L.lang.data.soundChanges = sc; save();
      L.refreshTab();
    }

    /* ---------- branch bar ---------- */
    const daughter = () => branch.daughterId && L.langs.find(l => l.id === branch.daughterId);
    const bar = h('div.lx-toolbar.lx-branchbar');
    function paintBar() {
      GK.clear(bar);
      const sel = ui.select({ value: branch.id, options: sc.branches.map(b => [b.id, b.name]), onChange: v => { sc.active = v; branch = sc.branches.find(b => b.id === v); save(); L.refreshTab(); } });
      const d = daughter();
      bar.append(h('span.gk-small.gk-muted', { text: 'Branch' }), sel,
        ui.button({ icon: '✎', small: true, kind: 'ghost', title: 'Rename this branch', onClick: async () => { const n = await ui.prompt('Rename the branch', branch.name); if (n) { branch.name = n; save(); paintBar(); } } }),
        ui.button({ icon: '＋', small: true, kind: 'ghost', title: 'Another branch (another daughter language)', onClick: () => newBranch(false) }),
        sc.branches.length > 1 || branch.rules.length ? ui.button({ icon: '🗑', small: true, kind: 'ghost', title: 'Delete this branch (its daughter language stays)', onClick: () => {
          const gone = branch, i = sc.branches.indexOf(gone);
          sc.branches.splice(i, 1); sc.active = sc.branches[0] ? sc.branches[0].id : null; save(); L.refreshTab();
          WB.ui.undoToast('Branch “' + gone.name + '” deleted', () => { sc.branches.splice(i, 0, gone); sc.active = gone.id; L.lang.data.soundChanges = sc; save(); L.refreshTab(); });
        } }) : null,
        h('span.gk-grow'),
        h('span.gk-small.gk-muted', { text: L.lang.title + ' →' }),
        d ? WB.ui.chip(d, { size: 'sm', onClick: () => L.select(d.id) }) : h('span.gk-small.lx-faintpill', { text: 'no daughter yet' }));
    }

    /* ---------- rules ---------- */
    const rulesBox = h('div.lx-rules');
    const catBox = h('div.lx-cats');
    const recompute = WB.debounce(() => { compile(); paintRuleState(); paintPreview(); paintTrace(); }, 140);
    function paintCats() {
      GK.clear(catBox);
      const c = Object.assign({}, branch.categories || {});
      const auto = autoCats();
      const keys = [...new Set(['V', 'C'].concat(Object.keys(c)))];
      for (const k of keys) {
        const isAuto = (k === 'V' || k === 'C') && !(c[k] && String(c[k]).trim());
        const inp = h('input.lx-cat-in', { value: isAuto ? '' : (Array.isArray(c[k]) ? c[k].join(' ') : c[k] || ''), placeholder: isAuto ? auto[k] : '', spellcheck: false, title: k === 'V' ? 'Vowels (empty = every vowel of the language)' : k === 'C' ? 'Consonants (empty = every consonant of the language)' : 'Sounds in category ' + k });
        inp.addEventListener('input', () => { branch.categories = Object.assign({}, branch.categories || {}, { [k]: inp.value }); save(); recompute(); });
        catBox.appendChild(h('div.lx-cat', [h('code.lx-group-k', { text: k }), h('span.gk-faint', { text: '=' }), inp,
          k === 'V' || k === 'C' ? h('span.gk-tiny.gk-faint', { text: isAuto ? 'auto' : '' }) : h('button.lx-x', { type: 'button', text: '✕', title: 'Remove category ' + k, onclick: () => { const cc = Object.assign({}, branch.categories); delete cc[k]; branch.categories = cc; save(); paintCats(); recompute(); } })]));
      }
      const add = h('input.lx-pat-add.wide', { placeholder: 'N = m n ŋ', title: 'A category: a capital letter, “=”, then sounds. Enter adds.', spellcheck: false });
      add.addEventListener('keydown', e => { if (e.key !== 'Enter') return; const m = /^\s*([A-Z])\s*=\s*(.*)$/.exec(add.value); if (!m) { ui.toast('Write a capital letter, “=”, then sounds — e.g. N = m n ŋ', 'ℹ'); return; } branch.categories = Object.assign({}, branch.categories || {}, { [m[1]]: m[2] }); save(); paintCats(); recompute(); });
      catBox.appendChild(add);
    }
    function ruleRow(r, i) {
      const field = (k, ph, cls, title) => {
        const inp = h('input.lx-rule-in', { class: cls, value: r[k] || '', placeholder: ph, spellcheck: false, title });
        inp.addEventListener('input', () => { r[k] = inp.value; save(); recompute(); });
        inp.addEventListener('keydown', e => {
          if (e.key === 'Enter') { e.preventDefault(); const n = { id: rid(), from: '', to: '', env: '', note: '' }; branch.rules.splice(i + 1, 0, n); save(); paintRules(); focusRule(i + 1); }
          else if (e.key === 'Backspace' && !inp.value && k === 'from' && !r.to && !r.env && branch.rules.length > 1) { e.preventDefault(); branch.rules.splice(i, 1); save(); paintRules(); focusRule(Math.max(0, i - 1)); recompute(); }
          else if (e.key === 'ArrowUp' && e.altKey) { e.preventDefault(); move(i, -1); }
          else if (e.key === 'ArrowDown' && e.altKey) { e.preventDefault(); move(i, 1); }
        });
        return inp;
      };
      const on = h('input.lx-check', { type: 'checkbox', checked: !r.off, title: r.off ? 'Switched off — click to use it' : 'In use — click to switch off' });
      on.addEventListener('change', () => { r.off = !on.checked; row.classList.toggle('off', !!r.off); save(); recompute(); });
      const row = h('div.lx-rule', { class: r.off ? 'off' : '', dataset: { i: String(i) } }, [
        on, h('span.lx-rule-n', { text: String(i + 1) }),
        field('from', 'k', 'from', 'What changes (a sound, sounds, or a category like V)'), h('span.lx-arrow', { text: '→' }),
        field('to', '∅', 'to', 'What it becomes (∅ = nothing)'), h('span.lx-slash', { text: '/' }),
        field('env', '_  (everywhere)', 'env', 'Where: _ is the sound, # a word edge, e.g. V_V, _#, #_'),
        field('unless', 'unless…', 'unless', 'Exception: same form as the environment'),
        field('note', 'note', 'note', 'Why, or when it happened'),
        h('span.lx-rule-state'),
        h('div.lx-rule-acts', [
          h('button.lx-x', { type: 'button', text: '↑', title: 'Earlier (Alt+↑)', onclick: () => move(i, -1) }),
          h('button.lx-x', { type: 'button', text: '↓', title: 'Later (Alt+↓)', onclick: () => move(i, 1) }),
          h('button.lx-x', { type: 'button', text: '✕', title: 'Delete this rule', onclick: () => { const gone = branch.rules.splice(i, 1)[0]; save(); paintRules(); recompute(); WB.ui.undoToast('Rule deleted', () => { branch.rules.splice(i, 0, gone); save(); paintRules(); recompute(); }, 5000); } }),
        ]),
      ]);
      return row;
    }
    const focusRule = i => setTimeout(() => { const r = rulesBox.querySelector('.lx-rule[data-i="' + i + '"] .lx-rule-in.from'); r && r.focus(); }, 0);
    function move(i, d) {
      const j = i + d;
      if (j < 0 || j >= branch.rules.length) return;
      const [r] = branch.rules.splice(i, 1); branch.rules.splice(j, 0, r);
      save(); paintRules(); recompute(); focusRule(j);
    }
    function paintRules() {
      GK.clear(rulesBox);
      catField.hidden = mode() === 'text';
      if (mode() === 'text') {
        const area = ui.input({ multiline: true, rows: Math.max(8, branch.rules.length + 5), value: nm.changesText({ categories: branch.categories || {}, rules: branch.rules }) });
        area.classList.add('lx-rules-text');
        area.spellcheck = false;
        const errs = h('div.lx-rule-errs');
        area.addEventListener('input', WB.debounce(() => {
          const p = nm.parseChanges(area.value);
          branch.rules = p.rules.map((r, i) => Object.assign({ id: (branch.rules[i] && branch.rules[i].id) || rid() }, r));
          branch.categories = p.categories;
          GK.clear(errs);
          p.errors.forEach(e => errs.appendChild(h('div.lx-warn', { text: 'Line ' + e.line + ': ' + e.message })));
          save(); recompute();
        }, 250));
        rulesBox.append(area, errs, h('div.gk-small.gk-muted', { text: 'One rule per line: from > to / environment // exception ; note.  Categories: V = a e i.  A line starting with # is switched off.' }));
        return;
      }
      branch.rules.forEach((r, i) => rulesBox.appendChild(ruleRow(r, i)));
      rulesBox.appendChild(h('div.gk-row.lx-rule-foot', [
        ui.button({ label: 'Add rule', icon: '＋', small: true, onClick: () => { branch.rules.push({ id: rid(), from: '', to: '', env: '', note: '' }); save(); paintRules(); focusRule(branch.rules.length - 1); } }),
        ui.button({ label: 'Examples', icon: '▾', small: true, kind: 'ghost', title: 'Insert a common kind of change', onClick: e => WB.ui.menu(EXAMPLES.map(x => ({ label: x[0], hint: x[1] + ' > ' + x[2] + (x[3] ? ' / ' + x[3] : '') + ' — ' + x[4], onClick: () => { branch.rules.push({ id: rid(), from: x[1], to: x[2], env: x[3], note: x[4] }); save(); paintRules(); recompute(); } })), e.currentTarget) }),
      ]));
      paintRuleState();
    }
    function paintRuleState() {
      if (mode() === 'text' || !compiled) return;
      const fired = new Map();
      for (const w of L.words) for (const s of run(w).steps) fired.set(s.idx, (fired.get(s.idx) || 0) + 1);
      rulesBox.querySelectorAll('.lx-rule').forEach(row => {
        const i = +row.dataset.i, c = compiled.rules[i], el = row.querySelector('.lx-rule-state');
        const r = branch.rules[i];
        GK.clear(el);
        row.classList.toggle('bad', !!(c && c.error && (r.from || r.to || r.env)));
        if (c && c.error && (r.from || r.to || r.env)) { el.appendChild(h('span.lx-rule-err', { text: '⚠', title: c.error })); return; }
        if (!r.from && !r.to) return;
        const n = fired.get(i) || 0;
        el.appendChild(h('span.lx-rule-count', { class: n ? '' : 'zero', text: String(n), title: n ? 'Changes ' + WB.fmt.plural(n, 'word') : 'Changes no word yet' }));
      });
    }

    /* ---------- trace & preview ---------- */
    const traceBox = h('div.lx-trace');
    const tryIn = ui.input({ placeholder: 'Try any word, e.g. ' + (L.words[0] ? L.words[0].word : 'kata'), onInput: v => { tryWord = v; paintTrace(); } });
    function paintTrace() {
      GK.clear(traceBox);
      const v = tryWord.trim();
      if (!v) { traceBox.appendChild(h('div.gk-small.gk-muted', { text: 'Type a word to watch each rule act on it, step by step.' })); return; }
      const known = L.words.find(w => nm.norm(w.word) === nm.norm(v));
      const r = run(known || { word: v, ipa: '' });
      const step = (label, ipa, note, cls) => h('div.lx-step', { class: cls || '' }, [h('span.lx-step-n', { text: label }), h('b', { text: nm.romanize(ipa, spell) }), h('span.lx-ipa.gk-small', { text: '/' + ipa + '/' }), note ? h('span.gk-small.gk-muted', { text: note }) : null]);
      const first = step('', r.src, known ? (known.gloss ? '“' + known.gloss + '”' : '') : 'not in the dictionary', 'start');
      first.querySelector('b').textContent = known ? known.word : v;
      traceBox.appendChild(first);
      for (const s of r.steps) { const rule = branch.rules[s.idx]; traceBox.appendChild(step(String(s.idx + 1), s.after, (rule.from || '∅') + ' → ' + (rule.to || '∅') + (rule.env ? ' / ' + rule.env : '') + (rule.note ? ' · ' + rule.note : ''))); }
      if (!r.steps.length) traceBox.appendChild(h('div.gk-small.gk-muted', { text: 'No rule touches it.' }));
      else traceBox.appendChild(h('div.lx-step.end', [h('span.lx-step-n', { text: '=' }), h('b', { text: r.out }), h('span.lx-ipa.gk-small', { text: '/' + r.outIpa + '/' })]));
    }
    const prevBox = h('div.lx-prev');
    const prevInfo = h('div.gk-row.lx-prev-info');
    const actionBox = h('div.lx-derive');
    function paintPreview() {
      GK.clear(prevBox); GK.clear(prevInfo);
      if (!L.words.length) { prevBox.appendChild(h('div.gk-small.gk-muted.lx-none', { text: 'The dictionary is empty — add words, and they will evolve here.' })); paintAction(0); return; }
      const all = L.words.map(run), changed = all.filter(x => x.changed);
      const nq = nm.norm(q);
      const list = (onlyChanged ? changed : all).filter(x => !nq || nm.norm(x.w.word).includes(nq) || nm.norm(x.out).includes(nq) || (x.w.gloss || '').toLowerCase().includes(q.toLowerCase()))
        .sort((a, b) => nm.norm(a.w.word).localeCompare(nm.norm(b.w.word)));
      prevInfo.append(h('b', { text: changed.length + ' of ' + all.length }), h('span.gk-small.gk-muted', { text: ' words change' }), h('span.gk-grow'),
        ui.chip({ label: 'Changed only', on: onlyChanged, onClick: () => { onlyChanged = !onlyChanged; paintPreview(); } }));
      const grid = h('div.lx-prev-grid');
      for (const x of list.slice(0, 400)) {
        const r = h('div.lx-prev-row', { class: x.changed ? 'changed' : '', title: x.steps.length ? 'Rules ' + x.steps.map(s => s.idx + 1).join(', ') : 'Unchanged' }, [
          h('span.lx-prev-a', { text: x.w.word }), h('span.lx-arrow', { text: '→' }), h('span.lx-prev-b', { text: x.out }),
          h('span.lx-prev-g.gk-ellipsis', { text: x.w.gloss || '' }),
          h('span.lx-prev-rules', x.steps.map(s => h('span.lx-rule-tag', { text: String(s.idx + 1) }))),
        ]);
        r.addEventListener('click', () => { tryWord = x.w.word; tryIn.value = x.w.word; paintTrace(); traceBox.scrollIntoView({ block: 'nearest' }); });
        grid.appendChild(r);
      }
      if (!list.length) grid.appendChild(h('div.gk-small.gk-muted.lx-none', { text: onlyChanged ? 'No word changes yet — write a rule on the left.' : 'Nothing matches.' }));
      if (list.length > 400) grid.appendChild(h('div.gk-small.gk-muted', { text: '… and ' + (list.length - 400) + ' more' }));
      prevBox.appendChild(grid);
      paintAction(changed.length);
    }
    function paintAction(nChanged) {
      GK.clear(actionBox);
      const d = daughter();
      const errs = compiled ? compiled.rules.filter((c, i) => c.error && (branch.rules[i].from || branch.rules[i].to)).length : 0;
      actionBox.append(
        h('div.gk-grow.gk-small.gk-muted', { text: d ? 'Updating keeps the daughter\'s own extra words and any meaning you changed there.' : 'Creates a new language with every word evolved, its meaning, and a link back to its ancestor.' }),
        errs ? h('span.lx-warn.gk-small', { text: errs + ' rule' + (errs > 1 ? 's' : '') + ' can\'t be read' }) : null,
        ui.button({ label: d ? 'Update “' + d.title + '”' : 'Create daughter language…', icon: '⇝', kind: 'primary', disabled: !L.words.length, onClick: () => derive() }),
      );
    }
    async function derive() {
      const d = daughter();
      let name = d ? d.title : null;
      if (!d) {
        name = await ui.prompt('Name the daughter language', branch.name && !/^New branch$/.test(branch.name) ? branch.name : 'Later ' + L.lang.title, 'e.g. Inland Saltspeak');
        if (!name) return;
        if (branch.name === 'New branch' || /^Later /.test(branch.name)) branch.name = name;
      }
      try {
        const r = await WB.api('lexicon.derive', L.lang.id, { branchId: branch.id, name, rules: branch.rules, categories: cats() });
        branch.daughterId = r.daughter.id;
        L.lang.data.soundChanges = sc; save();
        await L.loadLangs(); L.paintSide();
        paintBar(); paintPreview();
        const msg = r.created ? 'Created “' + r.daughter.title + '” with ' + WB.fmt.plural(r.added, 'word') : '“' + r.daughter.title + '” updated: ' + r.updated + ' changed, ' + r.added + ' new, ' + r.unchanged + ' as before';
        const t = WB.ui.undoToast(msg, r.created ? () => WB.api('entries.trash', r.daughter.id) : null, 6500);
        t.insertBefore(ui.button({ label: 'Open', small: true, onClick: () => { t.remove(); L.select(r.daughter.id, { tab: 'words' }); } }), t.lastChild);
      } catch (e) { WB.fail(e); }
    }

    /* ---------- layout ---------- */
    const catField = ui.field({ label: 'Categories', hint: 'V and C follow the language’s sounds unless you list them here.', control: catBox });
    const modeSeg = ui.segmented({ value: mode(), options: [['rows', 'Rules', 'One row per rule'], ['text', 'Text', 'All rules as text: paste from or copy to anywhere']], onChange: v => { L.set({ changes: { mode: v } }); if (v === 'rows') paintCats(); paintRules(); } });
    const help = h('details.lx-help', [h('summary', { text: 'How rules work' }), h('div.gk-small', [
      h('p', ['Each rule reads ', h('code', { text: 'from → to / where' }), ' and applies to every word in order, top to bottom.']),
      h('ul', [
        h('li', [h('code', { text: '_' }), ' marks the changing sound; ', h('code', { text: '#' }), ' is the start or end of the word: ', h('code', { text: '_#' }), ' = at the end.']),
        h('li', [h('code', { text: 'V' }), ', ', h('code', { text: 'C' }), ' and your own capitals are categories. ', h('code', { text: 'P → B' }), ' maps them sound by sound (p→b, t→d, k→g).']),
        h('li', [h('code', { text: '∅' }), ' (or 0) is nothing: ', h('code', { text: 'h → ∅' }), ' deletes; ', h('code', { text: '∅ → e / #_s' }), ' inserts.']),
        h('li', [h('code', { text: '(x)' }), ' is optional, ', h('code', { text: '{a,e}' }), ' is either, ', h('code', { text: '…' }), ' is anything in between.']),
        h('li', ['“Unless” takes the same form: ', h('code', { text: 'a → e / _i  unless #_' }), '.']),
      ]),
    ])]);
    compile();
    host.appendChild(h('div.lx-changes', [
      ui.panel({ cls: 'lx-branch-panel', body: [bar] }),
      h('div.lx-changes-cols', [
        ui.panel({ title: 'Rules', icon: '⇝', cls: 'lx-rules-panel', actions: [modeSeg], body: [catField, rulesBox, help] }),
        h('div.lx-changes-side', [
          ui.panel({ title: 'Try a word', icon: '⌕', body: [tryIn, traceBox] }),
          ui.panel({ title: 'Every word', icon: '≣', cls: 'lx-prev-panel', body: [prevInfo, WB.ui.search({ placeholder: 'Filter', onInput: v => { q = v; paintPreview(); } }), prevBox, actionBox] }),
        ]),
      ]),
    ]));
    paintBar(); paintCats(); paintRules(); paintPreview(); paintTrace();
    return null;
  }
  X.tabs.changes = changes;
})();
