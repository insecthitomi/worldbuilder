'use strict';
const { contextBridge, ipcRenderer } = require('electron');

// host.call(name, ...args) → Promise · host.on(event, fn) → unsubscribe (e.g. window-state)
const subs = new Map();
ipcRenderer.on('gk:event', (_e, name, payload) => {
  for (const fn of [...(subs.get(name) || [])]) { try { fn(payload); } catch (err) { console.error(err); } }
});
contextBridge.exposeInMainWorld('host', {
  call: (name, ...args) => ipcRenderer.invoke('gk', name, args),
  on: (name, fn) => {
    if (typeof fn !== 'function') return () => {};
    if (!subs.has(name)) subs.set(name, new Set());
    subs.get(name).add(fn);
    return () => { subs.get(name).delete(fn); };
  },
});
