'use strict';
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const [installRoot, stateDir, dataRoot, baselineDataRoot, outFile] = process.argv.slice(2);
const q = p => (p.length >= 240 ? '\\\\?\\' + p : p);
const sha = p => new Promise((res, rej) => {
  const h = crypto.createHash('sha256');
  const s = fs.createReadStream(q(p), { highWaterMark: 4 * 1024 * 1024 });
  s.on('error', rej);
  s.on('data', d => h.update(d));
  s.on('end', () => res(h.digest('hex')));
});
const walk = (dir, base, acc) => {
  for (const e of fs.readdirSync(q(dir), { withFileTypes: true })) {
    const full = path.join(dir, e.name);
    const rel = base ? base + '/' + e.name : e.name;
    if (e.isDirectory()) walk(full, rel, acc); else acc.push({ rel, full, size: e.size });
  }
  return acc;
};
(async () => {
  const env = JSON.parse(fs.readFileSync(path.join(stateDir, 'journal.json'), 'utf8'));
  const j = JSON.parse(env.payload);
  const target = j.targetFiles.map(f => f.path);
  const set = new Set(target);
  const files = walk(installRoot, '', []);
  const byRel = new Map(files.map(f => [f.rel, f]));
  let checked = 0, mismatch = 0, missing = 0, bytes = 0, busy = 0;
  const bad = [];
  const rows = j.targetFiles;
  for (const row of rows) {
    const f = byRel.get(row.path);
    if (!f) { missing++; if (bad.length < 20) bad.push('MISSING ' + row.path); continue; }
    let d;
    try { d = await sha(f.full); } catch (e) { busy++; if (bad.length < 20) bad.push('BUSY ' + row.path); continue; }
    checked++; bytes += f.size;
    if (d !== row.sha256) { mismatch++; if (bad.length < 20) bad.push('DIFF ' + row.path); }
  }
  const allowed = ['.xjy-initial-upgrade/', '.xjy-patches/', '员工本地设置/', '.xjy-employee-updates/'];
  const extra = files.filter(f => !set.has(f.rel)).map(f => f.rel);
  const extraUnallowed = extra.filter(p => !allowed.some(a => p.startsWith(a)));
  let dataSame = 0, dataDiff = 0, dataMissing = 0;
  const dataBad = [];
  if (baselineDataRoot && fs.existsSync(q(baselineDataRoot))) {
    const baseFiles = walk(baselineDataRoot, '', []);
    for (const b of baseFiles) {
      const t = path.join(dataRoot, b.rel);
      if (!fs.existsSync(q(t))) { dataMissing++; continue; }
      const a = await sha(b.full), c = await sha(t);
      if (a === c) dataSame++; else { dataDiff++; if (dataBad.length < 20) dataBad.push(b.rel); }
    }
  }
  const result = {
    at: new Date().toISOString(),
    installRoot, stateDir,
    journal: { phase: j.phase, role: j.role, sourceVersion: j.sourceVersion, targetVersion: j.targetVersion, sourceEngineVersion: j.sourceEngineVersion, targetEngineVersion: j.targetEngineVersion, transactionId: j.transactionId, targetFiles: rows.length, catalogSha256: j.targetCatalogSha256 },
    tree: { checked, expected: rows.length, mismatch, missing, busy, bytes, extraCount: extra.length, extraUnallowed: extraUnallowed.slice(0, 40), extraUnallowedCount: extraUnallowed.length, samples: bad },
    data: { same: dataSame, diff: dataDiff, missing: dataMissing, samples: dataBad },
    startup: JSON.parse(JSON.parse(fs.readFileSync(path.join(stateDir, 'engine-startup-status.json'), 'utf8')).payload)
  };
  fs.writeFileSync(outFile, JSON.stringify(result, null, 2));
  console.log(JSON.stringify({ checked, busy, expected: rows.length, mismatch, missing, bytes, extraUnallowed: extraUnallowed.length, dataSame, dataDiff, dataMissing, phase: j.phase, businessReleased: result.startup.businessReleased }));
})().catch(e => { console.error('ERR ' + e.message + '\n' + e.stack); process.exit(1); });


