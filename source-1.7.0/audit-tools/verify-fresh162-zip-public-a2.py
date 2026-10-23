"""Root-only fixed public ZIP/tree integrity review. Source draft; never imports product code."""
import sys
sys.dont_write_bytecode = True

from pathlib import Path
import argparse
import base64
import hashlib
import json
import os
import re
import stat
import struct
import zipfile
import zlib
from contextlib import contextmanager
from datetime import datetime, timezone


ROOT = Path(r'E:\codex\2026-10-15\work\xjy-v16-deep-audit')
SELF = ROOT / 'audit-tools/verify-fresh162-zip-public-a2.py'
ENGINE = Path(r'E:\codex\2026-10-13\work\xjy-web-stage1\sandbox\input\package-v10\release-candidate')
EXPORT = ROOT / 'sandbox/results/post161-session-a1/release-162-artifact-a2'
FEED = ROOT / 'release-work/initial-162-feed-a1'
OUTPUT = ROOT / 'release-work/initial-fresh-employee-162-package-a1'
ARCHIVE = ROOT / 'release/initial-fresh-employee-162-a1.zip'
BUILD_REPORT = ROOT / 'reports/fresh-employee-wrapper-162-build-a1.json'
FEED_REPORT = ROOT / 'reports/release-162-signed-feed-a1.json'
PROPOSAL = ROOT / 'release-work/initial-162-fresh-wrapper-proposal-a1.json'
RESULT = ROOT / 'reports/fresh162-zip-public-verify-20261019-a2.json'
TRUST_NAME = '安装组件/delivery-tools/fresh-employee-trust.json'
PS_NAME = '安装组件/fresh-employee-wrapper.ps1'
CMD_NAME = '安装员工端.cmd'
EXE_NAME = '鑫金源珠宝报价.exe'
PUBLISHER = '6e8b9cadb59aeb53f30d41f4471f70f644f0dfc7376ffb9d8a4c62defb98458c'
SHA = re.compile(r'[a-f0-9]{64}\Z')
CHUNK = 1024 * 1024
MAX_FILE = 1073741824
PINS = {
    'audit-tools/build-fresh-employee-wrapper-162.cjs': '639d70867f058b4a78b5b2cfb45043659d331c62675081ab3c591c799a0d26fe',
    'audit-tools/fresh-employee-wrapper-162.ps1.in': '882e586c3ca01d2f376b5160bf657b6a28c40864e3fe7a16d3c285f53457526b',
    'delivery-tools/Initial-Path-Guard.ps1': '4b51ba8e7300e0ce8875dcb2a3b060622d84f81459b8cc758d16c4f94eb3f8d7',
    'delivery-tools/fresh-employee-install.cjs': '2b4652f6b0ed33d6ef71e3330e74ce2f083de5aafcbb6f56c2c9b18f3537e65c',
    'delivery-tools/initial-patch-core.cjs': '0f9de31c8ad8ec7e1b870a92d025909f4606363801a31ee3582b903c5704bbce',
    'delivery-tools/initial-patch-entry.cjs': '4c0008c6f070c22255f3a2819ac82e9be774fbaf631030bb414c95bbcac6b161',
    'project/desktop/employee-update-cache.cjs': '5cb70079bf161a002a2701694e4774c2a11bf8d54efc6674ccb5c7b2c6729815',
    'project/desktop/employee-update-installer.cjs': '96ba3df08a0f706e599da7d452374b1f894d401c0a6ff605fc01255d01445bd0',
    'stage1/build-initial-patch.cjs': 'f540ab35e1fccac96234f0ef63b652347e54c726c93ff6e210dec2d3d3414abb',
}
PROPOSAL_SHA = '5af6ff8fa8a4b7ae7a482cd9ae3f999a53d3025fe308b2d409f393e668528773'
BUILD_SHA = 'e0d900767151946d48bfd135357f925235caed7cd61a7f42c7a69d1f6dd06b10'
ZIP_IDENTITY = {'size': 549676102, 'sha256': '76560242fa5a7ab8f4a7a03b5bd879319671b6bf12aa1f3735312bd1b96926a3'}
MANIFEST_SHA = 'fe20ea7d83f2e2200624bf81364078ca8b206d1efcc8dbad03b1841d0fab9da2'
PROOF_SHA = '1a1e0aa79ec55125c847bb6c4151b24e7807c733397ba7d58b526c420ece26c7'
ENGINE_SHA = '6893a279e6ab2ccaae36c9c66fd8c840ef4dacddc9cd9c78c24f87dd3f311ea4'
ASAR_SHA = '02a3dc5128203889fa88205020c39970f08305b4496e64507ca5ec5eab7f7568'
TOOLS = [
    'delivery-tools/fresh-employee-install.cjs', 'delivery-tools/initial-patch-core.cjs',
    'delivery-tools/initial-patch-entry.cjs', 'project/desktop/employee-update-cache.cjs',
    'project/desktop/employee-update-installer.cjs',
]


