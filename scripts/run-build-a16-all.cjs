'use strict';
// run-build-a16-all.cjs —— 归档上一轮产物后，运行 run-build-a16.cjs（a16 引擎：空目录放行 + 已知额外源文件放行）。
const fs = require('node:fs');
const path = require('node:path');
const { spawnSync } = require('node:child_process');
const R = 'D:/Codex/xjy-release-20261022';
const NODE = 'E:/node/node.exe';
const ts = new Date().toISOString().replace(/[:.]/g, '-');
const arch = path.join(R, 'evidence-c6-failed-170', 'rerun-a16-' + ts);
fs.mkdirSync(arch, { recursive: true });
const moveIf = (rel) => {
  const src = path.join(R, rel);
  if (!fs.existsSync(src)) return false;
  const dst = path.join(arch, rel.replace(/[\\/]/g, '__'));
  fs.renameSync(src, dst);
  console.log('archived ' + rel);
  return true;
};
for (const rel of ['build-status.json', 'outer-finalize-status.json', 'candidate/build', 'candidate/proposal', 'candidate/approvals', 'source/sign-worker-release.cjs', 'source/worker-scope.json', 'source/worker-signing-report.json', 'source/audit-release.cjs', 'source/outer-signing-report.json', 'source/root-outer-signing-scope-20261022-ROOT.json', 'source/sign-native170-ROOT-20261022-outer-a1.cjs']) moveIf(rel);
const r = spawnSync(NODE, [path.join(R, 'run-build-a16.cjs')], { cwd: R, encoding: 'utf8', maxBuffer: 16 * 1024 * 1024 });
process.stdout.write(r.stdout || '');
process.stderr.write(r.stderr || '');
console.log('BUILD_EXIT=' + r.status);
