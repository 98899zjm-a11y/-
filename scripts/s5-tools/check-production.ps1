# =============================================================================
# check-production.ps1  --  S5 pre-upgrade READ-ONLY inspection
# -----------------------------------------------------------------------------
# Contract:
#   * READ ONLY. Nothing under F:\ is created, modified or deleted.
#   * Only writes JSON into <tools>\out\check-<stamp>.json
#   * ASCII-only source: Chinese directory names are built from code points so
#     the file stays readable by Windows PowerShell 5.1 (no BOM / ANSI issue).
#   * Never touches WeChat (Tencent / xwechat / Weixin) paths or processes.
# Exit codes:
#   0 = all mandatory checks pass (directories + release pins readable)
#   1 = something mandatory is missing (see "failures" in JSON)
# =============================================================================
[CmdletBinding()]
param(
    [string]$OutDir = '',
    [string]$InstallDir = '',
    [string]$DataDir = '',
    [string]$PackageRoot = 'D:\Codex\xjy-release-20261022\candidate\build\package',
    [string]$BackupRoot = 'D:\Codex\xjy-private-backups',
    [switch]$DeepPackage
)

$ErrorActionPreference = 'Stop'

# --- non-ASCII path fragments (code points) --------------------------------
# U+81EA U+5236 U+8F6F U+4EF6  = "self-made software" (F:\<this>\xjy-jewelry-offline)
# U+946B U+91D1 U+6E90 U+73E0 U+5B9D = product short name ("xin jin yuan zhu bao")
# + U+8D44 U+6599 = business data folder
# U+4E00 U+952E U+5347 U+7EA7 = "one click upgrade"
# U+5B89 U+88C5 U+7EC4 U+4EF6 = "install components"
# U+5B8C U+6574 U+7A0B U+5E8F = "complete program"
# U+53D7 U+4FE1 U+52A9 U+624B = "trusted helper"
# U+62A5 U+4EF7 = "quote" (exe suffix)
function U([int[]]$cp) { -join ($cp | ForEach-Object { [char]$_ }) }

$W_SOFT     = U @(0x81EA, 0x5236, 0x8F6F, 0x4EF6)
$W_JEW      = U @(0x946B, 0x91D1, 0x6E90, 0x73E0, 0x5B9D)
$W_DATA     = U @(0x946B, 0x91D1, 0x6E90, 0x73E0, 0x5B9D, 0x8D44, 0x6599)
$W_UPGRADE  = U @(0x4E00, 0x952E, 0x5347, 0x7EA7)
$W_COMP     = U @(0x5B89, 0x88C5, 0x7EC4, 0x4EF6)
$W_PROGTREE = U @(0x5B8C, 0x6574, 0x7A0B, 0x5E8F)
$W_WORKER   = U @(0x53D7, 0x4FE1, 0x52A9, 0x624B)
$W_EXE      = $W_JEW + (U @(0x62A5, 0x4EF7)) + '.exe'

