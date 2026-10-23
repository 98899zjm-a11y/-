"""SOURCE_ONLY: fixed actual-Guest scope-A probe; Root seals input before run.

Only this new probe's Python EOF child is observed. No inventory worker, CIM
identity, product, UI, DB or owner is imported. Never run/import this on Host.

Fixed assertions: unregistered Popen rejected; borrowed handle not closeable;
registered borrowed/owned PID, raw FILETIME and fresh live image match; both
nonsignaled around image capture; EOF only; same Popen exits0; post status reads
held PID/ticks/Wait/Exit only, with captured-live-image provenance; owned Close
succeeds; borrowed held status remains queryable. No post fresh image claim.
No global process/listener or file-write scan is claimed.

Root creates audit-tools/ui-observer-native-a-contract.json, externally seals
its exact bytes, and invokes with --contract-sha256 HEX. Required exact keys:
  version=1, state=ROOT_SEALED_SOURCE, purpose=ui-observer-native-handle-probe,
  scope=A, runId=<a-z0-9-hyphen, max40>, sources={<both new relative paths>:SHA},
  python={path:C:/Python314/python.exe, sha256:<Root-approved public exe SHA>},
  guardSources={<unchanged two relative guard paths>:<their fixed SHA>}.
The source proposal is SOURCE_ONLY until Root supplies that sealed contract.
No OS hash is guessed or used as a placeholder. Contract flags cannot replace
the unchanged actualGuest guard. Child source is a fixed literal inside the
same-byte-compiled adapter; there is no second child/script CLI entry.

Root runner must not timeout-kill this probe: if its own child fails to finish
after EOF, it writes a sticky FAIL and keeps ownership until natural exit.
The existing unmodified admission dependency separately retains its metadata
helper's subprocess.run timeout semantics; do not claim whole-entry no-kill.
"""

from pathlib import Path
import argparse
import hashlib
import importlib.util
import json
import os
import queue
import re
import stat
import subprocess
import sys
import threading
import time


ROOT = Path(__file__).resolve().parents[1]
GUEST = Path('C:/xjy-work/xjy-web-stage1')
RESULTS = Path('C:/xjy-results')
PYTHON = Path('C:/Python314/python.exe')
PROBE = 'audit-tools/ui-observer-native-handle-probe.py'
ADAPTER = 'audit-tools/ui-observer-win32.py'
CONTRACT = ROOT / 'audit-tools/ui-observer-native-a-contract.json'
GUARD_PINS = {
    'stage1/sandbox-context.py': '09426dfd4d699c51570e1f1b10c2e37c00f6feb699b9a472ca710ae5242bf249',
    'stage1/validate-sandbox-context.py': '867a0117d6bc200960df06a355ffafcf639f24532ece3bc4db34f6e397325207',
}
SOURCE_CONTRACT_STATE = 'SOURCE_ONLY'
CHECKS = (
    'unregistered-popen-refused', 'borrowed-close-refused',
    'pre-capture-identities-match', 'pre-both-nonsignaled',
    'ready-belongs-to-captured-child', 'raw-filetime-is-integer-string',
    'normal-eof-exit-zero', 'post-held-identities-and-image-provenance-match',
    'post-both-signaled-exit-zero', 'kernel-identity-stable-across-eof',
    'owned-close-completed', 'borrowed-held-status-after-owned-close',
    'sources-still-sealed',
)


class ProbeError(RuntimeError):
    def __init__(self, code):
        super().__init__(code)
        self.code = code


def require(value, code):
    if not value:
        raise ProbeError(code)


def fixed_entry():
    require(os.name == 'nt' and os.path.normcase(str(ROOT)) == os.path.normcase(str(GUEST)), 'FIXED_GUEST_ROOT_REQUIRED')
    require(os.path.normcase(sys.executable) == os.path.normcase(str(PYTHON)), 'FIXED_PUBLIC_PYTHON_REQUIRED')
    require(sys.flags.isolated and sys.flags.dont_write_bytecode and not sys.flags.optimize, 'ISOLATED_UNOPTIMIZED_PYTHON_REQUIRED')