def need(value, code):
    if not value:
        raise RuntimeError(code)


def digest(body):
    return hashlib.sha256(body).hexdigest()


def compact(value):
    return json.dumps(value, ensure_ascii=False, separators=(',', ':'), allow_nan=False).encode('utf-8')


def pretty(value):
    return (json.dumps(value, ensure_ascii=False, indent=2, allow_nan=False) + '\n').encode('utf-8')


def ordinal(name):
    return name.encode('utf-16-be')


def unique_object(pairs):
    result = {}
    for key, value in pairs:
        need(key not in result, 'DUPLICATE_JSON_KEY')
        result[key] = value
    return result


def parse(body):
    return json.loads(body.decode('utf-8'), object_pairs_hook=unique_object,
                      parse_constant=lambda value: (_ for _ in ()).throw(ValueError('Nonfinite JSON')))


def safe_name(name):
    need(isinstance(name, str) and 0 < len(name) <= 1024 and not name.startswith('/'), 'BAD_MEMBER_NAME')
    need(not re.search(r'[\\:*?"<>|\x00-\x1f]', name), 'BAD_MEMBER_NAME')
    for part in name.split('/'):
        need(part and part not in ('.', '..') and not re.search(r'[. ]$', part)
             and not re.match(r'(?i)^(con|prn|aux|nul|com[1-9]|lpt[1-9])(?:\.|$)', part), 'BAD_MEMBER_SEGMENT')
    return name


def ordinary(value, boundary=ROOT, directory=False, missing=False):
    need(boundary in (ROOT, ENGINE), 'UNAPPROVED_BOUNDARY')
    file = Path(value)
    need(file.is_absolute() and file.is_relative_to(boundary), 'PATH_OUTSIDE_FIXED_BOUNDARY')
    need(not str(file).startswith(('\\\\', '//')) and ':' not in str(file)[2:], 'NONLOCAL_PATH')
    for part in file.parts[1:]:
        safe_name(part)
    found = False
    for item in (file, *file.parents):
        try:
            info = item.lstat()
        except FileNotFoundError:
            need(item == file and missing, 'MISSING_PARENT_OR_INPUT')
            continue
        need(not stat.S_ISLNK(info.st_mode) and not getattr(info, 'st_file_attributes', 0) & 0x400,
             'LINK_OR_REPARSE_PATH')
        need(os.path.normcase(os.path.realpath(item)) == os.path.normcase(str(item)), 'PATH_ALIAS')
        if item == file:
            need(stat.S_ISDIR(info.st_mode) if directory else stat.S_ISREG(info.st_mode) and info.st_nlink == 1,
                 'WRONG_FILE_TYPE_OR_HARDLINK')
        else:
            need(stat.S_ISDIR(info.st_mode), 'NON_DIRECTORY_ANCESTOR')
        if item == boundary:
            found = True
    need(found, 'FIXED_ROOT_MISSING')
    resolved = Path(os.path.realpath(file))
    need(resolved.is_relative_to(Path(os.path.realpath(boundary))), 'REALPATH_OUTSIDE_BOUNDARY')
    return file


def identity(info):
    return (info.st_dev, info.st_ino, info.st_mode, info.st_size,
            info.st_mtime_ns, info.st_ctime_ns, info.st_nlink)


def common_identity(info):
    # Windows Python path-stat/fd-stat ctime semantics can differ. Full same-API
    # snapshots remain checked; only cross-API comparison excludes ctime.
    # CPython Windows path-stat adds 0111 based on .exe/.cmd/.bat/.com;
    # fd-stat has no filename. Normalize only that cross-API synthetic flag.
    # identity() still compares every same-API mode bit before/after unchanged.
    mode = info.st_mode & ~0o111 if os.name == 'nt' else info.st_mode
    return (info.st_dev, info.st_ino, mode, info.st_size, info.st_mtime_ns, info.st_nlink)


@contextmanager
def stable_reader(file, boundary=ROOT):
    file = ordinary(file, boundary)
    named = file.lstat()
    with file.open('rb') as stream:
        opened = os.fstat(stream.fileno())
        need(common_identity(named) == common_identity(opened), 'INPUT_OPEN_CHANGED')
        yield stream, opened
        need(identity(os.fstat(stream.fileno())) == identity(opened), 'INPUT_HANDLE_CHANGED')
    ordinary(file, boundary)
    need(identity(file.lstat()) == identity(named), 'INPUT_PATH_CHANGED')


