/* Lexicon tab: a fast, spreadsheet-like dictionary. Add with Enter, click any cell to edit (Tab / Enter / arrows move),
   sort by a column, filter by part of speech or search both ways, roots and derived words, import and export. */
(function () {
  'use strict';
  const { h, ui } = GK;
  const X = WB.lexicon._;
  const N = () => WB.names;

  const COLS = [
    // key, label, field, width, editable, optional
    ['sel', '', null, '2.1em', false, false],
    ['word', 'Word', 'word', 'minmax(6.5em, 1.15fr)', true, false],
    ['ipa', 'IPA', 'ipa', 'minmax(5.5em, .9fr)', true, true],
    ['pos', 'Part', 'pos', '4.2em', true, false],
    ['gloss', 'Meaning', 'gloss', 'minmax(7.5em, 1.5fr)', true, false],
    ['def', 'Definition', 'definition', 'minmax(8em, 2fr)', true, true],
    ['ety', 'Origin', 'etymology', 'minmax(7em, 1.5fr)', true, true],
    ['tags', 'Tags', 'tags', 'minmax(5.5em, 1fr)', true, true],
    ['act', '', null, '4.6em', false, false],
  ];
  const PAGE = 160;

  function tab(host, L) {
    const S = L.S, nm = N();
    let q = '', shown = PAGE, dupOnly = false, fresh = [];
    const open = new Set(), sel = new Set();
    let editor = null;   // the open inline editor: { row id, key, commit, cancel }
    L.editing = () => !!editor || !!host.querySelector('.lx-detail :focus');

    let narrow = new Set();   // optional columns folded away because the table is too narrow for them
    const cols = () => COLS.filter(c => !c[5] || (S().cols[c[0]] !== false && !narrow.has(c[0])));
    const fit = () => {
      const em = parseFloat(getComputedStyle(host).fontSize) || 14, w = host.clientWidth / em;
      if (!w) return false;
      const n = new Set(w < 56 ? ['tags'] : []);
      if (w < 50) n.add('ety');
      if (w < 42) n.add('def');
      if (w < 35) n.add('ipa');
      const changed = [...n].join() !== [...narrow].join();
      narrow = n;
      return changed;
    };
    const template = () => cols().map(c => c[3]).join(' ');
    const phon = L.phon(), hasPhon = X.hasPhon(L.lang), spell = nm.spelling(phon);
    const guessIpa = w => (hasPhon ? nm.deromanize(w, spell) : '');

    /* ---------- filtering & sorting ---------- */
    const norm = nm.norm;
    function homographs() { const m = new Map(); for (const w of L.words) { const k = norm(w.word); m.set(k, (m.get(k) || 0) + 1); } return m; }
    function filtered() {
      const st = S(), hm = homographs(), nq = norm(q), lq = q.toLowerCase().trim();
      let list = L.words.filter(w => {
        if (st.pos && (w.pos || '') !== (st.pos === '-' ? '' : st.pos)) return false;
        if (dupOnly && hm.get(norm(w.word)) < 2) return false;
        if (!lq) return true;
        const inWord = norm(w.word).includes(nq) || norm(w.ipa).includes(nq);
        const inMeaning = (w.gloss + ' ' + w.definition).toLowerCase().includes(lq);
        const inOther = (w.etymology + ' ' + w.notes + ' ' + (w.tags || []).join(' ')).toLowerCase().includes(lq);
        return st.scope === 'word' ? inWord : st.scope === 'gloss' ? inMeaning : inWord || inMeaning || inOther;
      });
      const { key, dir } = st.sort || { key: 'word', dir: 1 };
      const val = w => (key === 'word' ? norm(w.word) : key === 'ipa' ? norm(w.ipa) : key === 'pos' ? (w.pos || '~') + norm(w.word) : key === 'gloss' ? (w.gloss || '~').toLowerCase() : key === 'def' ? (w.definition || '~').toLowerCase() : key === 'ety' ? (w.etymology || '~').toLowerCase() : key === 'tags' ? (w.tags || []).join(',') || '~' : key === 'new' ? w.createdAt : '');
      list.sort((a, b) => { const x = val(a), y = val(b); return (x < y ? -1 : x > y ? 1 : 0) * (key === 'new' ? -1 : 1) * dir; });
      // just-added words stay at the top until the tab is repainted
      if (fresh.length) { const f = new Set(fresh); list = list.filter(w => f.has(w.id)).sort((a, b) => fresh.indexOf(b.id) - fresh.indexOf(a.id)).concat(list.filter(w => !f.has(w.id))); }
      return list;
    }
    const mark = (text, kind) => {
      const lq = q.trim();
      if (!lq || !text) return document.createTextNode(text || '');
      const base = kind === 'word' ? norm(text) : text.toLowerCase(), needle = kind === 'word' ? norm(lq) : lq.toLowerCase();
      const i = base.indexOf(needle);
      if (i < 0 || base.length !== text.length) return document.createTextNode(text);
      return h('span', [text.slice(0, i), h('mark', { text: text.slice(i, i + needle.length) }), text.slice(i + needle.length)]);
    };

    /* ---------- cells ---------- */
    function view(w, k, hm) {
      switch (k) {
        case 'word': {
          const n = hm.get(norm(w.word)) || 1;
          return [h('span.lx-w', [mark(w.word, 'word')]), n > 1 ? h('span.lx-dup', { text: '×' + n, title: 'Spelled the same as ' + (n - 1) + ' other word' + (n > 2 ? 's' : '') + ': ' + L.words.filter(x => x.id !== w.id && norm(x.word) === norm(w.word)).map(x => x.gloss || '?').join(', ') }) : null,
            w.entryId && WB.liteOf(w.entryId) ? h('span.lx-linked', { text: '↗', title: 'Names “' + WB.titleOf(w.entryId) + '”' }) : null];
        }
        case 'ipa': return w.ipa ? h('span.lx-ipa', { text: '/' + w.ipa + '/' }) : h('span.lx-empty', { text: hasPhon ? '/' + guessIpa(w.word) + '/' : '' , title: hasPhon ? 'Guessed from the spelling rules — click to set' : '' });
        case 'pos': return X.posBadge(w.pos);
        case 'gloss': return w.gloss ? mark(w.gloss, 'text') : h('span.lx-empty', { text: 'add a meaning' });
        case 'def': return h('span.lx-clamp', [mark(w.definition, 'text')]);
        case 'ety': {
          const r = w.rootId && L.wordById(w.rootId);
          return [r ? h('button.lx-root', { type: 'button', title: 'Root: ' + r.word + (r.gloss ? ' — ' + r.gloss : '') + ' (click to go there)', text: '← ' + r.word, onclick: e => { e.stopPropagation(); reveal(r.id); } }) : null,
            w.sourceId ? h('button.lx-root.lx-src', { type: 'button', text: '⇠ ' + (/^From /.test(w.etymology) ? w.etymology.slice(5) : 'parent word'), title: 'Inherited — click to see the word it came from', onclick: async e => { e.stopPropagation(); const full = await WB.api('lexicon.word', w.id).catch(WB.fail); if (full && full.source) L.openWord(full.source.languageId, full.source.id); } }) : null,
            h('span.lx-clamp', [mark(w.sourceId && /^From /.test(w.etymology) ? '' : w.etymology, 'text')])];
        }
        case 'tags': return h('span.lx-tags', (w.tags || []).map(t => h('span.lx-tag', { text: t })));
        default: return null;
      }
    }
    function rowEl(w, hm) {
      const r = h('div.lx-tr', { dataset: { id: w.id }, class: (open.has(w.id) ? 'open ' : '') + (sel.has(w.id) ? 'sel ' : '') + (fresh.includes(w.id) ? 'fresh' : ''), role: 'row' });
      for (const c of cols()) {
        const k = c[0];
        if (k === 'sel') { const cb = h('input.lx-check', { type: 'checkbox', checked: sel.has(w.id), title: 'Select (Shift-click a range)', 'aria-label': 'Select ' + w.word }); cb.addEventListener('click', e => toggleSel(w.id, cb.checked, e.shiftKey)); r.appendChild(h('div.lx-td.sel', [cb])); continue; }
        if (k === 'act') {
          r.appendChild(h('div.lx-td.act', [
            h('button.lx-act', { type: 'button', title: open.has(w.id) ? 'Hide details' : 'Details: root, derived words, notes', text: open.has(w.id) ? '▴' : '▾', onclick: () => toggleOpen(w.id) }),
            h('button.lx-act.more', { type: 'button', title: 'More', text: '⋯', onclick: e => rowMenu(w, e.currentTarget) }),
          ]));
          continue;
        }
        const td = h('div.lx-td', { dataset: { k }, class: k, role: 'gridcell', tabindex: -1 }, view(w, k, hm));
        td.addEventListener('click', e => { if (e.target.closest('button, a, .wb-chip')) return; edit(w.id, k); });
        td.addEventListener('keydown', e => { if (e.key === 'Enter' || e.key === 'F2') { e.preventDefault(); edit(w.id, k); } });
        r.appendChild(td);
      }
      r.addEventListener('contextmenu', e => { if (e.target.closest('input, textarea, select')) return; e.preventDefault(); rowMenu(w, e); });
      if (open.has(w.id)) r.appendChild(detail(w));
      return r;
    }
    function repaintRow(id) {
      const old = body.querySelector('.lx-tr[data-id="' + id + '"]');
      const w = L.wordById(id);
      if (!old) return;
      if (!w) { old.remove(); return; }
      old.replaceWith(rowEl(w, homographs()));
    }

    /* ---------- inline editing ---------- */
    const editKeys = () => cols().filter(c => c[4]).map(c => c[0]);
    function edit(id, k) {
      if (WB.share) return;
      if (editor) editor.commit();
      const w = L.wordById(id), r = body.querySelector('.lx-tr[data-id="' + id + '"]');
      if (!w || !r) return;
      const td = r.querySelector('.lx-td[data-k="' + k + '"]');
      if (!td) return;
      const field = COLS.find(c => c[0] === k)[2];
      const start = k === 'tags' ? (w.tags || []).join(', ') : w[field] || '';
      let inp;
      if (k === 'pos') {
        inp = h('select.lx-edit', [h('option', { value: '', text: '—' }), ...X.POS.map(([c, n]) => h('option', { value: c, text: c + ' · ' + n }))].concat(w.pos && !X.POS.find(x => x[0] === w.pos) ? [h('option', { value: w.pos, text: w.pos })] : []));
        inp.value = w.pos || '';
      } else {
        inp = h('input.lx-edit', { value: start, spellcheck: k === 'def' || k === 'gloss' || k === 'ety', placeholder: k === 'ipa' && hasPhon ? guessIpa(w.word) : k === 'tags' ? 'tags, separated by commas' : '' });
      }
      GK.clear(td); td.appendChild(inp); td.classList.add('editing');
      let done = false;
      const finish = async (save, move) => {
        if (done) return; done = true; editor = null;
        const v = inp.value.trim();
        if (save && v !== String(start).trim()) {
          if (k === 'word' && !v) { ui.toast('A word needs a spelling — use ⋯ → Delete to remove it', '⚠'); repaintRow(id); }
          else {
            const patch = { [field]: k === 'tags' ? v.split(/[,;]/).map(s => s.trim()).filter(Boolean) : v };
            try { const nw = await WB.api('lexicon.update', id, patch); L.upsert(nw); } catch (e) { WB.fail(e); }
          }
        }
        repaintRow(id);
        paintStats();
        if (move) go(id, k, move);
      };
      editor = { id, k, commit: () => finish(true), cancel: () => finish(false) };
      inp.addEventListener('keydown', e => {
        if (e.key === 'Escape') { e.preventDefault(); e.stopPropagation(); finish(false); focusCell(id, k); }
        else if (e.key === 'Enter') { e.preventDefault(); finish(true, e.shiftKey ? 'up' : 'down'); }
        else if (e.key === 'Tab') { e.preventDefault(); finish(true, e.shiftKey ? 'prev' : 'next'); }
        else if ((e.key === 'ArrowDown' || e.key === 'ArrowUp') && k !== 'pos') { e.preventDefault(); finish(true, e.key === 'ArrowDown' ? 'down' : 'up'); }
      });
      inp.addEventListener('blur', () => setTimeout(() => { if (!done && document.activeElement !== inp) finish(true); }, 0));
      if (k === 'pos') inp.addEventListener('change', () => finish(true));
      inp.focus();
      if (inp.select && k !== 'pos') inp.setSelectionRange(inp.value.length, inp.value.length);
      if (k === 'pos') { try { inp.showPicker(); } catch { } }
    }
    function go(id, k, move) {
      const rows = [...body.querySelectorAll('.lx-tr[data-id]')].map(r => r.dataset.id), i = rows.indexOf(id), keys = editKeys(), j = keys.indexOf(k);
      if (move === 'down' && rows[i + 1]) edit(rows[i + 1], k);
      else if (move === 'up' && i > 0) edit(rows[i - 1], k);
      else if (move === 'down' && !rows[i + 1]) focusCell(id, k);
      else if (move === 'next') { if (keys[j + 1]) edit(id, keys[j + 1]); else if (rows[i + 1]) edit(rows[i + 1], keys[0]); }
      else if (move === 'prev') { if (j > 0) edit(id, keys[j - 1]); else if (i > 0) edit(rows[i - 1], keys[keys.length - 1]); }
    }
    const focusCell = (id, k) => { const td = body.querySelector('.lx-tr[data-id="' + id + '"] .lx-td[data-k="' + k + '"]'); if (td) td.focus(); };

    /* ---------- selection ---------- */
    let lastSel = null;
    function toggleSel(id, on, range) {
      if (range && lastSel) {
        const ids = [...body.querySelectorAll('.lx-tr[data-id]')].map(r => r.dataset.id), a = ids.indexOf(lastSel), b = ids.indexOf(id);
        if (a >= 0 && b >= 0) for (const x of ids.slice(Math.min(a, b), Math.max(a, b) + 1)) sel.add(x);
      } else if (on) sel.add(id); else sel.delete(id);
      lastSel = id;
      body.querySelectorAll('.lx-tr[data-id]').forEach(r => { const s = sel.has(r.dataset.id); r.classList.toggle('sel', s); const cb = r.querySelector('.lx-check'); if (cb) cb.checked = s; });
      paintBulk();
    }
    const bulk = h('div.lx-bulk');
    function paintBulk() {
      GK.clear(bulk);
      bulk.classList.toggle('on', sel.size > 0);
      if (!sel.size) return;
      const ids = [...sel];
      bulk.append(
        h('b', { text: WB.fmt.plural(ids.length, 'word') + ' selected' }),
        ui.button({ label: 'Part of speech', icon: '▾', small: true, onClick: e => WB.ui.menu(X.POS.map(([c, n]) => ({ label: c + ' · ' + n, onClick: async () => { const out = await WB.api('lexicon.updateMany', ids, { pos: c }); out.forEach(L.upsert); repaint(); } })), e.currentTarget) }),
        ui.button({ label: 'Add tag…', small: true, onClick: async () => { const t = await ui.prompt('Add a tag to ' + ids.length + ' words', '', 'e.g. sea, kinship, verbs of motion'); if (!t) return; for (const id of ids) { const w = L.wordById(id); const nw = await WB.api('lexicon.update', id, { tags: [...new Set((w.tags || []).concat(t.split(/[,;]/).map(s => s.trim()).filter(Boolean)))] }); L.upsert(nw); } repaint(); } }),
        ui.button({ label: 'Copy', icon: '⎘', small: true, title: 'Copy as tab-separated text (pastes into a spreadsheet)', onClick: () => X.copy(ids.map(L.wordById).filter(Boolean).map(w => [w.word, w.ipa, w.pos, w.gloss, w.definition].join('\t')).join('\n'), ids.length + ' words copied') }),
        ui.button({ label: 'Delete', icon: '🗑', small: true, kind: 'danger', onClick: async () => { await L.removeWords(ids); sel.clear(); repaint(); } }),
        h('span.gk-grow'),
        ui.button({ label: 'Clear selection', small: true, kind: 'ghost', onClick: () => { sel.clear(); repaint(); } }),
      );
    }

    /* ---------- details (root, derived words, notes) ---------- */
    function toggleOpen(id) { if (open.has(id)) open.delete(id); else open.add(id); repaintRow(id); }
    function detail(w) {
      const box = h('div.lx-detail', { role: 'region', 'aria-label': 'Details of ' + w.word });
      const save = WB.debounce(async patch => { try { const nw = await WB.api('lexicon.update', w.id, patch); L.upsert(nw); const r = body.querySelector('.lx-tr[data-id="' + w.id + '"]'); if (r) { const hm = homographs(); for (const td of r.querySelectorAll(':scope > .lx-td[data-k]')) { GK.clear(td); GK.append(td, view(L.wordById(w.id), td.dataset.k, hm)); } } } catch (e) { WB.fail(e); } }, 450);
      const area = (field, label, ph, rows = 2) => {
        const t = ui.input({ multiline: true, rows, value: w[field] || '', placeholder: ph, onInput: v => save({ [field]: v }) });
        t.classList.add('lx-area');
        return ui.field({ label, control: t });
      };
      const rootBox = h('div.gk-row');
      const paintRoot = () => {
        GK.clear(rootBox);
        const cur = L.wordById(w.id), r = cur.rootId && L.wordById(cur.rootId);
        rootBox.append(r ? h('button.lx-root.big', { type: 'button', text: '← ' + r.word + (r.gloss ? ' · ' + r.gloss : ''), title: 'Go to the root', onclick: () => reveal(r.id) }) : h('span.gk-small.gk-muted', { text: 'No root' }),
          ui.button({ label: r ? 'Change…' : 'Choose a root…', small: true, kind: 'ghost', onClick: e => pickWord(e.currentTarget, 'Root of “' + cur.word + '”', [cur.id], async x => { try { const nw = await WB.api('lexicon.update', w.id, { rootId: x ? x.id : null }); L.upsert(nw); paintRoot(); paintDerived(); repaintRowCells(w.id); } catch (err) { WB.fail(err); } }, !!r) }));
      };
      const derivedBox = h('div.lx-derived');
      const paintDerived = () => {
        GK.clear(derivedBox);
        const kids = L.words.filter(x => x.rootId === w.id);
        for (const k of kids) derivedBox.appendChild(h('button.lx-wordchip', { type: 'button', title: (k.gloss || '') + ' — go to it', onclick: () => reveal(k.id) }, [h('b', { text: k.word }), k.gloss ? h('span.gk-muted', { text: ' ' + k.gloss }) : null]));
        derivedBox.appendChild(ui.button({ label: 'Derive a word', icon: '＋', small: true, kind: 'ghost', title: 'A new word built on this one (it becomes the root)', onClick: () => deriveFrom(L.wordById(w.id)) }));
      };
      const linkBox = h('div.gk-row');
      const paintLink = () => {
        GK.clear(linkBox);
        const cur = L.wordById(w.id);
        if (cur.entryId && WB.liteOf(cur.entryId)) linkBox.append(WB.ui.chip(cur.entryId, { size: 'sm', onRemove: async () => { const nw = await WB.api('lexicon.update', w.id, { entryId: null }); L.upsert(nw); paintLink(); } }));
        else linkBox.append(ui.button({ label: 'Link an entry…', small: true, kind: 'ghost', title: 'The place, person or thing this word names', onClick: async () => { const p = await WB.ui.pickEntry({ title: 'What does “' + cur.word + '” name?', allowCreate: true }); if (p) { const nw = await WB.api('lexicon.update', w.id, { entryId: p.id }); L.upsert(nw); paintLink(); repaintRowCells(w.id); } } }));
      };
      const family = h('div.lx-family');
      WB.api('lexicon.word', w.id).then(full => {
        if (full.source) family.append(h('div.gk-small', ['Inherited from ', h('button.lx-root', { type: 'button', text: full.source.languageTitle + ' ' + full.source.word, onclick: () => L.openWord(full.source.languageId, full.source.id) })]));
        if (full.descendants.length) family.append(h('div.gk-small', ['Became ', ...full.descendants.map(d => h('button.lx-root', { type: 'button', text: d.word + ' (' + d.languageTitle + ')', onclick: () => L.openWord(d.languageId, d.id) }))]));
      }).catch(() => {});
      paintRoot(); paintDerived(); paintLink();
      box.append(
        h('div.lx-detail-col', [area('definition', 'Definition', 'What it means, how it is used…', 2), area('etymology', 'Origin', 'e.g. sa “salt” + lend “march”', 1), area('notes', 'Notes', 'Usage, examples, idioms…', 2)]),
        h('div.lx-detail-col', [
          ui.field({ label: 'Root', control: rootBox }),
          ui.field({ label: 'Derived words', control: derivedBox }),
          ui.field({ label: 'Names an entry', control: linkBox }),
          family,
        ]),
      );
      return box;
    }
    function repaintRowCells(id) { const r = body.querySelector('.lx-tr[data-id="' + id + '"]'); const w = L.wordById(id); if (!r || !w) return; const hm = homographs(); for (const td of r.querySelectorAll(':scope > .lx-td[data-k]')) { GK.clear(td); GK.append(td, view(w, td.dataset.k, hm)); } }
    function pickWord(anchor, title, exclude, done, allowNone) {
      const list = h('div.lx-pick-list');
      const paint = v => {
        GK.clear(list);
        const nq = norm(v), lq = v.toLowerCase();
        const hits = L.words.filter(x => !exclude.includes(x.id) && (!v || norm(x.word).includes(nq) || (x.gloss || '').toLowerCase().includes(lq))).slice(0, 40);
        for (const x of hits) list.appendChild(h('button.lx-look-row', { type: 'button', onclick: () => { pop.close(); done(x); } }, [h('b', { text: x.word }), X.posBadge(x.pos), h('span.gk-grow.gk-ellipsis', { text: x.gloss || '' })]));
        if (!hits.length) list.appendChild(h('div.gk-small.gk-muted.lx-look-none', { text: 'No word matches.' }));
      };
      const s = WB.ui.search({ placeholder: 'Word or meaning', autofocus: true, onInput: paint, onEnter: () => { const b = list.querySelector('button'); if (b) b.click(); } });
      const pop = WB.ui.popover(anchor, h('div.lx-pick', [h('div.gk-small.gk-muted', { text: title }), s, list, allowNone ? ui.button({ label: 'No root', small: true, kind: 'ghost', onClick: () => { pop.close(); done(null); } }) : null]), { group: 'lx-pick', width: '24em', cls: 'lx-pop' });
      paint('');
    }
    async function deriveFrom(root) {
      addIn.word.value = root.word; addIn.gloss.value = ''; addIn.ipa.value = '';
      pendingRoot = root;
      paintAddHint();
      addIn.word.focus(); addIn.word.setSelectionRange(root.word.length, root.word.length);
      addRow.scrollIntoView({ block: 'nearest' });
    }

    /* ---------- the row menu ---------- */
    function rowMenu(w, at) {
      if (WB.share) { WB.ui.menu([{ label: 'Copy', icon: '⎘', onClick: () => X.copy(w.word + (w.gloss ? ' — ' + w.gloss : ''), '“' + w.word + '” copied') }], at); return; }
      WB.ui.menu([
        { label: open.has(w.id) ? 'Hide details' : 'Details', icon: '▾', onClick: () => toggleOpen(w.id) },
        { label: 'Derive a word from this', icon: '＋', onClick: () => deriveFrom(w) },
        { label: 'Copy', icon: '⎘', onClick: () => X.copy(w.word + (w.ipa ? ' /' + w.ipa + '/' : '') + (w.gloss ? ' — ' + w.gloss : ''), '“' + w.word + '” copied') },
        { label: 'Use as a name…', icon: '✦', hint: 'Create an entry named after this word', onClick: () => asName(w) },
        { label: 'Translate with it', icon: '⇄', onClick: () => L.select(L.lang.id, { tab: 'translate' }) },
        '-',
        { label: 'Delete', icon: '🗑', danger: true, kbd: 'Del', onClick: async () => { await L.removeWords([w.id]); open.delete(w.id); sel.delete(w.id); repaint(); } },
      ], at);
    }
    async function asName(w) {
      const t = await WB.ui.createDialog({ title: nm.cap(w.word), type: w.pos === 'name' ? 'place' : 'character', open: false });
      if (t) { const nw = await WB.api('lexicon.update', w.id, { entryId: t.id }); L.upsert(nw); repaintRowCells(w.id); WB.ui.undoToast('Created “' + t.title + '” and linked it to the word', () => WB.api('entries.purge', t.id)); }
    }

    /* ---------- the add row ---------- */
    let pendingRoot = null;
    const addIn = {
      word: h('input.gk-input.gk-control', { placeholder: 'New word', spellcheck: false, 'aria-label': 'New word' }),
      ipa: h('input.gk-input.gk-control', { placeholder: '/ipa/', spellcheck: false, 'aria-label': 'Pronunciation' }),
      pos: h('select.gk-input.gk-control', { 'aria-label': 'Part of speech', title: 'Part of speech (stays set for the next word)' }, [h('option', { value: '', text: '—' }), ...X.POS.map(([c, n]) => h('option', { value: c, text: c + ' · ' + n }))]),
      gloss: h('input.gk-input.gk-control', { placeholder: 'Meaning', 'aria-label': 'Meaning' }),
      def: h('input.gk-input.gk-control', { placeholder: 'Definition (optional)', 'aria-label': 'Definition' }),
    };
    addIn.pos.value = L.lastPos || 'n';
    const addHint = h('div.lx-add-hint');
    const coin = () => {
      if (!hasPhon) { ui.toast('Give the language some sounds on the Phonology tab first', 'ɑ'); return null; }
      const avoid = L.words.map(x => x.word).concat(WB.titles.map(t => t.title));
      const syl = addIn.pos.value === 'name' ? [2, 3] : null;
      const pool = nm.words(phon, { count: 8, seed: X.seed(), avoid, syllables: syl });
      const got = pool.find(x => [...x.plain].length >= 3) || pool[0];
      if (!got) return null;
      addIn.word.value = addIn.pos.value === 'name' ? nm.cap(got.word) : got.word; addIn.ipa.value = got.ipa;
      paintAddHint();
      return got;
    };
    const dice = ui.button({ icon: '⚄', small: true, kind: 'ghost', title: 'Coin a word from the phonology (Ctrl+G)', onClick: () => { coin(); addIn.word.focus(); } });
    const addBtn = ui.button({ label: 'Add', icon: '＋', small: true, kind: 'primary', title: 'Add the word (Enter)', onClick: () => submitAdd() });
    const addRow = h('div.lx-add', [
      h('div.lx-add-fields', [h('div.lx-add-word', [addIn.word, dice]), addIn.ipa, addIn.pos, addIn.gloss, addIn.def, addBtn]),
      addHint,
    ]);
    function paintAddHint() {
      GK.clear(addHint);
      const wv = addIn.word.value.trim(), gv = addIn.gloss.value.trim();
      const bits = [];
      if (pendingRoot) bits.push(h('span.lx-hint-root', ['Built on ', h('b', { text: pendingRoot.word }), ' ', h('button.lx-x', { type: 'button', text: '✕', title: 'Not built on a root', onclick: () => { pendingRoot = null; paintAddHint(); } })]));
      if (wv) {
        const same = L.words.filter(x => norm(x.word) === norm(wv));
        if (same.length) bits.push(h('span.lx-warn', { text: '⚠ “' + wv + '” is already here: ' + same.map(x => x.gloss || '(no meaning)').join('; ') + '. Enter adds it anyway.' }));
        const ent = X.titleHit(wv);
        if (ent) bits.push(h('span.lx-warn.soft', { text: 'Also the name of the entry “' + ent.title + '”.' }));
        if (hasPhon && !addIn.ipa.value) bits.push(h('span.gk-muted', { text: 'Says /' + guessIpa(wv) + '/' }));
      }
      if (gv) {
        const terms = gv.toLowerCase().split(/[,;]/).map(s => s.trim().replace(/^(to|the|a|an) /, '')).filter(Boolean);
        const syn = L.words.filter(x => (x.gloss || '').toLowerCase().split(/[,;]/).map(s => s.trim().replace(/^(to|the|a|an) /, '')).some(t => terms.includes(t)));
        if (syn.length) bits.push(h('span.lx-warn.soft', { text: '“' + terms[0] + '” already has a word: ' + syn.map(x => x.word).join(', ') }));
      }
      if (!bits.length) bits.push(h('span.gk-muted', [WB.ui.kbd('Enter'), ' add · ', WB.ui.kbd('Tab'), ' next field · ', WB.ui.kbd('Ctrl+G'), ' coin a word' + (hasPhon ? ' (or leave the word empty: one is coined for the meaning)' : '')]));
      addHint.append(...bits);
    }
    for (const k of Object.keys(addIn)) {
      const el = addIn[k];
      el.addEventListener('input', () => { if (k === 'word' || k === 'gloss' || k === 'ipa') paintAddHint(); });
      el.addEventListener('keydown', e => {
        if (e.key === 'Enter') { e.preventDefault(); submitAdd(); }
        else if (e.key.toLowerCase() === 'g' && e.ctrlKey) { e.preventDefault(); coin(); }
        else if (e.key === 'Escape' && el.value) { e.stopPropagation(); el.value = ''; paintAddHint(); }
      });
    }
    addIn.pos.addEventListener('change', () => { L.lastPos = addIn.pos.value; });
    async function submitAdd() {
      if (WB.share) return;
      let word = addIn.word.value.trim(), ipa = addIn.ipa.value.trim();
      const gloss = addIn.gloss.value.trim();
      if (!word && gloss && hasPhon) { const c = coin(); if (c) { word = addIn.word.value.trim(); ipa = addIn.ipa.value.trim(); } }
      if (!word) { addIn.word.focus(); ui.toast(hasPhon ? 'Type a word, or a meaning to coin one' : 'Type a word first', 'ℒ'); return; }
      const w = { word, ipa: ipa || guessIpa(word), pos: addIn.pos.value, gloss, definition: addIn.def.value.trim(), rootId: pendingRoot ? pendingRoot.id : null,
        etymology: pendingRoot ? pendingRoot.word + (pendingRoot.gloss ? ' “' + pendingRoot.gloss.split(',')[0] + '”' : '') + ' + …' : '' };
      try {
        const r = await L.addWord(w);
        fresh.unshift(r.id);
        addIn.word.value = ''; addIn.ipa.value = ''; addIn.gloss.value = ''; addIn.def.value = ''; pendingRoot = null;
        L.lastPos = addIn.pos.value;
        repaint();
        addIn.word.focus();
      } catch (e) { WB.fail(e); }
    }

    /* ---------- toolbar, stats, table ---------- */
    const search = WB.ui.search({ placeholder: 'Search words and meanings', value: q, onInput: v => { q = v; shown = PAGE; repaint(); } });
    search.querySelector('input').addEventListener('keydown', e => { if (e.key === 'ArrowDown') { const td = body.querySelector('.lx-tr[data-id] .lx-td[data-k]'); if (td) { e.preventDefault(); td.focus(); } } });
    const scope = ui.segmented({ value: S().scope || 'all', options: [['all', 'All', 'Search words, meanings and notes'], ['word', 'Word', 'Search the language side: spelling and pronunciation'], ['gloss', 'Meaning', 'Search the meaning side: glosses and definitions']], onChange: v => { L.set({ scope: v }); repaint(); } });
    const sortSel = ui.select({ value: (S().sort || {}).key || 'word', options: [['word', 'Sort: A → Z'], ['gloss', 'Sort: by meaning'], ['pos', 'Sort: by part of speech'], ['new', 'Sort: newest first']], onChange: v => { L.set({ sort: { key: v, dir: 1 } }); repaint(); } });
    const toolbar = h('div.lx-toolbar', [
      h('div.lx-tb-search', [search]), scope, sortSel,
      h('span.gk-grow'),
      ui.button({ label: 'Import', icon: '⇪', small: true, title: 'Paste or open a word list (CSV, TSV, a spreadsheet)', onClick: () => importDialog(L, () => { L.loadWords().then(repaint); }) }),
      ui.button({ label: 'Export', icon: '⇩', small: true, title: 'Save or copy the dictionary', onClick: e => exportMenu(L, e.currentTarget) }),
      ui.button({ icon: '☰', small: true, kind: 'ghost', title: 'Columns', onClick: e => WB.ui.menu(COLS.filter(c => c[5]).map(c => ({ label: c[1], checked: S().cols[c[0]] !== false, onClick: () => { L.set({ cols: Object.assign({}, S().cols, { [c[0]]: S().cols[c[0]] === false }) }); repaint(); } })), e.currentTarget) }),
    ]);
    const stats = h('div.lx-stats');
    function paintStats() {
      GK.clear(stats);
      const by = {}; for (const w of L.words) by[w.pos || '-'] = (by[w.pos || '-'] || 0) + 1;
      const cur = S().pos || '';
      const chip = (code, label, n, title) => { const c = ui.chip({ label: [label, h('span.lx-n', { text: String(n) })], on: cur === code, title, onClick: () => { L.set({ pos: cur === code ? '' : code }); shown = PAGE; repaint(); } }); c.style.setProperty('--c', code && code !== '-' ? X.posColor(code) : 'var(--muted)'); c.classList.add('lx-poschip'); return c; };
      stats.append(chip('', 'All', L.words.length, 'Every word'));
      for (const [code] of X.POS) if (by[code]) stats.append(chip(code, X.posName(code), by[code], 'Only ' + X.posName(code) + 's'));
      for (const code of Object.keys(by)) if (code !== '-' && !X.POS.find(p => p[0] === code)) stats.append(chip(code, code, by[code]));
      if (by['-']) stats.append(chip('-', 'unsorted', by['-'], 'Words without a part of speech'));
      const hm = homographs(), dups = [...hm.values()].filter(n => n > 1).length;
      if (dups) stats.append(ui.chip({ label: '⚠ ' + dups + ' spelling' + (dups > 1 ? 's' : '') + ' used twice', on: dupOnly, title: 'Show only words spelled like another word', onClick: () => { dupOnly = !dupOnly; repaint(); } }));
      const noGloss = L.words.filter(w => !w.gloss).length;
      if (noGloss) stats.append(h('span.gk-small.gk-muted', { text: noGloss + ' without a meaning' }));
    }
    const thead = h('div.lx-tr.lx-thead', { role: 'row' });
    function paintHead() {
      GK.clear(thead);
      const st = S().sort || { key: 'word', dir: 1 };
      for (const c of cols()) {
        if (c[0] === 'sel') {
          const cb = h('input.lx-check', { type: 'checkbox', title: 'Select all shown', 'aria-label': 'Select all' });
          cb.addEventListener('click', () => { const ids = [...body.querySelectorAll('.lx-tr[data-id]')].map(r => r.dataset.id); if (cb.checked) ids.forEach(id => sel.add(id)); else sel.clear(); repaint(); });
          thead.appendChild(h('div.lx-th.sel', [cb])); continue;
        }
        if (!c[1]) { thead.appendChild(h('div.lx-th')); continue; }
        const on = st.key === c[0];
        thead.appendChild(h('button.lx-th', { type: 'button', class: on ? 'on' : '', title: 'Sort by ' + (c[0] === 'ipa' ? 'pronunciation (IPA)' : c[1].toLowerCase()), onclick: () => { L.set({ sort: { key: c[0], dir: on ? -st.dir : 1 } }); sortSel.value = ['word', 'gloss', 'pos'].includes(c[0]) ? c[0] : sortSel.value; repaint(); } }, [c[1], on ? h('span.lx-sort', { text: st.dir > 0 ? ' ↑' : ' ↓' }) : null]));
      }
    }
    const body = h('div.lx-tbody', { role: 'rowgroup' });
    const table = h('div.lx-table', { role: 'grid', 'aria-label': 'Dictionary' }, [thead, body]);
    const more = h('div.lx-more');
    let io = null;
    function repaint() {
      if (editor) { editor.cancel(); }
      table.style.setProperty('--cols', template());
      paintHead(); paintStats(); paintBulk();
      GK.clear(body); GK.clear(more);
      const list = filtered(), hm = homographs();
      if (!L.words.length) {
        body.appendChild(WB.ui.empty({ icon: 'ℒ', title: 'An empty dictionary', text: hasPhon ? 'Type a word above and press Enter — or type only a meaning and one is coined from the language\'s sounds. You can also generate a batch or import a list.' : 'Type a word above and press Enter, or import a list you already have.', actions: [
          hasPhon ? ui.button({ label: 'Generate words', icon: '⚄', onClick: () => L.select(L.lang.id, { tab: 'generator' }) }) : ui.button({ label: 'Set up the sounds', icon: 'ɑ', onClick: () => L.select(L.lang.id, { tab: 'phonology' }) }),
          ui.button({ label: 'Import a word list', icon: '⇪', onClick: () => importDialog(L, () => L.loadWords().then(repaint)) }),
        ] }));
        return;
      }
      if (!list.length) { body.appendChild(h('div.lx-none', [h('span.gk-muted', { text: 'Nothing matches' + (q ? ' “' + q + '”' : '') + '.' }), ' ', ui.button({ label: 'Clear filters', small: true, kind: 'ghost', onClick: () => { q = ''; search.querySelector('input').value = ''; dupOnly = false; L.set({ pos: '' }); repaint(); } }),
        q && hasPhon ? ui.button({ label: 'Coin a word for “' + q + '”', small: true, onClick: () => { addIn.gloss.value = q; coin(); addIn.word.focus(); } }) : null])); return; }
      const frag = document.createDocumentFragment();
      list.slice(0, shown).forEach(w => frag.appendChild(rowEl(w, hm)));
      body.appendChild(frag);
      if (list.length > shown) {
        const b = ui.button({ label: 'Show ' + Math.min(PAGE, list.length - shown) + ' more (' + (list.length - shown) + ' left)', small: true, kind: 'ghost', onClick: () => { shown += PAGE; repaint(); } });
        more.appendChild(b);
        if (io) io.disconnect();
        io = new IntersectionObserver(es => { if (es.some(e => e.isIntersecting)) { io.disconnect(); shown += PAGE; repaint(); } }, { rootMargin: '400px' });
        io.observe(more);
      }
      more.appendChild(h('div.gk-tiny.gk-faint.lx-count', { text: list.length === L.words.length ? WB.fmt.plural(list.length, 'word') : list.length + ' of ' + WB.fmt.plural(L.words.length, 'word') }));
    }
    function reveal(id) {
      if (!L.wordById(id)) return;
      if (!filtered().find(w => w.id === id)) { q = ''; search.querySelector('input').value = ''; dupOnly = false; L.set({ pos: '' }); }
      const idx = filtered().findIndex(w => w.id === id);
      if (idx >= shown) shown = idx + 20;
      open.add(id);
      repaint();
      const r = body.querySelector('.lx-tr[data-id="' + id + '"]');
      if (r) { r.scrollIntoView({ block: 'center' }); r.classList.add('flash'); setTimeout(() => r.classList.remove('flash'), 1600); }
    }
    tab.revealIn = reveal;
    tab.focusAddIn = () => { addIn.word.focus(); addRow.scrollIntoView({ block: 'nearest' }); };

    // keyboard: arrows between cells when not editing, Delete removes the row's word (with Undo)
    body.addEventListener('keydown', e => {
      const td = e.target.closest && e.target.closest('.lx-td[data-k]');
      if (!td || editor) return;
      const r = td.parentElement, k = td.dataset.k;
      if (e.key === 'ArrowDown' || e.key === 'ArrowUp') { e.preventDefault(); const n = e.key === 'ArrowDown' ? r.nextElementSibling : r.previousElementSibling; const t = n && n.querySelector('.lx-td[data-k="' + k + '"]'); if (t) t.focus(); else if (e.key === 'ArrowUp') addIn.word.focus(); }
      else if (e.key === 'ArrowRight' || e.key === 'ArrowLeft') { e.preventDefault(); const all = [...r.querySelectorAll(':scope > .lx-td[data-k]')], i = all.indexOf(td); const t = all[i + (e.key === 'ArrowRight' ? 1 : -1)]; if (t) t.focus(); }
      else if (e.key === 'Delete' && !WB.share) { e.preventDefault(); const id = r.dataset.id; L.removeWords([id]).then(() => repaint()); }
      else if (e.key.length === 1 && !e.ctrlKey && !e.metaKey && !e.altKey && k !== 'pos') { edit(r.dataset.id, k); const inp = td.querySelector('input'); if (inp) { inp.value = ''; } }
    });
    const onDoc = e => { if (e.ctrlKey && e.key.toLowerCase() === 'f' && host.isConnected && !document.querySelector('.gk-scrim')) { e.preventDefault(); search.querySelector('input').focus(); } };
    document.addEventListener('keydown', onDoc);

    const panel = ui.panel({ cls: 'lx-words', body: [toolbar, stats, WB.share ? null : addRow, bulk, h('div.lx-table-scroll', [table]), more] });
    host.appendChild(panel);
    paintAddHint();
    fit();
    repaint();
    let roRaf = 0;
    const ro = new ResizeObserver(() => { cancelAnimationFrame(roRaf); roRaf = requestAnimationFrame(() => { if (host.isConnected && fit() && !editor) repaint(); }); });
    ro.observe(host);
    return () => { ro.disconnect(); cancelAnimationFrame(roRaf); document.removeEventListener('keydown', onDoc); if (io) io.disconnect(); L.editing = null; tab.revealIn = null; tab.focusAddIn = null; };
  }
  tab.reveal = (L, id) => tab.revealIn && tab.revealIn(id);
  tab.focusAdd = () => tab.focusAddIn && tab.focusAddIn();

  /* ---------------- import ---------------- */
  function importDialog(L, done) {
    let text = '', pv = null, mapping = null, header = true, mode = 'skip', busy = false;
    const area = ui.input({ multiline: true, rows: 6, placeholder: 'Paste a word list here — straight from a spreadsheet, or CSV / TSV text.\nword, meaning\nsael, sea\nkewa, gull', onInput: v => { text = v; refresh(); } });
    area.classList.add('lx-import-text');
    const table = h('div.lx-import-preview');
    const info = h('div.gk-small.gk-muted');
    const go = ui.button({ label: 'Import', kind: 'primary', onClick: () => run() });
    const refresh = WB.debounce(async () => {
      if (!text.trim()) { pv = null; GK.clear(table); info.textContent = 'Columns are recognised from a header row (word, ipa, pos, meaning, definition, origin, root, tags, notes) or guessed.'; go.disabled = true; return; }
      pv = await WB.api('lexicon.previewImport', text).catch(WB.fail);
      if (!pv) return;
      mapping = pv.mapping.slice(); header = pv.header;
      paint();
    }, 200);
    const LABEL = { word: 'Word', ipa: 'Pronunciation', pos: 'Part of speech', gloss: 'Meaning', definition: 'Definition', etymology: 'Origin', root: 'Root word', tags: 'Tags', notes: 'Notes' };
    function paint() {
      GK.clear(table);
      const n = pv.columns;
      const grid = h('div.lx-imp-grid', { style: { '--n': String(n) } });
      for (let i = 0; i < n; i++) {
        const s = ui.select({ value: mapping[i] || '', options: [['', 'Skip']].concat(pv.fields.map(f => [f, LABEL[f] || f])), onChange: v => { mapping[i] = v; count(); } });
        grid.appendChild(h('div.lx-imp-head', [s]));
      }
      pv.rows.slice(header ? 1 : 0, (header ? 1 : 0) + 8).forEach(r => { for (let i = 0; i < n; i++) grid.appendChild(h('div.lx-imp-cell.gk-ellipsis', { text: r[i] || '' })); });
      table.append(grid,
        h('div.gk-row.lx-imp-opts', [
          h('label.gk-row.nowrap.gk-small', [(() => { const c = h('input', { type: 'checkbox', checked: header }); c.addEventListener('change', () => { header = c.checked; paint(); }); return c; })(), 'The first row is a header']),
          h('span.gk-grow'),
          h('span.gk-small.gk-muted', { text: 'Words already here:' }),
          ui.select({ value: mode, options: [['skip', 'Skip the same word + meaning'], ['update', 'Update the matching word'], ['all', 'Add everything anyway']], onChange: v => { mode = v; } }),
        ]));
      count();
    }
    function count() {
      const total = pv ? pv.total + (pv.header && !header ? 1 : !pv.header && header ? -1 : 0) : 0;
      go.disabled = !pv || !mapping.includes('word') || total <= 0;
      go.replaceChildren(pv && mapping.includes('word') ? 'Import ' + WB.fmt.plural(Math.max(0, total), 'word') : 'Pick the word column');
      info.textContent = pv ? (pv.delim === '\t' ? 'Tab-separated' : pv.delim === ';' ? 'Semicolon-separated' : pv.delim === '|' ? 'Bar-separated' : 'Comma-separated') + ' · ' + WB.fmt.plural(Math.max(0, total), 'row') : '';
    }
    async function run() {
      if (busy || !pv) return;
      busy = true;
      try {
        const r = await WB.api('lexicon.import', L.lang.id, text, { mapping, header, mode, delim: pv.delim });
        close();
        ui.toast('Imported: ' + r.added + ' added' + (r.updated ? ', ' + r.updated + ' updated' : '') + (r.skipped ? ', ' + r.skipped + ' already there' : ''), '⇪', 4200);
        done && done();
      } catch (e) { WB.fail(e); } finally { busy = false; }
    }
    const openFile = ui.button({ label: 'Open a file…', icon: '▤', onClick: async () => { const f = await WB.api('lexicon.openFile').catch(WB.fail); if (f) { area.value = text = f.text; refresh(); } } });
    const panel = ui.panel({ title: 'Import words into ' + L.lang.title, icon: '⇪', cls: 'gk-dialog lx-import', body: [h('div.gk-row.nowrap', [h('div.gk-grow', [info]), openFile]), area, table] });
    panel.appendChild(h('div.gk-panel-foot', [ui.button({ label: 'Cancel', onClick: () => close() }), go]));
    const scrim = h('div.gk-scrim', { onclick: e => { if (e.target === scrim) close(); } }, [panel]);
    const key = e => { if (e.key === 'Escape') { e.stopPropagation(); close(); } };
    const close = () => { scrim.remove(); document.removeEventListener('keydown', key, true); };
    document.addEventListener('keydown', key, true);
    document.body.appendChild(scrim);
    refresh();
    setTimeout(() => area.focus(), 30);
  }
  function exportMenu(L, at) {
    const save = fmt => WB.api('lexicon.exportFile', L.lang.id, fmt).then(r => { if (r) ui.toast('Saved ' + WB.fmt.plural(r.count, 'word'), '⇩'); }).catch(WB.fail);
    WB.ui.menu([
      { header: 'Save as' },
      { label: 'Spreadsheet (CSV)…', icon: '▦', onClick: () => save('csv') },
      { label: 'Tab-separated (TSV)…', icon: '▦', onClick: () => save('tsv') },
      { label: 'Dictionary (Markdown)…', icon: '¶', onClick: () => save('md') },
      { label: 'Data (JSON)…', icon: '{}', onClick: () => save('json') },
      '-',
      { label: 'Copy as a table', icon: '⎘', hint: 'Pastes into a spreadsheet', onClick: async () => { const r = await WB.api('lexicon.export', L.lang.id, 'tsv'); X.copy(r.text, WB.fmt.plural(r.count, 'word')); } },
      { label: 'Copy as a dictionary', icon: '⎘', onClick: async () => { const r = await WB.api('lexicon.export', L.lang.id, 'md'); X.copy(r.text, 'The dictionary'); } },
    ], at);
  }
  X.importDialog = importDialog;
  X.tabs.words = tab;
})();
