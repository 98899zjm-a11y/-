"""Fixed actual offline Guest runner; never invokes a physical printer."""
import os
import sys
from pathlib import Path
ROOT=Path(__file__).resolve().parents[1]
if os.name!='nt' or str(ROOT).lower().replace('\\','/')!='c:/xjy-work/xjy-web-stage1' or not sys.flags.isolated or not sys.flags.no_site or not sys.flags.dont_write_bytecode:raise RuntimeError('Actual fixed Guest -I -B -S required')
import argparse
import hashlib
import json
import subprocess
import types
from datetime import datetime,timezone
HELPER='audit-tools/run-finance-erp170-red-a1.py'
HELPER_SHA='1f7ab3485de1260db7e0762175b7a15fcafc2d4c942f3adf7d40142a267f1e2e'
PHASES={'red':('669315bd1e4bcd91fa56d178288b242cfa4a0799c6ec8cb4633a7a1ed4a53a19','4b39b908ffe46ae5e068c317d792d9746acd363d9750f1715812d82d3ffab263'),'candidate':('9a6219d1ceca8aaf1749f99be3272018da7aa7eaa09842c162099ab74611cafd','ae7b27582ad2584c278d47c3ecf9ed81fdd375f099353d3955685f5db9312a75')}
p=argparse.ArgumentParser(allow_abbrev=False);p.add_argument('--self-sha256',required=True);p.add_argument('--expected-namespace',required=True);p.add_argument('--phase',choices=tuple(PHASES),required=True);args=p.parse_args()
body=(ROOT/HELPER).read_bytes()
if hashlib.sha256(body).hexdigest()!=HELPER_SHA:raise RuntimeError('Original helper changed')
base=types.ModuleType('print_runner_helpers');base.__file__=str(ROOT/HELPER);exec(compile(body,base.__file__,'exec',dont_inherit=True),base.__dict__)
base.pinned(Path(__file__),args.self_sha256);base.verify_fixed(HELPER_SHA,args.expected_namespace)
ctx=types.ModuleType('actual_print_context');ctx.__file__=str(ROOT/'stage1/sandbox-context.py');exec(compile(base.pinned(Path(ctx.__file__),base.GUARDS['stage1/sandbox-context.py']),ctx.__file__,'exec'),ctx.__dict__);proof=ctx.read_context(ROOT)
name='order-print170-'+args.phase+'-a2';manifest=json.loads(base.pinned(Path('C:/xjy-input')/name/'manifest.json',PHASES[args.phase][0]));metadata=json.loads(base.pinned(ROOT/('audit-tools/'+name+'-pins.json'),PHASES[args.phase][1]))
if manifest['version']!=1 or len(manifest['files'])!=21 or metadata['phase']!=args.phase:raise RuntimeError('Exact phase manifest required')
def verify():
    base.verify_fixed(HELPER_SHA,args.expected_namespace);ctx.read_context(ROOT);base.pinned(Path(__file__),args.self_sha256)
    for row in manifest['files']:base.pinned(ROOT/base.relative(row['path']),row['sha256'],row['size'])
verify()
out=Path('C:/xjy-results')/name;base.ordinary(out.parent,directory=True);out.mkdir(exist_ok=False);base.ordinary(out,directory=True)
env=os.environ.copy()
for key in ('NODE_OPTIONS','NODE_PATH','NODE_V8_COVERAGE'):env.pop(key,None)
env.update(XJY_ORDER_PRINT_UI_TEST_SHA256=metadata['uiTest'],XJY_ORDER_PRINT_UI_SOURCE_PINS=json.dumps(metadata['uiSourcePins']),XJY_ORDER_PRINT_UI_TYPESCRIPT_SHA256=metadata['compilerSha256'],XJY_ORDER_PRINT_UI_ZOD_TREE_SHA256=metadata['zodTreeSha256'],XJY_ORDER_PRINT_HOST_TEST_SHA256=metadata['hostTest'],XJY_ORDER_PRINT_HOST_SOURCE_PINS=json.dumps(metadata['hostSourcePins']))
result={'phase':args.phase,'namespace':args.expected_namespace,'actualProof':proof,'selfSha256':args.self_sha256,'metadata':metadata,'sourceFiles':manifest['files'],'checks':[],'complete':False,'physicalPrintAttempted':False,'actualGuiVerified':False,'fullWorkflowAcceptance':False}
try:
    for label,file,methods in [('ui','audit-tools/remote-print-order-ui-contract.test.cjs',17),('host','audit-tools/order-print-host170-v2.test.cjs',12)]:
        verify();row={'name':label,'expectedMethods':methods,'command':[str(base.NODE),'--test','--test-reporter=tap',file],'startedAt':datetime.now(timezone.utc).isoformat()}
        with (out/(label+'.stdout.bin')).open('xb') as stdout,(out/(label+'.stderr.bin')).open('xb') as stderr:
            child=subprocess.run(row['command'],cwd=ROOT,env=env,stdin=subprocess.DEVNULL,stdout=stdout,stderr=stderr,shell=False,creationflags=0x08000000)
        row.update(exitCode=child.returncode,endedAt=datetime.now(timezone.utc).isoformat());result['checks'].append(row)
    verify();result['complete']=True
finally:
    with (out/'results.json').open('x',encoding='utf-8') as f:json.dump(result,f,indent=2)
print(json.dumps({'phase':args.phase,'complete':result['complete'],'checks':[{k:r[k] for k in ('name','exitCode')} for r in result['checks']]}))
raise SystemExit(0 if result['complete'] and all(r['exitCode']==0 for r in result['checks']) else 1)
