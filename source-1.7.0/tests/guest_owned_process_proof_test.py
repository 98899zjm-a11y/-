"""Pure CIM snapshot fixtures: no process, file mutation or business launch."""
from pathlib import Path
import copy
import importlib.util
import unittest

FILE = Path(__file__).resolve().parent.parent / 'stage1/guest-owned-process-proof.py'


def row(pid, parent, second, **extra):
    return {'ProcessId': pid, 'ParentProcessId': parent,
            'CreationUtc': f'2026-10-15T00:00:{second:02d}.0000000Z',
            'Name': 'same-branded-name.exe', 'ExecutablePath': 'C:/owned/same.exe',
            **extra}


class OwnedProcessProof(unittest.TestCase):
    def proof(self):
        self.assertTrue(FILE.is_file(), 'Pure owned process proof module is missing')
        spec = importlib.util.spec_from_file_location('owned_process_proof', FILE)
        module = importlib.util.module_from_spec(spec)
        spec.loader.exec_module(module)
        return module

    def test_new_child_and_grandchild_during_close_remain_alive(self):
        proof = self.proof()
        root, old = row(10, 1, 0), row(20, 10, 1)
        known, alive = proof.update_owned([root, old], [row(40, 30, 4), row(30, 20, 3), old, root])
        self.assertEqual({x['ProcessId'] for x in known}, {10, 20, 30, 40})
        self.assertEqual({x['ProcessId'] for x in alive}, {10, 20, 30, 40})

    def test_root_already_exited_does_not_hide_new_orphan(self):
        proof = self.proof()
        known, alive = proof.update_owned([row(10, 1, 0)], [row(30, 10, 3), row(40, 30, 4)])
        self.assertEqual({x['ProcessId'] for x in known}, {10, 30, 40})
        self.assertEqual({x['ProcessId'] for x in alive}, {30, 40})

    def test_exited_known_child_still_anchors_new_orphan_grandchild(self):
        proof = self.proof()
        known, alive = proof.update_owned([row(10, 1, 0), row(20, 10, 1)], [row(30, 20, 3)])
        self.assertEqual({x['ProcessId'] for x in known}, {10, 20, 30})
        self.assertEqual([x['ProcessId'] for x in alive], [30])

    def test_incremental_snapshots_keep_new_identity_for_later_exit_checks(self):
        proof = self.proof()
        known, _ = proof.update_owned([row(10, 1, 0)], [row(20, 10, 1)])
        known, alive = proof.update_owned(known, [row(30, 20, 3)])
        self.assertEqual({x['ProcessId'] for x in known}, {10, 20, 30})
        self.assertEqual([x['ProcessId'] for x in alive], [30])
        known, alive = proof.update_owned(known, [])
        self.assertEqual({x['ProcessId'] for x in known}, {10, 20, 30})
        self.assertEqual(alive, [])

    def test_unrelated_same_executable_and_older_system_rows_are_not_owned(self):
        proof = self.proof()
        unrelated = row(99, 88, 0)
        system = {'ProcessId': 0, 'ParentProcessId': 0, 'CreationUtc': None, 'Name': 'System Idle Process'}
        known, alive = proof.update_owned([row(10, 1, 0)], [unrelated, system])
        self.assertEqual([x['ProcessId'] for x in known], [10])
        self.assertEqual(alive, [])

    def test_unrelated_idle_row_creation_is_not_an_owned_creation_requirement(self):
        proof = self.proof()
        known, alive = proof.update_owned([row(10, 1, 0)], [row(0, 0, 0)])
        self.assertEqual([x['ProcessId'] for x in known], [10])
        self.assertEqual(alive, [])

    def test_root_pid_reuse_is_ambiguous_even_if_new_child_looks_owned(self):
        proof = self.proof()
        with self.assertRaisesRegex(RuntimeError, 'reuse|identity|ambiguous'):
            proof.update_owned([row(10, 1, 0)], [row(10, 88, 5), row(30, 10, 6)])

    def test_known_child_pid_reuse_cannot_anchor_new_grandchild(self):
        proof = self.proof()
        with self.assertRaisesRegex(RuntimeError, 'reuse|identity|ambiguous'):
            proof.update_owned([row(10, 1, 0), row(20, 10, 1)], [row(20, 88, 5), row(30, 20, 6)])

    def test_child_older_than_pinned_parent_is_ambiguous_not_a_pass(self):
        proof = self.proof()
        with self.assertRaisesRegex(RuntimeError, 'creation|older|ambiguous'):
            proof.update_owned([row(10, 1, 5)], [row(30, 10, 3)])

    def test_tick_precision_cannot_round_older_child_into_owned_identity(self):
        proof = self.proof()
        root = row(10, 1, 0, CreationUtc='2026-10-15T00:00:00.0000002Z')
        child = row(20, 10, 0, CreationUtc='2026-10-15T00:00:00.0000001Z')
        with self.assertRaisesRegex(RuntimeError, 'creation|older|ambiguous'):
            proof.update_owned([root], [child])

    def test_missing_owned_child_creation_cannot_be_skipped(self):
        proof = self.proof()
        with self.assertRaisesRegex(RuntimeError, 'creation|identity|ambiguous'):
            proof.update_owned([row(10, 1, 0)], [row(20, 10, 1, CreationUtc=None)])

    def test_same_pid_creation_with_changed_parent_is_rejected(self):
        proof = self.proof()
        with self.assertRaisesRegex(RuntimeError, 'parent|identity|ambiguous'):
            proof.update_owned([row(10, 1, 0), row(20, 10, 1)], [row(20, 88, 1)])

    def test_duplicate_snapshot_pid_cannot_mask_identity_reuse(self):
        proof = self.proof()
        with self.assertRaisesRegex(RuntimeError, 'duplicate|ambiguous'):
            proof.update_owned([row(10, 1, 0)], [row(10, 1, 0), row(10, 88, 5)])

    def test_impossible_idle_pid_is_never_admitted_as_a_child(self):
        proof = self.proof()
        with self.assertRaises(RuntimeError):
            proof.update_owned([row(10, 1, 0)], [row(0, 10, 1)])

    def test_self_parented_pinned_identity_is_not_a_valid_root(self):
        proof = self.proof()
        with self.assertRaises(RuntimeError):
            proof.update_owned([row(10, 10, 0)], [])

    def test_pid_values_beyond_windows_uint32_are_not_process_identities(self):
        proof = self.proof()
        with self.assertRaises(RuntimeError):
            proof.update_owned([row(2**32, 1, 0)], [])

    def test_unpinned_empty_or_disconnected_known_history_is_rejected(self):
        proof = self.proof()
        for known in ([], [row(10, 1, 0), row(30, 88, 3)], [row(10, 1, 0), row(20, 30, 1), row(30, 20, 1)]):
            with self.subTest(known=known):
                with self.assertRaises(RuntimeError): proof.update_owned(known, [])

    def test_inputs_and_returned_identity_dicts_do_not_alias(self):
        proof = self.proof()
        known = [row(10, 1, 0)]
        rows = [row(20, 10, 1)]
        before = copy.deepcopy((known, rows))
        updated, alive = proof.update_owned(known, rows)
        self.assertEqual((known, rows), before)
        updated[0]['Name'] = 'changed output'
        alive[0]['Name'] = 'changed alive'
        self.assertEqual((known, rows), before)
        self.assertEqual(updated[1]['Name'], 'same-branded-name.exe')


if __name__ == '__main__': unittest.main()
