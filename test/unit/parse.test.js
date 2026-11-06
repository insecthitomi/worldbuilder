'use strict';
/* Every script compiles the way the browser compiles it. tools/check.js reads code by pattern, so a few early errors
   (a const declared twice in one nested block) slip past it and only show up as a screen that never registers. */
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
const vm = require('vm');

const root = path.join(__dirname, '..', '..');
function walk(dir, out = []) {
  for (const d of fs.readdirSync(dir, { withFileTypes: true })) {
    if (d.name === 'node_modules' || d.name.startsWith('.')) continue;
    const p = path.join(dir, d.name);
    if (d.isDirectory()) walk(p, out); else if (d.name.endsWith('.js')) out.push(p);
  }
  return out;
}

test('every script under src/ compiles', () => {
  const bad = [];
  for (const f of walk(path.join(root, 'src'))) {
    const src = fs.readFileSync(f, 'utf8');
    try { vm.compileFunction(src, [], { filename: f }); } catch (e) { bad.push(path.relative(root, f) + ': ' + e.message); }
  }
  assert.deepEqual(bad, []);
});
