/* Web → Family tree: ancestors above, descendants below, siblings beside, partners side by side (several marriages),
   lifespans and ages, add-a-relative buttons on every card, a kinship calculator, and the compact family snippet
   (familyMini) the entry page can embed. Relations with a family role drive everything: parent / spouse / sibling. */
(function () {
  'use strict';
  const { h, ui } = GK, U = WB.ui;
  const P = WB.webParts;
  const DEFAULTS = { up: 3, down: 3, siblings: true, sibFamilies: true, roots: {} };
  const SVG = 'http://www.w3.org/2000/svg';
  const sv = (tag, attrs) => { const el = document.createElementNS(SVG, tag); for (const k in attrs) el.setAttribute(k, attrs[k]); return el; };

  /* ---------------- the family as maps ---------------- */
  function index(f) {
    const people = new Map(f.people.filter(p => WB.visible(p)).map(p => [p.id, p]));
    const parents = new Map(), children = new Map(), spouses = new Map(), sibs = new Map();
    const push = (m, k, v) => { let a = m.get(k); if (!a) m.set(k, a = []); if (!a.some(x => (x.id || x) === (v.id || v))) a.push(v); };
    for (const r of f.parents) if (people.has(r.parent) && people.has(r.child)) { push(parents, r.child, r.parent); push(children, r.parent, r.child); }
    for (const r of f.spouses) if (people.has(r.a) && people.has(r.b)) { push(spouses, r.a, { id: r.b, link: r }); push(spouses, r.b, { id: r.a, link: r }); }
    for (const r of f.siblings) if (people.has(r.a) && people.has(r.b)) { push(sibs, r.a, { id: r.b, link: r }); push(sibs, r.b, { id: r.a, link: r }); }
    const born = id => { const p = people.get(id); return p && p.start ? p.start.day : Infinity; };
    const byBirth = (a, b) => born(a) - born(b) || String((people.get(a) || {}).title).localeCompare(String((people.get(b) || {}).title));
    for (const [k, v] of children) v.sort(byBirth);
    // fathers first, then by birth
    for (const [k, v] of parents) v.sort((a, b) => ((people.get(a) || {}).sex === 'm' ? -1 : 0) - ((people.get(b) || {}).sex === 'm' ? -1 : 0) || byBirth(a, b));
    for (const [k, v] of spouses) v.sort((a, b) => (a.link.start == null ? Infinity : a.link.start) - (b.link.start == null ? Infinity : b.link.start) || byBirth(a.id, b.id));
    const F = {
      people, byBirth,
      parentsOf: id => parents.get(id) || [], childrenOf: id => children.get(id) || [], spousesOf: id => spouses.get(id) || [], sibsOf: id => sibs.get(id) || [],
      links: f,
    };
    F.degree = id => F.parentsOf(id).length + F.childrenOf(id).length + F.spousesOf(id).length + F.sibsOf(id).length;
    F.spouseLink = (a, b) => (F.spousesOf(a).find(s => s.id === b) || {}).link || null;
    return F;
  }

  /* ---------------- layout: an hourglass around one person ---------------- */
  /** units in px: { CW, CH, GAP, SGAP, ROW } → { cards: [{ id, x, gen, root }], couples, families, bars } (x = left edge) */
  function layout(F, root, opt, u) {
    const seen = new Set();
    const couples = [], families = [], bars = [];
    const step = u.CW + u.SGAP;

    function down(id, gen, depth, withSpouses) {
      seen.add(id);
      const sp = withSpouses ? F.spousesOf(id).map(s => s.id).filter(s => !seen.has(s)) : [];
      sp.forEach(s => seen.add(s));
      const order = sp.length === 0 ? [id] : sp.length === 1 ? [id, sp[0]] : [sp[0], id].concat(sp.slice(1));
      for (const s of sp) couples.push({ a: id, b: s, link: F.spouseLink(id, s) });
      const kids = depth > 0 ? F.childrenOf(id).filter(c => !seen.has(c)) : [];
      const groups = new Map();
      for (const c of kids) { const ps = F.parentsOf(c); const g = order.find(x => x !== id && ps.includes(x)) || null; if (!groups.has(g)) groups.set(g, []); groups.get(g).push(c); }
      const gorder = order.map(x => (x === id ? null : x)).filter(g => groups.has(g));
      const blocks = [];
      for (const g of gorder) for (const c of groups.get(g)) { if (seen.has(c)) continue; blocks.push({ g, c, b: down(c, gen + 1, depth - 1, true) }); }
      const cw = order.length * u.CW + (order.length - 1) * u.SGAP;
      let cursor = 0;
      for (const bl of blocks) { bl.left = cursor; cursor += bl.b.w + u.GAP; }
      const kidsW = blocks.length ? cursor - u.GAP : 0;
      const idIdx = order.indexOf(id), centre = i => i * step + u.CW / 2;
      let coupleMid = cw / 2;
      if (gorder.length === 1) coupleMid = gorder[0] ? (centre(idIdx) + centre(order.indexOf(gorder[0]))) / 2 : centre(idIdx);
      const kidsMid = blocks.length ? (blocks[0].left + blocks[0].b.anchor + blocks[blocks.length - 1].left + blocks[blocks.length - 1].b.anchor) / 2 : coupleMid;
      const off = kidsMid - coupleMid, cl = Math.max(0, off), kl = Math.max(0, -off);
      const cards = order.map((x, i) => ({ id: x, x: cl + i * step, gen, spouseOf: x === id ? null : id }));
      for (const bl of blocks) for (const c of bl.b.cards) cards.push(Object.assign({}, c, { x: c.x + kl + bl.left }));
      for (const g of gorder) { const ks = blocks.filter(b => b.g === g).map(b => b.c); if (ks.length) families.push({ parents: g ? [id, g] : [id], kids: ks }); }
      return { w: Math.max(cl + cw, kl + kidsW), anchor: cl + centre(idIdx), cards };
    }
    /** the ancestry of a set of parents (1 or 2): { w, mid, cards } */
    function upFor(ps, gen, depth) {
      const bs = ps.map(p => up(p, gen, depth));
      const gap = bs.length === 2 ? u.SGAP : 0;
      const left1 = bs.length === 2 ? bs[0].w + gap : 0;
      const cards = bs[0].cards.slice();
      if (bs[1]) for (const c of bs[1].cards) cards.push(Object.assign({}, c, { x: c.x + left1 }));
      if (ps.length === 2) { const link = F.spouseLink(ps[0], ps[1]); couples.push({ a: ps[0], b: ps[1], link, co: !link }); }
      return { w: left1 + (bs[1] ? bs[1].w : 0) || bs[0].w, mid: bs.length === 2 ? (bs[0].anchor + left1 + bs[1].anchor) / 2 : bs[0].anchor, cards };
    }
    function up(id, gen, depth) {
      seen.add(id);
      const ps = depth > 1 ? F.parentsOf(id).filter(p => !seen.has(p)).slice(0, 2) : [];
      ps.forEach(p => seen.add(p));
      if (!ps.length) return { w: u.CW, anchor: u.CW / 2, cards: [{ id, x: 0, gen }] };
      const top = upFor(ps, gen - 1, depth - 1);
      families.push({ parents: ps, kids: [id] });
      const idLeft = top.mid - u.CW / 2, shift = idLeft < 0 ? -idLeft : 0;
      const cards = top.cards.map(c => Object.assign({}, c, { x: c.x + shift }));
      cards.push({ id, x: idLeft + shift, gen });
      return { w: Math.max(top.w + shift, idLeft + shift + u.CW), anchor: idLeft + shift + u.CW / 2, cards };
    }

    // the root's row: half-siblings (father's side), full siblings, half-siblings (mother's side), siblings without parents
    const rp = F.parentsOf(root).slice(0, 2);
    let full = [root], halfL = [], halfR = [], loose = [];
    if (opt.siblings) {
      const kidsOf = p => F.childrenOf(p);
      if (rp.length === 2) {
        full = kidsOf(rp[0]).filter(c => kidsOf(rp[1]).includes(c));
        halfL = kidsOf(rp[0]).filter(c => !full.includes(c));
        halfR = kidsOf(rp[1]).filter(c => !full.includes(c));
      } else if (rp.length === 1) full = kidsOf(rp[0]).slice();
      if (!full.includes(root)) full.push(root);
      loose = F.sibsOf(root).map(s => s.id).filter(s => !full.includes(s) && !halfL.includes(s) && !halfR.includes(s));
      full.sort(F.byBirth);
    }
    const row = [...halfL, ...full, ...halfR, ...loose];
    row.forEach(id => seen.add(id));
    rp.forEach(id => seen.add(id));
    const blocks = new Map();
    blocks.set(root, down(root, 0, opt.down, true));
    for (const id of row) if (id !== root) blocks.set(id, down(id, 0, opt.sibFamilies ? Math.min(opt.down, 2) : 0, opt.sibFamilies));
    let cursor = 0;
    const anchors = new Map(), cards = [];
    for (const id of row) { const b = blocks.get(id); for (const c of b.cards) cards.push(Object.assign({}, c, { x: c.x + cursor })); anchors.set(id, cursor + b.anchor); cursor += b.w + u.GAP; }
    cards.find(c => c.id === root).root = true;
    if (rp.length && opt.up > 0) {
      const top = upFor(rp, -1, opt.up);
      const fullIn = full.filter(id => anchors.has(id));
      const mid = (anchors.get(fullIn[0]) + anchors.get(fullIn[fullIn.length - 1])) / 2;
      const dx = mid - top.mid;
      for (const c of top.cards) cards.push(Object.assign({}, c, { x: c.x + dx }));
      families.push({ parents: rp, kids: fullIn });
      if (halfL.length) families.push({ parents: [rp[0]], kids: halfL, half: true });
      if (halfR.length) families.push({ parents: [rp[1]], kids: halfR, half: true });
    }
    if (loose.length) bars.push([root].concat(loose));
    // explicit siblings elsewhere in the row whose parents are not shown
    return { cards, couples, families, bars };
  }

  /* ---------------- dates & ages on a card ---------------- */
  function years(e) {
    if (!WB.cal) return '';
    const y = d => ({ day: d.day, min: null, prec: 'year' });
    if (e.start && e.end) return WB.cal.formatRange(y(e.start), y(e.end));
    if (e.start) return 'born ' + WB.fmt.date(y(e.start));
    if (e.end) return 'died ' + WB.fmt.date(y(e.end));
    return '';
  }
  const dead = e => !!e.end || /^(dead|deceased)$/i.test(e.status || '');
  function ageText(e) {
    const a = WB.fmt.age(e);
    if (a == null) return dead(e) ? 'deceased' : '';
    if (e.end && e.end.day <= WB.now.day) return 'died aged ' + a;
    return 'age ' + a;
  }

  /* ---------------- adding a relative ---------------- */
  const KIND_TEXT = { parent: 'a parent', child: 'a child', spouse: 'a partner', sibling: 'a brother or sister' };
  function addRelative(F, person, kind) {
    if (WB.share) { ui.toast('Leave Share view to add relatives', '◑'); return Promise.resolve(null); }
    const C = P.common, p = F.people.get(person) || WB.liteOf(person) || { id: person, title: WB.titleOf(person) };
    const rels = { parent: C.familyRel('parent'), spouse: C.familyRel('spouse'), sibling: C.familyRel('sibling') };
    if (!rels.parent || !rels.spouse) { ui.toast('This world has no parent / spouse relation types. Add them in World → Relation types.', '⚠', 5200); return Promise.resolve(null); }
    return new Promise(resolve => {
      let mode = 'new', existing = null, given = '', start = null, end = null, married = null, done = false;
      const fam = C.surname(p.title);
      let useFam = !!fam && kind !== 'spouse';
      const spousesNow = F.spousesOf(person).map(s => s.id);
      const parentsNow = F.parentsOf(person);
      let other = kind === 'child' && spousesNow.length === 1 ? spousesNow[0] : '';
      let marryParent = kind === 'parent' && parentsNow.length === 1;
      const finish = v => { if (done) return; done = true; scrim.remove(); document.removeEventListener('keydown', onKey, true); resolve(v); };
      const nameIn = ui.input({ placeholder: 'Given name', onInput: v => { given = v; } });
      const famBox = fam ? h('label.web-check-row', [ui.toggle({ value: useFam, onChange: v => { useFam = v; } }), h('span', { text: 'Family name “' + fam + '”' })]) : null;
      const ptype = WB.types.get(p.typeId) || WB.type('character');
      let pron = '';
      const pronBox = ptype && (ptype.fields || []).some(f => f.key === 'pronouns')
        ? ui.field({ label: 'Pronouns', hint: 'Lets the kinship calculator say “aunt” or “uncle” instead of “aunt/uncle”.', control: ui.segmented({ value: '', options: [['', '—'], ['he/him', 'he'], ['she/her', 'she'], ['they/them', 'they']], onChange: v => { pron = v; } }) }) : null;
      const sugg = h('div.wb-chips.web-name-sugg');
      const roll = () => {
        GK.clear(sugg);
        const style = (WB.world.settings && WB.world.settings.nameStyle) || 'common';
        const list = WB.names.generate({ style, kind: 'person', count: 6, seed: Math.random(), avoid: WB.titles.map(t => t.title) });
        list.forEach(n => sugg.appendChild(ui.chip({ label: n, onClick: () => { nameIn.value = given = n; nameIn.focus(); } })));
      };
      const whoBox = h('div.web-stack');
      const pickBtn = ui.button({ label: 'Choose someone…', icon: '⌕', onClick: async () => { const e = await U.pickEntry({ title: 'Choose ' + KIND_TEXT[kind] + ' of ' + p.title, types: [p.typeId].filter(Boolean), exclude: [person] }); if (e) { existing = e.id; paintWho(); } } });
      const paintWho = () => {
        GK.clear(whoBox);
        if (mode === 'new') GK.append(whoBox, [
          ui.field({ label: 'Name', control: h('div.gk-row.nowrap', [h('div.gk-grow', [nameIn]), ui.button({ icon: '🎲', kind: 'ghost', title: 'Suggest names', onClick: roll })]) }), famBox, sugg, pronBox,
          h('div.wb-daterange', [ui.field({ label: 'Born', control: U.dateInput({ value: start, onChange: v => { start = v; } }) }), ui.field({ label: 'Died', control: U.dateInput({ value: end, onChange: v => { end = v; } }) })])]);
        else whoBox.append(existing ? h('div.gk-row.nowrap', [U.chip(existing), pickBtn]) : pickBtn);
      };
      const extra = h('div.web-stack');
      if (kind === 'child' && spousesNow.length) extra.append(ui.field({ label: 'Other parent', control: ui.select({ value: other, options: spousesNow.map(s => [s, WB.titleOf(s) || (F.people.get(s) || {}).title]).concat([['', 'Unknown or someone else']]), onChange: v => { other = v; } }) }));
      if (kind === 'parent' && parentsNow.length === 1) extra.append(h('label.web-check-row', [ui.toggle({ value: marryParent, onChange: v => { marryParent = v; } }), h('span', { text: 'Married to ' + ((F.people.get(parentsNow[0]) || {}).title || 'the other parent') })]));
      if (kind === 'spouse') extra.append(ui.field({ label: 'Married', hint: 'Optional', control: U.dateInput({ value: married, onChange: v => { married = v; } }) }));
      if (kind === 'sibling') extra.append(h('p.gk-small.gk-muted', { text: parentsNow.length ? 'They will share ' + parentsNow.map(x => (F.people.get(x) || {}).title).join(' and ') + (parentsNow.length > 1 ? ' as parents.' : ' as a parent.') : 'No parents are recorded yet, so they are linked as siblings directly.' }));
      async function create() {
        const made = [];
        try {
          let rid = existing, createdEntry = null;
          if (mode === 'new') {
            const name = (given.trim() || 'Unnamed') + (useFam && fam && !new RegExp('\\b' + fam + '$', 'i').test(given.trim()) ? ' ' + fam : '');
            createdEntry = await WB.api('entries.create', { worldId: WB.worldId, typeId: p.typeId || (WB.type('character') || {}).id, title: name, start, end, fields: pron ? { pronouns: pron } : {} });
            rid = createdEntry.id;
          }
          if (!rid) return;
          const rel = async o => made.push(await WB.api('links.relate', o));
          if (kind === 'parent') { await rel({ src: rid, dst: person, relId: rels.parent.id }); if (marryParent && parentsNow[0]) await rel({ src: parentsNow[0], dst: rid, relId: rels.spouse.id }); }
          if (kind === 'child') { await rel({ src: person, dst: rid, relId: rels.parent.id }); if (other) await rel({ src: other, dst: rid, relId: rels.parent.id }); }
          if (kind === 'spouse') await rel({ src: person, dst: rid, relId: rels.spouse.id, start: married });
          if (kind === 'sibling') {
            if (parentsNow.length) for (const par of parentsNow) await rel({ src: par, dst: rid, relId: rels.parent.id });
            else if (rels.sibling) await rel({ src: person, dst: rid, relId: rels.sibling.id });
          }
          finish(rid);
          const t = WB.titleOf(rid) || (createdEntry && createdEntry.title) || 'them';
          U.undoToast((createdEntry ? 'Added “' + createdEntry.title + '”' : 'Linked “' + t + '”') + ' as ' + KIND_TEXT[kind] + ' of ' + p.title, async () => {
            if (createdEntry) await WB.api('entries.purge', createdEntry.id);
            else for (const l of made) await WB.api('links.remove', l.id);
          });
        } catch (e) { WB.fail(e); for (const l of made) WB.api('links.remove', l.id).catch(() => {}); }
      }
      const panel = ui.panel({ title: 'Add ' + KIND_TEXT[kind] + ' of ' + p.title, icon: { parent: '⇡', child: '⇣', spouse: '⚭', sibling: '⇹' }[kind], cls: 'gk-dialog web-relative-dialog', body: [
        ui.segmented({ value: mode, options: [['new', 'Someone new'], ['existing', 'Someone who exists']], onChange: v => { mode = v; paintWho(); if (v === 'existing' && !existing) pickBtn.click(); else setTimeout(() => nameIn.focus(), 20); } }),
        whoBox, extra,
      ] });
      panel.appendChild(h('div.gk-panel-foot', [h('span.gk-small.gk-muted.gk-grow', [U.kbd('Enter'), ' add']), ui.button({ label: 'Cancel', onClick: () => finish(null) }), ui.button({ label: 'Add', kind: 'primary', onClick: create })]));
      const scrim = h('div.gk-scrim', { onclick: e => { if (e.target === scrim) finish(null); } }, [panel]);
      const onKey = e => { if (e.key === 'Escape' && !document.querySelector('.wb-pop')) { e.stopPropagation(); finish(null); } else if (e.key === 'Enter' && !e.target.closest('.wb-date, button')) { e.preventDefault(); create(); } };
      document.addEventListener('keydown', onKey, true);
      document.body.appendChild(scrim);
      paintWho();
      setTimeout(() => nameIn.focus(), 40);
    });
  }

  /* ---------------- the view ---------------- */
  P.family = async function mount(host, env) {
    const C = P.common;
    const st = Object.assign({}, DEFAULTS, env.store.get().family || {});
    const save = () => env.store.patch({ family: { up: st.up, down: st.down, siblings: st.siblings, sibFamilies: st.sibFamilies, roots: st.roots } });
    let F = null, root = null, selected = null, kin = { a: null, b: null, res: null }, alive = true;
    const view = { x: 0, y: 0, k: 1 }, size = { w: 0, h: 0 };
    let fitted = false;

    const surface = h('div.web-fam-surface');
    const svg = sv('svg', { class: 'web-fam-lines' });
    surface.appendChild(svg);
    const viewport = h('div.web-fam-view', { tabindex: 0, 'aria-label': 'Family tree. Drag to pan, wheel to zoom.' }, [surface]);
    const zoomBar = h('div.web-zoombar', [
      ui.button({ icon: '−', small: true, title: 'Zoom out (−)', onClick: () => zoomBy(1 / 1.25) }),
      ui.button({ icon: '⊡', small: true, title: 'Fit the tree (0)', onClick: () => fit(true) }),
      ui.button({ icon: '+', small: true, title: 'Zoom in (+)', onClick: () => zoomBy(1.25) }),
    ]);
    const empty = h('div.web-banner', { hidden: true });
    const wrap = h('div.web-canvas-wrap.web-fam-wrap', [viewport, empty, zoomBar]);
    const stage = ui.panel({ material: 'solid', cls: 'web-stage', body: [wrap] });
    const side = h('div.web-side');
    const rootEl = h('div.web-graph.web-family', [ui.panel({ cls: 'web-side-panel', body: [side] }), stage]);
    host.appendChild(rootEl);

    /* ---- units from the text size ---- */
    const units = () => { const fs = parseFloat(getComputedStyle(viewport).fontSize) || 14; return { fs, CW: 14 * fs, CH: 5.2 * fs, GAP: 1.3 * fs, SGAP: 2.6 * fs, ROW: 4.6 * fs }; };

    async function load() {
      const f = await WB.api('web.family', WB.worldId, C.audience());
      if (!alive) return;
      F = index(f);
      const p = env.params || {};
      const stored = st.roots[WB.worldId];
      const best = () => [...F.people.keys()].sort((a, b) => F.degree(b) - F.degree(a))[0] || null;
      if (!root) {
        root = (p.entryId && (F.people.has(p.entryId) || WB.liteOf(p.entryId)) ? p.entryId : null) || (stored && (F.people.has(stored) || WB.liteOf(stored)) ? stored : null) || best();
        if (root && root !== stored) { st.roots = Object.assign({}, st.roots, { [WB.worldId]: root }); save(); }
      }
      if (p.kin && !kin.a) { kin.a = p.kin[0]; kin.b = p.kin[1]; }
      if (!kin.a) kin.a = root;
      render();
      paintSide();
      if (kin.a && kin.b) calcKin();
    }

    /* ---- drawing ---- */
    let cardsById = new Map(), lines = [];
    function render() {
      GK.clear(svg); [...surface.querySelectorAll('.web-card, .web-ring, .web-gen')].forEach(x => x.remove());
      cardsById = new Map(); lines = [];
      empty.hidden = true; zoomBar.hidden = !root;
      if (!root) {
        empty.hidden = false; GK.clear(empty);
        empty.append(U.empty({ icon: '⚭', title: 'No family trees yet', text: 'Choose a person to start, then add parents, partners, children and siblings with the buttons on their card. Relations with a family role (parent of, spouse of, sibling of) all show up here.', actions: [
          ui.button({ label: 'Choose a person', kind: 'primary', icon: '⌕', onClick: choosePerson }),
          !WB.share ? ui.button({ label: 'New character', icon: '＋', onClick: async () => { const e = await U.createDialog({ type: 'character', open: false }); if (e) setRoot(e.id); } }) : null,
        ] }));
        return;
      }
      const u = units();
      const solo = !F.people.has(root);
      const L = solo ? { cards: [{ id: root, x: 0, gen: 0, root: true }], couples: [], families: [], bars: [] } : layout(F, root, st, u);
      const minX = Math.min(...L.cards.map(c => c.x)), gens = L.cards.map(c => c.gen), minGen = Math.min(...gens), maxGen = Math.max(...gens);
      const padL = 7.5 * u.fs, padT = 2.5 * u.fs;
      const X = c => c.x - minX + padL, Y = g => (g - minGen) * (u.CH + u.ROW) + padT;
      const pos = new Map(L.cards.map(c => [c.id, { x: X(c), y: Y(c.gen), c }]));
      const W = Math.max(...L.cards.map(c => X(c))) + u.CW + 3 * u.fs, H = Y(maxGen) + u.CH + 3 * u.fs;
      size.w = W; size.h = H;
      surface.style.width = W + 'px'; surface.style.height = H + 'px';
      svg.setAttribute('width', W); svg.setAttribute('height', H); svg.setAttribute('viewBox', '0 0 ' + W + ' ' + H);
      // generation labels (rows below say "children" only when they hold nobody but the person's own line and partners)
      const memo = new Map([[root, true]]);
      const isDesc = (x, depth = 0) => { if (memo.has(x)) return memo.get(x); memo.set(x, false); const v = depth < 40 && F.parentsOf(x).some(p => pos.has(p) && isDesc(p, depth + 1)); memo.set(x, v); return v; };
      const own = g => L.cards.filter(c => c.gen === g).every(c => isDesc(c.spouseOf || c.id));
      const down = g => (own(g) ? (g === 1 ? 'Children' : g === 2 ? 'Grandchildren' : g === 3 ? 'Great-grandchildren' : (g - 2) + '× great-grandchildren') : g === 1 ? 'Next generation' : g + ' generations down');
      const genName = g => (g === 0 ? '' : g === -1 ? 'Parents' : g === -2 ? 'Grandparents' : g < 0 ? (g === -3 ? 'Great-grandparents' : (-g - 2) + '× great-grandparents') : down(g));
      for (let g = minGen; g <= maxGen; g++) if (genName(g)) surface.appendChild(h('div.web-gen', { text: genName(g), style: { top: (Y(g) + u.CH / 2) + 'px', left: '0px', width: (padL - u.fs) + 'px' } }));
      // marriages and co-parents
      for (const cp of L.couples) {
        const a = pos.get(cp.a), b = pos.get(cp.b);
        if (!a || !b) continue;
        const [l, r] = a.x < b.x ? [a, b] : [b, a];
        const y = l.y + u.CH / 2, x1 = l.x + u.CW, x2 = r.x;
        const ended = cp.link && cp.link.end != null;
        line('M' + x1 + ',' + y + 'H' + x2, 'web-marriage' + (cp.co ? ' co' : '') + (ended ? ' ended' : ''), [cp.a, cp.b]);
        if (!cp.co) ring((x1 + x2) / 2, y, cp, ended);
      }
      // parents → children
      const busCount = new Map();
      for (const fam of L.families) {
        const ps = fam.parents.map(id => pos.get(id)).filter(Boolean), ks = fam.kids.map(id => pos.get(id)).filter(Boolean);
        if (!ps.length || !ks.length) continue;
        let sx, sy;
        if (ps.length === 2 && ps[0].y === ps[1].y) { const [l, r] = ps[0].x < ps[1].x ? ps : [ps[1], ps[0]]; sx = (l.x + u.CW + r.x) / 2; sy = l.y + u.CH / 2; }
        else { sx = ps[0].x + u.CW / 2; sy = ps[0].y + u.CH; }
        const rowY = ks[0].y, n = busCount.get(rowY) || 0; busCount.set(rowY, n + 1);
        const busY = rowY - u.ROW * (0.5 - 0.12 * ((n % 3) - 1)) ;
        // a stem from the parents, then one branch per child (so a highlighted line follows exactly one child)
        const cls = 'web-descent' + (fam.half ? ' half' : '');
        line('M' + sx + ',' + sy + 'V' + busY, cls, fam.parents.concat(fam.kids), fam);
        fam.kids.forEach((id, i) => { const k = pos.get(id); if (k) line('M' + sx + ',' + busY + 'H' + (k.x + u.CW / 2) + 'V' + k.y, cls, fam.parents.concat([id]), fam); });
      }
      for (const bar of L.bars) {
        const ps = bar.map(id => pos.get(id)).filter(Boolean);
        if (ps.length < 2) continue;
        const y = ps[0].y - u.ROW * 0.35, xs = ps.map(p => p.x + u.CW / 2);
        let d = 'M' + Math.min(...xs) + ',' + y + 'H' + Math.max(...xs);
        for (const x of xs) d += 'M' + x + ',' + y + 'V' + ps[0].y;
        line(d, 'web-sibbar', bar);
      }
      // cards
      const shown = new Set(pos.keys());
      for (const [id, p] of pos) surface.appendChild(card(id, p, u, shown));
      if (!fitted || !viewport.clientWidth) { fitted = !!viewport.clientWidth; initialView(); } else apply();
      paintKinPath();
      paintSelected();
    }
    function line(d, cls, ids, fam) { const el = svg.appendChild(sv('path', { d, class: cls })); lines.push({ el, ids: new Set(ids), fam }); return el; }
    function ring(x, y, cp, ended) {
      const span = cp.link ? C.linkSpan(cp.link) : '';
      const b = h('button.web-ring', { type: 'button', class: ended ? 'ended' : '', text: '⚭', title: 'Married' + (span ? ' ' + span : '') + (ended ? ' (ended)' : '') + (cp.link && cp.link.note ? '\n' + cp.link.note : '') + (WB.share ? '' : '\nClick to edit'), style: { left: x + 'px', top: y + 'px' } });
      b.addEventListener('click', ev => { ev.stopPropagation(); if (!WB.share && cp.link) marriageMenu(cp, b); });
      b.addEventListener('pointerdown', ev => ev.stopPropagation());
      surface.appendChild(b);
    }
    function marriageMenu(cp, anchor) {
      const link = cp.link;
      const body = h('div.web-stack.web-marriage-pop', [
        h('b', { text: WB.titleOf(cp.a) + ' & ' + WB.titleOf(cp.b) }),
        h('div.wb-daterange', [
          ui.field({ label: 'Married', control: U.dateInput({ value: C.dayDate(link.start), onChange: v => WB.api('links.update', link.id, { start: v }).catch(WB.fail) }) }),
          ui.field({ label: 'Ended', control: U.dateInput({ value: C.dayDate(link.end), onChange: v => WB.api('links.update', link.id, { end: v }).catch(WB.fail) }) }),
        ]),
        ui.field({ label: 'Note', control: ui.input({ value: link.note || '', placeholder: 'How it began, how it ended…', onChange: v => WB.api('links.update', link.id, { note: v }).catch(WB.fail) }) }),
        h('div.gk-row', [h('span.gk-grow'), ui.button({ label: 'Remove marriage', small: true, kind: 'danger', onClick: () => { pop.close(); C.removeRelation({ id: link.id, src: link.a, dst: link.b, relId: link.relId, note: link.note, startDay: link.start, endDay: link.end }).catch(WB.fail); } })]),
      ]);
      const pop = U.popover(anchor, body, { width: '22em', group: 'marriage' });
    }
    function card(id, p, u, shown) {
      const e = (F && F.people.get(id)) || WB.liteOf(id) || { id, title: WB.titleOf(id) || '…' };
      const t = WB.typeOf(e);
      const isDead = dead(e), age = ageText(e), yrs = years(e);
      const more = !!F && (F.parentsOf(id).some(x => !shown.has(x)) || F.childrenOf(id).some(x => !shown.has(x)) || F.spousesOf(id).some(s => !shown.has(s.id)));
      const avatar = e.coverId ? U.thumb(e.coverId, { cls: 'web-card-img' }) : h('span.web-card-ico', { text: WB.iconOf(e) });
      const name = h('a.web-card-name.gk-ellipsis', { href: '#', text: e.title, title: 'Open ' + e.title + ' (Ctrl+click to peek)' });
      name.addEventListener('click', ev => { ev.preventDefault(); ev.stopPropagation(); if (ev.ctrlKey || ev.metaKey) WB.peek(id); else WB.open(id); });
      const el = h('div.web-card', { tabindex: 0, class: (p.c.root ? 'root ' : '') + (isDead ? 'dead ' : '') + (p.c.spouseOf ? 'spouse ' : ''), dataset: { id }, style: { left: p.x + 'px', top: p.y + 'px', width: u.CW + 'px', height: u.CH + 'px', '--c': WB.colorOf(e) } }, [
        h('div.web-card-av', [avatar]),
        h('div.web-card-main', [
          name,
          h('div.web-card-sub.gk-ellipsis', { text: yrs || (t ? t.name : ''), title: WB.fmt.span(e) || '' }),
          age || e.occupation ? h('div.web-card-age.gk-ellipsis', { text: [age, e.occupation].filter(Boolean).join(' · '), title: e.occupation || '' }) : null,
        ]),
        isDead ? h('span.web-card-dead', { text: '†', title: 'Died' + (e.end ? ' ' + WB.fmt.date(e.end) : '') }) : null,
        more && !p.c.root ? h('button.web-card-more', { type: 'button', text: '⇡', title: 'Show the family of ' + e.title, onclick: ev => { ev.stopPropagation(); setRoot(id); } }) : null,
      ]);
      el.addEventListener('click', ev => { if (ev.target.closest('a, button')) return; if (ev.ctrlKey || ev.metaKey) return WB.peek(id); selectCard(id); });
      el.addEventListener('dblclick', ev => { if (ev.target.closest('a, button')) return; setRoot(id); });
      el.addEventListener('keydown', ev => { if (ev.key === 'Enter') WB.open(id); else if (ev.key === ' ') { ev.preventDefault(); selectCard(id); } });
      el.addEventListener('contextmenu', ev => { ev.preventDefault(); U.entryMenu(e, ev, ['-', { label: 'Centre the tree here', icon: '◎', onClick: () => setRoot(id) }, { label: 'Kinship with ' + WB.titleOf(root), icon: '⚯', onClick: () => setKin(root, id) }].concat(WB.share ? [] : [{ label: 'Add a relative', icon: '＋', sub: ['parent', 'child', 'spouse', 'sibling'].map(k => ({ label: KIND_TEXT[k].replace(/^a /, '').replace(/^\w/, c => c.toUpperCase()), onClick: () => addRel(id, k) })) }])); });
      el.addEventListener('pointerdown', ev => ev.stopPropagation());
      cardsById.set(id, el);
      return el;
    }
    function selectCard(id) { selected = selected === id ? null : id; paintSelected(); }
    function paintSelected() {
      surface.querySelectorAll('.web-card-acts').forEach(x => x.remove());
      surface.querySelectorAll('.web-card.sel').forEach(x => x.classList.remove('sel'));
      lines.forEach(l => l.el.classList.toggle('lit', !!selected && l.ids.has(selected)));
      const el = selected && cardsById.get(selected);
      if (!el) return;
      el.classList.add('sel');
      const id = selected;
      const acts = h('div.web-card-acts', [
        ...(WB.share ? [] : [['parent', 'Parent'], ['spouse', 'Partner'], ['child', 'Child'], ['sibling', 'Sibling']].map(([k, l]) => ui.button({ label: l, icon: '+', small: true, title: 'Add ' + KIND_TEXT[k] + ' of ' + WB.titleOf(id), onClick: () => addRel(id, k) }))),
        id !== root ? ui.button({ label: 'Centre', small: true, kind: 'ghost', title: 'Centre the tree on ' + WB.titleOf(id) + ' (double-click the card)', onClick: () => setRoot(id) }) : null,
        id !== root ? ui.button({ label: 'Kinship', small: true, kind: 'ghost', title: 'How is ' + WB.titleOf(id) + ' related to ' + WB.titleOf(root) + '?', onClick: () => setKin(id, root) }) : null,
      ]);
      acts.style.left = el.style.left; acts.style.top = (parseFloat(el.style.top) - 6) + 'px';
      acts.addEventListener('pointerdown', ev => ev.stopPropagation());
      surface.appendChild(acts);
    }
    async function addRel(id, kind) {
      const rid = await addRelative(F || index({ people: [], parents: [], spouses: [], siblings: [] }), id, kind);
      if (rid) { selected = id; }
    }
    function setRoot(id) {
      root = id; selected = null; fitted = false;
      st.roots = Object.assign({}, st.roots, { [WB.worldId]: id }); save();
      if (!kin.b) kin.a = id;
      render(); paintSide();
    }
    async function choosePerson() { const e = await U.pickEntry({ title: 'Family tree of…', types: [(WB.type('character') || {}).id].filter(Boolean) }); if (e) setRoot(e.id); }

    /* ---- pan & zoom ---- */
    function apply() { surface.style.transform = 'translate(' + view.x + 'px,' + view.y + 'px) scale(' + view.k + ')'; }
    function fit(animate) {
      const vw = viewport.clientWidth, vh = viewport.clientHeight;
      if (!vw || !size.w) return;
      const k = Math.max(0.2, Math.min(1.15, Math.min((vw - 24) / size.w, (vh - 24) / size.h)));
      setView({ k, x: (vw - size.w * k) / 2, y: Math.max(12, (vh - size.h * k) / 2) }, animate);
    }
    function initialView() {
      const vw = viewport.clientWidth, vh = viewport.clientHeight;
      if (!vw) return;
      const k = Math.min((vw - 24) / size.w, (vh - 24) / size.h);
      if (k >= 0.62) return fit(false);
      const el = cardsById.get(root);
      const kk = 0.8, cx = parseFloat(el.style.left) + el.offsetWidth / 2, cy = parseFloat(el.style.top) + el.offsetHeight / 2;
      setView({ k: kk, x: vw / 2 - cx * kk, y: vh / 2 - cy * kk });
    }
    function setView(t, animate) {
      if (!animate) { Object.assign(view, t); apply(); return; }
      surface.classList.add('glide'); Object.assign(view, t); apply();
      setTimeout(() => surface.classList.remove('glide'), 320);
    }
    function zoomBy(f, cx, cy) {
      const vw = viewport.clientWidth, vh = viewport.clientHeight;
      if (cx == null) { cx = vw / 2; cy = vh / 2; }
      const k = Math.max(0.15, Math.min(2.5, view.k * f));
      const wx = (cx - view.x) / view.k, wy = (cy - view.y) / view.k;
      view.k = k; view.x = cx - wx * k; view.y = cy - wy * k; apply();
    }
    let drag = null;
    viewport.addEventListener('pointerdown', ev => {
      if (ev.button !== 0) return;
      const p = C.local(viewport, ev);
      drag = { x: p.x, y: p.y, vx: view.x, vy: view.y, moved: false };
      viewport.setPointerCapture(ev.pointerId);
    });
    viewport.addEventListener('pointermove', ev => {
      if (!drag) return;
      const p = C.local(viewport, ev), dx = p.x - drag.x, dy = p.y - drag.y;
      if (!drag.moved && Math.hypot(dx, dy) < 3) return;
      drag.moved = true; viewport.classList.add('panning');
      view.x = drag.vx + dx; view.y = drag.vy + dy; apply();
    });
    const end = () => { if (drag && !drag.moved) { selected = null; paintSelected(); } drag = null; viewport.classList.remove('panning'); };
    viewport.addEventListener('pointerup', end);
    viewport.addEventListener('pointercancel', end);
    viewport.addEventListener('wheel', ev => { ev.preventDefault(); const p = C.local(viewport, ev); zoomBy(Math.exp(-ev.deltaY * (ev.ctrlKey ? 0.004 : 0.0015)), p.x, p.y); }, { passive: false });
    viewport.addEventListener('dblclick', ev => { if (!ev.target.closest('.web-card, .web-ring, .web-card-acts')) fit(true); });
    viewport.addEventListener('keydown', ev => {
      if (ev.target !== viewport) return;
      const k = ev.key;
      if (k === '+' || k === '=') zoomBy(1.2); else if (k === '-') zoomBy(1 / 1.2); else if (k === '0') fit(true);
      else if (k.startsWith('Arrow')) { view.x += k === 'ArrowLeft' ? 60 : k === 'ArrowRight' ? -60 : 0; view.y += k === 'ArrowUp' ? 60 : k === 'ArrowDown' ? -60 : 0; apply(); }
      else if (k === 'Escape') { selected = null; paintSelected(); }
      else return;
      ev.preventDefault();
    });
    const ro = new ResizeObserver(() => { if (!fitted && viewport.clientWidth && root) { fitted = true; initialView(); } });
    ro.observe(viewport);

    /* ---- kinship ---- */
    function setKin(a, b) { kin = { a, b, res: null }; paintSide(); calcKin(); }
    async function calcKin() {
      if (!kin.a || !kin.b) { kin.res = null; paintKin(); paintKinPath(); return; }
      try { kin.res = await WB.web.kinship(kin.a, kin.b); } catch (e) { kin.res = null; WB.fail(e); }
      paintKin(); paintKinPath();
    }
    function paintKinPath() {
      const ids = new Set(kin.res && kin.res.path ? kin.res.path.map(s => s.id) : []);
      for (const [id, el] of cardsById) el.classList.toggle('on-path', ids.has(id));
      lines.forEach(l => { let n = 0; for (const id of l.ids) if (ids.has(id)) n++; l.el.classList.toggle('on-path', n >= 2); });
    }
    const kinBox = h('div.web-kin');
    function paintKin() {
      GK.clear(kinBox);
      const r = kin.res;
      if (!kin.a || !kin.b) { kinBox.append(h('p.gk-small.gk-muted.web-hint', { text: 'Pick two people to see how they are related — “second cousin once removed”, “great-aunt”, “half-brother”, “sister-in-law”…' })); return; }
      if (!r) { kinBox.append(h('p.gk-small.gk-muted', { text: 'Working it out…' })); return; }
      GK.append(kinBox, [
        r.label ? h('div.web-kin-label', { text: r.label }) : h('div.web-kin-label.none', { text: 'not related' }),
        h('p.web-kin-text', { text: r.text }),
        r.inverseText && r.label ? h('p.gk-small.gk-muted.web-kin-back', { text: r.inverseText }) : null,
        r.explain ? h('p.gk-small.web-kin-explain', { text: r.explain }) : null,
        r.path && r.path.length > 1 ? h('ol.web-steps.web-kin-steps', r.path.map((s, i) => h('li.web-step', [h('span.web-step-n', { text: String(i + 1) }), U.chip(s.id, { size: 'sm' }), s.as ? h('span.gk-tiny.gk-muted', { text: i === 0 ? '' : '← ' + s.as + ' of ' + r.path[i - 1].title }) : null]))) : null,
        r.path && r.path.length > 1 && r.path.some(s => !cardsById.has(s.id)) ? ui.button({ label: 'Show them in the tree', small: true, onClick: () => { const top = (r.common && r.common[0]) || kin.a; st.up = Math.max(st.up, 3); setRoot(top); } }) : null,
      ]);
    }

    /* ---- side panel ---- */
    function paintSide() {
      GK.clear(side);
      const sec = (title, body, extra) => h('section.web-sec', [h('div.web-sec-head', [h('h4', { text: title }), extra || null]), body]);
      const person = C.slot({ id: root, placeholder: 'Choose a person', title: 'Family tree of…', types: ['character'], clear: false, onPick: e => setRoot(e.id) });
      side.append(sec('Family of', h('div.web-stack', [person, root ? h('p.gk-tiny.gk-muted.web-hint', { text: 'Click a card for its buttons · double-click to centre on it · click a name to open it.' }) : null])));
      const stepper = (label, key, max) => h('div.web-stepper', [h('span.gk-grow.gk-small', { text: label }),
        ui.button({ icon: '−', small: true, kind: 'ghost', title: 'Fewer', disabled: st[key] <= 0, onClick: () => { st[key] = Math.max(0, st[key] - 1); save(); fitted = false; render(); paintSide(); } }),
        h('b.web-stepper-n', { text: String(st[key]) }),
        ui.button({ icon: '+', small: true, kind: 'ghost', title: 'More', disabled: st[key] >= max, onClick: () => { st[key] = Math.min(max, st[key] + 1); save(); fitted = false; render(); paintSide(); } })]);
      side.append(sec('Generations', h('div.web-stack', [
        stepper('Ancestors', 'up', 8), stepper('Descendants', 'down', 8),
        h('label.web-toggle-row', [h('span.gk-grow', { text: 'Brothers & sisters' }), ui.toggle({ value: st.siblings, onChange: v => { st.siblings = v; save(); render(); } })]),
        h('label.web-toggle-row', [h('span.gk-grow', { text: 'Their partners & children' }), ui.toggle({ value: st.sibFamilies, onChange: v => { st.sibFamilies = v; save(); render(); } })]),
      ])));
      const slotA = C.slot({ id: kin.a, placeholder: 'First person', title: 'How is…', types: ['character'], onPick: e => { kin.a = e && e.id; kin.res = null; calcKin(); } });
      const slotB = C.slot({ id: kin.b, placeholder: 'Second person', title: '…related to', types: ['character'], onPick: e => { kin.b = e && e.id; kin.res = null; calcKin(); } });
      side.append(sec('Kinship', h('div.web-stack', [C.ends(slotA, slotB, 'How is', 'related to', () => setKin(kin.b, kin.a)), kinBox])));
      paintKin();
      side.append(sec('Key', h('div.web-legend', [
        h('div.web-legend-row', [h('span.web-legend-card'), h('span', { text: 'Living' })]),
        h('div.web-legend-row', [h('span.web-legend-card.dead', { text: '†' }), h('span', { text: 'Deceased' })]),
        h('div.web-legend-row', [svgSample('web-marriage'), h('span', { text: 'Married' })]),
        h('div.web-legend-row', [svgSample('web-marriage ended'), h('span', { text: 'Marriage ended' })]),
        h('div.web-legend-row', [svgSample('web-marriage co'), h('span', { text: 'Parents, not married' })]),
        h('div.web-legend-row', [svgSample('web-descent half'), h('span', { text: 'Half-siblings' })]),
      ])));
    }
    function svgSample(cls) { const s = sv('svg', { width: 34, height: 10, class: 'web-legend-line' }); s.appendChild(sv('path', { d: 'M1,5H33', class: cls })); return s; }

    /* ---- live ---- */
    const reload = WB.debounce(() => load().catch(WB.fail), 180);
    const offs = [WB.onChange(['entries', 'links', 'rel_types'], reload), GK.bus.on('layout', () => { if (root) apply(); })];
    await load();
    P.familyApi = { setRoot, setKin, fit };
    return () => { alive = false; ro.disconnect(); offs.forEach(f => f()); P.familyApi = null; };
  };

  /* ---------------- the compact snippet for an entry page ---------------- */
  P.familyMini = async function (container, id) {
    const f = await WB.api('web.family', WB.worldId, P.common.audience());
    const F = index(f);
    GK.clear(container);
    const parents = F.parentsOf(id), kids = F.childrenOf(id), sps = F.spousesOf(id);
    const sib = new Map();
    for (const p of parents) for (const c of F.childrenOf(p)) if (c !== id) sib.set(c, (sib.get(c) || 0) + 1);
    for (const s of F.sibsOf(id)) if (!sib.has(s.id)) sib.set(s.id, parents.length || 1);
    const any = parents.length || kids.length || sps.length || sib.size;
    const e = WB.liteOf(id);
    const isPerson = e && (WB.typeOf(e) || {}).key === 'character';
    if (!any && !isPerson) return false;
    const row = (label, list) => (list.length ? h('div.web-mini-row', [h('span.web-mini-label.gk-small.gk-muted', { text: label }), h('div.wb-chips', list)]) : null);
    const chip = x => U.chip(x, { size: 'sm' });
    const box = h('div.web-mini', [
      row('Parents', parents.map(chip)),
      row(sps.length > 1 ? 'Partners' : 'Partner', sps.map(s => { const span = P.common.linkSpan(s.link); const c = chip(s.id); return span ? h('span.web-mini-sp', [c, h('span.gk-tiny.gk-faint', { text: span })]) : c; })),
      row('Siblings', [...sib.entries()].sort((a, b) => F.byBirth(a[0], b[0])).map(([s, n]) => (parents.length >= 2 && n < 2 ? h('span.web-mini-sp', [chip(s), h('span.gk-tiny.gk-faint', { text: 'half' })]) : chip(s)))),
      row('Children', kids.map(chip)),
      !any ? h('p.gk-small.gk-muted', { text: 'No family recorded yet.' }) : null,
      h('div.gk-row.web-mini-foot', [
        any ? ui.button({ label: 'Family tree', icon: '⚭', small: true, onClick: () => WB.web.open('family', { entryId: id }) }) : null,
        !WB.share && isPerson ? ui.button({ label: 'Add a relative', icon: '＋', small: true, kind: 'ghost', onClick: ev => U.menu(['parent', 'spouse', 'child', 'sibling'].map(k => ({ label: KIND_TEXT[k].replace(/^a /, '').replace(/^\w/, c => c.toUpperCase()), icon: { parent: '⇡', child: '⇣', spouse: '⚭', sibling: '⇹' }[k], onClick: () => addRelative(F, id, k) })), ev.currentTarget || ev) }) : null,
      ]),
    ]);
    container.appendChild(box);
    return !!any;
  };
  P.addRelative = (id, kind) => WB.api('web.family', WB.worldId, P.common.audience()).then(f => addRelative(index(f), id, kind));
})();
