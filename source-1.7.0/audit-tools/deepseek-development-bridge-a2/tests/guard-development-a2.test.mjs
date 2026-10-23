// tests/guard-development-a2.test.mjs
// 独立安全负例测试：全部在临时虚构目录内运行，不触真实敏感路径。结果目录保留、不清除。
// PASS / FAIL / SKIP 分开计数；SKIP 不计 PASS；exitCode 仅由 FAIL 决定。
// 运行：node tests/guard-development-a2.test.mjs
import fs from 'node:fs';
import fsp from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import crypto from 'node:crypto';
import { spawnSync } from 'node:child_process';
import {
  createGuardCore,
  OFFICIAL_NODE,
  OFFICIAL_NODE_SHA256
} from '../guard-development-a1.mjs';

let pass = 0;
let fail = 0;
let skip = 0;
const failedIds = [];
const skippedIds = [];

function t(id, ok, detail) {
  if (ok) { pass++; console.log('[PASS] ' + id + (detail ? ' ' + detail : '')); }
  else { fail++; failedIds.push(id); console.log('[FAIL] ' + id + (detail ? ' ' + detail : '')); }
}
function s(id, detail) {
  skip++; skippedIds.push(id); console.log('[SKIP] ' + id + (detail ? ' ' + detail : ''));
}
async function expectCode(id, fn, code) {
  try {
    await fn();
    t(id, false, '未拒绝');
  } catch (e) {
    const actual = e && e.code;
    t(id, actual === code, 'code=' + actual + (actual === code ? '' : ' 期望 ' + code));
  }
}
function sha256File(file) {
  return crypto.createHash('sha256').update(fs.readFileSync(file)).digest('hex');
}

const realTmp = fs.realpathSync(os.tmpdir());
const WORK = await fsp.mkdtemp(path.join(realTmp, 'xjy-guard-a2-'));
console.log('[INFO] WORK=' + WORK + '（测试结束保留）');

const core = createGuardCore(WORK, { nodeExe: OFFICIAL_NODE, writeBytes: 4096, readBytes: 4096 });

await fsp.writeFile(path.join(WORK, 'hello.txt'), 'hello\nworld\n', 'utf8');
await fsp.mkdir(path.join(WORK, 'sub'), { recursive: true });
await fsp.writeFile(path.join(WORK, 'sub', 'good.cjs'), 'module.exports = 1;\n', 'utf8');
await fsp.writeFile(path.join(WORK, 'sub', 'bad.cjs'), 'module.exports = ;\n', 'utf8');
await fsp.writeFile(path.join(WORK, 'sub', 'note.ps1'), 'Write-Host ok\n', 'utf8');
await fsp.writeFile(path.join(WORK, 'weird.txt'), Buffer.from([0x41, 0x00, 0x42]));

// ===== 正例 =====

{
  const out = await core.read({ path: 'hello.txt' });
  t('P1 read 正例返回 SHA/大小/内容',
    /SHA256: [a-f0-9]{64}/.test(out) && out.includes('SIZE: 12') && out.includes('hello'));
}

{
  // hello/world/空尾行 => 3 行；只取 1-2 行，TRUNCATED 必须 true
  const out = await core.read({ path: 'hello.txt', startLine: 1, maxLines: 2 });
  t('P2 分页 hello/world/空尾行 第1-2行 TRUNCATED=true',
    out.includes('hello') && out.includes('world') && out.includes('LINES: 3') && out.includes('TRUNCATED: true'),
    out.split('\n').find((l) => l.startsWith('LINES:')) || '');
}

{
  const created = JSON.parse(await core.write({ path: 'created.txt', content: 'abc\n', expectedAbsent: true }));
  t('P3 write 新建成功（排他创建）',
    created.ok === true && created.created === true && created.size === 4);
}

{
  await fsp.writeFile(path.join(WORK, 'overwrite.txt'), 'old-content', 'utf8');
  const readOut = await core.read({ path: 'overwrite.txt' });
  const oldSha = /SHA256: ([a-f0-9]{64})/.exec(readOut)[1];
  const updated = JSON.parse(await core.write({ path: 'overwrite.txt', content: 'new-content', expectedSha256: oldSha }));
  const backupAbs = path.join(WORK, updated.backup);
  t('P4 write 覆盖需本桥 read 的 SHA 成功且备份保留',
    updated.ok === true && updated.updated === true && fs.existsSync(backupAbs) &&
    fs.readFileSync(backupAbs, 'utf8') === 'old-content',
    'backup=' + updated.backup);
}

{
  const out = JSON.parse(await core.list({}));
  t('P5 list 根目录返回条目', out.ok === true && out.entries.some((e) => e.name === 'hello.txt'));
  t('P6 list 不列出桥私有目录', out.entries.every((e) => e.name !== '.xjy-guard'));
}

