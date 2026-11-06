'use strict';
/* Media library: images, audio, video and files copied into userData/media/<world>/. */
const fs = require('fs');
const path = require('path');
const { uid, now, J, safeName, placeholders } = require('../util');

const migrations = [{
  id: 'media-001',
  sql: `CREATE TABLE media (id TEXT PRIMARY KEY, world_id TEXT NOT NULL REFERENCES worlds(id) ON DELETE CASCADE, kind TEXT, name TEXT, file TEXT,
    mime TEXT, size INTEGER, width INTEGER, height INTEGER, duration REAL, tags TEXT DEFAULT '[]', note TEXT DEFAULT '', created_at TEXT, deleted_at TEXT);
    CREATE INDEX media_world ON media (world_id, deleted_at);`,
}];

const EXT = {
  png: 'image/png', jpg: 'image/jpeg', jpeg: 'image/jpeg', gif: 'image/gif', webp: 'image/webp', avif: 'image/avif', bmp: 'image/bmp', svg: 'image/svg+xml',
  mp3: 'audio/mpeg', wav: 'audio/wav', ogg: 'audio/ogg', oga: 'audio/ogg', m4a: 'audio/mp4', flac: 'audio/flac', weba: 'audio/webm', opus: 'audio/ogg',
  mp4: 'video/mp4', webm: 'video/webm', mov: 'video/quicktime',
  pdf: 'application/pdf', txt: 'text/plain', md: 'text/markdown', json: 'application/json', csv: 'text/csv',
};
const FILTERS = {
  image: [{ name: 'Images', extensions: ['png', 'jpg', 'jpeg', 'webp', 'gif', 'avif', 'bmp', 'svg'] }],
  audio: [{ name: 'Audio', extensions: ['mp3', 'wav', 'ogg', 'm4a', 'flac', 'webm', 'opus'] }],
  any: [{ name: 'Images, audio, video, documents', extensions: Object.keys(EXT) }, { name: 'All files', extensions: ['*'] }],
};
const kindOf = mime => (/^image\//.test(mime) ? 'image' : /^audio\//.test(mime) ? 'audio' : /^video\//.test(mime) ? 'video' : 'file');
const mimeOf = (name, fallback) => EXT[String(path.extname(name || '')).slice(1).toLowerCase()] || fallback || 'application/octet-stream';
const extFor = mime => (Object.entries(EXT).find(([, m]) => m === mime) || ['bin'])[0];

/** width/height from the file header (png, jpeg, gif, webp, bmp, svg) */
function imageSize(buf, mime) {
  try {
    if (mime === 'image/png' && buf.length > 24) return { w: buf.readUInt32BE(16), h: buf.readUInt32BE(20) };
    if (mime === 'image/gif' && buf.length > 10) return { w: buf.readUInt16LE(6), h: buf.readUInt16LE(8) };
    if (mime === 'image/bmp' && buf.length > 26) return { w: buf.readInt32LE(18), h: Math.abs(buf.readInt32LE(22)) };
    if (mime === 'image/jpeg') {
      let i = 2;
      while (i + 9 < buf.length) {
        if (buf[i] !== 0xff) { i++; continue; }
        const m = buf[i + 1], len = buf.readUInt16BE(i + 2);
        if (m >= 0xc0 && m <= 0xcf && m !== 0xc4 && m !== 0xc8 && m !== 0xcc) return { h: buf.readUInt16BE(i + 5), w: buf.readUInt16BE(i + 7) };
        i += 2 + len;
      }
    }
    if (mime === 'image/webp' && buf.length > 30) {
      const f = buf.toString('ascii', 12, 16);
      if (f === 'VP8X') return { w: 1 + buf.readUIntLE(24, 3), h: 1 + buf.readUIntLE(27, 3) };
      if (f === 'VP8 ') return { w: buf.readUInt16LE(26) & 0x3fff, h: buf.readUInt16LE(28) & 0x3fff };
      if (f === 'VP8L') { const b = buf.readUInt32LE(21); return { w: (b & 0x3fff) + 1, h: ((b >> 14) & 0x3fff) + 1 }; }
    }
    if (mime === 'image/svg+xml') {
      const s = buf.toString('utf8', 0, Math.min(buf.length, 4000)), tag = (/<svg\b[^>]*>/i.exec(s) || [''])[0];
      const num = a => { const m = new RegExp('\\b' + a + '\\s*=\\s*["\']([\\d.]+)(px)?["\']', 'i').exec(tag); return m ? +m[1] : null; };
      let w = num('width'), h = num('height');
      const vb = /viewBox\s*=\s*["']\s*[-\d.]+[\s,]+[-\d.]+[\s,]+([\d.]+)[\s,]+([\d.]+)/i.exec(tag);
      if ((!w || !h) && vb) { w = +vb[1]; h = +vb[2]; }
      if (w && h) return { w: Math.round(w), h: Math.round(h) };
    }
  } catch { }
  return null;
}

function handlers(ctx) {
  const { db } = ctx;
  const dir = worldId => { const d = ctx.paths.media(worldId); fs.mkdirSync(d, { recursive: true }); return d; };
  const fileOf = r => path.join(ctx.paths.media(r.world_id), r.file || '');
  const row = r => r && ({
    id: r.id, worldId: r.world_id, kind: r.kind, name: r.name, file: r.file, mime: r.mime, size: r.size, width: r.width, height: r.height,
    duration: r.duration, tags: J(r.tags, []), note: r.note || '', createdAt: r.created_at, deletedAt: r.deleted_at, url: ctx.fileUrl(fileOf(r)),
  });
  const get = id => row(db.get('SELECT * FROM media WHERE id = ?', id));

  function store(worldId, name, buf, mime, meta = {}) {
    mime = mime && mime !== 'application/octet-stream' ? mime : mimeOf(name);
    const id = uid(), ext = (path.extname(name || '').slice(1).toLowerCase() || extFor(mime)).replace(/[^a-z0-9]/g, '') || 'bin';
    const file = id + '.' + ext;
    fs.writeFileSync(path.join(dir(worldId), file), buf);
    const sz = kindOf(mime) === 'image' ? imageSize(buf, mime) : null;
    db.run(`INSERT INTO media (id, world_id, kind, name, file, mime, size, width, height, duration, tags, note, created_at) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?)`,
      id, worldId, meta.kind || kindOf(mime), safeName(meta.name || String(name || 'file').replace(/\.[^.]+$/, '')), file, mime, buf.length,
      meta.width || (sz && sz.w) || null, meta.height || (sz && sz.h) || null, meta.duration || null, meta.tags || [], meta.note || '', now());
    ctx.changed(['media'], [id]);
    return get(id);
  }
  function usage(id) {
    const r = db.get('SELECT world_id FROM media WHERE id = ?', id);
    if (!r) return [];
    const like = '%' + id + '%';
    const list = db.all(`SELECT id, title, type_id FROM entries WHERE world_id = ? AND deleted_at IS NULL AND (cover_id = ? OR fields LIKE ? OR body LIKE ? OR data LIKE ?)`, r.world_id, id, like, like, like)
      .map(e => ({ entryId: e.id, title: e.title, typeId: e.type_id }));
    // pictures on boards count too, read from the cards themselves
    if (db.hasTable('board_items') && db.columns('board_items').includes('media_id')) {
      for (const b of db.all('SELECT DISTINCT e.id, e.title, e.type_id FROM board_items i JOIN entries e ON e.id = i.board_id WHERE i.media_id = ? AND e.deleted_at IS NULL', id)) {
        if (!list.some(x => x.entryId === b.id)) list.push({ entryId: b.id, title: b.title, typeId: b.type_id });
      }
    }
    if (db.get('SELECT 1 FROM worlds WHERE cover_id = ?', id)) list.unshift({ world: true, title: 'World cover' });
    return list;
  }
  ctx.media = { get, store, fileOf: id => { const r = db.get('SELECT * FROM media WHERE id = ?', id); return r ? fileOf(r) : null; }, imageSize, mimeOf };

  return {
    'media.import': async (worldId, o = {}) => {
      if (!ctx.dialog) throw new Error('Importing needs the desktop app.');
      const r = await ctx.dialog.showOpenDialog(ctx.win(), { properties: ['openFile'].concat(o.multi === false ? [] : ['multiSelections']), filters: FILTERS[o.kind] || FILTERS.any });
      if (r.canceled) return [];
      return r.filePaths.map(p => store(worldId, path.basename(p), fs.readFileSync(p), mimeOf(p), { name: path.basename(p).replace(/\.[^.]+$/, '') }));
    },
    'media.importPaths': (worldId, paths) => (paths || []).filter(p => fs.existsSync(p)).map(p => store(worldId, path.basename(p), fs.readFileSync(p), mimeOf(p))),
    /** bytes: Uint8Array | ArrayBuffer | base64 string */
    'media.save': (worldId, { name, mime, bytes, base64, kind, width, height, duration, tags, note } = {}) => {
      const buf = base64 != null ? Buffer.from(String(base64).replace(/^data:[^,]*,/, ''), 'base64') : Buffer.from(bytes instanceof ArrayBuffer ? new Uint8Array(bytes) : bytes || []);
      if (!buf.length) throw new Error('That file is empty.');
      if (buf.length > 512 * 1024 * 1024) throw new Error('Files up to 512 MB can be kept.');
      return store(worldId, name || 'file', buf, mime, { kind, width, height, duration, tags, note, name: name && String(name).replace(/\.[^.]+$/, '') });
    },
    'media.list': (worldId, o = {}) => {
      const where = ['world_id = ?'], vals = [worldId];
      where.push(o.trashed ? 'deleted_at IS NOT NULL' : 'deleted_at IS NULL');
      if (o.kind) { where.push('kind = ?'); vals.push(o.kind); }
      if (o.q) { where.push('(name LIKE ? OR tags LIKE ? OR note LIKE ?)'); vals.push('%' + o.q + '%', '%' + o.q + '%', '%' + o.q + '%'); }
      if (o.ids) { if (!o.ids.length) return []; where.push(`id IN (${placeholders(o.ids.length)})`); vals.push(...o.ids); }
      let list = db.all(`SELECT * FROM media WHERE ${where.join(' AND ')} ORDER BY ${o.sort === 'name' ? 'name COLLATE NOCASE' : o.sort === 'size' ? 'size DESC' : 'created_at DESC'}`, ...vals).map(row);
      if (o.unused) list = list.filter(m => !usage(m.id).length);
      return list;
    },
    'media.get': id => get(id),
    'media.update': (id, p = {}) => {
      if (p.name != null) db.run('UPDATE media SET name = ? WHERE id = ?', safeName(p.name), id);
      if (p.tags) db.run('UPDATE media SET tags = ? WHERE id = ?', p.tags.map(String), id);
      if (p.note != null) db.run('UPDATE media SET note = ? WHERE id = ?', String(p.note), id);
      if (p.width && p.height) db.run('UPDATE media SET width = ?, height = ? WHERE id = ?', Math.round(p.width), Math.round(p.height), id);
      if (p.duration) db.run('UPDATE media SET duration = ? WHERE id = ?', +p.duration, id);
      ctx.changed(['media'], [id]);
      return get(id);
    },
    'media.remove': id => { db.run('UPDATE media SET deleted_at = ? WHERE id = ?', now(), id); ctx.changed(['media'], [id]); return true; },
    'media.restore': id => { db.run('UPDATE media SET deleted_at = NULL WHERE id = ?', id); ctx.changed(['media'], [id]); return get(id); },
    'media.purge': id => {
      const r = db.get('SELECT * FROM media WHERE id = ?', id);
      if (r) { try { fs.rmSync(fileOf(r), { force: true }); } catch { } db.run('DELETE FROM media WHERE id = ?', id); }
      ctx.changed(['media'], [id]);
      return true;
    },
    'media.usage': id => usage(id),
    'media.reveal': id => { const r = db.get('SELECT * FROM media WHERE id = ?', id); if (r && ctx.shell) ctx.shell.showItemInFolder(fileOf(r)); return true; },
    'media.replace': async id => {
      const r = db.get('SELECT * FROM media WHERE id = ?', id);
      if (!r || !ctx.dialog) return null;
      const pick = await ctx.dialog.showOpenDialog(ctx.win(), { properties: ['openFile'], filters: FILTERS[r.kind] || FILTERS.any });
      if (pick.canceled || !pick.filePaths[0]) return null;
      const buf = fs.readFileSync(pick.filePaths[0]), mime = mimeOf(pick.filePaths[0]);
      const file = r.id + '.' + (path.extname(pick.filePaths[0]).slice(1).toLowerCase() || extFor(mime));
      try { fs.rmSync(fileOf(r), { force: true }); } catch { }
      fs.writeFileSync(path.join(dir(r.world_id), file), buf);
      const sz = kindOf(mime) === 'image' ? imageSize(buf, mime) : null;
      db.run('UPDATE media SET file = ?, mime = ?, size = ?, width = ?, height = ? WHERE id = ?', file, mime, buf.length, sz && sz.w, sz && sz.h, id);
      ctx.changed(['media'], [id]);
      return get(id);
    },
    'media.export': async id => {
      const r = db.get('SELECT * FROM media WHERE id = ?', id);
      if (!r || !ctx.dialog) return null;
      const res = await ctx.dialog.showSaveDialog(ctx.win(), { defaultPath: safeName(r.name) + path.extname(r.file) });
      if (res.canceled || !res.filePath) return null;
      fs.copyFileSync(fileOf(r), res.filePath);
      return res.filePath;
    },
    'media.text': id => { const r = db.get('SELECT * FROM media WHERE id = ?', id); return r && /^(text\/|application\/json|image\/svg)/.test(r.mime) ? fs.readFileSync(fileOf(r), 'utf8') : null; },
  };
}

module.exports = { migrations, handlers, imageSize };
