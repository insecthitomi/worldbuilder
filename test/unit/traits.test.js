'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const T = require('../../src/shared/traits');
const F = require('../../src/shared/fields');
const N = require('../../src/shared/names');

const ev = (s, sc) => T.evalFormula(s, sc || {});

test('formula precedence and associativity', () => {
  assert.equal(ev('2 + 3 * 4'), 14);
  assert.equal(ev('(2 + 3) * 4'), 20);
  assert.equal(ev('2 ^ 3 ^ 2'), 512);          // right associative
  assert.equal(ev('-2 ^ 2'), -4);               // unary minus binds below ^
  assert.equal(ev('2 ^ -1'), 0.5);
  assert.equal(ev('10 - 4 - 3'), 3);            // left associative
  assert.equal(ev('7 % 4 + 1'), 4);
  assert.equal(ev('20 / 4 / 5'), 1);
  assert.equal(ev('1 + 2 < 4'), 1);
  assert.equal(ev('3 >= 4'), 0);
  assert.equal(ev('2 == 2'), 1);
});

test('formula functions and names', () => {
  assert.equal(ev('floor((con - 10) / 2)', { con: 15 }), 2);
  assert.equal(ev('floor((con - 10) / 2)', { CON: 7 }), -2);   // names are case-insensitive
  assert.equal(ev('max(1, str, 3) + min(4, 2)', { str: 9 }), 11);
  assert.equal(ev('clamp(x, 0, 10)', { x: 14 }), 10);
  assert.equal(ev('round(2.5) + ceil(1.2) + abs(-3) + sqrt(16)'), 3 + 2 + 3 + 4);
  assert.equal(ev('if(dex >= 15, 2, 0)', { dex: 16 }), 2);
  assert.equal(ev('if(dex >= 15, 2, 0)', { dex: 14 }), 0);
});

test('formula errors are readable and carry a position', () => {
  assert.throws(() => ev(''), /empty/);
  assert.throws(() => ev('2 +'), /ends too soon/);
  assert.throws(() => ev('(1 + 2'), /Missing "\)"/);
  assert.throws(() => ev('1 2'), /Unexpected "2"/);
  assert.throws(() => ev('2 $ 3'), /Unexpected "\$"/);
  assert.throws(() => ev('nope(3)'), /Unknown function "nope"/);
  assert.throws(() => ev('clamp(1, 2)'), /clamp takes 3 values, not 2/);
  assert.throws(() => ev('1 / 0'), /Division by zero/);
  assert.throws(() => ev('sqrt(-1)'), /negative/);
  assert.throws(() => ev('str + 1'), /Unknown name "str"/);
  let pos = -1;
  try { T.parseFormula('1 + * 2'); } catch (e) { pos = e.pos; }
  assert.equal(pos, 4);
  // no code is ever run
  assert.throws(() => ev('process.exit(1)'), /Unexpected|Unknown/);
  assert.throws(() => ev('constructor'), /Unknown name/);
  assert.equal(T.checkFormula('a + b', ['a', 'b']), '');
  assert.match(T.checkFormula('a + zz', ['a']), /Unknown name "zz"/);
});

