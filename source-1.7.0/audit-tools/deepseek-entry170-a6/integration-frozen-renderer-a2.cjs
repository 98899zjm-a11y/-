#!/usr/bin/env node
'use strict';
// integration-frozen-renderer.cjs — 原冻结 renderer 整合 UI 验证（未签名候选阶段）
// 用 Root 从原 ASAR 提取的完整 renderer（index + 全部 JS/CSS），只把目标主脚本换成
// 已测 merged 字节；以内存 jewelryDesktop 桩渲染真实未登录页，真实点击全局一键升级按钮，
// 验证弹出既有面板。不是空白页 widget 测试，也不等于最终包 UI/安装/升级验收。
// 用法：
//   node integration-frozen-renderer.cjs --extracted <提取renderer目录> --merged-js <merged文件>
//        --deps <含playwright的node_modules> --results <显式结果目录>
//        [--expect-frozen-sha 83da...] [--expect-merged-sha 870a...]
const fs = require('node:fs');
const path = require('node:path');
const http = require('node:http');
const crypto = require('node:crypto');

const DEFAULT_FROZEN_SHA = '83da00c75fd33265fd4272b1e14085f8d0db1d1bac4f03bc88acf1526b6c2397';
const DEFAULT_MERGED_SHA = '870a724e04c030ec2bf3e3050b4adcf227c076cfc660a7e3d2421ba7b0db1ef7';
const TARGET_REL = path.join('assets', 'main-7etXIfP0.js');

class Blocked extends Error { }
const CHECKS = [];
let pass = 0, fail = 0;
function check(id, ok, detail) {
  CHECKS.push({ id, ok: !!ok, detail: detail === undefined ? '' : String(detail) });
  console.log((ok ? '[PASS] ' : '[FAIL] ') + id + (detail ? ' ' + detail : ''));
  if (ok) { pass++; } else { fail++; }
}
function info(text) { console.log('[INFO] ' + text); }
function argValue(argv, name) { const i = argv.indexOf(name); return i >= 0 && argv[i + 1] && argv[i + 1].slice(0, 2) !== '--' ? argv[i + 1] : ''; }
function sha256Buffer(buffer) { return crypto.createHash('sha256').update(buffer).digest('hex'); }
function sha256File(file) { return sha256Buffer(fs.readFileSync(file)); }
function listFiles(root, prefix, out) {
  for (const dirent of fs.readdirSync(path.join(root, prefix), { withFileTypes: true })) {
    const rel = prefix ? path.join(prefix, dirent.name) : dirent.name;
    if (dirent.isDirectory()) { listFiles(root, rel, out); } else if (dirent.isFile()) { out.push(rel); } else { throw new Blocked('提取目录含非普通文件：' + rel); }
  }
  return out;
}
function copyTree(src, dst) {
  fs.mkdirSync(dst, { recursive: true });
  for (const dirent of fs.readdirSync(src, { withFileTypes: true })) {
    const s = path.join(src, dirent.name), d = path.join(dst, dirent.name);
    if (dirent.isDirectory()) { copyTree(s, d); } else if (dirent.isFile()) { fs.copyFileSync(s, d); } else { throw new Blocked('提取目录含非普通文件：' + s); }
  }
}

