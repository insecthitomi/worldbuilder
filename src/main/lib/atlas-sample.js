'use strict';
/* The example world's maps: a storm coast (the Saltmarch) and its port city (Gullhaven), drawn here as SVG
   with seeded randomness (no asset files), then pins, borders that move with the Salt War, routes and labels. */
const G = require('./atlas-geo');

/* ---------------- drawing helpers ---------------- */
function rng(seed) {
  let a = seed >>> 0;
  return () => { a = (a + 0x6D2B79F5) | 0; let t = Math.imul(a ^ (a >>> 15), 1 | a); t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t; return ((t ^ (t >>> 14)) >>> 0) / 4294967296; };
}
const r1 = v => Math.round(v * 10) / 10;
const pd = (pts, close) => 'M' + pts.map(p => r1(p[0]) + ' ' + r1(p[1])).join('L') + (close ? 'Z' : '');
/** midpoint displacement: a hand-drawn edge between control points */
function roughen(pts, rnd, depth = 5, amp = 0.2, closed = false) {
  let out = pts.slice();
  for (let d = 0; d < depth; d++) {
    const next = [], n = closed ? out.length : out.length - 1;
    for (let i = 0; i < n; i++) {
      const a = out[i], b = out[(i + 1) % out.length], dx = b[0] - a[0], dy = b[1] - a[1], len = Math.hypot(dx, dy) || 1;
      const off = (rnd() - 0.5) * 2 * amp * len;
      next.push(a, [(a[0] + b[0]) / 2 - (dy / len) * off, (a[1] + b[1]) / 2 + (dx / len) * off]);
    }
    if (!closed) next.push(out[out.length - 1]);
    out = next;
  }
  return out;
}
/** Catmull-Rom through the points as a smooth SVG path */
function smooth(pts) {
  let s = 'M' + r1(pts[0][0]) + ' ' + r1(pts[0][1]);
  for (let i = 0; i < pts.length - 1; i++) {
    const p0 = pts[i - 1] || pts[i], p1 = pts[i], p2 = pts[i + 1], p3 = pts[i + 2] || p2;
    s += 'C' + [p1[0] + (p2[0] - p0[0]) / 6, p1[1] + (p2[1] - p0[1]) / 6, p2[0] - (p3[0] - p1[0]) / 6, p2[1] - (p3[1] - p1[1]) / 6, p2[0], p2[1]].map(r1).join(' ');
  }
  return s;
}
/** jittered points inside a polygon */
function scatter(poly, gap, rnd, jitter = 0.45) {
  const b = G.bbox(poly), out = [];
  for (let y = b.y0; y <= b.y1; y += gap) for (let x = b.x0; x <= b.x1; x += gap) {
    const px = x + (rnd() - 0.5) * gap * 2 * jitter, py = y + (rnd() - 0.5) * gap * 2 * jitter;
    if (G.inPoly(px, py, poly)) out.push([px, py]);
  }
  return out;
}
/** the part of a polyline between two y values (inclusive ends interpolated) */
function sliceByY(line, y0, y1) {
  const out = [];
  for (let i = 0; i < line.length; i++) { const p = line[i]; if (p[1] >= y0 && p[1] <= y1) out.push(p); }
  return out;
}
const every = (pts, k) => pts.filter((p, i) => i % k === 0 || i === pts.length - 1);

