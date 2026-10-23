"""Root-only Guest placement of six exact public native162 input files.

No program, business module, SQLite, installer, schema or marker is executed or
created. A failed placement remains in place and must not be retried over it.
"""
from pathlib import Path
import argparse
import hashlib
import importlib.util
import json
import os
import re
import stat
import sys
import types


ROOT = Path('C:/xjy-work/xjy-web-stage1')
INPUT = Path('C:/xjy-input')
RESULTS = Path('C:/xjy-results')
MATERIAL = INPUT/'native162-public-inputs-a1'
REPORT = RESULTS/'native162-public-placement-a1.json'
PYTHON = Path('C:/Python314/python.exe')
PYTHON_SHA = '434b361fe0c5960d404974feed493db47f2603a1ace2574312104fbed0182c6f'
MANIFEST_SHA = '855c745eee5afdef2237ac91e5c07ca2bfa42780733f9c066b657362e2545095'
GUARDS = {
    'stage1/sandbox-context.py': '09426dfd4d699c51570e1f1b10c2e37c00f6feb699b9a472ca710ae5242bf249',
    'stage1/validate-sandbox-context.py': '867a0117d6bc200960df06a355ffafcf639f24532ece3bc4db34f6e397325207',
}
PAYLOADS = (
    ('preparation.json', 139924, '50a3b6fc130fbfab22abeb72bd9f7aceb5a015e0c9d7ab5f49002099f16a80e0', 'preparation.json'),
    ('generated/business.cjs', 251856, '67ba1ea58142ea46492a9a5ff0f516287370ae709f97f8d317c1b1523a92aaf3', 'app-input/generated/business.cjs'),
    ('generated/print-domain.cjs', 178903, 'a71eeb67e3af314ea849c4e50708a056f1d6f65fb1d0c585b8f705369155de35', 'app-input/generated/print-domain.cjs'),
    ('generated/print-worker-preload.cjs', 9228, 'dabe6ccc11be733834d94f10aff3e588de8867f283d0dd359fdd35f5b8a9777c', 'app-input/generated/print-worker-preload.cjs'),
    ('generated/print-worker-templates.cjs', 1977839, 'a02bb9ac21e777beec6797623964ec660c6cf7578a3f48e9e2355b3141defbfd', 'app-input/generated/print-worker-templates.cjs'),
)
TRUST_SOURCE = INPUT/'public161-material-a1/fresh-employee-trust.json'
TRUST_TARGET = ROOT/'release-work/employee-real162-a1/public161/安装组件/delivery-tools/fresh-employee-trust.json'
TRUST_SIZE = 103069
TRUST_SHA = '03e9a804fd6b34af15e267cac159c839bed791ab735a0a2dfb6f56151310d18f'


def need(value, message):
    if not value:
        raise RuntimeError(message)


def sha(body):
    return hashlib.sha256(body).hexdigest()


def stamp(info):
    return (info.st_dev, info.st_ino, info.st_size, info.st_mtime_ns,
            info.st_ctime_ns, info.st_nlink, getattr(info, 'st_file_attributes', 0))


def same_object(left, right):
    # Windows 3.14 path-stat/fd-stat ctime semantics differ; retain full stamps
    # within each API and compare shared identity fields between the two APIs.
    return all(getattr(left, key) == getattr(right, key) for key in
               ('st_dev', 'st_ino', 'st_size', 'st_mtime_ns', 'st_nlink'))


def ordinary(file, boundary, allow_missing=False):
    file = Path(file)
    need(file.is_absolute() and file.is_relative_to(boundary), 'FIXED_BOUNDARY_REQUIRED')
    for item in (file, *file.parents):
        if not os.path.lexists(item):
            need(allow_missing, 'REQUIRED_PATH_MISSING')
            continue
        info = item.lstat()
        need(not stat.S_ISLNK(info.st_mode) and not getattr(info, 'st_file_attributes', 0) & 0x400,
             'LINKED_PATH_REFUSED')
        need(not stat.S_ISREG(info.st_mode) or info.st_nlink == 1, 'HARDLINK_REFUSED')
        if item != file:
            need(stat.S_ISDIR(info.st_mode), 'ORDINARY_ANCESTOR_REQUIRED')
    return file


