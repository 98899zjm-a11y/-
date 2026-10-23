"""Reuse the original actual Guest admission for fifteen real request and restore contracts."""
import os,sys
from pathlib import Path
ROOT=Path(__file__).resolve().parents[1]
if os.name!='nt' or str(ROOT).lower().replace('\\','/')!='c:/xjy-work/xjy-web-stage1' or not sys.flags.isolated or not sys.flags.no_site or not sys.flags.dont_write_bytecode:raise RuntimeError('Actual fixed Guest -I -B -S required')
import argparse,hashlib,json,subprocess,types
from datetime import datetime,timezone
HELPER='audit-tools/run-finance-erp170-red-a1.py';HELPER_SHA='1f7ab3485de1260db7e0762175b7a15fcafc2d4c942f3adf7d40142a267f1e2e'
TEST='audit-tools/sales-request-knowledge-170.test.cjs';TEST_SHA='529e890ca3b0bb4509ef6140614e9893ba4e84e1dc4a17fd20409e3fcf0eab3d'
PHASES={'candidate':('f13c3425df940f8357e33946b211a05c2fee06b0261a7d9e63cc7f9d80f09835','77752ddc2719f9bf59b402c978ab07f962b44e8487306ce62751dabe5f35237e')}
p=argparse.ArgumentParser(allow_abbrev=False);p.add_argument('--self-sha256',required=True);p.add_argument('--expected-namespace',required=True);p.add_argument('--phase',choices=tuple(PHASES),required=True);args=p.parse_args()
body=(ROOT/HELPER).read_bytes()
if hashlib.sha256(body).hexdigest()!=HELPER_SHA:raise RuntimeError('Original helper changed')
base=types.ModuleType('cleanup_helpers');base.__file__=str(ROOT/HELPER);exec(compile(body,base.__file__,'exec',dont_inherit=True),base.__dict__)
base.pinned(Path(__file__),args.self_sha256);base.verify_fixed(HELPER_SHA,args.expected_namespace)
ctx=types.ModuleType('actual_cleanup_context');ctx.__file__=str(ROOT/'stage1/sandbox-context.py');exec(compile(base.pinned(Path(ctx.__file__),base.GUARDS['stage1/sandbox-context.py']),ctx.__file__,'exec'),ctx.__dict__);proof=ctx.read_context(ROOT)
name='sales-request-knowledge170-'+args.phase+'-a1';manifest=json.loads(base.pinned(Path('C:/xjy-input')/name/'manifest.json',PHASES[args.phase][0]));pins=json.loads(base.pinned(ROOT/'audit-tools/sales-request-knowledge-170-pins.json',PHASES[args.phase][1]))
if manifest['version']!=1 or len(manifest['files'])!=26 or len(pins)!=23:raise RuntimeError('Exact reviewed closure required')
def verify():
    base.verify_fixed(HELPER_SHA,args.expected_namespace);ctx.read_context(ROOT);base.pinned(Path(__file__),args.self_sha256)
    for row in manifest['files']:base.pinned(ROOT/base.relative(row['path']),row['sha256'],row['size'])
verify();out=Path('C:/xjy-results')/name;base.ordinary(out.parent,directory=True);out.mkdir(exist_ok=False)
env=os.environ.copy()
for key in ('NODE_OPTIONS','NODE_PATH','NODE_V8_COVERAGE'):env.pop(key,None)
env.update(XJY_SALES_REQUEST_KNOWLEDGE_TEST_SHA256=TEST_SHA,XJY_SALES_REQUEST_KNOWLEDGE_SOURCE_PINS=json.dumps(pins),XJY_SALES_REQUEST_KNOWLEDGE_NAMESPACE=args.expected_namespace)
command=[str(base.NODE),'--test','--test-reporter=tap',TEST]
result={'phase':args.phase,'namespace':args.expected_namespace,'actualProof':proof,'selfSha256':args.self_sha256,'testSha256':TEST_SHA,'sourcePins':pins,'command':command,'expectedMethods':15,'startedAt':datetime.now(timezone.utc).isoformat(),'complete':False,'exitCode':None,'fullWorkflowAcceptance':False}
try:
    with (out/'test.stdout.bin').open('xb') as stdout,(out/'test.stderr.bin').open('xb') as stderr:
        child=subprocess.run(command,cwd=ROOT,env=env,stdin=subprocess.DEVNULL,stdout=stdout,stderr=stderr,shell=False,creationflags=0x08000000)
    result['exitCode']=child.returncode;verify();result['complete']=True
finally:
    result['endedAt']=datetime.now(timezone.utc).isoformat()
    with (out/'results.json').open('x',encoding='utf-8') as f:json.dump(result,f,indent=2)
print(json.dumps({'phase':args.phase,'complete':result['complete'],'exitCode':result['exitCode']}))
raise SystemExit(0 if result['complete'] and result['exitCode']==0 else 1)
