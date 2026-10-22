#requires -version 5.1
<#
  host-check.ps1  --  xjy in-app upgrade acceptance: HOST side, READ ONLY.

  Verifies the release point that the host LAN feed is published from:
    catalog.json + package.zip              (patch / catalog channel)
    native-manifest.json + native-package.zip (native full-program channel)

  What it does (never writes to the release point, never starts or stops anything):
    1. size + sha256 of the four files
    2. catalog envelope     : Ed25519 signature, sequence/version/expiry/archive digest
    3. native-manifest      : Ed25519 signature, sequence/targetVersion/engineVersion/expiry/archive digest
    4. binding chain        : native-package.zip -> engine-native170-binding.json
                              -> native.targetEnvelope.catalog (sha256 + Ed25519)
    5. cross checks         : versions, expiry, optional served copy under %APPDATA%

  Ed25519 is not available in PowerShell 5.1 / .NET Framework, so signature work is
  delegated to verify-sig.cjs run by node (E:\node\node.exe by default).

  Usage:
    powershell -NoProfile -ExecutionPolicy Bypass -File .\host-check.ps1
    powershell -NoProfile -ExecutionPolicy Bypass -File .\host-check.ps1 -ReleaseDir "F:\..." -NoZip

  Exit code: 0 = every check passed, 1 = at least one check failed.
#>
[CmdletBinding()]
param(
  [string]$ReleaseDir = '',
  [string]$PublicPem  = 'D:\Codex\xjy-release-20261022\candidate\proposal\worker-draft\publisher-public.pem',
  [string]$NodeExe    = 'E:\node\node.exe',
  [string]$VerifyScript = '',
  [string]$JsonOut    = '',
  [string[]]$ServedDir = @(),
  [switch]$NoZip
)

$ErrorActionPreference = 'Continue'
$ProgressPreference    = 'SilentlyContinue'
$WarningPreference     = 'SilentlyContinue'

# ---------------------------------------------------------------- helpers ----
function CN {
  param([int[]]$C)
  -join ($C | ForEach-Object { [char]$_ })
}

$T_PASS     = CN 0x901A,0x8FC7                       # pass
$T_FAIL     = CN 0x4E0D,0x901A,0x8FC7                # fail
$T_WARN     = CN 0x6CE8,0x610F                       # warn
$T_INFO     = 'INFO'
$T_VERDICT  = CN 0x7ED3,0x8BBA                       # verdict
$T_RELEASE  = CN 0x53D1,0x5E03,0x70B9                # release point
$T_FILES    = CN 0x6587,0x4EF6                       # files
$T_SIG      = CN 0x7B7E,0x540D                       # signature
$T_MANIFEST = CN 0x6E05,0x5355                       # manifest
$T_SERVED   = CN 0x670D,0x52A1,0x526F,0x672C         # served copy
$T_SAME     = CN 0x4E00,0x81F4                       # same
$T_DIFF     = CN 0x4E0D,0x4E00,0x81F4                # different
$T_CHAIN    = CN 0x7ED1,0x5B9A,0x94FE                # binding chain

if (-not $ReleaseDir) {
  $ReleaseDir = (CN 0x46,0x3A,0x5C) +                               # F:\
                (CN 0x946B,0x91D1,0x6E90,0x73E0,0x5B9D,0x8D44,0x6599) + (CN 0x5C) +   # XinJinYuan... \
                (CN 0x7A0B,0x5E8F,0x8BBE,0x7F6E) + (CN 0x5C) +                          # program settings \
                (CN 0x5458,0x5DE5,0x5347,0x7EA7)                                        # employee upgrade
}
if (-not $VerifyScript) { $VerifyScript = Join-Path $PSScriptRoot 'verify-sig.cjs' }
if (-not $JsonOut)      { $JsonOut      = Join-Path $PSScriptRoot 'host-check-result.json' }

