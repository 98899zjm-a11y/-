"""No business imports: real filesystem/signature checks in owned tests fixtures."""
import hashlib
import hmac
import importlib.util
import json
import os
from pathlib import Path
import stat
import sys
import tempfile
import unittest

TESTS=Path(__file__).resolve().parent
SOURCE=TESTS.parent/'project'/'desktop'/'legacy-source'/'desktop_runtime_context.py'
FIXTURES=TESTS/'release-layout-fixtures'
TOKEN='0123456789abcdef'*4
HOST_ID='4f846a11-78fc-4fc2-bef5-2b7e2d6d31ee'

def owned(value):
    value=Path(value).absolute()
    if not value.is_relative_to(TESTS) or value==TESTS:raise AssertionError('Fixture target escaped tests')
    for current in [value,*value.parents]:
        if current.exists() and (current.is_symlink() or current.lstat().st_file_attributes & getattr(stat,'FILE_ATTRIBUTE_REPARSE_POINT',0)):raise AssertionError('Fixture creation follows a link')
        if current==TESTS:break
    return value

def cleanup(root):
    root=owned(root);base=owned(FIXTURES).resolve(strict=True)
    if root.resolve(strict=True)!=root or not root.is_relative_to(base) or not root.name.startswith('python-'):raise AssertionError('Cleanup requires exact owned fixture')
    if json.loads((root/'.test-owner.json').read_text('utf-8')).get('purpose')!='release-layout-test':raise AssertionError('Cleanup ownership marker mismatch')
    def remove(item):
        if not item.is_relative_to(root):raise AssertionError('Cleanup escaped fixture')
        info=item.lstat()
        if stat.S_ISLNK(info.st_mode) or getattr(info,'st_file_attributes',0)&getattr(stat,'FILE_ATTRIBUTE_REPARSE_POINT',0x400):
            if os.path.isjunction(item):item.rmdir()
            else:item.unlink()
        elif stat.S_ISDIR(info.st_mode):
            for child in item.iterdir():remove(child)
            item.rmdir()
        elif stat.S_ISREG(info.st_mode):item.unlink()
        else:raise AssertionError('Unexpected fixture type')
    remove(root)

def fixture(test_case):
    owned(FIXTURES).mkdir(exist_ok=True)
    root=Path(tempfile.mkdtemp(prefix='python-',dir=FIXTURES));owned(root);(root/'.test-owner.json').write_text('{"purpose":"release-layout-test"}',encoding='utf-8');test_case.addCleanup(cleanup,root)
    data=root/'虚构账套';profile=root/'profile';runtime=profile/'module-runtime';code=root/'code'
    for value in [data,profile,runtime,code]:owned(value).mkdir(parents=True,exist_ok=True)
    return root,dict(version=1,purpose='xjy-desktop-module',module='ledger',hostId=HOST_ID,dataDir=str(data.resolve()),profileDir=str(profile.resolve()),runtimeDir=str(runtime.resolve()),retainedDir=str(profile.resolve()/'retained'),codeDir=str(code.resolve()))

def canonical(context):return json.dumps(context,ensure_ascii=False,sort_keys=True,separators=(',',':'))
def sign(raw,token=TOKEN):return hmac.new(token.encode('utf-8'),b'xjy-module-runtime-v1\0'+raw.encode('utf-8'),hashlib.sha256).hexdigest()
def module():
    if not SOURCE.is_file():raise AssertionError('Python desktop runtime context interface is missing')
    spec=importlib.util.spec_from_file_location('desktop_runtime_context',SOURCE);value=importlib.util.module_from_spec(spec);spec.loader.exec_module(value);return value
def publish(context,raw=None):
    filename=owned(Path(context['runtimeDir'])/'module-runtime-context.json');text=canonical(context) if raw is None else raw;filename.write_text(text,encoding='utf-8');return filename,sign(text)