const officialNodeOk = (() => {
  try {
    const stat = fs.statSync(OFFICIAL_NODE);
    if (!stat.isFile()) return false;
    return sha256File(OFFICIAL_NODE) === OFFICIAL_NODE_SHA256;
  } catch {
    return false;
  }
})();

if (officialNodeOk) {
  const good = JSON.parse(await core.check({ path: 'sub/good.cjs' }));
  t('P7 check 合法 cjs 通过', good.ok === true && good.executed === true && good.exitCode === 0);
  const bad = JSON.parse(await core.check({ path: 'sub/bad.cjs' }));
  t('P8 check 语法错误 cjs 失败', bad.ok === false && bad.executed === true && bad.exitCode !== 0);
} else {
  s('P7 check 合法 cjs', '官方 Node 不存在或 SHA 不符');
  s('P8 check 语法错误 cjs', '官方 Node 不存在或 SHA 不符');
}

{
  const ps = JSON.parse(await core.check({ path: 'sub/note.ps1' }));
  t('P9 check 对 ps1 不执行', ps.ok === true && ps.executed === false && ps.type === '.ps1');
}

{
  await fsp.writeFile(path.join(WORK, 'concurrent.txt'), 'start', 'utf8');
  const readOut = await core.read({ path: 'concurrent.txt' });
  const oldSha = /SHA256: ([a-f0-9]{64})/.exec(readOut)[1];
  const results = await Promise.allSettled([
    core.write({ path: 'concurrent.txt', content: 'one', expectedSha256: oldSha }),
    core.write({ path: 'concurrent.txt', content: 'two', expectedSha256: oldSha })
  ]);
  const fulfilled = results.filter((r) => r.status === 'fulfilled');
  const rejected = results.filter((r) => r.status === 'rejected');
  const finalSha = sha256File(path.join(WORK, 'concurrent.txt'));
  let winnerSha = null;
  if (fulfilled.length === 1) {
    try { winnerSha = JSON.parse(fulfilled[0].value).sha256; } catch { winnerSha = null; }
  }
  t('P10 并发写串行化：一个成功、另一个 SHA_MISMATCH',
    fulfilled.length === 1 && rejected.length === 1 &&
    rejected[0].reason && rejected[0].reason.code === 'SHA_MISMATCH' &&
    winnerSha !== null && finalSha === winnerSha);
}

// ===== 路径负例 =====

await expectCode('N1 绝对路径拒绝', () => core.read({ path: 'C:\\Windows\\win.ini' }), 'BAD_PATH');
await expectCode('N2 盘符相对路径拒绝', () => core.read({ path: 'E:foo' }), 'BAD_PATH');
await expectCode('N3 .. 段拒绝', () => core.read({ path: '../escape.txt' }), 'BAD_PATH');
await expectCode('N4 UNC 拒绝', () => core.read({ path: '\\\\server\\share\\a.txt' }), 'BAD_PATH');
await expectCode('N5 ADS 拒绝', () => core.read({ path: 'hello.txt:evil' }), 'BAD_PATH');
await expectCode('N6 保留设备名 CON 拒绝', () => core.read({ path: 'CON' }), 'BAD_PATH');
await expectCode('N7 保留设备名 NUL.txt 拒绝', () => core.read({ path: 'NUL.txt' }), 'BAD_PATH');
await expectCode('N8 尾部点拒绝', () => core.read({ path: 'trail.' }), 'BAD_PATH');
await expectCode('N9 非法字符拒绝', () => core.read({ path: 'a<b.txt' }), 'BAD_PATH');

// ===== 桥私有目录负例 =====

await expectCode('N29 read 桥私有目录拒绝', () => core.read({ path: '.xjy-guard/logs/guard.log' }), 'PRIVATE_PATH');
await expectCode('N30 write 桥私有目录拒绝', () => core.write({ path: '.xjy-guard/backups/x.txt', content: 'x', expectedAbsent: true }), 'PRIVATE_PATH');
await expectCode('N31 list 桥私有目录拒绝', () => core.list({ path: '.xjy-guard' }), 'PRIVATE_PATH');

// ===== 敏感扩展/文件名负例 =====

await expectCode('N10 .key 拒绝', () => core.read({ path: 'x.key' }), 'BLOCKED_EXTENSION');
await expectCode('N11 .pem 写入拒绝', () => core.write({ path: 'x.pem', content: 'x', expectedAbsent: true }), 'BLOCKED_EXTENSION');
await expectCode('N12 .db 拒绝', () => core.read({ path: 'x.db' }), 'BLOCKED_EXTENSION');
await expectCode('N13 .exe 拒绝', () => core.read({ path: 'x.exe' }), 'BLOCKED_EXTENSION');
await expectCode('N14 .sqlite 拒绝', () => core.read({ path: 'x.sqlite' }), 'BLOCKED_EXTENSION');
await expectCode('N15 文件名 credentials 拒绝', () => core.read({ path: 'credentials' }), 'BLOCKED_NAME');
await expectCode('N16 文件名 privatekey 拒绝', () => core.read({ path: 'privatekey' }), 'BLOCKED_NAME');
await expectCode('N17 文件名模式 my-secret-key.txt 拒绝', () => core.read({ path: 'my-secret-key.txt' }), 'BLOCKED_NAME');