def ordinary(file, boundary):
    file, boundary = Path(file), Path(boundary)
    require(file.is_absolute() and file.is_relative_to(boundary), 'PATH_BOUNDARY_REFUSED')
    for item in (file, *file.parents):
        info = item.lstat()
        require(not stat.S_ISLNK(info.st_mode) and not getattr(info, 'st_file_attributes', 0) & 0x400, 'PATH_LINK_REFUSED')
        require(not stat.S_ISREG(info.st_mode) or info.st_nlink == 1, 'FILE_HARDLINK_REFUSED')
        if item == boundary:
            return file
    raise ProbeError('PHYSICAL_BOUNDARY_MISSING')


def file_identity(info):
    return (info.st_dev, info.st_ino, info.st_size, info.st_mtime_ns,
            info.st_ctime_ns, info.st_nlink, getattr(info, 'st_birthtime_ns', None))


def same_open_file(path_info, handle_info):
    # Existing Windows3.14 transfer/common rule: ctime semantics may differ
    # across path.stat/fstat. Same-API stability below still includes ctime.
    shared = ('st_dev', 'st_ino', 'st_size', 'st_mtime_ns', 'st_nlink')
    births = (getattr(path_info, 'st_birthtime_ns', None), getattr(handle_info, 'st_birthtime_ns', None))
    return all(getattr(path_info, field) == getattr(handle_info, field) for field in shared) and (None in births or births[0] == births[1])


def stable_bytes(file, boundary, limit=8 * 1024 * 1024):
    file = ordinary(file, boundary)
    before = file.stat()
    require(file.is_file() and before.st_size <= limit, 'BOUNDED_ORDINARY_FILE_REQUIRED')
    with file.open('rb') as stream:
        opened = os.fstat(stream.fileno())
        require(same_open_file(before, opened), 'FILE_CHANGED_BEFORE_READ')
        body = stream.read(limit + 1)
        require(len(body) == before.st_size and file_identity(os.fstat(stream.fileno())) == file_identity(opened), 'FILE_CHANGED_DURING_READ')
    require(file_identity(ordinary(file, boundary).stat()) == file_identity(before), 'FILE_CHANGED_AFTER_READ')
    return body


def digest(body):
    return hashlib.sha256(body).hexdigest()


def load_contract(expected):
    require(re.fullmatch(r'[0-9a-f]{64}', expected) is not None, 'ROOT_CONTRACT_SHA_REQUIRED')
    body = stable_bytes(CONTRACT, ROOT, 16384)
    require(digest(body) == expected, 'ROOT_CONTRACT_SHA_MISMATCH')
    value = json.loads(body)
    require(isinstance(value, dict) and set(value) == {'version', 'state', 'purpose', 'scope', 'runId', 'sources', 'python', 'guardSources'}, 'CONTRACT_SCHEMA_REFUSED')
    require(value['version'] == 1 and type(value['version']) is int and value['state'] == 'ROOT_SEALED_SOURCE' and value['purpose'] == 'ui-observer-native-handle-probe' and value['scope'] == 'A', 'CONTRACT_NOT_ROOT_SEALED_SOURCE')
    require(isinstance(value['runId'], str) and re.fullmatch(r'[a-z0-9](?:[a-z0-9-]{0,38}[a-z0-9])?', value['runId']) is not None, 'CONTRACT_RUN_ID_REFUSED')
    require(isinstance(value['sources'], dict) and set(value['sources']) == {PROBE, ADAPTER}, 'CONTRACT_SOURCE_SET_REFUSED')
    require(value['guardSources'] == GUARD_PINS, 'ORIGINAL_GUARD_SOURCE_SET_REFUSED')
    require(isinstance(value['python'], dict) and set(value['python']) == {'path', 'sha256'} and value['python']['path'] == 'C:/Python314/python.exe', 'CONTRACT_PYTHON_REFUSED')
    for sha in [*value['sources'].values(), value['python']['sha256']]:
        require(isinstance(sha, str) and re.fullmatch(r'[0-9a-f]{64}', sha) is not None, 'ROOT_ACTUAL_SOURCE_SHA_REQUIRED')
    verified = verify_sources(value)
    return value, verified[ADAPTER]


