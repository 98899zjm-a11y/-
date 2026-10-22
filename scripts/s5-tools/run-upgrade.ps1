# =============================================================================
# run-upgrade.ps1  --  S5: drive the signed 1.7.0 host upgrade (package -> local copy -> installer)
# -----------------------------------------------------------------------------
# Contract:
#   * DRY RUN by default. Nothing is copied and the installer is NOT started
#     unless -Apply is given by the operator / main controller.
#   * The installer entry point is the signed  <package>\<one-click>.cmd  which
#     verifies the SHA256 of  <package>\<install-components>\native-delivery-170.ps1
#     and then runs it with -PackageRoot <root> -Action Upgrade.
#   * The installer MUST NOT be killed. This script never sets a timeout and
#     never terminates the child process: it waits as long as the installer
#     (and any failure MessageBox) needs. If it fails, keep the scene as-is and
#     use the installer's Recover action (see S5-checklist.md).
#   * Before copying, the package is verified against the 3288-entry manifest
#     embedded (base64) inside native-delivery-170.ps1  -> tamper detection.
#   * READ ONLY against F:\ : this script never writes to the production dir;
#     the installer does that, not us.
#   * ASCII-only source: Chinese folder names are built from code points.
# Exit codes:
#   0 = installer exited 0 (upgrade reported complete) -- still run verify-production.ps1
#   1 = preconditions refused / package check failed / copy failed
#   2 = installer exited non-zero (FAILED: do not kill, keep scene, use Recover)
#   3 = dry run plan printed
# =============================================================================
[CmdletBinding()]
param(
    [switch]$Apply,
    [string]$PackageRoot = 'D:\Codex\xjy-release-20261022\candidate\build\package',
    [string]$LocalRoot = '',
    [string]$InstallDir = '',
    [string]$DataDir = '',
    [string]$OutDir = '',
    [string]$Stamp = '',
    [ValidateSet('Full', 'Pins', 'None')]
    [string]$PackageCheck = 'Full',
    [switch]$SkipCopy,
    [switch]$SkipPackageCheck,
    [switch]$Preflight,
    [switch]$IgnoreRunningProcesses
)

$ErrorActionPreference = 'Stop'

# U+81EA U+5236 U+8F6F U+4EF6 = "self-made software"
# U+946B U+91D1 U+6E90 U+73E0 U+5B9D = product short name ; + U+8D44 U+6599 = data folder
# U+4E00 U+952E U+5347 U+7EA7 = "one click upgrade"
# U+5B89 U+88C5 U+7EC4 U+4EF6 = "install components"
# U+5B8C U+6574 U+7A0B U+5E8F = "complete program"
# U+53D7 U+4FE1 U+52A9 U+624B = "trusted helper"
# U+62A5 U+4EF7 = "quote"
function U([int[]]$cp) { -join ($cp | ForEach-Object { [char]$_ }) }
$W_SOFT     = U @(0x81EA, 0x5236, 0x8F6F, 0x4EF6)
$W_JEW      = U @(0x946B, 0x91D1, 0x6E90, 0x73E0, 0x5B9D)
$W_DATA     = U @(0x946B, 0x91D1, 0x6E90, 0x73E0, 0x5B9D, 0x8D44, 0x6599)
$W_UPGRADE  = U @(0x4E00, 0x952E, 0x5347, 0x7EA7)
$W_COMP     = U @(0x5B89, 0x88C5, 0x7EC4, 0x4EF6)
$W_PROGTREE = U @(0x5B8C, 0x6574, 0x7A0B, 0x5E8F)
$W_WORKER   = U @(0x53D7, 0x4FE1, 0x52A9, 0x624B)
$W_EXE      = $W_JEW + (U @(0x62A5, 0x4EF7)) + '.exe'

