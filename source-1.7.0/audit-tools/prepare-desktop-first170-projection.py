"""Copy the fixed 1.6.2 program resources and unpack its ASAR as review material.

Standard library only. No product imports, DB access, subprocesses or version edits.
The complete manifest is written last; partial output is retained, never retried over.
ASAR framing follows the already-used initial-patch-core.packageIdentity / Electron
asar pickle reader. This reader additionally rejects links and validates every leaf.
"""
import argparse
import datetime
import hashlib
import json
import os
from pathlib import Path
import re
import stat
import struct
import sys

ROOT = Path('E:/codex/2026-10-15/work/xjy-v16-deep-audit')
SELF = ROOT / 'audit-tools/prepare-desktop-first170-projection.py'
SOURCE = ROOT / 'release-work/initial-162-host-sealed-a5/payload'
REFERENCE = ROOT / 'sandbox/results/native-installed-162-a1/release-162-artifact-a4/release-manifest.json'
OUTPUT = ROOT / 'release-work/desktop-first170-source-a1'
REFERENCE_SHA = '17859011d627eb2b24446d088e1e9c25304e477fa28123cec6ce6c7a83f9d767'
ASAR_SHA = '28e24d0dea9416258b67edc2b6fe6aca8683c68d02c9fc305626660dd4c55e6f'
ASAR_SIZE = 12570325
RESOURCE_COUNT, RESOURCE_BYTES = 1007, 163277529
MAX_FILE, MAX_HEADER, MAX_NODES = 256 * 1024 * 1024, 2 * 1024 * 1024, 16384
HEX = re.compile(r'[a-f0-9]{64}\Z')
DEVICE = re.compile(r'(?:CON|PRN|AUX|NUL|COM[1-9]|LPT[1-9])(?:\.|\Z)', re.I)


def need(condition, message):
    if not condition:
        raise RuntimeError(message)


def sha(body):
    return hashlib.sha256(body).hexdigest()


def safe_relative(value):
    need(isinstance(value, str) and 0 < len(value) <= 1024, 'Invalid relative path')
    parts = value.split('/')
    for part in parts:
        need(part not in ('', '.', '..') and len(part) <= 255 and
             not any(ord(c) < 32 or ord(c) == 127 or c in '\\:<>"|?*' for c in part) and
             not part.endswith((' ', '.')) and not DEVICE.match(part), 'Unsafe Windows path: ' + value)
    return value


def signature(s):
    return (s.st_dev, s.st_ino, s.st_mode, s.st_nlink, s.st_size, s.st_mtime_ns,
            s.st_ctime_ns, getattr(s, 'st_birthtime_ns', None))


def same_open_file(path, by_path, by_handle):
    # CPython Windows path stat preserves historical creation-time ctime;
    # fstat exposes change-time. Compare each API's complete snapshot to itself
    # before/after, and compare shared identity plus explicit birthtime across APIs.
    fields = ('st_dev', 'st_ino', 'st_nlink', 'st_size', 'st_mtime_ns', 'st_birthtime_ns')
    if any(getattr(by_path, k, None) != getattr(by_handle, k, None) for k in fields):
        return False
    expected_mode = by_handle.st_mode
    if os.name == 'nt' and path.suffix.lower() in ('.exe', '.cmd', '.bat', '.com'):
        expected_mode |= 0o111  # CPython's documented extension-derived path mode.
    return by_path.st_mode == expected_mode


def ordinary(path, file=False):
    """Check each lexical ancestor, not a resolve() that could conceal links."""
    need(path.is_absolute() and not str(path).startswith(('\\\\', '//')), 'Local absolute path required')
    for part in (path, *path.parents):
        s = part.lstat()
        need(not stat.S_ISLNK(s.st_mode) and not (getattr(s, 'st_file_attributes', 0) & 0x400),
             'Link/reparse point refused: ' + str(part))
        if part == path and file:
            need(stat.S_ISREG(s.st_mode) and s.st_nlink == 1, 'Ordinary single-link file required: ' + str(part))
        else:
            need(stat.S_ISDIR(s.st_mode), 'Ordinary directory required: ' + str(part))
    return path.stat()


