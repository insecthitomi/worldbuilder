/* Command palette (Ctrl+K), quick capture (Ctrl+Shift+N), peek drawer, new-world wizard, title-bar tools, shortcuts. */
(function (root) {
  'use strict';
  const GK = root.GK, WB = root.WB, h = GK.h, ui = GK.ui;

  /* ---------------- command registry ---------------- */
  const cmds = new Map();
  WB.commands = {
    /** { id, label, icon, keys, group, run(), when?() , words } */
    add(c) { cmds.set(c.id, c); return c; },
    remove(id) { cmds.delete(id); },
    list: () => [...cmds.values()].filter(c => !c.when || c.when()),
    run: id => { const c = cmds.get(id); return c && c.run(); },
  };
  function builtins() {
    const list = [];
    for (const m of GK.modules.list().filter(m => m.nav !== false)) list.push({ id: 'go:' + m.id, label: 'Go to ' + m.title, icon: m.icon, group: 'Go to', run: () => WB.go(m.id), words: m.subtitle || '' });
    for (const t of WB.typeList()) list.push({ id: 'new:' + t.key, label: 'New ' + t.name.toLowerCase(), icon: t.icon, group: 'Create', run: () => WB.ui.createDialog({ type: t.key }) });
    list.push(
      { id: 'capture', label: 'Quick capture', icon: '✚', keys: 'Ctrl+Shift+N', group: 'Create', run: () => WB.capture() },
      { id: 'share', label: WB.share ? 'Leave Share view' : 'Share view: see what players and readers see', icon: '◑', group: 'View', run: () => WB.setShare(!WB.share) },
      { id: 'worlds', label: 'Switch world…', icon: '◎', group: 'World', run: () => worldMenu(document.querySelector('.wb-world-btn') || { x: 200, y: 60 }) },
      { id: 'newworld', label: 'New world…', icon: '✦', group: 'World', run: () => WB.newWorld() },
      { id: 'backup', label: 'Back up now', icon: '⛁', group: 'World', run: async () => { await WB.api('backup.create', 'Manual'); ui.toast('Backup made', '⛁'); } },
      { id: 'appearance', label: 'Appearance & preferences', icon: '⚙', keys: 'Ctrl+,', group: 'View', run: () => WB.go('appearance') },
      { id: 'shortcuts', label: 'Keyboard shortcuts', icon: '⌨', keys: 'Shift+F1', group: 'Help', run: () => shortcuts() },
    );
    return list.concat(WB.commands.list());
  }

  /* ---------------- palette ---------------- */
  let open = null;
  WB.palette = function (initial = '') {
    if (open) { open.input.focus(); return; }
    let q = initial, items = [], sel = 0, seq = 0;
    const input = h('input.wb-pal-input', { placeholder: 'Search or run a command…   t:place  #tag  is:fav  >command  r 2d6', spellcheck: false });
    input.value = q;
    const list = h('div.wb-pal-list', { role: 'listbox' });
    const foot = h('div.wb-pal-foot.gk-small.gk-muted', [WB.ui.kbd('↑↓'), ' move  ', WB.ui.kbd('Enter'), ' open  ', WB.ui.kbd('Ctrl+Enter'), ' peek  ', WB.ui.kbd('Shift+Enter'), ' create  ', WB.ui.kbd('Esc'), ' close']);
    const panel = h('div.gk-panel.gk-dialog.wb-palette', [h('div.wb-pal-head', [h('span.wb-pal-ico', { text: '⌕' }), input]), list, foot]);
    const scrim = h('div.gk-scrim.wb-pal-scrim', { onclick: e => { if (e.target === scrim) close(); } }, [panel]);
    const close = () => { scrim.remove(); open = null; };
    open = { input, close };
    const score = (label, words, ql) => { const l = (label + ' ' + (words || '')).toLowerCase(); if (!ql) return 1; if (l.startsWith(ql)) return 3; if (l.includes(' ' + ql)) return 2; return ql.split(/\s+/).every(w => l.includes(w)) ? 1 : 0; };
    async function refresh() {
      const my = ++seq, ql = q.trim().toLowerCase();
      const out = [];
      const dice = /^(?:r|roll)\s+(.+)$/i.exec(q.trim());
      if (dice && WB.dice.valid(dice[1])) { try { const r = WB.dice.roll(dice[1]); out.push({ kind: 'cmd', label: '⚄ ' + r.total + '   ' + r.text, sub: 'Enter rolls again', icon: '⚄', run: () => { WB.roll(dice[1]); refresh(); return true; } }); } catch { } }
      const onlyCmds = ql.startsWith('>');
      const cq = onlyCmds ? ql.slice(1).trim() : ql;
      const cs = builtins().map(c => [score(c.label, c.words, cq), c]).filter(x => x[0] > 0).sort((a, b) => b[0] - a[0]).slice(0, ql ? 6 : 5).map(x => x[1]);
      if (!onlyCmds && WB.worldId) {
        let entries;
        if (!ql) entries = await recent();
        else entries = await WB.api('search.query', WB.worldId, q, { limit: 14 }).catch(() => []);
        if (my !== seq) return;
        entries = entries.filter(e => WB.visible(e));
        if (entries.length) out.push({ head: ql ? 'Entries' : 'Recent' });
        for (const e of entries) out.push({ kind: 'entry', e });
      }
      if (cs.length) { out.push({ head: 'Commands' }); for (const c of cs) out.push({ kind: 'cmd', label: c.label, icon: c.icon, keys: c.keys, run: c.run }); }
      // "how do I…": Guide recipes for what was typed
      if (WB.guide && cq.length >= 3 && !dice) {
        const how = WB.guide.match(cq, 3);
        if (how.length) { out.push({ head: 'How to' }); for (const r of how) out.push({ kind: 'cmd', label: r.t, sub: r.why, icon: r.icon, run: () => WB.guide.open(r.id) }); }
      }
      if (ql && !onlyCmds && !dice) { out.push({ head: 'Create' }); out.push({ kind: 'cmd', label: 'Create “' + q.trim() + '”…', icon: '＋', keys: 'Shift+Enter', run: () => WB.ui.createDialog({ title: q.trim() }) }); }
      items = out.filter(x => !x.head); sel = 0;
      GK.clear(list);
      let i = 0;
      for (const it of out) {
        if (it.head) { list.appendChild(h('div.wb-pal-head-row', { text: it.head })); continue; }
        const idx = i++;
        const row = it.kind === 'entry'
          ? h('div.wb-pal-row', { role: 'option', dataset: { i: String(idx) } }, [WB.ui.icon(it.e), h('div.wb-pal-main', [h('div.gk-ellipsis', { text: it.e.title }), snippet(it.e)]), h('span.wb-pal-type.gk-small.gk-muted', { text: (WB.typeOf(it.e) || {}).name || '' })])
          : h('div.wb-pal-row', { role: 'option', dataset: { i: String(idx) } }, [h('span.wb-ico', { text: it.icon || '›' }), h('div.wb-pal-main', [h('div.gk-ellipsis', { text: it.label }), it.sub ? h('div.gk-small.gk-muted', { text: it.sub }) : null]), it.keys ? WB.ui.kbd(it.keys) : null]);
        row.addEventListener('click', ev => choose(idx, ev));
        row.addEventListener('pointermove', () => { if (sel !== idx) { sel = idx; hl(); } });
        list.appendChild(row);
      }
      hl();
    }
    function snippet(e) {
      const s = String(e.snippet || e.summary || '');
      if (!s) return null;
      const d = h('div.gk-small.gk-muted.gk-ellipsis.wb-pal-snip');
      s.split(/(\u0001[^\u0002]*\u0002)/).forEach(part => d.appendChild(part.startsWith('\u0001') ? h('mark', { text: part.slice(1, -1) }) : document.createTextNode(part)));
      return d;
    }
    async function recent() {
      const ids = (WB.prefs && WB.prefs.get().recentEntries) || [];
      const got = ids.length ? await WB.api('entries.many', ids.slice(0, 8)).catch(() => []) : [];
      const map = new Map(got.filter(e => !e.deletedAt).map(e => [e.id, e]));
      const r = ids.map(id => map.get(id)).filter(Boolean);
      return r.length ? r : WB.api('entries.recentlyEdited', WB.worldId, 8).catch(() => []);
    }
    function hl() { list.querySelectorAll('.wb-pal-row').forEach(r => r.classList.toggle('on', +r.dataset.i === sel)); const on = list.querySelector('.wb-pal-row.on'); on && on.scrollIntoView({ block: 'nearest' }); }
    function choose(i, ev) {
      const it = items[i]; if (!it) return;
      if (it.kind === 'entry') { close(); if (ev && (ev.ctrlKey || ev.metaKey)) WB.peek(it.e.id); else WB.open(it.e.id); return; }
      const keep = it.run && it.run();
      if (keep !== true) close();
    }
    const run = WB.debounce(refresh, 90);
    input.addEventListener('input', () => { q = input.value; run(); });
    input.addEventListener('keydown', e => {
      if (e.key === 'ArrowDown') { e.preventDefault(); sel = Math.min(items.length - 1, sel + 1); hl(); }
      else if (e.key === 'ArrowUp') { e.preventDefault(); sel = Math.max(0, sel - 1); hl(); }
      else if (e.key === 'Enter' && e.shiftKey) { e.preventDefault(); close(); WB.ui.createDialog({ title: q.trim() }); }
      else if (e.key === 'Enter') { e.preventDefault(); choose(sel, e); }
      else if (e.key === 'Escape') { e.preventDefault(); e.stopPropagation(); close(); }
    });
    document.body.appendChild(scrim);
    setTimeout(() => { input.focus(); input.select(); }, 20);
    refresh();
  };

  /* ---------------- quick capture ---------------- */
  WB.capture = function (preset = '') {
    if (!WB.worldId) return;
    const text = ui.input({ multiline: true, rows: 5, value: preset, placeholder: 'An idea, a name, a scrap of dialogue…\nThe first line becomes the title. It waits in the Inbox until you sort it.' });
    let attach = null, type = WB.type('note');
    const attachBox = h('div.gk-row.nowrap');
    const paintAttach = () => { GK.clear(attachBox); attachBox.append(attach ? WB.ui.chip(attach, { size: 'sm', onRemove: () => { attach = null; paintAttach(); } }) : h('span.gk-small.gk-muted', { text: 'Not linked' }), ui.button({ label: 'About…', small: true, kind: 'ghost', onClick: async () => { const p = await WB.ui.pickEntry({ title: 'What is it about?' }); if (p) { attach = p.id; paintAttach(); } } })); };
    paintAttach();
    const typeSel = ui.select({ value: type ? type.id : '', options: WB.typeList().map(t => [t.id, t.icon + '  ' + t.name]), onChange: v => { type = WB.types.get(v); } });
    const save = async () => {
      const v = text.value.trim(); if (!v) return close();
      const [first, ...rest] = v.split('\n');
      let body = WB.text.fromText(rest.join('\n').trim());
      if (attach) body = '<p>About <a class="wb-m" data-id="' + attach + '">' + WB.esc(WB.titleOf(attach)) + '</a></p>' + body;
      try {
        const e = await WB.api('entries.create', { worldId: WB.worldId, typeId: type.id, title: first.slice(0, 200), body, inbox: true });
        close();
        WB.ui.undoToast('Captured “' + e.title + '” to the Inbox', () => WB.api('entries.purge', e.id));
      } catch (err) { WB.fail(err); }
    };
    const panel = ui.panel({ title: 'Quick capture', icon: '✚', cls: 'gk-dialog wb-capture', body: [text, h('div.wb-capture-opts', [ui.field({ label: 'As', control: typeSel }), ui.field({ label: 'Linked to', control: attachBox })])] });
    panel.appendChild(h('div.gk-panel-foot', [h('span.gk-small.gk-muted.gk-grow', [WB.ui.kbd('Ctrl+Enter'), ' save']),
      WB.voice ? ui.button({ label: 'Voice memo', icon: '●', onClick: () => { close(); WB.voice.record(); } }) : null,
      ui.button({ label: 'Cancel', onClick: () => close() }), ui.button({ label: 'Capture', kind: 'primary', onClick: save })]));
    const scrim = h('div.gk-scrim', { onclick: e => { if (e.target === scrim) close(); } }, [panel]);
    const key = e => { if (e.key === 'Escape') { e.stopPropagation(); close(); } if (e.key === 'Enter' && (e.ctrlKey || e.metaKey)) { e.preventDefault(); save(); } };
    const close = () => { scrim.remove(); document.removeEventListener('keydown', key, true); };
    document.addEventListener('keydown', key, true);
    document.body.appendChild(scrim);
    setTimeout(() => text.focus(), 30);
  };

  /* ---------------- peek drawer ---------------- */
  let peekEl = null;
  WB.peek = async function (id) {
    const e = await WB.api('entries.get', id).catch(WB.fail);
    if (!e) return;
    if (!WB.visible(e)) return ui.toast('That entry is hidden in Share view', '◑');
    const t = WB.typeOf(e), ctx = await WB.api('entries.context', id).catch(() => null);
    const close = () => { if (peekEl) { peekEl.remove(); peekEl = null; document.removeEventListener('keydown', esc, true); } };
    const esc = ev => { if (ev.key === 'Escape' && !document.querySelector('.gk-scrim')) { ev.stopPropagation(); close(); } };
    if (peekEl) peekEl.remove(); else document.addEventListener('keydown', esc, true);
    const age = WB.fmt.age(e);
    const fields = (t ? t.fields : []).filter(d => WB.fieldVisible(d) && WB.F.filled(d.kind, e.fields[d.key]));
    const body = WB.editor.prepare(e.body || '', WB.share);
    const bodyBox = h('div.wb-editor.readonly.wb-peek-text'); bodyBox.appendChild(body);
    bodyBox.addEventListener('click', ev => { const a = ev.target.closest('a.wb-m'); if (a) { ev.preventDefault(); if (ev.ctrlKey) WB.peek(a.dataset.id); else { close(); WB.open(a.dataset.id); } } });
    peekEl = h('aside.gk-panel.gk-dialog.wb-peek', { style: { zoom: String((GK.uiScale && GK.uiScale().used) || 1) } }, [
      h('div.wb-peek-head', [WB.ui.icon(e, 'big'), h('div.gk-grow', [h('h3.gk-ellipsis', { text: e.title }), h('div.gk-small.gk-muted', { text: [t && t.name, WB.fmt.span(e), age != null ? 'age ' + age : ''].filter(Boolean).join(' · ') })]),
        ui.button({ label: 'Open', small: true, kind: 'primary', onClick: () => { close(); WB.open(e.id); } }), ui.button({ icon: '✕', small: true, kind: 'ghost', title: 'Close (Esc)', onClick: close })]),
      h('div.wb-peek-scroll', [
        e.coverId ? WB.ui.thumb(e.coverId, { cls: 'wb-peek-cover' }) : null,
        e.summary ? h('p.wb-peek-sum', { text: e.summary }) : null,
        fields.length ? h('div.wb-peek-fields', fields.map(d => h('div.wb-kv', [h('div.gk-small.gk-muted', { text: d.label }), WB.ui.fieldView(d, e.fields[d.key])]))) : null,
        e.body ? bodyBox : null,
        ctx && ctx.relations.length ? h('div', [h('h4', { text: 'Relations' }), h('div.wb-chips', ctx.relations.map(r => h('span.wb-rel-pill', [h('span.gk-small.gk-muted', { text: r.label + ' ' }), WB.ui.chip(r.other, { size: 'sm' })])))]) : null,
        ctx && (ctx.mentionedBy.length + ctx.referencedBy.length) ? h('div', [h('h4', { text: 'Linked from' }), h('div.wb-chips', ctx.mentionedBy.concat(ctx.referencedBy).slice(0, 24).map(x => WB.ui.chip(x.entry, { size: 'sm' })))]) : null,
      ]),
    ]);
    document.body.appendChild(peekEl);
  };
  WB.closePeek = () => { if (peekEl) { peekEl.remove(); peekEl = null; } };

  /* ---------------- worlds ---------------- */
  WB.switchWorld = async function (id) {
    await WB.setWorld(id);
    WB.closePeek();
    await GK.shell.go(GK.shell.current && GK.modules.get(GK.shell.current) ? GK.shell.current : 'home');
    paintTools();
  };
  async function worldMenu(at) {
    const worlds = await WB.api('worlds.list');
    WB.ui.menu([{ header: 'Worlds' }].concat(worlds.map(w => ({ label: w.name, icon: w.icon || '◎', checked: w.id === WB.worldId, hint: w.entries + ' entries', onClick: () => WB.switchWorld(w.id) })), ['-',
      { label: 'New world…', icon: '✦', onClick: () => WB.newWorld() },
      { label: 'Open the example world', icon: '❖', onClick: async () => { const w = await WB.api('worlds.sample'); await WB.switchWorld(w.id); } },
      { label: 'Manage worlds…', icon: '⚙', onClick: () => WB.go('world', { tab: 'worlds' }) },
    ]), at);
  }
  WB.newWorld = function (preset = {}) {
    return new Promise(async resolve => {
      const starters = await WB.api('worlds.starters');
      let starter = preset.starter || 'fantasy', name = preset.name || '';
      const nameIn = ui.input({ value: name, placeholder: 'Name your world', onInput: v => { name = v; } });
      const grid = h('div.wb-starter-grid');
      const PURPOSE = { fantasy: '⚔', scifi: '✶', modern: '⌕', campaign: '⚄', novel: '✎', blank: '◇' };
      const paint = () => { GK.clear(grid); for (const s of starters) grid.appendChild(h('button.wb-starter', { type: 'button', class: s.key === starter ? 'on' : '', onclick: () => { starter = s.key; paint(); } }, [h('span.wb-starter-ico', { text: PURPOSE[s.key] || '◇' }), h('b', { text: s.label }), h('span.gk-small.gk-muted', { text: s.desc })])); };
      paint();
      const finish = v => { scrim.remove(); resolve(v); };
      const create = async () => {
        try {
          const w = await WB.api('worlds.create', { name: name.trim() || 'Untitled world', starter });
          finish(w); await WB.switchWorld(w.id); WB.go('home');
          ui.toast('“' + w.name + '” is ready', '✦');
        } catch (e) { WB.fail(e); }
      };
      const panel = ui.panel({ title: 'A new world', icon: '✦', cls: 'gk-dialog wb-newworld', body: [nameIn, h('p.gk-small.gk-muted', { text: 'What are you building? This only sets helpful defaults — every type and setting can change later.' }), grid] });
      panel.appendChild(h('div.gk-panel-foot', [
        ui.button({ label: 'Explore the example world instead', kind: 'ghost', onClick: async () => { const w = await WB.api('worlds.sample'); finish(w); await WB.switchWorld(w.id); WB.go('home'); } }),
        h('span.gk-grow'), ui.button({ label: 'Cancel', onClick: () => finish(null) }), ui.button({ label: 'Create world', kind: 'primary', onClick: create })]));
      const scrim = h('div.gk-scrim', { onclick: e => { if (e.target === scrim) finish(null); } }, [panel]);
      nameIn.addEventListener('keydown', e => { if (e.key === 'Enter') create(); });
      document.body.appendChild(scrim);
      setTimeout(() => nameIn.focus(), 30);
    });
  };

  /* ---------------- shortcuts help ---------------- */
  WB.SHORTCUTS = [['Ctrl+K', 'Search everything, run commands, roll dice'], ['Ctrl+N', 'New entry'], ['Ctrl+Shift+N', 'Quick capture'], ['Alt+← / Alt+→', 'Back / forward'],
    ['Ctrl+Click', 'Peek at an entry without leaving'], ['@ or [[', 'Link an entry while writing (or create it)'], ['/ at the start of a line', 'Insert a heading, table, callout, secret…'], ['Ctrl+Shift+S', 'Mark text as secret'], ['Ctrl+K (in text)', 'Web link'],
    ['# / ## + space', 'Heading / subheading'], ['- or 1. + space', 'Lists'], ['> + space', 'Quote'], ['! + space', 'Callout'], ['---', 'Divider'],
    ['Ctrl+Shift+F', 'Focus mode for writing'], ['Ctrl+1…9', 'Jump to a screen'], ['Ctrl+,', 'Appearance & preferences'], ['F2', 'Rename the open entry'], ['Delete', 'Move the selected entry to the trash'],
    ['F1', 'The Guide: what you can do, by purpose'], ['Shift+F1', 'This list']];
  function shortcuts() {
    ui.dialog({ title: 'Keyboard shortcuts', icon: '⌨', body: h('div.wb-shortcuts', WB.SHORTCUTS.map(([k, d]) => h('div.wb-kv-row', [WB.ui.kbd(k), h('span', { text: d })]))) });
  }

  /* ---------------- title-bar tools & global keys ---------------- */
  let tools = null;
  function paintTools() {
    if (!tools) return;
    const w = WB.world;
    tools.world.replaceChildren(h('span', { text: (w && w.icon) || '◎' }), h('span.gk-ellipsis.wb-world-name', { text: w ? w.name : 'No world' }), h('span.gk-faint', { text: ' ▾' }));
    tools.share.replaceChildren(WB.share ? '◑ Share view' : '◐ Author');
    tools.share.classList.toggle('on', WB.share);
    tools.share.setAttribute('aria-pressed', String(WB.share));
    const c = WB.canGo(); tools.back.disabled = !c.back; tools.fwd.disabled = !c.forward;
  }
  WB.initChrome = function () {
    const mk = (o) => GK.shell.addTool(ui.button(Object.assign({ small: true }, o)));
    tools = {
      back: mk({ icon: '‹', title: 'Back (Alt+←)', onClick: () => WB.back() }),
      fwd: mk({ icon: '›', title: 'Forward (Alt+→)', onClick: () => WB.forward() }),
      world: mk({ label: 'World', title: 'Switch world', onClick: e => worldMenu(tools.world) }),
      search: mk({ label: '⌕ Search', title: 'Search everything (Ctrl+K)', onClick: () => WB.palette() }),
      capture: mk({ label: '✚ Capture', title: 'Quick capture (Ctrl+Shift+N)', onClick: () => WB.capture() }),
      share: mk({ label: '◐ Author', title: 'Share view shows only what players and readers may see', onClick: () => { WB.setShare(!WB.share); paintTools(); } }),
    };
    tools.world.classList.add('wb-world-btn');
    WB.on('world', paintTools); WB.on('history', paintTools); WB.on('share', paintTools);
    paintTools();
    document.addEventListener('keydown', e => {
      const typing = e.target.closest && e.target.closest('input, textarea, select, [contenteditable="true"]');
      if (e.ctrlKey && !e.altKey && e.key.toLowerCase() === 'k' && !e.shiftKey) { e.preventDefault(); WB.palette(); }
      else if (e.ctrlKey && e.shiftKey && e.key.toLowerCase() === 'n') { e.preventDefault(); WB.capture(); }
      else if (e.ctrlKey && !e.shiftKey && e.key.toLowerCase() === 'n') { e.preventDefault(); WB.ui.createDialog({}); }
      else if (e.altKey && e.key === 'ArrowLeft') { e.preventDefault(); WB.back(); }
      else if (e.altKey && e.key === 'ArrowRight') { e.preventDefault(); WB.forward(); }
      else if (e.key === 'F1' && e.shiftKey) { e.preventDefault(); shortcuts(); }
      else if (e.key === 'F1') { e.preventDefault(); if (WB.guide) WB.go('guide'); else shortcuts(); }
      else if (!typing && e.key === '/' ) { e.preventDefault(); WB.palette(); }
    });
    document.addEventListener('mouseup', e => { if (e.button === 3) { e.preventDefault(); WB.back(); } else if (e.button === 4) { e.preventDefault(); WB.forward(); } });
  };
  WB.paintTools = paintTools;
})(window);
