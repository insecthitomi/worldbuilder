/* Write: manuscripts for novelists, screenwriters and game writers. A binder of stories, chapters and scenes; the page,
   scrivenings (a whole chapter or story as one text), outline and corkboard views; a story bible beside the text;
   focus mode with typewriter scrolling, sprints and a daily goal; writing statistics; compile to PDF, Word (RTF),
   HTML, Markdown, plain text and Fountain. The parts live in src/app/modules/write/. */
(function () {
  'use strict';
  const h = GK.h, ui = GK.ui;
  const W = window.WBW = window.WBW || {};
  const PARTS = ['model', 'binder', 'pages', 'bible', 'boards', 'focus', 'stats', 'compile'];
  const load = () => Promise.all([WB.loadScript('src/main/lib/write-script.js')].concat(PARTS.map(p => WB.loadScript('src/app/modules/write/' + p + '.js'))));
  const DEFAULTS = {
    mode: 'write', binder: true, bible: true, scriv: true, worlds: {}, closed: [], book: true,
    outlineCols: ['pov', 'location', 'when', 'status', 'words'], corkColor: 'status', corkSize: 'm',
    focusDim: 'dim', paraFocus: true, statsDays: 30, findCase: false, findWord: false, bibleNarrow: false, binderNarrow: false,
  };
  const MODES = [['write', '✎ Write', 'Write and edit the text (scenes, or a whole chapter as one page)'], ['outline', '☰ Outline', 'Every scene as a row: synopsis, point of view, place, status and words'], ['cork', '▦ Corkboard', 'Index cards by chapter: drag to reorder'], ['grid', '▤ Grid', 'Which characters, places and plot threads appear in each scene'], ['stats', '◔ Stats', 'Words per day, streaks, goals and per-story totals']];
  let room = null;

  /* ---------------- the room: shared state for the parts ---------------- */
  function createRoom(page, ctx, store, params) {
    const r = { page, ctx, store, worldId: WB.worldId, model: new W.Model(WB.worldId), sel: null, mode: store.get().mode || 'write', views: {}, subs: [], alive: true };
    const bus = new Map();
    r.on = (ev, fn) => { if (!bus.has(ev)) bus.set(ev, new Set()); bus.get(ev).add(fn); return () => bus.get(ev).delete(fn); };
    r.emit = (ev, data) => (bus.get(ev) || []).forEach(fn => { try { fn(data); } catch (e) { console.error(e); } });
    r.pref = k => store.get()[k];
    r.setPref = (k, v) => store.patch({ [k]: v });
    r.wpref = () => (store.get().worlds || {})[r.worldId] || {};
    r.setW = p => { const all = Object.assign({}, store.get().worlds || {}); all[r.worldId] = Object.assign({}, all[r.worldId] || {}, p); store.patch({ worlds: all }); };
    r.node = () => r.model.get(r.sel);
    r.story = () => { const n = r.node(); return n ? r.model.story(n.id) : r.model.roots[0] || null; };
    r.editable = () => !WB.share;

    /* ---- layout ---- */
    const head = h('div.wbw-head');
    const binderHost = h('div.wbw-binder-host');
    const mainHost = h('div.wbw-main-host');
    const bibleHost = h('div.wbw-bible-host');
    const binder = h('section.gk-panel.wbw-binder', [binderHost]);
    const main = h('section.gk-panel.wbw-main', [mainHost]);
    const bible = h('section.gk-panel.wbw-bible', [bibleHost]);
    const rootEl = h('div.wbw-room', [head, binder, main, bible]);
    r.el = { root: rootEl, head, binder: binderHost, main: mainHost, bible: bibleHost, binderPanel: binder, mainPanel: main, biblePanel: bible };
    page.appendChild(rootEl);
    // wide rooms show binder · page · bible side by side; narrower ones slide the bible (then the binder) over the page
    const panelKey = k => (k === 'bible' && rootEl.classList.contains('narrow') ? 'bibleNarrow' : k === 'binder' && rootEl.classList.contains('tiny') ? 'binderNarrow' : k);
    r.panelOn = k => !!r.pref(panelKey(k));
    const paintPanels = () => {
      const em = parseFloat(getComputedStyle(rootEl).fontSize) || 14, w = rootEl.clientWidth / em;
      if (w > 0) { rootEl.classList.toggle('narrow', w < 62); rootEl.classList.toggle('tiny', w < 44); }
      const binderOn = r.panelOn('binder') && !r.focusOn, bibleOn = r.panelOn('bible') && r.mode !== 'stats' && !r.focusOn;
      rootEl.classList.toggle('no-binder', !binderOn);
      rootEl.classList.toggle('no-bible', !bibleOn);
      const dB = binderOn && rootEl.classList.contains('tiny'), dI = bibleOn && rootEl.classList.contains('narrow');
      binder.classList.toggle('drawer', dB); binder.classList.toggle('gk-dialog', dB);
      bible.classList.toggle('drawer', dI); bible.classList.toggle('gk-dialog', dI);
      rootEl.style.setProperty('--wbw-head-h', (head.offsetTop + head.offsetHeight + 8) + 'px');
      rootEl.dataset.mode = r.mode;
    };
    r.paintPanels = paintPanels;
    r.togglePanel = k => { const key = panelKey(k); r.setPref(key, !r.pref(key)); paintPanels(); paintHead(); GK.layout('write-panels'); };
    const ro = new ResizeObserver(() => { const was = rootEl.className; paintPanels(); if (was !== rootEl.className) paintHead(); });
    ro.observe(rootEl);

    /* ---- the head: story, progress, view switch, session, actions ---- */
    const sessionEl = h('button.wbw-session', { type: 'button', title: 'This session: words written and time spent writing today. Click for statistics.', onclick: () => r.setMode('stats') });
    let seg = null;
    function paintHead() {
      GK.clear(head);
      const st = r.story();
      const storyBtn = h('button.wbw-story-btn', { type: 'button', title: 'Switch story or start a new one', onclick: ev => storyMenu(ev.currentTarget) }, [
        h('span.wbw-story-ico', { text: W.storyIcon(st) }),
        h('span.wbw-story-name.gk-ellipsis', { text: st ? st.title : 'No story yet' }), h('span.gk-faint', { text: '▾' }),
      ]);
      const tgt = st ? r.model.target(st) : 0;
      const prog = st ? h('div.wbw-head-prog', { title: st ? W.num(st.total) + ' words' + (tgt ? ' of ' + W.num(tgt) + ' (' + Math.round(st.total / tgt * 100) + '%)' : ' · set a word target in the story bible') : '' }, [
        W.status(st) ? h('span.wbw-pill', { style: { '--c': W.statusColor(st) }, text: W.status(st) }) : null,
        h('span.wbw-head-words', [h('b', { text: W.num(st.total) }), h('span.gk-muted', { text: tgt ? ' / ' + W.num(tgt) : ' words' })]),
        tgt ? W.bar(st.total / tgt, 'head') : null,
      ]) : null;
      seg = ui.segmented({ value: r.mode, options: MODES, onChange: v => r.setMode(v) });
      seg.classList.add('wbw-modes');
      head.append(
        h('div.wbw-head-l', [storyBtn, prog]),
        seg,
        h('div.wbw-head-r', [
          sessionEl,
          ui.button({ label: 'Focus', icon: '◎', small: true, title: 'Focus mode: only the text (Ctrl+Shift+F)', onClick: () => r.toggleFocus(true) }),
          ui.button({ label: 'Compile', icon: '⇩', small: true, title: 'Compile the story to PDF, Word, HTML, Markdown or text', disabled: !st, onClick: () => st && W.compileDialog(r, st.id) }),
          ui.group([
            tog('binder', '◧', 'Show or hide the manuscript tree'),
            tog('bible', '◨', 'Show or hide the story bible'),
          ]),
        ]),
      );
      paintSession();
    }
    const tog = (k, icon, title) => { const on = r.panelOn(k); const b = ui.button({ icon, small: true, kind: 'ghost', title, onClick: () => r.togglePanel(k) }); b.setAttribute('aria-pressed', String(on)); if (on) b.classList.add('on'); return b; };
    function paintSession() {
      const words = W.sessionTotal(), secs = W.session.active;
      sessionEl.replaceChildren(h('span.wbw-dot-live', { class: Date.now() - W.session.last < 45000 ? 'on' : '' }), h('b', { text: (words >= 0 ? '+' : '') + W.num(words) }), h('span.gk-muted', { text: ' · ' + W.clock(secs) }));
    }
    r.paintHead = paintHead;
    r.paintSession = paintSession;
    async function storyMenu(at) {
      const items = [{ header: 'Stories' }].concat(r.model.roots.map(s => ({ label: s.title, icon: W.storyIcon(s), checked: r.story() && r.story().id === s.id, hint: W.num(s.total) + ' words', onClick: () => r.select(s.id) })));
      if (!r.model.roots.length) items.push({ label: 'No stories yet', disabled: true });
      items.push('-', { label: 'New story…', icon: '＋', onClick: () => r.newStory() });
      if (r.story()) items.push({ label: 'Open the story in the Codex', icon: '↗', onClick: () => WB.open(r.story().id) });
      WB.ui.menu(items, at);
    }

    /* ---- selection & modes ---- */
    r.setMode = m => {
      if (!MODES.find(x => x[0] === m)) m = 'write';
      if (r.focusOn && m !== 'write') r.toggleFocus(false);
      r.mode = m; r.setPref('mode', m);
      paintPanels();
      paintHead();
      renderMain();
    };
    r.select = (id, o = {}) => {
      const n = r.model.get(id);
      if (!n) return;
      const prevStory = r.story();
      r.sel = id; r.setW({ sel: id });
      if (o.mode) { r.mode = o.mode; r.setPref('mode', o.mode); paintPanels(); }
      r.views.binder.reveal(id);
      r.views.binder.mark();
      if (r.mode === 'write' || o.mode) renderMain(o);
      else r.views.boards.mark(id);
      r.views.bible.show(n);
      const st = r.story();
      if (!prevStory || !st || prevStory.id !== st.id || o.mode) paintHead();
    };
    function renderMain(o = {}) {
      const n = r.node();
      if (r.mode === 'stats') { r.views.pages.hide(); r.views.boards.hide(); return r.views.stats.show(); }
      r.views.stats.hide();
      if (!r.model.roots.length && !r.model.loose.length) { r.views.boards.hide(); return r.views.pages.empty(); }
      if (r.mode === 'outline' || r.mode === 'cork' || r.mode === 'grid') { r.views.pages.hide(); return r.views.boards.show(r.mode, r.story()); }
      r.views.boards.hide();
      r.views.pages.show(n, o);
    }
    r.renderMain = renderMain;

    /* ---- data ---- */
    r.reload = async (p) => {
      if (!r.alive) return;
      const before = r.model.nodes.size;
      await r.model.load();
      if (!r.alive) return;
      if (!r.model.get(r.sel)) r.sel = pickDefault();
      r.views.binder.render();
      paintHead();
      r.views.pages.sync(p, before !== r.model.nodes.size);
      r.views.bible.sync(p);
      r.views.boards.sync(p);
    };
    function pickDefault() {
      const n = r.model.get(r.wpref().sel);
      if (n) return n.id;
      const s = r.model.roots[0];
      if (!s) return (r.model.loose[0] || {}).id || null;
      const scenes = r.model.scenes(s.id);
      return (scenes[0] || s).id;
    }
    r.liveWords = (id, words) => {
      W.sessionWords(id, words);
      const changed = r.model.setWords(id, words);
      if (changed.length) { r.views.binder.patch(changed); r.views.pages.patch(changed); r.emit('words', changed); }
      paintSession();
      const st = r.story();
      if (st && changed.includes(st.id)) { const w = head.querySelector('.wbw-head-words b'); if (w) w.textContent = W.num(st.total); const tgt = r.model.target(st); if (tgt) W.setBar(head.querySelector('.wbw-bar.head'), st.total / tgt); }
    };

    /* ---- creating ---- */
    const kindTitle = (kind, parent) => {
      const script = (r.model.story(parent && parent.id) || {}).write && r.model.story(parent.id).write.format === 'script';
      const n = parent ? r.model.children(parent.id).filter(x => x.kind === kind).length + 1 : r.model.roots.length + 1;
      if (kind === 'chapter') return (script ? 'Act ' : 'Chapter ') + n;
      if (kind === 'scene') return 'Scene ' + n;
      return 'Untitled story';
    };
    /** adds a node: kind 'scene' | 'chapter' next to / inside the selection; opts.parentId / afterId override */
    r.add = async (kind, o = {}) => {
      if (!r.editable()) return null;
      if (kind === 'story') return r.newStory();
      const sel = r.node();
      let parent = o.parentId !== undefined ? r.model.get(o.parentId) : null, after = o.afterId || null;
      if (o.parentId === undefined) {
        if (kind === 'scene') {
          if (sel && sel.kind === 'scene') { parent = r.model.parent(sel.id); after = sel.id; }
          else if (sel && sel.kind === 'chapter') parent = sel;
          else if (sel && sel.kind === 'story') { const chs = r.model.children(sel.id).filter(x => x.kind === 'chapter'); parent = chs[chs.length - 1] || sel; }
        } else if (kind === 'chapter') {
          const st = r.story();
          parent = st;
          const chap = sel && (sel.kind === 'chapter' ? sel : r.model.ancestors(sel.id).find(a => a.kind === 'chapter'));
          if (chap && st) after = chap.id;
        }
      }
      if (!parent && kind !== 'story') { if (!r.model.roots.length) return r.newStory(); parent = r.story(); }
      const typeId = r.model.typeIds[kind];
      if (!typeId) { ui.toast('This world has no ' + kind + ' type', '⚠'); return null; }
      try {
        const e = await WB.api('entries.create', { worldId: r.worldId, typeId, parentId: parent ? parent.id : null, title: o.title || kindTitle(kind, parent), fields: { status: (W.statusOptions({ kind, typeId }).includes('Draft') ? 'Draft' : '') } });
        if (after) await WB.api('entries.move', e.id, { parentId: parent ? parent.id : null, afterId: after });
        await r.reload();
        r.select(e.id, { mode: r.mode === 'stats' ? 'write' : undefined });
        if (o.rename !== false) setTimeout(() => r.views.binder.rename(e.id), 60);
        return e;
      } catch (err) { return WB.fail(err); }
    };
    r.newStory = async () => {
      if (!r.editable()) return;
      let format = 'prose';
      const name = ui.input({ placeholder: 'Title', value: '' });
      const kinds = h('div.wbw-newstory', [
        ['prose', '✎', 'Prose', 'Novel, novella, short story, serial'],
        ['script', '❝', 'Script', 'Screenplay, stage play, game dialogue'],
      ].map(([v, ic, l, d]) => h('button.wbw-kind', { type: 'button', class: v === format ? 'on' : '', onclick: ev => { format = v; ev.currentTarget.parentNode.querySelectorAll('.wbw-kind').forEach(b => b.classList.toggle('on', b === ev.currentTarget)); name.focus(); } }, [h('span.wbw-kind-ico', { text: ic }), h('b', { text: l }), h('span.gk-small.gk-muted', { text: d })])));
      const ok = await ui.dialog({ title: 'A new story', icon: '✎', body: [name, kinds, h('p.gk-small.gk-muted', { text: 'It starts with a first chapter and scene. Scripts get screenplay formatting while you type (scene headings, characters, dialogue).' })], actions: [{ label: 'Cancel', value: false }, { label: 'Create', kind: 'primary', value: true }] });
      if (!ok) return;
      try {
        const res = await WB.api('write.newStory', r.worldId, { title: name.value.trim() || 'Untitled story', format: format === 'script' ? 'script' : undefined });
        await r.reload();
        r.select((res.scene || res.chapter || res.story).id, { mode: 'write' });
        setTimeout(() => r.views.pages.focusEditor(), 120);
      } catch (e) { WB.fail(e); }
    };

    /* ---- focus mode ---- */
    r.focusOn = false;
    r.toggleFocus = on => {
      on = on == null ? !r.focusOn : !!on;
      if (on === r.focusOn) return;
      if (on && r.mode !== 'write') r.setMode('write');
      r.focusOn = on;
      W.focus.set(r, on);
    };

    /* ---- parts ---- */
    r.views.binder = W.binder(r, binderHost);
    r.views.pages = W.pages(r, mainHost);
    r.views.bible = W.bible(r, bibleHost);
    r.views.boards = W.boards(r, mainHost);
    r.views.stats = W.statsView(r, mainHost);

    /* ---- keys, ticks, data events ---- */
    const onKey = e => {
      if (!r.alive || document.querySelector('.gk-scrim')) return;
      const k = e.key.toLowerCase();
      if (e.ctrlKey && !e.shiftKey && !e.altKey && k === 'f' && r.mode === 'write') { e.preventDefault(); r.views.pages.find(); }
      else if (e.altKey && !e.ctrlKey && (e.key === 'ArrowDown' || e.key === 'ArrowUp') && r.el.main.contains(document.activeElement) && r.mode === 'write') {
        const n = r.node(); if (!n) return;
        const next = r.model.neighbour(n.kind === 'scene' ? n.id : (r.model.scenes(n.id)[0] || n).id, e.key === 'ArrowDown' ? 1 : -1);
        if (next) { e.preventDefault(); r.select(next.id); setTimeout(() => r.views.pages.focusEditor(), 60); }
      }
    };
    document.addEventListener('keydown', onKey);
    const tick = setInterval(() => { if (!rootEl.isConnected) { r.destroy(); if (room === r) room = null; return; } if (W.sessionTick()) { paintSession(); if (W.session.active % 30 === 0) W.sessionFlush(); } else if (sessionEl.querySelector('.wbw-dot-live.on')) paintSession(); r.emit('tick'); }, 1000);
    r.subs.push(WB.onChange(['entries', 'links'], p => r.reload(p)));
    r.subs.push(WB.on('share', () => r.reload()));
    r.destroy = () => {
      r.alive = false;
      ro.disconnect();
      if (r.focusOn) { r.focusOn = false; W.focus.set(r, false); }
      clearInterval(tick);
      document.removeEventListener('keydown', onKey);
      r.subs.forEach(u => { try { u(); } catch { } });
      for (const v of Object.values(r.views)) { try { v.destroy && v.destroy(); } catch (e) { console.error(e); } }
      W.sessionFlush();
    };

    /* ---- first paint ---- */
    r.start = async () => {
      await r.model.load();
      const p = params || {};
      let target = p.entryId && r.model.get(p.entryId) ? p.entryId : null;
      if (p.entryId && !target) {
        // an entry outside the manuscript tree (e.g. hidden in Share view): fall back quietly
        ui.toast('That entry is not part of a story in Write', 'ℹ');
      }
      r.sel = target || pickDefault();
      if (target) {
        const n = r.model.get(target);
        if (n.kind === 'story' && r.mode === 'write') r.setPref('scriv', true);
        if (!p.mode) { r.mode = 'write'; r.setPref('mode', 'write'); }
      }
      if (p.mode) r.mode = p.mode;
      paintPanels();
      paintHead();
      r.views.binder.render();
      if (r.sel) { r.views.bible.show(r.node()); }
      else r.views.bible.show(null);
      renderMain();
      if (p.focus) r.toggleFocus(true);
      if (p.action === 'scene' || p.action === 'chapter') r.add(p.action);
      else if (p.action === 'story') r.newStory();
      else if (p.action === 'compile' && r.story()) W.compileDialog(r, r.story().id);
      else if (p.action === 'find') r.views.pages.find();
    };
    return r;
  }

  /* ---------------- the module ---------------- */
  GK.modules.register({
    id: 'write',
    title: 'Write',
    icon: '✎',
    order: 30,
    heading: false,
    subtitle: 'Manuscripts, chapters and scenes with your world one click away.',
    async mount(page, ctx) {
      page.classList.add('wbw-page');
      if (!WB.worldId) {
        page.appendChild(WB.ui.empty({ icon: '✎', title: 'Write needs a world', text: 'Stories live inside a world, next to their characters and places. Create one to start writing.', actions: [ui.button({ label: 'Create a world', kind: 'primary', onClick: () => WB.newWorld() })] }));
        return;
      }
      const params = WB.params('write');
      await load();
      const store = WB.store ? await WB.store(ctx, DEFAULTS) : await ctx.store(DEFAULTS);
      const r = createRoom(page, ctx, store, params);
      room = r;
      const offWorld = WB.on('world', w => { if (w && w.id !== r.worldId) GK.shell.go('write'); });
      const end = () => { offWorld(); if (r.alive) r.destroy(); if (room === r) room = null; };
      await r.start();
      // left before the room finished opening: the shell never got our cleanup, so tidy up now
      if (!page.isConnected) { end(); return; }
      return end;
    },
  });
  W.room = () => room;

  /* ---------------- shortcuts & palette commands ---------------- */
  document.addEventListener('keydown', e => {
    if (!(e.ctrlKey && e.shiftKey && !e.altKey && e.key.toLowerCase() === 'f') || !WB.worldId) return;
    e.preventDefault();
    if (room) room.toggleFocus(); else WB.go('write', { focus: true });
  });
  const inWrite = (fn, action) => () => (room ? fn(room) : WB.go('write', { action }));
  const has = () => !!WB.worldId;
  WB.commands.add({ id: 'write:focus', label: 'Focus mode — just the text', icon: '◎', keys: 'Ctrl+Shift+F', group: 'Write', when: has, words: 'distraction free typewriter zen', run: () => (room ? room.toggleFocus(true) : WB.go('write', { focus: true })) });
  WB.commands.add({ id: 'write:scene', label: 'New scene', icon: '❡', group: 'Write', when: has, run: inWrite(r => r.add('scene'), 'scene') });
  WB.commands.add({ id: 'write:chapter', label: 'New chapter', icon: '§', group: 'Write', when: has, run: inWrite(r => r.add('chapter'), 'chapter') });
  WB.commands.add({ id: 'write:story', label: 'New story or script…', icon: '✎', group: 'Write', when: has, words: 'novel manuscript screenplay', run: inWrite(r => r.newStory(), 'story') });
  WB.commands.add({ id: 'write:compile', label: 'Compile manuscript (PDF, Word, HTML, Markdown)…', icon: '⇩', group: 'Write', when: has, words: 'export print book manuscript', run: inWrite(r => r.story() && W.compileDialog(r, r.story().id), 'compile') });
  WB.commands.add({ id: 'write:stats', label: 'Writing statistics & streak', icon: '◔', group: 'Write', when: has, words: 'words per day goal', run: () => (room ? room.setMode('stats') : WB.go('write', { mode: 'stats' })) });
  WB.commands.add({ id: 'write:outline', label: 'Outline of the story', icon: '☰', group: 'Write', when: has, run: () => (room ? room.setMode('outline') : WB.go('write', { mode: 'outline' })) });
  WB.commands.add({ id: 'write:cork', label: 'Corkboard of the story', icon: '▦', group: 'Write', when: has, words: 'index cards', run: () => (room ? room.setMode('cork') : WB.go('write', { mode: 'cork' })) });
  WB.commands.add({ id: 'write:grid', label: 'Story grid: who appears in which scene', icon: '▤', group: 'Write', when: has, words: 'characters threads matrix pov', run: () => (room ? room.setMode('grid') : WB.go('write', { mode: 'grid' })) });
  WB.commands.add({ id: 'write:find', label: 'Find & replace in the manuscript', icon: '⌕', group: 'Write', when: has, run: inWrite(r => { r.setMode('write'); r.views.pages.find(); }, 'find') });

  /* ---------------- smoke steps (run after the example world exists) ---------------- */
  const res = { tree: 'did not run', scriv: 'did not run', focus: 'did not run', views: 'did not run', compile: 'did not run' };
  const until = async (fn, ms = 4000) => { const t0 = Date.now(); while (Date.now() - t0 < ms) { const v = fn(); if (v) return v; await WB.wait(60); } return fn(); };
  WB.smoke('write-tree', async () => {
    const tr = await WB.api('write.tree', WB.worldId);
    const story = tr.nodes.find(n => n.kind === 'story');
    if (!story) return (res.tree = 'error: the example world has no story');
    await WB.go('write', { entryId: story.id, mode: 'write' });
    await until(() => room && document.querySelectorAll('.wbw-node').length >= 3);
    const rows = document.querySelectorAll('.wbw-node').length;
    res.tree = rows >= 3 ? 'ok: ' + rows + ' rows' : 'error: the binder shows ' + rows + ' rows';
    return res.tree;
  });
  WB.smoke('write-scrivenings', async () => {
    const tr = await WB.api('write.tree', WB.worldId);
    const ch = tr.nodes.filter(n => n.kind === 'chapter').find(c => tr.nodes.filter(s => s.parentId === c.id && s.kind === 'scene').length >= 2) || tr.nodes.find(n => n.kind === 'chapter');
    if (!ch) return (res.scriv = 'error: no chapter');
    await WB.go('write', { entryId: ch.id, mode: 'write' });
    if (room) { room.setPref('scriv', true); room.renderMain(); }
    const n = await until(() => document.querySelectorAll('.wbw-scriv .wb-editor').length);
    res.scriv = n >= 2 ? 'ok: ' + n + ' scenes as one text' : 'error: scrivenings shows ' + n + ' editors';
    return res.scriv;
  });
  WB.smoke('write-focus', async () => {
    const tr = await WB.api('write.tree', WB.worldId);
    const sc = tr.nodes.find(n => n.kind === 'scene' && n.words > 20) || tr.nodes.find(n => n.kind === 'scene');
    await WB.go('write', { entryId: sc && sc.id, mode: 'write', focus: true });
    const ok = await until(() => document.documentElement.classList.contains('wb-focus') && document.querySelector('.wbw-focusbar'));
    res.focus = ok ? 'ok' : 'error: focus mode did not open';
    return res.focus;
  });
  WB.smoke('write-views', async () => {
    await WB.go('write', { mode: 'cork' });
    const cards = await until(() => document.querySelectorAll('.wbw-card').length);
    room && room.setMode('outline');
    const rows = await until(() => document.querySelectorAll('.wbw-orow').length);
    room && room.setMode('grid');
    const grid = await until(() => document.querySelectorAll('.wbw-g-row').length);
    room && room.setMode('stats');
    const bars = await until(() => document.querySelectorAll('.wbw-chart-col').length);
    res.views = cards && rows && grid && bars ? 'ok: ' + cards + ' cards, ' + rows + ' outline rows, ' + grid + ' grid rows, ' + bars + ' days' : 'error: cards ' + cards + ', rows ' + rows + ', grid ' + grid + ', chart ' + bars;
    const st = room && room.story();
    if (st) {
      const c = await WB.api('write.compile', st.id, { format: 'html' }).catch(e => ({ error: e.message }));
      res.compile = c && /<section class="chapter"/.test(c.text || '') ? 'ok' : 'error: compile ' + JSON.stringify(c).slice(0, 120);
    }
    return res.views;
  });
  WB.check('write: the binder lists the manuscript', () => { if (!/^ok/.test(res.tree)) throw new Error(res.tree); return true; });
  WB.check('write: scrivenings shows a chapter as one text', () => { if (!/^ok/.test(res.scriv)) throw new Error(res.scriv); return true; });
  WB.check('write: focus mode opens', () => { if (!/^ok/.test(res.focus)) throw new Error(res.focus); return true; });
  WB.check('write: corkboard, outline, grid and stats render', () => { if (!/^ok/.test(res.views)) throw new Error(res.views); return true; });
  WB.check('write: compile produces a book', () => { if (!/^ok/.test(res.compile)) throw new Error(res.compile); return true; });
})();
