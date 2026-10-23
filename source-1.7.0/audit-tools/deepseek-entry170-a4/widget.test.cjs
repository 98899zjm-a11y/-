#!/usr/bin/env node
'use strict';
// 依赖：--deps 预置 node_modules（esbuild/playwright/react/react-dom/lucide-react）；Guest 自带 Edge。
// 只 127.0.0.1 静态服务，不联网，不读真实主机/数据库/账目；不改源文件；server.close 优雅关闭。
// 用法：node test-update-entry-widget.cjs --renderer <renderer> --main-js <原main JS> --merged-js <追加后>
//        --deps <node_modules> --results <显式目录> [--expected-original-sha <sha>]
const fs = require('node:fs');
const path = require('node:path');
const http = require('node:http');
const crypto = require('node:crypto');
const argv = process.argv.slice(2);
const arg = (k) => { const i = argv.indexOf(k); return i >= 0 && argv[i + 1] ? argv[i + 1] : ''; };
const sha = (b) => crypto.createHash('sha256').update(b).digest('hex');
const CHECK = [];
let pass = 0, fail = 0;
function check(id, ok, detail) {
  CHECK.push({ id, ok: !!ok, detail: detail === undefined ? '' : String(detail) });
  if (ok) { pass++; console.log('[PASS] ' + id + (detail ? ' ' + detail : '')); }
  else { fail++; console.log('[FAIL] ' + id + (detail ? ' ' + detail : '')); }
}
function info(t) { console.log('[INFO] ' + t); }

const STUB_FULL = `(function(){var c={capability:0,state:0,employeeUpdate:0};window.__xjy={calls:c,lastCapability:null};
window.jewelryDesktop={surface:'desktop',getEmployeeUpdateCapability:function(){c.capability++;var cap={supported:true,canInstall:false,currentVersion:'1.7.0',code:'LOGIN_REQUIRED',message:'请先使用有效的员工账号登录。'};window.__xjy.lastCapability=cap;return Promise.resolve(cap);},getEmployeeUpdateState:function(){c.state++;return Promise.resolve({phase:'idle',currentVersion:'1.7.0',message:'等待开始升级'});},employeeUpdate:function(){c.employeeUpdate++;return Promise.resolve({ok:false,code:'LOGIN_REQUIRED',error:'请先使用有效的员工账号登录。',state:{phase:'error',currentVersion:'1.7.0',message:'请先使用有效的员工账号登录。',code:'LOGIN_REQUIRED'}});}};})();`;
const STUB_BROWSER = STUB_FULL.replace("surface:'desktop'", "surface:'browser'");
const STUB_MISSING = `(function(){window.jewelryDesktop={surface:'desktop'};})();`;
const FOOTER = `<footer class="auth-footer" style="position:fixed;right:16px;bottom:8px;width:220px;height:30px;background:#eee">XIN JIN YUAN · FIXTURE FOOTER</footer>`;

const VARIANTS = [
  { name: 'unlogged-full-bridge', stub: STUB_FULL, footer: false },
  { name: 'browser-surface', stub: STUB_BROWSER, footer: false },
  { name: 'missing-bridge', stub: STUB_MISSING, footer: false },
  { name: 'footer-overlap', stub: STUB_FULL, footer: true }
];

