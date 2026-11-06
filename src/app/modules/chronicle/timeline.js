/* Chronicle timeline: a zoomable, pannable axis on the world calendar (millennia down to hours), lanes by type, tag or
   parent, spans as bars and moments as diamonds, lifespans, eras and named periods, the world's "now", drag to re-date
   (snapping to each date's precision), double-click to add an event, filters, and an overview strip. */
(function () {
  'use strict';
  const GK = window.GK, WB = window.WB, h = GK.h, ui = GK.ui, CH = WB.chronicle, S = window.WBChronScale;

  const MIN_SCALE = 2e-7, MAX_SCALE = 9000;            // px per day: ~ a million years … ~6 px per minute
  const DIA = 13, GAP = 10;                             // diamond size, gap between packed items (px)
  const PRESETS = [                                     // [id, label, visible span in days]
    ['mil', 'Millennia', C => C.avgYear * 3000], ['cen', 'Centuries', C => C.avgYear * 300], ['dec', 'Decades', C => C.avgYear * 30],
    ['yr', 'Years', C => C.avgYear * 4], ['mo', 'Months', C => C.avgMonth * 5], ['day', 'Days', C => 12], ['hr', 'Hours', C => .75],
  ];
  const isPeriodTag = id => { const t = WB.tag(id); return !!t && /^(period|era|age)s?$/i.test(t.name); };

  CH.views.timeline = { mount };

  async function mount(host, env) {
    const st = env.state.tl, C = WB.cal;
    let data = await CH.data();
    let sel = env.params.entryId || null;
    const P = { W: 800, headW: 170, rowH: 30, lanes: [], periods: [], items: [], pRows: 0, packScale: null, laneSig: '', dom: [0, 1] };
    let scale = +st.scale || 0, center = +st.center;
    let raf = 0, alive = true, drag = null, hoverT = 0, clickT = 0, cursorX = null;

    /* ---------------- DOM ---------------- */
    const search = WB.ui.search({ placeholder: 'Find on the timeline', value: st.text, onInput: v => { st.text = v; env.save(); rebuild(); } });
    search.classList.add('ch-tl-search');
    const groupSel = ui.select({ value: st.group, options: [['type', 'Lanes by type'], ['tag', 'Lanes by tag'], ['parent', 'Lanes by parent'], ['none', 'One lane']], onChange: v => { st.group = v; env.save(); rebuild(); } });
    groupSel.title = 'How entries are grouped into lanes';
    const lifeChip = ui.chip({ label: '☺ Lifespans', title: 'Show lifespans (birth to death) of characters and other living things — also in Appearance → Worldbuilder', onClick: () => { GK.settings.set('wbLifespans', !lifeOn()); } });
    const periodChip = ui.chip({ label: '◫ Periods', title: 'Show long events (a year or more, or tagged #period) as named periods above the lanes', onClick: () => { st.periods = !st.periods; env.save(); rebuild(); } });
    const filterBtn = ui.button({ label: 'Filter', icon: '⚲', small: true, title: 'Filter by type, tag and audience', onClick: () => filterPop(filterBtn) });
    const presetSeg = h('div.ch-presets.gk-seg.gk-control');
    PRESETS.forEach(([id, label, span]) => presetSeg.appendChild(h('button', { type: 'button', text: label, dataset: { id }, title: 'Zoom to ' + label.toLowerCase(), onclick: () => zoomTo(P.W / span(C)) })));
    const zoomOut = ui.button({ icon: '−', small: true, title: 'Zoom out (−)', onClick: () => zoomBy(1 / 1.6) });
    const zoomIn = ui.button({ icon: '+', small: true, title: 'Zoom in (+)', onClick: () => zoomBy(1.6) });
    const fitBtn = ui.button({ label: 'Fit all', icon: '⤢', small: true, title: 'Show everything (F)', onClick: () => fit() });
    const nowBtn = ui.button({ label: 'Now', icon: '◉', small: true, title: 'Go to the world’s current date (N)', onClick: () => goNow() });
    const bar = h('div.ch-tl-bar', [
      h('div.gk-row.ch-tl-bar-l', [groupSel, lifeChip, periodChip, filterBtn, search]),
      h('div.gk-row.nowrap.ch-tl-bar-r', [ui.group([zoomOut, zoomIn]), fitBtn, nowBtn]),
    ]);

    const corner = h('button.ch-tl-corner', { type: 'button', title: 'Jump to a date', onclick: async () => { const d = await CH.askDate({ title: 'Jump to a date', ok: 'Go', value: S.dateAt(C, center, S.precAt(C, scale) === 'time' ? 'day' : S.precAt(C, scale)) }); if (d) goDay(d.day, d.prec); } });
    const ruler = h('div.ch-ruler');
    const gridL = h('div.ch-tl-grid');
    const lanesEl = h('div.ch-lanes');
    const scroller = h('div.ch-tl-scroll', [lanesEl]);
    const fg = h('div.ch-tl-fg');
    const empty = h('div.ch-tl-empty');
    const stage = h('div.ch-tl-stage', { tabindex: 0, 'aria-label': 'Timeline. Wheel to zoom, drag to pan, double-click to add an event.' }, [gridL, scroller, fg, empty]);
    const miniCanvas = h('canvas.ch-mini-canvas');
    const miniView = h('div.ch-mini-view');
    const mini = h('div.ch-mini', { title: 'Overview — drag the frame or click to jump' }, [miniCanvas, miniView]);
    const hint = h('div.ch-tl-foot', [presetSeg, h('div.ch-tl-hint.gk-tiny.gk-muted', { text: 'Wheel zooms · drag pans · Shift+wheel scrolls lanes · click peeks · double-click opens · double-click empty space adds an event · drag a bar or its ends to re-date' })]);
    const panel = ui.panel({ material: 'solid', cls: 'ch-tl', lens: false, body: [h('div.ch-tl-grid-wrap', [corner, ruler, stage, mini]), hint] });
    panel.setAttribute('data-native-scroll', '');
    const measureBox = h('span.ch-measure', { 'aria-hidden': 'true' });
    lanesEl.appendChild(measureBox);
    host.append(bar, panel);

    /* ---------------- helpers ---------------- */
    const lifeOn = () => GK.settings.get('wbLifespans') !== false;
    const nowT = () => { const n = WB.now; return n.day + (n.min != null ? n.min / C.minutesPerDay : .5); };
    const xOf = t => (t - center) * scale + P.W / 2;
    const tOf = x => center + (x - P.W / 2) / scale;
    const clampScale = s => Math.max(MIN_SCALE, Math.min(MAX_SCALE, s));
    const localX = ev => GK.local(scroller, ev.clientX - scroller.getBoundingClientRect().left) - P.headW;
    const request = () => { if (!raf && alive) raf = requestAnimationFrame(render); };
    const persist = WB.debounce(() => { st.center = center; st.scale = scale; env.save(); }, 400);
    let labelRatio = 0, labelFont = '';
    const ctx2d = document.createElement('canvas').getContext('2d');
    const widths = new Map();
    function labelW(text) {
      if (!labelRatio) {
        const cs = getComputedStyle(measureBox);
        labelFont = cs.fontWeight + ' ' + cs.fontSize + ' ' + cs.fontFamily;
        ctx2d.font = labelFont;
        measureBox.textContent = 'The Saltmarch chronicle 1203';
        const m = ctx2d.measureText(measureBox.textContent).width;
        labelRatio = m ? measureBox.offsetWidth / m : 1;
        widths.clear();
      }
      let w = widths.get(text);
      if (w == null) { w = Math.ceil(ctx2d.measureText(text).width * labelRatio) + 2; widths.set(text, w); }
      return w;
    }

    /* ---------------- the model: which items, which lanes, which periods ---------------- */
    function build() {
      const now = Math.floor(nowT()), life = lifeOn(), q = (st.text || '').trim().toLowerCase();
      const items = [], periods = [];
      for (const e of data.list) {
        if (!WB.visible(e)) continue;
        const t = WB.typeOf(e);
        if (!t) continue;
        if (t.lifespan && !life) continue;
        if (st.types.length && !st.types.includes(e.typeId)) continue;
        if (st.tags.length && !(e.tags || []).some(x => st.tags.includes(x))) continue;
        if (st.audience && e.audience !== st.audience) continue;
        if (q && !(e.title.toLowerCase().includes(q) || (e.summary || '').toLowerCase().includes(q) || (e.aliases || []).some(a => String(a).toLowerCase().includes(q)))) continue;
        const x = CH.extent(e, now);
        const it = Object.assign({ e, t, life: !!t.lifespan, color: WB.colorOf(e), icon: WB.iconOf(e) }, x);
        it.period = !it.life && !it.instant && e.start && e.end && (t.key === 'event' || (e.tags || []).some(isPeriodTag)) && ((e.tags || []).some(isPeriodTag) || x.t1 - x.t0 >= C.avgYear * .98);
        if (it.period && st.periods) periods.push(it); else items.push(it);
      }
      P.items = items; P.periods = periods;
      // lanes
      const lanes = new Map();
      const lane = (key, label, icon, color, order) => { if (!lanes.has(key)) lanes.set(key, { key, label, icon, color, order, items: [] }); return lanes.get(key); };
      for (const it of items) {
        if (st.group === 'type') lane('t:' + it.t.id, it.t.plural, it.t.icon, it.t.color, [0, it.t.sort]).items.push(it);
        else if (st.group === 'tag') {
          const tags = (it.e.tags || []).map(id => WB.tag(id)).filter(Boolean);
          if (!tags.length) lane('t:none', 'No tag', '#', '#9aa5b1', [1, '']).items.push(it);
          for (const tg of tags) lane('g:' + tg.id, '#' + tg.name, '#', tg.color || '#9aa5b1', [0, tg.name.toLowerCase()]).items.push(it);
        } else if (st.group === 'parent') {
          const p = it.e.parentId ? WB.liteOf(it.e.parentId) : null;
          if (!p) lane('p:root', 'Top level', '◇', '#9aa5b1', [0, '']).items.push(it);
          else lane('p:' + p.id, p.title, WB.iconOf(p), WB.colorOf(p), [1, p.title.toLowerCase()]).items.push(it);
        } else lane('all', 'Everything', '✦', '#9aa5b1', [0, 0]).items.push(it);
      }
      const cmp = (a, b) => (a < b ? -1 : a > b ? 1 : 0);
      P.lanes = [...lanes.values()].sort((a, b) => cmp(a.order[0], b.order[0]) || cmp(a.order[1], b.order[1]));
      P.packScale = null;
      // the overview's domain: everything, now, and a little room
      let lo = Infinity, hi = -Infinity;
      for (const it of items.concat(periods)) { if (it.t0 < lo) lo = it.t0; const e1 = Math.max(it.t1, it.fuzz || 0); if (e1 > hi) hi = e1; }
      const n = nowT();
      lo = Math.min(lo, n); hi = Math.max(hi, n);
      if (!isFinite(lo)) { lo = n - C.avgYear * 5; hi = n + C.avgYear * 5; }
      const pad = Math.max((hi - lo) * .04, C.avgMonth);
      P.dom = [lo - pad, hi + pad];
      paintChrome();
    }
    function rebuild() { build(); request(); }

    /** rows per lane at the current zoom: items never overlap their neighbours' labels */
    /** rows are packed for the items near the view (the visible range and as much again on each side), so a lane is
        only as tall as what can be seen around here; panning far enough or zooming packs again */
    function pack() {
      const k = scale, v0 = tOf(0), v1 = tOf(P.W), span = v1 - v0;
      const w0 = v0 - span * .8, w1 = v1 + span * .8;
      P.packLo = v0 - span * .5; P.packHi = v1 + span * .5;
      for (const L of P.lanes) {
        const collapsed = !!st.collapsed[L.key];
        const rows = [];
        L.items.sort((a, b) => a.t0 - b.t0 || b.t1 - a.t1);
        for (const it of L.items) {
          const x0 = it.t0 * k, x1 = it.t1 * k, lw = labelW(it.e.title) + 22;
          let a, b;
          if (it.instant) { a = x0 - DIA / 2; b = x0 + DIA / 2 + (collapsed ? 2 : 6 + lw); if (it.fuzz && (it.fuzz - it.t0) * k > 14) b = Math.max(b, it.fuzz * k); it.outside = false; }
          else { a = x0; const w = Math.max(x1 - x0, 4); it.outside = !collapsed && w < lw + 8; b = a + w + (it.outside ? 6 + lw : 0); }
          it.ext = b - x0;
          if (it.t0 > w1 || it.t0 + it.ext / k < w0) { it.row = -1; continue; }
          let r = 0;
          if (!collapsed) { while (r < rows.length && rows[r] + GAP > a) r++; if (r > 80) r = 80; }
          rows[r] = Math.max(rows[r] || -Infinity, b);
          it.row = r;
        }
        L.rows = Math.max(1, rows.length);
      }
      // periods in up to four rows above the lanes
      const pr = [];
      P.periods.sort((a, b) => a.t0 - b.t0);
      for (const it of P.periods) {
        const a = it.t0 * k, lw = labelW(it.e.title) * .9 + 14;
        it.outside = (it.t1 - it.t0) * k < lw;
        const b = Math.max(it.t1 * k, a + 6) + (it.outside ? lw + 6 : 0);
        if (it.t0 > w1 || it.t1 < w0) { it.row = -1; continue; }
        let r = 0;
        while (r < pr.length && pr[r] + 4 > a && r < 3) r++;
        pr[r] = Math.max(pr[r] || -Infinity, b);
        it.row = r;
      }
      P.pRows = P.periods.length ? Math.min(4, pr.length) : 0;
      P.packScale = k;
    }

    /* ---------------- lanes (structure) ---------------- */
    const laneNodes = new Map();   // lane key → { el, track, pool } (kept across rebuilds so item nodes are reused)
    function laneDom() {
      const sig = P.lanes.map(L => L.key + ':' + L.rows + ':' + (st.collapsed[L.key] ? 1 : 0)).join('|');
      if (sig === P.laneSig && P.lanes.every(L => laneNodes.has(L.key))) { for (const L of P.lanes) Object.assign(L, laneNodes.get(L.key)); return; }
      const keepPools = new Map([...laneNodes].map(([k, v]) => [k, v.pool]));
      laneNodes.clear();
      P.laneSig = sig;
      GK.clear(lanesEl);
      lanesEl.appendChild(measureBox);
      P.lanes.forEach((L, i) => {
        const collapsed = !!st.collapsed[L.key];
        const head = h('button.ch-lane-head', { type: 'button', title: (collapsed ? 'Expand' : 'Collapse') + ' this lane', style: { '--c': L.color }, onclick: () => { st.collapsed[L.key] = !collapsed; env.save(); P.packScale = null; request(); } }, [
          h('span.ch-lane-tw', { text: collapsed ? '▸' : '▾' }), h('span.ch-lane-ico', { text: L.icon }), h('span.ch-lane-name.gk-ellipsis', { text: L.label }), h('span.ch-lane-n', { text: String(L.items.length) }),
        ]);
        const track = h('div.ch-lane-track', { dataset: { lane: L.key } });
        const el = h('div.ch-lane', { class: (i % 2 ? 'odd' : '') + (collapsed ? ' collapsed' : ''), style: { '--rows': String(L.rows) } }, [head, track]);
        L.el = el; L.track = track; L.pool = new Map();
        const old = keepPools.get(L.key);
        if (old) for (const [id, node] of old) { track.appendChild(node); L.pool.set(id, node); }
        laneNodes.set(L.key, { el, track, pool: L.pool });
        lanesEl.appendChild(el);
      });
    }

    /* ---------------- drawing ---------------- */
    function measure() {
      const hw = lanesEl.querySelector('.ch-lane-head');
      P.headW = hw ? hw.offsetWidth : corner.offsetWidth || 170;
      P.W = Math.max(120, scroller.clientWidth - P.headW);
      const probe = lanesEl.querySelector('.ch-lane');
      if (probe) P.rowH = parseFloat(getComputedStyle(probe).getPropertyValue('--row-h-px')) || P.rowH;
    }
    function render() {
      raf = 0;
      if (!alive || !panel.isConnected) return;
      if (!scale) { fit(true); }
      measure();
      if (P.packScale !== scale || tOf(0) < P.packLo || tOf(P.W) > P.packHi) pack();
      laneDom();
      measure();
      drawRuler();
      drawItems();
      drawFg();
      drawMini();
      readout();
      persist();
    }

    function drawRuler() {
      const t0 = tOf(-40), t1 = tOf(P.W + 60);
      const k = S.ticks(C, t0, t1, scale);
      P.unit = k.unit;
      GK.clear(ruler); GK.clear(gridL);
      gridL.style.width = P.W + 'px';
      // eras: a band across the top of the ruler and a faint wash over the lanes
      k.eras.forEach(er => {
        const a = Math.max(-2, xOf(er.t0)), b = Math.min(P.W + 60, xOf(er.t1));
        if (b - a < 1) return;
        const cls = er.index < 0 ? 'before' : er.index % 2 ? 'odd' : 'even';
        const name = er.name + (er.abbr ? ' (' + er.abbr + ')' : '');
        ruler.appendChild(h('div.ch-era', { class: cls, style: { left: a + 'px', width: (b - a) + 'px' }, title: name }, [h('span.ch-era-lbl', { text: b - a > 60 ? name : er.abbr || '' })]));
        if (er.index % 2 === 1 || er.index < 0) gridL.appendChild(h('div.ch-era-wash', { class: cls, style: { left: Math.max(0, a) + 'px', width: Math.max(0, Math.min(P.W, b) - Math.max(0, a)) + 'px' } }));
        if (isFinite(er.t0) && xOf(er.t0) > -1 && xOf(er.t0) < P.W) gridL.appendChild(h('div.ch-gl.era', { style: { left: xOf(er.t0) + 'px' } }));
      });
      for (const m of k.major) {
        const x = xOf(m.t);
        if (x < -300 || x > P.W + 60) continue;
        ruler.appendChild(h('div.ch-tick.major', { class: m.era ? 'era' : '', style: { left: x + 'px' } }, [h('span', { text: m.label })]));
        if (x >= 0 && x <= P.W) gridL.appendChild(h('div.ch-gl.major', { style: { left: x + 'px' } }));
      }
      // keep the current major label readable at the left edge
      const prev = k.major.filter(m => xOf(m.t) < 4).pop(), next = k.major.find(m => xOf(m.t) >= 4);
      if (prev) {
        const room = next ? xOf(next.t) - 8 : P.W;
        if (room > 40) ruler.appendChild(h('div.ch-tick.major.pinned', { style: { left: '0px' } }, [h('span', { text: prev.label, style: { maxWidth: room + 'px' } })]));
      }
      for (const m of k.minor) {
        const x = xOf(m.t);
        if (x < -40 || x > P.W + 60) continue;
        ruler.appendChild(h('div.ch-tick.minor', { style: { left: x + 'px' } }, [h('span', { text: m.label })]));
        if (x >= 0 && x <= P.W) gridL.appendChild(h('div.ch-gl', { style: { left: x + 'px' } }));
      }
      // named periods under the ticks
      ruler.style.setProperty('--prows', String(P.pRows));
      for (const it of P.periods) {
        const a = xOf(it.t0), b = xOf(it.t1);
        if (it.row < 0 || b < -2 || a > P.W + 2) continue;
        const l = Math.max(-2, a), r = Math.min(P.W + 2, b);
        const el = h('div.ch-period', { class: (it.outside ? 'outside ' : '') + (sel === it.e.id ? 'sel' : '') + (a < -2 ? ' cut-l' : '') + (b > P.W + 2 ? ' cut-r' : ''), dataset: { id: it.e.id }, style: { left: l + 'px', width: Math.max(4, r - l) + 'px', '--c': it.color, '--prow': String(it.row) } }, [h('span.ch-period-lbl', { text: it.e.title })]);
        wireItem(el, it);
        ruler.appendChild(el);
        gridL.appendChild(h('div.ch-period-wash', { style: { left: Math.max(0, a) + 'px', width: Math.max(0, Math.min(P.W, b) - Math.max(0, a)) + 'px', '--c': it.color } }));
      }
      // now flag
      const nx = xOf(nowT());
      if (nx >= -20 && nx <= P.W + 20) ruler.appendChild(h('div.ch-now-flag', { style: { left: nx + 'px' }, title: 'Now: ' + WB.fmt.date(WB.now, 'full') }, [h('span', { text: 'Now' })]));
      // which preset is closest
      const spanDays = P.W / scale;
      let best = null, bd = Infinity;
      for (const [id, , sp] of PRESETS) { const d = Math.abs(Math.log(sp(C) / spanDays)); if (d < bd) { bd = d; best = id; } }
      presetSeg.querySelectorAll('button').forEach(b => b.classList.toggle('on', b.dataset.id === best && bd < .55));
    }

    function drawItems() {
      for (const L of P.lanes) {
        const collapsed = !!st.collapsed[L.key];
        const seen = new Set();
        for (const it of L.items) {
          const a = xOf(it.t0), b = xOf(it.t1);
          if (it.row < 0 || a + it.ext < -30 || a - DIA > P.W + 30) continue;
          const id = it.e.id;
          seen.add(id);
          let el = L.pool.get(id);
          if (!el) { el = itemEl(it); L.pool.set(id, el); L.track.appendChild(el); }
          el.className = 'ch-it ' + (it.instant ? 'pt' : 'bar') + (it.life ? ' life' : '') + (it.open ? ' open' : '') + (it.outside ? ' outside' : '') + (collapsed ? ' mini' : '') + (sel === id ? ' sel' : '') + (it.endOnly ? ' endonly' : '') + (it.e.audience === 'private' ? ' private' : '');
          el.style.top = 'calc(' + it.row + ' * var(--row-h) + var(--lane-pad))';
          if (it.instant) {
            el.style.left = a + 'px'; el.style.width = '';
            const fz = el.querySelector('.ch-fuzz');
            if (it.fuzz && !collapsed && (it.fuzz - it.t0) * scale > 14) { fz.hidden = false; fz.style.width = Math.min((it.fuzz - it.t0) * scale, P.W + 100) + 'px'; } else fz.hidden = true;
          } else {
            const l = Math.max(-4, a), r = Math.min(P.W + 4, Math.max(b, a + 4));
            el.style.left = l + 'px'; el.style.width = Math.max(4, r - l) + 'px';
            el.classList.toggle('cut-l', a < -4); el.classList.toggle('cut-r', b > P.W + 4);
          }
        }
        for (const [id, node] of L.pool) if (!seen.has(id)) { node.remove(); L.pool.delete(id); }
      }
      const shown = P.items.length + P.periods.length;
      if (!data.list.length) showEmpty('nothing');
      else if (!shown) showEmpty('filtered');
      else empty.hidden = true;
    }
    function itemEl(it) {
      const e = it.e;
      const el = h('div.ch-it', { dataset: { id: e.id }, style: { '--c': it.color }, role: 'button', tabindex: -1 }, [
        it.instant ? h('span.ch-fuzz', { hidden: true }) : null,
        h('span.ch-it-mark'),
        h('span.ch-it-ico', { text: it.icon }),
        h('span.ch-it-lbl', { text: e.title }),
        !it.instant && CH.canEdit() && !it.open ? h('span.ch-grip.l', { title: 'Drag to change the start' }) : null,
        !it.instant && CH.canEdit() && !it.open ? h('span.ch-grip.r', { title: 'Drag to change the end' }) : null,
      ]);
      wireItem(el, it);
      return el;
    }
    function wireItem(el, it) {
      el.addEventListener('pointerenter', () => {
        if (drag || !GK.settings.get('wbHoverCards')) return;
        clearTimeout(hoverT);
        hoverT = setTimeout(() => { if (!drag && el.isConnected && el.matches(':hover')) WB.ui.hoverCard(it.e.id, el); }, 450);
      });
      el.addEventListener('pointerleave', () => { clearTimeout(hoverT); setTimeout(closeHover, 160); });
      el.addEventListener('contextmenu', ev => { ev.preventDefault(); ev.stopPropagation(); itemMenu(it, ev); });
    }
    const closeHover = (force) => { const c = document.querySelector('.wb-pop[data-group="hover"]'); if (c && (force === true || !c.matches(':hover'))) c._close && c._close(); };

    function drawFg() {
      GK.clear(fg);
      fg.style.width = P.W + 'px';
      const nx = xOf(nowT());
      if (nx >= -2 && nx <= P.W + 2) fg.appendChild(h('div.ch-nowline', { style: { left: nx + 'px' } }));
      if (cursorX != null && !drag) fg.appendChild(h('div.ch-cursor', { style: { left: cursorX + 'px' } }));
      if (drag && drag.moved) {
        const s = drag.now;
        fg.appendChild(h('div.ch-drag-tip', { style: { left: Math.max(4, Math.min(P.W - 220, drag.tipX)) + 'px', top: drag.tipY + 'px' } }, [
          h('b', { text: s.end ? WB.fmt.range(s.start, s.end) : WB.fmt.date(s.start || s.end) }),
          h('div.gk-tiny.gk-muted', { text: drag.mode === 'move' ? 'Moving · snaps to the ' + unitWord(drag.unit) : drag.mode === 'start' ? 'New start' : 'New end' }),
        ]));
      }
    }
    const unitWord = u => ({ year: 'year', month: 'month', day: 'day', time: 'quarter hour' })[u] || u;

    function readout() {
      const t = cursorX != null ? tOf(cursorX) : center;
      const prec = { hour: 'time', day: 'day', month: 'day', year: 'month' }[P.unit] || 'year';
      const d = S.dateAt(C, t, prec);
      corner.replaceChildren(
        h('div.ch-corner-date', { text: WB.fmt.date(d) }),
        h('div.gk-tiny.gk-muted', { text: (cursorX != null ? 'under the pointer' : 'centre') + ' · ' + CH.dur(0, Math.round(P.W / scale) || 1) + ' across' }),
      );
    }

    /* ---------------- overview strip ---------------- */
    function drawMini() {
      mini.hidden = !st.mini;
      if (!st.mini) return;
      const w = mini.clientWidth, hgt = mini.clientHeight;
      if (!w || !hgt) return;
      const z = GK.zoomOf(mini), dpr = devicePixelRatio || 1;
      const cw = Math.round(w * z * dpr), chh = Math.round(hgt * z * dpr);
      if (miniCanvas.width !== cw || miniCanvas.height !== chh) { miniCanvas.width = cw; miniCanvas.height = chh; }
      const g = miniCanvas.getContext('2d');
      g.setTransform(cw / w, 0, 0, chh / hgt, 0, 0);
      g.clearRect(0, 0, w, hgt);
      const [d0, d1] = P.dom, k = w / (d1 - d0), X = t => (t - d0) * k;
      const css = getComputedStyle(panel);
      const ink = css.getPropertyValue('--text').trim() || '#888';
      // eras
      S.erasIn(C, d0, d1).forEach(er => { if (er.index % 2 === 1 || er.index < 0) { g.fillStyle = ink; g.globalAlpha = .05; const a = Math.max(0, X(er.t0)), b = Math.min(w, X(er.t1)); g.fillRect(a, 0, b - a, hgt); } });
      g.globalAlpha = 1;
      const all = P.items, lanesN = Math.max(1, P.lanes.length);
      const laneIdx = new Map(); P.lanes.forEach((L, i) => L.items.forEach(it => laneIdx.set(it, i)));
      for (const it of P.periods) { g.fillStyle = it.color; g.globalAlpha = .35; g.fillRect(X(it.t0), 1, Math.max(1.5, (it.t1 - it.t0) * k), 3); }
      for (const it of all) {
        const y = 6 + ((laneIdx.get(it) || 0) + .5) / lanesN * (hgt - 9);
        g.fillStyle = it.color; g.globalAlpha = it.life ? .45 : .9;
        if (it.instant) g.fillRect(X(it.t0) - .75, y - 1.5, 1.5, 3);
        else g.fillRect(X(it.t0), y - 1, Math.max(1.5, (it.t1 - it.t0) * k), 2);
      }
      g.globalAlpha = 1;
      const nowc = css.getPropertyValue('--now').trim() || '#e05';
      g.fillStyle = nowc; g.fillRect(X(nowT()) - .5, 0, 1.5, hgt);
      const a = X(tOf(0)), b = X(tOf(P.W));
      const l = Math.max(0, Math.min(w - 6, a)), r = Math.max(l + 6, Math.min(w, b));
      miniView.style.left = l + 'px'; miniView.style.width = (r - l) + 'px';
      miniView.classList.toggle('tiny', r - l <= 7);
    }

    /* ---------------- view changes ---------------- */
    function zoomAt(x, f) {
      const t = tOf(x);
      scale = clampScale(scale * f);
      center = t - (x - P.W / 2) / scale;
      request();
    }
    const zoomBy = f => zoomAt(P.W / 2, f);
    const zoomTo = s => { scale = clampScale(s); request(); };
    function fit(quiet) {
      let lo = Infinity, hi = -Infinity;
      for (const it of P.items.concat(P.periods)) { lo = Math.min(lo, it.t0); hi = Math.max(hi, it.t1, it.fuzz || -Infinity); }
      if (!isFinite(lo)) { const n = nowT(); lo = n - C.avgYear * 2; hi = n + C.avgYear * 2; }
      if (hi - lo < 1) { lo -= 2; hi += 2; }
      measure();
      // room on the right for the labels of the last items
      const right = Math.min(P.W * .28, 190), left = Math.min(P.W * .04, 24);
      scale = clampScale((P.W - right - left) / (hi - lo));
      center = lo + (P.W / 2 - left) / scale;
      if (!quiet) request();
    }
    function goNow() {
      center = nowT();
      if (P.W / scale > C.avgYear * 40) scale = clampScale(P.W / (C.avgYear * 4));
      request();
    }
    function focusOn(it) {
      const span = Math.max(it.t1 - it.t0, it.fuzz ? it.fuzz - it.t0 : 0);
      center = it.t0 + span / 2;
      scale = clampScale(span > 0 ? P.W * .6 / span : Math.max(scale, P.W / (C.avgYear * 4)));
      request();
    }
    function goDay(day, prec, spanDays) {
      center = day + .5;
      const span = spanDays ? spanDays * 1.08 : prec === 'year' ? C.avgYear * 12 : prec === 'month' ? C.avgYear * 1.5 : prec === 'time' ? 2 : C.avgMonth * 2;
      scale = clampScale(P.W / span);
      request();
    }

    /* ---------------- pointer: pan, drag to re-date, click, double-click ---------------- */
    const itemAt = target => { const el = target.closest && target.closest('.ch-it, .ch-period'); if (!el) return null; const id = el.dataset.id; return { el, it: P.items.find(x => x.e.id === id) || P.periods.find(x => x.e.id === id) }; };
    const unitOf = d => (d ? (d.prec === 'time' ? 'time' : d.prec) : 'day');

    function onDown(ev) {
      if (ev.button !== 0) return;
      if (ev.target.closest('.ch-lane-head, .ch-mini, button, input, select')) return;
      closeHover(true);
      const hit = itemAt(ev.target);
      const x = localX(ev), y = ev.clientY;
      stage.focus({ preventScroll: true });
      if (hit && hit.it) {
        const it = hit.it, e = it.e;
        let mode = 'move';
        const grip = ev.target.closest('.ch-grip');
        if (grip) mode = grip.classList.contains('l') ? 'start' : 'end';
        const editable = CH.canEdit() && !(it.open && mode !== 'move') && hit.el.classList.contains('ch-it');
        drag = { kind: 'item', it, el: hit.el, mode, sx: ev.clientX, sy: y, x0: x, editable, moved: false, unit: mode === 'end' ? unitOf(e.end) : unitOf(e.start || e.end), orig: { start: e.start, end: e.end }, now: { start: e.start, end: e.end } };
      } else drag = { kind: 'pan', sx: ev.clientX, sy: y, c0: center, top0: scroller.scrollTop, moved: false, x0: x };
      try { stage.setPointerCapture(ev.pointerId); } catch { }
    }
    function onMove(ev) {
      if (!drag) {
        const r = scroller.getBoundingClientRect();
        if (ev.clientX >= r.left && ev.clientX <= r.right) { const x = localX(ev); cursorX = x >= 0 && x <= P.W ? x : null; } else cursorX = null;
        if (!raf) { drawFg(); readout(); }
        return;
      }
      const dxs = ev.clientX - drag.sx, dys = ev.clientY - drag.sy;
      if (!drag.moved && Math.hypot(dxs, dys) < 4) return;
      if (!drag.moved) { drag.moved = true; closeHover(true); clearTimeout(hoverT); stage.classList.add(drag.kind === 'pan' ? 'panning' : 'dragging'); }
      const dx = GK.local(scroller, dxs);
      if (drag.kind === 'pan') {
        center = drag.c0 - dx / scale;
        scroller.scrollTop = drag.top0 - GK.local(scroller, dys);
        cursorX = null;
        request();
        return;
      }
      if (!drag.editable) return;
      const e = drag.it.e, o = drag.orig, dt = dx / scale;
      let start = o.start, end = o.end;
      if (drag.mode === 'move') {
        const base = o.start || o.end, u = unitOf(base);
        if (u === 'time') {
          const step = Math.max(1, Math.round(C.cal.minutesPerHour / 4)), mins = Math.round(dt * C.minutesPerDay / step) * step;
          start = o.start && S.moveDate(C, o.start, mins, 'time');
          const shift = start ? start.day - o.start.day : 0;
          end = o.end && (o.end.prec === 'time' ? S.moveDate(C, o.end, mins, 'time') : Object.assign({}, o.end, { day: o.end.day + shift }));
          if (!o.start) end = S.moveDate(C, o.end, mins, 'time');
        } else {
          const per = u === 'year' ? C.avgYear : u === 'month' ? C.avgMonth : 1;
          const n = Math.round(dt / per);
          start = o.start && S.moveDate(C, o.start, n, u);
          end = o.end && S.moveDate(C, o.end, n, u);
        }
      } else if (drag.mode === 'start') {
        const u = unitOf(o.start), t = S.snap(C, S.startOf(C, o.start) + dt, u === 'time' ? 'hour' : u);
        start = u === 'time' ? S.dateAt(C, S.startOf(C, o.start) + dt, 'time') : S.dateAt(C, t, o.start.prec);
        if (o.end && start.day > o.end.day) start = Object.assign({}, start, { day: o.end.day });
      } else {
        const u = unitOf(o.end), t1 = S.endOf(C, o.end) + dt;
        if (u === 'time') end = S.dateAt(C, t1, 'time');
        else { const b = S.snap(C, t1, u); end = S.dateAt(C, b - .5, o.end.prec); }
        if (o.start && end.day < o.start.day) end = Object.assign({}, end, { day: o.start.day });
      }
      drag.now = { start, end };
      // preview in place
      const ext = CH.extent(Object.assign({}, e, { start, end }), Math.floor(nowT()));
      const a = xOf(ext.t0), b = xOf(ext.t1);
      if (drag.it.instant) drag.el.style.left = a + 'px';
      else { const l = Math.max(-4, a), r = Math.min(P.W + 4, Math.max(b, a + 4)); drag.el.style.left = l + 'px'; drag.el.style.width = (r - l) + 'px'; }
      const er = drag.el.getBoundingClientRect(), fr = fg.getBoundingClientRect();
      drag.tipX = GK.local(fg, er.left - fr.left);
      drag.tipY = GK.local(fg, er.top - fr.top) - 46;
      if (drag.tipY < 2) drag.tipY = GK.local(fg, er.bottom - fr.top) + 6;
      drawFg();
    }
    async function onUp(ev) {
      if (!drag) return;
      const d = drag;
      drag = null;
      stage.classList.remove('panning', 'dragging');
      try { stage.releasePointerCapture(ev.pointerId); } catch { }
      if (d.kind === 'pan') {
        if (!d.moved) { if (sel) { sel = null; request(); } }
        return;
      }
      if (!d.moved) {
        const id = d.it.e.id;
        sel = id; request();
        clearTimeout(clickT);
        if (ev.ctrlKey || ev.metaKey) { WB.peek(id); return; }
        clickT = setTimeout(() => WB.peek(id), 230);
        return;
      }
      const e = d.it.e, o = d.orig, n = d.now;
      const same = (a, b) => (!a && !b) || (a && b && a.day === b.day && (a.min || 0) === (b.min || 0));
      if (!d.editable || (same(o.start, n.start) && same(o.end, n.end))) { request(); return; }
      // optimistic: the item moves now, the database follows
      e.start = n.start; e.end = n.end;
      rebuild();
      try {
        await WB.api('entries.update', e.id, { start: n.start || null, end: n.end || null });
        WB.ui.undoToast('“' + e.title + '” now ' + (n.start && n.end ? WB.fmt.range(n.start, n.end) : WB.fmt.date(n.start || n.end)), () => WB.api('entries.update', e.id, { start: o.start || null, end: o.end || null }));
      } catch (err) { e.start = o.start; e.end = o.end; rebuild(); WB.fail(err); }
    }
    function onDbl(ev) {
      if (ev.target.closest('.ch-lane-head, .ch-mini')) return;
      const hit = itemAt(ev.target);
      clearTimeout(clickT);
      if (hit && hit.it) { WB.closePeek(); WB.open(hit.it.e.id); return; }
      if (!CH.canEdit()) return;
      const x = localX(ev);
      if (x < 0 || x > P.W) return;
      const prec = S.precAt(C, scale), date = S.dateAt(C, tOf(x), prec);
      const laneEl = ev.target.closest('.ch-lane-track');
      let type = 'event';
      if (laneEl && st.group === 'type') { const t = WB.types.get(laneEl.dataset.lane.slice(2)); if (t && t.dated) type = t.key; }
      CH.createAt(date, { type });
    }
    function onWheel(ev) {
      if (ev.target.closest('.ch-mini')) return;
      ev.preventDefault();
      closeHover(true);
      if (ev.shiftKey) { scroller.scrollTop += ev.deltaY; return; }
      if (Math.abs(ev.deltaX) > Math.abs(ev.deltaY)) { center += GK.local(scroller, ev.deltaX) / scale; request(); return; }
      const r = scroller.getBoundingClientRect();
      const x = Math.max(0, Math.min(P.W, GK.local(scroller, ev.clientX - r.left) - P.headW));
      const step = ev.deltaMode === 1 ? ev.deltaY * 33 : ev.deltaY;
      zoomAt(x, Math.exp(-step * .0016));
    }
    function onKey(ev) {
      if (ev.target.closest('input, textarea, select')) return;
      const k = ev.key;
      if (k === '+' || k === '=') zoomBy(1.4);
      else if (k === '-' || k === '_') zoomBy(1 / 1.4);
      else if (k === 'ArrowLeft' || k === 'ArrowRight') { center += (k === 'ArrowLeft' ? -1 : 1) * (P.W * (ev.shiftKey ? .5 : .12)) / scale; request(); }
      else if (k === 'ArrowUp' || k === 'ArrowDown') { scroller.scrollTop += (k === 'ArrowUp' ? -1 : 1) * P.rowH * 2; }
      else if (k === 'Home' || k === 'f' || k === 'F') fit();
      else if (k === 'n' || k === 'N') goNow();
      else if (k === 'Escape') { if (drag) { const d = drag; drag = null; if (d.kind === 'item') request(); } else if (sel) { sel = null; request(); } else return; }
      else if (k === 'Enter' && sel) WB.open(sel);
      else if (k === ' ' && sel) WB.peek(sel);
      else return;
      ev.preventDefault();
    }
    function onCtx(ev) {
      if (ev.target.closest('.ch-it, .ch-period, .ch-lane-head')) return;
      ev.preventDefault();
      const x = localX(ev);
      if (x < 0 || x > P.W) return;
      const prec = S.precAt(C, scale), date = S.dateAt(C, tOf(x), prec);
      WB.ui.menu([
        { header: WB.fmt.date(date) },
        CH.canEdit() ? { label: 'New event here', icon: '✷', onClick: () => CH.createAt(date, { type: 'event' }) } : null,
        CH.canEdit() ? { label: 'New entry here…', icon: '＋', onClick: () => CH.createAt(date, { type: 'character' }) } : null,
        { label: 'Zoom in here', icon: '+', onClick: () => zoomAt(x, 3) },
        { label: 'Open this month in the calendar', icon: '▦', onClick: () => env.go('calendar', { day: date.day }) },
        { label: 'Who was alive then?', icon: '⌛', onClick: () => env.go('ages', { day: date.day }) },
        CH.canEdit() ? '-' : null,
        CH.canEdit() ? { label: 'Make this the world’s date', icon: '◉', hint: 'Moves "now" here (you can undo)', onClick: async () => { const from = WB.now; await WB.api('worlds.update', WB.worldId, { now: { day: date.day, min: date.min, prec: date.prec === 'time' ? 'time' : 'day' } }); await WB.reloadWorld(); WB.ui.undoToast('The world date is now ' + WB.fmt.date(date), async () => { await WB.api('worlds.update', WB.worldId, { now: from }); await WB.reloadWorld(); }); } } : null,
      ], ev);
    }
    function itemMenu(it, ev) {
      const e = it.e;
      const periodTag = (e.tags || []).find(isPeriodTag);
      const extra = [
        '-',
        { label: 'Zoom to it', icon: '⤢', onClick: () => focusOn(it) },
        { label: 'History of “' + e.title + '”', icon: '⧉', onClick: () => env.go('annals', { entryId: e.id }) },
        { label: 'Who was alive then?', icon: '⌛', onClick: () => env.go('ages', { day: (e.start || e.end).day }) },
        CH.canEdit() && e.start && e.end && !it.life ? { label: periodTag ? 'Show as an ordinary bar' : 'Show as a named period', icon: '◫', onClick: async () => {
          if (periodTag) { await WB.api('entries.setTags', e.id, (e.tags || []).filter(x => x !== periodTag)); } else await WB.api('entries.addTag', e.id, 'period');
        } } : null,
      ];
      WB.ui.entryMenu(e, ev, extra.filter(Boolean));
    }

    /* ---------------- overview strip interaction ---------------- */
    let miniDrag = null;
    mini.addEventListener('pointerdown', ev => {
      if (ev.button !== 0) return;
      const r = mini.getBoundingClientRect(), w = mini.clientWidth, x = GK.local(mini, ev.clientX - r.left);
      const [d0, d1] = P.dom, t = d0 + x / w * (d1 - d0);
      if (!ev.target.closest('.ch-mini-view')) { center = t; request(); }
      miniDrag = { sx: ev.clientX, c0: center, k: (d1 - d0) / w };
      try { mini.setPointerCapture(ev.pointerId); } catch { }
      ev.preventDefault();
    });
    mini.addEventListener('pointermove', ev => { if (!miniDrag) return; center = miniDrag.c0 + GK.local(mini, ev.clientX - miniDrag.sx) * miniDrag.k; request(); });
    mini.addEventListener('pointerup', ev => { miniDrag = null; try { mini.releasePointerCapture(ev.pointerId); } catch { } });
    mini.addEventListener('wheel', ev => { ev.preventDefault(); zoomBy(Math.exp(-ev.deltaY * .0016)); }, { passive: false });

    stage.addEventListener('pointerdown', onDown);
    stage.addEventListener('pointermove', onMove);
    stage.addEventListener('pointerup', onUp);
    stage.addEventListener('pointercancel', onUp);
    stage.addEventListener('pointerleave', () => { if (!drag) { cursorX = null; drawFg(); readout(); } });
    stage.addEventListener('dblclick', onDbl);
    stage.addEventListener('wheel', onWheel, { passive: false });
    stage.addEventListener('keydown', onKey);
    stage.addEventListener('contextmenu', onCtx);
    ruler.addEventListener('wheel', onWheel, { passive: false });
    ruler.addEventListener('pointerdown', ev => { if (!ev.target.closest('.ch-period')) { onDown(ev); } else { const hit = itemAt(ev.target); if (hit && hit.it) { sel = hit.it.e.id; request(); clearTimeout(clickT); clickT = setTimeout(() => WB.peek(hit.it.e.id), 230); } } });
    ruler.addEventListener('pointermove', ev => { if (drag) onMove(ev); });
    ruler.addEventListener('pointerup', onUp);
    ruler.addEventListener('dblclick', ev => { const hit = itemAt(ev.target); if (hit && hit.it) { clearTimeout(clickT); focusOn(hit.it); } });
    WB.dnd.accept(stage, async (id, ev) => {
      if (!CH.canEdit()) return;
      const x = localX(ev);
      if (x < 0 || x > P.W) return;
      const e = await WB.api('entries.lite', id);
      const date = S.dateAt(C, tOf(x), S.precAt(C, scale));
      const field = e.start ? 'end' : 'start';
      if (e.start && e.end) return ui.toast('“' + e.title + '” already has dates — drag it on the timeline to move it', 'ℹ');
      await WB.api('entries.update', id, { [field]: date });
      WB.ui.undoToast('“' + e.title + '” dated ' + WB.fmt.date(date), () => WB.api('entries.update', id, { [field]: null }));
    });

    /* ---------------- filter popover and chrome state ---------------- */
    function paintChrome() {
      lifeChip.classList.toggle('on', lifeOn());
      periodChip.classList.toggle('on', !!st.periods);
      const n = st.types.length + st.tags.length + (st.audience ? 1 : 0);
      filterBtn.replaceChildren(h('span', { text: '⚲' }), n ? 'Filter · ' + n : 'Filter');
      filterBtn.classList.toggle('on', n > 0);
    }
    function filterPop(anchor) {
      const types = WB.typeList().filter(t => data.list.some(e => e.typeId === t.id));
      const tags = WB.tags.filter(t => data.list.some(e => (e.tags || []).includes(t.id)));
      const body = h('div.ch-filter');
      const paint = () => {
        GK.clear(body);
        GK.append(body, [
          h('div.ch-filter-h', { text: 'Types' }),
          CH.typeChips(types, st.types, v => { st.types = v; env.save(); rebuild(); }),
          tags.length ? h('div.ch-filter-h', { text: 'Tags' }) : null,
          tags.length ? h('div.wb-chips', tags.map(t => { const c = ui.chip({ label: '#' + t.name, on: st.tags.includes(t.id), onClick: () => { st.tags = st.tags.includes(t.id) ? st.tags.filter(x => x !== t.id) : st.tags.concat(t.id); env.save(); rebuild(); paint(); } }); return c; })) : null,
          h('div.ch-filter-h', { text: 'Audience' }),
          ui.segmented({ value: st.audience || '', options: [['', 'Everyone'], ['private', 'Private'], ['shared', 'Shared'], ['public', 'Public']], onChange: v => { st.audience = v; env.save(); rebuild(); } }),
          h('div.gk-row.ch-filter-foot', [
            ui.field({ label: 'Overview strip', inline: true, control: ui.toggle({ value: st.mini, onChange: v => { st.mini = v; env.save(); request(); } }) }),
            h('span.gk-grow'),
            ui.button({ label: 'Clear filters', small: true, kind: 'ghost', onClick: () => { st.types = []; st.tags = []; st.audience = ''; st.text = ''; search.querySelector('input').value = ''; env.save(); rebuild(); paint(); } }),
          ]),
        ]);
      };
      paint();
      WB.ui.popover(anchor, body, { cls: 'ch-filter-pop', group: 'ch-filter', width: '26em' });
    }
    function showEmpty(kind) {
      empty.hidden = false;
      if (empty.dataset.kind === kind) return;
      empty.dataset.kind = kind;
      empty.replaceChildren(kind === 'nothing'
        ? WB.ui.empty({ icon: '⟷', title: 'Nothing is dated yet', text: 'Give entries a date — when someone was born, a city founded, a war began — and they appear here on the world’s own calendar. Double-click anywhere on the line to add an event.',
          actions: CH.canEdit() ? [ui.button({ label: 'New event today', kind: 'primary', icon: '✷', onClick: () => CH.createAt({ day: WB.now.day, min: null, prec: 'day' }, { type: 'event' }) })] : [] })
        : WB.ui.empty({ icon: '⚲', title: 'Nothing matches', text: 'The filters hide everything on the timeline.', actions: [ui.button({ label: 'Clear filters', onClick: () => { st.types = []; st.tags = []; st.audience = ''; st.text = ''; search.querySelector('input').value = ''; env.save(); rebuild(); } })] }));
    }

    /* ---------------- life cycle ---------------- */
    const ro = new ResizeObserver(() => request());
    ro.observe(scroller);
    const offs = [
      GK.bus.on('layout', () => { labelRatio = 0; P.packScale = null; request(); }),
      GK.bus.on('applied', () => { labelRatio = 0; P.packScale = null; rebuild(); }),
    ];
    build();
    measure();
    if (env.params.fit || !scale || !isFinite(center)) fit(true);
    if (env.params.day != null) goDay(+env.params.day, env.params.prec, +env.params.spanDays || 0);
    if (env.params.entryId) { const it = P.items.concat(P.periods).find(x => x.e.id === env.params.entryId); if (it) focusOn(it); }
    render();
    return {
      refresh: async () => { data = await CH.data(); if (!alive) return; rebuild(); },
      cleanup: () => { alive = false; cancelAnimationFrame(raf); ro.disconnect(); offs.forEach(f => f()); clearTimeout(hoverT); clearTimeout(clickT); persist.flush(); },
    };
  }
})();