const sample = () => T.normalize({
  axes: [
    { id: 'race', name: 'Race', types: ['character'], values: [
      { id: 'elf', name: 'Elf', mods: [{ system: 'abil', attr: 'dex', add: 2 }], terms: { ruler: 'Thane' }, nameStyle: 'sylvan' },
      { id: 'high', name: 'High elf', parent: 'elf', mods: [{ system: 'abil', attr: 'int', add: 1 }] },
      { id: 'orc', name: 'Orc', mods: [{ system: 'abil', attr: 'str', add: 2 }, { system: 'abil', attr: 'int', add: -2 }], terms: { ruler: 'Warchief' } }] },
    { id: 'caste', name: 'Caste', many: true, values: [{ id: 'noble', name: 'Noble', mods: [{ system: 'abil', attr: 'cha', add: 1 }] }, { id: 'priest', name: 'Priest', mods: [{ system: 'abil', attr: 'cha', add: 1 }] }] },
  ],
  systems: [{ id: 'abil', name: 'Abilities', attrs: [
    { key: 'str', label: 'Strength', kind: 'number', min: 1, max: 20, def: 10 },
    { key: 'dex', label: 'Dexterity', kind: 'number', min: 1, max: 20, def: 10 },
    { key: 'int', label: 'Intelligence', kind: 'number', min: 1, max: 20, def: 10 },
    { key: 'cha', label: 'Charisma', kind: 'number', min: 1, max: 20, def: 10 },
    { key: 'dex_mod', label: 'Dex mod', kind: 'number', formula: 'floor((dex - 10) / 2)' },
    { key: 'hp', label: 'Hit points', kind: 'bar', maxFormula: '10 + dex_mod * 2' },
  ] }],
});
const row = (rows, k) => rows.find(r => r.key === k);

test('modifiers stack, include parents and count once', () => {
  const cfg = sample();
  let r = T.compute(cfg, 'abil', { dex: 12, int: 11 }, { race: ['high'] });
  assert.equal(row(r, 'dex').total, 14);        // 12 + 2 from the parent Elf
  assert.equal(row(r, 'int').total, 12);        // 11 + 1 from High elf
  assert.equal(row(r, 'dex').mod, 2);
  r = T.compute(cfg, 'abil', {}, { race: ['elf', 'high'], caste: ['noble', 'priest'] });
  assert.equal(row(r, 'dex').total, 12);        // Elf counted once although also reached through High elf
  assert.equal(row(r, 'cha').total, 12);        // two castes +1 each
  r = T.compute(cfg, 'abil', {}, { race: 'orc' });
  assert.equal(row(r, 'str').total, 12);
  assert.equal(row(r, 'int').total, 8);
  assert.deepEqual(T.modifiersFor(cfg, 'abil', { race: ['orc'] }), { str: 2, int: -2 });
});

test('min and max clamp the total, not just the base', () => {
  const cfg = sample();
  let r = T.compute(cfg, 'abil', { dex: 19 }, { race: ['elf'] });
  assert.equal(row(r, 'dex').total, 20);        // 19 + 2 → 20 (max)
  r = T.compute(cfg, 'abil', { int: 1 }, { race: ['orc'] });
  assert.equal(row(r, 'int').total, 1);         // 1 − 2 → 1 (min)
  r = T.compute(cfg, 'abil', { str: 99 }, {});
  assert.equal(row(r, 'str').total, 20);
});

test('derived attributes use totals including modifiers; bars use formulas', () => {
  const cfg = sample();
  const r = T.compute(cfg, 'abil', { dex: 14 }, { race: ['elf'] });   // 16 total
  assert.equal(row(r, 'dex_mod').total, 3);
  assert.equal(row(r, 'dex_mod').derived, true);
  assert.equal(row(r, 'hp').max, 16);                                 // 10 + 3*2
  assert.equal(row(r, 'hp').total, 16);                               // empty base = full
  const r2 = T.compute(cfg, 'abil', { dex: 14, hp: 5 }, { race: ['elf'] });
  assert.equal(row(r2, 'hp').total, 5);
  const r3 = T.compute(cfg, 'abil', { dex: 14, hp: 500 }, { race: ['elf'] });
  assert.equal(row(r3, 'hp').total, 16);
});

test('circular and broken formulas give an error row, not a crash', () => {
  const cfg = T.normalize({ systems: [{ id: 's', name: 'S', attrs: [
    { key: 'a', label: 'A', kind: 'number', formula: 'b + 1' }, { key: 'b', label: 'B', kind: 'number', formula: 'a + 1' },
    { key: 'c', label: 'C', kind: 'number', formula: 'zzz' }, { key: 'd', label: 'D', kind: 'number', formula: 'c * 2' }, { key: 'e', label: 'E', kind: 'number', def: 4 }] }] });
  const r = T.compute(cfg, 's', {}, {});
  assert.match(row(r, 'a').error, /Circular/);
  assert.match(row(r, 'b').error, /Circular/);
  assert.match(row(r, 'c').error, /Unknown name "zzz"/);
  assert.ok(row(r, 'd').error);
  assert.equal(row(r, 'e').total, 4);
  assert.ok(T.validate(cfg).some(p => /Circular/.test(p)));
  assert.ok(T.validate(cfg).some(p => /zzz/.test(p)));
});

