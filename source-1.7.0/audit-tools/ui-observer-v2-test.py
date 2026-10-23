"""SOURCE_ONLY pure observer-v2 contract; Root reviews before any execution.

No OS/native/Popen/worker/business/UI is imported or invoked. FakeKernel and
FakeCollector replace only external acquisition. The legacy subject executes
the real SHA-pinned041698 model and b06 proof through field/method adapters;
it does not contain a substitute observer or intentionally failing policy.

Root first runs --subject legacy --suite smoke. Only after that succeeds run
--suite contract. Assertion failures then describe v2 feature incompatibility,
not a claimed legacy business bug. Missing feature/source/API or test errors
are classified separately; a missing candidate never counts as behavior RED.
Candidate loading requires its separate Root-reviewed SHA and pure imports.
This file grants no native/Guest/UI/engine/deployment qualification.
"""

import argparse
import ast
import copy
from datetime import datetime, timedelta
import hashlib
import json
from pathlib import Path
import re
import stat
import sys
import types
import unittest


ROOT = Path(__file__).resolve().parents[1]
OLD_MODEL = 'audit-tools/ui-observer-model.py'
OLD_SHA = '041698ed1339db734f85a236d28537312dd5817cb02b62b113cfb898885e37df'
PROOF = 'stage1/guest-owned-process-proof.py'
PROOF_SHA = 'b06b4d0254a226dbd849d18a576674e7da6cfad55944ee347b920c5bcc6bad07'
CANDIDATE = 'audit-tools/ui-observer-v2.py'
QUERY_SYNCHRONIZE = 0x00101000
ROOT_PID, CHILD_PID = 100, 200
ROOT_IMAGE = r'C:\Synthetic\root.exe'
CHILD_IMAGE = r'C:\Synthetic\child.exe'
SECRET = 'synthetic-cookie-key-credential-must-never-enter-evidence'
SUBJECT = PROOF_UPDATE = None


class FeatureMissing(Exception):
    pass


class InfrastructureError(Exception):
    pass


def load_pure(relative, sha):
    file = ROOT / relative
    try:
        before = file.lstat()
    except FileNotFoundError:
        raise FeatureMissing('Fixed subject file is absent: ' + relative)
    for current in (file, *file.parents):
        info = current.lstat()
        if stat.S_ISLNK(info.st_mode) or getattr(info, 'st_file_attributes', 0) & 0x400:
            raise InfrastructureError('Pure subject path link refused: ' + relative)
        if current == ROOT:
            break
    if not stat.S_ISREG(before.st_mode) or before.st_nlink != 1 or before.st_size > 8 * 1024 * 1024:
        raise InfrastructureError('Bounded ordinary pure source required: ' + relative)
    with file.open('rb') as stream:
        body = stream.read(8 * 1024 * 1024 + 1)
    after = file.lstat()
    identity = lambda value: (value.st_dev, value.st_ino, value.st_size, value.st_mtime_ns,
                              value.st_ctime_ns, value.st_nlink, getattr(value, 'st_birthtime_ns', None))
    if len(body) != before.st_size or identity(before) != identity(after) or hashlib.sha256(body).hexdigest() != sha:
        raise InfrastructureError('Root-reviewed pure source SHA mismatch: ' + relative)
    tree = ast.parse(body, filename=relative)
    # Supplemental to Root's byte review, not a Python security sandbox.
    for node in ast.walk(tree):
        if isinstance(node, ast.Import) and any(item.name not in {'copy', 'datetime', 're'} for item in node.names):
            raise InfrastructureError('Unexpected pure subject import: ' + relative)
        if isinstance(node, ast.ImportFrom) and (node.level or node.module not in {'copy', 'datetime', 're'}):
            raise InfrastructureError('Unexpected pure subject from-import: ' + relative)
    module = types.ModuleType('qa_pinned_' + Path(relative).stem.replace('-', '_'))
    module.__file__ = str(file)
    exec(compile(body, str(file), 'exec'), module.__dict__)
    return module


def source_row(pid=ROOT_PID, parent=42, *, raw='16010101000000.000001+000', image=ROOT_IMAGE):
    """Literal six-digit source values, independent of observer arithmetic."""
    return {'processId': pid, 'parentProcessId': parent, 'wmiExecutablePath': image,
            'cimCreationDmtfRaw': raw, 'cimCreationValueType': 'System.String' if raw is not None else None}


