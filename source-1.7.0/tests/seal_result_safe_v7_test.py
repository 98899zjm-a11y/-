"""Pure manifest-delta checks; no packaging, VM, engine or business launch."""
from pathlib import Path
import importlib.util
import unittest

ROOT=Path(__file__).resolve().parent.parent
FILE=ROOT/'stage1/seal-result-safe-v7.py'


class ManifestDelta(unittest.TestCase):
    def module(self):
        self.assertTrue(FILE.is_file(),'Strict v7 manifest delta sealer absent')
        spec=importlib.util.spec_from_file_location('strict_v7_delta',FILE)
        module=importlib.util.module_from_spec(spec);spec.loader.exec_module(module)
        return module

    def fixture(self,module):
        row=lambda name,sha:{'path':name,'size':1,'sha256':sha}
        previous=[row(name,'a'*64) for name in module.CHANGED]
        previous.append(row('release-candidate/resources/app.asar','b'*64))
        approved={**module.CHANGED,**{name:'c'*64 for name in module.ADDED}}
        approved.update(module.FROZEN_ADDITIONS)
        current=[row(item['path'],approved.get(item['path'],item['sha256'])) for item in previous]
        current += [row(name,approved[name]) for name in module.ADDED]
        manifest=lambda rows:{'version':1,'fileCount':len(rows),'totalBytes':len(rows),'files':rows,'releaseInclusion':{'sealed':True},'engineInclusion':{'sealed':True}}
        return manifest(previous),manifest(current),approved

    def test_accepts_only_exact_frozen_changed_and_added_set(self):
        module=self.module();old,new,approved=self.fixture(module)
        result=module.validate_delta(old,new,approved)
        self.assertEqual(set(result['changed']),set(module.CHANGED))
        self.assertEqual(set(result['added']),set(module.ADDED))

    def test_resource_change_extra_missing_and_case_alias_are_refused(self):
        module=self.module()
        for mode in ('resource','extra','missing','alias','engine-metadata','unexpected-approval','wrong-frozen-sha'):
            old,new,approved=self.fixture(module)
            with self.subTest(mode=mode):
                if mode=='resource':new['files'][2]['sha256']='d'*64
                elif mode=='extra':new['files'].append({'path':'stage1/unapproved.cjs','size':1,'sha256':'d'*64});new['fileCount']+=1;new['totalBytes']+=1
                elif mode=='missing':new['files'].pop();new['fileCount']-=1;new['totalBytes']-=1
                elif mode=='alias':new['files'][-1]['path']=new['files'][0]['path'].upper()
                elif mode=='engine-metadata':new['engineInclusion']={'sealed':False}
                elif mode=='unexpected-approval':approved['project/desktop/backend.cjs']='d'*64
                elif mode=='wrong-frozen-sha':approved['stage1/io-guard.cjs']='d'*64
                with self.assertRaises((RuntimeError,AssertionError)):
                    module.validate_delta(old,new,approved)


if __name__=='__main__':unittest.main()
