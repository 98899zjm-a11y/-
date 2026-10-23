"""SOURCE_ONLY: four pure late-root GUI binding cases; Root reviews/runs.

No OS/native/Popen/worker/product/owner import or invocation. Acquisition is
the frozen39ab FakeKernel/FakeCollector. Original28 assertions are reused as
class definitions, unchanged. A missing new API/controller is FEATURE_MISSING,
not business RED/PASS. No replacement observer/controller is implemented here.
"""

import argparse
import ast
import copy
import hashlib
import json
from pathlib import Path
import re
import stat
import sys
import types
import unittest


ROOT = Path(__file__).resolve().parents[1]
PRELUDE = 'audit-tools/ui-observer-v2-test.py'
PRELUDE_SHA = '39ab3963741b26c4bb523ec42b86cdc16d9e4f699ce911238864408973a9daa7'
PARENTS = 'audit-tools/ui-observer-v2-parent-exit-test.py'
PARENTS_SHA = 'aca917990ec7305f3bb3c92c3ea0d5d656f0449d73d10eeee0b13863cf100630'
FROZEN = 'audit-tools/ui-observer-v2.py'
FROZEN_SHA = '4c6e2cf4c6ff754b4631d9c49c2b568fe7f84ae8a3efef2cb5f31acf9623d131'
CANDIDATE = 'audit-tools/ui-observer-gui.py'
CONTROLLER = 'audit-tools/observer-ui-driver.py'
COMMON = SUBJECT = PARENT_CASES = None
CONTROLLER_SHA = None


class FeatureMissing(unittest.SkipTest):
    """Explicitly missing new feature; runner must return2, never green."""


def checked_body(relative, expected):
    if not isinstance(expected, str) or re.fullmatch('[0-9a-f]{64}', expected) is None:
        raise FeatureMissing('FEATURE_MISSING: separate Root-reviewed SHA required: ' + relative)
    file = ROOT / relative
    try:
        before = file.lstat()
    except FileNotFoundError:
        raise FeatureMissing('FEATURE_MISSING: source not implemented: ' + relative)
    for part in (file, *file.parents):
        info = part.lstat()
        if stat.S_ISLNK(info.st_mode) or getattr(info, 'st_file_attributes', 0) & 0x400:
            raise RuntimeError('Infrastructure: pure source link refused')
        if part == ROOT:
            break
    if not stat.S_ISREG(before.st_mode) or before.st_nlink != 1 or before.st_size > 8 * 1024 * 1024:
        raise RuntimeError('Infrastructure: bounded ordinary source required')
    with file.open('rb') as stream:
        body = stream.read(8 * 1024 * 1024 + 1)
    key = lambda value: (value.st_dev, value.st_ino, value.st_size, value.st_mtime_ns, value.st_ctime_ns, value.st_nlink)
    if len(body) != before.st_size or key(before) != key(file.lstat()) or hashlib.sha256(body).hexdigest() != expected:
        raise RuntimeError('Infrastructure: frozen source changed: ' + relative)
    return body


def load_frozen(relative, expected, name):
    body = checked_body(relative, expected)
    module = types.ModuleType(name)
    module.__file__ = str(ROOT / relative)
    exec(compile(body, str(ROOT / relative), 'exec'), module.__dict__)
    return module


def controller_function(name):
    # Whole-file pin first; compile only these actual pure function definitions,
    # never import/execute the OS driver or fabricate a policy in this fixture.
    body = checked_body(CONTROLLER, CONTROLLER_SHA)
    tree = ast.parse(body, filename=CONTROLLER)
    selected = [node for node in tree.body if isinstance(node, ast.FunctionDef) and node.name == name]
    if len(selected) != 1:
        raise FeatureMissing('FEATURE_MISSING: actual controller function: ' + name)
    function = selected[0]
    if function.decorator_list or function.args.defaults or any(item is not None for item in function.args.kw_defaults):
        raise RuntimeError('Infrastructure: pure controller definition must have no decorators/default evaluation')
    if any(isinstance(node, (ast.Import, ast.ImportFrom, ast.Global, ast.Nonlocal)) for node in ast.walk(function)):
        raise RuntimeError('Infrastructure: controller function is not standalone pure DI')
    for node in ast.walk(function):
        if isinstance(node, ast.Call) and isinstance(node.func, ast.Name) and node.func.id in {'open', 'exec', 'eval', 'compile', '__import__'}:
            raise RuntimeError('Infrastructure: controller function has forbidden direct effect')
    namespace = {}
    exec(compile(ast.Module(body=selected, type_ignores=[]), CONTROLLER + ':pure-definition', 'exec'), namespace)
    return namespace[name]  # Supplemental AST restriction is not a Python security sandbox.


