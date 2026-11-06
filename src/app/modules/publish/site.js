/* Publish › Website: site settings on the left, a live preview of the built site on the right (an iframe on a temp
   build that rebuilds whenever the world or the settings change), "Build to folder…" and "Open folder". */
(function () {
  'use strict';
  const { h, ui } = GK;
  const P = WB.pub;
  const THEMES = [
    ['parchment', 'Parchment', 'Warm paper and book serif', ['#efe3c8', '#33271a', '#9a4a1f']],
    ['night', 'Night', 'Deep blue, glowing accent', ['#0d1220', '#e8ecf6', '#7aa2ff']],
    ['clean', 'Clean', 'White, airy, wiki-like', ['#f6f7f9', '#1b2130', '#2f6fde']],
    ['codex', 'Codex', 'Leather sidebar, cream pages', ['#2a1c15', '#ece2cd', '#b0442c']],
  ];
  const ACCENTS = ['#9a4a1f', '#b0442c', '#c4862b', '#4f8a3a', '#2f8a7a', '#2f6fde', '#6b55c8', '#b24a8a'];
  const DEVICES = [['desktop', '🖥 Desktop', 'Full width'], ['tablet', '▭ Tablet', '820 px wide'], ['phone', '▯ Phone', '390 px wide']];
  const SECTIONS = [['maps', 'Interactive maps', 'Map pages with zoom, pins and regions from the Atlas'], ['chronology', 'Chronology', 'Every dated entry in order, on your calendar'],
    ['family', 'Family trees', 'Families from parent, spouse and sibling relations'], ['devlog', 'Devlog & RSS feed', 'Published posts and a feed readers can follow'],
    ['shop', 'Shop', 'Products with prices, buy links and featured reviews'], ['search', 'Search', 'A search box that works offline'], ['index', 'A–Z index', 'Every page in one alphabetical list']];

  P.site = async function (host, { store, params }) {
    const worldId = WB.worldId;
    let s = await WB.api('publish.settings', worldId);
    let typesOn = await WB.api('publish.siteTypes', worldId);
    let counts = null, preview = null, building = false, again = false, curPage = params.page || 'index.html', scrollY = 0, alive = true;
    const offs = [];

    /* ---------- saving ---------- */
    const save = async patch => {
      Object.assign(s, patch);
      try { s = await WB.api('publish.saveSettings', worldId, patch); } catch (e) { WB.fail(e); }
      if ('audience' in patch || 'asOf' in patch) loadCounts();
      if ('types' in patch || 'sections' in patch) typesOn = await WB.api('publish.siteTypes', worldId);
      rebuild();
    };
    // typing saves after a pause; whatever is pending is saved when the tab closes
    let pendingPatch = null, saveTimer = null;
    const flushSave = () => { clearTimeout(saveTimer); if (pendingPatch) { const p = pendingPatch; pendingPatch = null; save(p); } };
    const saveSoon = patch => { pendingPatch = Object.assign(pendingPatch || {}, patch); clearTimeout(saveTimer); saveTimer = setTimeout(flushSave, 450); };

    /* ---------- the settings column ---------- */
    const field = (label, control, hint) => P.field({ label, control, hint });
    const text = (key, placeholder) => { const i = ui.input({ value: s[key] || '', placeholder, onInput: v => saveSoon({ [key]: v }) }); i.addEventListener('blur', flushSave); return i; };
    const coverBox = h('div.pub-cover');
    const paintCover = () => {
      GK.clear(coverBox);
      const id = s.coverId || WB.world.coverId;
      coverBox.append(
        id ? WB.ui.thumb(id, { cls: 'pub-cover-img' }) : h('div.pub-cover-img.empty', { text: 'No cover' }),
        h('div.gk-row', [
          ui.button({ label: id ? 'Change…' : 'Choose…', small: true, onClick: async () => { const m = await WB.ui.pickMedia({ kind: 'image', title: 'A cover for the home page' }); if (m) { await save({ coverId: m.id }); paintCover(); } } }),
          s.coverId ? ui.button({ label: WB.world.coverId ? 'Use world cover' : 'Remove', small: true, kind: 'ghost', onClick: async () => { await save({ coverId: null }); paintCover(); } }) : null,
        ]),
        h('div.gk-tiny.gk-faint', { text: s.coverId ? 'Only on the website.' : WB.world.coverId ? 'The world\'s cover.' : 'Shown behind the title on the home page.' }),
      );
    };
    paintCover();

    const themeGrid = h('div.pub-themes', { role: 'radiogroup', 'aria-label': 'Theme' });
    const paintThemes = () => {
      GK.clear(themeGrid);
      for (const [key, label, desc, [bg, ink, acc]] of THEMES) {
        const a = /^#[0-9a-f]{6}$/i.test(s.accent || '') ? s.accent : acc;
        themeGrid.appendChild(h('button.pub-theme', { type: 'button', role: 'radio', 'aria-checked': String(s.theme === key), class: s.theme === key ? 'on' : '', title: desc, onclick: () => { save({ theme: key }); paintThemes(); paintAccent(); } }, [
          h('span.pub-theme-swatch', { style: { '--bg': bg, '--ink': ink, '--acc': a } }, [h('i'), h('b'), h('em')]),
          h('span.pub-theme-name', { text: label }), h('span.gk-tiny.gk-muted', { text: desc }),
        ]));
      }
    };
    paintThemes();
    const accentBox = h('div.pub-accents');
    const paintAccent = () => {
      GK.clear(accentBox);
      const def = (THEMES.find(t => t[0] === s.theme) || THEMES[0])[3][2];
      const cur = /^#[0-9a-f]{6}$/i.test(s.accent || '') ? s.accent : def;
      for (const c of ACCENTS) accentBox.appendChild(h('button.pub-dot', { type: 'button', class: c.toLowerCase() === cur.toLowerCase() ? 'on' : '', style: { '--c': c }, title: c, 'aria-label': 'Accent ' + c, onclick: () => { save({ accent: c }); paintAccent(); paintThemes(); } }));
      accentBox.appendChild(ui.color({ value: cur, onInput: v => { s.accent = v; saveSoon({ accent: v }); paintThemes(); } }));
      if (s.accent) accentBox.appendChild(ui.button({ label: 'Theme colour', small: true, kind: 'ghost', title: 'Use the theme\'s own accent', onClick: () => { save({ accent: '' }); paintAccent(); paintThemes(); } }));
    };
    paintAccent();

    const audHint = h('div.gk-tiny.gk-faint');
    const paintAudHint = () => { audHint.textContent = s.audience === 'shared' ? 'A player wiki: Shared and Public entries, without secrets. Host it privately or share the folder with your table.' : 'Only Public entries, without secrets. Safe to put on the open web.'; };
    paintAudHint();
    const audience = ui.segmented({ value: s.audience, options: [['public', 'Public', 'Only entries marked Public'], ['shared', 'Shared (player wiki)', 'Shared and Public entries']], onChange: v => { save({ audience: v }); paintAudHint(); } });
    const asOfHint = h('div.gk-tiny.gk-faint');
    const paintAsOf = () => { asOfHint.textContent = s.asOf == null ? 'Follows the world\'s today (' + WB.fmt.date(WB.now) + '). Entries with a later reveal date stay hidden.' : 'Readers see the world as it stood on this day: later reveals stay hidden.'; };
    paintAsOf();
    const asOf = WB.ui.dateInput({ value: s.asOf == null ? null : { day: s.asOf, prec: 'day' }, placeholder: 'World today', onChange: d => { save({ asOf: d ? d.day : null }); paintAsOf(); } });

    const sectionsBox = h('div.pub-toggles');
    for (const [key, label, hint] of SECTIONS) {
      sectionsBox.appendChild(h('div.pub-toggle', { title: hint }, [h('div.gk-grow', [h('div', { text: label }), h('div.gk-tiny.gk-faint', { text: hint })]),
        ui.toggle({ value: s.sections[key] !== false, title: hint, onChange: v => save({ sections: { [key]: v } }) })]));
    }

    const typesBox = h('div.wb-chips.pub-types');
    const paintTypes = () => {
      GK.clear(typesBox);
      for (const t of WB.typeList()) {
        const n = counts ? counts.byType[t.key] || 0 : null, on = typesOn.includes(t.key);
        const c = ui.chip({ label: t.icon + ' ' + t.plural + (n != null ? ' · ' + n : ''), on, title: on ? 'On the site: click to leave out' : 'Left out: click to include', onClick: () => {
          const next = on ? typesOn.filter(k => k !== t.key) : typesOn.concat(t.key);
          typesOn = next; save({ types: next }); paintTypes();
        } });
        c.style.setProperty('--c', t.color);
        if (!n) c.classList.add('pub-chip-empty');
        typesBox.appendChild(c);
      }
    };
    const typesFoot = h('div.gk-row.pub-types-foot', [
      ui.button({ label: 'Defaults', small: true, kind: 'ghost', title: 'Characters, places, factions, lore, maps, posts, products…', onClick: async () => { await save({ types: null }); paintTypes(); } }),
      ui.button({ label: 'Everything', small: true, kind: 'ghost', onClick: () => { typesOn = WB.typeList().map(t => t.key); save({ types: typesOn }); paintTypes(); } }),
    ]);
    async function loadCounts() {
      counts = await WB.api('publish.counts', worldId, { level: s.audience, asOf: s.asOf }).catch(() => null);
      if (alive) paintTypes();
    }

    const featBox = h('div.wb-chips.pub-featured');
    const paintFeatured = () => {
      GK.clear(featBox);
      for (const id of s.featured || []) if (WB.liteOf(id)) featBox.appendChild(WB.ui.chip(id, { size: 'sm', onRemove: () => { save({ featured: s.featured.filter(x => x !== id) }); paintFeatured(); } }));
      if (!(s.featured || []).length) featBox.appendChild(h('span.gk-small.gk-muted', { text: 'Your favourites (★) are featured.' }));
      featBox.appendChild(ui.button({ label: 'Add…', icon: '＋', small: true, kind: 'ghost', onClick: async () => {
        const pick = await WB.ui.pickEntry({ title: 'Feature on the home page', multi: true, exclude: s.featured || [] });
        if (pick && pick.length) { save({ featured: (s.featured || []).concat(pick.map(e => e.id)).slice(0, 12) }); paintFeatured(); }
      } }));
    };
    paintFeatured();

    const group = (title, kids, sub) => h('section.pub-group', [WB.ui.sectionHead(title, null, sub), ...kids]);
    const knowBox = h('div.pub-know');
    const lastBox = h('div.pub-last');
    const buildBtn = ui.button({ label: 'Build to folder…', icon: '⇪', kind: 'primary', title: 'Write the website into a folder you choose', onClick: () => buildTo() });
    const settingsCol = h('div.pub-site-side', [
      ui.panel({ title: 'Website', icon: '⌂', cls: 'pub-settings', actions: [buildBtn], body: [
        lastBox,
        group('Identity', [
          field('Title', text('title', WB.world.name)),
          field('Tagline', text('tagline', 'A line under the title')),
          field('Cover', coverBox),
          field('Footer', text('footer', '© ' + WB.world.name)),
          field('Site address', text('baseUrl', 'https://example.com/my-world/'), 'Optional. Gives the RSS feed and sitemap full links.'),
        ]),
        group('Look', [field('Theme', themeGrid), field('Accent colour', accentBox)]),
        group('Readers', [field('Audience', h('div.gk-stack', [audience, audHint])), field('As of', h('div.gk-stack', [asOf, asOfHint])), knowBox], 'One rule decides what readers see.'),
        group('Pages', [sectionsBox]),
        group('Entry types', [typesBox, typesFoot], 'Counts are entries this audience may see.'),
        group('Featured on the home page', [featBox]),
      ] }),
    ]);

    /* ---------- the preview ---------- */
    const frame = h('iframe.pub-frame', { title: 'Website preview', loading: 'eager' });
    const frameWrap = h('div.pub-frame-wrap', [frame]);
    const zoomNote = h('span.pub-zoom.gk-tiny.gk-faint');
    // the page renders at a real device width (the site's own CSS px) and is scaled down when the pane is narrower
    const WIDTH = { desktop: 1280, tablet: 820, phone: 390 };
    let dev = store.get().device in WIDTH ? store.get().device : 'desktop';
    const fit = () => {
      const W = frameWrap.clientWidth, H = frameWrap.clientHeight;
      if (!W || !H) return;
      const virt = dev === 'desktop' ? Math.max(W, WIDTH.desktop) : WIDTH[dev], k = Math.min(1, W / virt);
      frame.style.width = virt + 'px'; frame.style.height = Math.round(H / k) + 'px';
      frame.style.transform = k < 1 ? 'scale(' + k + ')' : '';
      zoomNote.textContent = k < .995 ? Math.round(k * 100) + '%' : '';
      zoomNote.title = k < .995 ? 'Shown at ' + Math.round(k * 100) + '% of a ' + virt + ' px wide screen' : '';
    };
    const setDevice = v => { dev = v; frameWrap.dataset.device = v; frameWrap.style.width = v === 'tablet' ? 'min(100%, 820px)' : v === 'phone' ? 'min(100%, 390px)' : ''; requestAnimationFrame(fit); };
    setDevice(dev);
    offs.push(GK.bus.on('layout', () => fit()));
    const ro = new ResizeObserver(() => fit());
    ro.observe(frameWrap);
    offs.push(() => ro.disconnect());
    const where = h('button.pub-where.gk-ellipsis', { type: 'button', text: '/', title: 'Go to a page of the site' });
    // a quick way around the site: its main pages, every index, or any entry's page
    const PAGES = [['index.html', 'Home', '⌂'], ['all.html', 'Every page A–Z', '≡'], ['search.html', 'Search', '⌕'], ['chronology.html', 'Chronology', '⧗'], ['family.html', 'Families', '⚭'], ['devlog/index.html', 'Devlog', '✦'], ['shop/index.html', 'Shop', '¤'], ['maps/index.html', 'Maps', '⌖'], ['feed.xml', 'RSS feed', '◉'], ['404.html', 'Not-found page', '?']];
    where.addEventListener('click', () => {
      if (!preview) return;
      const idx = (preview.indexes || []).filter(x => !PAGES.some(y => y[0] === x.path));
      WB.ui.menu([{ header: 'Pages' }].concat(
        PAGES.filter(([p]) => p === 'feed.xml' ? preview.counts.posts : preview.list.includes(p)).map(([p, l, i]) => ({ label: l, icon: i, checked: p === curPage, onClick: () => open(p) })),
        idx.length ? ['-', { header: 'Indexes' }] : [],
        idx.map(x => ({ label: x.label, icon: x.icon, kbd: String(x.n), checked: x.path === curPage, onClick: () => open(x.path) })),
        ['-', { label: 'An entry…', icon: '↗', hint: 'Open any entry\'s page', onClick: async () => { const e = await WB.ui.pickEntry({ title: 'Show on the site' }); if (e) showEntry(e.id); } }],
      ), where);
    });
    const showEntry = id => {
      const p = preview && preview.urls[id];
      if (p) return open(p);
      const t = WB.liteOf(id);
      ui.toast('“' + (t ? t.title : 'That entry') + '” is not on the site: it is hidden from these readers, or its type is left out.', '◐', 4200);
    };
    const status = h('span.pub-status.gk-small.gk-muted', { text: 'Building…' });
    const device = ui.segmented({ value: store.get().device, options: DEVICES, onChange: v => { store.patch({ device: v }); setDevice(v); } });
    const nav = (fn) => { try { fn(frame.contentWindow); } catch { } };
    const toolbar = h('div.pub-toolbar', [
      ui.group([
        ui.button({ icon: '‹', small: true, title: 'Back', onClick: () => nav(w => w.history.back()) }),
        ui.button({ icon: '⌂', small: true, title: 'Home page', onClick: () => open('index.html') }),
        ui.button({ icon: '↻', small: true, title: 'Rebuild now (F5)', onClick: () => rebuild(true) }),
      ]),
      where, status, zoomNote, device,
      ui.button({ label: 'Open in browser', icon: '↗', small: true, title: 'Open this page of the preview in your web browser', onClick: () => preview && WB.api('publish.openPage', preview.dir, curPage) }),
    ]);
    const empty = h('div.pub-frame-empty');
    const previewPanel = ui.panel({ cls: 'pub-preview', material: 'solid', body: [toolbar, h('div.pub-stage', [frameWrap, empty])] });
    host.appendChild(h('div.pub-site', [settingsCol, previewPanel]));

    const open = page => { curPage = page || 'index.html'; scrollY = 0; if (preview) frame.src = preview.base + curPage.split('/').map(encodeURIComponent).join('/'); };
    frame.addEventListener('load', () => {
      frame.dataset.loaded = '1';
      try {
        const href = decodeURIComponent(frame.contentWindow.location.href.replace(/[?#].*$/, ''));
        const base = decodeURIComponent(preview ? preview.base : '');
        if (preview && href.startsWith(base)) curPage = href.slice(base.length) || 'index.html';
        where.textContent = '/' + (curPage === 'index.html' ? '' : curPage.replace(/(^|\/)index\.html$/, '$1'));
        where.title = curPage;
        if (scrollY) { frame.contentWindow.scrollTo(0, scrollY); scrollY = 0; }
        // links out of the site open in the browser, not inside the app
        frame.contentDocument.addEventListener('click', e => {
          const a = e.target.closest && e.target.closest('a[href]');
          if (a && /^(https?:|mailto:)/i.test(a.getAttribute('href'))) { e.preventDefault(); GK.host('shell:url', a.href); }
        }, true);
      } catch { where.textContent = '/'; }
    });

    function paintKnow(st) {
      GK.clear(knowBox);
      if (!st) return;
      const line = (n, one, many, tip) => (n ? h('li', { title: tip || '' }, [h('b', { text: WB.fmt.num(n) }), ' ' + (n === 1 ? one : many)]) : null);
      const items = [
        line(st.hidden, 'entry is hidden from these readers', 'entries are hidden from these readers', 'Private, or below this audience'),
        line(st.waiting, 'waits for its reveal date', 'wait for their reveal dates', 'They appear once the as-of date reaches them'),
        line(st.secretFields, 'secret field kept out', 'secret fields kept out'),
        line(st.secretPassages, 'secret passage kept out', 'secret passages kept out'),
        line(st.unlinked, 'mention of a hidden entry shown as plain text', 'mentions of hidden entries shown as plain text'),
        line(st.droppedRefs, 'link to a hidden entry left out', 'links to hidden entries left out'),
      ].filter(Boolean);
      knowBox.append(h('div.pub-know-head', [h('span.pub-know-ico', { text: '◐' }), h('b', { text: items.length ? 'Kept from readers' : 'Nothing is held back' })]),
        items.length ? h('ul', items) : h('div.gk-tiny.gk-faint', { text: 'Every entry of the chosen types is visible to this audience.' }));
    }
    function paintLast() {
      GK.clear(lastBox);
      const lb = s.lastBuild;
      if (!lb || !lb.dir) return;
      lastBox.append(h('div.pub-last-row', [
        h('span.pub-last-ico', { text: '✓' }),
        h('div.gk-grow', [h('div.gk-small', { text: 'Last built ' + WB.fmt.rel(lb.at) + ' · ' + P.plural(lb.pages || 0, 'page') }), h('div.gk-tiny.gk-faint.pub-path', { text: lb.dir, title: lb.dir })]),
        ui.group([
          ui.button({ label: 'Update', small: true, title: 'Build again into the same folder', onClick: () => buildTo(lb.dir) }),
          ui.button({ label: 'Open folder', small: true, onClick: () => WB.api('publish.openFolder', lb.dir) }),
        ]),
      ]));
    }
    paintLast();

    async function rebuild(now) {
      if (!alive) return;
      if (building) { again = true; return; }
      building = true; status.textContent = 'Building…';
      try {
        try { if (frame.contentWindow && preview) scrollY = frame.contentWindow.scrollY || 0; } catch { }
        const t0 = performance.now();
        const r = await WB.api('publish.preview', worldId);
        if (!alive) return;
        const first = !preview;
        preview = r; P.lastPreview = r;
        status.textContent = P.plural(r.pages, 'page') + ' · built in ' + Math.max(1, Math.round(performance.now() - t0)) + ' ms';
        status.title = r.dir;
        paintKnow(r.stats);
        empty.hidden = true;
        if (!r.list.includes(curPage)) curPage = 'index.html';
        if (first || frame.dataset.loaded !== '1') open(curPage);
        else { const y = scrollY; frame.src = r.base + curPage.split('/').map(encodeURIComponent).join('/'); scrollY = y; }
      } catch (e) {
        status.textContent = 'The preview could not be built';
        empty.hidden = false; GK.clear(empty).append(WB.ui.empty({ icon: '⚠', title: 'The preview could not be built', text: e.message }));
      } finally {
        building = false;
        if (again && alive) { again = false; rebuild(); }
      }
    }
    const rebuildSoon = P.debounce(() => rebuild(), 900);
    async function buildTo(dir) {
      P.busy(buildBtn, true, 'Building…');
      try {
        let r = await WB.api('publish.build', worldId, dir ? { dir } : {});
        if (r && r.needsConfirm) {
          const ok = await ui.confirm('That folder is not empty', '“' + r.dir + '” already holds ' + P.plural(r.count, 'file') + '. The website\'s files are added next to them and files with the same names are replaced. Build there anyway?', 'Build here');
          r = ok ? await WB.api('publish.build', worldId, { dir: r.dir, force: true }) : null;
        }
        if (!r) return;
        s = await WB.api('publish.settings', worldId);
        paintLast();
        ui.toast('Website built: ' + P.plural(r.pages, 'page'), '⇪', 6000);
        const t = document.querySelector('.gk-toasts .gk-toast:last-child');
        if (t) t.appendChild(ui.button({ label: 'Open folder', small: true, onClick: () => WB.api('publish.openFolder', r.dir) }));
      } catch (e) { WB.fail(e); } finally { P.busy(buildBtn, false); }
    }

    // data changes rebuild the preview (debounced); the world record changes only matter when site-facing parts change
    let sig = JSON.stringify([WB.world.name, WB.world.summary, WB.world.coverId, WB.world.now, WB.world.calendar]);
    offs.push(WB.onChange(['entries', 'links', 'tags', 'media', 'map_items', 'reviews', 'types', 'rel_types'], () => { rebuildSoon(); if (counts) loadCounts(); }, 400));
    offs.push(WB.on('world', w => {
      if (!w || w.id !== worldId) return;
      const n = JSON.stringify([w.name, w.summary, w.coverId, w.now, w.calendar]);
      if (n !== sig) { sig = n; rebuildSoon(); paintAsOf(); }
    }));
    const keys = e => { if (e.key === 'F5') { e.preventDefault(); rebuild(true); } };
    document.addEventListener('keydown', keys);
    offs.push(() => document.removeEventListener('keydown', keys));

    loadCounts();
    await rebuild(true);
    if (params.run === 'build') setTimeout(() => buildTo(), 60);
    if (params.entryId) showEntry(params.entryId);
    return () => { flushSave(); alive = false; offs.forEach(f => f()); };
  };
})();
