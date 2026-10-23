"""Thin eight-method regression runner using unchanged finance Guest guards."""
import os, sys
from pathlib import Path
ROOT = Path(__file__).resolve().parents[1]
if (os.name != 'nt' or str(ROOT).lower().replace('\\', '/') != 'c:/xjy-work/xjy-web-stage1' or
        not sys.flags.isolated or not sys.flags.no_site or not sys.flags.dont_write_bytecode or sys.flags.optimize):
    raise RuntimeError('Actual fixed Guest Python -I -B -S required')
import argparse, hashlib, json, re, subprocess, types
from datetime import datetime, timezone
HELPER = 'audit-tools/run-finance-erp170-red-a1.py'
HELPER_SHA = '1f7ab3485de1260db7e0762175b7a15fcafc2d4c942f3adf7d40142a267f1e2e'
TEST = 'audit-tools/engine-tree-runtime-boundary-170.test.cjs'
TEST_SHA = 'aa405286bd35f3ff88cb7ada1a2e3cb719b153033046bb366f17a27787ba8a8b'
ORIGINAL = 'audit-tools/engine-tree-candidate.test.cjs'
ORIGINAL_SHA = 'f8f3654ae3f83c6b420b01b7a57a64c9f3cca2dab282053e84612c313e0506c8'
PHASES = {
    'red': ('audit-tools/engine-tree-runtime-boundary-170-red-pins.json', '9c01e7aa8c708a5f7c36d5ff102db6f11c85edfe72a12dfa4ea6d18c0712c7cf', 'efbf1b0f4d9bfe34b8627ffbb10bd1251dc407eedd05c188c18ae5f7efaec0ef'),
    'candidate': ('audit-tools/engine-tree-runtime-boundary-170-pins.json', 'ef15b3a0bd7a6fe6ca8f77e89d288a7f22d4dfe3e19a0144baf1111053396487', '19db998cd63b7d5ce8eb1acd360d320ea123882f22a3ab0badfa6a56406edbb5'),
}
KEYS = {'stage1/isolation.cjs', 'stage1/sandbox-context.py', 'stage1/validate-sandbox-context.py',
        'project/desktop/employee-update-cache.cjs', 'project/desktop/employee-update-installer.cjs',
        'delivery-tools/initial-patch-core.cjs', 'delivery-tools/engine-tree-candidate.cjs', 'tests/employee-update-fixtures.cjs'}
p = argparse.ArgumentParser(allow_abbrev=False)
p.add_argument('--self-sha256', required=True); p.add_argument('--expected-namespace', required=True)
p.add_argument('--phase', choices=tuple(PHASES), required=True); p.add_argument('--run-id', required=True)
args = p.parse_args()
if (not re.fullmatch('[a-f0-9]{64}', args.self_sha256) or
        not re.fullmatch(r'[a-f0-9]{8}(?:-[a-f0-9]{4}){3}-[a-f0-9]{12}', args.expected_namespace) or
        not re.fullmatch('engine-runtime170-' + args.phase + r'-a1(?:-[a-z0-9][a-z0-9-]{0,31})?', args.run_id)):
    raise RuntimeError('Exact self pin, actual namespace and fresh phase run ID required')
raw = (ROOT / HELPER).read_bytes()
if hashlib.sha256(raw).hexdigest() != HELPER_SHA: raise RuntimeError('Original helper changed')
base = types.ModuleType('fixed_engine_runner_helpers'); base.__file__ = str(ROOT / HELPER)
exec(compile(raw, base.__file__, 'exec', dont_inherit=True), base.__dict__)
base.pinned(Path(__file__), args.self_sha256); base.verify_fixed(HELPER_SHA, args.expected_namespace)
ctx = types.ModuleType('actual_engine_runner_context'); ctx.__file__ = str(ROOT / 'stage1/sandbox-context.py')
exec(compile(base.pinned(Path(ctx.__file__), base.GUARDS['stage1/sandbox-context.py']), ctx.__file__, 'exec'), ctx.__dict__)
pins_file, pins_sha, engine_sha = PHASES[args.phase]
pins = json.loads(base.pinned(ROOT / pins_file, pins_sha))
if set(pins) != KEYS or pins['delivery-tools/engine-tree-candidate.cjs'] != engine_sha:
    raise RuntimeError('Exact eight-source reviewed closure required')
