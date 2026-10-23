#!/usr/bin/env node
'use strict';
// project/desktop/ui-login-entry-fixture.cjs — 单文件离线 UI 行为 fixture（不测样式，布局稍后叠加）。
// 依赖（Root 预置目录，不 npm install）：esbuild@0.28.0 react@19.2.6 react-dom@19.2.6 scheduler@0.27.0 lucide-react@1.31.0 playwright
// 真实编译：main.tsx + employee-update.tsx + app-version-badge.tsx；
// 仅替换 ./workspace、./network-settings、./bridge 三个模块为 fixture 桩；CSS 用 esbuild empty loader。
// 不加载真实主机/数据库/账目；不联网（路由只放行 127.0.0.1 本机静态服务）；不改任何源文件。
// 浏览器：Guest 自带 Edge（channel=msedge），chromiumSandbox: true，不附加任何 no-sandbox 参数。
// 用法：
//   node ui-login-entry-fixture.cjs --renderer <renderer目录> --main <新main.tsx> --old-main <旧main.tsx>
//        --deps <fixture/node_modules> --results <显式结果目录>
const fs = require('node:fs');
const path = require('node:path');
const http = require('node:http');
const crypto = require('node:crypto');

const CHECK = [];
let pass = 0, fail = 0;
function check(id, ok, detail) {
  CHECK.push({ id, ok: !!ok, detail: detail === undefined ? '' : String(detail) });
  if (ok) { pass++; console.log('[PASS] ' + id + (detail ? ' ' + detail : '')); }
  else { fail++; console.log('[FAIL] ' + id + (detail ? ' ' + detail : '')); }
}
function info(t) { console.log('[INFO] ' + t); }
function parseArgs(argv) {
  const out = {};
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (!a || a.slice(0, 2) !== '--') continue;
    const k = a.slice(2);
    out[k] = (i + 1 < argv.length && argv[i + 1].slice(0, 2) !== '--') ? argv[++i] : 'true';
  }
  return out;
}
class Blocked extends Error {}
const EVIDENCE = { tool: 'ui-login-entry-fixture', generatedAt: new Date().toISOString(), versions: {}, sources: {}, pages: [], checks: [], externalRequests: [], blocked: null, summary: null };
function writeEvidence(dir) {
  EVIDENCE.checks = CHECK; EVIDENCE.summary = { pass, fail };
  if (!dir) return;
  try {
    if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
    const stamp = new Date().toISOString().replace(/[:.]/g, '-');
    const target = path.join(dir, 'ui-login-entry-' + stamp + '.json');
    fs.writeFileSync(target, JSON.stringify(EVIDENCE, null, 2), 'utf8');
    console.log('[INFO] 证据 JSON：' + target);
  } catch (e) { console.log('[INFO] 证据写入失败：' + e.message); }
}
function sha256File(p) { return crypto.createHash('sha256').update(fs.readFileSync(p)).digest('hex'); }
const STUB_WORKSPACE = ["import React from 'react';", "export default function Workspace() { return React.createElement('div', { 'data-fixture': 'workspace' }, 'workspace stub'); }", ''].join('\n');
const STUB_NETWORK = ["import React from 'react';", "export function connectionLabel(conn) { return '虚构连接：' + (conn && conn.host ? conn.host : '本机') + (conn && conn.port ? ':' + conn.port : ''); }", "export function NetworkSettingsModal() { return null; }", ''].join('\n');
const STUB_BRIDGE = [
  "export const api = (p, method, body) => {",
  "  window.__xjy.apiCalls.push({ path: String(p), method: method || 'GET' });",
  "  if (p === '/auth/status') return Promise.resolve({ authenticated: false, needsSetup: false, user: null });",
  "  if (p === '/api/bootstrap') return Promise.resolve(null);",
  "  if (p === '/auth/logout') return Promise.resolve({ ok: true });",
  "  if (p === '/auth/login' || p === '/auth/setup') return Promise.reject(new Error('fixture：离线环境不执行登录'));",
  "  return Promise.resolve({ ok: true, d: { version: '1.7.0', engineVersion: '1.7.0.0' }, version: '1.7.0', engineVersion: '1.7.0.0' });",
  "};", 'export default { api };', ''].join('\n');
