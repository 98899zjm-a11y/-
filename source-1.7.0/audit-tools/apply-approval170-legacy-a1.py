"""Exact 24-source approval regression overlay; original guards are verify-only."""
import os, sys
from pathlib import Path
ROOT = Path(__file__).resolve().parents[1]
if (os.name != 'nt' or str(ROOT).lower().replace('\\', '/') != 'c:/xjy-work/xjy-web-stage1' or
        not sys.flags.isolated or not sys.flags.no_site or not sys.flags.dont_write_bytecode or sys.flags.optimize):
    raise RuntimeError('Actual fixed Guest Python -I -B -S required')
import argparse, hashlib, json, re, types
HELPER = 'audit-tools/run-finance-erp170-red-a1.py'
HELPER_SHA = '1f7ab3485de1260db7e0762175b7a15fcafc2d4c942f3adf7d40142a267f1e2e'
PHASES = {'red': '31405163e6c8b6488c216ad557db3633af126eaf1ef27ccaf4cced1db94f0668',
          'candidate': '5b90bea87fac7889f80dc1517b8e4ae3e3b6a6b65b01ef74d808c8f67fec8d71'}
KEYS = {
    'delivery-approval/Prepare-Repeat-Approval-170.ps1',
    'delivery-approval/approval-archive-170.cjs',
    'delivery-approval/approval-core-170.cjs',
    'delivery-approval/approval-io-170.cjs',
    'delivery-tools/initial-patch-backup.cjs',
    'delivery-tools/initial-patch-core.cjs',
    'delivery-tools/initial-patch-entry.cjs',
    'delivery-tools/initial-source-lease.cjs',
    'delivery-tools/install-location-windows.cjs',
    'delivery-tools/install-location.cjs',
    'project/desktop/employee-update-cache.cjs',
    'project/desktop/employee-update-installer.cjs',
    'stage1/guest-candidate-cdp.cjs',
    'stage1/isolation.cjs',
    'stage1/sandbox-context.py',
    'stage1/validate-sandbox-context.py',
    'tests/approval-170-contract.test.cjs',
    'tests/approval-170-legacy-state.test.cjs',
    'tests/approval-170-preparer.test.cjs',
    'tests/approval-io-170-contract.test.cjs',
    'tests/delivery-approval-archive-170.test.cjs',
    'tests/install-location-windows.test.cjs',
    'tests/install-location.test.cjs',
    'tests/repeat-approval-location-170.test.cjs',
}
def initialize(args):
    if (not re.fullmatch('[a-f0-9]{64}', args.self_sha256) or
            not re.fullmatch(r'[a-f0-9]{8}(?:-[a-f0-9]{4}){3}-[a-f0-9]{12}', args.expected_namespace)):
        raise RuntimeError('Exact self SHA and actual namespace UUID required')
    raw = (ROOT / HELPER).read_bytes()
    if hashlib.sha256(raw).hexdigest() != HELPER_SHA: raise RuntimeError('Original helper changed')
    base = types.ModuleType('fixed_approval170_helpers'); base.__file__ = str(ROOT / HELPER)
    exec(compile(raw, base.__file__, 'exec', dont_inherit=True), base.__dict__)
    base.pinned(Path(__file__), args.self_sha256); base.verify_fixed(HELPER_SHA, args.expected_namespace)
    ctx = types.ModuleType('actual_approval170_context'); ctx.__file__ = str(ROOT / 'stage1/sandbox-context.py')
    exec(compile(base.pinned(Path(ctx.__file__), base.GUARDS['stage1/sandbox-context.py']), ctx.__file__, 'exec'), ctx.__dict__)
    return base, ctx, ctx.read_context(ROOT)
def inventory(base, phase, check_root=False):
    package = Path('C:/xjy-input') / ('approval170-legacy-' + phase + '-a1')
    manifest = json.loads(base.pinned(package / 'manifest.json', PHASES[phase]))
    if (set(manifest) != {'version', 'purpose', 'files'} or manifest['version'] != 1 or
            manifest['purpose'] != 'data-free isolated audit code and public compiler' or
            not isinstance(manifest['files'], list) or len(manifest['files']) != 24):
        raise RuntimeError('Exact 24-file sealed manifest required')
    rows = {}; bodies = {}
    for row in manifest['files']:
        if (not isinstance(row, dict) or set(row) != {'path', 'size', 'sha256'} or row['path'] not in KEYS or
                row['path'] in rows or type(row['size']) is not int or not 0 < row['size'] <= 4 * 1024 * 1024 or
                not isinstance(row['sha256'], str) or not re.fullmatch('[a-f0-9]{64}', row['sha256'])):
            raise RuntimeError('Only the exact 24 reviewed source paths are admitted')
        rel = row['path']; rows[rel] = row; bodies[rel] = base.pinned(package / rel, row['sha256'], row['size'])
        if check_root or rel in base.GUARDS: base.pinned(ROOT / rel, row['sha256'], row['size'])
    if set(rows) != KEYS: raise RuntimeError('Exact source set changed')
    return rows, bodies

