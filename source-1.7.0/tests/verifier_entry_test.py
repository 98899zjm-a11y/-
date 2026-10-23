"""The PowerShell verifier must not lose Python string quotes on Windows 5.1."""
import pathlib
import subprocess
import sys
import unittest

ROOT = pathlib.Path(__file__).resolve().parent.parent

class VerifierEntry(unittest.TestCase):
    def test_verifier_uses_a_file_instead_of_shell_quoted_python_source(self):
        source=(ROOT/'stage1/verify-all.ps1').read_text('utf-8-sig')
        self.assertIn('stage1/validate-sandbox-context.py',source)
        self.assertNotIn('spec_from_file_location("guest_context"',source)

    def test_host_context_validation_refuses_without_business_mutation(self):
        script=ROOT/'stage1/validate-sandbox-context.py'
        self.assertTrue(script.is_file(),'Sandbox admission entry script missing')
        if ROOT==pathlib.Path('C:/xjy-work/xjy-web-stage1'):
            self.skipTest('Host rejection is verified on physical host')
        proof=ROOT/'reports/restricted-token-check.json'
        before=proof.read_bytes()
        result=subprocess.run([sys.executable,'-I','-B',str(script)],capture_output=True,text=True,timeout=25)
        self.assertNotEqual(result.returncode,0)
        self.assertIn('Sandbox',result.stderr)
        self.assertEqual(proof.read_bytes(),before)

if __name__=='__main__':
    unittest.main()