/* ---------------- the Saltmarch (region, 2000 × 1300) ---------------- */
const RW = 2000, RH = 1300;
function regionMap() {
  const rnd = rng(1203);
  const coastCtl = [[860, -30], [835, 70], [800, 130], [720, 170], [640, 200], [560, 232], [515, 268], [560, 300], [640, 322], [700, 362], [735, 420], [720, 480], [690, 540],
    [650, 580], [640, 615], [662, 650], [700, 700], [690, 760], [640, 800], [590, 850], [560, 910], [590, 960], [640, 990], [660, 1050], [620, 1110], [560, 1160], [520, 1220], [500, 1330]];
  const coast = roughen(coastCtl, rnd, 4, 0.16);
  const land = coast.concat([[RW + 40, RH + 40], [RW + 40, -40]]);
  const zones = {
    mountains: [[1380, 40], [1980, 30], [1990, 360], [1720, 420], [1500, 330], [1420, 200]],
    hills: [[1180, 120], [1400, 60], [1500, 340], [1700, 430], [1560, 520], [1300, 420]],
    forest: [[1040, 340], [1300, 330], [1420, 470], [1350, 610], [1150, 640], [1020, 520]],
    flats: roughen([[980, 690], [1180, 650], [1420, 660], [1540, 760], [1500, 930], [1300, 1010], [1080, 990], [960, 880]], rnd, 3, 0.12, true),
    marsh: roughen([[690, 990], [850, 960], [1060, 1040], [1120, 1180], [1000, 1290], [760, 1300], [640, 1180]], rnd, 3, 0.12, true),
    fields: [[690, 520], [900, 520], [960, 640], [880, 760], [720, 760], [700, 640]],
  };
  const river = roughen([[1640, 300], [1520, 360], [1420, 450], [1300, 520], [1150, 560], [1000, 575], [870, 605], [760, 615], [655, 628]], rnd, 3, 0.1);
  const brook = roughen([[1180, 330], [1150, 430], [1120, 520], [1110, 560]], rnd, 3, 0.12);
  const saltRoad = [[668, 628], [790, 655], [940, 700], [1100, 760], [1250, 790], [1420, 770], [1620, 740], [1800, 715], [2010, 700]];
  const coastRoad = [[668, 628], [700, 520], [735, 420], [690, 350], [600, 300]];
  const fenTrack = [[668, 628], [720, 760], [760, 900], [820, 1020], [880, 1110]];
  const S = [];
  S.push(`<svg xmlns="http://www.w3.org/2000/svg" width="${RW}" height="${RH}" viewBox="0 0 ${RW} ${RH}">`);
  S.push(`<defs>
    <radialGradient id="sea" cx="30%" cy="55%" r="85%"><stop offset="0" stop-color="#5f97ad"/><stop offset=".55" stop-color="#3f7690"/><stop offset="1" stop-color="#2a5670"/></radialGradient>
    <linearGradient id="landg" x1="0" y1="0" x2="1" y2="0"><stop offset="0" stop-color="#e3d9b0"/><stop offset=".55" stop-color="#d9cf9f"/><stop offset="1" stop-color="#cdbf8f"/></linearGradient>
    <radialGradient id="vig" cx="50%" cy="50%" r="72%"><stop offset=".62" stop-color="#3b2a14" stop-opacity="0"/><stop offset="1" stop-color="#3b2a14" stop-opacity=".38"/></radialGradient>
    <pattern id="tuft" width="34" height="26" patternUnits="userSpaceOnUse"><path d="M6 20l-3-7M6 20l0-9M6 20l3-7M23 9l-3-6M23 9v-8M23 9l3-6" stroke="#5d6e44" stroke-width="1.3" fill="none" stroke-linecap="round"/></pattern>
    <filter id="grain" x="0" y="0" width="100%" height="100%"><feTurbulence type="fractalNoise" baseFrequency=".85" numOctaves="2" seed="7"/><feColorMatrix values="0 0 0 0 .3  0 0 0 0 .24  0 0 0 0 .16  0 0 0 .16 0"/></filter>
    <filter id="soft"><feGaussianBlur stdDeviation="18"/></filter>
    <clipPath id="landclip"><path d="${pd(land, true)}"/></clipPath>
  </defs>`);
  S.push(`<rect width="${RW}" height="${RH}" fill="url(#sea)"/>`);
  // shallows over Tidewell and the reefs
  S.push(`<g filter="url(#soft)" fill="#8fc0cf" opacity=".55"><ellipse cx="440" cy="905" rx="95" ry="60"/><ellipse cx="335" cy="560" rx="70" ry="45"/><ellipse cx="470" cy="255" rx="70" ry="50"/><ellipse cx="760" cy="1240" rx="160" ry="60"/></g>`);
  // drowned streets of Tidewell under the water
  const ruins = [];
  for (let i = 0; i < 26; i++) ruins.push(`<rect x="${r1(395 + rnd() * 90)}" y="${r1(880 + rnd() * 50)}" width="${r1(5 + rnd() * 9)}" height="${r1(4 + rnd() * 7)}"/>`);
  S.push(`<g fill="#2d5a6e" opacity=".35">${ruins.join('')}</g>`);
  // wave marks
  const waves = [];
  for (const [x, y] of scatter([[0, 0], [600, 0], [470, 600], [420, 1300], [0, 1300]], 90, rnd, .5)) {
    if (Math.hypot(x - 440, y - 905) < 120 || Math.hypot(x - 335, y - 560) < 80) continue;
    waves.push(`M${r1(x)} ${r1(y)}q7 -6 14 0t14 0`);
  }
  S.push(`<path d="${waves.join('')}" stroke="#d8ecf2" stroke-opacity=".35" stroke-width="1.6" fill="none" stroke-linecap="round"/>`);
  // coast ripples (strokes under the land fill)
  for (const [w, o] of [[86, .07], [58, .1], [36, .14], [18, .22]]) S.push(`<path d="${pd(land, true)}" fill="none" stroke="#e9f4f4" stroke-opacity="${o}" stroke-width="${w}" stroke-linejoin="round"/>`);
  // islands
  const islands = [[[335, 556], 24], [[455, 243], 16], [[488, 282], 9], [[300, 590], 8]].map(([c, r]) => roughen(Array.from({ length: 7 }, (_, i) => [c[0] + Math.cos(i / 7 * 6.283) * r, c[1] + Math.sin(i / 7 * 6.283) * r * .8]), rnd, 3, .18, true));
  for (const isl of islands) S.push(`<path d="${pd(isl, true)}" fill="#d9cf9f" stroke="#5b4a2e" stroke-width="1.6"/>`);
  S.push(`<path d="${pd(land, true)}" fill="url(#landg)"/>`);
  S.push('<g clip-path="url(#landclip)">');
  // broad colour washes
  S.push(`<g filter="url(#soft)" opacity=".5"><ellipse cx="1250" cy="480" rx="260" ry="170" fill="#9fae78"/><ellipse cx="1650" cy="200" rx="330" ry="190" fill="#b3a684"/><ellipse cx="880" cy="1120" rx="260" ry="160" fill="#a3ac7a"/><ellipse cx="820" cy="300" rx="180" ry="140" fill="#c4b98d"/></g>`);
  // fields around Gullhaven
  const fields = [];
  const fcol = ['#cfc48c', '#c3bd7f', '#d7cb98', '#bcb978', '#c9b97d'];
  for (const [x, y] of scatter(zones.fields, 34, rnd, .25)) {
    const a = rnd() * 0.6 - 0.3, w = 22 + rnd() * 16, h = 14 + rnd() * 12;
    fields.push(`<rect x="${r1(-w / 2)}" y="${r1(-h / 2)}" width="${r1(w)}" height="${r1(h)}" fill="${fcol[(rnd() * fcol.length) | 0]}" stroke="#9c8d5a" stroke-width=".7" transform="translate(${r1(x)} ${r1(y)}) rotate(${r1(a * 57)})"/>`);
  }
  S.push(`<g opacity=".85">${fields.join('')}</g>`);
  // salt flats: a pale pan with a crack network
  S.push(`<path d="${pd(zones.flats, true)}" fill="#efede3" stroke="#b9b29a" stroke-width="2"/>`);
  const cracks = [];
  const cpts = scatter(zones.flats, 30, rnd, .5);
  for (const p of cpts) for (const q of cpts) if (p !== q && q[0] > p[0] && Math.hypot(q[0] - p[0], q[1] - p[1]) < 40) cracks.push(`M${r1(p[0])} ${r1(p[1])}L${r1(q[0])} ${r1(q[1])}`);
  S.push(`<g clip-path="url(#flatclip)"><clipPath id="flatclip"><path d="${pd(zones.flats, true)}"/></clipPath><path d="${cracks.join('')}" stroke="#c8c2ad" stroke-width=".9" fill="none"/></g>`);
  S.push(`<g fill="#f8f7f2" opacity=".8">${scatter(zones.flats, 55, rnd).map(([x, y]) => `<ellipse cx="${r1(x)}" cy="${r1(y)}" rx="${r1(8 + rnd() * 14)}" ry="${r1(4 + rnd() * 6)}"/>`).join('')}</g>`);
  // the fen: tufts and pools
  S.push(`<path d="${pd(zones.marsh, true)}" fill="#a6ae80" opacity=".9"/><path d="${pd(zones.marsh, true)}" fill="url(#tuft)" opacity=".85"/>`);
  S.push(`<g fill="#7fa9b3" stroke="#5b8794" stroke-width=".8">${scatter(zones.marsh, 46, rnd).map(([x, y]) => `<ellipse cx="${r1(x)}" cy="${r1(y)}" rx="${r1(5 + rnd() * 10)}" ry="${r1(3 + rnd() * 5)}"/>`).join('')}</g>`);
  // hills
  const hills = scatter(zones.hills, 42, rnd).sort((a, b) => a[1] - b[1]).map(([x, y]) => { const w = 16 + rnd() * 10; return `<path d="M${r1(x - w)} ${r1(y)}Q${r1(x)} ${r1(y - w * .9)} ${r1(x + w)} ${r1(y)}" fill="#cdbf8c" stroke="#6e5b39" stroke-width="1.4"/><path d="M${r1(x + 2)} ${r1(y - w * .42)}Q${r1(x + w * .55)} ${r1(y - w * .3)} ${r1(x + w * .8)} ${r1(y - 2)}" fill="none" stroke="#8a7650" stroke-width="1"/>`; });
  S.push(hills.join(''));
  // mountains: lit west faces, shaded east faces
  const peaks = scatter(zones.mountains, 52, rnd, .4).sort((a, b) => a[1] - b[1]).map(([x, y]) => {
    const w = 22 + rnd() * 16, h = 34 + rnd() * 30, t = x + (rnd() - .5) * 8;
    return `<path d="M${r1(x - w)} ${r1(y)}L${r1(t)} ${r1(y - h)}L${r1(x + w)} ${r1(y)}Z" fill="#e6dcc0" stroke="#4e3f28" stroke-width="1.6" stroke-linejoin="round"/>` +
      `<path d="M${r1(t)} ${r1(y - h)}L${r1(x + w)} ${r1(y)}L${r1(x + w * .15)} ${r1(y)}L${r1(t + 3)} ${r1(y - h * .55)}Z" fill="#9c8c6c"/>` +
      `<path d="M${r1(t - w * .25)} ${r1(y - h * .62)}L${r1(t)} ${r1(y - h)}L${r1(t + w * .22)} ${r1(y - h * .66)}" fill="#fbfaf6" stroke="none"/>`;
  });
  S.push(peaks.join(''));
  // forest
  const trees = scatter(zones.forest, 19, rnd, .45).sort((a, b) => a[1] - b[1]).map(([x, y]) => {
    const r = 6 + rnd() * 4, g = ['#5f8a4e', '#557f47', '#6a9355', '#4c7442'][(rnd() * 4) | 0];
    return `<circle cx="${r1(x)}" cy="${r1(y - r)}" r="${r1(r)}" fill="${g}" stroke="#2f4a28" stroke-width="1"/><path d="M${r1(x - r * .2)} ${r1(y - r * 1.5)}a${r1(r * .45)} ${r1(r * .45)} 0 0 1 ${r1(r * .7)} ${r1(r * .3)}" stroke="#9cc07f" stroke-width="1.2" fill="none"/>`;
  });
  S.push(trees.join(''));
  // river and brook
  for (const [line, w0] of [[river, 9], [brook, 4]]) {
    S.push(`<path d="${smooth(every(line, 2))}" fill="none" stroke="#e9f2ef" stroke-width="${w0 + 5}" stroke-linecap="round" stroke-linejoin="round" opacity=".7"/>`);
    S.push(`<path d="${smooth(every(line, 2))}" fill="none" stroke="#4d86a5" stroke-width="${w0}" stroke-linecap="round" stroke-linejoin="round"/>`);
  }
  // roads: a light bed with a dark dashed line
  for (const [line, w] of [[saltRoad, 5], [coastRoad, 3.5], [fenTrack, 3]]) {
    const d = smooth(roughen(line, rnd, 2, .05));
    S.push(`<path d="${d}" fill="none" stroke="#f1e8cc" stroke-width="${w + 3}" stroke-linecap="round" opacity=".9"/><path d="${d}" fill="none" stroke="#7a5a35" stroke-width="${w * .5}" stroke-dasharray="${w * 2.4} ${w * 1.2}" stroke-linecap="round"/>`);
  }
  // Gullhaven itself: a huddle of roofs at the river mouth
  const town = [];
  for (const [x, y] of scatter([[660, 590], [720, 585], [745, 640], [712, 690], [668, 672]], 9, rnd, .35)) town.push(`<rect x="${r1(x - 3.5)}" y="${r1(y - 3)}" width="${r1(5 + rnd() * 4)}" height="${r1(4 + rnd() * 3)}" fill="${['#a8604a', '#94705e', '#b8704f'][(rnd() * 3) | 0]}" stroke="#4a3022" stroke-width=".6"/>`);
  S.push(`<path d="M655 582L728 578L752 640L716 698L660 680Z" fill="#cdbf98" stroke="#5a4a32" stroke-width="2.2" stroke-linejoin="round"/>${town.join('')}`);
  S.push('</g>');
  // coastline and cliffs
  S.push(`<path d="${pd(coast)}" fill="none" stroke="#4a3b24" stroke-width="2.4" stroke-linejoin="round"/>`);
  const cliffs = [];
  const north = coast.filter(p => p[1] < 470);
  for (let i = 1; i < north.length - 1; i += 2) {
    const a = north[i - 1], b = north[i + 1], dx = b[0] - a[0], dy = b[1] - a[1], l = Math.hypot(dx, dy) || 1, len = 9 + rnd() * 9;
    const nx = dy / l, ny = -dx / l;   // pointing inland (east of a north–south coast)
    cliffs.push(`M${r1(north[i][0])} ${r1(north[i][1])}l${r1(-nx * len)} ${r1(-ny * len)}`);
  }
  S.push(`<path d="${cliffs.join('')}" stroke="#5a472b" stroke-width="1.5" fill="none" stroke-linecap="round"/>`);
  // compass rose
  const cx = 170, cy = 1120;
  const star = (r, k, rot) => Array.from({ length: k * 2 }, (_, i) => { const a = rot + (i * Math.PI) / k, rr = i % 2 ? r * .22 : r; return [cx + Math.sin(a) * rr, cy - Math.cos(a) * rr]; });
  S.push(`<g><circle cx="${cx}" cy="${cy}" r="86" fill="none" stroke="#e9e1c6" stroke-opacity=".7" stroke-width="2"/><circle cx="${cx}" cy="${cy}" r="76" fill="none" stroke="#e9e1c6" stroke-opacity=".5" stroke-width="1"/>` +
    `<path d="${pd(star(62, 4, Math.PI / 4), true)}" fill="#e9e1c6" opacity=".55"/><path d="${pd(star(96, 4, 0), true)}" fill="#f4eedb" stroke="#3a2e1c" stroke-width="1.2"/>` +
    `<path d="M${cx} ${cy - 96}L${cx + 21} ${cy}L${cx} ${cy}Z M${cx} ${cy + 96}L${cx - 21} ${cy}L${cx} ${cy}Z M${cx + 96} ${cy}L${cx} ${cy + 21}L${cx} ${cy}Z M${cx - 96} ${cy}L${cx} ${cy - 21}L${cx} ${cy}Z" fill="#3a2e1c"/>` +
    `<text x="${cx}" y="${cy - 104}" text-anchor="middle" font-family="Georgia, serif" font-size="30" font-weight="700" fill="#f4eedb">N</text></g>`);
  // paper grain, vignette, frame
  S.push(`<rect width="${RW}" height="${RH}" filter="url(#grain)"/><rect width="${RW}" height="${RH}" fill="url(#vig)"/>`);
  S.push(`<rect x="12" y="12" width="${RW - 24}" height="${RH - 24}" fill="none" stroke="#2f2416" stroke-width="5"/><rect x="22" y="22" width="${RW - 44}" height="${RH - 44}" fill="none" stroke="#2f2416" stroke-width="1.5"/>`);
  S.push('</svg>');
  return { svg: S.join('\n'), coast, saltRoad, coastRoad, fenTrack };
}

