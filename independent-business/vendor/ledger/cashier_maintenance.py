"""Private one-shot restore worker, entered only after the original bootstrap.

No employee HTTP endpoint, actor fabrication, App startup or arbitrary CLI path.
Signed maintenance tickets bind the owned stage, directory identities and nonce.
Only staged account/grant/receipt preservation is delegated to cashier_restore.
"""
import base64
import hashlib
import hmac
import importlib.util
import json
import os
from pathlib import Path
import re
import sqlite3
import sys
import time

REQUEST_PREFIX=b'xjy-cashier-maintenance-v1\0'
RESULT_PREFIX=b'xjy-cashier-maintenance-result-v1\0'
UUID=r'[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}'
NUMBER_FILES=('cashier-number-reservations.json','erp-number-reservations.json')


def canonical(value):return json.dumps(value,ensure_ascii=False,sort_keys=True,separators=(',',':'),allow_nan=False)


def pairs(items):
    result={}
    for key,value in items:
        if key in result:raise ValueError('Duplicate maintenance JSON key')
        result[key]=value
    return result


def decode(encoded):
    if not isinstance(encoded,str) or not re.fullmatch(r'[A-Za-z0-9_-]{1,24000}',encoded):raise ValueError('Invalid bounded maintenance payload')
    raw=base64.urlsafe_b64decode(encoded+'='*(-len(encoded)%4))
    value=json.loads(raw.decode('utf-8'),object_pairs_hook=pairs)
    if raw!=canonical(value).encode('utf-8'):raise ValueError('Noncanonical maintenance payload')
    return value


def read_json(file,limit=16384):
    from desktop_runtime_context import _checked
    file=_checked(file,kind='file');before=file.stat()
    if not 0<before.st_size<=limit:raise ValueError('Maintenance marker exceeds limit')
    raw=file.read_bytes();after=_checked(file,kind='file').stat()
    if (before.st_dev,before.st_ino,before.st_size,before.st_mtime_ns)!=(after.st_dev,after.st_ino,after.st_size,after.st_mtime_ns):raise ValueError('Maintenance marker changed')
    return json.loads(raw.decode('utf-8-sig'),object_pairs_hook=pairs)


def hash_file(file):
    from desktop_runtime_context import _checked
    file=_checked(file,kind='file',allow_missing=True)
    if not file.exists():return None
    before=file.stat();digest=hashlib.sha256();size=0
    with file.open('rb') as stream:
        opened=os.fstat(stream.fileno())
        if (opened.st_dev,opened.st_ino)!=(before.st_dev,before.st_ino):raise ValueError('Maintenance file identity changed')
        while True:
            chunk=stream.read(65536)
            if not chunk:break
            size+=len(chunk);digest.update(chunk)
        after=os.fstat(stream.fileno())
    named=_checked(file,kind='file').stat()
    if size!=before.st_size or (opened.st_dev,opened.st_ino,opened.st_size,opened.st_mtime_ns)!=(after.st_dev,after.st_ino,after.st_size,after.st_mtime_ns) or (after.st_dev,after.st_ino,after.st_size,after.st_mtime_ns)!=(named.st_dev,named.st_ino,named.st_size,named.st_mtime_ns):raise ValueError('Maintenance file changed during hashing')
    return {'sha256':digest.hexdigest(),'size':size}


