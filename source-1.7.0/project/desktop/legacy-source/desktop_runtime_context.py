"""Pure signed desktop layout loader; actor authority stays in the principal gate.

No database, account, environment mutation or directory creation occurs here.
The caller provides a private module token and separately delivered signature.
"""
import hashlib
import hmac
import json
import os
from pathlib import Path
import re
import stat

_FIELDS={'version','purpose','module','hostId','dataDir','profileDir','runtimeDir','retainedDir','codeDir'}
_PREFIX=b'xjy-module-runtime-v1\0'
_FILE='module-runtime-context.json'
_MAX=16*1024

def _fail(message):raise ValueError('DESKTOP_RUNTIME: '+message)

def _token(token):
    if not isinstance(token,str):_fail('invalid module token')
    raw=token.encode('utf-8')
    if not 32<=len(raw)<=1024 or re.search(r'[\x00-\x1f\x7f]',token):_fail('invalid module token')
    return raw

def _normal(value):
    value=os.fspath(value) if isinstance(value,Path) else value
    if not isinstance(value,str) or not value or len(value)>4096 or re.search(r'[\x00-\x1f\x7f]',value) or re.match(r'^[\\/]{2}',value):_fail('ordinary local absolute path required')
    if os.name=='nt':
        if not re.match(r'^[A-Za-z]:[\\/]',value):_fail('ordinary local absolute path required')
        tail=value[3:]
    else:
        if not os.path.isabs(value) or '\\' in value:_fail('ordinary local absolute path required')
        tail=value[1:]
    if ':' in tail or any(part in ('.','..') or re.search(r'[. ]$',part) or re.match(r'^(con|prn|aux|nul|com[1-9]|lpt[1-9])(?:\.|$)',part,re.I) for part in re.split(r'[\\/]',tail)):_fail('path alias, stream or device refused')
    return Path(os.path.abspath(value))

def _checked(value,kind='directory',allow_missing=False):
    absolute=_normal(value);selected=None
    for current in [absolute,*absolute.parents]:
        try:info=current.lstat()
        except FileNotFoundError:continue
        if stat.S_ISLNK(info.st_mode) or getattr(info,'st_file_attributes',0)&getattr(stat,'FILE_ATTRIBUTE_REPARSE_POINT',0):_fail('linked path refused')
        if current==absolute:selected=info
        elif not stat.S_ISDIR(info.st_mode):_fail('path ancestor is not a directory')
    if selected is None:
        if not allow_missing:_fail('path must already exist')
        return absolute.resolve(strict=False)
    if kind=='directory' and not stat.S_ISDIR(selected.st_mode) or kind=='file' and (not stat.S_ISREG(selected.st_mode) or selected.st_nlink!=1):_fail('wrong path type or hardlinked file')
    return absolute.resolve(strict=True)

def _same(a,b):return os.path.normcase(str(a))==os.path.normcase(str(b))
def _inside(parent,child):
    try:return os.path.commonpath([os.path.normcase(str(parent)),os.path.normcase(str(child))])==os.path.normcase(str(parent))
    except ValueError:return False
def _overlap(a,b):return _inside(a,b) or _inside(b,a)

def _validate(context):
    if not isinstance(context,dict) or set(context)!=_FIELDS:_fail('unexpected fields')
    if type(context['version']) is not int or context['version']!=1 or context['purpose']!='xjy-desktop-module' or context['module'] not in ('ledger','inventory') or not isinstance(context['hostId'],str) or not re.fullmatch(r'[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}',context['hostId']):_fail('invalid context identity')
    if any(not isinstance(context[name],str) for name in ('dataDir','profileDir','runtimeDir','retainedDir','codeDir')):_fail('context paths must be strings')
    data=_checked(context['dataDir']);profile=_checked(context['profileDir']);runtime=_checked(context['runtimeDir']);code=_checked(context['codeDir']);retained=_checked(context['retainedDir'],allow_missing=True)
    if not _same(retained,profile/'retained'):_fail('retained directory is fixed')
    if _same(profile,runtime) or not _inside(profile,runtime):_fail('runtime must be below profile')
    if _overlap(data,profile) or _overlap(data,code) or _inside(code,profile) or _inside(code,runtime) or _overlap(code,retained):_fail('unsafe directory overlap')
    context_file=runtime/_FILE
    if _inside(code,context_file):_fail('context file cannot be in code')
    return context_file

