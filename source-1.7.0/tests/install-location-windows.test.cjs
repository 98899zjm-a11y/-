'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { spawnSync } = require('node:child_process');
const { collectWindowsInstallCandidates, collectNativeWindowsInstallCandidates, displayIconInstallDirectory, WINDOWS_CANDIDATE_COMMAND } = require('../delivery-tools/install-location-windows.cjs');

const root = 'C:\\Users\\Staff\\AppData\\Local\\鑫金源珠宝\\员工程序';
const exe = root + '\\鑫金源珠宝报价.exe';

test('candidate collector reads only supplied known local sources and returns provenance without trust claims', () => {
  const rows = collectWindowsInstallCandidates({
    runningExecutable: exe,
    rememberedDirectory: root,
    approvalDirectory: 'D:\\Apps\\XJY-Host',
    registryEntries: [
      { displayName: '鑫金源珠宝', publisher: '鑫金源', installLocation: root, displayIcon: '"' + exe + '",0' },
      { displayName: 'Other app', publisher: 'Other', installLocation: 'C:\\Other', displayIcon: 'C:\\Other\\other.exe,0' },
    ],
    shortcuts: [
      { name: '鑫金源珠宝 1.6.2.lnk', target: exe },
      { name: 'Browser.lnk', target: 'C:\\Browser\\browser.exe' },
    ],
  });
  assert.deepEqual(rows, [
    { source: 'running-exe', path: root },
    { source: 'remembered', path: root },
    { source: 'approval', path: 'D:\\Apps\\XJY-Host' },
    { source: 'uninstall-install-location', path: root },
    { source: 'uninstall-display-icon', path: root },
    { source: 'shortcut', path: root },
  ]);
  assert(rows.every(row => !Object.hasOwn(row, 'outcome') && !Object.hasOwn(row, 'role') && !Object.hasOwn(row, 'trusted') && !Object.hasOwn(row, 'knownProduct')));
});

test('DisplayIcon parsing accepts quoted and unquoted executable paths with a numeric icon index', () => {
  assert.equal(displayIconInstallDirectory('"C:\\Program Files\\XJY\\鑫金源珠宝报价.exe",0'), 'C:\\Program Files\\XJY');
  assert.equal(displayIconInstallDirectory('C:\\Program Files\\XJY\\鑫金源珠宝报价.exe,0'), 'C:\\Program Files\\XJY');
  assert.equal(displayIconInstallDirectory('C:\\Apps\\XJY\\鑫金源珠宝报价.exe'), 'C:\\Apps\\XJY');
});

test('ambiguous icons, command lines, UNC paths, variable paths, aliases and non-XJY registry keys are not candidates', () => {
  for (const value of [
    'rundll32.exe C:\\Apps\\XJY.dll,Entry',
    '"C:\\Apps\\xjy.exe" --arg',
    '"C:\\Apps\\xjy.exe",0,1',
    '\\\\server\\share\\鑫金源珠宝报价.exe,0',
    '%LOCALAPPDATA%\\XJY\\鑫金源珠宝报价.exe,0',
    'C:\\Apps\\XJY\\..\\Other\\鑫金源珠宝报价.exe,0',
  ]) assert.equal(displayIconInstallDirectory(value), null, value);
  const rows = collectWindowsInstallCandidates({
    registryEntries: [
      { displayName: '鑫金源珠宝', installLocation: '\\\\server\\share\\XJY', displayIcon: 'bad' },
      { displayName: 'Unrelated', installLocation: 'C:\\Other', displayIcon: 'C:\\Other\\x.exe,0' },
    ],
    shortcuts: [{ name: 'Spotify.lnk', target: 'C:\\Program Files\\Spotify\\Spotify.exe' }],
  });
  assert.deepEqual(rows, []);
});

