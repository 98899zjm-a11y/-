"""Read-only actual Guest diagnosis of unchanged, signed ACL policy."""
import os,sys,json,hashlib,importlib.util,subprocess,base64
from pathlib import Path
ROOT=Path('C:/xjy-work/xjy-web-stage1');INPUT=Path('C:/xjy-input/native170-acl-probe-a1')
assert os.name=='nt' and sys.flags.isolated and sys.flags.no_site and sys.flags.dont_write_bytecode and Path(__file__).resolve()==INPUT/'probe-native170-acl.py'
pin='d630f373911715b3ef5ee80e6fbaeaae838c1469ab53f44759813bc066cf69a7';helper=ROOT/'audit-tools/finance-repack.py'
assert hashlib.sha256(helper.read_bytes()).hexdigest()==pin
spec=importlib.util.spec_from_file_location('fixed',helper);m=importlib.util.module_from_spec(spec);spec.loader.exec_module(m);proof=m.admit(pin)
assert json.loads(m.stable(ROOT/'isolation-identity.json'))['namespace']=='36fcbe9c-ece1-4be3-af35-309a2ee19e05'
worker=ROOT/'runtime/native170-fresh-employee-a2/package/受信助手'
source=m.pinned(worker/'delivery-approval/Prepare-Repeat-Approval-170.ps1','6a27f81855c76d6c6dbd1b90fb247f77381cd36b877c53b7df977a298ba71069').decode('utf-8-sig').replace('\r\n','\n')
policy=source[source.index('function Test-TrustedWindowsRoot'):source.index('function New-ApprovalAcl')]
assert hashlib.sha256(policy.encode()).hexdigest()=='9e4c6488cc8a12c3d05b94cfa91f41d9e36a3bae7524f8c7bfad326fde583ede'
script="[Console]::OutputEncoding=[Text.UTF8Encoding]::new($false);$ErrorActionPreference='Stop';. ([ScriptBlock]::Create([Text.Encoding]::UTF8.GetString([Convert]::FromBase64String('"+base64.b64encode(policy.encode()).decode()+"'))));"
script+=r"""$sid=[Security.Principal.WindowsIdentity]::GetCurrent().User.Value;$targets=@('C:\xjy-work\xjy-web-stage1\runtime\native170-fresh-employee-a2\package\受信助手',[Environment]::GetFolderPath('LocalApplicationData'));$checks=@{};foreach($target in $targets){$p=$target;while($p){$key=$p.ToLowerInvariant();$ancestor=![StringComparer]::OrdinalIgnoreCase.Equals($p,$target);if(!$checks.ContainsKey($key) -or !$ancestor){$checks[$key]=@{path=$p;ancestor=$ancestor}};$next=[IO.Directory]::GetParent($p);if(!$next){break};$p=$next.FullName}};$results=@();foreach($c in $checks.Values){$errorText=$null;$passed=$false;try{Assert-ApprovalAcl $c.path $sid ([bool]$c.ancestor);$passed=$true}catch{$errorText=$_.Exception.Message};$acl=Get-Acl -LiteralPath $c.path;$owner=$acl.GetOwner([Security.Principal.SecurityIdentifier]).Value;$results+=@{path=$c.path;ancestor=$c.ancestor;passed=$passed;error=$errorText;owner=$owner;rules=@($acl.GetAccessRules($true,$true,[Security.Principal.SecurityIdentifier])|ForEach-Object{@{sid=$_.IdentityReference.Value;rights=[long]$_.FileSystemRights;allow=($_.AccessControlType -eq [Security.AccessControl.AccessControlType]::Allow);inheritOnly=(($_.PropagationFlags -band [Security.AccessControl.PropagationFlags]::InheritOnly) -ne 0)}})}};@{sid=$sid;checks=$results;readOnly=$true}|ConvertTo-Json -Depth 6 -Compress"""
out=Path('C:/xjy-results/native170-acl-probe-a1');m.ordinary(out.parent,out.parent);out.mkdir(exist_ok=False)
env={'SystemRoot':'C:\\Windows','WINDIR':'C:\\Windows','SystemDrive':'C:','PATHEXT':'.EXE'}
p=subprocess.run(['C:/Windows/System32/WindowsPowerShell/v1.0/powershell.exe','-NoLogo','-NoProfile','-NonInteractive','-EncodedCommand',base64.b64encode(script.encode('utf-16le')).decode()],cwd=ROOT,env=env,stdin=subprocess.DEVNULL,stdout=subprocess.PIPE,stderr=subprocess.PIPE,creationflags=0x08000000)
(out/'stdout.bin').write_bytes(p.stdout);(out/'stderr.bin').write_bytes(p.stderr)
if p.returncode==0:(out/'result.json').write_text(json.dumps(json.loads(p.stdout.decode('utf-8-sig')),ensure_ascii=False,indent=2),'utf-8')
m.admit(pin);sys.exit(p.returncode)
