"""Pure V9 input-delta rules. No sealing, process, runtime or VM is run."""
from pathlib import Path
import copy
import hashlib
import importlib.util
import unittest
from unittest.mock import patch

ROOT=Path(__file__).resolve().parent.parent


class V9Seal(unittest.TestCase):
    def tool(self):
        file=ROOT/'stage1/seal-desktop-safe-v9.py'
        self.assertTrue(file.is_file(),'Fresh V9 sealer source is missing')
        spec=importlib.util.spec_from_file_location('v9_pure_delta_test',file)
        module=importlib.util.module_from_spec(spec);spec.loader.exec_module(module)
        return module

    def fixture(self,tool):
        row=lambda name,sha='a'*64:{'path':name,'size':1,'sha256':sha}
        base=['stage1/tools/node.exe','PythonRuntime/python.exe','release-candidate/engine-allowlist.json',
              'stage1/sandbox-package.py','stage1/sandbox-release-inclusion.py','stage1/sandbox-engine-inclusion.py',
              'release-candidate/engine.exe','release-candidate/resources/app.asar','release-candidate/release-manifest.json',
              'stage1/io-guard.cjs','project/desktop/legacy-modules/manifest.json',
              'project/desktop/legacy-modules/xjy-ledger/xjy-ledger.exe',
              'project/desktop/legacy-modules/xjy-ledger/_internal/base_library.zip','delivery-tools/Initial-Full-Upgrade.ps1']
        old={n:row(n) for n in base}
        old['stage1/io-guard.cjs']['sha256']='28d25feb5340273806823d41e5e0bd95b5120086920711cc80101b85e6074f2c'
        for n in range(34):
            name='project/desktop/legacy-source/ledger/app/frozen'+str(n)+'.pyc';old[name]=row(name)
        new=copy.deepcopy(old)
        pins={
            'project/desktop/legacy-modules/manifest.json':'5f0e8d919c541ac07d305544bb1c7036e7cb4ced8c5c4ee8cf262c927bc373d2',
            'project/desktop/legacy-modules/xjy-ledger/xjy-ledger.exe':'214843e59dcb107b45e508542227311c8a2aaa62c8839df992795d5a78b9e191',
            'project/desktop/legacy-modules/xjy-ledger/_internal/base_library.zip':'af7f4a10a2c7777ef0830ce0323c92034596a7d31d81a0f429f078a67bd27e3c',
            'delivery-tools/Initial-Full-Upgrade.ps1':'c156f9bd6b9037a4c21e5235e564e02926013a9bb7d07019979f2a2d307518f4',
            'release-candidate/release-manifest.json':'c82426dc5463f2b5f0b366dd7c7e0ac09ec9d542bc9b81866997ecbc0cf9efd9',
            'release-candidate/resources/app.asar':'c'*64}
        for name,sha in pins.items():new[name]['sha256']=sha
        additions=['delivery-approval/'+n for n in ('Prepare-Initial-Approval.ps1','approval-core.cjs','approval-archive.cjs','approval-io.cjs','负责人首次审定.cmd','README.md')]
        additions+=['tests/delivery-approval.test.cjs','tests/delivery-approval-archive.test.cjs',
                    'tests/delivery-approval-ps-paths.test.ps1','tests/delivery-approval-ps-acl.test.ps1',
                    'tests/renderer-build-resolution.test.cjs','stage1/prepare-desktop-v9-helper.py',
                    'stage1/seal-desktop-safe-v9.py','stage1/candidate-delivery-approval-pure-ps-tests.ps1']
        additions+=['stage1/test-tools/renderer-build-dependencies.blob','stage1/test-tools/renderer-build-tool-manifest.json']
        for n in additions:new[n]=row(n,'d'*64)
        engine={'sourceRoot':'engine-work/original-40bebb87-ac8d-433d-a982-4e8bf97844d8',
                'manifestRelative':'reports/original-engine-copy-manifest.json',
                'manifestSha256':'6893a279e6ab2ccaae36c9c66fd8c840ef4dacddc9cd9c78c24f87dd3f311ea4',
                'executableName':'鑫金源珠宝报价.exe','executableSha256':'db3ad2066a55546f9b6737da3c7f011370e4856fb36888055b544d45653e4f40',
                'engineFileCount':72,'engineBytes':385404497,'nativeProgramToolCount':8,
                'engineExecuted':False,'capabilitiesVerified':False}
        def manifest(rows,eng,res):return{'version':1,'fileCount':len(rows),'totalBytes':sum(r['size'] for r in rows.values()),'files':list(rows.values()),'engineInclusion':eng,'releaseInclusion':res}
        old_manifest=manifest(old,engine,{'sourceRoot':'release/资源补丁-1.6.0-v2','releaseManifestSha256':'b'*64,'resourceFileCount':1007})
        new_manifest=manifest(new,{**engine,'nativeProgramToolCount':14},{'sourceRoot':'release/资源补丁-1.6.0-v7','releaseManifestSha256':pins['release-candidate/release-manifest.json'],'resourceFileCount':1007})
        review=tool.describe_delta(old_manifest,new_manifest)
        self.assertIs(review['approved'],False,'Describing a delta must never approve it')
        review['approved']=True
        return old_manifest,new_manifest,review

    def test_exact_reviewed_v9_delta_accepts_v6_stage_repairs_and_six_independent_tools(self):
        tool=self.tool();old,new,review=self.fixture(tool)
        result=tool.validate_delta(old,new,review)
        self.assertEqual(result['preservedOriginalBusinessPycCount'],34)
        self.assertEqual(result['removed'],[])
        self.assertIn('delivery-approval/approval-core.cjs',result['added'])

    def test_unapproved_or_incomplete_or_extra_root_review_refuses(self):
        tool=self.tool()
        for change in (lambda r:r.update(approved=False),lambda r:r['changed'].pop('release-candidate/resources/app.asar'),
                       lambda r:r['added'].update({'stage1/unreviewed.py':{'path':'stage1/unreviewed.py','size':1,'sha256':'e'*64}}),
                       lambda r:r.update(baselineManifestSha256='f'*64)):
            old,new,review=self.fixture(tool);change(review)
            with self.assertRaises(RuntimeError):tool.validate_delta(old,new,review)

    def test_engine_python_node_and_each_unknown_original_pyc_stay_immutable_even_with_root_delta_rows(self):
        tool=self.tool()
        for name in ('release-candidate/engine.exe','PythonRuntime/python.exe','stage1/tools/node.exe','project/desktop/legacy-source/ledger/app/frozen0.pyc'):
            old,new,review=self.fixture(tool)
            next(r for r in new['files'] if r['path']==name)['sha256']='e'*64
            review=tool.describe_delta(old,new);review['approved']=True
            with self.subTest(name=name),self.assertRaisesRegex(RuntimeError,'immutable|pyc|original|engine|runtime'):tool.validate_delta(old,new,review)

    def test_wrong_stage_pin_resource_seal_missing_tool_and_extra_approval_path_refuse(self):
        tool=self.tool()
        for mode in ('stage','resource','missing-tool','rogue-tool','removed'):
            old,new,review=self.fixture(tool)
            if mode=='stage':next(r for r in new['files'] if r['path']=='project/desktop/legacy-modules/manifest.json')['sha256']='e'*64
            elif mode=='resource':new['releaseInclusion']['releaseManifestSha256']='e'*64
            elif mode=='missing-tool':new['files']=[r for r in new['files'] if r['path']!='delivery-approval/README.md']
            elif mode=='rogue-tool':new['files'].append({'path':'delivery-approval/rogue.cjs','size':1,'sha256':'e'*64})
            elif mode=='removed':new['files']=[r for r in new['files'] if r['path']!='project/desktop/legacy-source/ledger/app/frozen0.pyc']
            new['fileCount']=len(new['files']);new['totalBytes']=sum(r['size'] for r in new['files'])
            with self.subTest(mode=mode),self.assertRaises(RuntimeError):
                fresh=tool.describe_delta(old,new);fresh['approved']=True;tool.validate_delta(old,new,fresh)

    def test_rows_reject_duplicate_alias_paths_operational_files_and_bad_totals(self):
        tool=self.tool();base={'version':1,'fileCount':1,'totalBytes':1,'files':[{'path':'delivery-approval/approval-core.cjs','size':1,'sha256':'a'*64}]}
        self.assertEqual(len(tool.rows_of(base)),1)
        for path in ('delivery-approval/unreviewed.cjs','project/data/customer.json','project/secret.sqlite','stage1/../private.json'):
            m=copy.deepcopy(base);m['files'][0]['path']=path
            with self.subTest(path=path),self.assertRaises(RuntimeError):tool.rows_of(m)
        m=copy.deepcopy(base);m['files'].append({**m['files'][0],'path':m['files'][0]['path'].upper()});m['fileCount']=2;m['totalBytes']=2
        with self.assertRaises(RuntimeError):tool.rows_of(m)

    def test_sealed_dependency_code_folders_are_not_confused_with_operational_configuration(self):
        tool=self.tool()
        for name in ('PythonRuntime/Lib/site-packages/setuptools/config/__init__.py','release-candidate/resources/print-dependencies/node_modules/pdfjs-dist/build/pdf.mjs'):
            with self.subTest(name=name):self.assertTrue(tool._valid_name(name))
        for name in ('project/config/customers.json','release-candidate/resources/config/users.json','release-candidate/resources/print-dependencies/node_modules/private/key.pem','PythonRuntime/Lib/site-packages/setuptools/config/customer.sqlite'):
            with self.subTest(name=name):self.assertFalse(tool._valid_name(name))

    def test_semantic_build_vendor_is_required_and_only_two_exact_new_test_tool_files_are_allowed(self):
        tool=self.tool()
        for mode in ('missing-blob','extra-tool'):
            old,new,review=self.fixture(tool)
            if mode=='missing-blob':new['files']=[r for r in new['files'] if r['path']!='stage1/test-tools/renderer-build-dependencies.blob']
            else:new['files'].append({'path':'stage1/test-tools/undeclared-native.dll','size':1,'sha256':'e'*64})
            new['fileCount']=len(new['files']);new['totalBytes']=sum(r['size'] for r in new['files'])
            fresh=tool.describe_delta(old,new);fresh['approved']=True
            with self.subTest(mode=mode),self.assertRaisesRegex(RuntimeError,'vendor|test.tool|dependency|required'):tool.validate_delta(old,new,fresh)

    def test_extra_runtime_engine_or_node_members_cannot_expand_an_immutable_closure(self):
        tool=self.tool()
        for name in ('PythonRuntime/Lib/added.py','release-candidate/extra.dll','stage1/tools/extra.exe'):
            old,new,review=self.fixture(tool);new['files'].append({'path':name,'size':1,'sha256':'e'*64})
            new['fileCount']=len(new['files']);new['totalBytes']=sum(r['size'] for r in new['files'])
            fresh=tool.describe_delta(old,new);fresh['approved']=True
            with self.subTest(name=name),self.assertRaisesRegex(RuntimeError,'immutable|runtime|engine|closure'):tool.validate_delta(old,new,fresh)

    def test_source_loader_rejects_unreviewed_code_before_execution_and_uses_verified_bytes(self):
        tool=self.tool();loader=getattr(tool,'load_verified_source',None)
        self.assertTrue(callable(loader),'Verified-byte source loader is missing')
        file=tool.ROOT/'stage1/synthetic-approved-code.py';body=b"VALUE='in-memory reviewed fixture'\n"
        row={'path':'stage1/synthetic-approved-code.py','size':len(body),'sha256':hashlib.sha256(body).hexdigest()}
        # No file exists at this path: reopening a path after byte verification fails.
        with patch.object(tool,'stable',return_value=body):
            loaded=loader('synthetic_reviewed_module',file,row)
        self.assertEqual(loaded.VALUE,'in-memory reviewed fixture')
        unreviewed=b"raise RuntimeError('UNREVIEWED_CODE_EXECUTED')\n"
        with patch.object(tool,'stable',return_value=unreviewed),self.assertRaisesRegex(RuntimeError,'approved source|source.*hash|source.*size'):
            loader('synthetic_unreviewed_module',file,row)

    def test_packaging_import_closure_is_verified_before_execution_and_helpers_use_bound_modules(self):
        tool=self.tool();paths={'pack':'stage1/sandbox-package.py','release':'stage1/sandbox-release-inclusion.py','engine':'stage1/sandbox-engine-inclusion.py'}
        bodies={'pack':b"def read_release(): return _release_helper().VALUE\ndef read_engine(): return _engine_helper().VALUE\n",'release':b"VALUE='reviewed release bytes'\n",'engine':b"VALUE='reviewed engine bytes'\n"}
        rows={paths[k]:{'path':paths[k],'size':len(b),'sha256':hashlib.sha256(b).hexdigest()} for k,b in bodies.items()}
        data={str(tool.ROOT/paths[k]):b for k,b in bodies.items()}
        with patch.object(tool,'stable',side_effect=lambda p:data[str(p)]):pack=tool.load_verified_packaging(rows)
        self.assertEqual(pack.read_release(),'reviewed release bytes');self.assertEqual(pack.read_engine(),'reviewed engine bytes')
        dangerous=b"raise RuntimeError('PACK_EXECUTED_BEFORE_CLOSURE_VERIFIED')\n"
        data[str(tool.ROOT/paths['pack'])]=dangerous;rows[paths['pack']]={'path':paths['pack'],'size':len(dangerous),'sha256':hashlib.sha256(dangerous).hexdigest()}
        rows[paths['release']]['sha256']='f'*64
        with patch.object(tool,'stable',side_effect=lambda p:data[str(p)]),self.assertRaisesRegex(RuntimeError,'approved source size/hash'):
            tool.load_verified_packaging(rows)

    def test_qa_artifacts_require_independent_root_closure_approval_and_exact_two_hash_bindings(self):
        tool=self.tool();check=getattr(tool,'validate_qa_approval',None)
        self.assertTrue(callable(check),'QA closure approval binding is missing')
        record={'purpose':'Root reviewed QA-only compiler closure','approved':True,
                'manifestSha256':'a'*64,'blobSha256':'b'*64,
                'packages':80,'files':7234,'programBytes':88240285,'allFramesVerified':True,
                'noBusinessDataIncluded':True,'enteredProductRelease':False,'vendorEntryExecuted':False,
                'previous7225FilesUnchanged':True,'approvedAddedPeer':{'name':'react-is','version':'16.13.1','files':9,'bytes':23954},
                'react19FragmentCompatibilityFullyVerified':False}
        rows={name:{'path':name,'size':1,'sha256':record[field]} for name,field in (
            ('stage1/test-tools/renderer-build-tool-manifest.json','manifestSha256'),
            ('stage1/test-tools/renderer-build-dependencies.blob','blobSha256'))}
        self.assertTrue(check(record,rows))
        for field,value in (('approved',False),('packages',79),('files',7225),('programBytes',88216331),('allFramesVerified',False),('enteredProductRelease',True),('vendorEntryExecuted',True),('blobSha256','f'*64)):
            with self.subTest(field=field),self.assertRaises(RuntimeError):check({**record,field:value},rows)


if __name__=='__main__':unittest.main()
