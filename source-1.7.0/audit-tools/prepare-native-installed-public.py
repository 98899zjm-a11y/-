"""Fixed Host public-data preparer. Never imports or executes any product payload."""
import argparse
import base64
from contextlib import contextmanager
import hashlib
import json
import os
from pathlib import Path
import re
import stat
import struct
import sys
import zipfile
import zlib

ROOT = Path('E:/codex/2026-10-15/work/xjy-v16-deep-audit')
ENGINE = Path('E:/codex/2026-10-13/work/xjy-web-stage1/sandbox/input/package-v10/release-candidate')
SELF = ROOT / 'audit-tools/prepare-native-installed-public.py'
OUTPUT = ROOT / 'sandbox/input/native-installed-162-a1/public-materials'
PURPOSE = 'native-installed-162-fixed-public-materials-v1'
CHUNK, MAX_FILE, JSON_LIMIT = 1048576, 805306368, 2097152
SHA = re.compile(r'[0-9a-f]{64}\Z')
PUBLISHER = '6e8b9cadb59aeb53f30d41f4471f70f644f0dfc7376ffb9d8a4c62defb98458c'
ENGINE_SHA = '6893a279e6ab2ccaae36c9c66fd8c840ef4dacddc9cd9c78c24f87dd3f311ea4'
EXE = {'path': '鑫金源珠宝报价.exe', 'size': 246302720,
       'sha256': 'db3ad2066a55546f9b6737da3c7f011370e4856fb36888055b544d45653e4f40'}
PEM_SHA = 'bc6c3d2b42871e42d3eb91371034b410d507a228eeccb1d714acca60e8141b30'
HOST_POLICY = ('release-work/initial-162-host-source-policy-envelope-a1.json',
               '0b4e2648ca69487a0c05cc595f0927282dc935c25806d942ff706d0da4111a49')
# Pins: release-161-signed-feed-a1, employee-real161-offline-a1, and
# release-162-signed-feed-a1 reports; original manifests and reviewed engine list.
VERSIONS = {
    '161': {'version': '1.6.1', 'sequence': 3, 'sources': ['1.6.0', '1.6.1'],
            'manifest': 'sandbox/results/release-161-artifact-a1/release-manifest.json',
            'manifestSha256': 'e1ff037d5fdb819561719c44487455c676fb90f8e8c18ff54509fbe155828095',
            'catalog': 'b39a6fda20b038149601177f5af03849efb820548ce15076b87dc8713b726881',
            'envelope': '68255c8157b5be98bba5c3376a3b06605272123a3536638a74b1fd713d2257e8',
            'envelopeSize': 195265,
            'archive': {'size': 163493271, 'sha256': '7cb1035c24beb114d890c6088a827e41a6ae77cab3d039e767ffb843303f13c6'},
            'asar': '7e4b04ef51c741f7da66da7e55cd5a280b792f32cd0a0fe8d19606f0996de07d'},
    '162': {'version': '1.6.2', 'sequence': 8, 'sources': ['1.6.1', '1.6.2'],
            'manifest': 'sandbox/results/post161-session-a1/release-162-artifact-a2/release-manifest.json',
            'manifestSha256': 'fe20ea7d83f2e2200624bf81364078ca8b206d1efcc8dbad03b1841d0fab9da2',
            'catalog': 'e4e294fa7e56641636e75c6c5417ff10dafaf4dae41664e858c7e667793d1ac5',
            'envelope': '1b40a19c9ba5ba9f5fded9123173682246a12d0982287fc4c34db1ce68db3fc8',
            'envelopeSize': 195264,
            'archive': {'size': 163521368, 'sha256': 'f629a566956b87f6041e8428ee1747d108f7620e7ef4c1f2648b8f9dd57eaea6'},
            'asar': '02a3dc5128203889fa88205020c39970f08305b4496e64507ca5ec5eab7f7568'},
}


def need(value, code):
    if not value:
        raise RuntimeError(code)


def digest(body):
    return hashlib.sha256(body).hexdigest()


