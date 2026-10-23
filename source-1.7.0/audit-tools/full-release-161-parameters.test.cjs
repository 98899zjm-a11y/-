'use strict';
// Guest-only source/data boundary tests. No compiler, ASAR, helper build or program execution.
const fs = require('node:fs'), path = require('node:path'), os = require('node:os'), crypto = require('node:crypto');
const ROOT = path.resolve(__dirname, '..');
if (process.platform !== 'win32' || os.userInfo().username.toLowerCase() !== 'wdagutilityaccount' || ROOT.toLowerCase() !== 'c:\\xjy-work\\xjy-web-stage1') throw Error('Builder parameter tests require the fixed actual Windows Sandbox');
const guard = require('../stage1/isolation.cjs').createIsolationGuard(ROOT);
const sha = bytes => crypto.createHash('sha256').update(bytes).digest('hex');
for (const [relative, expected] of Object.entries({
  'stage1/sandbox-context.py': '09426dfd4d699c51570e1f1b10c2e37c00f6feb699b9a472ca710ae5242bf249',
  'stage1/validate-sandbox-context.py': '867a0117d6bc200960df06a355ffafcf639f24532ece3bc4db34f6e397325207',
})) if (sha(fs.readFileSync(guard.assertPath(path.join(ROOT, relative)))) !== expected) throw Error('Unchanged actual Guest guard required');
const proof = require('node:child_process').spawnSync('C:\\Python314\\python.exe', ['-I', '-B', guard.assertPath(path.join(ROOT, 'stage1/validate-sandbox-context.py'))], { cwd: ROOT, windowsHide: true, encoding: 'utf8' });
if (proof.error || proof.status !== 0) throw Error('Actual Guest admission failed');
JSON.parse(proof.stdout);

const test = require('node:test'), assert = require('node:assert/strict'), vm = require('node:vm'), Module = require('node:module');
const ts = require(guard.assertPath(path.join(ROOT, 'audit-tools/dependencies/node_modules/typescript')));
const BUILDER = guard.assertPath(path.join(ROOT, 'stage1/build-full-release.cjs'));
const source = fs.readFileSync(BUILDER, 'utf8'), tree = ts.createSourceFile(BUILDER, source, ts.ScriptTarget.Latest, true, ts.ScriptKind.JS);
assert.equal(tree.parseDiagnostics.length, 0, 'actual builder parses');
console.log(JSON.stringify({ scope: 'actual-Guest-builder-parameter-source-and-toy-data-only', builderSha256: sha(Buffer.from(source)), compilationOrAsarAttempted: false, programExecuted: false }));
// Evaluate the same reviewed builder bytes. Its require.main branch is never entered.
// Only collectModuleResources/sourceFreeze are called; prepare/seal/build are not invoked.
const loaded = { exports: {} };
vm.runInThisContext('(function(require,module,exports,__filename,__dirname){' + source + '\n})', { filename: BUILDER })(Module.createRequire(BUILDER), loaded, loaded.exports, BUILDER, path.dirname(BUILDER));
const builder = loaded.exports;