def legacy_row(row):
    """Wire field/display translation only; no identity or parent decisions."""
    raw = row.get('cimCreationDmtfRaw')
    display = None
    if isinstance(raw, str) and re.fullmatch(r'[0-9]{14}\.[0-9]{6}[+-][0-9]{3}', raw):
        instant = datetime(int(raw[:4]), int(raw[4:6]), int(raw[6:8]), int(raw[8:10]), int(raw[10:12]), int(raw[12:14]), int(raw[15:21]))
        offset = int(raw[22:25]) * (1 if raw[21] == '+' else -1)
        utc = instant - timedelta(minutes=offset)
        display = (f'{utc.year:04}-{utc.month:02}-{utc.day:02}T{utc.hour:02}:'
                   f'{utc.minute:02}:{utc.second:02}.{utc.microsecond:06}0Z')
    return {**copy.deepcopy(row), 'ProcessId': row['processId'], 'ParentProcessId': row['parentProcessId'],
            'ExecutablePath': row.get('wmiExecutablePath'), 'CreationUtc': display,
            'CimCreationRaw': raw, 'CimPrecision': 'microsecond'}


class FakeCollector:
    def __init__(self, rows, events=None):
        self.rows = copy.deepcopy(rows)
        self.sequence = self.calls = 0
        self.forced_sequence = None
        self.after_read = None
        self.events = [] if events is None else events

    def read(self):
        self.calls += 1
        self.sequence = self.sequence + 1 if self.forced_sequence is None else self.forced_sequence
        frame = {'sequence': self.sequence, 'processes': copy.deepcopy(self.rows)}
        self.events.append({'operation': 'frame', 'sequence': self.sequence})
        if self.after_read is not None:
            callback, self.after_read = self.after_read, None
            callback()
        return frame


class FakeKernel:
    """Opaque retained objects and typed observations, never actual OS handles.

    Retire removes current discovery but retained tokens still point to the
    same object. Contradictory tick mutation/reuse is adversarial DI input,
    not a claim that real Windows recycles a held object in that manner.
    """
    def __init__(self, events=None):
        self.current, self.records = {}, {}
        self.closed, self.opens, self.observations = [], [], []
        self.denied_pids, self.denied_closes, self.image_errors = set(), set(), set()
        self.on_open = self.on_image_error = None
        self.counter = 0
        self.inspect_calls = 0
        self.peak_owned = 0
        self.events = [] if events is None else events

    def register(self, pid, ticks, image):
        self.current[pid] = {'pid': pid, 'ticks': ticks, 'image': image, 'signaled': False, 'exitCode': None}

    def _token(self, obj, borrowed):
        self.counter += 1
        token = ('borrowed' if borrowed else 'owned', self.counter)
        self.records[token] = {'object': obj, 'borrowed': borrowed, 'capture': None}
        self.peak_owned = max(self.peak_owned, len(self.active_owned()))
        return token

    def capture(self, pid):
        return self._token(self.current[pid], True)

    def _open(self, pid, access, sequence, parent_token):
        self.opens.append({'pid': pid, 'access': access, 'sequence': sequence, 'parentToken': parent_token})
        if access != QUERY_SYNCHRONIZE or pid in self.denied_pids or pid not in self.current:
            raise RuntimeError('SYNTHETIC_OPEN_REFUSED')
        token = self._token(self.current[pid], False)
        if self.on_open is not None:
            self.on_open(pid)
        return token

    def open_candidate(self, parent_token, row, sequence):
        return self._open(row['processId'], QUERY_SYNCHRONIZE, sequence, parent_token)

    def inspect_held(self, token):
        self.inspect_calls += 1
        if token not in self.records or token in self.closed:
            raise RuntimeError('SYNTHETIC_INVALID_TOKEN')
        record = self.records[token]
        obj = record['object']
        status = {'pid': obj['pid'], 'creationFileTime': str(obj['ticks']),
                  'signaled': obj['signaled'], 'exitCode': obj['exitCode'],
                  'identitySource': 'held-kernel-process-handle',
                  'handleOwnership': 'borrowed' if record['borrowed'] else 'owned-query-synchronize'}
        if obj['signaled']:
            if record['capture'] is None:
                raise RuntimeError('SYNTHETIC_EXIT_WITHOUT_LIVE_CAPTURE')
            capture = record['capture']
            value = {'kind': 'held-exit', **status, 'capturedLiveImagePath': capture['path'],
                     'capturedLiveImageProvenance': {
                         'sourceApi': 'QueryFullProcessImageNameW', 'sourceStage': 'captured-live-image', 'fresh': False,
                         'capturedPid': capture['pid'], 'capturedCreationFileTime': capture['ticks'],
                         'capturedNonsignaledBefore': True, 'capturedNonsignaledAfter': True,
                         'captureRole': status['handleOwnership']}}
        else:
            if token in self.image_errors:
                if self.on_image_error is not None:
                    callback, self.on_image_error = self.on_image_error, None
                    callback()
                raise RuntimeError('SYNTHETIC_LIVE_IMAGE_QUERY_FAILED')
            record['capture'] = {'path': obj['image'], 'pid': obj['pid'], 'ticks': str(obj['ticks'])}
            value = {'kind': 'live', **status, 'imagePath': obj['image'], 'imagePathProvenance': {
                'sourceApi': 'QueryFullProcessImageNameW', 'sourceStage': 'fresh-live-image', 'fresh': True,
                'nonsignaledBefore': True, 'nonsignaledAfter': True}}
        self.observations.append(copy.deepcopy(value))
        self.events.append({'operation': 'inspect', 'pid': value['pid'], 'kind': value['kind']})
        return copy.deepcopy(value)

    def close_owned(self, token):
        if token not in self.records or self.records[token]['borrowed'] or token in self.closed or token in self.denied_closes:
            raise RuntimeError('SYNTHETIC_CLOSE_REFUSED')
        self.closed.append(token)

    def active_owned(self):
        return [token for token, value in self.records.items() if not value['borrowed'] and token not in self.closed]

    def retire(self, pid, code=0):
        obj = self.current.pop(pid)
        obj['signaled'], obj['exitCode'] = True, code


