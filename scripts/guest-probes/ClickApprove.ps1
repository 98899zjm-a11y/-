$ErrorActionPreference = 'Stop'
Add-Type @"
using System;
using System.Text;
using System.Runtime.InteropServices;
public class U {
  public delegate bool EnumProc(IntPtr h, IntPtr l);
  [DllImport("user32.dll")] public static extern bool EnumWindows(EnumProc cb, IntPtr l);
  [DllImport("user32.dll")] public static extern bool EnumChildWindows(IntPtr parent, EnumProc cb, IntPtr l);
  [DllImport("user32.dll")] public static extern uint GetWindowThreadProcessId(IntPtr h, out uint pid);
  [DllImport("user32.dll", CharSet=CharSet.Unicode)] public static extern int GetWindowTextW(IntPtr h, StringBuilder s, int n);
  [DllImport("user32.dll", CharSet=CharSet.Unicode)] public static extern int GetClassNameW(IntPtr h, StringBuilder s, int n);
  [DllImport("user32.dll")] public static extern bool IsWindowVisible(IntPtr h);
  [DllImport("user32.dll")] public static extern IntPtr SendMessage(IntPtr h, uint msg, IntPtr w, IntPtr l);
  [DllImport("user32.dll")] public static extern bool PostMessage(IntPtr h, uint msg, IntPtr w, IntPtr l);
}
"@
# target button text: 开始核验并安装  (built from char codes to stay ASCII)
$target = -join @(0x5F00,0x59CB,0x6838,0x9A8C,0x5E76,0x5B89,0x88C5 | ForEach-Object { [char]$_ })

$found = @()
$cbTop = [U+EnumProc]{
  param($h, $l)
  $procId = 0
  [void][U]::GetWindowThreadProcessId($h, [ref]$procId)
  $p = Get-Process -Id $procId -ErrorAction SilentlyContinue
  if ($p -and $p.ProcessName -eq 'powershell' -and [U]::IsWindowVisible($h)) {
    $sb = New-Object System.Text.StringBuilder 512
    [void][U]::GetWindowTextW($h, $sb, 512)
    $title = $sb.ToString()
    if ($title.Length -gt 0) {
      $script:found += [pscustomobject]@{ hwnd = [int64]$h; pid = $procId; title = $title }
    }
  }
  return $true
}
[void][U]::EnumWindows($cbTop, [IntPtr]::Zero)

$report = @()
foreach ($w in $found) {
  $script:buttons = @()
  $cbChild = [U+EnumProc]{
    param($ch, $l)
    $cls = New-Object System.Text.StringBuilder 256
    [void][U]::GetClassNameW($ch, $cls, 256)
    if ($cls.ToString() -eq 'Button') {
      $tb = New-Object System.Text.StringBuilder 256
      [void][U]::GetWindowTextW($ch, $tb, 256)
      $script:buttons += [pscustomobject]@{ hwnd = [int64]$ch; text = $tb.ToString() }
    }
    return $true
  }
  [void][U]::EnumChildWindows([IntPtr]$w.hwnd, $cbChild, [IntPtr]::Zero)
  $match = $buttons | Where-Object { $_.text -eq $target }
  $clicked = $false
  if ($match) { [void][U]::SendMessage([IntPtr]$match[0].hwnd, 0x00F5, [IntPtr]::Zero, [IntPtr]::Zero); $clicked = $true }
  $report += [pscustomobject]@{ window = $w.title; hwnd = $w.hwnd; buttons = @($buttons | ForEach-Object { $_.text }); clicked = $clicked }
}
$report | ConvertTo-Json -Depth 4 | Set-Content -LiteralPath 'C:\XjyResults\click.json' -Encoding UTF8
Write-Output 'DONE'
