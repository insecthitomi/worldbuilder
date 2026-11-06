/* Translator tab (word-by-word by meaning, both ways, with unknown words marked and coined on demand; saved phrases)
   and Script tab (writing system: glyphs per letter, direction, font, live transliteration, notes). */
(function () {
  'use strict';
  const { h, ui } = GK;
  const X = WB.lexicon._;
  const N = () => WB.names;

  /* ================= Translator ================= */
  function translate(host, L) {
    const nm = N();
    const st = () => Object.assign({ dir: 'to', text: '' }, L.S().translate || {});
    const setSt = p => L.set({ translate: Object.assign({}, st(), p) });
    let result = null;
    const choice = new Map();   // token index → chosen word id
    const lname = L.lang.title;
    const input = ui.input({ multiline: true, rows: 3, value: st().text, placeholder: st().dir === 'to' ? 'Write in English: the drowned king returns to the sea' : 'Write in ' + lname });
    input.classList.add('lx-tr-in');
    const outBox = h('div.lx-tr-out');
    const lineBox = h('div.lx-tr-line');
    const missBox = h('div.lx-tr-miss');
    const run = WB.debounce(async () => {
      const text = input.value;
      setSt({ text });
      if (!text.trim()) { result = null; paint(); return; }
      result = await WB.api('lexicon.translate', L.lang.id, text, { dir: st().dir }).catch(WB.fail);
      choice.clear();
      paint();
    }, 160);
    input.addEventListener('input', run);
    const pick = (t, i) => { if (!t.matches || !t.matches.length) return null; const id = choice.get(i); return t.matches.find(m => m.id === id) || t.matches[0]; };
    const meaning = w => (w.gloss || '').split(/[,;]/)[0].replace(/\([^)]*\)/g, '').replace(/^(to|the|a|an) /i, '').trim() || w.gloss;
    function outText() {
      if (!result) return '';
      const to = result.dir === 'to';
      let s = result.tokens.map((t, i) => (t.t === 'gap' ? t.src : t.omitted ? '' : pick(t, i) ? (to ? pick(t, i).word : meaning(pick(t, i))) : t.src)).join('');
      s = s.replace(/[ \t]{2,}/g, ' ').replace(/^ +/, '').replace(/ +([,.;:!?])/g, '$1');
      if (to && /^\p{Lu}/u.test(input.value.trim())) s = s.replace(/^\p{Ll}/u, c => c.toUpperCase());
      return s;
    }
    function paint() {
      GK.clear(outBox); GK.clear(lineBox); GK.clear(missBox);
      if (!result || !result.tokens.length) { outBox.appendChild(h('div.gk-muted.lx-tr-ph', { text: st().dir === 'to' ? 'The ' + lname + ' appears here, word by word.' : 'The meaning appears here, word by word.' })); return; }
      const to = result.dir === 'to';
      outBox.append(h('div.lx-tr-text', { text: outText() }), h('div.gk-row.nowrap', [
        ui.button({ icon: '⎘', small: true, kind: 'ghost', title: 'Copy', onClick: () => X.copy(outText(), 'Translation') }),
        ui.button({ label: 'Save phrase', icon: '☆', small: true, kind: 'ghost', title: 'Keep it in the phrase list below', onClick: () => savePhrase() }),
      ]));
      result.tokens.forEach((t, i) => {
        if (t.t === 'gap') { if (/[^\s]/.test(t.src)) lineBox.appendChild(h('span.lx-tr-punct', { text: t.src.trim() })); return; }
        const w = pick(t, i);
        const col = h('div.lx-tr-tok', { class: t.unknown ? 'unknown' : t.omitted ? 'omitted' : '' });
        if (w) {
          col.append(h('div.lx-tr-top', { text: to ? w.word : meaning(w) }), h('div.lx-tr-mid', { text: w.ipa ? '/' + w.ipa + '/' : X.posName(w.pos) }), h('div.lx-tr-bot', { text: t.src }));
          if (t.matches.length > 1) col.appendChild(h('button.lx-tr-alt', { type: 'button', text: '▾ ' + t.matches.length, title: 'Other words for “' + t.src + '”', onclick: e => WB.ui.menu(t.matches.map(m => ({ label: m.word + ' — ' + (m.gloss || ''), checked: m.id === w.id, onClick: () => { choice.set(i, m.id); paint(); } })), e.currentTarget) }));
          col.title = w.word + ' (' + X.posName(w.pos) + '): ' + (w.gloss || '') + '\nClick to open it in the dictionary';
          col.addEventListener('click', e => { if (!e.target.closest('button')) L.openWord(L.lang.id, w.id); });
        } else if (t.omitted) {
          col.append(h('div.lx-tr-top', { text: '·' }), h('div.lx-tr-mid', { text: 'left out' }), h('div.lx-tr-bot', { text: t.src }));
          col.title = lname + ' has no word for “' + t.src + '” here — add one if it should';
        } else {
          col.append(h('div.lx-tr-top', { text: '?' }), h('div.lx-tr-mid', { text: 'unknown' }), h('div.lx-tr-bot', { text: t.src }));
          if (to) col.appendChild(h('button.lx-tr-add', { type: 'button', text: '＋', title: 'Add a word for “' + t.key + '”', onclick: () => addMissing([t.key]) }));
        }
        lineBox.appendChild(col);
      });
      const miss = result.unknown || [];
      if (miss.length) missBox.append(h('span.lx-warn', { text: miss.length + ' unknown: ' + miss.slice(0, 8).join(', ') + (miss.length > 8 ? '…' : '') }), h('span.gk-grow'),
        to ? ui.button({ label: 'Add missing words…', icon: '＋', small: true, kind: 'primary', onClick: () => addMissing(miss) }) : null);
      else missBox.append(h('span.gk-small.lx-ok', { text: '✓ Every word is in the dictionary' }));
    }
    /** coins words for the missing meanings, editable before they are added */
    async function addMissing(list) {
      const P = L.phon(), has = X.hasPhon(L.lang), avoid = L.words.map(w => w.word);
      const rows = list.map(g => {
        const c = has ? nm.words(P, { count: 1, seed: X.seed(), avoid })[0] : null;
        if (c) avoid.push(c.word);
        return { gloss: g, word: c ? c.word : '', ipa: c ? c.ipa : '', pos: guessPos(g), on: true };
      });
      const grid = h('div.lx-miss-grid');
      const paintRows = () => {
        GK.clear(grid);
        grid.append(h('span.gk-tiny.gk-muted', { text: '' }), h('span.gk-tiny.gk-muted', { text: 'Meaning' }), h('span.gk-tiny.gk-muted', { text: 'New word' }), h('span.gk-tiny.gk-muted', { text: 'Part' }), h('span'));
        rows.forEach(r => {
          const on = h('input', { type: 'checkbox', checked: r.on }); on.addEventListener('change', () => { r.on = on.checked; });
          const g = ui.input({ value: r.gloss, onInput: v => { r.gloss = v; } });
          const w = ui.input({ value: r.word, placeholder: has ? '' : 'type a word', onInput: v => { r.word = v; r.ipa = ''; } });
          const p = ui.select({ value: r.pos, options: [['', '—']].concat(X.POS.map(([c, n]) => [c, c + ' · ' + n])), onChange: v => { r.pos = v; } });
          grid.append(on, g, w, p, has ? ui.button({ icon: '⚄', small: true, kind: 'ghost', title: 'Another word', onClick: () => { const c = nm.words(P, { count: 1, seed: X.seed(), avoid })[0]; if (c) { r.word = c.word; r.ipa = c.ipa; w.value = c.word; } } }) : h('span'));
        });
      };
      paintRows();
      const ok = await ui.dialog({ title: 'Add ' + WB.fmt.plural(rows.length, 'missing word'), icon: '＋', body: h('div.lx-miss', [h('p.gk-small.gk-muted', { text: has ? 'Each meaning gets a word coined from ' + lname + '\'s sounds. Change any of them, or roll again with ⚄.' : 'Type a ' + lname + ' word for each meaning.' }), grid]),
        actions: [{ label: 'Cancel', value: false }, { label: 'Add to the dictionary', kind: 'primary', value: true }] });
      if (!ok) return;
      const add = rows.filter(r => r.on && r.word.trim()).map(r => ({ word: r.word.trim(), ipa: r.ipa || (has ? nm.deromanize(r.word, nm.spelling(P)) : ''), gloss: r.gloss.trim(), pos: r.pos }));
      if (!add.length) return;
      const got = await WB.api('lexicon.addMany', L.lang.id, add).catch(WB.fail);
      if (!got) return;
      got.forEach(L.upsert);
      WB.ui.undoToast(WB.fmt.plural(got.length, 'word') + ' added to ' + lname, async () => { await WB.api('lexicon.remove', got.map(g => g.id)); L.drop(got.map(g => g.id)); run(); });
      run();
    }
    const guessPos = g => (/^to /.test(g) || /(ing|ed)$/.test(g) ? 'v' : /ly$/.test(g) ? 'adv' : ['i', 'me', 'you', 'he', 'she', 'it', 'we', 'they', 'us', 'them'].includes(g) ? 'pron' : ['and', 'or', 'but'].includes(g) ? 'conj' : ['to', 'in', 'on', 'at', 'from', 'with', 'under', 'over', 'of'].includes(g) ? 'prep' : 'n');

    /* ---------- saved phrases ---------- */
    const phraseBox = h('div.lx-phrases');
    const phrases = () => (L.lang.data.phrases || []).slice();
    function savePhrase() {
      const text = input.value.trim(), out = outText();
      if (!text) return;
      const list = phrases().filter(p => p.text !== text);
      list.unshift({ id: 'p' + Date.now().toString(36), text, out, dir: st().dir });
      L.saveData('phrases', list, 0);
      paintPhrases();
      ui.toast('Phrase saved', '☆');
    }
    function paintPhrases() {
      GK.clear(phraseBox);
      const list = phrases();
      if (!list.length) { phraseBox.appendChild(h('div.gk-small.gk-muted', { text: 'Translations you keep land here: greetings, oaths, curses, inscriptions.' })); return; }
      list.forEach(p => {
        const row = h('div.lx-phrase', { tabindex: 0, title: 'Load it into the translator' }, [
          h('div.gk-grow', [h('div.lx-phrase-out', { text: p.out }), h('div.gk-small.gk-muted', { text: p.text })]),
          h('button.lx-x', { type: 'button', text: '⎘', title: 'Copy', onclick: e => { e.stopPropagation(); X.copy(p.out, 'Phrase'); } }),
          h('button.lx-x', { type: 'button', text: '✕', title: 'Remove', onclick: e => { e.stopPropagation(); const before = phrases(); L.saveData('phrases', before.filter(x => x.id !== p.id), 0); paintPhrases(); WB.ui.undoToast('Phrase removed', () => { L.saveData('phrases', before, 0); paintPhrases(); }, 5000); } }),
        ]);
        const load = () => { const dir = p.dir || 'to'; if (dir !== st().dir) { setSt({ dir }); dirSeg.querySelectorAll('button').forEach((b, i) => b.classList.toggle('on', (i === 0) === (dir === 'to'))); } input.value = p.text; run(); input.focus(); };
        row.addEventListener('click', load);
        row.addEventListener('keydown', e => { if (e.key === 'Enter') load(); });
        phraseBox.appendChild(row);
      });
    }

    const dirSeg = ui.segmented({ value: st().dir, options: [['to', 'English → ' + lname], ['from', lname + ' → English']], onChange: v => { setSt({ dir: v }); input.placeholder = v === 'to' ? 'Write in English' : 'Write in ' + lname; run(); } });
    const swap = ui.button({ icon: '⇄', small: true, kind: 'ghost', title: 'Swap: translate the result back', onClick: () => {
      const out = outText(), dir = st().dir === 'to' ? 'from' : 'to';
      setSt({ dir }); dirSeg.querySelectorAll('button').forEach((b, i) => b.classList.toggle('on', (i === 0) === (dir === 'to')));
      input.value = out; run();
    } });
    host.appendChild(h('div.lx-translate', [
      ui.panel({ cls: 'lx-tr-panel', body: [
        h('div.lx-toolbar', [dirSeg, swap, h('span.gk-grow'), h('span.gk-small.gk-muted', { text: 'Word by word, by meaning — grammar is up to you.' })]),
        h('div.lx-tr-cols', [h('div.lx-tr-left', [input]), h('div.lx-tr-right', [outBox])]),
        h('div.lx-tr-line-wrap', [lineBox]),
        missBox,
      ] }),
      ui.panel({ title: 'Phrases', icon: '☆', body: [phraseBox] }),
    ]));
    paint(); paintPhrases();
    if (input.value.trim()) run();
    setTimeout(() => input.focus(), 30);
    translate.setTextIn = t => { input.value = t; run(); };
    return () => { translate.setTextIn = null; };
  }
  translate.setText = (L, t) => translate.setTextIn && translate.setTextIn(t);

  /* ================= Script ================= */
  function script(host, L) {
    const nm = N();
    const sc = () => Object.assign({ name: '', direction: 'ltr', font: '', notes: '', glyphs: [] }, L.lang.data.script || {});
    const save = (patch, ms) => L.saveData('script', Object.assign(sc(), patch), ms);
    const name = ui.input({ value: sc().name, placeholder: 'e.g. Tide-runes', onInput: v => save({ name: v }) });
    const font = ui.input({ value: sc().font, placeholder: 'Any installed font, e.g. Segoe UI Historic', onInput: v => { save({ font: v }); paintPreview(); } });
    const dir = ui.segmented({ value: sc().direction, options: [['ltr', 'Left to right'], ['rtl', 'Right to left'], ['ttb', 'Top to bottom'], ['boustro', 'Back and forth', 'Boustrophedon: every other line runs the other way']], onChange: v => { save({ direction: v }); paintPreview(); } });
    const table = h('div.lx-glyphs');
    function paintGlyphs() {
      GK.clear(table);
      const gs = sc().glyphs;
      table.appendChild(h('div.lx-glyph.head', [h('span', { text: 'Letters' }), h('span', { text: 'Sign' }), h('span', { text: 'Name' }), h('span')]));
      gs.forEach((g, i) => {
        const upd = p => { const list = sc().glyphs.slice(); list[i] = Object.assign({}, list[i], p); save({ glyphs: list }); paintPreview(); };
        table.appendChild(h('div.lx-glyph', [
          ui.input({ value: g.sound, placeholder: 'sh', onInput: v => upd({ sound: v }) }),
          (() => { const x = ui.input({ value: g.glyph, onInput: v => upd({ glyph: v }) }); x.classList.add('lx-glyph-in'); x.style.fontFamily = sc().font ? '"' + sc().font + '", var(--font-ui)' : ''; return x; })(),
          ui.input({ value: g.name || '', placeholder: 'its name', onInput: v => upd({ name: v }) }),
          h('button.lx-x', { type: 'button', text: '✕', title: 'Remove', onclick: () => { const list = sc().glyphs.filter((x, j) => j !== i); save({ glyphs: list }, 0); paintGlyphs(); paintPreview(); } }),
        ]));
      });
      table.appendChild(h('div.gk-row', [
        ui.button({ label: 'Add a sign', icon: '＋', small: true, onClick: () => { save({ glyphs: sc().glyphs.concat([{ sound: '', glyph: '', name: '' }]) }, 0); paintGlyphs(); const ins = table.querySelectorAll('.lx-glyph:not(.head)'); const last = ins[ins.length - 1]; last && last.querySelector('input').focus(); } }),
        X.hasPhon(L.lang) ? ui.button({ label: 'A row for every letter', small: true, kind: 'ghost', title: 'Adds the letters the language spells with (from the phonology) that have no sign yet', onClick: () => {
          const P = L.phon(), have = new Set(sc().glyphs.map(g => g.sound));
          const letters = P.vowels.concat(P.consonants).map(s => nm.romanize(s, nm.spelling(P))).filter(x => x && !have.has(x));
          save({ glyphs: sc().glyphs.concat([...new Set(letters)].map(s => ({ sound: s, glyph: '', name: '' }))) }, 0); paintGlyphs();
        } }) : null,
      ]));
    }
    const sample = ui.input({ multiline: true, rows: 2, value: (L.lang.data.phrases && L.lang.data.phrases[0] && L.lang.data.phrases[0].out) || (L.words.slice(0, 4).map(w => w.word).join(' ')), onInput: () => paintPreview() });
    const preview = h('div.lx-script-preview');
    function transliterate(text) {
      const gs = sc().glyphs.filter(g => g.sound && g.glyph).sort((a, b) => b.sound.length - a.sound.length);
      const s = String(text || '').toLowerCase();
      let out = '';
      for (let i = 0; i < s.length;) {
        const g = gs.find(x => s.startsWith(x.sound.toLowerCase(), i));
        if (g) { out += g.glyph; i += g.sound.length; } else { out += s[i]; i++; }
      }
      return out;
    }
    function paintPreview() {
      GK.clear(preview);
      const d = sc().direction, t = transliterate(sample.value);
      const lines = t.split('\n');
      const box = h('div.lx-script-out', { class: 'd-' + d, dir: d === 'rtl' ? 'rtl' : 'ltr', style: { fontFamily: sc().font ? '"' + sc().font + '", var(--font-ui)' : '' } },
        lines.map((ln, i) => h('div', { class: d === 'boustro' && i % 2 ? 'mirror' : '', text: ln || ' ' })));
      preview.append(box, h('div.gk-tiny.gk-muted', { text: sc().glyphs.length ? 'Letters without a sign stay as they are.' : 'Add signs above to see the text in the script.' }));
    }
    const notesHost = h('div.lx-script-notes');
    const ed = WB.editor.create({ value: sc().notes, placeholder: 'How the script works: its history, materials, numbers, punctuation…', onChange: v => save({ notes: v }, 0) });
    notesHost.appendChild(ed.el || ed);
    if (ed.set) ed.set(sc().notes || '');
    host.appendChild(h('div.lx-script', [
      ui.panel({ title: 'Writing system', icon: '✒', body: [
        h('div.lx-script-top', [ui.field({ label: 'Name of the script', control: name }), ui.field({ label: 'Font for the signs', hint: 'Use a font with your own glyphs, or any symbols.', control: font })]),
        ui.field({ label: 'Direction', control: dir }),
        ui.field({ label: 'Signs', hint: 'Letters as the dictionary spells them, and the sign each is written with.', control: table }),
      ] }),
      h('div.lx-script-side', [
        ui.panel({ title: 'Preview', icon: '◫', body: [sample, preview] }),
        ui.panel({ title: 'Notes', icon: '¶', body: [notesHost] }),
      ]),
    ]));
    paintGlyphs(); paintPreview();
    if (WB.share) host.querySelectorAll('.lx-script-top input, .lx-glyphs input').forEach(i => { i.readOnly = true; });
    return () => { if (ed.destroy) ed.destroy(); };
  }

  X.tabs.translate = translate;
  X.tabs.script = script;
})();
