/* Atlas geometry, shared by the main process and the renderer: point-in-polygon, areas (flat and on a sphere),
   great-circle distances, label points, map units, travel times and the dated-item rule.
   UMD: window.WBGeo in the renderer (loaded on demand), module.exports in the main process. */
(function (root, factory) {
  const api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  else root.WBGeo = api;
})(typeof self !== 'undefined' ? self : this, function () {
  'use strict';
  const D2R = Math.PI / 180, R2D = 180 / Math.PI;

  /* ---------------- units ---------------- */
  const UNITS = {
    miles: { short: 'mi', name: 'miles', km: 1.609344 },
    km: { short: 'km', name: 'kilometres', km: 1 },
    leagues: { short: 'lea', name: 'leagues', km: 4.828032 },
    m: { short: 'm', name: 'metres', km: 0.001 },
    ft: { short: 'ft', name: 'feet', km: 0.0003048 },
  };
  const unitKey = u => (UNITS[u] ? u : { mi: 'miles', mile: 'miles', kilometres: 'km', kilometers: 'km', league: 'leagues', meters: 'm', metres: 'm', feet: 'ft', foot: 'ft' }[String(u || '').toLowerCase()] || 'miles');
  const toKm = (v, u) => v * UNITS[unitKey(u)].km;
  const fromKm = (km, u) => km / UNITS[unitKey(u)].km;
  const convert = (v, from, to) => fromKm(toKm(v, from), to);

  /* travel speeds: distance per travelling day (miles) and hours on the road per day */
  const TRAVEL = [
    { mode: 'walk', label: 'On foot', icon: '🚶', perDay: 20, hours: 8 },
    { mode: 'horse', label: 'Horse', icon: '🐎', perDay: 30, hours: 8 },
    { mode: 'cart', label: 'Cart', icon: '🛒', perDay: 18, hours: 8 },
    { mode: 'ship', label: 'Ship', icon: '⛵', perDay: 100, hours: 24 },
  ];
  /** travel modes in the map's unit: map data travel ([{mode, perDay}] in map units) → world settings → defaults (miles) */
  function travelModes(data, worldSettings) {
    const unit = unitKey(data && data.unit);
    const base = TRAVEL.map(t => Object.assign({}, t, { perDay: convert(t.perDay, 'miles', unit) }));
    const fromWorld = worldSettings && Array.isArray(worldSettings.travel) ? worldSettings.travel : null;
    const own = data && Array.isArray(data.travel) && data.travel.length ? data.travel : null;
    const merge = (list, srcUnit) => {
      for (const t of list || []) {
        if (!t || !t.mode || !(+t.perDay > 0)) continue;
        const v = srcUnit ? convert(+t.perDay, t.unit || srcUnit, unit) : +t.perDay;
        const ex = base.find(b => b.mode === t.mode);
        if (ex) { ex.perDay = v; if (t.label) ex.label = t.label; if (+t.hours > 0) ex.hours = +t.hours; }
        else base.push({ mode: t.mode, label: t.label || t.mode, icon: t.icon || '→', perDay: v, hours: +t.hours > 0 ? +t.hours : 8 });
      }
    };
    merge(fromWorld, 'miles');
    merge(own, null);
    return base;
  }
  /** "3 days 4 h", "5 h 20 min", "25 min" — sub-day parts use the mode's hours on the road per day */
  function fmtDuration(days, hoursPerDay = 8) {
    if (!isFinite(days) || days <= 0) return '—';
    if (days >= 1) {
      const d = Math.floor(days), h = Math.round((days - d) * hoursPerDay);
      if (d >= 30) return Math.round(days) + ' days';
      return d + (d === 1 ? ' day' : ' days') + (h ? ' ' + h + ' h' : '');
    }
    const mins = days * hoursPerDay * 60;
    if (mins < 60) return Math.max(1, Math.round(mins)) + ' min';
    const h = Math.floor(mins / 60), m = Math.round(mins - h * 60);
    return h + ' h' + (m ? ' ' + m + ' min' : '');
  }
  /** 1234.5 → "1,235", 3.21 → "3.2", 0.042 → "0.042" */
  function fmtNum(v) {
    if (!isFinite(v)) return '—';
    const a = Math.abs(v);
    const d = a >= 100 ? 0 : a >= 10 ? 1 : a >= 1 ? 2 : 3;
    return v.toLocaleString(undefined, { maximumFractionDigits: d });
  }
  /** an area in a readable unit: acres and square miles for feet, hectares and km² for metres */
  function fmtArea(v, unit) {
    if (v == null || !isFinite(v)) return '—';
    const u = unitKey(unit);
    if (u === 'ft') return v >= 27878400 ? fmtNum(v / 27878400) + ' mi²' : v >= 43560 ? fmtNum(v / 43560) + ' acres' : fmtNum(v) + ' ft²';
    if (u === 'm') return v >= 1e6 ? fmtNum(v / 1e6) + ' km²' : v >= 1e4 ? fmtNum(v / 1e4) + ' ha' : fmtNum(v) + ' m²';
    return fmtNum(v) + ' ' + UNITS[u].short + '²';
  }
  /** the nicest round number at or below v (1, 2, 5 × 10^n) */
  function niceFloor(v) {
    if (!(v > 0)) return 0;
    const p = Math.pow(10, Math.floor(Math.log10(v))), m = v / p;
    return (m >= 5 ? 5 : m >= 2 ? 2 : 1) * p;
  }

  /* ---------------- map data ---------------- */
  const LAYERS = [
    { id: 'political', name: 'Political', visible: true },
    { id: 'settlements', name: 'Settlements', visible: true },
    { id: 'routes', name: 'Routes', visible: true },
    { id: 'physical', name: 'Physical', visible: true },
    { id: 'notes', name: 'Notes', visible: true },
  ];
  const KIND_LAYER = { region: 'political', pin: 'settlements', path: 'routes', label: 'physical' };
  /** map entry data with defaults filled in */
  function mapData(d, worldSettings) {
    d = Object.assign({}, d || {});
    const out = Object.assign({}, d);
    out.image = d.image || null;
    out.width = Math.max(16, Math.round(+d.width || 1600));
    out.height = Math.max(16, Math.round(+d.height || 1000));
    out.projection = d.projection === 'equirectangular' ? 'equirectangular' : 'flat';
    out.unit = unitKey(d.unit || (worldSettings && worldSettings.mapUnit) || (out.projection === 'equirectangular' ? 'km' : 'miles'));
    if (out.projection === 'equirectangular') out.planet = { radiusKm: +(d.planet && d.planet.radiusKm) > 0 ? +d.planet.radiusKm : 6371 };
    out.unitsPerPx = +d.unitsPerPx > 0 ? +d.unitsPerPx : null;
    const g = d.grid || {};
    out.grid = { type: ['hex', 'square'].includes(g.type) ? g.type : 'none', size: Math.max(4, +g.size || 64), color: g.color || '', opacity: g.opacity == null ? 0.35 : +g.opacity };
    out.layers = Array.isArray(d.layers) && d.layers.length ? d.layers.filter(l => l && l.id).map(l => ({ id: String(l.id), name: String(l.name || l.id), visible: l.visible !== false })) : LAYERS.map(l => Object.assign({}, l));
    out.travel = Array.isArray(d.travel) ? d.travel : [];
    return out;
  }
  const isPlanet = data => !!data && data.projection === 'equirectangular';
  /** units per image pixel along a parallel at latitude lat (planets) or everywhere (flat maps); null = not calibrated */
  function unitsPerPx(data, lat = 0) {
    if (isPlanet(data)) return fromKm((2 * Math.PI * data.planet.radiusKm) / data.width, data.unit) * Math.cos(lat * D2R);
    return data.unitsPerPx || null;
  }

  /* ---------------- planar geometry ---------------- */
  function inPoly(x, y, pts) {
    let inside = false;
    for (let i = 0, j = pts.length - 1; i < pts.length; j = i++) {
      const xi = pts[i][0], yi = pts[i][1], xj = pts[j][0], yj = pts[j][1];
      if ((yi > y) !== (yj > y) && x < ((xj - xi) * (y - yi)) / (yj - yi) + xi) inside = !inside;
    }
    return inside;
  }
  function signedArea(pts) {
    let s = 0;
    for (let i = 0, j = pts.length - 1; i < pts.length; j = i++) s += (pts[j][0] * pts[i][1]) - (pts[i][0] * pts[j][1]);
    return s / 2;
  }
  const polyArea = pts => Math.abs(signedArea(pts));
  function bbox(pts) {
    let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity;
    for (const p of pts) { if (p[0] < x0) x0 = p[0]; if (p[0] > x1) x1 = p[0]; if (p[1] < y0) y0 = p[1]; if (p[1] > y1) y1 = p[1]; }
    return { x0, y0, x1, y1, w: x1 - x0, h: y1 - y0 };
  }
  function centroid(pts) {
    const a = signedArea(pts);
    if (Math.abs(a) < 1e-9) { const b = bbox(pts); return [(b.x0 + b.x1) / 2, (b.y0 + b.y1) / 2]; }
    let cx = 0, cy = 0;
    for (let i = 0, j = pts.length - 1; i < pts.length; j = i++) {
      const f = pts[j][0] * pts[i][1] - pts[i][0] * pts[j][1];
      cx += (pts[j][0] + pts[i][0]) * f; cy += (pts[j][1] + pts[i][1]) * f;
    }
    return [cx / (6 * a), cy / (6 * a)];
  }
  function segDist(px, py, ax, ay, bx, by) {
    const dx = bx - ax, dy = by - ay, l = dx * dx + dy * dy;
    let t = l ? ((px - ax) * dx + (py - ay) * dy) / l : 0;
    t = Math.max(0, Math.min(1, t));
    const x = ax + t * dx - px, y = ay + t * dy - py;
    return Math.sqrt(x * x + y * y);
  }
  /** shortest distance from a point to a polyline (closed = polygon edge) and the index of the nearest segment */
  function nearestEdge(px, py, pts, closed) {
    let best = Infinity, at = -1;
    const n = pts.length, m = closed ? n : n - 1;
    for (let i = 0; i < m; i++) {
      const a = pts[i], b = pts[(i + 1) % n], d = segDist(px, py, a[0], a[1], b[0], b[1]);
      if (d < best) { best = d; at = i; }
    }
    return { d: best, i: at };
  }
  /** a good place for a region's name: the inside point furthest from its edges (grid search, refined) */
  function labelPoint(pts) {
    if (!pts || pts.length < 3) return pts && pts[0] ? pts[0].slice() : [0, 0];
    const b = bbox(pts);
    let best = null, bestD = -Infinity;
    const tryAt = (x, y) => { if (!inPoly(x, y, pts)) return; const d = nearestEdge(x, y, pts, true).d; if (d > bestD) { bestD = d; best = [x, y]; } };
    let cell = Math.max(b.w, b.h) / 18;
    if (!(cell > 0)) return [b.x0, b.y0];
    for (let x = b.x0 + cell / 2; x < b.x1; x += cell) for (let y = b.y0 + cell / 2; y < b.y1; y += cell) tryAt(x, y);
    if (!best) return centroid(pts);
    for (let k = 0; k < 4; k++) { const c = best.slice(); cell /= 3; for (let dx = -3; dx <= 3; dx++) for (let dy = -3; dy <= 3; dy++) tryAt(c[0] + dx * cell, c[1] + dy * cell); }
    return best;
  }
  function pathLength(pts, closed) {
    let s = 0;
    const n = pts.length, m = closed ? n : n - 1;
    for (let i = 0; i < m; i++) { const a = pts[i], b = pts[(i + 1) % n]; s += Math.hypot(b[0] - a[0], b[1] - a[1]); }
    return s;
  }
  /** Ramer–Douglas–Peucker simplification (freehand strokes) */
  function simplify(pts, tol) {
    if (pts.length < 3) return pts.slice();
    const keep = new Uint8Array(pts.length); keep[0] = keep[pts.length - 1] = 1;
    const stack = [[0, pts.length - 1]];
    while (stack.length) {
      const [a, b] = stack.pop();
      let dmax = 0, idx = -1;
      for (let i = a + 1; i < b; i++) { const d = segDist(pts[i][0], pts[i][1], pts[a][0], pts[a][1], pts[b][0], pts[b][1]); if (d > dmax) { dmax = d; idx = i; } }
      if (dmax > tol && idx > 0) { keep[idx] = 1; stack.push([a, idx], [idx, b]); }
    }
    return pts.filter((p, i) => keep[i]);
  }
  /** point at fraction t (0..1) of a polyline's length, with the direction there */
  function along(pts, t) {
    const total = pathLength(pts);
    let goal = total * Math.max(0, Math.min(1, t));
    for (let i = 0; i < pts.length - 1; i++) {
      const a = pts[i], b = pts[i + 1], l = Math.hypot(b[0] - a[0], b[1] - a[1]);
      if (goal <= l || i === pts.length - 2) { const f = l ? goal / l : 0; return { x: a[0] + (b[0] - a[0]) * f, y: a[1] + (b[1] - a[1]) * f, angle: Math.atan2(b[1] - a[1], b[0] - a[0]) }; }
      goal -= l;
    }
    return { x: pts[0][0], y: pts[0][1], angle: 0 };
  }

  /* ---------------- the sphere (equirectangular images) ---------------- */
  const lonLat = (x, y, w, h) => [(x / w) * 360 - 180, 90 - (y / h) * 180];
  const toXY = (lon, lat, w, h) => [((lon + 180) / 360) * w, ((90 - lat) / 180) * h];
  function haversine(a, b, R) {
    const p1 = a[1] * D2R, p2 = b[1] * D2R, dp = p2 - p1, dl = (b[0] - a[0]) * D2R;
    const s = Math.sin(dp / 2) ** 2 + Math.cos(p1) * Math.cos(p2) * Math.sin(dl / 2) ** 2;
    return 2 * R * Math.asin(Math.min(1, Math.sqrt(s)));
  }
  /** n+1 points along the great circle from a to b ([lon, lat] degrees) */
  function greatCircle(a, b, n = 24) {
    const v = ll => { const p = ll[1] * D2R, l = ll[0] * D2R; return [Math.cos(p) * Math.cos(l), Math.cos(p) * Math.sin(l), Math.sin(p)]; };
    const A = v(a), B = v(b);
    const dot = Math.max(-1, Math.min(1, A[0] * B[0] + A[1] * B[1] + A[2] * B[2])), om = Math.acos(dot);
    if (om < 1e-9) return [a.slice(), b.slice()];
    const out = [];
    for (let i = 0; i <= n; i++) {
      const t = i / n, s1 = Math.sin((1 - t) * om) / Math.sin(om), s2 = Math.sin(t * om) / Math.sin(om);
      const x = s1 * A[0] + s2 * B[0], y = s1 * A[1] + s2 * B[1], z = s1 * A[2] + s2 * B[2];
      out.push([Math.atan2(y, x) * R2D, Math.asin(Math.max(-1, Math.min(1, z))) * R2D]);
    }
    return out;
  }
  /** area on the sphere of a polygon whose edges are straight in longitude/latitude (as drawn on the flat image) */
  function sphereArea(ll, R) {
    let s = 0;
    for (let i = 0; i < ll.length; i++) {
      const a = ll[i], b = ll[(i + 1) % ll.length];
      const l1 = a[0] * D2R, p1 = a[1] * D2R, l2 = b[0] * D2R, p2 = b[1] * D2R, dl = l2 - l1, dp = p2 - p1;
      s += dl * (Math.abs(dp) < 1e-12 ? Math.sin(p1) : (Math.cos(p1) - Math.cos(p2)) / dp);
    }
    return Math.abs(s) * R * R;
  }

  /* ---------------- measuring on a map ---------------- */
  /** length of a polyline in the map's unit (great-circle on planets); null when the map has no scale yet */
  function distance(data, pts) {
    if (!pts || pts.length < 2) return 0;
    if (isPlanet(data)) {
      const R = fromKm(data.planet.radiusKm, data.unit);
      let s = 0;
      for (let i = 0; i < pts.length - 1; i++) s += haversine(lonLat(pts[i][0], pts[i][1], data.width, data.height), lonLat(pts[i + 1][0], pts[i + 1][1], data.width, data.height), R);
      return s;
    }
    return data.unitsPerPx ? pathLength(pts) * data.unitsPerPx : null;
  }
  /** area of a polygon in the map's unit squared (spherical on planets); null without a scale */
  function area(data, pts) {
    if (!pts || pts.length < 3) return 0;
    if (isPlanet(data)) return sphereArea(pts.map(p => lonLat(p[0], p[1], data.width, data.height)), fromKm(data.planet.radiusKm, data.unit));
    return data.unitsPerPx ? polyArea(pts) * data.unitsPerPx * data.unitsPerPx : null;
  }

  /* ---------------- time ---------------- */
  const dayOf = d => (d == null ? null : typeof d === 'number' ? d : d.day == null ? null : +d.day);
  /** dated items live in [start, end): the end date is the first day they are gone */
  function alive(start, end, day) {
    if (day == null) return true;
    const s = dayOf(start), e = dayOf(end);
    return (s == null || s <= day) && (e == null || day < e);
  }

  return {
    UNITS, unitKey, toKm, fromKm, convert, TRAVEL, travelModes, fmtDuration, fmtNum, fmtArea, niceFloor,
    LAYERS, KIND_LAYER, mapData, isPlanet, unitsPerPx,
    inPoly, signedArea, polyArea, bbox, centroid, segDist, nearestEdge, labelPoint, pathLength, simplify, along,
    lonLat, toXY, haversine, greatCircle, sphereArea, distance, area, dayOf, alive, D2R, R2D,
  };
});
