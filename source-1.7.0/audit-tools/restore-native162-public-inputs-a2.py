"""Host-only recovery of five already-pinned public native162 seed inputs.

Treat all sources as inert bytes. Never import payloads, open a database, run an
EXE, sign, touch production, change a pin, or write to release-work. A failed
CreateNew output is preserved. Root reviews and runs this tool separately.
"""

import argparse
import hashlib
import json
import os
import re
import stat
import struct
import sys
from pathlib import Path


ROOT = Path('E:/codex/2026-10-15/work/xjy-v16-deep-audit')
SELF = ROOT / 'audit-tools/restore-native162-public-inputs-a2.py'
RESULTS = ROOT / 'sandbox/results/post161-session-a1'
ARTIFACT = RESULTS / 'release-162-artifact-a2'
OUTPUT = ROOT / 'sandbox/input/native162-public-inputs-a1'
PURPOSE = 'native162-public-input-recovery-v1'
PREPARATION_SHA = '50a3b6fc130fbfab22abeb72bd9f7aceb5a015e0c9d7ab5f49002099f16a80e0'
INPUTS = {
    'release-162-preparation-a2.json': (166907, '3577e9ee4984752215465b29564a11343dd425a31916d6947d7fe99780b99c8b'),
    'release-162-candidate-a2.json': (367610, '664073e355f594d01642131aa8ee20e33bcca89bd172110b90c3e7105bba5413'),
    'release-162-artifact-a2/release-manifest.json': (332353, 'fe20ea7d83f2e2200624bf81364078ca8b206d1efcc8dbad03b1841d0fab9da2'),
    'release-162-artifact-a2/data-free-proof.json': (221108, '1a1e0aa79ec55125c847bb6c4151b24e7807c733397ba7d58b526c420ece26c7'),
    'release-162-artifact-a2/resources/app.asar': (12569953, '02a3dc5128203889fa88205020c39970f08305b4496e64507ca5ec5eab7f7568'),
}
PAYLOADS = {
    'preparation.json': (139924, PREPARATION_SHA),
    'generated/business.cjs': (251856, '67ba1ea58142ea46492a9a5ff0f516287370ae709f97f8d317c1b1523a92aaf3'),
    'generated/print-domain.cjs': (178903, 'a71eeb67e3af314ea849c4e50708a056f1d6f65fb1d0c585b8f705369155de35'),
    'generated/print-worker-preload.cjs': (9228, 'dabe6ccc11be733834d94f10aff3e588de8867f283d0dd359fdd35f5b8a9777c'),
    'generated/print-worker-templates.cjs': (1977839, 'a02bb9ac21e777beec6797623964ec660c6cf7578a3f48e9e2355b3141defbfd'),
}
SHA = re.compile(r'[0-9a-f]{64}')
MAX_FILE = 16777216


def need(value, message):
    if not value:
        raise RuntimeError(message)


def digest(body):
    return hashlib.sha256(body).hexdigest()


def norm(value):
    return os.path.normcase(os.path.normpath(str(value)))


def stamp(value):
    return tuple(getattr(value, name, None) for name in (
        'st_dev', 'st_ino', 'st_size', 'st_mtime_ns', 'st_ctime_ns',
        'st_nlink', 'st_birthtime_ns', 'st_file_attributes'))


def directory_stamp(value):
    # Directory st_size changed 0 -> nonzero during read-only traversal on the
    # pinned Windows/Python runtime. It is not a file byte-length invariant.
    # Keep all remaining identity/timestamp/attribute checks for directories.
    return tuple(getattr(value, name, None) for name in (
        'st_dev', 'st_ino', 'st_mtime_ns', 'st_ctime_ns',
        'st_nlink', 'st_birthtime_ns', 'st_file_attributes'))


def common_identity(left, right):
    return all(getattr(left, name) == getattr(right, name) for name in (
        'st_dev', 'st_ino', 'st_size', 'st_mtime_ns', 'st_nlink'))


