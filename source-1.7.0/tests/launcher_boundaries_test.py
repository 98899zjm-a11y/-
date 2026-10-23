import importlib.util
import os
from pathlib import Path
import unittest
ROOT = Path(__file__).resolve().parent.parent
spec = importlib.util.spec_from_file_location('stage_launcher', ROOT / 'stage1' / 'run-restricted.py')
launcher = importlib.util.module_from_spec(spec)
spec.loader.exec_module(launcher)

class Boundaries(unittest.TestCase):
    def test_identity_cannot_inject_acl_command(self):
        with self.assertRaisesRegex(RuntimeError, 'ISOLATION'):
            launcher.validate_identity({'sid': "';throw 'bad", 'namespace': 'invalid'})
    def test_env_does_not_preload_foreign_code(self):
        original = dict(os.environ)
        try:
            os.environ['NoDe_OpTiOnS'] = '--require unsafe.cjs'
            os.environ['PYTHONPATH'] = 'F:/sensitive'
            env = launcher.clean_environment()
            self.assertFalse(any(k.upper() in ('NODE_OPTIONS', 'NODE_PATH', 'PYTHONPATH', 'PYTHONHOME') for k in env))
            self.assertTrue(env['SystemRoot'])
        finally:
            os.environ.clear()
            os.environ.update(original)
    def test_dangling_links_refused_before_mutation(self):
        fake = ROOT / 'data' / 'launcher-boundary-fixture'
        fake.mkdir(exist_ok=True)
        link = fake / 'dangling'
        if not link.is_symlink():
            os.symlink(fake / 'missing-target', link, target_is_directory=True)
        with self.assertRaisesRegex(RuntimeError, 'ISOLATION'):
            launcher.assert_owned(link / 'new.txt')

if __name__ == '__main__':
    unittest.main()
