#!/usr/bin/env node
/* npm run check — fast pre-flight (no app launch, ~1 s). Runs first in `npm test`.
   Syntax of every runtime/tool/test script, plus mistakes that have happened before, written as rules.
   Prints only problems, one line each: file:line [rule] what to do. Exit 1 when any.
   A line that is right despite a rule carries a marker comment naming it, e.g. // check-ok: resize */
'use strict';
const fs = require('fs'), path = require('path'), vm = require('vm');
const root = path.join(__dirname, '..');
const SKIP_DIR = /^(node_modules|release|vendor|shots|target|gen|\.tauri-web|\.private|\.git)$/;
const out = [];
const rel = f => path.relative(root, f).split(path.sep).join('/');
const say = (f, line, rule, msg) => out.push(rel(f) + (line ? ':' + line : '') + '  [' + rule + '] ' + msg);
const ok = (lineText, rule) => new RegExp('check-ok:[^\\n]*\\b' + rule + '\\b').test(lineText);

/** where a // comment starts on a line (not inside a string or a URL), or -1 */
function commentAt(t) {
  let q = null;
  for (let i = 0; i < t.length - 1; i++) {
    const ch = t[i];
    if (q) { if (ch === '\\') i++; else if (ch === q) q = null; continue; }
    if (ch === "'" || ch === '"' || ch === '`') q = ch;
    else if (ch === '/' && t[i + 1] === '/' && t[i - 1] !== ':') return i;
    else if (ch === '/' && t[i + 1] === '*') { const e = t.indexOf('*/', i + 2); if (e < 0) return -1; i = e + 1; }
  }
  return -1;
}
function walk(dir, acc) {
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    if (e.isDirectory()) { if (!SKIP_DIR.test(e.name)) walk(path.join(dir, e.name), acc); }
    else if (/\.(js|css|html|md|json|rs)$/.test(e.name)) acc.push(path.join(dir, e.name));
  }
  return acc;
}
const files = ['src', 'tools', 'test', 'src-tauri/src'].filter(d => fs.existsSync(path.join(root, d))).reduce((a, d) => walk(path.join(root, d), a), [])
  .concat(['main.js', 'preload.js', 'index.html', 'popup.html', 'README.md', 'package.json'].map(f => path.join(root, f)).filter(f => fs.existsSync(f)));

for (const f of files) {
  const src = fs.readFileSync(f, 'utf8'), lines = src.split('\n'), r = rel(f), isJs = /\.js$/.test(f), isCss = /\.css$/.test(f);
  // control characters: an escape (\b, \n …) that went through a shell or a template and became the real byte
  const cc = /[\x00-\x08\x0b\x0c\x0e-\x1f]/.exec(src);
  if (cc) say(f, src.slice(0, cc.index).split('\n').length, 'ctrl-char', 'control character U+00' + cc[0].charCodeAt(0).toString(16).padStart(2, '0') + ' in the source: an escape was mangled on the way in');
  // one line-ending style per file (an edit tool or script that rewrote endings)
  const crlf = (src.match(/\r\n/g) || []).length, lf = (src.match(/\n/g) || []).length - crlf;
  if (crlf && lf) say(f, 0, 'mixed-eol', crlf + ' CRLF and ' + lf + ' LF line endings: keep the file\'s own style');
  if (isJs && !/\.json$/.test(f)) {
    try { new vm.Script(src.replace(/^#!.*/, ''), { filename: r }); }
    catch (e) { const m = /:(\d+)/.exec((e.stack || '').split('\n')[0]); say(f, m ? +m[1] : 0, 'syntax', e.message); }
  }
  lines.forEach((t, i) => {
    const n = i + 1;
    if (isJs) {
      // code swallowed by a // comment (two statements after the //)
      const c = commentAt(t), cm = c >= 0 ? t.slice(c + 2) : '';
      if (cm && /[\w$\]]\([^()]*\);\s*[\w$.]+\s*\(/.test(cm) && !ok(t, 'comment')) say(f, n, 'comment-code', 'statements after // never run: put them on their own line');
      // overlays that follow something re-place on GK 'layout' (resize, UI scale, display), not on window resize
      if (/addEventListener\(\s*['"]resize['"]/.test(t) && !/^src\/kit\//.test(r) && !ok(t, 'resize')) say(f, n, 'resize', "use GK.bus.on('layout', …): a UI scale or display change fires no resize");
      // a screen measurement written straight into left/top/width/height (zoomed #app needs GK.pointIn / rectIn / local)
      const places = /(\.style\.(left|top|width|height)\s*=|\b(left|top|width|height):\s*[^,}]*(\.left|\.top|clientX|clientY|\.width|\.height))/.test(t);
      const measured = /(getBoundingClientRect|getClientRects|clientX|clientY)/.test(t) || /\b\w+\.(left|top)\s*-\s*\w+\.(left|top)\b/.test(t);   // a rect, a pointer, or rect-minus-container
      if (measured && places
        && !/GK\.(local|pointIn|rectIn|zoomOf|snapPx)|\/\s*z\b/.test(t) && !ok(t, 'screen')) say(f, n, 'screen-px', 'screen px placed as CSS px: use GK.pointIn/rectIn/local, or mark // check-ok: screen when the element is on <body>');
    }
    if (isCss && /\b\d*\.?\d+v[hw]\b/.test(t) && !/--app-v[hw]/.test(t) && !ok(t, 'vh')) {
      // window-sized lengths inside the zoomed #app use --app-vh / --app-vw
      const sel = t.split('{')[0];
      if (/#app\b|\.gk-(page|view|shell|nav|st-rail|panel|widget)\b/.test(sel)) say(f, n, 'vh-in-app', 'raw vh/vw inside #app is multiplied by the UI scale: use var(--app-vh) / var(--app-vw)');
    }
    // the private ledger never reaches tracked files
    if (!/^tools\//.test(r) && /apphub:private-ledger|\.private\/(LEDGER|HUB|INBOX|ENTRIES)/.test(t)) say(f, n, 'private', 'private-ledger text in a tracked file');
  });
}
if (out.length) { console.log(out.join('\n')); console.log('check: ' + out.length + ' problem' + (out.length === 1 ? '' : 's') + ' in ' + files.length + ' files'); process.exit(1); }
console.log('check: ' + files.length + ' files clean');