def node_directory_identity(directory):
    """Match libuv's Windows directory identity without masking os.stat values.

    CPython 3.14 and libuv expose different volume serial representations.
    Read the complete fields of the same Win32 interface used by our native
    path guard, and retain Python's full identity for the local stability check.
    """
    from desktop_runtime_context import _checked,_same
    directory=_checked(directory);before=directory.stat()
    if os.name!='nt':return {'dev':str(before.st_dev),'ino':str(before.st_ino)}
    import ctypes as C
    class Info(C.Structure):
        _fields_=[(name,C.c_uint32) for name in ('attributes','creationLow','creationHigh','accessLow','accessHigh','writeLow','writeHigh','volume','sizeHigh','sizeLow','links','indexHigh','indexLow')]
    if C.sizeof(Info)!=52:raise ValueError('Unsupported native directory identity layout')
    api=C.WinDLL('kernel32',use_last_error=True)
    api.CreateFileW.argtypes=[C.c_wchar_p,C.c_uint32,C.c_uint32,C.c_void_p,C.c_uint32,C.c_uint32,C.c_void_p];api.CreateFileW.restype=C.c_void_p
    api.GetFileInformationByHandle.argtypes=[C.c_void_p,C.POINTER(Info)];api.GetFileInformationByHandle.restype=C.c_int
    api.GetFinalPathNameByHandleW.argtypes=[C.c_void_p,C.c_wchar_p,C.c_uint32,C.c_uint32];api.GetFinalPathNameByHandleW.restype=C.c_uint32
    api.GetVolumeInformationByHandleW.argtypes=[C.c_void_p,C.c_wchar_p,C.c_uint32,C.POINTER(C.c_uint32),C.POINTER(C.c_uint32),C.POINTER(C.c_uint32),C.c_wchar_p,C.c_uint32];api.GetVolumeInformationByHandleW.restype=C.c_int
    api.CloseHandle.argtypes=[C.c_void_p];api.CloseHandle.restype=C.c_int
    # READ_ATTRIBUTES, SHARE_READ, OPEN_EXISTING, BACKUP_SEMANTICS and
    # OPEN_REPARSE_POINT. This neither requests nor enables backup privileges.
    handle=api.CreateFileW(str(directory),0x80,1,None,3,0x02200000,None)
    if not handle or handle==C.c_void_p(-1).value:raise ValueError('Native directory handle unavailable')
    try:
        info=Info()
        if not api.GetFileInformationByHandle(handle,C.byref(info)):raise ValueError('Native directory identity unavailable')
        if not info.attributes&0x10 or info.attributes&0x400:raise ValueError('Native directory type rejected')
        filesystem=C.create_unicode_buffer(32)
        if not api.GetVolumeInformationByHandleW(handle,None,0,None,None,None,filesystem,len(filesystem)) or filesystem.value.upper()!='NTFS':
            # ReFS needs a shared 128-bit protocol; do not silently reduce it.
            raise ValueError('Native directory filesystem unsupported')
        final=C.create_unicode_buffer(32768)
        length=api.GetFinalPathNameByHandleW(handle,final,len(final),0)
        if not 0<length<len(final):raise ValueError('Native directory final path unavailable')
        actual=final.value
        if actual.startswith('\\\\?\\'):actual=actual[4:]
        if not _same(_checked(actual),directory):raise ValueError('Native directory handle path mismatch')
        after=_checked(directory).stat()
        if (before.st_dev,before.st_ino)!=(after.st_dev,after.st_ino):raise ValueError('Native directory changed during observation')
        again=Info()
        if not api.GetFileInformationByHandle(handle,C.byref(again)) or (info.volume,info.indexHigh,info.indexLow,info.attributes)!=(again.volume,again.indexHigh,again.indexLow,again.attributes):
            raise ValueError('Native directory handle changed during observation')
        index=(int(info.indexHigh)<<32)|int(info.indexLow)
        if not index:raise ValueError('Native directory file identifier unavailable')
        return {'dev':str(info.volume),'ino':str(index)}
    finally:
        api.CloseHandle(handle)


