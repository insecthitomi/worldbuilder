/* Name generator: works without any language. Pick a sound style, a Culture's sample names, or a language's sounds;
   roll people, families or places; keep the good ones; one click makes a Character or Place with that name. */
(function () {
  'use strict';
  const { h, ui } = GK;
  const X = WB.lexicon._;
  const N = () => WB.names;

  function names(host, L) {
    const nm = N();
    const st = () => Object.assign({ source: 'style', style: 'sea', cultureId: null, languageId: null, kind: 'full', count: 24, avoid: true, starts: '', meaning: false }, L.S().names || {});
    const setSt = p => L.set({ names: Object.assign({}, st(), p) });
    const kept = () => (L.S().kept || []).filter(k => !k.world || k.world === WB.worldId);
    const setKept = list => L.set({ kept: (L.S().kept || []).filter(k => k.world && k.world !== WB.worldId).concat(list.map(k => Object.assign({ world: WB.worldId }, k))) });
    const created = [];
    let seed = X.seed(), current = [];
    const typeOf = key => WB.type(key);
    const cultures = () => WB.titles.filter(t => (WB.types.get(t.typeId) || {}).key === 'culture' && WB.visible(t));
    const langs = () => L.langs.filter(l => l.consonants + l.vowels > 0 && WB.visible(l));

    /* ---------- controls ---------- */
    const srcBox = h('div.lx-nm-src');
    const sourceSeg = ui.segmented({ value: st().source, options: [['style', 'Sound style', 'Built-in styles: no setup at all'], ['culture', 'Culture', 'Learns from a Culture entry\'s sample names'], ['language', 'Language', 'Built from a language\'s sounds']], onChange: v => { setSt({ source: v }); paintSource(); roll(); } });
    function paintSource() {
      GK.clear(srcBox);
      const s = st();
      if (s.source === 'style') {
        const grid = h('div.lx-style-grid', { role: 'radiogroup', 'aria-label': 'Sound style' });
        const about = h('div.gk-small.gk-muted.lx-style-about');
        const exOf = k => nm.generate({ style: k, kind: st().kind === 'place' ? 'place' : 'person', count: 3, seed: k + 'x' }).join(', ');
        const describe = k => { const sty = nm.STYLES[k] || {}; GK.clear(about); about.append(h('b', { text: sty.label }), ' — ' + (sty.desc || '') + ' · e.g. ', h('i', { text: exOf(k) })); };
        for (const [k, sty] of Object.entries(nm.STYLES)) {
          const ex = exOf(k);
          const b = h('button.lx-style', { type: 'button', role: 'radio', class: s.style === k ? 'on' : '', 'aria-checked': String(s.style === k), title: (sty.desc || sty.label) + '\ne.g. ' + ex, text: sty.label });
          b.addEventListener('click', () => { setSt({ style: k }); grid.querySelectorAll('.lx-style').forEach(x => { const on = x === b; x.classList.toggle('on', on); x.setAttribute('aria-checked', String(on)); }); describe(k); roll(); });
          grid.appendChild(b);
        }
        describe(st().style);
        srcBox.append(grid, about);
      } else if (s.source === 'culture') {
        const list = cultures();
        if (!list.length) {
          srcBox.appendChild(h('div.lx-banner', [h('span', { text: '❖' }), h('div.gk-grow', [h('b', { text: 'No cultures yet' }), h('div.gk-small.gk-muted', { text: 'A Culture entry with a few sample given and family names teaches the generator how its people are named.' })]),
            ui.button({ label: 'New culture', icon: '＋', small: true, kind: 'primary', onClick: async () => { const e = await WB.ui.createDialog({ type: 'culture', open: false }); if (e) { setSt({ cultureId: e.id }); WB.open(e.id); } } })]));
          return;
        }
        if (!s.cultureId || !list.find(c => c.id === s.cultureId)) setSt({ cultureId: list[0].id });
        const sel = ui.select({ value: st().cultureId, options: list.map(c => [c.id, c.title]), onChange: v => { setSt({ cultureId: v }); paintSource(); roll(); } });
        const info = h('div.gk-small.gk-muted.lx-nm-info');
        WB.api('entries.get', st().cultureId).then(c => {
          const g = (c.fields.names_given || []).length, f = (c.fields.names_family || []).length;
          GK.clear(info);
          info.append(g >= 3 ? '✓ ' + g + ' given names' : '⚠ ' + (g ? 'only ' + g + ' given names' : 'no sample given names') + ' — add at least three',
            ' · ', f >= 3 ? f + ' family names' : (f ? 'only ' + f : 'no') + ' family names',
            c.fields.language ? ' · speaks ' + WB.titleOf(c.fields.language) : '', ' ',
            ui.button({ label: 'Edit samples', small: true, kind: 'ghost', onClick: () => WB.open(c.id) }));
        }).catch(() => {});
        srcBox.append(h('div.gk-row.nowrap', [ui.field({ label: 'Culture', control: sel }), WB.ui.chip(st().cultureId, { size: 'sm' })]), info);
      } else {
        const list = langs();
        if (!list.length) {
          srcBox.appendChild(h('div.lx-banner', [h('span', { text: 'ℒ' }), h('div.gk-grow', [h('b', { text: 'No language with sounds yet' }), h('div.gk-small.gk-muted', { text: 'Create a language and pick its sounds (a preset is one click): names will sound like its words.' })]),
            ui.button({ label: 'New language', icon: '＋', small: true, kind: 'primary', onClick: () => L.newLanguage() })]));
          return;
        }
        if (!s.languageId || !list.find(l => l.id === s.languageId)) setSt({ languageId: list[0].id });
        const sel = ui.select({ value: st().languageId, options: list.map(l => [l.id, l.title + ' (' + l.wordCount + ' words)']), onChange: v => { setSt({ languageId: v }); paintSource(); roll(); } });
        const mt = ui.toggle({ value: !!st().meaning, title: 'Join two dictionary words into a name and show what it means', onChange: v => { setSt({ meaning: v }); roll(); } });
        srcBox.append(h('div.gk-row', [ui.field({ label: 'Language', control: sel }), ui.field({ label: 'Names with meanings', hint: 'Joins nouns and adjectives from the dictionary: “gull + haven”.', control: mt })]));
      }
    }
    const kindSeg = ui.segmented({ value: st().kind, options: [['full', 'Full name', 'Given and family name'], ['given', 'Given'], ['family', 'Family'], ['place', 'Place']], onChange: v => { setSt({ kind: v }); if (st().source === 'style') paintSource(); roll(); } });
    const countSeg = ui.segmented({ value: String(st().count), options: [['12', '12'], ['24', '24'], ['48', '48']], onChange: v => { setSt({ count: +v }); roll(); } });
    const starts = ui.input({ value: st().starts || '', placeholder: 'Starts with…' });
    starts.classList.add('lx-starts');
    starts.addEventListener('input', WB.debounce(() => { setSt({ starts: starts.value }); roll(); }, 250));
    const avoidT = ui.toggle({ value: st().avoid !== false, title: 'Leave out names already used by an entry', onChange: v => { setSt({ avoid: v }); roll(); } });
    const rollBtn = ui.button({ label: 'Roll', icon: '⚄', kind: 'primary', title: 'New names (Space)', onClick: () => { seed = X.seed(); roll(); } });

    /* ---------- results ---------- */
    const grid = h('div.lx-name-grid');
    const note = h('div.gk-small.gk-muted.lx-nm-note');
    async function roll() {
      const s = st(), my = ++rollSeq;
      let out = [];
      try {
        if (s.source === 'language' && s.meaning && s.languageId) out = await meaningful(s);
        else {
          const got = await WB.lexicon.generate({ cultureId: s.source === 'culture' ? s.cultureId : null, languageId: s.source === 'language' ? s.languageId : null, style: s.style, kind: s.kind, count: s.count, seed, avoid: s.avoid !== false, startsWith: s.starts });
          out = got.map(n => ({ name: n }));
        }
      } catch (e) { WB.fail(e); }
      if (my !== rollSeq) return;
      current = out;
      paint();
    }
    let rollSeq = 0;
    async function meaningful(s) {
      const words = await WB.api('lexicon.words', s.languageId, {}).catch(() => []);
      const R = nm.rng(seed), pool = words.filter(w => ['n', 'adj'].includes(w.pos) && w.gloss && !/\s/.test(w.word) && w.word.length <= 7);
      const heads = pool.filter(w => w.pos === 'n');
      if (pool.length < 2) { ui.toast('The dictionary needs a few nouns and adjectives with meanings for this', 'ℹ', 3800); return []; }
      const g = w => (w.gloss || '').split(/[,;]/)[0].replace(/^(to|the|a|an) /i, '').trim();
      const out = [], seen = new Set(), want = nm.norm(s.starts || '');
      for (let i = 0; out.length < s.count && i < s.count * 40; i++) {
        const a = nm.pick(R, pool), b = nm.pick(R, heads.length ? heads : pool);
        if (a.id === b.id) continue;
        let name = nm.compound(a.word, b.word);
        const k = nm.norm(name);
        if (seen.has(k) || (want && !k.startsWith(want)) || (s.avoid !== false && X.titleHit(name))) continue;
        seen.add(k);
        if (s.kind === 'full') { const f = nm.generate({ phon: (await langPhon(s.languageId)), kind: 'family', count: 1, rng: R })[0]; if (f) name += ' ' + f; }
        out.push({ name, meaning: g(a) + ' + ' + g(b) });
      }
      return out;
    }
    const phonCache = new Map();
    async function langPhon(id) { if (!phonCache.has(id)) { const e = await WB.api('entries.get', id).catch(() => null); phonCache.set(id, e && e.data && e.data.phonology); } return phonCache.get(id); }
    function paint() {
      GK.clear(grid);
      const s = st(), keptSet = new Set(kept().map(k => k.name));
      if (!current.length) { grid.appendChild(h('div.lx-none.gk-muted', { text: s.starts ? 'No name starts with “' + s.starts + '” — try another letter.' : 'No names came out — try another source.' })); return; }
      current.forEach(n => grid.appendChild(card(n, keptSet.has(n.name))));
      const src = s.source === 'style' ? (nm.STYLES[s.style] || {}).label + ' style' : s.source === 'culture' ? 'the ' + WB.titleOf(s.cultureId) + ' culture' : WB.titleOf(s.languageId);
      note.textContent = current.length + ' ' + ({ full: 'full names', given: 'given names', family: 'family names', place: 'place names' })[s.kind] + ' from ' + src + (s.avoid !== false ? ' · names already in the world are left out' : '');
    }
    const mainType = () => (st().kind === 'place' ? 'place' : st().kind === 'family' ? 'faction' : 'character');
    function card(n, isKept) {
      const hit = X.titleHit(n.name);
      const t = typeOf(mainType());
      const c = h('div.lx-name-card', { tabindex: 0, class: isKept ? 'kept' : '' }, [
        h('div.lx-name', { text: n.name }),
        n.meaning ? h('div.lx-name-sub', { text: '“' + n.meaning + '”' }) : null,
        hit ? h('div.lx-name-hit', ['Already used: ', WB.ui.chip(hit, { size: 'sm' })]) : null,
        h('div.lx-name-acts', [
          h('button.lx-gen-btn', { type: 'button', class: isKept ? 'on' : '', 'aria-pressed': String(isKept), title: isKept ? 'Remove from the shortlist' : 'Keep on the shortlist (K)', text: isKept ? '★' : '☆', onclick: () => keep(n) }),
          h('button.lx-gen-btn', { type: 'button', title: 'Copy (C)', text: '⎘', onclick: () => X.copy(n.name, '“' + n.name + '”') }),
          t ? h('button.lx-gen-btn.add', { type: 'button', title: 'Create a ' + t.name.toLowerCase() + ' named “' + n.name + '” (Enter) · right-click for other types', text: '＋ ' + t.name, onclick: () => create(n, t.key), oncontextmenu: e => { e.preventDefault(); typeMenu(n, e); } }) : null,
          h('button.lx-gen-btn', { type: 'button', title: 'Create as…', text: '▾', onclick: e => typeMenu(n, e.currentTarget) }),
        ]),
      ]);
      c.addEventListener('keydown', e => {
        if (e.target !== c) return;
        const k = e.key.toLowerCase();
        if (k === 'enter') { e.preventDefault(); create(n, mainType()); }
        else if (k === 'k') { e.preventDefault(); keep(n); }
        else if (k === 'c') { e.preventDefault(); X.copy(n.name, '“' + n.name + '”'); }
        else if (e.key === 'ArrowRight' || e.key === 'ArrowLeft') { e.preventDefault(); const sib = e.key === 'ArrowRight' ? c.nextElementSibling : c.previousElementSibling; sib && sib.focus(); }
      });
      return c;
    }
    function typeMenu(n, at) {
      const keys = ['character', 'place', 'faction', 'species', 'item', 'culture', 'lore', 'event'];
      WB.ui.menu([{ header: 'Create “' + n.name + '” as' }].concat(keys.map(typeOf).filter(t => t && !t.hidden).map(t => ({ label: t.name, icon: t.icon, onClick: () => create(n, t.key) })),
        ['-', { label: 'Open the full create dialog…', icon: '＋', onClick: () => WB.ui.createDialog({ title: n.name, type: mainType() }) }]), at);
    }
    async function create(n, typeKey) {
      if (WB.share) { ui.toast('Leave Share view to create entries', '◑'); return; }
      const s = st(), fields = {};
      if (typeKey === 'character' && s.source === 'culture' && s.cultureId) fields.culture = s.cultureId;
      try {
        const e = await WB.api('entries.create', { worldId: WB.worldId, typeKey, title: n.name, fields, summary: n.meaning ? 'The name means “' + n.meaning + '”.' : '' });
        created.unshift(e);
        paintAside();
        const t = WB.ui.undoToast('Created ' + (WB.type(typeKey) || {}).name + ' “' + e.title + '”', async () => { await WB.api('entries.purge', e.id); created.splice(created.indexOf(e), 1); paintAside(); });
        t.appendChild(ui.button({ label: 'Open', small: true, onClick: () => { t.remove(); WB.open(e.id); } }));
        current = current.filter(x => x.name !== n.name);
        paint();
      } catch (err) { WB.fail(err); }
    }
    function keep(n) {
      const list = kept();
      if (list.find(k => k.name === n.name)) setKept(list.filter(k => k.name !== n.name));
      else setKept([{ name: n.name, meaning: n.meaning || '', kind: st().kind }].concat(list).slice(0, 200));
      paint(); paintAside();
      const again = [...grid.querySelectorAll('.lx-name-card')].find(x => x.querySelector('.lx-name').textContent === n.name);
      again && again.focus();
    }

    /* ---------- shortlist ---------- */
    const aside = h('div.lx-nm-aside');
    function paintAside() {
      GK.clear(aside);
      const list = kept();
      const rows = h('div.lx-kept');
      list.forEach(k => rows.appendChild(h('div.lx-kept-row', [
        h('div.gk-grow', [h('div.lx-kept-name', { text: k.name }), k.meaning ? h('div.gk-tiny.gk-muted', { text: '“' + k.meaning + '”' }) : null]),
        h('button.lx-x', { type: 'button', text: '＋', title: 'Create an entry with this name', onclick: e => typeMenu(k, e.currentTarget) }),
        h('button.lx-x', { type: 'button', text: '✕', title: 'Remove from the shortlist', onclick: () => { setKept(kept().filter(x => x.name !== k.name)); paintAside(); paint(); } }),
      ])));
      aside.appendChild(ui.panel({ title: 'Shortlist', icon: '★', actions: list.length ? [ui.button({ icon: '⎘', small: true, kind: 'ghost', title: 'Copy every name', onClick: () => X.copy(list.map(k => k.name).join('\n'), WB.fmt.plural(list.length, 'name')) }),
        ui.button({ icon: '🗑', small: true, kind: 'ghost', title: 'Clear the shortlist', onClick: () => { const before = kept(); setKept([]); paintAside(); paint(); WB.ui.undoToast('Shortlist cleared', () => { setKept(before); paintAside(); paint(); }); } })] : null,
      body: [list.length ? rows : h('div.gk-small.gk-muted', { text: 'Star the names you like (☆ or K). They wait here, in this world, until you use them.' })] }));
      if (created.length) aside.appendChild(ui.panel({ title: 'Created just now', icon: '✓', body: [h('div.wb-chips', created.map(e => WB.ui.chip(WB.liteOf(e.id) || e, { size: 'sm' })))] }));
    }

    /* ---------- layout ---------- */
    host.appendChild(h('div.lx-names', [
      h('div.lx-nm-main', [
        ui.panel({ cls: 'lx-nm-controls', title: 'Name generator', icon: '✦', sub: 'Good names for people, families and places — no language needed.', body: [
          h('div.lx-toolbar.lx-nm-opts', [kindSeg, countSeg, starts, h('label.gk-row.nowrap.gk-small.lx-avoid', { title: 'Leave out names already used by an entry' }, [avoidT, 'New names only']), h('span.gk-grow'), rollBtn]),
          h('div.gk-row.lx-nm-top', [h('span.gk-small.gk-muted', { text: 'Sounding like' }), sourceSeg]),
          srcBox,
        ] }),
        ui.panel({ cls: 'lx-nm-results', body: [note, grid, h('div.gk-tiny.gk-faint', [WB.ui.kbd('Space'), ' roll again · on a name: ', WB.ui.kbd('Enter'), ' create · ', WB.ui.kbd('K'), ' keep · ', WB.ui.kbd('C'), ' copy · ', WB.ui.kbd('←→'), ' move'])] }),
      ]),
      aside,
    ]));
    paintSource(); paintAside();
    roll();
    const onKey = e => {
      if (!host.isConnected || document.querySelector('.gk-scrim, .wb-pop')) return;
      if (e.target.closest && e.target.closest('input, textarea, select, [contenteditable="true"], button')) return;
      if (e.key === ' ') { e.preventDefault(); seed = X.seed(); roll(); }
    };
    document.addEventListener('keydown', onKey);
    const off = WB.onChange(['entries'], () => { if (!host.isConnected) return; paint(); paintAside(); }, 400);
    return () => { document.removeEventListener('keydown', onKey); off(); };
  }
  X.tabs.names = names;
})();
