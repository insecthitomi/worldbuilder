/* Checks: continuity & world health — a health score, every issue grouped by check with plain explanations, entry
   chips, quick fixes, "Mark as intended" and a "Fix next" walk-through. Fix helpers: src/app/modules/checks/fix.js. */
(function () {
  'use strict';
  const { h, ui } = GK, U = WB.ui;
  const K = WB.checks = WB.checks || {};
  const SVG = 'http://www.w3.org/2000/svg';
  const LIMIT = 6;
  const sevRank = { error: 0, warn: 1, info: 2 };
  let current = null;   // the mounted screen (palette commands and smoke steps talk to it)

  /** the health dial: a ring filled to the score, coloured by how healthy the world is */
  function dial(score, errors) {
    const r = 42, c = 2 * Math.PI * r, tone = score >= 85 && !errors ? 'good' : score >= 60 ? 'warn' : 'bad';
    const svg = document.createElementNS(SVG, 'svg');
    svg.setAttribute('viewBox', '0 0 100 100'); svg.setAttribute('class', 'ck-dial-svg ' + tone); svg.setAttribute('aria-hidden', 'true');
    const mk = (cls, extra) => { const el = document.createElementNS(SVG, 'circle'); el.setAttribute('cx', '50'); el.setAttribute('cy', '50'); el.setAttribute('r', String(r)); el.setAttribute('class', cls); for (const [k, v] of Object.entries(extra || {})) el.setAttribute(k, v); return el; };
    svg.append(mk('ck-dial-track'), mk('ck-dial-fill', { 'stroke-dasharray': (c * score / 100) + ' ' + c, transform: 'rotate(-90 50 50)' }));
    return h('div.ck-dial', { class: tone, role: 'meter', 'aria-label': 'World health', 'aria-valuenow': String(score), 'aria-valuemin': '0', 'aria-valuemax': '100', title: 'World health: ' + score + ' of 100' }, [
      svg, h('div.ck-dial-num', [h('b', { text: String(score) }), h('span', { text: 'of 100' })]),
    ]);
  }
  const verdict = (score, counts) => (counts.error ? (score >= 80 ? 'Good overall — ' + WB.fmt.plural(counts.error, 'error') + ' to fix' : 'Needs attention')
    : score >= 95 ? 'In excellent shape' : score >= 85 ? 'In good shape' : score >= 60 ? 'A few things to look at' : 'Needs attention');

  GK.modules.register({
    id: 'checks',
    title: 'Checks',
    icon: '⚖',
    order: 140,
    subtitle: 'Continuity and world health: contradictions, loose ends and things that would read oddly.',
    async mount(page, ctx) {
      page.classList.add('ck-page');
      if (!WB.worldId) {
        page.appendChild(U.empty({ icon: '⚖', title: 'No world open', text: 'Checks read a whole world — dates, lifespans, family trees, links, maps and media — and point out what contradicts itself.', actions: [ui.button({ label: 'Create a world', kind: 'primary', onClick: () => WB.newWorld() })] }));
        return;
      }
      if (WB.share) {
        page.appendChild(U.empty({ icon: '◑', title: 'Checks are for the author', text: 'They talk about private entries and secrets, so they stay out of Share view.', actions: [ui.button({ label: 'Leave Share view', kind: 'primary', onClick: () => WB.setShare(false) })] }));
        return;
      }
      await WB.loadScript('src/app/modules/checks/fix.js');
      const defaults = { sev: '', check: '', q: '', open: {}, ignoredOpen: false, groupLimit: {} };
      const st = await (WB.store ? WB.store(ctx, defaults) : ctx.store(defaults));
      const params = WB.params('checks') || {};
      if (params.check) st.patch({ check: params.check, sev: '' });
      let focusKey = params.key || null, entryFilter = params.entryId || null;
      if (focusKey || entryFilter) st.patch({ sev: '', q: '' });

      K.catalog = K.catalog || await WB.api('checks.list');
      let all = [], summary = null, settings = null, alive = true, loading = false;
      const mountedWorld = WB.worldId;
      const hero = h('div.ck-hero'), bar = h('div.ck-bar'), groups = h('div.ck-groups'), ignoredBox = h('div.ck-ignored');
      page.append(hero, bar, groups, ignoredBox);

      const open = () => all.filter(i => !i.ignored);
      const filtered = () => {
        const f = st.get(), q = (f.q || '').toLowerCase();
        return open().filter(i => (!f.sev || i.severity === f.sev) && (!f.check || i.check === f.check) && (!entryFilter || i.entryIds.includes(entryFilter))
          && (!q || (i.title + ' ' + i.detail).toLowerCase().includes(q) || i.entryIds.some(id => (WB.titleOf(id) || '').toLowerCase().includes(q))));
      };
      const reload = async () => { all = await WB.api('checks.run', WB.worldId, { all: true }); return filtered(); };

      async function load(rerun) {
        if (loading) return; loading = true;
        try {
          if (rerun) groups.classList.add('ck-busy');
          all = await WB.api('checks.run', WB.worldId, { all: true, fresh: !!rerun });
          [summary, settings] = await Promise.all([WB.api('checks.summary', WB.worldId), WB.api('checks.settings', WB.worldId)]);
          if (!alive) return;
          paint();
          if (rerun) ui.toast('Checked ' + WB.fmt.plural(summary.entries, 'entry', 'entries') + ' · ' + (summary.total ? WB.fmt.plural(summary.total, 'open issue') : 'nothing to fix'), '⚖', 2200);
        } catch (e) { WB.fail(e); } finally { loading = false; groups.classList.remove('ck-busy'); }
      }

      /* ---------- hero: dial, counts, actions ---------- */
      function paintHero() {
        GK.clear(hero);
        const c = summary.counts, off = (settings.off || []).length;
        const sevChip = (sev, n, label) => h('button.ck-count', { type: 'button', class: 'sev-' + sev + (st.get().sev === sev ? ' on' : '') + (n ? '' : ' zero'), title: 'Show only ' + label.toLowerCase(), 'aria-pressed': String(st.get().sev === sev), onclick: () => { st.patch({ sev: st.get().sev === sev ? '' : sev }); paint(); } }, [
          h('span.ck-count-ico', { text: K.SEV[sev][1] }), h('b', { text: String(n) }), h('span', { text: label }),
        ]);
        hero.append(
          ui.panel({ cls: 'ck-health', body: [h('div.ck-health-row', [
            dial(summary.score, c.error),
            h('div.ck-health-main', [
              h('div.ck-verdict', { text: summary.entries ? verdict(summary.score, c) : 'Nothing to check yet' }),
              h('div.gk-small.gk-muted', { text: 'Read ' + WB.fmt.plural(summary.entries, 'entry', 'entries') + ' · ' + (K.catalog.length - off) + ' checks' + (off ? ' (' + off + ' off)' : '') + ' · ' + WB.fmt.rel(summary.at) }),
              h('div.ck-counts', [sevChip('error', c.error, c.error === 1 ? 'Error' : 'Errors'), sevChip('warn', c.warn, c.warn === 1 ? 'Warning' : 'Warnings'), sevChip('info', c.info, c.info === 1 ? 'Note' : 'Notes'),
                c.ignored ? h('button.ck-count.sev-ignored', { type: 'button', title: 'Show what you marked as intended', onclick: () => { st.patch({ ignoredOpen: true }); paintIgnored(); ignoredBox.scrollIntoView({ behavior: 'smooth', block: 'start' }); } }, [h('span.ck-count-ico', { text: '◌' }), h('b', { text: String(c.ignored) }), h('span', { text: 'intended' })]) : null]),
              h('div.ck-actions', [
                ui.button({ label: 'Fix next', icon: '➜', kind: 'primary', disabled: !summary.total, title: 'Walk through the open issues one by one (F)', onClick: () => startWalk() }),
                ui.button({ label: 'Re-check', icon: '↻', title: 'Run every check again (R)', onClick: () => load(true) }),
                ui.button({ label: 'Settings', icon: '⚙', kind: 'ghost', title: 'Which checks run, and their limits', onClick: e => settingsPop(e.currentTarget) }),
              ]),
              h('div.gk-tiny.gk-faint.ck-keys', [U.kbd('F'), ' fix next · ', U.kbd('R'), ' re-check · on an issue: ', U.kbd('Enter'), ' quick fix, ', U.kbd('O'), ' open, ', U.kbd('I'), ' mark as intended. Checks run again by themselves whenever the world changes.']),
            ]),
          ])] }),
          ui.panel({ title: 'By check', icon: '☰', cls: 'ck-bycheck', body: [h('div.ck-catlist', K.catalog.map(cat => {
            const list = open().filter(i => i.check === cat.id), isOff = (settings.off || []).includes(cat.id);
            const worst = list.reduce((w, i) => Math.min(w, sevRank[i.severity]), 3);
            const tone = isOff ? 'off' : !list.length ? 'pass' : ['error', 'warn', 'info'][worst];
            const on = st.get().check === cat.id;
            return h('button.ck-cat', { type: 'button', class: 'tone-' + tone + (on ? ' on' : ''), 'aria-pressed': String(on), title: cat.desc + (isOff ? ' (switched off in Settings)' : ''), onclick: () => { st.patch({ check: on ? '' : cat.id }); paint(); } }, [
              h('span.ck-cat-ico', { text: cat.icon }), h('span.ck-cat-lbl.gk-ellipsis', { text: cat.label }),
              h('span.ck-cat-n', { text: isOff ? 'off' : list.length ? String(list.length) : '✓' }),
            ]);
          }))] }),
        );
      }

      /* ---------- filter bar ---------- */
      function paintBar() {
        GK.clear(bar);
        const f = st.get(), shown = filtered().length, total = open().length;
        const cat = f.check ? K.catalog.find(c => c.id === f.check) : null;
        GK.append(bar, [
          ui.segmented({ value: f.sev || '', options: [['', 'All'], ['error', 'Errors'], ['warn', 'Warnings'], ['info', 'Notes']], onChange: v => { st.patch({ sev: v }); paint(); } }),
          U.search({ placeholder: 'Find an issue or entry', value: f.q || '', onInput: WB.debounce(v => { st.patch({ q: v }); paintGroups(); paintBarCount(); }, 180) }),
          cat ? h('span.ck-filterchip', [h('span', { text: cat.icon + ' ' + cat.label }), h('button.wb-chip-x', { type: 'button', text: '✕', title: 'Show every check', onclick: () => { st.patch({ check: '' }); paint(); } })]) : null,
          entryFilter ? h('span.ck-filterchip', [h('span', { text: 'About ' }), U.chip(entryFilter, { size: 'sm' }), h('button.wb-chip-x', { type: 'button', text: '✕', title: 'Show issues about every entry', onclick: () => { entryFilter = null; paint(); } })]) : null,
          h('span.gk-grow'),
          h('span.gk-small.gk-muted.ck-shown', { text: shown === total ? WB.fmt.plural(total, 'open issue') : shown + ' of ' + total + ' shown' }),
          shown > 1 ? ui.button({ label: 'Collapse all', small: true, kind: 'ghost', onClick: () => { const o = {}; for (const c of K.catalog) o[c.id] = false; st.patch({ open: o }); paintGroups(); } }) : null,
        ]);
      }
      const paintBarCount = () => { const el = bar.querySelector('.ck-shown'); if (el) { const shown = filtered().length, total = open().length; el.textContent = shown === total ? WB.fmt.plural(total, 'open issue') : shown + ' of ' + total + ' shown'; } };

      /* ---------- one issue ---------- */
      function issueEl(it) {
        const [sevLabel, sevIco, tone] = K.SEV[it.severity] || K.SEV.info;
        const fixes = it.fixes || [];
        const first = fixes[0];
        const firstEntry = it.entryIds.find(id => WB.liteOf(id));
        const doFix = async f => { const changed = await K.applyFix(it, f); if (changed) load(); };
        const el = h('div.ck-issue', { class: 'sev-' + it.severity + (focusKey === it.key ? ' flash' : ''), tabindex: 0, dataset: { key: it.key } }, [
          h('div.ck-issue-sev', { title: sevLabel, text: sevIco }),
          h('div.ck-issue-main', [
            h('div.ck-issue-title', { text: it.title }),
            h('div.ck-issue-detail', { text: it.detail }),
            it.entryIds.length ? K.chips(it) : null,
          ]),
          h('div.ck-issue-acts', [
            first ? ui.button({ label: first.label, small: true, kind: /^open/.test(first.kind) ? '' : 'primary', title: 'Quick fix (Enter)', onClick: () => doFix(first) }) : null,
            firstEntry && !(first && first.kind === 'open' && first.entryId === firstEntry) ? ui.button({ label: 'Open', icon: '↗', small: true, kind: 'ghost', title: 'Open ' + WB.titleOf(firstEntry) + ' (O)', onClick: () => WB.open(firstEntry) }) : null,
            ui.button({ label: 'Intended…', small: true, kind: 'ghost', title: 'This is fine as it is: mark it as intended (I)', onClick: async e => { if (await K.ignore(it, e.currentTarget)) load(); } }),
            ui.button({ icon: '⋯', small: true, kind: 'ghost', title: 'More', onClick: e => more(it, e.currentTarget) }),
          ]),
        ]);
        el.addEventListener('keydown', e => {
          if (e.target !== el) return;
          if (e.key === 'Enter' && first) { e.preventDefault(); doFix(first); }
          else if ((e.key === 'o' || e.key === 'O') && firstEntry) { e.preventDefault(); WB.open(firstEntry); }
          else if (e.key === 'i' || e.key === 'I') { e.preventDefault(); K.ignore(it, el.querySelector('.ck-issue-acts')).then(ok => ok && load()); }
          else if (e.key === 'ArrowDown' || e.key === 'ArrowUp') { const all2 = [...groups.querySelectorAll('.ck-issue')], n = all2[all2.indexOf(el) + (e.key === 'ArrowDown' ? 1 : -1)]; if (n) { e.preventDefault(); n.focus(); } }
        });
        el.addEventListener('contextmenu', e => { e.preventDefault(); more(it, e); });
        return el;
      }
      function more(it, at) {
        const ids = it.entryIds.filter(id => WB.liteOf(id));
        U.menu([].concat(
          (it.fixes || []).slice(1).length ? [{ header: 'Other fixes' }] : [],
          (it.fixes || []).slice(1).map(f => ({ label: f.label, icon: /^open/.test(f.kind) ? '↗' : '✓', onClick: async () => { if (await K.applyFix(it, f)) load(); } })),
          ids.length ? [{ header: 'Entries' }] : [],
          ids.map(id => ({ label: WB.titleOf(id), icon: WB.iconOf(WB.liteOf(id)), hint: 'Ctrl+Click a chip to peek', sub: [{ label: 'Open', icon: '↗', onClick: () => WB.open(id) }, { label: 'Peek', icon: '◫', onClick: () => WB.peek(id) }, { label: 'Issues about this entry', icon: '⌕', onClick: () => { entryFilter = id; paint(); } }] })),
          ['-', { label: 'Mark as intended…', icon: '◌', kbd: 'I', onClick: () => K.ignore(it, at.getBoundingClientRect ? at : null).then(ok => ok && load()) },
            { label: 'Copy as text', icon: '⎘', onClick: () => navigator.clipboard.writeText(it.title + '\n' + it.detail).then(() => ui.toast('Copied', '⎘')) }],
        ), at);
      }

      /* ---------- groups ---------- */
      function paintGroups() {
        GK.clear(groups);
        const list = filtered(), f = st.get();
        if (!open().length) {
          const blank = !summary.entries;
          groups.appendChild(ui.panel({ cls: 'ck-allgood', body: [U.empty({ icon: blank ? '⚖' : '✓', title: blank ? 'An empty world has no contradictions' : all.length ? 'Nothing left to fix' : 'Every check passes',
            text: blank ? 'Checks read dates, lifespans, family trees, links, maps and media. Add characters, places and events — then come back to see where the story contradicts itself.'
              : all.length ? 'What remains is marked as intended. Checks run again whenever something changes.' : 'No contradictions, broken links or loose ends found. Checks run again whenever something changes — come back after a writing session.',
            actions: blank ? [ui.button({ label: 'New entry', icon: '＋', kind: 'primary', onClick: () => WB.ui.createDialog({}) })] : null })] }));
          return;
        }
        if (!list.length) {
          groups.appendChild(h('div.gk-muted.ck-none', [h('span', { text: 'No issue matches these filters. ' }), h('a', { href: '#', text: 'Show everything', onclick: e => { e.preventDefault(); entryFilter = null; st.patch({ sev: '', check: '', q: '' }); paint(); } })]));
          return;
        }
        const by = new Map();
        for (const i of list) { if (!by.has(i.check)) by.set(i.check, []); by.get(i.check).push(i); }
        const order = [...by.keys()].sort((a, b) => Math.min(...by.get(a).map(i => sevRank[i.severity])) - Math.min(...by.get(b).map(i => sevRank[i.severity])) || K.catalog.findIndex(c => c.id === a) - K.catalog.findIndex(c => c.id === b));
        for (const id of order) {
          const items = by.get(id), cat = K.catalog.find(c => c.id === id) || { id, label: id, icon: '◇', desc: '' };
          const isOpen = f.open[id] !== false || (focusKey && items.some(i => i.key === focusKey));
          const limit = (f.groupLimit[id] || LIMIT) + (focusKey ? Math.max(0, items.findIndex(i => i.key === focusKey) + 1 - LIMIT) : 0);
          const counts = { error: 0, warn: 0, info: 0 };
          for (const i of items) counts[i.severity]++;
          const head = h('button.ck-group-head', { type: 'button', 'aria-expanded': String(isOpen), title: isOpen ? 'Collapse' : 'Expand', onclick: () => { st.patch({ open: Object.assign({}, st.get().open, { [id]: !isOpen }) }); paintGroups(); } }, [
            h('span.ck-twisty', { text: isOpen ? '▾' : '▸' }),
            h('span.ck-group-ico', { text: cat.icon }),
            h('span.ck-group-name', [h('b', { text: cat.label }), h('span.gk-small.gk-muted.ck-group-desc', { text: cat.desc })]),
            h('span.ck-group-counts', ['error', 'warn', 'info'].filter(s => counts[s]).map(s => h('span.ck-pill.sev-' + s, { text: counts[s] + ' ' + (s === 'error' ? (counts[s] === 1 ? 'error' : 'errors') : s === 'warn' ? (counts[s] === 1 ? 'warning' : 'warnings') : (counts[s] === 1 ? 'note' : 'notes')) }))),
          ]);
          const body = h('div.ck-group-body');
          if (isOpen) {
            for (const it of items.slice(0, limit)) body.appendChild(issueEl(it));
            if (items.length > limit) body.appendChild(h('div.ck-more', [ui.button({ label: 'Show ' + Math.min(50, items.length - limit) + ' more of ' + (items.length - limit), small: true, kind: 'ghost', onClick: () => { st.patch({ groupLimit: Object.assign({}, st.get().groupLimit, { [id]: limit + 50 }) }); paintGroups(); } })]));
          }
          groups.appendChild(ui.panel({ cls: 'ck-group' + (isOpen ? ' open' : ''), body: [head, isOpen ? body : null] }));
        }
        if (focusKey) {
          const el = groups.querySelector('.ck-issue[data-key="' + CSS.escape(focusKey) + '"]');
          if (el) { setTimeout(() => { el.scrollIntoView({ block: 'center' }); el.focus({ preventScroll: true }); }, 60); setTimeout(() => el.classList.remove('flash'), 2400); }
          else if (all.some(i => i.key === focusKey && i.ignored)) { st.patch({ ignoredOpen: true }); }
          else ui.toast('That issue is already resolved', '✓');
          focusKey = null;
        }
      }

      /* ---------- marked as intended ---------- */
      async function paintIgnored() {
        GK.clear(ignoredBox);
        const marks = all.filter(i => i.ignored);
        const list = await WB.api('checks.ignored', WB.worldId).catch(() => []);
        if (!list.length) return;
        const isOpen = !!st.get().ignoredOpen, resolved = list.filter(x => !x.issue).length;
        const rows = isOpen ? list.map(x => {
          const it = x.issue;
          const note = ui.input({ value: x.note, placeholder: 'Why it is fine…', onChange: v => WB.api('checks.ignore', WB.worldId, x.key, v.trim()).then(() => ui.toast('Note saved', '◌', 1200)) });
          note.classList.add('ck-note');
          return h('div.ck-mark', { class: it ? '' : 'resolved' }, [
            h('div.ck-mark-main', [
              h('div.ck-mark-title', [it ? h('span.ck-mark-sev', { text: (K.SEV[it.severity] || K.SEV.info)[1] }) : h('span.ck-mark-sev', { text: '✓' }), h('span', { text: it ? it.title : 'Resolved — this issue no longer exists' })]),
              it ? K.chips(it) : null,
              note,
              h('div.gk-tiny.gk-faint', { text: 'Marked ' + WB.fmt.rel(x.at) }),
            ]),
            ui.button({ label: it ? 'Check it again' : 'Forget', small: true, title: it ? 'Bring the issue back to the open list' : 'Remove the mark', onClick: async () => { await WB.api('checks.unignore', WB.worldId, x.key); if (it) U.undoToast('Back on the list', () => WB.api('checks.ignore', WB.worldId, x.key, x.note)); } }),
          ]);
        }) : [];
        ignoredBox.appendChild(ui.panel({ cls: 'ck-ignoredpanel', body: [
          h('button.ck-group-head', { type: 'button', 'aria-expanded': String(isOpen), onclick: () => { st.patch({ ignoredOpen: !isOpen }); paintIgnored(); } }, [
            h('span.ck-twisty', { text: isOpen ? '▾' : '▸' }), h('span.ck-group-ico', { text: '◌' }),
            h('span.ck-group-name', [h('b', { text: 'Marked as intended' }), h('span.gk-small.gk-muted.ck-group-desc', { text: 'Issues you decided are fine. They stay quiet until what they are about changes.' })]),
            h('span.ck-group-counts', [h('span.ck-pill', { text: String(marks.length) }), resolved ? h('span.ck-pill.sev-pass', { text: resolved + ' resolved' }) : null]),
          ]),
          isOpen ? h('div.ck-marks', rows) : null,
          isOpen && resolved ? h('div.ck-more', [ui.button({ label: 'Forget the ' + resolved + ' resolved', small: true, kind: 'ghost', onClick: async () => { const r = await WB.api('checks.forgetResolved', WB.worldId); ui.toast('Forgot ' + r.n, '◌'); } })]) : null,
        ] }));
      }

      /* ---------- settings ---------- */
      function settingsPop(at) {
        const off = new Set(settings.off || []);
        const age = ui.input({ type: 'number', value: String(settings.minParentAge || 14) });
        age.classList.add('ck-age'); age.min = '1';
        const body = h('div.ck-settings', [
          h('b', { text: 'Checks to run' }),
          h('div.ck-settings-list', K.catalog.map(c => h('label.ck-setrow', { title: c.desc }, [h('span.ck-cat-ico', { text: c.icon }), h('span.gk-grow', { text: c.label }), ui.toggle({ value: !off.has(c.id), onChange: v => { if (v) off.delete(c.id); else off.add(c.id); } })]))),
          ui.field({ label: 'Youngest age to be a parent', hint: 'Below this, a parent is flagged as too young', inline: true, control: age }),
          h('div.gk-row', [h('span.gk-grow'), ui.button({ label: 'Save', small: true, kind: 'primary', onClick: async () => { pop.close(); settings = await WB.api('checks.settings', WB.worldId, { off: [...off], minParentAge: +age.value || 14 }); load(); } })]),
        ]);
        const pop = U.popover(at, body, { cls: 'ck-settings-pop', group: 'cksettings', width: '24em' });
      }

      function startWalk() {
        const list = filtered().length ? filtered() : open();
        if (!list.length) return ui.toast('Nothing to fix', '✓');
        K.walk(list, { start: 0, reload: async () => { await reload(); WB.api('checks.summary', WB.worldId).then(s => { summary = s; }); return filtered().length ? filtered() : open(); } });
      }

      function paint() { paintHero(); paintBar(); paintGroups(); paintIgnored(); }

      const changed = WB.debounce(() => { if (alive) load(); }, 300);
      const offs = [
        WB.onChange(['entries', 'links', 'media', 'map_items', 'board_items', 'worlds', 'issues_ignored', 'types', 'rel_types'], changed),
        WB.on('world', w => { if (!w || w.id !== mountedWorld) GK.shell.go('checks'); else changed(); }),
        WB.on('share', () => GK.shell.go('checks')),
      ];
      const onKey = e => {
        if (e.ctrlKey || e.altKey || e.metaKey || document.querySelector('.gk-scrim, .wb-pop') || (e.target.closest && e.target.closest('input, textarea, select, [contenteditable="true"]'))) return;
        if (e.key === 'f' || e.key === 'F') { e.preventDefault(); startWalk(); }
        else if (e.key === 'r' || e.key === 'R') { e.preventDefault(); load(true); }
      };
      document.addEventListener('keydown', onKey);
      current = { startWalk, load, focus: key => { focusKey = key; st.patch({ sev: '', check: '', q: '' }); paint(); } };
      await load();
      return () => { alive = false; current = null; offs.forEach(f => f()); document.removeEventListener('keydown', onKey); };
    },
  });

  /* ---------------- palette commands ---------------- */
  const when = () => !!WB.worldId;
  WB.commands.add({ id: 'checks:open', label: 'Check the world for continuity mistakes', icon: '⚖', group: 'Checks', when, run: () => WB.go('checks'), words: 'health continuity errors problems consistency lint' });
  WB.commands.add({ id: 'checks:walk', label: 'Fix the next continuity issue', icon: '➜', group: 'Checks', when, run: async () => { if (GK.shell.current !== 'checks' || !current) await WB.go('checks'); if (current) current.startWalk(); }, words: 'fix next issue walk' });
  WB.commands.add({ id: 'checks:recheck', label: 'Re-run the checks', icon: '↻', group: 'Checks', when, run: async () => { if (GK.shell.current !== 'checks' || !current) await WB.go('checks'); else current.load(true); } });

  /* ---------------- smoke ---------------- */
  let ran = 'did not run';
  WB.smoke('checks-run', async () => {
    await WB.go('checks');
    await WB.wait(700);
    const s = await WB.api('checks.summary', WB.worldId);
    const shown = document.querySelectorAll('.ck-issue').length, dialOk = !!document.querySelector('.ck-dial');
    const num = document.querySelector('.ck-dial-num b');
    const issues = await WB.api('checks.run', WB.worldId);
    const found = { lifespan: issues.some(i => i.check === 'lifespan' && i.severity === 'error'), duplicate: issues.some(i => i.check === 'duplicate') };
    ran = !dialOk ? 'error: no health dial' : num && +num.textContent !== s.score ? 'error: the dial shows ' + num.textContent + ' but the score is ' + s.score
      : s.total && !shown ? 'error: ' + s.total + ' issues but none on screen' : 'ok';
    return { score: s.score, counts: s.counts, shown, found, ran };
  });
  WB.smoke('checks-walk', async () => {
    if (!current) await WB.go('checks');
    current.startWalk();
    await WB.wait(400);
    const dlg = document.querySelector('.ck-walkdlg');
    const title = dlg && dlg.querySelector('.ck-walk-title');
    const out = { open: !!dlg, title: title ? title.textContent : null };
    document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
    await WB.wait(100);
    return out;
  });
  WB.check('checks: the screen shows the score and the open issues', () => { if (!/^ok/.test(ran)) throw new Error(ran); return true; });
})();
