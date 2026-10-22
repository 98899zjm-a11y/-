'use strict';
const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const assert = require('node:assert/strict');
const R = 'D:/Codex/xjy-release-20261022';
const hash = p => crypto.createHash('sha256').update(fs.readFileSync(p)).digest('hex');
const env = JSON.parse(fs.readFileSync(R + '/source/c28-native-publication/native-manifest.json'));
const pub = crypto.createPublicKey(fs.readFileSync(R + '/candidate/proposal/worker-draft/publisher-public.pem'));
assert(crypto.verify(null, Buffer.from(env.manifest), pub, Buffer.from(env.signature, 'base64')), 'outer signature invalid');
const m = JSON.parse(env.manifest);
const zipSha = hash(R + '/candidate/build/native-package.zip');
assert.equal(zipSha, m.archive.sha256, 'zip sha mismatch');
const out = {
  status: 'SIGNED_INTERNAL_VERIFIED',
  archive: m.archive,
  files: m.files.length,
  payloadSha256: hash(R + '/source/c28-native-publication/native-manifest-payload.json'),
  envelopeSha256: hash(R + '/source/c28-native-publication/native-manifest.json'),
  signerSha256: hash(R + '/source/sign-native170-ROOT-20261022-outer-a1.cjs'),
  engine: { size: 199988, sha256: '0c32a038e2fae16a0ee2e27f55a3c646868ca023857e8c9df79c04dd16e7fb75' },
  productionInstalled: false,
  nativeAcceptancePassed: false,
  note: 'a15 candidate rebuilt after C6 TREE_CHANGED failure; sandbox acceptance pending'
};
fs.writeFileSync(R + '/outer-finalize-status.json', JSON.stringify(out, null, 2) + '\n', { flag: 'wx' });
console.log(JSON.stringify({ ok: true, zipSha256: zipSha, archive: m.archive, files: m.files.length, envelopeSha256: out.envelopeSha256 }, null, 2));
