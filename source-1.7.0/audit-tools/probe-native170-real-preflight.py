"""Read-only execution of exact real-package preflight, stops before helper."""
import os,sys,json,hashlib,importlib.util,subprocess,base64
from pathlib import Path
ROOT=Path('C:/xjy-work/xjy-web-stage1');INPUT=Path('C:/xjy-input/native170-real-preflight-probe-a1')
assert os.name=='nt' and sys.flags.isolated and sys.flags.no_site and sys.flags.dont_write_bytecode and Path(__file__).resolve()==INPUT/'probe-native170-real-preflight.py'
pin='d630f373911715b3ef5ee80e6fbaeaae838c1469ab53f44759813bc066cf69a7';helper=ROOT/'audit-tools/finance-repack.py'
assert hashlib.sha256(helper.read_bytes()).hexdigest()==pin
spec=importlib.util.spec_from_file_location('fixed',helper);m=importlib.util.module_from_spec(spec);spec.loader.exec_module(m);proof=m.admit(pin)
assert json.loads(m.stable(ROOT/'isolation-identity.json'))['namespace']=='36fcbe9c-ece1-4be3-af35-309a2ee19e05'
package=ROOT/'runtime/native170-fresh-employee-a2/package'
source=m.pinned(package/'安装组件/native-delivery-170.ps1','4d8076e28da7b86039a36ac64761a41b0810bd4baa0c2e2ffb82138be361eb04').decode('utf-8-sig')
assert source.count(' $mode=switch($Action)')==1
prefix=source.split(' $mode=switch($Action)')[0]
suffix="[Console]::WriteLine('PREFLIGHT_OK');exit 0}catch{[Console]::Error.WriteLine($_.Exception.Message);[Console]::Error.WriteLine($_.ScriptStackTrace);exit 1}finally{Close-XjyProgressView -View $progressView;for($i=$held.Count-1;$i -ge 0;$i--){$held[$i].Dispose()}}"
work=ROOT/'runtime/native170-real-preflight-probe-a1';m.mkdir_new(work);script=work/'preflight.ps1';script.write_bytes(b'\xef\xbb\xbf'+(prefix+suffix).encode())
out=Path('C:/xjy-results/native170-real-preflight-probe-a1');m.ordinary(out.parent,out.parent);out.mkdir(exist_ok=False)
q=lambda s:"'"+str(s).replace("'","''")+"'"
command="[Console]::OutputEncoding=[Text.UTF8Encoding]::new($false);$s=[IO.File]::ReadAllText("+q(script)+",[Text.Encoding]::UTF8);& ([ScriptBlock]::Create($s)) -PackageRoot "+q(package)+" -Action 'FreshEmployee'"
with (out/'stdout.txt').open('xb') as stdout,(out/'stderr.txt').open('xb') as stderr:
 p=subprocess.run(['C:/Windows/System32/WindowsPowerShell/v1.0/powershell.exe','-NoProfile','-NonInteractive','-STA','-EncodedCommand',base64.b64encode(command.encode('utf-16le')).decode()],cwd=ROOT,stdin=subprocess.DEVNULL,stdout=stdout,stderr=stderr,creationflags=0x08000000)
m.admit(pin)
(out/'result.json').write_text(json.dumps({'complete':True,'exitCode':p.returncode,'actualContext':proof,'helperExecuted':False,'packageModified':False},indent=2),'utf-8')
