"""Original wrapper diagnostic: only its two result dialogs become console logs.
Not original-CMD acceptance. All package, signature, ACL and native checks remain.
"""
import os,sys,json,hashlib,importlib.util,subprocess,base64
from pathlib import Path
ROOT=Path('C:/xjy-work/xjy-web-stage1');INPUT=Path('C:/xjy-input/native170-messagebox-diagnostic-a1')
assert os.name=='nt' and sys.flags.isolated and sys.flags.no_site and sys.flags.dont_write_bytecode and Path(__file__).resolve()==INPUT/'diagnose-native170-messagebox.py'
pin='d630f373911715b3ef5ee80e6fbaeaae838c1469ab53f44759813bc066cf69a7';helper=ROOT/'audit-tools/finance-repack.py'
assert hashlib.sha256(helper.read_bytes()).hexdigest()==pin
spec=importlib.util.spec_from_file_location('fixed',helper);m=importlib.util.module_from_spec(spec);spec.loader.exec_module(m);proof=m.admit(pin)
assert json.loads(m.stable(ROOT/'isolation-identity.json'))['namespace']=='36fcbe9c-ece1-4be3-af35-309a2ee19e05'
package=ROOT/'runtime/native170-fresh-employee-a2/package'
original=m.pinned(package/'安装组件/native-delivery-170.ps1','4d8076e28da7b86039a36ac64761a41b0810bd4baa0c2e2ffb82138be361eb04').decode('utf-8-sig')
assert original.count('[Windows.Forms.MessageBox]::Show')==2
source=original.replace('[Windows.Forms.MessageBox]::Show','[XjyAuditDialog]::Show')
assert source.replace('[XjyAuditDialog]::Show','[Windows.Forms.MessageBox]::Show')==original
work=ROOT/'runtime/native170-messagebox-diagnostic-a1';m.mkdir_new(work);script=work/'diagnostic.ps1';script.write_bytes(b'\xef\xbb\xbf'+source.encode())
out=Path('C:/xjy-results/native170-messagebox-diagnostic-a1');m.ordinary(out.parent,out.parent);out.mkdir(exist_ok=False)
q=lambda s:"'"+str(s).replace("'","''")+"'"
preflight=r"""$ErrorActionPreference='Stop';[Console]::OutputEncoding=[Text.UTF8Encoding]::new($false);$install=Join-Path ([Environment]::GetFolderPath('LocalApplicationData')) '鑫金源珠宝\员工程序';$state=Join-Path (Split-Path $install) '.员工程序.xjy-engine-state';if((Test-Path -LiteralPath $install) -or (Test-Path -LiteralPath $state)){throw 'Retain existing install/state; diagnostic stopped'};$running=@(Get-CimInstance Win32_Process|Where-Object {$_.ExecutablePath -and ($_.ExecutablePath.StartsWith('C:\xjy-work\xjy-web-stage1\runtime\native170-fresh-employee-a2\package\受信助手\',[StringComparison]::OrdinalIgnoreCase) -or $_.ExecutablePath.StartsWith($install+'\',[StringComparison]::OrdinalIgnoreCase))});if($running.Count -ne 0){throw 'Native worker or application is active; diagnostic stopped'};Add-Type -TypeDefinition 'public static class XjyAuditDialog { public static int Show(string text,string caption,object buttons,object icon) { System.Console.Error.WriteLine(caption+": "+text);return 1; } }';"""
command=preflight+"$s=[IO.File]::ReadAllText("+q(script)+",[Text.Encoding]::UTF8);& ([ScriptBlock]::Create($s)) -PackageRoot "+q(package)+" -Action 'FreshEmployee'"
with (out/'stdout.txt').open('xb') as stdout,(out/'stderr.txt').open('xb') as stderr:
 p=subprocess.run(['C:/Windows/System32/WindowsPowerShell/v1.0/powershell.exe','-NoProfile','-NonInteractive','-STA','-EncodedCommand',base64.b64encode(command.encode('utf-16le')).decode()],cwd=ROOT,stdin=subprocess.DEVNULL,stdout=stdout,stderr=stderr,creationflags=0x08000000)
m.admit(pin)
(out/'result.json').write_text(json.dumps({'complete':True,'exitCode':p.returncode,'actualContext':proof,'originalCmdAcceptance':False,'onlyChangedCalls':'two MessageBox result presentations','packageModified':False},indent=2),'utf-8')
