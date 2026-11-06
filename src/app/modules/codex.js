/* Codex: every entry. Sources (types, tags, collections, favourites, inbox, recent, trash) → a tree or list → the
   entry page (fields, text, relations, backlinks, maps, boards, history, tasks, versions). Everything autosaves. */
(function () {
  'use strict';
  const GK = window.GK, WB = window.WB, h = GK.h, ui = GK.ui;
  const SYMBOLS = '☺ ♛ ♚ ⚔ ⚑ ⌂ ♜ ⛫ ⚓ ⛵ ☠ ✝ ☥ ✡ ☪ ☯ ✶ ✷ ✸ ✦ ✧ ❖ ◆ ◇ ● ○ ■ □ ▲ △ ♠ ♣ ♥ ♦ ❦ ❧ ✿ ❀ ☘ ⚚ ⚕ ⚖ ⚗ ⚙ ⚒ ⛏ ⚡ ☄ ☀ ☾ ★ ☁ ❄ ☂ ♨ ✎ ✒ ✉ ⌛ ⏳ ♪ ♫ ⚄ ♞ ♟ ⛭ ⌖ ⌘ ⍟ ☍ ⚭ ∞ Ω Φ Ψ Δ Σ λ ℒ § ¶ ¤ ≈ ✚ ✪ ⬢ ⬡'.split(' ');
  let smokeResult = 'did not run';

  GK.modules.register({
    id: 'codex',
    title: 'Codex',
    icon: '❖',
    order: 20,
    heading: false,
    subtitle: 'Every character, place, faction and idea — linked.',
    async mount(page, ctx) {
      if (!WB.worldId) { page.appendChild(WB.ui.empty({ icon: '❖', title: 'No world yet', text: 'Create a world to start your codex.', actions: [ui.button({ label: 'Create a world', kind: 'primary', onClick: () => WB.newWorld() })] })); return; }
      const st = await WB.store(ctx, { source: { kind: 'all' }, sort: 'position', view: 'tree', collapsed: [], collapsedBy: {}, groupBy: {}, sources: true, last: null, table: false, tableHidden: {} });
      const S = st.get();
      // older saved state: the table was a switch of its own, now it is one of the four views
      if (S.table && S.view !== 'table' && S.view !== 'cards') st.patch({ view: 'table' });
      if (!['tree', 'list', 'cards', 'table'].includes(st.get().view)) st.patch({ view: 'tree' });
      const wide = () => st.get().view === 'table' || st.get().view === 'cards';
      const params = WB.params('codex') || {};
      let entries = [], selected = new Set(), current = null, q = '', destroyed = false, lastSave = 0, more = 400;
      let counts = {}, ctxIds = new Set(), dragIds = [], pendingFocus = null, anchor = null;
      // expansion state is remembered per world (everything open until you close it)
      const getCollapsed = () => new Set((st.get().collapsedBy || {})[WB.worldId] || []);
      const setCollapsed = set => st.patch({ collapsedBy: Object.assign({}, st.get().collapsedBy, { [WB.worldId]: [...set] }) });
      const offs = [];
      page.classList.add('cx-page');

      /* ---------------- layout ---------------- */
      const srcPane = h('nav.cx-sources.gk-panel', { 'aria-label': 'Sources' });
      const listPane = h('section.cx-list.gk-panel');
      const pagePane = h('section.cx-entry');
      const tablePane = h('section.cx-table.gk-panel', { dataset: { nativeScroll: '' } });
      const root = h('div.cx', { class: (S.sources ? '' : 'no-sources') + (wide() ? ' table-mode' : '') }, [srcPane, listPane, pagePane, tablePane]);
      page.appendChild(root);
      let tableSort = { key: null, dir: 1 };
      // the four ways to look at the same entries: Tree / List stay in the narrow list, Cards / Table fill the page
      const setView = v => {
        st.patch({ view: v, table: v === 'table' || v === 'cards' });
        paintViewSwitch();
        root.classList.toggle('table-mode', wide());
        if (wide()) paintTable(); else { GK.clear(tablePane); paintList(); }
      };
      const setTable = on => setView(on ? 'table' : 'tree');
      const viewHolder = h('span.cx-viewsw');
      const paintViewSwitch = () => { GK.clear(viewHolder); viewHolder.appendChild(viewSwitch()); };
      const viewSwitch = () => ui.segmented({ value: st.get().view, options: [['tree', 'Tree', 'Nested by what is inside what'], ['list', 'List', 'Flat list'], ['cards', 'Cards', 'A card for each entry'], ['table', 'Table', 'Fields as columns, editable in place']], onChange: setView });

      /* ---------------- sources ---------------- */
      async function paintSources() {
        const stats = await WB.api('worlds.stats', WB.worldId).catch(() => ({ byType: {} }));
        const cols = await WB.api('collections.list', WB.worldId).catch(() => []);
        if (destroyed) return;
        const src = st.get().source;
        const is = (kind, id) => src.kind === kind && (id == null || src.id === id);
        const pick = (kind, id) => { st.patch({ source: { kind, id } }); selected.clear(); paintSources(); loadList(); };
        const item = (kind, id, icon, label, count, color) => h('button.cx-src', { type: 'button', class: is(kind, id) ? 'on' : '', style: color ? { '--c': color } : null, title: label, onclick: () => pick(kind, id) },
          [h('span.cx-src-ico', { text: icon }), h('span.cx-src-lbl.gk-ellipsis', { text: label }), count != null ? h('span.cx-src-n', { text: WB.fmt.num(count) }) : null]);
        GK.clear(srcPane);
        GK.append(srcPane, [
          item('all', null, '❖', 'All entries', stats.entries),
          item('fav', null, '★', 'Favourites'),
          item('inbox', null, '✉', 'Inbox', stats.inbox || null),
          item('recent', null, '◷', 'Recently edited'),
          h('div.cx-src-head', [h('span', { text: 'Types' }), ui.button({ icon: '⚙', small: true, kind: 'ghost', title: 'Edit types and fields', onClick: () => WB.go('world', { tab: 'types' }) })]),
          ...WB.typeList().filter(t => stats.byType[t.id] || !['note', 'post', 'product', 'encounter', 'session', 'table', 'board'].includes(t.key)).map(t => item('type', t.id, t.icon, t.plural, stats.byType[t.id] || 0, t.color)),
          WB.tags.length ? h('div.cx-src-head', [h('span', { text: 'Tags' })]) : null,
          WB.tags.length ? h('div.cx-src-tags', WB.tags.map(t => h('button.wb-tagchip.tag.cx-tagbtn', { type: 'button', class: is('tag', t.id) ? 'on' : '', style: { '--c': t.color || 'var(--muted)' }, onclick: () => pick('tag', t.id) }, ['#' + t.name, h('span.gk-faint', { text: ' ' + t.count })]))) : null,
          h('div.cx-src-head', [h('span', { text: 'Collections' }), ui.button({ icon: '＋', small: true, kind: 'ghost', title: 'Save the current filter as a collection', onClick: saveCollection })]),
          ...cols.map(c => {
            const b = item('col', c.id, c.icon || '◈', c.name);
            b.addEventListener('contextmenu', e => { e.preventDefault(); WB.ui.menu([
              { label: 'Rename…', icon: '✎', onClick: async () => { const n = await ui.prompt('Rename collection', c.name); if (n) { await WB.api('collections.save', Object.assign({}, c, { name: n })); paintSources(); } } },
              { label: 'Delete', icon: '🗑', danger: true, onClick: async () => { await WB.api('collections.remove', c.id); if (is('col', c.id)) st.patch({ source: { kind: 'all' } }); paintSources(); loadList(); } },
            ], e); });
            return b;
          }),
          !cols.length ? h('div.gk-tiny.gk-faint.cx-src-hint', { text: 'Filter the list, then ＋ to keep it as a collection.' }) : null,
          h('div.cx-src-foot', [item('trash', null, '🗑', 'Trash', stats.trashed || null)]),
        ]);
      }
      async function saveCollection() {
        const src = st.get().source;
        const name = await ui.prompt('Save as a collection', q ? '“' + q + '”' : src.kind === 'type' ? (WB.types.get(src.id) || {}).plural : 'My collection');
        if (!name) return;
        const query = { q };
        if (src.kind === 'type') query.typeIds = [src.id];
        if (src.kind === 'tag') query.tagIds = [src.id];
        if (src.kind === 'fav') query.favorite = true;
        await WB.api('collections.save', { worldId: WB.worldId, name, query });
        paintSources();
      }

      /* ---------------- list ---------------- */
      const search = WB.ui.search({ placeholder: 'Filter  (Ctrl+F)', value: q, onInput: v => { q = v; more = 400; loadListD(); } });
      const sortSel = ui.select({ value: S.sort, options: [['position', 'Manual order'], ['title', 'Name'], ['updated', 'Last edited'], ['created', 'Newest'], ['start', 'World date'], ['words', 'Longest']], onChange: v => { st.patch({ sort: v }); loadList(); } });
      sortSel.title = 'Sort';
      paintViewSwitch();
      const listHead = h('div.cx-list-head');
      const listBody = h('div.cx-rows', { role: 'tree' });
      const bulkBar = h('div.cx-bulk');
      listPane.append(h('div.cx-list-tools', [
        ui.button({ icon: '☰', small: true, kind: 'ghost', title: 'Show or hide sources', onClick: () => { const on = !st.get().sources; st.patch({ sources: on }); root.classList.toggle('no-sources', !on); } }),
        h('div.gk-grow', [search]),
        ui.group([
          ui.button({ label: 'New', icon: '＋', small: true, kind: 'primary', title: 'New entry (Ctrl+N)', onClick: () => newEntry() }),
          ui.button({ icon: '▾', small: true, kind: 'primary', title: 'More ways to add', onClick: ev => newMenu(ev.currentTarget) }),
        ]),
      ]), h('div.cx-list-tools.second', [viewHolder]), h('div.cx-list-tools.second', [sortSel, ui.button({ icon: '⋯', small: true, kind: 'ghost', title: 'Tree options: expand, collapse, nesting rules', onClick: ev => treeMenu(ev.currentTarget) })]), listHead, listBody, bulkBar,
      h('div.cx-hints.gk-tiny.gk-faint'));
      WB.ui.listKeys(listBody);
      const hintsEl = listPane.querySelector('.cx-hints');
      function treeMenu(anchor) {
        const allow = !(WB.world && WB.world.settings && WB.world.settings.allowAnyNesting === false);
        WB.ui.menu([
          { label: 'Expand all', icon: '▾', onClick: () => { setCollapsed(new Set()); paintList(); } },
          { label: 'Collapse all', icon: '▸', onClick: () => { setCollapsed(new Set(entries.filter(e => entries.some(c => c.parentId === e.id)).map(e => e.id))); paintList(); } },
          { label: 'Expand to the open entry', icon: '⌖', disabled: !current, onClick: () => { reveal(current.id); paintList(); } },
          '-',
          { label: 'Select all shown', icon: '☑', kbd: 'Ctrl+A', onClick: () => { entries.forEach(e => selected.add(e.id)); paintList(); } },
          '-',
          { label: 'Any entry can sit inside any other', icon: allow ? '✓' : '', checked: allow, hint: 'Off: only types that allow it (the type editor) nest; moving anything else asks first', onClick: async () => {
            try { await WB.api('worlds.update', WB.worldId, { settings: { allowAnyNesting: !allow } }); if (WB.world) WB.world.settings = Object.assign({}, WB.world.settings, { allowAnyNesting: !allow }); ui.toast(!allow ? 'Anything can nest in anything' : 'Nesting follows each type’s rules (you can still override)', '⇲'); } catch (err) { WB.fail(err); }
          } },
        ], anchor);
      }
      const reveal = id => {
        const c = getCollapsed(); let p = (WB.liteOf(id) || {}).parentId, g = 0, ch = false;
        while (p && g++ < 60) { if (c.delete(p)) ch = true; p = (WB.liteOf(p) || {}).parentId; }
        if (ch) setCollapsed(c);
        return ch;
      };
      function newMenu(anchor) {
        WB.ui.menu([
          { label: 'New entry…', icon: '＋', kbd: 'Ctrl+N', onClick: () => newEntry() },
          current ? { label: 'New inside “' + current.title + '”…', icon: '↳', onClick: () => newEntry({ parentId: current.id, type: ((WB.typeOf(current) || {}).childTypes || [])[0] }) } : null,
          { label: 'Add many at once…', icon: '≡', hint: 'Paste a list of names, one per line', onClick: addMany },
          { label: 'Quick capture', icon: '✚', kbd: 'Ctrl+Shift+N', onClick: () => WB.capture() },
          { label: 'Table view', icon: '⊞', onClick: () => setTable(true) },
        ], anchor);
      }
      async function addMany() {
        const src = st.get().source;
        let type = src.kind === 'type' ? WB.types.get(src.id) : WB.type('character');
        const text = ui.input({ multiline: true, rows: 10, placeholder: 'One name per line, e.g.\nThe Copper Kettle\nThe Drowned Rat\nThe Gull\'s Rest' });
        const ok = await ui.dialog({ title: 'Add many at once', icon: '≡', body: h('div.gk-stack', [
          ui.field({ label: 'As', control: ui.select({ value: type.id, options: WB.typeList().map(t => [t.id, t.icon + '  ' + t.name]), onChange: v => { type = WB.types.get(v); } }) }),
          text, h('p.gk-small.gk-muted', { text: 'Each line becomes an entry you can fill in later.' }),
        ]), actions: [{ label: 'Cancel', value: false }, { label: 'Add them', kind: 'primary', value: true }] });
        if (!ok) return;
        const lines = text.value.split('\n').map(s => s.trim()).filter(Boolean);
        if (!lines.length) return;
        const made = await WB.api('entries.createMany', WB.worldId, type.id, lines, { tagNames: src.kind === 'tag' ? [(WB.tag(src.id) || {}).name].filter(Boolean) : undefined });
        WB.ui.undoToast('Added ' + made.length + ' ' + (made.length === 1 ? type.name.toLowerCase() : type.plural.toLowerCase()), async () => { for (const m of made) await WB.api('entries.purge', m.id); });
        loadList();
      }

      /* ---------------- table view ---------------- */
      async function paintTable() {
        const src = st.get().source;
        const t = src.kind === 'type' ? WB.types.get(src.id) : null;
        const rows = entries.length ? await WB.api('entries.withFields', WB.worldId, { ids: entries.map(e => e.id) }).catch(() => []) : [];
        if (destroyed || !wide()) return;
        const cards = st.get().view === 'cards';
        const ro = WB.share;
        const defs = t ? (t.fields || []).filter(d => WB.fieldVisible(d)) : [];
        const colKey = t ? t.id : 'all';
        const hiddenAll = st.get().tableHidden || {};
        const hidden = new Set(hiddenAll[colKey] || (t ? defs.filter(d => d.kind === 'longtext' || d.kind === 'stats').map(d => 'f:' + d.key).concat(['summary', 'parent']) : ['parent']));
        const cols = [{ key: 'title', label: 'Name' }]
          .concat(t ? [] : [{ key: 'type', label: 'Type' }])
          .concat([{ key: 'parent', label: 'Inside' }])
          .concat(t && t.dated ? [{ key: 'start', label: t.dated.start }].concat(t.dated.end ? [{ key: 'end', label: t.dated.end }] : []) : [])
          .concat(defs.map(d => ({ key: 'f:' + d.key, label: d.label, def: d })))
          .concat([{ key: 'summary', label: 'Summary' }, { key: 'tags', label: 'Tags' }, { key: 'audience', label: 'Audience' }, { key: 'updated', label: 'Edited' }]);
        const vis = cols.filter(c => c.key === 'title' || !hidden.has(c.key));
        const val = (e, c) => {
          if (c.key === 'title') return e.title;
          if (c.key === 'type') return (WB.typeOf(e) || {}).name || '';
          if (c.key === 'parent') return e.parentId ? WB.titleOf(e.parentId) || '' : '';
          if (c.key === 'start') return e.start ? e.start.day : null;
          if (c.key === 'end') return e.end ? e.end.day : null;
          if (c.key === 'summary') return e.summary;
          if (c.key === 'tags') return (e.tags || []).map(id => (WB.tag(id) || {}).name).join(', ');
          if (c.key === 'audience') return e.audience;
          if (c.key === 'updated') return e.updatedAt;
          const v = e.fields[c.def.key];
          return c.def.kind === 'ref' ? WB.titleOf(v) : c.def.kind === 'refs' ? (v || []).map(WB.titleOf).join(', ') : WB.F.asText(c.def, v, WB.titleOf) || (typeof v === 'number' ? v : '');
        };
        if (tableSort.key) {
          const c = cols.find(x => x.key === tableSort.key);
          if (c) rows.sort((a, b) => { const x = val(a, c), y = val(b, c); if (x == null || x === '') return 1; if (y == null || y === '') return -1; return (typeof x === 'number' && typeof y === 'number' ? x - y : String(x).localeCompare(String(y), undefined, { numeric: true })) * tableSort.dir; });
        }
        const savers = {};
        const saveF = (e, key, v) => { e.fields[key] = v; lastSave = Date.now(); const k = e.id + key; (savers[k] || (savers[k] = WB.debounce(x => WB.api('entries.update', e.id, { fieldsPatch: { [key]: x } }).then(() => { lastSave = Date.now(); }).catch(WB.fail), 450)))(v); };
        const saveP = WB.debounce((e, p) => { lastSave = Date.now(); WB.api('entries.update', e.id, p).then(() => { lastSave = Date.now(); }).catch(WB.fail); }, 450);
        const cell = (e, c) => {
          if (c.key === 'title') return h('div.cx-tcell-title', [WB.ui.icon(e), ro ? h('span', { text: e.title }) : h('input.cx-tin', { value: e.title, oninput: ev => saveP(e, { title: ev.target.value }) }), h('button.cx-topen', { type: 'button', text: '↗', title: 'Open', onclick: () => { setTable(false); select(e.id); } })]);
          if (c.key === 'type') return h('span', { text: (WB.typeOf(e) || {}).name || '' });
          if (c.key === 'parent') return e.parentId ? WB.ui.chip(e.parentId, { size: 'sm' }) : h('span.gk-faint', { text: '—' });
          if (c.key === 'start' || c.key === 'end') return ro ? h('span', { text: WB.fmt.date(e[c.key]) }) : WB.ui.dateInput({ value: e[c.key], compact: true, onChange: d => { e[c.key] = d; saveP.flush(e, { [c.key]: d }); } });
          if (c.key === 'summary') return ro ? h('span', { text: e.summary }) : h('input.cx-tin', { value: e.summary, placeholder: '—', oninput: ev => saveP(e, { summary: ev.target.value }) });
          if (c.key === 'tags') return h('div.wb-chips', (e.tags || []).map(id => WB.ui.tagChip(id)));
          if (c.key === 'audience') return ro ? h('span', { text: e.audience }) : ui.select({ value: e.audience, options: WB.know.LEVELS.map(([v, l]) => [v, l]), onChange: v => { e.audience = v; saveP.flush(e, { audience: v }); } });
          if (c.key === 'updated') return h('span.gk-small.gk-muted', { text: WB.fmt.rel(e.updatedAt) });
          const d = c.def, v = e.fields[d.key];
          if (ro) return WB.ui.fieldView(d, v);
          switch (d.kind) {
            case 'text': case 'url': case 'dice': case 'longtext': return h('input.cx-tin', { value: v || '', placeholder: '—', oninput: ev => saveF(e, d.key, ev.target.value) });
            case 'number': case 'progress': return h('input.cx-tin.num', { type: 'number', value: v == null ? '' : v, placeholder: '—', oninput: ev => saveF(e, d.key, ev.target.value === '' ? null : +ev.target.value) });
            case 'choice': return ui.select({ value: v || '', options: [['', '—']].concat((d.options || []).map(o => [o, o])).concat(v && !(d.options || []).includes(v) ? [[v, v]] : []), onChange: x => saveF(e, d.key, x) });
            case 'bool': return h('input', { type: 'checkbox', checked: !!v, onchange: ev => saveF(e, d.key, ev.target.checked) });
            case 'realdate': return h('input.cx-tin', { type: 'date', value: v || '', onchange: ev => saveF(e, d.key, ev.target.value) });
            case 'color': return ui.color({ value: v || '#7c8fb3', onInput: x => saveF(e, d.key, x) });
            default: return h('div.cx-tcell-view', { title: 'Open the entry to edit', onclick: () => { setTable(false); select(e.id); } }, [WB.ui.fieldView(d, v)]);
          }
        };
        // group by: a choice / yes-no / link field, the type, or what it sits inside
        const groupOpts = [['', 'No grouping']].concat(t ? [] : [['type', 'Type']], [['parent', 'Inside']], cols.filter(c => c.def && ['choice', 'bool', 'ref', 'rating'].includes(c.def.kind)).map(c => [c.key, c.label]));
        let groupBy = (st.get().groupBy || {})[colKey] || '';
        if (!groupOpts.some(o => o[0] === groupBy)) groupBy = '';
        const groupCol = groupBy === 'type' ? cols.find(c => c.key === 'type') : cols.find(c => c.key === groupBy);
        const groups = new Map();
        for (const e of rows) {
          let g = groupCol ? String(val(e, groupCol) == null ? '' : val(e, groupCol)) : '';
          if (groupCol && groupBy === 'parent' && !g) g = 'Top level';
          if (groupCol && groupCol.def && groupCol.def.kind === 'bool') g = e.fields[groupCol.def.key] ? 'Yes' : 'No';
          if (groupCol && !g) g = '—';
          if (!groups.has(g)) groups.set(g, []);
          groups.get(g).push(e);
        }
        const groupList = [...groups].sort((a, b) => (a[0] === '—') - (b[0] === '—') || (groupCol ? String(a[0]).localeCompare(String(b[0]), undefined, { numeric: true }) : 0));
        const rowMenu = (e, ev) => { if (ev.target.closest('input, select')) return; ev.preventDefault(); WB.ui.entryMenu(e, ev); };
        const table = h('table.cx-tbl', [
          h('thead', [h('tr', vis.map(c => h('th', { class: tableSort.key === c.key ? 'sorted' : '', title: 'Sort by ' + c.label, onclick: () => { tableSort = { key: c.key, dir: tableSort.key === c.key ? -tableSort.dir : 1 }; paintTable(); } }, [c.label, tableSort.key === c.key ? (tableSort.dir > 0 ? ' ▴' : ' ▾') : ''])))]),
          h('tbody', groupList.flatMap(([g, list]) => [].concat(groupCol ? [h('tr.cx-grouprow', [h('td', { colSpan: vis.length }, [h('b', { text: g }), h('span.gk-small.gk-muted', { text: '  ' + list.length })])])] : [],
            list.map(e => { const tr = h('tr', { dataset: { id: e.id } }, vis.map(c => h('td', { class: 'c-' + c.key.replace(/[^\w-]/g, '_') }, [cell(e, c)]))); tr.addEventListener('contextmenu', ev => rowMenu(e, ev)); return tr; })))),
        ]);
        // cards: the same entries (and grouping) as tiles — the type's first few filled fields, tags, what is inside
        const cardFor = e => {
          const tp = WB.typeOf(e) || {};
          const facts = (tp.fields || []).filter(d => WB.fieldVisible(d) && !['longtext', 'stats', 'image'].includes(d.kind)).map(d => [d.label, WB.F.asText(d, e.fields[d.key], WB.titleOf)]).filter(x => x[1]).slice(0, 3);
          const open = () => { setView('tree'); select(e.id); };
          const el = h('div.cx-tile', { tabindex: 0, role: 'button', dataset: { id: e.id }, style: { '--c': WB.colorOf(e) }, onclick: open, onkeydown: ev => { if (ev.key === 'Enter') open(); } }, [
            h('div.cx-tile-head', [h('span.cx-tile-ico', { text: WB.iconOf(e) }), h('b.gk-ellipsis.gk-grow', { text: e.title || 'Untitled' }), counts[e.id] ? h('span.gk-tiny.gk-faint', { title: 'Entries inside', text: '⇲ ' + counts[e.id] }) : null]),
            h('div.gk-tiny.gk-muted', { text: [tp.name, WB.fmt.span(e), e.parentId ? 'in ' + WB.titleOf(e.parentId) : ''].filter(Boolean).join(' · ') }),
            e.summary ? h('p.gk-small.cx-tile-sum', { text: e.summary }) : null,
            facts.length ? h('div.cx-tile-facts', facts.map(([k, v]) => h('span', [h('i', { text: k + ' ' }), String(v).slice(0, 40)]))) : null,
            (e.tags || []).length ? h('div.wb-chips', e.tags.slice(0, 4).map(id => WB.ui.tagChip(id))) : null,
          ]);
          el.addEventListener('contextmenu', ev => { ev.preventDefault(); WB.ui.entryMenu(e, ev); });
          WB.dnd.entry(el, e.id);
          return el;
        };
        const tiles = h('div.cx-tiles-wrap', groupList.map(([g, list]) => h('section.cx-tilegroup', [groupCol ? h('h4.cx-tilegroup-head', [g, h('span.gk-small.gk-muted', { text: '  ' + list.length })]) : null, h('div.cx-tiles', list.map(cardFor))])));
        const addRow = !ro && t ? h('input.cx-taddrow', { placeholder: '＋ New ' + t.name.toLowerCase() + ' — type a name and press Enter' }) : null;
        if (addRow) addRow.addEventListener('keydown', async ev => { if (ev.key === 'Enter' && addRow.value.trim()) { await WB.api('entries.create', { worldId: WB.worldId, typeId: t.id, title: addRow.value.trim() }); addRow.value = ''; await loadList(); const n = tablePane.querySelector('.cx-taddrow'); if (n) n.focus(); } });
        const copy = async () => {
          const tsv = [vis.map(c => c.label).join('\t')].concat(rows.map(e => vis.map(c => { let x = val(e, c); if ((c.key === 'start' || c.key === 'end') && e[c.key]) x = WB.fmt.date(e[c.key]); if (c.key === 'updated') x = WB.fmt.real(e.updatedAt); return String(x == null ? '' : x).replace(/[\t\n]+/g, ' '); }).join('\t'))).join('\n');
          await navigator.clipboard.writeText(tsv); ui.toast('Copied ' + rows.length + ' rows — paste into any spreadsheet', '⎘');
        };
        const label = t ? t.plural : ({ all: 'All entries', fav: 'Favourites', inbox: 'Inbox', recent: 'Recently edited', trash: 'Trash' }[src.kind] || 'Entries');
        GK.clear(tablePane);
        GK.append(tablePane, [
          h('div.cx-table-tools', [
            ui.button({ label: 'Pages', icon: '‹', small: true, title: 'Back to the tree and entry pages', onClick: () => setView('tree') }),
            h('b', { text: label }), h('span.gk-small.gk-muted', { text: WB.fmt.plural(rows.length, 'entry', 'entries') }), h('span.gk-grow'),
            (() => { const s = viewSwitch(); s.classList.add('cx-wideswitch'); return s; })(),
            ui.select({ value: groupBy, options: groupOpts, onChange: v => { st.patch({ groupBy: Object.assign({}, st.get().groupBy, { [colKey]: v }) }); paintTable(); } }),
            h('div.cx-table-search', [WB.ui.search({ placeholder: 'Filter', value: q, onInput: v => { q = v; loadListD(); } })]),
            cards ? null : ui.button({ label: 'Columns', icon: '⊞', small: true, onClick: ev => WB.ui.menu(cols.filter(c => c.key !== 'title').map(c => ({ label: c.label, checked: !hidden.has(c.key), onClick: () => { hidden.has(c.key) ? hidden.delete(c.key) : hidden.add(c.key); st.patch({ tableHidden: Object.assign({}, st.get().tableHidden, { [colKey]: [...hidden] }) }); paintTable(); } })), ev.currentTarget) }),
            ui.button({ label: 'Copy', icon: '⎘', small: true, title: 'Copy as a spreadsheet', onClick: copy }),
            !ro ? ui.button({ label: 'Add many…', small: true, onClick: addMany }) : null,
          ]),
          !t && !cards ? h('p.gk-small.gk-muted.cx-table-hint', { text: 'Pick a type on the left to see and edit its fields as columns.' }) : null,
          h('div.cx-table-scroll', rows.length ? [cards ? tiles : table, addRow] : [WB.ui.empty({ icon: t ? t.icon : '❖', title: q ? 'Nothing matches' : 'Nothing here yet', text: q ? 'Try fewer words.' : 'Add the first one below, or switch to another source.' }), addRow]),
        ]);
      }

      async function newEntry(extra = {}) {
        const src = st.get().source;
        const t = src.kind === 'type' ? WB.types.get(src.id) : null;
        const e = await WB.ui.createDialog(Object.assign({ type: t ? t.key : undefined, open: false, title: q && !t ? q : '' }, extra));
        if (e) { if (src.kind === 'tag') await WB.api('entries.setTags', e.id, [src.id]); await loadList(); select(e.id, { focusTitle: !e.title || /^Untitled/.test(e.title) }); }
      }
      function filterFor(src) {
        const f = { sort: st.get().sort };
        if (src.kind === 'type') f.typeIds = [src.id];
        if (src.kind === 'tag') f.tagIds = [src.id];
        if (src.kind === 'fav') f.favorite = true;
        if (src.kind === 'inbox') f.inbox = true;
        if (src.kind === 'recent') { f.sort = 'updated'; f.limit = 60; }
        if (src.kind === 'trash') { f.trashed = 'roots'; f.sort = 'deleted'; }
        return f;
      }
      async function loadList() {
        const src = st.get().source;
        let list;
        try {
          if (src.kind === 'col') {
            const c = (await WB.api('collections.list', WB.worldId)).find(x => x.id === src.id);
            const cq = (c && c.query) || {};
            const tagIds = (cq.tagIds || []).concat((cq.tagNames || []).map(n => (WB.tags.find(t => t.name === n) || {}).id).filter(Boolean));
            const f = { sort: st.get().sort, typeIds: cq.typeIds || [], tagIds, favorite: cq.favorite, typeKeys: cq.typeKeys };
            const text = [cq.q, q].filter(Boolean).join(' ');
            list = text ? await WB.api('search.query', WB.worldId, text, { limit: 500, typeIds: f.typeIds }) : await WB.api('entries.list', WB.worldId, f);
            if (text) list = list.filter(e => tagIds.every(t => (e.tags || []).includes(t)));
          } else if (q && src.kind !== 'trash') {
            const f = filterFor(src);
            list = await WB.api('search.query', WB.worldId, q, { limit: 500, typeIds: f.typeIds || [] });
            if (f.tagIds) list = list.filter(e => f.tagIds.every(t => (e.tags || []).includes(t)));
            if (f.favorite) list = list.filter(e => e.favorite);
            if (f.inbox) list = list.filter(e => e.inbox);
          } else {
            list = await WB.api('entries.list', WB.worldId, filterFor(src));
            if (q) { const lq = q.toLowerCase(); list = list.filter(e => e.title.toLowerCase().includes(lq)); }
          }
        } catch (err) { WB.fail(err); list = []; }
        if (destroyed) return;
        entries = list.filter(e => WB.visible(e));
        // a filter in the tree keeps the way down to every match: the parents of matches are listed too (dimmed)
        ctxIds = new Set();
        if (q && st.get().view === 'tree' && src.kind !== 'trash' && src.kind !== 'recent') {
          const have = new Set(entries.map(e => e.id)), need = [];
          for (const e of entries.slice()) {
            let p = e.parentId, g = 0;
            while (p && g++ < 60) { if (!have.has(p)) { have.add(p); ctxIds.add(p); need.push(p); } p = (WB.liteOf(p) || {}).parentId; }
          }
          if (need.length) entries = entries.concat((await WB.api('entries.many', need).catch(() => [])).filter(e => !e.deletedAt && WB.visible(e)));
          if (destroyed) return;
        }
        counts = await WB.api('entries.descendantCounts', WB.worldId).catch(() => ({}));
        if (destroyed) return;
        paintList();
        if (wide()) paintTable();
      }
      const loadListD = WB.debounce(loadList, 140);
      function paintList() {
        const src = st.get().source, view = st.get().view, trash = src.kind === 'trash';
        const label = { all: 'All entries', fav: 'Favourites', inbox: 'Inbox', recent: 'Recently edited', trash: 'Trash' }[src.kind] || (src.kind === 'type' ? (WB.types.get(src.id) || {}).plural : src.kind === 'tag' ? '#' + ((WB.tag(src.id) || {}).name || '') : 'Collection');
        GK.clear(listHead);
        GK.append(listHead, [h('b.gk-ellipsis', { text: label }), h('span.gk-small.gk-muted', { text: WB.fmt.plural(entries.length, 'entry', 'entries') }),
          trash && entries.length ? ui.button({ label: 'Empty trash', small: true, kind: 'ghost', onClick: async () => { if (await ui.confirm('Empty the trash?', 'Everything in the trash is deleted for good. Your daily backup still has it.', 'Delete for good', true)) { await WB.api('entries.emptyTrash', WB.worldId); loadList(); paintSources(); } } }) : null]);
        GK.clear(listBody);
        if (!entries.length) {
          listBody.appendChild(WB.ui.empty(trash ? { icon: '🗑', title: 'The trash is empty', text: 'Deleted entries wait here until you empty it.' }
            : q ? { icon: '⌕', title: 'Nothing matches', text: 'Try fewer words, or create it.', actions: [ui.button({ label: 'Create “' + q + '”', icon: '＋', onClick: () => newEntry({ title: q }) })] }
              : { icon: src.kind === 'type' ? (WB.types.get(src.id) || {}).icon : '❖', title: 'Nothing here yet', text: src.kind === 'inbox' ? 'Captured ideas land here (Ctrl+Shift+N).' : 'Start with a name — you can fill in the rest any time.', actions: [ui.button({ label: 'New entry', icon: '＋', kind: 'primary', onClick: () => newEntry() })] }));
          return;
        }
        const tree = view === 'tree' && !trash && src.kind !== 'recent';
        const manual = st.get().sort === 'position' && !q;
        const collapsed = q ? new Set() : getCollapsed();   // a filter opens everything so the matches show
        const ids = new Set(entries.map(e => e.id));
        const kidsOf = new Map();
        if (tree) for (const e of entries) { if (e.parentId && ids.has(e.parentId)) { if (!kidsOf.has(e.parentId)) kidsOf.set(e.parentId, []); kidsOf.get(e.parentId).push(e); } }
        if (tree && q) for (const l of kidsOf.values()) l.sort((a, b) => (a.position - b.position) || a.title.localeCompare(b.title));
        let n = 0;
        const toggle = id => { const c = getCollapsed(); c.has(id) ? c.delete(id) : c.add(id); setCollapsed(c); paintList(); };
        const rowFor = (e, depth, hasKids) => {
          const open = hasKids && !collapsed.has(e.id);
          const tw = hasKids ? h('button.cx-twisty', { type: 'button', tabindex: -1, text: open ? '▾' : '▸', title: open ? 'Collapse' : 'Expand', onclick: ev => { ev.stopPropagation(); toggle(e.id); } }) : h('span.cx-twisty.none');
          const tail = [];
          if (trash) tail.push(ui.button({ label: 'Restore', small: true, onClick: async ev => { ev.stopPropagation(); await WB.api('entries.restore', e.id); loadList(); paintSources(); } }));
          else {
            if (e.inbox) tail.push(WB.ui.badge('inbox', 'accent'));
            if (counts[e.id]) tail.push(h('span.cx-count.gk-tiny', { title: WB.fmt.plural(counts[e.id], 'entry', 'entries') + ' inside, at any depth', text: counts[e.id] }));
          }
          const row = WB.ui.row(e, {
            active: (current && current.id === e.id) || selected.has(e.id), indent: depth,
            sub: [WB.fmt.span(e), e.summary].filter(Boolean).join(' · ') || (WB.typeOf(e) || {}).name,
            trailing: tail.length ? h('span.cx-tail', tail) : null,
            onClick: (x, ev) => clickRow(x, ev),
            menuExtra: [{ label: selected.has(e.id) ? 'Unselect' : 'Select', icon: '☑', onClick: () => { selected.has(e.id) ? selected.delete(e.id) : selected.add(e.id); paintList(); } },
              selected.size > 1 && selected.has(e.id) ? { label: 'Move the ' + selected.size + ' selected to…', icon: '⇲', onClick: () => WB.tree.moveDialog([...selected]) } : null].filter(Boolean),
          });
          row.prepend(tw);
          row.setAttribute('role', 'treeitem');
          if (tree) row.setAttribute('aria-level', depth + 1);
          if (hasKids) row.setAttribute('aria-expanded', open ? 'true' : 'false');
          if (selected.has(e.id)) row.classList.add('sel');
          if (ctxIds.has(e.id)) row.classList.add('ctx');
          if (!trash) dropTarget(row, e, { manual, tree });
          return row;
        };
        const add = (e, depth, seen) => {
          if (n++ > more) return;
          const kids = tree ? kidsOf.get(e.id) || [] : [];
          listBody.appendChild(rowFor(e, depth, kids.length > 0));
          if (kids.length && !collapsed.has(e.id) && !seen.has(e.id)) { seen.add(e.id); kids.forEach(c => add(c, depth + 1, seen)); }
        };
        if (tree) entries.filter(e => !e.parentId || !ids.has(e.parentId)).forEach(e => add(e, 0, new Set()));
        else entries.forEach(e => add(e, 0, new Set()));
        if (n > more) listBody.appendChild(ui.button({ label: 'Show more', small: true, kind: 'ghost', onClick: () => { more += 400; paintList(); } }));
        if (pendingFocus) { const r = listBody.querySelector('.wb-row[data-id="' + pendingFocus + '"]'); pendingFocus = null; if (r) r.focus({ preventScroll: false }); }
        hintsEl.textContent = tree ? (manual ? 'Drag to nest or reorder · Tab / Shift+Tab indent · Alt+↑↓ move · ←→ fold · Shift/Ctrl-click select' : 'Drag onto an entry to nest it · Tab / Shift+Tab indent · ←→ fold · Shift/Ctrl-click select')
          : 'Shift/Ctrl-click to select several · right-click for more';
        paintBulk();
      }
      /** is `id` one of `ids` or somewhere below one of them? (the tree cannot move into itself) */
      const underAny = (id, ids) => { let p = id, g = 0; while (p && g++ < 60) { if (ids.includes(p)) return true; p = (WB.liteOf(p) || {}).parentId; } return false; };
      let hoverTimer = null;
      function dropTarget(row, e, { manual, tree }) {
        const zone = ev => {
          if (!manual || !tree) return 'inside';
          const r = row.getBoundingClientRect(), y = ev.clientY - r.top;
          return y < r.height * .28 ? 'before' : y > r.height * .72 ? 'after' : 'inside';
        };
        row.addEventListener('dragover', ev => {
          if (!WB.dnd.has(ev) || WB.share) return;
          if (dragIds.length && underAny(e.id, dragIds)) { ev.dataTransfer.dropEffect = 'none'; row.dataset.drop = 'no'; return; }
          ev.preventDefault();
          ev.dataTransfer.dropEffect = 'move';
          const z = zone(ev);
          if (row.dataset.drop !== z) { row.dataset.drop = z; clearTimeout(hoverTimer); if (z === 'inside' && getCollapsed().has(e.id)) hoverTimer = setTimeout(() => { const c = getCollapsed(); c.delete(e.id); setCollapsed(c); paintList(); }, 700); }
        });
        row.addEventListener('dragleave', ev => { if (!row.contains(ev.relatedTarget)) { delete row.dataset.drop; clearTimeout(hoverTimer); } });
        row.addEventListener('drop', async ev => {
          const where = row.dataset.drop; delete row.dataset.drop; clearTimeout(hoverTimer);
          const ids = dragIds.length ? dragIds : [WB.dnd.id(ev)].filter(Boolean);
          if (!ids.length || where === 'no' || ids.includes(e.id)) return;
          ev.preventDefault(); ev.stopPropagation();
          const z = where || 'inside';
          const ok = z === 'inside' ? await WB.tree.move(ids, { parentId: e.id }) : await WB.tree.move(ids, { parentId: e.parentId || null, [z === 'before' ? 'beforeId' : 'afterId']: e.id });
          if (ok && z === 'inside') { const c = getCollapsed(); c.delete(e.id); setCollapsed(c); }
          dragIds = [];
          loadList();
        });
      }
      // what is being dragged: the whole selection when the dragged row belongs to it
      listBody.addEventListener('dragstart', ev => {
        const r = ev.target.closest && ev.target.closest('.wb-row');
        if (!r) return;
        dragIds = selected.has(r.dataset.id) && selected.size > 1 ? [...selected] : [r.dataset.id];
      });
      listBody.addEventListener('dragend', () => { dragIds = []; listBody.querySelectorAll('[data-drop]').forEach(r => delete r.dataset.drop); });
      // dropping on the empty part of the list puts it at the top level, last
      listBody.addEventListener('dragover', ev => { if (WB.dnd.has(ev) && !WB.share && ev.target === listBody) { ev.preventDefault(); ev.dataTransfer.dropEffect = 'move'; } });
      listBody.addEventListener('drop', async ev => {
        if (ev.target !== listBody) return;
        const ids = dragIds.length ? dragIds : [WB.dnd.id(ev)].filter(Boolean);
        if (!ids.length) return;
        ev.preventDefault(); dragIds = [];
        await WB.tree.move(ids, { parentId: null }); loadList();
      });

      function clickRow(e, ev) {
        const order = () => [...listBody.querySelectorAll('.wb-row')].map(r => r.dataset.id);
        if (ev.ctrlKey || ev.metaKey) { if (current && !selected.size) selected.add(current.id); selected.has(e.id) ? selected.delete(e.id) : selected.add(e.id); anchor = e.id; pendingFocus = e.id; paintList(); return; }
        if (ev.shiftKey && (anchor || current)) {
          const o = order(), a = o.indexOf(anchor || current.id), b = o.indexOf(e.id);
          if (a >= 0 && b >= 0) { o.slice(Math.min(a, b), Math.max(a, b) + 1).forEach(id => selected.add(id)); pendingFocus = e.id; paintList(); return; }
        }
        selected.clear(); anchor = e.id;
        select(e.id);
      }
      /* keys in the list: Tab / Shift+Tab indent and outdent, Alt+Up / Alt+Down move among siblings, Left / Right fold */
      const targetIds = id => (selected.size > 1 && selected.has(id) ? [...listBody.querySelectorAll('.wb-row')].map(r => r.dataset.id).filter(x => selected.has(x)) : [id]);
      const reselect = ids => { pendingFocus = ids[ids.length - 1]; };
      async function indentIds(ids) {
        let any = false;
        for (const id of ids) {
          const e = entries.find(x => x.id === id); if (!e) continue;
          const sibs = entries.filter(x => (x.parentId || null) === (e.parentId || null) && !x.deletedAt);
          const i = sibs.findIndex(x => x.id === id);
          if (i < 1) continue;
          if (await WB.tree.move([id], { parentId: sibs[i - 1].id }, { quiet: true })) { any = true; const c = getCollapsed(); c.delete(sibs[i - 1].id); setCollapsed(c); }
          await loadListNow();
        }
        if (!any) ui.toast('Nothing above it to nest it under', 'ℹ');
      }
      async function outdentIds(ids) {
        let any = false;
        for (const id of ids.slice().reverse()) {
          const e = entries.find(x => x.id === id); if (!e || !e.parentId) continue;
          const p = WB.liteOf(e.parentId); if (!p) continue;
          if (await WB.tree.move([id], { parentId: p.parentId || null, afterId: p.id }, { quiet: true })) any = true;
          await loadListNow();
        }
        if (!any) ui.toast('Already at the top level', 'ℹ');
      }
      async function shiftIds(ids, dir) {
        for (const id of dir < 0 ? ids : ids.slice().reverse()) { try { await WB.api('entries.shift', id, dir); } catch (err) { WB.fail(err); } }
        await loadListNow();
      }
      const loadListNow = () => loadList();
      listBody.addEventListener('keydown', async ev => {
        const row = ev.target.closest && ev.target.closest('.wb-row');
        if (!row || ev.target !== row || WB.share) return;
        const id = row.dataset.id, tree = st.get().view === 'tree' && st.get().source.kind !== 'trash';
        const ids = targetIds(id);
        if (ev.key === 'Tab' && tree) { ev.preventDefault(); reselect(ids); await (ev.shiftKey ? outdentIds(ids) : indentIds(ids)); }
        else if (ev.altKey && (ev.key === 'ArrowUp' || ev.key === 'ArrowDown') && tree) { ev.preventDefault(); reselect(ids); await shiftIds(ids, ev.key === 'ArrowUp' ? -1 : 1); }
        else if ((ev.key === 'ArrowRight' || ev.key === 'ArrowLeft') && tree && !ev.altKey) {
          const kids = entries.some(x => x.parentId === id), c = getCollapsed(), closed = c.has(id);
          if (ev.key === 'ArrowRight') { ev.preventDefault(); if (kids && closed) { c.delete(id); setCollapsed(c); pendingFocus = id; paintList(); } else if (kids) { const nx = row.nextElementSibling; if (nx) nx.focus(); } }
          else { ev.preventDefault(); if (kids && !closed && !q) { c.add(id); setCollapsed(c); pendingFocus = id; paintList(); } else { const p = entries.find(x => x.id === (entries.find(y => y.id === id) || {}).parentId); const pr = p && listBody.querySelector('.wb-row[data-id="' + p.id + '"]'); if (pr) pr.focus(); } }
        }
        else if (ev.key === 'a' && (ev.ctrlKey || ev.metaKey)) { ev.preventDefault(); entries.forEach(x => selected.add(x.id)); pendingFocus = id; paintList(); }
        else if (ev.key === ' ' && !ev.target.closest('button')) { ev.preventDefault(); selected.has(id) ? selected.delete(id) : selected.add(id); anchor = id; pendingFocus = id; paintList(); }
        else if (ev.key === 'Escape' && selected.size) { selected.clear(); pendingFocus = id; paintList(); }
      });
      function paintBulk() {
        GK.clear(bulkBar);
        bulkBar.classList.toggle('on', selected.size > 1);
        if (selected.size < 2) return;
        const ids = [...selected], ordered = () => [...listBody.querySelectorAll('.wb-row')].map(r => r.dataset.id).filter(x => selected.has(x));
        GK.append(bulkBar, [h('b', { text: selected.size + ' selected' }), h('span.gk-grow'),
          ui.button({ label: 'Move…', small: true, title: 'Move all of them into another entry (or the top level)', onClick: () => WB.tree.moveDialog(ordered()).then(ok => { if (ok) loadList(); }) }),
          ui.button({ icon: '⇥', small: true, title: 'Indent (Tab)', onClick: () => indentIds(ordered()) }),
          ui.button({ icon: '⇤', small: true, title: 'Outdent (Shift+Tab)', onClick: () => outdentIds(ordered()) }),
          ui.button({ label: '#', small: true, title: 'Add a tag to all of them', onClick: async () => { const n = await ui.prompt('Tag ' + ids.length + ' entries', '', 'tag name'); if (n) { await WB.api('entries.bulk', ids, { addTag: n }); ui.toast('Tagged ' + ids.length, '#'); } } }),
          ui.button({ label: 'Type', small: true, title: 'Change the type of all of them', onClick: ev => WB.ui.menu(WB.typeList().map(x => ({ label: x.name, icon: x.icon, onClick: async () => { await WB.api('entries.bulk', ids, { typeId: x.id }); ui.toast(ids.length + ' are now ' + x.plural.toLowerCase(), x.icon); paintSources(); } })), ev.currentTarget || bulkBar) }),
          ui.button({ label: 'Audience', small: true, onClick: ev => WB.ui.menu(WB.know.LEVELS.map(([v, l]) => ({ label: l, onClick: () => WB.api('entries.bulk', ids, { audience: v }) })), ev.currentTarget || bulkBar) }),
          ui.button({ label: '★', small: true, title: 'Add to favourites', onClick: () => WB.api('entries.bulk', ids, { favorite: true }) }),
          ui.button({ label: 'Delete', small: true, kind: 'danger', onClick: () => bulkDelete(ids) }),
          ui.button({ icon: '✕', small: true, kind: 'ghost', title: 'Clear the selection (Esc)', onClick: () => { selected.clear(); paintList(); } })]);
      }
      async function bulkDelete(ids) {
        const inside = ids.reduce((s, id) => s + (counts[id] || 0), 0);
        if (inside && !(await ui.confirm('Delete ' + ids.length + ' entries?', 'Everything inside them goes to the trash too' + (inside ? ' (' + WB.fmt.plural(inside, 'more entry', 'more entries') + ')' : '') + '. You can undo this.', 'Move to trash', true))) return;
        await WB.api('entries.bulk', ids, { trash: true }); selected.clear();
        WB.ui.undoToast(ids.length + ' entries moved to the trash', async () => { for (const id of ids) await WB.api('entries.restore', id).catch(() => {}); });
        if (current && ids.includes(current.id)) { current = null; paintEmpty(); }
        loadList(); paintSources();
      }

      /* ---------------- the entry page ---------------- */
      async function select(id, opts = {}) {
        if (!id) { current = null; paintEmpty(); return; }
        let e;
        try { e = await WB.api('entries.get', id); } catch (err) { current = null; paintEmpty(); return null; }
        if (destroyed) return;
        if (!WB.visible(e)) { ui.toast('That entry is hidden in Share view', '◑'); return; }
        current = e;
        st.patch({ last: id });
        WB.touch(id);
        WB.record('codex', { entryId: id });
        if (st.get().view === 'tree' && reveal(id)) paintList();   // an entry opened from elsewhere is shown, not hidden in a folded branch
        listBody.querySelectorAll('.wb-row').forEach(r => r.classList.toggle('on', r.dataset.id === id || selected.has(r.dataset.id)));
        const row = listBody.querySelector('.wb-row[data-id="' + id + '"]');
        if (row) row.scrollIntoView({ block: 'nearest' });
        paintEntry(opts);
      }
      function paintEmpty() {
        GK.clear(pagePane);
        const src = st.get().source, t = src.kind === 'type' ? WB.types.get(src.id) : null;
        pagePane.appendChild(h('div.gk-panel.cx-hello', [WB.ui.empty({
          icon: t ? t.icon : '❖', title: t ? t.plural : WB.world.name,
          text: t ? 'Pick one on the left, or add a new ' + t.name.toLowerCase() + '.' : 'Pick an entry on the left, search with Ctrl+K, or start something new.',
          actions: [ui.button({ label: t ? 'New ' + t.name.toLowerCase() : 'New entry', icon: '＋', kind: 'primary', onClick: () => newEntry() }), ui.button({ label: 'Quick capture', icon: '✚', onClick: () => WB.capture() })],
        })]));
      }

      let editor = null;
      function paintEntry(opts = {}) {
        if (editor) { editor.destroy(); editor = null; }
        GK.clear(pagePane);
        const e = current, t = WB.typeOf(e) || { name: 'Entry', fields: [], icon: '◇', color: '#9aa5b1' };
        const ro = WB.share || !!e.deletedAt;
        const save = WB.debounce(async (patch) => { lastSave = Date.now(); try { const n = await WB.api('entries.update', e.id, patch); Object.assign(current, { updatedAt: n.updatedAt, wordCount: n.wordCount }); footer(); } catch (err) { WB.fail(err); } }, 450);
        const saveNow = async (patch) => { lastSave = Date.now(); const n = await WB.api('entries.update', e.id, patch); current = Object.assign(current, n); lastSave = Date.now(); return n; };
        const fieldSavers = {};
        const saveField = (key, value) => { e.fields[key] = value; lastSave = Date.now(); (fieldSavers[key] || (fieldSavers[key] = WB.debounce(v => WB.api('entries.update', e.id, { fieldsPatch: { [key]: v } }).then(() => { lastSave = Date.now(); }).catch(WB.fail), 400)))(value); };

        /* header */
        const iconBtn = h('button.cx-bigicon', { type: 'button', title: ro ? '' : 'Change icon or colour', style: { '--c': WB.colorOf(e) }, text: WB.iconOf(e), onclick: ev => !ro && iconPicker(ev.currentTarget) });
        const title = h('input.cx-title', { value: e.title, spellcheck: false, readOnly: ro, 'aria-label': 'Title', placeholder: 'Untitled ' + t.name.toLowerCase() });
        title.addEventListener('input', () => { save({ title: title.value }); const r = listBody.querySelector('.wb-row[data-id="' + e.id + '"] .wb-row-title'); if (r && r.lastChild) r.lastChild.textContent = title.value; });
        title.addEventListener('keydown', ev => { if (ev.key === 'Enter') { ev.preventDefault(); summary.focus(); } });
        const crumb = h('div.cx-crumb');
        const aliasBox = h('div.cx-aliases');
        const paintAliases = () => {
          GK.clear(aliasBox);
          (e.aliases || []).forEach((a, i) => aliasBox.appendChild(h('span.wb-tagchip', [h('span', { text: a }), ro ? null : h('button.wb-chip-x', { type: 'button', text: '✕', title: 'Remove this name', onclick: () => { e.aliases.splice(i, 1); saveNow({ aliases: e.aliases }); paintAliases(); } })])));
          if (!ro) aliasBox.appendChild(h('button.cx-addlink', { type: 'button', text: e.aliases && e.aliases.length ? '＋' : '＋ also known as…', title: 'Other names find it in search and in @ links', onclick: async () => { const a = await ui.prompt('Also known as', '', 'another name'); if (a) { e.aliases = (e.aliases || []).concat(a); saveNow({ aliases: e.aliases }); paintAliases(); } } }));
        };
        paintAliases();
        // path: every ancestor opens on click, and the little arrow after each lists its siblings; the last one is this entry
        const sibMenu = async (p, anchorEl) => {
          const sibs = (await WB.api('entries.list', WB.worldId, { parentId: p.parentId || null, sort: 'position', limit: 80 }).catch(() => [])).filter(x => WB.visible(x));
          WB.ui.menu(sibs.length ? sibs.map(x => ({ label: x.title || 'Untitled', icon: WB.iconOf(x), checked: x.id === p.id, onClick: () => (x.id === e.id ? null : select(x.id)) })) : [{ label: 'No siblings', disabled: true }], anchorEl);
        };
        const crumbArrow = p => h('button.cx-crumb-sib', { type: 'button', text: '▾', title: 'Others at this level', 'aria-label': 'Others at this level', onclick: ev => sibMenu(p, ev.currentTarget) });
        const paintCrumb = path => {
          GK.clear(crumb);
          path.forEach(p => crumb.append(WB.ui.chip(p, { size: 'sm' }), crumbArrow(p), h('span.gk-faint.cx-crumb-sep', { text: '›' })));
          crumb.append(h('span.cx-crumb-here', { text: e.title || 'Untitled' }), crumbArrow(e));
        };
        paintCrumb([]);
        WB.api('entries.context', e.id).then(c => paintCrumb(c.breadcrumb.filter(p => p.id !== e.id))).catch(() => {});
        const fav = ui.button({ icon: e.favorite ? '★' : '☆', small: true, kind: 'ghost', title: e.favorite ? 'Remove from favourites' : 'Add to favourites', onClick: async () => { e.favorite = !e.favorite; await saveNow({ favorite: e.favorite }); fav.firstChild.textContent = e.favorite ? '★' : '☆'; fav.classList.toggle('on', e.favorite); } });
        fav.classList.toggle('on', e.favorite);
        const typeBtn = h('button.wb-type.cx-typebtn', { type: 'button', style: { '--c': t.color }, title: ro ? t.name : 'Change type', onclick: ev => !ro && WB.ui.menu(WB.typeList().filter(x => x.id !== e.typeId).map(x => ({ label: x.name, icon: x.icon, onClick: async () => { await saveNow({ typeId: x.id }); paintEntry(); paintSources(); } })), ev.currentTarget) }, [h('span.wb-type-ico', { text: t.icon }), h('span', { text: t.name })]);
        const aud = ro ? WB.ui.badge((WB.know.LEVELS.find(l => l[0] === e.audience) || [0, e.audience])[1]) : WB.ui.audience(e.audience, v => saveNow({ audience: v }));
        const lensLabel = { story: 'Write', map: 'Open map', board: 'Open board', language: 'Lexicon', table: 'Roll', encounter: 'Run' }[t.lens];
        const actions = h('div.cx-actions', [
          lensLabel ? ui.button({ label: lensLabel, icon: '⇱', small: true, onClick: () => WB.openLens(e) }) : null,
          fav,
          ui.button({ icon: '⋯', small: true, kind: 'ghost', title: 'More', onClick: ev => moreMenu(ev.currentTarget) }),
        ]);
        const head = h('header.cx-head', [
          e.deletedAt ? h('div.cx-banner', [h('span', { text: '🗑 In the trash since ' + WB.fmt.rel(e.deletedAt) }), h('span.gk-grow'),
            ui.button({ label: 'Restore', small: true, kind: 'primary', onClick: async () => { await WB.api('entries.restore', e.id); select(e.id); loadList(); paintSources(); } }),
            ui.button({ label: 'Delete for good', small: true, kind: 'danger', onClick: async () => { if (await ui.confirm('Delete for good?', '“' + e.title + '” and everything inside it are deleted permanently.', 'Delete', true)) { await WB.api('entries.purge', e.id); current = null; paintEmpty(); loadList(); paintSources(); } } })]) : null,
          e.inbox && !ro ? h('div.cx-banner.inbox', [h('span', { text: '✉ Waiting in the Inbox' }), h('span.gk-grow'),
            ui.button({ label: 'Keep it here (file it)', small: true, onClick: async () => { await saveNow({ inbox: false }); paintEntry(); loadList(); paintSources(); } }),
            ui.button({ label: 'Make it a…', small: true, onClick: ev => WB.ui.menu(WB.typeList().map(x => ({ label: x.name, icon: x.icon, onClick: async () => { await saveNow({ typeId: x.id, inbox: false }); paintEntry(); loadList(); paintSources(); } })), ev.currentTarget) })]) : null,
          crumb,
          h('div.cx-titlerow', [iconBtn, h('div.cx-titlebox', [title, aliasBox]), actions]),
          h('div.cx-meta', [typeBtn, aud, e.revealDay != null ? WB.ui.badge('revealed ' + WB.fmt.date({ day: e.revealDay, prec: 'day' }), 'warn') : null, dateLine(e)]),
        ]);

        /* dates */
        let dated = null;
        if (t.dated && !ro) dated = h('div.cx-dates', [WB.ui.dateRange({ start: e.start, end: t.dated.end ? e.end : null, labels: { start: t.dated.start, end: t.dated.end }, onChange: ({ start, end }) => { e.start = start; e.end = end; saveNow({ start, end: t.dated.end ? end : undefined }).then(() => { const dl = pagePane.querySelector('.cx-dateline'); if (dl) dl.replaceWith(dateLine(e)); }).catch(WB.fail); } })]);

        /* cover & summary */
        const cover = e.coverId ? h('div.cx-cover', [WB.ui.thumb(e.coverId, { cls: 'cx-cover-img' }), ro ? null : h('div.cx-cover-tools', [ui.button({ label: 'Change', small: true, onClick: setCover }), ui.button({ label: 'Remove', small: true, onClick: async () => { await saveNow({ coverId: null }); paintEntry(); } })])]) : null;
        const summary = ui.input({ multiline: true, rows: 1, value: e.summary, placeholder: 'One or two lines that sum it up — shown in previews, lists and on your site.', onInput: v => save({ summary: v }) });
        summary.classList.add('cx-summary'); summary.readOnly = ro;
        const fitSum = () => { summary.style.height = 'auto'; summary.style.height = summary.scrollHeight + 2 + 'px'; };
        summary.addEventListener('input', fitSum); requestAnimationFrame(fitSum);

        /* fields, grouped */
        const defs = (t.fields || []).filter(d => WB.fieldVisible(d));
        const fieldsBox = h('div.cx-fields');
        const groups = new Map();
        for (const d of defs) { const g = d.group || ''; if (!groups.has(g)) groups.set(g, []); groups.get(g).push(d); }
        for (const [g, list] of groups) {
          const filled = list.filter(d => WB.F.filled(d.kind, e.fields[d.key])).length;
          const sec = h('div.cx-fgroup', { class: g ? 'grouped' : '' }, [g ? h('div.cx-fgroup-head', [h('span', { text: g }), h('span.gk-faint.gk-small', { text: filled + '/' + list.length })]) : null,
            h('div.cx-fgrid', list.map(d => h('div.cx-field', { class: (['longtext', 'stats', 'refs', 'list', 'multi', 'image'].includes(d.kind) || d.wide || (d.kind === 'text' && String(e.fields[d.key] || '').length > 24) ? 'wide' : '') + (d.secret ? ' secret' : ''), 'data-field': d.key }, [
              h('div.cx-flabel', [h('span', { text: d.label }), d.secret ? h('span.cx-secret', { text: '◐', title: 'Secret: only you see this field' }) : null, d.required && !WB.F.filled(d.kind, e.fields[d.key]) ? h('span.cx-req', { text: '•', title: 'Recommended for every ' + t.name.toLowerCase() }) : null, d.hint ? h('span.cx-hint', { text: 'ⓘ', title: d.hint }) : null]),
              WB.ui.field(d, e.fields[d.key], v => saveField(d.key, v), { readOnly: ro }),
            ])))]);
          fieldsBox.appendChild(sec);
        }
        const orphanKeys = Object.keys(e.fields || {}).filter(k => !(t.fields || []).some(d => d.key === k) && e.fields[k] != null && e.fields[k] !== '' && typeof e.fields[k] !== 'object');
        if (orphanKeys.length && !WB.share) fieldsBox.appendChild(h('div.cx-orphans.gk-small.gk-muted', [h('span', { text: 'Kept from removed fields: ' }), ...orphanKeys.map(k => h('span.wb-tagchip', { text: k + ': ' + String(e.fields[k]).slice(0, 40) }))]));
        if (!ro) fieldsBox.appendChild(h('div.cx-fields-foot', [h('button.cx-addlink', { type: 'button', text: '⚙ Edit the ' + t.name.toLowerCase() + ' template', title: 'Add, rename or reorder fields for every ' + t.name.toLowerCase(), onclick: () => WB.go('world', { tab: 'types', typeId: t.id }) })]));

        /* body */
        const wordsOut = h('span.gk-small.gk-muted');
        editor = WB.editor.create({ value: e.body, placeholder: 'Write about ' + (e.title || 'it') + '… Type @ to link another entry — or to create one on the spot.', readOnly: ro, onWords: n => { wordsOut.textContent = WB.fmt.words(n); }, onChange: html => { lastSave = Date.now(); WB.api('entries.update', e.id, { body: html }).then(n => { current.wordCount = n.wordCount; lastSave = Date.now(); footer(); }).catch(WB.fail); } });

        const kidsBox = h('div.cx-childbox');
        const side = h('aside.cx-side');
        const main = h('div.cx-main', [
          head, dated, cover,
          h('div.gk-panel.cx-card', [summary, defs.length ? fieldsBox : (!ro ? h('div.gk-small.gk-muted.cx-nofields', ['This type has no fields yet. ', h('button.cx-addlink', { type: 'button', text: 'Add some', onclick: () => WB.go('world', { tab: 'types', typeId: t.id }) })]) : null)]),
          h('div.gk-panel.cx-card.cx-bodycard', [h('div.cx-card-head', [h('h4', { text: 'Notes & story' }), wordsOut]), editor.el]),
          kidsBox,
          h('div.cx-foot.gk-tiny.gk-faint'),
        ]);
        pagePane.append(h('div.cx-pagegrid', [main, side]));
        // continuity: errors and warnings show as a banner under the title (the side card lists everything)
        e._issues = WB.share ? Promise.resolve([]) : WB.api('checks.entry', WB.worldId, e.id).catch(() => []);
        e._issues.then(list => {
          const serious = (list || []).filter(i => i.severity === 'error' || i.severity === 'warn');
          if (!serious.length || !head.isConnected) return;
          const first = serious[0];
          head.appendChild(h('div.cx-banner.issue', { class: first.severity }, [
            h('span', { text: (first.severity === 'error' ? '✖ ' : '⚠ ') + first.title }),
            serious.length > 1 ? h('span.gk-small.gk-muted', { text: ' and ' + (serious.length - 1) + ' more' }) : null,
            h('span.gk-grow'),
            ui.button({ label: 'Fix…', small: true, onClick: () => WB.go('checks', { key: first.key }) }),
          ]));
        });
        footer();
        paintChildren(kidsBox, e, t, ro);
        paintSide(side, e, t, ro);
        if (opts.focusTitle && !ro) setTimeout(() => { title.focus(); title.select(); }, 60);
        // WB.open(id, { field }) (e.g. a Checks "Fill in …" fix): bring that field into view and put the cursor in it
        if (opts.field) setTimeout(() => {
          const f = pagePane.querySelector('.cx-field[data-field="' + CSS.escape(opts.field) + '"]');
          if (!f) return;
          f.scrollIntoView({ block: 'center', behavior: 'smooth' });
          f.classList.remove('flash'); void f.offsetWidth; f.classList.add('flash');
          const inp = !ro && f.querySelector('input:not([type=checkbox]), textarea, select, [contenteditable="true"]');
          if (inp) inp.focus({ preventScroll: true });
        }, 120);

        async function setCover() { const m = await WB.ui.pickMedia({ kind: 'image', title: 'Choose a cover' }); if (m) { await saveNow({ coverId: m.id }); paintEntry(); } }
        function iconPicker(anchor) {
          let pop;
          const grid = h('div.cx-symgrid', SYMBOLS.map(s => h('button', { type: 'button', text: s, onclick: async () => { await saveNow({ icon: s }); pop.close(); paintEntry(); } })));
          const col = ui.color({ value: e.color || t.color, onInput: WB.debounce(async v => { await saveNow({ color: v }); iconBtn.style.setProperty('--c', v); }, 200) });
          pop = WB.ui.popover(anchor, h('div.cx-iconpick', [grid, h('div.gk-row', [h('span.gk-small', { text: 'Colour' }), col, h('span.gk-grow'), ui.button({ label: 'Use the type\'s', small: true, kind: 'ghost', onClick: async () => { await saveNow({ icon: '', color: '' }); pop.close(); paintEntry(); } })])]), { width: '22em' });
        }
        function moreMenu(anchor) {
          WB.ui.menu([
            { label: 'Peek', icon: '◫', onClick: () => WB.peek(e.id) },
            { label: e.coverId ? 'Change the cover…' : 'Add a cover image…', icon: '▣', onClick: setCover },
            { label: 'Reveal to players on…', icon: '◷', hint: 'Hidden in Share view and shared exports until the world reaches this date', onClick: () => revealDialog() },
            { label: 'Add a task for this…', icon: '☐', onClick: async () => { const n = await ui.prompt('New task', '', 'What needs doing?'); if (n) { await WB.api('tasks.save', { worldId: WB.worldId, title: n, entryId: e.id }); select(e.id); } } },
            { label: 'Versions…', icon: '◷', onClick: () => versions(e) },
            { label: 'Copy as Markdown', icon: '⎘', onClick: async () => { await navigator.clipboard.writeText('# ' + e.title + '\n\n' + (e.summary ? '> ' + e.summary + '\n\n' : '') + WB.text.toMarkdown(WB.strip(e.body), { link: (id, l) => '[[' + (WB.titleOf(id) || l) + ']]' })); ui.toast('Copied as Markdown', '⎘'); } },
            '-',
            { label: 'Duplicate', icon: '⧉', hint: counts[e.id] ? 'Just this entry, without what is inside it' : undefined, onClick: async () => { const c = await WB.api('entries.duplicate', e.id, { children: false }); await loadList(); select(c.id); } },
            counts[e.id] ? { label: 'Duplicate with everything inside', icon: '⧉', hint: WB.fmt.plural(counts[e.id], 'entry', 'entries') + ' are copied too', onClick: async () => { const c = await WB.api('entries.duplicate', e.id, { children: true }); await loadList(); select(c.id); } } : null,
            { label: 'Move to…', icon: '⇲', onClick: async () => { if (await WB.tree.moveDialog([e.id])) select(e.id); } },
            { label: 'Merge into…', icon: '⤞', onClick: () => WB.ui.mergeDialog(e) },
            { label: 'Copy mention', icon: '@', hint: 'Paste it into any text to link this entry', onClick: () => WB.copyMention(e) },
            '-',
            { label: 'Move to trash', icon: '🗑', kbd: 'Del', danger: true, onClick: async () => { await WB.ui.confirmTrash(e); current = null; paintEmpty(); loadList(); paintSources(); } },
          ], anchor);
        }
        async function revealDialog() {
          let v = e.revealDay != null ? { day: e.revealDay, prec: 'day' } : null;
          const ok = await ui.dialog({ title: 'Reveal on a world date', icon: '◷', body: h('div.gk-stack', [h('p.gk-small.gk-muted', { text: 'Until the world reaches this date, “' + e.title + '” stays hidden in Share view and in shared exports — perfect for secrets your players will discover later.' }), WB.ui.dateInput({ value: v, onChange: d => { v = d; } })]), actions: [{ label: 'Cancel', value: false }, { label: 'Clear', value: 'clear' }, { label: 'Set', kind: 'primary', value: true }] });
          if (ok === 'clear') { await saveNow({ revealDay: null }); paintEntry(); }
          else if (ok && v) { await saveNow({ revealDay: v.day }); paintEntry(); }
        }
        function footer() {
          const f = pagePane.querySelector('.cx-foot');
          if (f) f.textContent = 'Created ' + WB.fmt.real(current.createdAt) + ' · edited ' + WB.fmt.rel(current.updatedAt) + ' · ' + WB.fmt.words(current.wordCount);
        }
      }
      function dateLine(e) {
        const age = WB.fmt.age(e), span = WB.fmt.span(e);
        const dead = e.end && e.end.day <= WB.now.day;
        return h('span.cx-dateline.gk-small.gk-muted', { text: [span, age != null ? (dead ? 'lived ' + age + ' years' : 'age ' + age) : ''].filter(Boolean).join(' · ') });
      }
      async function paintChildren(box, e, t, ro) {
        const [kids, cnt] = await Promise.all([WB.api('entries.list', WB.worldId, { parentId: e.id, sort: 'position' }).catch(() => []), WB.api('entries.descendantCounts', WB.worldId).catch(() => ({}))]);
        if (destroyed || !box.isConnected) return;
        const vis = kids.filter(k => WB.visible(k));
        const total = cnt[e.id] || 0;
        const nests = t.hierarchical || (t.childTypes || []).length > 0;
        if (!vis.length && ro) return;
        const refresh = () => { GK.clear(box); paintChildren(box, e, t, ro); loadList(); };
        // suggested child types first (the type's own list, itself when it nests), then everything else
        const sug = WB.F.childChoices(t).map(k => WB.type(k)).filter(Boolean);
        const others = WB.typeList().filter(x => !sug.includes(x));
        let childType = sug[0] || t;
        const typeSel = ui.select({ value: childType.id, options: sug.map(x => [x.id, x.icon + '  ' + x.name]).concat(sug.length && others.length ? [['', '──────']] : [], others.map(x => [x.id, x.icon + '  ' + x.name])), onChange: v => { if (v && WB.types.get(v)) { childType = WB.types.get(v); input.placeholder = ph(); } else typeSel.value = childType.id; } });
        typeSel.title = 'Type of what you add';
        const ph = () => '＋ Add ' + (/^[aeiou]/i.test(childType.name) ? 'an ' : 'a ') + childType.name.toLowerCase() + ' inside — type a name, press Enter';
        const input = h('input.cx-quickadd', { placeholder: ph(), 'aria-label': 'Add inside' });
        input.addEventListener('keydown', async ev => {
          if (ev.key !== 'Enter' || !input.value.trim()) return;
          try { await WB.api('entries.create', { worldId: WB.worldId, typeId: childType.id, title: input.value.trim(), parentId: e.id }); input.value = ''; refresh(); setTimeout(() => { const n = box.querySelector('.cx-quickadd'); if (n) n.focus(); }, 80); } catch (err) { WB.fail(err); }
        });
        const list = h('div.cx-kids', { role: 'list' });
        vis.forEach((k, i) => {
          const row = WB.ui.row(k, { sub: [(WB.typeOf(k) || {}).name, k.summary].filter(Boolean).join(' · '), onClick: (x, ev) => (ev.ctrlKey || ev.metaKey ? WB.peek(x.id) : select(x.id)),
            trailing: h('span.cx-tail', [cnt[k.id] ? h('span.cx-count.gk-tiny', { title: WB.fmt.plural(cnt[k.id], 'entry', 'entries') + ' inside', text: cnt[k.id] }) : null,
              ro ? null : h('button.cx-mini', { type: 'button', text: '↑', title: 'Move up', disabled: i === 0, onclick: async ev => { ev.stopPropagation(); await WB.api('entries.shift', k.id, -1); refresh(); } }),
              ro ? null : h('button.cx-mini', { type: 'button', text: '↓', title: 'Move down', disabled: i === vis.length - 1, onclick: async ev => { ev.stopPropagation(); await WB.api('entries.shift', k.id, 1); refresh(); } })]) });
          list.appendChild(row);
        });
        const menu = ev => WB.ui.menu([
          { label: 'Sort A–Z', icon: '↕', onClick: async () => { await WB.api('entries.reorder', vis.slice().sort((a, b) => a.title.localeCompare(b.title, undefined, { numeric: true })).map(k => k.id)); refresh(); } },
          { label: 'Move everything up a level', icon: '⇤', hint: 'The contents sit beside “' + e.title + '” instead of inside it', disabled: !vis.length, onClick: async () => { if (await WB.tree.move(vis.map(k => k.id), { parentId: e.parentId || null, afterId: e.id })) { refresh(); } } },
          { label: 'Move everything to…', icon: '⇲', disabled: !vis.length, onClick: async () => { if (await WB.tree.moveDialog(vis.map(k => k.id))) refresh(); } },
        ], ev.currentTarget);
        const card = h('div.gk-panel.cx-card.cx-contents', [
          h('div.cx-card-head', [h('h4', { text: 'Contents' + (vis.length ? ' · ' + WB.fmt.plural(vis.length, 'entry', 'entries') : '') }), total > vis.length ? h('span.gk-small.gk-muted', { text: total + ' in all, at any depth' }) : null, h('span.gk-grow'),
            ro ? null : h('div.gk-row.nowrap', sug.slice(0, 3).map(x => ui.button({ label: x.name, icon: '＋', small: true, title: 'New ' + x.name.toLowerCase() + ' inside “' + e.title + '”', onClick: async () => { const c = await WB.ui.createDialog({ type: x.key, parentId: e.id, open: false }); if (c) refresh(); } })).concat(vis.length ? [ui.button({ icon: '⋯', small: true, kind: 'ghost', title: 'More', onClick: menu })] : []))]),
          vis.length ? list : h('p.gk-small.gk-muted', { text: nests ? 'Nothing inside yet. ' + (childType.key === 'place' ? 'Districts, buildings, landmarks…' : 'Add the first one below.') : 'Nothing inside. Any entry can hold others: add one below, or drag entries here.' }),
          ro ? null : h('div.cx-quickrow', [typeSel, input]),
        ]);
        if (!ro) WB.dnd.accept(card, async id => { if (id !== e.id && await WB.tree.move([id], { parentId: e.id })) refresh(); });
        box.appendChild(card);
        WB.ui.listKeys(list);
      }

      /* side: tags, relations, family, backlinks, maps, boards, history, tasks, versions */
      async function paintSide(side, e, t, ro) {
        const c = await WB.api('entries.context', e.id).catch(() => null);
        if (!c || destroyed || !side.isConnected) return;
        const card = (title, body, actions, cls) => h('div.gk-panel.cx-card.cx-sidecard', { class: cls || '' }, [h('div.cx-card-head', [h('h4', { text: title }), actions ? h('div.gk-row.nowrap', [].concat(actions)) : null]), body]);
        const tagBox = ro ? h('div.wb-chips', (e.tags || []).map(id => WB.ui.tagChip(id))) : WB.ui.tagEditor(e.tags || [], ids => WB.api('entries.setTags', e.id, ids).then(() => { lastSave = Date.now(); }).catch(WB.fail));
        side.appendChild(card('Tags', tagBox));
        // relations by category
        const rels = c.relations.filter(r => WB.visible(r.other));
        const relBody = h('div.cx-rels');
        const cats = new Map();
        for (const r of rels) { const k = r.category || 'other'; if (!cats.has(k)) cats.set(k, []); cats.get(k).push(r); }
        for (const [k, list] of cats) {
          relBody.appendChild(h('div.cx-relcat', { text: (WB.F.CATEGORIES.find(x => x[0] === k) || [k, k])[1] }));
          for (const r of list) {
            const when = r.link.startDay != null || r.link.endDay != null ? WB.fmt.range(WB.linkDate(r.link, 'start'), WB.linkDate(r.link, 'end')) : '';
            relBody.appendChild(h('div.cx-rel', { style: { '--c': r.color || 'var(--muted)' } }, [h('span.cx-rel-lbl', { text: r.label }), WB.ui.chip(r.other, { size: 'sm' }), when ? h('span.gk-tiny.gk-muted', { text: when }) : null, r.link.note ? h('span.gk-tiny.gk-muted.cx-relnote', { text: '— ' + r.link.note, title: r.link.note }) : null,
              ro ? null : h('button.cx-rel-edit', { type: 'button', text: '⋯', title: 'Edit this relation', onclick: ev => relMenu(ev.currentTarget, r) })]));
          }
        }
        if (!rels.length) relBody.appendChild(h('p.gk-small.gk-muted', { text: ro ? 'No relations.' : 'Family, allies, rivals, rulers, homes… Press ＋ or drop an entry here.' }));
        const relCard = card('Relations', relBody, ro ? null : ui.button({ icon: '＋', small: true, title: 'Add a relation', onClick: () => addRelation(e) }));
        if (!ro) WB.dnd.accept(relCard, id => addRelation(e, id));
        side.appendChild(relCard);
        // family snippet (Web screen)
        if (WB.web && WB.web.familyMini && t.lifespan && rels.some(r => r.familyRole)) { const fm = h('div.cx-family'); side.appendChild(card('Family', fm, ui.button({ label: 'Tree', small: true, kind: 'ghost', onClick: () => WB.go('web', { tab: 'family', entryId: e.id }) }))); try { WB.web.familyMini(fm, e.id); } catch (err) { console.warn(err); } }
        // backlinks
        const back = c.mentionedBy.concat(c.referencedBy).filter(x => WB.visible(x.entry));
        if (back.length) {
          const byKey = new Map();
          for (const x of back) { const k = x.link.kind === 'mention' ? 'Mentioned in' : 'Listed as “' + (x.link.label || x.link.key) + '” in'; if (!byKey.has(k)) byKey.set(k, new Map()); byKey.get(k).set(x.entry.id, x.entry); }
          side.appendChild(card('Linked from', h('div.cx-backs', [...byKey].map(([k, m]) => h('div.cx-back', [h('div.gk-tiny.gk-muted', { text: k }), h('div.wb-chips', [...m.values()].map(x => WB.ui.chip(x, { size: 'sm' })))])))));
        }
        if (!ro) WB.api('links.unlinked', WB.worldId, { targetId: e.id }).then(list => {
          list = (list || []).filter(x => WB.liteOf(x.src));
          if (!list.length || !side.isConnected) return;
          const box = h('div.cx-unlinked', [
            h('p.gk-small.gk-muted', { text: (list.length === 1 ? '1 entry names' : list.length + ' entries name') + ' “' + e.title + '” without linking it.' }),
            h('div.wb-chips', list.slice(0, 16).map(x => WB.ui.chip(x.src, { size: 'sm' }))),
            h('div.gk-row', [ui.button({ label: 'Link them', icon: '☍', small: true, kind: 'primary', onClick: async () => { const r = await WB.api('links.linkUnlinked', WB.worldId, list.map(x => ({ src: x.src, target: x.target }))); ui.toast('Linked ' + r.linked + ' mentions', '☍'); } })]),
          ]);
          side.appendChild(card('Unlinked mentions', box));
        }).catch(() => {});
        const out = [...new Map(c.mentions.concat(c.references).filter(x => WB.visible(x.entry)).map(x => [x.entry.id, x.entry])).values()];
        if (out.length) side.appendChild(card('Links to', h('div.wb-chips', out.map(x => WB.ui.chip(x, { size: 'sm' })))));
        // maps & boards (their screens provide these when present)
        WB.api('atlas.appearances', e.id).then(list => {
          if (!list || !list.length || !side.isConnected) return;
          const box = h('div.cx-maps');
          if (WB.atlas && WB.atlas.mini) { const mini = h('div.cx-minimap'); box.appendChild(mini); try { WB.atlas.mini(mini, { entryId: e.id }); } catch (err) { console.warn(err); } }
          const seen = new Map();
          for (const a of list) { const id = a.map ? a.map.id : a.mapId; if (!seen.has(id)) seen.set(id, a); }
          box.appendChild(h('div.wb-chips', [...seen.values()].map(a => h('button.wb-tagchip.btn', { type: 'button', style: { '--c': '#6dbb6f' }, onclick: () => WB.go('atlas', { entryId: a.map ? a.map.id : a.mapId, itemId: a.item && a.item.id }) }, ['⌖ ' + ((a.map && a.map.title) || a.mapTitle || 'Map')]))));
          side.insertBefore(card('On maps', box), side.children[2] || null);
        }).catch(() => {});
        WB.api('boards.appearances', e.id).then(list => {
          if (!list || !list.length || !side.isConnected) return;
          const seen = new Map();
          for (const a of list) { const id = a.board ? a.board.id : a.boardId; if (!seen.has(id)) seen.set(id, a); }
          side.appendChild(card('On boards', h('div.wb-chips', [...seen.values()].map(a => h('button.wb-tagchip.btn', { type: 'button', style: { '--c': '#d97f9f' }, onclick: () => WB.go('boards', { entryId: a.board ? a.board.id : a.boardId }) }, ['▦ ' + ((a.board && a.board.title) || a.boardTitle || 'Board')])))));
        }).catch(() => {});
        // continuity issues about this entry (Checks screen) — shown only when there are some, near the top
        if (!WB.share) (e._issues || WB.api('checks.entry', WB.worldId, e.id)).then(list => {
          if (!list || !list.length || !side.isConnected) return;
          const SEV = { error: ['✖', 'error'], warn: ['⚠', 'warn'], info: ['ⓘ', 'info'] };
          const rows = list.slice(0, 5).map(i => h('button.cx-issue', { type: 'button', class: (SEV[i.severity] || SEV.info)[1], title: 'Open in Checks', onclick: () => WB.go('checks', { key: i.key }) }, [h('span.cx-issue-ico', { text: (SEV[i.severity] || SEV.info)[0] }), h('span.gk-grow', { text: i.title })]));
          if (list.length > 5) rows.push(h('div.gk-tiny.gk-muted', { text: '+ ' + (list.length - 5) + ' more' }));
          side.insertBefore(card('Continuity', h('div.cx-issues', rows), ui.button({ label: 'All', small: true, kind: 'ghost', onClick: () => WB.go('checks', { entryId: e.id }) }), 'cx-continuity'), side.children[1] || null);
        }).catch(() => {});
        // history (Chronicle screen)
        if (WB.chronicle && WB.chronicle.annalsPanel) { try { const p = WB.chronicle.annalsPanel(e); if (p) side.appendChild(card('History', p, ui.button({ label: 'Annals', small: true, kind: 'ghost', onClick: () => WB.go('chronicle', { tab: 'annals', entryId: e.id }) }), 'cx-history')); } catch (err) { console.warn(err); } }
        // tasks
        const tasks = await WB.api('tasks.list', WB.worldId, { entryId: e.id }).catch(() => []);
        if (side.isConnected && (tasks.length || !ro)) {
          const tb = h('div.cx-tasks');
          const paintTasks = list => {
            GK.clear(tb);
            list.forEach(x => tb.appendChild(h('label.cx-task', { class: x.done ? 'done' : '' }, [h('input', { type: 'checkbox', checked: x.done, disabled: ro, onchange: async () => { await WB.api('tasks.toggle', x.id); paintTasks(await WB.api('tasks.list', WB.worldId, { entryId: e.id })); } }), h('span.gk-grow', { text: x.title }), x.due ? h('span.gk-tiny', { class: !x.done && x.due < WB.today() ? 'cx-overdue' : 'gk-muted', text: WB.fmt.real(x.due) }) : null])));
            if (!ro) {
              const inp = h('input.wb-chip-input.cx-taskadd', { placeholder: '＋ Add a task and press Enter' });
              inp.addEventListener('keydown', async ev => { if (ev.key === 'Enter' && inp.value.trim()) { await WB.api('tasks.save', { worldId: WB.worldId, title: inp.value.trim(), entryId: e.id }); paintTasks(await WB.api('tasks.list', WB.worldId, { entryId: e.id })); const n = tb.querySelector('.cx-taskadd'); if (n) n.focus(); } });
              tb.appendChild(inp);
            }
          };
          paintTasks(tasks);
          side.appendChild(card('Tasks', tb));
        }
        if (c.revisions && !ro) side.appendChild(h('button.cx-addlink.cx-versions', { type: 'button', text: '◷ ' + WB.fmt.plural(c.revisions, 'earlier version'), onclick: () => versions(e) }));
      }
      function relMenu(anchor, r) {
        WB.ui.menu([
          { label: 'Note…', icon: '✎', onClick: async () => { const n = await ui.prompt('Note on this relation', r.link.note, 'e.g. since the Salt War'); if (n != null) await WB.api('links.update', r.link.id, { note: n }); } },
          { label: 'When…', icon: '◷', onClick: () => relDates(r) },
          { label: 'Change kind', icon: '⇄', sub: WB.relTypes.map(x => ({ label: x.symmetric ? x.name : x.name + ' / ' + x.inverse, checked: x.id === r.link.relId, onClick: () => WB.api('links.update', r.link.id, { relId: x.id }) })) },
          !r.symmetric ? { label: 'Swap direction', icon: '⇅', onClick: () => WB.api('links.update', r.link.id, { swap: true }) } : null,
          '-',
          { label: 'Remove relation', icon: '✕', danger: true, onClick: async () => { await WB.api('links.remove', r.link.id); WB.ui.undoToast('Relation removed', () => WB.api('links.relate', { src: r.link.src, dst: r.link.dst, relId: r.link.relId, note: r.link.note, start: WB.linkDate(r.link, 'start'), end: WB.linkDate(r.link, 'end') })); } },
        ], anchor);
      }
      async function relDates(r) {
        let a = WB.linkDate(r.link, 'start'), b = WB.linkDate(r.link, 'end');
        const ok = await ui.dialog({ title: 'When was this true?', icon: '◷', body: WB.ui.dateRange({ start: a, end: b, labels: { start: 'From', end: 'Until' }, onChange: v => { a = v.start; b = v.end; } }), actions: [{ label: 'Cancel', value: false }, { label: 'Save', kind: 'primary', value: true }] });
        if (ok) await WB.api('links.update', r.link.id, { start: a, end: b });
      }
      async function addRelation(e, presetId) {
        let target = presetId ? WB.liteOf(presetId) : null, choice = null, note = '', start = null, end = null, rq = '';
        const opts = [];
        for (const r of WB.relTypes) { opts.push({ relId: r.id, dir: 'out', label: r.name, cat: r.category }); if (!r.symmetric) opts.push({ relId: r.id, dir: 'in', label: r.inverse, cat: r.category }); }
        const tBox = h('div.gk-row.nowrap');
        const paintT = () => { GK.clear(tBox); tBox.append(target ? WB.ui.chip(target, { size: 'sm', onRemove: () => { target = null; paintT(); } }) : h('span.gk-muted.gk-small', { text: 'Nobody yet' }), ui.button({ label: target ? 'Change…' : 'Choose…', small: true, onClick: async () => { const p = await WB.ui.pickEntry({ title: 'Related to…', exclude: [e.id], allowCreate: true }); if (p) { target = p; paintT(); } } })); };
        paintT();
        const list = h('div.cx-relopts');
        const paintOpts = () => {
          GK.clear(list);
          for (const [cat, label] of WB.F.CATEGORIES) {
            const os = opts.filter(o => o.cat === cat && (!rq || o.label.includes(rq)));
            if (!os.length) continue;
            list.appendChild(h('div.cx-relcat', { text: label }));
            list.appendChild(h('div.wb-chips', os.map(o => ui.chip({ label: o.label, on: choice === o, onClick: () => { choice = o; paintOpts(); } }))));
          }
        };
        paintOpts();
        const ok = await ui.dialog({ title: 'Add a relation', icon: '☍', body: h('div.cx-reldialog', [
          h('div.gk-small.gk-muted', { text: '“' + e.title + '” is …' }),
          WB.ui.search({ placeholder: 'Find a kind of relation', onInput: v => { rq = v.toLowerCase(); paintOpts(); } }), list,
          ui.field({ label: '… of', control: tBox }),
          h('div.cx-relmore', [ui.field({ label: 'Note', control: ui.input({ placeholder: 'optional', onInput: v => { note = v; } }) }), WB.ui.dateRange({ labels: { start: 'From', end: 'Until' }, onChange: v => { start = v.start; end = v.end; } })]),
          h('p.gk-tiny.gk-faint', { text: 'Need another kind? World settings → Structure → Relations lets you add your own.' }),
        ]), actions: [{ label: 'Cancel', value: false }, { label: 'Add', kind: 'primary', value: true }] });
        if (!ok) return;
        if (!target || !choice) return ui.toast('Pick a kind of relation and who it is with', 'ℹ');
        const src = choice.dir === 'out' ? e.id : target.id, dst = choice.dir === 'out' ? target.id : e.id;
        try { await WB.api('links.relate', { src, dst, relId: choice.relId, note, start, end }); ui.toast('Related', '☍'); } catch (err) { WB.fail(err); }
      }
      async function versions(e) {
        const list = await WB.api('revisions.list', e.id);
        const preview = h('div.cx-rev-preview');
        const side = h('div.cx-rev-list');
        let chosen = null;
        const show = async (r) => {
          chosen = r;
          side.querySelectorAll('.cx-rev').forEach(x => x.classList.toggle('on', x.dataset.id === r.id));
          const v = await WB.api('revisions.get', r.id), now = await WB.api('entries.get', e.id);
          const was = WB.text.text(v.body).split('\n').filter(Boolean), is = new Set(WB.text.text(now.body).split('\n').filter(Boolean)), wasSet = new Set(was);
          GK.clear(preview);
          GK.append(preview, [h('h3', { text: v.title }), v.summary ? h('p.gk-muted', { text: v.summary }) : null,
            h('div.cx-diff', was.map(p => h('p', { class: is.has(p) ? '' : 'gone', text: p })).concat([...is].filter(p => !wasSet.has(p)).map(p => h('p.added', { text: p })))),
            h('p.gk-tiny.gk-faint', { text: 'Struck through: only in this version. Highlighted: added since.' })]);
        };
        list.forEach(r => side.appendChild(h('div.cx-rev', { dataset: { id: r.id }, tabindex: 0, onclick: () => show(r) }, [h('b', { text: WB.fmt.rel(r.createdAt) }), h('span.gk-tiny.gk-muted', { text: (r.reason || '') + ' · ' + WB.fmt.words(r.words) })])));
        if (!list.length) side.appendChild(h('p.gk-small.gk-muted', { text: 'No earlier versions yet. One is kept automatically every ten minutes of editing.' }));
        if (list[0]) setTimeout(() => show(list[0]), 0);
        const ok = await ui.dialog({ title: 'Versions of ' + e.title, icon: '◷', body: h('div.cx-revs', [side, preview]), actions: [{ label: 'Close', value: false }, { label: 'Restore this version', kind: 'primary', value: true }] });
        if (ok && chosen) { await WB.api('revisions.restore', chosen.id); ui.toast('Restored — the text you had is kept as a version', '◷'); select(e.id); }
      }

      /* ---------------- keys, live updates ---------------- */
      const onKey = ev => {
        if (GK.shell.current !== 'codex' || document.querySelector('.gk-scrim')) return;
        const typing = ev.target.closest && ev.target.closest('input, textarea, select, [contenteditable="true"]');
        if (ev.ctrlKey && ev.key.toLowerCase() === 'f') { ev.preventDefault(); search.querySelector('input').focus(); }
        else if (ev.key === 'F2' && current) { ev.preventDefault(); const t = pagePane.querySelector('.cx-title'); if (t) { t.focus(); t.select(); } }
        else if (ev.key === 'Delete' && !typing && selected.size > 1 && !WB.share) { ev.preventDefault(); bulkDelete([...selected]); }
        else if (ev.key === 'Delete' && !typing && current && !WB.share) { ev.preventDefault(); const e = current; WB.ui.confirmTrash(e).then(() => { current = null; paintEmpty(); loadList(); paintSources(); }); }
      };
      document.addEventListener('keydown', onKey);
      offs.push(() => document.removeEventListener('keydown', onKey));
      offs.push(WB.onChange(['entries', 'links', 'tags', 'types', 'collections', 'tasks', 'map_items', 'board_items'], async p => {
        if (destroyed) return;
        const mine = Date.now() - lastSave < 1500;
        await loadList(); paintSources();
        if (!current) return;
        const typing = pagePane.contains(document.activeElement) && document.activeElement.matches('input, textarea, [contenteditable="true"]');
        if ((p.ids || []).includes(current.id) && !mine && !typing) select(current.id);
        else if (!mine && (p.tables || []).some(t => ['links', 'tasks', 'map_items', 'board_items', 'tags'].includes(t))) {
          const side = pagePane.querySelector('.cx-side');
          if (side && !side.contains(document.activeElement)) { GK.clear(side); paintSide(side, current, WB.typeOf(current), WB.share || !!current.deletedAt); }
        }
      }, 200));
      offs.push(WB.on('share', () => { loadList(); if (current) select(current.id); }));

      // params: { typeId | typeKey } shows that type, { table: true|false } switches table view
      const pType = params.typeId || (params.typeKey && (WB.type(params.typeKey) || {}).id);
      if (pType) st.patch({ source: { kind: 'type', id: pType } });
      await paintSources();
      await loadList();
      if (params.table != null && !!params.table !== !!st.get().table) setTable(!!params.table);
      const want = params.entryId || st.get().last;
      if (want) {
        if (params.entryId && !entries.find(x => x.id === want)) { st.patch({ source: { kind: 'all' } }); await paintSources(); await loadList(); }
        await select(want, { focusTitle: !!params.focusTitle, field: params.field || null });
      } else paintEmpty();

      return () => { destroyed = true; offs.forEach(f => f()); if (editor) editor.destroy(); };
    },
  });

  WB.commands.add({ id: 'codex:trash', label: 'Open the trash', icon: '🗑', group: 'Go to', run: async () => { const s = await GK.store('codex', {}); s.patch({ source: { kind: 'trash' } }); WB.go('codex'); } });

  WB.smoke('codex-entry', async () => {
    const e = await WB.api('entries.find', WB.worldId, 'Gullhaven');
    if (!e) return (smokeResult = 'error: Gullhaven missing');
    await WB.open(e.id);
    await WB.wait(900);
    const title = document.querySelector('.cx-title');
    smokeResult = title && title.value === 'Gullhaven' ? 'ok' : 'error: the entry page did not open';
    return { result: smokeResult, fields: document.querySelectorAll('.cx-field').length, relations: document.querySelectorAll('.cx-rel').length };
  });
  WB.smoke('codex-character', async () => {
    const e = await WB.api('entries.find', WB.worldId, 'Brannoc Vey');
    await WB.open(e.id); await WB.wait(900);
    return { dateline: (document.querySelector('.cx-dateline') || {}).textContent || '', relations: document.querySelectorAll('.cx-rel').length };
  });
  /* nesting in the real UI: Tab indents, Alt+Up reorders, a drag reparents; the view switcher; the path above an entry */
  const nest = { ok: false };
  WB.smoke('codex-nesting', async () => {
    const mk = (title, parentId) => WB.api('entries.create', { worldId: WB.worldId, typeKey: 'place', title, parentId });
    const root = await mk('Smoke Root'), a = await mk('Smoke A', root.id), b = await mk('Smoke B', root.id);
    await WB.open(root.id); await WB.wait(900);
    const row = id => document.querySelector('.cx-rows .wb-row[data-id="' + id + '"]');
    const parentOf = async id => (await WB.api('entries.get', id)).parentId;
    const out = {};
    // Tab: B goes inside A
    row(b.id).focus();
    row(b.id).dispatchEvent(new KeyboardEvent('keydown', { key: 'Tab', bubbles: true, cancelable: true }));
    await WB.wait(1000);
    out.tab = (await parentOf(b.id)) === a.id;
    // Shift+Tab: back beside A
    row(b.id).focus();
    row(b.id).dispatchEvent(new KeyboardEvent('keydown', { key: 'Tab', shiftKey: true, bubbles: true, cancelable: true }));
    await WB.wait(1000);
    out.shiftTab = (await parentOf(b.id)) === root.id;
    // Alt+Up: B goes above A
    row(b.id).focus();
    row(b.id).dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowUp', altKey: true, bubbles: true, cancelable: true }));
    await WB.wait(1000);
    out.altUp = (await WB.api('entries.list', WB.worldId, { parentId: root.id, sort: 'position' })).map(e => e.title).join() === 'Smoke B,Smoke A';
    // drag: B onto the middle of A's row puts it inside A
    const dt = new DataTransfer();
    row(b.id).dispatchEvent(new DragEvent('dragstart', { bubbles: true, cancelable: true, dataTransfer: dt }));
    const r = row(a.id).getBoundingClientRect(), at = { bubbles: true, cancelable: true, dataTransfer: dt, clientX: r.left + 20, clientY: r.top + r.height / 2 };
    row(a.id).dispatchEvent(new DragEvent('dragover', at));
    out.hint = row(a.id).dataset.drop || '';
    row(a.id).dispatchEvent(new DragEvent('drop', at));
    await WB.wait(1100);
    out.drag = (await parentOf(b.id)) === a.id;
    nest.ok = out.tab && out.shiftTab && out.altUp && out.drag && out.hint === 'inside';
    nest.ids = { root: root.id, a: a.id, b: b.id };
    return out;
  });
  WB.smoke('codex-views', async () => {
    await GK.shell.go('codex'); await WB.wait(500);
    const pick = label => { const b = [...document.querySelectorAll('.cx-viewsw button, .cx-wideswitch button')].find(x => x.textContent.trim() === label); if (b) b.click(); return !!b; };
    const out = {};
    out.table = pick('Table'); await WB.wait(900);
    out.rows = document.querySelectorAll('.cx-tbl tbody tr').length;
    out.cards = pick('Cards'); await WB.wait(700);
    out.tiles = document.querySelectorAll('.cx-tile').length;
    out.back = pick('Tree'); await WB.wait(500);
    out.tree = document.querySelectorAll('.cx-rows .wb-row').length;
    nest.views = out.table && out.rows > 5 && out.cards && out.tiles > 5 && out.back && out.tree > 5;
    return out;
  });
  WB.smoke('codex-breadcrumb', async () => {
    const ids = nest.ids;
    if (!ids) return 'error: nesting step did not run';
    await WB.open(ids.b); await WB.wait(900);
    const chips = [...document.querySelectorAll('.cx-crumb .wb-chip')];
    const out = { chips: chips.map(c => c.textContent.trim()), siblings: document.querySelectorAll('.cx-crumb .cx-crumb-sib').length };
    chips[0] && chips[0].click(); await WB.wait(800);
    out.title = (document.querySelector('.cx-title') || {}).value;
    nest.crumb = out.chips.length === 2 && out.title === 'Smoke Root';
    return out;
  });
  WB.check('codex nesting: Tab, Shift+Tab, Alt+Up and drag reparent', () => { if (!nest.ok) throw new Error('see the codex-nesting step'); return true; });
  WB.check('codex views: table and cards render, tree comes back', () => { if (!nest.views) throw new Error('see the codex-views step'); return true; });
  WB.check('codex breadcrumb: ancestors listed and clickable', () => { if (!nest.crumb) throw new Error('see the codex-breadcrumb step'); return true; });
  WB.check('codex opens an entry page',() => { if (!/^ok/.test(smokeResult)) throw new Error(smokeResult); return true; });
})();
