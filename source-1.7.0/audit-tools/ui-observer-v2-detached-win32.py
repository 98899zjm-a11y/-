"""SOURCE_ONLY Task2 adapter. Actual Guest only; never Host import/run.

One exact fixed Python parent Popen and one discovered Python child only.
Seven A2 APIs/query+synchronize; no arbitrary PID/script/root/terminate entry.
V2 uses public borrowed='borrowed' and owned='owned-query-synchronize'. A2's
separate borrowed-popen label/registry/source is not modified or imported.
"""

from pathlib import Path
import os

ROOT = Path(__file__).resolve().parents[1]
if os.name != 'nt' or os.path.normcase(str(ROOT)) != os.path.normcase('C:/xjy-work/xjy-web-stage1'):
    raise RuntimeError('Fixed actual Guest required before v2 adapter import')

import copy
from datetime import datetime, timedelta
import hashlib
import importlib.util
import re
import stat
import subprocess
import sys

PYTHON = Path('C:/Python314/python.exe')
PYTHON_SHA = '434b361fe0c5960d404974feed493db47f2603a1ace2574312104fbed0182c6f'
QUERY_SYNCHRONIZE = 0x00101000
GUARD_PINS = {
    'stage1/sandbox-context.py': '09426dfd4d699c51570e1f1b10c2e37c00f6feb699b9a472ca710ae5242bf249',
    'stage1/validate-sandbox-context.py': '867a0117d6bc200960df06a355ffafcf639f24532ece3bc4db34f6e397325207',
}
ADMISSION_TIMEOUT_BOUNDARY = (
    'Unmodified sandbox-context.read_context uses subprocess.run(timeout=20) for its existing metadata helper '
    'and may kill that helper on timeout; this exception does not apply to the new parent/child/collector.'
)
CHILD_SOURCE = (
    "import json, os, sys\n"
    "print(json.dumps({'event': 'ready', 'pid': os.getpid(), 'waitingForEof': True}), flush=True)\n"
    "if sys.stdin.buffer.read(1) != b'':\n"
    "    sys.stderr.write('UNEXPECTED_INPUT\\n')\n"
    "    sys.exit(2)\n"
    "print(json.dumps({'event': 'eof'}), flush=True)\n"
)
# Fixed same-bytes program; child source is a literal here, never CLI/env/path.
PARENT_SOURCE = r"""
import json, os, subprocess, sys, time
child_source = (
    "import json, os, sys\n"
    "print(json.dumps({'event': 'ready', 'pid': os.getpid(), 'waitingForEof': True}), flush=True)\n"
    "if sys.stdin.buffer.read(1) != b'':\n"
    "    sys.stderr.write('UNEXPECTED_INPUT\\n')\n"
    "    sys.exit(2)\n"
    "print(json.dumps({'event': 'eof'}), flush=True)\n"
)
child = None
failed = False
eof_sent = False
child_code = None
try:
    env = {'SystemRoot': r'C:\Windows', 'WINDIR': r'C:\Windows', 'TEMP': os.environ['TEMP'], 'TMP': os.environ['TMP']}
    child = subprocess.Popen(['C:/Python314/python.exe', '-I', '-B', '-X', 'utf8', '-c', child_source],
                             cwd='C:/xjy-work/xjy-web-stage1', env=env, shell=False, close_fds=True,
                             creationflags=0x8, stdin=subprocess.PIPE, stdout=subprocess.PIPE, stderr=subprocess.PIPE)
    ready = child.stdout.readline(4097)
    if len(ready) > 4096 or not ready.endswith(b'\n') or json.loads(ready.decode('utf-8', errors='strict')) != {'event': 'ready', 'pid': child.pid, 'waitingForEof': True}:
        raise RuntimeError('FIXED_CHILD_READY_FAILED')
    print(json.dumps({'event': 'parent-ready', 'pid': os.getpid(), 'childPid': child.pid, 'waitingForEof': True}), flush=True)
    if sys.stdin.buffer.read(1) != b'':
        raise RuntimeError('UNEXPECTED_PARENT_INPUT')
except BaseException:
    failed = True
finally:
    if child is not None:
        try:
            child.stdin.close()
            eof_sent = True
        except BaseException:
            failed = True
        while child_code is None:
            try:
                child_code = child.wait()
            except BaseException:
                failed = True
                try:
                    time.sleep(0.5)
                except BaseException:
                    pass
        try:
            tail = child.stdout.read(4097)
            error = child.stderr.read(4097)
            if child_code != 0 or not eof_sent or tail not in (b'{"event": "eof"}\n', b'{"event": "eof"}\r\n') or error != b'':
                failed = True
            child.stdout.close()
            child.stderr.close()
        except BaseException:
            failed = True
    else:
        failed = True
    try:
        print(json.dumps({'event': 'parent-eof', 'pid': os.getpid(), 'childPid': child.pid if child is not None else None,
                          'childExitCode': child_code, 'childEofSent': eof_sent, 'failed': failed}), flush=True)
    except BaseException:
        failed = True
sys.exit(1 if failed else 0)
""".strip()


