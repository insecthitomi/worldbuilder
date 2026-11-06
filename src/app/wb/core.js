/* Worldbuilder renderer core: window.WB — data access, the current world, change events, navigation, formatting. */
(function (root) {
  'use strict';
  const GK = root.GK;
  /* GK.h assigns style objects as properties, which ignores custom properties: route '--x' keys through setProperty.
     (Screens capture `GK.h` after this file loads, so they all get it.) */
  const kitH = GK.h;
  GK.h = function (spec, props, kids) {
    if (props && !Array.isArray(props) && !(props instanceof Node) && typeof props === 'object' && props.style && typeof props.style === 'object') {
      const vars = Object.entries(props.style).filter(([k]) => k.startsWith('--'));
      if (vars.length) {
        const rest = Object.fromEntries(Object.entries(props.style).filter(([k]) => !k.startsWith('--')));
        const el = kitH(spec, Object.assign({}, props, { style: rest }), kids);
        for (const [k, v] of vars) if (v != null) el.style.setProperty(k, String(v));
        return el;
      }
    }
    return kitH(spec, props, kids);
  };
  /* GK.ui.field wraps its control in a <label>, so clicking the label text presses the first button inside (segmented
     controls, chip rows). Keep the <label> only when the first labelable control is a text-like one. */
  const kitField = GK.ui.field;
  GK.ui.field = function (o = {}) {
    const el = kitField(o), c = o.control;
    const first = c instanceof Element ? (c.matches('input, select, textarea, button') ? c : c.querySelector('input, select, textarea, button, meter, output, progress')) : null;
    if (!first || /^(INPUT|SELECT|TEXTAREA)$/.test(first.tagName) && first.type !== 'checkbox' && first.type !== 'radio' && first.type !== 'range' || el.tagName !== 'LABEL') return el;
    const div = document.createElement('div');
    for (const a of el.attributes) div.setAttribute(a.name, a.value);
    div.append(...el.childNodes);
    return div;
  };
  const WB = root.WB = {
    version: '0.1.0',
    text: root.WBText, dice: root.WBDice, names: root.WBNames, know: root.WBKnow, F: root.WBFields, Cal: root.WBCal,
    world: null, worldId: null, types: new Map(), relTypes: [], tags: [], titles: [], cal: null, share: false,
    ui: {}, gen: {}, commands: null, prefs: null,
  };

  /* ---------------- data access ---------------- */
  const clean = e => {
    const m = String((e && e.message) || e || 'Something went wrong').replace(/^Error invoking remote method '[^']+':\s*/, '').replace(/^(Error:\s*)+/, '');
    const err = new Error(m); err.cause = e; return err;
  };
  WB.api = (name, ...args) => GK.host('wb:' + name, ...args).catch(e => { throw clean(e); });
  /** shows the error as a toast and returns null (for fire-and-forget actions) */
  WB.fail = e => { console.warn(e); GK.ui.toast((e && e.message) || String(e), '⚠', 5200); return null; };
  WB.try = (p) => Promise.resolve(p).catch(WB.fail);
  WB.debounce = (fn, ms = 300) => { let t = null; const d = (...a) => { clearTimeout(t); t = setTimeout(() => fn(...a), ms); }; d.flush = (...a) => { clearTimeout(t); fn(...a); }; d.cancel = () => clearTimeout(t); return d; };

  /* ---------------- events ---------------- */
  WB.on = (name, fn) => GK.bus.on('wb:' + name, fn);
  WB.emit = (name, data) => GK.bus.emit('wb:' + name, data);
  /** subscribe to data changes touching any of `tables` (debounced), returns unsubscribe */
  WB.onChange = (tables, fn, ms = 120) => {
    const set = new Set([].concat(tables)), d = WB.debounce(p => fn(p), ms);
    return WB.on('changed', p => { if (!set.size || (p.tables || []).some(t => set.has(t))) d(p); });
  };

  /* ---------------- the current world ---------------- */
  async function loadMeta() {
    const id = WB.worldId;
    const [types, rels, tags] = await Promise.all([WB.api('types.list', id), WB.api('rels.list', id), WB.api('tags.list', id)]);
    if (id !== WB.worldId) return;
    WB.types = new Map(types.map(t => [t.id, t]));
    WB.relTypes = rels;
    WB.tags = tags;
  }
  const loadTitles = async () => { const id = WB.worldId; const t = await WB.api('entries.titles', id); if (id !== WB.worldId) return; WB.titles = t; titleMap = new Map(t.map(x => [x.id, x])); };
  let titleMap = new Map();
  WB.titleOf = id => { const t = titleMap.get(id); return t ? t.title : ''; };
  WB.liteOf = id => titleMap.get(id) || null;

  WB.setWorld = async function (id, { quiet } = {}) {
    const w = await WB.api('worlds.open', id);
    WB.world = w; WB.worldId = w.id;
    WB.cal = WB.Cal.create(w.calendar);
    await Promise.all([loadMeta(), loadTitles()]);
    WB.prefs && WB.prefs.patch({ worldId: w.id });
    mediaCache.clear();
    if (!quiet) WB.emit('world', w);
    return w;
  };
  WB.reloadWorld = async () => { if (!WB.worldId) return; const w = await WB.api('worlds.get', WB.worldId); if (!w || w.id !== WB.worldId) return; WB.world = w; WB.cal = WB.Cal.create(w.calendar); WB.emit('world', w); };
  Object.defineProperty(WB, 'now', { get: () => (WB.world ? WB.world.now : { day: 0, min: null, prec: 'day' }) });

  /* host change events → refresh caches → 'changed' */
  const refreshTitles = WB.debounce(() => loadTitles().catch(() => {}), 250);
  if (root.host && root.host.on) root.host.on('wb:changed', async (p) => {
    p = p || { tables: [], ids: [] };
    const t = new Set(p.tables || []);
    try {
      if (t.has('worlds') && WB.worldId) { const w = await WB.api('worlds.get', WB.worldId).catch(() => null); if (w && w.id === WB.worldId) { const calChanged = JSON.stringify(w.calendar) !== JSON.stringify(WB.world.calendar); WB.world = w; if (calChanged) WB.cal = WB.Cal.create(w.calendar); WB.emit('world', w); } }
      if (t.has('types') || t.has('rel_types') || t.has('tags') || t.has('entries')) await loadMeta();
      if (t.has('entries')) refreshTitles();
      if (t.has('media')) for (const id of p.ids || []) mediaCache.delete(id);
    } catch (e) { console.warn(e); }
    WB.emit('changed', p);
  });

  /* ---------------- types ---------------- */
  WB.type = idOrKey => WB.types.get(idOrKey) || [...WB.types.values()].find(t => t.key === idOrKey) || null;
  WB.typeList = ({ all } = {}) => [...WB.types.values()].filter(t => all || !t.hidden).sort((a, b) => a.sort - b.sort);
  WB.typeOf = e => (e && WB.types.get(e.typeId)) || null;
  WB.iconOf = e => (e && e.icon) || (WB.typeOf(e) || {}).icon || '◇';
  WB.colorOf = e => (e && e.color) || (WB.typeOf(e) || {}).color || '#9aa5b1';
  WB.rel = id => WB.relTypes.find(r => r.id === id) || null;
  WB.relByName = name => WB.relTypes.find(r => r.name === name) || null;
  WB.tag = id => WB.tags.find(t => t.id === id) || null;

  /* ---------------- media ---------------- */
  const mediaCache = new Map();
  WB.media = id => {
    if (!id) return Promise.resolve(null);
    if (!mediaCache.has(id)) mediaCache.set(id, WB.api('media.get', id).catch(() => null));
    return mediaCache.get(id);
  };
  WB.mediaUrl = async id => { const m = await WB.media(id); return m ? m.url : ''; };

  /* ---------------- knowledge (Share view) ---------------- */
  WB.visible = e => !WB.share || WB.know.visible(e, 'shared', WB.now.day);
  WB.strip = html => (WB.share ? WB.text.stripSecrets(html || '') : html || '');
  WB.fieldVisible = def => !WB.share || !def.secret;
  WB.setShare = on => {
    WB.share = !!on;
    document.documentElement.classList.toggle('wb-share', WB.share);
    WB.emit('share', WB.share);
    if (GK.shell.current) GK.shell.go(GK.shell.current);
  };

  /* ---------------- navigation & history ---------------- */
  const pending = {};
  const hist = { stack: [], at: -1, replaying: false };
  WB.go = (mod, params) => { pending[mod] = params || null; return GK.shell.go(mod); };
  WB.params = mod => { const p = pending[mod]; delete pending[mod]; return p || null; };
  WB.open = (id, opts) => (id ? WB.go('codex', Object.assign({ entryId: id }, opts || {})) : null);
  WB.record = (mod, params) => {
    if (hist.replaying) return;
    const s = { mod, params: params || null }, cur = hist.stack[hist.at];
    if (cur && cur.mod === s.mod && JSON.stringify(cur.params) === JSON.stringify(s.params)) return;
    hist.stack = hist.stack.slice(0, hist.at + 1).concat([s]).slice(-100);
    hist.at = hist.stack.length - 1;
    WB.emit('history', WB.canGo());
  };
  GK.bus.on('navigate', id => { if (!hist.replaying) WB.record(id, pending[id] !== undefined ? pending[id] : null); });
  async function replay(i) {
    const s = hist.stack[i]; if (!s) return;
    hist.at = i; hist.replaying = true;
    try { await WB.go(s.mod, s.params); } finally { hist.replaying = false; }
    WB.emit('history', WB.canGo());
  }
  WB.back = () => (hist.at > 0 ? replay(hist.at - 1) : null);
  WB.forward = () => (hist.at < hist.stack.length - 1 ? replay(hist.at + 1) : null);
  WB.canGo = () => ({ back: hist.at > 0, forward: hist.at < hist.stack.length - 1 });

  /* ---------------- formatting ---------------- */
  const nf = new Intl.NumberFormat();
  WB.fmt = {
    date: (d, style) => (d && WB.cal ? WB.cal.format(d, style) : ''),
    range: (a, b, style) => (WB.cal ? WB.cal.formatRange(a, b, style) : ''),
    span(e, style) { if (!e || (!e.start && !e.end)) return ''; return e.start && e.end ? WB.cal.formatRange(e.start, e.end, style) : e.start ? WB.cal.format(e.start, style) : '– ' + WB.cal.format(e.end, style); },
    real: iso => { if (!iso) return ''; const d = new Date(iso.length === 10 ? iso + 'T12:00:00' : iso); return isNaN(d) ? '' : d.toLocaleDateString(undefined, { year: 'numeric', month: 'short', day: 'numeric' }); },
    rel(iso) {
      if (!iso) return '';
      const s = (Date.now() - Date.parse(iso)) / 1000;
      if (s < 45) return 'just now';
      if (s < 3600) return Math.round(s / 60) + ' min ago';
      if (s < 86400) return Math.round(s / 3600) + ' h ago';
      if (s < 86400 * 7) return Math.round(s / 86400) + ' d ago';
      return WB.fmt.real(iso);
    },
    num: n => (n == null || isNaN(n) ? '' : nf.format(n)),
    money(cents, currency) {
      const c = currency || (WB.world && WB.world.settings.currency) || 'USD';
      try { return new Intl.NumberFormat(undefined, { style: 'currency', currency: c }).format((cents || 0) / 100); } catch { return ((cents || 0) / 100).toFixed(2) + ' ' + c; }
    },
    words: n => nf.format(n || 0) + (n === 1 ? ' word' : ' words'),
    plural: (n, one, many) => nf.format(n) + ' ' + (n === 1 ? one : many || one + 's'),
    bytes: n => (n < 1024 ? n + ' B' : n < 1048576 ? (n / 1024).toFixed(0) + ' KB' : (n / 1048576).toFixed(1) + ' MB'),
    age(e, at) {
      const t = WB.typeOf(e);
      if (!t || !t.lifespan || !e.start || !WB.cal) return null;
      const end = e.end && (!at || e.end.day <= at.day) ? e.end : at || WB.now;
      if (end.day < e.start.day) return null;
      return WB.cal.age(e.start, end);
    },
  };
  /** a relation's start or end as a world date; links saved before precision was stored read the first day of a
      year as that year and the first of a month as that month (the rule Chronicle and Web use) */
  WB.linkDate = (link, which = 'start') => {
    const day = link && link[which + 'Day'];
    if (day == null) return null;
    let prec = link[which + 'Prec'];
    if (!prec && WB.cal) { const p = WB.cal.ymd(day); prec = p.d === 1 ? (p.m === 0 ? 'year' : 'month') : 'day'; }
    return { day, min: null, prec: prec || 'day' };
  };
  WB.today = () => { const d = new Date(); return d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0') + '-' + String(d.getDate()).padStart(2, '0'); };
  WB.esc = s => String(s == null ? '' : s).replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c]);

  /* ---------------- creation ---------------- */
  /** opts: { type (id|key), parentId, title, fields, body, start, open: true, ask } — ask opens the create dialog */
  WB.create = async function (opts = {}) {
    if (opts.ask || (!opts.type && !opts.typeId)) return WB.ui.createDialog ? WB.ui.createDialog(opts) : null;
    const t = WB.type(opts.typeId || opts.type);
    const e = await WB.api('entries.create', Object.assign({}, opts, { worldId: WB.worldId, typeId: t && t.id, typeKey: t ? undefined : opts.type }));
    if (opts.open !== false) WB.open(e.id, { focusTitle: !opts.title });
    return e;
  };
  /** delete with an Undo toast */
  WB.trash = async function (e) {
    const r = await WB.api('entries.trash', e.id);
    WB.ui.undoToast && WB.ui.undoToast((r.ids.length > 1 ? r.ids.length + ' entries' : '“' + e.title + '”') + ' moved to the trash', () => WB.api('entries.restore', e.id));
    return r;
  };

  /** ctx.store with defaults filled in for keys an older saved state doesn't have yet */
  WB.store = async (ctx, defaults) => {
    const s = await ctx.store(defaults);
    const v = s.get() || {};
    if (Object.keys(defaults).some(k => !(k in v))) s.set(Object.assign({}, defaults, v));
    return s;
  };

  /* ---------------- extra files a screen loads on demand (so screens never need to edit index.html) ---------------- */
  const loaded = new Map();
  WB.loadScript = src => {
    // a failed load is forgotten (and its tag removed) so the next call tries again
    if (!loaded.has(src)) loaded.set(src, new Promise((res, rej) => { const s = document.createElement('script'); s.src = src; s.onload = res; s.onerror = () => { loaded.delete(src); s.remove(); rej(new Error('Could not load ' + src)); }; document.head.appendChild(s); }));
    return loaded.get(src);
  };
  WB.loadStyle = href => {
    if (!loaded.has(href)) { const l = document.createElement('link'); l.rel = 'stylesheet'; l.href = href; document.head.appendChild(l); loaded.set(href, Promise.resolve()); }
    return loaded.get(href);
  };

  /* ---------------- smoke-test queue (boot seeds the example world first, then runs these) ---------------- */
  WB.smokeQueue = [];
  WB.smoke = (name, fn) => WB.smokeQueue.push(['step', name, fn]);
  WB.check = (name, fn) => WB.smokeQueue.push(['check', name, fn]);
  WB.wait = (ms) => new Promise(r => setTimeout(r, ms));
  WB.frames = (n = 2) => new Promise(r => { const f = () => (n-- > 0 ? requestAnimationFrame(f) : r()); f(); });

  /* ---------------- app preferences (Appearance → Worldbuilder) ---------------- */
  GK.settings.extend([
    { key: 'wbWriteFont', section: 'wb', label: 'Writing font', type: 'choice', def: 'serif', options: [['serif', 'Book serif'], ['sans', 'Interface font'], ['mono', 'Typewriter']] },
    { key: 'wbWriteSize', section: 'wb', label: 'Writing text size', type: 'range', def: 1.08, min: .9, max: 1.6, step: .02, format: v => Math.round(v * 100) + '%' },
    { key: 'wbWriteWidth', section: 'wb', label: 'Writing column width', type: 'range', def: 42, min: 28, max: 70, step: 1, unit: 'em' },
    { key: 'wbSpell', section: 'wb', label: 'Spell check while writing', type: 'toggle', def: true },
    { key: 'wbConfirmDelete', section: 'wb', label: 'Ask before deleting', type: 'toggle', def: false, hint: 'Deletes can always be undone from the toast or the trash.' },
    { key: 'wbHoverCards', section: 'wb', label: 'Preview entries on hover', type: 'toggle', def: true },
    { key: 'wbLifespans', section: 'wb', label: 'Show lifespans on the timeline', type: 'toggle', def: true },
    { key: 'wbTypewriter', section: 'wb', label: 'Typewriter scrolling in focus mode', type: 'toggle', def: true },
  ], ['wb', 'Worldbuilder', '✦']);
  GK.bus.on('applied', s => {
    const r = document.documentElement.style;
    r.setProperty('--wb-write-font', s.wbWriteFont === 'mono' ? 'var(--font-mono)' : s.wbWriteFont === 'sans' ? 'var(--font-ui)' : "'Iowan Old Style', 'Palatino Linotype', Palatino, Georgia, 'Book Antiqua', serif");
    r.setProperty('--wb-write-size', String(s.wbWriteSize || 1.08));
    r.setProperty('--wb-write-width', (s.wbWriteWidth || 42) + 'em');
  });

  /** first launch, a world switch or a new world: pick the world to show */
  WB.init = async function () {
    WB.prefs = await GK.store('wb', { worldId: null, welcomed: false, recentEntries: [], pinned: [] });
    let worlds = await WB.api('worlds.list') || [];
    let id = WB.prefs.get().worldId;
    if (!worlds.find(w => w.id === id)) id = worlds[0] && worlds[0].id;
    if (id) await WB.setWorld(id, { quiet: true });
    return !!id;
  };
  /** remembers recently opened entries (for the palette and Home) */
  WB.touch = id => {
    if (!WB.prefs || !id) return;
    const r = WB.prefs.get().recentEntries.filter(x => x !== id);
    r.unshift(id);
    WB.prefs.patch({ recentEntries: r.slice(0, 30) });
  };
})(window);
