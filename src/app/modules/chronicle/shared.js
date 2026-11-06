/* Chronicle shared: the screen (tabs, the world's "now", view switching, remembered state), the data cache,
   date and advance-time dialogs, entry creation at a date, and Markdown / print exports. */
(function () {
  'use strict';
  const GK = window.GK, WB = window.WB, h = GK.h, ui = GK.ui, CH = WB.chronicle, S = window.WBChronScale;
  CH.S = S;

  /* ---------------- data: every dated entry of the world (lite), cached until something changes ---------------- */
  let cache = null;
  CH.invalidate = () => { cache = null; };
  // changes made while the Chronicle is closed (the Codex, another lens) must not leave it a stale copy
  WB.onChange(['entries', 'links', 'tags', 'types'], () => CH.invalidate(), 20);
  WB.on('world', () => CH.invalidate());
  CH.data = (force) => {
    const wid = WB.worldId;
    if (!force && cache && cache.worldId === wid) return cache.p;
    const p = WB.api('chronicle.dated', wid).then(list => ({ worldId: wid, list, byId: new Map(list.map(e => [e.id, e])) }));
    cache = { worldId: wid, p };
    p.catch(() => { if (cache && cache.p === p) cache = null; });
    return p;
  };
  CH.canEdit = () => !WB.share && !!WB.worldId;
  CH.isLife = e => !!(WB.typeOf(e) || {}).lifespan;
  CH.dur = (a, b, o) => (WB.cal ? S.durationText(WB.cal, a, b, o) : '');
  /** the visible extent of an entry in days: { t0, t1, instant, open } (open = alive, drawn to now) */
  CH.extent = (e, nowDay) => {
    const C = WB.cal, life = CH.isLife(e);
    if (e.start && e.end) {
      const t0 = S.startOf(C, e.start), t1 = Math.max(S.endOf(C, e.end), t0);
      return { t0, t1, instant: t1 - t0 <= 0 && e.end.prec === 'time' };
    }
    if (e.start) {
      if (life && nowDay != null && nowDay > e.start.day) return { t0: S.startOf(C, e.start), t1: nowDay + 1, open: true };
      return { t0: S.startOf(C, e.start), t1: S.startOf(C, e.start), instant: true, fuzz: e.start.prec !== 'time' ? S.endOf(C, e.start) : null };
    }
    const t = S.startOf(C, e.end);
    return { t0: t, t1: t, instant: true, endOnly: true };
  };
  /** era → year → month keys for grouping */
  CH.parts = day => { const C = WB.cal, p = C.ymd(day), era = C.eraOf(p.y); return { y: p.y, m: p.m, d: p.d, era: era.index, eraName: era.name || era.abbr || '' }; };
  CH.moons = day => (WB.cal ? WB.cal.moons(day) : []);
  CH.moonBadges = (day, { names = false } = {}) => CH.moons(day).map(m => h('span.ch-moon', { title: m.name + ': ' + m.phaseName.toLowerCase() + (m.full ? ' (full)' : ''), style: m.color ? { '--mc': m.color } : null, class: m.full ? 'full' : m.phaseName === 'New' ? 'new' : '' }, [h('span.ch-moon-ico', { text: m.icon }), names ? h('span.gk-small', { text: ' ' + m.name }) : null]));
  CH.typeColor = t => (t && t.color) || '#9aa5b1';

  /* ---------------- dialogs ---------------- */
  /** a small dialog that asks for a world date → date | null */
  CH.askDate = ({ title = 'Pick a date', ok = 'OK', value = null, text } = {}) => new Promise(resolve => {
    let val = value || { day: WB.now.day, min: null, prec: 'day' };
    const input = WB.ui.dateInput({ value: val, allowEmpty: false, onChange: v => { if (v) { val = v; paint(); } } });
    const info = h('div.gk-small.gk-muted');
    const paint = () => { info.textContent = WB.fmt.date(val, 'full') + ' · ' + (WB.cal.season(val.day) || '') + ' · ' + describeFromNow(val.day); };
    paint();
    const panel = ui.panel({ title, icon: '▦', cls: 'gk-dialog ch-askdate', body: [text ? h('p.gk-small.gk-muted', { text }) : null, input, info] });
    const finish = v => { scrim.remove(); document.removeEventListener('keydown', key, true); resolve(v); };
    panel.appendChild(h('div.gk-panel-foot', [ui.button({ label: 'Cancel', onClick: () => finish(null) }), ui.button({ label: ok, kind: 'primary', onClick: () => { const inp = panel.querySelector('input'); inp.dispatchEvent(new Event('change')); setTimeout(() => finish(val), 0); } })]));
    const scrim = h('div.gk-scrim', { onclick: e => { if (e.target === scrim) finish(null); } }, [panel]);
    const key = e => { if (e.key === 'Escape') { e.stopPropagation(); finish(null); } else if (e.key === 'Enter' && !e.target.closest('.wb-pop')) { e.preventDefault(); const inp = panel.querySelector('input'); inp.dispatchEvent(new Event('change')); setTimeout(() => finish(val), 0); } };
    document.addEventListener('keydown', key, true);
    document.body.appendChild(scrim);
    setTimeout(() => { const i = panel.querySelector('input'); i.focus(); i.select(); }, 30);
  });
  function describeFromNow(day) {
    const n = WB.now.day;
    if (day === n) return 'today in the world';
    return CH.dur(Math.min(day, n), Math.max(day, n)) + (day > n ? ' from now' : ' ago');
  }
  CH.fromNow = describeFromNow;

  /** create an entry (an Event by default) at a date, stay where we are and peek at it */
  CH.createAt = async function (date, { type = 'event', parentId = null, title = '' } = {}) {
    if (!CH.canEdit()) return ui.toast('Leave Share view to add entries', '◑');
    const t = WB.type(type);
    const types = WB.typeList().filter(x => x.dated);
    const pending = WB.ui.createDialog({ type: t && t.dated ? t.key : 'event', start: date, parentId, title, open: false, types: types.map(x => x.id) });
    // the shared create dialog does not show the date: say it in its title
    setTimeout(() => { const h3 = document.querySelector('.gk-dialog.wb-create .gk-panel-head h3'); if (h3 && !h3.querySelector('.ch-create-when')) h3.appendChild(h('span.ch-create-when', { text: ' · ' + WB.fmt.date(date, 'full') })); }, 0);
    const e = await pending;
    if (!e) return null;
    CH.invalidate();
    WB.ui.undoToast('Added “' + e.title + '” on ' + WB.fmt.date(date), () => WB.api('entries.purge', e.id));
    setTimeout(() => WB.peek(e.id), 60);
    return e;
  };

  /** advance (or turn back) the world's date, with a preview of what happens on the way and an optional log entry */
  CH.advanceDialog = function () {
    if (!WB.worldId) return;
    if (WB.share) return ui.toast('Leave Share view to change the world date', '◑');
    const C = WB.cal, from = WB.now;
    let by = { years: 0, months: 0, days: 0 }, exact = null, log = false, logType = 'note', note = '';
    const target = () => (exact ? exact : C.add({ day: from.day, min: from.min, prec: 'day' }, by));
    const preview = h('div.ch-adv-preview');
    const between = h('div.ch-adv-between');
    const amount = h('div.gk-small.gk-muted.ch-adv-amount');
    const paint = async () => {
      const to = target();
      const lo = Math.min(from.day, to.day), hi = Math.max(from.day, to.day);
      amount.textContent = exact ? 'Exact date' : [by.years && WB.fmt.plural(by.years, 'year'), by.months && WB.fmt.plural(by.months, 'month'), by.days && WB.fmt.plural(by.days, 'day')].filter(Boolean).join(', ') || 'Choose how much time passes';
      preview.replaceChildren(
        h('div.ch-adv-col', [h('div.gk-tiny.gk-muted', { text: 'NOW' }), h('b', { text: WB.fmt.date(from, 'full') }), h('div.ch-adv-moons', CH.moonBadges(from.day))]),
        h('div.ch-adv-arrow', { text: to.day >= from.day ? '→' : '←' }),
        h('div.ch-adv-col', [h('div.gk-tiny.gk-muted', { text: to.day === from.day ? 'UNCHANGED' : to.day > from.day ? CH.dur(lo, hi).toUpperCase() + ' LATER' : CH.dur(lo, hi).toUpperCase() + ' EARLIER' }), h('b', { text: WB.fmt.date(to, 'full') }), h('div.ch-adv-moons', CH.moonBadges(to.day)), h('div.gk-tiny.gk-muted', { text: C.season(to.day) || '' })]),
      );
      const d = await CH.data();
      const evs = d.list.filter(e => WB.visible(e) && e.start && e.start.day > lo && e.start.day <= hi).slice(0, 8);
      const fulls = [];
      for (let x = lo + 1; x <= hi && x - lo < 400 && fulls.length < 4; x++) for (const m of C.moons(x)) if (m.full && !C.moons(x - 1).find(y => y.name === m.name && y.full)) fulls.push({ day: x, m });
      GK.clear(between); GK.append(between, [
        evs.length ? h('div.gk-small.gk-muted', { text: to.day > from.day ? 'On the way:' : 'Undone by turning back:' }) : null,
        ...evs.map(e => h('div.ch-adv-ev', [h('span.ch-date-sm', { text: WB.fmt.date(e.start, 'short') }), WB.ui.chip(e, { size: 'sm' })])),
        fulls.length ? h('div.gk-small.gk-muted.ch-adv-fulls', { text: fulls.map(f => 'Full ' + f.m.name + ' on ' + WB.fmt.date({ day: f.day, prec: 'day' }, 'short')).join(' · ') }) : null,
      ]);
    };
    const quick = (label, p, tip) => ui.button({ label, small: true, title: tip, onClick: () => { exact = null; by = { years: by.years + (p.years || 0), months: by.months + (p.months || 0), days: by.days + (p.days || 0) }; paint(); } });
    const wk = C.weekdays.length || 7;
    const quickRow = h('div.gk-row.ch-adv-quick', [
      quick('+1 day', { days: 1 }), quick('+1 week', { days: wk }, wk + ' days (one week of ' + (C.weekdays.length ? 'this calendar' : 'seven days') + ')'), quick('+1 month', { months: 1 }),
      quick('+1 season', { months: Math.max(1, Math.round(C.months.length / Math.max(1, (C.cal.seasons || []).length || 4))) }, 'A quarter of the year'), quick('+1 year', { years: 1 }),
      quick('−1 day', { days: -1 }, 'Turn back a day'),
      ui.button({ label: 'Reset', small: true, kind: 'ghost', onClick: () => { by = { years: 0, months: 0, days: 0 }; exact = null; paint(); } }),
    ]);
    const exactIn = WB.ui.dateInput({ value: null, placeholder: 'or an exact date…', onChange: v => { exact = v ? { day: v.day, min: null, prec: 'day' } : null; paint(); } });
    const logRow = h('div.ch-adv-log');
    const paintLog = () => {
      GK.clear(logRow);
      logRow.append(ui.field({ label: 'Keep a log entry', inline: true, control: ui.toggle({ value: log, onChange: v => { log = v; paintLog(); } }) }));
      if (log) logRow.append(h('div.ch-adv-logopts', [
        ui.segmented({ value: logType, options: [['note', 'As a note'], ['session', 'As a session']], onChange: v => { logType = v; } }),
        ui.input({ value: note, placeholder: 'What happened in that time? (optional)', onInput: v => { note = v; } }),
      ]));
    };
    paintLog();
    const panel = ui.panel({ title: 'Advance time', icon: '⏩', cls: 'gk-dialog ch-advance', body: [preview, h('div.ch-adv-ctl', [amount, quickRow, exactIn]), between, logRow] });
    const finish = () => { scrim.remove(); document.removeEventListener('keydown', key, true); };
    const go = async () => {
      const to = target();
      if (to.day === from.day) return finish();
      try {
        const r = await WB.api('chronicle.advance', WB.worldId, { to }, log ? { log: logType, text: note.trim() } : {});
        finish();
        await WB.reloadWorld();
        WB.ui.undoToast('The world date is now ' + WB.fmt.date(r.to) + (r.log ? ' · logged' : ''), async () => {
          await WB.api('worlds.update', WB.worldId, { now: r.from });
          if (r.log) await WB.api('entries.purge', r.log.id);
          await WB.reloadWorld();
        });
      } catch (e) { WB.fail(e); }
    };
    panel.appendChild(h('div.gk-panel-foot', [h('span.gk-small.gk-muted.gk-grow', { text: 'Ages, Share view reveals and the timeline\'s now line follow the world date.' }), ui.button({ label: 'Cancel', onClick: finish }), ui.button({ label: 'Advance', kind: 'primary', onClick: go })]));
    const scrim = h('div.gk-scrim', { onclick: e => { if (e.target === scrim) finish(); } }, [panel]);
    const key = e => { if (e.key === 'Escape' && !document.querySelector('.wb-pop')) { e.stopPropagation(); finish(); } };
    document.addEventListener('keydown', key, true);
    document.body.appendChild(scrim);
    paint();
  };

  /* ---------------- exports ---------------- */
  CH.mdEsc = s => String(s == null ? '' : s).replace(/([\\`*_[\]#|<>])/g, '\\$1');
  CH.htmlDoc = (title, body) => '<!doctype html><html><head><meta charset="utf-8"><title>' + WB.esc(title) + '</title><style>' +
    'body{font-family:"Iowan Old Style","Palatino Linotype",Palatino,Georgia,serif;color:#1d1a16;margin:2.2em 2.6em;line-height:1.45;font-size:11.5pt}' +
    'h1{font-size:22pt;margin:0 0 .2em}h2{font-size:15pt;margin:1.4em 0 .3em;border-bottom:1px solid #c9bfae;padding-bottom:.15em}h3{font-size:12pt;margin:1em 0 .3em;color:#5b4a33}' +
    '.sub{color:#6d6253;margin:0 0 1.2em}.rec{display:grid;grid-template-columns:9.5em 1fr;gap:.2em 1em;padding:.25em 0;border-bottom:1px solid #eee4d4;break-inside:avoid}' +
    '.d{color:#6d6253;font-variant-numeric:tabular-nums}.k{font-size:8.5pt;text-transform:uppercase;letter-spacing:.06em;color:#8a7a62;margin-right:.4em}.s{color:#6d6253;font-size:10pt}' +
    'table{border-collapse:collapse;width:100%}td,th{text-align:left;padding:.3em .5em;border-bottom:1px solid #e6dccb;vertical-align:top}th{font-size:9pt;text-transform:uppercase;letter-spacing:.05em;color:#8a7a62}' +
    '.warn{color:#9a4a12}</style></head><body>' + body + '</body></html>';
  /** opts: { title, md: () => string, html: () => string } */
  CH.exportMenu = (anchor, { title, md, html }) => WB.ui.menu([
    { header: 'Export' },
    { label: 'Copy as Markdown', icon: '⎘', onClick: async () => { await navigator.clipboard.writeText(md()); ui.toast('Copied as Markdown', '⎘'); } },
    { label: 'Save as Markdown…', icon: '⇩', onClick: async () => { const p = await WB.api('chronicle.saveText', title, md(), 'md'); if (p) ui.toast('Saved ' + p, '⇩', 4200); } },
    '-',
    { label: 'Print…', icon: '⎙', onClick: async () => { await WB.api('chronicle.print', html(), { name: title }); } },
    { label: 'Save as PDF…', icon: '⇩', onClick: async () => { const p = await WB.api('chronicle.print', html(), { pdf: true, name: title }); if (p) ui.toast('Saved ' + p, '⇩', 4200); } },
  ], anchor);

  /* ---------------- the screen ---------------- */
  const DEFAULTS = {
    tl: { center: null, scale: null, group: 'type', lifespans: null, periods: true, types: [], tags: [], text: '', audience: '', collapsed: {}, mini: true },
    cal: { y: null, m: null, moons: true, mode: 'month' },
    chrono: { types: [], text: '', order: 'asc', group: 'year' },
    annals: { id: null, kinds: [] },
    succ: { id: null },
    ages: { day: null, group: true },
  };
  const merge = (d, v) => { const o = {}; for (const k of Object.keys(d)) o[k] = Object.assign({}, d[k], (v && v[k]) || {}); return o; };

  CH.mountScreen = async function (page, ctx, params) {
    CH.invalidate();
    const store = await ctx.store({ view: 'timeline', worlds: {} });
    const wid = WB.worldId;
    const st = merge(DEFAULTS, (store.get().worlds || {})[wid]);
    const save = WB.debounce(() => { const all = Object.assign({}, store.get().worlds || {}); all[wid] = st; store.patch({ worlds: all }); }, 300);
    let view = params.view || params.tab || (params.entryId ? 'annals' : store.get().view) || 'timeline';
    if (!CH.views[view]) view = 'timeline';

    const tabs = h('div.ch-tabs', { role: 'tablist' });
    const paintTabs = () => {
      GK.clear(tabs);
      for (const [id, label, icon, tip] of CH.VIEWS) {
        const b = h('button.ch-tab', { type: 'button', role: 'tab', class: id === view ? 'on' : '', 'aria-selected': String(id === view), title: tip, onclick: () => show(id) }, [h('span.ch-tab-ico', { text: icon }), h('span', { text: label })]);
        tabs.appendChild(b);
      }
    };
    const nowBox = h('div.ch-now');
    const paintNow = () => {
      const n = WB.now;
      GK.clear(nowBox);
      GK.append(nowBox, [
        h('button.ch-now-date', { type: 'button', title: 'The world’s current date — click to see it on the timeline', onclick: () => show('timeline', { day: n.day }) }, [
          h('span.ch-now-dot'), h('span.ch-now-text', [h('b', { text: WB.fmt.date(n) }), h('span.gk-small.gk-muted', { text: ' · ' + [WB.cal.weekdays.length ? WB.cal.weekdays[WB.cal.weekday(n.day)] : '', WB.cal.season(n.day)].filter(Boolean).join(' · ') })]),
        ]),
        h('span.ch-now-moons', CH.moonBadges(n.day)),
        WB.share ? null : ui.button({ label: 'Advance time', icon: '⏩', small: true, title: 'Move the world date forward (or back)', onClick: () => CH.advanceDialog() }),
      ]);
    };
    const head = h('div.ch-head', [tabs, h('span.gk-grow'), nowBox]);
    const host = h('div.ch-host');
    page.append(head, host);

    let current = null, seq = 0;
    async function show(v, p) {
      const my = ++seq;
      if (current && current.cleanup) { try { current.cleanup(); } catch (e) { console.error(e); } }
      current = null;
      GK.clear(host);
      view = v; store.patch({ view: v });
      host.dataset.view = v;
      paintTabs();
      const env = { state: st, save, params: p || {}, go: (v2, p2) => show(v2, p2), page, ctx, host };
      try {
        const r = await CH.views[v].mount(host, env);
        if (my !== seq) { if (r && r.cleanup) r.cleanup(); return; }
        current = r || {};
      } catch (e) {
        console.error(e);
        host.replaceChildren(ui.panel({ title: 'This view failed to load', icon: '⚠', body: h('pre.gk-small', { text: String(e && e.stack || e) }) }));
      }
    }
    paintNow();
    await show(view, params);

    // keyboard: Alt+1…7 switch views
    const onKey = e => {
      if (!e.altKey || e.ctrlKey || e.metaKey || !page.isConnected) return;
      const i = +e.key;
      if (i >= 1 && i <= CH.VIEWS.length) { e.preventDefault(); show(CH.VIEWS[i - 1][0]); }
    };
    document.addEventListener('keydown', onKey);
    let gone = false;
    const offs = [
      WB.onChange(['entries', 'links', 'tags', 'types', 'rel_types', 'map_items'], p => { CH.invalidate(); if (current && current.refresh) current.refresh(p); }),
      WB.on('world', w => {
        if (!w || w.id !== wid) { setTimeout(() => { if (!gone) GK.shell.go('chronicle'); }, 400); return; }
        CH.invalidate(); paintNow(); if (current && current.refresh) current.refresh({ tables: ['worlds'] });
      }),
    ];
    return () => {
      gone = true;
      offs.forEach(f => f());
      document.removeEventListener('keydown', onKey);
      if (current && current.cleanup) { try { current.cleanup(); } catch (e) { console.error(e); } }
      save.flush();
    };
  };

  /* ---------------- small shared pieces ---------------- */
  /** type filter chips: value = [typeIds] (empty = all) */
  CH.typeChips = (types, value, onChange) => {
    const box = h('div.wb-chips.ch-typechips');
    const paint = () => {
      GK.clear(box);
      box.appendChild(ui.chip({ label: 'All', on: !value.length, onClick: () => { value = []; onChange(value); paint(); } }));
      for (const t of types) {
        const c = ui.chip({ label: t.icon + ' ' + t.plural, on: value.includes(t.id), title: 'Only ' + t.plural.toLowerCase() + ' (click again to remove)', onClick: () => { value = value.includes(t.id) ? value.filter(x => x !== t.id) : value.concat(t.id); onChange(value); paint(); } });
        c.style.setProperty('--c', t.color);
        c.classList.add('ch-typechip');
        box.appendChild(c);
      }
    };
    paint();
    return box;
  };
  /** an entry's dates as words: "Born 1133 AT · age 70" */
  CH.when = e => {
    const t = WB.typeOf(e), labels = (t && t.dated) || { start: 'Start', end: 'End' };
    const parts = [];
    if (e.start && e.end) parts.push(WB.fmt.span(e) + ' (' + CH.dur(e.start.day, e.end.day) + ')');
    else if (e.start) parts.push(labels.start + ' ' + WB.fmt.date(e.start));
    else if (e.end) parts.push(labels.end + ' ' + WB.fmt.date(e.end));
    const age = WB.fmt.age(e);
    if (age != null) parts.push((e.end ? 'died at ' : 'age ') + age);
    return parts.join(' · ');
  };
})();