class Tracker:
    def __init__(self):
        self.files = {}

    def read(self, file, pin=None, boundary=ROOT, limit=None):
        file = Path(file)
        before_state = identity(ordinary(file, boundary).lstat())
        with stable_reader(file, boundary) as (stream, info):
            need(0 <= info.st_size <= (limit if limit is not None else MAX_FILE), 'INPUT_SIZE_BOUND')
            h = hashlib.sha256()
            chunks = [] if limit is not None else None
            while block := stream.read(CHUNK):
                h.update(block)
                if chunks is not None:
                    chunks.append(block)
        record = {'size': info.st_size, 'sha256': h.hexdigest()}
        if pin is not None:
            need(isinstance(pin, str) and SHA.fullmatch(pin) and record['sha256'] == pin, 'INPUT_SHA_MISMATCH')
        need(identity(ordinary(file, boundary).lstat()) == before_state, 'TRACKED_INPUT_CHANGED')
        snapshot = (record, before_state, boundary)
        if file in self.files:
            need(snapshot == self.files[file], 'REPEATED_INPUT_CHANGED')
        self.files[file] = snapshot
        return b''.join(chunks) if chunks is not None else record

    def metadata(self, file, pin=None, boundary=ROOT):
        return parse(self.read(file, pin, boundary, 2097152))

    def recheck(self):
        for file, (record, state, boundary) in list(self.files.items()):
            need(identity(ordinary(file, boundary).lstat()) == state, 'FINAL_INPUT_IDENTITY_CHANGED')
            need(self.read(file, boundary=boundary) == record, 'FINAL_INPUT_HASH_CHANGED')


def row(name, size, sha256):
    safe_name(name)
    need(type(size) is int and 0 <= size <= MAX_FILE and isinstance(sha256, str) and SHA.fullmatch(sha256),
         'INVALID_EXPECTED_ROW')
    return {'path': name, 'size': size, 'sha256': sha256}


def validate_rows(values, count):
    need(isinstance(values, list) and len(values) == count, 'EXPECTED_ROW_COUNT')
    result, folded = [], set()
    for value in values:
        need(isinstance(value, dict) and set(value) == {'path', 'size', 'sha256'}, 'EXACT_ROW_SHAPE')
        entry = row(value['path'], value['size'], value['sha256'])
        need(entry['path'].casefold() not in folded, 'EXPECTED_CASE_COLLISION')
        folded.add(entry['path'].casefold())
        result.append(entry)
    return result


def tree_hash(rows):
    return digest(''.join(f"{item['path']}\0{item['size']}\0{item['sha256']}\n"
                          for item in sorted(rows, key=lambda item: ordinal(item['path']))).encode('utf-8'))


def wrapper_bytes(template, guard, rows, trust_sha):
    text = template.decode('utf-8')
    for token, value in (
        ('@@PATH_GUARD@@', guard.decode('utf-8')),
        ('@@FILES_BASE64@@', base64.b64encode(compact(rows)).decode('ascii')),
        ('@@TRUST_SHA@@', trust_sha),
    ):
        need(text.count(token) == 1, 'EXACT_TEMPLATE_PLACEHOLDER_REQUIRED')
        text = text.replace(token, value)
    need('@@' not in text, 'UNKNOWN_TEMPLATE_PLACEHOLDER')
    ps = text.encode('utf-8')
    ps_sha = digest(ps)
    command = ("$p=Join-Path $env:XJY_FRESH_PACKAGE_ROOT '安装组件\\fresh-employee-wrapper.ps1';"
               "$b=[IO.File]::ReadAllBytes($p);$h=[Security.Cryptography.SHA256]::Create();"
               "try{$s=([BitConverter]::ToString($h.ComputeHash($b))).Replace('-','').ToLowerInvariant()}"
               "finally{$h.Dispose()};if($s -cne '" + ps_sha + "'){throw '安装包装器校验失败'};"
               "& ([ScriptBlock]::Create([Text.Encoding]::UTF8.GetString($b))) -PackageRoot $env:XJY_FRESH_PACKAGE_ROOT")
    cmd = ('@echo off\r\nchcp 65001 >nul\r\nsetlocal DisableDelayedExpansion\r\n'
           'set "XJY_FRESH_PACKAGE_ROOT=%~dp0"\r\n'
           '"C:\\Windows\\System32\\WindowsPowerShell\\v1.0\\powershell.exe" '
           '-NoLogo -NoProfile -NonInteractive -STA -Command "' + command + '"\r\n'
           'set "XJY_FRESH_EXIT=%ERRORLEVEL%"\r\nif not "%XJY_FRESH_EXIT%"=="0" pause\r\n'
           'endlocal & exit /b %XJY_FRESH_EXIT%\r\n').encode('utf-8')
    return ps, cmd