def relative(value):
    need(isinstance(value, str) and value and len(value.encode('utf-8')) <= 240,
         'CANONICAL_RELATIVE_PATH_REQUIRED')
    need(all(part and part not in ('.', '..')
             and not re.search(r'[\\:\x00-\x1f]', part)
             and not part.endswith(('.', ' '))
             and not re.match(r'^(con|prn|aux|nul|com[1-9]|lpt[1-9])(?:\.|$)', part, re.I)
             for part in value.split('/')), 'UNSAFE_RELATIVE_PATH')
    return value


def ordinary(file, boundary=ROOT, directory=False):
    file, boundary = Path(file).absolute(), Path(boundary).absolute()
    need(file.is_relative_to(boundary) and not str(file).startswith(('\\\\', '//')),
         'FIXED_ROOT_CONTAINMENT_REQUIRED')
    for item in (file, *file.parents):
        info = item.lstat()
        need(info.st_ino != 0 and not stat.S_ISLNK(info.st_mode)
             and not getattr(info, 'st_file_attributes', 0) & 0x400, 'REPARSE_POINT_REFUSED')
        need(not stat.S_ISREG(info.st_mode) or info.st_nlink == 1, 'HARDLINK_REFUSED')
        if item != file:
            need(stat.S_ISDIR(info.st_mode), 'ORDINARY_ANCESTOR_REQUIRED')
    info = file.lstat()
    need(stat.S_ISDIR(info.st_mode) if directory else stat.S_ISREG(info.st_mode),
         'ORDINARY_TYPE_REQUIRED')
    need(norm(os.path.realpath(file)) == norm(file)
         and norm(os.path.realpath(boundary)) == norm(boundary), 'CANONICAL_PATH_REQUIRED')
    return file, info


def read(file, expected=None, boundary=ROOT, limit=MAX_FILE):
    file, before = ordinary(file, boundary)
    need(0 <= before.st_size <= limit, 'BOUNDED_REGULAR_INPUT_REQUIRED')
    fd = os.open(file, os.O_RDONLY | getattr(os, 'O_BINARY', 0) | getattr(os, 'O_NOFOLLOW', 0))
    try:
        opened = os.fstat(fd)
        need(stat.S_ISREG(opened.st_mode) and opened.st_nlink == 1
             and common_identity(before, opened), 'INPUT_OBJECT_CHANGED')
        parts, total = [], 0
        while True:
            body = os.read(fd, min(1048576, limit + 1 - total))
            if not body:
                break
            parts.append(body)
            total += len(body)
            need(total <= limit, 'INPUT_SIZE_LIMIT')
        need(stamp(opened) == stamp(os.fstat(fd)), 'INPUT_FD_CHANGED')
    finally:
        os.close(fd)
    body = b''.join(parts)
    _, after = ordinary(file, boundary)
    need(stamp(before) == stamp(after) and len(body) == before.st_size, 'INPUT_PATH_CHANGED')
    if expected is not None:
        need((len(body), digest(body)) == expected, 'FIXED_SIZE_OR_SHA_MISMATCH: ' + str(file))
    return body


def unique(pairs):
    value = {}
    for key, item in pairs:
        need(key not in value, 'DUPLICATE_JSON_KEY')
        value[key] = item
    return value


def reject_constant(value):
    raise RuntimeError('NONFINITE_JSON_REFUSED')


def parse(body):
    return json.loads(body, object_pairs_hook=unique, parse_constant=reject_constant)


def json_bytes(value):
    return (json.dumps(value, ensure_ascii=True, sort_keys=True, indent=2,
                       allow_nan=False) + '\n').encode('ascii')


