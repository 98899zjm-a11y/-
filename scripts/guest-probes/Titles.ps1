Add-Type @"
using System;
using System.Text;
using System.Runtime.InteropServices;
public class TW {
  public delegate bool EnumProc(IntPtr h, IntPtr l);
  [DllImport("user32.dll")] public static extern bool EnumWindows(EnumProc cb, IntPtr l);
  [DllImport("user32.dll", CharSet=CharSet.Unicode)] public static extern int GetWindowTextW(IntPtr h, StringBuilder s, int n);
  [DllImport("user32.dll")] public static extern bool IsWindowVisible(IntPtr h);
  [DllImport("user32.dll")] public static extern uint GetWindowThreadProcessId(IntPtr h, out uint pid);
}
"@
$rows = New-Object System.Collections.ArrayList
$cb = [TW+EnumProc]{
  param($h, $l)
  $sb = New-Object System.Text.StringBuilder 512
  [void][TW]::GetWindowTextW($h, $sb, 512)
  $t = $sb.ToString()
  if ($t.Length -gt 0) {
    $p = 0
    [void][TW]::GetWindowThreadProcessId($h, [ref]$p)
    $codes = ($t.ToCharArray() | ForEach-Object { '0x{0:X4}' -f [int]$_ }) -join ' '
    [void]$rows.Add([ordered]@{ pid = $p; vis = [TW]::IsWindowVisible($h); len = $t.Length; hex = $codes })
  }
  return $true
}
[void][TW]::EnumWindows($cb, [IntPtr]::Zero)
$json = '[' + (($rows | ForEach-Object { $_ | ConvertTo-Json -Compress }) -join ',') + ']'
Set-Content -LiteralPath 'C:\XjyResults\titles.json' -Value $json -Encoding ASCII
Write-Output $json
