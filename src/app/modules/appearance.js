/* Appearance: the studio (category rail, search, live preview), in the navigation footer, plus two looks the kit
   leaves to the app: button outlines and "Reset colours". */
(function () {
  'use strict';
  const S = GK.settings, ui = GK.ui;

  /* button outlines: a look, so it lives in GK.settings next to the text outline */
  S.extend([
    { key: 'btnOutline', section: 'text', label: 'Button outlines', type: 'toggle', def: false, hint: 'A thin line around buttons, chips and inputs — easier to spot over a busy background.' },
    { key: 'btnOutlineW', section: 'text', label: 'Button outline thickness', type: 'range', min: .5, max: 4, step: .1, unit: 'px', def: 1.5, when: s => s.btnOutline },
    { key: 'btnOutlineAuto', section: 'text', label: 'Button outline colour from the theme', type: 'toggle', def: true, when: () => false },   // the Auto state of btnOutlineCol
    { key: 'btnOutlineCol', section: 'text', label: 'Button outline colour', type: 'color', def: '#103a56', autoKey: 'btnOutlineAuto', autoToken: '--btn-oc', when: s => s.btnOutline, hint: 'Auto follows the text colour.' },
  ]);
  GK.bus.on('applied', s => {
    const r = document.documentElement;
    r.classList.toggle('btnoutline', !!s.btnOutline);
    r.style.setProperty('--btn-ow', (s.btnOutlineW || 1.5) + 'px');
    r.style.setProperty('--btn-oc', s.btnOutlineAuto === false ? s.btnOutlineCol : 'color-mix(in srgb, var(--text) 55%, transparent)');
  });

  /* "Reset colours": every colour goes back to the current look's (or the default) and every derived colour to Auto;
     nothing else (spacing, glass strength, fonts …) changes */
  function resetColors() {
    const look = Object.assign({}, S.DEFAULTS, S.migrateTint(Object.assign({}, S.LOOKS[S.get('lookName')] || {}))), p = {};
    S.schema.forEach(it => {
      if (it.type !== 'color' || it.mapsTo) return;
      p[it.key] = look[it.key];
      if (it.autoKey) p[it.autoKey] = look[it.autoKey] !== undefined ? look[it.autoKey] : true;
    });
    S.patch(p);
    ui.toast('Colours reset to the look’s own', '🎨');
  }
  GK.studio.controls.colorsReset = () => ui.button({ label: 'Reset colours', icon: '↺', small: true, title: 'Every colour back to the look’s own; spacing, glass and fonts stay', onClick: async () => {
    if (await ui.confirm('Reset every colour?', 'Text, accent, highlights, lines, status and surface colours go back to the look’s own. Nothing else changes.', 'Reset colours')) resetColors();
  } });

  GK.modules.register({
    id: 'appearance',
    title: 'Appearance',
    icon: '⚙',
    order: 1000,
    foot: true,
    subtitle: 'Everything about how the app looks and moves. Changes save instantly — ↺ puts any setting back.',
    mount(page) {
      const off = GK.studio.mount(page);
      setTimeout(() => { const s = page.querySelector('.gk-st-search'); if (s) s.focus({ preventScroll: true }); }, 30);
      return off;
    },
  });
})();
