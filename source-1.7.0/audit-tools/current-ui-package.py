"""Guest-only data preparation for current-source UI QA; never launches code."""
from pathlib import Path
import argparse
import hashlib
import importlib.util
import json
import os
import re
import stat

ROOT = Path(__file__).resolve().parent.parent
GUEST = Path('C:/xjy-work/xjy-web-stage1')
RESULTS = Path('C:/xjy-results')
MATERIALS_SHA = '5c7d55953490ab8bd982fed519a905a8ea2f9961daa1c8fbba176eb5b83e68d0'
EXACT_APP = GUEST/'release-work/audit-code-xur5DA/app-input'
TOOL_PINS = {
    'stage1/sandbox-context.py': '09426dfd4d699c51570e1f1b10c2e37c00f6feb699b9a472ca710ae5242bf249',
    'stage1/validate-sandbox-context.py': '867a0117d6bc200960df06a355ffafcf639f24532ece3bc4db34f6e397325207',
    'stage1/sandbox-guest-candidate-driver.py': '60162279505ef51453f7b571f09a48d529e1879d8df4070acd955bd0156db8f6',
    'stage1/guest-owned-process-proof.py': 'b06b4d0254a226dbd849d18a576674e7da6cfad55944ee347b920c5bcc6bad07',
    'stage1/guest-candidate-cdp.cjs': '59840b638d8797fb55241616cd0b8e4098075a76834a201b0e93c1a748f1bb32',
}


def ordinary(value, boundary=ROOT, *, missing=False):
    path = Path(value)
    if not path.is_absolute() or not path.is_relative_to(boundary):
        raise RuntimeError('UI path escaped its explicit owned boundary')
    for part in (path, *path.parents):
        if part.exists():
            info = part.lstat()
            if stat.S_ISLNK(info.st_mode) or getattr(info, 'st_file_attributes', 0) & 0x400 or stat.S_ISREG(info.st_mode) and info.st_nlink != 1:
                raise RuntimeError('UI path link/reparse/hardlink rejected')
        if part == boundary:
            break
    if not missing and not path.exists():
        raise RuntimeError('Required UI material missing: '+str(path))
    return path


def stable_bytes(value, boundary=ROOT):
    file = ordinary(value, boundary)
    before = file.stat()
    if not file.is_file():
        raise RuntimeError('UI input must be a regular unique file')
    with file.open('rb') as stream:
        opened = os.fstat(stream.fileno())
        body = stream.read()
        after = os.fstat(stream.fileno())
    current = file.stat()
    keys = ('st_dev', 'st_ino', 'st_size', 'st_mtime_ns', 'st_nlink')
    if any(getattr(before, k) != getattr(opened, k) or getattr(opened, k) != getattr(after, k) or getattr(after, k) != getattr(current, k) for k in keys):
        raise RuntimeError('UI material changed while reading')
    return body


def digest(body):
    return hashlib.sha256(body).hexdigest()


def read_json(file, boundary=ROOT):
    return json.loads(stable_bytes(file, boundary).decode('utf-8-sig'))


def load_module(name, file):
    ordinary(file)
    relative = file.relative_to(ROOT).as_posix()
    if relative in TOOL_PINS and digest(stable_bytes(file)) != TOOL_PINS[relative]:
        raise RuntimeError('Reviewed pure/guard helper source changed: '+relative)
    spec = importlib.util.spec_from_file_location(name, file)
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    return module


def actual_guard():
    if os.name != 'nt' or os.path.normcase(str(ROOT)) != os.path.normcase(str(GUEST)):
        raise RuntimeError('UI tools require the fixed actual Windows Sandbox before preparation')
    return load_module('current_ui_actual_context', ROOT/'stage1/sandbox-context.py').read_context(ROOT)


def safe_relative(value):
    if not isinstance(value, str) or not value or '\\' in value or ':' in value or any(p in ('', '.', '..') or p.endswith(('.', ' ')) for p in value.split('/')):
        raise RuntimeError('UI manifest relative path rejected')
    return value


def run_root(run_id):
    if not re.fullmatch('[a-z][a-z0-9-]{0,31}', run_id or ''):
        raise RuntimeError('UI run ID must be short ASCII lowercase/digits/hyphens')
    return ordinary(ROOT/'runtime'/('current-ui-'+run_id), missing=True)


