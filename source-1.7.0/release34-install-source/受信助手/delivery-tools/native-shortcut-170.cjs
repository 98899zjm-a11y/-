// delivery-tools/employee-shortcut-170.cjs
// 仅创建/复用员工端桌面快捷方式。不删其他桌面文件、不改注册表/ACL、不按盘符推断角色。
// 桌面目录默认用 Windows KnownFolder；测试可显式传 desktopDirectory。
// 同名不同目标/参数/工作目录一律拒绝覆盖。目标 EXE 必须存在。
'use strict';
const fsp = process.versions.electron ? require('original-fs').promises : require('node:fs/promises');
const path = require('node:path');
const { spawn } = require('node:child_process');
const u = require('../project/desktop/employee-update-cache.cjs');

const EXE = '鑫金源珠宝报价.exe';
const LINK_NAME = '鑫金源珠宝（主机）.lnk';
const ARGS = '';
const POWERSHELL = 'C:\\Windows\\System32\\WindowsPowerShell\\v1.0\\powershell.exe';

const SCRIPT = [
  "[Console]::InputEncoding=[Text.UTF8Encoding]::new($false)",
  "[Console]::OutputEncoding=[Text.UTF8Encoding]::new($false)",
  "$ErrorActionPreference='Stop'",
  "$r=[Console]::In.ReadToEnd()|ConvertFrom-Json",
  "$install=[string]$r.installationDir",
  "$exe=[string]$r.executablePath",
  "$linkName=[string]$r.linkName",
  "$expectedArgs=[string]$r.arguments",
  "$desktop=[string]$r.desktopDirectory",
  "if([string]::IsNullOrWhiteSpace($desktop)){$desktop=[Environment]::GetFolderPath([Environment+SpecialFolder]::Desktop)}",
  "if(!(Test-Path -LiteralPath $desktop -PathType Container)){throw 'DESKTOP_MISSING'}",
  "if(!(Test-Path -LiteralPath $exe -PathType Leaf)){throw 'TARGET_EXE_MISSING'}",
  "$link=Join-Path $desktop $linkName",
  "$shell=New-Object -ComObject WScript.Shell",
  "if(Test-Path -LiteralPath $link -PathType Leaf){",
  "  $existing=$shell.CreateShortcut($link)",
  "  $same=$false",
  "  try{$same=([IO.Path]::GetFullPath([string]$existing.TargetPath).TrimEnd('\\') -ieq [IO.Path]::GetFullPath($exe).TrimEnd('\\')) -and ([string]$existing.Arguments -ieq $expectedArgs) -and ([IO.Path]::GetFullPath([string]$existing.WorkingDirectory).TrimEnd('\\') -ieq [IO.Path]::GetFullPath($install).TrimEnd('\\'))}catch{$same=$false}",
  "  if(!$same){throw 'SHORTCUT_CONFLICT'}",
  "  @{created=$false;reused=$true;path=$link}|ConvertTo-Json -Compress;exit 0",
  "}",
  "$linkObj=$shell.CreateShortcut($link)",
  "$linkObj.TargetPath=$exe",
  "$linkObj.Arguments=$expectedArgs",
  "$linkObj.WorkingDirectory=$install",
  "$linkObj.Save()",
  "$check=$shell.CreateShortcut($link)",
  "if(!([IO.Path]::GetFullPath([string]$check.TargetPath).TrimEnd('\\') -ieq [IO.Path]::GetFullPath($exe).TrimEnd('\\'))){throw 'SHORTCUT_VERIFY_TARGET'}",
  "if(!([string]$check.Arguments -ieq $expectedArgs)){throw 'SHORTCUT_VERIFY_ARGS'}",
  "if(!([IO.Path]::GetFullPath([string]$check.WorkingDirectory).TrimEnd('\\') -ieq [IO.Path]::GetFullPath($install).TrimEnd('\\'))){throw 'SHORTCUT_VERIFY_WORKDIR'}",
  "@{created=$true;reused=$false;path=$link}|ConvertTo-Json -Compress"
].join('\n');

function fail(code, message) { const e = new Error(message); e.code = code; throw e; }

function runPowerShellJson(payload) {
  return new Promise((resolve, reject) => {
    const encoded = Buffer.from(SCRIPT, 'utf16le').toString('base64');
    const child = spawn(POWERSHELL, ['-NoLogo', '-NoProfile', '-NonInteractive', '-EncodedCommand', encoded], {
      windowsHide: true, shell: false,
      env: { SystemRoot: 'C:\\Windows', WINDIR: 'C:\\Windows', SystemDrive: 'C:', PATHEXT: '.EXE' },
      stdio: ['pipe', 'pipe', 'pipe']
    });
    let out = '', err = '';
    child.stdout.on('data', d => { out += d.toString('utf8'); });
    child.stderr.on('data', d => { err += d.toString('utf8'); });
    child.once('error', reject);
    child.once('close', code => {
      if (code !== 0) return reject(Object.assign(new Error('快捷方式 PowerShell 失败：' + err.trim().slice(-400)), { code: 'SHORTCUT_POWERSHELL_FAILED' }));
      let parsed;
      try { parsed = JSON.parse(out.trim()); } catch { return reject(Object.assign(new Error('快捷方式 PowerShell 输出无效：' + out.trim().slice(0, 200)), { code: 'SHORTCUT_BAD_OUTPUT' })); }
      resolve(parsed);
    });
    child.stdin.on('error', reject);
    child.stdin.end(Buffer.from(JSON.stringify(payload), 'utf8'));
  });
}

async function ensureHostShortcut(options) {
  if (!options || typeof options !== 'object') fail('BAD_OPTIONS', '缺少快捷方式参数');
  if (options.role !== 'host') fail('SHORTCUT_ROLE_REQUIRED', '只允许主机角色创建该快捷方式');
  if (options.commitVerified !== true) fail('SHORTCUT_COMMIT_REQUIRED', '安装提交未验证，拒绝创建快捷方式');
  const install = u.safeAbsolute(options.installationDir);
  await u.assertPath(fsp, install, { directory: true });
  const exe = path.join(install, EXE);
  try { await u.assertPath(fsp, exe, { root: install }); }
  catch { fail('SHORTCUT_TARGET_MISSING', '目标程序不存在：' + exe); }
  const payload = { installationDir: install, executablePath: exe, linkName: LINK_NAME, arguments: ARGS, desktopDirectory: options.desktopDirectory || '' };
  const result = await runPowerShellJson(payload);
  if (!result || typeof result.path !== 'string' || result.created === result.reused ||
      !((result.created === true && result.reused === false) || (result.created === false && result.reused === true)))
    fail('SHORTCUT_BAD_OUTPUT', '快捷方式未返回唯一创建或复用确认');
  return Object.freeze({ created: result.created === true, reused: result.reused === true, path: result.path, target: exe, arguments: ARGS, workingDirectory: install });
}

module.exports = { ensureHostShortcut, LINK_NAME, ARGS, EXE };