def fixed_inputs(tracker, options):
    need(options.approved_build_report_sha256 == BUILD_SHA, 'THIS_APPROVED_BUILD_REPORT_REQUIRED')
    tracker.read(SELF, options.source_sha256, limit=1048576)
    for relative, pin in PINS.items():
        tracker.read(ROOT / relative, pin, limit=2097152)
    build = tracker.metadata(BUILD_REPORT, options.approved_build_report_sha256)
    proposal = tracker.metadata(PROPOSAL, PROPOSAL_SHA)
    manifest = tracker.metadata(EXPORT / 'release-manifest.json', MANIFEST_SHA)
    proof = tracker.metadata(EXPORT / 'data-free-proof.json', PROOF_SHA)
    engine = tracker.metadata(ENGINE / 'engine-allowlist.json', ENGINE_SHA, ENGINE)
    need(build.get('purpose') == 'fresh-employee-162-zip-wrapper' and build.get('version') == 1
         and build.get('programVersion') == '1.6.2', 'EXACT_BUILD_REPORT_REQUIRED')
    need(build.get('sourceSha256') == PINS['audit-tools/build-fresh-employee-wrapper-162.cjs']
         and build.get('templateSha256') == PINS['audit-tools/fresh-employee-wrapper-162.ps1.in']
         and build.get('approvedProposalSha256') == PROPOSAL_SHA, 'BUILD_SOURCE_BINDING')
    need(build.get('directory') == str(OUTPUT) and build.get('archiveFile') == str(ARCHIVE), 'FIXED_BUILD_OUTPUT_REQUIRED')
    need(build.get('fileCount') == 1089 and build.get('engineFiles') == 72 and build.get('resourceFiles') == 1007
         and build.get('toolFiles') == TOOLS and build.get('sourceVersions') == ['1.6.1', '1.6.2'], 'BUILD_COUNT_OR_SCOPE')
    for key in ('published', 'installed', 'programExecuted', 'privateKeyRead', 'privateKeyIncluded',
                'executionPolicyChanged', 'outerAuthenticodeSigned'):
        need(build.get(key) is False, 'BUILD_EXECUTION_OR_SECRET_BOUNDARY')
    need(build.get('resourceCatalogSigned') is True and build.get('publisherPublicKeySha256') == PUBLISHER,
         'BUILD_PUBLIC_PUBLISHER_REQUIRED')
    need({key: build['archive'][key] for key in ('size', 'sha256')} == ZIP_IDENTITY, 'THIS_COMPLETE_ZIP_REQUIRED')
    need(proposal.get('purpose') == 'fresh-employee-162-wrapper-input-proposal'
         and proposal.get('status') == 'UNSIGNED_PROPOSAL_NOT_INSTALLABLE'
         and proposal.get('sourceSha256') == build['sourceSha256']
         and proposal.get('templateSha256') == build['templateSha256'], 'PROPOSAL_SOURCE_BINDING')
    need(manifest.get('programVersion') == '1.6.2' and manifest.get('resourcesOnly') is True
         and manifest.get('fileCount') == 1007 and manifest['asar']['sha256'] == ASAR_SHA
         and manifest['asar']['allEntriesExtracted'] is True and proof.get('files') == manifest['files']
         and proof.get('dataIncluded') is False and proof.get('signed') is False, 'FIXED_PUBLIC_A2_REQUIRED')
    resources = validate_rows(manifest['files'], 1007)
    engine_rows = validate_rows([{key: value[key] for key in ('path', 'size', 'sha256')}
                                 for value in engine['files']], 72)
    need(engine.get('executableName') == EXE_NAME and proposal['engineFiles'] == engine_rows
         and proposal['resourceFiles'] == resources, 'PROPOSAL_FILE_BINDING')
    exe = next(item for item in engine_rows if item['path'] == EXE_NAME)
    need(exe['size'] == 246302720 and exe['sha256'] == 'db3ad2066a55546f9b6737da3c7f011370e4856fb36888055b544d45653e4f40',
         'FIXED_PUBLIC_ENGINE_REQUIRED')
    for item in engine_rows:
        need(not re.search(r'(?i)(?:^|/)(?:resources|data|profiles?|private|credentials|backups?)(?:/|$)|\.(?:db|sqlite3?|pem|pfx|key)$', item['path']),
             'FORBIDDEN_ENGINE_MEMBER')
        ordinary(ENGINE.joinpath(*item['path'].split('/')), ENGINE)
    need(all(item['path'].startswith('resources/') for item in resources), 'RESOURCE_ONLY_ROWS')
    tools = validate_rows(proposal['tools'], 5)
    need([item['path'] for item in tools] == TOOLS, 'EXACT_HELPER_CLOSURE_REQUIRED')
    for item in tools:
        actual = tracker.read(ROOT.joinpath(*item['path'].split('/')))
        need(actual == {'size': item['size'], 'sha256': item['sha256']}, 'HELPER_BYTES_CHANGED')
    feed_report = tracker.metadata(FEED_REPORT, build['signedFeedReportSha256'])
    envelope_bytes = tracker.read(FEED / 'catalog.json', feed_report['catalogEnvelopeSha256'], limit=2097152)
    envelope = parse(envelope_bytes)
    need(set(envelope) == {'catalog', 'signature'} and isinstance(envelope['catalog'], str), 'EXACT_CATALOG_ENVELOPE')
    signature = base64.b64decode(envelope['signature'], validate=True)
    need(len(signature) == 64 and base64.b64encode(signature).decode('ascii') == envelope['signature'], 'ED25519_SIGNATURE_ENCODING')
    catalog = parse(envelope['catalog'].encode('utf-8'))
    need(digest(envelope['catalog'].encode('utf-8')) == feed_report['catalogSha256'], 'CATALOG_RAW_SHA')
    need(feed_report.get('purpose') == 'root-signed-162-resource-feed' and feed_report.get('directory') == str(FEED)
         and feed_report.get('programVersion') == '1.6.2' and feed_report.get('fileCount') == 1007
         and feed_report.get('sourceVersions') == ['1.6.1', '1.6.2']
         and feed_report.get('signed') is True and feed_report.get('signatureVerified') is True
         and feed_report.get('publisherPublicKeySha256') == PUBLISHER
         and feed_report.get('manifestSha256') == MANIFEST_SHA and feed_report.get('asarSha256') == ASAR_SHA,
         'ROOT_REVIEWED_FEED_BINDING')
    for key in ('published', 'installed', 'programExecuted'):
        need(feed_report.get(key) is False, 'FEED_EXECUTION_BOUNDARY')
    need(catalog.get('app') == 'xjy-jewelry-offline' and catalog.get('version') == '1.6.2'
         and catalog.get('channel') == 'stable' and catalog.get('platform') == 'win32'
         and catalog.get('arch') == 'x64' and catalog.get('sourceVersions') == ['1.6.1', '1.6.2']
         and catalog.get('files') == resources and type(catalog.get('sequence')) is int
         and catalog['sequence'] > 3 and catalog['sequence'] == feed_report['sequence'], 'CATALOG_SCOPE')
    for key in ('publishedAt', 'expiresAt', 'archive'):
        need(catalog[key] == feed_report[key], 'CATALOG_REPORT_IDENTITY')
    published = datetime.fromisoformat(catalog['publishedAt'].replace('Z', '+00:00'))
    expires = datetime.fromisoformat(catalog['expiresAt'].replace('Z', '+00:00'))
    need(published.tzinfo is not None and expires.tzinfo is not None
         and published.timestamp() <= datetime.now(timezone.utc).timestamp() + 300
         and expires > datetime.now(timezone.utc) and expires > published, 'CATALOG_TIME_BOUNDARY')
    need(tracker.read(FEED / 'package.zip') == catalog['archive'], 'SIGNED_RESOURCE_ARCHIVE_CHANGED')
    public_bytes = tracker.read(FEED / 'publisher-public.pem', feed_report['publicKeyFileSha256'], limit=8192)
    need(b'PRIVATE KEY' not in public_bytes and public_bytes == manifest['publicPins']['publisherPublicKey'].encode('utf-8')
         and manifest['publicPins']['publisherPublicKeySha256'] == PUBLISHER
         and digest(public_bytes) == proposal['publicKeyFileSha256'], 'FIXED_PUBLIC_KEY_BYTES')
    trust = {'targetVersion': '1.6.2', 'executableName': EXE_NAME, 'publisherPublicKeySha256': PUBLISHER,
             'engineVersion': '44.7.0', 'engineFiles': engine_rows,
             'allowedResourceFiles': [item['path'] for item in resources]}
    trust_bytes = pretty(trust)
    need(trust == proposal['trust'] and digest(trust_bytes) == proposal['trustSha256'] == build['trustSha256'], 'EXACT_TRUST_BYTES')
    expected = [row('安装文件/engine/' + item['path'], item['size'], item['sha256']) for item in engine_rows]
    expected += [row('安装文件/' + item['path'], item['size'], item['sha256']) for item in resources]
    expected += [row('安装组件/' + item['path'], item['size'], item['sha256']) for item in tools]
    for name, body in ((TRUST_NAME, trust_bytes), ('安装文件/publisher-public.pem', public_bytes),
                       ('安装文件/catalog-envelope.json', envelope_bytes)):
        expected.append(row(name, len(body), digest(body)))
    expected = validate_rows(expected, 1087)
    expected.sort(key=lambda item: ordinal(item['path']))
    template = tracker.read(ROOT / 'audit-tools/fresh-employee-wrapper-162.ps1.in',
                            PINS['audit-tools/fresh-employee-wrapper-162.ps1.in'], limit=1048576)
    guard = tracker.read(ROOT / 'delivery-tools/Initial-Path-Guard.ps1',
                         PINS['delivery-tools/Initial-Path-Guard.ps1'], limit=65536)
    ps, cmd = wrapper_bytes(template, guard, expected, digest(trust_bytes))
    need(digest(ps) == build['wrapperSha256'] and build.get('pathGuardSha256') == PINS['delivery-tools/Initial-Path-Guard.ps1'],
         'WRAPPER_REPORT_IDENTITY')
    expected += [row(PS_NAME, len(ps), digest(ps)), row(CMD_NAME, len(cmd), digest(cmd))]
    expected = validate_rows(expected, 1089)
    need(tree_hash(expected) == build['treeSha256'], 'INDEPENDENT_EXPECTED_TREE_SHA')
    return build, expected, feed_report


