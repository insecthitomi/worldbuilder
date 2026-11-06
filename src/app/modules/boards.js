/* Boards: infinite canvases for plotting, mind maps, investigations and mood boards. The list of boards and the
   canvas live in src/app/modules/boards/ and load on first use. */
(function () {
  'use strict';
  const { h, ui } = GK;
  const FILES = ['src/app/modules/library/media-kit.js', 'src/app/modules/boards/gallery.js', 'src/app/modules/boards/canvas.js'];
  let live = null;
  const load = () => Promise.all(FILES.map(f => WB.loadScript(f)));
  const isBoard = e => { const t = e && WB.typeOf(e); return !!(t && t.lens === 'board'); };

  GK.modules.register({
    id: 'boards',
    title: 'Boards',
    icon: '▦',
    order: 70,
    heading: false,
    subtitle: 'Infinite canvases for plotting, mind maps and mood boards.',
    async mount(page, ctx) {
      if (!WB.worldId) {
        page.appendChild(h('div.gk-page-head', [h('div.gk-grow', [h('h1', { text: 'Boards' })])]));
        page.appendChild(WB.ui.empty({ icon: '▦', title: 'No world open', text: 'Boards are canvases for a world: pin up its characters and places, notes and pictures, and draw how they connect. Create or open a world first.', actions: [ui.button({ label: 'Create a world', kind: 'primary', onClick: () => WB.newWorld() })] }));
        return;
      }
      await load();
      const B = window.WBBoards;
      const store = await WB.store(ctx, { last: null, views: {}, snap: true, side: true, wheel: 'zoom', tool: 'pan', mini: true, sort: 'updated' });
      const params = WB.params('boards') || {};
      let cleanup = null, alive = true;

      async function show(boardId, focus) {
        if (cleanup) { try { cleanup(); } catch (e) { console.warn(e); } cleanup = null; }
        if (!alive) return;
        GK.clear(page);
        page.classList.remove('bd-page', 'bd-gpage');
        if (boardId) {
          try {
            store.patch({ last: boardId });
            cleanup = await B.canvas(page, boardId, { store, focus, back: () => show(null), open: id => show(id) });
            live = { kind: 'canvas', boardId };
            return;
          } catch (e) {
            console.warn(e);
            store.patch({ last: null });
            GK.clear(page);
            ui.toast(String((e && e.message) || 'That board could not be opened'), '⚠');
          }
        }
        store.patch({ last: null });
        page.classList.add('bd-gpage');
        cleanup = await B.gallery(page, { store, open: id => show(id) });
        live = { kind: 'gallery' };
      }

      // where to start: a board asked for, an entry to find on a board, the board open last time, or the list
      let start = params.boardId || params.entryId || null, focus = params.focus || params.itemId || null;
      if (start) {
        const e = await WB.api('entries.lite', start).catch(() => null);
        if (!e || e.deletedAt) start = null;
        else if (!isBoard(e)) {
          const on = await WB.api('boards.appearances', e.id).catch(() => []);
          if (on.length) { focus = e.id; start = on[0].boardId; if (on.length > 1) ui.toast('“' + e.title + '” is on ' + on.length + ' boards — showing “' + on[0].title + '”', '▦', 4200); }
          else { ui.toast('“' + e.title + '” isn\'t on a board yet', 'ℹ'); start = null; }
        }
      } else if (store.get().last && !params.list) {
        const e = await WB.api('entries.lite', store.get().last).catch(() => null);
        start = e && !e.deletedAt && e.worldId === WB.worldId && WB.visible(e) ? e.id : null;
      }
      await show(start, focus);
      return () => { alive = false; live = null; if (cleanup) cleanup(); cleanup = null; };
    },
  });

  /* ---------------- palette commands ---------------- */
  const onCanvas = () => GK.shell.current === 'boards' && live && live.kind === 'canvas' && window.WBBoards && WBBoards.live && !WB.share;
  WB.commands.add({ id: 'boards:new', label: 'New board…', icon: '▦', group: 'Create', words: 'canvas plot mind map mood kanban investigation', run: async () => { await load(); const id = await WBBoards.createDialog(); if (id) WB.go('boards', { entryId: id }); } });
  WB.commands.add({ id: 'boards:open', label: 'Open a board…', icon: '▦', group: 'Boards', run: async () => {
    const types = WB.typeList({ all: true }).filter(t => t.lens === 'board').map(t => t.id);
    const b = await WB.ui.pickEntry({ title: 'Open a board', types });
    if (b) WB.go('boards', { entryId: b.id });
  } });
  WB.commands.add({ id: 'boards:all', label: 'All boards', icon: '▦', group: 'Boards', run: () => WB.go('boards', { list: true }) });
  WB.commands.add({ id: 'boards:note', label: 'Board: add a note', icon: '✎', group: 'Boards', when: onCanvas, run: () => WBBoards.live.addAt('note') });
  WB.commands.add({ id: 'boards:entries', label: 'Board: add entries…', icon: '◇', group: 'Boards', when: onCanvas, run: () => WBBoards.live.addAt('entry') });
  WB.commands.add({ id: 'boards:picture', label: 'Board: add a picture…', icon: '▣', group: 'Boards', when: onCanvas, run: () => WBBoards.live.addAt('image') });
  WB.commands.add({ id: 'boards:checklist', label: 'Board: add a checklist', icon: '☑', group: 'Boards', when: onCanvas, run: () => WBBoards.live.addAt('checklist') });
  WB.commands.add({ id: 'boards:frame', label: 'Board: add a frame', icon: '▭', group: 'Boards', when: onCanvas, run: () => WBBoards.live.addAt('frame') });
  WB.commands.add({ id: 'boards:fit', label: 'Board: fit everything on screen', icon: '⤢', group: 'Boards', when: () => GK.shell.current === 'boards' && live && live.kind === 'canvas', run: () => WBBoards.live && WBBoards.live.fit() });

  /* ---------------- smoke ---------------- */
  let opened = 'did not run';
  WB.smoke('boards-open', async () => {
    const list = await WB.api('boards.list', WB.worldId);
    const plot = list.find(b => b.itemCount > 0) || list[0];
    if (!plot) { opened = 'error: the example world has no board'; return opened; }
    await WB.go('boards', { entryId: plot.id });
    await WB.wait(900);
    const st = window.WBBoards && WBBoards.live ? WBBoards.live.state() : null;
    const failed = !!document.querySelector('.gk-view .gk-panel h3') && [...document.querySelectorAll('.gk-view .gk-panel h3')].some(x => x.textContent === 'This screen failed to load');
    opened = st && st.cards > 5 && st.lines > 3 && !failed ? 'ok' : 'error: board shows ' + JSON.stringify(st);
    await WB.go('boards', { list: true });
    await WB.wait(400);
    const cards = document.querySelectorAll('.bd-gcard').length;
    if (!cards) opened = 'error: the list of boards is empty';
    return opened === 'ok' ? Object.assign({ board: plot.title }, st) : opened;
  });
  WB.check('boards: the example plot board shows its cards and connectors', () => { if (!/^ok/.test(opened)) throw new Error(opened); return true; });
})();