# ---- publisher public key resolution ----------------------------------------
# The hand-off note names D:\Codex\xjy-release-20261022\candidate\proposal\worker-draft\
# publisher-public.pem, but that folder does not exist on this host (the proposal was
# re-issued as proposal-a17-20261022-093618). The same key is also shipped inside the
# build tree, so resolve it by fingerprint instead of trusting a single hard-coded path.
$PEM_FP  = 'bc6c3d2b42871e42d3eb91371034b410d507a228eeccb1d714acca60e8141b30'
$PEM_DER = '6e8b9cadb59aeb53f30d41f4471f70f644f0dfc7376ffb9d8a4c62defb98458c'
$PemNote = ''

function Get-PemFingerprint {
  param([string]$Path)
  try {
    $raw = & $NodeExe $VerifyScript 'key' $Path 2>&1 | Out-String
    $line = ($raw -split "`r?`n" | Where-Object { $_.Trim().StartsWith('{') } | Select-Object -Last 1)
    if (-not $line) { return $null }
    $o = $line | ConvertFrom-Json
    if ($o.ok -ne $true) { return $null }
    return $o
  } catch { return $null }
}

if (-not ($PublicPem -and (Test-Path -LiteralPath $PublicPem -PathType Leaf))) {
  $TriedPem = $PublicPem
  $PublicPem = $null
  $candRoot = 'D:\Codex\xjy-release-20261022\candidate'
  $probe = New-Object System.Collections.Generic.List[string]
  if (Test-Path -LiteralPath $candRoot -PathType Container) {
    foreach ($d in (Get-ChildItem -LiteralPath $candRoot -Directory -ErrorAction SilentlyContinue)) {
      foreach ($rel in @('worker-draft\publisher-public.pem',
                         'fresh-material-draft\publisher-public.pem',
                         ('build\package\' + (CN 0x53D7,0x4FE1,0x52A9,0x624B) + '\publisher-public.pem'),
                         ('build\package\' + (CN 0x8865,0x4E01,0x6587,0x4EF6) + '\publisher-public.pem'))) {
        $p = Join-Path $d.FullName $rel
        if (Test-Path -LiteralPath $p -PathType Leaf) { $probe.Add($p) }
      }
    }
  }
  $fallback = $null
  foreach ($p in $probe) {
    $fi2 = Get-PemFingerprint $p
    if ($fi2 -and $fi2.pemSha256 -eq $PEM_FP) { $PublicPem = $p; break }
    if (-not $fallback -and $fi2) { $fallback = $p }
  }
  if (-not $PublicPem -and $fallback) { $PublicPem = $fallback }
  if ($PublicPem) {
    $PemNote = 'requested path not found: ' + $TriedPem + "`nresolved        : " + $PublicPem
  } else {
    $PublicPem = $TriedPem
    $PemNote = 'NOT FOUND: ' + $TriedPem + ' (searched candidate/*/{worker-draft,fresh-material-draft,build/package/*})'
  }
}

$script:rows = New-Object System.Collections.Generic.List[object]

function Add-Row {
  param([string]$Id, [string]$Level, [string]$Title, [string]$Detail, [object]$Data = $null)
  $script:rows.Add([pscustomobject]@{ Id = $Id; Level = $Level; Title = $Title; Detail = $Detail; Data = $Data })
  $tag = switch ($Level) { 'PASS' { '[PASS]' } 'FAIL' { '[FAIL]' } 'WARN' { '[WARN]' } default { '[INFO]' } }
  Write-Host ("{0} {1,-6} {2}" -f $tag, $Id, $Title)
  if ($Detail) { foreach ($line in ($Detail -split "`n")) { if ($line -ne '') { Write-Host ("          " + $line) } } }
}

function Test-Row { param([string]$Id, [string]$Title, [bool]$Cond, [string]$DetailOk, [string]$DetailBad, [object]$Data = $null)
  if ($Cond) { Add-Row $Id 'PASS' $Title $DetailOk $Data } else { Add-Row $Id 'FAIL' $Title $DetailBad $Data }
}

function Get-Sha256 {
  param([string]$Path)
  if (-not (Test-Path -LiteralPath $Path -PathType Leaf)) { return $null }
  return (Get-FileHash -LiteralPath $Path -Algorithm SHA256).Hash.ToLowerInvariant()
}

function Invoke-Verifier {
  param([string]$Mode, [string]$Path)
  if (-not (Test-Path -LiteralPath $NodeExe))     { return [pscustomobject]@{ ok = $false; error = "node not found: $NodeExe" } }
  if (-not (Test-Path -LiteralPath $VerifyScript)) { return [pscustomobject]@{ ok = $false; error = "verifier not found: $VerifyScript" } }
  $raw = & $NodeExe $VerifyScript $Mode $Path $PublicPem 2>&1 | Out-String
  $line = ($raw -split "`r?`n" | Where-Object { $_.Trim().StartsWith('{') } | Select-Object -Last 1)
  if (-not $line) { return [pscustomobject]@{ ok = $false; error = "verifier produced no JSON: $($raw.Trim())" } }
  try { return ($line | ConvertFrom-Json) } catch { return [pscustomobject]@{ ok = $false; error = "bad verifier JSON: $line" } }
}

function Format-MB { param([long]$Bytes) return ('{0:N0} bytes ({1:N1} MB)' -f $Bytes, ($Bytes / 1MB)) }

# ---------------------------------------------------------------- banner -----
Write-Host ''
Write-Host ('=== ' + $T_RELEASE + ' ' + $T_FILES + ' / ' + $T_SIG + ' / ' + $T_MANIFEST + ' ===')
Write-Host ('    dir  : ' + $ReleaseDir)
Write-Host ('    pem  : ' + $PublicPem)
Write-Host ('    node : ' + $NodeExe)
Write-Host ('    time : ' + (Get-Date).ToString('yyyy-MM-dd HH:mm:ss zzz'))
Write-Host ''

$names = @('catalog.json', 'package.zip', 'native-manifest.json', 'native-package.zip')
$paths = @{}
foreach ($n in $names) { $paths[$n] = Join-Path $ReleaseDir $n }

# ---- 0. public key ----------------------------------------------------------
$keyInfo = $null
if (Test-Path -LiteralPath $PublicPem -PathType Leaf) {
  $keyInfo = Get-PemFingerprint $PublicPem
  $kpOk = ($keyInfo -and $keyInfo.pemSha256 -eq $PEM_FP)
  Test-Row 'K-1' 'publisher public key fingerprint (client pins this value)' $kpOk `
    ('ed25519, pemSha256 ' + $PEM_FP + "`n" + $PublicPem) `
    ('WRONG KEY: ' + $(if ($keyInfo) { $keyInfo.pemSha256 } else { 'unreadable' }) + "`n" + $PublicPem) `
    $keyInfo
} else {
  Add-Row 'K-1' 'FAIL' 'publisher public key' ('not readable: ' + $PublicPem + "`n" + $PemNote)
}
if ($PemNote) { Add-Row 'K-2' 'WARN' 'public key path was re-resolved' $PemNote }

# ---- 1. the four files ------------------------------------------------------
$fileData = @{}
foreach ($n in $names) {
  $p = $paths[$n]
  if (Test-Path -LiteralPath $p -PathType Leaf) {
    $fi = Get-Item -LiteralPath $p
    $sha = Get-Sha256 $p
    $fileData[$n] = [pscustomobject]@{ name = $n; path = $p; exists = $true; bytes = $fi.Length; sha256 = $sha; modified = $fi.LastWriteTime.ToString('yyyy-MM-dd HH:mm:ss') }
    Add-Row ('F-' + ([array]::IndexOf($names, $n) + 1)) 'INFO' ($n) ("size   : " + (Format-MB $fi.Length) + "`nsha256 : " + $sha + "`nmtime  : " + $fi.LastWriteTime.ToString('yyyy-MM-dd HH:mm:ss'))
  } else {
    $fileData[$n] = [pscustomobject]@{ name = $n; path = $p; exists = $false; bytes = 0; sha256 = $null; modified = $null }
    Add-Row ('F-' + ([array]::IndexOf($names, $n) + 1)) 'FAIL' ($n) ('MISSING: ' + $p)
  }
}
$missing = @($fileData.Values | Where-Object { -not $_.exists })
Test-Row 'F-OK' ('all four release files present') ($missing.Count -eq 0) ('4/4 present, total ' + (Format-MB (($fileData.Values | Measure-Object -Property bytes -Sum).Sum))) ('missing: ' + (($missing | ForEach-Object { $_.name }) -join ', ')) $missing

# ---- 2. catalog envelope ----------------------------------------------------
$catalogEnv = $null
$catalog    = $null
$catalogSig = $null
if ($fileData['catalog.json'].exists) {
  try {
    $catalogEnv = Get-Content -LiteralPath $paths['catalog.json'] -Raw -Encoding UTF8 | ConvertFrom-Json
    if ($catalogEnv.catalog -is [string]) { $catalog = $catalogEnv.catalog | ConvertFrom-Json }
    else { $catalog = $catalogEnv.catalog }
  } catch {
    Add-Row 'C-0' 'FAIL' 'catalog.json parse' ('cannot parse envelope: ' + $_.Exception.Message)
  }
}

if ($catalog) {
  Add-Row 'C-1' 'INFO' 'catalog fields' (
    'version       : ' + $catalog.version + "`n" +
    'sequence      : ' + $catalog.sequence + "`n" +
    'channel       : ' + $catalog.channel + "`n" +
    'sourceVersions: ' + (($catalog.sourceVersions) -join ',') + "`n" +
    'publishedAt   : ' + $catalog.publishedAt + "`n" +
    'expiresAt     : ' + $catalog.expiresAt + "`n" +
    'files         : ' + $catalog.files.Count + "`n" +
    'targetVersion : (absent in catalog; it lives in native-manifest / inner target catalog)' + "`n" +
    'engineVersion : (absent in catalog; it lives in native-manifest)')

  $catalogSig = Invoke-Verifier 'envelope' $paths['catalog.json']
  Test-Row 'C-2' ('catalog ' + $T_SIG + ' (Ed25519)') ($catalogSig.ok -eq $true) `
    ('verified; payload sha256 ' + $catalogSig.payloadSha256 + ', key ' + $catalogSig.keyType) `
    ('signature REJECTED: ' + $catalogSig.error) $catalogSig

  # archive digest binds package.zip to the signed catalog
  $pkg = $fileData['package.zip']
  $archOk = ($pkg.exists -and $pkg.bytes -eq $catalog.archive.size -and $pkg.sha256 -eq $catalog.archive.sha256)
  Test-Row 'C-3' 'package.zip matches catalog.archive' $archOk `
    ('size+sha256 identical to signed catalog archive (' + (Format-MB $pkg.bytes) + ')') `
    ('MISMATCH: on disk ' + (Format-MB $pkg.bytes) + ' / ' + $pkg.sha256 + ' vs signed ' + $catalog.archive.size + ' / ' + $catalog.archive.sha256) `
    ([pscustomobject]@{ diskBytes = $pkg.bytes; diskSha256 = $pkg.sha256; signedBytes = $catalog.archive.size; signedSha256 = $catalog.archive.sha256 })

  $expOk = $true
  try { $expOk = ([datetime]$catalog.expiresAt).ToUniversalTime() -gt (Get-Date).ToUniversalTime() } catch { $expOk = $false }
  Test-Row 'C-4' 'catalog not expired' $expOk ('expires ' + $catalog.expiresAt + ' (still valid)') ('EXPIRED at ' + $catalog.expiresAt)
}

# ---- 3. native manifest -----------------------------------------------------
$manifestEnv = $null
$manifest    = $null
$manifestSig = $null
if ($fileData['native-manifest.json'].exists) {
  try {
    $manifestEnv = Get-Content -LiteralPath $paths['native-manifest.json'] -Raw -Encoding UTF8 | ConvertFrom-Json
    if ($manifestEnv.manifest -is [string]) { $manifest = $manifestEnv.manifest | ConvertFrom-Json } else { $manifest = $manifestEnv.manifest }
  } catch {
    Add-Row 'N-0' 'FAIL' 'native-manifest.json parse' ('cannot parse envelope: ' + $_.Exception.Message)
  }
}

if ($manifest) {
  Add-Row 'N-1' 'INFO' 'native-manifest fields' (
    'targetVersion : ' + $manifest.targetVersion + "`n" +
    'engineVersion : ' + $manifest.engineVersion + "`n" +
    'sequence      : ' + $manifest.sequence + "`n" +
    'purpose       : ' + $manifest.purpose + "`n" +
    'app/role      : ' + $manifest.app + ' / ' + $manifest.role + "`n" +
    'publishedAt   : ' + $manifest.publishedAt + "`n" +
    'expiresAt     : ' + $manifest.expiresAt + "`n" +
    'files         : ' + $manifest.files.Count + "`n" +
    'bindingSha256 : ' + $manifest.bindingSha256 + "`n" +
    'targetCatSha  : ' + $manifest.fullTargetCatalogSha256)

  $manifestSig = Invoke-Verifier 'envelope' $paths['native-manifest.json']
  Test-Row 'N-2' ('native-manifest ' + $T_SIG + ' (Ed25519)') ($manifestSig.ok -eq $true) `
    ('verified; payload sha256 ' + $manifestSig.payloadSha256) `
    ('signature REJECTED: ' + $manifestSig.error) $manifestSig

  # the three field pins the live 1.7.0 employee client enforces
  $pinOk = ($manifest.purpose -eq 'xjy-native-employee-update-v1' -and $manifest.app -eq 'xjy-jewelry-offline' -and
            $manifest.role -eq 'employee' -and $manifest.targetVersion -eq '1.7.0' -and $manifest.engineVersion -eq '44.9.0' -and
            [int]$manifest.sequence -ge 1)
  Test-Row 'N-3' 'client identity pins (purpose/app/role/target=1.7.0/engine=44.9.0)' $pinOk `
    'all pins match what the shipped 1.7.0 employee client accepts' `
    'pins do NOT match; client would answer BAD_NATIVE_MANIFEST' `
    ([pscustomobject]@{ purpose = $manifest.purpose; app = $manifest.app; role = $manifest.role; targetVersion = $manifest.targetVersion; engineVersion = $manifest.engineVersion })

  $nativePkg = $fileData['native-package.zip']
  $nArchOk = ($nativePkg.exists -and $nativePkg.bytes -eq $manifest.archive.size -and $nativePkg.sha256 -eq $manifest.archive.sha256)
  Test-Row 'N-4' 'native-package.zip matches manifest.archive' $nArchOk `
    ('size+sha256 identical to signed manifest archive (' + (Format-MB $nativePkg.bytes) + ')') `
    ('MISMATCH: on disk ' + (Format-MB $nativePkg.bytes) + ' / ' + $nativePkg.sha256 + ' vs signed ' + $manifest.archive.size + ' / ' + $manifest.archive.sha256) `
    ([pscustomobject]@{ diskBytes = $nativePkg.bytes; diskSha256 = $nativePkg.sha256; signedBytes = $manifest.archive.size; signedSha256 = $manifest.archive.sha256 })

  $nExpOk = $true
  try { $nExpOk = ([datetime]$manifest.expiresAt).ToUniversalTime() -gt (Get-Date).ToUniversalTime() } catch { $nExpOk = $false }
  Test-Row 'N-5' 'native-manifest not expired' $nExpOk ('expires ' + $manifest.expiresAt + ' (still valid)') ('EXPIRED at ' + $manifest.expiresAt)

  # fixed worker pin enforced by the client
  $workerName = (CN 0x946B,0x91D1,0x6E90,0x73E0,0x5B9D,0x62A5,0x4EF7) + '.exe'
  $worker = $manifest.files | Where-Object { $_.path -like ('*/' + $workerName) } | Select-Object -First 1
  if (-not $worker) {
    $worker = $manifest.files | Where-Object { $_.sha256 -eq 'db3ad2066a55546f9b6737da3c7f011370e4856fb36888055b544d45653e4f40' } | Select-Object -First 1
  }
  Test-Row 'N-6' 'fixed maintenance worker pin (sha db3ad206...)' ($null -ne $worker -and $worker.sha256 -eq 'db3ad2066a55546f9b6737da3c7f011370e4856fb36888055b544d45653e4f40' -and $worker.size -eq 246302720) `
    'worker entry present with the exact size+sha256 the client demands' `
    'worker entry missing or not pinned to the 44.7.0 build the client demands' `
    ([pscustomobject]@{ path = $worker.path; size = $worker.size; sha256 = $worker.sha256 })
}

# ---- 4. binding chain inside native-package.zip ------------------------------
$bindResult = $null
if (-not $NoZip -and $fileData['native-package.zip'].exists -and $manifest) {
  $tmp = Join-Path $env:TEMP ('s6-binding-' + [guid]::NewGuid().ToString('N') + '.json')
  try {
    Add-Type -AssemblyName System.IO.Compression.FileSystem -ErrorAction Stop
    $zip = [System.IO.Compression.ZipFile]::OpenRead($paths['native-package.zip'])
    try {
      $entry = $zip.Entries | Where-Object { $_.FullName -eq 'engine-native170-binding.json' } | Select-Object -First 1
      if (-not $entry) { throw 'engine-native170-binding.json not present in native-package.zip' }
      $ms = New-Object System.IO.MemoryStream
      $st = $entry.Open(); $st.CopyTo($ms); $st.Close()
      [System.IO.File]::WriteAllBytes($tmp, $ms.ToArray())
      $bindBytes = $ms.ToArray()
      $bindSha = (Get-FileHash -LiteralPath $tmp -Algorithm SHA256).Hash.ToLowerInvariant()

      Test-Row 'B-1' 'binding.json sha256 == manifest.bindingSha256' ($bindSha -eq $manifest.bindingSha256) `
        ('match: ' + $bindSha) ('MISMATCH: zip entry ' + $bindSha + ' vs manifest ' + $manifest.bindingSha256) `
        ([pscustomobject]@{ zipEntrySha256 = $bindSha; manifestBindingSha256 = $manifest.bindingSha256; bytes = $bindBytes.Length })

      $bindSig = Invoke-Verifier 'binding' $tmp
      Test-Row 'B-2' ('inner target catalog ' + $T_SIG + ' (Ed25519)') ($bindSig.ok -eq $true) `
        ('verified; inner target catalog sha256 ' + $bindSig.payloadSha256) `
        ('inner signature REJECTED: ' + $bindSig.error) $bindSig

      Test-Row 'B-3' 'inner target catalog sha256 == manifest.fullTargetCatalogSha256' ($bindSig.payloadSha256 -eq $manifest.fullTargetCatalogSha256) `
        ('match: ' + $bindSig.payloadSha256) `
        ('MISMATCH: inner ' + $bindSig.payloadSha256 + ' vs manifest ' + $manifest.fullTargetCatalogSha256) `
        ([pscustomobject]@{ innerTargetCatalogSha256 = $bindSig.payloadSha256; manifestFullTargetCatalogSha256 = $manifest.fullTargetCatalogSha256 })

      $inner = $bindSig.payload
      if ($inner) {
        Add-Row 'B-4' 'INFO' 'inner target catalog (what the employee installs)' (
          'version : ' + $inner.version + "`n" +
          'sequence: ' + $inner.sequence + "`n" +
          'files   : ' + $inner.fileCount + "`n" +
          'archive : ' + $inner.archiveSize + ' / ' + $inner.archiveSha256)
      }
      $bindResult = $bindSig
    } finally { $zip.Dispose() }
  } catch {
    Add-Row 'B-0' 'FAIL' ('binding chain ' + $T_CHAIN) ('cannot read native-package.zip: ' + $_.Exception.Message)
  } finally {
    if (Test-Path -LiteralPath $tmp) { Remove-Item -LiteralPath $tmp -Force -ErrorAction SilentlyContinue }
  }
} elseif ($NoZip) {
  Add-Row 'B-0' 'WARN' ('binding chain ' + $T_CHAIN) 'skipped by -NoZip'
}