function windowStub(mode, surface) {
  const lines = [];
  lines.push('(function () {');
  lines.push("  var calls = { capability: 0, state: 0, employeeUpdate: 0 };");
  lines.push('  window.__xjy = { mode: ' + JSON.stringify(mode) + ', surface: ' + JSON.stringify(surface) + ', calls: calls, apiCalls: [], lastCapability: null };');
  lines.push("  var conn = { mode: 'client', host: '10.0.0.10', port: 8737, secure: false, clientOnly: true };");
  lines.push('  var api = {');
  lines.push('    surface: ' + JSON.stringify(surface) + ',');
  lines.push("    print: function () { return Promise.resolve(); },");
  lines.push("    getConnection: function () { return Promise.resolve(conn); },");
  lines.push("    getAppInfo: function () { return Promise.resolve({ version: '1.7.0', engineVersion: '1.7.0.0' }); },");
  lines.push("    readLoginMemory: function () { return Promise.resolve({ ok: true, available: true, hasPassword: false, scopeKey: 'fixture-scope', username: '', password: '', error: '' }); },");
  lines.push("    forgetLoginPassword: function () { return Promise.resolve({ ok: true }); },");
  lines.push("    rememberLogin: function () { return Promise.resolve({ ok: true }); },");
  lines.push("    rememberLoginUsername: function () { return Promise.resolve({ ok: true }); }");
  lines.push('  };');
  if (mode !== 'missing-bridge') {
    lines.push("  api.getEmployeeUpdateCapability = function () { calls.capability++; var cap = { supported: true, canInstall: false, currentVersion: '1.7.0', code: 'LOGIN_REQUIRED', message: '请先使用有效的员工账号登录。' }; window.__xjy.lastCapability = cap; return Promise.resolve(cap); };");
    lines.push("  api.getEmployeeUpdateState = function () { calls.state++; return Promise.resolve({ phase: 'idle', currentVersion: '1.7.0', message: '等待开始升级' }); };");
    lines.push("  api.employeeUpdate = function () { calls.employeeUpdate++; return Promise.resolve({ ok: false, code: 'LOGIN_REQUIRED', error: '请先使用有效的员工账号登录。', state: { phase: 'error', currentVersion: '1.7.0', message: '请先使用有效的员工账号登录。', code: 'LOGIN_REQUIRED' } }); };");
  }
  lines.push('  window.jewelryDesktop = api;');
  lines.push('})();');
  return lines.join('\n');
}
function htmlTemplate(stubFile, bundleFile) {
  return ['<!DOCTYPE html>', '<html lang="zh-CN"><head><meta charset="utf-8"><title>fixture</title></head>', '<body><div id="root"></div>',
    '<script src="./' + stubFile + '"></script>', '<script src="./' + bundleFile + '"></script>', '</body></html>'].join('\n');
}
function contentTypes(p) {
  const map = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.css': 'text/css; charset=utf-8', '.png': 'image/png', '.jpg': 'image/jpeg', '.svg': 'image/svg+xml', '.json': 'application/json; charset=utf-8' };
  return map[path.extname(p).toLowerCase()] || 'application/octet-stream';
}

