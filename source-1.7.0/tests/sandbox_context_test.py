"""Pure admission tests; no guest or production database operations."""
import importlib.util
from pathlib import Path
import subprocess
import sys
import unittest

ROOT = Path(__file__).resolve().parent.parent

class Context(unittest.TestCase):
    def load(self):
        spec = importlib.util.spec_from_file_location('sandbox_context', ROOT / 'stage1/sandbox-context.py')
        module = importlib.util.module_from_spec(spec)
        spec.loader.exec_module(module)
        return module

    def valid(self):
        return {'userName': 'GUEST\\WDAGUtilityAccount', 'model': 'Virtual Machine',
                'productionDrivePresent': False, 'nonLoopbackAddressCount': 0,
                'inputMarkerPresent': True}

    def test_only_sandbox_identity_and_fixed_guest_work_root_admit_guest_policy(self):
        self.load().validate_context(self.valid(), Path('C:/xjy-work/xjy-web-stage1'))
        with self.assertRaisesRegex(RuntimeError, 'Sandbox'):
            self.load().validate_context(self.valid(), Path('E:/not-the-guest/xjy-web-stage1'))

    def test_normal_host_identity_cannot_gain_guest_library_permissions(self):
        proof = self.valid() | {'userName': 'HOST\\Administrator'}
        with self.assertRaisesRegex(RuntimeError, 'Sandbox'):
            self.load().validate_context(proof, Path('C:/xjy-work/xjy-web-stage1'))

    def test_production_drive_network_or_missing_marker_refuse_guest_policy(self):
        for change in ({'productionDrivePresent': True}, {'nonLoopbackAddressCount': 1},
                       {'nonLoopbackAddressCount': -1}, {'inputMarkerPresent': False},
                       {'model': 'Physical PC'}, {'productionDrivePresent': None}):
            with self.subTest(change=change), self.assertRaisesRegex(RuntimeError, 'Sandbox'):
                self.load().validate_context(self.valid() | change, Path('C:/xjy-work/xjy-web-stage1'))

    def test_current_host_guest_flag_refuses_before_workspace_mutation(self):
        if ROOT == self.load().GUEST_ROOT:
            self.skipTest('Host flag refusal is verified on the host; this run is the real guest')
        tracked = ROOT / 'reports/restricted-token-check.json'
        before = tracked.read_bytes()
        result = subprocess.run([sys.executable, '-B', str(ROOT/'stage1/run-restricted.py'),
                                 '--sandbox-guest', '--check-only'], capture_output=True,
                                text=True, timeout=20, creationflags=0x08000000)
        self.assertNotEqual(result.returncode, 0)
        self.assertIn('Sandbox', result.stderr)
        self.assertEqual(tracked.read_bytes(), before)

if __name__ == '__main__':
    unittest.main()
