"""Two supplementary pure-model cases; frozen original 19 run unchanged.

No OS/API, process, product, worker or actual UI is invoked. The SHA-pinned
original harness supplies its existing FakeKernel and real pure proof. This
file adds only the metadata consistency boundary and a literal offset control.
The fixed candidate must still compare known kernel identities exactly; the
CIM microsecond quotient is an auxiliary source check, never identity equality.

Root entry (expected initial candidate RED is 20 pass / 1 assertion failure):
  C:/Python314/python.exe -I -B -X utf8 audit-tools/ui-observer-source-consistency-test.py
Actual counts/failure types must be read from Root's run, not this prediction.
"""

import hashlib
from pathlib import Path
import sys
import types
import unittest


ROOT = Path(__file__).resolve().parents[1]
HARNESS = ROOT / 'audit-tools' / 'ui-observer-model-red-test.py'
HARNESS_SHA = '6545e5d39c97cb9ff311ae8e55d802846335f916dad5aba7e85d7fceae515ee1'
COMMON = None


def load_frozen_harness():
    source = HARNESS.read_bytes()
    if hashlib.sha256(source).hexdigest() != HARNESS_SHA:
        raise RuntimeError('Infrastructure: frozen original 19-case harness SHA mismatch')
    module = types.ModuleType('qa_frozen_ui_observer_contract')
    module.__file__ = str(HARNESS)
    exec(compile(source, str(HARNESS), 'exec'), module.__dict__)
    module.SUBJECT = module.load_subject('candidate')
    return module


class SourceConsistency(unittest.TestCase):
    def test_S01_stable_child_cim_microsecond_must_correspond_to_kernel_quotient(self):
        kernel, inventory, observer, _ = COMMON.ObserverContract.fixture(self)
        # Parent=17 ticks. Child=37 ticks belongs to microsecond3, whereas the
        # two stable, self-consistent CIM fields describe microsecond2.
        # Kernel order is valid; this must fail for the source mismatch itself.
        kernel.register(200, 37, COMMON.CHILD_IMAGE)
        inventory.rows.append(COMMON.row(200, COMMON.ROOT_PID,
                                        coarse='0000020', image=COMMON.CHILD_IMAGE))
        with self.assertRaises(RuntimeError):
            observer.sample()

    def test_S02_legitimate_dmtf_offsets_keep_kernel_ticks_exact(self):
        root = COMMON.row()
        # 01:00 at UTC+60min is the FILETIME epoch, plus1microsecond.
        root['CimCreationRaw'] = '16010101010000.000001+060'
        kernel, inventory, observer, _ = COMMON.ObserverContract.fixture(self, root_row=root)
        kernel.register(200, 27, COMMON.CHILD_IMAGE)
        child = COMMON.row(200, COMMON.ROOT_PID, coarse='0000020', image=COMMON.CHILD_IMAGE)
        # 23:00 on the previous day at UTC-60min is the epoch, plus2microseconds.
        child['CimCreationRaw'] = '16001231230000.000002-060'
        inventory.rows.append(child)
        alive = observer.sample()
        self.assertEqual([value['ProcessId'] for value in alive], [COMMON.ROOT_PID, 200])
        self.assertEqual(observer.history[0]['KernelCreationFileTime'], '17')
        self.assertEqual(observer.history[0]['CreationUtc'], '1601-01-01T00:00:00.0000017Z')
        self.assertEqual(observer.history[0]['CimCreationRaw'], '16010101010000.000001+060')
        self.assertEqual(observer.history[1]['KernelCreationFileTime'], '27')
        self.assertEqual(observer.history[1]['CreationUtc'], '1601-01-01T00:00:00.0000027Z')
        self.assertEqual(observer.history[1]['CimCreationRaw'], '16001231230000.000002-060')
        self.assertTrue(all(value['IdentitySource'] == 'kernel-process-handle' for value in alive))


if __name__ == '__main__':
    COMMON = load_frozen_harness()
    suite = unittest.TestSuite([
        unittest.defaultTestLoader.loadTestsFromModule(COMMON),
        unittest.defaultTestLoader.loadTestsFromTestCase(SourceConsistency),
    ])
    print('QA PURE MODEL ONLY; subject=candidate; original=19 unchanged; supplementary=2; admission=false', flush=True)
    result = unittest.TextTestRunner(verbosity=2).run(suite)
    sys.exit(0 if result.wasSuccessful() else 1)
