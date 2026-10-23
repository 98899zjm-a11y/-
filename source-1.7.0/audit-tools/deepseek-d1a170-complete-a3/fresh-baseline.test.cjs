// tests/a4-fresh-baseline.test.cjs
// 虚构 fresh engine-state 四文件，验证基线模块正例与全部负例失败关闭。
// 不读真实员工机器、不接触正式数据。运行：node tests/a4-fresh-baseline.test.cjs [a4树根]
'use strict';
const crypto = require('node:crypto');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

function findRoot(start) {
  let dir = path.resolve(start);
  for (let i = 0; i < 10; i++) {
    if (fs.existsSync(path.join(dir, 'worker-draft/delivery-tools/initial-patch-baseline-170.cjs'))) return dir;
    const up = path.dirname(dir);
    if (up === dir) break;
    dir = up;
  }
  return null;
}
const ROOT = findRoot(process.argv[2] || __dirname) || findRoot(path.join(__dirname, '..'));
if (!ROOT) { console.error('[BLOCKED] 未找到 a4 树根'); process.exit(2); }

const baseline = require(path.join(ROOT, 'worker-draft/delivery-tools/initial-patch-baseline-170.cjs'));
const startup = require(path.join(ROOT, 'worker-draft/project/desktop/engine-startup-gate.cjs'));
const u = require(path.join(ROOT, 'worker-draft/project/desktop/employee-update-cache.cjs'));

let pass = 0;
const failed = [];
function t(id, ok, detail) {
  if (ok) { pass++; console.log('[PASS] ' + id + (detail ? ' ' + detail : '')); }
  else { failed.push(id); console.log('[FAIL] ' + id + (detail ? ' ' + detail : '')); }
}
async function expectRecovery(id, fn) {
  try { await fn(); t(id, false, '未拒绝'); }
  catch (e) { t(id, e.code === 'RECOVERY_REQUIRED', 'code=' + e.code + ' ' + (e.message || '').slice(0, 80)); }
}

const sha = b => crypto.createHash('sha256').update(b).digest('hex');
const physicalIdentity = s => s.dev.toString(16).padStart(8, '0') + ':' + s.ino.toString(16).padStart(16, '0');
const stateIdentity = s => [s.dev, s.ino, s.birthtimeNs ?? s.birthtimeMs].map(String).join(':');
const namespace = () => (os.hostname() + '\\' + os.userInfo().username).toLowerCase();

const { publicKey, privateKey } = crypto.generateKeyPairSync('ed25519');
const PEM = publicKey.export({ type: 'spki', format: 'pem' });
const PUB_SHA = sha(publicKey.export({ type: 'spki', format: 'der' }));
const sign = s => crypto.sign(null, Buffer.from(s, 'utf8'), privateKey).toString('base64');

const WORK = fs.mkdtempSync(path.join(os.tmpdir(), 'xjy-fresh-baseline-'));
const INSTALL = path.join(WORK, 'install');
const STATE = startup.stateDirectory(INSTALL);
fs.mkdirSync(INSTALL, { recursive: true });
fs.mkdirSync(STATE, { recursive: true });
const INSTALL_STAT = fs.lstatSync(INSTALL, { bigint: true });
const STATE_STAT = fs.lstatSync(STATE, { bigint: true });