p = argparse.ArgumentParser(allow_abbrev=False)
p.add_argument('--self-sha256', required=True); p.add_argument('--expected-namespace', required=True)
p.add_argument('--phase', choices=tuple(PHASES), required=True); p.add_argument('--run-id', required=True)
args = p.parse_args()
if not re.fullmatch('approval170-legacy-apply-' + args.phase + r'-a1(?:-[a-z0-9][a-z0-9-]{0,31})?', args.run_id):
    raise RuntimeError('Fresh bounded phase apply ID required')
base, ctx, proof = initialize(args)
rows, bodies = inventory(base, args.phase)
preimages = {}
for rel in rows:
    dest = ROOT / rel
    if rel not in base.GUARDS and dest.exists(): preimages[rel] = base.read(dest)
output = Path('C:/xjy-results'); output_info = base.ordinary(output, directory=True)
out = output / args.run_id; out.mkdir(exist_ok=False); out_info = base.ordinary(out, directory=True)
def output_check():
    for directory, before in ((output, output_info), (out, out_info)):
        now = base.ordinary(directory, directory=True)
        if (now.st_dev, now.st_ino) != (before.st_dev, before.st_ino): raise RuntimeError('Owned output identity changed')
def create(name, raw):
    output_check()
    with (out / name).open('xb') as stream: stream.write(raw); stream.flush(); os.fsync(stream.fileno())
def parent_for(dest):
    current = ROOT
    for part in dest.parent.relative_to(ROOT).parts:
        current = current / part
        try: current.mkdir()
        except FileExistsError: pass
        base.ordinary(current, directory=True)
    return base.ordinary(dest.parent, directory=True)
result = {'phase': args.phase, 'namespace': args.expected_namespace, 'actualProof': proof,
          'selfSha256': args.self_sha256, 'manifestSha256': PHASES[args.phase],
          'files': [], 'complete': False, 'errors': [], 'originalGuardsWritten': False}
try:
    for rel, raw in preimages.items(): create('before-' + rel.replace('/', '__'), raw)
    create('plan.json', (json.dumps({'sourcePins': rows, 'beforePins': {k: hashlib.sha256(v).hexdigest() for k,v in preimages.items()}}, indent=2) + '\n').encode())
    for rel, raw in bodies.items():
        base.verify_fixed(HELPER_SHA, args.expected_namespace); ctx.read_context(ROOT)
        base.pinned(Path(__file__), args.self_sha256); output_check()
        dest = ROOT / rel
        if rel in base.GUARDS:
            base.pinned(dest, rows[rel]['sha256'], rows[rel]['size'])
            result['files'].append({'path': rel, 'action': 'verified-original-guard-no-write', 'after': rows[rel]['sha256']}); continue
        parent_info = parent_for(dest)
        if rel in preimages:
            if base.read(dest) != preimages[rel]: raise RuntimeError('Current source changed before write: ' + rel)
        elif dest.exists(): raise RuntimeError('New source path appeared before write: ' + rel)
        parent_after = base.ordinary(dest.parent, directory=True)
        if (parent_info.st_dev, parent_info.st_ino) != (parent_after.st_dev, parent_after.st_ino): raise RuntimeError('Source directory identity changed')
        with dest.open('r+b' if rel in preimages else 'xb') as stream:
            current = base.ordinary(dest); opened = os.fstat(stream.fileno())
            if (current.st_dev,current.st_ino,current.st_nlink) != (opened.st_dev,opened.st_ino,opened.st_nlink) or opened.st_nlink != 1:
                raise RuntimeError('Source handle/path identity changed')
            stream.seek(0); stream.write(raw); stream.truncate(); stream.flush(); os.fsync(stream.fileno())
            after = base.ordinary(dest)
            if (after.st_dev,after.st_ino) != (opened.st_dev,opened.st_ino): raise RuntimeError('Source path changed after write')
        base.pinned(dest, rows[rel]['sha256'], rows[rel]['size'])
        result['files'].append({'path': rel, 'action': 'sealed-source-applied', 'before': hashlib.sha256(preimages[rel]).hexdigest() if rel in preimages else None, 'after': rows[rel]['sha256']})
    base.verify_fixed(HELPER_SHA, args.expected_namespace); result['postflightActualProof'] = ctx.read_context(ROOT)
    base.pinned(Path(__file__), args.self_sha256); after, _ = inventory(base, args.phase, check_root=True)
    if after != rows: raise RuntimeError('Fixed inventory changed')
    result['complete'] = True
except Exception as error:
    result['errors'].append({'type': type(error).__name__, 'message': str(error)})
finally:
    create('results.json', (json.dumps(result, ensure_ascii=False, indent=2) + '\n').encode('utf-8'))
print(json.dumps({'phase': args.phase, 'complete': result['complete'], 'results': str(out/'results.json')}))
raise SystemExit(0 if result['complete'] else 1)
