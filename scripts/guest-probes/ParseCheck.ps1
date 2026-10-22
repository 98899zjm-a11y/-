$ErrorActionPreference = 'Continue'
$target = 'C:\XjyReleaseResults\Probe2Verify.ps1'
$out = 'C:\XjyReleaseResults\parse.log'
$lines = @()
$bytes = [System.IO.File]::ReadAllBytes($target)
$lines += ('bytes=' + $bytes.Length)
$lines += ('first3=' + ($bytes[0..2] -join ','))
$raw = [System.Text.Encoding]::UTF8.GetString($bytes)
$lines += ('rawlen=' + $raw.Length)
$lines += ('head=' + $raw.Substring(0, [Math]::Min(120, $raw.Length)).Replace("`r", '|').Replace("`n", '/'))
$errs = $null
$null = [System.Management.Automation.Language.Parser]::ParseFile($target, [ref]$null, [ref]$errs)
if ($errs -and $errs.Count -gt 0) {
  $lines += ('errors=' + $errs.Count)
  foreach ($e in $errs) { $lines += ($e.Extent.StartLineNumber.ToString() + ':' + $e.Extent.StartColumnNumber.ToString() + ' ' + $e.Message) }
} else {
  $lines += 'PARSE OK'
}
$psv = $PSVersionTable.PSVersion.ToString()
$lines += ('psversion=' + $psv)
$lines | Set-Content -LiteralPath $out -Encoding UTF8
Write-Output 'DONE'
