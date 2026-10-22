$ErrorActionPreference = 'Stop'
Add-Type @"
using System;
using System.Text;
using System.Runtime.InteropServices;
public class U2 {
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
$target = -join @(0x5F00,0x59CB,0x6838,0x9A8C,0x5E76,0x5B89,0x88C5 | ForEach-Object { [char]$_ })
$script:found = @()
$cbTop = [U2+EnumProc]{
  param($h, $l)
  $procId = 0
  [void][U2]::GetWindowThreadProcessId($h, [ref]$procId)
  $p = Get-Process -Id $procId -ErrorAction SilentlyContinue
  if ($p -and $p.ProcessName -eq 'powershell' -and [U2]::IsWindowVisible($h)) {
    $sb = New-Object System.Text.StringBuilder 512
    [void][U2]::GetWindowTextW($h, $sb, 512)
    if ($sb.ToString().Length -gt 0) { $script:found += [pscustomobject]@{ hwnd = [int64]$h; pid = $procId; title = $sb.ToString() } }
  }
  return $true
}
[void][U2]::EnumWindows($cbTop, [IntPtr]::Zero)

$report = @()
foreach ($w in $found) {
  $script:kids = @()
  $cbChild = [U2+EnumProc]{
    param($ch, $l)
    $cls = New-Object System.Text.StringBuilder 256
    [void][U2]::GetClassNameW($ch, $cls, 256)
    $tb = New-Object System.Text.StringBuilder 256
    [void][U2]::GetWindowTextW($ch, $tb, 256)
    $script:kids += [pscustomobject]@{ hwnd = [int64]$ch; cls = $cls.ToString(); text = $tb.ToString(); vis = [U2]::IsWindowVisible($ch) }
    return $true
  }
  [void][U2]::EnumChildWindows([IntPtr]$w.hwnd, $cbChild, [IntPtr]::Zero)
  $match = $script:kids | Where-Object { $_.text -eq $target } | Select-Object -First 1
  if (-not $match) { $match = $script:kids | Where-Object { $_.cls -like '*BUTTON*' -and $_.text -ne '' } | Select-Object -Last 1 }
  $clicked = $false
  if ($match) { [void][U2]::SendMessage([IntPtr]$match.hwnd, 0x00F5, [IntPtr]::Zero, [IntPtr]::Zero); $clicked = $true }
  $report += [pscustomobject]@{
    window = $w.title
    clicked = $clicked
    clickedText = $(if ($match) { $match.text } else { $null })
    childCount = $script:kids.Count
    children = @($script:kids | Where-Object { $_.text -ne '' } | Select-Object -First 25 | ForEach-Object { "$($_.cls) :: $($_.text)" })
  }
}
$report | ConvertTo-Json -Depth 4 | Set-Content -LiteralPath 'C:\XjyResults\click2.json' -Encoding UTF8
Write-Output 'DONE'