# ---- 5. cross checks --------------------------------------------------------
if ($catalog -and $manifest) {
  $verOk = ($catalog.version -eq $manifest.targetVersion -and $manifest.targetVersion -eq '1.7.0')
  Test-Row 'X-1' 'catalog.version == manifest.targetVersion == 1.7.0' $verOk `
    ($catalog.version + ' / ' + $manifest.targetVersion) ('mismatch: ' + $catalog.version + ' / ' + $manifest.targetVersion)

  Add-Row 'X-2' 'INFO' 'two independent sequence counters (not a defect by itself)' (
    'catalog.sequence        : ' + $catalog.sequence + '   <- patch-catalog channel generation' + "`n" +
    'native-manifest.sequence: ' + $manifest.sequence + '   <- native full-program channel generation' + "`n" +
    'inner target catalog seq: ' + $(if ($bindResult -and $bindResult.payload) { $bindResult.payload.sequence } else { 'n/a' }) + "`n" +
    'employee already accepts up to a stored accepted-sequence.json + a native install receipt;' + "`n" +
    'the native channel only offers work when the published target catalog differs AND its sequence' + "`n" +
    'is not lower than the installed one.')

  $decOk = ($bindResult -and $bindResult.payload -and [int]$bindResult.payload.sequence -eq [int]$manifest.sequence)
  Test-Row 'X-3' 'inner target catalog sequence == native-manifest sequence' ($decOk -eq $true) `
    ('both ' + $manifest.sequence) `
    ('inconsistent: manifest ' + $manifest.sequence + ' vs inner ' + $(if ($bindResult -and $bindResult.payload) { $bindResult.payload.sequence } else { 'n/a' }) + ' -> client answers BAD_NATIVE_MANIFEST')
}

