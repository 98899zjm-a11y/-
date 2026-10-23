import importlib.util
import json
from pathlib import Path
import tempfile
import unittest

ROOT = Path(__file__).resolve().parent.parent

class ReleaseSidecarBuildTests(unittest.TestCase):
    def api(self):
        spec = importlib.util.spec_from_file_location('release_sidecar_builder', ROOT/'project/desktop/legacy-source/build-release-sidecars.py')
        module = importlib.util.module_from_spec(spec)
        spec.loader.exec_module(module)
        return module

    def test_sensitive_and_cache_inputs_are_not_build_assets(self):
        api = self.api()
        for name in ['ledger.db','jewelry.sqlite','stockcheck.db','clients.xlsx','data.json','__pycache__/a.pyc','.env','backup.xjybak']:
            self.assertFalse(api.is_program_input(Path(name)), name)
        for name in ['app/__init__.pyc','app/static/xjy-theme.css','app/templates/index.html','assets/quote.png','repairs.py']:
            self.assertTrue(api.is_program_input(Path(name)), name)

    def test_release_entry_and_standard_context_are_used_without_stage_guard(self):
        api = self.api()
        command = api.build_command('ledger', Path('X:/owned/source'), Path('X:/owned/work'), Path('X:/owned/dist'))
        self.assertEqual(command[-1], str(Path('X:/owned/source/sidecar.py')))
        self.assertIn('--onedir', command)
        self.assertIn('desktop_runtime_context', command)
        self.assertNotIn('python_guard', command)

    def test_manifest_has_all_dependencies_and_release_purpose(self):
        api = self.api()
        with tempfile.TemporaryDirectory(dir=ROOT/'tests') as tmp:
            dist = Path(tmp)
            bundle = dist/'xjy-ledger'
            (bundle/'_internal').mkdir(parents=True)
            (bundle/'xjy-ledger.exe').write_bytes(b'MZ fake code')
            (bundle/'_internal/python314.dll').write_bytes(b'fake runtime')
            entry = api.bundle_entry('ledger', dist)
            self.assertEqual(entry['purpose'],'desktop-release')
            self.assertEqual(entry['runtimeMode'],'onedir')
            self.assertEqual({x['path'] for x in entry['files']},{'xjy-ledger.exe','_internal/python314.dll'})

if __name__ == '__main__':
    unittest.main()
