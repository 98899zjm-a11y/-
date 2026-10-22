Add-Type -AssemblyName System.Windows.Forms
Add-Type @"
using System;
using System.Text;
using System.Runtime.InteropServices;
public class AW {
  public delegate bool EnumProc(IntPtr h, IntPtr l);
  [DllImport("user32.dll")] public static extern bool EnumWindows(EnumProc cb, IntPtr l);
  [DllImport("user32.dll")] public static extern bool EnumChildWindows(IntPtr h, EnumProc cb, IntPtr l);
  [DllImport("user32.dll", CharSet=CharSet.Unicode)] public static extern int GetWindowTextW(IntPtr h, StringBuilder s, int n);
  [DllImport("user32.dll", CharSet=CharSet.Unicode)] public static extern int GetClassNameW(IntPtr h, StringBuilder s, int n);
  [DllImport("user32.dll")] public static extern bool IsWindowVisible(IntPtr h);
  [DllImport("user32.dll")] public static extern uint GetWindowThreadProcessId(IntPtr h, out uint pid);
  [DllImport("user32.dll", CharSet=CharSet.Unicode)] public static extern IntPtr SendMessageW(IntPtr h, uint msg, IntPtr wp, IntPtr lp);
  [DllImport("user32.dll")] public static extern IntPtr SendMessage(IntPtr h, uint msg, IntPtr wp, IntPtr lp);
}
"@
function Text($h) { $sb = New-Object System.Text.StringBuilder 512; [void][AW]::GetWindowTextW($h, $sb, 512); $sb.ToString() }
function Cls($h) { $sb = New-Object System.Text.StringBuilder 256; [void][AW]::GetClassNameW($h, $sb, 256); $sb.ToString() }

$approve = [string][char]0x91CD + [char]0x590D + [char]0x5347 + [char]0x7EA7 + [char]0x5BA1 + [char]0x5B9A
$confirm = [string][char]0x8D1F + [char]0x8D23 + [char]0x4EBA + [char]0x6700 + [char]0x7EC8 + [char]0x786E + [char]0x8BA4
$btnApprove = [string][char]0x5F00 + [char]0x59CB + [char]0x6838 + [char]0x9A8C + [char]0x5E76 + [char]0x5B89 + [char]0x88C5
$btnYes = [string][char]0x662F
$failDlg = [string][char]0x5B89 + [char]0x88C5 + [char]0x6216 + [char]0x5347 + [char]0x7EA7 + [char]0x672A + [char]0x5B8C + [char]0x6210

$result = [ordered]@{ action = 'none'; title = ''; clicked = '' }
$script:found = $null
$cb = [AW+EnumProc]{
  param($h, $l)
  if ([AW]::IsWindowVisible($h)) {
    $t = Text $h
    if ($t.EndsWith($approve) -or $t.EndsWith($confirm)) { $script:found = @{ hwnd = $h; title = $t }; return $false }
  }
  return $true
}
[void][AW]::EnumWindows($cb, [IntPtr]::Zero)

if ($null -ne $script:found) {
  $top = $script:found.hwnd
  $result.title = $script:found.title
  $target = $null
  $cb2 = [AW+EnumProc]{
    param($h, $l)
    $t = Text $h
    if ($script:found.title.EndsWith($approve) -and $t -eq $btnApprove) { $script:target = @{ hwnd = $h; text = $t }; return $false }
    if ($script:found.title.EndsWith($confirm) -and $t.StartsWith($btnYes)) { $script:target = @{ hwnd = $h; text = $t }; return $false }
    return $true
  }
  [void][AW]::EnumChildWindows($top, $cb2, [IntPtr]::Zero)
  if ($null -ne $script:target) {
    [void][AW]::SendMessage($script:target.hwnd, 0x00F5, [IntPtr]::Zero, [IntPtr]::Zero)
    $result.action = 'clicked'
    $result.clicked = $script:target.text
  } else {
    $result.action = 'no-button'
  }
}
if ($result.action -eq 'none') {
  $script:failWin = $false
  $cb3 = [AW+EnumProc]{
    param($h, $l)
    if ([AW]::IsWindowVisible($h) -and (Text $h) -eq $failDlg) { $script:failWin = $true; return $false }
    return $true
  }
  [void][AW]::EnumWindows($cb3, [IntPtr]::Zero)
  if ($script:failWin) { $result.action = 'fail-dialog' }
}
$result | ConvertTo-Json -Compress | Set-Content -LiteralPath 'C:\XjyResults\autoclick.json' -Encoding ASCII
Write-Output ($result | ConvertTo-Json -Compress)

