"""SOURCE_ONLY scope-A kernel adapter; actual Guest only, no Host import/run.

Only registered fixed EOF Popen children are accepted. Borrowed Popen._handle
is never closed here. All newly opened handles request query/synchronize only.
There is no inventory worker, product import, arbitrary-PID or terminate API.
The unchanged actualGuest guard runs before loading this adapter's WinDLL.
"""

from pathlib import Path
import os


ROOT = Path(__file__).resolve().parents[1]
GUEST = Path('C:/xjy-work/xjy-web-stage1')
if os.name != 'nt' or os.path.normcase(str(ROOT)) != os.path.normcase(str(GUEST)):
    raise RuntimeError('Actual fixed Guest required before native adapter import')

import copy
import hashlib
import importlib.util
import stat
import subprocess
import sys


PYTHON = Path('C:/Python314/python.exe')
QUERY_SYNCHRONIZE = 0x00101000
# Fixed, reviewed data-only program. It is part of this sealed adapter's bytes,
# never supplied by CLI/contract/environment or reread from another source path.
EOF_CHILD_SOURCE = (
    "import json, os, sys\n"
    "print(json.dumps({'event': 'ready', 'pid': os.getpid(), 'waitingForEof': True}), flush=True)\n"
    "if sys.stdin.buffer.read(1) != b'':\n"
    "    sys.stderr.write('UNEXPECTED_INPUT\\n')\n"
    "    sys.exit(2)\n"
    "print(json.dumps({'event': 'eof'}), flush=True)\n"
)
GUARD_PINS = {
    'stage1/sandbox-context.py': '09426dfd4d699c51570e1f1b10c2e37c00f6feb699b9a472ca710ae5242bf249',
    'stage1/validate-sandbox-context.py': '867a0117d6bc200960df06a355ffafcf639f24532ece3bc4db34f6e397325207',
}
ADMISSION_TIMEOUT_BOUNDARY = (
    'Unmodified sandbox-context.read_context uses subprocess.run(timeout=20) '
    'for its existing metadata helper and may kill that helper on timeout. '
    'This exception does not apply to the new EOF child, product or any future worker.'
)


class NativeHandleError(RuntimeError):
    def __init__(self, code, api_error=None):
        super().__init__(code)
        self.code = code
        self.api_error = api_error


def _original_admission():
    reviewed = {}
    for relative, expected in GUARD_PINS.items():
        file = ROOT / relative
        for item in (file, *file.parents):
            info = item.lstat()
            if stat.S_ISLNK(info.st_mode) or getattr(info, 'st_file_attributes', 0) & 0x400 or stat.S_ISREG(info.st_mode) and info.st_nlink != 1:
                raise NativeHandleError('ORIGINAL_GUARD_PATH_REFUSED')
            if item == ROOT:
                break
        before = file.stat()
        body = file.read_bytes()
        after = file.stat()
        if (before.st_dev, before.st_ino, before.st_size, before.st_mtime_ns, before.st_ctime_ns) != (after.st_dev, after.st_ino, after.st_size, after.st_mtime_ns, after.st_ctime_ns) or hashlib.sha256(body).hexdigest() != expected:
            raise NativeHandleError('ORIGINAL_GUARD_SOURCE_CHANGED')
        reviewed[relative] = body
    spec = importlib.util.spec_from_file_location('native_handle_actual_context', ROOT / 'stage1/sandbox-context.py')
    module = importlib.util.module_from_spec(spec)
    exec(compile(reviewed['stage1/sandbox-context.py'], str(ROOT / 'stage1/sandbox-context.py'), 'exec'), module.__dict__)
    return module.read_context(ROOT)


