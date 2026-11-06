/* Atlas labels that follow a curve: a name set along a drawn path, or on an arc (bend slider). The text is laid out
   letter by letter along the smoothed line, always reading left to right. Used by the view for labels with
   `points` or a `curve` style. */
(function (root) {
  'use strict';
  const WB = root.WB;

  /** lay `text` along a screen polyline; returns false when the line is too short to hold it */
  function along(g, text, pts, size, spacing) {
    if (pts.length < 2) return false;
    if (pts[pts.length - 1][0] < pts[0][0]) pts = pts.slice().reverse();
    const cum = [0];
    for (let i = 1; i < pts.length; i++) cum.push(cum[i - 1] + Math.hypot(pts[i][0] - pts[i - 1][0], pts[i][1] - pts[i - 1][1]));
    const total = cum[cum.length - 1], chars = [...text], widths = chars.map(c => g.measureText(c).width + spacing);
    const need = widths.reduce((a, b) => a + b, 0) - spacing;
    if (total < need * .6) return false;
    let at = (total - need) / 2, seg = 1;
    const pose = s => {
      while (seg < cum.length - 1 && cum[seg] < s) seg++;
      const a = pts[seg - 1], b = pts[seg], L = cum[seg] - cum[seg - 1] || 1, t = Math.max(0, Math.min(1, (s - cum[seg - 1]) / L));
      return [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t, Math.atan2(b[1] - a[1], b[0] - a[0])];
    };
    for (let i = 0; i < chars.length; i++) {
      const s = Math.max(0, Math.min(total, at + widths[i] / 2 - spacing / 2)), [x, y, ang] = pose(s);
      g.save(); g.translate(x, y); g.rotate(ang);
      if (g.lineWidth > 0 && g.strokeStyle) g.strokeText(chars[i], 0, 0);
      g.fillText(chars[i], 0, 0);
      g.restore();
      at += widths[i];
    }
    return true;
  }
  function style(g, v, it, o, size) {
    const st = it.style, c = st.color || '#2b2116', light = o.lum(c) > .6;
    g.font = (st.italic ? 'italic ' : '') + '600 ' + Math.min(size, 160 * v.ui) + 'px ' + o.SERIF;
    g.textAlign = 'center'; g.textBaseline = 'middle'; g.lineJoin = 'round';
    g.lineWidth = Math.max(2, size * .16); g.strokeStyle = light ? 'rgba(20,30,40,.45)' : 'rgba(250,246,234,.7)'; g.fillStyle = c;
    return st.caps ? (size * .16) : size * .04;
  }
  /** a label with drawn points: smoothed, then lettered along the line */
  function drawAlong(v, it, o) {
    const g = v.g, st = it.style, size = (st.size || 18) * v.t.k;
    if (size < 6 * v.ui) return;
    const raw = it.label || (it.entry && it.entry.title) || '';
    if (!raw) return;
    const text = st.caps ? raw.toUpperCase() : raw, pts = root.WBField.chaikin(it.points.map(p => v.toScreen(p[0], p[1])), 2);
    g.save();
    if (o.faded) g.globalAlpha = .4;
    const sp = style(g, v, it, o, size);
    along(g, text, pts, size, sp);
    if (v.opt.selected === it.id || v.opt.hover === it.id) { g.beginPath(); pts.forEach((p, i) => (i ? g.lineTo(p[0], p[1]) : g.moveTo(p[0], p[1]))); g.setLineDash([4, 3]); g.lineWidth = 1.2; g.strokeStyle = 'rgba(255,255,255,.8)'; g.stroke(); }
    g.restore();
  }
  /** a single label bent on an arc: style.curve in -100..100 (sign = which way it bows) */
  function drawArc(v, it, o) {
    const g = v.g, st = it.style, size = (st.size || 18) * v.t.k;
    if (size < 6 * v.ui) return;
    const raw = it.label || (it.entry && it.entry.title) || '';
    if (!raw) return;
    const text = st.caps ? raw.toUpperCase() : raw, [x, y] = v.toScreen(it.x, it.y);
    if (x < -600 || y < -300 || x > v.w + 600 || y > v.h + 300) return;
    g.save();
    if (o.faded) g.globalAlpha = .4;
    const sp = style(g, v, it, o, size), L = Math.max(size * 2, g.measureText(text).width + sp * text.length), bend = (st.curve || 0) / 100, sag = bend * L * .45;
    const a = (st.angle || 0) * Math.PI / 180, cs = Math.cos(a), sn = Math.sin(a), pts = [];
    for (let k = 0; k <= 28; k++) {
      const t = k / 28, px = (t - .5) * L * 1.15, py = -4 * sag * t * (1 - t) * 1 + 0;
      pts.push([x + px * cs - py * sn, y + px * sn + py * cs]);
    }
    along(g, text, pts, size, sp);
    if (v.opt.selected === it.id || v.opt.hover === it.id) { g.beginPath(); pts.forEach((p, i) => (i ? g.lineTo(p[0], p[1]) : g.moveTo(p[0], p[1]))); g.setLineDash([4, 3]); g.lineWidth = 1.2; g.strokeStyle = 'rgba(255,255,255,.8)'; g.stroke(); }
    g.restore();
  }
  WB.atlasLabels = { drawAlong, drawArc };
})(window);
