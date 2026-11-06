/* Business: a creator's ledger for people who sell their worldbuilding — overview, products, sales, supporters &
   tiers, coupons and reviews. Views live in src/app/modules/business/*.js and register on WB.biz.views. */
(function () {
  'use strict';
  const { h, ui } = GK, U = WB.ui;
  const B = WB.biz = WB.biz || { views: {} };
  const TABS = [['overview', 'Overview', '◔'], ['products', 'Products', '¤'], ['sales', 'Sales', '≣'], ['people', 'Supporters & tiers', '♥'], ['coupons', 'Coupons', '✂'], ['reviews', 'Reviews', '★']];
  const FILES = ['overview', 'ledger', 'people'];

  /* ---------------- money, dates, periods ---------------- */
  B.cur = () => (WB.world && WB.world.settings && WB.world.settings.currency) || 'USD';
  B.money = (c, cur) => WB.fmt.money(c || 0, cur || B.cur());
  B.compact = (c, cur) => {
    try { return new Intl.NumberFormat(undefined, { style: 'currency', currency: cur || B.cur(), notation: 'compact', maximumFractionDigits: Math.abs(c) < 100000 ? 1 : 0 }).format((c || 0) / 100); }
    catch { return B.money(c, cur); }
  };
  B.plain = c => (c == null || c === '' ? '' : ((c < 0 ? '-' : '') + Math.floor(Math.abs(c) / 100) + '.' + String(Math.abs(c) % 100).padStart(2, '0')));
  /** "12.99", "12,99", "$1,299", "1.299,50" → cents; '' → null; nonsense → NaN */
  B.parseMoney = s => {
    let t = String(s == null ? '' : s).trim();
    if (!t) return null;
    const neg = /^-|^\(.*\)$/.test(t);
    t = t.replace(/[^\d.,]/g, '');
    if (!/\d/.test(t)) return NaN;
    const ld = t.lastIndexOf('.'), lc = t.lastIndexOf(',');
    let dec = ld > lc ? '.' : lc > ld ? ',' : '';
    if (dec && new RegExp('^\\d{1,3}(\\' + dec + '\\d{3})+$').test(t)) dec = '';
    const parts = dec ? [t.slice(0, t.lastIndexOf(dec)).replace(/[.,]/g, ''), t.slice(t.lastIndexOf(dec) + 1)] : [t.replace(/[.,]/g, ''), ''];
    const v = Math.round(parseFloat(parts[0] + '.' + (parts[1] || '0')) * 100);
    return Number.isFinite(v) ? (neg ? -v : v) : NaN;
  };
  B.today = () => WB.today();
  B.addDays = (iso, n) => { const d = new Date(iso + 'T12:00:00'); d.setDate(d.getDate() + n); return d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0') + '-' + String(d.getDate()).padStart(2, '0'); };
  B.monthName = (ym, long) => { const [y, m] = ym.split('-').map(Number); return new Date(y, m - 1, 15).toLocaleDateString(undefined, long ? { month: 'long', year: 'numeric' } : { month: 'short' }); };
  B.PERIODS = [['30d', '30 days'], ['90d', '3 months'], ['6m', '6 months'], ['12m', '12 months'], ['ytd', 'This year'], ['all', 'All time']];
  B.rangeOf = p => {
    const t = B.today();
    const monthsBack = n => { const d = new Date(); d.setMonth(d.getMonth() - n, 1); return d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0') + '-01'; };
    switch (p) {
      case '30d': return { from: B.addDays(t, -29), to: t };
      case '90d': return { from: B.addDays(t, -89), to: t };
      case '6m': return { from: monthsBack(5), to: t };
      case '12m': return { from: monthsBack(11), to: t };
      case 'ytd': return { from: t.slice(0, 4) + '-01-01', to: t };
      case 'month': return { from: t.slice(0, 7) + '-01', to: t };
      default: return {};
    }
  };
  B.periodLabel = p => ({ '30d': 'the 30 days before', '90d': 'the 3 months before', '6m': 'the 6 months before', '12m': 'the 12 months before', ytd: 'last year', month: 'last month' })[p] || 'the period before';

  /* ---------------- small controls ---------------- */
  B.moneyInput = ({ value, onChange, placeholder = '0.00', title, cls } = {}) => {
    const i = ui.input({ value: B.plain(value), placeholder });
    i.classList.add('bz-money'); if (cls) i.classList.add(cls);
    i.inputMode = 'decimal'; if (title) i.title = title;
    i.addEventListener('change', () => {
      const v = B.parseMoney(i.value);
      if (Number.isNaN(v)) { i.classList.add('bad'); i.title = 'Type an amount like 12.99'; return; }
      i.classList.remove('bad'); i.value = B.plain(v); onChange && onChange(v);
    });
    i.getCents = () => { const v = B.parseMoney(i.value); return Number.isNaN(v) ? NaN : v; };
    return i;
  };
  B.dateInput = ({ value, onChange, title } = {}) => {
    const i = ui.input({ type: 'date', value: value || '', onChange: v => onChange && onChange(v || null) });
    i.classList.add('bz-date'); if (title) i.title = title;
    return i;
  };
  B.select = (value, options, onChange) => { const s = ui.select({ value: value == null ? '' : value, options, onChange }); s.classList.add('bz-select'); return s; };
  /** a shared <datalist> of channels so every channel box suggests the ones used before */
  let dl = null;
  B.channels = [];
  B.channelInput = ({ value, onChange, placeholder = 'Channel' } = {}) => {
    if (!dl || !dl.isConnected) dl = document.body.appendChild(h('datalist#bz-channels'));
    GK.clear(dl);
    for (const c of B.channels) dl.appendChild(h('option', { value: c }));
    const i = ui.input({ value: value || '', placeholder, onChange: v => onChange && onChange(v.trim()) });
    i.setAttribute('list', 'bz-channels'); i.classList.add('bz-channel');
    return i;
  };
  B.stars = (n, { onChange, size } = {}) => {
    const box = h('span.bz-stars', { class: (onChange ? 'edit ' : '') + (size || ''), role: onChange ? 'radiogroup' : 'img', 'aria-label': (n || 0) + ' of 5 stars', title: onChange ? '' : (Math.round((n || 0) * 10) / 10) + ' of 5' });
    const paint = () => {
      GK.clear(box);
      for (let i = 1; i <= 5; i++) box.appendChild(onChange ? h('button', { type: 'button', class: i <= n ? 'on' : '', text: '★', title: i + ' of 5', onclick: () => { n = i; paint(); onChange(i); } }) : h('span', { class: i <= Math.round(n || 0) ? 'on' : '', text: '★' }));
    };
    paint();
    return box;
  };
  B.productOptions = (products, none = 'No product') => [['', none]].concat((products || []).map(p => [p.id, p.title]));
  B.productChip = (id, title) => (id && WB.liteOf(id) ? U.chip(id, { size: 'sm' }) : h('span.bz-noprod', { text: id ? (title || 'Deleted product') : '—', title: id ? 'This product is in the trash or was deleted' : 'No product' }));
  B.copy = async (text, what) => { try { await navigator.clipboard.writeText(text); ui.toast('Copied ' + (what || text), '⎘'); } catch { ui.toast('Could not reach the clipboard', '⚠'); } };
  B.undoRemove = (label, rm) => { if (rm) U.undoToast(label, () => WB.api('business.restore', rm.table, rm.row)); };
  B.relDay = iso => {
    if (!iso) return '';
    const d = Math.round((Date.parse(iso + 'T12:00:00') - Date.parse(B.today() + 'T12:00:00')) / 864e5);
    if (d === 0) return 'today';
    if (d === -1) return 'yesterday';
    if (d === 1) return 'tomorrow';
    if (d < 0 && d > -45) return -d + ' days ago';
    if (d > 0 && d < 45) return 'in ' + d + ' days';
    return WB.fmt.real(iso);
  };

  /* ---------------- a small form dialog ---------------- */
  /** fields: [{ key, label, kind: text|textarea|money|number|date|select|toggle|stars|seg|channel, options, hint, value, placeholder, wide, required }] → values | null */
  B.form = function ({ title, icon, fields, ok = 'Save', danger, extra, width } = {}) {
    return new Promise(resolve => {
      const vals = {}, ctrls = {};
      const grid = h('div.bz-form');
      for (const f of fields) {
        vals[f.key] = f.value;
        let c;
        const set = v => { vals[f.key] = v; };
        switch (f.kind) {
          case 'textarea': c = ui.input({ multiline: true, rows: f.rows || 3, value: f.value || '', placeholder: f.placeholder, onInput: set }); break;
          case 'money': c = B.moneyInput({ value: f.value, onChange: set, placeholder: f.placeholder }); break;
          case 'number': c = ui.input({ type: 'number', value: f.value == null ? '' : f.value, placeholder: f.placeholder, onInput: v => set(v === '' ? null : +v) }); break;
          case 'date': c = B.dateInput({ value: f.value, onChange: set }); break;
          case 'select': c = B.select(f.value, f.options, set); break;
          case 'toggle': c = ui.toggle({ value: !!f.value, onChange: set }); break;
          case 'stars': c = B.stars(f.value || 0, { onChange: set, size: 'big' }); break;
          case 'seg': c = ui.segmented({ value: f.value, options: f.options, onChange: set }); break;
          case 'channel': c = B.channelInput({ value: f.value, onChange: set, placeholder: f.placeholder || 'e.g. Itch, Convention' }); c.addEventListener('input', () => set(c.value.trim())); break;
          default: c = ui.input({ value: f.value || '', placeholder: f.placeholder, onInput: set });
        }
        ctrls[f.key] = c;
        grid.appendChild(h('div.bz-form-cell', { class: f.wide ? 'wide' : '' }, [ui.field({ label: f.label, hint: f.hint, inline: f.kind === 'toggle', control: c })]));
      }
      let done = false;
      const finish = v => { if (done) return; done = true; scrim.remove(); document.removeEventListener('keydown', onKey, true); resolve(v); };
      const submit = () => {
        // money boxes commit on change; read them now in case the last one still has focus
        for (const f of fields) if (f.kind === 'money') { const v = ctrls[f.key].getCents(); if (Number.isNaN(v)) { ctrls[f.key].classList.add('bad'); ctrls[f.key].focus(); return; } vals[f.key] = v; }
        for (const f of fields) if (f.required && (vals[f.key] == null || vals[f.key] === '')) { ctrls[f.key].focus(); ctrls[f.key].classList.add('bad'); return; }
        finish(vals);
      };
      const panel = ui.panel({ title, icon, cls: 'gk-dialog bz-dialog', body: [grid] });
      if (width) panel.style.width = width;
      const foot = h('div.gk-panel-foot', [h('span.gk-small.gk-faint.bz-form-keys', [U.kbd('Enter'), ' save · ', U.kbd('Esc'), ' cancel']), h('span.gk-grow'), ui.button({ label: 'Cancel', onClick: () => finish(null) }), ui.button({ label: ok, kind: danger ? 'primary danger' : 'primary', onClick: submit })]);
      if (extra) foot.insertBefore(extra({ close: () => finish(null) }), foot.firstChild);
      panel.appendChild(foot);
      const scrim = h('div.gk-scrim', { onclick: e => { if (e.target === scrim) finish(null); } }, [panel]);
      const onKey = e => {
        if (e.key === 'Escape') { e.stopPropagation(); finish(null); }
        else if (e.key === 'Enter' && !e.shiftKey && panel.contains(e.target) && !e.target.matches('textarea, button')) { e.preventDefault(); e.target.dispatchEvent(new Event('change')); submit(); }
      };
      document.addEventListener('keydown', onKey, true);
      document.body.appendChild(scrim);
      setTimeout(() => { const first = grid.querySelector('input:not([type=date]), textarea, select'); if (first) first.focus(); }, 40);
    });
  };

  /* ---------------- business settings (currency & goal) ---------------- */
  B.CURRENCIES = ['USD', 'EUR', 'GBP', 'CAD', 'AUD', 'NZD', 'JPY', 'CHF', 'SEK', 'NOK', 'DKK', 'PLN', 'CZK', 'BRL', 'MXN', 'INR', 'ZAR', 'SGD', 'HKD', 'KRW'];
  B.editGoal = async () => {
    const s = WB.world.settings || {};
    const v = await B.form({ title: 'Revenue goal', icon: '◎', ok: 'Save goal', fields: [
      { key: 'revenueGoal', label: 'Goal', kind: 'money', value: s.revenueGoal || null, placeholder: 'e.g. 500.00', required: true },
      { key: 'revenueGoalPeriod', label: 'Every', kind: 'seg', value: s.revenueGoalPeriod === 'year' ? 'year' : 'month', options: [['month', 'Month'], ['year', 'Year']] },
      { key: 'revenueGoalLabel', label: 'What it pays for', value: s.revenueGoalLabel || '', placeholder: 'e.g. Commission the cover art', wide: true },
      { key: 'revenueGoalRecurring', label: 'Count supporters’ pledges toward it', kind: 'toggle', value: s.revenueGoalRecurring !== false, wide: true },
    ], extra: s.revenueGoal ? ({ close }) => ui.button({ label: 'Remove goal', kind: 'ghost', onClick: async () => { close(); await WB.api('business.settings', WB.worldId, { revenueGoal: 0 }); ui.toast('Goal removed', '◎'); } }) : null });
    if (!v) return;
    await WB.api('business.settings', WB.worldId, v);
    ui.toast('Goal saved', '◎');
  };
  B.editCurrency = at => {
    const cur = B.cur();
    U.menu([{ header: 'Currency for totals' }].concat(B.CURRENCIES.map(c => ({ label: c + ' · ' + B.money(123456, c), checked: c === cur, onClick: async () => { await WB.api('business.settings', WB.worldId, { currency: c }); ui.toast('Totals now in ' + c, '¤'); } }))), at);
  };

  /* ---------------- the screen ---------------- */
  const BIZ_DEFAULTS = { tab: 'overview', period: '12m', sales: { period: 'all', productId: '', channel: '', q: '', refunds: 'all', sort: 'date', dir: 'desc', from: '', to: '' }, last: { channel: '', productId: '' }, people: { status: '', tierId: '', q: '' }, products: { sort: 'revenue' }, reviews: { productId: '', featured: false }, chartTable: false };
  let current = null;   // the mounted screen (palette commands and smoke steps talk to it)
  GK.modules.register({
    id: 'business',
    title: 'Business',
    icon: '¤',
    order: 130,
    subtitle: 'Your shop’s ledger: sales, products, supporters, coupons and reviews.',
    async mount(page, ctx) {
      page.classList.add('bz-page');
      if (!WB.worldId) {
        page.appendChild(U.empty({ icon: '¤', title: 'No world open', text: 'The business ledger belongs to a world: its products are entries, and its shop is published with it.', actions: [ui.button({ label: 'Create a world', kind: 'primary', onClick: () => WB.newWorld() })] }));
        return;
      }
      if (WB.share) {
        page.appendChild(U.empty({ icon: '◑', title: 'Your ledger stays private', text: 'Share view shows what players and readers see. Sales, supporters and coupons are only for you — leave Share view to work on them.', actions: [ui.button({ label: 'Leave Share view', kind: 'primary', onClick: () => WB.setShare(false) })] }));
        return;
      }
      await Promise.all(FILES.map(f => WB.loadScript('src/app/modules/business/' + f + '.js')));
      const st = await (WB.store ? WB.store(ctx, BIZ_DEFAULTS) : ctx.store(BIZ_DEFAULTS));
      for (const [k, v] of Object.entries(BIZ_DEFAULTS)) { const cur = st.get()[k]; if (cur === undefined || (v && typeof v === 'object' && (typeof cur !== 'object' || !cur))) st.patch({ [k]: v }); else if (v && typeof v === 'object') st.patch({ [k]: Object.assign({}, v, cur) }); }
      const params = WB.params('business') || {};
      if (params.tab && TABS.some(t => t[0] === params.tab)) st.patch({ tab: params.tab });
      if (params.productId) st.patch({ sales: Object.assign({}, st.get().sales, { productId: params.productId, period: 'all' }) });

      const tabsBox = h('div.bz-tabs', { role: 'tablist' }), tools = h('div.bz-tools');
      const body = h('div.bz-body');
      page.append(h('div.bz-bar', [tabsBox, tools]), body);
      let view = null, seq = 0, alive = true;
      const mountedWorld = WB.worldId;
      const S = {
        st, ctx, page, params,
        /** switch tab; extra patches view state first ({ sales: { productId } } merges into sales) */
        go(tab, extra) {
          if (extra) { const cur = st.get(); st.patch(Object.fromEntries(Object.entries(extra).map(([k, v]) => [k, v && typeof v === 'object' && !Array.isArray(v) ? Object.assign({}, cur[k], v) : v]))); }
          st.patch({ tab }); return render();
        },
        refresh: () => { S.keepScroll = true; return render(); },
        busy: 0,
      };
      const paintBar = () => {
        GK.clear(tabsBox);
        const cur = st.get().tab;
        TABS.forEach(([id, label, icon], i) => tabsBox.appendChild(h('button.bz-tab', { type: 'button', role: 'tab', 'aria-selected': String(id === cur), class: id === cur ? 'on' : '', title: label + '  (Alt+' + (i + 1) + ')', onclick: () => { if (st.get().tab !== id) S.go(id); } }, [h('span.bz-tab-ico', { text: icon }), h('span.bz-tab-lbl', { text: label })])));
        GK.clear(tools);
        tools.append(
          ui.button({ label: B.cur(), icon: '¤', small: true, kind: 'ghost', title: 'Currency for totals and new amounts', onClick: e => B.editCurrency(e.currentTarget) }),
          ui.button({ label: 'Import CSV', icon: '⇪', small: true, title: 'Bring in sales from a shop’s export', onClick: () => B.importWizard(S) }),
          ui.button({ label: 'Log a sale', icon: '＋', small: true, kind: 'primary', title: 'Add a sale to the ledger (N on the Sales tab)', onClick: async () => { if (st.get().tab !== 'sales') await S.go('sales'); B.focusQuickAdd && B.focusQuickAdd(); } }),
        );
      };
      const render = async () => {
        const my = ++seq;
        paintBar();
        B.channels = await WB.api('business.channels', WB.worldId).catch(() => []);
        const id = st.get().tab, fn = B.views[id] || B.views.overview;
        const box = h('div.bz-view', { dataset: { view: id } });
        let v = null;
        try { v = await fn(box, S); }
        catch (e) { console.error(e); box.appendChild(ui.panel({ title: 'This part could not load', icon: '⚠', body: h('pre.gk-small', { text: String(e && e.stack || e) }) })); }
        if (my !== seq || !alive) { if (v && v.cleanup) v.cleanup(); return; }
        if (view && view.cleanup) view.cleanup();
        view = v;
        const scroller = page.closest('.gk-view'), top = scroller ? scroller.scrollTop : 0;
        GK.clear(body); body.appendChild(box);
        if (scroller) scroller.scrollTop = S.keepScroll ? top : 0;
        S.keepScroll = false;
      };
      /** data changed elsewhere (or by us): views with refresh() update in place, others re-render */
      const changed = WB.debounce(() => { if (!alive || S.busy) return; if (view && view.refresh) view.refresh(); else S.refresh(); }, 160);
      const offs = [
        WB.onChange(['sales', 'tiers', 'supporters', 'coupons', 'reviews', 'entries', 'worlds'], changed),
        // a world switch remounts; an edit of this world (currency, goal) only refreshes
        WB.on('world', w => { if (!w || w.id !== mountedWorld) GK.shell.go('business'); else changed(); }),
        WB.on('share', () => GK.shell.go('business')),
      ];
      const onKey = e => {
        if (!e.altKey || e.ctrlKey || e.shiftKey || document.querySelector('.gk-scrim')) return;
        const n = +e.key;
        if (n >= 1 && n <= TABS.length) { e.preventDefault(); S.go(TABS[n - 1][0]); }
      };
      document.addEventListener('keydown', onKey);
      // a spreadsheet dropped anywhere on the screen goes to the import wizard
      WB.dropFiles(page, async files => {
        const f = files.find(x => /\.(csv|tsv|txt)$/i.test(x.name) || /csv|tab-separated|plain/.test(x.type));
        if (!f) { ui.toast('Drop a CSV file to import sales', '⇪'); return; }
        B.importWizard(S, { file: { text: await f.text(), name: f.name } });
      });
      current = S;
      await render();
      return () => { alive = false; current = null; offs.forEach(f => f()); document.removeEventListener('keydown', onKey); if (view && view.cleanup) view.cleanup(); if (dl) { dl.remove(); dl = null; } };
    },
  });

  /* ---------------- palette commands ---------------- */
  const when = () => !!WB.worldId;
  const openTab = (tab, then) => async () => {
    if (GK.shell.current !== 'business' || !current) await WB.go('business', { tab });
    else await current.go(tab);
    if (then) then();
  };
  WB.commands.add({ id: 'business:overview', label: 'Business overview', icon: '¤', group: 'Business', when, run: openTab('overview'), words: 'revenue sales money income shop' });
  WB.commands.add({ id: 'business:sale', label: 'Log a sale', icon: '＋', group: 'Business', when, run: openTab('sales', () => B.focusQuickAdd && B.focusQuickAdd()), words: 'add sale order purchase ledger' });
  WB.commands.add({ id: 'business:import', label: 'Import sales from a CSV file…', icon: '⇪', group: 'Business', when, run: openTab('sales', () => current && B.importWizard(current)), words: 'csv spreadsheet payouts shop export' });
  WB.commands.add({ id: 'business:export', label: 'Export sales as CSV…', icon: '⇩', group: 'Business', when, run: async () => { const r = await WB.api('business.exportFile', WB.worldId, {}).catch(WB.fail); if (r && r.file) ui.toast('Saved ' + r.rows + ' sales', '⇩'); } });
  WB.commands.add({ id: 'business:products', label: 'Products & their sales', icon: '¤', group: 'Business', when, run: openTab('products'), words: 'books maps modules store' });
  WB.commands.add({ id: 'business:supporters', label: 'Supporters & tiers', icon: '♥', group: 'Business', when, run: openTab('people'), words: 'patrons members membership recurring pledges' });
  WB.commands.add({ id: 'business:coupons', label: 'Coupons', icon: '✂', group: 'Business', when, run: openTab('coupons'), words: 'discount code promo' });
  WB.commands.add({ id: 'business:reviews', label: 'Reviews', icon: '★', group: 'Business', when, run: openTab('reviews'), words: 'ratings testimonials featured shop' });
  WB.commands.add({ id: 'business:goal', label: 'Set a revenue goal…', icon: '◎', group: 'Business', when, run: () => B.editGoal() });

  /* ---------------- smoke ---------------- */
  let overview = 'did not run', tabs = 'did not run';
  WB.smoke('business-overview', async () => {
    await WB.go('business', { tab: 'overview' });
    await WB.wait(800);
    const page = document.querySelector('.bz-page');
    if (!page) return (overview = 'error: the business screen did not mount');
    const tiles = page.querySelectorAll('.bz-tiles .gk-widget').length, bars = page.querySelectorAll('.bz-chart .bz-col').length;
    const s = await WB.api('business.summary', WB.worldId, B.rangeOf('12m'));
    overview = tiles >= 4 && (bars > 0 || !s.totals.count) ? 'ok' : 'error: ' + tiles + ' tiles, ' + bars + ' bars for ' + s.totals.count + ' sales';
    return { tiles, bars, sales: s.totals.count, mrr: s.mrr, overview };
  });
  WB.smoke('business-tabs', async () => {
    const bad = [];
    for (const [id] of TABS) {
      if (current) await current.go(id); else await WB.go('business', { tab: id });
      await WB.wait(300);
      const v = document.querySelector('.bz-view[data-view="' + id + '"]');
      if (!v || [...v.querySelectorAll('.gk-panel h3')].some(x => x.textContent === 'This part could not load')) bad.push(id);
    }
    if (current) await current.go('overview');
    tabs = bad.length ? 'error: these business tabs failed: ' + bad.join(', ') : 'ok';
    return tabs;
  });
  WB.check('business: overview shows tiles and the revenue chart', () => { if (!/^ok/.test(overview)) throw new Error(overview); return true; });
  WB.check('business: every tab opens', () => { if (!/^ok/.test(tabs)) throw new Error(tabs); return true; });
})();
