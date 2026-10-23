"""Fixed two actual-file engine ordering regressions; unchanged original Guest helpers."""
import os, sys
from pathlib import Path
ROOT = Path(__file__).resolve().parents[1]
if (os.name != 'nt' or str(ROOT).lower().replace('\\', '/') != 'c:/xjy-work/xjy-web-stage1' or
        not sys.flags.isolated or not sys.flags.no_site or not sys.flags.dont_write_bytecode or sys.flags.optimize):
    raise RuntimeError('Actual fixed Guest Python -I -B -S required')
import argparse, hashlib, json, re, types
HELPER = 'audit-tools/run-finance-erp170-red-a1.py'
HELPER_SHA = '1f7ab3485de1260db7e0762175b7a15fcafc2d4c942f3adf7d40142a267f1e2e'
EXPECTED_NAMESPACE = '36fcbe9c-ece1-4be3-af35-309a2ee19e05'
PHASES = {'candidate': '6c3bae61134893c24c33fea0ab773d4abe92a3356f9504764aa1cb91c5e848ff'}
KEYS = {
    'audit-tools/engine-commit-before-start170-a2.test.cjs',
    'audit-tools/engine-tree-candidate.test.cjs',
    'delivery-tools/engine-tree-candidate.cjs',
    'delivery-tools/engine-tree-runtime170.cjs',
    'delivery-tools/initial-patch-core.cjs',
    'project/desktop/employee-update-cache.cjs',
    'project/desktop/employee-update-installer.cjs',
    'project/desktop/engine-startup-gate.cjs',
    'stage1/isolation.cjs',
    'stage1/sandbox-context.py',
    'stage1/validate-sandbox-context.py',
    'tests/employee-update-fixtures.cjs',
}

def initialize(args):
    if (not re.fullmatch('[a-f0-9]{64}', args.self_sha256) or
            args.expected_namespace != EXPECTED_NAMESPACE):
        raise RuntimeError('Exact self SHA and actual namespace UUID required')
    raw = (ROOT / HELPER).read_bytes()
    if hashlib.sha256(raw).hexdigest() != HELPER_SHA: raise RuntimeError('Original helper changed')
    base = types.ModuleType('fixed_universal170_helpers'); base.__file__ = str(ROOT / HELPER)
    exec(compile(raw, base.__file__, 'exec', dont_inherit=True), base.__dict__)
    base.pinned(Path(__file__), args.self_sha256); base.verify_fixed(HELPER_SHA, args.expected_namespace)
    ctx = types.ModuleType('actual_universal170_context'); ctx.__file__ = str(ROOT / 'stage1/sandbox-context.py')
    exec(compile(base.pinned(Path(ctx.__file__), base.GUARDS['stage1/sandbox-context.py']), ctx.__file__, 'exec'), ctx.__dict__)
    return base, ctx, ctx.read_context(ROOT)
def inventory(base, phase, check_root=False):
    package = Path('C:/xjy-input') / 'engine-commit170-candidate-a1'
    manifest = json.loads(base.pinned(package / 'manifest.json', PHASES[phase]))
    if (set(manifest) != {'version', 'purpose', 'files'} or manifest['version'] != 1 or
            manifest['purpose'] != 'data-free isolated audit code and public compiler' or
            not isinstance(manifest['files'], list) or len(manifest['files']) != 12):
        raise RuntimeError('Exact 12-file sealed manifest required')
    rows = {}; bodies = {}
    for row in manifest['files']:
        if (not isinstance(row, dict) or set(row) != {'path', 'size', 'sha256'} or row['path'] not in KEYS or
                row['path'] in rows or type(row['size']) is not int or not 0 < row['size'] <= 4 * 1024 * 1024 or
                not isinstance(row['sha256'], str) or not re.fullmatch('[a-f0-9]{64}', row['sha256'])):
            raise RuntimeError('Only the exact 12 reviewed source paths are admitted')
        rel = row['path']; rows[rel] = row; bodies[rel] = base.pinned(package / rel, row['sha256'], row['size'])
        if check_root or rel in base.GUARDS: base.pinned(ROOT / rel, row['sha256'], row['size'])
    if set(rows) != KEYS: raise RuntimeError('Exact source set changed')
    return rows, bodies

import subprocess
from datetime import datetime, timezone
SUITES = {'commit': (2, ['audit-tools/engine-commit-before-start170-a2.test.cjs'])}

p = argparse.ArgumentParser(allow_abbrev=False)
p.add_argument('--self-sha256', required=True); p.add_argument('--expected-namespace', required=True)
p.add_argument('--phase', choices=tuple(PHASES), required=True); p.add_argument('--suite', choices=tuple(SUITES), default='commit')
p.add_argument('--run-id', required=True); p.add_argument('--preflight-only', action='store_true'); args = p.parse_args()
if not re.fullmatch('engine-commit170-' + args.phase + r'-a1(?:-[a-z0-9][a-z0-9-]{0,31})?', args.run_id):
    raise RuntimeError('Fresh bounded phase/suite run ID required')
