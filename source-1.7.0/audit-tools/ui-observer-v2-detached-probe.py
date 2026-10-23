"""SOURCE_ONLY diagnostic copy of fe6b parent->one-child tinyprobe; never Host run.

Root alone seals audit-tools/ui-observer-v2-detached-contract.json and invokes
--contract-sha256. Exact schema: version/state/purpose/scope/runId/sources/
dependencies/python/powershell/literals/limits. state=ROOT_SEALED_SOURCE,
purpose=ui-observer-v2-native-parent-child-detached-diagnostic, scope=parent-child-only;
sources is the frozen adapter and this new probe, dependencies is exact PINS. python and PS
are fixed public paths/SHA (PS linkCount=1). literals is parent/child/collector
SHA. limits is exactly history2/modelFrames16/collectorRequests18. No contract
or guessed hash is generated here; proposal remains SOURCE_ONLY.

No product/DB/UI/owner/port/worker-root/extra API. B worker is direct Popen+EOF,
descendants unknown. Last global frame precedes its exit; no invented postscan.
Root caller must not timeout-kill. Capture/owned-ledger retention survives output
failure; original admission metadata timeout is separately disclosed.

Only extra work is bounded CreateNew processRows/queryWindow evidence for the
same capability/root/model frames before consumption. No row filtering, extra
queries or changed checks/limits/ownership/EOF; obtaining diagnostics is not PASS.
"""

from pathlib import Path
import argparse
import ast
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
RESULTS = Path('C:/xjy-results')
PYTHON = Path('C:/Python314/python.exe')
POWERSHELL = Path('C:/Windows/System32/WindowsPowerShell/v1.0/powershell.exe')
ADAPTER = 'audit-tools/ui-observer-v2-detached-win32.py'
PROBE = 'audit-tools/ui-observer-v2-detached-probe.py'
MODEL = 'audit-tools/ui-observer-v2.py'
PROOF = 'stage1/guest-owned-process-proof.py'
COLLECTOR = 'audit-tools/ui-observer-collector.py'
CONTRACT = ROOT / 'audit-tools/ui-observer-v2-detached-contract.json'
PINS = {
    MODEL: '4c6e2cf4c6ff754b4631d9c49c2b568fe7f84ae8a3efef2cb5f31acf9623d131',
    PROOF: 'b06b4d0254a226dbd849d18a576674e7da6cfad55944ee347b920c5bcc6bad07',
    COLLECTOR: '264b717e5e264e39ac1b57be948c0da6abf4d19583ca5d3bed96ff3d6a2dea6e',
    'stage1/sandbox-context.py': '09426dfd4d699c51570e1f1b10c2e37c00f6feb699b9a472ca710ae5242bf249',
    'stage1/validate-sandbox-context.py': '867a0117d6bc200960df06a355ffafcf639f24532ece3bc4db34f6e397325207',
}
PUBLIC_PYTHON_SHA = '434b361fe0c5960d404974feed493db47f2603a1ace2574312104fbed0182c6f'
PUBLIC_POWERSHELL_SHA = '60c9b29843624dd8af6b6a7b26147753be6aeef65098b9a503cc50850afe410f'
COLLECTOR_LITERAL_SHA = '27e2888c7a740cc06925d4d032d299a9509f3d2b234b7dad7d13df52f972197d'
LIMITS = {'history': 2, 'modelFrames': 16, 'collectorRequests': 18}
CHECKS = ('source-seals', 'collector-capability', 'fixed-parent-ready', 'parent-source-kernel',
          'fixed-source-offset', 'child-live-pin', 'repeated-live', 'parent-child-eof-zero',
          'two-clean-held-exit-samples', 'post-provenance-stable', 'source-request-accounting', 'owned-close-borrowed-held',
          'collector-normal-eof', 'sources-still-sealed')


class ProbeError(RuntimeError):
    def __init__(self, code):
        super().__init__(code)
        self.code = code


def require(value, code):
    if not value:
        raise ProbeError(code)


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


