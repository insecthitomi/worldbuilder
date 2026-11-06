/* Atlas icon library: pin symbols drawn on a 24-unit grid (filled shapes), used on the canvas (Path2D) and in the
   DOM (inline SVG) so the legend, the picker and the map always match. */
(function (root) {
  'use strict';
  const WB = root.WB;
  const I = [
    ['capital', 'Capital', 'M3 18h18v2.5H3z M3 7l4.8 4.2L12 4.5l4.2 6.7L21 7l-1.6 9.5H4.6z'],
    ['city', 'City', 'M2 21v-9l4-2.5V21z M7.5 21V5.5L12.5 3v18z M14 21V8.5h4V21z M19.5 21v-7.5H22V21z'],
    ['town', 'Town', 'M1.5 21v-8l5-4.5 5 4.5v8z M11 21v-9.5l5.75-5 5.75 5V21z'],
    ['village', 'Village', 'M4 21v-9.5l8-7 8 7V21h-5.5v-5.5h-5V21z'],
    ['port', 'Port', 'M12 2.2a2.6 2.6 0 0 1 1.1 4.96V9H16v2h-2.9v8.4c2.7-.4 4.8-2.2 5.5-4.6l-1.8.7 2.5-5 2.7 4.6-1.7-.4C19.4 18.9 16 21.6 12 21.6S4.6 18.9 3.7 14.7l-1.7.4 2.7-4.6 2.5 5-1.8-.7c.7 2.4 2.8 4.2 5.5 4.6V11H8V9h2.9V7.16A2.6 2.6 0 0 1 12 2.2z M12 3.8a1 1 0 1 0 0 2 1 1 0 0 0 0-2z', 'evenodd'],
    ['castle', 'Castle', 'M2.5 21V8h3.3v2.6h2.3V8h3.6v2.6h1.6V8h3.6v2.6h2.3V8h3.3v13h-6.8v-4.4a2.7 2.7 0 0 0-5.4 0V21z'],
    ['ruin', 'Ruin', 'M3 21v-2h18v2z M5 18V8.5l2.5-1.5V18z M10 18V5h2.6v3.2l1.2 1.4V18z M16.5 18v-5.5l2.5-1.8V18z'],
    ['temple', 'Temple', 'M12 2.5l10 5.5v2H2V8z M4 11h2.5v7H4z M8.5 11H11v7H8.5z M13 11h2.5v7H13z M17.5 11H20v7h-2.5z M2 19h20v2.5H2z'],
    ['tower', 'Tower', 'M7.5 21.5l1.2-11.5H7V3.5h2.2v2h1.7v-2h2.2v2h1.7v-2H17V10h-1.7l1.2 11.5z'],
    ['lighthouse', 'Lighthouse', 'M9 21.5l1.4-12h3.2l1.4 12z M9.6 8.5h4.8v-2L12 4.5l-2.4 2z M2.5 6.6l5 1.4v1l-5 1.4z M21.5 6.6l-5 1.4v1l5 1.4z'],
    ['cave', 'Cave', 'M1.5 20.5C2.7 12.5 7 6 12 6s9.3 6.5 10.5 14.5h-6.2c-.3-3.6-2-6.5-4.3-6.5s-4 2.9-4.3 6.5z'],
    ['mine', 'Mine', 'M2.5 9.5C6 5 18 5 21.5 9.5l-1.4 1.2C17 8 14.3 7.3 13 7.2V21.5h-2V7.2c-1.3.1-4 .8-7.1 3.5z'],
    ['camp', 'Camp', 'M12 3.5l10 17H2z M12 12.5l-3.4 8h6.8z', 'evenodd'],
    ['battle', 'Battle', 'M3 3l2.6.2L15 12.6 12.6 15 3.2 5.6z M11.2 17.4l6.2-6.2 1.4 1.4-6.2 6.2z M16.4 18.8l2.4-2.4 3 3-2.4 2.4z M21 3l-2.6.2L9 12.6l2.4 2.4 9.4-9.4z M12.8 17.4l-6.2-6.2-1.4 1.4 6.2 6.2z M7.6 18.8l-2.4-2.4-3 3 2.4 2.4z'],
    ['monster', 'Monster', 'M12 4c-4.6 0-7.6 3.2-7.6 7.4 0 2.4 1 4.1 2.6 5.1V20h2.6v-1.8h1.2V20h2.4v-1.8h1.2V20h2.6v-3.5c1.6-1 2.6-2.7 2.6-5.1C19.6 7.2 16.6 4 12 4z M8.8 10.2a1.9 1.9 0 1 0 0 3.8 1.9 1.9 0 0 0 0-3.8z M15.2 10.2a1.9 1.9 0 1 0 0 3.8 1.9 1.9 0 0 0 0-3.8z M2.6 2.8l3.8 2.8-1.8 1.8z M21.4 2.8l-3.8 2.8 1.8 1.8z', 'evenodd'],
    ['treasure', 'Treasure', 'M3 10.5C3 7.5 5 5.5 8 5.5h8c3 0 5 2 5 5v.5H3z M3 12.5h18v7.5H3z M10.8 11.2h2.4v3.6h-2.4z', 'evenodd'],
    ['mountain', 'Mountain', 'M1.5 20.5L9 7l3.6 6.2 2.4-3.7 7.5 11z'],
    ['forest', 'Forest', 'M12 2l5.2 7.2h-2.6l4.4 6.3h-5.3v5h-3.4v-5H5l4.4-6.3H6.8z'],
    ['bridge', 'Bridge', 'M1.5 8.5h21v3.2c-2.4 0-3.8 1.6-3.8 4V20h-3.2v-3a3.5 3.5 0 0 0-7 0v3H5.3v-4.3c0-2.4-1.4-4-3.8-4z'],
    ['gate', 'Gate', 'M3.5 21.5V4h3v2h2.5V4h6v2h2.5V4h3v17.5h-5.2V15a3.3 3.3 0 0 0-6.6 0v6.5z'],
    ['ship', 'Ship', 'M2.5 15h19l-3.2 5.5H5.7z M11 2.5h1.8V14H11z M13.6 3.6l6 9.4h-6z M10.2 5.6l-5.4 7.4h5.4z'],
    ['market', 'Market', 'M2.5 4h19l1 5.5h-21z M4 11h16v10h-3v-6H7v6H4z'],
    ['inn', 'Inn', 'M4.5 5h11v15.5h-11z M15.5 8h2.5a2.5 2.5 0 0 1 2.5 2.5v4a2.5 2.5 0 0 1-2.5 2.5h-2.5v-2h2.5a.5.5 0 0 0 .5-.5v-4a.5.5 0 0 0-.5-.5h-2.5z'],
    ['landmark', 'Landmark', 'M9.8 19.5l1-13.5L12 3l1.2 3 1 13.5z M7 19.5h10v2H7z'],
    ['flag', 'Flag', 'M5 2.5h2v19H5z M7 3.5h12.5l-3.2 4.5 3.2 4.5H7z'],
    ['person', 'Person', 'M12 3a4 4 0 1 0 0 8 4 4 0 0 0 0-8z M4.5 21c0-4.4 3.4-7.5 7.5-7.5s7.5 3.1 7.5 7.5z'],
    ['storm', 'Storm', 'M13.5 2L4.5 13.5h6L9 22l10-12.5h-6.2z'],
    ['star', 'Star', 'M12 2.2l2.9 6.6 7.1.6-5.4 4.7 1.6 7-6.2-3.7-6.2 3.7 1.6-7L2 9.4l7.1-.6z'],
    ['dot', 'Dot', 'M12 6a6 6 0 1 0 0 12 6 6 0 0 0 0-12z'],
  ];
  const BY = new Map(I.map(([id, label, d, rule]) => [id, { id, label, d, rule: rule || 'nonzero' }]));
  const paths = new Map();
  /* sensible defaults: by type, then by the entry's "kind" field */
  const TYPE = { place: 'village', character: 'person', faction: 'flag', event: 'star', item: 'treasure', encounter: 'monster', species: 'monster', lore: 'star', map: 'flag', session: 'flag', scene: 'dot', culture: 'flag' };
  const KIND = {
    World: 'star', Continent: 'mountain', Region: 'flag', Nation: 'capital', Province: 'flag', City: 'city', Town: 'town', Village: 'village', District: 'market', Building: 'castle',
    Landmark: 'landmark', Wilderness: 'forest', Dungeon: 'cave', Plane: 'star', Vessel: 'ship',
    Battle: 'battle', War: 'battle', Disaster: 'storm', Founding: 'flag', Coronation: 'capital', Death: 'monster', Festival: 'star', Discovery: 'star', Treaty: 'flag', Crime: 'monster', Migration: 'camp', Miracle: 'star',
    Guild: 'market', Church: 'temple', Order: 'tower', Army: 'battle', House: 'castle', Company: 'ship', Cult: 'temple',
    Monster: 'monster', Beast: 'monster', Relic: 'treasure', Weapon: 'battle', Vehicle: 'ship',
  };
  WB.atlasIcons = {
    list: I.map(([id]) => BY.get(id)),
    get: id => BY.get(id) || BY.get('dot'),
    label: id => (BY.get(id) || {}).label || id,
    path(id) { let p = paths.get(id); if (!p) { p = new Path2D((BY.get(id) || BY.get('dot')).d); paths.set(id, p); } return p; },
    rule: id => (BY.get(id) || BY.get('dot')).rule,
    /** default icon for an entry (type key and its "kind" field when known) */
    forEntry(typeKey, kind) { return (kind && KIND[kind]) || TYPE[typeKey] || 'dot'; },
    /** inline SVG for the DOM */
    svg(id, { size = '1.2em', color = 'currentColor', cls = '' } = {}) {
      const ic = BY.get(id) || BY.get('dot');
      const ns = 'http://www.w3.org/2000/svg';
      const s = document.createElementNS(ns, 'svg');
      s.setAttribute('viewBox', '0 0 24 24'); s.setAttribute('width', size); s.setAttribute('height', size); s.setAttribute('aria-hidden', 'true');
      s.setAttribute('class', 'wb-at-icon ' + cls);
      const p = document.createElementNS(ns, 'path');
      p.setAttribute('d', ic.d); p.setAttribute('fill', color); p.setAttribute('fill-rule', ic.rule);
      s.appendChild(p);
      return s;
    },
  };
})(window);
