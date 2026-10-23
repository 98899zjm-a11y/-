"""Pure attachment validation/authority tests: no app, SQL, files or service starts."""
import base64
import contextlib
import importlib.util
import io
import json
from pathlib import Path
import struct
import sys
import types
import unittest
from unittest.mock import patch
import uuid
import zlib

ROOT=Path(__file__).resolve().parent.parent
SOURCE=ROOT/'project'/'desktop'/'legacy-source'/'ledger'

def load(name, filename):
    spec=importlib.util.spec_from_file_location(name,filename)
    module=importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    return module

values=load('erp_values_pure_attachment_test',SOURCE/'erp_values.py')
def forbidden(*args,**kwargs):raise AssertionError('Pure test must not access databases or services')
fake_app=types.ModuleType('app');fake_app.db=types.SimpleNamespace(now_str=lambda:'2026-10-14 12:00:00')
fake_config=types.SimpleNamespace(data_dir=forbidden)
fake_app.config=fake_config
fake_common=types.ModuleType('erp_common')
fake_common.transaction=forbidden
fake_common.one=forbidden
fake_common.has_sensitive=lambda actor: values.permitted(actor,'erp.reports.sensitive')
fake_common.document=lambda connection,doc_id: connection.documents[doc_id]
with patch.dict(sys.modules,{'app':fake_app,'erp_common':fake_common,'erp_values':values}):
    attachments=load('erp_attachments_pure_test',SOURCE/'erp_attachments.py')

def png():
    def chunk(kind,body):return struct.pack('>I',len(body))+kind+body+struct.pack('>I',zlib.crc32(kind+body))
    return b'\x89PNG\r\n\x1a\n'+chunk(b'IHDR',struct.pack('>IIBBBBB',1,1,8,6,0,0,0))+chunk(b'IDAT',zlib.compress(b'\x00\x80\x80\x80\xff'))+chunk(b'IEND',b'')

def pdf():
    body=b'%PDF-1.4\n';offsets=[]
    for index,definition in enumerate((b'<< /Type /Catalog /Pages 2 0 R >>',b'<< /Type /Pages /Kids [] /Count 0 >>'),1):
        offsets.append(len(body));body+=str(index).encode()+b' 0 obj\n'+definition+b'\nendobj\n'
    start=len(body);body+=b'xref\n0 3\n0000000000 65535 f \n'+b''.join(f'{offset:010d} 00000 n \n'.encode() for offset in offsets)
    return body+b'trailer\n<< /Size 3 /Root 1 0 R >>\nstartxref\n'+str(start).encode()+b'\n%%EOF\n'

def jpeg():
    # A baseline one-component 1x1 image: quantization ones, a single DC=0
    # category and AC end-of-block Huffman symbol, with legal entropy padding.
    # Pure binary fixture, independent of optional image-decoder packages.
    def marker(kind,body):return b'\xff'+bytes([kind])+struct.pack('>H',len(body)+2)+body
    counts=b'\x01'+b'\x00'*15
    return b'\xff\xd8'+marker(0xdb,b'\x00'+b'\x01'*64)+marker(0xc0,struct.pack('>BHHB',8,1,1,1)+b'\x01\x11\x00')+marker(0xc4,b'\x00'+counts+b'\x00')+marker(0xc4,b'\x10'+counts+b'\x00')+marker(0xda,b'\x01\x01\x00\x00\x3f\x00')+b'\x3f\xff\xd9'

def actor(owner='owner',sensitive=False,read=True):
    return {'protocolVersion':2,'access':'operate','staffId':owner,'name':'虚构测试人','capabilities':(['erp.read'] if read else [])+['erp.attachments.write']+(['erp.reports.sensitive'] if sensitive else [])}

class Connection:
    def __init__(self,documents):self.documents={row['id']:row for row in documents}
    def execute(self,sql,args):return [row for row in self.documents.values() if args[0] in row['payload']]

def doc(kind='receivable',direction=None,target=None):
    payload={'attachments':[str(uuid.UUID(int=1))]}
    if direction:payload['direction']=direction
    if target:payload['targetId']=target
    return {'id':str(uuid.uuid4()),'kind':kind,'payload':json.dumps(payload)}

