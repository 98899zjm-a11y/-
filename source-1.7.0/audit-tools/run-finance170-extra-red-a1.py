"""Fixed offline Guest follow-up tests; raw child logs, no Windows exit-code proxy."""
import os
import sys
from pathlib import Path
ROOT = Path(__file__).resolve().parents[1]
if os.name != 'nt' or str(ROOT).lower().replace('\\','/') != 'c:/xjy-work/xjy-web-stage1' or not sys.flags.isolated or not sys.flags.no_site or not sys.flags.dont_write_bytecode:
    raise RuntimeError('Actual fixed Guest -I -B -S required')
import argparse
import hashlib
import json
import subprocess
import types
from datetime import datetime, timezone

HELPER = 'audit-tools/run-finance-erp170-red-a1.py'
HELPER_SHA = '1f7ab3485de1260db7e0762175b7a15fcafc2d4c942f3adf7d40142a267f1e2e'
parser = argparse.ArgumentParser(allow_abbrev=False)
parser.add_argument('--self-sha256', required=True)
parser.add_argument('--expected-namespace', required=True)
args = parser.parse_args()
body = (ROOT/HELPER).read_bytes()
if hashlib.sha256(body).hexdigest() != HELPER_SHA:
    raise RuntimeError('Frozen original runner changed')
base = types.ModuleType('fixed_finance_runner_helpers'); base.__file__ = str(ROOT/HELPER)
exec(compile(body, base.__file__, 'exec', dont_inherit=True), base.__dict__)
base.pinned(Path(__file__), args.self_sha256)
base.verify_fixed(HELPER_SHA, args.expected_namespace)
context = types.ModuleType('actual_context'); context.__file__ = str(ROOT/'stage1/sandbox-context.py')
exec(compile(base.pinned(Path(context.__file__), base.GUARDS['stage1/sandbox-context.py']), context.__file__, 'exec'), context.__dict__)
proof = context.read_context(ROOT)
queue_pins = base.pinned(ROOT/'audit-tools/strict-round2-maintenance-log-source-pins.json', 'c54b6620b62ae1311ebdf629f516b9bbc1e8270d3a1e4a9363e205b2ba7bfac8').decode('utf-8-sig')
checks = [
    ('month', 'audit-tools/finance-erp-round2-contract.test.py', '93d0f83ae5e171b12544a412dd894da0fef0eb550455dcf10ce4fd099bed41fe',
     [str(base.PYTHON), '-I','-B','-S','-X','utf8','audit-tools/finance-erp-round2-contract.test.py','--test-sha256','93d0f83ae5e171b12544a412dd894da0fef0eb550455dcf10ce4fd099bed41fe','--expected-namespace',args.expected_namespace]),
    ('queue', 'audit-tools/strict-round2-maintenance-log-queue.test.cjs', '8a661d03d097c8d324dd112e0f2ce1dc9e511a5bda9ebd4b57d5eaf85b1b782e',
     [str(base.NODE),'--test','--test-reporter=tap','audit-tools/strict-round2-maintenance-log-queue.test.cjs']),
    ('identity-layout','audit-tools/finance-runtime-170-erp-identity.py','eaca7feb943482a6d954c3e00375d41aab6603ed78700319e74163904d30e619',
     [str(base.PYTHON),'-I','-B','-S','-X','utf8','audit-tools/finance-runtime-170-erp-identity.py','--self-sha256','eaca7feb943482a6d954c3e00375d41aab6603ed78700319e74163904d30e619','--expected-namespace',args.expected_namespace,'--phase','layout','--run-id','finance-runtime-170-erp-layout-a1']),
]
for _, file, pin, _ in checks: base.pinned(ROOT/file, pin)
out = Path('C:/xjy-results/finance170-extra-red-a1')
base.ordinary(out.parent, directory=True); out.mkdir(exist_ok=False); base.ordinary(out,directory=True)
env = os.environ.copy()
env.pop('NODE_OPTIONS',None); env.pop('NODE_PATH',None)
env.update(XJY_STRICT_ROUND2_MAINTENANCE_LOG_TEST_SHA256=checks[1][2],XJY_STRICT_ROUND2_MAINTENANCE_LOG_SOURCE_PINS=queue_pins,XJY_STRICT_ROUND2_MAINTENANCE_LOG_NAMESPACE=args.expected_namespace)
result = {'actualProof':proof,'namespace':args.expected_namespace,'selfSha256':args.self_sha256,'checks':[],'complete':False}
try:
    for name,file,pin,command in checks:
        base.verify_fixed(HELPER_SHA,args.expected_namespace); context.read_context(ROOT); base.pinned(ROOT/file,pin)
        row={'name':name,'command':command,'testSha256':pin,'startedAt':datetime.now(timezone.utc).isoformat()}
        with (out/(name+'.stdout.bin')).open('xb') as stdout, (out/(name+'.stderr.bin')).open('xb') as stderr:
            process=subprocess.run(command,cwd=ROOT,env=env,stdin=subprocess.DEVNULL,stdout=stdout,stderr=stderr,shell=False,creationflags=0x08000000)
        row.update(exitCode=process.returncode,endedAt=datetime.now(timezone.utc).isoformat()); result['checks'].append(row)
        with (out/(name+'.result.json')).open('x',encoding='utf-8') as stream: json.dump(row,stream,indent=2)
    base.verify_fixed(HELPER_SHA,args.expected_namespace); context.read_context(ROOT)
    for _,file,pin,_ in checks: base.pinned(ROOT/file,pin)
    result['complete']=True
finally:
    with (out/'results.json').open('x',encoding='utf-8') as stream: json.dump(result,stream,indent=2)
print(json.dumps({'complete':result['complete'],'checks':[{k:row[k] for k in ('name','exitCode')} for row in result['checks']]}))
raise SystemExit(0 if result['complete'] and all(row['exitCode']==0 for row in result['checks']) else 1)