class LegacyKernelPort:
    def __init__(self, kernel, frames):
        self.kernel, self.frames = kernel, frames
        self.latest = {}

    def query_handle(self, token):
        value = self.kernel.inspect_held(token)
        self.latest[value['pid']] = copy.deepcopy(value)
        # Deliberately no cached->imagePath adaptation for a held-exit value.
        return value

    def open_process(self, pid, access):
        return self.kernel._open(pid, access, self.frames.sequence, None)

    def close_handle(self, token):
        return self.kernel.close_owned(token)


class LegacyObserver:
    """Thin fan-out and field translation over real, unchanged old observers."""
    def __init__(self, old, *, kernel, read_frame, proof_update, roots, max_history=64):
        self.last_sequence = 0
        self._read_frame = read_frame
        self._port = LegacyKernelPort(kernel, self)
        self._members = []
        for root in roots:
            self._members.append(old.create_observer(kernel=self._port, read_snapshot=self._read_legacy_frame,
                proof_update=proof_update, root=legacy_row(root['row']), root_handle=root['token'], max_owned=max_history))

    @property
    def sequence(self):
        return self.last_sequence

    def _read_legacy_frame(self):
        frame = self._read_frame()
        self.last_sequence = frame['sequence']
        return {'sequence': frame['sequence'], 'processes': [legacy_row(row) for row in frame['processes']]}

    @property
    def history(self):
        return [row for member in self._members for row in member.history]

    @property
    def failure(self):
        return next((member.failure for member in self._members if member.failure is not None), None)

    def sample(self):
        rows = [row for member in self._members for row in member.sample()]
        return {'sequence': self.last_sequence, 'verifiedLive': [{**copy.deepcopy(row), **copy.deepcopy(self._port.latest[row['ProcessId']])} for row in rows],
                'history': self.history, 'failure': self.failure}

    def close(self):
        first = None
        for member in self._members:
            try:
                member.close()
            except RuntimeError as error:
                if first is None:
                    first = error
        if first is not None:
            raise first


def load_subject(name, candidate_sha):
    if name == 'candidate':
        try:
            (ROOT / CANDIDATE).lstat()
        except FileNotFoundError:
            raise FeatureMissing('Observer v2 is not implemented; no tests ran')
        if not isinstance(candidate_sha, str) or re.fullmatch(r'[0-9a-f]{64}', candidate_sha) is None:
            raise FeatureMissing('Separate Root-reviewed candidate SHA is required')
        subject = load_pure(CANDIDATE, candidate_sha)
        if not all(callable(getattr(subject, field, None)) for field in ('create_observer_v2', 'finish_result_v2')):
            raise FeatureMissing('Observer v2 public interface is not implemented')
        return subject
    old = load_pure(OLD_MODEL, OLD_SHA)
    def create_observer_v2(**values):
        return LegacyObserver(old, **values)
    def finish_result_v2(*, previous, probe_exit_code, scoped_probe, normal_stop, ownership_complete):
        translated = copy.deepcopy(previous)
        translated['ownershipObservationComplete'] = ownership_complete
        return old.finish_result(previous=translated, probe_exit_code=probe_exit_code,
                                 scoped_probe=scoped_probe, normal_stop=normal_stop)
    return types.SimpleNamespace(create_observer_v2=create_observer_v2, finish_result_v2=finish_result_v2)


