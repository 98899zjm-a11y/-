"""Preserve only the proven failed native-a4 test profile by one atomic rename.

Root-only actual Guest operation. No business execution, database query, profile
adoption, deletion, replacement, rollback, retry or profile-content export.
"""
from pathlib import Path
import argparse
import ast
import atexit
import ctypes
from ctypes import wintypes
import hashlib
import importlib.util
import json
import os
import re
import socket
import stat
import subprocess
import sys
import types

ROOT = Path('C:/xjy-work/xjy-web-stage1')
RESULTS = Path('C:/xjy-results')
PYTHON = Path('C:/Python314/python.exe')
PROFILE = ROOT/'config/desktop-profile'
PRESERVED = ROOT/'runtime/release162-selfcheck-a4/profile-preserved'
REPORT = RESULTS/'native162-a4-profile-preserved-a1.json'
ARTIFACTS = RESULTS/'release162-native-a4-artifacts'
OLD_OUT = ROOT/'runtime/release162-selfcheck-a4/out'
NAMESPACE = '36fcbe9c-ece1-4be3-af35-309a2ee19e05'
A4_SHA = '1b79de0e260a71a4e86901f39aae06dbc7b9676f65e5bbd14ae4d4325736b889'
PYTHON_SHA = '434b361fe0c5960d404974feed493db47f2603a1ace2574312104fbed0182c6f'
RESULT_SHA = '3826dd7dcdb423618f454dc8b9ea98734a55103f3768acda1a1de7c1fc20ca9b'
ERROR_SHA = 'c08bd3687f9e0cfef64f4751418ca72a5bf818331cf470f1e0b32d438cefe1b9'
OWNER_SHA = '48f90d037317cda8edb8f3eb12d69e96bd8a6a8b87e5c13e7edfabbf553d9a40'
OWNER_NAME = 'release162-selfcheck-owner.json'
OWNER = {'version': 1, 'purpose': 'release162-built-in-self-check',
         'namespace': NAMESPACE, 'runId': 'release162-selfcheck-a4'}
PORTS = (31831, 42791, 42792, 42793, 42831)
PINS = {
    'stage1/sandbox-context.py': '09426dfd4d699c51570e1f1b10c2e37c00f6feb699b9a472ca710ae5242bf249',
    'stage1/validate-sandbox-context.py': '867a0117d6bc200960df06a355ffafcf639f24532ece3bc4db34f6e397325207',
    'stage1/sandbox-guest-candidate-driver.py': '60162279505ef51453f7b571f09a48d529e1879d8df4070acd955bd0156db8f6',
    'stage1/run-restricted.py': '742e25f5405f69a345c7557e19bfa674a490ae0e57c9d5c957922a9e41b6b1bc',
    'audit-tools/current-ui-driver.py': '5fa86ec6e643ed113d10ecb6b8d8c83193e9d2c64d54a34abe8495ff5546193a',
}


def initial_read(file, pin, boundary):
    """Bounded ordinary source read used only before loading pinned QA helpers."""
    def stable_stamp(info):
        return tuple(getattr(info, key, None) for key in
                     ('st_dev', 'st_ino', 'st_size', 'st_mtime_ns', 'st_ctime_ns',
                      'st_nlink', 'st_birthtime_ns', 'st_file_attributes'))

    if not file.is_absolute() or not file.is_relative_to(boundary):
        raise RuntimeError('FIXED_BOOTSTRAP_SOURCE_REQUIRED')
    for item in (file, *file.parents):
        info = item.lstat()
        if (stat.S_ISLNK(info.st_mode) or getattr(info, 'st_file_attributes', 0) & 0x400
                or stat.S_ISREG(info.st_mode) and info.st_nlink != 1):
            raise RuntimeError('BOOTSTRAP_LINK_REFUSED')
        if item != file and not stat.S_ISDIR(info.st_mode):
            raise RuntimeError('BOOTSTRAP_ANCESTOR_REQUIRED')
    before = file.stat()
    if not stat.S_ISREG(before.st_mode) or not 0 <= before.st_size <= 2*1024*1024:
        raise RuntimeError('BOUNDED_BOOTSTRAP_SOURCE_REQUIRED')
    fields = ('st_dev', 'st_ino', 'st_size', 'st_mtime_ns', 'st_nlink')
    with file.open('rb') as stream:
        opened = os.fstat(stream.fileno())
        if any(getattr(before, key) != getattr(opened, key) for key in fields):
            raise RuntimeError('BOOTSTRAP_OPEN_CHANGED')
        body = stream.read(2*1024*1024+1)
        if len(body) != opened.st_size or stable_stamp(os.fstat(stream.fileno())) != stable_stamp(opened):
            raise RuntimeError('BOOTSTRAP_HANDLE_CHANGED')
    if stable_stamp(file.stat()) != stable_stamp(before) or hashlib.sha256(body).hexdigest() != pin:
        raise RuntimeError('BOOTSTRAP_SOURCE_CHANGED')
    return body


