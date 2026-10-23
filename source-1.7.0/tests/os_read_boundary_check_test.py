"""Check security descriptors only; never open a production file or database."""
import json
from pathlib import Path
import subprocess
import sys
import unittest

ROOT = Path(__file__).resolve().parent.parent

class OsReadBoundary(unittest.TestCase):
    def test_preflight_denies_production_reads_without_starting_business(self):
        result = subprocess.run(
            [sys.executable, '-B', str(ROOT / 'stage1/run-restricted.py'), '--check-only'],
            cwd=ROOT, capture_output=True, text=True, encoding='utf-8', timeout=60,
            creationflags=0x08000000,
        )
        self.assertEqual(result.returncode, 0, result.stderr)
        data = json.loads(result.stdout.strip())
        self.assertTrue(data['checkOnly'])
        self.assertTrue(data['formalReadsDenied'], 'OS token must deny production reads, not only writes')
        self.assertTrue(data['formalWritesDenied'])
        proof = json.loads((ROOT / 'reports/restricted-token-check.json').read_text('utf-8'))
        self.assertGreater(len(proof['checks']), 0)
        self.assertFalse(any(row['readAllowed'] or row['writeAllowed'] for row in proof['checks']))

if __name__ == '__main__':
    unittest.main()
