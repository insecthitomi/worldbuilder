/* ========================================================================== */
/* AeroLens 1.0 — dropped in VERBATIM from the AeroLens UI Kit (MIT).          */
/* ========================================================================== */
/*!
 * AeroLens 1.0 — edge-only liquid-glass refraction for the web.
 * Zero dependencies. One file. MIT.
 *
 * WHAT IT DOES
 *   Gives panels, cards, buttons — any element — a physical "glass" look:
 *   the backdrop bends (refracts) in a thin band at the element's edge while
 *   the interior stays optically flat and readable. Circular elements can get
 *   a full spherical ball-lens instead (great for decorative bubbles).
 *
 * HOW (Chromium path)
 *   A displacement map is drawn on a hidden canvas: neutral (128,128) in the
 *   interior, inward-normal displacement with a smoothstep convex profile in
 *   the edge band. It feeds an SVG filter chain —
 *     feGaussianBlur (frost) → feImage(map) → feDisplacementMap → feColorMatrix
 *   — referenced via `backdrop-filter: url(#…)`, which Chromium re-samples
 *   from the LIVE backdrop every composited frame. Content moving behind the
 *   glass genuinely warps through the rim. Filters are cached by quantized
 *   geometry (kind|w|h|radius bucket), so 200 identical cards share ONE filter.
 *
 * FALLBACK (WebKit / Firefox — e.g. Tauri on macOS & Linux)
 *   `backdrop-filter: url()` is Chromium-only. Elsewhere AeroLens degrades to
 *   a pure-CSS glass treatment: plain backdrop blur + a layered inset-shadow
 *   "lip" that reads as the same design language at near-zero GPU cost. The
 *   fallback is automatic; force it with { mode: 'css' }.
 *
 * PERFORMANCE MODEL
 *   No per-frame JavaScript. Maps are built once per geometry bucket (interior
 *   pixels are skipped entirely — only the edge band is computed), rebuilt only
 *   on element resize (single debounced ResizeObserver) or option changes
 *   (in-place filter rewrites; ids never change, so nothing ever flashes).
 *   A debounced MutationObserver lenses new elements; mutations inside
 *   [data-aerolens-editor] subtrees are ignored so typing costs nothing.
 *
 * USAGE
 *   <script src="aerolens.js"><\/script>
 *   AeroLens.init({
 *     targets: ['.glass', '.card', '#toolbar'],   // edge lenses
 *     sphereTargets: ['.bubble'],                 // ball lenses (circular)
 *     strength: 30,                               // 6..70 displacement px
 *     frost: 9,                                   // gaussian blur sigma (px)
 *     saturate: 1.35,
 *     auto: true,                                 // MutationObserver sweeps
 *   });
 *   AeroLens.set({ strength: 44 });   // live retune, flash-free
 *   AeroLens.destroy();               // full cleanup
 *
 * Opt-out per element: data-aerolens="off"
 * Mark editors (skip their internal mutations): data-aerolens-editor
 */