# ---- 6. optional: the copy the LAN feed actually serves ---------------------
$svcName = (CN 0x5458,0x5DE5,0x5347,0x7EA7)   # the folder the host serves from
$served = @()
foreach ($sd in $ServedDir) { if ($sd -and (Test-Path -LiteralPath $sd -PathType Container)) { $served += (Resolve-Path -LiteralPath $sd).Path } }
if ($served.Count -eq 0) {
  foreach ($base in @($env:APPDATA, $env:LOCALAPPDATA, $env:ProgramData)) {
    if (-not $base -or -not (Test-Path -LiteralPath $base -PathType Container)) { continue }
    $direct = Join-Path $base $svcName
    if (Test-Path -LiteralPath $direct -PathType Container) { $served += $direct }
    foreach ($o in (Get-ChildItem -LiteralPath $base -Directory -ErrorAction SilentlyContinue)) {
      $cand = Join-Path $o.FullName $svcName
      if (Test-Path -LiteralPath $cand -PathType Container) { $served += $cand; continue }
      foreach ($o2 in (Get-ChildItem -LiteralPath $o.FullName -Directory -ErrorAction SilentlyContinue)) {
        $cand2 = Join-Path $o2.FullName $svcName
        if (Test-Path -LiteralPath $cand2 -PathType Container) { $served += $cand2 }
      }
    }
  }
}
if ($served.Count -eq 0) {
  Add-Row 'S-1' 'WARN' ($T_SERVED + ' (where the LAN feed is actually served from)') `
    ('no ' + $svcName + ' folder found under %APPDATA%, %LOCALAPPDATA% or %ProgramData%' + "`n" +
     'the four files in the release point are the hand-off copies; the LAN feed serves the host' + "`n" +
     'profile copy, so the host must publish once before the employee can see this release.' + "`n" +
     'if the folder lives elsewhere, re-run with:  -ServedDir "<path to the ' + $svcName + ' folder>"')
} else {
  foreach ($d in $served) {
    $lines = New-Object System.Collections.Generic.List[string]
    $same = $true
    foreach ($n in $names) {
      $sp = Join-Path $d $n
      if (-not (Test-Path -LiteralPath $sp -PathType Leaf)) { $lines.Add('  missing : ' + $n); $same = $false; continue }
      $ssha = Get-Sha256 $sp
      $rs   = $fileData[$n].sha256
      $eq   = ($ssha -eq $rs)
      if (-not $eq) { $same = $false }
      $lines.Add(('  {0,-20} {1} {2}' -f $n, $(if ($eq) { $T_SAME } else { $T_DIFF }), $ssha))
    }
    Test-Row ('S-1') ($T_SERVED + ': ' + $d) $same ('all four identical to the release point') ('served copy differs from the release point; the employee would see the OLD publication') ($lines -join "`n")
  }
}