def scan_output(tracker, expected):
    ordinary(OUTPUT, directory=True)
    wanted = {item['path']: item for item in expected}
    allowed_dirs, actual = set(), []
    for name in wanted:
        parts = name.split('/')
        allowed_dirs.update('/'.join(parts[:index]) for index in range(1, len(parts)))

    def walk(directory, prefix=''):
        ordinary(directory, directory=True)
        for entry in directory.iterdir():
            name = prefix + entry.name
            safe_name(name)
            info = entry.lstat()
            if stat.S_ISDIR(info.st_mode):
                need(name in allowed_dirs, 'EXTRA_OUTPUT_DIRECTORY')
                walk(ordinary(entry, directory=True), name + '/')
            else:
                ordinary(entry)
                need(name in wanted, 'EXTRA_OUTPUT_FILE')
                value = tracker.read(entry)
                spec = wanted[name]
                need(value == {'size': spec['size'], 'sha256': spec['sha256']}, 'OUTPUT_BYTES_DIFFER')
                actual.append(row(name, value['size'], value['sha256']))
    walk(OUTPUT)
    need(len(actual) == 1089 and {item['path'] for item in actual} == set(wanted), 'OUTPUT_TREE_INCOMPLETE')
    return tree_hash(actual)


def final_output_names(tracker, expected):
    wanted, seen = {item['path'] for item in expected}, set()
    allowed_dirs = set()
    for name in wanted:
        parts = name.split('/')
        allowed_dirs.update('/'.join(parts[:index]) for index in range(1, len(parts)))

    def walk(directory, prefix=''):
        ordinary(directory, directory=True)
        for entry in directory.iterdir():
            name = safe_name(prefix + entry.name)
            if stat.S_ISDIR(entry.lstat().st_mode):
                need(name in allowed_dirs, 'FINAL_EXTRA_OUTPUT_DIRECTORY')
                walk(ordinary(entry, directory=True), name + '/')
            else:
                ordinary(entry)
                need(name in wanted and name not in seen and entry in tracker.files, 'FINAL_EXTRA_OUTPUT_FILE')
                need(identity(entry.lstat()) == tracker.files[entry][1], 'FINAL_OUTPUT_IDENTITY_CHANGED')
                seen.add(name)
    walk(OUTPUT)
    need(seen == wanted, 'FINAL_OUTPUT_MEMBERS_CHANGED')


