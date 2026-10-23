<#
  鑫金源珠宝 1.7.0 电脑版 · 一键安装进度视图（Windows PowerShell 5.1 / WinForms 草稿）
  仅视图层，不含安装、签名、恢复等逻辑。本文件请保存为 UTF-8（带 BOM），5.1 才能正确读取中文。
  用法：$v = New-XjyProgressView；$v.Form.Show()；循环中 Set-XjyProgressView -View $v [-Stage ..] [-Detail ..] [-Percent 0..100]；
        结束后必须调用 Close-XjyProgressView -View $v（内部先置 AllowedClose，再释放窗体）。
  未知总量或非法百分比只显示不确定动画，绝不伪造百分比；运行中用户点关闭仅最小化，不终止安装。
#>
function New-XjyProgressView {
    [CmdletBinding()]
    param(
        [string]$Stage = '正在检查新版本，请稍候…',
        [string]$Detail = '请保持本窗口打开；如提示需要退出，请从右下角托盘正常退出。'
    )
    Add-Type -AssemblyName System.Windows.Forms -ErrorAction Stop
    Add-Type -AssemblyName System.Drawing -ErrorAction Stop
    $ivory = [System.Drawing.Color]::FromArgb(252, 249, 243); $wine = [System.Drawing.Color]::FromArgb(122, 31, 43); $ink = [System.Drawing.Color]::FromArgb(53, 50, 46)
    $form = New-Object System.Windows.Forms.Form
    $form.Text = '鑫金源珠宝 1.7.0 电脑版 · 升级'
    $form.ClientSize = New-Object System.Drawing.Size -ArgumentList 520, 230
    $form.StartPosition = [System.Windows.Forms.FormStartPosition]::CenterScreen
    $form.FormBorderStyle = [System.Windows.Forms.FormBorderStyle]::FixedSingle
    $form.MaximizeBox = $false; $form.MinimizeBox = $true; $form.ShowInTaskbar = $true
    $form.BackColor = $ivory; $form.AutoScaleMode = [System.Windows.Forms.AutoScaleMode]::Dpi
    $form.AutoScaleDimensions = New-Object System.Drawing.SizeF -ArgumentList 96, 96
    $form.Tag = @{ AllowedClose = $false }
    $fontTitle = New-Object System.Drawing.Font -ArgumentList 'Microsoft YaHei', ([float]15.0), ([System.Drawing.FontStyle]::Bold), ([System.Drawing.GraphicsUnit]::Point)
    $fontDetail = New-Object System.Drawing.Font -ArgumentList 'Microsoft YaHei', ([float]10.5), ([System.Drawing.FontStyle]::Regular), ([System.Drawing.GraphicsUnit]::Point)
    $form.Tag.Fonts = @($fontTitle, $fontDetail)
    $titleLabel = New-Object System.Windows.Forms.Label
    $titleLabel.Text = $Stage; $titleLabel.ForeColor = $wine; $titleLabel.Font = $fontTitle
    $titleLabel.AutoSize = $false; $titleLabel.TextAlign = [System.Drawing.ContentAlignment]::MiddleLeft
    $titleLabel.Location = New-Object System.Drawing.Point -ArgumentList 20, 24
    $titleLabel.Size = New-Object System.Drawing.Size -ArgumentList 480, 40
    $detailLabel = New-Object System.Windows.Forms.Label
    $detailLabel.Text = $Detail; $detailLabel.ForeColor = $ink; $detailLabel.Font = $fontDetail; $detailLabel.AutoSize = $false
    $detailLabel.Location = New-Object System.Drawing.Point -ArgumentList 20, 76
    $detailLabel.Size = New-Object System.Drawing.Size -ArgumentList 480, 64
    $bar = New-Object System.Windows.Forms.ProgressBar
    $bar.Minimum = 0; $bar.Maximum = 100; $bar.MarqueeAnimationSpeed = 30
    $bar.Style = [System.Windows.Forms.ProgressBarStyle]::Marquee
    $bar.Location = New-Object System.Drawing.Point -ArgumentList 20, 168
    $bar.Size = New-Object System.Drawing.Size -ArgumentList 480, 22
    $form.Controls.AddRange(@($titleLabel, $detailLabel, $bar))
    $form.add_FormClosing({
        param($sender, $eventArgs)
        $state = $sender.Tag
        if ($null -ne $state -and -not $state.AllowedClose) { $eventArgs.Cancel = $true; $sender.WindowState = [System.Windows.Forms.FormWindowState]::Minimized }
    })
    [pscustomobject]@{ Form = $form; TitleLabel = $titleLabel; DetailLabel = $detailLabel; ProgressBar = $bar }
}

function Set-XjyProgressView {
    [CmdletBinding()]
    param(
        [Parameter(Position = 0)][PSObject]$View,
        [string]$Stage,
        [string]$Detail,
        [object]$Percent = $null
    )
    if ($null -eq $View) { return }
    $form = $View.Form
    if ($null -eq $form -or $form.IsDisposed) { return }
    $percentValue = -1
    if ($null -ne $Percent) {
        $parsed = 0
        if ([int]::TryParse([string]$Percent, [ref]$parsed) -and $parsed -ge 0 -and $parsed -le 100) { $percentValue = $parsed }
    }
    try {
        if (-not [string]::IsNullOrWhiteSpace($Stage)) { $View.TitleLabel.Text = $Stage }
        if (-not [string]::IsNullOrWhiteSpace($Detail)) { $View.DetailLabel.Text = $Detail }
        if ($percentValue -ge 0) {
            $View.ProgressBar.Style = [System.Windows.Forms.ProgressBarStyle]::Continuous
            $View.ProgressBar.Value = $percentValue
        } else {
            $View.ProgressBar.Style = [System.Windows.Forms.ProgressBarStyle]::Marquee
        }
        if ($form.Visible) { [System.Windows.Forms.Application]::DoEvents() }
    } catch {
        # 已 Dispose 或控件更新失败：静默返回，不伪造任何状态
    }
}

function Close-XjyProgressView {
    [CmdletBinding()]
    param([Parameter(Position = 0)][PSObject]$View)
    if ($null -eq $View) { return }
    $form = $View.Form
    if ($null -eq $form) { return }
    $state = $form.Tag
    if ($state -is [hashtable]) { $state.AllowedClose = $true }
    if (-not $form.IsDisposed) {
        try { $form.Close() } catch { }
        try { if (-not $form.IsDisposed) { $form.Dispose() } } catch { }
        foreach ($ownedFont in $state.Fonts) { if ($null -ne $ownedFont) { $ownedFont.Dispose() } }
        $state.Fonts = @()
    }
}