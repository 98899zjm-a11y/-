"""Fixed offline Guest payroll regression, preserving separate RED/GREEN logs."""
import os
import sys
from pathlib import Path
ROOT = Path(__file__).resolve().parents[1]
if os.name != 'nt' or str(ROOT).lower().replace('\\', '/') != 'c:/xjy-work/xjy-web-stage1' or not sys.flags.isolated or not sys.flags.no_site or not sys.flags.dont_write_bytecode:
    raise RuntimeError('Actual fixed Guest -I -B -S required')
import argparse
import hashlib
import json
import subprocess
import types
from datetime import datetime, timezone

HELPER = 'audit-tools/run-finance-erp170-red-a1.py'
HELPER_SHA = '1f7ab3485de1260db7e0762175b7a15fcafc2d4c942f3adf7d40142a267f1e2e'
TEST = 'audit-tools/finance-erp170-payroll-month.test.py'
TEST_SHA = 'd06e6d5113de2f84b1ede9cbd06c4b29dd12ebe6c8d4e72c23ae6ac3b9796e47'
PINS = 'audit-tools/finance-erp170-payroll-month-pins.json'
PINS_SHA = '94d6d1dc99a70d96cfc849d13b63a2567bb4ffab2ae7590b51a9a5ecbb35aa46'
parser = argparse.ArgumentParser(allow_abbrev=False)
parser.add_argument('--self-sha256', required=True)
parser.add_argument('--expected-namespace', required=True)
parser.add_argument('--phase', choices=('red', 'candidate'), required=True)
args = parser.parse_args()
body = (ROOT / HELPER).read_bytes()
if hashlib.sha256(body).hexdigest() != HELPER_SHA:
    raise RuntimeError('Frozen original runner changed')
base = types.ModuleType('fixed_payroll_runner_helpers'); base.__file__ = str(ROOT / HELPER)
exec(compile(body, base.__file__, 'exec', dont_inherit=True), base.__dict__)
base.pinned(Path(__file__), args.self_sha256)
base.verify_fixed(HELPER_SHA, args.expected_namespace)
context = types.ModuleType('actual_context'); context.__file__ = str(ROOT / 'stage1/sandbox-context.py')
exec(compile(base.pinned(Path(context.__file__), base.GUARDS['stage1/sandbox-context.py']), context.__file__, 'exec'), context.__dict__)
proof = context.read_context(ROOT)
pins = json.loads(base.pinned(ROOT / PINS, PINS_SHA))['phases'][args.phase]
if set(pins) != {'project/desktop/legacy-source/ledger/finance.py', 'project/desktop/legacy-source/ledger/sidecar.py'}:
    raise RuntimeError('Exact two source files required')
def verify():
    base.verify_fixed(HELPER_SHA, args.expected_namespace)
    context.read_context(ROOT)
    base.pinned(Path(__file__), args.self_sha256)
    base.pinned(ROOT / TEST, TEST_SHA)
    base.pinned(ROOT / PINS, PINS_SHA)
    for relative, expected in pins.items(): base.pinned(ROOT / relative, expected)
verify()
out = Path('C:/xjy-results') / ('finance170-payroll-' + args.phase + '-a1')
base.ordinary(out.parent, directory=True); out.mkdir(exist_ok=False); base.ordinary(out, directory=True)
command = [str(base.PYTHON), '-I', '-B', '-S', '-X', 'utf8', TEST,
           '--test-sha256', TEST_SHA, '--pins-sha256', PINS_SHA,
           '--expected-namespace', args.expected_namespace, '--phase', args.phase]
result = {'actualProof': proof, 'namespace': args.expected_namespace, 'selfSha256': args.self_sha256,
          'sourcePins': pins, 'testSha256': TEST_SHA, 'pinsSha256': PINS_SHA, 'phase': args.phase,
          'command': command, 'startedAt': datetime.now(timezone.utc).isoformat(), 'exitCode': None,
          'complete': False, 'originalHttpVerified': False, 'fullWorkflowAcceptance': False}
try:
    with (out / 'test.stdout.bin').open('xb') as stdout, (out / 'test.stderr.bin').open('xb') as stderr:
        child = subprocess.run(command, cwd=ROOT, stdin=subprocess.DEVNULL, stdout=stdout, stderr=stderr, shell=False, creationflags=0x08000000)
    result['exitCode'] = child.returncode
    verify()
    result['complete'] = True
finally:
    result['endedAt'] = datetime.now(timezone.utc).isoformat()
    with (out / 'results.json').open('x', encoding='utf-8') as stream: json.dump(result, stream, indent=2)
print(json.dumps({'phase': args.phase, 'complete': result['complete'], 'exitCode': result['exitCode']}))
raise SystemExit(0 if result['complete'] and result['exitCode'] == 0 else 1)
