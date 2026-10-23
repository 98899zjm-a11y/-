"""SOURCE_ONLY scope-B tinyprobe; no Host import/OS/API execution.

Root seals audit-tools/ui-observer-collector-contract.json and supplies its
external --contract-sha256. Exact contract keys: version/state/purpose/scope/
runId/sources/a2Sources/python/powershell/guardSources/fixtures/workerLiteralSha256.
Proposal state is SOURCE_ONLY; accepted Root-sealed state is ROOT_SEALED_SOURCE.
sources contains only these two new relative paths. a2Sources contains only
ui-observer-win32.py at the immutable A2 SHA below. python is fixed path+Root
actual SHA. powershell is fixed path+Root actual SHA+linkCount (OS hardlinks
are not guessed; only that exact OS exe may use the observed count). fixtures
is exactly127.0.0.1/TCP42921/UDP42922. No OS hash or contract JSON is generated.
Capability records use the actual WMI cmdlet and two CDXML function sources,
exact System32 module paths/bases, and requested/effective module search paths.
The clean parent requests one System32 path; PowerShell5.1 itself prepends its
ProgramFiles default, so the child must expose exactly the two reviewed paths.

One readonly collector; frame1 capability/preflight,2-4 live sockets,5-7 socket
closed/child live,8-10 child exited. Only self-owned exact loopback bind/listen,
no packets/business/DB/UI/owner. A2 live/post provenance stays separate; old
model/proof never imported. Root caller must not auto-kill on timeout: failures
remain sticky and retain every captured live process until natural exit.
"""

from pathlib import Path
import argparse
from datetime import datetime, timedelta
import hashlib
import importlib.util
import json
import os
import queue
import re
import socket
import stat
import subprocess
import sys
import threading
import time

ROOT = Path(__file__).resolve().parents[1]
GUEST = Path('C:/xjy-work/xjy-web-stage1')
RESULTS = Path('C:/xjy-results')
PYTHON = Path('C:/Python314/python.exe')
POWERSHELL = Path('C:/Windows/System32/WindowsPowerShell/v1.0/powershell.exe')
PROBE = 'audit-tools/ui-observer-collector-probe.py'
COLLECTOR = 'audit-tools/ui-observer-collector.py'
A2_ADAPTER = 'audit-tools/ui-observer-win32.py'
A2_SHA = '86ac5e0561cb83b8fe713522dbaf1e8ee6a64fd6e2fe224cd70f2c91a8953edb'
CONTRACT = ROOT / 'audit-tools/ui-observer-collector-contract.json'
GUARD_PINS = {
    'stage1/sandbox-context.py': '09426dfd4d699c51570e1f1b10c2e37c00f6feb699b9a472ca710ae5242bf249',
    'stage1/validate-sandbox-context.py': '867a0117d6bc200960df06a355ffafcf639f24532ece3bc4db34f6e397325207',
}
FIXTURES = {'localAddress': '127.0.0.1', 'tcpPort': 42921, 'udpPort': 42922}
SOURCE_CONTRACT_STATE = 'SOURCE_ONLY'
CHECKS = ('sources-sealed', 'first-frame-capability-and-dmtf', 'ports-empty-preflight',
          'exclusive-fixed-loopback-bind', 'fixture-owner-rows-visible', 'fixture-rows-closed',
          'ten-fresh-one-worker', 'live-dmtf-kernel-projection', 'post-source-separated',
          'child-normal-eof-owned-close', 'collector-normal-eof', 'sources-still-sealed')


class ProbeError(RuntimeError):
    def __init__(self, code):
        super().__init__(code)
        self.code = code


def require(value, code):
    if not value:
        raise ProbeError(code)


def ordinary(file, boundary, os_links=None):
    file, boundary = Path(file), Path(boundary)
    require(file.is_absolute() and file.is_relative_to(boundary), 'PATH_BOUNDARY_REFUSED')
    for item in (file, *file.parents):
        info = item.lstat()
        require(not stat.S_ISLNK(info.st_mode) and not getattr(info, 'st_file_attributes', 0) & 0x400, 'PATH_LINK_REFUSED')
        if stat.S_ISREG(info.st_mode):
            require(info.st_nlink == (os_links if item == POWERSHELL and os_links is not None else 1), 'FILE_LINK_COUNT_REFUSED')
        if item == boundary:
            return file
    raise ProbeError('PHYSICAL_BOUNDARY_MISSING')