def authenticate(phase,stage_guard=None):
    from desktop_runtime_context import load_desktop_context,_checked,_inside,_same,_overlap
    if phase not in ('merge','verify','verify-rollback'):raise ValueError('Unknown maintenance action')
    token=os.environ.get('XJY_MODULE_TOKEN','')
    if not re.fullmatch(r'[A-Za-z0-9_-]{32,256}',token):raise ValueError('Private startup token required')
    stage_root=os.environ.get('XJY_STAGE1_ROOT')
    if stage_root:
        # Reuse the original installed guard; reinstalling it would wrap its
        # connection factory twice. Independently recheck its real OS token.
        if not isinstance(stage_guard,dict) or set(stage_guard)!={'root','check'} or not callable(stage_guard['check']) or not _same(_checked(stage_guard['root']),_checked(stage_root)) or sqlite3.connect.__module__!='python_guard':
            raise ValueError('Original installed restricted Stage guard required')
        token_source=Path(stage_guard['check'](Path(stage_root)/'stage1'/'token-info.py'))
        spec=importlib.util.spec_from_file_location('cashier_maintenance_actual_token_information',token_source)
        token_module=importlib.util.module_from_spec(spec);spec.loader.exec_module(token_module)
        token_info=token_module.information();stage_identity=read_json(Path(stage_root)/'isolation-identity.json')
        if not token_info['restricted'] or stage_identity['sid'] not in token_info['restrictingSids']:raise ValueError('Actual restricted Stage token required')
        root_boundary=_checked(stage_root);release=None;number_dir=_checked(root_boundary/'config')
    else:
        if stage_guard is not None:raise ValueError('A Stage guard cannot select release maintenance')
        release=load_desktop_context('ledger',token,os.environ.get('XJY_MODULE_CONTEXT_FILE',''),
                    os.environ.get('XJY_MODULE_CONTEXT_SIGNATURE',''),os.environ.get('LEDGER_DATA',''))
        root_boundary=None;number_dir=_checked(release['retainedDir'],allow_missing=True)
    encoded=os.environ.get('XJY_MODULE_CASHIER_MAINTENANCE_REQUEST','');signature=os.environ.get('XJY_MODULE_CASHIER_MAINTENANCE_SIGNATURE','')
    if not re.fullmatch(r'[A-Za-z0-9_-]{1,24000}',encoded) or not re.fullmatch('[a-f0-9]{64}',signature):raise ValueError('Signed private maintenance ticket required')
    expected=hmac.new(token.encode('utf-8'),REQUEST_PREFIX+encoded.encode('ascii'),hashlib.sha256).hexdigest()
    if not hmac.compare_digest(expected,signature):raise ValueError('Maintenance ticket signature mismatch')
    ticket=decode(encoded)
    fields={'version','purpose','action','namespace','hostId','profileId','txId','stageId','root','profileDir','maintenanceRuntimeDir','ledgerDir','identities','issuedAt','expiresAt','nonce','verification'}
    if set(ticket)!=fields or type(ticket['version']) is not int or ticket['version']!=1 or ticket['purpose']!='xjy-cashier-maintenance' or ticket['action']!=phase:
        raise ValueError('Maintenance ticket fields/action mismatch')
    if any(not isinstance(ticket[k],str) or not re.fullmatch(UUID,ticket[k]) for k in ('txId','stageId','nonce')):raise ValueError('Maintenance transaction/stage/nonce invalid')
    if ticket['namespace']!=ticket['hostId']+':'+ticket['profileId']:raise ValueError('Maintenance namespace mismatch')
    now=int(time.time()*1000)
    if any(type(ticket[k]) is not int for k in ('issuedAt','expiresAt')) or not 0<ticket['expiresAt']-ticket['issuedAt']<=30000 or ticket['issuedAt']>now+2000 or ticket['expiresAt']<=now or ticket['issuedAt']<now-30000:
        raise ValueError('Maintenance ticket expired or invalid')
    root=_checked(ticket['root']);profile=_checked(ticket['profileDir']);runtime=_checked(ticket['maintenanceRuntimeDir']);ledger=_checked(ticket['ledgerDir'])
    if root_boundary and not _inside(root_boundary,root):raise ValueError('Maintenance root escaped original Stage guard')
    if any(not _inside(root,value) or _same(root,value) for value in (profile,runtime,ledger)) or any(_overlap(a,b) for a,b in ((profile,runtime),(profile,ledger),(runtime,ledger))):raise ValueError('Maintenance owned layout overlaps or escapes')
    if not _same(ledger,_checked(os.environ.get('LEDGER_DATA',''))):raise ValueError('Maintenance ledger differs from bootstrap')
    if release and (release['hostId']!=ticket['hostId'] or not _same(profile,_checked(release['profileDir'])) or not _same(ledger,_checked(release['dataDir']))):raise ValueError('Maintenance differs from signed release context')
    owner=read_json(profile/'business-maintenance-owner.json')
    if owner!={'version':1,'hostId':ticket['hostId'],'profileId':ticket['profileId']}:raise ValueError('Maintenance owner mismatch')
    stage=_checked(runtime/'restore-stage'/ticket['stageId']);job=_checked(runtime/'restorations'/ticket['txId'])
    if read_json(stage/'.owner.json')!={'version':1,'namespace':ticket['namespace'],'type':'stage'} or read_json(job/'.cashier-owner.json')!={'version':1,'namespace':ticket['namespace'],'txId':ticket['txId']}:raise ValueError('Stage/transaction owner mismatch')
    identities=ticket['identities']
    if not isinstance(identities,dict) or set(identities)!={'ledger','stageRoot','stageLedger','job','previousLedger'}:raise ValueError('Directory identity bindings missing')
    directories={'ledger':ledger,'stageRoot':stage,'job':job}
    if phase=='merge':directories['stageLedger']=_checked(stage/'ledger')
    if phase=='verify':directories['previousLedger']=_checked(job/'previous-ledger')
    for key,binding in identities.items():
        if key not in directories:
            if binding is not None:raise ValueError('Unexpected phase directory binding')
            continue
        if binding!=node_directory_identity(directories[key]):raise ValueError('Maintenance directory identity changed: '+key)
    if phase=='merge' and ticket['verification'] is not None or phase!='merge' and (not isinstance(ticket['verification'],dict) or set(ticket['verification'])!={'receipt','numbers'}):raise ValueError('Unexpected maintenance verification input')
    nonce_file=_checked(job/('cashier-nonce-'+ticket['nonce']+'.json'),kind='file',allow_missing=True)
    with nonce_file.open('x',encoding='utf-8') as stream:
        stream.write(canonical({'version':1,'action':phase,'nonce':ticket['nonce'],'requestHash':hashlib.sha256(encoded.encode('ascii')).hexdigest()}));stream.flush();os.fsync(stream.fileno())
    return token,encoded,ticket,ledger,stage,number_dir


