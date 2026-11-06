/* Toolkit · converters: the world's coins (settings.currencies: name, abbr, value in the smallest coin) and its own
   measures (settings.units: name, abbr, kind, factor in metres / kilograms / litres / seconds), each with an editor,
   presets and a live converter that also makes change in coins. */
(function () {
  'use strict';
  const GK = window.GK, WB = window.WB, h = GK.h, ui = GK.ui, TK = WB.toolkit;
  const REAL = {
    length: { base: 'm', units: [['m', 'metre', 1], ['km', 'kilometre', 1000], ['cm', 'centimetre', 0.01], ['mi', 'mile', 1609.344], ['yd', 'yard', 0.9144], ['ft', 'foot', 0.3048], ['in', 'inch', 0.0254]] },
    weight: { base: 'kg', units: [['kg', 'kilogram', 1], ['g', 'gram', 0.001], ['t', 'tonne', 1000], ['lb', 'pound', 0.45359237], ['oz', 'ounce', 0.0283495]] },
    volume: { base: 'l', units: [['l', 'litre', 1], ['ml', 'millilitre', 0.001], ['gal', 'gallon', 3.78541], ['pt', 'pint', 0.473176]] },
    time: { base: 's', units: [['s', 'second', 1], ['min', 'minute', 60], ['h', 'hour', 3600], ['d', 'day (24 h)', 86400], ['wk', 'week (7 days)', 604800]] },
  };
  const KINDS = [['length', 'Length'], ['weight', 'Weight'], ['volume', 'Volume'], ['time', 'Time']];
  const COIN_PRESETS = [
    ['Gold, silver, copper', [{ name: 'gold', abbr: 'g', value: 100 }, { name: 'silver', abbr: 's', value: 10 }, { name: 'copper', abbr: 'c', value: 1 }]],
    ['Crowns, shillings, pennies', [{ name: 'crown', abbr: 'cr', value: 240 }, { name: 'shilling', abbr: 'sh', value: 12 }, { name: 'penny', abbr: 'd', value: 1 }]],
    ['Platinum to copper', [{ name: 'platinum', abbr: 'pp', value: 1000 }, { name: 'gold', abbr: 'gp', value: 100 }, { name: 'electrum', abbr: 'ep', value: 50 }, { name: 'silver', abbr: 'sp', value: 10 }, { name: 'copper', abbr: 'cp', value: 1 }]],
    ['Credits', [{ name: 'credit', abbr: 'cr', value: 100 }, { name: 'centicredit', abbr: 'cc', value: 1 }]],
  ];
  const UNIT_PRESETS = [
    ['Old measures', [{ name: 'league', abbr: 'lea', kind: 'length', factor: 4828 }, { name: 'furlong', abbr: 'fur', kind: 'length', factor: 201.168 }, { name: 'fathom', abbr: 'ftm', kind: 'length', factor: 1.8288 }, { name: 'stone', abbr: 'st', kind: 'weight', factor: 6.35029 }, { name: 'hogshead', abbr: 'hhd', kind: 'volume', factor: 238.5 }, { name: 'watch', abbr: 'watch', kind: 'time', factor: 14400 }]],
    ['A day\'s travel', [{ name: 'day\'s march', abbr: 'march', kind: 'length', factor: 32000 }, { name: 'day\'s ride', abbr: 'ride', kind: 'length', factor: 60000 }, { name: 'day\'s sail', abbr: 'sail', kind: 'length', factor: 150000 }]],
  ];
  const fmt = (v) => { if (!isFinite(v)) return '–'; const a = Math.abs(v); const d = a >= 1000 ? 0 : a >= 100 ? 1 : a >= 1 ? 2 : a >= 0.01 ? 4 : 6; return Number(v.toFixed(d)).toLocaleString(undefined, { maximumFractionDigits: d }); };

  TK.tools.convert = {
    async mount(host, { store }) {
      const ro = WB.share;
      const settings = () => (WB.world && WB.world.settings) || {};
      let coins = (settings().currencies || []).map(c => Object.assign({}, c));
      let units = (settings().units || []).map(u => Object.assign({}, u));
      const conv = Object.assign({ amount: '1', from: '', uAmount: '1', uFrom: '' }, store.get().convert);
      let dirty = false;
      const saveNow = WB.debounce(() => { dirty = false; WB.api('worlds.update', WB.worldId, { settings: { currencies: coins.filter(c => c.name && +c.value > 0), units: units.filter(u => u.name && +u.factor > 0) } }).catch(WB.fail); }, 500);
      const saveWorld = () => { dirty = true; saveNow(); };
      const sortedCoins = () => coins.filter(c => c.name && +c.value > 0).slice().sort((a, b) => b.value - a.value);

      /* ---- coins ---- */
      const coinRows = h('div.tl-conv-rows');
      const coinOut = h('div.tl-conv-out');
      const amountIn = ui.input({ value: conv.amount, placeholder: 'e.g. 12, 3.5 or 2 cr 7 tm' });
      amountIn.classList.add('tl-mono');
      const fromSel = h('span');
      /** "2 cr 7 tm" or "12.5" (in the chosen coin) → value in the smallest coin */
      const parseAmount = (s, from) => {
        const cs = sortedCoins(); s = String(s || '').trim(); if (!s) return null;
        const parts = [...s.matchAll(/(-?[\d.,]+)\s*([^\d\s.,-][^\d]*)?/g)];
        if (!parts.length) return null;
        let total = 0;
        for (const [, n, unit] of parts) {
          const v = parseFloat(n.replace(',', '.')); if (isNaN(v)) return null;
          const u = (unit || '').trim().toLowerCase();
          const c = u ? cs.find(x => x.abbr.toLowerCase() === u || x.name.toLowerCase() === u || x.name.toLowerCase() + 's' === u || u.startsWith(x.name.toLowerCase())) : cs.find(x => x.abbr === from) || cs[cs.length - 1];
          if (!c) return null;
          total += v * c.value;
        }
        return total;
      };
      const paintCoinOut = () => {
        GK.clear(coinOut);
        const cs = sortedCoins();
        if (!cs.length) { coinOut.appendChild(h('div.gk-small.gk-muted', { text: 'Add your world\'s coins, or start from a preset.' })); return; }
        const v = parseAmount(amountIn.value, conv.from || cs[0].abbr);
        if (v == null) { coinOut.appendChild(h('div.gk-small.tl-bad', { text: 'Type an amount like 12, 3.5 or ' + cs.slice(0, 2).map((c, i) => (i ? 7 : 2) + ' ' + c.abbr).join(' ') + '.' })); return; }
        coinOut.appendChild(h('div.tl-conv-grid', cs.map(c => h('div.tl-conv-cell', [h('div.tl-stat-label', { text: c.name }), h('div.tl-conv-val', [fmt(v / c.value), h('span.gk-muted', { text: ' ' + c.abbr })])]))));
        coinOut.appendChild(h('div.tl-conv-change.gk-small', [h('span.gk-muted', { text: 'In coins: ' }), h('b', { text: (window.WBGen && WBGen.money ? WBGen.money(v / cs[cs.length - 1].value * 1, { currencies: cs }) : '') }), h('span.gk-muted', { text: (() => { let n = Math.round(v), out = []; for (const c of cs) { const k = Math.floor(n / c.value); if (k) { out.push(k + ' ' + c.abbr); n -= k * c.value; } } return out.length > 2 ? '  ·  exactly ' + out.join(' ') : ''; })() })]));
      };
      const paintFrom = () => { GK.clear(fromSel); const cs = sortedCoins(); if (!cs.length) return; if (!cs.find(c => c.abbr === conv.from)) conv.from = cs[0].abbr; fromSel.appendChild(ui.select({ value: conv.from, options: cs.map(c => [c.abbr, c.name + ' (' + c.abbr + ')']), onChange: v => { conv.from = v; store.patch({ convert: conv }); paintCoinOut(); } })); };
      amountIn.addEventListener('input', () => { conv.amount = amountIn.value; store.patch({ convert: conv }); paintCoinOut(); });
      const paintCoins = () => {
        GK.clear(coinRows);
        if (coins.length) coinRows.appendChild(h('div.tl-conv-head.gk-tiny.gk-muted', [h('span', { text: 'Name' }), h('span', { text: 'Short' }), h('span', { text: 'Worth (smallest coins)' }), h('span')]));
        coins.forEach((c, i) => {
          const name = ui.input({ value: c.name, placeholder: 'e.g. crown', onInput: v => { c.name = v; saveWorld(); paintFrom(); paintCoinOut(); } });
          const abbr = ui.input({ value: c.abbr, placeholder: 'cr', onInput: v => { c.abbr = v; saveWorld(); paintFrom(); paintCoinOut(); } });
          const val = ui.input({ type: 'number', value: c.value, onInput: v => { c.value = +v; saveWorld(); paintFrom(); paintCoinOut(); } }); val.min = 1;
          [name, abbr, val].forEach(x => { x.readOnly = ro; });
          coinRows.appendChild(h('div.tl-conv-row', [name, abbr, val, ro ? h('span') : ui.button({ icon: '✕', small: true, kind: 'ghost', title: 'Remove', onClick: () => { const old = coins.slice(); coins.splice(i, 1); saveWorld(); paintAll(); WB.ui.undoToast('Coin removed', () => { coins = old; saveWorld(); paintAll(); }); } })]));
        });
        if (!coins.length) coinRows.appendChild(h('div.gk-small.gk-muted', { text: 'No coins yet. The smallest coin is worth 1; bigger coins say how many of it they are worth.' }));
      };

      /* ---- units ---- */
      const unitRows = h('div.tl-conv-rows');
      const unitOut = h('div.tl-conv-out');
      const uAmount = ui.input({ type: 'number', value: conv.uAmount });
      const uFromBox = h('span');
      const worldUnits = () => {
        const out = [];
        if (WB.cal) {
          const daySec = WB.cal.cal.hoursPerDay * WB.cal.cal.minutesPerHour * 60;
          if (WB.cal.cal.hoursPerDay !== 24 || WB.cal.cal.minutesPerHour !== 60) out.push({ name: 'world day', abbr: 'wday', kind: 'time', factor: daySec, auto: true });
          out.push({ name: 'world week', abbr: 'wwk', kind: 'time', factor: daySec * Math.max(1, WB.cal.weekdays.length || 7), auto: true });
          out.push({ name: 'world month (avg)', abbr: 'wmo', kind: 'time', factor: daySec * WB.cal.avgMonth, auto: true });
          out.push({ name: 'world year', abbr: 'wyr', kind: 'time', factor: daySec * WB.cal.avgYear, auto: true });
        }
        return out;
      };
      const allUnits = () => units.filter(u => u.name && +u.factor > 0).concat(worldUnits(), ...Object.entries(REAL).map(([k, r]) => r.units.map(([abbr, name, f]) => ({ name, abbr, kind: k, factor: f, real: true }))));
      const unitKey = u => u.kind + ':' + u.abbr + ':' + u.name;
      const paintUFrom = () => {
        GK.clear(uFromBox);
        const all = allUnits();
        if (!all.find(u => unitKey(u) === conv.uFrom)) conv.uFrom = unitKey(units.find(u => u.name && +u.factor > 0) || all[0]);
        const sel = h('select.gk-input.gk-control', { onchange: () => { conv.uFrom = sel.value; store.patch({ convert: conv }); paintUnitOut(); } },
          KINDS.map(([k, l]) => h('optgroup', { label: l }, all.filter(u => u.kind === k).map(u => h('option', { value: unitKey(u), text: u.name + ' (' + u.abbr + ')' + (u.real ? '' : u.auto ? ' · calendar' : ' · yours') })))));
        sel.value = conv.uFrom;
        uFromBox.appendChild(sel);
      };
      const paintUnitOut = () => {
        GK.clear(unitOut);
        const all = allUnits(), from = all.find(u => unitKey(u) === conv.uFrom);
        const v = parseFloat(uAmount.value);
        if (!from || isNaN(v)) return;
        const base = v * from.factor;
        const same = all.filter(u => u.kind === from.kind && unitKey(u) !== conv.uFrom);
        const mineFirst = same.filter(u => !u.real).concat(same.filter(u => u.real));
        unitOut.appendChild(h('div.tl-conv-grid', mineFirst.map(u => h('div.tl-conv-cell', { class: u.real ? 'real' : 'own' }, [h('div.tl-stat-label', { text: u.name }), h('div.tl-conv-val', [fmt(base / u.factor), h('span.gk-muted', { text: ' ' + u.abbr })])]))));
      };
      uAmount.addEventListener('input', () => { conv.uAmount = uAmount.value; store.patch({ convert: conv }); paintUnitOut(); });
      const paintUnits = () => {
        GK.clear(unitRows);
        if (units.length) unitRows.appendChild(h('div.tl-conv-head.units.gk-tiny.gk-muted', [h('span', { text: 'Name' }), h('span', { text: 'Short' }), h('span', { text: 'Measures' }), h('span', { text: 'Equals' }), h('span')]));
        units.forEach((u, i) => {
          const name = ui.input({ value: u.name, placeholder: 'e.g. league', onInput: v => { u.name = v; saveWorld(); paintUFrom(); paintUnitOut(); } });
          const abbr = ui.input({ value: u.abbr, placeholder: 'lea', onInput: v => { u.abbr = v; saveWorld(); paintUFrom(); paintUnitOut(); } });
          const kind = ui.select({ value: u.kind || 'length', options: KINDS, onChange: v => { u.kind = v; saveWorld(); paintUnits(); paintUFrom(); paintUnitOut(); } });
          const f = ui.input({ type: 'number', value: u.factor, onInput: v => { u.factor = +v; saveWorld(); paintUFrom(); paintUnitOut(); } }); f.step = 'any';
          [name, abbr, f].forEach(x => { x.readOnly = ro; }); kind.disabled = ro;
          unitRows.appendChild(h('div.tl-conv-row.units', [name, abbr, kind, h('div.wb-unit', [f, h('span.gk-muted.gk-small', { text: REAL[u.kind || 'length'].base })]),
            ro ? h('span') : ui.button({ icon: '✕', small: true, kind: 'ghost', title: 'Remove', onClick: () => { const old = units.slice(); units.splice(i, 1); saveWorld(); paintAll(); WB.ui.undoToast('Unit removed', () => { units = old; saveWorld(); paintAll(); }); } })]));
        });
        if (!units.length) unitRows.appendChild(h('div.gk-small.gk-muted', { text: 'No measures of your own yet — leagues, stones, watches, a day\'s ride …' }));
      };
      const paintAll = () => { paintCoins(); paintFrom(); paintCoinOut(); paintUnits(); paintUFrom(); paintUnitOut(); };

      const coinCard = TK.card({ title: 'Coins', icon: '¤', sub: 'Generators price goods in these coins.', actions: ro ? [] : [
        ui.button({ label: 'Add coin', icon: '＋', small: true, onClick: () => { coins.push({ name: '', abbr: '', value: 1 }); paintCoins(); const ins = coinRows.querySelectorAll('.tl-conv-row input'); if (ins.length) ins[ins.length - 3].focus(); } }),
        ui.button({ label: 'Presets', icon: '▾', small: true, kind: 'ghost', onClick: e => WB.ui.menu(COIN_PRESETS.map(([l, list]) => ({ label: l, hint: list.map(c => c.abbr).join(' / '), onClick: () => { const old = coins.slice(); coins = list.map(c => Object.assign({}, c)); saveWorld(); paintAll(); WB.ui.undoToast('Coins replaced', () => { coins = old; saveWorld(); paintAll(); }); } })), e) }),
      ], body: [coinRows] });
      const coinConv = TK.card({ title: 'Convert money', icon: '⇄', body: [h('div.tl-conv-in', [amountIn, fromSel]), coinOut] });
      const unitCard = TK.card({ title: 'Measures', icon: '⚖', sub: 'Each one in metres, kilograms, litres or seconds.', actions: ro ? [] : [
        ui.button({ label: 'Add measure', icon: '＋', small: true, onClick: () => { units.push({ name: '', abbr: '', kind: 'length', factor: 1 }); paintUnits(); const ins = unitRows.querySelectorAll('.tl-conv-row input'); if (ins.length) ins[ins.length - 3].focus(); } }),
        ui.button({ label: 'Presets', icon: '▾', small: true, kind: 'ghost', onClick: e => WB.ui.menu(UNIT_PRESETS.map(([l, list]) => ({ label: 'Add ' + l.toLowerCase(), hint: list.map(u => u.name).join(', '), onClick: () => { const old = units.slice(); units = units.concat(list.filter(n => !units.some(u => u.name === n.name)).map(u => Object.assign({}, u))); saveWorld(); paintAll(); WB.ui.undoToast(l + ' added', () => { units = old; saveWorld(); paintAll(); }); } })), e) }),
      ], body: [unitRows] });
      const unitConv = TK.card({ title: 'Convert measures', icon: '⇄', sub: 'Your measures, the calendar\'s and real ones.', body: [h('div.tl-conv-in', [uAmount, uFromBox]), unitOut] });
      host.appendChild(h('div.tl-conv', [h('div.tl-conv-col', [coinConv, coinCard]), h('div.tl-conv-col', [unitConv, unitCard])]));
      paintAll();
      const off = WB.on('world', w => {
        if (document.activeElement && host.contains(document.activeElement) && document.activeElement.matches('input, select')) return;
        coins = ((w || WB.world).settings.currencies || []).map(c => Object.assign({}, c)); units = ((w || WB.world).settings.units || []).map(u => Object.assign({}, u)); paintAll();
      });
      return () => { off(); if (dirty) saveNow.flush(); };
    },
  };
})();
