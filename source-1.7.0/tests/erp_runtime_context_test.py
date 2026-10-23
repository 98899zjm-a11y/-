"""Pure fake-FS provider seams; never imports/runs sidecar_release or business app."""
import ast
import hashlib
import hmac
import importlib.util
import json
import os
from pathlib import Path
import stat
import sys
import tempfile
import types
import unittest
from unittest.mock import patch
import uuid

TESTS=Path(__file__).resolve().parent
ROOT=TESTS.parent
SOURCE=ROOT/'project'/'desktop'/'legacy-source'
LEDGER=SOURCE/'ledger'
FIXTURES=TESTS/'erp-runtime-fixtures'
TOKEN='0123456789abcdef'*4
HOST_ID='4f846a11-78fc-4fc2-bef5-2b7e2d6d31ee'

def owned(value):
    value=Path(value).absolute()
    if value==TESTS or not value.is_relative_to(TESTS):raise AssertionError('Fixture escaped tests')
    for item in [value,*value.parents]:
        try:info=item.lstat()
        except FileNotFoundError:continue
        if stat.S_ISLNK(info.st_mode) or getattr(info,'st_file_attributes',0)&getattr(stat,'FILE_ATTRIBUTE_REPARSE_POINT',0x400):raise AssertionError('Fixture creation follows link')
        if item==TESTS:break
    return value

def load(name,file):
    if not file.is_file():raise AssertionError('Required pure runtime seam missing: '+file.name)
    spec=importlib.util.spec_from_file_location(name,file);module=importlib.util.module_from_spec(spec);spec.loader.exec_module(module);return module

def cleanup(root):
    root=owned(root);base=owned(FIXTURES).resolve(strict=True)
    if root.resolve(strict=True)!=root or not root.is_relative_to(base) or not root.name.startswith('case-'):raise AssertionError('Cleanup requires exact owned fixture')
    if json.loads((root/'.test-owner.json').read_text('utf-8')).get('purpose')!='erp-runtime-test':raise AssertionError('Cleanup ownership mismatch')
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

def fixture(test_case,stage=False):
    owned(FIXTURES).mkdir(exist_ok=True);outer=Path(tempfile.mkdtemp(prefix='case-',dir=FIXTURES));owned(outer);(outer/'.test-owner.json').write_text('{"purpose":"erp-runtime-test"}',encoding='utf-8');test_case.addCleanup(cleanup,outer)
    root=outer/'xjy-web-stage1' if stage else outer
    data=root/'data'/'ledger' if stage else root/'虚构账套';profile=root/'profile';runtime=profile/'module-runtime'/'ledger';code=root/'code'
    for directory in [data,profile,runtime,code,profile/'retained',root/'config']:owned(directory).mkdir(parents=True,exist_ok=True)
    context=dict(version=1,purpose='xjy-desktop-module',module='ledger',hostId=HOST_ID,dataDir=str(data.resolve()),profileDir=str(profile.resolve()),runtimeDir=str(runtime.resolve()),retainedDir=str((profile/'retained').resolve()),codeDir=str(code.resolve()))
    raw=json.dumps(context,ensure_ascii=False,sort_keys=True,separators=(',',':'));file=owned(runtime/'module-runtime-context.json');file.write_text(raw,encoding='utf-8');signature=hmac.new(TOKEN.encode(),b'xjy-module-runtime-v1\0'+raw.encode(),hashlib.sha256).hexdigest()
    return root,context,file,signature

def provider():
    desktop=load('desktop_runtime_context_pure_seam',SOURCE/'desktop_runtime_context.py')
    with patch.dict(sys.modules,{'desktop_runtime_context':desktop}):return load('erp_runtime_pure_seam',LEDGER/'erp_runtime.py')

def forbidden(*args,**kwargs):raise AssertionError('No business DB/app/services in pure runtime seam test')

def business_paths(runtime,expected):
    values=load('erp_values_pure_runtime',LEDGER/'erp_values.py');app=types.ModuleType('app');app.config=types.SimpleNamespace(data_dir=lambda:expected);app.db=types.SimpleNamespace(now_str=forbidden)
    common=types.ModuleType('erp_common')
    for name in ('transaction','one','has_sensitive','document'):setattr(common,name,forbidden)
    modules={'erp_runtime':runtime,'app':app,'erp_common':common,'erp_values':values}
    with patch.dict(sys.modules,modules):
        numbers=load('erp_numbers_pure_runtime',LEDGER/'erp_numbers.py');attachments=load('erp_attachments_pure_runtime',LEDGER/'erp_attachments.py')
    return modules,numbers,attachments

