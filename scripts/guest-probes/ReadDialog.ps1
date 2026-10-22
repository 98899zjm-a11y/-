Add-Type @"
using System;
using System.Runtime.InteropServices;
using System.Text;
public class W5 {
  [DllImport("user32.dll")] public static extern bool EnumChildWindows(IntPtr parent, EnumWindowsProc cb, IntPtr l);
  [DllImport("user32.dll")] public static extern bool EnumWindows(EnumWindowsProc cb, IntPtr l);
  public delegate bool EnumWindowsProc(IntPtr h, IntPtr l);
  [DllImport("user32.dll", CharSet=CharSet.Unicode)] public static extern int GetWindowTextW(IntPtr h, StringBuilder s, int n);
  [DllImport("user32.dll", CharSet=CharSet.Unicode)] public static extern int GetClassNameW(IntPtr h, StringBuilder s, int n);
  [DllImport("user32.dll")] public static extern uint GetWindowThreadProcessId(IntPtr h, out uint pid);
}
"@
$out = [ordered]@{ at = (Get-Date).ToString('o'); dialogs = @() }
$tops = New-Object System.Collections.ArrayList
$cb = [W5+EnumWindowsProc]{
  param($h, $l)
  $sb = New-Object System.Text.StringBuilder 512
  [void][W5]::GetWindowTextW($h, $sb, 512)
  $procId = 0
  [void][W5]::GetWindowThreadProcessId($h, [ref]$procId)
  $cls = New-Object System.Text.StringBuilder 256
  [void][W5]::GetClassNameW($h, $cls, 256)
  if ($cls.ToString() -eq '#32770') {
    [void]$tops.Add([pscustomobject]@{ hwnd = $h; pid = [int]$procId; title = $sb.ToString() })
  }
  return $true
}
[void][W5]::EnumWindows($cb, [IntPtr]::Zero)
foreach ($t in $tops) {
  $children = New-Object System.Collections.ArrayList
  $cb2 = [W5+EnumWindowsProc]{
    param($h, $l)
    $sb = New-Object System.Text.StringBuilder 1024
    [void][W5]::GetWindowTextW($h, $sb, 1024)
    $cls = New-Object System.Text.StringBuilder 256
    [void][W5]::GetClassNameW($h, $cls, 256)
    [void]$children.Add([ordered]@{ cls = $cls.ToString(); text = $sb.ToString() })
    return $true
  }
  [void][W5]::EnumChildWindows($t.hwnd, $cb2, [IntPtr]::Zero)
  $out.dialogs += [ordered]@{ hwnd = [int64]$t.hwnd; pid = $t.pid; title = $t.title; children = @($children) }
}
$stamp = (Get-Date).ToString('yyyyMMdd-HHmmss')
$out | ConvertTo-Json -Depth 6 | Set-Content -LiteralPath ('C:\XjyReleaseResults\dialog-' + $stamp + '.json') -Encoding UTF8
Write-Output ('WROTE dialog-' + $stamp + '.json dialogs=' + $out.dialogs.Count)
