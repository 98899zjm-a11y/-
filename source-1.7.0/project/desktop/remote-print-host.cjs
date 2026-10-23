'use strict';
const fs = require('node:fs');
const path = require('node:path');
const { createHash } = require('node:crypto');
const { validatePrintSettings } = require('./print-settings.cjs');
const printUrl = 'jewelry://app/print.html';
const mime = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.css': 'text/css; charset=utf-8', '.svg': 'image/svg+xml', '.jpg': 'image/jpeg', '.png': 'image/png', '.webp': 'image/webp', '.woff2': 'font/woff2' };
const csp = "default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' data: blob:; font-src 'self' data:; connect-src 'none'; object-src 'none'; frame-src 'none'; base-uri 'none'; form-action 'none'";
function printerId(name) { return 'p_' + createHash('sha256').update('xjy-native-printer:' + name).digest('hex').slice(0, 32); }
function physical(printer) { return typeof printer.name === 'string' && printer.name.length && !/pdf|xps|onenote|fax/i.test(printer.name); }
function warrantyValues(snapshot) {
  // Warranty sheets contain text only. Expanding private photographs for A4
  // must not make an otherwise valid stored quotation exceed input limits.
  const value = { ...snapshot, image: '', images: [], customConfirmations: [], paymentMethods: [] };
  for (const key of ['saleItems', 'tradeInItems', 'recyclingItems']) if (Array.isArray(value[key])) value[key] = value[key].map(item => ({ ...item, image: '' }));
  return value;
}
function privateStaticRequest(request, directory) {
  try {
    const address = new URL(request.url);
    if (address.protocol !== 'jewelry:' || address.hostname !== 'app' || address.port || address.username || address.password || !['GET', 'HEAD'].includes(request.method)) return new Response('', { status: 403 });
    const pathname = decodeURIComponent(address.pathname);
    if (pathname.includes('\\') || pathname.includes('\0') || pathname.split('/').includes('..') || /^\/(api|auth)(?:\/|$)/.test(pathname)) return new Response('', { status: 403 });
    const file = path.resolve(directory, '.' + pathname), relative = path.relative(directory, file);
    if (!relative || relative.startsWith('..') || path.isAbsolute(relative) || !fs.existsSync(file) || !fs.statSync(file).isFile()) return new Response('', { status: 404 });
    const actual = path.relative(fs.realpathSync(directory), fs.realpathSync(file));
    if (actual.startsWith('..') || path.isAbsolute(actual)) return new Response('', { status: 403 });
    return new Response(request.method === 'HEAD' ? null : fs.readFileSync(file), { headers: { 'Content-Type': mime[path.extname(file)] || 'application/octet-stream', 'Content-Security-Policy': csp, 'Cache-Control': 'no-store', 'X-Content-Type-Options': 'nosniff' } });
  } catch { return new Response('', { status: 500 }); }
}
function createRemotePrintHost({ electron, printerSettings, rendererDir, getPrinters, domainPath = path.join(__dirname, 'generated/print-domain.cjs'), submit, readyTimeoutMs = 15000, printTimeoutMs = 30000 }) {
  const { BrowserWindow, ipcMain, session } = electron;
  const windows = new Map();
  const partition = session.fromPartition('xjy-private-print');
  partition.setPermissionRequestHandler((_contents, _permission, callback) => callback(false));
  partition.setPermissionCheckHandler(() => false);
  partition.webRequest.onBeforeRequest((details, callback) => {
    let allowed = /^(data|blob):/.test(details.url);
    try { const u = new URL(details.url); allowed ||= u.protocol === 'jewelry:' && u.hostname === 'app' && !u.port && !u.username && !u.password; } catch { /* Reject malformed resources. */ }
    callback({ cancel: !allowed });
  });
  partition.protocol.handle('jewelry', request => privateStaticRequest(request, rendererDir));
  function trusted(event) {
    const state = windows.get(event.sender.id);
    if (!state || state.window.isDestroyed() || event.senderFrame !== event.sender.mainFrame || event.senderFrame.url !== printUrl) throw new Error('打印窗口验证失败');
    return state;
  }
  ipcMain.handle('xjy-print:load', event => trusted(event).document);
  ipcMain.handle('xjy-print:ready', event => { const state = trusted(event); state.resolveReady(); return true; });
  ipcMain.handle('xjy-print:error', (event, message) => { const state = trusted(event); state.rejectReady(new Error(typeof message === 'string' ? message.slice(0, 800) : '打印模板未能准备')); return true; });
  async function getOptions() {
    const settings = printerSettings.read(), devices = (await getPrinters()).filter(physical);
    const selected = devices.find(device => device.name === settings.deviceName);
    return { available: Boolean(selected), printers: devices.map(device => ({ id: printerId(device.name), label: device.displayName || device.name })), defaultPrinterId: selected ? printerId(selected.name) : '', defaults: { phone: settings.phone, standard: settings.standard, afterSalesWechat: settings.afterSalesWechat }, ...(!selected ? { reason: '请在电脑主机的质保单打印设置中选择 Epson 630，并保存纸张与套打位置。' } : {}) };
  }
  async function print(payload, control = {}) {
    let printWindow, timeout, attempted = false;
    try {
      if (!payload || !['quotation-a4', 'warranty'].includes(payload.kind) || !Number.isInteger(payload.copies) || payload.copies < 1 || payload.copies > 3) throw new Error('打印任务参数无效');
      const settings = validatePrintSettings(printerSettings.read()), devices = (await getPrinters()).filter(physical);
      if (!devices.some(device => device.name === settings.deviceName)) throw new Error('主机尚未保存可用的实体打印机设置');
      const device = devices.find(device => printerId(device.name) === payload.printerId);
      if (!device) throw new Error('打印机已不可用，请检查主机连接后重新选择');
      const quote = payload.quote, snapshot = quote?.snapshot || quote?.data;
      if (!snapshot || !quote.id || !quote.number || !Number.isFinite(new Date(quote.createdAt).getTime())) throw new Error('请先保存有效的报价单再打印');
      const date = new Date(quote.createdAt).toLocaleDateString('sv-SE', { timeZone: 'Asia/Shanghai' });
      const document = { kind: payload.kind, quote, date, settings };
      if (payload.kind === 'warranty') {
        const { createWarrantySheets, validateWarrantyData } = require(domainPath);
        const sheets = createWarrantySheets(warrantyValues(snapshot), { phone: settings.phone, standard: settings.standard, afterSalesWechat: settings.afterSalesWechat }, { date });
        const selection = payload.warranty?.itemIndexes;
        if (!Array.isArray(selection) || !selection.length || new Set(selection).size !== selection.length || selection.some(index => !Number.isInteger(index) || index < 0 || index >= sheets.length)) throw new Error('请选择有效的质保单商品');
        const overrides = payload.warranty.overrides || [];
        if (!Array.isArray(overrides)) throw new Error('质保单补充信息格式无效');
        for (const override of overrides) {
          if (!Number.isInteger(override?.itemIndex) || !selection.includes(override.itemIndex) || Object.keys(override).some(key => !['itemIndex', 'goodsNumber', 'productName', 'phone', 'afterSalesWechat'].includes(key))) throw new Error('质保单只允许填写货号、品名、电话和售后微信');
          for (const key of ['goodsNumber', 'productName', 'phone', 'afterSalesWechat']) if (override[key] !== undefined) sheets[override.itemIndex].data[key] = override[key];
        }
        document.sheets = selection.map(index => sheets[index]);
        document.sheets.forEach(sheet => validateWarrantyData(sheet.data));
      }
      printWindow = new BrowserWindow({ width: 1100, height: 1100, show: false, backgroundColor: '#ffffff', autoHideMenuBar: true, webPreferences: { preload: path.join(__dirname, 'print-preload.cjs'), partition: 'xjy-private-print', contextIsolation: true, nodeIntegration: false, sandbox: true, spellcheck: false, devTools: false } });
      printWindow.setMenu(null);
      printWindow.webContents.setWindowOpenHandler(() => ({ action: 'deny' }));
      printWindow.webContents.on('will-navigate', (event, address) => { if (address !== printUrl) event.preventDefault(); });
      printWindow.webContents.on('will-redirect', event => event.preventDefault());
      printWindow.webContents.on('will-attach-webview', event => event.preventDefault());
      let resolveReady, rejectReady;
      const ready = new Promise((resolve, reject) => { resolveReady = resolve; rejectReady = reject; });
      // Attach the rejection handler before loading; renderer errors can arrive early.
      const readiness = ready.then(() => true);
      readiness.catch(() => {});
      windows.set(printWindow.webContents.id, { window: printWindow, document, resolveReady, rejectReady });
      printWindow.webContents.on('render-process-gone', () => rejectReady(new Error('打印窗口未能运行')));
      timeout = setTimeout(() => rejectReady(new Error('打印模板准备超时，请核对图片和模板内容')), readyTimeoutMs);
      await printWindow.loadURL(printUrl);
      await readiness; clearTimeout(timeout);
      const options = { silent: true, deviceName: device.name, copies: payload.copies, printBackground: true, margins: { marginType: 'none' }, pageSize: payload.kind === 'warranty' ? { width: Math.round(settings.widthMm * 1000), height: Math.round(settings.heightMm * 1000) } : 'A4' };
      if (typeof control.assertAuthorized === 'function') await control.assertAuthorized();
      attempted = true;
      if (submit) return await submit(printWindow.webContents, options);
      return await new Promise(resolve => {
        let settled = false;
        const finish = value => { if (settled) return; settled = true; clearTimeout(timeout); resolve(value); };
        timeout = setTimeout(() => finish({ status: 'uncertain', error: '主机未能确认打印结果，请核对是否已出纸，不要直接重复打印。' }), printTimeoutMs);
        printWindow.webContents.print(options, (success, failure) => finish(success ? { status: 'submitted' } : { status: 'failed', error: failure || '打印机未能接收，请检查纸张、连接和驱动。' }));
      });
    } catch (error) {
      return { status: attempted ? 'uncertain' : 'failed', error: attempted ? '打印结果暂时无法确认，请先核对出纸。' : error.message || '主机打印未完成' };
    } finally {
      clearTimeout(timeout);
      if (printWindow) { if (!printWindow.isDestroyed()) { windows.delete(printWindow.webContents.id); printWindow.destroy(); } else for (const [id, value] of windows) if (value.window === printWindow) windows.delete(id); }
    }
  }
  return { getOptions, print };
}
module.exports = { createRemotePrintHost, printerId, privateStaticRequest, warrantyValues };
