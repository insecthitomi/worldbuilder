/* ========================================================================== */
/* Prism — GPU liquid glass for Glass Kit.                                    */
/* ========================================================================== */
/*
 * One WebGL2 canvas sits behind the interface. The live backdrop DOM is its child (HTML-in-canvas:
 * `layoutsubtree` + texElementImage2D), so the shader sees exactly what the user sees, animations
 * included. Every glass surface is drawn per pixel, nesting level by nesting level, with:
 *   - a squircle bezel height field and true Snell refraction through real thickness (float precision),
 *   - spectral dispersion (up to 6 wavelengths) that appears only where light actually bends,
 *   - a blur pyramid: crisp refracting rim, frosted interior,
 *   - Fresnel reflection of the surroundings, two-light GGX speculars (the key light can follow the pointer),
 *   - thin-film iridescence on the rim, Beer–Lambert absorption (coloured glass), milky scattering,
 *   - caustics and soft shadows cast onto what lies beneath,
 *   - glass ball lenses for the backdrop bubbles,
 *   - liquid motion: springs stretch moving glass, squash it on press, slide selection indicators,
 *     and glass in one merge group melts together (smooth union of the shapes).
 * The DOM keeps every element, its text, hit testing and accessibility; surfaces only lose their CSS
 * background. Nothing renders while nothing changes. Wheel scrolling over glass is driven from the
 * same frame as the render, so glass never trails the content.
 *
 * Prism.supported() → bool; Prism.start(opts) / set(opts) / stop(); Prism.stats; Prism.onfail(fn).
 */