/* ---------------- Gullhaven (city, 1600 × 1100) ---------------- */
const CW = 1600, CH = 1100;
function splitPoly(poly, rnd) {
  // cut across the longest edge and the edge facing it
  const n = poly.length;
  let li = 0, ll = -1;
  for (let i = 0; i < n; i++) { const a = poly[i], b = poly[(i + 1) % n], l = Math.hypot(b[0] - a[0], b[1] - a[1]); if (l > ll) { ll = l; li = i; } }
  const oi = (li + Math.floor(n / 2)) % n;
  const t1 = 0.38 + rnd() * 0.24, t2 = 0.38 + rnd() * 0.24;
  const lerp = (a, b, t) => [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t];
  const p1 = lerp(poly[li], poly[(li + 1) % n], t1), p2 = lerp(poly[oi], poly[(oi + 1) % n], 1 - t2);
  const A = [p1], B = [p2];
  for (let i = (li + 1) % n; ; i = (i + 1) % n) { A.push(poly[i]); if (i === oi) break; }
  A.push(p2);
  for (let i = (oi + 1) % n; ; i = (i + 1) % n) { B.push(poly[i]); if (i === li) break; }
  B.push(p1);
  return [A, B];
}
function shrink(poly, d) {
  const c = G.centroid(poly);
  return poly.map(p => { const dx = p[0] - c[0], dy = p[1] - c[1], l = Math.hypot(dx, dy) || 1; return [p[0] - (dx / l) * d, p[1] - (dy / l) * d]; });
}
function subdivide(poly, minArea, rnd, out, depth = 0) {
  if (G.polyArea(poly) < minArea || depth > 14) { out.push(poly); return out; }
  for (const part of splitPoly(poly, rnd)) subdivide(part, minArea, rnd, out, depth + 1);
  return out;
}
const DISTRICTS = {
  keephill: [[395, 320], [560, 190], [690, 240], [700, 470], [440, 500]],
  oldtown: [[705, 240], [1000, 168], [1092, 350], [992, 552], [722, 468]],
  harbourside: [[440, 508], [722, 478], [982, 566], [955, 702], [805, 722], [700, 692], [560, 768], [432, 682]],
  sunken: [[562, 778], [702, 700], [802, 730], [942, 764], [918, 905], [722, 884], [596, 828]],
  saltgate: [[1140, 262], [1228, 256], [1362, 420], [1378, 606], [1062, 600], [1050, 560], [1124, 372]],
  riverside: [[1062, 612], [1378, 620], [1324, 800], [1254, 962], [1002, 950], [982, 762]],
};
function cityMap() {
  const rnd = rng(512);
  const coast = roughen([[-30, 560], [240, 600], [420, 700], [560, 820], [700, 900], [900, 942], [1150, 985], [1400, 1000], [1630, 1010]], rnd, 3, .06);
  const land = [[-30, -30], [CW + 30, -30], [CW + 30, coast[coast.length - 1][1]]].concat(coast.slice().reverse());
  const river = roughen([[1290, -20], [1222, 180], [1120, 360], [1012, 560], [962, 740], [932, 960]], rnd, 3, .05);
  const walls = [[380, 660], [330, 470], [400, 300], [560, 175], [780, 120], [1020, 150], [1230, 250], [1370, 420], [1390, 620], [1330, 800], [1262, 980]];
  const keep = [[488, 300], [650, 292], [668, 432], [500, 446]];
  const market = [[832, 480], [952, 470], [962, 572], [842, 582]];
  const church = [[952, 290], [1060, 290], [1060, 370], [952, 370]];
  const roads = [[[1395, 520], [1200, 560], [1010, 560], [900, 528], [760, 640], [650, 760]], [[668, 148], [760, 300], [880, 480]], [[880, 580], [900, 760], [930, 900]]];
  const S = [];
  S.push(`<svg xmlns="http://www.w3.org/2000/svg" width="${CW}" height="${CH}" viewBox="0 0 ${CW} ${CH}">`);
  S.push(`<defs>
    <linearGradient id="water" x1="0" y1="0" x2=".3" y2="1"><stop offset="0" stop-color="#4f8aa0"/><stop offset="1" stop-color="#2d5d76"/></linearGradient>
    <radialGradient id="vig" cx="50%" cy="50%" r="72%"><stop offset=".62" stop-color="#3b2a14" stop-opacity="0"/><stop offset="1" stop-color="#3b2a14" stop-opacity=".34"/></radialGradient>
    <filter id="grain" x="0" y="0" width="100%" height="100%"><feTurbulence type="fractalNoise" baseFrequency=".9" numOctaves="2" seed="3"/><feColorMatrix values="0 0 0 0 .3  0 0 0 0 .24  0 0 0 0 .16  0 0 0 .14 0"/></filter>
    <pattern id="paving" width="10" height="10" patternUnits="userSpaceOnUse"><rect width="10" height="10" fill="#e4dbc2"/><path d="M0 5h10M5 0v5M0 10h10" stroke="#cfc4a6" stroke-width=".6"/></pattern>
  </defs>`);
  S.push(`<rect width="${CW}" height="${CH}" fill="url(#water)"/>`);
  for (const [w, o] of [[60, .08], [36, .12], [16, .2]]) S.push(`<path d="${pd(coast)}" fill="none" stroke="#eaf4f4" stroke-opacity="${o}" stroke-width="${w}"/>`);
  S.push(`<path d="${pd(land, true)}" fill="#ddd4b5"/>`);
  // fields and orchards outside the walls
  const fieldZone = [[40, 40], [1560, 40], [1560, 940], [1420, 960], [1400, 420], [1250, 230], [1020, 120], [760, 80], [520, 130], [360, 260], [290, 480], [60, 520]];
  const fcol = ['#cbc58f', '#c1bd84', '#d3c897', '#b7b67a', '#c6b884'];
  const fparts = subdivide(fieldZone, 9000, rnd, []);
  S.push(`<g stroke="#9c8f60" stroke-width=".8">${fparts.map(p => `<path d="${pd(shrink(p, 3), true)}" fill="${fcol[(rnd() * fcol.length) | 0]}"/>`).join('')}</g>`);
  // inside the walls: a paler ground, the river through it, then blocks of houses
  S.push(`<path d="${pd(walls.concat(coast.filter(p => p[0] > 380 && p[0] < 1262).reverse()), true)}" fill="#e2d9bf"/>`);
  S.push(`<path d="${smooth(river)}" fill="none" stroke="#e7efe9" stroke-width="40" stroke-linecap="butt" opacity=".6"/><path d="${smooth(river)}" fill="none" stroke="#4c86a3" stroke-width="28" stroke-linecap="butt"/>`);
  const roofs = ['#b5654a', '#a85b44', '#c07655', '#8f6a5a', '#9a7b66', '#7d6f6b', '#b46f52'];
  const blocks = [];
  const avoid = [keep, market, church];
  for (const [k, poly] of Object.entries(DISTRICTS)) {
    const lots = subdivide(poly, k === 'sunken' ? 1700 : 2300, rnd, []);
    for (const lot of lots) {
      const c = G.centroid(lot);
      if (avoid.some(a => G.inPoly(c[0], c[1], a))) continue;
      if (G.nearestEdge(c[0], c[1], river).d < 26) continue;
      if (k === 'sunken' && rnd() < .28) { blocks.push(`<path d="${pd(shrink(lot, 6), true)}" fill="#6f9cab" stroke="#4f7d8c" stroke-width="1"/>`); continue; }
      const inner = shrink(lot, 5);
      for (const house of subdivide(inner, 420 + rnd() * 300, rnd, [])) blocks.push(`<path d="${pd(shrink(house, .7), true)}" fill="${roofs[(rnd() * roofs.length) | 0]}" stroke="#5a3a2a" stroke-width=".8"/>`);
    }
  }
  S.push(`<g>${blocks.join('')}</g>`);
  // market square, church, keep
  S.push(`<path d="${pd(market, true)}" fill="url(#paving)" stroke="#8a7a5a" stroke-width="1.5"/><circle cx="897" cy="526" r="9" fill="#7fa9b3" stroke="#4f6f78" stroke-width="2"/>`);
  S.push(`<path d="M960 318h40v-24h24v24h32v28h-32v20h-24v-20h-40z" fill="#56677a" stroke="#2c3642" stroke-width="2"/><circle cx="1012" cy="330" r="7" fill="#c9b36a" stroke="#2c3642" stroke-width="1.5"/>`);
  S.push(`<path d="${pd(keep, true)}" fill="#cfc7ad" stroke="#3a3128" stroke-width="7" stroke-linejoin="round"/><rect x="532" y="330" width="62" height="62" fill="#6b625a" stroke="#2b2520" stroke-width="2.5"/><circle cx="626" cy="320" r="13" fill="#7a7068" stroke="#2b2520" stroke-width="2.5"/>`);
  for (const p of keep) S.push(`<circle cx="${p[0]}" cy="${p[1]}" r="10" fill="#8a8076" stroke="#2b2520" stroke-width="2"/>`);
  // main streets (paved, cut through the blocks) and bridges
  for (const r of roads) S.push(`<path d="${smooth(r)}" fill="none" stroke="#7d6b4c" stroke-width="15" stroke-linecap="round" stroke-linejoin="round"/><path d="${smooth(r)}" fill="none" stroke="#e8dfc6" stroke-width="11" stroke-linecap="round" stroke-linejoin="round"/>`);
  S.push(`<path d="M997 548h34v26h-34z M948 868h32v24h-32z" fill="#b7a98a" stroke="#5a4a32" stroke-width="2"/>`);
  // the salt road beyond Saltgate, with a straggle of houses
  S.push(`<path d="${smooth([[1395, 520], [1480, 512], [1610, 498]])}" fill="none" stroke="#f1e8cc" stroke-width="12"/><path d="${smooth([[1395, 520], [1480, 512], [1610, 498]])}" fill="none" stroke="#7a5a35" stroke-width="3" stroke-dasharray="9 5"/>`);
  for (let i = 0; i < 14; i++) { const x = 1420 + rnd() * 170, y = 470 + rnd() * 80; if (Math.abs(y - 512) < 12) continue; S.push(`<rect x="${r1(x)}" y="${r1(y)}" width="${r1(10 + rnd() * 10)}" height="${r1(8 + rnd() * 8)}" fill="${roofs[(rnd() * roofs.length) | 0]}" stroke="#5a3a2a" stroke-width=".8"/>`); }
  // walls with towers and gates
  S.push(`<path d="${pd(walls)}" fill="none" stroke="#3a3128" stroke-width="12" stroke-linejoin="round" stroke-linecap="round"/><path d="${pd(walls)}" fill="none" stroke="#a69a82" stroke-width="5" stroke-linejoin="round"/>`);
  const towers = [];
  for (let i = 0; i < walls.length; i++) { towers.push(walls[i]); if (i < walls.length - 1) towers.push([(walls[i][0] + walls[i + 1][0]) / 2, (walls[i][1] + walls[i + 1][1]) / 2]); }
  S.push(towers.map(p => `<circle cx="${r1(p[0])}" cy="${r1(p[1])}" r="13" fill="#8f8574" stroke="#2f2820" stroke-width="3"/>`).join(''));
  S.push(`<rect x="1376" y="500" width="32" height="40" rx="4" fill="#6f665a" stroke="#2f2820" stroke-width="3"/><rect x="650" y="128" width="40" height="30" rx="4" fill="#6f665a" stroke="#2f2820" stroke-width="3" transform="rotate(-14 670 143)"/>`);
  // harbour: moles, chain, jetties, boats
  const moles = [[[430, 690], [330, 820], [300, 905]], [[600, 845], [565, 960], [540, 1032]], [[795, 928], [818, 1040], [826, 1092]]];
  for (const m of moles) S.push(`<path d="${smooth(m)}" fill="none" stroke="#2f2b28" stroke-width="22" stroke-linecap="round"/><path d="${smooth(m)}" fill="none" stroke="#5d5853" stroke-width="15" stroke-linecap="round"/>`);
  S.push(`<path d="M300 905L540 1032" stroke="#1d1a17" stroke-width="4" stroke-dasharray="7 4"/><circle cx="300" cy="905" r="15" fill="#8f8574" stroke="#2f2820" stroke-width="3"/><circle cx="540" cy="1032" r="15" fill="#8f8574" stroke="#2f2820" stroke-width="3"/>`);
  const jetties = [];
  for (let i = 0; i < 9; i++) { const t = .1 + i * .095, a = G.along(coast, .18 + t * .5); jetties.push(`<rect x="-4" y="0" width="8" height="${r1(26 + rnd() * 20)}" fill="#8b6a46" stroke="#4a3624" stroke-width="1" transform="translate(${r1(a.x)} ${r1(a.y)}) rotate(${r1(a.angle * 57.3 - 90 + 180)})"/>`); }
  S.push(jetties.join(''));
  const boats = [[420, 880, 20], [470, 960, -30], [640, 1000, 70], [380, 990, 10], [700, 1060, 40], [250, 760, -50], [150, 900, 15]];
  S.push(boats.map(([x, y, a]) => `<g transform="translate(${x} ${y}) rotate(${a})"><path d="M-14 0Q0 -9 14 0Q0 9 -14 0Z" fill="#7a5233" stroke="#3a2614" stroke-width="1.2"/><path d="M-2 -1L6 -12L6 0Z" fill="#f2ead2" stroke="#6b5a40" stroke-width=".8"/></g>`).join(''));
  // trees on the slopes outside the walls
  const trees = scatter([[60, 300], [330, 260], [300, 520], [80, 540]], 26, rnd).concat(scatter([[1420, 600], [1580, 600], [1580, 940], [1420, 960]], 30, rnd));
  S.push(trees.map(([x, y]) => `<circle cx="${r1(x)}" cy="${r1(y)}" r="${r1(7 + rnd() * 4)}" fill="#6b9258" stroke="#36502c" stroke-width="1"/>`).join(''));
  S.push(`<path d="${pd(coast)}" fill="none" stroke="#3d3123" stroke-width="2.5"/>`);
  S.push(`<rect width="${CW}" height="${CH}" filter="url(#grain)"/><rect width="${CW}" height="${CH}" fill="url(#vig)"/>`);
  S.push(`<rect x="10" y="10" width="${CW - 20}" height="${CH - 20}" fill="none" stroke="#2f2416" stroke-width="4"/><rect x="19" y="19" width="${CW - 38}" height="${CH - 38}" fill="none" stroke="#2f2416" stroke-width="1.2"/>`);
  S.push('</svg>');
  return { svg: S.join('\n'), walls, river };
}

