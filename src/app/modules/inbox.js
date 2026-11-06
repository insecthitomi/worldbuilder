/* Inbox: sort captured ideas and voice memos (convert, add to an entry, make a task, file, delete), and the task list
   (overdue / today / upcoming / someday / done) with quick add in plain words and "gaps to fill" suggestions. */
(function () {
  'use strict';
  const { h, ui } = GK;
  const WHEN = 'src/app/modules/inbox/when.js', KIT = 'src/app/modules/library/media-kit.js', VOICE = 'src/app/modules/inbox/voice.js';
  const PRIO = [[0, 'No priority', ''], [1, 'Low', '!'], [2, 'Medium', '!!'], [3, 'High', '!!!']];
  let live = null;

  /* voice memos are reachable from anywhere (quick capture shows a button when this exists) */
  WB.voice = { record: (opts) => WB.loadScript(VOICE).then(() => window.WBVoice.open(opts || {})) };

  /* ---------------- the count on the navigation button ---------------- */
  const badge = { n: 0, hot: false };
  const paintBadge = () => {
    const b = [...document.querySelectorAll('.gk-nav-btn')].find(x => x.title === 'Inbox');
    if (!b) return;
    if (badge.n) { b.dataset.wbBadge = badge.n > 99 ? '99+' : String(badge.n); b.classList.toggle('wb-badge-hot', badge.hot); }
    else { delete b.dataset.wbBadge; b.classList.remove('wb-badge-hot'); }
  };
  const countBadge = WB.debounce(async () => {
    if (!WB.worldId) { badge.n = 0; paintBadge(); return; }
    try {
      const [c, t] = await Promise.all([WB.api('inbox.counts', WB.worldId), WB.api('tasks.counts', WB.worldId)]);
      badge.n = (WB.share ? 0 : c.inbox) + t.overdue + t.today; badge.hot = t.overdue > 0;
    } catch { badge.n = 0; }
    paintBadge();
  }, 250);
  GK.bus.on('navigate', () => { paintBadge(); if (!badge.started) { badge.started = true; countBadge(); } });
  GK.bus.on('modules', () => setTimeout(paintBadge, 0));
  WB.onChange(['entries', 'tasks'], () => countBadge(), 400);
  WB.on('world', () => countBadge());
  WB.on('share', () => countBadge());

  GK.modules.register({
    id: 'inbox',
    title: 'Inbox',
    icon: '✉',
    order: 100,
    subtitle: 'Captured ideas, voice memos and tasks.',
    async mount(page, ctx) {
      if (!WB.worldId) {
        page.appendChild(WB.ui.empty({ icon: '✉', title: 'No world open', text: 'The Inbox collects quick ideas, voice memos and to-dos for a world. Create or open one first.', actions: [ui.button({ label: 'Create a world', kind: 'primary', onClick: () => WB.newWorld() })] }));
        return;
      }
      await Promise.all([WB.loadScript(WHEN), WB.loadScript(KIT)]);
      const W = window.WBWhen, K = window.WBMediaKit, RO = WB.share;
      page.classList.add('ib-page');
      const store = await WB.store(ctx, { view: 'captures', filter: 'all', sort: 'new', showDone: false });
      const params = WB.params('inbox') || {};
      const want = params.view || (params.tab === 'tasks' || params.tab === 'captures' ? params.tab : params.tab === 'inbox' ? 'captures' : null);
      if (want) store.patch({ view: want });
      if (params.entryId) store.patch({ view: 'captures' });
      const S = { items: [], full: new Map(), cur: params.entryId || null, checked: new Set(), anchor: null, tasks: [], gaps: null, alive: true, editor: null, triageFor: null, qaEntry: null, flash: null, editing: null };

      const top = h('div.ib-top'), body = h('div.ib-body');
      page.append(top, body);

      /* ================= data ================= */
      async function loadCaptures() {
        const list = await WB.api('entries.list', WB.worldId, { inbox: true, sort: 'created' });
        const vis = list.filter(e => WB.visible(e));
        const full = await Promise.all(vis.slice(0, 300).map(e => (S.full.has(e.id) && S.full.get(e.id).updatedAt === e.updatedAt ? S.full.get(e.id) : WB.api('entries.get', e.id).catch(() => null))));
        if (!S.alive) return;
        S.full = new Map(full.filter(Boolean).map(e => [e.id, e]));
        S.items = vis;
        for (const id of [...S.checked]) if (!vis.some(e => e.id === id)) S.checked.delete(id);
      }
      async function loadTasks() {
        const list = await WB.api('tasks.list', WB.worldId, {});
        if (!S.alive) return;
        S.tasks = list.filter(t => !t.entryId || !WB.share || WB.visible(WB.liteOf(t.entryId) || {}));
      }
      async function loadGaps() {
        if (RO) { S.gaps = null; return; }
        S.gaps = await WB.api('inbox.gaps', WB.worldId).catch(() => null);
      }
      const isVoice = e => { const f = S.full.get(e.id); return !!(f && f.fields && f.fields.audio); };
      function shown() {
        const f = store.get().filter, sort = store.get().sort;
        const list = S.items.filter(e => f === 'all' || (f === 'voice' ? isVoice(e) : !isVoice(e)));
        list.sort((a, b) => (sort === 'old' ? a.createdAt.localeCompare(b.createdAt) : b.createdAt.localeCompare(a.createdAt)));
        return list;
      }

      /* ================= top bar ================= */
      function paintTop() {
        GK.clear(top);
        const v = store.get().view;
        const open = S.tasks.filter(t => !t.done), overdue = open.filter(t => W.bucket(t.due) === 'overdue').length, today = open.filter(t => W.bucket(t.due) === 'today').length;
        const seg = ui.segmented({ value: v, options: [['captures', 'Captures'], ['tasks', 'Tasks']], onChange: setView });
        seg.classList.add('ib-tabs');
        const [b1, b2] = seg.querySelectorAll('button');
        b1.replaceChildren(...[h('span.ib-tab-ico', { text: '✉' }), 'Captures', S.items.length ? h('span.ib-count', { text: String(S.items.length) }) : null].filter(Boolean));
        b1.title = 'Ideas and voice memos waiting to be sorted';
        b2.replaceChildren(...[h('span.ib-tab-ico', { text: '☑' }), 'Tasks', open.length ? h('span.ib-count', { text: String(open.length) }) : null, overdue ? h('span.ib-count.bad', { text: overdue + ' overdue' }) : today ? h('span.ib-count.warm', { text: today + ' today' }) : null].filter(Boolean));
        b2.title = 'Your to-do list';
        GK.append(top, [seg, h('span.gk-grow'),
          RO ? WB.ui.badge('Share view: read-only', 'warn') : null,
          RO ? null : ui.button({ label: 'Voice memo', icon: '●', title: 'Record a voice memo (R)', onClick: () => recordHere() }),
          RO ? null : ui.button({ label: 'Capture', icon: '✚', kind: v === 'captures' ? 'primary' : '', title: 'Quick capture (Ctrl+Shift+N)', onClick: () => WB.capture() }),
        ]);
      }
      async function recordHere() {
        const e = await WB.voice.record();
        if (e && S.alive) { S.cur = e.id; if (store.get().view !== 'captures') store.patch({ view: 'captures' }); await refresh(); paintAll(); }
      }
      function setView(v) { store.patch({ view: v }); paintAll(); }
      function paintAll() { paintTop(); if (store.get().view === 'tasks') paintTasks(); else paintCaptures(); }

      /* ================= captures ================= */
      const listBox = h('div.ib-list', { role: 'listbox', 'aria-label': 'Captures' });
      const triage = h('div.ib-triage');
      const bulk = h('div.ib-bulk.gk-dialog', { hidden: true });
      function paintCaptures() {
        if (S.editor) { S.editor.destroy(); S.editor = null; }
        S.triageFor = null;
        GK.clear(body);
        if (!S.items.length) {
          body.appendChild(ui.panel({ cls: 'ib-zero', body: [WB.ui.empty({ icon: '✓', title: 'Inbox zero', text: 'Nothing is waiting. Catch ideas the moment they arrive — Ctrl+Shift+N from anywhere — or record a voice memo. They wait here until you decide what they are.',
            actions: RO ? [] : [ui.button({ label: 'Capture an idea', icon: '✚', kind: 'primary', onClick: () => WB.capture() }), ui.button({ label: 'Record a voice memo', icon: '●', onClick: () => WB.voice.record() }), ui.button({ label: 'See tasks', icon: '☑', onClick: () => setView('tasks') })] })] }));
          return;
        }
        const head = h('div.ib-list-head');
        const keys = h('div.ib-keys.gk-small.gk-faint', [WB.ui.kbd('↑↓'), ' move ', WB.ui.kbd('C'), ' convert ', WB.ui.kbd('A'), ' add to ', WB.ui.kbd('T'), ' task ', WB.ui.kbd('F'), ' file ', WB.ui.kbd('Del'), ' delete ', WB.ui.kbd('X'), ' select']);
        body.appendChild(h('div.ib-cols', [ui.panel({ cls: 'ib-listp', body: [head, listBox, RO ? null : keys] }), triage]));
        body.appendChild(bulk);
        paintList();
        paintTriage();
      }
      function snippet(e) {
        const f = S.full.get(e.id);
        if (!f) return '';
        const txt = WB.text.text(WB.strip(f.body || '')).replace(/\s+/g, ' ').trim();
        if (f.fields && f.fields.audio) return '♪ Voice memo' + (f.fields.transcript ? ' · ' + f.fields.transcript : txt ? ' · ' + txt : '');
        return txt || (e.summary || 'No more text');
      }
      function paintHead() {
        const head = body.querySelector('.ib-list-head');
        if (!head) return;
        const f = store.get().filter, list = shown();
        const nVoice = S.items.filter(isVoice).length;
        const on = list.length && list.every(e => S.checked.has(e.id)), some = !on && list.some(e => S.checked.has(e.id));
        const allCb = h('button.ib-cb', { type: 'button', role: 'checkbox', class: on ? 'on' : some ? 'some' : '', 'aria-checked': String(!!on), title: 'Select all (Ctrl+A)', 'aria-label': 'Select all', onclick: () => { const ids = shown().map(e => e.id); if (ids.every(id => S.checked.has(id))) S.checked.clear(); else ids.forEach(id => S.checked.add(id)); paintList(); } });
        head.replaceChildren(...[RO ? null : allCb, h('div.gk-grow', [h('b', { text: S.checked.size ? S.checked.size + ' of ' + S.items.length + ' selected' : WB.fmt.plural(S.items.length, 'capture') + ' waiting' })]),
          nVoice ? ui.segmented({ value: f, options: [['all', 'All'], ['voice', '♪ Voice ' + nVoice], ['text', 'Text']], onChange: v => { store.patch({ filter: v }); paintList(); } }) : null,
          ui.button({ icon: store.get().sort === 'old' ? '↑' : '↓', small: true, kind: 'ghost', title: store.get().sort === 'old' ? 'Oldest first' : 'Newest first', onClick: () => { store.patch({ sort: store.get().sort === 'old' ? 'new' : 'old' }); paintList(); } })].filter(Boolean));
      }
      function paintList() {
        paintHead();
        GK.clear(listBox);
        const list = shown();
        if (!list.length) listBox.appendChild(h('div.ib-none.gk-small.gk-muted', { text: 'Nothing here with this filter.' }));
        if (!S.cur || !list.some(e => e.id === S.cur)) S.cur = list[0] ? list[0].id : null;
        for (const e of list) {
          const t = WB.typeOf(e);
          const trailing = h('div.ib-trail', [h('span.gk-tiny.gk-faint', { text: WB.fmt.rel(e.createdAt) }), t && t.key !== 'note' ? WB.ui.typeBadge(t) : null]);
          const row = WB.ui.row(e, {
            active: e.id === S.cur, sub: snippet(e), trailing, draggable: true,
            onClick: (x, ev) => {
              if (ev.ctrlKey || ev.metaKey) return WB.peek(e.id);
              if (ev.shiftKey && S.anchor && !RO) { const ids = list.map(y => y.id), a = ids.indexOf(S.anchor), b = ids.indexOf(e.id); ids.slice(Math.min(a, b), Math.max(a, b) + 1).forEach(id => S.checked.add(id)); paintList(); return; }
              setCur(e.id);
            },
            onDblClick: () => WB.open(e.id),
            menuExtra: RO ? [] : ['-', { label: 'Convert to…', icon: '⇄', kbd: 'C', sub: typeItems(ty => act('convert', [e.id], ty)) }, { label: 'Add to an entry…', icon: '⤞', kbd: 'A', onClick: () => act('attach', [e.id]) },
              { label: 'Make a task', icon: '☑', kbd: 'T', onClick: () => act('task', [e.id]) }, { label: 'File it (leave the Inbox)', icon: '✓', kbd: 'F', onClick: () => act('file', [e.id]) }],
          });
          row.classList.add('ib-row');
          if (isVoice(e)) { row.classList.add('voice'); const ico = row.querySelector('.wb-row-ico'); if (ico) ico.textContent = '♪'; }
          row.setAttribute('role', 'option');
          row.setAttribute('aria-selected', String(e.id === S.cur));
          if (!RO) {
            const cb = h('button.ib-cb', { type: 'button', role: 'checkbox', 'aria-checked': String(S.checked.has(e.id)), title: 'Select (X)', 'aria-label': 'Select', class: S.checked.has(e.id) ? 'on' : '', onclick: ev => { ev.stopPropagation(); toggleCheck(e.id); } });
            row.insertBefore(cb, row.firstChild);
          }
          row.classList.toggle('checked', S.checked.has(e.id));
          listBox.appendChild(row);
        }
        paintBulk();
      }
      function toggleCheck(id) { if (S.checked.has(id)) S.checked.delete(id); else S.checked.add(id); S.anchor = id; paintList(); }
      function setCur(id, focus = true) {
        S.cur = id;
        for (const r of listBox.querySelectorAll('.wb-row')) { const on = r.dataset.id === id; r.classList.toggle('on', on); r.setAttribute('aria-selected', String(on)); if (on && focus) { r.focus({ preventScroll: true }); r.scrollIntoView({ block: 'nearest' }); } }
        S.anchor = id;
        paintTriage();
      }
      const typeItems = fn => WB.typeList().map(t => ({ label: t.name, icon: t.icon, onClick: () => fn(t) }));

      /* ----- the triage pane ----- */
      function paintTriage(force) {
        const e = S.cur && S.full.get(S.cur);
        if (!force && S.triageFor === S.cur && e && triage.contains(document.activeElement)) return;
        if (S.editor) { S.editor.destroy(); S.editor = null; }
        GK.clear(triage);
        S.triageFor = S.cur;
        if (!e) { triage.appendChild(ui.panel({ cls: 'ib-tri', body: [WB.ui.empty({ icon: '✉', title: 'Pick a capture', text: 'Choose one on the left to read it and decide what it becomes.' })] })); return; }
        const t = WB.typeOf(e);
        const title = ui.input({ value: e.title, placeholder: 'Title' });
        title.classList.add('ib-title');
        title.disabled = RO;
        const saveTitle = WB.debounce(v => save(e, { title: v.trim() || e.title }), 500);
        title.addEventListener('input', () => saveTitle(title.value));
        title.addEventListener('keydown', ev => { if (ev.key === 'Enter') { ev.preventDefault(); saveTitle.flush(title.value); S.editor && S.editor.focus(true); } if (ev.key === 'Escape') title.blur(); });
        const audio = e.fields && e.fields.audio;
        let voice = null;
        if (audio) {
          const tr = ui.input({ multiline: true, rows: 3, value: e.fields.transcript || '', placeholder: 'Transcript: type what the memo says so it can be searched and turned into text.' });
          tr.disabled = RO;
          const saveTr = WB.debounce(v => save(e, { fieldsPatch: { transcript: v } }), 600);
          tr.addEventListener('input', () => saveTr(tr.value));
          tr.addEventListener('blur', () => saveTr.flush(tr.value));
          voice = h('div.ib-voice', [
            h('div.ib-voice-top', [h('span.ib-voice-ico', { text: '♪' }), h('div.gk-grow', [K.player(audio)]), ui.button({ icon: '▣', small: true, kind: 'ghost', title: 'Show the recording in the Library', onClick: () => WB.go('library', { mediaId: audio }) })]),
            ui.field({ label: 'Transcript', control: tr }),
            RO ? null : ui.button({ label: 'Copy the transcript into the text', icon: '⤓', small: true, kind: 'ghost', onClick: () => { if (!tr.value.trim()) return ui.toast('Type the transcript first', 'ℹ'); S.editor && S.editor.insert(WB.text.fromText(tr.value)); } }),
          ]);
        }
        S.editor = WB.editor.create({ value: e.body || '', placeholder: 'Add detail, or type @ to link an entry…', onChange: html => save(e, { body: html }), readOnly: RO });
        S.editor.el.classList.add('ib-editor');
        const mentions = [...new Set(WB.text.mentions(e.body || ''))].filter(id => WB.liteOf(id) && WB.visible(WB.liteOf(id)));
        const A = (label, icon, k, fn, o = {}) => { const b = ui.button(Object.assign({ label, icon, small: true, title: label + ' (' + k + ')', onClick: fn }, o)); b.appendChild(h('span.ib-k', { text: k })); return b; };
        const actions = RO ? null : h('div.ib-actions', [
          A('Convert to…', '⇄', 'C', ev => WB.ui.menu(typeItems(ty => act('convert', [e.id], ty)), ev.currentTarget), { kind: 'primary' }),
          A('Add to an entry…', '⤞', 'A', () => act('attach', [e.id])),
          A('Make a task', '☑', 'T', ev => taskMenu([e.id], ev.currentTarget)),
          A('File it', '✓', 'F', () => act('file', [e.id]), { title: 'Keep it as it is and take it out of the Inbox (F)' }),
          h('span.gk-grow'),
          ui.button({ label: 'Open', icon: '↗', small: true, kind: 'ghost', title: 'Open in the Codex (O)', onClick: () => WB.open(e.id) }),
          ui.button({ icon: '🗑', small: true, kind: 'ghost', title: 'Delete (Del)', onClick: () => act('delete', [e.id]) }),
        ]);
        triage.appendChild(ui.panel({ cls: 'ib-tri', body: [
          h('div.ib-tri-head', [WB.ui.typeBadge(t), h('span.gk-small.gk-muted', { text: 'Captured ' + WB.fmt.rel(e.createdAt) + (e.updatedAt !== e.createdAt ? ' · edited ' + WB.fmt.rel(e.updatedAt) : '') }), h('span.gk-grow'),
            mentions.length ? h('div.wb-chips.ib-mentions', [h('span.gk-tiny.gk-muted', { text: 'Mentions' }), ...mentions.slice(0, 4).map(id => WB.ui.chip(id, { size: 'sm' }))]) : null]),
          title, voice, RO && !WB.text.text(e.body || '').trim() ? null : S.editor.el, actions,
        ] }));
      }
      async function save(e, patch) {
        try {
          const n = await WB.api('entries.update', e.id, patch);
          S.full.set(e.id, n);
          const i = S.items.findIndex(x => x.id === e.id);
          if (i >= 0) S.items[i] = Object.assign({}, S.items[i], { title: n.title, updatedAt: n.updatedAt });
          const row = listBox.querySelector('.wb-row[data-id="' + e.id + '"]');
          if (row) { const t = row.querySelector('.wb-row-title'); if (t) t.textContent = n.title; const s = row.querySelector('.wb-row-sub'); if (s) s.textContent = snippet(n); }
        } catch (err) { WB.fail(err); }
      }

      /* ----- triage actions (one or many) ----- */
      const nextAfter = ids => { const list = shown().map(e => e.id); const i = list.indexOf(S.cur); if (!ids.includes(S.cur)) return S.cur; return list.slice(i + 1).find(x => !ids.includes(x)) || list.slice(0, i).reverse().find(x => !ids.includes(x)) || null; };
      function toast(text, undo, openId) {
        const t = WB.ui.undoToast(text, undo);
        if (openId) t.appendChild(ui.button({ label: 'Open', small: true, onClick: () => { t.remove(); WB.open(openId); } }));
        return t;
      }
      const name = ids => (ids.length === 1 ? '“' + ((S.full.get(ids[0]) || {}).title || 'Capture') + '”' : ids.length + ' captures');
      async function act(kind, ids, arg) {
        if (RO || !ids.length) return;
        const next = nextAfter(ids);
        const before = ids.map(id => S.full.get(id)).filter(Boolean);
        try {
          if (kind === 'convert') {
            const type = arg;
            for (const e of before) {
              const patch = { typeId: type.id, inbox: false };
              if (e.fields.transcript && !WB.text.text(e.body || '').trim()) patch.body = WB.text.fromText(e.fields.transcript);
              await WB.api('entries.update', e.id, patch);
            }
            toast(name(ids) + (ids.length === 1 ? ' is now a ' : ' are now ') + (ids.length === 1 ? type.name.toLowerCase() : type.plural.toLowerCase()), async () => { for (const e of before) await WB.api('entries.update', e.id, { typeId: e.typeId, inbox: true, body: e.body }); }, ids.length === 1 ? ids[0] : null);
          } else if (kind === 'file') {
            for (const e of before) await WB.api('entries.update', e.id, { inbox: false });
            toast(name(ids) + ' filed — find ' + (ids.length === 1 ? 'it' : 'them') + ' in the Codex', async () => { for (const e of before) await WB.api('entries.update', e.id, { inbox: true }); }, ids.length === 1 ? ids[0] : null);
          } else if (kind === 'delete') {
            if (GK.settings.get('wbConfirmDelete') && !(await ui.confirm('Move to trash?', name(ids) + ' move to the trash.', 'Move to trash', true))) return;
            for (const e of before) await WB.api('entries.trash', e.id);
            toast(name(ids) + ' moved to the trash', async () => { for (const e of before) await WB.api('entries.restore', e.id); });
          } else if (kind === 'task') {
            const made = [];
            for (const e of before) {
              const text = [e.fields.transcript || '', WB.text.text(e.body || '')].filter(x => x && x.trim()).join('\n\n').trim();
              const about = WB.text.mentions(e.body || '').find(id => WB.liteOf(id));
              made.push(await WB.api('tasks.save', { worldId: WB.worldId, title: e.title, notes: text.slice(0, 4000), due: arg || null, entryId: about || null }));
              // a voice memo keeps its recording: it is filed, not deleted
              if (e.fields.audio) await WB.api('entries.update', e.id, { inbox: false }); else await WB.api('entries.trash', e.id);
            }
            const t = toast((ids.length === 1 ? 'Task added: ' + name(ids) : ids.length + ' tasks added') + (arg ? ' · due ' + W.describe(arg).toLowerCase() : ''), async () => {
              for (const x of made) await WB.api('tasks.remove', x.id);
              for (const e of before) { if (e.fields.audio) await WB.api('entries.update', e.id, { inbox: true }); else await WB.api('entries.restore', e.id); }
            });
            t.appendChild(ui.button({ label: 'See tasks', small: true, onClick: () => { t.remove(); setView('tasks'); } }));
          } else if (kind === 'attach') {
            const target = await WB.ui.pickEntry({ title: 'Add ' + name(ids) + ' to…', exclude: ids });
            if (!target) return;
            const how = await ui.dialog({ title: 'Add to “' + target.title + '”', icon: '⤞', body: h('div.ib-how', [
              h('p.gk-text', { text: 'Add its text: the words go into “' + target.title + '” under a heading, and the capture leaves the Inbox.' }),
              h('p.gk-text', { text: 'Link them: both stay as they are, related to each other.' }),
            ]), actions: [{ label: 'Cancel', value: null }, { label: 'Link them', value: 'link' }, { label: 'Add its text', kind: 'primary', value: 'merge' }] });
            if (!how) return;
            if (how === 'merge') {
              const tgt = await WB.api('entries.get', target.id);
              let add = '';
              for (const c of before) {
                add += '<h3>' + WB.esc(c.title) + '</h3>' + (c.body || '') + (c.fields.transcript ? WB.text.fromText(c.fields.transcript) : '');
                if (c.fields.audio) add += '<p>Recording: <a class="wb-m" data-id="' + c.id + '">' + WB.esc(c.title) + '</a></p>';
              }
              await WB.api('entries.update', target.id, { body: (tgt.body || '') + add, snapshot: 'before adding from the Inbox' });
              for (const c of before) { if (c.fields.audio) await WB.api('entries.update', c.id, { inbox: false }); else await WB.api('entries.trash', c.id); }
              toast('Added to “' + target.title + '”', async () => {
                await WB.api('entries.update', target.id, { body: tgt.body || '' });
                for (const c of before) { if (c.fields.audio) await WB.api('entries.update', c.id, { inbox: true }); else await WB.api('entries.restore', c.id); }
              }, target.id);
            } else {
              const rel = WB.relByName('related to') || WB.relTypes[WB.relTypes.length - 1];
              if (!rel) throw new Error('This world has no relation types to link with.');
              const links = [];
              for (const c of before) { links.push(await WB.api('links.relate', { src: c.id, dst: target.id, relId: rel.id })); await WB.api('entries.update', c.id, { inbox: false }); }
              toast(name(ids) + ' linked to “' + target.title + '” and filed', async () => { for (const l of links) await WB.api('links.remove', l.id); for (const c of before) await WB.api('entries.update', c.id, { inbox: true }); }, ids.length === 1 ? ids[0] : null);
            }
          }
          ids.forEach(id => S.checked.delete(id));
          S.cur = next;
          await refresh();
        } catch (err) { WB.fail(err); }
      }
      function taskMenu(ids, at) {
        const d = n => W.iso(W.addDays(new Date(), n));
        const wk = W.iso(W.nextWeekday(new Date(), 1)), we = W.iso(W.nextWeekday(new Date(), 6, true));
        WB.ui.menu([{ header: 'Make a task, due…' },
          { label: 'Today', icon: '◉', onClick: () => act('task', ids, d(0)) }, { label: 'Tomorrow', icon: '◔', onClick: () => act('task', ids, d(1)) },
          { label: 'This weekend', icon: '◑', hint: W.describe(we), onClick: () => act('task', ids, we) }, { label: 'Next week', icon: '◕', hint: W.describe(wk), onClick: () => act('task', ids, wk) },
          { label: 'Some day (no date)', icon: '◌', onClick: () => act('task', ids, null) }], at);
      }
      function paintBulk() {
        bulk.hidden = !S.checked.size || store.get().view !== 'captures';
        if (bulk.hidden) return;
        const ids = [...S.checked];
        GK.clear(bulk);
        bulk.append(h('b', { text: ids.length + ' selected' }),
          ui.button({ label: 'Convert to…', icon: '⇄', small: true, onClick: ev => WB.ui.menu(typeItems(ty => act('convert', ids, ty)), ev.currentTarget) }),
          ui.button({ label: 'Make tasks', icon: '☑', small: true, onClick: ev => taskMenu(ids, ev.currentTarget) }),
          ui.button({ label: 'Add to…', icon: '⤞', small: true, onClick: () => act('attach', ids) }),
          ui.button({ label: 'File', icon: '✓', small: true, onClick: () => act('file', ids) }),
          ui.button({ label: 'Delete', icon: '🗑', small: true, kind: 'danger', onClick: () => act('delete', ids) }),
          ui.button({ icon: '✕', small: true, kind: 'ghost', title: 'Clear the selection (Esc)', onClick: () => { S.checked.clear(); paintList(); } }));
      }

      /* ================= tasks ================= */
      const qa = ui.input({ placeholder: 'Add a task — “Map the salt flats fri !!”, “Reply to Ana in 3 days”, “Name the moons someday”' });
      qa.classList.add('tk-qa-input');
      const qaPrev = h('div.tk-preview');
      function parseQA() {
        const p = W.parse(qa.value);
        let title = p.title, entryId = S.qaEntry;
        const m = /(?:^|\s)@([^\s@][^@]*)$/.exec(title) || /(?:^|\s)@(\S+(?:\s\S+){0,3})/.exec(title);
        if (m && !entryId) {
          const words = m[1].trim().split(/\s+/);
          for (let k = Math.min(4, words.length); k >= 1 && !entryId; k--) {
            const q = words.slice(0, k).join(' ').toLowerCase();
            const hit = WB.titles.find(t => t.title.toLowerCase() === q) || WB.titles.find(t => t.title.toLowerCase().startsWith(q) && q.length >= 2) || WB.titles.find(t => (t.aliases || []).some(a => a.toLowerCase() === q));
            if (hit && WB.visible(hit)) { entryId = hit.id; title = (title.slice(0, m.index) + ' ' + title.slice(m.index + m[0].length).replace(new RegExp('^\\s*@?' + words.slice(0, k).join(' ').replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'i'), '')).replace(/\s{2,}/g, ' ').trim(); }
          }
        }
        return Object.assign(p, { title, entryId });
      }
      function paintQA() {
        const p = parseQA();
        GK.clear(qaPrev);
        const bits = [];
        if (p.due) bits.push(h('span.tk-pv.due', { class: W.bucket(p.due) }, ['▦ ', W.describe(p.due), h('span.gk-faint', { text: ' · ' + WB.fmt.real(p.due) })]));
        if (p.someday) bits.push(h('span.tk-pv', { text: '◌ Some day' }));
        if (p.priority) bits.push(h('span.tk-pv.prio', { class: 'p' + p.priority, text: '⚑ ' + PRIO[p.priority][1] }));
        if (p.entryId) bits.push(WB.ui.chip(p.entryId, { size: 'sm', onRemove: () => { S.qaEntry = null; qa.value = qa.value.replace(/(?:^|\s)@\S+/, ''); paintQA(); } }));
        if (qa.value.trim() && p.title) bits.unshift(h('span.tk-pv.title.gk-ellipsis', { text: p.title }));
        if (!qa.value.trim()) bits.push(h('span.gk-faint', { text: 'Dates in plain words: today, tomorrow, fri, next week, in 3 days, nov 20 · priority: ! !! !!! · @Name links an entry' }));
        GK.append(qaPrev, bits);
      }
      qa.addEventListener('input', paintQA);
      qa.addEventListener('keydown', e => { if (e.key === 'Enter') { e.preventDefault(); addTask(); } else if (e.key === 'Escape' && qa.value) { e.stopPropagation(); qa.value = ''; S.qaEntry = null; paintQA(); } });
      async function addTask() {
        const p = parseQA();
        if (!p.title) { qa.focus(); return; }
        try {
          const t = await WB.api('tasks.save', { worldId: WB.worldId, title: p.title, due: p.due, priority: p.priority, entryId: p.entryId || null });
          qa.value = ''; S.qaEntry = null; paintQA();
          S.flash = t.id;
          await refresh();
          qa.focus();
        } catch (e) { WB.fail(e); }
      }
      const groupsBox = h('div.tk-groups');
      const gapsBox = h('div.ib-gaps');
      function paintTasks() {
        if (S.editor) { S.editor.destroy(); S.editor = null; }
        GK.clear(body);
        const linkBtn = ui.button({ icon: '↗', small: true, kind: 'ghost', title: 'Link the new task to an entry', onClick: async () => { const e = await WB.ui.pickEntry({ title: 'Link the task to…' }); if (e) { S.qaEntry = e.id; paintQA(); qa.focus(); } } });
        const add = RO ? null : h('div.tk-qa', [h('div.tk-qa-row', [h('span.tk-qa-plus', { text: '＋' }), qa, linkBtn, ui.button({ label: 'Add', kind: 'primary', small: true, onClick: addTask })]), qaPrev]);
        paintQA();
        const main = ui.panel({ cls: 'tk-main', body: [add, groupsBox] });
        body.appendChild(h('div.ib-cols.tasks', [main, RO ? null : gapsBox].filter(Boolean)));
        paintGroups();
        paintGaps();
      }
      function groupsOf() {
        const open = S.tasks.filter(t => !t.done);
        const g = { overdue: [], today: [], upcoming: [], someday: [] };
        for (const t of open) g[W.bucket(t.due)].push(t);
        const pos = (a, b) => a.position - b.position || a.createdAt.localeCompare(b.createdAt);
        g.overdue.sort((a, b) => a.due.localeCompare(b.due) || pos(a, b));
        g.today.sort(pos); g.someday.sort(pos);
        g.upcoming.sort((a, b) => a.due.localeCompare(b.due) || pos(a, b));
        const done = S.tasks.filter(t => t.done).sort((a, b) => String(b.doneAt).localeCompare(String(a.doneAt)));
        return { g, done };
      }
      const GROUPS = [['overdue', 'Overdue', '⚠'], ['today', 'Today', '◉'], ['upcoming', 'Upcoming', '◔'], ['someday', 'Some day', '◌']];
      function paintGroups() {
        GK.clear(groupsBox);
        const { g, done } = groupsOf();
        const total = GROUPS.reduce((a, [k]) => a + g[k].length, 0);
        if (!total && !done.length) {
          groupsBox.appendChild(WB.ui.empty({ icon: '☑', title: 'No tasks yet', text: 'Write one above in plain words — “Draft chapter two by fri !!” sets the date and priority for you. Tasks can link to any entry, and every entry shows its own tasks.' }));
          return;
        }
        for (const [k, label, icon] of GROUPS) {
          const list = g[k];
          if (!list.length && k !== 'today') continue;
          if (!list.length && k === 'today' && (g.overdue.length || !total)) continue;
          const sec = h('section.tk-group', { dataset: { group: k } }, [
            h('div.tk-ghead', { class: k }, [h('span.tk-gico', { text: icon }), h('h4', { text: label }), h('span.tk-gcount', { text: String(list.length) }), h('span.gk-grow'),
              k === 'today' ? h('span.gk-tiny.gk-faint', { text: new Date().toLocaleDateString(undefined, { weekday: 'long', day: 'numeric', month: 'long' }) }) : null,
              list.length > 1 && !RO && k !== 'upcoming' ? ui.button({ label: 'By priority', small: true, kind: 'ghost', title: 'Sort this group by priority (manual order otherwise)', onClick: () => sortByPriority(list) }) : null]),
          ]);
          const box = h('div.tk-list', { dataset: { group: k } });
          if (!list.length) box.appendChild(h('div.tk-empty.gk-small.gk-muted', { text: 'Nothing due today.' }));
          let lastDue = null;
          for (const t of list) {
            if (k === 'upcoming' && t.due !== lastDue) { box.appendChild(h('div.tk-date', { text: W.describe(t.due) + (W.diffDays(W.fromIso(t.due), new Date()) > 6 ? '' : ' · ' + WB.fmt.real(t.due)) })); lastDue = t.due; }
            box.appendChild(taskRow(t));
          }
          sec.appendChild(box);
          groupsBox.appendChild(sec);
        }
        if (done.length) {
          const show = store.get().showDone;
          const sec = h('section.tk-group.done', [h('div.tk-ghead.done', [
            h('button.tk-toggle', { type: 'button', 'aria-expanded': String(show), onclick: () => { store.patch({ showDone: !show }); paintGroups(); } }, [h('span.tk-gico', { text: show ? '▾' : '▸' }), h('h4', { text: 'Done' }), h('span.tk-gcount', { text: String(done.length) })]),
            h('span.gk-grow'),
            show && !RO ? ui.button({ label: 'Clear done', small: true, kind: 'ghost', title: 'Delete every finished task', onClick: () => clearDone(done) }) : null])]);
          if (show) { const box = h('div.tk-list', { dataset: { group: 'done' } }); done.slice(0, 200).forEach(t => box.appendChild(taskRow(t))); sec.appendChild(box); }
          groupsBox.appendChild(sec);
        }
        if (S.flash) { const r = groupsBox.querySelector('.tk-row[data-id="' + S.flash + '"]'); if (r) { r.classList.add('flash'); r.scrollIntoView({ block: 'nearest' }); } S.flash = null; }
      }
      function taskRow(t) {
        const b = W.bucket(t.due);
        const row = h('div.tk-row', { tabindex: 0, dataset: { id: t.id }, class: (t.done ? 'done ' : '') + 'p' + (t.priority || 0) });
        const check = h('button.tk-check', { type: 'button', role: 'checkbox', 'aria-checked': String(t.done), title: t.done ? 'Mark as not done (Space)' : 'Done (Space)', disabled: RO, onclick: ev => { ev.stopPropagation(); toggle(t, row); } }, [h('span', { text: '✓' })]);
        const titleEl = h('div.tk-title', { text: t.title, title: RO ? '' : 'Click to edit' });
        if (!RO) titleEl.addEventListener('click', () => editTitle(t, titleEl));
        const sub = h('div.tk-sub');
        if (t.entryId) { const lite = WB.liteOf(t.entryId); if (lite && WB.visible(lite)) sub.appendChild(WB.ui.chip(lite, { size: 'sm' })); }
        if (t.notes) sub.appendChild(h('button.tk-notes-btn', { type: 'button', title: 'Show the notes', text: '¶ ' + t.notes.split('\n')[0].slice(0, 80), onclick: () => toggleNotes(t, row) }));
        const prio = h('button.tk-prio', { type: 'button', title: 'Priority: ' + PRIO[t.priority || 0][1], disabled: RO, text: '⚑', onclick: ev => prioMenu(t, ev.currentTarget) });
        const due = h('button.tk-due', { type: 'button', class: t.done ? '' : b, disabled: RO, title: t.due ? WB.fmt.real(t.due) + ' (click to change)' : 'Set a due date', onclick: ev => duePop(t, ev.currentTarget) }, [t.due ? W.describe(t.due) : '＋ date']);
        const more = ui.button({ icon: '⋯', small: true, kind: 'ghost', title: 'More', onClick: ev => taskMenuMore(t, ev.currentTarget, row) });
        const grip = RO || t.done ? null : h('span.tk-grip', { title: 'Drag to reorder — or to another group to re-date it (Alt+↑↓)', text: '⋮⋮' });
        GK.append(row, [grip, check, h('div.tk-main', [titleEl, sub.childNodes.length ? sub : null]), prio, due, RO ? null : more]);
        if (grip) grip.addEventListener('pointerdown', ev => dragTask(ev, t, row));
        row.addEventListener('contextmenu', ev => { ev.preventDefault(); if (!RO) taskMenuMore(t, ev, row); });
        row.addEventListener('keydown', ev => taskKey(ev, t, row));
        return row;
      }
      async function saveTask(t, patch) {
        try {
          const n = await WB.api('tasks.save', Object.assign({ id: t.id, worldId: WB.worldId, title: t.title, notes: t.notes, due: t.due, priority: t.priority, entryId: t.entryId }, patch));
          Object.assign(t, n);
          await refresh();
        } catch (e) { WB.fail(e); }
      }
      async function toggle(t, row) {
        if (RO) return;
        const was = t.done;
        row.classList.add(was ? 'unchecking' : 'checking');
        try {
          await WB.api('tasks.toggle', t.id, !was);
          if (!was) { const ts = WB.ui.undoToast('Done: ' + t.title, () => WB.api('tasks.toggle', t.id, false)); void ts; }
          setTimeout(() => refresh(), 380);
        } catch (e) { WB.fail(e); }
      }
      function editTitle(t, el) {
        if (S.editing) return;
        S.editing = t.id;
        const inp = ui.input({ value: t.title });
        inp.classList.add('tk-title-input');
        el.replaceWith(inp);
        inp.focus(); inp.select();
        let done = false;
        const finish = async ok => {
          if (done) return; done = true; S.editing = null;
          const v = inp.value.trim();
          if (ok && v && v !== t.title) await saveTask(t, { title: v }); else { inp.replaceWith(el); }
        };
        inp.addEventListener('keydown', e => { if (e.key === 'Enter') { e.preventDefault(); finish(true); } else if (e.key === 'Escape') { e.preventDefault(); e.stopPropagation(); finish(false); } });
        inp.addEventListener('blur', () => finish(true));
      }
      function toggleNotes(t, row) {
        const open = row.nextElementSibling && row.nextElementSibling.classList.contains('tk-notes');
        if (open) { row.nextElementSibling.remove(); return; }
        const ta = ui.input({ multiline: true, rows: 3, value: t.notes || '', placeholder: 'Notes for this task…' });
        ta.disabled = RO;
        ta.addEventListener('change', () => saveTask(t, { notes: ta.value }));
        const box = h('div.tk-notes', [ta]);
        row.after(box);
        if (!RO) ta.focus();
      }
      function prioMenu(t, at) { WB.ui.menu(PRIO.map(([v, l, m]) => ({ label: l, icon: m ? '⚑' : '', checked: (t.priority || 0) === v, kbd: m, onClick: () => saveTask(t, { priority: v }) })), at); }
      function duePop(t, anchor) {
        const set = due => { pop.close(); saveTask(t, { due }); };
        const d = n => W.iso(W.addDays(new Date(), n));
        const txt = ui.input({ placeholder: 'or type: fri, in 3 days, nov 20…' });
        const date = ui.input({ type: 'date', value: t.due || '' });
        txt.addEventListener('keydown', e => { if (e.key === 'Enter') { const p = W.parse(txt.value); if (p.due || p.someday) set(p.due); else { txt.classList.add('bad'); txt.title = 'Try “tomorrow”, “fri”, “in 3 days” or “nov 20”'; } } });
        date.addEventListener('change', () => { if (date.value) set(date.value); });
        const B = (l, v, hint) => h('button.tk-dq', { type: 'button', title: hint || '', onclick: () => set(v) }, [h('b', { text: l }), hint ? h('span.gk-faint', { text: hint }) : null]);
        const pop = WB.ui.popover(anchor, h('div.tk-duepop', [
          B('Today', d(0), W.describe(d(0)) === 'Today' ? new Date().toLocaleDateString(undefined, { weekday: 'short' }) : ''), B('Tomorrow', d(1), new Date(Date.now() + 864e5).toLocaleDateString(undefined, { weekday: 'short' })),
          B('This weekend', W.iso(W.nextWeekday(new Date(), 6, true)), W.describe(W.iso(W.nextWeekday(new Date(), 6, true)))), B('Next week', W.iso(W.nextWeekday(new Date(), 1)), W.describe(W.iso(W.nextWeekday(new Date(), 1)))),
          B('In a month', W.iso(W.addMonths(new Date(), 1)), W.describe(W.iso(W.addMonths(new Date(), 1)))), B('No date', null, 'Some day'),
          txt, date,
        ]), { group: 'tkdue', width: '17em' });
        setTimeout(() => txt.focus(), 30);
      }
      function taskMenuMore(t, at, row) {
        WB.ui.menu([
          { label: t.done ? 'Mark as not done' : 'Mark as done', icon: '✓', kbd: 'Space', onClick: () => toggle(t, row) },
          { label: 'Edit title', icon: '✎', kbd: 'Enter', onClick: () => { const el = row.querySelector('.tk-title'); if (el) editTitle(t, el); } },
          { label: t.notes ? 'Notes' : 'Add notes', icon: '¶', onClick: () => toggleNotes(t, row) },
          { label: 'Due date…', icon: '▦', onClick: () => duePop(t, row.querySelector('.tk-due')) },
          { label: 'Priority', icon: '⚑', sub: PRIO.map(([v, l]) => ({ label: l, checked: (t.priority || 0) === v, onClick: () => saveTask(t, { priority: v }) })) },
          '-',
          { label: t.entryId ? 'Link to another entry…' : 'Link to an entry…', icon: '↗', onClick: async () => { const e = await WB.ui.pickEntry({ title: 'Link “' + t.title + '” to…' }); if (e) saveTask(t, { entryId: e.id }); } },
          t.entryId ? { label: 'Unlink the entry', icon: '⌫', onClick: () => saveTask(t, { entryId: null }) } : null,
          t.entryId ? { label: 'Open the entry', icon: '↗', onClick: () => WB.open(t.entryId) } : null,
          { label: 'Duplicate', icon: '⧉', onClick: async () => { await WB.api('tasks.save', { worldId: WB.worldId, title: t.title, notes: t.notes, due: t.due, priority: t.priority, entryId: t.entryId }); refresh(); } },
          '-',
          { label: 'Delete', icon: '🗑', kbd: 'Del', danger: true, onClick: () => removeTask(t) },
        ].filter(Boolean), at);
      }
      async function removeTask(t) {
        try {
          await WB.api('tasks.remove', t.id);
          WB.ui.undoToast('Deleted “' + t.title + '”', async () => { const n = await WB.api('tasks.save', { worldId: WB.worldId, title: t.title, notes: t.notes, due: t.due, priority: t.priority, entryId: t.entryId }); if (t.done) await WB.api('tasks.toggle', n.id, true); });
          await refresh();
        } catch (e) { WB.fail(e); }
      }
      async function clearDone(done) {
        if (done.length > 3 && !(await ui.confirm('Clear finished tasks?', WB.fmt.plural(done.length, 'finished task') + ' will be deleted.', 'Clear', true))) return;
        for (const t of done) await WB.api('tasks.remove', t.id).catch(() => { });
        WB.ui.undoToast(WB.fmt.plural(done.length, 'finished task') + ' cleared', async () => { for (const t of done) { const n = await WB.api('tasks.save', { worldId: WB.worldId, title: t.title, notes: t.notes, due: t.due, priority: t.priority, entryId: t.entryId }); await WB.api('tasks.toggle', n.id, true); } });
        await refresh();
      }
      async function sortByPriority(list) {
        const sorted = list.slice().sort((a, b) => (b.priority || 0) - (a.priority || 0) || a.position - b.position);
        await reorder(sorted.map(t => t.id));
      }
      /** writes positions so `ids` (a group's new order) slot into the overall open-task order */
      async function reorder(ids) {
        const open = groupsOf();
        const all = GROUPS.flatMap(([k]) => open.g[k].map(t => t.id)).filter(id => !ids.includes(id));
        const first = GROUPS.flatMap(([k]) => open.g[k].map(t => t.id)).findIndex(id => ids.includes(id));
        all.splice(Math.max(0, first), 0, ...ids);
        await WB.api('tasks.reorder', all).catch(WB.fail);
        await refresh();
      }
      function taskKey(ev, t, row) {
        if (ev.target !== row || RO) return;
        const rows = [...groupsBox.querySelectorAll('.tk-row')], i = rows.indexOf(row);
        if (ev.key === 'ArrowDown' && !ev.altKey) { ev.preventDefault(); (rows[i + 1] || row).focus(); }
        else if (ev.key === 'ArrowUp' && !ev.altKey) { ev.preventDefault(); (rows[i - 1] || qa).focus(); }
        else if (ev.key === ' ') { ev.preventDefault(); toggle(t, row); }
        else if (ev.key === 'Enter' || ev.key === 'F2') { ev.preventDefault(); const el = row.querySelector('.tk-title'); if (el) editTitle(t, el); }
        else if (ev.key === 'Delete') { ev.preventDefault(); const nx = rows[i + 1] || rows[i - 1]; removeTask(t).then(() => { const r = nx && groupsBox.querySelector('.tk-row[data-id="' + nx.dataset.id + '"]'); if (r) r.focus(); }); }
        else if (ev.altKey && (ev.key === 'ArrowUp' || ev.key === 'ArrowDown')) {
          ev.preventDefault();
          const box = row.parentElement, sibs = [...box.querySelectorAll('.tk-row')], j = sibs.indexOf(row), k = j + (ev.key === 'ArrowUp' ? -1 : 1);
          if (k < 0 || k >= sibs.length || box.dataset.group === 'done') return;
          const ids = sibs.map(r => r.dataset.id); [ids[j], ids[k]] = [ids[k], ids[j]];
          reorder(ids).then(() => { const r = groupsBox.querySelector('.tk-row[data-id="' + t.id + '"]'); if (r) r.focus(); });
        }
      }
      /** drag a task by its grip: reorder in its group, or drop into Today / Upcoming / Some day to re-date it */
      function dragTask(ev, t, row) {
        if (ev.button !== 0) return;
        ev.preventDefault();
        const grip = ev.currentTarget;
        grip.setPointerCapture(ev.pointerId);
        const from = row.parentElement.dataset.group;
        const y0 = ev.clientY;
        row.classList.add('dragging');
        let moved = false;
        const lists = [...groupsBox.querySelectorAll('.tk-list')].filter(l => l.dataset.group !== 'done' && (l.dataset.group !== 'overdue' || from === 'overdue'));
        const mv = e => {
          if (!moved && Math.abs(e.clientY - y0) < 4) return;
          moved = true;
          let target = null, before = null;
          for (const l of lists) {
            const r = l.getBoundingClientRect();
            if (e.clientY < r.top - 20 || e.clientY > r.bottom + 20) continue;
            target = l;
            for (const other of l.querySelectorAll('.tk-row:not(.dragging)')) { const rr = other.getBoundingClientRect(); if (e.clientY < rr.top + rr.height / 2) { before = other; break; } }
            break;
          }
          if (!target) return;
          if (before) target.insertBefore(row, before); else target.appendChild(row);
          const em = target.querySelector('.tk-empty'); if (em) em.remove();
        };
        const up = async () => {
          grip.removeEventListener('pointermove', mv); grip.removeEventListener('pointerup', up); grip.removeEventListener('pointercancel', up);
          row.classList.remove('dragging');
          if (!moved) return;
          const to = row.parentElement.dataset.group;
          const ids = [...row.parentElement.querySelectorAll('.tk-row')].map(r => r.dataset.id);
          let due = t.due;
          if (to !== from || to === 'upcoming') {
            if (to === 'today') due = W.iso(new Date());
            else if (to === 'someday') due = null;
            else if (to === 'upcoming') { const prev = row.previousElementSibling && row.previousElementSibling.closest('.tk-row'), next = row.nextElementSibling && row.nextElementSibling.closest('.tk-row'); const nb = S.tasks.find(x => x.id === ((prev || next || {}).dataset || {}).id); due = nb ? nb.due : W.iso(W.addDays(new Date(), 1)); }
          }
          if (due !== t.due) await WB.api('tasks.save', { id: t.id, worldId: WB.worldId, title: t.title, notes: t.notes, due, priority: t.priority, entryId: t.entryId }).catch(WB.fail);
          await reorder(ids);
          if (due !== t.due) ui.toast(due ? 'Now due ' + W.describe(due).toLowerCase() : 'Moved to some day', '▦');
        };
        grip.addEventListener('pointermove', mv); grip.addEventListener('pointerup', up); grip.addEventListener('pointercancel', up);
      }

      /* ----- gaps to fill ----- */
      function paintGaps() {
        GK.clear(gapsBox);
        if (RO) return;
        const g = S.gaps;
        const bodyEls = [];
        if (!g) bodyEls.push(h('div.gk-small.gk-muted', { text: 'Looking for gaps…' }));
        else if (!g.types.length) bodyEls.push(WB.ui.empty({ icon: '◌', title: 'No required fields', text: 'Mark fields as required in World → Types and empty ones show up here as ready-made tasks.', actions: [ui.button({ label: 'Edit types', small: true, onClick: () => WB.go('world', { tab: 'types' }) })] }));
        else if (!g.gaps.length) bodyEls.push(h('div.ib-gaps-done', [h('span', { text: '✓' }), h('div', [h('b', { text: 'No gaps' }), h('div.gk-small.gk-muted', { text: (pl => pl.length > 1 ? pl.slice(0, -1).join(', ') + ' and ' + pl[pl.length - 1] : pl[0])(g.types.map(t => t.plural)) + ' have their required fields filled in.' })])]));
        else {
          const byType = new Map();
          for (const x of g.gaps) { if (!byType.has(x.typeId)) byType.set(x.typeId, []); byType.get(x.typeId).push(x); }
          for (const [typeId, list] of byType) {
            const ty = WB.types.get(typeId);
            bodyEls.push(h('div.ib-gap-type', [h('span', { text: (ty ? ty.icon + ' ' + ty.plural : 'Entries') }), h('span.gk-faint', { text: String(list.length) })]));
            for (const x of list) {
              if (!x.entry || !WB.visible(x.entry)) continue;
              for (const m of x.missing) {
                bodyEls.push(h('div.ib-gap', [
                  h('div.ib-gap-main', [WB.ui.chip(x.entry, { size: 'sm' }), h('div.gk-tiny.gk-muted.ib-gap-q', { text: m.task })]),
                  ui.button({ label: 'Task', icon: '＋', small: true, title: 'Add “' + m.task + '” to your tasks', onClick: ev => gapTask(x, m, ev.currentTarget) }),
                ]));
              }
            }
          }
        }
        gapsBox.appendChild(ui.panel({ title: 'Gaps to fill', icon: '◌', cls: 'ib-gaps-panel', sub: g && g.gaps.length ? WB.fmt.plural(g.total, 'entry', 'entries') + ' with required fields still empty' : 'Required fields that are still empty become one-click tasks.',
          actions: g && g.gaps.length > 1 ? [ui.button({ label: 'All as tasks', small: true, kind: 'ghost', title: 'Turn every gap shown into a task', onClick: () => allGaps(g) })] : null, body: bodyEls }));
      }
      async function gapTask(x, m, btn) {
        if (btn) btn.disabled = true;
        try {
          const t = await WB.api('tasks.save', { worldId: WB.worldId, title: m.task, entryId: x.entryId, notes: 'The “' + m.label + '” field of ' + x.title + ' is empty.' });
          WB.ui.undoToast('Task added: ' + m.task, () => WB.api('tasks.remove', t.id));
          S.flash = t.id;
          await refresh();
        } catch (e) { WB.fail(e); }
      }
      async function allGaps(g) {
        const list = g.gaps.flatMap(x => x.missing.map(m => [x, m]));
        if (list.length > 8 && !(await ui.confirm('Add ' + list.length + ' tasks?', 'Every gap shown becomes a task linked to its entry.', 'Add tasks'))) return;
        const made = [];
        for (const [x, m] of list) made.push(await WB.api('tasks.save', { worldId: WB.worldId, title: m.task, entryId: x.entryId, notes: 'The “' + m.label + '” field of ' + x.title + ' is empty.' }));
        WB.ui.undoToast(WB.fmt.plural(made.length, 'task') + ' added', async () => { for (const t of made) await WB.api('tasks.remove', t.id); });
        await refresh();
      }

      /* ================= keyboard ================= */
      const onKey = e => {
        if (!page.isConnected || document.querySelector('.gk-scrim, .wb-pop, .mk-lb, .wb-peek:focus-within')) return;
        if (e.target.closest && e.target.closest('input, textarea, select, [contenteditable="true"]')) return;
        if (e.ctrlKey || e.metaKey || e.altKey) {
          if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'a' && store.get().view === 'captures' && !RO) { e.preventDefault(); shown().forEach(x => S.checked.add(x.id)); paintList(); }
          return;
        }
        const k = e.key.toLowerCase();
        if (k === 'r' && !RO) { e.preventDefault(); recordHere(); return; }
        if (store.get().view === 'tasks') {
          if (k === 'n' || k === 'q') { e.preventDefault(); qa.focus(); }
          return;
        }
        const list = shown().map(x => x.id), i = list.indexOf(S.cur);
        const ids = S.checked.size ? [...S.checked] : S.cur ? [S.cur] : [];
        if (k === 'arrowdown' || k === 'j') { e.preventDefault(); if (list[i + 1]) setCur(list[i + 1]); }
        else if (k === 'arrowup' || k === 'k') { e.preventDefault(); if (i > 0) setCur(list[i - 1]); }
        else if (k === 'home') { e.preventDefault(); if (list[0]) setCur(list[0]); }
        else if (k === 'end') { e.preventDefault(); if (list.length) setCur(list[list.length - 1]); }
        else if (RO) return;
        else if (k === 'x' && S.cur) { e.preventDefault(); toggleCheck(S.cur); }
        else if (k === 'c' && ids.length) { e.preventDefault(); WB.ui.menu(typeItems(ty => act('convert', ids, ty)), triage.querySelector('.ib-actions .primary') || { x: innerWidth / 2, y: innerHeight / 3 }); }
        else if (k === 'a' && ids.length) { e.preventDefault(); act('attach', ids); }
        else if (k === 't' && ids.length) { e.preventDefault(); taskMenu(ids, triage.querySelector('.ib-actions .gk-btn:nth-child(3)') || { x: innerWidth / 2, y: innerHeight / 3 }); }
        else if ((k === 'f' || k === 'e') && ids.length) { e.preventDefault(); act('file', ids); }
        else if ((k === 'o' || k === 'enter') && S.cur) { e.preventDefault(); WB.open(S.cur); }
        else if ((k === 'delete' || k === 'backspace') && ids.length) { e.preventDefault(); act('delete', ids); }
        else if (k === 'escape' && S.checked.size) { S.checked.clear(); paintList(); }
        else if (k === 'n') { e.preventDefault(); WB.capture(); }
      };
      document.addEventListener('keydown', onKey);

      /* ================= refresh ================= */
      async function refresh() {
        await Promise.all([loadCaptures(), loadTasks(), store.get().view === 'tasks' ? loadGaps() : null]);
        if (!S.alive) return;
        paintTop();
        if (store.get().view === 'tasks') { paintGroups(); paintGaps(); }
        else if (!S.items.length || !body.querySelector('.ib-cols')) paintCaptures();
        else { paintList(); if (S.triageFor !== S.cur || !S.full.get(S.cur) || !triage.contains(document.activeElement)) paintTriage(S.triageFor !== S.cur); }
      }
      const offs = [
        WB.onChange(['entries', 'tasks', 'links', 'media'], () => { if (S.alive && !S.editing) refresh().catch(() => { }); }, 350),
      ];
      live = { view: setView, refresh, state: () => ({ view: store.get().view, captures: S.items.length, cur: S.cur, tasks: S.tasks.length, gaps: S.gaps && S.gaps.gaps.length }), act, addTaskText: async text => { setView('tasks'); qa.value = text; paintQA(); await addTask(); } };
      await Promise.all([loadCaptures(), loadTasks(), loadGaps()]);
      paintAll();
      return () => { S.alive = false; live = null; offs.forEach(f => f()); document.removeEventListener('keydown', onKey); if (S.editor) S.editor.destroy(); K.stopAll(); };
    },
  });

  /* ---------------- palette commands ---------------- */
  WB.commands.add({ id: 'inbox:voice', label: 'Record a voice memo', icon: '●', group: 'Create', words: 'audio microphone dictate', run: () => WB.voice.record() });
  WB.commands.add({ id: 'inbox:triage', label: 'Sort the Inbox', icon: '✉', group: 'Inbox', words: 'triage captures', run: () => WB.go('inbox', { view: 'captures' }) });
  WB.commands.add({ id: 'inbox:tasks', label: 'Tasks', icon: '☑', group: 'Inbox', words: 'todo to-do due overdue', run: () => WB.go('inbox', { view: 'tasks' }) });
  WB.commands.add({ id: 'inbox:addtask', label: 'Add a task…', icon: '☑', group: 'Create', words: 'todo', run: async () => {
    const text = await ui.prompt('Add a task', '', 'e.g. Draft chapter two by fri !!');
    if (!text) return;
    if (live) return live.addTaskText(text);
    await WB.loadScript(WHEN);
    const p = window.WBWhen.parse(text);
    await WB.api('tasks.save', { worldId: WB.worldId, title: p.title || text, due: p.due, priority: p.priority }).catch(WB.fail);
    ui.toast('Task added' + (p.due ? ' · due ' + window.WBWhen.describe(p.due).toLowerCase() : ''), '☑');
  } });

  /* ---------------- smoke ---------------- */
  let triaged = 'did not run';
  WB.smoke('inbox-triage', async () => {
    await WB.go('inbox', { view: 'captures' });
    await WB.wait(700);
    const rows = document.querySelectorAll('.ib-list .wb-row').length;
    const pane = !!document.querySelector('.ib-tri .ib-title');
    const voice = !!document.querySelector('.ib-row.voice');
    await WB.go('inbox', { view: 'tasks' });
    await WB.wait(600);
    const tasks = document.querySelectorAll('.tk-row').length, gaps = document.querySelectorAll('.ib-gap').length;
    await WB.go('inbox', { view: 'captures' });
    await WB.wait(300);
    triaged = rows && pane && tasks && typeof WB.voice.record === 'function' ? 'ok' : 'error: rows ' + rows + ', pane ' + pane + ', tasks ' + tasks;
    return triaged === 'ok' ? { rows, voice, tasks, gaps } : triaged;
  });
  WB.check('inbox: captures, the triage pane, tasks and the voice recorder are there', () => { if (!/^ok/.test(triaged)) throw new Error(triaged); return true; });
})();
