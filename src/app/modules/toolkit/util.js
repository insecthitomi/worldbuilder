/* Toolkit helpers shared by the tools: cards, a side list of entries of one type, scoped keyboard shortcuts. */
(function () {
  'use strict';
  const GK = window.GK, WB = window.WB, h = GK.h, ui = GK.ui, TK = WB.toolkit;

  /** a glass card: { title, icon, sub, actions[], body, cls } */
  TK.card = ({ title, icon, sub, actions, body, cls } = {}) => h('section.gk-widget.tl-card', { class: cls || '' }, [
    title || actions ? h('div.tl-card-head', [icon ? h('span.tl-card-ico', { text: icon }) : null, h('div.gk-grow', [title ? h('h4', { text: title }) : null, sub ? h('div.gk-tiny.gk-muted', { text: sub }) : null]), actions && actions.length ? h('div.gk-row.nowrap.tl-card-actions', actions.filter(Boolean)) : null]) : null,
    h('div.tl-card-body', [].concat(body || []).filter(Boolean)),
  ]);
  TK.isTyping = e => !!(e.target && e.target.closest && e.target.closest('input, textarea, select, [contenteditable="true"]'));
  /** keyboard shortcuts while el is on screen and no dialog covers it (unless el is inside that dialog) */
  TK.keys = (el, fn, keyTarget) => {
    const on = e => {
      if (!el.isConnected) return;
      const scrims = document.querySelectorAll('.gk-scrim'), top = scrims[scrims.length - 1];
      if (top && !top.contains(el)) return;
      if (document.querySelector('.wb-pop')) return;
      fn(e);
    };
    const target = keyTarget || document;   // a dialog listens on its own scrim so keys never reach the screen below
    target.addEventListener('keydown', on);
    return () => target.removeEventListener('keydown', on);
  };
  TK.copy = async (text, what) => { try { await navigator.clipboard.writeText(text); ui.toast((what || 'Text') + ' copied', '⎘'); } catch (e) { WB.fail(e); } };
  TK.time = iso => { const d = new Date(iso); return isNaN(d) ? '' : String(d.getHours()).padStart(2, '0') + ':' + String(d.getMinutes()).padStart(2, '0'); };
  TK.ago = iso => (WB.fmt.rel ? WB.fmt.rel(iso) : TK.time(iso));
  TK.typeOk = key => { const t = WB.type(key); return !!(t && !t.hidden); };

  /** a side list of the world's entries of one type with a filter and a New button
   *  o: { typeKey, selected, onSelect(entry), newLabel, onNew(), sub(entry) → text, empty: { icon, title, text } } → { el, refresh(), select(id) } */
  TK.entryList = (o) => {
    let q = '', list = [], sel = o.selected || null;
    const rows = h('div.tl-elist-rows', { role: 'listbox' });
    const count = h('span.gk-tiny.gk-muted');
    const paint = () => {
      GK.clear(rows);
      const ql = q.toLowerCase();
      const shown = list.filter(e => !ql || e.title.toLowerCase().includes(ql) || (e.summary || '').toLowerCase().includes(ql));
      for (const e of shown) rows.appendChild(WB.ui.row(e, { active: e.id === sel, sub: o.sub ? o.sub(e) : e.summary || '', onClick: (x, ev) => { if (ev && (ev.ctrlKey || ev.metaKey)) return WB.peek(x.id); sel = x.id; paint(); o.onSelect && o.onSelect(x); } }));
      if (!shown.length) rows.appendChild(h('div.tl-elist-none.gk-small.gk-muted', { text: q ? 'Nothing matches “' + q + '”.' : (o.empty && o.empty.text) || 'Nothing here yet.' }));
      count.textContent = list.length ? String(list.length) : '';
    };
    const refresh = async () => {
      const t = WB.type(o.typeKey);
      list = t ? (await WB.api('entries.list', WB.worldId, { typeIds: [t.id], sort: o.sort || 'title' }).catch(() => [])).filter(e => WB.visible(e)) : [];
      paint();
      return list;
    };
    const el = h('div.tl-elist', [
      h('div.tl-elist-head', [WB.ui.search({ placeholder: 'Filter', onInput: v => { q = v; paint(); } }), o.onNew && !WB.share ? ui.button({ icon: '＋', small: true, title: o.newLabel || 'New', onClick: () => o.onNew() }) : null]),
      rows,
    ]);
    WB.ui.listKeys(rows);
    return { el, refresh, list: () => list, select: id => { sel = id; paint(); }, count };
  };

  /** stats of an entry from its 'stats' fields → { hp, ac, init, mod, attacks: [{ label, dice }], all } */
  TK.statsOf = (e) => {
    const t = WB.typeOf(e), all = {};
    for (const d of (t && t.fields) || []) if (d.kind === 'stats') for (const s of (e.fields && e.fields[d.key]) || []) if (s && s.label) all[String(s.label).trim().toLowerCase()] = String(s.value || '').trim();
    const num = (...keys) => { for (const k of keys) if (all[k] != null && all[k] !== '' && !isNaN(parseInt(all[k], 10))) return parseInt(all[k], 10); return null; };
    const dex = num('dex', 'dexterity', 'agi', 'agility');
    const init = num('init', 'initiative');
    const attacks = Object.entries(all).filter(([k, v]) => !['hp', 'ac', 'init'].includes(k) && /^\s*\d*d\d+/i.test(v) && WB.dice.valid(v.replace(/\s*\(.*$/, ''))).map(([k, v]) => ({ label: k.charAt(0).toUpperCase() + k.slice(1), dice: v.replace(/\s*\(.*$/, '') }));
    return { hp: num('hp', 'hit points', 'health', 'hits'), ac: num('ac', 'armour class', 'armor class', 'armour', 'defence', 'defense'), mod: init != null ? init : dex != null ? Math.floor((dex - 10) / 2) : 0, attacks, all };
  };
})();
