param([string]$Out = 'D:\Codex\xjy-release-20261022\guest-results\hostwin.json')
Add-Type @"
using System;
using System.Text;
using System.Runtime.InteropServices;
public class HW {
  public delegate bool EnumProc(IntPtr h, IntPtr l);
  [DllImport("user32.dll")] public static extern bool EnumWindows(EnumProc cb, IntPtr l);
  [DllImport("user32.dll")] public static extern bool EnumChildWindows(IntPtr h, EnumProc cb, IntPtr l);
  [DllImport("user32.dll", CharSet=CharSet.Unicode)] public static extern int GetWindowTextW(IntPtr h, StringBuilder s, int n);
  [DllImport("user32.dll", CharSet=CharSet.Unicode)] public static extern int GetClassNameW(IntPtr h, StringBuilder s, int n);
  [DllImport("user32.dll")] public static extern bool IsWindowVisible(IntPtr h);
  [DllImport("user32.dll")] public static extern uint GetWindowThreadProcessId(IntPtr h, out uint pid);
}
"@
function TextOf([IntPtr]$h) { $sb = New-Object System.Text.StringBuilder 1024; [void][HW]::GetWindowTextW($h, $sb, 1024); $sb.ToString() }
function ClsOf([IntPtr]$h) { $sb = New-Object System.Text.StringBuilder 256; [void][HW]::GetClassNameW($h, $sb, 256); $sb.ToString() }
$list = New-Object System.Collections.ArrayList
$cb = [HW+EnumProc]{
  param($h, $l)
  if ([HW]::IsWindowVisible($h)) {
    $t = TextOf $h
    $procId = 0
    [void][HW]::GetWindowThreadProcessId($h, [ref]$procId)
    $kids = New-Object System.Collections.ArrayList
    $cb2 = [HW+EnumProc]{ param($k, $l2) $kt = TextOf $k; if ($kt) { [void]$kids.Add([pscustomobject]@{ cls = (ClsOf $k); text = $kt }) }; return $true }
    [void][HW]::EnumChildWindows($h, $cb2, [IntPtr]::Zero)
    if ($t -or $kids.Count -gt 0) {
      [void]$list.Add([pscustomobject]@{ hwnd = [int64]$h; pid = $procId; cls = (ClsOf $h); title = $t; children = $kids })
    }
  }
  return $true
}
[void][HW]::EnumWindows($cb, [IntPtr]::Zero)
$list | ConvertTo-Json -Depth 5 | Set-Content -LiteralPath $Out -Encoding UTF8
"WROTE $Out count=$($list.Count)"