def identity(info):
    return info.st_dev, info.st_ino, info.st_size, info.st_mtime_ns, info.st_ctime_ns, info.st_nlink, getattr(info, 'st_birthtime_ns', None)


def stable_bytes(file, boundary, os_links=None):
    file = ordinary(file, boundary, os_links)
    before = file.stat()
    require(file.is_file() and before.st_size <= 8 * 1024 * 1024, 'BOUNDED_FILE_REQUIRED')
    with file.open('rb') as stream:
        opened = os.fstat(stream.fileno())
        common = ('st_dev', 'st_ino', 'st_size', 'st_mtime_ns', 'st_nlink')
        births = (getattr(before, 'st_birthtime_ns', None), getattr(opened, 'st_birthtime_ns', None))
        require(all(getattr(before, key) == getattr(opened, key) for key in common) and (None in births or births[0] == births[1]), 'FILE_CHANGED_BEFORE_READ')
        body = stream.read(8 * 1024 * 1024 + 1)
        require(len(body) == before.st_size and identity(os.fstat(stream.fileno())) == identity(opened), 'FILE_CHANGED_DURING_READ')
    require(identity(ordinary(file, boundary, os_links).stat()) == identity(before), 'FILE_CHANGED_AFTER_READ')
    return body


def digest(body):
    return hashlib.sha256(body).hexdigest()


def verify_sources(contract):
    reviewed = {}
    for relative, sha in {**contract['sources'], **contract['a2Sources'], **GUARD_PINS}.items():
        body = stable_bytes(ROOT / relative, ROOT)
        require(digest(body) == sha, 'SEALED_SOURCE_CHANGED')
        reviewed[relative] = body
    require(digest(stable_bytes(PYTHON, Path('C:/'))) == contract['python']['sha256'], 'PUBLIC_PYTHON_CHANGED')
    require(digest(stable_bytes(POWERSHELL, Path('C:/'), contract['powershell']['linkCount'])) == contract['powershell']['sha256'], 'ROOT_POWERSHELL_CHANGED')
    return reviewed


def load_contract(expected):
    require(re.fullmatch(r'[0-9a-f]{64}', expected) is not None, 'ROOT_CONTRACT_SHA_REQUIRED')
    body = stable_bytes(CONTRACT, ROOT)
    require(digest(body) == expected, 'ROOT_CONTRACT_SHA_MISMATCH')
    def unique_contract_fields(pairs):
        result = {}
        for key, item in pairs:
            require(key not in result, 'DUPLICATE_CONTRACT_FIELD')
            result[key] = item
        return result
    value = json.loads(body, object_pairs_hook=unique_contract_fields)
    fields = {'version', 'state', 'purpose', 'scope', 'runId', 'sources', 'a2Sources', 'python', 'powershell', 'guardSources', 'fixtures', 'workerLiteralSha256'}
    require(isinstance(value, dict) and set(value) == fields, 'CONTRACT_SCHEMA_REFUSED')
    require(type(value['version']) is int and value['version'] == 1 and value['state'] == 'ROOT_SEALED_SOURCE' and value['purpose'] == 'ui-observer-collector-tinyprobe' and value['scope'] == 'B', 'CONTRACT_NOT_ROOT_SEALED_SOURCE')
    require(isinstance(value['runId'], str) and re.fullmatch(r'[a-z0-9](?:[a-z0-9-]{0,38}[a-z0-9])?', value['runId']) is not None, 'RUN_ID_REFUSED')
    require(isinstance(value['sources'], dict) and set(value['sources']) == {PROBE, COLLECTOR}, 'SOURCE_SET_REFUSED')
    require(value['a2Sources'] == {A2_ADAPTER: A2_SHA} and value['guardSources'] == GUARD_PINS and value['fixtures'] == FIXTURES, 'FROZEN_DEPENDENCY_OR_FIXTURE_REFUSED')
    require(isinstance(value['python'], dict) and set(value['python']) == {'path', 'sha256'} and value['python']['path'] == 'C:/Python314/python.exe', 'PYTHON_CONTRACT_REFUSED')
    require(isinstance(value['powershell'], dict) and set(value['powershell']) == {'path', 'sha256', 'linkCount'} and value['powershell']['path'] == 'C:/Windows/System32/WindowsPowerShell/v1.0/powershell.exe' and type(value['powershell']['linkCount']) is int and 1 <= value['powershell']['linkCount'] <= 1024, 'POWERSHELL_CONTRACT_REFUSED')
    hashes = [*value['sources'].values(), value['python']['sha256'], value['powershell']['sha256'], value['workerLiteralSha256']]
    require(all(isinstance(sha, str) and re.fullmatch(r'[0-9a-f]{64}', sha) is not None for sha in hashes), 'ROOT_ACTUAL_SHA_REQUIRED')
    return value, verify_sources(value)


