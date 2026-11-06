'use strict';
/* A throwaway data folder + database with every area mounted, as the app has it (no Electron). */
const fs = require('fs');
const os = require('os');
const path = require('path');
const { setup } = require('../../src/main/index');

function make() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'wb-unit-'));
  const events = [];
  const ctx = setup({ dataDir: dir, dbFile: path.join(dir, 'test.db'), send: (ev, p) => events.push([ev, p]) });
  const call = (name, ...args) => ctx.call(name, ...args);
  const done = () => { try { ctx.db.close(); } catch { } try { fs.rmSync(dir, { recursive: true, force: true }); } catch { } };
  return { ctx, call, dir, events, done };
}
module.exports = { make };
