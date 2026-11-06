/* Publish: a website for your world (settings, live preview, build to a folder), devlog posts, exports and imports.
   The tabs live in src/app/modules/publish/ and load on first use. Everything reader-facing is filtered in the main
   process by the one knowledge rule (audience, as-of date, secrets). */
(function () {
  'use strict';
  const { h, ui } = GK;
  const P = WB.pub = WB.pub || {};
  const DIR = 'src/app/modules/publish/';
  P.load = () => Promise.all(['site', 'posts', 'transfer'].map(n => WB.loadScript(DIR + n + '.js')));
  const TABS = [['site', '⌂ Website'], ['posts', '✦ Devlog'], ['export', '⇩ Export'], ['import', '⇧ Import']];
  P.TABS = TABS;
  /** view state kept per user (never world data) */
  const VIEW = { tab: 'site', device: 'desktop', level: 'shared', asOf: null, types: null, postFilter: 'all', postId: null, bibleCover: true, bibleToc: true, biblePage: false, packageMedia: true };

  /* ---------------- small shared helpers for the tabs ---------------- */
  P.LEVELS = [['author', 'Author', 'Everything, secrets included: for your own backups and tools'], ['shared', 'Shared', 'What players and readers may see (the player wiki)'], ['public', 'Public', 'Only what is public: safe to post anywhere']];
  P.debounce = WB.debounce;
  P.when = fn => (...a) => Promise.resolve().then(() => fn(...a)).catch(WB.fail);
  /** a row of "saved to …" with buttons to show it */
  P.result = (text, path, { folder } = {}) => h('div.pub-result', [
    h('span.pub-result-ico', { text: '✓' }),
    h('div.pub-result-main', [h('div', { text }), path ? h('div.gk-small.gk-muted.pub-path', { text: path, title: path }) : null]),
    path ? ui.button({ label: folder ? 'Open folder' : 'Show', small: true, kind: 'ghost', onClick: () => WB.api(folder ? 'publish.openFolder' : 'publish.reveal', path) }) : null,
  ]);
  /** a labelled field; a <label> only around a single input (a label around buttons would click the first one) */
  P.field = ({ label, control, hint }) => {
    const single = control && /^(INPUT|SELECT|TEXTAREA)$/.test(control.tagName);
    return h(single ? 'label.gk-field' : 'div.gk-field', [label ? h('span.gk-label', { text: label }) : null, control, hint ? h('span.gk-hint', { text: hint }) : null]);
  };
  P.busy = (btn, on, label) => { if (!btn) return; btn.disabled = !!on; if (on) { btn._label = btn.textContent; btn.replaceChildren(label || 'Working…'); } else if (btn._label) btn.replaceChildren(btn._label); };
  P.plural = (n, one, many) => WB.fmt.plural(n, one, many);

  GK.modules.register({
    id: 'publish',
    title: 'Publish',
    icon: '⇪',
    order: 120,
    subtitle: 'A website for your world, devlog posts, exports and imports.',
    async mount(page, ctx) {
      if (!WB.worldId) {
        page.appendChild(WB.ui.empty({ icon: '⇪', title: 'No world open', text: 'Publishing turns a world into a website, a devlog, a vault, a PDF or a package. Create or open a world first.', actions: [ui.button({ label: 'Create a world', kind: 'primary', icon: '✦', onClick: () => WB.newWorld() })] }));
        return;
      }
      if (WB.share) {
        // WB.setShare re-mounts the current screen, so leaving Share view brings the full screen back
        page.appendChild(WB.ui.empty({ icon: '◑', title: 'Publishing is an author tool', text: 'Share view shows what readers see. Leave it to build the website, write devlog posts, export or import. (The website and exports already hide everything private.)', actions: [ui.button({ label: 'Leave Share view', kind: 'primary', onClick: () => WB.setShare(false) })] }));
        return;
      }
      const loading = page.appendChild(h('div.gk-muted.gk-small', { text: 'Loading…' }));
      await P.load();
      loading.remove();
      const store = await (WB.store ? WB.store(ctx, VIEW) : ctx.store(VIEW));
      const params = WB.params('publish') || {};
      if (params.tab && TABS.some(t => t[0] === params.tab)) store.patch({ tab: params.tab });
      let tab = store.get().tab;
      if (!TABS.some(t => t[0] === tab)) tab = 'site';
      const tabs = ui.tabs({ tabs: TABS, value: tab, onChange: v => show(v) });
      tabs.classList.add('pub-tabs');
      const body = h('div.pub-body');
      page.append(tabs, body);
      let cleanup = null, worldId = WB.worldId, seq = 0;
      async function show(v, p) {
        const my = ++seq;
        tab = v; store.patch({ tab: v });
        tabs.querySelectorAll('button').forEach((b, i) => b.classList.toggle('on', TABS[i][0] === v));
        if (cleanup) { try { cleanup(); } catch (e) { console.error(e); } cleanup = null; }
        GK.clear(body);
        const fn = P[v === 'export' ? 'exports' : v === 'import' ? 'imports' : v];
        const c = await fn(body, { store, params: p || {}, go: show });
        if (my !== seq) { if (typeof c === 'function') c(); return; }
        cleanup = typeof c === 'function' ? c : null;
      }
      P.show = show;
      await show(tab, params);
      const offWorld = WB.on('world', w => { if (w && w.id !== worldId) { worldId = w.id; show(tab); } });
      const keys = e => {
        if (!e.altKey || e.ctrlKey) return;
        const i = ['1', '2', '3', '4'].indexOf(e.key);
        if (i >= 0) { e.preventDefault(); show(TABS[i][0]); }
      };
      document.addEventListener('keydown', keys);
      tabs.title = 'Alt+1…4 switch tabs';
      return () => { offWorld(); document.removeEventListener('keydown', keys); if (cleanup) cleanup(); P.show = null; };
    },
  });

  /* ---------------- palette commands ---------------- */
  const go = (tab, extra) => WB.go('publish', Object.assign({ tab }, extra || {}));
  const C = (id, label, icon, run, words) => WB.commands.add({ id: 'publish:' + id, label, icon, group: 'Publish', run, words: words || '', when: () => !!WB.worldId });
  C('site', 'Website: preview and settings', '⌂', () => go('site'), 'publish site web wiki preview theme');
  C('build', 'Build the website to a folder…', '⇪', () => go('site', { run: 'build' }), 'publish site export html static');
  C('new-post', 'New devlog post', '✦', () => go('posts', { run: 'new' }), 'blog news devlog post write');
  C('posts', 'Devlog posts', '✦', () => go('posts'), 'blog news schedule');
  C('package', 'Export world package (.wbworld)…', '⛁', () => go('export', { run: 'package' }), 'backup share move');
  C('vault', 'Export Markdown vault (Obsidian)…', '⇩', () => go('export', { run: 'vault' }), 'markdown obsidian notes md');
  C('csv', 'Export CSV per type…', '▤', () => go('export', { run: 'csv' }), 'spreadsheet excel sheets');
  C('json', 'Export JSON with schema…', '{}', () => go('export', { run: 'json' }), 'game engine unity godot data');
  C('pdf', 'Export PDF world bible…', '▣', () => go('export', { run: 'pdf' }), 'print book bible pdf');
  C('handout', 'Print a handout for one entry…', '✉', () => go('export', { run: 'handout' }), 'print card players pdf');
  C('import-package', 'Import a world package…', '⛁', () => go('import', { run: 'package' }), 'open restore wbworld');
  C('import-vault', 'Import a Markdown / Obsidian vault…', '⇧', () => go('import', { run: 'vault' }), 'markdown obsidian notes md');
  C('import-csv', 'Import CSV into a type…', '▤', () => go('import', { run: 'csv' }), 'spreadsheet excel rows');

  /* ---------------- smoke ---------------- */
  let siteResult = 'did not run', pkgResult = 'did not run';
  WB.smoke('publish-site-preview', async () => {
    P.lastPreview = null;
    await WB.go('publish', { tab: 'site' });
    const t0 = Date.now();
    while (!P.lastPreview && Date.now() - t0 < 12000) await WB.wait(100);
    const r = P.lastPreview;
    if (!r) return (siteResult = 'error: the preview did not build');
    const v = await WB.api('publish.verifySite', r.dir, []);
    const frame = document.querySelector('.pub-frame');
    for (let i = 0; i < 40 && frame && !frame.dataset.loaded; i++) await WB.wait(100);
    siteResult = v.ok && v.files >= 5 && frame && frame.dataset.loaded ? 'ok: ' + v.pages + ' pages, ' + v.files + ' files' : 'error: ' + (v.problems || []).join('; ') + (frame && frame.dataset.loaded ? '' : ' (preview frame not loaded)');
    return siteResult;
  });
  WB.check('publish: the site preview builds into a temp folder with its files', () => { if (!/^ok/.test(siteResult)) throw new Error(siteResult); return true; });
  WB.smoke('publish-export-package', async () => {
    const dir = await WB.api('publish.tempDir', 'smoke');
    const file = dir + (dir.includes('\\') ? '\\' : '/') + 'smoke.wbworld';
    const r = await WB.api('publish.exportPackage', WB.worldId, { file });
    const pv = await WB.api('publish.previewPackage', { file });
    await WB.go('publish', { tab: 'export' });
    await WB.wait(300);
    pkgResult = r && pv && pv.entries === r.entries && pv.name === WB.world.name ? 'ok: ' + r.entries + ' entries, ' + Math.round(r.bytes / 1024) + ' KB' : 'error: the package did not read back (' + JSON.stringify({ wrote: r && r.entries, read: pv && pv.entries }) + ')';
    return pkgResult;
  });
  WB.check('publish: a world package exports and reads back', () => { if (!/^ok/.test(pkgResult)) throw new Error(pkgResult); return true; });
  WB.smoke('publish-devlog', async () => { await WB.go('publish', { tab: 'posts' }); await WB.wait(300); return document.querySelector('.pub-posts') ? 'ok' : 'error: the devlog tab did not render'; });
})();
