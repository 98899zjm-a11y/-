"""Fixed Host-only public162 data copy; CreateNew, no payload execution.

Copy only the pinned final 1007 resources, their two metadata files and two
reports. Never enumerate unrelated logs, touch bootstrap-a4, sign, or run an
application/database. Root reviews and runs this source separately.
"""

import argparse
import ast
import hashlib
import json
import os
import re
import stat
import sys
from pathlib import Path

ROOT = Path('E:/codex/2026-10-15/work/xjy-v16-deep-audit')
SELF = ROOT / 'audit-tools/copy-native162-resource-inputs.py'
HELPER = ROOT / 'audit-tools/restore-native162-public-inputs-a2.py'
HELPER_SHA = 'd777b64586d4c8ec553ff517329f75d29e1d76389fb23e6705333c578f82b4e7'
OLD = ROOT / 'sandbox/results/post161-session-a1'
NEW = ROOT / 'sandbox/results/post162-session-a1'
ARTIFACT = 'release-162-artifact-a2'
PURPOSE = 'native162-fixed-public-resource-copy-v1'
METADATA = {
    ARTIFACT + '/release-manifest.json': (332353, 'fe20ea7d83f2e2200624bf81364078ca8b206d1efcc8dbad03b1841d0fab9da2'),
    ARTIFACT + '/data-free-proof.json': (221108, '1a1e0aa79ec55125c847bb6c4151b24e7807c733397ba7d58b526c420ece26c7'),
    'release-162-preparation-a2.json': (166907, '3577e9ee4984752215465b29564a11343dd425a31916d6947d7fe99780b99c8b'),
    'release-162-candidate-a2.json': (367610, '664073e355f594d01642131aa8ee20e33bcca89bd172110b90c3e7105bba5413'),
}
MAX_FILE = 33554432


def need(value, message):
    if not value:
        raise RuntimeError(message)


def helpers():
    # Authenticate helper bytes before compiling only its reviewed data helpers.
    for item in (HELPER, *HELPER.parents):
        info = item.lstat()
        need(info.st_ino != 0 and not stat.S_ISLNK(info.st_mode)
             and not getattr(info, 'st_file_attributes', 0) & 0x400,
             'HELPER_REPARSE_POINT_REFUSED')
        need(not stat.S_ISREG(info.st_mode) or info.st_nlink == 1, 'HELPER_HARDLINK_REFUSED')
        need(stat.S_ISREG(info.st_mode) if item == HELPER else stat.S_ISDIR(info.st_mode),
             'ORDINARY_HELPER_ANCESTOR_REQUIRED')
    need(HELPER.lstat().st_size == 18600, 'FIXED_HELPER_SIZE_REQUIRED')
    body = HELPER.read_bytes()
    need(hashlib.sha256(body).hexdigest() == HELPER_SHA, 'FIXED_HELPER_SHA_REQUIRED')
    wanted = {'need', 'digest', 'norm', 'stamp', 'directory_stamp', 'common_identity',
              'relative', 'ordinary', 'read', 'unique', 'reject_constant', 'parse', 'exact_tree'}
    tree = ast.parse(body, filename=str(HELPER))
    definitions = [node for node in tree.body if isinstance(node, ast.FunctionDef) and node.name in wanted]
    need({node.name for node in definitions} == wanted and len(definitions) == len(wanted),
         'EXACT_REVIEWED_HELPER_DEFINITIONS_REQUIRED')
    namespace = {'ROOT': ROOT, 'MAX_FILE': MAX_FILE, 'Path': Path, 'os': os,
                 'stat': stat, 're': re, 'hashlib': hashlib, 'json': json}
    exec(compile(ast.Module(body=definitions, type_ignores=[]), '<pinned-pure-data-helpers>', 'exec'), namespace)
    need(namespace['read'](HELPER, (18600, HELPER_SHA)) == body, 'HELPER_CHANGED_DURING_LOAD')
    for name in wanted:
        globals()[name] = namespace[name]


def plan():
    metadata = {name: read(OLD / name, pin) for name, pin in METADATA.items()}
    manifest = parse(metadata[ARTIFACT + '/release-manifest.json'])
    proof = parse(metadata[ARTIFACT + '/data-free-proof.json'])
    report = parse(metadata['release-162-preparation-a2.json'])
    candidate = parse(metadata['release-162-candidate-a2.json'])
    need(manifest['programVersion'] == '1.6.2' and manifest['resourcesOnly'] is True
         and manifest['fileCount'] == 1007 and len(manifest['files']) == 1007
         and candidate['manifest'] == manifest and candidate['sealed'] is True
         and candidate['signed'] is False and candidate['dataIncluded'] is False
         and proof['files'] == manifest['files'] and proof['dataIncluded'] is False
         and proof['signed'] is False and report['prepared'] is True
         and report['signed'] is False and report['dataIncluded'] is False
         and report['savedPreparation']['sha256'] == candidate['preparationSha256']
         == '50a3b6fc130fbfab22abeb72bd9f7aceb5a015e0c9d7ab5f49002099f16a80e0',
         'FIXED_UNSIGNED_FINAL_CANDIDATE_REQUIRED')
    records, resources = dict(METADATA), []
    for row in manifest['files']:
        need(set(row) == {'path', 'size', 'sha256'} and type(row['size']) is int
             and 0 <= row['size'] <= MAX_FILE and isinstance(row['sha256'], str)
             and re.fullmatch(r'[0-9a-f]{64}', row['sha256'])
             and relative(row['path']).startswith('resources/'), 'FIXED_RESOURCE_RECORD_REQUIRED')
        name = ARTIFACT + '/' + row['path']
        need(name not in records, 'DUPLICATE_RESOURCE_RECORD')
        records[name] = (row['size'], row['sha256'])
        resources.append(row['path'])
    need(len({name.casefold() for name in records}) == 1011, 'EXACT_1011_PUBLIC_FILES_REQUIRED')
    exact_tree(OLD / ARTIFACT, resources + ['release-manifest.json', 'data-free-proof.json'])
    for name, pin in records.items():
        read(OLD / name, pin)  # All source bytes pass before any destination is created.
    return records, resources


