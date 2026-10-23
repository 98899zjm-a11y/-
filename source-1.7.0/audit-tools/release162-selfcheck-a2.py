"""Root-only Guest launch of the existing packaged --self-check; no CDP admission."""
from pathlib import Path
import os
import sys

ROOT = Path(__file__).resolve().parents[1]
if os.name != 'nt' or str(ROOT).casefold() != 'c:\\xjy-work\\xjy-web-stage1':
    raise RuntimeError('Fixed actual Guest required before any launch or mutation')
if str(Path(sys.executable)).casefold() != 'c:\\python314\\python.exe' or not (sys.flags.isolated and sys.flags.no_site and sys.dont_write_bytecode):
    raise RuntimeError('Pinned public Python with -I -B -S required')

import argparse
import ast
import atexit
import ctypes
from ctypes import wintypes
from datetime import datetime, timezone
import hashlib
import json
import re
import socket
import stat
import struct
import subprocess
import types
import uuid

WORK = ROOT/'runtime/release162-selfcheck-a2'
PROGRAM, OUT = WORK/'program', WORK/'out'
PROFILE = ROOT/'config/desktop-profile'
TARGET = Path('C:/xjy-results/release-162-artifact-a2')
ENGINE = Path('C:/xjy-base/release-candidate')
TRUST = ROOT/'release-work/employee-real162-a1/public161/安装组件/delivery-tools/fresh-employee-trust.json'
PINS = {
    'python': '434b361fe0c5960d404974feed493db47f2603a1ace2574312104fbed0182c6f',
    'stage1/sandbox-context.py': '09426dfd4d699c51570e1f1b10c2e37c00f6feb699b9a472ca710ae5242bf249',
    'stage1/validate-sandbox-context.py': '867a0117d6bc200960df06a355ffafcf639f24532ece3bc4db34f6e397325207',
    'stage1/sandbox-guest-candidate-driver.py': '60162279505ef51453f7b571f09a48d529e1879d8df4070acd955bd0156db8f6',
    'stage1/run-restricted.py': '742e25f5405f69a345c7557e19bfa674a490ae0e57c9d5c957922a9e41b6b1bc',
    'audit-tools/current-ui-driver.py': '5fa86ec6e643ed113d10ecb6b8d8c83193e9d2c64d54a34abe8495ff5546193a',
}
MANIFEST_SHA = 'fe20ea7d83f2e2200624bf81364078ca8b206d1efcc8dbad03b1841d0fab9da2'
ASAR_SHA = '02a3dc5128203889fa88205020c39970f08305b4496e64507ca5ec5eab7f7568'
TRUST_SHA = '03e9a804fd6b34af15e267cac159c839bed791ab735a0a2dfb6f56151310d18f'
PORTS = (31831, 42791, 42792, 42793, 42831)


def need(value, code):
    if not value:
        raise RuntimeError(code)


def ordinary(value, boundary=ROOT):
    file = Path(value)
    need(file.is_absolute() and file.is_relative_to(boundary), 'PATH_OUTSIDE_FIXED_BOUNDARY')
    for item in (file, *file.parents):
        if item.exists() or item.is_symlink():
            info = item.lstat()
            need(not stat.S_ISLNK(info.st_mode) and not getattr(info, 'st_file_attributes', 0) & 0x400 and not (stat.S_ISREG(info.st_mode) and info.st_nlink != 1), 'NONORDINARY_PATH')
        if item == boundary:
            return file
    raise RuntimeError('FIXED_BOUNDARY_ANCESTRY_MISSING')


def digest(file, boundary=ROOT):
    file = ordinary(file, boundary)
    before = file.stat()
    need(file.is_file(), 'ORDINARY_FILE_REQUIRED')
    h = hashlib.sha256()
    with file.open('rb') as stream:
        opened = os.fstat(stream.fileno())
        need(same_object(before, opened), 'HASH_OPEN_CHANGED')
        while block := stream.read(1024*1024):
            h.update(block)
        need(identity(os.fstat(stream.fileno())) == identity(opened), 'HASH_HANDLE_CHANGED')
    need(identity(file.stat()) == identity(before), 'HASH_PATH_CHANGED')
    return h.hexdigest()