def connect(file,readonly):
    from desktop_runtime_context import _checked,_same
    file=_checked(file,kind='file')
    for suffix in ('-wal','-shm','-journal'):_checked(Path(str(file)+suffix),kind='file',allow_missing=True)
    connection=sqlite3.connect(file,isolation_level=None,timeout=5)
    try:
        # Fresh sqlite connections keep extension loading disabled by default;
        # the original Stage guard also rejects the extension API entirely.
        connection.row_factory=sqlite3.Row;connection.execute('PRAGMA foreign_keys=ON')
        connection.set_authorizer(lambda action,arg1,arg2,db,trigger:sqlite3.SQLITE_DENY if action in (sqlite3.SQLITE_ATTACH,sqlite3.SQLITE_DETACH) or action==sqlite3.SQLITE_FUNCTION and str(arg2 or arg1).lower()=='load_extension' else sqlite3.SQLITE_OK)
        actual=connection.execute('PRAGMA database_list').fetchall()
        if len(actual)!=1 or not _same(_checked(actual[0]['file'],kind='file'),file):raise ValueError('Maintenance opened an unexpected ledger')
        if readonly:connection.execute('PRAGMA query_only=ON')
        return connection
    except Exception:connection.close();raise


def number_witness(directory):return {name:hash_file(directory/name) for name in NUMBER_FILES}


def perform(ticket,ledger,stage,number_dir):
    import cashier_restore
    numbers=number_witness(number_dir)
    current=connect(ledger/'ledger.db',True)
    try:
        if ticket['action']=='merge':
            staged=connect(stage/'ledger'/'ledger.db',False)
            try:
                staged.execute('BEGIN IMMEDIATE')
                plan=cashier_restore.preflight(current,staged)
                if plan['currentSchema']=='v1':
                    documents=current.execute('SELECT id,number,kind,business_date FROM cashier_documents').fetchall()
                    if documents:
                        if numbers['cashier-number-reservations.json'] is None:raise ValueError('当前资金凭证缺少外部编号保留记录，拒绝恢复以免重发旧编号')
                        knowledge=read_json(number_dir/'cashier-number-reservations.json',64*1024*1024)
                        if knowledge.get('version')!=1 or not isinstance(knowledge.get('numbers'),dict):raise ValueError('出纳编号保留记录无效')
                        for document in documents:
                            saved=knowledge['numbers'].get(document['number'])
                            if not isinstance(saved,dict) or any(saved.get(key)!=document[field] for key,field in (('docId','id'),('kind','kind'),('date','business_date'))):raise ValueError('出纳编号保留事实与当前凭证冲突，拒绝恢复')
                if plan['needsInitialization']:
                    from cashier_schema import initialize
                    initialize(staged)
                receipt=cashier_restore.preserve_current_authority(current,staged,plan)
                staged.commit()
                cashier_restore.verify_restored(staged,receipt)
                if cashier_restore._snapshot(current)['hash']!=plan['currentHash']:raise ValueError('Current cashier state changed during frozen preservation')
                result={'receipt':{k:receipt[k] for k in ('version','expectedHash','requiredDispatchGuard')},
                        'currentHash':plan['currentHash'],'numbers':numbers,'lostCount':len(plan['lostUnfinishedDocumentIds'])}
            except Exception:staged.rollback();raise
            finally:staged.close()
        else:
            if ticket['verification']['numbers']!=numbers:raise ValueError('Retained cashier/ERP numbers changed; refusing resume')
            result=cashier_restore.verify_restored(current,ticket['verification']['receipt'])
    finally:current.close()
    if number_witness(number_dir)!=numbers:raise ValueError('Retained numbering changed during maintenance')
    return result