(async function main() {
  const args = parseArgs(process.argv.slice(2));
  const resultsDir = args.results ? path.resolve(args.results) : '';
  const renderer = args.renderer ? path.resolve(args.renderer) : '';
  const mainPath = args.main ? path.resolve(args.main) : '';
  const oldMainPath = args['old-main'] ? path.resolve(args['old-main']) : '';
  const deps = args.deps ? path.resolve(args.deps) : '';
  try {
    if (!resultsDir) throw new Blocked('缺少 --results（经验证据必须落显式目录）');
    if (!fs.existsSync(resultsDir)) fs.mkdirSync(resultsDir, { recursive: true });
    if (!deps || !fs.existsSync(deps)) throw new Blocked('缺少 --deps（预置 node_modules）: ' + deps);
    if (!mainPath || !fs.existsSync(mainPath)) throw new Blocked('缺少 --main（新 main.tsx）');
    if (!oldMainPath || !fs.existsSync(oldMainPath)) throw new Blocked('缺少 --old-main（旧 main.tsx，差分必需）');
    const mainText = fs.readFileSync(mainPath, 'utf8');
    const oldText = fs.readFileSync(oldMainPath, 'utf8');
    EVIDENCE.sources.newMain = { path: mainPath, sha256: sha256File(mainPath), hasMarker: mainText.indexOf('login-update-entry') >= 0, hasTestId: mainText.indexOf('data-testid') >= 0 };
    EVIDENCE.sources.oldMain = { path: oldMainPath, sha256: sha256File(oldMainPath), hasMarker: oldText.indexOf('login-update-entry') >= 0 };
    info('新源 sha256=' + EVIDENCE.sources.newMain.sha256);
    info('旧源 sha256=' + EVIDENCE.sources.oldMain.sha256);
    check('S1 新源含专属标记 login-update-entry', EVIDENCE.sources.newMain.hasMarker);
    check('S2 旧源不含专属标记（基线正确）', EVIDENCE.sources.oldMain.hasMarker === false, 'hasMarker=' + EVIDENCE.sources.oldMain.hasMarker);

    const lucidePath = path.join(deps, 'lucide-react', 'dist', 'cjs', 'lucide-react.js');
    if (!fs.existsSync(lucidePath)) throw new Blocked('映射的 lucide 入口不存在：' + lucidePath);
    let esbuild, playwright;
    try { esbuild = require(require.resolve('esbuild', { paths: [deps] })); } catch (e) { throw new Blocked('esbuild 不可用：' + e.message); }
    try { playwright = require(require.resolve('playwright', { paths: [deps] })); } catch (e) { throw new Blocked('playwright 不可用：' + e.message); }
    const depVersion = (name) => { try { return JSON.parse(fs.readFileSync(path.join(deps, name, 'package.json'), 'utf8')).version; } catch { return 'unknown'; } };
    EVIDENCE.versions = { esbuild: depVersion('esbuild'), react: depVersion('react'), reactDom: depVersion('react-dom'), scheduler: depVersion('scheduler'), lucideReact: depVersion('lucide-react'), playwright: depVersion('playwright') };
    info('版本 ' + JSON.stringify(EVIDENCE.versions));

    const runDir = path.join(resultsDir, 'ui-run-' + new Date().toISOString().replace(/[:.]/g, '-'));
    const stubDir = path.join(runDir, 'stubs');
    fs.mkdirSync(stubDir, { recursive: true });
    const stubWorkspace = path.join(stubDir, 'workspace-stub.js');
    const stubNetwork = path.join(stubDir, 'network-settings-stub.js');
    const stubBridge = path.join(stubDir, 'bridge-stub.js');
    fs.writeFileSync(stubWorkspace, STUB_WORKSPACE, 'utf8');
    fs.writeFileSync(stubNetwork, STUB_NETWORK, 'utf8');
    fs.writeFileSync(stubBridge, STUB_BRIDGE, 'utf8');
    fs.writeFileSync(path.join(stubDir, 'README-fixed'), 'fixture 桩：仅替换 ./workspace、./network-settings、./bridge 与 lucide 解析；其余为真实源码。\n', 'utf8');

    const resolvePlugin = {
      name: 'xjy-fixture-resolve',
      setup(build) {
        build.onResolve({ filter: /^\.\/workspace$/ }, () => ({ path: stubWorkspace }));
        build.onResolve({ filter: /^\.\/network-settings$/ }, () => ({ path: stubNetwork }));
        build.onResolve({ filter: /^\.\/bridge$/ }, () => ({ path: stubBridge }));
        build.onResolve({ filter: /^lucide-react$/ }, () => ({ path: lucidePath }));
      }
    };
    async function buildBundle(sourceFile, outName) {
      const outfile = path.join(runDir, outName);
      try {
        await esbuild.build({
          entryPoints: [sourceFile], outfile, bundle: true, write: true, format: 'iife', platform: 'browser',
          target: ['chrome110'], jsx: 'automatic', nodePaths: [deps], logLevel: 'silent', sourcemap: false,
          minify: false, charset: 'utf8',
          loader: { '.css': 'empty', '.png': 'dataurl', '.jpg': 'dataurl', '.svg': 'dataurl' },
          define: { 'process.env.NODE_ENV': '"production"' },
          plugins: [resolvePlugin]
        });
      } catch (e) { throw new Blocked('esbuild 编译失败（' + sourceFile + '）：' + (e.errors ? e.errors.map(x => x.text + '@' + (x.location ? x.location.file + ':' + x.location.line : '?')).join(' | ') : e.message)); }
      return outfile;
    }
    const bundleNew = await buildBundle(mainPath, 'bundle-new.js');
    const bundleOld = await buildBundle(oldMainPath, 'bundle-old.js');
    info('bundle-new=' + bundleNew + ' bundle-old=' + bundleOld);
    check('S3 真实编译通过（main + employee-update + app-version-badge）', fs.existsSync(bundleNew) && fs.existsSync(bundleOld));

    const variants = [
      { name: 'new-default', bundle: 'bundle-new.js', mode: 'employee', surface: 'desktop' },
      { name: 'new-browser', bundle: 'bundle-new.js', mode: 'employee', surface: 'browser' },
      { name: 'new-missing-bridge', bundle: 'bundle-new.js', mode: 'missing-bridge', surface: 'desktop' },
      { name: 'old', bundle: 'bundle-old.js', mode: 'employee', surface: 'desktop' }
    ];
    for (const v of variants) {
      const stubFile = path.join(runDir, 'win-' + v.name + '.js');
      fs.writeFileSync(stubFile, windowStub(v.mode, v.surface), 'utf8');
      fs.copyFileSync(path.join(runDir, v.bundle), path.join(runDir, 'bundle-' + v.name + '.js'));
      fs.writeFileSync(path.join(runDir, 'index-' + v.name + '.html'), htmlTemplate('win-' + v.name + '.js', 'bundle-' + v.name + '.js'), 'utf8');
    }

    const server = http.createServer((req, res) => {
      const pathname = decodeURIComponent((req.url || '/').split('?')[0]);
      const target = path.resolve(runDir, '.' + pathname);
      if (!target.startsWith(runDir)) { res.writeHead(403); res.end('forbidden'); return; }
      fs.readFile(target, (err, data) => {
        if (err) { res.writeHead(404); res.end('not found'); return; }
        res.writeHead(200, { 'Content-Type': contentTypes(target), 'Cache-Control': 'no-store' });
        res.end(data);
      });
    });
    await new Promise((resolve, reject) => { server.once('error', reject); server.listen(0, '127.0.0.1', resolve); });
    const port = server.address().port;
    const baseUrl = 'http://127.0.0.1:' + port;
    info('静态服务 ' + baseUrl);

    let browser = null;
    let context = null;
    try {
      try { browser = await playwright.chromium.launch({ channel: 'msedge', headless: true, chromiumSandbox: true }); }
      catch (e) { throw new Blocked('Edge(channel=msedge) 启动失败（未附加 no-sandbox）：' + e.message); }
      info('浏览器 ' + browser.browserType().name() + ' version=' + browser.version());
      EVIDENCE.browser = { name: 'msedge', version: browser.version(), chromiumSandbox: true, args: [] };
      context = await browser.newContext({ viewport: { width: 1280, height: 900 }, locale: 'zh-CN' });
      await context.route('**/*', async route => {
        const u = new URL(route.request().url());
        if (u.hostname === '127.0.0.1' && Number(u.port) === port) return route.continue();
        EVIDENCE.externalRequests.push(u.href);
        return route.abort();
      });

      async function openVariant(v) {
        const page = await context.newPage();
        const pageErrors = [], consoleErrors = [];
        page.on('pageerror', e => pageErrors.push(String((e && e.message) || e)));
        page.on('console', m => { if (m.type() === 'error') consoleErrors.push(m.text()); });
        await page.goto(baseUrl + '/index-' + v.name + '.html', { waitUntil: 'domcontentloaded' });
        await page.waitForSelector('main.desktop-auth', { state: 'visible', timeout: 20000 });
        const shot = path.join(resultsDir, 'ui-' + v.name + '.png');
        const rec = { name: v.name, url: baseUrl + '/index-' + v.name + '.html', screenshot: shot, pageErrors, consoleErrors };
        EVIDENCE.pages.push(rec);
        return { page, pageErrors, consoleErrors, shot, rec };
      }

      // 变体一：新源 + 未登录员工
      {
        const v = variants[0], o = await openVariant(v);
        const page = o.page;
        check('NEW:LOGIN_PAGE_RENDERED', await page.locator('main.desktop-auth').isVisible());
        const entry = page.locator('[data-testid="login-update-entry"]');
        const entryCount = await entry.count();
        check('NEW:ENTRY_COUNT_1', entryCount === 1, 'count=' + entryCount);
        check('NEW:ENTRY_VISIBLE', entryCount === 1 && await entry.first().isVisible());
        const label = entryCount === 1 ? (await entry.first().innerText()).trim() : '';
        check('NEW:ENTRY_LABEL_一键升级', label === '一键升级', JSON.stringify(label));
        check('NEW:ENTRY_ACCESSIBLE_ROLE_BUTTON', await page.getByRole('button', { name: '一键升级', exact: true }).count() === 1);
        let dialogOk = false;
        if (entryCount === 1) {
          await entry.first().click();
          try { await page.waitForSelector('section[role="dialog"]', { timeout: 10000 }); dialogOk = await page.locator('section[role="dialog"]').first().isVisible(); }
          catch (e) { dialogOk = false; }
        }
        check('NEW:REAL_CLICK_OPENS_ROLE_DIALOG', dialogOk);
        if (dialogOk) {
          const dialogText = await page.locator('section[role="dialog"]').first().innerText();
          o.rec.dialogText = dialogText.replace(/\s+/g, ' ').slice(0, 400);
          check('NEW:DIALOG_SHOWS_LOGIN_REQUIRED_TEXT', dialogText.indexOf('请先使用有效的员工账号登录') >= 0, o.rec.dialogText);
          check('NEW:NO_INSTALL_PRIMARY_BUTTON', await page.locator('.employee-update-primary').count() === 0);
          check('NEW:NO_INSTALL_ROLE_BUTTON', await page.getByRole('button', { name: /开始升级|正在处理|检查更新|重试升级|暂不可重试/ }).count() === 0);
        }
        const calls = await page.evaluate(() => (window.__xjy && window.__xjy.calls) || null);
        const cap = await page.evaluate(() => (window.__xjy && window.__xjy.lastCapability) || null);
        o.rec.calls = calls; o.rec.capability = cap;
        check('NEW:EMPLOYEE_UPDATE_CALLS_ZERO', !!calls && calls.employeeUpdate === 0, JSON.stringify(calls));
        check('NEW:CAPABILITY_READ_ONCE', !!calls && calls.capability === 1, JSON.stringify(calls));
        check('NEW:CAPABILITY_CODE_LOGIN_REQUIRED', !!cap && cap.code === 'LOGIN_REQUIRED', JSON.stringify(cap));
        check('NEW:NO_UNCAUGHT_PAGE_ERROR', o.pageErrors.length === 0, o.pageErrors.join(' | ').slice(0, 200));
        await page.screenshot({ path: o.shot, fullPage: true });
        await page.close();
      }

      // 变体二：新源 + 浏览器 surface（不应出现 Windows 安装按钮）
      {
        const v = variants[1], o = await openVariant(v);
        const page = o.page;
        check('BROWSER:LOGIN_PAGE_RENDERED', await page.locator('main.desktop-auth').isVisible());
        const entryCount = await page.locator('[data-testid="login-update-entry"]').count();
        const roleCount = await page.getByRole('button', { name: '一键升级', exact: true }).count();
        check('BROWSER:NO_WINDOWS_INSTALL_BUTTON', entryCount === 0 && roleCount === 0, 'entry=' + entryCount + ' role=' + roleCount);
        check('BROWSER:NO_UPDATE_OVERLAY', await page.locator('.employee-update-overlay').count() === 0);
        await page.screenshot({ path: o.shot, fullPage: true });
        await page.close();
      }

      // 变体三：新源 + 桥接缺失（应给出明确说明，且仍无安装）
      {
        const v = variants[2], o = await openVariant(v);
        const page = o.page;
        const entry = page.locator('[data-testid="login-update-entry"]');
        const entryCount = await entry.count();
        check('MISSING_BRIDGE:ENTRY_VISIBLE', entryCount === 1 && await entry.first().isVisible(), 'count=' + entryCount);
        let dialogOk = false, dialogText = '';
        if (entryCount === 1) {
          await entry.first().click();
          try { await page.waitForSelector('section[role="dialog"]', { timeout: 10000 }); dialogOk = await page.locator('section[role="dialog"]').first().isVisible(); } catch (e) { dialogOk = false; }
          if (dialogOk) dialogText = await page.locator('section[role="dialog"]').first().innerText();
        }
        o.rec.dialogText = dialogText.replace(/\s+/g, ' ').slice(0, 400);
        check('MISSING_BRIDGE:DIALOG_EXPLICIT_MESSAGE', dialogOk && dialogText.indexOf('尚未提供自动升级入口') >= 0, o.rec.dialogText);
        check('MISSING_BRIDGE:NO_INSTALL_BUTTON', await page.locator('.employee-update-primary').count() === 0);
        const calls = await page.evaluate(() => (window.__xjy && window.__xjy.calls) || null);
        o.rec.calls = calls;
        check('MISSING_BRIDGE:EMPLOYEE_UPDATE_CALLS_ZERO', !!calls && calls.employeeUpdate === 0, JSON.stringify(calls));
        await page.screenshot({ path: o.shot, fullPage: true });
        await page.close();
      }

      // 变体四：旧源同 UI 断言必须失败（差分）
      {
        const v = variants[3], o = await openVariant(v);
        const page = o.page;
        check('OLD:LOGIN_PAGE_RENDERED', await page.locator('main.desktop-auth').isVisible());
        const entryCount = await page.locator('[data-testid="login-update-entry"]').count();
        const roleCount = await page.getByRole('button', { name: '一键升级', exact: true }).count();
        o.rec.entryCount = entryCount; o.rec.roleCount = roleCount;
        check('OLD:SAME_UI_ASSERTIONS_FAIL(无入口)', entryCount === 0 && roleCount === 0, 'entry=' + entryCount + ' role=' + roleCount);
        check('OLD:NO_DIALOG_BEFORE_OR_AFTER', await page.locator('section[role="dialog"]').count() === 0);
        await page.screenshot({ path: o.shot, fullPage: true });
        await page.close();
      }

      check('NET:仅本机127.0.0.1请求，无外网', EVIDENCE.externalRequests.length === 0, '外部请求=' + EVIDENCE.externalRequests.slice(0, 5).join('; '));
    } finally {
      if (context) { try { await context.close(); } catch { } }
      if (browser) { try { await browser.close(); } catch { } }
      await new Promise(resolve => { server.close(() => resolve()); });
      check('SRV:静态服务优雅关闭', server.listening === false);
    }
  } catch (e) {
    if (e instanceof Blocked) {
      EVIDENCE.blocked = e.message;
      console.log('[BLOCKED] ' + e.message);
      writeEvidence(resultsDir || '');
      process.exit(2);
    }
    EVIDENCE.blocked = '未预期异常：' + (e && e.stack || e);
    console.log('[BLOCKED] 未预期异常：' + (e && e.stack || e));
    writeEvidence(resultsDir || '');
    process.exit(2);
  }
  writeEvidence(resultsDir);
  console.log('合计 ' + (pass + fail) + ' 项：PASS ' + pass + '，FAIL ' + fail);
  process.exit(fail === 0 ? 0 : 1);
})();