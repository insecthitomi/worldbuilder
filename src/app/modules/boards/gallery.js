/* Boards: the list of boards (with live miniature previews), the new-board dialog with templates, and the
   miniature renderer shared with the canvas's minimap. */
(function (root) {
  'use strict';
  const GK = root.GK, WB = root.WB, h = GK.h, ui = GK.ui;
  const B = root.WBBoards = root.WBBoards || {};
  const NS = 'http://www.w3.org/2000/svg';
  const svg = (tag, attrs) => { const el = document.createElementNS(NS, tag); for (const [k, v] of Object.entries(attrs || {})) if (v != null) el.setAttribute(k, v); return el; };
  B.svg = svg;
  B.DEFAULT = { note: '#f2c94c', frame: '#9aa5b1', checklist: '#4fb6b2', text: '', image: '#9aa5b1', entry: '#9aa5b1' };
  B.COLORS = [['#f2c94c', 'Sun'], ['#f2994a', 'Amber'], ['#eb5757', 'Coral'], ['#e06aa8', 'Rose'], ['#9b7bd8', 'Violet'], ['#5b8def', 'Sky'], ['#4fb6b2', 'Teal'], ['#5fb38a', 'Moss'], ['#9aa5b1', 'Slate']];
  const PURPOSE_ICON = { Plotting: '⟿', 'Mind map': '✺', 'Mood board': '❖', Investigation: '⌕', Planning: '☰' };

  /** bounding box of rects ({x, y, w, h}) */
  B.bbox = list => {
    if (!list.length) return null;
    let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity;
    for (const r of list) { x0 = Math.min(x0, r.x); y0 = Math.min(y0, r.y); x1 = Math.max(x1, r.x + r.w); y1 = Math.max(y1, r.y + r.h); }
    return { x: x0, y: y0, w: x1 - x0, h: y1 - y0 };
  };

  /** a miniature of a board: items [{id|ref, kind, x, y, w, h, color, typeId}], links [[from, to]] */
  B.mini = function (items, links, { pad = 40, cls = 'bd-minisvg', view } = {}) {
    const s = svg('svg', { class: cls, preserveAspectRatio: 'xMidYMid meet', 'aria-hidden': 'true' });
    const bb = B.bbox(items.concat(view ? [view] : []));
    if (!bb) { s.setAttribute('viewBox', '0 0 100 60'); return s; }
    s.setAttribute('viewBox', [bb.x - pad, bb.y - pad, bb.w + pad * 2, bb.h + pad * 2].map(v => Math.round(v)).join(' '));
    const byId = new Map(items.map(i => [i.id || i.ref, i]));
    const gF = svg('g'), gL = svg('g'), gI = svg('g');
    s.append(gF, gL, gI);
    for (const it of items) {
      const c = it.color || (it.kind === 'entry' && it.typeId && WB.types.get(it.typeId) ? WB.types.get(it.typeId).color : B.DEFAULT[it.kind] || '#9aa5b1');
      if (it.kind === 'frame') gF.appendChild(svg('rect', { x: it.x, y: it.y, width: it.w, height: it.h, rx: 14, fill: c, 'fill-opacity': .1, stroke: c, 'stroke-opacity': .7, 'stroke-width': 4 }));
      else if (it.kind === 'text') { for (let k = 0; k < Math.max(1, Math.min(3, Math.floor(it.h / 30))); k++) gI.appendChild(svg('rect', { x: it.x, y: it.y + 10 + k * 26, width: it.w * (k ? .7 : .95), height: 12, rx: 6, fill: 'currentColor', 'fill-opacity': .35 })); }
      else if (it.kind === 'image') gI.appendChild(svg('rect', { x: it.x, y: it.y, width: it.w, height: it.h, rx: 8, fill: 'currentColor', 'fill-opacity': .22 }));
      else if (it.kind === 'entry') { gI.appendChild(svg('rect', { x: it.x, y: it.y, width: it.w, height: it.h, rx: 10, fill: 'currentColor', 'fill-opacity': .14 })); gI.appendChild(svg('rect', { x: it.x, y: it.y, width: 10, height: it.h, rx: 5, fill: c })); }
      else gI.appendChild(svg('rect', { x: it.x, y: it.y, width: it.w, height: it.h, rx: 8, fill: c, 'fill-opacity': it.kind === 'checklist' ? .45 : .75 }));
    }
    for (const [a, b] of links || []) {
      const p = byId.get(a), q = byId.get(b);
      if (p && q) gL.appendChild(svg('line', { x1: p.x + p.w / 2, y1: p.y + p.h / 2, x2: q.x + q.w / 2, y2: q.y + q.h / 2, stroke: 'currentColor', 'stroke-opacity': .45, 'stroke-width': 4 }));
    }
    return s;
  };

  /* ---------------- the new-board dialog ---------------- */
  let templates = null;
  B.templates = async () => (templates = templates || await WB.api('boards.templates'));
  /** opts: { title, template } → board id | null */
  B.createDialog = async function (opts = {}) {
    const list = await B.templates();
    return new Promise(resolve => {
      let pick = opts.template || 'blank', done = false, edited = !!opts.title;
      const name = ui.input({ value: opts.title || '', placeholder: 'Name the board' });
      name.classList.add('bd-new-name');
      name.addEventListener('input', () => { edited = !!name.value.trim(); });
      const grid = h('div.bd-tpl-grid', { role: 'radiogroup', 'aria-label': 'Template' });
      const paint = () => {
        GK.clear(grid);
        for (const t of list) {
          const tile = h('button.bd-tpl', { type: 'button', role: 'radio', 'aria-checked': String(t.key === pick), class: t.key === pick ? 'on' : '', title: t.desc, onclick: () => { pick = t.key; if (!edited) name.placeholder = t.key === 'blank' ? 'Name the board' : t.label; paint(); } }, [
            h('div.bd-tpl-pv', [t.preview.items.length ? B.mini(t.preview.items, t.preview.links, { pad: 60 }) : h('span.bd-tpl-blank', { text: '＋' })]),
            h('div.bd-tpl-cap', [h('b', [h('span.bd-tpl-ico', { text: t.icon }), t.label]), h('span.gk-small.gk-muted', { text: t.desc })]),
          ]);
          tile.addEventListener('dblclick', create);
          grid.appendChild(tile);
        }
      };
      async function create() {
        try {
          const t = list.find(x => x.key === pick) || list[0];
          const r = await WB.api('boards.create', WB.worldId, { title: name.value.trim() || (t.key === 'blank' ? 'New board' : t.label), template: pick });
          finish(r.board.id);
        } catch (e) { WB.fail(e); }
      }
      const finish = v => { if (done) return; done = true; scrim.remove(); document.removeEventListener('keydown', key, true); resolve(v); };
      const panel = ui.panel({ title: 'New board', icon: '▦', cls: 'gk-dialog bd-new', body: [name, h('div.gk-small.gk-muted', { text: 'Start empty or from a layout — everything on it can be moved, recoloured or deleted.' }), grid] });
      panel.appendChild(h('div.gk-panel-foot', [h('span.gk-small.gk-muted.gk-grow', [WB.ui.kbd('Enter'), ' create · ', WB.ui.kbd('Esc'), ' cancel']), ui.button({ label: 'Cancel', onClick: () => finish(null) }), ui.button({ label: 'Create board', kind: 'primary', onClick: create })]));
      const scrim = h('div.gk-scrim', { onclick: e => { if (e.target === scrim) finish(null); } }, [panel]);
      const key = e => { if (e.key === 'Escape') { e.stopPropagation(); finish(null); } else if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); create(); } };
      document.addEventListener('keydown', key, true);
      document.body.appendChild(scrim);
      paint();
      setTimeout(() => name.focus(), 30);
    });
  };

  /* ---------------- the gallery ---------------- */
  /** opts: { store, open(id) } → cleanup */
  B.gallery = async function (page, opts) {
    const { store } = opts;
    let boards = [], q = '', alive = true;
    const head = h('div.gk-page-head.bd-ghead', [h('div.gk-grow', [h('h1', { text: 'Boards' }), h('p', { text: 'Infinite canvases for plotting, mind maps, investigations and mood boards. Put entries, notes, pictures and checklists side by side and wire them together.' })])]);
    const search = WB.ui.search({ placeholder: 'Find a board', onInput: v => { q = v.trim().toLowerCase(); paint(); } });
    const sortSel = ui.select({ value: store.get().sort || 'updated', options: [['updated', 'Recently edited'], ['title', 'Name'], ['items', 'Most cards']], onChange: v => { store.patch({ sort: v }); paint(); } });
    const bar = h('div.bd-gbar', [h('div.bd-gsearch', [search]), sortSel, h('span.gk-grow'), WB.share ? null : ui.button({ label: 'New board', icon: '＋', kind: 'primary', title: 'Create a board (N)', onClick: () => newBoard() })]);
    const grid = h('div.bd-ggrid');
    const tplBox = h('div.bd-gtpl');
    GK.append(page, [head, bar, grid, tplBox]);
    async function newBoard(template) { const id = await B.createDialog({ template }); if (id) opts.open(id); }
    async function load() { boards = (await WB.api('boards.list', WB.worldId).catch(() => [])).filter(b => WB.visible(b)); if (alive) paint(); }
    function paint() {
      GK.clear(grid);
      const s = store.get().sort || 'updated';
      const list = boards.filter(b => !q || (b.title + ' ' + (b.summary || '')).toLowerCase().includes(q))
        .sort(s === 'title' ? (a, b) => a.title.localeCompare(b.title) : s === 'items' ? (a, b) => b.itemCount - a.itemCount : (a, b) => b.updatedAt.localeCompare(a.updatedAt));
      if (!boards.length) {
        grid.appendChild(ui.panel({ cls: 'bd-gempty', body: [WB.ui.empty({ icon: '▦', title: 'No boards yet', text: 'A board is a big table to think on: pin up characters and places, scribble notes, drop in pictures and draw arrows between them. Pick a starting layout below, or begin with a blank one.',
          actions: WB.share ? [] : [ui.button({ label: 'New board', icon: '＋', kind: 'primary', onClick: () => newBoard() })] })] }));
      } else if (!list.length) grid.appendChild(h('div.gk-muted.bd-gnone', { text: 'No board matches “' + q + '”.' }));
      for (const b of list) grid.appendChild(card(b));
      paintTemplates();
    }
    function card(b) {
      const purpose = (b.fields && b.fields.purpose) || '';
      const el = h('div.bd-gcard', { tabindex: 0, role: 'link', title: 'Open “' + b.title + '”', dataset: { id: b.id } }, [
        h('div.bd-gprev', [b.itemCount ? B.mini(b.preview.items, b.preview.links, { pad: 50 }) : h('div.bd-gprev-empty', { text: 'Empty board' })]),
        h('div.bd-gcap', [
          h('div.gk-row.nowrap', [WB.ui.icon(b), h('b.gk-ellipsis.gk-grow', { text: b.title }), purpose ? h('span.wb-badge', { text: (PURPOSE_ICON[purpose] || '') + ' ' + purpose }) : null]),
          h('div.gk-small.gk-muted.gk-ellipsis', { text: [WB.fmt.plural(b.itemCount, 'card'), b.linkCount ? WB.fmt.plural(b.linkCount, 'connector') : '', b.entryCount ? WB.fmt.plural(b.entryCount, 'entry', 'entries') : '', 'edited ' + WB.fmt.rel(b.updatedAt)].filter(Boolean).join(' · ') }),
          b.summary ? h('div.gk-small.bd-gsum', { text: b.summary }) : null,
        ]),
      ]);
      el.addEventListener('click', ev => { if (ev.ctrlKey || ev.metaKey) WB.peek(b.id); else opts.open(b.id); });
      el.addEventListener('keydown', ev => { if (ev.key === 'Enter') opts.open(b.id); });
      el.addEventListener('contextmenu', ev => { ev.preventDefault(); WB.ui.entryMenu(b, ev, WB.share ? [] : [{ label: 'Duplicate the board with its cards', icon: '⧉', onClick: async () => { const c = await WB.api('boards.duplicate', b.id); ui.toast('Copied to “' + c.board.title + '”', '⧉'); load(); } }]); });
      return el;
    }
    async function paintTemplates() {
      GK.clear(tplBox);
      if (WB.share) return;
      const list = (await B.templates()).filter(t => t.key !== 'blank');
      if (!alive) return;
      GK.clear(tplBox);
      tplBox.append(h('div.wb-sec-head', [h('div.gk-grow', [h('h4', { text: 'Start from a layout' })])]),
        h('div.bd-gtpl-row', list.map(t => h('button.bd-tpl.small', { type: 'button', title: t.desc, onclick: () => newBoard(t.key) }, [
          h('div.bd-tpl-pv', [B.mini(t.preview.items, t.preview.links, { pad: 60 })]), h('div.bd-tpl-cap', [h('b', [h('span.bd-tpl-ico', { text: t.icon }), t.label])]),
        ]))));
    }
    const onKey = e => {
      if (!page.isConnected || document.querySelector('.gk-scrim, .wb-pop') || (e.target.closest && e.target.closest('input, textarea, select, [contenteditable="true"]'))) return;
      if (e.key.toLowerCase() === 'n' && !e.ctrlKey && !e.metaKey && !e.altKey && !WB.share) { e.preventDefault(); newBoard(); }
    };
    document.addEventListener('keydown', onKey);
    const off = WB.onChange(['entries', 'board_items', 'board_links'], () => alive && load(), 300);
    await load();
    return () => { alive = false; off(); document.removeEventListener('keydown', onKey); };
  };
})(window);