class Attachments(unittest.TestCase):
    def test_real_png_jpeg_and_pdf_signatures_are_accepted(self):
        for name,mime,body in [('虚构凭证.png','image/png',png()),('凭证.jpg','image/jpeg',jpeg()),('凭证.pdf','application/pdf',pdf())]:
            with self.subTest(name=name):
                value={'requestId':str(uuid.uuid4()),'name':name,'mime':mime,'bodyBase64':base64.b64encode(body).decode()}
                metadata,decoded=attachments.validate_upload(value)
                self.assertEqual(decoded,body);self.assertEqual(metadata['size'],len(body));self.assertEqual(metadata['name'],name)

    def test_file_names_cannot_be_paths_streams_urls_devices_or_controls(self):
        for name in ('../x.png','folder/x.png',r'folder\x.png','F:\\x.png','receipt.png:stream','https://site/x.png','NUL.png','COM1.jpg','bad\x00.png','a\n.png','x.png.','x.png ','＃：凭证.png'):
            with self.subTest(name=repr(name)):
                with self.assertRaises(values.ErpError):attachments.validate_upload({'requestId':str(uuid.uuid4()),'name':name,'mime':'image/png','bodyBase64':base64.b64encode(png()).decode()})

    def test_strict_base64_type_signature_size_and_uuid(self):
        good={'requestId':str(uuid.uuid4()),'name':'虚构凭证.png','mime':'image/png','bodyBase64':base64.b64encode(png()).decode()}
        for changes in ({'requestId':'not-uuid'},{'mime':'text/html'},{'mime':[]},{'mime':{}},{'bodyBase64':'%%%='},{'bodyBase64':good['bodyBase64']+'\n'},{'bodyBase64':''},{'bodyBase64':base64.b64encode(b'not a picture').decode()},{'bodyBase64':base64.b64encode(png()+b'<script>bad</script>').decode()},{'bodyBase64':base64.b64encode(b'x'*(2*1024*1024+1)).decode()}):
            with self.subTest(changes=list(changes)):
                with self.assertRaises(values.ErpError):attachments.validate_upload(good|changes)
        broken=bytearray(png());broken[29]^=1
        with self.assertRaises(values.ErpError):attachments.validate_upload(good|{'bodyBase64':base64.b64encode(broken).decode()})

    def test_uuid_alone_and_sensitive_capability_do_not_expose_unattached_other_owner_file(self):
        row={'id':str(uuid.UUID(int=1)),'owner_id':'owner'}
        attachments.authorize_download(Connection([]),actor(),row)
        for user in (actor('other'),actor('other',True),actor('owner',read=False)):
            with self.subTest(user=user['staffId']):
                with self.assertRaises(values.ErpError):attachments.authorize_download(Connection([]),user,row)

    def test_exact_visible_link_grants_nonowner_read_but_not_substring_link(self):
        row={'id':str(uuid.UUID(int=1)),'owner_id':'owner'}
        visible=doc();attachments.authorize_download(Connection([visible]),actor('other'),row)
        wrong=doc();wrong['payload']=json.dumps({'attachments':[row['id']+'-suffix']})
        with self.assertRaises(values.ErpError):attachments.authorize_download(Connection([wrong]),actor('other'),row)

    def test_sensitive_and_mixed_links_require_cost_access_even_for_owner(self):
        row={'id':str(uuid.UUID(int=1)),'owner_id':'owner'}
        for restricted in (doc('purchase'),doc('receipt'),doc('opening_payable'),doc('settlement','pay')):
            for links in ([restricted],[doc(),restricted]):
                with self.subTest(kind=restricted['kind'],mixed=len(links)>1):
                    with self.assertRaises(values.ErpError):attachments.authorize_download(Connection(links),actor(),row)
                    attachments.authorize_download(Connection(links),actor(sensitive=True),row)

    def test_reversal_of_payable_cannot_hide_sensitive_attachment(self):
        original=doc('receipt');reversal=doc('reversal',target=original['id'])
        original['payload']=json.dumps({'attachments':[]})
        row={'id':str(uuid.UUID(int=1)),'owner_id':'owner'}
        with self.assertRaises(values.ErpError):attachments.authorize_download(Connection([original,reversal]),actor(),row)
        attachments.authorize_download(Connection([original,reversal]),actor(sensitive=True),row)

    def test_duplicate_upload_checks_request_before_decoding_or_writing_new_blob(self):
        value={'requestId':str(uuid.uuid4()),'name':'虚构凭证.png','mime':'image/png','bodyBase64':base64.b64encode(png()).decode()}
        hashed=values.digest({key:value[key] for key in ('name','mime','bodyBase64')})
        prior={'id':str(uuid.uuid4()),'request_hash':hashed,'name':value['name'],'mime':value['mime'],'size':len(png()),'sha256':'a'*64,'created_at':'2026-10-14 12:00:00'}
        @contextlib.contextmanager
        def tx():yield object()
        with patch.object(attachments,'transaction',tx),patch.object(attachments,'one',return_value=prior),patch.object(attachments,'_file',return_value=object()),patch.object(attachments,'_decoded',side_effect=AssertionError('Duplicate request must not decode again')),patch.object(attachments,'_storage',side_effect=AssertionError('Duplicate request must not write storage')):
            self.assertEqual(attachments.upload(actor(),value)['id'],prior['id'])
            with self.assertRaises(values.ErpError) as rejected:attachments.upload(actor(),value|{'name':'另一个凭证.png'})
            self.assertEqual(rejected.exception.status,409)

    def test_commit_failure_removes_new_file_and_leaves_no_downloadable_identity(self):
        blobs={}
        class MemoryPath:
            def __init__(self,name):self.name=name
            def __truediv__(self,name):return MemoryPath(self.name+'/'+name)
            def exists(self):return self.name in blobs
            def unlink(self,missing_ok=False):blobs.pop(self.name,None)
            def open(self,mode):
                self_path=self
                class Output(io.BytesIO):
                    def fileno(self):return 123
                    def __exit__(self,*args):blobs[self_path.name]=self.getvalue();return super().__exit__(*args)
                return Output()
        def replace(source,target):blobs[target.name]=blobs.pop(source.name)
        class MemoryConnection:
            def execute(self,*args):return None
        @contextlib.contextmanager
        def tx():
            yield MemoryConnection()
            raise RuntimeError('synthetic SQLite commit failure')
        value={'requestId':str(uuid.uuid4()),'name':'虚构凭证.png','mime':'image/png','bodyBase64':base64.b64encode(png()).decode()}
        with patch.object(attachments,'transaction',tx),patch.object(attachments,'one',return_value=None),patch.object(attachments,'_storage',return_value=(MemoryPath('owned'),MemoryPath('owned/attachments'))),patch.object(attachments,'_checked_path',side_effect=lambda p,*args:p),patch.object(attachments.os,'fsync'),patch.object(attachments.os,'replace',side_effect=replace):
            with self.assertRaisesRegex(RuntimeError,'commit failure'):attachments.upload(actor(),value)
        self.assertEqual(blobs,{},'A failed commit must clean both temporary and final owned blobs')

if __name__=='__main__':unittest.main(verbosity=2)
