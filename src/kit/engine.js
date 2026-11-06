/* Glass Kit settings engine: schema → defaults, validation, persistence, profiles, and apply(). */
(function (root) {
  'use strict';
  const GK = root.GK;

  const BACKDROPS = {
    deepOcean: { label: 'Deep ocean', css: 'radial-gradient(1200px 700px at 15% 10%, #1b5f8f 0%, transparent 60%), radial-gradient(900px 600px at 90% 90%, #2b8f7f 0%, transparent 55%), linear-gradient(160deg, #061424, #0a2236)' },
    aquaSky: { label: 'Aqua sky', css: 'linear-gradient(160deg, #0a6fb0, #38b6e8 55%, #9fe7ff)' },
    meadow: { label: 'Meadow', css: 'radial-gradient(900px 600px at 80% 0%, #fff6c255, transparent 60%), linear-gradient(160deg, #1f7a4d, #6cc581 55%, #dff5c4)' },
    sunset: { label: 'Sunset glass', css: 'radial-gradient(800px 500px at 85% 15%, #ffd18a66, transparent 60%), linear-gradient(160deg, #2b1650, #b2457a 52%, #ffab66)' },
    aurora: { label: 'Aurora', css: 'radial-gradient(900px 600px at 20% 20%, #2dd4bf55, transparent 60%), radial-gradient(800px 600px at 80% 30%, #a855f755, transparent 60%), linear-gradient(180deg, #071225, #0b1f2e)' },
    midnight: { label: 'Midnight', css: 'radial-gradient(900px 600px at 50% -10%, #23365f, transparent 65%), linear-gradient(180deg, #0a0e19, #111a2b)' },
    paper: { label: 'Paper', css: 'radial-gradient(900px 600px at 10% 0%, #ffffff, transparent 60%), linear-gradient(180deg, #f5efe3, #e9e0cf)' },
    plain: { label: 'Plain colour', css: null },
  };

  const FONT_STACKS = [
    ['"Segoe UI", "Trebuchet MS", Verdana, sans-serif', 'Segoe UI'],
    ['"Segoe UI Variable Display", "Segoe UI", sans-serif', 'Segoe UI Variable'],
    ['"Trebuchet MS", "Segoe UI", sans-serif', 'Trebuchet MS'],
    ['Georgia, "Times New Roman", serif', 'Georgia'],
    ['Verdana, Geneva, sans-serif', 'Verdana'],
    ['Bahnschrift, "Segoe UI", sans-serif', 'Bahnschrift'],
    ['Consolas, "Cascadia Mono", "Courier New", monospace', 'Consolas'],
    ['"Cascadia Code", Consolas, monospace', 'Cascadia Code'],
  ];

  /* The schema. Studio builds its controls from this list; modules add their own with GK.settings.extend(). */
  const SECTIONS = [
    ['material', 'Surfaces', '◐'], ['background', 'Background', '▧'], ['colors', 'Colours', '●'], ['text', 'Text', 'Aa'],
    ['glass', 'Glass & light', '◇'], ['shape', 'Shape & motion', '▢'],
  ];
  const MAT = [['glass', 'Transparent glass'], ['solid', 'Solid colour']];
  // `needs`: the setting only acts while another is on; Studio keeps it in view, dimmed, with the note
  const GLOW_ON = { test: s => s.glow > 0, note: 'Turn Glow up to see this.' };
  const SCHEMA = [
    // surfaces
    { key: 'matAll', section: 'material', label: 'All surfaces', type: 'choice', options: MAT, def: 'glass', hint: 'Glass lets the background show through; solid is an opaque colour. Pick per kind of surface below.' },
    { key: 'matPanel', section: 'material', label: 'Panels', type: 'choice', options: MAT, def: 'glass' },
    { key: 'matWidget', section: 'material', label: 'Cards & widgets', type: 'choice', options: MAT, def: 'glass' },
    { key: 'matControl', section: 'material', label: 'Buttons & inputs', type: 'choice', options: MAT, def: 'glass' },
    { key: 'solidLink', section: 'material', label: 'One colour for all solid surfaces', type: 'toggle', def: true, hint: 'Cards and buttons get lighter shades of the panel colour. Off: pick each one.' },
    { key: 'solidPanel', section: 'material', label: 'Solid surface colour', hint: 'Used where a surface is solid instead of glass.', type: 'color', def: '#15263a', when: s => s.solidLink },
    { key: 'solidPanelOwn', section: 'material', label: 'Solid panels', type: 'color', def: '#15263a', when: s => !s.solidLink, mapsTo: 'solidPanel' },
    { key: 'solidWidget', section: 'material', label: 'Solid cards & widgets', type: 'color', def: '#1c3149', when: s => !s.solidLink },
    { key: 'solidControl', section: 'material', label: 'Solid buttons & inputs', type: 'color', def: '#24405f', when: s => !s.solidLink },
    { key: 'inkMode', section: 'material', label: 'Text on solid surfaces', type: 'choice', options: [['auto', 'Auto contrast'], ['theme', 'Theme text'], ['custom', 'Custom']], def: 'auto', hint: 'Auto picks dark or light text, whichever reads best on each solid colour.' },
    { key: 'inkColor', section: 'material', label: 'Text on solid surfaces: colour', type: 'color', def: '#ffffff', when: s => s.inkMode === 'custom' },

    // background
    { key: 'backdrop', section: 'background', label: 'Wallpaper', type: 'backdrop', def: 'deepOcean', hint: 'A built-in background, or your own file.' },
    { key: 'bgMedia', section: 'background', label: 'Your image, GIF or video', type: 'media', def: null, hint: 'Copied into the app data folder. GIFs animate; videos loop muted.' },
    { key: 'bgFit', section: 'background', label: 'How your file fits', type: 'choice', options: [['cover', 'Fill'], ['contain', 'Fit'], ['tile', 'Tile']], def: 'cover', when: s => s.backdrop === 'custom' },
    { key: 'bgBlur', section: 'background', label: 'Background blur', hint: 'Softens the whole wallpaper.', type: 'range', min: 0, max: 30, step: 1, unit: 'px', def: 0 },
    { key: 'dimColor', section: 'background', label: 'Shade colour', type: 'color', def: '#000000' },
    { key: 'dimA', section: 'background', label: 'Shade strength', hint: 'Darkens (or tints) the wallpaper so text stands out.', type: 'range', min: 0, max: 90, step: 1, unit: '%', def: 0 },

    // colours
    { key: 'bg', section: 'colors', label: 'Base colour', type: 'color', def: '#0b1622', hint: 'Behind everything; also the plain background.' },
    { key: 'text', section: 'colors', label: 'Text', type: 'color', def: '#eef6ff', hint: 'The main text colour. Secondary and faint text follow it while they are on Auto.' },
    { key: 'accent', section: 'colors', label: 'Accent', type: 'color', def: '#6fd0ff', hint: 'Main buttons, the selected item, sliders and switches.' },
    { key: 'accentInkAuto', section: 'colors', label: 'Text on accent: automatic', type: 'toggle', def: true, when: () => false },   // shown as the Auto state of accentInk
    { key: 'accentInk', section: 'colors', label: 'Text on accent', type: 'color', def: '#04131f', autoKey: 'accentInkAuto', autoToken: '--accent-ink', hint: 'Text on accent-coloured buttons and selected items.' },
    { key: 'tint', section: 'colors', label: 'Glass tint colour', type: 'color', def: '#ffffff', hint: 'Shows only when the tint strength is above 0.' },
    { key: 'tintA', section: 'colors', label: 'Tint strength', type: 'range', min: 0, max: 70, step: 1, unit: '%', def: 0, hint: '0 = perfectly clear glass. Separate from milkiness and frost.', format: v => v ? v + '%' : 'clear' },
    // every other colour token: '' = Auto, derived from the colours above (see tokens.css). `alpha`: washes that sit
    // behind text take #rrggbbaa so they can stay see-through.
    ...[['colMuted', 'Secondary text', 'Labels, hints and other quieter text.'], ['colFaint', 'Faint text', 'Placeholders, dates and the quietest text.'],
      ['colLink', 'Links', 'Clickable links.'],
      ['colLine', 'Lines & dividers', 'Borders, separators and grid lines.', 1], ['colHl', 'Glass highlight', 'The light on glass edges, the sheen and the bubble shine.'],
      ['colHover', 'Hover', 'The wash under the pointer.', 1], ['colFocus', 'Focus ring', 'The ring around what the keyboard is on.'],
      ['colSel', 'Selection', 'Selected text and selected rows.', 1], ['colNow', 'Now line', 'Marks the current time in calendars and timelines.'],
      ['colScroll', 'Scrollbars', 'The scrollbar thumb.', 1], ['colWell', 'Input wells', 'The inside of text boxes and tracks.', 1],
      ['colGood', 'Good / done', 'Success, done and “on track”.'], ['colWarn', 'Warning', 'Due soon, caution.'], ['colBad', 'Danger / overdue', 'Errors, deletes and overdue.'],
      ['colOnFill', 'Text on status colours', 'Text on good, warning and danger fills.']]
      .map(([key, label, hint, alpha]) => ({ key, section: 'colors', label, hint, type: 'color', def: '', auto: true, alpha: !!alpha })),

    // text
    { key: 'fontUI', section: 'text', label: 'Interface font', type: 'font', def: FONT_STACKS[0][0] },
    { key: 'fontHead', section: 'text', label: 'Heading font', type: 'font', def: '', allowSame: true },
    { key: 'fontMono', section: 'text', label: 'Code font', type: 'font', def: FONT_STACKS[6][0] },
    { key: 'textSize', section: 'text', label: 'Text size', hint: 'Interface text everywhere in the app.', type: 'range', min: 11, max: 22, step: .5, unit: 'px', def: 14 },
    { key: 'lineHeight', section: 'text', label: 'Line spacing', type: 'range', min: 1.2, max: 2.2, step: .05, def: 1.5, format: v => v.toFixed(2) },
    { key: 'letterSpacing', section: 'text', label: 'Letter spacing', type: 'range', min: -.03, max: .12, step: .005, def: 0, format: v => v.toFixed(3) + 'em' },
    { key: 'headWeight', section: 'text', label: 'Heading weight', type: 'range', min: 300, max: 900, step: 100, def: 700, format: v => String(v) },
    { key: 'tbgColor', section: 'text', label: 'Text backdrop colour', type: 'color', def: '#000000', when: s => s.tbgA > 0 },
    { key: 'tbgA', section: 'text', label: 'Text backdrop', hint: 'A soft plate behind page text, for busy backgrounds. 0 = off.', format: v => v ? v + '%' : 'off', type: 'range', min: 0, max: 90, step: 1, unit: '%', def: 0 },
    { key: 'olStyle', section: 'text', label: 'Text outline', type: 'choice', options: [['off', 'Off'], ['smooth', 'Smooth'], ['crisp', 'Crisp'], ['glow', 'Glow']], def: 'off', hint: 'A contour around letters so text reads on any background.' },
    { key: 'olWidth', section: 'text', label: 'Outline thickness', type: 'range', min: .25, max: 6, step: .25, def: 1.5, format: v => '×' + v, when: s => s.olStyle !== 'off' },
    { key: 'olColor', section: 'text', label: 'Text outline colour', type: 'color', def: '#000000', when: s => s.olStyle !== 'off', hint: 'If it would not contrast with the text, the opposite tone is used.' },
    { key: 'olA', section: 'text', label: 'Outline opacity', type: 'range', min: .1, max: 1, step: .05, def: 1, format: v => Math.round(v * 100) + '%', when: s => s.olStyle !== 'off' },

    // glass & light
    { key: 'glassA', section: 'glass', label: 'Milkiness', type: 'range', min: 0, max: 70, step: 1, unit: '%', def: 0, hint: 'How much the glass clouds what is behind it. 0 = perfectly clear.' },
    { key: 'blur', section: 'glass', label: 'Frost (blur)', type: 'range', min: 0, max: 40, step: 1, unit: 'px', def: 0, hint: 'Off = clear glass. Raise it for frosted glass.' },
    { key: 'lens', section: 'glass', label: 'Refraction', type: 'toggle', def: true, hint: 'Glass bends what is behind it. Text always stays sharp.' },
    { key: 'glassEngine', section: 'glass', label: 'Renderer', type: 'choice', options: [['auto', 'Prism (GPU optics)'], ['lens', 'Lens (SVG)']], def: 'auto', when: s => s.lens, hint: 'Prism renders real optics on the graphics card; it falls back to Lens by itself where it is unavailable.' },
    { key: 'ior', section: 'glass', label: 'Refractive index', type: 'range', min: 1.05, max: 2.2, step: .01, def: 1.5, format: v => v.toFixed(2), when: s => s.lens && s.glassEngine !== 'lens' && prismOk(), hint: 'Window glass 1.5 · crystal 1.7 · diamond 2.4.' },
    { key: 'thickness', section: 'glass', label: 'Thickness', type: 'range', min: 4, max: 80, step: 1, unit: 'px', def: 28, when: s => s.lens && s.glassEngine !== 'lens' && prismOk() },
    { key: 'bulge', section: 'glass', label: 'Body refraction', type: 'range', min: 0, max: 1, step: .05, def: 0, format: pctOff, when: s => s.lens && s.glassEngine !== 'lens' && prismOk(), hint: 'The whole piece of glass acts as a lens: what is behind it bulges and magnifies through the middle, not only at the edge.' },
    { key: 'lensRim', section: 'glass', label: 'Bevel width', type: 'range', min: .2, max: 2, step: .05, def: 1, format: v => '×' + v.toFixed(2), when: s => s.lens },
    { key: 'rimClear', section: 'glass', label: 'Clear rim', type: 'range', min: 0, max: 1, step: .05, def: .85, format: v => Math.round(v * 100) + '%', when: s => s.lens && s.glassEngine !== 'lens' && prismOk(), hint: 'How much sharper the bending rim is than the frosted middle.' },
    { key: 'dispersion', section: 'glass', label: 'Dispersion', type: 'range', min: 0, max: 1, step: .05, def: .4, format: v => v ? Math.round(v * 100) + '%' : 'off', when: s => s.lens && s.glassEngine !== 'lens' && prismOk(), hint: 'Splits light into colours where the glass bends it, like a prism.' },
    { key: 'iris', section: 'glass', label: 'Iridescence', type: 'range', min: 0, max: 1, step: .05, def: .18, format: v => v ? Math.round(v * 100) + '%' : 'off', when: s => s.lens && s.glassEngine !== 'lens' && prismOk(), hint: 'A thin-film shimmer along the edges.' },
    { key: 'caustics', section: 'glass', label: 'Caustics', type: 'range', min: 0, max: 1, step: .05, def: .45, format: v => v ? Math.round(v * 100) + '%' : 'off', when: s => s.lens && s.glassEngine !== 'lens' && prismOk(), hint: 'Light focused through the glass onto what lies beneath.' },
    { key: 'glassShadow', section: 'glass', label: 'Shadows', type: 'range', min: 0, max: 1, step: .05, def: .55, format: v => Math.round(v * 100) + '%', when: s => s.lens && s.glassEngine !== 'lens' && prismOk() },
    { key: 'glassControls', section: 'glass', label: 'Buttons are glass too', type: 'toggle', def: true, when: s => s.lens && s.glassEngine !== 'lens' && prismOk() },
    { key: 'liquid', section: 'glass', label: 'Liquid motion', type: 'toggle', def: true, when: s => s.lens && s.glassEngine !== 'lens' && prismOk(), hint: 'Moving glass stretches, pressed glass squashes, selections slide like a drop.' },
    { key: 'liquidSelect', section: 'glass', label: 'Liquid selection', type: 'toggle', def: true, when: s => s.lens && s.glassEngine !== 'lens' && prismOk(), hint: 'The selected item in the navigation and in segmented controls is a glass drop that flows to the next one.' },
    { key: 'pointerLight', section: 'glass', label: 'Light follows the pointer', type: 'toggle', def: true, when: s => s.lens && s.glassEngine !== 'lens' && prismOk() },
    { key: 'adaptive', section: 'glass', label: 'Keep text readable', type: 'toggle', def: false, when: s => s.lens && s.glassEngine !== 'lens' && prismOk(), hint: 'Calms bright or busy backgrounds under glass so text keeps its contrast.' },
    { key: 'glassQuality', section: 'glass', label: 'Quality', type: 'choice', options: [['auto', 'Automatic'], ['high', 'High'], ['balanced', 'Balanced'], ['low', 'Low']], def: 'auto', when: s => s.lens && s.glassEngine !== 'lens' && prismOk(), hint: 'Automatic lowers quality by itself if the graphics card falls behind.' },
    { key: 'lensStrength', section: 'glass', label: 'Refraction strength', type: 'range', min: 6, max: 70, step: 1, def: 32, when: s => s.lens && (s.glassEngine === 'lens' || !prismOk()) },
    { key: 'lensFrost', section: 'glass', label: 'Lens frost', type: 'range', min: 0, max: 12, step: .5, unit: 'px', def: 5, when: s => s.lens && (s.glassEngine === 'lens' || !prismOk()) },
    { key: 'chroma', section: 'glass', label: 'Prism fringe', type: 'range', min: 0, max: 1, step: .05, def: 0, format: v => v ? Math.round(v * 100) + '%' : 'off', when: s => s.lens && (s.glassEngine === 'lens' || !prismOk()), hint: 'Splits the rim into a rainbow.' },
    { key: 'lightAngle', section: 'glass', label: 'Light direction', type: 'range', min: 0, max: 360, step: 5, unit: '°', def: 180 },
    { key: 'shine', section: 'glass', label: 'Light intensity', type: 'range', min: 0, max: 1.6, step: .05, def: .7, format: v => Math.round(v * 100) + '%' },
    { key: 'lightReach', section: 'glass', label: 'Light reach', type: 'range', min: 15, max: 100, step: 1, unit: '%', def: 55 },
    { key: 'lightColor', section: 'glass', label: 'Light colour', type: 'color', def: '#ffffff', hint: 'The colour of the light falling on the glass.' },
    { key: 'envLight', section: 'glass', label: 'Wallpaper light', type: 'range', min: 0, max: 1, step: .05, def: 0, format: pctOff, when: s => s.lens && s.glassEngine !== 'lens' && prismOk(), hint: 'Glass edges, shine and caustics take their colour from the wallpaper around them: glass near a golden patch glows golden.' },
    { key: 'glow', section: 'glass', label: 'Glow', type: 'range', min: 0, max: 1, step: .05, def: 0, format: pctOff, hint: 'Bright parts of the wallpaper bleed soft light over their edges and through the glass, like sunlight on an old camera.' },
    { key: 'glowSize', section: 'glass', label: 'Glow size', type: 'range', min: 0, max: 1, step: .05, def: .5, format: v => Math.round(v * 100) + '%', needs: GLOW_ON, hint: 'A tight halo, or a wide soft bloom.' },
    { key: 'glowThreshold', section: 'glass', label: 'What glows', type: 'range', min: 0, max: .95, step: .05, def: .6, format: v => 'brighter than ' + Math.round(v * 100) + '%', needs: GLOW_ON, hint: 'Only parts brighter than this glow. Lower it and more of the picture glows.' },
    { key: 'halation', section: 'glass', label: 'Warm halation', type: 'range', min: 0, max: 1, step: .05, def: 0, format: pctOff, needs: GLOW_ON, hint: 'Warms the outer edge of the glow toward red-orange, as light does on film.' },
    { key: 'haze', section: 'glass', label: 'Haze', type: 'range', min: 0, max: 1, step: .05, def: 0, format: pctOff, hint: 'A soft, milky light over the wallpaper, like an old lens: shadows lift and highlights soften. The glass itself stays clear.' },

    // shape & motion
    { key: 'radius', section: 'shape', label: 'Corner radius', type: 'range', min: 0, max: 30, step: 1, unit: 'px', def: 16, hint: 'How round panels, cards and buttons are. 0 = square.' },
    { key: 'gap', section: 'shape', label: 'Space between panels', type: 'range', min: 4, max: 28, step: 1, unit: 'px', def: 14, hint: 'The distance between panels, cards and page sections.' },
    { key: 'pad', section: 'shape', label: 'Padding inside panels', type: 'range', min: 8, max: 28, step: 1, unit: 'px', def: 16, hint: 'Room between a panel’s edge and what is inside it.' },
    // null = Auto: derived from the space between panels / the text size (see tokens.css)
    { key: 'rowGap', section: 'shape', label: 'Space between rows', type: 'range', min: 0, max: 24, step: 1, unit: 'px', def: null, auto: true, hint: 'The distance between list rows, cards and items.' },
    { key: 'ctlH', section: 'shape', label: 'Control height', type: 'range', min: 24, max: 48, step: 1, unit: 'px', def: null, auto: true, hint: 'How tall buttons, inputs and chips are.' },
    { key: 'ctlPx', section: 'shape', label: 'Control side padding', type: 'range', min: 4, max: 24, step: 1, unit: 'px', def: null, auto: true, hint: 'Room left and right of the text inside buttons and inputs.' },
    { key: 'scale', section: 'shape', label: 'Interface scale', type: 'range', min: .8, max: 1.3, step: .01, def: 1, format: v => Math.round(v * 100) + '%' },
    { key: 'motion', section: 'shape', label: 'Animations', type: 'toggle', def: true, hint: 'Transitions, rising bubbles and liquid movement.' },
    { key: 'followSystem', section: 'shape', label: 'Follow system accessibility settings', type: 'toggle', def: true, hint: 'Reduced transparency or more contrast switches glass to solid; reduced motion stops animations.' },
  ];

  /* Complete looks; a starting point the user then tweaks. `keepWallpaper`: the look keeps your wallpaper. */
  const LOOKS = {
    'Aqua glass': {},
    'Aero sky': { backdrop: 'aquaSky', text: '#06263d', bg: '#bfe6fb', accent: '#0a78c2', tint: '#ffffff', glassA: 6, olStyle: 'off', solidPanel: '#e9f6ff' },
    'Sunset glass': { backdrop: 'sunset', text: '#fff6ee', accent: '#ffb36b', tint: '#ffe7d6', glassA: 0, lightAngle: 150 },
    'Aurora': { backdrop: 'aurora', accent: '#5eead4', tint: '#c4f1ff', glassA: 10, chroma: .15 },
    'Crystal': { backdrop: 'aurora', accent: '#9d8cff', tint: '#ffffff', glassA: 0, blur: 0, thickness: 40, ior: 1.62, dispersion: .75, iris: .4, caustics: .95, shine: 1.05, rimClear: .95 },
    'Clear lilac': { backdrop: 'sunset', text: '#fff7fb', accent: '#a78bfa', tint: '#ffffff', glassA: 0, blur: 0, thickness: 34, dispersion: .5, iris: .25, lightAngle: 150, shine: 1 },
    // sunlit and glowing: wallpaper-coloured light, bloom with a warm halation fringe, a soft haze, bulging glass
    'Golden hour': { keepWallpaper: true, dimA: 0, tint: '#fff1dc', tintA: 3, glassA: 0, blur: 0, lightColor: '#ffe9c6', lightAngle: 150, shine: .9,
      dispersion: .7, iris: .3, caustics: .75, bulge: .55, bubbleLens: .3, envLight: .85, glow: .75, glowSize: .6, glowThreshold: .5, halation: .6, haze: .35 },
    'Frosted': { glassA: 22, blur: 22 },
    'Midnight solid': { backdrop: 'midnight', matAll: 'solid', matPanel: 'solid', matWidget: 'solid', matControl: 'solid', solidPanel: '#151d2e', accent: '#8ea7ff', bubbles: false },
    'Paper': { backdrop: 'paper', bg: '#f1eadb', text: '#2b2418', accent: '#3b6ea5', matAll: 'solid', matPanel: 'solid', matWidget: 'solid', matControl: 'solid', solidPanel: '#fffdf8', bubbles: false, lens: false, radius: 10 },
  };

  const DEFAULTS = {};
  // the kit's own defaults, before an app puts its house look over them (smoke checks test these)
  const KIT_DEFAULTS = Object.fromEntries(SCHEMA.map(it => [it.key, it.def]));
  const S = { schema: SCHEMA.slice(), sections: SECTIONS.slice(), v: {}, profiles: {}, fontFiles: [], systemFonts: [] };

  /* ---- colour helpers ---- */
  function rgb(hex) {
    let h = String(hex || '#000').replace('#', '');
    if (h.length === 3) h = h.split('').map(c => c + c).join('');
    return [0, 2, 4].map(i => parseInt(h.slice(i, i + 2), 16) || 0);
  }
  const lum = hex => { const c = rgb(hex).map(v => { v /= 255; return v <= .03928 ? v / 12.92 : Math.pow((v + .055) / 1.055, 2.4); }); return .2126 * c[0] + .7152 * c[1] + .0722 * c[2]; };
  const contrastInk = hex => (lum(hex) > .4 ? '#10161f' : '#f4f9ff');
  const rgba = (hex, a) => { const c = rgb(hex); return `rgba(${c[0]},${c[1]},${c[2]},${a})`; };
  const shade = (hex, amt) => { const c = rgb(hex), t = amt < 0 ? 0 : 255, p = Math.abs(amt); return '#' + c.map(v => Math.round((t - v) * p + v).toString(16).padStart(2, '0')).join(''); };
  const hex = c => '#' + c.map(v => Math.round(Math.max(0, Math.min(255, v))).toString(16).padStart(2, '0')).join('');
  const contrast = (a, b) => { const x = lum(a), y = lum(b); return (Math.max(x, y) + .05) / (Math.min(x, y) + .05); };
  GK.color = { rgb, lum, contrastInk, rgba, shade, hex, contrast };

  /* Glass tint used to be one knob: the tint colour mixed in at "milkiness". Now tint colour, tint strength
     (0 = clear), milkiness and frost are independent. Old settings keep their exact look: a white tint was
     plain milkiness (strength 0); a coloured tint mixed at glassA becomes that tint at that strength. */
  function migrateTint(o) {
    if (!o || 'tintA' in o || !('tint' in o || 'glassA' in o)) return o;
    const t = String(o.tint || '#ffffff').toLowerCase();
    if (t !== '#ffffff' && +o.glassA > 0) { o.tintA = +o.glassA; o.glassA = 0; } else o.tintA = 0;
    return o;
  }

  /* ---- schema helpers ---- */
  function rebuildDefaults() { for (const it of S.schema) if (!(it.key in DEFAULTS)) DEFAULTS[it.key] = it.def; }
  function valid(it, v) {
    if (v === undefined) return it.def;
    if (it.auto && (v === null || v === '' || v === 'auto')) return it.def;   // "derived" tokens
    switch (it.type) {
      case 'range': { const n = +v; return Number.isFinite(n) ? Math.min(it.max, Math.max(it.min, n)) : it.def; }
      case 'toggle': return !!v;
      case 'color': return (it.alpha ? /^#[0-9a-f]{6}([0-9a-f]{2})?$/i : /^#[0-9a-f]{6}$/i).test(v) ? v : it.def;
      case 'choice': return it.options.some(o => o[0] === v) ? v : it.def;
      default: return v;
    }
  }
  const byKey = k => S.schema.find(it => it.key === k);
  function pctOff(v) { return v ? Math.round(v * 100) + '%' : 'off'; }

  /* ---- persistence ---- */
  let saveT = null;
  function persist() {
    clearTimeout(saveT);
    saveT = setTimeout(() => GK.host('settings:save', { v: 1, active: S.v, profiles: S.profiles, fontFiles: S.fontFiles }), 200);
  }

  const settings = GK.settings = {
    BACKDROPS, FONT_STACKS, LOOKS, DEFAULTS,
    get schema() { return S.schema; },
    get sections() { return S.sections; },
    get fontFiles() { return S.fontFiles; },
    get systemFonts() { return S.systemFonts; },
    all: () => Object.assign({}, S.v),
    get: k => S.v[k],

    async load() {
      rebuildDefaults();
      const saved = (await GK.host('settings:load')) || {};
      migrateTint(saved.active);
      S.profiles = saved.profiles || {};
      for (const k in S.profiles) migrateTint(S.profiles[k]);
      S.fontFiles = saved.fontFiles || [];
      S.v = {};
      for (const it of S.schema) S.v[it.key] = valid(it, (saved.active || {})[it.key]);
      Object.assign(S.v, Object.fromEntries(Object.entries(saved.active || {}).filter(([k]) => !byKey(k))));   // keep unknown module keys
      await registerFonts();
      settings.apply();
      GK.host('fonts:system').then(list => { S.systemFonts = list || []; GK.bus.emit('fonts'); });
    },

    set(k, v) { settings.patch({ [k]: v }); },
    patch(p) {
      for (let [k, v] of Object.entries(p)) {
        const it = byKey(k);
        if (it && it.mapsTo) k = it.mapsTo;
        const target = byKey(k);
        S.v[k] = target ? valid(target, v) : v;
        if (it && it.mapsTo) S.v[it.key] = S.v[k];
        if (k === 'matAll') { S.v.matPanel = S.v.matWidget = S.v.matControl = S.v.matAll; }
        // picking a tint colour is choosing a tint: give it a visible strength if it had none
        if (k === 'tint' && !('tintA' in p) && !(S.v.tintA > 0) && String(S.v.tint).toLowerCase() !== '#ffffff') S.v.tintA = 20;
      }
      settings.apply();
      persist();
      GK.bus.emit('settings', p);
    },

    extend(items, section) {
      if (section && !S.sections.some(s => s[0] === section[0])) S.sections.push(section);
      for (const it of items) if (!byKey(it.key)) { S.schema.push(it); DEFAULTS[it.key] = it.def; if (!(it.key in S.v)) S.v[it.key] = it.def; }
    },

    /* looks & profiles */
    applyLook(name) {
      const look = LOOKS[name]; if (!look) return;
      const l = migrateTint(Object.assign({}, look)), keep = { bgMedia: S.v.bgMedia };
      if (l.keepWallpaper) { keep.backdrop = S.v.backdrop; keep.bgFit = S.v.bgFit; }
      delete l.keepWallpaper;
      S.v = Object.assign({}, DEFAULTS, keep, l); settings.patch({});
    },
    migrateTint,
    profiles: () => Object.keys(S.profiles).sort(),
    saveProfile(name) { const snap = Object.assign({}, S.v); S.profiles[name] = snap; persist(); GK.bus.emit('profiles'); },
    loadProfile(name) { const p = S.profiles[name]; if (!p) return; S.v = Object.assign({}, DEFAULTS, migrateTint(Object.assign({}, p))); settings.patch({}); },
    deleteProfile(name) { delete S.profiles[name]; persist(); GK.bus.emit('profiles'); },
    reset() { S.v = Object.assign({}, DEFAULTS); settings.patch({}); },
    async exportLook() { return GK.host('file:saveJson', 'look.json', { glassKitLook: 1, settings: S.v, fontFiles: S.fontFiles }); },
    async importLook() {
      let j;
      try { j = await GK.host('file:openJson'); }
      catch (e) { if (GK.ui && GK.ui.toast) GK.ui.toast((e && e.message) || 'That file could not be read', '⚠'); return false; }
      if (!j || !j.settings) { if (j && GK.ui && GK.ui.toast) GK.ui.toast('That file is not a Glass Kit look', '⚠'); return false; }
      S.v = Object.assign({}, DEFAULTS, migrateTint(Object.assign({}, j.settings)));
      if (Array.isArray(j.fontFiles)) { S.fontFiles = j.fontFiles; await registerFonts(); }
      settings.patch({});
      return true;
    },

    /* media & fonts */
    async pickBackground() {
      const m = await GK.host('media:import', 'backdrop');
      if (m) settings.patch({ bgMedia: m, backdrop: 'custom' });
      return m;
    },
    async importFont() {
      const f = await GK.host('media:import', 'font');
      if (!f) return null;
      const family = 'GK ' + f.name.replace(/[^\w ]+/g, ' ').trim();
      S.fontFiles = S.fontFiles.filter(x => x.family !== family).concat([{ family, url: f.url }]);
      await registerFonts();
      persist();
      GK.bus.emit('fonts');
      return `"${family}", ${FONT_STACKS[0][0]}`;
    },
    removeFont(family) { S.fontFiles = S.fontFiles.filter(x => x.family !== family); persist(); GK.bus.emit('fonts'); },
    apply,
  };

  async function registerFonts() {
    for (const f of S.fontFiles) {
      if ([...document.fonts].some(x => x.family.replace(/"/g, '') === f.family)) continue;
      try { const ff = new FontFace(f.family, `url("${f.url}")`); await ff.load(); document.fonts.add(ff); } catch (e) { console.warn('font failed', f.family); }
    }
  }

  /* Text outline. Every style is a dense ring of text-shadows (16 directions on the outline radius plus an inner
     ring of 8): round joins and an even contour at any size, no miter spikes from -webkit-text-stroke. The ring is
     written in tokens.css in terms of --olr (radius, em) / --olb (blur) / --olc (colour), so each surface can
     re-colour or switch it off. The reach is capped relative to the font size, so big values never smear glyphs
     or swallow word spaces; --ol-room is how far it reaches outside the glyphs (containers that clip use it). */
  function outline(style, w) {
    if (style === 'off') return { r: 0, b: 0, room: 0 };
    if (style === 'glow') { const r = Math.min(w * .03, .09); return { r: 0, b: r * 1.6, glow: r, room: r * 4.5 }; }
    const r = Math.min(w * .025, .125);                       // em: x1 = .025em, capped at .125em (x4 = 1.4px at 14px, 4px at 40px)
    const b = style === 'smooth' ? r * .45 : 0;               // smooth = soft edge, crisp = hard edge
    return { r, b, room: r + b };
  }

  /* ---- liquid glass: Prism (GPU optics) where available, AeroLens (SVG) otherwise and for overlays ---- */
  let lensSig = '', prismFailed = false;
  const mq = (q) => { try { return matchMedia(q).matches; } catch (e) { return false; } };
  const systemPlain = (s) => s.followSystem && mq('(prefers-reduced-transparency: reduce), (prefers-contrast: more), (forced-colors: active)');
  const systemStill = (s) => !s.motion || (s.followSystem && mq('(prefers-reduced-motion: reduce)'));
  function prismOk() { return !prismFailed && !!(root.Prism && root.Prism.supported()); }
  const unit = (hex) => rgb(hex).map(v => v / 255);
  function prismOpts(s) {
    return {
      targets: [s.matPanel === 'glass' && '.gk-panel', s.matWidget === 'glass' && '.gk-widget'].filter(Boolean),
      controls: s.matControl === 'glass' && s.glassControls ? ['.gk-control'] : [],
      indicators: s.liquidSelect ? [{ container: '.gk-nav', active: '.gk-nav-btn.on' }, { container: '.gk-seg', active: 'button.on' }] : [],
      ior: s.ior, thickness: s.thickness, bezel: s.lensRim, dispersion: s.dispersion, frost: s.blur, rimClear: s.rimClear, milk: s.glassA / 100,
      tint: unit(s.tint), tintA: (s.tintA || 0) / 100, hl: s.colHl ? unit(s.colHl) : null, accent: unit(s.accent), light: unit(s.lightColor), lightAngle: s.lightAngle, shine: s.shine,
      iris: s.iris, caustics: s.caustics, shadow: s.glassShadow, pointerLight: s.pointerLight, liquid: s.liquid, adaptive: s.adaptive,
      textLight: lum(s.text) > .4, quality: s.glassQuality, motion: !systemStill(s), bubbles: '#gk-bubbles .bub',
      bulge: s.bulge || 0, bubbleLens: s.bubbleLens || 0, envLight: s.envLight || 0,
      glow: s.glow || 0, glowSize: s.glowSize, glowThreshold: s.glowThreshold, halation: s.halation || 0, haze: s.haze || 0,
    };
  }
  function lens(s) {
    const A = root.AeroLens, P = root.Prism;
    const targets = [];
    if (s.matPanel === 'glass') targets.push('.gk-panel:not([data-mat]):not(.gk-nolens)');
    if (s.matWidget === 'glass') targets.push('.gk-widget:not([data-mat]):not(.gk-nolens)');
    const on = s.lens && targets.length > 0 && !systemPlain(s);
    const usePrism = on && s.glassEngine !== 'lens' && prismOk();
    if (usePrism) {
      if (!P.active) {
        if (!P.start(prismOpts(s))) { prismFailed = true; return lens(s); }
        if (!lens.hooked) { lens.hooked = true; P.onfail(() => { prismFailed = true; lensSig = ''; lens(S.v); }); }   // lost GPU: carry on with Lens
      }
      else P.set(prismOpts(s));
    } else if (P && P.active) P.stop();
    // AeroLens: everything when Prism is off; with Prism only dialogs, which float over live content.
    const lensTargets = usePrism ? (s.matPanel === 'glass' ? ['.gk-dialog:not([data-mat])'] : []) : targets;
    const lensOn = on && lensTargets.length > 0 && !!A;
    const opts = {
      targets: lensTargets, sphereTargets: s.bubbles && !usePrism ? ['#gk-bubbles .bub'] : [], strength: s.lensStrength, frost: s.lensFrost, bandScale: s.lensRim,
      chroma: s.chroma, minSize: 80, maxFrac: usePrism ? .9 : .42, sphereStrength: 110, sphereMag: .45, sphereMax: 24, saturate: 1.3,
    };
    const sig = lensOn ? lensTargets.join('|') + '|' + opts.sphereTargets.join('') : 'off';
    if (A) { if (sig !== lensSig) { A.destroy(); if (lensOn) A.init(opts); lensSig = sig; } else if (lensOn) A.set(opts); }
    document.documentElement.classList.toggle('lensed', on);
    document.documentElement.dataset.glass = usePrism ? 'prism' : on ? 'lens' : 'off';
  }

  // bubbles are an add-on (src/addons/fx-bubbles): it builds #gk-bubbles; Prism and AeroLens draw whatever is there

  function backdrop(s) {
    const host = document.getElementById('gk-backdrop');
    const st = document.documentElement.style;
    const media = s.backdrop === 'custom' && s.bgMedia;
    let bgEl = host.querySelector('.gk-bg');
    const wantVideo = !!(media && media.video);
    if (wantVideo !== (bgEl.tagName === 'VIDEO')) {
      const next = wantVideo ? GK.h('video.gk-bg', { autoplay: true, loop: true, muted: true, playsInline: true }) : GK.h('div.gk-bg');
      bgEl.replaceWith(next); bgEl = next;
    }
    if (wantVideo) {
      if (bgEl.getAttribute('src') !== media.url) bgEl.src = media.url;
      st.setProperty('--bg-vfit', s.bgFit === 'contain' ? 'contain' : 'cover');
      if (s.motion) bgEl.play().catch(() => {}); else bgEl.pause();
      st.setProperty('--bg-layer', 'none');
    } else if (media) {
      st.setProperty('--bg-layer', `url("${media.url}") center / ${s.bgFit === 'tile' ? 'auto' : s.bgFit} ${s.bgFit === 'tile' ? 'repeat' : 'no-repeat'}, ${s.bg}`);
    } else {
      const p = BACKDROPS[s.backdrop] || BACKDROPS.deepOcean;
      st.setProperty('--bg-layer', p.css || s.bg);
    }
    st.setProperty('--bg-blur', s.bgBlur + 'px');
    st.setProperty('--bg-filter', s.bgBlur > 0 ? 'blur(' + s.bgBlur + 'px)' : 'none');
    st.setProperty('--bg-dim', s.dimA ? rgba(s.dimColor, s.dimA / 100) : 'transparent');
    light(s, host, st);
  }

  /* Glow and haze without Prism (CSS): glow is a blurred, contrast-thresholded copy of the wallpaper screened over
     it; haze a milky veil of the light colour that lifts the shadows. Prism draws both itself (tokens.css hides these
     layers under html.prism). The layers exist only while their setting is above 0. A video wallpaper gets haze
     but no glow (the copy would need a second video). */
  function light(s, host, st) {
    const layer = (cls, on) => {
      let el = host.querySelector('.' + cls);
      if (!on) { if (el) el.remove(); return; }
      if (!el) { el = GK.h('div.' + cls, { 'aria-hidden': 'true' }); host.insertBefore(el, host.querySelector('.gk-dim')); }
    };
    layer('gk-glow', s.glow > 0);
    layer('gk-haze', s.haze > 0);
    if (s.glow > 0) {
      const t = Math.min(.9, s.glowThreshold), c = (1 + t) / (1 - t), b = (.5 + .5 * c) / c;   // maps t to 0 and 1 to 1
      st.setProperty('--glow-a', Math.min(1, s.glow).toFixed(3));
      st.setProperty('--glow-r', (6 + s.glowSize * 54).toFixed(1) + 'px');
      // mostly by brightness (a blue sky stays out), thresholded, warmed by halation; tokens.css blurs and lifts it
      st.setProperty('--glow-f', `grayscale(.6) brightness(${b.toFixed(3)}) contrast(${c.toFixed(3)}) sepia(${(s.halation * .7).toFixed(2)}) saturate(${(1.3 + s.halation * .8).toFixed(2)})`);
    }
    if (s.haze > 0) st.setProperty('--haze', String(s.haze));
  }

  function apply() {
    const s = S.v, r = document.documentElement, st = r.style;
    const set = (k, v) => st.setProperty('--' + k, v);
    const opt = (k, name) => { if (s[k]) set(name, s[k]); else st.removeProperty('--' + name); };   // '' = derived in tokens.css
    // materials
    const plain = systemPlain(s);   // reduced transparency / more contrast / forced colours: solid surfaces
    r.dataset.matPanel = plain ? 'solid' : s.matPanel; r.dataset.matWidget = plain ? 'solid' : s.matWidget; r.dataset.matControl = plain ? 'solid' : s.matControl;
    const sp = s.solidPanel, sw = s.solidLink ? shade(sp, lum(sp) > .4 ? -.04 : .07) : s.solidWidget, sc = s.solidLink ? shade(sp, lum(sp) > .4 ? -.08 : .14) : s.solidControl;
    const ink = c => (s.inkMode === 'theme' ? s.text : s.inkMode === 'custom' ? s.inkColor : contrastInk(c));
    set('solid-panel', sp); set('solid-widget', sw); set('solid-control', sc);
    set('solid-panel-ink', ink(sp)); set('solid-widget-ink', ink(sw)); set('solid-control-ink', ink(sc));
    // colours (the derived ones fall back to tokens.css while the user has not set them)
    set('bg', s.bg); set('text', s.text); set('accent', s.accent);
    set('accent-ink', s.accentInkAuto ? contrastInk(s.accent) : s.accentInk);
    opt('colMuted', 'muted-user'); opt('colFaint', 'faint-user'); opt('colLine', 'line-user'); opt('colHover', 'hover-user'); opt('colWell', 'well-user'); opt('colScroll', 'scroll-user');
    // ink on saturated good / bad / warning / priority fills: auto = whichever of dark or light reads on most of them
    { const fills = [s.colGood || '#52c98f', s.colBad || '#f06f86', s.colWarn || '#f3b25a']; const dark = fills.filter(c => lum(c) > .3).length >= 2; set('on-fill', s.colOnFill || (dark ? '#10161f' : '#ffffff')); }
        opt('colHl', 'hl-user'); opt('colLink', 'link'); opt('colFocus', 'focus'); opt('colSel', 'sel'); opt('colNow', 'now'); opt('colGood', 'good'); opt('colBad', 'bad'); opt('colWarn', 'warn');
    // glass: tint colour x tint strength (0 = clear) and milkiness are separate. --tint/--glass-a are the combined
    // fill (hue + opacity), so every existing `color-mix(var(--tint) calc(var(--glass-a) ...))` follows the model.
    const tA = (s.tintA || 0) / 100, mA = s.glassA / 100, A = 1 - (1 - tA) * (1 - mA), T = rgb(s.tint);
    const fill = A > 0 ? T.map(t => (255 * mA + t * tA * (1 - mA)) / A) : [255, 255, 255];
    set('tint', hex(fill)); set('glass-a', A.toFixed(3)); set('tint-color', s.tint); set('tint-a', tA.toFixed(3)); set('milk-a', mA.toFixed(3));
    set('glass-blur', s.blur + 'px');
    set('shine', String(s.shine)); set('light', s.lightColor); set('light-angle', s.lightAngle + 'deg'); set('light-reach', s.lightReach + '%');
    const a = s.lightAngle * Math.PI / 180, dx = Math.sin(a), dy = -Math.cos(a);
    set('lip-x', (dx * 1.5).toFixed(2) + 'px'); set('lip-y', (dy * 1.5).toFixed(2) + 'px');
    set('lx', dx.toFixed(3)); set('ly', dy.toFixed(3));   // unit vector toward the lit edge, for device-pixel rim lines
    set('drop-x', (dx * 22).toFixed(1) + 'px'); set('drop-y', (dy * 22).toFixed(1) + 'px');
    // text
    set('font-ui', s.fontUI); set('font-head', s.fontHead || s.fontUI); set('font-mono', s.fontMono);
    set('fs', s.textSize + 'px'); set('lh', String(s.lineHeight)); set('ls', s.letterSpacing + 'em'); set('fw-head', String(s.headWeight));
    r.classList.toggle('tbg', s.tbgA > 0); set('tbg', rgba(s.tbgColor, s.tbgA / 100));
    // outline: its colour must contrast with the text it surrounds (never a dark outline on dark ink)
    const ol = outline(s.olStyle, s.olWidth);
    const olHex = contrast(s.olColor, s.text) >= 2 ? s.olColor : (lum(s.text) > .4 ? '#000000' : '#ffffff');
    const oc = rgba(olHex, s.olA);
    set('olr', ol.r.toFixed(4) + 'em'); set('olb', ol.b.toFixed(4) + 'em'); set('olw', ol.r.toFixed(4) + 'em'); set('olc', oc); set('ol-a', String(s.olA));
    set('ol-glow', (ol.glow || 0).toFixed(4) + 'em');
    set('ol-room', ol.room ? 'calc(' + ol.room.toFixed(4) + 'em + 1px)' : '0px');
    set('ol-shadow', ol.room ? (ol.glow ? `0 0 ${(ol.glow * 1.5).toFixed(3)}em ${oc}, 0 0 ${(ol.glow * 3).toFixed(3)}em ${oc}` : `0 0 ${(ol.r + ol.b).toFixed(3)}em ${oc}`) : 'none');   // legacy, resolved on :root
    r.classList.toggle('txt-ring', s.olStyle !== 'off');      // every style is a ring now (app CSS keys off this class)
    r.classList.remove('txt-stroke');
    r.dataset.ol = s.olStyle;
    // shape & motion
    set('radius', s.radius + 'px'); set('gap', s.gap + 'px'); set('pad', s.pad + 'px');
    if (s.rowGap != null) set('row-gap', s.rowGap + 'px'); else st.removeProperty('--row-gap');
    if (s.ctlH != null) set('ctl-h', s.ctlH + 'px'); else st.removeProperty('--ctl-h');
    if (s.ctlPx != null) set('ctl-px', s.ctlPx + 'px'); else st.removeProperty('--ctl-px');
    applyZoom(s.scale);
    setHair();
    r.classList.toggle('no-motion', systemStill(s));
    // layers
    backdrop(s); lens(plain ? Object.assign({}, s, { matPanel: 'solid', matWidget: 'solid', matControl: 'solid' }) : s);
    GK.bus.emit('applied', s);
  }
  /* The UI scale is CSS zoom on #app. The scale used is the one chosen, eased back only as far as needed for the app
     to keep its designed minimum room (MIN_W x MIN_H CSS px) in a small window. It is published as --ui-zoom so
     window-sized lengths inside #app divide it out (--app-vh / --app-vw, shell.css). A window that must stay
     unscaled (a pop-up page) sets html[data-no-zoom]. */
  const MIN_W = 760, MIN_H = 520;
  let wantScale = 1;
  function applyZoom(want) {
    if (want != null) wantScale = +want || 1;
    const app = document.getElementById('app'), r = document.documentElement;
    if (!app || r.dataset.noZoom) return;
    const fit = Math.min(innerWidth / MIN_W, innerHeight / MIN_H);
    const z = Math.round(Math.max(.5, wantScale > 1 ? Math.min(wantScale, Math.max(1, fit)) : wantScale) * 100) / 100;
    if (app.style.zoom !== String(z)) { app.style.zoom = String(z); r.style.setProperty('--ui-zoom', String(z)); GK.layout('zoom'); }
  }
  GK.uiScale = () => ({ chosen: wantScale, used: +(document.getElementById('app') || {}).style.zoom || 1 });
  /* --hair = one whole device pixel (crisp rims at any DPI): on :root for <body> overlays, and on #app for the
     scale in use there, or a 1px line at 125% lands between pixels and blurs. */
  function setHair() {
    const hair = k => (Math.max(1, Math.floor(k)) / k).toFixed(4) + 'px';   // k = device px per CSS px
    const d = devicePixelRatio || 1, app = document.getElementById('app'), z = (app && app.currentCSSZoom) || 1;
    document.documentElement.style.setProperty('--hair', hair(d));
    if (app) app.style.setProperty('--hair', hair(d * z));
  }
  GK.bus.on('layout', why => {
    if (why && (why.includes('resize') || why.includes('dpr'))) applyZoom();
    setHair();
    if (why && why.includes('dpr') && root.Prism && Prism.refresh) try { Prism.refresh(); } catch (e) {}   // a display change: the glass canvas re-sizes
  });

  /* smoke checks (npm test) for the rendering contract */
  if (GK.smoke) {
    GK.smoke.check('glass is clear by default; old tint settings migrate', () => KIT_DEFAULTS.glassA === 0 && KIT_DEFAULTS.tintA <= 10 &&   // clear: no milk, at most a faint tint (an app's house look may add one)
      migrateTint({ tint: '#ffffff', glassA: 20 }).tintA === 0 && migrateTint({ tint: '#1a2a3a', glassA: 38 }).tintA === 38 && migrateTint({ tint: '#1a2a3a', glassA: 38 }).glassA === 0);
    GK.smoke.check('optional optics are off by default and the glowing look is a normal look', () => {
      const keys = ['bulge', 'bubbleLens', 'envLight', 'glow', 'halation', 'haze'];
      const on = keys.filter(k => k in KIT_DEFAULTS && KIT_DEFAULTS[k] !== 0);   // bubbleLens belongs to the bubbles add-on
      if (on.length) throw new Error('not off by default: ' + on.join(', '));
      const look = LOOKS['Golden hour'];
      if (!look) throw new Error('Golden hour look missing');
      const lookSections = new Set(['material', 'background', 'colors', 'text', 'glass', 'shape']);
      const stray = Object.keys(look).filter(k => k !== 'keepWallpaper' && byKey(k) && !lookSections.has(byKey(k).section));   // keys of absent add-ons are fine
      if (stray.length) throw new Error('look keys outside look sections: ' + stray.join(', '));
      return true;
    });
    GK.smoke.check('Prism renders at full device resolution', () => {
      const P = root.Prism, c = document.getElementById('gk-prism');
      return !(P && P.active && c) || (c.width === Math.round(innerWidth * devicePixelRatio) && P.stats.scale === 1);
    });
    GK.smoke.check('title-bar tools fit their text and their glass follows a text change', () => {
      const tools = [...document.querySelectorAll('.gk-title-tools > .gk-btn')].filter(b => b.offsetParent);
      const over = tools.filter(b => b.scrollWidth > b.clientWidth + 1);
      if (over.length) throw new Error('text overflows: ' + over.map(b => b.textContent).join(', '));
      const P = root.Prism;
      if (!(P && P.active && P.rectOf)) return true;
      const b = tools.find(t => t.dataset.prism === 'control'); if (!b) return true;
      const keep = [...b.childNodes];
      b.append(' and some more text');
      P.sync();
      const want = b.getBoundingClientRect(), got = P.rectOf(b);
      b.replaceChildren(...keep); P.sync();
      if (!got) throw new Error('no glass drawn for ' + (b.id || b.textContent));
      const off = Math.max(Math.abs(got.left - want.left), Math.abs(got.top - want.top), Math.abs(got.width - want.width), Math.abs(got.height - want.height));
      if (off > 1) throw new Error('glass off by ' + off.toFixed(2) + 'px');
      return true;
    });
  }
})(window);
