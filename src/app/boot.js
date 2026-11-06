/* Boot: settings first (so the first paint is already themed), the world, then the shell and Worldbuilder's tools. */
(async function () {
  'use strict';
  const { h, ui, settings } = GK;
  await settings.load();
  const info = (await GK.host('app:info')) || {};
  let hasWorld = await WB.init();
  // smoke runs start from empty storage: they get the example world
  if (info.smoke && !hasWorld) { const w = await WB.api('worlds.sample'); await WB.setWorld(w.id, { quiet: true }); hasWorld = true; }
  await GK.shell.mount(document.getElementById('app'), { autoRail: 1366 });
  WB.initChrome();

  // title-bar quick switch: glass ⇄ solid for every surface (a labelled button, so its glass fits its text)
  const quickText = () => (settings.get('matAll') === 'solid' ? '■ Solid' : '◇ Glass');
  const quick = GK.shell.addTool(ui.button({ small: true, label: quickText(), title: 'Glass or solid surfaces', onClick: () => settings.set('matAll', settings.get('matAll') === 'solid' ? 'glass' : 'solid') }));
  const paint = () => { const t = quickText(); if (quick.textContent !== t) quick.replaceChildren(t); };
  GK.bus.on('applied', paint); paint();

  // smoke test (npm test)
  const lensed = () => document.querySelectorAll('[data-aerolens="edge"], [data-prism]').length;
  const failed = () => [...document.querySelectorAll('.gk-view .gk-panel h3')].some(x => x.textContent === 'This screen failed to load');
  GK.smoke.step('home-glass', async () => { settings.reset(); await GK.shell.go('home'); await WB.wait(400); return { lensed: lensed(), world: WB.world && WB.world.name }; });
  GK.smoke.step('codex-glass', async () => { await GK.shell.go('codex'); await WB.wait(500); return { lensed: lensed() }; });
  GK.smoke.step('codex-solid', async () => { settings.patch({ matAll: 'solid', solidPanel: '#2a1f3d' }); return { lensed: lensed(), mat: document.documentElement.dataset.matPanel }; });
  GK.smoke.step('appearance-studio', async () => { settings.reset(); await GK.shell.go('appearance'); return { categories: GK.studio.categories() }; });
  GK.smoke.step('appearance-search', async () => {
    const s = document.querySelector('.gk-st-search'); s.value = 'highlight'; s.dispatchEvent(new Event('input'));
    return { rows: document.querySelectorAll('.gk-st-results .gk-st-row').length };
  });
  GK.smoke.step('appearance-text', async () => { settings.patch({ matAll: 'glass', olStyle: 'smooth', olWidth: 2, tbgA: 40, backdrop: 'sunset' }); await GK.shell.go('appearance'); return 'ok'; });
  GK.smoke.step('appearance-light', async () => { settings.applyLook('Aero sky'); await GK.shell.go('appearance'); return 'ok'; });
  // every screen opens without the failure panel
  let screens = 'did not run';
  GK.smoke.step('all-screens', async () => {
    settings.reset();
    const bad = [];
    for (const m of GK.modules.list()) { await GK.shell.go(m.id); await WB.wait(350); if (failed()) bad.push(m.id); }
    screens = bad.length ? 'error: these screens failed: ' + bad.join(', ') : 'ok: ' + GK.modules.list().length + ' screens';
    await GK.shell.go('home');
    return screens;
  });
  GK.smoke.check('every screen opens', () => { if (!/^ok/.test(screens)) throw new Error(screens); return true; });
  // window buttons: present, labelled, and the maximized query answers (never minimized/closed in a smoke run)
  // (asked now, not in a step: the step list can be read before boot gets here; checks run last)
  let winMax = 'pending';
  const hosted = !!window.host;
  GK.host('win:isMaximized').then(v => { winMax = v; }, e => { winMax = 'error: ' + e.message; });
  GK.smoke.check('title bar has labelled window buttons (minimize, maximize/restore, close)', () => {
    const b = [...document.querySelectorAll('.gk-titlebar .gk-winctl > .gk-btn.gk-control')];
    return b.length === 3 && b.every(x => x.getAttribute('aria-label') && x.title) &&
      b[0].getAttribute('aria-label') === 'Minimize' && /^(Maximize|Restore)$/.test(b[1].getAttribute('aria-label')) && b[2].getAttribute('aria-label') === 'Close';
  });
  GK.smoke.check('win:isMaximized resolves to a boolean', () => !hosted || typeof winMax === 'boolean');
  GK.smoke.check('quick glass/solid switch is a labelled button', () => { const q = document.querySelector('.gk-title-tools > .gk-btn[title="Glass or solid surfaces"]'); return !!q && !q.classList.contains('icon') && /Glass|Solid/.test(q.textContent); });
  GK.smoke.check('studio shows the kit categories and Worldbuilder\'s', () => {
    const c = GK.studio.categories();
    return ['quick', 'looks', 'background', 'glass', 'colors', 'text', 'spacing', 'motion', 'graphics', 'profiles', 'wb'].every(k => c.includes(k));
  });
  GK.smoke.check('modules registered', () => GK.modules.list().length >= 15);
  GK.smoke.check('shell rendered', () => !!document.querySelector('.gk-shell .gk-nav-btn'));
  GK.smoke.check('sidebar has about eight groups, each screen in one', () => { const g = GK.shell.groups(), ids = g.flatMap(x => x.members.map(m => m.id)); return g.filter(x => !x.foot).length <= 9 && g.length >= 6 && ids.length === new Set(ids).size && GK.modules.list().filter(m => m.nav !== false).every(m => ids.includes(m.id)); });
  GK.smoke.check('a world is open', () => !!WB.worldId && WB.types.size > 10);
  GK.smoke.check('solid panel ink contrasts', () => { settings.patch({ matAll: 'solid', solidPanel: '#fafafa', inkMode: 'auto' }); return getComputedStyle(document.documentElement).getPropertyValue('--solid-panel-ink').trim() === '#10161f'; });
  GK.smoke.check('solid surfaces are not refracted', () => { settings.patch({ matAll: 'solid' }); return lensed() === 0; });
  GK.smoke.check('glass panels are refracted', () => { settings.reset(); return document.documentElement.classList.contains('lensed'); });
  GK.smoke.check('button text stays sharp (no backdrop filter on controls)', () => !document.querySelector('.gk-control[data-aerolens]'));
  GK.smoke.check('glass renderer active', () => { settings.reset(); return ['prism', 'lens'].includes(document.documentElement.dataset.glass); });
  GK.smoke.check('Prism draws the glass where the GPU path exists', () => !(window.Prism && Prism.supported()) || (Prism.active && Prism.stats.surfaces > 0));
  // alignment under a UI scale: the app fits the window, things placed from a measurement land where measured, hairlines are whole pixels
  let aligned = 'did not run';
  GK.smoke.step('alignment', async () => {
    const frames = (n = 3) => new Promise(r => { const f = () => (n-- > 0 ? requestAnimationFrame(f) : setTimeout(r, 30)); f(); });
    const out = {}, scale0 = settings.get('scale');
    try {
      settings.patch({ scale: 1.25 }); await frames();
      const app = document.getElementById('app');
      // GK.rectIn inside a zoomed, bordered, scrolled layer
      const target = app.appendChild(h('div', { style: { position: 'fixed', left: '237.3px', top: '141.7px', width: '53px', height: '21px' } }));
      const layer = app.appendChild(h('div', { style: { position: 'fixed', left: '80px', top: '60px', width: '600px', height: '300px', overflow: 'auto', border: '3px solid transparent' } }, [h('div', { style: { height: '2000px', width: '2000px' } })]));
      layer.scrollTop = 40; layer.scrollLeft = 25;
      const b = GK.rectIn(layer, target.getBoundingClientRect()), placed = layer.appendChild(h('div', { style: { position: 'absolute', left: b.left + 'px', top: b.top + 'px', width: b.width + 'px', height: b.height + 'px' } }));
      const tr = target.getBoundingClientRect(), pr = placed.getBoundingClientRect();
      out.rectIn = Math.max(Math.abs(tr.left - pr.left), Math.abs(tr.top - pr.top), Math.abs(tr.width - pr.width), Math.abs(tr.height - pr.height));
      target.remove(); layer.remove();
      // nothing hangs below or beside the window
      const edge = sel => [...document.querySelectorAll(sel)].filter(e => e.offsetParent).map(e => e.getBoundingClientRect()).map(r => Math.max(r.bottom - innerHeight, r.right - innerWidth));
      out.overflow = Math.round(Math.max(0, document.documentElement.scrollHeight - innerHeight, document.documentElement.scrollWidth - innerWidth, ...edge('#app, .gk-shell, .gk-nav, .gk-titlebar, .gk-view')));
      // hairlines are whole device pixels inside the scaled app
      const hair = parseFloat(getComputedStyle(app).getPropertyValue('--hair')) * app.currentCSSZoom * (devicePixelRatio || 1);
      out.hair = Math.abs(hair - Math.round(hair));
    } finally { settings.patch({ scale: scale0 }); await frames(); }
    aligned = out.rectIn <= 1 && out.overflow <= 1 && out.hair < .01 ? 'ok: ' + JSON.stringify(out) : 'error: ' + JSON.stringify(out);
    return aligned;
  });
  GK.smoke.check('alignment at 125% scale: the app fits the window, placed = measured, crisp hairlines', () => { if (!/^ok/.test(aligned)) throw new Error(aligned); return true; });
  // hubs: a sidebar group opens its last-used screen, its tab strip switches screens, WB.go(member id) still works
  GK.smoke.step('hubs', async () => {
    const out = {}, wait = (ms) => new Promise(r => setTimeout(r, ms));
    const grpBtn = (m) => document.querySelector('.gk-nav-btn[data-members~="' + m + '"]');
    const tabs = () => [...document.querySelectorAll('.gk-hubbar .gk-tabs > button')];
    await WB.go('chronicle'); await wait(300);
    out.crumb = document.querySelector('.gk-titlebar .gk-crumb:last-of-type').textContent;
    out.tabs = tabs().map(b => b.textContent).join(',');
    out.on = (tabs().find(b => b.classList.contains('on')) || {}).textContent;
    await WB.go('home'); await wait(200);
    grpBtn('codex').click(); await wait(400);
    out.reopened = GK.shell.current;
    const web = tabs().find(b => b.textContent === 'Connections'); web && web.click(); await wait(400);
    out.switched = GK.shell.current;
    await WB.go('home'); await wait(200);
    grpBtn('codex').click(); await wait(400);
    out.remembered = GK.shell.current;
    await WB.go('world', { tab: 'calendar' }); await wait(500);
    out.worldLeaf = !!document.querySelector('.wd-prev-big');
    out.settingsTabs = tabs().map(b => b.textContent).join(',');
    await WB.go('home'); await wait(200);
    out.noStrip = tabs().length === 0;
    const ok = out.crumb === 'World / Timeline' && out.tabs.startsWith('Codex,Connections,Timeline') && out.on === 'Timeline' && out.reopened === 'chronicle' && out.switched === 'web' && out.remembered === 'web' && out.worldLeaf && /World settings,Look,Guide/.test(out.settingsTabs) && out.noStrip;
    return ok ? 'ok: ' + JSON.stringify(out) : 'error: ' + JSON.stringify(out);
  });
  // each screen's own steps and checks (queued with WB.smoke / WB.check), after the example world exists
  for (const [kind, name, fn] of WB.smokeQueue) { if (kind === 'step') GK.smoke.step(name, async () => { settings.reset(); return fn(); }); else GK.smoke.check(name, fn); }
  GK.smoke.ready = true;   // the smoke harness waits for this before reading the steps
})().catch(e => { console.error(e); document.body.appendChild(GK.h('pre', { text: 'Startup failed:\n' + (e && e.stack || e), style: { color: '#fff', padding: '20px', position: 'relative', zIndex: 5 } })); });