(async () => {
  const renderer = path.resolve(arg('--renderer'));
  const mainJs = path.resolve(arg('--main-js'));
  const mergedJs = path.resolve(arg('--merged-js'));
  const deps = path.resolve(arg('--deps'));
  const results = path.resolve(arg('--results'));
  const expectedOriginal = arg('--expected-original-sha');
  const external = [];
  const EVIDENCE = { tool: 'test-update-entry-widget', generatedAt: new Date().toISOString(), inputs: {}, byteChecks: {}, pages: [], externalRequests: external, checks: CHECK, blocked: null, summary: null };
  function writeEvidence() {
    EVIDENCE.summary = { pass, fail };
    try { fs.mkdirSync(results, { recursive: true }); const t = path.join(results, 'widget-' + new Date().toISOString().replace(/[:.]/g, '-') + '.json'); fs.writeFileSync(t, JSON.stringify(EVIDENCE, null, 2), 'utf8'); console.log('[INFO] 证据：' + t); } catch (e) { console.log('[INFO] 证据写入失败：' + e.message); }
  }
  try {
    if (!results) throw new Error('缺少 --results');
    for (const p of [renderer, mainJs, mergedJs, deps]) if (!fs.existsSync(p)) throw new Error('输入缺失：' + p);

    // 字节合同
    const original = fs.readFileSync(mainJs), merged = fs.readFileSync(mergedJs);
    const mergedText = merged.toString('utf8');
    EVIDENCE.inputs = { renderer, mainJs, mergedJs, deps, expectedOriginal: expectedOriginal || null };
    EVIDENCE.byteChecks = { originalSha256: sha(original), mergedSha256: sha(merged), originalSize: original.length, mergedSize: merged.length };
    check('M1 merged 前缀与原文件逐字节一致', merged.subarray(0, original.length).equals(original));
    check('M2 merged 尾部含 widget 标记', mergedText.indexOf('XJY-UPDATE-ENTRY-WIDGET BEGIN') >= 0);
    check('M3 merged 含 login 专属 testid', mergedText.indexOf('data-testid') >= 0 && mergedText.indexOf('login-update-entry') >= 0);
    check('M4 merged 含“一键升级”文案', mergedText.indexOf('一键升级') >= 0);
    check('M5 merged 含升级面板结构', mergedText.indexOf('employee-update-panel') >= 0);
    check('M6 merged 无 eval/new Function（CSP 风险）', !/\beval\s*\(|new Function/.test(mergedText));
    if (expectedOriginal) check('M7 原 main JS 与预期 SHA 一致（未被改动）', sha(original) === expectedOriginal.toLowerCase(), sha(original));
    else info('M7 跳过：未提供 --expected-original-sha');

    // 编译真实 widget（真实 employee-update.tsx 打包在内）
    const esbuild = require(require.resolve('esbuild', { paths: [deps] }));
    const runDir = path.join(results, 'widget-run-' + new Date().toISOString().replace(/[:.]/g, '-'));
    fs.mkdirSync(runDir, { recursive: true });
    const widgetJs = path.join(runDir, 'widget.js');
    await esbuild.build({
      entryPoints: [path.join(renderer, 'update-entry-widget.tsx')], outfile: widgetJs, bundle: true, format: 'iife',
      platform: 'browser', target: ['chrome110'], jsx: 'automatic', minify: true, charset: 'utf8', legalComments: 'none',
      loader: { '.css': 'empty', '.png': 'dataurl', '.jpg': 'dataurl', '.svg': 'dataurl' },
      define: { 'process.env.NODE_ENV': '"production"' }, nodePaths: [deps], logLevel: 'silent'
    });
    check('M8 widget 真实编译通过', fs.existsSync(widgetJs) && fs.statSync(widgetJs).size > 0, 'size=' + fs.statSync(widgetJs).size);

    for (const v of VARIANTS) {
      fs.writeFileSync(path.join(runDir, 'stub-' + v.name + '.js'), v.stub, 'utf8');
      fs.writeFileSync(path.join(runDir, 'index-' + v.name + '.html'),
        '<!DOCTYPE html><html lang="zh-CN"><head><meta charset="utf-8"><title>fixture</title></head><body><div id="root"></div>' +
        (v.footer ? FOOTER : '') + '<script src="./stub-' + v.name + '.js"></script><script src="./widget.js"></script></body></html>', 'utf8');
    }

    const types = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8' };
    const server = http.createServer((req, res) => {
      const target = path.resolve(runDir, '.' + decodeURIComponent((req.url || '/').split('?')[0]));
      if (!target.startsWith(runDir)) { res.writeHead(403); res.end(); return; }
      fs.readFile(target, (err, data) => { if (err) { res.writeHead(404); res.end(); return; } res.writeHead(200, { 'Content-Type': types[path.extname(target).toLowerCase()] || 'application/octet-stream', 'Cache-Control': 'no-store' }); res.end(data); });
    });
    await new Promise((r, j) => { server.once('error', j); server.listen(0, '127.0.0.1', r); });
    const port = server.address().port, base = 'http://127.0.0.1:' + port;

    const playwright = require(require.resolve('playwright', { paths: [deps] }));
    let browser = null, context = null;
    try {
      browser = await playwright.chromium.launch({ channel: 'msedge', headless: true, chromiumSandbox: true });
      EVIDENCE.browser = { channel: 'msedge', version: browser.version(), chromiumSandbox: true, args: [] };
      context = await browser.newContext({ viewport: { width: 1280, height: 900 }, locale: 'zh-CN' });
      await context.route('**/*', async (route) => { const u = new URL(route.request().url()); if (u.hostname === '127.0.0.1' && Number(u.port) === port) return route.continue(); external.push(u.href); return route.abort(); });
      async function open(v) {
        const page = await context.newPage();
        const errs = [];
        page.on('pageerror', (e) => errs.push(String((e && e.message) || e)));
        await page.goto(base + '/index-' + v.name + '.html', { waitUntil: 'domcontentloaded' });
        await page.waitForTimeout(400);
        const rec = { variant: v.name, errors: errs, screenshot: path.join(results, 'widget-' + v.name + '.png') };
        EVIDENCE.pages.push(rec);
        return { page, rec, errs };
      }
      // 变体 1：未登录完整桥接
      {
        const { page, rec, errs } = await open(VARIANTS[0]);
        const entry = page.locator('[data-testid="login-update-entry"]');
        check('W1 宿主唯一', await page.locator('#xjy-update-entry-host').count() === 1);
        check('W2 按钮唯一且可见', await entry.count() === 1 && await entry.first().isVisible());
        check('W3 按钮文案为“一键升级”', (await entry.first().innerText()).trim() === '一键升级', JSON.stringify((await entry.first().innerText()).trim()));
        await entry.first().click();
        let dialogOk = false;
        try { await page.waitForSelector('section[role="dialog"]', { timeout: 10000 }); dialogOk = await page.locator('section[role="dialog"]').first().isVisible(); } catch (e) { dialogOk = false; }
        check('W4 真实点击弹出 role=dialog', dialogOk);
        if (dialogOk) {
          const text = await page.locator('section[role="dialog"]').first().innerText();
          rec.dialogText = text.replace(/\s+/g, ' ').slice(0, 300);
          check('W5 未登录显示 LOGIN_REQUIRED 文本', text.indexOf('请先使用有效的员工账号登录') >= 0, rec.dialogText);
          check('W6 未登录无安装按钮', await page.locator('.employee-update-primary').count() === 0);
        }
        await entry.first().click();
        await page.waitForTimeout(300);
        check('W7 重复点击不重复弹窗', await page.locator('section[role="dialog"]').count() === 1);
        await page.evaluate(() => window.__xjyUpdateEntry && window.__xjyUpdateEntry.mount());
        check('W8 再次 mount 不重复宿主', await page.locator('#xjy-update-entry-host').count() === 1);
        const calls = await page.evaluate(() => (window.__xjy && window.__xjy.calls) || null);
        const cap = await page.evaluate(() => (window.__xjy && window.__xjy.lastCapability) || null);
        rec.calls = calls; rec.capability = cap;
        check('W9 employeeUpdate 调用 0', !!calls && calls.employeeUpdate === 0, JSON.stringify(calls));
        check('W10 能力查询一次且为 LOGIN_REQUIRED', !!calls && calls.capability === 1 && !!cap && cap.code === 'LOGIN_REQUIRED', JSON.stringify(cap));
        check('W11 无未捕获页面错误', errs.length === 0, errs.join(' | ').slice(0, 160));
        await page.screenshot({ path: rec.screenshot, fullPage: true });
        await page.close();
      }
      // 变体 2：browser surface 不显示
      {
        const { page, rec } = await open(VARIANTS[1]);
        check('W12 browser surface 不挂载宿主', await page.locator('#xjy-update-entry-host').count() === 0);
        check('W13 browser surface 无 Windows 安装按钮', await page.locator('[data-testid="login-update-entry"]').count() === 0);
        await page.screenshot({ path: rec.screenshot, fullPage: true });
        await page.close();
      }
      // 变体 3：桥接缺失明确说明，不弹升级面板
      {
        const { page, rec } = await open(VARIANTS[2]);
        const entry = page.locator('[data-testid="login-update-entry"]');
        check('W14 桥接缺失时按钮仍可见', await entry.count() === 1 && await entry.first().isVisible());
        await entry.first().click();
        await page.waitForTimeout(400);
        check('W15 桥接缺失不弹升级面板', await page.locator('section[role="dialog"]').count() === 0);
        const notice = await page.locator('[id="xjy-update-entry-panel-notice"]').innerText().catch(() => '');
        rec.notice = notice;
        check('W16 桥接缺失给出明确说明', notice.indexOf('尚未提供自动升级入口') >= 0, notice);
        check('W17 桥接缺失无 employeeUpdate 调用', await page.evaluate(() => !window.__xjy || window.__xjy.calls.employeeUpdate === 0));
        await page.screenshot({ path: rec.screenshot, fullPage: true });
        await page.close();
      }
      // 变体 4：与 footer 重叠时上移，不遮挡
      {
        const { page, rec } = await open(VARIANTS[3]);
        const bottom = await page.locator('#xjy-update-entry-host').evaluate((el) => el.style.bottom);
        rec.hostBottom = bottom;
        check('W18 与 footer 重叠时上移避免遮挡', bottom === '76px', 'bottom=' + bottom);
        await page.screenshot({ path: rec.screenshot, fullPage: true });
        await page.close();
      }
      check('W19 仅本机请求无外网', external.length === 0, external.slice(0, 4).join('; '));
    } finally {
      if (context) { try { await context.close(); } catch { } }
      if (browser) { try { await browser.close(); } catch { } }
      await new Promise((r) => server.close(r));
      check('W20 静态服务优雅关闭', server.listening === false);
    }
  } catch (e) {
    EVIDENCE.blocked = String((e && e.stack) || e);
    console.log('[BLOCKED] ' + EVIDENCE.blocked);
    writeEvidence();
    process.exit(2);
  }
  writeEvidence();
  console.log('合计 ' + (pass + fail) + ' 项：PASS ' + pass + '，FAIL ' + fail);
  process.exit(fail === 0 ? 0 : 1);
})();