def run(phase,*,stage_guard=None):
    try:
        token,encoded,ticket,ledger,stage,number_dir=authenticate(phase,stage_guard)
    except Exception as error:
        # This private CLI cannot sign a reply before admission. Report only
        # fixed codes, never exception text, ticket values or filesystem paths.
        codes={
            'Original installed restricted Stage guard required':'CASHIER_STAGE_GUARD_REQUIRED',
            'Actual restricted Stage token required':'CASHIER_RESTRICTED_TOKEN_REQUIRED',
            'Private startup token required':'CASHIER_STARTUP_TOKEN_REQUIRED',
            'Signed private maintenance ticket required':'CASHIER_TICKET_REQUIRED: Signed private maintenance ticket required',
            'Maintenance ticket signature mismatch':'CASHIER_TICKET_SIGNATURE_MISMATCH',
            'Noncanonical maintenance payload':'CASHIER_TICKET_NONCANONICAL',
            'Maintenance ticket fields/action mismatch':'CASHIER_TICKET_FIELDS_MISMATCH',
            'Maintenance transaction/stage/nonce invalid':'CASHIER_TICKET_IDENTIFIER_INVALID',
            'Maintenance namespace mismatch':'CASHIER_NAMESPACE_MISMATCH',
            'Maintenance ticket expired or invalid':'CASHIER_TICKET_EXPIRED',
            'Maintenance root escaped original Stage guard':'CASHIER_ROOT_REJECTED',
            'Maintenance owned layout overlaps or escapes':'CASHIER_LAYOUT_REJECTED',
            'Maintenance ledger differs from bootstrap':'CASHIER_LEDGER_MISMATCH',
            'Maintenance differs from signed release context':'CASHIER_RELEASE_CONTEXT_MISMATCH',
            'Maintenance owner mismatch':'CASHIER_OWNER_MISMATCH',
            'Stage/transaction owner mismatch':'CASHIER_STAGE_OWNER_MISMATCH',
            'Directory identity bindings missing':'CASHIER_DIRECTORY_BINDING_MISSING',
            'Unexpected phase directory binding':'CASHIER_DIRECTORY_BINDING_UNEXPECTED',
            'Unexpected maintenance verification input':'CASHIER_VERIFICATION_FIELDS_MISMATCH',
            'Native directory filesystem unsupported':'CASHIER_DIRECTORY_FILESYSTEM_UNSUPPORTED',
        }
        message=str(error)
        if message in {'Maintenance directory identity changed: '+key for key in ('ledger','stageRoot','stageLedger','job','previousLedger')}:
            code='CASHIER_DIRECTORY_IDENTITY_MISMATCH'
        else:
            code=codes.get(message,'CASHIER_MAINTENANCE_ADMISSION_REJECTED')
        if sys.stderr is not None:print(code,file=sys.stderr,flush=True)
        return 3
    response={'version':1,'purpose':'xjy-cashier-maintenance-result','action':phase,'txId':ticket['txId'],'nonce':ticket['nonce'],
              'requestHash':hashlib.sha256(encoded.encode('ascii')).hexdigest(),'ok':False,'result':None,'error':None}
    try:response['result']=perform(ticket,ledger,stage,number_dir);response['ok']=True
    except Exception as exc:response['error']=str(exc)[:800]
    raw=base64.urlsafe_b64encode(canonical(response).encode('utf-8')).decode('ascii').rstrip('=')
    signature=hmac.new(token.encode('utf-8'),RESULT_PREFIX+raw.encode('ascii'),hashlib.sha256).hexdigest()
    print(canonical({'encoded':raw,'signature':signature}),flush=True)
    return 0 if response['ok'] else 1
