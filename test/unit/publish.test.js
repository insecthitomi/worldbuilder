'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { make } = require('./helpers');
const Imp = require('../../src/main/lib/publish-import');
const Model = require('../../src/main/lib/publish-model');
const H = require('../../src/main/lib/publish-html');

// a 3×2 PNG
const PNG = Buffer.from('89504e470d0a1a0a0000000d49484452000000030000000208060000009d74e8b30000001049444154789c63f80f04000002ff01fe0e3aa0d00000000049454e44ae426082', 'hex');
const iso = n => { const d = new Date(Date.now() + n * 864e5); return d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0') + '-' + String(d.getDate()).padStart(2, '0'); };
const tmp = name => fs.mkdtempSync(path.join(os.tmpdir(), 'wb-pub-' + name + '-'));
const readAll = dir => {
  const out = {};
  const walk = (d, rel) => { for (const n of fs.readdirSync(d, { withFileTypes: true })) { const r = rel ? rel + '/' + n.name : n.name; if (n.isDirectory()) walk(path.join(d, n.name), r); else if (/\.(html|xml|js|json|css|md|csv|txt)$/.test(n.name)) out[r] = fs.readFileSync(path.join(d, n.name), 'utf8'); } };
  walk(dir, '');
  return out;
};
const SECRETS = ['SECRET-FIELD-heir-of-the-tide', 'INLINE-SECRET-whisper', 'Brannoc the Hidden', 'The Drowned Truth', 'TACTICS-secret', 'Unrevealed Storm'];

/** a small world with everything the rule has to handle */
function fixture(t) {
  const w = t.call('worlds.create', { name: 'Testmarch', starter: 'fantasy', summary: 'A coast for testing.' });
  const W = w.id, now = w.now.day;
  const rels = t.call('rels.list', W), rel = n => rels.find(r => r.name === n).id;
  const img = t.call('media.save', W, { name: 'portrait.png', mime: 'image/png', bytes: new Uint8Array(PNG) });
  const hiddenImg = t.call('media.save', W, { name: 'hidden.png', mime: 'image/png', bytes: new Uint8Array(PNG) });
  const E = (type, title, o = {}) => t.call('entries.create', Object.assign({ worldId: W, typeKey: type, title, audience: 'public' }, o));
  const gull = E('place', 'Gullhaven', { summary: 'The last free port.', fields: { kind: 'City', population: 4200, rumours: ['RUMOUR-secret-list'] } });
  const harbour = E('place', 'The Harbour', { parentId: gull.id, summary: 'Where the boats come in.' });
  const brannoc = E('character', 'Brannoc the Hidden', { audience: 'private', summary: 'Nobody may know.', coverId: hiddenImg.id });
  const truth = E('lore', 'The Drowned Truth', { audience: 'private', summary: 'A private lore entry.' });
  const corwin = E('character', 'Corwin Vey', { summary: 'A harbour master.', start: { day: now - 360 * 50, prec: 'year' } });
  const mira = E('character', 'Mira Saltborn', {
    summary: 'A tide-witch who hears the drowned.', coverId: img.id, aliases: ['The Tide-Witch'], start: { day: now - 360 * 23, prec: 'day' },
    fields: { occupation: 'Tide-witch', home: gull.id, allegiance: [], secret: 'SECRET-FIELD-heir-of-the-tide', goals: 'To quiet the sea.', status: 'Alive' },
    body: `<h2>Early life</h2><p>Born in <a class="wb-m" data-id="${gull.id}">Gullhaven</a>, she sang to the gulls.</p>`
      + `<p>She fears <a class="wb-m" data-id="${truth.id}">the old story</a> more than storms.</p>`
      + `<p class="wb-s">INLINE-SECRET-whisper about <a class="wb-m" data-id="${corwin.id}">Corwin</a>.</p>`
      + `<p>Visible text with <span class="wb-s">INLINE-SECRET-whisper</span> removed. <img data-media="${img.id}" alt="portrait"></p>`
      + `<h2>Later</h2><p>More.</p><h3>Even later</h3><p>Most.</p>`,
    tagNames: ['witch'],
  });
  const tamsin = E('character', 'Tamsin Vey', { summary: 'Their daughter.', start: { day: now - 360 * 3, prec: 'year' } });
  t.call('links.relate', { src: mira.id, dst: corwin.id, relId: rel('spouse of') });
  t.call('links.relate', { src: mira.id, dst: tamsin.id, relId: rel('parent of') });
  t.call('links.relate', { src: corwin.id, dst: tamsin.id, relId: rel('parent of') });
  t.call('links.relate', { src: mira.id, dst: brannoc.id, relId: rel('enemy of') });
  const storm = E('event', 'Unrevealed Storm', { revealDay: now + 30, start: { day: now + 10, prec: 'day' }, summary: 'Comes later.' });
  const flood = E('event', 'The Great Flood', { start: { day: now - 360 * 200, prec: 'year' }, end: { day: now - 360 * 199, prec: 'year' }, summary: 'The sea took the lowlands.', fields: { location: gull.id, participants: [brannoc.id, mira.id], truth: 'The Drowned Truth was there' } });
  const enc = E('encounter', 'Wyrm on the flats', { fields: { tactics: 'TACTICS-secret' } });
  const shared = E('lore', 'Salt Law', { audience: 'shared', summary: 'For players only.' });
  const p1 = E('post', 'Hello, Saltmarch', { fields: { publish: iso(-10), status: 'Published', excerpt: 'The first post.' }, body: `<p>Meet <a class="wb-m" data-id="${mira.id}">Mira</a>.</p>` });
  const p2 = E('post', 'Coming soon post', { fields: { publish: iso(10), status: 'Scheduled' } });
  const p3 = E('post', 'A draft post', { fields: { publish: iso(-3), status: 'Draft' } });
  const p4 = E('post', 'For supporters', { fields: { publish: iso(-2), status: 'Scheduled', audience_tier: 'Supporters', excerpt: 'Teaser text.' }, body: '<p>SUPPORTER-BODY</p>' });
  const prod = E('product', 'The Saltmarch Novella', { fields: { price: 1299, format: 'Ebook', link: 'https://example.com/buy', status: 'Available', blurb: 'A short novel.' } });
  const map = E('map', 'Map of the Marches', { data: { image: img.id, width: 300, height: 200 }, summary: 'The whole coast.' });
  return { W, now, gull, harbour, brannoc, truth, corwin, mira, tamsin, storm, flood, enc, shared, p1, p2, p3, p4, prod, map, img, hiddenImg };
}

test('site: pages, assets, links and the knowledge rule', async () => {
  const t = make();
  try {
    const f = fixture(t);
    t.ctx.handlers['atlas.items'] = mapId => (mapId === f.map.id ? [
      { kind: 'pin', x: 150, y: 100, entryId: f.gull.id, style: { icon: 'port' } },
      { kind: 'label', x: 40, y: 150, label: 'Storm Sea', style: { size: 22, italic: true, color: '#1d3b5a' } },
      { kind: 'pin', x: 20, y: 20, entryId: f.brannoc.id, label: 'Brannoc the Hidden' },
      { kind: 'region', points: [[0, 0], [100, 0], [100, 100]], label: 'Flats', note: 'GM-NOTE-treasure-here', style: { color: '#aa6633' } },
      { kind: 'pin', x: 10, y: 10, label: 'Secret cove', secret: true },
    ] : []);
    const r = await t.call('publish.preview', f.W);
    const files = readAll(r.dir);
    for (const p of ['index.html', 'assets/site.css', 'assets/site.js', 'assets/search-index.js', 'assets/search-index.json', '404.html', 'sitemap.xml', 'search.html', 'all.html',
      'chronology.html', 'family.html', 'feed.xml', 'devlog/index.html', 'shop/index.html', 'characters/index.html', 'places/index.html', 'maps/index.html',
      'characters/mira-saltborn.html', 'places/gullhaven.html', 'places/the-harbour.html', 'devlog/hello-saltmarch.html', 'shop/the-saltmarch-novella.html', 'maps/map-of-the-marches.html']) {
      assert.ok(files[p] != null, 'missing ' + p);
    }
    // nothing private or secret anywhere
    for (const [p, text] of Object.entries(files)) for (const s of SECRETS.concat(['RUMOUR-secret-list', 'SUPPORTER-BODY', 'Coming soon post', 'A draft post', 'Salt Law', 'GM-NOTE-treasure-here'])) assert.ok(!text.includes(s), `${s} leaked in ${p}`);
    assert.ok(!fs.existsSync(path.join(r.dir, 'media', f.hiddenImg.id + '.png')), 'a private entry\'s cover was copied');
    assert.ok(fs.existsSync(path.join(r.dir, 'media', f.img.id + '.png')));
    // the entry page: links, plain text for hidden mentions, toc, infobox, relations, family
    const mira = files['characters/mira-saltborn.html'];
    assert.match(mira, /<a href="\.\.\/places\/gullhaven\.html" class="mention">Gullhaven<\/a>/);
    assert.match(mira, /She fears the old story more/);
    assert.match(mira, /<nav class="toc">/);
    assert.match(mira, /Tide-witch/);
    assert.match(mira, /Also known as The Tide-Witch/);
    assert.match(mira, /spouse of[\s\S]*Corwin Vey/);
    assert.match(mira, /src="\.\.\/media\/[a-z0-9]+\.png"/);
    assert.match(mira, /#witch/);
    assert.ok(!/Brannoc/.test(mira));
    // backlinks come from visible text only (Corwin is mentioned only inside a secret)
    assert.match(files['places/gullhaven.html'], /Linked from[\s\S]*Mira Saltborn/);
    assert.ok(!/Linked from/.test(files['characters/corwin-vey.html']));
    // children and breadcrumbs
    assert.match(files['places/gullhaven.html'], /the-harbour\.html/);
    assert.match(files['places/the-harbour.html'], /class="crumbs"[\s\S]*gullhaven\.html/);
    // devlog: live posts only, teaser for supporters, RSS
    assert.match(files['devlog/index.html'], /Hello, Saltmarch/);
    assert.match(files['devlog/index.html'], /Supporters only<\/span><\/div>\s*<h3>For supporters<\/h3>/);
    assert.ok(!fs.existsSync(path.join(r.dir, 'devlog', 'for-supporters.html')));
    assert.match(files['feed.xml'], /<rss version="2\.0"/);
    assert.match(files['feed.xml'], /<title>Hello, Saltmarch<\/title>/);
    // shop with buy link, map with pins and regions, chronology, families, search index
    assert.match(files['shop/index.html'], /\$12\.99/);
    assert.match(files['shop/index.html'], /href="https:\/\/example\.com\/buy"/);
    const mp = files['maps/map-of-the-marches.html'];
    assert.match(mp, /<a href="\.\.\/places\/gullhaven\.html" class="pin"/);
    assert.ok(!/Brannoc/.test(mp), 'a pin on a private entry is left out');
    if (fs.existsSync(path.join(__dirname, '../../src/app/modules/atlas/icons.js'))) assert.match(mp, /class="pin-dot"><svg viewBox="0 0 24 24"/, 'Atlas pin symbols are drawn');
    assert.match(mp, /class="map-label"[^>]*font-size="22\.0"[^>]*font-style:italic[^>]*>Storm Sea</);
    assert.match(mp, /<polygon class="region"/);
    assert.ok(!/Secret cove/.test(mp));
    assert.match(files['chronology.html'], /The Great Flood/);
    assert.match(files['family.html'], /Vey family|Family of/);
    assert.match(files['family.html'], /Tamsin Vey/);
    assert.match(files['assets/search-index.js'], /Mira Saltborn/);
    assert.match(files['sitemap.xml'], /characters\/mira-saltborn\.html/);
    // the stats explain what the rule held back
    assert.ok(r.stats.hidden >= 3);
    assert.ok(r.stats.secretFields >= 1 && r.stats.secretPassages >= 2 && r.stats.unlinked >= 1);
    // verifySite finds no leak
    assert.equal(t.call('publish.verifySite', r.dir, SECRETS).ok, true);
  } finally { t.done(); }
});

test('site: shared audience (player wiki), as-of date, settings and sections', async () => {
  const t = make();
  try {
    const f = fixture(t);
    t.call('publish.saveSettings', f.W, { audience: 'shared', asOf: f.now + 60, theme: 'night', accent: '#ff8800', title: 'Player Wiki', sections: { shop: false, family: false } });
    const s = t.call('publish.settings', f.W);
    assert.equal(s.theme, 'night'); assert.equal(s.sections.shop, false); assert.equal(s.sections.maps, true);
    const r = await t.call('publish.preview', f.W);
    const files = readAll(r.dir);
    assert.ok(files['lore/salt-law.html'], 'shared entries appear in the player wiki');
    assert.ok(files['events/unrevealed-storm.html'], 'revealed by the later as-of date');
    assert.ok(!files['shop/index.html'] && !files['family.html'], 'sections switched off');
    assert.match(files['index.html'], /data-theme="night"/);
    assert.match(files['index.html'], /--accent:#ff8800/);
    assert.match(files['index.html'], /Player Wiki/);
    for (const text of Object.values(files)) { assert.ok(!text.includes('Brannoc the Hidden')); assert.ok(!text.includes('SECRET-FIELD')); }
    // the old preview's stale pages are removed on rebuild, foreign files are never touched
    fs.writeFileSync(path.join(r.dir, 'mine.txt'), 'keep me');
    t.call('publish.saveSettings', f.W, { audience: 'public', asOf: null });
    const r2 = await t.call('publish.preview', f.W);
    assert.ok(!fs.existsSync(path.join(r2.dir, 'lore', 'salt-law.html')));
    assert.ok(fs.existsSync(path.join(r2.dir, 'mine.txt')));
  } finally { t.done(); }
});

test('site: building into a folder asks before mixing with other files', async () => {
  const t = make();
  try {
    const f = fixture(t);
    const dir = tmp('build');
    fs.writeFileSync(path.join(dir, 'notes.txt'), 'x');
    const ask = await t.call('publish.build', f.W, { dir });
    assert.equal(ask.needsConfirm, true);
    const done = await t.call('publish.build', f.W, { dir, force: true });
    assert.ok(done.pages > 10);
    assert.ok(fs.existsSync(path.join(dir, '.worldbuilder-site.json')));
    assert.equal(t.call('publish.settings', f.W).outDir, dir);
    // a second build into its own folder needs no question
    assert.ok((await t.call('publish.build', f.W, { dir })).pages > 10);
    fs.rmSync(dir, { recursive: true, force: true });
  } finally { t.done(); }
});

test('posts: live state by real date', () => {
  const day = '2026-05-10';
  assert.equal(Model.postState({ status: 'Published', publish: '2026-06-01' }, day).live, true);
  assert.equal(Model.postState({ status: 'Scheduled', publish: '2026-05-10' }, day).live, true);
  assert.equal(Model.postState({ status: 'Scheduled', publish: '2026-05-11' }, day).state, 'scheduled');
  assert.equal(Model.postState({ status: 'Draft', publish: '2026-01-01' }, day).live, false);
  assert.equal(Model.postState({}, day).state, 'draft');
  const t = make();
  try {
    const f = fixture(t);
    const list = t.call('publish.posts', f.W);
    assert.equal(list.length, 4);
    assert.deepEqual(list.filter(p => p.live).map(p => p.title).sort(), ['For supporters', 'Hello, Saltmarch']);
    assert.equal(list.find(p => p.title === 'Coming soon post').state, 'scheduled');
  } finally { t.done(); }
});

test('markdown vault: export → import round-trip keeps types, fields, links, parents', async () => {
  const t = make();
  try {
    const f = fixture(t);
    const dir = tmp('vault');
    const ex = await t.call('publish.exportMarkdown', f.W, { dir, level: 'author' });
    assert.ok(ex.notes > 10);
    const files = readAll(dir);
    const miraFile = Object.keys(files).find(p => /Characters\/Mira Saltborn\.md$/.test(p));
    const md = files[miraFile];
    assert.match(md, /^---\ntitle: "Mira Saltborn"\ntype: "character"/);
    assert.match(md, /home: "\[\[Gullhaven\]\]"/);
    assert.match(md, /\[\[Gullhaven\]\]/);
    assert.match(md, /born: /);
    assert.ok(fs.readdirSync(path.join(dir, '_media')).length >= 1);
    // a public export leaves secrets out of the vault
    const pubDir = tmp('vault-pub');
    await t.call('publish.exportMarkdown', f.W, { dir: pubDir, level: 'public' });
    for (const [p, text] of Object.entries(readAll(pubDir))) for (const s of SECRETS) assert.ok(!text.includes(s), s + ' leaked into ' + p);

    const w2 = t.call('worlds.create', { name: 'Imported' });
    const scan = await t.call('publish.scanVault', w2.id, { dir });
    assert.equal(scan.folders.find(x => x.name === 'Characters').type, 'character');
    const rep = t.call('publish.importVault', w2.id, scan.token, {});
    assert.equal(rep.created, ex.notes);
    const list = t.call('entries.list', w2.id, {});
    const byTitle = n => list.find(e => e.title === n);
    const m2 = t.call('entries.get', byTitle('Mira Saltborn').id);
    assert.equal(t.call('types.list', w2.id).find(x => x.id === m2.typeId).key, 'character');
    assert.equal(m2.fields.occupation, 'Tide-witch');
    assert.equal(m2.fields.home, byTitle('Gullhaven').id);
    assert.equal(m2.fields.secret, 'SECRET-FIELD-heir-of-the-tide');
    assert.deepEqual(m2.aliases, ['The Tide-Witch']);
    assert.equal(m2.start && m2.start.day, t.call('entries.get', f.mira.id).start.day);
    assert.ok(m2.coverId);
    assert.match(m2.body, new RegExp('data-id="' + byTitle('Gullhaven').id + '"'));
    assert.match(m2.body, /<img data-media="[a-z0-9]+"/);
    assert.equal(t.call('entries.get', byTitle('The Harbour').id).parentId, byTitle('Gullhaven').id);
    assert.equal(t.call('entries.context', byTitle('Gullhaven').id).mentionedBy.length >= 1, true);
    assert.equal(rep.links.unresolvedCount, 0);
    fs.rmSync(dir, { recursive: true, force: true }); fs.rmSync(pubDir, { recursive: true, force: true });
  } finally { t.done(); }
});

test('vault import: Obsidian notes with folders, embeds, aliases and unknown keys', async () => {
  const t = make();
  try {
    const w = t.call('worlds.create', { name: 'Obs', starter: 'fantasy' });
    const dir = tmp('obs');
    const put = (p, s) => { fs.mkdirSync(path.dirname(path.join(dir, p)), { recursive: true }); fs.writeFileSync(path.join(dir, p), s); };
    put('People/Ada Stone.md', '---\naliases: [Ada, "The Mason"]\ntags:\n  - builder\n  - "#guild"\noccupation: Mason\nhome: "[[Rockport]]"\nmood: grumpy\nborn: 1190\n---\n# Ada\nShe built [[Rockport#Walls|the walls]] and knows [[Ben]].\n\n![[face.png]]\n\n> [!note] Aside\n> A callout.\n\n%% hidden comment %%\n- one\n- two\n');
    put('Places/Rockport.md', 'A port. See [[Ada Stone|Ada]] and [[Nowhere]].');
    put('Places/Rockport/Rockport Docks.md', '---\ntype: place\n---\nDocks of the port.');
    put('Places/Rockport/Old Quarter/Tannery.md', 'Smelly.');
    put('People/Ben.md', 'Just Ben.');
    put('Loose idea.md', 'An idea at the root.');
    put('.obsidian/workspace.md', 'ignored');
    put('assets/face.png', PNG);
    const sc = await t.call('publish.scanVault', w.id, { dir });
    {
      assert.equal(sc.notes, 6);
      assert.equal(sc.folders.find(x => x.name === 'People').type, 'character');
      assert.equal(sc.folders.find(x => x.name === 'Places').type, 'place');
      assert.equal(sc.images, 1);
      const rep = t.call('publish.importVault', w.id, sc.token, { rootType: 'note' });
      const list = t.call('entries.list', w.id, {});
      const get = n => t.call('entries.get', list.find(e => e.title === n).id);
      const ada = get('Ada Stone');
      assert.deepEqual(ada.aliases, ['Ada', 'The Mason']);
      assert.equal(ada.fields.occupation, 'Mason');
      assert.equal(ada.fields.home, get('Rockport').id);
      assert.ok(ada.start, 'born → start date');
      assert.match(ada.body, /<a class="wb-m" data-id="[a-z0-9]+">the walls<\/a>/);
      assert.match(ada.body, /<img data-media=/);
      assert.match(ada.body, /mood: grumpy/);
      assert.ok(!/hidden comment/.test(ada.body));
      assert.equal(ada.tags.length, 2);
      assert.equal(get('Rockport Docks').parentId, get('Rockport').id);
      assert.equal(get('Tannery').parentId, get('Old Quarter').id);
      assert.equal(get('Old Quarter').parentId, get('Rockport').id);
      assert.equal(t.call('types.list', w.id).find(x => x.id === get('Loose idea').typeId).key, 'note');
      assert.deepEqual(rep.links.unresolved, ['Nowhere']);
      assert.equal(rep.images.copied, 1);
      assert.equal(rep.unmatched.mood, 1);
      // undo trashes what the import made
      assert.ok(t.call('publish.undoImport', rep.ids).n >= rep.created);
      assert.equal(t.call('entries.list', w.id, {}).length, 0);
      fs.rmSync(dir, { recursive: true, force: true });
    }
  } finally { t.done(); }
});

test('csv: parse, export → import round-trip with mapping, refs and parents', async () => {
  const p = Imp.parseCsv('﻿Name;Notes;Home\r\n"Smith; John";"He said ""hi""\nthen left";Rockport\r\n\r\nJane;;\r\n');
  assert.equal(p.delimiter, ';');
  assert.deepEqual(p.header, ['Name', 'Notes', 'Home']);
  assert.equal(p.rows.length, 2);
  assert.equal(p.rows[0][0], 'Smith; John');
  assert.equal(p.rows[0][1], 'He said "hi"\nthen left');
  const t = make();
  try {
    const f = fixture(t);
    const dir = tmp('csv');
    const ex = await t.call('publish.exportCsv', f.W, { dir, level: 'public' });
    assert.ok(ex.names.includes('Characters.csv'));
    const csv = fs.readFileSync(path.join(dir, 'Characters.csv'), 'utf8');
    assert.ok(!csv.includes('SECRET-FIELD') && !csv.includes('Brannoc'));
    assert.match(csv, /Mira Saltborn/);
    const w2 = t.call('worlds.create', { name: 'CSV world' });
    const gull2 = t.call('entries.create', { worldId: w2.id, typeKey: 'place', title: 'Gullhaven' });
    const scan = await t.call('publish.scanCsv', w2.id, { file: path.join(dir, 'Characters.csv') });
    const charType = t.call('types.list', w2.id).find(x => x.key === 'character');
    assert.equal(scan.typeId, charType.id);
    assert.equal(scan.mapping[scan.header.indexOf('Title')], 'title');
    assert.equal(scan.mapping[scan.header.indexOf('Occupation')], 'field:occupation');
    assert.equal(scan.mapping[scan.header.indexOf('Home')], 'field:home');
    assert.equal(scan.mapping[scan.header.indexOf('Born')], 'start');
    const rep = t.call('publish.importCsv', w2.id, scan.token, { typeId: charType.id, mapping: scan.mapping });
    assert.equal(rep.created, 3);
    const mira = t.call('entries.list', w2.id, { typeKeys: ['character'] }).find(e => e.title === 'Mira Saltborn');
    const full = t.call('entries.get', mira.id);
    assert.equal(full.fields.occupation, 'Tide-witch');
    assert.equal(full.fields.home, gull2.id);
    assert.deepEqual(full.aliases, ['The Tide-Witch']);
    assert.ok(full.start);
    assert.throws(() => t.call('publish.importCsv', w2.id, 'nope', {}), /again/);
    fs.rmSync(dir, { recursive: true, force: true });
  } finally { t.done(); }
});

test('json + schema, PDF bible html, handout html', async () => {
  const t = make();
  try {
    const f = fixture(t);
    const dir = tmp('json');
    const r = await t.call('publish.exportJson', f.W, { file: path.join(dir, 'world.json'), level: 'shared' });
    const data = JSON.parse(fs.readFileSync(r.file, 'utf8')), schema = JSON.parse(fs.readFileSync(r.schema, 'utf8'));
    assert.equal(data.format, 'worldbuilder-data');
    assert.equal(data.$schema, './world.schema.json');
    assert.ok(schema.$defs.character && schema.$defs.place && schema.$defs.date);
    assert.equal(schema.$defs.character.properties.fields.properties.status.enum.includes('Alive'), true);
    assert.equal(schema.$defs.character.properties.fields.properties.secret, undefined, 'secret fields are not in a shared schema');
    assert.equal(schema.$defs.place.properties.fields.properties.population.type, 'number');
    const txt = JSON.stringify(data);
    for (const s of SECRETS) assert.ok(!txt.includes(s), s + ' leaked into JSON');
    assert.ok(data.entries.find(e => e.title === 'Salt Law'), 'shared entries are in a shared export');
    assert.ok(data.relations.length >= 2);
    const html = t.call('publish.bibleHtml', f.W, { level: 'public' });
    assert.match(html, /<section class="toc">/);
    assert.match(html, /href="#e-[a-z0-9]+"/);
    for (const s of SECRETS) assert.ok(!html.includes(s), s + ' leaked into the bible');
    const ho = await t.call('publish.handout', f.mira.id, { html: true, level: 'public' });
    assert.match(ho.html, /class="handout"/);
    assert.match(ho.html, /Mira Saltborn/);
    assert.ok(!ho.html.includes('SECRET-FIELD'));
    await assert.rejects(() => t.call('publish.handout', f.brannoc.id, { html: true, level: 'public' }), /hidden/);
    await assert.rejects(() => t.call('publish.exportPdf', f.W, { file: path.join(dir, 'x.pdf') }), /desktop app/);
    fs.rmSync(dir, { recursive: true, force: true });
  } finally { t.done(); }
});

test('world package: export, preview, import as a new world', async () => {
  const t = make();
  try {
    const f = fixture(t);
    const dir = tmp('pkg'), file = path.join(dir, 'Testmarch.wbworld');
    const ex = await t.call('publish.exportPackage', f.W, { file });
    assert.ok(ex.bytes > 1000 && ex.media === 2);
    const pv = await t.call('publish.previewPackage', { file });
    assert.equal(pv.name, 'Testmarch');
    assert.equal(pv.entries, ex.entries);
    const w2 = t.call('publish.importPackage', pv.token, { name: 'Testmarch again' });
    assert.equal(w2.name, 'Testmarch again');
    assert.equal(t.call('entries.list', w2.id, {}).length, ex.entries);
    fs.writeFileSync(path.join(dir, 'bad.wbworld'), '{"format":"other"}');
    await assert.rejects(() => t.call('publish.previewPackage', { file: path.join(dir, 'bad.wbworld') }), /not a Worldbuilder world/);
    fs.rmSync(dir, { recursive: true, force: true });
  } finally { t.done(); }
});

test('html helpers: slugs, mentions, field values', () => {
  assert.equal(H.slug('Ćafé de l’Été!'), 'cafe-de-lete');
  assert.equal(H.slug('***'), 'entry');
  const used = new Set();
  assert.equal(H.uniqueSlug('a', used), 'a'); assert.equal(H.uniqueSlug('a', used), 'a-2');
  const html = H.bodyHtml('<p>See <a class="wb-m" data-id="abcdef1234">X</a> and <a class="wb-m" data-id="zzzzzz9999">Y</a> <a href="https://x.org">out</a></p>', { href: id => (id === 'abcdef1234' ? 'x.html' : null) });
  assert.match(html, /<a href="x\.html" class="mention">X<\/a> and Y/);
  assert.match(html, /rel="noopener" target="_blank"/);
  assert.equal(H.fieldHtml({ kind: 'rating' }, 3).includes('★★★'), true);
  assert.equal(H.money(1999, 'USD'), '$19.99');
  assert.equal(H.realDate('2026-09-14'), '14 September 2026');
  const fm = Imp.frontMatter('---\na: 1\nb: "two"\nc: [x, "y, z"]\nd:\n  - p\n  - q\ne: |\n  line1\n  line2\n---\nbody');
  assert.deepEqual(fm.data, { a: 1, b: 'two', c: ['x', 'y, z'], d: ['p', 'q'], e: 'line1\nline2' });
  assert.equal(fm.body, 'body');
});

test('sample hook: site settings and post dates on the example world', async () => {
  const t = make();
  try {
    const w = t.call('worlds.sample');
    const s = t.call('publish.settings', w.id);
    assert.equal(s.title, 'The Saltmarch');
    assert.equal(s.theme, 'parchment');
    const r = await t.call('publish.preview', w.id);
    assert.ok(r.pages >= 3);
    assert.equal(t.call('publish.verifySite', r.dir).ok, true);
  } finally { t.done(); }
});

test('site: entries link to their pins on maps, and page through their type', async () => {
  const t = make();
  try {
    const f = fixture(t);
    t.ctx.handlers['atlas.items'] = mapId => (mapId === f.map.id ? [
      { kind: 'region', points: [[0, 0], [90, 0], [90, 90]], entryId: f.harbour.id },
      { kind: 'pin', x: 150, y: 100, entryId: f.gull.id },
    ] : []);
    const r = await t.call('publish.preview', f.W);
    const files = readAll(r.dir);
    assert.match(files['places/gullhaven.html'], /On the map: <a href="\.\.\/maps\/map-of-the-marches\.html#pin-1">Map of the Marches<\/a>/);
    assert.match(files['places/the-harbour.html'], /#pin-0">Map of the Marches/);
    assert.ok(!/On the map/.test(files['characters/mira-saltborn.html']));
    // alphabetical neighbours within a type
    assert.match(files['characters/mira-saltborn.html'], /← Previous character<\/small>Corwin Vey[\s\S]*Next character →<\/small>Tamsin Vey/);
  } finally { t.done(); }
});
