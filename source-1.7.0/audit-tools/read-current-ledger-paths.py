"""Explicitly authorized Host metadata only; never open a business database.

The only F: content read is the exact bounded module-settings JSON. Database,
WAL and SHM paths receive lstat only. This does not prove a live connection.
The tool never creates or writes a file; bounded metadata JSON goes to stdout.
Do not run before the user separately approves the scope in the companion plan.
"""

import argparse
import ctypes
from ctypes import wintypes
import datetime
import hashlib
import json
import msvcrt
import ntpath
import os
from pathlib import Path
import re
import stat
import sys

WORKSPACE = Path('E:/codex/2026-10-15/work/xjy-v16-deep-audit')
SELF = WORKSPACE / 'audit-tools/read-current-ledger-paths.py'
DATA_ROOT = Path('F:/鑫金源珠宝资料')
SETTINGS = DATA_ROOT / '程序设置/legacy-module-settings.json'
SOURCE_DEFAULT = DATA_ROOT / '内帐'
SETTINGS_LIMIT = 64 * 1024
STDOUT_LIMIT = 16 * 1024


class Refused(Exception):
    pass


def fail(code):
    raise Refused(code)


def norm(value):
    return ntpath.normcase(ntpath.normpath(str(value)))


def lexical(value, root):
    raw = str(value)
    if not raw or '\x00' in raw or raw.startswith(('\\\\', '//')):
        fail('NON_CANONICAL_PATH')
    drive, tail = ntpath.splitdrive(raw)
    if not re.fullmatch('[A-Za-z]:', drive) or not tail.startswith(('\\', '/')):
        fail('ABSOLUTE_LOCAL_PATH_REQUIRED')
    parts = tail.replace('\\', '/').split('/')[1:]
    if parts and parts[-1] == '':
        parts.pop()
    for part in parts:
        if (not part or part in ('.', '..') or part.endswith((' ', '.')) or
                any(ord(char) < 32 or char in '<>:"|?*' for char in part) or
                re.fullmatch(r'(?i:CON|PRN|AUX|NUL|COM[1-9]|LPT[1-9])(?:\..*)?', part)):
            fail('NON_CANONICAL_COMPONENT')
    path = Path(ntpath.normpath(raw))
    try:
        if ntpath.commonpath((norm(path), norm(root))) != norm(root):
            fail('PATH_OUTSIDE_APPROVED_ROOT')
    except ValueError:
        fail('PATH_OUTSIDE_APPROVED_ROOT')
    return path


def identity(info):
    return (info.st_dev, info.st_ino, info.st_mode, info.st_nlink,
            getattr(info, 'st_file_attributes', 0))


def ordinary(info):
    if stat.S_ISLNK(info.st_mode) or getattr(info, 'st_file_attributes', 0) & 0x400:
        fail('LINK_OR_REPARSE_REJECTED')
    if info.st_nlink != 1:
        fail('HARDLINK_OR_NONUNIQUE_ENTRY_REJECTED')
    if not (stat.S_ISREG(info.st_mode) or stat.S_ISDIR(info.st_mode)):
        fail('ORDINARY_ENTRY_REQUIRED')


def checked(value, root, *, kind, missing=False):
    """Inspect exact ancestors only; resolve directories, never DB file handles."""
    path = lexical(value, root)
    chain = []
    for current in (*reversed(path.parents), path):
        try:
            info = current.lstat()
        except FileNotFoundError:
            if missing:
                return path, None, chain
            fail('REQUIRED_PATH_MISSING')
        ordinary(info)
        chain.append((current, identity(info)))
        if current != path or kind == 'directory':
            if not stat.S_ISDIR(info.st_mode):
                fail('ANCESTOR_DIRECTORY_REQUIRED')
            if norm(os.path.realpath(current, strict=True)) != norm(current):
                fail('REAL_DIRECTORY_PATH_MISMATCH')
        elif not stat.S_ISREG(info.st_mode):
            fail('ORDINARY_FILE_REQUIRED')
    return path, info, chain


def recheck(chain):
    for path, expected in chain:
        current = path.lstat()
        ordinary(current)
        if identity(current) != expected:
            fail('PATH_IDENTITY_CHANGED')


