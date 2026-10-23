"""Actual Guest command parsing probes; never invokes the native installer."""
import os,sys,json,hashlib,importlib.util,subprocess
from pathlib import Path
ROOT=Path('C:/xjy-work/xjy-web-stage1');INPUT=Path('C:/xjy-input/native170-cmd-probe-a1')
assert os.name=='nt' and sys.flags.isolated and sys.flags.no_site and sys.flags.dont_write_bytecode and Path(__file__).resolve()==INPUT/'probe-native170-cmd.py'
pin='d630f373911715b3ef5ee80e6fbaeaae838c1469ab53f44759813bc066cf69a7';helper=ROOT/'audit-tools/finance-repack.py'
assert hashlib.sha256(helper.read_bytes()).hexdigest()==pin
spec=importlib.util.spec_from_file_location('fixed',helper);m=importlib.util.module_from_spec(spec);spec.loader.exec_module(m);proof=m.admit(pin)
assert json.loads(m.stable(ROOT/'isolation-identity.json'))['namespace']=='36fcbe9c-ece1-4be3-af35-309a2ee19e05'
work=ROOT/'runtime/native170-cmd-probe-a1';m.mkdir_new(work)
out=Path('C:/xjy-results/native170-cmd-probe-a1');m.ordinary(out.parent,out.parent);out.mkdir(exist_ok=False)
assembly=json.loads(m.pinned(Path('C:/xjy-input/native170-build-a4/assembly.json'),'0df3ab745a7d75610a03884ae0d6352f07d357b4560bcc6ccb441ec1af3b12d6',Path('C:/xjy-input/native170-build-a4')))
row=next(r for r in assembly['files'] if r['path']=='首次安装员工.cmd')
original=m.pinned(ROOT/'runtime/native170-fresh-employee-a1/package/首次安装员工.cmd',row['sha256'])
results=[]
for name,leaf,body in [('ascii','probe.cmd',b'@echo off\r\necho PROBE_OK\r\nexit /b 0\r\n'),('unicode','首次安装员工.cmd',b'@echo off\r\necho PROBE_OK\r\nexit /b 0\r\n'),('loader','首次安装员工.cmd',original)]:
 case=work/name;case.mkdir();file=case/leaf;file.write_bytes(body)
 if name=='loader':
  (case/'安装组件').mkdir();(case/'安装组件/native-delivery-170.ps1').write_bytes(b"throw 'SHADOW BOOTSTRAP MUST NOT EXECUTE'")
 command=['C:/Windows/System32/cmd.exe','/d','/c',str(file)]
 result=subprocess.run(command,cwd=case,stdin=subprocess.DEVNULL,stdout=subprocess.PIPE,stderr=subprocess.PIPE,creationflags=0x08000000,shell=False,env=os.environ.copy())
 (out/(name+'.stdout')).write_bytes(result.stdout);(out/(name+'.stderr')).write_bytes(result.stderr)
 results.append({'name':name,'command':command,'exitCode':result.returncode,'stdoutUtf8':result.stdout.decode('utf-8','replace'),'stderrUtf8':result.stderr.decode('utf-8','replace'),'stderrCp936':result.stderr.decode('cp936','replace')})
m.admit(pin)
record={'complete':True,'actualContext':proof,'cases':results,'nativeInstallerExecuted':False,'loaderCaseOnlyShadowBootstrapWithWrongHash':True}
(out/'result.json').write_text(json.dumps(record,ensure_ascii=False,indent=2),'utf-8');print(json.dumps({'cases':[(r['name'],r['exitCode']) for r in results]}))