test('oversized candidate collections fail closed before resolving any path', () => {
  const registryEntries = Array.from({ length: 513 }, (_, index) => ({ displayName: '鑫金源珠宝 ' + index, installLocation: 'C:\\Apps\\XJY' + index }));
  assert.throws(() => collectWindowsInstallCandidates({ registryEntries }), error => error.code === 'TOO_MANY_CANDIDATES');
});

test('native collector invokes only fixed read-only PowerShell with a minimal environment', async () => {
  let call;
  const result = await collectNativeWindowsInstallCandidates({
    platform: 'win32',
    execFileAdapter(file, args, options, callback) {
      call = { file, args, options };
      callback(null, JSON.stringify({ registryEntries: [{ displayName: '鑫金源珠宝', installLocation: root }], shortcuts: [] }), '');
    },
  });
  assert.equal(call.file, 'C:\\Windows\\System32\\WindowsPowerShell\\v1.0\\powershell.exe');
  assert.deepEqual(call.args.slice(0, 3), ['-NoLogo', '-NoProfile', '-NonInteractive']);
  assert.equal(call.args[3], '-EncodedCommand');
  assert.equal(call.options.shell, false);
  assert.equal(call.options.windowsHide, true);
  assert.equal(call.options.timeout, 15000);
  assert.deepEqual(Object.keys(call.options.env).sort(), ['PATHEXT', 'SystemDrive', 'SystemRoot', 'WINDIR'].sort());
  assert.deepEqual(result, [{ source: 'uninstall-install-location', path: root }]);
});

test('PowerShell collector uses bounded read-only uninstall and known-folder APIs only', () => {
  assert(WINDOWS_CANDIDATE_COMMAND.includes('Registry64'));
  assert(WINDOWS_CANDIDATE_COMMAND.includes('Registry32'));
  assert(WINDOWS_CANDIDATE_COMMAND.includes('OpenSubKey'));
  assert(WINDOWS_CANDIDATE_COMMAND.includes('StartMenu'));
  assert(WINDOWS_CANDIDATE_COMMAND.includes('WScript.Shell'));
  assert(!/SetValue|CreateSubKey|DeleteSubKey|Remove-Item|UninstallString|Start-Process|Invoke-Expression|Get-ChildItem[^\r\n]*-Recurse/i.test(WINDOWS_CANDIDATE_COMMAND));
});

test('fixed Windows PowerShell 5.1 parses the collector without executing registry or shortcut reads', { skip: process.platform !== 'win32' }, () => {
  const source = Buffer.from(WINDOWS_CANDIDATE_COMMAND, 'utf8').toString('base64');
  const command = "$s=[Text.Encoding]::UTF8.GetString([Convert]::FromBase64String('" + source + "'));$tokens=$null;$errors=$null;[Management.Automation.Language.Parser]::ParseInput($s,[ref]$tokens,[ref]$errors)|Out-Null;if($errors.Count){$errors|ForEach-Object{[Console]::Error.WriteLine($_.Message)};exit 1};'{\"passed\":true,\"executed\":false}'";
  const result = spawnSync('C:/Windows/System32/WindowsPowerShell/v1.0/powershell.exe', ['-NoLogo', '-NoProfile', '-NonInteractive', '-EncodedCommand', Buffer.from(command, 'utf16le').toString('base64')], { windowsHide: true, shell: false, encoding: 'utf8', timeout: 20000 });
  assert.equal(result.status, 0, result.stderr || result.stdout);
  assert.deepEqual(JSON.parse(result.stdout.trim()), { passed: true, executed: false });
});

test('native discovery rejects non-Windows hosts and malformed PowerShell output', async () => {
  let called = false;
  await assert.rejects(collectNativeWindowsInstallCandidates({ platform: 'linux', execFileAdapter() { called = true; } }), error => error.code === 'UNSUPPORTED_PLATFORM');
  assert.equal(called, false);
  await assert.rejects(collectNativeWindowsInstallCandidates({ platform: 'win32', execFileAdapter(_file, _args, _options, callback) { callback(null, 'not-json', ''); } }), error => error.code === 'BAD_CANDIDATE_SNAPSHOT');
});
