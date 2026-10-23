# SOURCE_ONLY. Root transports these exact reviewed UTF-8 bytes with fixed
# System32 PowerShell5.1 / NoProfile / clean environment / EncodedCommand.
# Metadata only: never invoke the three resolved commands or start collector.
[Console]::OutputEncoding=[Text.UTF8Encoding]::new($false)
$ErrorActionPreference='Stop'
$ProgressPreference='SilentlyContinue'
$WarningPreference='Stop'
$diagnosticStage='version'

function FailureRecord($record) {
  return [ordered]@{
    category=([string]$record.CategoryInfo.Category)
    fullyQualifiedErrorId=([string]$record.FullyQualifiedErrorId)
    exceptionType=$record.Exception.GetType().FullName
  }
}

try {
  $version=[ordered]@{
    major=[int]$PSVersionTable.PSVersion.Major
    minor=[int]$PSVersionTable.PSVersion.Minor
    build=[int]$PSVersionTable.PSVersion.Build
    revision=[int]$PSVersionTable.PSVersion.Revision
    edition=$PSVersionTable.PSEdition
  }
  $commands=@()
  foreach($fixedName in @('Microsoft.PowerShell.Management\Get-WmiObject','NetTCPIP\Get-NetTCPConnection','NetTCPIP\Get-NetUDPEndpoint')) {
    $diagnosticStage='get-command'
    try {
      $resolved=@(Get-Command -Name $fixedName -ErrorAction Stop | ForEach-Object {
        [ordered]@{
          name=$_.Name
          commandType=([string]$_.CommandType)
          source=$_.Source
          moduleName=$_.ModuleName
          modulePath=if($null -ne $_.Module){$_.Module.Path}else{$null}
          moduleBase=if($null -ne $_.Module){$_.Module.ModuleBase}else{$null}
        }
      })
      $commands+=,[ordered]@{requested=$fixedName;resolved=$true;commands=$resolved;error=$null}
    } catch {
      $commands+=,[ordered]@{requested=$fixedName;resolved=$false;commands=@();error=(FailureRecord $_)}
    }
  }
  $diagnosticStage='module-metadata'
  try {
    $modules=@(Get-Module -ListAvailable -Name Microsoft.PowerShell.Management,NetTCPIP -ErrorAction Stop | ForEach-Object {
      [ordered]@{name=$_.Name;version=$_.Version.ToString();path=$_.Path;moduleBase=$_.ModuleBase}
    })
    $moduleMetadata=[ordered]@{completed=$true;available=$modules;error=$null}
  } catch {
    $moduleMetadata=[ordered]@{completed=$false;available=@();error=(FailureRecord $_)}
  }
  $diagnosticStage='result'
  $result=[ordered]@{
    purpose='ui-observer-capability-metadata-diagnostic'
    state='CAPABILITY_METADATA_DIAGNOSTIC_ONLY'
    diagnosticCompleted=$true
    collectorCandidateQualified=$false
    processOrEndpointQueriesExecuted=$false
    version=$version
    psHome=$PSHOME
    psModulePath=$env:PSModulePath
    commandResolution=$commands
    moduleMetadata=$moduleMetadata
  }
  $json=Microsoft.PowerShell.Utility\ConvertTo-Json -InputObject $result -Compress -Depth 8
  if([Text.Encoding]::UTF8.GetByteCount($json) -gt 65536){throw 'Fixed metadata output bound'}
  [Console]::Out.WriteLine($json)
  [Console]::Out.Flush()
  exit 0
} catch {
  [Console]::Error.WriteLine('CAPABILITY_DIAGNOSTIC_FAILED:'+$diagnosticStage)
  exit 1
}
