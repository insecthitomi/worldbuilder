/* Atlas globe: an equirectangular map wrapped on a sphere (orthographic projection, canvas 2D). The map image and
   its territories and routes are baked into one texture; pins, names and the latitude/longitude graticule are
   drawn as crisp vectors on top. Drag to spin (with a little inertia), wheel to zoom, double-click to go flat. */
(function (root) {
  'use strict';
  const GK = root.GK, WB = root.WB, h = GK.h;
  const D2R = Math.PI / 180;
  const capture = (el, e) => { try { el.setPointerCapture(e.pointerId); } catch { } };
  const SERIF = "Georgia, 'Palatino Linotype', 'Book Antiqua', Palatino, serif";

  function create(host, o) {
    const V = WB.atlasView, Geo = root.WBGeo;
    const wrap = h('div.wb-at-globe');
    const canvas = h('canvas', { tabindex: 0, 'aria-label': 'Globe' });
    wrap.appendChild(canvas);
    host.appendChild(wrap);
    const g = canvas.getContext('2d');
    const buf = document.createElement('canvas'), bg = buf.getContext('2d');
    let W = 0, H = 0, dpr = 1, ui = 1, dead = false, raf = 0;
    let lon0 = 0, lat0 = 0, zoom = 1, vel = null, dragging = false, hover = null;
    let tex = null, TW = 0, TH = 0;
    const data = () => o.data;

    /* ---------- texture: the image + territories + routes ---------- */
    function bake() {
      const D = data();
      TW = Math.max(1024, Math.min(3072, D.width)); TH = Math.round(TW / 2);
      const c = document.createElement('canvas');
      const v = V.create(c, { day: o.view.opt.day, allTimes: o.view.opt.allTimes, filter: o.view.opt.filter, labels: false, regionLabels: false, graticule: false });
      v.size(TW, TH, 1, Math.max(1, TW / 1800));
      v.setMap(D, o.img);
      v.setItems(o.items().filter(i => i.kind === 'region' || i.kind === 'path'));
      v.t = { k: TW / D.width, x: 0, y: 0 };
      v.render();
      tex = new Uint32Array(c.getContext('2d').getImageData(0, 0, TW, TH).data.buffer);
    }

    /* ---------- projection ---------- */
    const R = () => Math.min(W, H) * .42 * zoom;
    /** lon/lat (degrees) → screen, with visibility (cos c) */
    function project(lon, lat) {
      const l = lon * D2R - lon0, p = lat * D2R, sp = Math.sin(p), cp = Math.cos(p), sl0 = Math.sin(lat0), cl0 = Math.cos(lat0);
      const cosc = sl0 * sp + cl0 * cp * Math.cos(l);
      const x = cp * Math.sin(l), y = cl0 * sp - sl0 * cp * Math.cos(l), r = R();
      return [W / 2 + x * r, H / 2 - y * r, cosc];
    }
    /** screen → lon/lat (degrees) or null off the globe */
    function unproject(sx, sy) {
      const r = R(), x = (sx - W / 2) / r, y = (H / 2 - sy) / r, rr = x * x + y * y;
      if (rr > 1) return null;
      const z = Math.sqrt(1 - rr), sl0 = Math.sin(lat0), cl0 = Math.cos(lat0);
      const lat = Math.asin(Math.max(-1, Math.min(1, z * sl0 + y * cl0)));
      let lon = lon0 + Math.atan2(x, z * cl0 - y * sl0);
      lon = ((lon + Math.PI) % (2 * Math.PI) + 2 * Math.PI) % (2 * Math.PI) - Math.PI;
      return [lon / D2R, lat / D2R];
    }
    const toMap = ll => Geo.toXY(ll[0], ll[1], data().width, data().height);
    const toLL = (x, y) => Geo.lonLat(x, y, data().width, data().height);

    /* ---------- drawing ---------- */
    function measure() {
      const r = canvas.getBoundingClientRect(), d = root.devicePixelRatio || 1;
      const w = Math.max(1, Math.round(r.width)), hh = Math.max(1, Math.round(r.height));
      ui = (parseFloat(getComputedStyle(canvas).fontSize) || 14) * GK.zoomOf(canvas) / 14;
      if (w === W && hh === H && d === dpr) return;
      W = w; H = hh; dpr = d;
      canvas.width = Math.round(W * dpr); canvas.height = Math.round(H * dpr);
      stars = null;
    }
    let stars = null;
    function starfield() {
      if (stars) return stars;
      const c = document.createElement('canvas'); c.width = Math.max(1, Math.round(W)); c.height = Math.max(1, Math.round(H));
      const x = c.getContext('2d');
      let s = 1234567;
      const r = () => ((s = (s * 16807) % 2147483647) / 2147483647);
      for (let i = 0; i < W * H / 2600; i++) { const a = r() * .7 + .1; x.fillStyle = 'rgba(255,255,255,' + a.toFixed(2) + ')'; const z = r() < .08 ? 1.6 : 1; x.fillRect(r() * W, r() * H, z, z); }
      return (stars = c);
    }
    function paintSphere(q, smooth) {
      const bw = Math.max(1, Math.round(W * q)), bh = Math.max(1, Math.round(H * q));
      if (buf.width !== bw || buf.height !== bh) { buf.width = bw; buf.height = bh; }
      const img = bg.createImageData(bw, bh), out = new Uint32Array(img.data.buffer);
      const r = R() * q, cx = bw / 2, cy = bh / 2, sl0 = Math.sin(lat0), cl0 = Math.cos(lat0);
      const y0 = Math.max(0, Math.floor(cy - r)), y1 = Math.min(bh - 1, Math.ceil(cy + r));
      const LX = -.45, LY = .5, LZ = .74;   // light from the upper left, in front
      const twoPi = Math.PI * 2;
      for (let py = y0; py <= y1; py++) {
        const y = (cy - py - .5) / r, yy = y * y;
        if (yy > 1) continue;
        const half = Math.sqrt(1 - yy) * r, x0 = Math.max(0, Math.floor(cx - half)), x1 = Math.min(bw - 1, Math.ceil(cx + half));
        for (let px = x0; px <= x1; px++) {
          const x = (px + .5 - cx) / r, rr = x * x + yy;
          if (rr > 1) continue;
          const z = Math.sqrt(1 - rr);
          const lat = Math.asin(z * sl0 + y * cl0);
          let lon = lon0 + Math.atan2(x, z * cl0 - y * sl0);
          let u = (lon + Math.PI) / twoPi; u -= Math.floor(u);
          const v = (Math.PI / 2 - lat) / Math.PI;
          let cr, cg, cb;
          if (smooth) {
            const fx = u * TW - .5, fy = Math.max(0, Math.min(TH - 1.001, v * TH - .5)), ix = Math.floor(fx), iy = Math.floor(fy), tx = fx - ix, ty = fy - iy;
            const a = tex[iy * TW + ((ix % TW) + TW) % TW], b = tex[iy * TW + (ix + 1) % TW], c = tex[(iy + 1) * TW + ((ix % TW) + TW) % TW], d = tex[(iy + 1) * TW + (ix + 1) % TW];
            const ch = (k) => { const sh = k * 8; return ((a >>> sh) & 255) * (1 - tx) * (1 - ty) + ((b >>> sh) & 255) * tx * (1 - ty) + ((c >>> sh) & 255) * (1 - tx) * ty + ((d >>> sh) & 255) * tx * ty; };
            cr = ch(0); cg = ch(1); cb = ch(2);
          } else {
            const t = tex[Math.min(TH - 1, (v * TH) | 0) * TW + Math.min(TW - 1, (u * TW) | 0)];
            cr = t & 255; cg = (t >>> 8) & 255; cb = (t >>> 16) & 255;
          }
          const l = Math.max(0, x * LX + y * LY + z * LZ);
          const k = .42 + .72 * l + .1 * z;
          out[py * bw + px] = (255 << 24) | (Math.min(255, cb * k) << 16) | (Math.min(255, cg * k) << 8) | Math.min(255, cr * k);
        }
      }
      bg.putImageData(img, 0, 0);
    }
    function render() {
      raf = 0;
      if (dead || !tex) return;
      measure();
      g.setTransform(dpr, 0, 0, dpr, 0, 0);
      g.clearRect(0, 0, W, H);
      g.drawImage(starfield(), 0, 0, W, H);
      const r = R(), cx = W / 2, cy = H / 2;
      // atmosphere
      const glow = g.createRadialGradient(cx, cy, r * .96, cx, cy, r * 1.16);
      glow.addColorStop(0, 'rgba(120,190,255,.45)'); glow.addColorStop(1, 'rgba(120,190,255,0)');
      g.fillStyle = glow; g.beginPath(); g.arc(cx, cy, r * 1.16, 0, Math.PI * 2); g.fill();
      const q = dragging || vel ? .5 : Math.min(1, 1.5 / Math.max(1, dpr * .75));
      paintSphere(dragging || vel ? q : Math.min(1, dpr), !(dragging || vel));
      g.imageSmoothingEnabled = true; g.imageSmoothingQuality = 'high';
      g.save(); g.beginPath(); g.arc(cx, cy, r, 0, Math.PI * 2); g.clip();
      g.drawImage(buf, 0, 0, W, H);
      // terminator softness at the rim
      const rim = g.createRadialGradient(cx, cy, r * .75, cx, cy, r);
      rim.addColorStop(0, 'rgba(0,0,0,0)'); rim.addColorStop(1, 'rgba(0,8,20,.35)');
      g.fillStyle = rim; g.fillRect(cx - r, cy - r, r * 2, r * 2);
      graticule();
      g.restore();
      g.beginPath(); g.arc(cx, cy, r, 0, Math.PI * 2); g.lineWidth = 1; g.strokeStyle = 'rgba(180,220,255,.5)'; g.stroke();
      names();
      pins();
    }
    const draw = () => { if (!raf) raf = requestAnimationFrame(render); };
    function graticule() {
      g.lineWidth = 1; g.strokeStyle = 'rgba(255,255,255,.28)';
      const seg = (pts) => { let on = false; g.beginPath(); for (const [lon, lat] of pts) { const [x, y, c] = project(lon, lat); if (c > 0) { if (on) g.lineTo(x, y); else g.moveTo(x, y); on = true; } else on = false; } g.stroke(); };
      for (let lat = -75; lat <= 75; lat += 15) { const pts = []; for (let lon = -180; lon <= 180; lon += 3) pts.push([lon, lat]); if (lat === 0) { g.save(); g.strokeStyle = 'rgba(255,255,255,.55)'; g.setLineDash([6, 4]); seg(pts); g.restore(); } else seg(pts); }
      for (let lon = -180; lon < 180; lon += 15) { const pts = []; for (let lat = -90; lat <= 90; lat += 3) pts.push([lon, lat]); seg(pts); }
    }
    const shown = () => o.items().filter(it => o.view.visible(it));
    function names() {
      const k = R() * 2 * Math.PI / data().width;   // screen px per map px at the centre
      g.save(); g.textAlign = 'center'; g.textBaseline = 'middle'; g.lineJoin = 'round';
      for (const it of shown()) {
        if (it.kind === 'region' && !it.style.hideLabel && it.points.length > 2) {
          const lp = Geo.labelPoint(it.points), [x, y, c] = project(...toLL(lp[0], lp[1]));
          if (c < .2) continue;
          const size = Math.max(9, Math.min(26 * ui, Math.sqrt(Geo.polyArea(it.points)) * k / 10)) * Math.sqrt(c);
          if (size < 9) continue;
          g.globalAlpha = Math.min(1, (c - .2) * 3);
          g.font = '600 ' + size + 'px ' + SERIF;
          try { g.letterSpacing = (size * .12) + 'px'; } catch { }
          const t = V.titleOf(it).toUpperCase();
          g.lineWidth = 3; g.strokeStyle = 'rgba(250,246,234,.75)'; g.strokeText(t, x, y);
          g.fillStyle = V.mix(V.colorOf(it), 'black', .45); g.fillText(t, x, y);
        } else if (it.kind === 'label' && (it.label || it.entry)) {
          const [x, y, c] = project(...toLL(it.x, it.y));
          if (c < .25) continue;
          const size = (it.style.size || 18) * k * Math.sqrt(c);
          if (size < 8) continue;
          g.globalAlpha = Math.min(1, (c - .25) * 3);
          g.font = (it.style.italic ? 'italic ' : '') + '600 ' + Math.min(size, 90) + 'px ' + SERIF;
          try { g.letterSpacing = '0px'; } catch { }
          const t = it.style.caps ? (it.label || it.entry.title).toUpperCase() : it.label || it.entry.title;
          g.lineWidth = 3; g.strokeStyle = 'rgba(10,20,30,.45)'; g.strokeText(t, x, y);
          g.fillStyle = it.style.color || '#f4efe2'; g.fillText(t, x, y);
        }
      }
      g.restore();
    }
    let pinPos = [];
    function pins() {
      pinPos = [];
      const list = shown().filter(i => i.kind === 'pin').sort((a, b) => (b.style.size || 1) - (a.style.size || 1));
      const boxes = [];
      g.save();
      for (const it of list) {
        const [x, y, c] = project(...toLL(it.x, it.y));
        if (c < .05) continue;
        const sel = o.view.opt.selected === it.id, hov = hover === it.id;
        const r = 9.5 * ui * (it.style.size || 1) * (hov ? 1.12 : 1) * (.65 + .35 * c);
        g.globalAlpha = Math.min(1, c * 4);
        if (sel) { g.beginPath(); g.arc(x, y, r + 4.5 * ui, 0, Math.PI * 2); g.fillStyle = 'rgba(255,255,255,.4)'; g.fill(); }
        g.shadowColor = 'rgba(0,0,0,.5)'; g.shadowBlur = 5;
        g.beginPath(); g.arc(x, y, r, 0, Math.PI * 2); g.fillStyle = V.colorOf(it); g.fill();
        g.shadowColor = 'transparent';
        g.lineWidth = 1.5; g.strokeStyle = '#fff'; g.stroke();
        const s = r * 1.25 / 24, icon = V.iconOf(it);
        g.save(); g.translate(x - 12 * s, y - 12 * s); g.scale(s, s); g.fillStyle = '#fff'; g.fill(WB.atlasIcons.path(icon), WB.atlasIcons.rule(icon)); g.restore();
        boxes.push({ x0: x - r, x1: x + r, y0: y - r, y1: y + r });
        if (!it.style.hideLabel && c > .35) {
          const size = 11.5 * ui, t = V.titleOf(it);
          g.font = '600 ' + size + 'px ' + SERIF;
          const tw = g.measureText(t).width, box = { x0: x - tw / 2 - 2, x1: x + tw / 2 + 2, y0: y + r + 2, y1: y + r + 4 + size };
          if (sel || hov || !boxes.some(b => !(box.x1 < b.x0 || box.x0 > b.x1 || box.y1 < b.y0 || box.y0 > b.y1))) {
            boxes.push(box);
            g.textAlign = 'center'; g.textBaseline = 'top'; g.lineJoin = 'round';
            g.lineWidth = 3; g.strokeStyle = 'rgba(10,16,24,.7)'; g.strokeText(t, x, y + r + 2);
            g.fillStyle = '#fff'; g.fillText(t, x, y + r + 2);
          }
        }
        pinPos.push([it, x, y, r]);
      }
      g.restore();
    }

    /* ---------- interaction ---------- */
    const pt = e => { const b = canvas.getBoundingClientRect(); const ox = b.left, oy = b.top; return [e.clientX - ox, e.clientY - oy]; };   // the globe's own screen-px space
    const pinAt = (sx, sy) => { for (let i = pinPos.length - 1; i >= 0; i--) { const [it, x, y, r] = pinPos[i]; if (Math.hypot(x - sx, y - sy) <= r + 3) return it; } return null; };
    function itemAt(sx, sy) {
      const p = pinAt(sx, sy);
      if (p) return p;
      const ll = unproject(sx, sy);
      if (!ll) return null;
      const [mx, my] = toMap(ll);
      let best = null;
      for (const it of shown()) if (it.kind === 'region' && it.points.length > 2 && Geo.inPoly(mx, my, it.points)) { const a = Geo.polyArea(it.points); if (!best || a < best.a) best = { it, a }; }
      return best && best.it;
    }
    let down = null;
    canvas.addEventListener('pointerdown', e => {
      if (e.button !== 0) return;
      const [sx, sy] = pt(e);
      down = { sx, sy, x: sx, y: sy, t: performance.now(), moved: false };
      vel = null; dragging = true;
      capture(canvas, e); canvas.classList.add('dragging');
      canvas.focus();
    });
    canvas.addEventListener('pointermove', e => {
      const [sx, sy] = pt(e);
      if (down) {
        const dx = sx - down.x, dy = sy - down.y, r = R();
        if (Math.hypot(sx - down.sx, sy - down.sy) > 3) down.moved = true;
        lon0 -= dx / r; lat0 = Math.max(-1.45, Math.min(1.45, lat0 + dy / r));
        const now = performance.now(), dt = Math.max(1, now - down.t);
        down.v = [-dx / r / dt, dy / r / dt]; down.t = now; down.x = sx; down.y = sy;
        draw();
        return;
      }
      const ll = unproject(sx, sy);
      o.onCoords && o.onCoords(ll ? Math.abs(ll[1]).toFixed(2) + '°' + (ll[1] >= 0 ? 'N' : 'S') + '  ' + Math.abs(ll[0]).toFixed(2) + '°' + (ll[0] >= 0 ? 'E' : 'W') : '');
      const p = pinAt(sx, sy), id = p ? p.id : null;
      canvas.style.cursor = p ? 'pointer' : '';
      canvas.title = p ? V.titleOf(p) : '';
      if (id !== hover) { hover = id; draw(); }
    });
    const up = e => {
      if (!down) return;
      const d = down; down = null; dragging = false; canvas.classList.remove('dragging');
      if (d.moved && d.v && Math.hypot(d.v[0], d.v[1]) > .0004) { vel = d.v.map(x => x * 16); spin(); }
      else draw();
      if (!d.moved && e) { const [sx, sy] = pt(e); const it = itemAt(sx, sy); if (it) o.onPick && o.onPick(it, e); }
    };
    canvas.addEventListener('pointerup', up);
    canvas.addEventListener('pointercancel', () => { down = null; dragging = false; draw(); });
    function spin() {
      if (!vel || dead) return;
      lon0 += vel[0]; lat0 = Math.max(-1.45, Math.min(1.45, lat0 + vel[1]));
      vel = vel.map(x => x * .93);
      if (Math.hypot(vel[0], vel[1]) < .0006) { vel = null; draw(); return; }
      render();
      requestAnimationFrame(spin);
    }
    canvas.addEventListener('wheel', e => { e.preventDefault(); zoom = Math.max(.5, Math.min(12, zoom * Math.exp(-e.deltaY * .0016))); draw(); }, { passive: false });
    canvas.addEventListener('dblclick', e => {
      const [sx, sy] = pt(e);
      const p = pinAt(sx, sy);
      if (p) return o.onOpen && o.onOpen(p);
      const ll = unproject(sx, sy);
      if (ll && o.onFlat) { const [mx, my] = toMap(ll); o.onFlat(mx, my); }
    });
    canvas.addEventListener('keydown', e => {
      const st = .12 / zoom;
      if (e.key === 'ArrowLeft') lon0 -= st; else if (e.key === 'ArrowRight') lon0 += st;
      else if (e.key === 'ArrowUp') lat0 = Math.min(1.45, lat0 + st); else if (e.key === 'ArrowDown') lat0 = Math.max(-1.45, lat0 - st);
      else return;
      e.preventDefault(); draw();
    });
    const offLayout = GK.bus.on('layout', () => { measure(); draw(); });
    const ro = new ResizeObserver(() => { measure(); draw(); });
    ro.observe(canvas);

    // start looking at the selected item, else the first pin, else 0°/0°
    const first = o.items().find(i => i.id === o.view.opt.selected) || o.items().find(i => i.kind === 'pin' && o.view.visible(i));
    if (first) { const ll = toLL(first.x, first.y); lon0 = ll[0] * D2R; lat0 = Math.max(-1.2, Math.min(1.2, ll[1] * D2R * .8)); }
    measure(); bake(); render();
    const rebake = WB.debounce(() => { if (!dead) { bake(); draw(); } }, 120);
    return {
      el: wrap,
      refresh() { rebake(); draw(); },
      zoom(f) { zoom = Math.max(.5, Math.min(12, zoom * f)); draw(); },
      reset() { zoom = 1; draw(); },
      lookAt(mx, my) { const ll = toLL(mx, my); lon0 = ll[0] * D2R; lat0 = ll[1] * D2R; draw(); },
      state: () => ({ lon0, lat0, zoom }),
      destroy() { dead = true; if (raf) cancelAnimationFrame(raf); ro.disconnect(); offLayout(); wrap.remove(); },
    };
  }

  WB.atlasGlobe = { create };
})(window);
