// tests/guard-development-a1.test.mjs
// 独立安全负例测试：全部在临时虚构目录内运行，不触真实敏感路径。
// 运行：node tests/guard-development-a1.test.mjs
import fs from 'node:fs';
import fsp from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { createGuardCore } from '../guard-development-a1.mjs';

let pass = 0;
const failed = [];
function t(id, ok, detail) {
  if (ok) { pass++; console.log('[PASS] ' + id + (detail ? ' ' + detail : '')); }
  else { failed.push(id); console.log('[FAIL] ' + id + (detail ? ' ' + detail : '')); }
}
async function expectCode(id, fn, code) {
  try { await fn(); t(id, false, '未拒绝'); }
  catch (e) { t(id, e.code === code, 'code=' + (e && e.code) + (e && e.code === code ? '' : ' 期望 ' + code)); }
}

const WORK = await fsp.mkdtemp(path.join(os.tmpdir(), 'xjy-guard-test-'));
const core = createGuardCore(WORK, { nodeExe: process.execPath, writeBytes: 4096, readBytes: 4096 });

// 虚构 fixture
await fsp.writeFile(path.join(WORK, 'hello.txt'), 'hello\nworld\n', 'utf8');
await fsp.mkdir(path.join(WORK, 'sub'), { recursive: true });
await fsp.writeFile(path.join(WORK, 'sub', 'good.cjs'), 'module.exports = 1;\n', 'utf8');
await fsp.writeFile(path.join(WORK, 'sub', 'bad.cjs'), 'module.exports = ;\n', 'utf8');
await fsp.writeFile(path.join(WORK, 'sub', 'note.ps1'), 'Write-Host ok\n', 'utf8');
await fsp.writeFile(path.join(WORK, 'weird.txt'), Buffer.from([0x41, 0x00, 0x42]));

// ===== 正例 =====
{
  const out = await core.read({ path: 'hello.txt' });
  t('P1 read 正例返回 SHA/大小/内容', /SHA256: [a-f0-9]{64}/.test(out) && out.includes('hello') && out.includes('SIZE: 12'));
}
{
  const out = await core.read({ path: 'hello.txt', startLine: 2, maxLines: 1 });
  t('P2 read 分页只返回第二行', out.includes('world') && !/\nhello/.test(out) && out.includes('TRUNCATED: false'));
}
{
  const created = JSON.parse(await core.write({ path: 'created.txt', content: 'abc\n', expectedAbsent: true }));
  t('P3 write 新建成功', created.ok === true && created.created === true && created.size === 4);
}
{
  const readOut = await core.read({ path: 'created.txt' });
  const sha = /SHA256: ([a-f0-9]{64})/.exec(readOut)[1];
  const updated = JSON.parse(await core.write({ path: 'created.txt', content: 'xyz', expectedSha256: sha }));
  const backupAbs = path.join(WORK, updated.backup);
  t('P4 write 覆盖带正确 SHA 成功且备份存在', updated.ok === true && updated.updated === true && fs.existsSync(backupAbs));
}
{
  const out = JSON.parse(await core.list({}));
  t('P5 list 根目录返回条目', out.ok === true && out.entries.some((e) => e.name === 'hello.txt'));
  t('P6 list 不列出桥私有目录', out.entries.every((e) => e.name !== '.xjy-guard'));
}
{
  const good = JSON.parse(await core.check({ path: 'sub/good.cjs' }));
  t('P7 check 合法 cjs 通过', good.ok === true && good.executed === true && good.exitCode === 0);
  const bad = JSON.parse(await core.check({ path: 'sub/bad.cjs' }));
  t('P8 check 语法错误 cjs 失败', bad.ok === false && bad.executed === true && bad.exitCode !== 0);
  const ps = JSON.parse(await core.check({ path: 'sub/note.ps1' }));
  t('P9 check 对 ps1 不执行', ps.ok === true && ps.executed === false && ps.type === '.ps1');
}