def read_stable(path, expected=None, limit=MAX_FILE):
    before = ordinary(path, file=True)
    need(0 <= before.st_size <= limit, 'Input size refused: ' + str(path))
    flags = os.O_RDONLY | getattr(os, 'O_BINARY', 0) | getattr(os, 'O_NOFOLLOW', 0)
    fd = os.open(path, flags)
    try:
        opened = os.fstat(fd)
        need(same_open_file(path, before, opened), 'Input changed before open')
        with os.fdopen(fd, 'rb', closefd=False) as stream:
            body = stream.read(before.st_size + 1)
        need(len(body) == before.st_size and signature(os.fstat(fd)) == signature(opened),
             'Input changed while reading')
    finally:
        os.close(fd)
    need(signature(ordinary(path, file=True)) == signature(before), 'Input changed after reading')
    if expected is not None:
        need(len(body) == expected['size'] and sha(body) == expected['sha256'], 'Pinned bytes differ: ' + str(path))
    return body


def pairs_unique(pairs):
    result = {}
    for key, value in pairs:
        need(key not in result, 'Duplicate JSON property: ' + key)
        result[key] = value
    return result


def json_bytes(body):
    return json.loads(body.decode('utf-8', errors='strict'), object_pairs_hook=pairs_unique,
                      parse_constant=lambda value: need(False, 'Non-finite JSON number'))


def inventory(directory):
    ordinary(directory)
    files, directories = [], []
    for current, names, leaves in os.walk(directory, followlinks=False):
        parent = Path(current)
        ordinary(parent)
        for name in sorted(names):
            child = parent / name
            ordinary(child)
            directories.append(safe_relative(child.relative_to(directory).as_posix()))
        for name in sorted(leaves):
            child = parent / name
            ordinary(child, file=True)
            files.append(safe_relative(child.relative_to(directory).as_posix()))
    return sorted(files), sorted(directories)


def expected_directories(paths):
    result = set()
    for name in paths:
        parts = name.split('/')
        for i in range(1, len(parts)):
            result.add('/'.join(parts[:i]))
    return result


def resource_manifest(body):
    value = json_bytes(body)
    need(isinstance(value, dict) and value.get('programVersion') == '1.6.2' and
         value.get('main') == 'release-entry.cjs' and value.get('resourcesOnly') is True and
         value.get('fileCount') == RESOURCE_COUNT and value.get('bytes') == RESOURCE_BYTES,
         'Exact installed 1.6.2 resource manifest required')
    rows = value.get('files')
    need(isinstance(rows, list) and len(rows) == RESOURCE_COUNT, 'Expected exactly 1007 resources')
    result, folded = {}, set()
    for row in rows:
        need(isinstance(row, dict) and set(row) == {'path', 'size', 'sha256'}, 'Invalid resource record')
        name = safe_relative(row['path'])
        need(name.startswith('resources/') and name.casefold() not in folded and
             type(row['size']) is int and 0 <= row['size'] <= MAX_FILE and
             isinstance(row['sha256'], str) and HEX.fullmatch(row['sha256']), 'Invalid/duplicate resource')
        folded.add(name.casefold())
        result[name] = row
    need(sum(row['size'] for row in result.values()) == RESOURCE_BYTES, 'Resource byte count differs')
    need(result.get('resources/app.asar') == {'path': 'resources/app.asar', 'size': ASAR_SIZE, 'sha256': ASAR_SHA},
         'Exact ASAR tuple required')
    return result


def check_resources(rows):
    """Only the resources subtree is read; sibling delivery approvals are untouched."""
    names, dirs = inventory(SOURCE / 'resources')
    expected = {name[len('resources/'):] for name in rows}
    need(set(names) == expected and set(dirs) == expected_directories(expected),
         'Baseline resources contain missing/extra files or directories')
    asar = None
    for name, row in sorted(rows.items()):
        body = read_stable(SOURCE / name, row)
        if name == 'resources/app.asar':
            asar = body
    return asar


