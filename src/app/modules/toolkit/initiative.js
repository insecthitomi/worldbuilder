/* Toolkit · initiative: Encounter entries keep their fight in data (combatants, round, turn, log). Add combatants from
   entries (stats hp/ac/init) or by hand, roll initiative, run turns and rounds, damage and heal, conditions that count
   down, attack rolls from stat blocks, and end the encounter into a battle log on the entry (and the running session). */
(function () {
  'use strict';
  const GK = window.GK, WB = window.WB, h = GK.h, ui = GK.ui, TK = WB.toolkit;
  const SIDES = [['party', 'Party', '#5fa8d3'], ['ally', 'Ally', '#7cc08a'], ['foe', 'Foe', '#e07a6b'], ['neutral', 'Neutral', '#9aa5b1']];
  const SIDE = Object.fromEntries(SIDES.map(([k, l, c]) => [k, { label: l, color: c }]));
  const CONDITIONS = ['Blinded', 'Charmed', 'Concentrating', 'Deafened', 'Frightened', 'Grappled', 'Hidden', 'Incapacitated', 'Invisible', 'Paralysed', 'Poisoned', 'Prone', 'Restrained', 'Stunned', 'Unconscious', 'Bleeding', 'Burning', 'Blessed', 'Hasted', 'Slowed', 'Marked', 'Exhausted'];
  const uid = () => 'c' + Math.random().toString(36).slice(2, 9);
  const signed = n => (n >= 0 ? '+' : '') + n;

  TK.tools.initiative = {
    async mount(host, { params }) {
      const mine = await TK.mine();
      let sel = params.entryId || mine.encId || null, enc = null, S = null;
      const offs = [];
      const side = TK.entryList({ typeKey: 'encounter', selected: sel, newLabel: 'New encounter', onNew: () => newEncounter(), onSelect: e => select(e.id),
        sub: e => e.summary || '', empty: { text: 'No encounters yet.' } });
      const main = h('div.tl-init-main');
      host.appendChild(h('div.tl-split', [h('aside.gk-panel.tl-side', [h('div.gk-panel-head', [h('span.gk-ico', { text: '⚔' }), h('h3', { text: 'Encounters' }), side.count]), h('div.gk-panel-body', [side.el])]), main]));

      /* ---- state & saving ---- */
      let dirty = false, lastSaved = '';
      const pack = () => ({ combatants: S.combatants, round: S.round, turnId: S.turnId, log: S.log.slice(-400) });
      const saveNow = WB.debounce(() => { dirty = false; if (!enc) return; const d = pack(); lastSaved = JSON.stringify(d); WB.api('entries.update', enc.id, { dataPatch: d }).catch(WB.fail); }, 350);
      const save = () => { dirty = true; saveNow(); };
      const order = () => S.combatants.slice().sort((a, b) => (b.init == null ? -999 : b.init) - (a.init == null ? -999 : a.init) || (b.mod || 0) - (a.mod || 0) || a.name.localeCompare(b.name));
      const log = (text, kind) => { S.log.push({ r: S.round, t: new Date().toISOString(), text, kind: kind || 'note' }); };
      const current = () => S.combatants.find(c => c.id === S.turnId) || null;

      async function newEncounter() {
        const t = WB.type('encounter'); if (!t) return ui.toast('This world has no Encounter type', '⚠');
        const name = await ui.prompt('New encounter', '', 'e.g. Ambush at the ford');
        if (name == null) return;
        const e = await WB.api('entries.create', { worldId: WB.worldId, typeId: t.id, title: name || 'New encounter', data: { combatants: [], round: 0, turnId: null, log: [] } });
        await side.refresh(); side.select(e.id); select(e.id);
      }
      async function select(id) {
        if (dirty) saveNow.flush();
        sel = id; TK.setMine({ encId: id });
        GK.clear(main);
        enc = id ? await WB.api('entries.get', id).catch(() => null) : null;
        if (!enc || enc.deletedAt || !WB.visible(enc)) { enc = null; return paintEmpty(); }
        const d = enc.data || {};
        S = { combatants: (d.combatants || []).map(c => Object.assign({ conditions: [], attacks: [], notes: '', temp: 0, mod: 0, side: 'foe' }, c)), round: d.round || 0, turnId: d.turnId || null, log: d.log || [] };
        if (!S.turnId && d.turn != null && S.round) { const o = order(); S.turnId = o[d.turn] ? o[d.turn].id : null; }
        lastSaved = JSON.stringify(pack());
        paint();
      }
      function paintEmpty() {
        GK.clear(main);
        main.appendChild(TK.card({ body: WB.ui.empty({ icon: '⚔', title: side.list().length ? 'Pick an encounter' : 'Plan your first fight', text: 'An encounter keeps its combatants, turn order, hit points and conditions — run it here, round by round.',
          actions: WB.share ? [] : [ui.button({ label: 'New encounter', icon: '＋', kind: 'primary', onClick: () => newEncounter() })] }) }));
      }

      /* ---- adding ---- */
      async function fromEntry(e, sideKey) {
        const full = e.fields ? e : await WB.api('entries.get', e.id);
        const st = TK.statsOf(full), t = WB.typeOf(full);
        const hp = st.hp != null ? st.hp : 10;
        const same = S.combatants.filter(c => c.entryId === full.id).length;
        return { id: uid(), name: full.title + (same ? ' ' + (same + 1) : ''), entryId: full.id, side: sideKey || (t && t.key === 'character' ? 'party' : 'foe'), init: null, mod: st.mod || 0, hp, maxHp: hp, temp: 0, ac: st.ac, conditions: [], notes: '', attacks: st.attacks };
      }
      async function addEntries() {
        const types = ['character', 'species'].map(k => WB.type(k)).filter(Boolean).map(t => t.id);
        const picked = await WB.ui.pickEntry({ title: 'Add to the fight', types, multi: true });
        if (!picked || !picked.length) return;
        for (const e of picked) S.combatants.push(await fromEntry(e));
        log('Joined: ' + picked.map(e => e.title).join(', '), 'join');
        save(); paint();
      }
      async function addFoes() {
        const ids = (enc.fields && enc.fields.foes) || [];
        if (!ids.length) return ui.toast('This encounter lists no foes', 'ℹ');
        for (const id of ids) { const e = await WB.api('entries.get', id).catch(() => null); if (e) S.combatants.push(await fromEntry(e, 'foe')); }
        log('The foes join', 'join'); save(); paint();
      }
      async function addHand() {
        const v = { name: '', count: 1, hp: 10, ac: 12, mod: 0, side: 'foe' };
        const num = (k, label, min) => { const i = ui.input({ type: 'number', value: v[k], onInput: x => { v[k] = +x; } }); if (min != null) i.min = min; return ui.field({ label, control: i }); };
        const nameIn = ui.input({ placeholder: 'e.g. Gull runner', onInput: x => { v.name = x; } });
        const body = h('div.tl-form', [ui.field({ label: 'Name', control: nameIn }), h('div.tl-form-row', [num('count', 'How many', 1), num('hp', 'Hit points', 1), num('ac', 'Armour', 0), num('mod', 'Initiative bonus')]),
          ui.field({ label: 'Side', control: ui.segmented({ value: v.side, options: SIDES.map(([k, l]) => [k, l]), onChange: x => { v.side = x; } }) })]);
        nameIn.addEventListener('keydown', e => { if (e.key === 'Enter') e.target.closest('.gk-dialog').querySelector('.gk-panel-foot .primary').click(); });
        const ok = await ui.dialog({ title: 'Add combatants', icon: '⚔', body, actions: [{ label: 'Cancel', value: false }, { label: 'Add', kind: 'primary', value: true }] });
        if (!ok) return;
        const n = Math.max(1, Math.min(30, v.count || 1)), base = v.name.trim() || 'Combatant';
        for (let i = 0; i < n; i++) S.combatants.push({ id: uid(), name: n > 1 ? base + ' ' + (i + 1) : base, entryId: null, side: v.side, init: null, mod: v.mod || 0, hp: Math.max(1, v.hp || 1), maxHp: Math.max(1, v.hp || 1), temp: 0, ac: v.ac, conditions: [], notes: '', attacks: [] });
        log('Joined: ' + (n > 1 ? n + '× ' : '') + base, 'join'); save(); paint();
      }

      /* ---- initiative & turns ---- */
      function rollInit(which) {
        const list = S.combatants.filter(c => which === 'all' || (which === 'missing' && c.init == null) || (which === 'foes' && c.side === 'foe'));
        if (!list.length) return ui.toast('Everyone already has initiative', 'ℹ');
        for (const c of list) c.init = WB.dice.roll('1d20' + (c.mod ? signed(c.mod) : '')).total;
        log('Initiative: ' + order().filter(c => list.includes(c)).map(c => c.name + ' ' + c.init).join(', '), 'init');
        save(); paint();
      }
      function start() {
        if (!S.combatants.length) return;
        if (S.combatants.some(c => c.init == null)) rollInit('missing');
        S.round = 1; S.turnId = order()[0].id;
        log('Round 1 — ' + current().name + ' acts first', 'round');
        save(); paint();
      }
      const out = c => c.side === 'foe' && c.hp <= 0;
      function next() {
        if (!S.round) return start();
        const o = order(); if (!o.length) return;
        const cur = current();
        if (cur) tick(cur);
        let i = o.findIndex(c => c.id === S.turnId), guard = 0;
        do { i++; if (i >= o.length) { i = 0; S.round++; log('Round ' + S.round, 'round'); } } while (out(o[i]) && guard++ < o.length);
        S.turnId = o[i].id;
        save(); paint();
      }
      function prev() {
        if (!S.round) return;
        const o = order(); let i = o.findIndex(c => c.id === S.turnId);
        i--; if (i < 0) { if (S.round <= 1) return; S.round--; i = o.length - 1; }
        S.turnId = o[i].id; save(); paint();
      }
      /** at the end of a combatant's turn its timed conditions count down */
      function tick(c) {
        const gone = [];
        c.conditions = c.conditions.map(x => (x.rounds == null ? x : Object.assign({}, x, { rounds: x.rounds - 1 }))).filter(x => { if (x.rounds != null && x.rounds <= 0) { gone.push(x.name); return false; } return true; });
        if (gone.length) log(c.name + ' is no longer ' + gone.join(', ').toLowerCase(), 'condition');
      }
      function hurt(c, amount, heal) {
        amount = Math.abs(Math.round(+amount || 0)); if (!amount) return;
        const before = c.hp;
        if (heal) { c.hp = Math.min(c.maxHp || c.hp + amount, c.hp + amount); log(c.name + ' heals ' + (c.hp - before) + ' (' + c.hp + '/' + c.maxHp + ')', 'heal'); }
        else {
          let left = amount;
          if (c.temp > 0) { const t = Math.min(c.temp, left); c.temp -= t; left -= t; }
          c.hp = c.hp - left;
          log(c.name + ' takes ' + amount + (c.hp <= 0 && before > 0 ? ' and falls' : '') + ' (' + Math.max(c.hp, 0) + '/' + c.maxHp + ')', c.hp <= 0 && before > 0 ? 'down' : 'hit');
          if (c.hp <= 0 && c.side !== 'foe' && !c.conditions.some(x => x.name === 'Unconscious')) c.conditions.push({ name: 'Unconscious', rounds: null });
        }
        if (heal && before <= 0 && c.hp > 0) c.conditions = c.conditions.filter(x => x.name !== 'Unconscious');
        save(); paint();
      }
      async function end() {
        if (!S.round && !S.log.length) return ui.toast('This fight has not started', 'ℹ');
        const fallen = S.combatants.filter(c => c.hp <= 0), standing = S.combatants.filter(c => c.hp > 0);
        let resetHp = true;
        const body = h('div.gk-stack', [
          h('p.gk-text', { text: 'Over in ' + Math.max(1, S.round) + (S.round === 1 ? ' round' : ' rounds') + '. ' + (fallen.length ? 'Fallen: ' + fallen.map(c => c.name).join(', ') + '.' : 'Nobody fell.') }),
          h('p.gk-small.gk-muted', { text: 'The battle log is added to the encounter' + (TK.logToSession ? ' and to the running session, if there is one' : '') + '.' }),
          ui.field({ label: 'Restore hit points and clear conditions for next time', inline: true, control: ui.toggle({ value: true, onChange: v => { resetHp = v; } }) }),
        ]);
        const ok = await ui.dialog({ title: 'End the encounter?', icon: '⚑', body, actions: [{ label: 'Keep fighting', value: false }, { label: 'End encounter', kind: 'primary', value: true }] });
        if (!ok) return;
        log('The encounter ends after ' + Math.max(1, S.round) + ' rounds', 'end');
        const when = WB.fmt.date(WB.now), real = new Date().toLocaleDateString();
        const lines = S.log.filter(x => x.kind !== 'init').slice(-120).map(x => '<li>' + (x.kind === 'round' ? '<strong>' + WB.esc(x.text) + '</strong>' : WB.esc(x.text)) + '</li>').join('');
        const html = '<h3>Battle — ' + WB.esc(when) + ' (played ' + WB.esc(real) + ')</h3><p>' + Math.max(1, S.round) + ' rounds. Standing: ' + WB.esc(standing.map(c => c.name).join(', ') || 'nobody') + '. Fallen: ' + WB.esc(fallen.map(c => c.name).join(', ') || 'nobody') + '.</p><ul>' + lines + '</ul>';
        const full = await WB.api('entries.get', enc.id);
        if (TK.logToSession) TK.logToSession({ kind: 'combat', text: 'Fought “' + enc.title + '”: ' + Math.max(1, S.round) + ' rounds' + (fallen.length ? '; fallen: ' + fallen.map(c => c.name).join(', ') : ''), ref: enc.id });
        if (resetHp) S.combatants.forEach(c => { c.hp = c.maxHp; c.temp = 0; c.conditions = []; c.init = null; });
        S.round = 0; S.turnId = null; S.log = [];
        dirty = false; saveNow.cancel && saveNow.cancel();
        const d = pack(); lastSaved = JSON.stringify(d);
        await WB.api('entries.update', enc.id, { body: (full.body || '') + html, dataPatch: d });
        TK.toast('Battle log added to “' + enc.title + '”', [{ label: 'Open', onClick: () => WB.open(enc.id) }]);
        paint();
      }

      /* ---- painting ---- */
      let listBox = null, logBox = null;
      function paint() {
        GK.clear(main);
        const ro = WB.share;
        const cur = current();
        const loc = enc.fields && enc.fields.location;
        const head = h('section.gk-widget.tl-init-head', [
          h('div.tl-init-headrow', [
            h('span.tl-hero-ico', { text: '⚔' }),
            h('div.gk-grow', [h('div.tl-town-kicker', { text: 'Encounter' + (enc.fields && enc.fields.difficulty ? ' · ' + enc.fields.difficulty : '') }), h('h3.tl-init-title', [WB.ui.chip(enc, { noMenu: false })]), loc ? h('div.gk-small.gk-muted', ['at ', WB.ui.chip(loc, { size: 'sm' })]) : null]),
            h('div.tl-round', [h('div.tl-stat-label', { text: S.round ? 'Round' : 'Not started' }), h('div.tl-round-n', { text: S.round ? String(S.round) : '–' }), cur ? h('div.gk-small', ['Turn: ', h('b', { text: cur.name })]) : null]),
          ]),
          ro ? null : h('div.tl-init-actions', [
            S.round ? ui.group([ui.button({ icon: '◀', title: 'Previous turn (P)', onClick: prev }), ui.button({ label: 'Next turn', icon: '▶', kind: 'primary', title: 'Next turn (N)', onClick: next })])
              : ui.button({ label: 'Start the fight', icon: '▶', kind: 'primary', title: 'Roll missing initiative and begin round 1 (N)', onClick: start, disabled: !S.combatants.length }),
            ui.button({ label: 'Initiative', icon: '⚄', title: 'Roll initiative', onClick: e => WB.ui.menu([
              { label: 'Roll for those without', icon: '⚄', onClick: () => rollInit('missing') },
              { label: 'Roll for the foes', icon: '⚄', onClick: () => rollInit('foes') },
              { label: 'Re-roll everyone', icon: '⟳', onClick: () => rollInit('all') },
            ], e) }),
            ui.button({ label: 'Add', icon: '＋', title: 'Add combatants', onClick: e => WB.ui.menu([
              { label: 'Characters or creatures…', icon: '☺', hint: 'Their stats (hp, ac, init) come along', onClick: addEntries },
              (enc.fields && enc.fields.foes || []).length ? { label: 'The encounter\'s foes', icon: '⚔', onClick: addFoes } : null,
              { label: 'By hand…', icon: '✎', onClick: addHand },
            ], e) }),
            h('span.gk-grow'),
            S.round || S.log.length ? ui.button({ label: 'End encounter', icon: '⚑', onClick: end }) : null,
          ]),
        ]);
        listBox = h('div.tl-cmbs', { role: 'list' });
        const o = order();
        if (!o.length) listBox.appendChild(WB.ui.empty({ icon: '☺', title: 'Nobody here yet', text: 'Add the party and the foes — from your characters and creatures (their stat blocks come along) or by hand.',
          actions: ro ? [] : [ui.button({ label: 'Add characters or creatures…', icon: '＋', kind: 'primary', onClick: addEntries }), (enc.fields && enc.fields.foes || []).length ? ui.button({ label: 'Add the encounter\'s foes', onClick: addFoes }) : null, ui.button({ label: 'Add by hand…', onClick: addHand })].filter(Boolean) }));
        for (const c of o) listBox.appendChild(row(c, c.id === S.turnId, ro));
        logBox = h('div.tl-init-log', { role: 'log' });
        paintLog();
        const summary = h('div.tl-init-sum.gk-small', SIDES.map(([k, l, col]) => { const g = S.combatants.filter(c => c.side === k); if (!g.length) return null; const up = g.filter(c => c.hp > 0).length; return h('span.tl-side-sum', { style: { '--c': col } }, [h('i'), l + ' ' + up + '/' + g.length]); }).filter(Boolean));
        main.append(head, h('div.tl-init-body', [h('div.tl-init-listcol', [summary, listBox]), TK.card({ title: 'Battle log', icon: '◷', body: logBox, cls: 'tl-init-logcard' })]));
        if (cur) { const el = listBox.querySelector('.tl-cmb.on'); if (el) requestAnimationFrame(() => el.scrollIntoView({ block: 'nearest' })); }
      }
      function paintLog() {
        GK.clear(logBox);
        if (!S.log.length) logBox.appendChild(h('div.gk-small.gk-muted', { text: 'Rounds, hits, falls and conditions are written here as you play.' }));
        for (const x of S.log.slice(-200).reverse()) logBox.appendChild(h('div.tl-log-row', { class: 'k-' + (x.kind || 'note') }, [h('span.gk-tiny.gk-muted', { text: x.r ? 'R' + x.r : '' }), h('span', { text: x.text })]));
      }
      function row(c, on, ro) {
        const pctHp = c.maxHp ? Math.max(0, Math.min(1, c.hp / c.maxHp)) : 0;
        const tone = c.hp <= 0 ? 'down' : pctHp <= 0.25 ? 'low' : pctHp <= 0.5 ? 'mid' : 'ok';
        const initIn = h('input.tl-init-in', { type: 'number', value: c.init == null ? '' : c.init, placeholder: '–', title: 'Initiative (bonus ' + signed(c.mod || 0) + ')', readOnly: ro });
        initIn.addEventListener('change', () => { c.init = initIn.value === '' ? null : +initIn.value; save(); paint(); });
        const amt = h('input.tl-hp-in', { type: 'number', min: 0, placeholder: '0', title: 'Amount — Enter damages, Shift+Enter heals', readOnly: ro });
        amt.addEventListener('keydown', e => { if (e.key === 'Enter') { e.preventDefault(); hurt(c, amt.value, e.shiftKey); } });
        const name = c.entryId ? WB.ui.chip(c.entryId, { size: 'sm' }) : h('b.tl-cmb-name', { text: c.name });
        if (c.entryId) { const lbl = name.querySelector('.wb-chip-lbl'); if (lbl) lbl.textContent = c.name; }
        const conds = h('div.tl-conds', c.conditions.map(x => h('span.tl-cond', { title: x.rounds == null ? 'Until removed' : x.rounds + ' round' + (x.rounds === 1 ? '' : 's') + ' left' }, [h('span', { text: x.name }), x.rounds != null ? h('b', { text: String(x.rounds) }) : null,
          ro ? null : h('button.wb-chip-x', { type: 'button', text: '✕', title: 'Remove', onclick: () => { c.conditions = c.conditions.filter(y => y !== x); log(c.name + ' is no longer ' + x.name.toLowerCase(), 'condition'); save(); paint(); } })])));
        if (!ro) conds.appendChild(h('button.tl-cond-add', { type: 'button', text: '＋ condition', onclick: e => condMenu(c, e) }));
        const atk = c.attacks && c.attacks.length ? h('div.tl-atks', c.attacks.map(a => h('button.tl-atk.gk-control', { type: 'button', title: 'Roll ' + a.dice, onclick: () => { const r = TK.roll(a.dice, c.name + ': ' + a.label); log(c.name + ' — ' + a.label + ': ' + r.total + ' (' + a.dice + ')', 'roll'); save(); paintLog(); ui.toast(c.name + ' · ' + a.label + ': ' + r.total + '   ' + r.text, '⚄', 4000); } }, [h('span', { text: a.label }), h('code', { text: a.dice })]))) : null;
        const notes = h('input.tl-cmb-notes', { value: c.notes || '', placeholder: 'Notes', readOnly: ro });
        notes.addEventListener('change', () => { c.notes = notes.value; save(); });
        const el = h('div.tl-cmb', { role: 'listitem', class: (on ? 'on ' : '') + (c.hp <= 0 ? 'down' : ''), style: { '--c': SIDE[c.side] ? SIDE[c.side].color : '#9aa5b1' } }, [
          h('div.tl-cmb-init', [on ? h('span.tl-turn', { text: '▶', title: 'Their turn' }) : null, initIn]),
          h('div.tl-cmb-main', [
            h('div.tl-cmb-top', [name, h('span.wb-badge.tl-side-badge', { text: SIDE[c.side] ? SIDE[c.side].label : c.side }), c.hp <= 0 ? h('span.wb-badge.bad', { text: c.side === 'foe' ? 'defeated' : 'down' }) : null, h('span.gk-grow'),
              c.ac != null ? h('span.tl-ac', { title: 'Armour' }, [h('span', { text: '⛨' }), String(c.ac)]) : null]),
            h('div.tl-hp', { class: 'tone-' + tone }, [
              h('div.tl-hp-bar', { title: c.hp + ' of ' + c.maxHp + ' hit points' + (c.temp ? ' (+' + c.temp + ' temporary)' : '') }, [h('i', { style: { width: pctHp * 100 + '%' } }), c.temp ? h('u', { style: { width: Math.min(1, c.temp / (c.maxHp || 1)) * 100 + '%' } }) : null]),
              h('span.tl-hp-text', [h('b', { text: String(c.hp) }), '/' + c.maxHp, c.temp ? h('span.gk-muted', { text: ' +' + c.temp }) : null]),
              ro ? null : h('div.tl-hp-ctl', [amt, ui.button({ label: 'Hit', small: true, kind: 'danger', title: 'Damage by the amount (Enter)', onClick: () => hurt(c, amt.value || 0) }), ui.button({ label: 'Heal', small: true, title: 'Heal by the amount (Shift+Enter)', onClick: () => hurt(c, amt.value || 0, true) })]),
            ]),
            h('div.tl-cmb-extra', [conds, atk]),
            c.notes || !ro ? notes : null,
          ]),
          ro ? null : ui.button({ icon: '⋯', small: true, kind: 'ghost', title: 'More', onClick: e => rowMenu(c, e) }),
        ]);
        return el;
      }
      function condMenu(c, e) {
        const add = (name, rounds) => { c.conditions = c.conditions.filter(x => x.name !== name).concat([{ name, rounds }]); log(c.name + ' is ' + name.toLowerCase() + (rounds ? ' for ' + rounds + (rounds === 1 ? ' round' : ' rounds') : ''), 'condition'); save(); paint(); };
        WB.ui.menu(CONDITIONS.map(n => ({ label: n, sub: [{ label: 'Until removed', onClick: () => add(n, null) }, { label: '1 round', onClick: () => add(n, 1) }, { label: '2 rounds', onClick: () => add(n, 2) }, { label: '3 rounds', onClick: () => add(n, 3) }, { label: '1 minute (10 rounds)', onClick: () => add(n, 10) }] })).concat(['-', { label: 'Another…', icon: '✎', onClick: async () => { const n = await ui.prompt('Condition', '', 'e.g. Cursed'); if (n) add(n, null); } }]), e);
      }
      function rowMenu(c, e) {
        WB.ui.menu([
          { label: 'Re-roll initiative', icon: '⚄', onClick: () => { c.init = WB.dice.roll('1d20' + (c.mod ? signed(c.mod) : '')).total; log(c.name + ' re-rolls initiative: ' + c.init, 'init'); save(); paint(); } },
          { label: 'Side', icon: '◐', sub: SIDES.map(([k, l]) => ({ label: l, checked: c.side === k, onClick: () => { c.side = k; save(); paint(); } })) },
          { label: 'Temporary hit points…', icon: '✚', onClick: async () => { const v = await ui.prompt('Temporary hit points for ' + c.name, String(c.temp || ''), 'e.g. 5'); if (v != null) { c.temp = Math.max(0, +v || 0); save(); paint(); } } },
          { label: 'Hit points and armour…', icon: '✎', onClick: async () => { const v = await ui.prompt('Max hit points / armour for ' + c.name, c.maxHp + ' / ' + (c.ac == null ? '' : c.ac), 'e.g. 24 / 14'); if (v) { const [m, a] = v.split('/').map(x => x.trim()); if (+m > 0) { c.hp = Math.min(c.hp, +m) || +m; c.maxHp = +m; } if (a !== undefined) c.ac = a === '' ? null : +a; save(); paint(); } } },
          { label: 'Rename…', icon: '✎', onClick: async () => { const v = await ui.prompt('Name', c.name); if (v) { c.name = v; save(); paint(); } } },
          { label: 'Duplicate', icon: '⧉', onClick: () => { const d = JSON.parse(JSON.stringify(c)); d.id = uid(); d.name = c.name.replace(/\s\d+$/, '') + ' ' + (S.combatants.filter(x => x.name.replace(/\s\d+$/, '') === c.name.replace(/\s\d+$/, '')).length + 1); d.init = null; d.hp = d.maxHp; d.conditions = []; S.combatants.push(d); save(); paint(); } },
          c.entryId ? { label: 'Peek at the entry', icon: '◫', onClick: () => WB.peek(c.entryId) } : null,
          '-',
          { label: 'Remove from the fight', icon: '🗑', danger: true, onClick: () => { const old = JSON.stringify(S); const wasTurn = S.turnId === c.id; if (wasTurn) next(); S.combatants = S.combatants.filter(x => x !== c); log(c.name + ' leaves the fight', 'leave'); save(); paint(); WB.ui.undoToast(c.name + ' removed', () => { S = JSON.parse(old); save(); paint(); }); } },
        ], e);
      }

      /* ---- wiring ---- */
      const list = await side.refresh();
      if (sel && !list.find(e => e.id === sel)) sel = null;
      if (!sel && list[0]) sel = list[0].id;
      side.select(sel);
      await select(sel);
      offs.push(WB.onChange(['entries'], async p => {
        await side.refresh();
        if (enc && (p.ids || []).includes(enc.id) && !dirty) {
          const fresh = await WB.api('entries.get', enc.id).catch(() => null);
          if (!fresh || fresh.deletedAt) return select(null);
          const theirs = JSON.stringify({ combatants: fresh.data.combatants || [], round: fresh.data.round || 0, turnId: fresh.data.turnId || null, log: (fresh.data.log || []).slice(-400) });
          enc = fresh;
          if (theirs !== lastSaved && !main.contains(document.activeElement)) select(enc.id);
        }
      }));
      offs.push(TK.keys(host, e => {
        if (TK.isTyping(e) || e.ctrlKey || e.altKey || e.metaKey || !enc || WB.share) return;
        if (e.key === 'n' || e.key === 'N') { e.preventDefault(); next(); }
        else if (e.key === 'p' || e.key === 'P') { e.preventDefault(); prev(); }
      }));
      return () => { offs.forEach(f => f()); if (dirty) saveNow.flush(); };
    },
  };
})();
