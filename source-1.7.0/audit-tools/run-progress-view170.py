"""Actual offline Guest WinForms controls; no installer or business execution."""
import os,sys,json,hashlib,importlib.util,subprocess,base64
from pathlib import Path
ROOT=Path('C:/xjy-work/xjy-web-stage1');INPUT=Path('C:/xjy-input/progress-view170-a1')
assert os.name=='nt' and sys.flags.isolated and sys.flags.no_site and sys.flags.dont_write_bytecode and Path(__file__).resolve()==INPUT/'run-progress-view170.py'
pin='d630f373911715b3ef5ee80e6fbaeaae838c1469ab53f44759813bc066cf69a7';helper=ROOT/'audit-tools/finance-repack.py'
assert hashlib.sha256(helper.read_bytes()).hexdigest()==pin
spec=importlib.util.spec_from_file_location('fixed',helper);m=importlib.util.module_from_spec(spec);spec.loader.exec_module(m);proof=m.admit(pin)
assert json.loads(m.stable(ROOT/'isolation-identity.json'))['namespace']=='36fcbe9c-ece1-4be3-af35-309a2ee19e05'
manifest=json.loads(m.stable(INPUT/'manifest.json',boundary=INPUT))
for row in manifest['files']:m.pinned(INPUT/row['path'],row['sha256'],INPUT)
out=Path('C:/xjy-results/progress-view170-a1');m.ordinary(out.parent,out.parent);out.mkdir(exist_ok=False)
source=INPUT/'UpdateProgressView170.ps1';script=INPUT/'test-progress-view170.ps1'
q=lambda s:"'"+str(s).replace("'","''")+"'"
command="$ErrorActionPreference='Stop';$s=[IO.File]::ReadAllText("+q(script)+",[Text.Encoding]::UTF8);& ([ScriptBlock]::Create($s)) -Source "+q(source)+" -OutputDirectory "+q(out)
with (out/'stdout.txt').open('xb') as stdout,(out/'stderr.txt').open('xb') as stderr:
 child=subprocess.run(['C:/Windows/System32/WindowsPowerShell/v1.0/powershell.exe','-NoProfile','-NonInteractive','-STA','-EncodedCommand',base64.b64encode(command.encode('utf-16le')).decode()],cwd=ROOT,stdin=subprocess.DEVNULL,stdout=stdout,stderr=stderr,creationflags=0x08000000)
m.admit(pin)
result={'complete':True,'exitCode':child.returncode,'actualContext':proof,'nativeInstallerExecuted':False}
(out/'result.json').write_text(json.dumps(result,indent=2),'utf-8');print(json.dumps(result));sys.exit(child.returncode)
