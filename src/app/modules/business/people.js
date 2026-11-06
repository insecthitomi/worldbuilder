/* Business → Products, Supporters & tiers, Coupons, Reviews. */
(function () {
  'use strict';
  const { h, ui } = GK, U = WB.ui, B = WB.biz;
  const SVG = 'http://www.w3.org/2000/svg';
  const pfield = key => { const t = WB.type('product'); return t ? (t.fields || []).find(f => f.key === key) : null; };
  const opts = key => { const f = pfield(key); return f && f.options ? f.options : []; };
  const STATUS_TONE = { Available: 'good', 'In production': 'warn', Planned: '', 'Sold out': 'bad', Retired: '' };

  /** an always-editable cell that reads as plain text until hovered or focused */
  const cellInput = (value, onSave, { placeholder = '', type = 'text', title } = {}) => {
    const i = h('input.bz-cell-in', { type, placeholder, title: title || null, spellcheck: false });
    i.value = value == null ? '' : value;
    let was = i.value;
    i.addEventListener('change', () => { if (i.value !== was) { was = i.value; onSave(i.value); } });
    i.addEventListener('keydown', e => { if (e.key === 'Enter') { e.preventDefault(); i.blur(); } else if (e.key === 'Escape') { i.value = was; i.blur(); } });
    return i;
  };
  const cellSelect = (value, options, onSave) => { const s = h('select.bz-cell-in', { onchange: () => onSave(s.value) }, options.map(([v, l]) => h('option', { value: v, text: l }))); s.value = value == null ? '' : value; return s; };

  function sparkline(values) {
    const max = Math.max(1, ...values), w = 120, hh = 28;
    const pts = values.map((v, i) => [i * (w / Math.max(1, values.length - 1)), hh - 2 - (v / max) * (hh - 4)]);
    const svg = document.createElementNS(SVG, 'svg');
    svg.setAttribute('viewBox', '0 0 ' + w + ' ' + hh); svg.setAttribute('preserveAspectRatio', 'none'); svg.setAttribute('class', 'bz-spark'); svg.setAttribute('aria-hidden', 'true');
    const area = document.createElementNS(SVG, 'path');
    area.setAttribute('d', 'M0,' + hh + ' L' + pts.map(p => p.join(',')).join(' L') + ' L' + w + ',' + hh + ' Z'); area.setAttribute('class', 'bz-spark-area');
    const line = document.createElementNS(SVG, 'polyline');
    line.setAttribute('points', pts.map(p => p.join(',')).join(' ')); line.setAttribute('class', 'bz-spark-line'); line.setAttribute('vector-effect', 'non-scaling-stroke');
    svg.append(area, line);
    return svg;
  }

  /* ================= Products ================= */
  B.newProduct = async S => {
    const t = WB.type('product');
    const e = await U.createDialog({ type: 'product', open: false, types: t ? [t.id] : null });
    if (e) { ui.toast('“' + e.title + '” is in your shop — set its price and status here', '¤', 4000); if (S) S.refresh(); }
    return e;
  };
  B.views.products = async function (box, S) {
    const st = S.st;
    let list = await WB.api('business.products', WB.worldId);
    let q = '';
    const grid = h('div.bz-prodgrid');
    const sortBy = { revenue: (a, b) => b.sales.net - a.sales.net, name: (a, b) => a.title.localeCompare(b.title), last: (a, b) => String(b.sales.last || '').localeCompare(String(a.sales.last || '')), rating: (a, b) => ((b.rating && b.rating.avg) || 0) - ((a.rating && a.rating.avg) || 0) };
    const save = async (p, patch) => { S.busy++; try { await WB.api('entries.update', p.id, { fieldsPatch: patch }); Object.assign(p, Object.fromEntries(Object.entries(patch))); } catch (e) { WB.fail(e); } finally { S.busy--; } };
    const card = p => {
      const lite = WB.liteOf(p.id) || { id: p.id, title: p.title, typeId: (WB.type('product') || {}).id };
      const price = B.moneyInput({ value: p.price, placeholder: 'Price', title: 'List price', onChange: v => save(p, { price: v }) });
      price.classList.add('bz-price-in');
      const status = B.select(p.status || '', [['', 'No status']].concat(opts('status').map(o => [o, o])), v => save(p, { status: v }).then(paint));
      const format = B.select(p.format || '', [['', 'Format…']].concat(opts('format').map(o => [o, o])), v => save(p, { format: v }));
      const link = ui.input({ type: 'url', value: p.link || '', placeholder: 'https://…', onChange: v => { const u = v.trim(); if (u && !/^https?:[/]{2}/i.test(u)) { link.classList.add('bad'); link.title = 'Start with https://'; return; } link.classList.remove('bad'); save(p, { link: u }).then(paint); } });
      const tone = STATUS_TONE[p.status];
      return h('div.gk-widget.bz-prod', { dataset: { id: p.id } }, [
        h('div.bz-prod-head', [
          p.coverId ? h('div.bz-prod-cover', [U.thumb(p.coverId)]) : h('div.bz-prod-ico', { text: WB.iconOf(lite), style: { '--c': WB.colorOf(lite) } }),
          h('div.bz-prod-title', [
            h('div.bz-prod-name', [U.chip(lite)]),
            h('div.gk-small.gk-muted.bz-prod-meta', { text: [p.format, p.released ? 'released ' + WB.fmt.real(p.released) : '', p.audience === 'private' ? 'private entry' : ''].filter(Boolean).join(' · ') || 'Product' }),
          ]),
          p.status ? h('span.wb-badge', { class: tone || '', text: p.status }) : null,
        ]),
        h('div.bz-prod-stats', [
          h('div', [h('div.gk-tiny.gk-muted', { text: 'Net revenue' }), h('b.bz-prod-big', { text: B.money(p.sales.net) })]),
          h('div', [h('div.gk-tiny.gk-muted', { text: 'Sales' }), h('b', { text: WB.fmt.num(p.sales.count) }), h('span.gk-tiny.gk-muted', { text: ' · ' + WB.fmt.plural(p.sales.qty, 'unit') })]),
          h('div', [h('div.gk-tiny.gk-muted', { text: 'Last sale' }), h('span.gk-small', { text: p.sales.last ? B.relDay(p.sales.last) : '—', title: p.sales.last ? WB.fmt.real(p.sales.last) : '' })]),
        ]),
        h('div.bz-prod-trend', { title: 'Net revenue over the last 12 months' }, [sparkline(p.trend), h('span.gk-tiny.gk-muted', { text: p.sales.net30 ? B.money(p.sales.net30) + ' in 30 days' : '12 months' })]),
        p.rating ? h('div.bz-prod-rating.gk-small', [B.stars(p.rating.avg), h('span.gk-muted', { text: ' ' + p.rating.avg + ' · ' + WB.fmt.plural(p.rating.n, 'review') + (p.rating.featured ? ' · ' + p.rating.featured + ' featured' : '') })]) : null,
        p.sales.refunds ? h('div.gk-tiny.gk-muted', { text: '↺ ' + WB.fmt.plural(p.sales.refunds, 'refund') }) : null,
        h('div.bz-prod-edit', [ui.field({ label: 'Price', control: price }), ui.field({ label: 'Status', control: status }), ui.field({ label: 'Format', control: format }), h('div.bz-prod-link', [ui.field({ label: 'Buy link', control: link })])]),
        h('div.bz-prod-foot', [
          ui.button({ label: 'Log a sale', icon: '＋', small: true, onClick: async () => { S.st.patch({ last: Object.assign({}, S.st.get().last, { productId: p.id }) }); await S.go('sales'); B.focusQuickAdd && B.focusQuickAdd(); } }),
          ui.button({ label: 'Sales', small: true, kind: 'ghost', title: 'This product’s sales in the ledger', onClick: () => S.go('sales', { sales: { productId: p.id, period: 'all' } }) }),
          h('span.gk-grow'),
          p.link ? ui.button({ icon: '↗', small: true, kind: 'ghost', title: 'Open the buy link: ' + p.link, onClick: () => GK.host('shell:url', p.link) }) : null,
          ui.button({ label: 'Open', small: true, kind: 'ghost', title: 'Open in the Codex (blurb, cover, buy link and more)', onClick: () => WB.open(p.id) }),
        ]),
      ]);
    };
    const paint = () => {
      GK.clear(grid);
      const f = q.toLowerCase();
      const shown = list.filter(p => WB.visible(WB.liteOf(p.id) || { audience: p.audience }) && (!f || p.title.toLowerCase().includes(f) || (p.format || '').toLowerCase().includes(f))).sort(sortBy[st.get().products.sort] || sortBy.revenue);
      if (!list.length) {
        grid.appendChild(U.empty({ icon: '¤', title: 'No products yet', text: 'A product is an entry like any other — a novel, a map pack, an adventure module, a membership. Give it a price and a status here; its blurb, cover and buy link live in the Codex and go to your published shop.', actions: [ui.button({ label: 'New product', icon: '＋', kind: 'primary', onClick: () => B.newProduct(S) })] }));
        return;
      }
      if (!shown.length) { grid.appendChild(h('div.gk-muted.bz-none', { text: 'No product matches “' + q + '”.' })); return; }
      for (const p of shown) grid.appendChild(card(p));
    };
    const total = list.reduce((a, p) => a + p.sales.net, 0);
    box.append(
      h('div.bz-filters', [
        U.search({ placeholder: 'Find a product', onInput: v => { q = v; paint(); } }),
        B.select(st.get().products.sort, [['revenue', 'Most revenue'], ['last', 'Latest sale'], ['rating', 'Best rated'], ['name', 'Name']], v => { st.patch({ products: { sort: v } }); paint(); }),
        h('span.gk-small.gk-muted', { text: list.length ? WB.fmt.plural(list.length, 'product') + ' · ' + B.money(total) + ' net all time' : '' }),
        h('span.gk-grow'),
        ui.button({ label: 'New product', icon: '＋', kind: 'primary', small: true, onClick: () => B.newProduct(S) }),
      ]),
      grid,
    );
    paint();
    return { refresh: async () => { if (box.contains(document.activeElement) && document.activeElement.matches('input, select')) return; list = await WB.api('business.products', WB.worldId); paint(); } };
  };

  /* ================= Supporters & tiers ================= */
  const TIER_COLORS = ['#6fa7d8', '#4fae7d', '#d2a35a', '#e06aa8', '#8f7ad8', '#e0796b', '#4fb6b2', '#c49a3c'];
  B.editTier = async (t, worldTiers) => {
    const v = await B.form({ title: t ? 'Edit “' + t.name + '”' : 'New tier', icon: '♥', ok: t ? 'Save' : 'Add tier', fields: [
      { key: 'name', label: 'Name', value: t ? t.name : '', placeholder: 'e.g. Navigator', required: true },
      { key: 'price', label: 'Price', kind: 'money', value: t ? t.price : null, placeholder: '5.00' },
      { key: 'period', label: 'Billed', kind: 'seg', value: t ? t.period : 'month', options: [['month', 'Monthly'], ['year', 'Yearly']] },
      { key: 'color', label: 'Colour', kind: 'select', value: t ? t.color : TIER_COLORS[(worldTiers || []).length % TIER_COLORS.length], options: TIER_COLORS.map((c, i) => [c, ['Sea blue', 'Kelp green', 'Brass', 'Coral', 'Twilight', 'Rust', 'Teal', 'Gold'][i]]) },
      { key: 'perks', label: 'Perks', kind: 'textarea', value: t ? t.perks : '', placeholder: 'One per line', wide: true, rows: 4 },
    ] });
    if (!v) return null;
    return WB.api('business.saveTier', Object.assign({ worldId: WB.worldId }, t ? { id: t.id } : {}, v));
  };
  B.views.people = async function (box, S) {
    const st = S.st, P = () => st.get().people || {};
    let tiers = [], sups = [], rec = null;
    const load = async () => { [tiers, sups, rec] = await Promise.all([WB.api('business.tiers', WB.worldId), WB.api('business.supporters', WB.worldId), WB.api('business.recurring', WB.worldId)]); };
    await load();
    const left = h('div.bz-tiers'), right = h('div.bz-sups');
    const tierOf = id => tiers.find(t => t.id === id) || null;
    const monthly = t => (t ? (t.period === 'year' ? Math.round(t.price / 12) : t.price) : 0);

    const paintTiers = () => {
      GK.clear(left);
      const byTier = new Map((rec.byTier || []).map(r => [r.tierId, r]));
      const cards = tiers.map(t => {
        const r = byTier.get(t.id) || { active: 0, mrr: 0, paused: 0 };
        return h('div.gk-widget.interactive.bz-tier', { style: { '--c': t.color || 'var(--accent)' }, tabindex: 0, title: 'Edit the tier', onclick: async e => { if (e.target.closest('button')) return; if (await B.editTier(t, tiers)) ui.toast('Tier saved', '♥'); } }, [
          h('div.bz-tier-head', [h('b.gk-ellipsis', { text: t.name }), h('span.bz-tier-price', [h('b', { text: B.money(t.price, t.currency || undefined) }), h('span.gk-tiny.gk-muted', { text: t.period === 'year' ? ' / year' : ' / month' })]),
            ui.button({ icon: '⋯', small: true, kind: 'ghost', title: 'More', onClick: e => U.menu([
              { label: 'Edit', icon: '✎', onClick: () => B.editTier(t, tiers) },
              { label: 'Show its supporters', icon: '⌕', onClick: () => { st.patch({ people: Object.assign({}, P(), { tierId: t.id }) }); paintSups(); } },
              '-',
              { label: 'Delete tier', icon: '🗑', danger: true, hint: 'Its supporters keep their pledge history and show “No tier”', onClick: async () => { const rm = await WB.api('business.removeTier', t.id); B.undoRemove('Tier “' + t.name + '” deleted', rm); } },
            ], e.currentTarget) })]),
          h('div.gk-small.gk-muted', { text: WB.fmt.plural(r.active, 'active supporter') + (r.paused ? ' · ' + r.paused + ' paused' : '') + ' · ' + B.money(r.mrr) + ' a month' }),
          t.perks ? h('div.bz-perks.gk-small', t.perks.split('\n').filter(Boolean).slice(0, 4).map(x => h('div', { text: '· ' + x }))) : null,
        ]);
      });
      left.append(
        ui.panel({ title: 'Tiers', icon: '♥', cls: 'bz-tierpanel', actions: [ui.button({ label: 'Add tier', icon: '＋', small: true, onClick: async () => { if (await B.editTier(null, tiers)) ui.toast('Tier added', '♥'); } })], body: [
          h('div.bz-mrr', [h('b', { text: B.money(rec.mrr) }), h('span.gk-muted', { text: ' a month' })]),
          h('div.gk-small.gk-muted', { text: [rec.counts.active + ' active', rec.counts.paused + ' paused', rec.counts.ended + ' ended'].join(' · ') + (rec.newThisMonth ? ' · +' + rec.newThisMonth + ' in 30 days' : '') }),
          cards.length ? h('div.bz-tierlist2', cards) : U.empty({ icon: '♥', title: 'No tiers yet', text: 'Tiers are what supporters pay each month — with their perks. Add one, then add the people who back you.', actions: [ui.button({ label: 'Add a tier', kind: 'primary', onClick: () => B.editTier(null, tiers) })] }),
        ] }),
      );
    };

    const paintSups = () => {
      GK.clear(right);
      const f = P(), qq = (f.q || '').toLowerCase();
      const counts = { all: sups.length, active: 0, paused: 0, ended: 0 };
      for (const s of sups) counts[s.status]++;
      const shown = sups.filter(s => (!f.status || s.status === f.status) && (!f.tierId || (f.tierId === 'none' ? !s.tierId : s.tierId === f.tierId)) && (!qq || (s.name + ' ' + s.email + ' ' + s.note + ' ' + s.channel).toLowerCase().includes(qq)));
      const tierOpts = [['', 'No tier']].concat(tiers.map(t => [t.id, t.name + ' · ' + B.money(t.price)]));
      const save = async (s, patch) => { S.busy++; try { const r = await WB.api('business.saveSupporter', Object.assign({ id: s.id }, patch)); Object.assign(s, r); rec = await WB.api('business.recurring', WB.worldId); paintTiers(); } catch (e) { WB.fail(e); } finally { S.busy--; } };
      // quick add
      const nName = ui.input({ placeholder: 'Name' }), nEmail = ui.input({ placeholder: 'E-mail (optional)' });
      const nTier = B.select(f.tierId && f.tierId !== 'none' ? f.tierId : (tiers[0] ? tiers[0].id : ''), tierOpts, null);
      const nSince = B.dateInput({ value: B.today(), title: 'Supporting since' });
      const nChan = B.channelInput({ placeholder: 'Where (optional)' });
      const add = async () => {
        if (!nName.value.trim()) { nName.focus(); return; }
        S.busy++;
        try {
          const r = await WB.api('business.saveSupporter', { worldId: WB.worldId, name: nName.value.trim(), email: nEmail.value.trim(), tierId: nTier.value || null, since: nSince.value || B.today(), channel: nChan.value.trim() });
          sups.unshift(r); rec = await WB.api('business.recurring', WB.worldId);
          ui.toast('Welcome aboard, ' + r.name, '♥', 1800);
          paintTiers(); paintSups();
          right.querySelector('.bz-addsup input').focus();
        } catch (e) { WB.fail(e); } finally { S.busy--; }
      };
      const addRow = h('div.bz-addsup', [nName, nEmail, nTier, nSince, nChan, ui.button({ label: 'Add', icon: '＋', kind: 'primary', small: true, onClick: add })]);
      addRow.addEventListener('keydown', e => { if (e.key === 'Enter' && e.target.matches('input, select')) { e.preventDefault(); add(); } });
      const lazyDate = (value, onSave, label) => {
        if (value) return cellInput(value, onSave, { type: 'date' });
        const b = h('button.bz-cell-in.bz-lazy', { type: 'button', text: '—', title: 'Set ' + label });
        b.addEventListener('click', () => { const i = cellInput('', onSave, { type: 'date' }); b.replaceWith(i); i.focus(); try { i.showPicker(); } catch { } });
        return b;
      };
      const table = h('table.bz-ledger.bz-suptable', [
        h('thead', [h('tr', ['Supporter', 'Tier', 'Pledge', 'Status', 'Since', 'Until', 'Where · note', ''].map((t, i) => h('th', { text: t, class: i === 2 ? 'num' : '' })))]),
        h('tbody', shown.length ? shown.map(s => {
          const t = tierOf(s.tierId);
          const pledge = B.moneyInput({ value: s.pledge, placeholder: t ? B.plain(monthly(t)) : '—', title: 'Monthly pledge — leave empty to use the tier’s price', onChange: v => save(s, { pledge: v }) });
          pledge.className = 'bz-cell-in num';
          return h('tr', { class: 'st-' + s.status }, [
            h('td.bz-who', [cellInput(s.name, v => save(s, { name: v }), { placeholder: 'Name' }), (() => { const e = cellInput(s.email, v => save(s, { email: v }), { placeholder: 'add e-mail', type: 'email' }); e.classList.add('bz-email'); return e; })()]),
            h('td', [h('span.bz-tiercell', { style: { '--c': (t && t.color) || 'var(--faint)' } }, [cellSelect(s.tierId || '', tierOpts, v => save(s, { tierId: v || null }).then(paintSups))])]),
            h('td.num', [pledge]),
            h('td', [h('span.bz-status.st-' + s.status, [cellSelect(s.status, [['active', 'Active'], ['paused', 'Paused'], ['ended', 'Ended']], v => save(s, { status: v }).then(paintSups))])]),
            h('td', [lazyDate(s.since || '', v => save(s, { since: v || null }), 'since when')]),
            h('td', [lazyDate(s.until || '', v => save(s, { until: v || null }), 'an end date')]),
            h('td.bz-who.bz-where', [cellInput(s.channel, v => save(s, { channel: v }), { placeholder: 'where they joined' }), (() => { const n = cellInput(s.note, v => save(s, { note: v }), { placeholder: 'add a note' }); n.classList.add('bz-email'); n.title = s.note || ''; return n; })()]),
            h('td.bz-actions', [ui.button({ icon: '⋯', small: true, kind: 'ghost', title: 'More', onClick: e => U.menu([
              s.email ? { label: 'Copy e-mail', icon: '⎘', onClick: () => B.copy(s.email, 'the e-mail') } : null,
              { label: s.status === 'ended' ? 'Welcome back (active)' : 'End the membership', icon: s.status === 'ended' ? '↺' : '⏹', onClick: () => save(s, { status: s.status === 'ended' ? 'active' : 'ended' }).then(paintSups) },
              '-',
              { label: 'Delete', icon: '🗑', danger: true, onClick: async () => { const rm = await WB.api('business.removeSupporter', s.id); B.undoRemove('“' + s.name + '” removed', rm); } },
            ], e.currentTarget) })]),
          ]);
        }) : [h('tr.bz-emptyrow', [h('td', { colSpan: 8 }, [h('div.gk-muted.gk-small.bz-none', { text: sups.length ? 'Nobody matches these filters.' : 'No supporters yet — add the first one above.' })])])]),
      ]);
      const emails = shown.map(s => s.email).filter(Boolean);
      right.append(ui.panel({ title: 'Supporters', icon: '☺', cls: 'bz-suppanel', actions: [emails.length ? ui.button({ label: 'Copy e-mails', icon: '⎘', small: true, kind: 'ghost', title: 'Copy the e-mail addresses shown (for your newsletter tool)', onClick: () => B.copy(emails.join(', '), emails.length + ' e-mail addresses') }) : null], body: [
        h('div.bz-filters.tight', [
          ui.segmented({ value: f.status || '', options: [['', 'All ' + counts.all], ['active', 'Active ' + counts.active], ['paused', 'Paused ' + counts.paused], ['ended', 'Ended ' + counts.ended]], onChange: v => { st.patch({ people: Object.assign({}, P(), { status: v }) }); paintSups(); } }),
          B.select(f.tierId || '', [['', 'Every tier'], ['none', 'No tier']].concat(tiers.map(t => [t.id, t.name])), v => { st.patch({ people: Object.assign({}, P(), { tierId: v }) }); paintSups(); }),
          U.search({ placeholder: 'Name, e-mail, note', value: f.q || '', onInput: WB.debounce(v => { st.patch({ people: Object.assign({}, P(), { q: v }) }); paintSups(); const s = right.querySelector('.wb-search-input'); if (s) { s.focus(); s.setSelectionRange(s.value.length, s.value.length); } }, 250) }),
        ]),
        addRow,
        h('div.bz-tablebox', [table]),
      ] }));
    };
    box.appendChild(h('div.bz-people', [left, right]));
    paintTiers(); paintSups();
    return { refresh: async () => { if (box.contains(document.activeElement) && document.activeElement.matches('input, select, textarea')) return; await load(); paintTiers(); paintSups(); } };
  };

  /* ================= Coupons ================= */
  const STATUS = { live: ['Live', 'good'], expired: ['Expired', 'warn'], used: ['Used up', 'warn'], off: ['Off', ''] };
  const randomCode = () => { const A = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789'; let s = ''; for (let i = 0; i < 6; i++) s += A[Math.floor(Math.random() * A.length)]; return s; };
  B.editCoupon = async (c, products) => {
    const v = await B.form({ title: c ? 'Edit ' + c.code : 'New coupon', icon: '✂', ok: c ? 'Save' : 'Create coupon', fields: [
      { key: 'code', label: 'Code', value: c ? c.code : randomCode(), required: true, hint: 'Letters and digits; buyers type it at checkout' },
      { key: 'percentOff', label: 'Percent off', kind: 'number', value: c ? c.percentOff : null, placeholder: 'e.g. 20' },
      { key: 'amountOff', label: 'Or an amount off', kind: 'money', value: c ? c.amountOff : null, placeholder: 'e.g. 2.00' },
      { key: 'productId', label: 'Product', kind: 'select', value: c ? c.productId || '' : '', options: B.productOptions(products, 'Any product') },
      { key: 'channel', label: 'Where it works', kind: 'channel', value: c ? c.channel : '', placeholder: 'Any channel' },
      { key: 'expires', label: 'Expires', kind: 'date', value: c ? c.expires : null, hint: 'Empty = never' },
      { key: 'maxUses', label: 'Uses allowed', kind: 'number', value: c ? c.maxUses : null, placeholder: 'Unlimited' },
      { key: 'uses', label: 'Used outside the ledger', kind: 'number', value: c ? c.uses : 0, hint: 'Sales with this code in the ledger count by themselves' },
      { key: 'note', label: 'Note', kind: 'textarea', value: c ? c.note : '', wide: true, rows: 2, placeholder: 'Where you shared it, who it is for' },
    ] });
    if (!v) return null;
    if (!v.percentOff && !v.amountOff) { ui.toast('Give the coupon a percent or an amount off', '✂'); return B.editCoupon(Object.assign({}, c || {}, v, { code: v.code }), products); }
    v.productId = v.productId || null;
    return WB.api('business.saveCoupon', Object.assign({ worldId: WB.worldId }, c ? { id: c.id } : {}, v)).catch(WB.fail);
  };
  B.views.coupons = async function (box, S) {
    let [list, products] = await Promise.all([WB.api('business.coupons', WB.worldId), WB.api('business.products', WB.worldId)]);
    let filter = '';
    const grid = h('div.bz-coupons');
    const discount = c => [c.percentOff ? Math.round(c.percentOff * 10) / 10 + '% off' : '', c.amountOff ? B.money(c.amountOff) + ' off' : ''].filter(Boolean).join(' + ') || 'No discount set';
    const card = c => {
      const [label, tone] = STATUS[c.status] || STATUS.live;
      const rel = c.expires ? B.relDay(c.expires) : '', abs = c.expires ? WB.fmt.real(c.expires) : '';
      const exp = c.expires ? (c.status === 'expired' ? 'Expired ' : 'Until ') + abs + (rel !== abs ? ' (' + rel + ')' : '') : 'Never expires';
      return h('div.gk-widget.bz-coupon', { class: 'st-' + c.status }, [
        h('div.bz-coupon-head', [
          h('button.bz-code.big', { type: 'button', title: 'Copy the code', onclick: () => B.copy(c.code, c.code) }, [c.code, h('span.bz-copy', { text: '⎘' })]),
          h('span.gk-grow'),
          h('span.wb-badge', { class: tone, text: label }),
          ui.toggle({ value: c.active, title: c.active ? 'Switch the coupon off' : 'Switch the coupon on', onChange: async v => { await WB.api('business.saveCoupon', { id: c.id, active: v }); } }),
        ]),
        h('div.bz-coupon-off', { text: discount(c) }),
        h('div.bz-coupon-what.gk-small', [c.productId ? B.productChip(c.productId, c.productTitle) : h('span.gk-muted', { text: 'Any product' }), c.channel ? h('span.gk-muted', { text: ' · ' + c.channel }) : null]),
        h('div.gk-small.gk-muted', { text: exp }),
        h('div.bz-coupon-uses', [
          h('div.gk-small', [h('b', { text: String(c.used) }), h('span.gk-muted', { text: c.maxUses ? ' of ' + c.maxUses + ' uses' : ' uses' })]),
          c.maxUses ? h('div.bz-meter.thin', [h('i.sales', { style: { width: Math.min(100, c.used / c.maxUses * 100) + '%' } })]) : null,
          c.ledgerUses ? h('div.gk-tiny.gk-muted', { text: WB.fmt.plural(c.ledgerUses, 'sale') + ' in the ledger · ' + B.money(c.ledgerGross) + ' gross', title: 'Sales with this code' }) : null,
        ]),
        c.note ? h('div.bz-coupon-note.gk-small', { text: c.note }) : null,
        h('div.bz-prod-foot', [
          ui.button({ label: 'Edit', icon: '✎', small: true, kind: 'ghost', onClick: () => B.editCoupon(c, products) }),
          c.ledgerUses ? ui.button({ label: 'Its sales', small: true, kind: 'ghost', onClick: () => S.go('sales', { sales: { q: c.code, period: 'all', productId: '', channel: '' } }) }) : null,
          h('span.gk-grow'),
          ui.button({ icon: '🗑', small: true, kind: 'ghost', title: 'Delete the coupon', onClick: async () => { const rm = await WB.api('business.removeCoupon', c.id); B.undoRemove('Coupon ' + c.code + ' deleted', rm); } }),
        ]),
      ]);
    };
    const paint = () => {
      GK.clear(grid);
      const shown = list.filter(c => !filter || c.status === filter);
      if (!list.length) { grid.appendChild(U.empty({ icon: '✂', title: 'No coupons yet', text: 'Discount codes you hand out — at a convention, in a newsletter, for a launch week. Sales logged with the code count its uses.', actions: [ui.button({ label: 'New coupon', kind: 'primary', icon: '＋', onClick: () => B.editCoupon(null, products) })] })); return; }
      if (!shown.length) { grid.appendChild(h('div.gk-muted.bz-none', { text: 'No coupons here.' })); return; }
      for (const c of shown) grid.appendChild(card(c));
    };
    const n = k => list.filter(c => c.status === k).length;
    box.append(h('div.bz-filters', [
      ui.segmented({ value: filter, options: [['', 'All ' + list.length], ['live', 'Live ' + n('live')], ['expired', 'Expired ' + n('expired')], ['used', 'Used up ' + n('used')], ['off', 'Off ' + n('off')]], onChange: v => { filter = v; paint(); } }),
      h('span.gk-grow'),
      ui.button({ label: 'New coupon', icon: '＋', kind: 'primary', small: true, onClick: () => B.editCoupon(null, products) }),
    ]), grid);
    paint();
    return { refresh: async () => { [list, products] = await Promise.all([WB.api('business.coupons', WB.worldId), WB.api('business.products', WB.worldId)]); paint(); } };
  };

  /* ================= Reviews ================= */
  B.editReview = async (r, products) => {
    const v = await B.form({ title: r ? 'Edit review' : 'New review', icon: '★', ok: r ? 'Save' : 'Add review', width: 'min(44em, 94vw)', fields: [
      { key: 'rating', label: 'Rating', kind: 'stars', value: r ? r.rating : 5 },
      { key: 'productId', label: 'Product', kind: 'select', value: r ? r.productId || '' : (products[0] ? products[0].id : ''), options: B.productOptions(products, 'The world in general') },
      { key: 'text', label: 'What they said', kind: 'textarea', value: r ? r.text : '', wide: true, rows: 4, required: true, placeholder: 'Paste the review' },
      { key: 'author', label: 'Who', value: r ? r.author : '', placeholder: 'Name or handle' },
      { key: 'source', label: 'Where', kind: 'channel', value: r ? r.source : '', placeholder: 'Shop, blog, convention…' },
      { key: 'date', label: 'When', kind: 'date', value: r ? r.date : B.today() },
      { key: 'featured', label: 'Feature it on the published shop', kind: 'toggle', value: r ? r.featured : false, wide: true },
    ] });
    if (!v) return null;
    v.productId = v.productId || null;
    return WB.api('business.saveReview', Object.assign({ worldId: WB.worldId }, r ? { id: r.id } : {}, v)).catch(WB.fail);
  };
  B.views.reviews = async function (box, S) {
    const st = S.st, R = () => st.get().reviews || {};
    let [all, products] = await Promise.all([WB.api('business.reviews', WB.worldId, {}), WB.api('business.products', WB.worldId)]);
    const head = h('div'), listBox = h('div.bz-reviews');
    const paint = () => {
      const f = R();
      const list = all.filter(r => (!f.productId || (f.productId === 'none' ? !r.productId : r.productId === f.productId)) && (!f.featured || r.featured));
      GK.clear(head); GK.clear(listBox);
      // summary: average, distribution, featured
      const avg = list.length ? list.reduce((a, r) => a + r.rating, 0) / list.length : 0;
      const dist = [5, 4, 3, 2, 1].map(n => [n, list.filter(r => r.rating === n).length]);
      const maxD = Math.max(1, ...dist.map(d => d[1]));
      head.appendChild(h('div.bz-revhead', [
        ui.panel({ cls: 'bz-revsum', body: [
          h('div.bz-revavg', [h('b', { text: list.length ? (Math.round(avg * 10) / 10).toFixed(1) : '—' }), B.stars(avg, { size: 'big' })]),
          h('div.gk-small.gk-muted', { text: WB.fmt.plural(list.length, 'review') + ' · ' + list.filter(r => r.featured).length + ' featured on the shop' }),
          h('div.bz-dist', dist.map(([n, c]) => h('div.bz-dist-row', [h('span.gk-small', { text: n + ' ★' }), h('div.bz-rank-bar.thin', [h('i', { style: { width: (c / maxD * 100) + '%' } })]), h('span.gk-tiny.gk-muted', { text: String(c) })]))),
        ] }),
        h('div.bz-filters.col', [
          h('div.bz-h4', { text: 'Show' }),
          B.select(f.productId || '', [['', 'Every product'], ['none', 'The world in general']].concat(products.map(p => [p.id, p.title])), v => { st.patch({ reviews: Object.assign({}, R(), { productId: v }) }); paint(); }),
          ui.chip({ label: '★ Featured only', on: !!f.featured, title: 'Featured reviews appear on your published shop', onClick: () => { st.patch({ reviews: Object.assign({}, R(), { featured: !R().featured }) }); paint(); } }),
          ui.button({ label: 'Add review', icon: '＋', kind: 'primary', small: true, onClick: () => B.editReview(null, products) }),
          h('p.gk-tiny.gk-faint.bz-tight', { text: 'Featured reviews are shown with their product on the shop page of your published site.' }),
        ]),
      ]));
      if (!all.length) { listBox.appendChild(U.empty({ icon: '★', title: 'No reviews yet', text: 'Keep what readers and players say about your work: ratings, quotes, where they said it. Feature the best ones and they appear on your published shop.', actions: [ui.button({ label: 'Add a review', kind: 'primary', icon: '＋', onClick: () => B.editReview(null, products) })] })); return; }
      if (!list.length) { listBox.appendChild(h('div.gk-muted.bz-none', { text: 'No reviews match.' })); return; }
      for (const r of list) {
        listBox.appendChild(h('div.gk-widget.bz-review', { class: r.featured ? 'featured' : '' }, [
          h('div.bz-review-head', [B.stars(r.rating), h('span.gk-grow'),
            h('span.bz-review-tools', [
              ui.button({ icon: '✎', small: true, kind: 'ghost', title: 'Edit', onClick: () => B.editReview(r, products) }),
              ui.button({ icon: '⎘', small: true, kind: 'ghost', title: 'Copy the quote', onClick: () => B.copy('“' + r.text + '” — ' + (r.author || 'a reader'), 'the quote') }),
              ui.button({ icon: '🗑', small: true, kind: 'ghost', title: 'Delete', onClick: async () => { const rm = await WB.api('business.removeReview', r.id); B.undoRemove('Review deleted', rm); } }),
            ]),
            h('button.bz-feature', { type: 'button', class: r.featured ? 'on' : '', 'aria-pressed': String(r.featured), title: r.featured ? 'Featured on the published shop — click to stop featuring' : 'Feature it on the published shop', onclick: async () => { await WB.api('business.saveReview', { id: r.id, featured: !r.featured }); ui.toast(r.featured ? 'No longer featured' : 'Featured on the shop', '★', 1600); } }, [r.featured ? '★ Featured' : '☆ Feature']),
          ]),
          h('blockquote.bz-quote', { text: r.text || '…' }),
          h('div.bz-review-foot.gk-small', [
            h('span.gk-muted', { text: '— ' + [r.author || 'Anonymous', r.source].filter(Boolean).join(', ') + (r.date ? ' · ' + WB.fmt.real(r.date) : '') }),
            h('span.gk-grow'),
            r.productId ? B.productChip(r.productId, r.productTitle) : h('span.gk-faint', { text: 'The world' }),
          ]),
        ]));
      }
    };
    box.append(head, listBox);
    paint();
    return { refresh: async () => { [all, products] = await Promise.all([WB.api('business.reviews', WB.worldId, {}), WB.api('business.products', WB.worldId)]); paint(); } };
  };
})();