def exact_tree(root, expected):
    root, before = ordinary(root, directory=True)
    names, directories = set(expected), set()
    need(len(names) == len(expected) and len({name.casefold() for name in names}) == len(names),
         'DUPLICATE_EXPECTED_PATH')
    for name in names:
        relative(name)
        parts = name.split('/')
        directories.update('/'.join(parts[:i]) for i in range(1, len(parts)))
    found, found_dirs = set(), set()

    def walk(folder):
        _, initial = ordinary(folder, directory=True)
        for name in sorted(os.listdir(folder)):
            file = folder / name
            rel = file.relative_to(root).as_posix()
            info = file.lstat()
            ordinary(file, directory=stat.S_ISDIR(info.st_mode))
            if stat.S_ISDIR(info.st_mode):
                need(rel in directories, 'EXTRA_DIRECTORY_REFUSED')
                found_dirs.add(rel)
                walk(file)
            else:
                need(rel in names, 'EXTRA_FILE_REFUSED')
                found.add(rel)
        need(directory_stamp(initial) == directory_stamp(ordinary(folder, directory=True)[1]), 'DIRECTORY_CHANGED')

    walk(root)
    need(found == names and found_dirs == directories, 'MISSING_OR_EMPTY_PATH_REFUSED')
    need(directory_stamp(before) == directory_stamp(ordinary(root, directory=True)[1]), 'TREE_ROOT_CHANGED')


