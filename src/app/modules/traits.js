/* People & attributes: the editor in World settings (axes, attribute systems, vocabulary, packs and files) and the two
   entry field kinds it feeds, `axis` (pick race, class, caste…) and `attrs` (an editable stat block with totals).
   The engine is src/shared/traits.js; the configuration is stored in the world settings as `traits`. */
(function () {
  'use strict';
  const GK = window.GK, WB = window.WB, h = GK.h, ui = GK.ui, T = window.WBTraits;
  const ICONS = '◆ ❦ ⚔ ♛ ☯ ✝ ⚒ ⌖ ⚑ ★ ☾ ☀ ✦ ✧ ❖ ⚗ ⚙ ☠ ♜ ⛵ ⚓ ☘ ❄ ⚡ ♞ ⚖ ⚚ ☺ ⌂ ◍ ● ▲ ♠ ♣ ♥ ♦ Ω Σ'.split(' ');
  const S = { view: 'axes', axis: null, system: null, open: new Set(), previewAxes: {}, previewBase: {} };
  const VIEWS = [['axes', 'Classifications'], ['systems', 'Attributes'], ['vocab', 'Vocabulary'], ['packs', 'Packs & files']];

  /* ---------------- shared access ---------------- */
  let cache = { src: undefined, cfg: null };
  /** the world's normalised configuration (never null) */
  WB.traits = () => {
    const src = WB.world && WB.world.settings ? WB.world.settings.traits : undefined;
    if (!cache.cfg || cache.src !== src) { let cfg; try { cfg = T.migrate(src); } catch { cfg = T.emptyConfig(); } cache = { src, cfg }; }
    return cache.cfg;
  };
  const persist = WB.debounce(() => { const t = WB.world.settings.traits; WB.api('worlds.update', WB.worldId, { settings: { traits: t } }).catch(WB.fail); }, 400);
  /** stores a working copy: new object so the cache refreshes, then writes it after a short pause */
  function store(work) { WB.world.settings = Object.assign({}, WB.world.settings, { traits: JSON.parse(JSON.stringify(work)) }); persist(); }
  const typeOfDef = def => {
    const list = WB.typeList({ all: true });
    return list.find(t => (t.fields || []).includes(def)) || list.find(t => (t.fields || []).some(f => f.key === def.key && f.kind === def.kind)) || null;
  };
  const newId = (name, taken) => { const base = T.slug(name) || 'item'; let id = base, n = 2; while (taken.has(id)) id = base + '_' + n++; return id; };
  const nameStyleLabel = k => (WB.names && WB.names.STYLES && WB.names.STYLES[k] ? WB.names.STYLES[k].label : k);

  /* ---------------- entry side: picking values ---------------- */
  function chipFor(v, axis, on, onClick, depth) {
    return h('button.tr-chip', { type: 'button', class: on ? 'on' : '', style: { '--c': v.color || axis.color }, title: v.desc || '', 'aria-pressed': on ? 'true' : 'false', onclick: onClick }, [
      depth ? h('span.tr-nest', { text: '↳' }) : null, v.icon ? h('span', { text: v.icon }) : null, h('span', { text: v.name })]);
  }

  /** the axis picker: one row per axis that applies to the entry's type */
  function axisControl(def, value, set, ro) {
    const cfg = WB.traits();
    const type = typeOfDef(def);
    let axes = T.axesFor(cfg, type && type.key);
    if (def.axis && def.axis !== '*') axes = axes.filter(a => a.id === def.axis);
    const state = {};
    if (value && typeof value === 'object') for (const k of Object.keys(value)) state[k] = [].concat(value[k]).filter(Boolean);
    const box = h('div.tr-axes');
    const sync = () => { box.dataset.traitsAxis = JSON.stringify(state); box.dispatchEvent(new CustomEvent('traits-axis', { bubbles: true })); };
    box.dataset.traitsAxis = JSON.stringify(state);
    if (!axes.length) {
      box.appendChild(h('div.gk-small.gk-muted.tr-empty', [h('span', { text: 'No classifications for this type yet. ' }), ro || WB.share ? null : ui.button({ label: 'Set up…', small: true, kind: 'ghost', onClick: () => WB.go('world', { tab: 'people' }) })]));
      return box;
    }
    const ix = T.index(cfg);
    const extras = h('div.tr-extras');
    const paintExtras = () => {
      GK.clear(extras);
      const diffs = (cfg.concepts || []).map(c => [c, T.termFor(cfg, c.key, state)]).filter(([c, l]) => l !== c.label);
      if (diffs.length) extras.appendChild(h('div.gk-small.gk-muted', { text: 'Their words: ' + diffs.map(([c, l]) => c.label + ' → ' + l).join(' · ') }));
      const style = T.nameStyleFor(cfg, state);
      if (style && WB.names && WB.names.generate && !ro && !WB.share) {
        const row = h('div.wb-chips');
        extras.appendChild(h('div.gk-row.gk-small', [h('span.gk-muted', { text: 'Names in this style (' + nameStyleLabel(style) + '): ' }), row,
          ui.button({ label: 'More', small: true, kind: 'ghost', onClick: () => fill() })]));
        const fill = () => {
          GK.clear(row);
          for (const n of WB.names.generate({ style, kind: 'person', count: 5 })) row.appendChild(h('button.tr-chip.small', { type: 'button', text: n, title: 'Copy', onclick: () => { try { navigator.clipboard.writeText(n); ui.toast('Copied “' + n + '”', '⧉'); } catch { } } }));
        };
        fill();
      }
    };
    const paint = () => {
      GK.clear(box);
      for (const axis of axes) {
        const picked = (state[axis.id] || []).filter(id => axis.values.some(v => v.id === id));
        const missing = axis.required && !picked.length;
        const chips = [];
        if (ro || WB.share) {
          for (const id of picked) { const hit = ix.values.get(id); if (hit) chips.push(chipFor(Object.assign({}, hit.value, { name: T.pathName(cfg, id, ix) }), axis, true, null, 0)); }
          if (!chips.length) chips.push(h('span.gk-faint', { text: '—' }));
        } else {
          for (const { value: v, depth } of T.tree(axis)) {
            chips.push(chipFor(v, axis, picked.includes(v.id), () => {
              const cur = new Set(picked);
              if (cur.has(v.id)) cur.delete(v.id); else { if (!axis.many) cur.clear(); cur.add(v.id); }
              state[axis.id] = axis.values.map(x => x.id).filter(id => cur.has(id));
              set(Object.assign({}, state)); sync(); paint();
            }, depth));
          }
          if (!chips.length) chips.push(h('span.gk-small.gk-muted', { text: 'No values yet.' }));
        }
        box.appendChild(h('div.tr-axis', { class: missing ? 'warn' : '' }, [
          h('div.tr-axis-name', { style: { '--c': axis.color }, title: axis.desc || '' }, [h('span', { text: axis.icon }), h('b', { text: axis.name }), missing ? h('span.tr-req', { text: 'needed' }) : (axis.many && !ro ? h('span.gk-tiny.gk-muted', { text: 'several' }) : null)]),
          h('div.wb-chips.tr-chips', chips),
        ]));
      }
      box.appendChild(extras);
      paintExtras();
    };
    paint();
    return box;
  }

  /** the stat block of an entry: every system that applies to its type, with totals */
  function attrsControl(def, value, set, ro) {
    ro = ro || WB.share;
    const cfg = WB.traits();
    const type = typeOfDef(def);
    let systems = T.systemsFor(cfg, type && type.key);
    if (def.system && def.system !== '*') systems = systems.filter(s => s.id === def.system);
    const box = h('div.tr-sheet');
    if (!systems.length) {
      box.appendChild(h('div.gk-small.gk-muted.tr-empty', [h('span', { text: 'No attribute system for this type yet. ' }), ro ? null : ui.button({ label: 'Set up…', small: true, kind: 'ghost', onClick: () => WB.go('world', { tab: 'people' }) })]));
      return box;
    }
    const data = {};
    if (value && typeof value === 'object') for (const k of Object.keys(value)) data[k] = Object.assign({}, value[k]);
    const blocks = systems.map(sys => {
      if (!data[sys.id]) data[sys.id] = {};
      return statBlock(cfg, sys, data[sys.id], { ro, onBase: () => { const out = {}; for (const k of Object.keys(data)) if (Object.keys(data[k]).length) out[k] = Object.assign({}, data[k]); set(out); } });
    });
    blocks.forEach(b => box.appendChild(b.el));
    // modifiers come from the axis picks of the same entry page, found by looking around this control once it is on the page
    let axisState = {};
    const refresh = () => blocks.forEach(b => b.update(axisState));
    const readState = root => { try { axisState = JSON.parse(root.dataset.traitsAxis || '{}'); } catch { axisState = {}; } };
    requestAnimationFrame(() => {
      let el = box.parentElement, root = null;
      for (let i = 0; el && i < 8 && !root; i++, el = el.parentElement) {
        const marks = el.querySelectorAll('[data-traits-axis]');
        if (marks.length === 1) root = marks[0]; else if (marks.length > 1) break;
      }
      if (!root) return;
      readState(root); refresh();
      const holder = root.parentElement && root.closest('.wb-field, .cx-fields, .cx-body, form') || root.parentElement || document;
      const on = ev => { if (!box.isConnected) return holder.removeEventListener('traits-axis', on); readState(ev.target.closest('[data-traits-axis]') || root); refresh(); };
      holder.addEventListener('traits-axis', on);
    });
    return box;
  }

  /** a stat block for one system. Returns { el, update(axisState) }. opts: { ro, onBase } */
  function statBlock(cfg, sys, base, opts) {
    const rows = new Map();
    const el = h('div.tr-block');
    el.appendChild(h('div.tr-block-head', [h('b', { text: sys.name })]));
    let group = null, grid = null;
    for (const a of sys.attrs) {
      if (!grid || (a.group || '') !== group) {
        group = a.group || '';
        if (group) el.appendChild(h('div.tr-group.gk-tiny.gk-muted', { text: group }));
        grid = h('div.tr-grid'); el.appendChild(grid);
      }
      const set = v => { if (v === '' || v == null) delete base[a.key]; else base[a.key] = v; opts.onBase && opts.onBase(); };
      const mod = h('span.tr-mod'), total = h('b.tr-total'), err = h('div.tr-err.gk-tiny');
      let control = null, paintCtl = null;
      const cur = () => (base[a.key] == null ? '' : base[a.key]);
      if (!opts.ro && !a.formula) {
        switch (a.kind) {
          case 'number': case 'bar': control = ui.input({ type: 'number', value: cur(), placeholder: a.kind === 'bar' ? 'full' : String(a.def != null ? a.def : a.min != null ? a.min : 0), onInput: v => { set(v === '' ? '' : +v); upd(); } }); control.classList.add('tr-num'); break;
          case 'rating': {
            control = h('div.tr-dots'); paintCtl = r => { GK.clear(control); const n = r ? r.max : (a.max || 5); for (let i = 1; i <= n; i++) control.appendChild(h('button.tr-dot', { type: 'button', class: r && i <= r.total ? 'on' : (r && i <= r.base ? 'lost' : ''), title: i + ' of ' + n, onclick: () => { set(cur() === i ? 0 : i); upd(); } })); };
            break;
          }
          case 'die': control = ui.select({ value: base[a.key] || (a.options || T.DIE_FACES)[0], options: (a.options && a.options.length ? a.options : T.DIE_FACES).map(d => [d, d]), onChange: v => { set(v); upd(); } }); break;
          case 'choice': control = ui.select({ value: base[a.key] || '', options: [['', '—']].concat((a.options || []).map(d => [d, d])), onChange: v => { set(v); upd(); } }); break;
          default: control = ui.input({ value: cur(), onInput: v => set(v) });
        }
      }
      const meter = a.kind === 'bar' ? h('div.tr-meter') : null;
      const cell = h('div.tr-attr', { 'data-key': a.key }, [
        h('div.tr-label', [h('span', { text: a.label, title: a.label }), a.formula ? h('span.tr-fx', { text: 'ƒ', title: a.formula }) : null]),
        h('div.tr-ctl', [control, mod, total]), meter, err,
      ]);
      grid.appendChild(cell);
      rows.set(a.key, { a, mod, total, err, meter, paintCtl });
    }
    let last = {};
    function upd() { api.update(last); }
    const api = {
      el,
      update(axisState) {
        last = axisState || {};
        const res = T.compute(cfg, sys.id, base, last);
        for (const r of res) {
          const c = rows.get(r.key); if (!c) continue;
          const plainInput = !opts.ro && !c.a.formula && ['number', 'choice', 'die', 'text'].includes(c.a.kind);
          const unit = c.a.unit ? ' ' + c.a.unit : '';
          c.total.textContent = r.error ? '—' : r.kind === 'bar' ? r.total + ' / ' + r.max : r.kind === 'rating' ? '' : plainInput ? (r.kind === 'number' && r.mod ? '= ' + r.total + unit : '') : (r.total == null ? '' : String(r.total) + unit);
          c.mod.textContent = r.mod ? (r.mod > 0 ? '+' : '−') + Math.abs(r.mod) : '';
          c.mod.title = r.mod ? 'From classifications' : '';
          c.mod.className = 'tr-mod' + (r.mod > 0 ? ' up' : r.mod < 0 ? ' down' : '');
          c.err.textContent = r.error || '';
          if (c.paintCtl) c.paintCtl(r);
          else if (opts.ro && r.kind === 'rating') c.total.textContent = '●'.repeat(r.total) + '○'.repeat(Math.max(0, r.max - r.total));
          if (c.meter) { GK.clear(c.meter); c.meter.appendChild(ui.meter(r.max ? r.total / r.max : 0)); }        }
      },
    };
    api.update({});
    return api;
  }

  WB.traitsField = (def, value, set) => (def.kind === 'axis' ? axisControl(def, value, set, false) : attrsControl(def, value, set, false));
  WB.traitsView = (def, value) => (def.kind === 'axis' ? axisControl(def, value, () => { }, true) : attrsControl(def, value, () => { }, true));

  /* ---------------- settings: the editor ---------------- */
  function sortable(arr, item, row, grip, done) {
    let armed = false;
    if (sortable.focusItem === item) { sortable.focusItem = null; setTimeout(() => grip.focus(), 0); }
    grip.addEventListener('mousedown', () => { armed = true; row.draggable = true; document.addEventListener('mouseup', () => { armed = false; row.draggable = false; }, { once: true }); });
    row.addEventListener('dragstart', ev => { if (!armed) return ev.preventDefault(); sortable.cur = { arr, item }; row.classList.add('dragging'); ev.dataTransfer.effectAllowed = 'move'; ev.dataTransfer.setData('text/plain', 'tr'); });
    row.addEventListener('dragend', () => { row.classList.remove('dragging'); row.draggable = false; sortable.cur = null; });
    row.addEventListener('dragover', ev => { if (sortable.cur && sortable.cur.arr === arr) { ev.preventDefault(); row.classList.add('over'); } });
    row.addEventListener('dragleave', () => row.classList.remove('over'));
    row.addEventListener('drop', ev => {
      row.classList.remove('over');
      const c = sortable.cur; if (!c || c.arr !== arr || c.item === item) return;
      ev.preventDefault();
      const from = arr.indexOf(c.item); arr.splice(from, 1); arr.splice(arr.indexOf(item), 0, c.item); done();
    });
    grip.addEventListener('keydown', ev => {
      if (ev.key !== 'ArrowUp' && ev.key !== 'ArrowDown') return;
      ev.preventDefault();
      const i = arr.indexOf(item), j = i + (ev.key === 'ArrowUp' ? -1 : 1);
      if (j < 0 || j >= arr.length) return;
      arr.splice(i, 1); arr.splice(j, 0, item); sortable.focusItem = item; done();
    });
  }
  const cl = (el, c) => { el.classList.add(c); return el; };
  const gripEl = () => h('button.tr-grip', { type: 'button', text: '⠿', title: 'Drag to reorder (or Up / Down arrows)' });
  function iconBtn(cur, color, set, cls) {
    const b = h('button.tr-ico', { type: 'button', text: cur || '·', class: cls || '', style: { '--c': color || 'var(--accent)' }, title: 'Choose an icon', onclick: ev => {
      let pop; pop = WB.ui.popover(ev.currentTarget, h('div.cx-symgrid', ICONS.map(s => h('button', { type: 'button', text: s, onclick: () => { b.textContent = s; set(s); pop.close(); } }))), { width: '18em' });
    } });
    return b;
  }
  const typeChips = (types, on, set) => h('div.wb-chips', types.map(t => ui.chip({ label: t.icon + ' ' + t.name, on: on.includes(t.key), title: t.plural, onClick: ev => { const s = new Set(on); s.has(t.key) ? s.delete(t.key) : s.add(t.key); on.length = 0; on.push(...s); set(); ev.currentTarget.classList.toggle('on', s.has(t.key)); } })));

  async function tabPeople(box) {
    let work;
    try { work = T.migrate(WB.world.settings.traits); } catch (e) { work = T.emptyConfig(); ui.toast(e.message, '⚠'); }
    const types = WB.typeList();
    const main = h('div.tr-main');
    const save = () => store(work);
    const repaint = () => { GK.clear(main); VIEW[S.view](); };
    const bar = h('div.tr-views');
    const paintBar = () => { GK.clear(bar); bar.appendChild(ui.tabs({ tabs: VIEWS, value: S.view, onChange: v => { S.view = v; paintBar(); repaint(); } })); };
    const problems = h('div.tr-problems.gk-small');
    const paintProblems = () => { GK.clear(problems); const p = T.validate(work); if (p.length) GK.append(problems, [h('b', { text: 'To fix' }), ...p.map(x => h('div', { text: '⚠ ' + x }))]); };
    let previewHook = null;
    const touch = () => { save(); paintProblems(); if (previewHook && S.view === 'systems') previewHook(); };

    /* ----- axes ----- */
    function viewAxes() {
      if (!work.axes.find(a => a.id === S.axis)) S.axis = work.axes[0] ? work.axes[0].id : null;
      const sel = work.axes.find(a => a.id === S.axis);
      const list = h('div.tr-list.gk-panel');
      const paintList = () => {
        GK.clear(list);
        list.appendChild(h('div.tr-list-head', [h('b', { text: 'Classifications' }), ui.button({ label: 'Add', icon: '＋', small: true, kind: 'primary', onClick: async () => {
          const n = await ui.prompt('A new classification', '', 'e.g. Race, Class, Caste, Order, Clan, Calling'); if (!n) return;
          const ids = new Set(work.axes.map(a => a.id)); const id = newId(n, ids);
          work.axes.push({ id, name: n, color: '#8f7ad8', icon: '◆', many: false, types: [], required: false, desc: '', values: [] }); S.axis = id; touch(); repaint();
        } })]));
        if (!work.axes.length) list.appendChild(h('p.gk-small.gk-muted', { text: 'Nothing yet. Add one, or pick a starter pack in “Packs & files”.' }));
        work.axes.forEach(a => {
          const grip = gripEl();
          const row = h('div.wb-row', { class: a === sel ? 'on' : '', tabindex: 0, style: { '--c': a.color }, onclick: () => { S.axis = a.id; repaint(); } }, [
            grip, h('span.wb-row-ico', { text: a.icon }), h('div.wb-row-main', [h('div.wb-row-title.gk-ellipsis', { text: a.name }), h('div.wb-row-sub', { text: a.values.length + ' values' + (a.many ? ' · several' : '') })]),
            ui.button({ icon: '✕', small: true, kind: 'ghost', title: 'Delete this classification', onClick: async ev => { ev.stopPropagation(); if (!(await ui.confirm('Delete “' + a.name + '”?', 'Entries keep their picks but they stop showing.', 'Delete', true))) return; work.axes = work.axes.filter(x => x !== a); touch(); repaint(); } }),
          ]);
          sortable(work.axes, a, row, grip, () => { touch(); paintList(); });
          list.appendChild(row);
        });
      };
      paintList();
      const editor = h('div.tr-edit');
      if (sel) paintAxis(editor, sel, paintList);
      else editor.appendChild(WB.ui.empty ? WB.ui.empty({ icon: '◆', title: 'No classifications', text: 'Add one (Race, Class, Caste, Order…) or start from a pack.' }) : h('p', { text: 'No classifications yet.' }));
      main.appendChild(h('div.tr-split', [list, editor]));
    }
    function paintAxis(editor, a, paintList) {
      const head = ui.panel({ title: a.name, icon: a.icon, sub: 'Entries pick from these values; each can nest under another (Race → Subrace).', body: [
        h('div.wd-namerow', [iconBtn(a.icon, a.color, v => { a.icon = v; touch(); paintList(); }), ui.input({ value: a.name, placeholder: 'Name', onInput: v => { a.name = v; touch(); paintList(); } }), ui.color({ value: a.color, onInput: v => { a.color = v; touch(); paintList(); } })]),
        ui.input({ value: a.desc || '', placeholder: 'What this classification means (optional)', onInput: v => { a.desc = v; save(); } }),
        h('div.wd-flags', [
          ui.field({ label: 'An entry may hold several values', inline: true, control: ui.toggle({ value: a.many, onChange: v => { a.many = v; touch(); } }) }),
          ui.field({ label: 'Every entry needs one', hint: 'Shows “needed” on entries without a value.', inline: true, control: ui.toggle({ value: a.required, onChange: v => { a.required = v; touch(); } }) }),
        ]),
        ui.field({ label: 'Applies to', hint: 'None selected means every type.', control: typeChips(types, a.types, touch) }),
      ] });
      const vbox = h('div.tr-values');
      const paintValues = () => {
        GK.clear(vbox);
        T.tree(a).forEach(({ value: v, depth }) => vbox.appendChild(valueRow(a, v, depth, paintValues)));
        if (!a.values.length) vbox.appendChild(h('p.gk-small.gk-muted', { text: 'No values yet. Add the first one.' }));
      };
      paintValues();
      const vpanel = ui.panel({ title: 'Values', icon: '☰', sub: 'Drag ⠿ to reorder. “Under” nests a value: a High elf is under Elf and inherits its modifiers.', actions: [
        ui.button({ label: 'Add value', icon: '＋', small: true, kind: 'primary', onClick: () => { addValue(a, null); paintValues(); setTimeout(() => { const ins = vbox.querySelectorAll('.tr-vname'); const l = ins[ins.length - 1]; if (l) { l.focus(); l.select(); } }, 30); } }),
        ui.button({ label: 'Several at once…', small: true, onClick: async () => {
          const t = await ui.prompt('Add values', '', 'comma separated: Human, Elf, Dwarf'); if (!t) return;
          t.split(/[,\n;]/).map(s => s.trim()).filter(Boolean).forEach(n => addValue(a, null, n)); touch(); paintValues();
        } }),
      ], body: vbox });
      GK.append(editor, [head, vpanel]);
    }
    const allValueIds = () => new Set(work.axes.flatMap(x => x.values.map(v => v.id)));
    function addValue(a, parent, name) {
      const n = name || (parent ? 'New sub-value' : 'New value');
      a.values.push({ id: newId(n, allValueIds()), name: n, color: a.color, icon: '', desc: '', parent: parent || null, terms: {}, nameStyle: '', mods: [] });
      if (parent) S.open.add(parent);
      touch();
    }
    function valueRow(a, v, depth, repaintValues) {
      const grip = gripEl();
      const open = S.open.has('d:' + v.id);
      const banned = new Set([v.id, ...T.descendants(a, v.id)]);
      const detail = h('div.tr-detail');
      const row = h('div.tr-vrow', { style: { '--d': depth, '--c': v.color || a.color } }, [
        h('div.tr-vmain', [
          grip, ui.color({ value: v.color || a.color, onInput: x => { v.color = x; touch(); row.style.setProperty('--c', x); } }),
          iconBtn(v.icon || '·', v.color || a.color, x => { v.icon = x; touch(); }, 'small'),
          cl(ui.input({ value: v.name, placeholder: 'Name', onInput: x => { v.name = x; touch(); } }), 'tr-vname'),
          ui.select({ value: v.parent || '', options: [['', 'Top level']].concat(a.values.filter(x => !banned.has(x.id)).map(x => [x.id, 'under ' + x.name])), onChange: x => { v.parent = x || null; touch(); repaintValues(); } }),
          ui.button({ icon: '＋', small: true, kind: 'ghost', title: 'Add a sub-value', onClick: () => { addValue(a, v.id); repaintValues(); } }),
          ui.button({ icon: open ? '▾' : '⚙', small: true, kind: 'ghost', title: 'Description, modifiers, vocabulary, naming style', onClick: () => { open ? S.open.delete('d:' + v.id) : S.open.add('d:' + v.id); repaintValues(); } }),
          ui.button({ icon: '✕', small: true, kind: 'ghost', title: 'Delete', onClick: () => { a.values.forEach(x => { if (x.parent === v.id) x.parent = v.parent || null; }); a.values = a.values.filter(x => x !== v); touch(); repaintValues(); } }),
        ]),
        open ? detail : null,
      ]);
      sortable(a.values, v, row, grip, repaintValues);
      if (open) paintDetail(detail, a, v);
      return row;
    }
    function paintDetail(box, a, v) {
      const modBox = h('div.tr-mods');
      const attrOpts = [];
      for (const s of work.systems) for (const at of s.attrs) attrOpts.push([s.id + '|' + at.key, s.name + ' › ' + at.label]);
      const paintMods = () => {
        GK.clear(modBox);
        v.mods.forEach((m, i) => modBox.appendChild(h('div.tr-modrow', [
          ui.select({ value: m.system + '|' + m.attr, options: attrOpts.concat(attrOpts.some(o => o[0] === m.system + '|' + m.attr) ? [] : [[m.system + '|' + m.attr, '(missing) ' + m.attr]]), onChange: x => { const [s, k] = x.split('|'); m.system = s; m.attr = k; touch(); } }),
          ui.input({ type: 'number', value: m.add, onInput: x => { m.add = +x || 0; touch(); } }),
          ui.button({ icon: '✕', small: true, kind: 'ghost', onClick: () => { v.mods.splice(i, 1); touch(); paintMods(); } }),
        ])));
        if (!attrOpts.length) modBox.appendChild(h('p.gk-small.gk-muted', { text: 'Create an attribute system first (Attributes tab).' }));
        else modBox.appendChild(ui.button({ label: 'Add modifier', icon: '＋', small: true, onClick: () => { const [s, k] = attrOpts[0][0].split('|'); v.mods.push({ system: s, attr: k, add: 1 }); touch(); paintMods(); } }));
      };
      paintMods();
      const styles = WB.names && WB.names.STYLES ? Object.entries(WB.names.STYLES).map(([k, s]) => [k, s.label]) : [];
      GK.append(box, [
        ui.input({ value: v.desc || '', placeholder: 'Description (shown as a tooltip)', onInput: x => { v.desc = x; save(); } }),
        ui.field({ label: 'Modifiers', hint: 'Added to the entry’s totals; a sub-value also gets its parents’.', control: modBox }),
        ui.field({ label: 'Their words', hint: 'Leave empty to use the world’s word.', control: h('div.tr-terms', work.concepts.map(c => h('label.tr-term', [h('span.gk-small.gk-muted', { text: c.label }), ui.input({ value: (v.terms || {})[c.key] || '', placeholder: c.label, onInput: x => { v.terms = v.terms || {}; if (x.trim()) v.terms[c.key] = x; else delete v.terms[c.key]; save(); } })]))) }),
        styles.length ? ui.field({ label: 'Naming style', hint: 'Used by name suggestions for entries with this value.', control: ui.select({ value: v.nameStyle || '', options: [['', 'No preference']].concat(styles), onChange: x => { v.nameStyle = x; save(); } }) }) : null,
      ]);
    }

    /* ----- systems ----- */
    function viewSystems() {
      if (!work.systems.find(s => s.id === S.system)) S.system = work.systems[0] ? work.systems[0].id : null;
      const sel = work.systems.find(s => s.id === S.system);
      const list = h('div.tr-list.gk-panel');
      const paintList = () => {
        GK.clear(list);
        list.appendChild(h('div.tr-list-head', [h('b', { text: 'Systems' }), h('div.gk-row.nowrap', [
          ui.button({ label: 'From a preset…', small: true, onClick: ev => WB.ui.menu(Object.entries(T.PRESET_SYSTEMS).map(([k, p]) => ({ label: p.label + ' — ' + p.desc, onClick: () => { work = T.addSystemPreset(work, k); S.system = work.systems[work.systems.length - 1].id; touch(); repaint(); } })), ev.currentTarget) }),
          ui.button({ label: 'Add', icon: '＋', small: true, kind: 'primary', onClick: async () => {
            const n = await ui.prompt('A new attribute system', '', 'e.g. Abilities, Body / Mind / Spirit, Personality'); if (!n) return;
            const id = newId(n, new Set(work.systems.map(s => s.id)));
            work.systems.push({ id, name: n, types: ['character'], desc: '', attrs: [] }); S.system = id; touch(); repaint();
          } })])]));
        if (!work.systems.length) list.appendChild(h('p.gk-small.gk-muted', { text: 'Nothing yet. Start from a preset or add your own.' }));
        work.systems.forEach(s => {
          const grip = gripEl();
          const row = h('div.wb-row', { class: s === sel ? 'on' : '', tabindex: 0, onclick: () => { S.system = s.id; repaint(); } }, [
            grip, h('span.wb-row-ico', { text: '⬡' }), h('div.wb-row-main', [h('div.wb-row-title.gk-ellipsis', { text: s.name }), h('div.wb-row-sub', { text: s.attrs.length + ' attributes' })]),
            ui.button({ icon: '✕', small: true, kind: 'ghost', title: 'Delete this system', onClick: async ev => { ev.stopPropagation(); if (!(await ui.confirm('Delete “' + s.name + '”?', 'Stored values stay on entries but stop showing.', 'Delete', true))) return; work.systems = work.systems.filter(x => x !== s); touch(); repaint(); } }),
          ]);
          sortable(work.systems, s, row, grip, () => { touch(); paintList(); });
          list.appendChild(row);
        });
      };
      paintList();
      const editor = h('div.tr-edit');
      if (sel) paintSystem(editor, sel, paintList);
      else editor.appendChild(h('p.gk-muted', { text: 'Add a system to define attributes such as STR / DEX, or Body / Mind / Spirit.' }));
      main.appendChild(h('div.tr-split', [list, editor]));
    }
    function paintSystem(editor, s, paintList) {
      const head = ui.panel({ title: s.name, icon: '⬡', sub: 'Any number of attributes. Several systems can exist side by side; each applies to the types you pick.', body: [
        ui.input({ value: s.name, placeholder: 'Name', onInput: v => { s.name = v; touch(); paintList(); } }),
        ui.input({ value: s.desc || '', placeholder: 'Notes (optional)', onInput: v => { s.desc = v; save(); } }),
        ui.field({ label: 'Applies to', hint: 'None selected means every type.', control: typeChips(types, s.types, touch) }),
      ] });
      const abox = h('div.tr-attrs');
      const paintAttrs = () => {
        GK.clear(abox);
        s.attrs.forEach(a => abox.appendChild(attrRow(s, a, paintAttrs)));
        if (!s.attrs.length) abox.appendChild(h('p.gk-small.gk-muted', { text: 'No attributes yet.' }));
        paintPreview();
      };
      const prev = h('div.tr-preview');
      function paintPreview() {
        GK.clear(prev);
        const cfg = T.normalize(work);
        const sysN = cfg.systems.find(x => x.id === s.id); if (!sysN) return;
        const axisBox = h('div.tr-axes');
        const state = S.previewAxes;
        const base = S.previewBase[s.id] = S.previewBase[s.id] || {};
        const blk = statBlock(cfg, sysN, base, { onBase: () => { } });
        const ix = T.index(cfg);
        for (const axis of cfg.axes) {
          if (!axis.values.length) continue;
          axisBox.appendChild(h('div.tr-axis', [h('div.tr-axis-name', { style: { '--c': axis.color } }, [h('span', { text: axis.icon }), h('b', { text: axis.name })]),
            h('div.wb-chips.tr-chips', T.tree(axis).map(({ value: v, depth }) => chipFor(v, axis, (state[axis.id] || []).includes(v.id), () => {
              const cur = new Set(state[axis.id] || []); if (cur.has(v.id)) cur.delete(v.id); else { if (!axis.many) cur.clear(); cur.add(v.id); }
              state[axis.id] = [...cur]; paintPreview();
            }, depth)))]));
        }
        void ix;
        blk.update(state);
        GK.append(prev, [h('p.gk-small.gk-muted', { text: 'Try it: pick values below and change numbers to see modifiers and formulas at work.' }), blk.el, axisBox]);
      }
      const apanel = ui.panel({ title: 'Attributes', icon: '▤', actions: [
        ui.button({ label: 'Add attribute', icon: '＋', small: true, kind: 'primary', onClick: () => {
          const keys = new Set(s.attrs.map(a => a.key)); const label = 'Attribute ' + (s.attrs.length + 1);
          s.attrs.push({ key: newId(label, keys), label, short: '', kind: 'number', group: s.attrs.length ? s.attrs[s.attrs.length - 1].group || '' : '' });
          touch(); paintAttrs(); setTimeout(() => { const ins = abox.querySelectorAll('.tr-alabel'); const l = ins[ins.length - 1]; if (l) { l.focus(); l.select(); } }, 30);
        } }),
      ], body: abox });
      GK.append(editor, [head, apanel, ui.panel({ title: 'Live preview', icon: '◉', body: prev })]);
      previewHook = WB.debounce(paintPreview, 300);
      paintAttrs();
    }
    function attrRow(s, a, repaint) {
      const grip = gripEl();
      const open = S.open.has('a:' + s.id + ':' + a.key);
      const others = s.attrs.filter(x => x !== a).map(x => x.key);
      const more = h('div.tr-adetail');
      const num = (label, k, ph) => ui.field({ label, control: ui.input({ type: 'number', value: a[k] == null ? '' : a[k], placeholder: ph || '', onInput: x => { if (x === '') delete a[k]; else a[k] = +x; touch(); } }) });
      const formulaField = (label, k, ph) => {
        const inp = ui.input({ value: a[k] || '', placeholder: ph, onInput: x => { if (x.trim()) a[k] = x; else delete a[k]; chk(); touch(); } });
        const note = h('div.tr-err.gk-tiny');
        const chk = () => { note.textContent = a[k] ? T.checkFormula(a[k], others) : ''; };
        chk();
        const names = h('div.wb-chips', others.map(n => h('button.tr-chip.small', { type: 'button', text: n, title: 'Insert', onclick: () => { inp.value = (inp.value + ' ' + n).trim(); inp.dispatchEvent(new Event('input', { bubbles: true })); } })));
        return ui.field({ label, hint: 'Use + − * / % ^ ( ), min max floor ceil round abs sqrt clamp if(a>b, x, y), and the names below.', control: h('div.gk-stack', [inp, note, names]) });
      };
      GK.append(more, [
        h('div.gk-small.gk-muted', { text: 'Name in formulas: ' + a.key }),
        ['number', 'rating', 'bar'].includes(a.kind) ? h('div.wd-two', [num('Minimum', 'min', a.kind === 'rating' ? '0' : ''), num('Maximum', 'max', a.kind === 'rating' ? '5' : a.kind === 'bar' ? '10' : ''), num('Starts at', 'def', '')]) : null,
        a.kind === 'number' ? formulaField('Calculated from other attributes (optional)', 'formula', 'e.g. floor((con - 10) / 2)') : null,
        a.kind === 'bar' ? formulaField('Maximum from a formula (optional)', 'maxFormula', 'e.g. 10 + con_mod * 2') : null,
        ['choice', 'die'].includes(a.kind) ? ui.field({ label: 'Options (one per line)', control: ui.input({ multiline: true, rows: 3, value: (a.options || []).join('\n'), onInput: x => { a.options = x.split('\n').map(y => y.trim()).filter(Boolean); touch(); } }) }) : null,
        ui.field({ label: 'Unit', control: ui.input({ value: a.unit || '', placeholder: 'e.g. kg', onInput: x => { if (x) a.unit = x; else delete a.unit; save(); } }) }),
      ]);
      const row = h('div.tr-arow', [
        h('div.tr-amain', [
          grip,
          cl(ui.input({ value: a.short || '', placeholder: 'Short', onInput: x => { a.short = x.slice(0, 8); touch(); } }), 'tr-ashort'),
          cl(ui.input({ value: a.label, placeholder: 'Name', onInput: x => { a.label = x; touch(); } }), 'tr-alabel'),
          ui.select({ value: a.kind, options: Object.entries(T.KINDS).map(([k, d]) => [k, d.icon + ' ' + d.label]), onChange: x => { a.kind = x; if (x === 'choice' && !a.options) a.options = []; touch(); repaint(); } }),
          cl(ui.input({ value: a.group || '', placeholder: 'Group', onInput: x => { a.group = x; touch(); } }), 'tr-agroup'),
          ui.button({ icon: open ? '▾' : '⚙', small: true, kind: 'ghost', title: 'Range, formula, options', onClick: () => { const k = 'a:' + s.id + ':' + a.key; S.open.has(k) ? S.open.delete(k) : S.open.add(k); repaint(); } }),
          ui.button({ icon: '✕', small: true, kind: 'ghost', title: 'Remove', onClick: () => { s.attrs = s.attrs.filter(x => x !== a); touch(); repaint(); } }),
        ]),
        open ? more : null,
      ]);
      sortable(s.attrs, a, row, grip, () => { touch(); repaint(); });
      return row;
    }

    /* ----- vocabulary ----- */
    function viewVocab() {
      const cbox = h('div.tr-concepts');
      const paintC = () => {
        GK.clear(cbox);
        work.concepts.forEach((c, i) => cbox.appendChild(h('div.tr-crow', [
          ui.input({ value: c.label, onInput: x => { c.label = x; touch(); }, placeholder: 'e.g. Ruler' }),
          ui.button({ icon: '✕', small: true, kind: 'ghost', onClick: () => { work.concepts.splice(i, 1); touch(); repaint(); } }),
        ])));
        cbox.appendChild(ui.button({ label: 'Add a word', icon: '＋', small: true, onClick: () => { const l = 'Word ' + (work.concepts.length + 1); work.concepts.push({ key: newId(l, new Set(work.concepts.map(c => c.key))), label: l }); touch(); repaint(); } }));
      };
      paintC();
      const tab = h('div.tr-vocab');
      const paintTable = () => {
        GK.clear(tab);
        if (!work.axes.length) return tab.appendChild(h('p.gk-small.gk-muted', { text: 'Add a classification first; then give each of its values its own words.' }));
        const a = work.axes.find(x => x.id === S.axis) || work.axes[0]; S.axis = a.id;
        const styles = WB.names && WB.names.STYLES ? Object.entries(WB.names.STYLES).map(([k, s]) => [k, s.label]) : [];
        tab.appendChild(h('div.wd-chips', work.axes.map(x => ui.chip({ label: x.icon + ' ' + x.name, on: x === a, onClick: () => { S.axis = x.id; paintTable(); } }))));
        const headCells = [h('th', { text: a.name })];
        work.concepts.forEach(c => headCells.push(h('th', { text: c.label })));
        if (styles.length) headCells.push(h('th', { text: 'Naming style' }));
        const bodyRows = T.tree(a).map(({ value: v, depth }) => {
          const cells = [h('th', { style: { paddingLeft: (.5 + depth) + 'em', '--c': v.color || a.color }, text: (v.icon ? v.icon + ' ' : '') + v.name })];
          for (const c of work.concepts) {
            const inherited = T.termFor(work, c.key, { [a.id]: [v.parent || ''] });
            cells.push(h('td', [ui.input({ value: (v.terms || {})[c.key] || '', placeholder: inherited, onInput: x => { v.terms = v.terms || {}; if (x.trim()) v.terms[c.key] = x; else delete v.terms[c.key]; save(); } })]));
          }
          if (styles.length) cells.push(h('td', [ui.select({ value: v.nameStyle || '', options: [['', '—']].concat(styles), onChange: x => { v.nameStyle = x; save(); } })]));
          return h('tr', cells);
        });
        const t = h('table.tr-table', [h('thead', [h('tr', headCells)]), h('tbody', bodyRows)]);
        tab.appendChild(h('div.tr-tablewrap', t));
      };
      paintTable();
      main.appendChild(h('div.tr-split.wide', [
        ui.panel({ title: 'Words that differ', icon: '❝', sub: 'The default word for each idea. Values below can override it: Thane for Northmen, Emir for desert folk.', body: cbox }),
        ui.panel({ title: 'Per value', icon: '☰', sub: 'Empty cells use the parent value’s word, else the default. The naming style steers name suggestions.', body: tab }),
      ]));
    }

    /* ----- packs & files ----- */
    function viewPacks() {
      const packs = h('div.tr-cards', Object.entries(T.PACKS).map(([k, p]) => h('div.tr-card.gk-panel', [
        h('b', { text: p.label }), h('div.gk-small.gk-muted', { text: p.desc }),
        h('div.gk-tiny.gk-muted', { text: p.axes.map(a => a.name).join(' · ') }),
        ui.button({ label: 'Add to this world', small: true, onClick: () => { work = T.mergePack(work, k); S.axis = work.axes[work.axes.length - 1].id; touch(); ui.toast(p.label + ' added', '◆'); repaint(); } }),
      ])));
      const systems = h('div.tr-cards', Object.entries(T.PRESET_SYSTEMS).map(([k, p]) => h('div.tr-card.gk-panel', [
        h('b', { text: p.label }), h('div.gk-small.gk-muted', { text: p.desc }),
        ui.button({ label: 'Add to this world', small: true, onClick: () => { work = T.addSystemPreset(work, k); touch(); ui.toast(p.label + ' added', '⬡'); repaint(); } }),
      ])));
      const files = ui.panel({ title: 'Share a configuration', icon: '⇅', sub: 'A file with your classifications, systems and words. Import it into another world.', body: [
        h('div.gk-row', [
          ui.button({ label: 'Export…', icon: '⇩', small: true, onClick: async () => { const p = await GK.host('file:saveJson', (WB.world.name || 'world').replace(/[^\w -]+/g, '') + '.people.json', T.exportConfig(work)); if (p) ui.toast('Saved to ' + p, '⇩'); } }),
          ui.button({ label: 'Import…', icon: '⇪', small: true, onClick: async () => {
            try {
              const d = await GK.host('file:openJson'); if (!d) return;
              const cfg = T.importConfig(d);
              const hasNow = work.axes.length || work.systems.length;
              if (hasNow && !(await ui.confirm('Replace the current setup?', 'The file has ' + cfg.axes.length + ' classifications and ' + cfg.systems.length + ' systems. They replace the ones here.', 'Replace', true))) return;
              work = cfg; touch(); ui.toast('Imported', '⇪'); repaint();
            } catch (e) { WB.fail(e); }
          } }),
        ]),
      ] });
      const migrate = ui.panel({ title: 'Use it on Character and Species', icon: '☺', sub: 'Worlds made before this feature do not have the “Classification” and “Attributes” fields yet. This adds them; nothing is removed or changed, and the old Stats field keeps working.', body: [
        ui.button({ label: 'Add the fields', small: true, onClick: async () => {
          let n = 0;
          for (const t of WB.typeList({ all: true })) {
            if (!['character', 'species'].includes(t.key)) continue;
            const next = T.ensureFields(t.fields || []);
            if (next.length !== (t.fields || []).length) { await WB.api('types.save', Object.assign({}, t, { fields: next })); n++; }
          }
          ui.toast(n ? 'Added to ' + n + ' types' : 'Already there', '☺');
        } }),
      ] });
      main.appendChild(h('div.gk-stack', [
        ui.panel({ title: 'Starter packs', icon: '◆', sub: 'Pick one or mix several. Packs only add classifications; edit or delete anything afterwards.', body: packs }),
        ui.panel({ title: 'Attribute presets', icon: '⬡', body: systems }), migrate, files,
      ]));
    }

    const VIEW = { axes: viewAxes, systems: viewSystems, vocab: viewVocab, packs: viewPacks };
    box.append(h('div.tr-top', [bar, problems]), main);
    paintBar(); paintProblems(); repaint();
  }

  WB.traitsTab = tabPeople;
  WB.commands.add({ id: 'world:people', label: 'People & attributes', icon: '◆', group: 'World', run: () => WB.go('world', { tab: 'people' }) });

  /* the live app: set up an axis and a system in World settings, pick values on an entry, see totals */
  WB.smoke('people-attributes', async () => {
    const T2 = window.WBTraits;
    let cfg = T2.emptyConfig();
    cfg = T2.mergePack(cfg, 'fantasy');
    cfg = T2.addSystemPreset(cfg, 'classic6');
    const elf = cfg.axes[0].values.find(v => v.name === 'Elf');
    elf.mods = [{ system: cfg.systems[0].id, attr: 'dex', add: 2 }];
    WB.world.settings = Object.assign({}, WB.world.settings, { traits: cfg });
    await WB.api('worlds.update', WB.worldId, { settings: { traits: cfg } });
    await WB.go('world', { tab: 'people' }); await WB.wait(700);
    const sec = document.querySelectorAll('.tr-list .wb-row').length;
    if (!sec) return 'error: People & attributes did not open';
    const sysId = cfg.systems[0].id, raceId = cfg.axes[0].id;
    const rows = T2.compute(cfg, sysId, { dex: 12 }, { [raceId]: [elf.id] });
    const dex = rows.find(r => r.key === 'dex');
    if (!dex || dex.total !== 14) return 'error: expected DEX 14 for an Elf with base 12, got ' + (dex && dex.total);
    // render the entry-side controls into a scratch box and read the totals
    const type = WB.typeList().find(t => t.key === 'character');
    const def = (type.fields || []).find(f => f.kind === 'attrs') || { key: 'attributes', kind: 'attrs', label: 'Attributes' };
    const axisDef = (type.fields || []).find(f => f.kind === 'axis') || { key: 'classes', kind: 'axis', label: 'Classification' };
    const host = document.body.appendChild(h('div', { style: { position: 'fixed', left: '-9999px', top: 0, width: '40em' } }));
    host.append(WB.ui.field(axisDef, { [raceId]: [elf.id] }, () => { }), WB.ui.field(def, { [sysId]: { dex: 12 } }, () => { }));
    await WB.wait(200);
    const cell = host.querySelector('[data-key="dex"] .tr-total');
    const text = cell && cell.textContent;
    host.remove();
    return /14/.test(text || '') ? { dex: text } : 'error: the stat block did not show 14, it shows ' + text;
  });
})();
