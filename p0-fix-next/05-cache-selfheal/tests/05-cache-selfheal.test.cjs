'use strict';
// P0-5 单测：缓存 nlink 放宽 + 缓存自愈 + 错误码直达界面。
//
// 现场故障（已实测）：员工机 <profile>/employee-update-cache 里的合法文件被同步盘/备份
// 工具加了硬链接（nlink=2），assertPath 的 `target.nlink!==1n` 直接判 UNSAFE_PATH，
// 界面只剩英文 Update object is not an ordinary single-link file，员工只能人工删目录。
// 本测试钉住三件事：
//   ① 放宽后 nlink=2 的普通文件能通过，且仍然要求"能独占打开"（只读/被占用照旧拒）；
//   ② 缓存里的畸形残留（root 变文件、stage 里 archive.zip 变目录）能自愈并继续升级；
//   ③ 原有正常路径逐字节等价（begin→write→seal→getInstallStage→remove 的 proof 一致）。
const crypto = require('node:crypto');
const fs = require('node:fs');
const fsp = require('node:fs/promises');
const path = require('node:path');
const { checkAsync, assert, assertEqual, assertCode, finish } = require('./lib/harness.cjs');

const OUT = path.join(__dirname, 'outputs');
fs.mkdirSync(OUT, { recursive: true });
const LIB = variant => path.join(__dirname, 'lib', 'cache05-' + variant);
const cache = variant => require(path.join(LIB(variant), 'employee-update-cache.cjs'));

const NOW = Date.parse('2026-10-22T00:00:00Z');
const SHA = value => crypto.createHash('sha256').update(value).digest('hex');
const { publicKey, privateKey } = crypto.generateKeyPairSync('ed25519');
const publicPem = publicKey.export({ type: 'spki', format: 'pem' });

const FILES = [{ path: 'resources/app.asar', size: 10, sha256: SHA('a') }];
const ARCHIVE = Buffer.alloc(64, 7);

function envelopeFor(sequence, archive) {
  const catalog = {
    schemaVersion: 1,
    app: 'xjy-jewelry-offline',
    channel: 'stable',
    version: '1.7.0',
    sourceVersions: ['1.6.2', '1.7.0'],
    platform: 'win32',
    arch: 'x64',
    sequence,
    publishedAt: '2026-10-20T16:15:04.316Z',
    expiresAt: '2027-04-18T16:15:04.316Z',
    archive: { size: archive.length, sha256: SHA(archive) },
    files: FILES,
  };
  const text = JSON.stringify(catalog);
  return { catalog: text, signature: crypto.sign(null, Buffer.from(text), privateKey).toString('base64') };
}

function tempDir(label) { return fs.mkdtempSync(path.join(OUT, 'cache05-' + label + '-')); }

function cleanup(dir) {
  const stack = [dir];
  while (stack.length) {
    const item = stack.pop();
    let stat;
    try { stat = fs.lstatSync(item); } catch { continue; }
    try { fs.chmodSync(item, 0o777); } catch {}
    if (stat.isDirectory()) { for (const name of fs.readdirSync(item)) stack.push(path.join(item, name)); }
    else { try { fs.unlinkSync(item); } catch {} }
  }
  try { fs.rmSync(dir, { recursive: true, force: true }); } catch {}
}

function open(variant, profileDir) {
  const env = envelopeFor(17, ARCHIVE);
  const api = cache(variant).createEmployeeUpdateCache({
    profileDir,
    trustedPublicKey: publicPem,
    currentVersion: '1.7.0',
    allowedFiles: FILES.map(f => f.path),
    now: () => NOW,
    resolveCatalogEnvelope: () => env,
  });
  return { api, env, catalog: JSON.parse(env.catalog) };
}

async function capture(promise) {
  try { await promise; return null; } catch (error) { return error; }
}

async function lifecycle(variant, profileDir) {
  const { api, catalog } = open(variant, profileDir);
  const id = await api.begin(catalog);
  await api.write(id, 0, ARCHIVE);
  await api.seal(id, { archiveSha256: SHA(ARCHIVE), sequence: 17, version: '1.7.0', fileCount: FILES.length });
  const stage = await api.getInstallStage(id);
  const size = await api.size(id);
  await api.setAcceptedSequence(17);
  const accepted = await api.getAcceptedSequence();
  await api.remove(id);
  await api.close();
  return { id, size, accepted, proof: stage.proof, catalog: stage.catalog };
}