class NativeError(RuntimeError):
    def __init__(self, code, api_error=None):
        super().__init__(code)
        self.code, self.api_error = code, api_error


def require(value, code):
    if not value:
        raise NativeError(code)


def ordinary(file, boundary):
    file, boundary = Path(file), Path(boundary)
    require(file.is_absolute() and file.is_relative_to(boundary), 'PATH_BOUNDARY_REFUSED')
    for item in (file, *file.parents):
        info = item.lstat()
        require(not stat.S_ISLNK(info.st_mode) and not getattr(info, 'st_file_attributes', 0) & 0x400, 'PATH_LINK_REFUSED')
        require(not stat.S_ISREG(info.st_mode) or info.st_nlink == 1, 'FILE_HARDLINK_REFUSED')
        if item == boundary:
            return file
    raise NativeError('PHYSICAL_BOUNDARY_MISSING')


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


def _admission():
    reviewed = {}
    for relative, sha in GUARD_PINS.items():
        body = stable_bytes(ROOT / relative, ROOT)
        require(hashlib.sha256(body).hexdigest() == sha, 'ORIGINAL_GUARD_CHANGED')
        reviewed[relative] = body
    file = ROOT / 'stage1/sandbox-context.py'
    spec = importlib.util.spec_from_file_location('v2_actual_context', file)
    module = importlib.util.module_from_spec(spec)
    exec(compile(reviewed['stage1/sandbox-context.py'], str(file), 'exec'), module.__dict__)
    return module.read_context(ROOT)


def _path(value):
    require(isinstance(value, str) and 0 < len(value) <= 32768 and '\x00' not in value, 'BOUNDED_IMAGE_REQUIRED')
    return value.replace('/', '\\').casefold()


def _source(row):
    require(isinstance(row, dict), 'SOURCE_ROW_REQUIRED')
    pid, parent = row.get('processId'), row.get('parentProcessId')
    require(type(pid) is int and 1 <= pid <= 0xffffffff and type(parent) is int and 0 <= parent <= 0xffffffff and pid != parent, 'SOURCE_PID_REQUIRED')
    raw = row.get('cimCreationDmtfRaw')
    require(row.get('cimCreationValueType') == 'System.String' and isinstance(raw, str) and re.fullmatch(r'[0-9]{14}\.[0-9]{6}[+-][0-9]{3}', raw) is not None, 'RAW_DMTF_REQUIRED')
    instant = datetime(int(raw[:4]), int(raw[4:6]), int(raw[6:8]), int(raw[8:10]), int(raw[10:12]), int(raw[12:14]), int(raw[15:21]))
    offset = int(raw[22:25]) * (1 if raw[21] == '+' else -1)
    delta = instant - timedelta(minutes=offset) - datetime(1601, 1, 1)
    return pid, parent, raw, (delta.days * 86400 + delta.seconds) * 1_000_000 + delta.microseconds, _path(row.get('wmiExecutablePath'))