def stable_bytes(file, boundary, limit=8 * 1024 * 1024):
    file = ordinary(file, boundary)
    before = file.stat()
    require(file.is_file() and before.st_size <= limit, 'BOUNDED_ORDINARY_FILE_REQUIRED')
    with file.open('rb') as stream:
        opened = os.fstat(stream.fileno())
        common = ('st_dev', 'st_ino', 'st_size', 'st_mtime_ns', 'st_nlink')
        births = (getattr(before, 'st_birthtime_ns', None), getattr(opened, 'st_birthtime_ns', None))
        require(all(getattr(before, key) == getattr(opened, key) for key in common) and (None in births or births[0] == births[1]), 'FILE_CHANGED_BEFORE_READ')
        body = stream.read(limit + 1)
        require(len(body) == before.st_size and file_identity(os.fstat(stream.fileno())) == file_identity(opened), 'FILE_CHANGED_DURING_READ')
    require(file_identity(ordinary(file, boundary).stat()) == file_identity(before), 'FILE_CHANGED_AFTER_READ')
    return body


def digest(body):
    return hashlib.sha256(body).hexdigest()


def unique_object(pairs):
    value = {}
    for key, item in pairs:
        require(key not in value, 'DUPLICATE_JSON_FIELD')
        value[key] = item
    return value


def verify_sources(contract):
    reviewed = {}
    for relative, sha in {**contract['sources'], **PINS}.items():
        body = stable_bytes(ROOT / relative, ROOT)
        require(digest(body) == sha, 'SEALED_SOURCE_CHANGED')
        reviewed[relative] = body
    require(digest(stable_bytes(PYTHON, Path('C:/'))) == PUBLIC_PYTHON_SHA, 'PUBLIC_PYTHON_CHANGED')
    require(digest(stable_bytes(POWERSHELL, Path('C:/'))) == PUBLIC_POWERSHELL_SHA, 'PUBLIC_POWERSHELL_CHANGED')
    return reviewed


def load_contract(expected):
    require(re.fullmatch(r'[0-9a-f]{64}', expected) is not None, 'ROOT_CONTRACT_SHA_REQUIRED')
    body = stable_bytes(CONTRACT, ROOT, 32768)
    require(digest(body) == expected, 'ROOT_CONTRACT_SHA_MISMATCH')
    value = json.loads(body, object_pairs_hook=unique_object)
    require(isinstance(value, dict) and set(value) == {'version', 'state', 'purpose', 'scope', 'runId', 'sources', 'dependencies', 'python', 'powershell', 'literals', 'limits'}, 'CONTRACT_SCHEMA_REFUSED')
    require(type(value['version']) is int and value['version'] == 1 and value['state'] == 'ROOT_SEALED_SOURCE' and value['purpose'] == 'ui-observer-v2-native-parent-child-detached-diagnostic' and value['scope'] == 'parent-child-only', 'CONTRACT_NOT_ROOT_SEALED')
    require(isinstance(value['runId'], str) and re.fullmatch(r'[a-z0-9](?:[a-z0-9-]{0,38}[a-z0-9])?', value['runId']) is not None, 'RUN_ID_REFUSED')
    require(isinstance(value['sources'], dict) and set(value['sources']) == {ADAPTER, PROBE} and value['dependencies'] == PINS and value['limits'] == LIMITS and all(type(item) is int for item in value['limits'].values()), 'SOURCE_OR_LIMIT_SET_REFUSED')
    require(value['python'] == {'path': 'C:/Python314/python.exe', 'sha256': PUBLIC_PYTHON_SHA} and value['powershell'] == {'path': 'C:/Windows/System32/WindowsPowerShell/v1.0/powershell.exe', 'sha256': PUBLIC_POWERSHELL_SHA, 'linkCount': 1} and type(value['powershell']['linkCount']) is int, 'PUBLIC_DEPENDENCY_REFUSED')
    require(isinstance(value['literals'], dict) and set(value['literals']) == {'parent', 'child', 'collector'} and value['literals']['collector'] == COLLECTOR_LITERAL_SHA, 'FIXED_LITERALS_REQUIRED')
    require(all(isinstance(sha, str) and re.fullmatch(r'[0-9a-f]{64}', sha) is not None for sha in [*value['sources'].values(), *value['literals'].values()]), 'ROOT_ACTUAL_SOURCE_SHA_REQUIRED')
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