/* ---------------- the planet (equirectangular, 2048 × 1024) ---------------- */
const PW = 2048, PH = 1024;
const ll = (lon, lat) => [((lon + 180) / 360) * PW, ((90 - lat) / 180) * PH];
const LANDS = {
  halveth: [[-38, 50], [-34, 58], [-24, 64], [-5, 68], [25, 66], [50, 61], [63, 50], [57, 37], [38, 27], [14, 23], [-6, 28], [-20, 35], [-31, 41], [-37, 45]],
  sunder: [[18, -10], [44, -6], [70, -14], [88, -30], [80, -46], [60, -53], [40, -47], [28, -35], [16, -22]],
  ember: [[98, 34], [122, 40], [150, 36], [168, 20], [164, -2], [146, -18], [124, -16], [110, -4], [100, 14]],
  tallow: [[-122, 42], [-104, 46], [-86, 38], [-80, 22], [-92, 10], [-110, 14], [-124, 28]],
  thornholm: [[-150, -20], [-128, -14], [-118, -30], [-132, -44], [-152, -38]],
};
const ISLES = [[-60, 30, 4], [-55, 22, 3], [-48, 14, 2.5], [-160, 10, 3], [80, 8, 3.5], [92, -8, 3], [176, -36, 4], [-8, -30, 3.5], [-2, -40, 2.5], [130, 55, 4], [-70, -60, 3]];
function planetMap() {
  const rnd = rng(2202);
  const lands = Object.fromEntries(Object.entries(LANDS).map(([k, pts]) => [k, roughen(pts.map(p => ll(p[0], p[1])), rnd, 5, .2, true)]));
  const isles = ISLES.map(([lon, lat, r]) => roughen(Array.from({ length: 7 }, (_, i) => ll(lon + Math.cos(i / 7 * 6.283) * r / Math.cos(lat * Math.PI / 180), lat + Math.sin(i / 7 * 6.283) * r * .8)), rnd, 4, .2, true));
  // ice caps: only the ragged edge is roughened (a roughened straight closing edge would make wedges)
  const capEdge = (y0, spread) => roughen(Array.from({ length: 25 }, (_, i) => [PW + 10 - i * (PW + 20) / 24, y0 + (rnd() - .5) * spread]), rnd, 3, .12);
  const north = [[-10, -10], [PW + 10, -10]].concat(capEdge(72, 40));
  const south = [[-10, PH + 10], [PW + 10, PH + 10]].concat(capEdge(PH - 105, 50));
  const allLand = Object.values(lands).concat(isles);
  const landD = allLand.map(p => pd(p, true)).join('');
  const band = (lat0, lat1, c, o) => { const y0 = ll(0, lat0)[1], y1 = ll(0, lat1)[1]; return `<rect x="0" y="${r1(Math.min(y0, y1))}" width="${PW}" height="${r1(Math.abs(y1 - y0))}" fill="${c}" opacity="${o}"/>`; };
  const ranges = [[[-28, 60], [-18, 52], [-12, 44], [-16, 36]], [[20, 60], [34, 52], [48, 44]], [[52, -20], [62, -32], [70, -42]], [[130, 30], [140, 16], [152, 4]], [[-110, 40], [-102, 28], [-98, 16]]].map(r => r.map(p => ll(p[0], p[1])));
  const S = [];
  S.push(`<svg xmlns="http://www.w3.org/2000/svg" width="${PW}" height="${PH}" viewBox="0 0 ${PW} ${PH}">`);
  S.push(`<defs>
    <linearGradient id="ocean" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#355f7c"/><stop offset=".5" stop-color="#2b5a7d"/><stop offset="1" stop-color="#355f7c"/></linearGradient>
    <filter id="blur"><feGaussianBlur stdDeviation="14"/></filter>
    <filter id="grain" x="0" y="0" width="100%" height="100%"><feTurbulence type="fractalNoise" baseFrequency=".75" numOctaves="2" seed="5"/><feColorMatrix values="0 0 0 0 .3  0 0 0 0 .26  0 0 0 0 .2  0 0 0 .12 0"/></filter>
    <clipPath id="land"><path d="${landD}"/></clipPath>
  </defs>`);
  S.push(`<rect width="${PW}" height="${PH}" fill="url(#ocean)"/>`);
  const waves = [];
  for (let i = 0; i < 260; i++) { const x = rnd() * PW, y = 80 + rnd() * (PH - 180); waves.push(`M${r1(x)} ${r1(y)}q6 -5 12 0t12 0`); }
  S.push(`<path d="${waves.join('')}" stroke="#cfe4ee" stroke-opacity=".22" stroke-width="1.4" fill="none"/>`);
  for (const [w, o] of [[44, .07], [26, .12], [12, .2]]) S.push(`<path d="${landD}" fill="none" stroke="#e6f2f4" stroke-opacity="${o}" stroke-width="${w}" stroke-linejoin="round"/>`);
  S.push(`<path d="${landD}" fill="#cfc292"/>`);
  // climate belts under the land: forest at the equator, deserts in the horse latitudes, cool forest north and south
  S.push(`<g clip-path="url(#land)"><g filter="url(#blur)">${band(14, -14, '#7fa262', .75)}${band(32, 18, '#e0c88e', .7)}${band(-18, -32, '#e0c88e', .7)}${band(56, 38, '#9fb576', .6)}${band(-38, -56, '#9fb576', .6)}${band(72, 56, '#8a9d80', .7)}${band(-56, -72, '#8a9d80', .7)}</g>`);
  for (const r of ranges) {
    S.push(`<path d="${smooth(r)}" fill="none" stroke="#9c8f70" stroke-width="26" stroke-linecap="round" opacity=".55" filter="url(#blur)"/>`);
    const line = roughen(r, rnd, 3, .05);
    const peaks = Array.from({ length: 13 }, (_, i) => { const a = G.along(line, i / 12), off = (rnd() - .5) * 16; return { x: a.x - Math.sin(a.angle) * off, y: a.y + Math.cos(a.angle) * off }; }).sort((p, q) => p.y - q.y);
    for (const a of peaks) { const w = 9 + rnd() * 6, h2 = 13 + rnd() * 10; S.push(`<path d="M${r1(a.x - w)} ${r1(a.y + 4)}L${r1(a.x)} ${r1(a.y + 4 - h2)}L${r1(a.x + w)} ${r1(a.y + 4)}Z" fill="#e7dcc0" stroke="#5a4a32" stroke-width="1.1"/><path d="M${r1(a.x)} ${r1(a.y + 4 - h2)}L${r1(a.x + w)} ${r1(a.y + 4)}L${r1(a.x + 2)} ${r1(a.y + 4)}Z" fill="#9c8c6c"/>`); }
  }
  S.push('</g>');
  for (const p of allLand) S.push(`<path d="${pd(p, true)}" fill="none" stroke="#4a3b24" stroke-width="1.6" stroke-linejoin="round"/>`);
  // the poles
  S.push(`<path d="${pd(north, true)}" fill="#eef3f5" stroke="#b8c6cc" stroke-width="1.5"/><path d="${pd(south, true)}" fill="#eef3f5" stroke="#b8c6cc" stroke-width="1.5"/>`);
  S.push(`<rect width="${PW}" height="${PH}" filter="url(#grain)"/>`);
  S.push('</svg>');
  return { svg: S.join('\n'), lands };
}

