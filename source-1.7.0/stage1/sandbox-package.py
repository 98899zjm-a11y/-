"""Create a data-free Sandbox input package. Never launches code or services.

Run with a trusted Python interpreter in isolated mode (-I -B). The output is a
new directory, never a replacement of an existing package. All filesystem writes
are confined to an explicitly identified isolated root. External Python runtime
files are only read; no package installation or import of business code occurs.
"""
import argparse
from datetime import datetime, timezone
import hashlib
import json
import os
from pathlib import Path
import re
import stat
import uuid


_EXCLUDED_DIRS = frozenset({
    '.git', '.legacy-build', '.release-build', '.next', '.wrangler', 'node_modules', '__pycache__',
    'cache', 'logs', 'runtime', 'backups', 'data', 'config', 'uploads',
    'attachments', 'erp-attachments', 'fake-external-files', 'build', 'dist',
})
_PYTHON_EXCLUDED_DIRS = frozenset({
    '__pycache__', 'test', 'tests', 'doc', 'docs', 'scripts', 'idlelib', 'turtledemo',
})
_TEST_SUFFIXES = frozenset({'.py', '.cjs', '.mjs', '.js', '.json', '.ts', '.tsx',
                            '.css', '.html', '.ps1', '.cmd'})
_RUNTIME_BINARIES = ('python.exe', 'python314.dll', 'python3.dll',
                     'vcruntime140.dll', 'vcruntime140_1.dll')
_PRODUCTION_ROOTS = (
    Path('F:/鑫金源珠宝资料'), Path('F:/自制软件/xjy-jewelry-offline'),
    Path('E:/codex/2026-10-11/work/jewelry-collaboration-v150'),
)
_DATABASE_NAME = re.compile(r'\.(?:db|sqlite|sqlite3)(?:-(?:wal|shm|journal))?$', re.I)
_RESERVED = re.compile(r'^(?:con|prn|aux|nul|com[1-9]|lpt[1-9])(?:\.|$)', re.I)


def _fail(message):
    raise RuntimeError('SANDBOX PACKAGE: ' + message)


def _plain_path(value):
    raw = os.fspath(value)
    if not isinstance(raw, str) or not raw or any(ord(c) < 32 for c in raw):
        _fail('invalid local path')
    if raw.startswith(('\\\\', '//')):
        _fail('network or device path rejected')
    p = Path(raw)
    if not p.is_absolute():
        _fail('absolute local path required')
    if os.name == 'nt' and (not re.match(r'^[a-zA-Z]:[\\/]', raw) or ':' in raw[2:]):
        _fail('drive-relative, device or alternate stream path rejected')
    for part in p.parts[1:]:
        if part in ('.', '..') or part.endswith((' ', '.')) or _RESERVED.match(part):
            _fail('ambiguous or reserved path segment')
    return p


def _identity(info):
    return info.st_dev, info.st_ino


def _inspect_path(p):
    """Check every ancestor, including non-symlink Windows reparse points."""
    records = []
    for ancestor in (p, *p.parents):
        try:
            info = ancestor.lstat()
        except FileNotFoundError:
            continue
        if stat.S_ISLNK(info.st_mode) or getattr(info, 'st_file_attributes', 0) & 0x400:
            _fail('symbolic link, junction or reparse point rejected: ' + str(ancestor))
        if stat.S_ISREG(info.st_mode) and info.st_nlink != 1:
            _fail('hard-linked file rejected: ' + str(ancestor))
        records.append((ancestor, info))
    return records


def _contained(root, path):
    return os.path.commonpath((os.path.normcase(str(root)),
                               os.path.normcase(str(path)))) == os.path.normcase(str(root))