def load_same_bytes(name, relative, body):
    spec = importlib.util.spec_from_file_location(name, ROOT / relative)
    module = importlib.util.module_from_spec(spec)
    exec(compile(body, str(ROOT / relative), 'exec'), module.__dict__)
    return module


def write_new(file, value):
    ordinary(file.parent, RESULTS)
    with file.open('x', encoding='utf-8', newline='\n') as stream:
        json.dump(value, stream, ensure_ascii=True, indent=2)
        stream.write('\n')
        stream.flush()
        os.fsync(stream.fileno())


def kernel_key(snapshot):
    return snapshot['pid'], snapshot['creationFileTime']


def live_image(snapshot):
    return not snapshot['signaled'] and snapshot.get('imagePathProvenance') == {
        'sourceApi': 'QueryFullProcessImageNameW', 'sourceStage': 'fresh-live-image',
        'fresh': True, 'nonsignaledBefore': True, 'nonsignaledAfter': True}


def post_source(snapshot, live):
    return (snapshot['signaled'] and snapshot['exitCode'] == 0 and 'imagePath' not in snapshot and
            kernel_key(snapshot) == kernel_key(live) and
            os.path.normcase(snapshot.get('capturedLiveImagePath', '')) == os.path.normcase(live['imagePath']) and
            snapshot.get('capturedLiveImageProvenance') == {
                'sourceApi': 'QueryFullProcessImageNameW', 'sourceStage': 'captured-live-image', 'fresh': False,
                'capturedPid': live['pid'], 'capturedCreationFileTime': live['creationFileTime'],
                'capturedNonsignaledBefore': True, 'capturedNonsignaledAfter': True,
                'captureRole': live['handleOwnership']})


def dmtf_microseconds(raw):
    require(isinstance(raw, str) and re.fullmatch(r'[0-9]{14}\.[0-9]{6}[+-][0-9]{3}', raw) is not None, 'CONTROLLED_CHILD_RAW_DMTF_REQUIRED')
    instant = datetime(int(raw[:4]), int(raw[4:6]), int(raw[6:8]), int(raw[8:10]), int(raw[10:12]), int(raw[12:14]), int(raw[15:21]))
    offset = int(raw[22:25]) * (1 if raw[21] == '+' else -1)
    delta = instant - timedelta(minutes=offset) - datetime(1601, 1, 1)
    return (delta.days * 86400 + delta.seconds) * 1_000_000 + delta.microseconds


def no_reserved_rows(frame):
    return not any(row['localPort'] == 42921 for row in frame['tcpListeners']) and not any(row['localPort'] == 42922 for row in frame['udpEndpoints'])


def own_fixture_rows(frame):
    for name, port in (('tcpListeners', 42921), ('udpEndpoints', 42922)):
        found = [row for row in frame[name] if row['localPort'] == port]
        require(len(found) == 1 and found[0]['localAddress'] == '127.0.0.1' and found[0]['owningProcess'] == os.getpid(), 'CONTROLLED_FIXTURE_OWNER_MISMATCH')


