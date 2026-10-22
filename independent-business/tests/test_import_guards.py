"""Real fresh-interpreter negative controls for the fixed vendor loader."""
import os
from pathlib import Path
import subprocess
import sys
import unittest

BASE = Path(__file__).absolute().parent.parent


class ImportGuards(unittest.TestCase):
    def invoke(self, code):
        environment = dict(os.environ, PYTHONDONTWRITEBYTECODE='1', PYTHONIOENCODING='utf-8',
                           TEMP=str(BASE / 'runtime-temp'), TMP=str(BASE / 'runtime-temp'))
        return subprocess.run([sys.executable, '-B', '-c', code], cwd=BASE, env=environment,
                              capture_output=True, text=True, encoding='utf-8', timeout=15)

    def test_unapproved_legacy_module_is_rejected(self):
        result = self.invoke('from host import compat; compat.install(); import erp_unapproved')
        self.assertNotEqual(result.returncode, 0)
        self.assertIn('Unapproved legacy module', result.stderr)

    def test_preloaded_app_name_is_rejected(self):
        result = self.invoke("import sys,types; from host import compat; sys.modules['app']=types.ModuleType('app'); compat.install()")
        self.assertNotEqual(result.returncode, 0)
        self.assertIn('Legacy names are already imported', result.stderr)


if __name__ == '__main__':
    unittest.main(verbosity=2)