(async () => {
// ---------------------------------------------------------------- ① nlink=2
await checkAsync('05.1 nlink=2 的普通文件：改前 UNSAFE_PATH，改后通过且 openChecked 可开', async () => {
  const dir = tempDir('nlink');
  const file = path.join(dir, 'native-sequence.json');
  fs.writeFileSync(file, Buffer.alloc(32, 1));
  fs.linkSync(file, path.join(dir, 'native-sequence.json.sync-helper'));
  const stat = fs.lstatSync(file, { bigint: true });
  assertEqual(String(stat.nlink), '2', '夹具必须是 nlink=2');
  assert(stat.isFile(), '夹具必须是普通文件');

  const beforeError = await capture(cache('before').assertPath(fsp, file, {}));
  assert(beforeError, '改前必须拒绝 nlink=2');
  assertCode(beforeError, 'UNSAFE_PATH');
  assertEqual(beforeError.message, 'Update object is not an ordinary single-link file', '界面文案必须保持原样（前端已本地化）');

  const resolved = await cache('after').assertPath(fsp, file, {});
  assertEqual(String(resolved.nlink), '2', '改后应放行并返回真实 stat');
  const opened = await cache('after').openChecked(fsp, file, 'r+', {});
  try {
    const openedStat = await opened.handle.stat({ bigint: true });
    assertEqual(String(openedStat.nlink), '2', 'openChecked 也必须放行 nlink=2');
  } finally { await opened.handle.close(); }
  cleanup(dir);
  return 'before: UNSAFE_PATH (message unchanged); after: assertPath + openChecked accept nlink=2';
});

// ---------------------------------------------------------------- ② stage 里 archive.zip 是目录
await checkAsync('05.2 stage 里 archive.zip 是目录：改名隔离后 begin 成功', async () => {
  const profile = tempDir('stagedir');
  const root = path.join(profile, 'employee-update-cache');
  const badId = '0f1e2d3c-4b5a-4c6d-8e7f-0a1b2c3d4e5f';
  fs.mkdirSync(path.join(root, badId, 'archive.zip'), { recursive: true });
  fs.writeFileSync(path.join(root, badId, 'archive.zip', 'payload.bin'), 'x');
  assert(fs.lstatSync(path.join(root, badId, 'archive.zip')).isDirectory(), '夹具：archive.zip 是目录');

  const { api, catalog } = open('after', profile);
  const id = await api.begin(catalog);
  await api.close();

  const entries = fs.readdirSync(root);
  assert(!entries.includes(badId), '坏 stage 必须被搬走，不能留在 root');
  assert(entries.includes('.native-integrity-key'), 'root 里应只剩 key/日志 + 新 stage');
  const repair = fs.readdirSync(profile).filter(name => name.startsWith('employee-update-cache.repair-'));
  assertEqual(repair.length, 1, '必须建一个取证目录（只隔离不删除）');
  const moved = path.join(profile, repair[0], badId);
  assert(fs.lstatSync(path.join(moved, 'archive.zip')).isDirectory(), '被隔离的 archive.zip 目录必须原样保留');
  assert(fs.existsSync(path.join(moved, 'archive.zip', 'payload.bin')), '隔离必须保留内容，便于取证');
  assert(/^[0-9a-f-]{36}$/.test(id), 'begin 应返回新 stage id');
  cleanup(profile);
  return 'quarantined ' + badId + ' -> ' + repair[0] + ', begin ok';
});

// ---------------------------------------------------------------- ③ 只读/被占用仍报 UNSAFE_PATH
await checkAsync('05.3 只读文件仍报 UNSAFE_PATH 且 detail 记录 exclusive-open（不放宽可信任集合）', async () => {
  const dir = tempDir('readonly');
  const file = path.join(dir, 'native-sequence.json');
  fs.writeFileSync(file, Buffer.alloc(32, 2));
  fs.linkSync(file, path.join(dir, 'native-sequence.json.sync-helper'));
  fs.chmodSync(file, 0o444);
  try {
    const error = await capture(cache('after').assertPath(fsp, file, {}));
    assert(error, '只读文件必须仍被拒绝');
    assertCode(error, 'UNSAFE_PATH');
    assertEqual(error.message, 'Update object is not an ordinary single-link file', '文案不变');
    assert(typeof error.detail === 'string' && error.detail.startsWith('exclusive-open'), 'detail 必须可取证: ' + error.detail);
    assert(error.detail.includes('nlink=2'), 'detail 必须带 nlink/ino: ' + error.detail);
  } finally { fs.chmodSync(file, 0o666); }
  cleanup(dir);
  return 'read-only nlink=2 file -> UNSAFE_PATH with detail "' + 'exclusive-open ...' + '"';
});

// ---------------------------------------------------------------- ④ root 变成文件 + 日志
await checkAsync('05.4 root 变成普通文件：改名 <root>.broken-<ts> 并把动作写进 self-heal.log', async () => {
  const profile = tempDir('brokenroot');
  const root = path.join(profile, 'employee-update-cache');
  fs.writeFileSync(root, 'stray file, not a directory');
  assert(fs.lstatSync(root).isFile(), '夹具：root 是文件');

  const { api } = open('after', profile);
  const accepted = await api.getAcceptedSequence();
  await api.close();
  assertEqual(accepted, 0, '自愈后应能正常初始化并读到 0');

  const broken = fs.readdirSync(profile).filter(name => name.startsWith('employee-update-cache.broken-'));
  assertEqual(broken.length, 1, '坏 root 必须被改名保留（只隔离不删除）');
  assert(fs.lstatSync(path.join(profile, broken[0])).isFile(), '被隔离的 root 原件必须还在');
  assert(fs.lstatSync(root).isDirectory(), '新 root 必须是目录');
  const log = fs.readFileSync(path.join(root, 'self-heal.log'), 'utf8');
  assert(log.includes('broken'), 'self-heal.log 必须记下 broken 动作: ' + log);
  assert(log.includes(root), 'self-heal.log 必须记下原路径: ' + log);
  assert(/\d{4}-\d\d-\d\dT/.test(log), 'self-heal.log 必须带时间戳: ' + log);
  cleanup(profile);
  return 'root -> ' + broken[0] + '; log: ' + log.trim().split('\n').length + ' line(s)';
});

// ---------------------------------------------------------------- ⑤ 回归：正常路径行为不变
await checkAsync('05.5 回归：改前/改后 begin→write→seal→install→remove 的 proof 与产出一致', async () => {
  const beforeProfile = tempDir('regress-before');
  const afterProfile = tempDir('regress-after');
  const before = await lifecycle('before', beforeProfile);
  const after = await lifecycle('after', afterProfile);

  assertEqual(after.size, before.size, 'size 必须一致');
  assertEqual(after.size, ARCHIVE.length, 'size 必须等于写入字节数');
  assertEqual(after.accepted, before.accepted, 'accepted sequence 必须一致');
  assertEqual(JSON.stringify(after.proof), JSON.stringify(before.proof), 'seal proof 必须逐字节一致');
  assertEqual(JSON.stringify(after.catalog), JSON.stringify(before.catalog), 'catalog 必须一致');

  // 路径逃逸与符号链接这两个老断言不许被放宽
  const { api, catalog } = open('after', afterProfile);
  const escape = await capture(api.begin({ ...catalog, sequence: 18 }));
  assert(escape && escape.code, '非法 catalog 必须报错');
  await api.close();

  const escapePath = await capture(cache('after').assertPath(fsp, path.join(afterProfile, '..', 'escape.zip'), { root: path.join(afterProfile, 'employee-update-cache') }));
  assert(escapePath, '路径逃逸必须仍被拒绝');
  assertCode(escapePath, 'UNSAFE_PATH');

  cleanup(beforeProfile);
  cleanup(afterProfile);
  return 'proof ' + JSON.stringify(after.proof).slice(0, 46) + '... identical, escape still UNSAFE_PATH';
});

finish('P0-5 cache self-heal');
})().catch(error => { console.error(error); process.exitCode = 1; });
