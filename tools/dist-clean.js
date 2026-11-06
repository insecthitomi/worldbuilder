#!/usr/bin/env node
/* npm run dist — builds the Windows installer from a clean staged copy of the project.
   Only what the installer packages enters the copy: package.json (+ lock), the release guard and the runtime paths in
   the build allowlist (package.json → build.files). Local-only files in the project (CLAUDE.md, *.local.md, .private/,
   .env, keys) never get there. The release guard then checks the copy itself, so it still blocks a build that would
   package something it shouldn't (say a .private/ folder or a *.local.md that slipped into src/), and electron-builder
   builds from the copy into this project's release/ folder.
   npm run guard (dist-clean.js --check): stage and guard only, no build. */
'use strict';
const fs = require('fs'), path = require('path'), os = require('os'), { spawnSync } = require('child_process');

const root = path.join(__dirname, '..');
const checkOnly = process.argv.includes('--check');
const extra = process.argv.slice(2).filter(a => a !== '--check');
const pkg = JSON.parse(fs.readFileSync(path.join(root, 'package.json'), 'utf8'));
const allow = ((pkg.build && pkg.build.files) || []).filter(p => !p.startsWith('!')).map(p => p.replace(/\/\*\*$/, ''));
const COPY = ['package.json', 'package-lock.json', 'tools/release-guard.js'].concat(allow);
const stage = fs.mkdtempSync(path.join(os.tmpdir(), String(pkg.name || 'app').replace(/[^\w.-]+/g, '_') + '-dist-'));
const link = path.join(stage, 'node_modules');
// only a .cmd needs the shell (its paths are quoted)
const run = (cmd, args, cwd, shell) => { const r = spawnSync(cmd, args, { cwd, stdio: 'inherit', shell: !!shell }); return r.status == null ? 1 : r.status; };

let code = 1;
try {
  for (const rel of COPY) {
    const src = path.join(root, rel);
    if (fs.existsSync(src)) fs.cpSync(src, path.join(stage, rel), { recursive: true });
  }
  code = run(process.execPath, [path.join(stage, 'tools', 'release-guard.js')], stage, false);
  if (code === 0 && !checkOnly) {
    fs.symlinkSync(path.join(root, 'node_modules'), link, 'junction');   // electron-builder reads electron's version from it
    const bin = path.join(root, 'node_modules', '.bin', 'electron-builder' + (process.platform === 'win32' ? '.cmd' : ''));
    if (!fs.existsSync(bin)) { console.error('dist: electron-builder is not installed — run npm install first.'); code = 1; }
    else code = run('"' + bin + '"', ['--win', '--projectDir', '"' + stage + '"', '-c.directories.output="' + path.join(root, 'release') + '"'].concat(extra), root, process.platform === 'win32');
  }
} finally {
  // the link first (never delete through it), then the copy
  if (fs.existsSync(link)) { try { fs.unlinkSync(link); } catch (e) { try { fs.rmdirSync(link); } catch (e2) { /* left in place below */ } } }
  if (!fs.existsSync(link)) fs.rmSync(stage, { recursive: true, force: true });
  else console.error('dist-clean: left ' + stage + ' in place (its node_modules link could not be removed safely)');
}
process.exit(code);