# ---- footer -----------------------------------------------------------------
$fails = @($script:rows | Where-Object { $_.Level -eq 'FAIL' })
$warns = @($script:rows | Where-Object { $_.Level -eq 'WARN' })
$passes = @($script:rows | Where-Object { $_.Level -eq 'PASS' })

Write-Host ''
Write-Host ('--- ' + $T_VERDICT + ' ---')
Write-Host ('    PASS {0}   WARN {1}   FAIL {2}' -f $passes.Count, $warns.Count, $fails.Count)
if ($fails.Count -eq 0) {
  Write-Host ('    ' + $T_PASS + ': release point is self-consistent (files, signatures, binding chain, pins).')
} else {
  Write-Host ('    ' + $T_FAIL + ':')
  foreach ($f in $fails) { Write-Host ('      - ' + $f.Id + '  ' + $f.Title) }
}

function Trim-Obj {
  param($Obj, [string[]]$Drop)
  if ($null -eq $Obj) { return $null }
  $h = [ordered]@{}
  foreach ($pr in $Obj.PSObject.Properties) {
    if ($Drop -contains $pr.Name) { continue }
    $h[$pr.Name] = $pr.Value
  }
  [pscustomobject]$h
}

$payload = [pscustomobject]@{
  schemaVersion = 1
  generatedAt   = (Get-Date).ToString('o')
  host          = $env:COMPUTERNAME
  releaseDir    = $ReleaseDir
  publicPem     = $PublicPem
  nodeExe       = $NodeExe
  files         = ($names | ForEach-Object { $fileData[$_] })
  catalog       = $(if ($catalog) { $c = Trim-Obj $catalog @('files'); $c | Add-Member -NotePropertyName fileCount -NotePropertyValue $catalog.files.Count -Force; $c } else { $null })
  nativeManifest = $(if ($manifest) { $m = Trim-Obj $manifest @('files'); $m | Add-Member -NotePropertyName fileCount -NotePropertyValue $manifest.files.Count -Force; $m } else { $null })
  innerTargetCatalog = $(if ($bindResult -and $bindResult.payload) { $t = Trim-Obj $bindResult.payload @('files'); $t | Add-Member -NotePropertyName fileCount -NotePropertyValue $bindResult.payload.files.Count -Force; $t } else { $null })
  signature     = [pscustomobject]@{
    catalogVerified = $(if ($catalogSig) { $catalogSig.ok } else { $null })
    manifestVerified = $(if ($manifestSig) { $manifestSig.ok } else { $null })
    innerVerified    = $(if ($bindResult) { $bindResult.ok } else { $null })
    publicKeySha256  = $(if ($catalogSig) { $catalogSig.pemSha256 } else { $null })
    publicKeyDerSha256 = $(if ($catalogSig) { $catalogSig.derSha256 } else { $null })
  }
  checks        = $script:rows
  summary       = [pscustomobject]@{ pass = $passes.Count; warn = $warns.Count; fail = $fails.Count; ok = ($fails.Count -eq 0) }
}
try {
  $json = $payload | ConvertTo-Json -Depth 12
  [System.IO.File]::WriteAllText($JsonOut, $json, (New-Object System.Text.UTF8Encoding($false)))
  Write-Host ('    json: ' + $JsonOut)
} catch {
  Write-Host ('    [WARN] cannot write json: ' + $_.Exception.Message)
}

if ($fails.Count -eq 0) { exit 0 } else { exit 1 }