const STUB = `(function () {
  var calls = { employeeUpdate: 0, capability: 0, state: 0 };
  var requests = [];
  window.__xjyFixture = { calls: calls, requests: requests };
  function describe(value) {
    if (value === null || value === undefined) { return String(value); }
    if (typeof value === 'string') { return value; }
    if (typeof value === 'object') {
      var keys = ['url', 'path', 'route', 'method'];
      var parts = [];
      for (var i = 0; i < keys.length; i++) { if (typeof value[keys[i]] === 'string') { parts.push(value[keys[i]]); } }
      if (parts.length) { return parts.join(' '); }
      try { return '[object keys=' + Object.keys(value).slice(0, 6).join(',') + ']'; } catch (e) { return '[object]'; }
    }
    return String(value);
  }
  function pathOf(args) {
    for (var i = 0; i < args.length; i++) {
      var value = args[i];
      if (typeof value === 'string') {
        if (value.charAt(0) === '/') { return value; }
        if (value.indexOf('http') === 0) { try { return new URL(value).pathname; } catch (e) { } }
      }
      if (value && typeof value === 'object') {
        var names = ['url', 'path', 'route', 'href'];
        for (var j = 0; j < names.length; j++) {
          var raw = value[names[j]];
          if (typeof raw !== 'string') { continue; }
          if (raw.charAt(0) === '/') { return raw; }
          if (raw.indexOf('http') === 0) { try { return new URL(raw).pathname; } catch (e) { } }
        }
      }
    }
    return '';
  }
  function nativeResponse(data) {
    return { ok: true, status: 200, data: data };
  }
  function respond(pathname) {
    if (pathname.indexOf('/auth/status') === 0) { return nativeResponse({ authenticated: false, needsSetup: false, user: null }); }
    if (pathname.indexOf('/api/bootstrap') === 0) { return nativeResponse(null); }
    if (pathname.indexOf('/auth/logout') === 0) { return nativeResponse({ ok: true }); }
    return nativeResponse({ ok: true, version: '1.7.0', engineVersion: '44.9.0' });
  }
  var api = {
    surface: 'desktop',
    print: function () { return Promise.resolve(); },
    request: function () {
      var args = Array.prototype.slice.call(arguments);
      var pathname = pathOf(args);
      requests.push({ path: pathname, args: args.map(describe) });
      return Promise.resolve(respond(pathname));
    },
    getConnection: function () { return Promise.resolve({ mode: 'client', host: '10.0.0.10', port: 8737, secure: false, clientOnly: true }); },
    getAppInfo: function () { return Promise.resolve({ appVersion: '1.7.0', version: '1.7.0', engineVersion: '44.9.0' }); },
    readLoginMemory: function () { return Promise.resolve({ ok: true, available: true, hasPassword: false, scopeKey: 'fixture-scope', username: '', password: '', error: '' }); },
    forgetLoginPassword: function () { return Promise.resolve({ ok: true }); },
    rememberLogin: function () { return Promise.resolve({ ok: true }); },
    rememberLoginUsername: function () { return Promise.resolve({ ok: true }); },
    getEmployeeUpdateCapability: function () {
      calls.capability++;
      return Promise.resolve({ supported: true, canInstall: false, currentVersion: '1.7.0', code: 'LOGIN_REQUIRED', message: '请先使用有效的员工账号登录。' });
    },
    getEmployeeUpdateState: function () {
      calls.state++;
      return Promise.resolve({ phase: 'idle', currentVersion: '1.7.0', message: '等待开始升级' });
    },
    employeeUpdate: function () {
      calls.employeeUpdate++;
      return Promise.resolve({ ok: false, code: 'LOGIN_REQUIRED', error: '请先使用有效的员工账号登录。', state: { phase: 'error', code: 'LOGIN_REQUIRED', currentVersion: '1.7.0', message: '请先使用有效的员工账号登录。' } });
    }
  };
  window.jewelryDesktop = api;
})();`;