def verify_sources(contract):
    verified = {}
    for relative, sha in {**contract['sources'], **GUARD_PINS}.items():
        body = stable_bytes(ROOT / relative, ROOT)
        require(digest(body) == sha, 'SEALED_SOURCE_CHANGED')
        if relative in contract['sources']:
            verified[relative] = body
    require(digest(stable_bytes(PYTHON, PYTHON.parent)) == contract['python']['sha256'], 'PUBLIC_PYTHON_CHANGED')
    return verified


def write_new(file, value):
    ordinary(file.parent, RESULTS)
    with file.open('x', encoding='utf-8', newline='\n') as stream:
        json.dump(value, stream, ensure_ascii=True, indent=2)
        stream.write('\n')
        stream.flush()
        os.fsync(stream.fileno())


def tuple_of(snapshot):
    return snapshot['pid'], snapshot['creationFileTime'], os.path.normcase(snapshot['imagePath'])


def kernel_tuple_of(snapshot):
    return snapshot['pid'], snapshot['creationFileTime']


def fresh_live_image(snapshot):
    return snapshot.get('imagePathProvenance') == {
        'sourceApi': 'QueryFullProcessImageNameW', 'sourceStage': 'fresh-live-image',
        'fresh': True, 'nonsignaledBefore': True, 'nonsignaledAfter': True}


def captured_image_matches(snapshot, live):
    return ('imagePath' not in snapshot and
            os.path.normcase(snapshot.get('capturedLiveImagePath', '')) == os.path.normcase(live['imagePath']) and
            snapshot.get('identitySource') == 'held-kernel-process-handle' and
            snapshot.get('capturedLiveImageProvenance') == {
                'sourceApi': 'QueryFullProcessImageNameW', 'sourceStage': 'captured-live-image',
                'fresh': False, 'capturedPid': live['pid'],
                'capturedCreationFileTime': live['creationFileTime'],
                'capturedNonsignaledBefore': True, 'capturedNonsignaledAfter': True,
                'captureRole': live['handleOwnership']})


