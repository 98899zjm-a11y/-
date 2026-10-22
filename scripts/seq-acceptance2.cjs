'use strict';
const fs = require('node:fs');
const path = require('node:path');
const APP = 'C:/Users/Administrator/Documents/deepseek-harness/default-workspace/_dsh/r2asar/app';
const mod = require(path.join(APP, 'native-update-manifest.cjs'));
const SHA_A = 'a'.repeat(64), SHA_B = 'b'.repeat(64);
const installed = { sequence: 20, fullTargetCatalogSha256: SHA_A };
const cases = [];
function run(label, manifest, expect) {
  let out;
  try { out = { decision: mod.publicationDecision(manifest, installed, 0) }; }
  catch (e) { out = { error: e.code || null, message: String(e.message || e) }; }
  cases.push({ label, expect, out });
}
run('same_seq_same_catalog', { sequence: 20, fullTargetCatalogSha256: SHA_A }, 'latest');
run('same_seq_new_catalog', { sequence: 20, fullTargetCatalogSha256: SHA_B }, 'STALE rejected');
run('seq21_new_catalog', { sequence: 21, fullTargetCatalogSha256: SHA_B }, 'available');
run('seq19_new_catalog', { sequence: 19, fullTargetCatalogSha256: SHA_B }, 'STALE rejected');

// Extract the patched client's version gate and evaluate it.
const patched = fs.readFileSync('C:/Users/Administrator/Documents/deepseek-harness/default-workspace/_dsh/native-publication-update.patched.cjs', 'utf8');
function extractFn(src, name) {
  const start = src.indexOf('function ' + name + '(');
  if (start < 0) return null;
  let depth = 0, i = src.indexOf('{', start);
  for (let j = i; j < src.length; j++) {
    if (src[j] === '{') depth++;
    else if (src[j] === '}') { depth--; if (depth === 0) return src.slice(start, j + 1); }
  }
  return null;
}
const vparts = extractFn(patched, 'vparts');
const vat = extractFn(patched, 'versionAtLeast');
let versionGate = null;
if (vparts && vat) {
  const f = new Function('return (function(){' + vparts + vat + 'return versionAtLeast;})()')();
  versionGate = { '1.6.2': f('1.6.2', '1.7.0'), '1.7.0': f('1.7.0', '1.7.0'), '1.7.1': f('1.7.1', '1.7.0'), '2.0.0': f('2.0.0', '1.7.0') };
}
const original = fs.readFileSync(path.join(APP, 'native-publication-update.cjs'), 'utf8');
const origGate = {
  hardcodedVersionChecks: (original.match(/'1\.7\.0'/g) || []).length,
  hardcodedEngine44_9: (original.match(/'44\.9\.0'/g) || []).length
};
const patchedGate = {
  hardcodedVersionChecks: (patched.match(/'1\.7\.0'/g) || []).length,
  hardcodedEngine44_9: (patched.match(/'44\.9\.0'/g) || []).length,
  hasMinProgramVersion: patched.includes("const MIN_PROGRAM_VERSION='1.7.0'"),
  hasVersionAtLeast: patched.includes('function versionAtLeast')
};
const result = { cases, versionGate, origGate, patchedGate };
fs.writeFileSync('D:/Codex/xjy-release-20261022/evidence-c6-failed-170/seq-acceptance2.json', JSON.stringify(result, null, 2));
console.log(JSON.stringify(result, null, 2));