def at(stream, offset, size):
    need(type(offset) is int and offset >= 0 and 0 <= size <= 2097152, 'ZIP_HEADER_READ_BOUND')
    stream.seek(offset)
    value = stream.read(size)
    need(len(value) == size, 'ZIP_HEADER_TRUNCATED')
    return value


def verify_zip(tracker, build, expected):
    archive = tracker.read(ARCHIVE)
    need(archive == {key: build['archive'][key] for key in ('size', 'sha256')}, 'FINAL_ZIP_IDENTITY')
    expected = sorted(expected, key=lambda item: ordinal(item['path']))
    verified = []
    with stable_reader(ARCHIVE) as (stream, info):
        need(info.st_size >= 22, 'ZIP_TOO_SMALL')
        end = struct.unpack('<4s4H2IH', at(stream, info.st_size - 22, 22))
        need(end[0] == b'PK\x05\x06' and end[1:5] == (0, 0, 1089, 1089) and end[7] == 0,
             'EXACT_EOCD_REQUIRED')
        central_size, central_at = end[5], end[6]
        need(central_size <= 2097152 and central_at + central_size == info.st_size - 22, 'ZIP_CENTRAL_BOUNDS')
        with zipfile.ZipFile(stream, 'r', allowZip64=False) as package:
            infos = package.infolist()
            need(len(infos) == 1089 and package.comment == b'' and package.start_dir == central_at, 'ZIP_MEMBER_COUNT_OR_PREFIX')
            need([item.filename for item in infos] == [item['path'] for item in expected], 'EXACT_SORTED_MEMBERS_REQUIRED')
            local_at, cursor, seen = 0, central_at, set()
            for member, spec in zip(infos, expected):
                name = safe_name(member.filename)
                need(name.casefold() not in seen and not member.is_dir(), 'ZIP_DUPLICATE_OR_DIRECTORY')
                seen.add(name.casefold())
                need(member.flag_bits == 0x800 and member.compress_type == zipfile.ZIP_STORED
                     and not member.extra and not member.comment and member.header_offset == local_at
                     and member.file_size == spec['size'] == member.compress_size
                     and stat.S_IFMT(member.external_attr >> 16) == stat.S_IFREG, 'ZIP_MEMBER_METADATA')
                central = struct.unpack('<4s6H3I5H2I', at(stream, cursor, 46))
                name_bytes = name.encode('utf-8')
                need(central[0] == b'PK\x01\x02' and central[1:7] == (0x314, 20, 0x800, 0, 0, 0)
                     and central[7:10] == (member.CRC, spec['size'], spec['size'])
                     and central[10:15] == (len(name_bytes), 0, 0, 0, 0)
                     and central[15] == 0x80000000 and central[16] == local_at, 'ZIP_CENTRAL_HEADER')
                need(at(stream, cursor + 46, len(name_bytes)) == name_bytes, 'ZIP_CENTRAL_NAME')
                local = struct.unpack('<4s5H3I2H', at(stream, local_at, 30))
                need(local[0] == b'PK\x03\x04' and local[1:6] == (20, 0x800, 0, 0, 0)
                     and local[6:9] == (member.CRC, spec['size'], spec['size'])
                     and local[9:11] == (len(name_bytes), 0), 'ZIP_LOCAL_HEADER')
                need(at(stream, local_at + 30, len(name_bytes)) == name_bytes, 'ZIP_LOCAL_NAME')
                data_at = local_at + 30 + len(name_bytes)
                need(data_at + spec['size'] <= central_at, 'ZIP_DATA_OVERLAP')
                total, crc, h = 0, 0, hashlib.sha256()
                with package.open(member, 'r') as content:
                    while block := content.read(CHUNK):
                        total += len(block)
                        need(total <= spec['size'], 'ZIP_EXPANDED_SIZE_BOUND')
                        h.update(block)
                        crc = zlib.crc32(block, crc)
                need(total == spec['size'] and h.hexdigest() == spec['sha256']
                     and crc & 0xffffffff == member.CRC, 'ZIP_MEMBER_CRC_OR_SHA')
                verified.append({**spec, 'crc32': f'{crc & 0xffffffff:08x}'})
                local_at, cursor = data_at + spec['size'], cursor + 46 + len(name_bytes)
            need(local_at == central_at and cursor == central_at + central_size, 'ZIP_GAPS_OR_EXTRA_HEADERS')
    need(tree_hash(verified) == build['treeSha256'], 'ACTUAL_ZIP_TREE_SHA')
    return archive, verified


