/* Web: helpers shared by the graph, family tree, relations table and matrix — relation wording, link dates,
   resolved colours for canvases, entry slots and the "new relation" dialog. */
(function () {
  'use strict';
  const { h, ui } = GK, U = WB.ui;
  const P = WB.webParts = WB.webParts || {};
  const C = P.common = {};

  C.CATS = (WB.F && WB.F.CATEGORIES) || [['family', 'Family'], ['social', 'Social'], ['political', 'Political'], ['spatial', 'Places'], ['other', 'Other']];
  C.catName = c => (C.CATS.find(x => x[0] === c) || [c, c])[1];
  C.CAT_COLOR = { family: '#e0796b', social: '#5fb38a', political: '#c49a3c', spatial: '#6fa7d8', other: '#9aa5b1' };

  /** share-aware options for main handlers */
  C.audience = () => (WB.share ? { audience: 'shared', asOf: WB.now.day } : {});
  C.editable = () => !WB.share;

  /* ---------------- relation wording ---------------- */
  /** a relation link as read from one end: "parent of" from src, "child of" from dst */
  C.relLabel = (link, from) => {
    const r = WB.rel(link.relId) || { name: link.name || 'related to', inverse: link.inverse || link.name || 'related to' };
    return from === link.dst && link.src !== link.dst ? r.inverse : r.name;
  };
  /** every way to say a relation from A to B: [{ relId, swap, text, cat, color, sym }] (swap = store it as B → A) */
  C.relOptions = () => {
    const out = [];
    for (const r of WB.relTypes) {
      out.push({ relId: r.id, swap: false, text: r.name, cat: r.category, color: r.color, sym: r.symmetric, role: r.familyRole });
      if (!r.symmetric && r.inverse && r.inverse !== r.name) out.push({ relId: r.id, swap: true, text: r.inverse, cat: r.category, color: r.color, sym: false, role: r.familyRole });
    }
    return out;
  };
  C.relByName = name => WB.relTypes.find(r => r.name === name) || null;
  /* the relations that usually fit two kinds of entry (by built-in names; worlds that renamed them just get no hints) */
  const SUGGEST = {
    'character>character': ['parent of', 'child of', 'spouse of', 'sibling of', 'friend of', 'rival of', 'enemy of', 'lover of', 'mentor of', 'serves'],
    'character>faction': ['member of', 'leader of', 'serves', 'founded', 'spy for', 'owes a debt to', 'enemy of'],
    'faction>character': ['has member', 'led by', 'served by', 'founded by', 'has spy', 'is owed by'],
    'character>place': ['lives in', 'born in', 'rules', 'buried in', 'founded'],
    'place>character': ['home of', 'birthplace of', 'ruled by', 'resting place of', 'founded by'],
    'faction>faction': ['ally of', 'at war with', 'vassal of', 'liege of', 'rival of', 'enemy of', 'member of'],
    'faction>place': ['rules', 'founded', 'lives in'],
    'place>faction': ['ruled by', 'founded by', 'home of'],
    'place>place': ['vassal of', 'liege of', 'ally of', 'at war with', 'related to'],
    'character>item': ['owns', 'created'], 'item>character': ['owned by', 'created by'],
    'faction>item': ['owns', 'created'], 'item>faction': ['owned by', 'created by'],
    'character>lore': ['worships', 'created'], 'faction>lore': ['worships', 'created'], 'culture>lore': ['worships'],
    'character>species': ['related to'], 'character>culture': ['member of'], 'character>event': ['caused'], 'event>event': ['caused', 'caused by'],
  };
  C.suggest = (a, b) => {
    const ka = (WB.typeOf(WB.liteOf(a)) || {}).key, kb = (WB.typeOf(WB.liteOf(b)) || {}).key;
    const names = SUGGEST[ka + '>' + kb] || [];
    const opts = C.relOptions();
    return names.map(n => opts.find(o => o.text === n)).filter(Boolean);
  };
  C.familyRel = role => WB.relTypes.find(r => r.familyRole === role && r.builtin) || WB.relTypes.find(r => r.familyRole === role) || null;

  /* ---------------- dates on links (stored as day numbers) ---------------- */
  /** a link day as a date value; the first day of a year or month reads as that year or month */
  C.dayDate = day => {
    if (day == null || !WB.cal) return null;
    const p = WB.cal.ymd(day);
    return { day, min: null, prec: p.m === 0 && p.d === 1 ? 'year' : p.d === 1 ? 'month' : 'day' };
  };
  C.linkSpan = l => {
    const a = C.dayDate(l.startDay != null ? l.startDay : l.start), b = C.dayDate(l.endDay != null ? l.endDay : l.end);
    if (!a && !b) return '';
    return WB.fmt.range(a, b);
  };

  /* ---------------- colours a canvas can use ---------------- */
  const probeCanvas = document.createElement('canvas').getContext('2d');
  /** any CSS colour (oklch, color-mix …) as something a 2d canvas understands */
  C.canvasColor = (css, fallback = '#888888') => {
    probeCanvas.fillStyle = '#010203';
    probeCanvas.fillStyle = css;
    const v = probeCanvas.fillStyle;
    return v === '#010203' && !/^#010203$/i.test(css) ? fallback : v;
  };
  /** the tokens of a surface, resolved: { text, muted, faint, line, accent, bg, warn, bad, good, font, fs } */
  C.tokens = el => {
    const probe = el.appendChild(h('span', { style: { position: 'absolute', visibility: 'hidden', pointerEvents: 'none' } }));
    const read = v => { probe.style.color = 'var(' + v + ')'; return C.canvasColor(getComputedStyle(probe).color); };
    const cs = getComputedStyle(el);
    let bg = cs.backgroundColor;
    for (let x = el; x && (!bg || /rgba\(0, 0, 0, 0\)|transparent/.test(bg)); x = x.parentElement) bg = getComputedStyle(x).backgroundColor;
    const out = { text: read('--text'), muted: read('--muted'), faint: read('--faint'), line: read('--line2'), accent: read('--accent'), warn: read('--warn'), bad: read('--bad'), good: read('--good'), bg: C.canvasColor(bg || '#101820'), font: cs.fontFamily, fs: parseFloat(cs.fontSize) || 14 };
    probe.remove();
    return out;
  };
  /** '#rrggbb' → [r, g, b] (0–255) */
  C.rgb = c => {
    const m = /^#?([0-9a-f]{6})$/i.exec(String(c || '').trim());
    if (m) { const n = parseInt(m[1], 16); return [n >> 16 & 255, n >> 8 & 255, n & 255]; }
    const r = /rgba?\(\s*([\d.]+)[ ,]+([\d.]+)[ ,]+([\d.]+)/i.exec(String(c || ''));
    return r ? [+r[1], +r[2], +r[3]] : [136, 136, 136];
  };
  C.ink = c => { const [r, g, b] = C.rgb(c); return (0.299 * r + 0.587 * g + 0.114 * b) > 150 ? '#10161f' : '#ffffff'; };
  C.alpha = (c, a) => { const [r, g, b] = C.rgb(C.canvasColor(c)); return 'rgba(' + r + ',' + g + ',' + b + ',' + a + ')'; };
  /** data colours for groups (communities) */
  C.GROUPS = ['#e0796b', '#5fb38a', '#6fa7d8', '#e2b33d', '#b07ad6', '#4fb6b2', '#d6739c', '#c7835b', '#8c9fe0', '#9bbf4a', '#e08b4f', '#7a8291'];

  /* ---------------- small pieces ---------------- */
  C.surname = title => { const p = String(title || '').trim().split(/\s+/); return p.length > 1 ? p[p.length - 1] : ''; };
  C.entryOf = id => WB.liteOf(id);
  /** a slot showing a chosen entry or a "Choose…" button; onPick(entry|null) */
  C.slot = ({ id, placeholder = 'Choose…', title = 'Choose an entry', types, onPick, clear = true }) => {
    const box = h('div.web-slot');
    const paint = () => {
      GK.clear(box);
      if (id && WB.liteOf(id)) GK.append(box, [U.chip(id, { size: 'sm' }), ui.button({ icon: '✎', small: true, kind: 'ghost', title: 'Choose someone else', onClick: pick }), clear ? ui.button({ icon: '✕', small: true, kind: 'ghost', title: 'Clear', onClick: () => { id = null; paint(); onPick(null); } }) : null]);
      else box.append(ui.button({ label: placeholder, icon: '＋', small: true, onClick: pick }));
    };
    async function pick() {
      const e = await U.pickEntry({ title, types: (types || []).map(k => (WB.type(k) || {}).id).filter(Boolean) });
      if (!e) return;
      id = e.id; paint(); onPick(e);
    }
    paint();
    box.set = v => { id = v; paint(); };
    box.pick = pick;
    return box;
  };

  /** two labelled slots with a swap button between them */
  C.ends = (slotA, slotB, la, lb, onSwap) => h('div.web-path-ends', [
    h('span.web-end-label', { text: la }), slotA,
    onSwap ? ui.button({ icon: '⇅', small: true, kind: 'ghost', title: 'Swap the two', onClick: onSwap }) : h('span'),
    h('span.web-end-label', { text: lb }), slotB,
  ]);

  /* ---------------- the "new relation" dialog ---------------- */
  /** opts: { a, b, relId, swap, note, start, end, title } → the new link or null */
  C.addRelation = function (opts = {}) {
    if (WB.share) { ui.toast('Leave Share view to edit relations', '◑'); return Promise.resolve(null); }
    return new Promise(resolve => {
      let a = opts.a || null, b = opts.b || null, choice = null, note = opts.note || '', start = opts.start || null, end = opts.end || null, q = '', done = false;
      const all = C.relOptions();
      if (opts.relId) choice = all.find(o => o.relId === opts.relId && !!o.swap === !!opts.swap) || null;
      const finish = v => { if (done) return; done = true; scrim.remove(); document.removeEventListener('keydown', onKey, true); resolve(v); };
      const slotA = C.slot({ id: a, placeholder: 'Choose the first entry', title: 'Relation from…', clear: false, onPick: e => { a = e && e.id; sentence(); paintList(); } });
      const slotB = C.slot({ id: b, placeholder: 'Choose the second entry', title: 'Relation to…', clear: false, onPick: e => { b = e && e.id; sentence(); paintList(); } });
      const say = h('p.web-rel-sentence');
      const list = h('div.web-rel-options', { role: 'listbox' });
      const paintList = () => {
        GK.clear(list);
        const ql = q.trim().toLowerCase();
        const sugg = a && b && !ql ? C.suggest(a, b) : [];
        const groups = (sugg.length ? [['~', 'Suggested for these two', sugg]] : []).concat(C.CATS.map(([cat, label]) => [cat, label, all.filter(o => o.cat === cat && (!ql || o.text.toLowerCase().includes(ql)))]));
        for (const [cat, label, opts2] of groups) {
          if (!opts2.length) continue;
          list.appendChild(h('div.web-rel-cat', { class: cat === '~' ? 'sugg' : '', text: label }));
          for (const o of opts2) {
            const btn = h('button.web-rel-opt', { type: 'button', role: 'option', class: o === choice ? 'on' : '', style: { '--c': o.color || C.CAT_COLOR[o.cat] }, title: o.sym ? 'Works both ways' : o.swap ? 'Stored the other way round' : '' }, [
              h('span.web-rel-sw'), h('span.gk-grow', { text: o.text }), o.sym ? h('span.gk-faint.gk-small', { text: '⇄' }) : null,
            ]);
            btn.addEventListener('click', () => { choice = o; paintList(); sentence(); });
            btn.addEventListener('dblclick', () => { choice = o; create(); });
            list.appendChild(btn);
          }
        }
        if (!list.children.length) list.appendChild(h('div.gk-small.gk-muted.web-pad', { text: 'No relation called “' + q + '”. Add new kinds in World → Relation types.' }));
      };
      const sentence = () => {
        const tA = a ? WB.titleOf(a) : 'the first entry', tB = b ? WB.titleOf(b) : 'the second entry';
        GK.clear(say);
        say.append(h('b', { text: tA }), ' is ', choice ? h('span.web-rel-word', { style: { '--c': choice.color || C.CAT_COLOR[choice.cat] }, text: choice.text }) : h('span.gk-faint', { text: '…' }), ' ', h('b', { text: tB }), '.');
        add.disabled = !(a && b && choice && a !== b);
      };
      const search = U.search({ placeholder: 'Find a kind of relation', autofocus: !!(a && b), onInput: v => { q = v; paintList(); }, onEnter: () => { const first = list.querySelector('.web-rel-opt'); if (first) first.click(); } });
      const add = ui.button({ label: 'Add relation', kind: 'primary', onClick: create });
      const swapBtn = ui.button({ label: 'Swap', icon: '⇄', small: true, kind: 'ghost', title: 'Swap the two entries', onClick: () => { [a, b] = [b, a]; slotA.set(a); slotB.set(b); sentence(); paintList(); } });
      async function create() {
        if (!(a && b && choice) || a === b) return;
        try {
          const link = await WB.api('links.relate', { src: choice.swap ? b : a, dst: choice.swap ? a : b, relId: choice.relId, note, start, end });
          finish(link);
          U.undoToast('Related ' + WB.titleOf(a) + ' and ' + WB.titleOf(b), () => WB.api('links.remove', link.id));
        } catch (e) { WB.fail(e); }
      }
      const more = h('div.web-rel-more', [
        ui.field({ label: 'Note', control: ui.input({ value: note, placeholder: 'Optional: how, why, under what terms', onInput: v => { note = v; } }) }),
        h('div.wb-daterange', [
          ui.field({ label: 'From', control: U.dateInput({ value: start, onChange: v => { start = v; } }) }),
          ui.field({ label: 'Until', control: U.dateInput({ value: end, onChange: v => { end = v; } }) }),
        ]),
      ]);
      const panel = ui.panel({ title: opts.title || 'New relation', icon: '☍', cls: 'gk-dialog web-rel-dialog', body: [
        h('div.web-rel-ends', [slotA, swapBtn, slotB]), say, search, list, more,
      ] });
      panel.appendChild(h('div.gk-panel-foot', [h('span.gk-small.gk-muted.gk-grow', [U.kbd('Enter'), ' add · ', U.kbd('Esc'), ' cancel']), ui.button({ label: 'Cancel', onClick: () => finish(null) }), add]));
      const scrim = h('div.gk-scrim', { onclick: e => { if (e.target === scrim) finish(null); } }, [panel]);
      const onKey = e => {
        if (e.key === 'Escape' && !document.querySelector('.wb-pop')) { e.stopPropagation(); finish(null); }
        else if (e.key === 'Enter' && e.ctrlKey) { e.preventDefault(); create(); }
        else if (e.key === 'Enter' && choice && a && b && !e.target.closest('.wb-search, .wb-date, textarea')) { e.preventDefault(); create(); }
      };
      document.addEventListener('keydown', onKey, true);
      document.body.appendChild(scrim);
      paintList(); sentence();
      if (!a) setTimeout(() => slotA.pick(), 60); else if (!b) setTimeout(() => slotB.pick(), 60);
    });
  };

  /** delete a relation with Undo (the relation comes back with its note and dates) */
  C.removeRelation = async link => {
    await WB.api('links.remove', link.id);
    const d = v => (v == null ? null : { day: v, min: null, prec: 'day' });
    U.undoToast('Relation removed: ' + WB.titleOf(link.src) + ' ' + C.relLabel(link, link.src) + ' ' + WB.titleOf(link.dst), () => WB.api('links.relate', { src: link.src, dst: link.dst, relId: link.relId, note: link.note, start: d(link.startDay), end: d(link.endDay) }));
  };

  /** pointer → coordinates inside an element, in its own px (the UI scale divided out) */
  C.local = (el, ev) => { const r = el.getBoundingClientRect(); return { x: GK.local(el, ev.clientX - r.left), y: GK.local(el, ev.clientY - r.top) }; };
})();
