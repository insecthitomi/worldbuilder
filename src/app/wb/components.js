/* Shared Worldbuilder components: chips, rows, menus, popovers, hover cards, field editors, date input, tag editor,
   pickers, the create dialog and undo toasts. Every screen uses these so the app behaves the same everywhere. */
(function (root) {
  'use strict';
  const GK = root.GK, WB = root.WB, h = GK.h, ui = GK.ui, U = WB.ui;

  /* ---------------- overlays (body level, lifted out of the glass renderer) ---------------- */
  const zoom = () => { try { return (GK.uiScale && GK.uiScale().used) || 1; } catch { return 1; } };
  /** at: MouseEvent | Element | {x, y} | DOMRect; returns { el, close } */
  /** opts.solid: an opaque pop-up (for use over bright canvases and maps) */
  U.popover = function (at, content, { cls = '', side = 'below', width, onClose, keepOpen, group = 'pop', solid = false } = {}) {
    U.closePopovers(group);
    const z = zoom();
    const el = h('div.gk-panel.gk-dialog.wb-pop', { class: cls, dataset: { group }, style: { zoom: String(z) } }, content);
    if (width) el.style.width = width;
    document.body.appendChild(el);
    let r;
    if (at && at.getBoundingClientRect) r = at.getBoundingClientRect();
    else if (at && 'clientX' in at) r = { left: at.clientX, top: at.clientY, right: at.clientX, bottom: at.clientY, width: 0, height: 0 };   // check-ok: screen (body-level overlay)
    else if (at && 'left' in at) r = at;
    else r = { left: (at && at.x) || innerWidth / 2, top: (at && at.y) || innerHeight / 3, right: (at && at.x) || innerWidth / 2, bottom: (at && at.y) || innerHeight / 3 };
    const place = () => {
      const pw = el.offsetWidth * z, ph = el.offsetHeight * z, gap = 6;
      let left = side === 'right' ? r.right + gap : r.left, top = side === 'right' ? r.top : r.bottom + gap;
      if (side !== 'right' && top + ph > innerHeight - 8 && r.top - ph - gap > 8) top = r.top - ph - gap;
      if (side === 'right' && left + pw > innerWidth - 8) left = r.left - pw - gap;
      left = Math.max(8, Math.min(innerWidth - pw - 8, left)); top = Math.max(8, Math.min(innerHeight - ph - 8, top));
      el.style.left = left / z + 'px'; el.style.top = top / z + 'px';   // check-ok: screen (body-level overlay)
      // the glass lens skips very small panels, which would leave them see-through: give those a veil
      el.classList.toggle('veil', solid || el.offsetHeight < 80);
    };
    place();
    requestAnimationFrame(place);
    const close = () => {
      if (!el.isConnected) return;
      el.remove();
      document.removeEventListener('pointerdown', outside, true);
      document.removeEventListener('keydown', esc, true);
      onClose && onClose();
    };
    const outside = e => { if (!el.contains(e.target) && !(at && at.contains && at.contains(e.target)) && !e.target.closest('.wb-pop[data-group="' + group + '-sub"]')) close(); };
    const esc = e => { if (e.key === 'Escape') { e.stopPropagation(); close(); } };
    if (!keepOpen) setTimeout(() => document.addEventListener('pointerdown', outside, true), 0);
    document.addEventListener('keydown', esc, true);
    el._close = close; el._place = place;
    return { el, close, place };
  };
  U.closePopovers = (group) => document.querySelectorAll('.wb-pop' + (group ? '[data-group="' + group + '"],.wb-pop[data-group="' + group + '-sub"]' : '')).forEach(p => (p._close ? p._close() : p.remove()));

  /** items: { label, icon, kbd, onClick, danger, disabled, checked, sub: [items], hint } | '-' | { header } */
  U.menu = function (items, at, { group = 'menu', side, solid } = {}) {
    let pop;
    const list = h('div.wb-menu', { role: 'menu' });
    const btns = [];
    for (const it of items.filter(Boolean)) {
      if (it === '-') { list.appendChild(h('div.wb-menu-sep')); continue; }
      if (it.header) { list.appendChild(h('div.wb-menu-head', { text: it.header })); continue; }
      const b = h('button.wb-menu-item', { type: 'button', role: 'menuitem', disabled: !!it.disabled, class: (it.danger ? 'danger ' : '') + (it.checked ? 'checked' : '') }, [
        h('span.wb-menu-ico', { text: it.checked ? '✓' : it.icon || '' }), h('span.wb-menu-lbl.gk-ellipsis', { text: it.label }),
        it.kbd ? h('span.wb-menu-kbd', { text: it.kbd }) : it.sub ? h('span.wb-menu-kbd', { text: '›' }) : null,
      ]);
      if (it.hint) b.title = it.hint;
      b.addEventListener('click', e => {
        if (it.sub) { U.menu(it.sub, b, { group: group + '-sub', side: 'right' }); return; }
        pop.close(); U.closePopovers(group + '-sub');
        it.onClick && Promise.resolve(it.onClick(e)).catch(WB.fail);
      });
      if (it.sub) b.addEventListener('pointerenter', () => U.menu(it.sub, b, { group: group + '-sub', side: 'right' }));
      else b.addEventListener('pointerenter', () => U.closePopovers(group + '-sub'));
      btns.push(b);
      list.appendChild(b);
    }
    pop = U.popover(at, list, { cls: 'wb-menu-pop', group, side, solid });
    list.addEventListener('keydown', e => {
      const i = btns.indexOf(document.activeElement);
      if (e.key === 'ArrowDown') { e.preventDefault(); (btns[(i + 1) % btns.length] || btns[0]).focus(); }
      else if (e.key === 'ArrowUp') { e.preventDefault(); (btns[(i - 1 + btns.length) % btns.length] || btns[0]).focus(); }
      else if (e.key === 'ArrowRight' && document.activeElement && items.find(x => x && x.label === document.activeElement.textContent)) document.activeElement.click();
    });
    setTimeout(() => btns[0] && btns[0].focus(), 0);
    return pop;
  };

  /* ---------------- small pieces ---------------- */
  U.dot = (color, cls) => h('span.wb-dot', { class: cls || '', style: { '--c': color || 'var(--muted)' } });
  U.badge = (text, tone) => h('span.wb-badge', { class: tone || '', text });
  U.kbd = keys => h('span.wb-kbd', String(keys).split('+').map(k => h('kbd', { text: k })));
  U.icon = (e, cls) => h('span.wb-ico', { class: cls || '', text: WB.iconOf(e), style: { '--c': WB.colorOf(e) } });
  U.typeBadge = t => (t ? h('span.wb-type', { style: { '--c': t.color }, title: t.name }, [h('span.wb-type-ico', { text: t.icon }), h('span', { text: t.name })]) : null);
  U.empty = ({ icon = '✦', title, text, actions } = {}) => h('div.wb-empty', [
    h('div.wb-empty-ico', { text: icon }), title && h('h3', { text: title }), text && h('p.gk-muted', { text }),
    actions && actions.length ? h('div.gk-row.wb-empty-actions', actions) : null,
  ]);
  U.toolbar = items => h('div.wb-toolbar', items.filter(Boolean));
  U.sectionHead = (title, actions, sub) => h('div.wb-sec-head', [h('div.gk-grow', [h('h4', { text: title }), sub ? h('div.gk-small.gk-muted', { text: sub }) : null]), actions ? h('div.gk-row.nowrap', [].concat(actions).filter(Boolean)) : null]);
  U.search = ({ placeholder = 'Filter', value = '', onInput, onEnter, autofocus } = {}) => {
    const inp = ui.input({ value, placeholder, onInput });
    inp.classList.add('wb-search-input');
    inp.addEventListener('keydown', e => { if (e.key === 'Escape' && inp.value) { e.stopPropagation(); inp.value = ''; onInput && onInput(''); } if (e.key === 'Enter' && onEnter) onEnter(inp.value); });
    if (autofocus) setTimeout(() => inp.focus(), 30);
    return h('label.wb-search', [h('span.wb-search-ico', { text: '⌕' }), inp]);
  };
  U.split = ({ side, main, aside, cls } = {}) => h('div.wb-split', { class: (cls || '') + (aside ? ' has-aside' : '') + (side ? ' has-side' : '') }, [side && h('div.wb-split-side', [side]), h('div.wb-split-main', [main]), aside && h('div.wb-split-aside', [aside])]);
  U.thumb = (mediaId, { cls = '', alt = '', fit = 'cover' } = {}) => {
    const img = h('img.wb-thumb', { class: cls, alt, draggable: false, style: { objectFit: fit } });
    if (mediaId) WB.media(mediaId).then(m => { if (m) img.src = m.url; else img.classList.add('missing'); });
    else img.classList.add('missing');
    return img;
  };
  U.stat = ({ label, value, note, icon, onClick, tone }) => { const s = ui.stat({ label, value: String(value), note, icon, onClick }); if (tone) s.classList.add('tone-' + tone); return s; };

  /* ---------------- entry chips, rows, hover cards ---------------- */
  let hoverT = null;
  function hoverable(el, id) {
    el.addEventListener('pointerenter', () => {
      if (!GK.settings.get('wbHoverCards')) return;
      clearTimeout(hoverT);
      hoverT = setTimeout(() => { if (el.isConnected && el.matches(':hover')) U.hoverCard(id, el); }, 480);
    });
    el.addEventListener('pointerleave', () => { clearTimeout(hoverT); setTimeout(() => { const c = document.querySelector('.wb-pop[data-group="hover"]'); if (c && !c.matches(':hover')) c._close(); }, 160); });
  }
  /** the hover card at a screen rect, for canvases (no element to hover): call U.hoverCardAt(null) to close it.
      `still()` (optional) is asked once the entry has loaded, so a pointer that moved on cancels the card. */
  U.hoverCardAt = async function (id, rect, still) {
    if (!id) { const c = document.querySelector('.wb-pop[data-group="hover"]'); if (c) c._close(); return; }
    if (!GK.settings.get('wbHoverCards')) return;
    const e = await WB.api('entries.lite', id).catch(() => null);
    if (!e || (still && !still())) return;
    U.popover({ left: rect.left, top: rect.top, right: rect.right, bottom: rect.bottom, width: rect.width || 0, height: rect.height || 0 }, hoverBody(e), { cls: 'wb-hover-pop', group: 'hover', width: '20em' });
  };
  U.hoverCard = async function (id, anchor) {
    const e = await WB.api('entries.lite', id).catch(() => null);
    if (!e || !anchor.isConnected || !anchor.matches(':hover')) return;
    const pop = U.popover(anchor, hoverBody(e), { cls: 'wb-hover-pop', group: 'hover', width: '20em' });
    pop.el.addEventListener('pointerleave', () => pop.close());
  };
  function hoverBody(e) {
    const t = WB.typeOf(e), age = WB.fmt.age(e);
    return h('div.wb-hover', [
      e.coverId ? U.thumb(e.coverId, { cls: 'wb-hover-cover' }) : null,
      h('div.wb-hover-body', [
        h('div.gk-row.nowrap', [U.icon(e), h('b.gk-ellipsis.gk-grow', { text: e.title })]),
        h('div.gk-small.gk-muted', { text: [t && t.name, WB.fmt.span(e), age != null ? 'age ' + age : ''].filter(Boolean).join(' · ') }),
        e.summary ? h('p.gk-small.wb-hover-sum', { text: e.summary }) : null,
      ]),
    ]);
  }
  /** opts: { size: 'sm', noMenu, noDrag, noHover, peek (click peeks instead of opening), onRemove, onClick } */
  U.chip = function (e, opts = {}) {
    if (typeof e === 'string') e = WB.liteOf(e) || { id: e, title: WB.titleOf(e) || '…', typeId: null };
    // not in the titles cache yet (created a moment ago, or deleted): look it up instead of assuming it is gone
    let gone = false;
    const unknown = !WB.liteOf(e.id) && !e.typeId;
    const el = h('span.wb-chip', { class: (opts.size || '') + (unknown ? ' pending' : ''), tabindex: 0, role: 'link', dataset: { id: e.id }, style: { '--c': WB.colorOf(e) }, title: e.title }, [
      h('span.wb-chip-ico', { text: WB.iconOf(e) }), h('span.wb-chip-lbl', { text: e.title || WB.titleOf(e.id) || 'Untitled' }),
      opts.onRemove ? h('button.wb-chip-x', { type: 'button', title: 'Remove', text: '✕', onclick: ev => { ev.stopPropagation(); opts.onRemove(e); } }) : null,
    ]);
    if (unknown) WB.api('entries.lite', e.id).catch(() => null).then(x => {
      el.classList.remove('pending');
      if (!x || x.deletedAt) { gone = true; el.classList.add('gone'); el.title = 'This entry was deleted'; return; }
      Object.assign(e, x);
      el.style.setProperty('--c', WB.colorOf(x)); el.title = x.title;
      el.querySelector('.wb-chip-ico').textContent = WB.iconOf(x);
      el.querySelector('.wb-chip-lbl').textContent = x.title || 'Untitled';
    });
    const go = ev => { if (gone) return; if (opts.onClick) return opts.onClick(e, ev); if (opts.peek || ev.ctrlKey || ev.metaKey) WB.peek(e.id); else WB.open(e.id); };
    el.addEventListener('click', go);
    el.addEventListener('keydown', ev => { if (ev.key === 'Enter') go(ev); });
    if (!opts.noMenu) el.addEventListener('contextmenu', ev => { ev.preventDefault(); if (!gone) U.entryMenu(e, ev); });
    if (!opts.noDrag) WB.dnd.entry(el, e.id);
    if (!opts.noHover) hoverable(el, e.id);
    return el;
  };
  /** list row: opts { active, sub, trailing, onClick, onDblClick, indent, menu=true, draggable } */
  U.row = function (e, opts = {}) {
    const t = WB.typeOf(e);
    const sub = opts.sub != null ? opts.sub : [t && t.name, WB.fmt.span(e), e.summary].filter(Boolean).join(' · ');
    const el = h('div.wb-row', { class: (opts.active ? 'on ' : '') + (e.deletedAt ? 'trashed' : ''), tabindex: 0, dataset: { id: e.id }, style: { '--c': WB.colorOf(e), '--indent': String(opts.indent || 0) } }, [
      h('span.wb-row-ico', { text: WB.iconOf(e) }),
      h('div.wb-row-main', [
        h('div.wb-row-title.gk-ellipsis', [e.favorite ? h('span.wb-fav', { text: '★ ' }) : null, e.title || 'Untitled']),
        sub ? h('div.wb-row-sub.gk-ellipsis', { text: sub }) : null,
      ]),
      opts.trailing || null,
    ]);
    el.addEventListener('click', ev => (opts.onClick ? opts.onClick(e, ev) : ev.ctrlKey || ev.metaKey ? WB.peek(e.id) : WB.open(e.id)));
    if (opts.onDblClick) el.addEventListener('dblclick', ev => opts.onDblClick(e, ev));
    el.addEventListener('keydown', ev => { if (ev.key === 'Enter') el.click(); });
    if (opts.menu !== false) el.addEventListener('contextmenu', ev => { ev.preventDefault(); U.entryMenu(e, ev, opts.menuExtra); });
    if (opts.draggable !== false) WB.dnd.entry(el, e.id);
    return el;
  };
  /** arrow keys move between rows inside a container; Enter opens */
  U.listKeys = (box, { rows = '.wb-row' } = {}) => box.addEventListener('keydown', e => {
    if (e.key !== 'ArrowDown' && e.key !== 'ArrowUp') return;
    const all = [...box.querySelectorAll(rows)], i = all.indexOf(document.activeElement);
    const n = all[e.key === 'ArrowDown' ? Math.min(all.length - 1, i + 1) : Math.max(0, i - 1)];
    if (n) { e.preventDefault(); n.focus(); }
  });

  /* ---------------- the entry menu (same everywhere) ---------------- */
  U.entryMenu = function (e, at, extra = []) {
    const t = WB.typeOf(e);
    const typesFor = WB.typeList().filter(x => x.id !== e.typeId);
    return U.menu([
      { label: 'Open', icon: '↗', onClick: () => WB.open(e.id) },
      { label: 'Peek', icon: '◫', kbd: 'Ctrl+Click', onClick: () => WB.peek(e.id) },
      t && t.lens ? { label: lensLabel(t.lens), icon: '⇱', onClick: () => WB.openLens(e) } : null,
      '-',
      { label: e.favorite ? 'Remove from favourites' : 'Add to favourites', icon: '★', onClick: () => WB.api('entries.update', e.id, { favorite: !e.favorite }) },
      { label: 'Audience', icon: '◐', sub: WB.know.LEVELS.map(([v, l, hint]) => ({ label: l, hint, checked: e.audience === v, onClick: () => WB.api('entries.update', e.id, { audience: v }) })) },
      { label: 'Add a tag…', icon: '#', onClick: async () => { const n = await ui.prompt('Add a tag', '', 'e.g. act two, unresolved'); if (n) await WB.api('entries.addTag', e.id, n); } },
      { label: 'New child entry', icon: '＋', onClick: () => WB.ui.createDialog({ parentId: e.id, type: (t && t.childTypes && t.childTypes[0]) || (t && t.key) }) },
      '-',
      { label: 'Move into…', icon: '⇲', onClick: async () => { const p = await U.pickEntry({ title: 'Move “' + e.title + '” into…', exclude: [e.id], allowNone: 'Top level' }); if (p !== undefined) await WB.api('entries.move', e.id, { parentId: p ? p.id : null }); } },
      { label: 'Duplicate', icon: '⧉', onClick: async () => { const c = await WB.api('entries.duplicate', e.id, { children: true }); WB.open(c.id); } },
      { label: 'Change type', icon: '⇄', sub: typesFor.map(x => ({ label: x.name, icon: x.icon, onClick: () => WB.api('entries.update', e.id, { typeId: x.id }) })) },
      { label: 'Merge into…', icon: '⤞', onClick: () => U.mergeDialog(e) },
      { label: 'Copy mention', icon: '⎘', hint: 'Paste it into any text to link this entry', onClick: () => WB.copyMention(e) },
      ...extra,
      '-',
      { label: 'Move to trash', icon: '🗑', kbd: 'Del', danger: true, onClick: () => U.confirmTrash(e) },
    ], at);
  };
  const lensLabel = l => ({ story: 'Open in Write', map: 'Open in Atlas', board: 'Open board', language: 'Open in Lexicon', table: 'Roll in Toolkit', encounter: 'Run in Toolkit' })[l] || 'Open lens';
  WB.openLens = e => {
    const t = WB.typeOf(e);
    const to = { story: 'write', map: 'atlas', board: 'boards', language: 'lexicon', table: 'toolkit', encounter: 'toolkit' }[t && t.lens];
    return to ? WB.go(to, { entryId: e.id }) : WB.open(e.id);
  };
  U.confirmTrash = async e => {
    if (GK.settings.get('wbConfirmDelete') && !(await ui.confirm('Move to trash?', '“' + e.title + '” and anything inside it move to the trash. You can restore them later.', 'Move to trash', true))) return;
    return WB.trash(e);
  };
  WB.copyMention = async e => {
    const html = '<a class="wb-m" data-id="' + e.id + '">' + WB.esc(e.title) + '</a>';
    try { await navigator.clipboard.write([new ClipboardItem({ 'text/html': new Blob([html], { type: 'text/html' }), 'text/plain': new Blob([e.title], { type: 'text/plain' }) })]); }
    catch { await navigator.clipboard.writeText(e.title); }
    ui.toast('Copied: paste it into any text to link “' + e.title + '”', '⎘');
  };
  U.mergeDialog = async function (e) {
    const into = await U.pickEntry({ title: 'Merge “' + e.title + '” into…', exclude: [e.id], types: [e.typeId] });
    if (!into) return;
    const ok = await ui.confirm('Merge entries?', `“${e.title}” becomes part of “${into.title}”: its text, empty fields, tags, children and every link move over and its name becomes an alias. A backup is made first.`, 'Merge', true);
    if (!ok) return;
    const m = await WB.api('entries.merge', into.id, e.id);
    ui.toast('Merged into “' + m.title + '”', '⤞');
    WB.open(m.id);
  };

  /* ---------------- undo toasts ---------------- */
  /** a toast with Undo; actions: extra [{ label, onClick }] buttons (Open, Show…) before it */
  U.undoToast = function (text, undo, ms = 7000, actions = []) {
    let host = document.querySelector('.gk-toasts');
    if (!host) host = document.body.appendChild(h('div.gk-toasts'));
    const t = host.appendChild(h('div.gk-toast.gk-widget.gk-nolens.wb-undo', [h('span', { text: '✓' }), h('span.gk-grow', { text }),
      (actions || []).map(a => ui.button({ label: a.label, small: true, onClick: async () => { t.remove(); try { await a.onClick(); } catch (e) { WB.fail(e); } } })),
      undo ? ui.button({ label: 'Undo', small: true, onClick: async () => { t.remove(); try { await undo(); ui.toast('Undone', '↶'); } catch (e) { WB.fail(e); } } }) : null]));
    setTimeout(() => { t.classList.add('out'); setTimeout(() => t.remove(), 300); }, ms);
    return t;
  };

  /* ---------------- drag & drop of entries ---------------- */
  const MIME = 'application/x-wb-entry';
  WB.dnd = {
    entry(el, id) {
      el.draggable = true;
      el.addEventListener('dragstart', ev => {
        ev.dataTransfer.setData(MIME, id);
        ev.dataTransfer.setData('text/plain', WB.titleOf(id) || id);
        ev.dataTransfer.effectAllowed = 'copyMove';
        // a small chip as the drag image (the browser's snapshot is wrong under the UI scale)
        const chip = document.body.appendChild(h('div.wb-drag-chip', { text: WB.titleOf(id) || 'Entry' }));
        ev.dataTransfer.setDragImage(chip, 14, 14);
        setTimeout(() => chip.remove(), 0);
      });
    },
    id: ev => ev.dataTransfer && (ev.dataTransfer.getData(MIME) || null),
    has: ev => !!ev.dataTransfer && [...ev.dataTransfer.types].includes(MIME),
    /** fn(entryId, event) when an entry is dropped on el */
    accept(el, fn, { cls = 'wb-drop' } = {}) {
      el.addEventListener('dragover', ev => { if (WB.dnd.has(ev)) { ev.preventDefault(); el.classList.add(cls); } });
      el.addEventListener('dragleave', () => el.classList.remove(cls));
      el.addEventListener('drop', ev => { const id = WB.dnd.id(ev); el.classList.remove(cls); if (id) { ev.preventDefault(); ev.stopPropagation(); fn(id, ev); } });
    },
  };

  /* ---------------- field editors (one per kind) ---------------- */
  /** returns a control; onChange(value) on every committed change */
  U.field = function (def, value, onChange, { readOnly } = {}) {
    if (readOnly || WB.share) return U.fieldView(def, value);
    const F = WB.F, set = v => { value = v; onChange(v); };
    if (value === undefined) value = F.empty(def.kind);
    switch (def.kind) {
      case 'longtext': { const t = ui.input({ multiline: true, rows: 2, value: value || '', onInput: v => set(v) }); autosize(t); return t; }
      case 'number': {
        const i = ui.input({ type: 'number', value: value == null ? '' : value, onInput: v => set(v === '' ? null : +v) });
        return def.unit ? h('div.wb-unit', [i, h('span.gk-muted.gk-small', { text: def.unit })]) : i;
      }
      case 'choice': {
        const opts = [['', '—']].concat((def.options || []).map(o => [o, o]));
        if (value && !(def.options || []).includes(value)) opts.push([value, value]);
        return ui.select({ value: value || '', options: opts, onChange: v => set(v) });
      }
      case 'multi': {
        const box = h('div.wb-chips');
        const paint = () => { GK.clear(box); for (const o of def.options || []) box.appendChild(ui.chip({ label: o, on: (value || []).includes(o), onClick: () => { const s = new Set(value || []); s.has(o) ? s.delete(o) : s.add(o); set([...s]); paint(); } })); };
        paint(); return box;
      }
      case 'bool': return ui.toggle({ value: !!value, onChange: v => set(v) });
      case 'url': {
        const i = ui.input({ type: 'url', value: value || '', placeholder: 'https://…', onInput: v => set(v) });
        return h('div.gk-row.nowrap', [h('div.gk-grow', [i]), ui.button({ icon: '↗', small: true, title: 'Open in the browser', onClick: () => i.value && GK.host('shell:url', i.value) })]);
      }
      case 'color': return ui.color({ value: value || '#7c8fb3', onInput: v => set(v) });
      case 'rating': {
        const box = h('div.wb-stars', { role: 'radiogroup' });
        const paint = () => { GK.clear(box); for (let i = 1; i <= 5; i++) box.appendChild(h('button', { type: 'button', class: i <= (value || 0) ? 'on' : '', text: '★', title: i + ' of 5', onclick: () => { set(value === i ? 0 : i); paint(); } })); };
        paint(); return box;
      }
      case 'progress': return ui.slider({ min: 0, max: 100, step: 5, value: value || 0, unit: '%', onInput: v => set(v) });
      case 'realdate': return ui.input({ type: 'date', value: value || '', onChange: v => set(v) });
      case 'dice': {
        const i = ui.input({ value: value || '', placeholder: 'e.g. 2d6+1', onInput: v => set(v) });
        return h('div.gk-row.nowrap', [h('div.gk-grow', [i]), ui.button({ icon: '⚄', small: true, title: 'Roll', onClick: () => WB.roll(i.value || '1d20', def.label) })]);
      }
      case 'list': return listEditor(value || [], set);
      case 'stats': return statsEditor(value || [], set);
      case 'image': return imageField(value, set);
      case 'ref': return refEditor(def, value ? [value] : [], v => set(v[0] || ''), true);
      case 'refs': return refEditor(def, value || [], set, false);
      default: return ui.input({ value: value == null ? '' : String(value), onInput: v => set(v) });
    }
  };
  function autosize(t) {
    const fit = () => { t.style.height = 'auto'; t.style.height = (t.scrollHeight + 2) + 'px'; };
    t.addEventListener('input', fit);
    requestAnimationFrame(fit);
  }
  function listEditor(list, set) {
    const box = h('div.wb-chips.wb-listed');
    const inp = h('input.wb-chip-input', { placeholder: 'Add…' });
    const paint = () => {
      GK.clear(box);
      list.forEach((v, i) => box.appendChild(h('span.wb-tagchip', [h('span', { text: v }), h('button.wb-chip-x', { type: 'button', text: '✕', title: 'Remove', onclick: () => { list = list.filter((x, j) => j !== i); set(list); paint(); } })])));
      box.appendChild(inp);
    };
    inp.addEventListener('keydown', e => {
      if ((e.key === 'Enter' || e.key === ',') && inp.value.trim()) { e.preventDefault(); list = list.concat(inp.value.split(/\s*[;\n]\s*/).map(s => s.trim()).filter(Boolean)); inp.value = ''; set(list); paint(); inp.focus(); }
      else if (e.key === 'Backspace' && !inp.value && list.length) { list = list.slice(0, -1); set(list); paint(); inp.focus(); }
    });
    inp.addEventListener('blur', () => { if (inp.value.trim()) { list = list.concat([inp.value.trim()]); inp.value = ''; set(list); paint(); } });
    paint();
    return box;
  }
  function statsEditor(rows, set) {
    const box = h('div.wb-stats-edit');
    const paint = () => {
      GK.clear(box);
      rows.forEach((r, i) => box.appendChild(h('div.wb-stat-row', [
        ui.input({ value: r.label, placeholder: 'Name', onInput: v => { rows[i] = Object.assign({}, rows[i], { label: v }); set(rows.slice()); } }),
        ui.input({ value: r.value, placeholder: 'Value', onInput: v => { rows[i] = Object.assign({}, rows[i], { value: v }); set(rows.slice()); } }),
        ui.button({ icon: '✕', small: true, kind: 'ghost', title: 'Remove', onClick: () => { rows = rows.filter((x, j) => j !== i); set(rows); paint(); } }),
      ])));
      box.appendChild(h('div.gk-row', [
        ui.button({ label: 'Add stat', icon: '＋', small: true, onClick: () => { rows = rows.concat([{ label: '', value: '' }]); set(rows); paint(); box.querySelectorAll('input')[rows.length * 2 - 2].focus(); } }),
        !rows.length ? ui.button({ label: 'Six abilities', small: true, kind: 'ghost', onClick: () => { rows = ['STR', 'DEX', 'CON', 'INT', 'WIS', 'CHA'].map(l => ({ label: l, value: '10' })).concat([{ label: 'hp', value: '10' }, { label: 'ac', value: '12' }, { label: 'init', value: '+0' }]); set(rows); paint(); } }) : null,
      ]));
    };
    paint();
    return box;
  }
  function imageField(value, set) {
    const box = h('div.wb-imgfield');
    const paint = () => {
      GK.clear(box);
      if (value) box.appendChild(U.thumb(value, { cls: 'wb-imgfield-img' }));
      box.appendChild(h('div.gk-row', [
        ui.button({ label: value ? 'Change…' : 'Choose image…', small: true, onClick: async () => { const m = await U.pickMedia({ kind: 'image' }); if (m) { value = m.id; set(value); paint(); } } }),
        value ? ui.button({ label: 'Remove', small: true, kind: 'ghost', onClick: () => { value = ''; set(''); paint(); } }) : null,
      ]));
    };
    paint();
    return box;
  }
  function refEditor(def, ids, set, single) {
    const box = h('div.wb-chips.wb-refs');
    WB.dnd.accept(box, id => { if (ids.includes(id)) return; ids = single ? [id] : ids.concat([id]); set(ids.slice()); paint(); });
    const paint = () => {
      GK.clear(box);
      for (const id of ids) box.appendChild(U.chip(id, { size: 'sm', onRemove: () => { ids = ids.filter(x => x !== id); set(ids.slice()); paint(); } }));
      if (!single || !ids.length) box.appendChild(ui.button({ label: single ? 'Choose…' : 'Add…', icon: '＋', small: true, kind: 'ghost', onClick: async () => {
        const types = (def.refTypes || []).map(k => WB.type(k)).filter(Boolean).map(t => t.id);
        const p = await U.pickEntry({ title: def.label, types, multi: !single, exclude: ids, allowCreate: true });
        if (!p) return;
        const add = [].concat(p).map(x => x.id).filter(x => !ids.includes(x));
        ids = single ? add.slice(0, 1) : ids.concat(add);
        set(ids.slice()); paint();
      } }));
    };
    paint();
    return box;
  }
  /** read-only rendering of a field value */
  U.fieldView = function (def, v) {
    const F = WB.F;
    if (!F.filled(def.kind, v)) return h('span.gk-faint', { text: '—' });
    switch (def.kind) {
      case 'ref': return U.chip(v, { size: 'sm' });
      case 'refs': return h('div.wb-chips', v.map(id => U.chip(id, { size: 'sm' })));
      case 'multi': case 'list': return h('div.wb-chips', v.map(x => h('span.wb-tagchip', { text: x })));
      case 'stats': return h('div.wb-statgrid', v.map(s => h('div.wb-statcell', [h('div.gk-tiny.gk-muted', { text: s.label }), h('b', { text: s.value })])));
      case 'bool': return h('span', { text: v ? 'Yes' : 'No' });
      case 'rating': return h('span.wb-stars.view', { text: '★'.repeat(v) + '☆'.repeat(5 - v) });
      case 'progress': return h('div.gk-row.nowrap', [h('div.gk-grow', [ui.meter(v / 100)]), h('span.gk-small', { text: v + '%' })]);
      case 'image': return U.thumb(v, { cls: 'wb-imgfield-img' });
      case 'color': return h('span.gk-row.nowrap', [U.dot(v), h('span.gk-small', { text: v })]);
      case 'url': return h('a', { href: v, text: v, onclick: e => { e.preventDefault(); GK.host('shell:url', v); } });
      case 'realdate': return h('span', { text: WB.fmt.real(v) });
      case 'dice': return h('span.gk-row.nowrap', [h('code', { text: v }), ui.button({ icon: '⚄', small: true, kind: 'ghost', title: 'Roll', onClick: () => WB.roll(v, def.label) })]);
      case 'number': return h('span', { text: WB.fmt.num(v) + (def.unit ? ' ' + def.unit : '') });
      case 'longtext': return h('div.gk-text.wb-pre', { text: v });
      default: return h('span', { text: String(v) });
    }
  };
  /** rolls dice, shows the result and tells the toolkit's log */
  WB.roll = function (expr, label) {
    try {
      const r = WB.dice.roll(expr);
      ui.toast((label ? label + ': ' : '') + r.total + '   ' + r.text, '⚄', 5000);
      WB.emit('roll', Object.assign({ label: label || '', at: new Date().toISOString() }, r));
      return r;
    } catch (e) { WB.fail(e); return null; }
  };

  /* ---------------- world dates ---------------- */
  /** opts: { value, onChange, placeholder, allowEmpty = true, compact } */
  U.dateInput = function ({ value, onChange, placeholder = 'e.g. 12 ' + ((WB.cal && WB.cal.months[0].name) || 'January') + ' ' + (WB.cal ? WB.cal.yearText(WB.cal.ymd(WB.now.day).y) : ''), allowEmpty = true, compact } = {}) {
    const inp = h('input.gk-input.gk-control.wb-date-input', { placeholder, spellcheck: false });
    const show = () => { inp.value = value ? WB.fmt.date(value) : ''; inp.classList.remove('bad'); inp.title = value ? WB.fmt.date(value, 'full') : ''; };
    const commit = () => {
      const s = inp.value.trim();
      if (!s) { if (allowEmpty && value) { value = null; onChange(null); } show(); return; }
      const d = WB.cal.parse(s, { eraIndex: WB.cal.eraOf(WB.cal.ymd(WB.now.day).y).index });
      if (!d) { inp.classList.add('bad'); inp.title = 'Try “1203”, “Frostmere 1203” or “12 Frostmere 1203”'; return; }
      value = d; onChange(d); show();
    };
    inp.addEventListener('change', commit);
    inp.addEventListener('keydown', e => { if (e.key === 'Enter') { e.preventDefault(); commit(); inp.blur(); } });
    const btn = ui.button({ icon: '▦', small: true, kind: 'ghost', title: 'Pick a date', onClick: () => picker(btn, value, d => { value = d; onChange(d); show(); }, allowEmpty) });
    show();
    return h('div.wb-date', { class: compact ? 'compact' : '' }, [inp, btn]);
  };
  function picker(anchor, value, done, allowEmpty) {
    const C = WB.cal, p = C.parts(value || WB.now);
    if (!value) p.prec = 'day';
    const eras = [[String(-1), (C.cal.before && (C.cal.before.abbr || C.cal.before.name)) || 'Before']].concat(C.cal.eras.map((e, i) => [String(i), e.abbr || e.name]));
    const body = h('div.wb-picker');
    const paint = () => {
      GK.clear(body);
      const absY = C.absYear(p.year, p.eraIndex);
      const days = C.monthLength(absY, p.month);
      if (p.day > days) p.day = days;
      GK.append(body, [
        ui.segmented({ value: p.prec, options: [['year', 'Year'], ['month', 'Month'], ['day', 'Day'], ['time', 'Time']], onChange: v => { p.prec = v; paint(); } }),
        h('div.wb-picker-row', [
          C.cal.eras.length ? ui.select({ value: String(p.eraIndex == null ? 0 : p.eraIndex), options: eras, onChange: v => { p.eraIndex = +v; paint(); } }) : null,
          ui.input({ type: 'number', value: p.year, onInput: v => { p.year = +v || 1; } }),
        ]),
        p.prec !== 'year' ? ui.select({ value: String(p.month), options: C.months.map((m, i) => [String(i), m.name]), onChange: v => { p.month = +v; paint(); } }) : null,
        p.prec === 'day' || p.prec === 'time' ? dayGrid(C, absY, p, paint) : null,
        p.prec === 'time' ? h('div.wb-picker-row', [ui.input({ type: 'number', value: p.hour, onInput: v => { p.hour = Math.max(0, Math.min(C.cal.hoursPerDay - 1, +v || 0)); } }), h('span', { text: ':' }), ui.input({ type: 'number', value: p.minute, onInput: v => { p.minute = Math.max(0, Math.min(C.cal.minutesPerHour - 1, +v || 0)); } })]) : null,
        h('div.gk-row.wb-picker-foot', [
          ui.button({ label: 'World today', small: true, kind: 'ghost', onClick: () => { Object.assign(p, C.parts(WB.now), { prec: p.prec }); paint(); } }),
          allowEmpty ? ui.button({ label: 'Clear', small: true, kind: 'ghost', onClick: () => { pop.close(); done(null); } }) : null,
          h('span.gk-grow'),
          ui.button({ label: 'Set', small: true, kind: 'primary', onClick: () => { pop.close(); done(C.fromParts(p)); } }),
        ]),
      ]);
    };
    paint();
    const pop = U.popover(anchor, body, { cls: 'wb-picker-pop', group: 'picker' });
  }
  function dayGrid(C, y, p, paint) {
    const n = C.monthLength(y, p.month), first = C.weekday(C.fromYmd(y, p.month, 1)), wk = C.weekdays.length || 7;
    const grid = h('div.wb-daygrid', { style: { '--cols': String(wk) } });
    if (C.weekdays.length) C.weekdays.forEach(w => grid.appendChild(h('span.wb-dg-wd', { text: w.slice(0, 2) })));
    for (let i = 0; i < first; i++) grid.appendChild(h('span'));
    for (let d = 1; d <= n; d++) grid.appendChild(h('button', { type: 'button', class: d === p.day ? 'on' : '', text: String(d), onclick: () => { p.day = d; paint(); } }));
    return grid;
  }
  /** a start–end pair with the type's labels */
  U.dateRange = function ({ start, end, labels, onChange }) {
    const l = labels || { start: 'Start', end: 'End' };
    return h('div.wb-daterange', [
      ui.field({ label: l.start, control: U.dateInput({ value: start, onChange: v => { start = v; onChange({ start, end }); } }) }),
      l.end ? ui.field({ label: l.end, control: U.dateInput({ value: end, onChange: v => { end = v; onChange({ start, end }); } }) }) : null,
    ]);
  };

  /* ---------------- tags & audience ---------------- */
  U.tagChip = (id, opts = {}) => {
    const t = WB.tag(id) || { name: '?', color: '' };
    return h('span.wb-tagchip.tag', { style: { '--c': t.color || 'var(--muted)' }, title: '#' + t.name }, [h('span', { text: '#' + t.name }), opts.onRemove ? h('button.wb-chip-x', { type: 'button', text: '✕', title: 'Remove tag', onclick: e => { e.stopPropagation(); opts.onRemove(id); } }) : null]);
  };
  U.tagEditor = function (ids, onChange) {
    ids = (ids || []).slice();
    const box = h('div.wb-chips.wb-tags');
    const inp = h('input.wb-chip-input', { placeholder: '#tag', 'aria-label': 'Add a tag' });
    let pop = null;
    const add = async name => {
      name = name.replace(/^#/, '').trim(); if (!name) return;
      const t = await WB.api('tags.ensure', WB.worldId, name);
      if (!WB.tags.find(x => x.id === t.id)) WB.tags.push({ id: t.id, name: t.name, color: t.color || '', count: 0 });
      if (!ids.includes(t.id)) { ids.push(t.id); onChange(ids.slice()); }
      inp.value = ''; paint(); inp.focus();
    };
    const suggest = () => {
      const q = inp.value.replace(/^#/, '').toLowerCase();
      const list = WB.tags.filter(t => !ids.includes(t.id) && (!q || t.name.toLowerCase().includes(q))).slice(0, 8);
      if (pop) pop.close();
      if (!list.length) return;
      pop = U.popover(inp, h('div.wb-menu', list.map(t => h('button.wb-menu-item', { type: 'button', onclick: () => { pop.close(); add(t.name); } }, [U.dot(t.color), h('span', { text: '#' + t.name }), h('span.wb-menu-kbd', { text: String(t.count || '') })]))), { group: 'tagsug' });
    };
    inp.addEventListener('input', suggest);
    inp.addEventListener('focus', suggest);
    inp.addEventListener('keydown', e => { if ((e.key === 'Enter' || e.key === ',') && inp.value.trim()) { e.preventDefault(); if (pop) pop.close(); add(inp.value); } if (e.key === 'Backspace' && !inp.value && ids.length) { ids.pop(); onChange(ids.slice()); paint(); inp.focus(); } });
    const paint = () => { GK.clear(box); ids.forEach(id => box.appendChild(U.tagChip(id, { onRemove: x => { ids = ids.filter(y => y !== x); onChange(ids.slice()); paint(); } }))); box.appendChild(inp); };
    paint();
    return box;
  };
  U.audience = (value, onChange) => {
    const seg = ui.segmented({ value, options: WB.know.LEVELS.map(([v, l, hint]) => [v, l, hint]), onChange });
    seg.classList.add('wb-audience');
    return seg;
  };

  /* ---------------- pickers ---------------- */
  /** opts: { title, types: [typeId], multi, exclude: [ids], allowCreate, allowNone: 'label' } → entry | entries | null (undefined = cancelled with allowNone) */
  U.pickEntry = function ({ title = 'Choose an entry', types = [], multi = false, exclude = [], allowCreate = false, allowNone } = {}) {
    return new Promise(resolve => {
      let q = '', results = [], chosen = new Map(), typeFilter = types.slice(), done = false;
      const finish = v => { if (done) return; done = true; scrim.remove(); document.removeEventListener('keydown', onKey, true); resolve(v); };
      const list = h('div.wb-pick-list.gk-list');
      const count = h('span.gk-small.gk-muted');
      const run = WB.debounce(async () => {
        results = (await WB.api('search.query', WB.worldId, q, { typeIds: typeFilter, limit: 60 }).catch(() => [])).filter(e => !exclude.includes(e.id) && WB.visible(e));
        paint();
      }, 120);
      const paint = () => {
        GK.clear(list);
        results.forEach((e, i) => list.appendChild(U.row(e, {
          active: chosen.has(e.id) || (!multi && i === 0), menu: false, draggable: false,
          trailing: multi ? h('span.wb-check', { text: chosen.has(e.id) ? '✓' : '' }) : null,
          onClick: () => { if (multi) { chosen.has(e.id) ? chosen.delete(e.id) : chosen.set(e.id, e); paint(); } else finish(e); },
        })));
        if (!results.length) list.appendChild(h('div.gk-muted.gk-small.wb-pick-none', { text: q ? 'Nothing matches “' + q + '”.' : 'Nothing here yet.' }));
        count.textContent = multi ? chosen.size + ' chosen' : '';
      };
      const typeChips = h('div.wb-chips', (types.length ? types.map(id => WB.types.get(id)) : WB.typeList()).filter(Boolean).slice(0, 24).map(t => {
        const c = ui.chip({ label: t.icon + ' ' + t.plural, on: typeFilter.includes(t.id), onClick: () => { typeFilter = typeFilter.includes(t.id) ? typeFilter.filter(x => x !== t.id) : typeFilter.concat(t.id); c.classList.toggle('on', typeFilter.includes(t.id)); run(); } });
        return c;
      }));
      const search = U.search({ placeholder: 'Search by name, alias or text', autofocus: true, onInput: v => { q = v; run(); }, onEnter: () => { if (!multi && results[0]) finish(results[0]); } });
      const createBtn = allowCreate ? ui.button({ label: 'Create new…', icon: '＋', onClick: async () => {
        const t = WB.types.get((typeFilter[0] || types[0])) || null;
        const e = await U.createDialog({ type: t && t.key, title: q, open: false, types: types.length ? types : null });
        if (e) { if (multi) { chosen.set(e.id, e); results.unshift(e); paint(); } else finish(e); }
      } }) : null;
      const panel = ui.panel({ title, icon: '⌕', cls: 'gk-dialog wb-pick', body: [search, types.length === 1 ? null : typeChips, list] });
      panel.appendChild(h('div.gk-panel-foot', [count, h('span.gk-grow'), createBtn,
        allowNone ? ui.button({ label: allowNone, onClick: () => finish(null) }) : null,
        ui.button({ label: 'Cancel', onClick: () => finish(allowNone ? undefined : null) }),
        multi ? ui.button({ label: 'Add', kind: 'primary', onClick: () => finish([...chosen.values()]) }) : null]));
      const scrim = h('div.gk-scrim', { onclick: e => { if (e.target === scrim) finish(allowNone ? undefined : null); } }, [panel]);
      const onKey = e => { if (e.key === 'Escape') { e.stopPropagation(); finish(allowNone ? undefined : null); } };
      document.addEventListener('keydown', onKey, true);
      document.body.appendChild(scrim);
      U.listKeys(list);
      run();
    });
  };
  /** opts: { kind: 'image' | 'audio' | null } → media | null */
  U.pickMedia = function ({ kind = 'image', title } = {}) {
    return new Promise(resolve => {
      let done = false;
      const finish = v => { if (done) return; done = true; scrim.remove(); resolve(v); };
      const grid = h('div.wb-media-grid');
      const load = async () => {
        const list = await WB.api('media.list', WB.worldId, { kind }).catch(() => []);
        GK.clear(grid);
        if (!list.length) grid.appendChild(U.empty({ icon: '▣', title: 'No ' + (kind ? kind + 's' : 'files') + ' yet', text: 'Import from your computer or drop files here.' }));
        for (const m of list) grid.appendChild(h('button.wb-media-cell', { type: 'button', title: m.name, onclick: () => finish(m) }, [
          m.kind === 'image' ? h('img', { src: m.url, alt: '', loading: 'lazy' }) : h('div.wb-media-file', { text: m.kind === 'audio' ? '♪' : '▤' }),
          h('span.gk-small.gk-ellipsis', { text: m.name }),
        ]));
      };
      const panel = ui.panel({ title: title || (kind === 'image' ? 'Choose an image' : 'Choose a file'), icon: '▣', cls: 'gk-dialog wb-pick wb-pick-media', body: [grid] });
      panel.appendChild(h('div.gk-panel-foot', [
        ui.button({ label: 'Import from computer…', icon: '⇪', onClick: async () => { const got = await WB.api('media.import', WB.worldId, { kind, multi: false }); if (got && got[0]) finish(got[0]); } }),
        h('span.gk-grow'), ui.button({ label: 'Cancel', onClick: () => finish(null) }),
      ]));
      WB.dropFiles(panel, async files => { const saved = await WB.saveFiles(files); if (saved[0]) finish(saved[0]); });
      const scrim = h('div.gk-scrim', { onclick: e => { if (e.target === scrim) finish(null); } }, [panel]);
      document.body.appendChild(scrim);
      load();
    });
  };
  /** files dropped from the computer */
  WB.dropFiles = (el, fn) => {
    el.addEventListener('dragover', e => { if ([...e.dataTransfer.types].includes('Files')) { e.preventDefault(); el.classList.add('wb-drop'); } });
    el.addEventListener('dragleave', () => el.classList.remove('wb-drop'));
    el.addEventListener('drop', e => { el.classList.remove('wb-drop'); if (e.dataTransfer.files.length) { e.preventDefault(); fn([...e.dataTransfer.files]); } });
  };
  WB.saveFiles = async files => {
    const out = [];
    for (const f of files) {
      try { out.push(await WB.api('media.save', WB.worldId, { name: f.name, mime: f.type, bytes: new Uint8Array(await f.arrayBuffer()) })); }
      catch (e) { WB.fail(e); }
    }
    if (out.length) ui.toast(out.length === 1 ? 'Added “' + out[0].name + '”' : out.length + ' files added', '▣');
    return out;
  };

  /* ---------------- the create dialog ---------------- */
  /** opts: { type (key|id), parentId, title, fields, open = true, types: [ids] (limits the choice) } → entry | null */
  U.createDialog = function (opts = {}) {
    return new Promise(resolve => {
      let done = false;
      const pool = (opts.types && opts.types.length ? opts.types.map(id => WB.types.get(id)) : WB.typeList()).filter(Boolean);
      let type = WB.type(opts.type) || pool.find(t => t.key === 'character') || pool[0];
      let parentId = opts.parentId || null, title = opts.title || '', culture = null, preset = null, start = opts.start || null;
      const presetBox = h('div.wb-chips.wb-presets');
      // an optional date for types that have one ("Born", "Began"…), prefilled when the dialog opens at a date
      const dateBox = h('div');
      const paintDate = () => {
        GK.clear(dateBox);
        if (!type.dated && !start) return;
        dateBox.appendChild(ui.field({ label: (type.dated && type.dated.start) || 'Date', hint: start ? '' : 'Optional', control: U.dateInput({ value: start, onChange: v => { start = v; } }) }));
      };
      const paintPresets = () => {
        GK.clear(presetBox);
        const list = (WB.F.PRESETS || []).filter(p => p.type === type.key);
        if (!list.length) return;
        presetBox.appendChild(h('span.gk-small.gk-muted', { text: 'Start from:' }));
        presetBox.appendChild(ui.chip({ label: 'Blank', on: !preset, onClick: () => { preset = null; paintPresets(); } }));
        for (const p of list) presetBox.appendChild(ui.chip({ label: p.icon + ' ' + p.label, on: preset === p, title: 'Prefills fields and a page of guiding questions', onClick: () => { preset = preset === p ? null : p; paintPresets(); titleIn.focus(); } }));
      };
      const finish = v => { if (done) return; done = true; scrim.remove(); document.removeEventListener('keydown', onKey, true); resolve(v); };
      const dupBox = h('div.wb-dup');
      const checkDup = () => {
        GK.clear(dupBox);
        const v = title.trim().toLowerCase();
        if (v.length < 2) return;
        const same = WB.titles.filter(t => t.title.toLowerCase() === v || (t.aliases || []).some(a => a.toLowerCase() === v));
        if (same.length) GK.append(dupBox, [h('span.gk-small', { text: '⚠ Already in your world: ' }), ...same.slice(0, 3).map(t => U.chip(t, { size: 'sm', onClick: () => { finish(null); WB.open(t.id); } })), h('span.gk-small.gk-muted', { text: ' — create anyway, or open it.' })]);
      };
      const titleIn = ui.input({ value: title, placeholder: 'Name', onInput: v => { title = v; checkDup(); } });
      titleIn.classList.add('wb-create-title');
      const sugg = h('div.wb-chips.wb-name-sugg');
      const cultureSel = h('span');
      const typeGrid = h('div.wb-type-grid');
      const paintTypes = () => {
        GK.clear(typeGrid);
        for (const t of pool) typeGrid.appendChild(h('button.wb-type-cell', { type: 'button', class: t === type ? 'on' : '', style: { '--c': t.color }, title: t.name, onclick: () => { type = t; preset = null; paintTypes(); paintNames(); paintPresets(); paintDate(); titleIn.focus(); } }, [h('span.wb-type-cell-ico', { text: t.icon }), h('span.gk-ellipsis', { text: t.name })]));
      };
      const roll = async () => {
        const kind = type.key === 'place' ? 'place' : 'person';
        const taken = new Set(WB.titles.map(t => t.title.toLowerCase()));
        // the Lexicon knows the culture's samples, its language's sounds and the world's style, in that order
        let list = null;
        if (WB.lexicon && WB.lexicon.suggest) {
          try { list = (await WB.lexicon.suggest({ cultureId: culture || undefined, kind: type.key === 'character' ? 'person' : kind === 'place' ? 'place' : 'given', count: 8, seed: String(Math.random()) }) || []).filter(n => n && !taken.has(String(n).toLowerCase())).slice(0, 6); } catch { list = null; }
        }
        if (!list || !list.length) {
          let samples = null, family = null;
          if (culture) { const c = await WB.api('entries.get', culture).catch(() => null); if (c) { samples = c.fields.names_given; family = c.fields.names_family; } }
          const style = (WB.world.settings.nameStyle) || 'common';
          list = kind === 'person' && type.key === 'character'
            ? Array.from({ length: 6 }, (_, i) => WB.names.fullName({ style, given: samples, family, seed: Math.random() + i }))
            : WB.names.generate({ style, kind, count: 6, samples, avoid: WB.titles.map(t => t.title) });
        }
        GK.clear(sugg);
        list.forEach(n => sugg.appendChild(ui.chip({ label: n, onClick: () => { titleIn.value = title = n; checkDup(); titleIn.focus(); } })));
      };
      const paintNames = async () => {
        GK.clear(sugg); GK.clear(cultureSel);
        if (!type.namegen) return;
        const cultures = WB.titles.filter(t => (WB.types.get(t.typeId) || {}).key === 'culture');
        if (cultures.length) cultureSel.appendChild(ui.select({ value: culture || '', options: [['', 'Any culture']].concat(cultures.map(c => [c.id, c.title])), onChange: v => { culture = v || null; roll(); } }));
        roll();
      };
      const parentBox = h('div.gk-row.nowrap');
      const paintParent = () => {
        GK.clear(parentBox);
        parentBox.append(parentId ? U.chip(parentId, { size: 'sm', onRemove: () => { parentId = null; paintParent(); } }) : h('span.gk-small.gk-muted', { text: 'Top level' }),
          ui.button({ label: 'Inside…', small: true, kind: 'ghost', onClick: async () => { const p = await U.pickEntry({ title: 'Put it inside…', allowNone: 'Top level' }); if (p !== undefined) { parentId = p ? p.id : null; paintParent(); } } }));
      };
      const create = async () => {
        try {
          const e = await WB.api('entries.create', { worldId: WB.worldId, typeId: type.id, parentId, title: title.trim() || (preset ? preset.label : ''), fields: Object.assign({}, preset ? preset.fields : {}, opts.fields || {}), start: start || undefined, body: opts.body || (preset ? preset.body : undefined), tagNames: opts.tagNames, icon: preset && preset.icon !== type.icon ? preset.icon : undefined });
          finish(e);
          if (opts.open !== false) WB.open(e.id, { focusTitle: !title.trim() });
        } catch (err) { WB.fail(err); }
      };
      const panel = ui.panel({ title: 'New entry', icon: '＋', cls: 'gk-dialog wb-create', body: [
        pool.length > 1 ? typeGrid : null,
        ui.field({ label: 'Name', control: h('div.gk-row.nowrap', [h('div.gk-grow', [titleIn]), cultureSel, ui.button({ icon: '🎲', title: 'Suggest names', kind: 'ghost', onClick: () => { if (type.namegen) roll(); else ui.toast('Name suggestions are for characters, places, cultures and species', 'ℹ'); } })]) }),
        dupBox,
        sugg,
        presetBox,
        dateBox,
        ui.field({ label: 'Inside', control: parentBox }),
      ] });
      panel.appendChild(h('div.gk-panel-foot', [h('span.gk-small.gk-muted.gk-grow', [U.kbd('Enter'), ' create · ', U.kbd('Esc'), ' cancel']), ui.button({ label: 'Cancel', onClick: () => finish(null) }), ui.button({ label: 'Create', kind: 'primary', onClick: create })]));
      const scrim = h('div.gk-scrim', { onclick: e => { if (e.target === scrim) finish(null); } }, [panel]);
      const onKey = e => { if (e.key === 'Escape') { e.stopPropagation(); finish(null); } else if (e.key === 'Enter' && !e.shiftKey && (document.activeElement === titleIn || panel.contains(document.activeElement)) && !document.activeElement.matches('button')) { e.preventDefault(); create(); } };
      document.addEventListener('keydown', onKey, true);
      document.body.appendChild(scrim);
      paintTypes(); paintParent(); paintNames(); paintPresets(); paintDate();
      setTimeout(() => titleIn.focus(), 30);
    });
  };
})(window);