def safe_name(name):
    need(isinstance(name, str) and 0 < len(name.encode('utf-8')) <= 1024
         and not re.search(r'[\\:*?"<>|\x00-\x1f]', name), 'UNSAFE_RELATIVE_NAME')
    for part in name.split('/'):
        need(part and part not in ('.', '..') and not part.endswith(('.', ' '))
             and not re.match(r'(?i)^(con|prn|aux|nul|com[1-9]|lpt[1-9])(?:\.|$)', part), 'UNSAFE_NAME_SEGMENT')
    return name


def ordinary(file, boundary=ROOT, directory=False):
    file = Path(file)
    need(boundary in (ROOT, ENGINE) and file.is_absolute() and file.is_relative_to(boundary)
         and not str(file).startswith(('\\\\', '//')), 'FIXED_LOCAL_BOUNDARY_REQUIRED')
    for part in file.parts[1:]:
        safe_name(part)
    for item in (file, *file.parents):
        info = item.lstat()
        need(info.st_ino != 0 and not stat.S_ISLNK(info.st_mode)
             and not getattr(info, 'st_file_attributes', 0) & 0x400, 'ALIAS_OR_REPARSE_REFUSED')
        need(os.path.normcase(os.path.realpath(item)) == os.path.normcase(str(item)), 'NONCANONICAL_PATH')
        if item == file:
            need(stat.S_ISDIR(info.st_mode) if directory else stat.S_ISREG(info.st_mode) and info.st_nlink == 1,
                 'ORDINARY_FILE_OR_DIRECTORY_REQUIRED')
        else:
            need(stat.S_ISDIR(info.st_mode), 'ORDINARY_ANCESTOR_REQUIRED')
    return file


def identity(info, cross_api=False):
    # Windows path-stat synthesizes executable bits by filename; fd-stat does not.
    mode = info.st_mode & ~0o111 if cross_api and os.name == 'nt' else info.st_mode
    fields = (info.st_dev, info.st_ino, mode, info.st_size, info.st_mtime_ns, info.st_nlink)
    return fields if cross_api else fields + (info.st_ctime_ns, getattr(info, 'st_file_attributes', None))


@contextmanager
def stable_reader(file, boundary=ROOT):
    file = ordinary(file, boundary)
    named = file.lstat()
    with file.open('rb') as stream:
        opened = os.fstat(stream.fileno())
        need(identity(named, True) == identity(opened, True), 'INPUT_OPEN_CHANGED')
        yield stream, opened
        need(identity(os.fstat(stream.fileno())) == identity(opened), 'INPUT_HANDLE_CHANGED')
    need(identity(ordinary(file, boundary).lstat()) == identity(named), 'INPUT_PATH_CHANGED')


class Tracker:
    def __init__(self):
        self.files = {}

    def read(self, file, pin=None, boundary=ROOT, collect=False):
        before = identity(ordinary(file, boundary).lstat())
        with stable_reader(file, boundary) as (stream, info):
            need(0 <= info.st_size <= (JSON_LIMIT if collect else MAX_FILE), 'INPUT_SIZE_LIMIT')
            h, chunks, total = hashlib.sha256(), [], 0
            while block := stream.read(CHUNK):
                h.update(block)
                total += len(block)
                if collect:
                    chunks.append(block)
            need(total == info.st_size, 'INPUT_READ_SIZE_CHANGED')
        record = {'size': total, 'sha256': h.hexdigest()}
        need(pin is None or SHA.fullmatch(pin) and record['sha256'] == pin, 'FIXED_INPUT_SHA_MISMATCH')
        snapshot = (record, before, boundary)
        need(file not in self.files or self.files[file] == snapshot, 'INPUT_SNAPSHOT_CHANGED')
        self.files[file] = snapshot
        return b''.join(chunks) if collect else record

    def recheck(self):
        for file, (record, state, boundary) in list(self.files.items()):
            need(identity(ordinary(file, boundary).lstat()) == state, 'FINAL_INPUT_IDENTITY_CHANGED')
            need(self.read(file, boundary=boundary) == record, 'FINAL_INPUT_SHA_CHANGED')


def parse(body):
    def unique(pairs):
        result = {}
        for key, value in pairs:
            need(key not in result, 'DUPLICATE_JSON_KEY')
            result[key] = value
        return result
    return json.loads(body.decode('utf-8'), object_pairs_hook=unique,
                      parse_constant=lambda value: (_ for _ in ()).throw(ValueError('Nonfinite JSON')))


