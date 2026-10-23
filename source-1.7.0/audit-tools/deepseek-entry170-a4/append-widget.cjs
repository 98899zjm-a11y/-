#!/usr/bin/env node
'use strict';
// 只读原 main JS，写出 merged 到显式目录；不覆盖 renderer-dist，不重打包 asar，不签名。
// 用法：node build-update-entry.cjs --renderer <renderer> --main-js <原main-7etXIfP0.js> --deps <node_modules> --out <目录>
const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const argv = process.argv.slice(2);
const arg = (k) => { const i = argv.indexOf(k); return i >= 0 && argv[i + 1] ? argv[i + 1] : ''; };
const sha = (b) => crypto.createHash('sha256').update(b).digest('hex');

(async () => {
  const renderer = path.resolve(arg('--renderer'));
  const mainJs = path.resolve(arg('--main-js'));
  const deps = path.resolve(arg('--deps'));
  const outDir = path.resolve(arg('--out'));
  for (const p of [renderer, mainJs, deps]) if (!fs.existsSync(p)) { console.error('[BLOCKED] 输入缺失：' + p); process.exit(2); }
  fs.mkdirSync(outDir, { recursive: true });
  const esbuild = require(require.resolve('esbuild', { paths: [deps] }));
  const entry = path.join(renderer, 'update-entry-widget.tsx');
  if (!fs.existsSync(entry)) { console.error('[BLOCKED] 缺 widget 源：' + entry); process.exit(2); }
  const widgetJs = path.join(outDir, 'update-entry-widget.iife.js');
  await esbuild.build({
    entryPoints: [entry], outfile: widgetJs, bundle: true, format: 'iife', platform: 'browser',
    target: ['chrome110'], jsx: 'automatic', minify: true, charset: 'utf8', legalComments: 'none',
    loader: { '.css': 'empty', '.png': 'dataurl', '.jpg': 'dataurl', '.svg': 'dataurl' },
    define: { 'process.env.NODE_ENV': '"production"' }, nodePaths: [deps], logLevel: 'silent'
  });
  const original = fs.readFileSync(mainJs);
  const widget = fs.readFileSync(widgetJs);
  const begin = Buffer.from('\n/* XJY-UPDATE-ENTRY-WIDGET BEGIN */\n;', 'utf8');
  const end = Buffer.from('\n/* XJY-UPDATE-ENTRY-WIDGET END */\n', 'utf8');
  const merged = Buffer.concat([original, begin, widget, end]);
  const mergedPath = path.join(outDir, 'main-7etXIfP0.js');
  fs.writeFileSync(mergedPath, merged);
  const widgetText = widget.toString('utf8');
  const evidence = {
    tool: 'build-update-entry', generatedAt: new Date().toISOString(),
    inputs: { renderer, mainJs, deps },
    original: { size: original.length, sha256: sha(original) },
    widget: { path: widgetJs, size: widget.length, sha256: sha(widget), usesEval: /\beval\s*\(|new Function/.test(widgetText) },
    merged: { path: mergedPath, size: merged.length, sha256: sha(merged), prefixIdentical: merged.subarray(0, original.length).equals(original) },
    status: '未签名/未重打包/未验收'
  };
  fs.writeFileSync(path.join(outDir, 'build-update-entry.evidence.json'), JSON.stringify(evidence, null, 2), 'utf8');
  console.log('[INFO] merged=' + mergedPath + ' sha256=' + evidence.merged.sha256 + ' size=' + merged.length + ' eval=' + evidence.widget.usesEval);
})().catch(e => { console.error('[BLOCKED] ' + (e && e.stack || e)); process.exit(2); });