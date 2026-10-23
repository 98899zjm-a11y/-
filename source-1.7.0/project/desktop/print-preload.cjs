'use strict';
const { contextBridge, ipcRenderer } = require('electron');
contextBridge.exposeInMainWorld('jewelryPrint', Object.freeze({
  load: () => ipcRenderer.invoke('xjy-print:load'),
  ready: () => ipcRenderer.invoke('xjy-print:ready'),
  error: message => ipcRenderer.invoke('xjy-print:error', String(message)),
}));