def rows(values, count, resources=False):
    need(isinstance(values, list) and len(values) == count, 'EXACT_FILE_COUNT_REQUIRED')
    answer = []
    for value in values:
        need(isinstance(value, dict) and {'path', 'size', 'sha256'} <= set(value), 'FILE_ROW_REQUIRED')
        name = safe_name(value['path'])
        need(type(value['size']) is int and 0 <= value['size'] <= MAX_FILE
             and isinstance(value['sha256'], str) and SHA.fullmatch(value['sha256']), 'FILE_SIZE_OR_SHA_REQUIRED')
        parts = name.split('/')
        need(not any(re.fullmatch(r'data|configs?|profiles?|runtime|cache|logs?|backups?|private|legacy-source', p, re.I)
                     for p in parts) and not re.search(r'\.(?:db(?:-wal|-shm)?|sqlite3?(?:-wal|-shm)?|key|pem|pfx|xjybak)$', name, re.I)
             and not re.search(r'(?:^|/)(?:accounts?|credentials|xjy-install-activation|recovery-pointer)\.json$', name, re.I),
             'NONPROGRAM_PATH_REFUSED')
        if resources:
            need(name in ('resources/app.asar', 'resources/app.asar.unpacked/ocr.winrt.ps1')
                 or name.startswith(('resources/release-modules/', 'resources/print-dependencies/node_modules/', 'resources/update-helper/')),
                 'PROGRAM_RESOURCE_REQUIRED')
        else:
            need(not name.startswith('resources/'), 'ENGINE_ONLY_REQUIRED')
        answer.append({key: value[key] for key in ('path', 'size', 'sha256')})
    need(len({value['path'].casefold() for value in answer}) == count
         and sum(value['size'] for value in answer) <= 1073741824, 'DUPLICATE_OR_OVERSIZED_TREE')
    return sorted(answer, key=lambda value: value['path'].encode('utf-16-be'))


def ensure_parents(file):
    cursor = ROOT
    ordinary(cursor, directory=True)
    for part in file.relative_to(ROOT).parts[:-1]:
        cursor /= part
        if not os.path.lexists(cursor):
            cursor.mkdir()
        ordinary(cursor, directory=True)


def write_stream(name, content, expected, outputs):
    file = OUTPUT / safe_name(name)
    need(not os.path.lexists(file), 'CREATE_NEW_FILE_REQUIRED')
    ensure_parents(file)
    h, total, crc = hashlib.sha256(), 0, 0
    with file.open('xb') as target:
        opened = os.fstat(target.fileno())
        need(stat.S_ISREG(opened.st_mode) and opened.st_nlink == 1, 'NEW_OUTPUT_HANDLE_REQUIRED')
        while block := content.read(CHUNK):
            need(total != 0 or not block.startswith(b'SQLite format 3\x00'), 'SQLITE_CONTENT_REFUSED')
            total += len(block)
            need(total <= expected['size'], 'OUTPUT_SIZE_BOUND')
            need(target.write(block) == len(block), 'SHORT_OUTPUT_WRITE')
            h.update(block)
            crc = zlib.crc32(block, crc)
        target.flush()
        os.fsync(target.fileno())
        current = os.fstat(target.fileno())
        need((current.st_dev, current.st_ino) == (opened.st_dev, opened.st_ino)
             and identity(current, True) == identity(ordinary(file).lstat(), True), 'OUTPUT_IDENTITY_CHANGED')
    need({'size': total, 'sha256': h.hexdigest()} == expected, 'OUTPUT_SIZE_OR_SHA_MISMATCH')
    need(Tracker().read(file) == expected, 'OUTPUT_READBACK_MISMATCH')
    outputs.append({'path': name, **expected})
    return crc & 0xffffffff


def write_bytes(name, body, outputs):
    import io
    write_stream(name, io.BytesIO(body), {'size': len(body), 'sha256': digest(body)}, outputs)


def at(stream, offset, size):
    need(0 <= offset and 0 <= size <= JSON_LIMIT, 'ZIP_HEADER_BOUND')
    stream.seek(offset)
    value = stream.read(size)
    need(len(value) == size, 'TRUNCATED_ZIP_HEADER')
    return value


