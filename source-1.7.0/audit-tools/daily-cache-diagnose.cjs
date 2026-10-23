'use strict';
// Read/write only a fresh synthetic file in the already admitted offline Guest.
const fs = require('node:fs'), path = require('node:path'), crypto = require('node:crypto'), assert = require('node:assert/strict');
const root = path.resolve(__dirname, '..');
assert.equal(process.platform, 'win32'); assert.equal(root.toLowerCase(), 'c:\\xjy-work\\xjy-web-stage1');
const directory = path.join(root, 'runtime', 'daily-cache-diagnostic-' + crypto.randomUUID());
fs.mkdirSync(directory, { recursive: true }); const file = path.join(directory, 'synthetic.xjybak');
const bytes = Buffer.alloc(4096, 65); fs.writeFileSync(file, bytes);
const fields = value => Object.fromEntries(['dev', 'ino', 'size', 'mtimeMs', 'ctimeMs', 'mtimeNs', 'ctimeNs', 'birthtimeNs'].map(key => [key, String(value[key])]));
function sample(label) {
  const stat = fields(fs.statSync(file, { bigint: true }));
  const fd = fs.openSync(file, 'r'); let handle;
  try { handle = fields(fs.fstatSync(fd, { bigint: true })); } finally { fs.closeSync(fd); }
  return { label, wallTime: Date.now(), stat, handle, sha256: crypto.createHash('sha256').update(fs.readFileSync(file)).digest('hex') };
}
(async () => {
  const samples = [sample('created')];
  for (const delay of [0, 2, 20]) {
    if (delay) await new Promise(resolve => setTimeout(resolve, delay));
    bytes[bytes.length - 1] ^= 1; fs.writeFileSync(file, bytes); samples.push(sample('same-size write after ' + delay + 'ms'));
  }
  console.log(JSON.stringify({ node: process.version, platform: process.platform, samples }, null, 2));
})().catch(error => { console.error(error); process.exitCode = 1; });