class GuiContract(unittest.TestCase):
    def fixture(self, limit=64):
        return COMMON.ContractBase.fixture(self, limit=limit)

    def accepted(self, observer):
        return COMMON.ContractBase.accepted(self, observer)

    def register(self, observer):
        method = getattr(observer, 'register_root', None)
        if not callable(method):
            raise FeatureMissing('FEATURE_MISSING: register_root(role, capture_root) on actual subject')
        return method

    def callback(self, kernel, frames, captures, *, pid=300, token=None, extra_child=False):
        def capture():
            captures.append(pid)
            if token is not None:
                return token
            if pid == 300:
                kernel.register(pid, 37, COMMON.ROOT_IMAGE)
                frames.rows.append(COMMON.source_row(pid, 999, raw='16010101000000.000003+000'))
            if extra_child:
                kernel.register(201, 29, COMMON.CHILD_IMAGE)
                frames.rows.append(COMMON.source_row(201, 100, raw='16010101000000.000002+000', image=COMMON.CHILD_IMAGE))
            return kernel.capture(pid)
        return capture

    def test_G1_real_late_root_receipt_preserves_full_identity_and_existing_forest(self):
        kernel, frames, observer, native = self.fixture()
        self.accepted(observer)
        register = self.register(observer)
        captures = []
        receipt = register(role='probe', capture_root=self.callback(kernel, frames, captures))
        self.assertEqual(receipt, {'role': 'probe', 'pid': 300, 'creationFileTime': '37', 'sequence': 2})
        self.assertEqual(captures, [300])
        self.assertEqual({row['ProcessId'] for row in observer.history}, {100, 300})
        self.assertEqual({row['KernelCreationFileTime'] for row in observer.history}, {'17', '37'})
        self.assertEqual([event['sequence'] for event in frames.events if event['operation'] == 'frame'], [1, 2])
        later = self.accepted(observer)
        self.assertEqual(later['sequence'], 3)
        self.assertEqual({row['pid'] for row in later['verifiedLive']}, {100, 300})
        self.assertEqual(kernel.opens, [], 'borrowed roots never become OpenPID candidates')
        observer.close()
        self.assertEqual(kernel.closed, [])
        self.assertNotIn(native, kernel.closed)

    def test_G2_whole_frames_share_sequence_pending_reservation_and_ended_budget(self):
        for limit in (4, 3):
            with self.subTest(limit=limit):
                kernel, frames, observer, native = self.fixture(limit)
                register = self.register(observer)
                COMMON.ContractBase.add_child(self, kernel, frames)
                initial = self.accepted(observer)
                self.assertEqual({row['ProcessId'] for row in initial['history']}, {100, 200}, 'first complete frame is not root-only')
                self.assertEqual(initial['sequence'], 2)
                captures, opens = [], len(kernel.opens)
                action = self.callback(kernel, frames, captures, extra_child=True)
                if limit == 3:
                    with self.assertRaises(RuntimeError):
                        register(role='probe', capture_root=action)
                    self.assertEqual(captures, [300])
                    self.assertEqual(len(kernel.opens), opens, 'root reservation prevents pending child opening beyond the shared budget')
                    self.assertEqual({row['ProcessId'] for row in observer.history}, {100, 200})
                    self.assertIsInstance(observer.failure, dict)
                    held_probe = [token for token, item in kernel.records.items() if item['borrowed'] and item['object']['pid'] == 300]
                    self.assertEqual(len(held_probe), 1)
                    observer.close()
                    self.assertNotIn(held_probe[0], kernel.closed)
                    continue
                receipt = register(role='probe', capture_root=action)
                self.assertEqual(captures, [300])
                self.assertEqual(receipt['sequence'], 4)
                self.assertEqual({row['ProcessId'] for row in observer.history}, {100, 200, 201, 300})
                self.assertEqual(kernel.opens[-1]['pid'], 201)
                self.assertEqual(kernel.opens[-1]['sequence'], 3)
                self.assertEqual([event['sequence'] for event in frames.events if event['operation'] == 'frame'], [1, 2, 3, 4])
                kernel.retire(200)
                frames.rows = [row for row in frames.rows if row['processId'] != 200]
                self.accepted(observer)
                reads, opens = frames.calls, len(kernel.opens)
                denied = []
                with self.assertRaises(RuntimeError):
                    register(role='normal-exit', capture_root=lambda: denied.append('must not launch'))
                self.assertEqual(denied, [])
                self.assertEqual((frames.calls, len(kernel.opens)), (reads, opens))
                self.assertEqual(len(observer.history), 4, 'ended child keeps its identity budget')
                first = copy.deepcopy(observer.failure)
                with self.assertRaises(RuntimeError):
                    observer.sample()
                self.assertEqual(observer.failure['code'], first['code'])
                self.assertNotIn(native, kernel.closed)
        for forced in (1, 3):
            with self.subTest(registration_sequence=forced):
                kernel, frames, observer, _ = self.fixture()
                self.accepted(observer)
                register = self.register(observer)
                frames.forced_sequence = forced  # Last consumed1: replay1 / skip3.
                captures = []
                with self.assertRaises(RuntimeError):
                    register(role='probe', capture_root=self.callback(kernel, frames, captures))
                self.assertEqual(captures, [300])
                self.assertEqual(kernel.opens, [])
                self.assertEqual([row['ProcessId'] for row in observer.history], [100])
                self.assertIsInstance(observer.failure, dict)

    def test_G3_actual_controller_runs_gate_only_after_live_receipt_and_refuses_unproved_roots(self):
        admit = controller_function('admit_gated_root')
        for variant in ('valid', 'duplicate-role', 'duplicate-token', 'duplicate-pid', 'exited',
                        'tick-drift', 'image-drift', 'wrong-source', 'exited-parent-child'):
            with self.subTest(variant=variant):
                kernel, frames, observer, native = self.fixture()
                self.accepted(observer)
                self.register(observer)
                captures, gates = [], []
                role = 'native' if variant == 'duplicate-role' else 'probe'
                action = self.callback(kernel, frames, captures, pid=100 if variant == 'duplicate-pid' else 300,
                                       token=native if variant == 'duplicate-token' else None)
                if variant == 'exited':
                    def retire_new_root():
                        kernel.retire(300)
                        frames.rows = [row for row in frames.rows if row['processId'] != 300]
                    frames.after_read = retire_new_root
                if variant in ('tick-drift', 'image-drift'):
                    def contradict_held_observation():
                        # Adversarial DI port contradiction, not a real Windows
                        # claim that an opaque held object changes birth time.
                        kernel.current[300]['ticks' if variant == 'tick-drift' else 'image'] = (
                            38 if variant == 'tick-drift' else r'C:\Synthetic\changed.exe')
                    frames.after_read = contradict_held_observation
                if variant == 'wrong-source':
                    original_capture = action
                    def capture_with_bad_source():
                        token = original_capture()
                        next(row for row in frames.rows if row['processId'] == 300)['cimCreationDmtfRaw'] = '16010101000000.000002+000'
                        return token
                    action = capture_with_bad_source
                if variant == 'exited-parent-child':
                    kernel.retire(100)
                    frames.rows = []
                    self.accepted(observer)
                    kernel.register(200, 27, COMMON.CHILD_IMAGE)
                    frames.rows.append(COMMON.source_row(200, 100, raw='16010101000000.000002+000', image=COMMON.CHILD_IMAGE))
                def send_gate(line):
                    self.assertEqual(line, b'RUN\n')
                    self.assertIsNone(observer.failure)
                    self.assertIn(300, {row['ProcessId'] for row in observer.history}, 'commit must precede RUN')
                    gates.append(line)
                if variant == 'valid':
                    receipt = admit(observer, role, action, send_gate)
                    self.assertEqual(receipt['pid'], 300)
                    self.assertEqual(gates, [b'RUN\n'])
                else:
                    opens = len(kernel.opens)
                    with self.assertRaises(RuntimeError):
                        admit(observer, role, action, send_gate)
                    self.assertEqual(gates, [])
                    self.assertEqual(len(kernel.opens), opens)
                    self.assertIsInstance(observer.failure, dict)
                    if variant == 'duplicate-role':
                        self.assertEqual(captures, [])
                self.assertNotIn(native, kernel.closed)

    def test_G4_actual_source_failure_keeps_real_exit_or_unknown_and_first_fail(self):
        collect = controller_function('collect_probe_fact')
        _, frames, observer, _ = self.fixture()
        self.accepted(observer)
        frames.forced_sequence = frames.sequence + 2
        with self.assertRaises(RuntimeError):
            observer.sample()
        first = copy.deepcopy(observer.failure)
        for outcome, code in (('captured-exit', 0), ('captured-exit', 7), ('still-running', None), ('read-error', None)):
            with self.subTest(outcome=outcome, code=code):
                calls = []
                def read_exit():
                    calls.append('actual injected capture read')
                    if outcome == 'read-error':
                        raise RuntimeError(COMMON.SECRET)
                    return code
                fact = collect(read_exit)
                expected = {'probeExitCode': code, 'probeExitObservation': outcome}
                if outcome == 'read-error':
                    expected['probeExitError'] = 'RuntimeError'
                self.assertEqual(fact, expected)
                self.assertEqual(calls, ['actual injected capture read'])
                self.assertNotIn(COMMON.SECRET, json.dumps(fact))
                previous = {'status': 'FAIL', 'passed': False, 'error': first['code'],
                            'ownershipObservationComplete': False, **fact}
                result = SUBJECT.finish_result_v2(previous=previous, probe_exit_code=fact['probeExitCode'],
                    scoped_probe={'passed': True, 'pages': 33}, normal_stop={'passed': True}, ownership_complete=False)
                self.assertEqual(result['probeExitCode'], code)
                self.assertEqual(result['probeExitObservation'], outcome)
                self.assertEqual(result['error'], first['code'])
                self.assertEqual(result['status'], 'FAIL')
                self.assertIs(result['passed'], False)


