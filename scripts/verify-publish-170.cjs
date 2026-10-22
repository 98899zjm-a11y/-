'use strict';
const fs = require('node:fs');
const crypto = require('node:crypto');
const d = 'F:\\鑫金源珠宝资料\\程序设置\\员工升级';
const pub = crypto.createPublicKey(fs.readFileSync('D:\\Codex\\xjy-release-20261022\\candidate\\proposal\\worker-draft\\publisher-public.pem'));
const out = {};
const cat = JSON.parse(fs.readFileSync(d + '\\catalog.json', 'utf8'));
const catRaw = Buffer.from(cat.catalog, 'utf8');
out.catalog = {
  verified: crypto.verify(null, catRaw, pub, Buffer.from(cat.signature, 'base64')),
  sigLen: Buffer.from(cat.signature, 'base64').length,
  version: JSON.parse(cat.catalog).version,
  sequence: JSON.parse(cat.catalog).sequence,
  files: JSON.parse(cat.catalog).files.length,
  archive: JSON.parse(cat.catalog).archive
};
const zipSha = crypto.createHash('sha256').update(fs.readFileSync(d + '\\package.zip')).digest('hex');
out.catalogArchiveMatchesFile = zipSha === JSON.parse(cat.catalog).archive.sha256;
const nm = JSON.parse(fs.readFileSync(d + '\\native-manifest.json', 'utf8'));
out.nativeManifest = {
  verified: crypto.verify(null, Buffer.from(nm.manifest, 'utf8'), pub, Buffer.from(nm.signature, 'base64')),
  sigLen: Buffer.from(nm.signature, 'base64').length
};
const npz = crypto.createHash('sha256').update(fs.readFileSync(d + '\\native-package.zip')).digest('hex');
const m = JSON.parse(nm.manifest);
out.nativeArchiveMatchesFile = npz === m.archive.sha256;
out.manifestTopKeys = Object.keys(m);
console.log(JSON.stringify(out, null, 2));
