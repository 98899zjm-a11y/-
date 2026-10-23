"""QA-only identity/reducer contract; no OS, product, child process or database.

Default subject is the explicitly named ``legacy-reference``: a small adapter
of next-ui-driver's current CIM-only update_owned / early-exception result
flow. It calls the real, SHA-pinned, unchanged pure ownership proof. New handle
requirements therefore fail as assertions rather than a missing-module error.
This is a model RED baseline, not execution of the driver or evidence naming
the actual ui-a2 colliding PID. Root must run and inspect it before a candidate
pure wrapper is implemented. The candidate path is fixed and is not provided
by this change. No result from this file grants Guest or product admission.

Windows is the external boundary being replaced by FakeKernel. The fake
models distinct retained handles, raw FILETIME integers, signaled objects and
denied queries; it never imports ctypes, subprocess, os or any product code.
``force_reuse`` is deliberately adversarial: real retained Windows handles
normally prevent that PID from being recycled. It checks fail-closed behavior
if an adapter supplies contradictory identity, including sub-microsecond ABA.

Run only under Root's isolated QA execution:
  C:/Python314/python.exe -I -B -X utf8 audit-tools/ui-observer-model-red-test.py --subject legacy-reference
After separate authorization/implementation, use --subject candidate with the
same frozen assertions. A missing candidate is an infrastructure error, never
an accepted business/model RED result.
"""

import argparse
import copy
import hashlib
from pathlib import Path
import sys
import types
import unittest


ROOT = Path(__file__).resolve().parents[1]
PROOF = ROOT / 'stage1' / 'guest-owned-process-proof.py'
PROOF_SHA = 'b06b4d0254a226dbd849d18a576674e7da6cfad55944ee347b920c5bcc6bad07'
QUERY_SYNCHRONIZE = 0x00101000  # PROCESS_QUERY_LIMITED_INFORMATION | SYNCHRONIZE
ROOT_PID = 100
ROOT_PARENT = 42
ROOT_IMAGE = r'C:\Synthetic\probe.exe'
CHILD_IMAGE = r'C:\Windows\System32\WindowsPowerShell\v1.0\powershell.exe'
SECRET = 'synthetic-cookie-key-credential-must-not-be-exported'
SUBJECT = None


def load_pure_proof():
    source = PROOF.read_bytes()
    if hashlib.sha256(source).hexdigest() != PROOF_SHA:
        raise RuntimeError('Infrastructure: unchanged pure ownership proof SHA mismatch')
    module = types.ModuleType('qa_pinned_unchanged_ownership_proof')
    exec(compile(source, str(PROOF), 'exec'), module.__dict__)
    return module.update_owned


PROOF_UPDATE = load_pure_proof()


def row(pid=ROOT_PID, parent=ROOT_PARENT, *, coarse='0000010', image=ROOT_IMAGE,
        day='1601-01-01'):
    # Literal DMTF microsecond data is kept apart from its seven-digit display.
    # Default rows use the first microsecond of the FILETIME epoch.
    return {
        'ProcessId': pid,
        'ParentProcessId': parent,
        'CreationUtc': day + 'T00:00:00.' + coarse + 'Z',
        'CimCreationRaw': day.replace('-', '') + '000000.' + coarse[:6] + '+000',
        'CimPrecision': 'microsecond',
        'Name': image.rsplit('\\', 1)[-1],
        'ExecutablePath': image,
        'CommandLine': SECRET,
    }