function buildValidFiles(over) {
  const o = over || {};
  const key = o.key || crypto.randomBytes(32);
  const catalog = {
    schemaVersion: 1, app: 'xjy-jewelry-offline', channel: 'stable', version: '1.7.0',
    sourceVersions: ['1.6.0', '1.6.1', '1.6.2', '1.7.0'], platform: 'win32', arch: 'x64', sequence: 14,
    publishedAt: new Date(Date.now() - 3600000).toISOString(),
    expiresAt: new Date(Date.now() + 86400000).toISOString(),
    archive: { size: 4096, sha256: 'a'.repeat(64) },
    files: [{ path: 'resources/app.asar', size: 12582052, sha256: '20b597c6405ecb92592eb11a7db5ad8a3fe3a0a9d7ac83e430f25afd9040e375' }]
  };
  const catalogRaw = JSON.stringify(catalog);
  const catalogWrapper = Buffer.from(JSON.stringify({ catalog: catalogRaw, signature: sign(catalogRaw) }));
  const journal = {
    version: 1, purpose: baseline.JOURNAL_PURPOSE, transactionId: crypto.randomUUID(),
    phase: 'committed', rollbackForbidden: true,
    targetVersion: '1.7.0', targetEngineVersion: '44.9.0', role: 'employee',
    installationDir: INSTALL,
    installationIdentity: physicalIdentity(INSTALL_STAT),
    stateIdentity: stateIdentity(STATE_STAT),
    catalogSha256: sha(Buffer.from(catalogRaw)),
    publisherPublicKeySha256: PUB_SHA,
    osUserNamespace: namespace()
  };
  Object.assign(journal, o.journal || {});
  const journalPayload = JSON.stringify(journal);
  const journalBytes = Buffer.from(JSON.stringify({ payload: journalPayload, mac: crypto.createHmac('sha256', key).update(journalPayload).digest('hex') }));
  const status = {
    version: 2, purpose: baseline.STARTUP_PURPOSE, transactionId: journal.transactionId,
    phase: 'committed', rollbackForbidden: true,
    installationDir: INSTALL,
    installationIdentity: journal.installationIdentity,
    stateDir: STATE,
    stateIdentity: journal.stateIdentity,
    role: 'employee', programVersion: '1.7.0', engineVersion: '44.9.0',
    catalogSha256: journal.catalogSha256, publisherPublicKeySha256: PUB_SHA,
    osUserNamespace: namespace(), mode: 'fresh',
    journalSha256: sha(journalBytes), businessReleased: true
  };
  Object.assign(status, o.status || {});
  const statusPayload = JSON.stringify(status);
  const statusBytes = Buffer.from(JSON.stringify({ payload: statusPayload, mac: crypto.createHmac('sha256', key).update(baseline.DOMAIN).update(statusPayload).digest('hex') }));
  const marker = Buffer.from(JSON.stringify({
    version: 1, product: 'xjy-jewelry-offline', programVersion: o.programVersion || '1.7.0',
    role: o.role || 'employee', installationDir: INSTALL
  }) + '\n');
  return { key, catalogWrapper, journalBytes, statusBytes, marker };
}

function writeFiles(files) {
  for (const p of [INSTALL, STATE]) for (const n of fs.readdirSync(p)) fs.rmSync(path.join(p, n), { recursive: true, force: true });
  fs.writeFileSync(path.join(STATE, 'journal-key.bin'), files.key);
  fs.writeFileSync(path.join(STATE, 'journal.json'), files.journalBytes);
  fs.writeFileSync(path.join(STATE, 'engine-startup-status.json'), files.statusBytes);
  fs.writeFileSync(path.join(STATE, 'target-catalog-envelope.json'), files.catalogWrapper);
  fs.writeFileSync(path.join(INSTALL, 'xjy-install-activation.json'), files.marker);
}