class _Boundary:
    def __init__(self, root):
        requested = _plain_path(root)
        _inspect_path(requested)
        if not requested.is_dir():
            _fail('owned root must exist')
        self.root = requested.resolve(strict=True)
        self.id = _identity(self.root.stat())
        if not self.id[1]:
            _fail('owned root filesystem identity unavailable')
        for production in _PRODUCTION_ROOTS:
            try:
                denied = _contained(production.absolute(), self.root)
            except ValueError:
                denied = False
            if denied:
                _fail('production or maintained baseline cannot be an owned root')

    def path(self, value):
        requested = _plain_path(value)
        try:
            lexical = _contained(self.root, requested)
        except ValueError:
            lexical = False
        if not lexical:
            _fail('target outside owned root')
        if _identity(self.root.stat()) != self.id:
            _fail('owned root filesystem identity changed')
        trail = _inspect_path(requested)
        if not any(_identity(info) == self.id for _, info in trail):
            _fail('actual ancestry does not contain owned root')
        actual = requested.resolve(strict=False)
        if not _contained(self.root, actual):
            _fail('actual target outside owned root')
        return actual

    def mkdir(self, value):
        target = self.path(value)
        missing = []
        cursor = target
        while not cursor.exists():
            missing.append(cursor)
            cursor = cursor.parent
        for p in reversed(missing):
            self.path(p.parent)
            p.mkdir()
            self.path(p)
        if not target.is_dir():
            _fail('target parent is not a directory')
        return target


def _source_file(path, source_root):
    """Ensure a selected source is an ordinary single-linked in-root file."""
    _inspect_path(path)
    actual = path.resolve(strict=True)
    if not _contained(source_root, actual) or not any(
            _identity(info) == _identity(source_root.stat())
            for _, info in _inspect_path(path)):
        _fail('source escaped its approved root')
    info = path.lstat()
    if not stat.S_ISREG(info.st_mode):
        _fail('non-regular source file rejected')
    return info


def _reject_database_header(path, source_root):
    """Recognize SQLite even when a database has been renamed to another suffix."""
    before = _source_file(path, source_root)
    flags = os.O_RDONLY | getattr(os, 'O_BINARY', 0) | getattr(os, 'O_NOFOLLOW', 0)
    fd = os.open(path, flags)
    try:
        if _identity(os.fstat(fd)) != _identity(before):
            _fail('source changed before header inspection')
        if os.read(fd, 16) == b'SQLite format 3\x00':
            _fail('renamed database in program/runtime tree rejected: ' + str(path))
        after = _source_file(path, source_root)
        if (_identity(after), after.st_size, after.st_mtime_ns) != (
                _identity(before), before.st_size, before.st_mtime_ns):
            _fail('source changed during header inspection')
    finally:
        os.close(fd)


def _walk_files(folder, source_root, excluded, *, tests_only=False, python=False):
    _inspect_path(folder)
    if not folder.is_dir():
        _fail('required program or runtime directory is missing: ' + str(folder))
    selected = []
    for current, directories, filenames in os.walk(folder, followlinks=False,
                                                  onerror=lambda error: _fail(str(error))):
        here = Path(current)
        _inspect_path(here)
        kept = []
        for name in sorted(directories):
            child = here / name
            _inspect_path(child)
            if name.lower() not in excluded:
                kept.append(name)
        directories[:] = kept
        for name in sorted(filenames):
            child = here / name
            _source_file(child, source_root)
            if _DATABASE_NAME.search(name):
                _fail('database in program/runtime tree rejected before copying: ' + str(child))
            lowered = name.lower()
            if lowered.startswith('.env') or lowered.endswith(('.pth', '.pyc.tmp')):
                continue
            if python and (lowered in ('sitecustomize.py', 'usercustomize.py') or
                           lowered.startswith(('sitecustomize.', 'usercustomize.'))):
                continue
            if tests_only and child.suffix.lower() not in _TEST_SUFFIXES:
                continue
            _reject_database_header(child, source_root)
            selected.append(child)
    return selected


def _validated_identity(boundary):
    marker = boundary.path(boundary.root / 'isolation-identity.json')
    _source_file(marker, boundary.root)
    if marker.stat().st_size > 4096:
        _fail('invalid isolation identity marker')
    try:
        identity = json.loads(marker.read_text(encoding='utf-8'))
        if set(identity) != {'namespace', 'sid'} or str(uuid.UUID(identity['namespace'])) != identity['namespace']:
            raise ValueError('namespace')
        if not re.fullmatch(r'S-1-5-21-\d+-\d+-\d+-\d+', identity['sid']):
            raise ValueError('sid')
    except (ValueError, TypeError, KeyError, AttributeError) as exc:
        _fail('invalid isolation identity marker: ' + str(exc))
    return marker


