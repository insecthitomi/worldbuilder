/* Toolkit · generators: the list, a workspace (options, re-roll all or one part, lock parts, seed, history, copy,
   create entries) with a rich preview for towns (stats, map, demographics, every section), and WB.gen.open's dialog. */
(function () {
  'use strict';
  const GK = window.GK, WB = window.WB, h = GK.h, ui = GK.ui, TK = WB.toolkit;
  const G = () => window.WBGen;
  const GROUPS = ['Places', 'People', 'Story', 'Things', 'World', 'Beliefs', 'More'];
  const BAR = ['#5fa8d3', '#e0a050', '#7cc08a', '#c98bd9', '#e07a6b', '#9aa5b1', '#d6c25a'];

  /* ---------------- section rendering ---------------- */
  const secret = (text, label) => (WB.share ? null : h('div.tl-secret', [h('span.tl-secret-tag', { text: label || '◐ secret' }), h('span', { text })]));
  function kv(rows) { return h('dl.tl-kv', rows.map(([k, v]) => [h('dt', { text: k }), h('dd', { text: v })]).flat()); }
  function bars(groups, title) {
    return h('div.tl-bars', [title ? h('div.gk-tiny.gk-muted.tl-bars-title', { text: title }) : null,
      h('div.tl-bar-track', groups.map((g, i) => h('span.tl-bar-seg', { title: g.label + ' ' + g.pct + '%', style: { flexGrow: String(Math.max(0.5, g.pct)), '--c': BAR[i % BAR.length] } }))),
      h('div.tl-bar-legend', groups.map((g, i) => h('span.tl-bar-key', { style: { '--c': BAR[i % BAR.length] } }, [h('i'), g.label + ' ', h('b', { text: g.pct + '%' })])))]);
  }
  function itemRows(items, { numbered } = {}) {
    return h('div.tl-items', items.map((x, i) => h('div.tl-item', [
      numbered ? h('span.tl-num', { text: String(i + 1) }) : x.icon ? h('span.tl-item-ico', { text: x.icon }) : null,
      h('div.tl-item-main', [
        h('div.tl-item-title', [h('b', { text: x.title }), x.price ? h('span.tl-price', { text: x.price }) : null]),
        x.sub ? h('div.tl-item-sub.gk-small.gk-muted', { text: x.sub }) : null,
        x.text ? h('div.tl-item-text.gk-small', { text: x.text }) : null,
        x.secret ? secret(x.secret) : null,
      ]),
    ])));
  }
  function sectionBody(s, res) {
    const v = s.value;
    if (s.secret) return WB.share ? h('p.gk-small.gk-faint', { text: 'Hidden in Share view.' }) : secret(String(v));
    if (s.kind === 'text') return h('p.tl-text', { text: v });
    if (s.kind === 'list') {
      if (res && res.id === 'names') return h('div.wb-chips.tl-names', v.map(n => ui.chip({ label: n, title: 'Copy or create', onClick: e => nameMenu(n, res, e) })));
      return h('ul.tl-list', v.map(x => h('li', { text: x })));
    }
    if (s.kind === 'kv') return kv(v);
    if (s.kind === 'items') return itemRows(v);
    if (s.kind === 'bars') return bars(v);
    return h('p', { text: typeof v === 'string' ? v : JSON.stringify(v) });
  }
  function nameMenu(n, res, e) {
    WB.ui.menu([
      { label: 'Copy “' + n + '”', icon: '⎘', onClick: () => TK.copy(n, 'Name') },
      WB.share ? null : { label: 'New character “' + n + '”', icon: '☺', onClick: () => WB.ui.createDialog({ type: 'character', title: n }) },
      WB.share ? null : { label: 'New place “' + n + '”', icon: '⌂', onClick: () => WB.ui.createDialog({ type: 'place', title: n }) },
    ], e);
  }

  /* ---------------- the town preview ---------------- */
  function renderTown(res, ctl) {
    const d = res.data, sec = k => res.sections.find(s => s.key === k);
    const T = G().town;
    const stat = (label, value, note) => h('div.tl-stat', [h('div.tl-stat-label', { text: label }), h('div.tl-stat-value', { text: value }), note ? h('div.tl-stat-note', { text: note }) : null]);
    const badge = (t, tip) => h('span.wb-badge.tl-badge', { text: t, title: tip || '' });
    const hero = h('section.gk-widget.tl-town-hero', [
      h('div.tl-town-head', [
        h('div.gk-grow', [
          h('div.tl-town-kicker', { text: [d.sizeLabel, T.TERRAINS[d.terrain].label, res.opts.cultureTitle].filter(Boolean).join(' · ') }),
          h('div.tl-town-titlerow', [h('h2.tl-town-name', { text: d.name }), ctl.tools('name', 'name')]),
          h('p.tl-town-tag', { text: res.summary }),
          h('div.tl-badges', [badge(d.wealthLabel, 'Wealth'), badge(d.govLabel, 'Government'), badge(T.MAGIC[d.magic] === 'No magic' ? 'No magic' : 'Magic: ' + T.MAGIC[d.magic].toLowerCase()), badge(T.TECH[d.tech])]),
        ]),
      ]),
      h('div.tl-town-stats', [
        stat('Population', G().num(d.population), G().num(d.households) + ' households'),
        stat('Founded', d.foundedText || (d.foundedYears + ' years ago'), d.foundedText ? d.foundedYears + ' years ago' : ''),
        stat('Districts', String(d.districts.length)),
        stat('Locations', String(d.locations.length)),
        stat('Defences', d.walls ? (d.walls === 2 ? 'Two walls' : d.wallKind === 'palisade' ? 'Palisade' : 'Stone walls') : 'Unwalled', G().num(d.defences.guards) + ' guards'),
      ]),
    ]);
    // the map
    const img = h('img.tl-town-img', { alt: 'Map of ' + d.name, draggable: false });
    if (d.map) img.src = ctl.url(d.map.svg);
    const mapCard = TK.card({ title: 'Town map', icon: '⌖', cls: 'tl-town-map', sub: d.map ? G().num(d.map.buildings) + ' buildings · numbers match the locations' : '',
      actions: [ctl.tools('map', 'map'), ui.button({ icon: '⤢', small: true, kind: 'ghost', title: 'Look closer', onClick: () => lightbox(img.src, 'Map of ' + d.name) }),
        WB.share ? null : ui.button({ icon: '▣', small: true, kind: 'ghost', title: 'Save the map image to the Library', onClick: async () => { await WB.api('media.save', WB.worldId, { name: 'Map of ' + d.name + '.svg', mime: 'image/svg+xml', base64: btoa(unescape(encodeURIComponent(d.map.svg))) }); ui.toast('Saved to the Library', '▣'); } })],
      body: h('button.tl-town-mapbtn', { type: 'button', title: 'Look closer', onclick: () => lightbox(img.src, 'Map of ' + d.name) }, [img]) });
    const over = TK.card({ title: 'Overview', icon: '¶', actions: [ctl.tools('overview', 'overview')], cls: 'tl-town-over', body: [h('p.tl-text.tl-lead', { text: d.overview })] });
    const demo = TK.card({ title: 'Demographics', icon: '☷', actions: [ctl.tools('demographics', 'demographics')], cls: 'tl-town-demo',
      body: [bars(d.demo.peoples, (res.opts.peoples || []).length ? 'Peoples' : 'Where they come from'), bars(d.demo.classes, 'Classes'), bars(d.demo.ages, 'Ages')] });
    const card = (key, icon, body, extra) => { const s = sec(key); return s ? TK.card(Object.assign({ title: s.label, icon, actions: [ctl.tools(key, s.label)], body }, extra || {})) : null; };
    const govBody = () => [kv(sec('government').value.filter(([k]) => k !== 'Leader')),
      h('div.tl-person', [h('span.tl-person-ico', { text: '♛' }), h('div', [h('b', { text: d.leader.title + ' ' + d.leader.name }), h('div.gk-small', { text: G().cap(d.leader.trait) + '. Wants ' + d.leader.want + '.' }), h('div.gk-small.gk-muted', { text: G().cap(d.leader.look) }), secret(G().cap(d.leader.secret) + '.')])])];
    const grid = h('div.tl-town-grid', [
      card('districts', '▦', h('div.tl-items', d.districts.map(x => h('div.tl-item', [h('span.tl-item-ico', { text: '◈' }), h('div.tl-item-main', [h('b', { text: x.name }), h('div.gk-small.gk-muted', { text: x.label + ' quarter' }), h('div.gk-small', { text: x.desc })])])))),
      card('locations', '⌂', h('div.tl-items', d.locations.map((l, i) => h('div.tl-item', [h('span.tl-num', { text: String(i + 1), title: 'Number ' + (i + 1) + ' on the map' }), h('div.tl-item-main', [
        h('div.tl-item-title', [h('span.tl-loc-ico', { text: l.icon }), h('b', { text: l.name })]), h('div.gk-small.gk-muted', { text: l.label + ' · ' + G().cap(l.owner.title) + ' ' + l.owner.name + (d.districts.length > 1 ? ' · ' + d.districts[l.district].name : '') }),
        h('div.gk-small', { text: l.desc + '.' }), secret(l.hook + '.', '◐ hook')])]))), { cls: 'tl-wide' }),
      card('residents', '☺', h('div.tl-items', d.residents.map(r => h('div.tl-item', [h('span.tl-item-ico', { text: '☺' }), h('div.tl-item-main', [h('b', { text: r.name }), h('div.gk-small.gk-muted', { text: G().cap([r.age, r.people && r.people.toLowerCase(), r.job].filter(Boolean).join(' ')) }),
        h('div.gk-small', { text: G().cap(r.trait) + '. Wants ' + r.want + '.' + (r.haunt >= 0 ? ' Often at ' + d.locations[r.haunt].name + '.' : '') }), secret(G().cap(r.secret) + '.')])])))),
      card('government', '♛', govBody()),
      card('economy', '⚖', kv(sec('economy').value)),
      card('defences', '⛨', kv(sec('defences').value.filter(([k]) => k !== 'Weakness').concat([])), { }),
      card('hooks', '⚑', h('div.tl-items', d.problems.map(p => h('div.tl-item', [h('span.tl-item-ico.warn', { text: '⚠' }), h('div.tl-item-main', [h('div.gk-small', { text: p + '.' })])]))
        .concat(d.rumours.map(r => h('div.tl-item', [h('span.tl-item-ico', { text: '❝' }), h('div.tl-item-main', [h('div.gk-small', { text: '“' + r.text + '.”' }), secret(r.truth === 'true' ? 'True.' : r.truth === 'false' ? 'False.' : 'Partly true.', '◐ truth')])]))))),
      card('festivals', '✺', itemRows(d.festivals.map(f => ({ title: f.name, sub: G().cap(f.when), text: f.desc + '.' })))),
      card('laws', '§', h('ul.tl-list', d.laws.concat(d.customs).map(x => h('li', { text: x })))),
    ].filter(Boolean));
    // the defences' weakness is the GM's secret
    const defCard = [...grid.children].find(c => c.querySelector('h4') && c.querySelector('h4').textContent === 'Defences');
    if (defCard && d.weakness) { const s = secret(G().cap(d.weakness) + '.', '◐ weakness'); if (s) defCard.querySelector('.tl-card-body').appendChild(s); }
    return h('div.tl-town', [hero, h('div.tl-town-row', [mapCard, h('div.tl-town-col', [over, demo])]), grid]);
  }
  function lightbox(src, title) {
    let zoomed = false;
    const img = h('img', { src, alt: title, draggable: false });
    const box = h('div.tl-lightbox-box', [img]);
    const close = () => { scrim.remove(); document.removeEventListener('keydown', key, true); };
    const scrim = h('div.gk-scrim.tl-lightbox', { onclick: e => { if (e.target === scrim) close(); } }, [
      h('div.gk-panel.gk-dialog.tl-lightbox-panel', [h('div.tl-lightbox-head', [h('b.gk-grow', { text: title }), h('span.gk-small.gk-muted', { text: 'Click the map to zoom' }), ui.button({ icon: '✕', small: true, kind: 'ghost', title: 'Close (Esc)', onClick: close })]), box]),
    ]);
    img.addEventListener('click', e => {
      const r = img.getBoundingClientRect(), fx = (e.clientX - r.left) / r.width, fy = (e.clientY - r.top) / r.height;   // lint-ui: ok (a fraction of the image, not a position)
      zoomed = !zoomed; box.classList.toggle('zoomed', zoomed);
      if (zoomed) requestAnimationFrame(() => { box.scrollLeft = fx * box.scrollWidth - box.clientWidth / 2; box.scrollTop = fy * box.scrollHeight - box.clientHeight / 2; });
    });
    const key = e => { if (e.key === 'Escape') { e.stopPropagation(); close(); } };
    document.addEventListener('keydown', key, true);
    document.body.appendChild(scrim);
  }

  /* ---------------- a generic result ---------------- */
  function renderGeneric(res, ctl, def) {
    const nameSec = res.sections.find(s => s.kind === 'title');
    const hero = h('section.gk-widget.tl-hero', [
      h('span.tl-hero-ico', { text: def.icon }),
      h('div.gk-grow', [
        h('div.tl-town-kicker', { text: def.name }),
        h('div.tl-town-titlerow', [h('h2.tl-gen-title', { text: res.title }), nameSec ? ctl.tools(nameSec.key, 'name') : null]),
        res.summary && res.summary !== res.title ? h('p.tl-town-tag', { text: res.summary }) : null,
      ]),
    ]);
    const cards = res.sections.filter(s => s.kind !== 'title' && !(WB.share && s.secret)).map(s => TK.card({ title: s.label, actions: [ctl.tools(s.key, s.label)], body: sectionBody(s, res), cls: (s.kind === 'items' && s.value.length > 5) || res.id === 'names' ? 'tl-wide' : s.secret ? 'tl-card-secret' : '' }));
    return h('div.tl-generic', [hero, h('div.tl-gen-grid', cards)]);
  }

  /* ---------------- the workspace ---------------- */
  /** o: { id, preset, mapId, x, y, dialog, store, fresh, onCreated(result) } → { el, destroy } */
  function workspace(o) {
    const def = G().get(o.id);
    const store = o.store, all = store.get().genState || {}, saved = all[o.id] || {};
    const keys = new Set(def.inputs.map(i => i.key));
    let inputs = Object.assign({}, saved.inputs || {});
    if (o.fresh) delete inputs.name;
    for (const [k, v] of Object.entries(o.preset || {})) if (keys.has(k)) inputs[k] = v;
    let seed = (!o.fresh && saved.seed) || G().newSeed();
    let pins = o.fresh ? {} : Object.assign({}, saved.pins || {});
    const locks = new Set(o.fresh ? [] : saved.locks || []);
    let res = null, busy = 0, alive = true;
    const back = [], urls = [];
    const save = WB.debounce(() => { if (!alive && !o.dialog) return; const g = Object.assign({}, store.get().genState); g[o.id] = { inputs: JSON.parse(JSON.stringify(inputs)), seed, pins, locks: [...locks] }; store.patch({ genState: g }); }, 300);
    const remember = () => {
      const hist = Object.assign({}, store.get().genHistory), list = (hist[o.id] || []).filter(x => !(x.seed === seed && JSON.stringify(x.pins) === JSON.stringify(pins)));
      list.unshift({ seed, pins: Object.assign({}, pins), title: res.title, at: new Date().toISOString() });
      hist[o.id] = list.slice(0, 15); store.patch({ genHistory: hist });
    };
    const snapshot = () => back.push({ seed, pins: Object.assign({}, pins) });

    /* options */
    const optsBox = h('div.tl-gen-opts');
    function control(inp) {
      const v = inputs[inp.key] !== undefined ? inputs[inp.key] : inp.def;
      const set = val => { inputs[inp.key] = val; save(); regen(); };
      switch (inp.kind) {
        case 'choice': return ui.select({ value: v == null ? '' : v, options: inp.options, onChange: set });
        case 'number': { const i = ui.input({ type: 'number', value: v == null ? '' : v, onChange: x => set(x === '' ? null : Math.max(inp.min || 0, Math.min(inp.max || 999, +x))) }); if (inp.min != null) i.min = inp.min; if (inp.max != null) i.max = inp.max; return i; }
        case 'culture': {
          const cs = (WB.titles || []).filter(t => (WB.types.get(t.typeId) || {}).key === 'culture' && WB.visible(t));
          return ui.select({ value: v || '', options: [['', cs.length ? 'Any' : 'No cultures yet']].concat(cs.map(c => [c.id, c.title])), onChange: set });
        }
        case 'date': return WB.ui.dateInput({ value: v || null, onChange: set, placeholder: 'Any' });
        case 'toggle': return ui.toggle({ value: !!v, onChange: set });
        default: {
          const i = ui.input({ value: v || '', placeholder: inp.placeholder || '' });
          const d = WB.debounce(x => set(x), 450);
          i.addEventListener('input', () => d(i.value));
          i.addEventListener('keydown', e => { if (e.key === 'Enter') d.flush(i.value); });
          return i;
        }
      }
    }
    for (const inp of def.inputs) optsBox.appendChild(ui.field({ label: inp.label, hint: inp.hint, control: control(inp) }));

    /* actions */
    const seedBtn = ui.button({ small: true, kind: 'ghost', title: 'The same seed with the same options always gives the same result. Click to type a seed.', onClick: askSeed });
    const backBtn = ui.button({ icon: '↶', small: true, title: 'Back to the previous result (Ctrl+Z)', onClick: goBack, disabled: true });
    const histBtn = ui.button({ icon: '◷', small: true, kind: 'ghost', title: 'Recent results', onClick: e => history(e) });
    const createBtn = ui.button({ label: o.id === 'town' ? 'Create town…' : 'Create entry', icon: '＋', kind: 'primary', title: WB.share ? 'Leave Share view to create entries' : 'Make entries from this (Ctrl+Enter)', onClick: () => create(), disabled: WB.share });
    const actions = h('div.tl-gen-actions', [
      ui.group([ui.button({ label: 'Re-roll', icon: '🎲', title: 'A new result; locked parts stay (R)', onClick: () => rerollAll() }), backBtn]),
      seedBtn, histBtn,
      h('span.gk-grow'),
      ui.button({ icon: '⎘', label: 'Copy', small: true, kind: 'ghost', title: 'Copy as text', onClick: () => res && TK.copy(G().text(res), 'Text') }),
      createBtn,
    ]);
    const where = o.mapId ? h('div.tl-gen-where.gk-small', [h('span', { text: '⌖ It will be pinned on ' }), WB.ui.chip(o.mapId, { size: 'sm', noMenu: true }), h('span', { text: ' where you clicked, with its own town map as a sub-map.' })]) : null;
    const out = h('div.tl-gen-out');
    const el = h('div.tl-gen-ws', [
      h('section.gk-widget.tl-gen-head', [
        h('div.tl-gen-headrow', [h('span.tl-hero-ico', { text: def.icon }), h('div.gk-grow', [h('h3', { text: def.name }), h('div.gk-small.gk-muted', { text: def.desc })])]),
        optsBox, where, actions,
      ]),
      out,
    ]);

    /* section tools: lock + re-roll */
    const ctl = {
      url(svg) { const u = URL.createObjectURL(new Blob([svg], { type: 'image/svg+xml' })); urls.push(u); return u; },
      tools(key, label) {
        const locked = locks.has(key);
        const lock = ui.button({ icon: locked ? '🔒' : '🔓', small: true, kind: 'ghost', title: locked ? 'Unlock ' + label.toLowerCase() + ' (it changes on the next re-roll)' : 'Lock ' + label.toLowerCase() + ' (it stays when you re-roll)', onClick: () => toggleLock(key) });
        if (locked) { lock.classList.add('on'); lock.setAttribute('aria-pressed', 'true'); }
        return h('span.tl-sec-tools', [lock, ui.button({ icon: '⟳', small: true, kind: 'ghost', title: 'Re-roll ' + label.toLowerCase() + ' only', onClick: () => rerollOne(key) })]);
      },
    };
    function paint() {
      const keep = urls.splice(0);
      GK.clear(out);
      out.appendChild(o.id === 'town' ? renderTown(res, ctl) : renderGeneric(res, ctl, def));
      setTimeout(() => keep.forEach(u => URL.revokeObjectURL(u)), 2000);
      seedBtn.replaceChildren('Seed ' + seed + (Object.keys(pins).length ? ' +' + Object.keys(pins).length : ''));
      backBtn.disabled = !back.length;
    }
    async function regen() {
      const my = ++busy;
      out.classList.add('busy');
      try {
        const r = await WB.gen.run(o.id, inputs, { seed, seeds: pins });
        if (my !== busy || !alive) return;
        res = r;
        paint();
        remember(); save();
      } catch (e) { WB.fail(e); } finally { if (my === busy) out.classList.remove('busy'); }
    }
    function rerollAll() { if (!res) return; snapshot(); seed = G().newSeed(); const keep = {}; for (const k of locks) keep[k] = res.seeds[k] || pins[k]; pins = keep; regen(); }
    function rerollOne(key) { if (!res) return; snapshot(); pins[key] = G().rerollSeed(res, key); regen(); }
    function toggleLock(key) { if (!res) return; if (locks.has(key)) locks.delete(key); else { locks.add(key); pins[key] = res.seeds[key] || pins[key]; } save(); paint(); }
    function goBack() { const s = back.pop(); if (!s) return; seed = s.seed; pins = s.pins; regen(); }
    async function askSeed() {
      const v = await ui.prompt('Seed', seed, 'Letters and numbers');
      if (!v || v === seed) return;
      snapshot(); seed = v.trim().slice(0, 40); pins = {}; locks.clear(); regen();
    }
    function history(e) {
      const list = (store.get().genHistory || {})[o.id] || [];
      WB.ui.menu(list.length ? [{ header: 'Recent ' + def.name.toLowerCase() + ' results' }].concat(list.map(x => ({ label: x.title + '   ' + x.seed, icon: x.seed === seed ? '•' : '', hint: WB.fmt.rel(x.at), onClick: () => { snapshot(); seed = x.seed; pins = Object.assign({}, x.pins); regen(); } }))) : [{ header: 'Nothing yet' }], e);
    }
    async function create() {
      if (!res || WB.share) return;
      const env = { mapId: o.mapId || null, x: o.x, y: o.y };
      if (o.id === 'town') { const inc = await townChoices(res, o, store); if (!inc) return; env.include = inc; }
      createBtn.disabled = true;
      try { const r = await WB.gen.create(res, env); o.onCreated && o.onCreated(r, res); }
      catch (e) { WB.fail(e); } finally { createBtn.disabled = !!WB.share; }
    }
    const offKeys = TK.keys(el, e => {
      if (TK.isTyping(e)) return;
      if (!e.ctrlKey && !e.altKey && !e.metaKey && (e.key === 'r' || e.key === 'R')) { e.preventDefault(); rerollAll(); }
      else if (e.ctrlKey && e.key === 'Enter') { e.preventDefault(); create(); }
      else if (e.ctrlKey && !e.shiftKey && e.key.toLowerCase() === 'z' && back.length) { e.preventDefault(); goBack(); }
    }, o.keyTarget);
    regen();
    return { el, destroy() { alive = false; offKeys(); save.flush && save.flush(); setTimeout(() => urls.forEach(u => URL.revokeObjectURL(u)), 500); }, create, result: () => res };
  }
  TK.workspace = workspace;

  /** what a town's Create makes (remembered) */
  async function townChoices(res, o, store) {
    const d = res.data, inc = Object.assign({}, TK.DEFAULTS.include, store.get().include);
    const many = d.districts.length > 1;
    const count = () => 1 + (inc.districts && many ? d.districts.length : 0) + (inc.locations ? d.locations.length : 0) + (inc.residents ? d.residents.length + 1 : 0) + (inc.locations && inc.owners ? d.locations.length : 0) + (inc.map ? 1 : 0);
    const total = h('b');
    const paint = () => { total.textContent = count() + ' entries'; };
    const row = (key, label, note, disabled) => h('label.tl-choice', { class: disabled ? 'off' : '' }, [ui.toggle({ value: !!inc[key] && !disabled, onChange: v => { inc[key] = v; paint(); } }), h('div', [h('b', { text: label }), h('div.gk-small.gk-muted', { text: note })])]);
    const body = h('div.tl-choices', [
      h('p.gk-small', [h('span', { text: 'The town becomes a Place entry with its overview and every section. Also make:' })]),
      many ? row('districts', 'Districts', d.districts.length + ' places inside the town, holding their locations') : null,
      row('locations', 'Notable locations', d.locations.length + ' places (inns, temples, the market…) with their keepers and hooks'),
      row('owners', 'Their keepers as characters', d.locations.length + ' characters who own the locations'),
      row('residents', 'Residents and the leader', (d.residents.length + 1) + ' characters who live in the town (with culture, wants and secrets)'),
      d.map ? row('map', 'The town map', 'A map entry with this plan' + (o.mapId ? ', opened from the pin' : '') + (inc.locations ? '; locations are pinned on it' : '')) : null,
      o.mapId ? h('p.gk-small.gk-muted', { text: '⌖ The town is pinned where you clicked.' }) : null,
      h('div.tl-choices-total.gk-small', ['Creates ', total, ' · one Undo removes them all.']),
    ]);
    paint();
    const ok = await ui.dialog({ title: 'Create ' + d.name, icon: '⌂', body, actions: [{ label: 'Cancel', value: false }, { label: 'Create', kind: 'primary', value: true }] });
    if (!ok) return null;
    store.patch({ include: inc });
    return inc;
  }

  /* ---------------- the Generators tab ---------------- */
  TK.tools.gen = {
    async mount(host, { store, params }) {
      let current = params.gen || store.get().gen || 'town';
      if (!G().get(current)) current = 'town';
      let ws = null;
      const list = h('nav.tl-gen-list', { 'aria-label': 'Generators' });
      const defs = G().list();
      const paintList = () => {
        GK.clear(list);
        for (const grp of GROUPS) {
          const items = defs.filter(d => (d.group || 'More') === grp);
          if (!items.length) continue;
          list.appendChild(h('div.tl-gen-group', { text: grp }));
          for (const d of items) list.appendChild(h('button.tl-gen-item', { type: 'button', class: (d.id === current ? 'on ' : '') + (d.star ? 'star' : ''), title: d.desc, onclick: () => select(d.id) }, [
            h('span.tl-gen-ico', { text: d.icon }), h('span.tl-gen-txt', [h('b', { text: d.name }), d.star ? h('span.gk-tiny.gk-muted', { text: 'with map, people & places' }) : null]),
          ]));
        }
      };
      const main = h('div.tl-gen-main');
      function select(id, preset) {
        current = id; store.patch({ gen: id });
        if (ws) ws.destroy();
        GK.clear(main);
        ws = workspace({ id, store, preset: preset || null });
        main.appendChild(ws.el);
        paintList();
      }
      host.appendChild(h('div.tl-gen', [h('aside.gk-panel.tl-gen-side', [list]), main]));
      const preset = Object.assign({}, params); delete preset.gen; delete preset.tool;
      select(current, Object.keys(preset).length ? preset : null);
      const offKeys = TK.keys(host, e => {
        if (TK.isTyping(e) || !e.altKey || (e.key !== 'ArrowDown' && e.key !== 'ArrowUp')) return;
        const ids = GROUPS.flatMap(g => defs.filter(d => (d.group || 'More') === g).map(d => d.id)), i = ids.indexOf(current);
        e.preventDefault(); select(ids[(i + (e.key === 'ArrowDown' ? 1 : ids.length - 1)) % ids.length]);
      });
      return () => { offKeys(); if (ws) ws.destroy(); };
    },
  };

  /* ---------------- WB.gen.open: the same workspace over any screen ---------------- */
  TK.genDialog = (id, opts = {}) => new Promise(async resolve => {
    if (!G().get(id)) { WB.fail(new Error('There is no generator called ' + id + '.')); return resolve(null); }
    const store = await TK.store();
    let done = false;
    const preset = Object.assign({}, opts); delete preset.mapId; delete preset.x; delete preset.y;
    const scrim = h('div.gk-scrim.tl-gen-scrim', { onclick: e => { if (e.target === scrim) finish(null); } });
    const ws = workspace({ id, preset, mapId: opts.mapId || null, x: opts.x, y: opts.y, dialog: true, fresh: true, store, keyTarget: scrim, onCreated: r => finish(r) });
    const finish = v => { if (done) return; done = true; ws.destroy(); scrim.remove(); document.removeEventListener('keydown', onKey, true); resolve(v); };
    const def = G().get(id);
    const panel = h('section.gk-panel.gk-dialog.tl-gen-dialog', { tabindex: -1, role: 'dialog', 'aria-label': def.name + ' generator' }, [
      h('div.gk-panel-head', [h('span.gk-ico', { text: def.icon }), h('h3', { text: opts.mapId ? 'Found a ' + def.name.toLowerCase() + ' here' : def.name }), ui.button({ icon: '✕', small: true, kind: 'ghost', title: 'Close (Esc)', onClick: () => finish(null) })]),
      h('div.gk-panel-body', [ws.el]),
    ]);
    scrim.appendChild(panel);
    scrim.addEventListener('keydown', e => { if (e.key !== 'Escape') e.stopPropagation(); });
    const onKey = e => { const all = document.querySelectorAll('.gk-scrim'); if (e.key === 'Escape' && !document.querySelector('.wb-pop') && all[all.length - 1] === scrim) { e.stopPropagation(); finish(null); } };
    document.addEventListener('keydown', onKey, true);
    document.body.appendChild(scrim);
    setTimeout(() => panel.focus({ preventScroll: true }), 30);
  });
})();