(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory();
  else root.AeroLens = factory();
}(typeof self !== 'undefined' ? self : this, function () {
  'use strict';

  const OPT = {
    targets: [],
    sphereTargets: [],
    strength: 30,
    frost: 9,
    saturate: 1.35,
    minSize: 18,          // skip elements smaller than this
    maxFrac: 0.42,        // suite addition: skip elements covering > this fraction of the viewport (huge backdrop-filters murder FPS)
    sphereMax: 10,        // cap simultaneous sphere lenses (largest win)
    sphereStrength: null, // suite addition: bubble refraction on its own scale (6..260); null = strength × 1.15
    sphereMag: 0,         // suite addition: 0 = ring lens (rim bends, centre clear) … 1 = full magnifier
    bandScale: 1,         // suite addition: width of the refracting rim on panels (0.2 … 2)
    chroma: 0,            // suite addition: prism dispersion at the rim, 0 = none … 1 = strong rainbow fringe
    auto: true,
    mode: 'auto',         // 'auto' | 'chromium' | 'css'
  };

  const S = { defs: null, cache: new Map(), seq: 0, ro: null, mo: null, sweepT: 0, active: false, mode: 'chromium' };

  /* ── capability: SVG reference backdrop-filters are Chromium-only ───────── */
  function detectMode() {
    if (OPT.mode !== 'auto') return OPT.mode;
    const isChromium = !!(typeof window !== 'undefined' && (window.chrome ||
      /Chrom(e|ium)|Edg\//.test(navigator.userAgent))) && !/Firefox/.test(navigator.userAgent);
    return isChromium ? 'chromium' : 'css';
  }

  /* ── displacement maps ──────────────────────────────────────────────────── */
  // suite addition: maps are drawn at the device pixel ratio, so the displacement is as sharp as the screen
  function mapScale() { return Math.max(1, Math.min(3, (typeof window !== 'undefined' && window.devicePixelRatio) || 1)); }

  // Edge map: neutral interior; inside a thin band at the rounded-rect edge,
  // pixels shift along the inward normal with a smoothstep convex profile.
  function edgeMap(w, h, r, band) {
    try {
      const SC = mapScale();   // suite: full device resolution (was 0.5): a half-res map blurs and steps the rim
      const cw = Math.max(2, Math.round(w * SC)), ch = Math.max(2, Math.round(h * SC));
      const c = document.createElement('canvas'); c.width = cw; c.height = ch;
      const g = c.getContext('2d'); if (!g) return null;
      const img = g.createImageData(cw, ch); const d = img.data;
      new Uint32Array(d.buffer).fill(0xFF808080);            // neutral prefill, one pass
      const rr = Math.max(2, r * SC), bb = Math.max(1.5, band * SC);
      const hw = cw / 2, hh = ch / 2;
      const margin = Math.ceil(bb + rr) + 1;
      for (let y = 0; y < ch; y++) {
        const nearY = y < margin || y >= ch - margin;
        for (let x = 0; x < cw; x++) {
          if (!nearY && x >= margin && x < cw - margin) { x = cw - margin - 1; continue; } // hop interior
          const px = Math.abs(x + 0.5 - hw) - (hw - rr);
          const py = Math.abs(y + 0.5 - hh) - (hh - rr);
          const qx = Math.max(px, 0), qy = Math.max(py, 0);
          const inside = rr - (Math.hypot(qx, qy) + Math.min(Math.max(px, py), 0));
          if (inside >= 0 && inside < bb) {
            const t = 1 - inside / bb;
            const st = 0.45 * t * t * (3 - 2 * t) + 0.55 * (1 - Math.sqrt(Math.max(0, 1 - t * t)));
            let nx, ny;
            if (qx > 0 || qy > 0) { const l = Math.hypot(qx, qy) || 1; nx = (qx / l) * Math.sign(x + 0.5 - hw); ny = (qy / l) * Math.sign(y + 0.5 - hh); }
            else if (px > py) { nx = Math.sign(x + 0.5 - hw); ny = 0; }
            else { nx = 0; ny = Math.sign(y + 0.5 - hh); }
            const i = (y * cw + x) * 4;
            d[i] = 128 - nx * st * 127; d[i + 1] = 128 - ny * st * 127;
          }
        }
      }
      g.putImageData(img, 0, 0);
      return c.toDataURL();
    } catch (e) { return null; }
  }

  // Sphere map: ball-lens optics — zero displacement at dead center (magnifier
  // core), peak at ~0.707·R with a t·√(1−t²) profile, fading to the rim,
  // always pulling the backdrop toward center.
  function sphereMap(size) {
    try {
      const SC = mapScale();
      const cs = Math.max(4, Math.round(size * SC));
      const c = document.createElement('canvas'); c.width = cs; c.height = cs;
      const g = c.getContext('2d'); if (!g) return null;
      const img = g.createImageData(cs, cs); const d = img.data;
      new Uint32Array(d.buffer).fill(0xFF808080);
      const R = cs / 2;
      for (let y = 0; y < cs; y++) for (let x = 0; x < cs; x++) {
        const ox = x + 0.5 - R, oy = y + 0.5 - R;
        const t = Math.hypot(ox, oy) / R;
        if (t < 1 && t > 0) {
          // suite addition: blend the ring profile with a magnifier (linear pull toward the centre, eased off at the rim)
          const m = Math.max(0, Math.min(1, OPT.sphereMag || 0));
          const prof = (1 - m) * t * Math.sqrt(Math.max(0, 1 - t * t)) * 2 + m * Math.min(1, t * 1.3) * (1 - Math.pow(t, 10));
          const i = (y * cs + x) * 4;
          d[i] = 128 - (ox / (t * R)) * prof * 127;
          d[i + 1] = 128 - (oy / (t * R)) * prof * 127;
        }
      }
      g.putImageData(img, 0, 0);
      return c.toDataURL();
    } catch (e) { return null; }
  }

  /* ── shared filters ─────────────────────────────────────────────────────── */
  function defs() {
    if (!S.defs) {
      const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
      svg.setAttribute('width', '0'); svg.setAttribute('height', '0');
      svg.setAttribute('data-aerolens-defs', '');
      svg.style.cssText = 'position:fixed;left:-9999px;top:0;pointer-events:none';
      document.body.appendChild(svg);
      S.defs = svg;
    }
    return S.defs;
  }

  function buildInto(filter, kind, w, h, r) {
    const NS = 'http://www.w3.org/2000/svg';
    filter.innerHTML = '';
    const strength = Math.max(6, Math.min(70, OPT.strength));
    const small = Math.min(w, h);
    const scale = kind === 'sphere' ? (OPT.sphereStrength != null ? Math.max(6, Math.min(260, OPT.sphereStrength)) : strength * 1.15)
      : strength * Math.max(0.45, Math.min(1, small / 90));  // gentler on small elements
    const frost = kind === 'sphere' ? 0 : Math.max(0, OPT.frost);
    let last = 'SourceGraphic';
    if (frost > 0) {
      const blur = document.createElementNS(NS, 'feGaussianBlur');
      blur.setAttribute('in', last); blur.setAttribute('stdDeviation', String(frost)); blur.setAttribute('result', 'frost');
      filter.appendChild(blur); last = 'frost';
    }
    const band = Math.max(1.5, Math.min(48, Math.min(28, small * 0.2) * (OPT.bandScale == null ? 1 : OPT.bandScale)));
    const url = kind === 'sphere' ? sphereMap(w) : edgeMap(w, h, r, band);
    if (url) {
      // anywhere the map doesn't reach reads as neutral (no bend), not as a 15px up-left shove
      const flood = document.createElementNS(NS, 'feFlood');
      flood.setAttribute('flood-color', '#808080'); flood.setAttribute('result', 'neutral');
      filter.appendChild(flood);
      const im = document.createElementNS(NS, 'feImage');
      im.setAttribute('href', url);
      im.setAttributeNS('http://www.w3.org/1999/xlink', 'xlink:href', url);
      im.setAttribute('x', '0'); im.setAttribute('y', '0');
      im.setAttribute('width', String(w)); im.setAttribute('height', String(h));
      im.setAttribute('preserveAspectRatio', 'none'); im.setAttribute('result', 'map0');
      filter.appendChild(im);
      const over = document.createElementNS(NS, 'feComposite');
      over.setAttribute('in', 'map0'); over.setAttribute('in2', 'neutral'); over.setAttribute('operator', 'over'); over.setAttribute('result', 'map');
      filter.appendChild(over);
      const ch = kind === 'sphere' ? 0 : Math.max(0, Math.min(1, OPT.chroma || 0));
      const bend = (sc, res) => {
        const disp = document.createElementNS(NS, 'feDisplacementMap');
        disp.setAttribute('in', last); disp.setAttribute('in2', 'map');
        disp.setAttribute('scale', String(sc));
        disp.setAttribute('xChannelSelector', 'R'); disp.setAttribute('yChannelSelector', 'G');
        disp.setAttribute('result', res);
        filter.appendChild(disp);
      };
      if (ch > 0) {
        // suite addition: prism — red, green and blue bend by slightly different amounts, so the rim splits into a
        // rainbow fringe like real thick glass; the flat interior (zero displacement) stays perfectly clear
        const spread = 0.16 * ch;
        [['R', 1 + spread, '1 0 0 0 0  0 0 0 0 0  0 0 0 0 0  0 0 0 1 0'], ['G', 1, '0 0 0 0 0  0 1 0 0 0  0 0 0 0 0  0 0 0 1 0'], ['B', 1 - spread, '0 0 0 0 0  0 0 0 0 0  0 0 1 0 0  0 0 0 1 0']].forEach((q) => {
          bend(scale * q[1], 'b' + q[0]);
          const m = document.createElementNS(NS, 'feColorMatrix');
          m.setAttribute('in', 'b' + q[0]); m.setAttribute('type', 'matrix'); m.setAttribute('values', q[2]); m.setAttribute('result', 'c' + q[0]);
          filter.appendChild(m);
        });
        const add = (a, b, res) => { const c = document.createElementNS(NS, 'feComposite'); c.setAttribute('in', a); c.setAttribute('in2', b); c.setAttribute('operator', 'arithmetic'); c.setAttribute('k1', '0'); c.setAttribute('k2', '1'); c.setAttribute('k3', '1'); c.setAttribute('k4', '0'); c.setAttribute('result', res); filter.appendChild(c); };
        add('cR', 'cG', 'cRG'); add('cRG', 'cB', 'bent');
      } else bend(scale, 'bent');
      last = 'bent';
    }
    if (kind !== 'sphere') {
      const sat = document.createElementNS(NS, 'feColorMatrix');
      sat.setAttribute('in', last); sat.setAttribute('type', 'saturate'); sat.setAttribute('values', String(OPT.saturate));
      filter.appendChild(sat);
    }
  }

  function filterFor(kind, w, h, r) {
    const key = kind + '|' + w + '|' + h + '|' + r;
    if (S.cache.has(key)) return S.cache.get(key);
    const filter = document.createElementNS('http://www.w3.org/2000/svg', 'filter');
    const id = 'aerolens-' + (S.seq++) + '-' + kind;
    filter.setAttribute('id', id);
    filter.setAttribute('color-interpolation-filters', 'sRGB');   // the map is sRGB data: 128 must mean "no bend"
    buildInto(filter, kind, w, h, r);
    defs().appendChild(filter);
    S.cache.set(key, id);
    return id;
  }

  /* ── attach / sweep ─────────────────────────────────────────────────────── */
  function ro() {
    if (!S.ro && typeof ResizeObserver !== 'undefined') {
      let t = null; const dirty = new Set();
      S.ro = new ResizeObserver((entries) => {
        entries.forEach((en) => dirty.add(en.target));
        clearTimeout(t);
        t = setTimeout(() => {
          dirty.forEach((el) => { if (el.dataset.aerolens && el.dataset.aerolens !== 'off' && document.contains(el)) attach(el, el.dataset.aerolens); });
          dirty.clear();
        }, 200);
      });
    }
    return S.ro;
  }

  function attach(el, kind) {
    if (el.dataset.aerolens === 'off' || (el.closest && el.closest('[data-aerolens="off"]'))) return false;   // suite: opting out a board opts out its cells
    const w = el.clientWidth, h = el.clientHeight;
    const mn = kind === 'sphere' ? 18 : OPT.minSize;   // suite: the panel minimum (no lens on small buttons) never skips bubbles
    if (w < mn || h < mn) return false;
    const vw = (typeof window !== 'undefined' && window.innerWidth) || 0;   // suite addition: viewport-area cap
    if (OPT.maxFrac && vw && w * h > OPT.maxFrac * vw * window.innerHeight) return false;
    if (S.mode === 'css') {                       // WebKit / Firefox path
      el.classList.add('aerolens-css');
      // suite addition: inline important so the frost slider beats the
      // suite's own !important CSS blurs in fallback mode as well
      const fv = 'blur(var(--aerolens-frost,9px)) saturate(140%)';
      el.style.setProperty('backdrop-filter', fv, 'important');
      el.style.setProperty('-webkit-backdrop-filter', fv, 'important');
      el.dataset.aerolens = kind;
      return true;
    }
    const q = kind === 'sphere' ? 16 : 8;         // geometry buckets → shared filters
    const qw = Math.round(w / q) * q, qh = Math.round(h / q) * q;
    const r = kind === 'sphere' ? qw / 2
      : Math.round((parseFloat(getComputedStyle(el).borderTopLeftRadius) || 0) / 2) * 2;
    const id = filterFor(kind, qw, qh, r);
    // suite addition: set with 'important' — the suite's glass-skin CSS uses
    // !important backdrop blurs, and a plain inline style would lose to them
    el.style.setProperty('backdrop-filter', 'url("#' + id + '")', 'important');
    el.style.setProperty('-webkit-backdrop-filter', 'url("#' + id + '")', 'important');
    el.dataset.aerolens = kind;
    if (ro()) ro().observe(el);
    return true;
  }

  function sweep() {
    if (!S.active) return;
    if (OPT.targets.length) {
      document.querySelectorAll(OPT.targets.join(',')).forEach((el) => {
        if (!el.dataset.aerolens) { try { attach(el, 'edge'); } catch (e) {} }
      });
    }
    if (OPT.sphereTargets.length) {
      const bubbles = Array.from(document.querySelectorAll(OPT.sphereTargets.join(',')))
        .filter((el) => !el.dataset.aerolens && el.clientWidth >= 26)
        .sort((a, b) => b.clientWidth - a.clientWidth)
        .slice(0, OPT.sphereMax);
      bubbles.forEach((el) => { try { attach(el, 'sphere'); } catch (e) {} });
    }
  }

  function scheduleSweep() {
    if (!S.active) return;
    clearTimeout(S.sweepT);
    S.sweepT = setTimeout(sweep, 120);
  }

  /* ── fallback CSS (injected once in css mode) ───────────────────────────── */
  const FALLBACK_CSS = `
.aerolens-css{
  backdrop-filter:blur(var(--aerolens-frost,9px)) saturate(140%);
  -webkit-backdrop-filter:blur(var(--aerolens-frost,9px)) saturate(140%);
  box-shadow:
    inset 0 1px 0 rgba(255,255,255,.85),
    inset 0 0 0 1px rgba(255,255,255,.35),
    inset 0 0 var(--aerolens-lip,10px) rgba(255,255,255,.45),
    inset 0 calc(-1 * var(--aerolens-lip,10px) / 2) var(--aerolens-lip,10px) rgba(0,0,0,.08),
    0 10px 32px rgba(0,0,0,.16) !important;
}`;

  /* ── public API ─────────────────────────────────────────────────────────── */
  const AeroLens = {
    init(options) {
      Object.assign(OPT, options || {});
      S.mode = detectMode();
      S.active = true;
      if (S.mode === 'css' && !document.getElementById('aerolens-fallback-css')) {
        const st = document.createElement('style');
        st.id = 'aerolens-fallback-css';
        st.textContent = FALLBACK_CSS;
        document.head.appendChild(st);
        document.documentElement.style.setProperty('--aerolens-frost', OPT.frost + 'px');
        document.documentElement.style.setProperty('--aerolens-lip', Math.round(OPT.strength / 3) + 'px');
      }
      sweep();
      if (OPT.auto && typeof MutationObserver !== 'undefined' && !S.mo) {
        S.mo = new MutationObserver((muts) => {
          if (muts.every((m) => m.target && m.target.nodeType === 1 && m.target.closest && m.target.closest('[data-aerolens-editor]'))) return;
          scheduleSweep();
        });
        S.mo.observe(document.body, { childList: true, subtree: true });
      }
      return this;
    },
    // live retune — filters rebuilt IN PLACE (ids stable → zero flash)
    set(options) {
      Object.assign(OPT, options || {});
      if (S.mode === 'css') {
        document.documentElement.style.setProperty('--aerolens-frost', OPT.frost + 'px');
        document.documentElement.style.setProperty('--aerolens-lip', Math.round(OPT.strength / 3) + 'px');
        return this;
      }
      S.cache.forEach((id, key) => {
        const [kind, w, h, r] = key.split('|');
        const filter = document.getElementById(id);
        if (filter) buildInto(filter, kind, +w, +h, +r);
      });
      sweep();
      return this;
    },
    refresh() { return this.set({}); },
    attach(el, kind) { return attach(el, kind || 'edge'); },
    destroy() {
      S.active = false;
      if (S.mo) { S.mo.disconnect(); S.mo = null; }
      clearTimeout(S.sweepT);
      document.querySelectorAll('[data-aerolens]').forEach((el) => {
        el.style.removeProperty('backdrop-filter'); el.style.removeProperty('-webkit-backdrop-filter');
        el.classList.remove('aerolens-css');
        delete el.dataset.aerolens;
        if (S.ro) S.ro.unobserve(el);
      });
      if (S.defs) { S.defs.remove(); S.defs = null; }
      S.cache.clear();
      const fb = document.getElementById('aerolens-fallback-css');
      if (fb) fb.remove();
      return this;
    },
    get mode() { return S.mode; },
    _internals: { edgeMap, sphereMap },   // exposed for testing
  };

  return AeroLens;
}));
