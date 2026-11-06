/* Web → Relations: every explicit relation in one table — sort, filter, edit notes and dates in place, change the
   kind, swap direction, delete with Undo, select several for bulk changes, and a view grouped by category. */
(function () {
  'use strict';
  const { h, ui } = GK, U = WB.ui;
  const P = WB.webParts;
  const DEFAULTS = { sort: 'from', dir: 1, group: false, cats: [], relId: '', collapsed: [] };
  const PAGE = 150;

  P.relations = async function mount(host, env) {
    const C = P.common;
    const st = Object.assign({}, DEFAULTS, env.store.get().relations || {});
    const save = () => env.store.patch({ relations: { sort: st.sort, dir: st.dir, group: st.group, cats: st.cats, relId: st.relId, collapsed: st.collapsed } });
    let rows = [], q = '', who = (env.params && env.params.entryId) || null, picked = new Set(), limit = PAGE, alive = true;
    const edit = C.editable();

    const searchBox = U.search({ placeholder: 'Filter by name, relation or note (Ctrl+F)', onInput: v => { q = v; limit = PAGE; paint(); } });
    const typeSel = h('span');
    const catBox = h('div.wb-chips');
    const whoSlot = C.slot({ id: who, placeholder: 'Anyone', title: 'Only relations of…', onPick: e => { who = e && e.id; limit = PAGE; paint(); } });
    const groupT = h('label.web-toggle-row.inline', [h('span', { text: 'By kind' }), ui.toggle({ value: st.group, onChange: v => { st.group = v; save(); paint(); } })]);
    const addBtn = edit ? ui.button({ label: 'Add relation', icon: '＋', kind: 'primary', onClick: () => C.addRelation({ a: who }) }) : null;
    const bar = ui.panel({ cls: 'web-rbar', body: [h('div.web-rbar-row', [h('div.web-rbar-search', [searchBox]), typeSel, h('div.web-rbar-who', [h('span.gk-small.gk-muted', { text: 'Involving' }), whoSlot]), groupT, h('span.gk-grow'), addBtn]), catBox] });
    const bulk = h('div.web-bulk.gk-widget.gk-nolens.gk-dialog', { hidden: true, role: 'toolbar', 'aria-label': 'Selected relations' });
    const table = h('div.web-rtable', { role: 'table' });
    const list = ui.panel({ cls: 'web-rpanel', body: [table] });
    const root = h('div.web-relations', [bar, list, bulk]);
    host.appendChild(root);

    async function load() {
      const all = await WB.api('links.relations', WB.worldId);
      if (!alive) return;
      rows = all.filter(r => { const a = WB.liteOf(r.src), b = WB.liteOf(r.dst); return a && b && WB.visible(a) && WB.visible(b); });
      for (const id of [...picked]) if (!rows.some(r => r.id === id)) picked.delete(id);
      paintFilters(); paint();
    }
    function paintFilters() {
      GK.clear(typeSel);
      const used = new Map();
      for (const r of rows) used.set(r.relId, (used.get(r.relId) || 0) + 1);
      typeSel.appendChild(ui.select({ value: st.relId, options: [['', 'Every kind of relation']].concat(WB.relTypes.filter(r => used.has(r.id)).map(r => [r.id, r.name + (r.symmetric ? '' : ' / ' + r.inverse) + '  (' + used.get(r.id) + ')'])), onChange: v => { st.relId = v; save(); limit = PAGE; paint(); } }));
      GK.clear(catBox);
      const cc = {};
      for (const r of rows) cc[r.category] = (cc[r.category] || 0) + 1;
      for (const [c, label] of C.CATS) {
        if (!cc[c]) continue;
        const on = st.cats.includes(c);
        catBox.appendChild(h('button.web-chip', { type: 'button', class: on ? 'on' : '', 'aria-pressed': String(on), style: { '--c': C.CAT_COLOR[c] }, title: on ? 'Show every kind again' : 'Only ' + label.toLowerCase() + ' relations', onclick: () => { st.cats = on ? st.cats.filter(x => x !== c) : st.cats.concat(c); save(); limit = PAGE; paintFilters(); paint(); } }, [h('span.web-chip-dot'), h('span', { text: label }), h('span.web-chip-n', { text: String(cc[c]) })]));
      }
      if (st.cats.length) catBox.appendChild(ui.button({ label: 'All kinds', small: true, kind: 'ghost', onClick: () => { st.cats = []; save(); paintFilters(); paint(); } }));
    }
    const tA = r => WB.titleOf(r.src), tB = r => WB.titleOf(r.dst);
    function filtered() {
      const ql = q.trim().toLowerCase();
      return rows.filter(r => (!st.relId || r.relId === st.relId) && (!st.cats.length || st.cats.includes(r.category)) && (!who || r.src === who || r.dst === who)
        && (!ql || [tA(r), tB(r), r.name, r.inverse, r.note].some(s => String(s || '').toLowerCase().includes(ql))));
    }
    const KEYS = {
      from: r => tA(r).toLowerCase(), rel: r => (r.name || '').toLowerCase(), to: r => tB(r).toLowerCase(), cat: r => C.CATS.findIndex(c => c[0] === r.category),
      when: r => (r.startDay == null ? (r.endDay == null ? Infinity : r.endDay) : r.startDay), note: r => (r.note || '~').toLowerCase(),
    };
    function sorted(list) {
      const k = KEYS[st.sort] || KEYS.from;
      return list.slice().sort((a, b) => { const x = k(a), y = k(b); return (x < y ? -1 : x > y ? 1 : 0) * st.dir || tA(a).localeCompare(tA(b)); });
    }
    const COLS = [['sel', ''], ['from', 'From'], ['rel', 'Relation'], ['to', 'To'], ['cat', 'Kind'], ['when', 'When'], ['note', 'Note'], ['act', '']];
    function header() {
      return h('div.web-rrow.web-rhead', { role: 'row' }, COLS.map(([k, label]) => {
        if (k === 'sel') return h('span.web-rcell.sel', { role: 'columnheader' }, edit ? [checkbox(allPicked(), v => { const vis = sorted(filtered()); if (v) vis.forEach(r => picked.add(r.id)); else picked.clear(); paint(); }, 'Select every relation shown')] : []);
        if (k === 'act') return h('span.web-rcell', { role: 'columnheader' });
        const on = st.sort === k;
        return h('button.web-rcell.web-rsort', { type: 'button', role: 'columnheader', class: on ? 'on' : '', 'aria-sort': on ? (st.dir > 0 ? 'ascending' : 'descending') : 'none', title: 'Sort by ' + label.toLowerCase(), onclick: () => { if (st.sort === k) st.dir = -st.dir; else { st.sort = k; st.dir = 1; } save(); paint(); } }, [label, on ? h('span.web-rsort-ico', { text: st.dir > 0 ? ' ▲' : ' ▼' }) : null]);
      }));
    }
    const allPicked = () => { const vis = filtered(); return vis.length > 0 && vis.every(r => picked.has(r.id)); };
    function checkbox(on, onChange, title) {
      const b = h('button.web-check', { type: 'button', role: 'checkbox', 'aria-checked': String(!!on), class: on ? 'on' : '', title: title || 'Select', text: on ? '✓' : '' });
      b.addEventListener('click', ev => {
        ev.stopPropagation();
        const v = !b.classList.contains('on');
        b.classList.toggle('on', v); b.textContent = v ? '✓' : ''; b.setAttribute('aria-checked', String(v));
        onChange(v);
      });
      return b;
    }
    function row(r) {
      const sym = WB.rel(r.relId) && WB.rel(r.relId).symmetric;
      const relBtn = h('button.web-relword', { type: 'button', style: { '--c': r.color || C.CAT_COLOR[r.category] }, title: edit ? 'Change the kind of relation' : r.name, disabled: !edit }, [r.name]);
      if (edit) relBtn.addEventListener('click', ev => typeMenu(r, relBtn));
      const span = C.linkSpan(r);
      const when = h('button.web-when', { type: 'button', class: span ? '' : 'empty', disabled: !edit, title: edit ? 'Set when it began and ended' : '' }, [span || (edit ? 'add dates' : '')]);
      if (edit) when.addEventListener('click', () => datePop(r, when));
      const note = noteCell(r);
      const el = h('div.web-rrow', { role: 'row', class: picked.has(r.id) ? 'picked' : '', dataset: { id: r.id } }, [
        h('span.web-rcell.sel', edit ? [checkbox(picked.has(r.id), v => { if (v) picked.add(r.id); else picked.delete(r.id); el.classList.toggle('picked', v); paintBulk(); paintHeadCheck(); })] : []),
        h('span.web-rcell', [U.chip(r.src, { size: 'sm' })]),
        h('span.web-rcell', [relBtn, sym ? h('span.gk-faint.gk-tiny', { text: ' ⇄', title: 'Works both ways' }) : null]),
        h('span.web-rcell', [U.chip(r.dst, { size: 'sm' })]),
        h('span.web-rcell.gk-small', [h('span.web-catdot', { style: { '--c': C.CAT_COLOR[r.category] } }), C.catName(r.category)]),
        h('span.web-rcell', [when]),
        h('span.web-rcell.web-rnote', [note]),
        h('span.web-rcell.web-racts', edit ? [
          !sym ? ui.button({ icon: '⇄', small: true, kind: 'ghost', title: 'Swap direction: ' + tB(r) + ' ' + r.name + ' ' + tA(r), onClick: () => swap(r) }) : null,
          ui.button({ icon: '✕', small: true, kind: 'ghost', title: 'Delete this relation (Undo in the toast)', onClick: () => C.removeRelation(r).catch(WB.fail) }),
        ] : []),
      ]);
      el.addEventListener('contextmenu', ev => { if (ev.target.closest('.wb-chip')) return; ev.preventDefault(); rowMenu(r, ev); });
      return el;
    }
    /** the note reads as text; a click turns it into a field (Enter or leaving saves, Esc cancels) */
    function noteCell(r) {
      if (!edit) return h('span.gk-small.web-note-text', { text: r.note || '' });
      const btn = () => {
        const b = h('button.web-note-btn', { type: 'button', class: r.note ? '' : 'empty', title: r.note ? 'Edit the note' : 'Add a note' }, [r.note || 'add a note']);
        b.addEventListener('click', () => {
          const inp = ui.input({ value: r.note || '', placeholder: 'A note about this relation' });
          inp.classList.add('web-note');
          let closed = false;
          const done = keep => {
            if (closed) return; closed = true;
            if (keep && inp.value.trim() !== (r.note || '')) { r.note = inp.value.trim(); WB.api('links.update', r.id, { note: r.note }).catch(WB.fail); }
            const nb = btn(); inp.replaceWith(nb); if (!keep) nb.focus();
          };
          inp.addEventListener('keydown', e => { if (e.key === 'Enter') { e.preventDefault(); done(true); } else if (e.key === 'Escape') { e.preventDefault(); e.stopPropagation(); done(false); } });
          inp.addEventListener('blur', () => done(true));
          b.replaceWith(inp); inp.focus(); inp.select();
        });
        return b;
      };
      return btn();
    }
    function paintHeadCheck() { const hc = table.querySelector('.web-rhead .web-check'); if (hc) { const on = allPicked(); hc.classList.toggle('on', on); hc.textContent = on ? '✓' : ''; hc.setAttribute('aria-checked', String(on)); } }
    async function swap(r) {
      await WB.api('links.update', r.id, { swap: true });
      U.undoToast('Swapped: ' + tB(r) + ' ' + r.name + ' ' + tA(r), () => WB.api('links.update', r.id, { swap: true }));
    }
    function typeItems(apply) {
      return C.CATS.map(([c, label]) => {
        const rs = WB.relTypes.filter(x => x.category === c);
        return rs.length ? { label, icon: '●', sub: rs.map(x => ({ label: x.name + (x.symmetric ? '' : '  ·  ' + x.inverse), onClick: () => apply(x) })) } : null;
      }).filter(Boolean);
    }
    function typeMenu(r, at) {
      U.menu([{ header: 'Change to' }].concat(typeItems(async x => {
        const old = r.relId;
        await WB.api('links.update', r.id, { relId: x.id });
        U.undoToast('Now: ' + tA(r) + ' ' + x.name + ' ' + tB(r), () => WB.api('links.update', r.id, { relId: old }));
      }), ['-', !(WB.rel(r.relId) || {}).symmetric ? { label: 'Swap direction', icon: '⇄', onClick: () => swap(r) } : null]), at);
    }
    function datePop(r, at) {
      const body = h('div.web-stack.web-date-pop', [
        h('div.gk-small', [h('b', { text: tA(r) }), ' ' + r.name + ' ', h('b', { text: tB(r) })]),
        h('div.wb-daterange', [
          ui.field({ label: 'From', control: U.dateInput({ value: C.dayDate(r.startDay), onChange: v => WB.api('links.update', r.id, { start: v }).catch(WB.fail) }) }),
          ui.field({ label: 'Until', control: U.dateInput({ value: C.dayDate(r.endDay), onChange: v => WB.api('links.update', r.id, { end: v }).catch(WB.fail) }) }),
        ]),
        h('p.gk-tiny.gk-muted', { text: 'Marriages, memberships, reigns, alliances… Leave empty when it has always been so.' }),
      ]);
      U.popover(at, body, { width: '24em', group: 'reldate' });
    }
    function rowMenu(r, ev) {
      U.menu([
        { label: 'Open ' + tA(r), icon: '↗', onClick: () => WB.open(r.src) },
        { label: 'Open ' + tB(r), icon: '↗', onClick: () => WB.open(r.dst) },
        { label: 'Show in the graph', icon: '◉', onClick: () => env.go('graph', { path: [r.src, r.dst] }) },
        (WB.rel(r.relId) || {}).familyRole ? { label: 'Family tree', icon: '⚭', onClick: () => env.go('family', { entryId: r.src }) } : null,
        edit ? '-' : null,
        edit ? { label: 'Change kind', icon: '☍', sub: typeItems(async x => { const old = r.relId; await WB.api('links.update', r.id, { relId: x.id }); U.undoToast('Changed to ' + x.name, () => WB.api('links.update', r.id, { relId: old })); }) } : null,
        edit && !(WB.rel(r.relId) || {}).symmetric ? { label: 'Swap direction', icon: '⇄', onClick: () => swap(r) } : null,
        edit ? { label: 'Delete', icon: '✕', danger: true, onClick: () => C.removeRelation(r) } : null,
      ].filter(Boolean), ev);
    }
    function paintBulk() {
      bulk.hidden = !picked.size || !edit;
      GK.clear(bulk);
      if (bulk.hidden) return;
      const sel = rows.filter(r => picked.has(r.id));
      bulk.append(
        h('b', { text: WB.fmt.plural(sel.length, 'relation') + ' selected' }),
        ui.button({ label: 'Change kind…', small: true, onClick: ev => U.menu(typeItems(async x => {
          const old = sel.map(r => [r.id, r.relId]);
          for (const r of sel) await WB.api('links.update', r.id, { relId: x.id });
          U.undoToast(WB.fmt.plural(sel.length, 'relation') + ' changed to ' + x.name, async () => { for (const [id, rel] of old) await WB.api('links.update', id, { relId: rel }); });
        }), ev.currentTarget) }),
        ui.button({ label: 'Delete', small: true, kind: 'danger', onClick: async () => {
          const gone = sel.slice();
          for (const r of gone) await WB.api('links.remove', r.id);
          picked.clear();
          const d = v => (v == null ? null : { day: v, min: null, prec: 'day' });
          U.undoToast(WB.fmt.plural(gone.length, 'relation') + ' deleted', async () => { for (const r of gone) await WB.api('links.relate', { src: r.src, dst: r.dst, relId: r.relId, note: r.note, start: d(r.startDay), end: d(r.endDay) }); });
        } }),
        ui.button({ label: 'Clear', small: true, kind: 'ghost', onClick: () => { picked.clear(); paint(); } }),
      );
    }
    function paint() {
      GK.clear(table);
      const vis = sorted(filtered());
      if (!rows.length) {
        table.appendChild(U.empty({ icon: '☍', title: 'No relations yet', text: 'Relations say how two entries stand to each other — parent of, ally of, lives in, rival of — with optional dates and a note. They feed the graph, the family tree and the kinship calculator.', actions: edit ? [ui.button({ label: 'Add the first relation', kind: 'primary', icon: '＋', onClick: () => C.addRelation({}) })] : [] }));
        paintBulk(); return;
      }
      table.appendChild(header());
      if (!vis.length) { table.appendChild(h('div.web-rnone.gk-muted', { text: 'No relation matches these filters.' })); paintBulk(); return; }
      if (st.group) {
        for (const [c, label] of C.CATS) {
          const part = vis.filter(r => r.category === c);
          if (!part.length) continue;
          const closed = st.collapsed.includes(c);
          const head = h('button.web-rgroup', { type: 'button', class: closed ? 'closed' : '', style: { '--c': C.CAT_COLOR[c] }, 'aria-expanded': String(!closed), onclick: () => { st.collapsed = closed ? st.collapsed.filter(x => x !== c) : st.collapsed.concat(c); save(); paint(); } }, [h('span.web-rgroup-car', { text: '▾' }), h('span.web-catdot'), h('b', { text: label }), h('span.gk-small.gk-muted', { text: ' ' + part.length })]);
          table.appendChild(head);
          if (!closed) part.slice(0, limit).forEach(r => table.appendChild(row(r)));
          if (!closed && part.length > limit) table.appendChild(more(part.length));
        }
      } else {
        vis.slice(0, limit).forEach(r => table.appendChild(row(r)));
        if (vis.length > limit) table.appendChild(more(vis.length));
      }
      table.appendChild(h('div.web-rfoot.gk-small.gk-muted', { text: vis.length === rows.length ? WB.fmt.plural(rows.length, 'relation') : vis.length + ' of ' + WB.fmt.plural(rows.length, 'relation') }));
      paintBulk();
    }
    const more = n => h('div.web-rmore', [ui.button({ label: 'Show ' + Math.min(PAGE, n - limit) + ' more of ' + n, small: true, onClick: () => { limit += PAGE; paint(); } })]);

    const reload = WB.debounce(() => load().catch(WB.fail), 150);
    const offs = [WB.onChange(['links', 'entries', 'rel_types'], reload)];
    const keys = ev => { if (!root.isConnected) return; if (ev.ctrlKey && !ev.shiftKey && ev.key.toLowerCase() === 'f') { ev.preventDefault(); const i = searchBox.querySelector('input'); i.focus(); i.select(); } };
    document.addEventListener('keydown', keys);
    await load();
    return () => { alive = false; offs.forEach(f => f()); document.removeEventListener('keydown', keys); };
  };
})();
