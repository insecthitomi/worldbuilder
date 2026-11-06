'use strict';
/* Inbox helpers: "gaps to fill" (entries whose type marks a field as required but the field is empty) and the
   example world's voice memo. Captures themselves are entries (inbox = 1); tasks live in productivity.js. */
const F = require('../../shared/fields');
const { J } = require('../util');

/** the task a gap suggests, e.g. “Decide what Corwin Vey wants” */
function suggestion(type, def, title) {
  const k = def.key, l = def.label;
  if (k === 'goals' && type.key === 'character') return 'Decide what ' + title + ' wants';
  if (k === 'goals') return 'Write down the goals of ' + title;
  if (/fear/i.test(k)) return 'Decide what ' + title + ' fears';
  return 'Fill in “' + l + '” for ' + title;
}

function handlers(ctx) {
  const { db } = ctx;
  function gaps(worldId, o = {}) {
    const types = ctx.core.typesOf(worldId).filter(t => !t.hidden && (t.fields || []).some(d => d.required));
    if (!types.length) return { gaps: [], checked: 0, types: [] };
    const open = db.all('SELECT entry_id, title FROM tasks WHERE world_id = ? AND done = 0 AND entry_id IS NOT NULL', worldId);
    const taskFor = new Map();
    for (const t of open) { if (!taskFor.has(t.entry_id)) taskFor.set(t.entry_id, []); taskFor.get(t.entry_id).push(t.title.toLowerCase()); }
    const out = [];
    let checked = 0;
    for (const t of types) {
      const req = t.fields.filter(d => d.required);
      const rows = db.all('SELECT id, title, fields FROM entries WHERE world_id = ? AND type_id = ? AND deleted_at IS NULL AND inbox = 0 ORDER BY title COLLATE NOCASE', worldId, t.id);
      checked += rows.length;
      for (const r of rows) {
        const f = J(r.fields, {}), tasks = taskFor.get(r.id) || [];
        const missing = req.filter(d => !F.filled(d.kind, f[d.key])).map(d => ({ key: d.key, label: d.label, task: suggestion(t, d, r.title) }))
          .filter(m => !tasks.some(x => x === m.task.toLowerCase() || x.includes(m.label.toLowerCase())));
        if (missing.length) out.push({ entryId: r.id, typeId: t.id, title: r.title, missing });
      }
    }
    const lim = Math.max(1, Math.min(500, +o.limit || 200));
    return { gaps: out.slice(0, lim).map(g => Object.assign(g, { entry: ctx.core.lite(g.entryId) })), total: out.length, checked, types: types.map(t => ({ id: t.id, name: t.name, plural: t.plural, fields: t.fields.filter(d => d.required).map(d => d.label) })) };
  }
  return {
    'inbox.gaps': (worldId, o) => gaps(worldId, o),
    'inbox.counts': worldId => ({
      inbox: db.value('SELECT count(*) FROM entries WHERE world_id = ? AND inbox = 1 AND deleted_at IS NULL', worldId) || 0,
      voice: db.value("SELECT count(*) FROM entries WHERE world_id = ? AND inbox = 1 AND deleted_at IS NULL AND json_extract(fields, '$.audio') IS NOT NULL AND json_extract(fields, '$.audio') != ''", worldId) || 0,
    }),
  };
}

/** a short, soft recording (sea wash and three far bells) as a 16-bit mono WAV */
function seaWav(seconds = 4, rate = 16000) {
  const n = Math.floor(seconds * rate), buf = Buffer.alloc(44 + n * 2);
  buf.write('RIFF', 0); buf.writeUInt32LE(36 + n * 2, 4); buf.write('WAVE', 8); buf.write('fmt ', 12);
  buf.writeUInt32LE(16, 16); buf.writeUInt16LE(1, 20); buf.writeUInt16LE(1, 22); buf.writeUInt32LE(rate, 24); buf.writeUInt32LE(rate * 2, 28); buf.writeUInt16LE(2, 32); buf.writeUInt16LE(16, 34);
  buf.write('data', 36); buf.writeUInt32LE(n * 2, 40);
  let s = 12345, lp = 0, lp2 = 0;
  const rnd = () => ((s = (s * 1103515245 + 12345) >>> 0) / 4294967296) * 2 - 1;
  const bells = [[.6, 523.25], [1.7, 659.25], [2.8, 392]];
  for (let i = 0; i < n; i++) {
    const t = i / rate;
    lp += (rnd() - lp) * .06; lp2 += (lp - lp2) * .2;
    const swell = .35 + .65 * Math.pow(Math.sin(Math.PI * t / seconds * 1.5), 2);
    let v = lp2 * 1.6 * swell;
    for (const [at, f] of bells) if (t >= at) { const d = t - at; v += Math.sin(2 * Math.PI * f * d) * Math.exp(-d * 2.2) * .22 + Math.sin(2 * Math.PI * f * 2.01 * d) * Math.exp(-d * 3) * .06; }
    const fade = Math.min(1, t / .15, (seconds - t) / .3);
    buf.writeInt16LE(Math.max(-32767, Math.min(32767, Math.round(v * fade * 26000))), 44 + i * 2);
  }
  return buf;
}

function sample(ctx, S) {
  const W = S.worldId;
  let audio = null;
  try { audio = ctx.call('media.save', W, { name: 'Voice memo — the bells under the water.wav', mime: 'audio/wav', bytes: seaWav(), kind: 'audio', duration: 4, tags: ['voice memo'] }); S.set('media:memo', audio.id); } catch { }
  const e = ctx.core.createEntry({
    worldId: W, typeKey: 'note', inbox: true, title: 'Voice memo — the bells under the water',
    fields: { audio: audio ? audio.id : '', transcript: 'Chapter three idea: the bells of Tidewell ring under the water whenever someone puts on the crown. Mira hears them first. Maybe Wren can hear them too — she talks to the bells already.' },
  });
  S.set('memo', e.id);
}

module.exports = { handlers, sample, seaWav, suggestion };
