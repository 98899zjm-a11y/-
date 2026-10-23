"""Plan one complete, data-free candidate resource tree. Launches nothing.

The normal packager exclusions remain unchanged. This module admits only an
explicit Root-sealed resource manifest under the identified development root.
"""
import hashlib
import json
import os
from pathlib import Path
import re

PDF_PACKAGES = ('pdfjs-dist', '@napi-rs/canvas', '@napi-rs/canvas-win32-x64-msvc')
HELPER_FILES = frozenset({'updater-helper.cjs', 'employee-update-installer.cjs',
                         'employee-update-cache.cjs', 'bootstrap.json'})
REQUIRED_PDF_FILES = frozenset({
    'pdfjs-dist/legacy/build/pdf.mjs', 'pdfjs-dist/legacy/build/pdf.worker.mjs',
    '@napi-rs/canvas/index.js', '@napi-rs/canvas-win32-x64-msvc/skia.win32-x64-msvc.node',
})
DESCRIPTOR_FIELDS = frozenset({'version', 'purpose', 'sourceRoot', 'releaseManifest',
                              'releaseManifestSha256', 'destinationRoot'})
MANIFEST_FIELDS = frozenset({'version', 'product', 'programVersion', 'platform', 'arch',
    'sourceBaseline', 'resourcesOnly', 'main', 'outputDir', 'files', 'fileCount', 'bytes',
    'asar', 'publicPins', 'compilers', 'pdf', 'excludes', 'assertions', 'freeze'})
DENIED_PARTS = frozenset({'data', 'config', 'configs', 'profile', 'profiles', 'cache',
    'logs', 'log', 'runtime', 'backups', 'backup', 'private', 'uploads', 'attachments',
    'erp-attachments', 'legacy-source', '.release-build', '.legacy-build', '__pycache__'})
DENIED_NAMES = frozenset({'xjy-install-activation.json', 'xjy-employee-recovery.json',
    'activation.json', 'accounts.json', 'users.json', 'customers.json', 'credentials.json',
    'request.json', 'recovery-pointer.json'})
SECRET_BYTES = re.compile(rb'-----BEGIN (?:[A-Z]+ )?PRIVATE KEY-----|\bsk-[A-Za-z0-9_-]{24,}')
SHA256 = re.compile(r'^[a-f0-9]{64}$')
SECRET_METADATA_FIELDS = frozenset({'publisherprivatekey', 'privatekey', 'apikey',
    'accesstoken', 'refreshtoken', 'activationtoken', 'passwordhash', 'credentials'})


def _fail(message):
    raise RuntimeError('SANDBOX RELEASE INCLUSION: ' + message)


def _relative(value, packaging):
    if not isinstance(value, str) or not value or len(value.encode('utf-8')) > 240:
        _fail('ordinary relative path required')
    if value.startswith(('/', '\\')) or re.search(r'[\\:\x00-\x1f]', value):
        _fail('ordinary relative path required')
    for part in value.split('/'):
        if not part or part in ('.', '..') or part.endswith((' ', '.')) or packaging._RESERVED.match(part):
            _fail('relative path has ambiguous or reserved segment')
    return value


def _no_duplicate_keys(pairs):
    result = {}
    for key, value in pairs:
        if key in result:
            _fail('duplicate JSON manifest key')
        result[key] = value
    return result


def _read(path, boundary, packaging, *, metadata=False):
    path = boundary.path(path)
    before = packaging._source_file(path, boundary.root)
    if metadata and before.st_size > 8 * 1024 * 1024:
        _fail('manifest metadata exceeds bound')
    flags = os.O_RDONLY | getattr(os, 'O_BINARY', 0) | getattr(os, 'O_NOFOLLOW', 0)
    fd = os.open(path, flags)
    digest = hashlib.sha256()
    pieces = []
    seen = 0
    trailing = b''
    try:
        opened = os.fstat(fd)
        if packaging._identity(opened) != packaging._identity(before) or opened.st_nlink != 1:
            _fail('ordinary source identity changed before reading')
        while block := os.read(fd, 1024 * 1024):
            if seen == 0 and block.startswith(b'SQLite format 3\x00'):
                _fail('renamed database content refused')
            if SECRET_BYTES.search(trailing + block):
                _fail('private key or API secret content refused')
            trailing = block[-4096:]
            seen += len(block)
            digest.update(block)
            if metadata:
                pieces.append(block)
        after = packaging._source_file(path, boundary.root)
        if (packaging._identity(after), after.st_size, after.st_mtime_ns, after.st_nlink) != (
                packaging._identity(before), before.st_size, before.st_mtime_ns, before.st_nlink):
            _fail('ordinary source identity changed while reading')
        if seen != before.st_size:
            _fail('ordinary source size changed while reading')
    finally:
        os.close(fd)
    return {'size': seen, 'sha256': digest.hexdigest(),
            'bytes': b''.join(pieces) if metadata else None}