(function (root) {
  'use strict';

  const OPT = {
    targets: [],            // selectors of glass surfaces (panels, widgets)
    controls: [],           // selectors of glass controls (buttons, inputs, switches)
    indicators: [],         // [{ container, active }] selection indicators that slide like liquid
    exclude: '.gk-scrim, .gk-toasts, .gk-dialog, [data-prism="off"], .gk-nolens, [data-mat], .gk-btn.ghost:not(.on):not([aria-pressed="true"])',
    blockers: '.gk-panel, .gk-widget, .gk-control, .gk-scrim, .gk-toasts',
    bubbles: '#gk-bubbles .bub',
    ior: 1.5, thickness: 26, bezel: 1, dispersion: .4, frost: 18, rimClear: .85, milk: .14,
    tint: [1, 1, 1], tintA: 0, hl: null, accent: [.43, .82, 1], light: [1, 1, 1], lightAngle: 180, shine: .7,
    iris: .18, caustics: .7, shadow: .55, pointerLight: true, liquid: true, adaptive: true, textLight: true,
    quality: 'auto', motion: true, mergeRadius: 16, smoothScroll: true,
    // optional optics, all off by default (0 = that pass or term is skipped entirely):
    bulge: 0,               // body refraction: the whole body is a lens that magnifies and warps, not only the bevel
    bubbleLens: 0,          // bubbles from a ball lens (0, as Lens draws them) to a solid glass marble (1): magnified, then inverted
    envLight: 0,            // wallpaper light: rims, speculars, sheen and caustics take the local wallpaper colour
    glow: 0, glowSize: .5, glowThreshold: .6, halation: 0,   // bloom of bright wallpaper areas; halation warms its fringe
    haze: 0,                // a lifted, milky light diffusion over the backdrop (the glass stays clear)
  };
  // Quality never lowers the resolution: every level renders at 1 x devicePixelRatio. It only trims effect costs.
  // glow: how many bloom levels are built and blended (the auto governor trims them on slow frames)
  const QUALITY = { high: { spectral: 6, caustics: true, smooth: 1, glow: 5 }, balanced: { spectral: 3, caustics: true, smooth: 1, glow: 4 }, low: { spectral: 1, caustics: false, smooth: 0, glow: 3 } };
  const ORDER = ['high', 'balanced', 'low'];
  // a selected / on control keeps its accent: filled like .primary, or a soft accent wash
  const ACCENT_FILL = '.primary, .is-accent, .gk-switch.on, [role="switch"][aria-checked="true"], .gk-seg > button.on, .gk-nav-btn.on';
  const ACCENT_SOFT = '.on, .sel, [aria-pressed="true"], [aria-checked="true"]';
  const MAX_MEMBERS = 1024, TEXELS = 8;

  const S = {
    on: false, canvas: null, gl: null, host: null, backdrop: null, backdropHome: null,
    surfaces: [], byEl: new Map(), indicators: [], dirty: true, sceneDirty: true, animating: false,
    W: 0, H: 0, dpr: 1, q: 'high', frames: [], gov: { hold: 4000, at: 0 }, stats: { fps: 0, ms: 0, surfaces: 0, quality: 'high', mode: 'off', frames: 0, scale: 1 },
    pointer: { x: -1, y: -1, w: 0, target: 0 }, mo: null, ro: null, discoverT: 0, failFns: [], scroll: new Map(),
  };

  /* ---------------------------------------------------------------- capability */
  let SUPPORT = null;
  function supported() {
    if (SUPPORT != null) return SUPPORT;
    try {
      const c = document.createElement('canvas');
      c.setAttribute('layoutsubtree', '');
      const gl = c.getContext('webgl2');
      SUPPORT = !!(gl && ('layoutSubtree' in c || 'onpaint' in c) && typeof c.requestPaint === 'function' &&
        (typeof gl.texElementImage2D === 'function' || typeof gl.texElementSubImage2D === 'function'));
      const lose = gl && gl.getExtension('WEBGL_lose_context'); if (lose) lose.loseContext();
    } catch (e) { SUPPORT = false; }
    return SUPPORT;
  }
  // The API is a Chromium dev trial and its WebGL signature has changed twice; try each, newest first.
  let uploadForm = null;
  function upload(gl, el, w, h) {
    const forms = [
      () => { gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA8, w, h, 0, gl.RGBA, gl.UNSIGNED_BYTE, null); gl.texElementSubImage2D(gl.TEXTURE_2D, 0, 0, 0, el); },
      () => gl.texElementImage2D(gl.TEXTURE_2D, 0, gl.RGBA8, gl.RGBA, gl.UNSIGNED_BYTE, el),
      () => gl.texElementImage2D(gl.TEXTURE_2D, gl.RGBA8, el),
    ];
    if (uploadForm != null) { forms[uploadForm](); return; }
    for (let i = 0; i < forms.length; i++) { try { forms[i](); uploadForm = i; S.stats.upload = i; return; } catch (e) { /* next */ } }
    throw new Error('Prism: this browser cannot draw elements into WebGL');
  }

  /* ---------------------------------------------------------------- shaders */
  const VS_FULL = `#version 300 es
in vec2 aPos; out vec2 vUv;
void main(){ vUv = aPos * .5 + .5; gl_Position = vec4(aPos, 0., 1.); }`;

  // Shared by the optional passes: a cubic B-spline lookup (four bilinear taps) that magnifies a small pyramid level
  // without its texel grid, and the wallpaper-light tone (the hue of the local wallpaper, at an intensity that
  // follows its brightness) used by envLight.
  const SMOOTHF = `
vec3 bspl(sampler2D t, vec2 uv){
  vec2 sz = vec2(textureSize(t, 0)), x = uv * sz - .5, f = fract(x), i0 = floor(x);
  vec2 w0 = (1. - f) * (1. - f) * (1. - f) / 6., w1 = (4. - 6. * f * f + 3. * f * f * f) / 6., w3 = f * f * f / 6., w2 = 1. - w0 - w1 - w3;
  vec2 g0 = w0 + w1, g1 = w2 + w3, h0 = (w1 / g0 - 1. + i0 + .5) / sz, h1 = (w3 / g1 + 1. + i0 + .5) / sz;
  return (texture(t, h0).rgb * g0.x + texture(t, vec2(h1.x, h0.y)).rgb * g1.x) * g0.y + (texture(t, vec2(h0.x, h1.y)).rgb * g0.x + texture(t, h1).rgb * g1.x) * g1.y;
}
vec3 envTone(vec3 e){
  float m = max(max(e.r, e.g), max(e.b, 1e-3));
  vec3 h = e / m;
  h = max(mix(vec3((h.r + h.g + h.b) / 3.), h, 1.3), 0.);
  return h * (.45 + 1.3 * smoothstep(.04, .8, dot(e, vec3(.2126, .7152, .0722))));
}
`;

  const FS_SCENE = `#version 300 es
precision highp float; in vec2 vUv; uniform sampler2D uTex; out vec4 o;
void main(){ o = vec4(texture(uTex, vec2(vUv.x, 1. - vUv.y)).rgb, 1.); }`;   // element images are top-down

  // Pyramid downsample: 13 bilinear taps (a 36-texel weighted kernel, as film bloom chains do), one pass per level.
  // A wide, smooth kernel per halving keeps every level free of aliasing, so frost never shimmers or blocks up.
  const FS_DOWN = `#version 300 es
precision highp float; in vec2 vUv; uniform sampler2D uTex; uniform vec2 uTexel; out vec4 o;
vec3 T(vec2 d){ return texture(uTex, vUv + d * uTexel).rgb; }
void main(){
  vec3 a = T(vec2(-2., -2.)), b = T(vec2(0., -2.)), c = T(vec2(2., -2.));
  vec3 d = T(vec2(-2., 0.)), e = T(vec2(0., 0.)), f = T(vec2(2., 0.));
  vec3 g = T(vec2(-2., 2.)), h = T(vec2(0., 2.)), i = T(vec2(2., 2.));
  vec3 j = T(vec2(-1., -1.)), k = T(vec2(1., -1.)), l = T(vec2(-1., 1.)), m = T(vec2(1., 1.));
  vec3 s = e * .125 + (a + c + g + i) * .03125 + (b + d + f + h) * .0625 + (j + k + l + m) * .125;
  o = vec4(s, 1.);
}`;

  // Glow (optional): keep what is brighter than the threshold, with a soft knee so the glow fades in smoothly.
  const FS_BRIGHT = `#version 300 es
precision highp float; in vec2 vUv; uniform sampler2D uTex; uniform float uThr; out vec4 o;
void main(){
  vec3 c = texture(uTex, vUv).rgb;
  // brightness as the eye sees it: white clouds and sunlit areas glow, a deep blue sky does not
  float br = dot(c, vec3(.2126, .7152, .0722)), knee = .5 * (1. - uThr) + .04;
  float s = clamp(br - uThr + knee, 0., 2. * knee); s = s * s / (4. * knee);
  o = vec4(c * max(s, br - uThr) / max(br, 1e-4), 1.);
}`;

  // Light on the backdrop (optional), composited into the scene before any glass, so the glass refracts it:
  //   haze: an old lens' diffusion — highlights spread softly, the whole picture softens a touch, and a milky veil
  //         of the surrounding light lifts the shadows;
  //   glow: bloom from the bright-pass pyramid, wide or tight by glowSize; halation warms the wide fringe like
  //         light scattered back through film. Added with a screen blend, so it never clips harshly.
  const FS_POST = `#version 300 es
precision highp float; in vec2 vUv; out vec4 o;
uniform sampler2D uTex, uH2, uH4, uG1, uG2, uG3, uG4, uG5;
uniform vec3 uLightCol; uniform float uGlow, uSize, uHal, uHaze; uniform int uGLevels, uSmooth;
${SMOOTHF}
vec3 S(sampler2D t, vec2 uv){ return uSmooth > 0 ? bspl(t, uv) : texture(t, uv).rgb; }
float lum(vec3 c){ return dot(c, vec3(.2126, .7152, .0722)); }
void main(){
  vec3 c = texture(uTex, vUv).rgb;
  if (uHaze > 0.) {
    vec3 soft = S(uH2, vUv), wide = S(uH4, vUv);
    c = mix(c, max(c, soft), uHaze * .55);                                  // highlights bleed into their surroundings
    c = mix(c, soft, uHaze * .2);                                           // a gentle overall softness
    vec3 veil = mix(wide, vec3(lum(wide)), .35) * .55 + mix(vec3(1.), uLightCol, .6) * .45;
    c += (veil - c) * uHaze * .26 * (1. - .55 * lum(c));                    // lifted, milky shadows; lights barely move
  }
  if (uGlow > 0.) {
    float mid = mix(1.2, 4.6, uSize);                                        // which pyramid levels carry the glow
    vec3 warm = vec3(1., .5, .24) * 1.45;
    vec3 acc = vec3(0.); float ws = 0.;
    for (int k = 1; k <= 5; k++) {
      if (k > uGLevels) break;
      float w = exp(-pow((float(k) - mid) / 1.35, 2.));
      vec3 g = k == 1 ? S(uG1, vUv) : k == 2 ? S(uG2, vUv) : k == 3 ? S(uG3, vUv) : k == 4 ? S(uG4, vUv) : S(uG5, vUv);
      // halation: the wider the scatter, the warmer (deep red-orange at the outer fringe)
      acc += g * w * mix(vec3(1.), warm, uHal * (float(k) - 1.) / 4.);
      ws += w;
    }
    // light spreads from bright areas into their darker surroundings: what is already bright is the source and is
    // barely lifted further, so clouds keep their shape instead of washing out and the picture keeps its contrast
    vec3 b = acc / max(ws, 1e-3) * uGlow * 1.5 * (1. - .7 * smoothstep(.35, .95, lum(c)));
    c = 1. - (1. - c) * (1. - min(b, vec3(1.)));
  }
  c += (fract(52.9829189 * fract(dot(gl_FragCoord.xy, vec2(.06711056, .00583715)))) - .5) / 255.;
  o = vec4(c, 1.);
}`;

  // Quads in canvas pixels (y down) for instanced draws.
  const VS_BOX = `#version 300 es
in vec2 aPos; in vec4 aBox; in vec4 aInfo;
uniform vec2 uRes; out vec2 vP; flat out vec4 vInfo;
void main(){
  vec2 c = aPos * .5 + .5;
  vP = mix(aBox.xy, aBox.zw, c);
  vInfo = aInfo;
  gl_Position = vec4(vP.x / uRes.x * 2. - 1., 1. - vP.y / uRes.y * 2., 0., 1.);
}`;

  const COMMON = `
precision highp float;
uniform vec2 uRes;
uniform highp sampler2D uMem;
uniform vec2 uLight2D;       // toward the light, screen space (y down)
uniform vec3 uLightCol;
uniform vec3 uHlCol;          // highlight colour: rim line, speculars, sheen
vec4 M(int i, int k){ return texelFetch(uMem, ivec2(k, i), 0); }
float smax(float a, float b, float k){ float h = max(k - abs(a - b), 0.) / k; return max(a, b) + h * h * k * .25; }
// Rounded rectangle with superellipse corners. The outline is exact. Deeper in, the field blends into a
// second rounded box whose corner radius is wider than the bevel (k), so every inner band of the bevel stays
// round at the corners too; an exact field alone turns them square once they are deeper than the radius.
float boxSd(vec2 p, vec2 b, float r, float n){
  vec2 q = abs(p) - b + r; vec2 m = max(q, 0.);
  float l = n > 2.05 ? pow(pow(m.x, n) + pow(m.y, n), 1. / n) : length(m);
  return l + min(max(q.x, q.y), 0.) - r;
}
float sdSq(vec2 p, vec2 b, float r, float n, float k){
  if (r >= min(b.x, b.y) - .5) n = 2.;                 // circles and capsules keep round ends
  r = min(r, min(b.x, b.y));
  float d0 = boxSd(p, b, r, n);
  if (k <= .5 || r < 1.) return d0;                     // square corners stay exactly square
  float R2 = min(max(r, k * 1.2), min(b.x, b.y));
  // exact near the outline (the wider box sits inside the corner there); the blend is done by the time the exact field creases (depth r)
  return mix(d0, boxSd(p, b, R2, 2.), smoothstep(r * .5, r * 1.15, -d0));
}
vec2 deform(vec2 q, vec4 d){           // d: stretch dir, stretch, press
  if (abs(d.z) > 1e-4) { float a = dot(q, d.xy); vec2 perp = q - a * d.xy; q = d.xy * (a / (1. + d.z)) + perp * (1. + d.z * .55); }
  return q / (1. - .045 * d.w);
}
float sdMember(int i, vec2 p){
  vec4 g = M(i, 0); vec4 s = M(i, 1);
  return sdSq(deform(p - g.xy, M(i, 4)), g.zw, s.x, s.y, s.z);
}
float smin(float a, float b, float k){ if (k <= 0.) return min(a, b); float h = max(k - abs(a - b), 0.) / k; return min(a, b) - h * h * k * .25; }
float lum(vec3 c){ return dot(c, vec3(.2126, .7152, .0722)); }
${SMOOTHF}`;

  const FS_GLASS = `#version 300 es
${COMMON}
uniform sampler2D uSrc, uP1, uP2, uP3, uP4, uP5;
uniform vec4 uPointer;       // xy px, z weight, w height
uniform float uShine, uRimClear, uAdaptive, uTextLight, uIris;
uniform int uSpectral, uSmooth;
uniform sampler2D uEnvTex; uniform float uEnv, uBulge;      // optional: wallpaper light, body refraction (0 = off)
uniform sampler2D uGlowTex; uniform float uGlowG;           // optional: the glow's bright light, caught by the glass
in vec2 vP; flat in vec4 vInfo; out vec4 o;
vec2 uvOf(vec2 p){ return vec2(p.x / uRes.x, 1. - p.y / uRes.y); }
vec3 tap(int k, vec2 uv){
  if (k == 1) return texture(uP1, uv).rgb;
  if (k == 2) return texture(uP2, uv).rgb;
  if (k == 3) return texture(uP3, uv).rgb;
  if (k == 4) return texture(uP4, uv).rgb;
  return texture(uP5, uv).rgb;
}
// Pyramid levels are magnified 2^k times; plain bilinear shows their texel grid (blocks, diamond artefacts).
// A cubic B-spline built from four bilinear taps reconstructs them smoothly.
vec3 lvl(int k, vec2 uv){
  if (k <= 0) return texture(uSrc, uv).rgb;                       // level 0 is the full-resolution scene
  if (uSmooth == 0) return tap(k, uv);
  vec2 sz = uRes / exp2(float(k)), t = uv * sz - .5, f = fract(t), i0 = floor(t);
  vec2 w0 = (1. - f) * (1. - f) * (1. - f) / 6., w1 = (4. - 6. * f * f + 3. * f * f * f) / 6., w3 = f * f * f / 6., w2 = 1. - w0 - w1 - w3;
  vec2 g0 = w0 + w1, g1 = w2 + w3, h0 = (w1 / g0 - 1. + i0 + .5) / sz, h1 = (w3 / g1 + 1. + i0 + .5) / sz;
  return (tap(k, vec2(h0.x, h0.y)) * g0.x + tap(k, vec2(h1.x, h0.y)) * g1.x) * g0.y + (tap(k, vec2(h0.x, h1.y)) * g0.x + tap(k, vec2(h1.x, h1.y)) * g1.x) * g1.y;
}
vec3 blurAt(vec2 uv, float lod){
  if (lod < .002) return texture(uSrc, uv).rgb;                   // no frost: the sharp, full-resolution scene only
  lod = clamp(lod, 0., 5.); int a = int(floor(lod)); float t = fract(lod);
  vec3 c = lvl(a, uv);
  return t < .002 ? c : mix(c, lvl(min(a + 1, 5), uv), t);
}
int gStart, gCount; float gK;
float field(vec2 p){
  float d = 1e5;
  for (int j = 0; j < 8; j++) { if (j >= gCount) break; d = smin(d, sdMember(gStart + j, p), gK); }
  return d;
}
float dye0(float dens){ return smoothstep(.3, .8, dens); }
vec3 lensSample(vec2 sp, vec2 ax, int taps, float lod){
  if (taps <= 1) return blurAt(uvOf(sp), lod);
  vec3 acc = vec3(0.);
  for (int t = 0; t < 4; t++) { if (t >= taps) break; acc += blurAt(uvOf(sp + ax * ((float(t) + .5) / float(taps) - .5)), lod); }
  return acc / float(taps);
}
vec2 refr(vec3 N, float eta, float thick){ vec3 T = refract(vec3(0., 0., -1.), N, eta); return T.xy / max(-T.z, .3) * thick; }
float ggx(vec3 N, vec3 L, float r){ vec3 H = normalize(L + vec3(0., 0., 1.)); float a = r * r, a2 = a * a; float nh = max(dot(N, H), 0.); float d = nh * nh * (a2 - 1.) + 1.; return a2 / (3.14159 * d * d) * max(dot(N, L), 0.); }
void main(){
  gStart = int(vInfo.x); gCount = int(vInfo.y); gK = vInfo.z;
  vec2 p = vP;
  // nearest member carries geometry and material; a merge blends them by proximity
  float d = 1e5, wsum = 0.; vec4 mBox = vec4(0.), mGeo = vec4(0.), mTint = vec4(0.), mOpt = vec4(0.), mLook = vec4(0.), clip = vec4(0.);
  for (int j = 0; j < 8; j++) {
    if (j >= gCount) break;
    int i = gStart + j;
    float di = sdMember(i, p);
    float w = exp(-max(di, 0.) / max(gK * .5, 1.));
    mBox += M(i, 0) * w; mGeo += M(i, 1) * w; mTint += M(i, 2) * w; mOpt += M(i, 3) * w; mLook += M(i, 6) * w;
    if (di < d + .5) clip = M(i, 5);
    wsum += w;
    d = smin(d, di, gK);
  }
  mBox /= wsum; mGeo /= wsum; mTint /= wsum; mOpt /= wsum; mLook /= wsum;
  // exact pixel coverage: the field is not a true distance at superellipse corners, so measure its screen slope
  float cover = clamp(.5 - d / max(fwidth(d), 1e-3), 0., 1.);
  vec2 cl = clamp(min(p - clip.xy, clip.zw - p) + .5, 0., 1.);
  cover *= cl.x * cl.y;
  // keep pixels just outside the edge alive: the lens filter below needs screen-space derivatives of the
  // refraction mapping, and those are only defined while the neighbouring pixels still run
  vec2 clo = min(p - clip.xy, clip.zw - p);
  if (d > 3. || min(clo.x, clo.y) < -3.) discard;

  float B = max(mGeo.z, 2.), thick0 = mGeo.w, ior = mOpt.x, disp = mOpt.y, frost = mOpt.z, milk = mOpt.w;
  float spec = mLook.x, iris = mLook.y * uIris, kind = mLook.z;
  float t = -d, x = clamp(t / B, 0., 1.), u = 1. - x;
  float prof = pow(max(1. - u * u * u * u, 0.), .25);
  float dprof = x >= 1. ? 0. : u * u * u * pow(max(1. - u * u * u * u, 1e-3), -.75);
  float H = thick0 * .55;
  float slope = min(H / B * dprof, 5.);
  if (kind > 1.5 && kind < 2.5) slope = -slope * .45;            // inset (fields): a shallow concave lip
  vec2 g = vec2(field(p + vec2(1., 0.)) - d, field(p + vec2(0., 1.)) - d);
  g = g / max(length(g), 1e-4);
  // a very slight dome over the whole body: thick glass gently magnifies what is behind it
  vec2 qn = clamp((p - mBox.xy) / max(mBox.zw, vec2(1.)), -1., 1.);
  vec3 N = normalize(vec3(g * slope + qn * .045 * smoothstep(0., 1., x), 1.));
  float thick = thick0 * (.35 + .65 * prof);
  // Body refraction (optional): the whole body is a thick lens. The backdrop is drawn in toward the middle, which
  // magnifies it there and squeezes it into a ring nearer the edge (a bulge), fading to nothing at the edge so it
  // joins the bevel without a seam. The profile is a rounded dome that is flatter along the long side of long
  // glass (more like a cylinder there), so a wide bar still bulges across without smearing sideways. Thick glass
  // and small pieces bend more; fields (inset) are a shallow, slightly shrinking well.
  vec2 body = vec2(0.);
  bool bodyOn = uBulge > 0.;
  if (bodyOn) {
    vec2 hb = max(mBox.zw, vec2(1.));
    float m0 = min(hb.x, hb.y);
    vec2 rq = p - mBox.xy;
    vec2 R = m0 + (hb - m0) * .65;                                  // the lens radius along each axis
    vec2 v = sign(rq) * max(abs(rq) - (hb - R), 0.) / R;
    vec2 v2 = v * v;
    float rho2 = sqrt(v2.x * v2.x + v2.y * v2.y);                 // (x^4 + y^4)^(1/2): a rounded-square radius, squared
    float w = max(1. - rho2, 0.); w *= w;
    float tf = clamp(sqrt(thick0 / m0 * 1.5), .45, 1.);
    // A slab of glass, not a fisheye: at most ~1.2x through the middle, and the backdrop never moves further than
    // the glass is thick. (Scaling by the panel's size alone made tall panels a 2x magnifier that dragged the
    // picture away from their centre.)
    float mg = uBulge * .18 * tf * (kind > 1.5 && kind < 2.5 ? -.4 : 1.);
    body = -v * min(R * abs(mg), vec2(thick0 * 1.2)) * sign(mg) * w;
  }

  // refraction, spectral where it bends
  vec3 col;
  float eta = 1. / ior;
  vec2 o0 = refr(N, eta, thick);
  float lod = log2(1. + frost / 3.);
  float lodHere = mix(lod * (1. - uRimClear), lod, smoothstep(0., 1., x));
  // Footprint-aware lens filtering. The refraction mapping p -> p + offset squeezes the backdrop at the rim;
  // a single lookup there aliases (shimmer, jagged bending). Its screen-space Jacobian says how far one screen
  // pixel reaches into the backdrop: the shorter axis picks the prefilter level, and up to four taps spread
  // along the longer axis (anisotropic, as film renderers filter through lenses).
  vec2 sp0 = p + o0 + body;
  vec2 jx = dFdx(sp0), jy = dFdy(sp0);
  float lx = length(jx), ly = length(jy);
  vec2 ax = lx > ly ? jx : jy;
  float mn = min(lx, ly), mj = max(lx, ly);
  int taps = int(clamp(ceil(mj / max(mn, 1.)), 1., 4.));
  float lodS = max(lodHere, log2(max(mn, 1.)));
  if (uSpectral > 1 && disp > 0. && (x < .999 || bodyOn)) {
    // Dithered spectrum: each pixel shifts its wavelength samples by interleaved gradient noise, so neighbouring
    // pixels cover different wavelengths and the eye integrates a smooth rainbow instead of bands.
    // (with body refraction the middle disperses too: each wavelength magnifies a little differently)
    int ns = x < .999 ? uSpectral : min(uSpectral, 3);
    float jit = fract(52.9829189 * fract(dot(gl_FragCoord.xy, vec2(.06711056, .00583715))));
    vec3 acc = vec3(0.), wt = vec3(0.);
    for (int k = 0; k < 6; k++) {
      if (k >= ns) break;
      float f = (float(k) + jit) / float(ns);                         // 0 red … 1 violet
      vec2 off = refr(N, 1. / (ior + disp * .09 * (f - .5)), thick);
      vec3 s = lensSample(p + off + body * (1. + disp * .08 * (f - .5)), ax, taps, lodS);
      vec3 w = vec3(smoothstep(.55, 0., f), 1. - abs(f - .5) * 2., smoothstep(.45, 1., f)) + .05;
      acc += s * w; wt += w;
    }
    col = acc / wt;
  } else {
    col = lensSample(sp0, ax, taps, lodS);
  }

  // the edge shows its thickness: a slight, colour-neutral darkening inside the rim (clear glass adds no cast)
  col *= 1. - (1. - prof) * .07;

  vec3 tint = mTint.rgb; float dens = mTint.a, dyed = mLook.w;
  float dye = 0.;
  if (dyed > .5) {
    // dyed glass (accent fills, item colours): absorption, and dense dye glows with its own colour
    col *= pow(mix(vec3(1.), tint, dens), vec3(thick / max(thick0, 1.) * 1.2));
    dye = smoothstep(.3, .8, dens);
    col = mix(col, tint * (.78 + .32 * prof) + col * .18, dye * .72);
  } else {
    // tinted glass: the user's tint colour at the tint strength (0 = perfectly clear)
    col = mix(col, tint, dens * (.55 + .45 * x));
  }
  // milkiness scatters light: a neutral (light-coloured) veil, independent of the tint
  col = mix(col, mix(vec3(1.), uLightCol, .25), milk * (.55 + .45 * x) * (1. - dye));

  // legibility: calm bright or busy backdrops under text
  if (uAdaptive > 0.) {
    float bg = lum(blurAt(uvOf(p), 4.));
    if (uTextLight > .5) col *= 1. - uAdaptive * smoothstep(.5, .95, bg) * .22 * x;
    else col = mix(col, vec3(1.), uAdaptive * smoothstep(.55, .15, bg) * .22 * x);
  }

  // Fresnel reflection of the surroundings and the sky light
  float cosT = clamp(N.z, 0., 1.);
  float F0 = pow((ior - 1.) / (ior + 1.), 2.);
  float F = F0 + (1. - F0) * pow(1. - cosT, 5.);
  vec3 R = reflect(vec3(0., 0., -1.), N);
  vec3 envScene = blurAt(uvOf(p - R.xy * 140.), 4.2);
  float sky = .5 + .5 * dot(R.xy / max(length(R.xy), 1e-4), uLight2D);
  // energy-conserving Fresnel: what is reflected is taken from what is transmitted, and the reflection is the
  // real surroundings (plus the light only where it actually mirrors it), so flat clear glass adds no tint
  vec3 env = envScene + uLightCol * .22 * pow(sky, 8.) * smoothstep(.05, .4, 1. - cosT);
  col = mix(col, env, clamp(F, 0., .85));

  // Wallpaper light (optional): the highlight takes the hue and some of the brightness of the blurred wallpaper
  // behind the glass and just outside its nearest edge, so glass beside a bright green-gold area glows green-gold.
  vec3 hlC = uHlCol;
  if (uEnv > 0.) {
    vec3 eB = bspl(uEnvTex, uvOf(p)), eA = bspl(uEnvTex, uvOf(p + g * (t + B * .6 + 10.)));
    vec3 envA = mix(eB, eA, exp(-t / max(B * .6, 4.)));
    hlC = mix(uHlCol, envTone(envA), uEnv);
    // light from around the glass scatters in through its edge: a soft glow of the wallpaper's colour on the bevel
    col += envA * uEnv * .3 * (1. - prof) * (1. - .5 * dye);
  }
  // Glow (optional): glass beside or over a glowing area catches its light — strongly in the bevel, where the edge
  // gathers it, and faintly across the body — so the bloom visibly lights the glass, not only the wallpaper
  if (uGlowG > 0.) {
    vec3 gb = bspl(uGlowTex, uvOf(p)), ga = bspl(uGlowTex, uvOf(p + g * (t + B * .5 + 8.)));
    vec3 gc = max(gb, mix(gb, ga, exp(-t / max(B * .6, 4.))));
    col += gc * uGlowG * (.85 * (1. - prof) + .12) * (1. - .5 * dye);
  }

  // lights: key (may follow the pointer) and a cool rim back light
  // the key light is a positioned area light up toward the light direction, not a direction: highlights peak
  // where an edge is nearest the light and fade along it, like a real room
  vec2 lpos = uRes * .5 + uLight2D * length(uRes) * .75;
  vec3 L1 = normalize(vec3(lpos - p, length(uRes) * .55));
  if (uPointer.z > 0.) { vec3 Lp = normalize(vec3(uPointer.xy - p, uPointer.w)); L1 = normalize(mix(L1, Lp, uPointer.z)); }
  vec3 L2 = normalize(vec3(-uLight2D * .85, .45));
  // speculars live on the curved rim; on flat glass a light straight above would otherwise blow out
  float curve = .12 + .88 * (1. - x);
  float s1 = min(ggx(N, L1, .24), 7.), s2 = min(ggx(N, L2, .45), 4.);
  col += hlC * (s1 * .07 + s2 * .012) * curve * uShine * spec;
  // crisp lit rim and a darker far rim: the glass edge catches light where it faces it
  float facing = dot(g, uLight2D);
  // the rim, as the CSS glass draws it: a device-pixel specular line, bright where it faces the light and faint on
  // the far side, with a soft inner highlight behind it
  float px = t / max(fwidth(d), 1e-3);                           // distance inside the edge in device pixels
  float line = 1. - smoothstep(.6, 1.6, px), inner = exp(-px / 5.) - line * .6;
  float lit = .5 + .5 * facing;
  col += hlC * (line * mix(.06, .55, lit * lit) + max(inner, 0.) * .07 * lit) * uShine * spec * (1. - .5 * dye);
  col *= 1. - line * .10 * (1. - lit);                          // the far edge reads a touch darker

  // the surface reflects the room: a broad sheen toward the light and a soft window streak
  float lp = dot(qn, -uLight2D);
  vec2 sp = (p / uRes - .5) * 2.;                       // the window streak is in screen space: every pane reflects the same room
  float ls = dot(sp, -uLight2D) + .35 * dot(sp, vec2(-uLight2D.y, uLight2D.x));
  float glossy = .022 * smoothstep(.05, .2, ls) * (1. - smoothstep(.32, .55, ls));   // a faint window reflection, about F0 strong; no veil
  col += hlC * glossy * uShine * spec * (1. - .6 * dye0(mTint.a));

  // thin-film iridescence along the rim
  if (iris > 0.) {
    float film = iris * pow(u, 1.6) * (.35 + F * 4.);
    vec3 hue = .5 + .5 * cos(6.28318 * (cosT * 1.7 + .18 * facing + vec3(0., .33, .67)));
    col += film * hue * .45;
  }
  // dither by half a step: no banding in smooth frost and gradients
  col += (fract(52.9829189 * fract(dot(gl_FragCoord.xy, vec2(.06711056, .00583715)))) - .5) / 255.;
  o = vec4(col, cover);
}`;

  // Shadows (mode 0) and caustics (mode 1) under a surface, drawn onto what lies beneath it.
  const FS_SHADE = `#version 300 es
${COMMON}
uniform int uMode; uniform float uShadow, uCaustic;
uniform sampler2D uEnvTex; uniform float uEnv;
in vec2 vP; flat in vec4 vInfo; out vec4 o;
void main(){
  int i = int(vInfo.x); float elev = vInfo.y;
  vec4 g = M(i, 0); vec4 sh = M(i, 1); vec4 tint = M(i, 2); vec4 clip = M(i, 5);
  vec2 cl = clamp(min(vP - clip.xy + 40., clip.zw + 40. - vP), 0., 40.) / 40.;
  float B = max(sh.z, 2.);
  if (uMode == 0) {
    // Clear glass passes ~92% of the light: its shadow is faint over the body and darker in a band near the
    // edge, where the bevel bends light away (that light lands in the caustic line). Dyed glass absorbs: full shadow.
    float ds = sdMember(i, vP + uLight2D * elev);
    float blur = elev * 2.2 + 8.;
    float soft = 1. - smoothstep(-blur * .5, blur * 1.4, ds);
    float dyed = smoothstep(.3, .8, tint.a);
    float band = exp(-pow((ds + B * .45) / (B * .5 + 2.), 2.));
    o = vec4(0., 0., 0., (soft * soft * mix(.03, .24, dyed) + band * .10 * (1. - dyed)) * uShadow * cl.x * cl.y);
  } else {
    vec2 sp = vP + uLight2D * elev * 1.5;
    float dc = sdMember(i, sp);
    vec2 gq = vec2(sdMember(i, sp + vec2(1., 0.)) - dc, sdMember(i, sp + vec2(0., 1.)) - dc);
    float far = pow(max(dot(gq / max(length(gq), 1e-4), -uLight2D), 0.), 1.5);
    float w = B * .14 + 1.4;
    float focus = exp(-pow((dc + B * .18) / w, 2.));
    vec3 fringe = vec3(exp(-pow((dc + B * .12) / w, 2.)), focus, exp(-pow((dc + B * .24) / w, 2.)));   // a slight prism split
    vec3 line = mix(vec3(focus), fringe, .45) * far;
    float body = (1. - smoothstep(-B * 1.5, 0., dc)) * .03;
    vec3 tcol = mix(vec3(1.), tint.rgb, clamp(tint.a * 1.25, 0., 1.));
    float glow = exp(-max(dc, 0.) / (B * .8)) * (1. - smoothstep(-B, 0., dc) * .5) * smoothstep(.3, .8, tint.a) * .22;   // dyed glass throws coloured light
    float clear = 1. - smoothstep(.3, .8, tint.a);
    vec3 lc = uLightCol;
    if (uEnv > 0.) lc = mix(uLightCol, envTone(bspl(uEnvTex, vec2(vP.x / uRes.x, 1. - vP.y / uRes.y))), uEnv);   // wallpaper-coloured light
    vec3 c = (line * mix(.30, .07, clear) + body * mix(1., .25, clear) + glow) * tcol * lc * uCaustic;
    o = vec4(c * cl.x * cl.y, 0.);
  }
}`;

  // Bubbles as soap bubbles over the backdrop: a see-through middle, a mirror-bright Fresnel rim that reflects
  // the backdrop curved around the sphere, a draining, swirling thin film, a window highlight with a small
  // glint opposite, a darker band that gives volume, and a soft shadow + caustic on what lies behind.
  // vInfo.w = seed * 997 (integer part) + membrane wobble (fraction); 1.0 is a still bubble.
  const FS_BALL = `#version 300 es
precision highp float;
uniform sampler2D uScene; uniform vec2 uRes, uLight2D; uniform vec3 uLightCol, uHlCol; uniform float uShine, uIris, uTime;
uniform sampler2D uEnvTex; uniform float uEnv, uBLens, uDisp;    // optional: wallpaper light, marble refraction (0 = off)
uniform float uK;                                                 // CSS px -> device px
in vec2 vP; flat in vec4 vInfo; out vec4 o;
vec3 scene(vec2 px){ vec2 uv = clamp(px / uRes, vec2(.001), vec2(.999)); return texture(uScene, vec2(uv.x, 1. - uv.y)).rgb; }
${SMOOTHF}
void main(){
  vec2 c = vInfo.xy; float r = vInfo.z;
  float amp = fract(vInfo.w), seed = floor(vInfo.w) / 997.;
  float t = uTime, s6 = seed * 6.2832;
  vec2 Ld = length(uLight2D) > .01 ? normalize(uLight2D) : vec2(0., -1.);
  float far = 1. - clamp(r / (uRes.y * .045), .35, 1.);          // small bubbles read as further away
  vec2 p = (vP - c) / r;

  // the wobbling membrane
  vec2 q = p;
  if (amp > 0.) {
    float th = atan(q.y, q.x);
    float rho = 1. + amp * (.55 * sin(2. * th + t * (3.1 + seed * 2.) + s6)
                          + .30 * sin(3. * th - t * (4.3 + seed * 1.7) + s6 * 2.)
                          + .15 * sin(4. * th + t * (5.9 + seed) + s6 * 3.));
    q.y *= 1. + amp * .6;
    q /= rho;
  }
  float d = length(q);
  float cover = clamp((1. - d) * r + .5, 0., 1.);

  // shadow and caustic on the backdrop, away from the light
  vec2 ps = (p + Ld * .38) * vec2(1., 1.2);
  float ds = length(ps);
  float shade = smoothstep(1.12, .62, ds) * (1. - smoothstep(.62, .18, ds)) * .2;
  float caus = exp(-pow(ds / .3, 2.)) * .38;
  float lift = (caus - shade) * (1. - far * .6) * uShine * 1.4;
  // wallpaper light (optional): the bubble's highlights, rim light and caustic take the local wallpaper's colour
  vec3 hlC = uHlCol, lC = uLightCol;
  if (uEnv > 0.) { vec3 e = envTone(bspl(uEnvTex, vec2(c.x / uRes.x, 1. - c.y / uRes.y))); hlC = mix(uHlCol, e, uEnv); lC = mix(uLightCol, e, uEnv); }
  vec4 under = lift > 0. ? vec4(lC, lift) : vec4(0., 0., 0., -lift);
  if (cover <= 0.) { if (under.a < .004) discard; o = under; return; }

  float z = sqrt(max(1. - d * d, 0.));
  vec3 N = normalize(vec3(q, z));
  // Through the bubble: a ball lens, the same bend the Lens renderer draws — a ring that pulls the backdrop in
  // toward the middle (strongest around 0.7 r, none at the centre or the very rim) plus a gentle magnifier core.
  // It is in CSS px like the SVG map (55 px peak) but capped by the bubble's size, so small bubbles never sample
  // far outside themselves. Each colour bends a touch differently, so the ring carries a faint rainbow.
  vec2 dir = d > 1e-4 ? q / d : vec2(0.);
  float rt = min(d, 1.);
  float ring = .55 * rt * sqrt(max(1. - rt * rt, 0.)) * 2. + .45 * min(1., rt * 1.3) * (1. - pow(rt, 10.));
  vec3 bend = -ring * .5 * min(55. * uK, r * 1.6) * (1. + uDisp * .05 * vec3(1., 0., -1.));
  vec3 land = bend * (1. - uBLens);
  if (uBLens > 0.) {
    // Thicker toward a solid glass ball (optional): a ray at impact height rho bends in and out of a sphere of
    // index n, deviating by 2(asin(rho) - asin(rho / n)), and lands on the backdrop a couple of radii behind.
    // Rising thickness first magnifies the middle, then passes the focus and turns the image upside down; the
    // spherical aberration warps it toward the rim. Each colour bends a little differently (dispersion).
    // It takes over from the ball lens above as it rises, so there is no jump between off and a little.
    float rho = min(d, .995);
    float n = 1. + .6 * uBLens;
    vec3 nn = n + uDisp * .035 * uBLens * vec3(-1., 0., 1.);
    vec3 dev = min(2. * (asin(rho) - asin(rho / nn)), vec3(1.35));
    land += -2.4 * tan(dev) * r;                                     // offset from the straight-through point, px
  }
  vec3 thru = vec3(scene(vP + dir * land.r).r, scene(vP + dir * land.g).g, scene(vP + dir * land.b).b);
  thru *= 1. - uBLens * .22 * smoothstep(.72, .98, d);             // solid glass: a darker band where light leaves the ball
  // the backdrop mirrored on the sphere
  vec3 R = reflect(vec3(0., 0., -1.), N);
  vec3 refl = scene(c + vec2(R.x, -R.y) * r * 1.9);
  refl = mix(refl, uLightCol, .18);
  float F = .03 + .97 * pow(1. - z, 3.);
  // thin film: thicker at the bottom where it drains, swirling slowly
  float film = .45 + .35 * (q.y * .5 + .5) + .11 * sin(atan(q.y, q.x) * 3. + t * .55 + s6 * 3.) + .07 * sin(q.x * 5. - t * .8 + s6);
  vec3 irid = .5 + .5 * cos(6.28318 * (film * 2.4 / max(z, .3) + vec3(0., .33, .67)));
  float iriAmt = (.4 + .6 * pow(1. - z, 1.2)) * clamp(uIris * 3., 0., 1.);
  vec3 col = mix(thru, refl * mix(vec3(1.), irid, iriAmt), clamp(F * .9, 0., 1.));
  col += irid * (F * .16 + .025) * clamp(uIris * 3., 0., 1.);
  // volume: a soft darker band inside the rim, a bright rim light at the very edge
  col *= 1. - exp(-pow((d - .86) / .07, 2.)) * .14;
  col += lC * pow(1. - z, 7.) * .4;
  // window highlight toward the light, small glint on the far side
  vec2 hp = q - Ld * .48;
  // a soft rounded window, fading along its length like a curved reflection
  vec2 hw = hp * mat2(Ld.y, -Ld.x, Ld.x, Ld.y);
  float wd = length(max(abs(hw) - vec2(.11, .055), 0.)) - .05;
  float spec = smoothstep(.07, -.03, wd) * (.55 + .45 * smoothstep(.2, -.2, hw.y)) * .8 + exp(-dot(hp, hp) / .05) * .22;
  vec2 gp = q + Ld * .6;
  spec += exp(-dot(gp, gp) / .004) * .5;
  col += hlC * spec * uShine * 1.5;
  // further bubbles are softer
  col = mix(col, mix(thru, col, .55), far);
  o = vec4(mix(under.rgb, col, cover), max(cover, under.a));
}`;

  /* ---------------------------------------------------------------- GL plumbing */
  function compile(gl, vs, fs) {
    const sh = (type, src) => { const s = gl.createShader(type); gl.shaderSource(s, src); gl.compileShader(s); if (!gl.getShaderParameter(s, gl.COMPILE_STATUS)) throw new Error('Prism shader: ' + gl.getShaderInfoLog(s)); return s; };
    const p = gl.createProgram();
    gl.attachShader(p, sh(gl.VERTEX_SHADER, vs)); gl.attachShader(p, sh(gl.FRAGMENT_SHADER, fs));
    gl.bindAttribLocation(p, 0, 'aPos'); gl.bindAttribLocation(p, 1, 'aBox'); gl.bindAttribLocation(p, 2, 'aInfo');
    gl.linkProgram(p);
    if (!gl.getProgramParameter(p, gl.LINK_STATUS)) throw new Error('Prism link: ' + gl.getProgramInfoLog(p));
    const u = {};
    const n = gl.getProgramParameter(p, gl.ACTIVE_UNIFORMS);
    for (let i = 0; i < n; i++) { const a = gl.getActiveUniform(p, i); u[a.name] = gl.getUniformLocation(p, a.name); }
    return { p, u };
  }
  function tex(gl, w, h, filter) {
    const t = gl.createTexture();
    gl.bindTexture(gl.TEXTURE_2D, t);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, filter || gl.LINEAR);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, filter || gl.LINEAR);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
    if (w) gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA8, w, h, 0, gl.RGBA, gl.UNSIGNED_BYTE, null);
    return t;
  }
  function target(gl, w, h) {
    const t = tex(gl, w, h);
    const f = gl.createFramebuffer();
    gl.bindFramebuffer(gl.FRAMEBUFFER, f);
    gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0, gl.TEXTURE_2D, t, 0);
    return { t, f, w, h };
  }

  function setupGL() {
    const gl = S.gl;
    S.prog = {
      scene: compile(gl, VS_FULL, FS_SCENE), down: compile(gl, VS_FULL, FS_DOWN),
      glass: compile(gl, VS_BOX, FS_GLASS), shade: compile(gl, VS_BOX, FS_SHADE), ball: compile(gl, VS_BOX, FS_BALL),
      bright: compile(gl, VS_FULL, FS_BRIGHT), post: compile(gl, VS_FULL, FS_POST),
    };
    S.vao = gl.createVertexArray();
    gl.bindVertexArray(S.vao);
    const quad = gl.createBuffer();
    gl.bindBuffer(gl.ARRAY_BUFFER, quad);
    gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([-1, -1, 1, -1, -1, 1, 1, 1]), gl.STATIC_DRAW);
    gl.enableVertexAttribArray(0); gl.vertexAttribPointer(0, 2, gl.FLOAT, false, 0, 0);
    S.inst = gl.createBuffer();
    gl.bindBuffer(gl.ARRAY_BUFFER, S.inst);
    gl.enableVertexAttribArray(1); gl.vertexAttribPointer(1, 4, gl.FLOAT, false, 32, 0); gl.vertexAttribDivisor(1, 1);
    gl.enableVertexAttribArray(2); gl.vertexAttribPointer(2, 4, gl.FLOAT, false, 32, 16); gl.vertexAttribDivisor(2, 1);
    S.sceneTex = tex(gl, 0, 0);
    S.dummy = tex(gl, 1, 1);
    S.memTex = tex(gl, 0, 0, gl.NEAREST);
    gl.bindTexture(gl.TEXTURE_2D, S.memTex);
    gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA32F, TEXELS, MAX_MEMBERS, 0, gl.RGBA, gl.FLOAT, null);
    S.mem = new Float32Array(TEXELS * 4 * MAX_MEMBERS);
  }
  function sizeTargets() {
    const gl = S.gl;
    const dpr = window.devicePixelRatio || 1;
    // always the full device resolution: the canvas, the scene capture and the sharp refraction path are 1:1 pixels
    const W = Math.max(2, Math.round(window.innerWidth * dpr)), H = Math.max(2, Math.round(window.innerHeight * dpr));
    S.k = dpr;   // page zoom changes devicePixelRatio without changing the canvas size
    if (W === S.W && H === S.H && S.A) return;
    S.W = W; S.H = H;
    S.canvas.width = W; S.canvas.height = H;
    for (const t of [S.A, S.B, S.E, ...(S.P || []), ...(S.G || [])]) if (t) { gl.deleteTexture(t.t); gl.deleteFramebuffer(t.f); }
    S.E = null; S.G = null;   // the optional light targets are made on first use, at the new size
    S.A = target(gl, W, H); S.B = target(gl, W, H);
    S.P = [];
    let w = W, h = H;
    for (let i = 0; i < 5; i++) { w = Math.max(1, w >> 1); h = Math.max(1, h >> 1); S.P.push(target(gl, w, h)); }
    S.dirty = true;
  }

  /* ---------------------------------------------------------------- surfaces */
  function rgb(css) {
    const m = String(css || '').match(/rgba?\(([^)]+)\)/);
    if (!m) return null;
    const v = m[1].split(/[ ,/]+/).filter(Boolean).map(Number);
    return [v[0] / 255, v[1] / 255, v[2] / 255, v[3] == null ? 1 : v[3]];
  }
  function sigOf(el) { return el.className + '|' + (el.getAttribute('aria-pressed') || '') + (el.getAttribute('aria-checked') || '') + '|' + (el.getAttribute('style') || ''); }
  function styleOf(el, kind) {
    const cs = getComputedStyle(el);
    const r = parseFloat(cs.borderTopLeftRadius) || 0;
    const own = rgb(cs.getPropertyValue('--glass-tint'));
    const dens = parseFloat(cs.getPropertyValue('--glass-density'));
    const ctl = kind === 'control';
    const fill = kind === 'indicator' || (ctl && el.matches(ACCENT_FILL));
    const danger = ctl && !fill && el.classList.contains('danger');
    const soft = !fill && !danger && !own && el.matches(ACCENT_SOFT);
    const accentAttr = fill ? 'fill' : soft ? 'soft' : '';
    if ((el.dataset.prismAccent || '') !== accentAttr) { if (accentAttr) el.dataset.prismAccent = accentAttr; else delete el.dataset.prismAccent; }
    const k = kind === 'inset' ? 1.15 : ctl ? 1.1 : 1;            // controls and fields a touch denser than panels
    return {
      radius: r, n: r > 0 ? 4 : 2, sig: sigOf(el),
      tint: own ? own.slice(0, 3) : danger ? [1, .32, .38] : fill || soft ? OPT.accent : OPT.tint,
      density: !isNaN(dens) ? dens : fill || danger ? .78 : soft ? .3 : Math.min(1, OPT.tintA * k),
      dyed: own || fill || danger ? 1 : 0,
      milk: fill || danger ? .26 : soft ? OPT.milk * .5 : Math.min(.9, OPT.milk * (kind === 'inset' ? 1.6 : ctl ? 1.35 : 1)),
      inset: kind === 'inset',
    };
  }
  function scrollersOf(el) {
    const out = [];
    for (let p = el.parentElement; p && p !== document.body; p = p.parentElement) {
      const cs = getComputedStyle(p);
      if (/(auto|scroll|hidden|clip)/.test(cs.overflow + cs.overflowX + cs.overflowY)) out.push(p);
    }
    return out;
  }
  function kindOf(el) {
    if (el.matches('input, textarea, select')) return 'inset';
    if (OPT.controls.length && el.matches(OPT.controls.join(','))) return 'control';
    return 'surface';
  }
  function discover() {
    if (!S.on) return;
    const sel = [...OPT.targets, ...OPT.controls].join(',');
    const found = sel ? Array.from(document.querySelectorAll(sel)) : [];
    const keep = new Set();
    const list = [];
    for (const el of found) {
      if (el.closest(OPT.exclude)) continue;
      const anc = el.parentElement && el.parentElement.closest(OPT.blockers);
      if (anc && !keep.has(anc)) continue;                    // sits on something Prism does not draw
      keep.add(el);
      const kind = kindOf(el);
      let s = S.byEl.get(el);
      if (s && s.st.sig !== sigOf(el)) s.st = styleOf(el, s.kind);   // .on / aria-pressed / inline tint changed
      if (!s) {
        s = { el, kind, st: styleOf(el, kind), scrollers: scrollersOf(el), spring: spring(), press: spring(), prev: null };
        el.dataset.prism = kind;
        if (S.ro) S.ro.observe(el);
      }
      let depth = 1;
      for (let p = el.parentElement; p; p = p.parentElement) if (keep.has(p)) depth++;
      s.depth = depth;
      s.group = el.closest('[data-glass-merge]');
      list.push(s);
    }
    for (const [el, s] of S.byEl) if (!keep.has(el)) { delete el.dataset.prism; delete el.dataset.prismAccent; if (S.ro) S.ro.unobserve(el); S.byEl.delete(el); }
    S.byEl = new Map(list.map(s => [s.el, s]));
    S.surfaces = list;
    discoverIndicators();
    S.dirty = true; kick();
  }
  function restyle() { for (const s of S.surfaces) s.st = styleOf(s.el, s.kind); for (const i of S.indicators) i.st = styleOf(i.active || i.container, 'indicator'); S.dirty = true; kick(); }

  // Selection indicators: one glass pill per container that springs to the active item.
  function discoverIndicators() {
    const next = [];
    for (const spec of OPT.indicators) {
      for (const c of document.querySelectorAll(spec.container)) {
        if (c.closest(OPT.exclude)) continue;
        const anc = c.closest(OPT.blockers);
        if (anc && !S.byEl.has(anc)) continue;
        let ind = S.indicators.find(x => x.container === c);
        const active = c.querySelector(spec.active);
        if (!ind) ind = { container: c, active: null, pos: null, vel: [0, 0, 0, 0], st: null, scrollers: scrollersOf(c), press: spring() };
        if (ind.active && ind.active !== active) { delete ind.active.dataset.prism; delete ind.active.dataset.prismAccent; }
        ind.active = active;
        if (active) active.dataset.prism = 'indicator';
        ind.st = styleOf(active || c, 'indicator');
        let depth = 1;
        for (let p = c; p; p = p.parentElement) { const s = S.byEl.get(p); if (s) { depth = s.depth + 1; break; } }
        ind.depth = depth;
        next.push(ind);
      }
    }
    for (const i of S.indicators) if (!next.includes(i) && i.active) delete i.active.dataset.prism;
    S.indicators = next;
  }

  /* ---------------------------------------------------------------- springs */
  function spring() { return { x: 0, v: 0, t: 0 }; }
  function step(sp, dt, k = 420, c = 22) {   // slightly underdamped: liquid wobble, settles in ~0.4 s
    const a = -k * (sp.x - sp.t) - c * sp.v;
    sp.v += a * dt; sp.x += sp.v * dt;
    const still = Math.abs(sp.x - sp.t) < 1e-3 && Math.abs(sp.v) < 1e-2;
    if (still) { sp.x = sp.t; sp.v = 0; }
    return !still;
  }

  /* ---------------------------------------------------------------- frame */
  function clipOf(scrollers, k) {
    let x0 = 0, y0 = 0, x1 = window.innerWidth, y1 = window.innerHeight;
    for (const p of scrollers) { const r = p.getBoundingClientRect(); x0 = Math.max(x0, r.left); y0 = Math.max(y0, r.top); x1 = Math.min(x1, r.right); y1 = Math.min(y1, r.bottom); }
    return [x0 * k, y0 * k, x1 * k, y1 * k];
  }
  function writeMember(i, cx, cy, hw, hh, st, k, extra) {
    const m = S.mem, o = i * TEXELS * 4;
    const minHalf = Math.min(hw, hh);
    // never deeper than the corner can round: a wider bevel creases into bright triangles at the corners
    const bezel = Math.max(3, Math.min(Math.min(st.radius * 1.15 + 4, minHalf * .9, 30) * OPT.bezel, st.radius * 1.15 + 4, minHalf * .9)) * k;
    m[o] = cx; m[o + 1] = cy; m[o + 2] = hw * k; m[o + 3] = hh * k;
    m[o + 4] = st.radius * k; m[o + 5] = st.n; m[o + 6] = bezel; m[o + 7] = OPT.thickness * k * (extra.thick || 1);
    m[o + 8] = st.tint[0]; m[o + 9] = st.tint[1]; m[o + 10] = st.tint[2]; m[o + 11] = st.density;
    m[o + 12] = OPT.ior; m[o + 13] = OPT.dispersion; m[o + 14] = OPT.frost * k * (extra.frost == null ? 1 : extra.frost); m[o + 15] = st.milk;
    m[o + 16] = extra.dir[0]; m[o + 17] = extra.dir[1]; m[o + 18] = extra.stretch; m[o + 19] = extra.press;
    m[o + 20] = extra.clip[0]; m[o + 21] = extra.clip[1]; m[o + 22] = extra.clip[2]; m[o + 23] = extra.clip[3];
    m[o + 24] = 1; m[o + 25] = 1; m[o + 26] = st.inset ? 2 : extra.kind || 0; m[o + 27] = st.dyed || 0;
  }

  function update(dt) {
    const k = S.k;
    let moving = false, n = 0;
    const items = [];
    const motion = OPT.motion && OPT.liquid;
    for (const s of S.surfaces) {
      const r = s.el.getBoundingClientRect();
      if (r.width < 2 || r.height < 2) continue;
      // liquid stretch from movement that is not scrolling (position relative to the scroller's content)
      let dir = [1, 0], stretch = 0;
      if (motion) {
        const sc = s.scrollers[0];
        const sr = sc ? sc.getBoundingClientRect() : { left: 0, top: 0 };
        const rx = r.left + r.width / 2 - sr.left + (sc ? sc.scrollLeft : 0), ry = r.top + r.height / 2 - sr.top + (sc ? sc.scrollTop : 0);
        if (s.prev && dt > 0) {
          const vx = (rx - s.prev[0]) / dt, vy = (ry - s.prev[1]) / dt, sp = Math.hypot(vx, vy);
          s.spring.t = Math.min(.22, sp / 9000);
          if (sp > 1) s.dirv = [vx / sp, vy / sp];
        }
        s.prev = [rx, ry];
        if (step(s.spring, dt)) moving = true;
        if (step(s.press, dt, 600, 20)) moving = true;
        stretch = s.spring.x; dir = s.dirv || dir;
      }
      s.drawn = { left: r.left, top: r.top, width: r.width, height: r.height };
      items.push({ s, depth: s.depth, cx: (r.left + r.width / 2) * k, cy: (r.top + r.height / 2) * k, hw: r.width / 2, hh: r.height / 2, st: s.st,
        extra: { dir, stretch, press: motion ? s.press.x : 0, clip: clipOf(s.scrollers, k), kind: s.kind === 'control' ? 1 : 0, thick: s.kind === 'control' ? .8 : 1 }, group: s.group });
    }
    for (const ind of S.indicators) {
      if (!ind.active) continue;
      const cr = ind.container.getBoundingClientRect(), ar = ind.active.getBoundingClientRect();
      if (ar.width < 2) continue;
      const tgt = [ar.left - cr.left, ar.top - cr.top, ar.width, ar.height];
      // a resize or a zoom moves everything at once: the indicator jumps with the layout instead of gliding after it
      if (!ind.pos || !motion || S.relayout) { ind.pos = tgt.slice(); ind.vel = [0, 0, 0, 0]; }
      let still = true;
      // a soft glide (~0.5 s, barely any overshoot), integrated in small steps so a late frame never makes it skip
      const n = Math.max(1, Math.ceil(dt / (1 / 240))), h = dt / n;
      for (let j = 0; j < 4; j++) {
        for (let i = 0; i < n; i++) { const a = -150 * (ind.pos[j] - tgt[j]) - 21 * ind.vel[j]; ind.vel[j] += a * h; ind.pos[j] += ind.vel[j] * h; }
        if (Math.abs(ind.pos[j] - tgt[j]) > .05 || Math.abs(ind.vel[j]) > .5) still = false; else { ind.pos[j] = tgt[j]; ind.vel[j] = 0; }
      }
      if (!still) moving = true;
      const sp = Math.hypot(ind.vel[0], ind.vel[1]);
      if (step(ind.press, dt, 600, 20)) moving = true;
      ind.drawn = { left: cr.left + ind.pos[0], top: cr.top + ind.pos[1], width: ind.pos[2], height: ind.pos[3], target: { left: ar.left, top: ar.top, width: ar.width, height: ar.height } };
      items.push({ s: ind, depth: ind.depth, cx: (cr.left + ind.pos[0] + ind.pos[2] / 2) * k, cy: (cr.top + ind.pos[1] + ind.pos[3] / 2) * k, hw: ind.pos[2] / 2, hh: ind.pos[3] / 2, st: ind.st,
        extra: { dir: sp > 1 ? [ind.vel[0] / sp, ind.vel[1] / sp] : [1, 0], stretch: Math.min(.22, sp / 3200), press: ind.press.x, clip: clipOf(ind.scrollers, k), kind: 3, thick: .7, frost: .4 }, group: null });
    }
    // members grouped: merge groups share an instance (their members must be adjacent); levels in nesting order
    const gOrder = new Map();
    items.forEach((it, i) => { const key = it.group || it; if (!gOrder.has(key)) gOrder.set(key, i); it.gkey = gOrder.get(key); });
    items.sort((a, b) => a.depth - b.depth || a.gkey - b.gkey);
    const levels = new Map();
    const groupIdx = new Map();
    for (const it of items) {
      if (n >= MAX_MEMBERS) break;
      writeMember(n, it.cx, it.cy, it.hw, it.hh, it.st, k, it.extra);
      it.index = n++;
      if (!levels.has(it.depth)) levels.set(it.depth, { groups: [], members: [] });
      const L = levels.get(it.depth);
      L.members.push(it);
      const key = it.group ? it.group : it;
      let g = groupIdx.get(key);
      if (!g || g.depth !== it.depth || g.members.length >= 8 || g.members[g.members.length - 1].index !== it.index - 1) {
        g = { depth: it.depth, members: [], merge: it.group ? (parseFloat(it.group.dataset.glassMerge) || OPT.mergeRadius) * k : 0 };
        groupIdx.set(key, g); L.groups.push(g);
      }
      g.members.push(it);
    }
    if (S.relayout && performance.now() - S.relayout > 250) S.relayout = 0;   // the window has settled
    S.levels = [...levels.entries()].sort((a, b) => a[0] - b[0]).map(e => e[1]);
    S.memberCount = n;
    S.stats.surfaces = n;
    return moving;
  }

  function bubbles() {
    if (!OPT.bubbles) return [];
    const k = S.k, out = [];
    for (const b of document.querySelectorAll(OPT.bubbles)) {
      const r = b.getBoundingClientRect();
      if (r.width < 4) continue;
      // living bubbles (src/kit/bubbles.js) carry a membrane wobble and a seed for the jiggle
      out.push((r.left + r.width / 2) * k, (r.top + r.height / 2) * k, r.width / 2 * k, Math.min(.99, Math.max(0, b._wob || 0)), b._seed || 0, 0, 0, 0);
    }
    return out;
  }

  /* ---------------------------------------------------------------- render */
  function full(prog, srcTex, dstFbo, w, h, setup) {
    const gl = S.gl;
    gl.bindFramebuffer(gl.FRAMEBUFFER, dstFbo);
    gl.viewport(0, 0, w, h);
    gl.useProgram(prog.p);
    gl.activeTexture(gl.TEXTURE0); gl.bindTexture(gl.TEXTURE_2D, srcTex);
    gl.uniform1i(prog.u.uTex, 0);
    if (setup) setup(prog);
    gl.disableVertexAttribArray(1); gl.disableVertexAttribArray(2);   // full-screen passes use no instance data
    gl.drawArrays(gl.TRIANGLE_STRIP, 0, 4);
  }
  function blit(src, dst) {
    const gl = S.gl;
    gl.bindFramebuffer(gl.READ_FRAMEBUFFER, src.f);
    gl.bindFramebuffer(gl.DRAW_FRAMEBUFFER, dst ? dst.f : null);
    gl.blitFramebuffer(0, 0, S.W, S.H, 0, 0, S.W, S.H, gl.COLOR_BUFFER_BIT, gl.NEAREST);
  }
  function pyramid(src) {
    const gl = S.gl;
    gl.disable(gl.BLEND);
    let prev = src;
    for (const p of S.P) {
      full(S.prog.down, prev.t, p.f, p.w, p.h, pr => gl.uniform2f(pr.u.uTexel, 1 / prev.w, 1 / prev.h));
      prev = p;
    }
  }
  // The optional light passes (wallpaper light, glow, haze) on the ground, before bubbles and glass. Each runs only
  // while its setting is above 0. They read a pyramid of the ground; the glass levels rebuild their own afterwards.
  function lightPasses(q) {
    const gl = S.gl, W = S.W, H = S.H;
    const env = OPT.envLight > 0, glow = OPT.glow > 0, haze = OPT.haze > 0;
    if (!env && !glow && !haze) return;
    pyramid(S.B);
    if (env) {
      // wallpaper light: a copy of the 1/16 level, coarse enough to be cheap and stable, kept for the whole frame
      const src = S.P[3];
      if (!S.E) S.E = target(gl, src.w, src.h);
      gl.bindFramebuffer(gl.READ_FRAMEBUFFER, src.f); gl.bindFramebuffer(gl.DRAW_FRAMEBUFFER, S.E.f);
      gl.blitFramebuffer(0, 0, src.w, src.h, 0, 0, src.w, src.h, gl.COLOR_BUFFER_BIT, gl.NEAREST);
    }
    if (!glow && !haze) return;
    const levels = Math.max(1, Math.min(5, q.glow || 5));
    if (glow) {
      if (!S.G) S.G = S.P.map(p => target(gl, p.w, p.h));
      full(S.prog.bright, S.P[0].t, S.G[0].f, S.G[0].w, S.G[0].h, pr => gl.uniform1f(pr.u.uThr, Math.min(.95, OPT.glowThreshold)));
      for (let i = 1; i < levels; i++) { const prev = S.G[i - 1], p = S.G[i]; full(S.prog.down, prev.t, p.f, p.w, p.h, pr => gl.uniform2f(pr.u.uTexel, 1 / prev.w, 1 / prev.h)); }
    }
    full(S.prog.post, S.B.t, S.A.f, W, H, pr => {
      const bind = (name, t, unit) => { if (pr.u[name]) { gl.activeTexture(gl.TEXTURE0 + unit); gl.bindTexture(gl.TEXTURE_2D, t); gl.uniform1i(pr.u[name], unit); } };
      bind('uH2', S.P[1].t, 1); bind('uH4', S.P[3].t, 2);
      for (let i = 0; i < 5; i++) bind('uG' + (i + 1), (S.G ? S.G[i] : S.P[i]).t, 3 + i);
      gl.activeTexture(gl.TEXTURE0);
      gl.uniform3f(pr.u.uLightCol, OPT.light[0], OPT.light[1], OPT.light[2]);
      gl.uniform1f(pr.u.uGlow, glow ? OPT.glow : 0); gl.uniform1f(pr.u.uSize, OPT.glowSize); gl.uniform1f(pr.u.uHal, OPT.halation);
      gl.uniform1f(pr.u.uHaze, haze ? OPT.haze : 0); gl.uniform1i(pr.u.uGLevels, levels); gl.uniform1i(pr.u.uSmooth, q.smooth);
    });
    const t = S.A; S.A = S.B; S.B = t;   // the lit ground is now the scene
  }
  // The env sampler always points at its own unit with a real texture (a 1x1 stand-in while off): WebGL rejects a
  // draw whose sampler unit holds the texture being rendered to, even when the shader never reads it.
  function bindEnv(pr, unit) {
    const gl = S.gl, on = OPT.envLight > 0 && !!S.E;
    if (pr.u.uEnv) gl.uniform1f(pr.u.uEnv, on ? OPT.envLight : 0);
    if (pr.u.uEnvTex) { gl.activeTexture(gl.TEXTURE0 + unit); gl.bindTexture(gl.TEXTURE_2D, on ? S.E.t : S.dummy); gl.uniform1i(pr.u.uEnvTex, unit); }
  }
  function common(pr) {
    const gl = S.gl;
    const a = OPT.lightAngle * Math.PI / 180;
    gl.uniform2f(pr.u.uRes, S.W, S.H);
    if (pr.u.uLight2D) gl.uniform2f(pr.u.uLight2D, -Math.sin(a), Math.cos(a));
    if (pr.u.uLightCol) gl.uniform3f(pr.u.uLightCol, OPT.light[0], OPT.light[1], OPT.light[2]);
    const hl = OPT.hl || OPT.light;
    if (pr.u.uHlCol) gl.uniform3f(pr.u.uHlCol, hl[0], hl[1], hl[2]);
    if (pr.u.uMem) { gl.activeTexture(gl.TEXTURE7); gl.bindTexture(gl.TEXTURE_2D, S.memTex); gl.uniform1i(pr.u.uMem, 7); }
  }
  function drawBoxes(data) {
    const gl = S.gl;
    if (!data.length) return;
    gl.bindBuffer(gl.ARRAY_BUFFER, S.inst);
    gl.bufferData(gl.ARRAY_BUFFER, data, gl.STREAM_DRAW);
    gl.enableVertexAttribArray(1); gl.enableVertexAttribArray(2);
    gl.drawArraysInstanced(gl.TRIANGLE_STRIP, 0, 4, data.length / 8);
  }

  // Optional GPU timing (Prism.measure(true)): EXT_disjoint_timer_query_webgl2, read back a few frames later.
  function gpuBegin() {
    if (!S.measure || !S.timer) return null;
    const gl = S.gl, q = gl.createQuery();
    gl.beginQuery(S.timer.TIME_ELAPSED_EXT, q);
    return q;
  }
  function gpuEnd(q) {
    if (!q) return;
    const gl = S.gl;
    gl.endQuery(S.timer.TIME_ELAPSED_EXT);
    S.queries.push(q);
    while (S.queries.length && gl.getQueryParameter(S.queries[0], gl.QUERY_RESULT_AVAILABLE)) {
      const r = S.queries.shift();
      if (!gl.getParameter(S.timer.GPU_DISJOINT_EXT)) { const ms = gl.getQueryParameter(r, gl.QUERY_RESULT) / 1e6; S.gpu.push(ms); if (S.gpu.length > 120) S.gpu.shift(); S.stats.gpuMs = +(S.gpu.reduce((a, b) => a + b, 0) / S.gpu.length).toFixed(3); S.stats.gpuMax = +Math.max(...S.gpu).toFixed(3); }
      gl.deleteQuery(r);
    }
  }

  function render() {
    const gl = S.gl, t0 = performance.now();
    const gq = gpuBegin();
    const W = S.W, H = S.H, k = S.k, q = QUALITY[S.q] || QUALITY.high;
    gl.bindVertexArray(S.vao);
    gl.disable(gl.DEPTH_TEST);
    // member data
    gl.bindTexture(gl.TEXTURE_2D, S.memTex);
    if (S.memberCount) gl.texSubImage2D(gl.TEXTURE_2D, 0, 0, 0, TEXELS, S.memberCount, gl.RGBA, gl.FLOAT, S.mem, 0);

    // ground: the live backdrop, then glass bubbles
    gl.disable(gl.BLEND);
    full(S.prog.scene, S.sceneTex, S.B.f, W, H);
    lightPasses(q);
    const balls = bubbles();
    if (balls.length) {
      blit(S.B, S.A);
      gl.bindFramebuffer(gl.FRAMEBUFFER, S.B.f); gl.viewport(0, 0, W, H);
      gl.enable(gl.BLEND); gl.blendFunc(gl.SRC_ALPHA, gl.ONE_MINUS_SRC_ALPHA);
      const pr = S.prog.ball; gl.useProgram(pr.p); common(pr);
      gl.activeTexture(gl.TEXTURE0); gl.bindTexture(gl.TEXTURE_2D, S.A.t); gl.uniform1i(pr.u.uScene, 0);
      gl.uniform1f(pr.u.uShine, OPT.shine); gl.uniform1f(pr.u.uIris, OPT.iris);
      if (pr.u.uBLens) gl.uniform1f(pr.u.uBLens, OPT.bubbleLens > 0 ? OPT.bubbleLens : 0);
      if (pr.u.uDisp) gl.uniform1f(pr.u.uDisp, OPT.dispersion);
      if (pr.u.uK) gl.uniform1f(pr.u.uK, k);
      bindEnv(pr, 1);
      if (pr.u.uTime) gl.uniform1f(pr.u.uTime, (performance.now() / 1000) % 3600);
      const data = new Float32Array(balls.length);
      for (let i = 0; i < balls.length; i += 8) {
        const cx = balls[i], cy = balls[i + 1], r = balls[i + 2], amp = balls[i + 3];
        const R = r * (1.55 + amp * 1.6) + 2;   // room for the wobble and the shadow beside it
        data.set([cx - R, cy - R, cx + R, cy + R, cx, cy, r, amp ? Math.floor(balls[i + 4] * 997) + amp : 1], i);
      }
      // the box shader reads aBox (x0,y0,x1,y1) and passes aInfo (cx, cy, r, alpha)
      drawBoxes(data);
    }

    // levels: shadows and caustics onto what lies beneath, then the glass of that level
    for (const L of S.levels || []) {
      blit(S.B, S.A);
      gl.bindFramebuffer(gl.FRAMEBUFFER, S.A.f); gl.viewport(0, 0, W, H);
      gl.enable(gl.BLEND);
      const sh = S.prog.shade; gl.useProgram(sh.p); common(sh);
      gl.uniform1f(sh.u.uShadow, OPT.shadow); gl.uniform1f(sh.u.uCaustic, OPT.caustics);
      bindEnv(sh, 0);
      const pad = 48 * k;
      const sd = new Float32Array(L.members.length * 8);
      L.members.forEach((m, j) => {
        const hw = m.hw * k, hh = m.hh * k, elev = (7 + 5 * (m.depth - 1)) * k * (m.extra.kind === 1 ? .55 : 1);
        sd.set([m.cx - hw - pad, m.cy - hh - pad, m.cx + hw + pad, m.cy + hh + pad, m.index, elev, 0, 0], j * 8);
      });
      if (OPT.shadow > 0) { gl.blendFunc(gl.SRC_ALPHA, gl.ONE_MINUS_SRC_ALPHA); gl.uniform1i(sh.u.uMode, 0); drawBoxes(sd); }
      if (OPT.caustics > 0 && q.caustics) { gl.blendFunc(gl.ONE, gl.ONE); gl.uniform1i(sh.u.uMode, 1); drawBoxes(sd); }
      pyramid(S.A);
      blit(S.A, S.B);
      gl.bindFramebuffer(gl.FRAMEBUFFER, S.B.f); gl.viewport(0, 0, W, H);
      gl.enable(gl.BLEND); gl.blendFunc(gl.SRC_ALPHA, gl.ONE_MINUS_SRC_ALPHA);
      const pr = S.prog.glass; gl.useProgram(pr.p); common(pr);
      const units = [S.A, ...S.P];
      ['uSrc', 'uP1', 'uP2', 'uP3', 'uP4', 'uP5'].forEach((name, i) => { gl.activeTexture(gl.TEXTURE0 + i); gl.bindTexture(gl.TEXTURE_2D, units[i].t); gl.uniform1i(pr.u[name], i); });
      const P = S.pointer;
      gl.uniform4f(pr.u.uPointer, P.x * k, P.y * k, OPT.pointerLight && OPT.motion ? P.w * .7 : 0, 520 * k);
      gl.uniform1f(pr.u.uShine, OPT.shine); gl.uniform1f(pr.u.uRimClear, OPT.rimClear);
      gl.uniform1f(pr.u.uAdaptive, OPT.adaptive ? 1 : 0); gl.uniform1f(pr.u.uTextLight, OPT.textLight ? 1 : 0);
      gl.uniform1f(pr.u.uIris, OPT.iris); gl.uniform1i(pr.u.uSpectral, q.spectral);
      if (pr.u.uSmooth) gl.uniform1i(pr.u.uSmooth, q.smooth);
      if (pr.u.uBulge) gl.uniform1f(pr.u.uBulge, OPT.bulge > 0 ? OPT.bulge : 0);
      bindEnv(pr, 6);
      // the glow's bright-pass light (1/8 level), caught by the glass; a 1x1 stand-in while glow is off
      const glowOn = OPT.glow > 0 && !!S.G;
      if (pr.u.uGlowTex) { gl.activeTexture(gl.TEXTURE8); gl.bindTexture(gl.TEXTURE_2D, glowOn ? S.G[2].t : S.dummy); gl.uniform1i(pr.u.uGlowTex, 8); }
      if (pr.u.uGlowG) gl.uniform1f(pr.u.uGlowG, glowOn ? OPT.glow * .9 : 0);
      gl.activeTexture(gl.TEXTURE0);
      const gd = new Float32Array(L.groups.length * 8);
      const m2 = 3 * k;
      L.groups.forEach((g, j) => {
        let x0 = 1e9, y0 = 1e9, x1 = -1e9, y1 = -1e9;
        for (const m of g.members) {
          const s = 1 + (m.extra.stretch || 0) + .05;
          x0 = Math.min(x0, m.cx - m.hw * k * s); y0 = Math.min(y0, m.cy - m.hh * k * s);
          x1 = Math.max(x1, m.cx + m.hw * k * s); y1 = Math.max(y1, m.cy + m.hh * k * s);
        }
        const e = (g.merge ? g.merge + m2 : 0) + 2;
        gd.set([x0 - e, y0 - e, x1 + e, y1 + e, g.members[0].index, g.members.length, g.merge, 0], j * 8);
      });
      drawBoxes(gd);
    }
    // present
    gl.disable(gl.BLEND);
    blit(S.B, null);
    gpuEnd(gq);
    S.stats.ms = +(performance.now() - t0).toFixed(2);
    S.stats.frames++;
  }

  /* ---------------------------------------------------------------- loop */
  let last = 0, kicked = false, kickedAt = 0;
  // A requested paint can be dropped (a resize or a DPI change while it is pending): ask again if it has not
  // arrived after a while, or the glass would freeze where it was until something else happened to repaint.
  function kick() {
    if (!S.on) return;
    const now = performance.now();
    if (kicked && now - kickedAt < 300) return;
    kicked = true; kickedAt = now; S.canvas.requestPaint();
    clearTimeout(kick.t); kick.t = setTimeout(() => { if (kicked && S.on) kick(); }, 320);   // still waiting: ask again
  }
  function onPaint(ev) {
    kicked = false; clearTimeout(kick.t);
    if (!S.on) return;
    try {
      const now = performance.now();
      const dt = last ? Math.min(.05, (now - last) / 1000) : 1 / 60;
      last = now;
      const changed = ev && ev.changedElements ? Array.from(ev.changedElements) : null;
      if (S.sceneDirty || !changed || changed.length) {
        const gl = S.gl;
        gl.bindTexture(gl.TEXTURE_2D, S.sceneTex);
        upload(gl, S.backdrop, S.W, S.H);
        S.sceneDirty = false;
      }
      if (S.needDiscover) { S.needDiscover = false; discover(); }
      sizeTargets();
      scrollTick(dt);
      // pointer light fades in and out smoothly
      const P = S.pointer; const pw = P.w; P.w += (P.target - P.w) * Math.min(1, dt * 8);
      const moving = update(dt) || Math.abs(P.w - pw) > .002 || S.scrollAnimating;
      // ambient animation alone (bubbles) renders at 60 fps even on high-refresh displays; interaction gets every frame
      const ambient = !moving && !S.transitions && !S.needDiscover && !(changed && changed.length);
      if (ambient && S.lastRender && now - S.lastRender < 15.5) { if (S.bubbling) kick(); return; }
      S.lastRender = now;
      render();
      governor(now, S.wantNext);
      S.dirty = false;
      S.wantNext = !!(moving || S.bubbling || S.transitions > 0);
      if (S.wantNext) kick();
    } catch (e) { fail(e); }
  }
  // Auto quality. Only frames rendered back to back (an animation or interaction asked for the next one) count;
  // the gaps of an idle UI, start-up work and hidden or minimised windows are not slowness. It steps effect
  // costs down when frames are slow and back up when they are fine again; the resolution never changes.
  function governor(now, continuous) {
    const G = S.gov;
    S.stats.scale = 1;
    if (OPT.quality !== 'auto') { S.q = QUALITY[OPT.quality] ? OPT.quality : 'high'; S.stats.quality = S.q; S.frames.length = 0; return; }
    const f = S.frames, prev = S.lastFrameAt || 0;
    S.lastFrameAt = now;
    const warm = now - (S.startedAt || 0) > 3000;
    if (!warm || document.hidden || !continuous || !prev || now - prev > 250) { if (now - prev > 250) f.length = 0; S.stats.quality = S.q; return; }
    f.push(now - prev); if (f.length > 90) f.shift();
    if (f.length >= 45) {
      const sorted = f.slice().sort((a, b) => a - b), med = sorted[sorted.length >> 1];
      S.stats.fps = Math.round(1000 / med);
      const i = ORDER.indexOf(S.q);
      if (med > 24 && i < ORDER.length - 1) { S.q = ORDER[i + 1]; f.length = 0; G.at = now; G.hold = Math.min(60000, G.hold * 2); }
      else if (med < 18.5 && i > 0 && now - G.at > G.hold) { S.q = ORDER[i - 1]; f.length = 0; G.at = now; }
      else if (med < 18.5 && i === 0 && now - G.at > 30000) G.hold = Math.max(4000, G.hold / 2);   // steady: forgive old slow spells
    }
    S.stats.quality = S.q;
  }

  /* ---------------------------------------------------------------- scrolling in step with the glass */
  function scrollerFor(t) {
    for (let p = t; p && p !== document.documentElement; p = p.parentElement) {
      if (p.nodeType !== 1) continue;
      const cs = getComputedStyle(p);
      if (/(auto|scroll)/.test(cs.overflowY) && p.scrollHeight > p.clientHeight + 1) return p;
    }
    return null;
  }
  function onWheel(e) {
    if (!S.on || !OPT.smoothScroll || e.ctrlKey || e.defaultPrevented || Math.abs(e.deltaX) > Math.abs(e.deltaY)) return;
    if (e.target.closest && e.target.closest('textarea, select, [data-native-scroll]')) return;
    const sc = scrollerFor(e.target);
    if (!sc || !S.surfaces.some(s => s.scrollers.includes(sc))) return;   // only where glass rides on the scroll
    const max = sc.scrollHeight - sc.clientHeight;
    let st = S.scroll.get(sc);
    if (!st) { st = { y: sc.scrollTop, t: sc.scrollTop }; S.scroll.set(sc, st); }
    const unit = e.deltaMode === 1 ? 16 : e.deltaMode === 2 ? sc.clientHeight : 1;
    const nt = Math.max(0, Math.min(max, st.t + e.deltaY * unit));
    if ((nt === st.t) && (st.t <= 0 || st.t >= max)) return;   // at the end: let the parent scroll
    e.preventDefault();
    st.t = nt;
    if (!OPT.motion) { st.y = st.t; sc.scrollTop = st.y; }
    S.scrollAnimating = true; kick();
  }
  function scrollTick(dt) {
    let any = false;
    for (const [sc, st] of S.scroll) {
      if (Math.abs(sc.scrollTop - st.y) > 1.5) { st.y = st.t = sc.scrollTop; continue; }   // moved by keys or the scrollbar
      const d = st.t - st.y;
      if (Math.abs(d) < .4) { st.y = st.t; } else { st.y += d * Math.min(1, dt * 16); any = true; }
      sc.scrollTop = st.y;
    }
    S.scrollAnimating = any;
  }

  /* ---------------------------------------------------------------- lifecycle */
  function fail(e) {
    console.warn('Prism stopped:', e && e.message || e);
    const fns = S.failFns.slice();
    stop();
    for (const f of fns) { try { f(e); } catch (x) {} }
  }
  const onScroll = () => { S.dirty = true; kick(); };
  const onResize = () => { S.dirty = true; S.sceneDirty = true; S.relayout = performance.now(); kicked = false; kick(); };
  const onVisible = () => { S.frames.length = 0; S.lastFrameAt = 0; if (!document.hidden) { S.sceneDirty = true; kick(); } };
  const onMove = (e) => { S.pointer.x = e.clientX; S.pointer.y = e.clientY; S.pointer.target = 1; if (OPT.pointerLight) kick(); };
  const onLeave = () => { S.pointer.target = 0; kick(); };
  // Pressing squashes only things you press (buttons, chips, switches, selections) — never a panel, a card or
  // anything you type into, which would shrink and shift under the caret. The squash is kept gentle.
  const TYPING = 'input, textarea, select, [contenteditable=""], [contenteditable="true"], .cm-editor';
  const onDown = (e) => {
    const t = e.target; if (!t || !t.closest || t.closest(TYPING)) return;
    const el = t.closest('[data-prism]');
    const s = el && (S.byEl.get(el) || S.indicators.find(i => i.active === el));
    if (!s || !s.press || (s.kind && s.kind !== 'control') || el.matches(TYPING)) return;
    s.press.t = .55; S.pressed = s; kick();
  };
  const onUp = () => { if (S.pressed) { S.pressed.press.t = 0; S.pressed = null; kick(); } };
  const onTransStart = () => { S.transitions++; kick(); };
  const onTransEnd = () => { S.transitions = Math.max(0, S.transitions - 1); kick(); };

  function start(opts) {
    Object.assign(OPT, opts || {});
    if (S.on) { set({}); return true; }
    if (!supported()) return false;
    const backdrop = document.getElementById('gk-backdrop');
    if (!backdrop) return false;
    const cv = document.createElement('canvas');
    cv.id = 'gk-prism';
    cv.setAttribute('layoutsubtree', ''); cv.setAttribute('content', 'drawable');
    cv.setAttribute('aria-hidden', 'true');
    let gl;
    try { gl = cv.getContext('webgl2', { alpha: false, antialias: false, depth: false, stencil: false, premultipliedAlpha: false, preserveDrawingBuffer: false, powerPreference: 'high-performance' }); } catch (e) {}
    if (!gl) return false;
    S.canvas = cv; S.gl = gl; S.on = true; S.transitions = 0; S.startedAt = performance.now(); S.frames = []; S.lastFrameAt = 0;
    if (OPT.quality === 'auto' && !QUALITY[S.q]) S.q = 'high';
    S.backdrop = backdrop; S.backdropHome = { parent: backdrop.parentNode, next: backdrop.nextSibling };
    backdrop.parentNode.insertBefore(cv, backdrop);
    backdrop.setAttribute('drawable', '');
    cv.appendChild(backdrop);
    try { setupGL(); sizeTargets(); } catch (e) { fail(e); return false; }
    document.documentElement.classList.add('prism');
    cv.addEventListener('paint', onPaint);
    S.onLost = (e) => { e.preventDefault(); fail(new Error('WebGL context lost')); };
    cv.addEventListener('webglcontextlost', S.onLost);
    S.ro = new ResizeObserver(() => { S.dirty = true; kick(); });
    S.mo = new MutationObserver((muts) => {
      if (muts.every(m => m.type === 'attributes' && m.attributeName === 'data-prism')) return;
      S.needDiscover = true; kick();
    });
    S.mo.observe(document.body, { childList: true, subtree: true, attributes: true, attributeFilter: ['class', 'style', 'data-mat'] });
    addEventListener('scroll', onScroll, { capture: true, passive: true });
    addEventListener('resize', onResize);
    document.addEventListener('visibilitychange', onVisible);
    addEventListener('wheel', onWheel, { capture: true, passive: false });
    addEventListener('pointermove', onMove, { passive: true });
    document.documentElement.addEventListener('pointerleave', onLeave);
    addEventListener('pointerdown', onDown, { passive: true });
    addEventListener('pointerup', onUp, { passive: true }); addEventListener('pointercancel', onUp, { passive: true });
    addEventListener('transitionrun', onTransStart, true); addEventListener('transitionend', onTransEnd, true); addEventListener('transitioncancel', onTransEnd, true);
    S.stats.mode = 'prism';
    set({});
    return true;
  }
  function set(opts) {
    Object.assign(OPT, opts || {});
    if (!S.on) return;
    S.bubbling = !!(OPT.bubbles && OPT.motion && document.querySelector(OPT.bubbles));
    discover();
    restyle();
    S.sceneDirty = true;
    kick();
  }
  function stop() {
    if (!S.on) return;
    S.on = false;
    const cv = S.canvas;
    try { cv.removeEventListener('paint', onPaint); cv.removeEventListener('webglcontextlost', S.onLost); } catch (e) {}   // a deliberate stop is not a failure
    if (S.mo) S.mo.disconnect(); if (S.ro) S.ro.disconnect();
    removeEventListener('scroll', onScroll, { capture: true }); removeEventListener('resize', onResize); document.removeEventListener('visibilitychange', onVisible);
    removeEventListener('wheel', onWheel, { capture: true }); removeEventListener('pointermove', onMove);
    document.documentElement.removeEventListener('pointerleave', onLeave);
    removeEventListener('pointerdown', onDown); removeEventListener('pointerup', onUp); removeEventListener('pointercancel', onUp);
    removeEventListener('transitionrun', onTransStart, true); removeEventListener('transitionend', onTransEnd, true); removeEventListener('transitioncancel', onTransEnd, true);
    for (const s of S.surfaces) { delete s.el.dataset.prism; delete s.el.dataset.prismAccent; }
    for (const i of S.indicators) if (i.active) { delete i.active.dataset.prism; delete i.active.dataset.prismAccent; }
    S.surfaces = []; S.byEl = new Map(); S.indicators = []; S.scroll = new Map();
    const b = S.backdrop;
    if (b) { b.removeAttribute('drawable'); const h = S.backdropHome; if (h && h.parent) h.parent.insertBefore(b, h.next && h.next.parentNode === h.parent ? h.next : null); }
    if (cv) cv.remove();
    try { const lose = S.gl && S.gl.getExtension('WEBGL_lose_context'); if (lose) lose.loseContext(); } catch (e) {}
    S.canvas = S.gl = S.A = S.B = S.P = S.E = S.G = null; S.W = S.H = 0;
    document.documentElement.classList.remove('prism');
    S.stats.mode = 'off';
  }

  root.Prism = {
    supported, start, set, stop,
    refresh() { set({}); },
    get active() { return S.on; },
    get stats() { return Object.assign({}, S.stats); },
    onfail(fn) { S.failFns.push(fn); },
    get quality() { return S.q; },
    // the rectangle (CSS px) the glass of an element was last drawn at, for tests
    rectOf(el) { const s = S.byEl.get(el); return s && s.drawn ? Object.assign({}, s.drawn) : null; },
    // where each selection indicator was last drawn (CSS px) and where its active item is, for tests
    indicatorRects() { return S.indicators.filter(i => i.drawn).map(i => Object.assign({ container: i.container, active: i.active }, i.drawn)); },
    // re-discover and re-measure now (synchronously), as the next frame would
    sync() { if (!S.on) return; discover(); update(0); },
    // average colour (0..1 rgb) of the last rendered frame inside a CSS-px rectangle, e.g. behind the window buttons
    sample(r) {
      if (!S.on || !S.B) return null;
      const gl = S.gl, k = S.k;
      const x = Math.max(0, Math.round(r.x * k)), w = Math.max(1, Math.min(S.W - x, Math.round(r.width * k)));
      const h = Math.max(1, Math.min(S.H, Math.round(r.height * k))), y = Math.max(0, S.H - Math.round(r.y * k) - h);
      const px = new Uint8Array(w * h * 4);
      try { gl.bindFramebuffer(gl.READ_FRAMEBUFFER, S.B.f); gl.readPixels(x, y, w, h, gl.RGBA, gl.UNSIGNED_BYTE, px); } catch (e) { return null; }
      const c = [0, 0, 0];
      for (let i = 0; i < px.length; i += 4) { c[0] += px[i]; c[1] += px[i + 1]; c[2] += px[i + 2]; }
      const n = px.length / 4 * 255;
      return c.map(v => v / n);
    },
    measure(on) { if (!S.gl) return false; S.timer = S.timer || S.gl.getExtension('EXT_disjoint_timer_query_webgl2'); S.measure = !!(on && S.timer); S.queries = S.queries || []; S.gpu = []; return S.measure; },
  };
})(window);
