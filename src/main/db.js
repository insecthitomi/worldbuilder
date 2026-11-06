'use strict';
/* SQLite through Node's built-in node:sqlite (no native module to rebuild). */
const { DatabaseSync } = require('node:sqlite');

const bindOne = v => (v === undefined ? null : v === true ? 1 : v === false ? 0
  : v !== null && typeof v === 'object' && !(v instanceof Uint8Array) ? JSON.stringify(v) : v);
const bind = p => p.map(bindOne);

function open(file) {
  const db = new DatabaseSync(file);
  db.exec('PRAGMA foreign_keys = ON; PRAGMA busy_timeout = 4000;');
  if (file !== ':memory:') db.exec('PRAGMA journal_mode = WAL; PRAGMA synchronous = NORMAL;');
  const cache = new Map();
  const stmt = sql => { let s = cache.get(sql); if (!s) { s = db.prepare(sql); cache.set(sql, s); } return s; };
  let depth = 0;
  return {
    raw: db, file,
    all: (sql, ...p) => stmt(sql).all(...bind(p)),
    get: (sql, ...p) => stmt(sql).get(...bind(p)) || null,
    run: (sql, ...p) => stmt(sql).run(...bind(p)),
    value(sql, ...p) { const r = stmt(sql).get(...bind(p)); return r ? Object.values(r)[0] : null; },
    exec: sql => db.exec(sql),
    /** runs fn in a transaction (nested calls become savepoints); fn must be synchronous */
    tx(fn) {
      const sp = 'sp' + depth;
      db.exec(depth === 0 ? 'BEGIN' : 'SAVEPOINT ' + sp);
      depth++;
      try {
        const r = fn();
        depth--;
        db.exec(depth === 0 ? 'COMMIT' : 'RELEASE ' + sp);
        return r;
      } catch (e) {
        depth--;
        if (depth === 0) db.exec('ROLLBACK'); else { db.exec('ROLLBACK TO ' + sp); db.exec('RELEASE ' + sp); }
        throw e;
      }
    },
    hasTable: name => !!stmt("SELECT 1 FROM sqlite_master WHERE type IN ('table','view') AND name = ?").get(name),
    columns: table => db.prepare('PRAGMA table_info(' + JSON.stringify(table) + ')').all().map(c => c.name),
    close: () => { cache.clear(); db.close(); },
  };
}

/** runs every migration not yet applied, in order; m.sql is SQL text or fn(db) */
function migrate(db, list) {
  db.exec('CREATE TABLE IF NOT EXISTS migrations (id TEXT PRIMARY KEY, at TEXT)');
  const done = new Set(db.all('SELECT id FROM migrations').map(r => r.id));
  for (const m of list) {
    if (done.has(m.id)) continue;
    db.tx(() => {
      if (typeof m.sql === 'function') m.sql(db); else db.exec(m.sql);
      db.run('INSERT INTO migrations (id, at) VALUES (?, ?)', m.id, new Date().toISOString());
    });
  }
}

module.exports = { open, migrate, bind };