def save_result(value):
    ordinary(RESULT.parent, directory=True)
    ordinary(RESULT, missing=True)
    need(not os.path.lexists(RESULT), 'CREATE_NEW_RESULT_REQUIRED')
    body = pretty(value)
    with RESULT.open('xb') as stream:
        opened = os.fstat(stream.fileno())
        need(stat.S_ISREG(opened.st_mode) and opened.st_nlink == 1, 'RESULT_HANDLE_INVALID')
        need(stream.write(body) == len(body), 'RESULT_WRITE_INCOMPLETE')
        stream.flush()
        os.fsync(stream.fileno())
        named = ordinary(RESULT).lstat()
        need(common_identity(named) == common_identity(os.fstat(stream.fileno())), 'RESULT_PATH_CHANGED')
        need(named.st_size == len(body), 'RESULT_SIZE_MISMATCH')
    return {'file': str(RESULT), 'size': len(body), 'sha256': digest(body)}


def arguments(argv):
    parser = argparse.ArgumentParser(allow_abbrev=False, description=__doc__)
    parser.add_argument('--source-sha256', required=True)
    parser.add_argument('--approved-build-report-sha256', required=True)
    need(len(argv) == 4 and argv.count('--source-sha256') == 1
         and argv.count('--approved-build-report-sha256') == 1, 'EXPLICIT_UNIQUE_ARGUMENTS_REQUIRED')
    result = parser.parse_args(argv)
    need(SHA.fullmatch(result.source_sha256) and SHA.fullmatch(result.approved_build_report_sha256), 'EXPLICIT_SHA_REQUIRED')
    return result


