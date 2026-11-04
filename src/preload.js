'use strict';
const { contextBridge, ipcRenderer } = require('electron');

const EVENTS = new Set(['state', 'ui:expanded', 'toast', 'search:open']);

contextBridge.exposeInMainWorld('sargel', {
  call: (channel, arg) => ipcRenderer.invoke(channel, arg),
  on: (channel, fn) => {
    if (!EVENTS.has(channel)) return;
    ipcRenderer.on(channel, (_e, data) => fn(data));
  },
});