class ContractBase(unittest.TestCase):
    def fixture(self, *, ticks=17, root_row=None, limit=64):
        events = []
        kernel = FakeKernel(events)
        kernel.register(ROOT_PID, ticks, ROOT_IMAGE)
        token = kernel.capture(ROOT_PID)
        row = source_row() if root_row is None else copy.deepcopy(root_row)
        frames = FakeCollector([row], events)
        observer = SUBJECT.create_observer_v2(kernel=kernel, read_frame=frames.read, proof_update=PROOF_UPDATE,
            roots=[{'role': 'native', 'token': token, 'row': row}], max_history=limit)
        self.addCleanup(observer.close)
        return kernel, frames, observer, token

    def accepted(self, observer, label='valid fixture'):
        try:
            value = observer.sample()
        except RuntimeError as error:
            self.fail(label + ' was refused by the real subject: ' + str(error))
        self.assertIsInstance(value, dict)
        self.assertIsNone(observer.failure, label)
        self.assertIsNone(value['failure'], label)
        return value

    def rejected(self, observer):
        with self.assertRaises(RuntimeError):
            observer.sample()
        self.assertIsInstance(observer.failure, dict)
        self.assertIsInstance(observer.failure.get('code'), str)
        return copy.deepcopy(observer.failure)

    def add_child(self, kernel, frames, *, ticks=27, raw='16010101000000.000002+000', parent=ROOT_PID):
        kernel.register(CHILD_PID, ticks, CHILD_IMAGE)
        frames.rows.append(source_row(CHILD_PID, parent, raw=raw, image=CHILD_IMAGE))


class BaselineSmoke(ContractBase):
    def test_S01_legal_live_root_keeps_full_tick17(self):
        _, _, observer, _ = self.fixture()
        result = self.accepted(observer)
        self.assertEqual([row['pid'] for row in result['verifiedLive']], [100])
        self.assertEqual(observer.history[0]['KernelCreationFileTime'], '17')
        self.assertEqual(observer.history[0]['CreationUtc'], '1601-01-01T00:00:00.0000017Z')

    def test_S02_legal_live_child_is_admitted_and_borrowed_is_not_closed(self):
        kernel, frames, observer, token = self.fixture()
        self.add_child(kernel, frames)
        result = self.accepted(observer)
        self.assertEqual([row['pid'] for row in result['verifiedLive']], [100, 200])
        self.assertEqual(observer.history[1]['KernelCreationFileTime'], '27')
        self.assertEqual(observer.history[1]['CreationUtc'], '1601-01-01T00:00:00.0000027Z')
        observer.close()
        self.assertEqual(kernel.active_owned(), [])
        self.assertNotIn(token, kernel.closed)

    def test_S03_literal_nonzero_dmtf_offsets_are_legitimate(self):
        kernel, frames, observer, _ = self.fixture(root_row=source_row(raw='16010101010000.000001+060'))
        self.add_child(kernel, frames, raw='16001231230000.000002-060')
        self.assertEqual([row['creationFileTime'] for row in self.accepted(observer)['verifiedLive']], ['17', '27'])

    def test_S04_complete_independent_facts_retain_new_attempt_pass(self):
        previous = {'status': 'PASS', 'passed': True, 'ownershipObservationComplete': True}
        result = SUBJECT.finish_result_v2(previous=previous, probe_exit_code=0, scoped_probe={'passed': True},
                                         normal_stop={'passed': True}, ownership_complete=True)
        self.assertEqual(result['status'], 'PASS')
        self.assertIs(result['passed'], True)
        self.assertEqual(result['probeExitCode'], 0)
        self.assertNotIn('probeExitCode', previous)

    def test_S05_literal_modern_filetime_is_exact_in_a_legal_fixture(self):
        _, _, observer, _ = self.fixture(ticks=116444736000000017,
                                         root_row=source_row(raw='19700101000000.000001+000'))
        result = self.accepted(observer)
        self.assertEqual(result['verifiedLive'][0]['creationFileTime'], '116444736000000017')
        self.assertEqual(observer.history[0]['CreationUtc'], '1970-01-01T00:00:00.0000017Z')

    def test_S06_two_legitimate_independent_forests_fit_the_global_budget(self):
        kernel = FakeKernel()
        kernel.register(100, 17, ROOT_IMAGE)
        kernel.register(300, 37, ROOT_IMAGE)
        one, two = kernel.capture(100), kernel.capture(300)
        rows = [source_row(), source_row(300, 999, raw='16010101000000.000003+000')]
        frames = FakeCollector(rows)
        observer = SUBJECT.create_observer_v2(kernel=kernel, read_frame=frames.read, proof_update=PROOF_UPDATE,
            roots=[{'role': 'native', 'token': one, 'row': rows[0]}, {'role': 'probe', 'token': two, 'row': rows[1]}], max_history=64)
        self.addCleanup(observer.close)
        self.assertEqual([row['pid'] for row in self.accepted(observer)['verifiedLive']], [100, 300])
        observer.close()
        self.assertNotIn(one, kernel.closed)
        self.assertNotIn(two, kernel.closed)


