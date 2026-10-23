"""Pure QA observer model. No OS adapter, worker, admission or product import.

All process observations and handle operations are supplied by the caller.
Raw kernel FILETIME integers establish identity; CIM microsecond values are
discovery metadata only. The caller supplies the unchanged conservative proof.
The root handle is borrowed from an already captured launch object. Handles
opened here are retained until close; temporary comparison handles are closed
after the comparison. No termination operation exists in this interface.

This model passing tests cannot qualify a Windows API adapter, actual Guest,
UI run, runtime version or deployment. Actual acquisition and final close
evidence require independent review and execution.
"""

import copy
from datetime import datetime, timedelta
import re


_QUERY_SYNCHRONIZE = 0x00101000
_EPOCH = datetime(1601, 1, 1)
_DECIMAL = re.compile(r'^(?:0|[1-9][0-9]{0,19})$')
_CIM_DISPLAY = re.compile(r'^[0-9]{4}-[0-9]{2}-[0-9]{2}T[0-9]{2}:[0-9]{2}:[0-9]{2}\.[0-9]{6}0Z$')
_CIM_DMTF = re.compile(r'^[0-9]{14}\.[0-9]{6}[+-][0-9]{3}$')


def _pid(value, *, zero=False):
    if type(value) is not int or not (0 if zero else 1) <= value <= 0xffffffff:
        raise RuntimeError('Malformed process identifier')
    return value


def _canonical(ticks):
    if not isinstance(ticks, str) or not _DECIMAL.fullmatch(ticks):
        raise RuntimeError('Raw decimal kernel FILETIME required')
    integer = int(ticks)
    if integer > 0xffffffffffffffff:
        raise RuntimeError('Kernel FILETIME outside uint64')
    seconds, fraction = divmod(integer, 10_000_000)
    instant = _EPOCH + timedelta(seconds=seconds)
    return (f'{instant.year:04}-{instant.month:02}-{instant.day:02}T'
            f'{instant.hour:02}:{instant.minute:02}:{instant.second:02}.{fraction:07}Z')


def _image_key(value):
    if not isinstance(value, str) or not value or len(value) > 32768 or '\x00' in value:
        raise RuntimeError('Kernel image path required')
    return value.replace('/', '\\').casefold()


def _cim_metadata(row):
    """Validate the supplied DMTF source without inventing a seventh digit."""
    raw, display = row.get('CimCreationRaw'), row.get('CreationUtc')
    if row.get('CimPrecision') != 'microsecond':
        raise RuntimeError('Explicit CIM microsecond source required')
    if not isinstance(raw, str) or not _CIM_DMTF.fullmatch(raw):
        raise RuntimeError('Complete DMTF microsecond source required')
    if not isinstance(display, str) or not _CIM_DISPLAY.fullmatch(display):
        raise RuntimeError('CIM display must retain its actual microsecond precision')
    instant = datetime(int(raw[0:4]), int(raw[4:6]), int(raw[6:8]),
                       int(raw[8:10]), int(raw[10:12]), int(raw[12:14]), int(raw[15:21]))
    offset = int(raw[22:25]) * (1 if raw[21] == '+' else -1)
    utc = instant - timedelta(minutes=offset)
    expected = (f'{utc.year:04}-{utc.month:02}-{utc.day:02}T'
                f'{utc.hour:02}:{utc.minute:02}:{utc.second:02}.{utc.microsecond:06}0Z')
    if display != expected:
        raise RuntimeError('CIM source and display disagree')
    elapsed = utc - _EPOCH
    microseconds = (elapsed.days * 86400 + elapsed.seconds) * 1_000_000 + elapsed.microseconds
    return ({'CimCreationRaw': raw, 'CimCreationDisplay': display,
             'CimPrecision': 'microsecond'}, microseconds)


