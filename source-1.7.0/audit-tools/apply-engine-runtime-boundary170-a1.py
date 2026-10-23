"""Fixed two-file engine regression overlay, actual offline Guest only."""
import os, sys
from pathlib import Path
ROOT = Path(__file__).resolve().parents[1]
if (os.name != 'nt' or str(ROOT).lower().replace('\\', '/') != 'c:/xjy-work/xjy-web-stage1' or
        not sys.flags.isolated or not sys.flags.no_site or not sys.flags.dont_write_bytecode or sys.flags.optimize):
    raise RuntimeError('Actual fixed Guest Python -I -B -S required')
import argparse, hashlib, json, re, types

HELPER = 'audit-tools/run-finance-erp170-red-a1.py'
HELPER_SHA = '1f7ab3485de1260db7e0762175b7a15fcafc2d4c942f3adf7d40142a267f1e2e'
ENGINE = 'delivery-tools/engine-tree-candidate.cjs'
CORE = 'delivery-tools/initial-patch-core.cjs'
CORE_SHA = '0f9de31c8ad8ec7e1b870a92d025909f4606363801a31ee3582b903c5704bbce'
PHASES = {
    'red': ('0a5e3eb32ce189417771ba629acd6cf0ac3c47352613c515b78b17e6cec0a453', 'efbf1b0f4d9bfe34b8627ffbb10bd1251dc407eedd05c188c18ae5f7efaec0ef'),
    'candidate': ('7b18652efd7ed2ab910508bc5633e953d36d548871f5583db4dc7e1c180aa683', '19db998cd63b7d5ce8eb1acd360d320ea123882f22a3ab0badfa6a56406edbb5'),
}
p = argparse.ArgumentParser(allow_abbrev=False)
p.add_argument('--self-sha256', required=True)
p.add_argument('--expected-namespace', required=True)
p.add_argument('--phase', choices=tuple(PHASES), required=True)
p.add_argument('--run-id', required=True)
args = p.parse_args()
if (not re.fullmatch('[a-f0-9]{64}', args.self_sha256) or
        not re.fullmatch(r'[a-f0-9]{8}(?:-[a-f0-9]{4}){3}-[a-f0-9]{12}', args.expected_namespace) or
        not re.fullmatch('engine-runtime170-apply-' + args.phase + r'-a1(?:-[a-z0-9][a-z0-9-]{0,31})?', args.run_id)):
    raise RuntimeError('Exact self pin, actual namespace and fresh phase run ID required')
body = (ROOT / HELPER).read_bytes()
if hashlib.sha256(body).hexdigest() != HELPER_SHA: raise RuntimeError('Original helper changed')
base = types.ModuleType('fixed_engine_apply_helpers'); base.__file__ = str(ROOT / HELPER)
exec(compile(body, base.__file__, 'exec', dont_inherit=True), base.__dict__)
base.pinned(Path(__file__), args.self_sha256); base.verify_fixed(HELPER_SHA, args.expected_namespace)
ctx = types.ModuleType('actual_engine_apply_context'); ctx.__file__ = str(ROOT / 'stage1/sandbox-context.py')
exec(compile(base.pinned(Path(ctx.__file__), base.GUARDS['stage1/sandbox-context.py']), ctx.__file__, 'exec'), ctx.__dict__)
proof = ctx.read_context(ROOT)
batch = 'engine-runtime-boundary170-' + args.phase + '-a1'
package = Path('C:/xjy-input') / batch
manifest_sha, engine_sha = PHASES[args.phase]
manifest = json.loads(base.pinned(package / 'manifest.json', manifest_sha))
if (set(manifest) != {'version', 'purpose', 'files'} or manifest['version'] != 1 or
        manifest['purpose'] != 'data-free isolated audit code and public compiler' or
        not isinstance(manifest['files'], list) or len(manifest['files']) != 2):
    raise RuntimeError('Exact two-file sealed overlay required')
