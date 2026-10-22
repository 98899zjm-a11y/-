# =============================================================================
# verify-production.ps1  --  S5 post-upgrade READ-ONLY verification (1.7.0 host)
# -----------------------------------------------------------------------------
# Mirrors the shipped runtime gate (project\desktop\engine-startup-gate.cjs):
#   * state dir      = <parent of install dir>\.<install dir name>.xjy-engine-state
#   * journal.json   = {payload, mac}, mac = HMAC-SHA256(journal-key.bin, UTF8(payload))
#   * startup status = {payload, mac}, mac = HMAC-SHA256(key,
#                      UTF8("xjy-engine-startup-v1\0" + payload))
#   * target-catalog-envelope.json = {catalog, signature} with an Ed25519
#     signature over the catalog string, verified against publisher-public.pem
#     whose SPKI DER sha256 must equal the pinned publisher key hash.
#   * journal phase must be committed + rollbackForbidden, version file 44.9.0,
#     activation exactly {version,product,programVersion,role,installationDir}.
#   * every journal targetFiles entry is re-hashed from the install dir.
#   * businessReleased: false means "engine committed, business release still
#     held" (ENGINE_STARTUP_HELD) -> exit 2, NOT a corruption.
# This script NEVER writes to F:\ ; it only writes JSON into <tools>\out and a
# small Ed25519 helper .cjs next to itself.
# Exit codes:
#   0 = every check passed AND businessReleased=true
#   2 = structure/chain all correct but businessReleased=false (held: start the
#       1.7.0 program once so the installer can release the business)
#   1 = at least one check FAILED (do not proceed, keep the scene, read Recover)
#   3 = -Baseline mode: pre-upgrade state is as expected (nothing done yet)
# =============================================================================
[CmdletBinding()]
param(
    [string]$InstallDir = '',
    [string]$DataDir = '',
    [string]$OutDir = '',
    [string]$Stamp = '',
    [string]$PemPath = '',
    [string]$NodePath = '',
    [switch]$SkipFileHashes,
    [switch]$SkipSignatureVerify,
    [switch]$Baseline
)

$ErrorActionPreference = 'Stop'

# U+81EA U+5236 U+8F6F U+4EF6 = "self-made software"
# U+946B U+91D1 U+6E90 U+73E0 U+5B9D = product short name ; + U+8D44 U+6599 = data folder
function U([int[]]$cp) { -join ($cp | ForEach-Object { [char]$_ }) }
$W_SOFT = U @(0x81EA, 0x5236, 0x8F6F, 0x4EF6)
$W_JEW  = U @(0x946B, 0x91D1, 0x6E90, 0x73E0, 0x5B9D)
$W_DATA = U @(0x946B, 0x91D1, 0x6E90, 0x73E0, 0x5B9D, 0x8D44, 0x6599)
$W_WORKER = U @(0x53D7, 0x4FE1, 0x52A9, 0x624B)

