"""Read-only actual WDAG native installation-location probe; no installer run."""
import os,sys,json,hashlib,importlib.util,subprocess,base64
from pathlib import Path
ROOT=Path('C:/xjy-work/xjy-web-stage1');INPUT=Path('C:/xjy-input/native-guest-preflight170-a1')
assert os.name=='nt' and sys.flags.isolated and sys.flags.no_site and sys.flags.dont_write_bytecode and Path(__file__).resolve()==INPUT/'native-guest-preflight170.py'
pin='d630f373911715b3ef5ee80e6fbaeaae838c1469ab53f44759813bc066cf69a7';helper=ROOT/'audit-tools/finance-repack.py'
assert hashlib.sha256(helper.read_bytes()).hexdigest()==pin
spec=importlib.util.spec_from_file_location('fixed',helper);m=importlib.util.module_from_spec(spec);spec.loader.exec_module(m);proof=m.admit(pin)
assert json.loads(m.stable(ROOT/'isolation-identity.json'))['namespace']=='36fcbe9c-ece1-4be3-af35-309a2ee19e05'
script=r"""
$ErrorActionPreference='Stop'
[Console]::OutputEncoding=[Text.UTF8Encoding]::new($false)
$who=[Security.Principal.WindowsIdentity]::GetCurrent()
if([Environment]::UserName -ine 'WDAGUtilityAccount'){throw 'actual Guest account required'}
$local=[Environment]::GetFolderPath([Environment+SpecialFolder]::LocalApplicationData)
$roaming=[Environment]::GetFolderPath([Environment+SpecialFolder]::ApplicationData)
$common=[Environment]::GetFolderPath([Environment+SpecialFolder]::CommonApplicationData)
$profile=[Environment]::GetFolderPath([Environment+SpecialFolder]::UserProfile)
if($profile -ine 'C:\Users\WDAGUtilityAccount' -or $local -ine ($profile+'\AppData\Local') -or $roaming -ine ($profile+'\AppData\Roaming') -or $common -ine 'C:\ProgramData'){throw 'unexpected actual Guest KnownFolder layout'}
foreach($dir in @($profile,$local,$roaming,$common)){
 $walk=$dir
 while($walk){$item=Get-Item -LiteralPath $walk -Force;if(!$item.PSIsContainer -or ($item.Attributes -band [IO.FileAttributes]::ReparsePoint) -ne 0){throw 'nonordinary native directory'};$parent=[IO.Directory]::GetParent($walk);if(!$parent){break};$walk=$parent.FullName}
}
$install=Join-Path $local '鑫金源珠宝\员工程序'
$state=Join-Path (Split-Path $install) '.员工程序.xjy-engine-state'
$processes=@(Get-CimInstance Win32_Process | Where-Object {$_.ExecutablePath -and $_.ExecutablePath.StartsWith((Join-Path $local '鑫金源珠宝')+'\',[StringComparison]::OrdinalIgnoreCase)} | Select-Object ProcessId,ExecutablePath)
[ordered]@{sid=$who.User.Value;local=$local;roaming=$roaming;common=$common;profile=$profile;installationDir=$install;installationExists=(Test-Path -LiteralPath $install);engineStateExists=(Test-Path -LiteralPath $state);productionDrivePresent=(Test-Path -LiteralPath 'F:\');existingProgramProcesses=$processes;knownFolderPathsOrdinary=$true} | ConvertTo-Json -Depth 4 -Compress
"""
out=Path('C:/xjy-results/native-guest-preflight170-a1');m.ordinary(out.parent,out.parent);out.mkdir(exist_ok=False)
result=subprocess.run(['C:/Windows/System32/WindowsPowerShell/v1.0/powershell.exe','-NoProfile','-NonInteractive','-EncodedCommand',base64.b64encode(script.encode('utf-16le')).decode()],cwd=ROOT,stdin=subprocess.DEVNULL,stdout=subprocess.PIPE,stderr=subprocess.PIPE,creationflags=0x08000000)
(out/'stdout.bin').write_bytes(result.stdout);(out/'stderr.bin').write_bytes(result.stderr)
assert result.returncode==0,'actual KnownFolder probe failed'
native=json.loads(result.stdout.decode('utf-8-sig'));assert native['productionDrivePresent'] is False and native['existingProgramProcesses']==[]
m.admit(pin)
record={'complete':True,'actualContext':proof,'native':native,'scope':'read-only native KnownFolder preflight; installation not executed','filesCreatedOutsideResultDirectory':False}
(out/'result.json').write_text(json.dumps(record,ensure_ascii=False,indent=2),'utf-8');print(json.dumps(record,ensure_ascii=False))
