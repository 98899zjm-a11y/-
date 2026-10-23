"""Pure GUI late-root derivative of frozen4c6; no OS/native/product imports.

Only register_root and its role/reservation accounting extend the old API.
Failed registrations retain staged borrowed tokens and reserved slots; closing
the observer never closes those captures. Registration transition evidence is
carried into the next successful sample, using the existing result field.

The caller injects typed retained-handle observations and fresh discovery.
Only live observations contain fresh imagePath. Held-exit keeps full kernel
identity and explicit captured-live provenance; it never triggers PID lookup.
Unknown descendants require a retained live parent before/after pin. An exited
historical parent is useful only for already proved descendants, never as an
authorization to claim a newly seen process by its recycled ParentPID.

History, failed closes and pin attempts stay accounted until actual close.
This pure state machine cannot prove WinAPI/Popen/Guest/UI qualification.
"""

import copy
from datetime import datetime, timedelta
import re


_EPOCH = datetime(1601, 1, 1)
_DECIMAL = re.compile(r'^(?:0|[1-9][0-9]{0,19})$')
_DMTF = re.compile(r'^[0-9]{14}\.[0-9]{6}[+-][0-9]{3}$')
_LIVE_PROVENANCE = {'sourceApi': 'QueryFullProcessImageNameW', 'sourceStage': 'fresh-live-image',
                    'fresh': True, 'nonsignaledBefore': True, 'nonsignaledAfter': True}
_SOURCE_KEYS = ('processId', 'parentProcessId', 'wmiExecutablePath', 'cimCreationDmtfRaw', 'cimCreationValueType')


def _pid(value, zero=False):
    if type(value) is not int or not (0 if zero else 1) <= value <= 0xffffffff:
        raise RuntimeError('Invalid process identifier')
    return value


def _ticks(value):
    if not isinstance(value, str) or not _DECIMAL.fullmatch(value) or int(value) > 0xffffffffffffffff:
        raise RuntimeError('Exact uint64 kernel FILETIME string required')
    return int(value)


def _canonical(value):
    seconds, fraction = divmod(_ticks(value), 10_000_000)
    instant = _EPOCH + timedelta(seconds=seconds)
    return (f'{instant.year:04}-{instant.month:02}-{instant.day:02}T{instant.hour:02}:'
            f'{instant.minute:02}:{instant.second:02}.{fraction:07}Z')


def _image(value):
    if not isinstance(value, str) or not value or len(value) > 32768 or '\x00' in value:
        raise RuntimeError('Nonempty bounded image path required')
    return value.replace('/', '\\').casefold()


def _source(row):
    pid, parent = _pid(row.get('processId')), _pid(row.get('parentProcessId'), True)
    if pid == parent or row.get('cimCreationValueType') != 'System.String':
        raise RuntimeError('Complete process source required')
    raw = row.get('cimCreationDmtfRaw')
    if not isinstance(raw, str) or not _DMTF.fullmatch(raw):
        raise RuntimeError('Raw DMTF microsecond source required')
    instant = datetime(int(raw[:4]), int(raw[4:6]), int(raw[6:8]), int(raw[8:10]),
                       int(raw[10:12]), int(raw[12:14]), int(raw[15:21]))
    offset = int(raw[22:25]) * (1 if raw[21] == '+' else -1)
    delta = instant - timedelta(minutes=offset) - _EPOCH
    micros = (delta.days * 86400 + delta.seconds) * 1_000_000 + delta.microseconds
    path = _image(row.get('wmiExecutablePath'))
    return {'pid': pid, 'parent': parent, 'raw': raw, 'microseconds': micros, 'image': path}


