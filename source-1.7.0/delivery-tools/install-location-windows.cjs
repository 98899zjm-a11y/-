'use strict';
const path = require('node:path');
const childProcess = require('node:child_process');
const { normalizeInstallPath } = require('./install-location.cjs');

const MAX_REGISTRY = 512;
const MAX_SHORTCUTS = 1024;
const MAX_CANDIDATES = 2048;
const PRODUCT_HINT = /鑫金源|xjy/i;
const POWERSHELL = 'C:\\Windows\\System32\\WindowsPowerShell\\v1.0\\powershell.exe';
const WINDOWS_CANDIDATE_COMMAND = String.raw`$ErrorActionPreference='Stop'
[Console]::OutputEncoding=[Text.UTF8Encoding]::new($false)
$registry=[System.Collections.Generic.List[object]]::new()
$shortcuts=[System.Collections.Generic.List[object]]::new()
$pattern='(?i)鑫金源|xjy'
$keyCount=0
foreach($hive in @([Microsoft.Win32.RegistryHive]::CurrentUser,[Microsoft.Win32.RegistryHive]::LocalMachine)){
 foreach($view in @([Microsoft.Win32.RegistryView]::Registry64,[Microsoft.Win32.RegistryView]::Registry32)){
  $base=[Microsoft.Win32.RegistryKey]::OpenBaseKey($hive,$view)
  try{
   $root=$base.OpenSubKey('Software\Microsoft\Windows\CurrentVersion\Uninstall',$false)
   if($root){try{
    foreach($name in $root.GetSubKeyNames()){
     $keyCount++;if($keyCount -gt 4096){throw 'Registry candidate bound exceeded'}
     $sub=$root.OpenSubKey($name,$false);if(!$sub){continue}
     try{
      $display=[string]$sub.GetValue('DisplayName',$null,[Microsoft.Win32.RegistryValueOptions]::DoNotExpandEnvironmentNames)
      $publisher=[string]$sub.GetValue('Publisher',$null,[Microsoft.Win32.RegistryValueOptions]::DoNotExpandEnvironmentNames)
      if($display -match $pattern -or $publisher -match $pattern){
       $install=[string]$sub.GetValue('InstallLocation',$null,[Microsoft.Win32.RegistryValueOptions]::DoNotExpandEnvironmentNames)
       $icon=[string]$sub.GetValue('DisplayIcon',$null,[Microsoft.Win32.RegistryValueOptions]::DoNotExpandEnvironmentNames)
       $registry.Add(@{displayName=$display;publisher=$publisher;installLocation=[Environment]::ExpandEnvironmentVariables($install);displayIcon=[Environment]::ExpandEnvironmentVariables($icon)})
       if($registry.Count -gt 512){throw 'Registry candidate bound exceeded'}
      }
     }finally{$sub.Dispose()}
    }
   }finally{$root.Dispose()}}
  }finally{$base.Dispose()}
 }
}
$folders=[System.Collections.Generic.HashSet[string]]::new([StringComparer]::OrdinalIgnoreCase)
foreach($kind in @('DesktopDirectory','CommonDesktopDirectory','StartMenu','CommonStartMenu','Programs','CommonPrograms')){
 $special=[Enum]::Parse([Environment+SpecialFolder],$kind)
 $folder=[Environment]::GetFolderPath($special)
 if($folder){[void]$folders.Add($folder)}
 if($kind -in @('StartMenu','CommonStartMenu','Programs','CommonPrograms') -and $folder -and (Test-Path -LiteralPath $folder -PathType Container)){
  $dirs=@(Get-ChildItem -LiteralPath $folder -Directory -ErrorAction SilentlyContinue | Select-Object -First 128)
  foreach($dir in $dirs){[void]$folders.Add($dir.FullName)}
 }
}
$shell=New-Object -ComObject WScript.Shell
try{
 foreach($folder in $folders){
  if(!(Test-Path -LiteralPath $folder -PathType Container)){continue}
  foreach($file in @(Get-ChildItem -LiteralPath $folder -Filter '*.lnk' -File -ErrorAction SilentlyContinue)){
   if($file.Name -notmatch $pattern){continue}
   $link=$shell.CreateShortcut($file.FullName)
   try{$shortcuts.Add(@{name=$file.Name;target=[string]$link.TargetPath})}finally{[void][Runtime.InteropServices.Marshal]::FinalReleaseComObject($link)}
   if($shortcuts.Count -gt 1024){throw 'Shortcut candidate bound exceeded'}
  }
 }
}finally{[void][Runtime.InteropServices.Marshal]::FinalReleaseComObject($shell)}
@{registryEntries=@($registry.ToArray());shortcuts=@($shortcuts.ToArray())}|ConvertTo-Json -Depth 6 -Compress`;

function isProductHint(value) { return typeof value === 'string' && PRODUCT_HINT.test(value); }

function candidatePath(source, raw, { executable = false } = {}) {
  if (typeof raw !== 'string' || !raw.trim() || raw.length > 32767) return null;
  let value = raw.trim();
  if (/[%%\x00-\x1f]/.test(value)) return null;
  if (executable) {
    if (!path.win32.isAbsolute(value) || path.win32.extname(value).toLowerCase() !== '.exe') return null;
    value = path.win32.dirname(value);
  }
  const normalized = normalizeInstallPath(value);
  return normalized ? { source, path: normalized } : null;
}

