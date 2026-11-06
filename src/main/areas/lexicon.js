'use strict';
/* Lexicon: the words of each language (a Language entry), import/export, search both ways, statistics, phrase
   translation by gloss, and daughter languages derived by sound changes. Phonology and sound-change rules live in
   the language entry's data (data.phonology, data.soundChanges); the shared engine is src/shared/names.js. */
const fs = require('fs');
const path = require('path');
const N = require('../../shared/names');
const IO = require('../lib/lexicon-io');
const SAMPLE = require('../lib/lexicon-sample');
const { uid, now, J, placeholders, safeName } = require('../util');

const migrations = [{
  id: 'lexicon-001',
  sql: `CREATE TABLE words (id TEXT PRIMARY KEY, world_id TEXT NOT NULL REFERENCES worlds(id) ON DELETE CASCADE,
    language_id TEXT NOT NULL REFERENCES entries(id) ON DELETE CASCADE, word TEXT NOT NULL DEFAULT '', norm TEXT DEFAULT '',
    ipa TEXT DEFAULT '', pos TEXT DEFAULT '', gloss TEXT DEFAULT '', definition TEXT DEFAULT '', etymology TEXT DEFAULT '',
    root_id TEXT, source_id TEXT, entry_id TEXT REFERENCES entries(id) ON DELETE SET NULL, tags TEXT DEFAULT '[]', notes TEXT DEFAULT '',
    created_at TEXT, updated_at TEXT);
    CREATE INDEX words_lang ON words (language_id, norm);
    CREATE INDEX words_world ON words (world_id);
    CREATE INDEX words_root ON words (root_id);
    CREATE INDEX words_source ON words (source_id);`,
}];

/* parts of speech: code, name (the table shows the code, everything else the name) */
const POS = [['n', 'noun'], ['v', 'verb'], ['adj', 'adjective'], ['adv', 'adverb'], ['pron', 'pronoun'], ['prep', 'adposition'], ['conj', 'conjunction'],
  ['det', 'determiner'], ['num', 'numeral'], ['part', 'particle'], ['interj', 'interjection'], ['aff', 'affix'], ['name', 'proper name'], ['phr', 'phrase']];
const POS_ALIASES = { noun: 'n', verb: 'v', adjective: 'adj', adverb: 'adv', pronoun: 'pron', preposition: 'prep', postposition: 'prep', adposition: 'prep', conjunction: 'conj', determiner: 'det', article: 'det', numeral: 'num', number: 'num', particle: 'part', interjection: 'interj', affix: 'aff', prefix: 'aff', suffix: 'aff', 'proper noun': 'name', 'proper name': 'name', name: 'name', phrase: 'phr', idiom: 'phr', expression: 'phr', 'n.': 'n', 'v.': 'v', 'adj.': 'adj', 'adv.': 'adv', a: 'adj', vt: 'v', vi: 'v' };
const cleanPos = p => { const s = String(p || '').trim(); const k = s.toLowerCase(); return POS_ALIASES[k] || (POS.find(x => x[0] === k) ? k : s.slice(0, 24)); };
const posName = p => (POS.find(x => x[0] === p) || [p, p])[1];
const STOP = new Set(['the', 'a', 'an']);

