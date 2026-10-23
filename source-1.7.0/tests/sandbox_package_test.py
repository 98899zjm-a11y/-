"""Exercise packaging against synthetic files only; no business service starts."""
import hashlib
import importlib.util
import json
import os
from pathlib import Path
import tempfile
import unittest
import uuid

ROOT = Path(__file__).resolve().parent.parent
MODULE_PATH = ROOT / 'stage1' / 'sandbox-package.py'
if MODULE_PATH.exists():
    SPEC = importlib.util.spec_from_file_location('sandbox_packaging', MODULE_PATH)
    PACKAGING = importlib.util.module_from_spec(SPEC)
    SPEC.loader.exec_module(PACKAGING)
else:
    PACKAGING = None


class PackageBoundaries(unittest.TestCase):
    def setUp(self):
        self.scratch = tempfile.TemporaryDirectory(prefix='sandbox-package-test-', dir=ROOT / 'cache')
        self.base = Path(self.scratch.name)
        self.owned = self.base / 'owned'
        self.owned.mkdir()
        self.write('isolation-identity.json', json.dumps({
            'namespace': str(uuid.uuid4()), 'sid': 'S-1-5-21-1-2-3-9013'}))
        self.write('project/desktop/backend.cjs', 'module.exports = {};\n')
        self.write('project/desktop/legacy-modules/xjy-ledger/xjy-ledger.exe', b'fake-executable')
        self.write('stage1/tools/node.exe', b'fake-node-executable')
        self.write('stage1/create-fixture.py', '# fake-data only\n')
        self.write('tests/example_test.py', '# source test\n')
        self.python = self.base / 'python-source'
        for name in ('python.exe', 'python314.dll', 'python3.dll', 'vcruntime140.dll',
                     'vcruntime140_1.dll', 'DLLs/_sqlite3.pyd', 'Lib/os.py',
                     'Lib/site-packages/flask/__init__.py'):
            p = self.python / name
            p.parent.mkdir(parents=True, exist_ok=True)
            p.write_bytes(b'synthetic-runtime-' + name.encode('ascii'))
        self.output = self.owned / 'sandbox/input/package'

    def tearDown(self):
        self.scratch.cleanup()

    def write(self, relative, data):
        p = self.owned / relative
        p.parent.mkdir(parents=True, exist_ok=True)
        p.write_bytes(data if isinstance(data, bytes) else data.encode('utf-8'))
        return p

    def build(self, **kwargs):
        self.assertIsNotNone(PACKAGING, 'the safe Sandbox packaging interface is missing')
        return PACKAGING.build_package(self.owned, self.python, **kwargs)

    def test_program_database_is_rejected_before_any_output_is_created(self):
        # Removing the extension gate would copy a database into the mapped directory.
        for suffix in ('.DB', '.sqlite', '.sqlite3', '.sqlite-wal', '.db-shm'):
            with self.subTest(suffix=suffix):
                contaminant = self.write('project/desktop/leaked' + suffix, b'fictional-db')
                with self.assertRaisesRegex(RuntimeError, 'database'):
                    self.build()
                self.assertFalse(self.output.exists())
                contaminant.unlink()

    def test_renamed_sqlite_file_is_rejected_before_output_is_created(self):
        # A suffix-only gate would permit a real SQLite file renamed to .bin.
        self.write('project/desktop/private.bin', b'SQLite format 3\x00' + bytes(128))
        with self.assertRaisesRegex(RuntimeError, 'database'):
            self.build()
        self.assertFalse(self.output.exists())

    def test_operational_data_and_build_caches_are_not_copied(self):
        # Traversing these unrelated trees would leak fake operational records/cache.
        for relative in ('data/customer.sqlite', 'config/users.json', 'cache/private.bin',
                         'logs/private.log', 'runtime/private.json', 'backups/private.xjybak',
                         'project/desktop/.legacy-build/private.bin',
                         'project/desktop/.release-build/private.bin',
                         'project/node_modules/private.js', 'project/.git/private.bin',
                         'tests/fake-external-files/fake.bin'):
            self.write(relative, b'fake-secret-exclude')
        self.build()
        names = {p.relative_to(self.output).as_posix() for p in self.output.rglob('*') if p.is_file()}
        self.assertIn('project/desktop/backend.cjs', names)
        self.assertIn('stage1/tools/node.exe', names)
        self.assertIn('tests/example_test.py', names)
        self.assertFalse(any('private' in name or name.startswith('data/') for name in names))

    def test_output_escape_is_rejected_and_does_not_touch_the_external_directory(self):
        outside = self.base / 'outside-package'
        with self.assertRaisesRegex(RuntimeError, 'outside|owned'):
            self.build(output=outside)
        self.assertFalse(outside.exists())

    def test_arbitrary_input_child_name_is_rejected(self):
        # An arbitrary name could overwrite a different mapped-input artifact.
        other = self.owned / 'sandbox/input/boundary-probe.ps1'
        with self.assertRaisesRegex(RuntimeError, 'name'):
            self.build(output=other)
        self.assertFalse(other.exists())

    def test_versioned_output_keeps_previous_package_intact(self):
        sentinel = self.write('sandbox/input/package/keep.txt', 'old input retained\n')
        v2 = self.owned / 'sandbox/input/package-v2'
        self.build(output=v2)
        self.assertTrue((v2 / 'package-manifest.json').is_file())
        self.assertEqual(sentinel.read_text(encoding='utf-8'), 'old input retained\n')

    def test_existing_output_is_never_replaced(self):
        sentinel = self.write('sandbox/input/package/keep.txt', 'retain this\n')
        with self.assertRaisesRegex(RuntimeError, 'exists'):
            self.build()
        self.assertEqual(sentinel.read_text(encoding='utf-8'), 'retain this\n')

    def test_invalid_identity_refuses_packaging(self):
        self.write('isolation-identity.json', '{"namespace":"bad","sid":"bad"}')
        with self.assertRaisesRegex(RuntimeError, 'identity'):
            self.build()
        self.assertFalse(self.output.exists())

    def test_source_hardlink_is_rejected(self):
        existing = self.write('project/desktop/ordinary.cjs', 'ordinary\n')
        os.link(existing, self.owned / 'project/desktop/hardlink.cjs')
        with self.assertRaisesRegex(RuntimeError, 'link'):
            self.build()
        self.assertFalse(self.output.exists())

    def test_source_symlink_or_directory_junction_is_rejected(self):
        target = self.base / 'outside'
        target.mkdir()
        os.symlink(target, self.owned / 'project/desktop/escape', target_is_directory=True)
        with self.assertRaisesRegex(RuntimeError, 'link|reparse'):
            self.build()
        self.assertFalse(self.output.exists())

    def test_target_ancestor_symlink_is_rejected(self):
        target = self.base / 'outside-input'
        target.mkdir()
        (self.owned / 'sandbox').mkdir()
        os.symlink(target, self.owned / 'sandbox/input', target_is_directory=True)
        with self.assertRaisesRegex(RuntimeError, 'link|reparse'):
            self.build()
        self.assertFalse((target / 'package').exists())

    def test_runtime_auto_imports_and_personal_configuration_are_excluded(self):
        for relative in ('Lib/site-packages/unsafe.pth', 'Lib/site-packages/sitecustomize.py',
                         'Lib/usercustomize.py', 'Lib/__pycache__/os.pyc',
                         'Lib/test/private.py', 'Doc/private.txt', 'Scripts/private.exe'):
            p = self.python / relative
            p.parent.mkdir(parents=True, exist_ok=True)
            p.write_bytes(b'not portable')
        self.build()
        names = {p.relative_to(self.output).as_posix() for p in self.output.rglob('*') if p.is_file()}
        self.assertIn('PythonRuntime/python.exe', names)
        self.assertIn('PythonRuntime/Lib/site-packages/flask/__init__.py', names)
        self.assertFalse(any(name.endswith('.pth') or 'customize' in name or 'private' in name
                             or '__pycache__' in name for name in names))

    def test_missing_runtime_binary_refuses_packaging(self):
        (self.python / 'python314.dll').unlink()
        with self.assertRaisesRegex(RuntimeError, 'runtime'):
            self.build()
        self.assertFalse(self.output.exists())

    def test_missing_owned_node_binary_refuses_packaging(self):
        # Producing an incomplete package would let guest startup fail later.
        (self.owned / 'stage1/tools/node.exe').unlink()
        with self.assertRaisesRegex(RuntimeError, 'Node|node'):
            self.build()
        self.assertFalse(self.output.exists())

    def test_manifest_covers_every_file_with_independently_verified_hash(self):
        result = self.build()
        manifest = json.loads((self.output / 'package-manifest.json').read_text(encoding='utf-8'))
        recorded = {row['path']: row for row in manifest['files']}
        actual = {p.relative_to(self.output).as_posix(): p for p in self.output.rglob('*')
                  if p.is_file() and p.name != 'package-manifest.json'}
        self.assertEqual(set(recorded), set(actual))
        for name, p in actual.items():
            self.assertEqual(recorded[name]['sha256'], hashlib.sha256(p.read_bytes()).hexdigest())
            self.assertEqual(recorded[name]['size'], p.stat().st_size)
        self.assertEqual(result['fileCount'], len(actual))
        self.assertEqual(result['totalBytes'], sum(p.stat().st_size for p in actual.values()))
        self.assertEqual((self.output / 'isolation-identity.json').read_bytes(),
                         (self.owned / 'isolation-identity.json').read_bytes())


if __name__ == '__main__':
    unittest.main()
