'use strict';
/* Worldbuilder's main-process side: opens the database, runs every area's migrations and mounts their handlers as
   H['wb:<area>.<action>']. Areas are the files in ./areas (core first, then alphabetical). */
const fs = require('fs');
const path = require('path');
const { open, migrate } = require('./db');
const U = require('./util');

/**
 * o: { H, dataDir, dbFile?, send(event, payload), win() → BrowserWindow|null, dialog?, shell?, app?, fileUrl(p) }
 * returns ctx (also used by the unit tests with a temp folder and no Electron)
 */
function setup(o) {
  fs.mkdirSync(o.dataDir, { recursive: true });
  const db = open(o.dbFile || path.join(o.dataDir, 'worldbuilder.db'));
  const dir = path.join(__dirname, 'areas');
  const files = fs.readdirSync(dir).filter(f => f.endsWith('.js'))
    .sort((a, b) => (a === 'core.js' ? -1 : b === 'core.js' ? 1 : a.localeCompare(b)));
  const modules = files.map(f => ({ name: f.slice(0, -3), mod: require(path.join(dir, f)) }));
  migrate(db, modules.flatMap(m => m.mod.migrations || []));

  // change notifications are gathered and sent once per tick
  let pending = null;
  const flush = () => {
    const p = pending; pending = null;
    if (p && o.send) o.send('wb:changed', { tables: [...p.tables], ids: [...p.ids] });
  };
  const ctx = {
    db, U, modules, dataDir: o.dataDir, app: o.app || null, dialog: o.dialog || null, shell: o.shell || null, electron: o.electron || null,
    win: o.win || (() => null), fileUrl: o.fileUrl || (p => 'file:///' + p.replace(/\\/g, '/')),
    paths: {
      data: o.dataDir,
      media: worldId => path.join(o.dataDir, 'media', worldId),
      backups: path.join(o.dataDir, 'backups'),
      exports: path.join(o.dataDir, 'exports'),
    },
    uid: U.uid, now: U.now,
    changed(tables, ids) {
      if (!pending) { pending = { tables: new Set(), ids: new Set() }; setImmediate(flush); }
      for (const t of [].concat(tables || [])) pending.tables.add(t);
      for (const i of [].concat(ids || [])) if (i) pending.ids.add(i);
    },
    send: (ev, payload) => o.send && o.send(ev, payload),
    handlers: {},
    /** call another handler directly (same arguments as from the renderer) */
    call(name, ...args) { const fn = ctx.handlers[name]; if (!fn) throw new Error('Unknown action: ' + name); return fn(...args); },
    has: name => !!ctx.handlers[name],
  };
  for (const m of modules) {
    const hs = m.mod.handlers ? m.mod.handlers(ctx) : {};
    for (const [k, fn] of Object.entries(hs)) {
      ctx.handlers[k] = fn;
      if (o.H) o.H['wb:' + k] = function (...args) { return fn.apply(this, args); };
    }
  }
  for (const m of modules) if (m.mod.ready) m.mod.ready(ctx);
  return ctx;
}

module.exports = { setup };
