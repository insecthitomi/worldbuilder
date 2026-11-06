/* Chronicle calendar: the world's own months and weekdays as a month grid (or a whole year), with what starts, ends
   and runs through each day, the phases of every moon, season changes, and a day panel. */
(function () {
  'use strict';
  const GK = window.GK, WB = window.WB, h = GK.h, ui = GK.ui, CH = WB.chronicle, S = window.WBChronScale;
  const QUARTERS = new Set([0, 2, 4, 6]);
  const phaseIdx = f => Math.round(f * 8) % 8;

  CH.views.calendar = { mount };

  async function mount(host, env) {
    const st = env.state.cal, C = WB.cal;
    let data = await CH.data();
    const startDay = env.params.day != null ? +env.params.day : st.y != null ? C.fromYmd(st.y, st.m || 0, 1) : WB.now.day;
    let cur = C.ymd(startDay);
    let y = cur.y, m = cur.m;
    let selDay = env.params.day != null ? +env.params.day : (C.ymd(WB.now.day).y === y && C.ymd(WB.now.day).m === m ? WB.now.day : C.fromYmd(y, m, 1));

    const title = h('button.ch-cal-title', { type: 'button', title: 'Jump to a date', onclick: async () => { const d = await CH.askDate({ title: 'Jump to…', ok: 'Go', value: { day: selDay, prec: 'day' } }); if (d) goto(d.day, true); } });
    const eraSel = h('span');
    const modeSeg = ui.segmented({ value: st.mode, options: [['month', 'Month'], ['year', 'Year']], onChange: v => { st.mode = v; env.save(); paint(); } });
    const moonChip = ui.chip({ label: '◐ Moons', on: st.moons, title: 'Show the phases of the moons', onClick: () => { st.moons = !st.moons; moonChip.classList.toggle('on', st.moons); env.save(); paint(); } });
    const nav = (label, tip, fn) => ui.button({ icon: label, small: true, title: tip, onClick: fn });
    const bar = h('div.ch-cal-bar', [
      ui.group([nav('«', 'Previous year (Shift+PgUp)', () => step(0, -1)), nav('‹', 'Previous month (PgUp)', () => step(-1, 0))]),
      title,
      ui.group([nav('›', 'Next month (PgDn)', () => step(1, 0)), nav('»', 'Next year (Shift+PgDn)', () => step(0, 1))]),
      ui.button({ label: 'Today', small: true, title: 'The world’s current date (Home)', onClick: () => goto(WB.now.day, true) }),
      eraSel,
      h('span.gk-grow'),
      moonChip, modeSeg,
    ]);
    const main = h('div.ch-cal-main', { tabindex: 0 });
    const side = h('div.ch-cal-side');
    const panel = ui.panel({ material: 'solid', cls: 'ch-cal', lens: false, body: [bar, h('div.ch-cal-body', [main, side])] });
    host.appendChild(panel);

    function step(dm, dy) {
      if (st.mode === 'year' && dm) { dy = dm; dm = 0; }
      m += dm; y += dy;
      const n = C.months.length;
      while (m < 0) { m += n; y--; }
      while (m >= n) { m -= n; y++; }
      const d = C.ymd(selDay);
      selDay = C.fromYmd(y, m, Math.min(d.d, C.monthLength(y, m)));
      paint();
    }
    function goto(day, select) { const p = C.ymd(day); y = p.y; m = p.m; if (select) selDay = day; paint(); }

    /* what happens on which day of the shown range */
    function index(d0, d1) {
      const life = GK.settings.get('wbLifespans') !== false;
      const starts = new Map(), ends = new Map(), spans = [], ongoing = [], loose = [];
      const add = (map, day, x) => { if (!map.has(day)) map.set(day, []); map.get(day).push(x); };
      for (const e of data.list) {
        if (!WB.visible(e)) continue;
        const t = WB.typeOf(e);
        if (!t || (t.lifespan && !life)) continue;
        const s = e.start, en = e.end;
        const fine = d => d && (d.prec === 'day' || d.prec === 'time');
        if (s && en && !t.lifespan) {
          const a = s.day, b = S.endOf(C, en) - 1;
          if (b < d0 || a >= d1) continue;
          if (fine(s) && fine(en) && b - a < C.avgMonth * 2 && b > a) spans.push({ e, a: Math.floor(a), b: Math.floor(b) });
          else if (b - a >= 1 || !fine(s)) ongoing.push(e);
          else add(starts, a, e);
          continue;
        }
        if (s) { if (s.day >= d0 && s.day < d1) { if (fine(s)) add(starts, s.day, e); else loose.push({ e, which: 'start' }); } }
        if (en) { if (en.day >= d0 && en.day < d1) { if (fine(en)) add(ends, en.day, e); else loose.push({ e, which: 'end' }); } }
      }
      return { starts, ends, spans, ongoing, loose };
    }

    function paint() {
      st.y = y; st.m = m; env.save();
      const yearMode = st.mode === 'year';
      title.replaceChildren(h('b', { text: yearMode ? C.yearText(y) : C.monthName(m) + ' ' + C.yearText(y) }), h('span.gk-small.gk-muted', { text: yearMode ? '' : '  ' + (C.season(C.fromYmd(y, m, 1)) || '') }));
      paintEra();
      GK.clear(main);
      if (yearMode) paintYear(); else paintMonth();
      paintSide();
    }
    function paintEra() {
      const eras = C.cal.eras;
      GK.clear(eraSel);
      if (!eras.length) return;
      const cur = C.eraOf(y).index;
      const opts = (C.cal.before ? [['-1', C.cal.before.name || C.cal.before.abbr]] : []).concat(eras.map((e, i) => [String(i), e.name || e.abbr]));
      const sel = ui.select({ value: String(cur), options: opts, onChange: v => { const i = +v; const yy = i < 0 ? eras[0].start - 1 : eras[i].start; goto(C.startOfYear(yy), true); } });
      sel.title = 'Go to an era';
      sel.classList.add('ch-era-sel');
      eraSel.appendChild(sel);
    }

    function paintMonth() {
      const wk = C.weekdays.length || 7;
      const first = C.fromYmd(y, m, 1), len = C.monthLength(y, m);
      const lead = C.weekdays.length ? C.weekday(first) : 0;
      const g0 = first - lead, cells = Math.ceil((lead + len) / wk) * wk;
      const idx = index(g0, g0 + cells);
      const nowDay = WB.now.day;
      if (idx.ongoing.length || idx.loose.length) {
        main.appendChild(h('div.ch-cal-ongoing', [
          h('span.gk-small.gk-muted', { text: 'This month:' }),
          ...idx.ongoing.slice(0, 12).map(e => h('span.ch-ongo', [WB.ui.chip(e, { size: 'sm' }), h('span.gk-tiny.gk-muted', { text: ' ' + WB.fmt.span(e, 'short') })])),
          ...idx.loose.slice(0, 8).map(x => h('span.ch-ongo', [WB.ui.chip(x.e, { size: 'sm' }), h('span.gk-tiny.gk-muted', { text: ' ' + ((WB.typeOf(x.e) || {}).dated || {})[x.which] || x.which })])),
        ]));
      }
      const grid = h('div.ch-month', { style: { '--wk': String(wk) } });
      if (C.weekdays.length) grid.appendChild(h('div.ch-wkhead', C.weekdays.map((w, i) => h('div.ch-wd', { text: w, title: w, class: i === C.weekday(nowDay) ? 'today' : '' }))));
      for (let r = 0; r < cells / wk; r++) {
        const w0 = g0 + r * wk, w1 = w0 + wk - 1;
        // spans crossing this week, packed into slots
        const rowSpans = idx.spans.filter(s => s.b >= w0 && s.a <= w1).sort((a, b) => a.a - b.a || (b.b - b.a) - (a.b - a.a));
        const slots = [];
        for (const s of rowSpans) { let k = 0; while (slots[k] != null && slots[k] >= Math.max(s.a, w0)) k++; slots[k] = Math.min(s.b, w1); s.slot = k; }
        const week = h('div.ch-week', { style: { '--slots': String(Math.min(slots.length, 4)) } });
        const days = h('div.ch-week-days');
        for (let i = 0; i < wk; i++) days.appendChild(dayCell(w0 + i, idx, nowDay));
        week.appendChild(days);
        for (const s of rowSpans) {
          if (s.slot > 3) continue;
          const a = Math.max(s.a, w0), b = Math.min(s.b, w1);
          const bar = h('div.ch-cal-span.ch-cal-it', { class: (s.a < w0 ? 'cont-l ' : '') + (s.b > w1 ? 'cont-r' : ''), style: { '--c': WB.colorOf(s.e), '--a': String(a - w0), '--n': String(b - a + 1), '--slot': String(s.slot) }, title: s.e.title + ' · ' + WB.fmt.span(s.e) },
            [h('span.ch-cal-span-ico', { text: WB.iconOf(s.e) }), h('span.gk-ellipsis', { text: s.e.title })]);
          bar.addEventListener('click', ev => { ev.stopPropagation(); if (ev.ctrlKey) WB.peek(s.e.id); else WB.peek(s.e.id); });
          bar.addEventListener('dblclick', ev => { ev.stopPropagation(); WB.open(s.e.id); });
          bar.addEventListener('contextmenu', ev => { ev.preventDefault(); ev.stopPropagation(); WB.ui.entryMenu(s.e, ev); });
          week.appendChild(bar);
        }
        grid.appendChild(week);
      }
      main.appendChild(grid);
    }
    function dayCell(day, idx, nowDay) {
      const p = C.ymd(day), out = p.m !== m || p.y !== y;
      const season = C.season(day), seasonPrev = C.season(day - 1);
      const cell = h('div.ch-day', { class: (out ? 'out ' : '') + (day === nowDay ? 'today ' : '') + (day === selDay ? 'sel' : ''), dataset: { day: String(day) }, tabindex: -1 });
      const head = h('div.ch-day-head', [h('span.ch-day-n', { text: String(p.d) })]);
      if (st.moons) {
        for (const mo of C.moons(day)) {
          const i = phaseIdx(mo.phase), ip = phaseIdx(C.moons(day - 1).find(x => x.name === mo.name).phase);
          if (i !== ip && QUARTERS.has(i)) head.appendChild(h('span.ch-moon', { class: i === 4 ? 'full' : i === 0 ? 'new' : '', style: mo.color ? { '--mc': mo.color } : null, title: mo.name + ': ' + mo.phaseName.toLowerCase() }, [h('span.ch-moon-ico', { text: mo.icon })]));
        }
      }
      cell.appendChild(head);
      if (season && season !== seasonPrev) cell.appendChild(h('div.ch-season', { text: '❀ ' + season, title: season + ' begins' }));
      const list = h('div.ch-day-items');
      const st0 = idx.starts.get(day) || [], en0 = idx.ends.get(day) || [];
      const items = st0.map(e => [e, 'start']).concat(en0.map(e => [e, 'end']));
      items.slice(0, 3).forEach(([e, which]) => {
        const t = WB.typeOf(e) || {};
        const lbl = which === 'end' ? ((t.dated && t.dated.end) || 'Ends') + ': ' : t.lifespan ? ((t.dated && t.dated.start) || 'Born') + ': ' : '';
        const it = h('div.ch-cal-it', { class: which, style: { '--c': WB.colorOf(e) }, title: e.title + ' · ' + CH.when(e) }, [h('span.ch-cal-it-ico', { text: which === 'end' && t.lifespan ? '†' : WB.iconOf(e) }), h('span.gk-ellipsis', { text: lbl + e.title })]);
        it.addEventListener('click', ev => { ev.stopPropagation(); selDay = day; WB.peek(e.id); paintSel(); });
        it.addEventListener('dblclick', ev => { ev.stopPropagation(); WB.open(e.id); });
        it.addEventListener('contextmenu', ev => { ev.preventDefault(); ev.stopPropagation(); WB.ui.entryMenu(e, ev); });
        list.appendChild(it);
      });
      if (items.length > 3) list.appendChild(h('div.ch-more.gk-tiny', { text: '+' + (items.length - 3) + ' more' }));
      cell.appendChild(list);
      cell.addEventListener('click', () => { selDay = day; if (out) goto(day, true); else paintSel(); });
      cell.addEventListener('dblclick', () => { if (CH.canEdit()) CH.createAt({ day, min: null, prec: 'day' }, { type: 'event' }); });
      cell.addEventListener('contextmenu', ev => { ev.preventDefault(); dayMenu(day, ev); });
      return cell;
    }
    function paintSel() {
      main.querySelectorAll('.ch-day.sel, .ch-ymonth .sel').forEach(x => x.classList.remove('sel'));
      const c = main.querySelector('.ch-day[data-day="' + selDay + '"]');
      if (c) c.classList.add('sel');
      paintSide();
    }
    function dayMenu(day, ev) {
      const date = { day, min: null, prec: 'day' };
      WB.ui.menu([
        { header: WB.fmt.date(date, 'full') },
        CH.canEdit() ? { label: 'New event on this day', icon: '✷', onClick: () => CH.createAt(date, { type: 'event' }) } : null,
        { label: 'Show on the timeline', icon: '⟷', onClick: () => env.go('timeline', { day, prec: 'day' }) },
        { label: 'Who was alive then?', icon: '⌛', onClick: () => env.go('ages', { day }) },
        CH.canEdit() ? '-' : null,
        CH.canEdit() ? { label: 'Make this the world’s date', icon: '◉', onClick: async () => { const from = WB.now; await WB.api('worlds.update', WB.worldId, { now: date }); await WB.reloadWorld(); WB.ui.undoToast('The world date is now ' + WB.fmt.date(date), async () => { await WB.api('worlds.update', WB.worldId, { now: from }); await WB.reloadWorld(); }); } } : null,
      ], ev);
    }

    function paintYear() {
      const wk = C.weekdays.length || 7;
      const y0 = C.startOfYear(y), y1 = C.startOfYear(y + 1);
      const idx = index(y0, y1);
      const count = new Map();
      const bump = (d, n = 1) => count.set(d, (count.get(d) || 0) + n);
      for (const [d, l] of idx.starts) bump(d, l.length);
      for (const [d, l] of idx.ends) bump(d, l.length);
      for (const s of idx.spans) for (let d = Math.max(s.a, y0); d <= Math.min(s.b, y1 - 1); d++) bump(d, .5);
      const wrap = h('div.ch-year', { style: { '--wk': String(wk) } });
      for (let mi = 0; mi < C.months.length; mi++) {
        const first = C.fromYmd(y, mi, 1), len = C.monthLength(y, mi), lead = C.weekdays.length ? C.weekday(first) : 0;
        const box = h('button.ch-ymonth', { type: 'button', title: 'Open ' + C.monthName(mi), onclick: () => { m = mi; st.mode = 'month'; env.save(); modeSeg.querySelectorAll('button').forEach(b => b.classList.toggle('on', b.textContent === 'Month')); selDay = first; paint(); } }, [
          h('div.ch-ymonth-h', [h('b', { text: C.monthName(mi) }), h('span.gk-tiny.gk-muted', { text: C.season(first) || '' })]),
        ]);
        const g = h('div.ch-ymonth-g');
        for (let i = 0; i < lead; i++) g.appendChild(h('span'));
        for (let d = 1; d <= len; d++) {
          const day = first + d - 1, n = count.get(day) || 0;
          const full = st.moons && C.moons(day).some(mo => phaseIdx(mo.phase) === 4 && phaseIdx(C.moons(day - 1).find(x => x.name === mo.name).phase) !== 4);
          g.appendChild(h('span.ch-yd', { class: (day === WB.now.day ? 'today ' : '') + (n ? 'has ' : '') + (full ? 'full' : ''), style: n ? { '--n': String(Math.min(1, .35 + n * .22)) } : null, text: String(d) }));
        }
        box.appendChild(g);
        const evs = (idx.loose || []).filter(x => C.ymd((x.which === 'start' ? x.e.start : x.e.end).day).m === mi && x.e[x.which].prec === 'month');
        if (evs.length) box.appendChild(h('div.gk-tiny.gk-muted.gk-ellipsis', { text: evs.map(x => x.e.title).join(' · ') }));
        wrap.appendChild(box);
      }
      main.appendChild(wrap);
      const yl = idx.loose.filter(x => x.e[x.which].prec === 'year');
      if (yl.length || idx.ongoing.length) main.appendChild(h('div.ch-cal-ongoing', [h('span.gk-small.gk-muted', { text: 'This year:' }), ...yl.concat(idx.ongoing.map(e => ({ e }))).slice(0, 16).map(x => WB.ui.chip(x.e, { size: 'sm' }))]));
    }

    function paintSide() {
      GK.clear(side);
      const d = selDay, date = { day: d, min: null, prec: 'day' }, p = C.ymd(d);
      const lifeOn = GK.settings.get('wbLifespans') !== false;
      const on = [], during = [];
      for (const e of data.list) {
        if (!WB.visible(e)) continue;
        const t = WB.typeOf(e);
        if (!t) continue;
        const hitS = e.start && e.start.day === d && (e.start.prec === 'day' || e.start.prec === 'time');
        const hitE = e.end && e.end.day === d && (e.end.prec === 'day' || e.end.prec === 'time');
        if (hitS || hitE) { on.push([e, hitS ? 'start' : 'end']); continue; }
        if (!t.lifespan && e.start && e.end && e.start.day < d && S.endOf(C, e.end) > d + 1) during.push(e);
      }
      const ann = data.list.filter(e => WB.visible(e) && ['start', 'end'].some(w => { const x = e[w]; if (!x || (x.prec !== 'day' && x.prec !== 'time')) return false; const q = C.ymd(x.day); return q.m === p.m && q.d === p.d && q.y !== p.y; }));
      const fromNow = d === WB.now.day ? 'Today in the world' : CH.fromNow(d);
      GK.append(side, [
        h('div.ch-side-date', [h('div.gk-tiny.gk-muted', { text: fromNow.toUpperCase() }), h('h3', { text: WB.fmt.date(date, 'full') }), h('div.gk-small.gk-muted', { text: [C.season(d), C.eraOf(p.y).name].filter(Boolean).join(' · ') })]),
        h('div.ch-side-moons', C.moons(d).map(mo => h('div.ch-side-moon', { style: mo.color ? { '--mc': mo.color } : null }, [h('span.ch-moon.big', { class: mo.full ? 'full' : '' }, [h('span.ch-moon-ico', { text: mo.icon })]), h('div', [h('b.gk-small', { text: mo.name }), h('div.gk-tiny.gk-muted', { text: mo.phaseName + ' · ' + Math.round(mo.phase * 100) + '%' })])]))),
        CH.canEdit() ? h('div.gk-row.ch-side-acts', [
          ui.button({ label: 'New event', icon: '✷', small: true, onClick: () => CH.createAt(date, { type: 'event' }) }),
          ui.button({ label: 'Timeline', icon: '⟷', small: true, kind: 'ghost', onClick: () => env.go('timeline', { day: d, prec: 'day' }) }),
          ui.button({ label: 'Alive', icon: '⌛', small: true, kind: 'ghost', title: 'Who was alive on this day', onClick: () => env.go('ages', { day: d }) }),
        ]) : null,
        section('On this day', on.map(([e, w]) => sideRow(e, w === 'end' ? (((WB.typeOf(e) || {}).dated || {}).end || 'Ends') : (((WB.typeOf(e) || {}).dated || {}).start || 'Starts'))), 'Nothing dated on this day yet. Double-click a day to add an event.'),
        during.length ? section('Under way', during.slice(0, 12).map(e => sideRow(e, WB.fmt.span(e, 'short')))) : null,
        ann.length ? section('Anniversaries', ann.slice(0, 12).map(e => { const w = e.start && C.ymd(e.start.day).m === p.m && C.ymd(e.start.day).d === p.d ? 'start' : 'end'; const yrs = p.y - C.ymd(e[w].day).y; return sideRow(e, (yrs > 0 ? yrs + ' years ago' : -yrs + ' years ahead') + ' · ' + ((((WB.typeOf(e) || {}).dated) || {})[w] || w).toLowerCase()); })) : null,
        !lifeOn ? h('div.gk-tiny.gk-faint', { text: 'Lifespans are hidden (Appearance → Worldbuilder).' }) : null,
      ]);
    }
    const section = (t, rows, emptyText) => h('div.ch-side-sec', [h('div.ch-side-h', { text: t }), rows.length ? h('div.ch-side-list', rows) : h('div.gk-small.gk-faint', { text: emptyText || '' })]);
    const sideRow = (e, sub) => WB.ui.row(e, { sub, onClick: (x, ev) => (ev.ctrlKey ? WB.peek(e.id) : WB.peek(e.id)), onDblClick: () => WB.open(e.id) });

    main.addEventListener('keydown', ev => {
      if (ev.key === 'PageUp') { ev.preventDefault(); step(ev.shiftKey ? 0 : -1, ev.shiftKey ? -1 : 0); }
      else if (ev.key === 'PageDown') { ev.preventDefault(); step(ev.shiftKey ? 0 : 1, ev.shiftKey ? 1 : 0); }
      else if (ev.key === 'Home') { ev.preventDefault(); goto(WB.now.day, true); }
      else if (/^Arrow/.test(ev.key) && st.mode === 'month') {
        ev.preventDefault();
        const wk = C.weekdays.length || 7;
        const delta = { ArrowLeft: -1, ArrowRight: 1, ArrowUp: -wk, ArrowDown: wk }[ev.key];
        selDay += delta;
        const q = C.ymd(selDay);
        if (q.m !== m || q.y !== y) goto(selDay, true); else paintSel();
      } else if (ev.key === 'Enter' && CH.canEdit()) CH.createAt({ day: selDay, min: null, prec: 'day' }, { type: 'event' });
    });
    main.addEventListener('wheel', ev => { if (!ev.ctrlKey) return; ev.preventDefault(); step(ev.deltaY > 0 ? 1 : -1, 0); }, { passive: false });
    paint();
    main.focus({ preventScroll: true });
    return {
      refresh: async () => { data = await CH.data(); paint(); },
      cleanup: () => {},
    };
  }
})();