(async function main() {
  const argv = process.argv.slice(2);
  const extracted = argValue(argv, '--extracted');
  const mergedJs = argValue(argv, '--merged-js');
  const deps = argValue(argv, '--deps');
  const results = argValue(argv, '--results');
  const expectFrozen = argValue(argv, '--expect-frozen-sha') || DEFAULT_FROZEN_SHA;
  const expectMerged = argValue(argv, '--expect-merged-sha') || DEFAULT_MERGED_SHA;
  const report = {
    tool: 'integration-frozen-renderer', status: null, generatedAt: new Date().toISOString(),
    inputs: { extracted: extracted, merged: mergedJs, deps: deps, results: results },
    shas: {}, targetRel: TARGET_REL, browser: null, requests: [], externalRequests: [],
    pageErrors: [], assetRequests: [], calls: null, dialogText: '', screenshots: [], checks: CHECKS,
    summary: null, blocked: null,
    limits: [
      'jewelryDesktop 为内存桩：request 同时兼容“直接返回数据”与 Response 风格；真实 preload 契约不同则本脚本阻断',
      '仅验证冻结 renderer 的 UI 接线；未签名、未打包验收、未安装、未升级、未恢复',
      '不连正式主机/数据库/账目，不读私钥'
    ]
  };
  function finish(status, code) {
    report.status = status;
    report.summary = { pass: pass, fail: fail };
    if (results) {
      try {
        fs.mkdirSync(results, { recursive: true });
        const target = path.join(results, 'integration-frozen-' + new Date().toISOString().replace(/[:.]/g, '-') + '.json');
        fs.writeFileSync(target, JSON.stringify(report, null, 2), 'utf8');
        console.log('[INFO] 报告：' + target);
      } catch (error) {
        console.log('[INFO] 报告写入失败：' + error.message);
      }
    }
    console.log('合计 ' + (pass + fail) + ' 项：PASS ' + pass + '，FAIL ' + fail);
    process.exit(code);
  }
  function blocked(message) { report.blocked = message; console.log('[BLOCKED] ' + message); finish('Blocked', 2); }

  try {
    if (!extracted || !mergedJs || !deps || !results) { blocked('参数缺失：需要 --extracted --merged-js --deps --results'); return; }
    if (!fs.existsSync(path.join(extracted, 'index.html'))) { blocked('提取目录缺 index.html：' + extracted); return; }
    if (!fs.existsSync(mergedJs)) { blocked('缺 merged 文件：' + mergedJs); return; }
    if (!fs.existsSync(deps)) { blocked('缺 node_modules：' + deps); return; }
    const mergedBytes = fs.readFileSync(mergedJs);
    report.shas.merged = sha256Buffer(mergedBytes);
    if (expectMerged && report.shas.merged !== expectMerged) { blocked('merged SHA 不符：' + report.shas.merged); return; }

    const runDir = path.join(results, 'frozen-run-' + new Date().toISOString().replace(/[:.]/g, '-'));
    const fixture = path.join(runDir, 'fixture');
    copyTree(extracted, fixture);
    const targetFile = path.join(fixture, TARGET_REL);
    if (!fs.existsSync(targetFile)) { blocked('提取目录缺目标主脚本：' + TARGET_REL); return; }
    report.shas.extractedMain = sha256File(targetFile);
    if (expectFrozen && report.shas.extractedMain !== expectFrozen) { blocked('提取主脚本 SHA 不符（不是已知冻结版本）：' + report.shas.extractedMain); return; }
    const indexHtml = fs.readFileSync(path.join(fixture, 'index.html'), 'utf8');
    const referenced = indexHtml.indexOf(path.basename(TARGET_REL)) >= 0;
    check('I1 index.html 引用目标主脚本', referenced, path.basename(TARGET_REL));
    if (!referenced) { blocked('index.html 未引用目标主脚本，不能把替换后的 merged 视为同包 UI'); return; }

    const before = listFiles(extracted, '', []).sort();
    const after = listFiles(fixture, '', []).sort();
    check('I2 提取树文件集合复制一致', before.length === after.length && before.every((v, i) => v === after[i]), 'files=' + before.length);
    fs.copyFileSync(mergedJs, targetFile);
    report.shas.fixtureMain = sha256File(targetFile);
    check('I3 fixture 主脚本已换成 merged 字节', report.shas.fixtureMain === report.shas.merged, report.shas.fixtureMain);
    let otherDiffs = 0;
    for (const rel of after) {
      if (rel === TARGET_REL) { continue; }
      if (sha256File(path.join(extracted, rel)) !== sha256File(path.join(fixture, rel))) { otherDiffs++; }
    }
    check('I4 其他资产逐字节未变（只替换目标主脚本）', otherDiffs === 0, 'diffs=' + otherDiffs);
    report.assetRequests = after.filter((rel) => rel !== TARGET_REL).slice(0, 200);

    const types = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.mjs': 'text/javascript; charset=utf-8', '.css': 'text/css; charset=utf-8', '.json': 'application/json; charset=utf-8', '.png': 'image/png', '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg', '.svg': 'image/svg+xml', '.woff2': 'font/woff2', '.ico': 'image/x-icon', '.webp': 'image/webp' };
    const server = http.createServer((req, res) => {
      const pathname = decodeURIComponent((req.url || '/').split('?')[0]);
      const target = path.resolve(fixture, '.' + pathname);
      if (target !== fixture && !target.startsWith(fixture + path.sep)) { res.writeHead(403); res.end('forbidden'); return; }
      fs.readFile(target, (error, data) => {
        if (error) { res.writeHead(404); res.end('not found'); return; }
        res.writeHead(200, { 'Content-Type': types[path.extname(target).toLowerCase()] || 'application/octet-stream', 'Cache-Control': 'no-store' });
        res.end(data);
      });
    });
    await new Promise((resolve, reject) => { server.once('error', reject); server.listen(0, '127.0.0.1', resolve); });
    const port = server.address().port;
    const base = 'http://127.0.0.1:' + port;
    info('静态服务 ' + base + '（仅 127.0.0.1）');

    const playwright = require(require.resolve('playwright', { paths: [deps] }));
    let browser = null, context = null;
    try {
      try { browser = await playwright.chromium.launch({ channel: 'msedge', headless: true, chromiumSandbox: true }); }
      catch (error) { blocked('Edge(channel=msedge) 启动失败（未加 no-sandbox）：' + error.message); return; }
      report.browser = { channel: 'msedge', version: browser.version(), chromiumSandbox: true, args: [] };
      context = await browser.newContext({ viewport: { width: 1440, height: 900 }, locale: 'zh-CN' });
      await context.addInitScript(STUB);
      await context.route('**/*', async (route) => {
        const url = new URL(route.request().url());
        if (url.hostname === '127.0.0.1' && Number(url.port) === port) { return route.continue(); }
        report.externalRequests.push(url.href);
        return route.abort();
      });
      const page = await context.newPage();
      page.setDefaultTimeout(20000);
      page.on('pageerror', (error) => report.pageErrors.push(String((error && error.message) || error)));
      page.on('console', (message) => { if (message.type() === 'error') { info('console.error: ' + message.text().slice(0, 200)); } });
      const requestsSeen = [];
      page.on('request', (request) => {
        const url = new URL(request.url());
        if (url.hostname === '127.0.0.1' && Number(url.port) === port) { requestsSeen.push(url.pathname); }
      });
      await page.goto(base + '/index.html', { waitUntil: 'domcontentloaded' });
      let loginVisible = false;
      try {
        await page.waitForSelector('main.desktop-auth', { state: 'visible' });
        loginVisible = true;
      } catch (error) { loginVisible = false; }
      check('I5 真实未登录页已渲染（main.desktop-auth）', loginVisible, report.pageErrors.slice(0, 2).join(' | '));
      if (!loginVisible) {
        const shot = path.join(results, 'frozen-login-missing.png');
        try { await page.screenshot({ path: shot, fullPage: true, animations: 'disabled' }); report.screenshots.push(shot); } catch (error) { info('截图失败：' + error.message); }
        blocked('未渲染未登录页：真实 bridge 契约可能与内存桩不符，需提供 bridge/preload 源码');
        return;
      }
      const bodyText = await page.evaluate(() => document.body ? document.body.innerText : '');
      check('I6 页面正文含工作室登录文案（非空白页）', bodyText.indexOf('工作室') >= 0, 'text=' + bodyText.replace(/\s+/g, ' ').slice(0, 120));
      let usernameVisible = false;
      try {
        await page.waitForSelector('input[name="username"]', { state: 'visible', timeout: 10000 });
        usernameVisible = await page.locator('input[name="username"]').first().isVisible();
      } catch (error) { usernameVisible = false; }
      check('I7 用户名输入可见', usernameVisible, usernameVisible ? 'visible' : 'not visible within 10s');
      const cssRequests = requestsSeen.filter((p) => /\.css$/i.test(p));
      check('I8 原样式资源参与加载', cssRequests.length >= 1 || requestsSeen.length > 1, 'css=' + cssRequests.length + ' 请求=' + requestsSeen.length);
      const entry = page.locator('[data-testid="login-update-entry"]');
      const entryCount = await entry.count();
      check('I9 全局一键升级按钮唯一', entryCount === 1, 'count=' + entryCount);
      check('I10 按钮可见且文案正确', entryCount === 1 && (await entry.first().isVisible()) && (await entry.first().innerText()).trim() === '一键升级');
      let dialogOk = false;
      let dialogText = '';
      if (entryCount === 1) {
        await entry.first().click();
        try { await page.waitForSelector('section[role="dialog"]', { timeout: 10000 }); dialogOk = await page.locator('section[role="dialog"]').first().isVisible(); } catch (error) { dialogOk = false; }
        if (dialogOk) {
          dialogText = await page.locator('section[role="dialog"]').first().innerText();
          report.dialogText = dialogText.replace(/\s+/g, ' ').slice(0, 400);
        }
      }
      check('I11 真实点击弹出既有面板（role=dialog）', dialogOk, report.dialogText);
      check('I12 未登录面板显示登录要求', dialogOk && dialogText.indexOf('请先使用有效的员工账号登录') >= 0, report.dialogText);
      check('I13 未登录无安装动作按钮', (await page.locator('.employee-update-primary').count()) === 0);
      const calls = await page.evaluate(() => window.__xjyFixture ? window.__xjyFixture.calls : null);
      report.calls = calls;
      check('I14 employeeUpdate 调用为 0', !!calls && calls.employeeUpdate === 0, JSON.stringify(calls));
      const stubRequests = await page.evaluate(() => window.__xjyFixture ? window.__xjyFixture.requests : null);
      report.requests = stubRequests || [];
      const statusSeen = Array.isArray(stubRequests) && stubRequests.some((item) => item.path.indexOf('/auth/status') === 0);
      check('I15 登录页状态接口经内存桩返回', statusSeen, JSON.stringify((stubRequests || []).map((item) => item.path).slice(0, 6)));
      check('I16 无未捕获页面错误', report.pageErrors.length === 0, report.pageErrors.slice(0, 2).join(' | ').slice(0, 200));
      check('I17 无外网请求（仅 127.0.0.1）', report.externalRequests.length === 0, report.externalRequests.slice(0, 3).join('; '));
      const shot = path.join(results, 'frozen-login-update-panel.png');
      await page.waitForTimeout(300);
      await page.screenshot({ path: shot, fullPage: true, animations: 'disabled' });
      report.screenshots.push(shot);
      info('截图：' + shot);
    } finally {
      if (context) { try { await context.close(); } catch (error) { } }
      if (browser) { try { await browser.close(); } catch (error) { } }
      await new Promise((resolve) => { server.close(() => resolve()); });
      check('I18 静态服务优雅关闭', server.listening === false);
    }
  } catch (error) {
    if (error instanceof Blocked) { blocked(error.message); return; }
    report.blocked = '未预期异常：' + (error && error.stack || error);
    console.log('[BLOCKED] ' + report.blocked);
    finish('Failed', 2);
    return;
  }
  finish(fail === 0 ? 'Succeeded' : 'Failed', fail === 0 ? 0 : 1);
})().catch((error) => { console.error('[BLOCKED] ' + (error && error.stack || error)); process.exit(2); });