class FakeKernel:
    """Only the injected read/query/close boundary; no actual handles or APIs."""

    def __init__(self):
        self.current = {}
        self.handles = {}
        self.denied = set()
        self.opens = []
        self.closed = []
        self.next_handle = 1000
        self.on_open = None

    def register(self, pid, ticks, image):
        self.current[pid] = {
            'pid': pid, 'creationFileTime': str(ticks),
            'imagePath': image, 'signaled': False,
        }

    def capture_root(self, pid):
        # Models an already captured Popen/CreateProcess handle, borrowed by the
        # observer. It remains caller-owned and must not be closed by observer.
        handle = self.next_handle
        self.next_handle += 1
        self.handles[handle] = self.current[pid]
        return handle

    def open_process(self, pid, access):
        self.opens.append({'pid': pid, 'access': access})
        if pid in self.denied:
            raise RuntimeError('ACCESS_DENIED')
        if pid not in self.current:
            raise RuntimeError('PROCESS_GONE_BEFORE_IDENTITY_PIN')
        handle = self.next_handle
        self.next_handle += 1
        self.handles[handle] = self.current[pid]
        if self.on_open is not None:
            self.on_open(pid, handle)
        return handle

    def query_handle(self, handle):
        if handle not in self.handles or handle in self.closed:
            raise RuntimeError('INVALID_HANDLE')
        return copy.deepcopy(self.handles[handle])

    def close_handle(self, handle):
        if handle not in self.handles or handle in self.closed:
            raise RuntimeError('DOUBLE_CLOSE_OR_INVALID_HANDLE')
        self.closed.append(handle)

    def retire(self, pid):
        self.current[pid]['signaled'] = True
        del self.current[pid]

    def force_reuse(self, pid, ticks, image):
        if pid in self.current:
            self.current[pid]['signaled'] = True
        self.register(pid, ticks, image)

    def retained_pids(self):
        return [identity['pid'] for handle, identity in self.handles.items()
                if handle not in self.closed]


class FakeInventory:
    def __init__(self, rows):
        self.rows = copy.deepcopy(rows)
        self.sequence = 0
        self.replay = None
        self.after_read = None

    def __call__(self):
        self.sequence += 1
        frame = {'sequence': self.sequence, 'processes': copy.deepcopy(self.rows)}
        if self.replay is not None:
            frame['sequence'] = self.replay
        if self.after_read is not None:
            callback, self.after_read = self.after_read, None
            callback()
        return frame


class LegacyCimOnlyReference:
    """Test-only current-flow adapter, explicitly not the new observer."""

    def __init__(self, *, kernel, read_snapshot, proof_update, root, root_handle,
                 max_owned=64):
        self.kernel = kernel
        self.read_snapshot = read_snapshot
        self.proof_update = proof_update
        self.history = [copy.deepcopy(root)]
        self.root_handle = root_handle
        self.failure = None

    def sample(self):
        # Current owned_snapshot has no kernel handle/sequence layer. Its real
        # guard checks the canonical CIM strings and preserves PID history.
        frame = self.read_snapshot()
        self.history, alive = self.proof_update(self.history, frame['processes'])
        return copy.deepcopy(alive)

    def close(self):
        # Current driver owns Popen handles, but does not pin descendant handles.
        return None


def legacy_finish_result(*, previous, probe_exit_code, scoped_probe, normal_stop):
    result = copy.deepcopy(previous)
    if result.get('error'):
        # In next-ui-driver the observer exception leaves the try before the
        # probe returncode/result assignment; finally only records normalStop.
        result['normalStop'] = copy.deepcopy(normal_stop)
        return result
    result['probeExitCode'] = probe_exit_code
    result['scopedProbe'] = copy.deepcopy(scoped_probe)
    result['normalStop'] = copy.deepcopy(normal_stop)
    return result


def load_subject(name):
    if name == 'legacy-reference':
        return types.SimpleNamespace(create_observer=LegacyCimOnlyReference,
                                     finish_result=legacy_finish_result)
    candidate = ROOT / 'audit-tools' / 'ui-observer-model.py'
    if not candidate.is_file():
        raise RuntimeError('Infrastructure: candidate not implemented; select legacy-reference for model RED')
    module = types.ModuleType('qa_candidate_ui_observer_model')
    # The separately reviewed candidate must be a pure dependency-injected
    # module. Root reviews its imports before running it; no arbitrary path.
    exec(compile(candidate.read_bytes(), str(candidate), 'exec'), module.__dict__)
    for export in ('create_observer', 'finish_result'):
        if not callable(getattr(module, export, None)):
            raise RuntimeError('Infrastructure: candidate export missing: ' + export)
    return module


