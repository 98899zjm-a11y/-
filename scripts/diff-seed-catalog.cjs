const fs = require('fs');
const path = require('path');
const B = 'D:/Codex/xjy-release-20261022/candidate/build/package/engine-native170-binding.json';
const SEED = 'D:/Codex/xjy-accept-170/legacy-root';
const binding = JSON.parse(fs.readFileSync(B, 'utf8'));
const entry = binding.native.sourceBindings.find(b => b.meta && b.meta.programVersion === '1.6.2');
if (!entry) { console.error('no 1.6.2 binding'); process.exit(1); }
const allowed = new Map(entry.meta.allowedFiles.map(f => [f.toLowerCase(), f]));
const prefixes = ['.xjy-initial-upgrade/', '.xjy-patches/', '员工本地设置/'];
const marker = 'xjy-install-activation.json';
const walk = (dir, rel, out) => {
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    const r = rel ? rel + '/' + e.name : e.name;
    if (e.isDirectory()) {
      if (prefixes.some(p => (r + '/').toLowerCase().startsWith(p))) continue;
      walk(path.join(dir, e.name), r, out);
    } else out.push(r);
  }
};
const files = [];
walk(SEED, '', files);
const extra = files.filter(f => !allowed.has(f.toLowerCase()) && f.toLowerCase() !== marker);
const missing = [...allowed.keys()].filter(k => !files.some(f => f.toLowerCase() === k));
console.log(JSON.stringify({ seedFiles: files.length, allowedCount: allowed.size, extraCount: extra.length, extra: extra.slice(0, 40), missingCount: missing.length, missing: missing.slice(0, 40) }, null, 2));