base, ctx, proof = initialize(args)
rows, _ = inventory(base, args.phase, check_root=True)
def verify():
    base.verify_fixed(HELPER_SHA,args.expected_namespace); value = ctx.read_context(ROOT)
    base.pinned(Path(__file__),args.self_sha256)
    after, _ = inventory(base,args.phase,check_root=True)
    if after != rows: raise RuntimeError('Before/after source inventory changed')
    return value
proof = verify()
if args.preflight_only:
    print(json.dumps({'preflightOnly': True, 'readOnly': True, 'namespace': args.expected_namespace,
                      'actualProof': proof, 'sourceCount': len(rows), 'manifestSha256': PHASES[args.phase],
                      'suite': args.suite, 'expectedMethods': SUITES[args.suite][0], 'testsExecuted': False}))
    raise SystemExit(0)
output = Path('C:/xjy-results'); output_info = base.ordinary(output,directory=True)
out = output / args.run_id; out.mkdir(exist_ok=False); out_info = base.ordinary(out,directory=True)
def output_check():
    for directory,before in ((output,output_info),(out,out_info)):
        now = base.ordinary(directory,directory=True)
        if (now.st_dev,now.st_ino) != (before.st_dev,before.st_ino): raise RuntimeError('Owned output identity changed')
def create_json(name,value):
    output_check()
    with (out/name).open('xb') as stream:
        stream.write((json.dumps(value,ensure_ascii=False,indent=2)+'\n').encode('utf-8'));stream.flush();os.fsync(stream.fileno())
methods, files = SUITES[args.suite]
command = [str(base.NODE),'--test','--test-concurrency=1','--test-reporter=tap',*files]
env = os.environ.copy()
for name in ('NODE_OPTIONS','NODE_PATH','NODE_V8_COVERAGE','ESBUILD_BINARY_PATH'): env.pop(name,None)
env.update({'XJY_ENGINE_COMMIT_SUBJECT': 'delivery-tools/engine-tree-runtime170.cjs',
            'XJY_ENGINE_COMMIT_SOURCE_PINS': json.dumps({key: value['sha256'] for key,value in rows.items()}),
            'XJY_ENGINE_COMMIT_TEST_SHA256': 'e1d9c416dcc91d2385348edec22c566584deafbb7c304082e3688b85a8c3057b'})
result = {'phase': args.phase, 'suite': args.suite, 'runId': args.run_id, 'namespace': args.expected_namespace,
          'actualProof': proof, 'selfSha256': args.self_sha256, 'manifestSha256': PHASES[args.phase],
          'sourcePins': rows, 'expectedMethods': methods, 'command': command,
          'startedAt': datetime.now(timezone.utc).isoformat(), 'exitCode': None,
          'complete': False, 'allRequestedChecksPassed': False, 'status': 'not-started', 'errors': [],
          'countsAreSeparate': True, 'timeoutPolicy': 'No timeout or termination; Root inspects stalled child.',
          'onlyContractTests': True, 'executableLaunched': False, 'sqliteOpened': False, 'nativeInstallationVerified': False, 'formalDeploymentVerified': False, 'fullWorkflowAcceptance': False}
create_json('plan.json',result)
try:
    output_check();verify()
    with (out/'test.stdout.bin').open('xb') as stdout,(out/'test.stderr.bin').open('xb') as stderr:
        result['status']='running'
        child=subprocess.run(command,cwd=ROOT,env=env,stdin=subprocess.DEVNULL,stdout=stdout,stderr=stderr,
                             shell=False,close_fds=True,creationflags=0x08000000)
        result['exitCode']=child.returncode
        for stream in (stdout,stderr):stream.flush();os.fsync(stream.fileno())
    result['postflightActualProof']=verify();result['complete']=True
    result['status']='exit-zero' if child.returncode==0 else 'exit-nonzero-unclassified'
    result['allRequestedChecksPassed']=child.returncode==0
except Exception as error:
    result['status']='admission-or-execution-error';result['errors'].append({'type':type(error).__name__,'message':str(error)})
finally:
    result['endedAt']=datetime.now(timezone.utc).isoformat();create_json('results.json',result)
print(json.dumps({'phase':args.phase,'suite':args.suite,'expectedMethods':methods,'complete':result['complete'],'exitCode':result['exitCode'],'status':result['status']}))
raise SystemExit(0 if result['allRequestedChecksPassed'] else 2 if result['errors'] else 1)
