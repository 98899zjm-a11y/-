'use strict';

const { contextBridge, ipcRenderer } = require('electron');
async function invoke(channel, input) {
  try { return await ipcRenderer.invoke(channel, input); }
  catch (error) { throw new Error(String(error.message || error).replace(/^Error invoking remote method '[^']+': (?:Error: )?/, '')); }
}
contextBridge.exposeInMainWorld('jewelryDesktop', Object.freeze({
  getAppInfo:()=>invoke('jewelry:app-info'),
  getModuleStatus:()=>invoke('jewelry:get-modules'),
  openModule:input=>invoke('jewelry:open-module',input),
  closeModule:()=>invoke('jewelry:close-module'),
  configureModule:input=>invoke('jewelry:configure-module',input),
  createModuleData:input=>invoke('jewelry:create-module-data',input),
  getModuleActivity:()=>invoke('jewelry:module-activity-info'),
  getEmployeeUpdateCapability:()=>invoke('jewelry:employee-update-capability'),
  getEmployeeUpdateState:()=>invoke('jewelry:employee-update-state'),
  employeeUpdate:input=>invoke('jewelry:employee-update',input),
  getHostPrintRouting:()=>invoke('jewelry:host-print-routing'),
  saveHostPrintRouting:input=>invoke('jewelry:host-print-routing-save',input),
  getHostMaintenance:()=>invoke('jewelry:host-maintenance'),
  exitHost:()=>invoke('jewelry:exit-host'),
  request: input => invoke('jewelry:request', input),
  readLoginMemory: input => invoke('jewelry:read-login-memory', input),
  rememberLoginUsername: input => invoke('jewelry:remember-login-username', input),
  rememberLogin: input => invoke('jewelry:remember-login', input),
  forgetLoginPassword: input => invoke('jewelry:forget-login-password', input),
  print: () => invoke('jewelry:print'),
  exportPdf: () => invoke('jewelry:export-pdf'),
  saveImage: input => invoke('jewelry:save-image', input),
  saveImageAs: input => invoke('jewelry:save-image-as', input),
  shareImage: input => invoke('jewelry:share-image', input),
  getImageSaveSettings: () => invoke('jewelry:get-image-save-settings'),
  chooseImageSaveFolder: () => invoke('jewelry:choose-image-save-folder'),
  saveTextFile: input => invoke('jewelry:save-text-file', input),
  backup: () => invoke('jewelry:backup'),
  restore: input => invoke('jewelry:restore',input),
  getDataInfo: () => invoke('jewelry:data-info'),
  getConnection: () => invoke('jewelry:get-connection'),
  setConnection: input => invoke('jewelry:set-connection', input),
  getPrinters: () => invoke('jewelry:get-printers'),
  getPrintSettings: () => invoke('jewelry:get-print-settings'),
  savePrintSettings: input => invoke('jewelry:save-print-settings', input),
  printWarranty: input => invoke('jewelry:print-warranty', input),
  exportWarrantyPdf: () => invoke('jewelry:export-warranty-pdf'),
  exportWarrantyDocx: input => invoke('jewelry:export-warranty-docx', input),
}));
