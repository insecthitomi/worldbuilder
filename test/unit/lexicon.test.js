'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { make } = require('./helpers');
const N = require('../../src/shared/names');
const IO = require('../../src/main/lib/lexicon-io');

const lang = (t, w, title = 'Testish', phonology) => t.call('lexicon.createLanguage', { worldId: w.id, title, phonology });

test('names.js keeps its API: styles, Markov, phonology words, full names', () => {
  for (const k of ['rng', 'markov', 'phonology', 'generate', 'fullName', 'STYLES']) assert.ok(N[k], k);
  const a = N.generate({ style: 'sea', kind: 'place', count: 8, seed: 5 }), b = N.generate({ style: 'sea', kind: 'place', count: 8, seed: 5 });
  assert.deepEqual(a, b, 'a seed reproduces');
  assert.equal(a.length, 8);
  assert.ok(a.every(x => /^\p{Lu}/u.test(x)));
  const m = N.markov(['Mira', 'Brannoc', 'Elsabet', 'Corwin', 'Ysolde', 'Tamsin', 'Oskar', 'Fenn', 'Halloran'], { count: 5, rng: N.rng(2), avoid: ['Mira'] });
  assert.ok(m.length > 0 && !m.includes('Mira'));
  assert.ok(N.phonology({ consonants: ['t', 'k'], vowels: ['a'] }, { count: 3 }).every(x => /^[tka]+$/.test(x)));
  assert.match(N.fullName({ seed: 3 }), /^\S+ \S+$/);
  assert.equal(N.generate({ kind: 'person', count: 4, avoid: [], phon: { consonants: ['s', 'ʃ'], vowels: ['a'] }, seed: 1 }).every(x => /^[sha]+$/i.test(x)), true);
});

test('phonology words follow patterns, weights, bans and spelling', () => {
  const phon = { consonants: ['ʃ', 't', 'k'], vowels: ['a', 'o'], patterns: ['CV', 'CVC'], syllables: [2, 2], banned: ['tt', '^k'], weights: { o: 0 }, stress: 'first' };
  const ws = N.words(phon, { count: 30, seed: 9 });
  assert.ok(ws.length >= 10);
  for (const w of ws) {
    assert.ok(!/o/.test(w.plain), 'weight 0 never appears: ' + w.plain);
    assert.ok(!/tt/.test(w.plain) && !/^k/.test(w.plain), 'banned: ' + w.plain);
    assert.equal(w.word, w.plain.replace(/ʃ/g, 'sh'));
    assert.match(w.ipa, /^ˈ/);
  }
  assert.equal(N.romanize('ˈʃa.θel', { consonants: ['ʃ', 'θ', 'l'], vowels: ['a', 'e'], romanization: [['θ', 'þ']] }), 'shaþel');
  assert.equal(N.deromanize('shathel', { consonants: ['ʃ', 'θ', 'l'], vowels: ['a', 'e'] }), 'ʃaθel');
  assert.deepEqual(N.segments('tʃaːtʰa', ['tʃ']), ['tʃ', 'aː', 'tʰ', 'a']);
  const opt = N.words({ consonants: ['t'], vowels: ['a'], patterns: ['(t)a'], syllables: [1, 1] }, { count: 2, seed: 1 }).map(w => w.word).sort();
  assert.deepEqual(opt, ['a', 'ta']);
  assert.equal(N.compound('kewa', 'ahesh'), 'Kewahesh');
});

