# Guest-only native function probe. This is not the reviewer GUI or an approval.
# Do not execute on the host. No business EXE, IO adapter or KnownFolder is used.
$ErrorActionPreference='Stop'
Set-StrictMode -Version Latest
$guestRoot='C:\xjy-work\xjy-web-stage1'
$fixedCpython='C:\Python314\python.exe'
$expectedSourceSha256='638480e6a7e393220d6b702df8a44b447394b84d4d29257d00377425210ee129'
if($PSScriptRoot -cne ($guestRoot+'\stage1')){throw 'FIXED_GUEST_ROOT_REQUIRED: no native action or file creation occurred'}
if($PSVersionTable.PSEdition -ne 'Desktop' -or $PSVersionTable.PSVersion.Major -ne 5){throw 'WINDOWS_POWERSHELL_5_REQUIRED'}

# This existing admission entry reads the actual WDAG/VM/F-absence/network proof.
# -I ignores Python environment hooks; -B prevents any pyc write.
$contextText=@(& $fixedCpython -I -B ($guestRoot+'\stage1\validate-sandbox-context.py'))
if($LASTEXITCODE -ne 0){throw 'ACTUAL_SANDBOX_GUARD_REFUSED: no native action or file creation occurred'}
$actualContext=($contextText -join [Environment]::NewLine)|ConvertFrom-Json
if($actualContext.model -cne 'Virtual Machine' -or $actualContext.productionDrivePresent -ne $false -or $actualContext.nonLoopbackAddressCount -ne 0 -or $actualContext.inputMarkerPresent -ne $true -or $actualContext.userName -notmatch '(?i)\\WDAGUtilityAccount$'){throw 'ACTUAL_SANDBOX_PROOF_REFUSED'}

