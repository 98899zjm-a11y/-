param([ValidateSet('run','guard','guard-negative','writer')][string]$Mode='run',[string]$FixtureId='')
# Every executable invocation first obtains actual WDAG/F/network evidence.
$contextText = & 'C:\Python314\python.exe' '-I' '-B' 'C:\xjy-work\xjy-web-stage1\stage1\validate-sandbox-context.py'
if ($LASTEXITCODE -ne 0) { throw 'ACTUAL_SANDBOX_GUARD_REFUSED: no fixture/native action occurred' }
$actualContext = $contextText | ConvertFrom-Json
$ErrorActionPreference='Stop';Set-StrictMode -Version Latest
$root='C:\xjy-work\xjy-web-stage1'
$systemPS='C:\Windows\System32\WindowsPowerShell\v1.0\powershell.exe'
function Plain([string]$Path,[bool]$Directory=$false){$full=[IO.Path]::GetFullPath($Path);if($Path -ne $full -or $Path.StartsWith('\\') -or $Path.Substring(2).Contains(':')){throw 'PATH_ALIAS_REFUSED'};$walk=$full;while($walk){$item=Get-Item -LiteralPath $walk -Force;if(($item.Attributes -band [IO.FileAttributes]::ReparsePoint) -ne 0){throw 'PATH_REPARSE_REFUSED'};if($walk -ne $full -and !$item.PSIsContainer){throw 'BAD_PARENT'};$parent=[IO.Directory]::GetParent($walk);if(!$parent){break};$walk=$parent.FullName};$target=Get-Item -LiteralPath $full -Force;if([bool]$target.PSIsContainer -ne $Directory){throw 'BAD_PATH_TYPE'};return $full}
function SHA([string]$File){$stream=[IO.File]::Open((Plain $File),[IO.FileMode]::Open,[IO.FileAccess]::Read,[IO.FileShare]::Read);$hash=[Security.Cryptography.SHA256]::Create();try{return ([BitConverter]::ToString($hash.ComputeHash($stream))).Replace('-','').ToLowerInvariant()}finally{$hash.Dispose();$stream.Dispose()}}
$policies=@(Get-ExecutionPolicy -List);foreach($scope in @('MachinePolicy','UserPolicy')){if(($policies|Where-Object {$_.Scope -eq $scope}).ExecutionPolicy -ne 'Undefined'){throw 'GROUP_POLICY_REFUSED: do not change machine/user execution policy'}}
if($Mode -eq 'run'){
 $out=Join-Path $root 'reports\candidate-initial-native-probe';[void](Plain (Join-Path $root 'reports') $true);if(Test-Path -LiteralPath $out){[void](Plain $out $true)};[IO.Directory]::CreateDirectory($out)|Out-Null;[void](Plain $out $true)
 $engineProofPath=Join-Path $root 'reports\candidate-engine-probe\result.json'
 try{
  $engineProof=([IO.File]::ReadAllText((Plain $engineProofPath),[Text.Encoding]::UTF8))|ConvertFrom-Json
  if($engineProof.passed -ne $true -or $engineProof.runAsNodeObserved -ne $true -or $engineProof.backupSupported -ne $true -or $engineProof.backupIntegrity -ne 'ok' -or $engineProof.sourceEngineSha256 -ne 'db3ad2066a55546f9b6737da3c7f011370e4856fb36888055b544d45653e4f40' -or $engineProof.sourceEngineSize -ne 246302720 -or $engineProof.engineAllowlistSha256 -ne '6893a279e6ab2ccaae36c9c66fd8c840ef4dacddc9cd9c78c24f87dd3f311ea4'){throw 'UPSTREAM_ACTUAL_ENGINE_PROOF_MISSING'}
  if((SHA (Join-Path $root 'release-candidate\engine-allowlist.json')) -ne '6893a279e6ab2ccaae36c9c66fd8c840ef4dacddc9cd9c78c24f87dd3f311ea4' -or (SHA (Join-Path $root 'release-candidate\release-manifest.json')) -ne 'c82426dc5463f2b5f0b366dd7c7e0ac09ec9d542bc9b81866997ecbc0cf9efd9'){throw 'FIXED_CANDIDATE_INPUT_CHANGED'}
  $exe=Plain (Join-Path $root 'release-candidate\鑫金源珠宝报价.exe');if((Get-Item -LiteralPath $exe).Length -ne 246302720 -or (SHA $exe) -ne $engineProof.sourceEngineSha256){throw 'ACTUAL_ENGINE_BYTES_CHANGED'}
  $nodeScript=Plain (Join-Path $root 'stage1\candidate-initial-native-probe.cjs')
  $psi=New-Object Diagnostics.ProcessStartInfo;$psi.FileName=$exe;$psi.Arguments='"'+$nodeScript+'"';$psi.WorkingDirectory=Join-Path $root 'release-candidate';$psi.UseShellExecute=$false;$psi.CreateNoWindow=$true;$psi.RedirectStandardOutput=$true;$psi.RedirectStandardError=$true;$psi.EnvironmentVariables.Clear()
  foreach($name in @('SystemRoot','WINDIR','TEMP','TMP','LOCALAPPDATA','APPDATA','USERPROFILE')){$value=[Environment]::GetEnvironmentVariable($name);if($value){$psi.EnvironmentVariables[$name]=$value}};$psi.EnvironmentVariables['ELECTRON_RUN_AS_NODE']='1';$psi.EnvironmentVariables['PSModulePath']='C:\Windows\System32\WindowsPowerShell\v1.0\Modules'
  $p=[Diagnostics.Process]::Start($psi);$stdoutTask=$p.StandardOutput.ReadToEndAsync();$stderrTask=$p.StandardError.ReadToEndAsync();$p.WaitForExit();[IO.File]::WriteAllText((Join-Path $out 'stdout.txt'),$stdoutTask.Result,[Text.UTF8Encoding]::new($false));[IO.File]::WriteAllText((Join-Path $out 'stderr.txt'),$stderrTask.Result,[Text.UTF8Encoding]::new($false));exit $p.ExitCode
 }catch{
  $record=@{version=1;purpose='candidate-initial-native-probe';status='NOT_RUN';passed=$false;actualCheckPassed=$false;actualContext=$actualContext;reason=$_.Exception.Message;shippingLiteralFPositiveVerified=$false;ownedFixtureLockCodeVerified=$false;sourcePolicyEligibility=@{formalApproval=$false;shippingInitialInstallerFullyVerified=$false};tests=@();counters=@{nativeCalls=0;forcedStops=0;productionWrites=0}}
  [IO.File]::WriteAllText((Join-Path $out 'result.json'),($record|ConvertTo-Json -Depth 12),[Text.UTF8Encoding]::new($false));[IO.File]::WriteAllText((Join-Path $out 'stderr.txt'),$_.Exception.ToString(),[Text.UTF8Encoding]::new($false));exit 1
 }
}
if($FixtureId -notmatch '^[a-f0-9]{8}-[a-f0-9]{4}-4[a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$'){throw 'FIXED_OWNED_FIXTURE_REQUIRED'}
$fixture=Plain (Join-Path $root ('runtime\candidate-initial-native-probe\'+$FixtureId)) $true
$guard=Plain (Join-Path $root 'delivery-tools\Initial-Path-Guard.ps1')
if((SHA $guard) -ne '4b51ba8e7300e0ce8875dcb2a3b060622d84f81459b8cc758d16c4f94eb3f8d7'){throw 'FROZEN_NATIVE_GUARD_CHANGED'}
. $guard
$held=New-Object 'Collections.Generic.List[IDisposable]'
try{
 if($Mode -eq 'writer'){
  $file=Plain (Join-Path $fixture 'host\工作室数据\jewelry.sqlite');$stream=[IO.File]::Open($file,[IO.FileMode]::Open,[IO.FileAccess]::ReadWrite,[IO.FileShare]::ReadWrite);$held.Add($stream);[Console]::Out.WriteLine('{"ready":true,"stage":"rw-writer-open","opens":1,"writes":0}');[Console]::Out.Flush();[void][Console]::In.ReadLine()
 }elseif($Mode -eq 'guard'){
  $dir=Plain (Join-Path $fixture 'protected') $true;$file=Plain (Join-Path $dir 'fixed-tool.cjs');$held.Add((Pin-PlainDirectory $dir));$held.Add((Pin-PlainFile $file));[Console]::Out.WriteLine('{"ready":true,"stage":"native-fixed-tool-pinned","filePins":1,"directoryPins":1}');[Console]::Out.Flush();[void][Console]::In.ReadLine()
 }else{
  $denied=0;foreach($name in @('alias-dir\alias-file.cjs','hardlink-file.cjs')){try{$pin=Pin-PlainFile (Join-Path $fixture $name);$pin.Dispose()}catch{$denied++}};[Console]::Out.WriteLine((@{ready=$true;stage='native-alias-rejection';attempts=2;denied=$denied}|ConvertTo-Json -Compress));if($denied -ne 2){exit 1}
 }
}finally{for($i=$held.Count-1;$i -ge 0;$i--){$held[$i].Dispose()}}