def identity(value):
    return value['pid'], value['creationFileTime']


def captured_matches(post, live):
    return (post.get('kind') == 'held-exit' and post.get('signaled') is True and post.get('exitCode') == 0 and
            'imagePath' not in post and identity(post) == identity(live) and
            os.path.normcase(post.get('capturedLiveImagePath', '')) == os.path.normcase(live['imagePath']) and
            post.get('capturedLiveImageProvenance') == {
                'sourceApi': 'QueryFullProcessImageNameW', 'sourceStage': 'captured-live-image', 'fresh': False,
                'capturedPid': live['pid'], 'capturedCreationFileTime': live['creationFileTime'],
                'capturedNonsignaledBefore': True, 'capturedNonsignaledAfter': True,
                'captureRole': live['handleOwnership']})


def run(expected):
    contract, reviewed = load_contract(expected)
    native = load_same_bytes('qa_v2_native_adapter', ADAPTER, reviewed[ADAPTER])
    model_module = load_same_bytes('qa_v2_pure_model', MODEL, reviewed[MODEL])
    proof = load_same_bytes('qa_v2_pinned_proof', PROOF, reviewed[PROOF])
    broker = load_same_bytes('qa_v2_pinned_collector', COLLECTOR, reviewed[COLLECTOR])
    require(digest(native.PARENT_SOURCE.encode('utf-8')) == contract['literals']['parent'] and
            digest(native.CHILD_SOURCE.encode('utf-8')) == contract['literals']['child'] and
            digest(broker.WORKER_SOURCE.encode('utf-8')) == COLLECTOR_LITERAL_SHA, 'LITERAL_SEAL_MISMATCH')
    # No second script-path execution: verify the nested child constant itself.
    parent_tree = ast.parse(native.PARENT_SOURCE)
    nested = next(node for node in parent_tree.body if isinstance(node, ast.Assign) and any(isinstance(target, ast.Name) and target.id == 'child_source' for target in node.targets))
    require(ast.literal_eval(nested.value) == native.CHILD_SOURCE, 'FIXED_NESTED_CHILD_MISMATCH')
    adapter = native.create_adapter()  # original guard before DLL and mutation
    ordinary(RESULTS, RESULTS)
    output = RESULTS / ('ui-observer-v2-detached-' + contract['runId'])
    output.mkdir()
    ordinary(output, RESULTS)
    report = {'purpose': contract['purpose'], 'scope': contract['scope'], 'actualGuest': True, 'passed': False,
              'contractSha256': expected, 'sources': contract['sources'], 'dependencies': PINS, 'literals': contract['literals'],
              'checks': {name: None for name in CHECKS}, 'samples': [], 'diagnosticFrames': [], 'uiAdmissionGranted': False,
              'workerIdentitySource': 'direct-popen-createprocess-capture', 'workerDescendantClosureAssessed': False,
              'globalScanAfterCollectorExitAssessed': False, 'allListenersClosedAssessed': False,
              'databaseOrOwnerWritesAssessed': False, 'businessOrUiInvoked': False, 'admission': adapter.admission,
              'admissionDependency': native.ADMISSION_TIMEOUT_BOUNDARY, 'requestedOwnedAccessMask': native.QUERY_SYNCHRONIZE}
    parent = collector = observer = root_token = None
    parent_eof = False
    reader = None
    first_attempted = first_written = False
    ready_child_pid = None

    def error(label, caught):
        report['passed'] = False
        value = {'code': getattr(caught, 'code', type(caught).__name__)}
        if getattr(caught, 'api_error', None) is not None:
            value['apiError'] = caught.api_error
        entry = {'stage': label, **value}
        if 'error' not in report:
            report['error'] = entry
        else:
            additional = report.setdefault('additionalErrors', [])
            if entry != report['error'] and entry not in additional and len(additional) < 8:
                additional.append(entry)

    def check(name, condition):
        report['checks'][name] = bool(condition)
        require(condition, name.upper().replace('-', '_'))

    def parent_input_eof():
        nonlocal parent_eof
        if parent is not None and not parent_eof:
            parent.stdin.close()
            parent_eof = True

    def captured_stopped(process, label):
        if process is None:
            return True
        try:
            process.wait(timeout=0.05)
            return True
        except subprocess.TimeoutExpired:
            return False
        except BaseException as caught:
            error(label, caught)
            return False

    def captures_stopped():
        a = captured_stopped(parent, 'parent-capture-wait')
        b = captured_stopped(collector.process if collector is not None else None, 'collector-capture-wait')
        return a and b

    def first_failure_artifact():
        nonlocal first_attempted, first_written
        if first_attempted:
            return
        first_attempted = True
        try:
            report['passed'] = False
            report['holdingOriginalCaptures'] = True
            report['ownedHandlesRemaining'] = adapter.owned_open_count
            if collector is not None:
                report['collector'] = collector.evidence()
            write_new(output / 'result.json', report)
            first_written = True
        except BaseException as caught:
            error('early-result-persistence', caught)
            try:
                print('{"purpose":"ui-observer-v2-native-parent-child-detached-diagnostic","passed":false,"holdingOriginalCaptures":true}', file=sys.stderr, flush=True)
            except BaseException:
                pass

    def hold_pause():
        try:
            time.sleep(0.5)
        except BaseException as caught:
            error('holding-interrupted', caught)

    def diagnostic_frame(role):
        require(role in ('capability', 'root', 'model') and len(report['diagnosticFrames']) < 18,
                'DIAGNOSTIC_FRAME_BUDGET_OR_ROLE_REFUSED')
        frame = collector.list()
        sequence, rows = frame['sequence'], frame['processes']
        require(type(sequence) is int and sequence == len(report['diagnosticFrames']) + 1 and
                isinstance(rows, list) and len(rows) <= 65536, 'DIAGNOSTIC_SOURCE_SEQUENCE_OR_ROWS_REFUSED')
        body = (json.dumps({'sourceSequence': sequence, 'role': role, 'queryWindow': frame['queryWindow'],
                            'processRows': rows}, ensure_ascii=False, separators=(',', ':')) + '\n').encode('utf-8')
        require(len(body) <= 8 * 1024 * 1024, 'DIAGNOSTIC_FRAME_BYTES_REFUSED')
        name = 'process-frame-' + format(sequence, '02d') + '-' + role + '.json'
        ordinary(output, RESULTS)
        with (output / name).open('xb') as stream:
            require(stream.write(body) == len(body), 'DIAGNOSTIC_FRAME_WRITE_INCOMPLETE')
            stream.flush()
            os.fsync(stream.fileno())
        saved = stable_bytes(output / name, RESULTS)
        require(saved == body, 'DIAGNOSTIC_FRAME_CHANGED_AFTER_WRITE')
        report['diagnosticFrames'].append({'sourceSequence': sequence, 'role': role, 'file': name,
                                          'sha256': digest(saved), 'bytes': len(saved), 'rowCount': len(rows)})
        return frame  # Exactly the collector object, with every process row unchanged.

    def read_model_frame():
        require(collector.requests < 18, 'TOTAL_COLLECTOR_REQUEST_BUDGET')
        frame = diagnostic_frame('model')
        mapped = adapter.bind_model_frame(frame)
        report['lastGlobalSourceSequence'] = frame['sequence']
        return mapped

    try:
        check('source-seals', True)
        collector = broker.create_collector(powershell_sha256=PUBLIC_POWERSHELL_SHA, powershell_link_count=1,
                                           worker_literal_sha256=COLLECTOR_LITERAL_SHA, output_dir=output)
        collector.start()
        capability = diagnostic_frame('capability')
        report['capability'] = capability['capabilities']
        check('collector-capability', capability['sequence'] == 1)
        env = {'SystemRoot': 'C:\\Windows', 'WINDIR': 'C:\\Windows', 'TEMP': str(output), 'TMP': str(output)}
        parent = subprocess.Popen(adapter.parent_command, cwd=ROOT, env=env, shell=False, close_fds=True,
                                  creationflags=0x8, stdin=subprocess.PIPE, stdout=subprocess.PIPE, stderr=subprocess.PIPE)
        root_token = adapter.register_parent(parent)
        ready = queue.Queue(maxsize=1)
        def read_ready():
            try:
                ready.put(parent.stdout.readline(4097))
            except BaseException:
                ready.put(None)
        reader = threading.Thread(target=read_ready, daemon=True)
        reader.start()
        line = ready.get(timeout=20)
        reader.join(timeout=1)
        require(not reader.is_alive() and isinstance(line, bytes) and len(line) <= 4096 and line.endswith(b'\n'), 'BOUNDED_PARENT_READY_REQUIRED')
        ready_value = json.loads(line.decode('utf-8', errors='strict'), object_pairs_hook=unique_object)
        require(isinstance(ready_value, dict) and set(ready_value) == {'event', 'pid', 'childPid', 'waitingForEof'}, 'FIXED_READY_SCHEMA')
        ready_child_pid = ready_value['childPid']
        check('fixed-parent-ready', ready_value['event'] == 'parent-ready' and ready_value['pid'] == parent.pid and
              type(ready_child_pid) is int and 1 <= ready_child_pid <= 0xffffffff and ready_child_pid != parent.pid and ready_value['waitingForEof'] is True)
        root_frame = diagnostic_frame('root')
        root_row = adapter.bind_root_frame(root_frame)
        check('parent-source-kernel', root_row['processId'] == parent.pid)
        check('fixed-source-offset', adapter.sequence_evidence['sourceOffset'] == 2 and root_frame['sequence'] == 2)
        observer = model_module.create_observer_v2(kernel=adapter, read_frame=read_model_frame, proof_update=proof.update_owned,
                roots=[{'role': 'parent', 'token': root_token, 'row': root_row}], max_history=2)
        live = observer.sample()
        report['samples'].append(live)
        pre = {value['pid']: value for value in live['verifiedLive']}
        check('child-live-pin', set(pre) == {parent.pid, ready_child_pid} and adapter.owned_open_count == 1 and
              len(observer.history) == 2 and all(value['kind'] == 'live' and value['signaled'] is False for value in pre.values()))
        live_again = observer.sample()
        report['samples'].append(live_again)
        check('repeated-live', {identity(value) for value in live_again['verifiedLive']} == {identity(value) for value in pre.values()})
        parent_input_eof()
        code = parent.wait(timeout=20)
        tail, stderr = parent.stdout.read(4097), parent.stderr.read(4097)
        require(len(tail) <= 4096 and tail.endswith(b'\n') and stderr == b'', 'BOUNDED_PARENT_EOF_OUTPUT_REQUIRED')
        final = json.loads(tail.decode('utf-8', errors='strict'), object_pairs_hook=unique_object)
        report['parentFinal'] = final
        check('parent-child-eof-zero', code == 0 and final == {'event': 'parent-eof', 'pid': parent.pid,
                'childPid': ready_child_pid, 'childExitCode': 0, 'childEofSent': True, 'failed': False})
        for _ in range(2):
            sample = observer.sample()
            report['samples'].append(sample)
            require(sample['verifiedLive'] == [] and len(sample['history']) == 2, 'OWNED_PAIR_NOT_CLEAN')
        check('two-clean-held-exit-samples', True)
        post = adapter.held_views()
        report['post'] = post
        check('post-provenance-stable', len(post) == 2 and all(value['pid'] in pre and captured_matches(value, pre[value['pid']]) for value in post))
        accounting = adapter.sequence_evidence
        check('source-request-accounting', collector.worker_starts == 1 and
              collector.requests == collector.responses == accounting['lastSourceSequence'] <= 18 and
              accounting['modelFrames'] == accounting['lastSourceSequence'] - 2 <= 16)
        observer.close()
        adapter.close_all_owned()
        borrowed_post = adapter.inspect_held(root_token)
        report['borrowedAfterClose'] = borrowed_post
        check('owned-close-borrowed-held', adapter.owned_open_count == 0 and captured_matches(borrowed_post, pre[parent.pid]))
        collector.close_input()
        check('collector-normal-eof', collector.wait_normal() == 0)
        verify_sources(contract)
        check('sources-still-sealed', True)
        report['passed'] = all(value is True for value in report['checks'].values())
    except BaseException as caught:
        error('main', caught)
    finally:
        try:
            parent_input_eof()
        except BaseException as caught:
            error('parent-eof', caught)
        if collector is not None:
            try:
                collector.close_input()
            except BaseException as caught:
                error('collector-eof', caught)
        if parent is not None:
            try:
                parent.wait(timeout=20)
            except BaseException as caught:
                error('parent-normal-wait', caught)
        if collector is not None:
            try:
                collector.wait_normal()
            except BaseException as caught:
                error('collector-normal-wait', caught)
        if not captures_stopped():
            first_failure_artifact()
            while not captures_stopped():
                hold_pause()  # Retain same objects; output success is irrelevant.
        while True:
            try:
                owned_stopped = all(value['signaled'] for value in adapter.held_statuses())
            except BaseException as caught:
                error('held-status-cleanup', caught)
                owned_stopped = False
            if owned_stopped:
                break
            first_failure_artifact()
            hold_pause()
        if observer is not None:
            try:
                observer.close()
            except BaseException as caught:
                error('model-owned-close', caught)
        try:
            adapter.close_all_owned()
        except BaseException as caught:
            error('adapter-owned-close', caught)
        if adapter.owned_open_count:
            first_failure_artifact()
            while adapter.owned_open_count:
                hold_pause()  # Failure ledger is not erased or auto-retried as a new attempt.
        if collector is not None:
            try:
                collector.close_pipes_after_exit()
            except BaseException as caught:
                error('collector-pipe-close', caught)
            report['collector'] = collector.evidence()
        if reader is not None:
            try:
                reader.join(timeout=2)
                require(not reader.is_alive(), 'PARENT_READY_READER_REMAINS')
            except BaseException as caught:
                error('parent-reader-close', caught)
        if parent is not None:
            for stream in (parent.stdout, parent.stderr):
                try:
                    stream.close()
                except BaseException as caught:
                    error('parent-pipe-close', caught)
        report['sequenceEvidence'] = adapter.sequence_evidence
        report['adapterFailure'] = adapter.failure
        report['modelFailure'] = observer.failure if observer is not None else None
        report['normalStop'] = {'passed': parent is not None and parent.returncode == 0 and parent_eof and
                adapter.owned_open_count == 0 and adapter.failure is None and observer is not None and observer.failure is None and
                collector is not None and collector.process is not None and collector.process.returncode == 0 and collector.failure is None,
                'parentPopenExitCode': parent.returncode if parent is not None else None, 'parentEofSent': parent_eof,
                'ownedHandlesRemaining': adapter.owned_open_count, 'newCapturedProcessForcedStop': False,
                'workerDescendantClosureAssessed': False, 'globalScanAfterCollectorExitAssessed': False}
        report['holdingOriginalCaptures'] = False
        report['firstFailureArtifactAttempted'], report['firstFailureArtifactWritten'] = first_attempted, first_written
        report['passed'] = report['passed'] and report['normalStop']['passed'] and not first_attempted and 'error' not in report
        write_new(output / ('late-normal-cleanup.json' if first_attempted else 'result.json'), report)
    print(json.dumps({'purpose': report['purpose'], 'passed': report['passed'], 'uiAdmissionGranted': False,
                      'result': str(output / 'result.json')}), flush=True)
    return 0 if report['passed'] else 1


if __name__ == '__main__':
    try:
        require(os.name == 'nt' and os.path.normcase(str(ROOT)) == os.path.normcase('C:/xjy-work/xjy-web-stage1') and
                os.path.normcase(sys.executable) == os.path.normcase(str(PYTHON)) and sys.flags.isolated and
                sys.flags.dont_write_bytecode and not sys.flags.optimize, 'FIXED_ISOLATED_ACTUAL_GUEST_REQUIRED')
        parser = argparse.ArgumentParser(description=__doc__, allow_abbrev=False)
        parser.add_argument('--contract-sha256', required=True)
        args = parser.parse_args()
        raise SystemExit(run(args.contract_sha256))
    except Exception as caught:
        print(json.dumps({'purpose': 'ui-observer-v2-native-parent-child-detached-diagnostic', 'passed': False,
                          'errorCode': getattr(caught, 'code', type(caught).__name__), 'uiAdmissionGranted': False}), file=sys.stderr, flush=True)
        raise SystemExit(1)
