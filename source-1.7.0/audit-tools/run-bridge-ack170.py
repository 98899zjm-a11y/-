"""Fixed offline Guest source test; no application, database, or native install."""
import os,sys,json,hashlib,importlib.util,subprocess
from pathlib import Path
ROOT=Path('C:/xjy-work/xjy-web-stage1')
assert os.name=='nt' and sys.flags.isolated and sys.flags.no_site and sys.flags.dont_write_bytecode
INPUT=Path(__file__).resolve().parent
assert INPUT.parent==Path('C:/xjy-input') and INPUT.name in ('bridge-ack170-red-a3','bridge-ack170-green-a1')
pin='d630f373911715b3ef5ee80e6fbaeaae838c1469ab53f44759813bc066cf69a7';helper=ROOT/'audit-tools/finance-repack.py'
assert hashlib.sha256(helper.read_bytes()).hexdigest()==pin
spec=importlib.util.spec_from_file_location('fixed',helper);m=importlib.util.module_from_spec(spec);spec.loader.exec_module(m);proof=m.admit(pin)
assert json.loads(m.stable(ROOT/'isolation-identity.json'))['namespace']=='36fcbe9c-ece1-4be3-af35-309a2ee19e05'
manifest=json.loads(m.stable(INPUT/'manifest.json',boundary=INPUT))
for row in manifest['files']:m.pinned(INPUT/row['path'],row['sha256'],INPUT)
node=ROOT/'stage1/tools/node.exe';assert m.sha(m.stable(node,boundary=ROOT,limit=268435456))=='ba4e6d110e8c1592a1ecd390f6b05f3da124b13871a5be62b341a07a853c6c32'
out=Path('C:/xjy-results')/INPUT.name;m.ordinary(out.parent,out.parent);out.mkdir(exist_ok=False)
env=dict(os.environ)
for name in ('NODE_OPTIONS','NODE_PATH','NODE_V8_COVERAGE','ELECTRON_RUN_AS_NODE'):env.pop(name,None)
env['XJY_ACK_TEST_INPUT']=str(INPUT);env['XJY_ACK_SUBJECT_SHA']=next(r['sha256'] for r in manifest['files'] if r['path']=='bridge-entry-170.cjs')
with (out/'stdout.txt').open('xb') as stdout,(out/'stderr.txt').open('xb') as stderr:
    child=subprocess.run([str(node),'--test','--test-reporter=tap',str(INPUT/'bridge-ack170.test.cjs')],cwd=ROOT,env=env,stdin=subprocess.DEVNULL,stdout=stdout,stderr=stderr,creationflags=0x08000000)
m.admit(pin)
result={'complete':True,'exitCode':child.returncode,'subjectSha256':env['XJY_ACK_SUBJECT_SHA'],'actualContext':proof,'nativeInstallExecuted':False,'sourceTestsOnly':True}
(out/'result.json').write_text(json.dumps(result,indent=2),'utf-8');print(json.dumps(result));sys.exit(child.returncode)