def asar_files(body, resources):
    need(len(body) == ASAR_SIZE and sha(body) == ASAR_SHA, 'ASAR identity differs')
    need(len(body) >= 16, 'Truncated ASAR')
    marker, length = struct.unpack_from('<II', body)
    need(marker == 4 and 8 <= length <= MAX_HEADER and length % 4 == 0 and 8 + length <= len(body),
         'Invalid ASAR size pickle')
    payload, text_length = struct.unpack_from('<II', body, 8)
    need(payload == length - 4 and 0 < text_length <= length - 8 and
         not any(body[16 + text_length:8 + length]), 'Invalid ASAR header pickle/padding')
    tree = json_bytes(body[16:16 + text_length])
    need(isinstance(tree, dict) and set(tree) == {'files'}, 'Invalid ASAR root')
    leaves, directories, names, ranges = [], [], set(), []
    count = 0

    def walk(node, prefix='', inherited_unpacked=False, depth=0):
        nonlocal count
        need(depth <= 64 and isinstance(node, dict) and set(node) <= {'files', 'unpacked'} and
             isinstance(node.get('files'), dict), 'Invalid ASAR directory/link')
        need('unpacked' not in node or type(node['unpacked']) is bool, 'Invalid ASAR unpacked marker')
        unpacked_parent = inherited_unpacked or node.get('unpacked', False)
        for component, item in node['files'].items():
            count += 1
            need(count <= MAX_NODES and isinstance(component, str) and '/' not in component, 'ASAR entry cap/name')
            name = safe_relative(prefix + component)
            need(name.casefold() not in names and isinstance(item, dict) and 'link' not in item,
                 'ASAR duplicate/case collision/link refused')
            names.add(name.casefold())
            if 'files' in item:
                directories.append(name)
                walk(item, name + '/', unpacked_parent, depth + 1)
                continue
            need(set(item) <= {'size', 'offset', 'unpacked', 'executable', 'integrity'} and
                 type(item.get('size')) is int and 0 <= item['size'] <= MAX_FILE and
                 ('unpacked' not in item or type(item['unpacked']) is bool) and
                 ('executable' not in item or type(item['executable']) is bool), 'Invalid ASAR file metadata')
            unpacked = unpacked_parent or item.get('unpacked', False)
            entry = {'path': name, 'size': item['size'], 'unpacked': unpacked}
            if unpacked:
                source = 'resources/app.asar.unpacked/' + name
                need('offset' not in item and source in resources and resources[source]['size'] == item['size'],
                     'Unpacked file must be a pinned resource inside app.asar.unpacked')
                entry['resourcePath'] = source
                data = read_stable(SOURCE / source, resources[source])
            else:
                need(isinstance(item.get('offset'), str) and re.fullmatch(r'0|[1-9][0-9]*', item['offset']) and
                     len(item['offset']) <= 16, 'Invalid packed ASAR offset')
                begin = 8 + length + int(item['offset'])
                end = begin + item['size']
                need(begin >= 8 + length and end <= len(body), 'ASAR file outside archive')
                if end > begin:
                    ranges.append((begin, end, name))
                entry['archiveOffset'] = begin
                data = body[begin:end]
            digest = sha(data)
            if 'integrity' in item:
                integrity = item['integrity']
                need(isinstance(integrity, dict) and set(integrity) == {'algorithm', 'hash', 'blockSize', 'blocks'} and
                     integrity['algorithm'] == 'SHA256' and integrity['hash'] == digest and
                     type(integrity['blockSize']) is int and 0 < integrity['blockSize'] <= MAX_FILE and
                     isinstance(integrity['blocks'], list), 'ASAR integrity metadata/hash differs')
                blocks = [sha(data[i:i + integrity['blockSize']]) for i in range(0, len(data), integrity['blockSize'])]
                # Electron records one empty block for an empty file.
                if not blocks:
                    blocks = [sha(b'')]
                need(blocks == integrity['blocks'], 'ASAR block integrity differs')
            entry['sha256'] = digest
            leaves.append(entry)

    walk(tree)
    ranges.sort()
    need(all(left[1] <= right[0] for left, right in zip(ranges, ranges[1:])), 'Overlapping packed ASAR files')
    need(sum(x['size'] for x in leaves) <= 512 * 1024 * 1024, 'ASAR extraction byte cap')
    by_name = {row['path']: row for row in leaves}
    package = by_name.get('package.json')
    need(package is not None and not package['unpacked'], 'Packed package.json required')
    start = package['archiveOffset']
    pkg = json_bytes(body[start:start + package['size']])
    need(isinstance(pkg, dict) and pkg.get('name') == 'xjy-jewelry-offline' and
         pkg.get('version') == '1.6.2' and pkg.get('main') == 'release-entry.cjs', 'ASAR package identity differs')
    migrations = sorted(x['path'] for x in leaves if x['path'].startswith('migrations/'))
    need(len(migrations) == 10 and [name.split('/')[1][:4] for name in migrations] ==
         ['%04d' % i for i in range(10)], 'Only original 0000-0009 migrations are permitted')
    return sorted(leaves, key=lambda row: row['path']), sorted(directories), migrations


