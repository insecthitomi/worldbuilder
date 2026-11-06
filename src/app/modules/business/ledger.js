/* Business → Sales: the ledger (fast entry with Enter, inline editing, refunds, filters, totals) and the CSV
   import wizard with column mapping and a preview. */
(function () {
  'use strict';
  const { h, ui } = GK, U = WB.ui, B = WB.biz;
  const PAGE = 250;
  const COLS = [
    ['date', 'Date', 'Date the sale happened'], ['product', 'Product'], ['channel', 'Channel'], ['qty', 'Qty', 'Units', 'num'],
    ['gross', 'Gross', 'What the buyer paid', 'num'], ['fees', 'Fees', 'Platform, payment and shipping fees', 'num'], ['net', 'Net', 'What you kept', 'num'],
    ['buyer', 'Buyer'], ['coupon', 'Coupon'],
  ];
  const SORTS = { date: (a, b) => a.date.localeCompare(b.date) || String(a.createdAt).localeCompare(String(b.createdAt)), product: (a, b) => (a.productTitle || '').localeCompare(b.productTitle || ''), channel: (a, b) => a.channel.localeCompare(b.channel), qty: (a, b) => a.qty - b.qty, gross: (a, b) => a.gross - b.gross, fees: (a, b) => a.fees - b.fees, net: (a, b) => a.net - b.net, buyer: (a, b) => a.buyer.localeCompare(b.buyer), coupon: (a, b) => a.coupon.localeCompare(b.coupon) };

  const filterOf = f => {
    const r = f.period === 'custom' ? { from: f.from || undefined, to: f.to || undefined } : B.rangeOf(f.period);
    return Object.assign(r, { productId: f.productId || undefined, channel: f.channel || undefined, q: f.q || undefined, refunds: f.refunds === 'hide' ? false : f.refunds === 'only' ? 'only' : undefined });
  };

  B.views.sales = async function (box, S) {
    const st = S.st;
    const F = () => st.get().sales;
    const setF = p => st.patch({ sales: Object.assign({}, F(), p) });
    let products = await WB.api('business.products', WB.worldId);
    let rows = [], shown = PAGE, editing = null;

    /* ---------- filters ---------- */
    const filters = h('div.bz-filters');
    const paintFilters = () => {
      const f = F();
      GK.clear(filters);
      const put = (...els) => GK.append(filters, els);
      const periodSel = B.select(f.period || 'all', [['all', 'All time'], ['month', 'This month'], ['30d', 'Last 30 days'], ['90d', 'Last 3 months'], ['12m', 'Last 12 months'], ['ytd', 'This year'], ['custom', 'Between dates…']], v => { setF({ period: v }); paintFilters(); load(); });
      periodSel.title = 'Which dates to show';
      put(
        U.search({ placeholder: 'Buyer, note, coupon…', value: f.q || '', onInput: WB.debounce(v => { setF({ q: v }); load(); }, 220) }),
        periodSel,
        f.period === 'custom' ? h('span.bz-range', [B.dateInput({ value: f.from, title: 'From', onChange: v => { setF({ from: v || '' }); load(); } }), h('span.gk-faint', { text: '–' }), B.dateInput({ value: f.to, title: 'To', onChange: v => { setF({ to: v || '' }); load(); } })]) : null,
        B.select(f.productId || '', [['', 'Every product'], ['none', 'No product']].concat(products.map(p => [p.id, p.title])), v => { setF({ productId: v }); load(); }),
        B.select(f.channel || '', [['', 'Every channel']].concat(B.channels.map(c => [c, c])), v => { setF({ channel: v }); load(); }),
        ui.segmented({ value: f.refunds || 'all', options: [['all', 'All', 'Sales and refunds'], ['hide', 'No refunds', 'Hide refunded sales'], ['only', 'Refunds', 'Only refunded sales']], onChange: v => { setF({ refunds: v }); load(); } }),
        h('span.gk-grow'),
        (f.q || f.productId || f.channel || (f.period && f.period !== 'all') || (f.refunds && f.refunds !== 'all')) ? ui.button({ label: 'Clear filters', small: true, kind: 'ghost', onClick: () => { setF({ q: '', productId: '', channel: '', period: 'all', refunds: 'all' }); paintFilters(); load(); } }) : null,
        ui.button({ label: 'Export', icon: '⇩', small: true, title: 'Save the sales shown as a CSV file', onClick: async () => { const r = await WB.api('business.exportFile', WB.worldId, filterOf(F())).catch(WB.fail); if (r && r.file) ui.toast('Saved ' + WB.fmt.plural(r.rows, 'sale') + ' to ' + r.file.split(/[\\/]/).pop(), '⇩', 5000); } }),
      );
    };

    /* ---------- quick add ---------- */
    const last = st.get().last || {};
    const q = { date: B.today(), productId: last.productId && products.some(p => p.id === last.productId) ? last.productId : (products[0] ? products[0].id : ''), channel: last.channel || '', qty: 1 };
    const qDate = B.dateInput({ value: q.date, title: 'Date', onChange: v => { q.date = v || B.today(); } });
    const qProd = B.select(q.productId, B.productOptions(products), v => { q.productId = v; const p = products.find(x => x.id === v); if (p && p.price != null && !qGross.value) { qGross.value = B.plain(p.price * (+qQty.value || 1)); autoNet(); } });
    const qChan = B.channelInput({ value: q.channel, placeholder: 'Channel' });
    const qQty = ui.input({ type: 'number', value: '1' }); qQty.classList.add('bz-qty'); qQty.min = '0'; qQty.title = 'Units';
    const qGross = B.moneyInput({ placeholder: 'Gross', title: 'What the buyer paid' });
    const qFees = B.moneyInput({ placeholder: 'Fees', title: 'Fees taken by the shop or payment service' });
    const qNet = B.moneyInput({ placeholder: 'Net', title: 'What you kept — leave empty for gross − fees' });
    const qBuyer = ui.input({ placeholder: 'Buyer (optional)' });
    const qCoupon = ui.input({ placeholder: 'Coupon' }); qCoupon.classList.add('bz-code');
    const qNote = ui.input({ placeholder: 'Note' });
    const autoNet = () => { const g = qGross.getCents(), f = qFees.getCents(); qNet.placeholder = Number.isFinite(g) && g != null ? 'Net ' + B.plain((g || 0) - (Number.isFinite(f) && f != null ? f : 0)) : 'Net'; };
    qGross.addEventListener('input', autoNet); qFees.addEventListener('input', autoNet);
    const add = async () => {
      const gross = qGross.getCents(), fees = qFees.getCents(), net = qNet.getCents();
      if (Number.isNaN(gross) || Number.isNaN(fees) || Number.isNaN(net)) { ui.toast('Amounts look like 12.99', '⚠'); return; }
      if (gross == null && net == null) { qGross.classList.add('bad'); qGross.focus(); ui.toast('Type what the buyer paid', '¤'); return; }
      qGross.classList.remove('bad');
      const sale = { worldId: WB.worldId, date: qDate.value || B.today(), productId: qProd.value || null, channel: qChan.value.trim(), qty: qQty.value === '' ? 1 : +qQty.value,
        gross: gross != null ? gross : (net || 0) + (fees || 0), fees: fees || 0, net: net != null ? net : undefined, buyer: qBuyer.value.trim(), coupon: qCoupon.value.trim(), note: qNote.value.trim() };
      S.busy++;
      try {
        const saved = await WB.api('business.saveSale', sale);
        st.patch({ last: { channel: sale.channel, productId: sale.productId || '' } });
        if (sale.channel && !B.channels.includes(sale.channel)) B.channels.push(sale.channel);
        for (const i of [qGross, qFees, qNet, qBuyer, qCoupon, qNote]) i.value = '';
        qQty.value = '1'; autoNet();
        flash = saved.id;
        ui.toast('Added ' + B.money(saved.net) + (saved.productTitle ? ' · ' + saved.productTitle : ''), '¤', 1800);
        qGross.focus();
        await load();
      } catch (e) { WB.fail(e); } finally { S.busy--; }
    };
    const quick = h('div.bz-quick', { title: '' }, [
      h('div.bz-quick-grid', [qDate, qProd, qChan, qQty, qGross, qFees, qNet, qBuyer, qCoupon, qNote,
        ui.button({ label: 'Add', icon: '＋', kind: 'primary', title: 'Add the sale (Enter)', onClick: add })]),
      h('div.bz-quick-hint.gk-tiny.gk-faint', [U.kbd('Enter'), ' adds the sale and keeps date, product and channel for the next one · amounts like 12.99 · leave Net empty for gross − fees']),
    ]);
    quick.addEventListener('keydown', e => { if (e.key === 'Enter' && e.target.matches('input, select')) { e.preventDefault(); e.target.dispatchEvent(new Event('change')); add(); } });
    B.focusQuickAdd = () => { if (quick.isConnected) { quick.scrollIntoView({ block: 'nearest' }); (qGross).focus(); } };

    /* ---------- table ---------- */
    const table = h('table.bz-ledger');
    const thead = h('thead'), tbody = h('tbody'), tfoot = h('tfoot');
    table.append(thead, tbody, tfoot);
    const tableBox = h('div.bz-tablebox', [table]);
    const more = h('div.bz-more');
    let flash = null;
    const paintHead = () => {
      const f = F();
      GK.clear(thead);
      thead.appendChild(h('tr', COLS.map(([k, l, tip, cls]) => h('th', { class: (cls || '') + (f.sort === k ? ' sorted' : ''), title: (tip ? tip + ' · ' : '') + 'Sort by ' + l.toLowerCase(), onclick: () => { setF({ sort: k, dir: f.sort === k && f.dir === 'desc' ? 'asc' : 'desc' }); paintHead(); paintBody(); } },
        [l, f.sort === k ? h('span.bz-sortmark', { text: f.dir === 'asc' ? ' ▲' : ' ▼' }) : null])).concat([h('th.bz-actions', { 'aria-label': 'Actions' })])));
    };
    const cell = (s, k) => {
      switch (k) {
        case 'date': return h('span', { text: WB.fmt.real(s.date), title: B.relDay(s.date) });
        case 'product': return B.productChip(s.productId, s.productTitle);
        case 'qty': return h('span', { text: String(s.qty) });
        case 'gross': case 'fees': case 'net': return h('span', { text: B.money(s[k], s.currency || undefined), class: k === 'net' ? 'bz-strong' : '' });
        case 'coupon': return s.coupon ? h('code.bz-code', { text: s.coupon }) : h('span.gk-faint', { text: '' });
        default: return h('span', { text: s[k] || '' });
      }
    };
    const rowEl = s => {
      const tr = h('tr', { class: (s.refund ? 'refund ' : '') + (flash === s.id ? 'flash' : ''), tabindex: 0, dataset: { id: s.id } });
      for (const [k, , , cls] of COLS) {
        const td = h('td', { class: (cls || '') + ' c-' + k, dataset: { k }, title: k === 'product' ? 'Click beside the name to pick another product' : 'Click to edit' }, [cell(s, k)]);
        td.addEventListener('click', e => { if (e.target.closest('.wb-chip') && !e.altKey) return; edit(td, s, k); });
        tr.appendChild(td);
      }
      const menuBtn = ui.button({ icon: '⋯', small: true, kind: 'ghost', title: 'More', onClick: e => rowMenu(s, e.currentTarget) });
      tr.appendChild(h('td.bz-actions', [s.refund ? h('span.wb-badge.bad', { text: 'Refunded', title: 'Not counted in totals' }) : null, s.note ? h('span.bz-notedot', { text: '✎', title: s.note }) : null, menuBtn]));
      tr.addEventListener('contextmenu', e => { e.preventDefault(); rowMenu(s, e); });
      tr.addEventListener('keydown', e => {
        if (e.target !== tr) return;
        if (e.key === 'Delete') { e.preventDefault(); remove(s); }
        else if (e.key === 'Enter') { e.preventDefault(); edit(tr.querySelector('.c-gross'), s, 'gross'); }
        else if (e.key === 'ArrowDown' || e.key === 'ArrowUp') { const n = e.key === 'ArrowDown' ? tr.nextElementSibling : tr.previousElementSibling; if (n) { e.preventDefault(); n.focus(); } }
      });
      return tr;
    };
    const sorted = () => {
      const f = F(), fn = SORTS[f.sort] || SORTS.date, dir = f.dir === 'asc' ? 1 : -1;
      return rows.slice().sort((a, b) => dir * fn(a, b) || dir * SORTS.date(a, b));
    };
    const paintBody = () => {
      GK.clear(tbody); GK.clear(tfoot); GK.clear(more);
      const list = sorted();
      if (!list.length) {
        const f = F(), filtered = f.q || f.productId || f.channel || (f.period && f.period !== 'all') || (f.refunds && f.refunds !== 'all');
        tbody.appendChild(h('tr.bz-emptyrow', [h('td', { colSpan: COLS.length + 1 }, [U.empty({ icon: '≣', title: filtered ? 'No sales match' : 'No sales yet', text: filtered ? 'Try another period, product or channel.' : 'Type the first one in the row above and press Enter — or import a CSV from your shop.', actions: filtered ? [ui.button({ label: 'Clear filters', onClick: () => { setF({ q: '', productId: '', channel: '', period: 'all', refunds: 'all' }); paintFilters(); load(); } })] : [ui.button({ label: 'Import CSV', icon: '⇪', onClick: () => B.importWizard(S) })] })])]));
        return;
      }
      for (const s of list.slice(0, shown)) tbody.appendChild(rowEl(s));
      if (list.length > shown) more.appendChild(ui.button({ label: 'Show ' + Math.min(PAGE, list.length - shown) + ' more of ' + WB.fmt.num(list.length - shown), small: true, onClick: () => { shown += PAGE; paintBody(); } }));
      paintFootOnly();
      if (flash) { const el = tbody.querySelector('tr.flash'); if (el) setTimeout(() => el.classList.remove('flash'), 1400); flash = null; }
    };
    const load = async () => {
      if (editing) return;
      rows = await WB.api('business.sales', WB.worldId, filterOf(F()));
      paintHead(); paintBody();
    };

    /* ---------- inline editing ---------- */
    function edit(td, s, k) {
      if (editing) editing.commit();
      const old = s;
      let ctl, read;
      if (k === 'date') { ctl = B.dateInput({ value: s.date }); read = () => ctl.value || s.date; }
      else if (k === 'product') { ctl = B.select(s.productId || '', B.productOptions(products)); read = () => ctl.value || null; }
      else if (k === 'qty') { ctl = ui.input({ type: 'number', value: String(s.qty) }); ctl.min = '0'; read = () => (ctl.value === '' ? 1 : Math.max(0, Math.round(+ctl.value))); }
      else if (k === 'gross' || k === 'fees' || k === 'net') { ctl = B.moneyInput({ value: s[k] }); read = () => { const v = ctl.getCents(); return Number.isNaN(v) ? undefined : v == null ? 0 : v; }; }
      else if (k === 'channel') { ctl = B.channelInput({ value: s.channel }); read = () => ctl.value.trim(); }
      else { ctl = ui.input({ value: s[k] || '' }); read = () => ctl.value.trim(); }
      ctl.classList.add('bz-cellinput');
      GK.clear(td); td.appendChild(ctl); td.classList.add('editing');
      let done = false;
      const close = async (save) => {
        if (done) return; done = true; editing = null;
        const v = save ? read() : undefined;
        const key = k === 'product' ? 'productId' : k;
        const same = v === undefined || v === (k === 'product' ? (s.productId || null) : s[k]);
        if (!save || same) { td.classList.remove('editing'); GK.clear(td); td.appendChild(cell(old, k)); return; }
        S.busy++;
        try {
          const saved = await WB.api('business.saveSale', { id: s.id, [key]: v });
          const i = rows.findIndex(x => x.id === s.id);
          if (i >= 0) rows[i] = saved;
          const tr = td.closest('tr');
          if (tr && tr.isConnected) { const n = rowEl(saved); tr.replaceWith(n); }
          paintTotalsOnly();
        } catch (e) { WB.fail(e); td.classList.remove('editing'); GK.clear(td); td.appendChild(cell(old, k)); } finally { S.busy--; }
      };
      editing = { commit: () => close(true) };
      ctl.addEventListener('keydown', e => {
        if (e.key === 'Enter') { e.preventDefault(); ctl.dispatchEvent(new Event('change')); close(true).then(() => focusRow(s.id)); }
        else if (e.key === 'Escape') { e.preventDefault(); e.stopPropagation(); close(false).then(() => focusRow(s.id)); }
        else if (e.key === 'Tab') {
          e.preventDefault(); ctl.dispatchEvent(new Event('change'));
          const idx = COLS.findIndex(c => c[0] === k), next = COLS[(idx + (e.shiftKey ? -1 : 1) + COLS.length) % COLS.length][0];
          close(true).then(() => { const tr = tbody.querySelector('tr[data-id="' + s.id + '"]'); const r = rows.find(x => x.id === s.id); if (tr && r) edit(tr.querySelector('.c-' + next), r, next); });
        }
      });
      ctl.addEventListener('blur', () => setTimeout(() => { if (!done && document.activeElement !== ctl) close(true); }, 120));
      if (k === 'product' || k === 'date') ctl.addEventListener('change', () => close(true));
      setTimeout(() => { ctl.focus(); if (ctl.select && ctl.type !== 'date') ctl.select(); }, 10);
    }
    const focusRow = id => { const tr = tbody.querySelector('tr[data-id="' + id + '"]'); if (tr) tr.focus(); };
    const paintTotalsOnly = () => { const sc = tableBox.scrollTop; GK.clear(tfoot); paintFootOnly(); tableBox.scrollTop = sc; };
    const paintFootOnly = () => {
      const t = { count: 0, qty: 0, gross: 0, fees: 0, net: 0, rc: 0, rg: 0 };
      for (const s of rows) { if (s.refund) { t.rc++; t.rg += s.gross; continue; } t.count++; t.qty += s.qty; t.gross += s.gross; t.fees += s.fees; t.net += s.net; }
      tfoot.appendChild(h('tr', [
        h('td', { colSpan: 3 }, [h('b', { text: WB.fmt.plural(t.count, 'sale') }), t.rc ? h('span.gk-small.gk-muted', { text: ' · ' + WB.fmt.plural(t.rc, 'refund') + ' (' + B.money(t.rg) + ') not counted' }) : null]),
        h('td.num', { text: WB.fmt.num(t.qty) }), h('td.num', { text: B.money(t.gross) }), h('td.num', { text: B.money(t.fees) }), h('td.num', [h('b', { text: B.money(t.net) })]),
        h('td', { colSpan: 3 }),
      ]));
    };
    async function remove(s) {
      let rm = null;
      await mine(async () => { rm = await WB.api('business.removeSale', s.id); });
      if (rm) B.undoRemove('Sale of ' + B.money(s.gross) + ' on ' + WB.fmt.real(s.date) + ' deleted', rm);
    }
    /** our own change: apply it, then repaint at once (the change event that follows is ignored) */
    const mine = async fn => { S.busy++; try { await fn(); await load(); } catch (e) { WB.fail(e); } finally { S.busy--; } };
    function rowMenu(s, at) {
      U.menu([
        { label: s.refund ? 'Undo the refund' : 'Mark as refunded', icon: '↺', hint: 'Refunded sales stay in the ledger but leave the totals', onClick: () => mine(async () => { await WB.api('business.refund', s.id, !s.refund); flash = s.id; U.undoToast(s.refund ? 'Counted again' : 'Marked as refunded', () => WB.api('business.refund', s.id, !!s.refund)); }) },
        { label: 'Duplicate', icon: '⧉', hint: 'The same sale again, dated today', onClick: () => mine(async () => { const c = await WB.api('business.saveSale', Object.assign({}, s, { id: undefined, createdAt: undefined, worldId: WB.worldId, date: B.today(), refund: false })); flash = c.id; }) },
        { label: s.note ? 'Edit note…' : 'Add a note…', icon: '✎', onClick: async () => { const n = await ui.prompt('Note for this sale', s.note || '', 'e.g. signed copy, bundle with the maps'); if (n != null) await mine(() => WB.api('business.saveSale', { id: s.id, note: n })); } },
        s.productId && WB.liteOf(s.productId) ? { label: 'Open the product', icon: '↗', onClick: () => WB.open(s.productId) } : null,
        s.productId ? { label: 'Only this product', icon: '⌕', onClick: () => { setF({ productId: s.productId }); paintFilters(); load(); } } : null,
        s.buyer ? { label: 'Copy buyer', icon: '⎘', onClick: () => B.copy(s.buyer, 'the buyer') } : null,
        '-',
        { label: 'Delete', icon: '🗑', kbd: 'Del', danger: true, onClick: () => remove(s) },
      ], at);
    }

    paintFilters();
    box.append(
      ui.panel({ cls: 'bz-quickpanel', body: [quick] }),
      filters,
      ui.panel({ cls: 'bz-ledgerpanel', body: [tableBox, more] }),
    );
    await load();
    if (S.params && S.params.focus === 'add') setTimeout(() => B.focusQuickAdd(), 80);
    const onKey = e => {
      if (e.target.closest('input, textarea, select, [contenteditable="true"]') || e.ctrlKey || e.altKey || e.metaKey || document.querySelector('.gk-scrim')) return;
      if (e.key === 'n' || e.key === 'N') { e.preventDefault(); B.focusQuickAdd(); }
    };
    document.addEventListener('keydown', onKey);
    return {
      cleanup: () => { document.removeEventListener('keydown', onKey); if (B.focusQuickAdd && !quick.isConnected) B.focusQuickAdd = null; },
      refresh: async () => {
        if (editing) return;
        products = await WB.api('business.products', WB.worldId);
        const v = qProd.value; GK.clear(qProd); for (const [id, l] of B.productOptions(products)) qProd.appendChild(h('option', { value: id, text: l })); qProd.value = v;
        await load();
      },
    };
  };

  /* ---------------- CSV import wizard ---------------- */
  /** opts.file = { text, name } skips the first step */
  B.importWizard = function (S, opts0 = {}) {
    let text = '', name = '', opts = { hasHeader: undefined, dayFirst: undefined, channel: '', createProducts: true, mapping: null }, pv = null, busy = false;
    const body = h('div.bz-wiz');
    const foot = h('div.gk-panel-foot');
    const panel = ui.panel({ title: 'Import sales from a CSV file', icon: '⇪', cls: 'gk-dialog bz-wizard', body: [body] });
    panel.appendChild(foot);
    const scrim = h('div.gk-scrim', { onclick: e => { if (e.target === scrim) close(); } }, [panel]);
    const onKey = e => { if (e.key === 'Escape') { e.stopPropagation(); close(); } };
    const close = () => { scrim.remove(); document.removeEventListener('keydown', onKey, true); };
    document.addEventListener('keydown', onKey, true);
    document.body.appendChild(scrim);

    const take = (t, n) => { text = String(t || ''); name = n || 'pasted rows'; opts.mapping = null; opts.hasHeader = undefined; opts.dayFirst = undefined; step2(); };
    function step1() {
      GK.clear(body); GK.clear(foot);
      const paste = ui.input({ multiline: true, rows: 6, placeholder: 'Date, Product, Quantity, Gross, Fees …\n2026-03-01, The Salt Heir, 1, 12.99, 1.30' });
      paste.classList.add('bz-paste');
      const drop = h('div.bz-drop', { tabindex: 0 }, [
        h('div.bz-drop-ico', { text: '⇪' }),
        h('b', { text: 'Drop a CSV file here' }),
        h('div.gk-small.gk-muted', { text: 'Exports from shops, payment services and spreadsheets work: comma, semicolon or tab separated, any date style, amounts like 12.99, 12,99 or $1,299.00.' }),
        h('div.gk-row', [ui.button({ label: 'Choose a file…', icon: '▤', kind: 'primary', onClick: async () => { const f = await WB.api('business.openCsv').catch(WB.fail); if (f) take(f.text, f.name); } })]),
      ]);
      drop.addEventListener('dragover', e => { if ([...e.dataTransfer.types].includes('Files')) { e.preventDefault(); drop.classList.add('wb-drop'); } });
      drop.addEventListener('dragleave', () => drop.classList.remove('wb-drop'));
      drop.addEventListener('drop', async e => { drop.classList.remove('wb-drop'); const f = e.dataTransfer.files[0]; if (f) { e.preventDefault(); take(await f.text(), f.name); } });
      body.append(drop, ui.field({ label: 'Or paste rows', control: paste }));
      foot.append(h('span.gk-grow'), ui.button({ label: 'Cancel', onClick: close }), ui.button({ label: 'Next', kind: 'primary', onClick: () => { if (paste.value.trim()) take(paste.value, 'pasted rows'); else paste.focus(); } }));
    }
    const preview = WB.debounce(async () => {
      try { pv = await WB.api('business.csvPreview', WB.worldId, text, { mapping: opts.mapping, hasHeader: opts.hasHeader, dayFirst: opts.dayFirst, channel: opts.channel }); }
      catch (e) { WB.fail(e); step1(); return; }
      opts.mapping = pv.mapping; opts.hasHeader = pv.hasHeader; opts.dayFirst = pv.dayFirst;
      paint2();
    }, 120);
    function step2() { GK.clear(body); body.appendChild(h('div.gk-muted.gk-small', { text: 'Reading ' + name + '…' })); preview(); }
    function paint2() {
      GK.clear(body); GK.clear(foot);
      const colOpts = [['-1', '—']].concat(pv.headers.map((hd, i) => [String(i), hd + (pv.rows[0] && pv.rows[0][i] ? '  ·  ' + String(pv.rows[0][i]).slice(0, 24) : '')]));
      const map = h('div.bz-map', pv.fields.map(([k, label, hint]) => {
        const sel = B.select(String(pv.mapping[k] == null ? -1 : pv.mapping[k]), colOpts, v => { opts.mapping = Object.assign({}, opts.mapping, { [k]: +v }); preview(); });
        return h('label.bz-map-row', { class: pv.mapping[k] >= 0 ? 'set' : '', title: hint }, [h('span.bz-map-lbl', [h('b', { text: label }), hint ? h('span.gk-tiny.gk-faint', { text: hint }) : null]), sel]);
      }));
      const options = h('div.bz-wiz-opts', [
        ui.field({ label: 'First row has column names', inline: true, control: ui.toggle({ value: !!pv.hasHeader, onChange: v => { opts.hasHeader = v; opts.mapping = null; preview(); } }) }),
        ui.field({ label: 'Dates are day / month / year', hint: 'Detected from the file; switch if 03/04 should be 4 March', inline: true, control: ui.toggle({ value: !!pv.dayFirst, onChange: v => { opts.dayFirst = v; preview(); } }) }),
        ui.field({ label: 'Create products that don’t exist yet', hint: pv.products.unknown.length ? 'New: ' + pv.products.unknown.slice(0, 4).join(', ') + (pv.products.unknown.length > 4 ? ' …' : '') : 'Every product name matches an entry', inline: true, control: ui.toggle({ value: opts.createProducts, onChange: v => { opts.createProducts = v; } }) }),
        ui.field({ label: 'Channel when the file has none', control: B.channelInput({ value: opts.channel, placeholder: 'e.g. Itch', onChange: v => { opts.channel = v; preview(); } }) }),
      ]);
      const sample = h('table.bz-ledger.bz-sample', [
        h('thead', [h('tr', ['Row', 'Date', 'Product', 'Qty', 'Gross', 'Fees', 'Net', 'Channel', 'Buyer'].map((t, i) => h('th', { text: t, class: i >= 3 && i <= 6 ? 'num' : '' })))]),
        h('tbody', pv.sample.length ? pv.sample.map(d => h('tr', { class: d.refund ? 'refund' : '' }, [
          h('td.gk-faint', { text: String(d.row) }), h('td', { text: WB.fmt.real(d.date) }),
          h('td', [d.productId ? B.productChip(d.productId) : d.productName ? h('span', [h('span', { text: d.productName + ' ' }), h('span.wb-badge.' + (opts.createProducts ? 'good' : 'warn'), { text: opts.createProducts ? 'new' : 'no match' })]) : h('span.gk-faint', { text: '—' })]),
          h('td.num', { text: String(d.qty) }), h('td.num', { text: B.money(d.gross, d.currency || undefined) }), h('td.num', { text: B.money(d.fees, d.currency || undefined) }), h('td.num', [h('b', { text: B.money(d.net, d.currency || undefined) })]),
          h('td', { text: d.channel }), h('td.gk-ellipsis', { text: d.buyer }),
        ])) : [h('tr', [h('td', { colSpan: 9 }, [h('span.gk-muted', { text: 'No rows can be read with this mapping yet — pick the Date and Gross (or Net) columns.' })])])]),
      ]);
      const probs = pv.problemCount ? h('div.bz-probs.gk-small', [h('b', { text: WB.fmt.plural(pv.problemCount, 'row') + ' will be skipped: ' }), pv.problems.slice(0, 4).map(p => 'row ' + p.row + ' — ' + p.msg).join('; ') + (pv.problemCount > 4 ? ' …' : '')]) : null;
      GK.append(body, [
        h('div.bz-wiz-head.gk-small.gk-muted', { text: name + ' · ' + WB.fmt.plural(pv.total, 'row') + ' · separator “' + (pv.delimiter === '\t' ? 'tab' : pv.delimiter) + '”' }),
        h('div.bz-wiz-cols', [h('div', [h('h4.bz-h4', { text: 'Which column is which' }), map]), h('div', [h('h4.bz-h4', { text: 'Options' }), options])]),
        h('h4.bz-h4', { text: 'Preview' }), h('div.bz-tablebox.short', [sample]), probs,
      ]);
      foot.append(ui.button({ label: 'Back', onClick: step1 }), h('span.gk-small.gk-muted.gk-grow', { text: 'Rows already in the ledger (same date, product, amount, buyer) are skipped.' }), ui.button({ label: 'Cancel', onClick: close }),
        ui.button({ label: pv.ok ? 'Import ' + WB.fmt.plural(pv.ok, 'sale') : 'Nothing to import', kind: 'primary', disabled: !pv.ok, onClick: run }));
    }
    async function run() {
      if (busy) return; busy = true;
      try {
        const r = await WB.api('business.csvImport', WB.worldId, text, { mapping: opts.mapping, hasHeader: opts.hasHeader, dayFirst: opts.dayFirst, channel: opts.channel, createProducts: opts.createProducts });
        close();
        const msg = 'Imported ' + WB.fmt.plural(r.added, 'sale') + (r.skipped ? ' · ' + r.skipped + ' already there' : '') + (r.createdProducts.length ? ' · ' + WB.fmt.plural(r.createdProducts.length, 'new product') : '') + (r.problemCount ? ' · ' + r.problemCount + ' unreadable' : '');
        U.undoToast(msg, async () => {
          const rm = await WB.api('business.removeSales', r.ids);
          for (const id of r.createdProducts) await WB.api('entries.trash', id).catch(() => null);
          return rm;
        }, 9000);
        if (S && S.st.get().tab !== 'sales') S.go('sales');
      } catch (e) { WB.fail(e); } finally { busy = false; }
    }
    if (opts0.file) take(opts0.file.text, opts0.file.name); else step1();
  };
})();