/* ---------------- the sample hook ---------------- */
function build(ctx, S) {
  const C = ctx.core, W = S.worldId;
  const cal = S.cal || C.calendarFor(W);
  // a world date from an Age-of-Tides year (negative = before the Flood), with a fallback for other calendars
  const MONTHS = ['thaw', 'brine', 'gullsong', 'highsun', 'saltreap', 'ember', 'fogmoon', 'gale', 'frostmere', 'deepwinter'];
  const at = S.at || ((y, m, d) => {
    const eras = cal.cal.eras, abs = eras.length ? (y > 0 ? eras[eras.length - 1].start + y - 1 : eras[eras.length - 1].start + y) : y;
    const mi = m == null ? 0 : Math.max(0, MONTHS.indexOf(m));
    return { day: cal.fromYmd(abs, mi, d || 1), min: null, prec: d ? 'day' : m ? 'month' : 'year' };
  });
  const e = k => S.e(k);
  // the maps themselves (created here if the core sample did not)
  const mapType = S.type('map');
  if (!mapType) return;
  if (!e('mapsaltmarch')) S.set('mapsaltmarch', C.createEntry({ worldId: W, typeKey: 'map', title: 'The Saltmarch', fields: { kind: 'Region' } }).id);
  if (!e('mapgullhaven')) S.set('mapgullhaven', C.createEntry({ worldId: W, typeKey: 'map', title: 'Gullhaven', fields: { kind: 'City' }, parentId: e('mapsaltmarch') }).id);
  const store = (name, svg) => (ctx.media && ctx.media.store ? ctx.media.store(W, name, Buffer.from(svg), 'image/svg+xml', { tags: ['map'] }) : null);
  const R = regionMap(), Cm = cityMap();
  const imgR = store('saltmarch.svg', R.svg), imgC = store('gullhaven.svg', Cm.svg);
  if (imgR) S.set('media:saltmarch', imgR.id);
  if (imgC) S.set('media:gullhaven', imgC.id);
  const layersRegion = [
    { id: 'political', name: 'Borders', visible: true }, { id: 'settlements', name: 'Places', visible: true }, { id: 'routes', name: 'Roads & sea lanes', visible: true },
    { id: 'history', name: 'History', visible: true }, { id: 'physical', name: 'Land & sea names', visible: true },
  ];
  C.updateEntry(e('mapsaltmarch'), { data: { image: imgR && imgR.id, width: RW, height: RH, projection: 'flat', unit: 'miles', unitsPerPx: 0.055, grid: { type: 'none', size: 90 }, layers: layersRegion, travel: [] } });
  C.updateEntry(e('mapgullhaven'), { data: { image: imgC && imgC.id, width: CW, height: CH, projection: 'flat', unit: 'ft', unitsPerPx: 3.5, grid: { type: 'none', size: 60 },
    layers: [{ id: 'political', name: 'Districts', visible: true }, { id: 'settlements', name: 'Landmarks', visible: true }, { id: 'routes', name: 'Streets', visible: true }, { id: 'physical', name: 'Names', visible: true }], travel: [] } });
  // faction colours, when nobody chose any
  const colour = (k, c) => { const id = e(k); if (!id) return; const f = C.full(id); if (!f.fields.colors) C.updateEntry(id, { fieldsPatch: { colors: c } }); };
  colour('housevey', '#2f7fb0'); colour('crown', '#c0503c'); colour('gulls', '#7a6bb0'); colour('saltwardens', '#9a8a5c'); colour('drownedchurch', '#3f8f8a');
  let warEnd = at(1188, 'ember', 30);
  if (e('saltwar')) { const w = C.full(e('saltwar')); if (w.end) warEnd = w.end; }
  const tidewellFell = at(102, 'gale', 14);

  const M = e('mapsaltmarch'), CM = e('mapgullhaven');
  const items = [];
  const pin = (mapId, k, x, y, icon, o = {}) => { if (o.always || e(k) || o.label) items.push(Object.assign({ mapId, kind: 'pin', entryId: e(k) || null, x, y, style: Object.assign({ icon }, o.style || {}), layer: o.layer || 'settlements' }, o.extra || {}, o.label ? { label: o.label } : {})); };
  const label = (mapId, text, x, y, style, layer = 'physical', k) => items.push({ mapId, kind: 'label', label: text, entryId: k ? e(k) : null, x, y, style, layer });
  // region map: places
  pin(M, 'gullhaven', 668, 628, 'port', { style: { size: 1.35 }, extra: { subMapId: CM } });
  // drowned places stay on the map as ruins (their own dates, not the entry's "fell" date)
  pin(M, 'tidewell', 432, 902, 'ruin', { style: { color: '#4f8aa0' }, extra: { start: at(-212), note: 'Under the water since the Drowning; its bell tower breaks the surface at spring tides.' } });
  pin(M, 'greyflats', 1190, 818, 'mine');
  pin(M, 'lanternrock', 334, 552, 'tower');
  pin(M, 'mirefen', 880, 1108, 'village');
  pin(M, 'stormspire', 456, 238, 'ruin', { extra: { start: at(-400), note: 'A drowned tower off the point since the Flood.' } });
  pin(M, 'inlandcrown', 1948, 700, 'capital', { style: { size: 1.2 } });
  pin(M, 'saltwardens', 1268, 930, 'camp');
  pin(M, 'encwyrm', 1400, 880, 'monster', { layer: 'history' });
  pin(M, 'tidecrown', 452, 930, 'treasure', { style: { size: .8 }, layer: 'history' });
  // events where they happened (they appear from their date on)
  pin(M, 'flood', 560, 470, 'storm', { layer: 'history' });
  pin(M, 'drowningtidewell', 400, 870, 'storm', { layer: 'history' });
  pin(M, 'saltwar', 1330, 740, 'battle', { layer: 'history' });
  pin(M, 'storm1203', 500, 300, 'storm', { layer: 'history' });
  // names of land and sea
  label(M, 'Storm Sea', 230, 760, { size: 46, italic: true, color: '#e8f1f2', angle: -8 });
  label(M, 'The Grey Teeth', 1690, 250, { size: 30, italic: true, color: '#4a3b24', caps: true });
  label(M, 'Hollowmere Wood', 1215, 470, { size: 22, italic: true, color: '#2f4a28' });
  label(M, 'The Fen', 900, 1230, { size: 26, italic: true, color: '#3f4a2e', caps: true });
  label(M, 'Gullwater', 760, 598, { size: 15, italic: true, color: '#2f5f7a', angle: -4 });
  label(M, 'Storm Point', 560, 272, { size: 16, italic: true, color: '#4a3b24', angle: -28 });
  // roads and sea lanes
  const path = (mapId, pts, o) => items.push(Object.assign({ mapId, kind: 'path', points: pts, layer: 'routes' }, o));
  path(M, R.saltRoad.slice(0, -1).concat([[1948, 700]]), { label: 'The Salt Road', style: { kind: 'road', mode: 'cart', color: '#9a5f2a', width: 3 } });
  path(M, R.coastRoad, { label: 'Coast Road', style: { kind: 'road', mode: 'walk', color: '#9a5f2a', width: 2 } });
  path(M, R.fenTrack, { label: 'Fen Track', style: { kind: 'track', mode: 'walk', color: '#7b6a3a', width: 2, dashed: true } });
  path(M, [[650, 632], [560, 640], [450, 600], [356, 566]], { label: 'Lantern Run', style: { kind: 'sea', mode: 'ship', color: '#e6f2f5', width: 2, dashed: true } });
  path(M, [[640, 650], [520, 760], [470, 880]], { label: 'Tidewell Wrecks', style: { kind: 'sea', mode: 'ship', color: '#e6f2f5', width: 2, dashed: true } });
  // borders through time: the coast (from the drawn coastline) + an inland line
  const coastLine = every(R.coast.filter(p => p[1] >= -30 && p[1] <= RH + 30).map(p => [Math.max(0, Math.min(RW, p[0])), Math.max(0, Math.min(RH, p[1]))]), 3);
  const coastBetween = (y0, y1) => { const s = sliceByY(coastLine, y0, y1); return s.length ? s : coastLine; };
  const westOf = (inland) => coastBetween(0, RH).concat(inland);   // coast top→bottom, then the inland line bottom→top
  const veyMarch = [[1250, RH], [1350, 1080], [1500, 950], [1560, 760], [1480, 520], [1380, 300], [1300, 0]];
  const veyAfter = [[1150, RH], [1080, 1080], [990, 900], [1000, 760], [1080, 620], [1180, 420], [1300, 0]];
  const east = line => [[RW, 0], [RW, RH]].concat(line);   // the land east of an inland line (given bottom → top)
  const region = (k, pts, o) => { if (e(k) || o.label) items.push(Object.assign({ mapId: M, kind: 'region', entryId: e(k) || null, points: pts, layer: 'political' }, o)); };
  const north = coastBetween(0, 760);
  region('housevey', north.concat([[850, 760], [1000, 650], [1100, 420], [1150, 0]]), { start: at(13), end: tidewellFell, note: 'The first Vey lands: the north shore and the harbour.', style: { fill: .22 } });
  const south = coastBetween(760, RH);
  region('tidewell', south.concat([[1100, RH], [1150, 1050], [1000, 900], [850, 770], [south[0][0], south[0][1]]]).filter((p, i, a) => i === 0 || p[0] !== a[i - 1][0] || p[1] !== a[i - 1][1]),
    { label: 'Kingdom of Tidewell', start: at(-212), end: tidewellFell, note: 'Tidewell\'s realm until the sea took it.', style: { color: '#8a6bbf', fill: .22 } });
  region('housevey', westOf(veyMarch), { start: tidewellFell, end: warEnd, note: 'After Tidewell drowned, House Vey held the whole coast and the flats.', style: { fill: .22 } });
  region('housevey', westOf(veyAfter), { start: warEnd, note: 'The Salt War cost House Vey the eastern pans.', style: { fill: .22 } });
  region('crown', east(veyMarch), { start: at(612), end: warEnd, style: { fill: .2 } });
  region('crown', east(veyAfter), { start: warEnd, note: 'The eastern flats, taken in the Salt War.', style: { fill: .2 } });
  // city map
  const district = (k, poly, o) => items.push(Object.assign({ mapId: CM, kind: 'region', entryId: k ? e(k) : null, points: poly, layer: 'political' }, o));
  district(null, DISTRICTS.keephill, { label: 'Keep Hill', style: { color: '#2f7fb0', fill: .16 } });
  district(null, DISTRICTS.oldtown, { label: 'Old Town', style: { color: '#c08a3c', fill: .14 } });
  district('harbour', DISTRICTS.harbourside, { label: e('harbour') ? '' : 'Harbourside', style: { color: '#3f8f8a', fill: .15 } });
  district('sunkenmarket', DISTRICTS.sunken, { label: e('sunkenmarket') ? '' : 'The Sunken Market', style: { color: '#7a6bb0', fill: .18 } });
  district(null, DISTRICTS.saltgate, { label: 'Saltgate', style: { color: '#c0503c', fill: .14 } });
  district(null, DISTRICTS.riverside, { label: 'Riverside', style: { color: '#5fb38a', fill: .14 } });
  pin(CM, 'veykeep', 562, 362, 'castle', { style: { size: 1.25 } });
  pin(CM, 'drownedchurch', 1008, 330, 'temple');
  pin(CM, 'gulls', 742, 812, 'treasure');
  pin(CM, 'foundinggull', 897, 526, 'star', { layer: 'physical' });
  pin(CM, 'halloran', 300, 905, 'tower', { style: { size: .9 } });
  pin(CM, 'wedding', 610, 410, 'star', { style: { size: .8 }, layer: 'physical' });
  pin(CM, null, 1392, 520, 'gate', { label: 'Saltgate', always: true });
  pin(CM, null, 670, 143, 'gate', { label: 'Northgate', always: true });
  pin(CM, 'harbour', 420, 960, 'port');
  label(CM, 'Market Square', 897, 560, { size: 14, italic: true, color: '#3a2e1c' });
  label(CM, 'Gull Water', 1150, 300, { size: 18, italic: true, color: '#e9f2f4', angle: -62 });
  label(CM, 'the Harbour Chain', 410, 990, { size: 13, italic: true, color: '#e9f2f4', angle: 28 });
  label(CM, 'Gullwater Bay', 210, 820, { size: 28, italic: true, color: '#e9f2f4', angle: 12 });
  const streets = (pts, text) => items.push({ mapId: CM, kind: 'path', label: text, points: pts, layer: 'routes', style: { kind: 'street', mode: 'walk', color: '#a0762f', width: 2 } });
  streets([[1395, 520], [1200, 560], [1010, 560], [900, 528], [760, 640], [650, 760]], 'Salt Street');
  streets([[668, 148], [760, 300], [880, 480]], 'Bell Lane');

  // the whole planet, with the Saltmarch as a pin that opens the region map: planet → region → city
  const Pm = planetMap(), imgP = store('wide-world.svg', Pm.svg);
  const planet = C.createEntry({ worldId: W, typeKey: 'map', title: 'The Wide World', summary: 'The whole planet: five continents, two ice caps and a great deal of sea.', fields: { kind: 'World' },
    data: { image: imgP && imgP.id, width: PW, height: PH, projection: 'equirectangular', planet: { radiusKm: 6100 }, unit: 'miles', grid: { type: 'none', size: 64 },
      layers: [{ id: 'political', name: 'Realms', visible: true }, { id: 'settlements', name: 'Places', visible: true }, { id: 'physical', name: 'Names', visible: true }], travel: [] } });
  S.set('mapworld', planet.id);
  if (imgP) S.set('media:wideworld', imgP.id);
  C.updateEntry(M, { parentId: planet.id });
  const P2 = planet.id, at2 = (lon, lat) => ll(lon, lat);
  const geo = pts => pts.map(p => at2(p[0], p[1]));
  items.push({ mapId: P2, kind: 'pin', entryId: e('saltmarch'), label: e('saltmarch') ? '' : 'The Saltmarch', x: at2(-35.4, 48)[0], y: at2(-35.4, 48)[1], subMapId: M, style: { icon: 'flag', size: 1.2 }, layer: 'settlements' });
  if (e('inlandcrown')) items.push({ mapId: P2, kind: 'pin', entryId: e('inlandcrown'), x: at2(-27, 49.5)[0], y: at2(-27, 49.5)[1], style: { icon: 'capital' }, layer: 'settlements' });
  if (e('crown')) items.push({ mapId: P2, kind: 'region', entryId: e('crown'), points: geo([[-34, 54.5], [-20, 57.5], [-8, 52], [-6, 42], [-18, 38], [-30, 40.5], [-33.6, 45.5]]), start: at(-640), layer: 'political', style: { fill: .22 } });
  if (e('housevey')) items.push({ mapId: P2, kind: 'region', entryId: e('housevey'), points: geo([[-37.6, 51.5], [-34, 54.5], [-33.6, 45.5], [-37, 44.6]]), start: at(13), layer: 'political', style: { fill: .3 } });
  const name = (text, lon, lat, style) => { const [x, y] = at2(lon, lat); items.push({ mapId: P2, kind: 'label', label: text, x, y, style, layer: 'physical' }); };
  name('Halveth', 18, 50, { size: 34, caps: true, color: '#3a2e1c' });
  name('Sunder', 52, -30, { size: 30, caps: true, color: '#3a2e1c' });
  name('The Ember Reach', 134, 14, { size: 26, caps: true, color: '#3a2e1c' });
  name('Tallow Isles', -103, 30, { size: 20, caps: true, color: '#3a2e1c' });
  name('Thornholm', -136, -29, { size: 18, caps: true, color: '#3a2e1c' });
  name('The Grey Ocean', -72, 2, { size: 40, italic: true, color: '#e8f1f2' });
  name('Sea of Lanterns', 72, 16, { size: 30, italic: true, color: '#e8f1f2' });
  name('Storm Sea', -50, 46, { size: 22, italic: true, color: '#e8f1f2' });
  for (const it of items) ctx.atlas.save(it);
}

module.exports = { build, regionMap, cityMap, planetMap, rng, roughen };
