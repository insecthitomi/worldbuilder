'use strict';
/* Publish: the static website (settings in world.settings.site, live preview in a temp folder, build to a chosen
   folder), devlog posts, exports (world package, Markdown vault, CSV, JSON + schema, PDF world bible, handouts) and
   imports (world package, Markdown / Obsidian vault, CSV). Every reader-facing output goes through publish-model.js,
   which applies the one knowledge rule from src/shared/knowledge.js. */
const fs = require('fs');
const path = require('path');
const { today, safeName, J } = require('../util');
const Model = require('../lib/publish-model');
const Site = require('../lib/publish-site');
const Exp = require('../lib/publish-export');
const Imp = require('../lib/publish-import');

const MANIFEST = '.worldbuilder-site.json';
const migrations = [];

function handlers(ctx) {
  const { db } = ctx;
  const C = () => ctx.core;
  const pending = new Map();   // scanned imports waiting for the user's go-ahead (token → data)
  const keep = (token, v) => { pending.set(token, v); if (pending.size > 6) pending.delete(pending.keys().next().value); return token; };

  /* ---------------- helpers ---------------- */
  const mediaRow = (worldId, id) => db.get('SELECT * FROM media WHERE id = ? AND world_id = ? AND deleted_at IS NULL', id, worldId);
  const mediaInfo = worldId => id => {
    const r = id && mediaRow(worldId, id);
    if (!r || !r.file) return null;
    const file = path.join(ctx.paths.media(worldId), r.file);
    if (!fs.existsSync(file)) return null;
    return { id: r.id, file, ext: (path.extname(r.file).slice(1) || 'bin').toLowerCase(), name: r.name || r.id, width: r.width, height: r.height, kind: r.kind, mime: r.mime };
  };
  const imageInfo = worldId => { const f = mediaInfo(worldId); return id => { const v = f(id); return v && v.kind === 'image' ? v : null; }; };
  const fileUrl = p => ctx.fileUrl(p);
  const tmpDir = (...p) => { const d = path.join(ctx.paths.data, 'publish-tmp', ...p); fs.mkdirSync(d, { recursive: true }); return d; };

  async function safeCall(name, ...args) {
    if (!ctx.has(name)) return null;
    try { return await ctx.call(name, ...args); } catch (e) { return null; }
  }
  /** the Atlas's items on a map, in the shape the site draws (defensive: the Atlas may not exist yet) */
  async function mapItems(mapId, asOf) {
    const r = await safeCall('atlas.items', mapId);
    const list = Array.isArray(r) ? r : r && Array.isArray(r.items) ? r.items : [];
    const day = v => (v == null ? null : typeof v === 'object' ? (Number.isFinite(+v.day) ? +v.day : null) : Number.isFinite(+v) ? +v : null);
    const out = [];
    for (const it of list) {
      if (!it || it.deletedAt || it.secret || it.private || it.hidden || it.audience === 'private') continue;
      const st = it.style || {};
      if (st.secret || st.hidden) continue;
      const s = day(it.start != null ? it.start : it.startDay), e = day(it.end != null ? it.end : it.endDay);
      if (s != null && s > asOf) continue;
      if (e != null && e < asOf) continue;
      const pts = Array.isArray(it.points) ? it.points : Array.isArray(it.pts) ? it.pts : [];
      out.push({
        kind: String(it.kind || it.type || 'pin'), x: +it.x, y: +it.y, label: String(it.label || it.name || ''), note: String(it.note || ''),
        entryId: it.entryId || it.entry_id || null, subMapId: it.subMapId || it.sub_map_id || null, layer: it.layer || null,
        points: pts.map(p => (Array.isArray(p) ? [+p[0], +p[1]] : [+p.x, +p.y])).filter(p => Number.isFinite(p[0]) && Number.isFinite(p[1])),
        color: st.color || it.color || (it.entry && /^#[0-9a-f]{3,8}$/i.test(it.entry.colors || '') ? it.entry.colors : ''), icon: st.icon || it.icon || '',
        dashed: !!st.dashed, fill: st.fill != null && Number.isFinite(+st.fill) && +st.fill <= 1 ? +st.fill : null, size: +st.size || 0, hideLabel: !!st.hideLabel,
        labelSize: +st.labelSize || 0, italic: !!st.italic, caps: !!st.caps, angle: +st.angle || 0, width: +st.width || 0, opacity: st.opacity != null && Number.isFinite(+st.opacity) ? +st.opacity : null,
      });
    }
    return out;
  }
  /** the Atlas's pin symbols (24-unit SVG paths), read from its icon library so published pins match the app */
  let iconCache = null;
  function atlasIcons() {
    if (iconCache) return iconCache;
    iconCache = new Map();
    try {
      const src = fs.readFileSync(path.join(__dirname, '..', '..', 'app', 'modules', 'atlas', 'icons.js'), 'utf8');
      const re = /\[\s*'([a-z0-9-]+)'\s*,\s*'[^']*'\s*,\s*'([MmLlHhVvCcSsQqTtAaZz0-9.,\s-]+)'(?:\s*,\s*'(evenodd|nonzero)')?\s*\]/g;
      let m;
      while ((m = re.exec(src))) iconCache.set(m[1], { d: m[2], rule: m[3] || 'nonzero' });
    } catch { }
    return iconCache;
  }
  /** featured reviews from the Business area, if it exists */
  async function reviews(worldId, m) {
    const r = await safeCall('business.reviews', worldId, { featured: true });
    const list = Array.isArray(r) ? r : r && Array.isArray(r.reviews) ? r.reviews : [];
    const flagged = list.some(x => x && 'featured' in x);
    return list.filter(x => x && (!flagged || !!x.featured)).map(x => ({
      productId: x.productId || x.product_id || x.entryId || null, author: x.author || x.name || x.reviewer || '', rating: +x.rating || 0,
      text: String(x.text || x.body || x.quote || '').trim(), source: x.source || x.channel || '',
    })).filter(x => x.text && (!x.productId || m.visible.has(x.productId)));
  }

  /* ---------------- settings ---------------- */
  const settings = worldId => Site.settingsOf(C().world(worldId));
  function saveSettings(worldId, patch = {}) {
    const w = C().world(worldId), cur = Object.assign({}, (w.settings && w.settings.site) || {});
    const next = Object.assign(cur, patch);
    if (patch.sections) next.sections = Object.assign({}, cur.sections || {}, patch.sections);
    ctx.handlers['worlds.update'](worldId, { settings: { site: next } });
    return settings(worldId);
  }
  /** the type keys a site shows: the author's pick, or sensible defaults */
  function siteTypes(worldId, s) {
    const types = C().typesOf(worldId);
    let keys = Array.isArray(s.types) ? s.types.slice() : types.filter(t => !t.hidden && (Model.SITE_TYPES.includes(t.key) || !t.builtin)).map(t => t.key);
    if (!s.sections.devlog) keys = keys.filter(k => k !== 'post');
    if (!s.sections.shop) keys = keys.filter(k => k !== 'product');
    return keys;
  }

  /* ---------------- the website ---------------- */
  async function renderSite(worldId, o = {}) {
    const s = Object.assign(settings(worldId), o.settings || {});
    if (o.settings && o.settings.sections) s.sections = Object.assign({}, settings(worldId).sections, o.settings.sections);
    const day = o.today || today();
    const types = siteTypes(worldId, s);
    // posts: only live ones (published, or scheduled for a day that has come) reach readers
    const live = new Set();
    const pt = C().typeByKey(worldId, 'post');
    if (pt) for (const e of C().listEntries(worldId, { typeIds: [pt.id] })) if (Model.postState(C().full(e.id).fields, day).live) live.add(e.id);
    const m = Model.build(ctx, worldId, { level: s.audience, asOf: s.asOf, types, today: day, keep: (e, t) => t.key !== 'post' || live.has(e.id) });
    const items = new Map();
    for (const e of m.entries) if (e.type.lens === 'map') items.set(e.id, await mapItems(e.id, m.asOf));
    const out = Site.render(m, s, { today: day, items, icons: atlasIcons(), reviews: await reviews(worldId, m), media: imageInfo(worldId), builtAt: Date.now(), postState: f => Model.postState(f, day) });
    out.stats = m.stats; out.settings = s; out.level = m.level; out.asOf = m.asOf;
    return out;
  }
  /** writes files; removes files an earlier build of this site wrote that are gone now (never anything else) */
  function writeSite(dir, files) {
    fs.mkdirSync(dir, { recursive: true });
    const mf = path.join(dir, MANIFEST);
    const old = J(fs.existsSync(mf) ? fs.readFileSync(mf, 'utf8') : '', {});
    const now = new Set(files.map(f => f.path));
    const inside = p => { const abs = path.resolve(dir, p); return abs.startsWith(path.resolve(dir) + path.sep) ? abs : null; };
    for (const p of old.files || []) if (!now.has(p)) { const abs = inside(p); if (abs) { try { fs.rmSync(abs, { force: true }); } catch { } } }
    let written = 0, bytes = 0;
    for (const f of files) {
      const abs = inside(f.path);
      if (!abs) continue;
      fs.mkdirSync(path.dirname(abs), { recursive: true });
      if (f.copy) {
        try {
          const a = fs.statSync(f.copy), b = fs.existsSync(abs) ? fs.statSync(abs) : null;
          if (!b || b.size !== a.size || b.mtimeMs < a.mtimeMs) fs.copyFileSync(f.copy, abs);
          bytes += a.size;
        } catch { continue; }
      } else {
        const data = Buffer.from(f.data, 'utf8');
        bytes += data.length;
        let same = false;
        try { same = fs.statSync(abs).size === data.length && fs.readFileSync(abs).equals(data); } catch { }
        if (!same) fs.writeFileSync(abs, data);
      }
      written++;
    }
    fs.writeFileSync(mf, JSON.stringify({ generator: 'Worldbuilder', at: new Date().toISOString(), files: [...now] }, null, 1));
    return { written, bytes };
  }
  const previewDir = worldId => path.join(ctx.paths.data, 'site-preview', worldId);
  /** previews of worlds that were deleted go too */
  let pruned = false;
  function prunePreviews() {
    if (pruned) return;
    pruned = true;
    try {
      const root = path.join(ctx.paths.data, 'site-preview'), live = new Set(db.all('SELECT id FROM worlds').map(r => r.id));
      for (const n of fs.readdirSync(root)) if (!live.has(n) && /^[a-z0-9]{6,32}$/.test(n)) fs.rmSync(path.join(root, n), { recursive: true, force: true });
    } catch { }
  }
  async function preview(worldId, o = {}) {
    const t0 = Date.now();
    const out = await renderSite(worldId, o);
    const dir = previewDir(worldId);
    const w = writeSite(dir, out.files);
    prunePreviews();
    return summary(out, dir, w, Date.now() - t0);
  }
  function summary(out, dir, w, ms) {
    return {
      dir, url: fileUrl(path.join(dir, 'index.html')), base: fileUrl(dir + path.sep), files: out.files.length, bytes: w.bytes, ms,
      pages: out.pages.length, counts: out.counts, stats: out.stats, level: out.level, asOf: out.asOf,
      list: out.pages.slice().sort(), urls: Object.fromEntries(out.urls || []), indexes: out.indexes || [],
    };
  }
  async function build(worldId, o = {}) {
    let dir = o.dir;
    const s = settings(worldId);
    if (!dir) {
      if (!ctx.dialog) throw new Error('Choosing a folder needs the desktop app.');
      const r = await ctx.dialog.showOpenDialog(ctx.win(), { title: 'Build the website into…', buttonLabel: 'Build here', defaultPath: s.outDir || undefined, properties: ['openDirectory', 'createDirectory', 'promptToCreate'] });
      if (r.canceled || !r.filePaths[0]) return null;
      dir = r.filePaths[0];
    }
    if (!o.force && fs.existsSync(dir)) {
      const names = fs.readdirSync(dir).filter(n => !n.startsWith('.'));
      if (names.length && !fs.existsSync(path.join(dir, MANIFEST))) return { needsConfirm: true, dir, count: names.length };
    }
    const t0 = Date.now();
    const out = await renderSite(worldId);
    const w = writeSite(dir, out.files);
    saveSettings(worldId, { outDir: dir, lastBuild: { at: new Date().toISOString(), dir, pages: out.pages.length } });
    return summary(out, dir, w, Date.now() - t0);
  }
  /** for smoke and tests: which files a built site holds, and whether anything private leaked */
  function verifySite(dir, needles = []) {
    if (!dir || !fs.existsSync(dir)) return { ok: false, problems: ['no site at ' + dir] };
    const files = [];
    const walk = (d, rel) => { for (const n of fs.readdirSync(d, { withFileTypes: true })) { const r = rel ? rel + '/' + n.name : n.name; if (n.isDirectory()) walk(path.join(d, n.name), r); else files.push(r); } };
    walk(dir, '');
    const problems = [];
    for (const need of ['index.html', 'assets/site.css', 'assets/site.js', '404.html', 'sitemap.xml']) if (!files.includes(need)) problems.push('missing ' + need);
    const leaks = [];
    if (needles.length) for (const f of files.filter(x => /\.(html|xml|js|json)$/.test(x))) {
      const text = fs.readFileSync(path.join(dir, f), 'utf8');
      for (const n of needles) if (n && text.includes(n)) leaks.push(f + ': ' + n);
    }
    if (leaks.length) problems.push('leaked: ' + leaks.slice(0, 5).join('; '));
    return { ok: !problems.length, files: files.length, pages: files.filter(f => /\.html$/.test(f)).length, problems, list: files.sort() };
  }

  /* ---------------- posts ---------------- */
  function posts(worldId) {
    const t = C().typeByKey(worldId, 'post');
    if (!t) return [];
    const day = today();
    return C().listEntries(worldId, { typeIds: [t.id] }).map(e => {
      const full = C().full(e.id), ps = Model.postState(full.fields, day);
      return Object.assign(e, { publish: full.fields.publish || null, status: full.fields.status || '', tier: full.fields.audience_tier || 'Everyone', excerpt: full.fields.excerpt || '', state: ps.state, live: ps.live && e.audience !== 'private', words: e.wordCount });
    }).sort((a, b) => String(b.publish || '9999').localeCompare(String(a.publish || '9999')) || String(b.createdAt).localeCompare(String(a.createdAt)));
  }

  /* ---------------- exports ---------------- */
  function exportModel(worldId, o = {}, { need } = {}) {
    const m = Model.build(ctx, worldId, { level: Model.LEVELS.includes(o.level) ? o.level : 'author', asOf: o.asOf, types: Array.isArray(o.types) ? o.types : null, today: today() });
    if (need && !m.entries.length) throw new Error('Nothing to export: no entries match these choices (audience, date and types).');
    return m;
  }
  async function chooseDir(title, o) {
    if (o && o.dir) return o.dir;
    if (!ctx.dialog) throw new Error('Choosing a folder needs the desktop app.');
    const r = await ctx.dialog.showOpenDialog(ctx.win(), { title, buttonLabel: 'Export here', properties: ['openDirectory', 'createDirectory', 'promptToCreate'] });
    return r.canceled || !r.filePaths[0] ? null : r.filePaths[0];
  }
  async function chooseFile(title, name, filters, o) {
    if (o && o.file) return o.file;
    if (!ctx.dialog) throw new Error('Saving a file needs the desktop app.');
    const r = await ctx.dialog.showSaveDialog(ctx.win(), { title, defaultPath: name, filters });
    return r.canceled || !r.filePath ? null : r.filePath;
  }
  function writeFiles(dir, files) {
    let n = 0;
    for (const f of files) {
      const abs = path.resolve(dir, f.path);
      if (!abs.startsWith(path.resolve(dir) + path.sep)) continue;
      fs.mkdirSync(path.dirname(abs), { recursive: true });
      if (f.copy) { try { fs.copyFileSync(f.copy, abs); n++; } catch { } } else { fs.writeFileSync(abs, f.data, 'utf8'); n++; }
    }
    return n;
  }
  const worldName = worldId => safeName(C().world(worldId).name);

  async function exportPackage(worldId, o = {}) {
    const file = await chooseFile('Save the world package', worldName(worldId) + '.wbworld', [{ name: 'Worldbuilder world', extensions: ['wbworld'] }, { name: 'JSON', extensions: ['json'] }], o);
    if (!file) return null;
    const pk = C().pack(worldId, { media: o.media !== false });
    fs.writeFileSync(file, JSON.stringify(pk));
    return { file, bytes: fs.statSync(file).size, entries: (pk.tables.entries || []).filter(r => !r.deleted_at).length, media: (pk.files || []).length };
  }
  async function exportMarkdown(worldId, o = {}) {
    const m = exportModel(worldId, o, { need: true });
    const parent = await chooseDir('Export a Markdown vault into…', o);
    if (!parent) return null;
    const dir = o.dir ? parent : path.join(parent, worldName(worldId) + ' vault');
    const v = Exp.markdownVault(m, { media: imageInfo(worldId) });
    const n = writeFiles(dir, v.files);
    return { dir, files: n, notes: v.notes, media: v.media, hidden: m.stats.hidden };
  }
  async function exportCsv(worldId, o = {}) {
    const m = exportModel(worldId, o, { need: true });
    const parent = await chooseDir('Export CSV files into…', o);
    if (!parent) return null;
    const dir = o.dir ? parent : path.join(parent, worldName(worldId) + ' CSV');
    const v = Exp.csvFiles(m);
    return { dir, files: writeFiles(dir, v.files), names: v.files.map(f => f.path), entries: m.entries.length };
  }
  async function exportJson(worldId, o = {}) {
    const m = exportModel(worldId, o, { need: true });
    const file = await chooseFile('Save the JSON data', worldName(worldId) + '.json', [{ name: 'JSON', extensions: ['json'] }], o);
    if (!file) return null;
    const schemaFile = path.basename(file).replace(/\.json$/i, '') + '.schema.json';
    const info = imageInfo(worldId), names = new Map();
    const media = id => { if (names.has(id)) return names.get(id); const v = info(id); const r = v ? { name: safeName(v.name) + '-' + v.id + '.' + v.ext, file: v.file } : null; names.set(id, r); return r; };
    const { data, schema } = Exp.jsonExport(m, { media, schemaFile });
    fs.writeFileSync(file, JSON.stringify(data, null, 1));
    fs.writeFileSync(path.join(path.dirname(file), schemaFile), JSON.stringify(schema, null, 1));
    const used = [...names.values()].filter(Boolean);
    if (used.length) { const md = path.join(path.dirname(file), 'media'); fs.mkdirSync(md, { recursive: true }); for (const u of used) { try { fs.copyFileSync(u.file, path.join(md, u.name)); } catch { } } }
    return { file, schema: path.join(path.dirname(file), schemaFile), entries: data.entries.length, types: data.types.length, media: used.length };
  }
  /** prints HTML to PDF in a hidden window */
  async function printPdf(html, file, pdfOpts = {}) {
    const E = ctx.electron;
    if (!E || !E.BrowserWindow) throw new Error('PDF export needs the desktop app.');
    const src = path.join(tmpDir('print'), 'doc-' + Date.now() + '.html');
    fs.writeFileSync(src, html, 'utf8');
    const win = new E.BrowserWindow({ show: false, width: 900, height: 1200, webPreferences: { sandbox: true, javascript: false, contextIsolation: true } });
    try {
      await win.loadFile(src);
      await new Promise(r => setTimeout(r, 250));
      const pdf = await win.webContents.printToPDF(Object.assign({ printBackground: true, pageSize: 'A4', generateDocumentOutline: true, preferCSSPageSize: true }, pdfOpts));
      fs.writeFileSync(file, pdf);
      return { file, bytes: pdf.length };
    } finally { try { win.destroy(); } catch { } try { fs.rmSync(src, { force: true }); } catch { } }
  }
  const accentFor = worldId => Site.accentOf(settings(worldId));
  function bible(worldId, o = {}) {
    const m = exportModel(worldId, Object.assign({ level: 'shared' }, o));
    const s = settings(worldId), info = imageInfo(worldId);
    return { m, html: Exp.bibleHtml(m, { cover: o.cover !== false, toc: o.toc !== false, pageEach: !!o.pageEach, title: o.title || s.title || m.world.name, tagline: s.tagline, accent: accentFor(worldId), coverId: s.coverId, mediaUrl: id => { const v = info(id); return v ? fileUrl(v.file) : null; } }) };
  }
  async function exportPdf(worldId, o = {}) {
    const { m, html } = bible(worldId, o);
    if (!m.entries.length) throw new Error('Nothing to print: no entries match these choices.');
    const file = await chooseFile('Save the world bible', worldName(worldId) + ' — world bible.pdf', [{ name: 'PDF', extensions: ['pdf'] }], o);
    if (!file) return null;
    const footer = '<div style="font-size:7.5px;width:100%;padding:0 15mm;color:#8a7760;font-family:Georgia,serif;display:flex;justify-content:space-between"><span>' + Exp.fileName(m.world.name).replace(/</g, '') + '</span><span><span class="pageNumber"></span> / <span class="totalPages"></span></span></div>';
    const r = await printPdf(html, file, { displayHeaderFooter: true, headerTemplate: '<span></span>', footerTemplate: footer });
    return Object.assign(r, { entries: m.entries.length });
  }
  async function handout(entryId, o = {}) {
    const e = C().lite(entryId);
    if (!e) throw new Error('That entry no longer exists.');
    const m = Model.build(ctx, e.worldId, { level: Model.LEVELS.includes(o.level) ? o.level : 'shared', asOf: o.asOf, today: today() });
    const entry = m.byId.get(entryId);
    if (!entry) throw new Error('“' + e.title + '” is hidden from this audience. Choose Author, or change its audience first.');
    const info = imageInfo(e.worldId);
    const html = Exp.handoutHtml(m, entry, { accent: accentFor(e.worldId), mediaUrl: id => { const v = info(id); return v ? fileUrl(v.file) : null; } });
    if (o.html) return { html };
    const file = await chooseFile('Save the handout', safeName(e.title) + ' — handout.pdf', [{ name: 'PDF', extensions: ['pdf'] }], o);
    if (!file) return null;
    return printPdf(html, file, { pageSize: 'A5' });
  }

  /* ---------------- imports ---------------- */
  async function pickPath(kind, o = {}) {
    if (o.file || o.dir) return o.file || o.dir;
    if (!ctx.dialog) throw new Error('Choosing files needs the desktop app.');
    const opts = kind === 'vault' ? { title: 'Choose a Markdown or Obsidian vault folder', properties: ['openDirectory'] }
      : kind === 'csv' ? { title: 'Choose a CSV file', properties: ['openFile'], filters: [{ name: 'CSV', extensions: ['csv', 'tsv', 'txt'] }] }
        : { title: 'Choose a world package', properties: ['openFile'], filters: [{ name: 'Worldbuilder world', extensions: ['wbworld', 'json'] }] };
    const r = await ctx.dialog.showOpenDialog(ctx.win(), opts);
    return r.canceled || !r.filePaths[0] ? null : r.filePaths[0];
  }
  async function previewPackage(o = {}) {
    const file = await pickPath('package', o);
    if (!file) return null;
    let pk;
    try { pk = JSON.parse(fs.readFileSync(file, 'utf8')); } catch { throw new Error('That file is not a Worldbuilder world (it could not be read as JSON).'); }
    if (!pk || pk.format !== 'worldbuilder-world' || !pk.world || !pk.tables) throw new Error('That file is not a Worldbuilder world.');
    const t = pk.tables, live = (t.entries || []).filter(r => !r.deleted_at);
    const types = new Map((t.types || []).map(r => [r.id, r.plural || r.name]));
    const byType = {};
    for (const r of live) { const n = types.get(r.type_id) || 'Other'; byType[n] = (byType[n] || 0) + 1; }
    const token = keep('pkg-' + Date.now(), { pk, file });
    return { token, file, name: pk.world.name, summary: pk.world.summary || '', exportedAt: pk.exportedAt || null, entries: live.length, types: (t.types || []).length, media: (pk.files || []).length, tags: (t.tags || []).length, links: (t.links || []).length, byType, version: pk.version || 1 };
  }
  function importPackage(token, o = {}) {
    const p = pending.get(token);
    if (!p) throw new Error('Choose the file again: the preview expired.');
    const w = C().unpack(p.pk, { name: o.name && String(o.name).trim() ? String(o.name).trim() : undefined });
    pending.delete(token);
    return w;
  }
  async function scanVault(worldId, o = {}) {
    const dir = await pickPath('vault', o);
    if (!dir) return null;
    const scan = Imp.scanVault(dir);
    if (!scan.notes.length) throw new Error('No Markdown notes (.md) were found in that folder.');
    const token = keep('vault-' + Date.now(), { scan, worldId });
    return Object.assign({ token }, Imp.vaultPlan(scan, C().typesOf(worldId), o));
  }
  function replanVault(worldId, token, o = {}) {
    const p = pending.get(token);
    if (!p) throw new Error('Choose the folder again: the preview expired.');
    return Object.assign({ token }, Imp.vaultPlan(p.scan, C().typesOf(worldId), o));
  }
  function importVault(worldId, token, o = {}) {
    const p = pending.get(token);
    if (!p) throw new Error('Choose the folder again: the preview expired.');
    const r = Imp.importVault(ctx, worldId, p.scan, o);
    pending.delete(token);
    ctx.changed(['entries', 'links', 'media', 'tags'], r.ids);
    return r;
  }
  async function scanCsv(worldId, o = {}) {
    const file = await pickPath('csv', o);
    if (!file) return null;
    const parsed = Imp.parseCsv(fs.readFileSync(file, 'utf8'));
    if (!parsed.header.length) throw new Error('That file has no header row.');
    const token = keep('csv-' + Date.now(), { parsed, file, worldId });
    const t = o.typeId ? C().typeById(o.typeId) : guessType(worldId, file);
    return Object.assign({ token, file, name: path.basename(file), delimiter: parsed.delimiter, header: parsed.header, count: parsed.rows.length }, csvPlan(worldId, parsed, t));
  }
  function guessType(worldId, file) {
    const types = C().typesOf(worldId);
    return Imp.typeForName(types, path.basename(file).replace(/\.[^.]+$/, '')) || types.find(t => t.key === 'character') || types[0];
  }
  function csvPlan(worldId, parsed, type, mapping) {
    const map = mapping || Imp.csvSuggest(parsed.header, type);
    const cal = require('../../shared/calendar').create(C().world(worldId).calendar);
    const preview = Imp.csvRows(parsed.header, parsed.rows.slice(0, 6), map, type, cal);
    const samples = parsed.header.map((h, i) => parsed.rows.slice(0, 3).map(r => r[i] || '').filter(Boolean).join(' · ').slice(0, 80));
    return { typeId: type.id, mapping: map, samples, preview, withTitle: parsed.rows.filter(r => { const i = map.indexOf('title'); return i >= 0 && String(r[i] || '').trim(); }).length };
  }
  function replanCsv(worldId, token, o = {}) {
    const p = pending.get(token);
    if (!p) throw new Error('Choose the file again: the preview expired.');
    const t = C().typeById(o.typeId) || guessType(worldId, p.file);
    return Object.assign({ token, file: p.file, name: path.basename(p.file), delimiter: p.parsed.delimiter, header: p.parsed.header, count: p.parsed.rows.length }, csvPlan(worldId, p.parsed, t, o.mapping && o.typeId === t.id ? o.mapping : null));
  }
  function importCsv(worldId, token, o = {}) {
    const p = pending.get(token);
    if (!p) throw new Error('Choose the file again: the preview expired.');
    const r = Imp.importCsv(ctx, worldId, p.parsed, o.mapping, o.typeId);
    pending.delete(token);
    ctx.changed(['entries', 'links', 'tags'], r.ids);
    return r;
  }
  /** undo an import into the current world: everything it created goes to the trash */
  function undoImport(ids) {
    let n = 0;
    for (const id of ids || []) { try { const r = ctx.handlers['entries.trash'](id); n += (r.ids || []).length; } catch { } }
    return { n };
  }

  return {
    'publish.settings': worldId => settings(worldId),
    'publish.saveSettings': (worldId, patch) => saveSettings(worldId, patch),
    'publish.themes': () => Object.entries(Site.THEMES).map(([key, t]) => Object.assign({ key }, t)),
    'publish.siteTypes': worldId => siteTypes(worldId, settings(worldId)),
    'publish.preview': (worldId, o) => preview(worldId, o),
    'publish.build': (worldId, o) => build(worldId, o),
    'publish.verifySite': (dir, needles) => verifySite(dir, needles),
    'publish.openFolder': dir => { if (dir && fs.existsSync(dir) && ctx.shell) ctx.shell.openPath(dir); return true; },
    'publish.reveal': p => { if (p && fs.existsSync(p) && ctx.shell) ctx.shell.showItemInFolder(p); return true; },
    'publish.openPage': (dir, page) => { const f = path.join(dir || '', page || 'index.html'); if (fs.existsSync(f) && ctx.shell) ctx.shell.openPath(f); return true; },
    'publish.tempDir': name => tmpDir(safeName(name || 'smoke')),
    'publish.posts': worldId => posts(worldId),
    'publish.postState': (fields, day) => Model.postState(fields, day || today()),
    'publish.exportPackage': (worldId, o) => exportPackage(worldId, o),
    'publish.exportMarkdown': (worldId, o) => exportMarkdown(worldId, o),
    'publish.exportCsv': (worldId, o) => exportCsv(worldId, o),
    'publish.exportJson': (worldId, o) => exportJson(worldId, o),
    'publish.exportPdf': (worldId, o) => exportPdf(worldId, o),
    'publish.bibleHtml': (worldId, o) => bible(worldId, o).html,
    'publish.handout': (entryId, o) => handout(entryId, o),
    'publish.counts': (worldId, o = {}) => {
      const m = exportModel(worldId, o);
      const byType = {};
      for (const e of m.entries) byType[e.type.key] = (byType[e.type.key] || 0) + 1;
      return { entries: m.entries.length, byType, stats: m.stats };
    },
    'publish.previewPackage': o => previewPackage(o),
    'publish.importPackage': (token, o) => importPackage(token, o),
    'publish.scanVault': (worldId, o) => scanVault(worldId, o),
    'publish.replanVault': (worldId, token, o) => replanVault(worldId, token, o),
    'publish.importVault': (worldId, token, o) => importVault(worldId, token, o),
    'publish.scanCsv': (worldId, o) => scanCsv(worldId, o),
    'publish.replanCsv': (worldId, token, o) => replanCsv(worldId, token, o),
    'publish.importCsv': (worldId, token, o) => importCsv(worldId, token, o),
    'publish.undoImport': ids => undoImport(ids),
  };
}

/* ---------------- the example world's part ---------------- */
function sample(ctx, S) {
  const C = ctx.core;
  const id = k => (S.e ? S.e(k) : null);
  const iso = d => d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0') + '-' + String(d.getDate()).padStart(2, '0');
  const daysFrom = n => iso(new Date(Date.now() + n * 864e5));
  // public: places, peoples, the open history; anything the sample made private stays private
  const pub = ['saltmarch', 'gullhaven', 'harbour', 'veykeep', 'tidewell', 'greyflats', 'lanternrock', 'mirefen', 'stormspire', 'sunkenmarket', 'inlandcrown',
    'housevey', 'gulls', 'saltwardens', 'crown', 'merrowfolk', 'saltwyrm', 'marchfolk', 'inlanders', 'saltspeak', 'tidecrown', 'lanternlens',
    'flood', 'foundinggull', 'saltwar', 'storm1203', 'wedding', 'tidemagic', 'saltlaw', 'mira', 'brannoc', 'elsabet', 'corwin', 'tamsin', 'oskar', 'fenn', 'halloran', 'aldous', 'wren',
    'mapsaltmarch', 'mapgullhaven', 'novella', 'prodnovella', 'prodmaps'];
  for (const k of pub) {
    const e = id(k);
    if (!e) continue;
    try { const x = C.lite(e); if (x && x.audience !== 'private') C.updateEntry(e, { audience: 'public' }); } catch { }
  }
  const p1 = id('post1'), p2 = id('post2');
  try { if (p1) C.updateEntry(p1, { audience: 'public', fieldsPatch: { publish: daysFrom(-21), status: 'Published', audience_tier: 'Everyone' } }); } catch { }
  try { if (p2) C.updateEntry(p2, { audience: 'public', fieldsPatch: { publish: daysFrom(12), status: 'Scheduled', audience_tier: 'Everyone' } }); } catch { }
  const featured = ['mira', 'gullhaven', 'housevey', 'tidecrown', 'flood', 'saltwyrm'].map(id).filter(Boolean);
  // the home page's hero: the world's cover, else the region map's image (the Atlas sample runs first)
  let coverId = null;
  try { const w0 = C.world(S.worldId); coverId = w0.coverId || null; if (!coverId && id('mapsaltmarch')) coverId = (C.full(id('mapsaltmarch')).data || {}).image || null; } catch { }
  try {
    const w = C.world(S.worldId);
    ctx.handlers['worlds.update'](S.worldId, { settings: { site: Object.assign({}, (w.settings && w.settings.site) || {}, {
      title: 'The Saltmarch', tagline: 'Salt, storms, and the drowned who still remember.', theme: 'parchment', accent: '#9a4a1f', audience: 'public', asOf: null,
      sections: { maps: true, chronology: true, family: true, devlog: true, shop: true, search: true, index: true },
      featured, coverId, footer: 'The Saltmarch is an original setting. Text and maps © its author.', baseUrl: '',
    }) } });
  } catch { }
}

module.exports = { migrations, handlers, sample };
