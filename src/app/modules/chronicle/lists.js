/* Chronicle lists: the Chronology (everything dated, grouped era → year → month, printable), Ages (who is alive on a
   date and how old, plus what happened on that day in other years) and Eras (calendar eras, named periods and the
   calendar at a glance). */
(function () {
  'use strict';
  const GK = window.GK, WB = window.WB, h = GK.h, ui = GK.ui, CH = WB.chronicle, S = window.WBChronScale;
  const isPeriodTag = id => { const t = WB.tag(id); return !!t && /^(period|era|age)s?$/i.test(t.name); };

  /* ================= Chronology ================= */
  CH.views.chronology = {
    async mount(host, env) {
      const st = env.state.chrono, C = WB.cal;
      let data = await CH.data(), limit = 500;
      if (st.ends == null) st.ends = true;
      const types = () => WB.typeList().filter(t => data.list.some(e => e.typeId === t.id));
      const chipsBox = h('div.ch-chrono-types');
      const search = WB.ui.search({ placeholder: 'Filter the chronology', value: st.text, onInput: v => { st.text = v; env.save(); paint(); } });
      const order = ui.segmented({ value: st.order, options: [['asc', 'Oldest first'], ['desc', 'Newest first']], onChange: v => { st.order = v; env.save(); paint(); } });
      const endsChip = ui.chip({ label: '† Endings', on: st.ends, title: 'Also list when things end: deaths, falls, the end of wars', onClick: () => { st.ends = !st.ends; endsChip.classList.toggle('on', st.ends); env.save(); paint(); } });
      const exportBtn = ui.button({ label: 'Export', icon: '⇩', small: true, title: 'Copy, save or print the chronology', onClick: () => CH.exportMenu(exportBtn, { title: (WB.world.name || 'World') + ' — Chronology', md: () => md(), html: () => html() }) });
      const count = h('span.gk-small.gk-muted');
      const list = h('div.ch-chrono');
      const panel = ui.panel({ cls: 'ch-chrono-panel', body: [h('div.ch-list-bar', [search, order, endsChip, h('span.gk-grow'), count, exportBtn]), chipsBox, list] });
      host.appendChild(panel);
      const paintChips = () => { GK.clear(chipsBox); chipsBox.appendChild(CH.typeChips(types(), st.types, v => { st.types = v; env.save(); paint(); })); };

      function rows() {
        const q = (st.text || '').trim().toLowerCase(), life = GK.settings.get('wbLifespans') !== false;
        const out = [];
        for (const e of data.list) {
          if (!WB.visible(e)) continue;
          const t = WB.typeOf(e);
          if (!t) continue;
          if (st.types.length && !st.types.includes(e.typeId)) continue;
          if (q && !(e.title.toLowerCase().includes(q) || (e.summary || '').toLowerCase().includes(q))) continue;
          const labels = t.dated || { start: 'Began', end: 'Ended' };
          if (e.start) out.push({ e, t, which: 'start', date: e.start, label: labels.start });
          if (e.end && (st.ends || !e.start)) out.push({ e, t, which: 'end', date: e.end, label: labels.end || 'Ended' });
          if (t.lifespan && !life && !e.start) out.pop();
        }
        out.sort((a, b) => (a.date.day - b.date.day) || ((a.date.min || 0) - (b.date.min || 0)) || S.RANK[a.date.prec] - S.RANK[b.date.prec] || a.e.title.localeCompare(b.e.title));
        if (st.order === 'desc') out.reverse();
        return out;
      }
      function paint() {
        const all = rows();
        count.textContent = WB.fmt.plural(all.length, 'record');
        GK.clear(list);
        if (!data.list.length) { list.appendChild(WB.ui.empty({ icon: '☰', title: 'Nothing is dated yet', text: 'Dates you give entries (born, founded, began…) appear here in order, grouped by era and year.' })); return; }
        if (!all.length) { list.appendChild(WB.ui.empty({ icon: '⚲', title: 'Nothing matches', text: 'Try fewer filters.' })); return; }
        let era = null, year = null, month = null;
        const perYear = new Map();
        for (const r of all) { const yy = C.ymd(r.date.day).y; perYear.set(yy, (perYear.get(yy) || 0) + 1); }
        for (const r of all.slice(0, limit)) {
          const p = C.ymd(r.date.day), er = C.eraOf(p.y);
          const eraKey = er.index + '';
          if (eraKey !== era) { era = eraKey; year = null; list.appendChild(h('div.ch-chrono-era', [h('span', { text: er.name || 'Undated era' }), er.abbr ? h('span.gk-small.gk-muted', { text: ' · ' + er.abbr }) : null])); }
          if (p.y !== year) { year = p.y; month = null; list.appendChild(h('div.ch-chrono-year', [h('b', { text: C.yearText(p.y) }), h('span.gk-tiny.gk-muted', { text: yearNote(p.y) })])); }
          const mk = r.date.prec === 'year' ? -1 : p.m;
          if (mk !== month && mk >= 0 && perYear.get(p.y) >= 5) { month = mk; list.appendChild(h('div.ch-chrono-month', { text: C.monthName(p.m) })); }
          list.appendChild(row(r));
        }
        if (all.length > limit) list.appendChild(h('div.ch-more-row', [ui.button({ label: 'Show ' + Math.min(500, all.length - limit) + ' more', small: true, onClick: () => { limit += 500; paint(); } })]));
      }
      const yearNote = yy => { const n = C.ymd(WB.now.day).y; return yy === n ? '  · this year' : yy > n ? '  · in ' + WB.fmt.plural(yy - n, 'year') : ''; };
      function row(r) {
        const e = r.e, d = r.date, p = C.ymd(d.day);
        const dateTxt = d.prec === 'year' ? 'in the year' : d.prec === 'month' ? C.monthName(p.m) : p.d + ' ' + C.monthName(p.m) + (d.prec === 'time' ? ', ' + C.timeText(d.min) : '');
        const span = r.which === 'start' && e.end ? ' → ' + WB.fmt.date(e.end) + ' (' + CH.dur(e.start.day, e.end.day) + ')' : '';
        const age = r.which === 'end' && r.t.lifespan && e.start ? ' at ' + C.age(e.start, e.end) : '';
        const el = h('div.ch-chrono-row', { class: r.which + (d.day > WB.now.day ? ' future' : ''), style: { '--c': WB.colorOf(e) } }, [
          h('div.ch-chrono-date', { text: dateTxt }),
          h('div.ch-chrono-what', [
            h('div.gk-row.nowrap.ch-chrono-line', [h('span.ch-kind', { text: r.label }), WB.ui.chip(e, { size: 'sm' }), h('span.gk-small.gk-muted', { text: span + age })]),
            e.summary && r.which === 'start' ? h('div.gk-small.gk-muted.ch-chrono-sum', { text: e.summary }) : null,
          ]),
        ]);
        return el;
      }
      function md() {
        const out = ['# ' + (WB.world.name || 'World') + ' — Chronology', '', '_' + (C.cal.name || 'World calendar') + ' · as of ' + WB.fmt.date(WB.now) + '_', ''];
        let year = null, era = null;
        for (const r of rows()) {
          const p = C.ymd(r.date.day), er = C.eraOf(p.y);
          if (era !== er.index) { era = er.index; out.push('', '## ' + (er.name || 'Era')); }
          if (year !== p.y) { year = p.y; out.push('', '### ' + C.yearText(p.y)); }
          out.push('- **' + WB.fmt.date(r.date) + '** — ' + r.label + ': ' + CH.mdEsc(r.e.title) + (r.which === 'start' && r.e.end ? ' (until ' + WB.fmt.date(r.e.end) + ')' : '') + (r.e.summary && r.which === 'start' ? ' — ' + CH.mdEsc(r.e.summary) : ''));
        }
        return out.join('\n') + '\n';
      }
      function html() {
        let body = '<h1>' + WB.esc(WB.world.name || 'World') + ' — Chronology</h1><p class="sub">' + WB.esc(C.cal.name || '') + ' · as of ' + WB.esc(WB.fmt.date(WB.now)) + '</p>';
        let year = null, era = null;
        for (const r of rows()) {
          const p = C.ymd(r.date.day), er = C.eraOf(p.y);
          if (era !== er.index) { era = er.index; body += '<h2>' + WB.esc(er.name || 'Era') + '</h2>'; }
          if (year !== p.y) { year = p.y; body += '<h3>' + WB.esc(C.yearText(p.y)) + '</h3>'; }
          body += '<div class="rec"><div class="d">' + WB.esc(WB.fmt.date(r.date)) + '</div><div><span class="k">' + WB.esc(r.label) + '</span><b>' + WB.esc(r.e.title) + '</b>' + (r.which === 'start' && r.e.end ? ' <span class="s">until ' + WB.esc(WB.fmt.date(r.e.end)) + '</span>' : '') + (r.e.summary && r.which === 'start' ? '<div class="s">' + WB.esc(r.e.summary) + '</div>' : '') + '</div></div>';
        }
        return CH.htmlDoc((WB.world.name || 'World') + ' — Chronology', body);
      }
      paintChips(); paint();
      return { refresh: async () => { data = await CH.data(); paintChips(); paint(); } };
    },
  };

  /* ================= Ages: who is alive on a date ================= */
  CH.views.ages = {
    async mount(host, env) {
      const st = env.state.ages, C = WB.cal;
      let day = env.params.day != null ? +env.params.day : st.day != null && !env.params.fresh ? st.day : WB.now.day;
      const dateIn = h('div.ch-ages-date');
      const body = h('div.ch-ages');
      const side = h('div.ch-ages-side');
      const panel = ui.panel({ cls: 'ch-ages-panel', body: [h('div.ch-list-bar', [dateIn]), h('div.ch-ages-cols', [body, side])] });
      host.appendChild(panel);
      const set = d => { day = d; st.day = d; env.save(); paint(); };
      function paintBar() {
        GK.clear(dateIn);
        const y = C.ymd(day).y;
        GK.append(dateIn, [
          h('span.gk-small.gk-muted', { text: 'Alive on' }),
          WB.ui.dateInput({ value: { day, min: null, prec: 'day' }, allowEmpty: false, onChange: v => v && set(v.day) }),
          ui.group([
            ui.button({ label: '−10 y', small: true, title: 'Ten years earlier', onClick: () => set(C.add({ day, prec: 'day' }, { years: -10 }).day) }),
            ui.button({ label: '−1 y', small: true, onClick: () => set(C.add({ day, prec: 'day' }, { years: -1 }).day) }),
            ui.button({ label: '+1 y', small: true, onClick: () => set(C.add({ day, prec: 'day' }, { years: 1 }).day) }),
            ui.button({ label: '+10 y', small: true, onClick: () => set(C.add({ day, prec: 'day' }, { years: 10 }).day) }),
          ]),
          ui.button({ label: 'Today', small: true, kind: day === WB.now.day ? 'primary' : '', title: 'The world’s current date', onClick: () => set(WB.now.day) }),
          h('span.gk-grow'),
          h('span.gk-small.gk-muted', { text: day === WB.now.day ? 'today in the world' : CH.fromNow(day) + ' · ' + C.yearText(y) }),
        ]);
      }
      async function paint() {
        paintBar();
        const [r, otd] = await Promise.all([WB.api('chronicle.alive', WB.worldId, day), CH.onThisDay(day)]);
        const alive = r.alive.filter(e => WB.visible(e));
        GK.clear(body); GK.clear(side);
        if (!alive.length) {
          body.appendChild(WB.ui.empty({ icon: '⌛', title: 'Nobody alive on this date', text: r.unborn ? WB.fmt.plural(r.unborn, 'person is', 'people are') + ' not born yet; ' + WB.fmt.plural(r.dead, 'has', 'have') + ' already died.' : 'Give characters a birth date (and a death date) and their ages appear here for any day of history.' }));
        } else {
          const oldest = Math.max(1, ...alive.map(e => e.age || 0));
          const groups = new Map();
          for (const e of alive) { const t = WB.typeOf(e); const k = t ? t.id : ''; if (!groups.has(k)) groups.set(k, { t, list: [] }); groups.get(k).list.push(e); }
          for (const { t, list } of groups.values()) {
            body.appendChild(h('div.ch-ages-h', [h('span', { text: (t ? t.icon + ' ' + t.plural : 'Others') }), h('span.gk-small.gk-muted', { text: ' · ' + list.length + ' alive' })]));
            for (const e of list) {
              const willDie = e.end && e.end.day > day;
              const rowEl = h('div.ch-age-row', { style: { '--c': WB.colorOf(e), '--f': String((e.age || 0) / oldest) } }, [
                h('div.ch-age-who', [WB.ui.chip(e, { size: 'sm' })]),
                h('div.ch-age-bar', [h('i')]),
                h('div.ch-age-n', [h('b', { text: e.age == null ? '?' : String(e.age) }), h('span.gk-tiny.gk-muted', { text: e.age === 1 ? ' year' : ' years' })]),
                h('div.gk-tiny.gk-muted.ch-age-note', { text: 'born ' + WB.fmt.date(e.start, 'short') + (willDie && !WB.share ? ' · dies in ' + CH.dur(day, e.end.day) : '') }),
              ]);
              body.appendChild(rowEl);
            }
          }
        }
        const sec = (title, kids, emptyText) => h('div.ch-side-sec', [h('div.ch-side-h', { text: title }), kids.length ? h('div.ch-side-list', kids) : h('div.gk-small.gk-faint', { text: emptyText })]);
        const yr = C.yearText(C.ymd(day).y);
        GK.append(side, [
          h('div.ch-ages-stats', [
            WB.ui.stat({ label: 'Alive', value: alive.length, icon: '☺' }),
            WB.ui.stat({ label: 'Not yet born', value: r.unborn, icon: '◌' }),
            WB.ui.stat({ label: 'Dead by then', value: r.dead, icon: '†' }),
          ]),
          sec('On this day in other years', otd.filter(e => e.anniversary.years !== 0).slice(0, 14).map(e => WB.ui.row(e, { sub: (e.anniversary.years > 0 ? e.anniversary.years + ' years ago' : -e.anniversary.years + ' years later') + ' · ' + ((((WB.typeOf(e) || {}).dated) || {})[e.anniversary.which] || e.anniversary.which).toLowerCase() + ' ' + WB.fmt.date(e.anniversary.date, 'short') })), 'No anniversaries on this day.'),
          sec('Born in ' + yr, r.born.filter(e => WB.visible(e)).map(e => WB.ui.row(e, { sub: WB.fmt.date(e.start) })), 'Nobody.'),
          sec('Died in ' + yr, r.died.filter(e => WB.visible(e)).map(e => WB.ui.row(e, { sub: WB.fmt.date(e.end) + (e.start ? ' · aged ' + C.age(e.start, e.end) : '') })), 'Nobody.'),
        ]);
      }
      await paint();
      return { refresh: () => paint() };
    },
  };

  /* ================= Eras & periods ================= */
  CH.views.eras = {
    async mount(host, env) {
      const C = WB.cal;
      let data = await CH.data();
      const box = h('div.ch-eras');
      host.appendChild(box);
      function paint() {
        GK.clear(box);
        const c = C.cal, nowY = C.ymd(WB.now.day).y;
        const count = (a, b) => data.list.filter(e => WB.visible(e) && e.start && e.start.day >= a && e.start.day < b).length;
        // calendar eras
        const eras = [];
        if (c.eras.length && c.before) eras.push({ name: c.before.name || 'Before', abbr: c.before.abbr, y0: null, y1: c.eras[0].start - 1, index: -1 });
        c.eras.forEach((e, i) => eras.push({ name: e.name, abbr: e.abbr, y0: e.start, y1: i + 1 < c.eras.length ? c.eras[i + 1].start - 1 : null, index: i }));
        const cards = eras.map(er => {
          const a = er.y0 == null ? -Infinity : C.startOfYear(er.y0), b = er.y1 == null ? Infinity : C.startOfYear(er.y1 + 1);
          const n = count(a, b), current = (er.y0 == null || nowY >= er.y0) && (er.y1 == null || nowY <= er.y1);
          const len = er.y0 != null && er.y1 != null ? WB.fmt.plural(er.y1 - er.y0 + 1, 'year') : er.y0 != null ? WB.fmt.plural(nowY - er.y0 + 1, 'year') + ' so far' : 'counts back from ' + C.yearText(er.y1 + 1);
          return h('div.ch-era-card', { class: current ? 'current' : '' }, [
            h('div.ch-era-card-h', [h('b', { text: er.name || '(unnamed era)' }), er.abbr ? h('span.wb-badge', { text: er.abbr }) : null, current ? h('span.wb-badge.accent', { text: 'now' }) : null]),
            h('div.gk-small', { text: er.y0 == null ? 'Until ' + C.yearText(er.y1) : C.yearText(er.y0) + ' – ' + (er.y1 == null ? 'today (' + C.yearText(nowY) + ')' : C.yearText(er.y1)) }),
            h('div.gk-small.gk-muted', { text: len + ' · ' + WB.fmt.plural(n, 'dated entry', 'dated entries') }),
            ui.button({ label: 'Show on the timeline', small: true, kind: 'ghost', icon: '⟷', onClick: () => {
              const lo = isFinite(a) ? a : Math.min(...data.list.filter(e => e.start).map(e => e.start.day), b - C.avgYear * 100);
              const hi = isFinite(b) ? b : Math.max(WB.now.day, ...data.list.filter(e => e.start).map(e => e.start.day)) + C.avgYear;
                            env.go('timeline', { day: Math.round((lo + hi) / 2), spanDays: hi - lo });
            } }),
          ]);
        });
        box.appendChild(ui.panel({ title: 'Eras of the ' + (c.name || 'calendar'), icon: '◫', actions: [ui.button({ label: 'Edit the calendar', small: true, icon: '✎', onClick: () => WB.go('world', { tab: 'calendar' }) })],
          body: [cards.length ? h('div.ch-era-cards', cards) : h('p.gk-muted', { text: 'This calendar has no eras: years are plain numbers. Add eras in World settings → World → Calendar (for example "Before the Flood" and "Age of Tides").' })] }));
        // named periods
        const periods = data.list.filter(e => {
          if (!WB.visible(e) || !e.start || !e.end) return false;
          const t = WB.typeOf(e);
          if (!t || t.lifespan) return false;
          const tagged = (e.tags || []).some(isPeriodTag);
          return tagged || (t.key === 'event' && S.endOf(C, e.end) - e.start.day >= C.avgYear * .98);
        });
        const longest = Math.max(1, ...periods.map(e => S.endOf(C, e.end) - e.start.day));
        box.appendChild(ui.panel({ title: 'Named periods', icon: '▬', sub: 'Events that last a year or more, or carry the #period tag, are drawn as bands above the timeline.',
          body: [periods.length ? h('div.ch-periods', periods.map(e => {
            const len = S.endOf(C, e.end) - e.start.day, kids = data.list.filter(x => x.parentId === e.id).length;
            return h('div.ch-period-row', { style: { '--c': WB.colorOf(e), '--f': String(Math.max(.02, len / longest)) } }, [
              h('div', [WB.ui.chip(e, { size: 'sm' }), h('div.gk-tiny.gk-muted', { text: WB.fmt.span(e) + ' · ' + CH.dur(e.start.day, S.endOf(C, e.end)) + (kids ? ' · ' + WB.fmt.plural(kids, 'part') : '') })]),
              h('div.ch-period-len', [h('i')]),
              h('div.gk-row.nowrap', [
                ui.button({ label: 'Timeline', small: true, kind: 'ghost', icon: '⟷', onClick: () => env.go('timeline', { entryId: e.id }) }),
                ui.button({ label: 'History', small: true, kind: 'ghost', icon: '⧉', onClick: () => env.go('annals', { entryId: e.id }) }),
              ]),
            ]);
          })) : h('p.gk-muted', { text: 'No periods yet. Give an event a start and an end a year or more apart — "The Salt War", "The Long Winter" — or tag any dated entry #period.' })] }));
        // the calendar at a glance
        const yl = C.yearLength(nowY);
        box.appendChild(ui.panel({ title: 'The calendar at a glance', icon: '▦', body: [h('div.ch-glance', [
          h('div', [h('div.ch-side-h', { text: 'Months' }), h('ol.ch-glance-months', C.months.map((mo, i) => h('li', [h('span', { text: mo.name }), h('span.gk-muted.gk-small', { text: ' ' + C.monthLength(nowY, i) + ' days' })])))]),
          h('div', [
            h('div.ch-side-h', { text: 'Year' }), h('p.gk-small', { text: yl + ' days' + (c.leap ? ' · leap years add ' + WB.fmt.plural(c.leap.days, 'day') + ' to ' + C.monthName(c.leap.month) + ' every ' + c.leap.every + ' years' : ' · no leap years') }),
            c.weekdays.length ? h('div.ch-side-h', { text: 'Week · ' + c.weekdays.length + ' days' }) : null,
            c.weekdays.length ? h('p.gk-small', { text: c.weekdays.join(' · ') }) : null,
            h('div.ch-side-h', { text: 'Day' }), h('p.gk-small', { text: c.hoursPerDay + ' hours of ' + c.minutesPerHour + ' minutes' }),
          ]),
          h('div', [
            h('div.ch-side-h', { text: 'Moons' }),
            c.moons.length ? h('div.ch-side-list', c.moons.map(mo => { const ph = C.moons(WB.now.day).find(x => x.name === mo.name); return h('div.ch-side-moon', { style: mo.color ? { '--mc': mo.color } : null }, [h('span.ch-moon.big', [h('span.ch-moon-ico', { text: ph ? ph.icon : '○' })]), h('div', [h('b.gk-small', { text: mo.name }), h('div.gk-tiny.gk-muted', { text: 'a ' + (+mo.cycle).toFixed(mo.cycle % 1 ? 1 : 0) + '-day cycle · now ' + (ph ? ph.phaseName.toLowerCase() : '') })])]); })) : h('p.gk-small.gk-muted', { text: 'No moons.' }),
            h('div.ch-side-h', { text: 'Seasons' }),
            c.seasons.length ? h('p.gk-small', { text: c.seasons.map(s => s.name + ' (' + s.day + ' ' + C.monthName(s.month, true) + ')').join(' · ') }) : h('p.gk-small.gk-muted', { text: 'No seasons.' }),
          ]),
        ])] }));
      }
      paint();
      return { refresh: async () => { data = await CH.data(); paint(); } };
    },
  };
})();
