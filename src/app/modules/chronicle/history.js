/* Chronicle history: annals (one entry's history merged from its own dates, events, dated relations, children,
   family, scenes and map borders) and succession (who ruled a realm, reign lengths, gaps and overlaps). */
(function () {
  'use strict';
  const GK = window.GK, WB = window.WB, h = GK.h, ui = GK.ui, CH = WB.chronicle;

  /* ---------------- records → sentences ---------------- */
  const REL = {   // relation label → [start, end] with {o} for the other entry
    'spouse of': ['Married {o}', 'Marriage to {o} ended'],
    'betrothed to': ['Betrothed to {o}', 'Betrothal to {o} ended'],
    'rules': ['Began to rule {o}', 'Rule over {o} ended'],
    'ruled by': ['{o} began to rule', '{o} no longer rules'],
    'leader of': ['Became leader of {o}', 'Stopped leading {o}'],
    'led by': ['{o} took the lead', '{o} no longer leads'],
    'member of': ['Joined {o}', 'Left {o}'],
    'has member': ['{o} joined', '{o} left'],
    'at war with': ['War with {o} began', 'War with {o} ended'],
    'ally of': ['Allied with {o}', 'Alliance with {o} ended'],
    'vassal of': ['Became a vassal of {o}', 'No longer a vassal of {o}'],
    'liege of': ['{o} became a vassal', '{o} is no longer a vassal'],
    'serves': ['Entered the service of {o}', 'Left the service of {o}'],
    'served by': ['{o} entered service', '{o} left service'],
    'lives in': ['Moved to {o}', 'Left {o}'],
    'home of': ['{o} moved here', '{o} moved away'],
    'owns': ['Came to own {o}', 'No longer owns {o}'],
    'owned by': ['Passed to {o}', 'No longer owned by {o}'],
    'founded': ['Founded {o}', ''], 'founded by': ['Founded by {o}', ''],
    'mentor of': ['Began to teach {o}', 'Stopped teaching {o}'],
    'student of': ['Began to study under {o}', 'Finished studying under {o}'],
    'enemy of': ['Became enemies with {o}', 'Enmity with {o} ended'],
    'friend of': ['Became friends with {o}', 'Friendship with {o} ended'],
    'rival of': ['Rivalry with {o} began', 'Rivalry with {o} ended'],
    'lover of': ['Became lovers with {o}', 'Affair with {o} ended'],
  };
  const ROLE = { location: 'took place here', participants: 'took part', cast: 'appears in it', pov: 'its point of view', npcs: 'met in play', places: 'visited in play', mention: 'mentions it', mentioned: 'linked from its text', owner: 'owned it', origin: 'came from here', maker: 'made it', ruler: 'ruled', leader: 'led it', seat: 'its seat', habitat: 'lives here', homeland: 'its homeland', foes: 'foes', giver: 'set in motion', believers: 'believed' };
  const FAMILY = { child: ['Child born', 'Child died'], parent: ['Parent born', 'Parent died'], spouse: ['Spouse born', 'Spouse died'], sibling: ['Sibling born', 'Sibling died'] };
  const KINDS = [['self', 'Its own dates', '◆'], ['event', 'Events', '✷'], ['relation', 'Relations', '⇄'], ['family', 'Family', '☺'], ['child', 'Parts', '⌂'], ['scene', 'Scenes & sessions', '❡'], ['border', 'Maps', '⌖']];
  const kindOf = r => (r.kind === 'session' ? 'scene' : r.kind === 'person' ? 'event' : r.kind);
  const tpl = (s, o) => { const i = s.indexOf('{o}'); return i < 0 ? [s] : [s.slice(0, i), o, s.slice(i + 3)].filter(x => x !== ''); };
  const label = (t, edge) => ((t && t.dated) || {})[edge] || (edge === 'start' ? 'Began' : 'Ended');
  const ref = e => ({ ref: e });

  /** { badge, icon, parts: [string | {ref: lite}], sub, tone } */
  function describe(r, subject) {
    const C = WB.cal, o = r.other, t = o ? WB.typeOf(o) : null;
    const until = r.until ? ' – ' + WB.fmt.date(r.until) + ' (' + CH.dur(r.date.day, r.until.day) + ')' : '';
    switch (r.kind) {
      case 'self': {
        const st = WB.typeOf(subject);
        if (r.edge === 'start') {
          const alive = st && st.lifespan && !subject.end ? 'alive · age ' + C.age(subject.start, WB.now) : r.until ? 'until ' + WB.fmt.date(r.until) + ' · ' + CH.dur(r.date.day, r.until.day) : '';
          return { badge: r.label, icon: '◆', parts: [h('b', { text: subject.title })], sub: alive, tone: 'self' };
        }
        const age = st && st.lifespan && r.since ? 'aged ' + C.age(r.since, r.date) : r.since ? 'after ' + CH.dur(r.since.day, r.date.day) : '';
        return { badge: r.label, icon: '◇', parts: [h('b', { text: subject.title })], sub: age, tone: 'self end' };
      }
      case 'child':
        return { badge: r.label, icon: WB.iconOf(o), parts: [ref(o)].concat(r.at ? [' in ', ref(r.at)] : []), sub: (t ? t.name : '') + (r.edge === 'start' && r.until ? ' · until ' + WB.fmt.date(r.until) : r.edge === 'end' && r.since ? ' · after ' + CH.dur(r.since.day, r.date.day) : ''), tone: 'child' + (r.edge === 'end' ? ' end' : '') };
      case 'event': case 'person': case 'scene': case 'session': {
        const roles = (r.roles || []).map(x => ROLE[x.replace(/^ref:/, '')] || (r.fieldLabels && r.fieldLabels[0] ? r.fieldLabels[0].toLowerCase() : x.replace(/^ref:/, ''))).filter((v, i, a) => a.indexOf(v) === i);
        const badge = r.kind === 'scene' ? 'Scene' : r.kind === 'session' ? 'Session' : t && t.key !== 'event' ? label(t, r.edge) : (o.fields && o.fields.kind) || 'Event';
        const parts = [ref(o)];
        if (r.at) parts.push(' at ', ref(r.at));
        return { badge, icon: WB.iconOf(o), parts, sub: [roles.join(', '), until.replace(/^ – /, 'until '), o.summary].filter(Boolean).join(' · '), tone: r.kind };
      }
      case 'relation': {
        const lbl = r.rel.label, pair = REL[lbl.toLowerCase()];
        const text = pair ? pair[r.edge === 'start' ? 0 : 1] : '';
        const parts = text ? tpl(text, ref(o)) : (r.edge === 'start' ? [lbl + ' ', ref(o)] : ['no longer ' + lbl + ' ', ref(o)]);
        const sub = [r.edge === 'start' && r.until ? 'until ' + WB.fmt.date(r.until) + ' · ' + CH.dur(r.date.day, r.until.day) : r.edge === 'end' && r.since ? 'after ' + CH.dur(r.since.day, r.date.day) : '', r.rel.note].filter(Boolean).join(' · ');
        return { badge: r.edge === 'start' ? 'From' : 'Until', icon: '⇄', parts, sub, tone: 'relation' + (r.edge === 'end' ? ' end' : '') };
      }
      case 'family': {
        const pair = FAMILY[r.role] || ['Relative born', 'Relative died'];
        const age = r.edge === 'end' && o.start ? 'aged ' + C.age(o.start, o.end) : '';
        const subj = subject.start && r.date.day >= subject.start.day ? subject.title + ' was ' + C.age(subject.start, r.date) : '';
        return { badge: 'Family', icon: r.edge === 'end' ? '†' : '☺', parts: [pair[r.edge === 'start' ? 0 : 1] + ': ', ref(o)], sub: [age, subj].filter(Boolean).join(' · '), tone: 'family' + (r.edge === 'end' ? ' end' : '') };
      }
      case 'border': {
        const what = r.item ? (r.item.label ? '“' + r.item.label + '”' : 'its ' + (r.item.kind === 'region' ? 'territory' : r.item.kind)) : 'it';
        return { badge: 'Map', icon: '⌖', parts: r.edge === 'start' ? [what + ' appears on ', ref(o)] : [what + ' disappears from ', ref(o)], sub: r.at ? 'for ' + r.at.title : (r.until ? 'until ' + WB.fmt.date(r.until) : ''), tone: 'border' + (r.edge === 'end' ? ' end' : '') };
      }
      default: return { badge: r.kind, icon: '·', parts: [o ? ref(o) : ''], sub: '' };
    }
  }
  const partsDom = parts => parts.map(p => (p && p.ref ? WB.ui.chip(p.ref, { size: 'sm' }) : p instanceof Node ? p : document.createTextNode(String(p))));
  const partsText = parts => parts.map(p => (p && p.ref ? p.ref.title : p instanceof Node ? p.textContent : String(p))).join('');
  const visibleRec = r => (!r.other || r.kind === 'self' || WB.visible(r.other)) && (!r.at || WB.visible(r.at));

  /* ---------------- the annals renderer (Codex panel and the Annals view) ---------------- */
  /** box: element to fill; id: entry id; opts: { compact, kinds: [] (empty = all), onKinds(kinds), limit } */
  CH.renderAnnals = async function (box, id, opts = {}) {
    let a;
    try { a = await WB.api('chronicle.annals', id); } catch (e) { box.replaceChildren(h('div.gk-small.gk-muted', { text: e.message })); return null; }
    if (!box.isConnected && opts.compact) { /* rendered later into the page: still fill it */ }
    const subject = a.entry, recs = a.records.filter(visibleRec), ties = a.ties.filter(t => WB.visible(t.other));
    const C = WB.cal;
    GK.clear(box);
    box.classList.add('ch-annals');
    box.classList.toggle('compact', !!opts.compact);
    if (!recs.length) {
      box.appendChild(h('div.ch-annals-empty', [
        h('div.gk-small.gk-muted', { text: 'No history yet. Give “' + subject.title + '” a date, link it from dated events (Where / Who), or add start and end dates to its relations — they gather here in order.' }),
        opts.compact ? null : h('div.gk-row', [CH.canEdit() ? ui.button({ label: 'New event about it', icon: '✷', small: true, onClick: async () => { const d = await CH.askDate({ title: 'When?' }); if (d) createEventAbout(subject, d); } }) : null]),
      ]));
      return a;
    }
    const kinds = new Set(opts.kinds || []);
    const shown = recs.filter(r => !kinds.size || kinds.has(kindOf(r)));
    const head = h('div.ch-annals-head', [
      h('div.gk-small.gk-muted', { text: WB.fmt.plural(recs.length, 'record') + ' · ' + WB.fmt.date(recs[0].date) + ' → ' + WB.fmt.date(recs[recs.length - 1].date) + (recs.length > 1 ? ' (' + CH.dur(recs[0].date.day, recs[recs.length - 1].date.day) + ')' : '') }),
      h('span.gk-grow'),
      opts.compact ? ui.button({ label: 'Open in the Chronicle', small: true, kind: 'ghost', icon: '⧉', onClick: () => CH.open({ view: 'annals', entryId: subject.id }) }) : null,
      exportButton(subject, recs, ties),
    ]);
    box.appendChild(head);
    if (!opts.compact) {
      const present = KINDS.filter(([k]) => recs.some(r => kindOf(r) === k));
      if (present.length > 2) box.appendChild(h('div.wb-chips.ch-annals-kinds', [ui.chip({ label: 'All', on: !kinds.size, onClick: () => opts.onKinds && opts.onKinds([]) })].concat(present.map(([k, l, ic]) => ui.chip({ label: ic + ' ' + l + ' ' + recs.filter(r => kindOf(r) === k).length, on: kinds.has(k), onClick: () => { const n = new Set(kinds); n.has(k) ? n.delete(k) : n.add(k); opts.onKinds && opts.onKinds([...n]); } })))));
    }
    const list = h('div.ch-recs');
    const limit = opts.compact ? (opts.limit || 14) : Infinity;
    let era = null, year = null, n = 0, nowShown = false;
    const nowDay = WB.now.day;
    for (const r of shown) {
      if (n >= limit) break;
      const p = C.ymd(r.date.day), er = C.eraOf(p.y);
      if (!nowShown && r.date.day > nowDay) { nowShown = true; list.appendChild(h('div.ch-rec-now', [h('span', { text: 'Now · ' + WB.fmt.date(WB.now) })])); }
      if (!opts.compact && er.index !== era) { era = er.index; list.appendChild(h('div.ch-recs-era', { text: er.name || '' })); }
      if (p.y !== year) { year = p.y; list.appendChild(h('div.ch-recs-year', { text: C.yearText(p.y) })); }
      const d = describe(r, subject);
      const dateTxt = r.date.prec === 'year' ? '' : r.date.prec === 'month' ? C.monthName(p.m) : p.d + ' ' + C.monthName(p.m);
      list.appendChild(h('div.ch-rec', { class: d.tone + (r.date.day > nowDay ? ' future' : ''), style: { '--c': r.other ? WB.colorOf(r.other) : 'var(--accent)' } }, [
        h('div.ch-rec-date', { text: dateTxt, title: WB.fmt.date(r.date, 'full') }),
        h('div.ch-rec-dot', { text: d.icon }),
        h('div.ch-rec-body', [
          h('div.ch-rec-line', [h('span.ch-kind', { text: d.badge }), ...partsDom(d.parts)]),
          d.sub ? h('div.ch-rec-sub.gk-small.gk-muted', { text: d.sub }) : null,
        ]),
      ]));
      n++;
    }
    if (!nowShown && shown.length && shown[shown.length - 1].date.day <= nowDay && !opts.compact) list.appendChild(h('div.ch-rec-now', [h('span', { text: 'Now · ' + WB.fmt.date(WB.now) })]));
    box.appendChild(list);
    if (shown.length > n) box.appendChild(h('div.ch-more-row', [ui.button({ label: 'Show all ' + shown.length + ' in the Chronicle', small: true, onClick: () => CH.open({ view: 'annals', entryId: subject.id }) })]));
    if (!opts.compact && ties.length) {
      box.appendChild(h('div.ch-ties', [
        h('div.ch-side-h', { text: 'Undated ties' }),
        h('div.gk-tiny.gk-muted', { text: 'Relations without dates. Give them a start or end in the entry’s Relations to place them in this history.' }),
        h('div.wb-chips', ties.map(t => h('span.wb-rel-pill', [h('span.gk-small.gk-muted', { text: t.rel.label + ' ' }), WB.ui.chip(t.other, { size: 'sm' })]))),
      ]));
    }
    return a;
  };

  /** the visible history of an entry as 'md' or 'html' */
  CH.annalsText = async (id, kind) => {
    const a = await WB.api('chronicle.annals', id);
    const recs = a.records.filter(visibleRec), ties = a.ties.filter(t => WB.visible(t.other));
    return kind === 'html' ? annalsHtml(a.entry, recs, ties) : annalsMd(a.entry, recs, ties);
  };
  function exportButton(subject, recs, ties) {
    const b = ui.button({ icon: '⇩', small: true, kind: 'ghost', title: 'Copy, save or print this history', onClick: () => CH.exportMenu(b, { title: subject.title + ' — Annals', md: () => annalsMd(subject, recs, ties), html: () => annalsHtml(subject, recs, ties) }) });
    return b;
  }
  function annalsMd(subject, recs, ties) {
    const C = WB.cal, t = WB.typeOf(subject);
    const out = ['# ' + subject.title + ' — Annals', '', '_' + [t && t.name, WB.fmt.span(subject), (WB.world && WB.world.name)].filter(Boolean).join(' · ') + '_', ''];
    if (subject.summary) out.push('> ' + CH.mdEsc(subject.summary), '');
    let year = null;
    for (const r of recs) {
      const p = C.ymd(r.date.day);
      if (p.y !== year) { year = p.y; out.push('', '## ' + C.yearText(p.y)); }
      const d = describe(r, subject);
      out.push('- **' + WB.fmt.date(r.date) + '** — ' + d.badge + ': ' + CH.mdEsc(partsText(d.parts)) + (d.sub ? ' _(' + CH.mdEsc(d.sub) + ')_' : ''));
    }
    if (ties.length) { out.push('', '## Undated ties'); for (const x of ties) out.push('- ' + x.rel.label + ' ' + CH.mdEsc(x.other.title)); }
    return out.join('\n') + '\n';
  }
  function annalsHtml(subject, recs, ties) {
    const C = WB.cal, t = WB.typeOf(subject);
    let body = '<h1>' + WB.esc(subject.title) + '</h1><p class="sub">' + WB.esc([t && t.name, WB.fmt.span(subject), WB.world && WB.world.name].filter(Boolean).join(' · ')) + '</p>';
    if (subject.summary) body += '<p><i>' + WB.esc(subject.summary) + '</i></p>';
    let year = null;
    for (const r of recs) {
      const p = C.ymd(r.date.day);
      if (p.y !== year) { year = p.y; body += '<h2>' + WB.esc(C.yearText(p.y)) + '</h2>'; }
      const d = describe(r, subject);
      body += '<div class="rec"><div class="d">' + WB.esc(WB.fmt.date(r.date)) + '</div><div><span class="k">' + WB.esc(d.badge) + '</span>' + WB.esc(partsText(d.parts)) + (d.sub ? '<div class="s">' + WB.esc(d.sub) + '</div>' : '') + '</div></div>';
    }
    if (ties.length) body += '<h2>Undated ties</h2><p>' + ties.map(x => WB.esc(x.rel.label + ' ' + x.other.title)).join(' · ') + '</p>';
    return CH.htmlDoc(subject.title + ' — Annals', body);
  }
  async function createEventAbout(subject, date) {
    const t = WB.typeOf(subject) || {};
    const fields = t.key === 'place' ? { location: subject.id } : (t.key === 'character' || t.key === 'faction') ? { participants: [subject.id] } : {};
    const e = await WB.ui.createDialog({ type: 'event', start: date, fields, open: false });
    if (e) { CH.invalidate(); WB.peek(e.id); }
  }

  /* ---------------- an entry picker list (Annals and Succession) ---------------- */
  function pickerList({ selected, onPick, prefer, extra }) {
    const box = h('div.ch-pick');
    const list = h('div.ch-pick-list');
    let q = '';
    const search = WB.ui.search({ placeholder: 'Find an entry…', onInput: v => { q = v.trim().toLowerCase(); paint(); } });
    const paint = () => {
      GK.clear(list);
      const all = WB.titles.filter(t => WB.visible(t));
      const groups = prefer.map(k => WB.type(k)).filter(Boolean);
      if (extra && extra.length && !q) {
        list.appendChild(h('div.ch-pick-h', { text: extra.title || 'Suggested' }));
        for (const e of extra) list.appendChild(WB.ui.row(e, { active: e.id === selected, sub: e.sub || null, onClick: () => onPick(e.id), menu: true }));
      }
      for (const t of groups) {
        const items = all.filter(e => e.typeId === t.id && (!q || e.title.toLowerCase().includes(q) || (e.aliases || []).some(a => a.toLowerCase().includes(q))));
        if (!items.length) continue;
        list.appendChild(h('div.ch-pick-h', { text: t.icon + ' ' + t.plural }));
        for (const e of items.slice(0, q ? 40 : 14)) list.appendChild(WB.ui.row(e, { active: e.id === selected, sub: '', onClick: () => onPick(e.id) }));
      }
      if (!list.childElementCount) list.appendChild(h('div.gk-small.gk-muted.ch-pick-none', { text: q ? 'Nothing matches “' + q + '”.' : 'No entries yet.' }));
    };
    box.append(search, list, ui.button({ label: 'Any entry…', icon: '⌕', small: true, kind: 'ghost', onClick: async () => { const p = await WB.ui.pickEntry({ title: 'Choose an entry' }); if (p) onPick(p.id); } }));
    paint();
    box._paint = paint;
    return box;
  }

  /* ================= the Annals view ================= */
  CH.views.annals = {
    async mount(host, env) {
      const st = env.state.annals;
      let id = env.params.entryId || st.id;
      if (id && !WB.liteOf(id)) id = null;
      if (!id) { const s = (await WB.api('chronicle.realms', WB.worldId).catch(() => []))[0]; id = s ? s.id : null; }
      const side = h('div.ch-hist-side');
      const main = h('div.ch-hist-main');
      host.appendChild(h('div.ch-hist', [ui.panel({ cls: 'ch-hist-pick', title: 'Whose history?', icon: '⧉', body: [side] }), main]));
      const pick = pickerList({ selected: id, prefer: ['faction', 'place', 'character', 'event', 'item', 'species', 'culture'], onPick: v => { id = v; st.id = v; env.save(); pick._sel(v); paint(); } });
      pick._sel = v => pick.querySelectorAll('.wb-row').forEach(r => r.classList.toggle('on', r.dataset.id === v));
      side.appendChild(pick);
      async function paint() {
        GK.clear(main);
        if (!id) { main.appendChild(ui.panel({ body: [WB.ui.empty({ icon: '⧉', title: 'Pick an entry', text: 'Choose a nation, house, city or person on the left: its history is gathered from its own dates, the events it takes part in, its dated relations (reigns, memberships, marriages), the places inside it, scenes set there and its borders on the maps.' })] })); return; }
        const e = await WB.api('entries.lite', id).catch(() => null);
        if (!e || !WB.visible(e)) { main.appendChild(ui.panel({ body: [WB.ui.empty({ icon: '◑', title: 'Not available', text: 'This entry is hidden or gone.' })] })); return; }
        const t = WB.typeOf(e);
        const box = h('div');
        const header = h('div.ch-hist-head', { style: { '--c': WB.colorOf(e) } }, [
          WB.ui.icon(e, 'big'),
          h('div.gk-grow', [h('h2', { text: e.title }), h('div.gk-small.gk-muted', { text: [t && t.name, CH.when(e)].filter(Boolean).join(' · ') }), e.summary ? h('p.gk-small.ch-hist-sum', { text: e.summary }) : null]),
          h('div.gk-row.nowrap', [
            ui.button({ label: 'Open', small: true, icon: '↗', onClick: () => WB.open(e.id) }),
            ui.button({ label: 'Timeline', small: true, kind: 'ghost', icon: '⟷', title: 'Show it on the timeline', onClick: () => env.go('timeline', { entryId: e.id }) }),
            /^(place|faction)$/.test(t && t.key) ? ui.button({ label: 'Succession', small: true, kind: 'ghost', icon: '♛', onClick: () => env.go('succession', { entryId: e.id }) }) : null,
            CH.canEdit() ? ui.button({ label: 'Add event', small: true, kind: 'ghost', icon: '✷', title: 'A new event about it, at a date', onClick: async () => { const d = await CH.askDate({ title: 'When did it happen?', ok: 'Next' }); if (d) createEventAbout(e, d); } }) : null,
          ]),
        ]);
        main.appendChild(ui.panel({ cls: 'ch-hist-panel', body: [header, box] }));
        await CH.renderAnnals(box, id, { kinds: st.kinds, onKinds: k => { st.kinds = k; env.save(); paint(); } });
      }
      await paint();
      return { refresh: () => { pick._paint(); pick._sel(id); return paint(); } };
    },
  };

  /* ================= Succession ================= */
  CH.views.succession = {
    async mount(host, env) {
      const st = env.state.succ;
      let realms = await WB.api('chronicle.realms', WB.worldId).catch(() => []);
      realms = realms.filter(r => WB.visible(r));
      let id = env.params.entryId || st.id || (realms[0] && realms[0].id) || null;
      if (id && !WB.liteOf(id)) id = realms[0] ? realms[0].id : null;
      const side = h('div.ch-hist-side');
      const main = h('div.ch-hist-main');
      host.appendChild(h('div.ch-hist', [ui.panel({ cls: 'ch-hist-pick', title: 'Which realm?', icon: '♛', body: [side] }), main]));
      const extra = realms.map(r => Object.assign({}, r, { sub: WB.fmt.plural(r.rulers, 'ruler') }));
      extra.title = 'With rulers';
      const pick = pickerList({ selected: id, prefer: ['place', 'faction'], extra, onPick: v => { id = v; st.id = v; env.save(); pick._sel(v); paint(); } });
      pick._sel = v => pick.querySelectorAll('.wb-row').forEach(r => r.classList.toggle('on', r.dataset.id === v));
      side.appendChild(pick);
      async function paint() {
        GK.clear(main);
        if (!id) { main.appendChild(ui.panel({ body: [WB.ui.empty({ icon: '♛', title: 'No realms yet', text: 'A succession comes from relations: a character (or a house) "rules" a place or is "leader of" a faction, with start and end dates. Pick a place or faction to add its first ruler.' })] })); return; }
        const s = await WB.api('chronicle.succession', id).catch(e => { WB.fail(e); return null; });
        if (!s) return;
        const realm = s.realm, C = WB.cal;
        const reigns = s.reigns.filter(r => WB.visible(r.ruler));
        const undated = s.undated.filter(r => WB.visible(r.ruler));
        const t = WB.typeOf(realm);
        const relName = t && t.key === 'faction' ? 'leader of' : 'rules';
        const head = h('div.ch-hist-head', { style: { '--c': WB.colorOf(realm) } }, [
          WB.ui.icon(realm, 'big'),
          h('div.gk-grow', [h('h2', { text: 'Rulers of ' + realm.title }), h('div.gk-small.gk-muted', { text: reigns.length ? WB.fmt.plural(reigns.length, 'reign') + ' since ' + WB.cal.yearText(WB.cal.ymd(reigns[0].start != null ? reigns[0].start : reigns[0].end).y) + (s.gaps.length ? ' · ' + WB.fmt.plural(s.gaps.length, 'gap') : '') + (s.overlaps.length ? ' · ' + WB.fmt.plural(s.overlaps.length, 'overlap') : '') : 'No dated reigns yet' })]),
          h('div.gk-row.nowrap', [
            CH.canEdit() ? ui.button({ label: 'Add a reign', small: true, icon: '＋', onClick: () => addReign(realm, relName) }) : null,
            ui.button({ label: 'History', small: true, kind: 'ghost', icon: '⧉', onClick: () => env.go('annals', { entryId: realm.id }) }),
            succExport(realm, reigns, s),
          ]),
        ]);
        const body = [head];
        if (reigns.length) body.push(gantt(reigns, s));
        const list = h('div.ch-reigns');
        reigns.forEach((r, i) => {
          list.appendChild(reignRow(r, i + 1, realm));
          const gap = s.gaps.find(g => g.after === r.id);
          if (gap) list.appendChild(h('div.ch-reign-gap', [h('span.ch-warn-ico', { text: '⚠' }), h('div', [h('b', { text: 'Interregnum · ' + gap.length }), h('div.gk-small.gk-muted', { text: relDate(gap.from) + ' – ' + relDate(gap.to) + ' · nobody holds ' + realm.title + '. A regent, a disputed claim, or a missing record?' })])]));
          const ov = s.overlaps.find(g => g.a === r.id);
          if (ov) list.appendChild(h('div.ch-reign-gap.overlap', [h('span.ch-warn-ico', { text: '⚠' }), h('div', [h('b', { text: 'Overlap · ' + ov.length }), h('div.gk-small.gk-muted', { text: 'Two rulers at once from ' + relDate(ov.from) + ': a co-rule, a usurper, or a date to fix?' })])]));
        });
        if (reigns.length) body.push(list);
        if (undated.length) body.push(h('div.ch-ties', [h('div.ch-side-h', { text: 'Without dates' }), h('div.gk-tiny.gk-muted', { text: 'Named as ruler, but not yet placed in time. Give the relation a start (and end) date to add it to the line.' }), h('div.ch-reigns', undated.map(r => reignRow(r, null, realm)))]));
        if (!reigns.length && !undated.length) body.push(WB.ui.empty({ icon: '♛', title: 'Nobody has ruled ' + realm.title + ' yet', text: 'Add a reign: who ruled, from when, until when. It is stored as a "' + relName + '" relation with dates, and shows in both entries.', actions: CH.canEdit() ? [ui.button({ label: 'Add a reign', kind: 'primary', onClick: () => addReign(realm, relName) })] : [] }));
        main.appendChild(ui.panel({ cls: 'ch-hist-panel', body }));
      }
      function reignRow(r, n, realm) {
        const C = WB.cal;
        const until = r.end != null ? WB.fmt.date({ day: r.end, prec: r.inferredEnd ? 'day' : 'day' }) : r.ongoing && r.start != null ? 'today' : '';
        const notes = [];
        if (r.ageAtStart != null) notes.push('came to power aged ' + r.ageAtStart);
        if (r.diedDay != null && r.end != null && Math.abs(r.diedDay - r.end) <= 1) notes.push('ruled until death');
        if (r.inferredEnd) notes.push('ends when the next reign begins');
        if (r.field) notes.push('from the ' + r.rel + ' field');
        if (r.note) notes.push(r.note);
        const row = h('div.ch-reign', { class: (r.ongoing ? 'ongoing ' : '') + (n == null ? 'undated' : ''), style: { '--c': WB.colorOf(r.ruler) } }, [
          h('div.ch-reign-n', { text: n == null ? '·' : String(n) }),
          h('div.ch-reign-who', [WB.ui.chip(r.ruler, { size: 'sm' }), h('div.gk-tiny.gk-muted', { text: r.rel + (r.ruler.start && r.ruler.end ? ' · ' + WB.fmt.span(r.ruler, 'short') : r.ruler.start ? ' · born ' + WB.fmt.date(r.ruler.start, 'short') : '') })]),
          h('div.ch-reign-when', [h('div', { text: r.start != null ? relDate(r.start) + ' – ' + (r.end != null ? relDate(r.end) : until) : 'undated' }), h('div.gk-tiny.gk-muted', { text: notes.join(' · ') })]),
          h('div.ch-reign-len', [h('b', { text: r.length || '' }), r.ongoing && r.start != null ? h('div.gk-tiny.wb-badge.accent', { text: 'reigning' }) : null]),
          CH.canEdit() && !r.field ? ui.button({ icon: '✎', small: true, kind: 'ghost', title: 'Change the dates of this reign', onClick: () => editReign(r) }) : h('span'),
        ]);
        return row;
      }
      function gantt(reigns, s) {
        const now = WB.now.day;
        const lo = Math.min(...reigns.map(r => r.start != null ? r.start : r.end));
        const hi = Math.max(now, ...reigns.map(r => (r.end != null ? r.end : now)));
        const span = Math.max(1, hi - lo), X = d => ((d - lo) / span) * 100;
        const strip = h('div.ch-gantt');
        for (const g of s.gaps) strip.appendChild(h('div.ch-gantt-gap', { style: { left: X(g.from) + '%', width: Math.max(.4, X(g.to) - X(g.from)) + '%' }, title: 'Interregnum: ' + g.length }));
        reigns.forEach((r, i) => {
          const a = r.start != null ? r.start : r.end, b = r.end != null ? r.end : now;
          const el = h('div.ch-gantt-bar', { class: (i % 2 ? 'alt ' : '') + (r.ongoing ? 'ongoing' : ''), style: { left: X(a) + '%', width: Math.max(.6, X(b) - X(a)) + '%', '--c': WB.colorOf(r.ruler) }, title: r.ruler.title + ' · ' + (r.length || '') }, [h('span.gk-ellipsis', { text: r.ruler.title })]);
          el.addEventListener('click', ev => (ev.ctrlKey ? WB.peek(r.ruler.id) : WB.peek(r.ruler.id)));
          el.addEventListener('dblclick', () => WB.open(r.ruler.id));
          strip.appendChild(el);
        });
        const C = WB.cal;
        return h('div.ch-gantt-wrap', [strip, h('div.ch-gantt-axis', [h('span', { text: C.yearText(C.ymd(lo).y) }), h('span', { text: C.yearText(C.ymd(hi).y) })])]);
      }
      function succExport(realm, reigns, s) {
        const md = () => ['# Rulers of ' + realm.title, ''].concat(reigns.map((r, i) => (i + 1) + '. **' + CH.mdEsc(r.ruler.title) + '** — ' + (r.start != null ? relDate(r.start) : '?') + ' – ' + (r.end != null ? relDate(r.end) : 'today') + (r.length ? ' (' + r.length + ')' : '') + (s.gaps.find(g => g.after === r.id) ? '\n   - _Interregnum: ' + s.gaps.find(g => g.after === r.id).length + '_' : ''))).join('\n') + '\n';
        const html = () => CH.htmlDoc('Rulers of ' + realm.title, '<h1>Rulers of ' + WB.esc(realm.title) + '</h1><table><tr><th>#</th><th>Ruler</th><th>Reign</th><th>Length</th></tr>' +
          reigns.map((r, i) => '<tr><td>' + (i + 1) + '</td><td><b>' + WB.esc(r.ruler.title) + '</b></td><td>' + WB.esc((r.start != null ? relDate(r.start) : '?') + ' – ' + (r.end != null ? relDate(r.end) : 'today')) + '</td><td>' + WB.esc(r.length || '') + '</td></tr>' + (s.gaps.find(g => g.after === r.id) ? '<tr><td></td><td colspan="3" class="warn">Interregnum: ' + WB.esc(s.gaps.find(g => g.after === r.id).length) + '</td></tr>' : '')).join('') + '</table>');
        const b = ui.button({ icon: '⇩', small: true, kind: 'ghost', title: 'Copy, save or print the succession', onClick: () => CH.exportMenu(b, { title: 'Rulers of ' + realm.title, md, html }) });
        return b;
      }
      async function addReign(realm, relName) {
        const ruler = await WB.ui.pickEntry({ title: 'Who ruled ' + realm.title + '?', types: ['character', 'faction'].map(k => WB.type(k)).filter(Boolean).map(t => t.id), allowCreate: true });
        if (!ruler) return;
        const span = await spanDialog('Reign of ' + ruler.title, null, null);
        if (!span) return;
        const rel = WB.relByName(relName) || WB.relByName('rules');
        if (!rel) return ui.toast('This world has no "' + relName + '" relation type', '⚠');
        try {
          const l = await WB.api('links.relate', { src: ruler.id, dst: realm.id, relId: rel.id, start: span.start, end: span.end });
          WB.ui.undoToast(ruler.title + ' now ' + relName + ' ' + realm.title, () => WB.api('links.remove', l.id));
        } catch (e) { WB.fail(e); }
      }
      async function editReign(r) {
        const span = await spanDialog('Reign of ' + r.ruler.title, r.start != null ? { day: r.start, prec: 'day' } : null, r.end != null && !r.inferredEnd ? { day: r.end, prec: 'day' } : null);
        if (!span) return;
        const old = { start: r.start != null ? { day: r.start } : null, end: r.end != null && !r.inferredEnd ? { day: r.end } : null };
        await WB.api('links.update', r.id, { start: span.start, end: span.end });
        WB.ui.undoToast('Reign of ' + r.ruler.title + ' changed', () => WB.api('links.update', r.id, old));
      }
      await paint();
      return { refresh: async () => { realms = (await WB.api('chronicle.realms', WB.worldId).catch(() => [])).filter(r => WB.visible(r)); pick._paint(); pick._sel(id); return paint(); } };
    },
  };

  /** a relation day as the calendar would say it (first day of a year → the year, of a month → the month) */
  function relDate(day) {
    const p = WB.cal.ymd(day);
    return WB.fmt.date({ day, prec: p.doy === 0 ? 'year' : p.d === 1 ? 'month' : 'day' });
  }
  CH.relDate = relDate;

  /** start and end dates → { start, end } | null */
  function spanDialog(title, start, end) {
    let s = start, e = end;
    const body = h('div.ch-span-dlg', [
      ui.field({ label: 'From', control: WB.ui.dateInput({ value: s, onChange: v => { s = v; } }) }),
      ui.field({ label: 'Until', hint: 'Leave empty while it lasts.', control: WB.ui.dateInput({ value: e, onChange: v => { e = v; } }) }),
    ]);
    return ui.dialog({ title, icon: '♛', body, actions: [{ label: 'Cancel', value: false }, { label: 'Save', kind: 'primary', value: true }] }).then(ok => {
      if (!ok) return null;
      body.querySelectorAll('input').forEach(i => i.dispatchEvent(new Event('change')));
      if (s && e && e.day < s.day) { ui.toast('The end comes before the start', '⚠'); return null; }
      return { start: s, end: e };
    });
  }
})();