class DesktopRuntimeContextTests(unittest.TestCase):
    def load(self,context,**patch):
        file,signature=publish(context);args=dict(moduleId='ledger',token=TOKEN,contextFile=file,signature=signature,expectedDataDir=context['dataDir']);args.update(patch);return module().load_desktop_context(**args)
    def test_valid_context_and_helpers_have_no_business_side_effects(self):
        _,context=fixture(self);loaded=self.load(context);self.assertEqual(loaded,context);self.assertEqual(module().retained_number_file(loaded),Path(context['retainedDir'])/'erp-number-reservations.json');self.assertEqual(module().erp_attachments_dir(loaded),Path(context['dataDir'])/'erp-attachments');self.assertEqual(list(Path(context['dataDir']).iterdir()),[]);self.assertFalse(Path(context['retainedDir']).exists())
    def test_bad_signatures_modules_expected_directories_and_short_token_fail(self):
        root,context=fixture(self)
        for patch in [dict(signature='0'*64),dict(moduleId='inventory'),dict(expectedDataDir=root/'code'),dict(token='short')]:
            with self.subTest(patch=patch),self.assertRaises(ValueError):self.load(context,**patch)
    def test_extra_duplicate_noncanonical_and_oversized_context_fail(self):
        _,context=fixture(self);m=module()
        for raw in [canonical({**context,'extra':'role'}),'{"version":1,'+canonical(context)[1:],json.dumps(context,ensure_ascii=False),' '*16385,canonical({**context,'version':True}),canonical({**context,'version':1.0})]:
            file,signature=publish(context,raw)
            with self.subTest(raw=raw[:70]),self.assertRaises(ValueError):m.load_desktop_context('ledger',TOKEN,file,signature,context['dataDir'])
    def test_safe_nested_onedir_allowed_but_reverse_and_retained_overlap_fail(self):
        _,context=fixture(self);nested=owned(Path(context['runtimeDir'])/'modules'/'ledger'/'hash');nested.mkdir(parents=True);self.assertEqual(self.load({**context,'codeDir':str(nested)})['codeDir'],str(nested));retained=owned(context['retainedDir']);retained.mkdir()
        for patch in [dict(codeDir=context['profileDir']),dict(codeDir=context['runtimeDir']),dict(codeDir=context['retainedDir']),dict(dataDir=context['profileDir']),dict(runtimeDir=context['codeDir']),dict(retainedDir=str(retained/'other'))]:
            with self.subTest(patch=patch),self.assertRaises(ValueError):self.load({**context,**patch})
    def test_relative_ads_unc_and_ancestor_links_are_refused(self):
        root,context=fixture(self)
        for value in ['relative',context['dataDir']+':stream','\\\\fixture-server\\data',str(root/'code')+'\\..\\profile']:
            with self.subTest(value=value),self.assertRaises(ValueError):self.load({**context,'dataDir':value})
        link=owned(root/'linked-data');os.symlink(context['dataDir'],link,target_is_directory=True);self.assertTrue(link.is_symlink())
        with self.assertRaises(ValueError):self.load({**context,'dataDir':str(link)})
    def test_singlelink_context_file_required_and_fixed_name_cannot_escape(self):
        root,context=fixture(self);filename,signature=publish(context);alias=owned(root/'alias.json');os.link(filename,alias);self.assertEqual(filename.stat().st_nlink,2)
        with self.assertRaises(ValueError):module().load_desktop_context('ledger',TOKEN,filename,signature,context['dataDir'])
        _,other=fixture(self);file,signature=publish(other);side=owned(Path(other['runtimeDir'])/'other.json');side.write_bytes(file.read_bytes())
        with self.assertRaises(ValueError):module().load_desktop_context('ledger',TOKEN,side,signature,other['dataDir'])
    def test_same_named_context_in_sibling_runtime_cannot_claim_original_runtime(self):
        root,context=fixture(self);file,signature=publish(context);sibling=owned(Path(context['profileDir'])/'other-runtime');sibling.mkdir();other=owned(sibling/'module-runtime-context.json');other.write_bytes(file.read_bytes())
        with self.assertRaises(ValueError):module().load_desktop_context('ledger',TOKEN,other,signature,context['dataDir'])
    def test_context_symlink_and_helper_target_links_are_revalidated(self):
        root,context=fixture(self);file,signature=publish(context);m=module();loaded=m.load_desktop_context('ledger',TOKEN,file,signature,context['dataDir']);target=owned(root/'keep.json');target.write_bytes(file.read_bytes());file.unlink();os.symlink(target,file);self.assertTrue(file.is_symlink())
        with self.assertRaises(ValueError):m.load_desktop_context('ledger',TOKEN,file,signature,context['dataDir'])
        retained=owned(context['retainedDir']);retained.mkdir();number=owned(retained/'erp-number-reservations.json');os.link(target,number);self.assertEqual(number.stat().st_nlink,2)
        with self.assertRaises(ValueError):m.retained_number_file(loaded)
        attachments=owned(Path(context['dataDir'])/'erp-attachments');os.symlink(context['codeDir'],attachments,target_is_directory=True);self.assertTrue(attachments.is_symlink())
        with self.assertRaises(ValueError):m.erp_attachments_dir(loaded)

def cli():
    # -I deliberately ignores locale env: use protocol UTF-8, not Windows GBK.
    sys.stdin.reconfigure(encoding='utf-8');sys.stdout.reconfigure(encoding='utf-8')
    mode=sys.argv[1];payload=json.load(sys.stdin)
    if mode=='--emit':
        raw=canonical(payload['context']);print(json.dumps(dict(canonicalJson=raw,signature=sign(raw,payload['token'])),ensure_ascii=False));return
    try:
        loaded=module().load_desktop_context(**payload)
        if mode=='--check':print('{"rejected":false}');return
        print(json.dumps(dict(context=loaded,numberFile=str(module().retained_number_file(loaded)),attachmentsDir=str(module().erp_attachments_dir(loaded))),ensure_ascii=False))
    except ValueError:
        if mode!='--check':raise
        print('{"rejected":true}')

if __name__=='__main__':
    if len(sys.argv)>1 and sys.argv[1] in ('--load','--emit','--check'):cli()
    else:unittest.main()
