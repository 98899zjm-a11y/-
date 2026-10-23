"""Pure desktop helper transform tests; no Sandbox or business process."""
from pathlib import Path
import hashlib
import importlib.util
import unittest

ROOT=Path(__file__).resolve().parent.parent
FILE=ROOT/'stage1/prepare-desktop-guest-helper.py'


class DesktopHelper(unittest.TestCase):
    def module(self):
        self.assertTrue(FILE.is_file(),'Desktop-only helper source transformer absent')
        spec=importlib.util.spec_from_file_location('desktop_helper_transform',FILE)
        module=importlib.util.module_from_spec(spec);spec.loader.exec_module(module)
        return module

    def test_exact_full_snapshot_becomes_explicit_desktop_draft(self):
        tool=self.module();source=(ROOT/'sandbox/input/guest-bootstrap-v7.ps1').read_bytes();scope=(ROOT/'stage1/guest-result-scope-aggregation.ps1').read_bytes()
        result=tool.build_draft(source,scope)
        self.assertEqual((ROOT/'sandbox/input/guest-bootstrap-v7.ps1').read_bytes(),source)
        self.assertEqual(result.count('__V8_DESKTOP_MANIFEST_SHA256__'),1)
        self.assertEqual(result.count('__V8_DESKTOP_VERIFIER_SHA256__'),1)
        self.assertIn('sandbox-guest-candidate-driver.py --desktop-only',result)
        self.assertIn('Get-GuestScopedCandidateResultSummary -Scope desktop',result)
        self.assertIn('Get-GuestScopedAcceptanceResultSummary -Scope desktop',result)
        self.assertIn('$guestProof.expectedCandidateGroups=5',result)
        self.assertIn('$guestProof.fullAcceptancePassed=$false',result)
        self.assertIn(hashlib.sha256(scope).hexdigest(),result)
        self.assertNotIn('package-v7',result)
        self.assertIn('expectedExecutableChecks=20',result)
        self.assertIn('expectedGuestNotApplicableChecks=2',result)

    def test_changed_previous_snapshot_is_refused(self):
        tool=self.module()
        with self.assertRaisesRegex(RuntimeError,'sealed full-v7'):
            tool.build_draft((ROOT/'sandbox/input/guest-bootstrap-v7.ps1').read_bytes()+b'\n',(ROOT/'stage1/guest-result-scope-aggregation.ps1').read_bytes())

    def test_nonpure_scope_source_is_refused(self):
        tool=self.module()
        with self.assertRaisesRegex(RuntimeError,'pure scope'):
            tool.build_draft((ROOT/'sandbox/input/guest-bootstrap-v7.ps1').read_bytes(),(ROOT/'stage1/guest-result-scope-aggregation.ps1').read_bytes()+b'\nStart-Process something')


if __name__=='__main__':unittest.main()
