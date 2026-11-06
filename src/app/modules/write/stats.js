/* Write · statistics: today against the daily goal, the streak (and the best one), the week, the average writing day,
   time spent; words per day for the last 30 or 90 days (one series, the goal as a dashed line, a tooltip per day);
   every story's words against its target, chapters, scenes, how far its scenes have come (Idea → Final), reading
   time and pages; the entries worked on most and the latest focus sessions and sprints. */
(function () {
  'use strict';
  const W = window.WBW = window.WBW || {};
  const h = GK.h, ui = GK.ui;
  const STATUS_ORDER = ['Idea', 'Outline', 'Draft', 'Revised', 'Final', 'None'];

  W.statsView = function (r, host) {
    const box = h('div.wbw-stats', { hidden: true });
    const head = h('div.wbw-bhead');
    const scroll = h('div.wbw-bscroll');
    box.append(head, scroll);
    host.appendChild(box);
    let seq = 0, data = null;

    async function show() {
      box.hidden = false;
      paintHead();
      if (!data) { GK.clear(scroll); scroll.appendChild(h('div.wbw-loading.gk-faint', { text: 'Counting…' })); }
      await load();
    }
    function hide() { box.hidden = true; }
    async function load() {
      const my = ++seq;
      const d = await WB.api('write.stats', r.worldId, { days: r.pref('statsDays') || 30 }).catch(e => { WB.fail(e); return null; });
      if (my !== seq || !d || box.hidden) return;
      data = d;
      paint();
    }
    function paintHead() {
      GK.clear(head);
      const goalIn = ui.input({ type: 'number', value: String((WB.world && WB.world.settings.wordGoal) || 500) });
      goalIn.classList.add('wbw-goal-in');
      goalIn.min = '0'; goalIn.step = '50';
      goalIn.readOnly = WB.share;
      const saveGoal = WB.debounce(async v => { const n = Math.max(0, Math.round(+v || 0)); try { await WB.api('worlds.update', r.worldId, { settings: { wordGoal: n } }); if (WB.world) WB.world.settings.wordGoal = n; load(); } catch (e) { WB.fail(e); } }, 700);
      goalIn.addEventListener('input', () => saveGoal(goalIn.value));
      head.append(
        h('div.wbw-bhead-l', [h('h3', { text: 'Writing statistics' }), h('span.gk-small.gk-muted', { text: 'All stories in “' + ((WB.world && WB.world.name) || 'this world') + '”' })]),
        h('div.wbw-bhead-r', [
          h('label.wbw-goal-field', { title: 'Words you want to write every day (for this world)' }, [h('span.gk-small.gk-muted', { text: 'Daily goal' }), goalIn, h('span.gk-small.gk-muted', { text: 'words' })]),
          ui.segmented({ value: String(r.pref('statsDays') || 30), options: [['30', '30 days'], ['90', '90 days']], onChange: v => { r.setPref('statsDays', +v); load(); } }),
        ]),
      );
    }

    function paint() {
      const d = data, top = scroll.scrollTop;
      GK.clear(scroll);
      const live = Math.max(0, W.sessionTotal());
      const today = d.today || 0;
      const goal = d.goal || 500;
      const tile = (label, value, note, extra, tone) => h('div.wbw-tile', { class: tone || '' }, [h('div.wbw-tile-l', { text: label }), h('div.wbw-tile-v', [value]), note ? h('div.wbw-tile-n', { text: note }) : null, extra || null]);
      const pct = goal ? Math.round(today / goal * 100) : 0;
      scroll.append(h('div.wbw-tiles', [
        tile('Today', [h('b', { text: W.num(today) }), h('span.wbw-tile-of', { text: ' / ' + W.num(goal) })], today >= goal ? 'Goal reached ✓' : W.num(Math.max(0, goal - today)) + ' to go · ' + pct + '%', W.bar(goal ? today / goal : 0, 'tile'), today >= goal ? 'good' : ''),
        tile('Streak', [h('b', { text: String(d.streak || 0) }), h('span.wbw-tile-of', { text: d.streak === 1 ? ' day' : ' days' })], 'Best ' + (d.best || 0) + (d.best === 1 ? ' day' : ' days') + (today ? '' : ' · write today to keep it'), null, d.streak ? 'warm' : ''),
        tile('This week', h('b', { text: W.num(d.week || 0) }), 'words in the last 7 days'),
        tile('Writing day', h('b', { text: W.num(d.average || 0) }), 'average on the ' + (d.activeDays || 0) + ' days you wrote (of ' + d.days + ')'),
        tile('Time', h('b', { text: W.minutes(d.periodSeconds || 0) }), W.minutes(d.todaySeconds || 0) + ' today' + (W.session.active ? ' · this session ' + W.minutes(W.session.active) : '')),
        tile('Manuscripts', h('b', { text: W.num(d.manuscriptWords || 0) }), W.readTime(d.manuscriptWords) + (live ? ' · +' + W.num(live) + ' this session' : '')),
      ]));
      scroll.append(chart(d, goal));
      scroll.append(stories(d));
      scroll.append(h('div.wbw-stats-cols', [topList(d), sessions(d)]));
      scroll.scrollTop = top;
    }

    /* words per day: one series of bars, the goal as a dashed line, a tooltip for the day under the pointer */
    function chart(d, goal) {
      const series = d.series || [];
      const max = Math.max(goal * 1.15, ...series.map(s => s.words), 10);
      const step = niceStep(max / 3), ticks = [];
      for (let v = step; v < max; v += step) ticks.push(v);
      const plot = h('div.wbw-chart-plot');
      ticks.forEach(v => plot.appendChild(h('div.wbw-chart-grid', { style: { bottom: (v / max * 100) + '%' } }, [h('span', { text: W.k(v) })])));
      if (goal) plot.appendChild(h('div.wbw-chart-goal', { style: { bottom: (goal / max * 100) + '%' } }, [h('span', { text: 'goal ' + W.num(goal) })]));
      const cols = h('div.wbw-chart-cols', { style: { '--n': String(series.length) } });
      const todayIso = WB.today();
      series.forEach((s, i) => {
        const v = Math.max(0, s.words);
        cols.appendChild(h('div.wbw-chart-col', { class: (s.day === todayIso ? 'today ' : '') + (v >= goal && goal ? 'met' : ''), dataset: { i: String(i) } }, [h('i', { style: { height: (v / max * 100) + '%' } })]));
      });
      plot.appendChild(cols);
      const tip = h('div.wbw-tip', { hidden: true });
      plot.appendChild(tip);
      const fmtDay = iso => { const dt = new Date(iso + 'T12:00:00'); return dt.toLocaleDateString(undefined, { weekday: 'short', day: 'numeric', month: 'short' }); };
      const showTip = (i, e) => {
        const s = series[i]; if (!s) return;
        tip.hidden = false;
        tip.replaceChildren(h('b', { text: fmtDay(s.day) + (s.day === todayIso ? ' · today' : '') }), h('div', { text: W.num(Math.max(0, s.words)) + ' words' + (goal && s.words >= goal ? ' · goal met ✓' : '') }), s.seconds ? h('div.gk-muted', { text: W.minutes(s.seconds) + ' writing' }) : null);
        const col = cols.children[i], rc = col.getBoundingClientRect(), p = GK.pointIn(plot, rc.left + rc.width / 2, rc.top);
        const wTip = tip.offsetWidth, x = Math.max(4, Math.min(plot.clientWidth - wTip - 4, p.x - wTip / 2));
        tip.style.left = x + 'px';
        tip.style.top = Math.max(0, Math.min(plot.clientHeight - tip.offsetHeight, p.y + GK.local(plot, rc.height) - tip.offsetHeight - 10)) + 'px';
        cols.querySelectorAll('.hover').forEach(x2 => x2.classList.remove('hover'));
        col.classList.add('hover');
      };
      cols.addEventListener('pointermove', e => {
        const rc = cols.getBoundingClientRect();
        const i = Math.max(0, Math.min(series.length - 1, Math.floor((e.clientX - rc.left) / rc.width * series.length)));   // lint-ui: ok (a ratio of two screen lengths: the zoom cancels out)
        showTip(i, e);
      });
      cols.addEventListener('pointerleave', () => { tip.hidden = true; cols.querySelectorAll('.hover').forEach(x => x.classList.remove('hover')); });
      const labels = h('div.wbw-chart-x');
      const every = series.length > 40 ? 14 : 7;
      series.forEach((s, i) => { if ((series.length - 1 - i) % every === 0) labels.appendChild(h('span', { style: { left: ((i + .5) / series.length * 100) + '%' }, text: s.day === todayIso ? 'today' : fmtDay(s.day).replace(/^\w+,?\s*/, '') })); });
      const total = series.reduce((a, s) => a + Math.max(0, s.words), 0), met = series.filter(s => goal && s.words >= goal).length;
      // a table view of the same numbers, for screen readers and exact values
      const table = h('table.wbw-sr', [h('caption', { text: 'Words per day' }), h('tbody', series.map(s => h('tr', [h('td', { text: s.day }), h('td', { text: String(Math.max(0, s.words)) })])))]);
      return h('section.wbw-chart', [
        h('div.wbw-chart-head', [h('h4', { text: 'Words per day' }), h('span.gk-small.gk-muted', { text: W.num(total) + ' words in ' + d.days + ' days · goal met on ' + met + (met === 1 ? ' day' : ' days') + (d.bestDay && d.bestDay.words > 0 ? ' · best day ' + W.num(d.bestDay.words) : '') })]),
        plot, labels, table,
      ]);
    }
    const niceStep = raw => { const p = Math.pow(10, Math.floor(Math.log10(Math.max(1, raw)))); const f = raw / p; return (f <= 1 ? 1 : f <= 2 ? 2 : f <= 5 ? 5 : 10) * p; };

    function stories(d) {
      const sec = h('section.wbw-stats-stories', [h('div.wbw-chart-head', [h('h4', { text: 'Stories' }), h('span.gk-small.gk-muted', { text: d.stories.length === 1 ? 'one story' : d.stories.length + ' stories' })])]);
      if (!d.stories.length) { sec.appendChild(h('p.gk-muted.gk-small', { text: 'No stories yet. Start one and it shows up here with its progress.' })); return sec; }
      const statuses = STATUS_ORDER.filter(k => d.stories.some(s => s.status[k]));
      for (const s of d.stories) {
        const n = r.model.get(s.id);
        const tgt = s.target, f = tgt ? s.words / tgt : 0, total = Object.values(s.status).reduce((a, b) => a + b, 0) || 1;
        const pages = Math.max(1, Math.round(s.words / (s.format === 'script' ? 180 : 300)));
        sec.appendChild(h('div.wbw-srow', { tabindex: 0, title: 'Open in Write', onclick: () => r.select(s.id, { mode: 'write' }), onkeydown: e => { if (e.key === 'Enter') r.select(s.id, { mode: 'write' }); } }, [
          h('div.wbw-srow-t', [
            h('span.wbw-srow-ico', { text: W.storyIcon(n || { write: { format: s.format } }) }),
            h('div.gk-grow', [h('b.gk-ellipsis', { text: s.title }), h('div.gk-small.gk-muted', { text: [s.chapters + (s.chapters === 1 ? ' chapter' : ' chapters'), s.scenes + (s.scenes === 1 ? ' scene' : ' scenes'), W.readTime(s.words), '≈ ' + pages + (pages === 1 ? ' page' : ' pages')].join(' · ') })]),
            s.stage ? h('span.wbw-pill', { style: { '--c': W.statusColor({ kind: 'story', typeId: n && n.typeId }, s.stage) || 'var(--faint)' }, text: s.stage }) : null,
          ]),
          h('div.wbw-srow-p', [
            h('div.wbw-srow-w', [h('b', { text: W.num(s.words) }), h('span.gk-muted', { text: tgt ? ' / ' + W.num(tgt) + ' · ' + Math.round(f * 100) + '%' : ' words' })]),
            tgt ? W.bar(f, 'story') : null,
            s.period > 0 ? h('div.gk-small.gk-muted', { text: '+' + W.num(s.period) + ' in ' + d.days + ' days' + (s.seconds ? ' · ' + W.minutes(s.seconds) : '') }) : h('div.gk-small.gk-faint', { text: 'Nothing written in ' + d.days + ' days' }),
          ]),
          h('div.wbw-srow-s', [
            h('div.wbw-stack', { title: statuses.filter(k => s.status[k]).map(k => s.status[k] + ' ' + (k === 'None' ? 'without a status' : k.toLowerCase())).join(' · ') }, statuses.filter(k => s.status[k]).map(k => h('i', { style: { '--c': k === 'None' ? 'var(--line2)' : W.statusColor({ kind: 'scene' }, k), flexGrow: String(s.status[k] / total) } }))),
            h('div.wbw-legend', statuses.filter(k => s.status[k]).map(k => h('span', [h('span.wbw-sdot', { style: { '--c': k === 'None' ? 'var(--line2)' : W.statusColor({ kind: 'scene' }, k) } }), (k === 'None' ? 'No status' : k) + ' ' + s.status[k]]))),
          ]),
        ]));
      }
      return sec;
    }
    function topList(d) {
      const list = (d.top || []).filter(x => x.words > 0).slice(0, 6);
      const max = Math.max(1, ...list.map(x => x.words));
      return h('section.wbw-stats-box', [
        h('div.wbw-chart-head', [h('h4', { text: 'Worked on most' }), h('span.gk-small.gk-muted', { text: 'last ' + d.days + ' days' })]),
        list.length ? h('div.wbw-toplist', list.map(x => h('div.wbw-top', [
          WB.liteOf(x.id) ? WB.ui.chip(x.id, { size: 'sm', onClick: () => { if (r.model.get(x.id)) r.select(x.id, { mode: 'write' }); else WB.peek(x.id); } }) : h('span.gk-small', { text: x.title }),
          h('div.wbw-top-bar', [h('i', { style: { width: (x.words / max * 100) + '%' } })]),
          h('span.gk-small', { text: W.num(x.words) }),
        ]))) : h('p.gk-small.gk-faint', { text: 'Nothing yet in this period.' }),
      ]);
    }
    function sessions(d) {
      const list = d.sessions || [];
      return h('section.wbw-stats-box', [
        h('div.wbw-chart-head', [h('h4', { text: 'Focus sessions & sprints' })]),
        list.length ? h('div.wbw-sessions', list.slice(0, 8).map(s => h('div.wbw-sess', [
          h('span.wbw-sess-k', { text: s.kind === 'sprint' ? '⏱' : '◎', title: s.kind === 'sprint' ? 'Sprint' : 'Focus session' }),
          h('div.gk-grow', [h('div.gk-small.gk-ellipsis', { text: s.title || 'Writing' }), h('div.gk-tiny.gk-muted', { text: WB.fmt.rel(s.startedAt) + ' · ' + W.minutes(s.seconds) })]),
          h('b.gk-small', { text: (s.words >= 0 ? '+' : '') + W.num(s.words) }),
        ]))) : h('p.gk-small.gk-faint', { text: 'Sessions in focus mode (Ctrl+Shift+F) and timed sprints are listed here.' }),
      ]);
    }

    r.on('saved', WB.debounce(() => { if (!box.hidden) load(); }, 2500));
    return { show, hide, destroy() { } };
  };
})();