def _pairs(pairs):
    value={}
    for key,item in pairs:
        if key in value:_fail('duplicate JSON key')
        value[key]=item
    return value

def load_desktop_context(moduleId,token,contextFile,signature,expectedDataDir):
    """Return validated fields. Signature covers exact sorted-key UTF-8 bytes."""
    try:
        key=_token(token)
        if moduleId not in ('ledger','inventory') or not isinstance(signature,str) or not re.fullmatch(r'[a-f0-9]{64}',signature):_fail('invalid context identity or signature')
        expected_data=_checked(expectedDataDir)
        filename=_checked(contextFile,kind='file')
        if filename.name!=_FILE:_fail('context filename is fixed')
        before=filename.lstat()
        if not 1<=before.st_size<=_MAX:_fail('context exceeds 16KiB')
        descriptor=os.open(filename,os.O_RDONLY|getattr(os,'O_BINARY',0)|getattr(os,'O_NOFOLLOW',0))
        try:
            opened=os.fstat(descriptor)
            if not stat.S_ISREG(opened.st_mode) or opened.st_nlink!=1 or (opened.st_dev,opened.st_ino)!=(before.st_dev,before.st_ino):_fail('context file changed')
            chunks=[];remaining=_MAX+1
            while remaining:
                chunk=os.read(descriptor,remaining)
                if not chunk:break
                chunks.append(chunk);remaining-=len(chunk)
            raw=b''.join(chunks)
            after=os.fstat(descriptor)
            if len(raw)>_MAX or (opened.st_dev,opened.st_ino,opened.st_size,opened.st_mtime_ns)!=(after.st_dev,after.st_ino,after.st_size,after.st_mtime_ns):_fail('context file changed or exceeds 16KiB')
        finally:os.close(descriptor)
        text=raw.decode('utf-8');context=json.loads(text,object_pairs_hook=_pairs,parse_constant=lambda x:_fail('invalid JSON number'))
        if not isinstance(context,dict) or set(context)!=_FIELDS:_fail('unexpected fields')
        canonical=json.dumps(context,ensure_ascii=False,sort_keys=True,separators=(',',':'),allow_nan=False).encode('utf-8')
        if raw!=canonical or not hmac.compare_digest(hmac.new(key,_PREFIX+canonical,hashlib.sha256).hexdigest(),signature):_fail('noncanonical context or signature mismatch')
        expected_file=_validate(context)
        if context['module']!=moduleId or not _same(_checked(context['dataDir']),expected_data) or not _same(filename,expected_file):_fail('module, data directory or context destination mismatch')
        current=_checked(contextFile,kind='file').lstat()
        if (current.st_dev,current.st_ino,current.st_size,current.st_mtime_ns)!=(after.st_dev,after.st_ino,after.st_size,after.st_mtime_ns):_fail('context file changed')
        return context
    except (OSError,TypeError,OverflowError,UnicodeError) as error:raise ValueError('DESKTOP_RUNTIME: invalid context file or path') from error

def retained_number_file(context):
    _validate(context)
    if context['module']!='ledger':_fail('ERP numbering requires ledger context')
    return _checked(Path(context['retainedDir'])/'erp-number-reservations.json',kind='file',allow_missing=True)

def erp_attachments_dir(context):
    _validate(context)
    if context['module']!='ledger':_fail('ERP attachments require ledger context')
    return _checked(Path(context['dataDir'])/'erp-attachments',allow_missing=True)
