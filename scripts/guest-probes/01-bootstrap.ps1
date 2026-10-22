# 01-bootstrap.ps1 - fresh first-install bootstrap INSIDE the Windows Sandbox.
#
# Runs as the sandbox account (never elevated separately: the account is already admin).
# What it does, in order:
#   1. create + attach a real VHDX and mount it as F:  (diskpart /s, idempotent)
#   2. icacls C:\ /remove:g *S-1-5-11
#   3. icacls F:\ /remove:g *S-1-5-11 /T /C /Q    (AFTER format: format restores default ACLs)
#   4. robocopy C:\XjyPackage C:\XjyLocal /E /MT:16 /R:1 /W:1
#   5. harden C:\XjyLocal: inheritance:r + grant (OI)(CI) for {SYSTEM, Administrators, me}
#      then a SECOND pass with an explicit F (no inheritance flags) on files, /T /C /Q
#   6. self-check: fsutil drivetype F:, entry script present, Get-Acl on C:\, F:\,
#      C:\XjyLocal (plus the entry file and the install/data roots when present)
#
# Writes C:\XjyResults\bootstrap.json (steps[], fDrive, packageCopied, aclProblems[], ok).
# Exit code 0 when ok is true, 1 otherwise. Any failing step is recorded and the JSON is
# still written; exceptions are never swallowed silently (they land in
# ok=false + failedStep + error + the console).
#
# ASCII-ONLY ON PURPOSE: Windows PowerShell 5.1 decodes BOM-less UTF-8 as ANSI, so literal
# CJK text in a .ps1 file is a syntax-error minefield. Every CJK path segment below is
# assembled from [char]0xXXXX code points instead. Keep this file 7-bit clean.
#
# Idempotent: an existing F: volume is reused (never reformatted), C:\XjyLocal is
# overwritten in place by robocopy, ACL passes simply re-apply.

$ErrorActionPreference = 'Stop'

# ---------------------------------------------------------------- code points
# [char]0x81EA 0x5236 0x8F6F 0x4EF6 = "zi zhi ruan jian"  (install root, level 1)
# [char]0x946B 0x91D1 0x6E90 0x73E0 0x5B9D 0x8D44 0x6599 = data root name
# [char]0x9996 0x6B21 0x5B89 0x88C5 0x4E3B 0x673A = entry script base name
function New-Text([int[]] $CodePoints) {
  $sb = New-Object System.Text.StringBuilder
  foreach ($cp in $CodePoints) { [void]$sb.Append([char]$cp) }
  return $sb.ToString()
}

$SelfMadeText = New-Text @(0x81EA, 0x5236, 0x8F6F, 0x4EF6)
$DataText     = New-Text @(0x946B, 0x91D1, 0x6E90, 0x73E0, 0x5B9D, 0x8D44, 0x6599)
$EntryBase    = New-Text @(0x9996, 0x6B21, 0x5B89, 0x88C5, 0x4E3B, 0x673A)

# ---------------------------------------------------------------- JSON writer
# Windows PowerShell 5.1 ships a ConvertTo-Json that is unsafe here: serializing a
# bare string inflates it enormously (a 136-char string came out as 31031 chars) and
# serializing a small report payload can stall for minutes. The report is therefore
# written by this tiny deterministic writer (dict/array/scalar only, invariant
# numbers, proper string escaping). It never recurses past 24 levels.
function ConvertTo-JsonText([string] $s) {
  if ($null -eq $s) { return 'null' }
  $sb = New-Object System.Text.StringBuilder
  [void]$sb.Append('"')
  foreach ($ch in $s.ToCharArray()) {
    $c = [int]$ch
    if ($c -eq 34) { [void]$sb.Append('\"') }
    elseif ($c -eq 92) { [void]$sb.Append('\\') }
    elseif ($c -eq 10) { [void]$sb.Append('\n') }
    elseif ($c -eq 13) { [void]$sb.Append('\r') }
    elseif ($c -eq 9) { [void]$sb.Append('\t') }
    elseif ($c -lt 32 -or $c -eq 127) { [void]$sb.Append('\u00' + $c.ToString('x2')) }
    else { [void]$sb.Append($ch) }
  }
  [void]$sb.Append('"')
  return $sb.ToString()
}

