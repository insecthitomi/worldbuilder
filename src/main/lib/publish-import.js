'use strict';
/* Imports: a Markdown / Obsidian vault (front matter → fields where the keys match, [[links]] → mentions resolved by
   title once every note exists, folders → types or parents, images copied into the library) and CSV into a type
   with a column → field mapping. Scanning is separate from importing so the user sees a preview first. */
const fs = require('fs');
const path = require('path');
const T = require('../../shared/richtext');
const F = require('../../shared/fields');
const Cal = require('../../shared/calendar');

const IMG = /\.(png|jpe?g|gif|webp|svg|avif|bmp)$/i;
const norm = s => String(s == null ? '' : s).toLowerCase().normalize('NFKD').replace(/[̀-ͯ]/g, '').replace(/[^a-z0-9]+/g, '');
const RESERVED = new Set(['title', 'type', 'aliases', 'alias', 'tags', 'tag', 'summary', 'description', 'audience', 'parent', 'cover', 'banner', 'wbid', 'id', 'created', 'updated', 'modified', 'date', 'start', 'end', 'wbindex', 'cssclass', 'cssclasses', 'publish', 'permalink']);

/* ---------------- YAML front matter (the subset notes use) ---------------- */
function scalar(raw) {
  let s = String(raw).trim();
  if (s === '' || s === '~' || s === 'null') return null;
  if (/^".*"$/.test(s)) { try { return JSON.parse(s); } catch { return s.slice(1, -1); } }
  if (/^'.*'$/.test(s)) return s.slice(1, -1).replace(/''/g, "'");
  if (s === 'true' || s === 'yes') return true;
  if (s === 'false' || s === 'no') return false;
  if (/^-?\d+(\.\d+)?$/.test(s) && !/^0\d/.test(s)) return +s;
  if (/^\[.*\]$/.test(s) && !/^\[\[/.test(s)) return splitFlow(s.slice(1, -1)).map(scalar).filter(v => v !== null);
  return s.replace(/\s+#.*$/, '');
}
function splitFlow(s) {
  const out = []; let cur = '', q = null, depth = 0;
  for (const ch of s) {
    if (q) { cur += ch; if (ch === q) q = null; continue; }
    if (ch === '"' || ch === "'") { q = ch; cur += ch; continue; }
    if (ch === '[') depth++; if (ch === ']') depth--;
    if (ch === ',' && depth === 0) { out.push(cur); cur = ''; continue; }
    cur += ch;
  }
  if (cur.trim()) out.push(cur);
  return out;
}
function parseYaml(src) {
  const lines = String(src).replace(/\r\n?/g, '\n').split('\n'), out = {};
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    if (!line.trim() || /^\s*#/.test(line) || /^\s/.test(line)) continue;
    const m = /^("[^"]+"|'[^']+'|[^:]+?)\s*:(?:\s+(.*)|\s*)$/.exec(line);
    if (!m) continue;
    const key = m[1].replace(/^["']|["']$/g, '').trim(), rest = m[2] == null ? '' : m[2];
    if (rest === '|' || rest === '>' || rest === '|-' || rest === '>-') {
      const buf = [];
      while (i + 1 < lines.length && (/^\s/.test(lines[i + 1]) || !lines[i + 1].trim())) buf.push(lines[++i].replace(/^\s{1,4}/, ''));
      out[key] = rest[0] === '>' ? buf.join(' ').replace(/\s+/g, ' ').trim() : buf.join('\n').replace(/\n+$/, '');
      continue;
    }
    if (rest.trim() === '') {
      const list = [], sub = [];
      while (i + 1 < lines.length && (/^\s+/.test(lines[i + 1]) || /^-\s/.test(lines[i + 1]) || !lines[i + 1].trim())) {
        const l = lines[++i];
        if (!l.trim()) continue;
        const li = /^\s*-\s+(.*)$/.exec(l);
        if (li) list.push(scalar(li[1])); else sub.push(l.trim());
      }
      out[key] = list.length ? list.filter(v => v !== null) : sub.length ? sub.join('; ') : null;
      continue;
    }
    out[key] = scalar(rest);
  }
  return out;
}
/** → { data, body } */
function frontMatter(text) {
  const s = String(text || '').replace(/^﻿/, '');
  const m = /^---[ \t]*\r?\n([\s\S]*?)\r?\n(?:---|\.\.\.)[ \t]*(?:\r?\n|$)/.exec(s);
  if (!m) return { data: {}, body: s };
  return { data: parseYaml(m[1]), body: s.slice(m[0].length) };
}
const wikiTarget = v => { const m = /^\s*\[\[([^\]|#^]+)(?:[#^][^\]|]*)?(?:\|[^\]]*)?\]\]\s*$/.exec(String(v)); return m ? m[1].trim() : String(v).trim(); };

/* ---------------- vault scanning ---------------- */
function walk(dir, rel, acc, limit) {
  let list = [];
  try { list = fs.readdirSync(dir, { withFileTypes: true }); } catch { return acc; }
  for (const d of list) {
    if (acc.notes.length >= limit) break;
    if (d.name.startsWith('.') || d.name === 'node_modules') continue;
    const abs = path.join(dir, d.name), r = rel ? rel + '/' + d.name : d.name;
    if (d.isDirectory()) walk(abs, r, acc, limit);
    else if (/\.md$/i.test(d.name)) acc.notes.push({ rel: r, abs });
    else if (IMG.test(d.name)) { acc.images.set(d.name.toLowerCase(), abs); acc.imagesRel.set(r.toLowerCase(), abs); }
  }
  return acc;
}
/** reads every note; nothing is created */
function scanVault(dir, { limit = 20000 } = {}) {
  if (!dir || !fs.existsSync(dir) || !fs.statSync(dir).isDirectory()) throw new Error('That folder no longer exists.');
  const acc = walk(dir, '', { notes: [], images: new Map(), imagesRel: new Map() }, limit);
  const notes = [];
  for (const n of acc.notes) {
    let text = '';
    try { text = fs.readFileSync(n.abs, 'utf8'); } catch { continue; }
    const { data, body } = frontMatter(text);
    if (data['wb-index'] === true) continue;
    const parts = n.rel.split('/'), base = parts[parts.length - 1].replace(/\.md$/i, '');
    notes.push({ rel: n.rel, folder: parts.slice(0, -1).join('/'), top: parts.length > 1 ? parts[0] : '', base, title: String(data.title || base).trim() || base, fm: data, body });
  }
  return { dir, notes, images: acc.images, imagesRel: acc.imagesRel };
}
/* folder names people use in their vaults → built-in type keys */
const SYNONYMS = {
  character: ['people', 'persons', 'person', 'npcs', 'npc', 'cast', 'pcs', 'heroes', 'villains', 'figures', 'personas'],
  place: ['locations', 'location', 'cities', 'towns', 'settlements', 'regions', 'geography', 'realms', 'kingdoms', 'nations', 'countries', 'planets', 'worlds'],
  faction: ['organizations', 'organisations', 'orgs', 'groups', 'guilds', 'houses', 'families', 'factions', 'clans', 'orders', 'religions'],
  species: ['creatures', 'monsters', 'bestiary', 'races', 'beasts', 'animals', 'flora', 'fauna', 'ancestries'],
  item: ['items', 'artifacts', 'artefacts', 'objects', 'equipment', 'gear', 'weapons', 'relics', 'treasure', 'loot', 'magicitems'],
  event: ['events', 'history', 'timeline', 'battles', 'wars', 'eras'],
  lore: ['lore', 'magic', 'gods', 'deities', 'myths', 'mythology', 'legends', 'religion', 'cosmology', 'concepts', 'laws'],
  culture: ['cultures', 'peoples', 'ethnicities', 'societies'],
  language: ['languages', 'tongues', 'conlangs'],
  story: ['stories', 'books', 'novels', 'manuscripts'],
  chapter: ['chapters'], scene: ['scenes'],
  plot: ['plots', 'quests', 'questlines', 'plotthreads', 'threads', 'adventures', 'hooks'],
  map: ['maps', 'atlas', 'cartography'],
  session: ['sessions', 'sessionnotes', 'logs', 'journal', 'campaignlog'],
  note: ['notes', 'ideas', 'inbox', 'scratch', 'misc', 'drafts'],
  post: ['posts', 'blog', 'devlog', 'news', 'updates'],
  product: ['products', 'shop', 'store', 'merch'],
};
/** a type for a folder name: plural, name or key, loosely, then common vault folder names */
function typeForName(types, name) {
  const n = norm(name);
  if (!n) return null;
  const hit = types.find(t => norm(t.plural) === n || norm(t.name) === n || norm(t.key) === n)
    || types.find(t => norm(t.name) + 's' === n || norm(t.key) + 's' === n || norm(t.name) === n.replace(/(ies)$/, 'y') || norm(t.name) === n.replace(/s$/, ''));
  if (hit) return hit;
  for (const [key, words] of Object.entries(SYNONYMS)) if (words.includes(n)) { const t = types.find(x => x.key === key); if (t) return t; }
  return null;
}
/** the preview: folders with suggested types, counts, links and images found */
function vaultPlan(scan, types, opts = {}) {
  const folders = new Map();
  for (const n of scan.notes) if (n.top) folders.set(n.top, (folders.get(n.top) || 0) + 1);
  const folderTypes = Object.assign({}, opts.folderTypes || {});
  for (const f of folders.keys()) if (!folderTypes[f]) { const t = typeForName(types, f); folderTypes[f] = t ? t.key : opts.rootType || 'note'; }
  let links = 0, embeds = 0, fmKeys = new Map();
  for (const n of scan.notes) {
    links += (n.body.match(/(?<!!)\[\[[^\]]+\]\]/g) || []).length;
    embeds += (n.body.match(/!\[\[[^\]]+\]\]|!\[[^\]]*\]\([^)]+\)/g) || []).length;
    for (const k of Object.keys(n.fm)) if (!RESERVED.has(norm(k))) fmKeys.set(k, (fmKeys.get(k) || 0) + 1);
  }
  const byType = {};
  for (const n of scan.notes) { const k = noteType(n, types, folderTypes, opts.rootType || 'note'); byType[k] = (byType[k] || 0) + 1; }
  return {
    dir: scan.dir, notes: scan.notes.length, images: scan.images.size, links, embeds,
    folders: [...folders].map(([name, count]) => ({ name, count, type: folderTypes[name] })),
    rootNotes: scan.notes.filter(n => !n.top).length, rootType: opts.rootType || 'note', folderTypes, byType,
    keys: [...fmKeys].sort((a, b) => b[1] - a[1]).slice(0, 40).map(([key, count]) => ({ key, count })),
    sample: scan.notes.slice(0, 8).map(n => ({ title: n.title, rel: n.rel, type: noteType(n, types, folderTypes, opts.rootType || 'note') })),
  };
}
function noteType(n, types, folderTypes, rootType) {
  if (n.fm.type) { const t = typeForName(types, n.fm.type); if (t) return t.key; }
  return (n.top && folderTypes[n.top]) || rootType;
}

/* ---------------- value conversion ---------------- */
function fieldValue(def, v, ctx) {
  if (v == null || v === '') return undefined;
  const arr = Array.isArray(v) ? v : typeof v === 'string' && /[;,]/.test(v) && ['multi', 'list', 'refs'].includes(def.kind) ? v.split(/\s*[;,]\s*/) : [v];
  switch (def.kind) {
    case 'number': { const n = parseFloat(String(v).replace(/[^\d.-]/g, '')); return Number.isFinite(n) ? n : undefined; }
    case 'rating': { const n = typeof v === 'number' ? v : (String(v).match(/★/g) || []).length || parseInt(v, 10); return Number.isFinite(n) ? Math.max(0, Math.min(5, Math.round(n))) : undefined; }
    case 'progress': { const n = parseFloat(String(v)); return Number.isFinite(n) ? Math.max(0, Math.min(100, n)) : undefined; }
    case 'bool': return v === true || /^(y|yes|true|1|x|✓)$/i.test(String(v).trim());
    case 'choice': { const s = String(Array.isArray(v) ? v[0] : v).trim(); return (def.options || []).find(o => norm(o) === norm(s)) || s; }
    case 'multi': return arr.map(x => String(x).trim()).filter(Boolean).map(s => (def.options || []).find(o => norm(o) === norm(s)) || s);
    case 'list': return arr.map(x => String(x).trim()).filter(Boolean);
    case 'stats': return arr.map(x => { const m = /^\s*([^:=]+?)\s*[:=]\s*(.+)$/.exec(String(x)); return m ? { label: m[1], value: m[2].trim() } : null; }).filter(Boolean);
    case 'ref': { const id = ctx.resolve(wikiTarget(arr[0])); if (!id) ctx.unresolved(wikiTarget(arr[0])); return id || undefined; }
    case 'refs': { const ids = []; for (const x of arr) { const n = wikiTarget(x); const id = ctx.resolve(n); if (id) ids.push(id); else if (n) ctx.unresolved(n); } return ids.length ? ids : undefined; }
    case 'image': { const id = ctx.image(wikiTarget(arr[0])); return id || undefined; }
    case 'realdate': { const s = String(v).trim(); return /^\d{4}-\d{2}-\d{2}/.test(s) ? s.slice(0, 10) : s; }
    default: return Array.isArray(v) ? v.join(', ') : String(v);
  }
}
const isRefKind = k => k === 'ref' || k === 'refs' || k === 'image';
function findField(type, key) {
  const n = norm(key);
  return (type.fields || []).find(d => norm(d.key) === n) || (type.fields || []).find(d => norm(d.label) === n) || null;
}
function dateKey(type, key) {
  const n = norm(key), dl = type.dated || {};
  if (n === 'start' || n === 'date' || (dl.start && norm(dl.start) === n)) return 'start';
  if (n === 'end' || (dl.end && norm(dl.end) === n)) return 'end';
  return null;
}
const AUD = v => { const s = norm(v); return s === 'private' ? 'private' : s === 'public' ? 'public' : s === 'shared' ? 'shared' : null; };
const asList = v => (Array.isArray(v) ? v : v == null || v === '' ? [] : String(v).split(/\s*[;,]\s*/)).map(x => String(x).trim()).filter(Boolean);

/* ---------------- vault import ---------------- */
/**
 * ctx: area ctx (core, media); o: { folderTypes, rootType, subfolders: true (sub-folders become parents) }
 * → report { created, ids, byType, parents, links: { resolved, unresolved }, images: { copied, missing }, unmatched, skipped }
 */
function importVault(ctx, worldId, scan, o = {}) {
  const C = ctx.core, types = C.typesOf(worldId), cal = Cal.create(C.world(worldId).calendar);
  const typeByKey = new Map(types.map(t => [t.key, t]));
  const folderTypes = vaultPlan(scan, types, o).folderTypes, rootType = typeByKey.get(o.rootType) ? o.rootType : (typeByKey.has('note') ? 'note' : types[0].key);
  const report = { created: 0, ids: [], byType: {}, parents: 0, links: { resolved: 0, unresolved: [] }, images: { copied: 0, missing: [] }, unmatched: {}, skipped: [], fields: 0 };
  const unresolved = new Set(), missing = new Set();
  // titles → ids: imported notes first (title, file name, aliases), then the world's own entries
  const byName = new Map();
  const nameKey = s => String(s || '').trim().toLowerCase();
  const resolve = name => {
    const k = nameKey(name).replace(/\.md$/, '');
    if (!k) return null;
    if (byName.has(k)) return byName.get(k);
    const base = k.split('/').pop();
    if (byName.has(base)) return byName.get(base);
    const e = ctx.handlers['entries.find'] ? ctx.handlers['entries.find'](worldId, name) : null;
    return e ? e.id : null;
  };
  const imageCache = new Map();
  const image = (ref, fromFolder) => {
    let k = String(ref || '').trim().replace(/\|.*$/, '');
    if (!k || /^https?:/i.test(k)) return null;
    try { k = decodeURIComponent(k); } catch { }
    const relKey = path.posix.normalize((fromFolder ? fromFolder + '/' : '') + k).toLowerCase();
    const abs = scan.imagesRel.get(relKey) || scan.imagesRel.get(k.toLowerCase().replace(/^\.?\//, '')) || scan.images.get(path.posix.basename(k).toLowerCase());
    if (!abs) { missing.add(k); return null; }
    if (imageCache.has(abs)) return imageCache.get(abs);
    let id = null;
    try { const buf = fs.readFileSync(abs); const md = ctx.media.store(worldId, path.basename(abs), buf, ctx.media.mimeOf(abs), { name: path.basename(abs).replace(/\.[^.]+$/, ''), tags: ['imported'] }); id = md.id; report.images.copied++; } catch { missing.add(k); }
    imageCache.set(abs, id);
    return id;
  };
  if (ctx.handlers['backup.create']) { try { ctx.handlers['backup.create']('Before importing a vault'); } catch { } }

  const made = [];
  ctx.db.tx(() => {
    // 1 · every note becomes an entry (so links can find each other)
    for (const n of scan.notes) {
      const t = typeByKey.get(noteType(n, types, folderTypes, rootType)) || typeByKey.get(rootType);
      const fm = n.fm, d = { worldId, typeId: t.id, title: n.title.slice(0, 300) };
      if (fm.summary || fm.description) d.summary = String(fm.summary || fm.description);
      const al = asList(fm.aliases || fm.alias);
      if (al.length) d.aliases = al;
      const tags = asList(fm.tags || fm.tag).map(x => x.replace(/^#/, ''));
      if (tags.length) d.tagNames = tags;
      if (fm.audience && AUD(fm.audience)) d.audience = AUD(fm.audience);
      const e = C.createEntry(d);
      made.push({ n, e, t });
      report.ids.push(e.id);
      report.byType[t.name] = (report.byType[t.name] || 0) + 1;
      for (const k of [n.title, n.base].concat(al)) { const key = nameKey(k); if (key && !byName.has(key)) byName.set(key, e.id); }
      byName.set(nameKey(n.rel.replace(/\.md$/i, '')), e.id);
    }
    // sub-folders without a folder note get one, so their notes have a parent
    const folderEntry = new Map();
    if (o.subfolders !== false) {
      const folders = new Set(made.map(x => x.n.folder).filter(f => f && f.includes('/')));
      for (const f of [...folders].sort((a, b) => a.split('/').length - b.split('/').length)) {
        const name = f.split('/').pop(), parentFolder = f.split('/').slice(0, -1).join('/');
        const note = made.find(x => x.n.base.toLowerCase() === name.toLowerCase() && (x.n.folder === f || x.n.folder === parentFolder));
        if (note) { folderEntry.set(f, note.e.id); continue; }
        const top = f.split('/')[0], t = typeByKey.get(folderTypes[top]) || typeByKey.get(rootType);
        const e = C.createEntry({ worldId, typeId: t.id, title: name, summary: '' });
        report.ids.push(e.id); report.byType[t.name] = (report.byType[t.name] || 0) + 1;
        folderEntry.set(f, e.id);
        if (!byName.has(nameKey(name))) byName.set(nameKey(name), e.id);
        const pid = folderEntry.get(parentFolder);
        if (pid && parentFolder.includes('/')) { C.updateEntry(e.id, { parentId: pid }); report.parents++; }
      }
    }
    // 2 · parents, fields, bodies with [[links]] resolved, images
    for (const { n, e, t } of made) {
      const fm = n.fm, patch = {}, fields = {}, extra = [];
      const vctx = { resolve, unresolved: x => unresolved.add(x), image: x => image(x, n.folder) };
      let parentId = null;
      if (fm.parent) parentId = resolve(wikiTarget(Array.isArray(fm.parent) ? fm.parent[0] : fm.parent));
      if (!parentId && o.subfolders !== false && n.folder && n.folder.includes('/')) {
        const fe = folderEntry.get(n.folder);
        if (fe && fe !== e.id) parentId = fe;
        else if (fe === e.id) { const up = folderEntry.get(n.folder.split('/').slice(0, -1).join('/')); if (up && up !== e.id) parentId = up; }
      }
      if (parentId && parentId !== e.id) { patch.parentId = parentId; report.parents++; }
      for (const [k, v] of Object.entries(fm)) {
        const nk = norm(k);
        const dk = dateKey(t, k);
        if (dk && v != null && v !== '') {
          const dt = cal.parse(String(v));
          if (dt) { patch[dk] = dt; continue; }
          report.unmatched[k] = (report.unmatched[k] || 0) + 1;
          extra.push([k, v]);
          continue;
        }
        if (nk === 'cover' || nk === 'banner') { const id = image(wikiTarget(v), n.folder); if (id) patch.coverId = id; continue; }
        if (RESERVED.has(nk)) continue;
        const def = findField(t, k);
        if (def) {
          const val = fieldValue(def, v, vctx);
          if (val !== undefined) { fields[def.key] = val; report.fields++; }
          continue;
        }
        report.unmatched[k] = (report.unmatched[k] || 0) + 1;
        extra.push([k, v]);
      }
      if (Object.keys(fields).length) patch.fields = fields;
      let body = markdownToHtml(n.body, { resolve, onLink: ok => { if (ok) report.links.resolved++; }, unresolved: x => unresolved.add(x), image: x => image(x, n.folder) });
      if (extra.length) body += '<aside class="wb-note"><p><strong>From the vault</strong></p><ul>' + extra.map(([k, v]) => '<li>' + T.esc(k) + ': ' + T.esc(Array.isArray(v) ? v.join(', ') : String(v)) + '</li>').join('') + '</ul></aside>';
      if (body) patch.body = body;
      if (Object.keys(patch).length) C.updateEntry(e.id, patch);
    }
  });
  report.created = report.ids.length;
  report.links.unresolved = [...unresolved].slice(0, 60);
  report.links.unresolvedCount = unresolved.size;
  report.images.missing = [...missing].slice(0, 40);
  return report;
}

/** Obsidian-flavoured Markdown → the stored HTML subset; o: { resolve(name) → id, onLink(ok), unresolved(name), image(ref) → mediaId } */
function markdownToHtml(md, o = {}) {
  const imgs = [];
  const token = id => { imgs.push(id); return ' wbimgtoken' + (imgs.length - 1) + 'x '; };
  let s = String(md || '').replace(/\r\n?/g, '\n');
  s = s.replace(/%%[\s\S]*?%%/g, '');                                   // comments
  s = s.replace(/^(\s*>\s*)\[!(\w+)\][-+]?\s*(.*)$/gm, (m, q, kind, title) => q + '**' + (title || kind[0].toUpperCase() + kind.slice(1)) + '**');   // callouts
  s = s.replace(/==([^=\n]+)==/g, '$1');                                 // highlights
  s = s.replace(/!\[\[([^\]]+)\]\]/g, (m, ref) => {                      // embeds
    const target = ref.split('|')[0].trim();
    if (IMG.test(target)) { const id = o.image && o.image(target); return id ? token(id) : ''; }
    return '[[' + ref + ']]';
  });
  s = s.replace(/!\[([^\]]*)\]\(([^)\s]+)(?:\s+"[^"]*")?\)/g, (m, alt, src) => {
    if (/^https?:/i.test(src)) return '[' + (alt || 'image') + '](' + src + ')';
    const id = o.image && o.image(src); return id ? token(id) : '';
  });
  // [[Target#heading|Label]] → [[Target|Label]], counting what resolves
  s = s.replace(/\[\[([^\]|#^]*)(?:[#^][^\]|]*)?(?:\|([^\]]+))?\]\]/g, (m, target, label) => {
    target = target.trim();
    if (!target) return label || '';
    const id = o.resolve && o.resolve(target);
    if (o.onLink) o.onLink(!!id);
    if (!id) { o.unresolved && o.unresolved(target); return label || target.split('/').pop(); }
    return '[[' + id + '|' + (label || target.split('/').pop()) + ']]';
  });
  let html = T.fromMarkdown(s, x => (T.ID.test(x) ? x : null));
  html = html.replace(/\s*wbimgtoken(\d+)x\s*/g, (m, i) => '<img data-media="' + imgs[+i] + '" alt="">');
  return T.sanitize(html);
}

/* ---------------- CSV ---------------- */
function parseCsv(text) {
  const s = String(text || '').replace(/^﻿/, '');
  const first = (s.match(/^[^\n]*/) || [''])[0];
  const count = ch => { let n = 0, q = false; for (const c of first) { if (c === '"') q = !q; else if (c === ch && !q) n++; } return n; };
  const delim = [',', ';', '\t'].map(c => [c, count(c)]).sort((a, b) => b[1] - a[1])[0][1] ? [',', ';', '\t'].map(c => [c, count(c)]).sort((a, b) => b[1] - a[1])[0][0] : ',';
  const rows = []; let row = [], cell = '', q = false;
  for (let i = 0; i < s.length; i++) {
    const c = s[i];
    if (q) { if (c === '"') { if (s[i + 1] === '"') { cell += '"'; i++; } else q = false; } else cell += c; continue; }
    if (c === '"' && cell === '') { q = true; continue; }
    if (c === delim) { row.push(cell); cell = ''; continue; }
    if (c === '\n' || c === '\r') { if (c === '\r' && s[i + 1] === '\n') i++; row.push(cell); rows.push(row); row = []; cell = ''; continue; }
    cell += c;
  }
  if (cell !== '' || row.length) { row.push(cell); rows.push(row); }
  const clean = rows.filter(r => r.some(c => String(c).trim() !== ''));
  return { delimiter: delim, header: (clean[0] || []).map(h => String(h).trim()), rows: clean.slice(1) };
}
/** column → target: 'title' | 'aliases' | 'summary' | 'body' | 'parent' | 'tags' | 'audience' | 'start' | 'end' | 'field:<key>' | '' */
function csvSuggest(header, type) {
  const used = new Set(), dl = type.dated || {};
  return header.map(h => {
    const n = norm(h);
    let t = '';
    const def = findField(type, h);
    if (['title', 'name', 'entry'].includes(n)) t = 'title';
    else if (['aliases', 'alias', 'aka', 'alsoknownas'].includes(n)) t = 'aliases';
    else if (['summary', 'short', 'tagline', 'description', 'desc'].includes(n) && !used.has('summary')) t = 'summary';
    else if (['parent', 'inside', 'partof', 'within'].includes(n)) t = 'parent';
    else if (['tags', 'tag', 'labels'].includes(n)) t = 'tags';
    else if (n === 'audience' || n === 'visibility') t = 'audience';
    else if (n === 'start' || n === 'date' || (dl.start && norm(dl.start) === n)) t = 'start';
    else if (n === 'end' || (dl.end && norm(dl.end) === n)) t = 'end';
    else if (def) t = 'field:' + def.key;
    else if (['text', 'body', 'notes', 'content', 'description', 'details'].includes(n)) t = 'body';
    if (t && used.has(t)) t = '';
    if (t) used.add(t);
    return t;
  });
}
/** the rows as entries would get them (no writes); refs shown by name */
function csvRows(header, rows, mapping, type, cal) {
  return rows.map(r => {
    const out = { title: '', fields: {}, extra: {} };
    mapping.forEach((target, i) => {
      const v = r[i] == null ? '' : String(r[i]).trim();
      if (!target || v === '') return;
      if (target === 'title') out.title = v;
      else if (target === 'aliases') out.aliases = asList(v);
      else if (target === 'summary') out.summary = v;
      else if (target === 'body') out.body = v;
      else if (target === 'parent') out.parent = v;
      else if (target === 'tags') out.tags = asList(v).map(x => x.replace(/^#/, ''));
      else if (target === 'audience') { const a = AUD(v); if (a) out.audience = a; }
      else if (target === 'start' || target === 'end') { const d = cal.parse(v); if (d) out[target] = d; else out.extra[header[i]] = v; }
      else if (target.startsWith('field:')) out.fields[target.slice(6)] = v;
    });
    return out;
  });
}
/** creates entries from rows; refs and parents resolve by title among the world and the new rows */
function importCsv(ctx, worldId, parsed, mapping, typeId) {
  const C = ctx.core, type = C.typeById(typeId);
  if (!type || type.worldId !== worldId) throw new Error('Pick a type to import into.');
  if (!mapping.includes('title')) throw new Error('Choose which column holds the names.');
  const cal = Cal.create(C.world(worldId).calendar);
  const rows = csvRows(parsed.header, parsed.rows, mapping, type, cal);
  const report = { created: 0, ids: [], skipped: 0, unresolved: [], fields: 0, byType: {} };
  const unresolved = new Set(), byName = new Map();
  const resolve = name => {
    const k = String(name || '').trim().toLowerCase();
    if (!k) return null;
    if (byName.has(k)) return byName.get(k);
    const e = ctx.handlers['entries.find'] ? ctx.handlers['entries.find'](worldId, name) : null;
    return e ? e.id : null;
  };
  if (ctx.handlers['backup.create']) { try { ctx.handlers['backup.create']('Before importing a CSV'); } catch { } }
  const made = [];
  ctx.db.tx(() => {
    for (const r of rows) {
      if (!r.title) { report.skipped++; continue; }
      const fields = {};
      for (const [k, v] of Object.entries(r.fields)) { const def = (type.fields || []).find(d => d.key === k); if (def && !isRefKind(def.kind)) { const val = fieldValue(def, v, {}); if (val !== undefined) { fields[k] = val; report.fields++; } } }
      let body = r.body ? (/<[a-z][\s\S]*>/i.test(r.body) ? r.body : markdownToHtml(r.body.replace(/\\n/g, '\n'), {})) : '';
      const extra = Object.entries(r.extra);
      if (extra.length) body += '<aside class="wb-note"><ul>' + extra.map(([k, v]) => '<li>' + T.esc(k) + ': ' + T.esc(v) + '</li>').join('') + '</ul></aside>';
      const e = C.createEntry({ worldId, typeId, title: r.title.slice(0, 300), summary: r.summary || '', aliases: r.aliases || [], tagNames: r.tags || [], audience: r.audience, start: r.start, end: r.end, fields, body });
      made.push({ r, e });
      report.ids.push(e.id);
      if (!byName.has(r.title.toLowerCase())) byName.set(r.title.toLowerCase(), e.id);
      for (const a of r.aliases || []) if (!byName.has(a.toLowerCase())) byName.set(a.toLowerCase(), e.id);
    }
    for (const { r, e } of made) {
      const patch = {}, fields = {};
      for (const [k, v] of Object.entries(r.fields)) {
        const def = (type.fields || []).find(d => d.key === k);
        if (!def || !isRefKind(def.kind) || def.kind === 'image') continue;
        const val = fieldValue(def, v, { resolve, unresolved: x => unresolved.add(x) });
        if (val !== undefined) { fields[k] = val; report.fields++; }
      }
      if (Object.keys(fields).length) patch.fieldsPatch = fields;
      if (r.parent) { const p = resolve(r.parent); if (p && p !== e.id) patch.parentId = p; else if (!p) unresolved.add(r.parent); }
      if (Object.keys(patch).length) C.updateEntry(e.id, patch);
    }
  });
  report.created = report.ids.length;
  report.byType[type.name] = report.created;
  report.unresolved = [...unresolved].slice(0, 60);
  return report;
}

module.exports = { frontMatter, parseYaml, scanVault, vaultPlan, importVault, markdownToHtml, parseCsv, csvSuggest, csvRows, importCsv, typeForName, wikiTarget };
