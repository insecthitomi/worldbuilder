'use strict';
/* Backups: consistent copies of the database (VACUUM INTO), one automatic copy a day, labelled copies before risky
   operations, and restore on the next launch (the open database can't be swapped while in use). */
const fs = require('fs');
const path = require('path');
const { safeName } = require('../util');

const stamp = d => d.toISOString().replace(/[:T]/g, '-').replace(/\..+$/, '');
const AUTO = 'Daily';

function list(dir) {
  if (!fs.existsSync(dir)) return [];
  return fs.readdirSync(dir).filter(f => /\.db$/.test(f)).map(f => {
    const m = /^(\d{4}-\d{2}-\d{2}-\d{2}-\d{2}-\d{2})__(.*)\.db$/.exec(f);
    const st = fs.statSync(path.join(dir, f));
    const at = m ? m[1].replace(/^(\d{4}-\d{2}-\d{2})-(\d{2})-(\d{2})-(\d{2})$/, '$1T$2:$3:$4Z') : st.mtime.toISOString();
    return { file: f, label: m ? m[2] : f.replace(/\.db$/, ''), at, size: st.size, auto: m ? m[2] === AUTO : false };
  }).sort((a, b) => b.at.localeCompare(a.at));
}

/** called by main.js before the database opens: a pending restore swaps the file in */
function applyPendingRestore(dataDir) {
  const marker = path.join(dataDir, 'restore.json');
  if (!fs.existsSync(marker)) return null;
  let info = null;
  try { info = JSON.parse(fs.readFileSync(marker, 'utf8')); } catch { }
  try { fs.rmSync(marker, { force: true }); } catch { }
  if (!info || !info.file) return null;
  const src = path.join(dataDir, 'backups', path.basename(info.file)), db = path.join(dataDir, 'worldbuilder.db');
  if (!fs.existsSync(src)) return null;
  for (const x of [db + '-wal', db + '-shm']) { try { fs.rmSync(x, { force: true }); } catch { } }
  fs.copyFileSync(src, db);
  return info.file;
}

function handlers(ctx) {
  const dir = () => { fs.mkdirSync(ctx.paths.backups, { recursive: true }); return ctx.paths.backups; };
  function create(label) {
    const name = stamp(new Date()) + '__' + safeName(label || 'Manual').replace(/__+/g, '_') + '.db';
    const file = path.join(dir(), name);
    ctx.db.exec("VACUUM INTO '" + file.replace(/'/g, "''") + "'");
    prune();
    ctx.changed(['backups']);
    return list(dir()).find(b => b.file === name);
  }
  function prune() {
    const keepAuto = 14, keepOther = 40, all = list(dir());
    const autos = all.filter(b => b.auto), others = all.filter(b => !b.auto);
    for (const b of autos.slice(keepAuto).concat(others.slice(keepOther))) { try { fs.rmSync(path.join(dir(), b.file), { force: true }); } catch { } }
  }
  return {
    'backup.list': () => list(dir()),
    'backup.create': label => create(label),
    'backup.remove': file => { fs.rmSync(path.join(dir(), path.basename(file)), { force: true }); ctx.changed(['backups']); return true; },
    'backup.openFolder': () => { if (ctx.shell) ctx.shell.openPath(dir()); return true; },
    'backup.restore': file => {
      const src = path.join(dir(), path.basename(file));
      if (!fs.existsSync(src)) throw new Error('That backup no longer exists.');
      create('Before restoring ' + path.basename(file).replace(/\.db$/, ''));
      fs.writeFileSync(path.join(ctx.paths.data, 'restore.json'), JSON.stringify({ file: path.basename(file), at: new Date().toISOString() }));
      if (ctx.app) setTimeout(() => { ctx.app.relaunch(); ctx.app.exit(0); }, 300);
      return true;
    },
    'backup.daily': () => {
      const today = new Date().toISOString().slice(0, 10);
      if (list(dir()).some(b => b.auto && b.at.slice(0, 10) === today)) return null;
      if (!ctx.db.value('SELECT count(*) FROM entries')) return null;
      return create(AUTO);
    },
  };
}

module.exports = { handlers, applyPendingRestore, list };
