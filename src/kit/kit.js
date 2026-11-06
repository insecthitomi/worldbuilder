/* Glass Kit core: DOM helper, event bus, module registry, component factories, module storage. */
(function (root) {
  'use strict';
  const GK = root.GK = { version: '1.0.0' };

  /* ---- h('div.a.b#id', props, children) ---- */
  function h(spec, props, kids) {
    if (Array.isArray(props) || props instanceof Node || typeof props === 'string') { kids = props; props = null; }
    const m = String(spec).match(/^([a-z0-9-]*)((?:[.#][\w-]+)*)$/i);
    const el = document.createElement((m && m[1]) || 'div');
    if (m && m[2]) for (const part of m[2].match(/[.#][\w-]+/g)) part[0] === '.' ? el.classList.add(part.slice(1)) : (el.id = part.slice(1));
    for (const [k, v] of Object.entries(props || {})) {
      if (v == null || v === false) continue;
      if (k === 'class') String(v).split(/\s+/).filter(Boolean).forEach(c => el.classList.add(c));
      else if (k === 'style' && typeof v === 'object') Object.assign(el.style, v);
      else if (k === 'text') el.textContent = v;
      else if (k === 'html') el.innerHTML = v;
      else if (k === 'dataset') Object.assign(el.dataset, v);
      else if (k.startsWith('on') && typeof v === 'function') el.addEventListener(k.slice(2).toLowerCase(), v);
      else if (k in el && typeof v !== 'string') el[k] = v;
      else el.setAttribute(k, v === true ? '' : v);
    }
    append(el, kids);
    return el;
  }
  function append(el, kids) {
    if (kids == null || kids === false) return el;
    if (!Array.isArray(kids)) kids = [kids];
    for (const k of kids.flat(Infinity)) {
      if (k == null || k === false) continue;
      el.appendChild(k instanceof Node ? k : document.createTextNode(String(k)));
    }
    return el;
  }
  GK.h = h;
  /* Drags and the UI scale. The app scales with CSS zoom, so pointer coordinates (clientX/Y, getBoundingClientRect)
     are screen-space CSS px while left/top/width set on a zoomed element are multiplied by its zoom. Anything that
     follows the pointer converts through these, or it drifts away from the cursor whenever the scale is not 1. */
  GK.zoomOf = el => (el && el.currentCSSZoom) || 1;
  // pointer distance (screen CSS px) -> the element's own CSS px
  GK.local = (el, d) => d / GK.zoomOf(el);
  /* Placing things where something was measured. Rects (getBoundingClientRect, getClientRects, a caret) and pointer
     coordinates are screen space; left/top inside an element are in its own px (zoom divided out, measured from the
     padding box, scroll included — scrollTop/clientLeft are already element px). Results land on whole device pixels. */
  GK.snapPx = (v, el) => { const k = (devicePixelRatio || 1) * GK.zoomOf(el); return Math.round(v * k) / k; };
  /** a screen point -> left/top for a position:absolute child of el */
  GK.pointIn = (el, x, y) => {
    const r = el.getBoundingClientRect(), z = GK.zoomOf(el);
    return { x: GK.snapPx((x - r.left) / z - el.clientLeft + el.scrollLeft, el), y: GK.snapPx((y - r.top) / z - el.clientTop + el.scrollTop, el) };
  };
  /** a screen rect -> { left, top, width, height } for a position:absolute child of el */
  GK.rectIn = (el, rect) => {
    const p = GK.pointIn(el, rect.left, rect.top), z = GK.zoomOf(el);
    return { left: p.x, top: p.y, width: GK.snapPx(rect.width / z, el), height: GK.snapPx(rect.height / z, el) };
  };
  GK.append = append;
  GK.clear = el => { while (el.firstChild) el.removeChild(el.firstChild); return el; };

  /* ---- add-ons announce themselves; layouts live in their own namespace ---- */
  GK.addons = [];
  GK.addon = (meta) => { GK.addons.push(meta); return meta; };
  GK.layouts = {};

  /* ---- events ---- */
  const subs = {};
  GK.bus = {
    on(ev, fn) { (subs[ev] = subs[ev] || new Set()).add(fn); return () => subs[ev].delete(fn); },
    emit(ev, data) { (subs[ev] || []).forEach(fn => { try { fn(data); } catch (e) { console.error(e); } }); },
  };

  /* ---- 'layout': anything placed from a measurement re-places itself on this, not on window resize.
     It fires (once per frame) for a window resize, a UI scale change (engine.js), a display or browser zoom
     change (devicePixelRatio) and when web fonts finish loading — the four things that move measured positions. */
  let layoutRaf = 0, layoutWhy = new Set();
  GK.layout = why => {
    layoutWhy.add(why || 'layout');
    if (layoutRaf) return;
    layoutRaf = requestAnimationFrame(() => { layoutRaf = 0; const w = [...layoutWhy]; layoutWhy = new Set(); GK.bus.emit('layout', w); });
  };
  root.addEventListener('resize', () => GK.layout('resize'));
  (function watchDpr() {
    const mq = root.matchMedia && root.matchMedia('(resolution: ' + (root.devicePixelRatio || 1) + 'dppx)');
    if (mq && mq.addEventListener) mq.addEventListener('change', () => { GK.layout('dpr'); watchDpr(); }, { once: true });
  })();
  if (document.fonts && document.fonts.ready) document.fonts.ready.then(() => GK.layout('fonts'));

  /* ---- host bridge (main process) ---- */
  GK.host = (name, ...args) => (root.host ? root.host.call(name, ...args) : Promise.resolve(null));

  /* ---- modules ---- */
  const mods = new Map();
  GK.modules = {
    register(def) {
      if (!def || !def.id || typeof def.mount !== 'function') throw new Error('A module needs an id and mount(host, ctx)');
      mods.set(def.id, Object.assign({ title: def.id, icon: '◇', order: 100, nav: true }, def));
      if (def.settings && GK.settings) GK.settings.extend(def.settings);
      GK.bus.emit('modules', def.id);
      return def;
    },
    get: id => mods.get(id),
    list: () => [...mods.values()].sort((a, b) => a.order - b.order),
  };

  /* ---- per-module persistent storage (userData/modules/<id>.json) ---- */
  GK.store = async function (id, defaults) {
    let value = (await GK.host('store:load', id)) ?? (defaults === undefined ? {} : structuredClone(defaults));
    let t = null;
    const save = () => { clearTimeout(t); t = setTimeout(() => GK.host('store:save', id, value), 250); };
    return {
      get: () => value,
      set(v) { value = v; save(); return value; },
      patch(p) { value = Object.assign({}, value, p); save(); return value; },
    };
  };

  /* ---- components ---- */
  const ui = GK.ui = {};

  ui.panel = function ({ title, icon, sub, actions, body, material, lens = true, cls } = {}) {
    const head = (title || actions) && h('div.gk-panel-head', [
      icon && h('span.gk-ico', { text: icon }),
      title && h('h3', { text: title }),
      actions && h('div.gk-row.nowrap', actions),
    ]);
    return h('section.gk-panel', { class: [cls, !lens && 'gk-nolens'].filter(Boolean).join(' '), dataset: material ? { mat: material } : null }, [
      head, sub && h('div.gk-panel-sub', { text: sub }), h('div.gk-panel-body', body),
    ]);
  };

  ui.widget = function ({ body, onClick, material, cls, lens = true } = {}) {
    return h('div.gk-widget', { class: [cls, onClick && 'interactive', !lens && 'gk-nolens'].filter(Boolean).join(' '), onclick: onClick, tabindex: onClick ? 0 : null, dataset: material ? { mat: material } : null }, body);
  };

  ui.stat = ({ label, value, note, icon, onClick }) => ui.widget({ onClick, body: [
    h('div.gk-stat-label', [icon ? icon + '  ' : '', label]), h('div.gk-stat-value', { text: value }), note && h('div.gk-stat-note', { text: note }),
  ] });

  ui.item = ({ icon, title, sub, trailing, onClick }) => ui.widget({ onClick, cls: 'gk-item', body: [
    icon && h('div.gk-item-ico', { text: icon }),
    h('div.gk-item-main', [h('div.gk-item-title', { text: title }), sub && h('div.gk-item-sub', { text: sub })]),
    trailing,
  ] });

  ui.button = ({ label, icon, kind, small, title, onClick, disabled } = {}) => h('button.gk-btn.gk-control', {
    class: [kind, small && 'small', !label && 'icon'].filter(Boolean).join(' '), title: title || null, disabled: !!disabled,
    onclick: onClick, type: 'button',
  }, [icon && h('span', { text: icon }), label]);

  ui.input = ({ value = '', placeholder, onInput, onChange, multiline, type = 'text', rows } = {}) => {
    const el = h(multiline ? 'textarea.gk-input.gk-control' : 'input.gk-input.gk-control', { placeholder, type: multiline ? null : type, rows });
    el.value = value;
    if (onInput) el.addEventListener('input', () => onInput(el.value));
    if (onChange) el.addEventListener('change', () => onChange(el.value));
    return el;
  };

  ui.select = ({ value, options, onChange } = {}) => {
    const el = h('select.gk-input.gk-control', { onchange: () => onChange && onChange(el.value) },
      options.map(o => { const [v, l] = Array.isArray(o) ? o : typeof o === 'object' ? [o.value, o.label] : [o, o]; return h('option', { value: v, text: l }); }));
    el.value = value;
    return el;
  };

  ui.toggle = ({ value, onChange, title } = {}) => {
    const el = h('button.gk-switch.gk-control', { type: 'button', role: 'switch', title: title || null, 'aria-checked': String(!!value), class: value ? 'on' : '' });
    el.addEventListener('click', () => { const on = !el.classList.contains('on'); el.classList.toggle('on', on); el.setAttribute('aria-checked', String(on)); onChange && onChange(on); });
    return el;
  };

  ui.slider = ({ min = 0, max = 100, step = 1, value = 0, unit = '', format, onInput } = {}) => {
    const fmt = format || (v => (Math.round(v * 100) / 100) + unit);
    const out = h('span.gk-val');
    const r = h('input.gk-range', { type: 'range', min, max, step });
    const paint = () => { r.style.setProperty('--p', ((r.value - min) / (max - min || 1)) * 100 + '%'); out.textContent = fmt(+r.value); };
    r.value = value; paint();
    r.addEventListener('input', () => { paint(); onInput && onInput(+r.value); });
    return h('div.gk-row.nowrap', [h('div.gk-grow', [r]), out]);
  };

  ui.segmented = ({ value, options, onChange } = {}) => {
    const wrap = h('div.gk-seg.gk-control');
    for (const o of options) {
      const [v, l, tip] = Array.isArray(o) ? o : [o.value, o.label, o.title];
      const b = h('button', { type: 'button', text: l, title: tip || null, class: v === value ? 'on' : '' });
      b.addEventListener('click', () => { wrap.querySelectorAll('button').forEach(x => x.classList.toggle('on', x === b)); onChange && onChange(v); });
      wrap.appendChild(b);
    }
    return wrap;
  };

  ui.color = ({ value = '#000000', onInput } = {}) => {
    const i = h('input', { type: 'color' });
    i.value = value;
    i.addEventListener('input', () => onInput && onInput(i.value));
    return h('label.gk-color', [i]);
  };

  // Controls that belong together. Under Prism (GPU glass) they melt into one liquid shape where they nearly touch.
  ui.group = (items, { merge = true, radius } = {}) => h('div.gk-group', { dataset: merge ? { glassMerge: radius ? String(radius) : '' } : null }, items);

  ui.chip = ({ label, on, onClick, title } = {}) => h('button.gk-chip.gk-control', { type: 'button', class: on ? 'on' : '', title: title || null, onclick: onClick }, label);

  ui.field = ({ label, hint, inline, control, value } = {}) => h('label.gk-field', { class: inline ? 'inline' : '' }, [
    label && h('span.gk-label', [label, value != null ? h('span.gk-faint', { text: value }) : null]), control, hint && h('span.gk-hint', { text: hint }),
  ]);

  ui.tabs = ({ tabs, value, onChange } = {}) => {
    const wrap = h('div.gk-tabs');
    for (const [v, l] of tabs) {
      const b = h('button', { type: 'button', text: l, class: v === value ? 'on' : '' });
      b.addEventListener('click', () => { wrap.querySelectorAll('button').forEach(x => x.classList.toggle('on', x === b)); onChange && onChange(v); });
      wrap.appendChild(b);
    }
    return wrap;
  };

  ui.meter = (fraction) => h('div.gk-meter', [h('i', { style: { width: Math.max(0, Math.min(1, fraction)) * 100 + '%' } })]);

  ui.dialog = ({ title, icon, body, actions } = {}) => new Promise(resolve => {
    let scrim;
    const close = v => { scrim.remove(); document.removeEventListener('keydown', onKey); resolve(v); };
    const onKey = e => { if (e.key === 'Escape') close(null); };
    const btns = (actions || [{ label: 'OK', kind: 'primary', value: true }]).map(a => ui.button({ label: a.label, kind: a.kind, onClick: () => close(a.value) }));
    const panel = ui.panel({ title, icon, body, cls: 'gk-dialog' });
    panel.appendChild(h('div.gk-panel-foot', btns));
    scrim = h('div.gk-scrim', { onclick: e => { if (e.target === scrim) close(null); } }, [panel]);
    document.body.appendChild(scrim);
    document.addEventListener('keydown', onKey);
    setTimeout(() => (panel.querySelector('input,textarea') || btns[btns.length - 1]).focus(), 30);
  });

  ui.confirm = (title, text, okLabel = 'OK', danger) => ui.dialog({ title, body: h('p.gk-text', { text }), actions: [{ label: 'Cancel', value: false }, { label: okLabel, kind: danger ? 'primary danger' : 'primary', value: true }] });

  ui.prompt = async (title, value = '', placeholder = '') => {
    const inp = ui.input({ value, placeholder });
    inp.addEventListener('keydown', e => { if (e.key === 'Enter') inp.closest('.gk-dialog').querySelector('.gk-panel-foot .primary').click(); });
    const ok = await ui.dialog({ title, body: inp, actions: [{ label: 'Cancel', value: false }, { label: 'OK', kind: 'primary', value: true }] });
    return ok ? inp.value.trim() : null;
  };

  let toastHost = null;
  ui.toast = (text, icon = '✓', ms = 2600) => {
    if (!toastHost) toastHost = document.body.appendChild(h('div.gk-toasts'));
    const t = toastHost.appendChild(h('div.gk-toast.gk-widget.gk-nolens', [h('span', { text: icon }), h('span', { text })]));
    setTimeout(() => { t.classList.add('out'); setTimeout(() => t.remove(), 300); }, ms);
  };

  /* ---- smoke-test hooks (used by main.js --smoke) ---- */
  const smokeSteps = new Map(), smokeChecks = [];
  GK.smoke = {
    step(name, fn) { smokeSteps.set(name, fn); },
    check(name, fn) { smokeChecks.push([name, fn]); },
    steps: () => [...smokeSteps.keys()],
    run: async name => { try { return await smokeSteps.get(name)(); } catch (e) { return 'error: ' + e.message; } },
    checks: () => smokeChecks.map(([name, fn]) => { try { return { name, ok: !!fn() }; } catch (e) { return { name, ok: false, error: e.message }; } }),
  };
})(window);