class _NativeAdapter:
    def __init__(self, admission):
        # This import/DLL load happens only after the real unchanged admission.
        import ctypes as C
        from ctypes import wintypes as W
        self._C, self._W = C, W
        self._admission = admission
        self._records, self._registered = {}, {}
        self._failure = None
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
        try:
            for name, (arguments, result) in signatures.items():
                function = getattr(self._api, name)
                function.argtypes, function.restype = arguments, result
        except Exception:
            raise NativeHandleError('REQUIRED_WINAPI_UNAVAILABLE') from None

    @property
    def child_command(self):
        return [str(PYTHON), '-I', '-B', '-X', 'utf8', '-c', EOF_CHILD_SOURCE]

    @property
    def child_program_sha256(self):
        return hashlib.sha256(EOF_CHILD_SOURCE.encode('utf-8')).hexdigest()

    @property
    def admission(self):
        return copy.deepcopy(self._admission)

    @property
    def failure(self):
        return copy.deepcopy(self._failure)

    @property
    def owned_open_count(self):
        return sum(record['owned'] and not record['closed'] for record in self._records.values())

    def _fail(self, code, api_error=None):
        if self._failure is None:
            self._failure = {'code': code, **({'apiError': api_error} if api_error is not None else {})}
        raise NativeHandleError(code, api_error) from None

    def _kernel_status(self, handle):
        C, W, api = self._C, self._W, self._api
        pid = int(api.GetProcessId(handle))
        if not pid:
            self._fail('GET_PROCESS_ID_FAILED', C.get_last_error())
        created, exited, kernel, user = W.FILETIME(), W.FILETIME(), W.FILETIME(), W.FILETIME()
        if not api.GetProcessTimes(handle, C.byref(created), C.byref(exited), C.byref(kernel), C.byref(user)):
            self._fail('GET_PROCESS_TIMES_FAILED', C.get_last_error())
        ticks = (int(created.dwHighDateTime) << 32) | int(created.dwLowDateTime)
        state = int(api.WaitForSingleObject(handle, 0))
        if state not in (0, 258):
            self._fail('WAIT_QUERY_FAILED', C.get_last_error() if state == 0xffffffff else state)
        code = None
        if state == 0:
            exit_code = W.DWORD()
            if not api.GetExitCodeProcess(handle, C.byref(exit_code)):
                self._fail('GET_EXIT_CODE_FAILED', C.get_last_error())
            code = int(exit_code.value)
        return {'pid': pid, 'creationFileTime': str(ticks), 'signaled': state == 0,
                'exitCode': code, 'identitySource': 'held-kernel-process-handle'}

    def _raw(self, handle):
        before = self._kernel_status(handle)
        if before['signaled']:
            self._fail('LIVE_SNAPSHOT_REQUIRES_NONSIGNALED_PROCESS')
        C, W = self._C, self._W
        size = W.DWORD(32768)
        image = C.create_unicode_buffer(size.value)
        if not self._api.QueryFullProcessImageNameW(handle, 0, image, C.byref(size)):
            self._fail('QUERY_IMAGE_FAILED', C.get_last_error())
        if not size.value or size.value >= 32768 or not image.value:
            self._fail('QUERY_IMAGE_INVALID_SIZE')
        after = self._kernel_status(handle)
        if after['signaled']:
            self._fail('PROCESS_EXITED_DURING_LIVE_IMAGE_CAPTURE')
        if (before['pid'], before['creationFileTime']) != (after['pid'], after['creationFileTime']):
            self._fail('KERNEL_IDENTITY_CHANGED_DURING_LIVE_IMAGE_CAPTURE')
        return {**after, 'imagePath': image.value,
                'imagePathProvenance': {'sourceApi': 'QueryFullProcessImageNameW',
                                        'sourceStage': 'fresh-live-image', 'fresh': True,
                                        'nonsignaledBefore': True, 'nonsignaledAfter': True}}

    @staticmethod
    def _identity(value):
        return value['pid'], value['creationFileTime'], os.path.normcase(value['imagePath'])

    def register_popen(self, process):
        if self._failure is not None:
            self._fail('ADAPTER_ALREADY_FAILED')
        if not isinstance(process, subprocess.Popen) or process.args != self.child_command:
            raise ValueError('Only the fixed actually-created EOF Popen child may register')
        if process in self._registered:
            return self._registered[process]
        if type(process.pid) is not int or not 1 <= process.pid <= 0xffffffff:
            raise ValueError('Captured Popen PID required')
        try:
            handle = int(process._handle)
        except Exception:
            self._fail('CAPTURED_POPEN_HANDLE_UNAVAILABLE')
        if not handle:
            self._fail('CAPTURED_POPEN_HANDLE_UNAVAILABLE')
        observed = self._raw(handle)
        if observed['pid'] != process.pid or os.path.normcase(observed['imagePath']) != os.path.normcase(str(PYTHON)):
            self._fail('CAPTURED_POPEN_IDENTITY_MISMATCH')
        token = object()
        self._records[token] = {'process': process, 'handle': handle, 'owned': False,
                                'closed': False, 'identity': self._identity(observed),
                                'capturedLiveImage': self._capture_image(observed, 'borrowed-popen')}
        self._registered[process] = token
        return token

    def open_owned(self, process):
        if process not in self._registered:
            raise ValueError('Popen must be registered before OpenProcess')
        if self._failure is not None:
            self._fail('ADAPTER_ALREADY_FAILED')
        borrowed = self._registered[process]
        expected = self.snapshot(borrowed)
        handle = self._api.OpenProcess(QUERY_SYNCHRONIZE, False, process.pid)
        if not handle:
            self._fail('OPEN_QUERY_SYNCHRONIZE_FAILED', self._C.get_last_error())
        token = object()
        # Account immediately, including validation failures; never lose a handle
        # merely because GetProcessTimes/image matching failed after OpenProcess.
        self._records[token] = {'process': process, 'handle': handle, 'owned': True,
                                'closed': False, 'identity': self._identity(expected),
                                'capturedLiveImage': None}
        self.snapshot(token)
        return token

    def snapshot(self, token):
        record = self._records.get(token)
        if record is None or record['closed']:
            raise ValueError('Known live captured handle required')
        observed = self._raw(record['handle'])
        if self._identity(observed) != record['identity']:
            self._fail('CAPTURED_KERNEL_IDENTITY_CHANGED')
        ownership = 'owned-query-synchronize' if record['owned'] else 'borrowed-popen'
        if record['capturedLiveImage'] is None:
            record['capturedLiveImage'] = self._capture_image(observed, ownership)
        return {**observed, 'handleOwnership': ownership}

    @staticmethod
    def _capture_image(observed, ownership):
        return {'path': observed['imagePath'], 'pid': observed['pid'],
                'creationFileTime': observed['creationFileTime'], 'captureRole': ownership}

    def post_exit_status(self, token):
        record = self._records.get(token)
        if record is None or record['closed']:
            raise ValueError('Known unclosed captured handle required')
        captured = record['capturedLiveImage']
        if captured is None:
            self._fail('POST_STATUS_REQUIRES_CAPTURED_LIVE_IMAGE')
        # No image query, current-PID lookup or new handle here. These are fresh
        # lifecycle facts read only from the already captured held object.
        observed = self._kernel_status(record['handle'])
        if not observed['signaled']:
            self._fail('POST_EXIT_STATUS_REQUIRES_SIGNALED_PROCESS')
        if (observed['pid'], observed['creationFileTime']) != record['identity'][:2]:
            self._fail('CAPTURED_KERNEL_IDENTITY_CHANGED')
        return {**observed, 'handleOwnership': captured['captureRole'],
                'capturedLiveImagePath': captured['path'],
                'capturedLiveImageProvenance': {
                    'sourceApi': 'QueryFullProcessImageNameW', 'sourceStage': 'captured-live-image',
                    'fresh': False, 'capturedPid': captured['pid'],
                    'capturedCreationFileTime': captured['creationFileTime'],
                    'capturedNonsignaledBefore': True, 'capturedNonsignaledAfter': True,
                    'captureRole': captured['captureRole']}}

    def close_owned(self, token):
        record = self._records.get(token)
        if record is None or not record['owned']:
            raise ValueError('Borrowed/unregistered handles are never closed by this adapter')
        if record['closed']:
            return None
        if not self._api.CloseHandle(record['handle']):
            self._fail('OWNED_CLOSE_HANDLE_FAILED', self._C.get_last_error())
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
            raise NativeHandleError('OWNED_HANDLE_CLEANUP_INCOMPLETE') from None


def create_adapter():
    if os.path.normcase(sys.executable) != os.path.normcase(str(PYTHON)) or not sys.flags.isolated or not sys.flags.dont_write_bytecode:
        raise NativeHandleError('FIXED_ISOLATED_PUBLIC_PYTHON_REQUIRED')
    return _NativeAdapter(_original_admission())
