"""Next UI QA data/observation primitives. No product is imported or launched.

Root-reviewed contract + materials + independent package evidence seals are
required. Model evidence is never accepted as runtime input.
"""
from pathlib import Path
import base64
import hashlib
import json
import os
import re
import stat
import subprocess
import types

ROOT = Path(__file__).resolve().parent.parent
GUEST = Path('C:/xjy-work/xjy-web-stage1')
RESULTS = Path('C:/xjy-results')
BASE = ROOT/'runtime/next-ui-ui-a2'
PROGRAM = BASE/'program'
OUTPUT = RESULTS/'next-ui-ui-a2'
PROFILE = ROOT/'config/desktop-profile'
OWNER = PROFILE/'current-ui-owner.json'
JOURNAL_ROOT = ROOT/'runtime/next-ui-owner-handoff-ui-a1-ui-a2'
PINS = {
 'stage1/sandbox-context.py': '09426dfd4d699c51570e1f1b10c2e37c00f6feb699b9a472ca710ae5242bf249',
 'stage1/validate-sandbox-context.py': '867a0117d6bc200960df06a355ffafcf639f24532ece3bc4db34f6e397325207',
 'stage1/sandbox-guest-candidate-driver.py': '60162279505ef51453f7b571f09a48d529e1879d8df4070acd955bd0156db8f6',
 'stage1/guest-owned-process-proof.py': 'b06b4d0254a226dbd849d18a576674e7da6cfad55944ee347b920c5bcc6bad07',
 'stage1/guest-candidate-cdp.cjs': '59840b638d8797fb55241616cd0b8e4098075a76834a201b0e93c1a748f1bb32',
}


def ordinary(value, boundary=ROOT, *, missing=False):
    file = Path(value)
    if not file.is_absolute() or not file.is_relative_to(boundary):
        raise RuntimeError('Next UI path escaped its fixed boundary')
    inspected = []
    for part in (file, *file.parents):
        try:
            s = part.lstat()
        except FileNotFoundError:
            if missing:
                continue
            raise
        if stat.S_ISLNK(s.st_mode) or getattr(s, 'st_file_attributes', 0) & 0x400 or stat.S_ISREG(s.st_mode) and s.st_nlink != 1:
            raise RuntimeError('Next UI link/reparse/hardlink refused')
        inspected.append(s)
    anchor = boundary
    while not anchor.exists():
        if anchor == anchor.parent:
            raise RuntimeError('Physical QA boundary unavailable')
        anchor = anchor.parent
    anchor_stat = anchor.stat()
    if not anchor.is_dir() or not any((s.st_dev, s.st_ino) == (anchor_stat.st_dev, anchor_stat.st_ino) for s in inspected):
        raise RuntimeError('Physical ancestry does not contain the QA boundary object')
    return file


def identity(s):
    return s.st_dev, s.st_ino, s.st_size, s.st_mtime_ns, s.st_ctime_ns, s.st_nlink


def same_open(a, b):
    keys = ('st_dev', 'st_ino', 'st_size', 'st_mtime_ns', 'st_nlink')
    births = getattr(a, 'st_birthtime_ns', None), getattr(b, 'st_birthtime_ns', None)
    return all(getattr(a, k) == getattr(b, k) for k in keys) and (None in births or births[0] == births[1])


def stable_bytes(value, boundary=ROOT, limit=8*1024*1024):
    file = ordinary(value, boundary)
    before = file.stat()
    if not file.is_file() or before.st_size > limit:
        raise RuntimeError('Bounded ordinary public QA metadata required')
    with file.open('rb') as stream:
        opened = os.fstat(stream.fileno())
        if not same_open(before, opened):
            raise RuntimeError('QA metadata changed before open')
        data = stream.read(limit+1)
        if len(data) != before.st_size or identity(os.fstat(stream.fileno())) != identity(opened):
            raise RuntimeError('QA metadata changed during read')
    if identity(ordinary(file, boundary).stat()) != identity(before):
        raise RuntimeError('QA metadata path changed during read')
    return data


def digest(data):
    return hashlib.sha256(data).hexdigest()


def hash_file(value, boundary=ROOT, target=None):
    file = ordinary(value, boundary)
    before = file.stat()
    if not file.is_file():
        raise RuntimeError('Ordinary public program file required')
    h, size = hashlib.sha256(), 0
    with file.open('rb') as stream:
        opened = os.fstat(stream.fileno())
        if not same_open(before, opened):
            raise RuntimeError('Program changed before open')
        out = None
        try:
            if target is not None:
                ordinary(target, PROGRAM, missing=True)
                target.parent.mkdir(parents=True, exist_ok=True)
                ordinary(target.parent, PROGRAM)
                out = target.open('xb')
            while block := stream.read(1024*1024):
                if size == 0 and block.startswith(b'SQLite format 3\0'):
                    raise RuntimeError('A database cannot be included as program input')
                h.update(block)
                size += len(block)
                if out:
                    out.write(block)
            if out:
                out.flush()
                os.fsync(out.fileno())
        finally:
            if out:
                out.close()
        if identity(os.fstat(stream.fileno())) != identity(opened) or identity(ordinary(file, boundary).stat()) != identity(before):
            raise RuntimeError('Program changed during read')
    record = {'size': size, 'sha256': h.hexdigest()}
    if target is not None and hash_file(target) != record:
        raise RuntimeError('Copied program byte verification failed')
    return record


