/* App shell: title bar, navigation built from the module registry, and the view router. */
(function (root) {
  'use strict';
  const GK = root.GK, h = GK.h;
  let view, nav, crumb, tools, hubbar, cleanup = null, current = null, shellStore = null, mountSeq = 0;
  let autoMq = null;   // optional auto-rail: below this window width the navigation folds to icons

  const ctxFor = (mod) => ({
    h, ui: GK.ui, settings: GK.settings, bus: GK.bus, toast: GK.ui.toast,
    go: (id) => GK.shell.go(id),
    store: (defaults) => GK.store(mod.id, defaults),
  });

  /* Hubs: the sidebar shows one button per group; the group's screens are tabs at the top of its pages.
     This table is the one place that says which screen lives in which group. A screen missing from the table is
     its own group (or uses `group` / `groupTitle` / `groupIcon` / `groupOrder` / `label` given at registration);
     a listed screen that is not registered (yet) is skipped. Every screen id still works with GK.shell.go(id). */
  const GROUPS = [
    { id: 'home', title: 'Home', icon: '⌂', order: 10, members: [['home', 'Home']] },
    { id: 'world', title: 'World', icon: '❖', order: 20, members: [['codex', 'Codex'], ['web', 'Connections'], ['chronicle', 'Timeline'], ['checks', 'Checks']] },
    { id: 'maps', title: 'Maps & Sim', icon: '⌖', order: 30, members: [['atlas', 'Atlas'], ['simulate', 'Simulate']] },
    { id: 'create', title: 'Create', icon: '✎', order: 40, members: [['write', 'Write'], ['boards', 'Boards'], ['lexicon', 'Lexicon']] },
    { id: 'play', title: 'Play', icon: '⚄', order: 50, members: [['toolkit', 'Toolkit']] },
    { id: 'collect', title: 'Collect', icon: '▣', order: 60, members: [['inbox', 'Inbox'], ['library', 'Library']] },
    { id: 'share', title: 'Share', icon: '⇪', order: 70, members: [['publish', 'Publish'], ['business', 'Business']] },
    { id: 'settings', title: 'Settings', icon: '⚙', order: 900, foot: true, members: [['world', 'World settings'], ['appearance', 'Look'], ['guide', 'Guide']] },
  ];

  /** The groups that currently have at least one registered screen, in order, each with its present members. */
  function buildGroups() {
    const out = [], seen = new Set();
    for (const g of GROUPS) {
      const members = g.members.map(([id, label]) => ({ mod: GK.modules.get(id), id, label })).filter(m => m.mod && m.mod.nav !== false);
      members.forEach(m => seen.add(m.id));
      if (members.length) out.push({ id: g.id, title: g.title, icon: g.icon, order: g.order, foot: !!g.foot, members });
    }
    // screens the table does not know: their own group, or a group they name themselves
    for (const m of GK.modules.list()) {
      if (seen.has(m.id) || m.nav === false) continue;
      let g = m.group && out.find(x => x.id === m.group);
      if (!g) { g = { id: m.group || m.id, title: m.groupTitle || m.title, icon: m.groupIcon || m.icon, order: m.groupOrder != null ? m.groupOrder : m.order, foot: !!m.foot, members: [] }; out.push(g); }
      g.members.push({ mod: m, id: m.id, label: m.label || m.title });
    }
    return out.sort((a, b) => a.order - b.order);
  }
  const groupOf = id => buildGroups().find(g => g.members.some(m => m.id === id)) || null;
  const lastIn = () => (shellStore && shellStore.get().lastIn) || {};
  /** The screen a group's sidebar button opens: the one used last in it, else its first. */
  function entryOf(g) { const last = lastIn()[g.id]; return (g.members.find(m => m.id === last) || g.members[0]).id; }

  function renderNav() {
    GK.clear(nav);
    const groups = buildGroups(), g0 = groupOf(current);
    const main = groups.filter(g => !g.foot), foot = groups.filter(g => g.foot);
    const btn = g => h('button.gk-nav-btn', { type: 'button', class: g0 && g.id === g0.id ? 'on' : '', title: g.members.length > 1 ? g.title + ': ' + g.members.map(m => m.label).join(', ') : g.title, 'data-members': g.members.map(m => m.id).join(' '), 'aria-current': g0 && g.id === g0.id ? 'page' : null, onclick: () => GK.shell.go(entryOf(g)) }, [h('span.ico', { text: g.icon }), h('span.lbl', { text: g.title })]);
    main.forEach(g => nav.appendChild(btn(g)));
    nav.appendChild(h('div.gk-nav-foot', [
      ...foot.map(btn),
      h('button.gk-nav-btn', { type: 'button', title: 'Collapse or expand the sidebar', onclick: () => {
        // with the auto-rail on, a narrow window starts as an icon rail: the button opens it there (not remembered)
        if (autoMq && autoMq.matches) { document.documentElement.classList.toggle('nav-open'); return; }
        document.documentElement.classList.toggle('nav-rail'); shellStore && shellStore.patch({ rail: document.documentElement.classList.contains('nav-rail') });
      } }, [h('span.ico', { text: '⇆' }), h('span.lbl', { text: 'Collapse' })]),
    ]));
  }

  function syncAutoRail() {
    const r = document.documentElement, narrow = !!(autoMq && autoMq.matches);
    r.classList.toggle('nav-auto', narrow);
    if (!narrow) r.classList.remove('nav-open');
  }
  function autoRail(px) {
    if (autoMq) autoMq.removeEventListener('change', syncAutoRail);
    autoMq = +px > 0 ? matchMedia(`(max-width: ${+px}px)`) : null;
    if (autoMq) autoMq.addEventListener('change', syncAutoRail);
    syncAutoRail();
  }

  /* Window buttons: the windows are frameless in both hosts, so minimize / maximize-restore / close are ordinary
     Glass Kit controls and take the look (material, outline, text outline, colours) like every other button. */
  function windowControls() {
    const btn = (cls, icon, label, call) => {
      const b = GK.ui.button({ small: true, icon, title: label, onClick: () => GK.host(call).catch(e => console.error(e)) });
      b.classList.add('gk-wc', cls);
      b.setAttribute('aria-label', label);
      return b;
    };
    const max = btn('wc-max', '□', 'Maximize', 'win:toggleMaximize');
    const paint = (st) => {
      st = st || {};
      if (typeof st.maximized === 'boolean') {
        const label = st.maximized ? 'Restore' : 'Maximize';
        max.firstChild.textContent = st.maximized ? '❐' : '□';
        max.title = label; max.setAttribute('aria-label', label);
        max.classList.toggle('on-max', st.maximized);
        document.documentElement.classList.toggle('win-max', st.maximized);
      }
      if (typeof st.focused === 'boolean') document.documentElement.classList.toggle('win-inactive', !st.focused);
    };
    if (root.host && root.host.on) root.host.on('window-state', paint);
    GK.host('win:isMaximized').then(m => paint({ maximized: !!m, focused: document.hasFocus() })).catch(() => {});
    return h('div.gk-winctl', { role: 'group', 'aria-label': 'Window' }, [
      btn('wc-min', '—', 'Minimize', 'win:minimize'), max, btn('wc-close', '✕', 'Close', 'win:close'),
    ]);
  }

  /* The tab strip of a hub: one tab per screen of the group, the open one marked; arrow keys move between them. */
  function paintHub(g, id) {
    GK.clear(hubbar);
    hubbar.hidden = !g;
    if (!g) return;
    const tabs = g.members.map(m => h('button', { type: 'button', role: 'tab', class: m.id === id ? 'on' : '', 'aria-selected': m.id === id ? 'true' : 'false', tabindex: m.id === id ? '0' : '-1', title: m.mod.subtitle || m.label, 'data-member': m.id, onclick: () => { if (m.id !== current) GK.shell.go(m.id); } }, m.label));
    const strip = h('div.gk-tabs', { role: 'tablist', 'aria-label': g.title }, tabs);
    strip.addEventListener('keydown', e => {
      const i = tabs.indexOf(document.activeElement);
      if (i < 0 || !['ArrowLeft', 'ArrowRight', 'Home', 'End'].includes(e.key)) return;
      e.preventDefault();
      const to = e.key === 'Home' ? 0 : e.key === 'End' ? tabs.length - 1 : (i + (e.key === 'ArrowRight' ? 1 : -1) + tabs.length) % tabs.length;
      GK.shell.go(g.members[to].id).then(() => { const b = hubbar.querySelector('[data-member="' + g.members[to].id + '"]'); if (b) b.focus(); });
    });
    hubbar.appendChild(strip);
  }

  GK.shell = {
    /** opts.autoRail: window width (px) at or below which the navigation folds to an icon rail (0 / absent = off). */
    async mount(app, opts = {}) {
      if (opts.autoRail != null) autoRail(opts.autoRail);
      shellStore = await GK.store('shell', { last: null, rail: false, lastIn: {} });
      document.documentElement.classList.toggle('nav-rail', !!shellStore.get().rail);
      const info = (await GK.host('app:info')) || { name: document.title };
      crumb = h('span.gk-crumb');
      tools = h('div.gk-row.nowrap.gk-title-tools');
      nav = h('nav.gk-nav.gk-panel');
      hubbar = h('div.gk-hubbar', { hidden: true });
      view = h('main.gk-view');
      app.appendChild(h('div.gk-shell', [
        h('header.gk-titlebar', [h('div.gk-brand', [h('img', { src: 'assets/icon.svg', alt: '' }), h('span', { text: info.name })]), h('span.gk-crumb', { text: '/' }), crumb, tools, windowControls()]),
        nav, h('div.gk-main', [hubbar, view]),
      ]));
      GK.bus.on('modules', renderNav);
      document.addEventListener('keydown', e => {
        if (!e.ctrlKey || e.altKey) return;
        if (e.key === ',') { e.preventDefault(); GK.shell.go('appearance'); }
        const n = +e.key;
        if (n >= 1 && n <= 9) { const g = buildGroups().filter(x => !x.foot)[n - 1]; if (g) { e.preventDefault(); GK.shell.go(entryOf(g)); } }
      });
      const first = GK.modules.list().find(m => m.nav);
      await GK.shell.go((GK.modules.get(shellStore.get().last) && shellStore.get().last) || (first && first.id));
    },

    async go(id) {
      const mod = GK.modules.get(id);
      if (!mod) return;
      if (cleanup) { try { cleanup(); } catch (e) { console.error(e); } cleanup = null; }
      const my = ++mountSeq;
      current = id;
      renderNav();
      const grp = groupOf(id), hub = !!(grp && grp.members.length > 1), mem = grp && grp.members.find(m => m.id === id);
      crumb.textContent = hub ? grp.title + ' / ' + mem.label : mod.title;
      paintHub(hub ? grp : null, id);
      GK.clear(view);
      const page = view.appendChild(h('div.gk-page'));
      if (mod.heading !== false && !hub) page.appendChild(h('div.gk-page-head', [h('div.gk-grow', [h('h1', { text: mod.title }), mod.subtitle && h('p', { text: mod.subtitle })])]));
      try {
        const c = await mod.mount(page, ctxFor(mod));
        // another go() started while this screen was still mounting: its cleanup must run now, not be lost
        if (my !== mountSeq) { if (typeof c === 'function') try { c(); } catch (e) { console.error(e); } return; }
        if (typeof c === 'function') cleanup = c;
      }
      catch (e) { if (my !== mountSeq) return; console.error(e); page.appendChild(GK.ui.panel({ title: 'This screen failed to load', icon: '⚠', body: h('pre.gk-small', { text: String(e && e.stack || e) }) })); }
      view.scrollTop = 0;
      if (grp) shellStore.patch({ last: id, lastIn: Object.assign({}, lastIn(), { [grp.id]: id }) }); else shellStore.patch({ last: id });
      GK.bus.emit('navigate', id);
    },
    /** The groups (hubs) as shown in the sidebar: [{ id, title, icon, foot, members: [{ id, label, mod }] }]. */
    groups: buildGroups,
    /** The group a screen belongs to, and its label inside it: { group, label } or null. */
    groupOf: id => { const g = groupOf(id); const m = g && g.members.find(x => x.id === id); return g ? { group: g, label: m.label } : null; },
    /** Put a small control in the title bar (right side, before the window buttons). */
    addTool(node) { tools.appendChild(node); return node; },
    /** Fold the navigation to icons at or below `px` window width; 0 turns it off. */
    autoRail,
    get current() { return current; },
  };
})(window);