def _json(record):
    try:
        value = json.loads(record['bytes'].decode('utf-8-sig'), object_pairs_hook=_no_duplicate_keys)
    except (UnicodeError, ValueError) as error:
        _fail('manifest is not valid UTF8 JSON: ' + str(error))
    pending = [(value, 0)]
    while pending:
        item, depth = pending.pop()
        if depth > 32:
            _fail('manifest metadata nesting exceeds bound')
        if isinstance(item, dict):
            for key, nested in item.items():
                if str(key).casefold().replace('_', '').replace('-', '') in SECRET_METADATA_FIELDS:
                    _fail('private key or activation secret metadata field refused')
                pending.append((nested, depth + 1))
        elif isinstance(item, list):
            pending.extend((nested, depth + 1) for nested in item)
    return value


def _program_path(value, packaging):
    value = _relative(value, packaging)
    parts = value.split('/')
    lowered = parts[-1].casefold()
    if lowered.startswith('.env') or lowered.endswith(('.pth', '.pyc.tmp')):
        _fail('excluded environment or automatic import path refused')
    if any(part.casefold() in DENIED_PARTS for part in parts) or parts[-1].casefold() in DENIED_NAMES:
        _fail('operational data or activation path refused')
    if packaging._DATABASE_NAME.search(value):
        _fail('database path refused')
    if re.search(r'\.(?:key|pem|p12|pfx|pub|xjybak|log)$', value, re.I):
        _fail('secret key or operational file refused')
    if value in ('resources/app.asar', 'resources/app.asar.unpacked/ocr.winrt.ps1',
                 'resources/release-modules/manifest.json'):
        return value
    if re.match(r'^resources/release-modules/xjy-(ledger|inventory)/', value):
        if 'node_modules' in (part.casefold() for part in parts):
            _fail('nested node package is outside the PDF allowlist')
        return value
    if value.startswith('resources/update-helper/') and value[len('resources/update-helper/'):] in HELPER_FILES:
        return value
    prefix = 'resources/print-dependencies/node_modules/'
    if value.startswith(prefix):
        remainder = value[len(prefix):]
        for name in PDF_PACKAGES:
            if remainder.startswith(name + '/'):
                if 'node_modules' in (part.casefold() for part in remainder[len(name) + 1:].split('/')):
                    _fail('nested PDF node package refused')
                return value
        _fail('PDF package is outside the exact three-package allowlist')
    _fail('resource path is outside the explicit program allowlist')


def _actual_tree(candidate, boundary, packaging):
    actual = []
    def walk(directory, prefix=''):
        directory = boundary.path(directory)
        packaging._inspect_path(directory)
        with os.scandir(directory) as listing:
            entries = sorted(listing, key=lambda entry: entry.name)
        for entry in entries:
            child = directory / entry.name
            packaging._inspect_path(child)
            name = prefix + entry.name
            _relative(name, packaging)
            if entry.is_dir(follow_symlinks=False):
                walk(child, name + '/')
            else:
                packaging._source_file(child, boundary.root)
                actual.append(name)
    walk(candidate)
    return actual