function walk(node, predicate, found = []) { if (predicate(node)) found.push(node); ts.forEachChild(node, child => { walk(child, predicate, found); }); return found; }
function declaration(name) { const found = tree.statements.filter(node => ts.isFunctionDeclaration(node) && node.name?.text === name); assert.equal(found.length, 1, 'NEW_BUILDER_PARAMETER_CONTRACT_NOT_IMPLEMENTED: actual ' + name); return found[0]; }
function variables(fn, name) { const found = walk(fn, node => ts.isVariableDeclaration(node) && node.name.getText(tree) === name); assert.equal(found.length, 1, 'unique actual declaration ' + name); return found[0]; }
function calls(fn, name) { return walk(fn, node => ts.isCallExpression(node) && (ts.isIdentifier(node.expression) && node.expression.text === name || ts.isPropertyAccessExpression(node.expression) && node.expression.name.text === name)); }
function property(object, name) { assert.ok(ts.isObjectLiteralExpression(object), 'actual object literal required'); const found = object.properties.filter(node => node.name?.getText(tree).replace(/^['"]|['"]$/g, '') === name); assert.equal(found.length, 1, 'actual field ' + name); return ts.isShorthandPropertyAssignment(found[0]) ? found[0].name : found[0].initializer; }
function parameter(fn, name) { assert.ok(fn.parameters.some(value => ts.isObjectBindingPattern(value.name) && value.name.elements.some(item => item.name.getText(tree) === name)), 'actual option parameter ' + name); }
function expression(node, scope) { return vm.runInNewContext('(' + node.getText(tree) + ')', { ...scope }, { filename: BUILDER + ':field-contract' }); }
function versionScope(fn, value) {
  const scope = { programVersion: value };
  for (const call of calls(fn, 'releaseProgramVersion')) {
    const owner = call.parent;
    if (ts.isVariableDeclaration(owner) && ts.isIdentifier(owner.name)) scope[owner.name.text] = value;
    if (ts.isBinaryExpression(owner) && owner.operatorToken.kind === ts.SyntaxKind.EqualsToken && ts.isIdentifier(owner.left)) scope[owner.left.text] = value;
  }
  return scope;
}
function readOnlyMetadataFs() {
  const allowed = target => {
    const resolved = path.resolve(target), relation = path.relative(ROOT, resolved), parent = path.relative(resolved, ROOT);
    if (!(relation === '' || !relation.startsWith('..' + path.sep) && relation !== '..' && !path.isAbsolute(relation) || parent === '' || !parent.startsWith('..' + path.sep) && parent !== '..' && !path.isAbsolute(parent))) throw Error('TEST_METADATA_OUTSIDE_GUEST_WORKSPACE_REFUSED');
    if (/^[\\/]{2}/.test(String(target))) throw Error('TEST_UNC_METADATA_REFUSED');
  };
  const facade = {};
  for (const name of ['existsSync', 'lstatSync', 'statSync']) facade[name] = (...args) => { allowed(args[0]); return fs[name](...args); };
  facade.realpathSync = (...args) => { allowed(args[0]); return fs.realpathSync(...args); };
  facade.realpathSync.native = (...args) => { allowed(args[0]); return fs.realpathSync.native(...args); };
  return facade;
}
function actualDataFunction(name, root = ROOT) {
  declaration(name);
  const names = new Set(['checked', 'relative', 'ownedBuildDestination', 'releaseProgramVersion', 'validateReleaseEvidence', 'resolveModuleResourcesRoot']);
  const definitions = tree.statements.filter(node => ts.isFunctionDeclaration(node) && names.has(node.name?.text)).map(node => node.getText(tree)).join('\n');
  const context = { ROOT: root, PROJECT: path.join(root, 'project'), DESKTOP: path.join(root, 'project/desktop'), fs: readOnlyMetadataFs(), path, process, Buffer, guard: () => require('../stage1/isolation.cjs').createIsolationGuard(root) };
  return vm.runInNewContext('(function(){' + definitions + '\nreturn ' + name + ';})()', context, { filename: BUILDER + ':actual-data-functions' });
}
function put(file, bytes) { guard.assertPath(file); fs.mkdirSync(guard.assertPath(path.dirname(file)), { recursive: true }); fs.writeFileSync(guard.assertPath(file), bytes, { flag: 'wx' }); }
function rewrite(file, bytes) { file = guard.assertPath(file); const info = fs.lstatSync(file); assert.ok(info.isFile() && !info.isSymbolicLink() && info.nlink === 1); fs.writeFileSync(file, bytes); }
function moduleSet(directory) {
  const manifest = { version: 1, modules: [] };
  for (const [id, version] of [['ledger', '1.3.0'], ['inventory', '1.9.0']]) {
    const exe = Buffer.from('MZ synthetic manifest fixture; never executable'), dll = Buffer.from('synthetic dependency bytes');
    put(path.join(directory, 'xjy-' + id, 'xjy-' + id + '.exe'), exe); put(path.join(directory, 'xjy-' + id, '_internal/dependency.dll'), dll);
    manifest.modules.push({ id, version, file: 'xjy-' + id + '.exe', size: exe.length, sha256: sha(exe), purpose: 'desktop-release', runtimeMode: 'onedir', files: [{ path: 'xjy-' + id + '.exe', size: exe.length, sha256: sha(exe) }, { path: '_internal/dependency.dll', size: dll.length, sha256: sha(dll) }] });
  }
  put(path.join(directory, 'manifest.json'), JSON.stringify(manifest)); return manifest;
}
function fixture() {
  const owned = guard.assertPath(path.join(ROOT, 'release-work', 'builder-161-tests-' + crypto.randomUUID()));
  fs.mkdirSync(guard.assertPath(path.dirname(owned)), { recursive: true }); fs.mkdirSync(owned);
  const root = path.join(owned, 'scope'), modules = path.join(root, 'project/desktop/release-modules'), manifest = moduleSet(modules);
  const staged = path.join(root, 'release-work/owned-module-input/modules-input'); moduleSet(staged);
  return { owned, root, modules, staged, manifest, save: () => rewrite(path.join(modules, 'manifest.json'), JSON.stringify(manifest)) };
}
function fingerprints(directory) { return builder.collectModuleResources(directory).map(value => ({ relative: value.relative, size: value.size, sha256: value.sha256 })); }

test('H00 unchanged complete two-onedir collector checks actual owned toy bytes', () => {
  assert.equal(sha(Buffer.from(declaration('collectModuleResources').getText(tree))), '116a818282e1ce94737a37c85550cf0ed06f6a6bccc4983059d101ad424fe3e0', 'the original collector is frozen, not reimplemented for the new root');
  const f = fixture(), rows = builder.collectModuleResources(f.modules);
  assert.equal(rows.length, 5); assert.equal(rows.filter(row => row.relative.endsWith('/_internal/dependency.dll')).length, 2);
  assert.equal(rows[0].relative, 'resources/release-modules/manifest.json');
  for (const row of rows) assert.equal(sha(fs.readFileSync(guard.assertPath(row.file))), row.sha256);
});

test('V01 actual version validator defaults to160 and accepts only explicit160,161 or162', () => {
  const select = actualDataFunction('releaseProgramVersion');
  assert.equal(select(), '1.6.0'); assert.equal(select('1.6.0'), '1.6.0'); assert.equal(select('1.6.1'), '1.6.1'); assert.equal(select('1.6.2'), '1.6.2');
  for (const value of [null, false, 161, '', '1.5.0', '1.7.0', '1.6.3', '1.6.01', ' 1.6.1', '1.6.1 ', 'v1.6.1', '1.6.1\n', new String('1.6.1')]) assert.throws(() => select(value));
});

test('V02 real freeze and actual prepare package helper manifest expressions use one selected version', () => {
  const original = builder.sourceFreeze(), next = builder.sourceFreeze({ programVersion: '1.6.1' });
  assert.equal(original.purpose, 'xjy-full-release-1.6.0'); assert.equal(next.purpose, 'xjy-full-release-1.6.1');
  assert.deepEqual(next.files, original.files, 'version selection does not omit frozen source files');
  const prepare = declaration('prepareFullRelease'), seal = declaration('sealFullRelease'), freeze = declaration('sourceFreeze');
  for (const fn of [prepare, seal, freeze]) { parameter(fn, 'programVersion'); assert.ok(calls(fn, 'releaseProgramVersion').length, 'actual entry validates version'); }
  const firstPrepareMutation = calls(prepare, 'mkdirSync')[0] || calls(prepare, 'compileAssets')[0];
  assert.ok(calls(prepare, 'releaseProgramVersion')[0].getStart(tree) < firstPrepareMutation.getStart(tree), 'validate before creating prepare output or compiling');
  const prepObject = variables(prepare, 'preparation').initializer, manifest = variables(seal, 'manifest').initializer;
  const packageObjects = walk(seal, node => ts.isObjectLiteralExpression(node) && node.properties.some(p => p.name?.getText(tree) === 'private') && node.properties.some(p => p.name?.getText(tree) === 'main'));
  assert.equal(packageObjects.length, 1, 'actual ASAR package metadata object');
  const helper = calls(seal, 'buildUpdateHelper'); assert.equal(helper.length, 1);
  for (const value of ['1.6.0', '1.6.1']) {
    assert.equal(expression(property(prepObject, 'programVersion'), versionScope(prepare, value)), value);
    for (const node of [property(packageObjects[0], 'version'), property(helper[0].arguments[0], 'programVersion'), property(manifest, 'programVersion')]) assert.equal(expression(node, versionScope(seal, value)), value);
  }
  const publicPins = property(manifest, 'publicPins').getText(tree);
  assert.ok(calls(seal, 'releasePinsSource').some(call => call.arguments[0].getText(tree) === publicPins), 'ASAR runtime pins and returned manifest use the same actual helper result');
});

test('V03 actual seal evidence validator rejects external saved freeze or selected-version drift before writes', () => {
  const validate = actualDataFunction('validateReleaseEvidence');
  const evidence = value => ({ programVersion: value, preparation: { version: 1, programVersion: value }, freeze: { version: 1, purpose: 'xjy-full-release-' + value }, savedPreparation: { version: 1, programVersion: value } });
  for (const value of ['1.6.0', '1.6.1']) { const input = evidence(value), before = JSON.stringify(input); assert.equal(validate(input), value); assert.equal(JSON.stringify(input), before); const first = { ...input }; delete first.savedPreparation; assert.equal(validate(first), value); }
  const bad = [
    input => { input.programVersion = '1.7.0'; }, input => { input.programVersion = '1.6.0'; }, input => { delete input.programVersion; },
    input => { input.preparation.programVersion = '1.6.0'; }, input => { input.preparation.version = 2; },
    input => { input.freeze.purpose = 'xjy-full-release-1.6.0'; }, input => { input.freeze.version = 2; },
    input => { input.savedPreparation.programVersion = '1.6.0'; }, input => { input.savedPreparation.version = 2; },
  ];
  for (const mutate of bad) { const input = evidence('1.6.1'); mutate(input); assert.throws(() => validate(input)); }
  const seal = declaration('sealFullRelease'), checks = calls(seal, 'validateReleaseEvidence');
  const fromDisk = checks.find(call => ts.isObjectLiteralExpression(call.arguments[0]) && call.arguments[0].properties.some(p => p.name?.getText(tree) === 'savedPreparation' && property(call.arguments[0], 'savedPreparation').getText(tree) === 'saved'));
  assert.ok(fromDisk, 'seal must validate the actual saved preparation, not only caller metadata');
  assert.equal(property(fromDisk.arguments[0], 'preparation').getText(tree), 'preparation'); assert.equal(property(fromDisk.arguments[0], 'freeze').getText(tree), 'freeze');
  const firstWrite = [...calls(seal, 'copyRecord'), ...calls(seal, 'writeNew')].sort((a, b) => a.getStart(tree) - b.getStart(tree))[0];
  assert.ok(fromDisk.getStart(tree) < firstWrite.getStart(tree), 'mismatched saved evidence fails before any copied program bytes');
});

test('M01 actual module-root resolver only accepts old root or one owned run modules-input without mutation', () => {
  const f = fixture(), select = actualDataFunction('resolveModuleResourcesRoot', f.root), before = [fingerprints(f.modules), fingerprints(f.staged)];
  assert.equal(select(), fs.realpathSync.native(f.modules)); assert.equal(select(f.modules), fs.realpathSync.native(f.modules)); assert.equal(select(f.staged), fs.realpathSync.native(f.staged));
  const alien = path.join(f.owned, 'outside-scope'), direct = path.join(f.root, 'release-work/modules-input'), deep = path.join(f.root, 'release-work/nested/more/modules-input'), wrong = path.join(f.root, 'release-work/run/other');
  for (const target of [alien, direct, deep, wrong]) fs.mkdirSync(guard.assertPath(target), { recursive: true });
  for (const target of [null, '', path.relative(process.cwd(), f.modules), alien, direct, deep, wrong, path.dirname(f.staged)]) assert.throws(() => select(target));
  const alias = path.join(f.root, 'release-work/linked/modules-input'); fs.mkdirSync(guard.assertPath(path.dirname(alias)), { recursive: true }); fs.symlinkSync(f.modules, alias, 'junction'); assert.throws(() => select(alias));
  assert.deepEqual([fingerprints(f.modules), fingerprints(f.staged)], before, 'resolver never overwrites either prebuilt input tree');
  const seal = declaration('sealFullRelease'); parameter(seal, 'moduleResourcesRoot'); const resolved = calls(seal, 'resolveModuleResourcesRoot'); assert.equal(resolved.length, 1); assert.equal(resolved[0].arguments[0].getText(tree), 'moduleResourcesRoot');
  const collect = calls(seal, 'collectModuleResources'); assert.equal(collect.length, 1);
  const binding = resolved[0].parent, argument = collect[0].arguments[0];
  assert.ok(walk(argument, node => node === resolved[0]).length || ts.isVariableDeclaration(binding) && ts.isIdentifier(binding.name) && ts.isIdentifier(argument) && argument.text === binding.name.text, 'seal collects the validated root, never an unused option or the old hardcoded root');
});

test('M02 original onedir collector still denies changed extra data key duplicate and hardlinked members', () => {
  const mutations = [
    f => rewrite(path.join(f.modules, 'xjy-ledger/_internal/dependency.dll'), 'changed'),
    f => put(path.join(f.modules, 'xjy-ledger/extra.txt'), 'unlisted'),
    f => { f.manifest.modules[0].purpose = 'stage1-isolated'; f.save(); },
    f => { f.manifest.modules.pop(); f.save(); },
    f => { f.manifest.modules[0].files.push({ ...f.manifest.modules[0].files[1], path: '_internal/DEPENDENCY.dll' }); f.save(); },
    f => { const item = f.manifest.modules[0].files[1], bytes = Buffer.from('SQLite format 3\0SYNTHETIC'); rewrite(path.join(f.modules, 'xjy-ledger', item.path), bytes); item.size = bytes.length; item.sha256 = sha(bytes); f.save(); },
    f => { const item = f.manifest.modules[0].files[1], bytes = Buffer.from('-----BEGIN PRIVATE KEY-----\nSYNTHETIC\n-----END PRIVATE KEY-----'); rewrite(path.join(f.modules, 'xjy-ledger', item.path), bytes); item.size = bytes.length; item.sha256 = sha(bytes); f.save(); },
    f => { const bytes = Buffer.from('synthetic forbidden data extension'); put(path.join(f.modules, 'xjy-ledger/records.db'), bytes); f.manifest.modules[0].files.push({ path: 'records.db', size: bytes.length, sha256: sha(bytes) }); f.save(); },
    f => fs.linkSync(path.join(f.modules, 'xjy-ledger/_internal/dependency.dll'), guard.assertPath(path.join(f.owned, 'hardlink-alias.dll'))),
  ];
  for (const mutate of mutations) { const f = fixture(); mutate(f); assert.throws(() => builder.collectModuleResources(f.modules)); }
});
