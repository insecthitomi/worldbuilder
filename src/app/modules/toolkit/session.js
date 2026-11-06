/* Toolkit · session runner: start or resume a Session entry, keep a timestamped log (notes, fights, people met, places,
   loot, milestones; dice and table rolls if wanted), chips for people and places, and end it with a recap in the body. */
(function () {
  'use strict';
  const GK = window.GK, WB = window.WB, h = GK.h, ui = GK.ui, TK = WB.toolkit;
  const KINDS = { note: ['✎', 'Note'], combat: ['⚔', 'Fight'], npc: ['☺', 'Met'], place: ['⌂', 'Arrived'], loot: ['⚱', 'Loot'], milestone: ['⚑', 'Milestone'], quote: ['❝', 'Quote'], roll: ['⚄', 'Roll'], start: ['▶', 'Start'], end: ['■', 'End'], time: ['◷', 'Time'] };
  const elapsed = (from, to) => { const s = Math.max(0, Math.round(((to ? Date.parse(to) : Date.now()) - Date.parse(from)) / 1000)); const hh = Math.floor(s / 3600), mm = Math.floor(s / 60) % 60; return hh ? hh + 'h ' + String(mm).padStart(2, '0') + 'm' : mm + ' min'; };

  /** appends a line to the running session (from dice, tables, initiative …) */
  TK.logToSession = async ({ kind = 'note', text, ref = null } = {}) => {
    const m = await TK.mine();
    if (!m.sessionId || !text) return false;
    const e = await WB.api('entries.get', m.sessionId).catch(() => null);
    if (!e || e.deletedAt) { TK.setMine({ sessionId: null }); return false; }
    const log = (e.data.log || []).concat([{ t: new Date().toISOString(), kind, text: String(text).slice(0, 2000), ref }]);
    const patch = { dataPatch: { log } };
    if (ref && (kind === 'npc' || kind === 'place')) { const k = kind === 'npc' ? 'npcs' : 'places'; const cur = e.fields[k] || []; if (!cur.includes(ref)) patch.fieldsPatch = { [k]: cur.concat([ref]) }; }
    await WB.api('entries.update', e.id, patch);
    WB.emit('toolkit-session', e.id);
    return true;
  };

  TK.tools.session = {
    async mount(host, { params }) {
      let mine = await TK.mine(), view = params.entryId || mine.sessionId || null, sess = null, timer = 0;
      const offs = [];
      const side = TK.entryList({ typeKey: 'session', selected: view, newLabel: 'New session', onNew: () => paintStart(), onSelect: e => open(e.id), sort: 'created',
        sub: e => [e.id === mine.sessionId ? '● running' : '', WB.fmt.span(e)].filter(Boolean).join(' · '), empty: { text: 'No sessions yet.' } });
      const main = h('div.tl-sess-main');
      host.appendChild(h('div.tl-split', [h('aside.gk-panel.tl-side', [h('div.gk-panel-head', [h('span.gk-ico', { text: '☗' }), h('h3', { text: 'Sessions' }), side.count]), h('div.gk-panel-body', [side.el])]), main]));

      const sessions = () => side.list();
      const nextNumber = async () => { let n = 0; for (const s of sessions()) { const e = await WB.api('entries.get', s.id).catch(() => null); if (e && +e.fields.number > n) n = +e.fields.number; } return n + 1; };

      /* ---- start ---- */
      async function paintStart() {
        clearInterval(timer);
        GK.clear(main);
        if (WB.share) { main.appendChild(TK.card({ body: WB.ui.empty({ icon: '☗', title: 'Sessions are run in the author view', text: 'Leave Share view to start or log a session.' }) })); return; }
        const n = await nextNumber();
        let last = null;
        for (const s of sessions()) { const e = await WB.api('entries.get', s.id).catch(() => null); if (e && (!last || (+e.fields.number || 0) > (+last.fields.number || 0))) last = e; }
        const title = ui.input({ value: 'Session ' + n, placeholder: 'Session title' });
        title.classList.add('tl-table-title');
        let players = (last && last.fields.players) || [];
        const playersEd = WB.ui.field({ key: 'players', label: 'At the table', kind: 'list' }, players, v => { players = v; });
        const go = async () => {
          const t = WB.type('session'); if (!t) return ui.toast('This world has no Session type', '⚠');
          const now = new Date().toISOString();
          const e = await WB.api('entries.create', { worldId: WB.worldId, typeId: t.id, title: title.value.trim() || 'Session ' + n, start: WB.now,
            fields: { number: n, played: WB.today(), players }, data: { log: [{ t: now, kind: 'start', text: 'Session started — in the world it is ' + WB.fmt.date(WB.now) }] } });
          await TK.setMine({ sessionId: e.id, sessionStart: now }); mine = await TK.mine();
          await side.refresh(); side.select(e.id); open(e.id);
        };
        main.appendChild(TK.card({ cls: 'tl-sess-start', body: [
          h('div.tl-sess-hero', [h('span.tl-hero-ico', { text: '☗' }), h('div.gk-grow', [h('div.tl-town-kicker', { text: 'Game night' }), title,
            h('div.gk-small.gk-muted', { text: 'Played today · in the world it is ' + WB.fmt.date(WB.now, 'full') })])]),
          ui.field({ label: 'At the table', hint: 'Carried over from the last session.', control: playersEd }),
          last && last.fields.prep ? h('div.tl-secret', [h('span.tl-secret-tag', { text: '◐ last prep' }), h('span', { text: last.fields.prep })]) : null,
          h('div.tl-sess-tips.gk-small.gk-muted', { text: 'While it runs: log what happens with a line of text, mark who the players meet and where they go, note loot — fights from the initiative tracker and (if you like) dice and table rolls are logged by themselves. Ending writes a recap into the session.' }),
          h('div.gk-row', [ui.button({ label: 'Start session', icon: '▶', kind: 'primary', onClick: go })]),
        ] }));
        setTimeout(() => title.focus(), 30);
      }

      /* ---- a session (running or past) ---- */
      async function open(id) {
        clearInterval(timer);
        view = id;
        sess = id ? await WB.api('entries.get', id).catch(() => null) : null;
        if (!sess || sess.deletedAt || !WB.visible(sess)) { sess = null; return mine.sessionId ? null : paintStart(); }
        paint();
      }
      function paint() {
        GK.clear(main);
        const running = sess.id === mine.sessionId && !WB.share, log = sess.data.log || [];
        const startedAt = running ? mine.sessionStart || (log[0] && log[0].t) : null;
        const clock = h('span.tl-sess-clock');
        const tickClock = () => { clock.textContent = startedAt ? elapsed(startedAt) : ''; };
        tickClock(); if (running) timer = setInterval(tickClock, 15000);
        const head = h('section.gk-widget.tl-sess-head', [
          h('div.tl-init-headrow', [
            h('span.tl-hero-ico', { class: running ? 'live' : '', text: '☗' }),
            h('div.gk-grow', [h('div.tl-town-kicker', { text: running ? '● Running' : 'Session' + (sess.fields.played ? ' · played ' + WB.fmt.real(sess.fields.played) : '') }), h('h3.tl-init-title', [WB.ui.chip(sess)]),
              h('div.gk-small.gk-muted', { text: 'In the world: ' + (WB.fmt.span(sess) || WB.fmt.date(WB.now)) + (running ? ' → now ' + WB.fmt.date(WB.now) : '') })]),
            running ? h('div.tl-round', [h('div.tl-stat-label', { text: 'Playing for' }), h('div.tl-round-n.small', [clock])]) : null,
          ]),
          WB.share ? null : h('div.tl-init-actions', running ? [
            ui.button({ label: '+1 hour', small: true, title: 'Advance the world\'s time an hour', onClick: () => advance({ min: 60 }) }),
            ui.button({ label: '+1 day', small: true, title: 'Advance the world\'s date a day', onClick: () => advance({ days: 1 }) }),
            h('span.gk-grow'),
            ui.button({ label: 'End session', icon: '■', kind: 'primary', onClick: endSession }),
          ] : [
            ui.button({ label: mine.sessionId ? 'Switch to this session' : 'Resume this session', icon: '▶', onClick: async () => { if (mine.sessionId && mine.sessionId !== sess.id && !(await ui.confirm('Switch sessions?', 'Another session is running. Logging moves to this one.', 'Switch'))) return; await TK.setMine({ sessionId: sess.id, sessionStart: new Date().toISOString() }); mine = await TK.mine(); await addLine('start', 'Session resumed'); side.refresh(); } }),
            ui.button({ label: 'New session', icon: '＋', kind: 'ghost', onClick: () => paintStart() }),
          ]),
        ]);
        /* the composer */
        const input = ui.input({ placeholder: running ? 'What happened? (Enter adds it to the log)' : 'Add a line to this session\'s log' });
        input.classList.add('tl-sess-input');
        input.addEventListener('keydown', e => { if (e.key === 'Enter' && input.value.trim()) { e.preventDefault(); addLine(e.shiftKey ? 'quote' : 'note', input.value.trim()); input.value = ''; } });
        const quick = h('div.tl-sess-quick', [
          btn('☺', 'Met…', 'Someone the players meet', () => pick('character', 'npc', 'Met ')),
          btn('⌂', 'Arrived at…', 'A place the players go', () => pick('place', 'place', 'Arrived at ')),
          btn('⚱', 'Loot…', 'Something they found', async () => { const v = await ui.prompt('Loot', '', 'e.g. A silver tide-bell'); if (v) { await setField('loot', (sess.fields.loot || []).concat([v])); addLine('loot', 'Found ' + v); } }),
          btn('⚔', 'Fight', 'A fight starts (or open the initiative tracker)', e => WB.ui.menu([{ label: 'Log a fight', icon: '⚔', onClick: async () => { const v = await ui.prompt('The fight', '', 'e.g. Gull runners on the breakwater'); if (v) addLine('combat', 'Fight: ' + v); } }, { label: 'Open the initiative tracker', icon: '⇱', onClick: () => TK.show && TK.show('initiative') }], e)),
          btn('⚑', 'Milestone', 'A turning point', async () => { const v = await ui.prompt('Milestone', '', 'e.g. The party learns who Corwin\'s father is'); if (v) addLine('milestone', v); }),
          btn('❝', 'Quote', 'Something worth remembering (Shift+Enter in the box)', async () => { const v = await ui.prompt('Quote', '', '“…”'); if (v) addLine('quote', v); }),
        ]);
        const logBox = h('div.tl-sess-log', { role: 'log' });
        const t0 = log[0] && log[0].t;
        if (!log.length) logBox.appendChild(h('div.gk-small.gk-muted.tl-pad', { text: 'Nothing logged yet.' }));
        log.slice().reverse().forEach((x, ri) => {
          const i = log.length - 1 - ri, k = KINDS[x.kind] || KINDS.note;
          logBox.appendChild(h('div.tl-log-line', { class: 'k-' + (x.kind || 'note') }, [
            h('span.tl-log-time', { title: new Date(x.t).toLocaleString() }, [h('b', { text: TK.time(x.t) }), t0 ? h('span.gk-tiny.gk-muted', { text: '+' + elapsed(t0, x.t) }) : null]),
            h('span.tl-log-ico', { text: k[0], title: k[1] }),
            h('span.tl-log-text', [x.ref && WB.liteOf(x.ref) ? WB.ui.chip(x.ref, { size: 'sm' }) : null, x.ref && WB.liteOf(x.ref) ? ' ' : null, x.text]),
            WB.share ? null : ui.button({ icon: '✕', small: true, kind: 'ghost', title: 'Remove this line', onClick: async () => { const old = log.slice(); await WB.api('entries.update', sess.id, { dataPatch: { log: log.filter((y, j) => j !== i) } }); WB.ui.undoToast('Line removed', () => WB.api('entries.update', sess.id, { dataPatch: { log: old } })); } }),
          ]));
        });
        /* side: people, places, loot, options */
        const chipsFor = (key, typeKey, kind, label) => {
          const ids = sess.fields[key] || [];
          const box = h('div.wb-chips.tl-sess-chips', ids.map(id => WB.ui.chip(id, { size: 'sm', onRemove: WB.share ? null : () => setField(key, ids.filter(x => x !== id)) })));
          if (!ids.length) box.appendChild(h('span.gk-small.gk-muted', { text: 'Drop entries here or use ' + label + '.' }));
          if (!WB.share) WB.dnd.accept(box, id => { if (!ids.includes(id)) { setField(key, ids.concat([id])); addLine(kind, (kind === 'npc' ? 'Met ' : 'Arrived at ') + WB.titleOf(id), id, true); } });
          return box;
        };
        const auto = ui.toggle({ value: mine.autoLog !== false, onChange: v => TK.setMine({ autoLog: v }).then(async () => { mine = await TK.mine(); }) });
        const sideCol = h('div.tl-sess-side', [
          TK.card({ title: 'People met', icon: '☺', body: chipsFor('npcs', 'character', 'npc', 'Met…') }),
          TK.card({ title: 'Places visited', icon: '⌂', body: chipsFor('places', 'place', 'place', 'Arrived at…') }),
          TK.card({ title: 'Loot', icon: '⚱', body: WB.ui.field({ key: 'loot', label: 'Loot', kind: 'list' }, sess.fields.loot || [], v => setField('loot', v), { readOnly: WB.share }) }),
          TK.card({ title: 'At the table', icon: '☗', body: WB.ui.field({ key: 'players', label: 'Players', kind: 'list' }, sess.fields.players || [], v => setField('players', v), { readOnly: WB.share }) }),
          running ? TK.card({ title: 'Logging', icon: '⚙', body: ui.field({ label: 'Log dice and table rolls', inline: true, control: auto }) }) : null,
          sess.fields.prep && !WB.share ? TK.card({ title: 'Prep notes', icon: '◐', body: h('div.tl-secret', [h('span', { text: sess.fields.prep })]) }) : null,
        ]);
        main.append(head, h('div.tl-sess-body', [h('div.tl-sess-col', [TK.card({ cls: 'tl-sess-compose', body: WB.share ? [] : [input, quick] }), TK.card({ title: 'Log', icon: '◷', sub: log.length + (log.length === 1 ? ' line' : ' lines'), body: logBox })]), sideCol]));
      }
      function btn(icon, label, title, fn) { return ui.button({ label, icon, small: true, title, onClick: fn }); }
      async function pick(typeKey, kind, prefix) {
        const t = WB.type(typeKey);
        const p = await WB.ui.pickEntry({ title: prefix.trim() + '…', types: t ? [t.id] : [], multi: true, allowCreate: true });
        if (!p || !p.length) return;
        const key = kind === 'npc' ? 'npcs' : 'places', ids = sess.fields[key] || [];
        await setField(key, ids.concat(p.map(x => x.id).filter(id => !ids.includes(id))));
        for (const x of p) await addLine(kind, prefix + x.title, x.id, true);
      }
      async function setField(k, v) { sess.fields[k] = v; await WB.api('entries.update', sess.id, { fieldsPatch: { [k]: v } }).catch(WB.fail); }
      async function addLine(kind, text, ref, noFields) {
        const e = await WB.api('entries.get', sess.id);
        const log = (e.data.log || []).concat([{ t: new Date().toISOString(), kind, text, ref: ref || null }]);
        await WB.api('entries.update', sess.id, { dataPatch: { log } });
        if (!noFields) { /* fields are set by the caller */ }
      }
      async function advance(by) {
        const n = WB.now;
        const next = by.days ? { day: n.day + by.days, min: n.min, prec: n.prec } : { day: n.day + Math.floor(((n.min || 0) + by.min) / WB.cal.minutesPerDay), min: ((n.min || 0) + by.min) % WB.cal.minutesPerDay, prec: 'time' };
        await WB.api('worlds.update', WB.worldId, { now: next });
        await WB.reloadWorld();
        await addLine('time', 'Time passes: it is now ' + WB.fmt.date(WB.now));
      }
      async function endSession() {
        const e = await WB.api('entries.get', sess.id);
        const log = e.data.log || [];
        let rolls = false, setEnd = true;
        const body = h('div.gk-stack', [
          h('p.gk-text', { text: log.length + ' lines over ' + (log[0] ? elapsed(log[0].t) : 'a while') + '. A recap — the log, people met, places, loot — is added to the session.' }),
          ui.field({ label: 'Include dice and table rolls in the recap', inline: true, control: ui.toggle({ value: false, onChange: v => { rolls = v; } }) }),
          ui.field({ label: 'In-world end: ' + WB.fmt.date(WB.now), inline: true, control: ui.toggle({ value: true, onChange: v => { setEnd = v; } }) }),
        ]);
        const ok = await ui.dialog({ title: 'End the session?', icon: '■', body, actions: [{ label: 'Keep playing', value: false }, { label: 'End and write the recap', kind: 'primary', value: true }] });
        if (!ok) return;
        const now = new Date().toISOString();
        const fullLog = log.concat([{ t: now, kind: 'end', text: 'Session ended', ref: null }]);
        const m = (id, label) => '<a class="wb-m" data-id="' + id + '">' + WB.esc(label || WB.titleOf(id)) + '</a>';
        const lines = fullLog.filter(x => rolls || x.kind !== 'roll').filter(x => !['start', 'end', 'time'].includes(x.kind) || x.kind === 'time')
          .map(x => '<li>' + (x.kind === 'milestone' ? '<strong>' + WB.esc(x.text) + '</strong>' : x.kind === 'quote' ? '<em>' + WB.esc(x.text) + '</em>' : x.ref && WB.liteOf(x.ref) ? WB.esc(x.text).replace(WB.esc(WB.titleOf(x.ref)), m(x.ref)) : WB.esc(x.text)) + '</li>').join('');
        const npcs = e.fields.npcs || [], places = e.fields.places || [], loot = e.fields.loot || [];
        let html = '<h3>Recap — ' + WB.esc(WB.fmt.real(WB.today())) + '</h3>';
        html += '<p>Played for ' + elapsed(fullLog[0].t, now) + '. In the world: ' + WB.esc(WB.fmt.date(e.start || WB.now)) + (setEnd && e.start && e.start.day !== WB.now.day ? ' to ' + WB.esc(WB.fmt.date(WB.now)) : '') + '.</p>';
        if (lines) html += '<ul>' + lines + '</ul>';
        if (npcs.length) html += '<p><strong>People met:</strong> ' + npcs.map(id => m(id)).join(', ') + '</p>';
        if (places.length) html += '<p><strong>Places:</strong> ' + places.map(id => m(id)).join(', ') + '</p>';
        if (loot.length) html += '<p><strong>Loot:</strong> ' + loot.map(x => WB.esc(x)).join(', ') + '</p>';
        const patch = { body: (e.body || '') + html, dataPatch: { log: fullLog }, fieldsPatch: { played: e.fields.played || WB.today() } };
        if (setEnd) patch.end = WB.now;
        if (!e.start) patch.start = WB.now;
        await WB.api('entries.update', sess.id, patch);
        await TK.setMine({ sessionId: null, sessionStart: null }); mine = await TK.mine();
        TK.toast('Recap written into “' + e.title + '”', [{ label: 'Open', onClick: () => WB.open(e.id) }]);
        side.refresh(); open(sess.id);
      }

      /* ---- wiring ---- */
      const list = await side.refresh();
      if (mine.sessionId && !list.find(e => e.id === mine.sessionId)) { await TK.setMine({ sessionId: null }); mine = await TK.mine(); }
      if (view && list.find(e => e.id === view)) { side.select(view); await open(view); }
      else await paintStart();
      offs.push(WB.onChange(['entries'], async p => {
        await side.refresh();
        if (!sess || !(p.ids || []).includes(sess.id)) return;
        const a = document.activeElement, typing = a && main.contains(a) && a.matches('input, textarea, [contenteditable="true"]');
        if (typing && !a.classList.contains('tl-sess-input')) return;
        const val = typing ? a.value : null;
        await open(sess.id);
        if (typing) { const i = main.querySelector('.tl-sess-input'); if (i) { i.value = val; i.focus(); } }
      }));
      offs.push(WB.on('world', () => { if (sess) open(sess.id); }));
      return () => { clearInterval(timer); offs.forEach(f => f()); };
    },
  };
})();
