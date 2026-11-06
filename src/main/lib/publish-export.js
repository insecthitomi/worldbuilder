'use strict';
/* Exports built from the knowledge-filtered model: an Obsidian-compatible Markdown vault, CSV per type, JSON data
   with a JSON Schema per type (for game engines and tools), and the HTML behind the PDF world bible and handouts.
   Each returns files or text; the area writes them where the user chose. */
const T = require('../../shared/richtext');
const F = require('../../shared/fields');
const H = require('./publish-html');
const { esc, attr } = H;

const LEVEL_LABEL = { author: 'Author (everything)', shared: 'Shared (players & readers)', public: 'Public' };
/** a file name Windows, macOS and Obsidian all accept */
const fileName = s => String(s || 'Untitled').replace(/[<>:"/\\|?*\x00-\x1f#^[\]]+/g, ' ').replace(/\s+/g, ' ').trim().replace(/^\.+/, '').slice(0, 100).trim() || 'Untitled';
function uniqueName(base, used) {
  let n = base, i = 2;
  while (used.has(n.toLowerCase())) n = base + ' ' + i++;
  used.add(n.toLowerCase());
  return n;
}

/* ---------------- YAML (front matter) ---------------- */
const yScalar = v => (typeof v === 'number' && Number.isFinite(v) ? String(v) : typeof v === 'boolean' ? String(v) : JSON.stringify(String(v)));
function yaml(obj) {
  const out = [];
  for (const [k, v] of Object.entries(obj)) {
    if (v == null || v === '' || (Array.isArray(v) && !v.length)) continue;
    const key = /^[A-Za-z_][\w-]*$/.test(k) ? k : JSON.stringify(k);
    if (Array.isArray(v)) { out.push(key + ':'); for (const x of v) out.push('  - ' + yScalar(x)); }
    else out.push(key + ': ' + yScalar(v));
  }
  return '---\n' + out.join('\n') + '\n---\n';
}

/* ---------------- Markdown vault ---------------- */
/**
 * m: model; x: { media(id) → { file, ext, name } | null }
 * → { files: [{ path, data } | { path, copy }], notes, media }
 */
function markdownVault(m, x = {}) {
  const files = [], used = new Set(), names = new Map(), folders = new Map(), usedFolders = new Set(['_media']);
  for (const t of m.types) folders.set(t.id, uniqueName(fileName(t.plural || t.name), usedFolders));
  // vault-wide unique note names (Obsidian resolves [[links]] by file name)
  for (const e of m.entries) {
    let base = fileName(e.title);
    if (used.has(base.toLowerCase())) base = fileName(e.title + ' (' + e.type.name + ')');
    names.set(e.id, uniqueName(base, used));
  }
  const mediaNames = new Map(), usedMedia = new Set();
  const mediaFile = id => {
    if (mediaNames.has(id)) return mediaNames.get(id);
    const md = x.media ? x.media(id) : null;
    let n = null;
    if (md && md.file) { n = uniqueName(fileName((md.name || 'image') + '-' + id), usedMedia) + '.' + (md.ext || 'png'); files.push({ path: '_media/' + n, copy: md.file }); }
    mediaNames.set(id, n);
    return n;
  };
  const link = id => (names.has(id) ? names.get(id) : null);
  const wiki = (id, label) => { const n = link(id); if (!n) return label || m.titleOf(id) || ''; return label && label !== n ? '[[' + n + '|' + label + ']]' : '[[' + n + ']]'; };
  for (const e of m.entries) {
    const t = e.type, fm = { title: e.title, type: t.key };
    if (e.aliases && e.aliases.length) fm.aliases = e.aliases;
    const tags = (e.tags || []).map(id => m.tags.get(id)).filter(Boolean).map(g => g.name.replace(/\s+/g, '-'));
    if (tags.length) fm.tags = tags;
    if (e.summary) fm.summary = e.summary;
    if (m.level === 'author') fm.audience = e.audience;
    if (e.start) fm[t.dated && t.dated.start ? F.slug(t.dated.start) : 'start'] = m.date(e.start);
    if (e.end) fm[t.dated && t.dated.end ? F.slug(t.dated.end) : 'end'] = m.date(e.end);
    if (e.parentId && link(e.parentId)) fm.parent = wiki(e.parentId);
    if (e.coverId) { const n = mediaFile(e.coverId); if (n) fm.cover = '[[' + n + ']]'; }
    for (const d of t.fields || []) {
      const v = e.fields[d.key];
      if (!F.filled(d.kind, v) || fm[d.key] !== undefined) continue;
      switch (d.kind) {
        case 'ref': if (m.titleOf(v)) fm[d.key] = wiki(v); break;
        case 'refs': fm[d.key] = v.filter(id => m.titleOf(id)).map(id => wiki(id)); break;
        case 'multi': case 'list': fm[d.key] = v.map(String); break;
        case 'stats': fm[d.key] = v.map(s => s.label + ': ' + s.value); break;
        case 'axis': case 'attrs': fm[d.key] = F.asText(d, v); break;
        case 'image': { const n = mediaFile(v); if (n) fm[d.key] = '[[' + n + ']]'; break; }
        case 'number': case 'rating': case 'progress': fm[d.key] = Number(v); break;
        case 'bool': fm[d.key] = !!v; break;
        default: fm[d.key] = String(v);
      }
    }
    fm['wb-id'] = e.id;
    let md = T.toMarkdown(e.body || '', { link: (id, label) => (m.included.has(id) ? wiki(id, label) : label) });
    md = md.replace(/!\[([^\]]*)\]\(media:([a-z0-9]+)\)/g, (s, alt, id) => { const n = mediaFile(id); return n ? '![[' + n + ']]' : ''; });
    const rels = m.relationsOf(e.id).filter(r => link(r.other));
    if (rels.length) md += '\n## Relations\n\n' + rels.map(r => '- ' + r.label + ' ' + wiki(r.other) + (r.note ? ' — ' + r.note : '')).join('\n') + '\n';
    files.push({ path: folders.get(t.id) + '/' + names.get(e.id) + '.md', data: yaml(fm) + '\n' + md.trim() + '\n' });
  }
  // a home note that links every type (skipped again on import)
  const byType = m.types.map(t => [t, m.entries.filter(e => e.typeId === t.id)]).filter(([, l]) => l.length);
  const home = yaml({ title: m.world.name, 'wb-index': true }) + '\n# ' + m.world.name + '\n\n' + (m.world.summary ? m.world.summary + '\n\n' : '') +
    '_Exported from Worldbuilder · ' + LEVEL_LABEL[m.level] + ' · as of ' + m.date({ day: m.asOf, prec: 'day' }) + '_\n\n' +
    byType.map(([t, l]) => '## ' + t.plural + '\n\n' + l.map(e => '- ' + wiki(e.id)).join('\n')).join('\n\n') + '\n';
  files.push({ path: uniqueName(fileName(m.world.name), used) + '.md', data: home });
  return { files, notes: m.entries.length, media: [...mediaNames.values()].filter(Boolean).length };
}

/* ---------------- CSV ---------------- */
const csvCell = v => { const s = v == null ? '' : String(v); return /[",\n\r;]/.test(s) || /^\s|\s$/.test(s) ? '"' + s.replace(/"/g, '""') + '"' : s; };
const csvRow = cells => cells.map(csvCell).join(',');
/** one CSV per type with entries → { files: [{ path, data }] } */
function csvFiles(m) {
  const files = [], used = new Set();
  for (const t of m.types) {
    const list = m.entries.filter(e => e.typeId === t.id);
    if (!list.length) continue;
    const dl = t.dated || { start: 'Start', end: 'End' };
    const defs = (t.fields || []).filter(d => m.level === 'author' || !d.secret);
    const head = ['Title', 'Aliases', 'Summary', 'Parent', 'Tags'].concat(m.level === 'author' ? ['Audience'] : [], [dl.start || 'Start', dl.end || 'End'], defs.map(d => d.label), ['Text', 'Id']);
    const rows = [csvRow(head)];
    for (const e of list) {
      const vals = defs.map(d => fieldText(m, d, e.fields[d.key]));
      rows.push(csvRow([e.title, (e.aliases || []).join('; '), e.summary, e.parentId ? m.titleOf(e.parentId) : '', (e.tags || []).map(id => (m.tags.get(id) || {}).name).filter(Boolean).join('; ')]
        .concat(m.level === 'author' ? [e.audience] : [], [e.start ? m.date(e.start) : '', e.end ? m.date(e.end) : ''], vals, [T.text(e.body || ''), e.id])));
    }
    files.push({ path: uniqueName(fileName(t.plural), used) + '.csv', data: '﻿' + rows.join('\r\n') + '\r\n' });
  }
  return { files };
}
function fieldText(m, d, v) {
  if (!F.filled(d.kind, v)) return '';
  switch (d.kind) {
    case 'ref': return m.titleOf(v);
    case 'refs': return v.map(m.titleOf).filter(Boolean).join('; ');
    case 'multi': case 'list': return v.join('; ');
    case 'stats': return v.map(s => s.label + ': ' + s.value).join('; ');
    case 'axis': case 'attrs': return F.asText(d, v);
    case 'bool': return v ? 'yes' : 'no';
    default: return String(v);
  }
}

/* ---------------- JSON + JSON Schema ---------------- */
const DATE_SCHEMA = { type: ['object', 'null'], description: 'A world date: absolute day number on the world calendar, minutes into the day, precision.',
  properties: { day: { type: 'integer' }, min: { type: ['integer', 'null'] }, prec: { enum: ['year', 'month', 'day', 'time'] }, text: { type: 'string' } }, required: ['day', 'prec'] };
function fieldSchema(d) {
  const base = { title: d.label };
  if (d.hint) base.description = d.hint;
  switch (d.kind) {
    case 'number': return Object.assign(base, { type: 'number' }, d.unit ? { description: (d.hint ? d.hint + ' ' : '') + 'Unit: ' + d.unit } : {});
    case 'rating': return Object.assign(base, { type: 'integer', minimum: 0, maximum: 5 });
    case 'progress': return Object.assign(base, { type: 'number', minimum: 0, maximum: 100 });
    case 'bool': return Object.assign(base, { type: 'boolean' });
    case 'ref': return Object.assign(base, { type: 'string', description: 'Id of an entry' + (d.refTypes && d.refTypes.length ? ' (' + d.refTypes.join(', ') + ')' : '') });
    case 'refs': return Object.assign(base, { type: 'array', items: { type: 'string' }, description: 'Ids of entries' + (d.refTypes && d.refTypes.length ? ' (' + d.refTypes.join(', ') + ')' : '') });
    case 'choice': return Object.assign(base, d.options && d.options.length ? { enum: d.options.concat(['']) } : { type: 'string' });
    case 'multi': return Object.assign(base, { type: 'array', items: d.options && d.options.length ? { enum: d.options } : { type: 'string' } });
    case 'list': return Object.assign(base, { type: 'array', items: { type: 'string' } });
    case 'stats': return Object.assign(base, { type: 'array', items: { type: 'object', properties: { label: { type: 'string' }, value: { type: ['string', 'number'] } }, required: ['label', 'value'] } });
    case 'realdate': return Object.assign(base, { type: 'string', format: 'date' });
    case 'url': return Object.assign(base, { type: 'string', format: 'uri' });
    case 'image': return Object.assign(base, { type: 'string', description: 'Media file name in the media folder' });
    case 'color': return Object.assign(base, { type: 'string', pattern: '^#[0-9a-fA-F]{3,8}$' });
    case 'dice': return Object.assign(base, { type: 'string', description: 'Dice notation, e.g. 2d6+1' });
    default: return Object.assign(base, { type: 'string' });
  }
}
/** → { data, schema } (types → JSON Schema; entries validated per type through oneOf) */
function jsonExport(m, x = {}) {
  const typesUsed = m.types.filter(t => m.entries.some(e => e.typeId === t.id));
  const defs = {};
  for (const t of typesUsed) {
    const fieldsProps = {};
    for (const d of t.fields || []) if (m.level === 'author' || !d.secret) fieldsProps[d.key] = fieldSchema(d);
    defs[t.key] = {
      title: t.name, type: 'object', additionalProperties: false,
      properties: {
        id: { type: 'string' }, type: { const: t.key }, title: { type: 'string' }, aliases: { type: 'array', items: { type: 'string' } },
        summary: { type: 'string' }, parent: { type: ['string', 'null'] }, tags: { type: 'array', items: { type: 'string' } },
        audience: { enum: ['private', 'shared', 'public'] }, start: { $ref: '#/$defs/date' }, end: { $ref: '#/$defs/date' },
        cover: { type: ['string', 'null'] }, fields: { type: 'object', additionalProperties: false, properties: fieldsProps },
        body: { type: 'string', description: 'Rich text as HTML' }, text: { type: 'string', description: 'Plain text of the body' },
      },
      required: ['id', 'type', 'title', 'fields'],
    };
  }
  defs.date = DATE_SCHEMA;
  const schema = {
    $schema: 'https://json-schema.org/draft/2020-12/schema', $id: 'worldbuilder-data.schema.json', title: m.world.name + ' — Worldbuilder data',
    type: 'object', required: ['format', 'world', 'types', 'entries'],
    properties: {
      format: { const: 'worldbuilder-data' }, version: { type: 'integer' },
      world: { type: 'object', properties: { name: { type: 'string' }, summary: { type: 'string' }, calendar: { type: 'object' }, now: { $ref: '#/$defs/date' }, asOf: { $ref: '#/$defs/date' }, audience: { type: 'string' } } },
      types: { type: 'array', items: { type: 'object', properties: { key: { type: 'string' }, name: { type: 'string' }, plural: { type: 'string' }, fields: { type: 'array' } } } },
      entries: { type: 'array', items: { oneOf: typesUsed.map(t => ({ $ref: '#/$defs/' + t.key })) } },
      relations: { type: 'array', items: { type: 'object', properties: { from: { type: 'string' }, to: { type: 'string' }, name: { type: 'string' }, inverse: { type: 'string' }, category: { type: 'string' }, start: { type: ['integer', 'null'] }, end: { type: ['integer', 'null'] }, note: { type: 'string' } }, required: ['from', 'to', 'name'] } },
    },
    $defs: defs,
  };
  const date = d => (d ? { day: d.day, min: d.min == null ? null : d.min, prec: d.prec, text: m.date(d) } : null);
  const mediaName = id => { const md = id && x.media ? x.media(id) : null; return md ? md.name : null; };
  const data = {
    $schema: './' + (x.schemaFile || 'schema.json'), format: 'worldbuilder-data', version: 1,
    world: { name: m.world.name, summary: m.world.summary, calendar: m.world.calendar, now: date(m.world.now), asOf: date({ day: m.asOf, prec: 'day' }), audience: m.level },
    types: typesUsed.map(t => ({ key: t.key, name: t.name, plural: t.plural, icon: t.icon, color: t.color, dated: t.dated, fields: (t.fields || []).filter(d => m.level === 'author' || !d.secret).map(d => ({ key: d.key, label: d.label, kind: d.kind, options: d.options, refTypes: d.refTypes, unit: d.unit })) })),
    entries: m.entries.map(e => {
      const fields = {};
      for (const d of e.type.fields || []) {
        const v = e.fields[d.key];
        if (v === undefined) continue;
        if (d.kind === 'image') { const n = mediaName(v); if (n) fields[d.key] = n; continue; }
        if (d.kind === 'ref') { if (v) fields[d.key] = v; continue; }
        if (d.kind === 'number' || d.kind === 'rating' || d.kind === 'progress') { if (v !== null && v !== '' && Number.isFinite(+v)) fields[d.key] = +v; continue; }
        fields[d.key] = v;
      }
      return {
        id: e.id, type: e.type.key, title: e.title, aliases: e.aliases || [], summary: e.summary || '', parent: e.parentId || null,
        tags: (e.tags || []).map(id => (m.tags.get(id) || {}).name).filter(Boolean), audience: e.audience, start: date(e.start), end: date(e.end),
        cover: mediaName(e.coverId), fields, body: H.bodyHtml(e.body, { href: id => (m.included.has(id) ? '#' + id : null), media: id => { const n = mediaName(id); return n ? { src: 'media/' + n } : null; } }), text: T.text(e.body || ''),
      };
    }),
    relations: m.relations.filter(r => m.included.has(r.src) && m.included.has(r.dst)).map(r => ({ from: r.src, to: r.dst, name: r.name, inverse: r.inverse, category: r.category, start: r.startDay == null ? null : r.startDay, end: r.endDay == null ? null : r.endDay, note: r.note || '' })),
  };
  return { data, schema };
}

/* ---------------- printable HTML (PDF world bible, handouts) ---------------- */
const PRINT_CSS = `
@page{size:A4;margin:16mm 15mm 18mm}
*{box-sizing:border-box}
html{font-family:'Iowan Old Style','Palatino Linotype',Palatino,Georgia,serif;font-size:10.5pt;line-height:1.5;color:#231a12;background:#fff}
body{margin:0}
a{color:inherit;text-decoration:none;border-bottom:.5pt dotted #a07a50}
h1,h2,h3{font-family:'Book Antiqua','Palatino Linotype',Georgia,serif;line-height:1.2;color:#1c140d}
.cover{height:262mm;display:flex;flex-direction:column;justify-content:flex-end;position:relative;page-break-after:always;color:#fff;background:linear-gradient(160deg,var(--accent),#1b130c);border-radius:4mm;overflow:hidden;padding:18mm 16mm}
.cover img{position:absolute;inset:0;width:100%;height:100%;object-fit:cover;opacity:.92}
.cover::after{content:'';position:absolute;inset:0;background:linear-gradient(180deg,rgba(0,0,0,0) 30%,rgba(0,0,0,.75))}
.cover>div{position:relative;z-index:1}
.cover h1{color:#fff;font-size:40pt;margin:0 0 4mm;font-variant:small-caps;letter-spacing:.02em}
.cover p{margin:0 0 3mm;font-size:13pt;max-width:140mm}
.cover .meta{font-size:9pt;opacity:.85;margin-top:6mm;letter-spacing:.06em;text-transform:uppercase}
.toc{page-break-after:always}
.toc h2{font-size:22pt;margin:0 0 6mm;font-variant:small-caps}
.toc h3{font-size:11pt;margin:5mm 0 1.5mm;color:var(--accent);text-transform:uppercase;letter-spacing:.08em}
.toc ol{margin:0;padding:0;list-style:none;columns:2;column-gap:10mm}
.toc li{break-inside:avoid;padding:.6mm 0;border-bottom:.3pt solid #e4d8c4}
.part{page-break-before:always}
.part-head{border-bottom:1.2pt solid var(--accent);margin-bottom:6mm;padding-bottom:2mm}
.part-head h2{font-size:24pt;margin:0;font-variant:small-caps}
.part-head p{margin:1mm 0 0;color:#7a6650}
.e{break-inside:auto;margin:0 0 7mm;padding-bottom:5mm;border-bottom:.4pt solid #e2d4bd}
.e.page{page-break-before:always;border:0}
.e-head{display:flex;gap:4mm;align-items:flex-start}
.e-head .ttl{flex:1}
.e h3{font-size:15pt;margin:0}
.e .k{font-size:8pt;text-transform:uppercase;letter-spacing:.1em;color:var(--accent);font-weight:700}
.e .d{color:#7a6650;font-size:9pt}
.e .lead{font-style:italic;color:#4d3d2c;margin:1.5mm 0 2.5mm}
.e .cov{width:42mm;height:42mm;object-fit:cover;border-radius:2mm;flex:none}
.facts{display:grid;grid-template-columns:30mm 1fr;gap:.8mm 4mm;margin:2mm 0 3mm;font-size:9.2pt;padding:2.5mm 3.5mm;background:#f7f0e3;border-radius:2mm}
.facts dt{color:#7a6650;font-size:8pt;text-transform:uppercase;letter-spacing:.06em;padding-top:.5mm}
.facts dd{margin:0}.facts dd p{margin:0 0 1mm}.facts ul{margin:0;padding-left:4mm}
.prose p{margin:0 0 2.2mm}.prose h2{font-size:12.5pt}.prose h3{font-size:11pt}.prose img{max-width:100%;max-height:110mm;border-radius:2mm}
.prose blockquote{margin:2mm 0;padding-left:4mm;border-left:1pt solid #c9b08a;color:#5c4a37;font-style:italic}
.prose aside{margin:2mm 0;padding:2mm 3.5mm;background:#f6ecdb;border-left:1.5pt solid var(--accent)}
.prose table{border-collapse:collapse;margin:2mm 0 3mm;font-size:9pt;width:100%}
.prose th,.prose td{text-align:left;padding:1mm 2mm;border-bottom:.4pt solid #dccbb0;vertical-align:top}
.prose th{font-size:7.5pt;text-transform:uppercase;letter-spacing:.06em;color:#7a6650;border-bottom:.8pt solid #c9b08a}
.rels{font-size:9pt;color:#4d3d2c;margin-top:2mm}
.stats{display:flex;flex-wrap:wrap;gap:1.5mm}.stat{border:.4pt solid #d8c6a8;border-radius:1.5mm;padding:.5mm 2mm;text-align:center}.stat span{display:block;font-size:6.5pt;text-transform:uppercase;color:#7a6650}
.stars .off{opacity:.25}.meter{display:inline-block;width:20mm;height:1.6mm;background:#eadcc4;border-radius:1mm;vertical-align:middle}.meter i{display:block;height:100%;background:var(--accent);border-radius:1mm}
.swatch{display:inline-block;width:3mm;height:3mm;border-radius:.6mm;vertical-align:-.4mm}
`;
/** the world bible: cover, contents, one part per type. o: { cover: bool, toc: bool, pageEach: bool, title, accent, mediaUrl(id) } */
function bibleHtml(m, o = {}) {
  const accent = o.accent || '#8a4b20';
  const ids = new Set(m.entries.map(e => e.id));
  const href = id => (ids.has(id) ? '#e-' + id : null);
  const media = id => { const u = o.mediaUrl ? o.mediaUrl(id) : null; return u ? { src: u } : null; };
  const parts = m.types.map(t => [t, m.entries.filter(e => e.typeId === t.id).sort((a, b) => a.title.localeCompare(b.title))]).filter(([, l]) => l.length);
  const title = o.title || m.world.name;
  const coverImg = media(o.coverId || m.world.coverId);
  const asOf = m.date({ day: m.asOf, prec: 'day' });
  const cover = o.cover === false ? '' : `<section class="cover">${coverImg ? `<img src="${attr(coverImg.src)}" alt="">` : ''}<div><h1>${esc(title)}</h1>${o.tagline ? `<p>${esc(o.tagline)}</p>` : ''}${m.world.summary ? `<p>${esc(m.world.summary)}</p>` : ''}<div class="meta">World bible · ${esc(LEVEL_LABEL[m.level])} · as of ${esc(asOf)} · ${m.entries.length} entries</div></div></section>`;
  const toc = o.toc === false ? '' : `<section class="toc"><h2>Contents</h2>${parts.map(([t, l]) => `<h3><a href="#t-${t.key}">${esc(t.plural)}</a></h3><ol>${l.map(e => `<li><a href="#e-${e.id}">${esc(e.title)}</a></li>`).join('')}</ol>`).join('')}</section>`;
  const body = parts.map(([t, l]) => `<section class="part" id="t-${t.key}"><div class="part-head"><h2>${esc(t.plural)}</h2><p>${l.length} ${l.length === 1 ? 'entry' : 'entries'}</p></div>${l.map(e => entryBlock(m, e, { href, media, page: o.pageEach })).join('')}</section>`).join('');
  return printDoc(title + ' — world bible', accent, cover + toc + body);
}
function entryBlock(m, e, o) {
  const t = e.type, rows = [];
  for (const d of t.fields || []) {
    const html = H.fieldHtml(d, e.fields[d.key], { href: o.href, title: m.titleOf, media: o.media });
    if (html) rows.push(`<dt>${esc(d.label)}</dt><dd>${html}</dd>`);
  }
  const dl = t.dated || {};
  const dates = [e.start ? (dl.start || 'From') + ' ' + m.date(e.start) : '', e.end ? (dl.end || 'Until') + ' ' + m.date(e.end) : '', m.age(e) != null ? 'age ' + m.age(e) : ''].filter(Boolean).join(' · ');
  const cov = o.media(e.coverId);
  const rels = m.relationsOf(e.id);
  const body = H.bodyHtml(e.body, { href: o.href, media: o.media });
  return `<article class="e${o.page ? ' page' : ''}" id="e-${e.id}"><div class="e-head"><div class="ttl"><div class="k">${esc(t.icon)} ${esc(t.name)}${e.parentId && m.titleOf(e.parentId) ? ' · in ' + esc(m.titleOf(e.parentId)) : ''}</div><h3>${esc(e.title)}</h3>${e.aliases && e.aliases.length ? `<div class="d">Also: ${esc(e.aliases.join(', '))}</div>` : ''}${dates ? `<div class="d">${esc(dates)}</div>` : ''}</div>${cov ? `<img class="cov" src="${attr(cov.src)}" alt="">` : ''}</div>
${e.summary ? `<p class="lead">${esc(e.summary)}</p>` : ''}${rows.length ? `<dl class="facts">${rows.join('')}</dl>` : ''}${body.trim() ? `<div class="prose">${body}</div>` : ''}
${rels.length ? `<div class="rels"><b>Relations:</b> ${rels.map(r => esc(r.label) + ' ' + (o.href(r.other) ? `<a href="${o.href(r.other)}">${esc(m.titleOf(r.other))}</a>` : esc(m.titleOf(r.other)))).join(' · ')}</div>` : ''}</article>`;
}
function printDoc(title, accent, body, extraCss = '') {
  return `<!doctype html><html lang="en"><head><meta charset="utf-8"><title>${esc(title)}</title><style>:root{--accent:${accent}}${PRINT_CSS}${extraCss}</style></head><body>${body}</body></html>`;
}
const HANDOUT_CSS = `
@page{size:A5;margin:10mm}
html{font-size:10pt}
.handout{border:1.2pt solid var(--accent);border-radius:4mm;padding:7mm 8mm;background:linear-gradient(180deg,#fdf8ee,#f6ecd8);min-height:186mm;position:relative}
.handout::before{content:'';position:absolute;inset:1.6mm;border:.4pt solid color-mix(in srgb,var(--accent) 45%,transparent);border-radius:3mm;pointer-events:none}
.handout .k{font-size:8pt;text-transform:uppercase;letter-spacing:.14em;color:var(--accent);font-weight:700;text-align:center}
.handout h1{text-align:center;font-size:22pt;margin:1mm 0 1mm;font-variant:small-caps}
.handout .d{text-align:center;color:#7a6650;font-size:9pt}
.handout .hero{display:block;width:100%;max-height:70mm;object-fit:cover;border-radius:2.5mm;margin:4mm 0 3mm}
.handout .lead{text-align:center;font-style:italic;margin:3mm 6mm}
.handout .orn{text-align:center;color:var(--accent);letter-spacing:.6em;margin:2mm 0}
.handout .foot{position:absolute;bottom:3.5mm;left:0;right:0;text-align:center;font-size:7pt;color:#9a8670;letter-spacing:.08em;text-transform:uppercase}
`;
/** one entry as a printable card. o: { accent, mediaUrl(id), worldName } */
function handoutHtml(m, e, o = {}) {
  const media = id => { const u = o.mediaUrl ? o.mediaUrl(id) : null; return u ? { src: u } : null; };
  const t = e.type, rows = [];
  for (const d of t.fields || []) { const html = H.fieldHtml(d, e.fields[d.key], { title: m.titleOf, media }); if (html) rows.push(`<dt>${esc(d.label)}</dt><dd>${html}</dd>`); }
  const dl = t.dated || {};
  const dates = [e.start ? (dl.start || 'From') + ' ' + m.date(e.start) : '', e.end ? (dl.end || 'Until') + ' ' + m.date(e.end) : ''].filter(Boolean).join(' · ');
  const cov = media(e.coverId), body = H.bodyHtml(e.body, { media });
  const html = `<div class="handout"><div class="k">${esc(t.icon)} ${esc(t.name)}</div><h1>${esc(e.title)}</h1>${dates ? `<div class="d">${esc(dates)}</div>` : ''}
${cov ? `<img class="hero" src="${attr(cov.src)}" alt="">` : '<div class="orn">◆ ◆ ◆</div>'}${e.summary ? `<p class="lead">${esc(e.summary)}</p>` : ''}
${rows.length ? `<dl class="facts">${rows.join('')}</dl>` : ''}${body.trim() ? `<div class="prose">${body}</div>` : ''}<div class="foot">${esc(o.worldName || m.world.name)}</div></div>`;
  return printDoc(e.title, o.accent || '#8a4b20', html, HANDOUT_CSS);
}

module.exports = { markdownVault, csvFiles, jsonExport, bibleHtml, handoutHtml, yaml, fileName, csvRow, fieldSchema, LEVEL_LABEL };
