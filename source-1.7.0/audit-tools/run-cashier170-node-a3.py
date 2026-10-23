"""Run the frozen 48 cashier transport contracts through original Guest guards."""
import os, sys
from pathlib import Path
ROOT = Path(__file__).resolve().parents[1]
if os.name != 'nt' or str(ROOT).lower().replace('\\', '/') != 'c:/xjy-work/xjy-web-stage1' or not sys.flags.isolated or not sys.flags.no_site or not sys.flags.dont_write_bytecode:
    raise RuntimeError('Fixed actual Guest Python -I -B -S required')
import argparse, hashlib, json, subprocess, types
from datetime import datetime, timezone
HELPER = 'audit-tools/run-finance-erp170-red-a1.py'
HELPER_SHA = '1f7ab3485de1260db7e0762175b7a15fcafc2d4c942f3adf7d40142a267f1e2e'
PINS = 'audit-tools/cashier170-adapter-transport-a2-pins.json'
PINS_SHA = '7ac109f9c4cd4cc6f35ab853f5f77269f2e7e179cd5e841d37a924e2750397bf'
TESTS = ['audit-tools/cashier-170-policy.test.cjs', 'audit-tools/cashier-170-signature.test.cjs',
         'audit-tools/cashier170-backend-adapter-a1.test.cjs', 'audit-tools/cashier170-transport-policy-a2.test.cjs']
p = argparse.ArgumentParser(allow_abbrev=False)
p.add_argument('--self-sha256', required=True)
p.add_argument('--expected-namespace', required=True)
args = p.parse_args()
body = (ROOT / HELPER).read_bytes()
if hashlib.sha256(body).hexdigest() != HELPER_SHA: raise RuntimeError('Original helper changed')
base = types.ModuleType('original_guest_helper'); base.__file__ = str(ROOT / HELPER)
exec(compile(body, base.__file__, 'exec', dont_inherit=True), base.__dict__)
base.pinned(Path(__file__), args.self_sha256); base.verify_fixed(HELPER_SHA, args.expected_namespace)
ctx = types.ModuleType('actual_context'); ctx.__file__ = str(ROOT / 'stage1/sandbox-context.py')
exec(compile(base.pinned(Path(ctx.__file__), base.GUARDS['stage1/sandbox-context.py']), ctx.__file__, 'exec'), ctx.__dict__)
proof = ctx.read_context(ROOT)
pins = json.loads(base.pinned(ROOT / PINS, PINS_SHA))['literalRequireAndMigrationClosure']
if len(pins) != 50 or not set(TESTS).issubset(pins): raise RuntimeError('Exact 50-source closure required')
def verify():
    base.verify_fixed(HELPER_SHA, args.expected_namespace); ctx.read_context(ROOT)
    base.pinned(Path(__file__), args.self_sha256); base.pinned(ROOT / PINS, PINS_SHA)
    for relative, sha in pins.items(): base.pinned(ROOT / (relative if relative in ('stage1/isolation.cjs', 'stage1/validate-sandbox-context.py') else base.relative(relative)), sha)
verify()
out = Path('C:/xjy-results/cashier170-node-candidate-a3'); base.ordinary(out.parent, directory=True); out.mkdir(exist_ok=False)
env = os.environ.copy()
for key in ('NODE_OPTIONS', 'NODE_PATH', 'NODE_V8_COVERAGE'): env.pop(key, None)
command = [str(base.NODE), '--test', '--test-concurrency=1', '--test-reporter=tap', *TESTS]
report = dict(admission=proof, namespace=args.expected_namespace, sourcePins=pins, runnerSha256=args.self_sha256,
              pinsSha256=PINS_SHA, command=command, expectedMethods=48, complete=False, exitCode=None,
              startedAt=datetime.now(timezone.utc).isoformat(), httpVerified=False, nativeAppVerified=False)
try:
    with (out / 'test.stdout.bin').open('xb') as stdout, (out / 'test.stderr.bin').open('xb') as stderr:
        child = subprocess.run(command, cwd=ROOT, env=env, stdin=subprocess.DEVNULL, stdout=stdout, stderr=stderr,
                               shell=False, creationflags=0x08000000)
    report['exitCode'] = child.returncode; verify(); report['complete'] = True
finally:
    report['finishedAt'] = datetime.now(timezone.utc).isoformat()
    with (out / 'results.json').open('x', encoding='utf-8') as stream: json.dump(report, stream, indent=2)
print(json.dumps({'complete': report['complete'], 'exitCode': report['exitCode']}))
raise SystemExit(0 if report['complete'] and report['exitCode'] == 0 else 1)
