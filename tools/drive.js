#!/usr/bin/env node
/* drive.js — run the app, evaluate expressions in it, screenshot each step. Never touches real data.
   node tools/drive.js [--copy] [--out <dir>] [--ready <expr>] [--wait <ms>] [--pre <file>] [--no-shots] -- "<expr>" "@<file>" "@frame=<src part> <expr>" …
     --copy        start from a copy of the real data folder (default: an empty one)
     --out         screenshot folder (default: <os tmp>/drive-shots); files step-1.png, step-2.png …
     --ready       expression polled until truthy before the first step (default: document.readyState === 'complete')
     --wait        ms to wait after each step before its screenshot (default 1200)
     --pre         a file whose expression runs once before the steps (setup: dismiss the welcome, seed data); no screenshot
     --no-shots    print values only (cheapest: measure with numbers, take pictures only to judge looks)
   "@<file>" reads a step's expression from a file — no shell quoting to get wrong.
   Each expression may return a Promise; its JSON value is printed. "@frame=x expr" runs inside the first iframe
   whose src contains x. The data-folder variable is read from main.js (process.env.*_DATA_DIR); the run is refused if it can't be found.
   Config (package.json → "drive"): { "dataEnv": "<override>", "dataName": "<folder>",
   "extraEnv": { "SOME_DIR": "sub" } } — extraEnv values are folders created inside the throwaway data folder. */
'use strict';
const fs = require('fs'), path = require('path'), os = require('os'), { spawn, execSync } = require('child_process');
const root = path.join(__dirname, '..'), pkg = JSON.parse(fs.readFileSync(path.join(root, 'package.json'), 'utf8')), cfg = pkg.drive || {};
const argv = process.argv.slice(2), opt = { copy: false, out: path.join(os.tmpdir(), 'drive-shots'), ready: "document.readyState === 'complete'", wait: 1200 }, exprs = [];
for (let i = 0; i < argv.length; i++) {
  const a = argv[i];
  if (a === '--') { exprs.push(...argv.slice(i + 1)); break; }
  if (a === '--copy') opt.copy = true; else if (a === '--out') opt.out = argv[++i]; else if (a === '--ready') opt.ready = argv[++i]; else if (a === '--wait') opt.wait = +argv[++i]; else if (a === '--pre') opt.pre = argv[++i]; else if (a === '--no-shots') opt.noShots = true; else exprs.push(a);
}
if (typeof WebSocket === 'undefined') { console.error('drive.js needs Node 22+ (global WebSocket).'); process.exit(1); }

// safety: find the variable main.js actually reads for its data folder; refuse to run if it can't be confirmed
const mainSrc = fs.readFileSync(path.join(root, pkg.main || 'main.js'), 'utf8'), found = [...mainSrc.matchAll(/process\.env\.([A-Z0-9_]*DATA_DIR)(?![A-Z0-9_])/g)].map(m => m[1]);
const dataEnv = cfg.dataEnv || found[0], dataName = cfg.dataName || pkg.productName || pkg.name;
if (!dataEnv || found.indexOf(dataEnv) < 0) { console.error('drive.js: ' + (pkg.main || 'main.js') + ' does not read ' + (dataEnv ? 'process.env.' + dataEnv : 'any *_DATA_DIR variable') + ' for its data folder' + (found.length ? ' (it reads ' + found.join(', ') + '; set package.json "drive": { "dataEnv" })' : '') + '. Refusing to run against real data.'); process.exit(1); }
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'drive-data-'));
const appData = process.env.APPDATA || (process.platform === 'darwin' ? path.join(os.homedir(), 'Library', 'Application Support') : path.join(os.homedir(), '.config'));
if (opt.copy) {
  const src = path.join(appData, dataName);
  if (!fs.existsSync(src)) { console.error('No data folder at ' + src); process.exit(1); }
  const skip = /^(Cache|Code Cache|GPUCache|DawnGraphiteCache|DawnWebGPUCache|GrShaderCache|ShaderCache|GPUPersistentCache|Shared Dictionary|blob_storage|Network|Crashpad)$/;
  fs.cpSync(src, tmp, { recursive: true, filter: s => !skip.test(path.basename(s)) && !/\.lock$|^LOCK$|^SingletonLock$/.test(path.basename(s)) });
}
const env = { ...process.env, [dataEnv]: tmp };
delete env.ELECTRON_RUN_AS_NODE;
for (const [k, sub] of Object.entries(cfg.extraEnv || {})) { const d = path.join(tmp, sub); fs.mkdirSync(d, { recursive: true }); env[k] = d; }
fs.mkdirSync(opt.out, { recursive: true });