def inputs():
    proof = actual_guard()
    body = stable_bytes(ROOT/'audit-tools/current-ui-materials.json')
    if digest(body) != MATERIALS_SHA:
        raise RuntimeError('Root-reviewed UI materials seal mismatch')
    material = json.loads(body)
    for name, sha in TOOL_PINS.items():
        if digest(stable_bytes(ROOT/name)) != sha:
            raise RuntimeError('Reviewed UI dependency guard/tool seal changed: '+name)
    if material.get('version') != 1 or material.get('purpose') != 'current-source-ui-qa' or Path(material.get('exactAppInput', '')) != EXACT_APP:
        raise RuntimeError('Exact xur5DA UI contract required')
    build_file = Path(material['buildReportGuestPath'])
    build_body = stable_bytes(build_file, RESULTS)
    if digest(build_body) != material['buildReportSha256']:
        raise RuntimeError('Exact build-current3 report required')
    build = json.loads(build_body)
    if Path(build.get('app', '')) != EXACT_APP or build.get('sourceHashes') != material['sourceHashes'] or build.get('unsealed') is not True or build.get('installed') is not False:
        raise RuntimeError('Build3 identity/source report drift')
    for name, sha in material['sourceHashes'].items():
        if digest(stable_bytes(ROOT/'project'/safe_relative(name))) != sha:
            raise RuntimeError('Current Guest source differs from build3: '+name)
    if digest(stable_bytes(ROOT/'stage1/build-full-release.cjs')) != material['runtimeBuilderSha256']:
        raise RuntimeError('Runtime file declaration source changed')
    targets = set()
    for row in material['runtimeFiles']:
        name = safe_relative(row['target'])
        if name.lower() in targets:
            raise RuntimeError('Duplicate current runtime target')
        targets.add(name.lower())
        source = stable_bytes(ROOT/safe_relative(row['source']))
        if len(source) != row['size'] or digest(source) != row['sha256']:
            raise RuntimeError('Current runtime source changed: '+name)
    for row in material['generated']:
        name = 'generated/'+Path(row['file']).name
        if digest(stable_bytes(EXACT_APP/name)) != row['sha256']:
            raise RuntimeError('Fresh compiled business/print output changed: '+name)
    return proof, material, build


def scan(directory):
    result = []
    ordinary(directory)
    for file in sorted(directory.rglob('*')):
        ordinary(file)
        if file.is_dir():
            continue
        body = stable_bytes(file)
        name = safe_relative(file.relative_to(directory).as_posix())
        result.append({'path': name, 'size': len(body), 'sha256': digest(body)})
    if len({r['path'].lower() for r in result}) != len(result):
        raise RuntimeError('UI tree contains Windows case collisions')
    return result


def put(destination, body):
    ordinary(destination, missing=True)
    destination.parent.mkdir(parents=True, exist_ok=True)
    ordinary(destination.parent)
    with destination.open('xb') as stream:
        stream.write(body)
        stream.flush()
        os.fsync(stream.fileno())
    if stable_bytes(destination) != body:
        raise RuntimeError('UI copied file mismatch')


