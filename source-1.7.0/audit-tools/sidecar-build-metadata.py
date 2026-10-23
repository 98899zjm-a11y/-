"""Actual Guest only. Read build-tool metadata, never import third-party tools."""
from pathlib import Path
import hashlib
import importlib.util
import json
import os
import re
import stat
import sys

ROOT = Path(__file__).resolve().parents[1]
PUBLIC = Path('C:/Python314')
RESULTS = Path('C:/xjy-results')
if (os.name != 'nt' or os.path.normcase(str(ROOT)) != os.path.normcase('C:/xjy-work/xjy-web-stage1') or
        os.path.normcase(sys.executable) != os.path.normcase(str(PUBLIC / 'python.exe')) or
        not sys.flags.isolated or not sys.flags.dont_write_bytecode or not sys.flags.no_site or sys.flags.optimize):
    raise RuntimeError('Fixed isolated Guest Python required')

def ordinary(file, boundary):
    if not file.is_absolute() or not file.is_relative_to(boundary):
        raise RuntimeError('Metadata path boundary refused')
    for current in (file, *file.parents):
        info = current.lstat()
        if stat.S_ISLNK(info.st_mode) or getattr(info, 'st_file_attributes', 0) & 0x400:
            raise RuntimeError('Metadata reparse point refused')
        if stat.S_ISREG(info.st_mode) and info.st_nlink != 1:
            raise RuntimeError('Metadata hardlink refused')
        if current == boundary:
            return file
    raise RuntimeError('Metadata physical boundary absent')

def read(file, boundary, limit):
    ordinary(file, boundary)
    before = file.stat()
    if not stat.S_ISREG(before.st_mode) or before.st_size > limit:
        raise RuntimeError('Metadata bounded file required')
    identity = lambda s: (s.st_dev, s.st_ino, s.st_size, s.st_mtime_ns, s.st_ctime_ns, s.st_nlink, getattr(s, 'st_birthtime_ns', None))
    with file.open('rb') as stream:
        opened = os.fstat(stream.fileno())
        common = ('st_dev', 'st_ino', 'st_size', 'st_mtime_ns', 'st_nlink')
        if any(getattr(before, key) != getattr(opened, key) for key in common):
            raise RuntimeError('Metadata changed before read')
        body = stream.read(limit + 1)
        if len(body) != before.st_size or identity(os.fstat(stream.fileno())) != identity(opened):
            raise RuntimeError('Metadata changed during read')
    if identity(ordinary(file, boundary).stat()) != identity(before):
        raise RuntimeError('Metadata changed after read')
    return body

pins = {'stage1/sandbox-context.py': '09426dfd4d699c51570e1f1b10c2e37c00f6feb699b9a472ca710ae5242bf249',
        'stage1/validate-sandbox-context.py': '867a0117d6bc200960df06a355ffafcf639f24532ece3bc4db34f6e397325207'}
guard_bytes = {}
for relative, expected in pins.items():
    body = read(ROOT / relative, ROOT, 1024 * 1024)
    if hashlib.sha256(body).hexdigest() != expected:
        raise RuntimeError('Original Guest guard changed')
    guard_bytes[relative] = body
guard_file = ROOT / 'stage1/sandbox-context.py'
spec = importlib.util.spec_from_file_location('build_metadata_context', guard_file)
context = importlib.util.module_from_spec(spec)
exec(compile(guard_bytes['stage1/sandbox-context.py'], str(guard_file), 'exec'), context.__dict__)
admission = context.read_context(ROOT)
if hashlib.sha256(read(PUBLIC / 'python.exe', PUBLIC, 1024 * 1024)).hexdigest() != '434b361fe0c5960d404974feed493db47f2603a1ace2574312104fbed0182c6f':
    raise RuntimeError('Public compiler Python changed')

wanted = {'pyinstaller', 'pyinstaller-hooks-contrib', 'altgraph', 'packaging', 'pefile', 'pywin32-ctypes',
          'flask', 'werkzeug', 'itsdangerous', 'markupsafe', 'click', 'waitress', 'openpyxl', 'reportlab', 'pillow'}
site = ordinary(PUBLIC / 'Lib/site-packages', PUBLIC)
packages, hook_declarations = [], []
directories = sorted(site.glob('*.dist-info'))
if len(directories) > 1024:
    raise RuntimeError('Public distribution metadata count exceeded')
for directory in directories:
    ordinary(directory, PUBLIC)
    metadata = directory / 'METADATA'
    body = read(metadata, PUBLIC, 2 * 1024 * 1024)
    headers = body.decode('utf-8', errors='strict').replace('\r\n', '\n').split('\n\n', 1)[0]
    fields = {}
    for key in ['Name', 'Version', 'Requires-Python', 'License-Expression']:
        found = re.findall(r'^' + re.escape(key) + r': ([^\r\n]{1,1024})\r?$', headers, re.M)
        if found:
            if len(found) != 1:
                raise RuntimeError('Ambiguous public package metadata')
            fields[key] = found[0]
    normalized = re.sub(r'[-_.]+', '-', fields.get('Name', '').lower())
    entry_points = directory / 'entry_points.txt'
    if entry_points.exists():
        entry_body = read(entry_points, PUBLIC, 512 * 1024)
        declarations, in_group = [], False
        for line in entry_body.decode('utf-8', errors='strict').splitlines():
            line = line.strip()
            if line.startswith('['):
                in_group = line == '[pyinstaller40]'
            elif in_group and line and not line.startswith(('#', ';')):
                declarations.append(line)
        if declarations:
            hook_declarations.append({'name': normalized, 'version': fields.get('Version'), 'path': str(entry_points),
                                      'sha256': hashlib.sha256(entry_body).hexdigest(), 'declarations': declarations})
    if normalized not in wanted:
        continue
    record = directory / 'RECORD'
    record_body = read(record, PUBLIC, 16 * 1024 * 1024) if record.exists() else None
    packages.append({'name': normalized, 'metadataPath': str(metadata), 'fields': fields,
                     'metadataSha256': hashlib.sha256(body).hexdigest(),
                     'recordSha256': hashlib.sha256(record_body).hexdigest() if record_body is not None else None})
report = {'purpose': 'Guest compiler dependency metadata only', 'actualGuest': admission,
          'python': sys.version, 'magicNumberHex': importlib.util.MAGIC_NUMBER.hex(), 'site': str(site),
          'architectureBits': 64 if sys.maxsize > 2**32 else 32, 'cacheTag': sys.implementation.cache_tag,
          'prefix': sys.prefix, 'basePrefix': sys.base_prefix,
          'packages': packages, 'missingNames': sorted(wanted - {row['name'] for row in packages}),
          'hookEntryPoints': hook_declarations, 'hookEntryPointsLoaded': False, 'hookSourceClosureVerified': False,
          'thirdPartyImported': False, 'businessOrPycImported': False, 'databaseOpened': False,
          'compilerOrHookExecuted': False, 'buildStarted': False,
          'packagedSidecarRuntimeVersionsVerified': False}
ordinary(RESULTS, RESULTS)
target = RESULTS / 'sidecar-build-metadata-a1.json'
with target.open('x', encoding='utf-8', newline='\n') as stream:
    json.dump(report, stream, ensure_ascii=True, indent=2)
    stream.write('\n')
print(json.dumps({'result': str(target), 'packages': len(packages), 'missingNames': report['missingNames'], 'buildStarted': False}))