test('rating, die, choice and text kinds', () => {
  const cfg = T.normalize({ systems: [{ id: 's', name: 'S', attrs: [
    { key: 'body', label: 'Body', kind: 'rating', max: 5 }, { key: 'weapon', label: 'Weapon', kind: 'die' },
    { key: 'temper', label: 'Temper', kind: 'choice', options: ['Calm', 'Hot'] }, { key: 'note', label: 'Note', kind: 'text' }] }],
  axes: [{ id: 'a', name: 'A', values: [{ id: 'v', name: 'V', mods: [{ system: 's', attr: 'body', add: 3 }] }] }] });
  const r = T.compute(cfg, 's', { body: 4, weapon: 'd8', temper: 'Hot', note: 'hi' }, { a: ['v'] });
  assert.equal(row(r, 'body').total, 5);       // 4 + 3 capped at the 5 dots
  assert.equal(row(r, 'weapon').value, 8);
  assert.equal(row(r, 'temper').total, 'Hot');
  assert.equal(row(r, 'note').total, 'hi');
  assert.equal(T.compute(cfg, 's', {}, {}).find(x => x.key === 'weapon').total, 'd4');
});

test('nested values: tree order, path names, descendants, bad parents healed', () => {
  const cfg = sample();
  const race = cfg.axes[0];
  assert.deepEqual(T.tree(race).map(x => x.value.id + ':' + x.depth), ['elf:0', 'high:1', 'orc:0']);
  assert.equal(T.pathName(cfg, 'high'), 'Elf › High elf');
  assert.deepEqual(T.descendants(race, 'elf'), ['high']);
  const bad = T.normalize({ axes: [{ name: 'X', values: [{ id: 'a', name: 'A', parent: 'b' }, { id: 'b', name: 'B', parent: 'a' }, { id: 'c', name: 'C', parent: 'c' }, { id: 'd', name: 'D', parent: 'nope' }] }] });
  for (const v of bad.axes[0].values) assert.ok(!v.parent || bad.axes[0].values.some(x => x.id === v.parent));
  assert.equal(T.tree(bad.axes[0]).length, 4);   // nothing lost or looping
});

test('terminology and naming style come from the innermost value that has one', () => {
  const cfg = sample();
  assert.equal(T.termFor(cfg, 'ruler', { race: ['elf'] }), 'Thane');
  assert.equal(T.termFor(cfg, 'ruler', { race: ['high'] }), 'Thane');        // inherited from the parent
  assert.equal(T.termFor(cfg, 'ruler', { race: ['orc'] }), 'Warchief');
  assert.equal(T.termFor(cfg, 'ruler', {}), 'Ruler');                         // the world default
  assert.equal(T.termFor(cfg, 'elder', { race: ['elf'] }), 'Elder');
  assert.equal(T.nameStyleFor(cfg, { race: ['high'] }), 'sylvan');
  assert.equal(T.nameStyleFor(cfg, { race: ['orc'] }), '');
  assert.ok(N.STYLES.sylvan);                                                 // styles the packs and tests name exist
  const names = N.generate({ style: T.nameStyleFor(cfg, { race: ['elf'] }), kind: 'person', count: 3, seed: 7 });
  assert.equal(names.length, 3);
});