class _ObserverV2:
    def __init__(self, *, kernel, read_frame, proof_update, roots, max_history=64):
        self._kernel, self._read_frame, self._proof = kernel, read_frame, proof_update
        self._records, self._owned, self._tokens = {}, [], []
        self._root_roles, self._staged_roots = set(), []
        self._root_reservations = 0
        self._registration_transitions = []
        self._failure = None
        self._last_sequence = 0
        self._closed = self._sampling = False
        self._max_history = max_history
        try:
            if type(max_history) is not int or not 1 <= max_history <= 64:
                self._refuse('INVALID_GLOBAL_HISTORY_BUDGET')
            if not callable(read_frame) or not callable(proof_update) or not all(
                    callable(getattr(kernel, name, None)) for name in ('inspect_held', 'open_candidate', 'close_owned')):
                self._refuse('INVALID_PURE_OBSERVER_PORT')
            if not isinstance(roots, list) or not roots or len(roots) > max_history:
                self._refuse('ROOT_HISTORY_BUDGET_EXHAUSTED')
            roles = self._root_roles
            for root in roots:
                if not isinstance(root, dict) or set(root) != {'role', 'token', 'row'}:
                    self._refuse('INVALID_ROOT_SOURCE')
                role = root['role']
                if not isinstance(role, str) or not re.fullmatch(r'[a-z][a-z0-9-]{0,39}', role) or role in roles:
                    self._refuse('INVALID_ROOT_ROLE')
                roles.add(role)
                source = _source(root['row'])
                pid = source['pid']
                if pid in self._records:
                    self._refuse('CROSS_ROOT_PID_COLLISION', pid=pid)
                self._retain_token(root['token'])
                value = self._inspect(root['token'], pid, 'borrowed')
                if value['kind'] != 'live':
                    self._refuse('ROOT_NOT_LIVE_WHEN_PINNED', pid=pid)
                history = self._pin_row(source, value)
                self._records[pid] = self._record(history, source, value, root['token'], pid, True)
            self._check_proof({pid: self._records[pid]['last'] for pid in self._records})
        except Exception:
            if self._failure is None:
                self._refuse('ROOT_IDENTITY_PIN_FAILED')
            self._raise_failure()

    @property
    def history(self):
        return copy.deepcopy([value['history'] for value in self._records.values()])

    @property
    def failure(self):
        return copy.deepcopy(self._failure)

    def _raise_failure(self):
        raise RuntimeError('Pure QA observer-v2 refused: ' + self._failure['code']) from None

    def _refuse(self, code, **safe):
        if self._failure is None:
            self._failure = {'code': code, **safe}
        self._raise_failure()

    def _retain_token(self, token):
        if any(token is prior or token == prior for prior in self._tokens):
            self._refuse('PORT_REUSED_RETAINED_TOKEN')
        self._tokens.append(token)

    def _inspect(self, token, pid, ownership, known_creation=None):
        value = self._kernel.inspect_held(token)
        if pid is None and isinstance(value, dict):
            pid = _pid(value.get('pid'))  # A newly captured root has no caller-supplied PID.
        if not isinstance(value, dict) or _pid(value.get('pid')) != pid:
            self._refuse('HELD_TOKEN_PID_MISMATCH', pid=pid)
        creation = value.get('creationFileTime')
        _canonical(creation)
        if known_creation is not None and creation != known_creation:
            self._refuse('OWNED_PROCESS_IDENTITY_MISMATCH', pid=pid,
                         knownCreationFileTime=known_creation, observedCreationFileTime=creation)
        if value.get('identitySource') != 'held-kernel-process-handle' or value.get('handleOwnership') != ownership:
            self._refuse('HELD_TOKEN_SOURCE_MISMATCH', pid=pid)
        if type(value.get('signaled')) is not bool:
            self._refuse('INVALID_HELD_SIGNAL_STATE', pid=pid)
        status = {'pid': pid, 'creationFileTime': creation, 'signaled': value['signaled'],
                  'exitCode': value.get('exitCode'), 'identitySource': 'held-kernel-process-handle',
                  'handleOwnership': ownership, 'kind': value.get('kind')}
        if value.get('kind') == 'live':
            if value['signaled'] or value.get('exitCode') is not None:
                self._refuse('INVALID_LIVE_SIGNAL_STATE', pid=pid)
            _image(value.get('imagePath'))
            provenance = value.get('imagePathProvenance')
            if not isinstance(provenance, dict) or provenance != _LIVE_PROVENANCE or not all(
                    type(provenance.get(key)) is bool for key in ('fresh', 'nonsignaledBefore', 'nonsignaledAfter')):
                self._refuse('INVALID_LIVE_IMAGE_PROVENANCE', pid=pid)
            status.update(imagePath=value['imagePath'], imagePathProvenance=copy.deepcopy(provenance))
        elif value.get('kind') == 'held-exit':
            if not value['signaled'] or type(value.get('exitCode')) is not int or not 0 <= value['exitCode'] <= 0xffffffff or 'imagePath' in value:
                self._refuse('INVALID_HELD_EXIT_STATE', pid=pid)
            _image(value.get('capturedLiveImagePath'))
            provenance = value.get('capturedLiveImageProvenance')
            expected = {'sourceApi': 'QueryFullProcessImageNameW', 'sourceStage': 'captured-live-image',
                        'fresh': False, 'capturedPid': pid, 'capturedCreationFileTime': creation,
                        'capturedNonsignaledBefore': True, 'capturedNonsignaledAfter': True, 'captureRole': ownership}
            if not isinstance(provenance, dict) or provenance != expected or type(provenance.get('capturedPid')) is not int or not all(type(provenance.get(key)) is bool
                    for key in ('fresh', 'capturedNonsignaledBefore', 'capturedNonsignaledAfter')):
                self._refuse('INVALID_CAPTURED_LIVE_PROVENANCE', pid=pid)
            status.update(capturedLiveImagePath=value['capturedLiveImagePath'],
                          capturedLiveImageProvenance=copy.deepcopy(provenance))
        else:
            self._refuse('UNKNOWN_HELD_OBSERVATION_KIND', pid=pid)
        return status

    def _pin_row(self, source, value):
        pid = source['pid']
        if value['pid'] != pid or value['kind'] != 'live':
            self._refuse('CANDIDATE_NOT_LIVE_WHEN_PINNED', pid=pid)
        if _ticks(value['creationFileTime']) // 10 != source['microseconds']:
            self._refuse('CIM_KERNEL_SOURCE_PROJECTION_MISMATCH', pid=pid)
        if source['image'] != _image(value['imagePath']):
            self._refuse('CIM_KERNEL_IMAGE_MISMATCH', pid=pid)
        return {'ProcessId': pid, 'ParentProcessId': source['parent'], 'CreationUtc': _canonical(value['creationFileTime']),
                'KernelCreationFileTime': value['creationFileTime'], 'IdentitySource': 'kernel-process-handle',
                'CimCreationRaw': source['raw'], 'CimPrecision': 'microsecond'}

    def _record(self, history, source, value, token, forest, borrowed):
        return {'history': history, 'source': source, 'token': token, 'forest': forest, 'borrowed': borrowed,
                'image': _image(value['imagePath']), 'ended': False, 'exitCode': None,
                'exitSequence': None, 'exitVerified': False, 'last': value}

    def _known(self, record):
        history = record['history']
        pid = history['ProcessId']
        value = self._inspect(record['token'], pid, 'borrowed' if record['borrowed'] else 'owned-query-synchronize',
                              history['KernelCreationFileTime'])
        if value['kind'] == 'live':
            if record['ended'] or _image(value['imagePath']) != record['image']:
                self._refuse('OWNED_PROCESS_STATE_OR_IMAGE_CHANGED', pid=pid)
        else:
            if _image(value['capturedLiveImagePath']) != record['image']:
                self._refuse('CAPTURED_LIVE_IMAGE_CHANGED', pid=pid)
            if record['ended'] and record['exitCode'] != value['exitCode']:
                self._refuse('HELD_EXIT_CODE_CHANGED', pid=pid)
            if not record['ended']:
                record['ended'], record['exitCode'] = True, value['exitCode']
                record['exitSequence'] = self._last_sequence
        record['last'] = value
        return value

    def _frame(self, pending):
        frame = self._read_frame()
        if not isinstance(frame, dict) or set(frame) != {'sequence', 'processes'}:
            self._refuse('INVALID_INVENTORY_FRAME')
        sequence = frame['sequence']
        if type(sequence) is not int or sequence != self._last_sequence + 1 or sequence > 0xffffffffffffffff:
            self._refuse('INVENTORY_SEQUENCE_NOT_CONTIGUOUS')
        rows = frame['processes']
        if not isinstance(rows, list) or len(rows) > 65536:
            self._refuse('INVALID_INVENTORY_ROWS')
        indexed = {}
        for row in rows:
            if not isinstance(row, dict):
                self._refuse('INVALID_INVENTORY_ROW')
            pid, parent = _pid(row.get('processId'), True), _pid(row.get('parentProcessId'), True)
            if pid in indexed or pid == parent and pid != 0 or pid == 0 and parent != 0:
                self._refuse('AMBIGUOUS_INVENTORY_PID', pid=pid)
            indexed[pid] = row
        self._last_sequence = sequence
        self._discover(indexed, pending)
        return indexed

    def _discover(self, current, pending):
        # Preserve every observed, root-reachable candidate across refinement
        # frames. Disappearing before pin is a refusal, not an ignored short row.
        reachable = set(self._records)
        staged = {value['pid'] for value in self._staged_roots if 'pid' in value}
        while True:
            added = []
            for pid, row in current.items():
                parent = row['parentProcessId']
                if parent in staged:
                    self._refuse('ROOT_DESCENDANT_BEFORE_GATE_ADMISSION', pid=pid, parentPid=parent)
                if pid in staged:
                    continue  # Retained borrowed root, validated by its registration transaction.
                if pid in reachable or parent not in reachable:
                    continue
                if parent in self._records and self._records[parent]['ended']:
                    self._refuse('UNPROVEN_DESCENDANT_OF_EXITED_PARENT', pid=pid, parentPid=parent)
                source = _source(row)
                if pid not in pending:
                    if len(self._records) + len(pending) + self._root_reservations >= self._max_history:
                        self._refuse('GLOBAL_HISTORY_BUDGET_EXHAUSTED')
                    pending[pid] = {'source': source, 'row': {key: copy.deepcopy(row.get(key)) for key in _SOURCE_KEYS},
                                    'sequence': self._last_sequence}
                elif source != pending[pid]['source']:
                    self._refuse('CANDIDATE_METADATA_CHANGED', pid=pid)
                added.append(pid)
            if not added:
                return
            reachable.update(added)

    def _stabilize(self, current, pending, transitions):
        while True:
            need_fresh = False
            live = {}
            for pid, record in self._records.items():
                value = self._known(record)
                row = current.get(pid)
                if value['kind'] == 'live':
                    if row is None:
                        self._refuse('LIVE_OWNED_PROCESS_MISSING', pid=pid)
                    source = _source(row)
                    self._pin_row(source, value)
                    if source != record['source']:
                        self._refuse('OWNED_SOURCE_OR_PARENT_CHANGED', pid=pid)
                    live[pid] = value
                    continue
                if not record['exitVerified'] and self._last_sequence <= record['exitSequence']:
                    if row is not None:
                        record['transitionFrom'] = self._last_sequence
                    need_fresh = True
                    continue
                if row is not None:
                    self._refuse('EXITED_PID_STILL_ENUMERATED_UNRESOLVED', pid=pid)
                if not record['exitVerified']:
                    record['exitVerified'] = True
                    if 'transitionFrom' in record:
                        transitions.append({'kind': 'live-to-held-exit', 'pid': pid,
                                            'creationFileTime': record['history']['KernelCreationFileTime'],
                                            'fromSequence': record.pop('transitionFrom'), 'toSequence': self._last_sequence})
            if not need_fresh:
                return current, live
            current = self._frame(pending)

    def _check_proof(self, live, candidate=None):
        roots = [pid for pid, record in self._records.items() if record['forest'] == pid]
        if candidate is not None and candidate['forest'] not in roots:
            roots.append(candidate['forest'])
        for root in roots:
            records = [value for value in self._records.values() if value['forest'] == root]
            known = [copy.deepcopy(value['history']) for value in records]
            rows = [copy.deepcopy(value['history']) for value in records if value['history']['ProcessId'] in live]
            expected = {value['ProcessId']: value for value in known}
            if candidate is not None and candidate['forest'] == root:
                if not known:
                    known.append(copy.deepcopy(candidate['history']))  # New already-held root seeds its own forest.
                rows.append(copy.deepcopy(candidate['history']))
                expected[candidate['history']['ProcessId']] = candidate['history']
            expanded, alive = self._proof(known, rows)
            if not isinstance(expanded, list) or not isinstance(alive, list) or len(expanded) != len(expected) or {
                    value.get('ProcessId') for value in expanded} != set(expected):
                self._refuse('UNEXPECTED_PROOF_EXPANSION')
            for value in expanded:
                wanted = expected[value['ProcessId']]
                if any(value.get(key) != wanted[key] for key in ('ParentProcessId', 'CreationUtc', 'KernelCreationFileTime')):
                    self._refuse('PROOF_IDENTITY_CHANGED', pid=value['ProcessId'])
            if len(alive) != len(rows) or {value.get('ProcessId') for value in alive} != {value['ProcessId'] for value in rows}:
                self._refuse('PROOF_LIVE_VIEW_CHANGED')

    def _pin(self, pid, current, live, pending, transitions):
        item = pending[pid]
        parent = self._records[item['source']['parent']]
        if len(self._records) + self._root_reservations >= self._max_history:
            self._refuse('GLOBAL_HISTORY_BUDGET_EXHAUSTED')
        before = self._known(parent)
        if before['kind'] != 'live':
            self._refuse('UNPROVEN_DESCENDANT_OF_EXITED_PARENT', pid=pid, parentPid=before['pid'])
        if pid not in current or _source(current[pid]) != item['source']:
            self._refuse('CANDIDATE_DISAPPEARED_OR_CHANGED', pid=pid)
        token = self._kernel.open_candidate(parent['token'], copy.deepcopy(item['row']), self._last_sequence)
        self._retain_token(token)
        owned = {'token': token, 'pid': pid, 'closed': False}
        self._owned.append(owned)  # Account before any subsequent query/validation.
        value = self._inspect(token, pid, 'owned-query-synchronize')
        history = self._pin_row(item['source'], value)
        if _ticks(history['KernelCreationFileTime']) < _ticks(parent['history']['KernelCreationFileTime']):
            self._refuse('CHILD_CREATION_BEFORE_PINNED_PARENT', pid=pid, parentPid=before['pid'])
        current = self._frame(pending)
        current, live = self._stabilize(current, pending, transitions)
        if pid not in current or _source(current[pid]) != item['source']:
            self._refuse('CANDIDATE_DISAPPEARED_OR_CHANGED', pid=pid)
        after = self._inspect(token, pid, 'owned-query-synchronize', history['KernelCreationFileTime'])
        checked = self._pin_row(_source(current[pid]), after)
        if checked != history:
            self._refuse('CANDIDATE_KERNEL_IDENTITY_CHANGED', pid=pid)
        parent_after = self._known(parent)
        if parent_after['kind'] != 'live':
            self._refuse('PARENT_EXITED_DURING_CANDIDATE_PIN', pid=pid, parentPid=before['pid'])
        parent_row = current.get(before['pid'])
        if parent_row is None or _source(parent_row) != parent['source']:
            self._refuse('PARENT_REBIND_FAILED_DURING_PIN', pid=pid, parentPid=before['pid'])
        live[before['pid']] = parent_after
        candidate = self._record(history, item['source'], after, token, parent['forest'], False)
        self._check_proof(live, candidate)
        self._records[pid] = candidate
        del pending[pid]
        live[pid] = after
        return current, live

    def register_root(self, *, role, capture_root):
        """Admit one gated borrowed root; failure retains its reservation/token.

        capture_root is trusted DI acquisition, called only after preflight.
        Until the receipt commits, the new root must remain at its ready gate
        without descendants. Existing forests still consume every full frame.
        """
        if self._failure is not None:
            self._raise_failure()
        if self._closed or self._sampling:
            self._refuse('OBSERVER_CLOSED_OR_REENTRANT')
        if not isinstance(role, str) or not re.fullmatch(r'[a-z][a-z0-9-]{0,39}', role) or role in self._root_roles:
            self._refuse('INVALID_ROOT_ROLE')
        if not callable(capture_root):
            self._refuse('INVALID_ROOT_CAPTURE')
        if len(self._records) + self._root_reservations >= self._max_history:
            self._refuse('ROOT_HISTORY_BUDGET_EXHAUSTED')
        self._sampling = True
        stage = {'role': role, 'token': None, 'reservationHeld': True}
        self._staged_roots.append(stage)
        self._root_reservations += 1
        try:
            token = capture_root()
            stage['token'] = token  # Retain before equality/query/source/proof can fail.
            if self._failure is not None:
                self._raise_failure()
            self._retain_token(token)
            before = self._inspect(token, None, 'borrowed')
            pid, creation = before['pid'], before['creationFileTime']
            stage['pid'] = pid
            if pid in self._records:
                self._refuse('CROSS_ROOT_PID_COLLISION', pid=pid)
            if before['kind'] != 'live':
                self._refuse('ROOT_NOT_LIVE_WHEN_PINNED', pid=pid)
            pending, transitions = {}, self._registration_transitions
            current = self._frame(pending)
            if pid not in current:
                self._refuse('ROOT_SOURCE_MISSING', pid=pid)
            source = _source(current[pid])
            history = self._pin_row(source, before)
            current, live = self._stabilize(current, pending, transitions)
            while pending:
                child = next((item for item, value in pending.items() if value['source']['parent'] in self._records), None)
                if child is None:
                    self._refuse('UNPROVEN_DESCENDANT_CHAIN')
                current, live = self._pin(child, current, live, pending, transitions)
            if pid not in current or _source(current[pid]) != source:
                self._refuse('ROOT_SOURCE_CHANGED_DURING_REGISTRATION', pid=pid)
            after = self._inspect(token, pid, 'borrowed', creation)
            if self._pin_row(_source(current[pid]), after) != history:
                self._refuse('ROOT_IDENTITY_CHANGED_DURING_REGISTRATION', pid=pid)
            candidate = self._record(history, source, after, token, pid, True)
            self._check_proof(live, candidate)
            if self._failure is not None:
                self._raise_failure()
            self._records[pid] = candidate
            self._root_roles.add(role)
            self._staged_roots.remove(stage)
            self._root_reservations -= 1  # Only a committed history record takes over the slot.
            return {'role': role, 'pid': pid, 'creationFileTime': creation, 'sequence': self._last_sequence}
        except BaseException:
            if self._failure is None:
                self._failure = {'code': 'ROOT_REGISTRATION_FAILED'}
            self._raise_failure()
        finally:
            self._sampling = False

    def sample(self):
        if self._failure is not None:
            self._raise_failure()
        if self._closed or self._sampling:
            self._refuse('OBSERVER_CLOSED_OR_REENTRANT')
        self._sampling = True
        try:
            pending, transitions = {}, copy.deepcopy(self._registration_transitions)
            current = self._frame(pending)
            current, live = self._stabilize(current, pending, transitions)
            while pending:
                pid = next((pid for pid, item in pending.items() if item['source']['parent'] in self._records), None)
                if pid is None:
                    self._refuse('UNPROVEN_DESCENDANT_CHAIN')
                current, live = self._pin(pid, current, live, pending, transitions)
            self._check_proof(live)
            self._registration_transitions.clear()
            return {'sequence': self._last_sequence, 'verifiedLive': copy.deepcopy([live[pid] for pid in self._records if pid in live]),
                    'history': self.history, 'failure': None, 'transitionObservations': copy.deepcopy(transitions)}
        except Exception:
            if self._failure is None:
                self._refuse('OBSERVER_PORT_OR_PROOF_FAILED')
            self._raise_failure()
        finally:
            self._sampling = False

    def close(self):
        if self._sampling:
            self._refuse('OBSERVER_CLOSE_DURING_SAMPLE')
        if self._closed:
            return None
        failed = False
        for value in self._owned:
            if value['closed']:
                continue
            try:
                self._kernel.close_owned(value['token'])
                value['closed'] = True
            except Exception:
                failed = True
        if failed:
            if self._failure is None:
                self._failure = {'code': 'OBSERVER_OWNED_CLOSE_FAILED'}
            else:
                self._failure['cleanupFailed'] = True
            self._raise_failure()
        self._closed = True
        return None