const port = 9300 + Math.floor(Math.random() * 500);
const electron = require(path.join(root, 'node_modules', 'electron'));
const child = spawn(electron, [root, '--remote-debugging-port=' + port], { env, stdio: 'ignore', windowsHide: false });
const stop = () => { try { if (process.platform === 'win32') execSync('taskkill /PID ' + child.pid + ' /T /F', { stdio: 'ignore' }); else child.kill('SIGKILL'); } catch {} try { fs.rmSync(tmp, { recursive: true, force: true }); } catch {} };
process.on('exit', stop); process.on('SIGINT', () => process.exit(130));
const sleep = ms => new Promise(r => setTimeout(r, ms));

(async () => {
  let page = null;
  for (let i = 0; i < 120 && !page; i++) { try { page = (await (await fetch('http://127.0.0.1:' + port + '/json')).json()).find(t => t.type === 'page'); } catch {} if (!page) await sleep(250); }
  if (!page) throw new Error('the app did not open a debuggable page');
  const ws = new WebSocket(page.webSocketDebuggerUrl); await new Promise((r, j) => { ws.onopen = r; ws.onerror = j; });
  let id = 0; const pend = new Map();
  ws.onmessage = m => { const d = JSON.parse(m.data); if (pend.has(d.id)) { pend.get(d.id)(d); pend.delete(d.id); } };
  const call = (method, params = {}) => new Promise(r => { const i = ++id; pend.set(i, r); ws.send(JSON.stringify({ id: i, method, params })); });
  const evaluate = async expr => { const r = await call('Runtime.evaluate', { expression: expr, awaitPromise: true, returnByValue: true }); const x = r.result || {}; if (x.exceptionDetails) return { error: (x.exceptionDetails.exception && x.exceptionDetails.exception.description || x.exceptionDetails.text || '').split('\n')[0] }; return x.result ? x.result.value : undefined; };
  for (let i = 0; i < 240; i++) { if (await evaluate('!!(' + opt.ready + ')')) break; await sleep(250); }
  await sleep(800);
  const fromFile = e => (/^@(?!frame=)/.test(e) ? fs.readFileSync(e.slice(1), 'utf8') : e);
  if (opt.pre) { const v = await evaluate(fromFile('@' + opt.pre)); console.log('[pre] ' + JSON.stringify(v === undefined ? null : v).slice(0, 300)); await sleep(400); }
  let n = 0;
  for (let e of exprs.map(fromFile)) {
    const fm = /^@frame=(\S+)\s+/.exec(e);
    if (fm) e = `(() => { const f = [...document.querySelectorAll('iframe')].find(x => (x.src || '').includes(${JSON.stringify(fm[1])})); if (!f) throw new Error('no iframe matching ${fm[1]}'); return f.contentWindow.eval(${JSON.stringify(e.slice(fm[0].length))}); })()`;
    const v = await evaluate(e);
    if (opt.noShots) { console.log('[' + (++n) + '] ' + JSON.stringify(v === undefined ? null : v).slice(0, 2000)); continue; }
    await sleep(opt.wait);
    const shot = await call('Page.captureScreenshot', { format: 'png' }), file = path.join(opt.out, 'step-' + (++n) + '.png');
    fs.writeFileSync(file, Buffer.from(shot.result.data, 'base64'));
    console.log('[' + n + '] ' + JSON.stringify(v === undefined ? null : v).slice(0, 2000) + '  → ' + file);
  }
  ws.close(); process.exit(0);
})().catch(e => { console.error(String(e && e.stack || e)); process.exit(1); });
