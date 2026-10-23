"""Pure desktop-only v8 delta rules; no process, packager or VM."""
from pathlib import Path
import importlib.util
import unittest

ROOT=Path(__file__).resolve().parent.parent
FILE=ROOT/'stage1/seal-desktop-safe-v8.py'


class DesktopDelta(unittest.TestCase):
    def module(self):
        self.assertTrue(FILE.is_file(),'Desktop-only v8 sealer absent')
        spec=importlib.util.spec_from_file_location('desktop_delta_test',FILE)
        module=importlib.util.module_from_spec(spec);spec.loader.exec_module(module)
        return module

    def fixture(self,tool):
        old=[{'path':name,'size':1,'sha256':'a'*64} for name in tool.CHANGED]
        old.append({'path':'release-candidate/resources/app.asar','size':1,'sha256':'b'*64})
        approved={name:'c'*64 for name in set(tool.CHANGED)|tool.ADDED};approved.update(tool.FROZEN)
        new=[dict(row,sha256=approved.get(row['path'],row['sha256'])) for row in old]
        new += [{'path':name,'size':1,'sha256':approved[name]} for name in tool.ADDED]
        manifest=lambda rows:{'version':1,'fileCount':len(rows),'totalBytes':len(rows),'files':rows,'releaseInclusion':{'fixed':True},'engineInclusion':{'fixed':True}}
        return manifest(old),manifest(new),approved

    def test_only_two_QA_changes_and_six_scope_tool_additions_are_accepted(self):
        tool=self.module();old,new,approved=self.fixture(tool)
        delta=tool.validate_delta(old,new,approved)
        self.assertEqual(set(delta['changed']),set(tool.CHANGED));self.assertEqual(set(delta['added']),tool.ADDED)

    def test_business_mutation_browser_removal_and_extra_input_fail_closed(self):
        tool=self.module()
        for mode in ('business','missing','extra','engine','wrong-scope-sha','case-alias'):
            old,new,approved=self.fixture(tool)
            with self.subTest(mode=mode):
                if mode=='business':new['files'][2]['sha256']='d'*64
                elif mode=='missing':new['files'].pop();new['fileCount']-=1;new['totalBytes']-=1
                elif mode=='extra':approved['stage1/ignore-any-failure.py']='d'*64
                elif mode=='engine':new['engineInclusion']={'fixed':False}
                elif mode=='wrong-scope-sha':approved['stage1/guest-result-scope-aggregation.ps1']='d'*64
                elif mode=='case-alias':new['files'][-1]['path']=new['files'][0]['path'].upper()
                with self.assertRaises((RuntimeError,AssertionError)):tool.validate_delta(old,new,approved)


if __name__=='__main__':unittest.main()