def create_observer_v2(*, kernel, read_frame, proof_update, roots, max_history=64):
    return _ObserverV2(kernel=kernel, read_frame=read_frame, proof_update=proof_update,
                       roots=roots, max_history=max_history)


def finish_result_v2(*, previous, probe_exit_code, scoped_probe, normal_stop, ownership_complete):
    """Copy independent facts; neither clear first failure nor infer exit0."""
    if not isinstance(previous, dict):
        raise RuntimeError('Previous pure QA result required')
    if probe_exit_code is not None and type(probe_exit_code) is not int:
        raise RuntimeError('Captured integer probe exit or unknown required')
    result = copy.deepcopy(previous)
    result.update(probeExitCode=probe_exit_code, scopedProbe=copy.deepcopy(scoped_probe),
                  normalStop=copy.deepcopy(normal_stop), ownershipObservationComplete=ownership_complete)
    complete = (previous.get('status') == 'PASS' and previous.get('passed') is True and not previous.get('error') and
                previous.get('ownershipObservationComplete') is True and ownership_complete is True and
                probe_exit_code == 0 and isinstance(scoped_probe, dict) and scoped_probe.get('passed') is True and
                isinstance(normal_stop, dict) and normal_stop.get('passed') is True)
    if not complete:
        result['status'], result['passed'] = 'FAIL', False
        if not result.get('error'):
            result['error'] = 'QA completion evidence failed or incomplete'
    return result
