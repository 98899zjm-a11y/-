[CmdletBinding()]
param(
  [switch]$Apply,
  [string]$OutFile = "$env:USERPROFILE\Desktop\xjy-update-cache-diag.json"
)
$ErrorActionPreference = 'Stop'
function J($o){ $o | ConvertTo-Json -Depth 8 }
$result = [ordered]@{
  at = (Get-Date).ToString('o'); computer = $env:COMPUTERNAME; user = $env:USERNAME
  apply = [bool]$Apply; candidates = @(); action = $null; ok = $false; notes = @()
}
function Write-Result {
  $json = J $result
  [System.IO.File]::WriteAllText($OutFile, $json, (New-Object System.Text.UTF8Encoding($false)))
  Write-Output $OutFile
}
# Candidate profile roots: %APPDATA%\<productName>, %APPDATA%\<exe name>, %APPDATA%\xjy-jewelry-offline
$cands = New-Object System.Collections.ArrayList
foreach($n in @('鑫金源珠宝报价','xjy-jewelry-offline','鑫金源珠宝')) {
  [void]$cands.Add((Join-Path $env:APPDATA $n))
}
# Also any sibling under %APPDATA% whose name contains xjy or the product chars
Get-ChildItem $env:APPDATA -Directory -ErrorAction SilentlyContinue | ForEach-Object {
  if($_.Name -match 'xjy|鑫金源'){ [void]$cands.Add($_.FullName) }
}
$seen = @{}
foreach($root in $cands){
  if($seen[$root]){ continue }; $seen[$root]=$true
  $cache = Join-Path $root 'employee-update-cache'
  $entry = [ordered]@{ profileRoot = $root; profileExists = (Test-Path -LiteralPath $root); cachePath = $cache; cacheExists = (Test-Path -LiteralPath $cache); entries = @(); problem = $null }
  if($entry.cacheExists){
    try{
      $items = Get-ChildItem -LiteralPath $cache -Force -ErrorAction Stop
      foreach($it in $items){
        $row = [ordered]@{ name = $it.Name; type = $(if($it.PSIsContainer){'dir'}else{'file'}); size = $(if($it.PSIsContainer){$null}else{$it.Length}); linkCount = $null; attrs = $it.Attributes.ToString() }
        if(-not $it.PSIsContainer){
          try{ $row.linkCount = [int]$it.LinkType }catch{}
          try{
            $h = & "$env:SystemRoot\System32\fsutil.exe" hardlink list $it.FullName 2>$null
            if($LASTEXITCODE -eq 0){ $row.hardlinks = @($h | Where-Object { $_ }) }
          }catch{}
        }
        $entry.entries += $row
      }
      # Determine problem: any non-dir with linkCount>1 (or hardlinked key file), or unexpected names
      $bad = @($entry.entries | Where-Object { $_.type -ne 'dir' -and $_.hardlinks -and @($_.hardlinks).Count -gt 1 })
      if($bad.Count -gt 0){ $entry.problem = 'HARDLINKED_FILE_IN_CACHE' }
      $key = $entry.entries | Where-Object { $_.name -eq '.native-integrity-key' }
      if($key -and $key.type -eq 'dir'){ $entry.problem = 'INTEGRITY_KEY_IS_DIRECTORY' }
    }catch{ $entry.problem = 'READ_FAILED: ' + $_.Exception.Message }
  }
  $result.candidates += $entry
}
if($Apply){
  $targets = @($result.candidates | Where-Object { $_.cacheExists })
  if($targets.Count -eq 0){ $result.notes += 'no cache dir found; nothing to quarantine' }
  $done = @()
  foreach($t in $targets){
    $stamp = (Get-Date).ToString('yyyyMMdd-HHmmss')
    $dst = "$($t.cachePath).quarantine-$stamp"
    try{
      Move-Item -LiteralPath $t.cachePath -Destination $dst -ErrorAction Stop
      $done += [ordered]@{ from = $t.cachePath; to = $dst; ok = $true }
    }catch{
      $done += [ordered]@{ from = $t.cachePath; to = $dst; ok = $false; error = $_.Exception.Message }
    }
  }
  $result.action = $done
  $result.ok = (@($done | Where-Object { -not $_.ok }).Count -eq 0)
} else {
  $result.ok = $true
  $result.notes += 'dry-run; pass -Apply to quarantine the cache directories (renamed, not deleted)'
}
Write-Result