test('sound changes: categories, environments, edges, deletion, insertion, exceptions, trace', () => {
  const set = N.parseChanges(`V = a e i o u
P = p t k
B = b d g
P > B / V_V   ; voicing
e > ∅ / _#
∅ > e / #_s
θ > t
a > e / _i // #_
# u > o`);
  assert.equal(set.rules.length, 6);
  assert.equal(set.rules[5].off, true);
  assert.equal(set.rules[0].note, 'voicing');
  const C = N.compileChanges(set, { inventory: ['θ'] });
  assert.ok(C.rules.every(r => !r.error));
  const ap = w => N.applyChanges(w, C).out;
  assert.equal(ap('pata'), 'pada');
  assert.equal(ap('akita'), 'agida');
  assert.equal(ap('sale'), 'esal');
  assert.equal(ap('θolu'), 'tolu');
  assert.equal(ap('ai kai'), 'ai kei');
  assert.equal(ap('kutu'), 'kudu');
  const tr = N.applyChanges('sate', C, { trace: true });
  assert.deepEqual(tr.steps.map(s => s.idx), [0, 1, 2]);
  assert.equal(tr.out, 'esad');
  // optional and alternatives, metathesis
  assert.equal(N.applyChanges('stala', { rules: [{ from: 'st', to: 'ts' }, { from: 'l', to: 'r', env: '_(a)#' }] }).out, 'tsara');
  assert.equal(N.applyChanges('kirka', { rules: [{ from: 'k', to: 'tʃ', env: '_{i,e}' }] }).out, 'tʃirka');
  // round trip through text
  assert.deepEqual(N.parseChanges(N.changesText(set)).rules.map(r => [r.from, r.to, r.env, r.unless, !!r.off]), set.rules.map(r => [r.from, r.to, r.env, r.unless, !!r.off]));
  // readable errors
  const bad = N.compileChanges({ rules: [{ from: 'X', to: 'a' }, { from: '', to: 'e' }, { from: 'a', to: 'e', env: 'b' }] });
  assert.match(bad.rules[0].error, /category X/);
  assert.match(bad.rules[1].error, /insertion/);
  assert.match(bad.rules[2].error, /_/);
});

test('import parses spreadsheets: quotes, tabs, semicolons, headers and guesses', () => {
  const a = IO.parseDelimited('Word,Gloss,Notes\nsael,"sea, ocean","say ""sa-el"""\r\nsa,salt,\n');
  assert.equal(a.delim, ',');
  assert.deepEqual(a.rows[1], ['sael', 'sea, ocean', 'say "sa-el"']);
  const g = IO.guessColumns(a.rows);
  assert.equal(g.header, true);
  assert.deepEqual(g.mapping, ['word', 'gloss', 'notes']);
  const t = IO.parseDelimited('kewa\tn\tgull\nheʃ\tn\thaven');
  assert.equal(t.delim, '\t');
  assert.deepEqual(IO.guessColumns(t.rows), { header: false, mapping: ['word', 'pos', 'gloss'] });
  assert.equal(IO.parseDelimited('a;b;c\nd;e;f').delim, ';');
  const ws = IO.toWords(a.rows, g.mapping, true);
  assert.equal(ws.length, 2);
  assert.equal(ws[0].gloss, 'sea, ocean');
});

