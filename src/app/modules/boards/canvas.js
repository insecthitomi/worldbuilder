/* Boards: the canvas. Pan/zoom, cards (note, text, entry, image, checklist, frame), connectors with arrows and
   labels, lasso and shift-click selection, move/resize with snapping, colours, z-order, align/distribute,
   duplicate, copy/paste, delete with undo, drag-in of entries/pictures/files, convert note → entry. Cards are plain
   token-styled divs inside a solid panel (no glass per card); pointer maths goes through GK.pointIn / GK.local. */
(function (root) {
  'use strict';
  const GK = root.GK, WB = root.WB, h = GK.h, ui = GK.ui;
  const B = root.WBBoards = root.WBBoards || {};
  const KIND_MIME = 'application/x-wb-board-kind', MEDIA_MIME = 'application/x-wb-media';
  const MINZ = .08, MAXZ = 4, GRID = 20;
  const SIZE = { note: [220, 150], entry: [250, 140], image: [280, 200], checklist: [250, 170], frame: [560, 400], text: [300, 64] };
  const ADD = [['note', '✎', 'Note', 'A sticky note (N)'], ['text', 'T', 'Text', 'Free text (T)'], ['checklist', '☑', 'Checklist', 'A list to tick off (L)'], ['frame', '▭', 'Frame', 'A labelled group; moves what is inside (F)'], ['image', '▣', 'Picture', 'From the Library or your computer (I)'], ['entry', '◇', 'Entry', 'Any entry of the world (E)']];
  B.clip = null;

  /** mounts the editor for one board into `page`; opts: { store, back() } → cleanup */
  B.canvas = async function (page, boardId, opts) {
    const { store } = opts;
    const K = root.WBMediaKit;
    const RO = WB.share;
    let first = await WB.api('boards.get', boardId);
    const S = {
      board: first.board, items: new Map(), links: new Map(), ents: new Map(),
      view: { x: 0, y: 0, z: 1 }, sel: new Set(), link: null, editing: null, alive: true,
      tool: store.get().tool || 'pan', snap: store.get().snap !== false, undo: [], redo: [], ownUntil: 0, space: false, drag: null, suppress: false, pointer: null,
    };
    const put = it => S.items.set(it.id, it);
    const putLink = l => S.links.set(l.id, l);
    const absorb = d => { S.items = new Map(); S.links = new Map(); d.items.forEach(put); d.links.forEach(putLink); for (const e of d.entries || []) S.ents.set(e.id, e); S.board = d.board; };
    absorb(first); first = null;

    /* ================= layout ================= */
    page.classList.add('bd-page');
    const titleIn = h('input.bd-title', { value: S.board.title, spellcheck: false, 'aria-label': 'Board name', title: 'Rename the board' });
    titleIn.readOnly = RO;
    titleIn.addEventListener('change', () => { const v = titleIn.value.trim(); if (v && v !== S.board.title) WB.api('entries.update', boardId, { title: v }).then(b => { S.board = b; }).catch(WB.fail); else titleIn.value = S.board.title; });
    titleIn.addEventListener('keydown', e => { if (e.key === 'Enter' || e.key === 'Escape') { if (e.key === 'Escape') titleIn.value = S.board.title; titleIn.blur(); canvas.focus(); } });
    const zoomLbl = h('button.bd-zoomlbl', { type: 'button', title: 'Zoom: click for 100% (0)', onclick: () => zoomAt(1) });
    const toolSeg = ui.segmented({ value: S.tool, options: [['pan', 'Pan', 'Drag to move around; Shift+drag selects (H)'], ['select', 'Select', 'Drag to select an area; Space+drag moves around (V)']], onChange: v => setTool(v) });
    toolSeg.querySelectorAll('button').forEach((b, i) => b.replaceChildren(h('span', { text: i ? '⬚' : '✋' }), h('span.bd-lbl-n', { text: i ? ' Select' : ' Pan' })));
    const snapChip = ui.chip({ label: '# Snap', on: S.snap, title: 'Snap cards to the grid (G)', onClick: () => setSnap(!S.snap) });
    const undoBtn = ui.button({ icon: '↶', small: true, kind: 'ghost', title: 'Undo (Ctrl+Z)', onClick: () => undo() });
    const redoBtn = ui.button({ icon: '↷', small: true, kind: 'ghost', title: 'Redo (Ctrl+Y)', onClick: () => redo() });
    const sideBtn = ui.button({ icon: '☰', small: true, kind: 'ghost', title: 'Show or hide the side panel', onClick: () => { store.patch({ side: !store.get().side }); wrap.classList.toggle('noside', !store.get().side); sideBtn.classList.toggle('on', !!store.get().side); requestAnimationFrame(applyView); } });
    sideBtn.classList.toggle('on', store.get().side !== false);
    const findIn = h('input.bd-find', { placeholder: 'Find on the board', spellcheck: false, 'aria-label': 'Find on the board', hidden: true });
    const findN = h('span.bd-find-n.gk-tiny.gk-muted');
    const findBtn = ui.button({ icon: '⌕', small: true, kind: 'ghost', title: 'Find on the board (Ctrl+F)', onClick: () => openFind() });
    const head = h('div.bd-head', [
      ui.button({ label: 'Boards', icon: '‹', small: true, kind: 'ghost', title: 'All boards', onClick: () => opts.back() }),
      RO ? null : sideBtn,
      h('span.bd-head-ico', { text: WB.iconOf(S.board), style: { color: WB.colorOf(S.board) } }), titleIn,
      h('span.gk-grow'),
      h('div.gk-row.nowrap.bd-findbox', [findBtn, findIn, findN]),
      RO ? WB.ui.badge('Share view: read-only', 'warn') : null,
      RO ? null : h('div.gk-row.nowrap.bd-undo', [undoBtn, redoBtn]),
      toolSeg,
      h('div.gk-row.nowrap.bd-zoom', [ui.button({ icon: '−', small: true, kind: 'ghost', title: 'Zoom out (−)', onClick: () => zoomAt(S.view.z / 1.25) }), zoomLbl, ui.button({ icon: '＋', small: true, kind: 'ghost', title: 'Zoom in (+)', onClick: () => zoomAt(S.view.z * 1.25) }),
        ui.button({ icon: '⤢', small: true, kind: 'ghost', title: 'Fit everything (1)', onClick: () => fit() })]),
      RO ? null : snapChip,
      ui.button({ icon: '⋯', small: true, kind: 'ghost', title: 'Board menu', onClick: e => boardMenu(e.currentTarget) }),
    ]);
    const svgLinks = B.svg('svg', { class: 'bd-svg', width: '1', height: '1' });
    const itemsBox = h('div.bd-items'), labels = h('div.bd-labels');
    const world = h('div.bd-world', [itemsBox, svgLinks, labels]);
    const lasso = h('div.bd-lasso', { hidden: true });
    const selbar = h('div.bd-selbar.gk-dialog', { hidden: true, role: 'toolbar', 'aria-label': 'Selection' });
    const mini = h('div.bd-mini', { title: 'Overview: click or drag to move around', hidden: store.get().mini === false });
    const hint = h('div.bd-hint.gk-small');
    const emptyHint = h('div.bd-emptyhint', { hidden: true });
    const canvas = h('div.bd-canvas', { tabindex: 0, role: 'application', 'aria-label': 'Board canvas', class: 'tool-' + S.tool }, [world, lasso, emptyHint, selbar, mini, hint]);
    const stage = ui.panel({ material: 'solid', cls: 'bd-stage', body: [head, canvas] });
    const side = RO ? null : sidePanel();
    const wrap = h('div.bd-wrap', { class: store.get().side === false || RO ? 'noside' : '' }, [side, stage]);
    page.appendChild(wrap);

    /* ================= geometry ================= */
    const els = new Map();   // id → { el, key }
    const local = (cx, cy) => GK.pointIn(canvas, cx, cy);
    const toWorld = (cx, cy) => { const p = local(cx, cy); return { x: (p.x - S.view.x) / S.view.z, y: (p.y - S.view.y) / S.view.z }; };
    const snap = v => (S.snap ? Math.round(v / GRID) * GRID : Math.round(v));
    const center = () => ({ x: (canvas.clientWidth / 2 - S.view.x) / S.view.z, y: (canvas.clientHeight / 2 - S.view.y) / S.view.z });
    const rectOf = it => ({ x: it.x, y: it.y, w: it.w, h: it.h });
    const inside = (a, f) => { const cx = a.x + a.w / 2, cy = a.y + a.h / 2; return cx > f.x && cx < f.x + f.w && cy > f.y && cy < f.y + f.h; };
    const visibleItem = it => {
      if (it.kind !== 'entry' || !it.entryId) return true;
      const e = S.ents.get(it.entryId);
      return !RO || (e && !e.deletedAt && WB.visible(e));
    };
    const shown = () => [...S.items.values()].filter(visibleItem);
    const colorOf = it => (it.kind === 'entry' && !it.color ? WB.colorOf(S.ents.get(it.entryId) || {}) : it.color || B.DEFAULT[it.kind] || '');

    /* ================= view ================= */
    let saveView = WB.debounce(() => { const views = Object.assign({}, store.get().views || {}); views[boardId] = { x: Math.round(S.view.x), y: Math.round(S.view.y), z: +S.view.z.toFixed(3) }; const keep = Object.keys(views).slice(-60); store.patch({ views: Object.fromEntries(keep.map(k => [k, views[k]])) }); }, 500);
    function applyView() {
      const v = S.view;
      world.style.transform = 'translate(' + v.x + 'px, ' + v.y + 'px) scale(' + v.z + ')';
      let g = GRID * v.z; while (g < 12) g *= 5;
      canvas.style.setProperty('--grid', g + 'px');
      canvas.style.setProperty('--gx', v.x + 'px');
      canvas.style.setProperty('--gy', v.y + 'px');
      canvas.style.setProperty('--zoom', String(v.z));
      zoomLbl.textContent = Math.round(v.z * 100) + '%';
      canvas.classList.toggle('far', v.z < .45);
      placeSelbar(); paintMini();
      saveView();
    }
    function zoomAt(nz, p) {
      nz = Math.max(MINZ, Math.min(MAXZ, nz));
      p = p || { x: canvas.clientWidth / 2, y: canvas.clientHeight / 2 };
      S.view.x = p.x - (p.x - S.view.x) * (nz / S.view.z);
      S.view.y = p.y - (p.y - S.view.y) * (nz / S.view.z);
      S.view.z = nz;
      applyView();
    }
    function fit(list, { max = 1.25 } = {}) {
      const bb = B.bbox((list || shown()).map(rectOf));
      const W = canvas.clientWidth || 800, H = canvas.clientHeight || 500;
      if (!bb) { S.view = { x: W / 2, y: H / 2, z: 1 }; applyView(); return; }
      const pad = 60;
      const z = Math.max(MINZ, Math.min(max, (W - pad * 2) / Math.max(bb.w, 1), (H - pad * 2) / Math.max(bb.h, 1)));
      S.view = { z, x: (W - bb.w * z) / 2 - bb.x * z, y: (H - bb.h * z) / 2 - bb.y * z };
      applyView();
    }
    function reveal(ids) {
      const list = ids.map(id => S.items.get(id)).filter(Boolean);
      if (!list.length) return;
      const bb = B.bbox(list.map(rectOf)), W = canvas.clientWidth, H = canvas.clientHeight;
      const z = Math.min(S.view.z < .5 ? 1 : S.view.z, (W - 120) / bb.w, (H - 120) / bb.h);
      S.view = { z: Math.max(MINZ, Math.min(MAXZ, z)), x: 0, y: 0 };
      S.view.x = W / 2 - (bb.x + bb.w / 2) * S.view.z; S.view.y = H / 2 - (bb.y + bb.h / 2) * S.view.z;
      applyView();
    }

    /* ================= rendering ================= */
    function entKey(id) { const e = id && S.ents.get(id); return e ? [e.title, e.summary, e.coverId, e.typeId, e.icon, e.color, e.deletedAt, e.audience, e.start && e.start.day, e.end && e.end.day].join('|') : 'none'; }
    const keyOf = it => JSON.stringify([it.kind, it.text, it.data, it.color, it.mediaId, it.entryId, entKey(it.entryId), RO]);
    function render() {
      const list = shown();
      const order = list.slice().sort((a, b) => (a.kind === 'frame' ? 0 : 1) - (b.kind === 'frame' ? 0 : 1) || a.z - b.z);
      const seen = new Set();
      order.forEach((it, i) => {
        seen.add(it.id);
        let rec = els.get(it.id);
        const key = keyOf(it);
        if (!rec || (rec.key !== key && S.editing !== it.id)) {
          const el = build(it);
          if (rec) rec.el.replaceWith(el); else itemsBox.appendChild(el);
          rec = { el, key }; els.set(it.id, rec);
        }
        const el = rec.el;
        el.style.left = it.x + 'px'; el.style.top = it.y + 'px'; el.style.width = it.w + 'px'; el.style.height = it.h + 'px';
        el.style.zIndex = String(it.kind === 'frame' ? 10 + i : 2000 + i);
        el.classList.toggle('sel', S.sel.has(it.id));
        if (finds.length || canvas.classList.contains('finding')) el.classList.toggle('hit', finds.includes(it.id));
      });
      for (const [id, rec] of els) if (!seen.has(id)) { rec.el.remove(); els.delete(id); }
      for (const id of [...S.sel]) if (!seen.has(id)) S.sel.delete(id);
      if (S.link && !S.links.has(S.link)) S.link = null;
      frameCounts();
      renderLinks();
      emptyHint.hidden = !!list.length;
      mini.hidden = !list.length || store.get().mini === false;
      if (!list.length) paintEmptyHint();
      paintSelbar(); paintMini(); paintHint();
      undoBtn.disabled = !S.undo.length; redoBtn.disabled = !S.redo.length;
    }
    function frameCounts() {
      const all = shown();
      for (const f of all.filter(x => x.kind === 'frame')) {
        const rec = els.get(f.id); if (!rec) continue;
        const n = all.filter(x => x.id !== f.id && x.kind !== 'frame' && inside(x, f)).length;
        const c = rec.el.querySelector('.bd-frame-count'); if (c) c.textContent = n ? String(n) : '';
      }
    }
    /** updates only positions/sizes during a drag (no rebuilds) */
    function place(ids) {
      for (const id of ids) {
        const it = S.items.get(id), rec = els.get(id);
        if (!it || !rec) continue;
        rec.el.style.left = it.x + 'px'; rec.el.style.top = it.y + 'px'; rec.el.style.width = it.w + 'px'; rec.el.style.height = it.h + 'px';
      }
      renderLinks();
    }

    /* ----- cards ----- */
    function rich(html) { const d = h('div.wb-editor.readonly.bd-rich'); d.appendChild(WB.editor.prepare(html || '', RO)); return d; }
    function build(it) {
      const el = h('div.bd-item', { class: 'k-' + it.kind + (it.color ? ' tinted' : ''), dataset: { id: it.id } });
      const c = colorOf(it);
      if (c) el.style.setProperty('--c', c);
      if (it.kind === 'note') el.appendChild(h('div.bd-note', [rich(it.text)]));
      else if (it.kind === 'text') el.appendChild(rich(it.text));
      else if (it.kind === 'frame') el.appendChild(h('div.bd-frame-label', { title: RO ? '' : 'Drag to move the frame and everything in it · double-click to rename' }, [h('span.bd-frame-dot'), h('span.bd-frame-name', { text: it.text || 'Frame' }), h('span.bd-frame-count')]));
      else if (it.kind === 'checklist') el.appendChild(checklist(it));
      else if (it.kind === 'image') el.appendChild(image(it));
      else if (it.kind === 'entry') el.appendChild(entryCard(it));
      if (!RO) {
        for (const p of ['n', 'e', 's', 'w']) el.appendChild(h('span.bd-port', { class: p, dataset: { port: p }, title: 'Drag to connect to another card' }));
        el.appendChild(h('span.bd-rs', { title: 'Drag to resize' + (it.kind === 'image' ? ' (Shift: free)' : '') }));
      }
      return el;
    }
    function checklist(it) {
      const list = (it.data && it.data.items) || [];
      const done = list.filter(x => x.done).length;
      return h('div.bd-chk', [
        h('div.bd-chk-head', [h('span.bd-chk-title', { text: it.text || 'Checklist', dataset: RO ? {} : { act: 'chk-title' }, title: RO ? '' : 'Double-click to rename' }), h('span.bd-chk-count', { text: done + ' / ' + list.length })]),
        h('div.bd-chk-bar', [h('i', { style: { width: (list.length ? done / list.length * 100 : 0) + '%' } })]),
        h('div.bd-chk-list', list.map((x, i) => h('div.bd-chk-item', { class: x.done ? 'done' : '' }, [
          h('button.bd-chk-box', { type: 'button', dataset: { act: 'chk-toggle', i: String(i) }, 'aria-pressed': String(!!x.done), disabled: RO, title: x.done ? 'Not done' : 'Done' }, [h('span', { text: '✓' })]),
          h('span.bd-chk-text', { text: x.text, dataset: { act: 'chk-text', i: String(i) }, title: RO ? '' : 'Double-click to edit' }),
          RO ? null : h('button.bd-chk-x', { type: 'button', dataset: { act: 'chk-del', i: String(i) }, title: 'Remove', text: '✕' }),
        ]))),
        RO ? null : h('input.bd-chk-add', { placeholder: '＋ Add an item', dataset: { act: 'chk-add' }, spellcheck: false }),
      ]);
    }
    function image(it) {
      const fit = (it.data && it.data.fit) || 'cover';
      if (!it.mediaId) return h('div.bd-img-empty', { dataset: RO ? {} : { act: 'img-pick' } }, [h('span.bd-img-ico', { text: '▣' }), h('span', { text: it.text || 'Drop a picture here' }), RO ? null : h('span.gk-tiny.gk-muted', { text: 'or click to choose from the Library' })]);
      const img = h('img.bd-img', { alt: it.text || '', draggable: false, style: { objectFit: fit } });
      WB.media(it.mediaId).then(m => { if (m && m.url) img.src = m.url; else img.replaceWith(h('div.bd-img-empty', [h('span.bd-img-ico', { text: '⚠' }), h('span', { text: 'The picture is missing from the Library' })])); });
      return h('div.bd-imgwrap', [img, it.text ? h('div.bd-cap', { text: it.text }) : null]);
    }
    function entryCard(it) {
      const e = it.entryId && S.ents.get(it.entryId);
      if (!e || e.deletedAt) {
        return h('div.bd-gone', [h('span.bd-gone-ico', { text: '⌫' }), h('b', { text: e ? '“' + e.title + '” is in the trash' : 'This entry was deleted' }),
          e && !RO ? h('button.bd-linkbtn', { type: 'button', dataset: { act: 'ent-restore' }, text: 'Restore it' }) : h('span.gk-tiny.gk-muted', { text: 'Delete the card or drop another entry on it.' })]);
      }
      const t = WB.typeOf(e);
      const chip = WB.ui.chip(e, { onClick: () => { } });
      chip.draggable = false; chip.classList.add('bd-chip'); chip.removeAttribute('tabindex');
      const meta = [t && t.name, WB.fmt.span(e)].filter(Boolean).join(' · ');
      return h('div.bd-ent', { class: e.coverId ? 'has-cover' : '' }, [
        e.coverId ? h('div.bd-cover', [WB.ui.thumb(e.coverId)]) : null,
        h('div.bd-ent-body', [chip, meta ? h('div.bd-ent-meta.gk-ellipsis', { text: meta }) : null, e.summary ? h('div.bd-ent-sum', { text: e.summary }) : null]),
        h('div.bd-ent-tools', [h('button.bd-tool', { type: 'button', dataset: { act: 'peek' }, title: 'Peek (double-click)', text: '◫' }), h('button.bd-tool', { type: 'button', dataset: { act: 'open' }, title: 'Open in the Codex', text: '↗' })]),
      ]);
    }

    /* ----- connectors ----- */
    function anchor(a, b) {
      const ax = a.x + a.w / 2, ay = a.y + a.h / 2, bx = b.x + b.w / 2, by = b.y + b.h / 2;
      const dx = bx - ax, dy = by - ay;
      if (!dx && !dy) return { x: ax, y: ay, nx: 0, ny: -1 };
      const tx = dx ? (a.w / 2 + 6) / Math.abs(dx) : Infinity, ty = dy ? (a.h / 2 + 6) / Math.abs(dy) : Infinity;
      const t = Math.min(tx, ty);
      return { x: ax + dx * t, y: ay + dy * t, nx: tx < ty ? Math.sign(dx) : 0, ny: tx < ty ? 0 : Math.sign(dy) };
    }
    function geom(a, b, style) {
      const p = anchor(a, b), q = anchor(b, a);
      if (!style.curve) return { d: 'M' + p.x + ' ' + p.y + ' L' + q.x + ' ' + q.y, p, q, mid: { x: (p.x + q.x) / 2, y: (p.y + q.y) / 2 }, end: { x: q.x - p.x, y: q.y - p.y }, start: { x: p.x - q.x, y: p.y - q.y } };
      const k = Math.max(40, Math.hypot(q.x - p.x, q.y - p.y) * .4);
      const c1 = { x: p.x + p.nx * k, y: p.y + p.ny * k }, c2 = { x: q.x + q.nx * k, y: q.y + q.ny * k };
      const mid = { x: .125 * p.x + .375 * c1.x + .375 * c2.x + .125 * q.x, y: .125 * p.y + .375 * c1.y + .375 * c2.y + .125 * q.y };
      return { d: 'M' + p.x + ' ' + p.y + ' C' + c1.x + ' ' + c1.y + ' ' + c2.x + ' ' + c2.y + ' ' + q.x + ' ' + q.y, p, q, mid, end: { x: q.x - c2.x, y: q.y - c2.y }, start: { x: p.x - c1.x, y: p.y - c1.y } };
    }
    const arrowAt = (pt, dir, s = 13) => {
      const l = Math.hypot(dir.x, dir.y) || 1, ux = dir.x / l, uy = dir.y / l;
      return 'M' + pt.x + ' ' + pt.y + ' L' + (pt.x - ux * s - uy * s * .55) + ' ' + (pt.y - uy * s + ux * s * .55) + ' L' + (pt.x - ux * s + uy * s * .55) + ' ' + (pt.y - uy * s - ux * s * .55) + ' Z';
    };
    function renderLinks() {
      GK.clear(svgLinks); GK.clear(labels);
      for (const l of S.links.values()) {
        const a = S.items.get(l.from), b = S.items.get(l.to);
        if (!a || !b || !visibleItem(a) || !visibleItem(b)) continue;
        const st = l.style || {}, g = geom(a, b, st), sel = S.link === l.id;
        const grp = B.svg('g', { class: 'bd-link' + (sel ? ' sel' : '') + (st.dash ? ' dashed' : ''), 'data-id': l.id });
        if (st.color) grp.style.setProperty('--lc', st.color);
        grp.appendChild(B.svg('path', { class: 'bd-hit', d: g.d, 'data-id': l.id }));
        grp.appendChild(B.svg('path', { class: 'bd-line', d: g.d }));
        const arrow = st.arrow || 'end';
        if (arrow === 'end' || arrow === 'both') grp.appendChild(B.svg('path', { class: 'bd-arrow', d: arrowAt(g.q, g.end) }));
        if (arrow === 'both') grp.appendChild(B.svg('path', { class: 'bd-arrow', d: arrowAt(g.p, g.start) }));
        svgLinks.appendChild(grp);
        if (l.label || sel) {
          const lb = h('div.bd-lbl', { class: (sel ? 'sel' : '') + (l.label ? '' : ' empty'), dataset: { id: l.id }, text: l.label || (RO ? '' : '＋ label'), title: RO ? '' : 'Double-click to edit the label' });
          lb.style.left = g.mid.x + 'px'; lb.style.top = g.mid.y + 'px';
          if (st.color) lb.style.setProperty('--lc', st.color);
          labels.appendChild(lb);
        }
      }
      if (S.drag && S.drag.guides) {
        const W = canvas.clientWidth, H = canvas.clientHeight, v = S.view;
        const x0 = -v.x / v.z, y0 = -v.y / v.z, x1 = (W - v.x) / v.z, y1 = (H - v.y) / v.z;
        if (S.drag.guides.x != null) svgLinks.appendChild(B.svg('line', { class: 'bd-guide', x1: S.drag.guides.x, x2: S.drag.guides.x, y1: y0, y2: y1 }));
        if (S.drag.guides.y != null) svgLinks.appendChild(B.svg('line', { class: 'bd-guide', y1: S.drag.guides.y, y2: S.drag.guides.y, x1: x0, x2: x1 }));
      }
      if (S.drag && S.drag.kind === 'connect' && S.drag.to) {
        const a = S.items.get(S.drag.from), tgt = S.drag.target && S.items.get(S.drag.target);
        const b = tgt || { x: S.drag.to.x - 1, y: S.drag.to.y - 1, w: 2, h: 2 };
        const g = geom(a, b, {});
        const grp = B.svg('g', { class: 'bd-link temp' });
        grp.appendChild(B.svg('path', { class: 'bd-line', d: g.d }));
        grp.appendChild(B.svg('path', { class: 'bd-arrow', d: arrowAt(g.q, g.end) }));
        svgLinks.appendChild(grp);
      }
    }

    /* ================= data ops (each keeps the local copy in step) ================= */
    const mine = () => { S.ownUntil = Date.now() + 1500; };
    async function ensureEnts(ids) {
      const need = [...new Set(ids.filter(id => id && !S.ents.has(id)))];
      if (need.length) (await WB.api('entries.many', need).catch(() => [])).forEach(e => S.ents.set(e.id, e));
    }
    async function apiAdd(list) { mine(); const got = await WB.api('boards.addItems', boardId, list); await ensureEnts(got.map(i => i.entryId)); got.forEach(put); render(); return got; }
    async function apiUpdate(list) { if (!list.length) return []; mine(); const got = await WB.api('boards.updateItems', list); await ensureEnts(got.map(i => i.entryId)); got.forEach(put); render(); return got; }
    async function apiRemove(ids) { mine(); const snap = await WB.api('boards.removeItems', ids); ids.forEach(id => { S.items.delete(id); S.sel.delete(id); }); snap.links.forEach(l => S.links.delete(l.id)); render(); return snap; }
    async function apiRestore(snap) { mine(); const r = await WB.api('boards.restore', snap); await ensureEnts(r.items.map(i => i.entryId)); r.items.forEach(put); r.links.forEach(putLink); render(); return r; }
    async function apiLink(l) { mine(); const got = await WB.api('boards.addLink', boardId, l); putLink(got); render(); return got; }
    async function apiLinkUpdate(id, p) { mine(); const got = await WB.api('boards.updateLink', id, p); putLink(got); render(); return got; }
    async function apiUnlink(ids) { mine(); const snap = await WB.api('boards.removeLinks', ids); ids.forEach(id => S.links.delete(id)); render(); return snap; }
    const pick = (it, keys) => Object.fromEntries(['id'].concat(keys).map(k => [k, it[k]]));

    /* ================= undo ================= */
    function push(label, undoFn, redoFn) { const op = { label, undo: undoFn, redo: redoFn }; S.undo.push(op); if (S.undo.length > 120) S.undo.shift(); S.redo = []; undoBtn.disabled = false; redoBtn.disabled = true; return op; }
    async function undo() { const op = S.undo.pop(); if (!op) { ui.toast('Nothing to undo', '↶'); return; } if (op.toast) op.toast.remove(); try { await op.undo(); S.redo.push(op); ui.toast('Undone: ' + op.label, '↶', 1600); } catch (e) { WB.fail(e); } render(); }
    async function redo() { const op = S.redo.pop(); if (!op) return; try { await op.redo(); S.undo.push(op); ui.toast('Redone: ' + op.label, '↷', 1600); } catch (e) { WB.fail(e); } render(); }
    /** change items with an undo step: patches = [{id, …}] */
    async function change(label, patches) {
      if (!patches.length) return;
      const keys = [...new Set(patches.flatMap(p => Object.keys(p)))].filter(k => k !== 'id');
      const before = patches.map(p => pick(S.items.get(p.id), keys));
      await apiUpdate(patches);
      push(label, () => apiUpdate(before), () => apiUpdate(patches));
    }
    async function addCards(label, list, { select = true, edit = false } = {}) {
      if (RO) return [];
      const got = await apiAdd(list);
      let snap = null;
      push(label, async () => { snap = await apiRemove(got.map(i => i.id)); }, async () => { if (snap) await apiRestore(snap); });
      if (select) setSel(got.map(i => i.id));
      if (edit && got[0]) setTimeout(() => editText(got[0].id), 30);
      return got;
    }
    async function remove(ids, { toast = true } = {}) {
      ids = ids.filter(id => S.items.has(id));
      if (!ids.length) return;
      const snap = await apiRemove(ids);
      const op = push(ids.length === 1 ? 'delete a card' : 'delete ' + ids.length + ' cards', () => apiRestore(snap), () => apiRemove(ids));
      if (toast) op.toast = WB.ui.undoToast(ids.length === 1 ? 'Card deleted' : ids.length + ' cards deleted', async () => { const i = S.undo.indexOf(op); if (i >= 0) S.undo.splice(i, 1); await apiRestore(snap); });
    }

    /* ================= selection ================= */
    function setSel(ids) { S.sel = new Set(ids); S.link = null; canvas.classList.toggle('multi', S.sel.size > 1); for (const [id, r] of els) r.el.classList.toggle('sel', S.sel.has(id)); renderLinks(); paintSelbar(); paintHint(); }
    function selectLink(id) { S.sel.clear(); S.link = id; for (const r of els.values()) r.el.classList.remove('sel'); renderLinks(); paintSelbar(); }
    const selItems = () => [...S.sel].map(id => S.items.get(id)).filter(Boolean);

    /* ================= creating cards ================= */
    function newCard(kind, at, extra = {}) {
      const [w, hh] = SIZE[kind];
      const p = at || center();
      const it = Object.assign({ kind, x: snap(p.x - w / 2), y: snap(p.y - hh / 2), w, h: hh, text: '', color: '' }, extra);
      if (kind === 'checklist' && !it.data) it.data = { items: [] };
      if (kind === 'frame' && !it.text) it.text = 'Frame';
      return it;
    }
    async function addAt(kind, at) {
      if (RO) return;
      if (kind === 'image') return addImage(at);
      if (kind === 'entry') return addEntries(at);
      const got = await addCards('add a ' + kind, [newCard(kind, at)], { edit: kind === 'note' || kind === 'text' });
      if (kind === 'checklist' && got[0]) setTimeout(() => { const i = els.get(got[0].id) && els.get(got[0].id).el.querySelector('.bd-chk-add'); if (i) i.focus(); }, 40);
      if (kind === 'frame' && got[0]) setTimeout(() => renameFrame(got[0].id), 40);
    }
    async function addEntries(at, ids) {
      if (!ids) {
        const picked = await WB.ui.pickEntry({ title: 'Put entries on “' + S.board.title + '”', multi: true, exclude: [boardId], allowCreate: true });
        if (!picked || !picked.length) return;
        ids = picked.map(e => e.id);
        picked.forEach(e => S.ents.set(e.id, Object.assign({}, S.ents.get(e.id) || {}, e)));
      }
      const onBoard = new Set([...S.items.values()].map(i => i.entryId).filter(Boolean));
      const already = ids.filter(id => onBoard.has(id));
      ids = ids.filter(id => !onBoard.has(id));
      if (already.length && !ids.length) { const it = [...S.items.values()].find(i => i.entryId === already[0]); setSel([it.id]); reveal([it.id]); ui.toast('Already on this board', 'ℹ'); return; }
      await ensureEnts(ids);
      const p = at || center();
      const cols = Math.ceil(Math.sqrt(ids.length));
      const list = ids.map((id, i) => { const e = S.ents.get(id), cover = e && e.coverId; return newCard('entry', { x: p.x + (i % cols) * 270, y: p.y + Math.floor(i / cols) * (cover ? 250 : 160) }, { entryId: id, h: cover ? 230 : 140 }); });
      await addCards(ids.length === 1 ? 'add an entry' : 'add ' + ids.length + ' entries', list);
      if (already.length) ui.toast(already.length === 1 ? 'One was already on the board' : already.length + ' were already on the board', 'ℹ');
    }
    async function addImage(at, mediaList) {
      if (!mediaList) { const m = await WB.ui.pickMedia({ kind: 'image', title: 'Put a picture on the board' }); if (!m) return; mediaList = [m]; }
      const p = at || center();
      const list = mediaList.map((m, i) => { const w = 280, hh = m.width && m.height ? Math.round(Math.max(60, Math.min(460, w * m.height / m.width))) : 200; return newCard('image', { x: p.x + (i % 3) * 300, y: p.y + Math.floor(i / 3) * 320 }, { mediaId: m.id, w, h: hh }); });
      await addCards(list.length === 1 ? 'add a picture' : 'add ' + list.length + ' pictures', list);
    }
    async function wrapInFrame() {
      const list = selItems();
      if (!list.length) return addAt('frame');
      const bb = B.bbox(list.map(rectOf));
      const f = newCard('frame', null, { x: snap(bb.x - 30), y: snap(bb.y - 60), w: snap(bb.w + 60), h: snap(bb.h + 90), text: 'Group', color: '#9aa5b1' });
      const got = await addCards('frame the selection', [f]);
      if (got[0]) setTimeout(() => renameFrame(got[0].id), 40);
    }

    /* ================= editing text ================= */
    function editText(id) {
      const it = S.items.get(id);
      if (RO || !it || (it.kind !== 'note' && it.kind !== 'text')) return;
      finishEdit();
      const rec = els.get(id); if (!rec) return;
      const host = rec.el.querySelector('.bd-rich'); if (!host) return;
      S.editing = id;
      setSel([id]);
      rec.el.classList.add('editing');
      const ed = WB.editor.create({ value: it.text, toolbar: false, placeholder: it.kind === 'text' ? 'Type here…' : 'Write a note… (@ links an entry)' });
      ed.el.classList.add('bd-edit');
      host.replaceWith(ed.el);
      ed.focus(true);
      const done = async () => {
        if (S.editing !== id) return;
        ed.destroy();
        const html = ed.get();
        S.editing = null;
        rec.el.classList.remove('editing');
        const it2 = S.items.get(id);
        if (!it2) return;
        // grow the card when the text no longer fits
        const need = ed.ed.scrollHeight + (it2.kind === 'note' ? 28 : 12);
        const patch = { id, text: html };
        if (need > it2.h) patch.h = snap(need + GRID / 2);
        if (html !== it2.text || patch.h) await change('edit text', [patch]); else { rec.key = ''; render(); }
        canvas.focus({ preventScroll: true });
      };
      S.finishEdit = done;
      ed.el.addEventListener('focusout', () => setTimeout(() => { if (!ed.el.contains(document.activeElement) && !document.querySelector('.wb-pop[data-group="mention"]')) done(); }, 160));
      ed.el.addEventListener('keydown', e => { if (e.key === 'Escape' || (e.key === 'Enter' && (e.ctrlKey || e.metaKey))) { e.preventDefault(); e.stopPropagation(); done(); } });
    }
    function finishEdit() { if (S.editing && S.finishEdit) S.finishEdit(); }
    function inlineInput(el, value, onDone, { placeholder = '' } = {}) {
      const inp = h('input.bd-inline', { value, placeholder, spellcheck: false });
      el.replaceWith(inp);
      inp.focus(); inp.select();
      let over = false;
      const end = ok => { if (over) return; over = true; inp.replaceWith(el); if (ok) onDone(inp.value.trim()); };
      inp.addEventListener('keydown', e => { e.stopPropagation(); if (e.key === 'Enter') { e.preventDefault(); end(true); } else if (e.key === 'Escape') { e.preventDefault(); end(false); } });
      inp.addEventListener('blur', () => end(true));
      inp.addEventListener('pointerdown', e => e.stopPropagation());
      return inp;
    }
    function renameFrame(id) {
      const rec = els.get(id), it = S.items.get(id);
      if (!rec || !it || RO) return;
      const name = rec.el.querySelector('.bd-frame-name');
      if (name) inlineInput(name, it.text || 'Frame', v => { if (v && v !== it.text) change('rename a frame', [{ id, text: v }]); });
    }
    async function editChecklist(it, act, i, el) {
      const items = ((it.data && it.data.items) || []).map(x => Object.assign({}, x));
      const save = (label, list, extra) => change(label, [Object.assign({ id: it.id, data: Object.assign({}, it.data, { items: list }) }, extra || {})]);
      if (act === 'chk-toggle') { items[i].done = !items[i].done; await save(items[i].done ? 'tick an item' : 'untick an item', items); }
      else if (act === 'chk-del') { items.splice(i, 1); await save('remove an item', items); }
      else if (act === 'chk-text') inlineInput(el, items[i].text, v => { if (!v) { items.splice(i, 1); save('remove an item', items); } else if (v !== items[i].text) { items[i].text = v; save('edit an item', items); } });
      else if (act === 'chk-title') inlineInput(el, it.text || 'Checklist', v => { if (v && v !== it.text) change('rename a checklist', [{ id: it.id, text: v }]); });
    }
    async function addChecklistItem(it, text) {
      const items = ((it.data && it.data.items) || []).concat([{ text, done: false }]);
      const rec = els.get(it.id);
      const need = rec ? rec.el.querySelector('.bd-chk').scrollHeight + 34 : it.h;
      await change('add an item', [{ id: it.id, data: Object.assign({}, it.data, { items }), h: Math.max(it.h, snap(need)) }]);
      const inp = els.get(it.id) && els.get(it.id).el.querySelector('.bd-chk-add');
      if (inp) inp.focus();
    }

    /* ================= pointer ================= */
    function capture(e, move, up) {
      const target = canvas;
      try { target.setPointerCapture(e.pointerId); } catch { }
      const mv = ev => { S.pointer = { x: ev.clientX, y: ev.clientY }; move(ev); };
      const fin = ev => { target.removeEventListener('pointermove', mv); target.removeEventListener('pointerup', fin); target.removeEventListener('pointercancel', fin); try { target.releasePointerCapture(e.pointerId); } catch { } up(ev); };
      target.addEventListener('pointermove', mv); target.addEventListener('pointerup', fin); target.addEventListener('pointercancel', fin);
    }
    canvas.addEventListener('pointermove', e => { S.pointer = { x: e.clientX, y: e.clientY }; });
    canvas.addEventListener('pointerdown', e => {
      if (e.button === 2) return;
      const t = e.target;
      if (t.closest('.bd-selbar, .bd-mini, .bd-emptyhint .gk-btn, .bd-inline, .bd-edit')) return;
      if (S.editing && !t.closest('.bd-item.editing')) finishEdit();
      if (!t.closest('input, textarea, [contenteditable="true"]')) canvas.focus({ preventScroll: true });
      if (e.button === 1 || S.space) { e.preventDefault(); return startPan(e); }
      if (e.button !== 0) return;
      const itemEl = t.closest('.bd-item');
      if (RO) { if (itemEl) setSel([itemEl.dataset.id]); else if (t.closest('.bd-hit, .bd-lbl')) selectLink((t.closest('.bd-hit, .bd-lbl')).dataset.id); else { startPan(e); } return; }
      const port = t.closest('.bd-port');
      if (port && itemEl) return startConnect(e, itemEl.dataset.id);
      if (t.closest('.bd-rs') && itemEl) return startResize(e, itemEl.dataset.id);
      const lk = t.closest('.bd-hit, .bd-lbl');
      if (lk) { e.preventDefault(); selectLink(lk.dataset.id); return; }
      if (itemEl) {
        if (t.closest('input, textarea, select, [contenteditable="true"], .mk-player, button[data-act], [data-act="chk-add"]')) return;
        return startMove(e, itemEl.dataset.id);
      }
      if (S.tool === 'select' || e.shiftKey) return startLasso(e);
      return startPan(e);
    });
    function startPan(e) {
      const sx = e.clientX, sy = e.clientY, ox = S.view.x, oy = S.view.y;
      let moved = false;
      canvas.classList.add('panning');
      capture(e, ev => {
        const dx = GK.local(canvas, ev.clientX - sx), dy = GK.local(canvas, ev.clientY - sy);
        if (!moved && Math.hypot(dx, dy) < 3) return;
        moved = true;
        S.view.x = ox + dx; S.view.y = oy + dy; applyView();
      }, () => {
        canvas.classList.remove('panning');
        if (!moved && !e.shiftKey) { if (S.sel.size || S.link) setSel([]); }
      });
    }
    function startMove(e, id) {
      const it = S.items.get(id);
      if (!it) return;
      const additive = e.shiftKey || e.ctrlKey || e.metaKey, was = S.sel.has(id);
      if (!additive && !was) setSel([id]);
      const sx = e.clientX, sy = e.clientY;
      let moving = null, orig = null, moved = false, lines = null;
      const z = S.view.z;
      S.drag = { kind: 'move' };
      capture(e, ev => {
        const dx = GK.local(canvas, ev.clientX - sx) / z, dy = GK.local(canvas, ev.clientY - sy) / z;
        if (!moved) {
          if (Math.hypot(dx * z, dy * z) < 4) return;
          moved = true;
          if (additive && !was) { S.sel.add(id); setSel([...S.sel]); }
          // frames carry what sits inside them
          const ids = new Set(S.sel);
          for (const f of selItems().filter(x => x.kind === 'frame')) for (const o of shown()) if (o.id !== f.id && inside(o, f)) ids.add(o.id);
          moving = [...ids].map(x => S.items.get(x)).filter(Boolean);
          orig = new Map(moving.map(x => [x.id, { x: x.x, y: x.y }]));
          // edges and centres of everything else, for alignment guides
          lines = { xs: [], ys: [] };
          for (const o of shown()) if (!ids.has(o.id) && o.kind !== 'frame') { lines.xs.push(o.x, o.x + o.w / 2, o.x + o.w); lines.ys.push(o.y, o.y + o.h / 2, o.y + o.h); }
          canvas.classList.add('moving');
          selbar.hidden = true;
        }
        const o = orig.get(id);
        let ddx = snap(o.x + dx) - o.x, ddy = snap(o.y + dy) - o.y;
        S.drag.guides = null;
        if (!ev.altKey && it.kind !== 'frame') {
          const thr = 7 / z;
          const near = (vals, pos, size) => { let best = null; for (const off of [0, size / 2, size]) for (const v of vals) { const d = v - (pos + off); if (Math.abs(d) <= thr && (!best || Math.abs(d) < Math.abs(best.d))) best = { d, v }; } return best; };
          const gx = near(lines.xs, o.x + ddx, it.w), gy = near(lines.ys, o.y + ddy, it.h);
          if (gx) ddx += gx.d;
          if (gy) ddy += gy.d;
          if (gx || gy) S.drag.guides = { x: gx && gx.v, y: gy && gy.v };
        }
        for (const m of moving) { const p = orig.get(m.id); m.x = p.x + ddx; m.y = p.y + ddy; }
        place(moving.map(m => m.id));
        autoScroll(ev);
      }, () => {
        S.drag = null; stopAutoScroll();
        canvas.classList.remove('moving');
        if (moved) renderLinks();
        if (!moved) {
          if (additive) { if (was) S.sel.delete(id); else S.sel.add(id); setSel([...S.sel]); }
          else if (was && S.sel.size > 1) setSel([id]);
          paintSelbar();
          return;
        }
        S.suppress = true; setTimeout(() => { S.suppress = false; }, 0);
        const patches = moving.filter(m => { const p = orig.get(m.id); return p.x !== m.x || p.y !== m.y; }).map(m => ({ id: m.id, x: m.x, y: m.y }));
        const before = patches.map(p => ({ id: p.id, x: orig.get(p.id).x, y: orig.get(p.id).y }));
        if (!patches.length) { paintSelbar(); return; }
        apiUpdate(patches).catch(WB.fail);
        push(patches.length === 1 ? 'move a card' : 'move ' + patches.length + ' cards', () => apiUpdate(before), () => apiUpdate(patches));
        frameCounts(); paintSelbar(); paintMini();
      });
    }
    function startResize(e, id) {
      const it = S.items.get(id);
      if (!it) return;
      e.preventDefault();
      setSel([id]);
      const sx = e.clientX, sy = e.clientY, ow = it.w, oh = it.h, z = S.view.z, ratio = it.h / it.w;
      const min = { note: [100, 60], text: [60, 30], entry: [150, 70], image: [60, 40], checklist: [150, 90], frame: [160, 100] }[it.kind] || [60, 40];
      let moved = false;
      S.drag = { kind: 'resize' };
      capture(e, ev => {
        const dx = GK.local(canvas, ev.clientX - sx) / z, dy = GK.local(canvas, ev.clientY - sy) / z;
        moved = true;
        it.w = Math.max(min[0], snap(it.x + ow + dx) - it.x);
        it.h = it.kind === 'image' && it.mediaId && !ev.shiftKey ? Math.max(min[1], Math.round(it.w * ratio)) : Math.max(min[1], snap(it.y + oh + dy) - it.y);
        place([id]);
        selbar.hidden = true;
      }, () => {
        S.drag = null;
        if (!moved || (it.w === ow && it.h === oh)) { paintSelbar(); return; }
        const after = { id, w: it.w, h: it.h }, before = { id, w: ow, h: oh };
        apiUpdate([after]).catch(WB.fail);
        push('resize a card', () => apiUpdate([before]), () => apiUpdate([after]));
        paintSelbar();
      });
    }
    function startLasso(e) {
      const p0 = local(e.clientX, e.clientY), w0 = toWorld(e.clientX, e.clientY);
      const base = e.shiftKey ? new Set(S.sel) : new Set();
      let moved = false;
      S.drag = { kind: 'lasso' };
      capture(e, ev => {
        const p = local(ev.clientX, ev.clientY), w = toWorld(ev.clientX, ev.clientY);
        if (!moved && Math.hypot(p.x - p0.x, p.y - p0.y) < 4) return;
        moved = true;
        lasso.hidden = false;
        const l = Math.min(p.x, p0.x), tp = Math.min(p.y, p0.y);
        lasso.style.left = l + 'px'; lasso.style.top = tp + 'px';
        lasso.style.width = Math.abs(p.x - p0.x) + 'px'; lasso.style.height = Math.abs(p.y - p0.y) + 'px';
        const r = { x: Math.min(w.x, w0.x), y: Math.min(w.y, w0.y), w: Math.abs(w.x - w0.x), h: Math.abs(w.y - w0.y) };
        const hit = shown().filter(it => (it.kind === 'frame'
          ? it.x >= r.x && it.y >= r.y && it.x + it.w <= r.x + r.w && it.y + it.h <= r.y + r.h
          : it.x < r.x + r.w && it.x + it.w > r.x && it.y < r.y + r.h && it.y + it.h > r.y)).map(it => it.id);
        S.sel = new Set([...base, ...hit]);
        for (const [id, rec] of els) rec.el.classList.toggle('sel', S.sel.has(id));
      }, () => {
        S.drag = null;
        lasso.hidden = true;
        if (!moved) { if (!e.shiftKey) setSel([]); return; }
        setSel([...S.sel]);
      });
    }
    function startConnect(e, from) {
      e.preventDefault(); e.stopPropagation();
      S.drag = { kind: 'connect', from, to: null, target: null };
      let moved = false;
      const sx = e.clientX, sy = e.clientY;
      capture(e, ev => {
        if (!moved && Math.hypot(ev.clientX - sx, ev.clientY - sy) < 4) return;
        moved = true;
        S.drag.to = toWorld(ev.clientX, ev.clientY);
        const under = document.elementFromPoint(ev.clientX, ev.clientY);
        const tEl = under && under.closest && under.closest('.bd-item');
        const tid = tEl && tEl.dataset.id !== from ? tEl.dataset.id : null;
        if (tid !== S.drag.target) { for (const r of els.values()) r.el.classList.remove('target'); if (tid && els.get(tid)) els.get(tid).el.classList.add('target'); S.drag.target = tid; }
        canvas.classList.add('connecting');
        renderLinks();
        autoScroll(ev);
      }, async () => {
        const d = S.drag; S.drag = null; stopAutoScroll();
        canvas.classList.remove('connecting');
        for (const r of els.values()) r.el.classList.remove('target');
        renderLinks();
        if (!moved) return;
        try {
          if (d.target) {
            const l = await apiLink({ from: d.from, to: d.target });
            let snap2 = null;
            push('connect two cards', async () => { snap2 = await apiUnlink([l.id]); }, async () => { if (snap2) await apiRestore(snap2); });
            selectLink(l.id);
          } else if (d.to) {
            // released on empty space: a new note there, already connected (mind-map style)
            const src = S.items.get(d.from);
            const n = newCard('note', d.to, { color: src && src.kind === 'note' ? src.color : '' });
            const got = await apiAdd([n]);
            await apiLink({ from: d.from, to: got[0].id });
            let snap3 = null;
            push('add a connected note', async () => { snap3 = await apiRemove([got[0].id]); }, async () => { if (snap3) { await apiRestore(snap3); } });
            setSel([got[0].id]);
            setTimeout(() => editText(got[0].id), 30);
          }
        } catch (err) { WB.fail(err); }
      });
    }
    /* near the edge while dragging: the board scrolls along */
    let scrollT = 0;
    function autoScroll(ev) {
      const r = canvas.getBoundingClientRect(), m = 36;
      const vx = ev.clientX < r.left + m ? 1 : ev.clientX > r.right - m ? -1 : 0, vy = ev.clientY < r.top + m ? 1 : ev.clientY > r.bottom - m ? -1 : 0;
      cancelAnimationFrame(scrollT);
      if (!vx && !vy) return;
      const step = () => { if (!S.drag) return; S.view.x += vx * 9; S.view.y += vy * 9; applyView(); scrollT = requestAnimationFrame(step); };
      scrollT = requestAnimationFrame(step);
    }
    const stopAutoScroll = () => cancelAnimationFrame(scrollT);

    canvas.addEventListener('click', e => {
      if (S.suppress) { e.stopPropagation(); e.preventDefault(); S.suppress = false; return; }
      const a = e.target.closest('[data-act]'), itemEl = e.target.closest('.bd-item');
      const m = e.target.closest('a.wb-m');
      if (m && !m.classList.contains('gone') && !e.target.closest('.bd-edit')) { e.preventDefault(); if (e.ctrlKey || e.metaKey) WB.open(m.dataset.id); else WB.peek(m.dataset.id); return; }
      if (!a || !itemEl) return;
      const it = S.items.get(itemEl.dataset.id);
      if (!it) return;
      const act = a.dataset.act, i = +a.dataset.i;
      if (act === 'peek') { e.stopPropagation(); WB.peek(it.entryId); }
      else if (act === 'open') { e.stopPropagation(); WB.open(it.entryId); }
      else if (act === 'ent-restore') { e.stopPropagation(); WB.api('entries.restore', it.entryId).then(r => { S.ents.set(r.id, r); render(); }).catch(WB.fail); }
      else if (RO) return;
      else if (act === 'chk-toggle' || act === 'chk-del') { e.stopPropagation(); editChecklist(it, act, i, a); }
      else if (act === 'img-pick') { e.stopPropagation(); pickImageFor(it); }
    }, true);
    canvas.addEventListener('dblclick', e => {
      if (e.target.closest('.bd-selbar, .bd-mini, .bd-inline, .bd-edit, .bd-emptyhint')) return;
      const itemEl = e.target.closest('.bd-item'), it = itemEl && S.items.get(itemEl.dataset.id);
      const lbl = e.target.closest('.bd-lbl, .bd-hit');
      if (lbl && !RO) { e.preventDefault(); editLinkLabel(lbl.dataset.id); return; }
      if (!it) { if (!RO && !e.target.closest('.bd-item')) addCards('add a note', [newCard('note', toWorld(e.clientX, e.clientY))], { edit: true }); return; }
      e.preventDefault();
      const a = e.target.closest('[data-act]');
      if (it.kind === 'entry') { if (it.entryId && S.ents.get(it.entryId) && !S.ents.get(it.entryId).deletedAt) WB.peek(it.entryId); return; }
      if (it.kind === 'image') { if (it.mediaId) openImage(it); else if (!RO) pickImageFor(it); return; }
      if (RO) return;
      if (it.kind === 'note' || it.kind === 'text') editText(it.id);
      else if (it.kind === 'frame') renameFrame(it.id);
      else if (it.kind === 'checklist' && a && (a.dataset.act === 'chk-text' || a.dataset.act === 'chk-title')) editChecklist(it, a.dataset.act, +a.dataset.i, a);
    });
    canvas.addEventListener('keydown', e => {
      const add = e.target.closest && e.target.closest('.bd-chk-add');
      if (!add) return;
      e.stopPropagation();
      if (e.key === 'Enter' && add.value.trim()) { const it = S.items.get(add.closest('.bd-item').dataset.id); const v = add.value.trim(); add.value = ''; if (it) addChecklistItem(it, v); }
      else if (e.key === 'Escape') { add.value = ''; add.blur(); canvas.focus(); }
    });
    canvas.addEventListener('contextmenu', e => {
      e.preventDefault();
      if (e.target.closest('.bd-selbar, .bd-mini, input, [contenteditable="true"]')) return;
      const lk = e.target.closest('.bd-hit, .bd-lbl');
      if (lk) { selectLink(lk.dataset.id); return linkMenu(lk.dataset.id, e); }
      const itemEl = e.target.closest('.bd-item');
      if (itemEl) { if (!S.sel.has(itemEl.dataset.id)) setSel([itemEl.dataset.id]); return itemMenu(e); }
      canvasMenu(e);
    });
    canvas.addEventListener('wheel', e => {
      if (e.target.closest('.bd-mini, .bd-selbar, .wb-pop')) return;
      e.preventDefault();
      const p = local(e.clientX, e.clientY);
      const mode = store.get().wheel || 'zoom';
      const trackpad = Math.abs(e.deltaX) > 0 && !e.shiftKey;
      if (e.ctrlKey || (mode === 'zoom' && !trackpad && !e.shiftKey)) zoomAt(S.view.z * Math.exp(-e.deltaY * (e.ctrlKey ? .012 : .0016)), p);
      else { S.view.x -= e.shiftKey && !e.deltaX ? e.deltaY : e.deltaX; S.view.y -= e.shiftKey ? 0 : e.deltaY; applyView(); }
    }, { passive: false });

    /* ----- drops: entries, Library pictures, files from the computer, cards from the side panel ----- */
    WB.dnd.accept(canvas, (id, ev) => { if (!RO) addEntries(toWorld(ev.clientX, ev.clientY), [id]); });
    WB.dropFiles(canvas, async files => {
      if (RO) return;
      const at = S.lastDrop || center();
      const saved = await WB.saveFiles(files);
      const pics = saved.filter(m => m.kind === 'image');
      const target = S.dropOn && S.items.get(S.dropOn);
      if (target && target.kind === 'image' && pics[0]) { await change('set a picture', [{ id: target.id, mediaId: pics[0].id }]); return; }
      if (pics.length) await addImage(at, pics);
      if (saved.length > pics.length) ui.toast((saved.length - pics.length) + ' other file' + (saved.length - pics.length === 1 ? '' : 's') + ' went to the Library', '▣');
    });
    canvas.addEventListener('dragover', e => {
      const types = [...e.dataTransfer.types];
      S.lastDrop = toWorld(e.clientX, e.clientY);
      const under = e.target.closest && e.target.closest('.bd-item.k-image');
      S.dropOn = under ? under.dataset.id : null;
      if (!RO && (types.includes(MEDIA_MIME) || types.includes(KIND_MIME))) { e.preventDefault(); canvas.classList.add('wb-drop'); }
    });
    canvas.addEventListener('dragleave', e => { if (e.target === canvas) canvas.classList.remove('wb-drop'); });
    canvas.addEventListener('drop', async e => {
      canvas.classList.remove('wb-drop');
      if (RO) return;
      const at = toWorld(e.clientX, e.clientY);
      const kind = e.dataTransfer.getData(KIND_MIME), media = e.dataTransfer.getData(MEDIA_MIME);
      if (kind) { e.preventDefault(); addAt(kind, at); return; }
      if (media) {
        e.preventDefault();
        const ids = JSON.parse(media || '[]');
        const list = (await Promise.all(ids.map(id => WB.media(id)))).filter(m => m && m.kind === 'image');
        const target = S.dropOn && S.items.get(S.dropOn);
        if (target && target.kind === 'image' && list[0] && list.length === 1) await change('set a picture', [{ id: target.id, mediaId: list[0].id }]);
        else if (list.length) await addImage(at, list);
        else ui.toast('Only pictures can go on a board', 'ℹ');
      }
    });

    /* ================= selection toolbar ================= */
    function paintSelbar() {
      GK.clear(selbar);
      if (S.drag || S.editing) { selbar.hidden = true; return; }
      if (S.link && S.links.has(S.link)) { selbar.hidden = false; linkBar(S.links.get(S.link)); placeSelbar(); return; }
      const list = selItems();
      if (!list.length) { selbar.hidden = true; return; }
      selbar.hidden = false;
      const one = list.length === 1 ? list[0] : null;
      const T = (icon, title, fn, cls) => { const b = h('button.bd-sb', { type: 'button', title, 'aria-label': title, class: cls || '', onclick: ev => { ev.stopPropagation(); fn(ev); } }, [icon]); return b; };
      const kids = [];
      if (RO) {
        if (one && one.kind === 'entry' && one.entryId) kids.push(T('◫', 'Peek', () => WB.peek(one.entryId)), T('↗', 'Open', () => WB.open(one.entryId)));
        else { selbar.hidden = true; return; }
      } else {
        if (list.some(x => x.kind !== 'image')) kids.push(colorDots(list));
        kids.push(h('span.bd-sb-sep'));
        if (one && (one.kind === 'note' || one.kind === 'text')) kids.push(T('✎', 'Edit text (Enter)', () => editText(one.id)));
        if (one && one.kind === 'note') kids.push(T('⇄', 'Turn into an entry…', ev => convertMenu(one, ev.currentTarget)));
        if (one && one.kind === 'entry' && one.entryId) kids.push(T('◫', 'Peek (double-click)', () => WB.peek(one.entryId)), T('↗', 'Open in the Codex', () => WB.open(one.entryId)), T('✺', 'Add what it is linked to, around it', () => addRelated(one)), T('⇆', 'Show another entry here…', () => swapEntry(one)));
        if (one && one.kind === 'image') kids.push(T('▣', 'Choose another picture…', () => pickImageFor(one)), one.mediaId ? T(one.data && one.data.fit === 'contain' ? '⤡' : '⤢', one.data && one.data.fit === 'contain' ? 'Fill the card' : 'Show the whole picture', () => change('change the fit', [{ id: one.id, data: Object.assign({}, one.data, { fit: one.data && one.data.fit === 'contain' ? 'cover' : 'contain' }) }])) : null, T('❝', 'Caption…', () => caption(one)));
        if (one && one.kind === 'frame') kids.push(T('✎', 'Rename', () => renameFrame(one.id)), T('⬚', 'Select what is inside', () => setSel(shown().filter(o => o.id !== one.id && inside(o, one)).map(o => o.id))));
        if (list.length > 1) kids.push(T('▭', 'Put a frame around them (Ctrl+G)', () => wrapInFrame()));
        kids.push(T('⧉', 'Duplicate (Ctrl+D)', () => duplicate()), T('⇅', 'Arrange…', ev => arrangeMenu(ev.currentTarget)), T('🗑', 'Delete (Del)', () => remove([...S.sel]), 'danger'));
        kids.push(h('span.bd-sb-n.gk-tiny.gk-muted', { text: list.length > 1 ? list.length + ' cards' : '' }));
      }
      GK.append(selbar, kids.filter(Boolean));
      placeSelbar();
    }
    function colorDots(list) {
      const cur = list.length === 1 ? list[0].color : null;
      return h('div.bd-dots', [h('button.bd-dot.none', { type: 'button', title: 'Default colour', class: cur === '' ? 'on' : '', onclick: ev => { ev.stopPropagation(); recolor(list, ''); } }),
        ...B.COLORS.map(([c, n]) => h('button.bd-dot', { type: 'button', title: n, class: cur === c ? 'on' : '', style: { '--c': c }, onclick: ev => { ev.stopPropagation(); recolor(list, c); } }))]);
    }
    const recolor = (list, c) => change('recolour', list.filter(x => x.kind !== 'image').map(x => ({ id: x.id, color: c })));
    function linkBar(l) {
      const st = l.style || {};
      const T = (icon, title, fn, on) => h('button.bd-sb', { type: 'button', title, 'aria-label': title, class: on ? 'on' : '', 'aria-pressed': on ? 'true' : null, onclick: ev => { ev.stopPropagation(); fn(ev); } }, [icon]);
      if (RO) { selbar.hidden = true; return; }
      const set = (label, p) => linkChange(label, l.id, { style: p });
      GK.append(selbar, [
        T('✎', 'Label (double-click the line)', () => editLinkLabel(l.id)),
        h('span.bd-sb-sep'),
        T('→', 'Arrow at the end', () => set('change the arrow', { arrow: 'end' }), (st.arrow || 'end') === 'end'),
        T('↔', 'Arrows both ways', () => set('change the arrow', { arrow: 'both' }), st.arrow === 'both'),
        T('—', 'No arrow', () => set('change the arrow', { arrow: 'none' }), st.arrow === 'none'),
        h('span.bd-sb-sep'),
        T('┄', 'Dashed line', () => set('change the line', { dash: st.dash ? '' : 'dashed' }), !!st.dash),
        T('⌒', 'Curved line', () => set('change the line', { curve: !st.curve }), !!st.curve),
        T('⇄', 'Reverse direction', () => linkChange('reverse a connector', l.id, { reverse: true }, { reverse: true })),
        h('span.bd-sb-sep'),
        h('div.bd-dots', [h('button.bd-dot.none', { type: 'button', title: 'Default colour', class: !st.color ? 'on' : '', onclick: ev => { ev.stopPropagation(); set('recolour a connector', { color: '' }); } }),
          ...B.COLORS.map(([c, n]) => h('button.bd-dot', { type: 'button', title: n, class: st.color === c ? 'on' : '', style: { '--c': c }, onclick: ev => { ev.stopPropagation(); set('recolour a connector', { color: c }); } }))]),
        h('span.bd-sb-sep'),
        T('🗑', 'Delete the connector (Del)', () => unlink([l.id])),
      ]);
    }
    async function linkChange(label, id, patch, inverse) {
      const l = S.links.get(id);
      const before = inverse || { style: Object.assign({}, l.style), label: l.label };
      await apiLinkUpdate(id, patch);
      push(label, () => apiLinkUpdate(id, inverse || { style: before.style, label: before.label }), () => apiLinkUpdate(id, patch));
      paintSelbar();
    }
    async function unlink(ids) {
      const snap = await apiUnlink(ids);
      push('delete a connector', () => apiRestore(snap), () => apiUnlink(ids));
      S.link = null; paintSelbar();
    }
    function editLinkLabel(id) {
      const l = S.links.get(id);
      if (!l || RO) return;
      selectLink(id);
      const lb = labels.querySelector('.bd-lbl[data-id="' + id + '"]');
      if (!lb) return;
      const inp = inlineInput(lb, l.label, v => { if (v !== l.label) linkChange('label a connector', id, { label: v }, { label: l.label }); }, { placeholder: 'Label' });
      inp.classList.add('bd-lbl-input');
      inp.style.left = lb.style.left; inp.style.top = lb.style.top;
    }
    function placeSelbar() {
      if (selbar.hidden) return;
      let bb = null;
      if (S.link && S.links.has(S.link)) { const l = S.links.get(S.link), a = S.items.get(l.from), b = S.items.get(l.to); if (a && b) { const g = geom(a, b, l.style || {}); bb = { x: g.mid.x - 1, y: g.mid.y - 30, w: 2, h: 2 }; } }
      else bb = B.bbox(selItems().map(rectOf));
      if (!bb) return;
      const W = canvas.clientWidth, H = canvas.clientHeight, bw = selbar.offsetWidth, bh = selbar.offsetHeight;
      let x = (bb.x + bb.w / 2) * S.view.z + S.view.x - bw / 2, y = bb.y * S.view.z + S.view.y - bh - 12;
      if (y < 8) y = (bb.y + bb.h) * S.view.z + S.view.y + 12;
      x = Math.max(8, Math.min(W - bw - 8, x)); y = Math.max(8, Math.min(H - bh - 8, y));
      selbar.style.left = x + 'px'; selbar.style.top = y + 'px';
    }

    /* ================= menus ================= */
    function itemMenu(e) {
      const list = selItems(), one = list.length === 1 ? list[0] : null;
      const lite = one && one.kind === 'entry' && one.entryId ? S.ents.get(one.entryId) : null;
      if (RO) { if (lite) WB.ui.entryMenu(lite, e); return; }
      WB.ui.menu([
        lite ? { label: 'Peek', icon: '◫', onClick: () => WB.peek(lite.id) } : null,
        lite ? { label: 'Open in the Codex', icon: '↗', onClick: () => WB.open(lite.id) } : null,
        lite ? { label: 'Add related entries around it', icon: '✺', onClick: () => addRelated(one) } : null,
        lite ? { label: 'Entry', icon: '◇', sub: [{ label: 'Show another entry here…', icon: '⇆', onClick: () => swapEntry(one) }, { label: 'More entry actions…', icon: '⋯', onClick: () => WB.ui.entryMenu(lite, e) }] } : null,
        one && (one.kind === 'note' || one.kind === 'text') ? { label: 'Edit text', icon: '✎', kbd: 'Enter', onClick: () => editText(one.id) } : null,
        one && one.kind === 'note' ? { label: 'Turn into an entry', icon: '⇄', sub: convertItems(one) } : null,
        one && one.kind === 'frame' ? { label: 'Rename', icon: '✎', onClick: () => renameFrame(one.id) } : null,
        one && one.kind === 'image' ? { label: one.mediaId ? 'Choose another picture…' : 'Choose a picture…', icon: '▣', onClick: () => pickImageFor(one) } : null,
        one && one.kind === 'image' && one.mediaId ? { label: 'View large', icon: '⤢', onClick: () => openImage(one) } : null,
        one && one.kind === 'image' && one.mediaId ? { label: 'Show in the Library', icon: '▣', onClick: () => WB.go('library', { mediaId: one.mediaId }) } : null,
        list.some(x => x.kind !== 'image') ? { label: 'Colour', icon: '◍', sub: [{ label: 'Default', onClick: () => recolor(list, '') }].concat(B.COLORS.map(([c, n]) => ({ label: n, icon: '●', checked: one && one.color === c, onClick: () => recolor(list, c) }))) } : null,
        { label: 'Arrange', icon: '⇅', sub: arrangeItems() },
        '-',
        { label: 'Duplicate', icon: '⧉', kbd: 'Ctrl+D', onClick: () => duplicate() },
        { label: 'Copy', icon: '⎘', kbd: 'Ctrl+C', onClick: () => copy() },
        list.length > 1 ? { label: 'Put a frame around them', icon: '▭', kbd: 'Ctrl+G', onClick: () => wrapInFrame() } : null,
        '-',
        { label: list.length > 1 ? 'Delete ' + list.length + ' cards' : 'Delete', icon: '🗑', kbd: 'Del', danger: true, onClick: () => remove([...S.sel]) },
      ].filter(Boolean), e);
    }
    function linkMenu(id, e) {
      if (RO) return;
      const l = S.links.get(id);
      WB.ui.menu([
        { label: l.label ? 'Edit label' : 'Add a label', icon: '✎', onClick: () => editLinkLabel(id) },
        { label: 'Reverse direction', icon: '⇄', onClick: () => linkChange('reverse a connector', id, { reverse: true }, { reverse: true }) },
        '-', { label: 'Delete connector', icon: '🗑', kbd: 'Del', danger: true, onClick: () => unlink([id]) },
      ], e);
    }
    function canvasMenu(e) {
      const at = toWorld(e.clientX, e.clientY);
      if (RO) { WB.ui.menu([{ label: 'Fit everything', icon: '⤢', kbd: '1', onClick: () => fit() }, { label: 'Zoom to 100%', icon: '⊙', kbd: '0', onClick: () => zoomAt(1) }], e); return; }
      WB.ui.menu([{ header: 'Add here' }].concat(ADD.map(([k, icon, label]) => ({ label: label + (k === 'entry' ? 's…' : k === 'image' ? '…' : ''), icon, onClick: () => addAt(k, at) })), [
        B.clip ? { label: 'Paste', icon: '⎘', kbd: 'Ctrl+V', onClick: () => paste(at) } : null,
        '-',
        { label: 'Draw relations between entries', icon: '⟷', onClick: () => drawRelations() },
        { label: 'Select all', icon: '⬚', kbd: 'Ctrl+A', onClick: () => setSel(shown().map(i => i.id)) },
        { label: 'Fit everything', icon: '⤢', kbd: '1', onClick: () => fit() },
        { label: 'Snap to grid', icon: '#', kbd: 'G', checked: S.snap, onClick: () => setSnap(!S.snap) },
      ]).filter(Boolean), e);
    }
    function boardMenu(at) {
      WB.ui.menu([
        RO ? null : { label: 'Rename', icon: '✎', onClick: () => { titleIn.focus(); titleIn.select(); } },
        { label: 'Open the board entry', icon: '↗', onClick: () => WB.open(boardId) },
        RO ? null : { label: 'Duplicate the board', icon: '⧉', onClick: async () => { const c = await WB.api('boards.duplicate', boardId); ui.toast('Copied to “' + c.board.title + '”', '⧉'); opts.open(c.board.id); } },
        RO ? null : { label: 'Add entries…', icon: '◇', kbd: 'E', onClick: () => addEntries() },
        RO ? null : { label: 'Draw relations between entries', icon: '⟷', hint: 'Connectors for every relation between entries on this board', onClick: () => drawRelations() },
        '-',
        { label: 'Overview map', icon: '▣', checked: store.get().mini !== false, onClick: () => { store.patch({ mini: store.get().mini === false }); mini.hidden = store.get().mini === false; paintMini(); } },
        { label: 'Mouse wheel zooms', icon: '⊕', checked: (store.get().wheel || 'zoom') === 'zoom', hint: 'Otherwise the wheel scrolls and Ctrl+wheel zooms', onClick: () => store.patch({ wheel: (store.get().wheel || 'zoom') === 'zoom' ? 'scroll' : 'zoom' }) },
        RO ? null : { label: 'Snap to grid', icon: '#', kbd: 'G', checked: S.snap, onClick: () => setSnap(!S.snap) },
        { label: 'Keyboard shortcuts', icon: '⌨', kbd: '?', onClick: () => shortcuts() },
        RO ? null : '-',
        RO ? null : { label: 'Delete the board', icon: '🗑', danger: true, onClick: async () => { const r = await WB.ui.confirmTrash(S.board); if (r) opts.back(); } },
      ].filter(Boolean), at);
    }
    function arrangeItems() {
      const n = S.sel.size;
      return [
        { label: 'Bring to front', icon: '⤒', kbd: 'Ctrl+]', onClick: () => zorder(1) }, { label: 'Send to back', icon: '⤓', kbd: 'Ctrl+[', onClick: () => zorder(-1) },
        n > 1 ? '-' : null,
        n > 1 ? { label: 'Align left edges', icon: '⇤', onClick: () => align('left') } : null, n > 1 ? { label: 'Align centres', icon: '↔', onClick: () => align('center') } : null, n > 1 ? { label: 'Align right edges', icon: '⇥', onClick: () => align('right') } : null,
        n > 1 ? { label: 'Align tops', icon: '⤒', onClick: () => align('top') } : null, n > 1 ? { label: 'Align middles', icon: '↕', onClick: () => align('middle') } : null, n > 1 ? { label: 'Align bottoms', icon: '⤓', onClick: () => align('bottom') } : null,
        n > 2 ? '-' : null,
        n > 2 ? { label: 'Space evenly across', icon: '⋯', onClick: () => distribute('x') } : null, n > 2 ? { label: 'Space evenly down', icon: '⋮', onClick: () => distribute('y') } : null,
        n > 1 ? { label: 'Same size', icon: '▣', hint: 'Size of the first selected card', onClick: () => sameSize() } : null,
      ].filter(Boolean);
    }
    const arrangeMenu = at => WB.ui.menu(arrangeItems(), at);
    function convertItems(it) {
      const common = ['character', 'place', 'faction', 'event', 'item', 'lore', 'plot', 'scene', 'note'].map(k => WB.type(k)).filter(Boolean);
      const rest = WB.typeList().filter(t => !common.includes(t) && !t.lens);
      return common.concat(rest).map(t => ({ label: t.name, icon: t.icon, onClick: () => convertNote(it, t) }));
    }
    const convertMenu = (it, at) => WB.ui.menu([{ header: 'Turn the note into…' }].concat(convertItems(it)), at);
    function shortcuts() {
      const rows = [['Double-click', 'New note (on a card: edit, peek or rename)'], ['Drag', S.tool === 'pan' ? 'Move around (Shift+drag selects)' : 'Select an area (Space+drag moves around)'], ['Wheel · Ctrl+wheel', 'Zoom'], ['Drag a card\'s dot', 'Connect it — let go on empty space for a new note'],
        ['N · T · L · F · I · E', 'Note · text · checklist · frame · picture · entries'], ['Enter', 'Edit the note / open the entry'], ['Del', 'Delete'], ['Ctrl+D · Ctrl+C · Ctrl+V', 'Duplicate · copy · paste'], ['Ctrl+G', 'Frame the selection'],
        ['Ctrl+Z · Ctrl+Y', 'Undo · redo'], ['Arrows', 'Nudge (Shift: further)'], ['Ctrl+A · Esc', 'Select all · deselect'], ['+ · − · 0 · 1', 'Zoom in · out · 100% · fit'], ['G', 'Snap to grid'], ['Ctrl+F', 'Find on the board (Enter: next)'], ['Ctrl+] · Ctrl+[', 'Bring to front · send to back'], ['H · V', 'Pan tool · select tool']];
      ui.dialog({ title: 'Board shortcuts', icon: '⌨', body: h('div.wb-shortcuts', rows.map(([k, d]) => h('div.wb-kv-row', [WB.ui.kbd(k), h('span', { text: d })]))) });
    }

    /* ================= arranging & clipboard ================= */
    function zorder(dir) {
      const list = selItems();
      if (!list.length) return;
      const zs = [...S.items.values()].map(i => i.z);
      const base = dir > 0 ? Math.max(...zs) : Math.min(...zs);
      const sorted = list.slice().sort((a, b) => a.z - b.z);
      change(dir > 0 ? 'bring to front' : 'send to back', sorted.map((it, i) => ({ id: it.id, z: dir > 0 ? base + 1 + i : base - sorted.length + i })));
    }
    function align(how) {
      const list = selItems(), bb = B.bbox(list.map(rectOf));
      const f = { left: it => ({ x: bb.x }), right: it => ({ x: bb.x + bb.w - it.w }), center: it => ({ x: Math.round(bb.x + bb.w / 2 - it.w / 2) }), top: it => ({ y: bb.y }), bottom: it => ({ y: bb.y + bb.h - it.h }), middle: it => ({ y: Math.round(bb.y + bb.h / 2 - it.h / 2) }) }[how];
      change('align', list.map(it => Object.assign({ id: it.id }, f(it))));
    }
    function distribute(axis) {
      const list = selItems().slice().sort((a, b) => (axis === 'x' ? a.x - b.x : a.y - b.y));
      const size = axis === 'x' ? 'w' : 'h';
      const start = list[0][axis], end = list[list.length - 1][axis] + list[list.length - 1][size];
      const gap = (end - start - list.reduce((s, it) => s + it[size], 0)) / (list.length - 1);
      let pos = start;
      change('space evenly', list.map(it => { const p = { id: it.id, [axis]: Math.round(pos) }; pos += it[size] + gap; return p; }));
    }
    function sameSize() { const list = selItems(), f = list[0]; change('same size', list.slice(1).map(it => ({ id: it.id, w: f.w, h: f.h }))); }
    function copy() {
      const list = selItems();
      if (!list.length) return;
      const ids = new Set(list.map(i => i.id));
      B.clip = { items: list.map(i => Object.assign({}, i)), links: [...S.links.values()].filter(l => ids.has(l.from) && ids.has(l.to)).map(l => Object.assign({}, l)), stamp: Date.now(), n: 0 };
      try { navigator.clipboard.writeText('worldbuilder-board-cards:' + B.clip.stamp).catch(() => { }); } catch { }
      ui.toast(list.length === 1 ? 'Card copied' : list.length + ' cards copied', '⎘', 1600);
    }
    async function paste(at, clip = B.clip) {
      if (!clip || RO) return;
      clip.n = (clip.n || 0) + 1;
      const bb = B.bbox(clip.items.map(rectOf));
      const dx = at ? snap(at.x - bb.x - bb.w / 2) : snap(30 * clip.n), dy = at ? snap(at.y - bb.y - bb.h / 2) : snap(30 * clip.n);
      const got = await apiAdd(clip.items.map(i => ({ kind: i.kind, entryId: i.entryId, mediaId: i.mediaId, text: i.text, data: i.data, color: i.color, x: i.x + dx, y: i.y + dy, w: i.w, h: i.h })));
      const map = new Map(clip.items.map((i, k) => [i.id, got[k] && got[k].id]));
      const links = [];
      for (const l of clip.links) { const f = map.get(l.from), t = map.get(l.to); if (f && t) links.push(await apiLink({ from: f, to: t, label: l.label, style: l.style })); }
      let snap4 = null;
      push(got.length === 1 ? 'paste a card' : 'paste ' + got.length + ' cards', async () => { snap4 = await apiRemove(got.map(i => i.id)); }, async () => { if (snap4) await apiRestore(snap4); });
      setSel(got.map(i => i.id));
    }
    async function duplicate() {
      const list = selItems();
      if (!list.length) return;
      const ids = new Set(list.map(i => i.id));
      await paste(null, { items: list, links: [...S.links.values()].filter(l => ids.has(l.from) && ids.has(l.to)), n: 0 });
    }
    function nudge(dx, dy) {
      const list = selItems();
      if (!list.length) return;
      const ids = new Set(list.map(i => i.id));
      for (const f of list.filter(x => x.kind === 'frame')) for (const o of shown()) if (inside(o, f)) ids.add(o.id);
      change('nudge', [...ids].map(id => S.items.get(id)).map(it => ({ id: it.id, x: it.x + dx, y: it.y + dy })));
    }

    /* ================= the world's own links ================= */
    /** connectors for every relation between entries that are both on the board */
    async function drawRelations() {
      if (RO) return;
      const rels = await WB.api('links.relations', WB.worldId).catch(() => []);
      const cardOf = new Map();
      for (const it of shown()) if (it.kind === 'entry' && it.entryId && !cardOf.has(it.entryId)) cardOf.set(it.entryId, it.id);
      const have = new Set([...S.links.values()].flatMap(l => [l.from + '>' + l.to, l.to + '>' + l.from]));
      const made = [];
      for (const r of rels) {
        const a = cardOf.get(r.src), b = cardOf.get(r.dst);
        if (!a || !b || have.has(a + '>' + b)) continue;
        have.add(a + '>' + b); have.add(b + '>' + a);
        made.push(await apiLink({ from: a, to: b, label: r.name, style: { dash: 'dashed', curve: true, color: r.color || '' } }));
      }
      if (!made.length) { ui.toast('Every relation between these entries is already drawn', 'ℹ', 3600); return; }
      let snap5 = null;
      const op = push('draw relations', async () => { snap5 = await apiUnlink(made.map(l => l.id)); }, async () => { if (snap5) await apiRestore(snap5); });
      op.toast = WB.ui.undoToast(WB.fmt.plural(made.length, 'relation') + ' drawn as connectors', async () => { const i = S.undo.indexOf(op); if (i >= 0) S.undo.splice(i, 1); await op.undo(); });
    }
    /** pins up what an entry card's entry is linked to (relations, reference fields, mentions) around it */
    async function addRelated(it) {
      if (RO || !it || !it.entryId) return;
      const c = await WB.api('entries.context', it.entryId).catch(() => null);
      if (!c) return;
      const found = new Map();
      const take = (e, label) => { if (e && !e.deletedAt && e.id !== boardId && e.id !== it.entryId && WB.visible(e) && !found.has(e.id)) found.set(e.id, { e, label }); };
      c.relations.forEach(r => take(r.other, r.label));
      c.references.forEach(r => take(r.entry, r.link.label || ''));
      c.referencedBy.forEach(r => take(r.entry, r.link.label ? r.link.label + ' of' : ''));
      c.mentions.forEach(r => take(r.entry, 'mentions'));
      c.mentionedBy.forEach(r => take(r.entry, 'mentioned by'));
      if (!found.size) { ui.toast('Nothing is linked to “' + ((S.ents.get(it.entryId) || {}).title || 'this entry') + '” yet', 'ℹ'); return; }
      const onBoard = new Map(shown().filter(x => x.kind === 'entry' && x.entryId).map(x => [x.entryId, x.id]));
      const fresh = [...found.values()].filter(f => !onBoard.has(f.e.id)).slice(0, 16);
      fresh.forEach(f => S.ents.set(f.e.id, f.e));
      const cx = it.x + it.w / 2, cy = it.y + it.h / 2, R = Math.max(330, 120 + fresh.length * 32);
      // a ring around the card, each one pushed outward until it lands on free space
      const taken = shown().filter(x => x.kind !== 'frame').map(rectOf);
      const clash = r => taken.some(t => r.x < t.x + t.w + 24 && r.x + r.w + 24 > t.x && r.y < t.y + t.h + 24 && r.y + r.h + 24 > t.y);
      const cards = fresh.map((f, i) => {
        const a = -Math.PI / 2 + i * 2 * Math.PI / fresh.length;
        let k = 0, c2;
        do { c2 = newCard('entry', { x: cx + Math.cos(a) * (R + k * 70) * 1.25, y: cy + Math.sin(a) * (R + k * 70) * .85 }, { entryId: f.e.id }); k++; } while (clash(c2) && k < 30);
        taken.push(rectOf(c2));
        return c2;
      });
      const got = cards.length ? await apiAdd(cards) : [];
      got.forEach(g => onBoard.set(g.entryId, g.id));
      const have = new Set([...S.links.values()].flatMap(l => [l.from + '>' + l.to, l.to + '>' + l.from]));
      const links = [];
      for (const f of found.values()) {
        const to = onBoard.get(f.e.id);
        if (!to || have.has(it.id + '>' + to)) continue;
        links.push(await apiLink({ from: it.id, to, label: f.label, style: { curve: true } }));
      }
      let snap6 = null;
      push('add related entries', async () => { const a = links.length ? await apiUnlink(links.map(l => l.id)) : { links: [] }; const b = got.length ? await apiRemove(got.map(g => g.id)) : { items: [], links: [] }; snap6 = { items: b.items, links: a.links.concat(b.links) }; }, async () => { if (snap6) await apiRestore(snap6); });
      ui.toast(got.length ? WB.fmt.plural(got.length, 'related entry', 'related entries') + ' added' + (found.size > got.length ? ' · ' + (found.size - got.length) + ' already here' : '') : 'Connected to what is already on the board', '✺');
      setSel([it.id].concat(got.map(g => g.id)));
    }

    /* ================= conversions & pictures ================= */
    async function convertNote(it, type) {
      const tmp = document.createElement('div');
      tmp.innerHTML = WB.text.sanitize(it.text || '');
      const firstEl = [...tmp.children].find(c => c.textContent.trim());
      const title = ((firstEl ? firstEl.textContent : tmp.textContent) || '').trim().replace(/\s+/g, ' ').slice(0, 200) || 'Untitled ' + type.name.toLowerCase();
      if (firstEl) firstEl.remove();
      const body = WB.text.sanitize(tmp.innerHTML);
      const plain = WB.text.text(body).replace(/\s+/g, ' ').trim();
      try {
        const e = await WB.api('entries.create', { worldId: WB.worldId, typeId: type.id, title, body, summary: plain.length <= 240 ? plain : '' });
        S.ents.set(e.id, e);
        const before = { id: it.id, kind: it.kind, entryId: it.entryId, text: it.text, w: it.w, h: it.h, data: it.data, color: it.color };
        const after = { id: it.id, kind: 'entry', entryId: e.id, w: Math.max(it.w, 240), h: Math.max(it.h, 130), color: '', data: Object.assign({}, it.data, { fromNote: { color: it.color } }) };
        await apiUpdate([after]);
        const op = push('turn a note into an entry', async () => { await apiUpdate([before]); await WB.api('entries.trash', e.id).catch(() => { }); }, async () => { await WB.api('entries.restore', e.id).catch(() => { }); await apiUpdate([after]); });
        const t = op.toast = WB.ui.undoToast('“' + title + '” is now a ' + type.name.toLowerCase(), async () => { const i = S.undo.indexOf(op); if (i >= 0) S.undo.splice(i, 1); await op.undo(); });
        t.appendChild(ui.button({ label: 'Open', small: true, onClick: () => { t.remove(); WB.open(e.id); } }));
      } catch (err) { WB.fail(err); }
    }
    async function pickImageFor(it) {
      const m = await WB.ui.pickMedia({ kind: 'image', title: 'Picture for the card' });
      if (!m) return;
      const patch = { id: it.id, mediaId: m.id };
      if (m.width && m.height && !it.mediaId) patch.h = Math.round(Math.max(60, Math.min(600, it.w * m.height / m.width)));
      change('set a picture', [patch]);
    }
    async function caption(it) {
      const v = await ui.prompt('Caption', it.text || '', 'What does the picture show?');
      if (v != null && v !== it.text) change('caption a picture', [{ id: it.id, text: v }]);
    }
    async function swapEntry(it) {
      const e = await WB.ui.pickEntry({ title: 'Show which entry on this card?', exclude: [boardId] });
      if (!e) return;
      S.ents.set(e.id, Object.assign({}, S.ents.get(e.id) || {}, e));
      change('change the entry', [{ id: it.id, entryId: e.id }]);
    }
    async function openImage(it) {
      const pics = shown().filter(x => x.kind === 'image' && x.mediaId);
      const media = (await Promise.all(pics.map(x => WB.media(x.mediaId)))).filter(Boolean);
      const m = await WB.media(it.mediaId);
      if (!m) { if (!RO) pickImageFor(it); return; }
      K.lightbox(media, Math.max(0, media.findIndex(x => x.id === m.id)), { onOpen: x => WB.go('library', { mediaId: x.id }) });
    }

    /* ================= tools, snapping, hints, minimap ================= */
    function setTool(t) { S.tool = t; store.patch({ tool: t }); canvas.classList.toggle('tool-pan', t === 'pan'); canvas.classList.toggle('tool-select', t === 'select'); toolSeg.querySelectorAll('button').forEach((b, i) => b.classList.toggle('on', (i === 0) === (t === 'pan'))); paintHint(); }
    function setSnap(on) { S.snap = on; store.patch({ snap: on }); snapChip.classList.toggle('on', on); canvas.classList.toggle('snap', on); ui.toast(on ? 'Snapping to the grid' : 'Free placement', '#', 1400); }
    canvas.classList.toggle('snap', S.snap);
    function paintHint() {
      const n = S.sel.size;
      hint.textContent = RO ? 'Share view · drag to look around · double-click an entry to peek'
        : n ? (n === 1 ? '1 card selected' : n + ' cards selected') + ' · drag to move · Del deletes · Ctrl+D duplicates'
          : S.tool === 'pan' ? 'Drag to move around · Shift+drag to select · double-click for a note · drag a card\'s dot to connect' : 'Drag to select · Space+drag to move around · double-click for a note';
    }
    function paintEmptyHint() {
      GK.clear(emptyHint);
      GK.append(emptyHint, [h('div.bd-eh-ico', { text: '▦' }), h('h3', { text: 'An empty board' }),
        h('p.gk-muted', { text: RO ? 'Nothing is pinned to this board yet.' : 'Double-click anywhere to write a note. Drag entries in from the left, drop pictures from your computer, or pull a dot on any card to draw a connector.' }),
        RO ? null : h('div.gk-row', { style: { justifyContent: 'center' } }, [ui.button({ label: 'Note', icon: '✎', kind: 'primary', onClick: () => addAt('note') }), ui.button({ label: 'Entries…', icon: '◇', onClick: () => addEntries() }), ui.button({ label: 'Picture…', icon: '▣', onClick: () => addImage() })])]);
    }
    let miniRaf = 0;
    function paintMini() {
      if (mini.hidden) return;
      cancelAnimationFrame(miniRaf);
      miniRaf = requestAnimationFrame(() => {
        const W = canvas.clientWidth, H = canvas.clientHeight;
        const view = { x: -S.view.x / S.view.z, y: -S.view.y / S.view.z, w: W / S.view.z, h: H / S.view.z };
        const list = shown().map(i => ({ id: i.id, kind: i.kind, x: i.x, y: i.y, w: i.w, h: i.h, color: colorOf(i), typeId: null }));
        const s = B.mini(list, [...S.links.values()].map(l => [l.from, l.to]), { pad: 30, cls: 'bd-minisvg', view });
        s.appendChild(B.svg('rect', { class: 'bd-mini-view', x: view.x, y: view.y, width: view.w, height: view.h, rx: 6 }));
        mini.replaceChildren(s);
        mini._vb = s.viewBox.baseVal;
      });
    }
    mini.addEventListener('pointerdown', e => {
      e.preventDefault(); e.stopPropagation();
      const go = ev => {
        const vb = mini._vb; if (!vb) return;
        const r = mini.getBoundingClientRect();
        const sc = Math.min(r.width / vb.width, r.height / vb.height), ox = (r.width - vb.width * sc) / 2, oy = (r.height - vb.height * sc) / 2;
        const wx = vb.x + (ev.clientX - r.left - ox) / sc, wy = vb.y + (ev.clientY - r.top - oy) / sc;   // ratios of two screen lengths: zoom-free  lint-ui: ok
        S.view.x = canvas.clientWidth / 2 - wx * S.view.z; S.view.y = canvas.clientHeight / 2 - wy * S.view.z;
        applyView();
      };
      try { mini.setPointerCapture(e.pointerId); } catch { }
      go(e);
      const up = () => { mini.removeEventListener('pointermove', go); mini.removeEventListener('pointerup', up); };
      mini.addEventListener('pointermove', go); mini.addEventListener('pointerup', up);
    });

    /* ================= side panel: add cards, find entries ================= */
    function sidePanel() {
      const tiles = h('div.bd-tiles', ADD.map(([k, icon, label, tip]) => {
        const b = h('button.bd-tile', { type: 'button', title: tip + ' — click, or drag onto the board', draggable: true, onclick: () => addAt(k) }, [h('span.bd-tile-ico', { text: icon }), h('span', { text: label })]);
        b.addEventListener('dragstart', ev => { ev.dataTransfer.setData(KIND_MIME, k); ev.dataTransfer.effectAllowed = 'copy'; const chip = document.body.appendChild(h('div.wb-drag-chip', { text: label })); ev.dataTransfer.setDragImage(chip, 14, 14); setTimeout(() => chip.remove(), 0); });
        return b;
      }));
      let q = '', typeId = '', seq = 0;
      const list = h('div.bd-elist');
      const typeSel = ui.select({ value: '', options: [['', 'All types']].concat(WB.typeList().filter(t => !t.lens || t.lens === 'story').map(t => [t.id, t.icon + '  ' + t.plural])), onChange: v => { typeId = v; run(); } });
      const search = WB.ui.search({ placeholder: 'Find entries to pin', onInput: v => { q = v; run(); } });
      const run = WB.debounce(async () => {
        const my = ++seq;
        const res = await WB.api('search.query', WB.worldId, q, { limit: 60, typeIds: typeId ? [typeId] : [] }).catch(() => []);
        if (my !== seq || !S.alive) return;
        const onBoard = new Set([...S.items.values()].map(i => i.entryId).filter(Boolean));
        GK.clear(list);
        const vis = res.filter(e => e.id !== boardId && WB.visible(e));
        if (!vis.length) list.appendChild(h('div.gk-small.gk-muted.bd-enone', { text: q ? 'Nothing matches “' + q + '”.' : 'No entries yet.' }));
        for (const e of vis) {
          vis.forEach(x => { if (!S.ents.has(x.id)) S.ents.set(x.id, x); });
          const on = onBoard.has(e.id);
          const row = WB.ui.row(e, { sub: (WB.typeOf(e) || {}).name || '', trailing: on ? h('span.bd-onboard', { text: 'on board', title: 'Already on this board — click to find it' }) : h('span.bd-addplus', { text: '＋', title: 'Add to the board' }),
            onClick: (x, ev) => { if (ev.ctrlKey || ev.metaKey) return WB.peek(e.id); if (on) { const it = [...S.items.values()].find(i => i.entryId === e.id); if (it) { setSel([it.id]); reveal([it.id]); } } else addEntries(null, [e.id]); } });
          row.title = on ? 'On the board — click to find it' : 'Click to add · drag onto the board';
          list.appendChild(row);
        }
      }, 140);
      S.refreshSide = run;
      run();
      const p = ui.panel({ cls: 'bd-side', body: [
        h('div.bd-side-h', { text: 'Add' }), tiles,
        h('div.bd-side-h', { text: 'Entries' }), search, typeSel, list,
        h('div.gk-tiny.gk-faint.bd-side-tip', { text: 'Drag onto the board, or click to add at the centre. Pictures can be dropped straight from your computer or the Library.' }),
      ] });
      WB.ui.listKeys(list);
      return p;
    }

    /* ================= find on the board ================= */
    let finds = [], findAt = -1;
    const textOf = it => {
      const e = it.entryId && S.ents.get(it.entryId);
      const tmp = document.createElement('div'); tmp.innerHTML = it.text || '';
      return [tmp.textContent, e && e.title, e && e.summary, ...((it.data && it.data.items) || []).map(x => x.text)].filter(Boolean).join(' ').toLowerCase();
    };
    function runFind() {
      const q = findIn.value.trim().toLowerCase();
      finds = q ? shown().filter(it => textOf(it).includes(q)).sort((a, b) => a.y - b.y || a.x - b.x).map(it => it.id) : [];
      findAt = -1;
      canvas.classList.toggle('finding', !!q);
      for (const [id, rec] of els) rec.el.classList.toggle('hit', finds.includes(id));
      findN.textContent = q ? (finds.length ? finds.length + ' found' : 'none') : '';
    }
    function nextFind(d = 1) {
      if (!finds.length) return;
      findAt = (findAt + d + finds.length) % finds.length;
      setSel([finds[findAt]]); reveal([finds[findAt]]);
      findN.textContent = (findAt + 1) + ' of ' + finds.length;
    }
    function openFind() { findIn.hidden = false; findBtn.classList.add('on'); findIn.focus(); findIn.select(); }
    function closeFind() { findIn.value = ''; runFind(); findIn.hidden = true; findBtn.classList.remove('on'); canvas.focus({ preventScroll: true }); }
    findIn.addEventListener('input', runFind);
    findIn.addEventListener('keydown', e => { e.stopPropagation(); if (e.key === 'Enter') { e.preventDefault(); nextFind(e.shiftKey ? -1 : 1); } else if (e.key === 'Escape') { e.preventDefault(); closeFind(); } });

    /* ================= keyboard ================= */
    const onKey = e => {
      if (!canvas.isConnected || document.querySelector('.gk-scrim, .mk-lb')) return;
      const typing = e.target.closest && e.target.closest('input, textarea, select, [contenteditable="true"]');
      if (typing) return;
      const ae = document.activeElement;
      if (ae && ae !== document.body && !stage.contains(ae)) return;
      if (document.querySelector('.wb-pop') && e.key !== 'Escape') return;
      const k = e.key, ctrl = e.ctrlKey || e.metaKey;
      if (k === ' ' && !e.repeat && !(e.target.closest && e.target.closest('button, [role="link"], [role="checkbox"]'))) { S.space = true; canvas.classList.add('space'); e.preventDefault(); return; }
      if (ctrl && k.toLowerCase() === 'z' && !e.shiftKey) { e.preventDefault(); if (!RO) undo(); return; }
      if (ctrl && (k.toLowerCase() === 'y' || (k.toLowerCase() === 'z' && e.shiftKey))) { e.preventDefault(); if (!RO) redo(); return; }
      if (ctrl && k.toLowerCase() === 'a') { e.preventDefault(); setSel(shown().map(i => i.id)); return; }
      if (ctrl && k.toLowerCase() === 'f') { e.preventDefault(); openFind(); return; }
      if (k === 'Escape') { if (S.sel.size || S.link) { setSel([]); } return; }
      if (k === '+' || k === '=') { e.preventDefault(); zoomAt(S.view.z * 1.25); return; }
      if (k === '-') { e.preventDefault(); zoomAt(S.view.z / 1.25); return; }
      if (k === '0' && !ctrl) { e.preventDefault(); zoomAt(1); return; }
      if (k === '1' && !ctrl) { e.preventDefault(); fit(); return; }
      if (k === '2' && !ctrl && S.sel.size) { e.preventDefault(); reveal([...S.sel]); return; }
      if (k === '?') { e.preventDefault(); shortcuts(); return; }
      if (k.toLowerCase() === 'h' && !ctrl) { setTool('pan'); return; }
      if (k.toLowerCase() === 'v' && !ctrl) { setTool('select'); return; }
      if (RO) return;
      if (k === 'Delete' || k === 'Backspace') { e.preventDefault(); if (S.link) unlink([S.link]); else if (S.sel.size) remove([...S.sel]); return; }
      if (ctrl && k.toLowerCase() === 'd') { e.preventDefault(); duplicate(); return; }
      if (ctrl && k.toLowerCase() === 'c') { if (S.sel.size) { e.preventDefault(); copy(); } return; }
      if (ctrl && k.toLowerCase() === 'g') { e.preventDefault(); wrapInFrame(); return; }
      if (ctrl && k === ']') { e.preventDefault(); zorder(1); return; }
      if (ctrl && k === '[') { e.preventDefault(); zorder(-1); return; }
      if (k.startsWith('Arrow') && S.sel.size) { e.preventDefault(); const d = e.shiftKey ? GRID * 2 : S.snap ? GRID : 1; nudge(k === 'ArrowLeft' ? -d : k === 'ArrowRight' ? d : 0, k === 'ArrowUp' ? -d : k === 'ArrowDown' ? d : 0); return; }
      if (k === 'Enter' && S.sel.size === 1) {
        e.preventDefault();
        const it = selItems()[0];
        if (it.kind === 'note' || it.kind === 'text') editText(it.id);
        else if (it.kind === 'entry' && it.entryId) WB.open(it.entryId);
        else if (it.kind === 'frame') renameFrame(it.id);
        else if (it.kind === 'image') openImage(it);
        else if (it.kind === 'checklist') { const i = els.get(it.id).el.querySelector('.bd-chk-add'); if (i) i.focus(); }
        return;
      }
      if (k === 'Enter' && S.link) { e.preventDefault(); editLinkLabel(S.link); return; }
      if (ctrl || e.altKey) return;
      const at = S.pointer && (() => { const r = canvas.getBoundingClientRect(); return S.pointer.x >= r.left && S.pointer.x <= r.right && S.pointer.y >= r.top && S.pointer.y <= r.bottom; })() ? toWorld(S.pointer.x, S.pointer.y) : null;
      const map = { n: 'note', t: 'text', l: 'checklist', i: 'image', e: 'entry' };
      if (map[k.toLowerCase()]) { e.preventDefault(); addAt(map[k.toLowerCase()], at); return; }
      if (k.toLowerCase() === 'f') { e.preventDefault(); if (S.sel.size) wrapInFrame(); else addAt('frame', at); return; }
      if (k.toLowerCase() === 'g') { e.preventDefault(); setSnap(!S.snap); }
    };
    const onKeyUp = e => { if (e.key === ' ') { S.space = false; canvas.classList.remove('space'); } };
    const onPaste = async e => {
      if (RO || !canvas.isConnected || document.querySelector('.gk-scrim')) return;
      const typing = e.target.closest && e.target.closest('input, textarea, [contenteditable="true"]');
      const ae = document.activeElement;
      if (typing || (ae && ae !== document.body && !stage.contains(ae))) return;
      const text = e.clipboardData.getData('text/plain') || '';
      const files = [...e.clipboardData.files].filter(f => /^image\//.test(f.type));
      const at = S.pointer ? toWorld(S.pointer.x, S.pointer.y) : center();
      e.preventDefault();
      if (B.clip && text === 'worldbuilder-board-cards:' + B.clip.stamp) return paste(at);
      if (files.length) { const saved = await WB.saveFiles(files); if (saved.length) addImage(at, saved); return; }
      if (text.trim()) {
        const t = text.trim();
        if (/^https?:\/\/\S+$/.test(t)) return addCards('paste a link', [newCard('note', at, { text: '<p><a href="' + WB.esc(t) + '">' + WB.esc(t) + '</a></p>' })]);
        return addCards('paste text', [newCard('note', at, { text: WB.text.fromText(t), h: Math.min(400, 80 + Math.ceil(t.length / 28) * 22) })]);
      }
      if (B.clip) paste(at);
    };
    document.addEventListener('keydown', onKey);
    document.addEventListener('keyup', onKeyUp);
    document.addEventListener('paste', onPaste);

    /* ================= live updates ================= */
    async function reload() {
      if (!S.alive || S.drag || S.editing) return;
      const d = await WB.api('boards.get', boardId).catch(() => null);
      if (!d || !S.alive) { if (!d && S.alive) opts.back(); return; }
      absorb(d);
      titleIn.value = S.board.title;
      render();
    }
    const offs = [
      WB.onChange(['board_items', 'board_links'], () => { if (Date.now() > S.ownUntil) reload(); }, 250),
      WB.onChange(['entries'], async p => {
        if (!S.alive) return;
        const ids = [...S.items.values()].map(i => i.entryId).filter(Boolean);
        if ((p.ids || []).includes(boardId)) { const b = await WB.api('entries.lite', boardId).catch(() => null); if (!b || b.deletedAt) { opts.back(); return; } S.board = Object.assign(S.board, b); if (document.activeElement !== titleIn) titleIn.value = b.title; }
        const touched = ids.filter(id => !p.ids || !p.ids.length || p.ids.includes(id));
        if (touched.length) { (await WB.api('entries.many', [...new Set(touched)]).catch(() => [])).forEach(e => S.ents.set(e.id, e)); if (!S.drag) render(); }
        if (S.refreshSide) S.refreshSide();
      }, 300),
      WB.onChange(['media'], () => { for (const rec of els.values()) rec.key = ''; if (!S.drag && !S.editing) render(); }, 300),
      GK.bus.on('layout', () => { placeSelbar(); paintMini(); }),
    ];

    /* ================= go ================= */
    setTool(S.tool);
    const saved = (store.get().views || {})[boardId];
    render();
    await new Promise(r => requestAnimationFrame(r));
    if (saved && saved.z) { S.view = { x: saved.x, y: saved.y, z: saved.z }; applyView(); } else fit();
    if (opts.focus) {
      const it = S.items.get(opts.focus) || [...S.items.values()].find(i => i.entryId === opts.focus);
      if (it) { setSel([it.id]); reveal([it.id]); els.get(it.id) && els.get(it.id).el.classList.add('flash'); }
    }
    canvas.focus({ preventScroll: true });
    B.live = { drawRelations, addRelated: id => addRelated(S.items.get(id)), state: () => ({ items: S.items.size, links: S.links.size, sel: [...S.sel], view: Object.assign({}, S.view), cards: itemsBox.children.length, lines: svgLinks.querySelectorAll('.bd-line').length }), addAt, fit, setSel, select: setSel, add: addCards, newCard, undo, redo, remove, editText, view: S.view, zoomAt, reveal, items: () => [...S.items.values()] };
    return () => {
      S.alive = false; finishEdit();
      offs.forEach(f => f());
      document.removeEventListener('keydown', onKey); document.removeEventListener('keyup', onKeyUp); document.removeEventListener('paste', onPaste);
      saveView.flush && saveView.flush();
      K && K.stopAll();
      B.live = null;
    };
  };
})(window);