if ([string]::IsNullOrEmpty($InstallDir)) { $InstallDir = 'F:\' + $W_SOFT + '\xjy-jewelry-offline' }
if ([string]::IsNullOrEmpty($DataDir))    { $DataDir = 'F:\' + $W_DATA }
if ([string]::IsNullOrEmpty($OutDir))     { $OutDir = Join-Path $PSScriptRoot 'out' }
if ([string]::IsNullOrEmpty($Stamp))      { $Stamp = Get-Date -Format 'yyyyMMdd-HHmmss' }
if ([string]::IsNullOrEmpty($LocalRoot))  { $LocalRoot = Join-Path $env:LOCALAPPDATA 'xjy-170-local' }
New-Item -ItemType Directory -Force -Path $OutDir | Out-Null

# Approved candidate pins (measured 2026-10-22 on the release candidate).
$PIN_CMD     = '7a6e182cea080f704b1dd53f4a6672949af9aeedf708229c6ddd28cfeede436b'
$PIN_BOOT    = '15352a02337e4bae4db93f66b3255f23b997363bd17f80736db8d18cbc46480b'
$PIN_BINDING = '6552569b5f743c0aaf1f0a0afa59949626e93867cda0cd392b035578f4afc507'
$PIN_PEM     = 'bc6c3d2b42871e42d3eb91371034b410d507a228eeccb1d714acca60e8141b30'
$EXPECT_PROD_VERSION = '44.7.0'     # engine version of the 1.6.2 program
$EXPECT_PROD_PROGRAM = '1.6.2'
$TARGET_VERSION      = '1.7.0'
$TARGET_ENGINE       = '44.9.0'

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

function Read-TextFile([string]$Path, [int]$MaxBytes = 2097152) {
    if (-not [IO.File]::Exists((ConvertTo-ExtendedPath $Path))) { return $null }
    $fs = [IO.File]::Open((ConvertTo-ExtendedPath $Path), [IO.FileMode]::Open, [IO.FileAccess]::Read, [IO.FileShare]::ReadWrite)
    try {
        $len = [int][Math]::Min($fs.Length, $MaxBytes)
        $buf = New-Object byte[] $len
        [void]$fs.Read($buf, 0, $len)
        return ([Text.Encoding]::UTF8.GetString($buf))
    } finally { $fs.Dispose() }
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
        if ($isProd) { [void]$list.Add([ordered]@{ id = $p.Id; name = $p.ProcessName; path = $path }) }
    }
    return ,$list
}

$script:fails = New-Object System.Collections.ArrayList
function Add-Fail([string]$s) { [void]$script:fails.Add($s); Write-Output ('  ! ' + $s) }

$modeText = 'DRY-RUN'
if ($Apply) { $modeText = 'APPLY' }
Write-Output ('== run-upgrade  stamp=' + $Stamp + '  mode=' + $modeText + ' ==')
Write-Output ('package root : ' + $PackageRoot)
Write-Output ('local copy   : ' + $LocalRoot)
Write-Output ('install dir  : ' + $InstallDir)
Write-Output ('data dir     : ' + $DataDir)

# --- 1. package presence + pins ---------------------------------------------
$pkgExists = [IO.Directory]::Exists((ConvertTo-ExtendedPath $PackageRoot))
if (-not $pkgExists) { Add-Fail ('Candidate package root missing: ' + $PackageRoot) }

$cmdRel  = $W_UPGRADE + '.cmd'
$bootRel = $W_COMP + '\native-delivery-170.ps1'
$bindRel = 'engine-native170-binding.json'
$pemRel  = $W_WORKER + '\publisher-public.pem'

$pinSpecs = New-Object System.Collections.ArrayList
[void]$pinSpecs.Add([ordered]@{ id = 'upgrade-cmd'; rel = $cmdRel;  expected = $PIN_CMD })
[void]$pinSpecs.Add([ordered]@{ id = 'native-delivery'; rel = $bootRel; expected = $PIN_BOOT })
[void]$pinSpecs.Add([ordered]@{ id = 'binding'; rel = $bindRel; expected = $PIN_BINDING })
[void]$pinSpecs.Add([ordered]@{ id = 'publisher-pem'; rel = $pemRel; expected = $PIN_PEM })

$pinResults = New-Object System.Collections.ArrayList
$pinsOk = $true
if ($pkgExists -and $PackageCheck -ne 'None') {
    foreach ($spec in $pinSpecs) {
        $full = Join-Path $PackageRoot $spec.rel
        $entry = [ordered]@{ id = $spec.id; rel = $spec.rel; expected = $spec.expected }
        if (-not [IO.File]::Exists((ConvertTo-ExtendedPath $full))) {
            $entry['exists'] = $false; $entry['actual'] = $null; $entry['match'] = $false; $pinsOk = $false
        } else {
            $entry['exists'] = $true
            try {
                $act = Get-Sha256Hex $full
                $entry['actual'] = $act
                $entry['match'] = ($act -eq $spec.expected)
                if (-not $entry['match']) { $pinsOk = $false }
            } catch {
                $entry['actual'] = $null; $entry['match'] = $false; $entry['error'] = $_.Exception.Message; $pinsOk = $false
            }
        }
        [void]$pinResults.Add($entry)
        Write-Output ('  pin ' + $spec.id + ' match=' + $entry['match'] + '  ' + $spec.rel)
    }
    if (-not $pinsOk) { Add-Fail 'Package pins do not match the approved candidate. Do not upgrade with this package.' }
}

# --- 2. package manifest check (3288 embedded entries) ----------------------
function Invoke-PackageManifestCheck([string]$Root, [string]$BootRelPath) {
    $bootFull = Join-Path $Root $BootRelPath
    $result = [ordered]@{
        performed = $false; manifestEntries = 0; checked = 0; missing = 0; sizeMismatch = 0
        hashMismatch = 0; extraFiles = 0; ok = $false; samples = @()
    }
    if (-not [IO.File]::Exists((ConvertTo-ExtendedPath $bootFull))) {
        $result['error'] = 'bootstrap script not found'
        return $result
    }
    $text = Read-TextFile $bootFull 4194304
    if (-not $text) { $result['error'] = 'bootstrap script unreadable'; return $result }
    $rx = New-Object Text.RegularExpressions.Regex "FromBase64String\('([A-Za-z0-9\+/=]{1000,})'\)"
    $ms = $rx.Matches($text)
    if ($ms.Count -eq 0) { $result['error'] = 'embedded manifest block not found'; return $result }
    $best = $null
    foreach ($m in $ms) { if ($null -eq $best -or $m.Groups[1].Value.Length -gt $best.Length) { $best = $m.Groups[1].Value } }
    $json = [Text.Encoding]::UTF8.GetString([Convert]::FromBase64String($best))
    $rows = $json | ConvertFrom-Json
    $result.manifestEntries = $rows.Count
    Write-Output ('-- package manifest: ' + $rows.Count + ' entries, hashing files (about 1.8 GB, 1-3 min) --')

    $expected = New-Object 'System.Collections.Generic.HashSet[string]'
    $samples = New-Object System.Collections.ArrayList
    $i = 0
    foreach ($row in $rows) {
        $i++
        if ($i % 500 -eq 0) { Write-Output ('  ... ' + $i + '/' + $rows.Count) }
        $rel = [string]$row.path
        [void]$expected.Add(($rel -replace '\\', '/'))
        $local = $rel -replace '/', '\'
        $full = Join-Path $Root $local
        if (-not [IO.File]::Exists((ConvertTo-ExtendedPath $full))) {
            $result.missing++
            if ($samples.Count -lt 10) { [void]$samples.Add([ordered]@{ path = $rel; reason = 'missing' }) }
            continue
        }
        $len = ([IO.FileInfo]::new((ConvertTo-ExtendedPath $full))).Length
        if ($len -ne [long]$row.size) {
            $result.sizeMismatch++
            if ($samples.Count -lt 10) { [void]$samples.Add([ordered]@{ path = $rel; reason = 'size'; expected = [long]$row.size; actual = $len }) }
            continue
        }
        try { $h = Get-Sha256Hex $full } catch { $h = $null }
        $result.checked++
        if ($h -ne [string]$row.sha256) {
            $result.hashMismatch++
            if ($samples.Count -lt 10) { [void]$samples.Add([ordered]@{ path = $rel; reason = 'sha256'; expected = [string]$row.sha256; actual = $h }) }
        }
    }
    # extra files present on disk but absent from the signed manifest (informational)
    $stack = New-Object System.Collections.Stack
    $stack.Push($Root)
    $extra = 0
    $rootExt = ConvertTo-ExtendedPath $Root
    $rootLen = $rootExt.TrimEnd('\').Length + 1
    while ($stack.Count -gt 0) {
        $d = [string]$stack.Pop()
        $ext = ConvertTo-ExtendedPath $d
        try { foreach ($sub in [IO.Directory]::GetDirectories($ext)) { $stack.Push($sub) } } catch { }
        try {
            foreach ($f in [IO.Directory]::GetFiles($ext)) {
                $fext = ConvertTo-ExtendedPath $f
                $rel = ($fext.Substring($rootLen)) -replace '\\', '/'
                if (-not $expected.Contains($rel)) { $extra++ }
            }
        } catch { }
    }
    $result.extraFiles = $extra
    $result.samples = @($samples)
    $result.ok = (($result.missing + $result.sizeMismatch + $result.hashMismatch) -eq 0)
    $result.performed = $true
    return $result
}

$manifestCheck = $null
if ($pkgExists -and ($Apply -or $Preflight) -and $PackageCheck -eq 'Full' -and -not $SkipPackageCheck) {
    $manifestCheck = Invoke-PackageManifestCheck $PackageRoot $bootRel
    if (-not $manifestCheck.ok) {
        Add-Fail ('Package content check failed: missing=' + $manifestCheck.missing + ' sizeMismatch=' + $manifestCheck.sizeMismatch + ' hashMismatch=' + $manifestCheck.hashMismatch)
    } else {
        Write-Output ('  package manifest OK: ' + $manifestCheck.checked + ' files hashed, extra files not in manifest = ' + $manifestCheck.extraFiles)
    }
} elseif ($PackageCheck -eq 'Full') {
    Write-Output '  package manifest check: deferred to -Apply run (dry run keeps it fast)'
}

# --- 3. current production state -------------------------------------------
$prodVersion = $null
$prodVersionRaw = Read-TextFile (Join-Path $InstallDir 'version') 64
if ($prodVersionRaw) { $prodVersion = $prodVersionRaw.Trim() }
$prodActivation = $null
$prodActivationRaw = Read-TextFile (Join-Path $InstallDir 'xjy-install-activation.json') 65536
if ($prodActivationRaw) { try { $prodActivation = $prodActivationRaw | ConvertFrom-Json } catch { } }

$stateDirDerived = Join-Path (Split-Path -Parent $InstallDir) ('.' + (Split-Path -Leaf $InstallDir) + '.xjy-engine-state')
$stateDirExists = [IO.Directory]::Exists((ConvertTo-ExtendedPath $stateDirDerived))

Write-Output ('  production version file : ' + $(if ($prodVersion) { $prodVersion } else { '<missing>' }))
if ($prodActivation) {
    Write-Output ('  production activation   : programVersion=' + $prodActivation.programVersion + ' role=' + $prodActivation.role + ' product=' + $prodActivation.product)
    Write-Output ('  production installDir   : ' + $prodActivation.installationDir)
} else {
    Write-Output '  production activation   : <unreadable>'
}
Write-Output ('  engine state dir        : ' + $stateDirDerived + ' exists=' + $stateDirExists)

if ($prodVersion -and $prodVersion -ne $EXPECT_PROD_VERSION) {
    Add-Fail ('Production version file is ' + $prodVersion + ', expected ' + $EXPECT_PROD_VERSION + ' before this upgrade. If it is already 44.9.0 the upgrade ran; do not run it again.')
}
if ($prodActivation -and $prodActivation.programVersion -ne $EXPECT_PROD_PROGRAM) {
    Add-Fail ('Production activation programVersion is ' + $prodActivation.programVersion + ', expected ' + $EXPECT_PROD_PROGRAM + '.')
}
if ($prodActivation -and $prodActivation.role -ne 'host') {
    Add-Fail ('Production activation role is ' + $prodActivation.role + ', expected host. This is the employee package path, not the host upgrade.')
}
if ($stateDirExists) {
    Add-Fail ('An engine state dir already exists: a previous upgrade attempt has begun. Do NOT start another upgrade; inspect the journal and use the installer Recover action instead.')
}

# --- 4. running processes + disk ------------------------------------------
$procs = Get-XjyProductionProcesses
if ($procs.Count -gt 0) {
    Write-Output ('running xjy processes: ' + $procs.Count)
    foreach ($p in $procs) { Write-Output ('  - pid=' + $p.id + ' name=' + $p.name + ' path=' + $p.path) }
    if (-not $IgnoreRunningProcesses) {
        Add-Fail 'An xjy process is running. Exit the business app from the tray first; the installer requires it closed and running processes corrupt the file swap.'
    }
} else {
    Write-Output 'running xjy processes: 0 (good)'
}

$srcTree = Get-TreeStats $PackageRoot
$needBytes = [long]($srcTree.bytes * 1.02) + 524288000
try {
    $srcDrive = New-Object IO.DriveInfo (($env:LOCALAPPDATA.Substring(0, 2)) + '\')
    Write-Output ('  local copy needs about ' + [Math]::Round($needBytes / 1GB, 2) + ' GB on ' + $env:LOCALAPPDATA.Substring(0, 2) + ': (free ' + [Math]::Round($srcDrive.AvailableFreeSpace / 1GB, 1) + ' GB)')
    if ($srcDrive.AvailableFreeSpace -lt $needBytes) { Add-Fail 'Not enough free space in LOCALAPPDATA for the local package copy.' }
} catch { Write-Output ('  note: free space check skipped: ' + $_.Exception.Message) }

# --- 5. plan ---------------------------------------------------------------
if ($Preflight) {
    Write-Output '-- preflight only: package content + production state checked; nothing copied, installer not started --'
    if ($script:fails.Count -gt 0) {
        Write-Output '-- preflight FAILURES --'
        foreach ($f in $script:fails) { Write-Output ('  ! ' + $f) }
        Write-Output 'PREFLIGHT RESULT: NOT READY'
        exit 1
    }
    Write-Output 'PREFLIGHT RESULT: READY (pins + package manifest + production state OK)'
    exit 0
}
$localCmdPath = Join-Path $LocalRoot $cmdRel
$stdoutLog = Join-Path $OutDir ('upgrade-' + $Stamp + '.stdout.log')
$stderrLog = Join-Path $OutDir ('upgrade-' + $Stamp + '.stderr.log')
$mainLog   = Join-Path $OutDir ('upgrade-' + $Stamp + '.log')
$exitFile  = Join-Path $OutDir ('upgrade-' + $Stamp + '.exit.txt')
$jsonFile  = Join-Path $OutDir ('upgrade-' + $Stamp + '.json')

Write-Output '-- plan --'
Write-Output ('  1) robocopy "' + $PackageRoot + '" "' + $LocalRoot + '" /MIR /E /MT:16 /R:1 /W:1 /COPY:DAT /DCOPY:DAT /XJ /NP')
Write-Output ('  2) set XJY_DELIVERY_ROOT=' + $LocalRoot + '\')
Write-Output ('  3) run: ' + $localCmdPath + '   (working dir ' + $LocalRoot + ')')
Write-Output ('  4) capture stdout -> ' + $stdoutLog)
Write-Output ('              stderr -> ' + $stderrLog)
Write-Output ('              exit   -> ' + $exitFile)
Write-Output '  The installer shows its own progress window; a failure shows a modal dialog.'
Write-Output '  NEVER kill it: wait for it to return (this script waits without a timeout).'

if (-not $Apply) {
    Write-Output 'DRY RUN: nothing copied, installer not started. Re-run with -Apply to execute.'
    if ($script:fails.Count -gt 0) { exit 1 }
    exit 3
}
if ($script:fails.Count -gt 0) {
    Write-Output 'ABORT: preconditions failed. Nothing was copied and the installer was NOT started.'
    exit 1
}

# --- 6. copy package to a local scratch dir -------------------------------
$copySeconds = 0
$rcCopy = -1
if ($SkipCopy) {
    Write-Output '-- -SkipCopy: reusing the existing local copy --'
    if (-not [IO.File]::Exists((ConvertTo-ExtendedPath $localCmdPath))) { Add-Fail ('Local copy is missing ' + $localCmdPath + '; drop -SkipCopy.') }
} else {
    $sw = [Diagnostics.Stopwatch]::StartNew()
    Write-Output ('-- copying package to ' + $LocalRoot + ' --')
    $mirArgs = @($PackageRoot, $LocalRoot, '/MIR', '/E', '/MT:16', '/R:1', '/W:1', '/COPY:DAT', '/DCOPY:DAT', '/XJ', '/NP', '/NFL', '/NDL', '/NJH', '/NJS')
    & robocopy @mirArgs | Out-Null
    $rcCopy = $LASTEXITCODE
    $copySeconds = [Math]::Round($sw.Elapsed.TotalSeconds, 1)
    Write-Output ('  robocopy exit code = ' + $rcCopy + '  (' + $copySeconds + ' s)')
    if ($rcCopy -ge 8) { Add-Fail ('robocopy failed copying the package (exit ' + $rcCopy + ').') }
}
if ($script:fails.Count -gt 0) { Write-Output 'ABORT: local package copy failed; installer was NOT started.'; exit 1 }

# re-check the pins on the local copy: this is what actually runs
$localPinsOk = $true
foreach ($spec in $pinSpecs) {
    $lp = Join-Path $LocalRoot $spec.rel
    if (-not [IO.File]::Exists((ConvertTo-ExtendedPath $lp))) { $localPinsOk = $false; Add-Fail ('Local copy missing ' + $spec.rel); continue }
    $act = Get-Sha256Hex $lp
    if ($act -ne $spec.expected) { $localPinsOk = $false; Add-Fail ('Local copy pin mismatch for ' + $spec.rel + ' (copy corrupted?)') }
}
if (-not $localPinsOk) { Write-Output 'ABORT: local copy does not match the candidate pins; installer was NOT started.'; exit 1 }
Write-Output '  local copy pins: all match'

# --- 7. launch the installer (never killed, never timed out) ---------------
$env:XJY_DELIVERY_ROOT = $LocalRoot + '\'
$comspec = $env:ComSpec
if (-not $comspec) { $comspec = 'C:\Windows\System32\cmd.exe' }
$q = [char]34
# cmd /d /s /c ""<path to cmd file>""  -> the /s form keeps paths with spaces intact
$cmdLine = '/d /s /c ' + $q + $q + $localCmdPath + $q + $q

$startedAt = Get-Date
Write-Output ('-- starting installer at ' + $startedAt.ToString('o') + ' --')
Write-Output ('  command: ' + $comspec + ' ' + $cmdLine)
Write-Output ('  working dir: ' + $LocalRoot)
Write-Output '  waiting for the installer to finish (no timeout, do not kill it) ...'

$proc = $null
$launchError = $null
try {
    $proc = Start-Process -FilePath $comspec -ArgumentList $cmdLine -WorkingDirectory $LocalRoot `
        -RedirectStandardOutput $stdoutLog -RedirectStandardError $stderrLog -PassThru -NoNewWindow
} catch {
    $launchError = $_.Exception.Message
    Add-Fail ('Could not start the installer: ' + $launchError)
}
if ($null -eq $proc) { exit 1 }

$exited = $false
try { $exited = $proc.WaitForExit(-1) } catch { }
$exitCode = $null
try { $exitCode = $proc.ExitCode } catch { }
$finishedAt = Get-Date
$elapsed = [Math]::Round(($finishedAt - $startedAt).TotalMinutes, 2)
Write-Output ('-- installer finished at ' + $finishedAt.ToString('o') + ' after ' + $elapsed + ' min, exit code ' + $exitCode + ' --')

# --- 8. post-state ---------------------------------------------------------
Start-Sleep -Seconds 2
$postVersionRaw = Read-TextFile (Join-Path $InstallDir 'version') 64
$postVersion = $null
if ($postVersionRaw) { $postVersion = $postVersionRaw.Trim() }
$postActivationRaw = Read-TextFile (Join-Path $InstallDir 'xjy-install-activation.json') 65536
$postActivation = $null
if ($postActivationRaw) { try { $postActivation = $postActivationRaw | ConvertFrom-Json } catch { } }
$postStateDir = [IO.Directory]::Exists((ConvertTo-ExtendedPath $stateDirDerived))
$postJournal = [IO.File]::Exists((ConvertTo-ExtendedPath (Join-Path $stateDirDerived 'journal.json')))
$postStatus = [IO.File]::Exists((ConvertTo-ExtendedPath (Join-Path $stateDirDerived 'engine-startup-status.json')))

Write-Output ('  post version file : ' + $(if ($postVersion) { $postVersion } else { '<missing>' }))
if ($postActivation) { Write-Output ('  post activation   : programVersion=' + $postActivation.programVersion + ' role=' + $postActivation.role) }
Write-Output ('  post state dir    : exists=' + $postStateDir + ' journal=' + $postJournal + ' receipt=' + $postStatus)

$stdoutTail = @()
try { if ([IO.File]::Exists((ConvertTo-ExtendedPath $stdoutLog))) { $stdoutTail = @(Get-Content -LiteralPath $stdoutLog -Tail 40 -ErrorAction SilentlyContinue) } } catch { }
$stderrTail = @()
try { if ([IO.File]::Exists((ConvertTo-ExtendedPath $stderrLog))) { $stderrTail = @(Get-Content -LiteralPath $stderrLog -Tail 40 -ErrorAction SilentlyContinue) } } catch { }

$lines = New-Object System.Collections.ArrayList
[void]$lines.Add('upgrade run ' + $Stamp)
[void]$lines.Add('startedAt   ' + $startedAt.ToString('o'))
[void]$lines.Add('finishedAt  ' + $finishedAt.ToString('o'))
[void]$lines.Add('elapsedMin  ' + $elapsed)
[void]$lines.Add('exitCode    ' + $exitCode)
[void]$lines.Add('packageRoot ' + $PackageRoot)
[void]$lines.Add('localRoot   ' + $LocalRoot)
[void]$lines.Add('installDir  ' + $InstallDir)
[void]$lines.Add('versionBefore ' + $prodVersion)
[void]$lines.Add('versionAfter  ' + $postVersion)
[void]$lines.Add('stateDirAfter ' + $postStateDir)
[void]$lines.Add('robocopyExit  ' + $rcCopy)
[void]$lines.Add('--- stdout (tail) ---')
foreach ($l in $stdoutTail) { [void]$lines.Add([string]$l) }
[void]$lines.Add('--- stderr (tail) ---')
foreach ($l in $stderrTail) { [void]$lines.Add([string]$l) }
[IO.File]::WriteAllText($mainLog, ($lines -join "`r`n"), (New-Object Text.UTF8Encoding($false)))

$exitText = 'exitCode=' + $exitCode + "`r`n" + 'finishedAt=' + $finishedAt.ToString('o') + "`r`n"
[IO.File]::WriteAllText($exitFile, $exitText, (New-Object Text.UTF8Encoding($false)))

function Get-LogTailArray([string]$Path, [int]$Count) {
    $outArr = @()
    try { if ([IO.File]::Exists((ConvertTo-ExtendedPath $Path))) { $outArr = @(Get-Content -LiteralPath $Path -Tail $Count -ErrorAction SilentlyContinue) } } catch { }
    return ,$outArr
}

$summary = [ordered]@{
    tool          = 'run-upgrade.ps1'
    stamp         = $Stamp
    apply         = [bool]$Apply
    packageRoot   = $PackageRoot
    localRoot     = $LocalRoot
    localCmdPath  = $localCmdPath
    installDir    = $InstallDir
    pins          = @($pinResults)
    pinsOk        = $pinsOk
    packageCheck  = $manifestCheck
    versionBefore = $prodVersion
    activationBefore = $prodActivation
    robocopyExit  = $rcCopy
    copySeconds   = $copySeconds
    startedAt     = $startedAt.ToString('o')
    finishedAt    = $finishedAt.ToString('o')
    elapsedMinutes = $elapsed
    processId     = $proc.Id
    exited        = $exited
    exitCode      = $exitCode
    versionAfter  = $postVersion
    activationAfter = $postActivation
    stateDirAfter = [ordered]@{ path = $stateDirDerived; exists = $postStateDir; journal = $postJournal; receipt = $postStatus }
    stdoutTail    = @($stdoutTail)
    stderrTail    = @($stderrTail)
    log           = $mainLog
    exitFile      = $exitFile
    failures      = @($script:fails)
}
[IO.File]::WriteAllText($jsonFile, ($summary | ConvertTo-Json -Depth 8), (New-Object Text.UTF8Encoding($false)))

Write-Output ('log     -> ' + $mainLog)
Write-Output ('exit    -> ' + $exitFile)
Write-Output ('json    -> ' + $jsonFile)
if ($stdoutTail.Count -gt 0) { Write-Output '-- installer stdout (tail) --'; foreach ($l in $stdoutTail) { Write-Output ('  ' + $l) } }
if ($stderrTail.Count -gt 0) { Write-Output '-- installer stderr (tail) --'; foreach ($l in $stderrTail) { Write-Output ('  ' + $l) } }

if ($exitCode -eq 0) {
    Write-Output 'RESULT: installer reported success (exit 0).'
    Write-Output 'NEXT: run verify-production.ps1 -- note that engine-startup-status businessReleased may still be false until the 1.7.0 program starts once.'
    exit 0
}

Write-Output 'RESULT: installer reported FAILURE (non-zero exit).'
Write-Output '  * Do NOT kill anything, do NOT delete the state dir, keep the scene as-is.'
Write-Output '  * Read the log above and ' + $stdoutLog
Write-Output '  * Then run verify-production.ps1 to see which phase is recorded, and follow the Recover procedure in S5-checklist.md.'
exit 2
