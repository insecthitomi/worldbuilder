'use strict';
/* Write: the manuscript tree (story → chapters → scenes), scene bodies in bulk, compile & export (Markdown, text,
   HTML, RTF, Fountain, PDF through a hidden window), find & replace across a story, split/join scenes, writing
   sessions and statistics. Entries stay ordinary entries; Write only adds a sessions table and `data.write` on them. */
const fs = require('fs');
const path = require('path');
const T = require('../../shared/richtext');
const C = require('../lib/write-compile');
const { uid, now, today, J, dateOf, placeholders, safeName } = require('../util');

const migrations = [{
  id: 'write-001',
  sql: `CREATE TABLE write_sessions (id TEXT PRIMARY KEY, world_id TEXT NOT NULL REFERENCES worlds(id) ON DELETE CASCADE,
    story_id TEXT, entry_id TEXT, started_at TEXT, ended_at TEXT, seconds INTEGER DEFAULT 0, words INTEGER DEFAULT 0,
    goal INTEGER DEFAULT 0, kind TEXT DEFAULT 'focus');
    CREATE INDEX write_sessions_world ON write_sessions (world_id, started_at);`,
}];

const KINDS = ['story', 'chapter', 'scene'];
const FILTER = { md: 'Markdown', txt: 'Plain text', html: 'Web page', rtf: 'Rich text (Word, Pages, LibreOffice)', pdf: 'PDF', fountain: 'Fountain screenplay' };
const isoDay = d => d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0') + '-' + String(d.getDate()).padStart(2, '0');
const escRe = s => String(s).replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

