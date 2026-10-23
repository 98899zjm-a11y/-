"""SOURCE_ONLY supplemental pure cases; Root reviews/runs, no native or UI.

The frozen39ab prelude supplies FakeKernel/collector, real pinned b06 proof and
the reviewed4c6 pure candidate. Original26/old21/source are not edited. These
are coverage for the new parent-exit rule, not claimed prior business RED.
No Popen/OS adapter/worker/business module is imported or executed.
"""

import hashlib
import json
from pathlib import Path
import sys
import types
import unittest


ROOT = Path(__file__).resolve().parents[1]
PRELUDE = ROOT / 'audit-tools/ui-observer-v2-test.py'
PRELUDE_SHA = '39ab3963741b26c4bb523ec42b86cdc16d9e4f699ce911238864408973a9daa7'
CANDIDATE_SHA = '4c6e2cf4c6ff754b4631d9c49c2b568fe7f84ae8a3efef2cb5f31acf9623d131'
COMMON = None


def load_frozen_prelude():
    body = PRELUDE.read_bytes()
    if hashlib.sha256(body).hexdigest() != PRELUDE_SHA:
        raise RuntimeError('Infrastructure: frozen26 prelude SHA mismatch')
    module = types.ModuleType('qa_frozen_v2_parent_contract')
    module.__file__ = str(PRELUDE)
    exec(compile(body, str(PRELUDE), 'exec'), module.__dict__)
    module.PROOF_UPDATE = module.load_pure(module.PROOF, module.PROOF_SHA).update_owned
    module.SUBJECT = module.load_subject('candidate', CANDIDATE_SHA)
    return module


class ParentExitContract(unittest.TestCase):
    def test_P01_unknown_child_after_confirmed_parent_exit_is_refused_without_new_open(self):
        kernel, frames, observer, borrowed = COMMON.ContractBase.fixture(self)
        COMMON.ContractBase.accepted(self, observer)
        kernel.retire(COMMON.ROOT_PID, code=0)
        frames.rows = []
        ended = COMMON.ContractBase.accepted(self, observer, 'confirmed parent exit before new child')
        self.assertEqual(ended['verifiedLive'], [])
        self.assertEqual(observer.history[0]['KernelCreationFileTime'], '17')
        kernel.register(COMMON.CHILD_PID, 27, COMMON.CHILD_IMAGE)
        frames.rows = [COMMON.source_row(COMMON.CHILD_PID, COMMON.ROOT_PID,
                                        raw='16010101000000.000002+000', image=COMMON.CHILD_IMAGE)]
        opens = len(kernel.opens)
        COMMON.ContractBase.rejected(self, observer)
        self.assertEqual(len(kernel.opens), opens, 'historical ParentPID does not authorize a new handle')
        self.assertEqual([row['ProcessId'] for row in observer.history], [100])
        self.assertNotIn(borrowed, kernel.closed)

    def test_P02_already_pinned_child_can_outlive_parent_then_exit_normally(self):
        kernel, frames, observer, borrowed = COMMON.ContractBase.fixture(self)
        COMMON.ContractBase.add_child(self, kernel, frames)
        initial = COMMON.ContractBase.accepted(self, observer)
        self.assertEqual([row['pid'] for row in initial['verifiedLive']], [100, 200])
        opens = len(kernel.opens)
        kernel.retire(COMMON.ROOT_PID, code=0)
        frames.rows = [COMMON.source_row(COMMON.CHILD_PID, COMMON.ROOT_PID,
                                        raw='16010101000000.000002+000', image=COMMON.CHILD_IMAGE)]
        child_live = COMMON.ContractBase.accepted(self, observer, 'already pinned child after parent exit')
        self.assertEqual([row['pid'] for row in child_live['verifiedLive']], [200])
        self.assertEqual(child_live['verifiedLive'][0]['creationFileTime'], '27')
        self.assertEqual([row['KernelCreationFileTime'] for row in observer.history], ['17', '27'])
        self.assertEqual(len(kernel.opens), opens, 'known child keeps its original retained token')
        kernel.retire(COMMON.CHILD_PID, code=0)
        frames.rows = []
        all_ended = COMMON.ContractBase.accepted(self, observer, 'normal retained child exit')
        self.assertEqual(all_ended['verifiedLive'], [])
        self.assertEqual([row['ProcessId'] for row in observer.history], [100, 200])
        self.assertEqual(len(kernel.opens), opens)
        self.assertEqual(len(kernel.active_owned()), 1, 'exited child remains accounted until close')
        observer.close()
        self.assertEqual(kernel.active_owned(), [])
        self.assertNotIn(borrowed, kernel.closed)


def main():
    global COMMON
    try:
        if not sys.flags.isolated or not sys.flags.dont_write_bytecode:
            raise RuntimeError('Infrastructure: Root pure entry requires -I -B')
        COMMON = load_frozen_prelude()
    except Exception as error:
        print(json.dumps({'scope': 'pure-DI-parent-supplement', 'outcome': 'INFRASTRUCTURE_OR_FEATURE_MISSING',
                          'testsRun': 0, 'businessBugClaimed': False, 'reason': str(error)}), file=sys.stderr, flush=True)
        return 2
    suite = unittest.defaultTestLoader.loadTestsFromTestCase(ParentExitContract)
    result = unittest.TextTestRunner(verbosity=2).run(suite)
    print(json.dumps({'scope': 'pure-DI-parent-supplement', 'testsRun': result.testsRun,
                      'failures': len(result.failures), 'errors': len(result.errors),
                      'businessBugClaimed': False, 'nativeOrUiQualified': False}), flush=True)
    return 2 if result.errors else 0 if result.wasSuccessful() else 1


if __name__ == '__main__':
    raise SystemExit(main())