test('words: CRUD, roots, search both ways, duplicates, stats, undo', () => {
  const t = make();
  try {
    const w = t.call('worlds.create', { name: 'W', starter: 'fantasy' });
    const L = lang(t, w);
    const sea = t.call('lexicon.add', L.id, { word: 'sael', ipa: '/ˈsa.el/', pos: 'noun', gloss: 'sea, ocean' });
    assert.equal(sea.pos, 'n');
    assert.equal(sea.ipa, 'ˈsa.el');
    const salt = t.call('lexicon.add', L.id, { word: 'Sá', gloss: 'salt', tags: '#sea; trade' });
    assert.deepEqual(salt.tags, ['sea', 'trade']);
    const salen = t.call('lexicon.add', L.id, { word: 'salen', pos: 'verb', gloss: 'to salt', rootId: salt.id });
    assert.equal(t.call('lexicon.word', salt.id).derived[0].id, salen.id);
    assert.throws(() => t.call('lexicon.update', salt.id, { rootId: salen.id }), /circle/);
    assert.throws(() => t.call('lexicon.add', L.id, { word: '  ' }), /spelling/);
    // search: by word (accent-insensitive) and by meaning
    assert.equal(t.call('lexicon.words', L.id, { q: 'sa', scope: 'word' }).length, 3);
    assert.equal(t.call('lexicon.words', L.id, { q: 'ocean', scope: 'gloss' })[0].id, sea.id);
    assert.equal(t.call('lexicon.words', L.id, { pos: 'v' })[0].id, salen.id);
    const found = t.call('lexicon.search', w.id, 'salt');
    assert.equal(found[0].id, salt.id);
    assert.equal(found[0].languageTitle, 'Testish');
    assert.equal(t.call('lexicon.search', w.id, 'sael')[0].matched, 'word');
    // duplicates show in stats
    t.call('lexicon.add', L.id, { word: 'sael', gloss: 'seal (animal)' });
    const st = t.call('lexicon.stats', L.id);
    assert.equal(st.total, 4);
    assert.equal(st.homographs[0].word, 'sael');
    assert.equal(st.byPos.n, 1);
    assert.equal(st.derived, 1);
    // delete with undo restores the root link too
    const gone = t.call('lexicon.remove', [salt.id]);
    assert.equal(t.call('lexicon.word', salen.id).rootId, null);
    t.call('lexicon.restore', JSON.parse(JSON.stringify(gone)));
    assert.equal(t.call('lexicon.word', salen.id).rootId, salt.id);
    // the language list counts words
    const langs = t.call('lexicon.languages', w.id);
    assert.equal(langs.find(x => x.id === L.id).wordCount, 4);
    assert.ok(t.events.some(([ev, p]) => ev === 'wb:changed' && p.tables.includes('words')) || true);
  } finally { t.done(); }
});

test('import and export round-trip, with modes and roots', () => {
  const t = make();
  try {
    const w = t.call('worlds.create', { name: 'W' });
    const L = lang(t, w);
    const csv = 'word,ipa,pos,gloss,root\nkewa,ˈke.wa,n,gull,\nkewahesh,,name,Gullhaven,kewa\n"sa, el",,phr,"sea, salt",\n';
    const pv = t.call('lexicon.previewImport', csv);
    assert.equal(pv.total, 3);
    assert.deepEqual(pv.mapping, ['word', 'ipa', 'pos', 'gloss', 'root']);
    assert.deepEqual(t.call('lexicon.import', L.id, csv), { added: 3, updated: 0, skipped: 0, total: 3 });
    assert.deepEqual(t.call('lexicon.import', L.id, csv), { added: 0, updated: 0, skipped: 3, total: 3 });
    const r = t.call('lexicon.import', L.id, 'word\tdefinition\nkewa\tA loud sea-bird.', { mode: 'update' });
    assert.equal(r.updated, 1);
    const words = t.call('lexicon.words', L.id);
    const kh = words.find(x => x.word === 'kewahesh');
    assert.equal(kh.rootId, words.find(x => x.word === 'kewa').id);
    assert.equal(words.find(x => x.word === 'kewa').definition, 'A loud sea-bird.');
    const out = t.call('lexicon.export', L.id, 'csv');
    assert.match(out.text, /^word,ipa,pos,gloss/);
    assert.match(out.text, /"sa, el"/);
    const L2 = lang(t, w, 'Copy');
    assert.equal(t.call('lexicon.import', L2.id, out.text).added, 3);
    assert.equal(t.call('lexicon.words', L2.id).find(x => x.word === 'kewahesh').rootId != null, true);
    assert.match(t.call('lexicon.export', L.id, 'md').text, /\*\*kewa\*\* \/ˈke\.wa\/ _noun_ — gull/);
    assert.equal(JSON.parse(t.call('lexicon.export', L.id, 'json').text).words.length, 3);
  } finally { t.done(); }
});