class _Adapter:
    def __init__(self, admission):
        import ctypes as C
        from ctypes import wintypes as W
        self._C, self._W, self._admission = C, W, admission
        self._failure, self._parent, self._child = None, None, None
        self._records, self._source_offset, self._source_sequence, self._model_frames = {}, None, 0, 0
        self._current, self._mapping = {}, []
        self._api = C.WinDLL('C:/Windows/System32/kernel32.dll', use_last_error=True)
        signatures = {
            'OpenProcess': ([W.DWORD, W.BOOL, W.DWORD], W.HANDLE),
            'GetProcessId': ([W.HANDLE], W.DWORD),
            'GetProcessTimes': ([W.HANDLE, C.POINTER(W.FILETIME), C.POINTER(W.FILETIME), C.POINTER(W.FILETIME), C.POINTER(W.FILETIME)], W.BOOL),
            'QueryFullProcessImageNameW': ([W.HANDLE, W.DWORD, W.LPWSTR, C.POINTER(W.DWORD)], W.BOOL),
            'WaitForSingleObject': ([W.HANDLE, W.DWORD], W.DWORD),
            'GetExitCodeProcess': ([W.HANDLE, C.POINTER(W.DWORD)], W.BOOL),
            'CloseHandle': ([W.HANDLE], W.BOOL),
        }
        for name, (args, result) in signatures.items():
            function = getattr(self._api, name)
            function.argtypes, function.restype = args, result

    @property
    def parent_command(self):
        return [str(PYTHON), '-I', '-B', '-X', 'utf8', '-c', PARENT_SOURCE]

    @property
    def admission(self):
        return copy.deepcopy(self._admission)

    @property
    def failure(self):
        return copy.deepcopy(self._failure)

    @property
    def owned_open_count(self):
        return sum(value['owned'] and not value['closed'] for value in self._records.values())

    @property
    def sequence_evidence(self):
        return {'sourceOffset': self._source_offset, 'lastSourceSequence': self._source_sequence,
                'modelFrames': self._model_frames, 'mapping': copy.deepcopy(self._mapping)}

    def _fail(self, code, api_error=None):
        if self._failure is None:
            self._failure = {'code': code, **({'apiError': api_error} if api_error is not None else {})}
        raise NativeError(self._failure['code'], self._failure.get('apiError')) from None

    def _new_work(self):
        if self._failure is not None:
            self._fail('ADAPTER_ALREADY_FAILED')

    def _status(self, handle):
        C, W = self._C, self._W
        pid = int(self._api.GetProcessId(handle))
        if not pid:
            self._fail('GET_PROCESS_ID_FAILED', C.get_last_error())
        created, exited, kernel, user = W.FILETIME(), W.FILETIME(), W.FILETIME(), W.FILETIME()
        if not self._api.GetProcessTimes(handle, C.byref(created), C.byref(exited), C.byref(kernel), C.byref(user)):
            self._fail('GET_PROCESS_TIMES_FAILED', C.get_last_error())
        ticks = (int(created.dwHighDateTime) << 32) | int(created.dwLowDateTime)
        state = int(self._api.WaitForSingleObject(handle, 0))
        if state not in (0, 258):
            self._fail('WAIT_QUERY_FAILED', C.get_last_error() if state == 0xffffffff else state)
        code = None
        if state == 0:
            value = W.DWORD()
            if not self._api.GetExitCodeProcess(handle, C.byref(value)):
                self._fail('GET_EXIT_CODE_FAILED', C.get_last_error())
            code = int(value.value)
        return {'pid': pid, 'creationFileTime': str(ticks), 'signaled': state == 0,
                'exitCode': code, 'identitySource': 'held-kernel-process-handle'}

    def _checked_status(self, record):
        value = self._status(record['handle'])
        if value['pid'] != record['pid'] or record['creation'] is not None and value['creationFileTime'] != record['creation']:
            self._fail('CAPTURED_KERNEL_IDENTITY_CHANGED')
        if record['creation'] is None:
            record['creation'] = value['creationFileTime']
        return value

    def inspect_held(self, token):
        record = self._records.get(token)
        require(record is not None and not record['closed'], 'KNOWN_UNCLOSED_TOKEN_REQUIRED')
        before = self._checked_status(record)
        role = 'owned-query-synchronize' if record['owned'] else 'borrowed'
        if before['signaled']:
            captured = record['capture']
            if captured is None:
                self._fail('HELD_EXIT_REQUIRES_LIVE_CAPTURE')
            return {**before, 'kind': 'held-exit', 'handleOwnership': role, 'capturedLiveImagePath': captured['path'],
                    'capturedLiveImageProvenance': {'sourceApi': 'QueryFullProcessImageNameW', 'sourceStage': 'captured-live-image',
                        'fresh': False, 'capturedPid': captured['pid'], 'capturedCreationFileTime': captured['creation'],
                        'capturedNonsignaledBefore': True, 'capturedNonsignaledAfter': True, 'captureRole': role}}
        C, W = self._C, self._W
        size = W.DWORD(32768)
        image = C.create_unicode_buffer(size.value)
        if not self._api.QueryFullProcessImageNameW(record['handle'], 0, image, C.byref(size)):
            self._fail('QUERY_LIVE_IMAGE_FAILED', C.get_last_error())
        if not size.value or size.value >= 32768 or not image.value or _path(image.value) != _path(str(PYTHON)):
            self._fail('FIXED_PYTHON_IMAGE_MISMATCH')
        after = self._checked_status(record)
        if after['signaled']:
            self._fail('EXIT_DURING_LIVE_IMAGE_CAPTURE')
        if record['capture'] is None:
            record['capture'] = {'pid': after['pid'], 'creation': after['creationFileTime'], 'path': image.value}
        elif _path(record['capture']['path']) != _path(image.value):
            self._fail('CAPTURED_LIVE_IMAGE_CHANGED')
        return {**after, 'kind': 'live', 'handleOwnership': role, 'imagePath': image.value,
                'imagePathProvenance': {'sourceApi': 'QueryFullProcessImageNameW', 'sourceStage': 'fresh-live-image',
                                        'fresh': True, 'nonsignaledBefore': True, 'nonsignaledAfter': True}}

    def register_parent(self, process):
        self._new_work()
        require(self._parent is None and isinstance(process, subprocess.Popen) and process.args == self.parent_command, 'FIXED_ACTUAL_PARENT_POPEN_REQUIRED')
        require(type(process.pid) is int and 1 <= process.pid <= 0xffffffff, 'CAPTURED_PID_REQUIRED')
        handle = int(process._handle)
        require(handle != 0, 'CAPTURED_POPEN_HANDLE_REQUIRED')
        token = object()
        self._records[token] = {'handle': handle, 'process': process, 'pid': process.pid, 'creation': None,
                                'owned': False, 'closed': False, 'capture': None}
        self._parent = token  # strong borrowed capture precedes any validation
        require(self.inspect_held(token)['kind'] == 'live', 'PARENT_NOT_LIVE_WHEN_REGISTERED')
        return token

    def _index(self, frame):
        require(isinstance(frame, dict) and frame.get('schemaVersion') == 1 and isinstance(frame.get('processes'), list), 'REVIEWED_COLLECTOR_FRAME_REQUIRED')
        indexed = {}
        for row in frame['processes']:
            pid = row.get('processId')
            require(type(pid) is int and 0 <= pid <= 0xffffffff and pid not in indexed, 'AMBIGUOUS_COLLECTOR_PID')
            indexed[pid] = row
        return indexed

    def bind_root_frame(self, frame):
        self._new_work()
        require(self._parent is not None and self._source_offset is None and type(frame.get('sequence')) is int and frame['sequence'] == 2, 'EXACT_SECOND_SOURCE_ROOT_FRAME_REQUIRED')
        indexed = self._index(frame)
        value = self.inspect_held(self._parent)
        require(value['kind'] == 'live' and value['pid'] in indexed, 'LIVE_PARENT_SOURCE_REQUIRED')
        row = indexed[value['pid']]
        source = _source(row)
        require(source[1] == os.getpid() and source[3] == int(value['creationFileTime']) // 10 and source[4] == _path(value['imagePath']), 'PARENT_SOURCE_BINDING_MISMATCH')
        self._source_offset = self._source_sequence = 2
        self._current = indexed
        self._mapping.append({'sourceSequence': 2, 'pureSequence': 0, 'role': 'root-initialization'})
        return {key: copy.deepcopy(row[key]) for key in ('processId', 'parentProcessId', 'wmiExecutablePath', 'cimCreationDmtfRaw', 'cimCreationValueType')}

    def bind_model_frame(self, frame):
        self._new_work()
        sequence = frame.get('sequence')
        require(self._source_offset == 2 and type(sequence) is int and sequence == self._source_sequence + 1 and self._model_frames < 16 and sequence <= 18, 'SOURCE_SEQUENCE_OR_BUDGET_REFUSED')
        indexed = self._index(frame)
        self._source_sequence = sequence
        self._model_frames += 1
        self._current = indexed
        self._mapping.append({'sourceSequence': sequence, 'pureSequence': sequence - self._source_offset, 'role': 'model-frame'})
        return {'sequence': sequence - self._source_offset, 'processes': copy.deepcopy(frame['processes'])}

    def open_candidate(self, parent_token, row, discovery_sequence):
        self._new_work()
        require(parent_token is self._parent and self._child is None and self._source_offset == 2 and
                type(discovery_sequence) is int and discovery_sequence == self._model_frames and 1 <= discovery_sequence <= 16, 'FIXED_CHILD_DISCOVERY_REQUIRED')
        source = _source(row)
        require(source[0] in self._current and _source(self._current[source[0]]) == source, 'CURRENT_SOURCE_ROW_REQUIRED')
        parent = self.inspect_held(parent_token)
        require(parent['kind'] == 'live' and source[0] != parent['pid'] and source[1] == parent['pid'] and source[4] == _path(str(PYTHON)), 'LIVE_PARENT_CHILD_BINDING_REQUIRED')
        require(parent['pid'] in self._current and _source(self._current[parent['pid']])[3] == int(parent['creationFileTime']) // 10, 'PARENT_SOURCE_REBIND_REQUIRED')
        handle = self._api.OpenProcess(QUERY_SYNCHRONIZE, False, source[0])
        if not handle:
            self._fail('OPEN_QUERY_SYNCHRONIZE_FAILED', self._C.get_last_error())
        token = object()
        self._records[token] = {'handle': handle, 'process': None, 'pid': source[0], 'creation': None,
                                'owned': True, 'closed': False, 'capture': None}
        self._child = token  # account before GetProcessTimes/image/source checks
        value = self.inspect_held(token)
        require(value['kind'] == 'live' and int(value['creationFileTime']) // 10 == source[3] and
                int(value['creationFileTime']) >= int(parent['creationFileTime']), 'CHILD_SOURCE_OR_ORDER_MISMATCH')
        require(self.inspect_held(parent_token)['kind'] == 'live', 'PARENT_EXITED_DURING_CHILD_OPEN')
        return token

    def held_statuses(self):
        return [self._checked_status(record) for record in self._records.values() if not record['closed']]

    def held_views(self):
        return [self.inspect_held(token) for token, record in self._records.items() if not record['closed']]

    def close_owned(self, token):
        record = self._records.get(token)
        if record is None or not record['owned']:
            raise ValueError('Borrowed/unregistered token is never closed')
        if record['closed']:
            return None
        if not self._checked_status(record)['signaled']:
            raise ValueError('Live owned object remains held; normal stop first')
        if not self._api.CloseHandle(record['handle']):
            self._fail('OWNED_CLOSE_FAILED', self._C.get_last_error())
        record['closed'] = True
        return None

    def close_all_owned(self):
        failed = False
        for token, record in self._records.items():
            if record['owned'] and not record['closed']:
                try:
                    self.close_owned(token)
                except Exception:
                    failed = True
        if failed:
            raise NativeError('OWNED_CLEANUP_INCOMPLETE') from None


def create_adapter():
    require(os.path.normcase(sys.executable) == os.path.normcase(str(PYTHON)) and sys.flags.isolated and sys.flags.dont_write_bytecode and not sys.flags.optimize, 'FIXED_ISOLATED_PUBLIC_PYTHON_REQUIRED')
    require(hashlib.sha256(stable_bytes(PYTHON, Path('C:/'))).hexdigest() == PYTHON_SHA, 'PUBLIC_PYTHON_CHANGED')
    return _Adapter(_admission())