def _copy_verified(source, destination, source_root, boundary):
    before = _source_file(source, source_root)
    boundary.mkdir(destination.parent)
    destination = boundary.path(destination)
    digest = hashlib.sha256()
    flags = os.O_RDONLY | getattr(os, 'O_BINARY', 0) | getattr(os, 'O_NOFOLLOW', 0)
    source_fd = os.open(source, flags)
    try:
        opened = os.fstat(source_fd)
        if _identity(opened) != _identity(before) or opened.st_nlink != 1:
            _fail('source changed before copy')
        target_fd = os.open(destination, os.O_WRONLY | os.O_CREAT | os.O_EXCL |
                            getattr(os, 'O_BINARY', 0), 0o600)
        try:
            first_block = True
            while block := os.read(source_fd, 1024 * 1024):
                if first_block and block.startswith(b'SQLite format 3\x00'):
                    _fail('database appeared after package preflight')
                first_block = False
                digest.update(block)
                view = memoryview(block)
                while view:
                    count = os.write(target_fd, view)
                    view = view[count:]
            os.fsync(target_fd)
            copied = os.fstat(target_fd)
            after = _source_file(source, source_root)
            if (_identity(after), after.st_size, after.st_mtime_ns, after.st_nlink) != (
                    _identity(before), before.st_size, before.st_mtime_ns, before.st_nlink):
                _fail('source changed during copy')
            boundary.path(destination)
            if _identity(destination.stat()) != _identity(copied) or copied.st_size != before.st_size:
                _fail('destination changed during copy')
        finally:
            os.close(target_fd)
    finally:
        os.close(source_fd)
    return {'size': before.st_size, 'sha256': digest.hexdigest()}


def _release_helper():
    import importlib.util
    helper = Path(__file__).with_name('sandbox-release-inclusion.py')
    _source_file(helper, helper.parent.resolve(strict=True))
    spec = importlib.util.spec_from_file_location('sandbox_release_inclusion', helper)
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    return module


def plan_release_inclusion(owned_root, inclusion):
    """Read-only plan of an explicitly sealed candidate; starts no program."""
    import sys
    boundary = _Boundary(owned_root)
    packaging = sys.modules.get(__name__)
    if packaging is None:
        from types import SimpleNamespace
        packaging = SimpleNamespace(**globals())
    return _release_helper().plan(boundary, inclusion, packaging)


def _engine_helper():
    import importlib.util
    helper = Path(__file__).with_name('sandbox-engine-inclusion.py')
    _source_file(helper, helper.parent.resolve(strict=True))
    spec = importlib.util.spec_from_file_location('sandbox_engine_inclusion', helper)
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    return module


def plan_engine_inclusion(owned_root):
    from types import SimpleNamespace
    return _engine_helper().plan(owned_root, SimpleNamespace(**globals()))