function handlers(ctx) {
  const { db } = ctx;
  const core = () => { if (!ctx.core) throw new Error('The data layer is not ready yet.'); return ctx.core; };

  /* ---------------- the story types of a world ---------------- */
  function storyTypes(worldId) {
    const rows = db.all("SELECT id, key FROM types WHERE world_id = ? AND (lens = 'story' OR key IN ('story', 'chapter', 'scene'))", worldId);
    const byId = new Map(), ids = {};
    for (const r of rows) { const k = KINDS.includes(r.key) ? r.key : 'scene'; byId.set(r.id, k); if (KINDS.includes(r.key)) ids[r.key] = r.id; }
    return { byId, ids };
  }
  function node(r, kind) {
    const data = J(r.data, {});
    return {
      id: r.id, kind, typeId: r.type_id, parentId: r.parent_id || null, position: r.position || 0, title: r.title, summary: r.summary || '',
      fields: J(r.fields, {}), write: data.write || {}, words: r.word_count || 0, icon: r.icon || '', color: r.color || '',
      start: dateOf(r.start_day, r.start_min, r.start_prec), end: dateOf(r.end_day, r.end_min, r.end_prec),
      audience: r.audience || 'shared', revealDay: r.reveal_day == null ? null : r.reveal_day, favorite: !!r.favorite,
      createdAt: r.created_at, updatedAt: r.updated_at, deletedAt: null,
    };
  }
  function tree(worldId) {
    const { byId, ids } = storyTypes(worldId);
    if (!byId.size) return { typeIds: ids, nodes: [] };
    const keys = [...byId.keys()];
    const rows = db.all(`SELECT id, type_id, parent_id, position, title, summary, fields, data, word_count, icon, color, start_day, start_min, start_prec,
      end_day, end_min, end_prec, audience, reveal_day, favorite, created_at, updated_at FROM entries
      WHERE world_id = ? AND deleted_at IS NULL AND type_id IN (${placeholders(keys.length)}) ORDER BY position, title COLLATE NOCASE`, worldId, ...keys);
    return { typeIds: ids, nodes: rows.map(r => node(r, byId.get(r.type_id))) };
  }
  /** children map + ordered descendants of a node (story-lens entries only) */
  function index(worldId) {
    const t = tree(worldId), kids = new Map(), byId = new Map();
    for (const n of t.nodes) { byId.set(n.id, n); if (!kids.has(n.parentId)) kids.set(n.parentId, []); kids.get(n.parentId).push(n); }
    const sub = (id, acc = []) => { for (const c of kids.get(id) || []) { acc.push(c); sub(c.id, acc); } return acc; };
    return { t, kids, byId, sub };
  }
  const storyOf = (ix, id) => { let n = ix.byId.get(id), g = 0; while (n && n.kind !== 'story' && n.parentId && g++ < 50) n = ix.byId.get(n.parentId); return n && n.kind === 'story' ? n : null; };

  /* ---------------- compile ---------------- */
  function docOf(storyId) {
    const e = core().full(storyId);
    const ix = index(e.worldId), ids = [storyId].concat(ix.sub(storyId).map(n => n.id));
    const bodies = new Map(db.all(`SELECT id, body FROM entries WHERE id IN (${placeholders(ids.length)})`, ...ids).map(r => [r.id, r.body || '']));
    const part = n => ({ kind: n.kind, id: n.id, title: n.title, summary: n.summary, fields: n.fields, body: bodies.get(n.id) || '' });
    const parts = [];
    for (const c of ix.kids.get(storyId) || []) {
      if (c.kind === 'scene') { parts.push(part(c)); continue; }
      parts.push(Object.assign(part(c), { children: ix.sub(c.id).filter(x => x.kind === 'scene').map(part) }));
    }
    return { story: { id: e.id, title: e.title, summary: e.summary, fields: e.fields, body: e.body, write: (e.data && e.data.write) || {} }, parts, worldId: e.worldId };
  }
  function mediaSrc(id) {
    try {
      const f = ctx.media && ctx.media.fileOf(id);
      if (!f || !fs.existsSync(f) || fs.statSync(f).size > 8 * 1024 * 1024) return null;
      const m = db.get('SELECT mime FROM media WHERE id = ?', id);
      return 'data:' + ((m && m.mime) || 'image/png') + ';base64,' + fs.readFileSync(f).toString('base64');
    } catch { return null; }
  }
  function compileStory(storyId, opts = {}) {
    const doc = docOf(storyId);
    const saved = (doc.story.write && doc.story.write.compile) || {};
    const o = Object.assign({}, saved, opts);
    if (!o.style && doc.story.write && doc.story.write.format === 'script') o.style = 'script';
    const r = C.compile(doc, o, { titleOf: id => { const x = core().lite(id); return x ? x.title : ''; }, mediaSrc: ['html', 'pdf'].includes(o.format || 'html') ? mediaSrc : null });
    return Object.assign(r, { title: doc.story.title });
  }
  async function toPdf(html, o, frame) {
    const E = ctx.electron;
    if (!E || !E.BrowserWindow) throw new Error('PDF export needs the desktop app.');
    fs.mkdirSync(ctx.paths.exports, { recursive: true });
    const tmp = path.join(ctx.paths.exports, 'compile-' + uid() + '.html');
    fs.writeFileSync(tmp, html, 'utf8');
    const w = new E.BrowserWindow({ show: false, width: 900, height: 1200, webPreferences: { sandbox: true, contextIsolation: true, javascript: false } });
    try {
      await w.loadFile(tmp);
      await new Promise(r => setTimeout(r, 200));   // let web fonts and images settle
      return await w.webContents.printToPDF({ pageSize: o.pageSize || 'A4', printBackground: true, preferCSSPageSize: true, displayHeaderFooter: true, headerTemplate: frame.header, footerTemplate: frame.footer });
    } finally { try { w.destroy(); } catch { } try { fs.rmSync(tmp, { force: true }); } catch { } }
  }
  let lastDir = null;
  async function exportStory(storyId, opts = {}) {
    const r = compileStory(storyId, opts);
    let file;
    if (opts.path && !ctx.dialog) file = opts.path;   // tests: no desktop, no dialog
    else {
      if (!ctx.dialog) throw new Error('Saving needs the desktop app.');
      const dir = lastDir || (ctx.app && ctx.app.getPath ? ctx.app.getPath('documents') : ctx.paths.exports);
      const res = await ctx.dialog.showSaveDialog(ctx.win(), { title: 'Save “' + r.title + '”', defaultPath: path.join(dir, safeName(r.title) + '.' + r.ext), filters: [{ name: FILTER[r.ext] || r.ext, extensions: [r.ext] }] });
      if (res.canceled || !res.filePath) return null;
      file = res.filePath;
      lastDir = path.dirname(file);
    }
    if (r.ext === 'pdf') fs.writeFileSync(file, await toPdf(r.text, r.options, r.frame));
    else fs.writeFileSync(file, r.text, 'utf8');
    return { path: file, stats: r.stats, format: r.ext };
  }

  /* ---------------- find & replace across a story ---------------- */
  function finder(q, o = {}) {
    const s = String(q || '');
    if (!s.trim()) return null;
    const body = o.regex ? s : escRe(s);
    const src = o.wholeWord ? '(?<![\\p{L}\\p{N}_])(?:' + body + ')(?![\\p{L}\\p{N}_])' : body;
    try { return new RegExp(src, 'gu' + (o.caseSensitive ? '' : 'i')); } catch { throw new Error('That search pattern is not valid.'); }
  }
  function scope(id) {
    const e = core().full(id), ix = index(e.worldId);
    return [ix.byId.get(id)].concat(ix.sub(id)).filter(Boolean);
  }
  function find(rootId, q, o = {}) {
    const re = finder(q, o);
    if (!re) return [];
    const list = scope(rootId), out = [];
    for (const n of list) {
      const r = db.get('SELECT body_text FROM entries WHERE id = ?', n.id), text = (r && r.body_text) || '';
      const hits = [];
      re.lastIndex = 0;
      let m;
      while ((m = re.exec(text)) && hits.length < 500) { hits.push([m.index, m[0].length]); if (!m[0].length) re.lastIndex++; }
      if (!hits.length) continue;
      const flat = s => s.replace(/\s+/g, ' ');
      out.push({ id: n.id, kind: n.kind, title: n.title, count: hits.length, snippets: hits.slice(0, 3).map(([i, len]) => ({
        before: (i > 48 ? '…' : '') + flat(text.slice(Math.max(0, i - 48), i)), match: text.substr(i, len), after: flat(text.substr(i + len, 60)) + (i + len + 60 < text.length ? '…' : ''),
      })) });
    }
    return out;
  }
  function rebuild(tk) { return '<' + tk.tag + Object.entries(tk.a || {}).map(([k, v]) => ' ' + k + '="' + T.escAttr(v) + '"').join('') + '>'; }
  /** replaces in text only (never inside mentions, tags or attributes) */
  function replaceIn(html, re, rep) {
    let n = 0, inA = 0;
    const out = [];
    for (const tk of T.tokens(html)) {
      if (tk.t === 'open' && tk.tag === 'a') { inA++; out.push(rebuild(tk)); continue; }
      if (tk.t === 'close' && tk.tag === 'a') { inA = Math.max(0, inA - 1); out.push('</a>'); continue; }
      if (tk.t === 'text') { out.push(T.esc(inA ? tk.v : tk.v.replace(re, () => { n++; return rep; }))); continue; }
      out.push(tk.t === 'close' ? '</' + tk.tag + '>' : rebuild(tk));
    }
    return { html: out.join(''), n };
  }
  function replace(rootId, q, rep, o = {}) {
    const re = finder(q, o);
    if (!re) return { n: 0, changed: [] };
    const changed = [];
    let total = 0;
    for (const n of scope(rootId)) {
      if (o.ids && !o.ids.includes(n.id)) continue;
      const r = db.get('SELECT body FROM entries WHERE id = ?', n.id), before = (r && r.body) || '';
      re.lastIndex = 0;
      const x = replaceIn(before, re, String(rep == null ? '' : rep));
      if (!x.n) continue;
      core().updateEntry(n.id, { body: x.html, snapshot: 'before replacing “' + String(q).slice(0, 40) + '”' });
      changed.push({ id: n.id, before });
      total += x.n;
    }
    return { n: total, changed };
  }

  /* ---------------- split & join scenes ---------------- */
  function split(id, { before = '', after = '', title } = {}) {
    const C0 = core(), e = C0.full(id);
    const keep = {};
    for (const k of ['pov', 'location', 'cast', 'status', 'threads']) if (e.fields[k] !== undefined) keep[k] = e.fields[k];
    let created;
    db.tx(() => {
      C0.updateEntry(id, { body: before, snapshot: 'before splitting' });
      created = C0.createEntry({ worldId: e.worldId, typeId: e.typeId, parentId: e.parentId, title: title || e.title + ' (continued)', body: after, fields: keep, audience: e.audience, start: e.start, end: e.end });
      ctx.call('entries.move', created.id, { parentId: e.parentId, afterId: id });
    });
    return C0.full(created.id);
  }
  function join(ids) {
    ids = [...new Set((ids || []).filter(Boolean))];
    if (ids.length < 2) throw new Error('Pick at least two scenes to join.');
    const C0 = core(), list = ids.map(i => C0.full(i)), first = list[0];
    const body = list.map(x => x.body || '').filter(Boolean).join('<hr>');
    db.tx(() => {
      C0.updateEntry(first.id, { body, summary: first.summary || list.map(x => x.summary).filter(Boolean).join(' '), snapshot: 'before joining' });
      for (const x of list.slice(1)) ctx.call('entries.trash', x.id);
    });
    return { id: first.id, before: first.body || '', trashed: list.slice(1).map(x => x.id) };
  }

  /* ---------------- statistics & sessions ---------------- */
  const sessionRow = r => ({ id: r.id, storyId: r.story_id, entryId: r.entry_id, startedAt: r.started_at, endedAt: r.ended_at, seconds: r.seconds || 0, words: r.words || 0, goal: r.goal || 0, kind: r.kind || 'focus',
    title: r.entry_id ? (db.value('SELECT title FROM entries WHERE id = ?', r.entry_id) || '') : '' });
  function stats(worldId, o = {}) {
    const days = Math.max(7, Math.min(366, +o.days || 30));
    const base = ctx.has('writing.stats') ? ctx.call('writing.stats', worldId, 400) : { series: [], streak: 0, best: 0, today: 0, todaySeconds: 0, goal: 500, top: [] };
    const series = (base.series || []).slice(-days);
    const since = series.length ? series[0].day : isoDay(new Date());
    const perEntry = new Map(db.all('SELECT entry_id AS id, sum(words) AS w, sum(seconds) AS s FROM writing_log WHERE world_id = ? AND day >= ? GROUP BY entry_id', worldId, since).map(r => [r.id, r]));
    const ix = index(worldId);
    const stories = ix.t.nodes.filter(n => n.kind === 'story').map(s => {
      const sub = ix.sub(s.id), all = [s].concat(sub), scenes = sub.filter(x => x.kind === 'scene');
      const status = {};
      for (const sc of scenes) { const k = sc.fields.status || 'None'; status[k] = (status[k] || 0) + 1; }
      return {
        id: s.id, title: s.title, stage: s.fields.stage || '', target: +s.fields.target || 0, format: s.write.format || 'prose',
        words: all.reduce((a, x) => a + x.words, 0), chapters: sub.filter(x => x.kind === 'chapter').length, scenes: scenes.length, status,
        period: all.reduce((a, x) => a + ((perEntry.get(x.id) || {}).w || 0), 0), seconds: all.reduce((a, x) => a + ((perEntry.get(x.id) || {}).s || 0), 0), updatedAt: s.updatedAt,
      };
    });
    const periodWords = series.reduce((a, s) => a + Math.max(0, s.words), 0), active = series.filter(s => s.words > 0);
    const best = series.reduce((b, s) => (s.words > (b ? b.words : 0) ? s : b), null);
    return Object.assign({}, base, {
      days, series, stories, periodWords, periodSeconds: series.reduce((a, s) => a + (s.seconds || 0), 0),
      week: series.slice(-7).reduce((a, s) => a + Math.max(0, s.words), 0), activeDays: active.length,
      average: active.length ? Math.round(periodWords / active.length) : 0, bestDay: best,
      manuscriptWords: stories.reduce((a, s) => a + s.words, 0),
      sessions: db.all('SELECT * FROM write_sessions WHERE world_id = ? ORDER BY started_at DESC LIMIT 12', worldId).map(sessionRow),
    });
  }
  function saveSession(worldId, s = {}) {
    if (!(s.seconds > 0) && !s.words) return null;
    const id = uid();
    db.run('INSERT INTO write_sessions (id, world_id, story_id, entry_id, started_at, ended_at, seconds, words, goal, kind) VALUES (?,?,?,?,?,?,?,?,?,?)',
      id, worldId, s.storyId || null, s.entryId || null, s.startedAt || now(), s.endedAt || now(), Math.round(+s.seconds || 0), Math.round(+s.words || 0), Math.round(+s.goal || 0), String(s.kind || 'focus').slice(0, 20));
    ctx.changed(['write_sessions'], [id]);
    return id;
  }

  /* ---------------- small helpers the screen uses ---------------- */
  function saveData(id, patch = {}) {
    const e = core().full(id);
    const cur = (e.data && e.data.write) || {};
    const next = Object.assign({}, cur);
    for (const [k, v] of Object.entries(patch || {})) { if (v === null) delete next[k]; else next[k] = v; }
    return core().updateEntry(id, { dataPatch: { write: next } });
  }
  function mentions(ids) {
    ids = (ids || []).filter(Boolean);
    if (!ids.length) return [];
    const rows = db.all(`SELECT l.dst AS id, l.kind AS kind, count(DISTINCT l.src) AS n FROM links l WHERE l.src IN (${placeholders(ids.length)}) AND l.kind IN ('mention', 'field') GROUP BY l.dst, l.kind`, ...ids);
    const out = new Map();
    for (const r of rows) { if (ids.includes(r.id)) continue; const x = out.get(r.id) || { id: r.id, mentions: 0, fields: 0 }; if (r.kind === 'mention') x.mentions = r.n; else x.fields = r.n; out.set(r.id, x); }
    if (!out.size) return [];
    const ws = db.get('SELECT world_id FROM entries WHERE id = ?', ids[0]);
    const skip = ws ? storyTypes(ws.world_id).byId : new Map();
    return [...out.values()].map(x => Object.assign(x, { entry: core().lite(x.id) })).filter(x => x.entry && !x.entry.deletedAt && !skip.has(x.entry.typeId))
      .sort((a, b) => (b.mentions + b.fields) - (a.mentions + a.fields) || a.entry.title.localeCompare(b.entry.title));
  }
  /** who and what appears in each scene of a story: point of view, cast, place, plot threads and plain mentions */
  function grid(storyId) {
    const e = core().lite(storyId);
    if (!e) throw new Error('That story no longer exists.');
    const ix = index(e.worldId), scenes = ix.sub(storyId).filter(n => n.kind === 'scene');
    if (!scenes.length) return { scenes: [], cells: {}, entries: [] };
    const ids = scenes.map(s => s.id);
    const cells = {}, used = new Map();
    const mark = (sid, eid, what) => { if (!eid || ix.byId.has(eid)) return; ((cells[sid] = cells[sid] || {})[eid] = cells[sid][eid] || {})[what] = true; used.set(eid, (used.get(eid) || new Set()).add(sid)); };
    for (const s of scenes) {
      const f = s.fields || {};
      if (f.pov) mark(s.id, f.pov, 'pov');
      for (const c of [].concat(f.cast || [])) mark(s.id, c, 'cast');
      if (f.location) mark(s.id, f.location, 'location');
      for (const t of [].concat(f.threads || [])) mark(s.id, t, 'thread');
    }
    for (const l of db.all(`SELECT src, dst FROM links WHERE kind = 'mention' AND src IN (${placeholders(ids.length)})`, ...ids)) mark(l.src, l.dst, 'mention');
    const entries = [...used.keys()].map(id => core().lite(id)).filter(x => x && !x.deletedAt).map(x => Object.assign(x, { scenes: used.get(x.id).size }));
    return { scenes: scenes.map(s => ({ id: s.id, parentId: s.parentId })), cells, entries };
  }
  function newStory(worldId, o = {}) {
    const C0 = core(), t = storyTypes(worldId).ids;
    if (!t.story) throw new Error('This world has no Story type.');
    let story, chapter = null, scene = null;
    db.tx(() => {
      story = C0.createEntry({ worldId, typeId: t.story, title: String(o.title || '').trim() || 'Untitled story', fields: o.fields || {}, data: o.format ? { write: { format: o.format } } : {} });
      if (t.chapter && o.chapter !== false) chapter = C0.createEntry({ worldId, typeId: t.chapter, parentId: story.id, title: o.format === 'script' ? 'Act One' : 'Chapter 1', fields: { status: 'Draft' } });
      if (t.scene && o.scene !== false) scene = C0.createEntry({ worldId, typeId: t.scene, parentId: (chapter || story).id, title: 'Scene 1', fields: { status: 'Draft' } });
    });
    return { story: C0.full(story.id), chapter: chapter && C0.full(chapter.id), scene: scene && C0.full(scene.id) };
  }

  return {
    'write.tree': worldId => tree(worldId),
    'write.bodies': ids => {
      ids = (ids || []).filter(Boolean);
      if (!ids.length) return [];
      const rows = new Map(db.all(`SELECT id, body, word_count, data FROM entries WHERE id IN (${placeholders(ids.length)})`, ...ids).map(r => [r.id, r]));
      return ids.map(id => rows.get(id)).filter(Boolean).map(r => ({ id: r.id, body: r.body || '', words: r.word_count || 0, write: J(r.data, {}).write || {} }));
    },
    'write.storyOf': id => { const e = core().lite(id); if (!e) return null; const ix = index(e.worldId); const s = storyOf(ix, id); return s ? s.id : null; },
    'write.compile': (storyId, opts) => { const r = compileStory(storyId, opts); return { text: r.text, ext: r.ext, stats: r.stats, options: r.options, title: r.title }; },
    'write.export': (storyId, opts) => exportStory(storyId, opts),
    'write.reveal': file => { if (ctx.shell && file && fs.existsSync(file)) ctx.shell.showItemInFolder(file); return true; },
    'write.find': (rootId, q, o) => find(rootId, q, o),
    'write.replace': (rootId, q, rep, o) => replace(rootId, q, rep, o),
    'write.restoreBodies': list => { for (const x of list || []) core().updateEntry(x.id, { body: x.before, snapshot: 'before undoing a replace' }); return true; },
    'write.split': (id, o) => split(id, o),
    'write.join': ids => join(ids),
    'write.saveData': (id, patch) => saveData(id, patch),
    'write.mentions': ids => mentions(ids),
    'write.grid': storyId => grid(storyId),
    'write.newStory': (worldId, o) => newStory(worldId, o),
    'write.stats': (worldId, o) => stats(worldId, o),
    'write.session': (worldId, s) => saveSession(worldId, s),
    'write.sessions': (worldId, n = 20) => db.all('SELECT * FROM write_sessions WHERE world_id = ? ORDER BY started_at DESC LIMIT ?', worldId, Math.max(1, Math.min(200, +n || 20))).map(sessionRow),
  };
}