class V2Contract(ContractBase):
    def test_V01_held_exit_without_fresh_image_is_valid_and_never_reopened(self):
        kernel, frames, observer, token = self.fixture()
        self.accepted(observer)
        mark, opens = len(kernel.observations), len(kernel.opens)
        kernel.retire(ROOT_PID)
        frames.rows = []
        result = self.accepted(observer, 'normal held-exit/no-current-row')
        self.assertEqual(result['verifiedLive'], [])
        self.assertEqual(observer.history[0]['KernelCreationFileTime'], '17')
        self.assertEqual(len(kernel.opens), opens, 'retained exit is not a new PID lookup')
        observed = kernel.observations[mark:]
        self.assertTrue(observed, 'missing from inventory is not itself exit proof')
        self.assertTrue(all(value['kind'] == 'held-exit' and 'imagePath' not in value for value in observed))
        self.assertTrue(all(value['capturedLiveImageProvenance']['fresh'] is False for value in observed))
        self.assertNotIn(token, kernel.closed)

    def test_V01b_nonatomic_live_to_exit_frame_is_accepted_after_fresh_confirmation(self):
        kernel, frames, observer, token = self.fixture()
        self.accepted(observer)
        opens, event_mark = len(kernel.opens), len(kernel.events)
        from_sequence = frames.sequence + 1
        def exits_after_frame_copy():
            kernel.retire(ROOT_PID)
            frames.rows = []
        # The returned frame still contains root100; only later frames are empty.
        frames.after_read = exits_after_frame_copy
        result = self.accepted(observer, 'legitimate non-atomic live-to-held-exit transition')
        self.assertEqual(result['verifiedLive'], [])
        self.assertEqual(observer.history[0]['KernelCreationFileTime'], '17')
        self.assertEqual(len(kernel.opens), opens)
        events = kernel.events[event_mark:]
        exit_index = next((index for index, value in enumerate(events)
                           if value == {'operation': 'inspect', 'pid': 100, 'kind': 'held-exit'}), None)
        self.assertIsNotNone(exit_index, 'transition must read the original held object')
        post_sequences = [value['sequence'] for value in events[exit_index + 1:] if value['operation'] == 'frame']
        self.assertTrue(post_sequences, 'the copied pre-exit row requires a frame taken after held-exit confirmation')
        self.assertTrue(all(value > from_sequence for value in post_sequences))
        transitions = result.get('transitionObservations')
        self.assertIsInstance(transitions, list, 'keep bounded transition evidence instead of losing the non-atomic frame')
        self.assertTrue(any(isinstance(value, dict) and value.get('kind') == 'live-to-held-exit' and
                            value.get('pid') == 100 and value.get('creationFileTime') == '17' and
                            value.get('fromSequence') == from_sequence and value.get('toSequence') in post_sequences
                            for value in transitions))
        observed_exits = [value for value in kernel.observations if value['kind'] == 'held-exit']
        self.assertTrue(observed_exits)
        self.assertTrue(all('imagePath' not in value and value['capturedLiveImageProvenance']['fresh'] is False
                            for value in observed_exits))
        self.assertNotIn(token, kernel.closed)

    def test_V02_live_image_error_cannot_be_retried_as_successful_exit(self):
        kernel, frames, observer, token = self.fixture()
        self.accepted(observer)
        kernel.image_errors.add(token)
        def ends_during_failed_live_query():
            kernel.retire(ROOT_PID)
            frames.rows = []
        kernel.on_image_error = ends_during_failed_live_query
        first = self.rejected(observer)
        reads = frames.calls
        self.rejected(observer)
        self.assertEqual(observer.failure['code'], first['code'])
        self.assertEqual(frames.calls, reads, 'known failure rejects further sampling')

    def test_V03_full_ticks_not_the_same_microsecond_quotient_establish_identity(self):
        for ticks, raw, want in [(17, '16010101000000.000001+000', '17'),
                                 (116444736000000017, '19700101000000.000001+000', '116444736000000017')]:
            with self.subTest(ticks=ticks):
                kernel, _, observer, token = self.fixture(ticks=ticks, root_row=source_row(raw=raw))
                self.accepted(observer)
                kernel.records[token]['object']['ticks'] = ticks + 1
                self.rejected(observer)
                self.assertEqual(observer.history[0]['KernelCreationFileTime'], want)

    def test_V04_stable_but_wrong_cim_projection_is_refused(self):
        kernel, frames, observer, _ = self.fixture()
        self.add_child(kernel, frames, ticks=37)  # source says2microseconds; ticks37 belongs to3.
        self.rejected(observer)
        self.assertEqual([row['ProcessId'] for row in observer.history], [100])

    def test_V05_exit_with_persistently_enumerated_same_pid_is_not_aliased_or_reopened(self):
        kernel, frames, observer, _ = self.fixture()
        self.accepted(observer)
        kernel.retire(ROOT_PID)
        # Contradictory current object18 shares the old source microsecond1.
        kernel.register(ROOT_PID, 18, ROOT_IMAGE)
        reads, opens, event_mark = frames.calls, len(kernel.opens), len(kernel.events)
        self.rejected(observer)
        self.assertGreater(frames.calls, reads, 'a post-exit current-row decision consumes a fresh frame')
        events = kernel.events[event_mark:]
        exit_index = next((index for index, value in enumerate(events) if value == {'operation': 'inspect', 'pid': 100, 'kind': 'held-exit'}), None)
        self.assertIsNotNone(exit_index, 'refusal must inspect the retained object, not infer exit from metadata')
        self.assertTrue(any(value['operation'] == 'frame' for value in events[exit_index + 1:]),
                        'a frame acquired before confirmed held-exit cannot resolve the current row')
        self.assertEqual(len(kernel.opens), opens, 'do not look up an exited identity by current PID')
        self.assertEqual(observer.history[0]['KernelCreationFileTime'], '17')

    def test_V06_candidate_parent_must_rebind_in_a_strictly_fresher_frame(self):
        kernel, frames, observer, _ = self.fixture()
        self.add_child(kernel, frames)
        frames.after_read = lambda: frames.rows[1].update(parentProcessId=999)
        self.rejected(observer)
        self.assertGreaterEqual(frames.calls, 2)
        self.assertEqual([row['ProcessId'] for row in observer.history], [100])

    def test_V07_denied_or_disappeared_candidate_is_not_cim_only_owned(self):
        for cause in ('denied', 'disappeared'):
            with self.subTest(cause=cause):
                kernel, frames, observer, _ = self.fixture()
                self.add_child(kernel, frames)
                if cause == 'denied':
                    kernel.denied_pids.add(CHILD_PID)
                else:
                    def disappear_after_child_open(pid):
                        if pid == CHILD_PID:
                            frames.rows = [value for value in frames.rows if value['processId'] != CHILD_PID]
                            kernel.on_open = None
                    kernel.on_open = disappear_after_child_open
                self.rejected(observer)
                self.assertEqual([row['ProcessId'] for row in observer.history], [100])

    def test_V08_child_before_parent_is_refused_with_self_consistent_cim_sources(self):
        kernel, frames, observer, _ = self.fixture()
        self.add_child(kernel, frames, ticks=16, raw='16010101000000.000001+000')
        self.rejected(observer)  # Both quotients are1; source consistency cannot be the reason.
        self.assertEqual([row['ProcessId'] for row in observer.history], [100])

    def test_V09a_unrelated_same_executable_never_becomes_owned(self):
        kernel, frames, observer, _ = self.fixture()
        kernel.register(300, 37, ROOT_IMAGE)
        frames.rows.append(source_row(300, 999, raw='16010101000000.000003+000'))
        self.assertEqual([row['pid'] for row in self.accepted(observer)['verifiedLive']], [100])
        self.assertFalse(any(call['pid'] == 300 for call in kernel.opens))

    def test_V09b_duplicate_replay_and_skipped_frames_are_refused(self):
        for cause in ('duplicate', 'replay', 'skip'):
            with self.subTest(cause=cause):
                _, frames, observer, _ = self.fixture()
                self.accepted(observer)
                if cause == 'duplicate':
                    frames.rows.append(source_row())
                else:
                    frames.forced_sequence = frames.sequence if cause == 'replay' else frames.sequence + 2
                self.rejected(observer)

    def test_V09c_cross_root_pid_collision_is_not_merged(self):
        kernel = FakeKernel()
        kernel.register(100, 17, ROOT_IMAGE)
        first = kernel.capture(100)
        kernel.register(100, 18, ROOT_IMAGE)
        second = kernel.capture(100)
        frames = FakeCollector([source_row()])
        observer = None
        try:
            try:
                observer = SUBJECT.create_observer_v2(kernel=kernel, read_frame=frames.read, proof_update=PROOF_UPDATE,
                    roots=[{'role': 'native', 'token': first, 'row': source_row()},
                           {'role': 'probe', 'token': second, 'row': source_row()}], max_history=64)
                self.rejected(observer)
            except RuntimeError:
                pass  # Constructor refusal is also valid; no subject-less module errors are caught.
        finally:
            if observer is not None:
                observer.close()
        self.assertNotIn(first, kernel.closed)
        self.assertNotIn(second, kernel.closed)

    def test_V10a_history_budget_prevents_new_open_and_keeps_borrowed_root(self):
        kernel, frames, observer, token = self.fixture(limit=1)
        self.add_child(kernel, frames)
        self.rejected(observer)
        self.assertFalse(any(call['pid'] == CHILD_PID for call in kernel.opens), 'budget is checked before starting the candidate handle')
        observer.close()
        observer.close()
        self.assertNotIn(token, kernel.closed)
        self.assertLessEqual(kernel.peak_owned, 1, 'only the one reserved comparison/pin slot is available')

    def test_V10b_global_history_budget_counts_all_root_forests(self):
        kernel = FakeKernel()
        kernel.register(100, 17, ROOT_IMAGE)
        kernel.register(300, 37, ROOT_IMAGE)
        one, two = kernel.capture(100), kernel.capture(300)
        rows = [source_row(), source_row(300, 999, raw='16010101000000.000003+000')]
        frames = FakeCollector(rows)
        observer = None
        try:
            with self.assertRaises(RuntimeError):
                observer = SUBJECT.create_observer_v2(kernel=kernel, read_frame=frames.read, proof_update=PROOF_UPDATE,
                    roots=[{'role': 'native', 'token': one, 'row': rows[0]},
                           {'role': 'probe', 'token': two, 'row': rows[1]}], max_history=1)
                observer.sample()
        finally:
            if observer is not None:
                observer.close()
        self.assertEqual(kernel.active_owned(), [])
        self.assertNotIn(one, kernel.closed)
        self.assertNotIn(two, kernel.closed)

    def test_V10c_failed_close_stays_accounted_and_first_failure_is_not_reset(self):
        kernel, frames, observer, token = self.fixture()
        self.add_child(kernel, frames)
        self.accepted(observer)
        held = kernel.active_owned()
        self.assertEqual(len(held), 1)
        kernel.denied_closes.add(held[0])
        try:
            with self.assertRaises(RuntimeError):
                observer.close()
            self.assertIn(held[0], kernel.active_owned())
            first = copy.deepcopy(observer.failure)
            self.assertIsInstance(first, dict)
            reads, opens = frames.calls, len(kernel.opens)
            self.rejected(observer)
            self.assertEqual(frames.calls, reads)
            self.assertEqual(len(kernel.opens), opens)
            self.assertEqual(observer.failure['code'], first['code'])
        finally:
            kernel.denied_closes.clear()
        observer.close()
        self.assertEqual(kernel.active_owned(), [])
        self.assertEqual(observer.failure['code'], first['code'])
        self.assertNotIn(token, kernel.closed)

    def test_V10d_exited_history_still_consumes_budget(self):
        kernel, frames, observer, _ = self.fixture(limit=2)
        self.add_child(kernel, frames)
        self.accepted(observer)
        kernel.retire(200)
        frames.rows = [source_row()]
        self.accepted(observer, 'legitimate retired child before budget check')
        self.assertTrue(any(kernel.records[token]['object']['pid'] == 200 for token in kernel.active_owned()),
                        'the retained exit handle remains owned until final close')
        kernel.register(201, 37, CHILD_IMAGE)
        frames.rows.append(source_row(201, 100, raw='16010101000000.000003+000', image=CHILD_IMAGE))
        opens = len(kernel.opens)
        self.rejected(observer)
        self.assertEqual(len(kernel.opens), opens)
        self.assertEqual([row['ProcessId'] for row in observer.history], [100, 200])

    def test_V11a_failure_is_sticky_redacted_and_rejects_new_reads(self):
        kernel, frames, observer, token = self.fixture()
        self.accepted(observer)
        kernel.records[token]['object']['ticks'] = 18
        frames.rows[0]['untrustedDiagnostic'] = SECRET
        first = self.rejected(observer)
        reads = frames.calls
        kernel.records[token]['object']['ticks'] = 17
        frames.rows = [source_row()]
        self.rejected(observer)
        self.assertEqual(frames.calls, reads)
        self.assertEqual(observer.failure['code'], first['code'])
        self.assertNotIn(SECRET, repr(observer.failure))
        self.assertNotIn(SECRET, repr(observer.history))
        self.assertLess(len(repr(observer.failure)), 2048)

    def test_V11b_persistence_failure_state_cannot_be_upgraded_by_clean_stop(self):
        previous = {'status': 'FAIL', 'passed': False, 'error': 'RESULT_PERSISTENCE_FAILED',
                    'ownershipObservationComplete': False, 'holdingOriginalCapture': True}
        result = SUBJECT.finish_result_v2(previous=previous, probe_exit_code=0, scoped_probe={'passed': True},
                                         normal_stop={'passed': True}, ownership_complete=False)
        self.assertIs(result['passed'], False)
        self.assertEqual(result['error'], 'RESULT_PERSISTENCE_FAILED')
        self.assertIs(result['holdingOriginalCapture'], True)
        self.assertNotIn('probeExitCode', previous)

    def test_V12_observer_failure_keeps_exit0_scopedpass_and_driver_fail(self):
        previous = {'status': 'FAIL', 'passed': False, 'error': 'OWNERSHIP_OBSERVATION_FAILED',
                    'ownershipObservationComplete': False}
        result = SUBJECT.finish_result_v2(previous=previous, probe_exit_code=0, scoped_probe={'passed': True, 'pages': 33},
                                         normal_stop={'passed': True}, ownership_complete=False)
        self.assertEqual(result['probeExitCode'], 0)
        self.assertEqual(result['scopedProbe'], {'passed': True, 'pages': 33})
        self.assertEqual(result['status'], 'FAIL')
        self.assertIs(result['passed'], False)
        self.assertEqual(result['error'], previous['error'])

    def test_V13_missing_or_failed_completion_facts_never_manufacture_pass(self):
        for cause in ('exit', 'probe', 'normal-stop', 'ownership', 'source', 'owner'):
            with self.subTest(cause=cause):
                previous = {'status': 'PASS', 'passed': True, 'ownershipObservationComplete': True}
                if cause in ('source', 'owner'):
                    previous.update(status='FAIL', passed=False, error=cause.upper() + '_REFUSED')
                result = SUBJECT.finish_result_v2(previous=previous, probe_exit_code=None if cause == 'exit' else 0,
                    scoped_probe={'passed': cause != 'probe'}, normal_stop={'passed': cause != 'normal-stop'},
                    ownership_complete=None if cause == 'ownership' else True)
                self.assertEqual(result['status'], 'FAIL')
                self.assertIs(result['passed'], False)
                if cause == 'exit':
                    self.assertIsNone(result['probeExitCode'])


