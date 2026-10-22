"""Small protected ERP vouchers; no external URLs or user-selected file paths.

The sidecar installs python_guard before importing this module. A durable file
is published before its matching SQLite transaction commits. Ordinary failures
remove the unpublished file; a process crash can leave an unreferenced owned
blob, which has no downloadable database identity and is never executed.
"""
import base64
import binascii
import hashlib
import json
import os
from pathlib import Path
import re
import stat
import struct
import uuid
import zlib

from app import config, db
from erp_common import transaction, one, has_sensitive, document
from erp_values import ErpError, identifier, object_value, require, text, digest, encoded

MAX_BYTES=2*1024*1024
MIMES={'image/png':('.png',),'image/jpeg':('.jpg','.jpeg'),'application/pdf':('.pdf',)}

def _fields(value):
    object_value(value,{'requestId','name','mime','bodyBase64'},{'requestId','name','mime','bodyBase64'})
    request_id=identifier(value['requestId'])
    name=text(value['name'],150,True)
    if name!=value['name'] or re.search(r'[\\/:<>"|?*\x00-\x1f\x7f]',name) or name.endswith(('.', ' ')) or name in ('.','..'):
        raise ErpError('凭证文件名不能含路径、网址、数据流或控制字符。')
    if re.match(r'^(con|prn|aux|nul|com[1-9]|lpt[1-9])(?:\.|$)',name,re.I):
        raise ErpError('凭证文件名不能使用Windows设备名称。')
    mime=value['mime']
    if not isinstance(mime,str) or mime not in MIMES or not name.lower().endswith(MIMES[mime]):raise ErpError('仅接受扩展名一致的PNG、JPEG和PDF凭证。')
    raw=value['bodyBase64']
    if not isinstance(raw,str) or not raw:raise ErpError('凭证内容须为严格Base64文本。')
    if len(raw)>4*((MAX_BYTES+2)//3):raise ErpError('凭证不能超过2MiB。',413)
    return {'requestId':request_id,'name':name,'mime':mime},raw

def _png(body):
    if not body.startswith(b'\x89PNG\r\n\x1a\n'):return False
    offset=8;seen_header=False;seen_data=False
    try:
        while offset<len(body):
            if offset+12>len(body):return False
            length=struct.unpack('>I',body[offset:offset+4])[0]
            end=offset+12+length
            if end>len(body):return False
            kind=body[offset+4:offset+8];content=body[offset+8:offset+8+length]
            checksum=struct.unpack('>I',body[offset+8+length:end])[0]
            if not re.fullmatch(rb'[A-Za-z]{4}',kind) or zlib.crc32(kind+content)!=checksum:return False
            if not seen_header:
                if kind!=b'IHDR' or length!=13:return False
                width,height,depth,colour,compression,filtering,interlace=struct.unpack('>IIBBBBB',content)
                valid_depths={0:(1,2,4,8,16),2:(8,16),3:(1,2,4,8),4:(8,16),6:(8,16)}
                if not width or not height or width*height>40_000_000 or depth not in valid_depths.get(colour,()) or compression or filtering or interlace not in (0,1):return False
                seen_header=True
            elif kind==b'IHDR':return False
            if kind==b'IDAT':seen_data=seen_data or bool(length)
            if kind==b'IEND':return length==0 and seen_data and end==len(body)
            offset=end
    except (struct.error,ValueError):return False
    return False

def _jpeg(body):
    if not body.startswith(b'\xff\xd8') or not body.endswith(b'\xff\xd9'):return False
    offset=2;frame=False;scan=False
    frames={0xc0,0xc1,0xc2,0xc3,0xc5,0xc6,0xc7,0xc9,0xca,0xcb,0xcd,0xce,0xcf}
    try:
        while offset<len(body):
            if body[offset]!=0xff:return False
            while offset<len(body) and body[offset]==0xff:offset+=1
            if offset>=len(body):return False
            marker=body[offset];offset+=1
            if marker==0xd9:return frame and scan and offset==len(body)
            if marker in (0x00,0xd8) or 0xd0<=marker<=0xd7:return False
            if marker==0x01:continue
            if offset+2>len(body):return False
            length=struct.unpack('>H',body[offset:offset+2])[0]
            end=offset+length
            if length<2 or end>len(body):return False
            content=body[offset+2:end]
            if marker in frames:
                if len(content)<6:return False
                precision,height,width,components=struct.unpack('>BHHB',content[:6])
                if not width or not height or width*height>40_000_000 or precision not in (8,12,16) or components not in (1,3,4) or len(content)!=6+3*components:return False
                frame=True
            offset=end
            if marker==0xda:
                if not frame or len(content)<4 or len(content)!=4+2*content[0]:return False
                scan=True
                # Skip entropy-coded bytes, escaped FF and restart markers.
                while offset<len(body):
                    marker_at=body.find(b'\xff',offset)
                    if marker_at<0:return False
                    next_at=marker_at+1
                    while next_at<len(body) and body[next_at]==0xff:next_at+=1
                    if next_at>=len(body):return False
                    if body[next_at]==0 or 0xd0<=body[next_at]<=0xd7:offset=next_at+1;continue
                    offset=marker_at;break
    except (struct.error,ValueError,IndexError):return False
    return False

def _pdf(body):
    if not re.match(rb'%PDF-(?:1\.[0-7]|2\.0)(?:\r\n|\r|\n)',body):return False
    if not re.search(rb'%%EOF\s*$',body) or not re.search(rb'\b\d+\s+\d+\s+obj\b',body) or b'endobj' not in body:return False
    ending=re.search(rb'startxref\s+(\d{1,20})\s+%%EOF\s*$',body)
    if not ending:return False
    start=int(ending[1])
    if start>=len(body):return False
    return body[start:].startswith(b'xref') or bool(re.match(rb'\d+\s+\d+\s+obj\b',body[start:]) and b'/XRef' in body[start:])

def _decoded(raw,mime):
    try:body=base64.b64decode(raw,validate=True)
    except (binascii.Error,ValueError,UnicodeError):raise ErpError('凭证不是严格Base64内容。')
    if not body or len(body)>MAX_BYTES:raise ErpError('凭证内容为空或超过2MiB。',413 if len(body)>MAX_BYTES else 400)
    if base64.b64encode(body).decode('ascii')!=raw:raise ErpError('凭证Base64编码不规范。')
    if not {'image/png':_png,'image/jpeg':_jpeg,'application/pdf':_pdf}[mime](body):raise ErpError('凭证真实格式、完整签名或结尾与声明不一致。')
    return body

def validate_upload(value):
    """Pure parser used by upload and tests; does not touch files or SQLite."""
    fields,raw=_fields(value);body=_decoded(raw,fields['mime'])
    return {**fields,'size':len(body),'sha256':hashlib.sha256(body).hexdigest()},body

def _checked_path(candidate,root,base):
    candidate=Path(candidate)
    if not candidate.is_absolute() or not candidate.is_relative_to(root) or not candidate.is_relative_to(base):raise RuntimeError('ISOLATION: attachment outside owned storage')
    for part in (candidate,*candidate.parents):
        try:info=part.lstat()
        except FileNotFoundError:continue
        if stat.S_ISLNK(info.st_mode) or getattr(info,'st_file_attributes',0)&getattr(stat,'FILE_ATTRIBUTE_REPARSE_POINT',0x400) or os.path.isjunction(part) or stat.S_ISREG(info.st_mode) and info.st_nlink>1:
            raise RuntimeError('ISOLATION: attachment link, junction or hard link refused')
    canonical=candidate.resolve()
    if not canonical.is_relative_to(root.resolve()) or not canonical.is_relative_to(base.resolve()):raise RuntimeError('ISOLATION: attachment physical target escaped')
    return canonical

def _storage(create=False):
    from erp_runtime import attachments_storage, release_context
    if release_context() is not None:
        return attachments_storage((os.environ.get('LEDGER_DATA',''),config.data_dir()),create=create)
    # The original Stage namespace/data-slot checks remain unchanged below.
    raw=os.environ.get('XJY_STAGE1_ROOT','');root=Path(raw)
    if not raw or not root.is_absolute() or root.name!='xjy-web-stage1':raise RuntimeError('ISOLATION: attachment requires explicit test namespace')
    _checked_path(root,root,root)
    identity=json.loads((root/'isolation-identity.json').read_text('utf-8'))
    if identity.get('namespace')!=os.environ.get('XJY_STAGE1_NAMESPACE'):raise RuntimeError('ISOLATION: attachment namespace mismatch')
    expected=root/'data'/'ledger'
    for configured in (os.environ.get('LEDGER_DATA',''),config.data_dir()):
        if not configured or Path(configured)!=expected:raise RuntimeError('ISOLATION: ledger attachment configuration outside fixed test slot')
    _checked_path(expected,root,expected)
    directory=expected/'erp-attachments';_checked_path(directory,root,directory)
    if create:directory.mkdir(parents=True,exist_ok=True)
    _checked_path(directory,root,directory)
    return root,directory

def _public(row):return {'id':row['id'],'name':row['name'],'mime':row['mime'],'size':row['size'],'sha256':row['sha256'],'createdAt':row['created_at']}

def _file(row):
    root,directory=_storage();target=_checked_path(directory/(identifier(row['id'])+'.bin'),root,directory)
    try:info=target.stat()
    except FileNotFoundError:raise ErpError('凭证文件缺失，请从完整备份恢复。',409)
    if not stat.S_ISREG(info.st_mode) or info.st_size!=row['size'] or not 0<info.st_size<=MAX_BYTES:raise ErpError('凭证文件大小或类型校验失败。',409)
    with target.open('rb') as source:body=source.read(MAX_BYTES+1)
    if len(body)!=row['size'] or hashlib.sha256(body).hexdigest()!=row['sha256']:raise ErpError('凭证完整性校验失败，请恢复备份。',409)
    _checked_path(target,root,directory)
    return target

def _sensitive(c,row,seen=None):
    seen=set() if seen is None else seen
    if row['id'] in seen or len(seen)>8:raise ErpError('凭证来源关联异常，已拒绝读取。',403)
    seen.add(row['id']);payload=json.loads(row['payload'])
    if row['kind'] in ('purchase','receipt','opening_payable'):return True
    if row['kind']=='settlement':return payload.get('direction')=='pay'
    if row['kind']=='reversal':return _sensitive(c,document(c,payload['targetId']),seen)
    if row['kind'] not in ('receivable','opening_receivable'):raise ErpError('凭证来源类型未获授权。',403)
    return False

def authorize_download(c,actor,row):
    """Owner or exact visible document, with sensitive links taking priority."""
    require(actor,'erp.read')
    linked=[]
    for raw in c.execute('SELECT id,kind,payload FROM erp_documents WHERE instr(payload,?)>0',(row['id'],)):
        candidate=dict(raw)
        try:ids=json.loads(candidate['payload']).get('attachments',[])
        except (ValueError,TypeError,AttributeError):raise ErpError('凭证关联记录异常，已拒绝读取。',403)
        if isinstance(ids,list) and row['id'] in ids:linked.append(candidate)
    if any(_sensitive(c,item) for item in linked) and not has_sensitive(actor):raise ErpError('该凭证涉及采购或应付成本，请获得敏感财务权限。',403)
    if row['owner_id']!=actor['staffId'] and not linked:raise ErpError('没有读取该凭证的权限。',403)

def upload(actor,value):
    require(actor,'erp.attachments.write',write=True)
    fields,raw=_fields(value);hashed=digest({'name':fields['name'],'mime':fields['mime'],'bodyBase64':raw})
    created=None;temporary=None;root=None;directory=None;committed=False
    try:
        with transaction() as c:
            prior=one(c,'SELECT * FROM erp_attachments WHERE owner_id=? AND request_id=?',(actor['staffId'],fields['requestId']))
            if prior:
                if prior['request_hash']!=hashed:raise ErpError('同一凭证请求不能改用不同内容。',409)
                _file(prior)
                return _public(prior)
            body=_decoded(raw,fields['mime']);aid=str(uuid.uuid4());now=db.now_str();root,directory=_storage(create=True)
            target=_checked_path(directory/(aid+'.bin'),root,directory)
            if target.exists():raise ErpError('凭证标识冲突，操作未提交。',409)
            temporary=_checked_path(directory/(aid+'.'+str(uuid.uuid4())+'.tmp'),root,directory)
            with temporary.open('xb') as output:output.write(body);output.flush();os.fsync(output.fileno())
            _checked_path(temporary,root,directory);_checked_path(target,root,directory);os.replace(temporary,target);temporary=None;created=target
            row={'id':aid,'request_id':fields['requestId'],'request_hash':hashed,'owner_id':actor['staffId'],'name':fields['name'],'mime':fields['mime'],'size':len(body),'sha256':hashlib.sha256(body).hexdigest(),'created_at':now}
            c.execute('INSERT INTO erp_attachments(id,request_id,request_hash,owner_id,name,mime,size,sha256,created_at) VALUES(?,?,?,?,?,?,?,?,?)',tuple(row[key] for key in ('id','request_id','request_hash','owner_id','name','mime','size','sha256','created_at')))
            detail={'actor':actor['staffId'],'actorName':actor['name'],'table':'erp_attachments','id':aid,'before':None,'after':_public(row)}
            c.execute('INSERT INTO audit_logs(action,detail,at) VALUES(?,?,?)',('ERP 上传凭证',encoded(detail),now))
            result=_public(row)
        committed=True
        return result
    finally:
        # Never remove an existing idempotent file or a committed database file.
        for candidate in ([created] if created and not committed else [])+([temporary] if temporary else []):
            checked=_checked_path(candidate,root,directory)
            checked.unlink(missing_ok=True)

def download(actor,aid):
    require(actor,'erp.read');identifier(aid)
    with transaction() as c:
        row=one(c,'SELECT * FROM erp_attachments WHERE id=?',(aid,))
        if not row:raise ErpError('凭证不存在。',404)
        authorize_download(c,actor,row)
        return _file(row),_public(row)