def stable_bytes(file, boundary, expected_size=None, expected_sha=None, limit=2*1024*1024):
    file = ordinary(file, boundary)
    before = file.lstat()
    need(stat.S_ISREG(before.st_mode) and 0 <= before.st_size <= limit, 'BOUNDED_FILE_REQUIRED')
    if expected_size is not None:
        need(before.st_size == expected_size, 'SOURCE_SIZE_MISMATCH')
    with file.open('rb') as stream:
        opened = os.fstat(stream.fileno())
        need(stat.S_ISREG(opened.st_mode) and opened.st_nlink == 1 and same_object(before, opened),
             'SOURCE_OPEN_CHANGED')
        body = stream.read(limit+1)
        need(len(body) == opened.st_size and stamp(os.fstat(stream.fileno())) == stamp(opened),
             'SOURCE_HANDLE_CHANGED')
    ordinary(file, boundary)
    need(stamp(file.lstat()) == stamp(before), 'SOURCE_PATH_CHANGED')
    need(expected_sha is None or sha(body) == expected_sha, 'SOURCE_SHA_MISMATCH')
    need(not body.startswith(b'SQLite format 3\x00'), 'DATABASE_REFUSED')
    return body


def absent(file, boundary):
    ordinary(file, boundary, allow_missing=True)
    need(not os.path.lexists(file), 'CREATE_NEW_TARGET_REQUIRED')


def write_new(file, body, boundary):
    ordinary(boundary, boundary)
    need(boundary.is_dir(), 'EXISTING_OUTPUT_BOUNDARY_REQUIRED')
    cursor = boundary
    for part in file.relative_to(boundary).parts[:-1]:
        cursor = cursor/part
        if not os.path.lexists(cursor):
            cursor.mkdir()
        ordinary(cursor, boundary)
        need(cursor.is_dir(), 'OUTPUT_DIRECTORY_REQUIRED')
    absent(file, boundary)
    fd = os.open(file, os.O_WRONLY | os.O_CREAT | os.O_EXCL | getattr(os, 'O_BINARY', 0), 0o600)
    try:
        created = os.fstat(fd)
        need(stat.S_ISREG(created.st_mode) and created.st_nlink == 1 and created.st_size == 0,
             'NEW_OUTPUT_FILE_REQUIRED')
        offset = 0
        while offset < len(body):
            count = os.write(fd, body[offset:])
            need(count > 0, 'SHORT_OUTPUT_WRITE')
            offset += count
        os.fsync(fd)
        current = os.fstat(fd)
        ordinary(file, boundary)
        named = file.lstat()
        need(current.st_dev == created.st_dev and current.st_ino == created.st_ino and
             current.st_size == len(body) and current.st_nlink == 1 and same_object(current, named),
             'OUTPUT_IDENTITY_CHANGED')
    finally:
        os.close(fd)
    need(stable_bytes(file, boundary, len(body), sha(body)) == body, 'OUTPUT_READBACK_FAILED')


