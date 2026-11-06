#!/usr/bin/env node
/* lint-ui.js — the UI conventions as checks (runs first in `npm test`; `npm run lint:ui` alone).
   Scans the app's own files (src/app, src/addons, and any extra folders in package.json → "lintUi": { "dirs": [] });
   the kit (src/kit) is the reference and is not scanned. Errors fail; warnings print. Silence one line with
   a trailing comment containing  lint-ui: ok   (say why). */
'use strict';
const fs = require('fs'), path = require('path');
const root = path.join(__dirname, '..'), pkg = JSON.parse(fs.readFileSync(path.join(root, 'package.json'), 'utf8'));
const dirs = ['src/app', 'src/addons'].concat((pkg.lintUi && pkg.lintUi.dirs) || []);
const RULES = [
  { ext: /\.css$/, re: /border[\w-]*\s*:[^;]*\b\d*\.?\d+px\s+solid\s+(#fff\b|#ffffff\b|white\b|rgba\(\s*255\s*,\s*255\s*,\s*255)/i, level: 'error', msg: 'flat white border on a surface: use the rim tokens (--rim-*, --hair) or let Prism draw the edge' },
  { ext: /\.css$/, re: /backdrop-filter\s*:[^;]*!important/i, level: 'error', msg: 'backdrop-filter with !important blocks the lens renderer on refracted roles' },
  { ext: /\.css$/, re: /overflow(-[xy])?\s*:\s*hidden/i, level: 'warn', msg: 'overflow: hidden cuts the text outline: use overflow: clip + overflow-clip-margin: padding-box var(--ol-room) (or .gk-ellipsis)' },
  { ext: /\.css$/, re: /font-size\s*:\s*\d+(\.\d+)?px/i, level: 'warn', msg: 'px font size ignores the text-size setting: use em / rem / var(--fs)' },
  { ext: /\.css$/, re: /(grid-template-columns|width|max-width|min-width)\s*:[^;]*\b\d{3,}px/i, skip: /\d+(\.\d+)?em\b|var\(/, level: 'warn', msg: 'wide fixed px layout: size columns that hold text in em so they scale with the text size' },
  { ext: /\.js$/, re: /\blocalStorage\b/, level: 'error', only: /src[\\/]app[\\/]modules/, msg: 'module data belongs in ctx.store(), not localStorage' },
  { ext: /\.js$/, re: /\.clientX\b[^;]*-[^;]*\.(left|style)|style\.(left|top|width|height)\s*=\s*[^;]*clientX|style\.(left|top)\s*=\s*[^;]*clientY/, skip: /GK\.local|zoomOf/, level: 'warn', msg: 'pointer position written to layout: convert with GK.local(el, d) (the app scales with zoom)' }
];
let errors = 0, warns = 0;
function walk(d) { let out = []; if (!fs.existsSync(d)) return out; for (const f of fs.readdirSync(d)) { const p = path.join(d, f); if (fs.statSync(p).isDirectory()) { if (!/node_modules|demo/.test(f)) out = out.concat(walk(p)); } else out.push(p); } return out; }
for (const d of dirs) for (const file of walk(path.join(root, d))) {
  const rel = path.relative(root, file), lines = fs.readFileSync(file, 'utf8').split('\n');
  lines.forEach((line, i) => {
    if (/lint-ui:\s*ok/.test(line)) return;
    for (const r of RULES) if (r.ext.test(file) && (!r.only || r.only.test(rel)) && r.re.test(line) && !(r.skip && r.skip.test(line))) {
      console.log(`${r.level === 'error' ? 'ERROR' : 'warn '} ${rel}:${i + 1}  ${r.msg}`);
      if (r.level === 'error') errors++; else warns++;
    }
  });
}
console.log(errors || warns ? `lint-ui: ${errors} error(s), ${warns} warning(s)` : 'lint-ui: clean');
process.exit(errors ? 1 : 0);