def final_descriptor_path(descriptor, expected):
    # Metadata for the already-open config descriptor only. No DB handle.
    kernel = ctypes.WinDLL('kernel32', use_last_error=True)
    get_path = kernel.GetFinalPathNameByHandleW
    get_path.argtypes = (wintypes.HANDLE, wintypes.LPWSTR, wintypes.DWORD, wintypes.DWORD)
    get_path.restype = wintypes.DWORD
    handle = wintypes.HANDLE(msvcrt.get_osfhandle(descriptor))
    needed = get_path(handle, None, 0, 0)
    if not needed or needed > 32768:
        fail('DESCRIPTOR_PATH_UNAVAILABLE')
    buffer = ctypes.create_unicode_buffer(needed + 1)
    count = get_path(handle, buffer, len(buffer), 0)
    if not count or count >= len(buffer):
        fail('DESCRIPTOR_PATH_UNAVAILABLE')
    value = buffer.value
    if value.startswith('\\\\?\\UNC\\'):
        fail('DESCRIPTOR_PATH_NOT_LOCAL')
    if value.startswith('\\\\?\\'):
        value = value[4:]
    if norm(value) != norm(expected):
        fail('DESCRIPTOR_REAL_PATH_MISMATCH')


def file_stamp(info):
    # Used only within the same API: preserve each API's own ctime semantics.
    return (*identity(info), info.st_size, info.st_mtime_ns, info.st_ctime_ns,
            getattr(info, 'st_birthtime_ns', None))


def same_common_file(left, right):
    # Windows path-lstat and fd-fstat may expose different ctime semantics.
    # Compare only common identity/type/size/mtime fields across these APIs.
    def common(info):
        return (info.st_dev, info.st_ino, stat.S_IFMT(info.st_mode), info.st_nlink,
                info.st_size, info.st_mtime_ns)
    if common(left) != common(right):
        return False
    left_birth = getattr(left, 'st_birthtime_ns', None)
    right_birth = getattr(right, 'st_birthtime_ns', None)
    if left_birth is None or right_birth is None or left_birth <= 0 or right_birth <= 0:
        return True
    return left_birth == right_birth


def bounded_read(descriptor, limit):
    parts = []; count = 0
    while True:
        block = os.read(descriptor, min(65536, limit + 1 - count))
        if not block:
            return b''.join(parts)
        parts.append(block); count += len(block)
        if count > limit:
            fail('CONTENT_READ_LIMIT_EXCEEDED')


def unique_object(pairs):
    result = {}
    for key, value in pairs:
        if key in result:
            fail('DUPLICATE_JSON_KEY')
        result[key] = value
    return result


def settings_schema(body):
    try:
        value = json.loads(body.decode('utf-8'), object_pairs_hook=unique_object,
                           parse_constant=lambda value: fail('NONSTANDARD_JSON_CONSTANT'))
    except (UnicodeError, ValueError):
        fail('INVALID_SETTINGS_JSON')
    if (type(value) is not dict or set(value) != {'version', 'modules'} or
            type(value['version']) is not int or value['version'] != 1 or
            type(value['modules']) is not dict or set(value['modules']) - {'ledger', 'inventory'}):
        fail('UNKNOWN_SETTINGS_SCHEMA')
    for entry in value['modules'].values():
        if type(entry) is not dict or set(entry) != {'dataDir'} or type(entry['dataDir']) is not str:
            fail('UNKNOWN_MODULE_SETTINGS_SCHEMA')
        lexical(entry['dataDir'], DATA_ROOT)
    return value


def utc_time(seconds):
    return datetime.datetime.fromtimestamp(seconds, datetime.timezone.utc).isoformat()


def database_metadata(directory):
    target, _, directory_chain = checked(directory, DATA_ROOT, kind='directory', missing=True)
    # If a selected directory is absent, do not create it or claim connection.
    observations = {}
    for name in ('ledger.db', 'ledger.db-wal', 'ledger.db-shm'):
        _, info, chain = checked(target / name, DATA_ROOT, kind='file', missing=True)
        recheck(chain)
        observations[name] = {'exists': info is not None}
        if name == 'ledger.db':
            observations[name].update(bytes=info.st_size if info else None,
                                      modifiedAtUtc=utc_time(info.st_mtime) if info else None,
                                      modifiedTimeNs=info.st_mtime_ns if info else None,
                                      createdAtUtc=utc_time(getattr(info, 'st_birthtime', info.st_ctime)) if info else None)
    recheck(directory_chain)
    return observations


