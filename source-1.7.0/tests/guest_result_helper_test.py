"""Pure helper-source transformation tests. No VM, business or EXE execution."""
from pathlib import Path
import hashlib
import importlib.util
import unittest

ROOT = Path(__file__).resolve().parent.parent
SOURCE = ROOT / 'sandbox/input/guest-bootstrap-v6.ps1'
MODULE = ROOT / 'stage1/guest-result-aggregation.ps1'
GENERATOR = ROOT / 'stage1/prepare-guest-result-helper.py'


class HelperTransformation(unittest.TestCase):
    def load(self):
        self.assertTrue(GENERATOR.is_file(), 'Strict v7 helper generator absent')
        spec = importlib.util.spec_from_file_location('strict_helper_generation', GENERATOR)
        module = importlib.util.module_from_spec(spec)
        spec.loader.exec_module(module)
        return module

    def test_pins_v6_source_and_leaves_only_v7_sealing_tokens(self):
        tool = self.load()
        before = SOURCE.read_bytes()
        result = tool.build_draft(before, MODULE.read_bytes())
        self.assertEqual(SOURCE.read_bytes(), before)
        self.assertEqual(result.count('__V7_MANIFEST_SHA256__'), 1)
        self.assertEqual(result.count('__V7_VERIFIER_SHA256__'), 1)
        self.assertIn('package-v7', result)
        self.assertIn('full-verify-v7', result)
        self.assertNotIn('package-v6', result)
        self.assertNotIn('@(Get-Content -LiteralPath $guestResultFile -Raw -Encoding UTF8 | ConvertFrom-Json)', result)
        self.assertIn('Get-GuestBaselineResultSummary -Json $guestBaselineJson -Process $guestSuite', result)
        self.assertIn('Get-GuestCandidateResultSummary -Json $guestCandidateJson -Process $guestCandidate', result)
        self.assertIn('Get-GuestAcceptanceResultSummary -Baseline $guestBaselineSummary -Candidate $guestCandidateSummary', result)
        self.assertIn("'stage1/guest-result-aggregation.ps1'", result)
        self.assertIn(hashlib.sha256(MODULE.read_bytes()).hexdigest(), result)

    def test_changed_sealed_v6_source_is_refused(self):
        tool = self.load()
        with self.assertRaisesRegex(RuntimeError, 'v6 source'):
            tool.build_draft(SOURCE.read_bytes() + b'\n# altered', MODULE.read_bytes())

    def test_module_with_io_or_process_code_is_refused(self):
        tool = self.load()
        for extra in (b'\nGet-Content C:/outside', b'\nStart-Process app.exe', b'\nSet-ExecutionPolicy Bypass'):
            with self.subTest(extra=extra):
                with self.assertRaisesRegex(RuntimeError, 'pure aggregation'):
                    tool.build_draft(SOURCE.read_bytes(), MODULE.read_bytes()+extra)

    def test_manifest_and_context_guards_remain_in_draft(self):
        tool = self.load()
        result = tool.build_draft(SOURCE.read_bytes(), MODULE.read_bytes())
        self.assertIn('09426dfd4d699c51570e1f1b10c2e37c00f6feb699b9a472ca710ae5242bf249', result)
        self.assertIn('Guest copy size/hash mismatch', result)
        self.assertIn('Unexpected or forced execution policy', result)
        self.assertIn('Duplicate test report', SOURCE.read_text('utf-8-sig'))
        self.assertIn('Duplicate baseline name:', result)
        for token in ('Set-ExecutionPolicy', 'Unblock-File', '.Kill()'):
            self.assertNotIn(token, result)


if __name__ == '__main__':
    unittest.main()