def main(argv=None):
    options = arguments(sys.argv[1:] if argv is None else argv)
    need(os.name == 'nt' and Path(__file__).absolute() == SELF and Path.cwd() == ROOT, 'FIXED_HOST_WORKSPACE_REQUIRED')
    need(sys.flags.isolated and sys.flags.no_site and sys.flags.dont_write_bytecode, 'PYTHON_I_B_S_REQUIRED')
    ordinary(ROOT, directory=True)
    ordinary(ENGINE, ENGINE, directory=True)
    boundaries = {base: (base.lstat().st_dev, base.lstat().st_ino) for base in (ROOT, ENGINE)}
    ordinary(RESULT, missing=True)
    need(not os.path.lexists(RESULT), 'CREATE_NEW_RESULT_REQUIRED')
    tracker = Tracker()
    build, expected, feed_report = fixed_inputs(tracker, options)
    before_tree = scan_output(tracker, expected)
    need(before_tree == build['treeSha256'], 'ACTUAL_OUTPUT_TREE_SHA')
    archive, verified = verify_zip(tracker, build, expected)
    need(scan_output(tracker, expected) == before_tree, 'OUTPUT_TREE_CHANGED')
    tracker.recheck()
    final_output_names(tracker, expected)
    for base, expected_identity in boundaries.items():
        current = ordinary(base, base, directory=True).lstat()
        need((current.st_dev, current.st_ino) == expected_identity, 'FIXED_BOUNDARY_IDENTITY_CHANGED')
    result = {
        'version': 1, 'purpose': 'fresh162-zip-independent-public-data-verification',
        'passed': True, 'scope': 'exact ZIP, output tree, wrappers and public metadata only',
        'sourceSha256': options.source_sha256, 'approvedBuildReportSha256': options.approved_build_report_sha256,
        'approvedProposalSha256': PROPOSAL_SHA, 'signedFeedReportSha256': build['signedFeedReportSha256'],
        'archiveFile': str(ARCHIVE), 'archive': archive, 'treeSha256': before_tree,
        'membersVerified': 1089, 'engineFiles': 72, 'resourceFiles': 1007, 'toolFiles': 5,
        'trustSha256': build['trustSha256'], 'wrapperSha256': build['wrapperSha256'],
        'catalogSha256': feed_report['catalogSha256'], 'publisherPublicKeySha256': PUBLISHER,
        'catalogEnvelopeSha256': feed_report['catalogEnvelopeSha256'],
        'publicKeyFileSha256': feed_report['publicKeyFileSha256'],
        'publisherKeyBinding': 'exact public PEM bytes from the pinned a2 manifest; SPKI/Ed25519 verification belongs to Root',
        'catalogSignatureVerifiedByThisTool': False,
        'catalogSignatureVerification': 'Root must independently verify Ed25519 for these exact public key/catalog bytes; feed booleans are not independent proof',
        'sourceReportZipAndTreeUnchanged': True, 'allMembers': verified,
        'privateKeyRead': False, 'signingPerformed': False, 'productModulesImported': False, 'childProcessStarted': False,
        'extracted': False, 'archiveRewritten': False, 'productExecuted': False, 'guestAccessed': False,
        'installed': False, 'guiVerified': False, 'firstTrustApproved': False,
    }
    saved = save_result(result)
    print(json.dumps({**saved, 'passed': True, 'scope': result['scope'],
                      'catalogSignatureVerifiedByThisTool': False}, ensure_ascii=False))
    return 0


if __name__ == '__main__':
    try:
        raise SystemExit(main())
    except Exception as error:
        print(json.dumps({'purpose': 'fresh162-zip-independent-public-data-verification', 'passed': False,
                          'refusal': str(error), 'productExecuted': False, 'privateKeyRead': False,
                          'archiveRewritten': False, 'independentResultSaved': False}, ensure_ascii=False))
        raise SystemExit(1)