class ErpRuntimeSeams(unittest.TestCase):
    def test_signed_release_provider_selects_paths_and_never_creates_data_or_accounts(self):
        root,context,file,signature=fixture(self);p=provider()
        with patch.dict(os.environ,{},clear=True):
            self.assertIsNone(p.release_context());self.assertIsNone(p.attachments_storage([context['dataDir']]))
            p.configure_release_context('ledger',TOKEN,file,signature,context['dataDir']);number,namespace=p.number_store();self.assertEqual(number,Path(context['retainedDir'])/'erp-number-reservations.json');self.assertEqual(namespace,HOST_ID)
            owner,directory=p.attachments_storage([context['dataDir']],create=False);self.assertEqual(owner,Path(context['dataDir']));self.assertEqual(directory,owner/'erp-attachments');self.assertFalse(directory.exists());self.assertFalse(number.exists());self.assertEqual(list(owner.iterdir()),[])
    def test_release_cannot_be_selected_by_environment_flags_or_bad_signature(self):
        _,context,file,signature=fixture(self);p=provider()
        with patch.dict(os.environ,{'XJY_RELEASE':'1','XJY_MODULE_CONTEXT_FILE':str(file),'XJY_MODULE_CONTEXT_SIGNATURE':signature,'XJY_MODULE_TOKEN':TOKEN},clear=True):self.assertIsNone(p.release_context())
        with patch.dict(os.environ,{},clear=True),self.assertRaises(ValueError):p.configure_release_context('ledger',TOKEN,file,'0'*64,context['dataDir'])
        with patch.dict(os.environ,{'XJY_STAGE1_ROOT':'not-a-release-root'},clear=True),self.assertRaises(ValueError):p.configure_release_context('ledger',TOKEN,file,signature,context['dataDir'])
        with patch.dict(os.environ,{},clear=True),self.assertRaises(ValueError):p.configure_release_context('inventory',TOKEN,file,signature,context['dataDir'])
    def test_release_number_reservations_use_host_namespace_and_reject_foreign_state(self):
        _,context,file,signature=fixture(self);p=provider();modules,numbers,_=business_paths(p,context['dataDir'])
        with patch.dict(os.environ,{},clear=True),patch.dict(sys.modules,modules):
            p.configure_release_context('ledger',TOKEN,file,signature,context['dataDir']);first=numbers.reserve('purchase','2026-10-14',str(uuid.UUID(int=1)));second=numbers.reserve('purchase','2026-10-14',str(uuid.UUID(int=2)));self.assertEqual((first,second),('CG-20261014-000001','CG-20261014-000002'))
            saved=json.loads(numbers.store_path().read_text('utf-8'));self.assertEqual(saved['version'],1);self.assertEqual(saved['namespace'],HOST_ID);saved['namespace']='foreign';numbers.store_path().write_text(json.dumps(saved),encoding='utf-8')
            with self.assertRaises(ValueError):numbers.reserve('purchase','2026-10-14',str(uuid.UUID(int=3)))
    def test_release_attachment_owner_is_bound_to_host_and_existing_config(self):
        _,context,file,signature=fixture(self);p=provider();modules,_,attachments=business_paths(p,context['dataDir'])
        with patch.dict(os.environ,{'LEDGER_DATA':context['dataDir']},clear=True),patch.dict(sys.modules,modules):
            p.configure_release_context('ledger',TOKEN,file,signature,context['dataDir']);root,directory=attachments._storage(create=True);self.assertEqual(root,Path(context['dataDir']));owner=json.loads((directory/'.owner.json').read_text('utf-8'));self.assertEqual(owner,{'version':1,'namespace':HOST_ID,'type':'erp-attachments'});self.assertEqual(attachments._storage(),(root,directory))
            owner['namespace']='foreign';(directory/'.owner.json').write_text(json.dumps(owner),encoding='utf-8')
            with self.assertRaises(ValueError):attachments._storage()
        with patch.dict(os.environ,{},clear=True),self.assertRaises(ValueError):p.attachments_storage([context['codeDir']],create=False)
    def test_provider_rechecks_context_links_and_never_adopts_unowned_attachment_files(self):
        root,context,file,signature=fixture(self);p=provider()
        with patch.dict(os.environ,{},clear=True):
            p.configure_release_context('ledger',TOKEN,file,signature,context['dataDir']);directory=owned(Path(context['dataDir'])/'erp-attachments');directory.mkdir();owned(directory/'unowned.bin').write_bytes(b'fake')
            with self.assertRaises(ValueError):p.attachments_storage([context['dataDir']],create=True)
            self.assertEqual((directory/'unowned.bin').read_bytes(),b'fake');self.assertFalse((directory/'.owner.json').exists());alias=owned(root/'context-alias.json');os.link(file,alias);self.assertEqual(file.stat().st_nlink,2)
            with self.assertRaises(ValueError):p.number_store()
    def test_stage_number_namespace_and_attachment_checks_remain_original(self):
        root,context,file,signature=fixture(self,stage=True);namespace='synthetic-stage-test';owned(root/'isolation-identity.json').write_text(json.dumps({'namespace':namespace}),encoding='utf-8');p=provider();modules,numbers,attachments=business_paths(p,context['dataDir']);env={'XJY_STAGE1_ROOT':str(root),'XJY_STAGE1_NAMESPACE':namespace,'LEDGER_DATA':context['dataDir']}
        with patch.dict(os.environ,env,clear=True),patch.dict(sys.modules,modules):
            self.assertEqual(numbers.store_path(),root/'config'/'erp-number-reservations.json');self.assertEqual(numbers.reserve('purchase','2026-10-14',str(uuid.UUID(int=4))),'CG-20261014-000001');self.assertEqual(json.loads(numbers.store_path().read_text('utf-8'))['namespace'],namespace);owner,directory=attachments._storage(create=True);self.assertEqual(owner,root);self.assertEqual(directory,root/'data'/'ledger'/'erp-attachments');self.assertFalse((directory/'.owner.json').exists())
            with patch.dict(os.environ,{'XJY_STAGE1_NAMESPACE':'wrong'}),self.assertRaises(RuntimeError):attachments._storage()
            with patch.dict(os.environ,{'LEDGER_DATA':context['codeDir']}),self.assertRaises(RuntimeError):attachments._storage()
    def test_release_wrapper_is_ast_clone_and_context_bootstrap_precedes_business_imports(self):
        original=(LEDGER/'sidecar.py').read_text('utf-8');shared=(SOURCE/'sidecar.py').read_text('utf-8');release=SOURCE/'sidecar_release.py';self.assertTrue(release.is_file(),'Release wrapper is missing')
        self.assertEqual(shared[:shared.index('import argparse\n')],original[:original.index('import argparse\n')],'Stage bootstrap guard must remain unchanged')
        self.assertEqual(ast.dump(ast.parse(shared[shared.index('import argparse\n'):])),ast.dump(ast.parse(original[original.index('import argparse\n'):])), 'Shared Stage wrapper must carry the latest known ledger authority')
        text=release.read_text('utf-8');marker='# XJY_RELEASE_BUSINESS_WRAPPER\n';self.assertIn(marker,text);prefix,tail=text.split(marker,1);original_tail=original[original.index('import argparse\n'):];self.assertEqual(ast.dump(ast.parse(tail)),ast.dump(ast.parse(original_tail)))
        tree=ast.parse(prefix);imports={alias.name for node in ast.walk(tree) if isinstance(node,ast.Import) for alias in node.names}|{node.module for node in ast.walk(tree) if isinstance(node,ast.ImportFrom)};self.assertFalse({'app','repairs','sqlite3','erp','external_sync'}&imports)
        calls=[node for node in ast.walk(tree) if isinstance(node,ast.Call)];self.assertTrue(any(isinstance(node.func,ast.Name) and node.func.id=='_load_desktop_context' for node in calls));self.assertTrue(any(isinstance(node.func,ast.Name) and node.func.id=='_configure_release_context' for node in calls));self.assertNotIn('XJY_STAGE1_ROOT',tail[:tail.index('def main')])

if __name__=='__main__':unittest.main(verbosity=2)
