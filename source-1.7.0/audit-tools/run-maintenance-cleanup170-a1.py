"""Reuse the original actual Guest admission for seven real restore contracts."""
import os,sys
from pathlib import Path
ROOT=Path(__file__).resolve().parents[1]
if os.name!='nt' or str(ROOT).lower().replace('\\','/')!='c:/xjy-work/xjy-web-stage1' or not sys.flags.isolated or not sys.flags.no_site or not sys.flags.dont_write_bytecode:raise RuntimeError('Actual fixed Guest -I -B -S required')
import argparse,hashlib,json,subprocess,types
from datetime import datetime,timezone
HELPER='audit-tools/run-finance-erp170-red-a1.py';HELPER_SHA='1f7ab3485de1260db7e0762175b7a15fcafc2d4c942f3adf7d40142a267f1e2e'
TEST='audit-tools/maintenance-cleanup-boundary-170.test.cjs';TEST_SHA='5686d0956089a80b54be1af57c4304bd2675f4c070fc6940f3b225bd10a45f44'
PHASES={'red':('d3ec37813e1bb18fcd8774bb57c8ef80cc8eaf2d363ae823f072cf16dda93db4','99844496a031bcfd876113a022d5f5c34f520db458c4ffafb9e77e4e0c0a465a'),'candidate':('6de3a16970ae49bbb022579a339c41fa25b6ec0e1db1e7ac40df502d0db6ad54','997bebf3e660be35c297cea83975e902c14b35c0bbf3593dc5362f05d5718c95')}
p=argparse.ArgumentParser(allow_abbrev=False);p.add_argument('--self-sha256',required=True);p.add_argument('--expected-namespace',required=True);p.add_argument('--phase',choices=tuple(PHASES),required=True);args=p.parse_args()
body=(ROOT/HELPER).read_bytes()
if hashlib.sha256(body).hexdigest()!=HELPER_SHA:raise RuntimeError('Original helper changed')
base=types.ModuleType('cleanup_helpers');base.__file__=str(ROOT/HELPER);exec(compile(body,base.__file__,'exec',dont_inherit=True),base.__dict__)
base.pinned(Path(__file__),args.self_sha256);base.verify_fixed(HELPER_SHA,args.expected_namespace)
ctx=types.ModuleType('actual_cleanup_context');ctx.__file__=str(ROOT/'stage1/sandbox-context.py');exec(compile(base.pinned(Path(ctx.__file__),base.GUARDS['stage1/sandbox-context.py']),ctx.__file__,'exec'),ctx.__dict__);proof=ctx.read_context(ROOT)
name='maintenance-cleanup170-'+args.phase+'-a1';manifest=json.loads(base.pinned(Path('C:/xjy-input')/name/'manifest.json',PHASES[args.phase][0]));pins=json.loads(base.pinned(ROOT/'audit-tools/maintenance-cleanup-boundary-170-pins.json',PHASES[args.phase][1]))
if manifest['version']!=1 or len(manifest['files'])!=25 or len(pins)!=22:raise RuntimeError('Exact reviewed closure required')
def verify():
    base.verify_fixed(HELPER_SHA,args.expected_namespace);ctx.read_context(ROOT);base.pinned(Path(__file__),args.self_sha256)
    for row in manifest['files']:base.pinned(ROOT/base.relative(row['path']),row['sha256'],row['size'])
verify();out=Path('C:/xjy-results')/name;base.ordinary(out.parent,directory=True);out.mkdir(exist_ok=False)
env=os.environ.copy()
for key in ('NODE_OPTIONS','NODE_PATH','NODE_V8_COVERAGE'):env.pop(key,None)
env.update(XJY_MAINTENANCE_CLEANUP_TEST_SHA256=TEST_SHA,XJY_MAINTENANCE_CLEANUP_SOURCE_PINS=json.dumps(pins),XJY_MAINTENANCE_CLEANUP_NAMESPACE=args.expected_namespace)
command=[str(base.NODE),'--test','--test-reporter=tap',TEST]
result={'phase':args.phase,'namespace':args.expected_namespace,'actualProof':proof,'selfSha256':args.self_sha256,'testSha256':TEST_SHA,'sourcePins':pins,'command':command,'expectedMethods':7,'startedAt':datetime.now(timezone.utc).isoformat(),'complete':False,'exitCode':None,'fullWorkflowAcceptance':False}
try:
    with (out/'test.stdout.bin').open('xb') as stdout,(out/'test.stderr.bin').open('xb') as stderr:
        child=subprocess.run(command,cwd=ROOT,env=env,stdin=subprocess.DEVNULL,stdout=stdout,stderr=stderr,shell=False,creationflags=0x08000000)
    result['exitCode']=child.returncode;verify();result['complete']=True
finally:
    result['endedAt']=datetime.now(timezone.utc).isoformat()
    with (out/'results.json').open('x',encoding='utf-8') as f:json.dump(result,f,indent=2)
print(json.dumps({'phase':args.phase,'complete':result['complete'],'exitCode':result['exitCode']}))
raise SystemExit(0 if result['complete'] and result['exitCode']==0 else 1)
