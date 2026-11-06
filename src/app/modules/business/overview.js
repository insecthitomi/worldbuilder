/* Business → Overview: stat tiles, revenue by month (SVG), goal, recurring revenue, products, channels, recent sales. */
(function () {
  'use strict';
  const { h, ui } = GK, U = WB.ui, B = WB.biz;
  const SVG = 'http://www.w3.org/2000/svg';
  const s = (tag, attrs, kids) => { const el = document.createElementNS(SVG, tag); for (const [k, v] of Object.entries(attrs || {})) if (v != null) el.setAttribute(k, v); for (const c of [].concat(kids || [])) if (c) el.appendChild(c); return el; };

  /** a tile with an optional change against the period before */
  function tile({ label, value, note, icon, delta, good = true, onClick, title }) {
    const t = U.stat({ label, value, note, icon, onClick });
    if (title) t.title = title;
    if (delta != null && Number.isFinite(delta)) {
      const up = delta >= 0, tone = (up === good) ? 'good' : 'bad';
      t.appendChild(h('div.bz-delta', { class: Math.abs(delta) < .005 ? 'flat' : tone, title: 'Compared with the period before' }, [h('span', { text: Math.abs(delta) < .005 ? '＝' : up ? '▲' : '▼' }), ' ' + (Math.abs(delta) < .005 ? 'same as before' : Math.round(Math.abs(delta) * 100) + '%')]));
    }
    return t;
  }
  const change = (now, before) => (before > 0 ? (now - before) / before : now > 0 ? null : null);

  /** nice round top for the axis */
  function niceMax(v) {
    if (v <= 0) return 1000;
    const p = Math.pow(10, Math.floor(Math.log10(v))), n = v / p;
    return (n <= 1 ? 1 : n <= 2 ? 2 : n <= 2.5 ? 2.5 : n <= 5 ? 5 : 10) * p;
  }

  /** revenue by month: net (data colour) with fees stacked on top; hover for the numbers */
  function chart(months, { onPick } = {}) {
    const wrap = h('div.bz-chart', { role: 'img', 'aria-label': 'Revenue by month' });
    const tip = h('div.bz-tip', { hidden: true });
    wrap.appendChild(tip);
    const draw = () => {
      const W = wrap.clientWidth;
      if (!W) return;
      const fs = parseFloat(getComputedStyle(wrap).fontSize) || 14;
      const H = Math.round(fs * 15), padL = Math.round(fs * 3.6), padR = Math.round(fs * .4), padT = Math.round(fs * .9), padB = Math.round(fs * 2.4);
      const plotW = W - padL - padR, plotH = H - padT - padB;
      const max = niceMax(Math.max(1, ...months.map(m => m.net + m.fees)));
      const y = v => padT + plotH - (v / max) * plotH;
      const svg = s('svg', { width: W, height: H, viewBox: '0 0 ' + W + ' ' + H, class: 'bz-svg' });
      // gridlines and axis labels
      for (let i = 0; i <= 4; i++) {
        const v = max * i / 4, yy = Math.round(y(v)) + .5;
        svg.appendChild(s('line', { x1: padL, x2: W - padR, y1: yy, y2: yy, class: i ? 'bz-grid' : 'bz-base' }));
        const tx = s('text', { x: padL - fs * .45, y: yy + fs * .32, class: 'bz-axis', 'text-anchor': 'end' }); tx.textContent = i ? B.compact(v) : '0'; svg.appendChild(tx);
      }
      const band = plotW / months.length, bw = Math.max(3, Math.min(band * .62, fs * 1.7));
      const thisMonth = B.today().slice(0, 7);
      const every = Math.ceil(months.length / Math.max(1, Math.floor(plotW / (fs * 3.2))));
      months.forEach((m, i) => {
        const cx = padL + band * i + band / 2, x = cx - bw / 2;
        const g = s('g', { class: 'bz-col' + (m.month === thisMonth ? ' now' : ''), 'data-month': m.month });
        g.appendChild(s('rect', { x: padL + band * i, y: padT, width: band, height: plotH, class: 'bz-band' }));
        const netH = (m.net / max) * plotH, feeH = (m.fees / max) * plotH, gap = netH > 0 && feeH > 0 ? 2 : 0, r = Math.min(4, bw / 2);
        const top = (yTop, hgt, cls) => {
          if (hgt <= 0) return null;
          const rr = Math.min(r, hgt);
          return s('path', { class: cls, d: `M${x},${yTop + hgt} L${x},${yTop + rr} Q${x},${yTop} ${x + rr},${yTop} L${x + bw - rr},${yTop} Q${x + bw},${yTop} ${x + bw},${yTop + rr} L${x + bw},${yTop + hgt} Z` });
        };
        const put = el => { if (el) g.appendChild(el); };
        if (feeH > 0.5) {
          if (netH > 0.5) put(s('rect', { x, y: y(m.net), width: bw, height: Math.max(0, netH), class: 'bz-bar-net' }));
          put(top(y(m.net + m.fees), Math.max(0, feeH - gap), 'bz-bar-fee'));
        } else put(top(y(m.net), Math.max(0, netH), 'bz-bar-net'));
        if (i % every === 0 || m.month === thisMonth) {
          const lb = s('text', { x: cx, y: H - padB + fs * 1.25, class: 'bz-axis' + (m.month === thisMonth ? ' now' : ''), 'text-anchor': 'middle' });
          lb.textContent = B.monthName(m.month); g.appendChild(lb);
          if (m.month.endsWith('-01') || i === 0) { const yl = s('text', { x: cx, y: H - padB + fs * 2.25, class: 'bz-axis year', 'text-anchor': 'middle' }); yl.textContent = m.month.slice(0, 4); g.appendChild(yl); }
        }
        g.addEventListener('pointerenter', () => {
          GK.clear(tip);
          GK.append(tip, [h('b', { text: B.monthName(m.month, true) }),
            h('div.bz-tip-row', [h('span.bz-key.net'), 'Net', h('b', { text: B.money(m.net) })]),
            h('div.bz-tip-row', [h('span.bz-key.fee'), 'Fees', h('span', { text: B.money(m.fees) })]),
            h('div.bz-tip-row', [h('span.bz-key'), 'Gross', h('span', { text: B.money(m.gross) })]),
            h('div.gk-small.gk-muted', { text: m.count ? WB.fmt.plural(m.count, 'sale') + ' · ' + WB.fmt.plural(m.qty, 'unit') + (m.refunds ? ' · ' + B.money(m.refunds) + ' refunded' : '') : 'No sales' + (m.refunds ? ' · ' + B.money(m.refunds) + ' refunded' : '') }),
            onPick && m.count ? h('div.gk-tiny.gk-faint', { text: 'Click to see these sales' }) : null]);
          tip.hidden = false;
          const tw = tip.offsetWidth;
          tip.style.left = Math.max(0, Math.min(W - tw, cx - tw / 2)) + 'px';
          tip.style.top = Math.max(0, y(m.net + m.fees) - tip.offsetHeight - fs * .6) + 'px';
        });
        g.addEventListener('pointerleave', () => { tip.hidden = true; });
        if (onPick) g.addEventListener('click', () => onPick(m));
        svg.appendChild(g);
      });
      const old = wrap.querySelector('svg');
      if (old) old.replaceWith(svg); else wrap.insertBefore(svg, tip);
    };
    const ro = new ResizeObserver(() => draw());
    ro.observe(wrap);
    const off = GK.bus.on('layout', draw);
    // a window that isn't painting (covered, minimised) runs no resize observers: draw once it is attached anyway
    let tries = 0, timer = 0;
    const attach = () => { if (wrap.isConnected && wrap.clientWidth) { if (!wrap.querySelector('svg')) draw(); } else if (tries++ < 60) timer = setTimeout(attach, 50); };
    timer = setTimeout(attach, 0);
    wrap._cleanup = () => { ro.disconnect(); off(); clearTimeout(timer); };
    return wrap;
  }

  /** a ranked list with a bar per row (products or channels) */
  function ranked(rows, { label, onPick, empty }) {
    const box = h('div.bz-ranked');
    if (!rows.length) { box.appendChild(h('div.gk-small.gk-muted.bz-none', { text: empty })); return box; }
    const max = Math.max(1, ...rows.map(r => r.net)), total = rows.reduce((a, r) => a + r.net, 0) || 1;
    for (const r of rows.slice(0, 8)) {
      box.appendChild(h('div.bz-rank', { class: onPick ? 'pick' : '', title: onPick ? 'See these sales' : '', onclick: e => { if (onPick && !e.target.closest('.wb-chip')) onPick(r); } }, [
        h('div.bz-rank-name', [label(r)]),
        h('div.bz-rank-bar', [h('i', { style: { width: Math.max(1.5, r.net / max * 100) + '%' } })]),
        h('div.bz-rank-val', [h('b', { text: B.money(r.net) }), h('span.gk-tiny.gk-muted', { text: Math.round(r.net / total * 100) + '% · ' + WB.fmt.plural(r.qty, 'unit') })]),
      ]));
    }
    if (rows.length > 8) box.appendChild(h('div.gk-tiny.gk-faint', { text: '+ ' + (rows.length - 8) + ' more' }));
    return box;
  }

  function goalPanel(goal) {
    if (!goal) {
      return ui.panel({ title: 'Goal', icon: '◎', cls: 'bz-goal', body: [
        h('p.gk-small.gk-muted.bz-tight', { text: 'Set a monthly or yearly target — the cover painting, the print run, rent — and watch sales and pledges fill it.' }),
        h('div', [ui.button({ label: 'Set a goal', icon: '◎', small: true, onClick: () => B.editGoal() })]),
      ] });
    }
    const pct = Math.round(goal.fraction * 100), done = goal.fraction >= 1;
    const now = new Date(), left = goal.period === 'year'
      ? Math.ceil((new Date(now.getFullYear() + 1, 0, 1) - now) / 864e5)
      : new Date(now.getFullYear(), now.getMonth() + 1, 0).getDate() - now.getDate() + 1;
    const fs = Math.min(1, goal.sales / goal.cents), fr = Math.min(1 - fs, goal.recurring / goal.cents);
    return ui.panel({ title: goal.period === 'year' ? 'This year’s goal' : 'This month’s goal', icon: '◎', cls: 'bz-goal' + (done ? ' done' : ''),
      actions: [ui.button({ icon: '✎', small: true, kind: 'ghost', title: 'Change the goal', onClick: () => B.editGoal() })],
      body: [
        goal.label ? h('div.bz-goal-label', { text: goal.label }) : null,
        h('div.bz-goal-fig', [h('b', { text: B.money(goal.progress) }), h('span.gk-muted', { text: ' of ' + B.money(goal.cents) })]),
        h('div.bz-meter', { role: 'meter', 'aria-valuenow': String(pct), 'aria-valuemin': '0', 'aria-valuemax': '100', title: pct + '%' }, [
          h('i.sales', { style: { width: fs * 100 + '%' } }), h('i.rec', { style: { width: fr * 100 + '%' } }),
        ]),
        h('div.bz-legend.gk-small', [
          h('span', [h('span.bz-key.goal-sales'), 'Sales ' + B.money(Math.max(0, goal.sales))]),
          goal.recurring ? h('span', [h('span.bz-key.goal-rec'), 'Pledges ' + B.money(goal.recurring)]) : null,
        ]),
        h('div.gk-small', { class: done ? 'bz-good' : 'gk-muted', text: done ? '✓ Reached — ' + pct + '%' : pct + '% · ' + B.money(goal.cents - goal.progress) + ' to go · ' + WB.fmt.plural(left, 'day') + ' left' }),
      ] });
  }

  function recurringPanel(rec, S) {
    const body = [];
    if (!rec.total && !rec.byTier.length) {
      body.push(h('p.gk-small.gk-muted.bz-tight', { text: 'Membership tiers and the people who support you each month live here: their pledges add up to your monthly recurring revenue.' }),
        h('div', [ui.button({ label: 'Add a tier', icon: '＋', small: true, onClick: () => S.go('people') })]));
    } else {
      body.push(h('div.bz-mrr', [h('b', { text: B.money(rec.mrr) }), h('span.gk-muted', { text: ' / month' })]),
        h('div.gk-small.gk-muted', { text: [WB.fmt.plural(rec.counts.active, 'active supporter'), rec.counts.paused ? rec.counts.paused + ' paused' : '', rec.newThisMonth ? '+' + rec.newThisMonth + ' in 30 days' : '', rec.churned ? '−' + rec.churned + ' left' : ''].filter(Boolean).join(' · ') }));
      const maxM = Math.max(1, ...rec.byTier.map(t => t.mrr));
      body.push(h('div.bz-tierlist', rec.byTier.map(t => h('div.bz-tierrow', { title: t.name + ': ' + t.active + ' active', onclick: () => S.go('people', { people: { tierId: t.tierId || '', status: '' } }) }, [
        U.dot(t.color || 'var(--muted)'), h('span.gk-ellipsis.bz-tiername', { text: t.name }),
        h('span.gk-small.gk-muted', { text: t.active + ' × ' + (t.tierId ? B.money(t.period === 'year' ? Math.round(t.price / 12) : t.price) : '—') }),
        h('div.bz-rank-bar.thin', [h('i', { style: { width: Math.max(1.5, t.mrr / maxM * 100) + '%' } })]),
        h('b.bz-num', { text: B.money(t.mrr) }),
      ]))));
    }
    return ui.panel({ title: 'Recurring', icon: '♥', cls: 'bz-rec', actions: [ui.button({ label: 'Supporters', small: true, kind: 'ghost', onClick: () => S.go('people') })], body });
  }

  B.views.overview = async function (box, S) {
    const st = S.st, period = st.get().period || '12m', range = B.rangeOf(period);
    const [sum, products] = await Promise.all([WB.api('business.summary', WB.worldId, range), WB.api('business.products', WB.worldId)]);
    const cleanups = [];
    const T = sum.totals, P = sum.prev;
    const nothing = !sum.allTime.count && !sum.allTime.refunds.count && !sum.recurring.total && !products.length;

    // period picker
    const head = h('div.bz-ovhead', [
      ui.segmented({ value: period, options: B.PERIODS.map(([v, l]) => [v, l, 'Show ' + l.toLowerCase()]), onChange: v => { st.patch({ period: v }); S.refresh(); } }),
      h('span.gk-grow'),
      sum.currencies.length > 1 || (sum.currencies.length === 1 && sum.currencies[0] !== sum.currency) ? h('span.wb-badge.warn', { text: 'Mixed currencies', title: 'Some sales are in ' + sum.currencies.join(', ') + '. Totals add the amounts as they are, shown in ' + sum.currency + '.' }) : null,
      h('span.gk-small.gk-muted', { text: sum.firstSale ? 'Ledger since ' + WB.fmt.real(sum.firstSale) : '' }),
    ]);
    box.appendChild(head);

    if (nothing) {
      box.appendChild(ui.panel({ cls: 'bz-welcome', body: [
        U.empty({ icon: '¤', title: 'A ledger for what your world earns', text: 'Books, map packs, adventure modules, memberships: add your products, log sales as they come in (or import a shop’s CSV), and keep supporters, coupons and reviews in one place. Your published site’s shop shows the featured reviews.', actions: [
          ui.button({ label: 'Add a product', icon: '¤', kind: 'primary', onClick: () => S.go('products').then(() => B.newProduct && B.newProduct(S)) }),
          ui.button({ label: 'Log a sale', icon: '＋', onClick: async () => { await S.go('sales'); B.focusQuickAdd && B.focusQuickAdd(); } }),
          ui.button({ label: 'Import a CSV', icon: '⇪', onClick: () => B.importWizard(S) }),
          ui.button({ label: 'Add a membership tier', icon: '♥', onClick: () => S.go('people') }),
        ] }),
      ] }));
      box.appendChild(h('div.bz-grid2', [goalPanel(sum.goal), recurringPanel(sum.recurring, S)]));
      return { cleanup: () => cleanups.forEach(f => f()) };
    }

    // tiles
    const dNet = P ? change(T.net, P.net) : null;
    const prevNote = dNet != null ? 'vs ' + B.periodLabel(period) : '';
    box.appendChild(h('div.bz-tiles', [
      tile({ label: 'Net revenue', icon: '¤', value: B.money(T.net), note: (period === 'all' ? 'all time, after fees' : 'after fees') + (prevNote ? ' · ' + prevNote : ''), delta: dNet, title: 'What you kept: gross minus fees, refunds left out', onClick: () => S.go('sales', { sales: { period } }) }),
      tile({ label: 'Gross sales', icon: '◫', value: B.money(T.gross), note: 'fees ' + B.money(T.fees) + (T.gross ? ' (' + Math.round(T.fees / T.gross * 100) + '%)' : ''), delta: P ? change(T.gross, P.gross) : null }),
      tile({ label: 'Units sold', icon: '▤', value: WB.fmt.num(T.qty), note: WB.fmt.plural(T.count, 'order') + ' · avg ' + B.money(T.avg), delta: P ? change(T.qty, P.qty) : null }),
      tile({ label: 'Recurring', icon: '♥', value: B.money(sum.mrr), note: 'a month from ' + WB.fmt.plural(sum.recurring.counts.active, 'supporter'), onClick: () => S.go('people') }),
      tile({ label: 'Refunds', icon: '↺', value: T.refunds.count ? B.money(T.refunds.gross) : '—', note: T.refunds.count ? WB.fmt.plural(T.refunds.count, 'refund') + ' · ' + Math.round(T.refunds.count / Math.max(1, T.count + T.refunds.count) * 100) + '% of orders' : 'none in this period', good: false, onClick: T.refunds.count ? () => S.go('sales', { sales: { period, refunds: 'only' } }) : null }),
    ]));

    // chart + goal/recurring
    const tableOn = !!st.get().chartTable;
    const chartBox = h('div.bz-chartbox');
    const paintChart = () => {
      GK.clear(chartBox);
      if (st.get().chartTable) {
        chartBox.appendChild(h('table.bz-mtable', [
          h('thead', [h('tr', ['Month', 'Sales', 'Units', 'Gross', 'Fees', 'Net'].map((t, i) => h('th', { text: t, class: i ? 'num' : '' })))]),
          h('tbody', sum.byMonth.slice().reverse().map(m => h('tr', [h('td', { text: B.monthName(m.month, true) }), h('td.num', { text: WB.fmt.num(m.count) }), h('td.num', { text: WB.fmt.num(m.qty) }), h('td.num', { text: B.money(m.gross) }), h('td.num', { text: B.money(m.fees) }), h('td.num', [h('b', { text: B.money(m.net) })])]))),
        ]));
      } else {
        const c = chart(sum.byMonth, { onPick: m => { const [y, mo] = m.month.split('-').map(Number); const last = new Date(y, mo, 0).getDate(); S.go('sales', { sales: { period: 'custom', from: m.month + '-01', to: m.month + '-' + String(last).padStart(2, '0') } }); } });
        cleanups.push(c._cleanup);
        chartBox.appendChild(c);
      }
    };
    paintChart();
    const best = sum.byMonth.reduce((a, m) => (m.net > (a ? a.net : 0) ? m : a), null);
    const chartPanel = ui.panel({ title: 'Revenue by month', icon: '▥', material: 'solid', cls: 'bz-chartpanel',
      actions: [
        h('div.bz-legend.gk-small', [h('span', [h('span.bz-key.net'), 'Net']), h('span', [h('span.bz-key.fee'), 'Fees'])]),
        ui.button({ label: tableOn ? 'Chart' : 'Table', small: true, kind: 'ghost', title: 'Show the numbers as a table', onClick: e => { st.patch({ chartTable: !st.get().chartTable }); e.currentTarget.replaceChildren(st.get().chartTable ? 'Chart' : 'Table'); paintChart(); } }),
      ],
      body: [chartBox, best && best.net ? h('div.gk-small.gk-muted', { text: 'Best month: ' + B.monthName(best.month, true) + ' with ' + B.money(best.net) + ' net.' + (sum.byMonth.length > 1 ? ' Click a bar to see its sales.' : '') }) : null] });

    // breakdowns
    const prodRows = ranked(sum.byProduct, {
      label: r => (r.productId && WB.liteOf(r.productId) ? U.chip(r.productId, { size: 'sm' }) : h('span.bz-noprod', { text: r.title })),
      onPick: r => S.go('sales', { sales: { productId: r.productId || 'none', period } }),
      empty: 'No sales in this period.',
    });
    const chanRows = ranked(sum.byChannel, {
      label: r => h('span.bz-channel-name', { text: r.channel || 'No channel' }),
      onPick: r => S.go('sales', { sales: { channel: r.channel, period } }),
      empty: 'No sales in this period.',
    });
    const recent = h('div.bz-recent', sum.recent.length ? sum.recent.map(x => h('div.bz-recent-row', { class: x.refund ? 'refund' : '', title: x.refund ? 'Refunded' : '' }, [
      h('span.bz-recent-what', [B.productChip(x.productId, x.productTitle)]),
      h('span.bz-recent-when.gk-small.gk-muted.gk-ellipsis', { text: [B.relDay(x.date), x.channel, x.qty > 1 ? '×' + x.qty : ''].filter(Boolean).join(' · '), title: WB.fmt.real(x.date) }),
      h('b.bz-num', { text: (x.refund ? '↺ ' : '') + B.money(x.net, x.currency || undefined) }),
    ])) : [h('div.gk-small.gk-muted.bz-none', { text: 'No sales yet.' })]);
    box.appendChild(h('div.bz-main', [
      h('div.bz-left', [chartPanel, h('div.bz-grid2', [
        ui.panel({ title: 'By product', icon: '¤', body: [prodRows], actions: [ui.button({ label: 'Products', small: true, kind: 'ghost', onClick: () => S.go('products') })] }),
        ui.panel({ title: 'By channel', icon: '⇄', body: [chanRows] }),
      ])]),
      h('div.bz-side', [goalPanel(sum.goal), recurringPanel(sum.recurring, S),
        ui.panel({ title: 'Recent sales', icon: '≣', body: [recent], actions: [ui.button({ label: 'All sales', small: true, kind: 'ghost', onClick: () => S.go('sales') })] })]),
    ]));
    return { cleanup: () => cleanups.forEach(f => f && f()) };
  };
})();