def prepare(run_id):
    proof, material, build = inputs()
    # Existing candidate verification is data-only and keeps all original seals.
    original = load_module('current_ui_original_candidate_driver', ROOT/'stage1/sandbox-guest-candidate-driver.py')
    candidate, _ = original.verify_candidate()
    engine = read_json(candidate/'engine-allowlist.json')
    resource_manifest = read_json(candidate/'release-manifest.json')
    base = run_root(run_id)
    if base.exists():
        raise RuntimeError('UI capsule must be a fresh directory')
    program = base/'program'
    ordinary(program, missing=True).mkdir(parents=True)
    origins = []

    def copy(source, target, expected, kind):
        body = stable_bytes(source)
        if len(body) != expected['size'] or digest(body) != expected['sha256']:
            raise RuntimeError('UI source pin mismatch: '+str(source))
        put(program/safe_relative(target), body)
        origins.append({'path': target, 'sourceKind': kind, 'size': len(body), 'sha256': digest(body)})

    for row in engine['files']:
        if row['path'].lower() == 'resources/app.asar':
            raise RuntimeError('Old candidate ASAR is forbidden in the UI engine list')
        copy(candidate/safe_relative(row['path']), row['path'], row, 'verified-original-engine')
    selected = [row for row in resource_manifest['files'] if any(row['path'].startswith(p) for p in material['resourcesPrefixes']) or row['path'] in material['resourceFiles']]
    if not selected or not any(row['path'].startswith('resources/print-dependencies/') for row in selected) or not any(row['path'].startswith('resources/release-modules/') for row in selected):
        raise RuntimeError('Complete reviewed print/legacy resources are missing')
    for row in selected:
        copy(candidate/safe_relative(row['path']), row['path'], row, 'verified-fixed-resource')
    for row in material['runtimeFiles']:
        copy(ROOT/row['source'], 'resources/app/'+row['target'], row, 'current-runtime-source')
    fresh = scan(EXACT_APP)
    for row in fresh:
        if not (row['path'].startswith('renderer-dist/') or re.fullmatch(r'generated/(business|print-domain|print-worker-templates|print-worker-preload)\.cjs', row['path'])):
            raise RuntimeError('Unexpected file in fresh compiler output')
        if re.search(r'\.(db|sqlite3?|key|pem)$', row['path'], re.I):
            raise RuntimeError('Data/key file forbidden in current compiler output')
        copy(EXACT_APP/row['path'], 'resources/app/'+row['path'], row, 'exact-xur5DA-build3')
    package = {'name': 'xjy-current-source-ui-qa', 'version': '1.6.0', 'private': True, 'main': 'release-entry.cjs'}
    package_body = (json.dumps(package, ensure_ascii=False, indent=2)+'\n').encode()
    put(program/'resources/app/package.json', package_body)
    origins.append({'path': 'resources/app/package.json', 'sourceKind': 'qa-entry-metadata', 'size': len(package_body), 'sha256': digest(package_body)})
    for name in ('index.html', 'browser.html', 'central.html', 'print.html'):
        ordinary(program/'resources/app/renderer-dist'/name)
    for name in ('pdfjs-dist/legacy/build/pdf.mjs', '@napi-rs/canvas/index.js', '@napi-rs/canvas-win32-x64-msvc/skia.win32-x64-msvc.node'):
        ordinary(program/'resources/print-dependencies/node_modules'/name)
    if scan(EXACT_APP) != fresh:
        raise RuntimeError('Fresh compiler output changed during packaging')
    tree = scan(program)
    if sorted((r['path'], r['size'], r['sha256']) for r in tree) != sorted((r['path'], r['size'], r['sha256']) for r in origins):
        raise RuntimeError('UI exact package tree mismatch')
    evidence = {'version': 1, 'purpose': 'current-source-ui-qa', 'runId': run_id, 'actualContext': proof, 'materialsSha256': MATERIALS_SHA, 'buildReportSha256': material['buildReportSha256'], 'exactAppInput': str(EXACT_APP), 'sourceHashes': build['sourceHashes'], 'program': str(program), 'files': tree, 'origins': origins, 'programExecuted': False, 'productionTouched': False, 'unsealedQaOnly': True}
    put(base/'package-evidence.json', (json.dumps(evidence, ensure_ascii=False, indent=2)+'\n').encode())
    return evidence


def verify(run_id):
    _, material, build = inputs()
    base = run_root(run_id)
    evidence = read_json(base/'package-evidence.json')
    if evidence.get('purpose') != 'current-source-ui-qa' or evidence.get('runId') != run_id or evidence.get('materialsSha256') != MATERIALS_SHA or evidence.get('buildReportSha256') != material['buildReportSha256'] or evidence.get('sourceHashes') != build['sourceHashes'] or Path(evidence.get('program', '')) != base/'program':
        raise RuntimeError('UI package identity mismatch')
    if scan(base/'program') != evidence.get('files'):
        raise RuntimeError('UI package changed before launch')
    return evidence


if __name__ == '__main__':
    parser = argparse.ArgumentParser(description=__doc__, allow_abbrev=False)
    parser.add_argument('--run-id', required=True)
    args = parser.parse_args()
    record = prepare(args.run_id)
    print(json.dumps({'purpose': record['purpose'], 'program': record['program'], 'files': len(record['files']), 'programExecuted': False}))