test('required axes are reported per entry type', () => {
  const cfg = sample();
  cfg.axes[0].required = true;
  assert.deepEqual(T.missingRequired(cfg, 'character', {}).map(a => a.id), ['race']);
  assert.deepEqual(T.missingRequired(cfg, 'character', { race: ['orc'] }), []);
  assert.deepEqual(T.missingRequired(cfg, 'character', { race: ['gone'] }).map(a => a.id), ['race']);   // a removed value does not count
  assert.deepEqual(T.missingRequired(cfg, 'place', {}), []);                                          // race applies to characters only
});

test('every starter pack is valid and can be mixed', () => {
  for (const [k, p] of Object.entries(T.PACKS)) {
    const cfg = T.mergePack(T.emptyConfig(), k);
    assert.ok(cfg.axes.length >= 1, k);
    assert.equal(cfg.axes.length, p.axes.length, k);
    assert.deepEqual(T.validate(cfg), [], k);
    const ids = cfg.axes.flatMap(a => a.values.map(v => v.id));
    assert.equal(new Set(ids).size, ids.length, k + ' value ids are unique');
    for (const a of cfg.axes) for (const v of a.values) if (v.parent) assert.ok(a.values.some(x => x.id === v.parent), k + ' ' + v.name);
    for (const a of cfg.axes) for (const v of a.values) if (v.nameStyle) assert.ok(N.STYLES[v.nameStyle]);
  }
  const fant = T.mergePack(T.emptyConfig(), 'fantasy');
  assert.equal(T.pathName(fant, fant.axes[0].values.find(v => v.name === 'High elf').id), 'Elf › High elf');
  // mixing: two packs, and the same pack twice does not duplicate
  let mix = T.mergePack(fant, 'scifi');
  assert.ok(mix.axes.length > fant.axes.length);
  const again = T.mergePack(mix, 'fantasy');
  assert.equal(again.axes.length, mix.axes.length);
  assert.equal(again.axes[0].values.length, mix.axes[0].values.length);
  const ids = mix.axes.flatMap(a => a.values.map(v => v.id));
  assert.equal(new Set(ids).size, ids.length);
  assert.throws(() => T.mergePack(fant, 'nope'), /Unknown pack/);
});

test('attribute presets are valid and compute', () => {
  for (const k of Object.keys(T.PRESET_SYSTEMS)) {
    const cfg = T.addSystemPreset(T.emptyConfig(), k);
    assert.deepEqual(T.validate(cfg), [], k);
    const rows = T.compute(cfg, cfg.systems[0].id, {}, {});
    assert.ok(rows.length >= 3 && rows.every(r => !r.error), k);
  }
  const six = T.addSystemPreset(T.emptyConfig(), 'classic6');
  const rows = T.compute(six, six.systems[0].id, { con: 14 }, {});
  assert.equal(row(rows, 'con_mod').total, 2);
  assert.equal(row(rows, 'hp').max, 14);
});

test('migration: no config, old config, newer config, hand-edited junk', () => {
  assert.deepEqual(T.migrate(undefined).axes, []);
  assert.equal(T.migrate(null).version, T.VERSION);
  assert.equal(T.migrate('garbage').version, T.VERSION);
  const old = T.migrate({ axes: [{ name: 'Race', values: [{ name: 'Elf' }, { name: 'Elf' }] }] });   // no version, no ids, duplicate names
  assert.equal(old.version, T.VERSION);
  assert.deepEqual(old.axes[0].values.map(v => v.id), ['elf', 'elf_2']);
  assert.equal(old.concepts.length, T.DEFAULT_CONCEPTS.length);
  assert.throws(() => T.migrate({ version: 99 }), e => e.code === 'TOO_NEW');
  const junk = T.normalize({ axes: [null, 5, { name: '', values: 'x' }], systems: [{ attrs: [null, { kind: 'wat', label: 'Q' }] }] });
  assert.equal(junk.axes.length, 1);
  assert.equal(junk.systems[0].attrs[0].kind, 'number');
  // idempotent, and saved ids survive
  const cfg = sample();
  assert.deepEqual(T.normalize(cfg), cfg);
  assert.deepEqual(T.normalize(JSON.parse(JSON.stringify(cfg))).axes[0].values.map(v => v.id), ['elf', 'high', 'orc']);
});

