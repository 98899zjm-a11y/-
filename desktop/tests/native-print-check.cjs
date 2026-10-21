'use strict';

// Runs only an isolated, hidden test document. No real workspace or user account.
const { app, BrowserWindow, protocol, session } = require('electron');
const fs = require('node:fs');
const path = require('node:path');
const fixture = process.env.XJY_PRINT_FIXTURE_DIR;
const output = process.env.XJY_PRINT_DIAGNOSTIC_OUTPUT;
if (!fixture || !output) throw new Error('Specify isolated fixture and output folders');
const root = fs.realpathSync(fixture), target = path.resolve(output);
fs.mkdirSync(target, { recursive: true });
app.setPath('userData', path.join(target, 'test-user-data'));
protocol.registerSchemesAsPrivileged([{ scheme: 'jewelry', privileges: { standard: true, secure: true, supportFetchAPI: true, corsEnabled: true } }]);
const blockedNetwork = [], rendererErrors = [];
app.whenReady().then(async () => {
  session.defaultSession.setPermissionRequestHandler((_contents, _permission, callback) => callback(false));
  session.defaultSession.webRequest.onBeforeRequest((details, callback) => {
    const allowed = details.url.startsWith('jewelry://app/print-test/') || /^(data|blob):/.test(details.url);
    if (!allowed) blockedNetwork.push(details.url);
    callback({ cancel: !allowed });
  });
  protocol.handle('jewelry', request => {
    const address = new URL(request.url), pathname = decodeURIComponent(address.pathname);
    if (address.hostname !== 'app' || !pathname.startsWith('/print-test/')) return new Response('', { status: 403 });
    const relative = pathname.slice('/print-test/'.length), file = path.resolve(root, relative || 'index.html');
    const relation = path.relative(root, file);
    if (relation.startsWith('..') || path.isAbsolute(relation) || !fs.existsSync(file) || !fs.statSync(file).isFile()) return new Response('', { status: 404 });
    const types = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.png': 'image/png', '.jpg': 'image/jpeg', '.svg': 'image/svg+xml' };
    return new Response(fs.readFileSync(file), { headers: { 'Content-Type': types[path.extname(file)] || 'application/octet-stream', 'Content-Security-Policy': "default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' data:; connect-src 'self' data:; font-src 'self' data:" } });
  });
  const window = new BrowserWindow({ show: false, width: 1440, height: 1000, webPreferences: { contextIsolation: true, nodeIntegration: false, sandbox: true, spellcheck: false } });
  window.setMenu(null); window.webContents.setWindowOpenHandler(() => ({ action: 'deny' }));
  window.webContents.on('console-message', (_event, details) => { if (details.level === 'error') rendererErrors.push(details.message); });
  await window.loadURL('jewelry://app/print-test/' + (process.env.XJY_PRINT_FIXTURE_HTML || 'index.html'));
  const deadline = Date.now() + 30000; let state;
  do {
    state = await window.webContents.executeJavaScript(`({fixture:window.__xjyNativeFixture,ready:!!window.__xjyNativeFixture?.ready,sheets:document.querySelectorAll('.a4-sheet').length,images:[...document.images].every(i=>i.complete&&i.naturalWidth>0),text:document.body.innerText})`);
    if (state.ready) break;
    await new Promise(resolve => setTimeout(resolve, 200));
  } while (Date.now() < deadline);
  if (!state.ready || state.fixture.error || !state.images || !state.sheets) throw new Error(state.fixture?.error || '测试单未准备好');
  const bytes = await window.webContents.printToPDF({ pageSize: 'A4', printBackground: true, preferCSSPageSize: true });
  fs.writeFileSync(path.join(target, 'A4报价单-原生打印验收.pdf'), bytes);
  fs.writeFileSync(path.join(target, 'A4预览-原生程序.png'), (await window.webContents.capturePage()).toPNG());
  const png = Buffer.from(state.fixture.png.replace(/^data:image\/png;base64,/, ''), 'base64');
  const size = { width: png.readUInt32BE(16), height: png.readUInt32BE(20) };
  fs.writeFileSync(path.join(target, '报价单-9比16.png'), png);
  const pdfText = bytes.toString('latin1'), pageCount = (pdfText.match(/\/Type\s*\/Page\b/g) || []).length;
  const ok = size.width === 1080 && size.height === 1920 && pageCount === state.fixture.pages && !blockedNetwork.length && !rendererErrors.length;
  fs.writeFileSync(path.join(target, 'native-print-check.json'), JSON.stringify({ ok, pageCount, expectedPages: state.fixture.pages, size, byteLength: bytes.length, mediaBoxes: [...new Set(pdfText.match(/\/MediaBox\s*\[[^\]]+\]/g) || [])], visibleText: state.text, blockedNetwork, rendererErrors }, null, 2));
  app.exit(ok ? 0 : 1);
}).catch(error => { fs.writeFileSync(path.join(target, 'native-print-error.txt'), error.stack || error.message); app.exit(1); });