// ===== 内容与大小负例 =====

await expectCode('N18 含 NUL 文本拒绝', () => core.read({ path: 'weird.txt' }), 'BINARY_REJECTED');
await expectCode('N19 超过写上限拒绝', () => core.write({ path: 'big.txt', content: 'x'.repeat(5000), expectedAbsent: true }), 'TOO_LARGE');
await expectCode('N20 新建无 expectedAbsent 拒绝', () => core.write({ path: 'brand-new.txt', content: 'x' }), 'MUST_DECLARE_ABSENT');

{
  await fsp.writeFile(path.join(WORK, 'sha.txt'), 'abc', 'utf8');
  await expectCode('N21 expectedSha256 未读过拒绝', () => core.write({ path: 'sha.txt', content: 'xyz', expectedSha256: 'f'.repeat(64) }), 'MUST_READ_FIRST');
}

{
  await fsp.writeFile(path.join(WORK, 'changed.txt'), 'v1', 'utf8');
  const readOut = await core.read({ path: 'changed.txt' });
  const oldSha = /SHA256: ([a-f0-9]{64})/.exec(readOut)[1];
  await fsp.writeFile(path.join(WORK, 'changed.txt'), 'v2-external', 'utf8');
  await expectCode('N21b 已读过但文件被外部修改拒绝', () => core.write({ path: 'changed.txt', content: 'mine', expectedSha256: oldSha }), 'SHA_MISMATCH');
}

await expectCode('N22 覆盖无 expectedSha256 拒绝', () => core.write({ path: 'hello.txt', content: 'x' }), 'MUST_READ_FIRST');
await expectCode('N23 父目录缺失拒绝', () => core.write({ path: 'no-such-dir/a.txt', content: 'x', expectedAbsent: true }), 'NOT_FOUND');
await expectCode('N26 check 对 txt 拒绝', () => core.check({ path: 'hello.txt' }), 'UNSUPPORTED_TYPE');

{
  let processExeSha = null;
  try { processExeSha = sha256File(process.execPath); } catch { processExeSha = null; }
  if (processExeSha === OFFICIAL_NODE_SHA256) {
    s('N27 非官方 Node 拒绝', '当前运行时正是官方 Node，无法构造不匹配场景');
  } else {
    const otherCore = createGuardCore(WORK, { nodeExe: process.execPath });
    await expectCode('N27 非官方 Node 拒绝', () => otherCore.check({ path: 'sub/good.cjs' }), 'NODE_SHA_MISMATCH');
  }
}

// ===== junction 负例（mklink 不可用则 SKIP） =====

function tryJunction(link, target) {
  const r = spawnSync('cmd.exe', ['/c', 'mklink', '/J', link, target], { windowsHide: true });
  return r.status === 0 && fs.existsSync(link);
}

let junctionSupported = false;
if (process.platform === 'win32') {
  const link = path.join(WORK, 'junction-to-sub');
  junctionSupported = tryJunction(link, path.join(WORK, 'sub'));
}

if (junctionSupported) {
  await expectCode('N24 中间 junction 目录 read 拒绝', () => core.read({ path: 'junction-to-sub/good.cjs' }), 'REPARSE_REJECTED');
  await expectCode('N25 中间 junction 目录 list 拒绝', () => core.list({ path: 'junction-to-sub' }), 'REPARSE_REJECTED');
} else {
  s('N24 中间 junction 目录 read', 'mklink /J 不可用');
  s('N25 中间 junction 目录 list', 'mklink /J 不可用');
}

let rootJunctionSupported = false;
if (process.platform === 'win32') {
  const rootLink = path.join(WORK, 'junction-root');
  rootJunctionSupported = tryJunction(rootLink, WORK);
}

if (rootJunctionSupported) {
  await expectCode('N28 根为 junction 拒绝', () => createGuardCore(path.join(WORK, 'junction-root')), 'ROOT_REPARSE');
} else {
  s('N28 根为 junction 拒绝', 'mklink /J 不可用');
}

console.log('\n合计 ' + (pass + fail + skip) + ' 项：PASS ' + pass + '，FAIL ' + fail + '，SKIP ' + skip);
if (fail) console.log('失败项：' + failedIds.join(', '));
if (skip) console.log('跳过项：' + skippedIds.join(', '));
console.log('[KEEP] 测试结果目录保留：' + WORK);
process.exit(fail ? 1 : 0);