def main():
    need(os.name == 'nt' and Path(__file__).absolute() == ROOT/'audit-tools/place-native162-public-inputs.py',
         'FIXED_ACTUAL_GUEST_REQUIRED')
    need(Path(sys.executable) == PYTHON and sys.flags.isolated and sys.flags.no_site and
         sys.dont_write_bytecode and not sys.flags.optimize, 'PINNED_PYTHON_I_B_S_REQUIRED')
    need(sys.version_info[:3] == (3, 14, 8) and importlib.util.MAGIC_NUMBER.hex() == '2b0e0d0a',
         'PINNED_PYTHON_VERSION_REQUIRED')
    parser = argparse.ArgumentParser(allow_abbrev=False)
    parser.add_argument('--source-sha256', required=True)
    args = parser.parse_args()
    need(re.fullmatch(r'[a-f0-9]{64}', args.source_sha256), 'FULL_SOURCE_SHA_REQUIRED')
    stable_bytes(Path(__file__), ROOT, expected_sha=args.source_sha256)
    stable_bytes(PYTHON, PYTHON.parent, expected_sha=PYTHON_SHA)
    guards = {name: stable_bytes(ROOT/name, ROOT, expected_sha=pin) for name, pin in GUARDS.items()}
    context = types.ModuleType('native162_public_placement_context')
    context.__file__ = str(ROOT/'stage1/sandbox-context.py')
    exec(compile(guards['stage1/sandbox-context.py'], context.__file__, 'exec', dont_inherit=True), context.__dict__)
    proof = context.read_context(ROOT)

    # All six sources and all seven output names are admitted before any mkdir
    # or write. Fixed destinations never come from the material manifest.
    manifest_file = MATERIAL/'material-manifest.json'
    manifest = json.loads(stable_bytes(manifest_file, INPUT, expected_sha=MANIFEST_SHA))
    expected_rows = [{'path': name, 'size': size, 'sha256': pin} for name, size, pin, _ in PAYLOADS]
    need(manifest.get('version') == 1 and manifest.get('purpose') == 'native162-public-input-recovery-v1'
         and manifest.get('programVersion') == '1.6.2' and manifest.get('files') == expected_rows
         and manifest.get('databaseOpened') is False and manifest.get('privateKeyRead') is False
         and manifest.get('programExecuted') is False, 'EXACT_PUBLIC_MATERIAL_REQUIRED')
    inputs = []
    for name, size, pin, target in PAYLOADS:
        source = MATERIAL/name
        destination = ROOT/'release-work/release-162-a2'/target
        body = stable_bytes(source, INPUT, size, pin)
        inputs.append((source, destination, size, pin, body))
    inputs.append((TRUST_SOURCE, TRUST_TARGET, TRUST_SIZE, TRUST_SHA,
                   stable_bytes(TRUST_SOURCE, INPUT, TRUST_SIZE, TRUST_SHA)))
    ordinary(ROOT, ROOT)
    ordinary(RESULTS, RESULTS)
    need(ROOT.is_dir() and RESULTS.is_dir(), 'EXISTING_GUEST_BOUNDARIES_REQUIRED')
    for _, destination, _, _, _ in inputs:
        absent(destination, ROOT)
    absent(REPORT, RESULTS)

    placed = []
    for source, destination, size, pin, body in inputs:
        write_new(destination, body, ROOT)
        placed.append({'source': str(source), 'destination': str(destination), 'size': size, 'sha256': pin})
    for source, destination, size, pin, _ in inputs:
        stable_bytes(source, INPUT, size, pin)
        stable_bytes(destination, ROOT, size, pin)
    stable_bytes(manifest_file, INPUT, expected_sha=MANIFEST_SHA)
    for name, pin in GUARDS.items():
        stable_bytes(ROOT/name, ROOT, expected_sha=pin)
    stable_bytes(Path(__file__), ROOT, expected_sha=args.source_sha256)
    report = {'version': 1, 'purpose': 'native162-six-public-input-placement', 'passed': True,
              'actualGuest': proof, 'sourceSha256': args.source_sha256,
              'materialManifestSha256': MANIFEST_SHA, 'placedFiles': placed,
              'fileCount': 6, 'databaseOpened': False, 'markerWritten': False,
              'configurationWritten': False, 'privateKeyRead': False,
              'programExecuted': False, 'guardsChanged': False}
    write_new(REPORT, (json.dumps(report, ensure_ascii=False, indent=2)+'\n').encode('utf-8'), RESULTS)
    print(json.dumps({'passed': True, 'fileCount': 6, 'report': str(REPORT), 'programExecuted': False}))


if __name__ == '__main__':
    main()
