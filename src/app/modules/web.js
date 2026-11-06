/* Web: how everything connects — a graph of every entry and link, family trees with a kinship calculator, the table
   of relations and a relationship matrix. The views live in src/app/modules/web/ and load on first use. */
(function () {
  'use strict';
  const { h, ui } = GK;
  const PARTS = ['algo', 'force', 'common', 'graph', 'family', 'relations', 'matrix'];
  let ready = null;
  const loadAll = () => ready || (ready = PARTS.reduce((p, n) => p.then(() => WB.loadScript('src/app/modules/web/' + n + '.js')), Promise.resolve()).catch(e => { ready = null; throw e; }));
  const TABS = [
    ['graph', '◉ Graph', 'Every entry and link (Alt+1)'],
    ['family', '⚭ Family tree', 'Ancestors, descendants and kinship (Alt+2)'],
    ['relations', '☰ Relations', 'Every relation in a table (Alt+3)'],
    ['matrix', '▦ Matrix', 'How each pair in a group relates (Alt+4)'],
  ];
  const DEFAULTS = { tab: 'graph', graph: {}, pins: {}, family: {}, relations: {}, matrix: {} };
  const aud = () => (WB.share ? { audience: 'shared', asOf: WB.now.day } : {});
  const charType = () => { const t = WB.type('character'); return t ? [t.id] : []; };

  /* ---------------- what other screens may use ---------------- */
  WB.web = {
    /** how a is related to b: { label, text, explain, path: [{ id, title, as }], inverse, kind } */
    kinship: (a, b) => WB.api('web.kinship', WB.worldId, a, b, aud()),
    /** a compact family snippet (parents, partners, siblings, children) for an entry page; resolves true when there is family to show */
    familyMini: async (container, entryId) => { await loadAll(); return WB.webParts.familyMini(container, entryId); },
    /** the "new relation" dialog: { a, b, relId, swap } → link | null */
    addRelation: async (opts) => { await loadAll(); return WB.webParts.common.addRelation(opts || {}); },
    /** the "add a relative" dialog for a person: kind 'parent' | 'child' | 'spouse' | 'sibling' → new relative's id | null */
    addRelative: async (entryId, kind) => { await loadAll(); return WB.webParts.addRelative(entryId, kind); },
    /** open a view: 'graph' | 'family' | 'relations' | 'matrix', with { entryId, focus, path: [a, b], kin: [a, b] } */
    open: (tab, params) => WB.go('web', Object.assign({ tab }, params || {})),
  };

  GK.modules.register({
    id: 'web',
    title: 'Web',
    icon: '☍',
    order: 60,
    subtitle: 'How everything connects: graph, family trees and relations.',
    async mount(page, ctx) {
      if (!WB.worldId) {
        page.appendChild(WB.ui.empty({ icon: '☍', title: 'No world open', text: 'The web shows how the entries of a world connect: who is related to whom, what mentions what.', actions: [ui.button({ label: 'Create a world', kind: 'primary', onClick: () => WB.newWorld() })] }));
        return;
      }
      let alive = true, cleanup = null, seq = 0;
      const store = WB.store ? await WB.store(ctx, DEFAULTS) : await ctx.store(DEFAULTS);
      const params = WB.params('web') || {};
      let tab = params.tab || (params.kin ? 'family' : '') || store.get().tab || 'graph';
      if (!TABS.some(t => t[0] === tab)) tab = 'graph';
      const head = page.querySelector('.gk-page-head');
      const seg = ui.segmented({ value: tab, options: TABS, onChange: v => show(v) });
      seg.classList.add('web-tabs');
      (head || page).appendChild(seg);
      const host = page.appendChild(h('div.web-host'));
      try { await loadAll(); } catch (e) { host.appendChild(WB.ui.empty({ icon: '⚠', title: 'The web could not load', text: e.message })); return; }

      async function show(t, p) {
        const my = ++seq;
        tab = t; store.patch({ tab: t });
        seg.querySelectorAll('button').forEach((b, i) => b.classList.toggle('on', TABS[i][0] === t));
        if (cleanup) { try { cleanup(); } catch (e) { console.error(e); } cleanup = null; }
        GK.clear(host);
        host.dataset.tab = t;
        const env = { store, ctx, params: p || {}, go: (t2, p2) => show(t2, p2) };
        try {
          const c = await WB.webParts[t](host, env);
          if (!alive || my !== seq) { if (typeof c === 'function') c(); return; }
          cleanup = typeof c === 'function' ? c : null;
        } catch (e) {
          console.error(e);
          if (alive && my === seq) host.appendChild(ui.panel({ title: 'This view failed to load', icon: '⚠', body: h('pre.gk-small', { text: String(e && e.stack || e) }) }));
        }
      }
      await show(tab, params);
      const keys = e => {
        if (!e.altKey || e.ctrlKey || !page.isConnected) return;
        const i = ['1', '2', '3', '4'].indexOf(e.key);
        if (i >= 0) { e.preventDefault(); show(TABS[i][0]); }
      };
      document.addEventListener('keydown', keys);
      const reworld = WB.debounce(() => { if (alive && page.isConnected) show(tab); }, 180);
      const offs = [WB.on('world', reworld)];
      return () => { alive = false; reworld.cancel(); offs.forEach(f => f()); document.removeEventListener('keydown', keys); if (cleanup) { try { cleanup(); } catch (e) { console.error(e); } } cleanup = null; };
    },
  });

  /* ---------------- palette ---------------- */
  const has = () => !!WB.worldId;
  WB.commands && [
    { id: 'web:graph', label: 'Web: the graph of everything', icon: '☍', group: 'Web', words: 'links connections network map of entries', run: () => WB.web.open('graph') },
    { id: 'web:focus', label: 'Show an entry’s connections…', icon: '◎', group: 'Web', words: 'focus ego neighbours graph', run: async () => { const e = await WB.ui.pickEntry({ title: 'Show the connections of…' }); if (e) WB.web.open('graph', { focus: e.id }); } },
    { id: 'web:path', label: 'Find the connection between…', icon: '⇝', group: 'Web', words: 'path how is connected related link between two', run: async () => {
      const a = await WB.ui.pickEntry({ title: 'How is…' }); if (!a) return;
      const b = await WB.ui.pickEntry({ title: 'How is “' + a.title + '” connected to…', exclude: [a.id] }); if (!b) return;
      WB.web.open('graph', { path: [a.id, b.id] });
    } },
    { id: 'web:family', label: 'Family tree of…', icon: '⚭', group: 'Web', words: 'genealogy ancestors descendants pedigree', run: async () => { const e = await WB.ui.pickEntry({ title: 'Family tree of…', types: charType() }); if (e) WB.web.open('family', { entryId: e.id }); } },
    { id: 'web:kin', label: 'How are two people related? (kinship)', icon: '⚯', group: 'Web', words: 'kinship cousin uncle aunt relative calculator', run: async () => {
      const a = await WB.ui.pickEntry({ title: 'How is…', types: charType() }); if (!a) return;
      const b = await WB.ui.pickEntry({ title: '…related to', types: charType(), exclude: [a.id] }); if (!b) return;
      WB.web.open('family', { entryId: a.id, kin: [a.id, b.id] });
    } },
    { id: 'web:relations', label: 'Relations table', icon: '☰', group: 'Web', words: 'relationships list edit', run: () => WB.web.open('relations') },
    { id: 'web:relate', label: 'Add a relation…', icon: '☍', group: 'Web', words: 'relate link new relationship', when: () => has() && !WB.share, run: () => WB.web.addRelation({}) },
    { id: 'web:matrix', label: 'Relationship matrix', icon: '▦', group: 'Web', words: 'grid pairs faction members who relates to whom', run: () => WB.web.open('matrix') },
  ].forEach(c => WB.commands.add(Object.assign({ when: has }, c)));

  /* ---------------- smoke ---------------- */
  const results = {};
  const until = async (fn, ms = 4000) => { const t0 = Date.now(); while (Date.now() - t0 < ms) { const v = fn(); if (v) return v; await WB.wait(80); } return fn(); };
  WB.smoke('web-graph', async () => {
    await WB.web.open('graph');
    const s = await until(() => { const x = WB.webParts && WB.webParts.graphState && WB.webParts.graphState(); return x && x.nodes ? x : null; });
    await WB.wait(900);
    const x = WB.webParts.graphState();
    results.graph = x;
    if (!x || !x.finite) return 'error: the graph has no finite layout ' + JSON.stringify(x);
    return Object.assign({ ok: true }, x, { waited: !!s });
  });
  WB.smoke('web-family', async () => {
    const f = await WB.api('web.family', WB.worldId);
    const count = new Map();
    for (const r of f.parents) { count.set(r.parent, (count.get(r.parent) || 0) + 2); count.set(r.child, (count.get(r.child) || 0) + 1); }
    for (const r of f.spouses) { count.set(r.a, (count.get(r.a) || 0) + 1); count.set(r.b, (count.get(r.b) || 0) + 1); }
    const who = [...count.entries()].sort((a, b) => b[1] - a[1])[0];
    await WB.web.open('family', who ? { entryId: who[0] } : {});
    await until(() => document.querySelector('.web-card, .web-family .wb-empty'), 3000);
    await WB.wait(500);
    const cards = document.querySelectorAll('.web-card').length;
    results.family = { people: f.people.length, cards };
    // House Vey (when the example has it): a granddaughter and an uncle
    const titles = new Map(WB.titles.map(t => [t.title.toLowerCase().split(' ')[0], t.id]));
    if (titles.get('wren') && titles.get('brannoc')) results.kin = await WB.web.kinship(titles.get('wren'), titles.get('brannoc'));
    if (f.people.length && !cards) return 'error: no family cards drawn';
    return results.family;
  });
  WB.smoke('web-relations', async () => {
    await WB.web.open('relations');
    const rels = await WB.api('links.relations', WB.worldId);
    await until(() => document.querySelector('.web-rtable .web-rrow, .web-relations .wb-empty'), 3000);
    const rows = document.querySelectorAll('.web-rtable .web-rrow:not(.web-rhead)').length;
    results.relations = { relations: rels.length, rows };
    if (rels.length && !rows) return 'error: the relations table is empty';
    return results.relations;
  });
  WB.smoke('web-matrix', async () => {
    await WB.web.open('matrix');
    await until(() => document.querySelector('.web-matrix-grid, .web-matrix .wb-empty'), 3000);
    return { cells: document.querySelectorAll('.web-mcell').length };
  });
  WB.check('web: graph laid out (finite positions)', () => !results.graph || (results.graph.finite && results.graph.nodes > 0));
  WB.check('web: family tree draws the people it has', () => !results.family || !results.family.people || results.family.cards > 0);
  WB.check('web: relations table lists every relation', () => !results.relations || results.relations.rows >= Math.min(results.relations.relations, 150));
  WB.check('web: kinship names a granddaughter or grandson', () => !results.kin || /^grand/.test(results.kin.label || ''));
})();