def run(expected):
    contract, reviewed = load_contract(expected)
    client_module = load_same_bytes('qa_scope_b_collector', COLLECTOR, reviewed[COLLECTOR])
    a2_module = load_same_bytes('qa_frozen_a2_adapter', A2_ADAPTER, reviewed[A2_ADAPTER])
    require(digest(client_module.WORKER_SOURCE.encode('utf-8')) == contract['workerLiteralSha256'], 'WORKER_LITERAL_NOT_SEALED')
    adapter = a2_module.create_adapter()  # real unchanged admission before mutation
    ordinary(RESULTS, RESULTS)
    output = RESULTS / ('ui-observer-b-' + contract['runId'])
    output.mkdir()
    ordinary(output, RESULTS)
    report = {'purpose': 'ui-observer-collector-tinyprobe', 'scope': 'B', 'actualGuest': True,
              'contractSha256': expected, 'sources': contract['sources'], 'a2Sources': contract['a2Sources'],
              'workerLiteralSha256': contract['workerLiteralSha256'], 'passed': False,
              'checks': {name: None for name in CHECKS}, 'observations': [],
              'uiAdmissionGranted': False, 'oldModelInstantiated': False,
              'globalOwnershipAssessed': False, 'workerDescendantClosureAssessed': False,
              'globalScanAfterCollectorExitAssessed': False, 'allListenersClosedAssessed': False,
              'admission': adapter.admission, 'admissionDependency': a2_module.ADMISSION_TIMEOUT_BOUNDARY}
    child = borrowed = owned = collector = tcp = udp = None
    eof_child = False
    initial = None
    early_attempted = early_written = False

    def check(name, condition):
        report['checks'][name] = bool(condition)
        require(condition, name.upper().replace('-', '_'))

    def child_eof():
        nonlocal eof_child
        if child is not None and not eof_child:
            child.stdin.close()
            eof_child = True

    def close_sockets():
        nonlocal tcp, udp
        first_error = None
        for name in ('tcp', 'udp'):
            value = tcp if name == 'tcp' else udp
            if value is not None:
                try:
                    value.close()
                    require(value.fileno() == -1, 'OWN_SOCKET_CLOSE_INCOMPLETE')
                    if name == 'tcp':
                        tcp = None
                    else:
                        udp = None
                except Exception as error:
                    if first_error is None:
                        first_error = error
        if first_error is not None:
            raise first_error

    def status_pair(post):
        method = adapter.post_exit_status if post else adapter.snapshot
        values = {'borrowed': method(borrowed), 'owned': method(owned)}
        require(kernel_key(values['borrowed']) == kernel_key(values['owned']) == kernel_key(initial['borrowed']), 'CAPTURED_KERNEL_IDENTITY_CHANGED')
        if post:
            require(all(post_source(values[role], initial[role]) for role in values), 'POST_SOURCE_NOT_SEPARATED')
        else:
            require(all(live_image(value) for value in values.values()), 'LIVE_IMAGE_PROVENANCE_REQUIRED')
        return values

    def observe(phase, post=False):
        before = status_pair(post)
        frame = collector.list()
        record = {'phase': phase, 'frame': frame, 'a2Before': before}
        report['observations'].append(record)
        rows = [row for row in frame['processes'] if row['processId'] == child.pid]
        if not post:
            require(len(rows) == 1, 'CONTROLLED_LIVE_CHILD_NOT_ENUMERATED')
        if rows:
            row = rows[0]
            if row['cimCreationDmtfRaw'] is not None:
                micros = dmtf_microseconds(row['cimCreationDmtfRaw'])
                require(micros == int(initial['borrowed']['creationFileTime']) // 10, 'DMTF_KERNEL_SOURCE_PROJECTION_MISMATCH')
                record['wmiChild'] = {'disposition': 'enumerated-creation-projection-matches', 'creationUtcMicroseconds': str(micros), 'source': 'Win32_Process.CreationDate raw DMTF'}
            else:
                require(post, 'LIVE_CHILD_DMTF_UNAVAILABLE')
                record['wmiChild'] = {'disposition': 'enumerated-date-unavailable', 'source': 'WMI observation only'}
            if not post:
                require(row['parentProcessId'] == os.getpid() and row['cimCreationValueType'] == 'System.String' and isinstance(row['wmiExecutablePath'], str) and os.path.normcase(row['wmiExecutablePath']) == os.path.normcase(before['borrowed']['imagePath']), 'LIVE_CHILD_WMI_BINDING_MISMATCH')
        else:
            record['wmiChild'] = {'disposition': 'not-enumerated', 'source': 'WMI observation only; not an alive/ownership assertion'}
        record['a2After'] = status_pair(post)
        write_new(output / ('frame-' + str(frame['sequence']).zfill(2) + '.json'), record)
        return frame

    def child_stopped():
        if child is None:
            return True
        try:
            return child.poll() is not None
        except Exception as error:
            report['passed'] = False
            report['childPollError'] = {'code': getattr(error, 'code', type(error).__name__)}
            if owned is not None:
                try:
                    return adapter.post_exit_status(owned)['signaled']
                except Exception:
                    pass
            return False

    try:
        check('sources-sealed', True)
        env = {'SystemRoot': 'C:\\Windows', 'WINDIR': 'C:\\Windows', 'TEMP': str(output), 'TMP': str(output)}
        child = subprocess.Popen(adapter.child_command, cwd=ROOT, env=env, shell=False, close_fds=True,
                                 creationflags=0x08000000, stdin=subprocess.PIPE, stdout=subprocess.PIPE, stderr=subprocess.PIPE)
        borrowed = adapter.register_popen(child)
        owned = adapter.open_owned(child)
        initial = {'borrowed': adapter.snapshot(borrowed), 'owned': adapter.snapshot(owned)}
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
        require(not reader.is_alive() and isinstance(line, bytes) and len(line) <= 4096 and json.loads(line.decode('utf-8', errors='strict')) == {'event': 'ready', 'pid': child.pid, 'waitingForEof': True}, 'FIXED_EOF_CHILD_NOT_READY')
        collector = client_module.create_collector(powershell_sha256=contract['powershell']['sha256'],
                                                   powershell_link_count=contract['powershell']['linkCount'],
                                                   worker_literal_sha256=contract['workerLiteralSha256'], output_dir=output)
        collector.start()
        first = observe('capability-and-preflight')
        check('first-frame-capability-and-dmtf', True)
        check('ports-empty-preflight', no_reserved_rows(first))
        require(hasattr(socket, 'SO_EXCLUSIVEADDRUSE'), 'EXCLUSIVE_BIND_CAPABILITY_REQUIRED')
        tcp = socket.socket(socket.AF_INET, socket.SOCK_STREAM)
        tcp.setsockopt(socket.SOL_SOCKET, socket.SO_EXCLUSIVEADDRUSE, 1)
        tcp.bind(('127.0.0.1', 42921))
        udp = socket.socket(socket.AF_INET, socket.SOCK_DGRAM)
        udp.setsockopt(socket.SOL_SOCKET, socket.SO_EXCLUSIVEADDRUSE, 1)
        udp.bind(('127.0.0.1', 42922))
        tcp.listen(1)  # both kernel-exclusive binds succeeded before listening
        check('exclusive-fixed-loopback-bind', tcp.getsockname() == ('127.0.0.1', 42921) and udp.getsockname() == ('127.0.0.1', 42922))
        for sequence in range(2, 5):
            own_fixture_rows(observe('fixture-live'))
        check('fixture-owner-rows-visible', True)
        close_sockets()
        for sequence in range(5, 8):
            observe('fixture-closed-child-live')
        check('live-dmtf-kernel-projection', True)
        child_eof()
        require(child.wait(timeout=20) == 0 and child.stdout.read(4097) in (b'{"event": "eof"}\n', b'{"event": "eof"}\r\n') and child.stderr.read(4097) == b'', 'CHILD_NOT_NORMAL_EOF_EXIT_ZERO')
        for sequence in range(8, 11):
            frame = observe('child-exited', post=True)
            if sequence >= 9:
                require(no_reserved_rows(frame), 'FIXED_FIXTURE_ENDPOINT_REMAINED')
        check('fixture-rows-closed', True)
        check('post-source-separated', True)
        check('ten-fresh-one-worker', collector.worker_starts == 1 and collector.requests == collector.responses == collector.sequence == 10 and [item['frame']['sequence'] for item in report['observations']] == list(range(1, 11)))
        collector.close_input()
        check('collector-normal-eof', collector.wait_normal() == 0)
        adapter.close_owned(owned)
        require(post_source(adapter.post_exit_status(borrowed), initial['borrowed']), 'BORROWED_POST_AFTER_CLOSE_FAILED')
        check('child-normal-eof-owned-close', child.returncode == 0 and adapter.owned_open_count == 0 and adapter.failure is None)
        verify_sources(contract)
        check('sources-still-sealed', True)
        report['passed'] = all(value is True for value in report['checks'].values())
    except Exception as error:
        report['error'] = {'code': getattr(error, 'code', type(error).__name__)}
    finally:
        for action, label in ((close_sockets, 'socketCloseError'), (child_eof, 'childEofError')):
            try:
                action()
            except Exception as error:
                report['passed'] = False
                report[label] = {'code': getattr(error, 'code', type(error).__name__)}
        if collector is not None:
            try:
                collector.close_input()
            except Exception as error:
                report['passed'] = False
                report['collectorEofError'] = {'code': getattr(error, 'code', type(error).__name__)}
        if child is not None and not child_stopped():
            try:
                child.wait(timeout=20)
            except Exception as error:
                report['passed'] = False
                report['childWaitError'] = {'code': getattr(error, 'code', type(error).__name__)}
        if collector is not None:
            try:
                collector.wait_normal()
            except Exception as error:
                report['passed'] = False
                report['collectorWaitError'] = {'code': getattr(error, 'code', type(error).__name__)}
        def captures_stopped():
            return child_stopped() and (collector is None or collector.stopped())
        if not captures_stopped():
            report['passed'] = False
            report['waitingForCapturedExit'] = True
            if collector is not None:
                report['collector'] = collector.evidence()
            early_attempted = True
            try:
                write_new(output / 'result.json', report)
                early_written = True
            except Exception as error:
                report['persistenceError'] = {'code': getattr(error, 'code', type(error).__name__)}
                try:
                    print(json.dumps({'purpose': report['purpose'], 'passed': False, 'errorCode': 'EARLY_RESULT_WRITE_FAILED', 'waitingForCapturedExit': True}), file=sys.stderr, flush=True)
                except Exception:
                    pass
            while not captures_stopped():
                time.sleep(0.5)  # no kill/unref; ownership does not depend on output
            report['waitingForCapturedExit'] = False
        try:
            adapter.close_all_owned()
        except Exception as error:
            report['passed'] = False
            report['ownedHandleCloseError'] = {'code': getattr(error, 'code', type(error).__name__)}
        if collector is not None:
            try:
                collector.close_pipes_after_exit()
            except Exception as error:
                report['passed'] = False
                report['collectorPipeCloseError'] = {'code': getattr(error, 'code', type(error).__name__)}
            report['collector'] = collector.evidence()
        if child is not None:
            child.stdout.close()
            child.stderr.close()
        report['normalStop'] = {
            'passed': child is not None and child.returncode == 0 and eof_child and adapter.owned_open_count == 0 and adapter.failure is None and collector is not None and collector.process is not None and collector.process.returncode == 0 and collector.failure is None and tcp is None and udp is None and 'childPollError' not in report,
            'childEofSent': eof_child, 'childPopenExitCode': child.returncode if child is not None else None,
            'ownedHandlesRemaining': adapter.owned_open_count, 'newCapturedProcessForcedStop': False,
            'fixturesClosed': tcp is None and udp is None}
        report['adapterFailure'] = adapter.failure
        report['earlyFailureArtifactAttempted'], report['earlyFailureArtifactWritten'] = early_attempted, early_written
        report['passed'] = report['passed'] and report['normalStop']['passed'] and not early_attempted
        write_new(output / ('late-normal-cleanup.json' if early_attempted else 'result.json'), report)
    print(json.dumps({'purpose': report['purpose'], 'scope': 'B', 'passed': report['passed'], 'result': str(output / 'result.json'), 'uiAdmissionGranted': False}), flush=True)
    return 0 if report['passed'] else 1


if __name__ == '__main__':
    try:
        require(os.name == 'nt' and os.path.normcase(str(ROOT)) == os.path.normcase(str(GUEST)), 'FIXED_ACTUAL_GUEST_ROOT_REQUIRED')
        require(os.path.normcase(sys.executable) == os.path.normcase(str(PYTHON)) and sys.flags.isolated and sys.flags.dont_write_bytecode and not sys.flags.optimize, 'FIXED_ISOLATED_UNOPTIMIZED_PYTHON_REQUIRED')
        parser = argparse.ArgumentParser(description='Root-sealed scope-B metadata collector tinyprobe only')
        parser.add_argument('--contract-sha256', required=True)
        args = parser.parse_args()
        raise SystemExit(run(args.contract_sha256))
    except Exception as error:
        print(json.dumps({'purpose': 'ui-observer-collector-tinyprobe', 'passed': False, 'errorCode': getattr(error, 'code', type(error).__name__), 'uiAdmissionGranted': False}), file=sys.stderr, flush=True)
        raise SystemExit(1)
