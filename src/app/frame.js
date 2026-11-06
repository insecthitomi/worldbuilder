/* The window's own glass edge: the app draws the rim around the whole window (light-aware, like the panels),
   so the wallpaper ends on a clean glass edge instead of the plain system border. Opaque — nothing from the
   desktop shows through. Hidden when maximized; dims when the window is inactive (shell.js sets both classes). */
(function () {
  'use strict';
  GK.settings.extend([
    { key: 'winFrame', section: 'glass', label: 'Glass window edge', type: 'toggle', def: true, hint: 'A glass rim around the whole window, so the wallpaper ends on a clean edge.' },
    { key: 'winFrameK', section: 'glass', label: 'Window edge strength', type: 'range', min: .3, max: 2.5, step: .05, def: 1, format: v => '×' + v.toFixed(2), when: s => s.winFrame },
  ]);
  const frame = GK.h('div#gk-frame', { 'aria-hidden': 'true' });
  const paint = s => {
    if (!frame.isConnected) document.body.appendChild(frame);
    frame.hidden = !s.winFrame;
    frame.style.setProperty('--rim-k', String(s.winFrameK || 1));
  };
  GK.bus.on('applied', paint);
})();
