/* Lexicon: languages (dictionary, phonology, word generator, sound changes, translator, script) and a name generator
   that works without any language. The tabs live in src/app/modules/lexicon/*.js and are loaded on first use. */
(function () {
  'use strict';
  const { h, ui } = GK;
  const N = () => WB.names;

  /* ---------------- shared pieces for the tab files ---------------- */
  const POS = [
    ['n', 'noun', '#5fa8d9'], ['v', 'verb', '#e0796b'], ['adj', 'adjective', '#d2a35a'], ['adv', 'adverb', '#c49a3c'], ['pron', 'pronoun', '#8f7ad8'],
    ['prep', 'adposition', '#6fa7d8'], ['conj', 'conjunction', '#9aa5b1'], ['det', 'determiner', '#a7a1c9'], ['num', 'numeral', '#5fb38a'],
    ['part', 'particle', '#a0a8b8'], ['interj', 'interjection', '#e06aa8'], ['aff', 'affix', '#b07ad6'], ['name', 'proper name', '#4fb6b2'], ['phr', 'phrase', '#d97f9f'],
  ];
  const X = {
    tabs: {},
    POS,
    posName: p => (POS.find(x => x[0] === p) || [p, p || 'no part of speech'])[1],
    posColor: p => (POS.find(x => x[0] === p) || [0, 0, '#9aa5b1'])[2],
    posBadge: (p, extra) => h('span.lx-pos', { class: extra || '', style: { '--c': X.posColor(p) }, title: X.posName(p), text: p || '—' }),
    phon: lang => N().normPhon((lang && lang.data && lang.data.phonology) || null),
    hasPhon: lang => !!(lang && lang.data && lang.data.phonology && ((lang.data.phonology.vowels || []).length)),
    /** a small "?" that explains a control */
    tip: text => h('span.lx-tip', { title: text, text: '?', tabindex: 0 }),
    copy: async (text, what) => { try { await navigator.clipboard.writeText(text); ui.toast((what || 'Copied') + ' to the clipboard', '⎘'); } catch (e) { WB.fail(e); } },
    /** words that already exist, for collision checks */
    titleSet: () => new Set(WB.titles.flatMap(t => [t.title].concat(t.aliases || [])).map(s => N().norm(s))),
    /** where a name is already used: the entry's lite or null */
    titleHit: name => { const k = N().norm(name); return WB.titles.find(t => N().norm(t.title) === k || (t.aliases || []).some(a => N().norm(a) === k)) || null; },
    seed: () => Math.floor(Math.random() * 1e9),
    kbdHint: (keys, text) => h('span.lx-hint', [WB.ui.kbd(keys), ' ' + text]),
  };

  /* ---------------- names for other screens (no screen needs to be open) ---------------- */
  async function sources({ cultureId, languageId } = {}) {
    let given = null, family = null, phon = null, culture = null, language = null;
    if (cultureId) {
      culture = await WB.api('entries.get', cultureId).catch(() => null);
      if (culture) { given = (culture.fields.names_given || []).filter(Boolean); family = (culture.fields.names_family || []).filter(Boolean); if (!languageId && culture.fields.language) languageId = culture.fields.language; }
    }
    if (languageId) { language = await WB.api('entries.get', languageId).catch(() => null); if (language && X.hasPhon(language)) phon = language.data.phonology; }
    return { given: given && given.length >= 3 ? given : null, family: family && family.length >= 3 ? family : null, phon, culture, language };
  }
  /** names: kind person | given | family | place | full; style = a names.js style key; seed for repeatable results */
  async function generateNames({ cultureId, languageId, kind = 'person', count = 8, style, seed, avoid = true, startsWith = '' } = {}) {
    const S = await sources({ cultureId, languageId });
    const nm = N(), R = nm.rng(seed == null ? X.seed() : seed);
    const st = style || (WB.world && WB.world.settings.nameStyle) || 'common';
    const taken = avoid ? WB.titles.flatMap(t => [t.title].concat(t.aliases || [])).concat(WB.titles.flatMap(t => t.title.split(/\s+/))) : [];
    const want = String(startsWith || '').trim().toLowerCase();
    const ok = n => !want || nm.norm(n).startsWith(nm.norm(want));
    const out = new Set();
    for (let round = 0; out.size < count && round < (want ? 30 : 6); round++) {
      const n = Math.max(count * (want ? 4 : 1), 6);
      let batch;
      if (kind === 'full') batch = Array.from({ length: n }, () => nm.fullName({ style: st, given: S.given, family: S.family, phon: S.phon, rng: R, avoid: taken }));
      else {
        const samples = kind === 'family' ? S.family : kind === 'place' ? null : S.given;
        batch = nm.generate({ style: st, kind: kind === 'given' ? 'person' : kind, count: n, samples, phon: S.phon, rng: R, avoid: taken });
      }
      for (const b of batch) { if (out.size >= count) break; if (b && ok(b) && !(avoid && X.titleHit(b))) out.add(b); }
    }
    return [...out];
  }
  WB.lexicon = {
    _: X,
    /** → Promise<string[]> names from a culture's samples, a language's sounds, or the world's name style.
        kind: person (given + family name) | given | family | place */
    suggest: ({ cultureId, languageId, kind = 'person', count = 8, style, seed } = {}) => generateNames({ cultureId, languageId, kind: kind === 'person' || kind === 'character' ? 'full' : kind, count, style, seed }).catch(e => { console.warn(e); return []; }),
    generate: generateNames,
    sources,
  };

  /* ---------------- the screen ---------------- */
  const PARTS = ['ipa', 'words', 'sounds', 'changes', 'translate', 'names'];
  const loadParts = () => Promise.all(PARTS.map(p => WB.loadScript('src/app/modules/lexicon/' + p + '.js')));
  const SHARE_HIDDEN = ['phonology', 'generator', 'changes'];   // tools for the author; Share view keeps the dictionary, translator and script
  const TABS = [['words', 'Lexicon', '≣'], ['phonology', 'Phonology', 'ɑ'], ['generator', 'Generator', '⚄'], ['changes', 'Sound changes', '⇝'], ['translate', 'Translator', '⇄'], ['script', 'Script', '✒']];
  const DEFAULTS = {
    view: 'names', tab: 'words', sort: { key: 'word', dir: 1 }, scope: 'all', pos: '', cols: { ipa: true, def: true, ety: true, tags: false },
    names: { source: 'style', style: 'sea', cultureId: null, languageId: null, kind: 'full', count: 24, avoid: true, starts: '', meaning: false },
    kept: [], locked: {}, gen: { count: 24, kind: 'word', syl: null }, translate: { dir: 'to', text: '' }, changes: { mode: 'rows' }, sampleSeed: 1,
  };

  let live = null;   // the mounted screen (for commands and smoke steps)

  GK.modules.register({
    id: 'lexicon',
    title: 'Lexicon',
    icon: 'ℒ',
    order: 80,
    subtitle: 'Languages, dictionaries, sound changes and name generators.',
    async mount(page, ctx) {
      page.classList.add('lx-page');
      if (!WB.worldId) {
        page.appendChild(WB.ui.empty({ icon: 'ℒ', title: 'No world is open', text: 'Languages and names belong to a world. Create one to start a dictionary or roll some names.', actions: [ui.button({ label: 'Create a world', kind: 'primary', onClick: () => WB.newWorld() })] }));
        return;
      }
      await loadParts();
      const store = WB.store ? await WB.store(ctx, DEFAULTS) : await ctx.store(DEFAULTS);
      const S = () => store.get();
      for (const [k, v] of Object.entries(DEFAULTS)) if (S()[k] === undefined) store.patch({ [k]: v });
      const params = WB.params('lexicon') || {};
      const offs = [];
      const L = {
        page, ctx, store, S, X,
        langs: [], lang: null, words: [], stats: null,
        get id() { return L.lang ? L.lang.id : null; },
        set(p) { return store.patch(p); },
        tabCleanup: null,
      };
      live = L;

      /* layout */
      const side = h('div.lx-side');
      const main = h('div.lx-main');
      page.appendChild(WB.ui.split({ side, main, cls: 'lx-split' }));

      /* ---------- data ---------- */
      L.loadLangs = async () => { L.langs = await WB.api('lexicon.languages', WB.worldId).catch(() => []); };
      L.loadWords = async () => { if (!L.lang) { L.words = []; return; } const id = L.lang.id; const ws = await WB.api('lexicon.words', id, {}); if (L.lang && L.lang.id === id) L.words = ws; };
      const sig = ws => ws.map(w => w.id + w.updatedAt).sort().join('|');
      /** saves part of the language's data (debounced per key) and keeps the local copy current */
      // debounced writes of the language's data, one per key; flush() writes whatever is still waiting
      const queue = new Map();
      let inflight = 0;
      async function send(k) {
        const job = queue.get(k);
        if (!job) return;
        queue.delete(k); clearTimeout(job.timer);
        inflight++;
        try {
          const e = await WB.api('entries.update', job.id, { dataPatch: { [job.key]: job.value } });
          if (L.lang && L.lang.id === job.id) {
            const waiting = {};
            for (const j of queue.values()) if (j.id === job.id) waiting[j.key] = j.value;
            L.lang.data = Object.assign(e.data, waiting);
          }
        } catch (err) { WB.fail(err); }
        finally { inflight--; }
      }
      L.saveData = (key, value, ms = 350) => {
        if (!L.lang) return;
        L.lang.data[key] = value;
        const id = L.lang.id, k = id + '|' + key, old = queue.get(k);
        if (old) clearTimeout(old.timer);
        const job = { id, key, value };
        job.timer = setTimeout(() => send(k), ms);
        queue.set(k, job);
      };
      L.flush = () => { for (const k of [...queue.keys()]) send(k); };
      Object.defineProperty(L, 'pending', { get: () => queue.size + inflight });
      L.phon = () => X.phon(L.lang);
      L.savePhon = (patch, ms) => L.saveData('phonology', Object.assign({}, L.lang.data.phonology || N().normPhon(null), patch), ms);
      /** words: local list stays in step with what we did ourselves */
      L.upsert = w => { const i = L.words.findIndex(x => x.id === w.id); if (i >= 0) L.words[i] = Object.assign({}, L.words[i], w); else L.words.push(w); };
      L.drop = ids => { const s = new Set(ids); L.words = L.words.filter(w => !s.has(w.id)); };
      L.addWord = async (w, { quiet } = {}) => {
        const r = await WB.api('lexicon.add', L.lang.id, w);
        L.upsert(r);
        if (!quiet) WB.ui.undoToast('Added “' + r.word + '”' + (r.gloss ? ' — ' + r.gloss : ''), async () => { await WB.api('lexicon.remove', [r.id]); L.drop([r.id]); L.refreshTab(); }, 4500);
        return r;
      };
      L.removeWords = async ids => {
        const gone = await WB.api('lexicon.remove', ids);
        L.drop(ids);
        WB.ui.undoToast(ids.length === 1 ? '“' + (gone.rows[0] && gone.rows[0].word) + '” deleted' : ids.length + ' words deleted', async () => { await WB.api('lexicon.restore', gone); await L.loadWords(); L.refreshTab(); });
        return gone;
      };
      L.wordById = id => L.words.find(w => w.id === id) || null;

      /* ---------- the side: names + languages ---------- */
      const paintSide = () => {
        GK.clear(side);
        const look = WB.ui.search({ placeholder: 'Look up a word or meaning', onInput: v => lookup(v, look), onEnter: v => lookup(v, look, true) });
        look.title = 'Search every language, both ways: a word, or what it means';
        const names = h('div.wb-row.lx-names-row', { class: S().view === 'names' ? 'on' : '', tabindex: 0, title: 'Roll names for people, families and places — no language needed', style: { '--c': '#d6739c' } }, [
          h('span.wb-row-ico', { text: '✦' }), h('div.wb-row-main', [h('div.wb-row-title', { text: 'Name generator' }), h('div.wb-row-sub', { text: 'People, families, places' })]),
        ]);
        names.addEventListener('click', () => select('names'));
        names.addEventListener('keydown', e => { if (e.key === 'Enter') select('names'); });
        const list = h('div.lx-lang-list');
        const kids = new Map();
        for (const l of L.langs) { const p = l.parentLanguageId && L.langs.find(x => x.id === l.parentLanguageId) ? l.parentLanguageId : ''; if (!kids.has(p)) kids.set(p, []); kids.get(p).push(l); }
        const walk = (pid, depth) => (kids.get(pid) || []).forEach(l => {
          if (!WB.visible(l)) return;
          const sub = [WB.fmt.plural(l.wordCount, 'word'), l.consonants + l.vowels ? (l.consonants + l.vowels) + ' sounds' : 'no sounds yet'].join(' · ');
          list.appendChild(WB.ui.row(l, { active: S().view === l.id, indent: depth, sub, onClick: () => select(l.id), menuExtra: [{ label: 'Open in the Codex', icon: '↗', onClick: () => WB.open(l.id) }] }));
          walk(l.id, depth + 1);
        });
        walk('', 0);
        WB.ui.listKeys(list);
        side.append(ui.panel({ cls: 'lx-side-panel', body: [
          look, names,
          WB.ui.sectionHead('Languages', [ui.button({ icon: '＋', small: true, kind: 'ghost', title: 'New language', onClick: () => newLanguage() })]),
          L.langs.length ? list : h('p.gk-small.gk-muted.lx-side-empty', { text: 'No languages yet. A language gives you a dictionary, a word generator and names that sound like they belong together.' }),
          ui.button({ label: 'New language', icon: '＋', small: !!L.langs.length, kind: L.langs.length ? 'ghost' : 'primary', onClick: () => newLanguage() }),
        ] }));
      };
      async function lookup(q, anchor, force) {
        q = String(q || '').trim();
        if (!q) { WB.ui.closePopovers('lx-look'); return; }
        const res = await WB.api('lexicon.search', WB.worldId, q, { limit: 24 }).catch(() => []);
        if (!anchor.isConnected) return;
        const box = h('div.lx-look', res.length ? res.map(w => h('button.lx-look-row', { type: 'button', onclick: () => { WB.ui.closePopovers('lx-look'); openWord(w.languageId, w.id); } }, [
          h('b', { text: w.word }), X.posBadge(w.pos), h('span.gk-grow.gk-ellipsis', { text: w.gloss || '—' }), h('span.gk-tiny.gk-muted', { text: w.languageTitle }),
        ])) : [h('div.gk-small.gk-muted.lx-look-none', { text: 'No word or meaning matches “' + q + '”.' + (force ? '' : ' Press Enter to search again.') })]);
        WB.ui.popover(anchor, box, { group: 'lx-look', width: '26em', cls: 'lx-pop' });
      }
      async function openWord(langId, wordId) {
        await select(langId, { tab: 'words' });
        X.tabs.words && X.tabs.words.reveal && X.tabs.words.reveal(L, wordId);
      }
      L.openWord = openWord;

      async function newLanguage(o = {}) {
        let preset = o.preset || 'simple', parent = o.parent || '';
        const nameIn = ui.input({ value: o.title || '', placeholder: 'e.g. Old Marchish, High Elvish, Trade Cant' });
        const grid = h('div.lx-preset-grid');
        const paint = () => {
          GK.clear(grid);
          for (const [k, p] of Object.entries(N().PRESETS)) {
            const sample = N().words(p, { count: 3, seed: k.length * 7 + 3 }).map(w => w.word).join(' · ');
            grid.appendChild(h('button.lx-preset', { type: 'button', class: k === preset ? 'on' : '', 'aria-pressed': String(k === preset), onclick: () => { preset = k; paint(); } }, [
              h('b', { text: p.label }), h('span.gk-small.gk-muted', { text: p.desc }), h('span.lx-preset-sample', { text: sample }),
            ]));
          }
        };
        paint();
        const parentSel = L.langs.length ? ui.select({ value: parent, options: [['', 'None — a language of its own']].concat(L.langs.map(l => [l.id, l.title])), onChange: v => { parent = v; } }) : null;
        nameIn.addEventListener('keydown', e => { if (e.key === 'Enter') { e.preventDefault(); const b = nameIn.closest('.gk-dialog') && nameIn.closest('.gk-dialog').querySelector('.gk-panel-foot .primary'); if (b) b.click(); } });
        const ok = await ui.dialog({ title: 'New language', icon: 'ℒ', body: h('div.lx-newlang', [
          ui.field({ label: 'Name', control: nameIn }),
          ui.field({ label: 'Sounds to start from', hint: 'Every sound, pattern and spelling can be changed on the Phonology tab.', control: grid }),
          parentSel ? ui.field({ label: 'Descends from', control: parentSel }) : null,
        ]), actions: [{ label: 'Cancel', value: false }, { label: 'Create language', kind: 'primary', value: true }] });
        if (!ok) return null;
        const p = Object.assign({}, N().PRESETS[preset]); delete p.label; delete p.desc;
        const e = await WB.api('lexicon.createLanguage', { worldId: WB.worldId, title: nameIn.value.trim() || 'New language', phonology: p, parent: parent || null }).catch(WB.fail);
        if (!e) return null;
        await L.loadLangs();
        await select(e.id, { tab: o.tab || 'phonology' });
        ui.toast('“' + e.title + '” is ready — pick its sounds, then generate words', 'ℒ', 3800);
        return e;
      }
      L.newLanguage = newLanguage;

      /* ---------- the main area ---------- */
      async function select(view, { tab, keepScroll } = {}) {
        L.flush();
        if (L.tabCleanup) { try { L.tabCleanup(); } catch (e) { console.error(e); } L.tabCleanup = null; }
        WB.ui.closePopovers();
        if (view !== 'names' && !L.langs.find(l => l.id === view && WB.visible(l))) view = 'names';
        if (WB.share && SHARE_HIDDEN.includes(tab || S().tab)) tab = 'words';
        if (view !== 'names') lastLang = view;
        const patch = { view };
        if (tab) patch.tab = tab;
        store.patch(patch);
        if (view === 'names') { L.lang = null; L.words = []; }
        else if (!L.lang || L.lang.id !== view) {
          L.lang = await WB.api('entries.get', view).catch(() => null);
          if (!L.lang) return select('names');
          L.lang.data = L.lang.data || {};
          await L.loadWords();
        }
        paintSide();
        await paintMain(keepScroll);
      }
      L.select = select;
      async function paintMain(keepScroll) {
        const view = page.closest('.gk-view'), top = view ? view.scrollTop : 0;
        GK.clear(main);
        if (!L.lang) {
          const host = h('div.lx-tab-host');
          main.appendChild(host);
          L.tabCleanup = X.tabs.names(host, L) || null;
          return;
        }
        main.appendChild(header());
        const host = h('div.lx-tab-host', { dataset: { tab: S().tab } });
        main.appendChild(host);
        const fn = X.tabs[S().tab] || X.tabs.words;
        try { L.tabCleanup = (await fn(host, L)) || null; }
        catch (e) { console.error(e); host.appendChild(ui.panel({ title: 'This tab failed to load', icon: '⚠', body: h('pre.gk-small', { text: String(e && e.stack || e) }) })); }
        if (keepScroll && view) view.scrollTop = top;
      }
      L.refreshTab = () => paintMain(true);
      L.paintSide = paintSide;

      function header() {
        const e = L.lang, info = L.langs.find(l => l.id === e.id) || {}, p = L.phon();
        const parent = e.data.parent ? L.langs.find(l => l.id === e.data.parent) : null;
        const daughters = L.langs.filter(l => l.parentLanguageId === e.id);
        const bits = [
          h('span', { text: WB.fmt.plural(L.words.length, 'word') }),
          h('span', { text: p.consonants.length + ' consonants · ' + p.vowels.length + ' vowels' }),
          e.fields && e.fields.status ? h('span', { text: e.fields.status }) : null,
          e.fields && (e.fields.speakers || []).length ? h('span.gk-row.nowrap.lx-inline', ['spoken by ', ...e.fields.speakers.filter(id => WB.liteOf(id) && WB.visible(WB.liteOf(id))).slice(0, 4).map(id => WB.ui.chip(id, { size: 'sm' }))]) : null,
          parent ? h('span.gk-row.nowrap.lx-inline', ['from ', WB.ui.chip(parent, { size: 'sm', onClick: () => select(parent.id) })]) : null,
          daughters.length ? h('span.gk-row.nowrap.lx-inline', ['daughters ', ...daughters.map(d => WB.ui.chip(d, { size: 'sm', onClick: () => select(d.id) }))]) : null,
        ].filter(Boolean);
        const tabs = h('div.lx-tabs', { role: 'tablist' });
        TABS.forEach(([k, label, ico], i) => {
          if (WB.share && SHARE_HIDDEN.includes(k)) return;
          const b = h('button.lx-tab', { type: 'button', role: 'tab', class: S().tab === k ? 'on' : '', 'aria-selected': String(S().tab === k), title: label + '  (Alt+' + (i + 1) + ')' }, [h('span.lx-tab-ico', { text: ico }), h('span', { text: label })]);
          b.addEventListener('click', () => { if (S().tab !== k) select(e.id, { tab: k }); });
          tabs.appendChild(b);
        });
        const more = ui.button({ icon: '⋯', small: true, kind: 'ghost', title: 'More', onClick: ev => WB.ui.entryMenu(WB.liteOf(e.id) || e, more, [
          { label: 'New daughter language…', icon: '⇝', onClick: () => select(e.id, { tab: 'changes' }) },
          { label: 'New language…', icon: '＋', onClick: () => newLanguage() },
        ]) });
        const head = h('section.gk-panel.lx-head', [
          h('div.lx-head-top', [
            WB.ui.icon(e, 'big'),
            h('div.gk-grow.lx-head-main', [
              h('h2.lx-title', [h('button.lx-title-btn', { type: 'button', title: 'Open “' + e.title + '” in the Codex (Ctrl+click to peek)', text: e.title, onclick: ev => (ev.ctrlKey ? WB.peek(e.id) : WB.open(e.id)) })]),
              h('div.lx-head-meta.gk-small.gk-muted', bits),
              e.summary ? h('div.lx-head-sum.gk-small', { text: e.summary }) : null,
            ]),
            h('div.gk-row.nowrap', [ui.button({ label: 'Entry', icon: '↗', small: true, title: 'Open the language entry (fields, text, links)', onClick: () => WB.open(e.id) }), more]),
          ]),
          tabs,
        ]);
        return head;
      }

      /* ---------- keys ---------- */
      const onKey = e => {
        if (!page.isConnected || document.querySelector('.gk-scrim')) return;
        if (e.altKey && !e.ctrlKey && /^[1-6]$/.test(e.key) && L.lang) { e.preventDefault(); select(L.lang.id, { tab: TABS[+e.key - 1][0] }); }
      };
      document.addEventListener('keydown', onKey);
      offs.push(() => document.removeEventListener('keydown', onKey));

      /* ---------- live data ---------- */
      offs.push(WB.onChange(['entries'], async () => {
        await L.loadLangs();
        if (!page.isConnected) return;
        if (L.lang) {
          if (!L.langs.find(l => l.id === L.lang.id)) { select('names'); return; }
          if (!L.pending) {
            const fresh = await WB.api('entries.get', L.lang.id).catch(() => null);
            if (fresh && L.lang && fresh.id === L.lang.id) {
              const was = JSON.stringify([L.lang.title, L.lang.summary, L.lang.data, L.lang.fields]), now = JSON.stringify([fresh.title, fresh.summary, fresh.data, fresh.fields]);
              L.lang = fresh;
              if (was !== now && !L.pending) { paintSide(); return L.refreshTab(); }
            }
          }
        }
        paintSide();
      }, 200));
      offs.push(WB.onChange(['words'], async () => {
        if (!L.lang || !page.isConnected) return;
        const before = sig(L.words);
        await L.loadWords();
        await L.loadLangs(); paintSide();
        if (sig(L.words) !== before && !(L.editing && L.editing())) L.refreshTab();
      }, 200));
      const mountedWorld = WB.worldId;
      offs.push(WB.on('world', w => { if (w && w.id !== mountedWorld && page.isConnected) GK.shell.go('lexicon'); }));

      await L.loadLangs();
      let first = params.view || params.entryId || S().view;
      if (first !== 'names' && !L.langs.find(l => l.id === first)) first = 'names';
      await select(first, { tab: params.tab || (params.entryId && !params.tab ? 'words' : undefined) });
      if (params.newLanguage) newLanguage({ tab: params.tab });
      if (params.wordId && X.tabs.words.reveal) X.tabs.words.reveal(L, params.wordId);
      if (params.focus === 'add' && X.tabs.words.focusAdd) X.tabs.words.focusAdd(L);
      if (params.text && S().tab === 'translate' && X.tabs.translate.setText) X.tabs.translate.setText(L, params.text);

      return () => { WB.ui.closePopovers(); offs.forEach(f => { try { f(); } catch { } }); if (L.tabCleanup) { try { L.tabCleanup(); } catch { } } L.flush(); live = null; };
    },
  });

  /* ---------------- palette commands ---------------- */
  let lastLang = null;
  const goLang = async (tab, extra) => {
    if (live && live.lang) lastLang = live.lang.id;
    const langs = await WB.api('lexicon.languages', WB.worldId).catch(() => []);
    if (!langs.length) return WB.go('lexicon', { view: 'names', newLanguage: true, tab });
    const want = (langs.find(l => l.id === lastLang) || langs.find(l => l.wordCount) || langs[0]).id;
    return WB.go('lexicon', Object.assign({ entryId: want, tab }, extra || {}));
  };
  WB.commands.add({ id: 'lexicon:word', label: 'New word…', icon: 'ℒ', group: 'Lexicon', words: 'lexicon dictionary add word conlang vocabulary', when: () => !!WB.worldId, run: () => goLang('words', { focus: 'add' }) });
  WB.commands.add({ id: 'lexicon:names', label: 'Generate names', icon: '✦', group: 'Lexicon', words: 'name generator random names character place family', when: () => !!WB.worldId, run: () => WB.go('lexicon', { view: 'names' }) });
  WB.commands.add({ id: 'lexicon:language', label: 'New language…', icon: 'ℒ', group: 'Lexicon', words: 'conlang language phonology create', when: () => !!WB.worldId, run: () => WB.go('lexicon', { view: (live && live.lang && live.lang.id) || 'names', newLanguage: true }) });
  WB.commands.add({ id: 'lexicon:translate', label: 'Translate into a language…', icon: '⇄', group: 'Lexicon', words: 'translate translator conlang phrase gloss', when: () => !!WB.worldId, run: () => goLang('translate') });
  WB.commands.add({ id: 'lexicon:generate', label: 'Generate words from a language', icon: '⚄', group: 'Lexicon', words: 'word generator phonology conlang', when: () => !!WB.worldId, run: () => goLang('generator') });
  WB.commands.add({ id: 'lexicon:changes', label: 'Sound changes: derive a daughter language', icon: '⇝', group: 'Lexicon', words: 'sound change daughter language proto evolve', when: () => !!WB.worldId, run: () => goLang('changes') });

  /* ---------------- smoke steps and checks ---------------- */
  const res = { words: 'did not run', phonology: 'did not run', names: 'did not run', suggest: 'did not run' };
  const waitFor = async (fn, ms = 4000) => { const t0 = Date.now(); while (Date.now() - t0 < ms) { const v = fn(); if (v) return v; await WB.wait(60); } return null; };
  const saltspeak = async () => { const langs = await WB.api('lexicon.languages', WB.worldId); return langs.find(l => l.title === 'Saltspeak') || langs[0] || null; };
  WB.smoke('lexicon-words', async () => {
    const l = await saltspeak();
    if (!l) return (res.words = 'error: the example world has no language');
    await WB.go('lexicon', { entryId: l.id, tab: 'words' });
    const rows = await waitFor(() => document.querySelectorAll('.lx-table .lx-tr[data-id]').length);
    const add = document.querySelector('.lx-add input');
    res.words = rows >= 20 && add ? 'ok: ' + rows + ' rows' : 'error: the lexicon shows ' + rows + ' rows';
    return res.words;
  });
  WB.smoke('lexicon-phonology', async () => {
    const l = await saltspeak();
    if (!l) return (res.phonology = 'error: no language');
    await WB.go('lexicon', { entryId: l.id, tab: 'phonology' });
    const cells = await waitFor(() => document.querySelectorAll('.lx-ipa-cell.on').length);
    const samples = await waitFor(() => document.querySelectorAll('.lx-sample-word').length);
    res.phonology = cells >= 15 && samples >= 8 ? 'ok: ' + cells + ' sounds, ' + samples + ' samples' : 'error: ' + cells + ' sounds lit, ' + samples + ' sample words';
    return res.phonology;
  });
  WB.smoke('lexicon-names', async () => {
    await WB.go('lexicon', { view: 'names' });
    const n = await waitFor(() => document.querySelectorAll('.lx-name-card').length);
    const got = await WB.lexicon.suggest({ kind: 'person', count: 5 });
    const l = await saltspeak();
    const fromLang = l ? await WB.lexicon.suggest({ languageId: l.id, kind: 'place', count: 5 }) : ['skipped'];
    res.names = n >= 6 ? 'ok: ' + n + ' names' : 'error: the name generator shows ' + n + ' names';
    res.suggest = got.length === 5 && fromLang.length === 5 ? 'ok' : 'error: suggest gave ' + got.length + ' / ' + fromLang.length;
    return res.names + '; suggest ' + res.suggest;
  });
  WB.check('lexicon: the sample lexicon shows in an editable table', () => /^ok/.test(res.words));
  WB.check('lexicon: phonology charts and live sample words', () => /^ok/.test(res.phonology));
  WB.check('lexicon: the name generator works without a language', () => /^ok/.test(res.names));
  WB.check('lexicon: WB.lexicon.suggest gives names from a style and from a language', () => /^ok/.test(res.suggest));
})();
