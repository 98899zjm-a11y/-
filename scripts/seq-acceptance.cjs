'use strict';
// Sequence/version acceptance tests using the client modules extracted from the installed 1.7.0 asar.
const crypto = require('node:crypto');
const fs = require('node:fs');
const path = require('node:path');
const APP = 'C:/Users/Administrator/Documents/deepseek-harness/default-workspace/_dsh/r2asar/app';
const KEY = 'D:/Codex/xjy-release-20261022/candidate/proposal/worker-draft/publisher-public.pem';
const issuerKey = 'E:/codex/2026-10-13/work/xjy-web-stage1/config/release-signing/issuer-private.pem';

const manifestMod = require(path.join(APP, 'native-update-manifest.cjs'));
const pub = fs.readFileSync(KEY);
const priv = fs.readFileSync(issuerKey);

function sign(payloadObj) {
  const manifest = JSON.stringify(payloadObj);
  const sig = crypto.sign(null, Buffer.from(manifest), crypto.createPrivateKey(priv)).toString('base64');
  return { envelope: { manifest, signature: sig } };
}
function buildPayload(sequence, targetVersion) {
  return {
    schemaVersion: 1, purpose: 'xjy-native-employee-update-v1', app: 'xjy-jewelry-offline',
    platform: 'win32', arch: 'x64', role: 'employee', targetVersion,
    engineVersion: '44.9.0', sequence,
    publishedAt: new Date(Date.now() - 60000).toISOString(),
    expiresAt: new Date(Date.now() + 30 * 86400000).toISOString(),
    fullTargetCatalogSha256: 'a'.repeat(64), bindingSha256: 'b'.repeat(64),
    archive: { size: 781517180, sha256: 'c'.repeat(64) },
    files: [{ path: 'x', size: 1, sha256: 'd'.repeat(64) }]
  };
}
const installed = { sequence: 20, fullTargetCatalogSha256: 'e'.repeat(64) };
const results = [];
function attempt(label, sequence, targetVersion, expect) {
  const env = sign(buildPayload(sequence, targetVersion)).envelope;
  let outcome;
  try {
    outcome = { ok: true, value: manifestMod.verifyNativeManifest(env, { publicKey: pub, now: Date.now(), minimumSequence: 0, installedCatalogSha256: installed.fullTargetCatalogSha256 }) };
  } catch (e) {
    outcome = { ok: false, code: e.code || null, message: String(e.message || e) };
  }
  results.push({ label, sequence, targetVersion, expect, outcome });
}
attempt('sequence20_same_as_installed', 20, '1.7.0', 'STALE expected');
attempt('sequence21_target1.7.0', 21, '1.7.0', 'accepted expected');
attempt('sequence21_target1.7.1', 21, '1.7.1', 'accepted expected');
attempt('sequence22_target1.7.2', 22, '1.7.2', 'accepted expected');

// Version-agnostic check of the patched client: extract versionAtLeast behaviour by evaluating the patched module's helper.
const patched = fs.readFileSync('C:/Users/Administrator/Documents/deepseek-harness/default-workspace/_dsh/native-publication-update.patched.cjs', 'utf8');
const m = patched.match(/function vparts\([\s\S]*?\nfunction versionAtLeast\([^}]*\}[^}]*\}/);
let versionLogic = null;
if (m) {
  const fn = new Function('return ' + m[0].replace('function vparts(', 'function vparts(') + '; return {versionAtLeast};');
  // simpler: build standalone
  const standalone = `const MIN_PROGRAM_VERSION='1.7.0';${m[0]};return versionAtLeast;`;
  const versionAtLeast = new Function(standalone)();
  versionLogic = {
    '1.6.2': versionAtLeast('1.6.2', '1.7.0'),
    '1.7.0': versionAtLeast('1.7.0', '1.7.0'),
    '1.7.1': versionAtLeast('1.7.1', '1.7.0'),
    '2.0.0': versionAtLeast('2.0.0', '1.7.0')
  };
}
const out = { results, versionLogic };
fs.writeFileSync('D:/Codex/xjy-release-20261022/evidence-c6-failed-170/seq-acceptance.json', JSON.stringify(out, null, 2));
console.log(JSON.stringify(out, null, 2));

