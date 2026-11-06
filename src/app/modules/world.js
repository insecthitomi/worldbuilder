/* World: settings for the open world (info, calendar, types & fields, relations, tags), every world, backups, data. */
(function () {
  'use strict';
  const GK = window.GK, WB = window.WB, h = GK.h, ui = GK.ui;
  const SYMBOLS = '◎ ≈ ✦ ✧ ❖ ⚔ ⚑ ⌂ ♛ ☾ ☀ ★ ✶ ❄ ☘ ♜ ⛵ ⚓ ☠ ⚗ ⚙ ⌖ ☍ ∞ Ω Δ Σ λ ¤ ✚ ⬢ ⬡ ◆ ● ▲ ♠ ♣ ♥ ♦ ❦ ✿ ⚘ ⚡ ☄ ♨ ✎ ✉ ⚄ ♞ ⌛ ♪ ☺ ⛫ ⚚ ⚖ ⚒ ⛏'.split(' ');
  const PRESETS = {
    earth: { label: 'Earth (Gregorian)', cal: () => WB.Cal.DEFAULT },
    tides: { label: 'Ten long months, six-day weeks', cal: () => ({ months: ['Thaw', 'Brine', 'Gullsong', 'Highsun', 'Saltreap', 'Ember', 'Fogmoon', 'Gale', 'Frostmere', 'Deepwinter'].map(name => ({ name, days: 36 })), weekdays: ['Moonday', 'Tideday', 'Saltday', 'Windday', 'Stoneday', 'Restday'], leap: { every: 4, month: 9, days: 1 }, eras: [{ name: 'First Age', abbr: 'FA', start: 1 }], before: { name: 'Before Reckoning', abbr: 'BR' }, moons: [{ name: 'Pale Mother', cycle: 30, offset: 0 }, { name: 'Red Wanderer', cycle: 47.3, offset: 11, color: '#d0574e' }], seasons: [{ name: 'Spring', month: 0, day: 1 }, { name: 'Summer', month: 3, day: 1 }, { name: 'Autumn', month: 6, day: 1 }, { name: 'Winter', month: 8, day: 1 }] }) },
    thirteen: { label: 'Thirteen moons of 28 days + Year Day', cal: () => ({ months: ['Wolf', 'Snow', 'Worm', 'Pink', 'Flower', 'Strawberry', 'Buck', 'Sturgeon', 'Corn', 'Harvest', 'Hunter', 'Beaver', 'Cold'].map(n => ({ name: n + ' Moon', short: n, days: 28 })).concat([{ name: 'Year Day', days: 1 }]), weekdays: ['Sunday', 'Moonday', 'Fireday', 'Waterday', 'Woodday', 'Goldday', 'Earthday'], leap: { every: 4, month: 13, days: 1 }, eras: [{ name: 'Common Reckoning', abbr: 'CR', start: 1 }], before: null, moons: [{ name: 'Moon', cycle: 28, offset: 0 }], seasons: [] }) },
    festival: { label: 'Twelve months of 30 + five festival days', cal: () => ({ months: ['Hammer', 'Alturiak', 'Ches', 'Tarsakh', 'Mirtul', 'Kythorn', 'Flamerule', 'Eleasis', 'Eleint', 'Marpenoth', 'Uktar', 'Nightal'].map((n, i) => ({ name: ['Frostfall', 'Deepcold', 'Thawing', 'Rainsend', 'Blossom', 'Highgrass', 'Sunpeak', 'Goldfield', 'Leaffall', 'Harvestmoon', 'Mistreach', 'Longnight'][i], days: 30 })).concat([{ name: 'Festival Days', days: 5 }]), weekdays: ['First', 'Second', 'Third', 'Fourth', 'Fifth', 'Sixth', 'Seventh', 'Eighth', 'Ninth', 'Tenth'], leap: { every: 4, month: 12, days: 1 }, eras: [{ name: 'Dale Reckoning', abbr: 'DR', start: 1 }], before: { name: 'Before Reckoning', abbr: 'BR' }, moons: [{ name: 'Selune', cycle: 30.4375, offset: 0 }], seasons: [{ name: 'Spring', month: 2, day: 19 }, { name: 'Summer', month: 5, day: 20 }, { name: 'Autumn', month: 8, day: 21 }, { name: 'Winter', month: 11, day: 20 }] }) },
    simple: { label: 'Simple: twelve months of 30, no weeks', cal: () => ({ months: Array.from({ length: 12 }, (_, i) => ({ name: 'Month ' + (i + 1), days: 30 })), weekdays: [], leap: null, eras: [{ name: 'Year', abbr: 'Y', start: 1 }], before: { name: 'Before', abbr: 'BY' }, moons: [], seasons: [] }) },
  };
  const FIELDSETS = {
    'Physical description': [['Height', 'text'], ['Build', 'text'], ['Eyes', 'text'], ['Hair', 'text'], ['Distinguishing marks', 'longtext']],
    'Game stats': [['Stats', 'stats'], ['Challenge', 'number'], ['Attack roll', 'dice'], ['Damage', 'dice']],
    'Economy': [['Exports', 'list'], ['Imports', 'list'], ['Currency', 'text'], ['Wealth', 'rating']],
    'Story beats': [['Want', 'longtext'], ['Need', 'longtext'], ['Arc', 'longtext'], ['First appears', 'ref']],
    'Government': [['Government', 'choice', ['Monarchy', 'Republic', 'Council', 'Theocracy', 'Oligarchy', 'Tribal', 'Anarchy', 'Empire']], ['Ruler', 'ref'], ['Laws', 'list']],
    'Sources': [['Inspiration', 'longtext'], ['Links', 'url']],
  };

  /* Settings are grouped: three sections, each with a few parts. The stored/deep-linked value is the part's key (tab: 'calendar'). */
  const SECTIONS = [
    ['world', 'World', 'The name, summary and calendar of the open world.', [
      ['world', 'Details', 'Name, icon, cover, summary and the defaults for new entries.'],
      ['calendar', 'Calendar', 'Months, weeks, eras, moons and seasons: every date in the app uses it.'],
    ]],
    ['structure', 'Structure', 'How entries are built and connected.', [
      ['types', 'Types & fields', 'The kinds of entry and the fields each one has.'],
      ['people', 'People & attributes', 'Race, class, caste and any other classification of people, their attribute systems, modifiers and own words.'],
      ['relations', 'Relations', 'The kinds of link between two entries.'],
      ['tags', 'Tags', 'Every tag in this world: rename, merge or remove.'],
    ]],
    ['data', 'Data', 'Your worlds and their safety copies.', [
      ['worlds', 'All worlds', 'Open, create, copy or delete worlds.'],
      ['backups', 'Backups', 'Saved copies of this world: make one now or restore one.'],
      ['data', 'Data tools', 'Move data in and out, find and replace, and clean up.'],
    ]],
  ];
  const sectionOf = leaf => SECTIONS.find(s => s[3].some(p => p[0] === leaf));
  WB.worldTabs = { sections: SECTIONS, sectionOf: leaf => { const s = sectionOf(leaf); return s ? s[0] : null; } };

  GK.modules.register({
    id: 'world',
    title: 'World settings',
    icon: '◎',
    order: 900,
    foot: true,
    subtitle: 'Calendar, types and fields, relations, tags, worlds and backups.',
    async mount(page, ctx) {
      const st = await WB.store(ctx, { tab: 'world' });
      const params = WB.params('world') || {};
      if (params.tab) st.patch({ tab: params.tab });
      const sections = WB.worldId ? SECTIONS : SECTIONS.filter(s => s[0] === 'data');
      const leaves = WB.worldId ? null : ['worlds', 'backups', 'data'];
      const body = h('div.wd-body');
      const sub = h('div.wd-sub');
      const secBox = h('div.wd-tabs');
      const offs = [];
      let alive = true;
      const leafOk = l => !!sectionOf(l) && (!leaves || leaves.includes(l));
      const cur = () => (leafOk(st.get().tab) ? st.get().tab : (leaves ? 'worlds' : 'world'));
      const paintSections = () => {
        GK.clear(secBox);
        secBox.appendChild(ui.tabs({ tabs: sections.map(s => [s[0], s[1]]), value: sectionOf(cur())[0], onChange: key => { const sec = sections.find(s => s[0] === key); show(sec[3][0][0]); } }));
      };
      const paintSub = () => {
        GK.clear(sub);
        const sec = sectionOf(cur()), parts = sec[3].filter(p => !leaves || leaves.includes(p[0]));
        const part = parts.find(p => p[0] === cur());
        if (parts.length > 1) sub.appendChild(h('div.wd-chips', { role: 'group', 'aria-label': sec[1] }, parts.map(p => ui.chip({ label: p[1], on: p[0] === cur(), onClick: () => show(p[0]) }))));
        sub.appendChild(h('p.gk-small.gk-muted.wd-desc', { text: part[2] }));
      };
      const show = tab => {
        if (!leafOk(tab)) tab = cur();
        st.patch({ tab });
        paintSections(); paintSub();
        GK.clear(body);
        const fn = { world: tabWorld, calendar: tabCalendar, types: tabTypes, people: (b, p) => WB.traitsTab(b, p), relations: tabRelations, tags: tabTags, worlds: tabWorlds, backups: tabBackups, data: tabData }[tab] || tabWorld;
        Promise.resolve(fn(body, params)).catch(e => { body.appendChild(ui.panel({ title: 'Something went wrong', icon: '⚠', body: h('pre.gk-small', { text: String(e && e.stack || e) }) })); });
        params.typeId = params.typeId && tab === 'types' ? params.typeId : null;
      };
      page.append(secBox, sub, body);
      show(cur());
      offs.push(WB.on('world', () => { if (alive && document.activeElement && !body.contains(document.activeElement)) show(st.get().tab); }));
      return () => { alive = false; offs.forEach(f => f()); };
    },
  });

  /* ---------------- this world ---------------- */
  async function tabWorld(box) {
    const w = await WB.api('worlds.get', WB.worldId);
    const save = WB.debounce(p => WB.api('worlds.update', WB.worldId, p).then(() => WB.reloadWorld()).catch(WB.fail), 500);
    const setting = (k, v) => save({ settings: { [k]: v } });
    const iconBtn = h('button.wd-icon', { type: 'button', text: w.icon || '◎', style: { '--c': w.color || 'var(--accent)' }, title: 'Choose an icon', onclick: ev => {
      let pop;
      pop = WB.ui.popover(ev.currentTarget, h('div.cx-symgrid', SYMBOLS.map(s => h('button', { type: 'button', text: s, onclick: () => { iconBtn.textContent = s; save({ icon: s }); pop.close(); } }))), { width: '20em' });
    } });
    const styles = Object.entries(WB.names.STYLES).map(([k, s]) => [k, s.label]);
    const cover = h('div.wd-cover');
    const paintCover = () => {
      GK.clear(cover);
      GK.append(cover, [w.coverId ? WB.ui.thumb(w.coverId, { cls: 'wd-cover-img' }) : h('div.wd-cover-none.gk-muted.gk-small', { text: 'No cover yet' }),
        h('div.gk-row', [ui.button({ label: w.coverId ? 'Change cover…' : 'Choose a cover…', small: true, onClick: async () => { const m = await WB.ui.pickMedia({ kind: 'image', title: 'World cover' }); if (m) { w.coverId = m.id; await WB.api('worlds.update', WB.worldId, { coverId: m.id }); paintCover(); } } }),
          w.coverId ? ui.button({ label: 'Remove', small: true, kind: 'ghost', onClick: async () => { w.coverId = null; await WB.api('worlds.update', WB.worldId, { coverId: null }); paintCover(); } }) : null])]);
    };
    paintCover();
    const summary = ui.input({ multiline: true, rows: 3, value: w.summary, placeholder: 'What is this world, in a sentence or two?', onInput: v => save({ summary: v }) });
    box.appendChild(h('div.wd-cols', [
      ui.panel({ title: 'Identity', icon: '◎', body: [
        h('div.wd-namerow', [iconBtn, h('div.gk-grow', [ui.input({ value: w.name, placeholder: 'World name', onInput: v => save({ name: v }) })]), ui.color({ value: w.color || '#4fb6b2', onInput: v => { iconBtn.style.setProperty('--c', v); save({ color: v }); } })]),
        ui.field({ label: 'Summary', control: summary }),
        ui.field({ label: 'Cover', control: cover }),
      ] }),
      ui.panel({ title: 'Defaults', icon: '⚙', body: [
        ui.field({ label: 'The world\'s current date', hint: 'Ages, the timeline\'s “now” and Share view reveals use it.', control: WB.ui.dateInput({ value: w.now, allowEmpty: false, onChange: d => d && save({ now: d }) }) }),
        ui.field({ label: 'New entries are', hint: 'Private: only you. Shared: players and readers in Share view. Public: also your published site.', control: WB.ui.audience(w.settings.defaultAudience || 'shared', v => setting('defaultAudience', v)) }),
        ui.field({ label: 'Name style for suggestions', hint: 'Used when an entry has no culture with sample names.', control: ui.select({ value: w.settings.nameStyle || 'common', options: styles, onChange: v => setting('nameStyle', v) }) }),
        h('div.wd-two', [
          ui.field({ label: 'Daily word goal', control: ui.input({ type: 'number', value: w.settings.wordGoal || 500, onInput: v => setting('wordGoal', Math.max(0, +v || 0)) }) }),
          ui.field({ label: 'Currency', hint: 'Three-letter code, e.g. USD, EUR, GBP.', control: ui.input({ value: w.settings.currency || 'USD', onInput: v => setting('currency', v.toUpperCase().slice(0, 3)) }) }),
          ui.field({ label: 'Map distance unit', control: ui.select({ value: w.settings.mapUnit || 'miles', options: [['miles', 'Miles'], ['km', 'Kilometres'], ['leagues', 'Leagues'], ['days', 'Days of travel'], ['parsecs', 'Parsecs'], ['ly', 'Light years']], onChange: v => setting('mapUnit', v) }) }),
        ]),
      ] }),
    ]));
    const stats = await WB.api('worlds.stats', WB.worldId);
    box.appendChild(h('div.gk-grid', { style: { '--min': '10em' } }, [
      WB.ui.stat({ label: 'Entries', icon: '❖', value: WB.fmt.num(stats.entries) }), WB.ui.stat({ label: 'Words', icon: '✎', value: WB.fmt.num(stats.words) }),
      WB.ui.stat({ label: 'Links', icon: '☍', value: WB.fmt.num(stats.links) }), WB.ui.stat({ label: 'Tags', icon: '#', value: WB.fmt.num(stats.tags) }),
      WB.ui.stat({ label: 'Created', icon: '✦', value: WB.fmt.real(w.createdAt) }),
    ]));
  }

  /* ---------------- calendar designer ---------------- */
  async function tabCalendar(box) {
    let cal = JSON.parse(JSON.stringify((await WB.api('worlds.get', WB.worldId)).calendar));
    const orig = JSON.stringify(cal);
    let dirty = false;
    const left = h('div.wd-cal-edit'), right = h('div.wd-cal-preview');
    const saveBar = h('div.wd-savebar');
    box.appendChild(h('div.wd-cal', [left, right]));
    box.prepend(saveBar);
    const touch = () => { dirty = JSON.stringify(cal) !== orig; paintBar(); preview(); };
    const paintBar = () => {
      GK.clear(saveBar);
      GK.append(saveBar, [h('span.gk-small.gk-muted.gk-grow', { text: dirty ? 'Unsaved changes. Existing dates keep their day numbers, so changing month lengths moves how they read.' : 'Design your world\'s calendar. Every date in the app uses it.' }),
        ui.select({ value: '', options: [['', 'Start from a preset…']].concat(Object.entries(PRESETS).map(([k, p]) => [k, p.label])), onChange: v => { if (!v) return; cal = WB.Cal.normalize(PRESETS[v].cal()); paint(); touch(); } }),
        dirty ? ui.button({ label: 'Revert', small: true, onClick: () => { cal = JSON.parse(orig); paint(); touch(); } }) : null,
        ui.button({ label: 'Save calendar', small: true, kind: 'primary', disabled: !dirty, onClick: async () => { await WB.api('worlds.update', WB.worldId, { calendar: cal }); await WB.reloadWorld(); ui.toast('Calendar saved', '◷'); show(); } })]);
    };
    const show = () => { GK.clear(box); tabCalendar(box); };
    const row = (...kids) => h('div.wd-crow', kids);
    const num = (v, set, attrs = {}) => { const i = ui.input({ type: 'number', value: v == null ? '' : v, onInput: x => { set(x === '' ? null : +x); touch(); } }); Object.assign(i, attrs); i.classList.add('wd-num'); return i; };
    const txt = (v, set, ph) => ui.input({ value: v || '', placeholder: ph || '', onInput: x => { set(x); touch(); } });
    const del = fn => ui.button({ icon: '✕', small: true, kind: 'ghost', title: 'Remove', onClick: () => { fn(); paint(); touch(); } });
    const move = (arr, i, d) => ui.button({ icon: d < 0 ? '↑' : '↓', small: true, kind: 'ghost', title: d < 0 ? 'Move up' : 'Move down', disabled: i + d < 0 || i + d >= arr.length, onClick: () => { const [x] = arr.splice(i, 1); arr.splice(i + d, 0, x); paint(); touch(); } });
    function paint() {
      GK.clear(left);
      const yearDays = cal.months.reduce((s, m) => s + (+m.days || 0), 0);
      left.append(
        ui.panel({ title: 'Months', icon: '▦', sub: cal.months.length + ' months · ' + yearDays + ' days a year', body: [
          ...cal.months.map((m, i) => row(txt(m.name, v => { m.name = v; }, 'Name'), txt(m.short, v => { m.short = v; }, 'Short'), num(m.days, v => { m.days = Math.max(1, v || 1); }, { min: 1, title: 'Days' }), move(cal.months, i, -1), move(cal.months, i, 1), del(() => cal.months.splice(i, 1)))),
          ui.button({ label: 'Add a month', icon: '＋', small: true, onClick: () => { cal.months.push({ name: 'New month', days: 30 }); paint(); touch(); } }),
        ] }),
        ui.panel({ title: 'Week', icon: '⟳', sub: cal.weekdays.length ? cal.weekdays.length + '-day weeks' : 'No weeks', body: [
          h('div.wd-chiprow', cal.weekdays.map((d, i) => h('span.wb-tagchip', [txt(d, v => { cal.weekdays[i] = v; }), h('button.wb-chip-x', { type: 'button', text: '✕', onclick: () => { cal.weekdays.splice(i, 1); paint(); touch(); } })]))),
          h('div.gk-row', [ui.button({ label: 'Add a weekday', icon: '＋', small: true, onClick: () => { cal.weekdays.push('Day ' + (cal.weekdays.length + 1)); paint(); touch(); } }),
            cal.weekdays.length ? ui.field({ label: 'The first day of year 1 is a', inline: true, control: ui.select({ value: String(((cal.weekdayOffset || 0) % cal.weekdays.length + cal.weekdays.length) % cal.weekdays.length), options: cal.weekdays.map((d, i) => [String(i), d]), onChange: v => { cal.weekdayOffset = +v; touch(); } }) }) : null]),
        ] }),
        ui.panel({ title: 'Leap years', icon: '↷', body: [
          ui.field({ label: 'Leap years', inline: true, control: ui.toggle({ value: !!cal.leap, onChange: v => { cal.leap = v ? { every: 4, month: Math.min(1, cal.months.length - 1), days: 1 } : null; paint(); touch(); } }) }),
          cal.leap ? row(h('span', { text: 'Every' }), num(cal.leap.every, v => { cal.leap.every = Math.max(1, v || 1); }), h('span', { text: 'years add' }), num(cal.leap.days, v => { cal.leap.days = v || 1; }), h('span', { text: 'day(s) to' }), ui.select({ value: String(cal.leap.month), options: cal.months.map((m, i) => [String(i), m.name]), onChange: v => { cal.leap.month = +v; touch(); } })) : null,
          cal.leap ? row(h('span', { text: 'except every' }), num(cal.leap.skipEvery || null, v => { cal.leap.skipEvery = v || 0; }), h('span', { text: 'years, unless every' }), num(cal.leap.keepEvery || null, v => { cal.leap.keepEvery = v || 0; }), h('span.gk-small.gk-muted', { text: '(optional)' })) : null,
        ] }),
        ui.panel({ title: 'Eras', icon: '⧗', sub: 'Years are counted inside the era they fall in; years before the first era count backwards.', body: [
          ...cal.eras.map((e, i) => row(txt(e.name, v => { e.name = v; }, 'Era name'), txt(e.abbr, v => { e.abbr = v; }, 'Abbr.'), h('span.gk-small', { text: 'starts in year' }), num(e.start, v => { e.start = v == null ? 1 : v; }), del(() => cal.eras.splice(i, 1)))),
          ui.button({ label: 'Add an era', icon: '＋', small: true, onClick: () => { const last = cal.eras[cal.eras.length - 1]; cal.eras.push({ name: 'New age', abbr: 'NA', start: last ? last.start + 1000 : 1 }); paint(); touch(); } }),
          row(h('span.gk-small', { text: 'Before the first era:' }), txt(cal.before && cal.before.name, v => { cal.before = Object.assign({}, cal.before || {}, { name: v }); }, 'e.g. Before the Flood'), txt(cal.before && cal.before.abbr, v => { cal.before = Object.assign({}, cal.before || {}, { abbr: v }); }, 'BF')),
        ] }),
        ui.panel({ title: 'Moons', icon: '☾', body: [
          ...cal.moons.map((m, i) => row(txt(m.name, v => { m.name = v; }, 'Name'), h('span.gk-small', { text: 'cycle' }), num(m.cycle, v => { m.cycle = Math.max(.1, v || 1); }, { step: .1 }), h('span.gk-small', { text: 'days, offset' }), num(m.offset, v => { m.offset = v || 0; }, { step: .1 }), ui.color({ value: m.color || '#cfd8e3', onInput: v => { m.color = v; touch(); } }), del(() => cal.moons.splice(i, 1)))),
          ui.button({ label: 'Add a moon', icon: '＋', small: true, onClick: () => { cal.moons.push({ name: 'Moon', cycle: 29.5, offset: 0 }); paint(); touch(); } }),
        ] }),
        ui.panel({ title: 'Seasons', icon: '❀', body: [
          ...cal.seasons.map((s, i) => row(txt(s.name, v => { s.name = v; }, 'Name'), h('span.gk-small', { text: 'begins' }), num(s.day, v => { s.day = Math.max(1, v || 1); }), ui.select({ value: String(s.month), options: cal.months.map((m, j) => [String(j), m.name]), onChange: v => { s.month = +v; touch(); } }), del(() => cal.seasons.splice(i, 1)))),
          ui.button({ label: 'Add a season', icon: '＋', small: true, onClick: () => { cal.seasons.push({ name: 'Season', month: 0, day: 1 }); paint(); touch(); } }),
        ] }),
        ui.panel({ title: 'Time of day', icon: '◷', body: row(num(cal.hoursPerDay, v => { cal.hoursPerDay = Math.max(1, v || 24); }), h('span', { text: 'hours a day,' }), num(cal.minutesPerHour, v => { cal.minutesPerHour = Math.max(1, v || 60); }), h('span', { text: 'minutes an hour' })) }),
      );
    }
    let tryText = '';
    function preview() {
      GK.clear(right);
      let C;
      try { C = WB.Cal.create(cal); } catch (e) { right.appendChild(h('p.gk-muted', { text: 'This calendar has a problem: ' + e.message })); return; }
      const now = WB.now, p = C.ymd(now.day);
      const grid = h('div.wb-daygrid', { style: { '--cols': String(C.weekdays.length || 7) } });
      if (C.weekdays.length) C.weekdays.forEach(w => grid.appendChild(h('span.wb-dg-wd', { text: w.slice(0, 2) })));
      for (let i = 0; i < C.weekday(C.fromYmd(p.y, p.m, 1)); i++) grid.appendChild(h('span'));
      for (let d = 1; d <= C.monthLength(p.y, p.m); d++) grid.appendChild(h('button', { type: 'button', class: d === p.d ? 'on' : '', text: String(d) }));
      const out = h('div.gk-small');
      const tryIt = () => { GK.clear(out); if (!tryText.trim()) return; const d = C.parse(tryText); out.append(d ? h('span', { text: '→ ' + C.format(d, 'full') + '  (day ' + d.day + ')' }) : h('span.gk-muted', { text: 'Can’t read that — try “12 ' + C.months[0].name + ' 5”' })); };
      GK.append(right, [ui.panel({ title: 'Preview', icon: '◷', body: [
        h('div.wd-prev-big', { text: C.format(now, 'full') }),
        h('div.gk-small.gk-muted', { text: [C.season(now.day), C.yearLength(p.y) + ' days this year' + (C.isLeap(p.y) ? ' (leap year)' : '')].filter(Boolean).join(' · ') }),
        C.moons(now.day).length ? h('div.wb-chips', C.moons(now.day).map(m => h('span.wb-tagchip', { text: m.icon + ' ' + m.name + ': ' + m.phaseName }))) : null,
        h('b', { text: C.monthName(p.m) + ' ' + C.yearText(p.y) }), grid,
        ui.field({ label: 'Try reading a date', control: ui.input({ value: tryText, placeholder: 'e.g. 3 ' + C.months[Math.min(2, C.months.length - 1)].name + ' ' + C.eraOf(p.y).year, onInput: v => { tryText = v; tryIt(); } }) }), out,
        h('div.gk-small.gk-muted', { text: 'Era years: ' + (C.cal.eras.map(e => e.name + ' (' + (e.abbr || '') + ') from year ' + e.start).join(', ') || 'plain numbers') }),
      ] })]);
      tryIt();
    }
    paint(); paintBar(); preview();
  }

  /* ---------------- types & fields ---------------- */
  async function tabTypes(box, params) {
    let types = await WB.api('types.list', WB.worldId);
    let sel = types.find(t => t.id === params.typeId) || types[0];
    const list = h('div.wd-typelist.gk-panel');
    const editor = h('div.wd-typeedit');
    box.appendChild(h('div.wd-types', [list, editor]));
    const counts = (await WB.api('worlds.stats', WB.worldId)).byType;
    function paintList() {
      GK.clear(list);
      list.appendChild(h('div.wd-typelist-head', [h('b', { text: 'Types' }), h('div.gk-row.nowrap', [
        ui.button({ icon: '⇩', small: true, kind: 'ghost', title: 'Copy types and fields from another world', onClick: copyFrom }),
        ui.button({ label: 'New type', icon: '＋', small: true, kind: 'primary', onClick: newType })])]));
      types.forEach((t, i) => {
        const r = h('div.wb-row', { class: (sel && sel.id === t.id ? 'on ' : '') + (t.hidden ? 'wd-hidden' : ''), tabindex: 0, style: { '--c': t.color }, onclick: () => { sel = t; paintList(); paintEditor(); } }, [
          h('span.wb-row-ico', { text: t.icon }), h('div.wb-row-main', [h('div.wb-row-title.gk-ellipsis', { text: t.plural }), h('div.wb-row-sub', { text: (counts[t.id] || 0) + ' · ' + t.fields.length + ' fields' + (t.hidden ? ' · hidden' : '') + (t.lens ? ' · ' + t.lens : '') })]),
          h('div.wd-updown', [ui.button({ icon: '↑', small: true, kind: 'ghost', disabled: i === 0, title: 'Move up', onClick: ev => { ev.stopPropagation(); reorder(i, -1); } }), ui.button({ icon: '↓', small: true, kind: 'ghost', disabled: i === types.length - 1, title: 'Move down', onClick: ev => { ev.stopPropagation(); reorder(i, 1); } })]),
        ]);
        list.appendChild(r);
      });
    }
    async function copyFrom() {
      const others = (await WB.api('worlds.list', { archived: true })).filter(w => w.id !== WB.worldId);
      if (!others.length) return ui.toast('There is no other world to copy from yet', 'ℹ');
      let from = others[0].id;
      const ok = await ui.dialog({ title: 'Copy types from another world', icon: '⇩', body: h('div.gk-stack', [
        ui.select({ value: from, options: others.map(w => [w.id, w.name]), onChange: v => { from = v; } }),
        h('p.gk-small.gk-muted', { text: 'Types you don\'t have are added; types you share get the fields they are missing. Nothing is removed.' }),
      ]), actions: [{ label: 'Cancel', value: false }, { label: 'Copy', kind: 'primary', value: true }] });
      if (!ok) return;
      const r = await WB.api('types.copyFrom', WB.worldId, from, null);
      ui.toast(r.added + ' types added, ' + r.merged + ' updated', '⇩');
      types = await WB.api('types.list', WB.worldId); paintList(); paintEditor();
    }
    async function reorder(i, d) { const [x] = types.splice(i, 1); types.splice(i + d, 0, x); await WB.api('types.reorder', WB.worldId, types.map(t => t.id)); paintList(); }
    async function newType() {
      const n = await ui.prompt('A new type of entry', '', 'e.g. Ship, Spell, Planet, Dynasty, Recipe');
      if (!n) return;
      const t = await WB.api('types.save', { worldId: WB.worldId, name: n, plural: n.endsWith('s') ? n : n + 's', fields: [{ label: 'Kind', kind: 'choice', options: [] }] });
      types = await WB.api('types.list', WB.worldId); sel = types.find(x => x.id === t.id); paintList(); paintEditor();
    }
    const save = WB.debounce(async () => { try { const t = await WB.api('types.save', sel); Object.assign(sel, t); const i = types.findIndex(x => x.id === t.id); if (i >= 0) types[i] = sel; paintList(); } catch (e) { WB.fail(e); } }, 500);
    function paintEditor() {
      GK.clear(editor);
      if (!sel) return;
      const t = sel;
      const iconBtn = h('button.wd-icon', { type: 'button', text: t.icon, style: { '--c': t.color }, title: 'Icon', onclick: ev => { let pop; pop = WB.ui.popover(ev.currentTarget, h('div.cx-symgrid', SYMBOLS.concat('☺ ⌂ ⚑ ❦ ⚱ ✷ ✧ ❖ ℒ ✎ § ❡ ⟿ ⌖ ▦ ⚄ ⚔ ☗ ✉ ✦ ¤'.split(' ')).map(s => h('button', { type: 'button', text: s, onclick: () => { t.icon = s; iconBtn.textContent = s; save(); pop.close(); } }))), { width: '20em' }); } });
      const allTypes = types.map(x => [x.key, x.name]);
      const head = ui.panel({ title: t.name, icon: t.icon, sub: t.builtin ? 'A built-in type: rename it, add fields, hide it — its role in the lenses stays.' : 'Your own type.', actions: [
        !t.builtin ? ui.button({ label: 'Delete type', small: true, kind: 'danger', onClick: () => deleteType(t) }) : null,
        ui.button({ label: 'See entries', small: true, onClick: () => WB.go('codex', { typeId: t.id }) }),
      ].filter(Boolean), body: [
        h('div.wd-namerow', [iconBtn, ui.input({ value: t.name, placeholder: 'Name', onInput: v => { t.name = v; save(); } }), ui.input({ value: t.plural, placeholder: 'Plural', onInput: v => { t.plural = v; save(); } }), ui.color({ value: t.color, onInput: v => { t.color = v; iconBtn.style.setProperty('--c', v); save(); } })]),
        h('div.wd-flags', [
          ui.field({ label: 'Has dates', inline: true, control: ui.toggle({ value: !!t.dated, onChange: v => { t.dated = v ? { start: 'Start', end: 'End' } : null; save(); paintEditor(); } }) }),
          t.dated ? h('div.wd-two', [ui.field({ label: 'Start is called', control: ui.input({ value: t.dated.start, onInput: v => { t.dated.start = v; save(); } }) }), ui.field({ label: 'End is called', control: ui.input({ value: t.dated.end || '', placeholder: 'leave empty for no end', onInput: v => { t.dated.end = v; save(); } }) })]) : null,
          t.dated ? ui.field({ label: 'Start and end are birth and death (show ages)', inline: true, control: ui.toggle({ value: t.lifespan, onChange: v => { t.lifespan = v; save(); } }) }) : null,
          ui.field({ label: 'Can contain others of its kind', inline: true, control: ui.toggle({ value: t.hierarchical, onChange: v => { t.hierarchical = v; save(); } }) }),
          ui.field({ label: 'Suggest names when creating', inline: true, control: ui.toggle({ value: t.namegen, onChange: v => { t.namegen = v; save(); } }) }),
          ui.field({ label: 'Can be pinned on maps', inline: true, control: ui.toggle({ value: t.pinnable, onChange: v => { t.pinnable = v; save(); } }) }),
          ui.field({ label: 'Hide this type', hint: 'Hidden types leave menus and the sidebar; their entries stay.', inline: true, control: ui.toggle({ value: t.hidden, onChange: v => { t.hidden = v; save(); } }) }),
          ui.field({ label: 'New entries are', control: ui.select({ value: t.defaultAudience || '', options: [['', 'The world default']].concat(WB.know.LEVELS.map(([v, l]) => [v, l])), onChange: v => { t.defaultAudience = v || null; save(); } }) }),
          ui.field({ label: '“Add inside” suggests', control: ui.select({ value: (t.childTypes || [])[0] || '', options: [['', '—']].concat(allTypes), onChange: v => { t.childTypes = v ? [v] : []; save(); } }) }),
        ]),
      ] });
      const fieldsBox = h('div.wd-fields');
      const paintFields = () => {
        GK.clear(fieldsBox);
        t.fields.forEach((f, i) => fieldsBox.appendChild(fieldRow(t, f, i, paintFields)));
        if (!t.fields.length) fieldsBox.appendChild(h('p.gk-muted.gk-small', { text: 'No fields yet. Add the facts you want to keep for every ' + t.name.toLowerCase() + '.' }));
      };
      paintFields();
      const fieldsPanel = ui.panel({ title: 'Fields', icon: '▤', sub: 'Every ' + t.name.toLowerCase() + ' gets these. Renaming a field keeps its data.', actions: [
        ui.button({ label: 'Add a set…', small: true, onClick: ev => WB.ui.menu(Object.keys(FIELDSETS).map(k => ({ label: k, onClick: () => { for (const [label, kind, options] of FIELDSETS[k]) t.fields.push({ label, kind, options: options || [], group: k }); save(); paintFields(); } })), ev.currentTarget) }),
        ui.button({ label: 'Add field', icon: '＋', small: true, kind: 'primary', onClick: ev => WB.ui.menu(Object.entries(WB.F.KINDS).map(([k, d]) => ({ label: d.label, icon: d.icon, onClick: () => { t.fields.push({ label: 'New ' + d.label.toLowerCase(), kind: k, options: [] }); save(); paintFields(); setTimeout(() => { const ins = fieldsBox.querySelectorAll('.wd-field input'); const last = fieldsBox.lastElementChild && fieldsBox.lastElementChild.querySelector('input'); if (last) { last.focus(); last.select(); } }, 30); } })), ev.currentTarget) }),
      ], body: fieldsBox });
      GK.append(editor, [head, fieldsPanel]);
    }
    function fieldRow(t, f, i, repaint) {
      const kind = WB.F.KINDS[f.kind] || WB.F.KINDS.text;
      const more = h('div.wd-field-more');
      const refChips = () => h('div.wb-chips', types.map(x => ui.chip({ label: x.icon + ' ' + x.name, on: (f.refTypes || []).includes(x.key), onClick: () => { const s = new Set(f.refTypes || []); s.has(x.key) ? s.delete(x.key) : s.add(x.key); f.refTypes = [...s]; save(); repaint(); } })));
      GK.append(more, [
        kind.options ? ui.field({ label: 'Options (one per line)', control: ui.input({ multiline: true, rows: 3, value: (f.options || []).join('\n'), onInput: v => { f.options = v.split('\n').map(s => s.trim()).filter(Boolean); save(); } }) }) : null,
        kind.link ? ui.field({ label: 'Can link to (none = any type)', control: refChips() }) : null,
        h('div.wd-two', [ui.field({ label: 'Group', control: ui.input({ value: f.group || '', placeholder: 'e.g. Portrait', onInput: v => { f.group = v; save(); } }) }), ui.field({ label: 'Unit / hint', control: ui.input({ value: f.unit || f.hint || '', placeholder: f.kind === 'number' ? 'e.g. years' : 'Shown as a tip', onInput: v => { if (f.kind === 'number') f.unit = v; else f.hint = v; save(); } }) })]),
        h('div.gk-row', [
          ui.field({ label: 'Secret', inline: true, control: ui.toggle({ value: !!f.secret, title: 'Only you see it', onChange: v => { f.secret = v; save(); } }) }),
          ui.field({ label: 'Recommended', inline: true, control: ui.toggle({ value: !!f.required, title: 'Missing values show up as gaps and questions', onChange: v => { f.required = v; save(); } }) }),
          ui.field({ label: 'Full width', inline: true, control: ui.toggle({ value: !!f.wide, onChange: v => { f.wide = v; save(); } }) }),
        ]),
      ]);
      const open = { v: false };
      const rowEl = h('div.wd-field', [
        h('div.wd-field-main', [
          h('span.wd-kind', { text: kind.icon, title: kind.label }),
          ui.input({ value: f.label, placeholder: 'Field name', onInput: v => { f.label = v; save(); } }),
          ui.select({ value: f.kind, options: Object.entries(WB.F.KINDS).map(([k, d]) => [k, d.label]), onChange: v => { f.kind = v; save(); repaint(); } }),
          f.secret ? h('span.cx-secret', { text: '◐', title: 'Secret' }) : null,
          ui.button({ icon: '⚙', small: true, kind: 'ghost', title: 'Options', onClick: () => { open.v = !open.v; more.classList.toggle('open', open.v); } }),
          ui.button({ icon: '↑', small: true, kind: 'ghost', disabled: i === 0, onClick: () => { const [x] = t.fields.splice(i, 1); t.fields.splice(i - 1, 0, x); save(); repaint(); } }),
          ui.button({ icon: '↓', small: true, kind: 'ghost', disabled: i === t.fields.length - 1, onClick: () => { const [x] = t.fields.splice(i, 1); t.fields.splice(i + 1, 0, x); save(); repaint(); } }),
          ui.button({ icon: '✕', small: true, kind: 'ghost', title: 'Remove field (values are kept on entries)', onClick: () => { t.fields.splice(i, 1); save(); repaint(); } }),
        ]),
        more,
      ]);
      return rowEl;
    }
    async function deleteType(t) {
      const n = counts[t.id] || 0;
      let moveTo = null;
      if (n) {
        const opts = types.filter(x => x.id !== t.id).map(x => [x.id, x.name]);
        moveTo = opts[0] && opts[0][0];
        const ok = await ui.dialog({ title: 'Delete “' + t.name + '”?', icon: '⚠', body: h('div.gk-stack', [h('p', { text: n + ' entries use this type. They will become:' }), ui.select({ value: moveTo, options: opts, onChange: v => { moveTo = v; } })]), actions: [{ label: 'Cancel', value: false }, { label: 'Delete type', kind: 'primary danger', value: true }] });
        if (!ok) return;
      } else if (!(await ui.confirm('Delete “' + t.name + '”?', 'No entries use it. A backup is made first.', 'Delete', true))) return;
      await WB.api('types.remove', t.id, { moveTo });
      types = await WB.api('types.list', WB.worldId); sel = types[0]; paintList(); paintEditor();
    }
    paintList(); paintEditor();
  }

  /* ---------------- relations ---------------- */
  async function tabRelations(box) {
    const rels = await WB.api('rels.list', WB.worldId);
    const save = WB.debounce(r => WB.api('rels.save', r).catch(WB.fail), 450);
    const panels = WB.F.CATEGORIES.map(([cat, label]) => ui.panel({ title: label, icon: '☍', body: h('div.wd-rels', rels.filter(r => r.category === cat).map(r => h('div.wd-rel', { style: { '--c': r.color || 'var(--muted)' } }, [
      ui.input({ value: r.name, placeholder: 'A is … of B', onInput: v => { r.name = v; if (r.symmetric) r.inverse = v; save(r); } }),
      r.symmetric ? h('span.gk-small.gk-muted.wd-sym', { text: 'both ways' }) : ui.input({ value: r.inverse, placeholder: 'B is … of A', onInput: v => { r.inverse = v; save(r); } }),
      ui.select({ value: r.category, options: WB.F.CATEGORIES, onChange: v => { r.category = v; save.flush(r); setTimeout(() => { GK.clear(box); tabRelations(box); }, 200); } }),
      ui.select({ value: r.familyRole || '', options: [['', 'no family role'], ['parent', 'parent → child'], ['spouse', 'spouses'], ['sibling', 'siblings']], onChange: v => { r.familyRole = v || null; save(r); } }),
      ui.color({ value: r.color || '#9aa5b1', onInput: v => { r.color = v; save(r); } }),
      ui.button({ icon: r.symmetric ? '⇄' : '→', small: true, kind: 'ghost', title: r.symmetric ? 'Same both ways — click to give it an inverse' : 'Has an inverse — click to make it the same both ways', onClick: () => { r.symmetric = !r.symmetric; if (r.symmetric) r.inverse = r.name; save.flush(r); setTimeout(() => { GK.clear(box); tabRelations(box); }, 200); } }),
      ui.button({ icon: '✕', small: true, kind: 'ghost', title: 'Delete this kind', onClick: async () => { const n = await WB.api('rels.count', r.id); if (n && !(await ui.confirm('Delete “' + r.name + '”?', n + ' relations of this kind will be removed too.', 'Delete', true))) return; await WB.api('rels.remove', r.id); GK.clear(box); tabRelations(box); } }),
    ]))), actions: [ui.button({ icon: '＋', small: true, title: 'Add a kind of relation', onClick: async () => { const n = await ui.prompt('A new kind of relation', '', 'e.g. sworn to, apprentice of, haunts'); if (n) { await WB.api('rels.save', { worldId: WB.worldId, name: n, inverse: n, symmetric: false, category: cat }); GK.clear(box); tabRelations(box); } } })] }));
    GK.append(box, [h('p.gk-small.gk-muted', { text: 'Relations read both ways: “parent of” from one side is “child of” from the other. Family roles build the family trees.' }), h('div.wd-relgrid', panels)]);
  }

  /* ---------------- tags ---------------- */
  async function tabTags(box) {
    const tags = await WB.api('tags.list', WB.worldId);
    const save = WB.debounce(t => WB.api('tags.save', t).catch(WB.fail), 450);
    box.appendChild(ui.panel({ title: 'All tags', icon: '#', sub: tags.length ? tags.length + ' tags' : 'Tags appear here when you add them to entries.', actions: [ui.button({ label: 'New tag', icon: '＋', small: true, onClick: async () => { const n = await ui.prompt('New tag', '', 'tag'); if (n) { await WB.api('tags.save', { worldId: WB.worldId, name: n }); GK.clear(box); tabTags(box); } } })], body: h('div.wd-tags', tags.map(t => h('div.wd-tag', { style: { '--c': t.color || 'var(--muted)' } }, [
      h('span.wd-tag-hash', { text: '#' }), ui.input({ value: t.name, onInput: v => { t.name = v; save(t); } }), ui.color({ value: t.color || '#9aa5b1', onInput: v => { t.color = v; save(t); } }),
      h('span.gk-small.gk-muted', { text: WB.fmt.plural(t.count, 'entry', 'entries') }),
      ui.button({ label: 'Merge into…', small: true, kind: 'ghost', onClick: ev => WB.ui.menu(tags.filter(x => x.id !== t.id).map(x => ({ label: '#' + x.name, onClick: async () => { await WB.api('tags.merge', x.id, t.id); GK.clear(box); tabTags(box); } })), ev.currentTarget) }),
      ui.button({ icon: '✕', small: true, kind: 'ghost', title: 'Delete tag', onClick: async () => { await WB.api('tags.remove', t.id); GK.clear(box); tabTags(box); } }),
    ]))) }));
  }

  /* ---------------- all worlds ---------------- */
  async function tabWorlds(box) {
    const worlds = await WB.api('worlds.list', { archived: true });
    const refresh = () => { GK.clear(box); tabWorlds(box); };
    box.appendChild(h('div.wd-worldbar', [
      ui.button({ label: 'New world', icon: '✦', kind: 'primary', onClick: () => WB.newWorld() }),
      ui.button({ label: 'Add the example world', icon: '❖', onClick: async () => { const w = await WB.api('worlds.sample'); await WB.switchWorld(w.id); } }),
      ui.button({ label: 'Import a world…', icon: '⇪', onClick: async () => { try { const pk = await GK.host('file:openJson'); if (!pk) return; const w = await WB.api('worlds.unpack', pk); ui.toast('Imported “' + w.name + '”', '⇪'); refresh(); } catch (e) { WB.fail(e); } } }),
    ]));
    box.appendChild(h('div.wd-worlds', worlds.map(w => ui.panel({ cls: 'wd-world' + (w.id === WB.worldId ? ' current' : '') + (w.archived ? ' archived' : ''), body: [
      h('div.wd-world-head', [h('span.hm-world-ico', { text: w.icon || '◎', style: { '--c': w.color || 'var(--accent)' } }), h('div.gk-grow', [h('b', { text: w.name }), h('div.gk-small.gk-muted', { text: WB.fmt.plural(w.entries, 'entry', 'entries') + ' · opened ' + WB.fmt.rel(w.openedAt) + (w.archived ? ' · archived' : '') })]), w.id === WB.worldId ? WB.ui.badge('open', 'accent') : null]),
      w.summary ? h('p.gk-small.wd-world-sum', { text: w.summary }) : null,
      h('div.wd-world-actions', [
        w.id !== WB.worldId ? ui.button({ label: 'Open', small: true, kind: 'primary', onClick: () => WB.switchWorld(w.id) }) : null,
        ui.button({ label: 'Duplicate', small: true, onClick: async () => { await WB.api('worlds.duplicate', w.id); ui.toast('Duplicated', '⧉'); refresh(); } }),
        ui.button({ label: 'Export…', small: true, onClick: async () => { const pk = await WB.api('worlds.pack', w.id); const p = await GK.host('file:saveJson', w.name.replace(/[^\w -]+/g, '') + '.wbworld.json', pk); if (p) ui.toast('Saved to ' + p, '⇩'); } }),
        ui.button({ label: w.archived ? 'Unarchive' : 'Archive', small: true, kind: 'ghost', onClick: async () => { await WB.api('worlds.update', w.id, { archived: !w.archived }); refresh(); } }),
        ui.button({ label: 'Delete…', small: true, kind: 'ghost', onClick: async () => {
          const inp = ui.input({ placeholder: w.name });
          const ok = await ui.dialog({ title: 'Delete “' + w.name + '”?', icon: '⚠', body: h('div.gk-stack', [h('p', { text: 'Every entry, map, file and note in this world is deleted. A backup is made first, so it can be restored from World settings → Data → Backups.' }), h('p.gk-small.gk-muted', { text: 'Type the world\'s name to confirm:' }), inp]), actions: [{ label: 'Cancel', value: false }, { label: 'Delete world', kind: 'primary danger', value: true }] });
          if (!ok) return;
          if (inp.value.trim() !== w.name) return ui.toast('The name didn\'t match — nothing was deleted', 'ℹ');
          await WB.api('worlds.remove', w.id);
          if (w.id === WB.worldId) { const rest = await WB.api('worlds.list'); if (rest[0]) await WB.switchWorld(rest[0].id); else { WB.world = null; WB.worldId = null; GK.shell.go('home'); return; } }
          refresh();
        } }),
      ]),
    ] }))));
  }

  /* ---------------- backups ---------------- */
  async function tabBackups(box) {
    const list = await WB.api('backup.list');
    const refresh = () => { GK.clear(box); tabBackups(box); };
    box.appendChild(ui.panel({ title: 'Saved copies', icon: '⛁', sub: 'A copy is made automatically once a day, and before anything risky (merging, deleting a type or a world, restoring). The last 14 daily copies are kept.', actions: [
      ui.button({ label: 'Back up now', icon: '⛁', small: true, kind: 'primary', onClick: async () => { await WB.api('backup.create', 'Manual'); ui.toast('Backup made', '⛁'); refresh(); } }),
      ui.button({ label: 'Open folder', small: true, onClick: () => WB.api('backup.openFolder') }),
    ], body: list.length ? h('div.wd-backups', list.map(b => h('div.wd-backup', [
      h('span.wd-backup-ico', { text: b.auto ? '◷' : '⛁' }), h('div.gk-grow', [h('b', { text: b.label }), h('div.gk-small.gk-muted', { text: new Date(b.at).toLocaleString() + ' · ' + WB.fmt.bytes(b.size) })]),
      ui.button({ label: 'Restore…', small: true, onClick: async () => { if (await ui.confirm('Restore this backup?', 'Worldbuilder restarts with every world as it was at ' + new Date(b.at).toLocaleString() + '. Your current data is backed up first, so you can come back.', 'Restore and restart', true)) await WB.api('backup.restore', b.file); } }),
      ui.button({ icon: '✕', small: true, kind: 'ghost', title: 'Delete this backup', onClick: async () => { await WB.api('backup.remove', b.file); refresh(); } }),
    ]))) : WB.ui.empty({ icon: '⛁', title: 'No backups yet', text: 'The first daily backup is made a few seconds after you open a world with entries.' }) }));
  }

  /* ---------------- data ---------------- */
  async function tabData(box) {
    const info = await WB.api('app.dbInfo');
    const app = (await GK.host('app:info')) || {};
    box.appendChild(h('div.wd-cols', [
      ui.panel({ title: 'Your data', icon: '⛁', body: [
        h('div.wd-kv', [['Database', WB.fmt.bytes(info.size)], ['Worlds', info.worlds], ['Entries (all worlds)', WB.fmt.num(info.entries)], ['SQLite', info.sqlite], ['App', (app.name || 'Worldbuilder') + ' ' + (app.version || '')]].map(([k, v]) => h('div.wb-kv-row', [h('span.gk-muted', { text: k }), h('b', { text: String(v) })]))),
        h('p.gk-small.gk-muted', { text: 'Everything lives in one folder on this computer. Nothing is sent anywhere.' }),
        h('div.gk-row', [ui.button({ label: 'Open the data folder', small: true, onClick: () => WB.api('app.openData') })]),
      ] }),
      WB.worldId ? textTools() : null,
      ui.panel({ title: 'Maintenance', icon: '⚙', body: [
        WB.worldId ? ui.field({ label: 'Rebuild search and links for this world', hint: 'If search ever misses something, this re-reads every entry.', control: ui.button({ label: 'Rebuild', small: true, onClick: async () => { const r = await WB.api('app.reindex', WB.worldId); ui.toast('Re-read ' + r.n + ' entries', '↻'); } }) }) : null,
        ui.field({ label: 'Compact the database', hint: 'Reclaims space after big deletions.', control: ui.button({ label: 'Compact', small: true, onClick: async () => { await WB.api('app.vacuum'); ui.toast('Compacted', '⛁'); GK.clear(box); tabData(box); } }) }),
      ] }),
    ]));
  }

  /* ---------------- text tools: find & replace, unlinked mentions ---------------- */
  function textTools() {
    let find = '', repl = '', o = { matchCase: false, wholeWord: true, titles: false };
    const results = h('div.wd-found');
    const snip = s => { const d = h('div.gk-small.gk-muted.wb-pal-snip'); String(s || '').split(/(\u0001[^\u0002]*\u0002)/).forEach(p => d.appendChild(p.startsWith('\u0001') ? h('mark', { text: p.slice(1, -1) }) : document.createTextNode(p))); return d; };
    const preview = async () => {
      GK.clear(results);
      if (!find) return;
      const hits = await WB.api('text.find', WB.worldId, find, o);
      if (!hits.length) return results.appendChild(h('p.gk-small.gk-muted', { text: 'Not found anywhere.' }));
      GK.append(results, [h('div.gk-small', { text: hits.reduce((s, x) => s + x.count, 0) + ' in ' + WB.fmt.plural(hits.length, 'entry', 'entries') }),
        ...hits.slice(0, 60).map(x => h('div.wd-hit', [WB.ui.chip(x.id, { size: 'sm' }), h('span.gk-tiny.gk-muted', { text: '×' + x.count }), snip(x.snippet)]))]);
    };
    const run = WB.debounce(preview, 300);
    return ui.panel({ title: 'Find & replace across the world', icon: '⌕', sub: 'Changes summaries and text (and titles if you ask). Links and their labels are never touched. A backup and a version of each entry are kept first.', body: [
      h('div.wd-two', [ui.field({ label: 'Find', control: ui.input({ placeholder: 'e.g. Gulhaven', onInput: v => { find = v; run(); } }) }), ui.field({ label: 'Replace with', control: ui.input({ placeholder: 'e.g. Gullhaven', onInput: v => { repl = v; } }) })]),
      h('div.gk-row', [
        ui.field({ label: 'Match case', inline: true, control: ui.toggle({ value: o.matchCase, onChange: v => { o.matchCase = v; run(); } }) }),
        ui.field({ label: 'Whole words', inline: true, control: ui.toggle({ value: o.wholeWord, onChange: v => { o.wholeWord = v; run(); } }) }),
        ui.field({ label: 'Titles too', inline: true, control: ui.toggle({ value: o.titles, onChange: v => { o.titles = v; run(); } }) }),
      ]),
      results,
      h('div.gk-row', [
        ui.button({ label: 'Replace all', kind: 'primary', small: true, onClick: async () => { if (!find) return; if (!(await ui.confirm('Replace every “' + find + '”?', 'With “' + repl + '”. A backup is made first and each changed entry keeps its previous version.', 'Replace all', true))) return; const r = await WB.api('text.replace', WB.worldId, find, repl, o); ui.toast('Replaced ' + r.replacements + ' in ' + WB.fmt.plural(r.entries, 'entry', 'entries'), '⌕'); preview(); } }),
        ui.button({ label: 'Link unlinked mentions…', icon: '☍', small: true, onClick: unlinkedDialog }),
      ]),
    ] });
  }
  async function unlinkedDialog() {
    const list = await WB.api('links.unlinked', WB.worldId, {});
    if (!list.length) return ui.toast('Every name in your world is already linked', '☍');
    const chosen = new Set(list.map((x, i) => i));
    const rows = h('div.wd-unlinked', list.map((x, i) => h('label.wd-unl', [h('input', { type: 'checkbox', checked: true, onchange: ev => { ev.target.checked ? chosen.add(i) : chosen.delete(i); } }),
      h('div.gk-grow', [h('div', [WB.ui.chip(x.src, { size: 'sm' }), h('span.gk-small.gk-muted', { text: ' names ' }), WB.ui.chip(x.target, { size: 'sm' }), h('span.gk-tiny.gk-muted', { text: ' ×' + x.count })]),
        (() => { const d = h('div.gk-tiny.gk-muted.wb-pal-snip'); String(x.snippet).split(/(\u0001[^\u0002]*\u0002)/).forEach(p => d.appendChild(p.startsWith('\u0001') ? h('mark', { text: p.slice(1, -1) }) : document.createTextNode(p))); return d; })()])])));
    const ok = await ui.dialog({ title: 'Unlinked mentions', icon: '☍', body: h('div.gk-stack', [h('p.gk-small.gk-muted', { text: 'These entries name other entries without linking them. Linking turns the first mention in each into a live link — it then follows renames and shows up in backlinks and the graph.' }), rows]), actions: [{ label: 'Cancel', value: false }, { label: 'Link selected', kind: 'primary', value: true }] });
    if (!ok) return;
    const r = await WB.api('links.linkUnlinked', WB.worldId, list.filter((x, i) => chosen.has(i)).map(x => ({ src: x.src, target: x.target })));
    ui.toast('Linked ' + r.linked + ' mentions', '☍');
  }
  WB.commands.add({ id: 'world:replace', label: 'Find and replace across the world', icon: '⌕', group: 'World', run: () => WB.go('world', { tab: 'data' }) });
  WB.commands.add({ id: 'world:unlinked', label: 'Link unlinked mentions…', icon: '☍', group: 'World', run: () => unlinkedDialog() });
  WB.commands.add({ id: 'world:random', label: 'Surprise me: open a random entry', icon: '⚂', group: 'Go to', run: async () => { const e = await WB.api('entries.random', WB.worldId, { audience: WB.share }); if (e) WB.open(e.id); } });

  WB.commands.add({ id: 'world:calendar', label: 'Edit the calendar', icon: '◷', group: 'World', run: () => WB.go('world', { tab: 'calendar' }) });
  WB.commands.add({ id: 'world:types', label: 'Edit types and fields', icon: '▤', group: 'World', run: () => WB.go('world', { tab: 'types' }) });
  WB.commands.add({ id: 'world:backups', label: 'Backups', icon: '⛁', group: 'World', run: () => WB.go('world', { tab: 'backups' }) });

  WB.smoke('world-calendar', async () => { await WB.go('world', { tab: 'calendar' }); await WB.wait(600); return document.querySelector('.wd-prev-big') ? { now: document.querySelector('.wd-prev-big').textContent } : 'error: the calendar designer did not open'; });
  WB.smoke('world-types', async () => { await WB.go('world', { tab: 'types' }); await WB.wait(600); return document.querySelectorAll('.wd-field').length ? { fields: document.querySelectorAll('.wd-field').length } : 'error: the type editor did not open'; });
})();
