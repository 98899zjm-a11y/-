"""Fixed actual Guest candidate batch: unchanged 23 assertions plus 14 weight checks."""
import os
import sys
from pathlib import Path
ROOT=Path(__file__).resolve().parents[1]
if os.name!='nt' or str(ROOT).lower().replace('\\','/')!='c:/xjy-work/xjy-web-stage1' or not sys.flags.isolated or not sys.flags.no_site or not sys.flags.dont_write_bytecode:
    raise RuntimeError('Actual fixed Guest -I -B -S required')
import argparse
import hashlib
import json
import subprocess
import types
from datetime import datetime,timezone
parser=argparse.ArgumentParser(allow_abbrev=False)
parser.add_argument('--self-sha256',required=True)
parser.add_argument('--expected-namespace',required=True)
args=parser.parse_args()
helper=ROOT/'audit-tools/run-finance-erp170-red-a1.py'
helper_sha='1f7ab3485de1260db7e0762175b7a15fcafc2d4c942f3adf7d40142a267f1e2e'
body=helper.read_bytes()
if hashlib.sha256(body).hexdigest()!=helper_sha: raise RuntimeError('Original runner changed')
base=types.ModuleType('fixed_finance_candidate_helpers');base.__file__=str(helper)
exec(compile(body,str(helper),'exec',dont_inherit=True),base.__dict__)
base.pinned(Path(__file__),args.self_sha256);base.verify_fixed(helper_sha,args.expected_namespace)
context=types.ModuleType('actual_context');context.__file__=str(ROOT/'stage1/sandbox-context.py')
exec(compile(base.pinned(Path(context.__file__),base.GUARDS['stage1/sandbox-context.py']),context.__file__,'exec'),context.__dict__)
proof=context.read_context(ROOT)
manifest_bytes=base.pinned(Path('C:/xjy-input/finance170-accuracy-candidate-a1/manifest.json'),'04047f9797611d48e05e6b66c473e0d4a8c21baba8637d881a21ae31a35ba0e7')
manifest=json.loads(manifest_bytes)
if manifest['version']!=1 or len(manifest['files'])!=8: raise RuntimeError('Exact eight candidate inputs required')
def check_sources():
    for item in manifest['files']:
        relative=base.relative(item['path']);base.pinned(ROOT/relative,item['sha256'],item['size'])
check_sources()
checks=[
 ('accuracy',[str(base.PYTHON),'-I','-B','-S','-X','utf8','audit-tools/finance-erp170-candidate-accuracy.py','--self-sha256','01c48db7bb60e6f03ca81a322199cd75f2387478f6652a67aa313ad5389eaaa4','--original-test-sha256','db13aeb68a8eb42beb0528be714aa3a319bfdd77e89df7fe9422a417e540cf7a','--pins-sha256','d5250b57acf80e166609c67a6fc6ed9521c3d381ef78b347d21f9727ac7ed8c4','--expected-namespace',args.expected_namespace]),
 ('weight',[str(base.PYTHON),'-I','-B','-S','-X','utf8','audit-tools/finance-erp-round2-weight.test.py','--test-sha256','e5f67c9316618c1fabbe6a3494fad3da9a10f15927e5edfc063642434d003190','--pins-sha256','9fbbbd2d4546cf0fb6b12822c9fb704dd8f0077598e8ce5d462871709178bc14','--expected-namespace',args.expected_namespace,'--phase','candidate']),
]
base.pinned(ROOT/'audit-tools/finance-erp-round2-weight.test.py','e5f67c9316618c1fabbe6a3494fad3da9a10f15927e5edfc063642434d003190')
base.pinned(ROOT/'audit-tools/finance-erp-round2-weight-pins.json','9fbbbd2d4546cf0fb6b12822c9fb704dd8f0077598e8ce5d462871709178bc14')
out=Path('C:/xjy-results/finance170-candidate-a1')
base.ordinary(out.parent,directory=True);out.mkdir(exist_ok=False);base.ordinary(out,directory=True)
result={'actualProof':proof,'namespace':args.expected_namespace,'selfSha256':args.self_sha256,'inputs':manifest['files'],'checks':[],'complete':False,'fullWorkflowAcceptance':False}
try:
    for name,command in checks:
        check_sources();base.verify_fixed(helper_sha,args.expected_namespace);context.read_context(ROOT)
        row={'name':name,'command':command,'startedAt':datetime.now(timezone.utc).isoformat()}
        with (out/(name+'.stdout.bin')).open('xb') as stdout,(out/(name+'.stderr.bin')).open('xb') as stderr:
            child=subprocess.run(command,cwd=ROOT,stdin=subprocess.DEVNULL,stdout=stdout,stderr=stderr,shell=False,creationflags=0x08000000)
        row.update(exitCode=child.returncode,endedAt=datetime.now(timezone.utc).isoformat());result['checks'].append(row)
    check_sources();base.verify_fixed(helper_sha,args.expected_namespace);context.read_context(ROOT)
    result['complete']=True
finally:
    with (out/'results.json').open('x',encoding='utf-8') as stream:json.dump(result,stream,indent=2)
print(json.dumps({'complete':result['complete'],'checks':[{key:row[key] for key in ('name','exitCode')} for row in result['checks']]}))
raise SystemExit(0 if result['complete'] and all(row['exitCode']==0 for row in result['checks']) else 1)