function ConvertTo-JsonString {
  param($Value, [int] $Depth = 0)
  if ($Depth -gt 24) { return '"..."' }
  if ($null -eq $Value) { return 'null' }
  if ($Value -is [bool]) { if ($Value) { return 'true' } else { return 'false' } }
  if ($Value -is [string]) { return (ConvertTo-JsonText $Value) }
  $pad  = ' ' * (2 * $Depth)
  $pad2 = ' ' * (2 * ($Depth + 1))
  if ($Value -is [System.Collections.IDictionary]) {
    if ($Value.Count -eq 0) { return '{}' }
    $parts = New-Object System.Collections.ArrayList
    foreach ($k in @($Value.Keys)) {
      [void]$parts.Add($pad2 + (ConvertTo-JsonText ([string]$k)) + ': ' + (ConvertTo-JsonString $Value[$k] ($Depth + 1)))
    }
    return ('{' + [char]10 + ($parts -join (',' + [char]10)) + [char]10 + $pad + '}')
  }
  if ($Value -is [System.Collections.IEnumerable]) {
    $parts = New-Object System.Collections.ArrayList
    foreach ($e in $Value) { [void]$parts.Add($pad2 + (ConvertTo-JsonString $e ($Depth + 1))) }
    if ($parts.Count -eq 0) { return '[]' }
    return ('[' + [char]10 + ($parts -join (',' + [char]10)) + [char]10 + $pad + ']')
  }
  if ($Value -is [System.ValueType]) {
    $numNames = @('System.Int16', 'System.Int32', 'System.Int64', 'System.UInt16', 'System.UInt32',
                  'System.UInt64', 'System.Double', 'System.Single', 'System.Decimal', 'System.Byte', 'System.SByte')
    if ($numNames -contains $Value.GetType().FullName) {
      return [string][System.Convert]::ToString($Value, [System.Globalization.CultureInfo]::InvariantCulture)
    }
    return (ConvertTo-JsonText ([string]$Value))
  }
  $props = @($Value.PSObject.Properties)
  if ($props.Count -gt 0) {
    $parts = New-Object System.Collections.ArrayList
    foreach ($p in $props) {
      [void]$parts.Add($pad2 + (ConvertTo-JsonText ([string]$p.Name)) + ': ' + (ConvertTo-JsonString $p.Value ($Depth + 1)))
    }
    return ('{' + [char]10 + ($parts -join (',' + [char]10)) + [char]10 + $pad + '}')
  }
  return (ConvertTo-JsonText ([string]$Value))
}

$ResultsDir  = 'C:\XjyResults'
$PkgSrc      = 'C:\XjyPackage'
$LocalRoot   = 'C:\XjyLocal'
$VhdxPath    = 'C:\XjyF.vhdx'
$EntryPath   = Join-Path $LocalRoot ($EntryBase + '.cmd')
$InstallRoot = 'F:\' + $SelfMadeText + '\xjy-jewelry-offline'
$DataRoot    = 'F:\' + $DataText

$JsonPath    = Join-Path $ResultsDir 'bootstrap.json'
$MkfPath     = Join-Path $ResultsDir 'mkf-bootstrap.txt'
$DpLogPath   = Join-Path $ResultsDir 'bootstrap-diskpart.log'
$RcLogPath   = Join-Path $ResultsDir 'bootstrap-robocopy.log'
$AclLogPath  = Join-Path $ResultsDir 'bootstrap-acl.log'

if (-not (Test-Path -LiteralPath $ResultsDir)) {
  New-Item -ItemType Directory -Path $ResultsDir -Force | Out-Null
}

$sid = ([Security.Principal.WindowsIdentity]::GetCurrent()).User.Value
$Utf8NoBom = New-Object System.Text.UTF8Encoding($false)

# ---------------------------------------------------------------- state
$script:Steps       = New-Object System.Collections.ArrayList
$script:Warnings    = New-Object System.Collections.ArrayList
$script:AclProblems = New-Object System.Collections.ArrayList
$script:Status      = [ordered]@{ fDrive = $null; packageCopied = $false; acl = @() }
$script:FailedStep  = $null

$script:AllowedSids = @($sid, 'S-1-5-18', 'S-1-5-32-544')

# ---------------------------------------------------------------- helpers
function Add-Warning([string] $Message) {
  [void]$script:Warnings.Add($Message)
}

