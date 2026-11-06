/* Web → Matrix: pick a group (a faction's members, a family, a tag, a type or a hand-picked set) and see how every
   pair relates, read from the row's side. Click an empty cell to relate the pair, a filled one to change it. */
(function () {
  'use strict';
  const { h, ui } = GK, U = WB.ui;
  const P = WB.webParts;
  const MAX = 40;
  const SOURCES = [['members', 'Members of…'], ['family', 'Family of…'], ['tag', 'Tagged…'], ['type', 'Every…'], ['pick', 'Hand-picked']];

  P.matrix = async function mount(host, env) {
    const C = P.common;
    const all = Object.assign({}, env.store.get().matrix || {});
    const st = Object.assign({ source: 'members', ref: null, picks: [], links: true }, all[WB.worldId] || {});
    const save = () => { const m = Object.assign({}, env.store.get().matrix || {}); m[WB.worldId] = { source: st.source, ref: st.ref, picks: st.picks, links: st.links }; env.store.patch({ matrix: m }); };
    let rels = [], others = [], fam = null, members = [], alive = true, entries = [];
    const edit = C.editable();
    if (env.params && env.params.entryId) { st.source = 'pick'; st.picks = [env.params.entryId]; }

    const side = h('div.web-side');
    const grid = h('div.web-matrix-box');
    const stage = ui.panel({ material: 'solid', cls: 'web-stage web-matrix-stage', body: [grid] });
    const root = h('div.web-graph.web-matrix', [ui.panel({ cls: 'web-side-panel', body: [side] }), stage]);
    host.appendChild(root);

    async function load() {
      const wid = WB.worldId;
      const [r, l, f, list] = await Promise.all([WB.api('links.relations', wid), WB.api('links.all', wid, { kinds: ['mention', 'field'] }), WB.api('web.family', wid, C.audience()), WB.api('entries.list', wid, {})]);
      if (!alive) return;
      rels = r; others = l; fam = f; entries = list.filter(e => WB.visible(e));
      if (!st.ref && st.source === 'members') { const fa = bestFaction(); if (fa) st.ref = fa; }
      compute(); paintSide(); paint();
    }
    const byId = () => new Map(entries.map(e => [e.id, e]));
    function bestFaction() {
      const t = WB.type('faction'); if (!t) return null;
      const score = new Map();
      for (const x of rels) for (const id of [x.src, x.dst]) { const e = WB.liteOf(id); if (e && e.typeId === t.id) score.set(id, (score.get(id) || 0) + 1); }
      return [...score.entries()].sort((a, b) => b[1] - a[1]).map(x => x[0])[0] || (entries.find(e => e.typeId === t.id) || {}).id || null;
    }
    function compute() {
      const E = byId();
      let ids = [];
      if (st.source === 'members' && st.ref) {
        const set = new Set();
        for (const x of rels) {
          if (x.dst === st.ref && /member|leader|serves|vassal|spy/.test(x.name)) set.add(x.src);
          if (x.src === st.ref && /member|leader|serves|vassal|spy/.test(x.inverse)) set.add(x.dst);
        }
        for (const x of others) if (x.kind === 'field' && x.dst === st.ref) { const e = E.get(x.src); if (e && (WB.typeOf(e) || {}).key === 'character') set.add(x.src); }
        for (const e of entries) if (e.parentId === st.ref && (WB.typeOf(e) || {}).key === 'character') set.add(e.id);
        ids = [...set];
      } else if (st.source === 'family' && st.ref && fam) {
        const adj = new Map();
        const add = (a, b) => { if (!adj.has(a)) adj.set(a, []); adj.get(a).push(b); };
        for (const x of fam.parents) { add(x.parent, x.child); add(x.child, x.parent); }
        for (const x of fam.spouses.concat(fam.siblings)) { add(x.a, x.b); add(x.b, x.a); }
        const d = new Map([[st.ref, 0]]), q = [st.ref];
        while (q.length) { const x = q.shift(); if (d.get(x) >= 3) continue; for (const y of adj.get(x) || []) if (!d.has(y)) { d.set(y, d.get(x) + 1); q.push(y); } }
        ids = [...d.keys()];
      } else if (st.source === 'tag' && st.ref) ids = entries.filter(e => (e.tags || []).includes(st.ref)).map(e => e.id);
      else if (st.source === 'type' && st.ref) {
        const deg = new Map();
        for (const x of rels) { deg.set(x.src, (deg.get(x.src) || 0) + 1); deg.set(x.dst, (deg.get(x.dst) || 0) + 1); }
        ids = entries.filter(e => e.typeId === st.ref).sort((a, b) => (deg.get(b.id) || 0) - (deg.get(a.id) || 0)).map(e => e.id);
      } else if (st.source === 'pick') ids = st.picks.filter(id => E.has(id));
      if (st.source === 'members' && st.ref && E.has(st.ref) && !ids.includes(st.ref)) ids.unshift(st.ref);
      ids = ids.filter(id => E.has(id));
      members = ids.slice(0, MAX);
      members.over = ids.length - members.length;
    }

    function paintSide() {
      GK.clear(side);
      const sec = (title, body, extra) => h('section.web-sec', [h('div.web-sec-head', [h('h4', { text: title }), extra || null]), body]);
      const src = h('div.web-stack', [ui.select({ value: st.source, options: SOURCES, onChange: v => { st.source = v; st.ref = v === 'members' ? bestFaction() : null; save(); compute(); paintSide(); paint(); } })]);
      if (st.source === 'members') src.append(C.slot({ id: st.ref, placeholder: 'Choose a faction', title: 'Members of…', types: ['faction'], clear: false, onPick: e => { st.ref = e.id; save(); compute(); paintSide(); paint(); } }));
      if (st.source === 'family') src.append(C.slot({ id: st.ref, placeholder: 'Choose a person', title: 'Family of…', types: ['character'], clear: false, onPick: e => { st.ref = e.id; save(); compute(); paintSide(); paint(); } }));
      if (st.source === 'tag') src.append(WB.tags.length ? ui.select({ value: st.ref || '', options: [['', 'Choose a tag']].concat(WB.tags.map(t => [t.id, '#' + t.name + '  (' + t.count + ')'])), onChange: v => { st.ref = v || null; save(); compute(); paintSide(); paint(); } }) : h('p.gk-small.gk-muted', { text: 'No tags in this world yet.' }));
      if (st.source === 'type') src.append(ui.select({ value: st.ref || '', options: [['', 'Choose a type']].concat(WB.typeList().map(t => [t.id, t.icon + '  ' + t.plural])), onChange: v => { st.ref = v || null; save(); compute(); paintSide(); paint(); } }));
      side.append(sec('Who', src));
      const chips = h('div.wb-chips', members.map(id => U.chip(id, { size: 'sm', onRemove: st.source === 'pick' ? () => { st.picks = st.picks.filter(x => x !== id); save(); compute(); paintSide(); paint(); } : null })));
      side.append(sec(WB.fmt.plural(members.length, 'entry', 'entries'), h('div.web-stack', [
        members.length ? chips : h('p.gk-small.gk-muted', { text: 'Nobody yet.' }),
        members.over > 0 ? h('p.gk-tiny.gk-muted', { text: members.over + ' more not shown: a matrix reads best with up to ' + MAX + '.' }) : null,
        h('div.gk-row', [
          ui.button({ label: 'Add…', icon: '＋', small: true, title: 'Add entries by hand', onClick: async () => { const p = await U.pickEntry({ title: 'Add to the matrix', multi: true, exclude: members }); if (p && p.length) { st.picks = [...new Set((st.source === 'pick' ? st.picks : members).concat(p.map(x => x.id)))]; st.source = 'pick'; save(); compute(); paintSide(); paint(); } } }),
          st.source !== 'pick' && members.length ? ui.button({ label: 'Edit this set', small: true, kind: 'ghost', title: 'Start a hand-picked set from these', onClick: () => { st.picks = members.slice(); st.source = 'pick'; save(); compute(); paintSide(); paint(); } }) : null,
        ]),
      ])));
      side.append(sec('Show', h('label.web-toggle-row', [h('span.gk-grow', { text: 'Mentions & references as dots' }), ui.toggle({ value: st.links, onChange: v => { st.links = v; save(); paint(); } })])));
      // legend of the relation kinds in use
      const used = new Map();
      const set = new Set(members);
      for (const x of rels) if (set.has(x.src) && set.has(x.dst)) used.set(x.relId, x);
      if (used.size) side.append(sec('Key', h('div.web-legend', [...used.values()].map(x => h('div.web-legend-row', [h('span.web-catdot', { style: { '--c': x.color || C.CAT_COLOR[x.category] } }), h('span', { text: x.name + (x.inverse && x.inverse !== x.name ? ' / ' + x.inverse : '') })])))));
    }

    function paint() {
      GK.clear(grid);
      if (members.length < 2) {
        grid.appendChild(U.empty({ icon: '▦', title: st.source === 'members' && !st.ref ? 'Choose a faction' : 'Pick at least two entries', text: 'The matrix shows how each pair in a group stands to the other: allies and rivals in a court, a crew, a family, a party of adventurers.', actions: [ui.button({ label: 'Pick entries…', kind: 'primary', onClick: async () => { const p = await U.pickEntry({ title: 'Who goes in the matrix?', multi: true }); if (p && p.length) { st.picks = p.map(x => x.id); st.source = 'pick'; save(); compute(); paintSide(); paint(); } } })] }));
        return;
      }
      const n = members.length, set = new Set(members);
      const cell = new Map();
      const put = (a, b, v) => { const k = a + '|' + b; let x = cell.get(k); if (!x) cell.set(k, x = { rel: [], other: [] }); x[v.kind === 'relation' ? 'rel' : 'other'].push(v); };
      for (const x of rels) if (set.has(x.src) && set.has(x.dst)) { put(x.src, x.dst, Object.assign({ kind: 'relation' }, x)); put(x.dst, x.src, Object.assign({ kind: 'relation' }, x)); }
      if (st.links) for (const x of others) if (set.has(x.src) && set.has(x.dst) && x.src !== x.dst) { put(x.src, x.dst, x); put(x.dst, x.src, x); }
      let related = 0;
      for (let i = 0; i < n; i++) for (let j = i + 1; j < n; j++) if ((cell.get(members[i] + '|' + members[j]) || { rel: [] }).rel.length) related++;
      const box = h('div.web-matrix-grid', { style: { '--n': String(n) }, role: 'grid' });
      box.appendChild(h('div.web-mcorner.gk-small.gk-muted', { text: related + ' of ' + (n * (n - 1) / 2) + ' pairs related' }));
      members.forEach(id => box.appendChild(h('div.web-mcol', { title: WB.titleOf(id) }, [h('span.web-mcol-t', [h('span.web-mcol-ico', { text: WB.iconOf(WB.liteOf(id)), style: { color: WB.colorOf(WB.liteOf(id)) } }), WB.titleOf(id)])])));
      members.forEach((a, i) => {
        box.appendChild(h('div.web-mrow', [U.chip(a, { size: 'sm' })]));
        members.forEach((b, j) => {
          if (a === b) { box.appendChild(h('div.web-mcell.self')); return; }
          const x = cell.get(a + '|' + b) || { rel: [], other: [] };
          const el = h('div.web-mcell', { class: (x.rel.length ? 'has ' : '') + ((i + j) % 2 ? 'alt' : ''), tabindex: 0, role: 'gridcell', title: WB.titleOf(a) + ' → ' + WB.titleOf(b) });
          for (const r of x.rel.slice(0, 3)) el.appendChild(h('span.web-mpill', { style: { '--c': r.color || C.CAT_COLOR[r.category] }, text: C.relLabel(r, a) }));
          if (x.rel.length > 3) el.appendChild(h('span.gk-tiny.gk-muted', { text: '+' + (x.rel.length - 3) }));
          if (!x.rel.length && x.other.length) el.appendChild(h('span.web-mdot', { title: x.other.map(o => (o.src === a ? WB.titleOf(a) + ' ' + (o.kind === 'mention' ? 'mentions ' : (o.label || 'refers to') + ' → ') + WB.titleOf(b) : WB.titleOf(b) + ' ' + (o.kind === 'mention' ? 'mentions ' : (o.label || 'refers to') + ' → ') + WB.titleOf(a))).join('\n') }));
          if (!x.rel.length && edit) el.appendChild(h('span.web-mplus', { text: '+' }));
          el.addEventListener('click', ev => cellAction(a, b, x, el, ev));
          el.addEventListener('keydown', ev => { if (ev.key === 'Enter') cellAction(a, b, x, el, ev); });
          el.addEventListener('pointerenter', () => hl(i, j, true));
          el.addEventListener('pointerleave', () => hl(i, j, false));
          box.appendChild(el);
        });
      });
      grid.appendChild(box);
      function hl(i, j, on) { box.querySelectorAll('.web-mcol')[j].classList.toggle('hl', on); box.querySelectorAll('.web-mrow')[i].classList.toggle('hl', on); }
    }
    function cellAction(a, b, x, el, ev) {
      if (!x.rel.length) { if (edit) C.addRelation({ a, b }); return; }
      const items = x.rel.map(r => ({ label: WB.titleOf(a) + ' ' + C.relLabel(r, a) + ' ' + WB.titleOf(b) + (C.linkSpan(r) ? '  (' + C.linkSpan(r) + ')' : ''), icon: '●', sub: [
        { label: 'Show in the table', icon: '☰', onClick: () => env.go('relations', { entryId: a }) },
        edit ? { label: 'Delete', icon: '✕', danger: true, onClick: () => C.removeRelation(r) } : null,
      ].filter(Boolean) }));
      U.menu(items.concat(['-', edit ? { label: 'Add another relation…', icon: '＋', onClick: () => C.addRelation({ a, b }) } : null, { label: 'Show the connection in the graph', icon: '◉', onClick: () => env.go('graph', { path: [a, b] }) }]), el);
    }

    const reload = WB.debounce(() => load().catch(WB.fail), 150);
    const offs = [WB.onChange(['links', 'entries', 'tags', 'rel_types'], reload)];
    await load();
    return () => { alive = false; offs.forEach(f => f()); };
  };
})();