function handlers(ctx) {
  const { db } = ctx;
  const row = r => r && ({
    id: r.id, worldId: r.world_id, languageId: r.language_id, word: r.word, ipa: r.ipa || '', pos: r.pos || '', gloss: r.gloss || '',
    definition: r.definition || '', etymology: r.etymology || '', rootId: r.root_id || null, sourceId: r.source_id || null, entryId: r.entry_id || null,
    tags: J(r.tags, []), notes: r.notes || '', createdAt: r.created_at, updatedAt: r.updated_at,
  });
  const get = id => row(db.get('SELECT * FROM words WHERE id = ?', id));
  const langRow = id => {
    const r = db.get('SELECT id, world_id, title, data, deleted_at FROM entries WHERE id = ?', id);
    if (!r) throw new Error('That language no longer exists.');
    return { id: r.id, worldId: r.world_id, title: r.title, data: J(r.data, {}), deletedAt: r.deleted_at };
  };
  const str = (v, n = 4000) => String(v == null ? '' : v).trim().slice(0, n);
  const tagList = v => [...new Set((Array.isArray(v) ? v : String(v || '').split(/[;,]/)).map(s => String(s).trim().replace(/^#/, '')).filter(Boolean))].slice(0, 30);

  /* ---------------- words ---------------- */
  function insert(languageId, w, worldId) {
    const word = str(w.word, 300);
    if (!word) throw new Error('A word needs a spelling.');
    const id = w.id && /^[a-z0-9]{10}$/.test(w.id) && !db.get('SELECT 1 FROM words WHERE id = ?', w.id) ? w.id : uid(), t = now();
    db.run(`INSERT INTO words (id, world_id, language_id, word, norm, ipa, pos, gloss, definition, etymology, root_id, source_id, entry_id, tags, notes, created_at, updated_at)
      VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`, id, worldId, languageId, word, N.norm(word), str(w.ipa, 300).replace(/^[/[]|[/\]]$/g, ''), cleanPos(w.pos),
      str(w.gloss, 500), str(w.definition), str(w.etymology, 1000), w.rootId || null, w.sourceId || null, w.entryId || null, tagList(w.tags), str(w.notes), w.createdAt || t, t);
    return id;
  }
  function add(languageId, w = {}) {
    const L = langRow(languageId);
    const id = db.tx(() => insert(languageId, w, L.worldId));
    ctx.changed(['words'], [id, languageId]);
    return get(id);
  }
  function addMany(languageId, list = []) {
    const L = langRow(languageId);
    const ids = db.tx(() => list.filter(w => w && str(w.word)).map(w => insert(languageId, w, L.worldId)));
    ctx.changed(['words'], ids.concat(languageId));
    return ids.map(get);
  }
  function update(id, p = {}) {
    const old = db.get('SELECT * FROM words WHERE id = ?', id);
    if (!old) throw new Error('That word no longer exists.');
    const sets = [], vals = [];
    const put = (c, v) => { sets.push(c + ' = ?'); vals.push(v); };
    if (p.word != null) { const w = str(p.word, 300); if (!w) throw new Error('A word needs a spelling.'); put('word', w); put('norm', N.norm(w)); }
    if (p.ipa != null) put('ipa', str(p.ipa, 300).replace(/^[/[]|[/\]]$/g, ''));
    if (p.pos != null) put('pos', cleanPos(p.pos));
    for (const k of ['gloss', 'definition', 'etymology', 'notes']) if (p[k] != null) put(k, str(p[k], k === 'gloss' ? 500 : 4000));
    if (p.tags) put('tags', tagList(p.tags));
    if (p.rootId !== undefined) {
      if (p.rootId === id) throw new Error('A word can\'t be its own root.');
      // no loops: walking up from the new root must never reach this word
      let r = p.rootId, guard = 0;
      while (r && guard++ < 200) { if (r === id) throw new Error('That would make the roots go round in a circle.'); const x = db.get('SELECT root_id FROM words WHERE id = ?', r); r = x && x.root_id; }
      put('root_id', p.rootId || null);
    }
    if (p.entryId !== undefined) put('entry_id', p.entryId || null);
    if (!sets.length) return row(old);
    put('updated_at', now());
    db.run(`UPDATE words SET ${sets.join(', ')} WHERE id = ?`, ...vals, id);
    ctx.changed(['words'], [id, old.language_id]);
    return get(id);
  }
  /** deletes words; returns what Undo needs */
  function remove(ids) {
    ids = [].concat(ids || []).filter(Boolean);
    if (!ids.length) return { rows: [], refs: [] };
    const rows = db.all(`SELECT * FROM words WHERE id IN (${placeholders(ids.length)})`, ...ids);
    const refs = db.all(`SELECT id, root_id FROM words WHERE root_id IN (${placeholders(ids.length)}) AND id NOT IN (${placeholders(ids.length)})`, ...ids, ...ids);
    db.tx(() => {
      db.run(`UPDATE words SET root_id = NULL WHERE root_id IN (${placeholders(ids.length)})`, ...ids);
      db.run(`DELETE FROM words WHERE id IN (${placeholders(ids.length)})`, ...ids);
    });
    ctx.changed(['words'], ids.concat(rows.map(r => r.language_id)));
    return { rows, refs };
  }
  function restore(payload = {}) {
    const rows = payload.rows || [], known = new Set(db.columns('words'));
    db.tx(() => {
      for (const r of rows) {
        if (!r || !r.id || db.get('SELECT 1 FROM words WHERE id = ?', r.id) || !db.get('SELECT 1 FROM entries WHERE id = ?', r.language_id)) continue;
        const cols = Object.keys(r).filter(c => known.has(c));
        db.run(`INSERT INTO words (${cols.join(',')}) VALUES (${placeholders(cols.length)})`, ...cols.map(c => r[c]));
      }
      for (const x of payload.refs || []) db.run('UPDATE words SET root_id = ? WHERE id = ?', x.root_id, x.id);
    });
    ctx.changed(['words'], rows.map(r => r.id));
    return rows.length;
  }
  function listWords(languageId, o = {}) {
    const where = ['language_id = ?'], vals = [languageId];
    const q = str(o.q, 200);
    if (q) {
      const like = '%' + q.replace(/[%_]/g, m => '\\' + m) + '%', nl = '%' + N.norm(q).replace(/[%_]/g, m => '\\' + m) + '%';
      if (o.scope === 'word') { where.push("(norm LIKE ? ESCAPE '\\' OR ipa LIKE ? ESCAPE '\\')"); vals.push(nl, like); }
      else if (o.scope === 'gloss') { where.push("(gloss LIKE ? ESCAPE '\\' OR definition LIKE ? ESCAPE '\\')"); vals.push(like, like); }
      else { where.push("(norm LIKE ? ESCAPE '\\' OR ipa LIKE ? ESCAPE '\\' OR gloss LIKE ? ESCAPE '\\' OR definition LIKE ? ESCAPE '\\' OR etymology LIKE ? ESCAPE '\\' OR tags LIKE ? ESCAPE '\\')"); vals.push(nl, like, like, like, like, like); }
    }
    if (o.pos) { where.push('pos = ?'); vals.push(o.pos); }
    if (o.ids) { if (!o.ids.length) return []; where.push(`id IN (${placeholders(o.ids.length)})`); vals.push(...o.ids); }
    const sort = { word: 'norm, word', gloss: 'gloss COLLATE NOCASE, norm', pos: 'pos, norm', created: 'created_at DESC', updated: 'updated_at DESC' }[o.sort] || 'norm, word';
    const lim = o.limit ? ` LIMIT ${Math.max(1, Math.min(100000, +o.limit))}` + (o.offset ? ` OFFSET ${Math.max(0, +o.offset)}` : '') : '';
    return db.all(`SELECT * FROM words WHERE ${where.join(' AND ')} ORDER BY ${sort}${lim}`, ...vals).map(row);
  }

  /* ---------------- languages ---------------- */
  function languages(worldId) {
    const t = ctx.core.typeByKey(worldId, 'language');
    const ids = new Set(db.all('SELECT DISTINCT language_id AS id FROM words WHERE world_id = ?', worldId).map(r => r.id));
    if (t) for (const r of db.all('SELECT id FROM entries WHERE world_id = ? AND type_id = ? AND deleted_at IS NULL', worldId, t.id)) ids.add(r.id);
    if (!ids.size) return [];
    const counts = new Map(db.all('SELECT language_id AS id, count(*) AS n FROM words WHERE world_id = ? GROUP BY language_id', worldId).map(r => [r.id, r.n]));
    const data = new Map(db.all(`SELECT id, data FROM entries WHERE id IN (${placeholders(ids.size)})`, ...ids).map(r => [r.id, J(r.data, {})]));
    return ctx.core.listEntries(worldId, { ids: [...ids], sort: 'title' }).map(e => {
      const d = data.get(e.id) || {}, p = d.phonology || {};
      const branches = (d.soundChanges && d.soundChanges.branches) || [];
      return Object.assign(e, {
        wordCount: counts.get(e.id) || 0, parentLanguageId: d.parent || null,
        consonants: (p.consonants || []).length, vowels: (p.vowels || []).length, branches: branches.length,
      });
    });
  }
  function createLanguage({ worldId, title, phonology, parent, summary, fields } = {}) {
    const t = ctx.core.typeByKey(worldId, 'language');
    if (!t) throw new Error('This world has no Language type.');
    const data = { phonology: N.normPhon(phonology || N.PRESETS.simple) };
    if (parent) data.parent = parent;
    return ctx.core.createEntry({ worldId, typeId: t.id, title: str(title, 200) || 'New language', summary: summary || '', data, fields: fields || {} });
  }

  /* ---------------- import / export ---------------- */
  function previewImport(text) {
    const { rows, delim } = IO.parseDelimited(text);
    const g = IO.guessColumns(rows);
    return { delim, header: g.header, mapping: g.mapping, rows: rows.slice(0, 14), total: Math.max(0, rows.length - (g.header ? 1 : 0)), columns: g.mapping.length, fields: IO.FIELDS };
  }
  function importText(languageId, text, o = {}) {
    const L = langRow(languageId);
    const { rows } = IO.parseDelimited(text, o.delim);
    const g = IO.guessColumns(rows);
    const mapping = o.mapping || g.mapping, header = o.header != null ? o.header : g.header;
    const list = IO.toWords(rows, mapping, header);
    const mode = o.mode || 'skip';
    const existing = db.all('SELECT id, norm, gloss FROM words WHERE language_id = ?', languageId);
    const pair = new Set(existing.map(r => r.norm + '|' + N.norm(r.gloss)));
    const byWord = new Map();
    for (const r of existing) if (!byWord.has(r.norm)) byWord.set(r.norm, r.id);
    let added = 0, updated = 0, skipped = 0;
    const touched = [];
    const roots = [];
    db.tx(() => {
      for (const w of list) {
        const k = N.norm(w.word);
        if (mode === 'update' && byWord.has(k)) {
          const id = byWord.get(k), patch = {};
          for (const f of ['ipa', 'pos', 'gloss', 'definition', 'etymology', 'notes', 'tags']) if (w[f] != null && w[f] !== '') patch[f] = w[f];
          if (Object.keys(patch).length) { update(id, patch); updated++; touched.push(id); } else skipped++;
          if (w.root) roots.push([id, w.root]);
          continue;
        }
        if (mode !== 'all' && pair.has(k + '|' + N.norm(w.gloss))) { skipped++; continue; }
        const id = insert(languageId, w, L.worldId);
        pair.add(k + '|' + N.norm(w.gloss)); if (!byWord.has(k)) byWord.set(k, id);
        added++; touched.push(id);
        if (w.root) roots.push([id, w.root]);
      }
      for (const [id, root] of roots) { const r = byWord.get(N.norm(root)); if (r && r !== id) db.run('UPDATE words SET root_id = ? WHERE id = ?', r, id); }
    });
    ctx.changed(['words'], touched.concat(languageId));
    return { added, updated, skipped, total: list.length };
  }
  function exportText(languageId, format = 'csv') {
    const L = langRow(languageId);
    const words = listWords(languageId, {});
    const byId = new Map(words.map(w => [w.id, w]));
    const rootWord = w => (w.rootId && byId.get(w.rootId) ? byId.get(w.rootId).word : '');
    let text, ext = format;
    if (format === 'tsv') text = IO.toDelimited(words, '\t', rootWord);
    else if (format === 'md') text = IO.toMarkdown(words, L.title, { posName, rootWord });
    else if (format === 'json') text = JSON.stringify({ language: L.title, phonology: L.data.phonology || null, words: words.map(w => ({ word: w.word, ipa: w.ipa, pos: w.pos, gloss: w.gloss, definition: w.definition, etymology: w.etymology, root: rootWord(w), tags: w.tags, notes: w.notes })) }, null, 2);
    else { text = IO.toDelimited(words, ',', rootWord); ext = 'csv'; }
    return { text, name: safeName(L.title || 'lexicon') + '.' + ext, count: words.length };
  }

  /* ---------------- search, stats ---------------- */
  function searchWorld(worldId, q, o = {}) {
    q = str(q, 200);
    if (!q) return [];
    const like = '%' + q + '%', nl = '%' + N.norm(q) + '%', exact = N.norm(q);
    const rows = db.all(`SELECT w.*, e.title AS lang_title FROM words w JOIN entries e ON e.id = w.language_id
      WHERE w.world_id = ? AND e.deleted_at IS NULL AND (w.norm LIKE ? OR w.gloss LIKE ? OR w.ipa LIKE ?) ${o.languageId ? 'AND w.language_id = ?' : ''} LIMIT 400`,
    worldId, nl, like, like, ...(o.languageId ? [o.languageId] : []));
    const score = r => {
      const terms = glossTerms(r.gloss);
      return (r.norm === exact ? 0 : terms.includes(exact) ? 1 : r.norm.startsWith(exact) ? 2 : terms.some(t => t.startsWith(exact)) ? 3 : 4) * 1000 + r.norm.length;
    };
    return rows.sort((a, b) => score(a) - score(b)).slice(0, o.limit || 40).map(r => Object.assign(row(r), { languageTitle: r.lang_title, matched: N.norm(r.word).includes(exact) ? 'word' : 'gloss' }));
  }
  function stats(languageId) {
    const L = langRow(languageId);
    const words = listWords(languageId, {});
    const byPos = {}, initials = {}, sounds = {}, homo = new Map(), glossMap = new Map();
    const inv = ((L.data.phonology || {}).consonants || []).concat((L.data.phonology || {}).vowels || []);
    let len = 0;
    for (const w of words) {
      byPos[w.pos || ''] = (byPos[w.pos || ''] || 0) + 1;
      const k = N.norm(w.word);
      len += k.length;
      const i = k[0]; if (i) initials[i] = (initials[i] || 0) + 1;
      if (!homo.has(k)) homo.set(k, []); homo.get(k).push(w.id);
      for (const g of glossTerms(w.gloss).slice(0, 1)) { if (!glossMap.has(g)) glossMap.set(g, []); glossMap.get(g).push(w.id); }
      for (const s of N.segments(w.ipa || w.word, inv)) if (!/\s/.test(s)) sounds[s] = (sounds[s] || 0) + 1;
    }
    const roots = new Set(words.filter(w => w.rootId).map(w => w.rootId));
    return {
      total: words.length, byPos, withIpa: words.filter(w => w.ipa).length, noGloss: words.filter(w => !w.gloss).length,
      roots: roots.size, derived: words.filter(w => w.rootId).length, avgLength: words.length ? Math.round(len / words.length * 10) / 10 : 0,
      homographs: [...homo.entries()].filter(([, ids]) => ids.length > 1).map(([word, ids]) => ({ word, ids })),
      synonyms: [...glossMap.entries()].filter(([, ids]) => ids.length > 1).map(([gloss, ids]) => ({ gloss, ids })),
      initials: Object.entries(initials).sort((a, b) => b[1] - a[1]).map(([ch, n]) => ({ ch, n })),
      sounds: Object.entries(sounds).sort((a, b) => b[1] - a[1]).map(([s, n]) => ({ s, n })),
    };
  }

  /* ---------------- translation (by gloss) ---------------- */
  /** a gloss as lookup terms: "to rise, to flood (of water)" → ['rise', 'flood'] */
  function glossTerms(g) {
    return String(g || '').toLowerCase().replace(/\([^)]*\)/g, ' ').split(/[,;/]|\bor\b/).map(s => s.replace(/[^\p{L}\p{N}' -]+/gu, ' ').replace(/\s+/g, ' ').trim())
      .map(s => s.replace(/^(to|the|a|an) /, '')).filter(Boolean);
  }
  const stems = t => {
    const out = [t];
    const add = s => { if (s && s.length > 1 && !out.includes(s)) out.push(s); };
    if (/ies$/.test(t)) add(t.slice(0, -3) + 'y');
    if (/ied$/.test(t)) add(t.slice(0, -3) + 'y');
    if (/'s$/.test(t)) add(t.slice(0, -2));
    if (/(s|x|z|ch|sh)es$/.test(t)) add(t.slice(0, -2));
    if (/s$/.test(t) && !/ss$/.test(t)) add(t.slice(0, -1));
    if (/ing$/.test(t)) { add(t.slice(0, -3)); add(t.slice(0, -3) + 'e'); if (/(.)\1ing$/.test(t)) add(t.slice(0, -4)); }
    if (/ed$/.test(t)) { add(t.slice(0, -2)); add(t.slice(0, -1)); if (/(.)\1ed$/.test(t)) add(t.slice(0, -3)); }
    if (/er$/.test(t)) add(t.slice(0, -2));
    if (/ly$/.test(t)) add(t.slice(0, -2));
    const irregular = { went: 'go', gone: 'go', saw: 'see', seen: 'see', heard: 'hear', sang: 'sing', sung: 'sing', died: 'die', dead: 'die', sank: 'sink', sunk: 'sink', rose: 'rise', risen: 'rise', came: 'come', men: 'man', women: 'woman', children: 'child', is: 'be', are: 'be', was: 'be', were: 'be', my: 'i', me: 'i', our: 'we', us: 'we', your: 'you' };
    if (irregular[t]) add(irregular[t]);
    return out;
  };
  function translate(languageId, text, o = {}) {
    const words = listWords(languageId, {});
    const dir = o.dir === 'from' ? 'from' : 'to';
    const tokens = [];
    const parts = String(text || '').split(/([\p{L}\p{N}'’ˈˌː]+(?:[-][\p{L}\p{N}'’]+)*)/u);
    const seq = [];
    parts.forEach((p, i) => { if (!p) return; if (i % 2) seq.push({ t: 'word', src: p, key: dir === 'from' ? N.norm(p) : p.toLowerCase().replace(/’/g, '\'') }); else seq.push({ t: 'gap', src: p }); });
    // lookup tables
    const index = new Map();
    const put = (k, w, rank) => { if (!k) return; if (!index.has(k)) index.set(k, []); index.get(k).push([w, rank]); };
    if (dir === 'to') for (const w of words) glossTerms(w.gloss).forEach((t, i) => { put(t, w, i); const full = String(w.gloss || '').toLowerCase().trim(); if (full && full !== t) put(full, w, i + .5); });
    else for (const w of words) put(N.norm(w.word), w, 0);
    const maxN = 4;
    for (let i = 0; i < seq.length; i++) {
      const tok = seq[i];
      if (tok.t !== 'word') { tokens.push(tok); continue; }
      // the longest run of words (joined by plain spaces) that is one entry: "drowned king", "skolen rath"
      let done = false;
      for (let n = maxN; n > 1 && !done; n--) {
        const run = [];
        for (let j = i; j < seq.length && run.length < n; j++) {
          if (seq[j].t === 'word') run.push(j);
          else if (!/^[ \t]+$/.test(seq[j].src)) break;
        }
        if (run.length < n) continue;
        const key = run.map(j => seq[j].key).join(' ');
        const hit = index.get(key) || (dir === 'to' ? index.get(key.replace(/^(the|a|an) /, '')) : null);
        if (hit) {
          const last = run[run.length - 1];
          tokens.push({ t: 'word', src: seq.slice(i, last + 1).map(x => x.src).join(''), key, matches: rank(hit) });
          i = last; done = true;
        }
      }
      if (done) continue;
      let hit = null;
      for (const s of dir === 'to' ? stems(tok.key) : [tok.key]) { hit = index.get(s); if (hit) break; }
      if (hit) tokens.push(Object.assign({}, tok, { matches: rank(hit) }));
      else if (dir === 'to' && STOP.has(tok.key)) tokens.push(Object.assign({}, tok, { matches: [], omitted: true }));
      else tokens.push(Object.assign({}, tok, { matches: [], unknown: true }));
    }
    const out = tokens.map(t => (t.t === 'gap' ? t.src : t.omitted ? '' : t.matches.length ? (dir === 'to' ? t.matches[0].word : (glossTerms(t.matches[0].gloss)[0] || t.matches[0].gloss)) : t.src))
      .join('').replace(/[ \t]{2,}/g, ' ').replace(/^ +/, '');
    return { dir, tokens, out, unknown: [...new Set(tokens.filter(t => t.unknown).map(t => t.key))] };
  }
  const rank = hit => hit.slice().sort((a, b) => a[1] - b[1]).map(x => x[0]).filter((w, i, a) => a.findIndex(y => y.id === w.id) === i);

  /* ---------------- sound changes → a daughter language ---------------- */
  function preview(languageId, set, o = {}) {
    const L = langRow(languageId);
    const p = N.normPhon(L.data.phonology || {});
    const C = N.compileChanges(set || {}, { inventory: p.consonants.concat(p.vowels), defaults: { V: p.vowels, C: p.consonants } });
    const sp = N.spelling(p);
    const words = listWords(languageId, {});
    return {
      errors: C.rules.filter(r => r.error).map(r => ({ idx: r.idx, message: r.error })),
      words: words.map(w => {
        const src = (w.ipa || N.deromanize(w.word, sp)).replace(/[ˈˌ.]/g, '');
        const r = N.applyChanges(src, C, { trace: !!o.trace });
        let out = N.romanize(r.out, sp);
        if (/^\p{Lu}/u.test(w.word)) out = N.cap(out);
        return { id: w.id, word: w.word, ipa: src, outIpa: r.out, out, changed: r.out !== src, steps: r.steps };
      }),
    };
  }
  function derive(sourceId, o = {}) {
    const src = ctx.core.full(sourceId);
    const sc = Object.assign({ branches: [] }, src.data.soundChanges || {});
    const branch = (sc.branches || []).find(b => b.id === o.branchId) || null;
    const set = { categories: o.categories || (branch && branch.categories) || {}, rules: o.rules || (branch && branch.rules) || [] };
    const pv = preview(sourceId, set);
    if (pv.errors.length && pv.errors.length === set.rules.length && set.rules.length) throw new Error('None of the rules can be read yet: ' + pv.errors[0].message);
    const p = N.normPhon(src.data.phonology || {});
    // the daughter's sounds: the parent's order first, then anything new
    const seen = new Set();
    for (const w of pv.words) for (const s of N.segments(w.outIpa, p.consonants.concat(p.vowels))) if (!/\s/.test(s)) seen.add(s);
    const keep = arr => arr.filter(s => seen.has(s));
    const extra = [...seen].filter(s => !p.consonants.includes(s) && !p.vowels.includes(s));
    const phon = Object.assign({}, p, { consonants: keep(p.consonants).concat(extra.filter(s => !N.isVowel(s))), vowels: keep(p.vowels).concat(extra.filter(N.isVowel)) });
    let daughter = o.daughterId || (branch && branch.daughterId) || null;
    if (daughter) { const d = db.get('SELECT id, deleted_at FROM entries WHERE id = ?', daughter); if (!d || d.deleted_at) daughter = null; }
    const history = { from: sourceId, branch: branch ? branch.id : null, rules: set.rules, categories: set.categories, at: now() };
    let created = false;
    if (!daughter) {
      const d = createLanguage({ worldId: src.worldId, title: o.name || (branch && branch.name) || ('Daughter of ' + src.title), phonology: phon, parent: sourceId,
        summary: 'Descended from ' + src.title + ' through ' + set.rules.filter(r => !r.off).length + ' sound changes.', fields: src.fields && src.fields.family ? { family: src.fields.family } : {} });
      daughter = d.id; created = true;
      ctx.core.updateEntry(daughter, { dataPatch: { derivedFrom: history } });
    } else ctx.core.updateEntry(daughter, { dataPatch: { parent: sourceId, derivedFrom: history, phonology: Object.assign({}, J(db.get('SELECT data FROM entries WHERE id = ?', daughter).data, {}).phonology || {}, { consonants: phon.consonants, vowels: phon.vowels }) } });
    const D = langRow(daughter);
    const mine = new Map(db.all('SELECT * FROM words WHERE language_id = ? AND source_id IS NOT NULL', daughter).map(r => [r.source_id, r]));
    const srcWords = new Map(listWords(sourceId, {}).map(w => [w.id, w]));
    let added = 0, updated = 0, same = 0;
    db.tx(() => {
      for (const w of pv.words) {
        const s = srcWords.get(w.id), ety = 'From ' + src.title + ' ' + s.word;
        const have = mine.get(w.id);
        if (have) {
          if (have.word === w.out && have.ipa === w.outIpa) { same++; continue; }
          db.run('UPDATE words SET word = ?, norm = ?, ipa = ?, etymology = CASE WHEN etymology = \'\' OR etymology LIKE \'From %\' THEN ? ELSE etymology END, updated_at = ? WHERE id = ?',
            w.out, N.norm(w.out), w.outIpa, ety, now(), have.id);
          updated++;
        } else {
          const id = insert(daughter, { word: w.out, ipa: w.outIpa, pos: s.pos, gloss: s.gloss, definition: s.definition, etymology: ety, tags: s.tags, sourceId: s.id, entryId: s.entryId }, D.worldId);
          mine.set(w.id, { id });
          added++;
        }
      }
      // roots follow their parents' roots
      for (const s of srcWords.values()) {
        if (!s.rootId) continue;
        const a = mine.get(s.id), b = mine.get(s.rootId);
        if (a && b) db.run('UPDATE words SET root_id = ? WHERE id = ? AND root_id IS NULL', b.id, a.id);
      }
    });
    if (branch && branch.daughterId !== daughter) {
      branch.daughterId = daughter;
      ctx.core.updateEntry(sourceId, { dataPatch: { soundChanges: sc } });
    }
    ctx.changed(['words', 'entries'], [daughter, sourceId]);
    return { daughter: ctx.core.lite(daughter), created, added, updated, unchanged: same };
  }

  ctx.lexicon = { glossTerms, translate, preview, derive, POS };

  return {
    'lexicon.pos': () => POS.map(([code, name]) => ({ code, name })),
    'lexicon.languages': worldId => languages(worldId),
    'lexicon.createLanguage': o => createLanguage(o),
    'lexicon.words': (languageId, o) => listWords(languageId, o || {}),
    'lexicon.word': id => {
      const w = get(id);
      if (!w) throw new Error('That word no longer exists.');
      return Object.assign(w, {
        root: w.rootId ? get(w.rootId) : null,
        derived: db.all('SELECT * FROM words WHERE root_id = ? ORDER BY norm', id).map(row),
        source: w.sourceId ? (r => r && Object.assign(row(r), { languageTitle: r.lang_title }))(db.get('SELECT w.*, e.title AS lang_title FROM words w JOIN entries e ON e.id = w.language_id WHERE w.id = ?', w.sourceId)) : null,
        descendants: db.all('SELECT w.*, e.title AS lang_title FROM words w JOIN entries e ON e.id = w.language_id WHERE w.source_id = ? AND e.deleted_at IS NULL', id).map(r => Object.assign(row(r), { languageTitle: r.lang_title })),
      });
    },
    'lexicon.add': (languageId, w) => add(languageId, w),
    'lexicon.addMany': (languageId, list) => addMany(languageId, list),
    'lexicon.update': (id, p) => update(id, p),
    'lexicon.updateMany': (ids, p) => { const out = db.tx(() => (ids || []).map(id => update(id, p))); return out; },
    'lexicon.remove': ids => remove(ids),
    'lexicon.restore': payload => restore(payload),
    'lexicon.previewImport': text => previewImport(text),
    'lexicon.import': (languageId, text, o) => importText(languageId, text, o),
    'lexicon.export': (languageId, format) => exportText(languageId, format),
    'lexicon.exportFile': async (languageId, format) => {
      const x = exportText(languageId, format);
      if (!ctx.dialog) throw new Error('Saving files needs the desktop app.');
      const r = await ctx.dialog.showSaveDialog(ctx.win(), { defaultPath: x.name, filters: [{ name: { csv: 'CSV', tsv: 'Tab-separated', md: 'Markdown', json: 'JSON' }[format] || 'Text', extensions: [path.extname(x.name).slice(1)] }] });
      if (r.canceled || !r.filePath) return null;
      fs.writeFileSync(r.filePath, (format === 'csv' || format === 'tsv' ? '﻿' : '') + x.text, 'utf8');
      return { path: r.filePath, count: x.count };
    },
    'lexicon.openFile': async () => {
      if (!ctx.dialog) throw new Error('Opening files needs the desktop app.');
      const r = await ctx.dialog.showOpenDialog(ctx.win(), { properties: ['openFile'], filters: [{ name: 'Word lists', extensions: ['csv', 'tsv', 'txt', 'tab'] }, { name: 'All files', extensions: ['*'] }] });
      if (r.canceled || !r.filePaths[0]) return null;
      const st = fs.statSync(r.filePaths[0]);
      if (st.size > 20 * 1024 * 1024) throw new Error('That file is larger than 20 MB.');
      return { name: path.basename(r.filePaths[0]), text: fs.readFileSync(r.filePaths[0], 'utf8') };
    },
    'lexicon.search': (worldId, q, o) => searchWorld(worldId, q, o || {}),
    'lexicon.stats': languageId => stats(languageId),
    'lexicon.translate': (languageId, text, o) => translate(languageId, text, o || {}),
    'lexicon.preview': (languageId, set, o) => preview(languageId, set, o || {}),
    'lexicon.derive': (sourceId, o) => derive(sourceId, o || {}),
    'lexicon.glossTerms': g => glossTerms(g),
  };
}

/* the example world's Saltspeak */
function sample(ctx, S) {
  const C = ctx.core;
  let id = S.e('saltspeak');
  if (!id) {
    const t = C.typeByKey(S.worldId, 'language');
    if (!t) return;
    id = C.createEntry({ worldId: S.worldId, typeId: t.id, title: 'Saltspeak', summary: 'The salt-hissing tongue of the march coast, full of tides, gulls and drowned things.',
      fields: { family: 'Coastal', status: 'Living', script: 'Tide-runes', features: 'No articles. Possession with “o” (rath o sael, king of the sea). Verbs take -la for motion and -len for doing.' } }).id;
    S.set('saltspeak', id);
  }
  const e = C.full(id);
  const fill = {};
  if (!e.fields.family) fill.family = 'Coastal';
  if (!e.fields.status) fill.status = 'Living';
  if (!e.fields.script) fill.script = 'Tide-runes';
  C.updateEntry(id, { dataPatch: { phonology: SAMPLE.PHONOLOGY, soundChanges: SAMPLE.CHANGES, phrases: SAMPLE.PHRASES, script: SAMPLE.SCRIPT }, fieldsPatch: Object.keys(fill).length ? fill : undefined });
  const sp = N.spelling(SAMPLE.PHONOLOGY);
  const spell = (ipa, pos) => { const w = N.romanize(ipa, sp); return pos === 'name' ? N.cap(w) : w; };
  const list = SAMPLE.WORDS.map(w => ({ word: spell(w.ipa, w.pos), ipa: w.ipa, pos: w.pos, gloss: w.gloss, definition: w.definition, etymology: w.etymology, tags: w.tags, entryId: w.place ? S.e(w.place) : null }));
  const saved = ctx.call('lexicon.addMany', id, list);
  const byIpa = new Map(SAMPLE.WORDS.map((w, i) => [w.ipa, saved[i] && saved[i].id]));
  ctx.db.tx(() => SAMPLE.WORDS.forEach((w, i) => { const r = w.root && byIpa.get(w.root); if (r && saved[i]) ctx.db.run('UPDATE words SET root_id = ? WHERE id = ?', r, saved[i].id); }));
}

module.exports = { migrations, handlers, sample, POS };
