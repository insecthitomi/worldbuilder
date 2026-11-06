/* Library: every image, recording, video and file of the world — filters, tags, preview, used-by, covers, trash. */
(function () {
  'use strict';
  const { h, ui } = GK;
  const KIT = 'src/app/modules/library/media-kit.js';
  const KINDS = [['', 'All'], ['image', 'Images'], ['audio', 'Audio'], ['video', 'Video'], ['file', 'Files']];
  const SORTS = [['new', 'Newest first'], ['old', 'Oldest first'], ['name', 'Name'], ['size', 'Largest first'], ['used', 'Used first']];
  const SIZES = [['s', 'S', 'Small thumbnails'], ['m', 'M', 'Medium thumbnails'], ['l', 'L', 'Large thumbnails']];
  const MEDIA_MIME = 'application/x-wb-media';
  let live = null;   // the mounted screen (palette commands talk to it)

  GK.modules.register({
    id: 'library',
    title: 'Library',
    icon: '▣',
    order: 110,
    subtitle: 'Images, audio and files for your world.',
    async mount(page, ctx) {
      if (!WB.worldId) {
        page.appendChild(WB.ui.empty({ icon: '▣', title: 'No world open', text: 'The Library keeps the pictures, recordings and files of a world. Create or open one first.', actions: [ui.button({ label: 'Create a world', kind: 'primary', onClick: () => WB.newWorld() })] }));
        return;
      }
      await WB.loadScript(KIT);
      const K = window.WBMediaKit;
      page.classList.add('lib-page');
      const store = await WB.store(ctx, { kind: '', sort: 'new', size: 'm', unused: false, tag: '' });
      const st = store.get();
      const S = { all: [], trash: [], unused: new Set(), q: '', trashView: false, sel: [], anchor: null, focus: null, alive: true };
      const params = WB.params('library') || {};
      if (params.trash) S.trashView = true;
      if (params.mediaId) S.sel = [params.mediaId];

      /* ---------- layout ---------- */
      const search = WB.ui.search({ placeholder: 'Search names, tags and notes', onInput: v => { S.q = v.trim().toLowerCase(); paintGrid(); } });
      const kindBox = h('div.lib-kinds');
      const unusedChip = ui.chip({ label: 'Unused', on: st.unused, title: 'Show only files nothing uses yet', onClick: () => { store.patch({ unused: !store.get().unused }); unusedChip.classList.toggle('on', store.get().unused); paintGrid(); } });
      const tagSel = ui.select({ value: st.tag, options: [['', 'Any tag']], onChange: v => { store.patch({ tag: v }); paintGrid(); } });
      tagSel.title = 'Filter by tag';
      const sortSel = ui.select({ value: st.sort, options: SORTS, onChange: v => { store.patch({ sort: v }); paintGrid(); } });
      sortSel.title = 'Sort';
      const sizeSeg = ui.segmented({ value: st.size, options: SIZES, onChange: v => { store.patch({ size: v }); grid.dataset.size = v; } });
      sizeSeg.classList.add('lib-size');
      const trashBtn = ui.button({ label: 'Trash', small: true, kind: 'ghost', title: 'Deleted files (restore them or delete them for good)', onClick: () => { S.trashView = !S.trashView; S.sel = []; paintAll(); } });
      const importBtn = ui.button({ label: 'Import…', icon: '⇪', kind: 'primary', title: 'Add files from your computer (or drop them anywhere here)', onClick: () => importFiles() });
      const bar = h('div.lib-bar', [h('div.lib-search', [search]), kindBox, unusedChip, h('span.gk-grow'), tagSel, sortSel, sizeSeg, trashBtn, WB.share ? null : importBtn]);
      const grid = h('div.lib-grid', { role: 'listbox', 'aria-multiselectable': 'true', 'aria-label': 'Media', dataset: { size: st.size } });
      const head = h('div.lib-head');
      const mainPanel = ui.panel({ cls: 'lib-main', body: [head, grid] });
      const aside = h('div.lib-aside');
      const bulk = h('div.lib-bulk.gk-dialog', { hidden: true });
      page.append(bar, h('div.lib-body', [mainPanel, aside]), bulk);

      /* ---------- data ---------- */
      async function load() {
        const [all, trash, unused] = await Promise.all([
          WB.api('media.list', WB.worldId, {}), WB.api('media.list', WB.worldId, { trashed: true }), WB.api('media.list', WB.worldId, { unused: true }),
        ]);
        if (!S.alive) return;
        S.all = all; S.trash = trash; S.unused = new Set(unused.map(m => m.id));
        S.sel = S.sel.filter(id => pool().some(m => m.id === id));
        paintBar(); paintGrid();
        // keep the drawer when someone is typing in it (a tag, the note)
        if (!aside.contains(document.activeElement) || !S.sel.length) paintAside();
      }
      const byId = id => S.all.find(m => m.id === id) || S.trash.find(m => m.id === id) || null;
      const pool = () => (S.trashView ? S.trash : S.all);
      function filtered() {
        const s = store.get(), q = S.q;
        const list = pool().filter(m => (!s.kind || m.kind === s.kind) && (S.trashView || !s.unused || S.unused.has(m.id)) && (!s.tag || (m.tags || []).includes(s.tag))
          && (!q || (m.name + ' ' + (m.tags || []).join(' ') + ' ' + (m.note || '') + ' ' + (m.mime || '')).toLowerCase().includes(q)));
        const newest = (a, b) => String(b.createdAt).localeCompare(String(a.createdAt));
        const by = { new: newest, old: (a, b) => -newest(a, b), name: (a, b) => a.name.localeCompare(b.name, undefined, { numeric: true }), size: (a, b) => (b.size || 0) - (a.size || 0), used: (a, b) => (S.unused.has(a.id) ? 1 : 0) - (S.unused.has(b.id) ? 1 : 0) || newest(a, b) }[s.sort] || newest;
        if (S.trashView) list.sort((a, b) => String(b.deletedAt).localeCompare(String(a.deletedAt))); else list.sort(by);
        return list;
      }

      /* ---------- painting ---------- */
      function paintAll() { paintBar(); paintGrid(); paintAside(); }
      function paintBar() {
        const s = store.get(), src = pool();
        GK.clear(kindBox);
        const counts = Object.fromEntries(KINDS.map(([k]) => [k, src.filter(m => !k || m.kind === k).length]));
        kindBox.appendChild(ui.segmented({ value: s.kind, options: KINDS.filter(([k]) => !k || counts[k] || s.kind === k).map(([k, l]) => [k, l + ' ' + counts[k], 'Show ' + l.toLowerCase()]), onChange: v => { store.patch({ kind: v }); paintGrid(); } }));
        unusedChip.style.display = S.trashView ? 'none' : '';
        unusedChip.replaceChildren('Unused ' + S.unused.size);
        const tags = [...new Set(S.all.flatMap(m => m.tags || []))].sort((a, b) => a.localeCompare(b));
        GK.clear(tagSel);
        [['', 'Any tag']].concat(tags.map(t => [t, '#' + t])).forEach(([v, l]) => tagSel.appendChild(h('option', { value: v, text: l })));
        tagSel.value = tags.includes(s.tag) ? s.tag : '';
        tagSel.style.display = tags.length ? '' : 'none';
        trashBtn.replaceChildren(h('span', { text: S.trashView ? '←' : '🗑' }), S.trashView ? 'Back to the Library' : 'Trash' + (S.trash.length ? ' ' + S.trash.length : ''));
        trashBtn.classList.toggle('on', S.trashView);
        page.classList.toggle('trash-view', S.trashView);
      }
      function paintGrid() {
        const list = filtered(), s = store.get();
        GK.clear(head); GK.clear(grid);
        GK.append(head, [h('div.gk-grow', [h('h3', { text: S.trashView ? 'Trash' : s.kind ? KINDS.find(k => k[0] === s.kind)[1] : 'Everything' }),
          h('div.gk-small.gk-muted', { text: S.trashView ? (S.trash.length ? 'Deleted files wait here until you delete them for good.' : '') : WB.fmt.plural(list.length, 'file') + (list.length !== pool().length ? ' of ' + pool().length : '') + ' · ' + WB.fmt.bytes(list.reduce((a, m) => a + (m.size || 0), 0)) })]),
          S.trashView && S.trash.length && !WB.share ? ui.button({ label: 'Empty trash', icon: '🗑', small: true, kind: 'danger', onClick: emptyTrash }) : null,
          list.length > 1 && !WB.share ? ui.button({ label: S.sel.length && S.sel.length === list.length ? 'Select none' : 'Select all', small: true, kind: 'ghost', title: 'Ctrl+A', onClick: () => { S.sel = S.sel.length === list.length ? [] : list.map(m => m.id); paintSel(); paintAside(); } }) : null]);
        if (!list.length) {
          grid.appendChild(S.trashView ? WB.ui.empty({ icon: '🗑', title: 'The trash is empty', text: 'Deleted pictures and recordings wait here, so nothing is lost by accident.' })
            : pool().length ? WB.ui.empty({ icon: '⌕', title: 'Nothing matches', text: 'Try another search, kind or tag.', actions: [ui.button({ label: 'Clear filters', onClick: clearFilters })] })
              : WB.ui.empty({ icon: '▣', title: 'Your Library is empty', text: 'Drop pictures, maps, recordings or documents anywhere on this page, or import them. Everything is copied into the world, so moving the originals never breaks anything.', actions: WB.share ? [] : [ui.button({ label: 'Import files…', icon: '⇪', kind: 'primary', onClick: importFiles }), WB.voice ? ui.button({ label: 'Record a voice memo', icon: '●', onClick: () => WB.voice.record() }) : null] }));
          paintBulk();
          return;
        }
        for (const m of list) grid.appendChild(cell(m));
        paintSel();
      }
      function clearFilters() {
        store.patch({ kind: '', unused: false, tag: '' }); unusedChip.classList.remove('on'); S.q = '';
        const i = search.querySelector('input'); if (i) i.value = '';
        paintAll();
      }
      function cell(m) {
        const used = !S.unused.has(m.id);
        const el = h('div.lib-cell', { role: 'option', tabindex: -1, dataset: { id: m.id, kind: m.kind }, title: m.name + (m.note ? '\n' + m.note : '') }, [
          h('div.lib-thumb', [K.thumb(m), m.kind === 'audio' ? K.player(m, { compact: true }) : null, m.kind === 'video' ? h('span.lib-badge', { text: '▶ ' + (m.duration ? K.time(m.duration) : 'Video') }) : null,
            h('span.lib-check', { text: '✓', 'aria-hidden': 'true' })]),
          h('div.lib-cap', [
            h('div.lib-name.gk-ellipsis', { text: m.name }),
            h('div.lib-meta.gk-ellipsis', { text: S.trashView ? 'Deleted ' + WB.fmt.rel(m.deletedAt) : K.meta(m) || K.kindLabel(m.kind) }),
            !S.trashView && (!used || (m.tags || []).length) ? h('div.lib-tags', [!used ? h('span.lib-unused', { text: 'unused' }) : null, ...(m.tags || []).slice(0, 3).map(t => h('span.lib-tag', { text: '#' + t }))]) : null,
          ]),
        ]);
        el.addEventListener('click', e => select(m.id, e));
        el.addEventListener('dblclick', () => openPreview(m.id));
        el.addEventListener('contextmenu', e => { e.preventDefault(); if (!S.sel.includes(m.id)) { S.sel = [m.id]; S.focus = m.id; paintSel(); paintAside(); } menu(e); });
        if (!S.trashView) {
          el.draggable = true;
          el.addEventListener('dragstart', ev => {
            const ids = S.sel.includes(m.id) ? S.sel.slice() : [m.id];
            ev.dataTransfer.setData(MEDIA_MIME, JSON.stringify(ids));
            ev.dataTransfer.setData('text/plain', m.name);
            ev.dataTransfer.effectAllowed = 'copy';
            const chip = document.body.appendChild(h('div.wb-drag-chip', { text: ids.length > 1 ? ids.length + ' files' : m.name }));
            ev.dataTransfer.setDragImage(chip, 14, 14);
            setTimeout(() => chip.remove(), 0);
          });
        }
        return el;
      }
      function paintSel() {
        for (const c of grid.querySelectorAll('.lib-cell')) {
          const on = S.sel.includes(c.dataset.id);
          c.classList.toggle('on', on); c.setAttribute('aria-selected', String(on));
          c.classList.toggle('focus', c.dataset.id === S.focus);
        }
        paintBulk();
      }

      /* ---------- selection & keyboard ---------- */
      function select(id, e) {
        const list = filtered().map(m => m.id);
        if (e && e.shiftKey && S.anchor && list.includes(S.anchor)) {
          const a = list.indexOf(S.anchor), b = list.indexOf(id);
          const range = list.slice(Math.min(a, b), Math.max(a, b) + 1);
          S.sel = e.ctrlKey || e.metaKey ? [...new Set(S.sel.concat(range))] : range;
        } else if (e && (e.ctrlKey || e.metaKey)) {
          S.sel = S.sel.includes(id) ? S.sel.filter(x => x !== id) : S.sel.concat(id); S.anchor = id;
        } else { S.sel = [id]; S.anchor = id; }
        S.focus = id;
        paintSel(); paintAside();
        const c = grid.querySelector('.lib-cell[data-id="' + id + '"]');
        if (c) { c.focus({ preventScroll: true }); c.scrollIntoView({ block: 'nearest' }); }
      }
      function cols() {
        const cells = [...grid.querySelectorAll('.lib-cell')];
        if (!cells.length) return 1;
        const n = cells.findIndex(c => c.offsetTop !== cells[0].offsetTop);
        return n < 0 ? cells.length : n;
      }
      const onKey = e => {
        if (!page.isConnected || document.querySelector('.gk-scrim, .mk-lb, .wb-pop')) return;
        if (e.target.closest && e.target.closest('input, textarea, select, [contenteditable="true"], .wb-peek')) return;
        const list = filtered().map(m => m.id);
        if (!list.length) return;
        const cur = S.focus && list.includes(S.focus) ? list.indexOf(S.focus) : -1;
        const move = d => { e.preventDefault(); const n = Math.max(0, Math.min(list.length - 1, cur < 0 ? 0 : cur + d)); select(list[n], { shiftKey: e.shiftKey }); };
        if (e.altKey) return;
        if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'f') { e.preventDefault(); const i = search.querySelector('input'); if (i) { i.focus(); i.select(); } return; }
        if (e.key === 'ArrowRight') move(1);
        else if (e.key === 'ArrowLeft') move(-1);
        else if (e.key === 'ArrowDown') move(cols());
        else if (e.key === 'ArrowUp') move(-cols());
        else if (e.key === 'Home') move(-1e9);
        else if (e.key === 'End') move(1e9);
        else if ((e.key === 'Enter' || e.key === ' ') && S.focus) { e.preventDefault(); openPreview(S.focus); }
        else if ((e.key === 'Delete' || e.key === 'Backspace') && S.sel.length && !WB.share) { e.preventDefault(); if (S.trashView) purge(S.sel.slice()); else remove(S.sel.slice()); }
        else if (e.key === 'F2' && S.sel.length === 1 && !WB.share && !S.trashView) { e.preventDefault(); rename(); }
        else if (e.key.toLowerCase() === 'a' && (e.ctrlKey || e.metaKey)) { e.preventDefault(); S.sel = list.slice(); paintSel(); paintAside(); }
        else if (e.key === 'Escape' && S.sel.length) { S.sel = []; paintSel(); paintAside(); }
      };
      document.addEventListener('keydown', onKey);
      const rename = () => { const i = aside.querySelector('.lib-name-input'); if (i) { i.focus(); i.select(); } };

      /* ---------- detail drawer ---------- */
      let usageSeq = 0;
      function paintAside() {
        GK.clear(aside);
        const sel = S.sel.map(byId).filter(Boolean);
        if (sel.length > 1) aside.appendChild(multiPanel(sel));
        else if (sel.length === 1) aside.appendChild(detail(sel[0]));
        else aside.appendChild(overview());
      }
      function overview() {
        if (S.trashView) {
          const size = S.trash.reduce((a, m) => a + (m.size || 0), 0);
          return ui.panel({ title: 'Library trash', icon: '🗑', cls: 'lib-detail', body: [
            h('p.gk-small.gk-muted', { text: S.trash.length ? WB.fmt.plural(S.trash.length, 'deleted file') + ' · ' + WB.fmt.bytes(size) + '. They stay here until you empty the trash, so you can still restore them.' : 'Nothing has been deleted.' }),
            S.trash.length && !WB.share ? h('div.lib-actions', [ui.button({ label: 'Restore all', icon: '↶', small: true, onClick: () => restore(S.trash.map(m => m.id)) }), ui.button({ label: 'Empty trash…', icon: '🗑', small: true, kind: 'danger', onClick: emptyTrash })]) : null,
            ui.button({ label: 'Back to the Library', icon: '←', small: true, kind: 'ghost', onClick: () => { S.trashView = false; S.sel = []; paintAll(); } }),
          ] });
        }
        const by = k => S.all.filter(m => m.kind === k).length;
        const total = S.all.reduce((a, m) => a + (m.size || 0), 0);
        const stat = (label, n, k) => h('button.lib-stat', { type: 'button', title: 'Show ' + label.toLowerCase(), onclick: () => { S.trashView = false; store.patch({ kind: k, unused: false }); unusedChip.classList.remove('on'); paintAll(); } }, [h('b', { text: String(n) }), h('span', { text: label })]);
        return ui.panel({ title: S.trashView ? 'Library trash' : 'Library', icon: '▣', cls: 'lib-detail', body: [
          h('div.lib-stats', [stat('Images', by('image'), 'image'), stat('Recordings', by('audio'), 'audio'), stat('Videos', by('video'), 'video'), stat('Files', by('file'), 'file')]),
          h('div.gk-small.gk-muted', { text: WB.fmt.plural(S.all.length, 'file') + ' · ' + WB.fmt.bytes(total) + ' on disk' }),
          S.unused.size && !S.trashView && !store.get().unused ? h('div.lib-hint', [h('span.gk-grow', { text: S.unused.size === 1 ? 'One file isn\'t used anywhere yet.' : S.unused.size + ' files aren\'t used anywhere yet.' }), ui.button({ label: 'Show them', small: true, onClick: () => { store.patch({ unused: true, kind: '' }); unusedChip.classList.add('on'); paintAll(); } })]) : null,
          WB.share ? null : h('div.lib-tips.gk-small', [
            h('p', [h('b', { text: 'Add files: ' }), 'drop them anywhere on this page, or use Import. They are copied into the world.']),
            h('p', [h('b', { text: 'Use them: ' }), 'as covers, inside any text (the ▣ button), on boards — drag a picture onto a board — and on maps.']),
            h('p.lib-keys', [WB.ui.kbd('←→↑↓'), ' move ', WB.ui.kbd('Enter'), ' preview ', WB.ui.kbd('Del'), ' delete ', WB.ui.kbd('F2'), ' rename']),
          ]),
        ] });
      }
      function detail(m) {
        const ro = WB.share || S.trashView;
        const isCover = WB.world && WB.world.coverId === m.id;
        const preview = h('div.lib-preview', { class: m.kind, title: m.kind === 'image' ? 'Click to view large' : '' }, [
          m.kind === 'image' ? h('img', { src: m.url, alt: '', draggable: false }) : m.kind === 'video' ? h('video', { src: m.url, controls: true, preload: 'metadata' })
            : m.kind === 'audio' ? h('div.lib-preview-audio', [K.waveEl(m.id, 48), K.player(m)]) : h('div.lib-preview-file', [h('span.mk-ext', { text: K.ext(m) || 'FILE' })]),
        ]);
        if (m.kind === 'image') preview.addEventListener('click', () => openPreview(m.id));
        const name = ui.input({ value: m.name, placeholder: 'Name' });
        name.classList.add('lib-name-input');
        name.disabled = ro;
        name.addEventListener('change', () => save(m, { name: name.value.trim() || m.name }));
        name.addEventListener('keydown', e => { if (e.key === 'Enter') name.blur(); if (e.key === 'Escape') { name.value = m.name; name.blur(); } });
        const note = ui.input({ value: m.note || '', placeholder: 'A note: source, credit, what it shows…', multiline: true, rows: 2 });
        note.disabled = ro;
        note.addEventListener('change', () => save(m, { note: note.value }, true));
        const tags = ro ? h('div.wb-chips', (m.tags || []).length ? (m.tags || []).map(t => h('span.wb-tagchip', { text: '#' + t })) : [h('span.gk-faint', { text: '—' })])
          : WB.ui.field({ key: 'tags', kind: 'list', label: 'Tags' }, (m.tags || []).slice(), v => save(m, { tags: v }, true));
        const info = h('div.lib-info', [
          ['Kind', K.kindLabel(m.kind) + (m.mime ? ' · ' + m.mime : '')], ['Size', m.size ? WB.fmt.bytes(m.size) : '—'],
          m.width ? ['Dimensions', K.dims(m) + ' px'] : null, m.duration ? ['Length', K.time(m.duration)] : null,
          ['Added', WB.fmt.real(m.createdAt)], m.deletedAt ? ['Deleted', WB.fmt.rel(m.deletedAt)] : null,
        ].filter(Boolean).map(([k, v]) => h('div.lib-kv', [h('span.gk-muted', { text: k }), h('span', { text: v })])));
        const usedBox = h('div.lib-used', [h('span.gk-small.gk-muted', { text: 'Looking…' })]);
        const my = ++usageSeq;
        WB.api('media.usage', m.id).then(list => {
          if (my !== usageSeq || !usedBox.isConnected) return;
          GK.clear(usedBox);
          const vis = list.filter(u => u.world || WB.visible(WB.liteOf(u.entryId) || { audience: 'shared' }));
          if (!vis.length) { usedBox.appendChild(h('span.gk-small.gk-muted', { text: 'Not used anywhere yet.' })); return; }
          for (const u of vis) usedBox.appendChild(u.world ? h('span.wb-badge.accent', { text: '◎ World cover' }) : WB.ui.chip(WB.liteOf(u.entryId) || { id: u.entryId, title: u.title, typeId: u.typeId }, { size: 'sm' }));
        }).catch(() => GK.clear(usedBox));
        const A = (label, icon, fn, o = {}) => ui.button(Object.assign({ label, icon, small: true, onClick: fn }, o));
        const actions = S.trashView ? [
          WB.share ? null : A('Restore', '↶', () => restore([m.id]), { kind: 'primary' }), WB.share ? null : A('Delete for good…', '✕', () => purge([m.id]), { kind: 'danger' }),
        ] : WB.share ? [A('Export a copy…', '⇩', () => exportOne(m))] : [
          m.kind === 'image' ? A(isCover ? 'Remove as world cover' : 'Set as world cover', '◎', () => worldCover(m, isCover), { title: 'Shown on Home and on the published site' }) : null,
          m.kind === 'image' ? A('Set as an entry\'s cover…', '◧', () => entryCover(m)) : null,
          m.kind === 'image' ? A('Put on a board…', '▦', () => toBoard([m])) : null,
          A('Replace file…', '⇄', () => replace(m), { title: 'Swap in a new file; everything that uses this one shows the new one' }),
          A('Show in folder', '📂', () => WB.api('media.reveal', m.id).catch(WB.fail)),
          A('Export a copy…', '⇩', () => exportOne(m)), A('Delete', '🗑', () => remove([m.id]), { kind: 'danger', title: 'Moves it to the Library trash (Del)' }),
        ];
        return ui.panel({ title: m.name, icon: K.kindIcon(m.kind), cls: 'lib-detail', body: [
          preview,
          ui.field({ label: 'Name', control: name }),
          ui.field({ label: 'Tags', control: tags }),
          ui.field({ label: 'Note', control: note }),
          info,
          h('div.lib-usedwrap', [h('div.lib-sub', { text: 'Used by' }), usedBox]),
          h('div.lib-actions', actions.filter(Boolean)),
        ] });
      }
      function multiPanel(sel) {
        const size = sel.reduce((a, m) => a + (m.size || 0), 0);
        return ui.panel({ title: sel.length + ' selected', icon: '▣', cls: 'lib-detail', body: [
          h('div.lib-multi', sel.slice(0, 12).map(m => h('div.lib-mini', { title: m.name }, [K.thumb(m, { wave: false })]))),
          h('div.gk-small.gk-muted', { text: WB.fmt.bytes(size) + ' together' + (sel.length > 12 ? ' · showing 12' : '') }),
          h('div.lib-actions', (S.trashView ? [
            WB.share ? null : ui.button({ label: 'Restore all', icon: '↶', small: true, kind: 'primary', onClick: () => restore(S.sel.slice()) }),
            WB.share ? null : ui.button({ label: 'Delete for good…', icon: '✕', small: true, kind: 'danger', onClick: () => purge(S.sel.slice()) }),
          ] : WB.share ? [] : [
            ui.button({ label: 'Add a tag…', icon: '#', small: true, onClick: () => tagMany(sel) }),
            sel.some(m => m.kind === 'image') ? ui.button({ label: 'Put on a board…', icon: '▦', small: true, onClick: () => toBoard(sel.filter(m => m.kind === 'image')) }) : null,
            ui.button({ label: 'Delete ' + sel.length, icon: '🗑', small: true, kind: 'danger', onClick: () => remove(S.sel.slice()) }),
          ]).filter(Boolean)),
          ui.button({ label: 'Clear selection', small: true, kind: 'ghost', onClick: () => { S.sel = []; paintSel(); paintAside(); } }),
        ] });
      }
      function paintBulk() {
        bulk.hidden = S.sel.length < 2;
        if (bulk.hidden) return;
        GK.clear(bulk);
        GK.append(bulk, [h('b', { text: S.sel.length + ' selected' }),
          WB.share ? null : S.trashView ? ui.button({ label: 'Restore', icon: '↶', small: true, onClick: () => restore(S.sel.slice()) }) : ui.button({ label: 'Tag…', icon: '#', small: true, onClick: () => tagMany(S.sel.map(byId).filter(Boolean)) }),
          WB.share ? null : ui.button({ label: S.trashView ? 'Delete for good' : 'Delete', icon: '🗑', small: true, kind: 'danger', onClick: () => (S.trashView ? purge(S.sel.slice()) : remove(S.sel.slice())) }),
          ui.button({ label: 'Clear', small: true, kind: 'ghost', title: 'Esc', onClick: () => { S.sel = []; paintSel(); paintAside(); } })]);
      }
      function menu(e) {
        const sel = S.sel.map(byId).filter(Boolean), m = sel[0];
        if (!m) return;
        if (S.trashView) { if (!WB.share) WB.ui.menu([{ label: 'Restore', icon: '↶', onClick: () => restore(S.sel.slice()) }, '-', { label: 'Delete for good…', icon: '✕', danger: true, onClick: () => purge(S.sel.slice()) }], e); return; }
        const one = sel.length === 1, img = m.kind === 'image', ed = !WB.share;
        WB.ui.menu([
          { label: img ? 'View large' : m.kind === 'audio' ? 'Play' : 'Preview', icon: '◫', kbd: 'Enter', onClick: () => openPreview(m.id) },
          one && ed ? { label: 'Rename', icon: '✎', kbd: 'F2', onClick: rename } : null,
          ed ? { label: 'Add a tag…', icon: '#', onClick: () => tagMany(sel) } : null,
          '-',
          one && img && ed ? { label: 'Set as world cover', icon: '◎', onClick: () => worldCover(m, WB.world.coverId === m.id) } : null,
          one && img && ed ? { label: 'Set as an entry\'s cover…', icon: '◧', onClick: () => entryCover(m) } : null,
          sel.some(x => x.kind === 'image') && ed ? { label: 'Put on a board…', icon: '▦', onClick: () => toBoard(sel.filter(x => x.kind === 'image')) } : null,
          one ? { label: 'Show in folder', icon: '📂', onClick: () => WB.api('media.reveal', m.id) } : null,
          one ? { label: 'Export a copy…', icon: '⇩', onClick: () => exportOne(m) } : null,
          ed ? '-' : null,
          ed ? { label: sel.length > 1 ? 'Delete ' + sel.length + ' files' : 'Delete', icon: '🗑', kbd: 'Del', danger: true, onClick: () => remove(S.sel.slice()) } : null,
        ].filter(Boolean), e);
      }

      /* ---------- actions ---------- */
      function openPreview(id) {
        const list = filtered(), m = list.find(x => x.id === id);
        if (!m) return;
        if (m.kind === 'audio') { const p = grid.querySelector('.lib-cell[data-id="' + id + '"] .mk-player'); if (p) p.toggle(); return; }
        if (m.kind === 'file') { WB.api('media.reveal', m.id).catch(WB.fail); return; }
        const vis = list.filter(x => x.kind === 'image' || x.kind === 'video');
        K.lightbox(vis, vis.indexOf(m));
      }
      async function save(m, patch, quiet) {
        try {
          const n = await WB.api('media.update', m.id, patch);
          Object.assign(m, n);
          paintBar();
          const c = grid.querySelector('.lib-cell[data-id="' + m.id + '"]');
          if (c) c.replaceWith(cell(m));
          paintSel();
          if (!quiet) { const t = aside.querySelector('.gk-panel-head h3'); if (t) t.textContent = m.name; }
        } catch (e) { WB.fail(e); }
      }
      async function importFiles() {
        try {
          const got = await WB.api('media.import', WB.worldId, { kind: store.get().kind || 'any' });
          if (got && got.length) { ui.toast(got.length === 1 ? 'Added “' + got[0].name + '”' : got.length + ' files added', '▣'); S.trashView = false; S.sel = got.map(m => m.id); S.focus = got[0].id; await load(); }
        } catch (e) { WB.fail(e); }
      }
      async function remove(ids) {
        ids = ids.filter(id => S.all.some(m => m.id === id));
        if (!ids.length) return;
        if (GK.settings.get('wbConfirmDelete') && !(await ui.confirm('Delete?', ids.length === 1 ? '“' + byId(ids[0]).name + '” moves to the Library trash.' : ids.length + ' files move to the Library trash.', 'Delete', true))) return;
        const names = ids.map(id => byId(id).name);
        for (const id of ids) await WB.api('media.remove', id).catch(WB.fail);
        S.sel = [];
        WB.ui.undoToast((ids.length === 1 ? '“' + names[0] + '”' : ids.length + ' files') + ' moved to the Library trash', async () => { for (const id of ids) await WB.api('media.restore', id); });
        await load();
      }
      async function restore(ids) {
        for (const id of ids) await WB.api('media.restore', id).catch(WB.fail);
        ui.toast(ids.length === 1 ? 'Restored' : ids.length + ' files restored', '↶');
        S.sel = []; await load();
      }
      async function purge(ids) {
        if (!(await ui.confirm('Delete for good?', (ids.length === 1 ? '“' + (byId(ids[0]) || {}).name + '”' : ids.length + ' files') + ' will be removed from your computer. This can\'t be undone.', 'Delete for good', true))) return;
        for (const id of ids) await WB.api('media.purge', id).catch(WB.fail);
        S.sel = []; await load();
      }
      async function emptyTrash() {
        if (!(await ui.confirm('Empty the Library trash?', WB.fmt.plural(S.trash.length, 'file') + ' will be removed from your computer. This can\'t be undone.', 'Empty trash', true))) return;
        for (const m of S.trash) await WB.api('media.purge', m.id).catch(WB.fail);
        S.sel = []; await load();
      }
      async function worldCover(m, isCover) {
        const before = (WB.world && WB.world.coverId) || null;
        await WB.api('worlds.update', WB.worldId, { coverId: isCover ? null : m.id }).catch(WB.fail);
        WB.ui.undoToast(isCover ? 'The world has no cover now' : '“' + m.name + '” is the world cover', () => WB.api('worlds.update', WB.worldId, { coverId: before }));
      }
      async function entryCover(m) {
        const e = await WB.ui.pickEntry({ title: 'Use “' + m.name + '” as the cover of…' });
        if (!e) return;
        const before = e.coverId || null;
        await WB.api('entries.update', e.id, { coverId: m.id }).catch(WB.fail);
        WB.ui.undoToast('“' + m.name + '” is the cover of “' + e.title + '”', () => WB.api('entries.update', e.id, { coverId: before }));
      }
      async function toBoard(list) {
        const bt = WB.typeList({ all: true }).filter(t => t.lens === 'board').map(t => t.id);
        const b = await WB.ui.pickEntry({ title: 'Put ' + (list.length === 1 ? '“' + list[0].name + '”' : list.length + ' pictures') + ' on which board?', types: bt, allowCreate: true });
        if (!b) return;
        try {
          const cur = await WB.api('boards.get', b.id);
          const right = cur.items.reduce((a, i) => Math.max(a, i.x + i.w), 0), top = cur.items.length ? cur.items.reduce((a, i) => Math.min(a, i.y), Infinity) : 0;
          const x0 = cur.items.length ? right + 60 : 0;
          await WB.api('boards.addItems', b.id, list.map((m, i) => { const w = 280, hh = m.width && m.height ? Math.round(Math.max(80, Math.min(420, w * m.height / m.width))) : 200; return { kind: 'image', mediaId: m.id, x: x0 + (i % 3) * 300, y: top + Math.floor(i / 3) * 330, w, h: hh, text: '' }; }));
          const t = WB.ui.undoToast((list.length === 1 ? '“' + list[0].name + '”' : list.length + ' pictures') + ' put on “' + b.title + '”', null);
          t.appendChild(ui.button({ label: 'Open board', small: true, onClick: () => { t.remove(); WB.go('boards', { entryId: b.id }); } }));
        } catch (e) { WB.fail(e); }
      }
      async function replace(m) {
        try { const n = await WB.api('media.replace', m.id); if (n) { ui.toast('File replaced', '⇄'); await load(); } } catch (e) { WB.fail(e); }
      }
      async function exportOne(m) {
        try { const p = await WB.api('media.export', m.id); if (p) ui.toast('Saved a copy', '⇩'); } catch (e) { WB.fail(e); }
      }
      async function tagMany(list) {
        const name = await ui.prompt('Add a tag to ' + (list.length === 1 ? '“' + list[0].name + '”' : list.length + ' files'), '', 'e.g. portraits, act two, maps');
        if (!name) return;
        const t = name.replace(/^#/, '').trim();
        for (const m of list) if (!(m.tags || []).includes(t)) await WB.api('media.update', m.id, { tags: (m.tags || []).concat(t) }).catch(WB.fail);
        ui.toast('Tagged #' + t, '#');
        await load();
      }

      /* ---------- drop to import ---------- */
      if (!WB.share) WB.dropFiles(page, async files => {
        const saved = await WB.saveFiles(files);
        if (saved.length) { S.trashView = false; S.sel = saved.map(m => m.id); S.focus = saved[0].id; await load(); }
      });

      /* ---------- live updates ---------- */
      const offs = [
        WB.onChange(['media', 'worlds', 'board_items'], () => { if (S.alive) load().catch(() => { }); }, 300),
        // entry edits can change what uses a file; refresh quietly, never in the middle of a recording
        WB.onChange(['entries'], () => { if (S.alive && !K.isPlaying() && !aside.contains(document.activeElement)) load().catch(() => { }); }, 1500),
      ];
      live = {
        import: importFiles, unused: () => { S.trashView = false; store.patch({ unused: true, kind: '' }); unusedChip.classList.add('on'); paintAll(); },
        trash: () => { S.trashView = true; S.sel = []; paintAll(); }, state: () => ({ shown: filtered().length, all: S.all.length, trash: S.trash.length, sel: S.sel.slice() }),
        select: id => select(id),
      };
      await load();
      if (params.mediaId) { S.focus = params.mediaId; paintSel(); const c = grid.querySelector('.lib-cell[data-id="' + params.mediaId + '"]'); if (c) c.scrollIntoView({ block: 'center' }); }
      return () => { S.alive = false; live = null; offs.forEach(f => f()); document.removeEventListener('keydown', onKey); K.stopAll(); };
    },
  });

  /* ---------- palette commands ---------- */
  WB.commands.add({ id: 'library:import', label: 'Import files into the Library…', icon: '⇪', group: 'Library', run: async () => { if (!live) await WB.go('library'); if (live) live.import(); } });
  WB.commands.add({ id: 'library:unused', label: 'Library: show unused files', icon: '▣', group: 'Library', run: async () => { await WB.go('library'); if (live) live.unused(); } });
  WB.commands.add({ id: 'library:trash', label: 'Library: deleted files (trash)', icon: '🗑', group: 'Library', run: () => WB.go('library', { trash: true }) });

  /* ---------- smoke ---------- */
  let shown = 'did not run';
  WB.smoke('library-grid', async () => {
    await WB.go('library');
    await WB.wait(700);
    const cells = document.querySelectorAll('.lib-cell').length, imgs = document.querySelectorAll('.lib-cell img.mk-thumb').length;
    const first = document.querySelector('.lib-cell');
    if (first) first.click();
    await WB.wait(400);
    const detail = !!document.querySelector('.lib-detail .lib-preview');
    shown = cells && detail ? 'ok' : 'error: library shows ' + cells + ' cells, detail ' + detail;
    return shown === 'ok' ? { cells, imgs, detail } : shown;
  });
  WB.check('library: the example world\'s files show in the grid with a detail drawer', () => { if (!/^ok/.test(shown)) throw new Error(shown); return true; });
})();
