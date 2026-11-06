'use strict';
/* Lexicon import and export: delimited text (CSV / TSV / semicolons, as spreadsheets paste it), column guessing,
   and dictionary-style Markdown. Pure functions, no database. */

const FIELDS = ['word', 'ipa', 'pos', 'gloss', 'definition', 'etymology', 'root', 'tags', 'notes'];
const ALIASES = {
  word: ['word', 'words', 'lemma', 'headword', 'form', 'conword', 'term', 'spelling', 'romanization', 'romanisation', 'native', 'entry', 'lexeme', 'con'],
  ipa: ['ipa', 'pronunciation', 'pron', 'phonemic', 'phonetic', 'sound', 'sounds'],
  pos: ['pos', 'part of speech', 'partofspeech', 'class', 'word class', 'wordclass', 'category', 'type', 'lexical category'],
  gloss: ['gloss', 'meaning', 'english', 'translation', 'en', 'sense', 'glosses', 'means', 'eng'],
  definition: ['definition', 'def', 'description', 'desc', 'long definition', 'explanation'],
  etymology: ['etymology', 'origin', 'etym', 'derivation', 'derived from', 'source'],
  root: ['root', 'stem', 'base', 'root word'],
  tags: ['tags', 'tag', 'labels', 'semantic field', 'field', 'domain', 'topic'],
  notes: ['notes', 'note', 'comment', 'comments', 'usage', 'remarks'],
};

/** splits delimited text into rows of cells; quotes ("a, b" and "") work as spreadsheets write them */
function parseDelimited(text, delim) {
  const src = String(text || '').replace(/^﻿/, '');
  if (!delim) delim = detect(src);
  const rows = [];
  let row = [], cell = '', q = false;
  for (let i = 0; i < src.length; i++) {
    const c = src[i];
    if (q) {
      if (c === '"') { if (src[i + 1] === '"') { cell += '"'; i++; } else q = false; }
      else cell += c;
      continue;
    }
    if (c === '"' && cell.trim() === '') { q = true; cell = ''; continue; }
    if (c === delim) { row.push(cell); cell = ''; continue; }
    if (c === '\n' || c === '\r') {
      if (c === '\r' && src[i + 1] === '\n') i++;
      row.push(cell); rows.push(row); row = []; cell = '';
      continue;
    }
    cell += c;
  }
  if (cell !== '' || row.length) { row.push(cell); rows.push(row); }
  return { delim, rows: rows.map(r => r.map(x => x.trim())).filter(r => r.some(Boolean)) };
}
function detect(src) {
  const first = src.split(/\r?\n/).filter(l => l.trim()).slice(0, 5).join('\n');
  const n = ch => (first.match(new RegExp(ch === '|' ? '\\|' : ch, 'g')) || []).length;
  if (n('\t')) return '\t';
  const counts = [[',', n(',')], [';', n(';')], ['|', n('|')]].sort((a, b) => b[1] - a[1]);
  return counts[0][1] ? counts[0][0] : ',';
}
const key = s => String(s || '').toLowerCase().replace(/[^a-z ]+/g, ' ').replace(/\s+/g, ' ').trim();
/** guesses which column holds what: { mapping: [field|''] per column, header: bool } */
function guessColumns(rows) {
  const head = rows[0] || [];
  const mapping = head.map(h => { const k = key(h); return FIELDS.find(f => ALIASES[f].includes(k) || ALIASES[f].includes(k.replace(/ /g, ''))) || ''; });
  const hits = mapping.filter(Boolean).length;
  if (hits >= Math.min(2, head.length) && hits) return { header: true, mapping: dedupe(mapping) };
  // no header: guess from the number of columns
  const n = Math.max(...rows.slice(0, 20).map(r => r.length), 1);
  const by = { 1: ['word'], 2: ['word', 'gloss'], 3: ['word', 'pos', 'gloss'], 4: ['word', 'ipa', 'pos', 'gloss'], 5: ['word', 'ipa', 'pos', 'gloss', 'definition'] };
  const m = by[n] || ['word', 'ipa', 'pos', 'gloss', 'definition', 'etymology', 'root', 'tags', 'notes'];
  return { header: false, mapping: Array.from({ length: n }, (_, i) => m[i] || '') };
}
const dedupe = m => { const seen = new Set(); return m.map(f => (f && !seen.has(f) ? (seen.add(f), f) : '')); };
/** rows → word objects with the given mapping */
function toWords(rows, mapping, header) {
  return rows.slice(header ? 1 : 0).map(r => {
    const w = {};
    mapping.forEach((f, i) => { if (f && r[i] != null && r[i] !== '') w[f] = r[i]; });
    if (w.tags) w.tags = String(w.tags).split(/[;,|]/).map(s => s.trim().replace(/^#/, '')).filter(Boolean);
    if (w.ipa) w.ipa = String(w.ipa).replace(/^[/[]|[/\]]$/g, '');
    return w;
  }).filter(w => w.word);
}

const esc = (v, d) => { const s = String(v == null ? '' : v); return new RegExp('["\\n\\r' + (d === '\t' ? '\\t' : d) + ']').test(s) ? '"' + s.replace(/"/g, '""') + '"' : s; };
/** words → delimited text with a header row; roots by their word */
function toDelimited(words, delim = ',', rootWord = () => '') {
  const lines = [FIELDS.join(delim)];
  for (const w of words) lines.push([w.word, w.ipa, w.pos, w.gloss, w.definition, w.etymology, rootWord(w), (w.tags || []).join('; '), w.notes].map(v => esc(v, delim)).join(delim));
  return lines.join('\r\n') + '\r\n';
}
/** a readable dictionary: one entry per line, grouped by first letter */
function toMarkdown(words, title, { posName = p => p, rootWord = () => '' } = {}) {
  const out = ['# ' + (title || 'Lexicon'), '', '_' + words.length + ' words_', ''];
  let letter = null;
  const sorted = words.slice().sort((a, b) => a.word.localeCompare(b.word, undefined, { sensitivity: 'base' }));
  for (const w of sorted) {
    const L = (w.word[0] || '?').toUpperCase();
    if (L !== letter) { letter = L; out.push('', '## ' + L, ''); }
    const bits = ['**' + w.word + '**'];
    if (w.ipa) bits.push('/' + w.ipa + '/');
    if (w.pos) bits.push('_' + posName(w.pos) + '_');
    let line = bits.join(' ') + (w.gloss ? ' — ' + w.gloss : '');
    if (w.definition) line += '. ' + w.definition;
    const r = rootWord(w);
    if (w.etymology || r) line += ' (' + [r ? 'from ' + r : '', w.etymology].filter(Boolean).join('; ') + ')';
    out.push('- ' + line);
  }
  return out.join('\n') + '\n';
}

module.exports = { FIELDS, ALIASES, parseDelimited, guessColumns, toWords, toDelimited, toMarkdown };
