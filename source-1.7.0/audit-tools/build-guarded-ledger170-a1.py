"""Compile the frozen 1.7 ledger into a fresh offline Guest-only directory.

Reuse the original PyInstaller command and inventory function. Neither the old
guarded bundle nor any data directory is replaced or opened by this driver.
"""
import os, sys
from pathlib import Path
ROOT = Path(__file__).resolve().parents[1]
if os.name != 'nt' or str(ROOT).lower().replace('\\', '/') != 'c:/xjy-work/xjy-web-stage1' or not sys.flags.isolated or not sys.flags.no_site or not sys.flags.dont_write_bytecode:
    raise RuntimeError('Actual fixed offline Guest Python -I -B -S required')
import argparse, hashlib, json, subprocess, types
from datetime import datetime, timezone
HELPER = 'audit-tools/run-finance-erp170-red-a1.py'
HELPER_SHA = '1f7ab3485de1260db7e0762175b7a15fcafc2d4c942f3adf7d40142a267f1e2e'
PINS = 'audit-tools/ledger170-guarded-build-source-pins-a1.json'
PINS_SHA = '5873c29607ac714939391828b33f8bdae9918873579f211dfad4fc92a917c93f'
LEDGER = 'project/desktop/legacy-source/ledger/'
COMMON = 'project/desktop/legacy-source/'
p = argparse.ArgumentParser(allow_abbrev=False)
p.add_argument('--self-sha256', required=True); p.add_argument('--expected-namespace', required=True)
args = p.parse_args()
raw = (ROOT / HELPER).read_bytes()
if hashlib.sha256(raw).hexdigest() != HELPER_SHA: raise RuntimeError('Original helper changed')
base = types.ModuleType('original_build_helpers'); base.__file__ = str(ROOT / HELPER)
exec(compile(raw, base.__file__, 'exec', dont_inherit=True), base.__dict__)
base.pinned(Path(__file__), args.self_sha256); base.verify_fixed(HELPER_SHA, args.expected_namespace)
ctx = types.ModuleType('actual_build_context'); ctx.__file__ = str(ROOT / 'stage1/sandbox-context.py')
exec(compile(base.pinned(Path(ctx.__file__), base.GUARDS['stage1/sandbox-context.py']), ctx.__file__, 'exec'), ctx.__dict__)
proof = ctx.read_context(ROOT)
manifest = json.loads(base.pinned(ROOT / PINS, PINS_SHA))
if manifest['version'] != 1 or manifest['purpose'] != 'guarded-ledger170-source-build' or len(manifest['files']) != 304:
    raise RuntimeError('Exact frozen source closure required')
sources = {}
for relative, item in manifest['files'].items():
    base.relative(relative)
    if not relative.startswith(COMMON): raise RuntimeError('Only reviewed legacy program sources allowed')
    sources[relative] = base.pinned(ROOT / relative, item['sha256'], item['size'])
out = Path('C:/xjy-results/ledger170-guarded-build-a1'); base.ordinary(out.parent, directory=True); out.mkdir(exist_ok=False)
work = ROOT / 'runtime/ledger170-guarded-build-a1'; base.ordinary(work.parent, directory=True); work.mkdir(exist_ok=False)
source = work / 'source'; source.mkdir(); dist = work / 'dist'; dist.mkdir()
def put(relative, data):
    file = source / relative
    if not file.is_relative_to(source) or '..' in Path(relative).parts: raise RuntimeError('Source destination escaped')
    file.parent.mkdir(parents=True, exist_ok=True); base.ordinary(file.parent, directory=True)
    with file.open('xb') as stream: stream.write(data); stream.flush(); os.fsync(stream.fileno())
    base.pinned(file, hashlib.sha256(data).hexdigest(), len(data))
replacements = {'sidecar.py':'sidecar.py', 'desktop_runtime_context.py':'desktop_runtime_context.py',
    'collaboration.py':'collaboration.py', 'inventory_report_window.py':'inventory_report_window.py',
    'collaboration.html':'app/templates/xjy-collaboration.html', 'xjy-theme.css':'app/static/xjy-theme.css',
    'xjy-shell.js':'app/static/xjy-shell.js'}
for relative, data in sources.items():
    if relative.startswith(LEDGER):
        target = relative[len(LEDGER):]
        if target not in replacements.values(): put(target, data)
for name, target in replacements.items(): put(target, sources[COMMON + name])
builder = types.ModuleType('original_release_builder'); builder.__file__ = str(ROOT / (COMMON + 'build-release-sidecars.py'))
exec(compile(sources[COMMON + 'build-release-sidecars.py'], builder.__file__, 'exec', dont_inherit=True), builder.__dict__)
command = builder.build_command('ledger', source, work, dist)
# The entry remains the original restricted Stage sidecar, never a release gate.
command[-1:-1] = ['--paths', str(ROOT / 'stage1'), '--hidden-import', 'python_guard', '--hidden-import', 'ctypes']
env = {k:v for k,v in os.environ.items() if k.upper() not in ('PYTHONPATH','PYTHONHOME','PYTHONSTARTUP','NODE_OPTIONS','NODE_PATH','LEDGER_DATA','STOCKCHECK_DATA','XJY_STAGE1_ROOT','XJY_MODULE_TOKEN')}
temporary = work / 'temp'; temporary.mkdir()
env.update(PYTHONDONTWRITEBYTECODE='1', PYTHONNOUSERSITE='1', PYTHONUTF8='1',
           PYINSTALLER_CONFIG_DIR=str(work/'cache'), TEMP=str(temporary), TMP=str(temporary))
report = dict(admission=proof, namespace=args.expected_namespace, command=command, sourceManifestSha256=PINS_SHA,
              sourcePins=manifest['files'], startedAt=datetime.now(timezone.utc).isoformat(),
              output=str(dist), exitCode=None, complete=False, businessExecuted=False, previousBundleChanged=False)
with (out/'plan.json').open('x', encoding='utf-8') as stream: json.dump(report, stream, indent=2)
try:
    with (out/'compiler.stdout.bin').open('xb') as stdout, (out/'compiler.stderr.bin').open('xb') as stderr:
        child = subprocess.run(command, cwd=source, env=env, stdout=stdout, stderr=stderr,
                               stdin=subprocess.DEVNULL, shell=False, creationflags=0x08000000)
    report['exitCode'] = child.returncode
    if child.returncode: raise RuntimeError('Actual PyInstaller build failed; preserve compiler output')
    entry = builder.bundle_entry('ledger', dist); entry['purpose'] = 'isolated-guarded-candidate'
    with (dist/'ledger-manifest.json').open('x', encoding='utf-8') as stream: json.dump({'version':1,'modules':[entry]}, stream, indent=2)
    report['entry'] = entry
    for relative, item in manifest['files'].items(): base.pinned(ROOT/relative, item['sha256'], item['size'])
    base.verify_fixed(HELPER_SHA, args.expected_namespace); ctx.read_context(ROOT)
    report['complete'] = True
except Exception as error:
    report['error'] = {'type':type(error).__name__, 'message':str(error)}
finally:
    report['finishedAt'] = datetime.now(timezone.utc).isoformat()
    with (out/'results.json').open('x', encoding='utf-8') as stream: json.dump(report, stream, indent=2)
print(json.dumps({key:report[key] for key in ('complete','exitCode','output')}))
raise SystemExit(0 if report['complete'] else 1)
