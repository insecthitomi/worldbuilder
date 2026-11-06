// Boots the app in throwaway storage, runs the page's smoke steps, saves screenshots to test/shots.
'use strict';
const { spawn } = require('child_process');
const fs = require('fs');
const path = require('path');

const root = path.join(__dirname, '..');
const out = path.join(__dirname, 'shots');
const electron = require('electron');
const env = { ...process.env };
delete env.ELECTRON_RUN_AS_NODE;

fs.rmSync(out, { recursive: true, force: true });
const p = spawn(electron, [root, '--smoke=' + out], { env, stdio: 'inherit' });
// every screen queues its own steps (each is screenshotted after a short settle), so the run takes a few minutes
const timer = setTimeout(() => { console.error('smoke: timed out'); p.kill(); }, 6 * 60000);
p.on('exit', code => {
  clearTimeout(timer);
  let report = null;
  try { report = JSON.parse(fs.readFileSync(path.join(out, 'report.json'), 'utf8')); } catch {}
  if (!report) { console.error('smoke: no report'); process.exit(1); }
  for (const c of report.checks || []) console.log(`${c.ok ? 'ok  ' : 'FAIL'} ${c.name}${c.error ? ' — ' + c.error : ''}`);
  for (const e of report.errors || []) console.log('error: ' + e);
  console.log(report.ok ? `smoke passed (screenshots in ${path.relative(root, out)})` : 'smoke FAILED');
  process.exit(report.ok && code === 0 ? 0 : 1);
});
