'use strict';
/* Tasks (to-dos, optionally attached to an entry) and writing statistics (words per day, streaks, focus time). */
const { uid, now, today, placeholders } = require('../util');

const migrations = [{
  id: 'productivity-001',
  sql: `CREATE TABLE tasks (id TEXT PRIMARY KEY, world_id TEXT NOT NULL REFERENCES worlds(id) ON DELETE CASCADE, entry_id TEXT REFERENCES entries(id) ON DELETE SET NULL,
    title TEXT NOT NULL, notes TEXT DEFAULT '', due TEXT, done INTEGER DEFAULT 0, done_at TEXT, priority INTEGER DEFAULT 0, position REAL DEFAULT 0, created_at TEXT);
    CREATE INDEX tasks_world ON tasks (world_id, done);`,
}];

const isoDay = d => d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0') + '-' + String(d.getDate()).padStart(2, '0');

function handlers(ctx) {
  const { db } = ctx;
  const row = r => r && ({ id: r.id, worldId: r.world_id, entryId: r.entry_id || null, title: r.title, notes: r.notes || '', due: r.due || null, done: !!r.done, doneAt: r.done_at || null, priority: r.priority || 0, position: r.position || 0, createdAt: r.created_at });
  const get = id => row(db.get('SELECT * FROM tasks WHERE id = ?', id));

  function stats(worldId, days = 90) {
    const goal = (ctx.core && ctx.core.world(worldId).settings.wordGoal) || 500;
    const since = isoDay(new Date(Date.now() - days * 864e5));
    const rows = db.all('SELECT day, sum(words) AS words, sum(seconds) AS seconds FROM writing_log WHERE world_id = ? AND day >= ? GROUP BY day ORDER BY day', worldId, since);
    const map = new Map(rows.map(r => [r.day, r]));
    const series = [];
    for (let i = days - 1; i >= 0; i--) { const d = isoDay(new Date(Date.now() - i * 864e5)); const r = map.get(d); series.push({ day: d, words: r ? Math.max(0, r.words) : 0, seconds: r ? r.seconds : 0 }); }
    // streak: consecutive days up to today (or yesterday) with positive words
    let streak = 0;
    for (let i = series.length - 1; i >= 0; i--) {
      if (series[i].words > 0) streak++;
      else if (i === series.length - 1) continue;   // today may still be empty
      else break;
    }
    let best = 0, run = 0;
    for (const s of series) { run = s.words > 0 ? run + 1 : 0; best = Math.max(best, run); }
    const t = map.get(today());
    const top = db.all(`SELECT w.entry_id AS id, e.title, sum(w.words) AS words FROM writing_log w JOIN entries e ON e.id = w.entry_id
      WHERE w.world_id = ? AND w.day >= ? AND e.deleted_at IS NULL GROUP BY w.entry_id ORDER BY words DESC LIMIT 8`, worldId, since);
    return { goal, today: t ? Math.max(0, t.words) : 0, todaySeconds: t ? t.seconds : 0, streak, best, series, top,
      total: db.value('SELECT coalesce(sum(word_count), 0) FROM entries WHERE world_id = ? AND deleted_at IS NULL', worldId) || 0 };
  }

  return {
    'tasks.list': (worldId, o = {}) => {
      const where = ['t.world_id = ?'], vals = [worldId];
      if (o.entryId) { where.push('t.entry_id = ?'); vals.push(o.entryId); }
      if (o.done != null) where.push(o.done ? 't.done = 1' : 't.done = 0');
      if (o.dueBefore) { where.push('t.due IS NOT NULL AND t.due <= ?'); vals.push(o.dueBefore); }
      return db.all(`SELECT t.* FROM tasks t WHERE ${where.join(' AND ')} ORDER BY t.done, CASE WHEN t.due IS NULL THEN 1 ELSE 0 END, t.due, t.priority DESC, t.position, t.created_at`, ...vals).map(row);
    },
    'tasks.save': (t = {}) => {
      // an update is a patch: keys left out keep their saved value ({ id, due } only changes the due date)
      if (t.id) { const cur = get(t.id); if (cur) t = Object.assign({}, cur, Object.fromEntries(Object.entries(t).filter(([, v]) => v !== undefined))); }
      const title = String(t.title || '').trim().slice(0, 300);
      if (!title) throw new Error('A task needs a title.');
      const due = t.due && /^\d{4}-\d{2}-\d{2}$/.test(t.due) ? t.due : null;
      if (t.id) db.run('UPDATE tasks SET title = ?, notes = ?, due = ?, priority = ?, entry_id = ? WHERE id = ?', title, String(t.notes || ''), due, +t.priority || 0, t.entryId || null, t.id);
      else { t.id = uid(); db.run('INSERT INTO tasks (id, world_id, entry_id, title, notes, due, priority, position, created_at) VALUES (?,?,?,?,?,?,?,?,?)', t.id, t.worldId, t.entryId || null, title, String(t.notes || ''), due, +t.priority || 0, (db.value('SELECT max(position) FROM tasks WHERE world_id = ?', t.worldId) || 0) + 1, now()); }
      ctx.changed(['tasks'], [t.id, t.entryId]);
      return get(t.id);
    },
    'tasks.toggle': (id, done) => {
      const t = get(id); if (!t) return null;
      const v = done == null ? !t.done : !!done;
      db.run('UPDATE tasks SET done = ?, done_at = ? WHERE id = ?', v, v ? now() : null, id);
      ctx.changed(['tasks'], [id, t.entryId]);
      return get(id);
    },
    'tasks.remove': id => { const t = get(id); db.run('DELETE FROM tasks WHERE id = ?', id); ctx.changed(['tasks'], [id, t && t.entryId]); return true; },
    'tasks.reorder': ids => { db.tx(() => ids.forEach((id, i) => db.run('UPDATE tasks SET position = ? WHERE id = ?', i + 1, id))); ctx.changed(['tasks']); return true; },
    'tasks.counts': worldId => ({
      open: db.value('SELECT count(*) FROM tasks WHERE world_id = ? AND done = 0', worldId) || 0,
      overdue: db.value('SELECT count(*) FROM tasks WHERE world_id = ? AND done = 0 AND due IS NOT NULL AND due < ?', worldId, today()) || 0,
      today: db.value('SELECT count(*) FROM tasks WHERE world_id = ? AND done = 0 AND due = ?', worldId, today()) || 0,
    }),
    'writing.stats': (worldId, days) => stats(worldId, days || 90),
    'writing.addTime': (worldId, entryId, seconds) => {
      if (!(seconds > 0)) return true;
      db.run(`INSERT INTO writing_log (world_id, day, entry_id, seconds) VALUES (?,?,?,?)
        ON CONFLICT (world_id, day, entry_id) DO UPDATE SET seconds = seconds + excluded.seconds`, worldId, today(), entryId, Math.round(seconds));
      return true;
    },
    'writing.byEntries': (ids) => (ids && ids.length ? db.all(`SELECT entry_id AS id, sum(words) AS words, sum(seconds) AS seconds FROM writing_log WHERE entry_id IN (${placeholders(ids.length)}) GROUP BY entry_id`, ...ids) : []),
  };
}

module.exports = { migrations, handlers };
