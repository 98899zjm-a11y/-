"""Unit tests of the launcher decision, no production filesystem operations."""
import importlib.util
from pathlib import Path
import unittest
from unittest.mock import patch
import uuid

ROOT = Path(__file__).resolve().parent.parent
spec = importlib.util.spec_from_file_location('os_access_launcher', ROOT / 'stage1/run-restricted.py')
launcher = importlib.util.module_from_spec(spec)
spec.loader.exec_module(launcher)

class AccessGate(unittest.TestCase):
    def test_read_grant_refuses_start_even_when_writes_are_denied(self):
        with self.assertRaisesRegex(RuntimeError, 'read permission'):
            launcher.require_production_denial([{'readAllowed': True, 'writeAllowed': False}])

    def test_write_grant_refuses_start_even_when_reads_are_denied(self):
        with self.assertRaisesRegex(RuntimeError, 'write permission'):
            launcher.require_production_denial([{'readAllowed': False, 'writeAllowed': True}])

    def test_absent_or_incomplete_proof_refuses_start(self):
        for rows in ([], [{}], [{'readAllowed': False}], [{'readAllowed': None, 'writeAllowed': False}]):
            with self.subTest(rows=rows), self.assertRaisesRegex(RuntimeError, 'proof'):
                launcher.require_production_denial(rows)

    def test_complete_denial_allows_next_preflight_step(self):
        launcher.require_production_denial([{'readAllowed': False, 'writeAllowed': False}])

    def fixture(self):
        folder = ROOT / 'data' / ('os-scan-' + str(uuid.uuid4()))
        launcher.assert_owned(folder).mkdir(parents=True)
        paths = [folder / name for name in ('sales.sqlite', 'ledger.db', 'stockcheck.db')]
        for p in paths:
            launcher.assert_owned(p).write_text('synthetic metadata fixture', encoding='utf-8')
        return folder, paths

    def test_scan_error_is_not_silently_ignored(self):
        folder, required = self.fixture()
        def failed_walk(path, *, followlinks, onerror):
            onerror(PermissionError('synthetic scan denied'))
            return iter(())
        with patch.object(launcher.os, 'walk', side_effect=failed_walk):
            with self.assertRaisesRegex(RuntimeError, 'scan'):
                launcher.scan_formal_objects([folder], required)

    def test_missing_required_database_refuses_proof(self):
        folder, required = self.fixture()
        with self.assertRaisesRegex(RuntimeError, 'required'):
            launcher.scan_formal_objects([folder], required + [folder / 'missing.sqlite'])

    def test_walk_omission_cannot_hide_a_required_database(self):
        folder, required = self.fixture()
        with patch.object(launcher.os, 'walk', return_value=iter([(str(folder), [], ['sales.sqlite', 'ledger.db'])])):
            with self.assertRaisesRegex(RuntimeError, 'required'):
                launcher.scan_formal_objects([folder], required)

    def test_complete_synthetic_scan_contains_each_required_database(self):
        folder, required = self.fixture()
        found = launcher.scan_formal_objects([folder], required)
        self.assertTrue(set(required).issubset(set(found)))
        self.assertIn(folder, found)

if __name__ == '__main__':
    unittest.main()
