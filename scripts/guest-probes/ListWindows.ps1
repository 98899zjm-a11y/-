Add-Type @"
using System;
using System.Runtime.InteropServices;
using System.Text;
public class W4 {
  [DllImport("user32.dll")] public static extern bool EnumWindows(EnumWindowsProc cb, IntPtr l);
  public delegate bool EnumWindowsProc(IntPtr h, IntPtr l);
  [DllImport("user32.dll", CharSet=CharSet.Unicode)] public static extern int GetWindowTextW(IntPtr h, StringBuilder s, int n);
  [DllImport("user32.dll", CharSet=CharSet.Unicode)] public static extern int GetClassNameW(IntPtr h, StringBuilder s, int n);
  [DllImport("user32.dll")] public static extern bool IsWindowVisible(IntPtr h);
  [DllImport("user32.dll")] public static extern uint GetWindowThreadProcessId(IntPtr h, out uint pid);
}
"@
$rows = New-Object System.Collections.ArrayList
$cb = [W4+EnumWindowsProc]{
  param($h, $l)
  $sb = New-Object System.Text.StringBuilder 512
  [void][W4]::GetWindowTextW($h, $sb, 512)
  $t = $sb.ToString()
  $procId = 0
  [void][W4]::GetWindowThreadProcessId($h, [ref]$procId)
  if ($t.Length -gt 0 -or $procId -eq 5500) {
    $cb2 = New-Object System.Text.StringBuilder 256
    [void][W4]::GetClassNameW($h, $cb2, 256)
    [void]$rows.Add([ordered]@{ hwnd = [int64]$h; pid = [int]$procId; visible = [W4]::IsWindowVisible($h); cls = $cb2.ToString(); title = $t })
  }
  return $true
}
[void][W4]::EnumWindows($cb, [IntPtr]::Zero)
$out = [ordered]@{ at = (Get-Date).ToString('o'); windows = @($rows) }
$stamp = (Get-Date).ToString('yyyyMMdd-HHmmss')
$out | ConvertTo-Json -Depth 4 | Set-Content -LiteralPath ('C:\XjyReleaseResults\wins-' + $stamp + '.json') -Encoding UTF8
Write-Output ('WROTE wins-' + $stamp + '.json count=' + $rows.Count)
