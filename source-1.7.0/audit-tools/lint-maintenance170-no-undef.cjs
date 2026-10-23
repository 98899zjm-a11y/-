'use strict';
// Host-safe static text only: no product module/config/plugin is imported.
const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const assert = require('node:assert/strict');
const { ESLint } = require('E:/珠宝销售软件/node_modules/eslint/lib/api.js');
const globals = require('E:/珠宝销售软件/node_modules/globals/index.js');
const ROOT = path.resolve(__dirname, '..');
assert.equal(ROOT.toLowerCase(), 'e:\\codex\\2026-10-15\\work\\xjy-v16-deep-audit');
const files = [
  'delivery-approval/approval-core-170.cjs',
  'delivery-approval/approval-io-170.cjs',
  'delivery-tools/delivery-native-170.cjs',
  'delivery-tools/universal-worker-170.cjs',
  'delivery-tools/universal-launcher-170.cjs',
  'delivery-tools/fresh-employee-install-170.cjs',
  'delivery-tools/engine-tree-candidate.cjs',
  'project/desktop/cashier-maintenance.cjs',
  'project/desktop/business-maintenance.cjs',
  'project/desktop/business-restore.cjs',
  'project/desktop/desktop-host-runtime.cjs',
  'project/desktop/legacy-modules.cjs',
];
function read(relative) {
  const file = path.resolve(ROOT, relative);
  assert(!path.relative(ROOT, file).startsWith('..'));
  for (let q = file; ; q = path.dirname(q)) {
    const s = fs.lstatSync(q);
    assert(!s.isSymbolicLink());
    if (q === file) assert(s.isFile() && s.nlink === 1 && s.size < 4 * 1024 * 1024);
    else assert(s.isDirectory());
    if (q === path.dirname(q)) break;
  }
  return fs.readFileSync(file, 'utf8');
}
const hash = s => crypto.createHash('sha256').update(s).digest('hex');
(async () => {
  const engine = new ESLint({
    cwd: ROOT, overrideConfigFile: true,
    overrideConfig: [{
      files: ['**/*.cjs'],
      languageOptions: { ecmaVersion: 'latest', sourceType: 'commonjs', globals: globals.node },
      linterOptions: { noInlineConfig: true },
      rules: { 'no-undef': ['error', { typeof: true }] },
    }],
  });
  const controls = [];
  for (const [source, expectedErrors] of [
    ['const location = {}; locations.read();', 1],
    ['parseBytes(Buffer.from("{}"));', 1],
    ['const location = {}; location.read();', 0],
  ]) {
    const [r] = await engine.lintText(source, { filePath: 'audit-tools/static-control.cjs' });
    assert.equal(r.errorCount, expectedErrors);
    controls.push({ source, expectedErrors, actualErrors: r.errorCount });
  }
  const observations = [];
  for (const file of files) {
    const source = read(file);
    const [r] = await engine.lintText(source, { filePath: file });
    assert.equal(read(file), source, 'Source changed during static check');
    observations.push({ file, sha256: hash(source), errors: r.errorCount, warnings: r.warningCount,
      messages: r.messages.map(({ ruleId, message, line, column, severity }) => ({ ruleId, message, line, column, severity })) });
  }
  const result = { at: new Date().toISOString(), kind: 'static-no-undef-only',
    eslintVersion: ESLint.version, productCodeExecuted: false, configLookup: false,
    controls, files: observations, errorCount: observations.reduce((n, x) => n + x.errors, 0),
    warningCount: observations.reduce((n, x) => n + x.warnings, 0), runtimeOrInstallVerified: false };
  const target = path.join(ROOT, 'reports', 'maintenance170-no-undef-' + result.at.replace(/[:.]/g, '-') + '.json');
  fs.writeFileSync(target, JSON.stringify(result, null, 2) + '\n', { flag: 'wx' });
  console.log(JSON.stringify({ result: target, files: files.length, errors: result.errorCount,
    warnings: result.warningCount, findings: observations.filter(x => x.messages.length) }));
  process.exitCode = result.errorCount ? 1 : 0;
})().catch(error => { console.error(error); process.exitCode = 2; });
