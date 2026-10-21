'use strict';

const { contextBridge, ipcRenderer } = require('electron');
async function invoke(channel, input) {
  try { return await ipcRenderer.invoke(channel, input); }
  catch (error) { throw new Error(String(error.message || error).replace(/^Error invoking remote method '[^']+': (?:Error: )?/, '')); }
}
contextBridge.exposeInMainWorld('jewelryDesktop', Object.freeze({
  request: input => invoke('jewelry:request', input),
  print: () => invoke('jewelry:print'),
  exportPdf: () => invoke('jewelry:export-pdf'),
  saveImage: input => invoke('jewelry:save-image', input),
  backup: () => invoke('jewelry:backup'),
  restore: () => invoke('jewelry:restore'),
  getDataInfo: () => invoke('jewelry:data-info'),
  getConnection: () => invoke('jewelry:get-connection'),
  setConnection: input => invoke('jewelry:set-connection', input),
  getPrinters: () => invoke('jewelry:get-printers'),
  getPrintSettings: () => invoke('jewelry:get-print-settings'),
  savePrintSettings: input => invoke('jewelry:save-print-settings', input),
  printWarranty: input => invoke('jewelry:print-warranty', input),
  exportWarrantyPdf: () => invoke('jewelry:export-warranty-pdf'),
}));