class _Observer:
    def __init__(self, *, kernel, read_snapshot, proof_update, root, root_handle,
                 max_owned=64):
        self._kernel = kernel
        self._read_snapshot = read_snapshot
        self._proof = proof_update
        self._failure = None
        self._closed = False
        self._history = []
        self._held = {}
        self._opened = {}
        self._last_sequence = 0
        if type(max_owned) is not int or not 1 <= max_owned <= 4096:
            self._refuse('INVALID_OWNERSHIP_BUDGET')
        self._max_owned = max_owned
        try:
            if not callable(read_snapshot) or not callable(proof_update):
                self._refuse('INVALID_OBSERVER_ADAPTER')
            if not isinstance(root, dict):
                self._refuse('INVALID_ROOT_METADATA')
            pid = _pid(root.get('ProcessId'))
            _pid(root.get('ParentProcessId'), zero=True)
            if pid == root['ParentProcessId']:
                self._refuse('INVALID_ROOT_METADATA', pid=pid)
            identity = self._query(root_handle, pid)
            pinned = self._safe_row(root, identity)
            self._proof([pinned], [pinned])
            self._history = [pinned]
            self._held[pid] = root_handle
        except Exception:
            if self._failure is not None:
                raise
            self._refuse('ROOT_IDENTITY_PIN_FAILED')

    @property
    def history(self):
        return copy.deepcopy(self._history)

    @property
    def failure(self):
        return copy.deepcopy(self._failure)

    def _refuse(self, code, **fields):
        if self._failure is None:
            self._failure = {'code': code}
            # Only caller-independent safe tuples are passed here. Raw rows,
            # exceptions, command lines, environments and handles stay private.
            self._failure.update(fields)
        raise RuntimeError('QA ownership observation refused: ' + self._failure['code']) from None

    def _query(self, handle, expected_pid):
        value = self._kernel.query_handle(handle)
        if not isinstance(value, dict):
            self._refuse('INVALID_KERNEL_IDENTITY', pid=expected_pid)
        pid = _pid(value.get('pid'))
        if pid != expected_pid:
            self._refuse('KERNEL_HANDLE_PID_MISMATCH', pid=expected_pid)
        creation = value.get('creationFileTime')
        canonical = _canonical(creation)
        _image_key(value.get('imagePath'))
        if type(value.get('signaled')) is not bool:
            self._refuse('INVALID_KERNEL_SIGNAL_STATE', pid=pid)
        return {'pid': pid, 'creationFileTime': creation,
                'imagePath': value['imagePath'], 'signaled': value['signaled'],
                'canonical': canonical}

    def _safe_row(self, source, identity):
        pid = _pid(source.get('ProcessId'))
        parent = _pid(source.get('ParentProcessId'), zero=True)
        if pid != identity['pid'] or pid == parent:
            self._refuse('INVALID_CIM_PARENT_BINDING', pid=pid)
        metadata, cim_microseconds = _cim_metadata(source)
        # Source consistency only: never use this projection as identity.
        # Known identities still compare the complete raw FILETIME below.
        if int(identity['creationFileTime']) // 10 != cim_microseconds:
            self._refuse('CIM_KERNEL_CREATION_SOURCE_MISMATCH', pid=pid)
        if _image_key(source.get('ExecutablePath')) != _image_key(identity['imagePath']):
            self._refuse('CIM_KERNEL_IMAGE_MISMATCH', pid=pid)
        # Explicit allowlist: raw CommandLine/environment never enter public
        # history, alive views or structured failure evidence.
        return {'ProcessId': pid, 'ParentProcessId': parent,
                'Name': identity['imagePath'].replace('/', '\\').rsplit('\\', 1)[-1],
                'ExecutablePath': identity['imagePath'],
                'CreationUtc': identity['canonical'],
                'KernelCreationFileTime': identity['creationFileTime'],
                'IdentitySource': 'kernel-process-handle', **metadata}

    def _frame(self):
        frame = self._read_snapshot()
        if not isinstance(frame, dict) or set(frame) != {'sequence', 'processes'}:
            self._refuse('INVALID_INVENTORY_FRAME')
        sequence, rows = frame['sequence'], frame['processes']
        if type(sequence) is not int or not self._last_sequence < sequence <= 0xffffffffffffffff:
            self._refuse('INVENTORY_SEQUENCE_NOT_FRESH')
        if not isinstance(rows, list) or len(rows) > 65536:
            self._refuse('INVALID_INVENTORY_ROWS')
        indexed = {}
        for value in rows:
            if not isinstance(value, dict):
                self._refuse('INVALID_INVENTORY_ROW')
            pid = _pid(value.get('ProcessId'), zero=True)
            parent = _pid(value.get('ParentProcessId'), zero=True)
            if pid in indexed or pid == parent and pid != 0 or pid == 0 and parent != 0:
                self._refuse('AMBIGUOUS_INVENTORY_PID', pid=pid)
            indexed[pid] = value
        self._last_sequence = sequence
        return indexed

    def _open(self, pid):
        handle = self._kernel.open_process(pid, _QUERY_SYNCHRONIZE)
        if handle in self._opened or handle in self._held.values():
            self._refuse('ADAPTER_REUSED_RETAINED_HANDLE', pid=pid)
        self._opened[handle] = pid
        return handle

    def _close_one(self, handle):
        # A failed close remains accounted and is retried by final close(); it
        # is never removed from the retained set merely because close started.
        self._kernel.close_handle(handle)
        del self._opened[handle]

    def _current_identity(self, pid):
        handle = self._open(pid)
        try:
            return self._query(handle, pid)
        finally:
            self._close_one(handle)

    def _match_kernel(self, known, observed, current_parent):
        pid = known['ProcessId']
        if (known['KernelCreationFileTime'] != observed['creationFileTime'] or
                _image_key(known['ExecutablePath']) != _image_key(observed['imagePath'])):
            self._refuse('OWNED_PROCESS_IDENTITY_MISMATCH', pid=pid,
                         knownCreationFileTime=known['KernelCreationFileTime'],
                         observedCreationFileTime=observed['creationFileTime'],
                         knownParentPid=known['ParentProcessId'],
                         observedParentPid=current_parent)

    def _verify_known(self, current):
        view = []
        for known in self._history:
            pid = known['ProcessId']
            held = self._query(self._held[pid], pid)
            source = current.get(pid)
            parent = source['ParentProcessId'] if source is not None else known['ParentProcessId']
            self._match_kernel(known, held, parent)
            if source is None:
                if not held['signaled']:
                    self._refuse('LIVE_OWNED_PROCESS_MISSING_FROM_INVENTORY', pid=pid)
                continue
            observed = self._current_identity(pid)
            self._match_kernel(known, observed, parent)
            safe = self._safe_row(source, observed)
            if parent != known['ParentProcessId']:
                self._refuse('OWNED_PARENT_CHANGED', pid=pid,
                             knownParentPid=known['ParentProcessId'], observedParentPid=parent)
            if (safe['CimCreationRaw'] != known['CimCreationRaw'] or
                    safe['CimCreationDisplay'] != known['CimCreationDisplay']):
                self._refuse('OWNED_CIM_METADATA_CHANGED', pid=pid)
            view.append(safe)
        return view

    def sample(self):
        if self._closed:
            self._refuse('OBSERVER_ALREADY_CLOSED')
        if self._failure is not None:
            self._refuse(self._failure['code'])
        try:
            current = self._frame()
            view = self._verify_known(current)
            while True:
                owned = {value['ProcessId'] for value in self._history}
                candidate = next((value for pid, value in current.items()
                                  if pid not in owned and value['ParentProcessId'] in owned), None)
                if candidate is None:
                    self._history, alive = self._proof(self._history, view)
                    return copy.deepcopy(alive)
                if len(self._history) >= self._max_owned:
                    self._refuse('OWNERSHIP_HISTORY_BUDGET_EXHAUSTED')
                pid = candidate['ProcessId']
                handle = self._open(pid)
                identity = self._query(handle, pid)
                pinned = self._safe_row(candidate, identity)
                # Discovery is not admission: after pinning, obtain a genuinely
                # newer inventory and bind the same metadata/parent again.
                fresh = self._frame()
                rebound = fresh.get(pid)
                if rebound is None:
                    self._refuse('CANDIDATE_DISAPPEARED_DURING_PIN', pid=pid)
                current_identity = self._current_identity(pid)
                checked = self._safe_row(rebound, current_identity)
                self._match_kernel(pinned, self._query(handle, pid), rebound['ParentProcessId'])
                self._match_kernel(pinned, current_identity, rebound['ParentProcessId'])
                if checked != pinned:
                    self._refuse('CANDIDATE_PARENT_OR_METADATA_CHANGED_DURING_PIN', pid=pid)
                view = self._verify_known(fresh)
                expanded, _ = self._proof(self._history, view + [checked])
                # The real proof sees only already-pinned rows, so it cannot
                # silently admit an unpinned descendant from the full CIM list.
                if {value['ProcessId'] for value in expanded} != owned | {pid}:
                    self._refuse('UNEXPECTED_PROOF_EXPANSION', pid=pid)
                self._held[pid] = handle
                self._history = expanded
                view.append(checked)
                current = fresh
        except Exception:
            if self._failure is not None:
                raise
            self._refuse('OBSERVER_ADAPTER_OR_PROOF_FAILED')

    def close(self):
        if self._closed:
            return None
        failed = False
        for handle in list(self._opened):
            try:
                self._close_one(handle)
            except Exception:
                failed = True
        if failed:
            if self._failure is None:
                self._failure = {'code': 'OBSERVER_HANDLE_CLOSE_FAILED'}
            else:
                self._failure['cleanupFailed'] = True
            raise RuntimeError('QA observer handle cleanup failed') from None
        self._closed = True
        return None