def plan(boundary, inclusion, packaging):
    inclusion = boundary.path(inclusion)
    descriptor_relative = inclusion.relative_to(boundary.root).as_posix()
    if descriptor_relative != 'stage1/sandbox-release-inclusion.json':
        _fail('description must use the fixed ordinary stage1 program metadata path')
    descriptor_record = _read(inclusion, boundary, packaging, metadata=True)
    descriptor = _json(descriptor_record)
    if not isinstance(descriptor, dict) or set(descriptor) != DESCRIPTOR_FIELDS:
        _fail('explicit inclusion descriptor fields required')
    if type(descriptor['version']) is not int or descriptor['version'] != 1 or descriptor['purpose'] != 'xjy-sandbox-release-inclusion':
        _fail('explicit inclusion descriptor purpose/version required')
    source_relative = _relative(descriptor['sourceRoot'], packaging)
    manifest_relative = _relative(descriptor['releaseManifest'], packaging)
    destination = _relative(descriptor['destinationRoot'], packaging)
    if not source_relative.startswith('release/') or not re.fullmatch(r'release-work/full-[0-9a-f-]{36}/release-manifest\.json', manifest_relative):
        _fail('candidate root or release manifest is outside owned program paths')
    if destination != 'release-candidate':
        _fail('destination must be the separate release-candidate root')
    if not SHA256.fullmatch(str(descriptor['releaseManifestSha256'])):
        _fail('sealed manifest sha256 required')
    candidate = boundary.path(boundary.root / source_relative)
    if not candidate.is_dir():
        _fail('candidate program directory missing')
    manifest_path = boundary.path(boundary.root / manifest_relative)
    manifest_record = _read(manifest_path, boundary, packaging, metadata=True)
    if manifest_record['sha256'] != descriptor['releaseManifestSha256']:
        _fail('sealed release manifest hash mismatch')
    manifest = _json(manifest_record)
    if not isinstance(manifest, dict) or not set(manifest).issubset(MANIFEST_FIELDS):
        _fail('release manifest contains unapproved metadata fields')
    if type(manifest.get('version')) is not int or manifest['version'] != 1 or manifest.get('product') != 'xjy-jewelry-offline' or manifest.get('programVersion') != '1.6.0' or manifest.get('resourcesOnly') is not True:
        _fail('resources-only candidate product/version manifest required')
    if boundary.path(manifest.get('outputDir', '')) != candidate:
        _fail('release manifest candidate path mismatch')
    assertions = manifest.get('assertions')
    if not isinstance(assertions, dict) or any(assertions.get(key) is not True for key in ('noDatabase', 'noPrivateKey', 'noActivation', 'exactAllowlist')) or any(assertions.get(key) is not False for key in ('servicesStarted', 'programExecuted', 'installed')):
        _fail('program-only, nonexecuted candidate assertions required')
    files = manifest.get('files')
    if not isinstance(files, list) or not 1 <= len(files) <= 4096 or type(manifest.get('fileCount')) is not int or len(files) != manifest['fileCount']:
        _fail('complete release manifest count required')
    seen = set()
    declared = {}
    for row in files:
        if not isinstance(row, dict) or set(row) != {'path', 'size', 'sha256'}:
            _fail('complete resource path/size/hash row required')
        name = _relative(row['path'], packaging)
        folded = name.casefold()
        if folded in seen:
            _fail('duplicate Windows case-folded resource path')
        seen.add(folded)
        _program_path(name, packaging)
        if type(row['size']) is not int or row['size'] < 0 or not isinstance(row['sha256'], str) or not SHA256.fullmatch(row['sha256']):
            _fail('resource size/hash field malformed')
        declared[name] = row
    if type(manifest.get('bytes')) is not int or manifest['bytes'] != sum(row['size'] for row in files):
        _fail('complete resource manifest byte count mismatch')
    actual = _actual_tree(candidate, boundary, packaging)
    if len({name.casefold() for name in actual}) != len(actual) or set(actual) != set(declared):
        _fail('actual candidate tree does not match complete manifest; extra or missing file')
    required = {'resources/app.asar', 'resources/release-modules/manifest.json'}
    required.update('resources/release-modules/xjy-' + module + '/xjy-' + module + '.exe' for module in ('ledger', 'inventory'))
    required.update('resources/update-helper/' + name for name in HELPER_FILES)
    required.update('resources/print-dependencies/node_modules/' + name + '/package.json' for name in PDF_PACKAGES)
    required.update('resources/print-dependencies/node_modules/' + name for name in REQUIRED_PDF_FILES)
    if not required.issubset(declared):
        _fail('complete module, helper or required PDF runtime file missing')
    records = []
    for name in sorted(declared):
        source = boundary.path(candidate / name)
        record = _read(source, boundary, packaging, metadata=name.casefold().endswith('.json'))
        row = declared[name]
        if record['size'] != row['size'] or record['sha256'] != row['sha256']:
            _fail('resource declared size/hash mismatch: ' + name)
        parsed_json = _json(record) if name.casefold().endswith('.json') else None
        prefix = 'resources/print-dependencies/node_modules/'
        if name in {prefix + package + '/package.json' for package in PDF_PACKAGES}:
            info = parsed_json
            expected_name = name[len(prefix):-len('/package.json')]
            if not isinstance(info, dict) or info.get('name') != expected_name or not isinstance(info.get('version'), str) or not info['version'] or info.get('dependencies', {}) != {}:
                _fail('PDF package identity or dependency closure mismatch')
        records.append({'source': str(source), 'destination': destination + '/' + name,
                        'size': record['size'], 'sha256': record['sha256']})
    records.append({'source': str(manifest_path), 'destination': destination + '/release-manifest.json',
                    'size': manifest_record['size'], 'sha256': manifest_record['sha256']})
    return {'version': 1, 'purpose': descriptor['purpose'], 'sourceRoot': source_relative,
            'releaseManifest': manifest_relative, 'releaseManifestSha256': manifest_record['sha256'],
            'descriptorPath': descriptor_relative, 'descriptorSize': descriptor_record['size'],
            'descriptorSha256': descriptor_record['sha256'], 'destinationRoot': destination,
            'pdfPackages': list(PDF_PACKAGES), 'resourceFileCount': len(declared),
            'fileCount': len(records), 'totalBytes': sum(row['size'] for row in records),
            'files': records, 'programExecuted': False}
