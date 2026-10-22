$ErrorActionPreference = 'Continue'
$log = 'C:\XjyReleaseResults\closeapp2-error.log'
try {
  Add-Type @"
using System;
using System.Runtime.InteropServices;
public class W3 {
  [DllImport("user32.dll")] public static extern bool EnumWindows(EnumWindowsProc cb, IntPtr l);
  public delegate bool EnumWindowsProc(IntPtr h, IntPtr l);
  [DllImport("user32.dll")] public static extern uint GetWindowThreadProcessId(IntPtr h, out uint pid);
  [DllImport("user32.dll")] public static extern bool PostMessage(IntPtr h, uint msg, IntPtr w, IntPtr l);
  [DllImport("user32.dll")] public static extern bool IsWindowVisible(IntPtr h);
}
"@
  $res = [ordered]@{ at = (Get-Date).ToString('o'); targets = @(); posted = @(); still = @(); exitFile = 'ABSENT' }
  $rows = @()
  foreach ($p in @(Get-Process -ErrorAction SilentlyContinue)) {
    $pp = $null
    try { $pp = $p.Path } catch { }
    if (-not $pp) { continue }
    if ($pp -like '*XjyGenuine150Host-a2\program*') {
      $rows += [ordered]@{ id = $p.Id; name = $p.ProcessName; path = $pp }
    }
  }
  $res.targets = $rows
  $wins = New-Object System.Collections.ArrayList
  $cb = [W3+EnumWindowsProc]{
    param($h, $l)
    $procId = 0
    [void][W3]::GetWindowThreadProcessId($h, [ref]$procId)
    if ($script:ids -contains [int]$procId) {
      [void][W3]::PostMessage($h, 0x0010, [IntPtr]::Zero, [IntPtr]::Zero)
      [void]$script:posted.Add([int]$procId)
    }
    return $true
  }
  $script:ids = @($rows | ForEach-Object { [int]$_.id })
  $script:posted = New-Object System.Collections.ArrayList
  [void][W3]::EnumWindows($cb, [IntPtr]::Zero)
  $res.posted = @($script:posted)
  Start-Sleep -Seconds 10
  $still = @()
  foreach ($r in $rows) {
    $p = Get-Process -Id $r.id -ErrorAction SilentlyContinue
    if ($p) { $still += [ordered]@{ id = $r.id; name = $r.name } }
  }
  $res.still = $still
  $ef = 'C:\XjyReleaseResults\manual-upgrade-exit.txt'
  if (Test-Path -LiteralPath $ef) { $res.exitFile = (Get-Content -LiteralPath $ef -Raw) }
  $stamp = (Get-Date).ToString('yyyyMMdd-HHmmss')
  $res | ConvertTo-Json -Depth 6 | Set-Content -LiteralPath ('C:\XjyReleaseResults\closeapp2-' + $stamp + '.json') -Encoding UTF8
  Write-Output ('OK closeapp2-' + $stamp + '.json targets=' + $rows.Count + ' posted=' + $res.posted.Count + ' still=' + $still.Count + ' exit=' + $res.exitFile)
} catch {
  ($_.Exception.ToString()) | Set-Content -LiteralPath $log -Encoding UTF8
  Write-Output ('ERR ' + $_.Exception.Message)
}