function Invoke-Native {
  param([string] $FilePath, [string[]] $Arguments)
  $prev = $ErrorActionPreference
  # native stderr must not become a terminating error while $ErrorActionPreference is Stop
  $ErrorActionPreference = 'Continue'
  try {
    $text = (& $FilePath @Arguments 2>&1 | ForEach-Object { $_.ToString() } | Out-String)
    $code = $LASTEXITCODE
  } finally {
    $ErrorActionPreference = $prev
  }
  return [pscustomobject]@{ exitCode = $code; text = $text }
}

function Get-DriveState([string] $Letter) {
  try {
    $di = New-Object -TypeName System.IO.DriveInfo -ArgumentList $Letter
    $type = [string]$di.DriveType
    $ready = $false
    try { $ready = $di.IsReady } catch { $ready = $false }
    return [pscustomobject]@{ letter = ($Letter + ':'); type = $type; ready = $ready }
  } catch {
    return [pscustomobject]@{ letter = ($Letter + ':'); type = 'Unknown'; ready = $false }
  }
}

function Wait-Drive([string] $Letter, [int] $Seconds) {
  $deadline = (Get-Date).AddSeconds($Seconds)
  do {
    $d = Get-DriveState $Letter
    if ($d.type -eq 'Fixed' -and $d.ready) { return $d }
    Start-Sleep -Milliseconds 500
  } while ((Get-Date) -lt $deadline)
  return (Get-DriveState $Letter)
}

function Invoke-Step {
  param([string] $Name, [scriptblock] $Body)
  $sw = [Diagnostics.Stopwatch]::StartNew()
  $rec = [ordered]@{ name = $Name; ok = $false; exitCode = $null; detail = ''; error = ''; ms = 0 }
  try {
    $out = & $Body
    $rec.ok = $true
    if ($out -is [System.Collections.IDictionary]) {
      if ($out.Contains('detail')) { $rec.detail = [string]$out['detail'] }
      if ($out.Contains('exitCode')) { $rec.exitCode = [int]$out['exitCode'] }
    } elseif ($null -ne $out) {
      $rec.detail = [string]$out
    }
  } catch {
    $rec.error = ([string]($_ | Out-String)).Trim()
    $sw.Stop()
    $rec.ms = [int]$sw.ElapsedMilliseconds
    [void]$script:Steps.Add($rec)
    $script:FailedStep = $Name
    throw
  }
  $sw.Stop()
  $rec.ms = [int]$sw.ElapsedMilliseconds
  [void]$script:Steps.Add($rec)
  return $rec
}