def identity(info):
    return info.st_dev, info.st_ino, info.st_size, info.st_mtime_ns, info.st_ctime_ns, info.st_nlink


def same_object(left, right):
    # Windows 3.14 path-stat and fd-stat can report different ctime semantics.
    # Keep full same-API before/after checks; compare common fields across APIs.
    return all(getattr(left, field) == getattr(right, field) for field in
               ('st_dev', 'st_ino', 'st_size', 'st_mtime_ns', 'st_nlink'))


def stable_bytes(file, boundary=ROOT, limit=2*1024*1024):
    file = ordinary(file, boundary)
    before = file.stat()
    need(file.is_file() and before.st_size <= limit, 'BOUNDED_METADATA_REQUIRED')
    with file.open('rb') as stream:
        opened = os.fstat(stream.fileno())
        need(same_object(opened, before), 'METADATA_OPEN_CHANGED')
        body = stream.read(limit+1)
        need(len(body) == opened.st_size and identity(os.fstat(stream.fileno())) == identity(opened), 'METADATA_READ_CHANGED')
    need(identity(file.stat()) == identity(before), 'METADATA_PATH_CHANGED')
    return body


def read_json(file, boundary=ROOT, pin=None):
    body = stable_bytes(file, boundary)
    if pin:
        need(hashlib.sha256(body).hexdigest() == pin, 'METADATA_SHA_MISMATCH')
    return json.loads(body.decode('utf-8-sig'))


def pinned_defs(relative, names, namespace):
    file = ordinary(ROOT/relative)
    body = stable_bytes(file)
    need(hashlib.sha256(body).hexdigest() == PINS[relative], 'ORIGINAL_ADMISSION_SOURCE_CHANGED')
    tree = ast.parse(body, filename=str(file))
    selected = [node for node in tree.body if isinstance(node, ast.FunctionDef) and node.name in names]
    need(len(selected) == len(names), 'EXACT_ORIGINAL_FUNCTIONS_REQUIRED')
    exec(compile(ast.Module(body=selected, type_ignores=[]), str(file), 'exec', dont_inherit=True), namespace)
    return namespace


def put_json(file, value):
    ordinary(file)
    with file.open('x', encoding='utf-8', newline='\n') as stream:
        json.dump(value, stream, ensure_ascii=False, indent=2)
        stream.write('\n')


def safe_relative(name):
    need(isinstance(name, str) and name and all(part and part not in ('.', '..') and not re.search(r'[\\:\x00-\x1f]|[ .]$', part) for part in name.split('/')), 'NONCANONICAL_PROGRAM_PATH')


def copy_row(source, destination, row, boundary):
    safe_relative(row['path'])
    need(type(row['size']) is int and 0 <= row['size'] <= 805306368 and re.fullmatch(r'[a-f0-9]{64}', row['sha256']), 'BAD_FILE_RECORD')
    source, destination = ordinary(source, boundary), ordinary(destination)
    need(source.stat().st_size == row['size'] and digest(source, boundary) == row['sha256'], 'INPUT_SIZE_OR_SHA_CHANGED')
    path_before = source.stat()
    destination.parent.mkdir(parents=True, exist_ok=True)
    ordinary(destination.parent)
    with source.open('rb') as reader, destination.open('xb') as writer:
        before = os.fstat(reader.fileno())
        need(same_object(path_before, before), 'COPY_SOURCE_OPEN_CHANGED')
        while block := reader.read(1024*1024):
            writer.write(block)
        writer.flush()
        os.fsync(writer.fileno())
        need(identity(os.fstat(reader.fileno())) == identity(before) and identity(source.stat()) == identity(path_before), 'COPY_SOURCE_CHANGED')
    need(destination.stat().st_size == row['size'] and digest(destination) == row['sha256'], 'COPIED_PROGRAM_CHANGED')