def archive(version, specs, outputs=None):
    pin = VERSIONS[version]
    file = ROOT / f'release-work/initial-{version}-feed-a1/package.zip'
    with stable_reader(file) as (stream, info):
        need(info.st_size == pin['archive']['size'], 'ZIP_SIZE_CHANGED')
        end = struct.unpack('<4s4H2IH', at(stream, info.st_size - 22, 22))
        need(end[0] == b'PK\x05\x06' and end[1:5] == (0, 0, 1007, 1007) and end[7] == 0,
             'EXACT_ZIP_EOCD_REQUIRED')
        central_size, central_at = end[5:7]
        need(central_size <= JSON_LIMIT and central_at + central_size == info.st_size - 22, 'ZIP_CENTRAL_BOUNDS')
        with zipfile.ZipFile(stream, 'r', allowZip64=False) as package:
            members = package.infolist()
            need(len(members) == 1007 and package.comment == b'' and package.start_dir == central_at
                 and [member.filename for member in members] == [value['path'] for value in specs], 'EXACT_ZIP_MEMBERS_REQUIRED')
            local_at, cursor = 0, central_at
            for member, spec in zip(members, specs):
                name = safe_name(member.filename)
                need(not member.is_dir() and member.flag_bits == 0x800 and member.compress_type == zipfile.ZIP_STORED
                     and member.file_size == member.compress_size == spec['size'] and not member.extra and not member.comment
                     and member.header_offset == local_at and stat.S_IFMT(member.external_attr >> 16) == stat.S_IFREG,
                     'ZIP_MEMBER_LINK_EXTRA_OR_COMPRESSION_REFUSED')
                encoded = name.encode('utf-8')
                central = struct.unpack('<4s6H3I5H2I', at(stream, cursor, 46))
                need(central[0] == b'PK\x01\x02' and central[1:7] == (0x314, 20, 0x800, 0, 0, 0)
                     and central[7:10] == (member.CRC, spec['size'], spec['size'])
                     and central[10:15] == (len(encoded), 0, 0, 0, 0) and central[15:] == (0x80000000, local_at)
                     and at(stream, cursor + 46, len(encoded)) == encoded, 'ZIP_CENTRAL_HEADER_CHANGED')
                local = struct.unpack('<4s5H3I2H', at(stream, local_at, 30))
                need(local[0] == b'PK\x03\x04' and local[1:6] == (20, 0x800, 0, 0, 0)
                     and local[6:9] == (member.CRC, spec['size'], spec['size']) and local[9:] == (len(encoded), 0)
                     and at(stream, local_at + 30, len(encoded)) == encoded, 'ZIP_LOCAL_HEADER_CHANGED')
                data_at = local_at + 30 + len(encoded)
                need(data_at + spec['size'] <= central_at, 'ZIP_OVERLAPPING_DATA')
                total, crc, h = 0, 0, hashlib.sha256()
                with package.open(member, 'r') as content:
                    if outputs is not None:
                        crc = write_stream(f'v{version}/{name}', content, {key: spec[key] for key in ('size', 'sha256')}, outputs)
                        need(crc == member.CRC, 'EXTRACTED_MEMBER_CRC_MISMATCH')
                    else:
                        while block := content.read(CHUNK):
                            total += len(block)
                            need(total <= spec['size'], 'ZIP_EXPANSION_BOUND')
                            crc = zlib.crc32(block, crc)
                            h.update(block)
                        need(total == spec['size'] and h.hexdigest() == spec['sha256']
                             and crc & 0xffffffff == member.CRC, 'ZIP_MEMBER_CRC_OR_SHA_MISMATCH')
                local_at, cursor = data_at + spec['size'], cursor + 46 + len(encoded)
            need(local_at == central_at and cursor == central_at + central_size, 'ZIP_EXTRA_BYTES_OR_GAPS')