def main():
    if (os.name != 'nt' or Path(__file__).absolute() != ROOT/'audit-tools/preserve-native162-a4-profile.py'
            or Path(sys.executable) != PYTHON or not sys.flags.isolated or not sys.flags.no_site
            or not sys.dont_write_bytecode or sys.flags.optimize
            or sys.version_info[:3] != (3, 14, 8) or importlib.util.MAGIC_NUMBER.hex() != '2b0e0d0a'):
        raise RuntimeError('FIXED_ACTUAL_GUEST_PYTHON_I_B_S_REQUIRED')
    parser = argparse.ArgumentParser(allow_abbrev=False)
    parser.add_argument('--source-sha256', required=True)
    args = parser.parse_args()
    if not re.fullmatch(r'[a-f0-9]{64}', args.source_sha256):
        raise RuntimeError('FULL_SOURCE_SHA_REQUIRED')
    initial_read(Path(__file__), args.source_sha256, ROOT)
    initial_read(PYTHON, PYTHON_SHA, PYTHON.parent)
    helper_file = ROOT/'audit-tools/release162-selfcheck-a4.py'
    helper_body = initial_read(helper_file, A4_SHA, ROOT)
    names = {'need', 'ordinary', 'digest', 'identity', 'same_object', 'stable_bytes',
             'read_json', 'pinned_defs'}
    definitions = [node for node in ast.parse(helper_body).body
                   if isinstance(node, ast.FunctionDef) and node.name in names]
    if len(definitions) != len(names):
        raise RuntimeError('EXACT_A4_PURE_HELPERS_REQUIRED')
    helpers = dict(ROOT=ROOT, PINS=PINS, Path=Path, os=os, stat=stat,
                   hashlib=hashlib, json=json, ast=ast)
    exec(compile(ast.Module(body=definitions, type_ignores=[]), str(helper_file), 'exec', dont_inherit=True), helpers)
    need, ordinary = helpers['need'], helpers['ordinary']
    stable_bytes, read_json, pinned_defs = helpers['stable_bytes'], helpers['read_json'], helpers['pinned_defs']
    for relative in ('stage1/sandbox-context.py', 'stage1/validate-sandbox-context.py'):
        need(helpers['digest'](ROOT/relative) == PINS[relative], 'ORIGINAL_GUARD_CHANGED')
    guard = types.ModuleType('native162_profile_preservation_context')
    guard.__file__ = str(ROOT/'stage1/sandbox-context.py')
    guard_body = stable_bytes(Path(guard.__file__))
    need(hashlib.sha256(guard_body).hexdigest() == PINS['stage1/sandbox-context.py'], 'ORIGINAL_GUARD_CHANGED')
    exec(compile(guard_body, guard.__file__, 'exec', dont_inherit=True), guard.__dict__)
    proof = guard.read_context(ROOT)
    need(read_json(ROOT/'isolation-identity.json')['namespace'] == NAMESPACE, 'EXACT_NAMESPACE_REQUIRED')
    ns = dict(ROOT=ROOT, Path=Path, os=os, stat=stat, hashlib=hashlib,
              json=json, subprocess=subprocess, socket=socket)
    original = pinned_defs('stage1/sandbox-guest-candidate-driver.py',
                           {'validate_proof', 'ordinary', 'checked_hash', 'require_synthetic_data',
                            'process_snapshot', 'port_open'}, ns)

    def actual_context():
        for relative in ('stage1/sandbox-context.py', 'stage1/validate-sandbox-context.py'):
            need(helpers['digest'](ROOT/relative) == PINS[relative], 'ORIGINAL_GUARD_CHANGED')
        return original['validate_proof'](guard.read_context(ROOT))

    ns['actual_context'] = actual_context
    original['validate_proof'](proof)
    kernel = ctypes.WinDLL('kernel32', use_last_error=True)
    kernel.CreateMutexW.argtypes = [ctypes.c_void_p, wintypes.BOOL, wintypes.LPCWSTR]
    kernel.CreateMutexW.restype = wintypes.HANDLE
    kernel.WaitForSingleObject.argtypes = [wintypes.HANDLE, wintypes.DWORD]
    kernel.ReleaseMutex.argtypes = [wintypes.HANDLE]
    kernel.CloseHandle.argtypes = [wintypes.HANDLE]
    mutex = pinned_defs('stage1/run-restricted.py', {'checked', 'lock_namespace'},
                        dict(C=ctypes, kernel=kernel, atexit=atexit))
    mutex['lock_namespace'](NAMESPACE)
    data_files = pinned_defs('audit-tools/current-ui-driver.py', {'require_closed_data_files'},
                             dict(ctypes=ctypes, ROOT=ROOT, package=types.SimpleNamespace(ordinary=ordinary)))

    def quiet():
        actual_context()
        original['require_synthetic_data']()
        need(not (ROOT/'runtime/host-ready.json').exists(), 'OLD_HOST_READY_MARKER_PRESENT')
        for row in original['process_snapshot']():
            executable = str(row.get('ExecutablePath') or '').replace('\\', '/').casefold()
            command = str(row.get('CommandLine') or '').replace('\\', '/').casefold()
            name = str(row.get('Name') or '').casefold()
            need(not (name in ('鑫金源珠宝报价.exe', 'electron.exe') or executable.endswith('/鑫金源珠宝报价.exe')
                      or executable.startswith(str(ROOT).replace('\\', '/').casefold()+'/') and executable.endswith('.exe')
                      or 'stage1/host.cjs' in command), 'OLD_APP_OR_OWNED_EXE_ACTIVE')
        need(not any(original['port_open'](port) for port in PORTS), 'FIXED_TCP_PORT_BUSY')
        data_files['require_closed_data_files']()

    def evidence():
        result = read_json(ARTIFACTS/'result.json', RESULTS, RESULT_SHA)
        need(stable_bytes(OLD_OUT/'result.json') == stable_bytes(ARTIFACTS/'result.json', RESULTS),
             'LOCAL_AND_EXPORTED_A4_RESULT_DIFFER')
        error = stable_bytes(ARTIFACTS/'startup-error.txt', RESULTS, 8192)
        need(hashlib.sha256(error).hexdigest() == ERROR_SHA and error.decode('utf-8').strip() == 'Error: UnknownVizError',
             'EXACT_A4_CAPTURE_ERROR_REQUIRED')
        need(stable_bytes(OLD_OUT/'startup-error.txt', ROOT, 8192) == error, 'LOCAL_AND_EXPORTED_A4_ERROR_DIFFER')
        need(result.get('status') == 'FAILED' and result.get('passed') is False and result.get('exitCode') == 1
             and result.get('programLaunched') is True and result.get('forcedStop') is False
             and result.get('cdpUsed') is False and result.get('productionTouched') is False
             and result.get('actualContext') == proof
             and result.get('sourceSha256') == A4_SHA and result.get('syntheticNamespace') == NAMESPACE
             and result.get('profileOwnerSha256') == OWNER_SHA and result.get('verifiedProgramFiles') == 1079
             and result.get('argv') == ['--self-check'] and result.get('refusal') == 'ACTUAL_SELFCHECK_NONZERO_EXIT',
             'EXACT_FAILED_A4_RESULT_REQUIRED')

    def snapshot(directory):
        def refuse_walk_error(error):
            raise error

        need(ordinary(directory).is_dir(), 'ORDINARY_PROFILE_DIRECTORY_REQUIRED')
        directories, files, folded, total = ['.'], [], set(), 0
        for folder, children, names in os.walk(directory, followlinks=False, onerror=refuse_walk_error):
            for name in children + names:
                file = ordinary(Path(folder)/name)
                relative = file.relative_to(directory).as_posix()
                need(len(file.relative_to(directory).parts) <= 32 and len(relative) <= 512 and relative.casefold() not in folded,
                     'BOUNDED_UNIQUE_PROFILE_PATH_REQUIRED')
                folded.add(relative.casefold())
                if file.is_dir():
                    directories.append(relative)
                    need(len(directories) <= 2048, 'PROFILE_DIRECTORY_LIMIT')
                else:
                    body = stable_bytes(file, ROOT, 64*1024*1024)
                    total += len(body)
                    need(total <= 256*1024*1024 and len(files) < 4096, 'PROFILE_BYTE_OR_FILE_LIMIT')
                    files.append({'path': relative, 'size': len(body), 'sha256': hashlib.sha256(body).hexdigest()})
        return {'directories': sorted(directories), 'files': sorted(files, key=lambda row: row['path']), 'bytes': total}

    quiet()
    evidence()
    need(read_json(PROFILE/OWNER_NAME, ROOT, OWNER_SHA) == OWNER, 'EXACT_A4_PROFILE_OWNER_REQUIRED')
    connection = PROFILE/'workspace-connection.json'
    if os.path.lexists(connection):
        connection_value = json.loads(stable_bytes(connection, ROOT, 8192))
        need(connection_value.get('version') == 1 and connection_value.get('mode') == 'standalone',
             'STANDALONE_TEST_PROFILE_REQUIRED')
    ordinary(PRESERVED)
    ordinary(REPORT, RESULTS)
    need(not os.path.lexists(PRESERVED) and not os.path.lexists(REPORT), 'CREATE_NEW_PRESERVATION_TARGET_REQUIRED')
    need(PRESERVED.parent.is_dir() and RESULTS.is_dir(), 'EXISTING_OUTPUT_PARENT_REQUIRED')
    actual_root = ROOT.resolve(strict=True)
    source_resolved, target_resolved = PROFILE.resolve(strict=True), PRESERVED.resolve(strict=False)
    need(source_resolved.is_relative_to(actual_root) and target_resolved.is_relative_to(actual_root)
         and os.path.normcase(str(source_resolved)) == os.path.normcase(str(PROFILE))
         and os.path.normcase(str(target_resolved)) == os.path.normcase(str(PRESERVED)), 'RESOLVED_ROOT_CONTAINMENT_REQUIRED')
    need(PROFILE.stat().st_dev == PRESERVED.parent.stat().st_dev, 'SAME_VOLUME_ATOMIC_RENAME_REQUIRED')
    before = snapshot(PROFILE)
    need(len(json.dumps(before, ensure_ascii=False, indent=2).encode('utf-8')) <= 1024*1024,
         'PROFILE_MANIFEST_SIZE_LIMIT')
    quiet()
    evidence()
    need(snapshot(PROFILE) == before and read_json(PROFILE/OWNER_NAME, ROOT, OWNER_SHA) == OWNER,
         'PROFILE_CHANGED_BEFORE_RENAME')
    need(not os.path.lexists(PRESERVED) and not os.path.lexists(REPORT), 'TARGET_APPEARED_BEFORE_RENAME')
    report = {'version': 1, 'purpose': 'preserve-proven-failed-native162-a4-profile', 'passed': False,
              'sourceSha256': args.source_sha256, 'actualGuest': proof, 'namespace': NAMESPACE,
              'source': str(PROFILE), 'preserved': str(PRESERVED), 'a4ResultSha256': RESULT_SHA,
              'a4ErrorSha256': ERROR_SHA, 'a4OwnerSha256': OWNER_SHA, 'manifest': before,
              'renameAttempted': False, 'renamed': False, 'profileContentsExported': False,
              'databaseOpened': False, 'programExecuted': False, 'rollbackAttempted': False}
    try:
        report['renameAttempted'] = True
        os.rename(PROFILE, PRESERVED)  # Windows: one same-volume atomic rename; existing target is refused.
        report['renamed'] = True
        need(not os.path.lexists(PROFILE), 'OLD_PROFILE_PATH_STILL_PRESENT')
        ordinary(PRESERVED)
        need(PRESERVED.resolve(strict=True) == target_resolved and snapshot(PRESERVED) == before,
             'PRESERVED_PROFILE_TREE_CHANGED')
        need(read_json(PRESERVED/OWNER_NAME, ROOT, OWNER_SHA) == OWNER, 'PRESERVED_OWNER_CHANGED')
        quiet()
        evidence()
        need(helpers['digest'](helper_file) == A4_SHA and helpers['digest'](Path(__file__)) == args.source_sha256,
             'QA_SOURCE_CHANGED')
        report.update(passed=True, completeTreePreserved=True, emptyDirectoriesIncluded=True)
    except Exception as error:
        report['error'] = str(error)
    body = (json.dumps(report, ensure_ascii=False, indent=2)+'\n').encode('utf-8')
    ordinary(REPORT, RESULTS)
    with REPORT.open('xb') as stream:
        stream.write(body)
        stream.flush()
        os.fsync(stream.fileno())
    need(stable_bytes(REPORT, RESULTS) == body, 'PRESERVATION_REPORT_READBACK_FAILED')
    print(json.dumps({'passed': report['passed'], 'renamed': report['renamed'], 'report': str(REPORT)}))
    return 0 if report['passed'] else 1


if __name__ == '__main__':
    raise SystemExit(main())