if ([string]::IsNullOrEmpty($InstallDir)) { $InstallDir = 'F:\' + $W_SOFT + '\xjy-jewelry-offline' }
if ([string]::IsNullOrEmpty($DataDir))    { $DataDir = 'F:\' + $W_DATA }
if ([string]::IsNullOrEmpty($OutDir))     { $OutDir = Join-Path $PSScriptRoot 'out' }
if ([string]::IsNullOrEmpty($Stamp))      { $Stamp = Get-Date -Format 'yyyyMMdd-HHmmss' }
if ([string]::IsNullOrEmpty($PemPath))    { $PemPath = 'D:\Codex\xjy-release-20261022\candidate\build\package\' + $W_WORKER + '\publisher-public.pem' }
New-Item -ItemType Directory -Force -Path $OutDir | Out-Null

# Pins taken from the approved 1.7.0 candidate (engine-native170-binding.json).
$PUBLISHER_SHA   = '6e8b9cadb59aeb53f30d41f4471f70f644f0dfc7376ffb9d8a4c62defb98458c'
$TARGET_CAT_SHA  = '4d78cbbac07b05f267fabb870a10376a2c1158a8b4623ba4ea35d3334cb828ef'
$PURPOSE         = 'xjy-engine-startup-v1'
$JOURNAL_PURPOSE = 'xjy-engine-tree170'
$DOMAIN          = "xjy-engine-startup-v1`0"
$TARGET_VERSION  = '1.7.0'
$TARGET_ENGINE   = '44.9.0'
$SOURCE_VERSION  = '1.6.2'
$SOURCE_ENGINE   = '44.7.0'
$MAX_RECEIPT     = 16384
$MAX_JOURNAL     = 16777216
$MAX_CATALOG     = 2097152

# --- helpers -----------------------------------------------------------------
function ConvertTo-ExtendedPath([string]$p) {
    if ($p.StartsWith('\\?\')) { return $p }
    if ($p.Length -ge 2 -and $p[1] -eq ':') { return '\\?\' + $p }
    return $p
}

function Get-Sha256HexBytes([byte[]]$Bytes) {
    $sha = [Security.Cryptography.SHA256]::Create()
    try { $h = $sha.ComputeHash($Bytes) } finally { $sha.Dispose() }
    return (($h | ForEach-Object { $_.ToString('x2') }) -join '')
}

function Get-Sha256Hex([string]$Path) {
    $ext = ConvertTo-ExtendedPath $Path
    $fs = [IO.File]::Open($ext, [IO.FileMode]::Open, [IO.FileAccess]::Read, [IO.FileShare]::ReadWrite)
    try {
        $sha = [Security.Cryptography.SHA256]::Create()
        try { $h = $sha.ComputeHash($fs) } finally { $sha.Dispose() }
        return (($h | ForEach-Object { $_.ToString('x2') }) -join '')
    } finally { $fs.Dispose() }
}

function Read-Bytes([string]$Path, [int]$MaxBytes) {
    $ext = ConvertTo-ExtendedPath $Path
    $fs = [IO.File]::Open($ext, [IO.FileMode]::Open, [IO.FileAccess]::Read, [IO.FileShare]::ReadWrite)
    try {
        if ($fs.Length -gt $MaxBytes) { throw ('file too large: ' + $fs.Length + ' > ' + $MaxBytes) }
        $buf = New-Object byte[] ([int]$fs.Length)
        $read = 0
        while ($read -lt $buf.Length) {
            $n = $fs.Read($buf, $read, $buf.Length - $read)
            if ($n -le 0) { break }
            $read += $n
        }
        if ($read -ne $buf.Length) { throw ('short read: ' + $read + '/' + $buf.Length) }
        return ,$buf
    } finally { $fs.Dispose() }
}

function Get-HmacSha256Hex([byte[]]$Key, [string]$Text) {
    $hmac = New-Object Security.Cryptography.HMACSHA256 -ArgumentList (,$Key)
    try {
        $bytes = [Text.Encoding]::UTF8.GetBytes($Text)
        $h = $hmac.ComputeHash($bytes)
        return (($h | ForEach-Object { $_.ToString('x2') }) -join '')
    } finally { $hmac.Dispose() }
}

function Test-KeySet($Obj, [string[]]$Expected) {
    $actual = @($Obj.PSObject.Properties.Name)
    $missing = @($Expected | Where-Object { $actual -notcontains $_ })
    $extra = @($actual | Where-Object { $Expected -notcontains $_ })
    return [ordered]@{ missing = $missing; extra = $extra; exact = (($missing.Count + $extra.Count) -eq 0) }
}

$script:checks = New-Object System.Collections.ArrayList
$script:failed = 0
function Add-Check([string]$id, [bool]$ok, [string]$detail, [bool]$fatal) {
    [void]$script:checks.Add([ordered]@{ id = $id; ok = $ok; detail = $detail; fatal = $fatal })
    if ($fatal -and -not $ok) { $script:failed++ }
    $mark = 'OK  '
    if (-not $ok) { if ($fatal) { $mark = 'FAIL' } else { $mark = 'WARN' } }
    Write-Output ('  [' + $mark + '] ' + $id + ' : ' + $detail)
}

$script:notes = New-Object System.Collections.ArrayList
function Add-Note([string]$s) { [void]$script:notes.Add($s); Write-Output ('  note: ' + $s) }

# --- 0. resolve install + state dir ---------------------------------------
$installExists = [IO.Directory]::Exists((ConvertTo-ExtendedPath $InstallDir))
$normInstall = $InstallDir.TrimEnd('\')
$derivedStateDir = Join-Path (Split-Path -Parent $normInstall) ('.' + (Split-Path -Leaf $normInstall) + '.xjy-engine-state')

$stateCandidates = New-Object System.Collections.ArrayList
[void]$stateCandidates.Add($derivedStateDir)
[void]$stateCandidates.Add((Join-Path $normInstall '.xjy-engine-state'))
[void]$stateCandidates.Add((Join-Path (Split-Path -Parent $normInstall) '.program.xjy-engine-state'))
[void]$stateCandidates.Add((Join-Path $normInstall '.program.xjy-engine-state'))

$stateDir = $null
$stateProbe = New-Object System.Collections.ArrayList
foreach ($c in $stateCandidates) {
    $ex = [IO.Directory]::Exists((ConvertTo-ExtendedPath $c))
    [void]$stateProbe.Add([ordered]@{ path = $c; exists = $ex })
    if ($ex -and $null -eq $stateDir) { $stateDir = $c }
}

$rawVersion = $null
try {
    $vb = Read-Bytes (Join-Path $normInstall 'version') 64
    $rawVersion = ([Text.Encoding]::UTF8.GetString($vb)).Trim()
} catch { }

$modeText = 'POST-UPGRADE'
if ($Baseline) { $modeText = 'BASELINE' }
Write-Output ('== verify-production  stamp=' + $Stamp + '  mode=' + $modeText + ' ==')
Write-Output ('  install dir : ' + $normInstall)
Write-Output ('  data dir    : ' + $DataDir)
Write-Output ('  state dir   : ' + $(if ($stateDir) { $stateDir } else { $derivedStateDir + ' (not found)' }))
Write-Output ('  version file: ' + $(if ($rawVersion) { $rawVersion } else { '<missing>' }))

# --- baseline mode -------------------------------------------------------
if ($Baseline) {
    $baseActivation = $null
    try {
        $ab = Read-Bytes (Join-Path $normInstall 'xjy-install-activation.json') 65536
        $baseActivation = ([Text.Encoding]::UTF8.GetString($ab)) | ConvertFrom-Json
    } catch { }
    Add-Check 'install-dir-exists' $installExists $normInstall $true
    Add-Check 'version-is-44.7.0' ($rawVersion -eq $SOURCE_ENGINE) ('version=' + $rawVersion) $true
    $ap = 'n/a'
    if ($baseActivation) { $ap = [string]$baseActivation.programVersion }
    Add-Check 'activation-is-1.6.2' ($baseActivation -and $baseActivation.programVersion -eq $SOURCE_VERSION) ('programVersion=' + $ap) $true
    Add-Check 'activation-role-host' ($baseActivation -and $baseActivation.role -eq 'host') ('role=' + $(if ($baseActivation) { $baseActivation.role } else { 'n/a' })) $true
    Add-Check 'no-engine-state-yet' ($null -eq $stateDir) ('state dirs found=' + @($stateProbe | Where-Object { $_.exists }).Count) $true
    Add-Check 'data-dir-exists' ([IO.Directory]::Exists((ConvertTo-ExtendedPath $DataDir))) $DataDir $true
    $baseOk = ($script:failed -eq 0)
    $baseResult = [ordered]@{
        tool = 'verify-production.ps1'; stamp = $Stamp; mode = 'baseline'
        installDir = $normInstall; dataDir = $DataDir; versionFile = $rawVersion
        activation = $baseActivation; stateProbe = @($stateProbe)
        checks = @($script:checks); ok = $baseOk; notes = @($script:notes)
    }
    $bp = Join-Path $OutDir ('verify-baseline-' + $Stamp + '.json')
    [IO.File]::WriteAllText($bp, ($baseResult | ConvertTo-Json -Depth 8), (New-Object Text.UTF8Encoding($false)))
    Write-Output ('JSON -> ' + $bp)
    if ($baseOk) { Write-Output 'RESULT: BASELINE OK (host still 1.6.2 / engine 44.7.0, ready to upgrade)'; exit 3 }
    Write-Output 'RESULT: BASELINE MISMATCH (do not upgrade until this is explained)'
    exit 1
}

# --- 1. basic presence ---------------------------------------------------
Add-Check 'install-dir-exists' $installExists $normInstall $true
if (-not $installExists) {
    Write-Output 'RESULT: FAILED (install dir missing)'
    exit 1
}
Add-Check 'state-dir-found' ($null -ne $stateDir) $(if ($stateDir) { $stateDir } else { 'no .xjy-engine-state candidate exists: the upgrade has not run (or wrote nowhere)' }) $true
if ($null -eq $stateDir) {
    Write-Output 'RESULT: FAILED (no engine state: nothing to verify yet)'
    exit 1
}

$journalPath  = Join-Path $stateDir 'journal.json'
$receiptPath  = Join-Path $stateDir 'engine-startup-status.json'
$catalogPath  = Join-Path $stateDir 'target-catalog-envelope.json'
$keyPath      = Join-Path $stateDir 'journal-key.bin'
$lockPath     = Join-Path $stateDir 'install.lock'

Add-Check 'journal-exists' ([IO.File]::Exists((ConvertTo-ExtendedPath $journalPath))) $journalPath $true
Add-Check 'receipt-exists' ([IO.File]::Exists((ConvertTo-ExtendedPath $receiptPath))) $receiptPath $true
Add-Check 'catalog-envelope-exists' ([IO.File]::Exists((ConvertTo-ExtendedPath $catalogPath))) $catalogPath $true
Add-Check 'journal-key-exists' ([IO.File]::Exists((ConvertTo-ExtendedPath $keyPath))) $keyPath $true
if ($script:failed -gt 0) {
    Write-Output 'RESULT: FAILED (state dir is incomplete)'
    Write-Output '  Do not delete anything: this looks like a partial upgrade, use the installer Recover action.'
    exit 1
}

if ([IO.File]::Exists((ConvertTo-ExtendedPath $lockPath))) {
    Add-Note ('install.lock is present in the state dir: if the installer is still running, wait for it; do not delete this file manually.')
}

$keyBytes = $null
try {
    $keyBytes = Read-Bytes $keyPath 64
    Add-Check 'journal-key-length' ($keyBytes.Length -eq 32) ('bytes=' + $keyBytes.Length) $true
} catch {
    Add-Check 'journal-key-readable' $false $_.Exception.Message $true
}
if ($script:failed -gt 0) { Write-Output 'RESULT: FAILED'; exit 1 }

# --- 2. receipt (engine-startup-status.json) -----------------------------
$receiptPayloadText = $null
$receipt = $null
$receiptRaw = $null
try {
    $rb = Read-Bytes $receiptPath $MAX_RECEIPT
    $receiptRaw = [Text.Encoding]::UTF8.GetString($rb)
    $receipt = $receiptRaw | ConvertFrom-Json
    Add-Check 'receipt-parse' $true ('bytes=' + $rb.Length) $true
} catch {
    Add-Check 'receipt-parse' $false $_.Exception.Message $true
}
if ($null -eq $receipt) { Write-Output 'RESULT: FAILED (receipt unreadable)'; exit 1 }

$receiptTop = Test-KeySet $receipt @('payload', 'mac')
Add-Check 'receipt-top-keys' $receiptTop.exact ('missing=' + ($receiptTop.missing -join ',') + ' extra=' + ($receiptTop.extra -join ',')) $true
if ($null -eq $receipt.payload) { Add-Check 'receipt-payload-present' $false 'payload missing' $true; Write-Output 'RESULT: FAILED'; exit 1 }
$receiptPayloadText = [string]$receipt.payload

$expectMac = Get-HmacSha256Hex $keyBytes ($DOMAIN + $receiptPayloadText)
Add-Check 'receipt-hmac' ($expectMac -eq [string]$receipt.mac) ('mac=' + $receipt.mac + ' expected=' + $expectMac) $true

$rp = $null
try { $rp = $receiptPayloadText | ConvertFrom-Json } catch { }
if ($null -eq $rp) { Add-Check 'receipt-payload-json' $false 'payload is not JSON' $true; Write-Output 'RESULT: FAILED'; exit 1 }

$v2Keys = @('version', 'purpose', 'transactionId', 'phase', 'rollbackForbidden', 'installationDir', 'installationIdentity', 'stateDir', 'stateIdentity', 'role', 'programVersion', 'engineVersion', 'catalogSha256', 'publisherPublicKeySha256', 'osUserNamespace', 'mode', 'journalSha256', 'businessReleased')
$v1Keys = @('version', 'purpose', 'transactionId', 'phase', 'rollbackForbidden', 'installationDir', 'installationIdentity', 'stateDir', 'stateIdentity', 'role', 'programVersion', 'engineVersion', 'catalogSha256', 'publisherPublicKeySha256', 'osUserNamespace', 'mode', 'journalSha256')
$receiptVersion = [int]$rp.version
$expectedKeys = $v1Keys
if ($receiptVersion -eq 2) { $expectedKeys = $v2Keys }
$rpSet = Test-KeySet $rp $expectedKeys
Add-Check 'receipt-payload-keys' $rpSet.exact ('version=' + $receiptVersion + ' missing=' + ($rpSet.missing -join ',') + ' extra=' + ($rpSet.extra -join ',')) $true
Add-Check 'receipt-version-native' ($receiptVersion -eq 2) ('version=' + $receiptVersion + ' (native host receipts must be 2)') $true
Add-Check 'receipt-purpose' ([string]$rp.purpose -eq $PURPOSE) ('purpose=' + $rp.purpose) $true
Add-Check 'receipt-phase-committed' ([string]$rp.phase -eq 'committed') ('phase=' + $rp.phase) $true
Add-Check 'receipt-rollbackForbidden' ($rp.rollbackForbidden -eq $true) ('rollbackForbidden=' + $rp.rollbackForbidden) $true
Add-Check 'receipt-role-host' ([string]$rp.role -eq 'host') ('role=' + $rp.role) $true
Add-Check 'receipt-programVersion' ([string]$rp.programVersion -eq $TARGET_VERSION) ('programVersion=' + $rp.programVersion) $true
Add-Check 'receipt-engineVersion' ([string]$rp.engineVersion -eq $TARGET_ENGINE) ('engineVersion=' + $rp.engineVersion) $true
Add-Check 'receipt-publisher' ([string]$rp.publisherPublicKeySha256 -eq $PUBLISHER_SHA) ('publisherPublicKeySha256=' + $rp.publisherPublicKeySha256) $true
Add-Check 'receipt-catalog-pin' ([string]$rp.catalogSha256 -eq $TARGET_CAT_SHA) ('catalogSha256=' + $rp.catalogSha256) $true
$dirOk = ([string]$rp.installationDir).TrimEnd('\') -eq $normInstall
Add-Check 'receipt-installationDir' $dirOk ('receipt=' + $rp.installationDir + ' actual=' + $normInstall) $true
$stateDirOk = ([string]$rp.stateDir).TrimEnd('\') -eq $stateDir.TrimEnd('\')
Add-Check 'receipt-stateDir' $stateDirOk ('receipt=' + $rp.stateDir + ' actual=' + $stateDir) $true
$expectedNs = ($env:COMPUTERNAME + '\' + $env:USERNAME).ToLowerInvariant()
Add-Check 'receipt-osUserNamespace' ([string]$rp.osUserNamespace -eq $expectedNs) ('receipt=' + $rp.osUserNamespace + ' expected=' + $expectedNs) $true
$modeOk = (@('upgrade', 'fresh') -contains [string]$rp.mode)
Add-Check 'receipt-mode' $modeOk ('mode=' + $rp.mode) $true
$idOk = (([string]$rp.installationIdentity) -match '^\d+:\d+:\d+$') -and (([string]$rp.stateIdentity) -match '^\d+:\d+:\d+$')
Add-Check 'receipt-identities' $idOk ('installationIdentity=' + $rp.installationIdentity + ' stateIdentity=' + $rp.stateIdentity) $false
Add-Note ('receipt transactionId=' + $rp.transactionId + ' mode=' + $rp.mode)

$businessReleased = $null
if ($receiptVersion -eq 2) {
    $businessReleased = $rp.businessReleased
    Add-Check 'receipt-businessReleased-type' ($businessReleased -is [bool]) ('businessReleased=' + $businessReleased) $true
}

# --- 3. journal (journal.json) -------------------------------------------
$journalBytes = $null
$journalRecord = $null
try {
    $journalBytes = Read-Bytes $journalPath $MAX_JOURNAL
    $journalRaw = [Text.Encoding]::UTF8.GetString($journalBytes)
    $journalEnv = $journalRaw | ConvertFrom-Json
    Add-Check 'journal-parse' $true ('bytes=' + $journalBytes.Length) $true
} catch {
    Add-Check 'journal-parse' $false $_.Exception.Message $true
}
if ($null -eq $journalEnv) { Write-Output 'RESULT: FAILED (journal unreadable)'; exit 1 }

$journalSet = Test-KeySet $journalEnv @('payload', 'mac')
Add-Check 'journal-top-keys' $journalSet.exact ('missing=' + ($journalSet.missing -join ',') + ' extra=' + ($journalSet.extra -join ',')) $true
$journalPayloadText = [string]$journalEnv.payload
$journalSha = Get-Sha256HexBytes $journalBytes
Add-Check 'receipt-journalSha256-binding' ([string]$rp.journalSha256 -eq $journalSha) ('receipt=' + $rp.journalSha256 + ' actual=' + $journalSha) $true
$journalMac = Get-HmacSha256Hex $keyBytes $journalPayloadText
Add-Check 'journal-hmac' ($journalMac -eq [string]$journalEnv.mac) ('mac=' + $journalEnv.mac + ' expected=' + $journalMac) $true

try { $journalRecord = $journalPayloadText | ConvertFrom-Json } catch { }
if ($null -eq $journalRecord) { Add-Check 'journal-payload-json' $false 'payload is not JSON' $true; Write-Output 'RESULT: FAILED'; exit 1 }

$jRequired = @('version', 'purpose', 'transactionId', 'phase', 'runtimeWrites', 'rollbackForbidden', 'paths', 'role', 'publisherPublicKeySha256', 'sourceCatalogSha256', 'targetCatalogSha256', 'sourceVersion', 'targetVersion', 'sourceEngineVersion', 'targetEngineVersion', 'identities', 'sourceFiles', 'targetFiles', 'sourceActivation', 'targetActivation', 'dataFiles', 'profileFiles', 'stageDir', 'backupDir', 'failedDir')
$jSet = Test-KeySet $journalRecord $jRequired
Add-Check 'journal-record-keys' ($jSet.missing.Count -eq 0) ('missing=' + ($jSet.missing -join ',')) $true
Add-Check 'journal-purpose' ([string]$journalRecord.purpose -eq $JOURNAL_PURPOSE) ('purpose=' + $journalRecord.purpose) $true
Add-Check 'journal-transactionId-binding' ([string]$journalRecord.transactionId -eq [string]$rp.transactionId) ('journal=' + $journalRecord.transactionId + ' receipt=' + $rp.transactionId) $true
Add-Check 'journal-phase-committed' ([string]$journalRecord.phase -eq 'committed') ('phase=' + $journalRecord.phase) $true
Add-Check 'journal-rollbackForbidden' ($journalRecord.rollbackForbidden -eq $true) ('rollbackForbidden=' + $journalRecord.rollbackForbidden) $true
Add-Check 'journal-runtimeWrites' ($journalRecord.runtimeWrites -eq $true) ('runtimeWrites=' + $journalRecord.runtimeWrites) $false
Add-Check 'journal-role-host' ([string]$journalRecord.role -eq 'host') ('role=' + $journalRecord.role) $true
Add-Check 'journal-publisher' ([string]$journalRecord.publisherPublicKeySha256 -eq $PUBLISHER_SHA) ('publisherPublicKeySha256=' + $journalRecord.publisherPublicKeySha256) $true
Add-Check 'journal-targetVersion' ([string]$journalRecord.targetVersion -eq $TARGET_VERSION) ('targetVersion=' + $journalRecord.targetVersion) $true
Add-Check 'journal-targetEngineVersion' ([string]$journalRecord.targetEngineVersion -eq $TARGET_ENGINE) ('targetEngineVersion=' + $journalRecord.targetEngineVersion) $true
Add-Check 'journal-sourceVersion' ([string]$journalRecord.sourceVersion -eq $SOURCE_VERSION) ('sourceVersion=' + $journalRecord.sourceVersion) $false
Add-Check 'journal-sourceEngineVersion' ([string]$journalRecord.sourceEngineVersion -eq $SOURCE_ENGINE) ('sourceEngineVersion=' + $journalRecord.sourceEngineVersion) $false
$jCatOk = ([string]$journalRecord.targetCatalogSha256 -eq [string]$rp.catalogSha256)
Add-Check 'journal-targetCatalog-binding' $jCatOk ('journal=' + $journalRecord.targetCatalogSha256 + ' receipt=' + $rp.catalogSha256) $true

# paths recorded by the journal
$jPaths = $journalRecord.paths
$stageDir = [string]$journalRecord.stageDir
$backupDir = [string]$journalRecord.backupDir
$failedDir = [string]$journalRecord.failedDir
Add-Note ('journal stageDir=' + $stageDir + ' backupDir=' + $backupDir)
if ($stageDir -and [IO.Directory]::Exists((ConvertTo-ExtendedPath $stageDir))) {
    Add-Check 'journal-stage-cleaned' $false ('stageDir still exists: ' + $stageDir) $false
}
if ($backupDir) {
    Add-Check 'journal-backup-exists' ([IO.Directory]::Exists((ConvertTo-ExtendedPath $backupDir))) ('backupDir=' + $backupDir) $false
}
if ($failedDir -and [IO.Directory]::Exists((ConvertTo-ExtendedPath $failedDir))) {
    Add-Note ('failedDir exists (kept evidence of a previous attempt): ' + $failedDir)
}

# --- 4. catalog envelope + Ed25519 signature -----------------------------
$catalogText = $null
$catalogSha = $null
$sigBase64 = $null
try {
    $cb = Read-Bytes $catalogPath $MAX_CATALOG
    $catalogEnv = ([Text.Encoding]::UTF8.GetString($cb)) | ConvertFrom-Json
    $cSet = Test-KeySet $catalogEnv @('catalog', 'signature')
    Add-Check 'catalog-envelope-keys' $cSet.exact ('missing=' + ($cSet.missing -join ',') + ' extra=' + ($cSet.extra -join ',')) $true
    $catalogText = [string]$catalogEnv.catalog
    $sigBase64 = [string]$catalogEnv.signature
    $catalogSha = Get-Sha256HexBytes ([Text.Encoding]::UTF8.GetBytes($catalogText))
    Add-Check 'catalog-sha-matches-receipt' ($catalogSha -eq [string]$rp.catalogSha256) ('catalog=' + $catalogSha + ' receipt=' + $rp.catalogSha256) $true
    Add-Check 'catalog-sha-pin' ($catalogSha -eq $TARGET_CAT_SHA) ('catalog=' + $catalogSha + ' pin=' + $TARGET_CAT_SHA) $true
} catch {
    Add-Check 'catalog-envelope-parse' $false $_.Exception.Message $true
}

$signatureResult = 'skipped'
if ($catalogText -and -not $SkipSignatureVerify) {
    $nodeExe = $NodePath
    if ([string]::IsNullOrEmpty($nodeExe)) {
        $cmd = Get-Command node -ErrorAction SilentlyContinue
        if ($cmd) { $nodeExe = $cmd.Source }
    }
    if ([string]::IsNullOrEmpty($nodeExe) -and [IO.File]::Exists('E:\node\node.exe')) { $nodeExe = 'E:\node\node.exe' }
    if ([string]::IsNullOrEmpty($nodeExe)) {
        Add-Check 'catalog-signature' $false 'no node.exe found to run Ed25519 verification (pass -NodePath or accept -SkipSignatureVerify)' $true
        $signatureResult = 'node-missing'
    } else {
        $jsPath = Join-Path $PSScriptRoot 'ed25519-verify.cjs'
        if (-not [IO.File]::Exists((ConvertTo-ExtendedPath $jsPath))) {
            $jsCode = @'
const crypto = require('node:crypto'), fs = require('node:fs');
const pem = fs.readFileSync(process.argv[2], 'utf8');
const catalog = fs.readFileSync(process.argv[3]);
const sig = Buffer.from(fs.readFileSync(process.argv[4], 'utf8').trim(), 'base64');
const key = crypto.createPublicKey(pem);
const der = key.export({ type: 'spki', format: 'der' });
const spkiSha = crypto.createHash('sha256').update(der).digest('hex');
const ok = crypto.verify(null, catalog, key, sig);
process.stdout.write(JSON.stringify({ ok, spkiSha }));
'@
            [IO.File]::WriteAllText($jsPath, $jsCode, (New-Object Text.UTF8Encoding($false)))
        }
        $catalogTmp = Join-Path $OutDir ('_catalog-' + $Stamp + '.txt')
        $sigTmp = Join-Path $OutDir ('_sig-' + $Stamp + '.b64')
        [IO.File]::WriteAllText($catalogTmp, $catalogText, (New-Object Text.UTF8Encoding($false)))
        [IO.File]::WriteAllText($sigTmp, $sigBase64, (New-Object Text.UTF8Encoding($false)))
        try {
            $nodeOut = & $nodeExe $jsPath $PemPath $catalogTmp $sigTmp 2>&1
            $nodeJson = $null
            foreach ($line in @($nodeOut)) { try { $nodeJson = [string]$line | ConvertFrom-Json } catch { } }
            if ($nodeJson) {
                Add-Check 'catalog-signature-ed25519' ($nodeJson.ok -eq $true) ('verify=' + $nodeJson.ok) $true
                Add-Check 'publisher-key-spki-pin' ($nodeJson.spkiSha -eq $PUBLISHER_SHA) ('pem spki sha256=' + $nodeJson.spkiSha) $true
                $signatureResult = [string]$nodeJson.ok
            } else {
                Add-Check 'catalog-signature-ed25519' $false ('node produced no parseable result: ' + ($nodeOut -join ' ')) $true
                $signatureResult = 'error'
            }
        } catch {
            Add-Check 'catalog-signature-ed25519' $false ('node failed: ' + $_.Exception.Message) $true
            $signatureResult = 'error'
        } finally {
            try { Remove-Item -LiteralPath $catalogTmp, $sigTmp -Force -ErrorAction SilentlyContinue } catch { }
        }
    }
} elseif ($SkipSignatureVerify) {
    Add-Note 'Ed25519 catalog signature verification was skipped by -SkipSignatureVerify.'
}

# catalog content sanity (target program tree)
$catalogJson = $null
try { $catalogJson = $catalogText | ConvertFrom-Json } catch { }
if ($catalogJson) {
    Add-Check 'catalog-app' ([string]$catalogJson.app -eq 'xjy-jewelry-offline') ('app=' + $catalogJson.app) $false
    Add-Check 'catalog-version' ([string]$catalogJson.version -eq $TARGET_VERSION) ('version=' + $catalogJson.version) $false
    $catFiles = @($catalogJson.files)
    Add-Note ('catalog files=' + $catFiles.Count + ' sequence=' + $catalogJson.sequence + ' expiresAt=' + $catalogJson.expiresAt)
}

# --- 5. version file against catalog -------------------------------------
$versionInCatalog = $null
if ($catalogJson) {
    foreach ($f in @($catalogJson.files)) { if ([string]$f.path -eq 'version') { $versionInCatalog = $f } }
}
if ($versionInCatalog) {
    $vPath = Join-Path $normInstall 'version'
    $vSize = -1
    try { $vSize = ([IO.FileInfo]::new((ConvertTo-ExtendedPath $vPath))).Length } catch { }
    Add-Check 'version-size-in-catalog' ($vSize -eq [long]$versionInCatalog.size) ('actual=' + $vSize + ' catalog=' + $versionInCatalog.size) $true
    $vSha = Get-Sha256Hex $vPath
    Add-Check 'version-sha-in-catalog' ($vSha -eq [string]$versionInCatalog.sha256) ('actual=' + $vSha) $true
} else {
    Add-Check 'version-entry-in-catalog' $false 'catalog has no version file entry' $true
}
Add-Check 'version-value' ($rawVersion -eq $TARGET_ENGINE) ('value=' + $rawVersion + ' expected=' + $TARGET_ENGINE) $true

# --- 6. activation file --------------------------------------------------
$activation = $null
try {
    $abTest = Read-Bytes (Join-Path $normInstall 'xjy-install-activation.json') 65536
    $activation = ([Text.Encoding]::UTF8.GetString($abTest)) | ConvertFrom-Json
    Add-Check 'activation-parse' $true '' $true
} catch {
    Add-Check 'activation-parse' $false $_.Exception.Message $true
}
if ($activation) {
    $aSet = Test-KeySet $activation @('version', 'product', 'programVersion', 'role', 'installationDir')
    Add-Check 'activation-keys' $aSet.exact ('missing=' + ($aSet.missing -join ',') + ' extra=' + ($aSet.extra -join ',')) $true
    Add-Check 'activation-version-1' ([int]$activation.version -eq 1) ('version=' + $activation.version) $true
    Add-Check 'activation-product' ([string]$activation.product -eq 'xjy-jewelry-offline') ('product=' + $activation.product) $true
    Add-Check 'activation-programVersion' ([string]$activation.programVersion -eq $TARGET_VERSION) ('programVersion=' + $activation.programVersion) $true
    Add-Check 'activation-role' ([string]$activation.role -eq 'host') ('role=' + $activation.role) $true
    $aDirOk = ([string]$activation.installationDir).TrimEnd('\') -eq $normInstall
    Add-Check 'activation-installationDir' $aDirOk ('activation=' + $activation.installationDir) $true
    if ($journalRecord -and $journalRecord.targetActivation) {
        $taJson = [string]$journalRecord.targetActivation
        Add-Note ('journal targetActivation recorded (' + $taJson.Length + ' chars)')
    }
}

# --- 7. targetFiles re-hash ---------------------------------------------
$targetFiles = @()
if ($journalRecord) { $targetFiles = @($journalRecord.targetFiles) }
$fileSummary = [ordered]@{ checked = 0; total = $targetFiles.Count; missing = 0; sizeMismatch = 0; hashMismatch = 0; samples = @() }
if ($SkipFileHashes) {
    Add-Note ('targetFiles re-hash SKIPPED by -SkipFileHashes (journal lists ' + $targetFiles.Count + ' files)')
} else {
    Write-Output ('-- re-hashing ' + $targetFiles.Count + ' journal targetFiles entries (several hundred MB, may take minutes) --')
    $samples = New-Object System.Collections.ArrayList
    $i = 0
    foreach ($tf in $targetFiles) {
        $i++
        if ($i % 200 -eq 0) { Write-Output ('  ... ' + $i + '/' + $targetFiles.Count) }
        $rel = [string]$tf.path
        if ([string]::IsNullOrEmpty($rel)) { continue }
        $full = Join-Path $normInstall ($rel -replace '/', '\')
        if (-not [IO.File]::Exists((ConvertTo-ExtendedPath $full))) {
            $fileSummary.missing++
            if ($samples.Count -lt 20) { [void]$samples.Add([ordered]@{ path = $rel; reason = 'missing' }) }
            continue
        }
        $len = -1
        try { $len = ([IO.FileInfo]::new((ConvertTo-ExtendedPath $full))).Length } catch { }
        if ($null -ne $tf.size -and $len -ne [long]$tf.size) {
            $fileSummary.sizeMismatch++
            if ($samples.Count -lt 20) { [void]$samples.Add([ordered]@{ path = $rel; reason = 'size'; expected = $tf.size; actual = $len }) }
            continue
        }
        try { $h = Get-Sha256Hex $full } catch { $h = $null }
        $fileSummary.checked++
        if ($h -ne [string]$tf.sha256) {
            $fileSummary.hashMismatch++
            if ($samples.Count -lt 20) { [void]$samples.Add([ordered]@{ path = $rel; reason = 'sha256'; expected = $tf.sha256; actual = $h }) }
        }
    }
    $fileSummary.samples = @($samples)
    $filesOk = (($fileSummary.missing + $fileSummary.sizeMismatch + $fileSummary.hashMismatch) -eq 0)
    Add-Check 'journal-targetFiles-match' $filesOk ('checked=' + $fileSummary.checked + '/' + $fileSummary.total + ' missing=' + $fileSummary.missing + ' sizeMismatch=' + $fileSummary.sizeMismatch + ' hashMismatch=' + $fileSummary.hashMismatch) $true
}

# --- 8. data dir presence (informational) --------------------------------
$dataTree = [ordered]@{ path = $DataDir; exists = [IO.Directory]::Exists((ConvertTo-ExtendedPath $DataDir)); files = 0; bytes = 0 }
if ($dataTree.exists) {
    $stack = New-Object System.Collections.Stack
    $stack.Push($DataDir)
    while ($stack.Count -gt 0) {
        $d = [string]$stack.Pop()
        $ext = ConvertTo-ExtendedPath $d
        try { foreach ($sub in [IO.Directory]::GetDirectories($ext)) { $stack.Push($sub) } } catch { }
        try { foreach ($f in [IO.Directory]::GetFiles($ext)) { try { $dataTree.files++; $dataTree.bytes += ([IO.FileInfo]::new($f)).Length } catch { } } } catch { }
    }
    Add-Note ('business data dir: ' + $dataTree.files + ' files / ' + $dataTree.bytes + ' bytes')
} else {
    Add-Check 'data-dir-exists' $false $DataDir $true
}

# --- 9. verdict ----------------------------------------------------------
$held = ($businessReleased -eq $false)
$ok = ($script:failed -eq 0)
$verdict = 'FAIL'
$exitCode = 1
if ($ok -and $held) { $verdict = 'HELD'; $exitCode = 2 }
elseif ($ok) { $verdict = 'PASS'; $exitCode = 0 }

$result = [ordered]@{
    tool              = 'verify-production.ps1'
    schemaVersion     = 1
    stamp             = $Stamp
    mode              = 'post-upgrade'
    readOnly          = $true
    installDir        = $normInstall
    dataDir           = $DataDir
    stateDir          = $stateDir
    stateDirCandidates = @($stateProbe)
    versionFile       = $rawVersion
    journal           = [ordered]@{
        path = $journalPath; bytes = $(if ($journalBytes) { $journalBytes.Length } else { 0 }); sha256 = $journalSha
        phase = $(if ($journalRecord) { $journalRecord.phase } else { $null })
        targetVersion = $(if ($journalRecord) { $journalRecord.targetVersion } else { $null })
        sourceVersion = $(if ($journalRecord) { $journalRecord.sourceVersion } else { $null })
        transactionId = $(if ($journalRecord) { $journalRecord.transactionId } else { $null })
        targetFilesCount = $targetFiles.Count
        sourceFilesCount = $(if ($journalRecord) { @($journalRecord.sourceFiles).Count } else { 0 })
        dataFilesCount = $(if ($journalRecord) { @($journalRecord.dataFiles).Count } else { 0 })
        stageDir = $stageDir; backupDir = $backupDir; failedDir = $failedDir
    }
    receipt           = [ordered]@{
        path = $receiptPath; version = $receiptVersion; phase = $(if ($rp) { $rp.phase } else { $null })
        mode = $(if ($rp) { $rp.mode } else { $null }); transactionId = $(if ($rp) { $rp.transactionId } else { $null })
        businessReleased = $businessReleased
    }
    catalog           = [ordered]@{
        path = $catalogPath; sha256 = $catalogSha; pinned = $TARGET_CAT_SHA
        signature = $signatureResult; files = $(if ($catalogJson) { @($catalogJson.files).Count } else { 0 })
    }
    activation        = $activation
    targetFiles       = $fileSummary
    dataTree          = $dataTree
    checks            = @($script:checks)
    failedChecks      = $script:failed
    notes             = @($script:notes)
    verdict           = $verdict
    exitCode          = $exitCode
}
$outFile = Join-Path $OutDir ('verify-' + $Stamp + '.json')
[IO.File]::WriteAllText($outFile, ($result | ConvertTo-Json -Depth 8), (New-Object Text.UTF8Encoding($false)))

Write-Output ('JSON -> ' + $outFile)
Write-Output ('checks: ' + $script:checks.Count + ' total, ' + $script:failed + ' failed')
if ($verdict -eq 'PASS') {
    Write-Output 'RESULT: PASS (1.7.0 host committed, signature chain valid, all target files match, business released)'
    exit 0
}
if ($verdict -eq 'HELD') {
    Write-Output 'RESULT: HELD (structure + chain are correct, but businessReleased=false).'
    Write-Output '  This is the normal state right after the installer commits: start the 1.7.0 program once,'
    Write-Output '  then re-run this script. Do NOT delete the state dir and do NOT re-run the installer.'
    exit 2
}
Write-Output 'RESULT: FAILED'
foreach ($c in $script:checks) { if (-not $c.ok -and $c.fatal) { Write-Output ('  failed: ' + $c.id + ' -> ' + $c.detail) } }
Write-Output '  Do not delete anything. Keep the scene, read the journal, and follow the Recover procedure in S5-checklist.md.'
exit 1