def main():
    global COMMON, SUBJECT, PARENT_CASES, CONTROLLER_SHA
    parser = argparse.ArgumentParser(description=__doc__, allow_abbrev=False)
    parser.add_argument('--subject', choices=('frozen', 'candidate'), default='frozen')
    parser.add_argument('--suite', choices=('regression', 'contract'), default='regression')
    parser.add_argument('--candidate-sha256')
    parser.add_argument('--controller-sha256')
    args = parser.parse_args()
    try:
        if not sys.flags.isolated or not sys.flags.dont_write_bytecode:
            raise RuntimeError('Infrastructure: pure entry requires -I -B')
        COMMON = load_frozen(PRELUDE, PRELUDE_SHA, 'qa_gui_frozen_prelude')
        COMMON.PROOF_UPDATE = COMMON.load_pure(COMMON.PROOF, COMMON.PROOF_SHA).update_owned
        if args.subject == 'candidate' and not re.fullmatch('[0-9a-f]{64}', args.candidate_sha256 or ''):
            raise FeatureMissing('FEATURE_MISSING: new pure subject SHA required')
        SUBJECT = COMMON.load_pure(FROZEN if args.subject == 'frozen' else CANDIDATE,
                                  FROZEN_SHA if args.subject == 'frozen' else args.candidate_sha256)
        COMMON.SUBJECT = SUBJECT
        PARENT_CASES = load_frozen(PARENTS, PARENTS_SHA, 'qa_gui_frozen_parent_cases')
        PARENT_CASES.COMMON = COMMON
        CONTROLLER_SHA = args.controller_sha256
    except Exception as caught:
        missing = isinstance(caught, (FeatureMissing,)) or (COMMON is not None and isinstance(caught, COMMON.FeatureMissing))
        print(json.dumps({'scope': 'pure-GUI-binding-only', 'outcome': 'FEATURE_MISSING' if missing else 'INFRASTRUCTURE_ERROR',
                          'testsRun': 0, 'businessBugClaimed': False, 'reason': str(caught)}), flush=True)
        return 2
    cases = (COMMON.BaselineSmoke, COMMON.V2Contract, PARENT_CASES.ParentExitContract) if args.suite == 'regression' else (GuiContract,)
    suite = unittest.TestSuite(unittest.defaultTestLoader.loadTestsFromTestCase(case) for case in cases)
    expected_count = 28 if args.suite == 'regression' else 4
    if suite.countTestCases() != expected_count:
        raise RuntimeError('Infrastructure: frozen case registration count changed')
    result = unittest.TextTestRunner(verbosity=2).run(suite)
    missing = len(result.skipped)
    outcome = ('INVALID_TEST_OR_INFRASTRUCTURE' if result.errors else 'CONTRACT_ASSERTION_FAILURE' if result.failures
               else 'FEATURE_MISSING' if missing else 'PASS')
    print(json.dumps({'scope': 'pure-GUI-binding-only', 'subject': args.subject, 'suite': args.suite,
                      'outcome': outcome, 'testsRun': result.testsRun, 'featureMissing': missing,
                      'failures': len(result.failures), 'errors': len(result.errors),
                      'nativeOrBusinessExecution': False, 'businessBugClaimed': False, 'guiQualified': False}), flush=True)
    return 2 if result.errors or missing else 1 if result.failures else 0


if __name__ == '__main__':
    raise SystemExit(main())