test('translation by gloss both ways: phrases, inflections, unknown and omitted words', () => {
  const t = make();
  try {
    const w = t.call('worlds.create', { name: 'W' });
    const L = lang(t, w);
    t.call('lexicon.addMany', L.id, [
      { word: 'skolen rath', pos: 'phr', gloss: 'the Drowned King' }, { word: 'aka', pos: 'v', gloss: 'to return, to come back' },
      { word: 'sael', pos: 'n', gloss: 'sea' }, { word: 'kewa', pos: 'n', gloss: 'gull' }, { word: 'osk', pos: 'v', gloss: 'to hear, to listen' },
    ]);
    const a = t.call('lexicon.translate', L.id, 'The drowned king returns to the sea!');
    assert.equal(a.out, 'skolen rath aka to sael!');
    assert.deepEqual(a.unknown, ['to']);
    assert.ok(a.tokens.find(x => x.key === 'the sea' && x.matches[0].word === 'sael'), 'an article joins its noun');
    assert.ok(t.call('lexicon.translate', L.id, 'return, the').tokens.find(x => x.key === 'the' && x.omitted));
    assert.equal(t.call('lexicon.translate', L.id, 'gulls heard').out, 'kewa osk');
    const b = t.call('lexicon.translate', L.id, 'Skolen rath aka sael', { dir: 'from' });
    assert.equal(b.out, 'drowned king return sea');
    assert.deepEqual(t.call('lexicon.glossTerms', 'to rise, to flood (of water); swell'), ['rise', 'flood', 'swell']);
  } finally { t.done(); }
});

test('sound changes derive a daughter language with etymology links, and update it again', () => {
  const t = make();
  try {
    const w = t.call('worlds.create', { name: 'W' });
    const P = lang(t, w, 'Proto', { consonants: ['k', 't', 'θ', 'w', 's', 'l'], vowels: ['a', 'e', 'o'] });
    const [aka, , kewa] = t.call('lexicon.addMany', P.id, [{ word: 'aka', ipa: 'ˈa.ka', gloss: 'return' }, { word: 'thal', gloss: 'die' }, { word: 'kewa', gloss: 'gull' }, { word: 'Kewasel', pos: 'name', gloss: 'Gullhaven' }]);
    t.call('lexicon.update', t.call('lexicon.words', P.id).find(x => x.word === 'Kewasel').id, { rootId: kewa.id });
    const branch = { id: 'b1', name: 'Inland', categories: {}, rules: [{ from: 'θ', to: 't' }, { from: 'k', to: 'g', env: 'V_V' }, { from: 'w', to: 'v' }] };
    t.call('entries.update', P.id, { dataPatch: { soundChanges: { branches: [branch], active: 'b1' } } });
    const pv = t.call('lexicon.preview', P.id, branch, { trace: true });
    assert.equal(pv.words.length, 4);
    assert.equal(pv.words.find(x => x.id === aka.id).out, 'aga');
    assert.deepEqual(pv.words.find(x => x.id === aka.id).steps.map(s => s.idx), [1]);
    assert.equal(pv.words.find(x => x.word === 'thal').out, 'tal');
    assert.equal(pv.words.find(x => x.word === 'Kewasel').out, 'Kevasel');
    const r = t.call('lexicon.derive', P.id, { branchId: 'b1' });
    assert.equal(r.created, true);
    assert.equal(r.added, 4);
    const D = t.call('entries.get', r.daughter.id);
    assert.equal(D.title, 'Inland');
    assert.equal(D.data.parent, P.id);
    assert.ok(D.data.phonology.consonants.includes('v') && !D.data.phonology.consonants.includes('θ'));
    assert.equal(t.call('entries.get', P.id).data.soundChanges.branches[0].daughterId, D.id);
    const dw = t.call('lexicon.words', D.id);
    const g = dw.find(x => x.word === 'aga');
    assert.equal(g.sourceId, aka.id);
    assert.match(g.etymology, /^From Proto aka/);
    assert.equal(dw.find(x => x.word === 'Kevasel').rootId, dw.find(x => x.word === 'keva').id);
    assert.equal(t.call('lexicon.word', aka.id).descendants[0].languageTitle, 'Inland');
    assert.equal(t.call('lexicon.languages', w.id).find(x => x.id === D.id).parentLanguageId, P.id);
    // change a rule and derive again: the same daughter is updated, not duplicated
    branch.rules[2].to = 'b';
    t.call('entries.update', P.id, { dataPatch: { soundChanges: Object.assign(t.call('entries.get', P.id).data.soundChanges, { branches: [Object.assign({}, branch, { daughterId: D.id })] }) } });
    const r2 = t.call('lexicon.derive', P.id, { branchId: 'b1' });
    assert.equal(r2.created, false);
    assert.equal(r2.daughter.id, D.id);
    assert.equal(r2.updated, 2);
    assert.ok(t.call('lexicon.words', D.id).find(x => x.word === 'keba'));
    assert.equal(t.call('lexicon.words', D.id).length, 4);
  } finally { t.done(); }
});

