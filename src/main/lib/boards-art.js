'use strict';
/* Small original vector pictures for the example world's mood frame (drawn from shapes, no outside art). */

function rng(seed) { let s = seed >>> 0; return () => ((s = (s * 1664525 + 1013904223) >>> 0) / 4294967296); }

/** a drowned tower at night with green lights in its windows */
function stormSpire() {
  const r = rng(7), stars = Array.from({ length: 60 }, () => `<circle cx="${(r() * 800).toFixed(1)}" cy="${(r() * 230).toFixed(1)}" r="${(r() * 1.4 + .3).toFixed(2)}" fill="#e8f3ff" opacity="${(r() * .6 + .3).toFixed(2)}"/>`).join('');
  const waves = Array.from({ length: 9 }, (_, i) => {
    const y = 330 + i * 20, a = 5 + i * 1.5;
    let d = `M0 ${y}`;
    for (let x = 0; x <= 800; x += 40) d += ` Q${x + 20} ${y - a} ${x + 40} ${y}`;
    return `<path d="${d}" fill="none" stroke="#7fd1c7" stroke-opacity="${(.32 - i * .025).toFixed(3)}" stroke-width="2"/>`;
  }).join('');
  return `<svg xmlns="http://www.w3.org/2000/svg" width="800" height="500" viewBox="0 0 800 500">
<defs><linearGradient id="sky" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#0b1426"/><stop offset=".62" stop-color="#173452"/><stop offset="1" stop-color="#1f5a62"/></linearGradient>
<linearGradient id="sea" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#123447"/><stop offset="1" stop-color="#06121c"/></linearGradient>
<radialGradient id="glow" cx=".5" cy=".5" r=".5"><stop offset="0" stop-color="#7dffb0" stop-opacity=".9"/><stop offset="1" stop-color="#7dffb0" stop-opacity="0"/></radialGradient></defs>
<rect width="800" height="500" fill="url(#sky)"/>${stars}
<circle cx="640" cy="90" r="34" fill="#f1ecd9"/><circle cx="652" cy="82" r="30" fill="#162b45" opacity=".9"/>
<circle cx="140" cy="70" r="9" fill="#d0574e" opacity=".85"/>
<rect y="310" width="800" height="190" fill="url(#sea)"/>${waves}
<path d="M352 318 L360 150 L372 132 L384 118 L396 132 L408 150 L416 318 Z" fill="#0a1119"/>
<path d="M366 150 h36 v8 h-36 z" fill="#0a1119"/>
<circle cx="384" cy="170" r="40" fill="url(#glow)"/><circle cx="381" cy="232" r="34" fill="url(#glow)"/>
<rect x="378" y="160" width="12" height="20" rx="6" fill="#9dffc6"/><rect x="375" y="222" width="12" height="20" rx="6" fill="#9dffc6"/><rect x="394" y="270" width="9" height="16" rx="4" fill="#7ae0a8" opacity=".8"/>
<path d="M340 318 Q384 300 428 318" fill="none" stroke="#7fd1c7" stroke-opacity=".5" stroke-width="2"/>
<g fill="#7dffb0" opacity=".18"><rect x="377" y="330" width="14" height="40" rx="7"/><rect x="374" y="390" width="12" height="30" rx="6"/></g>
</svg>`;
}

/** five swatches for a city's colours, with hand-picked names */
function palette() {
  const sw = [['#1f3b4d', 'Harbour slate'], ['#c49a3c', 'Vey gold'], ['#e9e1cf', 'Salt crust'], ['#4fb6b2', 'Shallows'], ['#8e3b35', 'Rust sail']];
  const cells = sw.map(([c, n], i) => `<g transform="translate(${30 + i * 150} 40)"><rect width="130" height="300" rx="16" fill="${c}"/><rect y="250" width="130" height="50" rx="0" fill="#000" opacity=".22"/><text x="65" y="282" font-family="Segoe UI, sans-serif" font-size="15" font-weight="600" fill="#fff" text-anchor="middle">${n}</text><text x="65" y="232" font-family="Consolas, monospace" font-size="13" fill="#fff" opacity=".85" text-anchor="middle">${c}</text></g>`).join('');
  return `<svg xmlns="http://www.w3.org/2000/svg" width="800" height="380" viewBox="0 0 800 380"><rect width="800" height="380" fill="#f6f1e6"/>${cells}</svg>`;
}

/** salt flats under a pale sky: a cracked white crust to the horizon */
function saltFlats() {
  const r = rng(42);
  let cracks = '';
  for (let i = 0; i < 70; i++) {
    const y0 = 250 + Math.pow(r(), 1.6) * 250, x0 = r() * 800, len = 20 + (y0 - 240) * .5;
    let d = `M${x0.toFixed(1)} ${y0.toFixed(1)}`, x = x0, y = y0;
    for (let k = 0; k < 3; k++) { x += (r() - .5) * len; y += (r() - .3) * len * .25; d += ` L${x.toFixed(1)} ${y.toFixed(1)}`; }
    cracks += `<path d="${d}" fill="none" stroke="#b9b2a2" stroke-width="${(.6 + (y0 - 250) / 160).toFixed(2)}" opacity=".8"/>`;
  }
  return `<svg xmlns="http://www.w3.org/2000/svg" width="800" height="500" viewBox="0 0 800 500">
<defs><linearGradient id="s" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#cfe2ea"/><stop offset="1" stop-color="#f4efe2"/></linearGradient>
<linearGradient id="g" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#ece6d6"/><stop offset="1" stop-color="#fbf8f1"/></linearGradient></defs>
<rect width="800" height="250" fill="url(#s)"/><rect y="245" width="800" height="255" fill="url(#g)"/>
<path d="M0 248 Q200 240 400 247 T800 246" fill="none" stroke="#a9b8bd" stroke-width="2"/>
<circle cx="560" cy="120" r="46" fill="#fffdf4" opacity=".9"/>${cracks}
<g fill="#5c5446"><rect x="148" y="232" width="3" height="16"/><rect x="156" y="236" width="3" height="12"/><path d="M140 248 h26 l-4 5 h-18 z"/></g>
</svg>`;
}

module.exports = { stormSpire, palette, saltFlats };
