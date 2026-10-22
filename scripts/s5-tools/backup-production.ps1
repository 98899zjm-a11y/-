# =============================================================================
# backup-production.ps1  --  S5 pre-upgrade FULL backup of program + business data
# -----------------------------------------------------------------------------
# Contract:
#   * DRY RUN by default: it only prints the plan. Nothing is copied unless
#     -Apply is passed on the command line by the operator/main controller.
#   * Copy engine: robocopy /E /MT:16 /R:1 /W:1 (exit 0..7 = success).
#   * After copying it writes a per-file sha256 manifest.json, then READS BACK
#     every copied file and compares size+sha256 against the source hashes.
#   * Never deletes or modifies anything under F:\ (source is opened read-only).
#   * Refuses to start while an xjy production process is running unless
#     -AllowRunning is given (a running app may write while copying).
#   * ASCII-only source: Chinese folder names are built from code points.
# Exit codes:
#   0 = success (dry run plan printed, or backup copied AND verified)
#   1 = failure (space, running process, robocopy, or hash mismatch)
# =============================================================================
[CmdletBinding()]
param(
    [switch]$Apply,
    [switch]$VerifyOnly,
    [string]$TargetRoot = 'D:\Codex\xjy-private-backups',
    [string]$NamePrefix = 'pre170-a15-',
    [string]$Stamp = '',
    [ValidateSet('Full', 'Sample', 'None')]
    [string]$VerifyMode = 'Full',
    [int]$SampleCount = 300,
    [switch]$AllowRunning,
    [double]$MinFreeGB = 12,
    [string]$InstallDir = '',
    [string]$DataDir = '',
    [string]$OutDir = ''
)

$ErrorActionPreference = 'Stop'

# U+81EA U+5236 U+8F6F U+4EF6 = "self-made software"
# U+946B U+91D1 U+6E90 U+73E0 U+5B9D = product short name ; + U+8D44 U+6599 = data folder
function U([int[]]$cp) { -join ($cp | ForEach-Object { [char]$_ }) }
$W_SOFT = U @(0x81EA, 0x5236, 0x8F6F, 0x4EF6)
$W_JEW  = U @(0x946B, 0x91D1, 0x6E90, 0x73E0, 0x5B9D)
$W_DATA = U @(0x946B, 0x91D1, 0x6E90, 0x73E0, 0x5B9D, 0x8D44, 0x6599)