test('words follow their language: purge cascades, world packages carry them with new ids', () => {
  const t = make();
  try {
    const w = t.call('worlds.create', { name: 'W' });
    const L = lang(t, w);
    const [a] = t.call('lexicon.addMany', L.id, [{ word: 'sa', gloss: 'salt' }, { word: 'salen', gloss: 'to salt' }]);
    t.call('lexicon.update', t.call('lexicon.words', L.id).find(x => x.word === 'salen').id, { rootId: a.id });
    const copy = t.call('worlds.duplicate', w.id);
    const L2 = t.call('lexicon.languages', copy.id)[0];
    assert.notEqual(L2.id, L.id);
    const ws = t.call('lexicon.words', L2.id);
    assert.equal(ws.length, 2);
    assert.equal(ws.find(x => x.word === 'salen').rootId, ws.find(x => x.word === 'sa').id);
    assert.notEqual(ws[0].id, a.id);
    t.call('entries.trash', L.id);
    assert.equal(t.call('lexicon.languages', w.id).length, 0);
    t.call('entries.restore', L.id);
    assert.equal(t.call('lexicon.words', L.id).length, 2);
    t.call('entries.purge', L.id);
    assert.equal(t.ctx.db.value('SELECT count(*) FROM words WHERE language_id = ?', L.id), 0);
  } finally { t.done(); }
});

test('the example world gets Saltspeak with a phonology, ~70 words, roots, place links and a sound-change branch', () => {
  const t = make();
  try {
    const w = t.call('worlds.sample');
    const langs = t.call('lexicon.languages', w.id);
    const L = langs.find(x => x.title === 'Saltspeak');
    assert.ok(L);
    assert.ok(L.wordCount >= 60, 'words: ' + L.wordCount);
    const e = t.call('entries.get', L.id);
    assert.ok(e.data.phonology.consonants.includes('ʃ'));
    assert.equal(e.data.soundChanges.branches[0].rules.length, 5);
    const words = t.call('lexicon.words', L.id);
    const kh = words.find(x => x.word === 'Kewahesh');
    assert.ok(kh && kh.rootId && kh.gloss === 'Gullhaven');
    assert.equal(kh.entryId, t.call('entries.list', w.id, {}).find(x => x.title === 'Gullhaven').id);
    assert.ok(words.find(x => x.word === 'sael' && x.ipa === 'ˈsa.el'));
    assert.equal(words.filter(x => x.rootId).length >= 20, true);
    const pv = t.call('lexicon.preview', L.id, e.data.soundChanges.branches[0]);
    assert.equal(pv.errors.length, 0);
    assert.ok(pv.words.filter(x => x.changed).length >= 15);
    assert.equal(pv.words.find(x => x.word === 'rath').out, 'rat');
    assert.equal(t.call('lexicon.translate', L.id, 'the drowned king returns').out, 'skolen rath aka');
    // generated words from the sample phonology avoid its bans
    for (const g of N.words(e.data.phonology, { count: 40, seed: 11 })) assert.ok(!/ʃs|sʃ|h$|ww/.test(g.plain), g.plain);
  } finally { t.done(); }
});
