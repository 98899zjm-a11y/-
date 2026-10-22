'use strict';
const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');

const LONG = p => (p.startsWith('\\\\?\\') ? p : '\\\\?\\' + p);
const buf = Buffer.allocUnsafe(4 * 1024 * 1024);
function sha256File(p) {
  const fd = fs.openSync(LONG(p), 'r');
  try {
    const h = crypto.createHash('sha256');
    let n;
    while ((n = fs.readSync(fd, buf, 0, buf.length, null)) > 0) h.update(buf.subarray(0, n));
    return h.digest('hex');
  } finally { fs.closeSync(fd); }
}
function walk(root, rel, out) {
  for (const e of fs.readdirSync(LONG(path.join(root, rel)), { withFileTypes: true })) {
    const r = rel ? rel + '/' + e.name : e.name;
    if (e.isDirectory()) walk(root, r, out); else out.push(r);
  }
}
const installRoot = process.argv[2];
const dataRoot = process.argv[3];
const seedDataRoot = process.argv[4];
const outFile = process.argv[5];

const stateDir = path.join(installRoot, '.program.xjy-engine-state');
const env = JSON.parse(fs.readFileSync(LONG(path.join(stateDir, 'journal.json')), 'utf8'));
const m = JSON.parse(env.payload);
const expected = m.targetFiles;
const seen = [];
walk(installRoot, '', seen);
const seenSet = new Set(seen);
const byPath = new Map(expected.map(f => [f.path, f]));
let mismatch = [], missing = [], checked = 0, bytes = 0;
for (const f of expected) {
  if (!seenSet.has(f.path)) { missing.push(f.path); continue; }
  const abs = path.join(installRoot, f.path);
  const st = fs.statSync(LONG(abs));
  bytes += st.size;
  const h = sha256File(abs);
  checked++;
  if (h !== f.sha256 || st.size !== f.size) mismatch.push({ path: f.path, want: f.sha256, got: h, wantSize: f.size, gotSize: st.size });
}
const extra = seen.filter(p => !byPath.has(p) && !p.startsWith('.xjy-initial-upgrade/') && !p.startsWith('.xjy-patches/') && !p.startsWith('员工本地设置/'));

// data compare against pristine seed copy
let dataSame = 0, dataDiff = [], dataMissing = [];
if (dataRoot && seedDataRoot && fs.existsSync(LONG(seedDataRoot))) {
  const seedFiles = [];
  walk(seedDataRoot, '', seedFiles);
  for (const rel of seedFiles) {
    const a = path.join(dataRoot, rel), b = path.join(seedDataRoot, rel);
    if (!fs.existsSync(LONG(a))) { dataMissing.push(rel); continue; }
    if (sha256File(a) === sha256File(b)) dataSame++; else dataDiff.push(rel);
  }
}
const result = {
  at: new Date().toISOString(),
  installRoot, dataRoot,
  journal: { phase: m.phase, role: m.role, transactionId: m.transactionId, sourceVersion: m.sourceVersion, targetVersion: m.targetVersion, sourceEngineVersion: m.sourceEngineVersion, targetEngineVersion: m.targetEngineVersion, targetFileCount: expected.length },
  install: { expected: expected.length, seen: seen.length, checked, bytes, mismatchCount: mismatch.length, missingCount: missing.length, mismatch: mismatch.slice(0, 20), missing: missing.slice(0, 20), extraCount: extra.length, extra: extra.slice(0, 20) },
  data: { seedFiles: dataSame + dataDiff.length + dataMissing.length, same: dataSame, diffCount: dataDiff.length, diff: dataDiff.slice(0, 20), missingCount: dataMissing.length, missing: dataMissing.slice(0, 20) }
};
fs.writeFileSync(outFile, JSON.stringify(result, null, 2));
console.log(JSON.stringify({ phase: m.phase, checked, mismatch: mismatch.length, missing: missing.length, extra: extra.length, dataSame, dataDiff: dataDiff.length, dataMissing: dataMissing.length }));
