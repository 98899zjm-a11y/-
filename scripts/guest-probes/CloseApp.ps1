$ErrorActionPreference = 'Continue'
$ResultDir = 'C:\XjyReleaseResults'
Add-Type @"
using System;
using System.Runtime.InteropServices;
public class WCloser {
  [DllImport("user32.dll")] public static extern bool EnumWindows(EnumWindowsProc cb, IntPtr l);
  public delegate bool EnumWindowsProc(IntPtr h, IntPtr l);
  [DllImport("user32.dll")] public static extern uint GetWindowThreadProcessId(IntPtr h, out uint pid);
  [DllImport("user32.dll")] public static extern bool IsWindowVisible(IntPtr h);
  [DllImport("user32.dll")] public static extern int PostMessageW(IntPtr h, uint msg, IntPtr w, IntPtr l);
}
"@
$WM_CLOSE = 0x0010
$procs = @(Get-Process -ErrorAction SilentlyContinue | Where-Object {
  try { $_.Path -and $_.Path -like '*XjyRootRelease170*' } catch { $false }
})
$report = [ordered]@{ at = (Get-Date).ToString('o'); targets = @() }
foreach ($p in $procs) {
  $row = [ordered]@{ id = $p.Id; name = $p.ProcessName; path = $p.Path; windows = 0; mainWindow = $false }
  try { $row.mainWindow = $p.CloseMainWindow() } catch { }
  $pidCopy = $p.Id
  $cb = [WCloser+EnumWindowsProc]{
    param($h, $l)
    $wpid = 0
    [void][WCloser]::GetWindowThreadProcessId($h, [ref]$wpid)
    if ($wpid -eq $pidCopy) {
      [void][WCloser]::PostMessageW($h, $WM_CLOSE, [IntPtr]::Zero, [IntPtr]::Zero)
      $script:cnt++
    }
    return $true
  }
  $script:cnt = 0
  [void][WCloser]::EnumWindows($cb, [IntPtr]::Zero)
  $row.windows = $script:cnt
  $report.targets += $row
}
Start-Sleep -Seconds 5
$report.stillRunning = @(Get-Process -ErrorAction SilentlyContinue | Where-Object { try { $_.Path -and $_.Path -like '*XjyRootRelease170*' } catch { $false } } | ForEach-Object { [ordered]@{ id = $_.Id; name = $_.ProcessName } })
$report.exitFileExists = (Test-Path -LiteralPath (Join-Path $ResultDir 'manual-upgrade-exit.txt'))
if ($report.exitFileExists) { $report.exitValue = (Get-Content -LiteralPath (Join-Path $ResultDir 'manual-upgrade-exit.txt') -Raw) }
$stamp = (Get-Date).ToString('yyyyMMdd-HHmmss')
$out = Join-Path $ResultDir ('closeapp-' + $stamp + '.json')
$report | ConvertTo-Json -Depth 6 | Set-Content -LiteralPath $out -Encoding UTF8
Write-Output ('WROTE ' + $out)
Write-Output ('targets=' + @($report.targets).Count + ' stillRunning=' + @($report.stillRunning).Count + ' exitFile=' + $report.exitFileExists)