def put(name, body, records):
    need(name in records and (len(body), digest(body)) == records[name], 'EXACT_OUTPUT_RECORD_REQUIRED')
    file = NEW / relative(name)
    cursor = NEW
    for part in file.relative_to(NEW).parts[:-1]:
        cursor /= part
        if not os.path.lexists(cursor):
            cursor.mkdir()
        ordinary(cursor, directory=True)
    need(not os.path.lexists(file), 'CREATE_NEW_FILE_REQUIRED')
    fd = os.open(file, os.O_WRONLY | os.O_CREAT | os.O_EXCL | getattr(os, 'O_BINARY', 0), 0o600)
    try:
        initial = os.fstat(fd)
        need(stat.S_ISREG(initial.st_mode) and initial.st_nlink == 1 and initial.st_size == 0,
             'NEW_OUTPUT_IDENTITY_REQUIRED')
        offset = 0
        while offset < len(body):
            count = os.write(fd, body[offset:])
            need(count > 0, 'SHORT_OUTPUT_WRITE')
            offset += count
        os.fsync(fd)
        current = os.fstat(fd)
        _, named = ordinary(file)
        need(current.st_dev == initial.st_dev and current.st_ino == initial.st_ino
             and current.st_nlink == 1 and common_identity(current, named), 'OUTPUT_IDENTITY_CHANGED')
    finally:
        os.close(fd)
    need(read(file, records[name]) == body, 'CREATE_NEW_READBACK_MISMATCH')


def main():
    parser = argparse.ArgumentParser(allow_abbrev=False)
    parser.add_argument('--source-sha256', required=True)
    args = parser.parse_args()
    need(os.name == 'nt' and Path(__file__).absolute() == SELF
         and sys.flags.isolated and sys.flags.no_site and sys.dont_write_bytecode,
         'FIXED_HOST_SCRIPT_AND_I_B_S_REQUIRED')
    helpers()
    need(re.fullmatch(r'[0-9a-f]{64}', args.source_sha256), 'EXPLICIT_FULL_SOURCE_SHA_REQUIRED')
    source = read(SELF, limit=1048576)
    need(digest(source) == args.source_sha256, 'TOOL_SOURCE_PIN_MISMATCH')
    ordinary(OLD, directory=True)
    ordinary(NEW, directory=True)
    for name in (ARTIFACT, 'release-162-preparation-a2.json', 'release-162-candidate-a2.json'):
        need(not os.path.lexists(NEW / name), 'EXISTING_DESTINATION_REFUSED: ' + name)
    records, resources = plan()
    (NEW / ARTIFACT).mkdir()  # Single fixed artifact directory must still be new.
    ordinary(NEW / ARTIFACT, directory=True)
    for name, pin in records.items():
        put(name, read(OLD / name, pin), records)
    exact_tree(NEW / ARTIFACT, resources + ['release-manifest.json', 'data-free-proof.json'])
    exact_tree(OLD / ARTIFACT, resources + ['release-manifest.json', 'data-free-proof.json'])
    for name, pin in records.items():
        read(OLD / name, pin)
        read(NEW / name, pin)
    need(read(SELF, limit=1048576) == source, 'TOOL_SOURCE_CHANGED')
    read(HELPER, (18600, HELPER_SHA))
    print(json.dumps({'purpose': PURPOSE, 'copied': True, 'sourceSha256': args.source_sha256,
                      'resourceFiles': 1007, 'metadataAndReports': 4, 'totalFiles': 1011,
                      'totalBytes': sum(pin[0] for pin in records.values()),
                      'oldRoot': str(OLD), 'newRoot': str(NEW), 'programExecuted': False,
                      'databaseOpened': False, 'privateKeyRead': False, 'failedOutputsPreserved': True}))
    return 0


if __name__ == '__main__':
    try:
        raise SystemExit(main())
    except Exception as error:
        print(json.dumps({'purpose': PURPOSE, 'copied': False, 'error': str(error),
                          'programExecuted': False, 'databaseOpened': False,
                          'privateKeyRead': False, 'failedOutputsPreserved': True}), file=sys.stderr)
        raise SystemExit(1)
