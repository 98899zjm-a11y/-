"""Engine inclusion only hashes/copies synthetic bytes; no engine is run."""
from pathlib import Path
import hashlib
import importlib.util
import json
import os
import tempfile
from types import MappingProxyType
import unittest
from unittest import mock
import ast
import re

ROOT = Path(__file__).resolve().parent.parent
spec = importlib.util.spec_from_file_location('engine_packaging_fixture', ROOT / 'stage1/sandbox-package.py')
PACK = importlib.util.module_from_spec(spec); spec.loader.exec_module(PACK)


class EngineInclusion(unittest.TestCase):
    def setUp(self):
        PACK._inspect_path(ROOT / 'cache')
        self.temp = tempfile.TemporaryDirectory(prefix='engine-inclusion-fixture-', dir=ROOT / 'cache')
        self.base = Path(self.temp.name)
        self.root = self.base / 'owned'; self.root.mkdir()
        self.relative = 'engine-work/original-00000000-0000-4000-8000-000000000001'
        self.engine = self.root / self.relative
        for name, content in [('engine.exe', b'MZ synthetic engine, never executed'), ('ffmpeg.dll', b'MZ synthetic DLL'), ('locales/en-US.pak', b'synthetic locale')]:
            file = self.engine / name; file.parent.mkdir(parents=True, exist_ok=True); file.write_bytes(content)
        self.manifest = self.root / 'reports/original-engine-copy-manifest.json'
        self.refresh()

    def tearDown(self):
        PACK._inspect_path(ROOT / 'cache')
        self.assertTrue(self.base.resolve().is_relative_to(ROOT.resolve()))
        self.temp.cleanup()

    def refresh(self):
        rows=[]
        for file in sorted(self.engine.rglob('*')):
            if file.is_file():
                b=file.read_bytes(); name=file.relative_to(self.engine).as_posix()
                rows.append({'path':name,'size':len(b),'sha256':hashlib.sha256(b).hexdigest(),'matchesThirdPartySdk':name!='engine.exe'})
        data={'version':1,'purpose':'reviewed-original-electron-engine','sourceRoot':'F:/THIS_MUST_NEVER_BE_READ',
              'root':str(self.engine),'executableName':'engine.exe','sourceProgram':{'version':'fixture','asarSize':999,'asarSha256':'f'*64},
              'files':rows,'engineExecuted':False,'businessDatabasesRead':False,'productionFilesModified':False,'capabilitiesVerified':False}
        self.manifest.parent.mkdir(parents=True,exist_ok=True); self.manifest.write_text(json.dumps(data),encoding='utf-8')
        exe=next(r for r in rows if r['path']=='engine.exe')
        self.seal=MappingProxyType({'manifestRelative':'reports/original-engine-copy-manifest.json','manifestSha256':hashlib.sha256(self.manifest.read_bytes()).hexdigest(),
             'rootRelative':self.relative,'executableName':'engine.exe','executableSha256':exe['sha256'],'executableSize':exe['size'],
             'fileCount':len(rows),'totalBytes':sum(r['size'] for r in rows)})

    def plan(self):
        loader=getattr(PACK,'_engine_helper',None)
        self.assertTrue(callable(loader),'independent fixed-seal engine inclusion is missing')
        return loader()._plan_engine(self.root,self.seal,PACK)

    def test_reviewed_complete_engine_enters_candidate_root_and_source_f_is_metadata_only(self):
        plan=self.plan()
        self.assertEqual({r['destination'] for r in plan['files']},{'release-candidate/engine.exe','release-candidate/ffmpeg.dll','release-candidate/locales/en-US.pak','release-candidate/engine-allowlist.json'})
        self.assertEqual(plan['engineFileCount'],3)
        self.assertFalse(plan['engineExecuted']);self.assertFalse(plan['capabilitiesVerified'])
        self.assertNotIn('resources/app.asar',{r['path'] for r in json.loads(self.manifest.read_text())['files']})

    def test_original_asar_or_operational_extra_file_is_never_admitted(self):
        for name in ('resources/app.asar','config/users.json','data/ledger.db'):
            with self.subTest(name=name):
                p=self.engine/name;p.parent.mkdir(parents=True,exist_ok=True);p.write_bytes(b'synthetic extra')
                try:
                    with self.assertRaisesRegex(RuntimeError,'extra|complete|engine|manifest|resource'):
                        self.plan()
                finally:p.unlink()

    def test_sealed_original_filipino_locale_is_an_explicit_program_file(self):
        (self.engine/'locales/fil.pak').write_bytes(b'synthetic reviewed Filipino locale')
        self.refresh()
        names={record['destination'] for record in self.plan()['files']}
        self.assertIn('release-candidate/locales/fil.pak',names)
        (self.engine/'locales/unreviewed.pak').write_bytes(b'synthetic unreviewed locale')
        self.refresh()
        with self.assertRaisesRegex(RuntimeError,'allowlist'):self.plan()

    def test_manifest_or_engine_drift_refuses_without_any_candidate_output(self):
        (self.engine/'engine.exe').write_bytes(b'MZ changed')
        with self.assertRaisesRegex(RuntimeError,'size|hash|seal'):
            self.plan()
        self.refresh();self.manifest.write_text('{}',encoding='utf-8')
        with self.assertRaisesRegex(RuntimeError,'manifest|hash|seal'):
            self.plan()
        self.assertFalse((self.root/'sandbox/input/package-v5').exists())

    def test_exact_native_tool_exception_has_own_hash_and_no_directory_traversal(self):
        tool=self.root/'delivery-tools/fixture-tool.cjs';tool.parent.mkdir();tool.write_bytes(b'pure fixture tool')
        extra=tool.parent/'must-not-copy.pem';extra.write_bytes(b'private fixture bytes')
        self.seal=MappingProxyType({**self.seal,'nativeTools':(('delivery-tools/fixture-tool.cjs',len(tool.read_bytes()),hashlib.sha256(tool.read_bytes()).hexdigest()),)})
        records=self.plan()['files']
        self.assertEqual([row['destination'] for row in records if row['destination'].startswith('delivery-tools/')],['delivery-tools/fixture-tool.cjs'])
        tool.write_bytes(b'changed tool')
        with self.assertRaisesRegex(RuntimeError,'tool|hash|size|seal'):self.plan()

    def builder_tool_sources(self):
        # Parse only the fixed literal, never import or execute the builder.
        source=(ROOT/'stage1/build-initial-patch.cjs').read_text('utf-8-sig')
        match=re.search(r'const TOOL_FILES=Object\.freeze\((\[[^;]+?\])\);',source)
        self.assertIsNotNone(match,'Explicit builder TOOL_FILES literal required')
        return ['delivery-tools/'+name if name=='一键完整升级.cmd' else name for name in ast.literal_eval(match.group(1))]

    def test_fixed_native_allowlist_covers_entire_builder_tool_closure(self):
        expected=set(self.builder_tool_sources())
        default={'project/desktop/employee-update-cache.cjs','project/desktop/employee-update-installer.cjs'}
        declared={row[0] for row in PACK._engine_helper().KNOWN_ENGINE_SEAL['nativeTools'] if row[0].startswith('delivery-tools/')}
        self.assertEqual(len(declared),8)
        self.assertEqual(declared|default,expected)
        self.assertIn('delivery-tools/一键完整升级.cmd',declared)

    def test_independent_reviewer_is_exactly_six_separately_hashed_inputs(self):
        helper=PACK._engine_helper()
        expected={'delivery-approval/'+name for name in (
            'Prepare-Initial-Approval.ps1','approval-core.cjs','approval-archive.cjs',
            'approval-io.cjs','负责人首次审定.cmd','README.md')}
        declared={name for name,size,digest in helper.KNOWN_ENGINE_SEAL['nativeTools'] if name.startswith('delivery-approval/')}
        self.assertEqual(declared,expected)
        self.assertEqual(len(helper.KNOWN_ENGINE_SEAL['nativeTools']),14)
        self.assertFalse(expected.intersection(self.builder_tool_sources()),'Independent reviewer must not enter the signed initial payload')
        for name,size,digest in helper.KNOWN_ENGINE_SEAL['nativeTools']:
            body=(ROOT/name).read_bytes()
            self.assertEqual((len(body),hashlib.sha256(body).hexdigest()),(size,digest),name)

    def test_reviewer_exception_copies_only_one_explicit_file_and_refuses_unknown_sibling(self):
        body=b'pure reviewer fixture never executed';file=self.root/'delivery-approval/approval-core.cjs'
        file.parent.mkdir();file.write_bytes(body);(file.parent/'must-not-copy.pem').write_bytes(b'private fixture')
        self.seal=MappingProxyType({**self.seal,'nativeTools':(('delivery-approval/approval-core.cjs',len(body),hashlib.sha256(body).hexdigest()),)})
        records=self.plan()['files']
        self.assertEqual([r['destination'] for r in records if r['destination'].startswith('delivery-approval/')],['delivery-approval/approval-core.cjs'])
        rogue=file.parent/'unreviewed.cjs';rogue.write_bytes(body)
        self.seal=MappingProxyType({**self.seal,'nativeTools':(('delivery-approval/unreviewed.cjs',len(body),hashlib.sha256(body).hexdigest()),)})
        with self.assertRaisesRegex(RuntimeError,'allowlist'):self.plan()

    def test_complete_builder_programs_copy_exactly_without_duplicate_default_dependencies(self):
        python=self.minimal_package_sources();tools=[]
        for name in self.builder_tool_sources():
            file=self.root/name;file.parent.mkdir(parents=True,exist_ok=True);body=('pure fixture program '+name).encode('utf-8');file.write_bytes(body)
            if name.startswith('delivery-tools/'):
                tools.append((name,len(body),hashlib.sha256(body).hexdigest()))
        self.seal=MappingProxyType({**self.seal,'nativeTools':tuple(tools)})
        engine_plan=self.plan()
        self.assertEqual(engine_plan['nativeProgramToolCount'],8)
        resource=self.root/'release/toy/resources/app.asar';resource.parent.mkdir(parents=True);resource.write_bytes(b'fake candidate program')
        descriptor=self.root/'stage1/sandbox-release-inclusion.json';descriptor.write_bytes(b'{}')
        release_plan={'descriptorPath':'stage1/sandbox-release-inclusion.json','descriptorSize':2,'descriptorSha256':hashlib.sha256(b'{}').hexdigest(),'files':[{'source':str(resource),'destination':'release-candidate/resources/app.asar','size':resource.stat().st_size,'sha256':hashlib.sha256(resource.read_bytes()).hexdigest()}]}
        with mock.patch.object(PACK,'plan_release_inclusion',return_value=release_plan),mock.patch.object(PACK,'plan_engine_inclusion',return_value=engine_plan):
            result=PACK.build_package(self.root,python,release_inclusion=descriptor,original_engine=True)
        rows=json.loads(Path(result['manifest']).read_text('utf-8'))['files']
        for name in self.builder_tool_sources():
            self.assertEqual(sum(row['path']==name for row in rows),1,name)
        self.assertEqual(sum(row['path'].startswith('delivery-tools/') for row in rows),8)

    def minimal_package_sources(self):
        (self.root/'isolation-identity.json').write_text(json.dumps({'namespace':'00000000-0000-4000-8000-000000000002','sid':'S-1-5-21-1-2-3-9013'}),encoding='utf-8')
        for name in ('project','stage1/tools','tests'):(self.root/name).mkdir(parents=True,exist_ok=True)
        (self.root/'stage1/tools/node.exe').write_bytes(b'MZ toy node never executed')
        python=self.base/'python'
        for name in (*PACK._RUNTIME_BINARIES,'DLLs/toy.pyd','Lib/toy.py'):
            file=python/name;file.parent.mkdir(parents=True,exist_ok=True);file.write_bytes(b'toy runtime never executed')
        return python

    def test_engine_requires_resource_seal_before_fresh_output_creation(self):
        python=self.minimal_package_sources()
        with self.assertRaisesRegex(RuntimeError,'explicit sealed candidate'):
            PACK.build_package(self.root,python,original_engine=True)
        self.assertFalse((self.root/'sandbox/input/package').exists())

    def test_merged_program_copy_retains_per_file_engine_and_resource_hashes(self):
        python=self.minimal_package_sources();engine_plan=self.plan()
        resource=self.root/'release/toy/resources/app.asar';resource.parent.mkdir(parents=True);resource.write_bytes(b'fake candidate program bytes')
        descriptor=self.root/'stage1/sandbox-release-inclusion.json';descriptor.write_bytes(b'{}')
        row={'source':str(resource),'destination':'release-candidate/resources/app.asar','size':resource.stat().st_size,'sha256':hashlib.sha256(resource.read_bytes()).hexdigest()}
        release_plan={'descriptorPath':'stage1/sandbox-release-inclusion.json','descriptorSize':2,'descriptorSha256':hashlib.sha256(b'{}').hexdigest(),'files':[row]}
        with mock.patch.object(PACK,'plan_release_inclusion',return_value=release_plan),mock.patch.object(PACK,'plan_engine_inclusion',return_value=engine_plan):
            result=PACK.build_package(self.root,python,release_inclusion=descriptor,original_engine=True)
        manifest=json.loads(Path(result['manifest']).read_text('utf-8'))
        copied={item['path']:item for item in manifest['files']}
        for record in [*engine_plan['files'],row]:
            self.assertEqual(copied[record['destination']]['sha256'],record['sha256'])
            self.assertEqual(copied[record['destination']]['size'],record['size'])
        self.assertFalse(manifest['engineInclusion']['capabilitiesVerified'])

    def test_engine_link_and_hardlink_are_rejected(self):
        p=self.engine/'ffmpeg.dll';outside=self.base/'toy.dll';outside.write_bytes(b'toy outside')
        p.unlink();os.symlink(outside,p)
        with self.assertRaisesRegex(RuntimeError,'link|reparse'):
            self.plan()
        p.unlink();p.write_bytes(b'MZ synthetic DLL');os.link(p,self.base/'hardlink.dll')
        with self.assertRaisesRegex(RuntimeError,'link'):
            self.plan()

    def test_declared_resources_or_unknown_executable_are_refused_even_under_a_fixture_seal(self):
        p=self.engine/'second.exe';p.write_bytes(b'MZ other')
        self.refresh()
        with self.assertRaisesRegex(RuntimeError,'engine|allow|executable|path'):
            self.plan()

    def test_reviewed_flags_and_sdk_comparison_are_exact(self):
        data=json.loads(self.manifest.read_text())
        data['engineExecuted']=True
        self.manifest.write_text(json.dumps(data),encoding='utf-8')
        self.seal=MappingProxyType({**self.seal,'manifestSha256':hashlib.sha256(self.manifest.read_bytes()).hexdigest()})
        with self.assertRaisesRegex(RuntimeError,'review|executed|capabil|manifest'):
            self.plan()


if __name__=='__main__': unittest.main()