class ObserverContract(unittest.TestCase):
    def fixture(self, *, root_ticks=17, root_row=None, max_owned=64):
        kernel = FakeKernel()
        kernel.register(ROOT_PID, root_ticks, ROOT_IMAGE)
        handle = kernel.capture_root(ROOT_PID)
        identity = copy.deepcopy(row() if root_row is None else root_row)
        inventory = FakeInventory([identity])
        observer = SUBJECT.create_observer(kernel=kernel, read_snapshot=inventory,
                                           proof_update=PROOF_UPDATE, root=identity,
                                           root_handle=handle, max_owned=max_owned)
        self.addCleanup(observer.close)
        return kernel, inventory, observer, handle

    def test_I01_root_uses_captured_kernel_ticks_not_zero_padded_cim(self):
        _, _, observer, _ = self.fixture()
        observer.sample()
        root_identity = observer.history[0]
        self.assertEqual(root_identity.get('CreationUtc'), '1601-01-01T00:00:00.0000017Z')
        self.assertEqual(root_identity.get('KernelCreationFileTime'), '17')
        self.assertEqual(root_identity.get('IdentitySource'), 'kernel-process-handle')
        self.assertEqual(root_identity.get('CimCreationRaw'), '16010101000000.000001+000')
        self.assertEqual(root_identity.get('CimPrecision'), 'microsecond')
        self.assertNotIn(SECRET, repr(observer.history))

    def test_I02_same_cim_microsecond_does_not_hide_kernel_ABA(self):
        kernel, _, observer, _ = self.fixture()
        observer.sample()
        kernel.force_reuse(ROOT_PID, 18, ROOT_IMAGE)
        with self.assertRaises(RuntimeError):
            observer.sample()

    def test_I03_descendant_gets_kernel_identity_before_admission(self):
        kernel, inventory, observer, _ = self.fixture()
        kernel.register(200, 27, CHILD_IMAGE)
        inventory.rows.append(row(200, ROOT_PID, coarse='0000020', image=CHILD_IMAGE))
        alive = observer.sample()
        child = next(value for value in alive if value['ProcessId'] == 200)
        self.assertEqual(child.get('CreationUtc'), '1601-01-01T00:00:00.0000027Z')
        self.assertEqual(child.get('KernelCreationFileTime'), '27')
        self.assertEqual(child.get('IdentitySource'), 'kernel-process-handle')
        self.assertNotIn(SECRET, repr(alive))
        self.assertIn(200, kernel.retained_pids())
        self.assertTrue(all(call['access'] == QUERY_SYNCHRONIZE for call in kernel.opens))

    def test_I04_kernel_child_older_than_parent_is_not_admitted(self):
        kernel, inventory, observer, _ = self.fixture()
        # A contradictory/coarse inventory must not outrank raw kernel times.
        kernel.register(200, 16, CHILD_IMAGE)
        inventory.rows.append(row(200, ROOT_PID, coarse='0000020', image=CHILD_IMAGE))
        with self.assertRaises(RuntimeError):
            observer.sample()

    def test_I05_denied_descendant_handle_is_not_silently_cim_owned(self):
        kernel, inventory, observer, _ = self.fixture()
        kernel.register(200, 27, CHILD_IMAGE)
        kernel.denied.add(200)
        inventory.rows.append(row(200, ROOT_PID, coarse='0000020', image=CHILD_IMAGE))
        with self.assertRaises(RuntimeError):
            observer.sample()

    def test_I06_parent_change_during_pin_is_refused_after_fresh_requery(self):
        kernel, inventory, observer, _ = self.fixture()
        kernel.register(200, 27, CHILD_IMAGE)
        inventory.rows.append(row(200, ROOT_PID, coarse='0000020', image=CHILD_IMAGE))

        def change_after_discovery():
            inventory.rows[1]['ParentProcessId'] = 999

        inventory.after_read = change_after_discovery
        with self.assertRaises(RuntimeError):
            observer.sample()

    def test_I07_disappeared_child_keeps_handle_and_history_until_close(self):
        kernel, inventory, observer, borrowed = self.fixture()
        kernel.register(200, 27, CHILD_IMAGE)
        inventory.rows.append(row(200, ROOT_PID, coarse='0000020', image=CHILD_IMAGE))
        observer.sample()
        kernel.retire(200)
        inventory.rows = [row()]
        alive = observer.sample()
        self.assertEqual([value['ProcessId'] for value in alive], [ROOT_PID])
        self.assertIn(200, [value['ProcessId'] for value in observer.history])
        self.assertIn(200, kernel.retained_pids())
        observer.close()
        observer.close()
        self.assertEqual(kernel.retained_pids(), [ROOT_PID])
        self.assertNotIn(borrowed, kernel.closed, 'caller owns the root/Popen handle')
        self.assertEqual(len(kernel.closed), len(set(kernel.closed)))

    def test_I08_mismatched_captured_root_handle_cannot_pin_cim_root(self):
        kernel = FakeKernel()
        kernel.register(999, 17, ROOT_IMAGE)
        borrowed = kernel.capture_root(999)
        with self.assertRaises(RuntimeError):
            observer = SUBJECT.create_observer(kernel=kernel, read_snapshot=FakeInventory([row()]),
                                               proof_update=PROOF_UPDATE, root=row(),
                                               root_handle=borrowed)
            self.addCleanup(observer.close)
            observer.sample()

    def test_I09_replayed_inventory_is_not_fresh_shutdown_evidence(self):
        _, inventory, observer, _ = self.fixture()
        observer.sample()
        inventory.replay = inventory.sequence
        with self.assertRaises(RuntimeError):
            observer.sample()

    def test_I10_collision_diagnostic_is_exact_bounded_and_redacted(self):
        kernel, _, observer, _ = self.fixture()
        observer.sample()
        kernel.force_reuse(ROOT_PID, 18, ROOT_IMAGE)
        with self.assertRaises(RuntimeError) as refused:
            observer.sample()
        self.assertIsInstance(observer.failure, dict)
        self.assertEqual(observer.failure.get('code'), 'OWNED_PROCESS_IDENTITY_MISMATCH')
        self.assertEqual(observer.failure.get('pid'), ROOT_PID)
        self.assertEqual(observer.failure.get('knownCreationFileTime'), '17')
        self.assertEqual(observer.failure.get('observedCreationFileTime'), '18')
        self.assertEqual(observer.failure.get('knownParentPid'), ROOT_PARENT)
        self.assertEqual(observer.failure.get('observedParentPid'), ROOT_PARENT)
        self.assertNotIn(SECRET, repr(observer.failure))
        self.assertNotIn(SECRET, str(refused.exception))
        self.assertLess(len(repr(observer.failure)), 2048)
        self.assertNotIn('CommandLine', observer.failure)
        self.assertNotIn('environment', observer.failure)

    def test_I11_modern_filetime_above_double_integer_precision_stays_exact(self):
        # Unix epoch is exactly FILETIME 116444736000000000. These literals
        # exercise integer/string precision without datetime or DUT arithmetic.
        kernel, _, observer, _ = self.fixture(
            root_ticks=116444736000000017, root_row=row(day='1970-01-01'))
        observer.sample()
        self.assertEqual(observer.history[0].get('CreationUtc'), '1970-01-01T00:00:00.0000017Z')
        self.assertEqual(observer.history[0].get('KernelCreationFileTime'), '116444736000000017')
        kernel.force_reuse(ROOT_PID, 116444736000000018, ROOT_IMAGE)
        with self.assertRaises(RuntimeError):
            observer.sample()

    def test_I12_process_gone_before_pin_is_not_admitted_as_cim_only_history(self):
        _, inventory, observer, _ = self.fixture()
        inventory.rows.append(row(200, ROOT_PID, coarse='0000020', image=CHILD_IMAGE))
        with self.assertRaises(RuntimeError):
            observer.sample()

    def test_I13_exited_retained_identity_still_consumes_handle_history_budget(self):
        kernel, inventory, observer, _ = self.fixture(max_owned=2)
        kernel.register(200, 27, CHILD_IMAGE)
        inventory.rows.append(row(200, ROOT_PID, coarse='0000020', image=CHILD_IMAGE))
        observer.sample()
        kernel.retire(200)
        kernel.register(201, 37, CHILD_IMAGE)
        inventory.rows = [row(), row(201, ROOT_PID, coarse='0000030', image=CHILD_IMAGE)]
        with self.assertRaises(RuntimeError):
            observer.sample()

    def test_C01_visible_cim_pid_reuse_still_refused_by_unchanged_guard(self):
        kernel, inventory, observer, _ = self.fixture()
        observer.sample()
        kernel.force_reuse(ROOT_PID, 27, ROOT_IMAGE)
        inventory.rows = [row(coarse='0000020')]
        with self.assertRaises(RuntimeError):
            observer.sample()

    def test_C02_unrelated_same_executable_never_becomes_owned(self):
        kernel, inventory, observer, _ = self.fixture()
        kernel.register(200, 27, ROOT_IMAGE)
        inventory.rows.append(row(200, 999, coarse='0000020'))
        alive = observer.sample()
        self.assertEqual([value['ProcessId'] for value in alive], [ROOT_PID])
        self.assertEqual([value['ProcessId'] for value in observer.history], [ROOT_PID])
        self.assertNotIn(200, kernel.retained_pids())

    def test_C03_old_proof_refuses_recycled_query_pid_without_name_exemption(self):
        known = [row(), row(200, ROOT_PID, coarse='0000020', image=CHILD_IMAGE)]
        current = [row(), row(200, ROOT_PARENT, coarse='0000030', image=CHILD_IMAGE)]
        with self.assertRaisesRegex(RuntimeError, 'observed owned PID reuse'):
            PROOF_UPDATE(known, current)

    def test_C05_duplicate_current_pid_remains_ambiguous(self):
        _, inventory, observer, _ = self.fixture()
        inventory.rows = [row(), row()]
        with self.assertRaises(RuntimeError):
            observer.sample()


