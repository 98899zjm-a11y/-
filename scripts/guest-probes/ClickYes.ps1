$ErrorActionPreference = 'Stop'
Add-Type @"
using System;
using System.Text;
using System.Runtime.InteropServices;
public class U4 {
  public delegate bool EnumProc(IntPtr h, IntPtr l);
  [DllImport("user32.dll")] public static extern bool EnumWindows(EnumProc cb, IntPtr l);
  [DllImport("user32.dll")] public static extern bool EnumChildWindows(IntPtr parent, EnumProc cb, IntPtr l);
  [DllImport("user32.dll")] public static extern uint GetWindowThreadProcessId(IntPtr h, out uint pid);
  [DllImport("user32.dll", CharSet=CharSet.Unicode)] public static extern int GetWindowTextW(IntPtr h, StringBuilder s, int n);
  [DllImport("user32.dll", CharSet=CharSet.Unicode)] public static extern int GetClassNameW(IntPtr h, StringBuilder s, int n);
  [DllImport("user32.dll")] public static extern bool IsWindowVisible(IntPtr h);
  [DllImport("user32.dll")] public static extern IntPtr SendMessage(IntPtr h, uint msg, IntPtr w, IntPtr l);
}
"@
# 0x662F = 是 ; dialog class #32770 ; button text starts with that char
$first = [char]0x662F
$script:targets = @()
$cbTop = [U4+EnumProc]{
  param($h, $l)
  if ([U4]::IsWindowVisible($h)) {
    $cs = New-Object System.Text.StringBuilder 64
    [void][U4]::GetClassNameW($h, $cs, 64)
    if ($cs.ToString() -eq '#32770') {
      $tb = New-Object System.Text.StringBuilder 256
      [void][U4]::GetWindowTextW($h, $tb, 256)
      $script:targets += [pscustomobject]@{ hwnd = [int64]$h; title = $tb.ToString() }
    }
  }
  return $true
}
[void][U4]::EnumWindows($cbTop, [IntPtr]::Zero)
$log = @()
foreach ($t in $script:targets) {
  $script:btns = @()
  $cbChild = [U4+EnumProc]{
    param($ch, $l)
    $cs = New-Object System.Text.StringBuilder 64
    [void][U4]::GetClassNameW($ch, $cs, 64)
    if ($cs.ToString() -eq 'Button') {
      $tb = New-Object System.Text.StringBuilder 256
      [void][U4]::GetWindowTextW($ch, $tb, 256)
      $script:btns += [pscustomobject]@{ hwnd = [int64]$ch; text = $tb.ToString() }
    }
    return $true
  }
  [void][U4]::EnumChildWindows([IntPtr]$t.hwnd, $cbChild, [IntPtr]::Zero)
  $yes = $script:btns | Where-Object { $_.text.StartsWith($first) } | Select-Object -First 1
  $action = 'none'
  if ($yes) { [void][U4]::SendMessage([IntPtr]$yes.hwnd, 0x00F5, [IntPtr]::Zero, [IntPtr]::Zero); $action = 'clicked:' + $yes.text }
  $log += [pscustomobject]@{ dialog = $t.title; buttons = @($script:btns | ForEach-Object { $_.text }); action = $action }
}
$log | ConvertTo-Json -Depth 4 | Set-Content -LiteralPath 'C:\XjyResults\yes.json' -Encoding UTF8
Write-Output 'DONE'
