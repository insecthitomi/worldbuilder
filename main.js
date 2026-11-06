'use strict';
const { app, BrowserWindow, ipcMain, dialog, shell, session, Menu, screen, clipboard, nativeImage } = require('electron');
const { execFile } = require('child_process');
const fs = require('fs');
const path = require('path');
const os = require('os');

const APP_NAME = 'Worldbuilder';
const DATA_NAME = 'Worldbuilder';   // data folder, fixed at creation: renaming the app later keeps its data
app.setName(APP_NAME);
// Prism (GPU liquid glass) draws the live backdrop into WebGL through Chromium's HTML-in-canvas API.
app.commandLine.appendSwitch('enable-blink-features', 'CanvasDrawElement');
app.setAppUserModelId('com.nldevelopment.worldbuilder');

// --smoke[=dir]: boot in throwaway storage, run test/smoke-steps in the page, write screenshots, quit.
const smokeArg = process.argv.find(a => a.startsWith('--smoke'));
const SMOKE = smokeArg ? (smokeArg.split('=')[1] || path.join(__dirname, 'test', 'shots')) : null;
if (SMOKE) app.setPath('userData', fs.mkdtempSync(path.join(os.tmpdir(), 'gk-smoke-')));
else {
  // GK_DATA_DIR (development): run on another data folder, e.g. a copy, so real data is never touched
  app.setPath('userData', process.env.GK_DATA_DIR || path.join(app.getPath('appData'), DATA_NAME));
  if (!app.requestSingleInstanceLock()) { app.quit(); process.exit(0); }
}

let win;
const data = (...p) => path.join(app.getPath('userData'), ...p);
const readJson = (f, d) => { try { return JSON.parse(fs.readFileSync(f, 'utf8')); } catch { return d; } };
function writeJson(f, obj) {
  fs.mkdirSync(path.dirname(f), { recursive: true });
  const tmp = f + '.tmp';
  fs.writeFileSync(tmp, JSON.stringify(obj, null, 1));
  fs.renameSync(tmp, f);
}
const safeId = s => String(s).replace(/[^\w.-]+/g, '_').slice(0, 80);
const send = (w, ev, payload) => { if (w && !w.isDestroyed()) w.webContents.send('gk:event', ev, payload); };
const fileUrl = p => 'file:///' + p.replace(/\\/g, '/').split('/').map(encodeURIComponent).join('/').replace(/^([A-Za-z])%3A/, '$1:');

const MEDIA = {
  image: [{ name: 'Images & GIFs', extensions: ['png', 'jpg', 'jpeg', 'webp', 'gif', 'avif', 'bmp'] }],
  video: [{ name: 'Video', extensions: ['mp4', 'webm'] }],
  backdrop: [{ name: 'Image, GIF or video', extensions: ['png', 'jpg', 'jpeg', 'webp', 'gif', 'avif', 'bmp', 'mp4', 'webm'] }],
  font: [{ name: 'Fonts', extensions: ['ttf', 'otf', 'woff', 'woff2'] }],
  json: [{ name: 'JSON', extensions: ['json'] }],
};