(async () => {
  const valid = buildValidFiles();
  writeFiles(valid);
  const ok = await baseline.inspectFreshEngineState({
    installationDir: INSTALL, role: 'employee', programVersion: '1.7.0', engineVersion: '44.9.0',
    publisherPublicKeySha256: PUB_SHA, publisherPublicKey: publicKey
  });
  t('P1 fresh 合法四文件基线通过', ok.kind === baseline.KIND && ok.transactionId && ok.journalSha256,
    'kind=' + ok.kind + ' tx=' + String(ok.transactionId).slice(0, 8));

  const withBaseline = await baseline.ensureBaseline({
    installationDir: INSTALL, role: 'employee', programVersion: '1.7.0', engineVersion: '44.9.0',
    publisherPublicKeySha256: PUB_SHA, publisherPublicKey: publicKey
  });
  t('P2 ensureBaseline 生成一次性基线记录', withBaseline.kind === baseline.KIND && fs.existsSync(withBaseline.baselineFile),
    withBaseline.baselineFile);
  const again = await baseline.ensureBaseline({
    installationDir: INSTALL, role: 'employee', programVersion: '1.7.0', engineVersion: '44.9.0',
    publisherPublicKeySha256: PUB_SHA, publisherPublicKey: publicKey
  });
  t('P3 重复 ensureBaseline 严格幂等', again.kind === baseline.KIND && again.baselineSha256 === withBaseline.baselineSha256,
    again.baselineSha256.slice(0, 12));

  await expectRecovery('N1 缺 journal-key.bin', async () => {
    writeFiles(valid);
    fs.rmSync(path.join(STATE, 'journal-key.bin'));
    await baseline.inspectFreshEngineState({ installationDir: INSTALL, role: 'employee', publisherPublicKeySha256: PUB_SHA, publisherPublicKey: publicKey });
  });
  await expectRecovery('N2 key 长度不符', async () => {
    writeFiles(buildValidFiles({ key: crypto.randomBytes(31) }));
    await baseline.inspectFreshEngineState({ installationDir: INSTALL, role: 'employee', publisherPublicKeySha256: PUB_SHA, publisherPublicKey: publicKey });
  });
  await expectRecovery('N3 journal mac 篡改', async () => {
    const bad = buildValidFiles();
    const wrapper = JSON.parse(bad.journalBytes.toString('utf8'));
    wrapper.mac = wrapper.mac.replace(/^[0-9a-f]/, c => c === '0' ? '1' : '0');
    bad.journalBytes = Buffer.from(JSON.stringify(wrapper));
    writeFiles(bad);
    await baseline.inspectFreshEngineState({ installationDir: INSTALL, role: 'employee', publisherPublicKeySha256: PUB_SHA, publisherPublicKey: publicKey });
  });
  await expectRecovery('N4 journal 用途不符', async () => {
    writeFiles(buildValidFiles({ journal: { purpose: 'xjy-other-purpose' } }));
    await baseline.inspectFreshEngineState({ installationDir: INSTALL, role: 'employee', publisherPublicKeySha256: PUB_SHA, publisherPublicKey: publicKey });
  });
  await expectRecovery('N5 journal 未提交', async () => {
    writeFiles(buildValidFiles({ journal: { phase: 'prepared' } }));
    await baseline.inspectFreshEngineState({ installationDir: INSTALL, role: 'employee', publisherPublicKeySha256: PUB_SHA, publisherPublicKey: publicKey });
  });
  await expectRecovery('N6 journal 安装目录物理身份不符', async () => {
    writeFiles(buildValidFiles({ journal: { installationIdentity: '00000000:0000000000000001' } }));
    await baseline.inspectFreshEngineState({ installationDir: INSTALL, role: 'employee', publisherPublicKeySha256: PUB_SHA, publisherPublicKey: publicKey });
  });
  await expectRecovery('N7 journal 角色不符', async () => {
    writeFiles(buildValidFiles({ journal: { role: 'host' } }));
    await baseline.inspectFreshEngineState({ installationDir: INSTALL, role: 'employee', publisherPublicKeySha256: PUB_SHA, publisherPublicKey: publicKey });
  });
  await expectRecovery('N8 目标目录签名不符', async () => {
    const bad = buildValidFiles();
    const wrapper = JSON.parse(bad.catalogWrapper.toString('utf8'));
    wrapper.signature = Buffer.from(sign('x')).toString('base64');
    bad.catalogWrapper = Buffer.from(JSON.stringify(wrapper));
    writeFiles(bad);
    await baseline.inspectFreshEngineState({ installationDir: INSTALL, role: 'employee', publisherPublicKeySha256: PUB_SHA, publisherPublicKey: publicKey });
  });
  await expectRecovery('N9 目标目录摘要不符', async () => {
    const bad = buildValidFiles();
    const wrapper = JSON.parse(bad.catalogWrapper.toString('utf8'));
    wrapper.catalog = wrapper.catalog.replace('1.7.0', '1.7.1');
    bad.catalogWrapper = Buffer.from(JSON.stringify(wrapper));
    writeFiles(bad);
    await baseline.inspectFreshEngineState({ installationDir: INSTALL, role: 'employee', publisherPublicKeySha256: PUB_SHA, publisherPublicKey: publicKey });
  });
  await expectRecovery('N10 启动收据 mac 篡改', async () => {
    const bad = buildValidFiles();
    const wrapper = JSON.parse(bad.statusBytes.toString('utf8'));
    wrapper.mac = wrapper.mac.replace(/^[0-9a-f]/, c => c === '0' ? '1' : '0');
    bad.statusBytes = Buffer.from(JSON.stringify(wrapper));
    writeFiles(bad);
    await baseline.inspectFreshEngineState({ installationDir: INSTALL, role: 'employee', publisherPublicKeySha256: PUB_SHA, publisherPublicKey: publicKey });
  });
  await expectRecovery('N11 启动收据未放行业务', async () => {
    writeFiles(buildValidFiles({ status: { businessReleased: false } }));
    await baseline.inspectFreshEngineState({ installationDir: INSTALL, role: 'employee', publisherPublicKeySha256: PUB_SHA, publisherPublicKey: publicKey });
  });
  await expectRecovery('N12 启动收据 journalSha256 不符', async () => {
    writeFiles(buildValidFiles({ status: { journalSha256: 'f'.repeat(64) } }));
    await baseline.inspectFreshEngineState({ installationDir: INSTALL, role: 'employee', publisherPublicKeySha256: PUB_SHA, publisherPublicKey: publicKey });
  });
  await expectRecovery('N13 状态目录含未知额外文件', async () => {
    writeFiles(valid);
    fs.writeFileSync(path.join(STATE, 'extra.json'), '{}');
    await baseline.inspectFreshEngineState({ installationDir: INSTALL, role: 'employee', publisherPublicKeySha256: PUB_SHA, publisherPublicKey: publicKey });
  });
  await expectRecovery('N14 activation 角色不符', async () => {
    writeFiles(buildValidFiles({ role: 'host' }));
    await baseline.inspectFreshEngineState({ installationDir: INSTALL, role: 'employee', publisherPublicKeySha256: PUB_SHA, publisherPublicKey: publicKey });
  });
  await expectRecovery('N15 发行公钥摘要不符', async () => {
    writeFiles(valid);
    await baseline.inspectFreshEngineState({ installationDir: INSTALL, role: 'employee', publisherPublicKeySha256: 'f'.repeat(64), publisherPublicKey: publicKey });
  });
  await expectRecovery('N16 缺 activation', async () => {
    writeFiles(valid);
    fs.rmSync(path.join(INSTALL, 'xjy-install-activation.json'));
    await baseline.inspectFreshEngineState({ installationDir: INSTALL, role: 'employee', publisherPublicKeySha256: PUB_SHA, publisherPublicKey: publicKey });
  });
  await expectRecovery('N17 已有 legacy journal 时 ensureBaseline 不冒充', async () => {
    writeFiles(valid);
    fs.mkdirSync(path.join(INSTALL, '.xjy-initial-upgrade'), { recursive: true });
    fs.writeFileSync(path.join(INSTALL, '.xjy-initial-upgrade', 'journal.json'), '{}');
    const r = await baseline.ensureBaseline({ installationDir: INSTALL, role: 'employee', publisherPublicKeySha256: PUB_SHA, publisherPublicKey: publicKey });
    if (r.kind !== 'legacy-canonical') throw Object.assign(new Error('未识别 legacy canonical'), { code: 'RECOVERY_REQUIRED' });
  });

  fs.rmSync(WORK, { recursive: true, force: true });
  console.log('\n合计 ' + (pass + failed.length) + ' 项：PASS ' + pass + '，FAIL ' + failed.length + (failed.length ? ' → ' + failed.join(',') : ''));
  process.exit(failed.length ? 1 : 0);
})().catch(e => { console.error('[FAIL] 未预期异常：' + (e && e.stack || e)); process.exit(1); });