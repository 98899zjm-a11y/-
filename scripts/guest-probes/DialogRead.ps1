$ErrorActionPreference = 'Continue'
Add-Type @"
using System;
using System.Runtime.InteropServices;
using System.Text;
public class Dlg2 {
  public delegate bool EnumProc(IntPtr h, IntPtr l);
  [DllImport("user32.dll")] public static extern bool EnumWindows(EnumProc cb, IntPtr l);
  [DllImport("user32.dll")] public static extern bool EnumChildWindows(IntPtr parent, EnumProc cb, IntPtr l);
  [DllImport("user32.dll", CharSet=CharSet.Unicode)] public static extern int GetWindowTextW(IntPtr h, StringBuilder s, int n);
  [DllImport("user32.dll", CharSet=CharSet.Unicode)] public static extern int GetClassNameW(IntPtr h, StringBuilder s, int n);
  [DllImport("user32.dll")] public static extern bool IsWindowVisible(IntPtr h);
  [DllImport("user32.dll")] public static extern uint GetWindowThreadProcessId(IntPtr h, out uint pid);
  [DllImport("user32.dll", CharSet=CharSet.Unicode)] public static extern IntPtr SendMessageW(IntPtr h, uint msg, IntPtr wp, StringBuilder lp);
}
"@
$results = New-Object System.Collections.ArrayList
$topCb = [Dlg2+EnumProc]{
  param($h, $l)
  if ([Dlg2]::IsWindowVisible($h)) {
    $cls = New-Object System.Text.StringBuilder 128
    [void][Dlg2]::GetClassNameW($h, $cls, 128)
    if ($cls.ToString() -eq '#32770') {
      $t = New-Object System.Text.StringBuilder 512
      [void][Dlg2]::GetWindowTextW($h, $t, 512)
      $procId = 0
      [void][Dlg2]::GetWindowThreadProcessId($h, [ref]$procId)
      $texts = New-Object System.Collections.ArrayList
      $childCb = [Dlg2+EnumProc]{
        param($c, $l2)
        $ct = New-Object System.Text.StringBuilder 2048
        [void][Dlg2]::SendMessageW($c, 0x000D, [IntPtr]::Zero, $ct)
        $s = $ct.ToString()
        if ($s.Length -gt 0) { [void]$texts.Add($s) }
        return $true
      }
      [void][Dlg2]::EnumChildWindows($h, $childCb, [IntPtr]::Zero)
      [void]$results.Add([ordered]@{ hwnd = [int64]$h; pid = $procId; title = $t.ToString(); texts = @($texts) })
    }
  }
  return $true
}
[void][Dlg2]::EnumWindows($topCb, [IntPtr]::Zero)
$payload = [ordered]@{ at = (Get-Date).ToString('o'); dialogs = @($results) }
$payload | ConvertTo-Json -Depth 6 | Set-Content -LiteralPath 'C:\XjyResults\dialog.json' -Encoding UTF8
Write-Output ('DIALOGS=' + $results.Count)
