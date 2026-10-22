'use strict';
// Build a signed employee-update catalog for 1.7.0 (staging only, no production writes).
const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const zlib = require('node:zlib');

const ZIP = 'D:\\Codex\\xjy-release-20261022\\candidate\\build\\package\\鑫金源珠宝1.7.0员工升级补丁.zip';
const OUT = 'D:\\Codex\\xjy-release-20261022\\publish-170';
const KEY = 'E:\\codex\\2026-10-13\\work\\xjy-web-stage1\\config\\release-signing\\issuer-private.pem';
const PUB = 'D:\\Codex\\xjy-release-20261022\\candidate\\proposal\\worker-draft\\publisher-public.pem';

function sha(b) { return crypto.createHash('sha256').update(b).digest('hex'); }

// minimal zip reader
const buf = fs.readFileSync(ZIP);
const eocd = buf.lastIndexOf(Buffer.from([0x50, 0x4b, 0x05, 0x06]));
if (eocd < 0) throw new Error('no end-of-central-directory');
const count = buf.readUInt16LE(eocd + 10);
let off = buf.readUInt32LE(eocd + 16);
const files = [];
for (let i = 0; i < count; i++) {
  if (buf.readUInt32LE(off) !== 0x02014b50) throw new Error('bad central header at ' + off);
  const method = buf.readUInt16LE(off + 10);
  const crc = buf.readUInt32LE(off + 16);
  const csize = buf.readUInt32LE(off + 20);
  const usize = buf.readUInt32LE(off + 24);
  const nameLen = buf.readUInt16LE(off + 28);
  const extraLen = buf.readUInt16LE(off + 30);
  const commentLen = buf.readUInt16LE(off + 32);
  const localOff = buf.readUInt32LE(off + 42);
  const name = buf.slice(off + 46, off + 46 + nameLen).toString('utf8');
  off += 46 + nameLen + extraLen + commentLen;
  if (name.endsWith('/')) continue;
  const lnameLen = buf.readUInt16LE(localOff + 26);
  const lextraLen = buf.readUInt16LE(localOff + 28);
  const start = localOff + 30 + lnameLen + lextraLen;
  const raw = buf.slice(start, start + csize);
  let data;
  if (method === 0) data = raw;
  else if (method === 8) data = zlib.inflateRawSync(raw);
  else throw new Error('unsupported method ' + method);
  if (data.length !== usize) throw new Error('size mismatch for ' + name);
  if ((zlib.crc32 ? zlib.crc32(data) : crc) >>> 0 !== crc && zlib.crc32) throw new Error('crc mismatch for ' + name);
  files.push({ path: name, size: data.length, sha256: sha(data) });
}
files.sort((a, b) => (a.path < b.path ? -1 : a.path > b.path ? 1 : 0));

const catalog = {
  schemaVersion: 1,
  app: 'xjy-jewelry-offline',
  channel: 'stable',
  version: '1.7.0',
  sourceVersions: ['1.6.0', '1.6.1', '1.6.2'],
  platform: 'win32',
  arch: 'x64',
  sequence: 4,
  publishedAt: new Date().toISOString(),
  expiresAt: new Date(Date.now() + 90 * 86400000).toISOString(),
  archive: { size: buf.length, sha256: sha(buf) },
  files
};
const raw = Buffer.from(JSON.stringify(catalog), 'utf8');
const keyBytes = fs.readFileSync(KEY);
let priv;
try { priv = crypto.createPrivateKey(keyBytes); } finally { keyBytes.fill(0); }
const sig = crypto.sign(null, raw, priv);
const pub = crypto.createPublicKey(fs.readFileSync(PUB));
const verified = crypto.verify(null, raw, pub, sig);
fs.mkdirSync(OUT, { recursive: true });
fs.writeFileSync(path.join(OUT, 'catalog.json'), JSON.stringify({ catalog: raw.toString('utf8'), signature: sig.toString('base64') }));
console.log(JSON.stringify({
  entries: files.length,
  archiveSize: buf.length,
  archiveSha256: catalog.archive.sha256,
  publishedAt: catalog.publishedAt,
  expiresAt: catalog.expiresAt,
  signatureB64: sig.toString('base64').length,
  signatureFormatOk: /^[A-Za-z0-9+/]{86}==$/.test(sig.toString('base64')),
  verifiedAgainstPinnedPublicKey: verified,
  samplePaths: files.slice(0, 3).map(f => f.path)
}, null, 2));
