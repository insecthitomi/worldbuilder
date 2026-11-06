// Release hygiene: refuses to package while local-only files sit in the project.
// Runs before `npm run dist`.
'use strict';
const fs = require('fs');
const path = require('path');

const root = path.join(__dirname, '..');
const LOCAL_ONLY = [/^\.private$/i, /^claude(\.local)?\.md$/i, /\.local\.md$/i, /^\.env(\..*)?$/i, /\.(pem|p12|pfx|key)$/i];
const SKIP = new Set(['node_modules', '.git', 'release', 'shots']);
const found = [];

(function walk(dir, depth) {
  if (depth > 6) return;
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    const rel = path.relative(root, path.join(dir, e.name));
    if (LOCAL_ONLY.some(re => re.test(e.name))) { found.push(rel); continue; }
    if (e.isDirectory() && !SKIP.has(e.name)) walk(path.join(dir, e.name), depth + 1);
  }
})(root, 0);

if (found.length) {
  console.error('Release blocked. Remove these local-only files first:\n  ' + found.join('\n  '));
  process.exit(1);
}
console.log('release guard: clean');