def read_json(file, boundary=ROOT):
    return json.loads(stable_bytes(file, boundary).decode('utf-8-sig'))


def sealed(file, seal, boundary=ROOT):
    if not isinstance(seal, str) or not re.fullmatch('[0-9a-f]{64}', seal):
        raise RuntimeError('Explicit Root-reviewed public metadata SHA required')
    body = stable_bytes(file, boundary)
    if digest(body) != seal:
        raise RuntimeError('Root-reviewed metadata changed: '+str(file))
    return json.loads(body)


def load_module(name, file, seal=None):
    body = stable_bytes(file)
    expected = seal or PINS.get(Path(file).relative_to(ROOT).as_posix())
    if not expected or digest(body) != expected:
        raise RuntimeError('Exact reviewed helper bytes required')
    # Compile the checked .py bytes directly; never consult an unverified pyc.
    module = types.ModuleType(name)
    module.__file__ = str(file)
    exec(compile(body, str(file), 'exec'), module.__dict__)
    return module


def actual_guard():
    if os.name != 'nt' or os.path.normcase(str(ROOT)) != os.path.normcase(str(GUEST)):
        raise RuntimeError('Fixed actual Guest required before any operation')
    return load_module('next_ui_actual_context', ROOT/'stage1/sandbox-context.py').read_context(ROOT)


def original():
    actual_guard()
    return load_module('next_ui_original_lifecycle', ROOT/'stage1/sandbox-guest-candidate-driver.py')


def safe_relative(name):
    if not isinstance(name, str) or not name or re.search(r'[\\:\x00-\x1f]', name):
        raise RuntimeError('Canonical program-relative path required')
    for part in name.split('/'):
        if part in ('', '.', '..') or part.rstrip(' .') != part or re.fullmatch(r'(CON|PRN|AUX|NUL|COM[1-9]|LPT[1-9])(?:\..*)?', part, re.I):
            raise RuntimeError('Program-relative alias refused')
    return name


def scan(directory):
    rows = []
    ordinary(directory)
    for folder, dirs, files in os.walk(directory, followlinks=False):
        for name in dirs+files:
            ordinary(Path(folder)/name)
        for name in files:
            file = Path(folder)/name
            rows.append({'path': safe_relative(file.relative_to(directory).as_posix()), **hash_file(file)})
    if len({r['path'].casefold() for r in rows}) != len(rows):
        raise RuntimeError('Program tree case collision refused')
    return sorted(rows, key=lambda r: r['path'])


def tree_digest(rows):
    canonical = sorted([{'path': r['path'], 'size': r['size'], 'sha256': r['sha256']} for r in rows], key=lambda r: r['path'])
    return digest(json.dumps(canonical, ensure_ascii=True, sort_keys=True, separators=(',', ':')).encode())


def put(file, data, boundary=ROOT):
    ordinary(file, boundary, missing=True)
    file.parent.mkdir(parents=True, exist_ok=True)
    ordinary(file.parent, boundary)
    with file.open('xb') as stream:
        stream.write(data)
        stream.flush()
        os.fsync(stream.fileno())
    if hash_file(file, boundary) != {'size': len(data), 'sha256': digest(data)}:
        raise RuntimeError('Fresh QA output verification failed')


def system_json(command):
    actual_guard()
    source = "$ErrorActionPreference='Stop'; [Console]::OutputEncoding=[Text.UTF8Encoding]::new($false); "+command
    encoded = base64.b64encode(source.encode('utf-16le')).decode('ascii')
    result = subprocess.run(['C:/Windows/System32/WindowsPowerShell/v1.0/powershell.exe', '-NoLogo', '-NoProfile', '-NonInteractive', '-EncodedCommand', encoded],
                            cwd=ROOT, capture_output=True, encoding='utf-8', timeout=25, creationflags=0x08000000)
    if result.returncode:
        raise RuntimeError('Read-only Guest system observation failed')
    return json.loads(result.stdout) if result.stdout.strip() else []


