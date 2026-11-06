/* Atlas "Map" panel and view chrome: the View menu in the header, the View / Layers / Settings sections of the
   side panel, and the banner on the stage that explains what a view needs (terrain data, a simulation, a starting
   point). Pure UI over the state atlas.js passes in. */
(function (root) {
  'use strict';
  const GK = root.GK, WB = root.WB, F = root.WBField, h = GK.h, ui = GK.ui;
  const addTo = (el, ...kids) => GK.append(el, kids);

  function create(ctx) {
    const { S, view, P, M } = ctx;
    const Geo = () => root.WBGeo;
    const PN = {};
    const MODES = WB.atlasModes.MODES, STYLES = WB.atlasModes.STYLES;
    const modeName = m => (MODES.find(x => x[0] === m) || MODES[0]);

    /* ---------- remembering the view per map ---------- */
    PN.save = function () {
      if (!S.map) return;
      const all = Object.assign({}, P.vmode), o = M.travel.origin;
      all[S.map.id] = { mode: M.mode, style: M.style, climate: M.climate, travelMode: M.travel.mode, origin: o ? [Math.round(o[0]), Math.round(o[1])] : null };
      P.vmode = all; ctx.store.patch({ vmode: all });
    };
    PN.restore = function () {
      const v = (P.vmode || {})[S.map.id] || {};
      M.travel.mode = v.travelMode || 'walk'; M.travel.origin = v.origin || null; M.tcache = null;
      // a generated map with no borders yet opens on its terrain; one with territories opens political
      const first = M.field && !S.items.some(i => i.kind === 'region') ? 'terrain' : 'political';
      M.setMode(v.mode || first, v.style || 'natural', v.climate || 'temp');
    };
    PN.set = function (mode, style, climate) {
      M.setMode(mode, style, climate);
      PN.save(); PN.banner(); ctx.paintHead(); ctx.paintOptions(); ctx.paintLegend(); ctx.paintMapPanel();
      if (S.globe) S.globe.refresh();
    };

    /* ---------- header: the View menu ---------- */
    PN.viewButton = function (box) {
      const [id, name, icon] = modeName(M.mode);
      const label = name + (M.mode !== 'political' && M.style !== 'natural' ? ' · ' + (STYLES.find(s => s[0] === M.style) || [])[1] : '');
      const b = ui.button({ label: label, icon, small: true, title: 'Change how the map is drawn: political, terrain, relief, climate, travel, resources, economy', onClick: e => viewMenu(e.currentTarget) });
      b.classList.add('wb-at-viewbtn');
      box.appendChild(h('span.gk-small.gk-muted', { text: 'View' }));
      box.appendChild(b);
      void id;
    };
    function viewMenu(at) {
      const items = [{ header: 'View' }];
      for (const m of MODES) items.push({ label: m[1], icon: m[2], hint: m[3], checked: M.mode === m[0], onClick: () => PN.set(m[0]) });
      items.push('-', { header: 'Style' });
      for (const s of STYLES) items.push({ label: s[1], checked: M.style === s[0], onClick: () => PN.set(null, s[0]) });
      WB.ui.menu(items, at);
    }

    /* ---------- the banner on the stage ---------- */
    PN.banner = function () {
      const box = ctx.bannerEl;
      GK.clear(box);
      box.hidden = true; box.className = 'wb-at-banner wb-at-float';
      if (!S.map || S.gallery || S.mode === 'globe') return;
      const D = S.data, mode = M.mode;
      const note = (text, actions, cls) => { box.hidden = false; box.className = 'wb-at-banner wb-at-float ' + (cls || ''); addTo(box, h('span', { text }), ...(actions || [])); };
      if (['terrain', 'relief', 'climate'].includes(mode) && !M.field) {
        note('This map has no terrain data, so the picture is shown as it is.', ctx.ro() ? [] : [ui.button({ label: 'Add terrain', small: true, icon: '⛰', onClick: () => ctx.tools.ensureField() }), ui.button({ label: 'Generate…', small: true, kind: 'ghost', onClick: () => ctx.openGenerator({ replaceMapId: S.map.id, title: S.map.title }).then(() => ctx.refreshAll()) })]);
      } else if (mode === 'economy' && !M.sim()) {
        const has = GK.modules && GK.modules.list && GK.modules.list().some(m => m.id === 'simulate');
        box.hidden = false; box.className = 'wb-at-banner wb-at-float wb-at-empty-eco';
        addTo(box, h('div', [h('b', { text: 'No simulation to show yet' }), h('div.gk-small', { text: 'Run a simulation in Maps & Sim. Its settlements (sized by population, coloured by wealth), trade flows along your routes and shortages appear here.' })]),
          has ? ui.button({ label: 'Open Maps & Sim', small: true, icon: '⚖', kind: 'primary', onClick: () => WB.go('simulate') }) : null);
      } else if (mode === 'resources' && !(D.deposits && D.deposits.length) && !(M.paint && M.paint.regs.length)) {
        note('No deposits yet.', ctx.ro() ? [] : [M.field ? ui.button({ label: 'Seed from the terrain', small: true, icon: '◆', kind: 'primary', onClick: () => PN.seedDeposits() }) : null, ui.button({ label: 'Place one', small: true, kind: 'ghost', onClick: () => ctx.setTool('deposit') })].filter(Boolean));
      } else if (mode === 'travel') {
        const modes = Geo().travelModes(D, WB.world && WB.world.settings);
        const sel = ui.select({ value: M.travel.mode, options: modes.map(m => [m.mode, m.icon + ' ' + m.label]), onChange: v => { M.setTravelMode(v); PN.save(); } });
        note(M.travel.origin ? 'Rings show how far you get. Move the pointer to read the time to a place.' : 'Click the map (or pick a pin below) to choose where the journey starts.', [sel, S.items.some(i => i.kind === 'pin') ? ui.button({ label: 'From a pin…', small: true, kind: 'ghost', onClick: e => pinMenu(e.currentTarget) }) : null, M.travel.origin ? ui.button({ icon: '✕', small: true, kind: 'ghost', title: 'Clear the starting point', onClick: () => { M.setOrigin(null); PN.save(); PN.banner(); } }) : null].filter(Boolean));
        if (!Geo().isPlanet(D) && !D.unitsPerPx) box.appendChild(h('span.gk-tiny.gk-faint', { text: 'Set the scale (K) for real times; rings are in map pixels.' }));
      }
    };
    function pinMenu(at) {
      WB.ui.menu(S.items.filter(i => i.kind === 'pin').slice(0, 40).map(i => ({ label: WB.atlasView.titleOf(i), icon: '📍', onClick: () => { M.setOrigin([i.x, i.y]); PN.save(); PN.banner(); } })), at);
    }
    PN.seedDeposits = async function () {
      if (!M.field) return;
      const dep = F.seedDeposits(M.field, F.rng(M.field.seed + 99), .6);
      const before = (S.data.deposits || []).map(d => d.slice());
      S.data.deposits = before.concat(dep);
      ctx.tools.mark('deco');
      ctx.record(() => { S.data.deposits = before; ctx.tools.mark('deco'); view.draw(); return Promise.resolve(); }, () => { S.data.deposits = before.concat(dep); ctx.tools.mark('deco'); view.draw(); return Promise.resolve(); });
      view.draw(); PN.banner();
      WB.ui.toast(dep.length + ' deposits seeded from the terrain', '◆');
    };

    /* ---------- the Map panel ---------- */
    const section = (key, title, body, hint) => {
      const open = !!Object.assign({ view: true, layers: true, settings: false }, P.mapSections)[key];
      const head = h('button.wb-at-sechead', { type: 'button', 'aria-expanded': String(open), onclick: () => { const s = Object.assign({ view: true, layers: true, settings: false }, P.mapSections); s[key] = !open; P.mapSections = s; ctx.store.patch({ mapSections: s }); ctx.paintMapPanel(); } }, [h('b', { text: title }), hint ? h('span.gk-tiny.gk-faint', { text: hint }) : null, h('span.gk-grow'), h('span.gk-faint', { text: open ? '▾' : '▸' })]);
      const wrap = h('section.wb-at-sec', { class: open ? 'open' : '' }, [head]);
      if (open) wrap.appendChild(h('div.wb-at-secbody', [body()]));
      return wrap;
    };
    PN.paintMapPanel = function (box) {
      GK.clear(box);
      addTo(box, section('view', 'View', viewSection, modeName(M.mode)[1]), section('layers', 'Layers', () => { const b = h('div.wb-at-layerbox'); ctx.layersInto(b); return b; }), section('settings', 'Settings', () => { const b = h('div.wb-at-setbox'); ctx.settingsInto(b); return b; }));
    };
    function viewSection() {
      const box = h('div.gk-stack');
      const list = h('div.wb-at-modes', { role: 'radiogroup', 'aria-label': 'View' });
      for (const m of MODES) {
        const need = (['terrain', 'relief', 'climate'].includes(m[0]) && !M.field) ? 'no terrain data' : m[0] === 'economy' && !M.sim() ? 'needs a simulation' : '';
        list.appendChild(h('button.wb-at-mode', { type: 'button', role: 'radio', 'aria-checked': String(M.mode === m[0]), class: M.mode === m[0] ? 'on' : '', title: m[3], onclick: () => PN.set(m[0]) },
          [h('span.wb-at-mode-ic', { text: m[2] }), h('span.wb-at-mode-tx', [h('b', { text: m[1] }), h('span.gk-tiny.gk-muted', { text: need || m[3] })])]));
      }
      addTo(box, list);
      addTo(box, ui.field({ label: 'Style', hint: 'How the ground is coloured in Terrain and the calm bases of the other views.', control: ui.segmented({ value: M.style, options: STYLES.map(s => [s[0], s[1]]), onChange: v => PN.set(null, v) }) }));
      if (M.mode === 'climate') addTo(box, ui.field({ label: 'Show', control: ui.segmented({ value: M.climate, options: [['temp', 'Temperature'], ['rain', 'Rainfall']], onChange: v => PN.set(null, null, v) }) }));
      if (M.field) {
        const f = M.field, P2 = f.params || {};
        addTo(box, h('div.wb-at-terraininfo', [h('b', { text: 'Terrain' }), h('div.gk-small.gk-muted', { text: (P2.mode ? ((F.MODES.find(m => m[0] === P2.mode) || [])[1] || P2.mode) + ' · ' : '') + 'seed ' + f.seed + ' · ' + f.w + ' × ' + f.h + ' cells' }),
          ctx.ro() ? null : h('div.gk-row', [ui.button({ label: 'Regenerate…', small: true, icon: '⛰', onClick: () => ctx.openGenerator({ replaceMapId: S.map.id, title: S.map.title }).then(() => ctx.refreshAll()) }),
            ui.button({ label: 'Seed deposits', small: true, icon: '◆', title: 'Add resource deposits where the terrain suits them', onClick: () => PN.seedDeposits() }),
            ui.button({ label: 'Roads', small: true, icon: '⟿', title: 'Join all settlement pins with roads over the cheapest ground', onClick: () => ctx.tools.autoRoads() })])]));
      } else if (!ctx.ro()) addTo(box, h('div.gk-small.gk-muted', { text: 'No terrain yet: picking a terrain tool in the toolbox starts one, or generate terrain from Settings.' }));
      const dep = S.data.deposits || [];
      if (M.mode === 'resources' && dep.length) {
        const counts = new Map(); for (const d of dep) counts.set(d[2], (counts.get(d[2]) || 0) + 1);
        addTo(box, h('div.wb-at-reslist', [...counts].sort((a, b) => b[1] - a[1]).map(([k, n]) => h('span.wb-at-rescount', { style: { '--c': F.RES[k][2] } }, [h('i'), F.RES[k][1] + ' ' + n]))));
      }
      return box;
    }
    return PN;
  }
  WB.atlasPanel = { create };
})(window);