def create_observer(*, kernel, read_snapshot, proof_update, root, root_handle, max_owned=64):
    return _Observer(kernel=kernel, read_snapshot=read_snapshot, proof_update=proof_update,
                     root=root, root_handle=root_handle, max_owned=max_owned)


def finish_result(*, previous, probe_exit_code, scoped_probe, normal_stop):
    """Attach caller-captured evidence; never erase a prior FAIL or infer exit0.

    Inputs must already be separately authenticated/redacted QA evidence. This
    pure reducer has no process lookup, handle validation or admission power.
    An existing PASS is retained only when every supplied completion fact is
    explicit; it cannot manufacture a PASS from missing/failed observations.
    """
    if not isinstance(previous, dict):
        raise RuntimeError('Previous QA result required')
    if probe_exit_code is not None and type(probe_exit_code) is not int:
        raise RuntimeError('Captured integer probe exit code or unknown required')
    result = copy.deepcopy(previous)
    result['probeExitCode'] = probe_exit_code
    result['scopedProbe'] = copy.deepcopy(scoped_probe)
    result['normalStop'] = copy.deepcopy(normal_stop)
    completed = (previous.get('status') == 'PASS' and previous.get('passed') is True and
                 not previous.get('error') and previous.get('ownershipObservationComplete') is True and
                 probe_exit_code == 0 and isinstance(scoped_probe, dict) and
                 scoped_probe.get('passed') is True and isinstance(normal_stop, dict) and
                 normal_stop.get('passed') is True)
    if not completed:
        result['status'] = 'FAIL'
        result['passed'] = False
        if not result.get('error'):
            result['error'] = 'QA completion evidence failed or incomplete'
    return result