if ([string]::IsNullOrEmpty($InstallDir)) { $InstallDir = 'F:\' + $W_SOFT + '\xjy-jewelry-offline' }
if ([string]::IsNullOrEmpty($DataDir))    { $DataDir = 'F:\' + $W_DATA }
if ([string]::IsNullOrEmpty($OutDir))     { $OutDir = Join-Path $PSScriptRoot 'out' }
if ([string]::IsNullOrEmpty($Stamp))      { $Stamp = Get-Date -Format 'yyyyMMdd-HHmmss' }

$BackupDir = Join-Path $TargetRoot ($NamePrefix + $Stamp)
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

# Enumerates every file under $Root, returns @{ relativePath; fullPath; size }.
function Get-FileInventory([string]$Root) {
    $items = New-Object System.Collections.ArrayList
    if (-not [IO.Directory]::Exists((ConvertTo-ExtendedPath $Root))) { return ,$items }
    $rootExt = ConvertTo-ExtendedPath $Root
    $rootPrefixLen = $rootExt.TrimEnd('\').Length + 1
    $stack = New-Object System.Collections.Stack
    $stack.Push($Root)
    $errs = 0
    while ($stack.Count -gt 0) {
        $d = [string]$stack.Pop()
        $ext = ConvertTo-ExtendedPath $d
        try { foreach ($sub in [IO.Directory]::GetDirectories($ext)) { $stack.Push($sub) } } catch { $errs++ }
        try {
            foreach ($f in [IO.Directory]::GetFiles($ext)) {
                $fext = ConvertTo-ExtendedPath $f
                $size = -1
                try { $size = ([IO.FileInfo]::new($fext)).Length } catch { }
                $rel = $fext.Substring($rootPrefixLen)
                [void]$items.Add([pscustomobject]@{ relativePath = $rel; fullPath = $f; size = $size })
            }
        } catch { $errs++ }
    }
    return ,$items
}

function Get-TreeStats([string]$Root) {
    $r = [ordered]@{ path = $Root; exists = $false; files = 0; bytes = 0; errors = 0 }
    if (-not [IO.Directory]::Exists((ConvertTo-ExtendedPath $Root))) { return $r }
    $r.exists = $true
    $stack = New-Object System.Collections.Stack
    $stack.Push($Root)
    while ($stack.Count -gt 0) {
        $d = [string]$stack.Pop()
        $ext = ConvertTo-ExtendedPath $d
        try { foreach ($sub in [IO.Directory]::GetDirectories($ext)) { $stack.Push($sub) } } catch { $r.errors++ }
        try {
            foreach ($f in [IO.Directory]::GetFiles($ext)) {
                try { $r.files++; $r.bytes += ([IO.FileInfo]::new($f)).Length } catch { $r.errors++ }
            }
        } catch { $r.errors++ }
    }
    return $r
}

function Get-XjyProductionProcesses {
    $list = New-Object System.Collections.ArrayList
    foreach ($p in (Get-Process -ErrorAction SilentlyContinue)) {
        $path = $null
        try { $path = $p.Path } catch { }
        $isProd = $false
        if ($path) {
            $lp = $path.ToLowerInvariant()
            if ($lp.Contains('\xjy-jewelry-offline\')) { $isProd = $true }
            if ($lp.Contains('\xjy-170-local\')) { $isProd = $true }
        }
        if ($p.ProcessName -like ('*' + $W_JEW + '*')) { $isProd = $true }
        if ($isProd -and $p.Id -eq $PID) { $isProd = $false }
        if ($isProd) {
            [void]$list.Add([ordered]@{ id = $p.Id; name = $p.ProcessName; path = $path })
        }
    }
    return ,$list
}

$script:fails = New-Object System.Collections.ArrayList
function Add-Fail([string]$s) { [void]$script:fails.Add($s); Write-Output ('  ! ' + $s) }

# --- 1. sources --------------------------------------------------------------
$modeLabel = 'DRY-RUN'
if ($Apply) { $modeLabel = 'APPLY' }
if ($VerifyOnly) { $modeLabel = 'VERIFY-ONLY' }
Write-Output ('== backup-production  stamp=' + $Stamp + '  mode=' + $modeLabel + ' ==')
$srcProg = Get-TreeStats $InstallDir
$srcData = Get-TreeStats $DataDir
if (-not $srcProg.exists) { Add-Fail ('Source program dir missing: ' + $InstallDir) }
if (-not $srcData.exists) { Add-Fail ('Source data dir missing: ' + $DataDir) }
if ($srcProg.errors -gt 0 -or $srcData.errors -gt 0) {
    Add-Fail ('Source enumeration reported errors (prog=' + $srcProg.errors + ' data=' + $srcData.errors + '); resolve ACL problems first.')
}
$totalBytes = $srcProg.bytes + $srcData.bytes
$totalFiles = $srcProg.files + $srcData.files
Write-Output ('source program : ' + $srcProg.files + ' files / ' + $srcProg.bytes + ' bytes')
Write-Output ('source data    : ' + $srcData.files + ' files / ' + $srcData.bytes + ' bytes')
Write-Output ('source total   : ' + $totalFiles + ' files / ' + $totalBytes + ' bytes')
Write-Output ('target backup  : ' + $BackupDir)

# Known-good 1.6.2 numbers, used only as an informational sanity comparison.
$baselineFiles = 4701
$baselineBytes = 4015026383
if ($totalFiles -ne $baselineFiles -or $totalBytes -ne $baselineBytes) {
    Write-Output ('  note: source differs from the recorded 1.6.2 baseline (' + $baselineFiles + ' files / ' + $baselineBytes + ' bytes). This is reported, not fatal.')
}

# --- 2. preconditions --------------------------------------------------------
$procs = Get-XjyProductionProcesses
if ($procs.Count -gt 0) {
    Write-Output ('running xjy processes: ' + $procs.Count)
    foreach ($p in $procs) { Write-Output ('  - pid=' + $p.id + ' name=' + $p.name + ' path=' + $p.path) }
    if (-not $AllowRunning) {
        Add-Fail 'An xjy production process is running. Close the business app completely (tray exit) before backing up, or pass -AllowRunning explicitly.'
    } else {
        Write-Output '  WARNING: -AllowRunning given; the copied data may be inconsistent.'
    }
} else {
    Write-Output 'running xjy processes: 0 (good)'
}

if ($VerifyOnly) {
    if (-not [IO.Directory]::Exists((ConvertTo-ExtendedPath $BackupDir))) {
        Add-Fail ('-VerifyOnly requires an existing backup dir, not found: ' + $BackupDir)
    }
} elseif ([IO.Directory]::Exists((ConvertTo-ExtendedPath $BackupDir))) {
    Add-Fail ('Target backup dir already exists, refusing to merge into it: ' + $BackupDir)
}

$needBytes = [long]($totalBytes * 1.02) + 314572800
try {
    $dDrive = New-Object IO.DriveInfo ((Split-Path -Qualifier $TargetRoot) + '\')
    $freeBytes = $dDrive.AvailableFreeSpace
    Write-Output ('target drive free: ' + [Math]::Round($freeBytes / 1GB, 1) + ' GB ; needed about ' + [Math]::Round($needBytes / 1GB, 2) + ' GB')
    if ($freeBytes -lt $needBytes) { Add-Fail 'Not enough free space on the target drive for this backup.' }
    if (($freeBytes / 1GB) -lt $MinFreeGB) { Add-Fail ('Free space below -MinFreeGB (' + $MinFreeGB + ' GB).') }
} catch { Write-Output ('  note: could not query target drive free space: ' + $_.Exception.Message) }

# --- 3. plan -----------------------------------------------------------------
# NOTE: PowerShell parses an unparenthesized "a + b" inside @(...) as TWO
# array elements, so every concatenation here is precomputed into a variable.
$rcLogProg = Join-Path $OutDir ('backup-' + $Stamp + '-program.robocopy.log')
$rcLogData = Join-Path $OutDir ('backup-' + $Stamp + '-data.robocopy.log')
$rcLogProgArg = '/LOG+:' + $rcLogProg
$rcLogDataArg = '/LOG+:' + $rcLogData
$rcProgArgs = @($InstallDir, (Join-Path $BackupDir 'program'), '/E', '/MT:16', '/R:1', '/W:1', '/COPY:DAT', '/DCOPY:DAT', '/XJ', '/NP', '/NFL', '/NDL', '/NJH', '/NJS', $rcLogProgArg)
$rcDataArgs = @($DataDir, (Join-Path $BackupDir 'data'), '/E', '/MT:16', '/R:1', '/W:1', '/COPY:DAT', '/DCOPY:DAT', '/XJ', '/NP', '/NFL', '/NDL', '/NJH', '/NJS', $rcLogDataArg)
Write-Output '-- plan --'
Write-Output ('  robocopy "' + $InstallDir + '" "' + (Join-Path $BackupDir 'program') + '" /E /MT:16 /R:1 /W:1 /COPY:DAT /DCOPY:DAT /XJ /NP')
Write-Output ('  robocopy "' + $DataDir + '" "' + (Join-Path $BackupDir 'data') + '" /E /MT:16 /R:1 /W:1 /COPY:DAT /DCOPY:DAT /XJ /NP')
Write-Output ('  verify mode: ' + $VerifyMode + $(if ($VerifyMode -eq 'Sample') { (' (sample of ' + $SampleCount + ' files)') } else { '' }))
Write-Output ('  manifest    : ' + (Join-Path $BackupDir 'manifest.json'))

if (-not $Apply -and -not $VerifyOnly) {
    Write-Output 'DRY RUN: nothing was copied. Re-run the same command with -Apply to perform the backup.'
    if ($script:fails.Count -gt 0) { exit 1 }
    exit 0
}

if ($script:fails.Count -gt 0) {
    Write-Output 'ABORT: preconditions failed, nothing was copied.'
    exit 1
}

# --- 4. copy -----------------------------------------------------------------
$sw = [Diagnostics.Stopwatch]::StartNew()
$rcProg = -1
$rcData = -1
$copySeconds = 0
if ($VerifyOnly) {
    Write-Output '-- verify-only: skipping copy, verifying the existing backup dir --'
} else {
    New-Item -ItemType Directory -Force -Path $BackupDir | Out-Null
    New-Item -ItemType Directory -Force -Path (Join-Path $BackupDir 'program') | Out-Null
    New-Item -ItemType Directory -Force -Path (Join-Path $BackupDir 'data') | Out-Null

    Write-Output '-- copying program --'
    & robocopy @rcProgArgs | Out-Null
    $rcProg = $LASTEXITCODE
    Write-Output ('  robocopy program exit code = ' + $rcProg)
    if ($rcProg -ge 8) { Add-Fail ('robocopy failed for program (exit ' + $rcProg + '), see the robocopy log.') }

    Write-Output '-- copying data --'
    & robocopy @rcDataArgs | Out-Null
    $rcData = $LASTEXITCODE
    Write-Output ('  robocopy data exit code = ' + $rcData)
    if ($rcData -ge 8) { Add-Fail ('robocopy failed for data (exit ' + $rcData + '), see the robocopy log.') }

    $copySeconds = [Math]::Round($sw.Elapsed.TotalSeconds, 1)
    Write-Output ('copy finished in ' + $copySeconds + ' s')
}

# --- 5. manifest + read-back verification ------------------------------------
function Invoke-Verification([string]$RootName, [string]$SourceRoot, [string]$TargetRoot, [string]$Mode, [int]$Sample, [System.Collections.ArrayList]$Entries) {
    $inv = Get-FileInventory $SourceRoot
    $total = $inv.Count
    Write-Output ('-- hashing ' + $RootName + ': ' + $total + ' files, mode=' + $Mode + ' --')

    $indexes = New-Object System.Collections.ArrayList
    if ($Mode -eq 'None') {
        Write-Output '  (hash verification disabled by -VerifyMode None)'
    } elseif ($Mode -eq 'Sample') {
        $n = [Math]::Min($Sample, $total)
        if ($n -le 0) { }
        else {
            $step = [Math]::Max([int]($total / $n), 1)
            for ($i = 0; $i -lt $total -and $indexes.Count -lt $n; $i += $step) { [void]$indexes.Add($i) }
        }
    } else {
        for ($i = 0; $i -lt $total; $i++) { [void]$indexes.Add($i) }
    }

    $checked = 0
    $mismatch = New-Object System.Collections.ArrayList
    $targetMissing = New-Object System.Collections.ArrayList
    $sourceFailures = 0
    $targetForIndex = @{}
    foreach ($idx in $indexes) { $targetForIndex[[int]$idx] = $true }

    $i = 0
    foreach ($item in $inv) {
        $i++
        if ($i % 500 -eq 0) { Write-Output ('  ... ' + $i + '/' + $total) }
        $wantHash = $null
        if ($Mode -ne 'None') {
            try { $wantHash = Get-Sha256Hex $item.fullPath } catch { $sourceFailures++; continue }
        }
        $targetPath = Join-Path $TargetRoot $item.relativePath
        $targetOk = $false
        $targetSize = -1
        $targetHash = $null
        if ([IO.File]::Exists((ConvertTo-ExtendedPath $targetPath))) {
            try {
                $targetSize = ([IO.FileInfo]::new((ConvertTo-ExtendedPath $targetPath))).Length
                if ($Mode -ne 'None') { $targetHash = Get-Sha256Hex $targetPath }
                $targetOk = $true
            } catch { $targetOk = $false }
        } else {
            [void]$targetMissing.Add($item.relativePath)
        }

        $record = [ordered]@{
            root = $RootName
            path = ($item.relativePath -replace '\\', '/')
            size = $item.size
            sha256 = $wantHash
        }
        [void]$Entries.Add($record)

        if ($Mode -ne 'None' -and $targetForIndex.ContainsKey($i - 1)) {
            $checked++
            if (-not $targetOk) {
                [void]$mismatch.Add([ordered]@{ path = $record.path; reason = 'target-missing-or-unreadable' })
            } elseif ($targetSize -ne $item.size) {
                [void]$mismatch.Add([ordered]@{ path = $record.path; reason = 'size'; source = $item.size; target = $targetSize })
            } elseif ($targetHash -ne $wantHash) {
                [void]$mismatch.Add([ordered]@{ path = $record.path; reason = 'sha256'; source = $wantHash; target = $targetHash })
            }
        }
    }
    return [ordered]@{
        root              = $RootName
        sourceFiles       = $total
        mode              = $Mode
        hashedFiles       = $checked
        sourceReadFailures = $sourceFailures
        targetMissing     = $targetMissing.Count
        mismatches        = $mismatch.Count
        mismatchSamples   = @($mismatch | Select-Object -First 20)
        missingSamples    = @($targetMissing | Select-Object -First 20)
    }
}

$entries = New-Object System.Collections.ArrayList
$vProg = Invoke-Verification 'program' $InstallDir (Join-Path $BackupDir 'program') $VerifyMode $SampleCount $entries
$vData = Invoke-Verification 'data' $DataDir (Join-Path $BackupDir 'data') $VerifyMode $SampleCount $entries

Write-Output ('program verify: hashed=' + $vProg.hashedFiles + '/' + $vProg.sourceFiles + ' mismatches=' + $vProg.mismatches + ' missing=' + $vProg.targetMissing + ' readFailures=' + $vProg.sourceReadFailures)
Write-Output ('data verify   : hashed=' + $vData.hashedFiles + '/' + $vData.sourceFiles + ' mismatches=' + $vData.mismatches + ' missing=' + $vData.targetMissing + ' readFailures=' + $vData.sourceReadFailures)
if ($vProg.mismatches -gt 0 -or $vData.mismatches -gt 0) { Add-Fail 'Read-back verification found mismatching files.' }
if ($vProg.sourceReadFailures -gt 0 -or $vData.sourceReadFailures -gt 0) { Add-Fail 'Some source files could not be hashed.' }

# --- 6. manifest + result ----------------------------------------------------
$targetProg = Get-TreeStats (Join-Path $BackupDir 'program')
$targetData = Get-TreeStats (Join-Path $BackupDir 'data')
if ($targetProg.files -ne $srcProg.files -or $targetProg.bytes -ne $srcProg.bytes) { Add-Fail ('Copied program tree size differs (files ' + $targetProg.files + ' vs ' + $srcProg.files + ', bytes ' + $targetProg.bytes + ' vs ' + $srcProg.bytes + ').') }
if ($targetData.files -ne $srcData.files -or $targetData.bytes -ne $srcData.bytes) { Add-Fail ('Copied data tree size differs (files ' + $targetData.files + ' vs ' + $srcData.files + ', bytes ' + $targetData.bytes + ' vs ' + $srcData.bytes + ').') }

$ok = ($script:fails.Count -eq 0)
$manifest = [ordered]@{
    schemaVersion  = 1
    tool           = 'backup-production.ps1'
    createdAt      = (Get-Date).ToString('o')
    stamp          = $Stamp
    backupDir      = $BackupDir
    sources        = [ordered]@{
        program = [ordered]@{ path = $InstallDir; files = $srcProg.files; bytes = $srcProg.bytes }
        data    = [ordered]@{ path = $DataDir; files = $srcData.files; bytes = $srcData.bytes }
    }
    copies         = [ordered]@{
        program = [ordered]@{ path = (Join-Path $BackupDir 'program'); files = $targetProg.files; bytes = $targetProg.bytes }
        data    = [ordered]@{ path = (Join-Path $BackupDir 'data'); files = $targetData.files; bytes = $targetData.bytes }
    }
    robocopyExit   = [ordered]@{ program = $rcProg; data = $rcData }
    copySeconds    = $copySeconds
    verify         = [ordered]@{
        mode                 = $VerifyMode
        program              = $vProg
        data                 = $vData
        allMatched           = $ok
    }
    totalFiles     = ($srcProg.files + $srcData.files)
    totalBytes     = ($srcProg.bytes + $srcData.bytes)
    entries        = @($entries)
    ok             = $ok
    failures       = @($script:fails)
}
$manifestPath = Join-Path $BackupDir 'manifest.json'
if (-not $VerifyOnly) {
    $json = $manifest | ConvertTo-Json -Depth 6
    [IO.File]::WriteAllText($manifestPath, $json, (New-Object Text.UTF8Encoding($false)))
    Write-Output ('manifest -> ' + $manifestPath + ' (' + ([IO.FileInfo]::new((ConvertTo-ExtendedPath $manifestPath))).Length + ' bytes)')
} else {
    Write-Output ('verify-only: existing manifest left untouched -> ' + $manifestPath)
}

$resultPath = Join-Path $OutDir ('backup-' + $Stamp + '.json')
$summary = [ordered]@{
    tool = 'backup-production.ps1'; stamp = $Stamp; apply = [bool]$Apply; backupDir = $BackupDir
    source = [ordered]@{ files = ($srcProg.files + $srcData.files); bytes = ($srcProg.bytes + $srcData.bytes) }
    robocopyExit = [ordered]@{ program = $rcProg; data = $rcData }
    verifyMode = $VerifyMode; program = $vProg; data = $vData
    copySeconds = $copySeconds; ok = $ok; failures = @($script:fails); finishedAt = (Get-Date).ToString('o')
}
[IO.File]::WriteAllText($resultPath, ($summary | ConvertTo-Json -Depth 6), (New-Object Text.UTF8Encoding($false)))

Write-Output ('verification manifest written; RESULT: ' + $(if ($ok) { 'BACKUP OK AND READ-BACK VERIFIED' } else { 'BACKUP FAILED' }))
Write-Output ('result -> ' + $resultPath)
if (-not $ok) { exit 1 }
exit 0