def inspect_settings():
    path, info, chain = checked(SETTINGS, DATA_ROOT, kind='file', missing=True)
    fallback = {'source': 'source-defined-default-unverified', 'dataDir': str(SOURCE_DEFAULT),
                'actualProcessConnectionVerified': False, 'databaseMetadata': None}
    if info is None:
        recheck(chain)
        try:
            path.lstat()
        except FileNotFoundError:
            pass
        else:
            fail('SETTINGS_APPEARED_DURING_OBSERVATION')
        return {'exists': False, 'version': None, 'sha256Before': None, 'sha256After': None}, fallback
    if info.st_size > SETTINGS_LIMIT:
        fail('SETTINGS_TOO_LARGE')
    descriptor = os.open(path, os.O_RDONLY | os.O_BINARY | os.O_NOINHERIT)
    try:
        before = os.fstat(descriptor); ordinary(before)
        if not same_common_file(info, before):
            fail('SETTINGS_CHANGED_BEFORE_OPEN')
        final_descriptor_path(descriptor, path)
        first = bounded_read(descriptor, SETTINGS_LIMIT)
        if len(first) != before.st_size:
            fail('SETTINGS_SIZE_CHANGED')
        value = settings_schema(first)
        selected = value['modules'].get('ledger')
        if selected is None:
            selection = fallback
        else:
            directory = lexical(selected['dataDir'], DATA_ROOT)
            selection = {'source': 'saved-ledger-dataDir', 'dataDir': str(directory),
                         'actualProcessConnectionVerified': False,
                         'databaseMetadata': database_metadata(directory)}
        os.lseek(descriptor, 0, os.SEEK_SET)
        second = bounded_read(descriptor, SETTINGS_LIMIT)
        after = os.fstat(descriptor); ordinary(after)
        final_descriptor_path(descriptor, path)
        recheck(chain)
        path_after = path.lstat(); ordinary(path_after)
        if (first != second or file_stamp(info) != file_stamp(path_after) or
                file_stamp(before) != file_stamp(after) or not same_common_file(path_after, after)):
            fail('SETTINGS_CHANGED_DURING_OBSERVATION')
        return {'exists': True, 'version': value['version'], 'sha256Before': hashlib.sha256(first).hexdigest(),
                'sha256After': hashlib.sha256(second).hexdigest(), 'sameDescriptorAndStat': True,
                'pathStampStable': True, 'descriptorStampStable': True}, selection
    finally:
        os.close(descriptor)


def main():
    parser = argparse.ArgumentParser(description=__doc__, allow_abbrev=False)
    parser.add_argument('--authorized-metadata-only', action='store_true')
    parser.add_argument('--source-sha256', required=True)
    args = parser.parse_args()
    # No F: filesystem access occurs before both explicit operator gates.
    if os.name != 'nt' or not args.authorized_metadata_only:
        fail('EXPLICIT_HOST_METADATA_AUTHORIZATION_REQUIRED')
    if not re.fullmatch('[0-9a-f]{64}', args.source_sha256):
        fail('PINNED_SOURCE_SHA_REQUIRED')
    self_path, info, _ = checked(Path(__file__).absolute(), WORKSPACE, kind='file')
    if norm(self_path) != norm(SELF) or info.st_size > 128 * 1024:
        fail('FIXED_TOOL_PATH_REQUIRED')
    with self_path.open('rb') as source:
        body = source.read(128 * 1024 + 1)
    if hashlib.sha256(body).hexdigest() != args.source_sha256:
        fail('TOOL_SOURCE_SHA_MISMATCH')
    started = datetime.datetime.now(datetime.timezone.utc).isoformat()
    settings, selection = inspect_settings()
    report = {'version': 1, 'purpose': 'current-ledger-path-metadata-only', 'toolSourceSha256': args.source_sha256,
              'observationStartedAtUtc': started, 'observationEndedAtUtc': datetime.datetime.now(datetime.timezone.utc).isoformat(),
              'settings': settings, 'ledger': selection, 'databaseContentOpened': False,
              'liveProcessConnectionVerified': False, 'consistentBusinessSnapshotCreated': False}
    payload = (json.dumps(report, ensure_ascii=False, indent=2) + '\n').encode('utf-8')
    if len(payload) > STDOUT_LIMIT:
        fail('METADATA_STDOUT_LIMIT_EXCEEDED')
    print(payload.decode('utf-8'), end='')
    return 0


if __name__ == '__main__':
    try:
        raise SystemExit(main())
    except Refused as error:
        print(json.dumps({'ok': False, 'code': str(error)}), file=sys.stderr)
        raise SystemExit(1)
    except Exception as error:
        # Never print JSON contents, credentials or arbitrary exception text.
        print(json.dumps({'ok': False, 'code': 'METADATA_IO_OR_RUNTIME_FAILURE', 'type': type(error).__name__}), file=sys.stderr)
        raise SystemExit(1)
