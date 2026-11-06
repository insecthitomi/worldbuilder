/* Appearance Studio: a category rail, grouped controls, a search over everything and a live preview, rendered from
   GK.settings.schema. Where each setting shows is the LAYOUT below (categories → groups → keys, advanced keys
   folded under "More"); a setting that no layout names still shows, in the category of its schema section.
   The rail is data-driven: a category appears only when it has something to show. Apps add their own with
   GK.studio.addCategory / addGroup. Control types live in GK.studio.controls as (item, value, set) → element. */
(function (root) {
  'use strict';
  const GK = root.GK, h = GK.h, ui = GK.ui, S = GK.settings;

  /* ================= categories ================= */
  const LAYOUT = [
    { id: 'quick', icon: '✦', label: 'Quick start', desc: 'The few choices most people want', render: () => quickStart() },
    { id: 'looks', icon: '◆', label: 'Theme & looks', desc: 'Ready-made looks and your saved ones', render: () => looksPage() },
    { id: 'background', icon: '▧', label: 'Background', desc: 'Wallpaper, your own image, shade', groups: [
      { title: 'Wallpaper', keys: ['backdrop', 'bgMedia', 'bgFit'] },
      { title: 'Shade & blur', hint: 'Calm a busy wallpaper so text stands out.', keys: ['dimA', 'dimColor', 'bgBlur'] },
    ] },
    { id: 'glass', icon: '◇', label: 'Glass', desc: 'Clear or frosted, tint, refraction, light', groups: [
      { title: 'Material', hint: 'Glass shows the background through it; solid is an opaque colour.', keys: ['matAll'], more: ['matPanel', 'matWidget', 'matControl'] },
      { title: 'Clarity & tint', hint: 'Glass is perfectly clear at 0 everywhere. Tint colours it, milkiness clouds it, frost blurs it.', keys: ['tintA', 'tint', 'glassA', 'blur'] },
      { title: 'Light', keys: ['lightAngle', 'shine', 'colHl', 'lightColor'], more: ['lightReach'] },
      { title: 'Light & glow', hint: 'Let the wallpaper light the glass: bright areas glow and bleed light, a soft haze lifts the shadows. All off by default.',
        keys: ['glow', 'envLight', 'haze'], more: ['glowSize', 'glowThreshold', 'halation'] },
      { title: 'Refraction', hint: 'Glass bends what is behind it, like a real lens.', keys: ['lens', 'glassEngine', 'bulge'],
        more: ['ior', 'thickness', 'lensRim', 'rimClear', 'dispersion', 'iris', 'caustics', 'glassShadow', 'glassControls', 'adaptive', 'lensStrength', 'lensFrost', 'chroma'] },
      { title: 'Window edge', hint: 'A glass rim around the whole window.', keys: ['winFrame', 'winFrameK'] },
    ] },
    { id: 'colors', icon: '●', label: 'Colours', desc: 'Every colour: text, accent, lines, highlights', actions: () => [colorsResetBtn()], groups: [
      { title: 'Text', hint: 'Auto colours follow the main text colour.', keys: ['text', 'colMuted', 'colFaint', 'colLink'] },
      { title: 'Accent', keys: ['accent', 'accentInk'] },
      { title: 'Highlights & lines', hint: 'Selection, hover, focus and the light on glass edges.', keys: ['colSel', 'colHover', 'colFocus', 'colHl', 'colLine'], more: ['colNow', 'colScroll', 'colWell'] },
      { title: 'Status', keys: ['colGood', 'colWarn', 'colBad', 'colOnFill'] },
      { title: 'Surfaces', keys: ['bg', 'tint', 'tintA', 'solidLink', 'solidPanel', 'solidPanelOwn', 'solidWidget', 'solidControl'], more: ['inkMode', 'inkColor'] },
      { title: 'Outlines, light & shade', keys: [{ key: 'olColor', always: true }, { key: 'btnOutlineCol', always: true }, 'lightColor'], more: ['dimColor', { key: 'tbgColor', always: true }] },
    ] },
    { id: 'text', icon: 'Aa', label: 'Text & outline', desc: 'Fonts, size, outlines around text and buttons', groups: [
      { title: 'Fonts', keys: ['fontUI', 'fontHead'], more: ['fontMono'] },
      { title: 'Size & spacing', keys: ['textSize', 'lineHeight'], more: ['letterSpacing', 'headWeight'] },
      { title: 'Text outline', hint: 'A contour around letters: text stays readable over any wallpaper.', keys: ['olStyle', 'olWidth', 'olColor', 'olA'] },
      { title: 'Button outlines', keys: ['btnOutline', 'btnOutlineW', 'btnOutlineCol'] },
      { title: 'Readability', keys: ['tbgA', 'tbgColor'] },
    ] },
    { id: 'spacing', icon: '▢', label: 'Spacing & shape', desc: 'Distance between things, sizes, corners', groups: [
      { title: 'How it fits together', render: () => spacingDiagram(), search: 'diagram spacing preview' },
      { title: 'Space', keys: ['gap', 'pad', 'rowGap'] },
      { title: 'Controls', hint: 'Buttons, inputs, chips. Auto follows the text size.', keys: ['ctlH', 'ctlPx'] },
      { title: 'Shape & size', keys: ['radius', 'scale'] },
    ] },
    { id: 'motion', icon: '≈', label: 'Motion & effects', desc: 'Animations, liquid glass', groups: [
      { title: 'Animation', keys: ['motion', 'followSystem'] },
      { title: 'Liquid glass', keys: ['liquid', 'liquidSelect', 'pointerLight'] },
    ] },
    { id: 'graphics', icon: '⚡', label: 'Graphics & performance', desc: 'Quality, auto-tune, renderer', groups: [
      { title: 'Glass renderer', keys: ['lens', 'glassEngine', 'glassQuality', 'adaptive'] },
      { title: 'Accessibility', keys: ['followSystem'] },
    ] },
    { id: 'profiles', icon: '⇅', label: 'Saved looks & files', desc: 'Save, share and bring in looks', groups: [
      { title: 'Your saved looks', render: () => savedLooks(), search: 'save saved looks profile load delete' },
      { title: 'Look files', render: () => lookFiles(), search: 'export import share file json reset everything' },
    ] },
  ];
  // where a setting nobody placed goes (its schema section → a category); unknown sections get a category of their own
  const SECTION_CAT = { material: 'glass', background: 'background', colors: 'colors', text: 'text', glass: 'glass', shape: 'spacing',
    effects: 'motion', graphics: 'graphics', profiles: 'profiles' };
  const INTERNAL = new Set(['accentInkAuto', 'btnOutlineAuto']);   // shown as part of another control
  const NORESET = new Set(['media']);
  const WIDE = new Set(['backdrop', 'font', 'media']);
  // extra words people search with
  const TAGS = {
    text: 'ink font colour main', colMuted: 'grey gray label secondary', colFaint: 'placeholder dim quiet', colLink: 'url hyperlink',
    colSel: 'highlight selected marker', colHover: 'highlight mouse pointer', colFocus: 'highlight keyboard tab ring', colHl: 'highlight rim edge shine specular glare',
    colLine: 'border divider separator grid', colNow: 'calendar timeline today time current line', colScroll: 'scroll thumb', colWell: 'input field textbox background',
    colOnFill: 'contrast badge pill', accentInk: 'contrast button text', bg: 'base background behind', tint: 'tinted colour dark glass', tintA: 'tinted transparency opacity',
    glassA: 'opacity frosted cloudy transparency', blur: 'frosted milky', gap: 'distance between panels margin', pad: 'distance inside padding room', rowGap: 'distance between rows list items density',
    ctlH: 'button height size distance', ctlPx: 'button padding distance', radius: 'round corners', scale: 'zoom bigger smaller size', olStyle: 'stroke contour border readable',
    btnOutline: 'border stroke outline', matAll: 'solid opaque glass transparent', lens: 'refraction bend distortion', motion: 'animation reduce',
    glassQuality: 'performance quality speed fast slow lag', tbgA: 'plate behind text readable',
    bulge: 'magnify magnifying bulge warp lens body refraction bend zoom through', bubbleLens: 'magnify marble bulge warp lens inverted upside down refraction',
    envLight: 'wallpaper light image lighting colour reflection ambient environment rim', glow: 'bloom glowing halo light bleed sunlight dreamy',
    glowSize: 'bloom halo radius spread', glowThreshold: 'bloom bright threshold', halation: 'film warm fringe bloom glow orange red', haze: 'mist misty dreamy soft diffusion lifted milky light',
  };
  const SYN = [
    ['colour', 'color', 'colours', 'colors', 'hue', 'paint'], ['blur', 'frost', 'frosted', 'milky', 'milkiness', 'cloudy'],
    ['spacing', 'space', 'gap', 'distance', 'padding', 'margin', 'density', 'compact', 'roomy', 'tight', 'cozy'],
    ['highlight', 'highlights', 'rim', 'shine', 'sheen', 'specular', 'selection', 'hover', 'focus'],
    ['outline', 'outlines', 'stroke', 'contour', 'border'], ['size', 'scale', 'zoom', 'bigger', 'smaller', 'larger'],
    ['transparent', 'transparency', 'clear', 'opacity', 'see-through'], ['tint', 'tinted', 'tone'], ['font', 'fonts', 'typeface', 'typography'],
    ['background', 'wallpaper', 'backdrop', 'image', 'picture', 'photo', 'video', 'gif'],
    ['animation', 'animations', 'motion', 'moving', 'transition'], ['corner', 'corners', 'radius', 'round', 'rounded'],
    ['button', 'buttons', 'control', 'controls', 'inputs'], ['performance', 'speed', 'lag', 'gpu', 'graphics', 'quality'],
    ['line', 'lines', 'divider', 'dividers', 'separator'],
    ['glow', 'glowing', 'bloom', 'halation', 'halo', 'radiance'], ['haze', 'hazy', 'mist', 'misty', 'diffusion'],
    ['magnify', 'magnifying', 'magnification', 'bulge', 'bulging', 'warp', 'warping'],
    ['scrollbar', 'scrollbars', 'scroll'], ['link', 'links', 'url'], ['status', 'good', 'warning', 'danger', 'error', 'overdue'],
    ['dark', 'night'], ['look', 'looks', 'theme', 'themes', 'preset', 'presets'], ['profile', 'profiles', 'saved', 'export', 'import'],
  ];
  const AUTO_TOKEN = { colMuted: '--muted', colFaint: '--faint', colLine: '--line', colLink: '--link', colFocus: '--focus', colSel: '--sel', colHover: '--hover',
    colHl: '--hl', colNow: '--now', colScroll: '--scroll', colWell: '--well', colGood: '--good', colBad: '--bad', colWarn: '--warn', colOnFill: '--on-fill',
    rowGap: '--row-gap', ctlH: '--ctl-h', ctlPx: '--ctl-px' };

  const byKey = k => S.schema.find(it => it.key === k);
  const catOf = id => LAYOUT.find(c => c.id === id);
  /** The category a schema section falls into; a section nobody mapped gets its own category (before the last one). */
  function sectionCat(section) {
    const c = catOf(SECTION_CAT[section]) || catOf(section);
    if (c) return c;
    const sec = (S.sections || []).find(x => (Array.isArray(x) ? x[0] : x.id) === section);
    const label = sec ? (Array.isArray(sec) ? sec[1] : sec.label) : String(section || 'Other').replace(/^./, m => m.toUpperCase());
    return api.addCategory({ id: section || 'other', icon: (sec && (Array.isArray(sec) ? sec[2] : sec.icon)) || '•', label, desc: '', groups: [] });
  }
  const valKey = it => it.mapsTo || it.key;
  const same = (a, b) => (a === b) || (typeof a === 'string' && typeof b === 'string' && a.toLowerCase() === b.toLowerCase()) || JSON.stringify(a) === JSON.stringify(b);

  /* ================= colour & size helpers ================= */
  function parseColor(str) {
    let m = String(str).match(/rgba?\(([^)]+)\)/);
    if (m) { const p = m[1].split(/[\s,/]+/).filter(Boolean).map(Number); return [p[0], p[1], p[2], p.length > 3 ? p[3] : 1]; }
    m = String(str).match(/color\(srgb\s+([^)]+)\)/);
    if (m) { const p = m[1].split(/[\s/]+/).filter(Boolean).map(Number); return [p[0] * 255, p[1] * 255, p[2] * 255, p.length > 3 ? p[3] : 1]; }
    return null;
  }
  const toHex = (c, alpha) => GK.color.hex(c.slice(0, 3)) + (alpha && c[3] < .995 ? Math.round(c[3] * 255).toString(16).padStart(2, '0') : '');
  /** What a derived colour token resolves to, on the surface `where` (it follows that surface's text colour). */
  function tokenColor(token, where) {
    const host = where && where.isConnected ? where : document.body;
    const p = host.appendChild(h('span', { 'aria-hidden': 'true', style: { position: 'absolute', visibility: 'hidden', pointerEvents: 'none', color: `var(${token})` } }));
    const c = parseColor(getComputedStyle(p).color); p.remove();
    return c;
  }
  /** What a derived size token resolves to, in px. */
  function tokenPx(token) {
    const p = document.body.appendChild(h('div', { 'aria-hidden': 'true', style: { position: 'absolute', visibility: 'hidden', width: `var(${token})`, height: '0' } }));
    const w = p.getBoundingClientRect().width; p.remove();
    return Math.round(w);
  }

  /* ================= controls: (item, value, set) → element ================= */
  function colorControl(it, v, set) {
    const autoKey = it.autoKey, canAuto = !!(it.auto || autoKey), token = it.autoToken || AUTO_TOKEN[it.key];
    const isAuto = () => (autoKey ? S.get(autoKey) !== false : it.auto && !S.get(valKey(it)));
    const wrap = h('div.gk-colorctl');
    const chip = h('span.gk-colorctl-sw');
    const pick = h('input', { type: 'color', 'aria-label': (it.label || 'Colour') + ' — pick' });
    const sw = h('label.gk-colorctl-swatch', { title: 'Pick a colour' }, [chip, pick]);
    const hexIn = h('input.gk-input.gk-control.gk-colorctl-hex', { type: 'text', spellcheck: false, maxLength: it.alpha ? 9 : 7, 'aria-label': (it.label || 'Colour') + ' — hex code' });
    const autoBtn = canAuto && h('button.gk-colorctl-auto', { type: 'button', title: 'Auto: derived from the other colours', 'aria-pressed': 'false' }, 'Auto');
    const custom = c => { if (autoKey) S.patch({ [autoKey]: false, [it.key]: c.slice(0, 7) }); else set(c); };
    const paint = () => {
      const auto = canAuto && isAuto();
      let shown = auto ? null : S.get(valKey(it)) || v;
      if (auto && token) { const c = tokenColor(token, wrap); if (c) shown = toHex(c, it.alpha); }
      if (auto && !token && autoKey) shown = S.get(valKey(it));
      chip.style.background = auto && token ? `var(${token})` : (shown || 'transparent');
      if (shown) pick.value = shown.slice(0, 7);
      if (document.activeElement !== hexIn) { hexIn.value = auto ? '' : (shown || ''); hexIn.placeholder = auto ? (shown || 'Auto') : '#rrggbb'; hexIn.title = auto ? 'Auto' + (shown ? ': ' + shown : '') + ' — type a code to set your own' : ''; }
      if (autoBtn) { autoBtn.classList.toggle('on', auto); autoBtn.setAttribute('aria-pressed', String(auto)); }
      wrap.classList.toggle('auto', auto);
    };
    pick.addEventListener('input', () => {
      const cur = S.get(valKey(it)) || '', a = it.alpha && /^#[0-9a-f]{8}$/i.test(cur) ? cur.slice(7) : '';
      custom(pick.value + a); paint();
    });
    hexIn.addEventListener('input', () => {
      let t = hexIn.value.trim(); if (t && t[0] !== '#') t = '#' + t;
      if (/^#[0-9a-f]{3}$/i.test(t)) t = '#' + t.slice(1).split('').map(c => c + c).join('');
      if (/^#[0-9a-f]{6}$/i.test(t) || (it.alpha && /^#[0-9a-f]{8}$/i.test(t))) { custom(t.toLowerCase()); paint(); }
    });
    hexIn.addEventListener('blur', paint);
    hexIn.addEventListener('keydown', e => { if (e.key === 'Enter') hexIn.blur(); });
    if (autoBtn) autoBtn.addEventListener('click', e => {
      e.preventDefault();
      if (isAuto()) { const c = token && tokenColor(token, wrap); custom(c ? toHex(c, it.alpha) : (pick.value || '#888888')); }
      else if (autoKey) S.set(autoKey, true); else set('');
      paint();
    });
    wrap.append(...[sw, hexIn, autoBtn].filter(Boolean));
    wrap._refresh = paint;
    paint(); requestAnimationFrame(paint);   // the derived colour depends on the surface the control lands on
    return wrap;
  }

  function rangeControl(it, v, set) {
    const token = AUTO_TOKEN[it.key] || it.autoToken;
    let auto = it.auto && v == null;
    const base = it.format || (x => (Math.round(x * 100) / 100) + (it.unit || ''));
    const out = h('span.gk-val');
    const r = h('input.gk-range', { type: 'range', min: it.min, max: it.max, step: it.step || 1, 'aria-label': it.label || it.key });
    const paint = () => {
      r.style.setProperty('--p', ((r.value - it.min) / (it.max - it.min || 1)) * 100 + '%');
      out.textContent = (auto ? 'Auto · ' : '') + base(+r.value);
      r.classList.toggle('auto', auto);
    };
    r.value = auto ? (token ? tokenPx(token) : it.min) : v; paint();
    r.addEventListener('input', () => {
      // keep the slider under the pointer: a spacing or size change can move it (scroll the view by as much)
      const y0 = r.getBoundingClientRect().top;
      auto = false; paint(); set(+r.value);
      const dy = r.getBoundingClientRect().top - y0, sc = r.closest('.gk-view');
      if (dy && sc) sc.scrollTop += GK.local(sc, dy);
    });
    const el = h('div.gk-row.nowrap.gk-rangectl', { class: it.auto ? 'can-auto' : '' }, [h('div.gk-grow', [r]), out]);
    el._refresh = () => { const cur = S.get(it.key); if (it.auto && cur == null && token) { auto = true; r.value = tokenPx(token); paint(); } };
    return el;
  }

  const controls = {
    color: colorControl,
    range: rangeControl,
    toggle: (it, v, set) => { const t = ui.toggle({ value: v, onChange: set, title: it.label }); t.setAttribute('aria-label', it.label || it.key); return t; },
    choice: (it, v, set) => { const s = ui.segmented({ value: v, options: it.options, onChange: set }); s.setAttribute('role', 'group'); s.setAttribute('aria-label', it.label || it.key); return s; },
    font: (it, v, set) => fontControl(it, v, set),
    media: (it, v) => mediaControl(it, v),
    backdrop: (it, v, set) => backdropControl(it, v, set),
  };

  function fontControl(it, v, set) {
    const opts = [];
    if (it.allowSame) opts.push(['', 'Same as interface']);
    S.FONT_STACKS.forEach(f => opts.push(f));
    S.fontFiles.forEach(f => opts.push([`"${f.family}", ${S.FONT_STACKS[0][0]}`, f.family.replace(/^GK /, '') + ' (imported)']));
    S.systemFonts.forEach(n => opts.push([`"${n}", ${S.FONT_STACKS[0][0]}`, n]));
    if (v && !opts.some(o => o[0] === v)) opts.unshift([v, v.split(',')[0].replace(/"/g, '')]);
    const sel = ui.select({ value: v, options: opts, onChange: set });
    sel.setAttribute('aria-label', it.label || 'Font');
    sel.style.fontFamily = v || 'inherit';
    sel.addEventListener('change', () => { sel.style.fontFamily = sel.value || 'inherit'; });
    const imp = ui.button({ label: 'Import…', small: true, title: 'TTF, OTF, WOFF or WOFF2', onClick: async () => { const fam = await S.importFont(); if (fam) set(fam); } });
    const row = h('div.gk-row.nowrap', [h('div.gk-grow', [sel]), imp]);
    if (!S.fontFiles.length) return row;
    // imported fonts, each with a ✕; settings that used a removed font fall back to their default
    const remove = family => {
      S.removeFont(family);
      const p = {};
      for (const f of S.schema) if (f.type === 'font' && String(S.get(f.key) || '').includes(`"${family}"`)) p[f.key] = f.def;
      if (Object.keys(p).length) S.patch(p);
      if (wrap.isConnected) wrap.replaceWith(fontControl(it, S.get(it.mapsTo || it.key), set));
    };
    const list = h('div.gk-row.gk-fontfiles', S.fontFiles.map(f => h('span.gk-row.nowrap', { style: { gap: '2px' } }, [
      h('span.gk-small.gk-muted', { text: f.family.replace(/^GK /, ''), style: { fontFamily: `"${f.family}"` } }),
      ui.button({ label: '✕', kind: 'ghost', small: true, title: 'Remove ' + f.family.replace(/^GK /, ''), onClick: () => remove(f.family) }),
    ])));
    const wrap = h('div.gk-stack', { style: { gap: '6px' } }, [row, list]);
    return wrap;
  }

  function mediaControl(it, v) {
    return h('div.gk-row', [
      ui.button({ label: v ? 'Replace…' : 'Choose file…', icon: '🖼', small: true, onClick: () => S.pickBackground() }),
      v ? h('span.gk-small.gk-muted', { text: v.name + '.' + v.ext }) : h('span.gk-small.gk-faint', { text: 'none' }),
      v && ui.button({ label: 'Remove', kind: 'ghost', small: true, onClick: () => S.patch({ bgMedia: null, backdrop: S.get('backdrop') === 'custom' ? 'deepOcean' : S.get('backdrop') }) }),
    ]);
  }

  function backdropControl(it, v, set) {
    const grid = h('div.gk-swatches', { role: 'group', 'aria-label': 'Wallpaper' });
    for (const [key, p] of Object.entries(S.BACKDROPS)) {
      grid.appendChild(h('button.gk-swatch', { type: 'button', title: p.label, 'aria-pressed': String(key === v), class: key === v ? 'on' : '', style: { background: p.css || S.get('bg') }, onclick: () => set(key) }, [h('span', { text: p.label })]));
    }
    const m = S.get('bgMedia');
    if (m) grid.appendChild(h('button.gk-swatch', { type: 'button', title: 'Your file', 'aria-pressed': String(v === 'custom'), class: v === 'custom' ? 'on' : '', style: { background: m.video ? 'linear-gradient(135deg,#333,#111)' : `center/cover url("${m.url}")` }, onclick: () => set('custom') }, [h('span', { text: m.video ? '▶ ' + m.name : m.name })]));
    return grid;
  }

  /* ================= one setting row ================= */
  const isDefault = it => {
    if (it.autoKey) return S.get(it.autoKey) !== false;
    const d = it.mapsTo ? (byKey(it.mapsTo) || it).def : it.def;
    return same(S.get(valKey(it)), d);
  };
  function resetItem(it) {
    if (it.autoKey) return S.set(it.autoKey, true);
    const target = it.mapsTo ? byKey(it.mapsTo) || it : it;
    S.set(target.key, target.def);
  }
  /** A labelled control with a value readout, a reset (only when changed) and a hint. Returns { el, update }. */
  function settingRow(it, opt = {}) {
    let lastV = S.get(valKey(it)), autoSeen = it.autoKey ? S.get(it.autoKey) : undefined;
    const longChoice = it.type === 'choice' && (it.options.length > 3 || it.options.reduce((n, o) => n + String(o[1]).length + 3, 0) > 30);
    const wide = WIDE.has(it.type) || longChoice;
    const make = () => {
      const fn = GK.studio.controls[it.type] || controls.range;
      return fn(it, S.get(valKey(it)), x => { lastV = x; S.set(it.key, x); });
    };
    let ctl = make();
    const reset = h('button.gk-st-reset', { type: 'button', title: 'Back to the default', 'aria-label': 'Reset ' + it.label + ' to the default', onclick: e => { e.preventDefault(); resetItem(it); } }, '↺');
    const ctlBox = h('div.gk-st-ctl', { class: 'is-' + it.type }, [ctl]);
    const needNote = it.needs ? h('span.gk-st-need', { text: it.needs.note, hidden: true }) : null;
    const where = opt.where ? h('button.gk-st-where', { type: 'button', title: 'Show it in ' + opt.where.label, onclick: () => opt.onJump && opt.onJump() }, opt.where.label + (opt.group ? ' › ' + opt.group : '') + ' ↗') : null;
    const el = h('div.gk-st-row', { class: (wide ? 'wide ' : '') + 't-' + it.type, dataset: { key: it.key } }, [
      h('div.gk-st-lab', [h('span.gk-st-name', { text: it.label }), it.hint && h('span.gk-st-hint', { text: it.hint }), needNote, where]),
      ctlBox,
      NORESET.has(it.type) ? h('span') : reset,
    ]);
    const update = (force) => {
      const all = S.all();
      const visible = opt.always || !it.when || it.when(all);
      el.hidden = !visible;
      // a setting that only acts once another is on stays in view, dimmed, and says what it waits for
      const idle = !!(it.needs && !it.needs.test(all));
      el.classList.toggle('idle', idle);
      if (needNote) needNote.hidden = !idle;
      el.classList.toggle('changed', !NORESET.has(it.type) && !isDefault(it));
      const v = S.get(valKey(it));
      if (force || !same(v, lastV) || (it.autoKey && autoSeen !== S.get(it.autoKey))) {
        lastV = v; autoSeen = it.autoKey ? S.get(it.autoKey) : undefined;
        const next = make(); ctl.replaceWith(next); ctl = next;
      } else if (ctl._refresh) ctl._refresh();
    };
    update();
    return { el, update, it };
  }

  /* ================= placements: which setting shows where ================= */
  const norm = k => (typeof k === 'string' ? { key: k } : k);
  function placements() {
    const out = [], seen = new Set();
    for (const c of LAYOUT) for (const g of c.groups || []) {
      for (const [list, more] of [[g.keys || [], false], [g.more || [], true]]) for (const p of list.map(norm)) {
        const it = byKey(p.key); if (!it) continue;
        out.push({ cat: c, group: g, it, more, always: p.always, primary: !seen.has(p.key) }); seen.add(p.key);
      }
    }
    // settings no layout names: shown in the category of their schema section, under "More settings"
    for (const it of S.schema) {
      if (seen.has(it.key) || INTERNAL.has(it.key)) continue;
      const c = sectionCat(it.section);
      out.push({ cat: c, group: extraGroup(c), it, more: false, primary: true }); seen.add(it.key);
    }
    return out;
  }
  const extraGroups = new Map();
  function extraGroup(c) { if (!extraGroups.has(c.id)) extraGroups.set(c.id, { title: 'More settings', keys: [], extra: true }); return extraGroups.get(c.id); }

  /* ================= category pages ================= */
  let rows = [];          // live rows on screen
  const openMore = new Set();
  function groupEl(c, g, list) {
    if (g.render) {
      return h('section.gk-st-group', { dataset: { group: g.title } }, [groupHead(g), g.render()]);
    }
    const main = list.filter(p => !p.more), more = list.filter(p => p.more);
    if (!main.length && !more.length) return null;
    const mk = p => { const r = settingRow(p.it, { always: p.always }); rows.push(r); return r.el; };
    const kids = [groupHead(g), h('div.gk-st-rows', main.map(mk))];
    if (more.length) {
      const id = c.id + '/' + g.title;
      // a real disclosure (not <details>: its closed content keeps a layout box, and GPU glass would draw it)
      const body = h('div.gk-st-rows', { hidden: !openMore.has(id) }, more.map(mk));
      const btn = h('button.gk-st-moreb', { type: 'button', 'aria-expanded': String(openMore.has(id)) }, [h('span', 'More'), h('span.gk-st-count', { text: String(more.length) })]);
      const det = h('div.gk-st-more', { class: openMore.has(id) ? 'open' : '' }, [btn, body]);
      det._open = on => { body.hidden = !on; det.classList.toggle('open', on); btn.setAttribute('aria-expanded', String(on)); on ? openMore.add(id) : openMore.delete(id); };
      btn.addEventListener('click', () => det._open(body.hidden));
      // the count is what is there to see now; with nothing to show (every row waits on another setting) it hides
      const count = btn.querySelector('.gk-st-count');
      const sync = () => { const n = [...body.children].filter(r => !r.hidden).length; count.textContent = String(n); det.hidden = !n; };
      rows.push({ el: det, it: { type: 'more' }, update: sync });
      sync();
      kids.push(det);
    }
    return h('section.gk-st-group', { dataset: { group: g.title } }, kids);
  }
  const groupHead = g => h('div.gk-st-gh', [h('h4', { text: g.title }), g.hint && h('p', { text: g.hint })]);

  function categoryBody(c) {
    rows = [];
    if (c.render) return c.render();
    const all = placements().filter(p => p.cat === c);
    const groups = (c.groups || []).concat(extraGroups.has(c.id) ? [extraGroups.get(c.id)] : []);
    const els = groups.map(g => groupEl(c, g, all.filter(p => p.group === g))).filter(Boolean);
    return els.length ? els : h('p.gk-small.gk-muted', 'Nothing to set here yet.');
  }
  /** Only categories with something to show appear in the rail (custom pages, rendered groups or settings). */
  function hasContent(c, places) { return !!c.render || (c.groups || []).some(g => g.render) || places.some(p => p.cat === c); }
  function visibleCats() { const places = placements(); return LAYOUT.filter(c => hasContent(c, places)); }
  function categoryKeys(c) { return placements().filter(p => p.cat === c).map(p => p.it).filter(it => !NORESET.has(it.type) && !INTERNAL.has(it.key)); }

  /* ================= undo ================= */
  const UNDO = [], UNDO_MAX = 40;
  let undoBase = null, undoT = 0, undoing = false;
  GK.bus.on('settings', () => {
    if (undoing) return;
    if (!undoBase) return;
    if (!undoT) UNDO.push(undoBase);
    if (UNDO.length > UNDO_MAX) UNDO.shift();
    clearTimeout(undoT); undoT = setTimeout(() => { undoT = 0; undoBase = Object.assign({}, S.all()); }, 700);
  });
  function undoReady() { if (!undoBase) undoBase = Object.assign({}, S.all()); }
  function undo() {
    clearTimeout(undoT); undoT = 0;
    const prev = UNDO.pop(); if (!prev) return;
    const now = S.all(), p = {};
    Object.keys(prev).forEach(k => { if (!same(prev[k], now[k])) p[k] = prev[k]; });
    undoing = true; try { S.patch(p); } finally { undoing = false; }
    undoBase = Object.assign({}, S.all());
    ui.toast('Undone', '↶');
  }
  const undoBtn = () => h('button.gk-st-link.gk-st-undo', { type: 'button', title: 'Take back the last change (Ctrl Z)', disabled: !UNDO.length, onclick: undo }, '↶ Undo');

  /* ================= Quick start ================= */
  const DENSITY = {
    compact: { gap: 8, pad: 11, rowGap: 4, ctlH: 28, ctlPx: 10 },
    cozy: { gap: 14, pad: 16, rowGap: null, ctlH: null, ctlPx: null },
    roomy: { gap: 20, pad: 22, rowGap: 12, ctlH: 40, ctlPx: 18 },
  };
  const OUTLINE = {
    off: { olStyle: 'off', btnOutline: false },
    subtle: { olStyle: 'smooth', olWidth: 1.25, olA: .7, btnOutline: false },
    strong: { olStyle: 'crisp', olWidth: 4, olA: 1, btnOutline: true, btnOutlineW: 1.5 },
  };
  const ACCENTS = ['#6fd0ff', '#2aa7d6', '#8ea7ff', '#a78bfa', '#f472b6', '#f06f86', '#ff8a65', '#ffb36b', '#facc15', '#5eead4', '#52c98f', '#e9f4fb'];
  const SIZES = [[13, 'Small'], [14, 'Normal'], [16, 'Large'], [18, 'Larger']];
  const matches = (o) => Object.keys(o).every(k => same(S.get(k) ?? null, o[k]));
  function glassKind() {
    const s = S.all();
    if (s.matPanel === 'solid' && s.matWidget === 'solid') return 'solid';
    if (s.tintA > 0) return 'tinted';
    if (s.blur >= 6 || s.glassA >= 10) return 'frosted';
    return 'clear';
  }
  function setGlass(kind) {
    const light = GK.color.lum(S.get('text')) > .4;
    const glass = { matAll: 'glass' };
    if (kind === 'solid') return S.patch({ matAll: 'solid' });
    if (kind === 'clear') return S.patch(Object.assign(glass, { glassA: 0, blur: 0, tintA: 0 }));
    if (kind === 'frosted') return S.patch(Object.assign(glass, { glassA: 16, blur: 18, tintA: 0 }));
    const t = String(S.get('tint')).toLowerCase();
    return S.patch(Object.assign(glass, { tintA: 34, glassA: 0, blur: Math.max(6, Math.min(12, S.get('blur'))), tint: t !== '#ffffff' ? t : (light ? '#1a2a3a' : '#f4f8fc') }));
  }
  function setTextTone(light) {
    const p = { text: light ? '#eef6ff' : '#10202e' };
    if (light && GK.color.lum(S.get('solidPanel')) > .4) Object.assign(p, { solidPanel: '#15263a', bg: '#0b1622' });
    if (!light && GK.color.lum(S.get('solidPanel')) < .4) Object.assign(p, { solidPanel: '#eef4fa', bg: '#dfe9f2' });
    S.patch(p);
  }
  function backdropCss() {
    const s = S.all(), m = s.backdrop === 'custom' && s.bgMedia;
    if (m && !m.video) return `center/cover url("${m.url}")`;
    return (S.BACKDROPS[s.backdrop] || S.BACKDROPS.deepOcean).css || s.bg;
  }
  const tile = ({ id, on, label, sub, vis, onClick, title }) => h('button.gk-st-tile', { type: 'button', 'aria-pressed': String(!!on), title: title || null, dataset: { tile: id }, onclick: onClick }, [
    vis && h('div.gk-st-vis', vis.props || {}, vis.kids || []), h('b', { text: label }), sub && h('small', { text: sub }),
  ]);
  function quickStart() {
    const s = S.all(), bd = backdropCss(), lightText = GK.color.lum(s.text) > .4;
    const looks = Object.keys(S.LOOKS);
    const lookTiles = h('div.gk-st-tiles.looks', looks.slice(0, 8).map(n => lookCard(n, true)));
    const gk = glassKind();
    const pane = (style, txt) => ({ props: { style: { background: bd } }, kids: [h('div.gk-st-pane', { style }, txt || '')] });
    const tintFill = String(s.tint).toLowerCase() !== '#ffffff' ? s.tint : (lightText ? '#1a2a3a' : '#f4f8fc');
    const dens = Object.keys(DENSITY).find(k => matches(DENSITY[k])) || 'custom';
    const ol = Object.keys(OUTLINE).find(k => matches(OUTLINE[k])) || (s.olStyle === 'off' ? 'off' : 'custom');
    const densVis = gap => ({ kids: [h('div.gk-st-dens', { style: { gap: gap + 'px' } }, [0, 1, 2].map(() => h('i')))] });
    const olVis = shadow => ({ props: { style: { background: bd } }, kids: [h('span.gk-st-aa', { style: { textShadow: shadow, color: s.text } }, 'Aa')] });
    const ring = (r, c) => [0, 45, 90, 135, 180, 225, 270, 315].map(a => `${(Math.cos(a * Math.PI / 180) * r).toFixed(2)}px ${(Math.sin(a * Math.PI / 180) * r).toFixed(2)}px 0 ${c}`).join(',');
    const olc = lightText ? 'rgba(0,0,0,' : 'rgba(255,255,255,';
    const acc = h('div.gk-st-accents', { role: 'group', 'aria-label': 'Accent colour' }, ACCENTS.map(c => h('button.gk-st-dot', { type: 'button', title: c, 'aria-label': 'Accent ' + c, 'aria-pressed': String(same(s.accent, c)), style: { background: c }, onclick: () => S.set('accent', c) })));
    const own = h('label.gk-st-dot.own', { title: 'Your own colour', style: { background: ACCENTS.some(c => same(c, s.accent)) ? '' : s.accent } }, [h('span', '+'), h('input', { type: 'color', value: s.accent, 'aria-label': 'Accent: your own colour', oninput: e => S.set('accent', e.target.value) })]);
    acc.appendChild(own);
    const sec = (title, hint, body, more) => h('section.gk-st-group', [h('div.gk-st-gh', [h('h4', { text: title }), hint && h('p', { text: hint }), more]), body]);
    const jump = (cat, label) => h('button.gk-st-link', { type: 'button', onclick: () => api.open(cat) }, label + ' →');
    const motionRow = settingRow(byKey('motion')); rows.push(motionRow);
    // the settings you see most, as live sliders right here (drag and watch the page change)
    const live = keys => h('div.gk-st-live', keys.map(k => byKey(k)).filter(Boolean).map(it => { const r = settingRow(it); rows.push(r); return r.el; }));
    return [
      sec('Look', 'A complete starting point — then change anything.', lookTiles, jump('looks', 'All looks')),
      sec('Glass', 'How see-through the surfaces are.', h('div.gk-st-tiles', [
        tile({ id: 'clear', on: gk === 'clear', label: 'Clear', sub: 'Perfectly clear', vis: pane({ background: 'transparent' }), onClick: () => setGlass('clear') }),
        tile({ id: 'frosted', on: gk === 'frosted', label: 'Frosted', sub: 'Soft and blurred', vis: pane({ background: 'rgba(255,255,255,.16)', backdropFilter: 'blur(6px)' }), onClick: () => setGlass('frosted') }),
        tile({ id: 'tinted', on: gk === 'tinted', label: 'Tinted', sub: 'Coloured glass', vis: pane({ background: GK.color.rgba(tintFill, .55), backdropFilter: 'blur(3px)' }), onClick: () => setGlass('tinted') }),
        tile({ id: 'solid', on: gk === 'solid', label: 'Solid', sub: 'No see-through', vis: pane({ background: s.solidPanel }), onClick: () => setGlass('solid') }),
      ]), jump('glass', 'Fine-tune glass')),
      sec('Glass feel', 'Drag and watch the glass change everywhere.', live(['bulge', 'thickness', 'iris', 'shine'])),
      sec('Text colour', 'Light text suits dark wallpapers, dark text bright ones.', h('div.gk-st-tiles', [
        tile({ id: 'light', on: lightText, label: 'Light text', vis: { props: { style: { background: '#16222f' } }, kids: [h('span.gk-st-aa', { style: { color: '#eef6ff', textShadow: 'none' } }, 'Aa')] }, onClick: () => setTextTone(true) }),
        tile({ id: 'dark', on: !lightText, label: 'Dark text', vis: { props: { style: { background: '#e9f1f8' } }, kids: [h('span.gk-st-aa', { style: { color: '#10202e', textShadow: 'none' } }, 'Aa')] }, onClick: () => setTextTone(false) }),
      ]), jump('colors', 'Every colour')),
      sec('Accent colour', 'Main buttons, selections, sliders and switches.', acc),
      sec('Text size', null, h('div.gk-st-tiles.sizes', SIZES.map(([px, l]) => tile({ id: 'fs' + px, on: s.textSize === px, label: l, sub: px + 'px', vis: { kids: [h('span.gk-st-aa', { style: { fontSize: px * 1.6 + 'px', textShadow: 'none' } }, 'Aa')] }, onClick: () => S.set('textSize', px) }))), jump('text', 'Fonts & outline')),
      sec('Density', 'The space between and inside everything.', h('div.gk-st-tiles', [
        tile({ id: 'compact', on: dens === 'compact', label: 'Compact', sub: 'More on screen', vis: densVis(2), onClick: () => S.patch(DENSITY.compact) }),
        tile({ id: 'cozy', on: dens === 'cozy', label: 'Cozy', sub: 'The default', vis: densVis(5), onClick: () => S.patch(DENSITY.cozy) }),
        tile({ id: 'roomy', on: dens === 'roomy', label: 'Roomy', sub: 'Airy and calm', vis: densVis(9), onClick: () => S.patch(DENSITY.roomy) }),
      ]), jump('spacing', dens === 'custom' ? 'Your own spacing' : 'Exact spacing')),
      sec('Outline', 'Contours around text and buttons — easier to read on busy wallpapers.', h('div.gk-st-tiles', [
        tile({ id: 'ol-off', on: ol === 'off', label: 'Off', vis: olVis('none'), onClick: () => S.patch(OUTLINE.off) }),
        tile({ id: 'ol-subtle', on: ol === 'subtle', label: 'Subtle', vis: olVis(`0 0 1.5px ${olc}.75), 0 0 3px ${olc}.45)`), onClick: () => S.patch(OUTLINE.subtle) }),
        tile({ id: 'ol-strong', on: ol === 'strong', label: 'Strong', vis: olVis(ring(1.6, olc + '1)')), onClick: () => S.patch(OUTLINE.strong) }),
      ]), jump('text', ol === 'custom' ? 'Your own outline' : 'Outline details')),
      ol !== 'off' && h('div.gk-st-live', [(() => { const r = settingRow(byKey('olWidth')); rows.push(r); return r.el; })()]),
      sec('Motion', null, motionRow.el),
    ];
  }

  /* ================= Theme & looks ================= */
  /** The current settings are this look: every key any look sets equals this look's value (or the default). */
  function isLook(name) {
    const keys = new Set(Object.values(S.LOOKS).flatMap(l => Object.keys(S.migrateTint(Object.assign({}, l)))));
    const want = Object.assign({}, S.DEFAULTS, S.migrateTint(Object.assign({}, S.LOOKS[name])));
    keys.delete('keepWallpaper');
    if (want.keepWallpaper) { keys.delete('backdrop'); keys.delete('bgFit'); }   // it keeps whatever wallpaper you have
    return [...keys].every(k => same(S.get(k) ?? null, want[k] ?? null));
  }
  function lookCard(name, small) {
    const l = Object.assign({}, S.DEFAULTS, S.LOOKS[name]);
    const bd = l.keepWallpaper ? { css: backdropCss(), label: 'your wallpaper' } : S.BACKDROPS[l.backdrop] || S.BACKDROPS.deepOcean;
    const solid = l.matPanel === 'solid';
    const panelBg = solid ? l.solidPanel : GK.color.rgba(l.tintA > 0 || String(l.tint).toLowerCase() !== '#ffffff' ? l.tint : '#ffffff', solid ? 1 : Math.max(.14, ((l.tintA || l.glassA || 0) / 100) * .9));
    const ink = solid ? GK.color.contrastInk(l.solidPanel) : l.text;
    const on = S.get('lookName') === name || isLook(name);
    return h('button.gk-st-look', { type: 'button', 'aria-pressed': String(on), title: 'Use the ' + name + ' look', onclick: () => { S.applyLook(name); ui.toast('Look: ' + name); } }, [
      h('div.gk-st-look-sw', { style: { background: bd.css || l.bg, filter: l.glow > 0 || l.haze > 0 ? 'brightness(1.08) saturate(1.12) contrast(.94)' : '' } }, [
        h('div.gk-st-look-panel', { style: { background: panelBg, color: ink, borderRadius: Math.min(10, l.radius * .5) + 'px', backdropFilter: l.blur ? 'blur(4px)' : '',
          boxShadow: l.glow > 0 ? '0 0 16px 2px ' + GK.color.rgba(l.lightColor || '#ffffff', .45) : '' } }, [
          h('span', 'Aa'), h('i', { style: { background: l.accent } }),
        ]),
      ]),
      h('b', { text: name }), !small && h('small', { text: (solid ? 'Solid' : l.blur >= 6 || l.glassA >= 10 ? 'Frosted glass' : 'Clear glass') + ' · ' + bd.label }),
    ]);
  }
  function looksPage() {
    return [
      h('section.gk-st-group', [groupHead({ title: 'Looks', hint: 'A complete look: background, glass, colours and shape. Graphics settings stay as they are.' }),
        h('div.gk-st-tiles.looks.big', Object.keys(S.LOOKS).map(n => lookCard(n)))]),
      h('section.gk-st-group', [groupHead({ title: 'Your saved looks', hint: 'Save what you have now, and switch back any time.' }), savedLooks()]),
      h('section.gk-st-group', [groupHead({ title: 'Look files' }), lookFiles()]),
    ];
  }
  function savedLooks() {
    const box = h('div.gk-stack', { style: { gap: '10px' } });
    const draw = () => {
      GK.clear(box);
      const names = S.profiles();
      const list = h('div.gk-row');
      if (!names.length) list.appendChild(h('span.gk-small.gk-faint', { text: 'No saved looks yet.' }));
      for (const n of names) list.appendChild(h('span.gk-row.nowrap', { style: { gap: '2px' } }, [
        ui.chip({ label: n, title: 'Use this look', onClick: () => { S.loadProfile(n); ui.toast('Loaded ' + n); } }),
        ui.button({ label: '✕', kind: 'ghost', small: true, title: 'Delete ' + n, onClick: async () => { if (await ui.confirm('Delete “' + n + '”?', 'The saved look is removed. Your current look stays.', 'Delete', true)) S.deleteProfile(n); } }),
      ]));
      box.append(list, h('div.gk-row', [ui.button({ label: 'Save this look…', icon: '＋', small: true, onClick: async () => { const n = await ui.prompt('Save this look as', '', 'e.g. Night reading'); if (n) { S.saveProfile(n); ui.toast('Saved ' + n); } } })]));
    };
    draw();
    const off = GK.bus.on('profiles', () => { if (!box.isConnected) return off(); draw(); });
    return box;
  }
  function lookFiles() {
    return h('div.gk-row', [
      ui.button({ label: 'Export…', icon: '⇪', small: true, title: 'Save the current look as a file', onClick: async () => { const p = await S.exportLook(); if (p) ui.toast('Exported'); } }),
      ui.button({ label: 'Import…', icon: '⇩', small: true, title: 'Load a look file', onClick: async () => { if (await S.importLook()) ui.toast('Look imported'); } }),
      ui.button({ label: 'Reset everything', small: true, kind: 'ghost danger', onClick: async () => { if (await ui.confirm('Reset the appearance?', 'Every appearance setting goes back to its default. Saved looks are kept.', 'Reset')) S.reset(); } }),
    ]);
  }

  /* ================= Spacing diagram: real tokens, so it moves with the sliders ================= */
  function spacingDiagram() {
    const tag = (t, cls) => h('span.gk-st-dg-tag', { class: cls || '' }, t);
    return h('div.gk-st-diagram', { 'aria-hidden': 'true' }, [
      h('div.gk-st-dg-panel', [tag('padding inside', 'pad'),
        h('div.gk-st-dg-row', [h('i'), h('span', 'Row')]), h('div.gk-st-dg-row', [h('i'), h('span', 'Row')]), tag('between rows', 'rg'),
        h('div.gk-st-dg-ctls', [h('span.gk-st-dg-btn', 'Button'), h('span.gk-st-dg-btn', 'Height')])]),
      h('div.gk-st-dg-gap', [tag('between panels', 'gap')]),
      h('div.gk-st-dg-panel', [h('div.gk-st-dg-row', [h('i'), h('span', 'Row')]), h('div.gk-st-dg-row', [h('i'), h('span', 'Row')])]),
    ]);
  }

  /* ================= live preview ================= */
  function preview() {
    const pill = (cls, t) => h('span.gk-st-pill', { class: cls }, t);
    return ui.panel({ title: 'Preview', icon: '◐', cls: 'gk-st-preview', body: [
      h('p.gk-st-pv-text', ['Text, ', h('span.gk-muted', 'secondary'), ', ', h('span.gk-faint', 'faint'), ' and ', h('a', { href: '#', onclick: e => e.preventDefault() }, 'a link'), '.']),
      h('div.gk-list.gk-st-pv-list', [
        ui.widget({ cls: 'gk-item', body: [h('div.gk-item-ico', '◆'), h('div.gk-item-main', [h('div.gk-item-title', 'A card'), h('div.gk-item-sub', 'Widget surface')])] }),
        h('div.gk-st-pv-row.sel', [h('span', 'Selected row'), h('span.gk-st-sel', 'selected text')]),
        h('div.gk-st-pv-row.hov', 'Hover wash'),
      ]),
      h('div.gk-row', [ui.button({ label: 'Save', kind: 'primary', small: true }), ui.button({ label: 'Cancel', small: true }), ui.chip({ label: 'On', on: true }), ui.toggle({ value: true })]),
      h('div.gk-row.nowrap', [ui.input({ placeholder: 'Type here…' }), h('span.gk-st-focus', 'Focus')]),
      h('div.gk-row', [pill('good', 'Done'), pill('warn', 'Soon'), pill('bad', 'Late'), h('span.gk-st-now', [h('i'), 'Now'])]),
    ] });
  }

  /* ================= search ================= */
  const words = q => q.trim().toLowerCase().split(/\s+/).filter(Boolean);
  function expand(w) {
    const alts = new Set([w]);
    for (const g of SYN) if (g.includes(w) || (w.length >= 4 && g.some(t => t.startsWith(w)))) g.forEach(t => alts.add(t));
    return [...alts];
  }
  function search(q) {
    const ws = words(q).map(expand);
    if (!ws.length) return null;
    const hit = text => { text = text.toLowerCase(); return ws.every(alts => alts.some(a => text.includes(a))); };
    const res = [];
    for (const p of placements()) {
      if (!p.primary) continue;
      const it = p.it;
      const text = [it.label, it.hint || '', it.key, p.cat.label, p.group.title, TAGS[it.key] || ''].join(' ');
      if (!hit(text)) continue;
      const lbl = it.label.toLowerCase();
      const own = (it.label + ' ' + (TAGS[it.key] || '')).toLowerCase();
      res.push({ p, score: (words(q).every(w => own.includes(w)) ? 3 : 0) + (ws.every(alts => alts.some(a => lbl.includes(a))) ? 2 : 0) + (lbl === words(q).join(' ') ? 5 : 0) + (words(q).includes(lbl) ? 4 : 0) });
    }
    // custom blocks (looks gallery, pop-ups, saved looks …)
    const blocks = [];
    for (const c of LAYOUT) {
      const texts = [];
      if (c.render) texts.push([c.label + ' ' + c.desc + (c.id === 'looks' ? ' look looks theme preset gallery saved export import' : ' quick start density outline glass accent text size'), c.label]);
      for (const g of c.groups || []) if (g.render) texts.push([c.label + ' ' + g.title + ' ' + (g.hint || '') + ' ' + (g.search || ''), g.title]);
      for (const [t, title] of texts) if (hit(t)) blocks.push({ c, title });
    }
    res.sort((a, b) => b.score - a.score || LAYOUT.indexOf(a.p.cat) - LAYOUT.indexOf(b.p.cat));
    return { res, blocks };
  }

  /* ================= mount ================= */
  let live = null;   // the mounted studio (one at a time)
  const api = GK.studio = {
    controls,
    layout: LAYOUT,
    /** Add a category: { id, icon, label, desc, groups?, render?, actions? }, inserted at `index` (default: before the
        last one). It shows in the rail once it has settings or a rendered group. Returns the category. */
    addCategory(cat, index) {
      const have = catOf(cat.id); if (have) return have;
      const c = Object.assign({ icon: '•', desc: '', groups: [] }, cat);
      LAYOUT.splice(index == null ? Math.max(0, LAYOUT.length - 1) : index, 0, c);
      return c;
    },
    /** Ids of the categories the rail shows right now. */
    categories: () => visibleCats().map(c => c.id),
    /** Add a group to a category: { title, hint, keys, more, render, search }. */
    addGroup(cat, group, index) { const c = catOf(cat); if (!c) return; c.groups = c.groups || []; if (c.groups.some(g => g.title === group.title)) return; index == null ? c.groups.push(group) : c.groups.splice(index, 0, group); },
    open(cat, key) { if (live) live.open(cat, key); },
    search,
    /** Mount the full studio into host; returns a cleanup function. */
    mount(host, opts = {}) {
      const shown = visibleCats().map(c => c.id);
      let current = shown.includes(opts.section) ? opts.section : shown.includes(SECTION_CAT[opts.section]) ? SECTION_CAT[opts.section] : 'quick';
      let query = '';
      const searchIn = ui.input({ placeholder: 'Search every setting…' });
      Object.assign(searchIn, { type: 'search', spellcheck: false });
      searchIn.setAttribute('aria-label', 'Search appearance settings');
      searchIn.classList.add('gk-st-search');
      const nav = h('nav.gk-st-cats', { 'aria-label': 'Settings categories' });
      const main = h('div.gk-st-main');
      const rail = ui.panel({ cls: 'gk-st-rail', body: [searchIn, nav] });
      const grid = h('div.gk-st-grid', [rail, main, preview()]);
      host.appendChild(h('div.gk-studio', [grid]));

      const scroller = () => host.closest('.gk-view') || document.scrollingElement;
      const renderNav = counts => {
        GK.clear(nav);
        for (const c of visibleCats()) {
          const n = counts ? counts[c.id] || 0 : null;
          nav.appendChild(h('button.gk-st-cat', { type: 'button', class: [c.id === current && !query ? 'on' : '', counts && !n ? 'dim' : ''].join(' '), 'aria-current': c.id === current && !query ? 'page' : null, dataset: { cat: c.id },
            onclick: () => { query = ''; searchIn.value = ''; current = c.id; render(true); } }, [
            h('span.ic', { text: c.icon }), h('span.nm', { text: c.label }), n ? h('span.n', { text: String(n) }) : null, h('span.ds', { text: c.desc }),
          ]));
        }
      };
      nav.addEventListener('keydown', e => {
        if (!['ArrowDown', 'ArrowUp', 'Home', 'End'].includes(e.key)) return;
        const bs = [...nav.querySelectorAll('.gk-st-cat')], i = bs.indexOf(document.activeElement);
        const j = e.key === 'Home' ? 0 : e.key === 'End' ? bs.length - 1 : Math.max(0, Math.min(bs.length - 1, i + (e.key === 'ArrowDown' ? 1 : -1)));
        e.preventDefault(); bs[j].focus();
      });

      const renderCategory = () => {
        const c = catOf(current);
        const resetSec = c.groups && categoryKeys(c).length > 0 && h('button.gk-st-link', { type: 'button', title: 'Every setting in ' + c.label + ' back to its default', onclick: async () => {
          if (!await ui.confirm('Reset ' + c.label + '?', 'Every setting in this category goes back to its default.', 'Reset')) return;
          const p = {}; categoryKeys(c).forEach(it => { if (it.autoKey) p[it.autoKey] = true; else { const t = it.mapsTo ? byKey(it.mapsTo) || it : it; p[t.key] = t.def; } }); S.patch(p);
        } }, '↺ Reset section');
        const body = categoryBody(c);
        return ui.panel({ cls: 'gk-st-page', title: c.label, icon: c.icon, sub: c.desc, actions: [undoBtn()].concat(c.actions ? c.actions() : [], resetSec || []), body });
      };
      const renderResults = () => {
        rows = [];
        const r = search(query);
        const counts = {};
        if (r) { r.res.forEach(x => { counts[x.p.cat.id] = (counts[x.p.cat.id] || 0) + 1; }); r.blocks.forEach(b => { counts[b.c.id] = (counts[b.c.id] || 0) + 1; }); }
        renderNav(counts);
        const total = r ? r.res.length + r.blocks.length : 0;
        const body = [];
        if (!total) body.push(h('p.gk-st-none', [h('b', 'Nothing matches “' + query.trim() + '”.'), h('br'), 'Try a simpler word — colour, glass, spacing, outline, size.']));
        else {
          for (const b of r.blocks) body.push(h('button.gk-st-block', { type: 'button', onclick: () => open(b.c.id, null, b.title) }, [h('span.ic', b.c.icon), h('span', [h('b', b.title), h('small', ' in ' + b.c.label)]), h('span.go', 'Open →')]));
          for (const x of r.res.slice(0, 40)) {
            const row = settingRow(x.p.it, { always: true, where: x.p.cat, group: x.p.group.extra ? null : x.p.group.title, onJump: () => open(x.p.cat.id, x.p.it.key) });
            rows.push(row); body.push(row.el);
          }
        }
        return ui.panel({ cls: 'gk-st-page gk-st-results', title: total ? total + (total === 1 ? ' match' : ' matches') : 'No matches', icon: '⌕', sub: total ? 'Change them right here, or ↗ to see each one in its place.' : null, body: h('div.gk-st-rows', body) });
      };
      const render = (top) => {
        const y = scroller().scrollTop, focusKey = document.activeElement && document.activeElement.closest && document.activeElement.closest('[data-tile]');
        const fk = focusKey && focusKey.dataset.tile;
        GK.clear(main);
        main.appendChild(query.trim() ? renderResults() : (renderNav(), renderCategory()));
        if (top) { const t = grid.getBoundingClientRect().top - scroller().getBoundingClientRect().top; if (t < 0) scroller().scrollTop += GK.local(scroller(), t) - 4; }
        else scroller().scrollTop = y;
        if (fk) { const el = main.querySelector(`[data-tile="${fk}"]`); if (el) el.focus({ preventScroll: true }); }
      };
      function open(cat, key, groupTitle) {
        query = ''; searchIn.value = ''; current = visibleCats().some(c => c.id === cat) ? cat : 'quick'; render(true);
        let el = key && main.querySelector(`.gk-st-row[data-key="${key}"]`);
        if (!el && groupTitle) el = main.querySelector(`.gk-st-group[data-group="${CSS.escape(groupTitle)}"]`);
        if (!el) return;
        const det = el.closest('.gk-st-more'); if (det) det._open(true);
        el.hidden = false;
        el.scrollIntoView({ block: 'center', behavior: 'smooth' });
        el.classList.remove('flash'); void el.offsetWidth; el.classList.add('flash');
        const f = el.querySelector('input, button:not(.gk-st-reset), select'); if (f) setTimeout(() => f.focus({ preventScroll: true }), 350);
      }
      live = { open };

      searchIn.addEventListener('input', () => { query = searchIn.value; render(true); });
      searchIn.addEventListener('keydown', e => {
        if (e.key === 'Escape' && searchIn.value) { e.stopPropagation(); searchIn.value = ''; query = ''; render(); }
        if (e.key === 'Enter') { const w = main.querySelector('.gk-st-where, .gk-st-block'); if (w) w.click(); }
      });

      // follow changes: rows update in place (no re-render while a slider is dragged); tiles and galleries redraw
      let raf = 0;
      undoReady();
      const keyUndo = e => { if ((e.ctrlKey || e.metaKey) && !e.shiftKey && (e.key === 'z' || e.key === 'Z') && !(e.target && /INPUT|TEXTAREA/.test(e.target.tagName) && e.target.type !== 'range' && e.target.type !== 'color')) { e.preventDefault(); undo(); } };
      document.addEventListener('keydown', keyUndo);
      const off1 = GK.bus.on('settings', p => {
        rows.forEach(r => r.update());
        main.querySelectorAll('.gk-st-undo').forEach(b => { b.disabled = !UNDO.length && !undoT; });
        const c = catOf(current);
        const dragging = document.activeElement && document.activeElement.matches && document.activeElement.matches('.gk-st-main input[type=range], .gk-st-main input[type=color]');
        if (!query && c.render && !dragging) {
          cancelAnimationFrame(raf); raf = requestAnimationFrame(() => { if (!query && current === c.id) render(); });
        }
      });
      const off2 = GK.bus.on('fonts', () => { rows.filter(r => r.it.type === 'font').forEach(r => r.update(true)); });
      const off3 = GK.bus.on('applied', () => { rows.forEach(r => { if (r.it.type === 'color') r.update(); }); });
      render();
      return () => { off1(); off2(); off3(); document.removeEventListener('keydown', keyUndo); cancelAnimationFrame(raf); live = null; rows = []; };
    },
  };

  function colorsResetBtn() {
    return GK.studio.controls.colorsReset ? GK.studio.controls.colorsReset() : ui.button({ label: 'Reset colours', icon: '↺', small: true, onClick: () => {
      const p = {}; S.schema.filter(it => it.type === 'color').forEach(it => { p[valKey(it)] = (byKey(valKey(it)) || it).def; if (it.autoKey) p[it.autoKey] = true; }); S.patch(p);
    } });
  }

  if (GK.smoke) {
    GK.smoke.check('studio: every setting has a place and every placed key exists', () => {
      const missing = [];
      for (const c of LAYOUT) for (const g of c.groups || []) for (const k of (g.keys || []).concat(g.more || []).map(norm)) if (!byKey(k.key)) missing.push(k.key);
      if (missing.length) throw new Error('unknown keys in the layout: ' + missing.join(', '));
      const placed = new Set(placements().map(p => p.it.key));
      const lost = S.schema.filter(it => !placed.has(it.key) && !INTERNAL.has(it.key)).map(it => it.key);
      if (lost.length) throw new Error('not reachable: ' + lost.join(', '));
      return true;
    });
    GK.smoke.check('studio: a category without settings stays out of the rail', () => {
      const c = api.addCategory({ id: '_smoke_empty', label: 'Empty', groups: [{ title: 'Nothing', keys: [] }] });
      try { return !api.categories().includes('_smoke_empty') && api.categories().includes('quick'); }
      finally { LAYOUT.splice(LAYOUT.indexOf(c), 1); }
    });
    GK.smoke.check('studio: search finds highlights, distances and text colours', () => {
      const keys = q => (search(q) || { res: [] }).res.map(x => x.p.it.key);
      const a = keys('highlight'), b = keys('distance'), c = keys('text colour');
      if (!a.includes('colHl') || !a.includes('colSel')) throw new Error('highlight → ' + a.join(','));
      if (!b.includes('gap') || !b.includes('rowGap')) throw new Error('distance → ' + b.join(','));
      if (c[0] !== 'text') throw new Error('text colour → ' + c.join(','));
      return true;
    });
    GK.smoke.check('studio: search finds glow, haze, bulge and wallpaper light', () => {
      const keys = q => (search(q) || { res: [] }).res.map(x => x.p.it.key);
      const want = { glow: 'glow', bloom: 'glow', halation: 'halation', haze: 'haze', magnify: 'bulge', bulge: 'bulge', warp: 'bubbleLens', 'wallpaper light': 'envLight' };
      const miss = Object.entries(want).filter(([q, k]) => byKey(k) && !keys(q).includes(k)).map(([q, k]) => q + ' → ' + k);   // keys of absent add-ons are skipped
      if (miss.length) throw new Error('not found: ' + miss.join(', '));
      return true;
    });
  }
})(window);
