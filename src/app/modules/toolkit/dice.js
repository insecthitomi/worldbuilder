/* Toolkit · dice: notation box, quick dice with count and modifier, advantage/disadvantage, the odds of any roll,
   dice shown kept and dropped, saved favourite rolls, and a history that also hears field dice buttons. */
(function () {
  'use strict';
  const GK = window.GK, WB = window.WB, h = GK.h, ui = GK.ui, TK = WB.toolkit;
  const DICE = [4, 6, 8, 10, 12, 20, 100];

  /** probability of each total: exact for plain dice, sampled for keep/explode/fudge */
  const distCache = new Map();
  function dist(expr) {
    if (distCache.has(expr)) return distCache.get(expr);
    let m = null;
    try {
      const p = WB.dice.parse(expr);
      const plain = p.terms.every(t => t.flat != null || (!t.keep && !t.explode && t.sides !== 'F')) && !p.mode;
      const span = WB.dice.range(expr);
      if (plain && span.max - span.min < 400 && window.WBGen) m = window.WBGen.distribution(expr);
      else {
        m = new Map(); const N = 12000;
        for (let i = 0; i < N; i++) { const v = WB.dice.roll(expr, Math.random).total; m.set(v, (m.get(v) || 0) + 1 / N); }
      }
    } catch { m = null; }
    distCache.set(expr, m);
    if (distCache.size > 60) distCache.delete(distCache.keys().next().value);
    return m;
  }
  const mean = m => { let s = 0; for (const [k, p] of m) s += k * p; return s; };

  /** one die as a tile: shape by sides, kept or dropped, max and min marked */
  function dieTile(v, sides, kept) {
    const s = sides === 'F' ? 'f' : sides <= 4 ? 'd4' : sides <= 6 ? 'd6' : sides <= 8 ? 'd8' : sides <= 10 ? 'd10' : sides <= 12 ? 'd12' : sides <= 20 ? 'd20' : 'd100';
    const text = sides === 'F' ? (v > 0 ? '+' : v < 0 ? '−' : '0') : String(v);
    return h('span.tl-die', { class: s + (kept ? '' : ' dropped') + (sides !== 'F' && v === sides ? ' max' : '') + (sides !== 'F' && v === 1 ? ' min' : ''), title: (kept ? '' : 'Dropped · ') + 'd' + sides + ': ' + v }, [h('span', { text })]);
  }

  TK.tools.dice = {
    async mount(host, { store }) {
      const st = () => store.get();
      let expr = st().diceExpr || '1d20', mode = st().diceMode || '', count = 1, mod = 0, last = null;
      /* the notation box */
      const input = h('input.gk-input.gk-control.tl-dice-input', { value: expr, placeholder: '2d6+3 · 4d6kh3 · 1d20+5 adv · d% · 3d6!', spellcheck: false, 'aria-label': 'Dice notation' });
      const hint = h('div.tl-dice-hint.gk-small');
      const chart = h('div.tl-dist', { 'aria-hidden': 'true' });
      const full = () => { const e = input.value.trim(); return mode && /d20/i.test(e) && !/\s(adv|dis)/i.test(e) ? e + ' ' + mode : e; };
      const paintHint = () => {
        const e = full();
        hint.classList.remove('bad');
        GK.clear(chart);
        if (!e) { hint.textContent = 'Type dice, or click a die below.'; return; }
        if (!WB.dice.valid(e)) { try { WB.dice.parse(e); } catch (err) { hint.textContent = err.message; hint.classList.add('bad'); } return; }
        const r = WB.dice.range(e), m = dist(e);
        hint.textContent = r.min + '–' + r.max + (m ? ' · average ' + (Math.round(mean(m) * 10) / 10) : '') + (mode && /d20/i.test(input.value) ? ' · ' + (mode === 'adv' ? 'advantage' : 'disadvantage') : '');
        const flat = m && Math.max(...m.values()) - Math.min(...m.values()) < 1e-6;
        if (m && !flat && m.size > 2 && m.size <= 120) {
          const keys = [...m.keys()].sort((a, b) => a - b), peak = Math.max(...m.values());
          for (const k of keys) chart.appendChild(h('span.tl-dist-bar', { class: last && last.total === k && last.expr === e ? 'hit' : '', title: k + ': ' + (Math.round(m.get(k) * 1000) / 10) + '%', style: { height: Math.max(3, m.get(k) / peak * 100) + '%' } }));
        }
      };
      input.addEventListener('input', () => { store.patch({ diceExpr: input.value }); paintHint(); });
      input.addEventListener('keydown', e => { if (e.key === 'Enter') { e.preventDefault(); rollNow(); } });

      /* result */
      const total = h('div.tl-dice-total', { 'aria-live': 'polite' });
      const detail = h('div.tl-dice-detail');
      const tiles = h('div.tl-dice-tiles');
      const resultBox = h('div.tl-dice-result', [total, h('div.gk-grow', [detail, tiles])]);
      function show(r, animate) {
        last = r;
        const final = () => {
          total.textContent = String(r.total);
          total.className = 'tl-dice-total' + (r.crit === 'hit' ? ' crit' : r.crit === 'miss' ? ' fumble' : '');
          GK.clear(tiles);
          for (const p of r.parts || []) {
            if (!p.rolls || !p.rolls.length) { tiles.appendChild(h('span.tl-die-mod', { text: (p.sign < 0 ? '− ' : '+ ') + p.term })); continue; }
            const sides = /d(%|\d+|F)/i.exec(p.term); const n = sides ? (sides[1] === '%' ? 100 : sides[1].toUpperCase() === 'F' ? 'F' : +sides[1]) : 6;
            const kept = new Set(p.keptIdx || p.rolls.map((x, i) => i));
            tiles.appendChild(h('span.tl-die-group', { title: p.term }, [p.sign < 0 ? h('span.tl-die-mod', { text: '−' }) : null, ...p.rolls.map((v, i) => dieTile(v, n, kept.has(i)))]));
          }
          detail.replaceChildren(...[h('b', { text: (r.label ? r.label + ' · ' : '') + r.expr }), h('span.gk-muted', { text: '  ' + r.text }), r.crit ? h('span.wb-badge.' + (r.crit === 'hit' ? 'good' : 'bad'), { text: r.crit === 'hit' ? 'natural 20' : 'natural 1' }) : null].filter(Boolean));
          paintHint();
        };
        if (animate && !document.documentElement.classList.contains('no-motion')) {
          let k = 0; total.classList.add('rolling');
          const t = setInterval(() => { total.textContent = String(r.min + Math.floor(Math.random() * (r.max - r.min + 1))); if (++k > 6) { clearInterval(t); total.classList.remove('rolling'); final(); } }, 45);
        } else final();
      }
      function rollNow(e2, label) {
        const e = e2 || full();
        if (!e) return;
        try { const r = TK.roll(e, label); const d20 = r.parts.find(p => /d20/.test(p.term)); const nat = d20 && d20.kept ? d20.kept[0] : null; r.crit = d20 && d20.rolls.length <= 2 ? (nat === 20 ? 'hit' : nat === 1 ? 'miss' : null) : null; show(r, true); }
        catch (err) { WB.fail(err); }
      }

      /* quick dice */
      const countIn = ui.input({ type: 'number', value: 1, onInput: v => { count = Math.max(1, Math.min(100, +v || 1)); } }); countIn.min = 1; countIn.max = 100;
      const modIn = ui.input({ type: 'number', value: 0, onInput: v => { mod = Math.max(-99, Math.min(99, +v || 0)); } }); modIn.min = -99; modIn.max = 99;
      const quick = h('div.tl-quick', DICE.map(n => h('button.tl-qdie.gk-control', { type: 'button', class: 'q' + n, title: 'Roll ' + (count > 1 ? count : '') + 'd' + n + ' (count and modifier apply; Shift-click adds to the box)', onclick: e => {
        const term = (count > 1 ? count : '') + 'd' + (n === 100 ? '%' : n);
        if (e.shiftKey) { input.value = (input.value.trim() ? input.value.trim() + '+' : '') + term; store.patch({ diceExpr: input.value }); paintHint(); input.focus(); return; }
        const ex = term + (mod ? (mod > 0 ? '+' : '') + mod : '');
        input.value = ex; store.patch({ diceExpr: ex }); rollNow();
      } }, [h('span.tl-qdie-shape'), h('b', { text: 'd' + n })])));
      const modeSeg = ui.segmented({ value: mode, options: [['', 'Normal'], ['adv', 'Advantage', 'Roll two d20, keep the higher'], ['dis', 'Disadvantage', 'Roll two d20, keep the lower']], onChange: v => { mode = v; store.patch({ diceMode: v }); paintHint(); } });

      /* favourites */
      const favBox = h('div.tl-favs');
      const paintFavs = () => {
        GK.clear(favBox);
        for (const f of st().favs || []) {
          const b = h('button.tl-fav.gk-control', { type: 'button', title: 'Roll ' + f.expr + ' (right-click to rename or remove)', onclick: () => { input.value = f.expr; paintHint(); rollNow(f.expr, f.label); } }, [h('b', { text: f.label }), h('code', { text: f.expr })]);
          b.addEventListener('contextmenu', ev => { ev.preventDefault(); WB.ui.menu([
            { label: 'Rename…', icon: '✎', onClick: async () => { const n = await ui.prompt('Name this roll', f.label); if (n) { store.patch({ favs: st().favs.map(x => (x === f ? Object.assign({}, x, { label: n }) : x)) }); paintFavs(); } } },
            { label: 'Put in the box', icon: '⌨', onClick: () => { input.value = f.expr; paintHint(); input.focus(); } },
            '-', { label: 'Remove', icon: '🗑', danger: true, onClick: () => { const old = st().favs; store.patch({ favs: old.filter(x => x !== f) }); paintFavs(); WB.ui.undoToast('Removed “' + f.label + '”', () => { store.patch({ favs: old }); paintFavs(); }); } },
          ], ev); });
          favBox.appendChild(b);
        }
        if (!(st().favs || []).length) favBox.appendChild(h('div.gk-small.gk-muted', { text: 'Save rolls you make often with ★.' }));
      };
      const saveFav = async () => {
        const e = full();
        if (!WB.dice.valid(e)) return ui.toast('Type a roll first', 'ℹ');
        const n = await ui.prompt('Save this roll as', '', 'e.g. Longsword, Sneak attack');
        if (!n) return;
        store.patch({ favs: (st().favs || []).concat([{ label: n, expr: e }]) }); paintFavs();
      };

      /* history */
      const histBox = h('div.tl-hist', { role: 'log' });
      const paintHist = () => {
        GK.clear(histBox);
        const list = st().rolls || [];
        if (!list.length) histBox.appendChild(WB.ui.empty({ icon: '⚄', title: 'No rolls yet', text: 'Rolls from here, from the command palette (r 2d6) and from dice fields on entries all appear here.' }));
        let day = '';
        for (const r of list.slice(0, 80)) {
          const d = (r.at || '').slice(0, 10);
          if (d !== day) { day = d; histBox.appendChild(h('div.tl-hist-day.gk-tiny.gk-muted', { text: d === WB.today() ? 'Today' : WB.fmt.real(d) })); }
          histBox.appendChild(h('div.tl-hist-row', { tabindex: 0, title: 'Roll ' + r.expr + ' again', onclick: () => { input.value = r.expr.replace(/\s+(adv|dis)$/i, ''); paintHint(); rollNow(r.expr, r.label); } }, [
            h('span.tl-hist-time.gk-tiny.gk-muted', { text: TK.time(r.at) }),
            h('div.tl-hist-main', [h('div.gk-ellipsis', [r.label ? h('b', { text: r.label + ' ' }) : null, h('span', { text: r.expr })]), h('div.gk-tiny.gk-muted.gk-ellipsis', { text: r.text })]),
            h('span.tl-hist-total', { class: r.crit === 'hit' ? 'crit' : r.crit === 'miss' ? 'fumble' : '', text: String(r.total) }),
          ]));
        }
      };
      const clearHist = () => { const old = st().rolls; if (!old.length) return; store.patch({ rolls: [] }); paintHist(); WB.ui.undoToast('Roll history cleared', () => { store.patch({ rolls: old }); paintHist(); }); };

      const main = TK.card({ cls: 'tl-dice-card', body: [
        h('div.tl-dice-row', [h('div.gk-grow', [input]), ui.button({ icon: '★', title: 'Save this roll', onClick: saveFav }), ui.button({ label: 'Roll', icon: '⚄', kind: 'primary', cls: 'tl-dice-roll', title: 'Roll (Enter)', onClick: () => rollNow() })]),
        h('div.tl-dice-sub', [hint, modeSeg]),
        resultBox,
        chart,
        h('div.tl-quick-head', [h('h4', { text: 'Quick dice' }), h('div.gk-row.nowrap.tl-quick-opts', [ui.field({ label: 'Count', inline: true, control: countIn }), ui.field({ label: 'Modifier', inline: true, control: modIn })])]),
        quick,
        h('div.gk-tiny.gk-muted', [WB.ui.kbd('Enter'), ' rolls · ', WB.ui.kbd('Shift'), '+click a die adds it to the box · ', h('span', { text: 'kh3 keeps the highest 3, dl1 drops the lowest, ! explodes, adv/dis for a d20' })]),
      ] });
      main.querySelector('.gk-btn.primary').classList.add('tl-dice-roll');
      const side = h('div.tl-dice-side', [
        TK.card({ title: 'Saved rolls', icon: '★', body: favBox }),
        TK.card({ title: 'History', icon: '◷', sub: 'Every roll in the app', actions: [ui.button({ label: 'Clear', small: true, kind: 'ghost', onClick: clearHist })], body: histBox, cls: 'tl-hist-card' }),
      ]);
      host.appendChild(h('div.tl-dice', [main, side]));
      paintHint(); paintFavs(); paintHist();
      if (st().rolls && st().rolls[0]) { const r0 = st().rolls[0]; try { if (r0.parts) show(r0); else { total.textContent = String(r0.total); detail.replaceChildren(h('b', { text: (r0.label ? r0.label + ' · ' : '') + r0.expr }), h('span.gk-muted', { text: '  ' + r0.text })); } } catch { } }
      else total.textContent = '–';
      setTimeout(() => input.focus(), 30);
      const offs = [WB.on('toolkit-rolls', () => paintHist())];
      const offKeys = TK.keys(host, e => { if (TK.isTyping(e) || e.ctrlKey || e.altKey) return; const n = { 1: 4, 2: 6, 3: 8, 4: 10, 5: 12, 6: 20, 7: 100 }[e.key]; if (n) { e.preventDefault(); quick.children[DICE.indexOf(n)].click(); } });
      return () => { offs.forEach(f => f()); offKeys(); };
    },
  };
})();
