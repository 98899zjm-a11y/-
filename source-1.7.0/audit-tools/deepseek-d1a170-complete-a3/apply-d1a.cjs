// patch/apply-d1a.cjs
// 用法：node patch/apply-d1a.cjs patch/d1a-engine-separation.a2.anchors.json [a4树根] [--dry-run]
'use strict';
const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const cp = require('node:child_process');

const anchorFile = process.argv[2];
const treeArg = process.argv[3] && !process.argv[3].startsWith('--') ? process.argv[3] : path.dirname(__dirname);
const treeRoot = path.resolve(treeArg);
const dryRun = process.argv.includes('--dry-run');
if (!anchorFile || !fs.existsSync(anchorFile)) { console.error('[BLOCKED] 缺少锚点 JSON：' + anchorFile); process.exit(2); }
const SHA = /^[a-f0-9]{64}$/;
const digest = b => crypto.createHash('sha256').update(b).digest('hex');
const anchors = JSON.parse(fs.readFileSync(anchorFile, 'utf8'));
let bad = 0;
const plans = [];

for (const pre of anchors.preconditions || []) {
  const abs = path.join(treeRoot, pre.file);
  if (!fs.existsSync(abs)) { console.log('[FAIL] 缺文件 ' + pre.file); bad++; continue; }
  const actual = digest(fs.readFileSync(abs));
  if (SHA.test(pre.sha256 || '') && actual !== pre.sha256) { console.log('[FAIL] SHA ' + pre.file + ' 实际=' + actual); bad++; continue; }
  console.log('[PASS] SHA ' + pre.file + ' ' + actual.slice(0, 12));
}
if (bad) { console.log('[BLOCKED] 前置校验失败，未写入任何文件'); process.exit(2); }

for (const f of anchors.files) {
  const abs = path.join(treeRoot, f.file);
  if (!fs.existsSync(abs)) { console.log('[FAIL] 缺文件 ' + f.file); bad++; continue; }
  let text = fs.readFileSync(abs, 'utf8');
  let ok = true;
  for (const r of f.replacements) {
    const at = text.indexOf(r.old);
    if (at < 0) { console.log('[FAIL] ' + r.id + ' 未命中'); ok = false; break; }
    if (text.indexOf(r.old, at + r.old.length) >= 0) { console.log('[FAIL] ' + r.id + ' 命中不唯一'); ok = false; break; }
    text = text.slice(0, at) + r.new + text.slice(at + r.old.length);
    console.log('[PASS] ' + r.id + ' 已替换 ' + r.old.length + '→' + r.new.length);
  }
  if (!ok) { bad++; continue; }
  plans.push({ file: f.file, abs, text });
}
if (bad) { console.log('[BLOCKED] ' + bad + ' 项失败，未写入任何文件'); process.exit(2); }
if (dryRun) { console.log('[INFO] dry-run：全部锚点可应用，未写入'); process.exit(0); }

for (const p of plans) {
  const tmp = p.abs + '.d1a-tmp';
  fs.writeFileSync(tmp, p.text, 'utf8');
  try { cp.execFileSync(process.execPath, ['--check', tmp], { stdio: 'pipe' }); }
  catch (e) {
    fs.unlinkSync(tmp);
    console.log('[BLOCKED] 语法检查失败 ' + p.file + '：' + String(e.stderr || e.message).slice(0, 400));
    process.exit(2);
  }
  if (!fs.existsSync(p.abs + '.a4-bak')) fs.copyFileSync(p.abs, p.abs + '.a4-bak');
  fs.renameSync(tmp, p.abs);
  console.log('[OK] 落盘 ' + p.file + ' sha256=' + digest(fs.readFileSync(p.abs)) + '（备份 .a4-bak）');
}
console.log('[DONE] 请运行 node tests/a4-sameversion-contract.test.cjs，期望 17 项全 PASS');