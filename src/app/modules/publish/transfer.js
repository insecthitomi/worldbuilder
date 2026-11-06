/* Publish › Export and Import. Exports pick an audience, an as-of date and entry types once (the same knowledge
   rule as the website), then write a world package, a Markdown vault, CSV, JSON + schema, a PDF world bible or a
   handout. Imports always show a preview first and a report (with Undo) after. */
(function () {
  'use strict';
  const { h, ui } = GK;
  const P = WB.pub;

  const card = ({ icon, title, text, body = [], actions = [], cls = '' }) => {
    const res = h('div.pub-card-res');
    const el = ui.panel({ cls: 'pub-card ' + cls, body: [
      h('div.pub-card-head', [h('span.pub-card-ico', { text: icon }), h('div', [h('h3', { text: title }), h('p.gk-small.gk-muted', { text })])]),
      ...body, h('div.pub-card-actions', actions), res,
    ] });
    el._res = res;
    return el;
  };
  const check = (label, value, onChange, title) => h('label.pub-check', { title: title || '' }, [ui.toggle({ value, onChange }), h('span', { text: label })]);

  /* =============================== EXPORT =============================== */
  P.exports = async function (host, { store, params }) {
    const worldId = WB.worldId;
    let st = store.get(), counts = null, alive = true;
    // the as-of day belongs to one world's calendar: another world starts from its own today
    if (st.asOf != null && st.asOfWorld !== worldId) st = store.patch({ asOf: null, asOfWorld: worldId });
    const opts = () => ({ level: st.level, asOf: st.asOf, types: st.types });
    const set = p => { st = store.patch(p); refresh(); };

    // who is it for
    const level = ui.segmented({ value: st.level, options: P.LEVELS, onChange: v => set({ level: v }) });
    const levelHint = h('div.gk-tiny.gk-faint');
    const asOf = WB.ui.dateInput({ value: st.asOf == null ? null : { day: st.asOf, prec: 'day' }, placeholder: 'World today', onChange: d => set({ asOf: d ? d.day : null, asOfWorld: worldId }) });
    const typeBox = h('div.wb-chips.pub-types');
    const summary = h('div.pub-export-sum');
    const scope = ui.panel({ title: 'Who is it for?', icon: '◐', cls: 'pub-scope', body: [
      h('div.pub-scope-row', [P.field({ label: 'Audience', control: h('div.gk-stack', [level, levelHint]) }), P.field({ label: 'As of', control: asOf, hint: 'Entries revealed later stay out' })]),
      P.field({ label: 'Entry types', control: h('div.gk-stack', [typeBox, h('div.gk-row', [
        ui.button({ label: 'All types', small: true, kind: 'ghost', onClick: () => set({ types: null }) }),
        ui.button({ label: 'None', small: true, kind: 'ghost', onClick: () => set({ types: [] }) }),
      ])]) }),
      summary,
    ] });
    async function refresh() {
      levelHint.textContent = (P.LEVELS.find(l => l[0] === st.level) || [])[2] || '';
      const all = await WB.api('publish.counts', worldId, { level: st.level, asOf: st.asOf }).catch(() => null);
      if (!alive) return;
      counts = all;
      GK.clear(typeBox);
      for (const t of WB.typeList()) {
        const n = all ? all.byType[t.key] || 0 : 0;
        if (!n && !(st.types || []).includes(t.key)) continue;
        const on = !st.types || st.types.includes(t.key);
        const c = ui.chip({ label: t.icon + ' ' + t.plural + ' · ' + n, on, onClick: () => {
          const cur = st.types || WB.typeList().map(x => x.key);
          set({ types: on ? cur.filter(k => k !== t.key) : cur.concat(t.key) });
        } });
        typeBox.appendChild(c);
      }
      if (!typeBox.childNodes.length) typeBox.appendChild(h('span.gk-small.gk-muted', { text: 'No entries are visible to this audience yet.' }));
      const n = all ? (st.types ? st.types.reduce((s, k) => s + (all.byType[k] || 0), 0) : all.entries) : 0;
      const hid = all ? all.stats.hidden : 0;
      summary.replaceChildren(h('b', { text: P.plural(n, 'entry', 'entries') }), ' will be exported' + (st.level !== 'author' && hid ? ' · ' + P.plural(hid, 'entry', 'entries') + ' hidden from this audience' : '') + (st.level !== 'author' && all && all.stats.secretFields + all.stats.secretPassages ? ' · secrets kept out' : '') + '.');
    }

    const outCards = [];
    const run = async (c, btn, fn, done) => {
      P.busy(btn, true);
      GK.clear(c._res);
      try { const r = await fn(); if (r) { c._res.appendChild(done(r)); } } catch (e) { WB.fail(e); c._res.appendChild(h('div.pub-error', { text: e.message })); } finally { P.busy(btn, false); }
    };

    const pkgBtn = ui.button({ label: 'Export package…', icon: '⛁', kind: 'primary' });
    const pkg = card({ icon: '⛁', title: 'World package', text: 'Everything in this world (entries, maps, media, history) in one .wbworld file. For backups, moving to another computer or a co-author. Always complete: the audience does not apply.',
      body: [check('Include media files', st.packageMedia !== false, v => store.patch({ packageMedia: v }), 'Images, audio and files from the Library')], actions: [pkgBtn] });
    pkgBtn.onclick = () => run(pkg, pkgBtn, () => WB.api('publish.exportPackage', worldId, { media: store.get().packageMedia !== false }), r => P.result('Saved ' + P.plural(r.entries, 'entry', 'entries') + (r.media ? ' and ' + P.plural(r.media, 'media file') : '') + ' · ' + WB.fmt.bytes(r.bytes), r.file));

    const vaultBtn = ui.button({ label: 'Export vault…', icon: '⇩', kind: 'primary' });
    const vault = card({ icon: 'M↓', title: 'Markdown vault', text: 'Obsidian-compatible: one note per entry in a folder per type, fields as front matter, mentions as [[links]], images in _media. Opens in Obsidian, Logseq or any editor.', actions: [vaultBtn] });
    vaultBtn.onclick = () => run(vault, vaultBtn, () => WB.api('publish.exportMarkdown', worldId, opts()), r => P.result('Wrote ' + P.plural(r.notes, 'note') + (r.media ? ' and ' + P.plural(r.media, 'image') : ''), r.dir, { folder: true }));

    const csvBtn = ui.button({ label: 'Export CSV…', icon: '▤', kind: 'primary' });
    const csv = card({ icon: '▤', title: 'CSV per type', text: 'One spreadsheet per type with every field the audience may see. Opens in Excel, Numbers or Google Sheets, and imports back here.', actions: [csvBtn] });
    csvBtn.onclick = () => run(csv, csvBtn, () => WB.api('publish.exportCsv', worldId, opts()), r => P.result('Wrote ' + P.plural(r.files, 'file') + ': ' + r.names.join(', '), r.dir, { folder: true }));

    const jsonBtn = ui.button({ label: 'Export JSON…', icon: '{}', kind: 'primary' });
    const json = card({ icon: '{ }', title: 'JSON with a schema', text: 'Entries, fields and relations as JSON plus a JSON Schema per type. For game engines (Unity, Godot, Unreal), scripts and other tools.', actions: [jsonBtn] });
    jsonBtn.onclick = () => run(json, jsonBtn, () => WB.api('publish.exportJson', worldId, opts()), r => P.result(P.plural(r.entries, 'entry', 'entries') + ' in ' + P.plural(r.types, 'type') + ', with ' + r.schema.split(/[\\/]/).pop(), r.file));

    const pdfBtn = ui.button({ label: 'Export PDF…', icon: '▣', kind: 'primary' });
    const pdf = card({ icon: '▣', title: 'PDF world bible', text: 'A printable book: a cover, contents with links, then every chosen entry with its fields, text and relations.',
      body: [h('div.pub-checks', [
        check('Cover page', st.bibleCover !== false, v => store.patch({ bibleCover: v })),
        check('Contents', st.bibleToc !== false, v => store.patch({ bibleToc: v })),
        check('Each entry on a new page', !!st.biblePage, v => store.patch({ biblePage: v })),
      ])], actions: [pdfBtn] });
    pdfBtn.onclick = () => run(pdf, pdfBtn, () => WB.api('publish.exportPdf', worldId, Object.assign(opts(), { cover: store.get().bibleCover !== false, toc: store.get().bibleToc !== false, pageEach: !!store.get().biblePage })), r => P.result('Printed ' + P.plural(r.entries, 'entry', 'entries') + ' · ' + WB.fmt.bytes(r.bytes), r.file));

    const hoBtn = ui.button({ label: 'Choose entry…', icon: '✉', kind: 'primary' });
    const ho = card({ icon: '✉', title: 'Handout', text: 'One entry as a printable A5 card for your table: its picture, summary, visible fields and text. Uses the audience above.', actions: [hoBtn] });
    const handout = async (entry) => run(ho, hoBtn, async () => {
      const e = entry || await WB.ui.pickEntry({ title: 'Print a handout of…' });
      if (!e) return null;
      return WB.api('publish.handout', e.id, { level: st.level === 'author' ? 'author' : st.level, asOf: st.asOf });
    }, r => P.result('Saved the handout', r.file));
    hoBtn.onclick = () => handout();
    outCards.push(pkg, vault, csv, json, pdf, ho);

    host.appendChild(h('div.pub-export', [scope, h('div.pub-cards', outCards)]));
    await refresh();
    const offs = [WB.onChange(['entries', 'types'], () => refresh(), 800)];
    const auto = { package: pkgBtn, vault: vaultBtn, csv: csvBtn, json: jsonBtn, pdf: pdfBtn, handout: hoBtn }[params.run];
    if (auto) setTimeout(() => auto.click(), 80);
    else if (params.entryId && params.run === 'handout-entry') setTimeout(() => handout({ id: params.entryId }), 80);
    return () => { alive = false; offs.forEach(f => f()); };
  };

  /* =============================== IMPORT =============================== */
  P.imports = async function (host, { params }) {
    const worldId = WB.worldId;
    const report = (r, { onUndo } = {}) => {
      const box = h('div.pub-report');
      const rows = Object.entries(r.byType || {}).map(([k, n]) => h('span.wb-badge', { text: n + ' ' + k }));
      GK.append(box, [
        h('div.pub-report-head', [h('span.pub-result-ico', { text: '✓' }), h('b', { text: 'Imported ' + P.plural(r.created, 'entry', 'entries') })]),
        rows.length ? h('div.wb-chips', rows) : null,
        r.parents ? h('div.gk-small', { text: P.plural(r.parents, 'entry', 'entries') + ' placed inside a parent' }) : null,
        r.links ? h('div.gk-small', { text: P.plural(r.links.resolved || 0, 'link') + ' became mentions' + (r.links.unresolvedCount ? ' · ' + r.links.unresolvedCount + ' pointed at notes that were not found' : '') }) : null,
        r.links && r.links.unresolved && r.links.unresolved.length ? h('details.pub-details', [h('summary.gk-small', { text: 'Links without a target (kept as text)' }), h('div.gk-small.gk-muted', { text: r.links.unresolved.join(', ') })]) : null,
        r.images && (r.images.copied || (r.images.missing || []).length) ? h('div.gk-small', { text: P.plural(r.images.copied || 0, 'image') + ' copied into the Library' + (r.images.missing && r.images.missing.length ? ' · ' + r.images.missing.length + ' not found: ' + r.images.missing.slice(0, 6).join(', ') : '') }) : null,
        r.fields ? h('div.gk-small', { text: P.plural(r.fields, 'field value') + ' filled' }) : null,
        r.unmatched && Object.keys(r.unmatched).length ? h('div.gk-small.gk-muted', { text: 'Kept in a note at the end of each entry (no matching field): ' + Object.keys(r.unmatched).slice(0, 12).join(', ') }) : null,
        r.unresolved && r.unresolved.length ? h('div.gk-small.gk-muted', { text: 'Not found by name: ' + r.unresolved.slice(0, 12).join(', ') }) : null,
        typeof r.skipped === 'number' && r.skipped ? h('div.gk-small.gk-muted', { text: P.plural(r.skipped, 'row') + ' without a name skipped' }) : null,
        h('div.gk-row', [
          r.ids && r.ids[0] ? ui.button({ label: 'Open in Codex', icon: '↗', small: true, onClick: () => WB.open(r.ids[0]) }) : null,
          onUndo ? ui.button({ label: 'Undo import', icon: '↶', small: true, kind: 'ghost', title: 'Move everything this import created to the trash', onClick: onUndo }) : null,
        ]),
      ]);
      return box;
    };
    const undo = ids => async () => {
      if (!(await ui.confirm('Undo this import?', P.plural(ids.length, 'entry', 'entries') + ' it created move to the trash. You can restore them from there.', 'Move to trash', true))) return;
      const r = await WB.api('publish.undoImport', ids);
      ui.toast(P.plural(r.n, 'entry', 'entries') + ' moved to the trash', '↶');
    };

    /* ---- world package ---- */
    const pkgBtn = ui.button({ label: 'Choose file…', icon: '⛁', kind: 'primary' });
    const pkg = card({ icon: '⛁', title: 'World package', text: 'A .wbworld file from Worldbuilder (yours or a co-author\'s). It becomes a new world next to this one; nothing here changes.', actions: [pkgBtn] });
    pkgBtn.onclick = async (ev, src) => {
      GK.clear(pkg._res);
      let pv;
      try { pv = await WB.api('publish.previewPackage', src || {}); } catch (e) { return pkg._res.appendChild(h('div.pub-error', { text: e.message })); }
      if (!pv) return;
      const name = ui.input({ value: pv.name });
      const go = ui.button({ label: 'Import as a new world', kind: 'primary', onClick: async () => {
        P.busy(go, true, 'Importing…');
        try {
          const w = await WB.api('publish.importPackage', pv.token, { name: name.value });
          GK.clear(pkg._res);
          pkg._res.append(P.result('Imported “' + w.name + '” as a new world', null), h('div.gk-row', [
            ui.button({ label: 'Open it', kind: 'primary', small: true, onClick: () => WB.switchWorld(w.id) }),
            ui.button({ label: 'Remove it', small: true, kind: 'ghost', onClick: async () => { if (await ui.confirm('Remove the imported world?', '“' + w.name + '” and everything in it is deleted (a backup is made first).', 'Remove', true)) { await WB.api('worlds.remove', w.id); GK.clear(pkg._res); ui.toast('Removed', '↶'); } } }),
          ]));
        } catch (e) { WB.fail(e); P.busy(go, false); }
      } });
      pkg._res.append(h('div.pub-preview-box', [
        h('div.pub-kv', [h('span', { text: 'World' }), h('b', { text: pv.name })]),
        pv.summary ? h('div.gk-small.gk-muted', { text: pv.summary }) : null,
        h('div.wb-chips', Object.entries(pv.byType).slice(0, 14).map(([k, n]) => h('span.wb-badge', { text: n + ' ' + k }))),
        h('div.gk-small.gk-muted', { text: [P.plural(pv.entries, 'entry', 'entries'), P.plural(pv.media, 'media file'), P.plural(pv.links, 'link'), pv.exportedAt ? 'exported ' + WB.fmt.real(pv.exportedAt.slice(0, 10)) : ''].filter(Boolean).join(' · ') }),
        P.field({ label: 'Name it', control: name }),
        h('div.gk-row', [go, ui.button({ label: 'Cancel', kind: 'ghost', onClick: () => GK.clear(pkg._res) })]),
      ]));
    };

    /* ---- Markdown vault ---- */
    const vaultBtn = ui.button({ label: 'Choose folder…', icon: '⇧', kind: 'primary' });
    const vault = card({ icon: 'M↓', title: 'Markdown or Obsidian vault', text: 'A folder of .md notes. Folders become types (or parents), front matter fills fields whose names match, [[links]] become mentions once every note exists, and images are copied into the Library.', actions: [vaultBtn] });
    let vplan = null;
    const typeOptions = () => WB.typeList().map(t => [t.key, t.icon + '  ' + t.name]);
    function paintVault() {
      GK.clear(vault._res);
      vault.classList.toggle('pub-card-wide', !!vplan);
      if (!vplan) return;
      const opts = { folderTypes: Object.assign({}, vplan.folderTypes), rootType: vplan.rootType, subfolders: vplan.subfolders !== false };
      const replan = async () => { vplan = Object.assign(await WB.api('publish.replanVault', worldId, vplan.token, opts), { subfolders: opts.subfolders }); paintVault(); };
      const rows = vplan.folders.map(f => h('div.pub-map-row', [h('span.gk-ellipsis', { text: '▸ ' + f.name, title: f.name }), h('span.gk-small.gk-muted', { text: P.plural(f.count, 'note') }), h('span.pub-arrow', { text: '→' }),
        ui.select({ value: f.type, options: typeOptions(), onChange: v => { opts.folderTypes[f.name] = v; replan(); } })]));
      if (vplan.rootNotes) rows.push(h('div.pub-map-row', [h('span', { text: 'Notes at the top' }), h('span.gk-small.gk-muted', { text: P.plural(vplan.rootNotes, 'note') }), h('span.pub-arrow', { text: '→' }), ui.select({ value: vplan.rootType, options: typeOptions(), onChange: v => { opts.rootType = v; replan(); } })]));
      const go = ui.button({ label: 'Import ' + P.plural(vplan.notes, 'note') + ' into “' + WB.world.name + '”', kind: 'primary', onClick: async () => {
        P.busy(go, true, 'Importing…');
        try {
          const r = await WB.api('publish.importVault', worldId, vplan.token, opts);
          vplan = null; GK.clear(vault._res);
          vault._res.appendChild(report(r, { onUndo: undo(r.ids) }));
        } catch (e) { WB.fail(e); P.busy(go, false); }
      } });
      vault._res.append(h('div.pub-preview-box', [
        h('div.gk-small', { text: [P.plural(vplan.notes, 'note'), P.plural(vplan.links, 'link'), P.plural(vplan.images, 'image'), vplan.embeds ? P.plural(vplan.embeds, 'embed') : ''].filter(Boolean).join(' · ') }),
        h('div.gk-small.gk-muted.pub-path', { text: vplan.dir, title: vplan.dir }),
        rows.length ? h('div.pub-map', [h('div.gk-tiny.gk-faint', { text: 'Each folder becomes a type' }), ...rows]) : null,
        check('Sub-folders become parent entries', opts.subfolders, v => { opts.subfolders = v; vplan.subfolders = v; }, 'Places/Saltmarch/Gullhaven.md goes inside “Saltmarch” (its folder note, or a new entry)'),
        vplan.keys.length ? h('div', [h('div.gk-tiny.gk-faint', { text: 'Front matter keys found (they fill fields with the same name; the rest is kept in a note on the entry)' }), h('div.wb-chips', vplan.keys.slice(0, 24).map(k => h('span.wb-tagchip', { text: k.key + ' · ' + k.count })))]) : null,
        vplan.sample.length ? h('div.pub-sample', vplan.sample.map(s => { const t = WB.type(s.type); return h('div.pub-sample-row', [h('span', { text: t ? t.icon : '◇', style: { color: t ? t.color : '' } }), h('span.gk-ellipsis', { text: s.title }), h('span.gk-tiny.gk-faint.gk-ellipsis', { text: s.rel })]); })) : null,
        h('div.gk-tiny.gk-faint', { text: 'A backup is made first. Undo moves every imported entry to the trash.' }),
        h('div.gk-row', [go, ui.button({ label: 'Cancel', kind: 'ghost', onClick: () => { vplan = null; paintVault(); } })]),
      ]));
    }
    vaultBtn.onclick = async (ev, src) => {
      try { const r = await WB.api('publish.scanVault', worldId, src || {}); if (r) { vplan = r; paintVault(); } } catch (e) { GK.clear(vault._res); vault._res.appendChild(h('div.pub-error', { text: e.message })); }
    };

    /* ---- CSV ---- */
    const csvBtn = ui.button({ label: 'Choose file…', icon: '▤', kind: 'primary' });
    const csv = card({ icon: '▤', title: 'CSV into a type', text: 'Rows of a spreadsheet become entries of one type. Pick which column holds the names and where the others go; links to other entries are found by name.', actions: [csvBtn] });
    let cplan = null;
    function targets(type) {
      const dl = type.dated || {};
      return [['', '— leave out —'], ['title', 'Name'], ['summary', 'Summary'], ['body', 'Text'], ['aliases', 'Also known as'], ['tags', 'Tags'], ['parent', 'Inside (parent name)'], ['audience', 'Audience']]
        .concat(type.dated ? [['start', dl.start || 'Start'], ['end', dl.end || 'End']] : [])
        .concat((type.fields || []).map(d => ['field:' + d.key, d.label + (d.kind === 'ref' || d.kind === 'refs' ? ' (by name)' : '')]));
    }
    function paintCsv() {
      GK.clear(csv._res);
      csv.classList.toggle('pub-card-wide', !!cplan);
      if (!cplan) return;
      const type = WB.types.get(cplan.typeId) || WB.typeList()[0];
      const typeSel = ui.select({ value: type.id, options: WB.typeList().map(t => [t.id, t.icon + '  ' + t.name]), onChange: async v => { cplan = await WB.api('publish.replanCsv', worldId, cplan.token, { typeId: v }); paintCsv(); } });
      const opts = targets(type);
      const map = cplan.mapping.slice();
      const repaintPreview = async () => { cplan = await WB.api('publish.replanCsv', worldId, cplan.token, { typeId: type.id, mapping: map }); paintCsv(); };
      const rows = cplan.header.map((col, i) => h('div.pub-map-row', [h('b.gk-ellipsis', { text: col || '(column ' + (i + 1) + ')', title: col }), h('span.gk-small.gk-muted.gk-ellipsis', { text: cplan.samples[i] || '—', title: cplan.samples[i] || '' }), h('span.pub-arrow', { text: '→' }),
        ui.select({ value: map[i] || '', options: opts, onChange: v => { if (v) for (let j = 0; j < map.length; j++) if (j !== i && map[j] === v) map[j] = ''; map[i] = v; repaintPreview(); } })]));
      const prevRows = cplan.preview.filter(r => r.title).slice(0, 5);
      const go = ui.button({ label: 'Import ' + P.plural(cplan.withTitle, 'row') + ' as ' + type.plural.toLowerCase(), kind: 'primary', disabled: !cplan.withTitle, onClick: async () => {
        P.busy(go, true, 'Importing…');
        try {
          const r = await WB.api('publish.importCsv', worldId, cplan.token, { typeId: type.id, mapping: map });
          cplan = null; GK.clear(csv._res);
          csv._res.appendChild(report(r, { onUndo: undo(r.ids) }));
        } catch (e) { WB.fail(e); P.busy(go, false); }
      } });
      csv._res.append(h('div.pub-preview-box', [
        h('div.gk-small', { text: cplan.name + ' · ' + P.plural(cplan.count, 'row') + ' · separated by ' + ({ ',': 'commas', ';': 'semicolons', '\t': 'tabs' }[cplan.delimiter] || 'commas') }),
        P.field({ label: 'Import as', control: typeSel }),
        h('div.pub-map', rows),
        map.includes('title') ? null : h('div.pub-error', { text: 'Choose which column holds the names.' }),
        prevRows.length ? h('div.pub-sample', [h('div.gk-tiny.gk-faint', { text: 'The first rows will become' })].concat(prevRows.map(r => h('div.pub-sample-row', [h('span', { text: type.icon, style: { color: type.color } }), h('b.gk-ellipsis', { text: r.title }),
          h('span.gk-tiny.gk-muted.gk-ellipsis', { text: Object.entries(r.fields).slice(0, 4).map(([k, v]) => ((type.fields || []).find(d => d.key === k) || { label: k }).label + ': ' + v).concat(r.summary ? [r.summary] : []).join(' · ') })])))) : null,
        h('div.gk-tiny.gk-faint', { text: 'A backup is made first. Undo moves every imported entry to the trash.' }),
        h('div.gk-row', [go, ui.button({ label: 'Cancel', kind: 'ghost', onClick: () => { cplan = null; paintCsv(); } })]),
      ]));
    }
    csvBtn.onclick = async (ev, src) => {
      try { const r = await WB.api('publish.scanCsv', worldId, src || {}); if (r) { cplan = r; paintCsv(); } } catch (e) { GK.clear(csv._res); csv._res.appendChild(h('div.pub-error', { text: e.message })); }
    };

    host.appendChild(h('div.pub-import', [
      h('p.gk-small.gk-muted.pub-lede', { text: 'Bring worlds and notes in from elsewhere. Every import shows a preview first; imports into this world make a backup and can be undone.' }),
      h('div.pub-cards', [pkg, vault, csv]),
    ]));
    // another screen (or a script) may hand over a path: { run: 'vault', dir } / { run: 'csv' | 'package', file }
    const auto = { package: pkgBtn, vault: vaultBtn, csv: csvBtn }[params.run];
    if (auto) setTimeout(() => (params.dir || params.file ? auto.onclick(null, { dir: params.dir, file: params.file }) : auto.click()), 80);
  };
})();