const H = {
  'settings:load': () => readJson(data('settings.json'), null),
  'settings:save': (s) => { writeJson(data('settings.json'), s); return true; },
  'store:load': (id) => readJson(data('modules', safeId(id) + '.json'), null),
  'store:save': (id, v) => { writeJson(data('modules', safeId(id) + '.json'), v); return true; },

  // Copies a picked file into userData/media so the look survives the original being moved.
  'media:import': async (kind) => {
    const r = await dialog.showOpenDialog(win, { properties: ['openFile'], filters: MEDIA[kind] || MEDIA.image });
    if (r.canceled || !r.filePaths[0]) return null;
    const src = r.filePaths[0];
    const dir = data(kind === 'font' ? 'fonts' : 'media');
    fs.mkdirSync(dir, { recursive: true });
    const dest = path.join(dir, Date.now() + '_' + path.basename(src).replace(/[^\w.\-]+/g, '_'));
    fs.copyFileSync(src, dest);
    const ext = path.extname(dest).slice(1).toLowerCase();
    return { url: fileUrl(dest), name: path.basename(src).replace(/\.[^.]+$/, ''), ext, video: ['mp4', 'webm'].includes(ext) };
  },
  'file:saveJson': async (name, obj) => {
    const r = await dialog.showSaveDialog(win, { defaultPath: name, filters: MEDIA.json });
    if (r.canceled || !r.filePath) return null;
    fs.writeFileSync(r.filePath, JSON.stringify(obj, null, 1));
    return r.filePath;
  },
  /** any text file (SVG, Markdown, CSV…): ext picks the filter, e.g. 'svg' → "SVG file (*.svg)" */
  'file:saveText': async (name, text, ext) => {
    const e = String(ext || path.extname(String(name || '')).slice(1) || 'txt').toLowerCase().replace(/[^a-z0-9]/g, '');
    const r = await dialog.showSaveDialog(win, { defaultPath: name, filters: [{ name: e.toUpperCase() + ' file', extensions: [e] }, { name: 'All files', extensions: ['*'] }] });
    if (r.canceled || !r.filePath) return null;
    fs.writeFileSync(r.filePath, String(text == null ? '' : text), 'utf8');
    return r.filePath;
  },
  'file:openJson': async () => {
    const r = await dialog.showOpenDialog(win, { properties: ['openFile'], filters: MEDIA.json });
    if (r.canceled || !r.filePaths[0]) return null;
    // null means "cancelled"; a file that can't be read as JSON is an error the page can explain
    try { return JSON.parse(fs.readFileSync(r.filePaths[0], 'utf8')); } catch { throw new Error("That file isn't valid JSON"); }
  },
  'fonts:system': () => systemFonts(),
  'window:overlay': () => true,   // retired: the title bar draws its own window buttons (kept so older pages don't fail)
  'shell:url': (u) => { if (/^https?:\/\//.test(u)) shell.openExternal(u); return true; },
  'app:info': () => ({ name: APP_NAME, version: app.getVersion(), smoke: !!SMOKE, host: 'electron' }),

  // the title bar's own window buttons (they act on the window that asked)
  'win:minimize': function () { this.win.minimize(); return true; },
  'win:toggleMaximize': function () { const bw = this.win, was = bw.isMaximized(); if (was) bw.unmaximize(); else bw.maximize(); return !was; },
  'win:close': function () { this.win.close(); return true; },
  'win:isMaximized': function () { return this.win.isMaximized(); },
};

ipcMain.handle('gk', async (e, name, args) => {
  const fn = H[name];
  if (!fn) throw new Error('Unknown action: ' + name);
  return fn.apply({ win: BrowserWindow.fromWebContents(e.sender) || win }, args || []);
});

let fontsP = null;   // the registry scan runs once per launch
function systemFonts() {
  if (fontsP) return fontsP;
  const keys = ['HKLM\\SOFTWARE\\Microsoft\\Windows NT\\CurrentVersion\\Fonts', 'HKCU\\SOFTWARE\\Microsoft\\Windows NT\\CurrentVersion\\Fonts'];
  const styles = /\b(bold|italic|oblique|light|semilight|semibold|demibold|extrabold|extralight|ultralight|black|heavy|thin|regular|medium|book|condensed|narrow|bd|it|bi|lt)\b/gi;
  if (process.platform !== 'win32') return (fontsP = Promise.resolve([]));
  return fontsP = Promise.all(keys.map(k => new Promise(res => execFile('reg', ['query', k], { windowsHide: true, maxBuffer: 4 << 20 }, (e, out) => res(e ? '' : out)))))
    .then(outs => {
      const set = new Set();
      for (const out of outs) for (const line of out.split(/\r?\n/)) {
        const m = line.match(/^\s{4}(.+?)\s{4}REG_SZ/);
        if (!m) continue;
        for (let part of m[1].replace(/\((TrueType|OpenType|All res|VGA res)[^)]*\)/gi, '').split('&')) {
          part = part.replace(styles, '').replace(/\s+/g, ' ').trim();
          if (part.length > 1 && !/^\d/.test(part)) set.add(part);
        }
      }
      return [...set].sort((a, b) => a.localeCompare(b));
    });
}

/* The window always fits a screen: a saved size larger than the display (or a default taller than a scaled laptop
   screen) shrinks to its work area, the minimum size too, and a position left on a disconnected monitor is dropped. */
function fitBounds(st) {
  const want = { width: st.width || 1280, height: st.height || 820, x: st.x, y: st.y };
  const disp = (want.x != null && want.y != null) ? screen.getDisplayMatching({ x: want.x, y: want.y, width: want.width, height: want.height }) : screen.getPrimaryDisplay();
  const wa = disp.workArea, minW = Math.min(760, wa.width), minH = Math.min(520, wa.height);
  const w = Math.max(minW, Math.min(want.width, wa.width)), h = Math.max(minH, Math.min(want.height, wa.height));
  let x = want.x, y = want.y;
  const visible = x != null && y != null && x + w > wa.x + 40 && x < wa.x + wa.width - 40 && y >= wa.y - 8 && y < wa.y + wa.height - 40;
  if (!visible) { x = Math.round(wa.x + (wa.width - w) / 2); y = Math.round(wa.y + (wa.height - h) / 2); }
  x = Math.max(wa.x, Math.min(x, wa.x + wa.width - w)); y = Math.max(wa.y, Math.min(y, wa.y + wa.height - h));
  return Object.assign({}, st, { width: w, height: h, x, y, minW, minH });
}

function createWindow() {
  const st = fitBounds(readJson(data('window.json'), { width: 1280, height: 820 }));
  win = new BrowserWindow({
    width: st.width, height: st.height, x: st.x, y: st.y, minWidth: 760, minHeight: 520,
    show: false, backgroundColor: '#0b1622', title: APP_NAME,
    icon: path.join(__dirname, 'assets', 'icon.png'),
    // frameless, but keeps the native resize borders and Windows snap; the page draws the window buttons
    titleBarStyle: 'hidden',
    webPreferences: { preload: path.join(__dirname, 'preload.js'), contextIsolation: true, nodeIntegration: false, sandbox: true, backgroundThrottling: !SMOKE },
  });
  if (st.maximized) win.maximize();
  win.once('ready-to-show', () => { if (SMOKE) win.showInactive(); else win.show(); });   // smoke windows must be visible or Chromium stops painting
  win.loadFile(path.join(__dirname, 'index.html'));
  win.on('close', () => {
    if (SMOKE || win.isDestroyed()) return;
    writeJson(data('window.json'), { ...(win.isMaximized() ? st : win.getBounds()), maximized: win.isMaximized() });
  });
  win.webContents.setWindowOpenHandler(({ url }) => { if (/^https?:/.test(url)) shell.openExternal(url); return { action: 'deny' }; });
  win.webContents.on('will-navigate', (e, url) => { if (!url.startsWith('file:')) e.preventDefault(); });
  // window-state {maximized, focused} for the title bar's buttons
  const winState = () => send(win, 'window-state', { maximized: win.isMaximized(), focused: win.isFocused() });
  for (const ev of ['maximize', 'unmaximize', 'restore', 'focus', 'blur']) win.on(ev, winState);
  if (SMOKE) smoke();
}

async function smoke() {
  const wait = ms => new Promise(r => setTimeout(r, ms));
  fs.mkdirSync(SMOKE, { recursive: true });
  const errors = [];
  win.webContents.on('console-message', (e) => { if (e.level === 'error' || e.level === 3) errors.push(e.message); });
  win.webContents.once('did-finish-load', async () => {
    // wait until the page has registered every smoke step (boot sets GK.smoke.ready), at most 30 s
    for (let i = 0; i < 300 && !(await win.webContents.executeJavaScript('!!(window.GK && GK.smoke && GK.smoke.ready)').catch(() => false)); i++) await wait(100);
    await wait(400);
    let report = { ok: false };
    try {
      const steps = await win.webContents.executeJavaScript('window.GK && GK.smoke ? GK.smoke.steps() : []');
      for (const step of steps) {
        const res = await win.webContents.executeJavaScript(`GK.smoke.run(${JSON.stringify(step)})`);
        await wait(900);
        fs.writeFileSync(path.join(SMOKE, step + '.png'), (await win.webContents.capturePage()).toPNG());
        report[step] = res;
      }
      report.checks = await win.webContents.executeJavaScript('GK.smoke.checks()');
      // a step that reports 'error: …' fails the run too, not only a failed check
      for (const step of steps) if (typeof report[step] === 'string' && /^error\b/i.test(report[step])) report.checks.push({ name: 'step ' + step, ok: false, error: report[step] });
      report.ok = report.checks.every(c => c.ok) && !errors.length;
    } catch (e) { errors.push(String(e && e.stack || e)); }
    report.errors = errors;
    fs.writeFileSync(path.join(SMOKE, 'report.json'), JSON.stringify(report, null, 1));
    app.exit(report.ok ? 0 : 1);
  });
}

// Worldbuilder: the database and its handlers (src/main), mounted into H as 'wb:<area>.<action>'
let wb = null;
function startData() {
  require('./src/main/areas/backup').applyPendingRestore(app.getPath('userData'));
  wb = require('./src/main/index').setup({
    H, dataDir: app.getPath('userData'), send: (ev, payload) => send(win, ev, payload), win: () => win,
    dialog, shell, app, fileUrl, electron: { BrowserWindow, clipboard, nativeImage, shell, dialog, app },
  });
  if (!SMOKE) setTimeout(() => { try { wb.call('backup.daily'); } catch (e) { console.error(e); } }, 8000);
}

app.on('second-instance', () => { if (win) { if (win.isMinimized()) win.restore(); win.focus(); } });
app.whenReady().then(() => {
  Menu.setApplicationMenu(null);   // no menu bar in a frameless window, and no hidden menu accelerators (zoom, reload) acting on the page
  // the microphone (voice memos) is the only device the page may ask for; never the camera
  const allowed = (perm, details) => ['clipboard-sanitized-write', 'local-fonts'].includes(perm)
    || (perm === 'media' && (!details || !details.mediaTypes || details.mediaTypes.every(t => t === 'audio')));
  session.defaultSession.setPermissionRequestHandler((wc, perm, cb, details) => cb(allowed(perm, details)));
  session.defaultSession.setPermissionCheckHandler((wc, perm, origin, details) => allowed(perm, details));
  startData();
  createWindow();
});
app.on('window-all-closed', () => app.quit());
app.on('will-quit', () => { try { if (wb) wb.db.close(); } catch { } });
