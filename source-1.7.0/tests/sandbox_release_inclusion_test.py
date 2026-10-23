"""Release inclusion uses synthetic ordinary files; no program is launched."""
import hashlib
import importlib.util
import json
import os
from pathlib import Path
import tempfile
import unittest
from unittest.mock import patch
import uuid

ROOT = Path(__file__).resolve().parent.parent
spec = importlib.util.spec_from_file_location('sandbox_package_release_fixture', ROOT / 'stage1/sandbox-package.py')
PACKAGING = importlib.util.module_from_spec(spec)
spec.loader.exec_module(PACKAGING)
PDF_NAMES = ('pdfjs-dist', '@napi-rs/canvas', '@napi-rs/canvas-win32-x64-msvc')


class ReleaseInclusion(unittest.TestCase):
    def setUp(self):
        PACKAGING._inspect_path(ROOT / 'cache')
        self.scratch = tempfile.TemporaryDirectory(prefix='sandbox-release-fixture-', dir=ROOT / 'cache')
        self.base = Path(self.scratch.name)
        self.assertTrue(self.base.resolve().is_relative_to((ROOT / 'cache').resolve()))
        self.owned = self.base / 'owned'
        self.owned.mkdir()
        self.write('isolation-identity.json', json.dumps({'namespace': str(uuid.uuid4()), 'sid': 'S-1-5-21-1-2-3-9013'}))
        self.write('project/desktop/source.cjs', 'module.exports = {};')
        self.write('stage1/tools/node.exe', b'synthetic never-executed Node bytes')
        self.write('tests/example.py', '# synthetic only')
        self.candidate_rel = 'release/资源补丁-1.6.0'
        self.candidate = self.owned / self.candidate_rel
        self.manifest_rel = 'release-work/full-' + str(uuid.uuid4()) + '/release-manifest.json'
        self.descriptor = self.owned / 'stage1/sandbox-release-inclusion.json'
        self.resource('resources/app.asar', b'synthetic asar program bytes, never required')
        self.resource('resources/app.asar.unpacked/ocr.winrt.ps1', '# synthetic OCR program')
        for module in ('ledger', 'inventory'):
            self.resource(f'resources/release-modules/xjy-{module}/xjy-{module}.exe', b'MZ synthetic module, never executed')
            self.resource(f'resources/release-modules/xjy-{module}/_internal/runtime.dll', b'MZ synthetic DLL, never loaded')
        self.resource('resources/release-modules/manifest.json', json.dumps({'version': 1, 'synthetic': True}))
        for name in PDF_NAMES:
            self.resource(f'resources/print-dependencies/node_modules/{name}/package.json', json.dumps({'name': name, 'version': '1.0.0-fixture', 'dependencies': {}}))
            self.resource(f'resources/print-dependencies/node_modules/{name}/LICENSE', 'Synthetic license')
        self.resource('resources/print-dependencies/node_modules/pdfjs-dist/legacy/build/pdf.mjs', 'export const synthetic = true;')
        self.resource('resources/print-dependencies/node_modules/pdfjs-dist/legacy/build/pdf.worker.mjs', 'export const worker = true;')
        self.resource('resources/print-dependencies/node_modules/@napi-rs/canvas/index.js', 'module.exports = {};')
        self.resource('resources/print-dependencies/node_modules/@napi-rs/canvas-win32-x64-msvc/skia.win32-x64-msvc.node', b'MZ synthetic node addon, never loaded')
        for name in ('updater-helper.cjs', 'employee-update-installer.cjs', 'employee-update-cache.cjs', 'bootstrap.json'):
            self.resource('resources/update-helper/' + name, '{}' if name.endswith('.json') else 'module.exports={};')
        self.seal()
        self.output = self.owned / 'sandbox/input/package-v5'
        self.python = self.base / 'python'
        for name in ('python.exe', 'python314.dll', 'python3.dll', 'vcruntime140.dll', 'vcruntime140_1.dll', 'DLLs/fake.pyd', 'Lib/os.py'):
            p = self.python / name
            p.parent.mkdir(parents=True, exist_ok=True)
            p.write_bytes(b'synthetic runtime, never executed')

    def tearDown(self):
        PACKAGING._inspect_path(ROOT / 'cache')
        self.assertTrue((ROOT / 'cache').resolve().is_relative_to(ROOT.resolve()))
        self.assertTrue(self.base.resolve().is_relative_to((ROOT / 'cache').resolve()))
        self.scratch.cleanup()

    def write(self, relative, body):
        p = self.owned / relative
        p.parent.mkdir(parents=True, exist_ok=True)
        p.write_bytes(body if isinstance(body, bytes) else body.encode('utf-8'))
        return p

    def resource(self, relative, body):
        return self.write(self.candidate_rel + '/' + relative, body)

    def seal(self):
        rows = []
        for p in sorted(self.candidate.rglob('*')):
            if p.is_file():
                body = p.read_bytes()
                rows.append({'path': p.relative_to(self.candidate).as_posix(), 'size': len(body), 'sha256': hashlib.sha256(body).hexdigest()})
        manifest = {'version': 1, 'product': 'xjy-jewelry-offline', 'programVersion': '1.6.0', 'resourcesOnly': True,
                    'outputDir': str(self.candidate), 'fileCount': len(rows), 'bytes': sum(r['size'] for r in rows), 'files': rows,
                    'assertions': {'noDatabase': True, 'noPrivateKey': True, 'noActivation': True, 'exactAllowlist': True,
                                   'servicesStarted': False, 'programExecuted': False, 'installed': False}}
        self.manifest = self.write(self.manifest_rel, json.dumps(manifest, ensure_ascii=False))
        descriptor = {'version': 1, 'purpose': 'xjy-sandbox-release-inclusion', 'sourceRoot': self.candidate_rel,
                      'releaseManifest': self.manifest_rel, 'releaseManifestSha256': hashlib.sha256(self.manifest.read_bytes()).hexdigest(),
                      'destinationRoot': 'release-candidate'}
        self.write('stage1/sandbox-release-inclusion.json', json.dumps(descriptor, ensure_ascii=False))

    def plan(self):
        planner = getattr(PACKAGING, 'plan_release_inclusion', None)
        self.assertTrue(callable(planner), 'explicit complete release inclusion planner is missing')
        return planner(self.owned, self.descriptor)

    def build(self):
        self.assertTrue(callable(getattr(PACKAGING, 'plan_release_inclusion', None)), 'explicit complete release inclusion planner is missing')
        return PACKAGING.build_package(self.owned, self.python, output=self.output, release_inclusion=self.descriptor)

    def test_complete_resources_and_exact_pdf_packages_enter_a_sealed_program_plan(self):
        plan = self.plan()
        names = {row['destination'] for row in plan['files']}
        self.assertIn('release-candidate/resources/app.asar', names)
        self.assertIn('release-candidate/resources/print-dependencies/node_modules/pdfjs-dist/legacy/build/pdf.mjs', names)
        self.assertIn('release-candidate/release-manifest.json', names)
        self.assertEqual(plan['pdfPackages'], list(PDF_NAMES))
        self.assertFalse(plan['programExecuted'])

    def test_optional_build_includes_every_declared_resource_and_keeps_global_exclusions(self):
        self.write('project/node_modules/never.js', 'unapproved global dependency')
        self.build()
        manifest = json.loads((self.output / 'package-manifest.json').read_text('utf-8'))
        names = {r['path'] for r in manifest['files']}
        self.assertNotIn('project/node_modules/never.js', names)
        self.assertIn('release-candidate/resources/app.asar', names)
        self.assertEqual(manifest['releaseInclusion']['pdfPackages'], list(PDF_NAMES))
        for row in manifest['files']:
            p = self.output / row['path']
            self.assertEqual(len(p.read_bytes()), row['size'])
            self.assertEqual(hashlib.sha256(p.read_bytes()).hexdigest(), row['sha256'])

    def test_unlisted_or_missing_resource_refuses_before_package_creation(self):
        p = self.resource('resources/release-modules/xjy-ledger/_internal/extra.dll', b'extra')
        with self.assertRaisesRegex(RuntimeError, 'complete|extra|manifest'):
            self.build()
        self.assertFalse(self.output.exists())
        p.unlink()
        (self.candidate / 'resources/app.asar').unlink()
        with self.assertRaisesRegex(RuntimeError, 'complete|missing|manifest'):
            self.build()
        self.assertFalse(self.output.exists())

    def test_declared_hash_or_sealed_manifest_drift_is_refused(self):
        (self.candidate / 'resources/app.asar').write_bytes(b'changed after seal')
        with self.assertRaisesRegex(RuntimeError, 'hash|size|seal'):
            self.build()
        self.assertFalse(self.output.exists())
        self.seal()
        self.manifest.write_text('{}', encoding='utf-8')
        with self.assertRaisesRegex(RuntimeError, 'hash|seal|manifest'):
            self.build()
        self.assertFalse(self.output.exists())

    def test_fourth_or_nested_pdf_package_is_not_an_exclusion_escape(self):
        self.resource('resources/print-dependencies/node_modules/extra-package/package.json', '{}')
        self.seal()
        with self.assertRaisesRegex(RuntimeError, 'PDF|package|allow'):
            self.build()
        self.assertFalse(self.output.exists())

    def test_pdf_dependency_closure_is_exact(self):
        p = self.candidate / 'resources/print-dependencies/node_modules/pdfjs-dist/package.json'
        p.write_text(json.dumps({'name': 'pdfjs-dist', 'version': 'fixture', 'dependencies': {'unexpected': '1'}}), encoding='utf-8')
        self.seal()
        with self.assertRaisesRegex(RuntimeError, 'dependency|PDF|package'):
            self.build()
        self.assertFalse(self.output.exists())

    def test_required_pdf_runtime_file_cannot_be_omitted_even_from_resealed_manifest(self):
        (self.candidate / 'resources/print-dependencies/node_modules/pdfjs-dist/legacy/build/pdf.worker.mjs').unlink()
        self.seal()
        with self.assertRaisesRegex(RuntimeError, 'complete|missing|PDF'):
            self.build()
        self.assertFalse(self.output.exists())

    def test_secret_or_activation_metadata_cannot_hide_behind_program_assertions(self):
        manifest = json.loads(self.manifest.read_text('utf-8'))
        for field, value in [('publicPins', {'publisherPrivateKey': 'synthetic-secret-without-PEM-marker'}),
                             ('compilers', {'esbuild': 'fixture', 'apiKey': 'synthetic-private-value'}),
                             ('assertions', {**manifest['assertions'], 'activationToken': 'synthetic-activation'})]:
            with self.subTest(field=field):
                updated = {**manifest, field: value}
                self.manifest.write_text(json.dumps(updated), encoding='utf-8')
                descriptor = json.loads(self.descriptor.read_text('utf-8'))
                descriptor['releaseManifestSha256'] = hashlib.sha256(self.manifest.read_bytes()).hexdigest()
                self.descriptor.write_text(json.dumps(descriptor), encoding='utf-8')
                with self.assertRaisesRegex(RuntimeError, 'private|key|activation|metadata|fields'):
                    self.plan()
                self.assertFalse(self.output.exists())

    def test_hidden_environment_and_auto_import_files_are_refused_by_the_explicit_exception(self):
        for name in ('.env', 'unsafe.pth', 'module.pyc.tmp'):
            with self.subTest(name=name):
                p = self.resource('resources/release-modules/xjy-ledger/_internal/' + name, b'synthetic hidden content')
                self.seal()
                with self.assertRaisesRegex(RuntimeError, 'environment|import|secret|excluded|path'):
                    self.plan()
                self.assertFalse(self.output.exists())
                p.unlink()

    def test_casefolded_nested_node_packages_are_refused_in_both_program_subtrees(self):
        for base in ('resources/print-dependencies/node_modules/pdfjs-dist',
                     'resources/release-modules/xjy-ledger/_internal'):
            for folder in ('NODE_MODULES', 'Node_Modules'):
                with self.subTest(base=base, folder=folder):
                    p = self.resource(base + '/' + folder + '/unapproved/package.json', '{}')
                    self.seal()
                    try:
                        with self.assertRaisesRegex(RuntimeError, 'nested|package|allow'):
                            self.plan()
                    finally:
                        p.unlink()
                    self.assertFalse(self.output.exists())

    def test_bootstrap_and_module_resource_json_cannot_contain_secret_fields(self):
        for name in ('resources/update-helper/bootstrap.json',
                     'resources/release-modules/xjy-ledger/_internal/public-metadata.json'):
            with self.subTest(name=name):
                existing = self.candidate / name
                original = existing.read_bytes() if existing.exists() else None
                p = self.resource(name, json.dumps({'apiKey': 'synthetic-no-byte-regex-marker'}))
                self.seal()
                try:
                    with self.assertRaisesRegex(RuntimeError, 'secret|key|metadata'):
                        self.plan()
                finally:
                    if original is None:
                        p.unlink()
                    else:
                        p.write_bytes(original)
                self.assertFalse(self.output.exists())

    def test_description_drift_after_preflight_cannot_finish_a_package(self):
        original = PACKAGING._copy_verified
        def change_description_before_copy(source, destination, source_root, boundary):
            if Path(source) == self.descriptor:
                data = json.loads(self.descriptor.read_text('utf-8'))
                data['releaseManifestSha256'] = 'a' * 64
                self.descriptor.write_text(json.dumps(data), encoding='utf-8')
            return original(source, destination, source_root, boundary)
        with patch.object(PACKAGING, '_copy_verified', change_description_before_copy):
            with self.assertRaisesRegex(RuntimeError, 'sealed|description|descriptor'):
                self.build()
        self.assertFalse((self.output / 'package-manifest.json').exists())

    def test_candidate_tree_drift_after_resource_copy_cannot_finish_a_package(self):
        original = PACKAGING._copy_verified
        def add_unlisted_resource_after_manifest_copy(source, destination, source_root, boundary):
            copied = original(source, destination, source_root, boundary)
            if Path(source) == self.manifest:
                self.resource('resources/release-modules/xjy-ledger/_internal/late.dll', b'unlisted after preflight')
            return copied
        with patch.object(PACKAGING, '_copy_verified', add_unlisted_resource_after_manifest_copy):
            with self.assertRaisesRegex(RuntimeError, 'complete|extra|manifest|drift|changed'):
                self.build()
        self.assertFalse((self.output / 'package-manifest.json').exists())

    def test_database_renamed_database_keys_and_activation_refuse_even_when_manifest_lists_them(self):
        for name, body in [('resources/release-modules/xjy-ledger/_internal/customer.db', b'fake db'),
                           ('resources/release-modules/xjy-ledger/_internal/renamed.bin', b'SQLite format 3\0' + bytes(32)),
                           ('resources/release-modules/xjy-ledger/_internal/secret.pem', b'fake secret'),
                           ('resources/release-modules/xjy-ledger/_internal/private.txt', b'-----BEGIN PRIVATE KEY-----\nfake\n'),
                           ('resources/release-modules/xjy-ledger/_internal/xjy-install-activation.json', b'{}')]:
            with self.subTest(name=name):
                p = self.resource(name, body)
                self.seal()
                with self.assertRaisesRegex(RuntimeError, 'database|secret|key|activation|private|operational'):
                    self.build()
                self.assertFalse(self.output.exists())
                p.unlink()

    def test_links_are_rejected_without_following_external_targets(self):
        p = self.candidate / 'resources/app.asar'
        p.unlink()
        outside = self.base / 'never-imported-toy.txt'
        outside.write_text('outside synthetic bytes', encoding='utf-8')
        os.symlink(outside, p)
        with self.assertRaisesRegex(RuntimeError, 'link|reparse'):
            self.build()
        self.assertFalse(self.output.exists())
        self.assertEqual(outside.read_text('utf-8'), 'outside synthetic bytes')

    def test_hardlinked_resource_is_refused(self):
        p = self.candidate / 'resources/app.asar'
        os.link(p, self.base / 'hardlink-toy.txt')
        with self.assertRaisesRegex(RuntimeError, 'link'):
            self.build()
        self.assertFalse(self.output.exists())

    def test_descriptor_cannot_point_to_absolute_or_parent_escaped_sources(self):
        descriptor = json.loads(self.descriptor.read_text('utf-8'))
        for field, value in [('sourceRoot', 'F:/formal'), ('sourceRoot', '../outside'), ('releaseManifest', 'F:/formal/private.json'),
                             ('destinationRoot', '../escape'), ('destinationRoot', 'project/overwrite')]:
            with self.subTest(field=field, value=value):
                updated = {**descriptor, field: value}
                self.descriptor.write_text(json.dumps(updated), encoding='utf-8')
                with self.assertRaisesRegex(RuntimeError, 'relative|owned|candidate|destination|path'):
                    self.build()
                self.assertFalse(self.output.exists())

    def test_case_collision_and_windows_path_alias_refuse_before_output(self):
        manifest = json.loads(self.manifest.read_text('utf-8'))
        for path in ['resources/app.ASAR', 'resources/release-modules/con.txt', 'resources/release-modules/file:stream', 'resources/../data/customer.json']:
            with self.subTest(path=path):
                updated = json.loads(json.dumps(manifest))
                updated['files'].append({'path': path, 'size': 0, 'sha256': hashlib.sha256(b'').hexdigest()})
                updated['fileCount'] += 1
                self.manifest.write_text(json.dumps(updated), encoding='utf-8')
                descriptor = json.loads(self.descriptor.read_text('utf-8'))
                descriptor['releaseManifestSha256'] = hashlib.sha256(self.manifest.read_bytes()).hexdigest()
                self.descriptor.write_text(json.dumps(descriptor), encoding='utf-8')
                with self.assertRaisesRegex(RuntimeError, 'case|duplicate|relative|path|reserved|allow'):
                    self.build()
                self.assertFalse(self.output.exists())


if __name__ == '__main__':
    unittest.main()
