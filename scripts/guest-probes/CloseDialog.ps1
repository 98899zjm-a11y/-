$ErrorActionPreference = 'Continue'
Add-Type @"
using System;
using System.Runtime.InteropServices;
using System.Text;
public class Dlg3 {
  public delegate bool EnumProc(IntPtr h, IntPtr l);
  [DllImport("user32.dll")] public static extern bool EnumWindows(EnumProc cb, IntPtr l);
  [DllImport("user32.dll", CharSet=CharSet.Unicode)] public static extern int GetClassNameW(IntPtr h, StringBuilder s, int n);
  [DllImport("user32.dll", CharSet=CharSet.Unicode)] public static extern int GetWindowTextW(IntPtr h, StringBuilder s, int n);
  [DllImport("user32.dll")] public static extern bool PostMessage(IntPtr h, uint msg, IntPtr wp, IntPtr lp);
  [DllImport("user32.dll")] public static extern bool IsWindowVisible(IntPtr h);
}
"@
$closed = New-Object System.Collections.ArrayList
$cb = [Dlg3+EnumProc]{
  param($h, $l)
  $cls = New-Object System.Text.StringBuilder 64
  [void][Dlg3]::GetClassNameW($h, $cls, 64)
  if ($cls.ToString() -eq '#32770' -and [Dlg3]::IsWindowVisible($h)) {
    $t = New-Object System.Text.StringBuilder 256
    [void][Dlg3]::GetWindowTextW($h, $t, 256)
    [void][Dlg3]::PostMessage($h, 0x0010, [IntPtr]::Zero, [IntPtr]::Zero)
    [void]$closed.Add([int64]$h)
  }
  return $true
}
[void][Dlg3]::EnumWindows($cb, [IntPtr]::Zero)
"closed=" + $closed.Count