def main():
    global SUBJECT, PROOF_UPDATE
    parser = argparse.ArgumentParser(description=__doc__, allow_abbrev=False)
    parser.add_argument('--subject', choices=('legacy', 'candidate'), default='legacy')
    parser.add_argument('--suite', choices=('smoke', 'contract'), default='smoke')
    parser.add_argument('--candidate-sha256')
    values = parser.parse_args()
    try:
        if not sys.flags.isolated or not sys.flags.dont_write_bytecode:
            raise InfrastructureError('Root pure entry requires -I -B')
        PROOF_UPDATE = load_pure(PROOF, PROOF_SHA).update_owned
        SUBJECT = load_subject(values.subject, values.candidate_sha256)
    except Exception as error:
        print(json.dumps({'scope': 'pure-DI-only', 'outcome': 'FEATURE_MISSING' if isinstance(error, FeatureMissing) else 'INFRASTRUCTURE_ERROR',
                          'testsRun': 0, 'businessBugClaimed': False, 'reason': str(error)}), file=sys.stderr, flush=True)
        return 2
    case = BaselineSmoke if values.suite == 'smoke' else V2Contract
    print(json.dumps({'scope': 'pure-DI-only', 'subject': values.subject, 'suite': values.suite,
                      'nativeOrBusinessExecution': False, 'qualificationGranted': False}), flush=True)
    result = unittest.TextTestRunner(verbosity=2).run(unittest.defaultTestLoader.loadTestsFromTestCase(case))
    outcome = 'INVALID_TEST_OR_INFRASTRUCTURE' if result.errors else 'PASS' if result.wasSuccessful() else 'CONTRACT_ASSERTION_FAILURE'
    print(json.dumps({'scope': 'pure-DI-only', 'outcome': outcome, 'testsRun': result.testsRun,
                      'failures': len(result.failures), 'errors': len(result.errors),
                      'businessBugClaimed': False, 'qualificationGranted': False}), flush=True)
    return 2 if result.errors else 0 if result.wasSuccessful() else 1


if __name__ == '__main__':
    raise SystemExit(main())