def listeners():
    rows = system_json("$tcp=@(Get-NetTCPConnection -ErrorAction Stop | Where-Object State -eq Listen | Select-Object @{n='Protocol';e={'TCP'}},LocalAddress,LocalPort,OwningProcess);$udp=@(Get-NetUDPEndpoint -ErrorAction Stop | Select-Object @{n='Protocol';e={'UDP'}},LocalAddress,LocalPort,OwningProcess);@($tcp+$udp)|ConvertTo-Json -Compress")
    return rows if isinstance(rows, list) else [rows]


def load_inputs(contract_sha, materials_sha):
    actual = actual_guard()
    c = sealed(ROOT/'audit-tools/next-ui-contract.json', contract_sha)
    m = sealed(ROOT/'audit-tools/next-ui-materials.json', materials_sha)
    pins = m.get('harnessPins')
    required = {'audit-tools/next-ui-owner-policy.py', 'audit-tools/next-ui-common.py', 'audit-tools/next-ui-package.py',
                'audit-tools/next-ui-driver.py', 'audit-tools/next-ui-probe.cjs', 'audit-tools/next-ui-owner-handoff.py'}
    if not isinstance(pins, dict) or set(pins) != required:
        raise RuntimeError('Root must seal all new harness source bytes')
    for name, sha in {**PINS, **pins}.items():
        if hash_file(ROOT/name)['sha256'] != sha:
            raise RuntimeError('Reviewed next UI helper/harness source changed')
    policy = load_module('next_ui_verified_policy', ROOT/'audit-tools/next-ui-owner-policy.py', pins['audit-tools/next-ui-owner-policy.py'])
    c = policy.validate_contract(c)
    if read_json(ROOT/'isolation-identity.json').get('namespace') != c['namespace']:
        raise RuntimeError('Actual synthetic namespace differs from the reviewed ui-a2 contract')
    if m.get('version') != 1 or m.get('purpose') != 'next-source-ui-materials' or m.get('state') != 'ROOT_REVIEWED_BUILD4_MATERIALS' or m.get('buildReportSha256') != c['build']['reportSha256']:
        raise RuntimeError('Unsealed or wrong build4 materials')
    build = sealed(Path(c['build']['reportPath']), c['build']['reportSha256'], RESULTS)
    if Path(build.get('app', '')) != Path(c['build']['appInput']) or build.get('sourceHashes') != m.get('sourceHashes') or not m.get('sourceHashes') or build.get('unsealed') is not True or build.get('installed') is not False:
        raise RuntimeError('Actual build4 identity/source map mismatch')
    for name, sha in m['sourceHashes'].items():
        if hash_file(ROOT/'project'/safe_relative(name))['sha256'] != sha:
            raise RuntimeError('Current source differs from actual build4')
    build_pins = m.get('buildToolPins')
    if not isinstance(build_pins, dict) or set(build_pins) != {'stage1/build-full-release.cjs', 'stage1/build-web-runtime.cjs'}:
        raise RuntimeError('Exact build tool source pins required')
    for name, sha in build_pins.items():
        if hash_file(ROOT/name)['sha256'] != sha:
            raise RuntimeError('Reviewed build tool source changed')
    gateway = sealed(ROOT/'reports/web-runtime-build.json', c['build']['webRuntimeBuildReportSha256'])
    if hash_file(ROOT/'stage1/web-gateway.cjs')['sha256'] != c['build']['gatewaySourceSha256'] or gateway.get('sourceSha256') != c['build']['gatewaySourceSha256'] or gateway.get('sha256') != c['build']['gatewayOutputSha256'] or hash_file(ROOT/'project/desktop/web-runtime/web-gateway.cjs')['sha256'] != c['build']['gatewayOutputSha256']:
        raise RuntimeError('Actual recompiled gateway provenance mismatch')
    rows = m.get('programFiles')
    if not isinstance(rows, list) or not rows or tree_digest(rows) != c['build']['newProgramTreeSha256']:
        raise RuntimeError('Root-reviewed full program tree is missing')
    return actual, c, m, build, policy


def verify_old_program():
    evidence = sealed(ROOT/'runtime/current-ui-ui-a1/package-evidence.json',
                      'abec0248806c1881ff2057786b594f2528509b8d01b21fa7a1185fe792cb3248')
    old = ROOT/'runtime/current-ui-ui-a1/program'
    expected = evidence.get('files', [])
    actual = scan(old)
    if evidence.get('purpose') != 'current-source-ui-qa' or evidence.get('runId') != 'ui-a1' or Path(evidence.get('program', '')) != old or evidence.get('buildReportSha256') != 'db1df96cd391d3994b020cd41ed57df54a294d814130a41939820a232071bf6d' or len({r['path'].casefold() for r in expected}) != len(expected) or {r['path']: r for r in actual} != {r['path']: r for r in expected}:
        raise RuntimeError('Complete original ui-a1 program proof changed')
    return evidence