# ---------------------------------------------------------------- ACL policy
# Mirrors the installer's Assert-AclPolicy (package: approval-tool \ Prepare-Repeat-Approval-170.ps1):
#   * allowed principals: current SID, S-1-5-18 (SYSTEM), S-1-5-32-544 (Administrators),
#     plus TrustedInstaller's SID - but only for the C:\ root when it is checked as an
#     ancestor, never for an approval directory or an arbitrary service SID;
#   * the owning SID must itself be one of the allowed principals;
#   * danger mask = DeleteSubdirectoriesAndFiles | Delete | ChangePermissions |
#     TakeOwnership, and additionally Write for the object itself; ancestors ignore
#     Write (so Windows volume-root Users CreateDirectories is not a violation) and
#     they skip InheritOnly rules, which cannot grant access to the object itself.
function Get-AncestorPaths([string] $Path) {
  $out = New-Object System.Collections.ArrayList
  $cur = $Path
  $isDir = $false
  try { $isDir = Test-Path -LiteralPath $cur -PathType Container } catch { $isDir = $false }
  if (-not $isDir) {
    $cur = [System.IO.Path]::GetDirectoryName($cur)
    if ([string]::IsNullOrEmpty($cur)) { return @() }
  }
  $cur = $cur.TrimEnd('\')
  $guard = 0
  while ($guard -lt 64 -and $cur.Length -gt 2) {
    $guard++
    $parent = [System.IO.Path]::GetDirectoryName($cur)
    if ([string]::IsNullOrEmpty($parent)) { break }
    [void]$out.Add($parent)
    if ([System.IO.Path]::GetPathRoot($parent) -eq $parent) { break }
    $cur = $parent
  }
  return @($out)
}

function Test-AclPath {
  param([string] $Path, [string] $Label, [bool] $Ancestor = $false)
  $item = [ordered]@{
    path = $Path; label = $Label; ancestor = $Ancestor; exists = $false
    owner = ''; ownerTrusted = $false
    ruleCount = 0; worldSidRules = 0; badRules = @(); error = ''
  }
  $item.exists = (Test-Path -LiteralPath $Path)
  if (-not $item.exists) { return $item }

  $allowed = @($script:AllowedSids)
  if ($Ancestor -and ($Path.TrimEnd('\') -eq 'C:')) {
    $allowed += 'S-1-5-80-956008885-3418522649-1831038044-1853292631-2271478464'
  }
  $danger = [Security.AccessControl.FileSystemRights]::DeleteSubdirectoriesAndFiles -bor
            [Security.AccessControl.FileSystemRights]::Delete -bor
            [Security.AccessControl.FileSystemRights]::ChangePermissions -bor
            [Security.AccessControl.FileSystemRights]::TakeOwnership
  if (-not $Ancestor) { $danger = $danger -bor [Security.AccessControl.FileSystemRights]::Write }

  try {
    $acl = Get-Acl -LiteralPath $Path
    $ownerSid = ''
    try { $ownerSid = $acl.GetOwner([Security.Principal.SecurityIdentifier]).Value } catch { $ownerSid = '' }
    $item.owner = $ownerSid
    $item.ownerTrusted = ($allowed -contains $ownerSid)
    if (-not $item.ownerTrusted) {
      $item.badRules += [ordered]@{ sid = $ownerSid; rights = 'OWNER'; inherited = $false; reason = 'owner-not-trusted' }
      [void]$script:AclProblems.Add([ordered]@{
        path = $Path; label = $Label; sid = $ownerSid; rights = 'OWNER'
        inherited = $false; reason = 'owner-not-trusted'
      })
    }

    $rules = @($acl.GetAccessRules($true, $true, [Security.Principal.SecurityIdentifier]))
    $item.ruleCount = $rules.Count
    foreach ($r in $rules) {
      if ($r.AccessControlType -ne [Security.AccessControl.AccessControlType]::Allow) { continue }
      $inheritOnly = (($r.PropagationFlags -band [Security.AccessControl.PropagationFlags]::InheritOnly) -ne 0)
      if ($Ancestor -and $inheritOnly) { continue }
      $sidText = $r.IdentityReference.Value
      $bits = [int]($r.FileSystemRights -band $danger)
      if ($sidText -eq 'S-1-5-11' -and $bits -ne 0) { $item.worldSidRules++ }
      if (($allowed -contains $sidText) -or $bits -eq 0) { continue }
      $reason = 'other-principal-write'
      if ($sidText -eq 'S-1-5-11') { $reason = 'world-write' }
      $item.badRules += [ordered]@{
        sid = $sidText; rights = [string]$r.FileSystemRights
        inherited = [bool]$r.IsInherited; reason = $reason
      }
      [void]$script:AclProblems.Add([ordered]@{
        path = $Path; label = $Label; sid = $sidText; rights = [string]$r.FileSystemRights
        inherited = [bool]$r.IsInherited; reason = $reason
      })
    }
    if ($rules.Count -eq 0) {
      # the "(OI)(CI) only" trap: files end up with an empty DACL -> "Access is denied"
      $item.badRules += [ordered]@{ sid = '*none*'; rights = ''; inherited = $false; reason = 'no-allow-rules' }
      [void]$script:AclProblems.Add([ordered]@{
        path = $Path; label = $Label; sid = '*none*'; rights = ''
        inherited = $false; reason = 'no-allow-rules'
      })
    }
  } catch {
    # an unreadable ACL must FAIL the selfcheck: silently reporting "0 rules" would
    # turn a blocked/acl-less path into a green light.
    $item.error = $_.Exception.Message
    $item.badRules += [ordered]@{ sid = '*error*'; rights = ''; inherited = $false; reason = 'acl-read-error' }
    [void]$script:AclProblems.Add([ordered]@{
      path = $Path; label = $Label; sid = '*error*'; rights = ''
      inherited = $false; reason = 'acl-read-error'
    })
  }
  return $item
}

# ---------------------------------------------------------------- main
$fatal = $null
try {

  Invoke-Step 'vhd-create-and-mount-F' {
    $drive = Get-DriveState 'F'
    if ($drive.type -eq 'Fixed' -and $drive.ready) {
      return @{ detail = 'F: already mounted as a fixed volume; vhd creation skipped (idempotent)' }
    }
    $vhdxExists = Test-Path -LiteralPath $VhdxPath
    $lines = New-Object System.Collections.ArrayList
    if (-not $vhdxExists) {
      [void]$lines.Add("create vdisk file=$VhdxPath maximum=8192 type=expandable")
      [void]$lines.Add("select vdisk file=$VhdxPath")
      [void]$lines.Add('attach vdisk')
      [void]$lines.Add('create partition primary')
      [void]$lines.Add('format fs=ntfs quick label=XjyF')
      [void]$lines.Add('assign letter=F')
    } else {
      # vhdx from an earlier run: attach only, NEVER reformat (that wipes data and ACLs)
      [void]$lines.Add("select vdisk file=$VhdxPath")
      [void]$lines.Add('attach vdisk')
    }
    [void]$lines.Add('exit')
    [System.IO.File]::WriteAllText($MkfPath, (($lines -join "`r`n") + "`r`n"), (New-Object System.Text.ASCIIEncoding))

    $r = Invoke-Native 'diskpart.exe' @('/s', $MkfPath)
    [System.IO.File]::WriteAllText($DpLogPath, $r.text, $Utf8NoBom)
    if ($r.exitCode -ne 0) {
      throw "diskpart failed with exit code $($r.exitCode); see $DpLogPath"
    }

    $drive = Wait-Drive 'F' 15
    if ($drive.type -ne 'Fixed') {
      # last resort: the partition may exist but the drive letter was released
      $fix = New-Object System.Collections.ArrayList
      [void]$fix.Add("select vdisk file=$VhdxPath")
      [void]$fix.Add('attach vdisk')
      [void]$fix.Add('select partition 1')
      [void]$fix.Add('assign letter=F')
      [void]$fix.Add('exit')
      $fixPath = Join-Path $ResultsDir 'mkf-bootstrap-assign.txt'
      [System.IO.File]::WriteAllText($fixPath, (($fix -join "`r`n") + "`r`n"), (New-Object System.Text.ASCIIEncoding))
      $r2 = Invoke-Native 'diskpart.exe' @('/s', $fixPath)
      [System.IO.File]::AppendAllText($AclLogPath, "== diskpart assign-letter retry exit=$($r2.exitCode)`r`n$($r2.text)`r`n", $Utf8NoBom)
      $drive = Wait-Drive 'F' 15
    }
    if ($drive.type -ne 'Fixed') {
      throw "F: is not a mounted fixed volume after diskpart (DriveType=$($drive.type), IsReady=$($drive.ready))"
    }
    return @{ detail = "F: mounted via VHDX (DriveType=$($drive.type), IsReady=$($drive.ready))" }
  } | Out-Null

  Invoke-Step 'acl-remove-world-from-C-root' {
    $r = Invoke-Native 'icacls.exe' @('C:\', '/remove:g', '*S-1-5-11')
    [System.IO.File]::AppendAllText($AclLogPath, "== icacls C:\ /remove:g *S-1-5-11 exit=$($r.exitCode)`r`n$($r.text)`r`n", $Utf8NoBom)
    if ($r.exitCode -ne 0) {
      Add-Warning "icacls C:\ /remove:g *S-1-5-11 returned $($r.exitCode) (benign when the SID is absent; the ACL self-check is authoritative)"
    }
    return @{ detail = "icacls exit $($r.exitCode); log $AclLogPath"; exitCode = $r.exitCode }
  } | Out-Null

  Invoke-Step 'acl-remove-world-from-F-root' {
    $drive = Get-DriveState 'F'
    if ($drive.type -ne 'Fixed') { throw 'F: is not mounted; refusing to ACL a missing volume' }
    $r = Invoke-Native 'icacls.exe' @('F:\', '/remove:g', '*S-1-5-11', '/T', '/C', '/Q')
    [System.IO.File]::AppendAllText($AclLogPath, "== icacls F:\ /remove:g *S-1-5-11 /T /C /Q exit=$($r.exitCode)`r`n$($r.text)`r`n", $Utf8NoBom)
    if ($r.exitCode -ne 0) {
      Add-Warning "icacls F:\ /remove:g *S-1-5-11 returned $($r.exitCode) (benign when the SID is absent; the ACL self-check is authoritative)"
    }
    return @{ detail = "icacls exit $($r.exitCode)"; exitCode = $r.exitCode }
  } | Out-Null

  Invoke-Step 'robocopy-package-to-local' {
    if (-not (Test-Path -LiteralPath $PkgSrc)) {
      throw "package source missing: $PkgSrc (is the package mapped read-only at C:\XjyPackage?)"
    }
    $r = Invoke-Native 'robocopy.exe' @($PkgSrc, $LocalRoot, '/E', '/MT:16', '/R:1', '/W:1')
    [System.IO.File]::WriteAllText($RcLogPath, $r.text, $Utf8NoBom)
    if ($r.exitCode -ge 8) {
      throw "robocopy failed with exit code $($r.exitCode); see $RcLogPath"
    }
    if (-not (Test-Path -LiteralPath $LocalRoot)) {
      throw "C:\XjyLocal does not exist after robocopy (exit $($r.exitCode))"
    }
    return @{ detail = "robocopy exit $($r.exitCode) (0-7 counts as success); log $RcLogPath"; exitCode = $r.exitCode }
  } | Out-Null

  Invoke-Step 'acl-harden-local-inherit-and-grant' {
    if (-not (Test-Path -LiteralPath $LocalRoot)) { throw "C:\XjyLocal is missing; run the robocopy step first" }
    $r = Invoke-Native 'icacls.exe' @(
      $LocalRoot, '/inheritance:r', '/grant:r',
      '*S-1-5-18:(OI)(CI)F', '*S-1-5-32-544:(OI)(CI)F', "*${sid}:(OI)(CI)F",
      '/T', '/C', '/Q')
    [System.IO.File]::AppendAllText($AclLogPath, "== icacls $LocalRoot inheritance:r + grant (OI)(CI) exit=$($r.exitCode)`r`n$($r.text)`r`n", $Utf8NoBom)
    if ($r.exitCode -ne 0) { throw "icacls inheritance:r/grant:r on C:\XjyLocal failed with exit code $($r.exitCode); see $AclLogPath" }
    return @{ detail = "icacls exit $($r.exitCode)"; exitCode = $r.exitCode }
  } | Out-Null

  Invoke-Step 'acl-harden-local-explicit-file-grants' {
    # (OI)(CI) alone leaves existing files with an EMPTY DACL -> "Access is denied".
    # A second pass without inheritance flags puts an explicit F on every file and dir.
    $r = Invoke-Native 'icacls.exe' @(
      $LocalRoot, '/grant:r',
      '*S-1-5-18:F', '*S-1-5-32-544:F', "*${sid}:F",
      '/T', '/C', '/Q')
    [System.IO.File]::AppendAllText($AclLogPath, "== icacls $LocalRoot explicit F /T /C /Q exit=$($r.exitCode)`r`n$($r.text)`r`n", $Utf8NoBom)
    if ($r.exitCode -ne 0) { throw "icacls explicit-F pass on C:\XjyLocal failed with exit code $($r.exitCode); see $AclLogPath" }
    return @{ detail = "icacls exit $($r.exitCode)"; exitCode = $r.exitCode }
  } | Out-Null

  Invoke-Step 'selfcheck' {
    $fsu = Invoke-Native 'fsutil.exe' @('fsinfo', 'drivetype', 'F:')
    $drive = Get-DriveState 'F'
    $script:Status.fDrive = [ordered]@{
      letter  = 'F:'
      fsutil  = ([string]$fsu.text).Trim()
      isFixed = ($drive.type -eq 'Fixed')
      ready   = [bool]$drive.ready
    }
    [System.IO.File]::AppendAllText($AclLogPath, "== fsutil fsinfo drivetype F: exit=$($fsu.exitCode)`r`n$($fsu.text)`r`n", $Utf8NoBom)

    $script:Status.packageCopied = (Test-Path -LiteralPath $EntryPath)

    # Every protected path is checked as an object AND with its whole ancestor chain
    # (ancestors use the weaker policy: no Write bit, InheritOnly rules skipped).
    # F:\ is the volume root that HOSTS the install/data roots, so it is an ancestor,
    # never a target object - exactly how the installer walks the chain.
    $targets = @(
      @{ p = $LocalRoot; l = 'local-copy' },
      @{ p = $EntryPath; l = 'entry-cmd' },
      @{ p = 'F:\';      l = 'vhd-root'; a = $true }
    )
    if (Test-Path -LiteralPath $InstallRoot) { $targets += @{ p = $InstallRoot; l = 'install-root' } }
    if (Test-Path -LiteralPath $DataRoot)    { $targets += @{ p = $DataRoot;    l = 'data-root' } }

    $aclSummaries = New-Object System.Collections.ArrayList
    $seen = @{}
    foreach ($t in $targets) {
      $selfAncestor = $false
      if ($t.ContainsKey('a')) { $selfAncestor = [bool]$t['a'] }
      $walk = New-Object System.Collections.ArrayList
      [void]$walk.Add(@{ p = [string]$t['p']; l = [string]$t['l']; a = $selfAncestor })
      foreach ($anc in @(Get-AncestorPaths ([string]$t['p']))) {
        [void]$walk.Add(@{ p = $anc; l = ([string]$t['l'] + ':ancestor'); a = $true })
      }
      foreach ($w in $walk) {
        $key = ([string]$w['p']).ToLowerInvariant() + '|' + [string]$w['a']
        if ($seen.ContainsKey($key)) { continue }
        $seen[$key] = $true
        $res = Test-AclPath ([string]$w['p']) ([string]$w['l']) ([bool]$w['a'])
        [void]$aclSummaries.Add([ordered]@{
          label         = $res['label']
          path          = $res['path']
          ancestor      = $res['ancestor']
          exists        = $res['exists']
          owner         = $res['owner']
          ownerTrusted  = $res['ownerTrusted']
          ruleCount     = $res['ruleCount']
          worldSidRules = $res['worldSidRules']
          badRuleCount  = @($res['badRules']).Count
          error         = $res['error']
        })
      }
    }
    $script:Status.acl = @($aclSummaries)

    if ($script:Status.packageCopied -eq $false) {
      throw "packaged entry script not found after robocopy: $EntryPath"
    }
    if (@($script:AclProblems).Count -gt 0) {
      $n = @($script:AclProblems).Count
      throw "ACL self-check found $n problem rule(s) along the protected paths and their ancestor chains; see aclProblems in $JsonPath"
    }
    if (-not $script:Status.fDrive.isFixed) {
      throw "fsutil reports F: is not a fixed drive: $($script:Status.fDrive.fsutil)"
    }
    if (Test-Path -LiteralPath $DataRoot) {
      Add-Warning "F:\ data root already exists - a FRESH first install will refuse with EXISTING_HOST_DATA. Do not create it by hand; if it is there, the sandbox image is not clean."
    }
    return @{ detail = "F: fixed, entry script present, 0 ACL problems across $(@($aclSummaries).Count) path checks" }
  } | Out-Null

} catch {
  $fatal = $_
}

# ---------------------------------------------------------------- report
$errorText = ''
if ($null -ne $fatal) {
  $errorText = ([string]($fatal | Out-String)).Trim()
  Write-Host ('FATAL: ' + $errorText)
}

$aclProblemCount = @($script:AclProblems).Count
$ok = ($null -eq $fatal) -and ($aclProblemCount -eq 0) -and
      ($script:Status.packageCopied -eq $true) -and
      ($null -ne $script:Status.fDrive) -and ($script:Status.fDrive.isFixed -eq $true)

$payload = [ordered]@{
  ok            = [bool]$ok
  failedStep    = $script:FailedStep
  error         = $errorText
  generatedAt   = (Get-Date).ToString('o')
  computerName  = $env:COMPUTERNAME
  user          = $env:USERNAME
  sid           = $sid
  paths         = [ordered]@{
    packageSource = $PkgSrc
    localCopy     = $LocalRoot
    entryScript   = $EntryPath
    vhdx          = $VhdxPath
    installRoot   = $InstallRoot
    dataRoot      = $DataRoot
    results       = $ResultsDir
  }
  fDrive        = $script:Status.fDrive
  packageCopied = [bool]$script:Status.packageCopied
  aclProblems   = @($script:AclProblems)
  aclChecks     = @($script:Status.acl)
  dataRootPresent = (Test-Path -LiteralPath $DataRoot)
  warnings      = @($script:Warnings)
  steps         = @($script:Steps)
}

$json = ConvertTo-JsonString $payload 0
[System.IO.File]::WriteAllText($JsonPath, ($json + [Environment]::NewLine), $Utf8NoBom)

Write-Host ''
Write-Host ("bootstrap.json -> $JsonPath")
Write-Host ("fDrive.isFixed     = $($payload.fDrive.isFixed)")
Write-Host ("packageCopied      = $($payload.packageCopied)")
Write-Host ("aclProblems        = $aclProblemCount")
Write-Host ("failedStep         = $($payload.failedStep)")

if ($ok) {
  Write-Host 'BOOTSTRAP-OK'
  exit 0
}
Write-Host ('BOOTSTRAP-FAILED step=' + [string]$payload.failedStep)
exit 1