def mkdir_new(path):
    ordinary(path.parent)
    need(not os.path.lexists(path), 'CreateNew directory already exists: ' + str(path))
    path.mkdir()
    ordinary(path)


def make_parents(path):
    need(path.is_relative_to(OUTPUT), 'Output escape refused')
    for parent in reversed(path.parents):
        if parent == OUTPUT or parent.is_relative_to(OUTPUT):
            if os.path.lexists(parent):
                ordinary(parent)
            else:
                mkdir_new(parent)


def write_new(relative, body):
    name = safe_relative(relative)
    target = OUTPUT / name
    make_parents(target)
    ordinary(target.parent)
    need(not os.path.lexists(target), 'CreateNew file already exists: ' + name)
    flags = os.O_WRONLY | os.O_CREAT | os.O_EXCL | getattr(os, 'O_BINARY', 0) | getattr(os, 'O_NOFOLLOW', 0)
    fd = os.open(target, flags, 0o600)
    try:
        with os.fdopen(fd, 'wb', closefd=False) as stream:
            stream.write(body)
            stream.flush()
            os.fsync(fd)
        need(os.fstat(fd).st_nlink == 1 and os.fstat(fd).st_size == len(body), 'Output handle differs')
    finally:
        os.close(fd)
    record = {'path': name, 'size': len(body), 'sha256': sha(body)}
    read_stable(target, record)
    return record


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--self-sha256', required=True, help='Root-reviewed SHA256 of this exact tool')
    args = parser.parse_args()
    need(os.name == 'nt' and os.path.normcase(os.path.abspath(__file__)) == os.path.normcase(str(SELF)),
         'Fixed Windows maintenance tool location required')
    need(HEX.fullmatch(args.self_sha256 or ''), 'Exact reviewed self SHA required')
    self_body = read_stable(SELF, limit=1024 * 1024)
    need(sha(self_body) == args.self_sha256, 'Tool self SHA differs')
    ordinary(ROOT)
    ordinary(OUTPUT.parent)
    need(not os.path.lexists(OUTPUT), 'Output already exists; never replace or merge')
    reference_body = read_stable(REFERENCE, limit=4 * 1024 * 1024)
    need(sha(reference_body) == REFERENCE_SHA, 'Frozen installed 1.6.2 manifest differs')
    resources = resource_manifest(reference_body)
    archive = check_resources(resources)
    entries, directories, migrations = asar_files(archive, resources)
    # All source/ASAR preconditions above complete before the first output write.
    mkdir_new(OUTPUT)
    outputs = []
    write_new('evidence/original-release-manifest.json', reference_body)
    for name, row in sorted(resources.items()):
        result = write_new('baseline/' + name, read_stable(SOURCE / name, row))
        result['origin'] = {'kind': 'fixed-resource', 'path': name, 'sha256': row['sha256']}
        outputs.append(result)
    for name in directories:
        directory = OUTPUT / 'project/desktop' / name
        make_parents(directory / '.directory-placeholder')
    for entry in entries:
        if entry['unpacked']:
            name = entry['resourcePath']
            body = read_stable(SOURCE / name, resources[name])
            origin = {'kind': 'pinned-unpacked-resource', 'path': name, 'asarSha256': ASAR_SHA}
        else:
            start = entry['archiveOffset']
            body = archive[start:start + entry['size']]
            origin = {'kind': 'packed-asar-entry', 'path': entry['path'], 'archiveOffset': start, 'asarSha256': ASAR_SHA}
        need(len(body) == entry['size'] and sha(body) == entry['sha256'], 'Extraction source differs')
        result = write_new('project/desktop/' + entry['path'], body)
        result['origin'] = origin
        outputs.append(result)
    evidence = {'path': 'evidence/original-release-manifest.json', 'size': len(reference_body), 'sha256': REFERENCE_SHA,
                'origin': {'kind': 'fixed-reference', 'path': REFERENCE.relative_to(ROOT).as_posix()}}
    outputs.append(evidence)
    # Recheck both sources and every generated byte before emitting completion.
    need(read_stable(REFERENCE, limit=4 * 1024 * 1024) == reference_body and
         read_stable(SELF, limit=1024 * 1024) == self_body, 'Tool/reference changed during projection')
    need(check_resources(resources) == archive, 'Resources changed during projection')
    names, dirs = inventory(OUTPUT)
    expected_names = {row['path'] for row in outputs}
    allowed_dirs = expected_directories(expected_names) | {'project/desktop/' + name for name in directories}
    need(set(names) == expected_names and set(dirs) == allowed_dirs, 'Unexpected projection files/directories')
    for row in outputs:
        read_stable(OUTPUT / row['path'], row)
    manifest = {'version': 1, 'purpose': 'desktop-first170-unmodified-source-projection',
                'complete': True, 'createdAt': datetime.datetime.now(datetime.timezone.utc).isoformat(),
                'toolSha256': args.self_sha256, 'sourceVersion': '1.6.2', 'targetVersionChanged': False,
                'businessBytesChanged': False, 'releaseReady': False, 'productExecuted': False,
                'databaseAccessed': False, 'productionAccessed': False, 'guestAccessed': False,
                'sourceResources': SOURCE.relative_to(ROOT).as_posix(),
                'referenceManifest': {'path': REFERENCE.relative_to(ROOT).as_posix(), 'sha256': REFERENCE_SHA},
                'resourceCount': RESOURCE_COUNT, 'resourceBytes': RESOURCE_BYTES,
                'asar': {'sha256': ASAR_SHA, 'size': ASAR_SIZE, 'fileCount': len(entries), 'migrations': migrations},
                'limits': 'ASAR-derived runtime sources and original compiled bundles; not the original TypeScript source tree. '
                          'No business patch, new migration, version edit, signing, release package or installation.',
                'outputs': sorted(outputs, key=lambda row: row['path']),
                'outputFileCountExcludingThisManifest': len(outputs), 'manifestSelfHashExcluded': True}
    encoded = (json.dumps(manifest, ensure_ascii=False, indent=2) + '\n').encode('utf-8')
    saved = write_new('projection-manifest.json', encoded)
    print(json.dumps({'complete': True, 'directory': str(OUTPUT), 'resourceCount': RESOURCE_COUNT,
                      'asarFileCount': len(entries), 'manifest': saved, 'releaseReady': False}, ensure_ascii=False))


if __name__ == '__main__':
    try:
        main()
    except Exception as error:
        print(json.dumps({'complete': False, 'releaseReady': False, 'error': str(error),
                          'partialOutputRetained': os.path.lexists(OUTPUT)}, ensure_ascii=False), file=sys.stderr)
        sys.exit(1)