def run(expected):
    contract, reviewed_adapter = load_contract(expected)
    spec = importlib.util.spec_from_file_location('qa_native_handle_adapter', ROOT / ADAPTER)
    module = importlib.util.module_from_spec(spec)
    # Execute exactly the stable bytes whose SHA matched the external seal;
    # module_from_spec supplies __file__/spec without rereading executable text.
    exec(compile(reviewed_adapter, str(ROOT / ADAPTER), 'exec'), module.__dict__)
    adapter = module.create_adapter()  # unchanged actualGuest guard before DLL/launch/mutation
    ordinary(RESULTS, RESULTS)
    output = RESULTS / ('ui-observer-native-a-' + contract['runId'])
    output.mkdir()  # CreateNew: an existing result is never replaced or adopted
    ordinary(output, RESULTS)
    report = {'purpose': 'ui-observer-native-handle-probe', 'scope': 'A', 'sourceContractState': contract['state'],
              'observationContract': 'live-image-held-exit-status-v2',
              'actualGuest': True, 'contractSha256': expected, 'sources': contract['sources'],
              'python': contract['python'], 'passed': False, 'uiAdmissionGranted': False,
              'globalProcessScanAssessed': False, 'globalListenerScanAssessed': False,
              'databaseOrProfileWritesAssessed': False, 'checks': {name: None for name in CHECKS},
              'admission': adapter.admission, 'admissionDependency': module.ADMISSION_TIMEOUT_BOUNDARY,
              'requestedOwnedAccessMask': module.QUERY_SYNCHRONIZE,
              'fixedChildLiteralSha256': adapter.child_program_sha256, 'snapshots': {}}
    child = borrowed = owned = None
    eof_sent = False
    result_written = False
    first_result_attempted = False

    def check(name, condition):
        report['checks'][name] = bool(condition)
        require(condition, name.upper().replace('-', '_'))

    def eof():
        nonlocal eof_sent
        if child is not None and not eof_sent:
            child.stdin.close()
            eof_sent = True

    def captured_child_stopped():
        if child is None:
            return True
        try:
            return child.poll() is not None
        except Exception as error:
            report['passed'] = False
            report['popenPollError'] = {'code': getattr(error, 'code', type(error).__name__)}
            # A separately captured owned handle can prove physical exit if the
            # Popen returncode query failed. It never manufactures Popen exit0.
            if owned is not None:
                try:
                    snapshot = adapter.post_exit_status(owned)
                    report['snapshots']['cleanupOwned'] = snapshot
                    return snapshot['signaled']
                except Exception as snapshot_error:
                    report['cleanupSnapshotError'] = {'code': getattr(snapshot_error, 'code', type(snapshot_error).__name__)}
            return False

    try:
        env = {'SystemRoot': 'C:\\Windows', 'WINDIR': 'C:\\Windows', 'TEMP': str(output), 'TMP': str(output)}
        child = subprocess.Popen(adapter.child_command, cwd=ROOT, env=env, shell=False, close_fds=True,
                                 stdin=subprocess.PIPE, stdout=subprocess.PIPE, stderr=subprocess.PIPE,
                                 creationflags=0x08000000)
        refused = False
        try:
            adapter.open_owned(child)
        except ValueError:
            refused = True
        check('unregistered-popen-refused', refused)
        borrowed = adapter.register_popen(child)
        refused = False
        try:
            adapter.close_owned(borrowed)
        except ValueError:
            refused = True
        check('borrowed-close-refused', refused)
        owned = adapter.open_owned(child)
        pre = {'borrowed': adapter.snapshot(borrowed), 'owned': adapter.snapshot(owned)}
        report['snapshots']['pre'] = pre
        check('pre-capture-identities-match', tuple_of(pre['borrowed']) == tuple_of(pre['owned']) and pre['owned']['pid'] == child.pid and all(fresh_live_image(value) for value in pre.values()))
        check('pre-both-nonsignaled', all(not value['signaled'] and fresh_live_image(value) for value in pre.values()))
        ready = queue.Queue(maxsize=1)

        def read_ready():
            try:
                ready.put(child.stdout.readline(4097))
            except Exception:
                ready.put(None)

        reader = threading.Thread(target=read_ready, daemon=True)
        reader.start()
        line = ready.get(timeout=20)
        reader.join(timeout=1)
        require(not reader.is_alive(), 'READY_READER_NOT_FINISHED')
        require(isinstance(line, bytes) and len(line) <= 4096 and line.endswith(b'\n'), 'BOUNDED_READY_REQUIRED')
        ready_frame = json.loads(line.decode('utf-8', errors='strict'))
        check('ready-belongs-to-captured-child', ready_frame == {'event': 'ready', 'pid': child.pid, 'waitingForEof': True})
        ticks = pre['owned']['creationFileTime']
        check('raw-filetime-is-integer-string', isinstance(ticks, str) and re.fullmatch(r'[1-9][0-9]{0,19}', ticks) is not None and int(ticks) <= 0xffffffffffffffff)
        eof()
        code = child.wait(timeout=20)  # Popen.wait does not kill on timeout
        tail = child.stdout.read(4097)
        stderr = child.stderr.read(4097)
        check('normal-eof-exit-zero', code == 0 and tail in (b'{"event": "eof"}\r\n', b'{"event": "eof"}\n'))
        require(stderr == b'', 'CHILD_STDERR_NOT_EMPTY')
        post = {}
        report['snapshots']['post'] = post
        post['borrowed'] = adapter.post_exit_status(borrowed)
        post['owned'] = adapter.post_exit_status(owned)
        check('post-held-identities-and-image-provenance-match', kernel_tuple_of(post['borrowed']) == kernel_tuple_of(post['owned']) and all(captured_image_matches(post[role], pre[role]) for role in post))
        check('post-both-signaled-exit-zero', all(value['signaled'] and value['exitCode'] == 0 for value in post.values()))
        check('kernel-identity-stable-across-eof', all(kernel_tuple_of(pre[role]) == kernel_tuple_of(post[role]) for role in post))
        adapter.close_owned(owned)
        adapter.close_owned(owned)  # idempotent API: no second CloseHandle
        check('owned-close-completed', adapter.owned_open_count == 0)
        final_borrowed = adapter.post_exit_status(borrowed)
        report['snapshots']['borrowedAfterOwnedClose'] = final_borrowed
        check('borrowed-held-status-after-owned-close', kernel_tuple_of(final_borrowed) == kernel_tuple_of(pre['borrowed']) and final_borrowed['signaled'] and final_borrowed['exitCode'] == 0 and captured_image_matches(final_borrowed, pre['borrowed']))
        verify_sources(contract)
        check('sources-still-sealed', True)
        report['passed'] = all(value is True for value in report['checks'].values())
    except Exception as error:
        report['error'] = {'code': getattr(error, 'code', type(error).__name__)}
    finally:
        try:
            eof()
        except Exception as error:
            report['passed'] = False
            report['eofError'] = {'code': getattr(error, 'code', type(error).__name__)}
        if child is not None and not captured_child_stopped():
            try:
                child.wait(timeout=20)
            except Exception as error:
                report['passed'] = False
                report['popenWaitError'] = {'code': getattr(error, 'code', type(error).__name__)}
            if not captured_child_stopped():
                report['passed'] = False
                report['waitingForOwnedExit'] = True
                report['normalStop'] = {'passed': False, 'eofSent': eof_sent, 'newChildForcedStop': False, 'popenExitCode': None}
                first_result_attempted = True
                try:
                    write_new(output / 'result.json', report)
                    result_written = True
                except Exception as error:
                    report['persistenceError'] = {'code': getattr(error, 'code', type(error).__name__)}
                    # Reporting failure must never bypass the ownership hold.
                    try:
                        print(json.dumps({'purpose': report['purpose'], 'passed': False, 'errorCode': 'EARLY_RESULT_WRITE_FAILED', 'waitingForOwnedExit': True}), file=sys.stderr, flush=True)
                    except Exception:
                        pass  # best-effort diagnostic only; FAIL and hold remain
                # Preserve the FAIL artifact and ownership until natural exit.
                # Root's caller must not wrap this probe in an auto-kill timeout.
                while not captured_child_stopped():
                    time.sleep(0.5)
                report['waitingForOwnedExit'] = False
        try:
            adapter.close_all_owned()
        except Exception as error:
            report['passed'] = False
            report['closeError'] = {'code': getattr(error, 'code', type(error).__name__)}
        report['normalStop'] = {'passed': child is not None and child.returncode == 0 and eof_sent and adapter.owned_open_count == 0 and adapter.failure is None and 'popenPollError' not in report,
                                'eofSent': eof_sent, 'newChildForcedStop': False,
                                'popenExitCode': child.returncode if child is not None else None,
                                'ownedHandlesRemaining': adapter.owned_open_count}
        report['adapterFailure'] = adapter.failure
        report['earlyFailureArtifactAttempted'] = first_result_attempted
        report['earlyFailureArtifactWritten'] = result_written
        report['passed'] = report['passed'] and report['normalStop']['passed'] and not first_result_attempted
        if child is not None:
            for stream in (child.stdout, child.stderr):
                if stream is not None:
                    stream.close()
        if first_result_attempted:
            write_new(output / 'late-normal-cleanup.json', report)
        else:
            write_new(output / 'result.json', report)
    print(json.dumps({'purpose': report['purpose'], 'scope': 'A', 'passed': report['passed'], 'result': str(output / 'result.json'), 'uiAdmissionGranted': False}), flush=True)
    return 0 if report['passed'] else 1


if __name__ == '__main__':
    try:
        fixed_entry()
        parser = argparse.ArgumentParser(description='Root-sealed actualGuest owned EOF handle lifecycle only')
        parser.add_argument('--contract-sha256', required=True)
        args = parser.parse_args()
        raise SystemExit(run(args.contract_sha256))
    except Exception as error:
        print(json.dumps({'purpose': 'ui-observer-native-handle-probe', 'passed': False, 'errorCode': getattr(error, 'code', type(error).__name__), 'uiAdmissionGranted': False}), file=sys.stderr, flush=True)
        raise SystemExit(1)
