/* Home: welcome for a first launch; for a world, a dashboard of what matters now — the world's date and moons,
   quick actions, writing progress, where you left off, tasks, the inbox, world health, anniversaries and prompts. */
(function () {
  'use strict';
  const GK = window.GK, WB = window.WB, h = GK.h, ui = GK.ui;

  const PURPOSES = [
    ['novel', '✎', 'A novel or series', 'A manuscript with its cast, settings and plot threads one click away.'],
    ['campaign', '⚄', 'A tabletop campaign', 'Sessions, encounters, quests, dice and a player wiki that hides your secrets.'],
    ['fantasy', '⚔', 'A fantasy setting', 'Kingdoms, gods, magic, maps and history on your own calendar.'],
    ['scifi', '✶', 'A science-fiction universe', 'Planets, species, factions and technology.'],
    ['modern', '⌕', 'A mystery or modern world', 'Cases, suspects, locations and secrets.'],
    ['blank', '◇', 'Something else', 'Every type and tool, no assumptions.'],
  ];

  function welcome(page) {
    page.appendChild(h('div.hm-welcome', [
      h('div.hm-hero', [h('div.hm-hero-mark', { text: '✦' }), h('h1', { text: 'Welcome to Worldbuilder' }),
        h('p.gk-muted', { text: 'Build a world — its people, places, history, languages and maps — and tell stories in it. Everything stays on this computer.' })]),
      h('h3.hm-q', { text: 'What are you building?' }),
      h('div.hm-purposes', PURPOSES.map(([key, icon, title, text]) => h('button.hm-purpose.gk-widget', { type: 'button', onclick: () => WB.newWorld({ starter: key }) }, [h('span.hm-purpose-ico', { text: icon }), h('b', { text: title }), h('span.gk-small.gk-muted', { text: text })]))),
      h('div.hm-or', [h('span.gk-muted', { text: 'Or look around first — ' }), ui.button({ label: 'Open the example world', icon: '❖', kind: 'primary', onClick: async () => { const w = await WB.api('worlds.sample'); await WB.switchWorld(w.id); } })]),
      h('div.hm-tips.gk-small.gk-muted', [h('span', ['Tip: ', WB.ui.kbd('Ctrl+K'), ' finds anything; ', WB.ui.kbd('Ctrl+Shift+N'), ' captures an idea from anywhere; type ', WB.ui.kbd('@'), ' in any text to link (or create) an entry; ', WB.ui.kbd('F1'), ' opens the Guide — everything you can do, by purpose.'])]),
    ]));
  }

  GK.modules.register({
    id: 'home',
    title: 'Home',
    icon: '⌂',
    order: 10,
    heading: false,
    subtitle: 'Your world at a glance.',
    async mount(page, ctx) {
      page.classList.add('hm-page');
      if (!WB.worldId) { welcome(page); return; }
      const st = await WB.store(ctx, { checklistHidden: false });
      const w = WB.world, C = WB.cal;
      let alive = true;
      const offs = [];

      /* ---- the world, now ---- */
      const nowBox = h('div.hm-now');
      const paintNow = () => {
        GK.clear(nowBox);
        const now = WB.now, p = C.ymd(now.day), season = C.season(now.day);
        GK.append(nowBox, [
          h('div.hm-now-date', [h('div.gk-tiny.gk-muted', { text: 'In ' + WB.world.name + ' it is' }), h('div.hm-now-big', { text: C.format(now, 'full') }), h('div.gk-small', { text: (season ? season + ' · ' : '') + C.monthName(p.m) + ', day ' + p.d + ' of ' + C.monthLength(p.y, p.m) })]),
          C.moons(now.day).length ? h('div.hm-moons', C.moons(now.day).map(m => h('div.hm-moon', { title: m.name + ': ' + m.phaseName, style: { '--c': m.color || 'var(--text)' } }, [h('span.hm-moon-ico', { text: m.icon }), h('span.gk-tiny', { text: m.name }), h('span.gk-tiny.gk-muted', { text: m.phaseName })]))) : null,
          WB.share ? null : h('div.hm-now-tools', [
            ui.group([ui.button({ label: '−1 day', small: true, title: 'Move the world\'s date back a day', onClick: () => shift(-1) }), ui.button({ label: '+1 day', small: true, title: 'Advance the world one day', onClick: () => shift(1) })]),
            ui.button({ label: 'Set date…', small: true, kind: 'ghost', onClick: setDate }),
          ]),
        ]);
      };
      async function shift(days) { const n = { day: WB.now.day + days, min: WB.now.min, prec: WB.now.prec }; await WB.api('worlds.update', WB.worldId, { now: n }); await WB.reloadWorld(); }
      async function setDate() {
        let v = WB.now;
        const ok = await ui.dialog({ title: 'The world\'s date', icon: '◷', body: h('div.gk-stack', [h('p.gk-small.gk-muted', { text: 'Ages, Share view reveals and the timeline\'s “now” line use this date.' }), WB.ui.dateInput({ value: v, allowEmpty: false, onChange: d => { v = d; } })]), actions: [{ label: 'Cancel', value: false }, { label: 'Set', kind: 'primary', value: true }] });
        if (ok && v) { await WB.api('worlds.update', WB.worldId, { now: v }); await WB.reloadWorld(); }
      }

      /* ---- hero ---- */
      page.appendChild(h('section.hm-world.gk-panel', [
        w.coverId ? h('div.hm-cover', [WB.ui.thumb(w.coverId, { cls: 'hm-cover-img' })]) : null,
        h('div.hm-world-main', [
          h('div.hm-world-title', [h('span.hm-world-ico', { text: w.icon || '◎', style: { '--c': w.color || 'var(--accent)' } }), h('h1', { text: w.name })]),
          w.summary ? h('p.hm-world-sum', { text: w.summary }) : h('button.cx-addlink', { type: 'button', text: '＋ Describe your world in a sentence', onclick: () => WB.go('world', { tab: 'world' }) }),
          h('div.hm-actions', [
            ui.button({ label: 'New entry', icon: '＋', kind: 'primary', onClick: () => WB.ui.createDialog({}) }),
            ui.button({ label: 'Capture', icon: '✚', onClick: () => WB.capture() }),
            ui.button({ label: 'Search', icon: '⌕', onClick: () => WB.palette() }),
            WB.gen && WB.gen.town ? ui.button({ label: 'Found a town', icon: '⌂', onClick: () => WB.go('toolkit', { tool: 'town' }) }) : null,
            ui.button({ label: 'Write', icon: '✎', onClick: () => WB.go('write') }),
            ui.button({ label: 'Surprise me', icon: '⚂', kind: 'ghost', title: 'Open a random entry — good for inspiration', onClick: async () => { const e = await WB.api('entries.random', WB.worldId, { audience: WB.share }); if (e) WB.open(e.id); } }),
          ]),
        ]),
        nowBox,
      ]));
      paintNow();

      const statsRow = h('div.gk-grid.hm-stats');
      const grid = h('div.hm-grid');
      page.append(statsRow, grid);
      const card = (title, icon, body, actions, cls) => ui.panel({ title, icon, actions: actions ? [].concat(actions).filter(Boolean) : null, body, cls: 'hm-card ' + (cls || '') });

      async function paint() {
        const [stats, writing, recent, favs, tasks, counts, inbox, gaps] = await Promise.all([
          WB.api('worlds.stats', WB.worldId), WB.api('writing.stats', WB.worldId, 30).catch(() => null),
          WB.api('entries.recentlyEdited', WB.worldId, 8), WB.api('entries.list', WB.worldId, { favorite: true, sort: 'title', limit: 12 }),
          WB.api('tasks.list', WB.worldId, { done: false }).catch(() => []), WB.api('tasks.counts', WB.worldId).catch(() => ({})),
          WB.api('entries.list', WB.worldId, { inbox: true, sort: 'created', limit: 5 }), WB.api('entries.gaps', WB.worldId, 6).catch(() => []),
        ]);
        if (!alive) return;
        const goal = (writing && writing.goal) || 500;
        const isType = (key) => Object.entries(stats.byType || {}).some(([id, n]) => (WB.types.get(id) || {}).key === key && n);
        GK.clear(statsRow);
        const todayTile = writing ? WB.ui.stat({ label: 'Written today', icon: '✎', value: WB.fmt.num(writing.today), note: 'goal ' + WB.fmt.num(goal) + (writing.today >= goal ? ' — done ✓' : ''), tone: writing.today >= goal ? 'good' : '', onClick: () => WB.go('write') }) : null;
        if (todayTile) todayTile.appendChild(ui.meter(Math.min(1, writing.today / goal)));
        GK.append(statsRow, [
          WB.ui.stat({ label: 'Entries', icon: '❖', value: WB.fmt.num(stats.entries), note: WB.fmt.plural(stats.relations, 'relation') + ' · ' + WB.fmt.plural(stats.links, 'link'), onClick: () => WB.go('codex') }),
          todayTile,
          writing ? WB.ui.stat({ label: 'Writing streak', icon: '✷', value: writing.streak + (writing.streak === 1 ? ' day' : ' days'), note: 'best ' + writing.best + ' · ' + WB.fmt.words(writing.total) + ' in all' }) : null,
          WB.ui.stat({ label: 'Tasks', icon: '☐', value: WB.fmt.num(counts.open || 0), note: (counts.overdue ? counts.overdue + ' overdue · ' : '') + (counts.today || 0) + ' due today', tone: counts.overdue ? 'bad' : '', onClick: () => WB.go('inbox', { tab: 'tasks' }) }),
          WB.ui.stat({ label: 'Inbox', icon: '✉', value: WB.fmt.num(stats.inbox), note: stats.inbox ? 'ideas waiting to be sorted' : 'all sorted', onClick: () => WB.go('inbox') }),
        ]);

        const cards = [];
        // checklist for young worlds
        const steps = [
          ['A character', isType('character'), () => WB.ui.createDialog({ type: 'character' })],
          ['A place', isType('place'), () => WB.ui.createDialog({ type: 'place' })],
          ['Link them (type @ in text, or add a relation)', stats.links > 0, () => WB.go('codex')],
          ['A map — draw, import or generate one', isType('map'), () => WB.go('atlas')],
          ['Your calendar (months, eras, moons)', JSON.stringify(w.calendar.months.map(m => m.name)) !== JSON.stringify(WB.Cal.DEFAULT.months.map(m => m.name)), () => WB.go('world', { tab: 'calendar' })],
          ['A first scene or chapter', stats.words > 300, () => WB.go('write')],
        ];
        const done = steps.filter(s => s[1]).length;
        if (!st.get().checklistHidden && done < steps.length) {
          cards.push(card('Getting started', '✦', h('div.hm-check', [ui.meter(done / steps.length),
            ...steps.map(([label, ok, go]) => h('button.hm-step', { type: 'button', class: ok ? 'done' : '', onclick: go }, [h('span.hm-step-box', { text: ok ? '✓' : '' }), h('span', { text: label })]))]),
          [WB.guide ? ui.button({ label: 'Guide', icon: '?', small: true, kind: 'ghost', title: 'Everything you can do, by purpose (F1)', onClick: () => WB.go('guide') }) : null,
            ui.button({ icon: '✕', small: true, kind: 'ghost', title: 'Hide the checklist', onClick: () => { st.patch({ checklistHidden: true }); paint(); } })], 'hm-wide'));
        }
        // one thing from the Guide this person hasn't tried yet
        if (WB.guide && !WB.share) {
          const tried = new Set(((await GK.store('guide', { tried: [], purpose: 'all' })).get().tried) || []);
          if (!alive) return;
          const pool = WB.guide.RECIPES.filter(r => !tried.has(r.id) && !r.free);
          if (pool.length) {
            const box = h('div.hm-tip');
            const show = () => {
              const r = pool[Math.floor(Math.random() * pool.length)];
              box.replaceChildren(h('div.hm-tip-head', [h('span.hm-tip-ico', { text: r.icon }), h('b', { text: r.t })]), h('p.gk-small.gk-muted', { text: r.why }),
                h('div.gk-row', [ui.button({ label: 'Show me', small: true, kind: 'primary', onClick: () => WB.guide.run(r) }), ui.button({ label: 'Another tip', small: true, kind: 'ghost', onClick: show }), h('span.gk-grow'), h('button.cx-addlink', { type: 'button', text: 'All ' + WB.guide.RECIPES.length + ' →', onclick: () => WB.guide.open(r.id) })]));
            };
            show();
            cards.push(card('Did you know?', '?', box));
          }
        }
        const rec = recent.filter(e => WB.visible(e));
        cards.push(card('Pick up where you left off', '◷', rec.length ? h('div.gk-list.hm-list', rec.map(e => WB.ui.row(e, { sub: [(WB.typeOf(e) || {}).name, WB.fmt.rel(e.updatedAt)].filter(Boolean).join(' · ') }))) : WB.ui.empty({ icon: '◷', title: 'Nothing edited yet', text: 'Your recent work shows up here.' })));
        // anniversaries on the world's date
        const p = C.ymd(WB.now.day);
        const anniv = (await WB.api('entries.onDay', WB.worldId, p.m, p.d).catch(() => [])).filter(e => WB.visible(e));
        if (!alive) return;
        const which = e => { const t = WB.typeOf(e) || {}; return e.which === 'start' ? ((t.dated || {}).start || 'Began') : ((t.dated || {}).end || 'Ended'); };
        cards.push(card('On this day', '☾', anniv.length ? h('div.gk-list.hm-list', anniv.slice(0, 8).map(e => { const d = e.which === 'start' ? e.start : e.end; return WB.ui.row(e, { sub: which(e) + ' ' + WB.fmt.date(d) + ' — ' + WB.fmt.plural(p.y - C.ymd(d.day).y, 'year') + ' ago' }); }))
          : h('p.gk-small.gk-muted', { text: 'No birthdays, foundings or battles fall on ' + p.d + ' ' + C.monthName(p.m) + '. Yet.' }),
          ui.button({ label: 'Chronicle', small: true, kind: 'ghost', onClick: () => WB.go('chronicle') })));
        const tl = tasks.slice(0, 7);
        cards.push(card('Tasks', '☐', tl.length ? h('div.hm-tasks', tl.map(x => h('label.cx-task', [h('input', { type: 'checkbox', onchange: async () => { await WB.api('tasks.toggle', x.id); paint(); } }), h('span.gk-grow', { text: x.title }), x.entryId && WB.liteOf(x.entryId) ? WB.ui.chip(x.entryId, { size: 'sm' }) : null, x.due ? h('span.gk-tiny', { class: x.due < WB.today() ? 'cx-overdue' : 'gk-muted', text: WB.fmt.real(x.due) }) : null]))) : h('p.gk-small.gk-muted', { text: 'Nothing to do. Suspicious.' }),
          ui.button({ label: 'All tasks', small: true, kind: 'ghost', onClick: () => WB.go('inbox', { tab: 'tasks' }) })));
        if (inbox.length) cards.push(card('Inbox', '✉', h('div.gk-list.hm-list', inbox.map(e => WB.ui.row(e, { sub: 'captured ' + WB.fmt.rel(e.createdAt) }))), ui.button({ label: 'Sort them', small: true, kind: 'primary', onClick: () => WB.go('inbox') })));
        const health = await WB.api('checks.summary', WB.worldId).catch(() => null);
        if (!alive) return;
        if (health && health.score != null) {
          const sc = Math.round(health.score);
          cards.push(card('World health', '⚖', h('div.hm-health', [
            h('div.hm-score', { class: sc >= 85 ? 'good' : sc >= 60 ? 'warn' : 'bad', style: { '--p': String(sc) } }, [h('b', { text: String(sc) }), h('span.gk-tiny.gk-muted', { text: '/ 100' })]),
            h('div.hm-issues', (health.top || []).slice(0, 4).map(i => h('button.hm-issue', { type: 'button', class: i.severity, onclick: () => WB.go('checks', { key: i.key }) }, [h('span.hm-sev', { text: i.severity === 'error' ? '●' : i.severity === 'warn' ? '▲' : '○' }), h('span.gk-ellipsis', { text: i.title })]))),
          ]), ui.button({ label: 'Checks', small: true, kind: 'ghost', onClick: () => WB.go('checks') })));
        }
        const gp = gaps.filter(g => { const l = WB.liteOf(g.id); return l && WB.visible(l); });
        if (gp.length && !WB.share) cards.push(card('Questions for your world', '?', h('div.hm-prompts', gp.map(g => h('button.hm-prompt', { type: 'button', onclick: () => WB.open(g.id) }, [h('span.hm-prompt-q', { text: prompt(g) }), h('span.gk-tiny.gk-muted', { text: (WB.types.get(g.typeId) || {}).name || '' })]))),
          ui.button({ icon: '↻', small: true, kind: 'ghost', title: 'Other questions', onClick: paint })));
        const fv = favs.filter(e => WB.visible(e));
        if (fv.length) cards.push(card('Favourites', '★', h('div.wb-chips.hm-favs', fv.map(e => WB.ui.chip(e)))));
        if (writing && writing.series && writing.series.some(s => s.words)) cards.push(card('Words, last 30 days', '▁', spark(writing.series, goal), ui.button({ label: 'Write', small: true, kind: 'ghost', onClick: () => WB.go('write') }), 'hm-wide'));
        GK.clear(grid);
        GK.append(grid, cards);
      }
      function prompt(g) {
        const t = g.title;
        if (g.kind === 'empty') return 'What is ' + t + '? It has no description yet.';
        const L = (g.label || '').toLowerCase();
        const Q = { goals: 'What does ' + t + ' want?', fears: 'What is ' + t + ' afraid of?', secret: 'What is ' + t + ' hiding?', flaw: 'What is ' + t + '\'s flaw?', leader: 'Who leads ' + t + '?', ruler: 'Who rules ' + t + '?' };
        return Q[g.field] || 'What is the ' + L + ' of ' + t + '?';
      }
      function spark(series, goal) {
        const max = Math.max(goal, ...series.map(s => s.words)), W = 600, H = 90, bw = W / series.length;
        const NS = 'http://www.w3.org/2000/svg', svg = document.createElementNS(NS, 'svg');
        svg.setAttribute('viewBox', '0 0 ' + W + ' ' + (H + 4)); svg.setAttribute('class', 'hm-spark'); svg.setAttribute('preserveAspectRatio', 'none');
        const gl = document.createElementNS(NS, 'line'), gy = H - (goal / max) * H;
        gl.setAttribute('x1', 0); gl.setAttribute('x2', W); gl.setAttribute('y1', gy); gl.setAttribute('y2', gy); gl.setAttribute('class', 'goal'); svg.appendChild(gl);
        series.forEach((s, i) => {
          const r = document.createElementNS(NS, 'rect'), hh = Math.max(s.words ? 2 : 0, (s.words / max) * H);
          r.setAttribute('x', i * bw + 1.5); r.setAttribute('width', Math.max(1, bw - 3)); r.setAttribute('y', H - hh); r.setAttribute('height', hh); r.setAttribute('rx', 2); if (s.words >= goal) r.setAttribute('class', 'met');
          const t = document.createElementNS(NS, 'title'); t.textContent = WB.fmt.real(s.day) + ': ' + WB.fmt.words(s.words); r.appendChild(t); svg.appendChild(r);
        });
        return h('div.hm-spark-wrap', [svg, h('div.gk-tiny.gk-muted', { text: 'Dashed line: your daily goal of ' + WB.fmt.num(goal) + ' words.' })]);
      }

      await paint();
      offs.push(WB.on('world', () => { if (alive) paintNow(); }));
      offs.push(WB.onChange(['entries', 'tasks', 'links', 'worlds'], () => alive && paint(), 400));
      return () => { alive = false; offs.forEach(f => f()); };
    },
  });

  WB.smoke('home-dashboard', async () => {
    await GK.shell.go('home'); await WB.wait(1000);
    const cards = document.querySelectorAll('.hm-card').length;
    return cards >= 3 ? { cards, now: (document.querySelector('.hm-now-big') || {}).textContent } : 'error: the dashboard has ' + cards + ' cards';
  });
})();