expected = {ENGINE: engine_sha, CORE: CORE_SHA}; verified = {}; preimages = {}
for row in manifest['files']:
    if (not isinstance(row, dict) or set(row) != {'path', 'size', 'sha256'} or row['path'] not in expected or
            row['path'] in verified or row['sha256'] != expected[row['path']] or
            type(row['size']) is not int or not 0 < row['size'] <= 4 * 1024 * 1024):
        raise RuntimeError('Only the two exact reviewed delivery source pins are allowed')
    rel = row['path']; verified[rel] = base.pinned(package / rel, row['sha256'], row['size'])
    dest = ROOT / rel
    if dest.exists():
        raw = base.read(dest)
        allowed = {CORE_SHA} if rel == CORE else {item[1] for item in PHASES.values()}
        if hashlib.sha256(raw).hexdigest() not in allowed: raise RuntimeError('Unknown current source refused: ' + rel)
        preimages[rel] = raw
if set(verified) != set(expected): raise RuntimeError('Exact source set changed')
base.verify_fixed(HELPER_SHA, args.expected_namespace); ctx.read_context(ROOT); base.pinned(Path(__file__), args.self_sha256)
output = Path('C:/xjy-results'); output_info = base.ordinary(output, directory=True)
out = output / args.run_id; out.mkdir(exist_ok=False); out_info = base.ordinary(out, directory=True)
def output_check():
    for directory, before in ((output, output_info), (out, out_info)):
        now = base.ordinary(directory, directory=True)
        if (now.st_dev, now.st_ino) != (before.st_dev, before.st_ino): raise RuntimeError('Owned output identity changed')
def create(name, raw):
    output_check()
    with (out / name).open('xb') as stream: stream.write(raw); stream.flush(); os.fsync(stream.fileno())
result = {'namespace': args.expected_namespace, 'actualProof': proof, 'phase': args.phase,
          'manifestSha256': manifest_sha, 'selfSha256': args.self_sha256, 'files': [], 'complete': False, 'errors': []}
try:
    for rel, raw in preimages.items(): create('before-' + Path(rel).name, raw)
    create('plan.json', (json.dumps({'sourcePins': expected, 'preimages': {k: hashlib.sha256(v).hexdigest() for k, v in preimages.items()}}, indent=2) + '\n').encode())
    parent = ROOT / 'delivery-tools'
    parent.mkdir(exist_ok=True); parent_info = base.ordinary(parent, directory=True)
    for rel, raw in verified.items():
        base.verify_fixed(HELPER_SHA, args.expected_namespace); ctx.read_context(ROOT); output_check()
        now = base.ordinary(parent, directory=True)
        if (now.st_dev, now.st_ino) != (parent_info.st_dev, parent_info.st_ino): raise RuntimeError('Source directory identity changed')
        dest = ROOT / rel
        if rel in preimages:
            if base.read(dest) != preimages[rel]: raise RuntimeError('Current source changed before write')
        elif dest.exists(): raise RuntimeError('New source path appeared before write')
        with dest.open('r+b' if rel in preimages else 'xb') as stream:
            current = base.ordinary(dest); opened = os.fstat(stream.fileno())
            if (current.st_dev, current.st_ino, current.st_nlink) != (opened.st_dev, opened.st_ino, opened.st_nlink) or opened.st_nlink != 1:
                raise RuntimeError('Source handle/path identity changed before write')
            stream.seek(0); stream.write(raw); stream.truncate(); stream.flush(); os.fsync(stream.fileno())
            after = base.ordinary(dest)
            if (after.st_dev, after.st_ino) != (opened.st_dev, opened.st_ino): raise RuntimeError('Source path changed after write')
        base.pinned(dest, expected[rel], len(raw))
        result['files'].append({'path': rel, 'before': hashlib.sha256(preimages[rel]).hexdigest() if rel in preimages else None, 'after': expected[rel]})
    base.verify_fixed(HELPER_SHA, args.expected_namespace); result['postflightActualProof'] = ctx.read_context(ROOT)
    base.pinned(Path(__file__), args.self_sha256)
    for rel, pin in expected.items(): base.pinned(ROOT / rel, pin)
    result['complete'] = True
except Exception as error:
    result['errors'].append({'type': type(error).__name__, 'message': str(error)})
finally:
    create('results.json', (json.dumps(result, ensure_ascii=False, indent=2) + '\n').encode('utf-8'))
print(json.dumps({'phase': args.phase, 'complete': result['complete'], 'results': str(out / 'results.json')}))
raise SystemExit(0 if result['complete'] else 1)