if ([string]::IsNullOrEmpty($OutDir))     { $OutDir = Join-Path $PSScriptRoot 'out' }
if ([string]::IsNullOrEmpty($InstallDir)) { $InstallDir = 'F:\' + $W_SOFT + '\xjy-jewelry-offline' }
if ([string]::IsNullOrEmpty($DataDir))    { $DataDir = 'F:\' + $W_DATA }

$stamp = Get-Date -Format 'yyyyMMdd-HHmmss'
New-Item -ItemType Directory -Force -Path $OutDir | Out-Null

# --- helpers -----------------------------------------------------------------
function ConvertTo-ExtendedPath([string]$p) {
    if ($p.StartsWith('\\?\')) { return $p }
    if ($p.Length -ge 2 -and $p[1] -eq ':') { return '\\?\' + $p }
    return $p
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

function Read-TextFile([string]$Path, [int]$MaxBytes = 1048576) {
    if (-not [IO.File]::Exists((ConvertTo-ExtendedPath $Path))) { return $null }
    $fs = [IO.File]::Open((ConvertTo-ExtendedPath $Path), [IO.FileMode]::Open, [IO.FileAccess]::Read, [IO.FileShare]::ReadWrite)
    try {
        $len = [int][Math]::Min($fs.Length, $MaxBytes)
        $buf = New-Object byte[] $len
        [void]$fs.Read($buf, 0, $len)
        return ([Text.Encoding]::UTF8.GetString($buf))
    } finally { $fs.Dispose() }
}

# Long-path safe recursive measurement (no Get-ChildItem / no MAX_PATH traps).
function Get-TreeStats([string]$Root) {
    $r = [ordered]@{ path = $Root; exists = $false; files = 0; bytes = 0; dirs = 0; errors = 0 }
    if (-not [IO.Directory]::Exists((ConvertTo-ExtendedPath $Root))) { return $r }
    $r.exists = $true
    $stack = New-Object System.Collections.Stack
    $stack.Push($Root)
    while ($stack.Count -gt 0) {
        $d = [string]$stack.Pop()
        $ext = ConvertTo-ExtendedPath $d
        try {
            foreach ($sub in [IO.Directory]::GetDirectories($ext)) { $r.dirs++; $stack.Push($sub) }
        } catch { $r.errors++ }
        try {
            foreach ($f in [IO.Directory]::GetFiles($ext)) {
                try { $r.files++; $r.bytes += ([IO.FileInfo]::new($f)).Length } catch { $r.errors++ }
            }
        } catch { $r.errors++ }
    }
    return $r
}

$script:notes   = New-Object System.Collections.ArrayList
$script:fails   = New-Object System.Collections.ArrayList
function Add-Note([string]$s) { [void]$script:notes.Add($s) }
function Add-Fail([string]$s) { [void]$script:fails.Add($s) }

# --- 1. host / session -------------------------------------------------------
$hostInfo = [ordered]@{
    computerName   = $env:COMPUTERNAME
    userName       = $env:USERNAME
    userDomain     = $env:USERDOMAIN
    psVersion      = $PSVersionTable.PSVersion.ToString()
    is64BitProcess = [Environment]::Is64BitProcess
    sampledAt      = (Get-Date).ToString('o')
    osVersion      = [Environment]::OSVersion.VersionString
}
# The journal/receipt osUserNamespace is  <hostname>\<username>  lower-cased;
# the installer must run as the SAME Windows account as the business app.
$hostInfo['expectedOsUserNamespace'] = ($env:COMPUTERNAME + '\' + $env:USERNAME).ToLowerInvariant()

# --- 2. processes ------------------------------------------------------------
function Get-XjyProcessSnapshot {
    $list = New-Object System.Collections.ArrayList
    foreach ($p in (Get-Process -ErrorAction SilentlyContinue)) {
        $path = $null
        try { $path = $p.Path } catch { $path = $null }
        $name = $p.ProcessName
        $start = $null
        try { $start = $p.StartTime.ToString('o') } catch { $start = $null }
        $cpu = $null
        try { $cpu = [Math]::Round([double]$p.CPU, 2) } catch { $cpu = $null }

        $isProd = $false
        if ($path) {
            $lp = $path.ToLowerInvariant()
            if ($lp.Contains('\xjy-jewelry-offline\')) { $isProd = $true }
            if ($lp.Contains('\xjy-170-local\')) { $isProd = $true }   # local installer copy
            if ($lp.Contains('\appdata\local\temp\') -and $lp.Contains('xjy')) { $isProd = $true }
        }
        if ($name -like ('*' + $W_JEW + '*')) { $isProd = $true }
        if ($isProd -and $p.Id -eq $PID) { $isProd = $false }         # never report ourselves

        if ($isProd) {
            [void]$list.Add([ordered]@{
                id          = $p.Id
                name        = $name
                cpuSeconds  = $cpu
                startTime   = $start
                path        = $path
                workingSetMB = [Math]::Round($p.WorkingSet64 / 1MB, 1)
            })
        }
    }
    return ,$list
}

$procs = Get-XjyProcessSnapshot
$procCount = $procs.Count
if ($procCount -eq 0) { Add-Note 'No production xjy process running (expected before S5).' }
else { Add-Fail ("{0} xjy-related process(es) still running; the installer needs them closed." -f $procCount) }

# --- 3. activation + version on production ----------------------------------
$activationPath = Join-Path $InstallDir 'xjy-install-activation.json'
$versionPath    = Join-Path $InstallDir 'version'
$activationRaw  = $null
$activation     = $null
$activationErr  = $null
try { $activationRaw = Read-TextFile $activationPath } catch { $activationErr = $_.Exception.Message }
if ($activationRaw) {
    try { $activation = $activationRaw | ConvertFrom-Json } catch { $activationErr = $_.Exception.Message }
}
$versionRaw = $null
try { $versionRaw = Read-TextFile $versionPath 64 } catch { }
$versionTrim = $null
if ($versionRaw) { $versionTrim = $versionRaw.Trim() }

if (-not [IO.Directory]::Exists((ConvertTo-ExtendedPath $InstallDir))) {
    Add-Fail ('Production install dir missing: ' + $InstallDir)
}
if ($null -eq $activation) { Add-Fail ('Cannot read/parse ' + $activationPath + ' -> ' + $activationErr) }
if ($null -eq $versionTrim) { Add-Fail ('Cannot read version file: ' + $versionPath) }

# --- 4. tree statistics ------------------------------------------------------
$prodTree = Get-TreeStats $InstallDir
$dataTree = Get-TreeStats $DataDir
if (-not $dataTree.exists) { Add-Fail ('Business data dir missing: ' + $DataDir) }
if ($prodTree.errors -gt 0) { Add-Note ('Production tree enumeration had {0} per-entry errors (ACL/locked files).' -f $prodTree.errors) }
if ($dataTree.errors -gt 0) { Add-Note ('Data tree enumeration had {0} per-entry errors (ACL/locked files).' -f $dataTree.errors) }

# Known-good 1.6.2 baseline measured on 2026-10-22 (see S5-checklist.md).
$baseline = [ordered]@{ prodFiles = 3525; prodBytes = 1620307739; dataFiles = 1176; dataBytes = 2394718644 }
$drift = [ordered]@{
    prodFilesMatch = ($prodTree.files -eq $baseline.prodFiles)
    prodBytesMatch = ($prodTree.bytes -eq $baseline.prodBytes)
    dataFilesMatch = ($dataTree.files -eq $baseline.dataFiles)
    dataBytesMatch = ($dataTree.bytes -eq $baseline.dataBytes)
    baselineItem   = $baseline
}
if (-not ($drift.prodFilesMatch -and $drift.prodBytesMatch)) { Add-Note 'Production tree differs from the recorded 1.6.2 baseline (may be normal if the app wrote logs).' }
if (-not ($drift.dataFilesMatch -and $drift.dataBytesMatch)) { Add-Note 'Data tree differs from the recorded 1.6.2 baseline (business data may legitimately change).' }

# --- 5. free space -----------------------------------------------------------
$disks = New-Object System.Collections.ArrayList
foreach ($d in @('C', 'D', 'F')) {
    try {
        $di = New-Object IO.DriveInfo ($d + ':')
        [void]$disks.Add([ordered]@{
            drive      = $d
            totalGB    = [Math]::Round($di.TotalSize / 1GB, 1)
            freeGB     = [Math]::Round($di.AvailableFreeSpace / 1GB, 1)
            isReady    = $di.IsReady
        })
    } catch { }
}
$dFree = ($disks | Where-Object { $_.drive -eq 'D' } | Select-Object -First 1)
if ($dFree -and $dFree.freeGB -lt 12) { Add-Fail ('Drive D free space {0} GB is below the 12 GB needed for a second full backup + logs.' -f $dFree.freeGB) }
if ($dFree -and $dFree.freeGB -lt 20) { Add-Note ('Drive D free space {0} GB is tight; a full backup needs about 4.1 GB.' -f $dFree.freeGB) }

# --- 6. engine state / journal probes (expected ABSENT before upgrade) ------
$stateCandidates = @(
    (Join-Path (Split-Path -Parent $InstallDir) ('.' + (Split-Path -Leaf $InstallDir) + '.xjy-engine-state')),
    (Join-Path $InstallDir '.xjy-engine-state'),
    (Join-Path (Split-Path -Parent $InstallDir) '.program.xjy-engine-state'),
    (Join-Path $InstallDir '.program.xjy-engine-state')
)
$stateProbe = New-Object System.Collections.ArrayList
$stateFound = 0
foreach ($c in $stateCandidates) {
    $exists = [IO.Directory]::Exists((ConvertTo-ExtendedPath $c))
    if ($exists) { $stateFound++ }
    $entry = [ordered]@{ path = $c; exists = $exists }
    if ($exists) {
        $entry['hasJournal']   = [IO.File]::Exists((ConvertTo-ExtendedPath (Join-Path $c 'journal.json')))
        $entry['hasStatus']    = [IO.File]::Exists((ConvertTo-ExtendedPath (Join-Path $c 'engine-startup-status.json')))
        $entry['hasCatalog']   = [IO.File]::Exists((ConvertTo-ExtendedPath (Join-Path $c 'target-catalog-envelope.json')))
        $entry['hasKeyFile']   = [IO.File]::Exists((ConvertTo-ExtendedPath (Join-Path $c 'journal-key.bin')))
        $entry['hasInstallLock'] = [IO.File]::Exists((ConvertTo-ExtendedPath (Join-Path $c 'install.lock')))
    }
    [void]$stateProbe.Add($entry)
}
if ($stateFound -eq 0) {
    Add-Note 'No .xjy-engine-state directory present: this host is NOT upgraded yet (correct pre-S5 state).'
} else {
    Add-Fail ("{0} engine-state directory(ies) already exist: a previous upgrade attempt already started. Do NOT start another upgrade; inspect journal and use the installer Recover action." -f $stateFound)
}
$startupStatusInInstall = Join-Path $InstallDir 'engine-startup-status.json'
$startupStatusExists = [IO.File]::Exists((ConvertTo-ExtendedPath $startupStatusInInstall))

# --- 7. legacy journals already on production (informational) ---------------
$legacyInit = Join-Path $InstallDir '.xjy-initial-upgrade'
$legacyInitProbe = [ordered]@{ dir = $legacyInit; exists = ([IO.Directory]::Exists((ConvertTo-ExtendedPath $legacyInit))) }
if ($legacyInitProbe.exists) {
    $j = Join-Path $legacyInit 'journal.json'
    $legacyInitProbe['journalExists'] = [IO.File]::Exists((ConvertTo-ExtendedPath $j))
    try {
        $raw = Read-TextFile $j 65536
        if ($raw) {
            $o = $raw | ConvertFrom-Json
            if ($o.payload) {
                $p = $o.payload | ConvertFrom-Json
                $legacyInitProbe['phase'] = $p.phase
                $legacyInitProbe['targetVersion'] = $p.targetVersion
                $legacyInitProbe['purpose'] = $p.purpose
                $legacyInitProbe['transactionId'] = $p.transactionId
            }
        }
    } catch { $legacyInitProbe['error'] = $_.Exception.Message }
}

# --- 8. existing backups -----------------------------------------------------
$backups = New-Object System.Collections.ArrayList
if ([IO.Directory]::Exists((ConvertTo-ExtendedPath $BackupRoot))) {
    foreach ($d in [IO.Directory]::GetDirectories((ConvertTo-ExtendedPath $BackupRoot))) {
        try {
            $mf = Join-Path $d 'manifest.json'
            $mfSize = 0
            if ([IO.File]::Exists((ConvertTo-ExtendedPath $mf))) { $mfSize = ([IO.FileInfo]::new((ConvertTo-ExtendedPath $mf))).Length }
            [void]$backups.Add([ordered]@{
                name         = (Split-Path -Leaf $d)
                hasManifest  = ($mfSize -gt 0)
                manifestBytes = $mfSize
                modified     = ([IO.Directory]::GetLastWriteTime($d)).ToString('o')
            })
        } catch { }
    }
}
$knownBackup = Join-Path $BackupRoot 'pre170-20261022-a1'
$knownBackupProbe = [ordered]@{
    path        = $knownBackup
    exists      = [IO.Directory]::Exists((ConvertTo-ExtendedPath $knownBackup))
    hasProgram  = [IO.Directory]::Exists((ConvertTo-ExtendedPath (Join-Path $knownBackup 'program')))
    hasData     = [IO.Directory]::Exists((ConvertTo-ExtendedPath (Join-Path $knownBackup 'data')))
    hasManifest = [IO.File]::Exists((ConvertTo-ExtendedPath (Join-Path $knownBackup 'manifest.json')))
}
if (-not $knownBackupProbe.exists) { Add-Fail 'The known-good 1.6.2 backup pre170-20261022-a1 is missing.' }

# --- 9. release candidate package ------------------------------------------
$pkg = [ordered]@{ root = $PackageRoot; exists = [IO.Directory]::Exists((ConvertTo-ExtendedPath $PackageRoot)) }
$pins = [ordered]@{
    upgradeCmd      = [ordered]@{ rel = ($W_UPGRADE + '.cmd'); expected = '7a6e182cea080f704b1dd53f4a6672949af9aeedf708229c6ddd28cfeede436b' }
    deliveryScript  = [ordered]@{ rel = ($W_COMP + '\native-delivery-170.ps1'); expected = '15352a02337e4bae4db93f66b3255f23b997363bd17f80736db8d18cbc46480b' }
    binding         = [ordered]@{ rel = 'engine-native170-binding.json'; expected = '6552569b5f743c0aaf1f0a0afa59949626e93867cda0cd392b035578f4afc507' }
    publisherPem    = [ordered]@{ rel = ($W_WORKER + '\publisher-public.pem'); expected = 'bc6c3d2b42871e42d3eb91371034b410d507a228eeccb1d714acca60e8141b30' }
    patchZip        = [ordered]@{ rel = ($W_JEW + '1.7.0' + (U @(0x5458, 0x5DE5, 0x5347, 0x7EA7, 0x8865, 0x4E01)) + '.zip'); expected = 'b1a7b12029208994d0431101660368d22c8d887384485aff432765c380730dc9' }
}
if ($DeepPackage) {
    $pins['fullEngineExe'] = [ordered]@{ rel = ($W_PROGTREE + '\' + $W_EXE); expected = 'c99a56d653220a8bf209b0b9ae2424ec1f1580946d1bf3395a968eb211a4f1b5' }
}
$pinResults = New-Object System.Collections.ArrayList
$pinAllOk = $true
if ($pkg.exists) {
    foreach ($k in $pins.Keys) {
        $spec = $pins[$k]
        $full = Join-Path $PackageRoot $spec.rel
        $entry = [ordered]@{ id = $k; rel = $spec.rel; expected = $spec.expected; path = $full }
        if (-not [IO.File]::Exists((ConvertTo-ExtendedPath $full))) {
            $entry['exists'] = $false; $entry['actual'] = $null; $entry['match'] = $false
            $pinAllOk = $false
        } else {
            $entry['exists'] = $true
            $entry['size'] = ([IO.FileInfo]::new((ConvertTo-ExtendedPath $full))).Length
            try {
                $actual = Get-Sha256Hex $full
                $entry['actual'] = $actual
                $entry['match'] = ($actual -eq $spec.expected)
                if (-not $entry['match']) { $pinAllOk = $false }
            } catch {
                $entry['actual'] = $null; $entry['match'] = $false; $entry['error'] = $_.Exception.Message
                $pinAllOk = $false
            }
        }
        [void]$pinResults.Add($entry)
    }
    $pkg['fileCount'] = $null
    $pkg['engineVersionFile'] = Read-TextFile (Join-Path $PackageRoot ($W_PROGTREE + '\version')) 64
    if ($pkg['engineVersionFile']) { $pkg['engineVersionFile'] = $pkg['engineVersionFile'].Trim() }
    $pkg['workerVersionFile'] = Read-TextFile (Join-Path $PackageRoot ($W_WORKER + '\version')) 64
    if ($pkg['workerVersionFile']) { $pkg['workerVersionFile'] = $pkg['workerVersionFile'].Trim() }
} else {
    Add-Fail ('Candidate package root missing: ' + $PackageRoot)
}
if ($pkg.exists -and -not $pinAllOk) { Add-Fail 'One or more release-package pins do not match the approved candidate (tampered or wrong build).' }
if ($pkg['engineVersionFile'] -and $pkg['engineVersionFile'] -ne '44.9.0') { Add-Fail ('Candidate engine version file is ' + $pkg['engineVersionFile'] + ', expected 44.9.0') }

# --- 10. release metadata sanity (informational risk flags) -----------------
$releaseRoot = 'D:\Codex\xjy-release-20261022'
$deliveryStatus = $null
try {
    $dsPath = Join-Path $releaseRoot 'DELIVERY_STATUS.json'
    if ([IO.File]::Exists((ConvertTo-ExtendedPath $dsPath))) {
        $dsRaw = Read-TextFile $dsPath 262144
        $ds = $dsRaw | ConvertFrom-Json
        $deliveryStatus = [ordered]@{
            status            = $ds.status
            secondaryStatus   = $ds.secondaryStatus
            releaseQualified  = $ds.releaseQualified
            installAuthState  = $ds.installAuthorization.state
            productionTouched = $ds.installAuthorization.productionTouched
            nonClaims         = @($ds.explicitNonClaims)
        }
    }
} catch { $deliveryStatus = $null }
if ($deliveryStatus) {
    if ($deliveryStatus.releaseQualified -ne $true) { Add-Note 'DELIVERY_STATUS releaseQualified is NOT true: the candidate is an internal candidate, not a formally release-qualified build.' }
    if ($deliveryStatus.productionTouched -ne $false) { Add-Note 'DELIVERY_STATUS says productionTouched is not false; check the release record before upgrading.' }
}

# --- assemble ----------------------------------------------------------------
$result = [ordered]@{
    tool            = 'check-production.ps1'
    schemaVersion   = 1
    readOnly        = $true
    stamp           = $stamp
    host            = $hostInfo
    installDir      = $InstallDir
    dataDir         = $DataDir
    processes       = @($procs)
    processCount    = $procCount
    activation      = [ordered]@{
        path        = $activationPath
        exists      = [IO.File]::Exists((ConvertTo-ExtendedPath $activationPath))
        rawLength   = 0
        parsed      = $activation
        error       = $activationErr
    }
    version         = [ordered]@{
        path  = $versionPath
        exists = [IO.File]::Exists((ConvertTo-ExtendedPath $versionPath))
        bytes = 0
        value = $versionTrim
    }
    productionTree  = $prodTree
    dataTree        = $dataTree
    baselineDrift   = $drift
    disks           = @($disks)
    engineStateProbe = @($stateProbe)
    engineStateInInstall = [ordered]@{ path = $startupStatusInInstall; exists = $startupStatusExists }
    legacyInitialUpgrade = $legacyInitProbe
    backups         = @($backups)
    knownBackup     = $knownBackupProbe
    package         = $pkg
    packagePins     = @($pinResults)
    packagePinsAllMatch = $pinAllOk
    deliveryStatus  = $deliveryStatus
    notes           = @($script:notes)
    failures        = @($script:fails)
    ok              = ($script:fails.Count -eq 0)
}
if ($activationRaw) { $result.activation.rawLength = $activationRaw.Length }
if ($versionRaw) { $result.version.bytes = $versionRaw.Length }

$outFile = Join-Path $OutDir ('check-' + $stamp + '.json')
$json = $result | ConvertTo-Json -Depth 8
[IO.File]::WriteAllText($outFile, $json, (New-Object Text.UTF8Encoding($false)))

# --- console summary ---------------------------------------------------------
Write-Output ('== check-production  ' + $stamp + ' ==')
Write-Output ('install dir      : ' + $InstallDir)
Write-Output ('data dir         : ' + $DataDir)
Write-Output ('packages         : ' + $PackageRoot)
Write-Output ('processes        : ' + $procCount)
Write-Output ('version file     : ' + $(if ($versionTrim) { $versionTrim } else { '<missing>' }) + '   bytes=' + $result.version.bytes)
if ($activation) {
    Write-Output ('activation       : programVersion=' + $activation.programVersion + ' role=' + $activation.role + ' product=' + $activation.product)
} else {
    Write-Output ('activation       : <unreadable> ' + $activationErr)
}
Write-Output ('production tree  : ' + $prodTree.files + ' files / ' + $prodTree.bytes + ' bytes (baseline ' + $baseline.prodFiles + '/' + $baseline.prodBytes + ')')
Write-Output ('data tree        : ' + $dataTree.files + ' files / ' + $dataTree.bytes + ' bytes (baseline ' + $baseline.dataFiles + '/' + $baseline.dataBytes + ')')
foreach ($dk in $disks) { Write-Output ('disk ' + $dk.drive + ': free ' + $dk.freeGB + ' GB / total ' + $dk.totalGB + ' GB') }
Write-Output ('engine-state dirs: ' + $stateFound + ' found')
Write-Output ('known 1.6.2 backup: exists=' + $knownBackupProbe.exists + ' manifest=' + $knownBackupProbe.hasManifest)
Write-Output ('package pins     : allMatch=' + $pinAllOk)
foreach ($pr in $pinResults) { Write-Output ('  ' + $pr.id + ' match=' + $pr.match + ' ' + $pr.rel) }
if ($script:notes.Count -gt 0) { Write-Output '-- notes --'; foreach ($n in $script:notes) { Write-Output ('  * ' + $n) } }
if ($script:fails.Count -gt 0) { Write-Output '-- FAILURES --'; foreach ($f in $script:fails) { Write-Output ('  ! ' + $f) } }
Write-Output ('JSON -> ' + $outFile)
Write-Output ('RESULT: ' + $(if ($script:fails.Count -eq 0) { 'OK (ready for S5 preconditions)' } else { 'NOT READY' }))
if ($script:fails.Count -ne 0) { exit 1 }
exit 0