// ===== 路径负例 =====
await expectCode('N1 绝对路径拒绝', () => core.read({ path: 'C:\\Windows\\win.ini' }), 'BAD_PATH');
await expectCode('N2 盘符路径拒绝', () => core.read({ path: 'E:foo' }), 'BAD_PATH');
await expectCode('N3 .. 段拒绝', () => core.read({ path: '../escape.txt' }), 'BAD_PATH');
await expectCode('N4 UNC 拒绝', () => core.read({ path: '\\\\server\\share\\a.txt' }), 'BAD_PATH');
await expectCode('N5 ADS 拒绝', () => core.read({ path: 'hello.txt:evil' }), 'BAD_PATH');
await expectCode('N6 保留设备名拒绝', () => core.read({ path: 'CON' }), 'BAD_PATH');
await expectCode('N7 保留设备名带扩展拒绝', () => core.read({ path: 'NUL.txt' }), 'BAD_PATH');
await expectCode('N8 尾部点拒绝', () => core.read({ path: 'trail.' }), 'BAD_PATH');
await expectCode('N9 非法字符拒绝', () => core.read({ path: 'a<b.txt' }), 'BAD_PATH');

// ===== 敏感扩展/文件名负例 =====
await expectCode('N10 .key 拒绝', () => core.read({ path: 'x.key' }), 'BLOCKED_EXTENSION');
await expectCode('N11 .pem 写入拒绝', () => core.write({ path: 'x.pem', content: 'x', expectedAbsent: true }), 'BLOCKED_EXTENSION');
await expectCode('N12 .db 拒绝', () => core.read({ path: 'x.db' }), 'BLOCKED_EXTENSION');
await expectCode('N13 .exe 拒绝', () => core.read({ path: 'x.exe' }), 'BLOCKED_EXTENSION');
await expectCode('N14 .sqlite 拒绝', () => core.read({ path: 'x.sqlite' }), 'BLOCKED_EXTENSION');
await expectCode('N15 文件名 credentials 拒绝', () => core.read({ path: 'credentials' }), 'BLOCKED_NAME');
await expectCode('N16 文件名 privatekey 拒绝', () => core.read({ path: 'privatekey' }), 'BLOCKED_NAME');
await expectCode('N17 文件名模式 secret 拒绝', () => core.read({ path: 'my-secret-key.txt' }), 'BLOCKED_NAME');

// ===== 内容与大小负例 =====
await expectCode('N18 含 NUL 文本拒绝', () => core.read({ path: 'weird.txt' }), 'BINARY_REJECTED');
await expectCode('N19 超写上限拒绝', () => core.write({ path: 'big.txt', content: 'x'.repeat(5000), expectedAbsent: true }), 'TOO_LARGE');
await expectCode('N20 新建无 expectedAbsent 拒绝', () => core.write({ path: 'brand-new.txt', content: 'x' }), 'MUST_DECLARE_ABSENT');
{
  await fsp.writeFile(path.join(WORK, 'sha.txt'), 'abc', 'utf8');
  await expectCode('N21 expectedSha256 不符拒绝', () => core.write({ path: 'sha.txt', content: 'xyz', expectedSha256: 'f'.repeat(64) }), 'SHA_MISMATCH');
}
await expectCode('N22 覆盖无 expectedSha256 拒绝', () => core.write({ path: 'hello.txt', content: 'x' }), 'MUST_READ_FIRST');
await expectCode('N23 父目录缺失拒绝', () => core.write({ path: 'no-such-dir/a.txt', content: 'x', expectedAbsent: true }), 'NOT_FOUND');

// ===== 链接负例（Windows junction，权限不足则 SKIP） =====
if (process.platform === 'win32') {
  const target = path.join(WORK, 'sub');
  const link = path.join(WORK, 'junction-to-sub');
  const r = spawnSync('cmd.exe', ['/c', 'mklink', '/J', link, target], { windowsHide: true });
  if (r.status === 0) {
    await expectCode('N24 junction 目录 read 拒绝', () => core.read({ path: 'junction-to-sub/good.cjs' }), 'REPARSE_REJECTED');
    await expectCode('N25 junction 目录 list 拒绝', () => core.list({ path: 'junction-to-sub' }), 'REPARSE_REJECTED');
  } else {
    t('N24/N25 junction（SKIP：mklink 不可用）', true, 'skip');
  }
} else {
  t('N24/N25 junction（SKIP：非 Windows）', true, 'skip');
}

// ===== check 类型负例 =====
await expectCode('N26 check 对 txt 拒绝', () => core.check({ path: 'hello.txt' }), 'UNSUPPORTED_TYPE');

await fsp.rm(WORK, { recursive: true, force: true });
console.log('\n合计 ' + (pass + failed.length) + ' 项：PASS ' + pass + '，FAIL ' + failed.length + (failed.length ? ' → ' + failed.join(',') : ''));
process.exit(failed.length ? 1 : 0);