class ResultContract(unittest.TestCase):
    def test_R01_observer_failure_keeps_probe_exit_zero_and_sticky_driver_fail(self):
        previous = {'status': 'FAIL', 'passed': False,
                    'error': 'Ambiguous process identity: observed owned PID reuse',
                    'ownershipObservationComplete': False}
        stop = {'passed': True, 'forcedStop': False, 'cleanSnapshots': 2,
                'ownedStillAlive': [], 'ownedListeners': []}
        result = SUBJECT.finish_result(previous=previous, probe_exit_code=0,
                                       scoped_probe={'passed': True, 'pages': 33}, normal_stop=stop)
        self.assertEqual(result.get('probeExitCode'), 0)
        self.assertEqual(result.get('scopedProbe'), {'passed': True, 'pages': 33})
        self.assertEqual(result.get('error'), previous['error'])
        self.assertEqual(result.get('status'), 'FAIL')
        self.assertIs(result.get('passed'), False)
        self.assertIs(result.get('ownershipObservationComplete'), False)
        self.assertEqual(result.get('normalStop'), stop)
        self.assertNotIn('probeExitCode', previous, 'reducer must not rewrite old evidence')

    def test_C04_unknown_probe_exit_never_inferred_from_scoped_pass_or_clean_stop(self):
        result = SUBJECT.finish_result(previous={'status': 'FAIL', 'passed': False,
                                                 'error': 'observer failed',
                                                 'ownershipObservationComplete': False},
                                       probe_exit_code=None, scoped_probe={'passed': True},
                                       normal_stop={'passed': True, 'cleanSnapshots': 2})
        self.assertIsNone(result.get('probeExitCode'))
        self.assertIs(result.get('passed'), False)
        self.assertEqual(result.get('status'), 'FAIL')


if __name__ == '__main__':
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--subject', choices=('legacy-reference', 'candidate'), default='legacy-reference')
    options, unittest_options = parser.parse_known_args()
    SUBJECT = load_subject(options.subject)
    print('QA PURE MODEL ONLY; subject=' + options.subject + '; OS/product execution=false; admission=false', flush=True)
    unittest.main(argv=[sys.argv[0], '-v'] + unittest_options)