def asar_package(file):
    with ordinary(file).open('rb') as stream:
        head = stream.read(16)
        need(len(head) == 16, 'ASAR_HEADER_MISSING')
        a, b, c, length = struct.unpack('<4I', head)
        need(a == 4 and 0 < length < 2*1024*1024 and 16+length <= 8+b, 'ASAR_HEADER_BOUNDS')
        tree = json.loads(stream.read(length))
        entry = tree['files']['package.json']
        need(not entry.get('unpacked') and not entry.get('link') and 0 < entry['size'] < 8192, 'PACKED_PACKAGE_REQUIRED')
        stream.seek(8+b+int(entry['offset']))
        return json.loads(stream.read(entry['size']))


def main():
    parser = argparse.ArgumentParser(allow_abbrev=False)
    parser.add_argument('--source-sha256', required=True)
    args = parser.parse_args()
    need(re.fullmatch(r'[a-f0-9]{64}', args.source_sha256) and digest(Path(__file__)) == args.source_sha256, 'ROOT_SOURCE_SHA_REQUIRED')
    need(digest(Path(sys.executable), Path('C:/Python314')) == PINS['python'], 'PUBLIC_PYTHON_CHANGED')
    need(sys.version_info[:3] == (3, 14, 8), 'PINNED_PYTHON_VERSION_REQUIRED')
    for relative in ('stage1/sandbox-context.py', 'stage1/validate-sandbox-context.py'):
        need(digest(ROOT/relative) == PINS[relative], 'ORIGINAL_GUARD_CHANGED')
    guard_file = ROOT/'stage1/sandbox-context.py'
    guard = types.ModuleType('release162_actual_context')
    guard.__file__ = str(guard_file)
    guard_body = stable_bytes(guard_file)
    need(hashlib.sha256(guard_body).hexdigest() == PINS['stage1/sandbox-context.py'], 'ORIGINAL_GUARD_CHANGED_BEFORE_COMPILE')
    exec(compile(guard_body, str(guard_file), 'exec', dont_inherit=True), guard.__dict__)
    proof = guard.read_context(ROOT)
    need(not ordinary(WORK).exists(), 'CREATE_NEW_SELFCHECK_ROOT_REQUIRED')
    WORK.mkdir(parents=True, exist_ok=False)
    OUT.mkdir()
    report = {'purpose': 'release162-built-in-self-check', 'passed': False, 'status': 'REFUSED', 'actualContext': proof, 'sourceSha256': args.source_sha256, 'programLaunched': False, 'forcedStop': False, 'cdpUsed': False, 'interactiveUiAdmission': False, 'fullGuiVerified': False, 'productionTouched': False}
    try:
        ns = dict(ROOT=ROOT, Path=Path, os=os, stat=stat, hashlib=hashlib, json=json, subprocess=subprocess, socket=socket)
        original = pinned_defs('stage1/sandbox-guest-candidate-driver.py', {'validate_proof', 'validate_startup_evidence', 'ordinary', 'checked_hash', 'require_synthetic_data', 'guest_environment', 'process_snapshot', 'port_open'}, ns)

        def recheck_actual_context():
            for relative in ('stage1/sandbox-context.py', 'stage1/validate-sandbox-context.py'):
                need(digest(ROOT/relative) == PINS[relative], 'ORIGINAL_GUARD_CHANGED_DURING_SELFCHECK')
            return original['validate_proof'](guard.read_context(ROOT))

        ns['actual_context'] = recheck_actual_context
        original['validate_proof'](proof)
        identity = read_json(ROOT/'isolation-identity.json')
        need(str(uuid.UUID(identity['namespace'])) == identity['namespace'], 'CANONICAL_NAMESPACE_REQUIRED')
        original['require_synthetic_data']()
        kernel = ctypes.WinDLL('kernel32', use_last_error=True)
        kernel.CreateMutexW.argtypes = [ctypes.c_void_p, wintypes.BOOL, wintypes.LPCWSTR]
        kernel.CreateMutexW.restype = wintypes.HANDLE
        kernel.WaitForSingleObject.argtypes = [wintypes.HANDLE, wintypes.DWORD]
        kernel.ReleaseMutex.argtypes = [wintypes.HANDLE]
        kernel.CloseHandle.argtypes = [wintypes.HANDLE]
        mutex = pinned_defs('stage1/run-restricted.py', {'checked', 'lock_namespace'}, dict(C=ctypes, kernel=kernel, atexit=atexit))
        mutex['lock_namespace'](identity['namespace'])
        files = pinned_defs('audit-tools/current-ui-driver.py', {'require_closed_data_files'}, dict(ctypes=ctypes, ROOT=ROOT, package=types.SimpleNamespace(ordinary=ordinary)))

        def preflight():
            original['require_synthetic_data']()
            need(not (ROOT/'runtime/host-ready.json').exists(), 'OLD_HOST_READY_MARKER_PRESENT')
            active = original['process_snapshot']()
            for row in active:
                executable = str(row.get('ExecutablePath') or '').replace('\\', '/').casefold()
                command = str(row.get('CommandLine') or '').replace('\\', '/').casefold()
                name = str(row.get('Name') or '').casefold()
                need(not (name in ('鑫金源珠宝报价.exe', 'electron.exe') or executable.endswith('/鑫金源珠宝报价.exe') or executable.startswith(str(ROOT).replace('\\', '/').casefold()+'/') and executable.endswith('.exe') or 'stage1/host.cjs' in command), 'OLD_APP_OR_OWNED_NODE_ACTIVE')
            need(not any(original['port_open'](port) for port in PORTS), 'ORIGINAL_FIXED_TCP_PORT_BUSY')
            files['require_closed_data_files']()
            if ordinary(PROFILE).exists():
                owner = PROFILE/'current-ui-owner.json'
                report['existingProfileOwnerPresent'] = owner.exists()
                if owner.exists():
                    need(ordinary(owner).stat().st_size <= 8192, 'BOUNDED_PROFILE_OWNER_REQUIRED')
                    report['existingProfileOwnerSha256'] = digest(owner)
                raise RuntimeError('EXISTING_PROFILE_NOT_ADOPTED_NO_SELFCHECK_HANDOFF')

        preflight()
        manifest = read_json(TARGET/'release-manifest.json', TARGET, MANIFEST_SHA)
        trust = read_json(TRUST, ROOT, TRUST_SHA)
        need(manifest.get('programVersion') == '1.6.2' and manifest.get('resourcesOnly') is True and manifest.get('fileCount') == 1007 and len(manifest['files']) == 1007 and manifest['asar']['sha256'] == ASAR_SHA, 'EXACT_A2_RESOURCE_MANIFEST_REQUIRED')
        need(trust.get('engineVersion') == '44.7.0' and trust.get('executableName') == '鑫金源珠宝报价.exe' and len(trust['engineFiles']) == 72, 'ORIGINAL_72_ENGINE_REQUIRED')
        PROGRAM.mkdir()
        seen = set()
        for row in trust['engineFiles']:
            safe_relative(row['path'])
            need(not row['path'].startswith('resources/'), 'ENGINE_RESOURCE_COLLISION')
            need(row['path'].casefold() not in seen, 'DUPLICATE_PROGRAM_PATH')
            seen.add(row['path'].casefold())
            copy_row(ENGINE/row['path'], PROGRAM/row['path'], row, ENGINE)
        for row in manifest['files']:
            safe_relative(row['path'])
            need(row['path'].startswith('resources/') and row['path'].casefold() not in seen, 'RESOURCE_PATH_OR_COLLISION')
            seen.add(row['path'].casefold())
            copy_row(TARGET/row['path'], PROGRAM/row['path'], row, TARGET)
        need(len(seen) == 1079, 'COMPLETE_PROGRAM_COUNT_REQUIRED')
        package = asar_package(PROGRAM/'resources/app.asar')
        need(package.get('version') == '1.6.2' and package.get('main') == 'release-entry.cjs', 'A2_PACKAGE_IDENTITY_REQUIRED')
        preflight()
        PROFILE.mkdir(parents=True, exist_ok=False)
        owner = {'version': 1, 'purpose': 'release162-built-in-self-check', 'namespace': identity['namespace'], 'runId': 'release162-selfcheck-a2'}
        put_json(PROFILE/'release162-selfcheck-owner.json', owner)
        owner_sha = digest(PROFILE/'release162-selfcheck-owner.json')
        scratch = WORK/'scratch'
        scratch.mkdir()
        env = {key.upper(): value for key, value in original['guest_environment'](scratch, as_node=False).items()}
        env.update(PATH='C:/Windows/System32;C:/Windows', SYSTEMROOT='C:/Windows', WINDIR='C:/Windows', COMSPEC='C:/Windows/System32/cmd.exe', XJY_SELF_CHECK_OUTPUT=str(OUT))
        need('ELECTRON_RUN_AS_NODE' not in env, 'GUI_MODE_REQUIRED')
        executable = PROGRAM/trust['executableName']
        report.update(status='STARTING', roleFromTrustedArgv='host', runtimeRoleDirectlyObserved=False, packageVersion=package['version'], engineVersionExpected='44.7.0', verifiedProgramFiles=1079, profileOwnerSha256=owner_sha, syntheticNamespace=identity['namespace'], activeNetworkRejectionExercised=False)
        with (OUT/'stdout.log').open('xb') as stdout, (OUT/'stderr.log').open('xb') as stderr:
            child = subprocess.Popen([str(executable), '--self-check'], cwd=PROGRAM, env=env, stdin=subprocess.DEVNULL, stdout=stdout, stderr=stderr, creationflags=0x08000000)
            report.update(programLaunched=True, pid=child.pid, argv=['--self-check'])
            try:
                put_json(OUT/'launch.json', report)
                code = child.wait()  # No timeout, terminate, kill, CDP or adoption.
            finally:
                if child.poll() is None:
                    child.wait()
        report['exitCode'] = code
        need(code == 0, 'ACTUAL_SELFCHECK_NONZERO_EXIT')
        evidence = read_json(OUT/'startup-check.json')
        png = ordinary(OUT/'离线程序-首次启动.png')
        with png.open('rb') as stream:
            header = stream.read(8)
        original['validate_startup_evidence'](evidence, png_header=header)
        need(evidence.get('electron') == '44.7.0', 'ACTUAL_ENGINE_VERSION_MISMATCH')
        need(digest(PROFILE/'release162-selfcheck-owner.json') == owner_sha, 'PROFILE_OWNER_CHANGED')
        need(not any(original['port_open'](port) for port in PORTS), 'SELFCHECK_PORTS_STILL_OPEN')
        need(not any(str(row.get('ExecutablePath') or '').replace('\\', '/').casefold().startswith(str(PROGRAM).replace('\\', '/').casefold()+'/') for row in original['process_snapshot']()), 'SELFCHECK_PROGRAM_DESCENDANT_REMAINS')
        report.update(passed=True, status='PASSED', startupEvidenceSha256=digest(OUT/'startup-check.json'), screenshotSha256=digest(png), rendererErrors=evidence['rendererErrors'], blockedNetwork=evidence['blockedNetwork'], uiVersionTextObserved='1.6.2' in evidence['state']['text'], normalExitObserved=True)
    except Exception as error:
        report.update(status='FAILED' if report['programLaunched'] else 'REFUSED', refusal=str(error), normalExitObserved=report.get('exitCode') == 0)
    put_json(OUT/'result.json', report)
    print(json.dumps(report, ensure_ascii=False))
    return 0 if report['passed'] else 1


if __name__ == '__main__':
    raise SystemExit(main())
