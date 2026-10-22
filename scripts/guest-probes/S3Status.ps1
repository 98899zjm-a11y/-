$ErrorActionPreference = 'Continue'
$out = [ordered]@{}
$out.at = (Get-Date).ToString('o')
$out.procs = @()
foreach ($p in (Get-Process -ErrorAction SilentlyContinue)) {
  $path = ''
  try { $path = $p.Path } catch { }
  if ($p.ProcessName -match 'Xjy|鑫金源|powershell|node|cmd' -or $path -match 'Xjy|鑫金源') {
    $out.procs += [ordered]@{ id = $p.Id; name = $p.ProcessName; cpu = $p.CPU; ws = $p.WorkingSet64; path = $path }
  }
}
Add-Type @"
using System;
using System.Runtime.InteropServices;
using System.Text;
public class W3 {
  public delegate bool EnumProc(IntPtr h, IntPtr l);
  [DllImport("user32.dll")] public static extern bool EnumWindows(EnumProc cb, IntPtr l);
  [DllImport("user32.dll", CharSet=CharSet.Unicode)] public static extern int GetWindowTextW(IntPtr h, StringBuilder s, int n);
  [DllImport("user32.dll")] public static extern bool IsWindowVisible(IntPtr h);
  [DllImport("user32.dll", CharSet=CharSet.Unicode)] public static extern int GetClassNameW(IntPtr h, StringBuilder s, int n);
  [DllImport("user32.dll")] public static extern uint GetWindowThreadProcessId(IntPtr h, out uint pid);
}
"@
$win = @()
$cb = [W3+EnumProc]{
  param($h, $l)
  if ([W3]::IsWindowVisible($h)) {
    $sb = New-Object System.Text.StringBuilder 512
    [void][W3]::GetWindowTextW($h, $sb, 512)
    $t = $sb.ToString()
    if ($t.Length -gt 0) {
      $c = New-Object System.Text.StringBuilder 128
      [void][W3]::GetClassNameW($h, $c, 128)
      $procId = 0
      [void][W3]::GetWindowThreadProcessId($h, [ref]$procId)
      $script:win += [ordered]@{ hwnd = [int64]$h; title = $t; cls = $c.ToString(); pid = $procId }
    }
  }
  return $true
}
[void][W3]::EnumWindows($cb, [IntPtr]::Zero)
$out.windows = $win
$out | ConvertTo-Json -Depth 5 | Set-Content -LiteralPath 'C:\XjyResults\s3-status.json' -Encoding UTF8
Write-Output 'STATUS-WRITTEN'