function Assert-ProbePlain([string]$Name,[bool]$Missing=$false){
 if(!$Name -or $Name -cne [IO.Path]::GetFullPath($Name) -or $Name -notmatch '^[A-Za-z]:\\' -or $Name.Substring(2).Contains(':') -or $Name -match '[\x00-\x1f"<>|?*]'){throw 'PROBE_NONCANONICAL_PATH'}
 $walk=$Name
 while($walk){
  if(Test-Path -LiteralPath $walk){$item=Get-Item -LiteralPath $walk -Force;if(($item.Attributes -band [IO.FileAttributes]::ReparsePoint) -ne 0 -or $item.LinkType){throw 'PROBE_REPARSE_PATH'};if($walk -cne $Name -and !$item.PSIsContainer){throw 'PROBE_PARENT_NOT_DIRECTORY'}}elseif(!$Missing -or $walk -cne $Name){throw 'PROBE_MISSING_PATH'}
  $parent=[IO.Directory]::GetParent($walk);if(!$parent){break};$walk=$parent.FullName
 }
 return $Name
}
function Assert-ProbeTarget([string]$Base,[string]$Name,[bool]$Missing=$false){
 if($Name -cne [IO.Path]::GetFullPath($Name) -or !($Name.Equals($Base,[StringComparison]::OrdinalIgnoreCase) -or $Name.StartsWith($Base+'\',[StringComparison]::OrdinalIgnoreCase))){throw 'PROBE_WRITE_BOUNDARY_REFUSED'}
 [void](Assert-ProbePlain $Name $Missing)
 return $Name
}
function New-ProbeDirectory([string]$Base,[string]$Name){
 [void](Assert-ProbeTarget $Base $Name $true)
 if(Test-Path -LiteralPath $Name){throw 'PROBE_FRESH_DIRECTORY_REQUIRED'}
 [void][IO.Directory]::CreateDirectory($Name)
 [void](Assert-ProbeTarget $Base $Name)
 return $Name
}
function Write-ProbeNewBytes([string]$Base,[string]$Name,[byte[]]$Bytes){
 [void](Assert-ProbeTarget $Base $Name $true)
 $stream=[IO.File]::Open($Name,[IO.FileMode]::CreateNew,[IO.FileAccess]::Write,[IO.FileShare]::None)
 try{$stream.Write($Bytes,0,$Bytes.Length);$stream.Flush($true)}finally{$stream.Dispose()}
 [void](Assert-ProbeTarget $Base $Name)
}
function Get-ProbeHash([byte[]]$Bytes){$hash=[Security.Cryptography.SHA256]::Create();try{return ([BitConverter]::ToString($hash.ComputeHash($Bytes))).Replace('-','').ToLowerInvariant()}finally{$hash.Dispose()}}
function Assert-Probe([bool]$Condition,[string]$Message){if(!$Condition){throw $Message}}
function Get-ProbeRejectedNativeCode([scriptblock]$Action,[int[]]$AllowedCodes,[string]$Message){
 $code=$null
 try{& $Action}catch{
  $cause=$_.Exception;while($cause.InnerException){$cause=$cause.InnerException}
  $nativeCode=$cause.HResult -band 65535
  if(($cause -isnot [IO.IOException] -and $cause -isnot [UnauthorizedAccessException]) -or $nativeCode -notin $AllowedCodes){throw ('UNEXPECTED_NATIVE_REJECTION: '+$cause.Message)}
  $code=[int]$nativeCode
 }
 if($null -eq $code){throw $Message}
 return $code
}
function Assert-ProbePinEvidence($Controls,$Codes){
 foreach($name in @('beforeWrite','beforeFileRename','beforeParentRename','afterWrite','afterFileRename','afterParentRename')){if($Controls[$name] -isnot [bool] -or !$Controls[$name]){throw ('PIN_POSITIVE_CONTROL_REQUIRED: '+$name)}}
 if($Codes.write -isnot [int] -or $Codes.write -ne 32 -or $Codes.fileRename -isnot [int] -or $Codes.fileRename -notin @(5,32) -or $Codes.parentRename -isnot [int] -or $Codes.parentRename -notin @(5,32)){throw 'PIN_NATIVE_REJECTION_CODES_REQUIRED'}
 return @{positiveControlsBeforeAndAfter=$true;writeRejectionWin32=$Codes.write;fileRenameRejectionWin32=$Codes.fileRename;parentRenameRejectionWin32=$Codes.parentRename;writeOpenAfterPinRejected=$true;fileRenameRejected=$true;parentRenameRejected=$true}
}
function Get-ProbeOutcome($Tests,[int]$ExpectedCount){
 if($Tests.Count -ne $ExpectedCount -or @($Tests|Where-Object {$_.status -notin @('PASS','FAIL','BLOCKED')}).Count){return @{status='FAIL';passed=$false}}
 if(@($Tests|Where-Object {$_.status -ceq 'FAIL'}).Count){return @{status='FAIL';passed=$false}}
 if(@($Tests|Where-Object {$_.status -ceq 'BLOCKED'}).Count){return @{status='BLOCKED';passed=$false}}
 return @{status='PASS';passed=$true}
}

[void](Assert-ProbePlain $guestRoot)
$runtime=$guestRoot+'\runtime'
[void](Assert-ProbePlain $runtime)
Assert-Probe ([bool](Get-Item -LiteralPath $runtime -Force).PSIsContainer) 'PROBE_RUNTIME_DIRECTORY_REQUIRED'
$sourcePath=$guestRoot+'\delivery-approval\Prepare-Initial-Approval.ps1'
[void](Assert-ProbePlain $sourcePath)
$sourcePin=[IO.File]::Open($sourcePath,[IO.FileMode]::Open,[IO.FileAccess]::Read,[IO.FileShare]::Read)
try{
 if($sourcePin.Length -gt 131072){throw 'PROBE_SOURCE_TOO_LARGE'}
 $sourceBytes=New-Object byte[] ([int]$sourcePin.Length);$read=0
 while($read -lt $sourceBytes.Length){$got=$sourcePin.Read($sourceBytes,$read,$sourceBytes.Length-$read);if(!$got){throw 'PROBE_SOURCE_TRUNCATED'};$read+=$got}
 if((Get-ProbeHash $sourceBytes) -cne $expectedSourceSha256){throw 'FIXED_REVIEWER_SOURCE_SHA256_REFUSED'}
 $utf8=New-Object Text.UTF8Encoding($false,$true)
 $source=$utf8.GetString($sourceBytes).TrimStart([char]0xfeff)
 $tokens=$null;$parseErrors=$null
 $sourceAst=[Management.Automation.Language.Parser]::ParseInput($source,[ref]$tokens,[ref]$parseErrors)
 if($parseErrors.Count){throw 'FIXED_REVIEWER_SOURCE_PARSE_REFUSED'}
 $guardCommands=@($sourceAst.FindAll({param($node) $node -is [Management.Automation.Language.CommandAst] -and $node.GetCommandName() -ceq 'Add-Type' -and @($node.CommandElements|Where-Object {$_ -is [Management.Automation.Language.CommandParameterAst] -and $_.ParameterName -ceq 'TypeDefinition'}).Count -eq 1},$true))
 if($guardCommands.Count -ne 1){throw 'EXACTLY_ONE_LITERAL_GUARD_REQUIRED'}
 $guardElements=$guardCommands[0].CommandElements;$guardLiteral=$null
 for($index=0;$index -lt $guardElements.Count-1;$index++){if($guardElements[$index] -is [Management.Automation.Language.CommandParameterAst] -and $guardElements[$index].ParameterName -ceq 'TypeDefinition'){$guardLiteral=$guardElements[$index+1]}}
 if($guardLiteral -isnot [Management.Automation.Language.StringConstantExpressionAst] -or $guardLiteral.StringConstantType -ne [Management.Automation.Language.StringConstantType]::SingleQuotedHereString){throw 'ONLY_LITERAL_CSHARP_GUARD_ALLOWED'}
 $functionNames=@('Plain','Pin-Parents','Pin-File','Assert-AclPolicy','Assert-ApprovalAcl','New-ApprovalAcl','Create-ApprovalDirectory','Fixed-ApprovalDirectory')
 $functionText=@()
 foreach($functionName in $functionNames){$nodes=@($sourceAst.EndBlock.Statements|Where-Object {$_ -is [Management.Automation.Language.FunctionDefinitionAst] -and $_.Name -ceq $functionName});if($nodes.Count -ne 1){throw ('FIXED_FUNCTION_REQUIRED: '+$functionName)};$functionText+=@($nodes[0].Extent.Text)}
 # Only these fixed function-definition AST fragments will be installed below.
 # No source top-level statement, GUI, Run-Review or IO adapter is evaluated.
 $fixtureId=[guid]::NewGuid().ToString('D').ToLowerInvariant()
 $fixture=$runtime+'\candidate-approval-native-'+$fixtureId
 [void](New-ProbeDirectory $runtime $fixture)
 $outputParent='C:\xjy-results'
 [void](Assert-ProbePlain $outputParent)
 Assert-Probe ([bool](Get-Item -LiteralPath $outputParent -Force).PSIsContainer) 'PROBE_RESULT_PARENT_REQUIRED'
 $output=$outputParent+'\candidate-approval-native-'+$fixtureId
 [void](New-ProbeDirectory $outputParent $output)
 $record=[ordered]@{version=2;purpose='candidate-approval-native-function-probe';status='NOT_RUN';passed=$false;actualCheckPassed=$false;actualContext=$actualContext;sourceSha256=$expectedSourceSha256;fixture=$fixture;output=$output;extractedFunctions=$functionNames;nativeGuardCompiled=$false;fictitiousFixedDirectoryFlowVerified=$false;knownFolderAccess=$false;realApprovalCreated=$false;guiOrIoAdapterOrBusinessExeExecuted=$false;existingAclModified=$false;automaticCleanup=$false;scope='Only fixed native guard and named functions on fictitious paths; not reviewer GUI, actual KnownFolder, or complete approval acceptance';tests=@();error=$null}
 $held=New-Object 'Collections.Generic.List[IDisposable]'
 $pinnedDirs=New-Object 'Collections.Generic.HashSet[string]' ([StringComparer]::OrdinalIgnoreCase)
 $oldTemp=[Environment]::GetEnvironmentVariable('TEMP','Process');$oldTmp=[Environment]::GetEnvironmentVariable('TMP','Process')
 function Invoke-ProbeCase([string]$Name,[scriptblock]$Action){
  try{
   $details=& $Action
   if($details -is [Collections.IDictionary] -and $details.Contains('probeOutcome') -and $details.probeOutcome -ceq 'BLOCKED'){$record.tests+=@([ordered]@{name=$Name;status='BLOCKED';passed=$false;details=$details;error=$details.reason})}
   else{$record.tests+=@([ordered]@{name=$Name;status='PASS';passed=$true;details=$details;error=$null})}
  }catch{$record.tests+=@([ordered]@{name=$Name;status='FAIL';passed=$false;details=$null;error=$_.Exception.Message})}
 }
 function Assert-ProbeRejected([scriptblock]$Action,[string]$Message,[string]$ExpectedErrorPattern){
  $rejected=$false
  try{& $Action}catch{if(!$ExpectedErrorPattern -or $_.Exception.ToString() -notmatch $ExpectedErrorPattern){throw ('UNEXPECTED_REJECTION: '+$_.Exception.Message)};$rejected=$true}
  Assert-Probe $rejected $Message
 }
 function Release-ProbeHeld{
  for($index=$held.Count-1;$index -ge 0;$index--){$held[$index].Dispose()}
  $held.Clear();$pinnedDirs.Clear()
 }
 function Invoke-ProbeRenameRoundTrip([string]$From,[string]$To,[bool]$Directory){
  [void](Assert-ProbeTarget $fixture $From);[void](Assert-ProbeTarget $fixture $To $true)
  if(Test-Path -LiteralPath $To){throw 'RENAME_CONTROL_FRESH_DESTINATION_REQUIRED'}
  if($Directory){[IO.Directory]::Move($From,$To)}else{[IO.File]::Move($From,$To)}
  [void](Assert-ProbeTarget $fixture $To);[void](Assert-ProbeTarget $fixture $From $true)
  if(Test-Path -LiteralPath $From){throw 'RENAME_CONTROL_SOURCE_REMAINED'}
  if($Directory){[IO.Directory]::Move($To,$From)}else{[IO.File]::Move($To,$From)}
  [void](Assert-ProbeTarget $fixture $From)
  Assert-Probe (!(Test-Path -LiteralPath $To)) 'RENAME_CONTROL_DID_NOT_RESTORE'
 }
 function Assert-ProbeCreatedLeafAcl([string]$Directory,[string]$Sid){
  [void](Assert-ProbeTarget $fixture $Directory)
  $acl=Get-Acl -LiteralPath $Directory
  Assert-Probe $acl.AreAccessRulesProtected 'CREATED_DACL_NOT_PROTECTED'
  Assert-Probe ($acl.GetOwner([Security.Principal.SecurityIdentifier]).Value -ceq $Sid) 'CREATED_OWNER_NOT_CURRENT_SID'
  $rules=@($acl.GetAccessRules($true,$true,[Security.Principal.SecurityIdentifier]))
  Assert-Probe ($rules.Count -eq 3) 'CREATED_DACL_EXPECTED_THREE_RULES'
  $expectedSids=@($Sid,'S-1-5-18','S-1-5-32-544')
  foreach($rule in $rules){Assert-Probe ($rule.IdentityReference.Value -in $expectedSids -and $rule.AccessControlType -eq [Security.AccessControl.AccessControlType]::Allow -and $rule.FileSystemRights -eq [Security.AccessControl.FileSystemRights]::FullControl -and $rule.InheritanceFlags -eq ([Security.AccessControl.InheritanceFlags]::ContainerInherit -bor [Security.AccessControl.InheritanceFlags]::ObjectInherit) -and $rule.PropagationFlags -eq [Security.AccessControl.PropagationFlags]::None) 'CREATED_DACL_RULE_MISMATCH'}
  $before=$acl.GetSecurityDescriptorSddlForm([Security.AccessControl.AccessControlSections]::All)
  Assert-ApprovalAcl $Directory $Sid
  $after=(Get-Acl -LiteralPath $Directory).GetSecurityDescriptorSddlForm([Security.AccessControl.AccessControlSections]::All)
  Assert-Probe ($before -ceq $after) 'LEAF_ACL_VERIFICATION_MUTATED_DACL'
  $fakeRecord=$Directory+'\synthetic-acl-inheritance.txt'
  Write-ProbeNewBytes $fixture $fakeRecord ([Text.Encoding]::UTF8.GetBytes('synthetic only; this is not an approval record'))
  Assert-ApprovalAcl $fakeRecord $Sid
  $inheritedAcl=Get-Acl -LiteralPath $fakeRecord
  $inheritedRules=@($inheritedAcl.GetAccessRules($true,$true,[Security.Principal.SecurityIdentifier]))
  Assert-Probe ($inheritedRules.Count -eq 3 -and @($inheritedRules|Where-Object {!$_.IsInherited}).Count -eq 0) 'SYNTHETIC_FILE_DACL_NOT_INHERITED'
  return @{protectedDacl=$true;owner=$Sid;trustedFullControlRules=3;leafAclVerificationDidNotMutate=$true;syntheticFileAclInherited=$true;realApprovalCreated=$false}
 }
 try{
  $compileDir=New-ProbeDirectory $fixture ($fixture+'\compile-temp')
  # CodeDOM temporary output is restricted to this owned fixture, not KnownFolder.
  [Environment]::SetEnvironmentVariable('TEMP',$compileDir,'Process');[Environment]::SetEnvironmentVariable('TMP',$compileDir,'Process')
  if('XjyReviewerPathGuard' -as [type]){throw 'FRESH_POWERSHELL_PROCESS_REQUIRED'}
  Add-Type -TypeDefinition $guardLiteral.Value -Language CSharp -ErrorAction Stop
  $record.nativeGuardCompiled=$true
  foreach($definition in $functionText){. ([scriptblock]::Create($definition))}
  $sid=[Security.Principal.WindowsIdentity]::GetCurrent().User.Value
  $protected=New-ProbeDirectory $fixture ($fixture+'\protected')
  $protectedFile=$protected+'\synthetic-tool.cjs'
  Write-ProbeNewBytes $fixture $protectedFile ([Text.Encoding]::UTF8.GetBytes('// synthetic data only'))
  $aliasTarget=New-ProbeDirectory $fixture ($fixture+'\alias-target')
  $aliasFile=$aliasTarget+'\synthetic-link-source.txt'
  Write-ProbeNewBytes $fixture $aliasFile ([Text.Encoding]::UTF8.GetBytes('synthetic hardlink source'))
  $local=New-ProbeDirectory $fixture ($fixture+'\local')
  Invoke-ProbeCase 'native-file-and-parent-pin-block-write-and-rename' {
   $controls=@{};$codes=@{}
   $renamedFile=$protected+'\rename-control.txt';$renamedParent=$fixture+'\rename-control-parent'
   try{
    # Both directions are proven on the same paths, principal and unchanged ACL.
    [void](Assert-ProbeTarget $fixture $protectedFile)
    $writable=[IO.File]::Open($protectedFile,[IO.FileMode]::Open,[IO.FileAccess]::ReadWrite,[IO.FileShare]::ReadWrite);$writable.Dispose();$controls.beforeWrite=$true
    Invoke-ProbeRenameRoundTrip $protectedFile $renamedFile $false;$controls.beforeFileRename=$true
    Invoke-ProbeRenameRoundTrip $protected $renamedParent $true;$controls.beforeParentRename=$true
    $pin=Pin-File $protectedFile
    [XjyReviewerPathGuard]::Check($pin.SafeFileHandle,$protectedFile,$false)
    $codes.write=Get-ProbeRejectedNativeCode { $attempt=[IO.File]::Open($protectedFile,[IO.FileMode]::Open,[IO.FileAccess]::Write,[IO.FileShare]::ReadWrite);$attempt.Dispose() } @(32) 'PIN_DID_NOT_BLOCK_WRITE_OPEN'
    [void](Assert-ProbeTarget $fixture $protectedFile);[void](Assert-ProbeTarget $fixture $renamedFile $true)
    $codes.fileRename=Get-ProbeRejectedNativeCode { [IO.File]::Move($protectedFile,$renamedFile) } @(5,32) 'PIN_DID_NOT_BLOCK_FILE_RENAME'
    [void](Assert-ProbeTarget $fixture $protected);[void](Assert-ProbeTarget $fixture $renamedParent $true)
    $codes.parentRename=Get-ProbeRejectedNativeCode { [IO.Directory]::Move($protected,$renamedParent) } @(5,32) 'PIN_DID_NOT_BLOCK_PARENT_RENAME'
    Assert-Probe ((Test-Path -LiteralPath $protectedFile) -and !(Test-Path -LiteralPath $renamedFile) -and !(Test-Path -LiteralPath $renamedParent)) 'PIN_RENAME_SIDE_EFFECT_OBSERVED'
   }finally{Release-ProbeHeld}
   # A Win32=5 rename is evidence only when releasing these exact pins restores
   # both rename permissions; a pre-existing access denial must fail this case.
   $writable=[IO.File]::Open($protectedFile,[IO.FileMode]::Open,[IO.FileAccess]::ReadWrite,[IO.FileShare]::ReadWrite);$writable.Dispose();$controls.afterWrite=$true
   Invoke-ProbeRenameRoundTrip $protectedFile $renamedFile $false;$controls.afterFileRename=$true
   Invoke-ProbeRenameRoundTrip $protected $renamedParent $true;$controls.afterParentRename=$true
   return (Assert-ProbePinEvidence $controls $codes)
  }
  Invoke-ProbeCase 'native-hardlink-and-junction-refused' {
   $hardlink=$fixture+'\synthetic-hardlink.txt';$junction=$fixture+'\synthetic-junction'
   [void](Assert-ProbeTarget $fixture $hardlink $true);[void](Assert-ProbeTarget $fixture $aliasFile)
   [void](New-Item -ItemType HardLink -Path $hardlink -Target $aliasFile -ErrorAction Stop)
   [void](Assert-ProbeTarget $fixture $junction $true);[void](Assert-ProbeTarget $fixture $aliasTarget)
   [void](New-Item -ItemType Junction -Path $junction -Target $aliasTarget -ErrorAction Stop)
   Assert-Probe (((Get-Item -LiteralPath $junction -Force).Attributes -band [IO.FileAttributes]::ReparsePoint) -ne 0) 'JUNCTION_SETUP_NOT_OBSERVED'
   Assert-ProbeRejected { [void](Plain $junction $true) } 'PLAIN_ACCEPTED_JUNCTION' '路径不能经过链接或重解析点'
   Assert-ProbeRejected { $handle=[XjyReviewerPathGuard]::Directory($junction);$handle.Dispose() } 'NATIVE_GUARD_ACCEPTED_JUNCTION' 'Link or unexpected file identity|Path changed or alias used'
   $linkedStream=[IO.File]::Open($hardlink,[IO.FileMode]::Open,[IO.FileAccess]::Read,[IO.FileShare]::Read)
   try{Assert-ProbeRejected { [XjyReviewerPathGuard]::Check($linkedStream.SafeFileHandle,$hardlink,$false) } 'NATIVE_GUARD_ACCEPTED_HARDLINK' 'Link or unexpected file identity'}finally{$linkedStream.Dispose()}
   Assert-ProbeRejected { [void](Pin-File $hardlink) } 'PIN_FILE_ACCEPTED_HARDLINK' 'Link or unexpected file identity|路径不能经过链接或重解析点'
   return @{hardlinkCreated=$true;junctionCreated=$true;plainJunctionRejected=$true;nativeJunctionRejected=$true;nativeHardlinkRejected=$true;pinHardlinkRejected=$true}
  }
  Invoke-ProbeCase 'atomic-leaf-dacl-helper-only-not-fixed-ancestor-flow' {
   $leaf=$fixture+'\atomic-leaf'
   [void](Assert-ProbeTarget $fixture $leaf $true)
   if(Test-Path -LiteralPath $leaf){throw 'ATOMIC_LEAF_FIXTURE_MUST_BE_FRESH'}
   Create-ApprovalDirectory $leaf (New-ApprovalAcl $sid)
   [void](Assert-ProbeTarget $fixture $leaf)
   [void](Plain $leaf $true);Pin-Parents $leaf
   $details=Assert-ProbeCreatedLeafAcl $leaf $sid
   $details.creationApi='Directory.CreateDirectory(path, DirectorySecurity) from fixed source'
   $details.fullFixedDirectoryFlowCovered=$false
   return $details
  }
  Invoke-ProbeCase 'fixed-fictitious-approval-directory-full-ancestor-policy' {
   $expected=$local+'\鑫金源珠宝\初次升级审定'
   # The fixed source function reads actual ancestor ACLs to the volume root.
   # A correct rejection of an existing ancestor is an explicit BLOCKED positive
   # path, never a passing creation test. No policy or existing ACL is changed.
   [void](Assert-ProbeTarget $fixture ($local+'\鑫金源珠宝') $true)
   try{$approvalDirectory=Fixed-ApprovalDirectory $local $sid}catch{
    $failure=$_.Exception.Message
    if($failure -notmatch '审定路径所有者不属于|审定路径允许其他 Windows 身份替换或修改受保护对象'){throw}
    $walk=$local;$blockedAt=$null;$blockReason=$null
    while($walk){try{Assert-ApprovalAcl $walk $sid $true}catch{$blockedAt=$walk;$blockReason=$_.Exception.Message;break};$above=[IO.Directory]::GetParent($walk);if(!$above){break};$walk=$above.FullName}
    if(!$blockedAt){throw 'FIXED_FLOW_REFUSED_WITHOUT_EXISTING_ANCESTOR_POLICY_BLOCK'}
    Assert-Probe (!(Test-Path -LiteralPath ($local+'\鑫金源珠宝'))) 'BLOCKED_FIXED_FLOW_CREATED_APPROVAL_SUBDIRECTORY'
    return @{probeOutcome='BLOCKED';reason='Positive fixed-directory flow remains unverified: unchanged existing ancestor ACL was correctly refused';blockedAncestor=$blockedAt;policyReason=$blockReason;fixedFunctionError=$failure;fictitiousFixedDirectoryFlowVerified=$false;existingAncestorAclChanged=$false;fullPositivePathProven=$false}
   }
   Assert-Probe ($approvalDirectory -ceq $expected) 'FICTITIOUS_APPROVAL_PATH_CHANGED'
   [void](Assert-ProbeTarget $fixture $approvalDirectory)
   $details=Assert-ProbeCreatedLeafAcl $approvalDirectory $sid
   $before=(Get-Acl -LiteralPath $approvalDirectory).GetSecurityDescriptorSddlForm([Security.AccessControl.AccessControlSections]::All)
   $second=Fixed-ApprovalDirectory $local $sid
   $after=(Get-Acl -LiteralPath $approvalDirectory).GetSecurityDescriptorSddlForm([Security.AccessControl.AccessControlSections]::All)
   Assert-Probe ($second -ceq $expected -and $before -ceq $after) 'EXISTING_DACL_CHANGED'
   $record.fictitiousFixedDirectoryFlowVerified=$true
   $details.existingDirectoryAclUnchanged=$true;$details.fullFixedDirectoryFlowCovered=$true
   return $details
  }
  Invoke-ProbeCase 'direct-unsafe-target-delete-child-acl-refused-without-mutation' {
   $unsafeLocal=$fixture+'\unsafe-local'
   [void](Assert-ProbeTarget $fixture $unsafeLocal $true)
   if(Test-Path -LiteralPath $unsafeLocal){throw 'UNSAFE_FIXTURE_MUST_BE_FRESH'}
   $unsafeAcl=New-ApprovalAcl $sid
   $foreignSid=New-Object Security.Principal.SecurityIdentifier('S-1-5-32-545')
   $unsafeRule=New-Object Security.AccessControl.FileSystemAccessRule($foreignSid,[Security.AccessControl.FileSystemRights]::DeleteSubdirectoriesAndFiles,[Security.AccessControl.InheritanceFlags]::None,[Security.AccessControl.PropagationFlags]::None,[Security.AccessControl.AccessControlType]::Allow)
   $unsafeAcl.AddAccessRule($unsafeRule)
   # This deliberately unsafe DACL is attached only at creation of a new fixture.
   [void][IO.Directory]::CreateDirectory($unsafeLocal,$unsafeAcl)
   [void](Assert-ProbeTarget $fixture $unsafeLocal)
   $before=(Get-Acl -LiteralPath $unsafeLocal).GetSecurityDescriptorSddlForm([Security.AccessControl.AccessControlSections]::All)
   # Assert this exact object's ACL directly. No unrelated ancestor can satisfy
   # this negative test by failing first.
   Assert-ProbeRejected { Assert-ApprovalAcl $unsafeLocal $sid $true } 'UNSAFE_DELETE_CHILD_ACL_ACCEPTED' '审定路径允许其他 Windows 身份替换或修改受保护对象'
   $after=(Get-Acl -LiteralPath $unsafeLocal).GetSecurityDescriptorSddlForm([Security.AccessControl.AccessControlSections]::All)
   Assert-Probe ($before -ceq $after) 'UNSAFE_EXISTING_ACL_CHANGED'
   Assert-Probe (!(Test-Path -LiteralPath ($unsafeLocal+'\鑫金源珠宝'))) 'UNSAFE_LOCAL_WAS_MUTATED'
   return @{functionUnderTest='Assert-ApprovalAcl';exactTarget=$unsafeLocal;ancestorTraversalUsed=$false;foreignDeleteChildSid='S-1-5-32-545';unsafeDaclAttachedOnlyAtCreation=$true;rejected=$true;existingAclUnchanged=$true;approvalSubdirectoryCreated=$false}
  }
  $outcome=Get-ProbeOutcome $record.tests 5
  $record.status=$outcome.status
  $record.passed=($record.nativeGuardCompiled -and $outcome.passed)
  $record.actualCheckPassed=$record.passed
 }catch{$record.status='FAIL';$record.error=$_.Exception.Message}
 finally{
  for($index=$held.Count-1;$index -ge 0;$index--){try{$held[$index].Dispose()}catch{$record.status='FAIL';$record.passed=$false;$record.actualCheckPassed=$false;$record.error='HELD_HANDLE_DISPOSE_FAILED: '+$_.Exception.Message}}
  [Environment]::SetEnvironmentVariable('TEMP',$oldTemp,'Process');[Environment]::SetEnvironmentVariable('TMP',$oldTmp,'Process')
 }
 $resultBytes=[Text.Encoding]::UTF8.GetBytes(($record|ConvertTo-Json -Depth 14))
 Write-ProbeNewBytes $output ($output+'\result.json') $resultBytes
 $record|ConvertTo-Json -Depth 14 -Compress
 if($record.passed){exit 0}elseif($record.status -ceq 'BLOCKED'){exit 2}else{exit 1}
}finally{$sourcePin.Dispose()}