def exact_output(outputs):
    wanted = {value['path'] for value in outputs}
    directories = {'/'.join(name.split('/')[:i]) for name in wanted for i in range(1, len(name.split('/')))}
    found, seen_dirs = set(), set()
    def walk(directory):
        for entry in os.scandir(directory):
            file = Path(entry.path)
            rel = file.relative_to(OUTPUT).as_posix()
            is_dir = stat.S_ISDIR(file.lstat().st_mode)
            ordinary(file, directory=is_dir)
            if is_dir:
                need(rel in directories, 'EXTRA_OUTPUT_DIRECTORY')
                seen_dirs.add(rel)
                walk(file)
            else:
                need(rel in wanted, 'EXTRA_OUTPUT_FILE')
                found.add(rel)
    walk(ordinary(OUTPUT, directory=True))
    need(found == wanted and seen_dirs == directories, 'INCOMPLETE_OUTPUT_TREE')
    for value in outputs:
        need(Tracker().read(OUTPUT / value['path']) == {key: value[key] for key in ('size', 'sha256')}, 'FINAL_OUTPUT_CHANGED')


def main():
    parser = argparse.ArgumentParser(allow_abbrev=False)
    parser.add_argument('--source-sha256', required=True)
    mode = parser.add_mutually_exclusive_group(required=True)
    mode.add_argument('--check-only', action='store_true')
    mode.add_argument('--prepare-public-materials', action='store_true')
    args = parser.parse_args()
    need(os.name == 'nt' and Path(__file__).absolute() == SELF and SHA.fullmatch(args.source_sha256), 'FIXED_HOST_SOURCE_REQUIRED')
    tracker = Tracker()
    tracker.read(SELF, args.source_sha256)
    need(not os.path.lexists(OUTPUT), 'CREATE_NEW_OUTPUT_REQUIRED')
    metadata, resources = {}, {}
    engine_body = tracker.read(ENGINE / 'engine-allowlist.json', ENGINE_SHA, ENGINE, True)
    engine_value = parse(engine_body)
    need(engine_value.get('version') == 1 and engine_value.get('purpose') == 'reviewed-original-electron-engine'
         and engine_value.get('executableName') == EXE['path'], 'FIXED_ENGINE_ALLOWLIST_REQUIRED')
    engine = rows(engine_value.get('files'), 72)
    need(EXE in engine, 'FIXED_ORIGINAL_ENGINE_EXE_REQUIRED')
    metadata['engine-allowlist.json'] = engine_body
    for version, pin in VERSIONS.items():
        manifest_body = tracker.read(ROOT / pin['manifest'], pin['manifestSha256'], collect=True)
        manifest = parse(manifest_body)
        need(manifest.get('version') == 1 and manifest.get('product') == 'xjy-jewelry-offline'
             and manifest.get('programVersion') == pin['version'] and manifest.get('resourcesOnly') is True
             and manifest.get('fileCount') == 1007, 'FIXED_RESOURCE_MANIFEST_REQUIRED')
        specs = rows(manifest.get('files'), 1007, True)
        need(next(value for value in specs if value['path'] == 'resources/app.asar')['sha256'] == pin['asar'], 'FIXED_ASAR_REQUIRED')
        feed = ROOT / f'release-work/initial-{version}-feed-a1'
        envelope_body = tracker.read(feed / 'catalog.json', pin['envelope'], collect=True)
        need(len(envelope_body) == pin['envelopeSize'], 'CATALOG_ENVELOPE_SIZE')
        envelope = parse(envelope_body)
        need(set(envelope) == {'catalog', 'signature'} and isinstance(envelope['catalog'], str)
             and digest(envelope['catalog'].encode('utf-8')) == pin['catalog']
             and len(base64.b64decode(envelope['signature'], validate=True)) == 64, 'PINNED_SIGNED_ENVELOPE_REQUIRED')
        catalog = parse(envelope['catalog'].encode('utf-8'))
        need(catalog.get('schemaVersion') == 1 and catalog.get('app') == 'xjy-jewelry-offline'
             and catalog.get('channel') == 'stable' and catalog.get('version') == pin['version']
             and catalog.get('platform') == 'win32' and catalog.get('arch') == 'x64'
             and catalog.get('sequence') == pin['sequence'] and catalog.get('sourceVersions') == pin['sources']
             and catalog.get('archive') == pin['archive'] and rows(catalog.get('files'), 1007, True) == specs,
             'CATALOG_MANIFEST_MISMATCH')
        need(tracker.read(feed / 'package.zip', pin['archive']['sha256']) == pin['archive'], 'PINNED_ZIP_REQUIRED')
        pem = tracker.read(feed / 'publisher-public.pem', PEM_SHA, collect=True)
        need(len(pem) == 113 and pem.startswith(b'-----BEGIN PUBLIC KEY-----\n') and pem.endswith(b'-----END PUBLIC KEY-----\n')
             and digest(base64.b64decode(b''.join(pem.splitlines()[1:-1]), validate=True)) == PUBLISHER, 'PUBLIC_KEY_PIN_REQUIRED')
        metadata['publisher-public.pem'] = pem
        metadata[f'{version}-catalog.json'] = envelope_body
        metadata[f'{version}-release-manifest.json'] = manifest_body
        resources[version] = specs
    metadata['162-source-policy-envelope.json'] = tracker.read(ROOT / HOST_POLICY[0], HOST_POLICY[1], collect=True)
    for value in engine:
        need(tracker.read(ENGINE / value['path'], value['sha256'], ENGINE)
             == {key: value[key] for key in ('size', 'sha256')}, 'ENGINE_FILE_MISMATCH')
    for version, specs in resources.items():
        archive(version, specs)
    tracker.recheck()
    if args.check_only:
        print(json.dumps({'purpose': PURPOSE, 'checked': True, 'prepared': False, 'engineFiles': 72,
                          'resourceFilesPerVersion': 1007, 'catalogSignaturesVerifiedByThisTool': False,
                          'programExecuted': False, 'databaseOpened': False, 'privateKeyRead': False}))
        return 0
    ensure_parents(OUTPUT)
    ordinary(OUTPUT.parent, directory=True)
    need(not os.path.lexists(OUTPUT), 'CREATE_NEW_OUTPUT_REQUIRED')
    OUTPUT.mkdir()
    ordinary(OUTPUT, directory=True)
    outputs = []
    for name, body in sorted(metadata.items()):
        write_bytes('metadata/' + name, body, outputs)
    for value in engine:
        with stable_reader(ENGINE / value['path'], ENGINE) as (stream, _):
            write_stream('engine/' + value['path'], stream, {key: value[key] for key in ('size', 'sha256')}, outputs)
    for version, specs in resources.items():
        archive(version, specs, outputs)
    with stable_reader(ROOT / 'release-work/initial-162-feed-a1/package.zip') as (stream, _):
        write_stream('metadata/feed162-package.zip', stream, VERSIONS['162']['archive'], outputs)
    tracker.recheck()
    exact_output(outputs)
    manifest = {'version': 1, 'purpose': PURPOSE, 'sourceSha256': args.source_sha256,
                'engineAllowlistSha256': ENGINE_SHA, 'engineFileCount': 72,
                'resourceFileCounts': {'1.6.1': 1007, '1.6.2': 1007},
                'inputPins': VERSIONS, 'files': sorted(outputs, key=lambda value: value['path'].encode('utf-16-be')),
                'catalogSignaturesVerifiedByThisTool': False, 'programExecuted': False,
                'databaseOpened': False, 'privateKeyRead': False, 'failedOutputsPreserved': True}
    body = (json.dumps(manifest, ensure_ascii=False, sort_keys=True, indent=2, allow_nan=False) + '\n').encode('utf-8')
    write_bytes('material-manifest.json', body, outputs)
    exact_output(outputs)
    print(json.dumps({'purpose': PURPOSE, 'prepared': True, 'output': str(OUTPUT),
                      'sourceSha256': args.source_sha256, 'materialManifestSha256': digest(body),
                      'outputFiles': len(outputs), 'outputBytes': sum(value['size'] for value in outputs),
                      'engineFiles': 72, 'resourceFilesPerVersion': 1007,
                      'programExecuted': False, 'databaseOpened': False, 'privateKeyRead': False,
                      'catalogSignaturesVerifiedByThisTool': False, 'failedOutputsPreserved': True}))
    return 0


if __name__ == '__main__':
    try:
        raise SystemExit(main())
    except Exception as error:
        print(json.dumps({'purpose': PURPOSE, 'prepared': False, 'error': str(error), 'programExecuted': False,
                          'databaseOpened': False, 'privateKeyRead': False, 'failedOutputsPreserved': True}), file=sys.stderr)
        raise SystemExit(1)