/* ---------------- the example world's manuscript ---------------- */
function sample(ctx, S) {
  const C0 = ctx.core;
  if (!C0) return;
  const w = C0.world(S.worldId);
  const m = (k, label) => (S.e(k) ? '<a class="wb-m" data-id="' + S.e(k) + '">' + label + '</a>' : label);
  const P = (...lines) => lines.map(l => '<p>' + l + '</p>').join('');
  const nowDay = (w.now && w.now.day) || 0;
  const when = (d, h) => ({ day: nowDay - d, min: h == null ? null : h * 60, prec: h == null ? 'day' : 'time' });

  // the story itself (the core sample normally makes it; if not, Write brings its own)
  const own = !S.e('novella');
  const ensure = (key, type, parentKey, o) => {
    if (S.e(key)) return S.e(key);
    const t = C0.typeByKey(S.worldId, type);
    if (!t) return null;
    const e = C0.createEntry(Object.assign({ worldId: S.worldId, typeId: t.id, parentId: parentKey ? S.e(parentKey) : null }, o));
    S.set(key, e.id);
    return e.id;
  };
  ensure('novella', 'story', null, { title: 'The Drowned Bell', summary: 'A tide-witch hears a bell ringing under the sea where no bell should be, and follows it to the heir the Saltmarch was told had drowned.' });
  if (!S.e('novella')) return;
  ensure('ch1', 'chapter', 'novella', { title: 'The Bell Under the Water' });
  ensure('s1', 'scene', 'ch1', { title: 'Low Tide at Gullhaven', body: P(
    `The tide went out further than ${m('mira', 'Mira')} had ever seen it go, past the last mooring post, past the green weed line, out to where the old breakwater showed its broken teeth.`,
    `She stood on the slick stones of the ${m('harbour', 'harbour')} with her boots full of cold water and listened. Under the gulls, under the wind worrying the rigging, under her own breath, there it was again: a bell. One slow stroke, then nothing, as if whoever rang it had to gather courage between blows.`,
    `“You hear that?” she asked.`,
    `${m('fenn', 'Fenn')} did not look up from his nets. “I hear you getting your feet wet for nothing. There’s no bell out there, girl. There’s no tower left to hang one in.”`,
    `But the drowned had never lied to her, and they were all listening now, a whole sunken town holding its breath beneath the flats.`,
    `<span class="wb-s">The bell is the old chapel bell of Tidewell. Only the drowned can ring it, and only when a true heir of the town is near the water.</span>`,
  ) });
  ensure('s2', 'scene', 'ch1', { title: 'The Wardens’ Question', body: P(
    `They came for her at dusk, three ${m('saltwardens', 'Saltwardens')} in oiled grey coats, salt crusted white along the hems.`,
    `${m('corwin', 'Corwin')} did the talking, as he always did. He was polite in the way a blade is polite before it is drawn. “The harbourmaster says you were out on the flats at low water. Asking about bells.”`,
    `“I was out on the flats,” Mira said. “The tide doesn’t need my permission and neither do I.”`,
    `“Bells,” Corwin repeated, and for one heartbeat something moved behind his eyes that was not politeness at all. It was fear. “There are no bells under the Saltmarch, Mistress Saltborn. The Crown made very sure of that.”`,
  ) });
  ensure('ch2', 'chapter', 'novella', { title: 'Salt and Silver' });
  ensure('s3', 'scene', 'ch2', { title: 'Brannoc’s Ledger', body: P(
    `In the ${m('sunkenmarket', 'Sunken Market')} you could buy anything that had ever been lost at sea, and a good deal that had only been mislaid on land.`,
    `${m('brannoc', 'Brannoc')} kept his accounts in a ledger bound in sharkskin, and he let no one read it. Tonight he read it himself, twice, running a thumb down the columns as though the numbers might rearrange themselves if he pressed hard enough.`,
    `Twelve years of payments to ${m('veykeep', 'Veykeep')}. Every one of them on the night of a spring tide. Every one of them marked with the same small sign: a bell.`,
  ) });
  ensure('s4', 'scene', 'ch2', { title: 'An Invitation to Veykeep', body: P(
    `The invitation arrived on heavy cream paper with the ${m('housevey', 'House Vey')} seal pressed so deep it had cracked.`,
    `${m('elsabet', 'Elsabet')} read it at the window while the rain came sideways off the sea. A wedding. Her cousin’s wedding, at the turning of the year, in the great hall where her mother had once told her never to go alone.`,
    `At the bottom, in a hand she did not know: <em>Bring the girl who hears the drowned.</em>`,
  ) });
  ensure('ch3', 'chapter', 'novella', { title: 'What the Tide Keeps' });
  ensure('s5', 'scene', 'ch3', { title: 'Crossing the Greyflats', body: P(
    `There were two safe paths across the ${m('greyflats', 'Greyflats')} and ${m('tamsin', 'Tamsin')} knew neither of them, which was why she walked so close behind Mira that their lanterns knocked together.`,
    `“If the tide turns—”`,
    `“It won’t turn for an hour.”`,
    `“And if the drowned decide they want company?”`,
    `Mira did not answer. Under the mud, under the salt, under the soles of their boots, the bell was ringing faster now.`,
  ) });
  ensure('s6', 'scene', 'ch3', { title: 'The Lantern on the Rock', body: P(
    `On ${m('lanternrock', 'Lantern Rock')} the old keeper’s light still turned, though no keeper had climbed the stair in a lifetime.`,
  ) });

  // beats, summaries, notes and dates: only what is still empty, so the core sample's own values stay
  const fill = (key, o) => {
    const id = S.e(key);
    if (!id) return;
    let e;
    try { e = C0.full(id); } catch { return; }
    const fields = {};
    for (const [k, v] of Object.entries(o.fields || {})) {
      if (v == null || (Array.isArray(v) && !v.filter(Boolean).length)) continue;
      const cur = e.fields[k];
      if (cur == null || cur === '' || (Array.isArray(cur) && !cur.length)) fields[k] = Array.isArray(v) ? v.filter(Boolean) : v;
    }
    const p = {};
    if (Object.keys(fields).length) p.fieldsPatch = fields;
    if (o.summary && !e.summary) p.summary = o.summary;
    if (o.start && !e.start) p.start = o.start;
    if (o.write) p.dataPatch = { write: Object.assign({}, o.write, (e.data && e.data.write) || {}) };
    if (Object.keys(p).length) C0.updateEntry(id, p);
  };
  const e = k => S.e(k);
  const thread = [e('plotheir')].filter(Boolean), crown = [e('plotcrown')].filter(Boolean);
  if (own) {
    fill('novella', { fields: { genre: 'Coastal fantasy · mystery', logline: 'When a bell rings under the sea where no bell should be, a tide-witch follows it to the heir the Saltmarch was told had drowned.', target: 30000, pov: e('mira'), stage: 'Drafting', themes: ['What the sea keeps', 'Inheritance', 'Listening'] } });
    fill('ch1', { summary: 'Mira hears a bell no one else can, and the Saltwardens notice.', fields: { status: 'Revised', target: 4000 } });
    fill('ch2', { summary: 'Brannoc’s ledger and the Vey invitation point to the same secret.', fields: { status: 'Draft', target: 4000 } });
    fill('ch3', { summary: 'Across the flats to the lighthouse, where the bell is loudest.', fields: { status: 'Idea', target: 5000 } });
    fill('s1', { summary: 'At the lowest tide in memory, Mira hears a drowned bell; Fenn hears nothing.', start: when(14, 6), fields: { pov: e('mira'), location: e('harbour') || e('gullhaven'), cast: [e('mira'), e('fenn')], status: 'Final', target: 1500, goal: 'Find where the bell is ringing', conflict: 'Nobody else can hear it', outcome: 'She marks the spot on the flats', threads: thread } });
    fill('s2', { summary: 'The Saltwardens question Mira; Corwin lets slip that the Crown fears the bell.', start: when(14, 19), fields: { pov: e('mira'), location: e('gullhaven'), cast: [e('mira'), e('corwin')], status: 'Revised', target: 1500, goal: 'Get rid of the Wardens without lying', conflict: 'Corwin knows more than he says', outcome: 'Mira learns the Crown is afraid', threads: thread.concat(crown) } });
    fill('s3', { summary: 'Brannoc rereads his ledger: twelve years of bell-marked payments to Veykeep.', start: when(12, 23), fields: { pov: e('brannoc'), location: e('sunkenmarket'), cast: [e('brannoc')], status: 'Revised', target: 1200, goal: 'Balance the books', conflict: 'The numbers point at House Vey', outcome: 'He decides to sell the ledger', threads: thread } });
    fill('s4', { summary: 'Elsabet receives a Vey wedding invitation with a note: bring the girl who hears the drowned.', start: when(10, 10), fields: { pov: e('elsabet'), location: e('veykeep'), cast: [e('elsabet')], status: 'Draft', target: 1500, goal: 'Decide whether to go home', conflict: 'Someone in Veykeep knows about Mira', outcome: 'She accepts', threads: thread.concat(crown) } });
    fill('s5', { summary: 'Mira and Tamsin cross the Greyflats at night as the bell quickens.', start: when(6, 22), fields: { pov: e('mira'), location: e('greyflats'), cast: [e('mira'), e('tamsin')], status: 'Draft', target: 1800, goal: 'Reach Lantern Rock before the tide', conflict: 'Tamsin’s fear, the turning tide', outcome: 'They reach the rock — barely', threads: thread } });
    fill('s6', { summary: 'At the lighthouse the bell rings for someone standing beside Mira.', start: when(6, 23), fields: { pov: e('mira'), location: e('lanternrock'), cast: [e('mira'), e('tamsin')], status: 'Idea', target: 2000, goal: 'Find the bell', conflict: 'It is ringing for Tamsin, not for her', outcome: 'Tamsin is the heir', threads: thread } });
  } else {
    // the core's "The Salt Heir": summaries for the index cards, the beats it leaves open, notes and dates
    fill('ch1', { summary: 'The drowned tower lights up and the whole Saltmarch starts listening.' });
    fill('ch2', { summary: 'Debts come due: Corwin’s to the Gulls, and Brannoc’s to the truth.' });
    fill('ch3', { summary: 'Everyone rows out to the drowned tower, each for a different reason.' });
    fill('s1', { summary: 'Green lights burn in drowned Storm Spire; Ysolde defies the harbour chain to reach them.' });
    fill('s2', { summary: 'Fenn brings Mira a summons from the Queen of Gulls: it is about a crown.' });
    fill('s3', { summary: 'Corwin begs Tamsin for time on his debt; she wants a map of Tidewell instead.' });
    fill('s4', { summary: 'Brannoc shows Corwin the ledger page for the year he was born.', fields: { goal: 'Brannoc wants Corwin to understand what he owes.', conflict: 'The ledger says more than Brannoc meant it to.', outcome: 'Corwin leaves without a word.' } });
    fill('s5', { summary: 'At Lantern Rock the drowned stand in rows on the water and bow to Mira.', fields: { goal: 'Mira wants to ask the drowned about the crown.', conflict: 'They will only answer her as their queen.', outcome: 'She lets them bow.' } });
    fill('s6', { summary: 'Inside Storm Spire the tide comes to collect what it is owed.', fields: { goal: 'Ysolde wants the crown before the Inland Crown arrives.', conflict: 'Corwin needs it to pay the Gulls.' } });
  }
  fill('novella', { write: { pinned: ['tidecrown', 'stormspire', 'plotheir', 'plotcrown', 'corwin', 'mira', 'tidewell'].map(e).filter(Boolean), compile: { author: 'A. Saltmarch', chapterHeads: 'words', separator: '* * *', titlePage: true } } });
  fill('s1', { write: { notes: own ? 'Open on sound, not sight. Let the drowned react before Mira does.' : 'Open on light, not people. Ysolde should be moving before we know who she is.' } });
  fill('s4', { write: { notes: own ? 'Plant the cracked seal; pay it off in chapter five.' : 'Plant the double payment in the margin; don’t explain it yet. Corwin should notice before the reader does.' } });
  fill('s6', { write: { notes: 'Unwritten. Try it from inside the tower, in the dark, with only the sound of the bells.' } });

  // a longer writing history so the streak and the 30/90-day charts have something to show (days that are still empty only)
  try {
    const sceneIds = ['s1', 's2', 's3', 's4', 's5', 's6'].map(e).filter(Boolean);
    if (sceneIds.length) {
      const have = new Set(ctx.db.all('SELECT DISTINCT day FROM writing_log WHERE world_id = ?', S.worldId).map(r => r.day));
      let seed = 7;
      const rnd = () => { seed = (seed * 9301 + 49297) % 233280; return seed / 233280; };
      for (let i = 75; i >= 1; i--) {
        const d = isoDay(new Date(Date.now() - i * 864e5));
        const r = rnd();
        if (have.has(d) || (have.size && i <= 14)) continue;   // the core's recent days stay as they are
        if (i > 7 && r < .32) continue;                         // rest days, but the last week is a streak
        const words = Math.round(160 + rnd() * 760);
        const entry = sceneIds[Math.min(sceneIds.length - 1, Math.floor((75 - i) / 75 * Math.min(4, sceneIds.length)))];
        ctx.db.run('INSERT OR IGNORE INTO writing_log (world_id, day, entry_id, words, seconds) VALUES (?,?,?,?,?)', S.worldId, d, entry, words, Math.round(words * (2.2 + rnd() * 1.4)));
      }
      const ins = (ago, mins, words, key) => ctx.db.run('INSERT INTO write_sessions (id, world_id, story_id, entry_id, started_at, ended_at, seconds, words, goal, kind) VALUES (?,?,?,?,?,?,?,?,?,?)',
        uid(), S.worldId, e('novella'), e(key), new Date(Date.now() - ago * 3600e3).toISOString(), new Date(Date.now() - ago * 3600e3 + mins * 60e3).toISOString(), mins * 60, words, 500, 'focus');
      ins(22, 34, 820, 's4'); ins(46, 25, 640, 's3'); ins(70, 41, 710, 's3'); ins(118, 19, 300, 's2');
    }
  } catch (err) { console.error('write sample history', err); }
}

module.exports = { migrations, handlers, sample };