def asar_payloads(body, expected_entries):
    need(len(body) >= 16, 'ASAR_HEADER_REQUIRED')
    size_pickle, header_pickle, header_payload, json_size = struct.unpack('<4I', body[:16])
    need(size_pickle == 4 and header_payload == ((4 + json_size + 3) // 4) * 4
         and header_pickle == header_payload + 4 and 0 < json_size <= 1048576,
         'EXACT_ASAR_PICKLE_LAYOUT_REQUIRED')
    base = 8 + header_pickle
    need(base <= len(body) and body[16 + json_size:base] == b'\0' * (base - 16 - json_size),
         'ASAR_HEADER_PADDING_REQUIRED')
    header = parse(body[16:16 + json_size])
    entries = {}

    def walk(directory, prefix=''):
        need(isinstance(directory, dict) and set(directory) == {'files'}
             and isinstance(directory['files'], dict) and directory['files'], 'ASAR_DIRECTORY_REQUIRED')
        for name, entry in directory['files'].items():
            need('/' not in relative(name), 'ASAR_SINGLE_SEGMENT_REQUIRED')
            path = prefix + name
            relative(path)
            need(isinstance(entry, dict), 'ASAR_ENTRY_OBJECT_REQUIRED')
            if 'files' in entry:
                walk(entry, path + '/')
            else:
                need(set(entry) == {'size', 'offset', 'integrity'}
                     and type(entry['size']) is int and 0 <= entry['size'] <= MAX_FILE
                     and isinstance(entry['offset'], str)
                     and re.fullmatch(r'0|[1-9][0-9]*', entry['offset']),
                     'PACKED_REGULAR_ASAR_ENTRY_REQUIRED')
                need(path.casefold() not in {item.casefold() for item in entries},
                     'DUPLICATE_ASAR_PATH')
                entries[path] = entry

    walk(header)
    need(len(entries) == 142 and sorted(entries) == sorted(expected_entries)
         and len(expected_entries) == 142, 'EXACT_142_ASAR_PATHS_REQUIRED')
    cursor, extracted = 0, {}
    for path, entry in sorted(entries.items(), key=lambda pair: int(pair[1]['offset'])):
        offset, size = int(entry['offset']), entry['size']
        need(offset == cursor and base + offset + size <= len(body), 'ASAR_RANGE_GAP_OR_OVERLAP')
        data = body[base + offset:base + offset + size]
        integrity = entry['integrity']
        need(isinstance(integrity, dict)
             and set(integrity) == {'algorithm', 'hash', 'blockSize', 'blocks'}
             and integrity['algorithm'] == 'SHA256' and integrity['blockSize'] == 4194304
             and integrity['hash'] == digest(data)
             and integrity['blocks'] == [digest(data[i:i + 4194304])
                                        for i in range(0, size, 4194304)],
             'ASAR_ENTRY_INTEGRITY_MISMATCH')
        if path in PAYLOADS:
            need((len(data), digest(data)) == PAYLOADS[path], 'GENERATED_ORIGINAL_PIN_MISMATCH')
            extracted[path] = data
        cursor += size
    need(base + cursor == len(body) and set(extracted) == set(PAYLOADS) - {'preparation.json'},
         'ASAR_TRAILING_OR_MISSING_GENERATED_BYTES')
    return extracted


def verified_material():
    bodies = {name: read(RESULTS / name, pin) for name, pin in INPUTS.items()}
    report = parse(bodies['release-162-preparation-a2.json'])
    candidate = parse(bodies['release-162-candidate-a2.json'])
    manifest = parse(bodies['release-162-artifact-a2/release-manifest.json'])
    proof = parse(bodies['release-162-artifact-a2/data-free-proof.json'])
    prep = report['preparation']
    need(report['phase'] == 'prepare' and report['prepared'] is True
         and report['signed'] is False and report['dataIncluded'] is False
         and report['savedPreparation'] == {
             'file': 'C:\\xjy-work\\xjy-web-stage1\\release-work\\release-162-a2\\preparation.json',
             'sha256': PREPARATION_SHA}, 'ORIGINAL_PREPARATION_REPORT_REQUIRED')
    need(prep['version'] == 1 and prep['product'] == 'xjy-jewelry-offline'
         and prep['programVersion'] == '1.6.2' and prep['serviceStarted'] is False
         and prep['dataIncluded'] is False
         and prep['workDir'] == 'C:\\xjy-work\\xjy-web-stage1\\release-work\\release-162-a2'
         and prep['app'] == prep['workDir'] + '\\app-input'
         and prep['resources'] == prep['workDir'] + '\\resources-input',
         'ORIGINAL_PREPARATION_IDENTITY_REQUIRED')
    # Original builder writes JSON.stringify(preparation, null, 2), WITHOUT LF.
    # Keep original property order and require its unchanged original byte pin.
    preparation = json.dumps(prep, ensure_ascii=False, indent=2, allow_nan=False).encode('utf-8')
    need((len(preparation), digest(preparation)) == PAYLOADS['preparation.json'],
         'PREPARATION_RECONSTRUCTION_NOT_EXACT_NO_OUTPUT_CREATED')
    need(candidate['preparationSha256'] == PREPARATION_SHA
         and candidate['sealed'] is True and candidate['signed'] is False
         and candidate['programExecuted'] is False and candidate['dataIncluded'] is False
         and candidate['manifest'] == manifest and proof['files'] == manifest['files']
         and proof['dataIncluded'] is False and proof['signed'] is False,
         'FIXED_UNSIGNED_CANDIDATE_BINDING_REQUIRED')
    need(manifest['programVersion'] == '1.6.2' and manifest['resourcesOnly'] is True
         and manifest['fileCount'] == 1007 and len(manifest['files']) == 1007
         and manifest['asar']['sha256'] == INPUTS['release-162-artifact-a2/resources/app.asar'][1]
         and manifest['asar']['entryCount'] == 142 and manifest['asar']['allEntriesExtracted'] is True,
         'FIXED_ARTIFACT_AND_ASAR_REQUIRED')
    rows = manifest['files']
    for row in rows:
        need(set(row) == {'path', 'size', 'sha256'} and type(row['size']) is int
             and 0 <= row['size'] <= 805306368 and SHA.fullmatch(row['sha256'])
             and relative(row['path']).startswith('resources/'), 'RESOURCE_RECORD_REQUIRED')
    exact_tree(ARTIFACT, [row['path'] for row in rows] + ['release-manifest.json', 'data-free-proof.json'])
    extracted = asar_payloads(bodies['release-162-artifact-a2/resources/app.asar'],
                              manifest['asar']['entries'])
    app_rows = {row['path']: row for row in prep['artifacts']['app']}
    need(len(app_rows) == len(prep['artifacts']['app']), 'DUPLICATE_PREPARATION_ARTIFACT')
    for name in extracted:
        size, pin = PAYLOADS[name]
        need(app_rows[name] == {'path': name, 'size': size, 'sha256': pin}
             and any(item.get('output') == name and item.get('sha256') == pin
                     for item in prep['evidence']), 'ORIGINAL_COMPILER_EVIDENCE_REQUIRED')
    return {'preparation.json': preparation, **extracted}, [row['path'] for row in rows]


def write_new(name, body):
    need(name in set(PAYLOADS) | {'material-manifest.json'}, 'EXACT_OUTPUT_PATH_REQUIRED')
    file = OUTPUT / relative(name)
    ordinary(OUTPUT, directory=True)
    if '/' in name:
        directory = OUTPUT / 'generated'
        if not os.path.lexists(directory):
            directory.mkdir()
        ordinary(directory, directory=True)
    need(not os.path.lexists(file), 'CREATE_NEW_FILE_REQUIRED')
    ordinary(file.parent, directory=True)
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
    need(read(file, (len(body), digest(body))) == body, 'CREATE_NEW_READBACK_MISMATCH')


def main():
    parser = argparse.ArgumentParser(allow_abbrev=False)
    parser.add_argument('--source-sha256', required=True)
    args = parser.parse_args()
    need(os.name == 'nt' and norm(Path(__file__).absolute()) == norm(SELF)
         and sys.flags.isolated and sys.flags.no_site and sys.dont_write_bytecode,
         'FIXED_HOST_SCRIPT_AND_I_B_S_REQUIRED')
    need(SHA.fullmatch(args.source_sha256), 'EXPLICIT_FULL_SOURCE_SHA_REQUIRED')
    source = read(SELF, limit=1048576)
    need(digest(source) == args.source_sha256, 'TOOL_SOURCE_PIN_MISMATCH')
    payloads, resource_names = verified_material()
    material = {
        'version': 1, 'purpose': PURPOSE, 'programVersion': '1.6.2',
        'toolSourceSha256': args.source_sha256,
        'sources': [{'path': name, 'size': pin[0], 'sha256': pin[1]} for name, pin in INPUTS.items()],
        'files': [{'path': name, 'size': PAYLOADS[name][0], 'sha256': PAYLOADS[name][1]}
                  for name in PAYLOADS],
        'reconstruction': 'Original preparation JSON property order; two-space indent; UTF-8; no terminal LF. Generated files are exact packed ASAR byte ranges.',
        'programExecuted': False, 'databaseOpened': False, 'privateKeyRead': False,
    }
    material_body = json_bytes(material)
    ordinary(OUTPUT.parent, directory=True)
    need(not os.path.lexists(OUTPUT), 'CREATE_NEW_OUTPUT_DIRECTORY_REQUIRED')
    OUTPUT.mkdir()
    ordinary(OUTPUT, directory=True)
    for name in PAYLOADS:
        write_new(name, payloads[name])
    # Recheck every input used and all source artifact names before publishing
    # the material manifest. Other resource contents are not read or attested.
    for name, pin in INPUTS.items():
        read(RESULTS / name, pin)
    exact_tree(ARTIFACT, resource_names + ['release-manifest.json', 'data-free-proof.json'])
    need(read(SELF, limit=1048576) == source, 'TOOL_SOURCE_CHANGED')
    write_new('material-manifest.json', material_body)
    exact_tree(OUTPUT, list(PAYLOADS) + ['material-manifest.json'])
    for name, pin in PAYLOADS.items():
        read(OUTPUT / name, pin)
    read(OUTPUT / 'material-manifest.json', (len(material_body), digest(material_body)))
    print(json.dumps({
        'purpose': PURPOSE, 'restored': True, 'output': str(OUTPUT),
        'sourceSha256': args.source_sha256, 'materialManifestSha256': digest(material_body),
        'payloadCount': 5, 'transportFileCount': 6, 'preparationSha256': PREPARATION_SHA,
        'programExecuted': False, 'databaseOpened': False, 'privateKeyRead': False,
        'failedOutputsPreserved': True,
    }))
    return 0


if __name__ == '__main__':
    try:
        raise SystemExit(main())
    except Exception as error:
        print(json.dumps({'purpose': PURPOSE, 'restored': False, 'error': str(error),
                          'programExecuted': False, 'databaseOpened': False,
                          'privateKeyRead': False, 'failedOutputsPreserved': True}), file=sys.stderr)
        raise SystemExit(1)
