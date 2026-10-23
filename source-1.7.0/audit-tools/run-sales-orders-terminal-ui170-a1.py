"""Reuse the original actual Guest admission for twenty renderer contracts with synthetic ports."""
import os,sys
from pathlib import Path
ROOT=Path(__file__).resolve().parents[1]
if os.name!='nt' or str(ROOT).lower().replace('\\','/')!='c:/xjy-work/xjy-web-stage1' or not sys.flags.isolated or not sys.flags.no_site or not sys.flags.dont_write_bytecode:raise RuntimeError('Actual fixed Guest -I -B -S required')
import argparse,hashlib,json,subprocess,types
from datetime import datetime,timezone
HELPER='audit-tools/run-finance-erp170-red-a1.py';HELPER_SHA='1f7ab3485de1260db7e0762175b7a15fcafc2d4c942f3adf7d40142a267f1e2e'
TEST='audit-tools/sales-orders-terminal-ui170.test.cjs';TEST_SHA='e4ba03592e994824a05822b3631c42d114570455c03319a2414ee43414dd4c24'
PHASES={'candidate':('b320586a7e7c1bdb0fc6ae6dbedef61e1435cae76804ce96406399bc1c80064c','859128c0b9d640ddec45961497cf5ce2a480e33173051598ef2457f29fd2aee1')}
p=argparse.ArgumentParser(allow_abbrev=False);p.add_argument('--self-sha256',required=True);p.add_argument('--expected-namespace',required=True);p.add_argument('--phase',choices=tuple(PHASES),required=True);args=p.parse_args()
body=(ROOT/HELPER).read_bytes()
if hashlib.sha256(body).hexdigest()!=HELPER_SHA:raise RuntimeError('Original helper changed')
base=types.ModuleType('cleanup_helpers');base.__file__=str(ROOT/HELPER);exec(compile(body,base.__file__,'exec',dont_inherit=True),base.__dict__)
base.pinned(Path(__file__),args.self_sha256);base.verify_fixed(HELPER_SHA,args.expected_namespace)
ctx=types.ModuleType('actual_cleanup_context');ctx.__file__=str(ROOT/'stage1/sandbox-context.py');exec(compile(base.pinned(Path(ctx.__file__),base.GUARDS['stage1/sandbox-context.py']),ctx.__file__,'exec'),ctx.__dict__);proof=ctx.read_context(ROOT)
name='sales-orders-terminal-ui170-'+args.phase+'-a1';manifest=json.loads(base.pinned(Path('C:/xjy-input')/name/'manifest.json',PHASES[args.phase][0]));pins=json.loads(base.pinned(ROOT/'audit-tools/sales-orders-terminal-ui170-pins.json',PHASES[args.phase][1]))['sourcePins']
if manifest['version']!=1 or len(manifest['files'])!=9 or len(pins)!=6:raise RuntimeError('Exact reviewed closure required')
def verify():
    base.verify_fixed(HELPER_SHA,args.expected_namespace);ctx.read_context(ROOT);base.pinned(Path(__file__),args.self_sha256)
    for row in manifest['files']:base.pinned(ROOT/base.relative(row['path']),row['sha256'],row['size'])
verify();out=Path('C:/xjy-results')/name;base.ordinary(out.parent,directory=True);out.mkdir(exist_ok=False)
env=os.environ.copy()
for key in ('NODE_OPTIONS','NODE_PATH','NODE_V8_COVERAGE'):env.pop(key,None)
env.update(XJY_ORDER_TERMINAL_UI_TEST_SHA256=TEST_SHA,XJY_ORDER_TERMINAL_UI_SOURCE_PINS=json.dumps(pins),XJY_ORDER_TERMINAL_UI_TYPESCRIPT_SHA256='3ae902c92cc44dace175c0e69e13a4b0899f6983c6121d76b9ab8dd5795e7675')
command=[str(base.NODE),'--test','--test-reporter=tap',TEST]
result={'phase':args.phase,'namespace':args.expected_namespace,'actualProof':proof,'selfSha256':args.self_sha256,'testSha256':TEST_SHA,'sourcePins':pins,'command':command,'expectedMethods':20,'startedAt':datetime.now(timezone.utc).isoformat(),'complete':False,'exitCode':None,'fullWorkflowAcceptance':False}
try:
    with (out/'test.stdout.bin').open('xb') as stdout,(out/'test.stderr.bin').open('xb') as stderr:
        child=subprocess.run(command,cwd=ROOT,env=env,stdin=subprocess.DEVNULL,stdout=stdout,stderr=stderr,shell=False,creationflags=0x08000000)
    result['exitCode']=child.returncode;verify();result['complete']=True
finally:
    result['endedAt']=datetime.now(timezone.utc).isoformat()
    with (out/'results.json').open('x',encoding='utf-8') as f:json.dump(result,f,indent=2)
print(json.dumps({'phase':args.phase,'complete':result['complete'],'exitCode':result['exitCode']}))
raise SystemExit(0 if result['complete'] and result['exitCode']==0 else 1)
