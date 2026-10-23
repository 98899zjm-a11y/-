'use strict';
const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const os = require('node:os');
// An accidental Host invocation stops before any business module is imported.
if (process.platform !== 'win32' || os.userInfo().username.toLowerCase() !== 'wdagutilityaccount') throw Error('Finance behavior tests require the Root-verified actual Windows Sandbox');
const root = path.resolve(__dirname, '..');
const guard = require('../stage1/isolation.cjs').createIsolationGuard(root);
const digest = file => crypto.createHash('sha256').update(fs.readFileSync(guard.assertPath(file))).digest('hex');
const output = path.join(__dirname, 'finance-guards-generated');
const manifest = JSON.parse(fs.readFileSync(guard.assertPath(path.join(output, 'manifest.json')), 'utf8'));
if (manifest.version !== 1 || manifest.purpose !== 'finance-guards-synthetic-only' || !Array.isArray(manifest.sources) || manifest.sources.length < 4) throw Error('Finance test manifest missing or invalid');
for (const item of manifest.sources) {
  if (typeof item.file !== 'string' || !item.file.startsWith('project/') || item.file.split('/').some(part => !part || part === '.' || part === '..' || /[\\:\x00-\x1f]/.test(part))) throw Error('Unsafe finance test provenance');
  if (digest(path.join(root, item.file)) !== item.sha256) throw Error('Finance test source changed; rebuild before sealing');
}
function load(name) {
  if (!['domain', 'server', 'preview'].includes(name)) throw Error('Unknown finance test module');
  const item = manifest.modules?.[name];
  if (!item || item.file !== name + '.cjs') throw Error('Finance test module metadata invalid');
  const file = path.join(output, item.file);
  if (digest(file) !== item.sha256) throw Error('Finance test artifact changed');
  return require(guard.assertPath(file));
}
module.exports = { load };
