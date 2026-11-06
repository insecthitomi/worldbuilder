/* Toolkit · random tables: Random table entries (rows in data.rows, dice in fields.dice). Edit rows (weights or dice
   ranges, drag to reorder, paste a list, [[ to link a table), roll with the row highlighted and nested rolls shown,
   roll many, turn a result into an entry, import and export. */
(function () {
  'use strict';
  const GK = window.GK, WB = window.WB, h = GK.h, ui = GK.ui, TK = WB.toolkit;
  const G = () => window.WBGen;
  const recent = TK.tableRecent = TK.tableRecent || {};   // table id → last results (this run of the app)
  const pct = p => (p >= 0.995 ? '100%' : p < 0.001 ? '<0.1%' : (Math.round(p * 1000) / 10) + '%');

  /** all tables of the world, for [[nested]] lookups */
  let cache = null;
  const tablesNow = async (force) => { if (!cache || force || cache.world !== WB.worldId) cache = { world: WB.worldId, list: await WB.api('toolkit.tables', WB.worldId).catch(() => []) }; return cache.list; };
  const lookupIn = list => name => { const n = name.toLowerCase(); return list.find(t => t.title.toLowerCase() === n || (t.aliases || []).some(a => a.toLowerCase() === n)) || null; };
  /** rolls a table entry (by id or object) with nesting; used by other tools too */
  TK.rollTable = async (t) => { const list = await tablesNow(); const tb = typeof t === 'string' ? list.find(x => x.id === t) : t; return tb ? G().rollTable(tb, { lookup: lookupIn(list) }) : null; };

  TK.tools.tables = {
    async mount(host, { store, params }) {
      const mine = await TK.mine();
      let sel = params.entryId || mine.tableId || null, table = null, rows = [];
      const offs = [];
      const side = TK.entryList({ typeKey: 'table', selected: sel, newLabel: 'New table', onNew: () => newTable(), onSelect: e => select(e.id),
        sub: e => e.summary || '', empty: { text: 'No random tables yet.' } });
      const main = h('div.tl-tables-main');
      const sideCard = h('aside.gk-panel.tl-side', [h('div.gk-panel-head', [h('span.gk-ico', { text: '☷' }), h('h3', { text: 'Random tables' }), side.count,
        WB.share ? null : ui.button({ icon: '⇪', small: true, kind: 'ghost', title: 'Import a table from a JSON file', onClick: () => importTable() })]), h('div.gk-panel-body', [side.el])]);
      host.appendChild(h('div.tl-split', [sideCard, main]));

      async function newTable(fromRows, title) {
        const t = WB.type('table'); if (!t) return ui.toast('This world has no Random table type', '⚠');
        const e = await WB.api('entries.create', { worldId: WB.worldId, typeId: t.id, title: title || 'New table', fields: { dice: '' }, data: { rows: fromRows || [{ text: '', weight: 1 }, { text: '', weight: 1 }, { text: '', weight: 1 }] } });
        await side.refresh(); side.select(e.id); await select(e.id, true);
        WB.ui.undoToast('Made “' + e.title + '”', () => WB.api('entries.purge', e.id));
        return e;
      }
      async function importTable() {
        try {
          const obj = await GK.host('file:openJson');
          if (!obj) return;
          const src = Array.isArray(obj) ? { rows: obj } : obj;
          const list = (src.rows || []).map(r => (typeof r === 'string' ? { text: r, weight: 1 } : { text: String(r.text || r.result || ''), weight: r.weight != null ? +r.weight || 1 : 1, range: G().parseRange(r.range) || undefined })).filter(r => r.text);
          if (!list.length) throw new Error('That file has no rows (expected { title, dice, rows: [{ text, weight }] } or a list of strings).');
          await newTable(list, src.title || 'Imported table');
          if (src.dice && table) { await setField('dice', String(src.dice)); paint(); }
        } catch (e) { WB.fail(e); }
      }

      async function select(id, focusTitle) {
        if (dirty) saveNow.flush();
        sel = id; TK.setMine({ tableId: id });
        GK.clear(main);
        if (!id) return paintEmpty();
        try { table = await WB.api('entries.get', id); } catch { table = null; }
        if (!table || table.deletedAt || !WB.visible(table)) { sel = null; table = null; return paintEmpty(); }
        rows = Array.isArray(table.data.rows) ? table.data.rows.map(r => Object.assign({}, r)) : [];
        paint(focusTitle);
      }
      function paintEmpty() {
        GK.clear(main);
        main.appendChild(TK.card({ body: WB.ui.empty({ icon: '☷', title: side.list().length ? 'Pick a table' : 'Make your first random table',
          text: 'Weighted lists or dice tables (1d8, 2d6 …). A row can roll another table with [[Its name]], a number with {1d6} or pick one of {red|grey|black}.',
          actions: WB.share ? [] : [ui.button({ label: 'New table', icon: '＋', kind: 'primary', onClick: () => newTable() }), ui.button({ label: 'Paste a list…', icon: '⎘', onClick: () => pasteDialog(true) })] }) }));
      }

      /* ---- saving ---- */
      let dirty = false;
      const saveNow = WB.debounce(() => { dirty = false; if (table) WB.api('entries.update', table.id, { dataPatch: { rows } }).catch(WB.fail); }, 400);
      const saveRows = () => { dirty = true; saveNow(); };
      const setField = (k, v) => { table.fields[k] = v; return WB.api('entries.update', table.id, { fieldsPatch: { [k]: v } }).catch(WB.fail); };

      /* ---- the table page ---- */
      let resultBox, rowsBox, oddsCells = [], rowEls = [], paintHist = () => {};
      function paint(focusTitle) {
        GK.clear(main);
        const ro = WB.share;
        const titleIn = ui.input({ value: table.title, placeholder: 'Table name' });
        titleIn.classList.add('tl-table-title');
        titleIn.readOnly = ro;
        const saveTitle = WB.debounce(v => WB.api('entries.update', table.id, { title: v.trim() || 'Untitled table' }).then(() => side.refresh()).catch(WB.fail), 500);
        titleIn.addEventListener('input', () => saveTitle(titleIn.value));
        const diceIn = ui.input({ value: table.fields.dice || '', placeholder: 'None: pick by weight' });
        diceIn.classList.add('tl-mono'); diceIn.readOnly = ro;
        const diceHint = h('span.gk-tiny.gk-muted.tl-dice-hint');
        const paintDiceHint = () => { const d = diceIn.value.trim(); diceHint.textContent = !d ? 'Rows are picked by their weight.' : WB.dice.valid(d) ? 'Rows take ranges of ' + WB.dice.range(d).min + '–' + WB.dice.range(d).max + '.' : 'That is not a dice roll.'; diceHint.classList.toggle('bad', !!d && !WB.dice.valid(d)); };
        diceIn.addEventListener('input', WB.debounce(() => { paintDiceHint(); const d = diceIn.value.trim(); if (!d || WB.dice.valid(d)) { setField('dice', d); paintRows(); } }, 350));
        const types = WB.typeList().filter(t => t.key !== 'table');
        const createSel = ui.select({ value: table.fields.creates || '', options: [['', 'Notes (default)']].concat(types.map(t => [t.key, t.icon + '  ' + t.plural])), onChange: v => setField('creates', v) });
        if (ro) createSel.disabled = true;
        paintDiceHint();
        const head = h('section.gk-widget.tl-table-head', [
          h('div.tl-table-headrow', [h('span.tl-hero-ico', { text: '☷' }), h('div.gk-grow', [titleIn, table.summary ? h('div.gk-small.gk-muted.tl-table-sum', { text: table.summary }) : null]),
            h('div.gk-row.nowrap', [
              ui.button({ icon: '↗', small: true, kind: 'ghost', title: 'Open the entry', onClick: () => WB.open(table.id) }),
              ui.button({ icon: '⎘', small: true, kind: 'ghost', title: 'Copy the table as text', onClick: () => TK.copy(asText(), 'Table') }),
              ui.button({ icon: '⇩', small: true, kind: 'ghost', title: 'Export as a JSON file', onClick: () => GK.host('file:saveJson', (table.title || 'table') + '.json', { format: 'worldbuilder-table', title: table.title, dice: table.fields.dice || '', rows }).then(p => p && ui.toast('Saved', '⇩')) }),
              ro ? null : ui.button({ icon: '🗑', small: true, kind: 'ghost', title: 'Move this table to the trash', onClick: async () => { await WB.ui.confirmTrash(table); await side.refresh(); select(null); } }),
            ])]),
          h('div.tl-table-opts', [ui.field({ label: 'Dice', control: h('div.tl-tight', [diceIn, diceHint]) }), ui.field({ label: 'Results become', control: createSel })]),
        ]);

        /* roll */
        const many = ui.input({ type: 'number', value: store.get().tablesMany || 5 }); many.min = 2; many.max = 50; many.classList.add('tl-many');
        many.addEventListener('change', () => store.patch({ tablesMany: Math.max(2, Math.min(50, +many.value || 5)) }));
        resultBox = h('div.tl-table-result', { 'aria-live': 'polite' });
        const histBox = h('div.tl-table-hist');
        const rollBtn = ui.button({ label: 'Roll', icon: '⚄', kind: 'primary', title: 'Roll on this table (R)', onClick: () => roll() });
        rollBtn.classList.add('tl-table-roll');
        const rollCard = TK.card({ cls: 'tl-table-rollcard', body: [
          h('div.tl-table-rollrow', [rollBtn,
            ui.group([many, ui.button({ label: 'Roll many', small: true, title: 'Roll several times and list them', onClick: () => rollMany(Math.max(2, Math.min(50, +many.value || 5))) })]),
            h('span.gk-grow'), h('span.gk-tiny.gk-muted', [WB.ui.kbd('R'), ' roll'])]),
          resultBox, histBox,
        ] });
        paintHist = () => {
          GK.clear(histBox);
          const list = (recent[table.id] || []).slice(1, 7);
          if (list.length) histBox.append(h('div.gk-tiny.gk-muted.tl-hist-day', { text: 'Earlier' }), ...list.map(r => h('div.tl-table-past.gk-small', [h('span.tl-num', { text: r.total != null ? String(r.total) : '#' + (r.index + 1) }), h('span', { text: r.text })])));
        };

        /* rows */
        rowsBox = h('div.tl-rows', { role: 'list' });
        const rowsCard = TK.card({ title: 'Rows', icon: '≡', sub: 'Roll another table with [[Its name]], a number with {1d6}, one of several with {red|grey}.', body: [
          h('div.tl-rows-head.gk-tiny.gk-muted', [h('span'), h('span', { text: table.fields.dice ? 'Range' : 'Weight' }), h('span', { text: 'Result' }), h('span', { text: 'Chance' }), h('span')]),
          rowsBox,
          ro ? null : h('div.tl-rows-foot', [
            ui.button({ label: 'Add row', icon: '＋', small: true, onClick: () => { rows.push({ text: '', weight: 1 }); saveRows(); paintRows(rows.length - 1); } }),
            ui.button({ label: 'Paste a list…', icon: '⎘', small: true, kind: 'ghost', onClick: () => pasteDialog(false) }),
            table.fields.dice ? ui.button({ label: 'Spread ranges', icon: '⇵', small: true, kind: 'ghost', title: 'Give every row a range that fits the dice, by weight', onClick: () => { const rs = G().autoRanges(rows, table.fields.dice); rows.forEach((r, i) => { r.range = rs[i]; }); saveRows(); paintRows(); } }) : null,
            h('span.gk-grow'), h('span.gk-tiny.gk-muted', [WB.ui.kbd('Enter'), ' new row · ', WB.ui.kbd('Alt+↑↓'), ' move'])])] });
        main.append(head, h('div.tl-table-body', [rollCard, rowsCard]));
        paintRows();
        const last = (recent[table.id] || [])[0];
        if (last) showResult(last, false); else resultBox.appendChild(h('div.gk-muted.tl-table-placeholder', { text: rows.some(r => (r.text || '').trim()) ? 'Roll to see what comes up.' : 'Add a few rows, then roll.' }));
        paintHist();
        if (focusTitle && !ro) setTimeout(() => { titleIn.focus(); titleIn.select(); }, 40);
      }
      function asText() { const rs = table.fields.dice ? G().rangesOf(rows, table.fields.dice) || [] : null; return [table.title + (table.fields.dice ? ' (' + table.fields.dice + ')' : '')].concat(rows.map((r, i) => (rs ? G().rangeText(rs[i]) + '  ' : (r.weight != null && +r.weight !== 1 ? '×' + r.weight + '  ' : '• ')) + r.text)).join('\n'); }

      function paintRows(focusIndex) {
        GK.clear(rowsBox);
        const ro = WB.share, dice = table.fields.dice && WB.dice.valid(table.fields.dice) ? table.fields.dice : '';
        const ranges = dice ? G().rangesOf(rows, dice) : null;
        const odds = G().odds({ dice, rows });
        oddsCells = []; rowEls = [];
        rows.forEach((r, i) => {
          const text = ui.input({ value: r.text || '', placeholder: 'What happens…' });
          text.classList.add('tl-row-text'); text.readOnly = ro;
          text.addEventListener('input', () => { rows[i].text = text.value; saveRows(); suggest(text, i); });
          text.addEventListener('keydown', e => {
            if (e.key === 'Enter' && !document.querySelector('.wb-pop[data-group="tl-nest"]')) { e.preventDefault(); rows.splice(i + 1, 0, { text: '', weight: 1 }); saveRows(); paintRows(i + 1); }
            else if (e.key === 'Backspace' && !text.value && rows.length > 1) { e.preventDefault(); rows.splice(i, 1); saveRows(); paintRows(Math.max(0, i - 1)); }
            else if (e.altKey && (e.key === 'ArrowUp' || e.key === 'ArrowDown')) { e.preventDefault(); const j = i + (e.key === 'ArrowUp' ? -1 : 1); if (j >= 0 && j < rows.length) { const [m] = rows.splice(i, 1); rows.splice(j, 0, m); saveRows(); paintRows(j); } }
            else if (e.key === 'ArrowDown') { const n = rowsBox.querySelectorAll('.tl-row-text')[i + 1]; if (n) { e.preventDefault(); n.focus(); } }
            else if (e.key === 'ArrowUp') { const p = rowsBox.querySelectorAll('.tl-row-text')[i - 1]; if (p) { e.preventDefault(); p.focus(); } }
          });
          let weightCtl;
          if (dice) {
            const own = G().parseRange(r.range);
            weightCtl = ui.input({ value: own ? G().rangeText(own) : '', placeholder: ranges && ranges[i] ? G().rangeText(ranges[i]) : '1–2' });
            weightCtl.title = 'Dice range, e.g. 1-3 (empty: spread by weight)';
            weightCtl.addEventListener('change', () => { const v = weightCtl.value.trim(); const pr = G().parseRange(v); if (!v) delete rows[i].range; else if (pr) rows[i].range = pr; else { weightCtl.classList.add('bad'); return; } weightCtl.classList.remove('bad'); saveRows(); paintRows(); });
          } else {
            weightCtl = ui.input({ type: 'number', value: r.weight == null ? 1 : r.weight });
            weightCtl.min = 0; weightCtl.title = 'Weight: how likely this row is compared to the others';
            weightCtl.addEventListener('input', () => { rows[i].weight = Math.max(0, +weightCtl.value || 0); saveRows(); paintOdds(); });
          }
          weightCtl.classList.add('tl-row-w'); weightCtl.readOnly = ro;
          const odd = h('span.tl-row-odds.gk-tiny.gk-muted', { text: pct(odds[i] || 0), title: 'Chance of this row' });
          oddsCells.push(odd);
          const handle = h('span.tl-row-handle', ro ? {} : { text: '⋮⋮', title: 'Drag to reorder (or Alt+↑/↓)' });
          const el = h('div.tl-row', { role: 'listitem', dataset: { i: String(i) } }, [handle, weightCtl, text, odd,
            ro ? h('span') : ui.button({ icon: '✕', small: true, kind: 'ghost', title: 'Remove this row', onClick: () => { const old = rows.slice(); rows.splice(i, 1); saveRows(); paintRows(); WB.ui.undoToast('Row removed', () => { rows = old; saveRows(); paintRows(); }); } })]);
          if (!ro) dragRow(handle, el, i);
          rowEls.push(el);
          rowsBox.appendChild(el);
        });
        if (!rows.length) rowsBox.appendChild(h('div.gk-small.gk-muted.tl-pad', { text: 'No rows yet.' }));
        const last = (recent[table.id] || [])[0];
        if (last && rowEls[last.index]) rowEls[last.index].classList.add('hit');
        if (focusIndex != null) { const t = rowsBox.querySelectorAll('.tl-row-text')[focusIndex]; if (t) t.focus(); }
      }
      function paintOdds() { const dice = table.fields.dice && WB.dice.valid(table.fields.dice) ? table.fields.dice : ''; const o = G().odds({ dice, rows }); oddsCells.forEach((c, i) => { c.textContent = pct(o[i] || 0); }); }
      /** drag the handle up or down; rows are compared in screen space, nothing is placed from the pointer */
      function dragRow(handle, el, i) {
        handle.addEventListener('pointerdown', e => {
          if (e.button !== 0) return;
          e.preventDefault(); handle.setPointerCapture(e.pointerId);
          el.classList.add('dragging');
          let to = i;
          const move = ev => {
            const mids = rowEls.map(r => { const b = r.getBoundingClientRect(); return b.top + b.height / 2; });
            let k = mids.findIndex(m => ev.clientY < m); if (k < 0) k = rows.length;
            to = k > i ? k - 1 : k;
            rowEls.forEach((r, j) => { r.classList.toggle('drop-before', to !== i && j === k && k < rows.length); r.classList.toggle('drop-after', to !== i && k === rows.length && j === rows.length - 1); });
          };
          const up = () => {
            handle.removeEventListener('pointermove', move); handle.removeEventListener('pointerup', up); handle.removeEventListener('pointercancel', up);
            el.classList.remove('dragging'); rowEls.forEach(r => r.classList.remove('drop-before', 'drop-after'));
            if (to !== i && to >= 0) { const [m] = rows.splice(i, 1); rows.splice(to, 0, m); saveRows(); paintRows(); }
          };
          handle.addEventListener('pointermove', move); handle.addEventListener('pointerup', up); handle.addEventListener('pointercancel', up);
        });
      }
      /** typing [[ suggests table names */
      async function suggest(input, i) {
        const pos = input.selectionStart || 0, before = input.value.slice(0, pos), m = /\[\[([^\]]*)$/.exec(before);
        WB.ui.closePopovers('tl-nest');
        if (!m) return;
        const list = (await tablesNow()).filter(t => t.id !== table.id && t.title.toLowerCase().includes(m[1].toLowerCase())).slice(0, 8);
        if (!list.length) return;
        WB.ui.menu(list.map(t => ({ label: t.title, icon: '☷', hint: t.rows.length + ' rows', onClick: () => {
          const v = input.value, start = pos - m[1].length;
          input.value = v.slice(0, start) + t.title + ']]' + v.slice(pos).replace(/^\]\]/, '');
          rows[i].text = input.value; saveRows(); input.focus();
          const c = start + t.title.length + 2; input.setSelectionRange(c, c);
        } })), input, { group: 'tl-nest' });
        setTimeout(() => input.focus(), 0);
      }
      async function pasteDialog(asNew) {
        const ta = ui.input({ multiline: true, rows: 10, placeholder: 'One row per line.\n1-3 Fog rolls in      (dice ranges)\nA smuggler x3        (a weight)\nA quiet night        (weight 1)' });
        let mode = 'append';
        const seg = asNew ? null : ui.segmented({ value: mode, options: [['append', 'Add to the rows'], ['replace', 'Replace the rows']], onChange: v => { mode = v; } });
        const ok = await ui.dialog({ title: asNew ? 'A table from a list' : 'Paste a list', icon: '⎘', body: h('div.gk-stack.tl-paste', [ta, seg, h('p.gk-tiny.gk-muted', { text: 'Lines starting with numbers or ranges become dice ranges; “x3” or “(3)” at the end sets a weight.' })]), actions: [{ label: 'Cancel', value: false }, { label: asNew ? 'Make table' : 'Add rows', kind: 'primary', value: true }] });
        if (!ok || !ta.value.trim()) return;
        const parsed = G().parseRows(ta.value);
        const ranged = parsed.filter(r => r.range);
        const guessDice = () => { const max = Math.max(...ranged.map(r => r.range[1])); const d = [4, 6, 8, 10, 12, 20, 100].find(n => n >= max) || max; return '1d' + (d === 100 ? '%' : d); };
        if (asNew) { const e = await newTable(parsed, 'New table'); if (e && ranged.length) { await setField('dice', guessDice()); paint(true); } return; }
        const old = rows.slice();
        rows = mode === 'replace' ? parsed : rows.filter(r => (r.text || '').trim()).concat(parsed);
        saveRows();
        if (ranged.length && !table.fields.dice) { await setField('dice', guessDice()); paint(); } else paintRows();
        WB.ui.undoToast(parsed.length + ' rows added', () => { rows = old; saveRows(); paintRows(); });
      }

      /* ---- rolling ---- */
      async function roll() {
        if (!table) return null;
        if (!rows.some(r => (r.text || '').trim())) { ui.toast('This table has no rows yet', 'ℹ'); return null; }
        const list = await tablesNow(true);
        const me = Object.assign({}, list.find(t => t.id === table.id) || {}, { title: table.title, dice: table.fields.dice || '', rows });
        const r = G().rollTable(me, { lookup: lookupIn(list) });
        r.at = new Date().toISOString();
        (recent[table.id] = recent[table.id] || []).unshift(r);
        recent[table.id] = recent[table.id].slice(0, 20);
        showResult(r, true);
        paintHist();
        if (TK.logToSession) { const m = await TK.mine(); if (m.sessionId && m.autoLog) TK.logToSession({ kind: 'roll', text: table.title + ': ' + r.text }); }
        return r;
      }
      function showResult(r, flash) {
        GK.clear(resultBox);
        const count = (recent[table.id] || []).length;
        resultBox.append(...[
          h('div.tl-table-result-head.gk-tiny.gk-muted', { text: (r.total != null ? 'Rolled ' + r.total + ' on ' + table.fields.dice : 'Row ' + (r.index + 1) + ' of ' + rows.length) + (count > 1 ? ' · roll ' + count : '') }),
          h('div.tl-table-result-text', { text: r.text }),
          r.nested.length ? h('div.tl-nested', r.nested.map(n => h('span.tl-nested-chip.gk-small', [h('span.gk-muted', { text: '↳ ' + n.title + ': ' }), h('span', { text: n.text })]))) : null,
          h('div.tl-table-result-actions', [
            ui.button({ icon: '⎘', label: 'Copy', small: true, kind: 'ghost', onClick: () => TK.copy(r.text, 'Result') }),
            WB.share ? null : ui.button({ icon: '＋', label: 'Make it an entry', small: true, kind: 'ghost', title: 'Create a ' + ((WB.type(table.fields.creates || 'note') || {}).name || 'note').toLowerCase() + ' from this result', onClick: () => makeEntry(r) }),
            ui.button({ icon: '⚄', label: 'Again', small: true, kind: 'ghost', onClick: () => roll() }),
          ]),
        ].filter(Boolean));
        rowEls.forEach((el, i) => el.classList.toggle('hit', i === r.index));
        if (flash && rowEls[r.index]) { const el = rowEls[r.index]; el.classList.remove('flash'); void el.offsetWidth; el.classList.add('flash'); }
        if (flash) { resultBox.classList.remove('pop'); void resultBox.offsetWidth; resultBox.classList.add('pop'); }
      }
      async function rollMany(n) {
        const out = [];
        for (let i = 0; i < n; i++) { const r = await roll(); if (!r) return; out.push(r); }
        const text = out.map((r, i) => (i + 1) + '. ' + r.text).join('\n');
        const copyBtn = ui.button({ label: 'Copy all', icon: '⎘', onClick: () => TK.copy(text, n + ' results') });
        setTimeout(() => { const foot = [...document.querySelectorAll('.gk-dialog .gk-panel-foot')].pop(); if (foot) foot.prepend(copyBtn); }, 0);
        ui.dialog({ title: n + ' rolls on ' + table.title, icon: '⚄', body: h('ol.tl-many-list', out.map(r => h('li', { text: r.text }))), actions: [{ label: 'Close', kind: 'primary', value: false }] });
      }
      async function makeEntry(r) {
        const key = table.fields.creates || 'note', t = WB.type(key) || WB.type('note');
        const first = r.text.split(/(?<=[.!?])\s|:\s|\s—\s/)[0].replace(/[.!?]$/, '').slice(0, 90);
        const e = await WB.api('entries.create', { worldId: WB.worldId, typeId: t.id, title: first || table.title, body: '<p>' + WB.esc(r.text) + '</p><p><em>Rolled on </em><a class="wb-m" data-id="' + table.id + '">' + WB.esc(table.title) + '</a>' + (r.total != null ? ' (' + r.total + ')' : '') + '</p>' });
        TK.toast('Made ' + t.name.toLowerCase() + ' “' + e.title + '”', [{ label: 'Open', onClick: () => WB.open(e.id) }, { label: 'Undo', onClick: () => WB.api('entries.purge', e.id) }]);
      }

      /* ---- wiring ---- */
      const list = await side.refresh();
      if (sel && !list.find(e => e.id === sel)) sel = null;
      if (!sel && list[0]) sel = list[0].id;
      side.select(sel);
      await select(sel);
      offs.push(WB.onChange(['entries'], async p => {
        cache = null;
        await side.refresh();
        if (table && (p.ids || []).includes(table.id)) {
          const fresh = await WB.api('entries.get', table.id).catch(() => null);
          if (!fresh || fresh.deletedAt) return select(null);
          const same = JSON.stringify(rows) === JSON.stringify(fresh.data.rows || []);
          if (!same && !main.contains(document.activeElement)) { table = fresh; rows = (fresh.data.rows || []).map(r => Object.assign({}, r)); paint(); }
          else { table.title = fresh.title; table.fields = fresh.fields; table.summary = fresh.summary; }
        }
      }));
      offs.push(TK.keys(host, e => { if (TK.isTyping(e) || e.ctrlKey || e.altKey || e.metaKey) return; if (e.key === 'r' || e.key === 'R') { e.preventDefault(); roll(); } }));
      return () => { offs.forEach(f => f()); if (dirty) saveNow.flush(); WB.ui.closePopovers('tl-nest'); };
    },
  };
})();
