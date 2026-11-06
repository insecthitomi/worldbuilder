/* App shell: title bar, navigation built from the module registry, and the view router. */
(function (root) {
  'use strict';
  const GK = root.GK, h = GK.h;
  let view, nav, crumb, tools, cleanup = null, current = null, shellStore = null, mountSeq = 0;
  let autoMq = null;   // optional auto-rail: below this window width the navigation folds to icons

  const ctxFor = (mod) => ({
    h, ui: GK.ui, settings: GK.settings, bus: GK.bus, toast: GK.ui.toast,
    go: (id) => GK.shell.go(id),
    store: (defaults) => GK.store(mod.id, defaults),
  });

  function renderNav() {
    GK.clear(nav);
    const mods = GK.modules.list().filter(m => m.nav);
    const main = mods.filter(m => !m.foot), foot = mods.filter(m => m.foot);
    const btn = m => h('button.gk-nav-btn', { type: 'button', class: m.id === current ? 'on' : '', title: m.title, onclick: () => GK.shell.go(m.id) }, [h('span.ico', { text: m.icon }), h('span.lbl', { text: m.title })]);
    main.forEach(m => nav.appendChild(btn(m)));
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

  GK.shell = {
    /** opts.autoRail: window width (px) at or below which the navigation folds to an icon rail (0 / absent = off). */
    async mount(app, opts = {}) {
      if (opts.autoRail != null) autoRail(opts.autoRail);
      shellStore = await GK.store('shell', { last: null, rail: false });
      document.documentElement.classList.toggle('nav-rail', !!shellStore.get().rail);
      const info = (await GK.host('app:info')) || { name: document.title };
      crumb = h('span.gk-crumb');
      tools = h('div.gk-row.nowrap.gk-title-tools');
      nav = h('nav.gk-nav.gk-panel');
      view = h('main.gk-view');
      app.appendChild(h('div.gk-shell', [
        h('header.gk-titlebar', [h('div.gk-brand', [h('img', { src: 'assets/icon.svg', alt: '' }), h('span', { text: info.name })]), h('span.gk-crumb', { text: '/' }), crumb, tools, windowControls()]),
        nav, view,
      ]));
      GK.bus.on('modules', renderNav);
      document.addEventListener('keydown', e => {
        if (!e.ctrlKey || e.altKey) return;
        if (e.key === ',') { e.preventDefault(); GK.shell.go('appearance'); }
        const n = +e.key;
        if (n >= 1 && n <= 9) { const m = GK.modules.list().filter(x => x.nav)[n - 1]; if (m) { e.preventDefault(); GK.shell.go(m.id); } }
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
      crumb.textContent = mod.title;
      GK.clear(view);
      const page = view.appendChild(h('div.gk-page'));
      if (mod.heading !== false) page.appendChild(h('div.gk-page-head', [h('div.gk-grow', [h('h1', { text: mod.title }), mod.subtitle && h('p', { text: mod.subtitle })])]));
      try {
        const c = await mod.mount(page, ctxFor(mod));
        // another go() started while this screen was still mounting: its cleanup must run now, not be lost
        if (my !== mountSeq) { if (typeof c === 'function') try { c(); } catch (e) { console.error(e); } return; }
        if (typeof c === 'function') cleanup = c;
      }
      catch (e) { if (my !== mountSeq) return; console.error(e); page.appendChild(GK.ui.panel({ title: 'This screen failed to load', icon: '⚠', body: h('pre.gk-small', { text: String(e && e.stack || e) }) })); }
      view.scrollTop = 0;
      shellStore.patch({ last: id });
      GK.bus.emit('navigate', id);
    },
    /** Put a small control in the title bar (right side, before the window buttons). */
    addTool(node) { tools.appendChild(node); return node; },
    /** Fold the navigation to icons at or below `px` window width; 0 turns it off. */
    autoRail,
    get current() { return current; },
  };
})(window);
