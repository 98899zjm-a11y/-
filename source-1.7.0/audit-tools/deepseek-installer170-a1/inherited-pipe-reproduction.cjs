'use strict';
// J01B：真实 Win32 继承复现。worker 派生后代时 stdio:['ignore',1,2]，后代继承 worker 的
// stdout/stderr OS 写端；worker 退出后 EOF 仍被后代持有。本 harness 模拟旧 PS 行为：
// 等 worker 退出 → 再等 stdout 'end'，若超过阈值仍未 EOF 则判定继承成立，随后结束虚构后代。
const { spawn } = require('node:child_process');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const workerSource = [
  "const { spawn } = require('node:child_process');",
  "const child = spawn(process.execPath, ['-e', 'setTimeout(function(){},60000)'], { detached: true, windowsHide: true, stdio: ['ignore', 1, 2] });",
  'child.unref();',
  "process.stderr.write('DESC_PID=' + child.pid + '\\n');",
  "process.stdout.write(JSON.stringify({ type: 'result', completed: true, version: '1.7.0', engineVersion: '44.9.0', role: 'employee' }) + '\\n');",
  ''
].join('\n');

const workerFile = path.join(os.tmpdir(), 'xjy-j01b-worker-' + Date.now() + '.cjs');
fs.writeFileSync(workerFile, workerSource, 'utf8');

const start = Date.now();
let exitedAt = null, eofAt = null, descPid = 0, stdoutText = '', stderrText = '', killed = false, done = false;
const child = spawn(process.execPath, [workerFile], { stdio: ['ignore', 'pipe', 'pipe'] });

function finish() {
  if (done) return;
  done = true;
  const delayed = eofAt !== null && exitedAt !== null && eofAt > exitedAt + 1000;
  const workerExitedBeforeEof = exitedAt !== null && (eofAt === null || eofAt >= exitedAt);
  const payload = {
    exitedAt, eofAt, descPid, killed,
    stdoutHasResult: /"type":"result"/.test(stdoutText),
    delayed, workerExitedBeforeEof,
    exitedAtMs: exitedAt
  };
  fs.writeFileSync(workerFile + '.stdout.txt', stdoutText, 'utf8');
  fs.writeFileSync(workerFile + '.stderr.txt', stderrText, 'utf8');
  console.log(JSON.stringify(payload));
  process.exit(0);
}

child.stdout.on('data', d => { stdoutText += d.toString('utf8'); });
child.stderr.on('data', d => { stderrText += d.toString('utf8'); const m = /DESC_PID=(\d+)/.exec(stderrText); if (m) descPid = Number(m[1]); });
child.on('exit', () => { exitedAt = Date.now() - start; });
child.stdout.on('end', () => { eofAt = Date.now() - start; if (descPid) { try { process.kill(descPid); killed = true; } catch (e) { } } });
child.on('error', () => { finish(); });

// 兜底：若 worker 退出后 2 秒仍未 EOF 且后代仍活，判定继承成立，结束虚构后代后收尾
setInterval(() => {
  if (exitedAt === null || eofAt !== null) return;
  if (Date.now() - start < exitedAt + 2000) return;
  if (descPid) { try { process.kill(descPid); killed = true; } catch (e) { } }
  setTimeout(finish, 2500);
}, 100);

// 最终兜底，避免测试挂死
setTimeout(() => { if (descPid) { try { process.kill(descPid); } catch (e) { } } finish(); }, 20000);