def verify():
    base.verify_fixed(HELPER_SHA, args.expected_namespace); proof = ctx.read_context(ROOT)
    base.pinned(Path(__file__), args.self_sha256); base.pinned(ROOT / TEST, TEST_SHA)
    base.pinned(ROOT / ORIGINAL, ORIGINAL_SHA); base.pinned(ROOT / pins_file, pins_sha)
    for rel, pin in pins.items(): base.pinned(ROOT / rel, pin)
    return proof
proof = verify()
output = Path('C:/xjy-results'); output_info = base.ordinary(output, directory=True)
out = output / args.run_id; out.mkdir(exist_ok=False); out_info = base.ordinary(out, directory=True)
def output_check():
    for directory, before in ((output, output_info), (out, out_info)):
        now = base.ordinary(directory, directory=True)
        if (now.st_dev, now.st_ino) != (before.st_dev, before.st_ino): raise RuntimeError('Owned output identity changed')
def create_json(name, value):
    output_check()
    with (out / name).open('xb') as stream:
        stream.write((json.dumps(value, ensure_ascii=False, indent=2) + '\n').encode('utf-8')); stream.flush(); os.fsync(stream.fileno())
env = os.environ.copy()
for name in ('NODE_OPTIONS', 'NODE_PATH', 'NODE_V8_COVERAGE', 'ESBUILD_BINARY_PATH'): env.pop(name, None)
env.update(XJY_ENGINE_RUNTIME_TEST_SHA256=TEST_SHA, XJY_ENGINE_RUNTIME_SOURCE_PINS=json.dumps(pins), XJY_ENGINE_RUNTIME_NAMESPACE=args.expected_namespace)
command = [str(base.NODE), '--test', '--test-reporter=tap', TEST]
result = {'namespace': args.expected_namespace, 'actualProof': proof, 'phase': args.phase, 'selfSha256': args.self_sha256,
          'sourcePins': pins, 'testSha256': TEST_SHA, 'originalSixSha256': ORIGINAL_SHA, 'pinsSha256': pins_sha,
          'expectedMethods': 8, 'command': command, 'startedAt': datetime.now(timezone.utc).isoformat(), 'exitCode': None,
          'complete': False, 'allRequestedChecksPassed': False, 'status': 'not-started', 'errors': [],
          'timeoutPolicy': 'No timeout or termination; Root inspects any stalled child.',
          'executableLaunched': False, 'sqliteOpened': False, 'realWindowsHelperVerified': False, 'fullWorkflowAcceptance': False}
create_json('plan.json', result)
try:
    output_check(); verify()
    with (out / 'test.stdout.bin').open('xb') as stdout, (out / 'test.stderr.bin').open('xb') as stderr:
        result['status'] = 'running'
        child = subprocess.run(command, cwd=ROOT, env=env, stdin=subprocess.DEVNULL, stdout=stdout, stderr=stderr,
                               shell=False, close_fds=True, creationflags=0x08000000)
        result['exitCode'] = child.returncode
        for stream in (stdout, stderr): stream.flush(); os.fsync(stream.fileno())
    result['postflightActualProof'] = verify(); result['complete'] = True
    result['status'] = 'exit-zero' if child.returncode == 0 else 'exit-nonzero-unclassified'
    result['allRequestedChecksPassed'] = child.returncode == 0
except Exception as error:
    result['status'] = 'admission-or-execution-error'; result['errors'].append({'type': type(error).__name__, 'message': str(error)})
finally:
    result['endedAt'] = datetime.now(timezone.utc).isoformat(); create_json('results.json', result)
print(json.dumps({'phase': args.phase, 'complete': result['complete'], 'exitCode': result['exitCode'], 'status': result['status']}))
raise SystemExit(0 if result['allRequestedChecksPassed'] else 2 if result['errors'] else 1)