function displayIconInstallDirectory(raw) {
  if (typeof raw !== 'string' || !raw.trim() || raw.length > 32767 || /[%\x00-\x1f]/.test(raw)) return null;
  const input = raw.trim();
  let executable;
  if (input.startsWith('"')) {
    const match = /^"([^"\r\n]+)"(?:\s*,\s*-?\d+)?$/.exec(input);
    if (!match) return null;
    executable = match[1];
  } else {
    if (input.includes('"')) return null;
    const match = /^(.*?)(?:\s*,\s*-?\d+)?$/.exec(input);
    if (!match) return null;
    executable = match[1].trim();
    if (/,/.test(executable)) return null;
  }
  if (!path.win32.isAbsolute(executable) || path.win32.extname(executable).toLowerCase() !== '.exe') return null;
  return normalizeInstallPath(path.win32.dirname(executable));
}

function checkedArray(value, maximum, name) {
  if (value === undefined) return [];
  if (!Array.isArray(value) || value.length > maximum) throw Object.assign(new Error('Candidate source limit exceeded: ' + name), { code: 'TOO_MANY_CANDIDATES' });
  return value;
}

function collectWindowsInstallCandidates(snapshot = {}) {
  if (!snapshot || typeof snapshot !== 'object' || Array.isArray(snapshot)) throw Object.assign(new Error('Candidate snapshot must be an object'), { code: 'BAD_CANDIDATE_SNAPSHOT' });
  const rows = [];
  const add = row => { if (rows.length >= MAX_CANDIDATES) throw Object.assign(new Error('Candidate source limit exceeded'), { code: 'TOO_MANY_CANDIDATES' }); if (row) rows.push(row); };
  for (const [key, source, executable] of [
    ['runningExecutable', 'running-exe', true],
    ['rememberedDirectory', 'remembered', false],
    ['approvalDirectory', 'approval', false],
    ['manualExecutable', 'manual-exe', true],
  ]) {
    if (snapshot[key] !== undefined && snapshot[key] !== null) add(candidatePath(source, snapshot[key], { executable }));
  }

  const registryEntries = checkedArray(snapshot.registryEntries, MAX_REGISTRY, 'registry');
  for (const entry of registryEntries) {
    if (!entry || typeof entry !== 'object' || !isProductHint(entry.displayName) && !isProductHint(entry.publisher)) continue;
    if (entry.installLocation !== undefined && entry.installLocation !== null && entry.installLocation !== '') add(candidatePath('uninstall-install-location', entry.installLocation));
    if (entry.displayIcon !== undefined && entry.displayIcon !== null && entry.displayIcon !== '') add(candidatePath('uninstall-display-icon', displayIconInstallDirectory(entry.displayIcon)));
  }

  const shortcuts = checkedArray(snapshot.shortcuts, MAX_SHORTCUTS, 'shortcuts');
  for (const shortcut of shortcuts) {
    if (!shortcut || typeof shortcut !== 'object' || !isProductHint(shortcut.name)) continue;
    add(candidatePath('shortcut', shortcut.target, { executable: true }));
  }
  return rows;
}

function collectNativeWindowsInstallCandidates({ platform = process.platform, execFileAdapter = childProcess.execFile } = {}) {
  if (platform !== 'win32') return Promise.reject(Object.assign(new Error('Windows installation discovery is supported only on Windows'), { code: 'UNSUPPORTED_PLATFORM' }));
  const encoded = Buffer.from(WINDOWS_CANDIDATE_COMMAND, 'utf16le').toString('base64');
  const args = ['-NoLogo', '-NoProfile', '-NonInteractive', '-EncodedCommand', encoded];
  const options = { windowsHide: true, shell: false, encoding: 'utf8', timeout: 15000, maxBuffer: 1048576, env: { SystemRoot: 'C:\\Windows', WINDIR: 'C:\\Windows', SystemDrive: 'C:', PATHEXT: '.EXE' } };
  return new Promise((resolve, reject) => {
    execFileAdapter(POWERSHELL, args, options, (error, stdout, stderr) => {
      if (error) return reject(Object.assign(new Error('本机安装位置只读查询失败；没有改动程序或注册表。'), { code: 'CANDIDATE_DISCOVERY_FAILED', cause: error, stderr: String(stderr || '').slice(-2048) }));
      if (typeof stdout !== 'string' || Buffer.byteLength(stdout) > options.maxBuffer) return reject(Object.assign(new Error('安装位置候选结果无效。'), { code: 'BAD_CANDIDATE_SNAPSHOT' }));
      let snapshot;
      try { snapshot = JSON.parse(stdout.replace(/^\uFEFF/, '')); } catch { return reject(Object.assign(new Error('安装位置候选结果不是有效 JSON。'), { code: 'BAD_CANDIDATE_SNAPSHOT' })); }
      try { resolve(collectWindowsInstallCandidates(snapshot)); } catch (parseError) { reject(parseError); }
    });
  });
}

module.exports = { collectWindowsInstallCandidates, collectNativeWindowsInstallCandidates, displayIconInstallDirectory, isProductHint, WINDOWS_CANDIDATE_COMMAND };
