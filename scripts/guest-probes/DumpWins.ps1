$ErrorActionPreference = 'Stop'
Add-Type @"
using System;
using System.Text;
using System.Runtime.InteropServices;
public class U3 {
  public delegate bool EnumProc(IntPtr h, IntPtr l);
  [DllImport("user32.dll")] public static extern bool EnumWindows(EnumProc cb, IntPtr l);
  [DllImport("user32.dll")] public static extern bool EnumChildWindows(IntPtr parent, EnumProc cb, IntPtr l);
  [DllImport("user32.dll")] public static extern uint GetWindowThreadProcessId(IntPtr h, out uint pid);
  [DllImport("user32.dll", CharSet=CharSet.Unicode)] public static extern int GetWindowTextW(IntPtr h, StringBuilder s, int n);
  [DllImport("user32.dll", CharSet=CharSet.Unicode)] public static extern int GetClassNameW(IntPtr h, StringBuilder s, int n);
  [DllImport("user32.dll")] public static extern bool IsWindowVisible(IntPtr h);
}
"@
$script:top = @()
$cbTop = [U3+EnumProc]{
  param($h, $l)
  $procId = 0
  [void][U3]::GetWindowThreadProcessId($h, [ref]$procId)
  if ([U3]::IsWindowVisible($h)) {
    $sb = New-Object System.Text.StringBuilder 512
    [void][U3]::GetWindowTextW($h, $sb, 512)
    $t = $sb.ToString()
    if ($t.Length -gt 0) {
      $cs = New-Object System.Text.StringBuilder 256
      [void][U3]::GetClassNameW($h, $cs, 256)
      $script:top += [pscustomobject]@{ hwnd = [int64]$h; pid = $procId; cls = $cs.ToString(); title = $t }
    }
  }
  return $true
}
[void][U3]::EnumWindows($cbTop, [IntPtr]::Zero)
$report = @()
foreach ($w in $script:top) {
  $script:kids = @()
  $cbChild = [U3+EnumProc]{
    param($ch, $l)
    $cs = New-Object System.Text.StringBuilder 256
    [void][U3]::GetClassNameW($ch, $cs, 256)
    $tb = New-Object System.Text.StringBuilder 1024
    [void][U3]::GetWindowTextW($ch, $tb, 1024)
    if ($tb.ToString() -ne '') { $script:kids += [pscustomobject]@{ hwnd = [int64]$ch; cls = $cs.ToString(); text = $tb.ToString() } }
    return $true
  }
  [void][U3]::EnumChildWindows([IntPtr]$w.hwnd, $cbChild, [IntPtr]::Zero)
  $report += [pscustomobject]@{ hwnd = $w.hwnd; pid = $w.pid; cls = $w.cls; title = $w.title; children = @($script:kids) }
}
$report | ConvertTo-Json -Depth 5 | Set-Content -LiteralPath 'C:\XjyResults\wins2.json' -Encoding UTF8
Write-Output 'DONE'
