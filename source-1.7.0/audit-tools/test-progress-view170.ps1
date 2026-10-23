param([Parameter(Mandatory=$true)][string]$Source,[Parameter(Mandatory=$true)][string]$OutputDirectory)
$ErrorActionPreference='Stop'
Set-StrictMode -Version Latest
if([Threading.Thread]::CurrentThread.ApartmentState -ne 'STA'){throw 'STA required'}
if((Get-FileHash -LiteralPath $Source).Hash.ToLowerInvariant() -cne '9b872b4ced9f9d915a7e39a95a6e35b7914745d6865295fb17428b26a79856ab'){throw 'view source changed'}
. ([ScriptBlock]::Create([IO.File]::ReadAllText($Source,[Text.Encoding]::UTF8)))
$checks=New-Object 'Collections.Generic.List[string]'
function Check([bool]$Value,[string]$Name){if(!$Value){throw ('Assertion failed: '+$Name)};$checks.Add($Name)}
$view=$null
try{
 [Windows.Forms.Application]::EnableVisualStyles()
 $view=New-XjyProgressView -Stage '正在核对升级文件' -Detail '保留原有资料，完成核验后自动继续。'
 $view.Form.Show();[Windows.Forms.Application]::DoEvents()
 Check ($view.Form.Visible -and !$view.Form.IsDisposed) 'visible-native-form'
 Check ($view.TitleLabel.Text -ceq '正在核对升级文件') 'chinese-stage-text'
 Check ($view.ProgressBar.Style -eq [Windows.Forms.ProgressBarStyle]::Marquee) 'unknown-total-no-fake-percentage'
 Set-XjyProgressView -View $view -Stage '正在复制程序' -Detail '已核对 25 / 100 个文件。' -Percent 25
 Check ($view.ProgressBar.Style -eq [Windows.Forms.ProgressBarStyle]::Continuous -and $view.ProgressBar.Value -eq 25) 'known-progress-value'
 foreach($bad in @(-1,101,'bad',25.5)){
  Set-XjyProgressView -View $view -Percent $bad
  Check ($view.ProgressBar.Style -eq [Windows.Forms.ProgressBarStyle]::Marquee) ('invalid-progress-'+$bad)
 }
 Set-XjyProgressView -View $view -Stage '正在校验完整程序' -Detail '请保持窗口打开。完成后将自动启动正确的主机或员工模式。'
 $bmp=New-Object Drawing.Bitmap -ArgumentList $view.Form.Width,$view.Form.Height
 try{$view.Form.DrawToBitmap($bmp,[Drawing.Rectangle]::new(0,0,$bmp.Width,$bmp.Height));$bmp.Save((Join-Path $OutputDirectory 'progress-window.png'),[Drawing.Imaging.ImageFormat]::Png)}finally{$bmp.Dispose()}
 $view.Form.Close();[Windows.Forms.Application]::DoEvents()
 Check (!$view.Form.IsDisposed -and $view.Form.WindowState -eq [Windows.Forms.FormWindowState]::Minimized) 'close-only-minimizes-during-work'
 Close-XjyProgressView -View $view
 Check $view.Form.IsDisposed 'normal-completion-disposes-form'
 Check ($view.Form.Tag.Fonts.Count -eq 0) 'owned-fonts-released'
 Close-XjyProgressView -View $view
 Check $view.Form.IsDisposed 'repeated-cleanup-safe'
 [IO.File]::WriteAllText((Join-Path $OutputDirectory 'controls.json'),(@{complete=$true;passed=$true;checks=@($checks);sourceSha256='9b872b4ced9f9d915a7e39a95a6e35b7914745d6865295fb17428b26a79856ab';nativeInstallerExecuted=$false}|ConvertTo-Json -Depth 4),[Text.UTF8Encoding]::new($false))
}finally{if($null -ne $view){Close-XjyProgressView -View $view}}
