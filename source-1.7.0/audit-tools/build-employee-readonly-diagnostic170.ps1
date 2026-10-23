$ErrorActionPreference='Stop'
Set-StrictMode -Version Latest
$stage='C:\Users\WDAGUtilityAccount\Desktop\XjyBaselineResults\readonly-diagnostic-a1'
$csc='C:\Windows\Microsoft.NET\Framework64\v4.0.30319\csc.exe'
$pins=@{
 'EmployeeInstallReadOnlyDiagnostic170.cs'='5fefae46accf1d3e97f055fd9a9b95b90044edb4cbdfddd3793ccc6ab924cdab'
 'EmployeeInstallReadOnlyDiagnostic170.Tests.cs'='4cf728dade8cc7b4b30d313aad53fbb44c106038e1701dd5daa715fd8f6c49e9'
 'AclDiagnosticCases.DeepSeek.cs'='410f393611eef3b00a10f133b23958d12e53fd5651ca3a9a5b2a98bd8f9c5ca9'
 'EmployeeInstallReadOnlyDiagnostic170.Probe.cs'='e4426548924cffa20c5bcdb406a851d6b34b419ef5301f4b7aefc526b534e012'
}
$result=[ordered]@{purpose='isolated-readonly-diagnostic-build-and-test';startedAt=[DateTime]::UtcNow.ToString('o');passed=$false;productionAccessed=$false;installerExecuted=$false;aclModified=$false;steps=@();artifacts=@()}
function New-Text([string]$File,[string]$Value){$b=[Text.UTF8Encoding]::new($false).GetBytes($Value);$s=[IO.File]::Open($File,[IO.FileMode]::CreateNew,[IO.FileAccess]::Write,[IO.FileShare]::None);try{$s.Write($b,0,$b.Length)}finally{$s.Dispose()}}
function Run-Step([string]$Name,[string]$Exe,[string]$Arguments){
 $psi=New-Object Diagnostics.ProcessStartInfo;$psi.FileName=$Exe;$psi.Arguments=$Arguments;$psi.WorkingDirectory=$stage;$psi.UseShellExecute=$false;$psi.CreateNoWindow=$true;$psi.RedirectStandardOutput=$true;$psi.RedirectStandardError=$true;$psi.StandardOutputEncoding=[Text.UTF8Encoding]::new($false);$psi.StandardErrorEncoding=[Text.UTF8Encoding]::new($false)
 $p=[Diagnostics.Process]::Start($psi);$stdout=$p.StandardOutput.ReadToEndAsync();$stderr=$p.StandardError.ReadToEndAsync()
 if(!$p.WaitForExit(60000)){$result.steps+=@{name=$Name;timedOut=$true;pid=$p.Id};throw 'Step timeout; process not terminated'}
 $out=$stdout.GetAwaiter().GetResult();$err=$stderr.GetAwaiter().GetResult();New-Text (Join-Path $stage ($Name+'.stdout.txt')) $out;New-Text (Join-Path $stage ($Name+'.stderr.txt')) $err
 $result.steps+=@{name=$Name;exitCode=$p.ExitCode;timedOut=$false};if($p.ExitCode -ne 0){throw ('Step failed: '+$Name)};$p.Dispose()
}
try{
 if($env:USERNAME -ne 'WDAGUtilityAccount' -or (Get-CimInstance Win32_ComputerSystem).Model -ne 'Virtual Machine' -or (Test-Path -LiteralPath 'F:\')){throw 'Wrong test environment'}
 if(@(Get-NetIPAddress -ErrorAction SilentlyContinue|Where-Object{$_.IPAddress -notin @('127.0.0.1','::1')}).Count){throw 'Test environment has a network address'}
 if((Get-FileHash -LiteralPath $csc -Algorithm SHA256).Hash.ToLowerInvariant() -cne '46809206887326d2d24db1eff1f3064de972c3451abe766b49111450a5e08e00'){throw 'Compiler changed'}
 foreach($name in $pins.Keys){$f=Get-Item -LiteralPath (Join-Path $stage $name);if(($f.Attributes -band [IO.FileAttributes]::ReparsePoint) -ne 0 -or $f.LinkType -or (Get-FileHash -LiteralPath $f.FullName -Algorithm SHA256).Hash.ToLowerInvariant() -cne $pins[$name]){throw ('Source changed: '+$name)}}
 $references='/reference:System.Windows.Forms.dll /reference:System.Drawing.dll /reference:System.Web.Extensions.dll'
 Run-Step 'compile-tool' $csc ('/nologo /codepage:65001 /target:winexe /platform:x64 /out:EmployeeInstallReadOnlyDiagnostic170.exe '+$references+' EmployeeInstallReadOnlyDiagnostic170.cs')
 Run-Step 'compile-tests' $csc ('/nologo /codepage:65001 /target:exe /platform:x64 /out:EmployeeInstallReadOnlyDiagnostic170.Tests.exe /reference:EmployeeInstallReadOnlyDiagnostic170.exe '+$references+' EmployeeInstallReadOnlyDiagnostic170.Tests.cs AclDiagnosticCases.DeepSeek.cs')
 Run-Step 'compile-probe' $csc ('/nologo /codepage:65001 /target:exe /platform:x64 /out:EmployeeInstallReadOnlyDiagnostic170.Probe.exe /reference:EmployeeInstallReadOnlyDiagnostic170.exe '+$references+' EmployeeInstallReadOnlyDiagnostic170.Probe.cs')
 Run-Step 'tests' (Join-Path $stage 'EmployeeInstallReadOnlyDiagnostic170.Tests.exe') ''
 Run-Step 'actual-os-probe' (Join-Path $stage 'EmployeeInstallReadOnlyDiagnostic170.Probe.exe') ''
 foreach($name in $pins.Keys){if((Get-FileHash -LiteralPath (Join-Path $stage $name) -Algorithm SHA256).Hash.ToLowerInvariant() -cne $pins[$name]){throw 'Input changed during run'}}
 foreach($name in @('EmployeeInstallReadOnlyDiagnostic170.exe','EmployeeInstallReadOnlyDiagnostic170.Tests.exe','EmployeeInstallReadOnlyDiagnostic170.Probe.exe')){$f=Get-Item -LiteralPath (Join-Path $stage $name);$result.artifacts+=@{file=$name;bytes=$f.Length;sha256=(Get-FileHash -LiteralPath $f.FullName -Algorithm SHA256).Hash.ToLowerInvariant()}}
 $result.passed=$true
}catch{$result.error=$_.Exception.Message}
finally{$result.finishedAt=[DateTime]::UtcNow.ToString('o');New-Text (Join-Path $stage 'result.json') ($result|ConvertTo-Json -Depth 8)}
if(!$result.passed){exit 1}
