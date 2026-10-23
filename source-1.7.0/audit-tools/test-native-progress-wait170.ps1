param([Parameter(Mandatory=$true)][string]$InputDirectory,[Parameter(Mandatory=$true)][string]$OutputDirectory)
$ErrorActionPreference='Stop'
Set-StrictMode -Version Latest
$viewPath=Join-Path $InputDirectory 'UpdateProgressView170.ps1'
$templatePath=Join-Path $InputDirectory 'Native-Delivery-170.ps1.in'
if((Get-FileHash -LiteralPath $viewPath).Hash.ToLowerInvariant() -cne '9b872b4ced9f9d915a7e39a95a6e35b7914745d6865295fb17428b26a79856ab'){throw 'view changed'}
if((Get-FileHash -LiteralPath $templatePath).Hash.ToLowerInvariant() -cne '358c1c2074d62fb9fab23f9dd6755c2902ecf22aea9200dd54cc4e70b133ecb4'){throw 'template changed'}
. ([ScriptBlock]::Create([IO.File]::ReadAllText($viewPath,[Text.Encoding]::UTF8)))
$template=[IO.File]::ReadAllText($templatePath,[Text.Encoding]::UTF8)
$start=$template.IndexOf(' $p=[Diagnostics.Process]::Start($psi);')
$end=$template.IndexOf(' if($p.ExitCode -ne 0)')
if($start -lt 0 -or $end -le $start){throw 'exact wait fragment missing'}
$fragment=$template.Substring($start,$end-$start)
$cases=@()
foreach($childExit in @(0,7)){
 $progressView=$null;$timer=$null;$p=$null
 try{
  $progressView=New-XjyProgressView -Stage '正在测试升级等待窗口' -Detail '虚构子进程测试，不安装程序。'
  $progressView.Form.Show()
  $timer=New-Object Windows.Forms.Timer
  $timer.Interval=30;$timer.Tag=@{Count=0}
  $timer.Add_Tick({param($sender,$eventArgs);$sender.Tag.Count++})
  $timer.Start()
  $childSource='[Console]::OutputEncoding=[Text.UTF8Encoding]::new($false);[Threading.Thread]::Sleep(600);[Console]::Out.WriteLine("进度输出");[Console]::Error.WriteLine("测试错误记录");exit '+$childExit
  $psi=New-Object Diagnostics.ProcessStartInfo
  $psi.FileName='C:\Windows\System32\WindowsPowerShell\v1.0\powershell.exe'
  $psi.Arguments='-NoLogo -NoProfile -NonInteractive -EncodedCommand '+[Convert]::ToBase64String([Text.Encoding]::Unicode.GetBytes($childSource))
  $psi.UseShellExecute=$false;$psi.CreateNoWindow=$true;$psi.RedirectStandardOutput=$true;$psi.RedirectStandardError=$true
  $psi.StandardOutputEncoding=[Text.UTF8Encoding]::new($false);$psi.StandardErrorEncoding=[Text.UTF8Encoding]::new($false)
  . ([ScriptBlock]::Create($fragment))
  if($p.ExitCode -ne $childExit -or $timer.Tag.Count -lt 2 -or !$out.Contains('进度输出') -or !$err.Contains('测试错误记录')){throw 'wait/UTF8/exit preservation assertion failed'}
  $cases+=@{exitCode=$p.ExitCode;uiTicks=$timer.Tag.Count;stdoutPreserved=$true;stderrPreserved=$true;passed=$true}
 }finally{if($timer){$timer.Stop();$timer.Dispose()};Close-XjyProgressView -View $progressView;if($p){$p.Dispose()}}
}
[IO.File]::WriteAllText((Join-Path $OutputDirectory 'wait-controls.json'),(@{complete=$true;passed=$true;cases=$cases;actualProcess='Windows PowerShell synthetic output';nativeInstallerExecuted=$false}|ConvertTo-Json -Depth 4),[Text.UTF8Encoding]::new($false))