test('import and export round trip; foreign files are refused', () => {
  const cfg = sample();
  const file = JSON.stringify(T.exportConfig(cfg));
  assert.deepEqual(T.importConfig(file), cfg);
  assert.deepEqual(T.importConfig(JSON.parse(file)), cfg);
  assert.throws(() => T.importConfig('{nope'), /not valid JSON/);
  assert.throws(() => T.importConfig({ format: 'something-else', config: {} }), /not a People/);
  assert.throws(() => T.importConfig({ hello: 1 }), /no axes or attribute systems/);
});

test('existing data keeps working: old fields stay, new fields are added once, legacy stats convert', () => {
  const types = F.builtinTypes();
  const ch = types.find(t => t.key === 'character'), sp = types.find(t => t.key === 'species');
  for (const t of [ch, sp]) {
    assert.ok(t.fields.some(f => f.key === 'stats' && f.kind === 'stats'), t.key + ' still has its old stats field');
    assert.ok(t.fields.some(f => f.kind === 'axis') && t.fields.some(f => f.kind === 'attrs'), t.key);
  }
  assert.ok(ch.fields.some(f => f.key === 'species') && ch.fields.some(f => f.key === 'occupation'));
  // an older type without the new fields
  const old = [{ key: 'name', label: 'Name', kind: 'text' }, { key: 'stats', label: 'Stats', kind: 'stats' }];
  const up = T.ensureFields(old);
  assert.deepEqual(up.slice(0, 2), old);
  assert.deepEqual(up.slice(2).map(f => f.kind), ['axis', 'attrs']);
  assert.deepEqual(T.ensureFields(up), up);                                    // running it again changes nothing
  assert.equal(T.ensureFields(ch.fields).length, ch.fields.length);
  // legacy stat rows → base values
  const six = T.addSystemPreset(T.emptyConfig(), 'classic6');
  const base = T.statsToBase(six, six.systems[0].id, [{ label: 'STR', value: '16' }, { label: 'Dexterity', value: '12' }, { label: 'hp', value: '22' }, { label: 'ac', value: '12' }]);
  assert.deepEqual(base, { str: 16, dex: 12, hp: 22 });
});

test('field kinds: empty, filled, text for search and exports', () => {
  assert.ok(F.KINDS.axis && F.KINDS.attrs);
  assert.deepEqual(F.empty('axis'), {});
  assert.equal(F.filled('axis', {}), false);
  assert.equal(F.filled('axis', ''), false);
  assert.equal(F.filled('axis', { race: [] }), false);
  assert.equal(F.filled('axis', { race: ['elf'] }), true);
  assert.equal(F.filled('attrs', {}), false);
  assert.equal(F.filled('attrs', { abil: {} }), false);
  assert.equal(F.filled('attrs', { abil: { str: 12 } }), true);
  assert.equal(F.asText({ kind: 'axis' }, { race: ['high_elf'], caste: ['noble'] }), 'high elf; noble');
  assert.equal(F.asText({ kind: 'attrs' }, { abil: { str: 12, dex: 14 } }), 'str 12, dex 14');
  assert.equal(F.asText({ kind: 'axis' }, ''), '');
  const cfg = sample();
  assert.equal(T.axisText(cfg, { race: ['high'], caste: ['noble'] }), 'Race: Elf › High elf; Caste: Noble');
  assert.equal(T.statText(cfg, 'abil', { dex: 12 }, { race: ['elf'] }).includes('Dexterity 14'), true);
});

test('applicability by entry type; empty list means every type', () => {
  const cfg = sample();
  assert.deepEqual(T.axesFor(cfg, 'character').map(a => a.id), ['race', 'caste']);
  assert.deepEqual(T.axesFor(cfg, 'place').map(a => a.id), ['caste']);
  assert.deepEqual(T.systemsFor(cfg, 'anything').map(s => s.id), ['abil']);
});