def build_package(owned_root, python_root, *, output=None, release_inclusion=None, original_engine=False):
    """Return summary after building a fresh package with no operational data."""
    boundary = _Boundary(owned_root)
    marker = _validated_identity(boundary)
    output = boundary.path(output or boundary.root / 'sandbox/input/package')
    mapped_parent = boundary.path(boundary.root / 'sandbox/input')
    if output.parent != mapped_parent:
        _fail('package output must be a direct child of owned sandbox/input')
    if not re.fullmatch(r'package(?:-v[1-9][0-9]*)?', output.name):
        _fail('package output name must be package or package-v followed by digits')
    if output.exists():
        _fail('output already exists; do not overwrite a previously mapped package')
    python_root = _plain_path(python_root)
    _inspect_path(python_root)
    if not python_root.is_dir():
        _fail('approved Python runtime directory missing')
    python_root = python_root.resolve(strict=True)
    for production in _PRODUCTION_ROOTS:
        try:
            denied = _contained(production.absolute(), python_root)
        except ValueError:
            denied = False
        if denied:
            _fail('production or maintained baseline cannot supply runtime files')
    selected = [(marker, Path('isolation-identity.json'), boundary.root)]
    node = boundary.path(boundary.root / 'stage1/tools/node.exe')
    if not node.is_file():
        _fail('owned Node runtime is required')
    for name in ('project', 'stage1', 'tests'):
        folder = boundary.path(boundary.root / name)
        for source in _walk_files(folder, boundary.root, _EXCLUDED_DIRS,
                                  tests_only=name == 'tests'):
            selected.append((source, source.relative_to(boundary.root), boundary.root))
    for name in _RUNTIME_BINARIES:
        source = python_root / name
        if not source.is_file():
            _fail('required Python runtime binary missing: ' + name)
        _source_file(source, python_root)
        selected.append((source, Path('PythonRuntime') / name, python_root))
    for name in ('DLLs', 'Lib'):
        for source in _walk_files(python_root / name, python_root, _PYTHON_EXCLUDED_DIRS,
                                  python=True):
            selected.append((source, Path('PythonRuntime') / source.relative_to(python_root), python_root))
    release_plan = plan_release_inclusion(boundary.root, release_inclusion) if release_inclusion else None
    if type(original_engine) is not bool or original_engine and not release_plan:
        _fail('reviewed original engine requires explicit sealed candidate resources')
    engine_plan = plan_engine_inclusion(boundary.root) if original_engine else None
    release_expected = {}
    if release_plan:
        release_expected[release_plan['descriptorPath']] = {
            'size': release_plan['descriptorSize'], 'sha256': release_plan['descriptorSha256']}
        for row in release_plan['files']:
            source = boundary.path(row['source'])
            relative = Path(row['destination'])
            selected.append((source, relative, boundary.root))
            release_expected[relative.as_posix()] = {'size': row['size'], 'sha256': row['sha256']}
    if engine_plan:
        for row in engine_plan['files']:
            source = boundary.path(row['source'])
            relative = Path(row['destination'])
            selected.append((source, relative, boundary.root))
            if relative.as_posix() in release_expected:
                _fail('engine and resource manifest paths overlap')
            release_expected[relative.as_posix()] = {'size': row['size'], 'sha256': row['sha256']}
    # Validate the complete source/target plan before creating or reading output.
    folded = set()
    for source, relative, source_root in selected:
        key = relative.as_posix().casefold()
        if key in folded or key == 'package-manifest.json':
            _fail('ambiguous duplicate package path')
        folded.add(key)
        _source_file(source, source_root)
        boundary.path(output / relative)
    boundary.mkdir(output)
    rows = []
    for source, relative, source_root in selected:
        result = _copy_verified(source, output / relative, source_root, boundary)
        expected_release = release_expected.get(relative.as_posix())
        if expected_release and result != expected_release:
            _fail('sealed release resource changed after preflight')
        rows.append({'path': relative.as_posix(), **result})
    if release_plan and plan_release_inclusion(boundary.root, release_inclusion) != release_plan:
        _fail('sealed release tree or description changed after copy')
    if engine_plan and plan_engine_inclusion(boundary.root) != engine_plan:
        _fail('reviewed original engine seal changed after copy')
    rows.sort(key=lambda row: row['path'])
    manifest = {
        'version': 1,
        'createdAt': datetime.now(timezone.utc).isoformat(),
        'purpose': 'data-free offline isolated development',
        'fileCount': len(rows), 'totalBytes': sum(row['size'] for row in rows),
        'files': rows,
    }
    if release_plan:
        manifest['releaseInclusion'] = {key: value for key, value in release_plan.items() if key != 'files'}
    if engine_plan:
        manifest['engineInclusion'] = {key: value for key, value in engine_plan.items() if key != 'files'}
    manifest_path = boundary.path(output / 'package-manifest.json')
    with manifest_path.open('x', encoding='utf-8', newline='\n') as handle:
        json.dump(manifest, handle, ensure_ascii=False, indent=2)
        handle.write('\n')
        handle.flush()
        os.fsync(handle.fileno())
    boundary.path(manifest_path)
    return {'output': str(output), 'fileCount': manifest['fileCount'],
            'totalBytes': manifest['totalBytes'], 'manifest': str(manifest_path)}


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--root', required=True, help='existing identified isolated root')
    parser.add_argument('--python-root', required=True, help='read-only approved portable runtime source')
    parser.add_argument('--output', help='new direct child of root/sandbox/input')
    parser.add_argument('--release-inclusion', help='explicit Root-sealed resource inclusion descriptor inside owned root')
    parser.add_argument('--original-engine', action='store_true', help='include only the fixed reviewed owned original engine with candidate resources')
    args = parser.parse_args()
    try:
        print(json.dumps(build_package(args.root, args.python_root, output=args.output,
                                       release_inclusion=args.release_inclusion, original_engine=args.original_engine),
                         ensure_ascii=False, indent=2))
    except (RuntimeError, OSError) as exc:
        parser.exit(1, str(exc) + '\n')


if __name__ == '__main__':
    main()
